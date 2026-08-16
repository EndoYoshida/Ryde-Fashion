import React from "react";
import { peso } from "../../data/products";

export default function AdminCustomers({ customers, toggleCustomerStatus }) {
  return (
    <div>
      <div className="admin-topbar">
        <div>
          <p className="admin-eyebrow">People</p>
          <h1>Customers</h1>
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Joined</th>
              <th>Orders</th>
              <th>Total spent</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td className="admin-table-name">{c.name}</td>
                <td>{c.email}</td>
                <td>{c.phone}</td>
                <td>{c.joined}</td>
                <td>{c.orders}</td>
                <td>{peso(c.totalSpent)}</td>
                <td>
                  <span className={`status-badge inline ${c.status === "active" ? "badge-ok" : "badge-off"}`}>
                    {c.status}
                  </span>
                </td>
                <td>
                  <button className="admin-link-btn" onClick={() => toggleCustomerStatus(c.id)}>
                    {c.status === "active" ? "Suspend" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
