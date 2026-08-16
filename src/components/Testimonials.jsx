import React, { useState } from "react";
import { Check } from "lucide-react";
import { TESTIMONIALS } from "../data/products";
import Stars from "./ui/Stars";
import StarInput from "./ui/StarInput";
import BlossomDivider from "./ui/BlossomDivider";

export default function Testimonials() {
  const [reviews, setReviews] = useState(TESTIMONIALS);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [rating, setRating] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !text.trim() || rating === 0) return;
    setReviews((prev) => [{ name: name.trim(), text: text.trim(), rating, isNew: true }, ...prev]);
    setName("");
    setText("");
    setRating(0);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3500);
  };

  return (
    <section className="section">
      <div className="section-head">
        <p className="eyebrow">Customer love</p>
        <h2>What our customers say</h2>
      </div>
      <BlossomDivider />

      <div className="review-form-wrap">
        <h4>Share your experience</h4>
        <form className="review-form" onSubmit={handleSubmit}>
          <div className="review-form-row">
            <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <StarInput value={rating} onChange={setRating} />
          </div>
          <textarea
            placeholder="Tell us what you loved about your order..."
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="review-form-footer">
            {submitted && <span className="review-thanks"><Check size={14} /> Thank you for your review!</span>}
            <button type="submit" className="btn-gold small">Submit Review</button>
          </div>
        </form>
      </div>

      <div className="test-grid">
        {reviews.length === 0 ? (
          <p className="admin-empty" style={{ gridColumn: "1 / -1" }}>
            No reviews yet — be the first to share your experience!
          </p>
        ) : (
          reviews.map((t, i) => (
            <div className={`test-card ${t.isNew ? "highlight" : ""}`} key={`${t.name}-${i}`}>
              {t.isNew && <span className="tag-badge review-new">New</span>}
              <Stars rating={t.rating} />
              <p>&ldquo;{t.text}&rdquo;</p>
              <span className="test-name">{t.name}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
