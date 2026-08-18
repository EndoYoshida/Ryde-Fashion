import React, { useState } from "react";
import { X, Mail, User, Phone, AtSign } from "lucide-react";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, sendEmailVerification, sendPasswordResetEmail,
  updateProfile,
} from "firebase/auth";
import logo from "../assets/logo.jpg";
import { auth, googleProvider } from "../firebaseConfig";
import PasswordField from "./ui/PasswordField";
import { passwordMeetsRules, PASSWORD_RULE_TEXT } from "../passwordUtils";
import * as api from "../api";

// Firebase's own error codes -> the same friendly copy this form used to
// show for its own hand-rolled validation, so the UX doesn't regress.
function friendlyAuthError(err) {
  switch (err.code) {
    case "auth/email-already-in-use": return "An account with this email already exists.";
    case "auth/invalid-email": return "That doesn't look like a valid email address.";
    case "auth/user-not-found":
    case "auth/invalid-credential": return "Incorrect email or password.";
    case "auth/wrong-password": return "Incorrect password. Please try again.";
    case "auth/too-many-requests": return "Too many attempts. Please wait a moment and try again.";
    case "auth/popup-closed-by-user": return "Google sign-in was closed before finishing.";
    case "auth/weak-password": return "That password is too weak.";
    default: return err.message || "Something went wrong. Please try again.";
  }
}

export default function AuthModal({ open, onClose, onAuthSuccess }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", username: "", email: "", phone: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  if (!open) return null;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setResetSent(false);
  };

  // Verifies the signed-in Firebase user with our backend and hands the
  // resulting local session off to the rest of the app — same shape as
  // the old signup/login/google calls did, so nothing downstream changed.
  const finishSignIn = async (username) => {
    const idToken = await auth.currentUser.getIdToken();
    const result = await api.firebaseLogin(idToken, username, form.phone);
    onAuthSuccess(result.token, result.customer);
    setForm({ name: "", username: "", email: "", phone: "", password: "" });
  };

  const handleGoogleClick = async () => {
    setBusy(true);
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
      await finishSignIn();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    setError("");
    if (!form.email.trim()) {
      setError("Enter your email address above first, then tap \"Forgot password\".");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, form.email.trim());
      setResetSent(true);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setResetSent(false);

    if (mode === "signup") {
      if (form.name.trim().length < 3) return setError("Name must be at least 3 characters.");
      if (form.username.trim().length < 3) return setError("Username must be at least 3 characters.");
      if (!/^[a-zA-Z0-9_.]{3,20}$/.test(form.username.trim())) {
        return setError("Username must be 3-20 characters (letters, numbers, underscore, period only).");
      }
      if (!form.email.trim()) return setError("Please enter your email address.");
      if (!passwordMeetsRules(form.password)) {
        return setError(`Password doesn't meet the requirements: ${PASSWORD_RULE_TEXT}`);
      }
    } else if (!form.email.trim() || !form.password) {
      return setError("Please enter your email and password.");
    }

    setBusy(true);
    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, form.email.trim(), form.password);
        await updateProfile(cred.user, { displayName: form.name.trim() });
        sendEmailVerification(cred.user).catch(() => {}); // best-effort, don't block signup on it
        await finishSignIn(form.username.trim());
      } else {
        await signInWithEmailAndPassword(auth, form.email.trim(), form.password);
        await finishSignIn();
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay center" onClick={onClose}>
      <div className="auth-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>

        <div className="auth-mark">
          <img src={logo} alt="Ryde Fashion logo" className="logo-img" />
        </div>
        <p className="eyebrow" style={{ textAlign: "center" }}>Ryde Fashion &amp; Authentic Goods</p>
        <h2 className="auth-title">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
        <p className="auth-sub">
          {mode === "login" ? "Sign in to track orders, save your wishlist, and check out faster." : "Join Ryde to unlock faster checkout and member-only drops."}
        </p>

        <div className="google-btn-wrap">
          <button type="button" className="btn-outline full google-btn" onClick={handleGoogleClick} disabled={busy}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.94v2.33A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.03z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z" />
            </svg>
            Continue with Google
          </button>
        </div>

        <div className="auth-divider"><span>or {mode === "login" ? "sign in" : "sign up"} with email</span></div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" && (
            <>
              <div className="input-wrap">
                <User size={15} />
                <input placeholder="Full name" value={form.name} onChange={set("name")} />
              </div>
              <div className="input-wrap">
                <AtSign size={15} />
                <input placeholder="Username (for your profile)" value={form.username} onChange={set("username")} />
              </div>
              <div className="input-wrap">
                <Phone size={15} />
                <input placeholder="Phone number (optional)" value={form.phone} onChange={set("phone")} />
              </div>
            </>
          )}

          <div className="input-wrap">
            <Mail size={15} />
            <input type="email" placeholder="Email address" value={form.email} onChange={set("email")} autoComplete="email" />
          </div>

          <PasswordField
            value={form.password}
            onChange={set("password")}
            showStrength={mode === "signup"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
          {mode === "signup" && (
            <p className="admin-field-hint" style={{ marginTop: -6 }}>{PASSWORD_RULE_TEXT}</p>
          )}
          {mode === "login" && (
            <button type="button" className="forgot-link" onClick={handleForgotPassword} disabled={busy}>
              Forgot password?
            </button>
          )}

          {resetSent && <p className="review-thanks">Password reset email sent — check your inbox.</p>}
          {error && <p className="admin-form-error">{error}</p>}

          <button type="submit" className="btn-gold full" disabled={busy}>
            {busy ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login" ? "New to Ryde?" : "Already have an account?"}{" "}
          <button onClick={() => switchMode(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
