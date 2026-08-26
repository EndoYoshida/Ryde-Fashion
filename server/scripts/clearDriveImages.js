// One-off "start fresh" reset: deletes every Drive-synced product image
// (Cloudinary asset + its product_images row) so the storefront shows no
// photos, ahead of re-running an image-matching Apps Script against the
// sheet and then re-syncing. This does NOT touch:
//   - admin-uploaded images (product_images.drive_file_id IS NULL) — those
//     didn't come from the sheet/Drive flow and a re-sync won't recreate
//     them, so wiping them here would be a real, unrecoverable loss.
//   - the source photos in Google Drive — they're left alone (not trashed,
//     not modified) so the Apps Script and the next sheet sync can still
//     see/re-download them.
//
// Cloudinary deletes are immediate and have no "trash"/undo, unlike Drive.
//
// Usage (run from the server/ folder):
//   node scripts/clearDriveImages.js            -> dry run, lists what would be deleted
//   node scripts/clearDriveImages.js --update    -> actually deletes

import "dotenv/config";
import { db } from "../db/index.js";
import { deleteCloudinaryImage } from "../upload.js";

const shouldUpdate = process.argv.includes("--update");

const rows = await db.prepare(`
  SELECT pi.id, pi.product_id, pi.filename, pi.drive_file_id,
         p.sku, p.name, p.brand
  FROM product_images pi
  JOIN products p ON p.id = pi.product_id
  WHERE pi.drive_file_id IS NOT NULL
  ORDER BY p.sku, pi.sort_order
`).all();

if (rows.length === 0) {
  console.log("No Drive-synced images found — nothing to clear.");
  process.exit(0);
}

console.log(`Found ${rows.length} Drive-synced image row(s) across ${new Set(rows.map((r) => r.product_id)).size} product(s):\n`);
for (const r of rows) {
  console.log(`  product_id=${r.product_id}  sku=${r.sku}  "${r.brand} ${r.name}"  image_id=${r.id}  drive_file_id=${r.drive_file_id}`);
}

if (!shouldUpdate) {
  console.log("\nDry run only — nothing was changed. Re-run with --update to apply.");
  process.exit(0);
}

let deleted = 0;
for (const r of rows) {
  try {
    await db.prepare("DELETE FROM product_images WHERE id = ?").run(r.id);
    await deleteCloudinaryImage(r.filename);
    deleted++;
  } catch (err) {
    console.error(`Failed to delete image_id=${r.id} (product_id=${r.product_id}):`, err.message);
  }
}

console.log(`\nDeleted ${deleted} Drive-synced image(s). Products with no other (admin-uploaded) photo will now show blank.`);
console.log("Drive source files were left untouched, so the Apps Script and next sheet sync can still use them.");
