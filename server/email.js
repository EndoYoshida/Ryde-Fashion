import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { db } from "./db/index.js";

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD;
const IMAP_HOST = process.env.IMAP_HOST || "imap.gmail.com";
const IMAP_PORT = Number(process.env.IMAP_PORT || 993);

export function isEmailConfigured() {
  return Boolean(EMAIL_USER && EMAIL_APP_PASSWORD);
}

let transporter = null;
function getTransporter() {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

// Generic sender — everything else in this file builds on this.
// Returns { sent, reason } rather than throwing, so callers can decide
// how to degrade gracefully when email isn't configured or fails.
async function sendEmail({ to, subject, text }) {
  const t = getTransporter();
  if (!t) return { sent: false, reason: "Email isn't configured yet (see server/.env)." };
  try {
    await t.sendMail({ from: `"Ryde Fashion" <${EMAIL_USER}>`, to, subject, text });
    return { sent: true };
  } catch (err) {
    console.error("Failed to send email:", err.message);
    return { sent: false, reason: err.message };
  }
}

// Sends a reply email from the store's inbox to a customer. Returns
// true/false rather than throwing, so a reply can still be saved in the
// dashboard even if the email itself fails to send (e.g. not configured).
export async function sendReplyEmail(to, subject, body) {
  return sendEmail({
    to,
    subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
    text: body,
  });
}

// Sends a 6-digit email verification code after signup.
export async function sendVerificationEmail(to, code) {
  return sendEmail({
    to,
    subject: "Verify your email — Ryde Fashion",
    text: `Welcome to Ryde Fashion!\n\nYour verification code is: ${code}\n\nEnter this code in your account page to verify your email. This code expires in 30 minutes — you can request a new one anytime if it runs out.\n\nIf you didn't create this account, you can ignore this email.`,
  });
}

// Sends a confirmation code before permanently deleting an account.
export async function sendDeletionConfirmationEmail(to, code) {
  return sendEmail({
    to,
    subject: "Confirm account deletion — Ryde Fashion",
    text: `We received a request to permanently delete your Ryde Fashion account.\n\nYour confirmation code is: ${code}\n\nEnter this code to confirm. This code expires in 30 minutes.\n\nIf you didn't request this, ignore this email and your account will remain exactly as it is — nothing happens without the code.`,
  });
}

// Sends an order receipt right after checkout.
export async function sendOrderReceiptEmail(order) {
  const lines = order.items.map((it) => `  - ${it.name} x${it.qty} — \u20b1${(it.price * it.qty).toLocaleString()}`).join("\n");
  const text = [
    `Thank you for your order, ${order.customer}!`,
    "",
    `Order #: ${order.id}`,
    `Payment method: ${order.paymentMethod}`,
    "",
    "Items:",
    lines,
    "",
    `Total: \u20b1${order.total.toLocaleString()}`,
    "",
    `Shipping to: ${order.address}`,
    "",
    "We'll update you as your order is processed. You can also check its status anytime from your account's Order History.",
    "",
    "— Ryde Fashion & Authentic Bags and Apparel",
  ].join("\n");

  return sendEmail({ to: order.email, subject: `Your Ryde Fashion order #${order.id}`, text });
}

function makeTicketId() {
  return `TCK-${Date.now().toString(36).toUpperCase().slice(-6)}${Math.floor(Math.random() * 100)}`;
}

// Checks the inbox for new mail and turns each new message into a
// support ticket (skips anything already imported, tracked by the
// email's Message-ID header so re-polling never creates duplicates).
export async function pollInbox() {
  if (!isEmailConfigured()) return;

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ seen: false });
      for (const uid of uids || []) {
        const message = await client.fetchOne(uid, { source: true });
        if (!message?.source) continue;

        const parsed = await simpleParser(message.source);
        const messageId = parsed.messageId || `${uid}-${Date.now()}`;

        const existing = db.prepare("SELECT id FROM tickets WHERE message_id = ?").get(messageId);
        if (!existing) {
          const fromEmail = parsed.from?.value?.[0]?.address || "unknown@unknown.com";
          const fromName = parsed.from?.value?.[0]?.name || fromEmail.split("@")[0];
          const subject = parsed.subject || "(no subject)";
          const body = (parsed.text || "").trim().slice(0, 5000) || "(empty message)";

          db.prepare(`
            INSERT INTO tickets (id, customer_name, email, subject, message, message_id, status, date)
            VALUES (?, ?, ?, ?, ?, ?, 'open', date('now'))
          `).run(makeTicketId(), fromName, fromEmail, subject, body, messageId);

          console.log(`New support ticket created from email: ${subject} (${fromEmail})`);
        }

        await client.messageFlagsAdd(uid, ["\\Seen"]);
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error("Inbox polling failed:", err.message);
  } finally {
    try { await client.logout(); } catch { /* already disconnected, ignore */ }
  }
}
