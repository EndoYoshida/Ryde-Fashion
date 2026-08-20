import React, { useState, useEffect } from "react";
import { User, Mail, Phone, MapPin, Lock, LogOut, Package, Check, ShieldCheck, Headphones, AlertTriangle, Trash2 } from "lucide-react";
import { sendEmailVerification, sendPasswordResetEmail } from "firebase/auth";
import { peso } from "../data/products";
import { auth } from "../firebaseConfig";
import * as api from "../api";
import SearchableSelect from "./ui/SearchableSelect";
import { usePhAddressCascade } from "../hooks/usePhAddressCascade";

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
          {tab === "password" && <PasswordTab customer={customer} />}
          {tab === "delete" && <DeleteAccountTab customer={customer} onLogout={onLogout} />}
        </div>
      </div>
    </section>
  );
}

function ProfileTab({ customer, updateProfile, onGoToVerify }) {
  const [form, setForm] = useState({
    name: customer.name,
    phoneCountryCode: customer.phoneCountryCode || "+63",
    phone: (customer.phone || "").replace(/\D/g, "").slice(0, 10),
    addressLine: customer.addressLine || "",
    zipCode: customer.zipCode || "",
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Province/City/Barangay cascade — the same one Checkout uses, so an
  // address saved here resolves to the same real cities (e.g. all of
  // Metro Manila, not just "City of Manila") and checkout can prefill
  // straight from it.
  const {
    address, provinceOptions, cityOptions, barangayOptions,
    loadingCities, loadingBarangays,
    selectProvince, clearProvince, selectCity, clearCity, selectBarangay, clearBarangay,
    hydrate: hydrateAddress,
  } = usePhAddressCascade();

  useEffect(() => {
    hydrateAddress(customer.province, customer.city, customer.barangay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  // Country code: keep a leading "+", digits only after it, capped at 4
  // digits (covers real-world codes like +63, +1, +1268).
  const setPhoneCountryCode = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
    setForm((f) => ({ ...f, phoneCountryCode: digits ? `+${digits}` : "+" }));
  };
  // Phone number: digits only, never past 10 digits.
  const setPhone = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
    setForm((f) => ({ ...f, phone: digits }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await updateProfile({
        ...form,
        province: address.province,
        city: address.city,
        barangay: address.barangay,
      });
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
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={form.phoneCountryCode}
              onChange={setPhoneCountryCode}
              placeholder="+63"
              style={{ width: 62, flexShrink: 0, textAlign: "center" }}
            />
            <div className="input-wrap" style={{ flex: 1 }}>
              <Phone size={15} />
              <input
                value={form.phone}
                onChange={setPhone}
                placeholder="9XXXXXXXXX"
                inputMode="numeric"
                maxLength={10}
              />
            </div>
          </div>
        </label>
        <label>Street address
          <div className="input-wrap"><MapPin size={15} /><input value={form.addressLine} onChange={set("addressLine")} placeholder="House/unit no., street" /></div>
        </label>
        <div className="form-row three">
          <label>Province
            <SearchableSelect
              value={address.province}
              options={provinceOptions}
              onSelect={selectProvince}
              onClear={clearProvince}
              placeholder="Province"
            />
          </label>
          <label>City
            <SearchableSelect
              value={address.city}
              options={cityOptions}
              onSelect={selectCity}
              onClear={clearCity}
              placeholder={address.provinceCode ? "City / Municipality" : "Select province first"}
              disabled={!address.provinceCode}
              loading={loadingCities}
            />
          </label>
          <label>Barangay
            <SearchableSelect
              value={address.barangay}
              options={barangayOptions}
              onSelect={selectBarangay}
              onClear={clearBarangay}
              placeholder={address.cityCode ? "Barangay" : "Select city first"}
              disabled={!address.cityCode}
              loading={loadingBarangays}
            />
          </label>
        </div>
        <label>ZIP code
          <input value={form.zipCode} onChange={set("zipCode")} placeholder="ZIP code" style={{ maxWidth: 140 }} />
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  // Firebase owns the actual verification link/click now. "I've verified"
  // force-refreshes the Firebase ID token (which picks up the latest
  // emailVerified claim) and re-syncs it to our backend, since our own
  // customer row only updates when it sees a fresh token.
  const handleCheckVerified = async () => {
    setBusy(true);
    setError("");
    try {
      await auth.currentUser.reload();
      const idToken = await auth.currentUser.getIdToken(true);
      const result = await api.firebaseLogin(idToken);
      onCustomerUpdated(result.customer);
      if (!result.customer.emailVerified) {
        setError("Still not verified yet — check your inbox (and spam folder) for the link.");
      }
    } catch (err) {
      setError(err.message || "Couldn't check verification status.");
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setBusy(true);
    setError("");
    try {
      await sendEmailVerification(auth.currentUser);
      setResent(true);
      setTimeout(() => setResent(false), 4000);
    } catch (err) {
      setError(err.code === "auth/too-many-requests"
        ? "Please wait a bit before requesting another email."
        : (err.message || "Couldn't resend the verification email."));
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
        We sent a verification link to <strong>{customer.email}</strong>. Click it, then come back here
        and tap &ldquo;I&rsquo;ve verified.&rdquo; If you can&rsquo;t find it, check spam, or request a new one.
      </p>
      {error && <p className="admin-form-error">{error}</p>}
      {resent && <p className="review-thanks"><Check size={14} /> Verification email sent</p>}
      <div className="admin-form-actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="btn-gold" onClick={handleCheckVerified} disabled={busy}>
          {busy ? "Checking..." : "I've verified"}
        </button>
        <button type="button" className="btn-outline" onClick={handleResend} disabled={busy}>Resend email</button>
      </div>
    </div>
  );
}

function PasswordTab({ customer }) {
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  // Passwords now live entirely in Firebase — the cleanest, most secure
  // way to change one without re-collecting the current password here is
  // to send the standard Firebase reset-password email.
  const handleSendReset = async () => {
    setBusy(true);
    setError("");
    try {
      await sendPasswordResetEmail(auth, customer.email);
      setSent(true);
    } catch (err) {
      setError(err.code === "auth/too-many-requests"
        ? "Please wait a bit before requesting another email."
        : (err.message || "Couldn't send the reset email."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-panel">
      <h4>Change password</h4>
      <p className="admin-field-hint" style={{ marginBottom: 16 }}>
        For your security, password changes go through a reset link emailed to <strong>{customer.email}</strong>{" "}
        rather than being set directly here.{" "}
        {customer.emailVerified === false && "(Note: if you signed up with Google, you don't have a password to reset.)"}
      </p>
      {error && <p className="admin-form-error">{error}</p>}
      {sent && <p className="review-thanks"><Check size={14} /> Reset email sent — check your inbox</p>}
      <button type="button" className="btn-gold" onClick={handleSendReset} disabled={busy || sent}>
        {busy ? "Sending..." : sent ? "Email sent" : "Send password reset email"}
      </button>
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
  const [confirmText, setConfirmText] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleRequestDeletion = async (e) => {
    e.preventDefault();
    if (confirmText.trim().toUpperCase() !== "DELETE") {
      setError('Type "DELETE" to confirm.');
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
      await api.deleteAccount(withCode);
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
          <label>Type DELETE to confirm
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
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
