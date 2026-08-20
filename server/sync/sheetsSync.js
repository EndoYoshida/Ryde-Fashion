import { db } from "../db/index.js";
import { deleteCloudinaryImage } from "../upload.js";
import { getSheetsClient, isSheetsSyncConfigured } from "./googleAuth.js";
import { extractDriveFileId, downloadDriveImage } from "./driveImages.js";
import { rowToProduct, notifyWishlistersBackInStock, notifySubscribersNewProduct } from "../routes/products.js";

// Sheet tab + range to read. Override via env if your tab isn't named
// "Products" or you want to cap how many rows get scanned.
const SHEET_RANGE = process.env.SHEETS_SYNC_RANGE || "Products";

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

const COLUMN_ALIASES = {
  sku: ["sku", "id", "productid"],
  name: ["name", "productname", "title"],
  brand: ["brand"],
  category: ["category"],
  price: ["price"],
  oldPrice: ["oldprice", "originalprice", "wasprice"],
  stock: ["stock", "quantity", "qty"],
  status: ["status"],
  description: ["description", "desc"],
  weight: ["weight"],
  tag: ["tag", "label"],
  images: ["images", "image", "photos", "photo", "drivelinks", "driveimages"],
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
    brand: get("brand")?.toString().trim(),
    category: get("category")?.toString().trim(),
    price: get("price"),
    oldPrice: get("oldPrice"),
    stock: get("stock"),
    status: get("status")?.toString().trim(),
    description: get("description")?.toString().trim(),
    weight: get("weight"),
    tag: get("tag")?.toString().trim(),
    images: get("images"),
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

async function fetchRows() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
    range: SHEET_RANGE,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return { fieldMap: {}, records: [] };

  const fieldMap = buildFieldMap(rows[0]);
  const records = rows.slice(1)
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

  const existing = await db.prepare("SELECT * FROM products WHERE sku = ?").get(record.sku);
  const wasOutOfStock = existing ? (existing.status !== "available" || existing.stock <= 0) : false;

  const values = {
    name: record.name,
    brand: record.brand,
    category: record.category,
    price,
    old_price: toIntOrNull(record.oldPrice),
    stock: toIntOrNull(record.stock) ?? 0,
    status: record.status || "available",
    tag: record.tag || null,
    description: record.description || null,
    weight: toFloatOrNull(record.weight) ?? 0.3,
  };

  let productId;
  if (existing) {
    await db.prepare(`
      UPDATE products SET name=?, brand=?, category=?, price=?, old_price=?, stock=?, status=?, tag=?, description=?, weight=?
      WHERE id=?
    `).run(
      values.name, values.brand, values.category, values.price, values.old_price,
      values.stock, values.status, values.tag, values.description, values.weight,
      existing.id
    );
    productId = existing.id;
  } else {
    const result = await db.prepare(`
      INSERT INTO products (sku, name, brand, category, price, old_price, stock, status, tag, description, weight, rating, reviews)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
      RETURNING id
    `).run(
      record.sku, values.name, values.brand, values.category, values.price, values.old_price,
      values.stock, values.status, values.tag, values.description, values.weight,
    );
    productId = result.lastInsertRowid;
  }

  return { skipped: false, productId, created: !existing, wasOutOfStock };
}

async function hasDriveImage(productId, driveFileId) {
  return Boolean(
    await db.prepare("SELECT id FROM product_images WHERE product_id = ? AND drive_file_id = ?")
      .get(productId, driveFileId)
  );
}

async function syncImagesForProduct(productId, imagesCell) {
  if (!imagesCell) return { added: 0, failed: 0 };
  const fileIds = String(imagesCell)
    .split(/[,\n]/)
    .map(extractDriveFileId)
    .filter(Boolean);

  let added = 0;
  let failed = 0;
  const maxOrderRow = await db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM product_images WHERE product_id = ?").get(productId);
  let nextOrder = maxOrderRow.m + 1;

  for (const fileId of fileIds) {
    if (await hasDriveImage(productId, fileId)) continue; // already synced, skip re-download
    try {
      const filename = await downloadDriveImage(fileId);
      await db.prepare(
        "INSERT INTO product_images (product_id, filename, sort_order, drive_file_id) VALUES (?, ?, ?, ?)"
      ).run(productId, filename, nextOrder++, fileId);
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
    if (rows.length < 2) return { written: false, reason: "sheet is empty" };

    const fieldMap = buildFieldMap(rows[0]);
    if (fieldMap.stock == null) return { written: false, reason: 'sheet has no "stock" column' };
    if (fieldMap.sku == null) return { written: false, reason: 'sheet has no "sku" column' };

    const dataRows = rows.slice(1);
    const rowIndex = dataRows.findIndex(
      (row) => (row[fieldMap.sku] || "").toString().trim() === sku
    );
    if (rowIndex === -1) return { written: false, reason: `sku "${sku}" not found in sheet` };

    const sheetRowNumber = rowIndex + 2; // +1 to skip the header row, +1 for 1-indexing
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

// Deletes products whose sku was previously synced but no longer appears
// in the sheet. Only ever touches rows that HAVE a sku — anything created
// by hand in the admin dashboard (sku is NULL there) is never a candidate,
// so this can't accidentally wipe out manually-added products.
async function deleteMissingSkus(seenSkus) {
  const allSynced = await db.prepare("SELECT id, sku FROM products WHERE sku IS NOT NULL").all();
  const toDelete = allSynced.filter((p) => !seenSkus.has(p.sku));

  let deleted = 0;
  for (const { id } of toDelete) {
    const images = await db.prepare("SELECT filename FROM product_images WHERE product_id = ?").all(id);
    await db.prepare("DELETE FROM products WHERE id = ?").run(id); // product_images cascades
    for (const { filename } of images) {
      deleteCloudinaryImage(filename);
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
    summary.deleted = await deleteMissingSkus(seenSkus);
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
