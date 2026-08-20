// Wipes personal/transactional data from ryde.sqlite before deploying,
// while keeping your product catalog and schema intact.
//
// Usage (from the server/ folder): node clean-db.js
//
// What this clears: customers, orders + order items, tickets + replies,
// wishlists, sessions, newsletter subscribers, and product ratings (since
// ratings are tied to the customers being deleted).
// What this KEEPS: products, product_images.
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "db", "ryde.sqlite"));

const tables = [
  "ticket_replies",
  "tickets",
  "order_items",
  "orders",
  "wishlist_items",
  "product_ratings",
  "customer_sessions",
  "admin_sessions",
  "newsletter_subscribers",
  "customers",
];

const wipe = db.transaction(() => {
  for (const table of tables) {
    const { changes } = db.prepare(`DELETE FROM ${table}`).run();
    console.log(`Cleared ${table}: ${changes} row(s) removed`);
  }
  // Reset auto-increment counters so new rows start from 1 again.
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN (" + tables.map(() => "?").join(",") + ")")
    .run(...tables);
});

wipe();
db.exec("VACUUM"); // reclaim disk space and shrink the file

console.log("\nDone. Products were left untouched. Recompute ratings display is fine since product_ratings is empty (rating/reviews columns on products still show old totals — run bestsellers/compute if you also want those reset).");
