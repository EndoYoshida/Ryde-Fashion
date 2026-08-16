import React, { useState } from "react";
import { peso } from "../../data/products";
import { ORDER_STATUS_OPTIONS, PAYMENT_STATUS_OPTIONS } from "../../data/orders";
import { SERVER_ORIGIN } from "../../api";

const STATUS_CLASS = {
  pending: "badge-soon", approved: "badge-ok", shipped: "badge-ok",
  delivered: "badge-ok", cancelled: "badge-off",
  paid: "badge-ok", failed: "badge-off",
};

export default function AdminOrders({ orders, updateOrderStatus, updatePaymentStatus }) {
  const [expanded, setExpanded] = useState(null);

  return (
    <div>
      <div className="admin-topbar">
        <div>
          <p className="admin-eyebrow">Purchase orders</p>
          <h1>Orders</h1>
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <React.Fragment key={o.id}>
                <tr>
                  <td className="admin-table-name">{o.id}</td>
                  <td>{o.customer}</td>
                  <td>{o.date}</td>
                  <td>{peso(o.total)}</td>
                  <td>
                    <select
                      className={`admin-status-select ${STATUS_CLASS[o.paymentStatus]}`}
                      value={o.paymentStatus}
                      onChange={(e) => updatePaymentStatus(o.id, e.target.value)}
                    >
                      {PAYMENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      className={`admin-status-select ${STATUS_CLASS[o.status]}`}
                      value={o.status}
                      onChange={(e) => updateOrderStatus(o.id, e.target.value)}
                    >
                      {ORDER_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <button className="admin-link-btn" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                      {expanded === o.id ? "Hide" : "View"}
                    </button>
                  </td>
                </tr>
                {expanded === o.id && (
                  <tr className="admin-expand-row">
                    <td colSpan={7}>
                      <div className="admin-order-detail">
                        <div>
                          <strong>Items</strong>
                          <ul>
                            {o.items.map((it, i) => (
                              <li key={i}>{it.name} &times; {it.qty} — {peso(it.price * it.qty)}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <strong>Shipping</strong>
                          <p>{o.address}</p>
                          <strong>Payment method</strong>
                          <p>{o.paymentMethod}</p>
                          <strong>Email</strong>
                          <p>{o.email}</p>
                          {o.proofImage && (
                            <>
                              <strong>Payment proof</strong>
                              <a href={`${SERVER_ORIGIN}${o.proofImage}`} target="_blank" rel="noopener noreferrer">
                                <img src={`${SERVER_ORIGIN}${o.proofImage}`} alt="Payment proof" className="admin-proof-thumb" />
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
