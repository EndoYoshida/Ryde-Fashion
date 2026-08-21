import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// Server-side verification of Firebase ID tokens. This never trusts
// anything the client claims about itself (email, uid, verified status) —
// it asks Google's servers to cryptographically confirm the token before
// any of those claims are used.
//
// Requires three env vars (from the Firebase Console: Project settings ->
// Service accounts -> Generate new private key):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (keep the \n escapes — see .env.example)

const isConfigured = !!(
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
);

if (isConfigured && !getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Env vars can't hold real newlines, so the .env file stores them as
      // literal "\n" and we convert those back here.
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

export const isFirebaseConfigured = isConfigured;

// Where Firebase should send the browser back to after the person clicks
// the verification/reset link in the email (its own "continue URL", not
// this app's API) — i.e. the storefront itself.
//
// FRONTEND_ORIGIN may be a comma-separated list (same env var used for the
// CORS allow-list in index.js, which does support multiple origins) — but
// Firebase's continue URL must be a single valid URL, so only the first
// origin in the list is used here.
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",")[0]
  .trim();
const actionCodeSettings = { url: FRONTEND_ORIGIN, handleCodeInApp: false };

// Generates the actual verification/reset link using Firebase's own
// servers (same security/expiry as Firebase's built-in email), but
// *without* Firebase also emailing it — that's left to the caller, so a
// custom, on-brand email (see server/emailTemplates.js) can be sent
// instead of Firebase's default template. Throws the same errors
// Firebase's client SDK would (e.g. no account with that email), so
// callers can reuse the same friendly-error handling.
export async function generateVerificationLink(email) {
  if (!isConfigured) {
    throw new Error("Firebase Admin isn't configured on the server (missing FIREBASE_* env vars).");
  }
  return getAuth().generateEmailVerificationLink(email, actionCodeSettings);
}

export async function generatePasswordResetLink(email) {
  if (!isConfigured) {
    throw new Error("Firebase Admin isn't configured on the server (missing FIREBASE_* env vars).");
  }
  return getAuth().generatePasswordResetLink(email, actionCodeSettings);
}

// Verifies a Firebase ID token and returns its decoded claims (uid, email,
// email_verified, name, ...), or throws if the token is invalid/expired.
export async function verifyFirebaseToken(idToken) {
  if (!isConfigured) {
    throw new Error("Firebase Admin isn't configured on the server (missing FIREBASE_* env vars).");
  }
  return getAuth().verifyIdToken(idToken);
}

// Looks up a Firebase Auth user by email. Returns null (not a throw) when
// no such user exists, so callers can use this as a simple existence
// check — e.g. "is this email already in Firebase but missing from our
// customers table?" Throws for any other Firebase error.
export async function getFirebaseUserByEmail(email) {
  if (!isConfigured) {
    throw new Error("Firebase Admin isn't configured on the server (missing FIREBASE_* env vars).");
  }
  try {
    return await getAuth().getUserByEmail(email);
  } catch (err) {
    if (err.code === "auth/user-not-found") return null;
    throw err;
  }
}

// Deletes a Firebase Auth user by uid. Used when we soft-delete a customer
// (DELETE /api/auth/me) so their email is freed up to sign up again, and
// as a cleanup tool for accounts that got orphaned before that fix existed.
// No-ops (does not throw) if the user is already gone.
export async function deleteFirebaseUser(uid) {
  if (!isConfigured) {
    throw new Error("Firebase Admin isn't configured on the server (missing FIREBASE_* env vars).");
  }
  try {
    await getAuth().deleteUser(uid);
  } catch (err) {
    if (err.code === "auth/user-not-found") return;
    throw err;
  }
}

// Lists every Firebase Auth user in the project. Firebase's listUsers()
// API caps each page at 1000 users and returns a pageToken for the next
// page, so this loops until there's no pageToken left, collecting every
// user into one array. Used by the reconciliation script, which needs the
// full user list to diff against the local `customers` table — there's no
// way to ask Firebase "which of these emails don't exist locally" other
// than pulling the whole list and comparing client-side.
export async function listAllFirebaseUsers() {
  if (!isConfigured) {
    throw new Error("Firebase Admin isn't configured on the server (missing FIREBASE_* env vars).");
  }
  const users = [];
  let pageToken;
  do {
    const result = await getAuth().listUsers(1000, pageToken);
    users.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);
  return users;
}