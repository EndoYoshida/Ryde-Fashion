import React, { useState } from "react";
import { ShoppingBag, Heart, Search, Menu, User } from "lucide-react";
import logo from "../assets/logo.jpg";

export default function Header({ view, setView, goShop, cartCount, wishCount, onCartOpen, onWishlistOpen, onAccountOpen, customer, search, setSearch }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = [
    { id: "home", label: "Home" },
    { id: "browse", label: "Shop" },
    { id: "about", label: "About" },
    { id: "support", label: "Support" },
  ];

  const goToNav = (id) => {
    if (id === "home") {
      setView("home");
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 50);
      return;
    }
    if (id === "browse") {
      goShop();
      return;
    }
    if (id === "about") {
      setView("home");
      setTimeout(() => {
        document.getElementById("about-section")?.scrollIntoView({ behavior: "smooth" });
      }, 50);
      return;
    }
    setView(id);
  };

  return (
    <>
      <div className="announce">Free shipping on orders over &#8369;5,000 &nbsp;&middot;&nbsp; 100% Authenticity Guarantee &nbsp;&middot;&nbsp; Imported from the U.S., Japan &amp; Canada</div>
      <header className="site-header">
        <button className="icon-btn mobile-only" onClick={() => setMenuOpen((m) => !m)} aria-label="Menu">
          <Menu size={20} />
        </button>
        <button className="brand" onClick={() => setView("home")}>
          <img src={logo} alt="Ryde Fashion logo" className="logo-img" />
          <span className="brand-name">RYDE</span>
          <span className="brand-sub">Fashion &amp; Authentic Goods</span>
        </button>
        <nav className="nav-links desktop-only">
          {nav.map((n) => (
            <button key={n.id} className={`nav-link ${view === n.id ? "active" : ""}`} onClick={() => goToNav(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <div className="search-box desktop-only">
            <Search size={15} />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setView("browse"); }} placeholder="Search products..." />
          </div>
          <button className={`icon-btn ${customer ? "signed-in" : ""}`} onClick={onAccountOpen} aria-label="Account">
            <User size={19} fill={customer ? "#C9A15F" : "none"} />
          </button>
          <button className="icon-btn" onClick={onWishlistOpen} aria-label="Wishlist">
            <Heart size={19} />
            {wishCount > 0 && <span className="pill">{wishCount}</span>}
          </button>
          <button className="icon-btn" onClick={onCartOpen} aria-label="Cart">
            <ShoppingBag size={19} />
            {cartCount > 0 && <span className="pill">{cartCount}</span>}
          </button>
        </div>
      </header>
      {menuOpen && (
        <div className="mobile-menu">
          {nav.map((n) => (
            <button key={n.id} onClick={() => { goToNav(n.id); setMenuOpen(false); }}>{n.label}</button>
          ))}
        </div>
      )}
    </>
  );
}
