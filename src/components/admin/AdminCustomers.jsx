import React, { useState } from "react";
import { peso } from "../../data/products";

const STATUS_BADGE = {
  active: "badge-ok",
  suspended: "badge-soon",
  deleted: "badge-off",
};

export default function AdminCustomers({ customers, toggleCustomerStatus, deleteCustomer, restoreCustomer }) {
  const [confirmingId, setConfirmingId] = useState(null);

  const handleDelete = (id) => {
    if (confirmingId !== id) {
      setConfirmingId(id);
      return;
    }
    deleteCustomer(id);
    setConfirmingId(null);
  };

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
            {customers.map((c) => {
              const isDeleted = c.status === "deleted";
              return (
                <tr key={c.id}>
                  <td className="admin-table-name" data-label="Name">{c.name}</td>
                  <td data-label="Email">{c.email}</td>
                  <td data-label="Phone">{c.phone}</td>
                  <td data-label="Joined">{c.joined}</td>
                  <td data-label="Orders">{c.orders}</td>
                  <td data-label="Total spent">{peso(c.totalSpent)}</td>
                  <td data-label="Status">
                    <span className={`status-badge inline ${STATUS_BADGE[c.status] || "badge-off"}`}>
                      {c.status}
                    </span>
                  </td>
                  <td data-label="">
                    {isDeleted ? (
                      <button className="admin-link-btn" onClick={() => restoreCustomer(c.id)}>
                        Restore
                      </button>
                    ) : (
                      <>
                        <button className="admin-link-btn" onClick={() => toggleCustomerStatus(c.id)}>
                          {c.status === "active" ? "Suspend" : "Activate"}
                        </button>
                        <button
                          className="admin-link-btn danger"
                          onClick={() => handleDelete(c.id)}
                          onBlur={() => setConfirmingId((cur) => (cur === c.id ? null : cur))}
                        >
                          {confirmingId === c.id ? "Confirm delete?" : "Delete"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
