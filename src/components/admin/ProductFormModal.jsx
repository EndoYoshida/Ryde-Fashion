import React, { useState, useEffect } from "react";
import { X, Upload, Loader2 } from "lucide-react";
import { CATEGORIES, CATEGORY_ICON, STATUS_OPTIONS } from "../../data/products";
import { SERVER_ORIGIN } from "../../api";

const emptyForm = {
  name: "", brand: "", category: CATEGORIES[0].id, price: "", stock: "",
  status: "available", tag: "", description: "", weight: "0.3",
};

export default function ProductFormModal({ product, onClose, onSave, uploadImages, deleteImage }) {
  const [form, setForm] = useState(
    product
      ? {
          name: product.name, brand: product.brand, category: product.category,
          price: product.price, stock: product.stock, status: product.status,
          tag: product.tag || "", description: product.description || "",
          weight: product.weight != null ? String(product.weight) : "0.3",
        }
      : emptyForm
  );

  // Images already saved on the server (edit mode only — a brand new
  // product has no id to attach images to until it's created).
  const [existingImages, setExistingImages] = useState(product?.images || []);
  // Files picked before the product exists yet (new-product flow) —
  // uploaded right after creation succeeds.
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingPreviews, setPendingPreviews] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => pendingPreviews.forEach((url) => URL.revokeObjectURL(url));
  }, [pendingPreviews]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleFilesPicked = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow picking the same file again later
    if (files.length === 0) return;

    if (product) {
      // Editing an existing product — upload immediately, no need to wait for Save.
      setBusy(true);
      setError("");
      try {
        const images = await uploadImages(product.id, files);
        setExistingImages(images);
      } catch (err) {
        setError(err.message || "Upload failed");
      } finally {
        setBusy(false);
      }
    } else {
      // New product — hold onto the files and preview them locally
      // until the product is actually created.
      setPendingFiles((prev) => [...prev, ...files]);
      setPendingPreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))]);
    }
  };

  const removePendingFile = (index) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    setPendingPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const removeExistingImage = async (imageId) => {
    setBusy(true);
    setError("");
    try {
      const images = await deleteImage(product.id, imageId);
      setExistingImages(images);
    } catch (err) {
      setError(err.message || "Failed to remove image");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.brand.trim() || !form.price) return;
    setBusy(true);
    setError("");
    try {
      const saved = await onSave({
        ...form,
        price: Number(form.price),
        stock: Number(form.stock) || 0,
        weight: Number(form.weight) || 0.3,
        tag: form.tag || undefined,
        icon: CATEGORY_ICON[form.category],
      });
      // Brand new product: now that it has a real id, upload anything
      // that was picked before it existed.
      if (!product && pendingFiles.length > 0 && saved?.id) {
        await uploadImages(saved.id, pendingFiles);
      }
      onClose();
    } catch (err) {
      setError(err.message || "Something went wrong saving this product");
      setBusy(false);
    }
  };

  return (
    <div className="overlay center" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h3>{product ? "Edit Product" : "Add New Product"}</h3>
        <form onSubmit={handleSubmit} className="admin-form">

          <label>Product photos
            <div className="admin-image-grid">
              {existingImages.map((img) => (
                <div className="admin-image-thumb" key={img.id}>
                  <img src={`${SERVER_ORIGIN}${img.url}`} alt="" />
                  <button type="button" className="admin-image-remove" onClick={() => removeExistingImage(img.id)} aria-label="Remove image">
                    <X size={12} />
                  </button>
                </div>
              ))}
              {pendingPreviews.map((url, i) => (
                <div className="admin-image-thumb" key={url}>
                  <img src={url} alt="" />
                  <button type="button" className="admin-image-remove" onClick={() => removePendingFile(i)} aria-label="Remove image">
                    <X size={12} />
                  </button>
                </div>
              ))}
              <label className="admin-image-add">
                {busy ? <Loader2 size={16} className="admin-spin" /> : <Upload size={16} />}
                <span>Add</span>
                <input type="file" accept="image/*" multiple hidden onChange={handleFilesPicked} disabled={busy} />
              </label>
            </div>
            <span className="admin-field-hint">
              {product ? "Uploads and removals save immediately." : "Selected photos upload once you save this product."}
            </span>
          </label>

          <label>Product name
            <input value={form.name} onChange={set("name")} placeholder="e.g. Aurora Quilted Tote" required />
          </label>
          <label>Brand
            <input value={form.brand} onChange={set("brand")} placeholder="e.g. Ryde House" required />
          </label>
          <div className="admin-form-row">
            <label>Category
              <select value={form.category} onChange={set("category")}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Status
              <select value={form.status} onChange={set("status")}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <div className="admin-form-row">
            <label>Price (&#8369;)
              <input type="number" min="0" value={form.price} onChange={set("price")} placeholder="0" required />
            </label>
            <label>Stock
              <input type="number" min="0" value={form.stock} onChange={set("stock")} placeholder="0" />
            </label>
          </div>
          <label>Weight (kg) — used to calculate J&amp;T shipping fees
            <input type="number" min="0" step="0.01" value={form.weight} onChange={set("weight")} placeholder="0.3" />
          </label>
          <label>Description
            <textarea
              value={form.description}
              onChange={set("description")}
              placeholder="Describe this product — materials, fit, what makes it special..."
              rows={4}
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />
          </label>

          <label>Tag (optional)
            <select value={form.tag} onChange={set("tag")}>
              <option value="">None</option>
              <option value="New">New</option>
              <option value="Bestseller">Bestseller</option>
            </select>
          </label>

          {error && <p className="admin-form-error">{error}</p>}

          <div className="admin-form-actions">
            <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-gold" disabled={busy}>
              {busy ? "Saving..." : product ? "Save Changes" : "Add Product"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
