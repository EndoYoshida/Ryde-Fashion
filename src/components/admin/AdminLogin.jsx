import React, { useState } from "react";
import { Lock, User, Loader2, ShieldCheck } from "lucide-react";
import logo from "../../assets/logo.jpg";
import * as api from "../../api";

export default function AdminLogin({ onLoginSuccess, onBack }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [mfaStep, setMfaStep] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    if (mfaStep && !totpCode.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.loginAdmin(username.trim(), password, mfaStep ? totpCode.trim() : undefined);
      if (result.mfaRequired) {
        setMfaStep(true);
      } else {
        onLoginSuccess(result.token);
      }
    } catch (err) {
      setError(err.message || "Login failed");
      // A wrong code stays on the code step (don't bounce back to
      // re-asking for the password, which was already correct).
      if (err.mfaRequired) setMfaStep(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-login-shell">
      <div className="admin-login-card">
        <img src={logo} alt="Ryde Fashion logo" className="admin-login-logo" />
        <p className="admin-eyebrow" style={{ textAlign: "center" }}>Ryde Fashion &amp; Authentic Goods</p>
        <h2 className="admin-login-title">Admin Sign In</h2>
        <p className="admin-login-sub">Authorized staff only.</p>

        <form onSubmit={handleSubmit} className="admin-form">
          {!mfaStep ? (
            <>
              <div className="input-wrap">
                <User size={15} />
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div className="input-wrap">
                <Lock size={15} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                />
              </div>
            </>
          ) : (
            <>
              <p className="admin-field-hint" style={{ marginBottom: 4 }}>
                Enter the 6-digit code from your authenticator app.
              </p>
              <div className="input-wrap">
                <ShieldCheck size={15} />
                <input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                />
              </div>
            </>
          )}

          {error && <p className="admin-form-error">{error}</p>}

          <button type="submit" className="btn-gold full" disabled={busy}>
            {busy ? <><Loader2 size={15} className="admin-spin" /> Signing in...</> : mfaStep ? "Verify" : "Sign In"}
          </button>
        </form>

        <button className="admin-login-back" onClick={onBack}>&larr; Back to store</button>
      </div>
    </div>
  );
}
