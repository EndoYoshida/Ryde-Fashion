import { Router } from "express";
import { db } from "../db/index.js";
import { requireAdmin } from "../auth.js";
import { requireCustomer } from "../customerAuth.js";
import { upload, cloudinaryUrl } from "../upload.js";
import { sendOrderReceiptEmail } from "../email.js";
import { publicWriteLimiter } from "../rateLimit.js";
import { writeStockToSheet, writeStockToInventoryErp } from "../sync/sheetsSync.js";
import { pushOrderToSheet, updateOrderStatusInSheet, updatePaymentStatusInSheet } from "../sync/poSheetSync.js";
import { asyncHandler } from "../asyncHandler.js";
import { createCheckoutSession, isPaymongoConfigured, paymongoEnabledMethods, isPaymongoTestMode } from "../paymongo.js";

const router = Router();

export async function getOrderWithItems(id) {
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!order) return null;
  const items = await db.prepare("SELECT name, qty, price FROM order_items WHERE order_id = ?").all(id);
  return {
    id: order.id,
    customer: order.customer_name,
    email: order.email,
    phone: order.phone,
    address: order.address,
    paymentMethod: order.payment_method,
    deliveryMethod: order.delivery_method,
    deliveryDetail: order.delivery_detail,
    messengerPsid: order.messenger_psid,
    proofImage: order.proof_image ? cloudinaryUrl(order.proof_image) : null,
    status: order.status,
    paymentStatus: order.payment_status,
    total: order.total,
    date: order.date,
    items,
  };
}

// Thrown by resolveOrderItems for anything that should surface as a
// customer-facing message (bad qty, sold out, no longer available) —
// callers (this route, and the Messenger "buy now" flow) catch this
// specifically so a raw stack trace never leaks to a customer.
export class OrderError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status; // HTTP status the website route should reply with
  }
}

// Re-derives and validates a cart against the database — the ONLY
// things ever trusted from the caller are product id and qty; name,
// price, and availability always come from the product row itself.
// Shared by the website checkout route below and the Messenger "buy
// now" flow (routes/messenger.js), so both go through identical
// pricing/stock rules and can never drift apart.
export async function resolveOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new OrderError("Order must include 1-50 items", 400);
  }
  const getProduct = db.prepare("SELECT * FROM products WHERE id = ?");
  const resolvedItems = [];
  for (const raw of items) {
    const qty = Number(raw?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
      throw new OrderError("Each item needs a valid quantity (1-999)", 400);
    }
    const product = raw?.id ? await getProduct.get(raw.id) : null;
    if (!product) {
      throw new OrderError("One of the items in your cart no longer exists. Please refresh and try again.", 400);
    }
    if (product.status !== "available") {
      throw new OrderError(`"${product.name}" is no longer available.`, 409);
    }
    if (product.stock < qty) {
      throw new OrderError(`Only ${product.stock} of "${product.name}" left in stock.`, 409);
    }
    resolvedItems.push({ product, qty });
  }
  return resolvedItems;
}

// Writes the order + line items + stock decrements atomically (see the
// transaction note below), and returns the stock-write-back list for
// the sheet sync. Doesn't send receipts, push to the PO sheet, or touch
// PayMongo — callers own those side effects, since the website route
// and the Messenger buy flow want different ones (e.g. Messenger orders
// have no email to receipt, and go on to create a checkout session).
export async function insertOrder({ id, customerName, email, phone, address, paymentMethod, deliveryMethod, deliveryDetail, messengerPsid, resolvedItems }) {
  const total = resolvedItems.reduce((sum, { product, qty }) => sum + product.price * qty, 0);

  // Everything below happens atomically — either the whole order, all
  // its line items, and every stock decrement succeed together, or
  // none of it is written at all. Note: the transaction body uses
  // `tx.prepare` (bound to this transaction's own connection), not the
  // outer `db.prepare` — see db/index.js's transaction() for why.
  const stockUpdates = []; // { sku, newStock, newStatus } — for pushing back to the sheet after commit
  const placeOrder = db.transaction(async (tx) => {
    await tx.prepare(`
      INSERT INTO orders (id, customer_name, email, phone, address, payment_method, delivery_method, delivery_detail, messenger_psid, status, payment_status, total, date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, to_char(now(), 'YYYY-MM-DD'))
    `).run(id, customerName, email || null, phone || null, address || null, paymentMethod ?? null, deliveryMethod || null, deliveryDetail || null, messengerPsid || null, total);

    const insertItem = tx.prepare("INSERT INTO order_items (order_id, product_id, name, qty, price) VALUES (?, ?, ?, ?, ?)");
    const updateStock = tx.prepare("UPDATE products SET stock = ?, status = ? WHERE id = ?");

    for (const { product, qty } of resolvedItems) {
      // Use the product's real name/price at time of purchase, never
      // whatever the client sent.
      await insertItem.run(id, product.id, product.name, qty, product.price);

      const newStock = Math.max(0, product.stock - qty);
      const soldOut = newStock === 0;
      const newStatus = soldOut ? "sold-out" : product.status;
      await updateStock.run(newStock, newStatus, product.id);
      // Only pass a status along to the sheet when this order is what
      // actually sold the last one — a partial decrement shouldn't touch
      // the sheet's status cell (it's whatever the admin already set it to).
      if (product.sku) stockUpdates.push({ sku: product.sku, newStock, newStatus: soldOut ? "sold-out" : null });
    }
  });
  await placeOrder();

  return { stockUpdates };
}

// Fire-and-forget side effects every newly-created order needs, regardless
// of which route created it: write the new stock counts (and any sold-out
// flip) back to the Google Sheet and the RYDE INVENTORY ERP sheet, and mirror
// the PO into the "PO Register"/"PO Items" tabs. Never lets a Sheets hiccup
// fail order creation — same treatment as the rest of this file.
export async function announceNewOrder(order, stockUpdates) {
  try {
    for (const { sku, newStock, newStatus } of stockUpdates) {
      // Update main products sheet
      const sheetResult = await writeStockToSheet(sku, newStock, newStatus);
      if (!sheetResult.written) {
        console.warn(`Order ${order.id}: didn't update sheet stock for sku="${sku}": ${sheetResult.reason}`);
      }

      // Update RYDE INVENTORY ERP sheet
      const erpResult = await writeStockToInventoryErp(sku, newStock, newStatus);
      if (!erpResult.written) {
        console.warn(`Order ${order.id}: didn't update ERP sheet stock for sku="${sku}": ${erpResult.reason}`);
      }
    }
    const pushResult = await pushOrderToSheet(order);
    if (!pushResult.pushed) {
      console.warn(`Order ${order.id}: didn't push PO to sheet: ${pushResult.reason}`);
    }
  } catch (err) {
    console.error(`Failed to announce new order ${order.id}:`, err.message);
  }
}

// GET /api/orders
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const rows = await db.prepare("SELECT id FROM orders ORDER BY date DESC, id DESC").all();
  res.json(await Promise.all(rows.map((r) => getOrderWithItems(r.id))));
}));

// POST /api/orders  (used by checkout)
//
// Security note: nothing about price or availability is ever trusted
// from the client here. Every item is re-priced and re-validated
// against the actual product row in the database — a tampered request
// (fake low prices, absurd quantities, buying something sold out)
// simply can't succeed, regardless of what the request body claims.
router.post("/", publicWriteLimiter, asyncHandler(async (req, res) => {
  const { id, customer, email, phone, address, paymentMethod, deliveryMethod, deliveryDetail, items } = req.body;

  if (!id || typeof id !== "string" || id.length > 64) {
    return res.status(400).json({ error: "Invalid order id" });
  }
  if (!customer?.trim() || customer.length > 200) {
    return res.status(400).json({ error: "A valid customer name is required" });
  }
  if (!email?.trim() || !email.includes("@") || email.length > 200) {
    return res.status(400).json({ error: "A valid email is required" });
  }
  if (address && address.length > 500) {
    return res.status(400).json({ error: "Address is too long" });
  }
  // Country code + local number, e.g. "+63 9171234567" — the local part
  // is capped at 10 digits by the checkout form itself (no leading 0,
  // since the country code replaces it), so 20 chars comfortably covers
  // "+" + code + space + 10 digits with room to spare.
  const cleanPhone = phone && String(phone).trim().length <= 20 ? String(phone).trim() : null;
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    return res.status(400).json({ error: "Order must include 1-50 items" });
  }

  const existing = await db.prepare("SELECT id FROM orders WHERE id = ?").get(id);
  if (existing) {
    return res.status(409).json({ error: "An order with this ID already exists" });
  }

  // Re-derive every item from the database — id and qty are the only
  // things taken from the request; name/price/availability all come
  // from the product row itself.
  let resolvedItems;
  try {
    resolvedItems = await resolveOrderItems(items);
  } catch (err) {
    if (err instanceof OrderError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }

  const { stockUpdates } = await insertOrder({
    id,
    customerName: customer.trim(),
    email: email.trim().toLowerCase(),
    phone: cleanPhone,
    address: address?.trim() || null,
    paymentMethod,
    deliveryMethod: deliveryMethod?.trim() || null,
    deliveryDetail: deliveryDetail?.trim() || null,
    resolvedItems,
  });

  const order = await getOrderWithItems(id);

  // Send a receipt email — this never blocks or fails the order itself.
  const receipt = await sendOrderReceiptEmail(order);
  if (!receipt.sent) {
    console.warn(`Order ${id} created, but receipt email wasn't sent: ${receipt.reason}`);
  }

  announceNewOrder(order, stockUpdates);

  res.status(201).json(order);
}));

// POST /api/orders/:id/proof  (upload payment proof — public, used by
// checkout right after placing a GCash/Bank Transfer order; anyone
// attempting this needs to already know the exact order id, which is
// only shown to the customer who placed it)
router.post("/:id/proof", upload.single("proof"), asyncHandler(async (req, res) => {
  const order = await db.prepare("SELECT id FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (!req.file) return res.status(400).json({ error: "No proof image was uploaded" });

  await db.prepare("UPDATE orders SET proof_image = ? WHERE id = ?").run(req.file.filename, req.params.id);
  res.status(201).json(await getOrderWithItems(req.params.id));
}));

// GET /api/orders/:id  (public — used by the checkout page to poll an
// order's status after redirecting back from PayMongo's hosted checkout,
// and by the payment-cancelled screen to know what to retry. Same trust
// model as POST /:id/proof above: anyone calling this needs to already
// know the exact, unguessable order id, which is only ever shown to the
// customer who placed it — see makeOrderId() in Checkout.jsx for why
// that id can't be brute-forced.)
router.get("/:id", asyncHandler(async (req, res) => {
  const order = await getOrderWithItems(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
}));

// GET /api/orders/paymongo/config  (public — tells the storefront which
// PayMongo payment methods are actually live right now, so the checkout
// page's "Pay Online" option only appears once PAYMONGO_SECRET_KEY is
// set, and automatically starts offering GCash/Cards/etc. the moment
// those get added to PAYMONGO_PAYMENT_METHODS in server/.env, with no
// frontend redeploy needed. Doesn't conflict with GET "/:id" above —
// that only ever matches a single path segment, and this is two.)
router.get("/paymongo/config", (req, res) => {
  res.json({
    enabled: isPaymongoConfigured && paymongoEnabledMethods.length > 0,
    methods: paymongoEnabledMethods,
    testMode: isPaymongoTestMode,
  });
});

// POST /api/orders/:id/paymongo-session  (public — creates a PayMongo
// Checkout Session for an order that was already placed with "Pay
// Online" selected, and returns the hosted checkout_url to redirect the
// browser to. Same publicWriteLimiter as placing an order itself, since
// this also makes an outbound PayMongo API call per request.)
router.post("/:id/paymongo-session", publicWriteLimiter, asyncHandler(async (req, res) => {
  if (!isPaymongoConfigured) {
    return res.status(503).json({ error: "Online payment isn't set up yet. Please choose another payment method." });
  }

  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.payment_status === "paid") {
    return res.status(409).json({ error: "This order has already been paid." });
  }

  // origin is derived from FRONTEND_ORIGIN (first entry if several are
  // configured) rather than trusted from the request, so a malicious
  // Origin/Referer header can't redirect PayMongo's success/cancel flow
  // to an attacker-controlled domain.
  const frontendOrigin = (process.env.FRONTEND_ORIGIN || "http://localhost:5173").split(",")[0].trim();
  const successUrl = `${frontendOrigin}/checkout?order=${encodeURIComponent(order.id)}&payment=success`;
  const cancelUrl = `${frontendOrigin}/checkout?order=${encodeURIComponent(order.id)}&payment=cancelled`;

  let session;
  try {
    session = await createCheckoutSession({
      order: { id: order.id, customer: order.customer_name, email: order.email, phone: order.phone, total: order.total },
      successUrl,
      cancelUrl,
    });
  } catch (err) {
    console.error(`Order ${order.id}: failed to create PayMongo checkout session:`, err.message);
    return res.status(502).json({ error: "Couldn't start online payment right now. Please try again in a moment." });
  }

  await db.prepare("UPDATE orders SET paymongo_checkout_session_id = ? WHERE id = ?").run(session.id, order.id);

  res.status(201).json({ checkoutUrl: session.attributes.checkout_url });
}));

// PATCH /api/orders/:id/status
router.patch("/:id/status", requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.body;
  const result = await db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Order not found" });
  const order = await getOrderWithItems(req.params.id);
  try {
    await updateOrderStatusInSheet(order);
  } catch (err) {
    console.warn(`Order ${order.id}: failed to update sheet status:`, err.message);
  }
  res.json(order);
}));

// PATCH /api/orders/:id/payment-status
router.patch("/:id/payment-status", requireAdmin, asyncHandler(async (req, res) => {
  const { paymentStatus } = req.body;
  const result = await db.prepare("UPDATE orders SET payment_status = ? WHERE id = ?").run(paymentStatus, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Order not found" });
  const order = await getOrderWithItems(req.params.id);
  try {
    await updatePaymentStatusInSheet(order);
  } catch (err) {
    console.warn(`Order ${order.id}: failed to update sheet payment status:`, err.message);
  }
  res.json(order);
}));

// PATCH /api/orders/:id/cancel  (customer-only — lets a customer cancel
// their own order while there's still time to think it over, i.e.
// before J&T has actually picked it up. "shipped" is the point a
// courier has the parcel, so cancellation is only allowed from
// "pending" or "approved" — once it's shipped/delivered/already
// cancelled, this is refused.
const CUSTOMER_CANCELLABLE_STATUSES = new Set(["pending", "approved"]);
router.patch("/:id/cancel", requireCustomer, asyncHandler(async (req, res) => {
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order || order.email !== req.customer.email) {
    return res.status(404).json({ error: "Order not found" });
  }
  if (!CUSTOMER_CANCELLABLE_STATUSES.has(order.status)) {
    return res.status(409).json({
      error: order.status === "cancelled"
        ? "This order is already cancelled."
        : "This order can no longer be cancelled — it's already on its way.",
    });
  }

  const items = await db.prepare("SELECT product_id, qty FROM order_items WHERE order_id = ?").all(req.params.id);
  const stockUpdates = []; // pushed back to the sheet after commit, same pattern as checkout

  // Cancelling and restocking every item happens atomically — either the
  // whole thing succeeds or none of it does. Uses tx.prepare (bound to
  // the transaction's own connection), not the outer db.prepare — see
  // db/index.js's transaction() for why.
  const cancelOrder = db.transaction(async (tx) => {
    await tx.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(req.params.id);

    for (const { product_id, qty } of items) {
      if (!product_id) continue; // product may have since been deleted
      const product = await tx.prepare("SELECT * FROM products WHERE id = ?").get(product_id);
      if (!product) continue;

      const wasSoldOut = product.status === "sold-out";
      const newStock = product.stock + qty;
      // Only flip the product back to "available" if this cancellation
      // is what pushed stock back above zero — if an admin separately
      // marked it unavailable for another reason, don't override that.
      const newStatus = wasSoldOut && newStock > 0 ? "available" : product.status;
      await tx.prepare("UPDATE products SET stock = ?, status = ? WHERE id = ?").run(newStock, newStatus, product_id);
      if (product.sku) {
        stockUpdates.push({ sku: product.sku, newStock, newStatus: newStatus !== product.status ? newStatus : null });
      }
    }
  });
  await cancelOrder();

  const updated = await getOrderWithItems(req.params.id);

  // Same fire-and-forget sheet write-backs as checkout/admin status
  // changes — a Sheets hiccup should never fail the cancellation itself.
  try {
    for (const { sku, newStock, newStatus } of stockUpdates) {
      // Update main products sheet
      const sheetResult = await writeStockToSheet(sku, newStock, newStatus);
      if (!sheetResult.written) {
        console.warn(`Order ${req.params.id} cancel: didn't update sheet stock for sku="${sku}": ${sheetResult.reason}`);
      }

      // Update RYDE INVENTORY ERP sheet
      const erpResult = await writeStockToInventoryErp(sku, newStock, newStatus);
      if (!erpResult.written) {
        console.warn(`Order ${req.params.id} cancel: didn't update ERP sheet stock for sku="${sku}": ${erpResult.reason}`);
      }
    }
    await updateOrderStatusInSheet(updated);
  } catch (err) {
    console.error(`Failed to update sheets after cancelling order ${req.params.id}:`, err.message);
  }

  res.json(updated);
}));

export default router;