// Generates the value to put in ADMIN_PASSWORD_HASH in server/.env.
//
// Usage (run from the server/ folder):
//   node scripts/hash-admin-password.js "your new password"
//
// Copy the output into .env as:
//   ADMIN_PASSWORD_HASH=<output>
// Then restart the server. The plaintext password is never stored anywhere.

import { hashPassword } from "../customerAuth.js";

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-admin-password.js "your password"');
  process.exit(1);
}
if (password.length < 12) {
  console.warn("Warning: that's a short password for an admin account with full store access. Consider something longer.");
}

console.log(hashPassword(password));
