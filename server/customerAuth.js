import crypto from "crypto";
import { db } from "./db/index.js";

// --- Password hashing (Node's built-in crypto, no native deps needed) ---
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
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — customers expect to stay signed in
const sessions = new Map(); // token -> customerId

function getToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

export function issueSession(customerId) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { customerId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function endSession(token) {
  if (token) sessions.delete(token);
}

export function requireCustomer(req, res, next) {
  const token = getToken(req);
  const session = token && sessions.get(token);

  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: "Not signed in. Please log in again." });
  }

  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(session.customerId);
  if (!customer || customer.status === "suspended") {
    sessions.delete(token);
    return res.status(401).json({ error: "This account is no longer active." });
  }

  sessions.set(token, { ...session, expiresAt: Date.now() + SESSION_TTL_MS }); // sliding expiry
  req.customer = customer;
  next();
}

export function publicCustomer(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, username: row.username, email: row.email,
    phone: row.phone, address: row.address, joined: row.joined,
    emailVerified: !!row.email_verified,
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
