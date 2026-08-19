// J&T Express (Philippines) shipping fee calculator.
//
// Ryde ships out from Metro Manila, so this uses J&T's published
// "Manila origin" rate card: fee depends on (1) which zone the
// delivery province falls in, and (2) the total weight of the parcel.
// Source: J&T Express PH public rate tables (jtexpress.ph / partner
// rate guides), current as of 2026. J&T may adjust rates, run
// promos, or add fuel surcharges — treat this as a close estimate,
// not a live quote from J&T's own systems.

export const JNT_ZONES = {
  NCR: "NCR",
  LUZON: "Luzon",
  VISAYAS: "Visayas",
  MINDANAO: "Mindanao",
  ISLAND: "Island",
};

// Metro Manila / NCR cities.
const NCR_PROVINCES = [
  "Metro Manila", "Manila", "Quezon City", "Makati", "Pasig", "Taguig",
  "Pasay", "Paranaque", "Parañaque", "Mandaluyong", "San Juan", "Marikina",
  "Caloocan", "Malabon", "Navotas", "Valenzuela", "Las Pinas", "Las Piñas",
  "Pateros", "Muntinlupa",
];

// Luzon provinces (outside NCR).
const LUZON_PROVINCES = [
  "Abra", "Apayao", "Aurora", "Bataan", "Batanes", "Batangas", "Benguet",
  "Bulacan", "Cagayan", "Camarines Norte", "Camarines Sur", "Catanduanes",
  "Cavite", "Ifugao", "Ilocos Norte", "Ilocos Sur", "Isabela", "Kalinga",
  "Laguna", "La Union", "Marinduque", "Masbate", "Mountain Province",
  "Nueva Ecija", "Nueva Vizcaya", "Occidental Mindoro", "Oriental Mindoro",
  "Pampanga", "Pangasinan", "Quezon", "Quirino", "Rizal", "Sorsogon",
  "Tarlac", "Zambales", "Albay",
];

// Visayas provinces.
const VISAYAS_PROVINCES = [
  "Aklan", "Antique", "Biliran", "Bohol", "Capiz", "Cebu",
  "Eastern Samar", "Guimaras", "Iloilo", "Leyte", "Negros Occidental",
  "Negros Oriental", "Northern Samar", "Samar", "Siquijor", "Southern Leyte",
];

// Mindanao provinces.
const MINDANAO_PROVINCES = [
  "Agusan del Norte", "Agusan del Sur", "Basilan", "Bukidnon",
  "Camiguin", "Cotabato", "Davao de Oro", "Davao del Norte",
  "Davao del Sur", "Davao Occidental", "Davao Oriental", "Dinagat Islands",
  "Lanao del Norte", "Lanao del Sur", "Maguindanao del Norte",
  "Maguindanao del Sur", "Misamis Occidental", "Misamis Oriental",
  "North Cotabato", "Sarangani", "South Cotabato", "Sultan Kudarat",
  "Sulu", "Surigao del Norte", "Surigao del Sur", "Tawi-Tawi", "Zamboanga del Norte",
  "Zamboanga del Sur", "Zamboanga Sibugay",
];

// Remote/island groups J&T prices as its own "Island" zone.
const ISLAND_PROVINCES = [
  "Palawan", "Romblon",
];

export const PH_PROVINCES = [
  { group: "Metro Manila", zone: JNT_ZONES.NCR, provinces: NCR_PROVINCES },
  { group: "Luzon", zone: JNT_ZONES.LUZON, provinces: LUZON_PROVINCES },
  { group: "Visayas", zone: JNT_ZONES.VISAYAS, provinces: VISAYAS_PROVINCES },
  { group: "Mindanao", zone: JNT_ZONES.MINDANAO, provinces: MINDANAO_PROVINCES },
  { group: "Island / Other", zone: JNT_ZONES.ISLAND, provinces: ISLAND_PROVINCES },
];

const PROVINCE_TO_ZONE = Object.fromEntries(
  PH_PROVINCES.flatMap(({ zone, provinces }) => provinces.map((p) => [p.toLowerCase(), zone]))
);

export function getZoneForProvince(province) {
  if (!province) return null;
  return PROVINCE_TO_ZONE[province.trim().toLowerCase()] || null;
}

// J&T Express "Manila origin" rate card. Each row is the max weight
// (kg) for that price tier; the price is looked up per destination zone.
const RATE_TABLE = [
  { maxKg: 0.5, NCR: 85, Luzon: 95, Visayas: 100, Mindanao: 105, Island: 115 },
  { maxKg: 1, NCR: 115, Luzon: 165, Visayas: 180, Mindanao: 195, Island: 205 },
  { maxKg: 3, NCR: 155, Luzon: 190, Visayas: 200, Mindanao: 220, Island: 230 },
  { maxKg: 4, NCR: 200, Luzon: 280, Visayas: 300, Mindanao: 330, Island: 340 },
  { maxKg: 5, NCR: 220, Luzon: 320, Visayas: 370, Mindanao: 370, Island: 380 },
  { maxKg: 6, NCR: 255, Luzon: 375, Visayas: 435, Mindanao: 435, Island: 445 },
  { maxKg: 7, NCR: 295, Luzon: 435, Visayas: 505, Mindanao: 505, Island: 515 },
  { maxKg: 8, NCR: 335, Luzon: 495, Visayas: 575, Mindanao: 575, Island: 585 },
  { maxKg: 9, NCR: 375, Luzon: 555, Visayas: 645, Mindanao: 645, Island: 655 },
  { maxKg: 10, NCR: 415, Luzon: 615, Visayas: 715, Mindanao: 715, Island: 725 },
];
// Every extra kilo (or fraction) past 10kg adds this much, based on the
// per-kg increase in the published rate card.
const OVER_10KG_STEP = { NCR: 40, Luzon: 60, Visayas: 70, Mindanao: 70, Island: 70 };

// Default parcel weight (kg) assumed for a single item when a product
// doesn't have its own weight set — a reasonable middle-ground for
// fashion items like bags, apparel, and accessories.
export const DEFAULT_ITEM_WEIGHT_KG = 0.3;

export function calculateJntShipping(totalWeightKg, province) {
  const zone = getZoneForProvince(province);
  if (!zone) return null; // unknown/unselected province — can't quote yet

  const weight = Math.max(totalWeightKg, 0.01);
  if (weight <= 10) {
    const tier = RATE_TABLE.find((row) => weight <= row.maxKg) || RATE_TABLE[RATE_TABLE.length - 1];
    return tier[zone];
  }
  const base = RATE_TABLE[RATE_TABLE.length - 1][zone];
  const extraKg = Math.ceil(weight - 10);
  return base + extraKg * OVER_10KG_STEP[zone];
}
