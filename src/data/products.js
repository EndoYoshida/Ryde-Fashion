import {
  ShoppingBag, Shirt, Footprints, Watch, Droplet, Palette, Wallet, Gem
} from "lucide-react";

export const CATEGORIES = [
  { id: "bags", name: "Bags", icon: ShoppingBag, color: "#8A5A46" },
  { id: "apparel", name: "Apparel", icon: Shirt, color: "#5E7C6B" },
  { id: "shoes", name: "Shoes", icon: Footprints, color: "#6E5A8A" },
  { id: "watches", name: "Watches", icon: Watch, color: "#4A6E8A" },
  { id: "perfume", name: "Perfume", icon: Droplet, color: "#B0567A" },
  { id: "makeup", name: "Makeup", icon: Palette, color: "#C9A15F" },
  { id: "wallets", name: "Wallets", icon: Wallet, color: "#7A6A4F" },
  { id: "accessories", name: "Accessories", icon: Gem, color: "#3E7C7C" },
];

// Maps a category id to its default icon component, used when the
// admin dashboard creates a new product.
export const CATEGORY_ICON = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.icon]));

export const STATUS_OPTIONS = ["available", "sold-out", "coming-soon", "unavailable"];

// Real product data now lives in the database (see /server/db) and is
// loaded through src/api.js. This file only keeps small static lookup
// data the UI needs (categories, testimonials, formatting helpers).

// Starts empty on purpose — no fake preset reviews. Real reviews
// submitted through the form below populate this at runtime; nothing
// here should be treated as seed/demo content.
export const TESTIMONIALS = [];

export const peso = (n) => {
  const num = Number(n);
  return `\u20b1${Number.isFinite(num) ? num.toLocaleString() : "0"}`;
};

export const STATUS_LABEL = {
  "available": { label: "Available", cls: "badge-ok" },
  "sold-out": { label: "Sold Out", cls: "badge-off" },
  "coming-soon": { label: "Coming Soon", cls: "badge-soon" },
  "unavailable": { label: "Unavailable", cls: "badge-off" },
};
