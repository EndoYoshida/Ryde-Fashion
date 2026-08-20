import crypto from "crypto";
import { db } from "./db/index.js";
import { hashPassword, verifyPassword } from "./customerAuth.js";
import { verifyTotp } from "./totp.js";

// Admin credentials live in environment variables now, never in source —
// see server/.env.example. ADMIN_PASSWORD_HASH is a salted hash (the same
// scrypt format customerAuth.js uses), not a plaintext password: run
// `node scripts/hash-admin-password.js "your password"` to generate one.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

// Optional second factor. When set (via `node scripts/generate-totp-secret.js`),
// a correct username/password alone isn't enough to log in — the request
// also needs a valid 6-digit code from the admin's authenticator app.
// Left unset, login behaves exactly as before (password-only) — this is
// additive, not a breaking change to existing deployments.
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
  console.error(
    "\n[FATAL] ADMIN_USERNAME and ADMIN_PASSWORD_HASH must be set in server/.env — " +
    "the admin dashboard has no login credentials configured.\n" +
    "Run: node scripts/hash-admin-password.js \"your password\"  to generate a hash.\n"
  );
}
if (!ADMIN_TOTP_SECRET) {
  console.warn(
    "\n[warning] ADMIN_TOTP_SECRET is not set — admin login has no second factor. " +
    "Run: node scripts/generate-totp-secret.js  to set up MFA.\n"
  );
}

// Sessions are persisted in SQLite (not kept in memory) so an active admin
// login survives server restarts — deploys, crashes, or `--watch` reloads
// during development — instead of getting signed out every time.
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// --- Basic brute-force protection ---
// Login-attempt counters are fine to keep in memory: losing them on a
// restart just means a temporary lockout resets early, which isn't a
// security regression worth persisting to disk for.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const attempts = new Map(); // ip -> { count, lockedUntil }

function getAttemptState(ip) {
  return attempts.get(ip) || { count: 0, lockedUntil: 0 };
}

// Constant-time string comparison so a mistyped username can't be
// distinguished from a correct one by response timing.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal length so the timing doesn't leak
    // the length mismatch either.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function login(req, res) {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
    return res.status(500).json({ error: "Admin login isn't configured on the server." });
  }

  const ip = req.ip;
  const state = getAttemptState(ip);

  if (state.lockedUntil > Date.now()) {
    const secondsLeft = Math.ceil((state.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${secondsLeft}s.` });
  }

  const { username, password, totpCode } = req.body || {};
  const ok = safeEqual(username, ADMIN_USERNAME) && verifyPassword(password || "", ADMIN_PASSWORD_HASH);

  if (ok) {
    // Password correct — if MFA is configured, that's only step one.
    // No code yet: tell the client to prompt for it (this isn't counted
    // as a failed attempt, since the password itself was right).
    if (ADMIN_TOTP_SECRET && !totpCode) {
      return res.json({ mfaRequired: true });
    }
    // Code provided (or required): verify it before issuing a session.
    if (ADMIN_TOTP_SECRET && !verifyTotp(ADMIN_TOTP_SECRET, totpCode)) {
      const nextCount = state.count + 1;
      const nextState = { count: nextCount, lockedUntil: 0 };
      if (nextCount >= MAX_ATTEMPTS) {
        nextState.lockedUntil = Date.now() + LOCKOUT_MS;
        nextState.count = 0;
      }
      attempts.set(ip, nextState);
      return res.status(401).json({ error: "Invalid authentication code.", mfaRequired: true });
    }

    attempts.delete(ip);
    const token = crypto.randomBytes(24).toString("hex");
    await db.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)")
      .run(token, Date.now() + SESSION_TTL_MS);
    return res.json({ token, expiresIn: SESSION_TTL_MS });
  }

  const nextCount = state.count + 1;
  const nextState = { count: nextCount, lockedUntil: 0 };
  if (nextCount >= MAX_ATTEMPTS) {
    nextState.lockedUntil = Date.now() + LOCKOUT_MS;
    nextState.count = 0;
  }
  attempts.set(ip, nextState);

  const remaining = MAX_ATTEMPTS - nextCount;
  return res.status(401).json({
    error: remaining > 0
      ? `Invalid credentials. ${remaining} attempt(s) left before a temporary lockout.`
      : "Invalid credentials. Too many attempts — locked out temporarily.",
  });
}

export async function logout(req, res) {
  const token = getToken(req);
  if (token) await db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
  res.status(204).end();
}

function getToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

export async function requireAdmin(req, res, next) {
  try {
    const token = getToken(req);
    const session = token && await db.prepare("SELECT * FROM admin_sessions WHERE token = ?").get(token);

    if (!session || session.expires_at < Date.now()) {
      if (token) await db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
      return res.status(401).json({ error: "Not authenticated. Please log in again." });
    }

    // Sliding expiry: any authenticated request extends the session.
    await db.prepare("UPDATE admin_sessions SET expires_at = ? WHERE token = ?")
      .run(Date.now() + SESSION_TTL_MS, token);
    next();
  } catch (err) {
    next(err);
  }
}

// Re-exported so scripts/hash-admin-password.js doesn't need to know
// customerAuth.js's internals — it just needs "the hash function".
export { hashPassword };
