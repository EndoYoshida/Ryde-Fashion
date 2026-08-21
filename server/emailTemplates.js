// Branded HTML email templates for Ryde Fashion.
//
// Built as plain inline-styled HTML tables (no external stylesheet, no flex/grid)
// because email clients — especially Outlook — only reliably render that subset
// of CSS. Colors and fonts are pulled straight from the site's own palette
// (see src/styles.css) so these match the logo instead of looking like a
// generic transactional email.

const COLORS = {
  blush: "#F7D6E0",
  rose: "#E3A9BE",
  gold: "#C9A15F",
  goldLight: "#E8D4A8",
  ivory: "#FFFBF7",
  cream: "#FBF3EC",
  beige: "#EFE2D5",
  ink: "#3A2B28",
  inkSoft: "#6B5A55",
};

const HEADING_FONT = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
const BODY_FONT = "'Jost', Arial, Helvetica, sans-serif";

// Where the server is publicly reachable — used to build an absolute URL for
// the logo, since email clients cannot load relative paths. Set APP_ORIGIN in
// server/.env once this is deployed somewhere other than localhost.
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:4000"
const LOGO_URL = `${APP_ORIGIN}/public/logo.jpg`;

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Wraps any block of body HTML in the shared Ryde letterhead: logo header,
// gold divider, content area, and footer. Every email in this file is built
// from this one shell so a palette/logo change only has to happen once.
function layout({ preheader = "", heading, bodyHtml, footerNote = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Ryde Fashion</title>
</head>
<body style="margin:0; padding:0; background:${COLORS.cream}; font-family:${BODY_FONT};">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.cream}; padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%; background:${COLORS.ivory}; border:1px solid ${COLORS.beige}; border-radius:10px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td align="center" style="background:linear-gradient(180deg, ${COLORS.blush} 0%, ${COLORS.cream} 100%); padding:34px 24px 26px;">
              <img src="${LOGO_URL}" width="76" height="76" alt="Ryde Fashion" style="display:block; width:76px; height:76px; border-radius:50%; border:2px solid #ffffff;" />
              <div style="margin-top:14px; font-family:${HEADING_FONT}; font-size:22px; letter-spacing:3px; color:${COLORS.ink}; font-weight:600;">RYDE</div>
              <div style="font-family:${BODY_FONT}; font-size:10px; letter-spacing:1.5px; color:${COLORS.inkSoft}; text-transform:uppercase; margin-top:2px;">Authentic Bags &amp; Apparel</div>
            </td>
          </tr>

          <!-- Gold divider -->
          <tr><td style="height:3px; background:linear-gradient(90deg, ${COLORS.goldLight}, ${COLORS.gold}, ${COLORS.goldLight});"></td></tr>

          <!-- Body -->
          <tr>
            <td style="padding:38px 40px 8px;">
              <h1 style="margin:0 0 16px; font-family:${HEADING_FONT}; font-weight:600; font-size:26px; color:${COLORS.ink};">${heading}</h1>
              <div style="font-family:${BODY_FONT}; font-size:15px; line-height:1.7; color:${COLORS.inkSoft};">
                ${bodyHtml}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 40px 32px;">
              <div style="border-top:1px solid ${COLORS.beige}; padding-top:20px; text-align:center;">
                ${footerNote ? `<p style="margin:0 0 10px; font-family:${BODY_FONT}; font-size:12.5px; color:${COLORS.inkSoft};">${footerNote}</p>` : ""}
                <p style="margin:0; font-family:${BODY_FONT}; font-size:11px; letter-spacing:0.5px; color:${COLORS.gold}; text-transform:uppercase;">From U.S. &middot; On Hand PH</p>
                <p style="margin:10px 0 0; font-family:${BODY_FONT}; font-size:11px; color:#B7A79F;">&copy; ${new Date().getFullYear()} Ryde Fashion. All rights reserved.</p>
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function codeBox(code) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:22px 0;">
      <tr>
        <td align="center" style="background:${COLORS.cream}; border:1.5px dashed ${COLORS.gold}; border-radius:8px; padding:22px;">
          <div style="font-family:${HEADING_FONT}; font-size:34px; font-weight:600; letter-spacing:10px; color:${COLORS.ink};">${escapeHtml(code)}</div>
        </td>
      </tr>
    </table>`;
}

function button(label, url) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background:${COLORS.gold}; border-radius:3px;">
          <a href="${url}" style="display:inline-block; padding:13px 30px; font-family:${BODY_FONT}; font-size:13px; letter-spacing:1.5px; text-transform:uppercase; color:#ffffff; text-decoration:none;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

export function verificationEmailHtml(code) {
  return layout({
    preheader: `Your verification code is ${code}`,
    heading: "Verify your email",
    bodyHtml: `
      <p style="margin:0 0 6px;">Welcome to Ryde Fashion!</p>
      <p style="margin:0;">Enter this code on your account page to verify your email address:</p>
      ${codeBox(code)}
      <p style="margin:0; font-size:13.5px;">This code expires in <strong style="color:${COLORS.ink};">30 minutes</strong> — you can request a new one anytime if it runs out.</p>
      <p style="margin:18px 0 0; font-size:13px; color:#9C8B85;">If you didn't create this account, you can safely ignore this email.</p>
    `,
  });
}

export function deletionEmailHtml(code) {
  return layout({
    preheader: `Your account deletion confirmation code is ${code}`,
    heading: "Confirm account deletion",
    bodyHtml: `
      <p style="margin:0;">We received a request to permanently delete your Ryde Fashion account. Enter this code to confirm:</p>
      ${codeBox(code)}
      <p style="margin:0; font-size:13.5px;">This code expires in <strong style="color:${COLORS.ink};">30 minutes</strong>.</p>
      <p style="margin:18px 0 0; font-size:13px; color:#9C8B85;">If you didn't request this, ignore this email — nothing happens without the code, and your account will remain exactly as it is.</p>
    `,
  });
}

export function orderReceiptHtml(order) {
  const rows = order.items.map((it) => `
    <tr>
      <td style="padding:10px 0; border-bottom:1px solid ${COLORS.beige}; font-size:14px; color:${COLORS.ink};">${escapeHtml(it.name)} <span style="color:${COLORS.inkSoft};">&times;${it.qty}</span></td>
      <td align="right" style="padding:10px 0; border-bottom:1px solid ${COLORS.beige}; font-size:14px; color:${COLORS.ink}; white-space:nowrap;">&#8369;${(it.price * it.qty).toLocaleString()}</td>
    </tr>`).join("");

  return layout({
    preheader: `Your Ryde Fashion order #${order.id} is confirmed`,
    heading: "Thank you for your order!",
    bodyHtml: `
      <p style="margin:0 0 20px;">Hi ${escapeHtml(order.customer)}, we've received your order and we're getting it ready.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;">
        <tr><td style="font-size:13px; color:${COLORS.inkSoft};">Order #</td><td align="right" style="font-size:13px; color:${COLORS.ink}; font-weight:600;">${escapeHtml(order.id)}</td></tr>
        <tr><td style="font-size:13px; color:${COLORS.inkSoft};">Payment method</td><td align="right" style="font-size:13px; color:${COLORS.ink};">${escapeHtml(order.paymentMethod)}</td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;">
        ${rows}
        <tr>
          <td style="padding:14px 0 0; font-family:${HEADING_FONT}; font-size:17px; color:${COLORS.ink};">Total</td>
          <td align="right" style="padding:14px 0 0; font-family:${HEADING_FONT}; font-size:19px; color:${COLORS.gold}; font-weight:600;">&#8369;${order.total.toLocaleString()}</td>
        </tr>
      </table>
      <p style="margin:22px 0 0; font-size:13.5px;"><strong style="color:${COLORS.ink};">Shipping to:</strong><br/>${escapeHtml(order.address)}</p>
      <p style="margin:18px 0 0; font-size:13.5px;">We'll update you as your order is processed. You can also check its status anytime from your account's Order History.</p>
    `,
  });
}

export function ticketReplyHtml({ subject, body }) {
  const paragraphs = escapeHtml(body).split(/\n+/).filter(Boolean).map((p) => `<p style="margin:0 0 14px;">${p}</p>`).join("");
  return layout({
    preheader: `A reply to your message: ${subject}`,
    heading: "A reply to your message",
    bodyHtml: `
      <p style="margin:0 0 4px; font-size:12.5px; letter-spacing:0.5px; text-transform:uppercase; color:${COLORS.gold};">Re: ${escapeHtml(subject)}</p>
      <div style="margin:16px 0; padding:18px 20px; background:${COLORS.cream}; border-left:3px solid ${COLORS.gold}; border-radius:0 6px 6px 0;">
        ${paragraphs}
      </div>
      <p style="margin:18px 0 0; font-size:13px; color:#9C8B85;">Need anything else? Just reply to this email and it'll come straight back to our support inbox.</p>
    `,
  });
}

export function newTicketNotificationHtml({ id, customer, email, subject, message }) {
  const paragraphs = escapeHtml(message).split(/\n+/).filter(Boolean).map((p) => `<p style="margin:0 0 14px;">${p}</p>`).join("");
  return layout({
    preheader: `New support message from ${customer}: ${subject}`,
    heading: "New support message",
    bodyHtml: `
      <p style="margin:0 0 4px; font-size:12.5px; letter-spacing:0.5px; text-transform:uppercase; color:${COLORS.gold};">${escapeHtml(id)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;">
        <tr><td style="font-size:13px; color:${COLORS.inkSoft}; padding:3px 0;">From</td><td align="right" style="font-size:13px; color:${COLORS.ink}; font-weight:600;">${escapeHtml(customer)}</td></tr>
        <tr><td style="font-size:13px; color:${COLORS.inkSoft}; padding:3px 0;">Email</td><td align="right" style="font-size:13px; color:${COLORS.ink};">${escapeHtml(email)}</td></tr>
        <tr><td style="font-size:13px; color:${COLORS.inkSoft}; padding:3px 0;">Subject</td><td align="right" style="font-size:13px; color:${COLORS.ink};">${escapeHtml(subject)}</td></tr>
      </table>
      <div style="margin:16px 0; padding:18px 20px; background:${COLORS.cream}; border-left:3px solid ${COLORS.gold}; border-radius:0 6px 6px 0;">
        ${paragraphs}
      </div>
      <p style="margin:18px 0 0; font-size:13px; color:#9C8B85;">Reply from the admin dashboard's Support Tickets tab so it's logged and sent back to the customer correctly.</p>
    `,
  });
}

export function newsletterWelcomeHtml() {
  return layout({
    preheader: "You're on the list for new arrivals and promotions",
    heading: "You're subscribed!",
    bodyHtml: `
      <p style="margin:0;">Thanks for joining the Ryde Fashion newsletter. You'll be the first to know about new arrivals, restocks on items you've saved, and upcoming promotions.</p>
      <p style="margin:18px 0 0; font-size:13px; color:#9C8B85;">Didn't sign up for this? You can ignore this email, or unsubscribe anytime from the link in future newsletters.</p>
    `,
  });
}

export function backInStockHtml(product) {
  return layout({
    preheader: `${product.name} is back in stock`,
    heading: "Back in stock!",
    bodyHtml: `
      <p style="margin:0 0 20px;">Good news — an item on your wishlist is available again:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;">
        <tr><td style="font-size:13px; color:${COLORS.inkSoft};">Item</td><td align="right" style="font-size:14px; color:${COLORS.ink}; font-weight:600;">${escapeHtml(product.name)}</td></tr>
        <tr><td style="font-size:13px; color:${COLORS.inkSoft};">Brand</td><td align="right" style="font-size:13px; color:${COLORS.ink};">${escapeHtml(product.brand)}</td></tr>
        <tr><td style="font-size:13px; color:${COLORS.inkSoft};">Price</td><td align="right" style="font-size:13px; color:${COLORS.gold}; font-weight:600;">&#8369;${Number(product.price).toLocaleString()}</td></tr>
      </table>
      <p style="margin:18px 0 0; font-size:13.5px;">Stock is limited, so grab it from your wishlist before it sells out again.</p>
    `,
  });
}

export function newProductHtml(product) {
  return layout({
    preheader: `New arrival: ${product.name}`,
    heading: "New arrival",
    bodyHtml: `
      <p style="margin:0 0 20px;">Something new just landed at Ryde Fashion:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;">
        <tr><td style="font-size:13px; color:${COLORS.inkSoft};">Item</td><td align="right" style="font-size:14px; color:${COLORS.ink}; font-weight:600;">${escapeHtml(product.name)}</td></tr>
        <tr><td style="font-size:13px; color:${COLORS.inkSoft};">Brand</td><td align="right" style="font-size:13px; color:${COLORS.ink};">${escapeHtml(product.brand)}</td></tr>
        <tr><td style="font-size:13px; color:${COLORS.inkSoft};">Category</td><td align="right" style="font-size:13px; color:${COLORS.ink};">${escapeHtml(product.category)}</td></tr>
        <tr><td style="font-size:13px; color:${COLORS.inkSoft};">Price</td><td align="right" style="font-size:13px; color:${COLORS.gold}; font-weight:600;">&#8369;${Number(product.price).toLocaleString()}</td></tr>
      </table>
      <p style="margin:18px 0 0; font-size:13.5px;">Visit the shop to see it before it sells out.</p>
    `,
  });
}

export function accountVerificationLinkHtml(link) {
  return layout({
    preheader: "Verify your email to finish setting up your Ryde account",
    heading: "Verify your email",
    bodyHtml: `
      <p style="margin:0 0 6px;">Welcome to Ryde Fashion!</p>
      <p style="margin:0;">Click the button below to verify your email address and finish setting up your account.</p>
      ${button("Verify email", link)}
      <p style="margin:18px 0 0; font-size:13px; color:#9C8B85;">If you didn't create this account, you can safely ignore this email. This link will expire after a while, and you can always request a new one from your account page.</p>
    `,
  });
}

export function passwordResetLinkHtml(link) {
  return layout({
    preheader: "Reset your Ryde Fashion password",
    heading: "Reset your password",
    bodyHtml: `
      <p style="margin:0;">We received a request to reset the password on your Ryde Fashion account. Click below to choose a new one.</p>
      ${button("Reset password", link)}
      <p style="margin:18px 0 0; font-size:13px; color:#9C8B85;">If you didn't request this, you can safely ignore this email — your password won't change unless you click the link above and set a new one.</p>
    `,
  });
}

export function replyBaseHtml(text) {
  // Generic fallback wrapper for any plain-text reply that doesn't have a
  // dedicated template above.
  return layout({
    heading: "Ryde Fashion",
    bodyHtml: `<p style="margin:0; white-space:pre-line;">${escapeHtml(text)}</p>`,
  });
}