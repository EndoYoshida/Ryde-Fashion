import { db } from "../db/index.js";
import { deleteCloudinaryImage, cloudinaryUrl } from "../upload.js";
import { embedProductImage } from "../imageMatch.js";
import { getSheetsClient, isSheetsSyncConfigured } from "./googleAuth.js";
import { extractDriveFileId, downloadDriveImage, trashDriveFile } from "./driveImages.js";
import { rowToProduct, notifyWishlistersBackInStock, notifySubscribersNewProduct } from "../routes/products.js";
import { canonicalizeBrand } from "../brands.js";

// Sheet tab + range to read. Override via env if your tab isn't named
// "Products" or you want to cap how many rows get scanned.
const SHEET_RANGE = process.env.SHEETS_SYNC_RANGE || "Products";

// Number of rows directly under the header to always ignore, e.g. so you
// can keep a "template"/example row (or two) at the top of the sheet for
// reference without it being read, synced, or overwritten as real product
// data. Set SHEETS_SYNC_RESERVED_ROWS=2 in your env to skip rows 2-3 and
// start reading real data at row 4. Defaults to 0 (no reserved rows).
const RESERVED_ROWS = parseInt(process.env.SHEETS_SYNC_RESERVED_ROWS || "0", 10) || 0;

// Which sheet row (1-indexed) holds the actual column headers (sku, name,
// brand, ...). Defaults to row 1. Set SHEETS_SYNC_HEADER_ROW=2 if you add
// a merged title/banner row above your headers (e.g. a "RYDE Products"
// banner in row 1), so the bot reads row 2 as headers instead of trying
// to parse the banner text as column names.
const HEADER_ROW = parseInt(process.env.SHEETS_SYNC_HEADER_ROW || "1", 10) || 1;

// Keep this in lockstep with src/data/products.js's CATEGORIES list — it's
// duplicated here (rather than imported) because the server and frontend
// are separate builds. If you add/rename a category on the frontend,
// update this list too, or sheet rows using the new category will get
// skipped with an "unknown category" error in the sync summary.
const VALID_CATEGORIES = new Set([
  "bags", "apparel", "shoes", "watches", "perfume", "makeup", "wallets", "accessories",
]);

// Header names are matched case-insensitively with spaces/underscores
// ignored, so "Old Price", "old_price", and "OLDPRICE" all work the same.
function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/[\s_]+/g, "");
}

// Trims and collapses internal whitespace runs to a single space, e.g.
// "  Louis   Vuitton " -> "Louis Vuitton". Plain .trim() (used elsewhere
// in this file) leaves double-spaces and tabs pasted mid-string alone,
// which is enough on its own to split one brand into two different
// "Shop by Brand" cards on the storefront, since brand matching is exact
// string equality.
function normalizeSpacing(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

// Catches the "pasted a SKU/model code into the Brand column" mistake —
// the same class of error that let non-color values (e.g. "LS116",
// "3W1.5") leak into the old Color filter. Short, no-space tokens that mix
// letters and digits (or are digit-led) read as product codes, not brand
// names — real brands with that shape (3M, Y-3) are rare enough that this
// is a warning, not an auto-skip, so it doesn't block a legitimate row.
function looksLikeSkuNotBrand(text) {
  const t = String(text || "").trim();
  if (!t || /\s/.test(t)) return false;
  if (t.length > 8) return false;
  return /\d/.test(t) && /[A-Za-z]/.test(t) || /^\d+[A-Za-z]?\.\d+$/.test(t);
}

const COLUMN_ALIASES = {
  sku: ["sku", "id", "productid"],
  name: ["name", "productname", "title"],
  brand: ["brand"],
  category: ["category"],
  color: ["color", "colour"],
  gender: ["gender"],
  price: ["price"],
  oldPrice: ["oldprice", "originalprice", "wasprice"],
  stock: ["stock", "quantity", "qty"],
  status: ["status"],
  description: ["description", "desc", "productdescription", "productdesc", "product-description", "product.description", "product description", "product_desc", "Product Description", "Product_Description"],
  weight: ["weight"],
  tag: ["tag", "label"],
  images: ["images", "image", "photos", "photo", "drivelinks", "driveimages"],
  variants: ["variants", "variant", "sizecolor", "sizesstock", "sizecolorstock"],
};

function buildFieldMap(headerRow) {
  const normalized = headerRow.map(normalizeHeader);
  const fieldMap = {}; // field name -> column index
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) fieldMap[field] = idx;
  }
  return fieldMap;
}

function rowToRecord(row, fieldMap) {
  const get = (field) => {
    const idx = fieldMap[field];
    return idx == null ? undefined : row[idx];
  };
  return {
    sku: get("sku")?.toString().trim(),
    name: get("name")?.toString().trim(),
    brand: canonicalizeBrand(get("brand")),
    category: get("category")?.toString().trim(),
    color: get("color")?.toString().trim(),
    gender: get("gender")?.toString().trim(),
    price: get("price"),
    oldPrice: get("oldPrice"),
    stock: get("stock"),
    status: get("status")?.toString().trim(),
    description: get("description")?.toString().trim(),
    weight: get("weight"),
    tag: get("tag")?.toString().trim(),
    images: get("images"),
    // Left as-is (not .trim()'d/stringified like the others) — undefined
    // means "sheet has no variants column at all" vs. "" meaning "column
    // exists, this row's cell is blank" — that distinction matters in
    // syncVariantsForProduct below, so don't collapse it here.
    variants: get("variants"),
  };
}

function toIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toFloatOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Catches the "pasted the Drive link into the wrong cell" mistake — a
// description whose entire content is a single bare URL is almost never
// intentional customer-facing copy, and it's a real thing that's happened
// (the Drive share link ends up literally on the storefront product
// page). Only matches when the URL is the *whole* trimmed string, so a
// legitimate description that happens to mention/include a link
// mid-sentence is left alone.
function looksLikeBareUrl(text) {
  return /^https?:\/\/\S+$/i.test(String(text || "").trim());
}

// --- Variant cell parsing (color/size/stock) ----------------------------
// Shorthand format, comma-separated entries, each "Color:Size:Stock":
//   "Black:XL:5, Black:XXL:2, White:XL:3"
// Leave Color or Size blank for a product that only varies on one axis:
//   ":XL:5, :XXL:2"        (size-only)
//   "Black::5, White::3"   (color-only)
// Every entry needs exactly 3 colon-separated parts. A malformed entry is
// skipped (not fatal) with a reason collected in `errors`, so one typo in
// the sheet doesn't stop the rest of that product's variants — or the
// rest of the sync run — from going through.
function parseVariantsCell(cell) {
  if (!cell) return { variants: [], errors: [] };
  const variants = [];
  const errors = [];
  const entries = String(cell).split(",").map((e) => e.trim()).filter(Boolean);
  for (const entry of entries) {
    const parts = entry.split(":");
    if (parts.length !== 3) {
      errors.push(`"${entry}" (expected Color:Size:Stock)`);
      continue;
    }
    const [colorRaw, sizeRaw, stockRaw] = parts.map((p) => p.trim());
    const stock = toIntOrNull(stockRaw);
    if (stock === null) {
      errors.push(`"${entry}" (stock isn't a number)`);
      continue;
    }
    variants.push({ color: colorRaw || null, size: sizeRaw || null, stock });
  }
  return { variants, errors };
}

// Inverse of parseVariantsCell — used when writing an admin-dashboard
// variant edit back out to the sheet, so the two stay in the same format.
function formatVariantsCell(variants) {
  if (!variants || variants.length === 0) return "";
  return variants.map((v) => `${v.color || ""}:${v.size || ""}:${v.stock}`).join(", ");
}

// Replaces every product_variants row for one product with what's in the
// cell — simplest correct approach given variants have no stable identity
// of their own in the sheet (no per-variant sku), so there's nothing to
// diff against. `variantsCell === undefined` means the sheet has no
// "variants" column mapped at all (vs. "" meaning the column exists but
// this row's cell is empty, which correctly clears any existing variants
// for that product).
async function syncVariantsForProduct(productId, variantsCell) {
  if (variantsCell === undefined) return { count: 0, errors: [] };
  const { variants, errors } = parseVariantsCell(variantsCell);
  await db.prepare("DELETE FROM product_variants WHERE product_id = ?").run(productId);
  for (const v of variants) {
    await db.prepare("INSERT INTO product_variants (product_id, color, size, stock) VALUES (?, ?, ?, ?)")
      .run(productId, v.color, v.size, v.stock);
  }
  return { count: variants.length, errors };
}

// Flags brands that only differ by capitalization/spacing across the
// sheet (e.g. "Coach" on one row, "COACH" on another). Brands in
// CANONICAL_BRANDS (see ../brands.js) are already auto-corrected to one
// spelling by canonicalizeBrand() above, so in practice this only fires
// for a brand that isn't in that list yet — surfaced as a warning so
// whoever owns the sheet can either fix the casing at the source or add
// the brand to CANONICAL_BRANDS. Doesn't block the sync either way.
function findBrandCasingConflicts(records) {
  const byNormalized = new Map(); // lowercase brand -> Set of exact casings seen
  for (const r of records) {
    if (!r.brand) continue;
    const key = r.brand.toLowerCase();
    if (!byNormalized.has(key)) byNormalized.set(key, new Set());
    byNormalized.get(key).add(r.brand);
  }
  const conflicts = [];
  for (const variants of byNormalized.values()) {
    if (variants.size > 1) {
      conflicts.push(`brand appears as ${[...variants].map((v) => `"${v}"`).join(" / ")} across different rows — pick one spelling so it doesn't split into separate "Shop by Brand" tiles`);
    }
  }
  return conflicts;
}

async function fetchRows() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
    range: SHEET_RANGE,
  });
  const rows = res.data.values || [];
  if (rows.length < HEADER_ROW + 1) return { fieldMap: {}, records: [] };

  const fieldMap = buildFieldMap(rows[HEADER_ROW - 1]);
  const records = rows.slice(HEADER_ROW + RESERVED_ROWS)
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
    .map((row) => rowToRecord(row, fieldMap));
  return { fieldMap, records };
}

// Mirrors the PUT /api/products/:id route's own logic for deciding
// "was this out of stock and is it now available" — kept in sync with
// that route intentionally, since a sheet-driven restock should notify
// wishlisters exactly the same way an admin-driven restock does.
async function upsertProduct(record) {
  if (!record.sku) {
    return { skipped: true, reason: "missing sku" };
  }
  if (!record.name || !record.brand || !record.category || record.price === undefined) {
    return { skipped: true, reason: "missing required field (name/brand/category/price)" };
  }
  if (!VALID_CATEGORIES.has(record.category)) {
    return { skipped: true, reason: `unknown category "${record.category}" — must be one of: ${[...VALID_CATEGORIES].join(", ")}` };
  }

  const price = toIntOrNull(record.price);
  if (price === null) return { skipped: true, reason: "invalid price" };

  // Doesn't block the sync — see looksLikeSkuNotBrand above — just
  // surfaces a warning so whoever owns the sheet can double-check the
  // Brand cell for that row.
  const brandWarning = looksLikeSkuNotBrand(record.brand)
    ? `brand "${record.brand}" looks like it might be a SKU/model code, not a real brand — double check the Brand column`
    : null;

  const existing = await db.prepare("SELECT * FROM products WHERE sku = ?").get(record.sku);
  const wasOutOfStock = existing ? (existing.status !== "available" || existing.stock <= 0) : false;

  // See looksLikeBareUrl above — don't let a misplaced Drive/image link
  // go out as the product's description; drop it and surface a warning
  // in the sync summary instead, so the sheet gets fixed at the source.
  const descriptionIsBareUrl = looksLikeBareUrl(record.description);

  const values = {
    name: record.name,
    brand: record.brand,
    category: record.category,
    color: record.color || null,
    gender: record.gender || null,
    price,
    old_price: toIntOrNull(record.oldPrice),
    stock: toIntOrNull(record.stock) ?? 0,
    status: record.status || "available",
    tag: record.tag || null,
    description: descriptionIsBareUrl ? null : (record.description || null),
    weight: toFloatOrNull(record.weight) ?? 0.3,
  };

  let productId;
  if (existing) {
    await db.prepare(`
      UPDATE products SET name=?, brand=?, category=?, color=?, gender=?, price=?, old_price=?, stock=?, status=?, tag=?, description=?, weight=?
      WHERE id=?
    `).run(
      values.name, values.brand, values.category, values.color, values.gender, values.price, values.old_price,
      values.stock, values.status, values.tag, values.description, values.weight,
      existing.id
    );
    productId = existing.id;
  } else {
    const result = await db.prepare(`
      INSERT INTO products (sku, name, brand, category, color, gender, price, old_price, stock, status, tag, description, weight, rating, reviews)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
      RETURNING id
    `).run(
      record.sku, values.name, values.brand, values.category, values.color, values.gender, values.price, values.old_price,
      values.stock, values.status, values.tag, values.description, values.weight,
    );
    productId = result.lastInsertRowid;
  }

  const { errors: variantErrors } = await syncVariantsForProduct(productId, record.variants);

  return {
    skipped: false,
    productId,
    created: !existing,
    wasOutOfStock,
    variantErrors,
    brandWarning,
    descriptionWarning: descriptionIsBareUrl
      ? `description looked like a bare link ("${record.description.trim()}") — cleared instead of publishing it as copy`
      : null,
  };
}

// Reconciles a product's images against its sheet cell (source of truth
// for drive-synced images), instead of only ever ADDING newly-linked
// photos. Previously, updating a Drive link in the sheet left the old,
// wrong photo in place — it was added first, so it stayed sort_order 0
// (what ProductCard/ProductImage actually displays) with the corrected
// photo sitting unused behind it. See scripts/cleanupStaleProductImages.js
// for the one-off cleanup of rows already in that state from before this
// fix; this is what stops it from happening again on every future sync.
//
// Admin-uploaded images (drive_file_id IS NULL) are never touched here —
// this only reconciles the set of drive_file_id-backed images against
// the sheet cell's current list.
async function syncImagesForProduct(productId, imagesCell) {
  // A blank Images cell means "nothing entered yet for this row", not
  // "remove every photo" — leave whatever's already synced alone rather
  // than wiping a product's photos just because the cell wasn't filled
  // in on some particular sync pass.
  if (!imagesCell) return { added: 0, failed: 0 };

  const fileIds = String(imagesCell).split(/[,\n]/).map(extractDriveFileId).filter(Boolean);

  const existingDrive = await db.prepare(
    "SELECT id, filename, drive_file_id, sort_order FROM product_images WHERE product_id = ? AND drive_file_id IS NOT NULL"
  ).all(productId);
  const existingByFileId = new Map(existingDrive.map((img) => [img.drive_file_id, img]));

  // Drop any previously-synced drive image whose file id is no longer
  // listed in the cell — it was either replaced with a corrected link or
  // removed outright, and either way it shouldn't keep displaying.
  const keepIds = new Set(fileIds);
  for (const img of existingDrive) {
    if (keepIds.has(img.drive_file_id)) continue;
    await db.prepare("DELETE FROM product_images WHERE id = ?").run(img.id);
    deleteCloudinaryImage(img.filename);
    trashDriveFile(img.drive_file_id); // fire-and-forget, same contract as elsewhere in this file
  }

  let added = 0;
  let failed = 0;

  // Admin-uploaded images (no drive_file_id) keep whatever order they
  // already have; drive-synced images are placed after them, in the same
  // left-to-right order as the sheet cell, so the first Drive link in the
  // cell is what actually shows first once no admin photos are ahead of it.
  const maxNonDriveOrder = await db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS m FROM product_images WHERE product_id = ? AND drive_file_id IS NULL"
  ).get(productId);
  let order = maxNonDriveOrder.m + 1;

  for (const fileId of fileIds) {
    const existingImg = existingByFileId.get(fileId);
    if (existingImg) {
      // Already synced and still listed — just make sure its position
      // still matches where it currently sits in the sheet cell.
      if (existingImg.sort_order !== order) {
        await db.prepare("UPDATE product_images SET sort_order = ? WHERE id = ?").run(order, existingImg.id);
      }
      order++;
      continue;
    }
    try {
      const filename = await downloadDriveImage(fileId);
      const result = await db.prepare(
        "INSERT INTO product_images (product_id, filename, sort_order, drive_file_id) VALUES (?, ?, ?, ?) RETURNING id"
      ).run(productId, filename, order++, fileId);
      // Fire-and-forget, same reasoning as the admin-upload path in
      // routes/products.js: embedding calls out to Gemini and shouldn't
      // slow down (or fail) the sheet sync. If it fails, embedding stays
      // NULL and backfillProductEmbeddings() picks it up later.
      embedProductImage(result.lastInsertRowid, cloudinaryUrl(filename));
      added++;
    } catch (err) {
      failed++;
      console.error(`[sheets-sync] image ${fileId} for product ${productId} failed:`, err.message);
    }
  }
  return { added, failed };
}

// Turns a 0-based column index into its Sheets letter (0 -> A, 25 -> Z,
// 26 -> AA, ...) — needed to build an A1-notation cell reference for the
// single-cell stock write below.
function columnIndexToLetter(index) {
  let letter = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

// Pushes one product's updated stock (and, if it just sold out, status)
// back into its row in the Sheet, right after a checkout decrements it
// locally. Without this, the pull sync (on its schedule, or once at
// server startup) would overwrite the DB's decremented stock — and its
// "available" status — with the Sheet's stale, pre-order values, which
// is why a restart could make sold-out items look available again.
//
// newStatus is optional — pass it (e.g. "sold-out") when the order that
// just went through dropped this item's stock to 0, so the Sheet's
// status column flips from "available" to "sold-out" (the site's actual
// out-of-stock value — see STATUS_OPTIONS in src/data/products.js)
// alongside the stock number, in the same request. Leave it out for a
// partial decrement that didn't empty the stock.
//
// Best-effort and non-blocking by design: called fire-and-forget from
// the order route, same as the receipt email. Any failure (sync not
// configured, sku not found, no write access yet) is logged and
// swallowed rather than surfaced to the shopper — a sheet write hiccup
// should never be able to break checkout.
//
// Requires the service account to have Editor (not just Viewer) access
// on the Sheet — see server/sync/README-SHEETS-SYNC.md.
export async function writeStockToSheet(sku, newStock, newStatus) {
  if (!sku) return { written: false, reason: "product has no sku (not sheet-managed)" };
  if (!isSheetsSyncConfigured()) return { written: false, reason: "sheet sync not configured" };
  if (process.env.SHEETS_SYNC_WRITE_STOCK === "false") return { written: false, reason: "writeback disabled" };

  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
      range: SHEET_RANGE,
    });
    const rows = res.data.values || [];
    if (rows.length < HEADER_ROW + 1) return { written: false, reason: "sheet is empty" };

    const fieldMap = buildFieldMap(rows[HEADER_ROW - 1]);
    if (fieldMap.stock == null) return { written: false, reason: 'sheet has no "stock" column' };
    if (fieldMap.sku == null) return { written: false, reason: 'sheet has no "sku" column' };

    const dataRows = rows.slice(HEADER_ROW + RESERVED_ROWS);
    const rowIndex = dataRows.findIndex(
      (row) => (row[fieldMap.sku] || "").toString().trim() === sku
    );
    if (rowIndex === -1) return { written: false, reason: `sku "${sku}" not found in sheet` };

    const sheetRowNumber = rowIndex + HEADER_ROW + RESERVED_ROWS + 1; // 1-indexing, past the header row, past any reserved template rows
    const data = [{
      range: `${SHEET_RANGE}!${columnIndexToLetter(fieldMap.stock)}${sheetRowNumber}`,
      values: [[newStock]],
    }];
    // Only touch the status cell if we were asked to AND the sheet
    // actually has a status column — some sheets omit it and just rely
    // on the "status defaults to available" behavior from setup step 3.
    if (newStatus && fieldMap.status != null) {
      data.push({
        range: `${SHEET_RANGE}!${columnIndexToLetter(fieldMap.status)}${sheetRowNumber}`,
        values: [[newStatus]],
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
      requestBody: { valueInputOption: "RAW", data },
    });
    return { written: true };
  } catch (err) {
    console.error(`[sheets-sync] failed to write back stock for sku="${sku}":`, err.message);
    return { written: false, reason: err.message };
  }
}

// Writes one product's updated stock (and, if it just sold out, status)
// back into its row in the RYDE INVENTORY ERP Sheet, right after a checkout
// decrements it locally. This function mirrors writeStockToSheet but targets
// the ERP inventory sheet instead of the main products sheet.
//
// newStatus is optional — pass it (e.g. "sold-out") when the order that
// just went through dropped this item's stock to 0, so the ERP sheet's
// status column flips from "available" to "sold-out" alongside the stock
// number, in the same request. Leave it out for a partial decrement that
// didn't empty the stock.
//
// Best-effort and non-blocking by design: any failure (sync not configured,
// sku not found, no write access yet) is logged and swallowed rather than
// surfaced to the shopper — a sheet write hiccup should never be able to
// break checkout.
//
// Requires the service account to have Editor (not just Viewer) access
// on the ERP Sheet.
export async function writeStockToInventoryErp(sku, newStock, newStatus) {
  if (!sku) return { written: false, reason: "product has no sku (not sheet-managed)" };
  if (!isSheetsSyncConfigured()) return { written: false, reason: "sheet sync not configured" };
  if (!process.env.SHEETS_SYNC_INVENTORY_ERP_SHEET_ID) return { written: false, reason: "ERP sheet ID not configured" };
  if (process.env.SHEETS_SYNC_WRITE_INVENTORY_ERP === "false") return { written: false, reason: "writeback to ERP disabled" };

  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEETS_SYNC_INVENTORY_ERP_SHEET_ID,
      range: process.env.SHEETS_SYNC_INVENTORY_ERP_RANGE || "Inventory",
    });
    const rows = res.data.values || [];
    if (rows.length < HEADER_ROW + 1) return { written: false, reason: "ERP sheet is empty" };

    const fieldMap = buildFieldMap(rows[HEADER_ROW - 1]);
    if (fieldMap.stock == null) return { written: false, reason: 'ERP sheet has no "stock" column' };
    if (fieldMap.sku == null) return { written: false, reason: 'ERP sheet has no "sku" column' };

    const dataRows = rows.slice(HEADER_ROW + RESERVED_ROWS);
    const rowIndex = dataRows.findIndex(
      (row) => (row[fieldMap.sku] || "").toString().trim() === sku
    );
    if (rowIndex === -1) return { written: false, reason: `sku "${sku}" not found in ERP sheet` };

    const sheetRowNumber = rowIndex + HEADER_ROW + RESERVED_ROWS + 1; // 1-indexing, past the header row, past any reserved template rows
    const data = [{
      range: `${process.env.SHEETS_SYNC_INVENTORY_ERP_RANGE || "Inventory"}!${columnIndexToLetter(fieldMap.stock)}${sheetRowNumber}`,
      values: [[newStock]],
    }];
    // Only touch the status cell if we were asked to AND the sheet
    // actually has a status column — some sheets omit it and just rely
    // on the "status defaults to available" behavior from setup step 3.
    if (newStatus && fieldMap.status != null) {
      data.push({
        range: `${process.env.SHEETS_SYNC_INVENTORY_ERP_RANGE || "Inventory"}!${columnIndexToLetter(fieldMap.status)}${sheetRowNumber}`,
        values: [[newStatus]],
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.SHEETS_SYNC_INVENTORY_ERP_SHEET_ID,
      requestBody: { valueInputOption: "RAW", data },
    });
    return { written: true };
  } catch (err) {
    console.error(`[sheets-sync] failed to write back stock to ERP for sku="${sku}":`, err.message);
    return { written: false, reason: err.message };
  }
}

// Fields (beyond stock/status, which writeStockToSheet above already
// handles) that a full product write-back keeps in sync with the sheet.
// "images" is deliberately excluded — that direction only ever flows
// sheet -> DB (via syncImagesForProduct), so an admin-uploaded photo is
// never pushed out to the sheet's Drive-link column.
const WRITE_BACK_FIELDS = ["name", "brand", "category", "color", "gender", "price", "oldPrice", "stock", "status", "description", "weight", "tag", "variants"];

async function loadSheetHeaderAndRows() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
    range: SHEET_RANGE,
  });
  const rows = res.data.values || [];
  const fieldMap = rows.length >= HEADER_ROW ? buildFieldMap(rows[HEADER_ROW - 1]) : {};
  return { sheets, headerRow: rows[HEADER_ROW - 1] || [], dataRows: rows.slice(HEADER_ROW + RESERVED_ROWS), fieldMap };
}

// Pushes one product's full field set into its sheet row — called after
// an admin creates or edits a product in the dashboard, so the sheet
// stays a mirror of the database instead of drifting out of sync.
//
// If the product has no sku yet (it was created by hand in the admin
// dashboard, never synced from the sheet), this assigns one
// ("ADM-<id>") and appends a brand-new row, so the product becomes
// sheet-managed going forward. The caller is responsible for saving the
// returned sku back onto the product's row in the database.
//
// Same best-effort, fire-and-forget contract as writeStockToSheet: a
// sheet hiccup is logged and swallowed, never surfaced to the admin as
// a failed save.
export async function writeProductToSheet(product) {
  if (!isSheetsSyncConfigured()) return { written: false, reason: "sheet sync not configured" };

  try {
    const { headerRow, dataRows, fieldMap } = await loadSheetHeaderAndRows();
    if (fieldMap.sku == null) return { written: false, reason: 'sheet has no "sku" column' };

    const values = {
      name: product.name,
      brand: product.brand,
      category: product.category,
      color: product.color ?? "",
      gender: product.gender ?? "",
      price: product.price,
      oldPrice: product.oldPrice ?? "",
      stock: product.stock,
      status: product.status,
      description: product.description ?? "",
      weight: product.weight,
      tag: product.tag ?? "",
      variants: formatVariantsCell(product.variants),
    };

    const rowIndex = product.sku
      ? dataRows.findIndex((row) => (row[fieldMap.sku] || "").toString().trim() === product.sku)
      : -1;

    if (rowIndex !== -1) {
      // Existing sheet row for this sku — update each mapped column in place.
      const sheetRowNumber = rowIndex + HEADER_ROW + RESERVED_ROWS + 1;
      const data = [];
      for (const field of WRITE_BACK_FIELDS) {
        if (fieldMap[field] == null) continue;
        data.push({
          range: `${SHEET_RANGE}!${columnIndexToLetter(fieldMap[field])}${sheetRowNumber}`,
          values: [[values[field]]],
        });
      }
      if (data.length === 0) return { written: false, reason: "sheet has no matching columns to update" };

      const sheets = getSheetsClient();
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
        requestBody: { valueInputOption: "RAW", data },
      });
      return { written: true, sku: product.sku };
    }

    // No matching row (new product, or a sku that's no longer in the
    // sheet) — append a fresh one. Assign a sku if this product doesn't
    // have one yet, so it's identifiable on future edits/deletes.
    const sku = product.sku || `ADM-${product.id}`;
    const newRow = new Array(headerRow.length).fill("");
    newRow[fieldMap.sku] = sku;
    for (const field of WRITE_BACK_FIELDS) {
      if (fieldMap[field] != null) newRow[fieldMap[field]] = values[field];
    }

    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
      range: SHEET_RANGE,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [newRow] },
    });
    return { written: true, sku, appended: true };
  } catch (err) {
    console.error(`[sheets-sync] failed to write product "${product.sku || product.id}" to sheet:`, err.message);
    return { written: false, reason: err.message };
  }
}

// Blanks out a product's row in the sheet after it's deleted from the
// admin dashboard, rather than physically removing the row (which would
// need the sheet's numeric internal id and would shift every row below
// it). A blanked row is already treated as empty by fetchRows() above,
// so it won't be re-created as a "new" product on the next pull sync.
export async function clearProductRowInSheet(sku) {
  if (!sku) return { written: false, reason: "product has no sku (not sheet-managed)" };
  if (!isSheetsSyncConfigured()) return { written: false, reason: "sheet sync not configured" };

  try {
    const { dataRows, fieldMap } = await loadSheetHeaderAndRows();
    if (fieldMap.sku == null) return { written: false, reason: 'sheet has no "sku" column' };

    const rowIndex = dataRows.findIndex((row) => (row[fieldMap.sku] || "").toString().trim() === sku);
    if (rowIndex === -1) return { written: false, reason: `sku "${sku}" not found in sheet` };

    const sheetRowNumber = rowIndex + HEADER_ROW + RESERVED_ROWS + 1;
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
      range: `${SHEET_RANGE}!A${sheetRowNumber}:Z${sheetRowNumber}`,
    });
    return { written: true };
  } catch (err) {
    console.error(`[sheets-sync] failed to clear sheet row for sku="${sku}":`, err.message);
    return { written: false, reason: err.message };
  }
}

// Deletes products whose sku was previously synced but no longer appears
// in the sheet. Only ever touches rows that HAVE a sku — anything created
// by hand in the admin dashboard (sku is NULL there) is never a candidate,
// so this can't accidentally wipe out manually-added products.
async function deleteMissingSkus(seenSkus) {
  const allSynced = await db.prepare("SELECT id, sku FROM products WHERE sku IS NOT NULL").all();
  const toDelete = allSynced.filter((p) => !seenSkus.has(p.sku));

  let deleted = 0;
  for (const { id } of toDelete) {
    const images = await db.prepare("SELECT filename, drive_file_id FROM product_images WHERE product_id = ?").all(id);
    try {
      await db.prepare("DELETE FROM products WHERE id = ?").run(id); // product_images cascades
    } catch (err) {
      if (err.code === "23503") {
        // Product has order history (order_items references it via a
        // non-cascading FK) — hard-deleting would either fail like this
        // or, worse, silently corrupt past orders. Archive it instead:
        // hides it from the storefront (status !== "available") and
        // zeroes stock, but keeps the row (and order history) intact.
        // Leave its images/Drive photo alone since the product still exists.
        await db.prepare("UPDATE products SET status = 'unavailable', stock = 0 WHERE id = ?").run(id);
        continue;
      }
      throw err;
    }
    for (const { filename, drive_file_id } of images) {
      deleteCloudinaryImage(filename);
      // Also trash the source photo in Drive, so a row removed from the
      // sheet doesn't leave its photo sitting in the folder forever.
      // Fire-and-forget, same contract as the rest of this sync.
      if (drive_file_id) trashDriveFile(drive_file_id);
    }
    deleted++;
  }
  return deleted;
}

export async function runSheetsSync() {
  const startedAt = Date.now();
  const summary = { created: 0, updated: 0, skipped: 0, deleted: 0, imagesAdded: 0, imagesFailed: 0, errors: [] };
  const seenSkus = new Set();

  let records;
  try {
    ({ records } = await fetchRows());
  } catch (err) {
    summary.errors.push(`Failed to read sheet: ${err.message}`);
    console.error("[sheets-sync] failed to read sheet:", err);
    return summary;
  }

  summary.errors.push(...findBrandCasingConflicts(records));

  for (const record of records) {
    try {
      const result = await upsertProduct(record);
      if (result.skipped) {
        summary.skipped++;
        summary.errors.push(`Row for sku="${record.sku || "?"}" skipped: ${result.reason}`);
        continue;
      }
      seenSkus.add(record.sku);
      if (result.created) summary.created++;
      else summary.updated++;
      if (result.variantErrors?.length) {
        summary.errors.push(`sku="${record.sku}" had unreadable variant entries: ${result.variantErrors.join("; ")}`);
      }
      if (result.brandWarning) {
        summary.errors.push(`sku="${record.sku}": ${result.brandWarning}`);
      }
      if (result.descriptionWarning) {
        summary.errors.push(`sku="${record.sku}": ${result.descriptionWarning}`);
      }

      const { added, failed } = await syncImagesForProduct(result.productId, record.images);
      summary.imagesAdded += added;
      summary.imagesFailed += failed;

      // Same notification behavior as the admin dashboard's create/update
      // routes (see routes/products.js) — fire-and-forget, each recipient's
      // send is individually try/caught inside these functions already.
      const row = await db.prepare("SELECT * FROM products WHERE id = ?").get(result.productId);
      const product = await rowToProduct(row);
      if (result.created) {
        notifySubscribersNewProduct(product);
      } else {
        const isBackInStock = product.status === "available" && product.stock > 0;
        if (result.wasOutOfStock && isBackInStock) {
          notifyWishlistersBackInStock(product);
        }
      }
    } catch (err) {
      summary.skipped++;
      summary.errors.push(`Row for sku="${record.sku || "?"}" failed: ${err.message}`);
      console.error("[sheets-sync] row failed:", err);
    }
  }

  // Safety: only prune deleted-from-sheet products if the sheet actually
  // produced at least one valid, matched row this run. Otherwise a
  // transient read failure or a misconfigured range (e.g. the header row
  // format changed) could look like "the whole sheet is now empty" and
  // wipe out every synced product — this guard prevents that.
  const deletionsEnabled = process.env.SHEETS_SYNC_DELETE_MISSING !== "false";
  if (deletionsEnabled && seenSkus.size > 0) {
    try {
      summary.deleted = await deleteMissingSkus(seenSkus);
    } catch (err) {
      summary.errors.push(`Deletion pass failed: ${err.message}`);
      console.error("[sheets-sync] deletion pass failed:", err);
    }
  } else if (deletionsEnabled && seenSkus.size === 0) {
    summary.errors.push("Skipped deletion pass: no valid rows synced this run (safety guard).");
  }

  const ms = Date.now() - startedAt;
  console.log(
    `[sheets-sync] done in ${ms}ms — created ${summary.created}, updated ${summary.updated}, ` +
    `deleted ${summary.deleted}, skipped ${summary.skipped}, images +${summary.imagesAdded} (${summary.imagesFailed} failed)`
  );
  if (summary.errors.length) {
    console.warn("[sheets-sync] issues:\n" + summary.errors.map((e) => ` - ${e}`).join("\n"));
  }
  return summary;
}