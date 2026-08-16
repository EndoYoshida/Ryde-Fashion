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

// Sends a reply email from the store's inbox to a customer. Returns
// true/false rather than throwing, so a reply can still be saved in the
// dashboard even if the email itself fails to send (e.g. not configured).
export async function sendReplyEmail(to, subject, body) {
  const t = getTransporter();
  if (!t) return { sent: false, reason: "Email isn't configured yet (see server/.env)." };
  try {
    await t.sendMail({
      from: `"Ryde Fashion Support" <${EMAIL_USER}>`,
      to,
      subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      text: body,
    });
    return { sent: true };
  } catch (err) {
    console.error("Failed to send reply email:", err.message);
    return { sent: false, reason: err.message };
  }
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
