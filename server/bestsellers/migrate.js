import { db } from "../db/index.js";

function addColumnIfMissing(table, column, type) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err) {
    if (!String(err.message).includes("duplicate column")) throw err;
  }
}

export function runBestsellersMigration() {
  // Separate from the manual `tag` column on purpose — an admin (or the
  // sheet sync) can still hand-set tag="Bestseller" on a product, and
  // that keeps working independently of this computed flag. A product
  // counts as a bestseller on the storefront if EITHER is true (see
  // rowToProduct in routes/products.js).
  addColumnIfMissing("products", "auto_bestseller", "INTEGER NOT NULL DEFAULT 0");
}
