export const SERVER_ORIGIN = "http://localhost:4000";
const API_BASE = `${SERVER_ORIGIN}/api`;

// Two completely separate auth contexts — an admin session token and a
// customer session token never share a slot, so a logged-in admin
// browsing in another tab can't accidentally act as a customer or vice
// versa, and each has its own "you got logged out" handler.
let adminToken = null;
let customerToken = null;
let onAdminUnauthorized = null;
let onCustomerUnauthorized = null;

export function setAdminToken(token) { adminToken = token; }
export function setCustomerToken(token) { customerToken = token; }
export function setAdminUnauthorizedHandler(fn) { onAdminUnauthorized = fn; }
export function setCustomerUnauthorizedHandler(fn) { onCustomerUnauthorized = fn; }

async function request(path, options = {}, auth = null) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = auth === "admin" ? adminToken : auth === "customer" ? customerToken : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    if (auth === "admin") { adminToken = null; onAdminUnauthorized?.(); }
    if (auth === "customer") { customerToken = null; onCustomerUnauthorized?.(); }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    Object.assign(err, body); // carries extra flags like `notRegistered` to the caller
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ------------------------------- Admin auth ------------------------------ */
export const loginAdmin = (username, password) =>
  request("/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
export const logoutAdmin = () => request("/admin/logout", { method: "POST" }, "admin").catch(() => {});

/* ------------------------------ Customer auth ----------------------------- */
export const signupCustomer = (name, username, email, password, phone) =>
  request("/auth/signup", { method: "POST", body: JSON.stringify({ name, username, email, password, phone }) });
export const loginCustomer = (identifier, password) =>
  request("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) });
export const googleLogin = (credential) =>
  request("/auth/google", { method: "POST", body: JSON.stringify({ credential }) });
export const logoutCustomer = () => request("/auth/logout", { method: "POST" }, "customer").catch(() => {});
export const getMe = () => request("/auth/me", {}, "customer");
export const updateMe = (changes) =>
  request("/auth/me", { method: "PATCH", body: JSON.stringify(changes) }, "customer");
export const changeMyPassword = (currentPassword, newPassword) =>
  request("/auth/me/password", { method: "PATCH", body: JSON.stringify({ currentPassword, newPassword }) }, "customer");
export const getMyOrders = () => request("/auth/me/orders", {}, "customer");
export const getMyTickets = () => request("/auth/me/tickets", {}, "customer");
export const verifyEmail = (code) =>
  request("/auth/verify-email", { method: "POST", body: JSON.stringify({ code }) }, "customer");
export const resendVerification = () =>
  request("/auth/resend-verification", { method: "POST" }, "customer");
export const requestAccountDeletion = () =>
  request("/auth/delete-account/request", { method: "POST" }, "customer");
export const deleteAccount = (password, code) =>
  request("/auth/me", { method: "DELETE", body: JSON.stringify({ password, code }) }, "customer");

/* -------------------------------- Products -------------------------------- */
export const getProducts = () => request("/products");
export const createProduct = (product) =>
  request("/products", { method: "POST", body: JSON.stringify(product) }, "admin");
export const updateProductApi = (id, changes) =>
  request(`/products/${id}`, { method: "PUT", body: JSON.stringify(changes) }, "admin");
export const deleteProductApi = (id) =>
  request(`/products/${id}`, { method: "DELETE" }, "admin");

// Product images (multipart uploads bypass the JSON `request` helper)
export async function uploadProductImages(id, files) {
  const formData = new FormData();
  for (const file of files) formData.append("images", file);
  const headers = {};
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  const res = await fetch(`${API_BASE}/products/${id}/images`, { method: "POST", body: formData, headers });
  if (res.status === 401) { adminToken = null; onAdminUnauthorized?.(); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Upload failed: ${res.status}`);
  }
  return res.json(); // { images: [{ id, url }] }
}
export const deleteProductImage = (productId, imageId) =>
  request(`/products/${productId}/images/${imageId}`, { method: "DELETE" }, "admin");
export const rateProduct = (productId, rating) =>
  request(`/products/${productId}/rate`, { method: "POST", body: JSON.stringify({ rating }) }, "customer");
export const getMyRating = (productId) =>
  request(`/products/${productId}/my-rating`, {}, "customer");

/* --------------------------------- Orders --------------------------------- */
export const getOrders = () => request("/orders", {}, "admin");
export const createOrder = (order) => request("/orders", { method: "POST", body: JSON.stringify(order) });
export async function uploadPaymentProof(orderId, file) {
  const formData = new FormData();
  formData.append("proof", file);
  const res = await fetch(`${API_BASE}/orders/${orderId}/proof`, { method: "POST", body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}
export const updateOrderStatusApi = (id, status) =>
  request(`/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, "admin");
export const updatePaymentStatusApi = (id, paymentStatus) =>
  request(`/orders/${id}/payment-status`, { method: "PATCH", body: JSON.stringify({ paymentStatus }) }, "admin");

/* -------------------------------- Customers (admin view) ------------------ */
export const getCustomers = () => request("/customers", {}, "admin");
export const toggleCustomerStatusApi = (id, status) =>
  request(`/customers/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, "admin");

/* --------------------------------- Tickets -------------------------------- */
export const getTickets = () => request("/tickets", {}, "admin");
export const createTicket = (ticket) => request("/tickets", { method: "POST", body: JSON.stringify(ticket) });
export const resolveTicketApi = (id) =>
  request(`/tickets/${id}/resolve`, { method: "PATCH" }, "admin");
export const replyToTicketApi = (id, message) =>
  request(`/tickets/${id}/reply`, { method: "POST", body: JSON.stringify({ message }) }, "admin");
