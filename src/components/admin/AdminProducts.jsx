import React, { useState, useMemo, useEffect, useRef } from "react";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { peso, STATUS_LABEL, CATEGORIES, STATUS_OPTIONS } from "../../data/products";
import ProductFormModal from "./ProductFormModal";
import ProductImage from "../ui/ProductImage";

// Sort choices offered in the products toolbar. Each maps to a compare
// function so switching "sort by" is just picking a different entry here.
const SORT_OPTIONS = [
  { id: "name-asc", label: "Name (A–Z)", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "name-desc", label: "Name (Z–A)", compare: (a, b) => b.name.localeCompare(a.name) },
  { id: "price-asc", label: "Price (Low to High)", compare: (a, b) => Number(a.price) - Number(b.price) },
  { id: "price-desc", label: "Price (High to Low)", compare: (a, b) => Number(b.price) - Number(a.price) },
  { id: "stock-asc", label: "Stock (Low to High)", compare: (a, b) => Number(a.stock) - Number(b.stock) },
  { id: "stock-desc", label: "Stock (High to Low)", compare: (a, b) => Number(b.stock) - Number(a.stock) },
];

// Scrolls its text left only when the text actually doesn't fit the
// box — measured via scrollWidth vs the visible container width,
// re-checked on resize, rather than guessing from character count.
function MarqueeText({ text }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const check = () => {
      if (outerRef.current && innerRef.current) {
        setOverflowing(innerRef.current.scrollWidth > outerRef.current.clientWidth + 1);
      }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [text]);

  return (
    <span ref={outerRef} className={`admin-marquee${overflowing ? " scrolling" : ""}`}>
      <span ref={innerRef}>{text}</span>
    </span>
  );
}

export default function AdminProducts({ products, addProduct, updateProduct, deleteProduct, uploadImages, deleteImage }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name-asc");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Mobile-only floating Add Product button: hide it while scrolling
  // down (out of the way of content), bring it back on scroll up. Has
  // no visible effect on desktop, where this button stays inline in
  // the filter row instead of floating.
  const [fabHidden, setFabHidden] = useState(false);
  const lastScrollY = useRef(0);
  useEffect(() => {
    lastScrollY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setFabHidden(y > lastScrollY.current && y > 80);
      lastScrollY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const filtered = useMemo(() => {
    let list = products;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q));
    }
    if (categoryFilter !== "all") list = list.filter((p) => p.category === categoryFilter);
    if (statusFilter !== "all") list = list.filter((p) => p.status === statusFilter);

    const sort = SORT_OPTIONS.find((s) => s.id === sortBy) || SORT_OPTIONS[0];
    return [...list].sort(sort.compare);
  }, [products, search, categoryFilter, statusFilter, sortBy]);

  const openAdd = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (p) => { setEditing(p); setModalOpen(true); };

  // Returns the saved product (with its real database id) so the modal
  // can immediately upload any pending image files against it.
  const handleSave = async (form) => {
    if (editing) {
      await updateProduct(editing.id, form);
      return { ...editing, ...form };
    }
    return addProduct(form);
  };

  return (
    <div>
      <div className="admin-topbar">
        <div>
          <p className="admin-eyebrow">Catalog</p>
          <h1>Products</h1>
        </div>
      </div>

      <div className="admin-search-box">
        <Search size={15} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products or brand..." />
      </div>

      <div className="admin-filter-bar">
        <label className="admin-filter-field">
          <span>Category</span>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="admin-filter-field">
          <span>Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s].label}</option>
            ))}
          </select>
        </label>

        <label className="admin-filter-field">
          <span>Sort by</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>

        {(categoryFilter !== "all" || statusFilter !== "all" || sortBy !== "name-asc") && (
          <button
            type="button"
            className="admin-link-btn"
            onClick={() => { setCategoryFilter("all"); setStatusFilter("all"); setSortBy("name-asc"); }}
          >
            Reset filters
          </button>
        )}

        <button
          className={`btn-gold admin-filter-add-btn${fabHidden ? " fab-hidden" : ""}`}
          onClick={openAdd}
        ><Plus size={16} /> Add Product</button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table admin-products-table">
          <thead>
            <tr>
              <th></th>
              <th>Product</th>
              <th>Brand</th>
              <th>Category</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Status</th>
              <th>Tag</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const st = STATUS_LABEL[p.status];
              return (
                <tr key={p.id}>
                  <td data-label="">
                    <div className="admin-thumb">
                      <ProductImage Icon={p.icon} size={16} src={p.images?.[0]?.url} />
                    </div>
                  </td>
                  <td className="admin-table-name" data-label="Product">
                    <MarqueeText text={p.name} />
                  </td>
                  <td data-label="Brand">{p.brand}</td>
                  <td className="admin-capitalize" data-label="Category">{p.category}</td>
                  <td data-label="Price">{peso(p.price)}</td>
                  <td data-label="Stock">{p.stock}</td>
                  <td data-label="Status"><span className={`status-badge inline ${st.cls}`}>{st.label}</span></td>
                  <td data-label="Tag">{p.tag || "—"}</td>
                  <td className="admin-table-actions" data-label="">
                    <button className="admin-icon-btn" onClick={() => openEdit(p)} aria-label="Edit"><Pencil size={14} /></button>
                    <button className="admin-icon-btn danger" onClick={() => setConfirmDelete(p)} aria-label="Delete"><Trash2 size={14} /></button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="admin-empty">No products match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <ProductFormModal
          product={editing}
          onClose={() => setModalOpen(false)}
          onSave={handleSave}
          uploadImages={uploadImages}
          deleteImage={deleteImage}
        />
      )}

      {confirmDelete && (
        <div className="overlay center" onClick={() => setConfirmDelete(null)}>
          <div className="admin-modal admin-modal-small" onClick={(e) => e.stopPropagation()}>
            <h3>Delete product?</h3>
            <p className="admin-empty" style={{ padding: 0, marginBottom: 20 }}>
              This will permanently remove &ldquo;{confirmDelete.name}&rdquo; from the catalog.
            </p>
            <div className="admin-form-actions">
              <button className="btn-outline" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button
                className="btn-gold"
                style={{ background: "#9B4646" }}
                onClick={() => { deleteProduct(confirmDelete.id); setConfirmDelete(null); }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
