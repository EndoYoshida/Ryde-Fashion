import { Router } from "express";
import { db } from "../db/index.js";
import { requireAdmin } from "../auth.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();

// GET /api/customers  (includes live order count + total spent)
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const rows = await db.prepare(`
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
}));

// POST /api/customers
router.post("/", requireAdmin, asyncHandler(async (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email) return res.status(400).json({ error: "name and email are required" });
  const result = await db.prepare(`
    INSERT INTO customers (name, email, phone, joined, status) VALUES (?, ?, ?, to_char(now(), 'YYYY-MM-DD'), 'active')
    RETURNING id
  `).run(name, email, phone ?? null);
  res.status(201).json({ id: result.lastInsertRowid, name, email, phone, status: "active" });
}));

// PATCH /api/customers/:id/status
// Admin-only lever for a customer's account state:
//  - "active"    — normal account
//  - "suspended" — temporarily blocked from signing in; reversible
//  - "deleted"   — admin-initiated soft delete. The row (and their order
//                  history) is kept for business records, exactly like a
//                  customer deleting their own account — it's just marked
//                  deleted rather than removed, and can be restored back
//                  to "active" later if needed.
const VALID_STATUSES = new Set(["active", "suspended", "deleted"]);
router.patch("/:id/status", requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: "Status must be one of: active, suspended, deleted" });
  }
  const result = await db.prepare("UPDATE customers SET status = ? WHERE id = ?").run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Customer not found" });

  // Suspending or deleting an account should sign it out everywhere
  // immediately, not just the next time it happens to hit the API.
  if (status === "suspended" || status === "deleted") {
    await db.prepare("DELETE FROM customer_sessions WHERE customer_id = ?").run(req.params.id);
  }

  res.json({ id: Number(req.params.id), status });
}));

export default router;
