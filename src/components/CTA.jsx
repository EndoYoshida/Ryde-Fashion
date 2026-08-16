import React from "react";
import { Flower2, ArrowRight } from "lucide-react";

export default function CTA({ goShop }) {
  return (
    <section className="cta">
      <Flower2 size={26} color="#FBF3EC" />
      <h2>Discover authentic fashion today</h2>
      <p>Curated luxury, delivered with care from the U.S., Japan &amp; Canada to your doorstep.</p>
      <button className="btn-ivory" onClick={() => goShop()}>Shop Now <ArrowRight size={16} /></button>
    </section>
  );
}
