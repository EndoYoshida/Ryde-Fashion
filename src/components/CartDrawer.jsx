import React from "react";
import { ShoppingBag, X, Plus, Minus } from "lucide-react";
import { peso } from "../data/products";
import { calculateJntShipping, DEFAULT_ITEM_WEIGHT_KG } from "../data/jntShipping";
import ProductImage from "./ui/ProductImage";
import useMountOnTransition from "../hooks/useMountOnTransition";

export default function CartDrawer({ open, onClose, cart, updateQty, removeItem, setView, customer }) {
  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const totalWeightKg = cart.reduce((s, c) => s + (c.weight || DEFAULT_ITEM_WEIGHT_KG) * c.qty, 0);
  const freeShipping = subtotal > 5000 || subtotal === 0;

  // We don't have a delivery address yet at this point (that's chosen in
  // checkout), so quote the real J&T fee for whichever province/city the
  // shopper already has saved on their account, same as checkout would
  // for that destination. If we don't know where they're shipping to yet
  // (guest, or no saved address), fall back to the NCR-tier fee — the
  // cheapest zone — labeled "from" so it reads as a starting estimate,
  // not the exact figure checkout will land on for a farther zone.
  const knownJntFee = !freeShipping
    ? calculateJntShipping(totalWeightKg, customer?.province, customer?.city)
    : null;
  const fallbackJntFee = !freeShipping ? calculateJntShipping(totalWeightKg, "Metro Manila", "Manila") : null;
  const hasKnownDestination = knownJntFee != null;
  const shipping = freeShipping ? 0 : (knownJntFee ?? fallbackJntFee ?? 0);
  const total = subtotal + shipping;

  const { shouldRender, closing } = useMountOnTransition(open, 280);
  if (!shouldRender) return null;
  return (
    <div className={`overlay drawer-overlay ${closing ? "closing" : ""}`} onClick={onClose}>
      <div className={`cart-drawer ${closing ? "closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="cart-head">
          <h3><ShoppingBag size={18} /> Your Cart</h3>
          <button className="close-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {cart.length === 0 ? (
          <div className="empty-state">Your cart is empty.</div>
        ) : (
          <div className="cart-items">
            {cart.map((c) => (
              <div className="cart-item" key={c.id}>
                <ProductImage Icon={c.icon} size={22} src={c.images?.[0]?.url} />
                <div className="cart-item-info">
                  <p className="prod-name" style={{ cursor: "default" }}>{c.name}</p>
                  <p className="prod-brand">{c.brand}</p>
                  <div className="qty-stepper small">
                    <button onClick={() => updateQty(c.id, c.qty - 1)}><Minus size={12} /></button>
                    <span>{c.qty}</span>
                    <button disabled={c.qty >= (c.stock ?? Infinity)} onClick={() => updateQty(c.id, c.qty + 1)}><Plus size={12} /></button>
                  </div>
                </div>
                <div className="cart-item-right">
                  <span>{peso(c.price * c.qty)}</span>
                  <button className="remove-link" onClick={() => removeItem(c.id)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="cart-footer">
          <div className="coupon-row">
            <input placeholder="Coupon code" />
            <button className="btn-outline small">Apply</button>
          </div>
          <div className="totals-row"><span>Subtotal</span><span>{peso(subtotal)}</span></div>
          <div className="totals-row">
            <span>Shipping (J&amp;T Express)</span>
            <span>{freeShipping ? "Free" : `${hasKnownDestination ? "" : "from "}${peso(shipping)}`}</span>
          </div>
          <div className="totals-row total"><span>Estimated Total</span><span>{peso(total)}</span></div>
          <button className="btn-gold full" disabled={cart.length === 0} onClick={() => { onClose(); setView("checkout"); }}>
            Proceed to Checkout
          </button>
        </div>
      </div>
    </div>
  );
}
