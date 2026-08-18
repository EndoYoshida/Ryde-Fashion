import React, { useState, useEffect } from "react";
import "./styles.css";

import Header from "./components/Header";
import Hero from "./components/Hero";
import About from "./components/About";
import Categories from "./components/Categories";
import FeaturedProducts from "./components/FeaturedProducts";
import Testimonials from "./components/Testimonials";
import CTA from "./components/CTA";
import Footer from "./components/Footer";
import Browse from "./components/Browse";
import ProductDetail from "./components/ProductDetail";
import CartDrawer from "./components/CartDrawer";
import WishlistDrawer from "./components/WishlistDrawer";
import Checkout from "./components/Checkout";
import AuthModal from "./components/AuthModal";
import AccountDashboard from "./components/AccountDashboard";
import SupportPage from "./components/SupportPage";
import AdminLayout from "./components/admin/AdminLayout";
import AdminLogin from "./components/admin/AdminLogin";

import { CATEGORY_ICON } from "./data/products";
import * as api from "./api";

// The backend doesn't send React icon components (it can't — icons aren't
// serializable over JSON), so every product coming back from the API gets
// a fallback icon attached client-side based on its category. Once a
// product has real uploaded photos, components should prefer those and
// only fall back to this icon when there are none.
const withIcon = (p) => ({ ...p, icon: CATEGORY_ICON[p.category] });

export default function App() {
  // "area" is separate from the storefront's internal `view` state and is
  // driven by the URL path, not by any button in the UI — there is no
  // link anywhere that sends people to /admin. The only way in is typing
  // the URL directly, which keeps the admin area genuinely separate from
  // the shop rather than one click away from every visitor.
  const [area, setArea] = useState(() =>
    window.location.pathname.startsWith("/admin") ? "admin" : "store"
  );
  useEffect(() => {
    const onPop = () => setArea(window.location.pathname.startsWith("/admin") ? "admin" : "store");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const [view, setView] = useState("home");
  const [cart, setCart] = useState([]);
  const [wishlist, setWishlist] = useState(new Set());
  const [cartOpen, setCartOpen] = useState(false);
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [tagFilter, setTagFilter] = useState(null);

  // Live data loaded from the backend (SQLite via the Express API in
  // /server). Admin dashboard actions call the API, then update these
  // from the server's response, so the database is always the source
  // of truth — refreshing the page reloads real, persisted data.
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState(false);

  // Admin auth. Orders/customers/tickets contain private customer data,
  // so the backend requires a valid session token for them — nothing
  // here is fetched until an admin actually logs in. The token itself
  // lives in sessionStorage (not localStorage) so it clears when the
  // browser tab closes, not indefinitely.
  const [adminToken, setAdminTokenState] = useState(() => sessionStorage.getItem("rydeAdminToken"));
  const [adminDataLoading, setAdminDataLoading] = useState(false);

  // Customer accounts. Unlike admin, customers expect to stay signed in
  // across visits, so this token lives in localStorage.
  const [customerToken, setCustomerTokenState] = useState(() => localStorage.getItem("rydeCustomerToken"));
  const [customer, setCustomer] = useState(null);
  const [customerLoading, setCustomerLoading] = useState(!!localStorage.getItem("rydeCustomerToken"));

  useEffect(() => { window.scrollTo?.(0, 0); }, [view]);
  // The product detail overlay is independent of `view` by design (so it
  // can stay open while browsing), but it should never linger behind the
  // checkout page once someone commits to buying.
  useEffect(() => { if (view === "checkout") setSelectedProduct(null); }, [view]);

  // Public data only — safe to load immediately for every visitor.
  useEffect(() => {
    (async () => {
      try {
        const p = await api.getProducts();
        setProducts(p.map(withIcon));
        setBackendError(false);
      } catch (err) {
        console.error("Failed to load from backend:", err);
        setBackendError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // If a token gets rejected by the server (expired/invalid), drop back
  // to the relevant login screen automatically instead of failing silently.
  useEffect(() => {
    api.setAdminUnauthorizedHandler(() => {
      setAdminTokenState(null);
      sessionStorage.removeItem("rydeAdminToken");
    });
    api.setCustomerUnauthorizedHandler(() => {
      setCustomerTokenState(null);
      setCustomer(null);
      localStorage.removeItem("rydeCustomerToken");
    });
  }, []);

  // Loads orders/customers/tickets once an admin session exists —
  // either right after logging in, or on refresh if a token was still
  // saved in this tab's sessionStorage.
  useEffect(() => {
    if (!adminToken) return;
    api.setAdminToken(adminToken);
    setAdminDataLoading(true);
    (async () => {
      try {
        const [o, c, t] = await Promise.all([api.getOrders(), api.getCustomers(), api.getTickets()]);
        setOrders(o);
        setCustomers(c);
        setTickets(t);
      } catch (err) {
        console.error("Failed to load admin data:", err);
      } finally {
        setAdminDataLoading(false);
      }
    })();
  }, [adminToken]);

  // While logged into admin, periodically re-check for new support
  // tickets — this is how newly emailed-in tickets show up without
  // needing a manual page refresh.
  useEffect(() => {
    if (!adminToken) return;
    const interval = setInterval(() => {
      api.getTickets().then(setTickets).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [adminToken]);

  // Loads the customer's profile once a session exists (e.g. on refresh,
  // from the token saved in localStorage).
  useEffect(() => {
    if (!customerToken) { setCustomerLoading(false); return; }
    api.setCustomerToken(customerToken);
    (async () => {
      try {
        const me = await api.getMe();
        setCustomer(me);
      } catch (err) {
        console.error("Failed to load account:", err);
      } finally {
        setCustomerLoading(false);
      }
    })();
  }, [customerToken]);

  const handleAdminLogin = (token) => {
    sessionStorage.setItem("rydeAdminToken", token);
    setAdminTokenState(token);
    window.history.pushState(null, "", "/admin");
  };
  // Leaving the admin area — for any reason, including just clicking
  // "Back to store" — ends the session entirely. Nobody who wanders back
  // into /admin afterward gets in without logging in again.
  const handleLeaveAdmin = () => {
    if (adminToken) api.logoutAdmin();
    api.setAdminToken(null);
    sessionStorage.removeItem("rydeAdminToken");
    setAdminTokenState(null);
    setOrders([]);
    setCustomers([]);
    setTickets([]);
    window.history.pushState(null, "", "/");
    setArea("store");
    setView("home");
  };

  // --- Admin: products ---
  const addProduct = async (product) => {
    const created = await api.createProduct(product);
    setProducts((prev) => [withIcon(created), ...prev]);
    return created;
  };
  const updateProduct = async (id, changes) => {
    const updated = await api.updateProductApi(id, changes);
    setProducts((prev) => prev.map((p) => (p.id === id ? withIcon(updated) : p)));
  };
  const deleteProduct = async (id) => {
    await api.deleteProductApi(id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setWishlist((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setCart((prev) => prev.filter((c) => c.id !== id));
  };
  // Merges freshly uploaded/deleted image URLs into a product already in state
  // (used by the admin image uploader so the storefront updates immediately).
  const setProductImages = (id, images) =>
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, images } : p)));
  // Generic patch for when the server returns an updated product (e.g.
  // after a rating changes its average) — keeps every view of that
  // product (card, detail, related lists) showing the current numbers.
  // Returns the merged object so callers can pass it straight to
  // openProduct/setSelectedProduct without losing the client-only icon.
  const patchProduct = (updated) => {
    let merged = updated;
    setProducts((prev) => prev.map((p) => {
      if (p.id !== updated.id) return p;
      merged = { ...p, ...updated, icon: p.icon };
      return merged;
    }));
    return merged;
  };

  const rateProduct = async (productId, rating) => {
    const updated = await api.rateProduct(productId, rating);
    return patchProduct(updated);
  };

  const uploadImages = async (id, files) => {
    const res = await api.uploadProductImages(id, files);
    setProductImages(id, res.images);
    return res.images;
  };
  const deleteImage = async (productId, imageId) => {
    const res = await api.deleteProductImage(productId, imageId);
    setProductImages(productId, res.images);
    return res.images;
  };

  // --- Admin: orders ---
  const updateOrderStatus = async (id, status) => {
    const updated = await api.updateOrderStatusApi(id, status);
    setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
  };
  const updatePaymentStatus = async (id, paymentStatus) => {
    const updated = await api.updatePaymentStatusApi(id, paymentStatus);
    setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
  };

  // --- Admin: customers ---
  const toggleCustomerStatus = async (id) => {
    const current = customers.find((c) => c.id === id);
    const nextStatus = current?.status === "active" ? "suspended" : "active";
    await api.toggleCustomerStatusApi(id, nextStatus);
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, status: nextStatus } : c)));
  };

  // --- Admin: support tickets ---
  const resolveTicket = async (id) => {
    const updated = await api.resolveTicketApi(id);
    setTickets((prev) => prev.map((t) => (t.id === id ? updated : t)));
  };
  // Used after a reply is sent — the reply endpoint already returns the
  // updated ticket, so this just syncs it into state without refetching.
  const refreshTicket = (updatedTicket) => {
    setTickets((prev) => prev.map((t) => (t.id === updatedTicket.id ? updatedTicket : t)));
  };

  // --- Customer account ---
  const handleAuthSuccess = (token, customerData) => {
    localStorage.setItem("rydeCustomerToken", token);
    api.setCustomerToken(token);
    setCustomerTokenState(token);
    setCustomer(customerData);
    setAuthOpen(false);
  };
  const handleCustomerLogout = () => {
    api.logoutCustomer();
    api.setCustomerToken(null);
    localStorage.removeItem("rydeCustomerToken");
    setCustomerTokenState(null);
    setCustomer(null);
    setView("home");
  };
  const updateProfile = async (changes) => {
    const updated = await api.updateMe(changes);
    setCustomer(updated);
    return updated;
  };

  const handleAccountIconClick = () => {
    if (customer) setView("account");
    else setAuthOpen(true);
  };

  // Single entry point for "go to the shop" actions across the site.
  // Always explicitly sets category/tag filters (even to null) so a
  // previous filter never lingers when navigating from somewhere else.
  const goShop = (opts = {}) => {
    setCategoryFilter(opts.category ?? null);
    setTagFilter(opts.tag ?? null);
    setView("browse");
  };

  const addToCart = (p, qty = 1) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === p.id);
      if (existing) return prev.map((c) => (c.id === p.id ? { ...c, qty: c.qty + qty } : c));
      return [...prev, { ...p, qty }];
    });
    setCartOpen(true);
  };
  const updateQty = (id, qty) => {
    if (qty < 1) return;
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty } : c)));
  };
  const removeItem = (id) => setCart((prev) => prev.filter((c) => c.id !== id));
  const clearCart = () => setCart([]);
  const toggleWish = (id) => setWishlist((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const refreshProducts = async () => {
    try {
      const p = await api.getProducts();
      setProducts(p.map(withIcon));
    } catch (err) {
      console.error("Failed to refresh products:", err);
    }
  };

  const cartCount = cart.reduce((s, c) => s + c.qty, 0);

  if (loading) {
    return <div className="app-loading">Loading Ryde&hellip;</div>;
  }

  if (area === "admin") {
    return (
      <div className="ryde-app">
        {!adminToken ? (
          <AdminLogin onLoginSuccess={handleAdminLogin} onBack={handleLeaveAdmin} />
        ) : adminDataLoading ? (
          <div className="app-loading">Loading dashboard&hellip;</div>
        ) : (
          <AdminLayout
            onLeaveAdmin={handleLeaveAdmin}
            products={products} addProduct={addProduct} updateProduct={updateProduct} deleteProduct={deleteProduct}
            uploadImages={uploadImages} deleteImage={deleteImage}
            orders={orders} updateOrderStatus={updateOrderStatus} updatePaymentStatus={updatePaymentStatus}
            customers={customers} toggleCustomerStatus={toggleCustomerStatus}
            tickets={tickets} resolveTicket={resolveTicket} refreshTicket={refreshTicket}
          />
        )}
      </div>
    );
  }

  return (
    <div className="ryde-app">
      {backendError && (
        <div className="backend-error-banner">
          Can&rsquo;t reach the backend at <code>localhost:4000</code>. Run <code>npm run dev</code> inside the{" "}
          <code>server</code> folder, then refresh this page.
        </div>
      )}
      {customer && !customer.emailVerified && view !== "account" && (
        <div className="verify-banner site-wide">
          Please verify your email to unlock your full account.
          <button onClick={() => setView("account")}>Verify now &rarr;</button>
        </div>
      )}

      <Header
        view={view} setView={setView} goShop={goShop}
        cartCount={cartCount} wishCount={wishlist.size}
        onCartOpen={() => setCartOpen(true)} onWishlistOpen={() => setWishlistOpen(true)}
        onAccountOpen={handleAccountIconClick}
        customer={customer}
        search={search} setSearch={setSearch}
      />

      {view === "home" && (
        <>
          <Hero goShop={goShop} />
          <About />
          <Categories goShop={goShop} products={products} />
          <FeaturedProducts products={products} openProduct={setSelectedProduct} toggleWish={toggleWish} wishlist={wishlist} addToCart={addToCart} goShop={goShop} />
          <Testimonials />
          <CTA goShop={goShop} />
        </>
      )}

      {view === "browse" && (
        <Browse
          products={products}
          openProduct={setSelectedProduct}
          toggleWish={toggleWish}
          wishlist={wishlist}
          addToCart={addToCart}
          search={search}
          setSearch={setSearch}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          tagFilter={tagFilter}
          setTagFilter={setTagFilter}
        />
      )}

      {view === "checkout" && (
        <Checkout
          cart={cart}
          setView={setView}
          clearCart={clearCart}
          onOrderCreated={(order) => { setOrders((prev) => [order, ...prev]); refreshProducts(); }}
          customer={customer}
        />
      )}

      {view === "account" && customer && (
        <AccountDashboard
          customer={customer}
          updateProfile={updateProfile}
          onCustomerUpdated={setCustomer}
          onLogout={handleCustomerLogout}
          setView={setView}
        />
      )}

      {view === "support" && <SupportPage customer={customer} />}

      <Footer goShop={goShop} setView={setView} customer={customer} onAccountOpen={handleAccountIconClick} />

      <ProductDetail product={selectedProduct} onClose={() => setSelectedProduct(null)} addToCart={addToCart} toggleWish={toggleWish} wishlist={wishlist} products={products} openProduct={setSelectedProduct} customer={customer} rateProduct={rateProduct} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} updateQty={updateQty} removeItem={removeItem} setView={setView} />
      <WishlistDrawer open={wishlistOpen} onClose={() => setWishlistOpen(false)} wishlist={wishlist} toggleWish={toggleWish} addToCart={addToCart} openProduct={setSelectedProduct} products={products} />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onAuthSuccess={handleAuthSuccess} />
    </div>
  );
}
