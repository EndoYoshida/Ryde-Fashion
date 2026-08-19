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
- `name`, `brand`, `category`, `price` are required; everything else is
  optional and defaults sensibly (`status` → `available`, `stock` → `0`,
  `weight` → `0.3`).
- `images` accepts one or more Drive file links or bare file IDs,
  separated by commas. Already-synced images aren't re-downloaded on
  later runs, so it's safe to leave old links in place.
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

## What it does / doesn't do

- Creates a new product for each new `sku`, updates existing ones on
  every run (price/stock/etc. changes in the Sheet flow through).
- Downloads any new Drive images into `server/uploads/` and attaches
  them the same way the admin dashboard's image upload does.
- **Does not** delete products that get removed from the Sheet — if you
  want a product gone, mark it `status = unavailable` (or delete it in
  the admin dashboard instead).
- **Does not** trigger the "new product" or "back in stock" customer
  emails that manual admin edits trigger (`server/email.js`) — that's a
  deliberate scope cut to keep this first version simple; ask if you'd
  like that wired up too.
- Never writes back to the Sheet — it's read-only from Sheets/Drive's
  perspective.
