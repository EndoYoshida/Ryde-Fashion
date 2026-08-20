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

// PO Register columns, in order. Trimmed to only what the storefront
// actually captures for an order — see README-PO-SYNC.md for why this
// differs from a generic PO template (no separate Facebook/IG, city,
// province, landmark, or tracking-number fields, since none of that is
// collected at checkout).
const REGISTER_HEADERS = [
  "PO Number", "Order Date", "Order Status", "Payment Status",
  "Mode of Payment", "Customer Name", "Contact Number", "Email Address",
  "Complete Address", "Total",
];

const ITEMS_HEADERS = [
  "PO Number", "Item No.", "Product Description", "Brand", "Category",
  "Qty", "Unit Price", "Line Total", "Lookup Key",
];

function isPushEnabled() {
  if (!isSheetsSyncConfigured()) return false;
  return process.env.SHEETS_SYNC_PUSH_PO !== "false";
}

function registerRowValues(order) {
  return [
    order.id,
    order.date,
    order.status,
    order.paymentStatus,
    order.paymentMethod || "",
    order.customer,
    order.phone || "",
    order.email,
    order.address || "",
    order.total,
  ];
}

// Line items don't come with brand/category on the order_items row
// itself (only name/qty/price are captured at purchase time), so this
// looks them up from the product they came from, same as the reference
// PO template's "Brand / Model" / "Category" columns. Falls back to
// blank if the product was since deleted.
function itemRows(order) {
  const items = db.prepare(`
    SELECT oi.name, oi.qty, oi.price, p.brand, p.category
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
  `).all(order.id);

  return items.map((it, i) => {
    const itemNo = i + 1;
    return [
      order.id,
      itemNo,
      it.name,
      it.brand || "",
      it.category || "",
      it.qty,
      it.price,
      it.qty * it.price,
      `${order.id}|${itemNo}`,
    ];
  });
}

// Your sheet has a two-row header — a merged title banner in row 1
// ("RYDE PO Items" / "RYDE PO REGISTER") and the actual column labels
// in row 2 — so data starts at row 3. Everything below is anchored to
// that layout. If you ever rebuild the tabs with plain single-row
// headers instead, change HEADER_ROW to 1.
const HEADER_ROW = 2;

async function ensureHeaders(sheets, range, headers) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
    range: `${range}!${HEADER_ROW}:${HEADER_ROW}`,
  });
  const headerRow = (res.data.values || [])[0];
  if (headerRow && headerRow.length > 0) return; // already has a header row
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
    range: `${range}!A${HEADER_ROW}`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] },
  });
}

async function findRegisterRow(sheets, poNumber) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
    range: PO_REGISTER_RANGE,
  });
  const rows = res.data.values || [];
  const dataRows = rows.slice(HEADER_ROW); // skip title row + header row
  const idx = dataRows.findIndex((row) => (row[0] || "").toString().trim() === poNumber);
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
    await ensureHeaders(sheets, PO_REGISTER_RANGE, REGISTER_HEADERS);
    await ensureHeaders(sheets, PO_ITEMS_RANGE, ITEMS_HEADERS);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
      range: `${PO_REGISTER_RANGE}!A${HEADER_ROW}:J`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [registerRowValues(order)] },
    });

    const rows = itemRows(order);
    if (rows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEETS_SYNC_SHEET_ID,
        range: `${PO_ITEMS_RANGE}!A${HEADER_ROW}:I`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows },
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
// its Order Status and/or Payment Status cell(s) in place, rather than
// re-appending a duplicate row.
async function updateRegisterCell(order, columnIndex, value) {
  if (!isPushEnabled()) return { written: false, reason: "PO sheet push not configured/enabled" };

  try {
    const sheets = getSheetsClient();
    const rowNumber = await findRegisterRow(sheets, order.id);
    if (rowNumber == null) {
      // The order was placed before push-sync was turned on (or the
      // register row was deleted by hand) — nothing to update in place,
      // so fall back to creating it now.
      return pushOrderToSheet(order);
    }
    const colLetter = String.fromCharCode(65 + columnIndex); // A-J fits single letters
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

export const updateOrderStatusInSheet = (order) => updateRegisterCell(order, 2, order.status);
export const updatePaymentStatusInSheet = (order) => updateRegisterCell(order, 3, order.paymentStatus);
