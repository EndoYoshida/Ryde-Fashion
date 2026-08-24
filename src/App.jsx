import React, { useState, useEffect } from "react";
import { signOut } from "firebase/auth";
import "./styles.css";

import { auth } from "./firebaseConfig";
import logo from "./assets/logo.jpg";
import Header from "./components/Header";
import Hero from "./components/Hero";
import About from "./components/About";
import Categories from "./components/Categories";
import Brands from "./components/Brands";
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
import PrivacyPolicy from "./components/PrivacyPolicy";
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

  // `view` now maps 1:1 to a real URL, so each "page" (home/shop/support/
  // checkout/account) is its own route instead of a scroll target on one
  // long page. Initialized from the current path so a hard refresh or a
  // shared link lands directly on the right page.
  const pathForView = (v) =>
    ({ home: "/", shop: "/shop", support: "/support", checkout: "/checkout", account: "/account", "privacy-policy": "/privacy-policy" }[v] || "/");
  const viewForPath = (path) => {
    if (path === "/shop") return "shop";
    if (path === "/support") return "support";
    if (path === "/checkout") return "checkout";
    if (path === "/account") return "account";
    if (path === "/privacy-policy") return "privacy-policy";
    return "home";
  };
  const [view, setView] = useState(() => viewForPath(window.location.pathname));

  // Single entry point for switching pages: updates the URL and the view
  // together, so back/forward and page refresh always match what's on
  // screen. Passed down as the `setView` prop wherever a component just
  // wants to say "go to home/checkout/account" — same call signature as
  // before, it just also carries a real URL now.
  const navigateTo = (v) => {
    window.history.pushState(null, "", pathForView(v));
    setView(v);
  };

  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname;
      setArea(path.startsWith("/admin") ? "admin" : "store");
      setView(viewForPath(path));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [cart, setCart] = useState([]);
  const [wishlist, setWishlist] = useState(new Set());
  const [cartOpen, setCartOpen] = useState(false);
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [brandFilter, setBrandFilter] = useState(null);
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
  // here is fetched until an admin actually logs in. Unlike the customer
  // token below, this is kept in plain component state only (never
  // written to session/local storage), so a page refresh always drops
  // back to the login screen rather than silently staying signed in.
  const [adminToken, setAdminTokenState] = useState(null);
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
    });
    api.setCustomerUnauthorizedHandler(() => {
      setCustomerTokenState(null);
      setCustomer(null);
      localStorage.removeItem("rydeCustomerToken");
    });
  }, []);

  // Loads orders/customers/tickets once an admin session exists, i.e.
  // right after logging in (this never fires from a refresh, since
  // adminToken isn't persisted).
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
  // from the token saved in localStorage). Also pulls their saved
  // wishlist from the server so it's the same on every device, and so
  // the backend knows who to notify when a wishlisted item restocks.
  useEffect(() => {
    if (!customerToken) { setCustomerLoading(false); return; }
    api.setCustomerToken(customerToken);
    (async () => {
      try {
        const me = await api.getMe();
        setCustomer(me);
        const { productIds } = await api.getMyWishlist();
        setWishlist(new Set(productIds));
      } catch (err) {
        console.error("Failed to load account:", err);
      } finally {
        setCustomerLoading(false);
      }
    })();
  }, [customerToken]);

  const handleAdminLogin = (token) => {
    setAdminTokenState(token);
    window.history.pushState(null, "", "/admin");
  };
  // Leaving the admin area — for any reason, including just clicking
  // "Back to store" — ends the session entirely. Nobody who wanders back
  // into /admin afterward gets in without logging in again.
  const handleLeaveAdmin = () => {
    if (adminToken) api.logoutAdmin();
    api.setAdminToken(null);
    setAdminTokenState(null);
    setOrders([]);
    setCustomers([]);
    setTickets([]);
    window.history.pushState(null, "", "/");
    setArea("store");
    setView("home");
  };
  // Used only for AdminLayout's "Log out & return to store" button —
  // AdminLogin's own "Back" button calls handleLeaveAdmin directly since
  // there's no active session to confirm losing at that point.
  const handleAdminLogoutClick = () => {
    if (!window.confirm("Are you sure you want to log out?")) return;
    handleLeaveAdmin();
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
    const result = await api.deleteProductApi(id);
    if (result?.archived) {
      // Had order history, so the backend archived it (status set to
      // "unavailable") instead of deleting the row — keep it in local
      // state with that status rather than removing it, so the admin
      // list stays accurate without a full refetch.
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, status: "unavailable", stock: 0 } : p)));
      window.alert(result.message || "This product has order history, so it was marked unavailable instead of deleted.");
      return;
    }
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
  // Generic setter used by both the Suspend/Activate toggle and the
  // Delete/Restore actions — the backend treats all three as the same
  // "set status" operation, soft-deleting rather than removing the row.
  const setCustomerStatus = async (id, status) => {
    await api.toggleCustomerStatusApi(id, status);
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
  };
  const toggleCustomerStatus = (id) => {
    const current = customers.find((c) => c.id === id);
    setCustomerStatus(id, current?.status === "active" ? "suspended" : "active");
  };
  const deleteCustomer = (id) => setCustomerStatus(id, "deleted");
  const restoreCustomer = (id) => setCustomerStatus(id, "active");

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
    // Pull their saved wishlist down from the server so items they
    // wishlisted on another device (or a previous session) show up here.
    api.getMyWishlist()
      .then(({ productIds }) => setWishlist(new Set(productIds)))
      .catch((err) => console.error("Failed to load wishlist:", err));
  };
  const handleCustomerLogout = () => {
    if (!window.confirm("Are you sure you want to log out?")) return;
    api.logoutCustomer();
    api.setCustomerToken(null);
    localStorage.removeItem("rydeCustomerToken");
    setCustomerTokenState(null);
    setCustomer(null);
    signOut(auth).catch(() => {}); // clear Firebase's own local session too
    // Their wishlist is safely saved server-side — clear it from this
    // (now signed-out) browser so the next person on this device
    // doesn't see it.
    setWishlist(new Set());
    navigateTo("home");
  };
  const updateProfile = async (changes) => {
    const updated = await api.updateMe(changes);
    setCustomer(updated);
    return updated;
  };

  const handleAccountIconClick = () => {
    if (customer) navigateTo("account");
    else setAuthOpen(true);
  };

  // Scrolls to an anchor that lives *within* the current page (e.g.
  // "about-section" on Home, "faq" on Support) — used after navigating
  // to that page, or directly if already there.
  const scrollToId = (id) => {
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  };

  // Home, Shop, and Support are now separate pages/routes rather than
  // sections on one scrollable landing page.
  const goAbout = () => {
    if (view !== "home") navigateTo("home");
    scrollToId("about-section");
  };
  const goSupport = (anchorId) => {
    navigateTo("support");
    if (anchorId) scrollToId(anchorId);
  };
  // Always explicitly sets category/brand/tag filters (even to null) so a
  // previous filter never lingers when navigating from somewhere else.
  const goShop = (opts = {}) => {
    setCategoryFilter(opts.category ?? null);
    setBrandFilter(opts.brand ?? null);
    setTagFilter(opts.tag ?? null);
    navigateTo("shop");
  };
  // Header and Footer still call this by the section id they always have
  // (about-section, browse-section, support-section, faq) — it routes
  // each one to its real page now instead of assuming they're all on
  // the same scrollable home layout.
  const scrollToSection = (id) => {
    if (id === "about-section") return goAbout();
    if (id === "browse-section") return goShop();
    if (id === "faq") return goSupport("faq");
    if (id === "support-section") return goSupport();
    scrollToId(id);
  };

  // Caps at the product's stock no matter how it's called — clicking "Add
  // to cart" again on something already in the cart, or opening the
  // product detail modal a second time, both funnel through here, so this
  // is the one place that needs to enforce the limit.
  const addToCart = (p, qty = 1) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === p.id);
      const cap = p.stock ?? Infinity;
      const nextQty = Math.min((existing?.qty ?? 0) + qty, cap);
      if (existing) return prev.map((c) => (c.id === p.id ? { ...c, qty: nextQty } : c));
      return [...prev, { ...p, qty: nextQty }];
    });
    setCartOpen(true);
  };
  const updateQty = (id, qty) => {
    if (qty < 1) return;
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty: Math.min(qty, c.stock ?? Infinity) } : c)));
  };
  const removeItem = (id) => setCart((prev) => prev.filter((c) => c.id !== id));
  const clearCart = () => setCart([]);
  const toggleWish = (id) => {
    const wasWished = wishlist.has(id);
    setWishlist((prev) => {
      const next = new Set(prev);
      wasWished ? next.delete(id) : next.add(id);
      return next;
    });
    // Signed-in customers get their wishlist persisted server-side, both
    // so it follows them across devices and so restock emails can reach
    // them. Guests just keep it in this browser tab for the session.
    if (customerToken) {
      const call = wasWished ? api.removeFromWishlistApi(id) : api.addToWishlistApi(id);
      call.catch((err) => console.error("Failed to sync wishlist:", err));
    }
  };

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
    return (
      <div className="app-loading">
        <div className="app-loading-inner">
          <img src={logo} alt="Ryde" className="logo-img logo-hero" />
          <span>Loading Ryde&hellip;</span>
        </div>
      </div>
    );
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
            onLeaveAdmin={handleAdminLogoutClick}
            products={products} addProduct={addProduct} updateProduct={updateProduct} deleteProduct={deleteProduct}
            uploadImages={uploadImages} deleteImage={deleteImage}
            orders={orders} updateOrderStatus={updateOrderStatus} updatePaymentStatus={updatePaymentStatus}
            customers={customers} toggleCustomerStatus={toggleCustomerStatus}
            deleteCustomer={deleteCustomer} restoreCustomer={restoreCustomer}
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
          Can&rsquo;t reach the backend at <code>{api.SERVER_ORIGIN}</code>. Make sure the server is running, then refresh this page.
        </div>
      )}
      {customer && !customer.emailVerified && view !== "account" && (
        <div className="verify-banner site-wide">
          Please verify your email to unlock your full account.
          <button onClick={() => navigateTo("account")}>Verify now &rarr;</button>
        </div>
      )}

      <Header
        view={view} setView={navigateTo} goShop={goShop} scrollToSection={scrollToSection}
        cartCount={cartCount} wishCount={wishlist.size}
        onCartOpen={() => setCartOpen(true)} onWishlistOpen={() => setWishlistOpen(true)}
        onAccountOpen={handleAccountIconClick}
        customer={customer}
        search={search} setSearch={setSearch}
        products={products} openProduct={setSelectedProduct}
      />

      {view === "home" && (
        <>
          <Hero goShop={goShop} />
          <Categories goShop={goShop} products={products} />
          <Brands goShop={goShop} products={products} />
          <FeaturedProducts products={products} openProduct={setSelectedProduct} toggleWish={toggleWish} wishlist={wishlist} addToCart={addToCart} goShop={goShop} />
          <About />
          <Testimonials />
          <CTA goShop={goShop} />
        </>
      )}

      {view === "shop" && (
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
          brandFilter={brandFilter}
          setBrandFilter={setBrandFilter}
          tagFilter={tagFilter}
          setTagFilter={setTagFilter}
        />
      )}

      {view === "support" && <SupportPage customer={customer} />}

      {view === "privacy-policy" && <PrivacyPolicy />}

      {view === "checkout" && (
        <Checkout
          cart={cart}
          setView={navigateTo}
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
          setView={navigateTo}
        />
      )}

      <Footer goShop={goShop} setView={navigateTo} scrollToSection={scrollToSection} customer={customer} onAccountOpen={handleAccountIconClick} />

      <ProductDetail product={selectedProduct} onClose={() => setSelectedProduct(null)} addToCart={addToCart} toggleWish={toggleWish} wishlist={wishlist} products={products} openProduct={setSelectedProduct} customer={customer} rateProduct={rateProduct} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} updateQty={updateQty} removeItem={removeItem} setView={navigateTo} customer={customer} />
      <WishlistDrawer open={wishlistOpen} onClose={() => setWishlistOpen(false)} wishlist={wishlist} toggleWish={toggleWish} addToCart={addToCart} openProduct={setSelectedProduct} products={products} />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onAuthSuccess={handleAuthSuccess} />
    </div>
  );
}
