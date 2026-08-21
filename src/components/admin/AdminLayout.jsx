import React, { useState } from "react";
import { LayoutDashboard, Package, ClipboardList, Users, Headphones, LogOut, Menu, X } from "lucide-react";
import logo from "../../assets/logo.jpg";
import AdminOverview from "./AdminOverview";
import AdminProducts from "./AdminProducts";
import AdminOrders from "./AdminOrders";
import AdminCustomers from "./AdminCustomers";
import AdminSupport from "./AdminSupport";

export default function AdminLayout({
  onLeaveAdmin,
  products, addProduct, updateProduct, deleteProduct,
  uploadImages, deleteImage,
  orders, updateOrderStatus, updatePaymentStatus,
  customers, toggleCustomerStatus, deleteCustomer, restoreCustomer,
  tickets, resolveTicket, refreshTicket,
}) {
  const [tab, setTab] = useState("overview");
  // Only used at mobile widths — the sidebar itself stays a plain always-
  // visible column on desktop (see .admin-hamburger's display:none there).
  const [navOpen, setNavOpen] = useState(false);

  const nav = [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
    { id: "products", label: "Products", icon: Package },
    { id: "orders", label: "Orders", icon: ClipboardList },
    { id: "customers", label: "Customers", icon: Users },
    { id: "support", label: "Support", icon: Headphones },
  ];

  // Picking a section closes the mobile dropdown too, so it doesn't sit
  // open over the newly-selected page.
  const selectTab = (id) => {
    setTab(id);
    setNavOpen(false);
  };

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <button
            type="button"
            className="admin-brand-link"
            onClick={() => selectTab("overview")}
            aria-label="Go to dashboard"
          >
            <img src={logo} alt="Ryde Fashion logo" className="logo-img" />
            <div className="admin-brand-text">
              <div className="admin-brand-name">RYDE</div>
              <div className="admin-brand-sub">Admin</div>
            </div>
          </button>
          <button
            type="button"
            className="admin-hamburger"
            onClick={() => setNavOpen((o) => !o)}
            aria-label={navOpen ? "Close menu" : "Open menu"}
            aria-expanded={navOpen}
          >
            {navOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {navOpen && <div className="admin-nav-backdrop" onClick={() => setNavOpen(false)} />}

        <div className={`admin-nav-wrap ${navOpen ? "open" : ""}`}>
          <nav className="admin-nav">
            {nav.map((n) => (
              <button key={n.id} className={`admin-nav-item ${tab === n.id ? "active" : ""}`} onClick={() => selectTab(n.id)}>
                <n.icon size={17} strokeWidth={1.75} />
                {n.label}
              </button>
            ))}
          </nav>
          <button className="admin-nav-item admin-logout" onClick={onLeaveAdmin}>
            <LogOut size={17} strokeWidth={1.75} />
            Log out &amp; return to store
          </button>
        </div>
      </aside>

      <main className="admin-main">
        {tab === "overview" && <AdminOverview products={products} orders={orders} customers={customers} tickets={tickets} />}
        {tab === "products" && (
          <AdminProducts
            products={products} addProduct={addProduct} updateProduct={updateProduct} deleteProduct={deleteProduct}
            uploadImages={uploadImages} deleteImage={deleteImage}
          />
        )}
        {tab === "orders" && (
          <AdminOrders orders={orders} updateOrderStatus={updateOrderStatus} updatePaymentStatus={updatePaymentStatus} />
        )}
        {tab === "customers" && (
          <AdminCustomers
            customers={customers}
            toggleCustomerStatus={toggleCustomerStatus}
            deleteCustomer={deleteCustomer}
            restoreCustomer={restoreCustomer}
          />
        )}
        {tab === "support" && <AdminSupport tickets={tickets} resolveTicket={resolveTicket} refreshTicket={refreshTicket} />}
      </main>
    </div>
  );
}
