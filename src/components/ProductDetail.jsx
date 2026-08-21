import React, { useState, useEffect } from "react";
import { ShoppingBag, Heart, X, Plus, Minus, Check, ZoomIn } from "lucide-react";
import { peso, STATUS_LABEL } from "../data/products";
import Stars from "./ui/Stars";
import StarInput from "./ui/StarInput";
import ProductImage from "./ui/ProductImage";
import { SERVER_ORIGIN } from "../api";
import * as api from "../api";

export default function ProductDetail({ product, onClose, addToCart, toggleWish, wishlist, products, openProduct, customer, rateProduct }) {
  const [qty, setQty] = useState(1);
  const [selectedImg, setSelectedImg] = useState(0);
  const [myRating, setMyRating] = useState(0);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [rated, setRated] = useState(false);
  // Cursor-following magnifier on the main image (see .detail-main-img
  // hover styles) — origin% is where the zoomed image centers under the
  // pointer, so it needs live mouse position while hovered.
  const [zoomActive, setZoomActive] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState("50% 50%");
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const handleImgMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setZoomOrigin(`${x}% ${y}%`);
  };

  useEffect(() => {
    setSelectedImg(0);
    setQty(1);
    setRated(false);
    setMyRating(0);
    if (product && customer) {
      api.getMyRating(product.id).then((r) => setMyRating(r.rating)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  if (!product) return null;
  const st = STATUS_LABEL[product.status];
  const disabled = product.status !== "available";
  // "You may also like" — same category as whatever the customer is
  // currently looking at, excluding this product itself.
  const related = products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4);
  const images = product.images || [];
  const mainImgUrl = images[selectedImg]?.url;
  const mainImgFullSrc = mainImgUrl ? (mainImgUrl.startsWith("http") ? mainImgUrl : `${SERVER_ORIGIN}${mainImgUrl}`) : null;

  const handleRate = async (value) => {
    if (!customer) return;
    setRatingBusy(true);
    try {
      const updated = await rateProduct(product.id, value);
      setMyRating(value);
      setRated(true);
      openProduct(updated); // refreshes the average rating/count shown above
      setTimeout(() => setRated(false), 2500);
    } catch (err) {
      console.error("Failed to submit rating:", err.message);
    } finally {
      setRatingBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <div className="detail-grid">
          <div className="detail-images">
            <div
              className={`detail-main-img ${mainImgFullSrc ? "zoomable" : ""} ${zoomActive ? "is-zoomed" : ""}`}
              style={mainImgFullSrc && zoomActive ? { backgroundImage: `url(${mainImgFullSrc})`, backgroundPosition: zoomOrigin } : undefined}
              onMouseEnter={() => mainImgFullSrc && setZoomActive(true)}
              onMouseLeave={() => setZoomActive(false)}
              onMouseMove={mainImgFullSrc ? handleImgMouseMove : undefined}
              onClick={() => mainImgFullSrc && setLightboxOpen(true)}
            >
              <ProductImage Icon={product.icon} size={64} src={mainImgUrl} />
              {mainImgFullSrc && (
                <span className="zoom-hint"><ZoomIn size={14} /> Click to zoom</span>
              )}
            </div>
            {images.length > 1 ? (
              <div className="thumb-row">
                {images.map((img, i) => (
                  <button
                    key={img.id}
                    className={`thumb ${i === selectedImg ? "active" : ""}`}
                    onClick={() => setSelectedImg(i)}
                  >
                    <ProductImage Icon={product.icon} size={18} src={img.url} />
                  </button>
                ))}
              </div>
            ) : images.length === 0 ? (
              <div className="thumb-row">
                {[0, 1, 2].map((i) => <div className="thumb" key={i}><product.icon size={18} strokeWidth={1.25} /></div>)}
              </div>
            ) : null}
          </div>
          <div className="detail-info">
            <p className="prod-brand">{product.brand}</p>
            <h2>{product.name}</h2>
            {product.reviews > 0 ? (
              <>
                <Stars rating={product.rating} />
                <span className="review-count">{product.rating.toFixed(1)} &middot; {product.reviews} rating{product.reviews === 1 ? "" : "s"}</span>
              </>
            ) : (
              <span className="review-count">No ratings yet</span>
            )}
            <div className="detail-price">
              {peso(product.price)}
              {product.oldPrice && <span className="old-price">{peso(product.oldPrice)}</span>}
            </div>
            <span className={`status-badge inline ${st.cls}`}>{st.label}</span>

            <p className="detail-desc">
              {product.description?.trim() || "No description provided yet for this product."}
            </p>

            <div className="spec-row"><span>Brand</span><span>{product.brand}</span></div>
            <div className="spec-row"><span>Condition</span><span>Brand new</span></div>
            <div className="spec-row"><span>Stock</span><span>{product.stock > 0 ? `${product.stock} left` : "0"}</span></div>

            {!disabled && (
              <div className="qty-row">
                <span>Quantity</span>
                <div className="qty-stepper">
                  <button onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus size={14} /></button>
                  <span>{qty}</span>
                  <button onClick={() => setQty((q) => Math.min(product.stock, q + 1))}><Plus size={14} /></button>
                </div>
              </div>
            )}

            <div className="detail-actions">
              <button className="btn-gold" disabled={disabled} onClick={() => addToCart(product, qty)}>
                <ShoppingBag size={16} /> Add to Cart
              </button>
              <button className="btn-outline" disabled={disabled} onClick={() => addToCart(product, qty)}>Buy Now</button>
              <button className={`icon-btn bordered ${wishlist.has(product.id) ? "active" : ""}`} onClick={() => toggleWish(product.id)} aria-label="Wishlist">
                <Heart size={17} fill={wishlist.has(product.id) ? "#C9678A" : "none"} />
              </button>
            </div>

            <div className="rate-product">
              {customer ? (
                <>
                  <span className="rate-product-label">{myRating > 0 ? "Your rating" : "Rate this product"}</span>
                  <StarInput value={myRating} onChange={handleRate} />
                  {ratingBusy && <span className="admin-field-hint">Saving...</span>}
                  {rated && <span className="review-thanks"><Check size={13} /> Thanks for rating!</span>}
                </>
              ) : (
                <span className="admin-field-hint">Sign in to rate this product.</span>
              )}
            </div>
          </div>
        </div>

        {related.length > 0 && (
          <div className="related">
            <h4>You may also like</h4>
            <div className="related-row">
              {related.map((p) => (
                <button className="related-card" key={p.id} onClick={() => openProduct(p)}>
                  <div className="related-thumb">
                    <ProductImage Icon={p.icon} size={22} src={p.images?.[0]?.url} />
                  </div>
                  <p>{p.name}</p>
                  <span>{peso(p.price)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {lightboxOpen && mainImgFullSrc && (
        <div
          className="overlay center lightbox-overlay"
          onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }}
        >
          <button
            className="close-btn lightbox-close"
            onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }}
            aria-label="Close"
          >
            <X size={20} />
          </button>
          <img
            src={mainImgFullSrc}
            alt={product.name}
            className="lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
