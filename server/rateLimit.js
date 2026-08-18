import rateLimit from "express-rate-limit";

// Generous ceiling on the whole API — catches scraping/DoS attempts
// without getting in the way of normal browsing.
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

// Tighter limit specifically on auth endpoints (signup/login/google),
// where the actual sensitive data — customer accounts — is exposed to
// guessing/enumeration attempts. This runs in addition to the custom
// lockout logic in server/auth.js for admin login.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts from this device. Please wait a few minutes and try again." },
});

// Covers public write endpoints with real-world consequences if spammed
// — placing orders (drains real stock) and submitting support tickets
// (floods the inbox). Both still require no login, so this is the main
// thing standing between them and a scripted flood.
export const publicWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions from this device. Please wait a few minutes and try again." },
});
