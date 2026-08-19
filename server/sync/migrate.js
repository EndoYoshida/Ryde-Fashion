// Schema additions needed for Google Sheets sync. Called once from
// db/index.js's migration block (see the wiring note in README-SHEETS-SYNC.md) —
// kept in its own file just so the sync feature's schema changes are easy to
// find/remove later if you ever rip this feature back out.
import { db } from "../db/index.js";

function addColumnIfMissing(table, column, type) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err) {
    if (!String(err.message).includes("duplicate column")) throw err;
  }
}

export function runSheetsSyncMigration() {
  // `sku` is how sheet rows are matched to existing products across runs —
  // without a stable key, re-running the sync would create duplicate
  // products every time instead of updating the ones it already made.
  addColumnIfMissing("products", "sku", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku) WHERE sku IS NOT NULL");

  // Tracks which Drive file a given product_images row came from, so a
  // re-sync can tell "already downloaded this one" apart from "this is a
  // new image to fetch" without re-downloading everything every time.
  addColumnIfMissing("product_images", "drive_file_id", "TEXT");
}
