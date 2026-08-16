import { Router } from "express";
import { db } from "../db/index.js";
import { requireAdmin } from "../auth.js";
import { sendReplyEmail } from "../email.js";

const router = Router();

function getReplies(ticketId) {
  return db.prepare("SELECT id, body, email_sent, created_at FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at")
    .all(ticketId)
    .map((r) => ({ id: r.id, body: r.body, emailSent: !!r.email_sent, createdAt: r.created_at }));
}

function rowToTicket(row) {
  return {
    id: row.id,
    customer: row.customer_name,
    email: row.email,
    subject: row.subject,
    message: row.message,
    status: row.status,
    date: row.date,
    replies: getReplies(row.id),
  };
}

// GET /api/tickets
router.get("/", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM tickets ORDER BY date DESC").all();
  res.json(rows.map(rowToTicket));
});

// POST /api/tickets  (used by a real "contact us" form)
router.post("/", (req, res) => {
  const { customer, email, subject, message } = req.body;
  if (!customer || !email || !subject || !message) {
    return res.status(400).json({ error: "customer, email, subject, and message are required" });
  }
  const id = `TCK-${Math.floor(1000 + Math.random() * 9000)}`;
  db.prepare(`
    INSERT INTO tickets (id, customer_name, email, subject, message, status, date)
    VALUES (?, ?, ?, ?, ?, 'open', date('now'))
  `).run(id, customer, email, subject, message);
  const row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
  res.status(201).json(rowToTicket(row));
});

// POST /api/tickets/:id/reply — sends a real email back to the customer
// and logs the reply on the ticket. If email isn't configured yet, the
// reply is still saved (so nothing is lost) but flagged as not sent.
router.post("/:id/reply", requireAdmin, async (req, res) => {
  const { message } = req.body || {};
  if (!message?.trim()) {
    return res.status(400).json({ error: "Reply message is required" });
  }
  const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const result = await sendReplyEmail(ticket.email, ticket.subject, message.trim());

  db.prepare("INSERT INTO ticket_replies (ticket_id, body, email_sent) VALUES (?, ?, ?)")
    .run(ticket.id, message.trim(), result.sent ? 1 : 0);

  const updated = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id);
  res.status(201).json({ ticket: rowToTicket(updated), emailSent: result.sent, emailWarning: result.sent ? null : result.reason });
});

// PATCH /api/tickets/:id/resolve
router.patch("/:id/resolve", requireAdmin, (req, res) => {
  const result = db.prepare("UPDATE tickets SET status = 'resolved' WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Ticket not found" });
  const row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(req.params.id);
  res.json(rowToTicket(row));
});

export default router;
