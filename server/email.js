import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { db } from "./db/index.js";
import {
  verificationEmailHtml,
  deletionEmailHtml,
  orderReceiptHtml,
  ticketReplyHtml,
  newTicketNotificationHtml,
  newsletterWelcomeHtml,
  backInStockHtml,
  newProductHtml,
  accountVerificationLinkHtml,
  passwordResetLinkHtml,
} from "./emailTemplates.js";

// --- Outbound (sending) -----------------------------------------------
// Sending now goes through Resend's HTTP API instead of nodemailer/SMTP.
// Render's free tier blocks outbound SMTP (ports 465/587/25) to prevent
// abuse, so a direct connection to smtp.gmail.com reliably times out from
// a Render-hosted server even with correct credentials. Resend sends over
// regular HTTPS (port 443), which isn't affected by that restriction.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Must be an address on a domain you've verified in Resend (or, for quick
// testing before you verify a domain, "onboarding@resend.dev").
const RESEND_FROM = process.env.RESEND_FROM || "Ryde Fashion <onboarding@resend.dev>";

// --- Inbound (support-ticket polling) ----------------------------------
// Receiving still uses IMAP against Gmail directly — see pollInbox() below.
// This is unrelated to the SMTP fix above; if Render also blocks outbound
// IMAP (port 993) on your plan, that's a separate issue with a separate fix
// (e.g. moving the poller elsewhere, or switching to a webhook-based inbox).
const EMAIL_USER = process.env.EMAIL_USER;
// Gmail displays App Passwords in 4-character groups for readability (e.g.
// "abcd efgh ijkl mnop"), but the real password is 16 characters with no
// spaces. If someone copies it straight from the Google Account page, the
// spaces come along for the ride and Gmail rejects the login. Stripping all
// whitespace here means it works whether it's pasted with or without them.
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD?.replace(/\s+/g, "");
const IMAP_HOST = process.env.IMAP_HOST || "imap.gmail.com";
const IMAP_PORT = Number(process.env.IMAP_PORT || 993);

export function isEmailConfigured() {
  return Boolean(RESEND_API_KEY);
}

// Generic sender — everything else in this file builds on this.
// Returns { sent, reason } rather than throwing, so callers can decide
// how to degrade gracefully when email isn't configured or fails.
async function sendEmail({ to, subject, text, html }) {
  if (!RESEND_API_KEY) return { sent: false, reason: "Email isn't configured yet (see server/.env)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, text, html }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Failed to send email:", res.status, body);
      return { sent: false, reason: `Resend API error (${res.status})` };
    }

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
    html: ticketReplyHtml({ subject, body }),
  });
}

// Sends a 6-digit email verification code after signup.
export async function sendVerificationEmail(to, code) {
  return sendEmail({
    to,
    subject: "Verify your email — Ryde Fashion",
    text: `Welcome to Ryde Fashion!\n\nYour verification code is: ${code}\n\nEnter this code in your account page to verify your email. This code expires in 30 minutes — you can request a new one anytime if it runs out.\n\nIf you didn't create this account, you can ignore this email.`,
    html: verificationEmailHtml(code),
  });
}

// Sends a confirmation code before permanently deleting an account.
export async function sendDeletionConfirmationEmail(to, code) {
  return sendEmail({
    to,
    subject: "Confirm account deletion — Ryde Fashion",
    text: `We received a request to permanently delete your Ryde Fashion account.\n\nYour confirmation code is: ${code}\n\nEnter this code to confirm. This code expires in 30 minutes.\n\nIf you didn't request this, ignore this email and your account will remain exactly as it is — nothing happens without the code.`,
    html: deletionEmailHtml(code),
  });
}

// Sends the Firebase-generated verification link inside our own branded
// template, instead of letting Firebase email it with its own default
// (unbrandable) template. The link itself is still 100% Firebase's —
// see server/firebaseAdmin.js#generateVerificationLink.
export async function sendCustomerVerificationLinkEmail(to, link) {
  return sendEmail({
    to,
    subject: "Verify your email — Ryde Fashion",
    text: `Welcome to Ryde Fashion!\n\nVerify your email address by opening this link:\n${link}\n\nIf you didn't create this account, you can ignore this email.`,
    html: accountVerificationLinkHtml(link),
  });
}

// Sends the Firebase-generated password-reset link inside our own
// branded template — see server/firebaseAdmin.js#generatePasswordResetLink.
export async function sendCustomerPasswordResetEmail(to, link) {
  return sendEmail({
    to,
    subject: "Reset your password — Ryde Fashion",
    text: `We received a request to reset your Ryde Fashion password.\n\nReset it by opening this link:\n${link}\n\nIf you didn't request this, you can ignore this email — your password won't change.`,
    html: passwordResetLinkHtml(link),
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

  return sendEmail({ to: order.email, subject: `Your Ryde Fashion order #${order.id}`, text, html: orderReceiptHtml(order) });
}

// Notifies the store's own inbox when a customer submits the "Contact us"
// form, so a new ticket doesn't sit unseen until someone happens to open
// the admin dashboard. Sent to EMAIL_USER itself, not to the customer.
export async function sendNewTicketNotificationEmail(ticket) {
  if (!EMAIL_USER) return { sent: false, reason: "EMAIL_USER isn't configured yet." };
  const text = `New support message from ${ticket.customer} (${ticket.email})\n\nSubject: ${ticket.subject}\n\n${ticket.message}\n\nReply from the admin dashboard's Support Tickets tab.`;
  return sendEmail({
    to: EMAIL_USER,
    subject: `New support message: ${ticket.subject}`,
    text,
    html: newTicketNotificationHtml(ticket),
  });
}

// Sends a short confirmation right after someone subscribes from the
// footer newsletter form.
export async function sendNewsletterWelcomeEmail(to) {
  return sendEmail({
    to,
    subject: "You're subscribed — Ryde Fashion",
    text: "Thanks for joining the Ryde Fashion newsletter! You'll be the first to know about new arrivals, restocks on items you've saved, and upcoming promotions.",
    html: newsletterWelcomeHtml(),
  });
}

// Notifies one customer that a product on their wishlist is available
// again. Failures are logged and swallowed by the caller (recipientEmails
// loop) so one bad address doesn't stop the rest from going out.
export async function sendBackInStockEmail(to, product) {
  return sendEmail({
    to,
    subject: `Back in stock: ${product.name} — Ryde Fashion`,
    text: `Good news — "${product.name}" (${product.brand}) on your wishlist is back in stock at \u20b1${Number(product.price).toLocaleString()}. Stock is limited, so grab it before it sells out again.`,
    html: backInStockHtml(product),
  });
}

// Notifies one newsletter subscriber about a newly uploaded product.
export async function sendNewProductEmail(to, product) {
  return sendEmail({
    to,
    subject: `New arrival: ${product.name} — Ryde Fashion`,
    text: `Something new just landed at Ryde Fashion: "${product.name}" (${product.brand}, ${product.category}) — \u20b1${Number(product.price).toLocaleString()}. Visit the shop to see it before it sells out.`,
    html: newProductHtml(product),
  });
}

function makeTicketId() {
  return `TCK-${Date.now().toString(36).toUpperCase().slice(-6)}${Math.floor(Math.random() * 100)}`;
}

// Checks the inbox for new mail and turns each new message into a support
// ticket — but only when the sender is a registered customer. This inbox is
// the same address used for personal/business mail, so without this filter
// every unrelated email (newsletters, receipts, personal messages, etc.)
// was turning into a "support ticket" in the admin dashboard. Anything from
// an address that isn't a registered customer is just marked as read and
// skipped; it's still marked seen so we don't re-scan it every minute.
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
        const fromEmail = (parsed.from?.value?.[0]?.address || "").toLowerCase();

        const existing = await db.prepare("SELECT id FROM tickets WHERE message_id = ?").get(messageId);
        const isRegisteredCustomer = fromEmail && await db.prepare("SELECT id FROM customers WHERE email = ?").get(fromEmail);

        if (!existing && isRegisteredCustomer) {
          const fromName = parsed.from?.value?.[0]?.name || fromEmail.split("@")[0];
          const subject = parsed.subject || "(no subject)";
          const body = (parsed.text || "").trim().slice(0, 5000) || "(empty message)";

          await db.prepare(`
            INSERT INTO tickets (id, customer_name, email, subject, message, message_id, status, date)
            VALUES (?, ?, ?, ?, ?, ?, 'open', to_char(now(), 'YYYY-MM-DD'))
          `).run(makeTicketId(), fromName, fromEmail, subject, body, messageId);

          console.log(`New support ticket created from email: ${subject} (${fromEmail})`);
        } else if (!existing) {
          console.log(`Skipped non-customer email in support inbox: ${fromEmail || "(unknown sender)"}`);
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