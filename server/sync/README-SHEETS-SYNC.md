# Google Sheets → Products sync

Lets you manage products in a Google Sheet (with photos in Google Drive)
and have them automatically appear/update in the store. It's a **pull**
sync: on a schedule, the server reads your Sheet and updates the local
`products` table (the same one the admin dashboard and `/api/products`
already use) — it doesn't touch the Sheet itself.

## 1. Set up a Google Cloud service account

This is a "robot" Google account your server authenticates as. It's free
and doesn't require enabling billing for read-only Sheets/Drive access.

1. Go to https://console.cloud.google.com/ and create a project (or pick
   an existing one).
2. **APIs & Services → Library**: enable both the **Google Sheets API**
   and **Google Drive API**.
3. **APIs & Services → Credentials → Create Credentials → Service account**.
   Give it any name (e.g. "ryde-sheet-sync"). No roles/permissions needed
   at the project level.
4. Open the service account you just created → **Keys** tab → **Add Key
   → Create new key → JSON**. This downloads a `.json` file — save it as
   `server/sync/service-account.json`.
   - **This file is already covered by `server/.gitignore`'s `*.env`-style
     rules only if you check — if not, add `sync/service-account.json` to
     `server/.gitignore` yourself.** Treat it like a password: never commit it.
5. Open that JSON file and copy the `client_email` value (looks like
   `ryde-sheet-sync@your-project.iam.gserviceaccount.com`).

## 2. Share your Sheet and Drive photos with the service account

- Open your Google Sheet → **Share** → paste in the `client_email` from
  above → give it **Viewer** access.
- If your product photos are in a Drive folder, share that folder with
  the same email (Viewer access). Individual files work too, but a
  shared folder is easier to maintain.

## 3. Set up the Sheet

Create (or reuse) a tab — default name **`Products`** — with a header
row using these column names (order doesn't matter, matching is
case-insensitive):

| sku | name | brand | category | price | old_price | stock | status | description | weight | tag | images |
|-----|------|-------|----------|-------|-----------|-------|--------|--------------|--------|-----|--------|
| RY-001 | Classic Tote | Ryde | Bags | 1499 | 1899 | 12 | available | Everyday canvas tote | 0.4 | New | https://drive.google.com/file/d/1AbC.../view, 1XyZ... |

Notes:
- **`sku` is required and must be unique per product** — it's how the
  sync recognizes "this row already exists, update it" vs "this is a new
  product." Without it, re-running the sync would create duplicates. Pick
  any scheme you like (a real SKU, or just `1`, `2`, `3`...).
- `category` must be one of: `bags`, `apparel`, `shoes`, `watches`,
  `perfume`, `makeup`, `wallets`, `accessories` (these match the site's
  fixed category list in `src/data/products.js`). Anything else gets
  skipped with an "unknown category" note in the sync summary rather than
  silently creating a product with no icon. **Set up a dropdown on this
  column in the sheet** (Data → Data validation → Dropdown, using those
  8 values, with "Reject input" on) so no one can type a typo in by hand.
- `name`, `brand`, `category`, `price` are required; everything else is
  optional and defaults sensibly (`status` → `available`, `stock` → `0`,
  `weight` → `0.3`).
- `status` must be one of: `available`, `sold-out`, `coming-soon`,
  `unavailable` (matches `STATUS_OPTIONS` in `src/data/products.js`).
  Set up a dropdown here too (Data → Data validation → Dropdown, those
  4 values, "Reject input" on).
- `tag` is optional — leave the cell blank for no tag, or use exactly
  `New` or `Bestseller` (capitalized, matching what the homepage counts
  under "New Arrivals" / "Best Sellers"). A dropdown works well here too:
  add `New` and `Bestseller` as the two options, and just leave cells
  blank for products that shouldn't have either.
- `weight` is in **kilograms**, used to calculate J&T Express shipping
  cost at checkout (`src/components/Checkout.jsx`) — e.g. `0.2`–`0.3` for
  something small like a wallet or perfume bottle, `0.4`–`0.8` for a bag,
  `0.6`–`1.0` for shoes. Leaving it blank defaults to `0.3`, so it's worth
  getting right for heavier items rather than relying on the default.
- `images` accepts one or more Drive file links or bare file IDs,
  separated by commas. Already-synced images aren't re-downloaded on
  later runs, so it's safe to leave old links in place.
  - **Use square (1:1) photos, ideally around 1000×1000px.** The
    storefront displays product photos in a fixed square frame and
    crops to fill it (centered) — a non-square photo won't get resized
    to fit, it gets cropped, so anything not centered in the original
    shot (a bag's handle, a shoe's toe, etc.) can end up cut off.
    Cropping the photo to a square yourself before uploading to Drive
    is the safest way to control exactly what shows.
  - Max file size is 8MB per image.
- `price`/`old_price` are treated as whole numbers (matching how the rest
  of the app stores prices — check `AdminProducts.jsx` for the currency
  formatting it expects).

## 4. Configure the server

In `server/.env`, set:

```
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./sync/service-account.json
SHEETS_SYNC_SHEET_ID=<the long ID from your Sheet's URL>
```

The Sheet ID is the part of the URL between `/d/` and `/edit`:
`https://docs.google.com/spreadsheets/d/`**`1a2B3c...xyz`**`/edit`

## 5. Install the new dependency

```
cd server
npm install
```

## 6. Run it

**Manual test run** (does one sync and exits, prints a summary):

```
npm run sync:sheet
```

**Automatic, on a schedule** — pick ONE of these two options:

- **Built into the server** (simplest): set `SHEETS_SYNC_ENABLED=true`
  and optionally `SHEETS_SYNC_INTERVAL_MINUTES=15` in `server/.env`, then
  restart the server (`npm start` / `npm run dev`). It'll sync once at
  startup and every N minutes after.

- **OS-level cron job** (if your host doesn't keep a long-running Node
  process, or you want the sync to run outside your app's lifecycle):
  ```
  */15 * * * * cd /path/to/ryde-storefront/server && npm run sync:sheet >> sync.log 2>&1
  ```
  Leave `SHEETS_SYNC_ENABLED` unset/`false` in this case, so you don't
  end up with two things syncing at once.

## What it does

- Creates a new product for each new `sku`, updates existing ones on
  every run (price/stock/etc. changes in the Sheet flow through).
- Downloads any new Drive images into `server/uploads/` and attaches
  them the same way the admin dashboard's image upload does.
- **Deletes products whose row was removed from the sheet** (matched by
  `sku`) — only products that came from a sync (i.e. have a `sku`) are
  ever candidates, so anything created by hand in the admin dashboard is
  never touched by this. If you'd rather just hide a product than have
  it deleted, set its `status` column to `unavailable` in the sheet
  instead of removing the row.
  - As a safety net, deletion is skipped entirely if a sync run doesn't
    successfully match *any* rows (e.g. a misconfigured range or a
    transient API error) — that prevents a bad run from reading as "the
    sheet is empty" and wiping every synced product. You'll see a note
    about this in the sync's error/summary output if it happens.
  - Set `SHEETS_SYNC_DELETE_MISSING=false` in `server/.env` to disable
    deletion entirely and just leave removed-from-sheet products in place.
- **Triggers the same customer emails a manual admin edit would**
  (`server/email.js`): new products email your newsletter subscribers,
  and restocking a product (going from out-of-stock/unavailable to
  available with stock > 0) emails anyone who has it wishlisted.
- Never writes back to the Sheet — it's read-only from Sheets/Drive's
  perspective.

## Customizing category colors

Each category in `src/data/products.js` has a `color` field, used for
its icon on the homepage and its filter chip on the shop page. Edit the
hex value there to change a category's color — it's a frontend-only
setting and has no effect on the sheet or sync.

## Troubleshooting

**`GaxiosError: Requested entity was not found` (404) reading the sheet**
Almost always means the Sheet hasn't been shared with the service
account's email yet (step 2 above), or the tab name doesn't match
`SHEETS_SYNC_RANGE` (default `Products`). Double-check both, then
re-run — Google's permission changes can take a minute or two to apply.

**`SqliteError: table products has no column named weight`**
Your database was created before the `weight` column existed in
`db/schema.sql`. New databases get it automatically; an existing
`ryde.sqlite` needs it added once by hand:
```
node -e "const db=require('better-sqlite3')('./db/ryde.sqlite'); db.exec('ALTER TABLE products ADD COLUMN weight REAL NOT NULL DEFAULT 0.3');"
```
(run from `server/`, with the server stopped first). This is a
one-time fix — unrelated to the sheet sync specifically, but the sync
will hit it too until it's applied.

**`SqliteError: FOREIGN KEY constraint failed` when deleting a product**
The product has past orders referencing it (`order_items.product_id`),
and deleting it would orphan that order history, so SQLite blocks it.
Set the product's `status` to `unavailable` instead of deleting it —
both in the admin dashboard and in the sheet.
