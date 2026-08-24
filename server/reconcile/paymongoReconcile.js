import { db } from "../db/index.js";
import { getCheckoutSession, isPaymongoConfigured } from "../paymongo.js";
import { getOrderWithItems } from "../routes/orders.js";
import { updatePaymentStatusInSheet } from "../sync/poSheetSync.js";
import { notifyPaymentExpiredMessenger } from "../routes/messenger.js";

// Fills the gap the webhook can't: PayMongo never sends an event for a
// Checkout Session that's cancelled/abandoned/left to expire — the ONLY
// webhook event Checkout Sessions fire is `checkout_session.payment.paid`
// (confirmed against PayMongo's docs — there's no
// `checkout_session.payment.failed`/`.cancelled`). So an order a customer
// backed out of, or a payment link they just never opened again, sits at
// payment_status='pending' forever unless something proactively asks
// PayMongo whether the session is still alive. This does that, on a
// schedule (see reconcile/scheduler.js).
export async function reconcilePendingPaymongoOrders() {
  if (!isPaymongoConfigured) return { checked: 0, expired: 0 };

  const stuck = await db.prepare(`
    SELECT * FROM orders
    WHERE payment_status = 'pending' AND paymongo_checkout_session_id IS NOT NULL
  `).all();

  let expiredCount = 0;
  for (const order of stuck) {
    let session;
    try {
      session = await getCheckoutSession(order.paymongo_checkout_session_id);
    } catch (err) {
      console.warn(`[paymongo-reconcile] order ${order.id}: couldn't fetch checkout session:`, err.message);
      continue;
    }

    // "active" just means still payable — leave it alone, the customer
    // might come back and pay. Only "expired" is PayMongo's own
    // definitive "no more chances to pay through this link" state, and
    // only then do we flip payment_status to failed.
    if (session.attributes.status !== "expired") continue;

    const result = await db.prepare(
      `UPDATE orders SET payment_status = 'failed' WHERE id = ? AND payment_status = 'pending'`
    ).run(order.id);
    if (result.changes === 0) continue; // raced with something else (e.g. webhook just marked it paid) — skip
    expiredCount++;

    const updated = await getOrderWithItems(order.id);
    updatePaymentStatusInSheet(updated).then((r) => {
      if (!r.written) console.warn(`Order ${updated.id}: didn't update sheet payment status: ${r.reason}`);
    });
    notifyPaymentExpiredMessenger(updated).catch((err) => {
      console.error(`Order ${updated.id}: failed to notify customer of expired payment:`, err.message);
    });
    console.log(`[paymongo-reconcile] order ${order.id}: checkout session expired unpaid — marked payment_status='failed'.`);
  }

  return { checked: stuck.length, expired: expiredCount };
}
