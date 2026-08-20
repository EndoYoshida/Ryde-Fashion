import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import path from "path";
import { fileURLToPath } from "url";

import "./db/index.js"; // connects to Postgres + ensures schema is up to date
import { asyncHandler } from "./asyncHandler.js";
import { login, logout } from "./auth.js";
import { isFirebaseConfigured } from "./firebaseAdmin.js";
import { pollInbox, isEmailConfigured } from "./email.js";
import { generalLimiter, authLimiter } from "./rateLimit.js";
import { startSheetsSyncScheduler } from "./sync/scheduler.js";
import { startBestsellerScheduler } from "./bestsellers/scheduler.js";
import authRouter from "./routes/auth.js";
import productsRouter from "./routes/products.js";
import ordersRouter from "./routes/orders.js";
import customersRouter from "./routes/customers.js";
import ticketsRouter from "./routes/tickets.js";
import newsletterRouter from "./routes/newsletter.js";
import wishlistRouter from "./routes/wishlist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 4000;

// Render (and most PaaS hosts) put your app behind a reverse proxy, so
// every request's actual source IP arrives in the X-Forwarded-For header
// rather than as the socket's own address. Without this, req.ip is just
// the proxy's IP for every request — which would silently break the
// per-IP rate limiting (rateLimit.js) and the admin login lockout
// (auth.js), lumping every visitor into one shared bucket.
app.set("trust proxy", 1);

// Render terminates TLS at its edge and already forces HTTPS for both
// *.onrender.com and any custom domain added in its dashboard — so this
// is redundant there today. It's here as defense-in-depth (and so this
// still holds if the app is ever moved behind a different proxy that
// doesn't force it): reject any request that reached this app over
// plain HTTP, identified via the X-Forwarded-Proto header the proxy sets.
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.headers["x-forwarded-proto"] === "http") {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}

// Only the storefront's own origin may call this API. A malicious site
// can't get a browser to make authenticated cross-origin requests here —
// and even unauthenticated ones (like the public product list) are
// restricted to origins this app actually expects.
const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

app.use(helmet({
  // Product images are served from this API (port 4000) but requested
  // by the frontend on a different port (5173) — helmet's strict
  // defaults would block that as a cross-origin request otherwise.
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "1mb" }));
// Product/proof images are now served directly from Cloudinary's own CDN
// URLs (see upload.js) rather than from this server, since Render's disk
// is ephemeral — no local /uploads static route needed anymore.
// Serves static assets referenced by outgoing emails (e.g. the logo) at an
// absolute URL — email clients can't load relative paths, so templates in
// emailTemplates.js build the full URL from APP_ORIGIN below.
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/api", generalLimiter);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/admin/login", authLimiter, asyncHandler(login));
app.post("/api/admin/logout", asyncHandler(logout));
app.use("/api/auth", authLimiter, authRouter);

app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/customers", customersRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/newsletter", newsletterRouter);
app.use("/api/wishlist", wishlistRouter);

const POLL_INTERVAL_MS = 60 * 1000; // check for new support emails every minute

app.listen(PORT, () => {
  console.log(`Ryde API running at http://localhost:${PORT}`);
  if (!isFirebaseConfigured) {
    console.warn("Warning: FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY are not set in server/.env — customer sign-in will not work.");
  }
  if (isEmailConfigured()) {
    console.log(`Checking ${process.env.EMAIL_USER} for new support emails every ${POLL_INTERVAL_MS / 1000}s.`);
    pollInbox();
    setInterval(pollInbox, POLL_INTERVAL_MS);
  } else {
    console.warn("Warning: EMAIL_USER/EMAIL_APP_PASSWORD are not set in server/.env — support emails won't be imported and replies won't send. See README.");
  }
  startSheetsSyncScheduler();
  startBestsellerScheduler();
});

// Catches errors passed via next(err) from asyncHandler-wrapped routes
// (including rejected Postgres queries) so a DB error returns a clean 500
// instead of hanging the request or crashing the process.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
});