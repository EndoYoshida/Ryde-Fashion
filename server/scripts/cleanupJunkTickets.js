// One-off cleanup for tickets created by the OLD version of pollInbox(),
// which turned every unseen email in the support inbox into a ticket —
// not just messages from customers. This deletes exactly the tickets the
// new, filtered pollInbox() would never have created in the first place.
//
// Safe by design:
//   - Contact-form tickets are NEVER touched (they have no message_id,
//     since they're inserted directly by POST /api/tickets, not by
//     polling — see server/routes/tickets.js).
//   - Polled tickets from a REGISTERED customer are NEVER touched.
//   - Only polled tickets from a non-customer sender (Google alerts,
//     Lazada, newsletters, etc.) are deleted.
//   - ticket_replies for those tickets cascade-delete automatically
//     (see ON DELETE CASCADE in schema.sql).
//
// Usage (run from the server/ folder):
//   node scripts/cleanupJunkTickets.js            -> dry run, lists what would be deleted
//   node scripts/cleanupJunkTickets.js --delete    -> actually deletes them

import { db } from "../db/index.js";

const shouldDelete = process.argv.includes("--delete");

const junkTickets = await db.prepare(`
  SELECT t.id, t.customer_name, t.email, t.subject, t.date
  FROM tickets t
  WHERE t.message_id IS NOT NULL
    AND t.email NOT IN (SELECT email FROM customers)
  ORDER BY t.date DESC
`).all();

if (junkTickets.length === 0) {
  console.log("No junk tickets found — nothing to clean up.");
  process.exit(0);
}

console.log(`Found ${junkTickets.length} junk ticket(s):\n`);
for (const t of junkTickets) {
  console.log(`  ${t.id}  ${t.date}  "${t.subject}"  ${t.customer_name} <${t.email}>`);
}

if (!shouldDelete) {
  console.log(`\nThis was a dry run — nothing was deleted.`);
  console.log(`Re-run with --delete to actually remove these ${junkTickets.length} ticket(s):`);
  console.log(`  node scripts/cleanupJunkTickets.js --delete`);
} else {
  const ids = junkTickets.map((t) => t.id);
  const placeholders = ids.map(() => "?").join(",");
  const result = await db.prepare(`DELETE FROM tickets WHERE id IN (${placeholders})`).run(...ids);
  console.log(`\nDeleted ${result.changes} junk ticket(s).`);
}
