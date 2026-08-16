import React from "react";
import { DollarSign, ClipboardList, Users, AlertTriangle, Headphones } from "lucide-react";
import { peso } from "../../data/products";

export default function AdminOverview({ products, orders, customers, tickets }) {
  const paidOrders = orders.filter((o) => o.paymentStatus === "paid");
  const revenue = paidOrders.reduce((sum, o) => sum + o.total, 0);
  const pendingOrdersList = orders.filter((o) => o.status === "pending");
  const pendingOrders = pendingOrdersList.length;
  const pendingRevenue = pendingOrdersList.reduce((sum, o) => sum + o.total, 0);
  const lowStock = products.filter((p) => p.stock > 0 && p.stock <= 5);
  const outOfStock = products.filter((p) => p.stock === 0);
  const openTickets = tickets.filter((t) => t.status === "open").length;

  const stats = [
    { label: "Total Revenue", value: peso(revenue), icon: DollarSign, note: `from ${paidOrders.length} paid order${paidOrders.length === 1 ? "" : "s"}` },
    { label: "Pending Orders", value: pendingOrders, icon: ClipboardList, note: `${peso(pendingRevenue)} awaiting approval` },
    { label: "Customers", value: customers.length, icon: Users, note: `${customers.filter(c => c.status === "active").length} active` },
    { label: "Open Tickets", value: openTickets, icon: Headphones, note: "need a response" },
  ];

  return (
    <div>
      <div className="admin-topbar">
        <div>
          <p className="admin-eyebrow">Overview</p>
          <h1>Dashboard</h1>
        </div>
      </div>

      <div className="admin-stat-grid">
        {stats.map((s) => (
          <div className="admin-stat-card" key={s.label}>
            <div className="admin-stat-icon"><s.icon size={18} /></div>
            <div className="admin-stat-value">{s.value}</div>
            <div className="admin-stat-label">{s.label}</div>
            <div className="admin-stat-note">{s.note}</div>
          </div>
        ))}
      </div>

      <div className="admin-panels">
        <div className="admin-panel">
          <h3><AlertTriangle size={16} /> Inventory alerts</h3>
          {lowStock.length === 0 && outOfStock.length === 0 ? (
            <p className="admin-empty">Everything is well stocked.</p>
          ) : (
            <ul className="admin-alert-list">
              {outOfStock.map((p) => (
                <li key={p.id}><span className="admin-dot admin-dot-red" /> {p.name} — out of stock</li>
              ))}
              {lowStock.map((p) => (
                <li key={p.id}><span className="admin-dot admin-dot-amber" /> {p.name} — only {p.stock} left</li>
              ))}
            </ul>
          )}
        </div>

        <div className="admin-panel">
          <h3>Recent orders</h3>
          <ul className="admin-mini-list">
            {orders.slice(0, 5).map((o) => (
              <li key={o.id}>
                <span>{o.customer}</span>
                <span className="admin-mini-sub">{o.id}</span>
                <span>{peso(o.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
