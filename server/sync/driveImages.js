import fs from "fs";
import path from "path";
import { getDriveClient } from "./googleAuth.js";
import { UPLOADS_DIR } from "../upload.js";

// Same allowlist as upload.js — a synced image should be held to the same
// standard as one an admin uploads by hand through the dashboard.
const ALLOWED_MIME_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

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

// Downloads a Drive file's bytes to server/uploads/, named so re-syncing
// the same row is idempotent (see hasDriveImage in sheetsSync.js, which
// checks this exact filename pattern before calling this at all).
export async function downloadDriveImage(fileId) {
  const drive = getDriveClient();

  const meta = await drive.files.get({ fileId, fields: "mimeType, name" });
  const ext = ALLOWED_MIME_TYPES[meta.data.mimeType];
  if (!ext) {
    throw new Error(`Drive file ${fileId} (${meta.data.name}) is ${meta.data.mimeType}, not an allowed image type`);
  }

  const filename = `drive-${fileId}${ext}`;
  const destPath = path.join(UPLOADS_DIR, filename);

  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  await new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(destPath);
    response.data.pipe(dest);
    response.data.on("error", reject);
    dest.on("error", reject);
    dest.on("finish", resolve);
  });

  return filename;
}
