import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { db } from "../db/index.js";
import {
  hashPassword, verifyPassword, issueSession, endSession,
  requireCustomer, publicCustomer,
} from "../customerAuth.js";

const router = Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function generateUniqueUsername(base) {
  const clean = (base || "user").toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 16) || "user";
  let username = clean;
  let i = 1;
  while (db.prepare("SELECT id FROM customers WHERE LOWER(username) = ?").get(username)) {
    username = `${clean}${i++}`;
  }
  return username;
}

// POST /api/auth/signup
router.post("/signup", (req, res) => {
  const { name, username, email, password, phone } = req.body || {};
  if (!name?.trim() || !username?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: "Name, username, email, and password are required" });
  }
  if (name.trim().length < 3) {
    return res.status(400).json({ error: "Name must be at least 3 characters" });
  }
  if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username.trim())) {
    return res.status(400).json({ error: "Username must be 3-20 characters (letters, numbers, underscore, period only)" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (!/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return res.status(400).json({ error: "Password must include an uppercase letter, a number, and a special character" });
  }

  const emailTaken = db.prepare("SELECT id FROM customers WHERE email = ?").get(email.trim().toLowerCase());
  if (emailTaken) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }
  const usernameTaken = db.prepare("SELECT id FROM customers WHERE LOWER(username) = ?").get(username.trim().toLowerCase());
  if (usernameTaken) {
    return res.status(409).json({ error: "That username is already taken" });
  }

  const result = db.prepare(`
    INSERT INTO customers (name, username, email, phone, password_hash, joined, status)
    VALUES (?, ?, ?, ?, ?, date('now'), 'active')
  `).run(name.trim(), username.trim(), email.trim().toLowerCase(), phone?.trim() || null, hashPassword(password));

  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(result.lastInsertRowid);
  const token = issueSession(customer.id);
  res.status(201).json({ token, customer: publicCustomer(customer) });
});

// POST /api/auth/login
// `identifier` can be either the account's email or its username.
router.post("/login", (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier?.trim()) {
    return res.status(400).json({ error: "Enter your email or username" });
  }

  const value = identifier.trim().toLowerCase();
  const customer = db.prepare("SELECT * FROM customers WHERE email = ? OR LOWER(username) = ?").get(value, value);

  if (!customer) {
    return res.status(404).json({
      error: "We couldn't find an account with that email or username. Please sign up first.",
      notRegistered: true,
    });
  }
  if (!verifyPassword(password || "", customer.password_hash)) {
    return res.status(401).json({ error: "Incorrect password. Please try again." });
  }
  if (customer.status === "suspended") {
    return res.status(403).json({ error: "This account has been suspended. Contact support." });
  }

  const token = issueSession(customer.id);
  res.json({ token, customer: publicCustomer(customer) });
});

// POST /api/auth/google
// Verifies the ID token issued by Google Identity Services on the
// frontend. Only the Client ID (public) is needed for verification —
// the Client Secret in .env isn't required by this flow, but is kept
// there for any future server-side Google API calls.
router.post("/google", async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) {
    return res.status(400).json({ error: "Missing Google credential" });
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: "Google sign-in isn't configured on the server (missing GOOGLE_CLIENT_ID)." });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    console.error("Google token verification failed:", err.message);
    return res.status(401).json({ error: "Couldn't verify that Google sign-in. Please try again." });
  }

  if (!payload?.email) {
    return res.status(401).json({ error: "That Google account doesn't have an email we can use." });
  }

  const email = payload.email.toLowerCase();
  let customer = db.prepare("SELECT * FROM customers WHERE email = ?").get(email);

  if (!customer) {
    // First time this Google account has signed in — create a real
    // account for them. No password_hash is set since they're
    // authenticating through Google, not a local password.
    const name = payload.name || email.split("@")[0];
    const username = generateUniqueUsername(payload.given_name || name || email.split("@")[0]);
    const result = db.prepare(`
      INSERT INTO customers (name, username, email, phone, password_hash, joined, status)
      VALUES (?, ?, ?, NULL, NULL, date('now'), 'active')
    `).run(name, username, email);
    customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(result.lastInsertRowid);
  }

  if (customer.status === "suspended") {
    return res.status(403).json({ error: "This account has been suspended. Contact support." });
  }

  const token = issueSession(customer.id);
  res.json({ token, customer: publicCustomer(customer) });
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  endSession(token);
  res.status(204).end();
});

// GET /api/auth/me
router.get("/me", requireCustomer, (req, res) => {
  res.json(publicCustomer(req.customer));
});

// PATCH /api/auth/me  (update profile info)
router.patch("/me", requireCustomer, (req, res) => {
  const { name, phone, address } = req.body || {};
  db.prepare("UPDATE customers SET name = COALESCE(?, name), phone = ?, address = ? WHERE id = ?")
    .run(name?.trim() || null, phone?.trim() || null, address?.trim() || null, req.customer.id);
  const updated = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.customer.id);
  res.json(publicCustomer(updated));
});

// PATCH /api/auth/me/password
router.patch("/me/password", requireCustomer, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!verifyPassword(currentPassword || "", req.customer.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }
  if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
    return res.status(400).json({ error: "New password must include an uppercase letter, a number, and a special character" });
  }
  db.prepare("UPDATE customers SET password_hash = ? WHERE id = ?").run(hashPassword(newPassword), req.customer.id);
  res.status(204).end();
});

// GET /api/auth/me/orders  (this customer's own order history)
router.get("/me/orders", requireCustomer, (req, res) => {
  const orders = db.prepare("SELECT id, status, payment_status, total, date FROM orders WHERE email = ? ORDER BY date DESC")
    .all(req.customer.email);
  const withItems = orders.map((o) => ({
    ...o,
    paymentStatus: o.payment_status,
    items: db.prepare("SELECT name, qty, price FROM order_items WHERE order_id = ?").all(o.id),
  }));
  res.json(withItems);
});

export default router;
