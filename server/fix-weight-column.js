// One-off fix: adds the `weight` column to an existing products table that
// was created before `weight` was added to db/schema.sql. Safe to run more
// than once — it checks first and does nothing if the column already exists.
// Usage (from the server/ folder): node fix-weight-column.js
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "db", "ryde.sqlite"));

const cols = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);

if (cols.includes("weight")) {
  console.log("products.weight already exists — nothing to do.");
} else {
  db.exec("ALTER TABLE products ADD COLUMN weight REAL NOT NULL DEFAULT 0.3");
  console.log("Added products.weight (default 0.3) successfully.");
}

db.close();
