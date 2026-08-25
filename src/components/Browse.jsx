import React, { useState, useMemo } from "react";
import { Search, SlidersHorizontal, ChevronDown } from "lucide-react";
import { CATEGORIES, GENDER_OPTIONS, peso } from "../data/products";
import ProductCard from "./ProductCard";

export default function Browse({ products, openProduct, toggleWish, wishlist, addToCart, search, setSearch, categoryFilter, setCategoryFilter, brandFilter, setBrandFilter, tagFilter, setTagFilter }) {
  const [sort, setSort] = useState("newest");
  const [priceMax, setPriceMax] = useState(16000);
  const [availOnly, setAvailOnly] = useState(false);
  const [saleOnly, setSaleOnly] = useState(false);
  const [genderFilter, setGenderFilter] = useState(null);
  // Collapsed by default — expanding to show every filter section right
  // away buried the product grid below the fold on first load.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Brands are free text (unlike category/gender, which are fixed
  // lists), so the filter chips are built from whatever brands actually
  // appear on the currently loaded products, rather than a hardcoded list.
  const brandOptions = useMemo(() => {
    const set = new Set();
    products.forEach((p) => { if (p.brand) set.add(p.brand); });
    return [...set].sort();
  }, [products]);

  const isOnSale = (p) => p.onSale;

  const filtered = useMemo(() => {
    let list = products.filter((p) => p.price <= priceMax);
    if (categoryFilter) list = list.filter((p) => p.category === categoryFilter);
    if (tagFilter === "Bestseller") list = list.filter((p) => p.bestseller);
    else if (tagFilter === "Sale") list = list.filter(isOnSale);
    else if (tagFilter) list = list.filter((p) => p.tag === tagFilter);
    if (genderFilter) list = list.filter((p) => p.gender === genderFilter);
    if (brandFilter) list = list.filter((p) => p.brand === brandFilter);
    if (search) list = list.filter((p) => (p.name + p.brand).toLowerCase().includes(search.toLowerCase()));
    if (availOnly) list = list.filter((p) => p.status === "available");
    if (saleOnly) list = list.filter(isOnSale);
    if (sort === "price-asc") list = [...list].sort((a, b) => a.price - b.price);
    if (sort === "price-desc") list = [...list].sort((a, b) => b.price - a.price);
    if (sort === "popularity") list = [...list].sort((a, b) => b.reviews - a.reviews);
    if (sort === "newest") list = [...list].sort((a, b) => b.id - a.id);
    return list;
  }, [products, categoryFilter, tagFilter, genderFilter, brandFilter, search, sort, priceMax, availOnly, saleOnly]);

  const heading = tagFilter === "New" ? "New Arrivals" : tagFilter === "Bestseller" ? "Best Sellers" : tagFilter === "Sale" ? "Items on Sale" : "Shop all products";

  return (
    <section className="browse" id="browse-section">
      <div className="browse-head">
        <p className="eyebrow">The collection</p>
        <h2>{heading}</h2>
        <div className="search-box mobile-only" style={{ marginTop: 14 }}>
          <Search size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products..." />
        </div>
      </div>
      <div className="browse-body">
        <aside className="filters">
          <button
            type="button"
            className="filter-title"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal size={14} /> Filters
            <ChevronDown size={15} className={`filter-chevron ${filtersOpen ? "open" : ""}`} />
          </button>
          <div className={`filter-collapse ${filtersOpen ? "open" : ""}`}>
            <div className="filter-collapse-inner">
              {tagFilter && (
                <div className="filter-group">
                  <h5>Showing</h5>
                  <button className="filter-chip active" onClick={() => setTagFilter(null)}>
                    {tagFilter === "New" ? "New Arrivals" : tagFilter === "Sale" ? "Items on Sale" : "Best Sellers"} &times;
                  </button>
                </div>
              )}
              <div className="filter-group">
                <h5>Category</h5>
                <button className={`filter-chip ${!categoryFilter ? "active" : ""}`} onClick={() => setCategoryFilter(null)}>All</button>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    className={`filter-chip ${categoryFilter === c.id ? "active" : ""}`}
                    style={categoryFilter === c.id ? { color: c.color } : undefined}
                    onClick={() => setCategoryFilter(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="filter-group">
                <h5>Gender</h5>
                <button className={`filter-chip ${!genderFilter ? "active" : ""}`} onClick={() => setGenderFilter(null)}>All</button>
                {GENDER_OPTIONS.map((g) => (
                  <button
                    key={g}
                    className={`filter-chip ${genderFilter === g ? "active" : ""}`}
                    onClick={() => setGenderFilter(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
              {brandOptions.length > 0 && (
                <div className="filter-group">
                  <h5>Brand</h5>
                  <button className={`filter-chip ${!brandFilter ? "active" : ""}`} onClick={() => setBrandFilter(null)}>All</button>
                  {brandOptions.map((b) => (
                    <button
                      key={b}
                      className={`filter-chip ${brandFilter === b ? "active" : ""}`}
                      onClick={() => setBrandFilter(b)}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              )}
              <div className="filter-group">
                <h5>Max price: {peso(priceMax)}</h5>
                <input type="range" min="1500" max="16000" step="500" value={priceMax} onChange={(e) => setPriceMax(Number(e.target.value))} className="range" />
              </div>
              <div className="filter-group">
                <label className="checkbox-row">
                  <input type="checkbox" checked={availOnly} onChange={(e) => setAvailOnly(e.target.checked)} />
                  In stock only
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={saleOnly} onChange={(e) => setSaleOnly(e.target.checked)} />
                  On sale only
                </label>
              </div>
            </div>
          </div>
        </aside>
        <div className="browse-main">
          <div className="browse-toolbar">
            <span className="result-count">{filtered.length} products</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="sort-select">
              <option value="newest">Newest</option>
              <option value="popularity">Popularity</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
            </select>
          </div>
          {filtered.length === 0 ? (
            <div className="empty-state">No products match your filters.</div>
          ) : (
            <div className="prod-grid">
              {filtered.map((p) => (
                <ProductCard key={p.id} p={p} openProduct={openProduct} toggleWish={toggleWish} wishlist={wishlist} addToCart={addToCart} highlight={search} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
