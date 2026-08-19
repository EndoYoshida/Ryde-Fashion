import { db } from "../db/index.js";
import { getSheetsClient } from "./googleAuth.js";
import { extractDriveFileId, downloadDriveImage } from "./driveImages.js";
import { runSheetsSyncMigration } from "./migrate.js";

runSheetsSyncMigration();

// Sheet tab + range to read. Override via env if your tab isn't named
// "Products" or you want to cap how many rows get scanned.
const SHEET_RANGE = process.env.SHEETS_SYNC_RANGE || "Products";

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

function upsertProduct(record) {
  if (!record.sku) {
    return { skipped: true, reason: "missing sku" };
  }
  if (!record.name || !record.brand || !record.category || record.price === undefined) {
    return { skipped: true, reason: "missing required field (name/brand/category/price)" };
  }

  const price = toIntOrNull(record.price);
  if (price === null) return { skipped: true, reason: "invalid price" };

  const existing = db.prepare("SELECT id FROM products WHERE sku = ?").get(record.sku);

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
    db.prepare(`
      UPDATE products SET name=?, brand=?, category=?, price=?, old_price=?, stock=?, status=?, tag=?, description=?, weight=?
      WHERE id=?
    `).run(
      values.name, values.brand, values.category, values.price, values.old_price,
      values.stock, values.status, values.tag, values.description, values.weight,
      existing.id
    );
    productId = existing.id;
  } else {
    const result = db.prepare(`
      INSERT INTO products (sku, name, brand, category, price, old_price, stock, status, tag, description, weight, rating, reviews)
      VALUES (@sku, @name, @brand, @category, @price, @old_price, @stock, @status, @tag, @description, @weight, 0, 0)
    `).run({ sku: record.sku, ...values });
    productId = result.lastInsertRowid;
  }

  return { skipped: false, productId, created: !existing };
}

function hasDriveImage(productId, driveFileId) {
  return Boolean(
    db.prepare("SELECT id FROM product_images WHERE product_id = ? AND drive_file_id = ?")
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
  const maxOrderRow = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM product_images WHERE product_id = ?").get(productId);
  let nextOrder = maxOrderRow.m + 1;

  for (const fileId of fileIds) {
    if (hasDriveImage(productId, fileId)) continue; // already synced, skip re-download
    try {
      const filename = await downloadDriveImage(fileId);
      db.prepare(
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

export async function runSheetsSync() {
  const startedAt = Date.now();
  const summary = { created: 0, updated: 0, skipped: 0, imagesAdded: 0, imagesFailed: 0, errors: [] };

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
      const result = upsertProduct(record);
      if (result.skipped) {
        summary.skipped++;
        summary.errors.push(`Row for sku="${record.sku || "?"}" skipped: ${result.reason}`);
        continue;
      }
      if (result.created) summary.created++;
      else summary.updated++;

      const { added, failed } = await syncImagesForProduct(result.productId, record.images);
      summary.imagesAdded += added;
      summary.imagesFailed += failed;
    } catch (err) {
      summary.skipped++;
      summary.errors.push(`Row for sku="${record.sku || "?"}" failed: ${err.message}`);
      console.error("[sheets-sync] row failed:", err);
    }
  }

  const ms = Date.now() - startedAt;
  console.log(
    `[sheets-sync] done in ${ms}ms — created ${summary.created}, updated ${summary.updated}, ` +
    `skipped ${summary.skipped}, images +${summary.imagesAdded} (${summary.imagesFailed} failed)`
  );
  if (summary.errors.length) {
    console.warn("[sheets-sync] issues:\n" + summary.errors.map((e) => ` - ${e}`).join("\n"));
  }
  return summary;
}
