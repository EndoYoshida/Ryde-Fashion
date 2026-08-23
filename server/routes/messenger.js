import { Router } from "express";
import crypto from "crypto";
import { db } from "../db/index.js";
import { asyncHandler } from "../asyncHandler.js";
import { cloudinaryUrl } from "../upload.js";

const router = Router();

// Set these in your server's environment (Render dashboard → Environment):
//   FB_VERIFY_TOKEN   - any string you make up yourself, entered in Meta's
//                        webhook setup screen to prove the callback URL is
//                        really yours
//   FB_PAGE_TOKEN     - the Page Access Token Meta gives you after you
//                        connect your Page in the Messenger product setup
//   FB_APP_SECRET     - your app's secret, from the app's Basic Settings —
//                        used to verify incoming webhook calls are really
//                        from Meta, not spoofed
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
const APP_SECRET = process.env.FB_APP_SECRET;
// GEMINI_API_KEY - from aistudio.google.com/apikey — powers real language
// understanding (Tagalog/Taglish/English, typos, shorthand) instead of
// literal keyword matching. If unset, the bot still works using the older
// keyword-matching logic below as a fallback, just less flexibly.
// NOTE: Gemini's free tier is rate-limited (~15 requests/minute as of
// mid-2026 — check current limits at ai.google.dev/gemini-api/docs/rate-limits,
// they change). If you burst past it, calls fail and this file falls back
// to the keyword matcher automatically, so the bot won't go silent.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.6-flash"; // free tier — Google's current-gen Flash model as of Aug 2026
// Same pattern emailTemplates.js uses for building absolute URLs to files
// in /public — Messenger needs a real public URL, not a relative path.
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:4000";
const faqImage = (filename) => `${APP_ORIGIN}/public/messenger/${filename}`;

// OWNER_PSID - your OWN personal Messenger PSID (Page-Scoped ID), so the
// bot can message YOU directly when a customer asks for a human. This is
// NOT your Facebook user ID or Page ID — it's an ID Meta generates that's
// specific to you-as-a-user-of-this-Page. To find it:
//   1. Deploy this update, then message your own Page from your PERSONAL
//      Facebook account (not the Page's) — send literally anything.
//   2. Open your Render dashboard → this service → Logs. You'll see a
//      line like: [messenger] incoming message from PSID 1234567890123: ...
//   3. Copy that number into OWNER_PSID in Render → Environment, then
//      redeploy.
// Note: Messenger's standard send API can only message someone who has
// messaged the Page within the last 24 hours — so message your Page
// yourself every so often (or whenever you're expecting handoffs) to keep
// that window open.
const OWNER_PSID = process.env.OWNER_PSID;
// OWNER_NAME - told to the CUSTOMER so they know who's about to reply to
// them ("Connecting you now with Ronald, the shop owner!") instead of a
// vague "someone will follow up." Set this to whatever name/role you want
// customers to see.
const OWNER_NAME = process.env.OWNER_NAME || "the shop owner";
// HANDOFF_MINUTES - once a customer is connected to a human, the bot goes
// quiet for that customer for this many minutes (so it doesn't talk over
// the owner while they're replying manually in the Page Inbox), then
// automatically resumes answering that customer itself. Raise this if the
// owner tends to take longer to get to messages.
const HANDOFF_MINUTES = Number(process.env.HANDOFF_MINUTES) || 60;
// STORE_NAME - shown in the bot's own replies so it can refer to itself
// ("Hi, this is Ella from RydeFashion!") instead of talking like a
// generic script. Change this if the shop's display name changes.
const STORE_NAME = process.env.STORE_NAME || "RydeFashion";

// --- 1. Webhook verification (Meta calls this once, when you save the
// callback URL in the dashboard) --------------------------------------
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- 2. Confirms an incoming POST really came from Meta, using the
// X-Hub-Signature-256 header + your app secret. Skipped (with a warning)
// if FB_APP_SECRET isn't set yet, so local testing isn't blocked. --------
function verifySignature(req) {
  if (!APP_SECRET) return true;
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", APP_SECRET).update(req.rawBody || "").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// --- FAQ answers, checked BEFORE product search --------------------------
// A message is only checked against product search if it doesn't match one
// of these first — so "do you do COD?" answers as a policy question instead
// of failing an (unrelated) product-name search.
//
// All answers below reflect the shop's actual policy as of the last update.
// If any policy changes (especially returns — currently "none yet"), update
// the relevant answer here.
const FAQS = [
  {
    id: "cod",
    keywords: ["cod", "cash on delivery"],
    answer: `Yes — we accept Cash on Delivery via J&T. 💵`,
  },
  {
    id: "shipping",
    keywords: ["shipping", "deliver", "delivery", "ship"],
    answer: `We offer nationwide shipping via J&T, JRS, LBC, and AP Cargo 🚚 — plus same-day delivery via Lalamove in select areas, or meet-up/pickup if you're nearby.`,
    images: [faqImage("shipping-policy.jpg")],
  },
  {
    id: "authenticity",
    keywords: ["authentic", "original", "fake", "genuine", "legit", "scam", "registered", "dti", "bir"],
    answer: `All our items are authentic and sourced from the US — money-back guaranteed if proven fake by an authorized authenticator. We're also a DTI/BIR-registered legitimate business in the Philippines. ✅`,
    images: [faqImage("authenticity-guarantee.jpg"), faqImage("business-registration.jpg")],
  },
  {
    id: "location",
    keywords: ["meet up", "meetup", "pick up", "pickup", "located", "location", "based", "where are you", "saan"],
    answer: `We're based in Valenzuela City, Metro Manila — meet-up/pickup also available at our partner stores in Olongapo and Angeles. 📍`,
  },
  {
    id: "returns",
    keywords: ["return", "exchange", "refund"],
    // NOTE: no return/exchange policy exists yet as of this writing — update
    // this once you finalize one, this is just a placeholder honest answer.
    answer: `We currently don't offer returns/exchanges — please review item details and photos carefully before ordering. We'll update this policy soon! 🙏`,
  },
  {
    id: "payment",
    keywords: ["payment", "gcash", "bank transfer", "how to pay", "paano magbayad"],
    answer: `We currently accept GCash and bank transfer. Just let us know once you're ready to order and we'll send payment details. 💳`,
  },
  {
    id: "hours",
    keywords: ["hours", "open", "close", "opening", "closing", "anong oras"],
    answer: `We're online and respond from 9AM to 6PM daily. 🕘`,
  },
  {
    id: "condition",
    keywords: ["brand new", "condition", "used", "preloved", "pre-loved", "bago"],
    answer: `All our items are brand new — never used. ✨`,
  },
  {
    id: "installment",
    keywords: ["installment", "installement", "hulugan", "layaway"],
    answer: `Yes — we accept pre-orders/layaway for reservations, following an agreed payment schedule. Reservations are only confirmed once payment is received (first paid, first served), and unpaid reservations aren't guaranteed. 📅`,
  },
  {
    id: "item_care",
    keywords: ["take care", "care instructions", "storage", "unboxing", "alagaan", "how to store"],
    answer: `A few care tips: remove items from plastic packaging once received, and air out bags/watches/accessories regularly — leather is sensitive to heat and humidity. 🧴`,
    images: [faqImage("item-care.jpg")],
  },
  {
    id: "reservation",
    keywords: ["reserve", "reservation", "pre-order", "preorder", "hold this item", "hold an item"],
    answer: `Reservations are confirmed only once payment is received (first paid, first served) — unpaid reservations aren't guaranteed and may be released. Please confirm availability before sending payment, and once an order is packed/shipped, cancellations are no longer allowed. For pre-orders/layaway, the agreed payment schedule must be followed. 📅`,
    images: [faqImage("reservation-policy.jpg")],
  },
  {
    id: "how_to_order",
    keywords: ["how to order", "paano order", "paano bumili", "how can i order", "how do i order", "pa-order po", "gusto ko po nito"],
    answer: `Ordering is easy! 1️⃣ Message us the item you'd like — we'll confirm price & stock. 2️⃣ We'll send payment details (GCash, bank transfer, or COD via J&T). 3️⃣ Once payment is confirmed, we prepare your order for shipping or pickup/meet-up. 📦`,
  },
  {
    id: "delivery_time",
    keywords: ["kailan po dadating", "kailan ko matatanggap", "how many days delivery", "ilang days", "delivery time", "eta"],
    answer: `Delivery time depends on your location and courier — nationwide shipping via J&T typically takes a few business days, or same-day via Lalamove in select areas. We'll share the tracking number once your order ships! 🚚`,
  },
  {
    id: "promos",
    keywords: ["promo", "discount", "sale kayo", "voucher", "may sale"],
    answer: `No ongoing promo right now — follow our Page for updates! 💗`,
  },
  {
    id: "wholesale",
    keywords: ["wholesale", "bulk order", "bulk discount", "discount pag marami"],
    answer: `We don't currently offer wholesale/bulk pricing, sorry! 🙏`,
  },
  {
    id: "actual_photos",
    keywords: ["actual photo", "actual pics", "actual unit", "makita actual"],
    answer: `The photos shown are of our actual stock, not generic catalog photos! If you'd like a fresh photo of the exact unit before ordering, just ask and we'll send one. 📸`,
  },
  {
    id: "cancellation",
    keywords: ["cancel", "cancellation", "i want to cancel", "pwede po ba i-cancel"],
    answer: `Orders can be cancelled anytime before they've been packed or shipped — once packed/shipped, cancellations are no longer allowed. Message us your order number as soon as possible if you need to cancel. 📦`,
  },
  {
    id: "sizes_colors",
    keywords: ["size", "sizes", "sizing", "color", "colors", "kulay", "size chart", "measurement", "measurements"],
    // Our products table has no size/color columns, so this can't be a
    // real per-item lookup yet — it's a generic pointer instead of a
    // guess. If size/color tracking gets added to the DB later, this can
    // be upgraded to an actual availability check.
    answer: `Available sizes/colors vary per item — please check the item's photos/description, or send us the exact product name and we'll confirm what's currently on hand. 📏`,
  },
  {
    id: "human_agent",
    keywords: ["human agent", "customer service", "totoong tao", "customer support", "talk to a person", "talk to someone", "human po", "makausap ang tao"],
    // NOTE: this text is grounding for compose (see composeReply below) —
    // the actual owner notification + handoff pause happens in the
    // webhook handler via notifyOwner()/startHandoff(), triggered
    // whenever this faq_id is matched.
    answer: `Sure — connecting you now with ${OWNER_NAME}! They'll be the one replying here from now on. 🙏`,
  },
];

function matchFaq(text) {
  const lower = text.toLowerCase();
  return FAQS.find((f) => f.keywords.some((k) => lower.includes(k)));
}

// --- Human agent handoff --------------------------------------------
// After a couple of consecutive failed lookups (product not found, order
// not found) for the SAME customer, stop guessing and let them know a
// human will follow up — instead of repeating "couldn't find that" forever.
// In-memory only: resets if the server restarts/redeploys. That's fine at
// this bot's message volume — it just means a streak doesn't survive a
// deploy, not a correctness problem.
const HUMAN_HANDOFF_THRESHOLD = 2;
const HUMAN_HANDOFF_MESSAGE = `I might be having trouble understanding — let me connect you with ${OWNER_NAME} instead! They'll be the one replying here from now on. 🙏`;
const failCounts = new Map(); // senderId -> consecutive failed-to-help count

function recordFailure(senderId) {
  const count = (failCounts.get(senderId) || 0) + 1;
  failCounts.set(senderId, count);
  return count;
}

function resetFailure(senderId) {
  failCounts.delete(senderId);
}

// --- Short conversation memory ---------------------------------------
// A few recent turns per customer, so replies feel like an ongoing chat
// instead of restarting cold every message (e.g. not re-greeting them,
// remembering what they just asked about). In-memory only, same caveat
// as failCounts — resets on redeploy, which is fine at this volume.
const HISTORY_TURNS = 6; // customer+bot messages kept, not full pairs
const histories = new Map(); // senderId -> [{role: "customer"|"bot", text}]

function pushHistory(senderId, role, text) {
  const hist = histories.get(senderId) || [];
  hist.push({ role, text });
  while (hist.length > HISTORY_TURNS) hist.shift();
  histories.set(senderId, hist);
}

function historyText(senderId) {
  const hist = histories.get(senderId) || [];
  return hist.map((h) => `${h.role === "customer" ? "Customer" : "You"}: ${h.text}`).join("\n");
}

// --- Human handoff: actually pings the owner ---------------------------
// Sends a real Messenger DM to OWNER_PSID with the customer's message and
// a link straight into that conversation in Meta's Page Inbox, so you can
// jump in and reply as the Page. If OWNER_PSID isn't set yet, this just
// logs a warning instead of failing the whole request.
function inboxLink(senderId) {
  // Deep link into the Page Inbox for this specific conversation. Requires
  // knowing the Page ID — if you'd rather skip that, PAGE_ID can be left
  // unset and this falls back to the general inbox link.
  const pageId = process.env.FB_PAGE_ID;
  return pageId
    ? `https://www.facebook.com/${pageId}/messages/?mid=${senderId}`
    : `https://www.facebook.com/messages/t/${senderId}`;
}

async function notifyOwner(senderId, customerText) {
  if (!OWNER_PSID) {
    console.warn("OWNER_PSID not set — can't ping owner. See setup notes near the top of this file.");
    return;
  }
  const preview = customerText.length > 300 ? customerText.slice(0, 300) + "…" : customerText;
  await sendMessage(
    OWNER_PSID,
    `🔔 A customer wants to talk to you directly.\n\nTheir last message: "${preview}"\n\nReply here: ${inboxLink(senderId)}`
  );
}

// --- Handoff pause ------------------------------------------------------
// Once a customer is connected to the owner, the bot stops auto-replying
// to THAT customer for a while — otherwise it'd keep answering over the
// owner's manual replies in the Page Inbox, which would be confusing
// (and undercut "you're now talking to a real person"). Resumes on its
// own after HANDOFF_MINUTES so a customer isn't stuck waiting forever if
// the owner doesn't get to it. In-memory, same redeploy caveat as above.
const handoffUntil = new Map(); // senderId -> ms timestamp when bot resumes

function startHandoff(senderId) {
  handoffUntil.set(senderId, Date.now() + HANDOFF_MINUTES * 60 * 1000);
}

function isHandoffActive(senderId) {
  const until = handoffUntil.get(senderId);
  if (!until) return false;
  if (Date.now() >= until) {
    handoffUntil.delete(senderId);
    return false;
  }
  return true;
}

// --- AI understanding layer (Gemini) ---------------------------------
// Reads the raw message — in English, Tagalog, or Taglish, typos and all —
// and figures out what the customer actually wants: an FAQ answer, a
// product search (translated to clean English search terms), or neither
// (a greeting/small talk). This replaces guessing intent from a fixed
// word list, which breaks on anything not explicitly anticipated.
//
// Returns the same shape the rest of this file expects —
// { intent, faq_id?, search_terms? } — regardless of which AI provider
// is behind it, so nothing downstream needed to change.
async function interpretMessage(text) {
  if (!GEMINI_API_KEY) return null;

  const faqList = FAQS.map((f) => f.id).join(", ");
  const system =
    `You triage incoming Facebook Messenger messages for a Philippines-based online shop ` +
    `selling authentic (never used) branded bags, watches, apparel, and accessories. ` +
    `Customers write in English, Tagalog, or Taglish, often with typos/shorthand (e.g. "hm" = ` +
    `"how much", "meron ba" = "do you have"). Classify each message using the interpret_message function. ` +
    `Known FAQ topics: cod (cash on delivery), shipping (delivery/couriers/areas), authenticity ` +
    `(is it real/legit/registered business), location (where based/meet-up), returns (return/exchange ` +
    `policy), payment (how to pay), hours (business hours), condition (brand new vs used), installment ` +
    `(payment plans/layaway), item_care (how to store/maintain items after receiving), reservation ` +
    `(reserving/pre-ordering an item before payment), how_to_order (steps to place an order), ` +
    `delivery_time (how many days delivery takes, ETA), promos (ongoing discounts/sales/vouchers), ` +
    `wholesale (bulk/wholesale orders), actual_photos (asking for real photos of the actual unit, not ` +
    `catalog photos), cancellation (can I cancel my order), sizes_colors (asking what sizes/colors are ` +
    `available — we don't track this per-item yet, so this always gets a generic reply), human_agent ` +
    `(explicitly asking to talk to a real person/customer support). ` +
    `Use the "order_status" intent when the customer is asking about the status/delivery progress of an ` +
    `order they ALREADY PLACED (e.g. "kailan po dadating yung order ko", "order status po", "nasaan na po order ko") — ` +
    `this is different from delivery_time, which is a general "how long does shipping take" question, ` +
    `not asking about a specific existing order. If they included an order number in the message, put it in order_id.`;

  // Same schema shape Claude used (input_schema) — Gemini's function
  // declarations accept the same JSON-schema subset, just under a
  // different key ("parameters" instead of "input_schema").
  const functionDeclaration = {
    name: "interpret_message",
    description: "Classify a customer message so the store's bot can respond correctly.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: ["faq", "product_search", "order_status", "other"],
          description:
            "'faq' for a policy/store question matching one of the known topics, 'product_search' when they're asking about a specific product/brand/category, 'order_status' when asking about the status of an order they already placed, 'other' for greetings/small talk/anything else.",
        },
        faq_id: {
          type: "string",
          enum: FAQS.map((f) => f.id),
          description: `Only set when intent is "faq". One of: ${faqList}.`,
        },
        search_terms: {
          type: "array",
          items: { type: "string" },
          description:
            'Only set when intent is "product_search". The product/brand/category keywords in ENGLISH, translated if the message was in Tagalog, with filler words removed. E.g. "meron ba kayo bag for men" -> ["bag"].',
        },
        order_id: {
          type: "string",
          description:
            'Only set when intent is "order_status" AND the customer included an order number/ID in their message. Extract it exactly as written — do not guess or invent one if they didn\'t provide it.',
        },
      },
      required: ["intent"],
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text }] }],
        tools: [{ function_declarations: [functionDeclaration] }],
        // Forces Gemini to call this function rather than replying in
        // plain text — the equivalent of Claude's tool_choice.
        tool_config: {
          function_calling_config: { mode: "ANY", allowed_function_names: ["interpret_message"] },
        },
      }),
    }
  );

  if (!res.ok) {
    console.error("Gemini interpret call failed:", await res.text());
    return null;
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const functionCall = parts.find((p) => p.functionCall)?.functionCall;
  return functionCall?.args || null;
}

// --- Composes the actual reply text -----------------------------------
// This is what makes the bot sound like a person chatting, not a script
// picking a canned line. It takes whatever FACTS are true for this turn
// (an FAQ answer, product search results, order details, or nothing) and
// asks Gemini to write a natural reply that:
//   - mirrors the customer's language/register (English, Tagalog, or a
//     Taglish mix — whatever THEY just used)
//   - stays grounded strictly in the facts passed in — never invents a
//     price, policy, or stock number that isn't given
//   - reads like a real shop assistant, using the last few turns as
//     context, not a stateless one-off reply
// Returns plain text (or null if Gemini is unavailable, so callers should
// have a canned fallback ready).
async function composeReply({ customerText, facts, history }) {
  if (!GEMINI_API_KEY) return null;

  const system =
    `You are chatting as a real staff member on the Facebook Page Messenger inbox for ${STORE_NAME}, ` +
    `a Philippines-based shop selling authentic (brand new, never used) bags, watches, apparel, and ` +
    `accessories. You're mid-conversation with a customer on Messenger — reply the way a helpful, ` +
    `warm human shop assistant actually types, not like a script or FAQ bot.\n\n` +
    `Language: mirror whatever mix the customer just used — if they wrote in English reply in English, ` +
    `if Tagalog reply in Tagalog, if Taglish match that same blend and casualness. Don't switch to a ` +
    `different language than they used.\n\n` +
    `Facts you can use — these are the ONLY facts you know are true. Do not add, guess, or invent any ` +
    `price, policy detail, stock count, or claim that isn't in here:\n${facts || "(no specific facts for this turn — this is general chat/small talk)"}\n\n` +
    `Recent conversation so far (may be empty if this is the first message):\n${history || "(none yet)"}\n\n` +
    `Keep it short — a real person's Messenger reply, not an essay. Emojis are fine but don't overdo it. ` +
    `If the customer drifts to something unrelated to the shop, gently steer back to how you can help ` +
    `them with a product or order. Reply with ONLY the message text — no labels, no quotes around it.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: customerText }] }],
      }),
    }
  );

  if (!res.ok) {
    console.error("Gemini compose call failed:", await res.text());
    return null;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return text.trim() || null;
}

// --- Product lookup: matches on brand, name, or category. Not fuzzy —
// just an ILIKE search against what's already in your products table.
// Requires every given word to match (so ["calvin","klein","bag"] narrows
// to bags, not every Calvin Klein product) — returns up to 3 matches, each
// with its id (needed to look up a photo) and price/stock. ----------------
async function searchProductsByWords(words) {
  if (words.length === 0) return [];

  const conditions = words.map((_, i) => `(name ILIKE $${i + 1} OR brand ILIKE $${i + 1} OR category ILIKE $${i + 1})`).join(" AND ");
  const params = words.map((w) => `%${w}%`);

  const rows = await db
    .prepare(`SELECT id, name, brand, price, stock, status FROM products WHERE ${conditions} ORDER BY name LIMIT 3`)
    .all(...params);
  return rows;
}

// Fallback used only when Gemini is unavailable/unset, or returned
// "other" for a message that still looks like it might be a product ask.
// Common filler words in how people actually phrase a question — stripped
// so "how much is the Calvin Klein bag" searches on "calvin klein bag",
// not on "how"/"much"/"is"/"the" too. Includes common Taglish shorthand.
// Gender words are also stripped since products aren't tagged by gender —
// "bag for men" falls back to matching all bags rather than nothing.
const STOPWORDS = new Set([
  "how", "much", "is", "are", "the", "a", "an", "for", "of", "do", "does",
  "hm", "hmu", "presyo",
  "you", "have", "in", "stock", "price", "cost", "available", "availability",
  "please", "po", "ba", "meron", "ba'ng", "magkano", "pa", "may", "ang", "ng", "kayo",
  "men", "man", "mens", "women", "woman", "womens", "male", "female",
]);

// Strips filler words down to actual search terms — used both to check
// whether a message is a genuinely vague product question (nothing left
// after stripping) and to build the search itself.
function extractSearchWords(query) {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// Looks up each product's first photo (lowest sort_order), if it has one.
// Returns a Map of product id -> Cloudinary URL, skipping products with
// no uploaded image so we never try to send a broken photo.
async function findFirstImages(productIds) {
  if (productIds.length === 0) return new Map();
  const placeholders = productIds.map((_, i) => `$${i + 1}`).join(",");
  const rows = await db
    .prepare(
      `SELECT DISTINCT ON (product_id) product_id, filename
       FROM product_images
       WHERE product_id IN (${placeholders})
       ORDER BY product_id, sort_order, id`
    )
    .all(...productIds);
  return new Map(rows.map((r) => [r.product_id, cloudinaryUrl(r.filename)]));
}

function formatReplyLine(p) {
  const stockLine = p.status === "available" && p.stock > 0 ? `In stock (${p.stock} left)` : "Currently out of stock";
  return `${p.brand} - ${p.name}\n₱${p.price.toLocaleString()} · ${stockLine}`;
}

// NOTE: order.status is echoed as-is from the DB rather than mapped to a
// friendlier label, since the actual set of status values you use
// (e.g. "pending" / "packed" / "shipped" / "delivered" / "cancelled")
// wasn't confirmed — double check this reads naturally against your real
// data and add a label map here if you want nicer wording per status.
function formatOrderStatusReply(order, items) {
  const itemsLine = items.length ? items.map((i) => `${i.qty}x ${i.name}`).join(", ") : "";
  const paymentLine = order.payment_status ? ` · Payment: ${order.payment_status}` : "";
  return (
    `Order #${order.id}` +
    (itemsLine ? ` — ${itemsLine}` : "") +
    `\nStatus: ${order.status}${paymentLine}` +
    `\nTotal: ₱${order.total.toLocaleString()} · Placed ${order.date}`
  );
}

// --- 4. Incoming messages --------------------------------------------
router.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    if (!verifySignature(req)) return res.sendStatus(403);

    // Acknowledge immediately — Meta expects a fast 200, and will retry
    // (creating duplicate replies) if you don't respond quickly.
    res.sendStatus(200);

    const body = req.body;
    if (body.object !== "page") return;

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const text = event.message?.text;
        if (!senderId || !text) continue; // skip non-text (stickers, etc.)

        // Also doubles as how you find your own OWNER_PSID — see the
        // setup note near the top of this file.
        console.log(`[messenger] incoming message from PSID ${senderId}: ${text}`);

        // Customer is currently connected to the owner — stay quiet so
        // the bot doesn't talk over a real reply. Still logged above so
        // nothing is lost, and history keeps recording so the bot has
        // context once it resumes.
        if (isHandoffActive(senderId)) {
          pushHistory(senderId, "customer", text);
          continue;
        }

        try {
          pushHistory(senderId, "customer", text);

          // Turns a fact (or an instruction describing what to say) into
          // an actual natural-language reply in the customer's own
          // language/register, using recent conversation as context. If
          // Gemini is down, falls back to fallbackText — which MUST be
          // safe to show verbatim (never pass raw instructions as the
          // fallback, only real customer-facing copy).
          const replyNaturally = async (facts, fallbackText = facts) => {
            const composed = await composeReply({
              customerText: text,
              facts,
              history: historyText(senderId),
            }).catch((err) => {
              console.error("Gemini compose failed:", err);
              return null;
            });
            const finalText = composed || fallbackText;
            await sendMessage(senderId, finalText);
            pushHistory(senderId, "bot", finalText);
          };

          // Ask Gemini what the customer means first — handles Tagalog/
          // Taglish/typos that a fixed keyword list can't anticipate.
          // Falls back to the old keyword-based logic if Gemini is
          // unavailable (no API key, the call fails, or the free-tier
          // rate limit is hit) so the bot degrades gracefully instead of
          // going silent.
          const interpretation = await interpretMessage(text).catch((err) => {
            console.error("Gemini interpret failed:", err);
            return null;
          });

          if (interpretation?.intent === "faq" && interpretation.faq_id) {
            const faq = FAQS.find((f) => f.id === interpretation.faq_id);
            if (faq) {
              resetFailure(senderId);
              for (const imageUrl of faq.images || []) {
                await sendImage(senderId, imageUrl);
              }
              await replyNaturally(faq.answer);
              if (faq.id === "human_agent") {
                await notifyOwner(senderId, text);
                startHandoff(senderId);
              }
              continue;
            }
          }

          if (interpretation?.intent === "other") {
            await replyNaturally(
              `Nothing specific matched — this looks like a greeting, small talk, or something off-topic. ` +
                `Respond warmly and briefly, then invite them to ask about a product (brand/item/category) ` +
                `or a store policy (shipping, COD, returns, payment, etc.).`,
              `Hi! 👋 Ask me about a product (brand, item, or category) for price & stock, or ask about shipping, COD, returns, payment, etc.`
            );
            continue;
          }

          if (interpretation?.intent === "order_status") {
            const orderId = interpretation.order_id?.trim();
            if (!orderId) {
              await replyNaturally(
                `Ask the customer for their order number so you can look it up.`,
                `Sure — what's your order number? You can find it on your order confirmation. 🔎`
              );
              continue;
            }

            const orderRows = await db
              .prepare(`SELECT id, status, payment_status, total, date FROM orders WHERE id = $1`)
              .all(orderId);
            const order = orderRows[0];

            if (!order) {
              const failCount = recordFailure(senderId);
              await replyNaturally(
                `No order was found with number "${orderId}". Ask them to double-check it against their order confirmation.`,
                `I couldn't find an order with that number — could you double-check it? It's on your order confirmation. 🔎`
              );
              if (failCount >= HUMAN_HANDOFF_THRESHOLD) {
                await notifyOwner(senderId, text);
                startHandoff(senderId);
                await replyNaturally(
                  `You're having trouble helping with this. Let them know you're connecting them with ${OWNER_NAME} now, who'll take over here.`,
                  HUMAN_HANDOFF_MESSAGE
                );
                resetFailure(senderId);
              }
              continue;
            }

            // Order/payment data is sent exactly as stored — not passed
            // through Gemini — so numbers, status, and totals are never
            // paraphrased. Only the short lead-in line is composed.
            resetFailure(senderId);
            const items = await db
              .prepare(`SELECT name, qty FROM order_items WHERE order_id = $1 ORDER BY id`)
              .all(orderId);
            await replyNaturally(
              `Found their order. Write ONLY a short, warm one-line lead-in (in their language) saying you found it — the exact order details will be sent right after, so don't restate any numbers/status yourself.`,
              `Here's your order:`
            );
            await sendMessage(senderId, formatOrderStatusReply(order, items));
            continue;
          }

          // A general "what do you have / what's in stock" question isn't
          // a failed search — there's genuinely nothing to search on. This
          // gets its own reply (categories to choose from) rather than the
          // "couldn't find a match" message, which reads oddly when nothing
          // was actually searched for.
          const VAGUE_PRODUCT_FACTS =
            `The customer asked generally what's available without naming an item/brand/category. Tell them ` +
            `(in their language) that the shop carries bags, watches, apparel, and accessories, and ask which ` +
            `category or brand they're interested in.`;
          const VAGUE_PRODUCT_FALLBACK = `We carry bags, watches, apparel, and accessories 👜⌚👕 — which category or brand are you looking for?`;

          let products;
          let usedFallback = false;
          if (interpretation?.intent === "product_search") {
            if (!interpretation.search_terms?.length) {
              // Gemini recognized this as a product question but found no
              // specific item/brand/category to search on — i.e. genuinely
              // vague, not a failed extraction worth retrying on raw text.
              await replyNaturally(VAGUE_PRODUCT_FACTS, VAGUE_PRODUCT_FALLBACK);
              continue;
            }
            products = await searchProductsByWords(interpretation.search_terms.map((w) => w.toLowerCase()));
          } else {
            // Gemini unavailable/failed — fall back to the keyword FAQ +
            // product matcher so the bot still responds to something.
            // (No compose call here either, since Gemini being down is
            // the reason we're in this branch — send canned copy as-is.)
            usedFallback = true;
            const faq = matchFaq(text);
            if (faq) {
              resetFailure(senderId);
              for (const imageUrl of faq.images || []) {
                await sendImage(senderId, imageUrl);
              }
              await sendMessage(senderId, faq.answer);
              pushHistory(senderId, "bot", faq.answer);
              if (faq.id === "human_agent") {
                await notifyOwner(senderId, text);
                startHandoff(senderId);
              }
              continue;
            }
            const fallbackWords = extractSearchWords(text);
            if (fallbackWords.length === 0) {
              // Same vague-question case, reached via the keyword path
              // instead of Gemini (e.g. Gemini is down).
              await sendMessage(senderId, VAGUE_PRODUCT_FALLBACK);
              continue;
            }
            products = await searchProductsByWords(fallbackWords);
          }

          if (products.length === 0) {
            const failCount = recordFailure(senderId);
            if (usedFallback) {
              const msg = `Sorry, I couldn't find a product matching "${text}". Could you share the exact product name or brand?`;
              await sendMessage(senderId, msg);
              pushHistory(senderId, "bot", msg);
            } else {
              await replyNaturally(
                `No products matched the customer's search: "${text}". Ask them to share the exact product name or brand so you can check again.`,
                `Sorry, I couldn't find a product matching "${text}". Could you share the exact product name or brand?`
              );
            }
            if (failCount >= HUMAN_HANDOFF_THRESHOLD) {
              await notifyOwner(senderId, text);
              startHandoff(senderId);
              if (usedFallback) {
                await sendMessage(senderId, HUMAN_HANDOFF_MESSAGE);
                pushHistory(senderId, "bot", HUMAN_HANDOFF_MESSAGE);
              } else {
                await replyNaturally(
                  `You're having trouble helping with this. Let them know you're connecting them with ${OWNER_NAME} now, who'll take over here.`,
                  HUMAN_HANDOFF_MESSAGE
                );
              }
              resetFailure(senderId);
            }
            continue;
          }

          resetFailure(senderId);
          const images = await findFirstImages(products.map((p) => p.id));

          // Photo + exact price/stock line per product stay template-
          // formatted on purpose — never paraphrased — so numbers are
          // always exactly what's in the database. Only the short intro
          // line (sent first) is composed, to match the customer's tone.
          if (!usedFallback) {
            await replyNaturally(
              `Found ${products.length} matching product(s): ${products.map((p) => `${p.brand} ${p.name}`).join(", ")}. ` +
                `Write ONLY a short, warm one-line intro (in their language) saying you found some options — the ` +
                `actual photos and prices are sent right after this, so don't restate prices/stock yourself.`,
              `Here's what I found:`
            );
          }

          for (const p of products) {
            const imageUrl = images.get(p.id);
            if (imageUrl) await sendImage(senderId, imageUrl);
            await sendMessage(senderId, formatReplyLine(p));
          }
        } catch (err) {
          console.error("Messenger auto-reply failed:", err);
        }
      }
    }
  })
);

async function sendMessage(recipientId, text) {
  if (!PAGE_TOKEN) {
    console.warn("FB_PAGE_TOKEN not set — skipping Messenger send.");
    return;
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  if (!res.ok) {
    console.error("Messenger send failed:", await res.text());
  }
}

async function sendImage(recipientId, imageUrl) {
  if (!PAGE_TOKEN) return;
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: true } } },
    }),
  });
  if (!res.ok) {
    console.error("Messenger image send failed:", await res.text());
  }
}

export default router;