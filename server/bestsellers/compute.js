import { db } from "../db/index.js";
import { runBestsellersMigration } from "./migrate.js";

runBestsellersMigration();

// How many products get flagged as bestsellers.
const TOP_N = Number(process.env.BESTSELLER_COUNT) || 8;

// Only count sales from the last N days. 0 = all-time. A trailing window
// keeps "Best Sellers" reflecting what's popular *now* rather than
// forever favoring your oldest, longest-available products.
const WINDOW_DAYS = Number(process.env.BESTSELLER_WINDOW_DAYS) || 90;

// A product needs at least this many total units sold (within the
// window) to qualify at all — prevents a product with one lucky sale in
// a quiet store from getting labeled a "bestseller".
const MIN_QTY = Number(process.env.BESTSELLER_MIN_QTY) || 3;

// A sale only counts if the order was actually paid and not cancelled.
// Pending/unpaid/failed orders don't reflect real demand yet.
const SALES_QUERY = `
  SELECT oi.product_id AS productId, SUM(oi.qty) AS totalQty
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE o.payment_status = 'paid'
    AND o.status != 'cancelled'
    AND oi.product_id IS NOT NULL
    ${WINDOW_DAYS > 0 ? `AND o.date >= date('now', '-${WINDOW_DAYS} days')` : ""}
  GROUP BY oi.product_id
  HAVING totalQty >= ?
  ORDER BY totalQty DESC
  LIMIT ?
`;

export function computeBestsellers() {
  const top = db.prepare(SALES_QUERY).all(MIN_QTY, TOP_N);

  const clearAll = db.prepare("UPDATE products SET auto_bestseller = 0 WHERE auto_bestseller != 0");
  const setOne = db.prepare("UPDATE products SET auto_bestseller = 1 WHERE id = ?");

  const applyAll = db.transaction((rows) => {
    clearAll.run();
    for (const row of rows) setOne.run(row.productId);
  });
  applyAll(top);

  console.log(
    `[bestsellers] recomputed — ${top.length} product(s) flagged ` +
    `(top ${TOP_N}, min ${MIN_QTY} sold, ${WINDOW_DAYS > 0 ? `last ${WINDOW_DAYS} days` : "all-time"}).`
  );
  return top;
}
