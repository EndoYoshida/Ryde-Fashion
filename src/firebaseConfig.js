import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// These values come from the Firebase Console: Project settings -> General
// -> "Your apps" -> the web app's config snippet. Unlike the backend's
// service account credentials, these are NOT secret — they identify your
// Firebase project to the browser the same way a URL does, and are safe
// to ship in frontend code. They still go through env vars here so the
// same build works across local/staging/production Firebase projects
// without editing source.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
