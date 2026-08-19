import { Router } from "express";
import fs from "fs";
import path from "path";
import { db } from "../db/index.js";
import { upload, UPLOADS_DIR } from "../upload.js";
import { requireAdmin } from "../auth.js";
import { requireCustomer } from "../customerAuth.js";
import { sendBackInStockEmail, sendNewProductEmail } from "../email.js";

const router = Router();

function getImages(productId) {
  return db.prepare("SELECT id, filename FROM product_images WHERE product_id = ? ORDER BY sort_order, id")
    .all(productId)
    .map((row) => ({ id: row.id, url: `/uploads/${row.filename}` }));
}

export function rowToProduct(row) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    price: row.price,
    oldPrice: row.old_price ?? undefined,
    stock: row.stock,
    status: row.status,
    weight: row.weight ?? 0.3,
    description: row.description || "",
    rating: row.rating,
    reviews: row.reviews,
    tag: row.tag ?? undefined,
    weight: row.weight ?? 0.3,
    // True if either an admin/sheet manually set tag="Bestseller", OR the
    // automatic sales-based computation (server/bestsellers/compute.js)
    // flagged it. Either source is enough — see that module for the
    // "top N by units sold in the last N days" logic.
    bestseller: row.tag === "Bestseller" || Boolean(row.auto_bestseller),
    images: getImages(row.id),
  };
}

export function recomputeRating(productId) {
  const agg = db.prepare("SELECT AVG(rating) AS avgRating, COUNT(*) AS count FROM product_ratings WHERE product_id = ?")
    .get(productId);
  const rating = agg.count > 0 ? Math.round(agg.avgRating * 10) / 10 : 0;
  db.prepare("UPDATE products SET rating = ?, reviews = ? WHERE id = ?").run(rating, agg.count, productId);
}

// Emails everyone who has this product on their wishlist. Fire-and-forget
// from the caller's point of view — a slow/failing email shouldn't hold up
// the admin's "save product" request, so callers don't await this.
export async function notifyWishlistersBackInStock(product) {
  const wishers = db.prepare(`
    SELECT c.email FROM wishlist_items w
    JOIN customers c ON c.id = w.customer_id
    WHERE w.product_id = ? AND c.status = 'active'
  `).all(product.id);
  for (const { email } of wishers) {
    try {
      await sendBackInStockEmail(email, product);
    } catch (err) {
      console.error(`Failed to send back-in-stock email to ${email}:`, err.message);
    }
  }
}

// Emails every active newsletter subscriber about a newly uploaded product.
export async function notifySubscribersNewProduct(product) {
  const subscribers = db.prepare("SELECT email FROM newsletter_subscribers WHERE unsubscribed = 0").all();
  for (const { email } of subscribers) {
    try {
      await sendNewProductEmail(email, product);
    } catch (err) {
      console.error(`Failed to send new-product email to ${email}:`, err.message);
    }
  }
}

// GET /api/products
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM products ORDER BY id DESC").all();
  res.json(rows.map(rowToProduct));
});

// POST /api/products
router.post("/", requireAdmin, (req, res) => {
  const { name, brand, category, price, oldPrice, stock, status, tag, description, weight } = req.body;
  if (!name || !brand || !category || price == null) {
    return res.status(400).json({ error: "name, brand, category, and price are required" });
  }
  const result = db.prepare(`
    INSERT INTO products (name, brand, category, price, old_price, stock, status, tag, description, weight, rating, reviews)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
  `).run(name, brand, category, price, oldPrice ?? null, stock ?? 0, status ?? "available", tag ?? null, description?.trim() || null, weight ? Number(weight) : 0.3);

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid);
  const product = rowToProduct(row);

  // Let newsletter subscribers know a new product just went up. Not
  // awaited — the admin's "create product" request shouldn't wait on
  // however many emails need to go out.
  notifySubscribersNewProduct(product);

  res.status(201).json(product);
});

// PUT /api/products/:id
router.put("/:id", requireAdmin, (req, res) => {
  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Product not found" });

  const wasOutOfStock = existing.status !== "available" || existing.stock <= 0;

  const merged = { ...rowToProduct(existing), ...req.body };
  db.prepare(`
    UPDATE products SET name=?, brand=?, category=?, price=?, old_price=?, stock=?, status=?, tag=?, description=?, weight=?
    WHERE id=?
  `).run(
    merged.name, merged.brand, merged.category, merged.price,
    merged.oldPrice ?? null, merged.stock, merged.status, merged.tag ?? null,
    merged.description?.trim() || null,
    merged.weight ? Number(merged.weight) : 0.3,
    req.params.id
  );

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  const product = rowToProduct(row);

  // Restocked: was unavailable/out of stock, now available with stock —
  // let anyone with it on their wishlist know. Not awaited, same reason
  // as above.
  const isBackInStock = product.status === "available" && product.stock > 0;
  if (wasOutOfStock && isBackInStock) {
    notifyWishlistersBackInStock(product);
  }

  res.json(product);
});

// DELETE /api/products/:id
router.delete("/:id", requireAdmin, (req, res) => {
  const images = getImages(req.params.id);
  const result = db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Product not found" });

  // product_images rows cascade-delete automatically; also remove the
  // actual files from disk so uploads/ doesn't accumulate orphans.
  for (const img of images) {
    const filePath = path.join(UPLOADS_DIR, path.basename(img.url));
    fs.unlink(filePath, () => {});
  }
  res.status(204).end();
});

// POST /api/products/:id/images  (multipart/form-data, field name "images", up to 8 files)
router.post("/:id/images", requireAdmin, upload.array("images", 8), (req, res) => {
  const product = db.prepare("SELECT id FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No image files were uploaded" });
  }

  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM product_images WHERE product_id = ?")
    .get(req.params.id).m;

  const insert = db.prepare(
    "INSERT INTO product_images (product_id, filename, sort_order) VALUES (?, ?, ?)"
  );
  req.files.forEach((file, i) => insert.run(req.params.id, file.filename, maxOrder + 1 + i));

  res.status(201).json({ images: getImages(req.params.id) });
});

// DELETE /api/products/:id/images/:imageId
router.delete("/:id/images/:imageId", requireAdmin, (req, res) => {
  const image = db.prepare("SELECT * FROM product_images WHERE id = ? AND product_id = ?")
    .get(req.params.imageId, req.params.id);
  if (!image) return res.status(404).json({ error: "Image not found" });

  db.prepare("DELETE FROM product_images WHERE id = ?").run(req.params.imageId);
  fs.unlink(path.join(UPLOADS_DIR, image.filename), () => {});

  res.json({ images: getImages(req.params.id) });
});

// POST /api/products/:id/rate  (customer-only — one rating per customer
// per product; rating again just updates their previous one)
router.post("/:id/rate", requireCustomer, (req, res) => {
  const { rating } = req.body || {};
  const value = Number(rating);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    return res.status(400).json({ error: "Rating must be a whole number from 1 to 5" });
  }
  const product = db.prepare("SELECT id FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });

  db.prepare(`
    INSERT INTO product_ratings (product_id, customer_id, rating)
    VALUES (?, ?, ?)
    ON CONFLICT (product_id, customer_id) DO UPDATE SET rating = excluded.rating, created_at = datetime('now')
  `).run(req.params.id, req.customer.id, value);

  recomputeRating(req.params.id);

  const updated = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  res.json(rowToProduct(updated));
});

// GET /api/products/:id/my-rating  (customer-only — what did *I* rate this?)
router.get("/:id/my-rating", requireCustomer, (req, res) => {
  const row = db.prepare("SELECT rating FROM product_ratings WHERE product_id = ? AND customer_id = ?")
    .get(req.params.id, req.customer.id);
  res.json({ rating: row?.rating || 0 });
});

export default router;
