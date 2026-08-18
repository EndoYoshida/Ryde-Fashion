import React, { useState } from "react";
import { Mail, Send, Check, Headphones } from "lucide-react";
import * as api from "../api";

export default function SupportPage({ customer }) {
  const [form, setForm] = useState({
    name: customer?.name || "",
    email: customer?.email || "",
    subject: "",
    message: "",
  });
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.subject.trim() || !form.message.trim()) {
      setError("Please fill in every field.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.createTicket({
        customer: form.name.trim(),
        email: form.email.trim(),
        subject: form.subject.trim(),
        message: form.message.trim(),
      });
      setSent(true);
      setForm((f) => ({ ...f, subject: "", message: "" }));
    } catch (err) {
      setError(err.message || "Something went wrong sending your message. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section support-section">
      <div className="section-head">
        <p className="eyebrow">We&rsquo;re here to help</p>
        <h2>Customer Support</h2>
        <p className="lede" style={{ maxWidth: 480, margin: "10px auto 0" }}>
          Send us a message and our team will reply directly to your email.
          {customer && " You can also see this conversation anytime from your account's Support Tickets."}
        </p>
      </div>

      <div className="support-layout">
        <div className="support-form-panel">
          {sent ? (
            <div className="support-sent">
              <Check size={32} color="#C9A15F" />
              <h4>Message sent</h4>
              <p className="admin-empty" style={{ padding: 0 }}>
                We&rsquo;ve received your message and will get back to you by email shortly.
              </p>
              <button className="btn-outline" onClick={() => setSent(false)}>Send another message</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="admin-form">
              <div className="form-row two">
                <input placeholder="Your name" value={form.name} onChange={set("name")} />
                <input placeholder="Your email" value={form.email} onChange={set("email")} />
              </div>
              <input placeholder="Subject" value={form.subject} onChange={set("subject")} />
              <textarea placeholder="How can we help?" rows={6} value={form.message} onChange={set("message")} />
              {error && <p className="admin-form-error">{error}</p>}
              <button type="submit" className="btn-gold" disabled={busy} style={{ alignSelf: "flex-start" }}>
                <Send size={15} /> {busy ? "Sending..." : "Send Message"}
              </button>
            </form>
          )}
        </div>

        <div className="support-info-panel">
          <h4><Headphones size={16} /> Other ways to reach us</h4>
          <p className="admin-field-hint" style={{ marginBottom: 14 }}>
            Prefer email directly? Reach us anytime at:
          </p>
          <a className="support-email-link" href="mailto:rydecompany.ph@gmail.com">
            <Mail size={15} /> rydecompany.ph@gmail.com
          </a>
          <p className="admin-field-hint" style={{ marginTop: 18 }}>
            We typically respond within 1&ndash;2 business days.
          </p>
        </div>
      </div>
    </section>
  );
}
