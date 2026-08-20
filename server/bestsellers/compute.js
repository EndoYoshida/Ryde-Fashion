import { db } from "../db/index.js";

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

// o.date is stored as a 'YYYY-MM-DD' TEXT column, so a plain string
// comparison against another 'YYYY-MM-DD' string sorts correctly — no
// need to cast either side to a real date type.
const SALES_QUERY = `
  SELECT oi.product_id AS "productId", SUM(oi.qty) AS "totalQty"
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE o.payment_status = 'paid'
    AND o.status != 'cancelled'
    AND oi.product_id IS NOT NULL
    ${WINDOW_DAYS > 0 ? `AND o.date >= to_char(now() - interval '${WINDOW_DAYS} days', 'YYYY-MM-DD')` : ""}
  GROUP BY oi.product_id
  HAVING SUM(oi.qty) >= ?
  ORDER BY "totalQty" DESC
  LIMIT ?
`;

export async function computeBestsellers() {
  const top = await db.prepare(SALES_QUERY).all(MIN_QTY, TOP_N);

  const applyAll = db.transaction(async (tx, rows) => {
    await tx.prepare("UPDATE products SET auto_bestseller = 0 WHERE auto_bestseller != 0").run();
    for (const row of rows) {
      await tx.prepare("UPDATE products SET auto_bestseller = 1 WHERE id = ?").run(row.productId);
    }
  });
  await applyAll(top);

  console.log(
    `[bestsellers] recomputed — ${top.length} product(s) flagged ` +
    `(top ${TOP_N}, min ${MIN_QTY} sold, ${WINDOW_DAYS > 0 ? `last ${WINDOW_DAYS} days` : "all-time"}).`
  );
  return top;
}
