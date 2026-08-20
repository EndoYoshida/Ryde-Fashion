import crypto from "crypto";

// Minimal RFC 6238 TOTP (Time-based One-Time Password) implementation
// using only Node's built-in `crypto` module — no extra npm dependency
// needed. Uses the same defaults every authenticator app (Google
// Authenticator, Authy, 1Password, Microsoft Authenticator, ...)
// assumes: SHA1, 6 digits, 30-second time step.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// Generates a random base32 secret suitable for scanning into an
// authenticator app. 20 bytes (160 bits) is the standard TOTP key size.
export function generateBase32Secret(byteLength = 20) {
  const bytes = crypto.randomBytes(byteLength);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let secret = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    secret += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return secret;
}

function base32Decode(base32) {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// RFC 4226 HOTP, evaluated at a specific 30-second counter step.
function totpAt(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

// Verifies a 6-digit code against the current time step, plus one step
// before/after to tolerate ordinary clock drift between the server and
// the admin's phone (the same tolerance every TOTP library defaults to).
export function verifyTotp(secret, code, { window = 1, step = 30 } = {}) {
  if (!secret || !code) return false;
  const cleanCode = String(code).replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const counter = Math.floor(Date.now() / 1000 / step);
  for (let i = -window; i <= window; i++) {
    if (totpAt(secret, counter + i) === cleanCode) return true;
  }
  return false;
}

// Builds the otpauth:// provisioning URI that authenticator apps read
// (either by scanning a QR code generated from it, or by pasting it into
// an app that accepts a raw URI). accountLabel shows up as the entry's
// name inside the app.
export function buildOtpauthUri(secret, accountLabel, issuer = "Ryde Fashion Admin") {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}
