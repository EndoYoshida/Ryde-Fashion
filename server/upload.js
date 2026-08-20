import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary-v2";

// Render's disk is ephemeral — anything written to local disk (product
// photos, payment-proof screenshots) gets wiped on every deploy/restart.
// Cloudinary's free tier (25GB storage/bandwidth) is more than enough for
// a starting storefront and persists independently of the app server.
//
// Set these from your Cloudinary dashboard (cloudinary.com -> Console):
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  throw new Error(
    "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, " +
    "and CLOUDINARY_API_SECRET (from your Cloudinary dashboard)."
  );
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export { cloudinary };

// An explicit allowlist rather than "starts with image/" — that broader
// check would also accept image/svg+xml, and SVGs can embed <script>
// tags, which would be a stored XSS vector once served back to browsers.
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_FORMATS = ["jpg", "jpeg", "png", "webp", "gif"];

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error("Only JPG, PNG, WEBP, or GIF images are allowed"));
  }
  cb(null, true);
}

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "ryde-storefront",
    allowed_formats: ALLOWED_FORMATS,
    // Cloudinary would otherwise reuse the original filename as the
    // public_id, which collides across uploads — let it generate a
    // random unique one instead.
    public_id: (req, file) => `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
  },
});

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024, files: 8 }, // 8MB per file, up to 8 files
});

// After a Cloudinary upload, multer-storage-cloudinary sets:
//   file.filename -> the public_id (what we store in the DB)
//   file.path     -> the secure_url (full https URL, ready to use directly)
// This mirrors what routes/products.js and routes/orders.js expect from
// req.file(s) after `upload.single`/`upload.array` runs.

export function cloudinaryUrl(publicId) {
  return cloudinary.url(publicId, { secure: true });
}

export async function deleteCloudinaryImage(publicId) {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error(`Failed to delete Cloudinary image ${publicId}:`, err.message);
  }
}
