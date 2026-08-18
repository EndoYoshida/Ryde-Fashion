import crypto from "crypto";
import { db } from "./db/index.js";

// --- Password hashing (Node's built-in crypto, no native deps needed) ---
// Customers no longer have a locally-stored password (Firebase Auth owns
// that now) — this is kept only for the admin account in server/auth.js.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Sessions (separate namespace from admin sessions in server/auth.js) ---
// Persisted in SQLite rather than kept in memory, so an active customer
// stays signed in across server restarts (deploys, crashes, `--watch`
// reloads during development) instead of being logged out every time.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — customers expect to stay signed in

function getToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

export function issueSession(customerId) {
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO customer_sessions (token, customer_id, expires_at) VALUES (?, ?, ?)")
    .run(token, customerId, Date.now() + SESSION_TTL_MS);
  return token;
}

export function endSession(token) {
  if (token) db.prepare("DELETE FROM customer_sessions WHERE token = ?").run(token);
}

export function requireCustomer(req, res, next) {
  const token = getToken(req);
  const session = token && db.prepare("SELECT * FROM customer_sessions WHERE token = ?").get(token);

  if (!session || session.expires_at < Date.now()) {
    if (token) db.prepare("DELETE FROM customer_sessions WHERE token = ?").run(token);
    return res.status(401).json({ error: "Not signed in. Please log in again." });
  }

  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(session.customer_id);
  if (!customer || customer.status === "suspended" || customer.status === "deleted") {
    db.prepare("DELETE FROM customer_sessions WHERE token = ?").run(token);
    return res.status(401).json({ error: "This account is no longer active." });
  }

  // Sliding expiry: any authenticated request extends the session.
  db.prepare("UPDATE customer_sessions SET expires_at = ? WHERE token = ?")
    .run(Date.now() + SESSION_TTL_MS, token);
  req.customer = customer;
  next();
}

export function publicCustomer(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, username: row.username, email: row.email,
    // `phone` is digits-only (max 11); `phoneCountryCode` is separate so a
    // shopper's local number never has to embed or strip a "+63" itself.
    phone: row.phone, phoneCountryCode: row.phone_country_code || "+63",
    // `address` stays as a combined string (kept in sync on every save) for
    // anywhere that just wants one display line. The split-out parts below
    // are what the profile form and checkout form actually read/write.
    address: row.address,
    addressLine: row.address_line, barangay: row.barangay, city: row.city,
    province: row.province, zipCode: row.zip_code,
    joined: row.joined,
    emailVerified: !!row.email_verified,
    // Deliberately NOT included: password_hash, firebase_uid,
    // verification_code — nothing that could help an attacker or that
    // the frontend has any legitimate use for.
  };
}

export function generateVerificationCode() {
  // 6-digit numeric code, easy to type from an email on any device.
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Shared expiry window for both email-verification codes and
// account-deletion confirmation codes. 30 minutes is generous enough
// for someone to find the email without being open-ended forever.
export const CODE_TTL_MS = 30 * 60 * 1000;

export function codeExpiryTimestamp() {
  return new Date(Date.now() + CODE_TTL_MS).toISOString();
}

export function isCodeExpired(expiresAt) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < Date.now();
}
