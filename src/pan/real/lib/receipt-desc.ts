// Parses a receipt-item / workshop-job description of the form
//   Bed 1 senpai malibog.
//   • Lafayette Brown
//   • Single · 36"x75"
//   • W 40" · Hdbrd 46" · L 81" · Base 12" · Legs 4"
//   • Bed
// into name + specs. Used as a FALLBACK when the per-item fields (sku/category/
// color/dimension) are missing and the catalog match fails (e.g. customized items)
// — so every process connected to an order (workshop, QC receiving, delivery,
// installation, returns, ops logs) still shows complete specs.
export type DescSpecs = {
  name: string;
  color: string | null;
  category: string | null;
  dimension: string | null; // size only, e.g. Single · 36"x75"
  frame: string | null;     // frame parts / add-ons, e.g. W 40" · Hdbrd 46" · L 81" · Base 12" · Legs 4"
};

export function firstLine(desc: string | null | undefined): string {
  return String(desc ?? "").split("\n")[0].trim();
}

// Product NAME for catalog matching: the first line minus the rework job tag
// ("Rework · RMA-000020 · Bed 1…" → "Bed 1…"), so a rework job still matches its
// product's image/SKU/price and renders in the same format as a normal job.
export function matchName(desc: string | null | undefined): string {
  return firstLine(desc).replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "").trim();
}

// Splits a stored combined dimension string ("Single · 36\"x75\" · W 40\" · Hdbrd 46\"")
// back into size vs frame parts — for records whose dimension column carries both
// (e.g. returns saved before the split, or combined on purpose to avoid a schema change).
export function splitDimension(dim: string | null | undefined): { size: string | null; frame: string | null } {
  const segs = String(dim ?? "").split("·").map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return { size: null, frame: null };
  const isFrame = (s: string) => /\b(?:W|L|H|Hdbrd|Base|Legs)\s*\d+/i.test(s);
  const frame = segs.filter(isFrame);
  const size = segs.filter((s) => !isFrame(s));
  return { size: size.length ? size.join(" · ") : null, frame: frame.length ? frame.join(" · ") : null };
}

export function parseDescSpecs(desc: string | null | undefined): DescSpecs {
  const lines = String(desc ?? "").split("\n").map((l) => l.trim());
  const name = lines[0] ?? "";
  const bullets = lines.filter((l) => l.startsWith("•")).map((l) => l.replace(/^•\s*/, "").trim()).filter(Boolean);
  // Frame/add-on bullets: labeled inch parts from the bed customizer's FRAME
  // DIMENSIONS table (A Width / B Hdbrd / C Length / D Base / E Legs). Kept
  // SEPARATE from the size so views can show them as their own "Add-ons" row.
  const isFrame = (b: string) => /\b(?:W|L|H|Hdbrd|Base|Legs)\s*\d+/i.test(b);
  // Size bullets: an NxM measurement (36"x75", 6 x 36 x 75", 35x75x0 cm).
  const isSize = (b: string) => /\d+\s*(?:"|cm|in\b)?\s*[*x×]\s*\d+/i.test(b);
  const frames = bullets.filter(isFrame);
  const sizes = bullets.filter((b) => !isFrame(b) && isSize(b));
  const rest = bullets.filter((b) => !isFrame(b) && !isSize(b));
  // Convention from order receipts: first non-dim bullet = color, last = category.
  //
  // NAKALABEL NA LINYA AY HINDI KULAY (2026-08-26). Ang tunay na kulay ay
  // nakasulat nang walang label ("Cairo 2", "Tanya Beige 201"). Ang mattress ay
  // nagsisimula sa "Model: Uratex Comfort Plus", at iyon ang naging COLOR sa
  // warranty certificate — nakabali sa apat na linya sa isang 62px na hanay.
  // Ang "Fabric:" at "Upholstered Finish:" ay pinapayagan: kulay ang laman.
  // May "." ang label (2026-09-06): "Seat Height (incl. legs): 18 inches" ay
  // hindi nakikilalang label noon, kaya "18 inches" ang naging KULAY ng rework
  // stock-in ng Biscocho at nawala ang puwesto nito sa mapa.
  // Anumang bullet na may label bago ang ":" ay label (2026-09-06, "Back
  // Cushion Thickness (with wood): 3 inches" ay 34 chars — lampas sa dating
  // 32 kaya "3 inches" ang naging KULAY ng Siopao Swivel sa RMA at QC).
  const isLabelled = (b: string) => /^[A-Za-z][^:]{0,58}:/.test(b);
  // Ang sukat ay hindi kulay kahit walang label ("3 inches", "36 x 75", "100 cm").
  const isMeasure = (b: string) => /^\d+(?:[.,]\d+)?\s*(?:"|''|inches?|in\b|cm\b|mm\b|ft\b|feet|meters?|m\b)/i.test(b.trim());
  const colorish = (b: string) => /^(Fabric(\s*\/\s*Finish)?|Upholstered Finish|Colou?r)\s*:/i.test(b);
  // "Custom Bed — With Add-ons" ay pamagat ng build, hindi kulay — iyon ang
  // unang bullet ng kama, kaya siya ang nakukuha ng dating rest[0].
  const isHeading = (b: string) => /—\s*With Add-ons\s*$/i.test(b);
  // ANG "Fabric:" AY NANGUNGUNA (2026-09-06): kapag may nakalabel na kulay
  // kahit saan sa bullets, iyon ang kulay — hindi ang unang bullet na walang
  // label na nagkataong nauna.
  const color = (rest.find(colorish) ?? rest.find((b) => !isLabelled(b) && !isHeading(b) && !isMeasure(b)) ?? null)?.replace(/^[^:]*:\s*/, "") ?? null;
  // ANG NAKALABEL NA LINYA AY HINDI KATEGORYA (2026-08-29) — kapareho ng
  // panuntunan sa kulay sa itaas. Ang huling bullet ng dining table ay "Wood
  // Stain: Jacobian", at iyon ang naging CATEGORY sa warranty certificate ng
  // isang order na walang naka-imbak na kategorya. Ang tunay na kategorya ay
  // nakasulat nang walang label ("Sofa", "Dining Table").
  const category = rest.length >= 2 && !isLabelled(rest[rest.length - 1]) ? rest[rest.length - 1] : null;
  return {
    name, color, category,
    dimension: sizes.length ? sizes.join(" · ") : null,
    frame: frames.length ? frames.join(" · ") : null,
  };
}

// Ang mga linya PAGKATAPOS ng pangalan - ang build ng customer - bilang isang
// teksto (isang spec kada linya), bullets tinanggal. Null kapag walang iba kundi
// ang pangalan. Ginagamit ng Delivery QA at Installation para madala ang buong
// build sa Product Details kahit pangalan lang ang nakalagay sa table.
export function descSpecLines(desc: string | null | undefined): string | null {
  const lines = String(desc ?? "").split("\n").map((l) => l.trim().replace(/^[\u2022\u00b7\-\s]+/, "")).filter(Boolean);
  return lines.slice(1).join("\n") || null;
}
