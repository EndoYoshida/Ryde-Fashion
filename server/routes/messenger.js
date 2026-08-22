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

// --- 3. Very simple product lookup: matches on brand and/or name words.
// Not fuzzy/AI matching — just an ILIKE search against what's already in
// your products table. Returns up to 3 matches, each with its id (needed
// to look up a photo) and price/stock. -----------------------------------
async function findProducts(query) {
  const words = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (words.length === 0) return [];

  const conditions = words.map((_, i) => `(name ILIKE $${i + 1} OR brand ILIKE $${i + 1})`).join(" OR ");
  const params = words.map((w) => `%${w}%`);

  const rows = await db
    .prepare(`SELECT id, name, brand, price, stock, status FROM products WHERE ${conditions} ORDER BY name LIMIT 3`)
    .all(...params);
  return rows;
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
          const products = await findProducts(text);

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