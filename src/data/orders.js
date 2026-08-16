// Order status options used by the admin dashboard's dropdowns.
// Actual order data now lives in the database (see /server) and is
// fetched through src/api.js — nothing here holds real data anymore.
export const ORDER_STATUS_OPTIONS = ["pending", "approved", "shipped", "delivered", "cancelled"];
export const PAYMENT_STATUS_OPTIONS = ["pending", "paid", "failed"];
