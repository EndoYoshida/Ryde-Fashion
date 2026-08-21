// Usage:
//   node scripts/check-orphaned-firebase-user.js someone@example.com
//   node scripts/check-orphaned-firebase-user.js someone@example.com --delete
//
// Checks whether an email is registered in Firebase Auth but has no
// matching row in the local `customers` table (i.e. signup got interrupted
// after step 1 (Firebase) and before step 2 (POST /api/auth/firebase),
// or the customer deleted their account before Firebase cleanup existed).
// Pass --delete to actually remove the orphaned Firebase user, freeing the
// email up to sign up again. Without --delete, it only reports.

import { db } from "../db/index.js";
import { getFirebaseUserByEmail, deleteFirebaseUser, isFirebaseConfigured } from "../firebaseAdmin.js";

const email = process.argv[2]?.trim().toLowerCase();
const shouldDelete = process.argv.includes("--delete");

if (!email) {
  console.error("Usage: node scripts/check-orphaned-firebase-user.js <email> [--delete]");
  process.exit(1);
}
if (!isFirebaseConfigured) {
  console.error("Firebase Admin isn't configured (missing FIREBASE_* env vars in server/.env).");
  process.exit(1);
}

const [firebaseUser, customerRow] = await Promise.all([
  getFirebaseUserByEmail(email),
  db.prepare("SELECT id, name, email, firebase_uid, status FROM customers WHERE email = ?").get(email),
]);

console.log(`\nEmail: ${email}`);
console.log("--- Firebase Auth ---");
if (!firebaseUser) {
  console.log("No Firebase user found with this email. Nothing to clean up.");
  process.exit(0);
}
console.log(`Found: uid=${firebaseUser.uid}, emailVerified=${firebaseUser.emailVerified}, created=${firebaseUser.metadata.creationTime}`);

console.log("--- customers table ---");
if (customerRow) {
  console.log(`Found row: id=${customerRow.id}, firebase_uid=${customerRow.firebase_uid}, status=${customerRow.status}`);
  if (customerRow.firebase_uid === firebaseUser.uid) {
    console.log("\nThis Firebase user IS linked to an existing customer row — not orphaned. Nothing to do.");
    process.exit(0);
  }
  console.log("\nNote: customers row exists but its firebase_uid doesn't match — investigate before deleting.");
} else {
  console.log("No matching customers row for this email.");
  console.log("\n=> This is an orphaned Firebase user: it exists in Firebase but has no local account,");
  console.log("   so signup will keep failing with 'email already exists' until it's removed.");
}

if (shouldDelete) {
  console.log(`\nDeleting Firebase user ${firebaseUser.uid}...`);
  await deleteFirebaseUser(firebaseUser.uid);
  console.log("Done. This email can now be used to sign up again.");
} else {
  console.log("\nRe-run with --delete to remove this Firebase user and free up the email.");
}
