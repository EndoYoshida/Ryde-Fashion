# Ryde Fashion & Authentic Bags and Apparel

A full-stack prototype: a React storefront + a separate admin dashboard,
backed by a real Express API and a SQLite database. Products, images,
orders, customer accounts, and support tickets all persist — refreshing
the page no longer resets anything.

## Project layout

```
/                    the React storefront (Vite)
/server              the Express API + SQLite database
```

They're two separate apps that run side by side. You'll need **two terminals**.

## 1. Start the backend

```bash
cd server
npm install
npm run dev
```

First run creates `server/db/ryde.sqlite` and seeds it with demo products,
orders, customers, and support tickets. You should see:

```
New database created at .../ryde.sqlite — seeding initial data...
Seed complete.
Ryde API running at http://localhost:4000
```

On every run after that, it just reuses the existing database.

## 2. Start the frontend

In a **second terminal**, from the project root:

```bash
npm install
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`). If the backend
isn't running, you'll see a small banner at the top of the page.


**Leaving logs you out — every time, on purpose.** The sidebar's
"Log out & return to store" is the only way back to the shop from inside
admin, and it always ends the session, even if you just meant to peek at
the storefront for a second. There's no way to bounce back and forth
between admin and the shop while staying logged in — you'd have to type
the URL and log in again. That's deliberate: it means a browser tab left
open on the storefront is never one click away from admin access.

**Other protections:**
- Credentials are checked on the **server**, never shipped in the
  frontend's JS bundle — can't be read via dev tools or "view source".
- Login issues a random session token stored in this tab's
  `sessionStorage` (not `localStorage`) — gone when the tab closes.
- Every admin API route requires that token; without it the server
  returns `401`, regardless of what URL you know.
- 5 failed login attempts locks that IP out for 5 minutes.
- Sessions expire after 4 hours of inactivity.

**Honest limits:** one hardcoded username/password (not per-admin
accounts), no HTTPS in local dev, and typing `/admin` directly still
*shows the login screen* to anyone who tries it — the URL itself isn't
secret, only what's behind the login is protected. Fine for testing on
your machine; don't expose this as-is on the open internet.

**What's inside:**
- **Products** — add, edit, delete, upload multiple photos per product
  (drag no, click yes). For existing products, uploads/removals save
  instantly. New products upload their photos right after creation.
- **Orders** — every real checkout creates a row here automatically.
- **Customers** — real signups from the storefront show up here, with
  live order count and total spent computed from actual orders.
- **Support** — tickets seeded on first run, plus **real emails sent to
  your support inbox automatically turn into tickets here**, and you can
  reply to a customer directly from the dashboard — it sends a real
  email back to them. See "Email setup" below; this needs one thing
  from you before it actually works. Customers can submit tickets
  through the new **Support page** on the storefront (nav bar → Support,
  or footer → Contact us) and see the whole conversation, replies
  included, from their account.

## Customer Support page

A real page on the storefront (not just a mailto link) — accessible from
the header nav ("Support") or footer ("Contact us"). Customers fill in
name, email, subject, and message; it creates a real support ticket the
same way an emailed-in message does, and shows up instantly in the admin
Support tab. If the customer is signed in, they can see the whole thread
— their original message plus every admin reply — from Account → My
Support Tickets.

## Email verification

Signing up sends a real 6-digit verification code by email (needs the
same email setup as above). The account works immediately either way —
verification isn't a hard gate — but a **"Please verify your email"**
banner shows on every page until it's done. Two ways to verify:
Account → Profile has a small **Verify** button right next to the email
field, or use the dedicated Account → Verify Email tab (code entry +
resend). Google sign-in accounts skip this entirely, since Google
already confirmed that email belongs to them.

**Codes expire after 30 minutes.** An expired code shows a clear "that
code has expired, resend" message rather than just silently failing —
tap Resend to get a new one.

## Delete Account

Account → Delete Account. Always requires the current password to
confirm. **If the email is verified**, there's an extra step: a
confirmation code is emailed first, and the account isn't deleted until
that code is entered too (same 30-minute expiry as verification codes).
Unverified accounts skip the email step, since there's no confirmed
inbox to send it to — password confirmation alone is enough.

What actually happens on delete: the account, profile, and any product
ratings that customer left are permanently removed (product averages
recalculate automatically once their rating disappears). Past orders
and support tickets stay on record — they're matched by email/name
text rather than a hard link to the account, which is normal for
business record-keeping even after someone deletes their login.

## Email setup — needed for support tickets, verification, and receipts

Three features share this one setup: **support ticket import/reply**,
**signup verification codes**, and **order receipt emails**. All of it
is fully built and wired, but needs one thing from you: a **Gmail App
Password** for `rydecompany.ph@gmail.com`
(or whichever inbox you want to use). Your regular Gmail password won't
work here — Google blocks that for security — an App Password is a
separate 16-character code made specifically for apps like this one.

**How to generate one:**
1. Make sure 2-Step Verification is turned on for the Google account
   (Google Account → Security → 2-Step Verification). App Passwords
   don't exist without it.
2. Go to **myaccount.google.com/apppasswords**
3. Create a new app password (name it anything, e.g. "Ryde Server")
4. Google shows you a 16-character code — copy it
5. Open `server/.env` and paste it in:
   ```
   EMAIL_APP_PASSWORD=the16charactercode
   ```
6. Restart the backend (`npm run dev` in `/server`)

You should see this in the server's terminal output once it's working:
```
Checking rydecompany.ph@gmail.com for new support emails every 60s.
```
If instead you see a warning about `EMAIL_USER`/`EMAIL_APP_PASSWORD` not
being set, the password hasn't been added yet — support tickets won't
import from email and replies won't actually send (they still save in
the dashboard, just flagged as "not emailed", so nothing is lost).

**What this gives you once configured:**
- Any email sent to that inbox becomes a support ticket automatically,
  checked every 60 seconds — customer name/email/subject/body pulled
  right from the email.
- Replying to a ticket from the admin dashboard sends a real email back
  to the customer, from that same inbox.
- Each incoming email is tracked by its Message-ID so re-checking the
  inbox never creates duplicate tickets.

**Limitation worth knowing:** this is one-way threading — if a customer
replies to your reply, that follow-up email creates a **new** ticket
rather than attaching to the original conversation. True email
threading (matching follow-ups to the right ticket) is a good next step
if this becomes something you rely on daily.

## Customer accounts — real signup/login, on the storefront

Click the person icon in the header. This is a completely separate
system from admin login — regular customers, not staff.

- **Sign up** with name (min. 3 characters), username (min. 3, max 20 —
  letters, numbers, underscore, period), email, and a password that must
  be at least 8 characters and include an uppercase letter, a number,
  and a special character. A live strength meter (Weak/Average/Strong)
  shows as you type, and every password field has a show/hide toggle.
  Creates a real row in the `customers` table with a securely hashed
  password (Node's built-in `crypto.scrypt`, salted per user — no
  plaintext passwords stored, ever). These same password rules apply to
  changing your password from the account dashboard too.
- **Sign in** with either your **email or username**, plus password.
  There's no lockout on the customer login — instead, if the email or
  username isn't registered at all, the error says so directly and
  offers a one-click link to sign up instead of a generic "invalid
  credentials" message. A wrong password on a real account still just
  says the password is incorrect.
- Session token is saved in `localStorage` (not `sessionStorage`) since,
  unlike admin, customers expect to stay signed in across visits.
- **Sign in with Google** is real — it uses Google Identity Services and
  verifies the token on the server. First-time Google sign-ins
  auto-create an account (no password needed, since Google is doing the
  authenticating); if that email already has a password-based account,
  signing in with Google just logs into that same account.
  - The **Client ID** is public and lives in `src/googleConfig.js` —
    that's normal, Google Client IDs are meant to be embedded in
    frontend code, the same way a website's URL is public.
  - The **Client Secret** lives only in `server/.env` and is never sent
    to the browser. This particular sign-in flow (verifying an ID token)
    doesn't actually need the secret, but it's kept there for any future
    server-side Google API calls.
  - **If Google sign-in doesn't work:** the Google Cloud project for
    this Client ID needs `http://localhost:5173` added under
    "Authorized JavaScript origins" (Google Cloud Console → APIs &
    Services → Credentials → your OAuth Client ID). Without that, Google
    will reject the request with an origin-mismatch error.
- Facebook and Apple sign-in are **not included** — only Google is
  connected, since that's the one with real credentials provided.
- Session token is saved in `localStorage` (not `sessionStorage`) since,
  unlike admin, customers expect to stay signed in across visits.

**Environment file:** `server/.env` holds the Google credentials and is
already in `.gitignore` — don't commit it if you push this anywhere.
`server/.env.example` shows the expected format without real values.

**Once signed in, the account icon opens a full account dashboard:**
- **Profile** — edit name, phone, and shipping address (email is fixed,
  since it's the login identifier).
- **Order History** — pulled live from the database, scoped to *your*
  orders only (matched by email) — one customer can never see another's.
- **Change Password** — requires the current password to confirm.

Checkout also auto-fills with your saved name/phone/email/address when
you're signed in.

## Checkout

Four payment options: **GCash**, **BDO**, **UnionBank**, and **Cash on
Delivery**. For GCash/BDO/UnionBank, the customer uploads a screenshot
of their payment as proof — that image is stored and shows up right in
the order detail view in the admin dashboard (click "View" on an order).
COD skips the proof step entirely, since there's nothing to prove yet.

The GCash number and both bank account numbers shown at checkout
(`src/components/Checkout.jsx`, the `PAYMENTS` array) are placeholders —
swap in your real account details there.

**Why these aren't "real" live payments:** actually processing a GCash
or bank payment automatically (verifying it in real time, no manual
screenshot needed) requires registering as a merchant with a payment
aggregator — PayMongo and Xendit are the common ones in the
Philippines — and getting real API credentials from them. That's a
business step only you can do, not something crediential-free. What's
built here is the realistic alternative: the customer pays manually and
uploads proof, an admin verifies it and marks the order paid. If you
ever do get PayMongo/Xendit API keys, that's a well-defined next step —
happy to wire it in at that point.

**Placing an order automatically:**
- **Decrements stock** for each item bought, by the quantity ordered
- **Flips a product to "Sold Out" the instant its stock hits zero** — no
  manual step needed; the storefront shows it as sold out and the admin
  product list reflects it too, both without a page refresh
- **Emails a receipt** to the customer (needs email configured — see
  "Email setup" above; if it's not configured yet, the order still goes
  through fine, just without the email)
- The same order also **appears in the customer's Order History**
  (Account → Order History) if they were signed in when they checked out

## Backend security hardening

A few things worth knowing about how customer data is protected:

- **CORS is locked to the frontend's origin** (`localhost:5173` by
  default) — a script running on some other website can't call this API
  and pull customer data, even indirectly.
- **Helmet** adds standard security headers (clickjacking protection,
  MIME-sniffing prevention, etc.) to every response.
- **Rate limiting** on three levels: a generous cap on the whole API
  (500 requests/15 min per IP, catches scraping/DoS), a tighter one on
  login/signup endpoints (30/15 min, on top of the existing custom
  lockout on admin login), and a dedicated one on public write actions —
  placing orders and submitting support tickets (20/15 min) — since
  those have real-world cost if scripted and spammed.
- **Orders are fully re-validated and re-priced server-side — nothing
  about price is ever trusted from the client.** The checkout request
  only supplies a product id and quantity; the actual price, name, and
  availability always come from the database at the moment the order is
  placed. A tampered request claiming a lower price, an impossible
  quantity, or a sold-out item simply can't succeed — it's rejected
  before anything is written. Order creation also runs as a single
  atomic database transaction, so a failure partway through can't leave
  a half-written order or an incorrect stock count behind.
- **Every route that touches customer PII requires a valid session
  token** — orders, customer records, and support tickets are all
  `requireAdmin`-gated; a customer's own profile/orders are
  `requireCustomer`-gated and scoped to their own email only. There is
  no route that returns another customer's personal data to anyone but
  an authenticated admin.
- **Passwords are never stored or logged in plaintext** — salted with
  Node's `crypto.scrypt`, one-way hashed.
- **The admin customer list explicitly whitelists which columns it
  returns** (name, email, phone, order stats) rather than selecting
  everything, so a future field added to the `customers` table (like
  `password_hash`) can't accidentally leak through that endpoint.
- Order IDs are checked for collisions before insert, so one order can't
  overwrite another's data even if two client-generated IDs happened to
  match.

**What this setup does *not* protect against** (still a local prototype,
being upfront about the ceiling here): there's no HTTPS in local dev, so
traffic between browser and server isn't encrypted on the wire — fine on
your own machine, not fine if you ever exposed this API over the open
internet. Same advice as elsewhere in this README: real deployment needs
HTTPS, environment-specific CORS origins, and ideally a managed database
with its own access controls, not a local SQLite file.

## Footer social links

- **Facebook** → links to `facebook.com/RSfinelady`
- **TikTok** → links to `tiktok.com/@ryde.luxury`
- **Instagram** → icon shown, but no link yet (account not provided) —
  add the URL in `src/components/Footer.jsx` when you have it
- **Contact us** → opens an email to `rydecompany.ph@gmail.com`
- Shopee and Lazada icons were removed (redundant with Contact us)

## What's real vs. still a prototype

**Real and persisted (SQLite):** products (including a custom
description per product, set from the admin dashboard), product photos,
**real per-customer product ratings** (one per customer per product,
average recalculated automatically — no fake numbers), orders placed
through checkout with payment proof images, order/payment status,
customer accounts (with real password auth), profile edits, support
ticket status and replies.

**Still front-end only (resets on refresh):** cart contents, wishlist,
homepage testimonials (separate from product ratings — these are the
"Customer love" quotes on the homepage, submitted through that section's
own form).

**Not implemented:** real payment processing (GCash/Bank Transfer are UI
+ manual proof-of-payment verification, not an actual payment gateway),
email confirmations, password reset via email, real social login besides
Google, email reply threading (see the Email setup section above).

## Starting with a clean slate

There is **no seed/demo data anymore** — no fake products, no fake
orders, no fake customers, no fake reviews. A brand new database starts
completely empty; you build up real products and real activity from
there through the admin dashboard and actual storefront use.

If you have an existing `server/db/ryde.sqlite` from before this change,
the old demo data is still in it — delete the file to start fresh (see
"Resetting the database" below), or just delete individual demo products
from the admin dashboard if you'd rather keep the rest.

## Database schema

SQLite file at `server/db/ryde.sqlite`, schema in `server/db/schema.sql`:

- `products`, `product_images` (one product → many images)
- `orders`, `order_items` (one order → many line items)
- `customers` (now includes `password_hash`, `address` for real accounts)
- `tickets`

If you have a database from before customer accounts existed, it's
migrated automatically the next time the server starts — no manual steps.

## Resetting the database

```bash
rm server/db/ryde.sqlite server/db/ryde.sqlite-shm server/db/ryde.sqlite-wal
cd server && npm run dev
```

## API reference

Base URL: `http://localhost:4000/api`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/admin/login` | — | Admin login |
| POST | `/admin/logout` | admin | Invalidate admin session |
| POST | `/auth/signup` | — | Create a customer account |
| POST | `/auth/login` | — | Customer login (email or username) |
| POST | `/auth/google` | — | Google sign-in (verifies ID token, auto-creates account) |
| POST | `/auth/logout` | customer | Invalidate customer session |
| GET | `/auth/me` | customer | Get your profile |
| PATCH | `/auth/me` | customer | Update name/phone/address |
| PATCH | `/auth/me/password` | customer | Change password |
| POST | `/auth/verify-email` | customer | Submit a verification code |
| POST | `/auth/resend-verification` | customer | Send a new verification code |
| POST | `/auth/delete-account/request` | customer | Start account deletion (emails a code if verified) |
| DELETE | `/auth/me` | customer | Permanently delete the account |
| GET | `/auth/me/orders` | customer | Your own order history |
| GET | `/auth/me/tickets` | customer | Your own support tickets + replies |
| GET | `/products` | — | List all products (with images) |
| POST | `/products` | admin | Create a product |
| PUT | `/products/:id` | admin | Update a product |
| DELETE | `/products/:id` | admin | Delete a product (and its images) |
| POST | `/products/:id/images` | admin | Upload images (multipart, field `images`, up to 8 files) |
| DELETE | `/products/:id/images/:imageId` | admin | Remove one image |
| POST | `/products/:id/rate` | customer | Rate a product 1-5 (updates your previous rating if any) |
| GET | `/products/:id/my-rating` | customer | Your own rating for a product, if any |
| GET | `/orders` | admin | List all orders |
| POST | `/orders` | — | Create an order (checkout) |
| POST | `/orders/:id/proof` | — | Upload payment proof image for an order |
| PATCH | `/orders/:id/status` | admin | Update order status |
| PATCH | `/orders/:id/payment-status` | admin | Update payment status |
| GET | `/customers` | admin | List customers with live order stats |
| PATCH | `/customers/:id/status` | admin | Suspend/activate a customer |
| GET | `/tickets` | admin | List support tickets (with reply history) |
| POST | `/tickets` | — | Submit a ticket |
| POST | `/tickets/:id/reply` | admin | Reply to a ticket — sends a real email |
| PATCH | `/tickets/:id/resolve` | admin | Mark a ticket resolved |
