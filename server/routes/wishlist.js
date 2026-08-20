import { Router } from "express";
import { db } from "../db/index.js";
import { requireCustomer } from "../customerAuth.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();

// Persisting the wishlist server-side (rather than only in browser state)
// means it survives across devices/sessions, and — more importantly —
// means we know which customers to email when a wishlisted item comes
// back in stock (see the restock check in routes/products.js).

// GET /api/wishlist — this customer's saved product IDs.
router.get("/", requireCustomer, asyncHandler(async (req, res) => {
  const rows = await db.prepare("SELECT product_id FROM wishlist_items WHERE customer_id = ?").all(req.customer.id);
  res.json({ productIds: rows.map((r) => r.product_id) });
}));

// POST /api/wishlist/:productId — add a product to this customer's wishlist.
router.post("/:productId", requireCustomer, asyncHandler(async (req, res) => {
  const product = await db.prepare("SELECT id FROM products WHERE id = ?").get(req.params.productId);
  if (!product) return res.status(404).json({ error: "Product not found" });

  await db.prepare(`
    INSERT INTO wishlist_items (customer_id, product_id) VALUES (?, ?)
    ON CONFLICT (customer_id, product_id) DO NOTHING
  `).run(req.customer.id, req.params.productId);

  res.status(201).json({ added: true });
}));

// DELETE /api/wishlist/:productId — remove a product from this customer's wishlist.
router.delete("/:productId", requireCustomer, asyncHandler(async (req, res) => {
  await db.prepare("DELETE FROM wishlist_items WHERE customer_id = ? AND product_id = ?")
    .run(req.customer.id, req.params.productId);
  res.status(204).end();
}));

export default router;
