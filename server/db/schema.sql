-- Ryde Fashion database schema (PostgreSQL)
-- Converted from the original SQLite schema. Notes on conversion choices:
--  * INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
--  * 0/1 "boolean" INTEGER columns kept as INTEGER (not BOOLEAN) so the
--    existing app code (which compares to 0/1) doesn't need to change.
--  * TEXT timestamp columns keep DEFAULT-ing to an ISO-ish string via
--    to_char(now(), ...) instead of switching to TIMESTAMPTZ, so existing
--    code that treats created_at/date as strings keeps working unchanged.
--  * expires_at is BIGINT (epoch milliseconds) instead of INTEGER, since
--    Postgres INTEGER is 32-bit and would overflow.

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  old_price INTEGER,
  stock INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available',
  description TEXT,
  weight REAL NOT NULL DEFAULT 0.3,
  rating REAL NOT NULL DEFAULT 0,
  reviews INTEGER NOT NULL DEFAULT 0,
  tag TEXT,
  sku TEXT,
  auto_bestseller INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku) WHERE sku IS NOT NULL;

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  address TEXT,
  password_hash TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_code TEXT,
  verification_code_expires_at TEXT,
  address_line TEXT,
  barangay TEXT,
  city TEXT,
  province TEXT,
  zip_code TEXT,
  phone_country_code TEXT,
  firebase_uid TEXT,
  joined TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_firebase_uid ON customers(firebase_uid) WHERE firebase_uid IS NOT NULL;

CREATE TABLE IF NOT EXISTS product_ratings (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (product_id, customer_id)
);

CREATE TABLE IF NOT EXISTS product_images (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  drive_file_id TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  payment_method TEXT,
  proof_image TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  total INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD')
);

-- PayMongo: which Checkout Session (if any) this order's online payment
-- went through, and the id of the actual Payment once PayMongo reports it
-- paid via webhook. Nullable — orders paid by COD/manual GCash/bank proof
-- never get these set. Added with ADD COLUMN IF NOT EXISTS rather than in
-- the CREATE TABLE above so this applies cleanly to already-existing
-- databases too (schema.sql runs on every server boot).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paymongo_checkout_session_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paymongo_payment_id TEXT;

-- Mode of Delivery, e.g. "J&T", "Lalamove", "Pickup - Olongapo (LPO Store)",
-- "Meetup". delivery_detail holds anything extra that needs to travel with
-- it (which partner store, a meetup note) — kept separate from `address`
-- since pickup/meetup orders never collect a shipping address at all.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_detail TEXT;

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  price INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  date TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD')
);

CREATE TABLE IF NOT EXISTS ticket_replies (
  id SERIAL PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  email_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  expires_at BIGINT NOT NULL
);

-- Newsletter subscribers. Not tied to a customer account — anyone can
-- subscribe with just an email from the footer form. `unsubscribed` is
-- kept as a flag rather than deleting the row, so re-subscribing with
-- the same address doesn't fight the UNIQUE constraint.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- A signed-in customer's saved wishlist, persisted server-side (rather
-- than only in browser state) so it survives across devices/sessions and
-- so we know who to email when a wishlisted item is back in stock.
CREATE TABLE IF NOT EXISTS wishlist_items (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (customer_id, product_id)
);
