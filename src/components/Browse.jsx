import React, { useState, useMemo } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { CATEGORIES, peso } from "../data/products";
import ProductCard from "./ProductCard";

export default function Browse({ products, openProduct, toggleWish, wishlist, addToCart, search, setSearch, categoryFilter, setCategoryFilter, tagFilter, setTagFilter }) {
  const [sort, setSort] = useState("newest");
  const [priceMax, setPriceMax] = useState(16000);
  const [availOnly, setAvailOnly] = useState(false);

  const filtered = useMemo(() => {
    let list = products.filter((p) => p.price <= priceMax);
    if (categoryFilter) list = list.filter((p) => p.category === categoryFilter);
    if (tagFilter === "Bestseller") list = list.filter((p) => p.bestseller);
    else if (tagFilter) list = list.filter((p) => p.tag === tagFilter);
    if (search) list = list.filter((p) => (p.name + p.brand).toLowerCase().includes(search.toLowerCase()));
    if (availOnly) list = list.filter((p) => p.status === "available");
    if (sort === "price-asc") list = [...list].sort((a, b) => a.price - b.price);
    if (sort === "price-desc") list = [...list].sort((a, b) => b.price - a.price);
    if (sort === "popularity") list = [...list].sort((a, b) => b.reviews - a.reviews);
    if (sort === "newest") list = [...list].sort((a, b) => b.id - a.id);
    return list;
  }, [products, categoryFilter, tagFilter, search, sort, priceMax, availOnly]);

  const heading = tagFilter === "New" ? "New Arrivals" : tagFilter === "Bestseller" ? "Best Sellers" : "Shop all products";

  return (
    <section className="browse">
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
          <div className="filter-title"><SlidersHorizontal size={14} /> Filters</div>
          {tagFilter && (
            <div className="filter-group">
              <h5>Showing</h5>
              <button className="filter-chip active" onClick={() => setTagFilter(null)}>
                {tagFilter === "New" ? "New Arrivals" : "Best Sellers"} &times;
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
            <h5>Max price: {peso(priceMax)}</h5>
            <input type="range" min="1500" max="16000" step="500" value={priceMax} onChange={(e) => setPriceMax(Number(e.target.value))} className="range" />
          </div>
          <div className="filter-group">
            <label className="checkbox-row">
              <input type="checkbox" checked={availOnly} onChange={(e) => setAvailOnly(e.target.checked)} />
              In stock only
            </label>
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
