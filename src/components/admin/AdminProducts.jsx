import React, { useState, useMemo } from "react";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { peso, STATUS_LABEL } from "../../data/products";
import ProductFormModal from "./ProductFormModal";
import ProductImage from "../ui/ProductImage";

export default function AdminProducts({ products, addProduct, updateProduct, deleteProduct, uploadImages, deleteImage }) {
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q));
  }, [products, search]);

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
        <button className="btn-gold" onClick={openAdd}><Plus size={16} /> Add Product</button>
      </div>

      <div className="admin-search-box">
        <Search size={15} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products or brand..." />
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
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
                  <td>
                    <div className="admin-thumb">
                      <ProductImage Icon={p.icon} size={16} src={p.images?.[0]?.url} />
                    </div>
                  </td>
                  <td className="admin-table-name">{p.name}</td>
                  <td>{p.brand}</td>
                  <td className="admin-capitalize">{p.category}</td>
                  <td>{peso(p.price)}</td>
                  <td>{p.stock}</td>
                  <td><span className={`status-badge inline ${st.cls}`}>{st.label}</span></td>
                  <td>{p.tag || "—"}</td>
                  <td className="admin-table-actions">
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
