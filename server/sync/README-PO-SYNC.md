# Orders → Google Sheets push (PO Register / PO Items / Dashboard)

Mirrors every placed order out to the **same spreadsheet** used by the
[Products sync](./README-SHEETS-SYNC.md), as two more tabs — so
products, purchase orders, and a live dashboard all live in one Google
Sheet, the way the reference PO tracker did. Unlike the Products sync
(which *pulls* into the site), this direction only *pushes*: the
site's own database stays the source of truth, and nothing is ever
read back from these tabs.

- **PO Register** — one row per order, updated in place as its status
  or payment status changes.
- **PO Items** — one row per line item, written once when the order
  is placed.
- **PO Dashboard** — not written by the server at all. It's just
  Sheets formulas reading the two tabs above, so it updates live as
  new rows come in. Set it up once by hand (step 3 below).

Field-wise, this only carries what checkout actually collects — no
Facebook/IG, city/province, landmark, or tracking-number columns, since
those aren't fields in this store's order form. If you want those
later, they'd need to be added to the checkout form and `orders` table
first.

## 1. Reuse (or set up) the Products sync's service account

If `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` and `SHEETS_SYNC_SHEET_ID` are
already set up per [README-SHEETS-SYNC.md](./README-SHEETS-SYNC.md),
you're most of the way there — this reuses the same credentials and
the same spreadsheet. Just confirm the service account has **Editor**
access on the sheet (it needs write access either way, for the stock
write-back), which step 2 of that guide already covers.

If you haven't set up Sheets sync at all yet, follow that guide's
steps 1–2 first, then come back here.

## 2. Add the two tabs

In your existing spreadsheet, add two new tabs (bottom-left `+`)
named exactly `PO Register` and `PO Items`, laid out with a **title
row in row 1** and the **column headers in row 2** (matching your
existing Products/screenshots style) — data rows start at row 3:

**`PO Register`** — row 2 headers:

| PO Number | Order Date | Order Status | Payment Status | Mode of Payment | Customer Name | Contact Number | Email Address | Complete Address | Total |
|---|---|---|---|---|---|---|---|---|---|

**`PO Items`** — row 2 headers:

| PO Number | Item No. | Product Description | Brand | Category | Qty | Unit Price | Line Total | Lookup Key |
|---|---|---|---|---|---|---|---|---|

You don't actually have to type these headers in yourself — the first
time the server pushes an order, it checks whether row 2 of each tab
already has headers and writes them automatically if not (leaving row
1 alone, so your own title banner there is untouched). Typing them in
ahead of time just lets you set column widths/formatting first if
you'd like.

Leave both tabs otherwise empty — every row from row 3 onward is
written by the server as orders come in.

## 3. Add a "PO Dashboard" tab (optional but recommended)

Add a third tab, **`PO Dashboard`**, with formulas reading straight
from `PO Register`. Your `PO Register`/`PO Items` tabs use a two-row
header (a title banner in row 1, column labels in row 2), so data
starts at **row 3** — the formulas below are written for that. A
minimal version:

| | |
|---|---|
| Total POs | `=COUNTA('PO Register'!A3:A)` |
| Total Sales | `=SUM('PO Register'!J3:J)` |
| Total Paid | `=SUMIF('PO Register'!D3:D,"paid",'PO Register'!J3:J)` |
| Outstanding | `=SUM('PO Register'!J3:J)-SUMIF('PO Register'!D3:D,"paid",'PO Register'!J3:J)` |

Order status breakdown (matches this store's actual statuses — see
`ORDER_STATUS_OPTIONS` in `src/data/orders.js`):

| Status | Count |
|---|---|
| pending | `=COUNTIF('PO Register'!C3:C,"pending")` |
| approved | `=COUNTIF('PO Register'!C3:C,"approved")` |
| shipped | `=COUNTIF('PO Register'!C3:C,"shipped")` |
| delivered | `=COUNTIF('PO Register'!C3:C,"delivered")` |
| cancelled | `=COUNTIF('PO Register'!C3:C,"cancelled")` |

Payment status breakdown (matches `PAYMENT_STATUS_OPTIONS`):

| Status | Count |
|---|---|
| pending | `=COUNTIF('PO Register'!D3:D,"pending")` |
| paid | `=COUNTIF('PO Register'!D3:D,"paid")` |
| failed | `=COUNTIF('PO Register'!D3:D,"failed")` |

Because these are live formulas over the `PO Register` range, the
dashboard updates itself the moment the server appends or edits a row
— no extra sync step needed.

## 4. Configure the server

Nothing new is *required* if Products sync is already configured —
this piggybacks on `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` and
`SHEETS_SYNC_SHEET_ID`. Optional overrides in `server/.env`:

```
# only if you renamed the tabs from the defaults
SHEETS_SYNC_PO_REGISTER_RANGE=PO Register
SHEETS_SYNC_PO_ITEMS_RANGE=PO Items

# set to "false" to turn this off entirely
SHEETS_SYNC_PUSH_PO=true
```

Restart the server after changing `.env`.

## What it does, and when

- **On checkout (`POST /api/orders`)**: appends one row to `PO
  Register` and one row per item to `PO Items`.
- **On admin status/payment-status change**: finds that order's
  existing `PO Register` row (matched by PO Number) and updates just
  the Order Status or Payment Status cell — it never re-appends a
  duplicate row.
- If an order's `PO Register` row can't be found when a status change
  comes in (e.g. it was placed before this was turned on, or the row
  was deleted by hand), the row is created fresh instead.
- Every one of these is fire-and-forget, exactly like the stock
  write-back and the receipt email: if the Sheets API is briefly
  unreachable, misconfigured, or the service account lost access, the
  order or status change still goes through on the site — you'll just
  see a `didn't push PO to sheet: ...` warning in the server log.

## Downloadable PO (per order)

Separately from the sheet, each order in the admin dashboard's
**Orders** tab has a **Download PO** button that opens a printable
purchase order (in the site's own branding) in a new tab — use the
browser's Print dialog and "Save as PDF" to download it. This doesn't
touch Google Sheets at all; it's generated straight from the order
data already loaded in the dashboard.

## Troubleshooting

Same causes/fixes as the Products sync's troubleshooting section
apply here (404 reading the sheet almost always means it isn't shared
with the service account's email, or a tab name doesn't match). See
[README-SHEETS-SYNC.md](./README-SHEETS-SYNC.md#troubleshooting).
