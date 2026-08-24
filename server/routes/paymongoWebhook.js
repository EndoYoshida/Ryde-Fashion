import { Router } from "express";
import { db } from "../db/index.js";
import { asyncHandler } from "../asyncHandler.js";
import { verifyPaymongoSignature, isPaymongoWebhookConfigured } from "../paymongo.js";
import { updatePaymentStatusInSheet, updateOrderStatusInSheet } from "../sync/poSheetSync.js";
import { getOrderWithItems } from "./orders.js";

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

  // Same fire-and-forget treatment as every other order mutation in
  // routes/orders.js — a Sheets hiccup should never fail the webhook.
  updatePaymentStatusInSheet(updated).then((r) => {
    if (!r.written) console.warn(`Order ${updated.id}: didn't update sheet payment status: ${r.reason}`);
  });
  if (wasPending && updated.status === "approved") {
    updateOrderStatusInSheet(updated).then((r) => {
      if (!r.written) console.warn(`Order ${updated.id}: didn't update sheet status: ${r.reason}`);
    });
  }

  console.log(`Order ${updated.id}: marked paid via PayMongo (checkout session ${checkoutSessionId}).`);
  res.sendStatus(200);
}));

export default router;
