import { Router } from "express";
import { db } from "../db/index.js";
import { asyncHandler } from "../asyncHandler.js";
import { verifyPaymongoSignature, isPaymongoWebhookConfigured } from "../paymongo.js";
import { updatePaymentStatusInSheet, updateOrderStatusInSheet } from "../sync/poSheetSync.js";
import { getOrderWithItems } from "./orders.js";
import { sendOrderConfirmationMessenger, alertOwner } from "./messenger.js";

const router = Router();

// POST /api/paymongo/webhook
//
// This is the ONLY thing that should ever mark an order paid — never the
// success_url redirect a shopper's browser lands on (see paymongo.js for
// why: a browser reaching success_url doesn't prove payment succeeded).
//
// Register this exact URL (https://your-api-domain/api/paymongo/webhook)
// in the PayMongo Dashboard under Developers -> Webhooks, subscribed to
// at least the `checkout_session.payment.paid` event, then copy the
// signing secret it gives you into PAYMONGO_WEBHOOK_SECRET.
router.post("/webhook", asyncHandler(async (req, res) => {
  // express.json()'s `verify` hook in index.js stashes the raw request
  // bytes on every request as req.rawBody — signature verification needs
  // those exact bytes, not the parsed-and-re-stringified object, since
  // even whitespace differences would change the HMAC.
  if (!isPaymongoWebhookConfigured) {
    console.warn("PayMongo webhook received but PAYMONGO_WEBHOOK_SECRET isn't set — rejecting. See server/.env.example.");
    return res.sendStatus(503);
  }
  const signatureHeader = req.headers["paymongo-signature"];
  if (!verifyPaymongoSignature(req.rawBody, signatureHeader)) {
    console.warn("PayMongo webhook: signature verification failed — ignoring request.");
    return res.sendStatus(403);
  }

  const event = req.body?.data?.attributes;
  const eventType = event?.type;
  const resource = event?.data;

  // Always 200 quickly once the signature checks out, even for event
  // types we don't act on — PayMongo retries (with backoff) on anything
  // other than a 2xx, and we don't want it hammering us over events we
  // deliberately ignore.
  if (eventType !== "checkout_session.payment.paid") {
    return res.sendStatus(200);
  }

  const checkoutSessionId = resource?.id;
  // The actual Payment resource is nested under the checkout session's
  // `payments` array once paid — its id is handy to keep for records/
  // refunds later, but the order lookup itself only needs the session id.
  const payment = resource?.attributes?.payments?.[0];

  if (!checkoutSessionId) {
    console.warn("PayMongo webhook: checkout_session.payment.paid event had no session id — ignoring.", event);
    return res.sendStatus(200);
  }

  const order = await db.prepare("SELECT * FROM orders WHERE paymongo_checkout_session_id = ?").get(checkoutSessionId);
  if (!order) {
    // Could be a retry for an event we already handled and whose session
    // id we've since… no, we never clear it — more likely this webhook
    // endpoint is receiving events for a different, older integration
    // attempt, or the order was somehow deleted. Either way, nothing to
    // update — acknowledge so PayMongo stops retrying.
    console.warn(`PayMongo webhook: no order found for checkout session ${checkoutSessionId}.`);
    return res.sendStatus(200);
  }

  // Idempotent: PayMongo can and does redeliver the same event, and two
  // webhook deliveries could theoretically race each other in-flight.
  // Skip the writes (and the downstream sheet/email side effects) if
  // this order is already marked paid.
  if (order.payment_status === "paid") {
    return res.sendStatus(200);
  }

  // Deliberately does NOT touch status when the order was cancelled —
  // see the wasCancelled block below for why silently un-cancelling
  // here would be dangerous (stock already got returned to inventory
  // on cancel, and may have been sold again since). payment_status
  // always flips to paid regardless of status: a real payment came in,
  // and that fact must never be hidden even if the order needs manual
  // review before anything ships.
  await db.prepare(`
    UPDATE orders
    SET payment_status = 'paid',
        status = CASE WHEN status = 'pending' THEN 'approved' ELSE status END,
        paymongo_payment_id = ?
    WHERE id = ?
  `).run(payment?.id || null, order.id);

  // Re-fetch through the same shaping helper the admin PATCH routes use
  // (full item list, camelCase fields) — updateRegisterCell() falls back
  // to appending a brand-new PO Register row via pushOrderToSheet() when
  // it can't find an existing one, and that path needs the full shape.
  const updated = await getOrderWithItems(order.id);
  const wasPending = order.status === "pending";
  const wasCancelled = order.status === "cancelled";

  // Same fire-and-forget treatment as every other order mutation in
  // routes/orders.js — a Sheets hiccup should never fail the webhook.
  try {
    await updatePaymentStatusInSheet(updated);
    if (wasPending && updated.status === "approved") {
      await updateOrderStatusInSheet(updated);
    }
  } catch (err) {
    console.error(`Failed to update sheets for order ${updated.id}:`, err.message);
  }

  // A payment landing on an order that's already cancelled — e.g. a
  // customer paid via an old checkout link after the order was
  // cancelled for taking too long, or an admin cancelled it while
  // payment was in flight. This is rare and needs a human decision
  // (restock permitting, reinstate the order — otherwise refund the
  // customer), so it's deliberately NOT auto-resolved: the order stays
  // "cancelled" (its stock already went back to inventory on cancel
  // and may since have been sold to someone else — silently flipping
  // status back to "approved" here could oversell). Loudly flag it
  // instead, both in the logs and directly to the owner if reachable.
  if (wasCancelled) {
    console.error(
      `⚠️  Order ${updated.id}: PayMongo payment (₱${updated.total.toLocaleString()}) came through AFTER this order was already cancelled. ` +
      `Left status as "cancelled" — payment_status is now "paid". Needs manual review: confirm stock is still available, then either reinstate the order or refund the customer.`
    );
    try {
      await alertOwner(
        `⚠️ PAYMENT ON A CANCELLED ORDER\n\n` +
        `Order #${updated.id} (${updated.customer}) was already cancelled, but a payment of ₱${updated.total.toLocaleString()} just came through via PayMongo.\n\n` +
        `The order was NOT auto-reinstated (its stock may already be sold to someone else). Please check the admin dashboard and either restore the order or refund the customer.`
      );
    } catch (err) {
      console.error(`Order ${updated.id}: failed to alert owner about payment on a cancelled order:`, err.message);
    }
  }

  // If this order came from the Messenger "buy now" flow, send the
  // paid confirmation/PO back in that same chat — it's the only receipt
  // these customers get, since Messenger orders never collect an email.
  // Fire-and-forget, same treatment as the sheet writes above: a
  // Messenger send hiccup should never fail the webhook (PayMongo would
  // just retry it, redelivering the same event). Skipped for the
  // wasCancelled case above — sending a cheerful "we'll prepare your
  // order!" receipt would be actively misleading while it's pending
  // manual review.
  if (updated.messengerPsid && !wasCancelled) {
    try {
      await sendOrderConfirmationMessenger(updated);
    } catch (err) {
      console.error(`Order ${updated.id}: failed to send Messenger payment confirmation:`, err.message);
    }
  }

  console.log(`Order ${updated.id}: marked paid via PayMongo (checkout session ${checkoutSessionId}).`);
  res.sendStatus(200);
}));

export default router;