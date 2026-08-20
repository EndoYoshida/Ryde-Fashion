// Run with: node scripts/generate-totp-secret.js [your-admin-username]
//
// Generates a new MFA secret for the admin login and prints everything
// needed to finish setup: the .env line to add, and how to load it into
// an authenticator app (Google Authenticator, Authy, 1Password, etc.).
import { generateBase32Secret, buildOtpauthUri } from "../totp.js";

const username = process.argv[2] || process.env.ADMIN_USERNAME || "admin";
const secret = generateBase32Secret();
const uri = buildOtpauthUri(secret, username);

console.log("\n1. Add this line to server/.env:\n");
console.log(`   ADMIN_TOTP_SECRET=${secret}\n`);
console.log("2. Set up your authenticator app using EITHER of these:\n");
console.log(`   - Manual entry ("enter a setup key" / "can't scan?"): ${secret}`);
console.log(`   - Or paste this URI into any otpauth:// -> QR code generator and scan the result:\n`);
console.log(`     ${uri}\n`);
console.log("3. Restart the server. The admin login will now ask for a 6-digit code after your password.\n");
console.log("Keep this secret private — anyone with it can generate valid codes for your admin account.\n");
