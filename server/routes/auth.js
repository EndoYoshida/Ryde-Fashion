import { Router } from "express";
import { db } from "../db/index.js";
import {
  issueSession, endSession, requireCustomer, publicCustomer,
  generateVerificationCode, codeExpiryTimestamp, isCodeExpired,
} from "../customerAuth.js";
import { verifyFirebaseToken, generateVerificationLink, generatePasswordResetLink } from "../firebaseAdmin.js";
import { sendDeletionConfirmationEmail, sendCustomerVerificationLinkEmail, sendCustomerPasswordResetEmail } from "../email.js";

const router = Router();

function generateUniqueUsername(base) {
  const clean = (base || "user").toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 16) || "user";
  let username = clean;
  let i = 1;
  while (db.prepare("SELECT id FROM customers WHERE LOWER(username) = ?").get(username)) {
    username = `${clean}${i++}`;
  }
  return username;
}

// POST /api/auth/firebase
// The single entry point for all customer sign-in: email/password sign-up,
// email/password sign-in, and Google sign-in all go through Firebase on
// the frontend first, which hands back a short-lived Firebase ID token.
// We verify that token here (never trusting anything the client says about
// itself), then find-or-create a local `customers` row keyed by the
// Firebase UID and issue our own opaque session token for it — this way
// every other route (orders, wishlist, tickets, ratings...) keeps working
// exactly as it did before, unaware that anything changed upstream.
//
// `username` is only used the first time a given Firebase account is seen
// (i.e. on signup) — later calls ignore it.
router.post("/firebase", async (req, res) => {
  const { idToken, username, phone } = req.body || {};
  if (!idToken) {
    return res.status(400).json({ error: "Missing Firebase ID token" });
  }

  let decoded;
  try {
    decoded = await verifyFirebaseToken(idToken);
  } catch (err) {
    console.error("Firebase ID token verification failed:", err.message);
    return res.status(401).json({ error: "Couldn't verify that sign-in. Please try again." });
  }

  const { uid, email, email_verified: emailVerified, name } = decoded;
  if (!email) {
    return res.status(401).json({ error: "That account doesn't have an email we can use." });
  }
  const cleanEmail = email.toLowerCase();

  let customer = db.prepare("SELECT * FROM customers WHERE firebase_uid = ?").get(uid);

  if (!customer) {
    // No row for this Firebase account yet. It might still be an existing
    // customer signing in with Firebase for the first time (matched by
    // email) — link the two instead of creating a duplicate.
    customer = db.prepare("SELECT * FROM customers WHERE email = ?").get(cleanEmail);

    if (customer) {
      db.prepare("UPDATE customers SET firebase_uid = ?, email_verified = ? WHERE id = ?")
        .run(uid, emailVerified ? 1 : 0, customer.id);
    } else {
      const finalUsername = generateUniqueUsername(username || name || cleanEmail.split("@")[0]);
      db.prepare(`
        INSERT INTO customers (name, username, email, phone, firebase_uid, email_verified, joined, status)
        VALUES (?, ?, ?, ?, ?, ?, date('now'), 'active')
      `).run(name?.trim() || finalUsername, finalUsername, cleanEmail, phone?.trim() || null, uid, emailVerified ? 1 : 0);
    }
    customer = db.prepare("SELECT * FROM customers WHERE firebase_uid = ? OR email = ?").get(uid, cleanEmail);
  } else if (!!customer.email_verified !== !!emailVerified) {
    // Keep our copy of the verified flag in sync with Firebase's (e.g. the
    // user clicked the verification link since their last sign-in).
    db.prepare("UPDATE customers SET email_verified = ? WHERE id = ?").run(emailVerified ? 1 : 0, customer.id);
    customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customer.id);
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

// POST /api/auth/send-verification-email
// Replaces the frontend's direct call to Firebase's sendEmailVerification()
// so the email can go out in our own branded template instead of
// Firebase's default one. No session required — this runs right after
// signup, before the frontend has finished exchanging its Firebase token
// for a local session, same as the old client-side call didn't need one
// either. Rate-limited the same way the rest of /api/auth is (see index.js).
router.post("/send-verification-email", async (req, res) => {
  const email = req.body?.email?.trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Email is required." });

  try {
    const link = await generateVerificationLink(email);
    const result = await sendCustomerVerificationLinkEmail(email, link);
    if (!result.sent) {
      return res.status(502).json({ error: `Couldn't send the verification email: ${result.reason}` });
    }
    res.json({ sent: true });
  } catch (err) {
    if (err.code === "auth/email-not-found" || err.code === "auth/user-not-found") {
      return res.status(404).json({ error: "No account found with that email." });
    }
    if (err.code === "auth/email-already-verified") {
      return res.status(400).json({ error: "That email is already verified." });
    }
    console.error("Failed to generate verification link:", err.message);
    res.status(502).json({ error: "Couldn't send the verification email. Please try again." });
  }
});

// POST /api/auth/send-password-reset
// Replaces the frontend's direct call to Firebase's sendPasswordResetEmail()
// — same reasoning as above. Public/unauthenticated, matching how a
// "forgot password" flow always has to work (the person isn't signed in).
router.post("/send-password-reset", async (req, res) => {
  const email = req.body?.email?.trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Email is required." });

  try {
    const link = await generatePasswordResetLink(email);
    const result = await sendCustomerPasswordResetEmail(email, link);
    if (!result.sent) {
      return res.status(502).json({ error: `Couldn't send the reset email: ${result.reason}` });
    }
    res.json({ sent: true });
  } catch (err) {
    if (err.code === "auth/email-not-found" || err.code === "auth/user-not-found") {
      // Same behavior the old client-side sendPasswordResetEmail() had —
      // this does confirm whether an email is registered. Keeping parity
      // rather than silently pretending it sent, since the frontend's
      // existing error handling already expects a real error here.
      return res.status(404).json({ error: "No account found with that email." });
    }
    console.error("Failed to generate password reset link:", err.message);
    res.status(502).json({ error: "Couldn't send the reset email. Please try again." });
  }
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
  const { name, phone, phoneCountryCode, addressLine, barangay, city, province, zipCode } = req.body || {};

  const cleanPhone = phone != null ? String(phone).replace(/\D/g, "").slice(0, 10) || null : null;
  const cleanCountryCode = phoneCountryCode != null
    ? (String(phoneCountryCode).replace(/\D/g, "").slice(0, 4) ? `+${String(phoneCountryCode).replace(/\D/g, "").slice(0, 4)}` : null)
    : null;

  const cleanAddressLine = addressLine?.trim() || null;
  const cleanBarangay = barangay?.trim() || null;
  const cleanCity = city?.trim() || null;
  const cleanProvince = province?.trim() || null;
  const cleanZip = zipCode?.trim() || null;

  const combinedAddress = [cleanAddressLine, cleanBarangay, cleanCity, cleanProvince, cleanZip]
    .filter(Boolean).join(", ") || null;

  db.prepare(`
    UPDATE customers
    SET name = COALESCE(?, name),
        phone = ?, phone_country_code = ?,
        address_line = ?, barangay = ?, city = ?, province = ?, zip_code = ?,
        address = ?
    WHERE id = ?
  `).run(
    name?.trim() || null,
    cleanPhone, cleanCountryCode,
    cleanAddressLine, cleanBarangay, cleanCity, cleanProvince, cleanZip,
    combinedAddress,
    req.customer.id,
  );
  const updated = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.customer.id);
  res.json(publicCustomer(updated));
});

// POST /api/auth/delete-account/request
// Verified users get an emailed confirmation code that DELETE /me
// requires. Unverified users skip straight through — there's no reliable
// email to confirm through if it was never verified, and account deletion
// already requires an active, valid session (requireCustomer), which is
// the meaningful gate now that there's no local password to re-check.
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
// never sign in again — its firebase_uid link is cleared and every
// session for it is ended.
// Verified accounts require the emailed confirmation code from the
// request above; unverified accounts just need the active session.
router.delete("/me", requireCustomer, (req, res) => {
  const { code } = req.body || {};

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
    SET status = 'deleted', firebase_uid = NULL, verification_code = NULL, verification_code_expires_at = NULL
    WHERE id = ?
  `).run(req.customer.id);

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
