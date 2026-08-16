import React, { useState } from "react";
import logo from "../assets/logo.jpg";
import { FacebookIcon, InstagramIcon, TikTokIcon } from "./icons/BrandIcons";

export default function Footer({ goShop, setView, customer, onAccountOpen }) {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = () => {
    if (!email.trim() || !email.includes("@")) return;
    setSubscribed(true);
    setEmail("");
    setTimeout(() => setSubscribed(false), 4000);
  };

  const handleTrackOrder = () => {
    if (customer) setView("account");
    else onAccountOpen?.();
  };

  return (
    <footer className="footer">
      <div className="footer-grid">
        <div>
          <div className="brand" style={{ cursor: "default" }}>
            <img src={logo} alt="Ryde Fashion logo" className="logo-img logo-footer" />
            <span className="brand-name">RYDE</span>
          </div>
          <p className="footer-blurb">Authentic imported fashion, curated for the modern Filipina and gentleman alike.</p>
          <div className="social-row">
            <a className="icon-btn small" href="https://www.facebook.com/RSfinelady" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
              <FacebookIcon size={16} />
            </a>
            <span className="icon-btn small" title="Instagram — coming soon" aria-label="Instagram">
              <InstagramIcon size={16} />
            </span>
            <a className="icon-btn small" href="https://www.tiktok.com/@ryde.luxury" target="_blank" rel="noopener noreferrer" aria-label="TikTok">
              <TikTokIcon size={16} />
            </a>
          </div>
        </div>
        <div>
          <h5>Shop</h5>
          <button onClick={() => goShop()}>All products</button>
          <button onClick={() => goShop({ tag: "New" })}>New arrivals</button>
          <button onClick={() => goShop({ tag: "Bestseller" })}>Best sellers</button>
        </div>
        <div>
          <h5>Support</h5>
          <button onClick={() => alert("Our FAQ page is coming soon! In the meantime, reach out via Contact us and we'll get back to you.")}>FAQs</button>
          <button onClick={handleTrackOrder}>Track order</button>
          <button onClick={() => { window.location.href = "mailto:rydecompany.ph@gmail.com?subject=Inquiry"; }}>Contact us</button>
        </div>
        <div>
          <h5>Newsletter</h5>
          <p className="footer-blurb">Be first to know about new arrivals and promotions.</p>
          <div className="newsletter">
            <input placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn-gold small" onClick={handleSubscribe}>Join</button>
          </div>
          {subscribed && <p className="footer-blurb" style={{ color: "var(--gold-light)", marginTop: 8 }}>Thanks for subscribing! &#10003;</p>}
        </div>
      </div>
      <div className="footer-bottom">
        &copy; 2026 Ryde Fashion &amp; Authentic Bags and Apparel. All rights reserved. &mdash; Prototype for design review only.
      </div>
    </footer>
  );
}
