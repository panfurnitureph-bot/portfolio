"use client";

import { lineKey, hasKey } from "@/lib/orders/line-key";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FOUR_DRAWERS, FOUR_DRAWERS_NOTE, fourDrawerSizeOk, bedFourErr } from "@/lib/bed-rules";
import { useRouter } from "next/navigation";
import type { ProductRow } from "@/lib/supabase/server";
import { saveCustomizedProduct, setProductImage, nextMadeToOrderSku } from "@/app/products/actions";
import { loadSwatches, type WebSwatch } from "@/app/website/actions";
import { WALL_THICKNESSES, frameFor, frameLabel } from "@/lib/double-walling";
// Guided specs (shared) — ang file na ito rin ang pinagkukunan ng SPEC_FIELDS
// ng spec-fields-input; runtime-only ang paggamit kaya ligtas ang cycle.
import { SpecFieldsInput, SpecFieldsView } from "./spec-fields-input";
import { imageUrl } from "./website/util";
import { cleanVariants } from "@/lib/color-variants";
import { MultiImageUpload } from "./multi-image-upload";

// SPEC TEMPLATES kada category (hiling 2026-08-17): pagpili ng category sa
// Customized builder, awtomatikong napupunan ang Specifications ng template —
// pupunan na lang ng sukat. Hindi ginagalaw kapag may sarili nang laman ang
// staff (maliban kung template pa rin ito ng ibang category).
const SPEC_TEMPLATES: Record<string, string> = {
  Sofa: [
    "Length: ____ (cm)(inches)",
    "Width: ____ (cm)(inches)",
    "Total Height: ____ (cm)(inches)",
    "Armrest Height: ____ (cm)(inches)",
    "Armrest Thickness: ____ (cm)(inches)",
    "Backrest Thickness: ____ (cm)(inches)",
    "Seat depth: ____ (cm)(inches)",
    "Legs ____ (cm)(inches) (Wood: box,tooth,round) (metal)",
    "Fabric: ____",
  ].join("\n"),
  "Sofa Bed": [
    "Length: ____ (cm)(inches)",
    "Width: ____ (cm)(inches)",
    "Total Height: ____ (cm)(inches)",
    "Armrest Height: ____ (cm)(inches)",
    "Armrest Thickness: ____ (cm)(inches)",
    "Backrest Thickness: ____ (cm)(inches)",
    "Seat depth: ____ (cm)(inches)",
    "Legs: 4 inches — Standard (standard/round lang)",
    "Fabric: ____ (fabric only, no leather)",
  ].join("\n"),
  Bed: [
    "Length: ____ (cm)(inches)",
    "Width: ____ (cm)(inches)",
    "Headboard Height: ____ from floor",
    "Bedframe Height: ____ included legs",
    "Mattress Insert: ____",
    "Legs: ____",
    "Design: ____",
    "Fabric: ____",
  ].join("\n"),
  "Accent Chair": [
    "Length: ____ (cm)(inches)",
    "Width: ____ (cm)(inches)",
    "Height: ____ (cm)(inches)",
    "Backrest Thickness: ____ (cm)(inches)",
    "Backrest to Seat: ____ (cm)(inches)",
    "Seat Height: ____ (cm)(inches)",
    "Frame: ____ (wood)(metal)",
    "Upholstered Finish: ____",
  ].join("\n"),
  "Dining Chair": [
    "Length: ____ (cm)(inches)",
    "Width: ____ (cm)(inches)",
    "Total Height: ____ (cm)(inches)",
    "Seat Height: ____ (cm)(inches)",
    "Seat Depth / Diameter: ____ (cm)(inches)",
    "Back Cushion Thickness (with wood): ____ (cm)(inches)",
    "Wood Stain: ____",
    "Upholstered Finish: ____",
  ].join("\n"),
  "Dining Table": [
    "Length: ____ (cm)(inches)",
    "Width: ____ (cm)(inches)",
    "Seater: ____ (4=4ftx3ft)(6=5ftx3ft)(8=6-6.5ftx3ft)(10=8ftx3ft)",
    "Table Height: 30 inches",
    "Add-ons: ____ (glass top)(marble)",
    "Top Material / Finish: ____",
  ].join("\n"),
  "Side Table": [
    "Length: ____ (cm)(inches)",
    "Width: ____ (cm)(inches)",
    "Height: ____ (cm)(inches)",
    "Depth: ____ (cm)(inches)",
    "Wood Stain: ____",
  ].join("\n"),
  Mattress: [
    "Model: ____",
    "Size: ____",
    "Thickness: ____",
    "Foam Type: ____",
  ].join("\n"),
  Ottoman: [
    "Length: ____ (cm)(inches)",
    "Width: ____ (cm)(inches)",
    "Total Height: ____ (cm)(inches)",
    "Seat depth: ____ (cm)(inches)",
    "Legs: ____ (cm)(inches)",
    "Type: ____ (standard)(with storage — platform style, no legs)",
  ].join("\n"),
  "Swivel Chair": [
    "Length: ____ (cm)(inches)",
    "Width: ____ (cm)(inches)",
    "End to End: 34 inches",
    "Backrest / Armrest Thickness: 6 inches",
    "Seat depth: 24 inches",
    "Seat Height (incl. legs): 18 inches",
    "Total Height: 28 inches",
    "Backrest to Seat: 32 inches",
    "Fabric: ____",
  ].join("\n"),
  "Wall Padding": [
    "Length: ____ (cm)(inches)",
    "Height: ____ (cm)(inches)",
    "Width: ____ (cm)(inches)",
    "Upholstered Finish: ____",
  ].join("\n"),
};

// STRUCTURED spec fields kada category (hiling 2026-08-17): bawat spec ay
// sariling row — number input na may ▲▼ stepper + unit dropdown para sa mga
// sukat, text input para sa iba. Ang output ay pareho pa ring specs string.
// def/defOpts — paunang laman ng row (hiling ng team 2026-08-17): hal. Legs ng
// Sofa Bed ay 4" Wood na agad, at may standard sizes ang Swivel Chair.
// type "choice" = chips lang, walang text input (hal. Ottoman Type). single =
// isa lang ang mapipili. Sa chip label, ang bahagi bago ang " — " ang ipinapakita;
// ang buong string ang napupunta sa output (para kasama ang auto note).
// fixed = as-is ang value (hindi editable, plain text ang render) — hal. mga
// sukat ng Swivel Chair (team 2026-08-18: "as is ang size, fabric lang ang
// maeedit").
export type SpecField = { label: string; type: "num" | "text" | "choice"; units?: string[]; ph?: string; chips?: string[]; def?: string; defOpts?: string[]; single?: boolean; fixed?: boolean };
const MEASURE_UNITS = ["inches", "cm", "ft"];
// Legs style chips — MULTI-SELECT (hiling 2026-08-17): pwedeng pumili ng higit
// sa isa (hal. Box + Metal); lahat ng napili ay sumasama sa output.
const LEGS_CHIPS = ["Wood", "Box", "Tooth", "Round", "Metal"];
// Wood stain chips (Yuzawa 2026-08-19, mula sa swatch photo) — para sa Dining
// Table, Dining Chair, at Barstool.
const WOOD_STAIN_CHIPS = ["Jacobian", "Dark Mahogany", "Chestnut Brown", "Dark Oak", "Midtone Mahogany", "Light Oak"];
export const SPEC_FIELDS: Record<string, SpecField[]> = {
  Sofa: [
    // LENGTH + WIDTH sa lahat ng category (Joe 2026-09-04): -/+ at in/cm/ft,
    // naitatala sa specs ("Length: 40 inches") at sumusunod sa configurator at site.
    { label: "Length", type: "num", units: MEASURE_UNITS },
    { label: "Width", type: "num", units: MEASURE_UNITS },
    { label: "Total Height", type: "num", units: MEASURE_UNITS },
    { label: "Armrest Height", type: "num", units: MEASURE_UNITS },
    { label: "Armrest Thickness", type: "num", units: MEASURE_UNITS },
    { label: "Backrest Thickness", type: "num", units: MEASURE_UNITS },
    { label: "Seat depth", type: "num", units: MEASURE_UNITS },
    { label: "Legs", type: "num", units: MEASURE_UNITS, chips: LEGS_CHIPS },
    { label: "Fabric", type: "text", ph: "e.g. Velbert Gray 101" },
  ],
  // SOFA BED — eksaktong listahan ng team (2026-08-17): Legs ay 4" Wood na
  // agad ("matic po wood"), at fabric lang — walang leather.
  "Sofa Bed": [
    // LENGTH + WIDTH sa lahat ng category (Joe 2026-09-04): -/+ at in/cm/ft,
    // naitatala sa specs ("Length: 40 inches") at sumusunod sa configurator at site.
    { label: "Length", type: "num", units: MEASURE_UNITS },
    { label: "Width", type: "num", units: MEASURE_UNITS },
    { label: "Total Height", type: "num", units: MEASURE_UNITS },
    { label: "Armrest Height", type: "num", units: MEASURE_UNITS },
    { label: "Armrest Thickness", type: "num", units: MEASURE_UNITS },
    { label: "Backrest Thickness", type: "num", units: MEASURE_UNITS },
    { label: "Seat depth", type: "num", units: MEASURE_UNITS },
    // Team 2026-08-18: alisin ang Metal at Box sa Sofa Bed — Standard at
    // Round lang ang estilo ng legs.
    { label: "Legs", type: "num", units: MEASURE_UNITS, chips: ["Standard", "Round"], def: "4", defOpts: ["Standard"] },
    { label: "Fabric", type: "text", ph: "fabric only — no leather" },
  ],
  Bed: [
    // LENGTH + WIDTH sa lahat ng category (Joe 2026-09-04): -/+ at in/cm/ft,
    // naitatala sa specs ("Length: 40 inches") at sumusunod sa configurator at site.
    { label: "Length", type: "num", units: MEASURE_UNITS },
    { label: "Width", type: "num", units: MEASURE_UNITS },
    { label: "Headboard Height", type: "num", units: MEASURE_UNITS },
    { label: "Bedframe Height", type: "num", units: MEASURE_UNITS },
    { label: "Mattress Insert", type: "num", units: MEASURE_UNITS },
    { label: "Legs", type: "num", units: MEASURE_UNITS, chips: LEGS_CHIPS },
    { label: "Design", type: "text", ph: "e.g. Banana/Vertical" },
    { label: "Fabric", type: "text", ph: "e.g. Promo Gray" },
  ],
  // ACCENT CHAIR — eksaktong listahan ng team (2026-08-18).
  "Accent Chair": [
    // LENGTH + WIDTH sa lahat ng category (Joe 2026-09-04): -/+ at in/cm/ft,
    // naitatala sa specs ("Length: 40 inches") at sumusunod sa configurator at site.
    { label: "Length", type: "num", units: MEASURE_UNITS },
    { label: "Width", type: "num", units: MEASURE_UNITS },
    { label: "Height", type: "num", units: MEASURE_UNITS },
    { label: "Backrest Thickness", type: "num", units: MEASURE_UNITS },
    { label: "Backrest to Seat", type: "num", units: MEASURE_UNITS },
    { label: "Seat Height", type: "num", units: MEASURE_UNITS },
    { label: "Frame", type: "choice", single: true, chips: ["Wood", "Metal"] },
    { label: "Upholstered Finish", type: "text" },
  ],
  // DINING CHAIR — eksaktong listahan ng team (2026-08-18); Wood Stain =
  // CHIPS na mula sa swatch photo (Yuzawa 2026-08-19).
  "Dining Chair": [
    // LENGTH + WIDTH sa lahat ng category (Joe 2026-09-04): -/+ at in/cm/ft,
    // naitatala sa specs ("Length: 40 inches") at sumusunod sa configurator at site.
    { label: "Length", type: "num", units: MEASURE_UNITS },
    { label: "Width", type: "num", units: MEASURE_UNITS },
    { label: "Total Height", type: "num", units: MEASURE_UNITS },
    { label: "Seat Height", type: "num", units: MEASURE_UNITS },
    { label: "Seat Depth / Diameter", type: "num", units: MEASURE_UNITS },
    { label: "Back Cushion Thickness (with wood)", type: "num", units: MEASURE_UNITS },
    { label: "Wood Stain", type: "choice", single: true, chips: WOOD_STAIN_CHIPS },
    { label: "Upholstered Finish", type: "text" },
  ],
  // DINING TABLE — H:30" fixed; seater chips na may kasamang sukat; add-ons
  // Glass Top / Marble (team 2026-08-18); Wood Stain chips (Yuzawa 2026-08-19).
  "Dining Table": [
    // LENGTH + WIDTH sa lahat ng category (Joe 2026-09-04): -/+ at in/cm/ft,
    // naitatala sa specs ("Length: 40 inches") at sumusunod sa configurator at site.
    { label: "Length", type: "num", units: MEASURE_UNITS },
    { label: "Width", type: "num", units: MEASURE_UNITS },
    { label: "Seater", type: "choice", single: true, chips: ["4 Seater — 4ft x 3ft", "6 Seater — 5ft x 3ft", "8 Seater — 6–6.5ft x 3ft", "10 Seater — 8ft x 3ft"] },
    { label: "Table Height", type: "num", units: MEASURE_UNITS, def: "30" },
    { label: "Add-ons", type: "choice", chips: ["Glass Top", "Marble"] },
    { label: "Wood Stain", type: "choice", single: true, chips: WOOD_STAIN_CHIPS },
    { label: "Top Material / Finish", type: "text" },
  ],
  // BARSTOOL — bagong category (Yuzawa 2026-08-19): standard na sukat bilang
  // defaults (editable), Upholstered Finish + Wood Stain chips.
  Barstool: [
    // LENGTH + WIDTH sa lahat ng category (Joe 2026-09-04): -/+ at in/cm/ft,
    // naitatala sa specs ("Length: 40 inches") at sumusunod sa configurator at site.
    { label: "Length", type: "num", units: MEASURE_UNITS },
    { label: "Width", type: "num", units: MEASURE_UNITS },
    { label: "Bar Counter Height", type: "num", units: MEASURE_UNITS, def: "34.5" },
    { label: "End to End", type: "num", units: ["cm", "inches", "ft"], def: "45" },
    { label: "Total Height", type: "num", units: MEASURE_UNITS, def: "34" },
    { label: "Backrest to Seat", type: "num", units: ["cm", "inches", "ft"], def: "55" },
    { label: "Upholstered Finish", type: "text" },
    { label: "Wood Stain", type: "choice", single: true, chips: WOOD_STAIN_CHIPS },
  ],
  // SIDE TABLE — WTB: Height, Depth, Wood Stain (team 2026-08-18).
  "Side Table": [
    // LENGTH + WIDTH sa lahat ng category (Joe 2026-09-04): -/+ at in/cm/ft,
    // naitatala sa specs ("Length: 40 inches") at sumusunod sa configurator at site.
    { label: "Length", type: "num", units: MEASURE_UNITS },
    { label: "Width", type: "num", units: MEASURE_UNITS },
    { label: "Height", type: "num", units: MEASURE_UNITS },
    { label: "Depth", type: "num", units: MEASURE_UNITS },
    { label: "Wood Stain", type: "text", ph: "e.g. Walnut / Oak" },
  ],
  // Mattress: wala na dito — may sariling guided flow (MATTRESS_MODELS).
  // OTTOMAN — listahan ng team (2026-08-17): Standard o With Storage; pag may
  // storage, awtomatikong platform style (walang legs).
  Ottoman: [
    // LENGTH + WIDTH sa lahat ng category (Joe 2026-09-04): -/+ at in/cm/ft,
    // naitatala sa specs ("Length: 40 inches") at sumusunod sa configurator at site.
    { label: "Length", type: "num", units: MEASURE_UNITS },
    { label: "Width", type: "num", units: MEASURE_UNITS },
    { label: "Total Height", type: "num", units: MEASURE_UNITS },
    { label: "Seat depth", type: "num", units: MEASURE_UNITS },
    { label: "Legs", type: "num", units: MEASURE_UNITS, chips: LEGS_CHIPS },
    { label: "Type", type: "choice", single: true, chips: ["Standard", "With Storage — platform style (no legs)"] },
  ],
  // SWIVEL CHAIR — dating naka-lock ang mga sukat ("as is ang size", team
  // 2026-08-18) pero EDITABLE na (hiling ni Joe 2026-09-03): ang mga default ay
  // pre-fill pa rin, pero puwede nang baguhin kada produkto.
  "Swivel Chair": [
    // LENGTH + WIDTH sa lahat ng category (Joe 2026-09-04): -/+ at in/cm/ft,
    // naitatala sa specs ("Length: 40 inches") at sumusunod sa configurator at site.
    { label: "Length", type: "num", units: MEASURE_UNITS },
    { label: "Width", type: "num", units: MEASURE_UNITS },
    { label: "End to End", type: "num", units: MEASURE_UNITS, def: "34" },
    { label: "Backrest / Armrest Thickness", type: "num", units: MEASURE_UNITS, def: "6" },
    { label: "Seat depth", type: "num", units: MEASURE_UNITS, def: "24" },
    { label: "Seat Height (incl. legs)", type: "num", units: MEASURE_UNITS, def: "18" },
    { label: "Total Height", type: "num", units: MEASURE_UNITS, def: "28" },
    { label: "Backrest to Seat", type: "num", units: MEASURE_UNITS, def: "32" },
    { label: "Fabric", type: "text", ph: "e.g. Leather BE20357" },
  ],
  // WALL PADDING — bagong category (team 2026-08-18).
  "Wall Padding": [
    { label: "Length", type: "num", units: MEASURE_UNITS },
    { label: "Height", type: "num", units: MEASURE_UNITS },
    { label: "Width", type: "num", units: MEASURE_UNITS },
    { label: "Upholstered Finish", type: "text" },
  ],
};

// ANG CATEGORY PARA SA SPEC TEMPLATE, MULA SA PANGALAN NG PRODUKTO.
//
// Sa isang custom na order, ang category column ay madalas na build line pala
// ("Fabric: Amalia Canary Yellow"), kaya walang natitirang tunay na category —
// at kung walang category, walang template ang SpecFieldsView: generic na kahon
// ang lalabas imbes na Measurements / Details.
//
// Ang pangalan ("Sofa Bed 1") ang pinagkukunan. Ang PINAKAMAHABANG tugma ang
// panalo, kung hindi ay mababasa ang "Sofa Bed" bilang "Sofa" — magkaibang
// template iyon. Walang tugma = blangko; hindi humuhula.
export function specCategoryOf(category: string | null | undefined, productName: string | null | undefined): string {
  const c = (category ?? "").trim();
  if (c && !c.includes(":")) return c;
  return (
    Object.keys(SPEC_FIELDS)
      .sort((a, b) => b.length - a.length)
      .find((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(productName ?? "")) ?? ""
  );
}
// ½ FRACTION format (hiling 2026-08-19): ang steppers ay ±½ at ang display ay
// "3 ½" (hindi 3.5) — pati sa specs output/resibo. parseHalfStr ang baliktad.
// NO-LEATHER categories (team 2026-08-20): Sofa at Sofa Bed ay bawal ang
// leather — ang fabric picker ay hindi nagpapakita ng leather swatches at
// hindi maidadagdag ang item kapag leather ang nakalagay na tela.
export const isNoLeatherCategory = (c: string) => c === "Sofa" || c === "Sofa Bed";

// FIXED na order ng collection chips (2026-08-20, gaya ng website mock):
// Leather muna, tapos ang fabric collections; hindi alphabetical. Ang wala
// sa listahan ay sa dulo, alphabetical.
const COLLECTION_ORDER = ["leather", "tanya", "cairo", "madrid", "sofia", "bristol", "lafayette", "feather", "velbert", "tahoe", "new sahara"];
export function collectionRank(col: string): number {
  const i = COLLECTION_ORDER.indexOf(col.toLowerCase());
  return i < 0 ? 999 : i;
}
export function sortCollections(cols: string[]): string[] {
  return [...cols].sort((a, b) => {
    const ia = COLLECTION_ORDER.indexOf(a.toLowerCase());
    const ib = COLLECTION_ORDER.indexOf(b.toLowerCase());
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
}

export function fmtHalf(n: number): string {
  if (!Number.isFinite(n)) return "";
  const w = Math.floor(n);
  const fr = n - w;
  if (Math.abs(fr - 0.5) < 0.001) return w ? `${w} ½` : "½";
  return String(n);
}
export function parseHalfStr(v: string | number | null | undefined): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return NaN;
  const half = /½/.test(s) || /\b1\/2\b/.test(s) ? 0.5 : 0;
  const m = /([\d.]+)/.exec(s.replace(/\b1\/2\b/, "").replace(/½/, ""));
  if (!m && half) return 0.5;
  if (!m) return NaN;
  return parseFloat(m[1]) + half;
}

export type SpecRowVal = { label: string; value: string; unit: string; opts?: string[] };
// Rows → specs string (isang linya kada may-lamang field). Ang mga napiling
// chip (Legs) ay ikinakabit sa value: `Legs: 4" — Wood, Box, Metal`.
export function composeSpecs(rows: SpecRowVal[]): string {
  return rows
    .filter((r) => r.value.trim() || (r.opts?.length ?? 0) > 0)
    .map((r) => {
      // Unit kadikit ng numero (4 inches), tsaka ang chips: `Legs: 4 inches — Wood, Box`.
      const base = r.value.trim() ? r.value.trim() + (r.unit ? " " + r.unit : "") : "";
      const opts = (r.opts ?? []).join(", ");
      const val = base && opts ? `${base} — ${opts}` : (base || opts);
      return `${r.label}: ${val}`;
    })
    .join("\n");
}

// ── BED OPTIONS (hiling ng team 2026-08-17, mock inaprubahan) ────────────────
// Ang Bed category ay may sariling guided flow sa halip na spec rows: Promo o
// Custom, Knockdown o With Add-ons, na may error logic (Twin+footboard drawer,
// pullout fit, Lift Storage → Platform Style, Double Walling → walang drawers/
// pullout). Ang output ay pareho pa ring specs string.
export type BedState = {
  btype: "Promo" | "Custom";
  build: "Knockdown" | "Add-ons";
  size: string;
  hbAuto: string;              // automatic headboard height (editable)
  noHb: boolean;               // Custom: NONE headboard (hiling ng team 2026-08-18)
  fabric: string;              // Promo: Beige/Gray
  design: string;              // Promo: Banana/Pumpkin/Pineapple
  uph: string;                 // Custom: typed upholstered finish
  drawer: string; dpos: string[]; dnote: string;
  pull: string; pside: string;
  lift: boolean;
  legs: string;
  tuft: string; matt: string; mattU: string;
  winged: string; hbH: string; hbHU: string; hbX: string; hbXU: string;
  // Hiling ng team (2026-08-21). Ang insert ay kutson na nakalubog sa frame:
  // nauubos nito ang lalim na kailangan ng drawer o pullout, kaya "" (None)
  // lang ang pumapayag ng storage. Ang double walling ay dagdag na panloob na
  // dingding — kinakain din nito ang espasyo ng storage.
  insert: string;
  dwall: boolean;
  // Ang kapal ng dingding ang nagdedesisyon ng sukat ng FRAME — doon humihiwa
  // ang workshop, hindi sa sukat ng kutson. Kasama rito ang mismong dingding:
  // taas, lapad, kapal ng padding, at ang palamuti.
  dwThick: number;
  dwH: string;
  dwW: string;
  dwPad: string;
  dwNails: string;
  dwAccent: boolean;
};
export const BED_DEFAULT: BedState = {
  btype: "Promo", build: "Knockdown", size: "SINGLE 36X75",
  hbAuto: "4ft from floor", noHb: false, fabric: "", design: "", uph: "",
  drawer: "", dpos: [], dnote: "", pull: "", pside: "",
  lift: false, legs: "Standard",
  tuft: "", matt: "", mattU: "inches",
  winged: "", hbH: "", hbHU: "inches", hbX: "", hbXU: "cm",
  insert: "", dwall: false,
  dwThick: 8, dwH: "", dwW: "", dwPad: "", dwNails: "", dwAccent: false,
};
const BED_SIZES_PROMO = ["SINGLE 36X75", "TWIN 48X75", "FULL DOUBLE 54X75", "QUEEN 60X75"];
const BED_SIZES_CUSTOM = [...BED_SIZES_PROMO, "KING 1 72X78", "KING 2 72X78"];
const bedWidth = (size: string) => parseInt(/(\d+)X\d+/.exec(size)?.[1] ?? "0", 10);
// 2 built-in drawers sa FOOTBOARD — di kasya sa Single at Twin (team 2026-08-18).
const bedFbErr = (b: BedState) =>
  b.drawer === "2 built-in drawers" && b.dpos.includes("Footboard") && /SINGLE|TWIN/.test(b.size);
// Pullout dapat mas makitid sa bedframe (sample: SINGLE 36 → 30X70 lang kasya).
const bedPullErr = (b: BedState) => !!b.pull && parseInt(b.pull, 10) >= bedWidth(b.size);
// FULL DOUBLE: drawers O pullout lang — hindi sabay; sa Queen pataas lang pwede
// ang dalawa nang sabay (team 2026-08-18).
const bedBothErr = (b: BedState) => /FULL DOUBLE/.test(b.size) && !!b.drawer && !!b.pull && !bedPullErr(b);
// FLOATING LEGS: nakabitin ang frame — walang mapaglalagyan ng storage.
// MATTRESS INSERT: nakalubog ang kutson, kaya wala nang lalim para sa drawer.
// Ang DOUBLE WALLING ay HINDI kasama rito: pinapayagan ito kasama ng Lift
// Storage (team 2026-08-21) — nagtatakda lang ito ng Platform Style na legs.
const bedNoStorage = (b: BedState) => /floating/i.test(b.legs) || !!b.insert;
const bedStoragePicked = (b: BedState) => !!b.drawer || !!b.pull || b.lift;
const bedStorageErr = (b: BedState) => bedNoStorage(b) && bedStoragePicked(b);
// WALANG HEADBOARD: walang mabibigyan ng pakpak (team 2026-08-21).
const bedWingErr = (b: BedState) => b.noHb && /^winged$/i.test(b.winged.trim());
export function composeBedSpecs(b: BedState): string {
  const L: string[] = [];
  L.push(`${b.btype} Bed — ${b.build === "Add-ons" ? "With Add-ons" : "Knockdown (no add-ons)"}`);
  L.push(`Size: ${b.size}`);
  // NONE headboard (Custom) — sariling linya sa halip na height.
  if (b.btype === "Custom" && b.noHb) L.push("Headboard: None");
  else if (b.hbAuto.trim()) L.push(`Headboard Height: ${b.hbAuto.trim()}`);
  if (b.btype === "Promo") {
    if (b.fabric) L.push(`Fabric: ${b.fabric}`);
    if (b.design) L.push(`Design: ${b.design}`);
  } else if (b.uph.trim()) {
    L.push(`Upholstered Finish: ${b.uph.trim()}${/boucle/i.test(b.uph) ? " (boucle — additional cost, manual)" : ""}`);
  }
  if (b.build === "Add-ons") {
    // 4 BUILT-IN DRAWERS: walang ibang add-on ang isinusulat (lib/bed-rules).
    const four = b.drawer === FOUR_DRAWERS && !bedFourErr(b);
    if (b.drawer && !bedFbErr(b) && !bedFourErr(b)) L.push(`Drawers: ${b.drawer}${b.dpos.length ? " — " + b.dpos.join(", ") : ""}${b.dnote.trim() ? ` (${b.dnote.trim()})` : ""}`);
    // Sa Full Double conflict, ang drawers ang mananatili — hindi isinasama ang
    // pullout hangga't hindi inaalis ang isa (may pulang babala sa UI).
    if (b.pull && !four && !bedPullErr(b) && !bedBothErr(b)) L.push(`Pullout Bed: ${b.pull}${b.pside ? " — " + b.pside : ""}`);
    if (b.lift && !four) L.push("Lift Storage: Yes — Platform Style");
    L.push(`Legs: ${b.legs}${b.lift ? " (Lift Storage)" : ""}`);
    // Ang insert at double walling ay parehong nagbabawal ng storage — nasa
    // itaas ang pag-aalis; dito na lang sila naitatala.
    if (b.insert && !four) L.push(`Mattress Insert: ${b.insert}`);
    if (b.dwall && !four) {
      L.push(`Double Walling: ${b.dwThick}"`);
      const f = frameLabel(b.size, b.dwThick);
      if (f) L.push(`Frame Dimension: ${f}`);
      // Ang zero ay walang sukat — hindi ito isinusulat, gaya ng blangko.
      // parseHalfStr, hindi Number: ang "2 ½" ay NaN sa Number().
      const num = (v: string) => (parseHalfStr(v) > 0 ? v.trim() : "");
      // Parehong pangalan at parehong pagkakasunod ng nasa form. Ang hindi
      // tinipa ay hindi isinusulat — ang lapad ng frame ay nasa Frame
      // Dimension na sa itaas, kaya walang mawawala.
      if (num(b.dwH)) L.push(`Height: ${num(b.dwH)} in`);
      if (num(b.dwPad)) L.push(`Thickness: ${num(b.dwPad)} in`);
      if (num(b.dwW)) L.push(`Width: ${num(b.dwW)} in`);
      if (b.dwNails) L.push(`Decorative Nails: ${b.dwNails}`);
      if (b.dwAccent) L.push("Gold Accent: Yes");
    }
    if (b.tuft && !four) L.push(`${b.tuft}${b.tuft === "Tufted Footboard" ? " — same design as headboard" : ""}${b.tuft === "Tufted Elevated Footboard" && b.matt.trim() ? ` — Mattress Thickness: ${b.matt.trim()} ${b.mattU}` : ""}`);
    if (b.btype === "Custom" && !b.noHb) {
      if (b.winged) L.push(`Winged Headboard: ${b.winged}`);
      if (b.hbH.trim()) L.push(`Headboard Height (manual): ${b.hbH.trim()} ${b.hbHU}`);
      if (b.hbX.trim()) L.push(`Exceed Headboard: ${b.hbX.trim()}`);
    }
  } else {
    L.push(`Legs: ${b.legs}`);
  }
  return L.join("\n");
}

// Auto na made-to-order SKU — MAIKSI na (hiling 2026-08-17, dating 18 chars):
// PREFIX-XXXXXX, kung saan ang XXXXXX ay ang kasalukuyang segundo sa base36
// (unique kada segundo; may dedupe pa sa save). Hal. SOFA-TN6Z0X, PROMO-TN6Z14.
// Pansamantalang SKU habang hinihintay ang server (sunud-sunod na numero);
// pinapalitan agad ng nextMadeToOrderSku.
// ── MATTRESS OPTIONS (hiling 2026-08-18) ─────────────────────────────────────
// Ang Mattress category ay guided din: pili ng MODEL → auto ang thickness,
// foam type, at pangalan; pili ng SIZE → auto ang presyo (galing sa "Linen by
// PAN" price list). Pag nagbago ang Uratex SRP, dito lang ie-edit.
type MatModel = { name: string; thick: string; foam: string; sizes: [string, number][] };
export const MATTRESS_MODELS: MatModel[] = [
  { name: "Uratex Airlite Wind", thick: "6", foam: "Sleep Cool® Breathable Foam", sizes: [["36x75", 7100], ["48x75", 8650], ["54x75", 9500], ["60x75", 10200], ["72x78", 13100]] },
  { name: "Uratex Trill Air", thick: "5", foam: "Airflow Convoluted Foam", sizes: [["36x75", 6000], ["48x75", 6850], ["54x75", 7600], ["60x75", 8350], ["72x78", 9100]] },
  { name: "Uratex Trill Regal", thick: "9", foam: "Pocket Spring · Medium-Firm Support", sizes: [["36x75", 11500], ["48x75", 15400], ["54x75", 16900], ["60x75", 18400], ["72x78", 22300]] },
  { name: "Uratex Comfort Plus", thick: "6", foam: "Certified Comfort Foam · Polycotton Cover", sizes: [["36x75", 6270], ["48x75", 7870], ["54x75", 8660], ["60x75", 9450], ["72x75", 11150], ["72x78", 12150]] },
  { name: "Uratex Trill Hybrid", thick: "10", foam: "Hybrid Memory Foam & Pocket Spring", sizes: [["36x75", 13495], ["48x75", 16995], ["54x75", 18995], ["60x75", 19995], ["72x78", 24995]] },
];
// MARAMIHANG SIZE (2026-08-23): isang product = isang modelo, na may ilang
// size na pwedeng bilhin (katulad ng Linen by PAN sheet). Isang size → "Size:
// 36x75"; marami → "Sizes: 36x75 ₱7,100 · 48x75 ₱8,650 · …" (may presyo kada
// size para ang site ay makapagpakita ng Size dropdown). BUKAS ang presyo kada
// size at ang kapal — ang MATTRESS_MODELS ay default lang; ang tinype ng staff
// ang nasusulat. Ang presyo ng product = pinakamababa sa napili ("starting").
export type MatState = { model: string; sizes: string[]; thick?: string; prices?: Record<string, number> };
export function matThick(s: MatState): string {
  const m = MATTRESS_MODELS.find((x) => x.name === s.model);
  return (s.thick ?? "").trim() || m?.thick || "";
}
export function matPicked(s: MatState): [string, number][] {
  const m = MATTRESS_MODELS.find((x) => x.name === s.model);
  if (!m) return [];
  return m.sizes.filter(([sz]) => s.sizes.includes(sz)).map(([sz, p]) => [sz, s.prices?.[sz] ?? p] as [string, number]);
}
export function matPrice(s: MatState): number {
  const p = matPicked(s).map(([, price]) => price).filter((n) => n > 0);
  return p.length ? Math.min(...p) : 0;
}
export function composeMatSpecs(s: MatState): string {
  const m = MATTRESS_MODELS.find((x) => x.name === s.model);
  if (!m) return "";
  const L = [`Model: ${m.name}`];
  const picked = matPicked(s);
  if (picked.length === 1) L.push(`Size: ${picked[0][0]}`);
  else if (picked.length > 1) L.push(`Sizes: ${picked.map(([sz, p]) => `${sz} ₱${p.toLocaleString("en-PH")}`).join(" · ")}`);
  const t = matThick(s);
  if (t) L.push(`Thickness: ${t} inches`);
  L.push(`Foam Type: ${m.foam}`);
  return L.join("\n");
}
// Ibalik ang buong MatState mula sa naka-save na specs: sizes (Size:/Sizes:),
// presyo kada size (sa Sizes: line), at kapal (Thickness: N inches).
export function parseMatState(text: string, model: string): MatState {
  const sizes = parseMatSizes(text);
  const prices: Record<string, number> = {};
  const many = /^Sizes:\s*(.+)$/m.exec(text ?? "")?.[1] ?? "";
  for (const part of many.split(/\s*·\s*/)) {
    const mm = /^(\S+)\s+₱?\s*([\d,]+(?:\.\d+)?)/.exec(part.trim());
    if (mm) prices[mm[1]] = Number(mm[2].replace(/,/g, ""));
  }
  const thick = /^Thickness:\s*(\d+(?:\.\d+)?)/m.exec(text ?? "")?.[1] ?? "";
  return { model, sizes, thick, prices };
}
// Mga size mula sa naka-save na specs ("Size: 36x75" o "Sizes: 36x75 ₱7,100 · …").
export function parseMatSizes(text: string): string[] {
  const one = /^Size:\s*(.+)$/m.exec(text ?? "")?.[1]?.trim();
  if (one) return [one.split(/\s+/)[0]];
  const many = /^Sizes:\s*(.+)$/m.exec(text ?? "")?.[1] ?? "";
  return many.split(/\s*·\s*/).map((t) => t.trim().split(/\s+/)[0]).filter(Boolean);
}

// Espesyal na prefix ng bed categories (PBED/CBED) — para hindi magbanggaan
// ang "Custom Bed" (CUSTOM…) sa Customized at kita agad ang pagkakaiba.
const SKU_PREFIX_OVERRIDE: Record<string, string> = { "Promo Bed": "PBED", "Custom Bed": "CBED" };
function genCustomSku(category = "Customized"): string {
  // Prefix mula sa CATEGORY, cap sa 6 chars — kaya "CUSTOM", "PROMO", "SOFA",
  // "MATTRE"… kita agad sa SKU kung saang category ito.
  const prefix = SKU_PREFIX_OVERRIDE[category.trim()]
    ?? (category.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6) || "CUSTOM");
  const stamp = Math.floor(Date.now() / 1000).toString(36).toUpperCase();
  return `${prefix}-${stamp}`;
}


// Bed options panel — inaprubahang "refined UI" (2026-08-17): numbered group
// cards (1 Bed Setup · 2 Finish · 3 Add-ons), label sa kaliwa + chips sa kanan,
// live summary sa header ng bawat card. Bawat pindot ay agad naisusulat sa
// specs string. Ang card/row ay plain function calls (hindi nested components)
// para hindi nawawala ang focus ng inputs sa bawat keystroke.
export function BedOptionsPanel({ b, upd }: { b: BedState; upd: (p: Partial<BedState>) => void }) {
  const chip = (on: boolean, err = false) =>
    `rounded-full border px-2.5 py-1 text-[10px] font-bold ${err ? "border-rose-300 bg-rose-50 text-rose-700" : on ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-surface text-muted hover:bg-stone-100"}`;
  const seg = (on: boolean) =>
    `flex-1 px-2 py-1.5 text-[11px] font-bold ${on ? "bg-[#4a3b1a] text-[#f4ead8]" : "bg-surface text-muted hover:bg-stone-100"}`;
  // STEPPER — − / halaga / + at unit chip. Ginagamit ng tatlong sukat ng
  // dingding: ang mga ito ay inaayos nang paunti-unti, hindi tinatype nang buo.
  const stepper = (val: string, set: (v: string) => void) => {
    // KALAHATING PULGADA ang hakbang, gaya ng ibang measurement dito — ang
    // kapal ng dingding ay bihirang buong pulgada. Ang "2 ½" ay parehong
    // nababasa at naitatala.
    const cur = parseHalfStr(val) || 0;
    const bump = (d: number) => set(fmtHalf(Math.max(0, cur + d * 0.5)));
    const sb = "flex h-9 w-8 items-center justify-center rounded-lg border border-border bg-surface text-base font-bold text-muted hover:bg-stone-100";
    return (
      <div className="flex items-stretch gap-1">
        <button type="button" className={sb} onMouseDown={(e) => { e.preventDefault(); bump(-1); }}>−</button>
        <input
          // Ang blangko ay ipinapakitang 0 (o ang sinusundan nitong sukat) at
          // kupas — nakikita ang itatalang halaga, hindi lang paalala.
          value={val === "" ? "0" : val}
          // Tinatanggap ang "3", "3.5", "3 ½" at "3 1/2".
          onChange={(e) => set(e.target.value.replace(/[^\d.½/ ]/g, ""))}
          onMouseDown={(e) => e.stopPropagation()}
          className={`${inp} h-9 w-16 text-center text-sm font-bold ${val === "" ? "text-muted" : ""}`}
        />
        <button type="button" className={sb} onMouseDown={(e) => { e.preventDefault(); bump(1); }}>+</button>
        <span className="flex h-9 shrink-0 items-center rounded-lg bg-[#4a3b1a] px-2.5 text-[10.5px] font-extrabold text-[#f4ead8]">in</span>
      </div>
    );
  };

  const unitBtn = (on: boolean, first: boolean) =>
    `px-2.5 py-1.5 text-[10.5px] font-extrabold ${first ? "" : "border-l border-border"} ${on ? "bg-[#4a3b1a] text-[#f4ead8]" : "bg-surface text-muted hover:bg-stone-100"}`;
  const card = (n: string, t: string, sum: string, body: ReactNode) => (
    <div className="mt-2 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-[#faf5e9] px-2.5 py-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#4a3b1a] text-[9px] font-extrabold text-[#f4ead8]">{n}</span>
        <span className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#5a4718]">{t}</span>
        <span className={`ml-auto min-w-0 truncate text-right text-[10px] ${sum ? "font-bold text-[#8a6a1f]" : "font-normal text-stone-300"}`}>{sum || "—"}</span>
      </div>
      <div className="px-2.5 pb-2">{body}</div>
    </div>
  );
  const row = (l: string, body: ReactNode, opts?: { sub?: string; first?: boolean; dim?: boolean }) => (
    <div className={`grid grid-cols-[112px_1fr] items-center gap-2 py-1.5 ${opts?.first ? "" : "border-t border-dashed border-stone-200"}`}>
      <span className={`text-[10.5px] font-semibold leading-tight ${opts?.dim ? "text-muted" : "text-[#3a2e14]"}`}>
        {l}
        {opts?.sub && <span className="block text-[8.5px] font-normal text-muted">{opts.sub}</span>}
      </span>
      <div className="min-w-0">{body}</div>
    </div>
  );
  const sizes = b.btype === "Promo" ? BED_SIZES_PROMO : BED_SIZES_CUSTOM;
  const fbErr = bedFbErr(b);
  const pullBad = bedPullErr(b);
  const bothErr = bedBothErr(b);
  // 4 built-in drawers (lib/bed-rules): chip sa malalaking sukat lang; kapag
  // pinili, nawawala ang ibang add-on rows at may disclaimer na kapalit.
  const four = b.drawer === FOUR_DRAWERS;
  const fourOk = fourDrawerSizeOk(b.size);
  const fourErr = bedFourErr(b);
  // LIFT STORAGE naka-on → naka-lock ang ibang add-ons maliban sa Tufted
  // footboard (hiling ng team 2026-08-18).
  const liftLock = b.lift;
  const leatherErr = b.btype === "Custom" && b.lift && /leather/i.test(b.uph);
  // Floating legs / mattress insert / double walling vs storage, at ang Winged
  // na walang headboard (team 2026-08-21).
  const storageErr = bedStorageErr(b);
  const wingErr = bedWingErr(b);
  const noStorage = bedNoStorage(b);
  const sum1 = `${b.size.replace(/ \d+X\d+$/, "")} · ${b.build === "Add-ons" ? "With Add-ons" : "Knockdown"}`;
  const sum2 = b.btype === "Promo" ? [b.fabric, b.design].filter(Boolean).join(" · ") : b.uph.trim();
  const sum3 = [
    b.drawer && !fbErr && b.drawer.replace(/ drawers?$/, ""),
    b.pull && !pullBad && !bothErr && `Pullout ${b.pull}`,
    b.lift && "Lift",
    b.tuft && (b.tuft === "Tufted Footboard" ? "Tufted" : "Elevated"),
  ].filter(Boolean).join(" · ");
  return (
    <div>
      {/* ── 1 · BED SETUP ── */}
      {card("1", "Bed Setup", sum1, (
        <>
          {row("Build", (
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["Knockdown", "Add-ons"] as const).map((t, i) => (
                <button key={t} type="button" className={`${seg(b.build === t)} ${i > 0 ? "border-l border-border" : ""}`} onMouseDown={(e) => { e.preventDefault(); upd({ build: t }); }}>{t === "Knockdown" ? "Knockdown · no add-ons" : "With Add-ons"}</button>
              ))}
            </div>
          ), { first: true })}
          {row("Size", (
            <div className="flex flex-wrap gap-1">
              {sizes.map((sz) => (
                <button key={sz} type="button" className={chip(b.size === sz)} onMouseDown={(e) => { e.preventDefault(); upd({ size: sz }); }}>{sz}</button>
              ))}
            </div>
          ))}
          {/* NONE Headboard (Custom lang, hiling ng team 2026-08-18). */}
          {b.btype === "Custom" && row("Headboard", (
            <div className="flex flex-wrap gap-1">
              {(["With Headboard", "None"] as const).map((f) => (
                <button key={f} type="button" className={chip((f === "None") === b.noHb)} onMouseDown={(e) => { e.preventDefault(); // Walang headboard = walang mabibigyan ng pakpak at walang
                  // lalagpasan (team 2026-08-21). Nililinis ang mga halaga, hindi
                  // lang itinatago — kung hindi, tahimik silang bumabalik pagbalik
                  // ng headboard.
                  upd(f === "None" ? { noHb: true, winged: "", hbX: "" } : { noHb: false }); }}>{f}</button>
              ))}
            </div>
          ))}
          {!(b.btype === "Custom" && b.noHb) && row("Headboard Height", (
            <div className="flex items-center gap-2 rounded-md border border-dashed border-[#caa45a] bg-[#faf5e9] px-2 py-1">
              <span className="rounded border border-[#caa45a] bg-white px-1 text-[8px] font-extrabold uppercase text-[#8a6a1f]">Auto</span>
              <input value={b.hbAuto} onChange={(e) => upd({ hbAuto: e.target.value })} onMouseDown={(e) => e.stopPropagation()} className="w-full min-w-0 flex-1 border-0 border-b border-dashed border-border bg-transparent text-xs font-semibold outline-none" />
            </div>
          ), { sub: "automatic — editable" })}
        </>
      ))}

      {/* ── 2 · FINISH ── */}
      {card("2", "Finish", sum2, b.btype === "Promo" ? (
        <>
          {row("Fabric", (
            <div className="flex flex-wrap gap-1">
              {["Beige", "Gray"].map((f) => (
                <button key={f} type="button" className={chip(b.fabric === f)} onMouseDown={(e) => { e.preventDefault(); upd({ fabric: b.fabric === f ? "" : f }); }}>{f}</button>
              ))}
            </div>
          ), { first: true })}
          {row("Design", (
            <div className="flex flex-wrap gap-1">
              {["Banana", "Pumpkin", "Pineapple"].map((f) => (
                <button key={f} type="button" className={chip(b.design === f)} onMouseDown={(e) => { e.preventDefault(); upd({ design: b.design === f ? "" : f }); }}>{f}</button>
              ))}
            </div>
          ))}
        </>
      ) : (
        <>
          {row("Upholstered Finish", (
            <input value={b.uph} onChange={(e) => upd({ uph: e.target.value })} onMouseDown={(e) => e.stopPropagation()} placeholder="Type the fabric — it shows on the sheet" className={`${inp} w-full text-xs`} />
          ), { sub: "typed — shows on the sheet", first: true })}
          <p className="pb-1 text-[9.5px] text-[#7a5c14]">Leather: not applicable on any Lift Storage bed. Boucle fabric: additional cost (manual).</p>
          {leatherErr && <p className="mb-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10.5px] font-semibold text-rose-700">Leather + Lift Storage — not allowed. Change the fabric or remove Lift Storage.</p>}
        </>
      ))}

      {/* ── 3 · ADD-ONS ── */}
      {b.build === "Add-ons" && card("3", "Add-ons", sum3, (
        <>
          {/* LIFT STORAGE muna — pag naka-on, naka-lock ang drawers/pullout
              (Tufted na lang ang pwedeng idagdag, ayon sa team 2026-08-18). */}
          {!four && row("Lift Storage", (
            <div className="flex flex-wrap items-center gap-2">
              {/* AUTO-BAN (team 2026-08-19): leather ang fabric → hindi mao-on
                  ang Lift Storage; palitan muna ang tela. */}
              <button
                type="button"
                className={chip(b.lift, !b.lift && b.btype === "Custom" && /leather/i.test(b.uph))}
                title={!b.lift && b.btype === "Custom" && /leather/i.test(b.uph) ? "Leather fabric — not allowed with Lift Storage" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!b.lift && b.btype === "Custom" && /leather/i.test(b.uph)) return; // leather = bawal mag-lift
                  upd(b.lift ? { lift: false, legs: "Standard" } : { lift: true, legs: "Platform Style", drawer: "", dpos: [], pull: "", pside: "" });
                }}
              >Lift Storage{b.lift ? " ✓" : ""}</button>
              {b.lift && <span className="text-[9.5px] text-[#7a5c14]">Legs are auto Platform Style · only Tufted can be added</span>}
              {!b.lift && b.btype === "Custom" && /leather/i.test(b.uph) && <span className="text-[9.5px] font-semibold text-rose-700">not allowed with leather — change the fabric first</span>}
            </div>
          ), { first: true })}

          <div className={liftLock || noStorage ? "pointer-events-none opacity-40" : ""}>
            {row("Drawers", (
              <div className="flex flex-wrap gap-1">
                {["2 built-in drawers", ...(fourOk || four ? [FOUR_DRAWERS] : []), "1 big drawer", "1 small drawer"].map((f) => (
                  <button key={f} type="button" className={chip(b.drawer === f)} onMouseDown={(e) => { e.preventDefault(); upd(b.drawer === f ? { drawer: "", ...(f === FOUR_DRAWERS && b.dnote === FOUR_DRAWERS_NOTE ? { dnote: "" } : {}) } : f === FOUR_DRAWERS ? { drawer: f, pull: "", pside: "", lift: false, insert: "", dwall: false, tuft: "", matt: "", dnote: FOUR_DRAWERS_NOTE } : { drawer: f }); }}>{f.replace(" drawers", "").replace(" drawer", "")}</button>
                ))}
              </div>
            ))}
            {b.drawer && (
              <>
                {/* Saan ilalagay ang drawer. Ang tanging bawal ay ang hiniling
                    ng team: dalawang drawer sa footboard ng Single/Twin. */}
                {row("position", (
                  <div className="flex flex-wrap gap-1">
                    {["Left", "Right", "Footboard"].map((f) => (
                      <button key={f} type="button" className={chip(b.dpos.includes(f), f === "Footboard" && fbErr)} onMouseDown={(e) => { e.preventDefault(); upd({ dpos: b.dpos.includes(f) ? b.dpos.filter((x) => x !== f) : [...b.dpos, f] }); }}>{f}</button>
                    ))}
                  </div>
                ), { dim: true })}
                <div className="pb-1.5 pl-[120px]">
                  {fourErr && <p className="mb-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10.5px] font-semibold text-rose-700">4 built-in drawers — Full Double, Queen or King only. Pick a bigger size or fewer drawers.</p>}
                  {fbErr && <p className="mb-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10.5px] font-semibold text-rose-700">2 built-in drawers — do not fit the footboard on Single/Twin. Pick Left/Right, a bigger size, or 1 drawer.</p>}
                  <input value={b.dnote} onChange={(e) => upd({ dnote: e.target.value })} onMouseDown={(e) => e.stopPropagation()} placeholder="Specific note — e.g. towards the footboard" className={`${inp} w-full text-xs`} />
                </div>
              </>
            )}
            {four && row("Add-ons", (<p className="text-[10.5px] font-semibold text-amber-700">No other add-ons will reflect with 4 built-in drawers.</p>), { dim: true })}
            {!four && row("Pullout Bed", (
              <div className="flex flex-wrap gap-1">
                {["30X70", "36X70", "48X70", "54X70"].map((f) => {
                  const bad = parseInt(f, 10) >= bedWidth(b.size);
                  return (
                    <button key={f} type="button" className={chip(b.pull === f && !bad, b.pull === f && bad)} onMouseDown={(e) => { e.preventDefault(); upd({ pull: b.pull === f ? "" : f }); }}>{f}</button>
                  );
                })}
              </div>
            ))}
            {b.pull && (
              <div className="pb-1.5 pl-[120px]">
                {pullBad
                  ? <p className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10.5px] font-semibold text-rose-700">{b.pull} — does not fit {b.size}. A bigger bedframe is needed.</p>
                  : bothErr
                    ? <p className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10.5px] font-semibold text-rose-700">Full Double fits drawers OR a pullout — not both. Remove one, or move up to Queen for both.</p>
                    : <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10.5px] font-semibold text-emerald-700">{b.pull} — fits {b.size}.</p>}
              </div>
            )}
            {b.pull && !pullBad && !bothErr && row("side", (
              <div className="flex flex-wrap gap-1">
                {["Left", "Right"].map((f) => (
                  <button key={f} type="button" className={chip(b.pside === f)} onMouseDown={(e) => { e.preventDefault(); upd({ pside: b.pside === f ? "" : f }); }}>{f}</button>
                ))}
              </div>
            ), { dim: true })}
          </div>
          {storageErr && <p className="mb-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10.5px] font-semibold text-rose-700">{/floating/i.test(b.legs) ? "Floating legs" : `A ${b.insert} mattress insert`} — no drawers, pullout or lift storage. Remove the add-on, or switch this back.</p>}
          {wingErr && <p className="mb-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10.5px] font-semibold text-rose-700">Winged — needs a headboard. Turn off None headboard, or pick Not winged.</p>}
          {row("Legs", (
            <div className="flex flex-wrap gap-1">
              {["Standard", "Platform Style", "Floating"].map((f) => (
                <button
                  key={f}
                  type="button"
                  className={chip(b.legs === f, b.dwall && !/platform/i.test(f))}
                  // Ang Floating ay nagbubura ng storage: nakabitin ang frame,
                  // kaya wala itong mapaglalagyan (team 2026-08-21).
                  title={b.dwall && !/platform/i.test(f) ? "Double walling is platform style" : undefined}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    // Naka-lock sa Platform habang may double walling.
                    if (b.dwall && !/platform/i.test(f)) return;
                    upd(/floating/i.test(f) ? { legs: f, drawer: "", dpos: [], pull: "", pside: "", lift: false } : { legs: f });
                  }}
                >
                  {f}{f === "Platform Style" ? " (not lift)" : f === "Floating" ? " (no storage)" : ""}
                </button>
              ))}
            </div>
          ))}
          {/* MATTRESS INSERT — nakalubog na kutson; kinakain nito ang lalim na
              kailangan ng storage, kaya "None" lang ang pumapayag ng drawers,
              pullout at lift (team 2026-08-21). */}
          {!four && row("Mattress Insert", (
            <div className="flex flex-wrap gap-1">
              {["", "4\"", "5\"", "6\""].map((f) => (
                <button
                  key={f || "none"}
                  type="button"
                  className={chip(b.insert === f)}
                  onMouseDown={(e) => { e.preventDefault(); upd(f ? { insert: f, drawer: "", dpos: [], pull: "", pside: "", lift: false } : { insert: "" }); }}
                >
                  {f || "None"}
                </button>
              ))}
              <span className="self-center pl-1 text-[9.5px] text-muted">Standard 2&quot; when none.</span>
            </div>
          ))}
          {!four && row("Footboard", (
            <div className="flex flex-wrap gap-1">
              {(b.btype === "Custom" ? ["Tufted Footboard", "Tufted Elevated Footboard"] : ["Tufted Footboard"]).map((f) => (
                <button key={f} type="button" className={chip(b.tuft === f)} onMouseDown={(e) => { e.preventDefault(); upd({ tuft: b.tuft === f ? "" : f }); }}>{f === "Tufted Elevated Footboard" ? "Tufted Elevated" : "Tufted"}</button>
              ))}
            </div>
          ))}
          {b.tuft === "Tufted Footboard" && <p className="pb-1 pl-[120px] text-[9.5px] text-muted">Same design as the headboard.</p>}
          {/* DOUBLE WALLING — nasa LABAS ng storage lock: pinapayagan ito
              kasama ng Lift Storage (team, 2026-08-21), at parehong nagtatakda
              ng Platform Style na legs. Hindi nito pinapatay ang Lift. */}
          {!four && row("Double Walling", (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                className={chip(b.dwall)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  upd(b.dwall
                    ? { dwall: false, ...(b.lift ? {} : { legs: "Standard" }) }
                    : { dwall: true, legs: "Platform Style", drawer: "", dpos: [], pull: "", pside: "" });
                }}
              >
                Double Walling{b.dwall ? " ✓" : ""}
              </button>
              {/* Ang kapal ng dingding ay bahagi ng desisyong ito, hindi
                  hiwalay na tanong — at ito ang nagtatakda ng sukat ng frame.
                  Katabi ito para hindi malito sa Thickness ng padding sa ibaba. */}
              {b.dwall && WALL_THICKNESSES.map((t) => (
                <button key={t} type="button" className={chip(b.dwThick === t)} onMouseDown={(e) => { e.preventDefault(); upd({ dwThick: t }); }}>{t}&quot;</button>
              ))}
            </div>
          ))}
          {/* Ang kapal ng dingding ang nagdedesisyon ng sukat ng FRAME — doon
              humihiwa ang workshop, hindi sa sukat ng kutson. Ang talaan ay
              galing mismo sa team (lib/double-walling), hindi hinuhulaan. */}
          {b.dwall && (
            <>
              {/* ANG SUKAT NA HIHIWAIN. Ang kutson ang inorder, ang frame ang
                  ginagawa — magkatabi para hindi mapagkamalan ang isa sa isa.
                  Kaparehong hulma ng add-on row: rounded border, px-4 py-3. */}
              {(() => {
                const f = frameFor(b.size, b.dwThick);
                if (!f) return null;
                const m = /(\d+)\s*[xX]\s*(\d+)/.exec(b.size);
                return (
                  <div className="mb-1.5 ml-[120px] overflow-hidden rounded border border-[#caa45a]">
                    <div className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm">
                      <span className="min-w-0 flex-1 text-muted">Mattress size</span>
                      <span className="shrink-0 font-mono tabular-nums">
                        {m ? `${m[1]} × ${m[2]}` : b.size}
                        <span className="ml-1 font-sans text-xs text-muted">in</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-3 bg-[#faf5e9] px-4 py-3 text-sm">
                      <span className="min-w-0 flex-1 font-semibold text-[#8a6a1f]">Frame Dimension</span>
                      <span className="shrink-0 font-mono font-bold tabular-nums">
                        {f.w} × {f.l}
                        <span className="ml-1 font-sans text-xs font-normal text-muted">in</span>
                      </span>
                    </div>
                  </div>
                );
              })()}
              {row("Height", stepper(b.dwH, (v) => upd({ dwH: v })), { dim: true })}
              {row("Thickness", (
                <div className="flex flex-wrap items-center gap-2">
                  {stepper(b.dwPad, (v) => upd({ dwPad: v }))}
                </div>
              ), { dim: true })}
              {row("Width", (
                <div className="flex flex-wrap items-center gap-2">
                  {stepper(b.dwW, (v) => upd({ dwW: v }))}
                </div>
              ), { dim: true })}
              {row("Decorative nails", (
                <div className="flex flex-wrap gap-1">
                  {["Gold", "Silver"].map((n) => (
                    <button key={n} type="button" className={chip(b.dwNails === n)} onMouseDown={(e) => { e.preventDefault(); upd({ dwNails: b.dwNails === n ? "" : n }); }}>{n}</button>
                  ))}
                  <button type="button" className={chip(b.dwAccent)} onMouseDown={(e) => { e.preventDefault(); upd({ dwAccent: !b.dwAccent }); }}>Gold accent{b.dwAccent ? " ✓" : ""}</button>
                </div>
              ), { dim: true })}
            </>
          )}

          {b.tuft === "Tufted Elevated Footboard" && row("Mattress Thickness", (
            <div className="flex items-center gap-1.5">
              <input value={b.matt} onChange={(e) => upd({ matt: e.target.value })} onMouseDown={(e) => e.stopPropagation()} placeholder="e.g. 8" className={`${inp} w-20 text-xs`} />
              <span className="flex shrink-0 overflow-hidden rounded-lg border border-border">
                {["inches", "cm"].map((u, ui) => (
                  <button key={u} type="button" className={unitBtn(b.mattU === u, ui === 0)} onMouseDown={(e) => { e.preventDefault(); upd({ mattU: u }); }}>{u === "inches" ? "in" : u}</button>
                ))}
              </span>
            </div>
          ), { sub: "pag elevated" })}
          {b.btype === "Custom" && !b.noHb && (
            <>
              {row("Winged Headboard", (
                <div className="flex flex-wrap gap-1">
                  {["Winged", "Not winged"].map((u) => (
                    <button key={u} type="button" className={chip(b.winged === u)} onMouseDown={(e) => { e.preventDefault(); upd({ winged: b.winged === u ? "" : u }); }}>{u}</button>
                  ))}
                </div>
              ))}
              {row("Headboard Height", (
                <div className="flex items-center gap-1.5">
                  <input value={b.hbH} onChange={(e) => upd({ hbH: e.target.value })} onMouseDown={(e) => e.stopPropagation()} placeholder="____" className={`${inp} w-20 text-xs`} />
                  <span className="flex shrink-0 overflow-hidden rounded-lg border border-border">
                    {["inches", "ft"].map((u, ui) => (
                      <button key={u} type="button" className={unitBtn(b.hbHU === u, ui === 0)} onMouseDown={(e) => { e.preventDefault(); upd({ hbHU: u }); }}>{u === "inches" ? "in" : u}</button>
                    ))}
                  </span>
                </div>
              ), { sub: "manual measurement" })}
              {/* Gaano kataas lumagpas ang headboard sa bedframe. Ang MTO
                  Configurator ay may nakatakdang pagpipilian (None/2"/4"/6"),
                  kaya pareho rin dito — iisang pananalita ang dumadaloy mula sa
                  pag-encode hanggang sa website. */}
              {row("Exceed Headboard", (
                <div className="flex flex-wrap gap-1">
                  {["", '2"', '4"', '6"'].map((f) => (
                    <button key={f || "none"} type="button" className={chip(b.hbX === f)} onMouseDown={(e) => { e.preventDefault(); upd({ hbX: f }); }}>{f || "None"}</button>
                  ))}
                </div>
              ))}
            </>
          )}
        </>
      ))}
      <p className="pt-1 text-[10px] text-muted">Every selection writes straight to the specs.</p>
    </div>
  );
}

// Mattress panel — parehong group-card style: 1 Model (auto thickness/foam),
// 2 Size (may presyo sa chip, auto-fill sa Price).
// DALAWANG TRABAHO, DALAWANG GAWI (2026-08-26).
//
// Sa PRODUCT MANAGEMENT, ito ay editor ng listing: tinatakan ang LAHAT ng size
// na ipinagbibili at tinitipa ang presyo ng bawat isa. Sa CREATE ORDER, ang
// tanong ay iba — aling size ang binibili ng customer? — at isa lang ang sagot.
//
// Iisa ang gawi noon: checkbox kada size at bukas na inputan ng presyo. Kaya sa
// Create Order ay maaaring makapili ng lima, at ang presyo ng katalogo ay
// maaaring tipahan nang iba sa pagitan ng pagkuha ng order.
//
// `mode="order"` = radio, walang inputan: ang presyo ay galing sa katalogo.
export function MattressPanel({ s, onModel, onSize, onThick, onPrice, mode = "catalog" }: {
  s: MatState;
  onModel: (name: string) => void;
  onSize: (size: string) => void;
  onThick?: (thick: string) => void;
  onPrice?: (size: string, price: number | null) => void;
  mode?: "catalog" | "order";
}) {
  const m = MATTRESS_MODELS.find((x) => x.name === s.model);
  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-1.5 text-[10px] font-bold ${on ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-surface text-muted hover:bg-stone-100"}`;
  const card = (n: string, t: string, sum: string, body: ReactNode) => (
    <div className="mt-2 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-[#faf5e9] px-2.5 py-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#4a3b1a] text-[9px] font-extrabold text-[#f4ead8]">{n}</span>
        <span className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#5a4718]">{t}</span>
        <span className={`ml-auto min-w-0 truncate text-right text-[10px] ${sum ? "font-bold text-[#8a6a1f]" : "font-normal text-stone-300"}`}>{sum || "—"}</span>
      </div>
      <div className="px-2.5 py-2">{body}</div>
    </div>
  );
  const numBox = "h-7 rounded border border-border bg-white px-2 text-right text-[11px] font-bold tabular-nums outline-none focus:border-primary";
  const picked = matPicked(s);
  return (
    <div>
      {card("1", "Model", s.model.replace(/^Uratex /, ""), (
        <>
          {/* ANG MODEL AY HINDI MAPIPILI SA ORDER (2026-08-26). Ang bawat model
              ay HIWALAY na produkto sa katalogo — Airlite Wind, Trill Air, Trill
              Regal. Ang pagpili sa mga chip ay nagpapalit ng model sa loob ng
              piniling produkto, kaya ang linya ay nagsasabing "Trill Air" habang
              ang produkto ay Airlite Wind at ang presyo ay sa Airlite pa rin.
              Sa Create Order, ang produkto na ang nagpasya — size na lang ang
              tanong. */}
          {mode === "order" ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-bold text-[#3a2e14]">{s.model.replace(/^Uratex /, "")}</span>
              {m && <span className="text-[10px] text-muted">{matThick(s) || m.thick}" · {m.foam}</span>}
            </div>
          ) : (
          <div className="flex flex-wrap gap-1">
            {MATTRESS_MODELS.map((x) => (
              <button key={x.name} type="button" className={chip(s.model === x.name)} onMouseDown={(e) => { e.preventDefault(); onModel(x.name); }}>
                {x.name.replace(/^Uratex /, "")} <span className="font-normal opacity-75">{x.thick}"</span>
              </button>
            ))}
          </div>
          )}
          {m && mode === "catalog" && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[9.5px] text-[#7a5c14]">
              <span className="font-bold">Thickness</span>
              <input
                value={s.thick ?? ""}
                placeholder={m.thick}
                inputMode="decimal"
                onChange={(e) => onThick?.(e.target.value.replace(/[^0-9.]/g, ""))}
                className={`${numBox} w-14`}
              />
              <span>inches · Foam Type: {m.foam}</span>
            </div>
          )}
        </>
      ))}
      {card("2", mode === "order" ? "Size" : "Sizes & Prices", (() => {
        if (!picked.length) return "";
        if (picked.length === 1) return `${picked[0][0]} · ₱${picked[0][1].toLocaleString("en-PH")}`;
        return `${picked.length} sizes · from ₱${matPrice(s).toLocaleString("en-PH")}`;
      })(), (
        m ? (
          <>
            <div className="overflow-hidden rounded-md border border-border">
              <div className="grid grid-cols-[26px_1fr_160px] items-center gap-2 bg-stone-50 px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.1em] text-muted">
                <span />
                <span>Size</span>
                <span className="text-right">Price (₱)</span>
              </div>
              {m.sizes.map(([sz, catalogPrice]) => {
                const on = s.sizes.includes(sz);
                const v = s.prices?.[sz];
                const order = mode === "order";
                return (
                  <div key={sz} className={`grid grid-cols-[26px_1fr_160px] items-center gap-2 border-t border-dashed border-stone-200 px-2 py-1 ${on ? "" : "opacity-60"}`}>
                    <button
                      type="button"
                      role={order ? "radio" : "checkbox"}
                      aria-checked={on}
                      aria-label={order ? `Order ${sz}` : `Sell ${sz}`}
                      onMouseDown={(e) => { e.preventDefault(); onSize(sz); }}
                      className={`flex h-4 w-4 items-center justify-center border text-[10px] leading-none ${order ? "rounded-full" : "rounded"} ${on ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-white text-transparent hover:border-primary"}`}
                    >
                      {order ? "●" : "✓"}
                    </button>
                    <span className="text-[11px] font-bold">{sz}</span>
                    {order ? (
                      // ANG PRESYO AY GALING SA KATALOGO. Bukas na inputan ito
                      // noon, kaya maaaring maiba ang presyo sa pagitan ng
                      // pagkuha ng order — ang diskwento ay sa Price na field sa
                      // ibaba, kung saan iisang halaga ang nababago at kita.
                      <span className="text-right text-[11px] font-bold tabular-nums text-[#3a2e14]">
                        ₱{(v ?? catalogPrice).toLocaleString("en-PH")}
                      </span>
                    ) : (
                      <input
                        disabled={!on}
                        value={v != null ? v.toLocaleString("en-PH") : ""}
                        placeholder={on ? "0" : "—"}
                        inputMode="numeric"
                        onChange={(e) => { const d = e.target.value.replace(/[^0-9]/g, ""); onPrice?.(sz, d === "" ? null : Number(d)); }}
                        className={`${numBox} w-full disabled:bg-stone-50`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[9.5px] text-muted">
              {mode === "order"
                ? "Pick the size the customer is buying — the price follows the catalogue. Discounts go in the Price field below."
                : "Tick every size this listing sells and type its price. The site shows them as size buttons with each price."}
            </p>
          </>
        ) : (
          <p className="text-[10.5px] text-muted">Pick a model first.</p>
        )
      ))}
      {mode === "catalog" && (
        <p className="pt-1 text-[10px] text-muted">Product price auto-fills from the lowest picked size (starting price) — still editable for discounts.</p>
      )}
    </div>
  );
}

export type LineItem = {
  qty: number;
  description: string;
  unitPrice: number;
  image?: string | null;
  sku?: string | null;
  category?: string | null;
  color?: string | null;
  dimension?: string | null;
  workshop?: string | null;        // workshop role of the tagged constructor
  constructorName?: string | null; // tagged constructor → flows to Constructor page as pending
  customized?: boolean;            // true if edited from the original product
  imported?: boolean;              // from an Imported product → unit price is LOCKED
};

type EmpLite = { name: string; role: string };

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const peso2 = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Dimension as L × W × H boxes + unit, synced to the "LxWxH cm" string.
function DimensionBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const m = /^\s*([\d.]*)\s*[x×]\s*([\d.]*)\s*[x×]\s*([\d.]*)\s*([a-z]*)/i.exec(value || "");
  const l = m?.[1] || "", w = m?.[2] || "", h = m?.[3] || "", unit = (m?.[4] || "cm").toLowerCase();
  const push = (nl: string, nw: string, nh: string, nu: string) =>
    onChange((nl || nw || nh) ? `${nl || 0}x${nw || 0}x${nh || 0} ${nu}` : "");
  const clean = (s: string) => s.replace(/[^\d.]/g, "");
  const box = `${inp} w-full text-xs text-center`;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="flex items-center gap-1">
      <input value={l} onMouseDown={stop} onChange={(e) => push(clean(e.target.value), w, h, unit)} inputMode="decimal" placeholder="L" className={box} />
      <span className="text-[10px] text-muted">×</span>
      <input value={w} onMouseDown={stop} onChange={(e) => push(l, clean(e.target.value), h, unit)} inputMode="decimal" placeholder="W" className={box} />
      <span className="text-[10px] text-muted">×</span>
      <input value={h} onMouseDown={stop} onChange={(e) => push(l, w, clean(e.target.value), unit)} inputMode="decimal" placeholder="H" className={box} />
      <select value={unit} onMouseDown={stop} onChange={(e) => push(l, w, h, e.target.value)} className={`${inp} text-xs`}>
        <option value="cm">cm</option><option value="in">in</option><option value="mm">mm</option><option value="m">m</option>
      </select>
    </div>
  );
}

export function LineItemsEditor({
  items,
  onChange,
  products = [],
  stockBySku = {},
  constructors = [],
  buildMode = false,
  hidden = false,
  deliveredKeys = [],
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  products?: ProductRow[];
  stockBySku?: Record<string, { reserved: number; available: number }>;
  constructors?: EmpLite[];
  // PARTIAL DELIVERY (2026-09-02): mga linyang naihatid na sa naunang batch
  // (susi = unang linya ng description, lowercase) — tinatagan ng DELIVERED
  // chip sa Edit Order para kitang alin na ang nasa customer.
  deliveredKeys?: string[];
  // STOCK BUILD (2026-08-24): ipinapagawa lang — walang benta. Itinatago ang
  // presyo, mga bayarin, add-ons at ang maramihang item; ang natitira ay kung
  // ANO ang gagawin at ILAN. Sa Create Order, buo pa rin ang editor.
  buildMode?: boolean;
  // Itinatago ang picker nang hindi binubura ang laman — ginagamit ng Stock
  // Build kapag may napili na (preview ang ipinapakita, may Edit pabalik dito).
  hidden?: boolean;
}) {
  // Group constructors by workshop (role), label stripped of " - Constructor".
  const cGroups = useMemo(() => {
    const m = new Map<string, EmpLite[]>();
    for (const c of constructors) {
      const w = (c.role || "").replace(/\s*-\s*constructor$/i, "").trim() || "Constructor";
      const arr = m.get(w) ?? [];
      arr.push(c); m.set(w, arr);
    }
    return [...m.entries()];
  }, [constructors]);
  const byName = useMemo(() => new Map(constructors.map((c) => [c.name, c])), [constructors]);
  const upd = (i: number, patch: Partial<LineItem>) =>
    onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const add = () => onChange([...items, { qty: 1, description: "", unitPrice: 0 }]);
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));

  // OPTIONAL na per-item FEES (hiling 2026-08-16): Addtl. Shipping Fee at
  // Addtl. Rush Fee — sariling line item pa rin sa data (kaya kasama sa
  // total/resibo), pero sa UI ang bawat isa ay INLINE na maliit na ₱ input sa
  // tabi ng Mark Customized ng item sa itaas nito — hindi buong item row.
  // Blanko/0 = ayos lang; ✕ para tanggalin.
  const FEE_KINDS = ["Addtl. Shipping Fee", "Addtl. Rush Fee"] as const;
  const isFee = (it: LineItem) => (FEE_KINDS as readonly string[]).includes(it.description.trim());
  // Hanapin ang fee row ng KIND na nakakabit sa item i (nasa fee block agad
  // pagkatapos nito); null kung wala pa.
  const feeIndexOf = (i: number, kind: string): number | null => {
    for (let j = i + 1; j < items.length && isFee(items[j]); j++) {
      if (items[j].description.trim() === kind) return j;
    }
    return null;
  };
  const addFee = (kind: string, afterIndex?: number) => {
    const fee = { qty: 1, description: kind, unitPrice: 0 };
    if (afterIndex == null) { onChange([...items, fee]); return; }
    // Isingit sa DULO ng fee block ng item — para magkasunod ang mga fee nito.
    let pos = afterIndex + 1;
    while (pos < items.length && isFee(items[pos])) pos++;
    const next = [...items];
    next.splice(pos, 0, fee);
    onChange(next);
  };

  return (
    <div className={hidden ? "hidden" : "space-y-2"}>
      {/* INALIS ANG "+ Addons" (hiling 2026-08-29). Ang add-on ay maidadagdag
          sa "+ Add item" gaya ng ibang produkto, at ang bayad ay may sariling
          chip kada item ("+ Additional Shipping Fee") — doon ito nakakabit sa
          produktong may dala nito, hindi sa buong order. */}
      {!buildMode && (
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={add} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-stone-100">+ Add item</button>
        </div>
      )}
      {items.map((it, i) => (
        // Ang fee row na may kasamang item sa itaas ay hindi buong row —
        // inline control ito sa footer ng item na iyon (sa ibaba).
        isFee(it) && i > 0 ? null : (
        <div key={i} className={buildMode ? "" : "rounded-lg border border-border p-2"}>
          <div className={buildMode ? "hidden" : "flex gap-2"}>
            {buildMode ? null : (
              <>
                <input type="number" min={0} value={it.qty} onChange={(e) => upd(i, { qty: Number(e.target.value) })} className={`${inp} w-16`} title="Qty" />
                <input type="number" min={0} value={it.unitPrice} readOnly={it.imported} onChange={(e) => { if (it.imported) return; upd(i, { unitPrice: Number(e.target.value), customized: false }); }} className={`${inp} flex-1 ${it.imported ? "cursor-not-allowed bg-stone-100 text-muted" : ""}`} placeholder="Unit Price" title={it.imported ? "Imported product — price is fixed" : undefined} />
                {it.imported && <span className="self-center whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700" title="Imported — fixed price">Imported</span>}
                {hasKey(new Set(deliveredKeys), lineKey(it.description, (it as { color?: string | null }).color)) && (
                  <span className="self-center whitespace-nowrap rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700 ring-1 ring-inset ring-green-600/20" title="Already delivered in an earlier batch">Delivered</span>
                )}
                <span className="self-center whitespace-nowrap text-xs text-muted">= ₱{peso2((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}</span>
              </>
            )}
            {items.length > 1 && <button type="button" onClick={() => remove(i)} className="px-2 text-muted hover:text-danger">✕</button>}
          </div>
          <ProductSearch
            products={products}
            stockBySku={stockBySku}
            cGroups={cGroups}
            byName={byName}
            onPick={(patch) => upd(i, patch)}
            alwaysOpen={buildMode}
          />
          {/* LARAWAN SA KALIWA (hiling 2026-08-29). Ang `image` ay dala na ng
              onPick noon pero hindi kailanman naipapakita rito, kaya ang tanging
              paraan para makita kung tama ang napili ay ang pangalan sa teksto.
              Lumilitaw lang kapag may napili nang may larawan; ang naka-type na
              linya nang walang produkto ay nananatiling buong lapad. */}
          {!buildMode && (
            <div className="mt-2 flex gap-2">
              {it.image && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={it.image} alt="" className="h-48 w-48 shrink-0 rounded-lg border border-border bg-white object-contain p-1" />
              )}
              <AutoTextarea value={it.description} onChange={(v) => upd(i, v.trim() ? { description: v, customized: false } : { description: v, unitPrice: 0, customized: false })} placeholder="Description (one line per detail, e.g. bullets)" className={`${inp} min-w-0 flex-1 resize-none overflow-hidden`} />
            </div>
          )}
          <div className={buildMode ? "hidden" : "mt-1 flex flex-wrap items-center gap-2"}>
            <button
              type="button"
              onClick={() => upd(i, { customized: !it.customized })}
              className={it.customized
                ? "rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                : "rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] font-medium text-muted hover:border-amber-300 hover:text-amber-700"}
              title="Toggle customized tag"
            >
              {it.customized ? "Customized" : "Mark Customized"}
            </button>
            {/* Per-item na optional fees (hiling 2026-08-16): Additional
                Shipping Fee at Additional Rush Fee — INLINE: pindot ang chip →
                lalabas ang maliit na ₱ input dito mismo; ang halaga ay sariling
                fee line sa data (kasama sa total at resibo). ✕ = tanggal. */}
            {!buildMode && !isFee(it) && FEE_KINDS.map((kind) => {
              const j = feeIndexOf(i, kind);
              const short = kind.replace("Addtl. ", "");
              return j != null ? (
                <span key={kind} className="inline-flex items-center gap-1.5 rounded-full border border-[#caa45a] bg-[#faf6ec] px-2 py-0.5">
                  <span className="text-[10px] font-semibold text-[#8a6a1f]">{kind} ₱</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={items[j].unitPrice || ""}
                    onChange={(e) => upd(j, { unitPrice: Number(e.target.value) || 0 })}
                    placeholder="0 (optional)"
                    className="w-24 rounded border border-[#e6dcc4] bg-white px-1.5 py-0.5 text-xs outline-none focus:border-[#caa45a]"
                  />
                  <button type="button" onClick={() => remove(j)} className="text-[11px] text-muted hover:text-danger" title={`Remove the ${short.toLowerCase()}`}>✕</button>
                </span>
              ) : (
                <button
                  key={kind}
                  type="button"
                  onClick={() => addFee(kind, i)}
                  className="rounded-full border border-dashed border-[#caa45a] px-1.5 py-0.5 text-[10px] font-medium text-[#8a6a1f] hover:bg-[#faf6ec]"
                  title={`Optional — add an open-price ${short.toLowerCase()} under this item`}
                >
                  + Additional {short.replace(" Fee", "")} Fee
                </button>
              );
            })}
            {it.constructorName && <span className="text-xs text-muted"><span className="font-medium text-foreground">{it.constructorName}</span>{it.workshop ? ` · ${it.workshop.replace(/\s*-\s*constructor$/i, "")}` : ""}</span>}
          </div>
        </div>
        )
      ))}
      {items.length === 0 && !buildMode && <p className="text-xs text-muted">No items. Click “+ Add item”.</p>}
    </div>
  );
}

function AutoTextarea({ value, onChange, className, placeholder }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);
  return <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} rows={2} placeholder={placeholder} className={className} />;
}

function Spec({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-2 border-b border-border px-2.5 py-1.5 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value || "—"}</span>
    </div>
  );
}

// EXPORTED (2026-09-06): ginagamit din ng Formal Quotation editor ng MTO
// Requests ("+ Add item" mula sa catalog, parehong browser ng Create Order).
export function ProductSearch({ products, stockBySku = {}, onPick, cGroups, byName, alwaysOpen = false }: { products: ProductRow[]; stockBySku?: Record<string, { reserved: number; available: number }>; onPick: (patch: Partial<LineItem>) => void; cGroups: [string, EmpLite[]][]; byName: Map<string, EmpLite>;
  // STOCK BUILD: ang picker MISMO ang pahina — nakabukas agad, walang overlay,
  // at hindi nagsasara. Sa Create Order ito ay modal na binubuksan sa search.
  alwaysOpen?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(alwaysOpen);
  // Sa always-open mode, ang picker ay hindi dapat manatiling sarado kahit
  // anong mangyari sa loob (pagpili, pagsara ng builder) — ito ang mismong
  // nilalaman ng pahina, hindi isang modal.
  useEffect(() => { if (alwaysOpen) setOpen(true); }, [alwaysOpen]);
  const [selCat, setSelCat] = useState<string | null>(null);
  const [hovered, setHovered] = useState<ProductRow | null>(null);
  // Bagong-upload na litrato ng produktong walang image — para makita agad
  // habang hindi pa tapos ang refresh.
  const [imgFix, setImgFix] = useState<{ id: number; url: string } | null>(null);
  const [qty, setQty] = useState(1);
  const s = q.trim().toLowerCase();

  // Search-filtered list (when typing); otherwise all products.
  const list = useMemo(() => {
    if (!s) return products;
    return products.filter((p) => p.product_name?.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s)).slice(0, 100);
  }, [products, s]);

  // Group by category, preserving first-seen order.
  const groups = useMemo(() => {
    const out: [string, ProductRow[]][] = [];
    const idx = new Map<string, ProductRow[]>();
    for (const p of list) {
      const c = (p.category && p.category.trim()) || "Uncategorized";
      let arr = idx.get(c);
      if (!arr) { arr = []; idx.set(c, arr); out.push([c, arr]); }
      arr.push(p);
    }
    return out;
  }, [list]);

  // Active category (left selection); falls back to first available.
  const activeCat = (selCat && groups.some(([c]) => c === selCat)) ? selCat : groups[0]?.[0] ?? null;
  const activeItems = groups.find(([c]) => c === activeCat)?.[1] ?? [];

  // CUSTOMIZED entry — blangkong item na LAHAT ng field ay editable (pati SKU
  // at presyo) at may sariling photo upload; para sa mga made-to-order na wala
  // sa katalogo.
  const [customMode, setCustomMode] = useState(false);
  // ptype: "" hangga't walang pinipili — REQUIRED (hiling 2026-08-17): huwag
  // basta i-tag na Local; ang staff mismo ang pipili ng Local o Imported.
  const [cedit, setCedit] = useState({ sku: genCustomSku("Promo Bed"), name: "", color: "", dimension: "", price: 0, category: "Promo Bed", specs: "", ptype: "" as "" | "Local" | "Imported" });
  // Structured spec rows ng napiling category; null = freeform textarea.
  const [specRows, setSpecRows] = useState<SpecRowVal[] | null>(null);
  // Guided na Bed flow (Promo Bed / Custom Bed categories); null = hindi bed.
  const [bed, setBed] = useState<BedState | null>(null);
  const updBed = (patch: Partial<BedState>) =>
    setBed((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...patch };
      setCedit((p) => ({ ...p, specs: composeBedSpecs(next) }));
      return next;
    });
  const seedBed = (cat: string): BedState => ({ ...BED_DEFAULT, btype: cat === "Custom Bed" ? "Custom" : "Promo" });
  // Guided na Mattress flow (model → size → auto presyo); null = hindi mattress.
  const [mat, setMat] = useState<MatState | null>(null);
  const pickMatModel = (name: string) =>
    setMat(() => {
      const next: MatState = { model: name, sizes: [] };
      setCedit((p) => {
        // Auto ang product name — pero huwag patungan ang sariling tinype.
        const autoName = !p.name.trim() || MATTRESS_MODELS.some((mm) => p.name.trim() === `${mm.name} Mattress`);
        return { ...p, specs: composeMatSpecs(next), name: autoName ? `${name} Mattress` : p.name };
      });
      return next;
    });
  const applyMat = (next: MatState) => {
    const price = matPrice(next);
    setCedit((p) => ({ ...p, specs: composeMatSpecs(next), price: price > 0 ? price : p.price }));
    return next;
  };
  // ISANG SIZE LANG (2026-08-26): ito ay linya ng ORDER — aling size ang
  // binibili, hindi kung alin-alin ang ipinagbibili. Ang pagpili ay pumapalit,
  // at ang muling pagpindot ay hindi nag-aalis: walang linyang walang size.
  const pickMatSize = (size: string) =>
    setMat((cur) => (cur ? applyMat({ ...cur, sizes: [size] }) : cur));
  const setMatThick = (thick: string) => setMat((cur) => (cur ? applyMat({ ...cur, thick }) : cur));
  const setMatPrice = (size: string, price: number | null) =>
    setMat((cur) => {
      if (!cur) return cur;
      const prices = { ...(cur.prices ?? {}) };
      if (price == null) delete prices[size]; else prices[size] = price;
      return applyMat({ ...cur, prices });
    });
  const updSpecRow = (i: number, patch: Partial<SpecRowVal>) =>
    setSpecRows((rows) => {
      if (!rows) return rows;
      const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
      // Laging naka-sync ang specs string — ito ang naka-save/naipi-preview.
      setCedit((p) => ({ ...p, specs: composeSpecs(next) }));
      return next;
    });
  const [cphotos, setCphotos] = useState<string[]>([]);
  // FABRIC LIBRARY sa Color* (hiling 2026-08-17): parehong web_swatches ng
  // Design Details / Website Products — piliin na lang ang tela, hindi na
  // itatype. Lazy-load sa unang buksan.
  const [fabricOpen, setFabricOpen] = useState(false);
  const [fabricQ, setFabricQ] = useState("");
  const [fabricLib, setFabricLib] = useState<WebSwatch[] | null>(null);
  // COLLECTION filter chips (2026-08-19) — ~200 na ang swatch library.
  const [fabricCol, setFabricCol] = useState("");
  const openFabric = () => {
    setFabricOpen((v) => !v);
    if (fabricLib === null) void loadSwatches().then(setFabricLib).catch(() => setFabricLib([]));
  };
  // Ang napiling swatch ay diretso sa tamang destinasyon: Upholstered Finish
  // ng Custom Bed, o ang Fabric/Finish row ng specs; fallback ang color field.
  const pickFabric = (name: string) => {
    if (bed) { if (bed.btype === "Custom") updBed({ uph: name }); return; }
    if (specRows) {
      const idx = specRows.findIndex((r) => /fabric|upholstered/i.test(r.label));
      if (idx >= 0) { updSpecRow(idx, { value: name }); return; }
    }
    setCedit((p) => ({ ...p, color: name }));
  };
  // FABRIC ang pumalit sa dating Color* na requirement (2026-08-17): hango sa
  // specs line; required lang kung may fabric field ang category.
  const fabricLine = /^(?:Fabric(?:\s*\/\s*Finish)?|Upholstered Finish):\s*(.+)$/m.exec(cedit.specs)?.[1]?.trim() ?? "";
  // AUTO-BAN (team 2026-08-20): Sofa at Sofa Bed = bawal ang leather — tago
  // ang leather swatches sa picker at hindi maidadagdag kapag leather ang tela.
  const noLeather = isNoLeatherCategory(cedit.category);
  const leatherPicked = noLeather && /leather/i.test(fabricLine);
  const fabricRequired = bed !== null || (specRows !== null && specRows.some((r) => /fabric|upholstered/i.test(r.label)));
  const fabricMissing = fabricRequired && !fabricLine;

  // Previewed product + its editable (customizable) fields (separate inputs).
  const d = hovered ?? activeItems[0] ?? null;
  const [edit, setEdit] = useState<{ name: string; color: string; dimension: string; price: number; specs: string }>({ name: "", color: "", dimension: "", price: 0, specs: "" });
  // COLOR VARIANTS (0231/0232): ang mga kulay ng produkto; ang napili ay ang
  // Fabric line ng order (isang kulay lang, hindi ang buong listahan) at ang
  // susi ng Reserved/Available kada kulay. Default = unang kulay na may stock.
  const dVariants = useMemo(() => cleanVariants((d as { color_variants?: unknown } | null)?.color_variants), [d]);
  const [pickedColor, setPickedColor] = useState<string | null>(null);
  const [hoverColor, setHoverColor] = useState<string | null>(null);
  const withFabric = (specs: string, nm: string) => (/^(Fabric(\s*\/\s*Finish)?|Upholstered Finish):/m.test(specs)
    ? specs.replace(/^(Fabric(\s*\/\s*Finish)?|Upholstered Finish):.*$/m, `$1: ${nm}`)
    : (specs.trim() ? specs.trimEnd() + "\n" : "") + `Fabric: ${nm}`);
  const applyColor = (nm: string) => {
    setPickedColor(nm);
    setEdit((p) => ({ ...p, color: nm, specs: withFabric(p.specs, nm) }));
  };
  useEffect(() => {
    const base = { name: d?.product_name ?? "", color: d?.color ?? "", dimension: d?.dimension ?? "", price: Number(d?.price ?? 0), specs: d?.specs ?? "" };
    const vs = cleanVariants((d as { color_variants?: unknown } | null)?.color_variants);
    const sk = (d?.sku ?? "").trim().toLowerCase();
    const first = vs.find((v) => (stockBySku[`${sk}|${v.name.trim().toLowerCase()}`]?.available ?? 0) > 0) ?? vs[0];
    if (first) { setPickedColor(first.name); setEdit({ ...base, color: first.name, specs: withFabric(base.specs, first.name) }); }
    else { setPickedColor(null); setEdit(base); }
    /* reset on product change */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.id]);
  const customized = !!d && (
    edit.name.trim() !== (d.product_name ?? "").trim() ||
    edit.color.trim() !== (d.color ?? "").trim() ||
    edit.dimension.trim() !== (d.dimension ?? "").trim() ||
    Number(edit.price) !== Number(d.price ?? 0)
  );

  return (
    <div className={alwaysOpen ? "" : "relative mt-2"}>
      {!alwaysOpen && (
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          placeholder="Click to browse or search product…"
          className={`${inp} w-full`}
        />
      )}
      {open && (
        <div className={alwaysOpen ? "" : "fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4"} onMouseDown={alwaysOpen ? undefined : (e) => { e.preventDefault(); setOpen(false); }}>
        <div onMouseDown={(e) => e.stopPropagation()} className={alwaysOpen
          ? "flex h-[70vh] w-full overflow-hidden rounded-xl border border-border bg-surface"
          : "flex h-[80vh] w-[min(62rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"}>
          {/* Left: categories */}
          <div className="flex w-44 shrink-0 flex-col border-r border-border bg-stone-50">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#4a3b1a]">Category</span>
              {!alwaysOpen && <button type="button" onMouseDown={(e) => { e.preventDefault(); setOpen(false); }} className="text-muted hover:text-foreground">✕</button>}
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {groups.map(([c, ps]) => (
                <button key={c} type="button" onMouseDown={(e) => { e.preventDefault(); setSelCat(c); setCustomMode(false); }} className={`flex w-full items-center justify-between gap-1 px-3 py-1.5 text-left text-xs ${activeCat === c && !customMode ? "bg-[#efe9d8] font-bold text-primary" : "text-foreground hover:bg-stone-100"}`}>
                  <span className="truncate">{c}</span>
                  <span className="shrink-0 text-muted">{ps.length}</span>
                </button>
              ))}
              {groups.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted">No match.</p>}
              {/* CUSTOMIZED — blangkong made-to-order na item, lahat editable */}
              <div className="mx-2 my-1 border-t border-dashed border-border" />
              <button type="button" onMouseDown={(e) => { e.preventDefault(); setCustomMode(true); setCedit((p) => ({ ...p, sku: genCustomSku(p.category) })); void nextMadeToOrderSku(cedit.category).then((sku) => setCedit((p) => ({ ...p, sku }))).catch(() => {}); if ((cedit.category === "Promo Bed" || cedit.category === "Custom Bed") && !bed && !cedit.specs.trim()) { const nb = seedBed(cedit.category); setBed(nb); setCedit((p) => ({ ...p, specs: composeBedSpecs(nb) })); } }} className={`flex w-full items-center justify-between gap-1 px-3 py-1.5 text-left text-xs ${customMode ? "bg-amber-100 font-bold text-amber-800" : "text-amber-700 hover:bg-amber-50"}`}>
                <span className="truncate">Customized</span>
                <span className="shrink-0">＋</span>
              </button>
            </div>
          </div>
          {/* Right: items of active category — o ang CUSTOMIZED form */}
          {customMode ? (
          <div className="flex flex-1 flex-col overflow-y-auto">
            <div className="sticky top-0 border-b border-border bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800">Customized — made-to-order</div>
            <div className="flex-1 space-y-3 p-4">
              <p className="text-xs text-muted">Fill in every detail — all fields are editable (including SKU and price). Upload photos of the piece; the first photo appears on the order.</p>
              <div><label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Photos</label>
                <MultiImageUpload value={cphotos} onChange={setCphotos} camera folder="custom-orders" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">SKU · auto</label><input value={cedit.sku} readOnly onMouseDown={(e) => e.stopPropagation()} className={`${inp} w-full cursor-not-allowed bg-stone-100 text-xs font-mono text-muted`} title="Auto-generated customized SKU" /></div>
                {/* DROPDOWN na ang Category (hiling 2026-08-17): mga umiiral na
                    category ng katalogo + laging kasama ang Customized at Promo. */}
                <div><label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Category</label>
                  <select
                    value={cedit.category}
                    onChange={(e) => {
                      const cat = e.target.value;
                      // SUNUD-SUNOD na SKU (SOFA-000001) mula sa server; ang
                      // genCustomSku ay placeholder lang habang naglo-load.
                      void nextMadeToOrderSku(cat).then((sku) => setCedit((p2) => (p2.category === cat ? { ...p2, sku } : p2))).catch(() => {});
                      setCedit((p) => {
                        // AUTO-FILL ng specs template ng category — pero huwag
                        // burahin ang sariling tinype ng staff: papalitan lang
                        // kapag blanko o template pa rin ito ng ibang category.
                        const untouched = !p.specs.trim()
                          || Object.values(SPEC_TEMPLATES).includes(p.specs)
                          || (specRows !== null && composeSpecs(specRows) === p.specs)
                          || (bed !== null && composeBedSpecs(bed) === p.specs)
                          || (mat !== null && composeMatSpecs(mat) === p.specs);
                        // BED categories → guided flow (mock inaprubahan 2026-08-17).
                        if (untouched && (cat === "Promo Bed" || cat === "Custom Bed")) {
                          const nb = seedBed(cat);
                          setBed(nb); setSpecRows(null); setMat(null);
                          return { ...p, category: cat, sku: genCustomSku(cat), specs: composeBedSpecs(nb) };
                        }
                        // MATTRESS → guided flow (model → size → auto presyo).
                        if (untouched && cat === "Mattress") {
                          setMat({ model: "", sizes: [] }); setBed(null); setSpecRows(null);
                          return { ...p, category: cat, sku: genCustomSku(cat), specs: "" };
                        }
                        if (untouched) { setBed(null); setMat(null); }
                        if (untouched && SPEC_FIELDS[cat]) {
                          // May def/defOpts ang ilang field (hal. Legs 4" Wood ng
                          // Sofa Bed) — isama agad sa specs string para kasama sa
                          // order kahit hindi na galawin.
                          const rows = SPEC_FIELDS[cat].map((f) => ({ label: f.label, value: f.def && f.type === "num" ? fmtHalf(parseHalfStr(f.def)) : (f.def ?? ""), unit: f.units ? f.units[0] : "", opts: f.defOpts }));
                          setSpecRows(rows);
                          return { ...p, category: cat, sku: genCustomSku(cat), specs: composeSpecs(rows) };
                        }
                        if (untouched) setSpecRows(null);
                        return {
                          ...p,
                          category: cat,
                          sku: genCustomSku(cat),
                          specs: untouched ? (SPEC_TEMPLATES[cat] ?? p.specs) : p.specs,
                        };
                      });
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`${inp} w-full text-xs`}
                  >
                    {(() => {
                      // FIXED na listahan (hiling 2026-08-17) — tugma sa mga
                      // category ng website store. Tinanggal na ang generic na
                      // Customized at Promo (hiling 2026-08-17) — specific na
                      // category na lang lagi ang pinipili.
                      const cats = [
                        "Promo Bed", "Custom Bed", "Accent Chair", "Dining Chair", "Barstool", "Mattress", "Dining Table",
                        "Side Table", "Sofa", "Sofa Bed", "Ottoman", "Swivel Chair", "Wall Padding",
                      ];
                      if (cedit.category.trim() && !cats.includes(cedit.category.trim())) cats.push(cedit.category.trim());
                      return cats.map((c) => <option key={c} value={c}>{c}</option>);
                    })()}
                  </select>
                </div>
                {/* LOCAL o IMPORTED — required na pagpili (hiling 2026-08-17):
                    dating awtomatikong "Local" ang tag kahit walang pinili.
                    Katabi na ng SKU at Category (isang row silang tatlo). */}
                <div>
                  <label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Product Type *</label>
                  <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border">
                    {(["Local", "Imported"] as const).map((t, ti) => (
                      <button key={t} type="button" onMouseDown={(e) => { e.preventDefault(); setCedit((p) => ({ ...p, ptype: t })); }} className={`px-1 py-1.5 text-xs font-bold ${ti > 0 ? "border-l border-border" : ""} ${cedit.ptype === t ? (t === "Imported" ? "bg-blue-700 text-white" : "bg-emerald-700 text-white") : "bg-surface text-muted hover:bg-stone-100"}`}>
                        {t}{cedit.ptype === t ? " ✓" : ""}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div><label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Product / Name</label><AutoTextarea value={cedit.name} onChange={(v) => setCedit((p) => ({ ...p, name: v }))} placeholder="e.g. Customized L-shape Sofa" className={`${inp} w-full resize-none overflow-hidden text-xs`} /></div>
              {/* TINANGGAL na ang hiwalay na Color* (hiling 2026-08-17) — ang
                  fabric library picker na ang pumapalit; ang napiling tela ang
                  nagiging color ng produkto. */}
              <div><label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Price *</label><input type="number" min={0} step="0.01" inputMode="decimal" value={cedit.price || ""} onChange={(e) => setCedit((p) => ({ ...p, price: Number(e.target.value) || 0 }))} onMouseDown={(e) => e.stopPropagation()} placeholder="0.00" className={`${inp} w-full text-xs`} /></div>
              {/* Fabric library — parehong swatches ng Design Details builder;
                  ang napili ay diretso nang naisusulat sa Fabric row ng specs
                  (o sa Upholstered Finish ng Custom Bed). Ang Promo Bed ay
                  Beige/Gray chips lang, kaya walang picker doon. */}
              {!(bed && bed.btype === "Promo") && !mat && (
              <div>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); openFabric(); }} className="flex w-full items-center justify-between rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-stone-50">
                  <span className="font-semibold">+ Pick fabric from library{noLeather ? " (no leather)" : ""}</span>
                  <span className="text-muted">{fabricOpen ? "▲" : "▼"}</span>
                </button>
                {leatherPicked && <p className="mt-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10.5px] font-semibold text-rose-700">Leather is not allowed for {cedit.category} — pick a non-leather fabric.</p>}
                {fabricOpen && (
                  <div className="mt-1 rounded-md border border-border p-2">
                    <input value={fabricQ} onChange={(e) => setFabricQ(e.target.value)} onMouseDown={(e) => e.stopPropagation()} placeholder="Search color or material…" className={`${inp} mb-2 w-full text-xs`} />
                    {/* COLLECTION chips (2026-08-19) — filter kapag marami na. */}
                    {fabricLib !== null && fabricLib.length > 12 && (() => {
                      const colOf = (n: string) => { const w = n.trim().split(/\s+/); return w[0]?.toLowerCase() === "new" && w[1] ? `${w[0]} ${w[1]}` : (w[0] ?? ""); };
                      const cols = sortCollections([...new Set(fabricLib.filter((l) => (l.swatch || l.color) && !(noLeather && /leather/i.test(l.name))).map((l) => colOf(l.name)))]);
                      if (cols.length < 2) return null;
                      return (
                        <div className="mb-2 flex gap-1 overflow-x-auto pf-scroll pb-1">
                          <button type="button" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); setFabricCol(""); }} className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${!fabricCol ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-surface text-muted hover:bg-stone-100"}`}>All</button>
                          {cols.map((c) => (
                            <button key={c} type="button" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); setFabricCol(fabricCol === c ? "" : c); }} className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold capitalize ${fabricCol === c ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-surface text-muted hover:bg-stone-100"}`}>{c}</button>
                          ))}
                        </div>
                      );
                    })()}
                    {fabricLib === null ? (
                      <p className="px-2 py-3 text-xs text-muted">Loading swatches…</p>
                    ) : (
                      <div className="flex max-h-52 flex-wrap content-start gap-1.5 overflow-auto pf-scroll">
                        {/* CARD-GRID (2026-08-20, gaya ng website mock): fixed-width
                            na white cards — tile sa taas, pangalan sa ilalim. */}
                        {fabricLib
                          .filter((l) => (l.swatch || l.color) && !(noLeather && /leather/i.test(l.name)))
                          .filter((l) => {
                            if (fabricCol) {
                              const w = l.name.trim().split(/\s+/);
                              const col = w[0]?.toLowerCase() === "new" && w[1] ? `${w[0]} ${w[1]}` : (w[0] ?? "");
                              if (col !== fabricCol) return false;
                            }
                            const t = fabricQ.trim().toLowerCase();
                            return !t || l.name.toLowerCase().includes(t) || String(l.material ?? "").toLowerCase().includes(t);
                          })
                          // Collection order muna (Leather → Tanya → …), tapos pangalan.
                          .sort((a, b) => {
                            const w = (n: string) => { const p = n.trim().split(/\s+/); return p[0]?.toLowerCase() === "new" && p[1] ? `${p[0]} ${p[1]}` : (p[0] ?? ""); };
                            return collectionRank(w(a.name)) - collectionRank(w(b.name)) || a.name.localeCompare(b.name, undefined, { numeric: true });
                          })
                          .map((l) => {
                            const on = cedit.specs.includes(l.name);
                            return (
                              <button
                                key={l.name}
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); pickFabric(l.name); setFabricOpen(false); }}
                                title={l.name}
                                className={`w-[92px] flex-none overflow-hidden rounded-md bg-surface text-center ${on ? "border-2 border-primary shadow-[0_0_0_2px_rgba(184,115,51,0.22)]" : "border border-border hover:border-primary"}`}
                              >
                                {/* Color-only na seed (walang photo pa): kulay na tile ang tile. */}
                                {l.swatch ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={imageUrl(String(l.swatch))} alt={l.name} className="h-9 w-full object-cover" loading="lazy" />
                                ) : (
                                  <span className="block h-9 w-full" style={{ backgroundColor: String(l.color ?? "#ddd") }} />
                                )}
                                <span className={`block truncate px-1 py-0.5 text-[9px] leading-tight ${on ? "font-bold text-foreground" : "text-muted"}`}>{l.name}{on ? " ✓" : ""}</span>
                              </button>
                            );
                          })}
                        {fabricLib.filter((l) => l.swatch || l.color).length === 0 && (
                          <p className="w-full px-2 py-3 text-xs text-muted">No swatches in the library yet.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}
              {/* Design specs — mirrors the shop's "Design Details" sheet: one
                  spec per line, each becomes a bullet on the order/receipt/
                  workshop job (e.g. Headboard Height: 4ft from floor). */}
              <div>
                <div className="mb-0.5 flex items-center justify-between">
                  <label className="block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Specifications / Design details</label>
                  {/* Progress — ilan nang row ang nasagutan (v2 na disenyo). */}
                  {specRows && (
                    <span className="text-[10px] font-bold tabular-nums text-muted">
                      {specRows.filter((r) => r.value.trim() || (r.opts?.length ?? 0) > 0).length} / {specRows.length}
                    </span>
                  )}
                </div>
                {bed ? (
                  <BedOptionsPanel b={bed} upd={updBed} />
                ) : mat ? (
                  <MattressPanel s={mat} mode="order" onModel={pickMatModel} onSize={pickMatSize} onThick={setMatThick} />
                ) : specRows ? (
                  <div>
                    {(() => {
                      // GROUPED CARDS (inaprubahang refined UI 2026-08-17):
                      // 1 Measurements (mga sukat) · 2 Details (chips/text) —
                      // may bilang ng nasagutan sa header ng bawat card.
                      const defs = SPEC_FIELDS[cedit.category] ?? [];
                      const entries = specRows.map((r, ri) => ({ r, ri, def: defs.find((f) => f.label === r.label) }));
                      const isMeas = (e: typeof entries[number]) => e.def?.type === "num" && !e.def?.chips;
                      const meas = entries.filter(isMeas);
                      const dets = entries.filter((e) => !isMeas(e));
                      const filledOf = (list: typeof entries) => list.filter((e) => e.r.value.trim() || (e.r.opts?.length ?? 0) > 0).length;
                      const renderRow = (e: typeof entries[number]) => {
                        const { r, ri, def } = e;
                        const filled = !!r.value.trim() || (r.opts?.length ?? 0) > 0;
                        // Stepper: 0.5 kada pindot; hindi bababa sa 0.
                        // ±½ na may FRACTION display: 3 → "3 ½" → 4 (2026-08-19).
                        const stepNum = (d: number) => {
                          const cur = parseHalfStr(r.value);
                          const nv = Math.max(0, (Number.isFinite(cur) ? cur : 0) + d);
                          updSpecRow(ri, { value: nv > 0 ? fmtHalf(nv) : "" });
                        };
                        return (
                          <div key={r.label} className="border-t border-dashed border-stone-200 py-1 first:border-t-0">
                            <div className="flex items-center gap-1.5">
                              <span className="w-[118px] shrink-0 truncate text-[10.5px] font-semibold leading-tight text-[#3a2e14]" title={r.label}>{r.label}</span>
                              {def?.fixed ? (
                                /* AS-IS na sukat (hal. Swivel Chair) — hindi
                                   editable; kasama pa rin sa specs output. */
                                <span className="flex h-9 min-w-0 flex-1 items-center rounded-lg border border-dashed border-[#caa45a] bg-[#faf5e9] px-3 text-sm font-bold text-[#3a2e14]">
                                  {r.value}{r.unit ? ` ${r.unit === "inches" ? "in" : r.unit}` : ""}
                                  <span className="ml-auto text-[9px] font-extrabold uppercase tracking-[0.1em] text-[#8a6a1f]">as-is</span>
                                </span>
                              ) : def?.type === "num" ? (
                                <>
                                  <span className="flex min-w-0 flex-1 items-stretch">
                                    <button type="button" tabIndex={-1} onMouseDown={(ev) => { ev.preventDefault(); stepNum(-0.5); }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-l-lg border border-border bg-cream text-base font-bold text-[#4a3b1a] hover:bg-stone-100">−</button>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={r.value}
                                      onChange={(ev) => updSpecRow(ri, { value: ev.target.value })}
                                      onBlur={(ev) => { const n = parseHalfStr(ev.target.value); updSpecRow(ri, { value: Number.isFinite(n) && n > 0 ? fmtHalf(n) : "" }); }}
                                      onMouseDown={(ev) => ev.stopPropagation()}
                                      placeholder="0"
                                      className="h-9 w-full min-w-0 border-y border-border bg-surface text-center text-sm font-bold tabular-nums outline-none focus:border-primary"
                                    />
                                    <button type="button" tabIndex={-1} onMouseDown={(ev) => { ev.preventDefault(); stepNum(0.5); }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-r-lg border border-border bg-cream text-base font-bold text-[#4a3b1a] hover:bg-stone-100">+</button>
                                  </span>
                                  <span className="flex shrink-0 overflow-hidden rounded-lg border border-border">
                                    {(def.units ?? []).map((u, ui) => (
                                      <button key={u} type="button" tabIndex={-1} onMouseDown={(ev) => { ev.preventDefault(); updSpecRow(ri, { unit: u }); }} className={`px-2.5 py-2 text-[10.5px] font-extrabold ${ui > 0 ? "border-l border-border" : ""} ${r.unit === u ? "bg-[#4a3b1a] text-[#f4ead8]" : "bg-surface text-muted hover:bg-stone-100"}`}>
                                        {u === "inches" ? "in" : u}
                                      </button>
                                    ))}
                                  </span>
                                </>
                              ) : def?.type === "choice" ? (
                                /* CHOICE — chips lang, walang text box (hal.
                                   Ottoman Type: Standard | With Storage). */
                                <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                                  {(def.chips ?? []).map((c) => {
                                    const on = (r.opts ?? []).includes(c);
                                    return (
                                      <button key={c} type="button" tabIndex={-1} onMouseDown={(ev) => {
                                        ev.preventDefault();
                                        updSpecRow(ri, { opts: def.single ? (on ? [] : [c]) : (on ? (r.opts ?? []).filter((x) => x !== c) : [...(r.opts ?? []), c]) });
                                      }} className={`rounded-full border px-2.5 py-1.5 text-[10px] font-bold ${on ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-surface text-muted hover:bg-stone-100"}`}>
                                        {c.split(" — ")[0]}{on ? " ✓" : ""}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <input
                                  value={r.value}
                                  onChange={(ev) => updSpecRow(ri, { value: ev.target.value })}
                                  onMouseDown={(ev) => ev.stopPropagation()}
                                  placeholder={def?.ph ?? ""}
                                  className={`${inp} h-9 w-full min-w-0 flex-1 text-xs`}
                                />
                              )}
                              <span className={`w-4 shrink-0 text-center text-xs ${filled ? "text-emerald-600" : "text-stone-300"}`}>{filled ? "✓" : "•"}</span>
                            </div>
                            {def?.chips && def.type !== "choice" && (
                              <div className="mt-1 flex flex-wrap gap-1 pl-[124px]">
                                {def.chips.map((c) => {
                                  const on = (r.opts ?? []).includes(c);
                                  return (
                                    <button key={c} type="button" tabIndex={-1} onMouseDown={(ev) => {
                                      ev.preventDefault();
                                      const set = new Set(r.opts ?? []);
                                      if (on) set.delete(c); else set.add(c);
                                      updSpecRow(ri, { opts: (def.chips ?? []).filter((x) => set.has(x)) });
                                    }} className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${on ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-surface text-muted hover:bg-stone-100"}`}>
                                      {c}{on ? " ✓" : ""}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      };
                      const cardEl = (n: string, t: string, list: typeof entries) => (list.length === 0 ? null : (
                        <div key={t} className="mt-2 overflow-hidden rounded-lg border border-border">
                          <div className="flex items-center gap-2 border-b border-border bg-[#faf5e9] px-2.5 py-1.5">
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#4a3b1a] text-[9px] font-extrabold text-[#f4ead8]">{n}</span>
                            <span className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#5a4718]">{t}</span>
                            <span className="ml-auto text-[10px] font-bold tabular-nums text-[#8a6a1f]">{filledOf(list)} / {list.length} filled</span>
                          </div>
                          <div className="px-2.5 pb-1">{list.map(renderRow)}</div>
                        </div>
                      ));
                      return <>{cardEl("1", "Measurements", meas)}{cardEl(meas.length ? "2" : "1", "Details", dets)}</>;
                    })()}
                    <p className="mt-1 text-[10px] text-muted">Blank fields are left off the sheet.</p>
                  </div>
                ) : (
                  <AutoTextarea value={cedit.specs} onChange={(v) => setCedit((p) => ({ ...p, specs: v }))} placeholder={"Headboard Height: 4ft from floor\nEnd to End: 92x96\nPlatform Style\nFabric: Velbert Gray 101\n6 Panels\nNote: Mattress care of client"} className={`${inp} w-full resize-none overflow-hidden text-xs`} />
                )}
                {/* LIVE PREVIEW (refined UI): eksaktong specs na papasok sa
                    order/resibo/design details — kita bago pa i-Add. */}
                {(bed || specRows || mat) && cedit.specs.trim() && (
                  <div className="mt-2 rounded-lg border border-border bg-[#faf5e9] px-2.5 py-2">
                    <p className="mb-1 text-[8.5px] font-extrabold uppercase tracking-[0.14em] text-[#a8842e]">Specifications — will show on order · receipt · design details</p>
                    <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[#3a2e14]">{cedit.specs}</pre>
                  </div>
                )}
              </div>
            </div>
            <div className="border-t border-border bg-surface p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#a8842e]">Quantity</span>
                <div className="flex items-center gap-1">
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); setQty((n) => Math.max(1, n - 1)); }} className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-base leading-none hover:bg-stone-100">−</button>
                  <input value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} onMouseDown={(e) => e.stopPropagation()} className="h-7 w-12 rounded-md border border-border bg-stone-50 text-center text-sm outline-none focus:border-primary" />
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); setQty((n) => n + 1); }} className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-base leading-none hover:bg-stone-100">+</button>
                </div>
              </div>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#a8842e]">Total</span>
                <span className="text-lg font-bold text-primary">₱{peso2(Number(cedit.price) * qty)}</span>
              </div>
              <button
                type="button"
                // REQUIRED: pangalan + COLOR + PRICE (>0) + PRODUCT TYPE bago maidagdag (2026-08-17).
                // AUTO-BAN (team 2026-08-19): leather + Lift Storage = hindi maidadagdag.
                // AUTO-BAN (team 2026-08-20): leather sa Sofa / Sofa Bed = hindi maidadagdag.
                disabled={!cedit.name.trim() || fabricMissing || !(Number(cedit.price) > 0) || !cedit.ptype || (bed !== null && bed.btype === "Custom" && bed.lift && /leather/i.test(bed.uph)) || leatherPicked}
                title={!cedit.name.trim() ? "Enter the product name" : fabricMissing ? "Pick or type the fabric" : !(Number(cedit.price) > 0) ? "Price is required" : !cedit.ptype ? "Select Local or Imported" : (bed !== null && bed.btype === "Custom" && bed.lift && /leather/i.test(bed.uph)) ? "Leather is not allowed on a Lift Storage bed — change the fabric or remove Lift Storage" : leatherPicked ? `Leather is not allowed for ${cedit.category} — pick a non-leather fabric` : undefined}
                onMouseDown={(e) => {
                e.preventDefault();
                if (!cedit.name.trim() || fabricMissing || !(Number(cedit.price) > 0) || !cedit.ptype) return;
                if (bed !== null && bed.btype === "Custom" && bed.lift && /leather/i.test(bed.uph)) return; // leather + lift = auto-ban
                if (leatherPicked) return; // leather sa Sofa / Sofa Bed = auto-ban
                const specLines = cedit.specs.split("\n").map((l) => l.trim()).filter(Boolean);
                // Ang color ng produkto = napiling fabric (nasa spec lines na
                // ang mismong linya, kaya hindi na inuulit sa bullets).
                const colorVal = fabricLine || cedit.color || null;
                const bullets = [cedit.dimension, ...specLines].filter(Boolean).map((b) => "• " + b.replace(/^[•·-]\s*/, ""));
                const customSku = cedit.sku.trim() || genCustomSku(cedit.category);
                onPick({ qty, description: [cedit.name, ...bullets].join("\n"), unitPrice: Number(cedit.price) || 0, image: cphotos[0] ?? null, sku: customSku, category: cedit.category.trim() || "Customized", color: colorVal, dimension: cedit.dimension || null, constructorName: null, workshop: null, customized: true, imported: cedit.ptype === "Imported" });
                // I-SAVE din sa katalogo (hiling 2026-08-17): lalabas sa sarili
                // nitong category sa product browser para magamit muli. Best-
                // effort — hindi hinaharang ang pagdagdag sa order; pagkatapos
                // ng save, REFRESH para agad lumitaw ang bagong category tab
                // (naiulat 2026-08-17 na hindi agad nakikita).
                void saveCustomizedProduct({
                  product_name: cedit.name.trim(),
                  sku: customSku,
                  category: cedit.category.trim() || "Customized",
                  color: fabricLine || cedit.color || null,
                  dimension: cedit.dimension || null,
                  price: Number(cedit.price) || 0,
                  image_url: cphotos[0] ?? null,
                  specs: cedit.specs,
                  product_type: cedit.ptype,
                }).then((r) => { if (!("error" in r)) router.refresh(); }).catch(() => {});
                setQ(""); setQty(1); setOpen(alwaysOpen); setCustomMode(false);
                setCedit({ sku: genCustomSku("Promo Bed"), name: "", color: "", dimension: "", price: 0, category: "Promo Bed", specs: "", ptype: "" }); setCphotos([]); setSpecRows(null); setBed(null); setMat(null);
              }} className="w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">+ Add customized</button>
            </div>
          </div>
          ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="sticky top-0 border-b border-[#caa45a] bg-[#4a3b1a] px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#f4ead8]">{activeCat ?? "—"} {activeCat && <span className="font-normal text-muted">({activeItems.length})</span>}</div>
            {activeItems.map((p) => (
              <button key={p.id} type="button" onMouseEnter={() => setHovered(p)} onMouseDown={(e) => { e.preventDefault(); setHovered(p); }} className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-stone-100 ${hovered?.id === p.id ? "bg-[#f4efe0]" : ""}`}>
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img loading="lazy" decoding="async" src={p.image_url} alt="" className="h-7 w-7 shrink-0 rounded object-cover ring-1 ring-border" />
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-stone-200 text-[9px] font-semibold text-stone-500">{(p.product_name ?? "?").slice(0, 2).toUpperCase()}</span>
                )}
                <span className="min-w-0 flex-1">
                  {(p.product_type ?? "").toLowerCase() === "imported"
                    ? <span className="mb-0.5 inline-block rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700">Imported</span>
                    : <span className="mb-0.5 inline-block rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">Local</span>}
                  <span className="block truncate text-sm">{p.product_name}</span>
                  <span className="block font-mono text-xs text-muted">{p.sku ?? "—"}</span>
                </span>
                <span className="shrink-0 text-xs font-medium">₱{peso2(Number(p.price ?? 0))}</span>
              </button>
            ))}
            {activeItems.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted">Pick a category.</p>}
          </div>
          )}
          {/* Detail preview + customize */}
          {!customMode && (
              // Mas malapad (2026-08-19) — kasya na ang guided spec rows
              // (label + stepper + in/cm/ft chips) nang hindi nagsisiksikan.
              <div className="hidden w-[26rem] shrink-0 flex-col border-l border-border bg-stone-50 md:flex">
                {d ? (
                  <>
                    <div className="flex-1 overflow-y-auto p-3">
                      {(() => {
                        // LATE NA LITRATO (2026-08-17): kapag walang image ang
                        // produkto, pwedeng mag-upload dito mismo — nase-save sa
                        // product row at gagamitin na sa order line.
                        // Litrato ng napiling kulay (0231) ang preview kapag meron.
                        const colorHero = pickedColor ? (dVariants.find((cv) => cv.name === pickedColor)?.images[0] ?? null) : null;
                        const shownImg = colorHero ?? (imgFix && imgFix.id === d.id ? imgFix.url : null) ?? d.image_url;
                        if (shownImg) {
                          // eslint-disable-next-line @next/next/no-img-element
                          return <img loading="lazy" decoding="async" src={shownImg} alt="" className="mb-3 h-32 w-full rounded-lg bg-white object-contain ring-1 ring-border" />;
                        }
                        return (
                          <div className="mb-3">
                            <MultiImageUpload
                              value={[]}
                              onChange={(urls) => {
                                const u = urls[0];
                                if (!u) return;
                                setImgFix({ id: d.id, url: u });
                                void setProductImage(d.id, u).then((r) => { if (!("error" in r)) router.refresh(); }).catch(() => {});
                              }}
                              camera
                              folder="products"
                            />
                            <p className="mt-1 text-[10px] text-muted">No image yet — upload one; it saves to the catalog.</p>
                          </div>
                        );
                      })()}
                      {(() => { const imp = (d.product_type ?? "").toLowerCase() === "imported"; const lock = imp ? "cursor-not-allowed bg-stone-100 text-muted" : ""; return (
                      <>
                      <div className="mb-1 flex items-center gap-2">
                        {d.sku && <span className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-[10px] text-stone-600">{d.sku}</span>}
                        {imp
                          ? <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Imported</span>
                          : customized
                            ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Customized</span>
                            : <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Local</span>}
                      </div>
                      {/* Imported products are FIXED: name, color, dimension and price all come
                          from the catalog and can't be edited on the order. */}
                      <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#4a3b1a]">{imp ? "Imported — fixed details" : "Editable fields"}</p>
                      <div className="space-y-2">
                        <div><label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Product / Name</label>{imp ? <input value={edit.name} readOnly onMouseDown={(e) => e.stopPropagation()} className={`${inp} w-full text-xs ${lock}`} /> : <AutoTextarea value={edit.name} onChange={(v) => setEdit((p) => ({ ...p, name: v }))} className={`${inp} w-full resize-none overflow-hidden text-xs`} />}</div>
                        {/* COLOR — itago kapag ang category template ay may
                            sariling Fabric/Upholstered field O may fabric line
                            na sa specs (2026-08-19): iisang input surface lang
                            para sa tela, hindi doble. */}
                        {!((SPEC_FIELDS[d.category ?? ""] ?? []).some((f) => /fabric|upholstered/i.test(f.label))
                          || d.category === "Promo Bed" || d.category === "Custom Bed"
                          || /^(Fabric(\s*\/\s*Finish)?|Upholstered Finish):/m.test(edit.specs)) && (
                          <div><label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Color</label><input value={edit.color} readOnly={imp} onChange={(e) => { if (imp) return; setEdit((p) => ({ ...p, color: e.target.value })); }} onMouseDown={(e) => e.stopPropagation()} className={`${inp} w-full text-xs ${lock}`} /></div>
                        )}
                        {/* Tinanggal ang Dimension (L×W×H) row (hiling 2026-08-17) —
                            nasa specs na ang mga sukat. May BULLET na bawat linya
                            ng specs; tinatanggal ang bullet bago i-save. */}
                        {/* SPECS (2026-08-19) — parehong guided format kahit saan:
                            Imported = read-only cards; Local = editable fields na
                            preloaded ang specs ng produkto (key para mag-reseed
                            kada palit ng napi-preview na item). */}
                        {imp ? (
                          <SpecFieldsView category={d.category ?? ""} specs={edit.specs} />
                        ) : (
                          <SpecFieldsInput
                            key={d.id}
                            name="preview_specs"
                            category={d.category ?? ""}
                            initialText={d.specs ?? ""}
                            // LINYA NG ORDER, hindi paggawa ng produkto: sa
                            // mattress, ang model at ang thickness ay napagpasyahan
                            // na ng piniling produkto — size na lang ang tanong.
                            mode="order"
                            onChange={(v) => setEdit((p) => ({ ...p, specs: v }))}
                            // Walang live-preview box dito — kita na mismo ang
                            // fields, at masikip ang pane (hiling 2026-08-19).
                            showPreview={false}
                          />
                        )}
                        {/* COLOR VARIANTS (0231/0232): pipiliin ang kulay ng
                            yunit - ang Fabric line ng order ay ang napili lang,
                            at ang Reserved/Available ay ng kulay na iyon. */}
                        {dVariants.length > 0 && (
                          <div>
                            <label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Color</label>
                            <div className="flex flex-wrap gap-1.5">
                              {dVariants.map((cv) => {
                                const on = pickedColor === cv.name;
                                const stc = stockBySku[`${(d.sku ?? "").trim().toLowerCase()}|${cv.name.trim().toLowerCase()}`];
                                const thumb = cv.images[0] || cv.swatch || "";
                                return (
                                  <div key={cv.name} className="relative" onMouseEnter={() => setHoverColor(cv.name)} onMouseLeave={() => setHoverColor(null)}>
                                    <button
                                      type="button"
                                      onMouseDown={(e) => { e.preventDefault(); applyColor(cv.name); }}
                                      title={`${cv.name} — ${stc?.available ?? 0} available`}
                                      className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[10.5px] font-semibold ${on ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-surface text-foreground hover:border-primary"}`}
                                    >
                                      {thumb ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={imageUrl(thumb)} alt="" className="h-6 w-6 rounded bg-white object-contain" />
                                      ) : (
                                        <span className="h-6 w-6 rounded" style={{ backgroundColor: cv.color ?? "#ddd" }} />
                                      )}
                                      <span>{cv.name}</span>
                                      <span className={`rounded px-1 text-[9px] tabular-nums ${on ? "bg-white/20" : (stc?.available ?? 0) > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{stc?.available ?? 0}</span>
                                    </button>
                                    {/* Hover preview - litrato ng produkto sa kulay na ito */}
                                    {hoverColor === cv.name && thumb && (
                                      <div className="pointer-events-none absolute bottom-full left-0 z-40 mb-1.5 w-44 overflow-hidden rounded-lg border border-border bg-white shadow-xl">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={imageUrl(thumb)} alt={cv.name} className="aspect-square w-full object-contain p-2" />
                                        <div className="border-t border-border px-2 py-1.5">
                                          <p className="text-[11px] font-bold leading-tight">{cv.name}</p>
                                          <p className="text-[10px] text-muted">{stc?.available ?? 0} available · {stc?.reserved ?? 0} reserved</p>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div><label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Price{imp && " · fixed"}</label><input inputMode="decimal" readOnly={imp} value={edit.price ? Number(edit.price).toLocaleString("en-US") : ""} onChange={(e) => { if (imp) return; setEdit((p) => ({ ...p, price: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })); }} onMouseDown={(e) => e.stopPropagation()} placeholder="0" className={`${inp} w-full ${lock}`} title={imp ? "Imported product — price is fixed" : undefined} /></div>
                        <div className="text-[10px] text-muted">Category: <span className="font-medium text-foreground">{d.category ?? "—"}</span></div>
                        {(() => {
                          // Kada kulay kapag may napili (0232); kung wala, kabuuan ng SKU.
                          const skuKey = (d.sku ?? "").trim().toLowerCase();
                          const st = (pickedColor ? stockBySku[`${skuKey}|${pickedColor.trim().toLowerCase()}`] : undefined) ?? stockBySku[skuKey];
                          return (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-center">
                                <div className="text-[10px] font-medium uppercase tracking-wide text-blue-700/70">Reserved</div>
                                <div className="text-xl font-bold tabular-nums text-blue-700">{st?.reserved ?? 0}</div>
                              </div>
                              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center">
                                <div className="text-[10px] font-medium uppercase tracking-wide text-emerald-700/70">Available</div>
                                <div className="text-xl font-bold tabular-nums text-emerald-700">{st?.available ?? 0}</div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      </>
                      ); })()}
                    </div>
                    <div className="border-t border-border bg-surface p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#a8842e]">Quantity</span>
                        <div className="flex items-center gap-1">
                          <button type="button" onMouseDown={(e) => { e.preventDefault(); setQty((n) => Math.max(1, n - 1)); }} className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-base leading-none hover:bg-stone-100">−</button>
                          <input value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} onMouseDown={(e) => e.stopPropagation()} className="h-7 w-12 rounded-md border border-border bg-stone-50 text-center text-sm outline-none focus:border-primary" />
                          <button type="button" onMouseDown={(e) => { e.preventDefault(); setQty((n) => n + 1); }} className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-base leading-none hover:bg-stone-100">+</button>
                        </div>
                      </div>
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#a8842e]">Total</span>
                        <span className="text-lg font-bold text-primary">₱{peso2(Number(edit.price) * qty)}</span>
                      </div>
                      <button type="button" onMouseDown={(e) => {
                        e.preventDefault();
                        const specLines = edit.specs.split("\n").map((l) => l.trim()).filter(Boolean);
                        // Kapag may Fabric/Upholstered line na ang specs, HUWAG nang
                        // idoble ang color bullet — iisa na lang ang lalabas sa order
                        // line, resibo, at previews (hiling 2026-08-19).
                        const fabricLine = /^(?:Fabric(?:\s*\/\s*Finish)?|Upholstered Finish):\s*(.+)$/m.exec(edit.specs)?.[1]?.trim() ?? "";
                        const colorBullet = fabricLine ? "" : edit.color;
                        const bullets = [colorBullet, edit.dimension, ...specLines].filter(Boolean).map((b) => "• " + String(b).replace(/^[•·\-\s]+/, ""));
                        const isImported = (d.product_type ?? "").toLowerCase() === "imported";
                        // LITRATO NG NAPILING KULAY (0231): ang line ay dala ang
                        // hero ng kulay; kung walang litrato ang kulay, ang
                        // pangkalahatang product photo.
                        const colorImg = pickedColor ? (dVariants.find((cv) => cv.name === pickedColor)?.images[0] ?? null) : null;
                        onPick({ qty, description: [edit.name, ...bullets].join("\n"), unitPrice: isImported ? Number(d.price ?? 0) : (Number(edit.price) || 0), image: colorImg ?? (imgFix && imgFix.id === d.id ? imgFix.url : null) ?? d.image_url ?? null, sku: d.sku ?? null, category: d.category ?? null, color: fabricLine || edit.color || null, dimension: edit.dimension || null, constructorName: null, workshop: null, customized: isImported ? false : customized, imported: isImported });
                        setQ(""); setQty(1); setOpen(alwaysOpen);
                      }} className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-accent hover:bg-primary/90">{customized ? "+ Add customized" : "+ Add to order"}</button>
                    </div>
                  </>
                ) : <p className="p-4 text-center text-xs text-muted">Hover an item to preview</p>}
              </div>
          )}
        </div>
        </div>
      )}
    </div>
  );
}
