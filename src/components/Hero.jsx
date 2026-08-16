import React from "react";
import { ArrowRight } from "lucide-react";
import logo from "../assets/logo.jpg";
import Petals from "./ui/Petals";

export default function Hero({ goShop }) {
  return (
    <section className="hero">
      <Petals />
      <div className="hero-inner">
        <div className="hero-mark">
          <img src={logo} alt="Ryde Fashion logo" className="logo-img logo-hero" />
        </div>
        <p className="eyebrow">RYDE FASHION &amp; AUTHENTIC BAGS AND APPAREL</p>
        <h1>Authentic fashion from the U.S., Japan &amp; Canada,<br />delivered to the Philippines</h1>
        <p className="hero-desc">
          We offer authentic imported bags, apparel, shoes, perfumes, watches, makeup, and premium
          fashion accessories, carefully selected from the United States, Japan, and Canada.
        </p>
        <div className="flag-row">
          <span>&#127482;&#127480; United States</span>
          <span className="flag-dot">&middot;</span>
          <span>&#127471;&#127477; Japan</span>
          <span className="flag-dot">&middot;</span>
          <span>&#127464;&#127462; Canada</span>
        </div>
        <div className="hero-actions">
          <button className="btn-gold" onClick={() => goShop()}>Shop Now <ArrowRight size={16} /></button>
          <button className="btn-outline" onClick={() => document.getElementById("about-section")?.scrollIntoView({ behavior: "smooth" })}>Learn More</button>
        </div>
      </div>
    </section>
  );
}
