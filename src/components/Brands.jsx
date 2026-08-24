import React, { useMemo } from "react";
import { ChevronRight, Tag } from "lucide-react";
import BlossomDivider from "./ui/BlossomDivider";

// Brands are free text on each product (unlike category, which is a
// fixed list), so — same approach as the old color filter — the cards
// shown here are built from whatever brands actually appear on the
// currently loaded products, sorted by how many items carry each one.
export default function Brands({ goShop, products }) {
  const brands = useMemo(() => {
    const counts = new Map();
    products.forEach((p) => {
      if (!p.brand) return;
      counts.set(p.brand, (counts.get(p.brand) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [products]);

  if (brands.length === 0) return null;

  return (
    <section className="section">
      <div className="section-head">
        <p className="eyebrow">Shop by brand</p>
        <h2>Featured brands</h2>
      </div>
      <BlossomDivider />

      <div className="cat-grid">
        {brands.map(([brand, count]) => (
          <button key={brand} className="cat-card" onClick={() => goShop({ brand })}>
            <Tag size={26} strokeWidth={1.25} color="#C9A15F" />
            <span className="cat-name">{brand}</span>
            <span className="cat-count">{count} items</span>
            <span className="cat-browse">Browse <ChevronRight size={14} /></span>
          </button>
        ))}
      </div>
    </section>
  );
}
