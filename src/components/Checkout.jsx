import React, { useState, useEffect } from "react";
import { Check, Upload, X } from "lucide-react";
import { peso } from "../data/products";
import * as api from "../api";

const PAYMENT_LABELS = {
  bdo: "Bank Transfer (BDO)",
  unionbank: "Bank Transfer (UnionBank)",
  gcash: "GCash",
  cod: "Cash on Delivery",
};

const PAYMENTS = [
  {
    id: "gcash",
    label: "GCash",
    note: "Send to 0917 000 1234 (Ryde Fashion)",
    detail: "After sending, take a screenshot of the confirmation and upload it below so we can verify your payment.",
  },
  {
    id: "bdo",
    label: "BDO",
    note: "BDO — 0012 3456 7890 (Ryde Fashion Co.)",
    detail: "After transferring, upload a screenshot or photo of your BDO receipt below so we can verify your payment.",
  },
  {
    id: "unionbank",
    label: "UnionBank",
    note: "UnionBank — 1098 7654 3210 (Ryde Fashion Co.)",
    detail: "After transferring, upload a screenshot or photo of your UnionBank receipt below so we can verify your payment.",
  },
  {
    id: "cod",
    label: "Cash on Delivery",
    note: "Pay in cash when your order arrives",
    detail: null,
  },
];

function makeOrderId() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const suffix = Math.floor(100 + Math.random() * 900);
  return `RYDE-${stamp}-${suffix}`;
}

export default function Checkout({ cart, setView, clearCart, onOrderCreated, customer }) {
  const [payment, setPayment] = useState("cod");
  const [proofFile, setProofFile] = useState(null);
  const [proofPreview, setProofPreview] = useState(null);
  const [placed, setPlaced] = useState(null); // holds the created order once placed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proofWarning, setProofWarning] = useState("");

  const [form, setForm] = useState({
    fullName: customer?.name || "", phone: customer?.phone || "", email: customer?.email || "",
    address: customer?.address || "", province: "", city: "", barangay: "", zip: "", notes: "",
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // On first render the customer's profile may not have finished loading
  // yet (e.g. landing straight on /checkout after a refresh, while
  // getMe() is still in flight) — the form above would then start blank.
  // Once it arrives, fill in whichever of these fields the shopper
  // hasn't already typed something into themselves.
  useEffect(() => {
    if (!customer) return;
    setForm((f) => ({
      ...f,
      fullName: f.fullName || customer.name || "",
      phone: f.phone || customer.phone || "",
      email: f.email || customer.email || "",
      address: f.address || customer.address || "",
    }));
  }, [customer]);

  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const shipping = subtotal > 5000 || subtotal === 0 ? 0 : 250;
  const total = subtotal + shipping;
  const selectedPayment = PAYMENTS.find((p) => p.id === payment);
  const needsProof = payment !== "cod";

  const handleFilePicked = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofFile(file);
    setProofPreview(URL.createObjectURL(file));
  };
  const clearProof = () => {
    if (proofPreview) URL.revokeObjectURL(proofPreview);
    setProofFile(null);
    setProofPreview(null);
  };

  const handlePlaceOrder = async () => {
    if (cart.length === 0) return;
    if (!form.fullName.trim() || !form.phone.trim() || !form.email.trim() || !form.address.trim()) {
      setError("Please fill in your name, phone, email, and address.");
      return;
    }
    if (needsProof && !proofFile) {
      setError(`Please upload your ${selectedPayment.label} payment proof before placing the order.`);
      return;
    }

    setBusy(true);
    setError("");
    setProofWarning("");
    try {
      const fullAddress = [form.address, form.barangay, form.city, form.province, form.zip]
        .filter(Boolean).join(", ");
      const order = await api.createOrder({
        id: makeOrderId(),
        customer: form.fullName,
        email: form.email,
        address: fullAddress,
        paymentMethod: PAYMENT_LABELS[payment],
        items: cart.map((c) => ({ id: c.id, name: c.name, qty: c.qty, price: c.price })),
      });

      let finalOrder = order;
      if (needsProof && proofFile) {
        try {
          finalOrder = await api.uploadPaymentProof(order.id, proofFile);
        } catch (uploadErr) {
          // The order itself was created successfully — don't lose that.
          // Just let them know the proof image didn't attach.
          setProofWarning("Your order was placed, but the proof image didn't upload. You can email it to us instead.");
        }
      }

      setPlaced(finalOrder);
      clearCart();
      onOrderCreated?.(finalOrder);
    } catch (err) {
      setError(err.message || "Something went wrong placing your order. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (placed) {
    return (
      <section className="section" style={{ textAlign: "center", padding: "70px 20px" }}>
        <Check size={40} color="#C9A15F" />
        <h2 style={{ marginTop: 14 }}>Order confirmed</h2>
        <p className="lede" style={{ maxWidth: 420, margin: "10px auto" }}>
          Order #{placed.id} has been placed and saved. A confirmation has been sent to your email.
        </p>
        {proofWarning && <p className="admin-form-error" style={{ maxWidth: 420, margin: "0 auto 16px" }}>{proofWarning}</p>}
        <button className="btn-gold" onClick={() => setView("home")}>Back to Home</button>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="section-head"><p className="eyebrow">Checkout</p><h2>Complete your order</h2></div>
      <div className="checkout-grid">
        <div className="checkout-form">
          <h4>Contact & shipping</h4>
          <div className="form-row two">
            <input placeholder="Full name" value={form.fullName} onChange={set("fullName")} />
            <input placeholder="Phone number" value={form.phone} onChange={set("phone")} />
          </div>
          <input placeholder="Email address" value={form.email} onChange={set("email")} />
          <input placeholder="Shipping address" value={form.address} onChange={set("address")} />
          <div className="form-row three">
            <input placeholder="Province" value={form.province} onChange={set("province")} />
            <input placeholder="City" value={form.city} onChange={set("city")} />
            <input placeholder="Barangay" value={form.barangay} onChange={set("barangay")} />
          </div>
          <input placeholder="ZIP code" value={form.zip} onChange={set("zip")} />
          <textarea placeholder="Order notes (optional)" rows={3} value={form.notes} onChange={set("notes")} />

          <h4>Payment method</h4>
          <div className="payment-grid">
            {PAYMENTS.map((p) => (
              <label key={p.id} className={`payment-option ${payment === p.id ? "active" : ""}`}>
                <input type="radio" name="payment" checked={payment === p.id} onChange={() => { setPayment(p.id); clearProof(); }} />
                <span className="payment-label">{p.label}</span>
                <span className="payment-note">{p.note}</span>
              </label>
            ))}
          </div>

          {needsProof && (
            <div className="proof-upload">
              <p className="admin-field-hint" style={{ marginBottom: 10 }}>{selectedPayment.detail}</p>
              {proofPreview ? (
                <div className="proof-preview">
                  <img src={proofPreview} alt="Payment proof preview" />
                  <button type="button" className="proof-remove" onClick={clearProof} aria-label="Remove image">
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <label className="upload-box upload-box-clickable">
                  <Upload size={18} color="#C9A15F" />
                  <p>Upload proof of payment</p>
                  <span className="btn-outline small">Choose file</span>
                  <input type="file" accept="image/*" hidden onChange={handleFilePicked} />
                </label>
              )}
            </div>
          )}
        </div>
        <div className="checkout-summary">
          <h4>Order summary</h4>
          {cart.map((c) => (
            <div className="summary-row" key={c.id}><span>{c.name} &times; {c.qty}</span><span>{peso(c.price * c.qty)}</span></div>
          ))}
          <div className="totals-row"><span>Subtotal</span><span>{peso(subtotal)}</span></div>
          <div className="totals-row"><span>Shipping</span><span>{shipping === 0 ? "Free" : peso(shipping)}</span></div>
          <div className="totals-row total"><span>Total</span><span>{peso(total)}</span></div>
          {error && <p className="admin-form-error" style={{ marginTop: 12 }}>{error}</p>}
          <button className="btn-gold full" disabled={cart.length === 0 || busy} onClick={handlePlaceOrder}>
            {busy ? "Placing order..." : "Place Order"}
          </button>
        </div>
      </div>
    </section>
  );
}
