import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { db } from "../db/index.js";
import {
  hashPassword, verifyPassword, issueSession, endSession,
  requireCustomer, publicCustomer, generateVerificationCode,
  codeExpiryTimestamp, isCodeExpired,
} from "../customerAuth.js";
import { sendVerificationEmail, sendDeletionConfirmationEmail } from "../email.js";

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
router.post("/signup", async (req, res) => {
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

  const code = generateVerificationCode();
  db.prepare("UPDATE customers SET verification_code = ?, verification_code_expires_at = ? WHERE id = ?")
    .run(code, codeExpiryTimestamp(), customer.id);
  const emailResult = await sendVerificationEmail(customer.email, code);
  if (!emailResult.sent) {
    console.warn(`Signup verification email not sent for ${customer.email}: ${emailResult.reason}`);
  }

  const token = issueSession(customer.id);
  res.status(201).json({
    token,
    customer: publicCustomer(customer),
    verificationEmailSent: emailResult.sent,
  });
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
  if (customer.status === "deleted") {
    return res.status(403).json({ error: "This account has been deleted." });
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
      INSERT INTO customers (name, username, email, phone, password_hash, email_verified, joined, status)
      VALUES (?, ?, ?, NULL, NULL, 1, date('now'), 'active')
    `).run(name, username, email);
    customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(result.lastInsertRowid);
  }

  if (customer.status === "deleted") {
    return res.status(403).json({ error: "This account has been deleted." });
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

// POST /api/auth/verify-email
router.post("/verify-email", requireCustomer, (req, res) => {
  const { code } = req.body || {};
  if (req.customer.email_verified) {
    return res.json({ customer: publicCustomer(req.customer), alreadyVerified: true });
  }
  if (isCodeExpired(req.customer.verification_code_expires_at)) {
    return res.status(400).json({ error: "That code has expired. Tap \"Resend code\" to get a new one.", expired: true });
  }
  if (!code || String(code).trim() !== req.customer.verification_code) {
    return res.status(400).json({ error: "That code doesn't match. Double-check your email and try again." });
  }
  db.prepare("UPDATE customers SET email_verified = 1, verification_code = NULL, verification_code_expires_at = NULL WHERE id = ?").run(req.customer.id);
  const updated = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.customer.id);
  res.json({ customer: publicCustomer(updated) });
});

// POST /api/auth/resend-verification
router.post("/resend-verification", requireCustomer, async (req, res) => {
  if (req.customer.email_verified) {
    return res.json({ alreadySent: false, alreadyVerified: true });
  }
  const code = generateVerificationCode();
  db.prepare("UPDATE customers SET verification_code = ?, verification_code_expires_at = ? WHERE id = ?")
    .run(code, codeExpiryTimestamp(), req.customer.id);
  const result = await sendVerificationEmail(req.customer.email, code);
  if (!result.sent) {
    return res.status(502).json({ error: `Couldn't send the email: ${result.reason}` });
  }
  res.json({ sent: true });
});

// POST /api/auth/delete-account/request
// Verified users get an emailed confirmation code that DELETE /me will
// require. Unverified users skip straight to password-only confirmation
// — there's no reliable email to confirm through if it was never
// verified in the first place.
router.post("/delete-account/request", requireCustomer, async (req, res) => {
  if (!req.customer.email_verified) {
    return res.json({ requiresCode: false });
  }
  const code = generateVerificationCode();
  db.prepare("UPDATE customers SET verification_code = ?, verification_code_expires_at = ? WHERE id = ?")
    .run(code, codeExpiryTimestamp(), req.customer.id);
  const result = await sendDeletionConfirmationEmail(req.customer.email, code);
  if (!result.sent) {
    return res.status(502).json({ error: `Couldn't send the confirmation email: ${result.reason}` });
  }
  res.json({ requiresCode: true, sent: true });
});

// DELETE /api/auth/me — deactivates the account.
// This is a soft delete: the row stays in the database (marked with
// status 'deleted') rather than being removed, so order history, ratings,
// and the admin's customer records stay intact. The account itself can
// never sign in again — the password hash is cleared and every session
// for it is ended.
// Always requires the current password. Verified accounts additionally
// require the emailed confirmation code from the request above.
router.delete("/me", requireCustomer, (req, res) => {
  const { password, code } = req.body || {};

  if (!verifyPassword(password || "", req.customer.password_hash)) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  if (req.customer.email_verified) {
    if (isCodeExpired(req.customer.verification_code_expires_at)) {
      return res.status(400).json({ error: "That confirmation code has expired. Please request a new one.", expired: true });
    }
    if (!code || String(code).trim() !== req.customer.verification_code) {
      return res.status(400).json({ error: "That confirmation code doesn't match." });
    }
  }

  db.prepare(`
    UPDATE customers
    SET status = 'deleted', password_hash = NULL, verification_code = NULL, verification_code_expires_at = NULL
    WHERE id = ?
  `).run(req.customer.id);

  // Sign this account out everywhere, not just the current tab/token.
  db.prepare("DELETE FROM customer_sessions WHERE customer_id = ?").run(req.customer.id);

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

// GET /api/auth/me/tickets  (this customer's own support tickets + replies)
router.get("/me/tickets", requireCustomer, (req, res) => {
  const tickets = db.prepare("SELECT * FROM tickets WHERE email = ? ORDER BY date DESC").all(req.customer.email);
  const withReplies = tickets.map((t) => ({
    id: t.id,
    subject: t.subject,
    message: t.message,
    status: t.status,
    date: t.date,
    replies: db.prepare("SELECT id, body, created_at FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at")
      .all(t.id)
      .map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at })),
  }));
  res.json(withReplies);
});

export default router;
