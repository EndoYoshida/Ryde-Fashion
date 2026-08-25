// Canonical brand spellings — the single source of truth for how each
// brand name should be cased/punctuated everywhere in the app (admin
// dashboard, Google Sheet sync, storefront "Shop by Brand" tiles).
// Brand matching across the app is exact string equality (see
// Brands.jsx and Browse.jsx), so even one row stored as "CALVIN KLEIN"
// instead of "Calvin Klein" silently creates a second brand tile with
// its own split item count, and that tile's filter won't match the
// other-cased products.
//
// Keep this list in sync with whatever dropdown/picker is used when
// entering a Brand value (Google Form, sheet dropdown, admin form,
// etc.) — same spellings, same order doesn't matter.
export const CANONICAL_BRANDS = [
  "Calvin Klein",
  "Charlotte Tilbury",
  "Clinique",
  "Coach",
  "DKNY",
  "Estee Lauder",
  "Giorgio Armani",
  "Invicta",
  "JBL",
  "Jordan",
  "Juicy Couture",
  "Karl Lagerfeld",
  "Lacoste",
  "Lole",
  "Michael Kors",
  "Technomarine",
  "Tommy Hilfiger",
  "Tory Burch",
  "U.S. Polo Assn.",
  "Victoria's Secret",
  "Victoria's Secret PINK",
];

// normalized (lowercased, whitespace-collapsed) -> canonical spelling
const BRAND_LOOKUP = new Map(
  CANONICAL_BRANDS.map((b) => [b.toLowerCase().replace(/\s+/g, " ").trim(), b])
);

/**
 * Normalize a brand string to its canonical spelling, regardless of case
 * or extra whitespace — "CALVIN KLEIN", "calvin   klein", and
 * "Calvin Klein" all resolve to the same "Calvin Klein", so the same
 * brand can never split into two "Shop by Brand" tiles or silently fail
 * Browse.jsx's exact-match filter.
 *
 * A brand not yet in CANONICAL_BRANDS is passed through with whitespace
 * trimmed/collapsed only, so a genuinely new brand still saves fine —
 * it's just not protected against a future casing mismatch until it's
 * added to the list above.
 */
export function canonicalizeBrand(text) {
  const collapsed = String(text || "").trim().replace(/\s+/g, " ");
  if (!collapsed) return null;
  return BRAND_LOOKUP.get(collapsed.toLowerCase()) || collapsed;
}
