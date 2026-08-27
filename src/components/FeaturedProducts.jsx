import React from "react";
import { ArrowRight } from "lucide-react";
import BlossomDivider from "./ui/BlossomDivider";
import ProductCard from "./ProductCard";

export default function FeaturedProducts({ products, openProduct, toggleWish, wishlist, addToCart, goShop }) {
  // Get tagged products and first two products, then remove duplicates
  let list = products.filter((p) => p.tag).concat(products.slice(0, 2));
  const unique = Array.from(new Map(list.map((p) => [p.id, p])).values());
  // Sort by status: available first
  const featured = unique
    .sort((a, b) => {
      const statusA = a.status === "available" ? 0 : 1;
      const statusB = b.status === "available" ? 0 : 1;
      return statusA - statusB;
    })
    .slice(0, 8);
  return (
    <section className="section alt">
      <div className="section-head">
        <p className="eyebrow">New arrivals</p>
        <h2>Featured products</h2>
      </div>
      <BlossomDivider />
      <div className="prod-grid">
        {featured.map((p) => (
          <ProductCard key={p.id} p={p} openProduct={openProduct} toggleWish={toggleWish} wishlist={wishlist} addToCart={addToCart} />
        ))}
      </div>
      <div className="center-btn">
        <button className="btn-outline" onClick={() => goShop()}>View all products <ArrowRight size={15} /></button>
      </div>
    </section>
  );
}
