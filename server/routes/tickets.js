import { Router } from "express";
import { randomInt } from "crypto";
import { db } from "../db/index.js";
import { requireAdmin } from "../auth.js";
import { sendReplyEmail, sendNewTicketNotificationEmail } from "../email.js";
import { publicWriteLimiter } from "../rateLimit.js";
import { asyncHandler } from "../asyncHandler.js";

const router = Router();

async function getReplies(ticketId) {
  const rows = await db.prepare("SELECT id, body, email_sent, created_at FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at")
    .all(ticketId);
  return rows.map((r) => ({ id: r.id, body: r.body, emailSent: !!r.email_sent, createdAt: r.created_at }));
}

async function rowToTicket(row) {
  return {
    id: row.id,
    customer: row.customer_name,
    email: row.email,
    subject: row.subject,
    message: row.message,
    status: row.status,
    date: row.date,
    replies: await getReplies(row.id),
  };
}

// GET /api/tickets
router.get("/", requireAdmin, asyncHandler(async (req, res) => {
  const rows = await db.prepare("SELECT * FROM tickets ORDER BY date DESC").all();
  res.json(await Promise.all(rows.map(rowToTicket)));
}));

// POST /api/tickets  (used by a real "contact us" form)
router.post("/", publicWriteLimiter, asyncHandler(async (req, res) => {
  const { customer, email, subject, message } = req.body;
  if (!customer?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
    return res.status(400).json({ error: "customer, email, subject, and message are required" });
  }
  if (!email.includes("@") || email.length > 200) {
    return res.status(400).json({ error: "A valid email is required" });
  }
  if (customer.length > 200 || subject.length > 300) {
    return res.status(400).json({ error: "Name or subject is too long" });
  }
  if (message.length > 5000) {
    return res.status(400).json({ error: "Message is too long (5000 character max)" });
  }
  // Math.random() over 9,000 values was brute-forceable; randomInt over
  // 9,000,000 values with a CSPRNG isn't (these aren't currently exposed
  // to an unauthenticated lookup route, but there's no reason for the id
  // itself to be guessable).
  const id = `TCK-${randomInt(1000000, 9999999)}`;
  await db.prepare(`
    INSERT INTO tickets (id, customer_name, email, subject, message, status, date)
    VALUES (?, ?, ?, ?, ?, 'open', to_char(now(), 'YYYY-MM-DD'))
  `).run(id, customer.trim(), email.trim().toLowerCase(), subject.trim(), message.trim());
  const row = await db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
  const ticket = await rowToTicket(row);

  // Best-effort notification to the store's own inbox — a customer's
  // ticket is already saved at this point regardless of whether this
  // succeeds, so a failure here shouldn't fail their submission.
  sendNewTicketNotificationEmail(ticket).catch((err) => {
    console.error("Failed to send new-ticket notification:", err.message);
  });

  res.status(201).json(ticket);
}));

// POST /api/tickets/:id/reply — sends a real email back to the customer
// and logs the reply on the ticket. If email isn't configured yet, the
// reply is still saved (so nothing is lost) but flagged as not sent.
router.post("/:id/reply", requireAdmin, asyncHandler(async (req, res) => {
  const { message } = req.body || {};
  if (!message?.trim()) {
    return res.status(400).json({ error: "Reply message is required" });
  }
  const ticket = await db.prepare("SELECT * FROM tickets WHERE id = ?").get(req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const result = await sendReplyEmail(ticket.email, ticket.subject, message.trim());

  await db.prepare("INSERT INTO ticket_replies (ticket_id, body, email_sent) VALUES (?, ?, ?)")
    .run(ticket.id, message.trim(), result.sent ? 1 : 0);

  const updated = await db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id);
  res.status(201).json({ ticket: await rowToTicket(updated), emailSent: result.sent, emailWarning: result.sent ? null : result.reason });
}));

// PATCH /api/tickets/:id/resolve
router.patch("/:id/resolve", requireAdmin, asyncHandler(async (req, res) => {
  const result = await db.prepare("UPDATE tickets SET status = 'resolved' WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Ticket not found" });
  const row = await db.prepare("SELECT * FROM tickets WHERE id = ?").get(req.params.id);
  res.json(await rowToTicket(row));
}));

export default router;
