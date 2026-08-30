import React, { useState, useEffect } from "react";
import { Check, Upload, X } from "lucide-react";
import { peso } from "../data/products";
import { calculateJntShipping, DEFAULT_ITEM_WEIGHT_KG } from "../data/jntShipping";
import * as api from "../api";
import SearchableSelect from "./ui/SearchableSelect";
import { usePhAddressCascade } from "../hooks/usePhAddressCascade";

// Manual GCash/bank transfer still isn't automated — that's still real
// money changing hands with no way for the site to confirm it beyond
// eyeballing a screenshot, so this warning stays on for those. PayMongo
// ("Pay Online" below) is the real, automated payment gateway and isn't
// gated by this — it's controlled by the backend instead (see
// PAYMONGO_SECRET_KEY / PAYMONGO_PAYMENT_METHODS in server/.env).
const DEMO_MODE = true;

const PAYMENT_LABELS = {
  bdo: "Bank Transfer (BDO)",
  unionbank: "Bank Transfer (UnionBank)",
  gcash: "GCash",
  cod: "Cash on Delivery",
  paymongo: "Pay Online (PayMongo)",
};

// Friendly names for whichever PayMongo methods the backend says are
// currently live (GET /api/orders/paymongo/config) — used to build the
// "Pay Online" option's note without hardcoding which methods are active.
const PAYMONGO_METHOD_LABELS = {
  qrph: "QR Ph",
  gcash: "GCash",
  card: "Cards",
  paymaya: "Maya",
  grab_pay: "GrabPay",
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

// The suffix isn't just cosmetic: POST /api/orders/:id/proof (uploading a
// payment screenshot) is unauthenticated and only guarded by knowing the
// exact order id, so it needs to be unguessable, not just unique. A
// 3-digit Math.random() suffix (900 values/day) is brute-forceable in
// seconds; crypto.getRandomValues over a 7-character base36 string gives
// 36^7 (~78 billion) possibilities instead, and is a CSPRNG rather than
// Math.random()'s predictable PRNG.
function makeOrderId() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const bytes = new Uint8Array(10);
  window.crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => (b % 36).toString(36))
    .join("")
    .slice(0, 7)
    .toUpperCase();
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

  // Which PayMongo methods (if any) are actually live right now — the
  // "Pay Online" option only appears once this comes back enabled, so a
  // storefront with PAYMONGO_SECRET_KEY not yet set just doesn't show it.
  const [paymongoConfig, setPaymongoConfig] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const config = await api.getPaymongoConfig();
        setPaymongoConfig(config);
      } catch {
        setPaymongoConfig(null);
      }
    })();
  }, []);

  // Handles landing back here after PayMongo's hosted checkout — either
  // ?order=ID&payment=success or ?order=ID&payment=cancelled (see
  // successUrl/cancelUrl in server/routes/orders.js). The redirect itself
  // never proves payment succeeded (see server/paymongo.js) — the
  // webhook is what actually marks the order paid — so on a "success"
  // return this briefly polls the order a few times to give that webhook
  // a moment to land before showing the confirmation screen.
  const [returnStatus, setReturnStatus] = useState(null); // "checking" | "success" | "cancelled" | null
  const [returnOrder, setReturnOrder] = useState(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("order");
    const outcome = params.get("payment");
    if (!orderId || !outcome) return;
    window.history.replaceState(null, "", "/checkout"); // don't re-process this on refresh

    let cancelled = false;
    (async () => {
      if (outcome === "cancelled") {
        try {
          setReturnOrder(await api.getOrder(orderId));
        } catch {
          // Order lookup failing here just means a slightly less
          // specific message below — not fatal.
        }
        if (!cancelled) setReturnStatus("cancelled");
        return;
      }

      setReturnStatus("checking");
      // Poll briefly for the webhook to mark the order paid — most
      // deliveries land within a second or two, but this never blocks
      // forever: after a handful of tries it shows the confirmation
      // regardless, since the order is safely recorded either way and
      // the admin dashboard will reflect the true payment status once
      // the webhook does arrive.
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const order = await api.getOrder(orderId);
          if (!cancelled) setReturnOrder(order);
          if (order.paymentStatus === "paid" || attempt === 5) break;
        } catch {
          if (attempt === 5) break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!cancelled) setReturnStatus("success");
    })();

    return () => { cancelled = true; };
  }, []);

  const handleRetryPaymongo = async () => {
    if (!returnOrder) return;
    setRetryBusy(true);
    setRetryError("");
    try {
      const { checkoutUrl } = await api.createPaymongoSession(returnOrder.id);
      window.location.href = checkoutUrl;
    } catch (err) {
      setRetryError(err.message || "Couldn't restart payment. Please try again.");
      setRetryBusy(false);
    }
  };

  const [form, setForm] = useState({
    fullName: customer?.name || "",
    phoneCountryCode: customer?.phoneCountryCode || "+63",
    phone: (customer?.phone || "").replace(/\D/g, "").slice(0, 10),
    email: customer?.email || "",
    addressLine: customer?.addressLine || "",
    zip: customer?.zipCode || "", notes: "",
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Province/City/Barangay cascade — shared with the Account profile form
  // so both use the same real PSGC data (see usePhAddressCascade for the
  // Metro Manila fix: it used to only ever offer "City of Manila" as the
  // city, no matter which part of Metro Manila you actually wanted).
  const {
    address, provinceOptions, cityOptions, barangayOptions,
    loadingCities, loadingBarangays,
    selectProvince, clearProvince, selectCity, clearCity, selectBarangay, clearBarangay,
    hydrate: hydrateAddress,
  } = usePhAddressCascade();

  useEffect(() => {
    if (customer) hydrateAddress(customer.province, customer.city, customer.barangay);
  }, [customer, hydrateAddress]);

  // Country code: keep a leading "+", digits only after it, capped at 4 digits.
  const setPhoneCountryCode = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
    setForm((f) => ({ ...f, phoneCountryCode: digits ? `+${digits}` : "+" }));
  };
  // Phone number: digits only, never past 10 digits.
  const setPhone = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
    setForm((f) => ({ ...f, phone: digits }));
  };

  // On first render the customer's profile may not have finished loading
  // yet (e.g. landing straight on /checkout after a refresh, while
  // getMe() is still in flight) — the form above would then start blank.
  // Once it arrives, fill in whichever of these fields the shopper
  // hasn't already typed something into themselves. These are the same
  // split fields the profile page saves, so this is a direct field-to-
  // field autofill rather than parsing one address string.
  useEffect(() => {
    if (!customer) return;
    setForm((f) => ({
      ...f,
      fullName: f.fullName || customer.name || "",
      phoneCountryCode: f.phoneCountryCode || customer.phoneCountryCode || "+63",
      phone: f.phone || (customer.phone || "").replace(/\D/g, "").slice(0, 10),
      email: f.email || customer.email || "",
      addressLine: f.addressLine || customer.addressLine || "",
      zip: f.zip || customer.zipCode || "",
    }));
  }, [customer]);

  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const totalWeightKg = cart.reduce((s, c) => s + (c.weight || DEFAULT_ITEM_WEIGHT_KG) * c.qty, 0);
  const freeShipping = subtotal > 5000 || subtotal === 0;
  // null shipping = free, or we don't have a province yet to quote against
  const jntFee = freeShipping ? 0 : calculateJntShipping(totalWeightKg, address.province, address.city);
  const shipping = jntFee ?? 0;
  const total = subtotal + shipping;

  // "Pay Online" only shows up once the backend confirms PayMongo is
  // configured and has at least one live method — see the config fetch
  // above. Built fresh each render rather than a module-level constant
  // since it depends on that fetched config.
  const payments = paymongoConfig?.enabled
    ? [
        {
          id: "paymongo",
          label: "Pay Online",
          note: paymongoConfig.methods.map((m) => PAYMONGO_METHOD_LABELS[m] || m).join(" / "),
          detail: "You'll be redirected to PayMongo's secure checkout to complete payment instantly — no proof upload needed.",
        },
        ...PAYMENTS,
      ]
    : PAYMENTS;

  const selectedPayment = payments.find((p) => p.id === payment);
  const needsProof = payment !== "cod" && payment !== "paymongo";

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
    if (!form.fullName.trim() || !form.phone.trim() || !form.email.trim() || !form.addressLine.trim()) {
      setError("Please fill in your name, phone, email, and address.");
      return;
    }
    if (!address.province) {
      setError("Please select your province so we can calculate your J&T shipping fee.");
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
      const fullAddress = [form.addressLine, address.barangay, address.city, address.province, form.zip]
        .filter(Boolean).join(", ");
      const order = await api.createOrder({
        id: makeOrderId(),
        customer: form.fullName,
        email: form.email,
        phone: `${form.phoneCountryCode} ${form.phone}`.trim(),
        address: fullAddress,
        paymentMethod: PAYMENT_LABELS[payment],
        items: cart.map((c) => ({ id: c.id, name: c.name, qty: c.qty, price: c.price })),
      });

      if (payment === "paymongo") {
        // Order is already persisted (stock decremented, receipt email
        // queued) exactly like every other method — from here it's the
        // same as any other successful placement, just with an extra
        // redirect to actually collect payment. Clear the cart now
        // rather than waiting for the PayMongo round-trip.
        clearCart();
        onOrderCreated?.(order);
        try {
          const { checkoutUrl } = await api.createPaymongoSession(order.id);
          window.location.href = checkoutUrl;
          return; // page is navigating away — nothing left to do here
        } catch (sessionErr) {
          // The order itself is fine and saved — only starting the
          // redirect failed. Reuse the same "payment cancelled" screen
          // (order id + a Try Again button that re-requests a session)
          // rather than a bare error, since the shopper still needs a
          // way to actually pay for an order that now exists.
          setReturnOrder(order);
          setReturnStatus("cancelled");
          setRetryError(sessionErr.message || "Couldn't start online payment.");
          return;
        }
      }

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

  // Landed back here from PayMongo's hosted checkout — see the mount
  // effect above. Takes priority over the normal form/placed states
  // since the cart is already empty by this point either way.
  if (returnStatus === "checking") {
    return (
      <section className="section" style={{ textAlign: "center", padding: "70px 20px" }}>
        <h2>Confirming your payment&hellip;</h2>
        <p className="lede" style={{ maxWidth: 420, margin: "10px auto" }}>
          Just a moment while we confirm your payment with PayMongo.
        </p>
      </section>
    );
  }
  if (returnStatus === "success") {
    const paid = returnOrder?.paymentStatus === "paid";
    return (
      <section className="section" style={{ textAlign: "center", padding: "70px 20px" }}>
        <Check size={40} color="#C9A15F" />
        <h2 style={{ marginTop: 14 }}>Order confirmed</h2>
        <p className="lede" style={{ maxWidth: 420, margin: "10px auto" }}>
          {returnOrder
            ? `Order #${returnOrder.id} has been placed and saved. A confirmation has been sent to your email.`
            : "Your order has been placed and saved."}
        </p>
        {!paid && (
          <p className="admin-field-hint" style={{ maxWidth: 420, margin: "0 auto 16px" }}>
            We're still waiting on final confirmation from PayMongo — this can take a minute. You'll see it reflected on your order shortly.
          </p>
        )}
        <button className="btn-gold" onClick={() => setView("home")}>Back to Home</button>
      </section>
    );
  }
  if (returnStatus === "cancelled") {
    return (
      <section className="section" style={{ textAlign: "center", padding: "70px 20px" }}>
        <h2>Payment not completed</h2>
        <p className="lede" style={{ maxWidth: 420, margin: "10px auto" }}>
          {returnOrder
            ? `Order #${returnOrder.id} is saved and waiting — no payment has gone through yet, so nothing was charged.`
            : "No payment has gone through yet, so nothing was charged."}
        </p>
        {retryError && <p className="admin-form-error" style={{ maxWidth: 420, margin: "0 auto 16px" }}>{retryError}</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {returnOrder && (
            <button className="btn-gold" disabled={retryBusy} onClick={handleRetryPaymongo}>
              {retryBusy ? "Starting payment..." : "Try Payment Again"}
            </button>
          )}
          <button className="btn-outline" onClick={() => setView("home")}>Back to Home</button>
        </div>
      </section>
    );
  }

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
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={form.phoneCountryCode}
                onChange={setPhoneCountryCode}
                placeholder="+63"
                style={{ width: 62, flexShrink: 0, textAlign: "center" }}
              />
              <input
                placeholder="9XXXXXXXXX"
                value={form.phone}
                onChange={setPhone}
                inputMode="numeric"
                maxLength={10}
                style={{ flex: 1 }}
              />
            </div>
          </div>
          <input placeholder="Email address" value={form.email} onChange={set("email")} />
          <input placeholder="Shipping address" value={form.addressLine} onChange={set("addressLine")} />
          <div className="form-row three">
            <SearchableSelect
              value={address.province}
              options={provinceOptions}
              onSelect={selectProvince}
              onClear={clearProvince}
              placeholder="Province"
            />
            <SearchableSelect
              value={address.city}
              options={cityOptions}
              onSelect={selectCity}
              onClear={clearCity}
              placeholder={address.provinceCode ? "City / Municipality" : "Select province first"}
              disabled={!address.provinceCode}
              loading={loadingCities}
            />
            <SearchableSelect
              value={address.barangay}
              options={barangayOptions}
              onSelect={selectBarangay}
              onClear={clearBarangay}
              placeholder={address.cityCode ? "Barangay" : "Select city first"}
              disabled={!address.cityCode}
              loading={loadingBarangays}
            />
          </div>
          <input placeholder="ZIP code" value={form.zip} onChange={set("zip")} />
          <textarea placeholder="Order notes (optional)" rows={3} value={form.notes} onChange={set("notes")} />

          <h4>Payment method</h4>
          {DEMO_MODE && (
            <p className="admin-form-error" style={{ marginBottom: 10 }}>
              GCash and bank transfer are still under verification and aren&rsquo;t available yet — please use Pay Online (QR Ph) or Cash on Delivery to check out.
            </p>
          )}
          <div className="payment-grid">
            {payments.map((p) => (
              <label key={p.id} className={`payment-option ${payment === p.id ? "active" : ""}`}>
                <input type="radio" name="payment" checked={payment === p.id} onChange={() => { setPayment(p.id); clearProof(); }} />
                <span className="payment-label">{p.label}</span>
                <span className="payment-note">{p.note}</span>
              </label>
            ))}
          </div>

          {payment === "paymongo" && (
            <div className="proof-upload">
              <p className="admin-field-hint" style={{ marginBottom: 0 }}>{selectedPayment.detail}</p>
              {paymongoConfig?.testMode && (
                <p className="admin-field-hint" style={{ marginTop: 6 }}>
                  PayMongo is currently in test mode — no real money will be charged.
                </p>
              )}
            </div>
          )}

          {needsProof && (
            <div className="proof-upload">
              {DEMO_MODE && (
                <p className="admin-form-error" style={{ marginBottom: 10 }}>
                  Demo mode: do not actually send money to the number above.
                </p>
              )}
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
          <div className="totals-row">
            <span>Shipping (J&amp;T Express)</span>
            <span>
              {freeShipping ? "Free" : jntFee != null ? peso(jntFee) : "Select province"}
            </span>
          </div>
          {!freeShipping && (
            <p className="admin-field-hint" style={{ margin: "-6px 0 4px", textAlign: "right" }}>
              Est. parcel weight: {totalWeightKg.toFixed(2)}kg
            </p>
          )}
          <div className="totals-row total"><span>Total</span><span>{peso(total)}</span></div>
          {error && <p className="admin-form-error" style={{ marginTop: 12 }}>{error}</p>}
          <button className="btn-gold full" disabled={cart.length === 0 || busy} onClick={handlePlaceOrder}>
            {busy ? (payment === "paymongo" ? "Redirecting to PayMongo..." : "Placing order...") : "Place Order"}
          </button>
        </div>
      </div>
    </section>
  );
}
