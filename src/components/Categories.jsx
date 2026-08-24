import React from "react";
import { ChevronRight, Sparkles, Award, Tag } from "lucide-react";
import { CATEGORIES } from "../data/products";
import BlossomDivider from "./ui/BlossomDivider";

export default function Categories({ goShop, products }) {
  const newCount = products.filter((p) => p.tag === "New").length;
  const bestCount = products.filter((p) => p.bestseller).length;
  const saleCount = products.filter((p) => p.oldPrice && p.oldPrice > p.price).length;

  return (
    <section className="section">
      <div className="section-head">
        <p className="eyebrow">Shop by category</p>
        <h2>Featured categories</h2>
      </div>
      <BlossomDivider />

      <div className="cat-grid cat-grid-trending cat-grid-trending-3">
        <button className="cat-card cat-card-special" onClick={() => goShop({ tag: "New" })}>
          <Sparkles size={26} strokeWidth={1.25} color="#C9A15F" />
          <span className="cat-name">New Arrivals</span>
          <span className="cat-count">{newCount} items</span>
          <span className="cat-browse">Browse <ChevronRight size={14} /></span>
        </button>
        <button className="cat-card cat-card-special" onClick={() => goShop({ tag: "Bestseller" })}>
          <Award size={26} strokeWidth={1.25} color="#C9A15F" />
          <span className="cat-name">Best Sellers</span>
          <span className="cat-count">{bestCount} items</span>
          <span className="cat-browse">Browse <ChevronRight size={14} /></span>
        </button>
        <button className="cat-card cat-card-special" onClick={() => goShop({ tag: "Sale" })}>
          <Tag size={26} strokeWidth={1.25} color="#C9A15F" />
          <span className="cat-name">Item on Sale</span>
          <span className="cat-count">{saleCount} items</span>
          <span className="cat-browse">Browse <ChevronRight size={14} /></span>
        </button>
      </div>

      <div className="cat-grid">
        {CATEGORIES.map((c) => {
          const count = products.filter((p) => p.category === c.id).length;
          return (
            <button key={c.id} className="cat-card" onClick={() => goShop({ category: c.id })}>
              <c.icon size={26} strokeWidth={1.25} color={c.color} />
              <span className="cat-name">{c.name}</span>
              <span className="cat-count">{count} items</span>
              <span className="cat-browse">Browse <ChevronRight size={14} /></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
