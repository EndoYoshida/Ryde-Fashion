import { peso } from "../data/products";

// Builds a standalone, printable "Purchase Order" document for one
// order and opens it in a new tab, ready for the browser's Print
// dialog ("Save as PDF" gives a downloadable file with no extra
// dependencies needed). Mirrors the layout of the store's original
// spreadsheet-based PO template, trimmed to only the fields this
// storefront actually captures — no Facebook/IG, city/province split,
// landmark, order type, or tracking number, since none of that is
// collected at checkout.
export function openPurchaseOrder(order) {
  const win = window.open("", "_blank");
  if (!win) return; // popup blocked — nothing more we can do here

  win.document.write(buildPOHtml(order));
  win.document.close();
  // Give the new tab a moment to lay out/render before invoking print,
  // otherwise some browsers open the print dialog against a blank page.
  win.onload = () => win.print();
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function buildPOHtml(order) {
  const itemRows = order.items.map((it) => `
    <tr>
      <td>${escapeHtml(it.name)}</td>
      <td class="num">${it.qty}</td>
      <td class="num">${peso(it.price)}</td>
      <td class="num">${peso(it.price * it.qty)}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Purchase Order ${escapeHtml(order.id)}</title>
<style>
  :root {
    --blush:#F7D6E0; --rose:#E3A9BE; --gold:#C9A15F; --gold-light:#E8D4A8;
    --ivory:#FFFBF7; --cream:#FBF3EC; --beige:#EFE2D5; --ink:#3A2B28; --ink-soft:#6B5A55;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Jost', Arial, sans-serif; color: var(--ink); background: var(--ivory);
    margin: 0; padding: 32px;
  }
  .po-sheet { max-width: 820px; margin: 0 auto; border: 1px solid var(--beige); border-radius: 10px; overflow: hidden; }
  .po-header {
    background: linear-gradient(180deg, var(--blush) 0%, var(--cream) 100%);
    text-align: center; padding: 22px 24px 16px;
  }
  .po-header h1 {
    font-family: Georgia, 'Cormorant Garamond', serif; color: var(--rose);
    letter-spacing: 4px; font-size: 30px; margin: 0;
  }
  .po-header .sub { color: var(--gold); font-size: 11.5px; letter-spacing: 1.5px; margin: 4px 0 0; text-transform: uppercase; }
  .po-banner {
    background: var(--rose); color: #fff; text-align: center; font-size: 14px;
    letter-spacing: 3px; padding: 9px; font-weight: 600; text-transform: uppercase;
  }
  .po-section-label {
    background: var(--gold); color: #fff; font-size: 11.5px; letter-spacing: 1.5px;
    text-transform: uppercase; padding: 7px 16px; font-weight: 600;
  }
  .po-grid { display: grid; grid-template-columns: 1fr 1fr; }
  .po-grid.info { border-bottom: 1px solid var(--beige); }
  .po-field { padding: 10px 16px; border-bottom: 1px solid var(--beige); font-size: 13px; }
  .po-field .label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--ink-soft); margin-bottom: 3px; }
  .po-field .value { font-weight: 500; }
  table.po-items { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.po-items th {
    background: var(--gold-light); text-align: left; padding: 9px 16px; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.5px; color: var(--ink);
  }
  table.po-items td { padding: 9px 16px; border-bottom: 1px solid var(--beige); }
  table.po-items td.num, table.po-items th.num { text-align: right; }
  .po-total-row td { font-weight: 700; border-top: 2px solid var(--gold); font-size: 14px; }
  .po-footer { padding: 16px 24px 24px; font-size: 11px; color: var(--ink-soft); text-align: center; }
  @media print {
    body { padding: 0; background: #fff; }
    .po-sheet { border: none; border-radius: 0; max-width: none; }
  }
</style>
</head>
<body>
  <div class="po-sheet">
    <div class="po-header">
      <h1>RYDE</h1>
      <p class="sub">Authentic Bags, Apparel, Perfumes &amp; More</p>
    </div>
    <div class="po-banner">Purchase Order</div>

    <div class="po-grid info">
      <div class="po-field"><div class="label">PO Number</div><div class="value">${escapeHtml(order.id)}</div></div>
      <div class="po-field"><div class="label">Order Date</div><div class="value">${escapeHtml(order.date)}</div></div>
      <div class="po-field"><div class="label">Order Status</div><div class="value" style="text-transform:capitalize">${escapeHtml(order.status)}</div></div>
      <div class="po-field"><div class="label">Payment Status</div><div class="value" style="text-transform:capitalize">${escapeHtml(order.paymentStatus)}</div></div>
      <div class="po-field"><div class="label">Mode of Payment</div><div class="value">${escapeHtml(order.paymentMethod || "\u2014")}</div></div>
      <div class="po-field"><div class="label">Total</div><div class="value">${peso(order.total)}</div></div>
    </div>

    <div class="po-section-label">Customer Information</div>
    <div class="po-grid">
      <div class="po-field"><div class="label">Customer Name</div><div class="value">${escapeHtml(order.customer)}</div></div>
      <div class="po-field"><div class="label">Contact Number</div><div class="value">${escapeHtml(order.phone || "\u2014")}</div></div>
      <div class="po-field"><div class="label">Email Address</div><div class="value">${escapeHtml(order.email)}</div></div>
      <div class="po-field" style="grid-column: 1 / -1;"><div class="label">Complete Address</div><div class="value">${escapeHtml(order.address || "\u2014")}</div></div>
    </div>

    <div class="po-section-label">Order Details</div>
    <table class="po-items">
      <thead>
        <tr>
          <th>Item / Product Description</th>
          <th class="num">Qty</th>
          <th class="num">Unit Price</th>
          <th class="num">Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr class="po-total-row">
          <td colspan="3">Total</td>
          <td class="num">${peso(order.total)}</td>
        </tr>
      </tbody>
    </table>

    <div class="po-footer">Generated from Ryde Fashion admin dashboard &middot; ${escapeHtml(order.id)}</div>
  </div>
</body>
</html>`;
}
