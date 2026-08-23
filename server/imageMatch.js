import { db } from "./db/index.js";

// --- Image-based product matching (Gemini embeddings + pgvector) --------
// Turns a customer's photo into a numeric "fingerprint" (embedding) and
// finds the closest-matching product photo already on file, using
// pgvector's nearest-neighbor search. This is a SEPARATE mechanism from
// the text-based product search in messenger.js — it only runs on images.
//
// ONE-TIME SETUP before this does anything useful:
//   1. Enable pgvector on your Render Postgres database:
//        CREATE EXTENSION IF NOT EXISTS vector;
//      (Render docs: databases created recently have this available by
//      default; older databases may need Render support to enable it —
//      see render.com/docs/postgresql-extensions.)
//   2. Add the embedding column:
//        ALTER TABLE product_images ADD COLUMN embedding vector(3072);
//      3072 matches gemini-embedding-2's default output size — don't
//      change one without the other, pgvector enforces the dimension.
//   3. Run backfillProductEmbeddings() once (see bottom of this file) to
//      embed your existing catalog photos. New product photos need this
//      run again (or hook it into wherever uploads currently happen).

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = "gemini-embedding-2"; // Google's first multimodal (text+image) embedding model, GA since ~mid-2026
// gemini-embedding-2 outputs 3072 dimensions by default, but pgvector's
// HNSW index (used below for fast lookups) hard-caps at 2000 dimensions —
// a 3072-dim column can't be indexed. The model supports Matryoshka
// truncation via outputDimensionality, and Google's own guidance is that
// 768 keeps near-peak quality at a quarter of the storage/index cost, so
// that's what we request. If you ever change this, the `vector(N)` column
// size in the SQL migration MUST change to match, and every embedding
// (catalog + backfilled) needs regenerating — the two dimensions aren't
// compatible with each other.
const EMBEDDING_DIMENSION = 768;

// How close a match needs to be before the bot states it as fact rather
// than asking the customer to confirm. pgvector's `<=>` operator returns
// COSINE DISTANCE (0 = identical, larger = less similar) — NOT a 0-1
// similarity score. There's no universal "right" number here; it depends
// on your actual catalog (how visually distinct your products are from
// each other). Start conservative and tighten/loosen based on real
// matches you see in your logs — logMatchAttempt below prints the
// distance for every attempt specifically so you can tune this.
const CONFIDENT_MATCH_MAX_DISTANCE = 0.22;

// Downloads an image from a URL (Messenger's CDN, or Cloudinary during
// backfill) and returns { base64, mimeType } ready to send to Gemini.
async function fetchImageAsBase64(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to download image (${res.status}): ${imageUrl}`);
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { base64: buffer.toString("base64"), mimeType };
}

// Calls Gemini's embedContent endpoint with inline image data and returns
// the embedding as a plain JS array of numbers, ready to hand to pgvector.
async function embedImage(imageUrl) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set — can't generate embeddings.");
  const { base64, mimeType } = await fetchImageAsBase64(imageUrl);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ inline_data: { mime_type: mimeType, data: base64 } }] },
        outputDimensionality: EMBEDDING_DIMENSION,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini embedContent failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const values = data.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Gemini embedContent returned no embedding values.");
  }
  if (values.length !== EMBEDDING_DIMENSION) {
    throw new Error(`Expected a ${EMBEDDING_DIMENSION}-dim embedding but got ${values.length} — did EMBEDDING_DIMENSION change without re-running the SQL migration?`);
  }
  // Google's own docs disagree on whether truncated (non-3072) outputs
  // come back pre-normalized — normalizing here ourselves is cheap and
  // makes pgvector's cosine distance (`<=>`) correct either way.
  return normalizeVector(values);
}

function normalizeVector(values) {
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  if (magnitude === 0) return values;
  return values.map((v) => v / magnitude);
}

// pgvector expects its literal vector syntax as a string: '[0.1,0.2,...]'
function toVectorLiteral(values) {
  return `[${values.join(",")}]`;
}

// --- Runtime: match a customer's photo against the catalog --------------
// Returns { product, distance } for the closest match if one is found,
// or null if nothing is close enough to be worth suggesting at all (a
// completely unrelated photo shouldn't return a "best guess" no matter
// how bad). Confidence gating (whether to STATE the match as fact vs.
// silently treat it as no-match) is the caller's job — see
// isConfidentMatch below and how messenger.js uses it.
export async function findMatchingProduct(imageUrl) {
  const embedding = await embedImage(imageUrl);
  const vectorLiteral = toVectorLiteral(embedding);

  const rows = await db
    .prepare(
      `SELECT p.id, p.name, p.brand, p.price, p.stock, p.status,
              pi.embedding <=> $1 AS distance
       FROM product_images pi
       JOIN products p ON p.id = pi.product_id
       WHERE pi.embedding IS NOT NULL
       ORDER BY pi.embedding <=> $1
       LIMIT 1`
    )
    .all(vectorLiteral);

  const best = rows[0];
  if (!best) return null;

  console.log(`[imageMatch] closest product for photo: ${best.brand} ${best.name} (distance ${best.distance.toFixed(4)})`);

  // Even a "closest" match can be nowhere close if nothing in the catalog
  // resembles the photo at all — cap how far we'll even consider before
  // treating it as no-match. Kept looser than CONFIDENT_MATCH_MAX_DISTANCE
  // on purpose: this file returns the candidate either way, and it's
  // messenger.js's job to decide (per your "only reply if very
  // confident" preference) whether distance is small enough to state as
  // fact rather than just discard.
  return {
    product: { id: best.id, name: best.name, brand: best.brand, price: best.price, stock: best.stock, status: best.status },
    distance: best.distance,
  };
}

export function isConfidentMatch(distance) {
  return distance <= CONFIDENT_MATCH_MAX_DISTANCE;
}

// --- One-time (or per-new-photo) catalog embedding -----------------------
// Walks every product_images row with no embedding yet, downloads it from
// Cloudinary, embeds it, and writes the vector back. Safe to re-run —
// only touches rows where embedding IS NULL, so it picks up new product
// photos automatically without re-embedding the whole catalog every time.
// Run this from a one-off script (e.g. `node scripts/backfillEmbeddings.js`)
// or wire a call to it into wherever product photo uploads happen.
export async function backfillProductEmbeddings() {
  const { cloudinaryUrl } = await import("./upload.js");
  const rows = await db
    .prepare(`SELECT id, filename FROM product_images WHERE embedding IS NULL ORDER BY id`)
    .all();

  console.log(`[imageMatch] backfilling embeddings for ${rows.length} product photo(s)...`);
  let done = 0;
  for (const row of rows) {
    try {
      const embedding = await embedImage(cloudinaryUrl(row.filename));
      await db
        .prepare(`UPDATE product_images SET embedding = $1 WHERE id = $2`)
        .all(toVectorLiteral(embedding), row.id);
      done++;
    } catch (err) {
      // Keep going — one bad photo (broken URL, transient API error)
      // shouldn't stop the whole backfill. Re-running later picks up
      // anything that failed, since embedding stays NULL for it.
      console.error(`[imageMatch] failed to embed product_image ${row.id}:`, err.message);
    }
  }
  console.log(`[imageMatch] done — embedded ${done}/${rows.length} photo(s).`);
}