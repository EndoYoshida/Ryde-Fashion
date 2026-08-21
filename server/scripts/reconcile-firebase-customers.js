// Usage (CLI):
//   node scripts/reconcile-firebase-customers.js            # report only
//   node scripts/reconcile-firebase-customers.js --delete    # clean up
//
// Diffs every Firebase Auth user against the local `customers` table and
// flags Firebase users with no matching `firebase_uid` and no matching
// email in `customers` — i.e. signups that got interrupted after step 1
// (Firebase) and before step 2 (POST /api/auth/firebase), or accounts
// deleted before Firebase cleanup existed.
//
// Grace period: a stray is only flagged once its Firebase account is
// older than ONE_HOUR_MS. This is the important safety net — without it,
// a signup that's still mid-flight (Firebase account just created,
// backend sync call still in progress or mid-retry) could get raced and
// deleted out from under a real user.
//
// This module is also imported by reconcile/scheduler.js to run on a
// schedule inside the running server process. It never calls
// process.exit() itself — only the CLI entrypoint below does — so it's
// safe to call in-process without taking the whole server down.

// Run standalone via `node scripts/...`, so unlike index.js this doesn't
// automatically get env vars loaded first — load them here. A harmless
// no-op when this file is ever imported into a process that already
// loaded dotenv itself.
import "dotenv/config";

import { pathToFileURL } from "url";
import { db } from "../db/index.js";
import { listAllFirebaseUsers, deleteFirebaseUser, isFirebaseConfigured } from "../firebaseAdmin.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

// Runs one reconciliation pass. Returns a summary object rather than
// printing/exiting, so callers (CLI or scheduler) can decide what to do
// with the result.
export async function runReconciliation({ delete: shouldDelete = false } = {}) {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase Admin isn't configured (missing FIREBASE_* env vars in server/.env).");
  }

  const [firebaseUsers, customerRows] = await Promise.all([
    listAllFirebaseUsers(),
    db.prepare("SELECT id, email, firebase_uid, status FROM customers").all(),
  ]);

  const byUid = new Map(customerRows.map((c) => [c.firebase_uid, c]));
  const byEmail = new Map(customerRows.map((c) => [c.email?.toLowerCase(), c]));

  const now = Date.now();
  const strays = [];
  const mismatches = [];

  for (const fbUser of firebaseUsers) {
    const matchedByUid = byUid.get(fbUser.uid);
    if (matchedByUid) continue; // properly linked, nothing to flag

    const email = fbUser.email?.toLowerCase();
    const matchedByEmail = email ? byEmail.get(email) : null;

    if (matchedByEmail) {
      // A customers row exists for this email but points at a different
      // (or no) firebase_uid. Could be legitimate (e.g. mid-migration) —
      // flag for a human to look at rather than auto-deleting.
      mismatches.push({
        email: fbUser.email,
        firebaseUid: fbUser.uid,
        customerId: matchedByEmail.id,
        customerFirebaseUid: matchedByEmail.firebase_uid,
      });
      continue;
    }

    const createdMs = Date.parse(fbUser.metadata.creationTime);
    const ageMs = now - createdMs;
    if (ageMs < ONE_HOUR_MS) continue; // still within the grace period — may be mid-signup

    strays.push({
      email: fbUser.email,
      uid: fbUser.uid,
      createdAt: fbUser.metadata.creationTime,
      ageHours: Math.round(ageMs / (60 * 60 * 1000)),
    });
  }

  const deleted = [];
  if (shouldDelete && strays.length) {
    for (const stray of strays) {
      await deleteFirebaseUser(stray.uid);
      deleted.push(stray.email);
    }
  }

  return {
    checkedFirebaseUsers: firebaseUsers.length,
    checkedCustomerRows: customerRows.length,
    strays,
    mismatches,
    deleted,
  };
}

function printReport(summary, { delete: shouldDelete }) {
  console.log(`\nChecked ${summary.checkedFirebaseUsers} Firebase user(s) against ${summary.checkedCustomerRows} customers row(s).`);

  console.log("\n--- Mismatches (needs a human look) ---");
  if (!summary.mismatches.length) {
    console.log("None.");
  } else {
    for (const m of summary.mismatches) {
      console.log(`  ${m.email}: Firebase uid=${m.firebaseUid}, customers.id=${m.customerId} has firebase_uid=${m.customerFirebaseUid ?? "(none)"}`);
    }
  }

  console.log("\n--- Orphaned Firebase users (no customers row, older than 1h) ---");
  if (!summary.strays.length) {
    console.log("None.");
  } else {
    for (const s of summary.strays) {
      console.log(`  ${s.email}: uid=${s.uid}, created=${s.createdAt} (${s.ageHours}h ago)`);
    }
    if (shouldDelete) {
      console.log(`\nDeleted ${summary.deleted.length} orphaned Firebase user(s).`);
    } else {
      console.log("\nRe-run with --delete to remove these and free up their emails.");
    }
  }
  console.log("");
}

// CLI entrypoint — only runs when this file is executed directly (e.g.
// `node scripts/reconcile-firebase-customers.js`), not when imported by
// the scheduler. This is what keeps process.exit() out of the shared
// runReconciliation() function above.
//
// Uses pathToFileURL rather than a plain string comparison because on
// Windows process.argv[1] is a backslash path (F:\...\file.js) while
// import.meta.url is always a forward-slash file:// URL — a naive
// `file://${process.argv[1]}` never matches on Windows and silently skips
// this whole block.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const shouldDelete = process.argv.includes("--delete");
  try {
    const summary = await runReconciliation({ delete: shouldDelete });
    printReport(summary, { delete: shouldDelete });
    process.exit(0);
  } catch (err) {
    console.error("Reconciliation failed:", err.message);
    process.exit(1);
  }
}