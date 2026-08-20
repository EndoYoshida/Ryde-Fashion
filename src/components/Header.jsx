import React, { useState, useRef, useEffect } from "react";
import { ShoppingBag, Heart, Search, Menu, User, X, ArrowRight } from "lucide-react";
import logo from "../assets/logo.jpg";
import { peso } from "../data/products";
import { SERVER_ORIGIN } from "../api";

const MAX_RESULTS = 6;

export default function Header({ view, setView, goShop, scrollToSection, cartCount, wishCount, onCartOpen, onWishlistOpen, onAccountOpen, customer, search, setSearch, products = [], openProduct }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Only "about" (an anchor within the home view) still needs its own
  // tracked highlight — Shop and Support are now their own routed views,
  // so their nav highlight tracks `view` directly. Checkout/account
  // aren't in the nav at all, so they just fall back to "home" rather
  // than leaving a stale highlight. When view stays "home" itself, this
  // deliberately does nothing — that's what lets a manual "about" click
  // (which keeps view at "home") stick instead of getting stomped right
  // back to "home" by this effect.
  const [activeSection, setActiveSection] = useState("home");
  const searchWrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (view === "shop") setActiveSection("browse");
    else if (view === "support") setActiveSection("support");
    else if (view !== "home") setActiveSection("home");
  }, [view]);

  const nav = [
    { id: "home", label: "Home" },
    { id: "browse", label: "Shop" },
    { id: "about", label: "About" },
    { id: "support", label: "Support" },
  ];

  const goToNav = (id) => {
    setActiveSection(id);
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
      scrollToSection("about-section");
      return;
    }
    if (id === "support") {
      scrollToSection("support-section");
      return;
    }
    setView(id);
  };

  const openSearch = () => {
    setSearchOpen(true);
    // Wait for the expand animation's width to actually apply before
    // focusing, otherwise the cursor jumps in visually mid-transition.
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const closeSearch = () => {
    setSearchOpen(false);
  };

  // Closes the dropdown when focus leaves the whole search wrapper (input,
  // results table, clear button) rather than any single element within it —
  // relatedTarget is null for clicks outside the document (e.g. scrollbar),
  // so we only close when we're sure focus actually moved elsewhere.
  const handleBlur = (e) => {
    if (searchWrapRef.current && !searchWrapRef.current.contains(e.relatedTarget)) {
      closeSearch();
    }
  };

  const term = search.trim().toLowerCase();
  const matches = term
    ? products.filter((p) => (p.name + " " + p.brand).toLowerCase().includes(term))
    : [];
  const results = matches.slice(0, MAX_RESULTS);
  const totalMatches = matches.length;

  const viewAllResults = () => {
    setActiveSection("browse");
    scrollToSection("browse-section");
    closeSearch();
  };

  const pickResult = (product) => {
    openProduct?.(product);
    closeSearch();
  };

  return (
    <>
      <div className="announce">Free shipping on orders over &#8369;5,000 &nbsp;&middot;&nbsp; 100% Authenticity Guarantee &nbsp;&middot;&nbsp; Imported from the U.S., Japan &amp; Canada</div>
      <header className="site-header">
        <button className="icon-btn mobile-only" onClick={() => setMenuOpen((m) => !m)} aria-label="Menu">
          <Menu size={20} />
        </button>
        <button className="brand" onClick={() => goToNav("home")}>
          <img src={logo} alt="Ryde Fashion logo" className="logo-img" />
          <span className="brand-name">RYDE</span>
          <span className="brand-sub">Fashion &amp; Authentic Goods</span>
        </button>
        <nav className="nav-links desktop-only">
          {nav.map((n) => (
            <button key={n.id} className={`nav-link ${activeSection === n.id ? "active" : ""}`} onClick={() => goToNav(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <div
            className={`header-search desktop-only ${searchOpen ? "is-open" : ""}`}
            ref={searchWrapRef}
            onBlur={handleBlur}
          >
            <button
              type="button"
              className="icon-btn header-search-toggle"
              onClick={() => (searchOpen ? closeSearch() : openSearch())}
              aria-label={searchOpen ? "Close search" : "Search"}
            >
              <Search size={19} />
            </button>
            <div className="header-search-expand">
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && term && viewAllResults()}
                placeholder="Search products..."
              />
              {search && (
                <button type="button" className="header-search-clear" onClick={() => setSearch("")} aria-label="Clear search" tabIndex={-1}>
                  <X size={14} />
                </button>
              )}
            </div>

            {searchOpen && term && (
              <div className="header-search-results">
                {results.length === 0 ? (
                  <p className="header-search-empty">No products match "{search}".</p>
                ) : (
                  <>
                    <table className="header-search-table">
                      <tbody>
                        {results.map((p) => {
                          const rawUrl = p.images?.[0]?.url;
                          // Product images are served from the API origin (e.g.
                          // localhost:4000), not the frontend dev server, so
                          // relative paths need the same prefix ProductImage
                          // applies elsewhere — otherwise the browser requests
                          // them from the wrong origin and they 404 silently.
                          const imgSrc = rawUrl
                            ? (rawUrl.startsWith("http") ? rawUrl : `${SERVER_ORIGIN}${rawUrl}`)
                            : null;
                          return (
                            <tr key={p.id} onClick={() => pickResult(p)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && pickResult(p)}>
                              <td className="header-search-thumb">
                                {imgSrc
                                  ? <img src={imgSrc} alt="" />
                                  : <div className="header-search-thumb-fallback" />}
                              </td>
                              <td className="header-search-info">
                                <span className="header-search-name">{p.name}</span>
                                <span className="header-search-brand">{p.brand}</span>
                              </td>
                              <td className="header-search-price">{peso(p.price)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <button type="button" className="header-search-viewall" onClick={viewAllResults}>
                      View all {totalMatches} result{totalMatches === 1 ? "" : "s"} <ArrowRight size={13} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <button className={`icon-btn ${customer ? "signed-in" : ""}`} onClick={onAccountOpen} aria-label="Account">
            <User size={19} fill={customer ? "#C9A15F" : "none"} />
          </button>
          <button className="icon-btn" onClick={onWishlistOpen} aria-label="Wishlist">
            <Heart size={19} />
            {wishCount > 0 && <span className="pill" key={wishCount}>{wishCount}</span>}
          </button>
          <button className="icon-btn" onClick={onCartOpen} aria-label="Cart">
            <ShoppingBag size={19} />
            {cartCount > 0 && <span className="pill" key={cartCount}>{cartCount}</span>}
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
