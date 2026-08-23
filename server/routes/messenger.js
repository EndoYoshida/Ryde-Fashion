import { Router } from "express";
import crypto from "crypto";
import { db } from "../db/index.js";
import { asyncHandler } from "../asyncHandler.js";
import { cloudinaryUrl } from "../upload.js";
import { findMatchingProduct, isConfidentMatch } from "../imageMatch.js";

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
// SIZE_CHART_TEXT - real measurements for the "which size fits me"
// advice path (interpretation.intent === "advice"). Left blank by
// default on purpose: composeReply is instructed to only use facts it's
// given, so with no chart configured the bot will honestly say it can't
// give sizing advice yet, rather than a real chart just not being wired
// up making it invent one. Fill this in with your actual measurements,
// e.g.:
//   "S: chest 36in, length 26in | M: chest 38in, length 27in | L: chest 40in, length 28in"
const SIZE_CHART_TEXT = process.env.SIZE_CHART_TEXT || "";

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

// --- Duplicate-delivery guard -------------------------------------------
// Meta retries the webhook POST whenever it doesn't get a fast 200 (slow
// cold start, transient error, etc.), which can redeliver the SAME message
// and trigger a duplicate reply. Each Messenger message has a stable
// `mid` — remember recently-seen ones and skip repeats. Capped and
// periodically trimmed so this can't grow unbounded; in-memory only, same
// redeploy caveat as the other Maps in this file (losing the last few
// seconds of dedupe history on a redeploy is harmless — Meta's retries
// happen within seconds, not across a deploy).
const seenMessageIds = new Map(); // mid -> timestamp seen
const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes is generous for Meta's retry window

function isDuplicateMessage(mid) {
  if (!mid) return false; // no id to key on — let it through rather than risk dropping a real message
  const now = Date.now();
  // Opportunistic cleanup of stale entries, avoids a dedicated timer.
  for (const [id, seenAt] of seenMessageIds) {
    if (now - seenAt > DEDUPE_WINDOW_MS) seenMessageIds.delete(id);
  }
  if (seenMessageIds.has(mid)) return true;
  seenMessageIds.set(mid, now);
  return false;
}
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

// --- "Waiting on the customer to name an item" flag ---------------------
// True whenever the bot's last move was asking the customer to name a
// product/brand (either because a text question named nothing specific,
// or because they sent a photo with no name attached). Used to avoid
// asking twice in a row when a photo and an under-specified text question
// arrive back-to-back in either order — see handling in the webhook loop
// and the product_search branches below. Cleared whenever something
// actually resolves (a product/FAQ/order is found), same as failCounts.
const pendingClarification = new Map(); // senderId -> boolean

function setPendingClarification(senderId) {
  pendingClarification.set(senderId, true);
}

function clearPendingClarification(senderId) {
  pendingClarification.delete(senderId);
}

function isPendingClarification(senderId) {
  return pendingClarification.get(senderId) === true;
}

// Narrower flag than pendingClarification above: specifically "the last
// unresolved thing was a photo with no item name attached," so later
// replies can say "I saw your photo" rather than a generic "which
// category" line. Cleared at the same points pendingClarification is.
const photoAwaitingName = new Map(); // senderId -> boolean

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

// --- Focus product: what "it"/"magkano?"/"may XL pa?" refers to --------
// Set whenever a product search resolves to exactly one product, so a
// customer doesn't have to re-name the item every follow-up message
// ("May XL pa?" -> "Magkano?" should resolve to the same product without
// Gemini having to re-derive it from raw history text each time). Cleared
// implicitly by just being overwritten on the next resolved search — no
// explicit expiry, same in-memory/redeploy caveat as histories/failCounts.
const focusProducts = new Map(); // senderId -> {id, name, brand}

function setFocusProduct(senderId, product) {
  focusProducts.set(senderId, { id: product.id, name: product.name, brand: product.brand });
}

function focusProductText(senderId) {
  const p = focusProducts.get(senderId);
  return p ? `${p.brand} ${p.name} (id ${p.id})` : null;
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
// `history` and `focusProduct` give Gemini what it needs to resolve
// pronoun-ish follow-ups ("magkano?", "may XL pa?") without the customer
// re-naming the item every message — see focusProducts above. Returns
// { intents: [...] } (plural — see below) or null if Gemini's unavailable.
async function interpretMessage(text, { history, focusProduct } = {}) {
  if (!GEMINI_API_KEY) return null;

  const faqList = FAQS.map((f) => f.id).join(", ");
  const system =
    `You triage incoming Facebook Messenger messages for a Philippines-based online shop ` +
    `selling authentic (never used) branded bags, watches, apparel, and accessories. ` +
    `Customers write in English, Tagalog, or Taglish, often with typos/shorthand (e.g. "hm" = ` +
    `"how much", "meron ba" = "do you have"). A single message can ask more than one thing at once ` +
    `(e.g. "Magkano yung black XL? May COD ba?" is a price question AND a COD question) — return ONE ` +
    `entry in "intents" per distinct question, in the order asked. Most messages only have one.\n\n` +
    `Known FAQ topics: cod (cash on delivery), shipping (delivery/couriers/areas), authenticity ` +
    `(is it real/legit/registered business), location (where based/meet-up), returns (return/exchange ` +
    `policy), payment (how to pay), hours (business hours), condition (brand new vs used), installment ` +
    `(payment plans/layaway), item_care (how to store/maintain items after receiving), reservation ` +
    `(reserving/pre-ordering an item before payment), how_to_order (steps to place an order), ` +
    `delivery_time (how many days delivery takes, ETA), promos (ongoing discounts/sales/vouchers), ` +
    `wholesale (bulk/wholesale orders), actual_photos (asking for real photos of the actual unit, not ` +
    `catalog photos), cancellation (can I cancel my order), sizes_colors (asking what sizes/colors are ` +
    `available IN GENERAL, not about a specific product — use "product_search" with color/size instead ` +
    `when they're asking about a specific item), human_agent (explicitly asking to talk to a real ` +
    `person/customer support).\n\n` +
    `Use "order_status" when asking about an order they ALREADY PLACED (e.g. "kailan po dadating yung ` +
    `order ko", "nasaan na po order ko") — different from delivery_time, which is a general "how long ` +
    `does shipping take" question. Include order_id if they gave a number.\n\n` +
    `Use "advice" for a judgment call the customer wants help with — which size/fit suits them, ` +
    `comparing options ("oversized or regular?"), whether they should get XL vs XXL — as opposed to a ` +
    `plain fact lookup. Put a short restatement of what they want judged in advice_question.\n\n` +
    `For "product_search": search_terms are the product/brand/category keywords in ENGLISH, translated ` +
    `if Tagalog, filler words removed (e.g. "meron ba kayo bag for men" -> ["bag"]). Set color/size ` +
    `ONLY if the customer named them (e.g. "may black XL?" -> color: "black", size: "XL"). Leave ` +
    `search_terms EMPTY (not omitted) when the customer clearly means the item already being discussed ` +
    `and gives no new name for it (e.g. a bare "magkano?" or "may XL pa?" right after a product came up) ` +
    `— that's resolved from conversation context, not a new search.\n\n` +
    (focusProduct
      ? `Product currently being discussed (use this for pronoun-ish follow-ups with no new item named): ${focusProduct}\n\n`
      : `No product is currently being discussed.\n\n`) +
    `Recent conversation (may be empty):\n${history || "(none yet)"}`;

  // Same schema shape Claude used (input_schema) — Gemini's function
  // declarations accept the same JSON-schema subset, just under a
  // different key ("parameters" instead of "input_schema").
  const functionDeclaration = {
    name: "interpret_message",
    description: "Classify a customer message — possibly multiple questions at once — so the store's bot can respond correctly.",
    parameters: {
      type: "object",
      properties: {
        intents: {
          type: "array",
          description: "One entry per distinct question in the message, in the order asked. Almost always length 1.",
          items: {
            type: "object",
            properties: {
              intent: {
                type: "string",
                enum: ["faq", "product_search", "order_status", "advice", "other"],
                description:
                  "'faq' for a policy/store question, 'product_search' for a specific product/brand/category (including price/stock/color/size questions about it), 'order_status' for an existing order, 'advice' for a judgment call (which size/fit/option), 'other' for greetings/small talk/anything else.",
              },
              faq_id: {
                type: "string",
                enum: FAQS.map((f) => f.id),
                description: `Only set when intent is "faq". One of: ${faqList}.`,
              },
              search_terms: {
                type: "array",
                items: { type: "string" },
                description: 'Only set when intent is "product_search". Empty array if referring back to the product already in context.',
              },
              color: { type: "string", description: 'Only set when intent is "product_search" and a color was named.' },
              size: { type: "string", description: 'Only set when intent is "product_search" and a size was named.' },
              order_id: {
                type: "string",
                description: 'Only set when intent is "order_status" AND an order number was given. Never guess one.',
              },
              advice_question: {
                type: "string",
                description: 'Only set when intent is "advice". A short restatement of the judgment call being asked, in English.',
              },
            },
            required: ["intent"],
          },
        },
      },
      required: ["intents"],
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
  const intents = functionCall?.args?.intents;
  return Array.isArray(intents) && intents.length > 0 ? { intents } : null;
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
// with its id (needed to look up a photo) and price/stock.
//
// color/size (optional) narrow further via product_variants — a product
// with no variant rows at all (nothing ever entered in the sheet's
// Variants column for it) is treated as "not tracked per-variant" and
// still matches on name/brand/category alone, same as before this was
// added, rather than being excluded just because it has no variants.
async function searchProducts({ words = [], color, size } = {}) {
  if (words.length === 0 && !color && !size) return [];

  const params = [];
  const wordConditions = words.map((w) => {
    params.push(`%${w}%`);
    const i = params.length;
    return `(p.name ILIKE $${i} OR p.brand ILIKE $${i} OR p.category ILIKE $${i})`;
  });

  let variantJoin = "";
  const variantConditions = [];
  if (color || size) {
    variantJoin = "JOIN product_variants v ON v.product_id = p.id";
    if (color) {
      params.push(`%${color}%`);
      variantConditions.push(`v.color ILIKE $${params.length}`);
    }
    if (size) {
      params.push(size);
      variantConditions.push(`v.size ILIKE $${params.length}`);
    }
  }

  const where = [...wordConditions, ...variantConditions].join(" AND ") || "TRUE";
  const rows = await db
    .prepare(
      `SELECT DISTINCT p.id, p.name, p.brand, p.price, p.stock, p.status
       FROM products p ${variantJoin}
       WHERE ${where}
       ORDER BY p.name LIMIT 3`
    )
    .all(...params);
  return rows;
}

// All variant rows for one product — used when a color/size question is
// about the product already in focus (e.g. "May black pa?" right after a
// specific item came up), rather than a fresh search.
async function getProductVariants(productId) {
  return db.prepare("SELECT color, size, stock FROM product_variants WHERE product_id = ? ORDER BY color, size").all(productId);
}

function formatVariantAvailability(variants) {
  if (variants.length === 0) return "No size/color breakdown tracked for this item — just the overall stock count.";
  return variants
    .map((v) => `${[v.color, v.size].filter(Boolean).join(" ") || "(no color/size)"}: ${v.stock > 0 ? `${v.stock} in stock` : "out of stock"}`)
    .join("; ");
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
        const hasImage = (event.message?.attachments || []).some((a) => a.type === "image");
        if (!senderId || (!text && !hasImage)) continue; // skip non-text, non-image (stickers, etc.)

        // Skip "echo" events — Meta replays messages the PAGE itself sent
        // (including this bot's own replies, and any manual replies you
        // type in the Page Inbox during a handoff) back through this same
        // webhook with is_echo: true. Without this check, the bot can end
        // up "replying" to its own messages or to your manual handoff
        // replies, looping or talking over you.
        if (event.message?.is_echo) continue;

        // Meta retries webhook deliveries it didn't get a fast 200 for,
        // which can redeliver the same message and cause a duplicate
        // reply. Skip anything we've already processed recently.
        if (isDuplicateMessage(event.message?.mid)) continue;

        // Also doubles as how you find your own OWNER_PSID — see the
        // setup note near the top of this file.
        console.log(`[messenger] incoming message from PSID ${senderId}: ${text || "(photo, no text)"}`);

        // Customer is currently connected to the owner — stay quiet so
        // the bot doesn't talk over a real reply. Still logged above so
        // nothing is lost, and history keeps recording so the bot has
        // context once it resumes.
        if (isHandoffActive(senderId)) {
          if (text) pushHistory(senderId, "customer", text);
          if (hasImage) pushHistory(senderId, "customer", "[sent a photo of an item]");
          continue;
        }

        // --- Image-only message (no text) --------------------------------
        // Try to match the photo against the catalog first (see
        // imageMatch.js — pgvector nearest-neighbor over Gemini image
        // embeddings). Per your call: only act on it when the match is
        // confident; anything less just falls through to asking the
        // customer to name the item, same as before image matching
        // existed. This also degrades safely if pgvector/embeddings
        // aren't set up yet (imageMatch throws, caught below) or if no
        // catalog photo has an embedding at all (findMatchingProduct
        // returns null) — either way, same "ask for the name" fallback.
        if (hasImage && !text) {
          pushHistory(senderId, "customer", "[sent a photo of an item]");

          const imageUrl = (event.message?.attachments || []).find((a) => a.type === "image")?.payload?.url;
          const match = imageUrl
            ? await findMatchingProduct(imageUrl).catch((err) => {
                console.error("[messenger] image match failed:", err.message);
                return null;
              })
            : null;

          if (match && isConfidentMatch(match.distance)) {
            // Treat it exactly like a resolved text-based product search —
            // same downstream state (focus product, failure/clarification
            // reset) so a follow-up like "magkano?" works the same way it
            // would after a normal search.
            resetFailure(senderId);
            clearPendingClarification(senderId);
            photoAwaitingName.delete(senderId);
            setFocusProduct(senderId, match.product);

            const intro = `That looks like this one — here's what we have: 👇`;
            await sendMessage(senderId, intro);
            pushHistory(senderId, "bot", intro);

            const images = await findFirstImages([match.product.id]);
            const photoUrl = images.get(match.product.id);
            if (photoUrl) await sendImage(senderId, photoUrl);
            const line = formatReplyLine(match.product);
            await sendMessage(senderId, line);
            pushHistory(senderId, "bot", line);
            continue;
          }

          if (!isPendingClarification(senderId)) {
            const msg = `Got your photo! Could you tell me the item name or brand so I can check stock for you? 📸`;
            setPendingClarification(senderId);
            photoAwaitingName.set(senderId, true);
            await sendMessage(senderId, msg);
            pushHistory(senderId, "bot", msg);
          }
          continue;
        }

        try {
          pushHistory(senderId, "customer", text);
          if (hasImage) pushHistory(senderId, "customer", "[sent a photo of an item along with that message]");

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
          // Taglish/typos that a fixed keyword list can't anticipate, and
          // can return more than one intent for a single message. Falls
          // back to the old keyword-based single-intent logic if Gemini
          // is unavailable (no API key, the call fails, or the free-tier
          // rate limit is hit) so the bot degrades gracefully instead of
          // going silent.
          const interpretation = await interpretMessage(text, {
            history: historyText(senderId),
            focusProduct: focusProductText(senderId),
          }).catch((err) => {
            console.error("Gemini interpret failed:", err);
            return null;
          });

          if (!interpretation) {
            // --- Gemini unavailable/failed: old single-shot keyword path.
            // No compose call here either, since Gemini being down is the
            // reason we're in this branch — send canned copy as-is.
            const faq = matchFaq(text);
            if (faq) {
              resetFailure(senderId);
              clearPendingClarification(senderId);
              photoAwaitingName.delete(senderId);
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
              const msg = `We carry bags, watches, apparel, and accessories 👜⌚👕 — which category or brand are you looking for?`;
              setPendingClarification(senderId);
              await sendMessage(senderId, msg);
              pushHistory(senderId, "bot", msg);
              continue;
            }
            const products = await searchProducts({ words: fallbackWords });
            if (products.length === 0) {
              const failCount = recordFailure(senderId);
              const msg = `Sorry, I couldn't find a product matching "${text}". Could you share the exact product name or brand?`;
              await sendMessage(senderId, msg);
              pushHistory(senderId, "bot", msg);
              if (failCount >= HUMAN_HANDOFF_THRESHOLD) {
                await notifyOwner(senderId, text);
                startHandoff(senderId);
                await sendMessage(senderId, HUMAN_HANDOFF_MESSAGE);
                pushHistory(senderId, "bot", HUMAN_HANDOFF_MESSAGE);
                resetFailure(senderId);
              }
              continue;
            }
            resetFailure(senderId);
            clearPendingClarification(senderId);
            photoAwaitingName.delete(senderId);
            if (products.length === 1) setFocusProduct(senderId, products[0]);
            const images = await findFirstImages(products.map((p) => p.id));
            for (const p of products) {
              const imageUrl = images.get(p.id);
              if (imageUrl) await sendImage(senderId, imageUrl);
              await sendMessage(senderId, formatReplyLine(p));
            }
            continue;
          }

          // --- Gemini path: walk each detected intent, building one
          // combined `facts` string for a single composed reply, plus a
          // list of template-formatted blocks (photos, price lines, order
          // details — anything with real numbers) to send right after it,
          // in the same order the questions were asked. Numbers/stock/
          // prices/order totals NEVER go through compose — only the short
          // intro does — same guarantee as the original single-intent code.
          const factsParts = [];
          const afterReply = []; // async () => void, run in order after the composed intro
          let anyResolved = false; // at least one intent found something real
          let anyFailed = false; // at least one intent found nothing
          let humanAgentRequested = false;

          for (const item of interpretation.intents) {
            if (item.intent === "faq" && item.faq_id) {
              const faq = FAQS.find((f) => f.id === item.faq_id);
              if (faq) {
                anyResolved = true;
                factsParts.push(faq.answer);
                if (faq.images?.length) afterReply.push(async () => {
                  for (const imageUrl of faq.images) await sendImage(senderId, imageUrl);
                });
                if (faq.id === "human_agent") humanAgentRequested = true;
                continue;
              }
            }

            if (item.intent === "other") {
              factsParts.push(
                `One part of their message was a greeting/small talk/something off-topic — acknowledge it warmly and briefly.`
              );
              continue;
            }

            if (item.intent === "order_status") {
              const orderId = item.order_id?.trim();
              if (!orderId) {
                factsParts.push(`They're asking about an order but didn't give an order number — ask for it.`);
                continue;
              }
              const order = (await db.prepare(`SELECT id, status, payment_status, total, date FROM orders WHERE id = $1`).all(orderId))[0];
              if (!order) {
                anyFailed = true;
                factsParts.push(`No order was found with number "${orderId}" — ask them to double-check it against their order confirmation.`);
                continue;
              }
              anyResolved = true;
              const items = await db.prepare(`SELECT name, qty FROM order_items WHERE order_id = $1 ORDER BY id`).all(orderId);
              factsParts.push(`Found their order — the exact details are sent right after your reply, so don't restate any numbers/status yourself.`);
              afterReply.push(async () => sendMessage(senderId, formatOrderStatusReply(order, items)));
              continue;
            }

            if (item.intent === "advice") {
              const focus = focusProducts.get(senderId);
              const chunks = [`They want help deciding: "${item.advice_question || text}".`];
              if (focus) chunks.push(`Product being discussed: ${focus.brand} ${focus.name}.`);
              chunks.push(
                SIZE_CHART_TEXT
                  ? `Size chart (only real measurements you may use): ${SIZE_CHART_TEXT}`
                  : `No size chart is configured yet — if this needs actual measurements to answer well, say you'll have ${OWNER_NAME} confirm sizing, don't guess a chart.`
              );
              factsParts.push(chunks.join(" "));
              anyResolved = true;
              continue;
            }

            if (item.intent === "product_search") {
              const words = (item.search_terms || []).map((w) => w.toLowerCase());
              const focus = focusProducts.get(senderId);

              let products;
              if (words.length === 0 && focus) {
                // No new item named — resolved from context (focusProduct).
                products = await db
                  .prepare("SELECT id, name, brand, price, stock, status FROM products WHERE id = $1")
                  .all(focus.id);
              } else if (words.length === 0) {
                anyFailed = true;
                setPendingClarification(senderId);
                factsParts.push(
                  photoAwaitingName.get(senderId)
                    ? `They asked about a product/price/stock but named nothing specific, and they recently sent a photo of an item without naming it — ` +
                      `acknowledge you saw the photo and ask them to tell you the item name or brand so you can check it.`
                    : `They asked about a product/price/stock but named nothing specific, and nothing was discussed yet either. ` +
                      `Tell them the shop carries bags, watches, apparel, and accessories, and ask which category or brand.`
                );
                continue;
              } else {
                products = await searchProducts({ words, color: item.color, size: item.size });
              }

              if (products.length === 0) {
                anyFailed = true;
                factsParts.push(`No product matched "${(item.search_terms || []).join(" ") || text}" — ask them to share the exact product name or brand.`);
                continue;
              }

              anyResolved = true;
              if (products.length === 1) setFocusProduct(senderId, products[0]);
              factsParts.push(
                `Found ${products.length} matching product(s): ${products.map((p) => `${p.brand} ${p.name}`).join(", ")}. ` +
                `Photos/prices are sent right after your reply — don't restate prices/stock yourself.`
              );

              if (item.color || item.size) {
                const productForVariants = products.length === 1 ? products[0] : null;
                if (productForVariants) {
                  const variants = await getProductVariants(productForVariants.id);
                  factsParts.push(`Availability by color/size for that item: ${formatVariantAvailability(variants)}`);
                }
              }

              afterReply.push(async () => {
                const images = await findFirstImages(products.map((p) => p.id));
                for (const p of products) {
                  const imageUrl = images.get(p.id);
                  if (imageUrl) await sendImage(senderId, imageUrl);
                  await sendMessage(senderId, formatReplyLine(p));
                }
              });
            }
          }

          if (factsParts.length === 0) {
            // Nothing recognizable came back at all (shouldn't normally
            // happen since Gemini always returns at least one intent, but
            // stay safe rather than silent).
            await replyNaturally(
              `Nothing specific matched — respond warmly and briefly, then invite them to ask about a product or a store policy.`,
              `Hi! 👋 Ask me about a product (brand, item, or category) for price & stock, or ask about shipping, COD, returns, payment, etc.`
            );
            continue;
          }

          await replyNaturally(factsParts.join("\n"));
          for (const step of afterReply) await step();

          if (humanAgentRequested) {
            await notifyOwner(senderId, text);
            startHandoff(senderId);
          }

          if (anyFailed && !anyResolved) {
            const failCount = recordFailure(senderId);
            if (failCount >= HUMAN_HANDOFF_THRESHOLD && !humanAgentRequested) {
              await notifyOwner(senderId, text);
              startHandoff(senderId);
              await replyNaturally(
                `You're having trouble helping with this. Let them know you're connecting them with ${OWNER_NAME} now, who'll take over here.`,
                HUMAN_HANDOFF_MESSAGE
              );
              resetFailure(senderId);
            }
          } else if (anyResolved) {
            resetFailure(senderId);
            clearPendingClarification(senderId);
            photoAwaitingName.delete(senderId);
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