import crypto from "crypto";

// Hardcoded admin credentials for this prototype. In a real production
// app these would be hashed + stored in the database (or a proper auth
// provider), never committed as plain text — flagging that clearly here.
const ADMIN_USERNAME = "RydeAdmin";
const ADMIN_PASSWORD = "RydenSito1004_";

const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const sessions = new Map(); // token -> expiresAt

// --- Basic brute-force protection ---
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const attempts = new Map(); // ip -> { count, lockedUntil }

function getAttemptState(ip) {
  return attempts.get(ip) || { count: 0, lockedUntil: 0 };
}

export function login(req, res) {
  const ip = req.ip;
  const state = getAttemptState(ip);

  if (state.lockedUntil > Date.now()) {
    const secondsLeft = Math.ceil((state.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${secondsLeft}s.` });
  }

  const { username, password } = req.body || {};
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    attempts.delete(ip);
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, Date.now() + SESSION_TTL_MS);
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

export function logout(req, res) {
  const token = getToken(req);
  if (token) sessions.delete(token);
  res.status(204).end();
}

function getToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

export function requireAdmin(req, res, next) {
  const token = getToken(req);
  const expiresAt = token && sessions.get(token);

  if (!expiresAt || expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: "Not authenticated. Please log in again." });
  }

  // Sliding expiry: any authenticated request extends the session.
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  next();
}
