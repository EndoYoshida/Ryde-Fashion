# Ryde Fashion

Ryde Fashion is a full-stack e-commerce prototype for authentic bags and apparel.

## Tech Stack

- Frontend: React + Vite
- Backend: Express.js
- Database: SQLite
- Authentication: Customer accounts + Google Sign-In
- Admin Dashboard: Product, order, customer, and support management

## Project Structure

```text
/
├── src/        # React storefront
└── server/     # Express API + SQLite database
    └── sync/   # Google Sheets/Drive product sync (optional)
```

## Running the Project

The frontend and backend run separately.

### Backend

```bash
cd server
npm install
npm run dev
```

Backend runs at `const SERVER_ORIGIN = "https://gcdf9f43-4000.asse.devtunnels.ms";`.

### Frontend

Open a second terminal in the project root:

```bash
npm install
npm run dev
```

Frontend normally runs at `http://localhost:5173`.

## Main Features

### Storefront

- Product browsing and product images
- Product ratings
- Shopping cart and wishlist
- Customer accounts
- Checkout and payment proof upload
- Order history
- Customer support tickets
- Email verification
- Google Sign-In

### Admin Dashboard

- Add, edit, and delete products
- Manage product images
- View and manage orders
- View customers
- Manage support tickets
- Reply to customers by email
- Update order and payment status

## Customer Accounts

Customers can:

- Sign up with email and password
- Sign in with email or username
- Sign in with Google
- Edit their profile
- Change their password
- View orders and support tickets
- Verify their email
- Delete their account

Passwords are securely hashed on the server.

## Payments

Checkout currently supports:

- GCash
- BDO
- UnionBank
- Cash on Delivery

GCash and bank payments use manual payment verification through uploaded proof.

The payment account details in `src/components/Checkout.jsx` are placeholders and should be replaced with the real business details.

Automatic payment processing is not implemented yet.

## Email Setup

Email features require a Gmail App Password and are used for:

- Email verification codes
- Order receipts
- Support ticket emails
- Admin replies

Add the credentials to `server/.env`:

```env
EMAIL_USER=your-email@gmail.com
EMAIL_APP_PASSWORD=your-app-password
```

Never commit `server/.env` to GitHub.

## Google Sign-In

For local development, add:

```text
http://localhost:5173
```

to the Google OAuth Client ID's **Authorized JavaScript origins**.

Keep sensitive credentials in `server/.env`.

## Google Sheets Product Sync (optional)

Products can be managed in a Google Sheet — with photos stored in Google
Drive — instead of (or alongside) the admin dashboard. On a schedule, the
server reads the Sheet and creates/updates/removes products to match it.

Quick summary:

- Requires a free Google Cloud service account (read-only access to your
  Sheet and Drive folder).
- Matches rows to products by a required `sku` column, so re-syncing is
  safe and idempotent.
- Downloads any Drive-linked photos into `server/uploads/` automatically.
- Triggers the same "new product" / "back in stock" customer emails a
  manual admin edit would.
- Can run on a built-in interval inside the server, or as a one-off
  script (`npm run sync:sheet`) suitable for an external/OS cron job.

Full setup steps, the exact sheet column layout, image sizing guidance,
and troubleshooting live in
[`server/sync/README-SHEETS-SYNC.md`](server/sync/README-SHEETS-SYNC.md).

New env vars this adds to `server/.env` (all optional — the feature is
off unless configured): `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`,
`SHEETS_SYNC_SHEET_ID`, `SHEETS_SYNC_RANGE`, `SHEETS_SYNC_ENABLED`,
`SHEETS_SYNC_INTERVAL_MINUTES`, `SHEETS_SYNC_DELETE_MISSING`.

**Never commit `server/sync/service-account.json`** — it's a credential,
same as `server/.env`.

## Automatic Bestsellers

Products can be automatically flagged as "Bestseller" based on real,
paid order history (top sellers over a trailing window), instead of
relying only on manually tagging them in the admin dashboard. Runs on a
schedule with no external setup required — details, tuning options, and
how it interacts with manual tagging are in
[`server/bestsellers/README-BESTSELLERS.md`](server/bestsellers/README-BESTSELLERS.md).

## Database

The project uses SQLite at:

```text
server/db/ryde.sqlite
```

Main tables:

- `products`
- `product_images`
- `orders`
- `order_items`
- `customers`
- `tickets`

Data is persistent and remains after restarting the server.

## Reset Database

Delete these files to start with a fresh database:

```text
server/db/ryde.sqlite
server/db/ryde.sqlite-shm
server/db/ryde.sqlite-wal
```

Then restart the backend:

```bash
cd server
npm run dev
```

## Security

The backend includes:

- Server-side authentication
- Password hashing with `crypto.scrypt`
- Optional MFA (TOTP) on the admin login — see `node scripts/generate-totp-secret.js`
- Admin and customer session protection
- CORS restrictions
- Helmet security headers
- API rate limiting
- Server-side order and price validation
- Customer data access restrictions
- Parameterized SQL everywhere (no string-concatenated queries), so
  standard SQL injection isn't possible against this codebase as-is

## Development Limitations

This is currently a local-development prototype.

Before public deployment, configure:

- HTTPS
- Production CORS origins
- Secure environment variables
- Production database/access controls
- Real payment gateway credentials

## Social Links

- Facebook: `facebook.com/RSfinelady`
- TikTok: `tiktok.com/@ryde.luxury`
- Instagram: not configured
- Support email: `rydecompany.ph@gmail.com`

## Important Notes

- Do not commit `server/.env`.
- Do not commit `server/sync/service-account.json` (if using the Google
  Sheets product sync).
- Replace placeholder payment information before public use.
- Google OAuth must use the correct frontend origin.
- Email features require a Gmail App Password.
- GCash and bank payments are manual, not automatic.
- Additional production security configuration is required before public deployment.
