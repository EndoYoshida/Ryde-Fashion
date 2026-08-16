import React, { useState } from "react";
import { Lock, User, Loader2 } from "lucide-react";
import logo from "../../assets/logo.jpg";
import * as api from "../../api";

export default function AdminLogin({ onLoginSuccess, onBack }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const { token } = await api.loginAdmin(username.trim(), password);
      onLoginSuccess(token);
    } catch (err) {
      setError(err.message || "Login failed");
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

          {error && <p className="admin-form-error">{error}</p>}

          <button type="submit" className="btn-gold full" disabled={busy}>
            {busy ? <><Loader2 size={15} className="admin-spin" /> Signing in...</> : "Sign In"}
          </button>
        </form>

        <button className="admin-login-back" onClick={onBack}>&larr; Back to store</button>
      </div>
    </div>
  );
}
