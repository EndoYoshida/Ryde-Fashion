import { Router } from "express";
import { db } from "../db/index.js";
import { sendNewsletterWelcomeEmail } from "../email.js";

const router = Router();

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// POST /api/newsletter/subscribe — public, no account required.
router.post("/subscribe", async (req, res) => {
  const email = (req.body?.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  db.prepare(`
    INSERT INTO newsletter_subscribers (email, unsubscribed) VALUES (?, 0)
    ON CONFLICT (email) DO UPDATE SET unsubscribed = 0
  `).run(email);

  // Best-effort — a subscriber shouldn't see an error just because the
  // welcome email happened to fail to send.
  const result = await sendNewsletterWelcomeEmail(email);
  res.status(201).json({ subscribed: true, welcomeEmailSent: result.sent });
});

// POST /api/newsletter/unsubscribe — public; anyone who knows the email
// can opt it out (matches an unsubscribe-link pattern, no account needed).
router.post("/unsubscribe", (req, res) => {
  const email = (req.body?.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  db.prepare("UPDATE newsletter_subscribers SET unsubscribed = 1 WHERE email = ?").run(email);
  res.json({ unsubscribed: true });
});

export default router;
