import React, { useState, useEffect } from "react";
import { User, Mail, Phone, MapPin, Lock, LogOut, Package, Check, ShieldCheck, Headphones, AlertTriangle, Trash2 } from "lucide-react";
import { peso } from "../data/products";
import PasswordField from "./ui/PasswordField";
import { passwordMeetsRules, PASSWORD_RULE_TEXT } from "../passwordUtils";
import * as api from "../api";

const ORDER_STATUS_CLASS = {
  pending: "badge-soon", approved: "badge-ok", shipped: "badge-ok",
  delivered: "badge-ok", cancelled: "badge-off",
};

export default function AccountDashboard({ customer, updateProfile, onCustomerUpdated, onLogout, setView }) {
  const [tab, setTab] = useState(customer.emailVerified ? "profile" : "verify");

  return (
    <section className="section account-section">
      <div className="section-head">
        <p className="eyebrow">My Account</p>
        <h2>Hi, {customer.name.split(" ")[0]}</h2>
      </div>

      {!customer.emailVerified && tab !== "verify" && (
        <div className="verify-banner">
          <ShieldCheck size={15} />
          Your email isn&rsquo;t verified yet.
          <button onClick={() => setTab("verify")}>Verify now &rarr;</button>
        </div>
      )}

      <div className="account-layout">
        <aside className="account-nav">
          <button className={`admin-nav-item ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>
            <User size={16} /> Profile
          </button>
          {!customer.emailVerified && (
            <button className={`admin-nav-item ${tab === "verify" ? "active" : ""}`} onClick={() => setTab("verify")}>
              <ShieldCheck size={16} /> Verify Email
            </button>
          )}
          <button className={`admin-nav-item ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}>
            <Package size={16} /> Order History
          </button>
          <button className={`admin-nav-item ${tab === "support" ? "active" : ""}`} onClick={() => setTab("support")}>
            <Headphones size={16} /> My Support Tickets
          </button>
          <button className={`admin-nav-item ${tab === "password" ? "active" : ""}`} onClick={() => setTab("password")}>
            <Lock size={16} /> Change Password
          </button>
          <button className={`admin-nav-item admin-danger-nav ${tab === "delete" ? "active" : ""}`} onClick={() => setTab("delete")}>
            <Trash2 size={16} /> Delete Account
          </button>
          <button className="admin-nav-item admin-logout" onClick={onLogout}>
            <LogOut size={16} /> Log out
          </button>
        </aside>

        <div className="account-content">
          {tab === "profile" && <ProfileTab customer={customer} updateProfile={updateProfile} onGoToVerify={() => setTab("verify")} />}
          {tab === "verify" && <VerifyTab customer={customer} onCustomerUpdated={onCustomerUpdated} />}
          {tab === "orders" && <OrdersTab />}
          {tab === "support" && <SupportTab />}
          {tab === "password" && <PasswordTab />}
          {tab === "delete" && <DeleteAccountTab customer={customer} onLogout={onLogout} />}
        </div>
      </div>
    </section>
  );
}

function ProfileTab({ customer, updateProfile, onGoToVerify }) {
  const [form, setForm] = useState({ name: customer.name, phone: customer.phone || "", address: customer.address || "" });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await updateProfile(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.message || "Couldn't save your changes.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-panel">
      <h4>Your information</h4>
      <form onSubmit={handleSubmit} className="admin-form">
        <label>Full name
          <div className="input-wrap"><User size={15} /><input value={form.name} onChange={set("name")} /></div>
        </label>
        <label>Email
          <div className="input-wrap email-field-row">
            <Mail size={15} />
            <input value={customer.email} disabled />
            {customer.emailVerified ? (
              <ShieldCheck size={15} color="#4C7031" style={{ flexShrink: 0 }} />
            ) : (
              <button type="button" className="btn-outline small email-verify-btn" onClick={onGoToVerify}>
                Verify
              </button>
            )}
          </div>
          {customer.emailVerified
            ? <span className="admin-field-hint" style={{ color: "#4C7031" }}>Verified</span>
            : <span className="admin-field-hint">Not verified yet</span>}
        </label>
        <label>Phone number
          <div className="input-wrap"><Phone size={15} /><input value={form.phone} onChange={set("phone")} placeholder="09XX XXX XXXX" /></div>
        </label>
        <label>Shipping address
          <div className="input-wrap"><MapPin size={15} /><input value={form.address} onChange={set("address")} placeholder="Street, barangay, city, province" /></div>
        </label>

        {error && <p className="admin-form-error">{error}</p>}
        <div className="admin-form-actions" style={{ justifyContent: "flex-start" }}>
          <button type="submit" className="btn-gold" disabled={busy}>{busy ? "Saving..." : "Save Changes"}</button>
          {saved && <span className="review-thanks"><Check size={14} /> Saved</span>}
        </div>
      </form>
    </div>
  );
}

function VerifyTab({ customer, onCustomerUpdated }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.verifyEmail(code.trim());
      onCustomerUpdated(result.customer);
    } catch (err) {
      setError(err.message || "Couldn't verify that code.");
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setBusy(true);
    setError("");
    try {
      await api.resendVerification();
      setResent(true);
      setTimeout(() => setResent(false), 4000);
    } catch (err) {
      setError(err.message || "Couldn't resend the code.");
    } finally {
      setBusy(false);
    }
  };

  if (customer.emailVerified) {
    return (
      <div className="account-panel">
        <h4><ShieldCheck size={17} color="#4C7031" style={{ verticalAlign: "-3px", marginRight: 6 }} />Email verified</h4>
        <p className="admin-empty" style={{ padding: 0 }}>You&rsquo;re all set — no further action needed.</p>
      </div>
    );
  }

  return (
    <div className="account-panel">
      <h4>Verify your email</h4>
      <p className="admin-field-hint" style={{ marginBottom: 16 }}>
        We sent a 6-digit code to <strong>{customer.email}</strong> when you signed up. Enter it below.
        If you can&rsquo;t find it, check spam, or request a new one.
      </p>
      <form onSubmit={handleVerify} className="admin-form" style={{ maxWidth: 260 }}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          inputMode="numeric"
          style={{ fontSize: 20, letterSpacing: 6, textAlign: "center" }}
        />
        {error && <p className="admin-form-error">{error}</p>}
        {resent && <p className="review-thanks"><Check size={14} /> New code sent</p>}
        <div className="admin-form-actions" style={{ justifyContent: "flex-start" }}>
          <button type="submit" className="btn-gold" disabled={busy || code.length !== 6}>Verify</button>
          <button type="button" className="btn-outline" onClick={handleResend} disabled={busy}>Resend code</button>
        </div>
      </form>
    </div>
  );
}

function PasswordTab() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!passwordMeetsRules(form.newPassword)) {
      return setError(`New password doesn't meet the requirements: ${PASSWORD_RULE_TEXT}`);
    }
    if (form.newPassword !== form.confirm) return setError("New password and confirmation don't match.");

    setBusy(true);
    try {
      await api.changeMyPassword(form.currentPassword, form.newPassword);
      setSuccess(true);
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message || "Couldn't change your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-panel">
      <h4>Change password</h4>
      <form onSubmit={handleSubmit} className="admin-form">
        <label>Current password
          <PasswordField value={form.currentPassword} onChange={set("currentPassword")} autoComplete="current-password" />
        </label>
        <label>New password
          <PasswordField value={form.newPassword} onChange={set("newPassword")} showStrength autoComplete="new-password" />
          <span className="admin-field-hint">{PASSWORD_RULE_TEXT}</span>
        </label>
        <label>Confirm new password
          <PasswordField value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
        </label>

        {error && <p className="admin-form-error">{error}</p>}
        <div className="admin-form-actions" style={{ justifyContent: "flex-start" }}>
          <button type="submit" className="btn-gold" disabled={busy}>{busy ? "Updating..." : "Update Password"}</button>
          {success && <span className="review-thanks"><Check size={14} /> Password updated</span>}
        </div>
      </form>
    </div>
  );
}

function OrdersTab() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getMyOrders().then(setOrders).catch((err) => setError(err.message || "Couldn't load your orders."));
  }, []);

  if (error) return <div className="account-panel"><p className="admin-form-error">{error}</p></div>;
  if (orders === null) return <div className="account-panel"><p className="admin-empty">Loading your orders...</p></div>;
  if (orders.length === 0) {
    return <div className="account-panel"><p className="admin-empty">You haven&rsquo;t placed any orders yet.</p></div>;
  }

  return (
    <div className="account-panel">
      <h4>Order history</h4>
      <p className="admin-field-hint" style={{ marginBottom: 14 }}>A receipt was also emailed to you for each order below.</p>
      <div className="admin-ticket-list">
        {orders.map((o) => (
          <div className="admin-ticket-card" key={o.id}>
            <div className="admin-ticket-head">
              <div>
                <strong>{o.id}</strong>
                <span className="admin-mini-sub"> &middot; {o.date}</span>
              </div>
              <span className={`status-badge inline ${ORDER_STATUS_CLASS[o.status] || "badge-soon"}`}>{o.status}</span>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0", fontSize: 13.5 }}>
              {o.items.map((it, i) => (
                <li key={i}>{it.name} &times; {it.qty} — {peso(it.price * it.qty)}</li>
              ))}
            </ul>
            <p className="admin-mini-sub" style={{ margin: 0 }}>Total: {peso(o.total)} &middot; Payment: {o.paymentStatus}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeleteAccountTab({ customer, onLogout }) {
  const [step, setStep] = useState("confirm"); // confirm -> code (if verified) -> done
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleRequestDeletion = async (e) => {
    e.preventDefault();
    if (!password) {
      setError("Enter your password to continue.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.requestAccountDeletion();
      if (result.requiresCode) {
        setStep("code");
      } else {
        await finalizeDelete();
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const finalizeDelete = async (withCode) => {
    setBusy(true);
    setError("");
    try {
      await api.deleteAccount(password, withCode);
      onLogout();
    } catch (err) {
      setError(err.message || "Couldn't delete your account.");
      setBusy(false);
    }
  };

  const handleConfirmCode = (e) => {
    e.preventDefault();
    if (code.length !== 6) return;
    finalizeDelete(code.trim());
  };

  return (
    <div className="account-panel danger-zone">
      <h4><AlertTriangle size={17} color="#9B4646" style={{ verticalAlign: "-3px", marginRight: 6 }} />Delete Account</h4>
      <p className="admin-field-hint" style={{ marginBottom: 18 }}>
        This deactivates your account — you won&rsquo;t be able to sign in again with it, and your profile
        will no longer be visible to you. Your past orders, ratings, and support tickets stay on record for
        our books, and this can&rsquo;t be undone by you.
      </p>

      {step === "confirm" && (
        <form onSubmit={handleRequestDeletion} className="admin-form" style={{ maxWidth: 300 }}>
          <label>Confirm your password
            <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <p className="admin-form-error">{error}</p>}
          <button type="submit" className="btn-delete" disabled={busy}>
            {busy ? "Please wait..." : "Delete My Account"}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={handleConfirmCode} className="admin-form" style={{ maxWidth: 260 }}>
          <p className="admin-field-hint" style={{ marginBottom: 4 }}>
            Since your email is verified, we sent a confirmation code to <strong>{customer.email}</strong>.
            Enter it below to confirm deactivating your account.
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            style={{ fontSize: 20, letterSpacing: 6, textAlign: "center" }}
          />
          {error && <p className="admin-form-error">{error}</p>}
          <div className="admin-form-actions" style={{ justifyContent: "flex-start" }}>
            <button type="submit" className="btn-delete" disabled={busy || code.length !== 6}>
              {busy ? "Deleting..." : "Confirm Deletion"}
            </button>
            <button type="button" className="btn-outline" onClick={() => setStep("confirm")} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function SupportTab() {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getMyTickets().then(setTickets).catch((err) => setError(err.message || "Couldn't load your support tickets."));
  }, []);

  if (error) return <div className="account-panel"><p className="admin-form-error">{error}</p></div>;
  if (tickets === null) return <div className="account-panel"><p className="admin-empty">Loading your tickets...</p></div>;
  if (tickets.length === 0) {
    return (
      <div className="account-panel">
        <p className="admin-empty">
          No support tickets yet. Visit the Support page to send us a message and it&rsquo;ll show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="account-panel">
      <h4>My support tickets</h4>
      <div className="admin-ticket-list">
        {tickets.map((t) => (
          <div className="admin-ticket-card" key={t.id}>
            <div className="admin-ticket-head">
              <div>
                <strong>{t.subject}</strong>
                <span className="admin-mini-sub"> &middot; {t.id} &middot; {t.date}</span>
              </div>
              <span className={`status-badge inline ${t.status === "resolved" ? "badge-ok" : "badge-soon"}`}>{t.status}</span>
            </div>
            <p className="admin-ticket-message">{t.message}</p>
            {t.replies.length > 0 && (
              <div className="admin-reply-thread">
                {t.replies.map((r) => (
                  <div className="admin-reply-bubble" key={r.id}>
                    <p>{r.body}</p>
                    <span className="admin-mini-sub">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
