// One-off cleanup for products stuck showing the old, wrong photo after
// the image-matching sheet script was fixed (see fillProductImages.gs /
// SKU-based matching). The sheet sync (syncImagesForProduct in
// sheetsSync.js) only ever ADDS a newly-linked Drive image — it never
// removes a previously-synced one — so a product that got the wrong
// generic photo before the fix, then the correct SKU-matched photo
// after, ends up with BOTH images saved: the old wrong one (added
// first, so it's sort_order 0 and is what ProductCard/ProductImage
// actually displays) and the new correct one sitting unused behind it.
//
// Detection heuristic: a real, unique product photo is only ever
// attached to ONE product. A photo attached to MULTIPLE products is
// almost certainly the old shared/generic mismatch (that's the exact
// bug being fixed here). So: for any product that has both (a) an
// image shared with other products and (b) a newer image unique to
// just that product, the shared one is deleted and the unique one
// becomes sort_order 0. A product with ONLY a shared image (never
// re-matched yet) is left alone — there's nothing to replace it with,
// and this script never deletes a product's last remaining image.
//
// Usage (run from the server/ folder):
//   node scripts/cleanupStaleProductImages.js            -> dry run, lists what would change
//   node scripts/cleanupStaleProductImages.js --update    -> actually deletes the stale rows + Cloudinary assets

import "dotenv/config";
import { db } from "../db/index.js";
import { deleteCloudinaryImage } from "../upload.js";

const shouldUpdate = process.argv.includes("--update");

const rows = await db.prepare(`
  SELECT pi.id, pi.product_id, pi.filename, pi.drive_file_id, pi.sort_order,
         p.sku, p.name, p.brand
  FROM product_images pi
  JOIN products p ON p.id = pi.product_id
  WHERE pi.drive_file_id IS NOT NULL
  ORDER BY pi.product_id, pi.sort_order
`).all();

// drive_file_id -> how many DISTINCT products use it
const usageCount = new Map();
for (const r of rows) {
  if (!r.drive_file_id) continue;
  const key = r.drive_file_id;
  if (!usageCount.has(key)) usageCount.set(key, new Set());
  usageCount.get(key).add(r.product_id);
}
const isShared = (driveFileId) => (usageCount.get(driveFileId)?.size || 0) > 1;

// Group image rows by product
const byProduct = new Map();
for (const r of rows) {
  if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
  byProduct.get(r.product_id).push(r);
}

const toDelete = [];       // image rows to remove
const skippedOnlyShared = []; // products whose ONLY image is a shared one — left alone

for (const [productId, images] of byProduct) {
  const shared = images.filter((img) => isShared(img.drive_file_id));
  const unique = images.filter((img) => !isShared(img.drive_file_id));

  if (shared.length === 0) continue; // nothing shared here, nothing to do
  if (unique.length === 0) {
    // Every image on this product is shared with other products — no
    // replacement photo exists yet, so leave it as-is rather than
    // deleting its only picture.
    skippedOnlyShared.push(images[0]);
    continue;
  }
  // Has both a shared (stale) image and at least one unique (correct)
  // one — the shared one(s) are safe to remove.
  toDelete.push(...shared);
}

if (toDelete.length === 0) {
  console.log("No stale shared images found — nothing to clean up.");
  if (skippedOnlyShared.length) {
    console.log(`\n(${skippedOnlyShared.length} product(s) only have a shared image with no replacement yet — left untouched:`);
    for (const img of skippedOnlyShared) {
      console.log(`  product_id=${img.product_id}  sku=${img.sku}  "${img.brand} ${img.name}"  drive_file_id=${img.drive_file_id}`);
    }
    console.log(")");
  }
  process.exit(0);
}

console.log(`Found ${toDelete.length} stale shared image row(s) to remove:\n`);
for (const img of toDelete) {
  const sharedWith = usageCount.get(img.drive_file_id).size;
  console.log(`  product_id=${img.product_id}  sku=${img.sku}  "${img.brand} ${img.name}"  image_id=${img.id}  drive_file_id=${img.drive_file_id}  (shared across ${sharedWith} products)`);
}

if (skippedOnlyShared.length) {
  console.log(`\n${skippedOnlyShared.length} product(s) only have a shared image with no replacement yet — left untouched:`);
  for (const img of skippedOnlyShared) {
    console.log(`  product_id=${img.product_id}  sku=${img.sku}  "${img.brand} ${img.name}"  drive_file_id=${img.drive_file_id}`);
  }
}

if (!shouldUpdate) {
  console.log("\nDry run only — nothing was changed. Re-run with --update to apply.");
  process.exit(0);
}

let deletedCount = 0;
for (const img of toDelete) {
  try {
    await db.prepare("DELETE FROM product_images WHERE id = ?").run(img.id);
    await deleteCloudinaryImage(img.filename);
    deletedCount++;
  } catch (err) {
    console.error(`Failed to delete image_id=${img.id} (product_id=${img.product_id}):`, err.message);
  }
}

// Renumber each affected product's remaining images so the (now sole,
// or first) surviving image is sort_order 0 — this is what
// ProductCard/ProductImage actually displays (p.images?.[0]).
const affectedProductIds = [...new Set(toDelete.map((img) => img.product_id))];
for (const productId of affectedProductIds) {
  const remaining = await db.prepare(
    "SELECT id FROM product_images WHERE product_id = ? ORDER BY sort_order, id"
  ).all(productId);
  for (let i = 0; i < remaining.length; i++) {
    await db.prepare("UPDATE product_images SET sort_order = ? WHERE id = ?").run(i, remaining[i].id);
  }
}

console.log(`\nDeleted ${deletedCount} stale image(s) across ${affectedProductIds.length} product(s), and re-sorted their remaining images.`);