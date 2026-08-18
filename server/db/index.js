import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "ryde.sqlite");

const isNewDb = !fs.existsSync(DB_PATH);

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

// Safe migrations for databases created before a given column existed.
// SQLite errors if the column is already there — that's expected and ignored.
function addColumnIfMissing(table, column, type) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err) {
    if (!String(err.message).includes("duplicate column")) throw err;
  }
}
addColumnIfMissing("customers", "password_hash", "TEXT");
addColumnIfMissing("customers", "address", "TEXT");
addColumnIfMissing("customers", "username", "TEXT");
addColumnIfMissing("tickets", "message_id", "TEXT");
addColumnIfMissing("orders", "proof_image", "TEXT");
addColumnIfMissing("products", "description", "TEXT");
addColumnIfMissing("customers", "email_verified", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("customers", "verification_code", "TEXT");
addColumnIfMissing("customers", "verification_code_expires_at", "TEXT");

if (isNewDb) {
  console.log("New database created at", DB_PATH, "— starting empty (no demo data).");
}
