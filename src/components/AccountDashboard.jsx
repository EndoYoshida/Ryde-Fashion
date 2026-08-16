import React, { useState, useEffect } from "react";
import { User, Mail, Phone, MapPin, Lock, LogOut, Package, Check } from "lucide-react";
import { peso } from "../data/products";
import PasswordField from "./ui/PasswordField";
import { passwordMeetsRules, PASSWORD_RULE_TEXT } from "../passwordUtils";
import * as api from "../api";

const ORDER_STATUS_CLASS = {
  pending: "badge-soon", approved: "badge-ok", shipped: "badge-ok",
  delivered: "badge-ok", cancelled: "badge-off",
};

export default function AccountDashboard({ customer, updateProfile, onLogout, setView }) {
  const [tab, setTab] = useState("profile");

  return (
    <section className="section account-section">
      <div className="section-head">
        <p className="eyebrow">My Account</p>
        <h2>Hi, {customer.name.split(" ")[0]}</h2>
      </div>

      <div className="account-layout">
        <aside className="account-nav">
          <button className={`admin-nav-item ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>
            <User size={16} /> Profile
          </button>
          <button className={`admin-nav-item ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}>
            <Package size={16} /> Order History
          </button>
          <button className={`admin-nav-item ${tab === "password" ? "active" : ""}`} onClick={() => setTab("password")}>
            <Lock size={16} /> Change Password
          </button>
          <button className="admin-nav-item admin-logout" onClick={onLogout}>
            <LogOut size={16} /> Log out
          </button>
        </aside>

        <div className="account-content">
          {tab === "profile" && <ProfileTab customer={customer} updateProfile={updateProfile} />}
          {tab === "orders" && <OrdersTab />}
          {tab === "password" && <PasswordTab />}
        </div>
      </div>
    </section>
  );
}

function ProfileTab({ customer, updateProfile }) {
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
          <div className="input-wrap"><Mail size={15} /><input value={customer.email} disabled /></div>
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
