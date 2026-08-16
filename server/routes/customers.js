import { Router } from "express";
import { db } from "../db/index.js";
import { requireAdmin } from "../auth.js";

const router = Router();

// GET /api/customers  (includes live order count + total spent)
router.get("/", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT
      c.id, c.name, c.email, c.phone, c.joined, c.status,
      COUNT(o.id) AS orders,
      COALESCE(SUM(CASE WHEN o.payment_status = 'paid' THEN o.total ELSE 0 END), 0) AS totalSpent
    FROM customers c
    LEFT JOIN orders o ON o.email = c.email
    GROUP BY c.id
    ORDER BY c.id
  `).all();
  res.json(rows);
});

// POST /api/customers
router.post("/", requireAdmin, (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email) return res.status(400).json({ error: "name and email are required" });
  const result = db.prepare(`
    INSERT INTO customers (name, email, phone, joined, status) VALUES (?, ?, ?, date('now'), 'active')
  `).run(name, email, phone ?? null);
  res.status(201).json({ id: result.lastInsertRowid, name, email, phone, status: "active" });
});

// PATCH /api/customers/:id/status
router.patch("/:id/status", requireAdmin, (req, res) => {
  const { status } = req.body;
  const result = db.prepare("UPDATE customers SET status = ? WHERE id = ?").run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Customer not found" });
  res.json({ id: Number(req.params.id), status });
});

export default router;
