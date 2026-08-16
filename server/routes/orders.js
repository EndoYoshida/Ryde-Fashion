import { Router } from "express";
import { db } from "../db/index.js";
import { requireAdmin } from "../auth.js";
import { upload } from "../upload.js";

const router = Router();

function getOrderWithItems(id) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!order) return null;
  const items = db.prepare("SELECT name, qty, price FROM order_items WHERE order_id = ?").all(id);
  return {
    id: order.id,
    customer: order.customer_name,
    email: order.email,
    address: order.address,
    paymentMethod: order.payment_method,
    proofImage: order.proof_image ? `/uploads/${order.proof_image}` : null,
    status: order.status,
    paymentStatus: order.payment_status,
    total: order.total,
    date: order.date,
    items,
  };
}

// GET /api/orders
router.get("/", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT id FROM orders ORDER BY date DESC, id DESC").all();
  res.json(rows.map((r) => getOrderWithItems(r.id)));
});

// POST /api/orders  (used by checkout)
router.post("/", (req, res) => {
  const { id, customer, email, address, paymentMethod, items } = req.body;
  if (!id || !customer || !email || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "id, customer, email, and at least one item are required" });
  }
  // Reject an id that already exists rather than silently overwriting
  // someone else's order — ids are client-generated, so collisions
  // (accidental or crafted) must not let one order clobber another.
  const existing = db.prepare("SELECT id FROM orders WHERE id = ?").get(id);
  if (existing) {
    return res.status(409).json({ error: "An order with this ID already exists" });
  }

  const total = items.reduce((sum, it) => sum + it.price * it.qty, 0);

  db.prepare(`
    INSERT INTO orders (id, customer_name, email, address, payment_method, status, payment_status, total, date)
    VALUES (?, ?, ?, ?, ?, 'pending', 'pending', ?, date('now'))
  `).run(id, customer, email, address ?? null, paymentMethod ?? null, total);

  const insertItem = db.prepare("INSERT INTO order_items (order_id, name, qty, price) VALUES (?, ?, ?, ?)");
  for (const it of items) insertItem.run(id, it.name, it.qty, it.price);

  res.status(201).json(getOrderWithItems(id));
});

// POST /api/orders/:id/proof  (upload payment proof — public, used by
// checkout right after placing a GCash/Bank Transfer order; anyone
// attempting this needs to already know the exact order id, which is
// only shown to the customer who placed it)
router.post("/:id/proof", upload.single("proof"), (req, res) => {
  const order = db.prepare("SELECT id FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (!req.file) return res.status(400).json({ error: "No proof image was uploaded" });

  db.prepare("UPDATE orders SET proof_image = ? WHERE id = ?").run(req.file.filename, req.params.id);
  res.status(201).json(getOrderWithItems(req.params.id));
});

// PATCH /api/orders/:id/status
router.patch("/:id/status", requireAdmin, (req, res) => {
  const { status } = req.body;
  const result = db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Order not found" });
  res.json(getOrderWithItems(req.params.id));
});

// PATCH /api/orders/:id/payment-status
router.patch("/:id/payment-status", requireAdmin, (req, res) => {
  const { paymentStatus } = req.body;
  const result = db.prepare("UPDATE orders SET payment_status = ? WHERE id = ?").run(paymentStatus, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Order not found" });
  res.json(getOrderWithItems(req.params.id));
});

export default router;
