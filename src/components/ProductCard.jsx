import React from "react";
import { ShoppingBag, Heart, Eye } from "lucide-react";
import { peso, STATUS_LABEL } from "../data/products";
import Stars from "./ui/Stars";
import ProductImage from "./ui/ProductImage";
import HighlightText from "./ui/HighlightText";

export default function ProductCard({ p, openProduct, toggleWish, wishlist, addToCart, highlight = "" }) {
  const st = STATUS_LABEL[p.status];
  const disabled = p.status !== "available";
  return (
    <div className={`prod-card ${disabled ? "faded" : ""}`}>
      <div className="prod-img-wrap" onClick={() => openProduct(p)}>
        <ProductImage Icon={p.icon} src={p.images?.[0]?.url} />
        {p.tag && <span className="tag-badge">{p.tag}</span>}
        <span className={`status-badge ${st.cls}`}>{st.label}</span>
        <button className={`wish-btn ${wishlist.has(p.id) ? "active" : ""}`} onClick={(e) => { e.stopPropagation(); toggleWish(p.id); }} aria-label="Add to wishlist">
          <Heart size={16} fill={wishlist.has(p.id) ? "#C9678A" : "none"} />
        </button>
        <button className="quick-view" onClick={(e) => { e.stopPropagation(); openProduct(p); }}><Eye size={13} /> Quick view</button>
      </div>
      <div className="prod-info">
        <p className="prod-brand"><HighlightText text={p.brand} query={highlight} /></p>
        <button className="prod-name" onClick={() => openProduct(p)}><HighlightText text={p.name} query={highlight} /></button>
        <Stars rating={p.rating} />
        <div className="prod-bottom">
          <span className="prod-price">{peso(p.price)}{p.oldPrice && <span className="old-price">{peso(p.oldPrice)}</span>}</span>
          <button className="add-btn" disabled={disabled} onClick={() => addToCart(p)} aria-label="Add to cart">
            <ShoppingBag size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
