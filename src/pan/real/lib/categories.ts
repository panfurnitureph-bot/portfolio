// Product categories for the Add/Edit forms and filter chips.
// SYNCED sa Customized builder list (2026-08-18) — ito ang canonical na mga
// pangalan para sa BAGONG products. Ang mga lumang pangalan (Dining Chairs,
// Ottoman PH, Dining Table PH…) ay hindi na pipiliin dito, pero hindi masisira
// ang mga existing row — ang Edit form ay nagpe-prepend ng kasalukuyang
// category ng produkto kapag wala ito sa listahan.
// MADE-TO-ORDER na categories — EKSAKTONG listahan ng Customized builder
// (iisang source na para hindi maghiwalay ang dalawang dropdown).
export const MADE_TO_ORDER_CATEGORIES = [
  "Promo Bed",
  "Custom Bed",
  "Accent Chair",
  "Dining Chair",
  "Barstool",
  "Mattress",
  "Dining Table",
  "Side Table",
  "Sofa",
  "Sofa Bed",
  "Ottoman",
  "Swivel Chair",
  "Wall Padding",
];

// Buong listahan ng Add/Edit Product: made-to-order + mga catalog-only na
// category (Kurtina ni PAN = totoong product line; Addons = tag para sa
// "+ Addons" quick-pick sa orders).
export const CATEGORIES = [
  ...MADE_TO_ORDER_CATEGORIES,
  "Kurtina ni PAN",
  "Addons",
];
