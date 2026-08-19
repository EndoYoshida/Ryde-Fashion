import React from "react";
import { ShoppingBag, X, Plus, Minus } from "lucide-react";
import { peso } from "../data/products";
import ProductImage from "./ui/ProductImage";
import useMountOnTransition from "../hooks/useMountOnTransition";

export default function CartDrawer({ open, onClose, cart, updateQty, removeItem, setView }) {
  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const shipping = subtotal > 5000 || subtotal === 0 ? 0 : 250;
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
                    <button onClick={() => updateQty(c.id, c.qty + 1)}><Plus size={12} /></button>
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
          <div className="totals-row"><span>Shipping</span><span>{shipping === 0 ? "Free" : peso(shipping)}</span></div>
          <div className="totals-row total"><span>Estimated Total</span><span>{peso(total)}</span></div>
          <button className="btn-gold full" disabled={cart.length === 0} onClick={() => { onClose(); setView("checkout"); }}>
            Proceed to Checkout
          </button>
        </div>
      </div>
    </div>
  );
}
