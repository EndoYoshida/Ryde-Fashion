import { db } from "../db/index.js";
import { getSheetsClient, isSheetsSyncConfigured } from "./googleAuth.js";

// Pushes placed orders into the SAME Google Sheet used by the
// Products pull sync (SHEETS_SYNC_SHEET_ID) — just two more tabs in
// it, "PO Register" and "PO Items", so everything (products, orders,
// dashboard) lives in one spreadsheet. This is a one-way *push*: the
// site's database is always the source of truth, this just mirrors it
// out for a printable/shareable view and the live dashboard formulas
// described in server/sync/README-PO-SYNC.md. Nothing here is ever
// read back into the site.
//
// Like the stock write-back in sheetsSync.js, every function here is
// fire-and-forget and swallows its own errors — a Sheets hiccup must
// never fail or slow down an order placement or status change.

const PO_REGISTER_RANGE = process.env.SHEETS_SYNC_PO_REGISTER_RANGE || "PO Register";
const PO_ITEMS_RANGE = process.env.SHEETS_SYNC_PO_ITEMS_RANGE || "PO Items";

// Default headers, written ONLY when a tab has no header row yet (a
// brand-new empty tab). Once a header row exists we never touch it again
// — every write below looks up each field's column by matching this
// label against whatever's actually in the sheet right now, so a client
// renaming, reordering, or deleting a column (e.g. dropping "Mode of
// Delivery") just means that one field gets skipped, instead of every
// field after it silently shifting into the wrong cell.
const REGISTER_HEADERS = [
  "PO Number", "Order Date", "Order Status", "Payment Status",
  "Mode of Payment", "Mode of Delivery", "Customer Name", "Contact Number",
  "Email Address", "Complete Address", "Total",
];

const ITEMS_HEADERS = [
  "PO Number", "Item No.", "Product Description", "Brand", "Category",
  "Qty", "Unit Price", "Line Total", "Lookup Key",
];

// field name -> the header label it matches in the sheet. Matched
// case-insensitively with all non-alphanumeric characters ignored (see
// normalizeHeader), so "Mode of Delivery", "mode_of_delivery", and
// "ModeOfDelivery" all resolve to the same field.
const REGISTER_FIELDS = {
  poNumber: "PO Number",
  orderDate: "Order Date",
  orderStatus: "Order Status",
  paymentStatus: "Payment Status",
  modeOfPayment: "Mode of Payment",
  modeOfDelivery: "Mode of Delivery",
  customerName: "Customer Name",
  contactNumber: "Contact Number",
  emailAddress: "Email Address",
  completeAddress: "Complete Address",
  total: "Total",
};

const ITEMS_FIELDS = {
  poNumber: "PO Number",
  itemNo: "Item No.",
  description: "Product Description",
  brand: "Brand",
  category: "Category",
  qty: "Qty",
  unitPrice: "Unit Price",
  lineTotal: "Line Total",
  lookupKey: "Lookup Key",
};

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Builds field -> 0-based column index from the sheet's actual current
// header row (not from REGISTER_HEADERS/ITEMS_HEADERS — those are only
// the defaults used to seed a brand-new empty tab). A field with no
// matching column is simply left out of the map.
function buildFieldMap(headerRow, fields) {
  const normalized = (headerRow || []).map(normalizeHeader);
  const map = {};
  for (const [field, label] of Object.entries(fields)) {
    const idx = normalized.indexOf(normalizeHeader(label));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

// 0-based column index -> Sheets letter (0 -> A, 25 -> Z, 26 -> AA, ...).
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

// Turns a field->value object into a full row array sized to cover every
// mapped column, placing each value at that field's real column and
// leaving any other column blank. A field with no entry in fieldMap
// (its header isn't in the sheet at all) is dropped silently instead of
// shifting into whatever cell happens to be next.
function valuesToRow(values, fieldMap) {
  const width = Object.values(fieldMap).reduce((max, i) => Math.max(max, i + 1), 0);
  const row = new Array(width).fill("");
  for (const [field, value] of Object.entries(values)) {
    const idx = fieldMap[field];
    if (idx != null) row[idx] = value;
  }
  return row;
}

function isPushEnabled() {
  if (!isSheetsSyncConfigured()) return false;
  return process.env.SHEETS_SYNC_PUSH_PO !== "false";
}

function registerRowFields(order) {
  return {
    poNumber: order.id,
    orderDate: order.date,
    orderStatus: order.status,
    paymentStatus: order.paymentStatus,
    modeOfPayment: order.paymentMethod || "",
    modeOfDelivery: [order.deliveryMethod, order.deliveryDetail].filter(Boolean).join(" - "),
    customerName: order.customer,
    // Written with valueInputOption: "USER_ENTERED" below, which makes Sheets
    // parse this exactly like manual keyboard entry. A phone number like
    // "+63 917 123 4567" starts with "+", so Sheets tries to read it as a
    // formula and shows a parse error; a plain "09171234567" gets read as a
    // number and silently loses its leading 0. A leading apostrophe is the
    // standard Sheets way to force a value to be treated as literal text —
    // it's stripped from what's displayed/stored, it just suppresses the
    // formula/number auto-detection.
    contactNumber: order.phone ? `'${order.phone}` : "",
    emailAddress: order.email,
    completeAddress: order.address || "",
    total: order.total,
  };
}

// Line items don't come with brand/category on the order_items row
// itself (only name/qty/price are captured at purchase time), so this
// looks them up from the product they came from, same as the reference
// PO template's "Brand / Model" / "Category" columns. Falls back to
// blank if the product was since deleted.
async function itemRowFields(order) {
  const items = await db.prepare(`
    SELECT oi.name, oi.qty, oi.price, p.brand, p.category
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
  `).all(order.id);

  return items.map((it, i) => {
    const itemNo = i + 1;
    return {
      poNumber: order.id,
      itemNo,
      description: it.name,
      brand: it.brand || "",
      category: it.category || "",
      qty: it.qty,
      unitPrice: it.price,
      lineTotal: it.qty * it.price,
      lookupKey: `${order.id}|${itemNo}`,
    };
  });
}

// Your sheet has a two-row header — a merged title banner in row 1
// ("RYDE PO Items" / "RYDE PO REGISTER") and the actual column labels
// in row 2 — so data starts at row 3. Everything below is anchored to
// that layout. If you ever rebuild the tabs with plain single-row
// headers instead, change HEADER_ROW to 1.
const HEADER_ROW = 2;

// Reads the tab's current header row, writing the canonical defaults
// only if that row is completely empty (a brand-new tab). An existing
// header row — however the client has since edited it — is always left
// exactly as-is; we adapt to it rather than overwrite it.
async function ensureHeaders(sheets, range, headers) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
    range: `${range}!${HEADER_ROW}:${HEADER_ROW}`,
  });
  const headerRow = (res.data.values || [])[0];
  if (headerRow && headerRow.length > 0) return headerRow; // already has a header row
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
    range: `${range}!A${HEADER_ROW}`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] },
  });
  return headers;
}

async function findRegisterRow(sheets, poNumber, poNumberColIdx) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
    range: PO_REGISTER_RANGE,
  });
  const rows = res.data.values || [];
  const dataRows = rows.slice(HEADER_ROW); // skip title row + header row
  const idx = dataRows.findIndex((row) => (row[poNumberColIdx] || "").toString().trim() === poNumber);
  return idx === -1 ? null : idx + HEADER_ROW + 1; // 1-indexed, right after the header row
}

// Called once, right after a new order is placed: appends one row to
// "PO Register" and one row per line item to "PO Items". Anchoring the
// append range at the header row (rather than the whole tab) tells the
// Sheets API where the actual table starts, so it appends right below
// the last data row — regardless of what's sitting in the title row above.
export async function pushOrderToSheet(order) {
  if (!isPushEnabled()) return { pushed: false, reason: "PO sheet push not configured/enabled" };

  try {
    const sheets = getSheetsClient();
    const registerHeaderRow = await ensureHeaders(sheets, PO_REGISTER_RANGE, REGISTER_HEADERS);
    const itemsHeaderRow = await ensureHeaders(sheets, PO_ITEMS_RANGE, ITEMS_HEADERS);
    const registerFieldMap = buildFieldMap(registerHeaderRow, REGISTER_FIELDS);
    const itemsFieldMap = buildFieldMap(itemsHeaderRow, ITEMS_FIELDS);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
      range: `${PO_REGISTER_RANGE}!A${HEADER_ROW}`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [valuesToRow(registerRowFields(order), registerFieldMap)] },
    });

    const itemFieldRows = await itemRowFields(order);
    if (itemFieldRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
        range: `${PO_ITEMS_RANGE}!A${HEADER_ROW}`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: itemFieldRows.map((f) => valuesToRow(f, itemsFieldMap)) },
      });
    }
    return { pushed: true };
  } catch (err) {
    console.error(`[po-sheet-sync] failed to push order ${order.id}:`, err.message);
    return { pushed: false, reason: err.message };
  }
}

// Called on every order/payment status change: finds the order's
// existing "PO Register" row (matched by PO Number) and updates just
// its Order Status and/or Payment Status cell in place, rather than
// re-appending a duplicate row.
async function updateRegisterCell(order, field, value) {
  if (!isPushEnabled()) return { written: false, reason: "PO sheet push not configured/enabled" };

  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
      range: `${PO_REGISTER_RANGE}!${HEADER_ROW}:${HEADER_ROW}`,
    });
    const headerRow = (res.data.values || [])[0] || [];
    const fieldMap = buildFieldMap(headerRow, REGISTER_FIELDS);
    const colIdx = fieldMap[field];
    const poNumberColIdx = fieldMap.poNumber;
    if (colIdx == null || poNumberColIdx == null) {
      return { written: false, reason: `sheet is missing the "${REGISTER_FIELDS[field]}" or "PO Number" column` };
    }

    const rowNumber = await findRegisterRow(sheets, order.id, poNumberColIdx);
    if (rowNumber == null) {
      // The order was placed before push-sync was turned on (or the
      // register row was deleted by hand) — nothing to update in place,
      // so fall back to creating it now.
      return pushOrderToSheet(order);
    }
    const colLetter = columnIndexToLetter(colIdx);
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
      range: `${PO_REGISTER_RANGE}!${colLetter}${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value]] },
    });
    return { written: true };
  } catch (err) {
    console.error(`[po-sheet-sync] failed to update order ${order.id}:`, err.message);
    return { written: false, reason: err.message };
  }
}

export const updateOrderStatusInSheet = (order) => updateRegisterCell(order, "orderStatus", order.status);
export const updatePaymentStatusInSheet = (order) => updateRegisterCell(order, "paymentStatus", order.paymentStatus);