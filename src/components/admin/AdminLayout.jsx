import React, { useState } from "react";
import { LayoutDashboard, Package, ClipboardList, Users, Headphones, LogOut } from "lucide-react";
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
  customers, toggleCustomerStatus,
  tickets, resolveTicket, refreshTicket,
}) {
  const [tab, setTab] = useState("overview");

  const nav = [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
    { id: "products", label: "Products", icon: Package },
    { id: "orders", label: "Orders", icon: ClipboardList },
    { id: "customers", label: "Customers", icon: Users },
    { id: "support", label: "Support", icon: Headphones },
  ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <img src={logo} alt="Ryde Fashion logo" className="logo-img" />
          <div>
            <div className="admin-brand-name">RYDE</div>
            <div className="admin-brand-sub">Admin</div>
          </div>
        </div>
        <nav className="admin-nav">
          {nav.map((n) => (
            <button key={n.id} className={`admin-nav-item ${tab === n.id ? "active" : ""}`} onClick={() => setTab(n.id)}>
              <n.icon size={17} strokeWidth={1.75} />
              {n.label}
            </button>
          ))}
        </nav>
        <button className="admin-nav-item admin-logout" onClick={onLeaveAdmin}>
          <LogOut size={17} strokeWidth={1.75} />
          Log out &amp; return to store
        </button>
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
        {tab === "customers" && <AdminCustomers customers={customers} toggleCustomerStatus={toggleCustomerStatus} />}
        {tab === "support" && <AdminSupport tickets={tickets} resolveTicket={resolveTicket} refreshTicket={refreshTicket} />}
      </main>
    </div>
  );
}
