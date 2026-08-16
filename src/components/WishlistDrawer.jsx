import React from "react";
import { Heart, X, ShoppingBag } from "lucide-react";
import { peso, STATUS_LABEL } from "../data/products";
import ProductImage from "./ui/ProductImage";

export default function WishlistDrawer({ open, onClose, wishlist, toggleWish, addToCart, openProduct, products }) {
  const items = products.filter((p) => wishlist.has(p.id));

  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="cart-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="cart-head">
          <h3><Heart size={18} /> Your Wishlist</h3>
          <button className="close-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">Nothing saved yet — tap the heart on any product to add it here.</div>
        ) : (
          <div className="cart-items">
            {items.map((p) => {
              const disabled = p.status !== "available";
              const st = STATUS_LABEL[p.status];
              return (
                <div className="cart-item" key={p.id}>
                  <div style={{ cursor: "pointer" }} onClick={() => { onClose(); openProduct(p); }}>
                    <ProductImage Icon={p.icon} size={22} src={p.images?.[0]?.url} />
                  </div>
                  <div className="cart-item-info">
                    <p className="prod-name" style={{ cursor: "pointer" }} onClick={() => { onClose(); openProduct(p); }}>{p.name}</p>
                    <p className="prod-brand">{p.brand}</p>
                    <span className={`status-badge inline ${st.cls}`} style={{ marginTop: 4 }}>{st.label}</span>
                  </div>
                  <div className="cart-item-right">
                    <span>{peso(p.price)}</span>
                    <button
                      className="btn-outline small"
                      disabled={disabled}
                      onClick={() => { addToCart(p); toggleWish(p.id); }}
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <ShoppingBag size={13} /> Add
                    </button>
                    <button className="remove-link" onClick={() => toggleWish(p.id)}>Remove</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
