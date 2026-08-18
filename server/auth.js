import crypto from "crypto";
import { db } from "./db/index.js";

// Hardcoded admin credentials for this prototype. In a real production
// app these would be hashed + stored in the database (or a proper auth
// provider), never committed as plain text — flagging that clearly here.
const ADMIN_USERNAME = "RydeAdmin";
const ADMIN_PASSWORD = "RydenSito1004_";

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
    db.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)")
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

export function logout(req, res) {
  const token = getToken(req);
  if (token) db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
  res.status(204).end();
}

function getToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

export function requireAdmin(req, res, next) {
  const token = getToken(req);
  const session = token && db.prepare("SELECT * FROM admin_sessions WHERE token = ?").get(token);

  if (!session || session.expires_at < Date.now()) {
    if (token) db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
    return res.status(401).json({ error: "Not authenticated. Please log in again." });
  }

  // Sliding expiry: any authenticated request extends the session.
  db.prepare("UPDATE admin_sessions SET expires_at = ? WHERE token = ?")
    .run(Date.now() + SESSION_TTL_MS, token);
  next();
}
