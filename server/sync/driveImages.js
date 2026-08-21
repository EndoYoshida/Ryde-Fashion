import { getDriveClient } from "./googleAuth.js";
import { cloudinary } from "../upload.js";

// Same allowlist as upload.js — a synced image should be held to the same
// standard as one an admin uploads by hand through the dashboard.
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Accepts either a bare Drive file ID (e.g. "1AbC...") or a full share
// link (e.g. "https://drive.google.com/file/d/1AbC.../view") and returns
// just the ID, since that's all the Drive API actually needs.
export function extractDriveFileId(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const linkMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (linkMatch) return linkMatch[1];
  // A bare ID has no slashes/spaces and is reasonably long.
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

// Streams a Drive file's bytes straight into Cloudinary (no local disk
// involved — Render's disk is ephemeral, so writing here first and
// uploading second would just be a slower way to lose the file on the
// next deploy). Named so re-syncing the same row is idempotent (see
// hasDriveImage in sheetsSync.js, which checks this exact public_id
// pattern before calling this at all).
export async function downloadDriveImage(fileId) {
  const drive = getDriveClient();

  const meta = await drive.files.get({ fileId, fields: "mimeType, name" });
  if (!ALLOWED_MIME_TYPES.has(meta.data.mimeType)) {
    throw new Error(`Drive file ${fileId} (${meta.data.name}) is ${meta.data.mimeType}, not an allowed image type`);
  }

  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  const publicId = `ryde-storefront/drive-${fileId}`;
  await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { public_id: publicId, overwrite: true },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    response.data.pipe(uploadStream);
    response.data.on("error", reject);
    uploadStream.on("error", reject);
  });

  // Returned value is stored in product_images.filename, same as a
  // dashboard-uploaded image's Cloudinary public_id — no "ryde-storefront/"
  // folder prefix needed there since cloudinary.url() takes the full
  // public_id including folder, so store it as-is.
  return publicId;
}

// Moves a product's source photo to Drive's Trash (rather than
// permanently deleting it with files.delete) when the product/row it
// belongs to is removed — same "clear the sheet row, don't hard-delete
// it" philosophy as clearProductRowInSheet in sheetsSync.js. Trashed
// files still count against quota but can be restored from Drive's
// Trash for ~30 days if a row got removed by mistake, which a
// permanent delete wouldn't allow.
// Fire-and-forget by design (see call sites): a Drive hiccup here should
// never fail or slow down a product/row deletion.
export async function trashDriveFile(fileId) {
  if (!fileId) return { trashed: false, reason: "no drive file id" };
  try {
    const drive = getDriveClient();
    await drive.files.update({ fileId, requestBody: { trashed: true } });
    return { trashed: true };
  } catch (err) {
    console.error(`[drive-images] failed to trash file ${fileId}:`, err.message);
    return { trashed: false, reason: err.message };
  }
}
