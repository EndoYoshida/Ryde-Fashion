import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// node-postgres returns BIGINT (OID 20) as a string by default, to avoid
// silent precision loss above Number.MAX_SAFE_INTEGER. This app's only
// bigint column is expires_at (epoch milliseconds), which is nowhere near
// that range, and the rest of the code compares/adds it as a number
// (Date.now(), etc.) — so parse it back to a plain number.
pg.types.setTypeParser(20, (val) => parseInt(val, 10));

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Set it to your Postgres connection string " +
    "(e.g. from Render's managed Postgres 'Internal Database URL')."
  );
}

// Render (and most managed Postgres providers) require SSL, but present a
// cert chain that Node's default trust store won't recognize unless you set
// NODE_EXTRA_CA_CERTS to their root cert — so we disable verification like
// most Node apps connecting to managed Postgres do. This still encrypts the
// connection; it just doesn't verify the cert chain. Skipped entirely for
// local Postgres (no sslmode needed there).
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// --- better-sqlite3-compatible shim -----------------------------------
// The rest of the codebase was written against better-sqlite3's synchronous
// `db.prepare(sql).get/all/run(...params)` API using SQLite's `?`
// placeholders. Rather than hand-rewrite ~100 call sites' SQL strings and
// placeholder numbering, this shim:
//   - auto-converts `?` placeholders to Postgres's `$1, $2, ...`
//   - returns a promise, so call sites need `await` added (and their
//     enclosing functions marked `async`) but the query strings and
//     argument lists are unchanged
//   - shapes the return value of `run()` as `{ changes, lastInsertRowid }`
//     to match better-sqlite3, PROVIDED the INSERT statement ends with
//     `RETURNING id` (added at the handful of call sites that actually
//     read `.lastInsertRowid`)
function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export const db = {
  prepare(sql) {
    const pgSql = toPgPlaceholders(sql);
    return {
      async get(...params) {
        const { rows } = await pool.query(pgSql, params);
        return rows[0];
      },
      async all(...params) {
        const { rows } = await pool.query(pgSql, params);
        return rows;
      },
      async run(...params) {
        const { rows, rowCount } = await pool.query(pgSql, params);
        return {
          changes: rowCount,
          lastInsertRowid: rows[0] ? rows[0].id : undefined,
        };
      },
    };
  },

  // Runs raw SQL with no params (used for schema setup).
  async exec(sql) {
    await pool.query(sql);
  },

  // better-sqlite3's db.transaction(fn) returns a synchronous wrapper you
  // call to run fn inside a transaction. This returns an async wrapper
  // instead. IMPORTANT difference from better-sqlite3: fn is called with a
  // `tx` argument (a db-shaped object bound to the transaction's own
  // connection) — call sites must use `tx.prepare(...)` inside the
  // transaction body instead of the outer `db.prepare(...)`, or their
  // queries will run on a different pooled connection and won't actually
  // be part of the transaction (no atomicity, nothing to roll back).
  transaction(fn) {
    return async (...args) => {
      const client = await pool.connect();
      const tx = {
        prepare(sql) {
          const pgSql = toPgPlaceholders(sql);
          return {
            async get(...params) {
              const { rows } = await client.query(pgSql, params);
              return rows[0];
            },
            async all(...params) {
              const { rows } = await client.query(pgSql, params);
              return rows;
            },
            async run(...params) {
              const { rows, rowCount } = await client.query(pgSql, params);
              return { changes: rowCount, lastInsertRowid: rows[0] ? rows[0].id : undefined };
            },
          };
        },
      };
      try {
        await client.query("BEGIN");
        const result = await fn(tx, ...args);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    };
  },
};

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
await db.exec(schema);

console.log("Connected to Postgres and ensured schema is up to date.");
