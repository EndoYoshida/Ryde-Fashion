import React, { useState, useEffect, useRef } from "react";
import { X, Mail, User, Phone, AtSign } from "lucide-react";
import logo from "../assets/logo.jpg";
import { GOOGLE_CLIENT_ID } from "../googleConfig";
import PasswordField from "./ui/PasswordField";
import { passwordMeetsRules, PASSWORD_RULE_TEXT } from "../passwordUtils";
import * as api from "../api";

export default function AuthModal({ open, onClose, onAuthSuccess }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", username: "", email: "", phone: "", password: "", identifier: "" });
  const [error, setError] = useState("");
  const [notRegistered, setNotRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const googleBtnRef = useRef(null);

  const handleGoogleCredential = async (response) => {
    setBusy(true);
    setError("");
    setNotRegistered(false);
    try {
      const result = await api.googleLogin(response.credential);
      onAuthSuccess(result.token, result.customer);
    } catch (err) {
      setError(err.message || "Google sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Renders Google's real sign-in button once the GIS script (loaded in
  // index.html) is ready. Re-renders when the modal reopens or the
  // login/signup mode changes, since Google's button label follows it.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let attempts = 0;

    const tryInit = () => {
      if (cancelled) return;
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredential,
        });
        if (googleBtnRef.current) {
          googleBtnRef.current.innerHTML = "";
          window.google.accounts.id.renderButton(googleBtnRef.current, {
            theme: "outline",
            size: "large",
            shape: "pill",
            width: 320,
            text: mode === "signup" ? "signup_with" : "signin_with",
          });
        }
      } else if (attempts < 20) {
        attempts++;
        setTimeout(tryInit, 150);
      }
    };
    tryInit();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  if (!open) return null;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setNotRegistered(false);
    // Carry whatever they typed as an identifier over to signup's email field, if it looks like one.
    if (next === "signup" && form.identifier.includes("@")) {
      setForm((f) => ({ ...f, email: f.identifier }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotRegistered(false);

    if (mode === "signup") {
      if (form.name.trim().length < 3) {
        setError("Name must be at least 3 characters.");
        return;
      }
      if (form.username.trim().length < 3) {
        setError("Username must be at least 3 characters.");
        return;
      }
      if (!form.email.trim()) {
        setError("Please enter your email address.");
        return;
      }
      if (!passwordMeetsRules(form.password)) {
        setError(`Password doesn't meet the requirements: ${PASSWORD_RULE_TEXT}`);
        return;
      }
    } else if (!form.identifier.trim() || !form.password) {
      setError("Please enter your email/username and password.");
      return;
    }

    setBusy(true);
    try {
      const result = mode === "signup"
        ? await api.signupCustomer(form.name, form.username, form.email, form.password, form.phone)
        : await api.loginCustomer(form.identifier, form.password);
      onAuthSuccess(result.token, result.customer);
      setForm({ name: "", username: "", email: "", phone: "", password: "", identifier: "" });
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      if (err.notRegistered) setNotRegistered(true);
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

        <div className="google-btn-wrap" ref={googleBtnRef} />

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
                <input placeholder="Username (for easy login)" value={form.username} onChange={set("username")} />
              </div>
              <div className="input-wrap">
                <Mail size={15} />
                <input type="email" placeholder="Email address" value={form.email} onChange={set("email")} />
              </div>
              <div className="input-wrap">
                <Phone size={15} />
                <input placeholder="Phone number (optional)" value={form.phone} onChange={set("phone")} />
              </div>
            </>
          )}

          {mode === "login" && (
            <div className="input-wrap">
              <AtSign size={15} />
              <input placeholder="Email or username" value={form.identifier} onChange={set("identifier")} />
            </div>
          )}

          <PasswordField
            value={form.password}
            onChange={set("password")}
            showStrength={mode === "signup"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
          {mode === "signup" && (
            <p className="admin-field-hint" style={{ marginTop: -6 }}>{PASSWORD_RULE_TEXT}</p>
          )}

          {error && (
            <p className="admin-form-error">
              {error}
              {notRegistered && (
                <>
                  {" "}
                  <button type="button" className="auth-inline-link" onClick={() => switchMode("signup")}>
                    Sign up now &rarr;
                  </button>
                </>
              )}
            </p>
          )}

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
