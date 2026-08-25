// One-off backfill to fix brand casing on products that already exist
// in the database from before canonicalizeBrand() (see ../brands.js)
// was added to the admin-save and sheet-sync paths. Those paths only
// canonicalize brand values going forward — this script is what fixes
// the rows that are already sitting there with the wrong casing (e.g.
// "CALVIN KLEIN" instead of "Calvin Klein"), which is what's currently
// showing up as duplicate "Shop by Brand" tiles / filter entries.
//
// Usage (run from the server/ folder):
//   node scripts/backfillBrandCasing.js            -> dry run, lists what would change
//   node scripts/backfillBrandCasing.js --update    -> actually updates the rows

import { db } from "../db/index.js";
import { canonicalizeBrand } from "../brands.js";

const shouldUpdate = process.argv.includes("--update");

const products = await db.prepare("SELECT id, brand FROM products").all();

const changes = products
  .map((p) => ({ id: p.id, from: p.brand, to: canonicalizeBrand(p.brand) }))
  .filter((c) => c.from !== c.to);

if (changes.length === 0) {
  console.log("No brand casing mismatches found — nothing to fix.");
  process.exit(0);
}

console.log(`Found ${changes.length} product(s) with a brand casing mismatch:\n`);
for (const c of changes) {
  console.log(`  id=${c.id}  "${c.from}"  ->  "${c.to}"`);
}

if (!shouldUpdate) {
  console.log("\nDry run only — nothing was changed. Re-run with --update to apply.");
  process.exit(0);
}

for (const c of changes) {
  await db.prepare("UPDATE products SET brand = ? WHERE id = ?").run(c.to, c.id);
}
console.log(`\nUpdated ${changes.length} product(s).`);
