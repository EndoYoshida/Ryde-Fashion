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
// ANTHROPIC_API_KEY - from console.anthropic.com — powers real language
// understanding (Tagalog/Taglish/English, typos, shorthand) instead of
// literal keyword matching. If unset, the bot still works using the older
// keyword-matching logic below as a fallback, just less flexibly.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"; // fast + cheap, plenty for this
// Same pattern emailTemplates.js uses for building absolute URLs to files
// in /public — Messenger needs a real public URL, not a relative path.
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:4000";
const faqImage = (filename) => `${APP_ORIGIN}/public/messenger/${filename}`;

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
// IMPORTANT: fill in the two marked with [FILL IN] below with your actual
// policy — everything else here was pulled straight from your existing
// Auto Reply message in Meta Business Suite, so it's already accurate.
const FAQS = [
  {
    id: "cod",
    keywords: ["cod", "cash on delivery"],
    answer: `[FILL IN — do you accept Cash on Delivery? Which areas/couriers?]`,
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
    answer: `We're based in Valenzuela City, Metro Manila — meet-up/pickup available there. 📍`,
  },
  {
    id: "returns",
    keywords: ["return", "exchange", "refund"],
    answer: `[FILL IN — what's your return/exchange policy, and within how many days?]`,
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
];

function matchFaq(text) {
  const lower = text.toLowerCase();
  return FAQS.find((f) => f.keywords.some((k) => lower.includes(k)));
}

// --- AI understanding layer (Claude) --------------------------------
// Reads the raw message — in English, Tagalog, or Taglish, typos and all —
// and figures out what the customer actually wants: an FAQ answer, a
// product search (translated to clean English search terms), or neither
// (a greeting/small talk). This replaces guessing intent from a fixed
// word list, which breaks on anything not explicitly anticipated.
async function interpretMessage(text) {
  if (!ANTHROPIC_API_KEY) return null;

  const faqList = FAQS.map((f) => f.id).join(", ");
  const system =
    `You triage incoming Facebook Messenger messages for a Philippines-based online shop ` +
    `selling authentic (never used) branded bags, watches, apparel, and accessories. ` +
    `Customers write in English, Tagalog, or Taglish, often with typos/shorthand (e.g. "hm" = ` +
    `"how much", "meron ba" = "do you have"). Classify each message using the interpret_message tool. ` +
    `Known FAQ topics: cod (cash on delivery), shipping (delivery/couriers/areas), authenticity ` +
    `(is it real/legit/registered business), location (where based/meet-up), returns (return/exchange ` +
    `policy), payment (how to pay), hours (business hours), condition (brand new vs used), installment ` +
    `(payment plans/layaway), item_care (how to store/maintain items after receiving), reservation ` +
    `(reserving/pre-ordering an item before payment).`;

  const tool = {
    name: "interpret_message",
    description: "Classify a customer message so the store's bot can respond correctly.",
    input_schema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: ["faq", "product_search", "other"],
          description:
            "'faq' for a policy/store question matching one of the known topics, 'product_search' when they're asking about a specific product/brand/category, 'other' for greetings/small talk/anything else.",
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
      },
      required: ["intent"],
    },
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: text }],
      tools: [tool],
      tool_choice: { type: "tool", name: "interpret_message" },
    }),
  });

  if (!res.ok) {
    console.error("Claude interpret call failed:", await res.text());
    return null;
  }

  const data = await res.json();
  const toolUse = data.content?.find((b) => b.type === "tool_use");
  return toolUse?.input || null;
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

// Fallback used only when Claude is unavailable/unset, or returned
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

async function findProductsFallback(query) {
  const words = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return searchProductsByWords(words);
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

        try {
          // Ask Claude what the customer means first — handles Tagalog/
          // Taglish/typos that a fixed keyword list can't anticipate.
          // Falls back to the old keyword-based logic if Claude is
          // unavailable (no API key, or the call itself fails) so the
          // bot degrades gracefully instead of going silent.
          const interpretation = await interpretMessage(text).catch((err) => {
            console.error("Claude interpret failed:", err);
            return null;
          });

          if (interpretation?.intent === "faq" && interpretation.faq_id) {
            const faq = FAQS.find((f) => f.id === interpretation.faq_id);
            if (faq) {
              for (const imageUrl of faq.images || []) {
                await sendImage(senderId, imageUrl);
              }
              await sendMessage(senderId, faq.answer);
              continue;
            }
          }

          if (interpretation?.intent === "other") {
            await sendMessage(
              senderId,
              `Hi! 👋 Ask me about a product (brand, item, or category) for price & stock, or ask about shipping, COD, returns, payment, etc.`
            );
            continue;
          }

          let products;
          if (interpretation?.intent === "product_search" && interpretation.search_terms?.length) {
            products = await searchProductsByWords(interpretation.search_terms.map((w) => w.toLowerCase()));
          } else {
            // Claude unavailable/failed — fall back to the keyword FAQ +
            // product matcher so the bot still responds to something.
            const faq = matchFaq(text);
            if (faq) {
              for (const imageUrl of faq.images || []) {
                await sendImage(senderId, imageUrl);
              }
              await sendMessage(senderId, faq.answer);
              continue;
            }
            products = await findProductsFallback(text);
          }

          if (products.length === 0) {
            await sendMessage(senderId, `Sorry, I couldn't find a product matching "${text}". Could you share the exact product name or brand?`);
            continue;
          }

          const images = await findFirstImages(products.map((p) => p.id));

          // One photo + its caption per matched product, so each image
          // stays paired with the right price/stock line instead of
          // sending a wall of text followed by an unlabeled photo dump.
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