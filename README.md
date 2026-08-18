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
```

## Running the Project

The frontend and backend run separately.

### Backend

```bash
cd server
npm install
npm run dev
```

Backend runs at `http://localhost:4000`.

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
- Admin and customer session protection
- CORS restrictions
- Helmet security headers
- API rate limiting
- Server-side order and price validation
- Customer data access restrictions

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
- Replace placeholder payment information before public use.
- Google OAuth must use the correct frontend origin.
- Email features require a Gmail App Password.
- GCash and bank payments are manual, not automatic.
- Additional production security configuration is required before public deployment.
