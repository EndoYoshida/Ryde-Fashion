import { Router } from "express";
import { db } from "../db/index.js";
import { requireAdmin } from "../auth.js";
import { requireCustomer } from "../customerAuth.js";
import { upload, cloudinaryUrl } from "../upload.js";
import { sendOrderReceiptEmail } from "../email.js";
import { publicWriteLimiter } from "../rateLimit.js";
import { writeStockToSheet } from "../sync/sheetsSync.js";
import { pushOrderToSheet, updateOrderStatusInSheet, updatePaymentStatusInSheet } from "../sync/poSheetSync.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();

async function getOrderWithItems(id) {
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
    proofImage: order.proof_image ? cloudinaryUrl(order.proof_image) : null,
    status: order.status,
    paymentStatus: order.payment_status,
    total: order.total,
    date: order.date,
    items,
  };
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
  const { id, customer, email, phone, address, paymentMethod, items } = req.body;

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
  const getProduct = db.prepare("SELECT * FROM products WHERE id = ?");
  const resolvedItems = [];
  for (const raw of items) {
    const qty = Number(raw?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
      return res.status(400).json({ error: "Each item needs a valid quantity (1-999)" });
    }
    const product = raw?.id ? await getProduct.get(raw.id) : null;
    if (!product) {
      return res.status(400).json({ error: "One of the items in your cart no longer exists. Please refresh and try again." });
    }
    if (product.status !== "available") {
      return res.status(409).json({ error: `"${product.name}" is no longer available.` });
    }
    if (product.stock < qty) {
      return res.status(409).json({ error: `Only ${product.stock} of "${product.name}" left in stock.` });
    }
    resolvedItems.push({ product, qty });
  }

  const total = resolvedItems.reduce((sum, { product, qty }) => sum + product.price * qty, 0);

  // Everything below happens atomically — either the whole order, all
  // its line items, and every stock decrement succeed together, or
  // none of it is written at all. Note: the transaction body uses
  // `tx.prepare` (bound to this transaction's own connection), not the
  // outer `db.prepare` — see db/index.js's transaction() for why.
  const stockUpdates = []; // { sku, newStock, newStatus } — for pushing back to the sheet after commit
  const placeOrder = db.transaction(async (tx) => {
    await tx.prepare(`
      INSERT INTO orders (id, customer_name, email, phone, address, payment_method, status, payment_status, total, date)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, to_char(now(), 'YYYY-MM-DD'))
    `).run(id, customer.trim(), email.trim().toLowerCase(), cleanPhone, address?.trim() || null, paymentMethod ?? null, total);

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

  const order = await getOrderWithItems(id);

  // Send a receipt email — this never blocks or fails the order itself.
  const receipt = await sendOrderReceiptEmail(order);
  if (!receipt.sent) {
    console.warn(`Order ${id} created, but receipt email wasn't sent: ${receipt.reason}`);
  }

  // Push the new stock count (and, if it just sold out, status) back to
  // the Google Sheet for any item that came from the sheet sync (has a
  // sku), so a later pull sync — e.g. the one that runs on server
  // restart — doesn't overwrite this decrement with the sheet's stale,
  // pre-order values. Fire-and-forget, same as the receipt email: a
  // sheet write hiccup should never fail the order.
  for (const { sku, newStock, newStatus } of stockUpdates) {
    writeStockToSheet(sku, newStock, newStatus).then((result) => {
      if (!result.written) {
        console.warn(`Order ${id}: didn't update sheet stock for sku="${sku}": ${result.reason}`);
      }
    });
  }

  // Mirror the new PO into the Google Sheet's "PO Register"/"PO Items"
  // tabs, same fire-and-forget treatment as the receipt email and the
  // stock write-back above — never lets a Sheets hiccup fail the order.
  pushOrderToSheet(order).then((result) => {
    if (!result.pushed) {
      console.warn(`Order ${id}: didn't push PO to sheet: ${result.reason}`);
    }
  });

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

// PATCH /api/orders/:id/status
router.patch("/:id/status", requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.body;
  const result = await db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Order not found" });
  const order = await getOrderWithItems(req.params.id);
  updateOrderStatusInSheet(order).then((r) => {
    if (!r.written) console.warn(`Order ${order.id}: didn't update sheet status: ${r.reason}`);
  });
  res.json(order);
}));

// PATCH /api/orders/:id/payment-status
router.patch("/:id/payment-status", requireAdmin, asyncHandler(async (req, res) => {
  const { paymentStatus } = req.body;
  const result = await db.prepare("UPDATE orders SET payment_status = ? WHERE id = ?").run(paymentStatus, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Order not found" });
  const order = await getOrderWithItems(req.params.id);
  updatePaymentStatusInSheet(order).then((r) => {
    if (!r.written) console.warn(`Order ${order.id}: didn't update sheet payment status: ${r.reason}`);
  });
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
  for (const { sku, newStock, newStatus } of stockUpdates) {
    writeStockToSheet(sku, newStock, newStatus).then((result) => {
      if (!result.written) {
        console.warn(`Order ${req.params.id} cancel: didn't update sheet stock for sku="${sku}": ${result.reason}`);
      }
    });
  }
  updateOrderStatusInSheet(updated).then((r) => {
    if (!r.written) console.warn(`Order ${updated.id}: didn't update sheet status: ${r.reason}`);
  });

  res.json(updated);
}));

export default router;
