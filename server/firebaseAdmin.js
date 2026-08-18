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

// Verifies a Firebase ID token and returns its decoded claims (uid, email,
// email_verified, name, ...), or throws if the token is invalid/expired.
export async function verifyFirebaseToken(idToken) {
  if (!isConfigured) {
    throw new Error("Firebase Admin isn't configured on the server (missing FIREBASE_* env vars).");
  }
  return getAuth().verifyIdToken(idToken);
}
