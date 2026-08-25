import React, { useState } from "react";
import { Mail, Send, Check, Headphones, ChevronDown } from "lucide-react";
import * as api from "../api";

const FAQS = [
  {
    q: "How long does delivery take?",
    a: "Orders are shipped via J&T Express. Metro Manila addresses typically arrive in 1\u20133 business days, other Luzon addresses in 1\u20135 days, and Visayas, Mindanao, or island addresses in 3\u20137 days. You'll get a tracking number by email as soon as your order ships.",
  },
  {
    q: "How is the shipping fee calculated?",
    a: "Shipping is calculated automatically at checkout using J&T Express's official rate table, based on your delivery province and the total weight of the items in your cart. Orders over \u20b15,000 ship free.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept online payments via PayMongo (GCash, Maya, and major debit/credit cards) and Cash on Delivery (COD). PayMongo payments are confirmed automatically at checkout, so there's no need to upload any proof of payment.",
  },
  {
    q: "Can I track my order?",
    a: "Yes. Once your order ships, you'll receive a J&T Express tracking number by email. Signed-in customers can also see live order status anytime from their Account dashboard.",
  },
  {
    q: "What is your return or exchange policy?",
    a: "If an item arrives damaged, wrong, or defective, reach out through the form below within 7 days of delivery with your order number and photos, and we'll arrange a replacement or refund.",
  },
  {
    q: "Are your products authentic?",
    a: "Yes, every item we carry is authentic and sourced directly from authorized suppliers. We do not sell replicas or first-copy items.",
  },
  {
    q: "Can I change or cancel my order after placing it?",
    a: "If your order hasn't shipped yet, contact us right away through the support form or our email below and we'll do our best to update or cancel it before it's packed.",
  },
];

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
  const [openFaq, setOpenFaq] = useState(0);

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
    <section className="section support-section" id="support-section">
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

      <div className="faq-block" id="faq">
        <div className="section-head">
          <p className="eyebrow">Good to know</p>
          <h2>Frequently Asked Questions</h2>
        </div>
        <div className="faq-list">
          {FAQS.map((item, i) => {
            const isOpen = openFaq === i;
            return (
              <div className={`faq-item ${isOpen ? "open" : ""}`} key={item.q}>
                <button
                  type="button"
                  className="faq-question"
                  onClick={() => setOpenFaq(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                >
                  <span>{item.q}</span>
                  <ChevronDown size={16} className="faq-chevron" />
                </button>
                {isOpen && <p className="faq-answer">{item.a}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
