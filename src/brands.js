// Frontend mirror of server/brands.js's normalization rules. Used only
// for GROUPING and FILTERING brands (Brands.jsx tiles, Browse.jsx's
// Brand filter) — it does not change what's actually stored in the
// database, so an individual product's own page/card still shows
// whatever raw brand string that product has. This just stops
// differently-cased, differently-quoted, or misspelled variants of the
// same brand from splitting into separate tiles or silently failing the
// Brand filter's match.
//
// Keep this list in sync with server/brands.js — ideally the two files
// get consolidated into one shared package eventually, but until then
// a brand added on one side should be added on the other too.
export const CANONICAL_BRANDS = [
  "CALVIN KLEIN",
  "CHARLOTTE TILBURY",
  "CLINIQUE",
  "COACH",
  "DKNY",
  "ESTEE LAUDER",
  "GIORGIO ARMANI",
  "INVICTA",
  "JBL",
  "JORDAN",
  "JUICY COUTURE",
  "KARL LAGERFELD",
  "LACOSTE",
  "LOLE",
  "MICHAEL KORS",
  "TECHNOMARINE",
  "TOMMY HILFIGER",
  "TORY BURCH",
  "U.S. POLO ASSN.",
  "VICTORIA'S SECRET",
  "VICTORIA'S SECRET PINK",
];

const BRAND_ALIASES = {
  "charlotte tillbury": "CHARLOTTE TILBURY", // extra "l" — common typo
};

const SMART_QUOTES = /[\u2018\u2019\u201B\u2032\u00B4`]/g;
const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF]/g;

function normalizeForMatch(text) {
  return String(text || "")
    .replace(INVISIBLE_CHARS, "")
    .replace(SMART_QUOTES, "'")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const BRAND_LOOKUP = new Map([
  ...CANONICAL_BRANDS.map((b) => [normalizeForMatch(b), b]),
  ...Object.entries(BRAND_ALIASES).map(([alias, canonical]) => [normalizeForMatch(alias), canonical]),
]);

/**
 * Resolve a raw brand string to its canonical spelling for grouping and
 * filtering purposes. Falls back to a whitespace/quote-cleaned version
 * of the original for brands not yet in CANONICAL_BRANDS, so a
 * genuinely new brand still shows up as its own tile — just without
 * typo/casing protection until it's added to the list above.
 */
export function canonicalizeBrand(text) {
  const collapsed = String(text || "")
    .replace(INVISIBLE_CHARS, "")
    .replace(SMART_QUOTES, "'")
    .trim()
    .replace(/\s+/g, " ");
  if (!collapsed) return null;
  return BRAND_LOOKUP.get(collapsed.toLowerCase()) || collapsed;
}
