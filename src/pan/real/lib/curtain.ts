// ── Curtain (Kurtina ni PAN) quotation math ──────────────────────────────────
// Mirrors the manual sample computation exactly. All window measurements are in
// INCHES; convert cm/mm to the nearest WHOLE inch before calling (toInches()).

export type Unit = "in" | "cm" | "mm";

// Constants from the pricing sheet.
const HEIGHT_CLEARANCE = 15;   // added to height
const PANEL_DIVISOR = 20;      // width / 20 = panels
const YARD_DIVISOR = 36;       // inches → yards
const PRICE_YARD_BLACKOUT = 300;
const PRICE_YARD_SHEER = 250;
const PRICE_LABOR_PANEL = 200; // per panel (same for blackout & sheer)

// S-fold rod price brackets by window WIDTH (inches). A width on a shared boundary
// takes the HIGHER bracket (sample: W=80 → 5,000, the 80–100 bracket).
const ROD_BRACKETS: { min: number; max: number; price: number }[] = [
  { min: 30, max: 50, price: 3000 },    // 30–50
  { min: 50, max: 80, price: 4000 },    // 50–80
  { min: 80, max: 100, price: 5000 },   // 80–100  ← W=80 lands here
  { min: 100, max: 150, price: 6000 },  // 100–150
  { min: 150, max: 200, price: 8000 },  // 150–200
  { min: 200, max: 250, price: 10000 }, // 200–250
];

// Convert a measurement to the nearest whole inch.
export function toInches(value: number, unit: Unit): number {
  const v = Number(value) || 0;
  const inches = unit === "cm" ? v / 2.54 : unit === "mm" ? v / 25.4 : v;
  return Math.round(inches);
}

// Boundary rule: a width equal to a bracket boundary takes the HIGHER bracket, so we
// test the HIGHER brackets first and use `>= min` (inclusive lower). W=80 → checks
// 200,150,100,80… and matches {min:80} = 5,000. Below the first min → smallest price.
export function rodPrice(widthIn: number): number {
  for (let i = ROD_BRACKETS.length - 1; i >= 0; i--) {
    const b = ROD_BRACKETS[i];
    if (widthIn >= b.min) return b.price;
  }
  return ROD_BRACKETS[0]?.price ?? 0; // narrower than the chart → smallest rod price
}

export type CurtainWindow = { label?: string; height: number; width: number; unit: Unit };

export type CurtainQuote = {
  label: string;
  heightIn: number;        // nearest whole inch
  widthIn: number;         // nearest whole inch
  totalHeightClearance: number; // height + 15
  panel: number;           // ceil? sample uses exact (80/20=4). Kept as computed, see note.
  yardageRaw: number;      // before round
  yardage: number;         // rounded off
  blackoutYards: number;   // yardage × 300
  sheerYards: number;      // yardage × 250
  laborBlackout: number;   // panel × 200
  laborSheer: number;      // panel × 200
  rod: number;             // from width bracket
  total: number;           // sum of the above
  lines: { label: string; amount: number }[]; // quotation breakdown
};

// Compute one window's quote from raw H/W (+ unit).
export function computeWindow(win: CurtainWindow): CurtainQuote {
  const heightIn = toInches(win.height, win.unit);
  const widthIn = toInches(win.width, win.unit);

  const totalHeightClearance = heightIn + HEIGHT_CLEARANCE;
  // Panels: width / 20, ALWAYS rounded UP — a partial panel still needs a full panel
  // of fabric + labor (80/20=4 exactly; 90/20=4.5 → 5).
  const panel = Math.max(1, Math.ceil(widthIn / PANEL_DIVISOR));

  const yardageRaw = (totalHeightClearance * panel) / YARD_DIVISOR;
  const yardage = Math.round(yardageRaw);

  const blackoutYards = yardage * PRICE_YARD_BLACKOUT;
  const sheerYards = yardage * PRICE_YARD_SHEER;
  const laborBlackout = panel * PRICE_LABOR_PANEL;
  const laborSheer = panel * PRICE_LABOR_PANEL;
  const rod = rodPrice(widthIn);

  const total = blackoutYards + sheerYards + laborBlackout + laborSheer + rod;

  const lines = [
    { label: `${yardage} Yards Blackout`, amount: blackoutYards },
    { label: `${yardage} Yards Sheer`, amount: sheerYards },
    { label: `${panel} Labor Panel (Blackout)`, amount: laborBlackout },
    { label: `${panel} Labor Panel (Sheer)`, amount: laborSheer },
    { label: `S-Fold Rods (${widthIn}in)`, amount: rod },
  ];

  return {
    label: win.label?.trim() || "Window",
    heightIn, widthIn, totalHeightClearance, panel,
    yardageRaw, yardage, blackoutYards, sheerYards, laborBlackout, laborSheer, rod, total, lines,
  };
}

// ── "Additional" add-on line (not a full window) ─────────────────────────────
// The shop sometimes adds extra fabric on top of a base order (receipts show
// "Additional 16 yards blackout / 16 yards sheer / 8 labor panels" or sheer-only).
// It's a manual line: choose which fabrics, yards, and labor panels; price = the
// same per-unit constants. No H/W, no rod (rod belongs to the base window).
export type CurtainAddon = {
  blackoutYards: number; // 0 = none
  sheerYards: number;    // 0 = none
  laborPanels: number;   // 0 = none
};
export function computeAddon(a: CurtainAddon): { total: number; lines: { label: string; amount: number }[] } {
  const by = Math.max(0, Math.round(a.blackoutYards || 0));
  const sy = Math.max(0, Math.round(a.sheerYards || 0));
  const lp = Math.max(0, Math.round(a.laborPanels || 0));
  const lines: { label: string; amount: number }[] = [];
  if (by > 0) lines.push({ label: `${by} yards blackout`, amount: by * PRICE_YARD_BLACKOUT });
  // Labor per the guide is charged per fabric type; an add-on applies it once per
  // fabric present. Kept simple: labor panels × 200 for EACH fabric selected.
  if (sy > 0) lines.push({ label: `${sy} yards sheer`, amount: sy * PRICE_YARD_SHEER });
  const fabricTypes = (by > 0 ? 1 : 0) + (sy > 0 ? 1 : 0);
  if (lp > 0 && fabricTypes > 0) lines.push({ label: `${lp} labor panels`, amount: lp * PRICE_LABOR_PANEL * fabricTypes });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { total, lines };
}

// Grand total across all windows.
export function computeQuote(windows: CurtainWindow[]): { windows: CurtainQuote[]; grandTotal: number } {
  const quotes = windows.map((w, i) => computeWindow({ ...w, label: w.label?.trim() || `Window ${i + 1}` }));
  const grandTotal = quotes.reduce((s, q) => s + q.total, 0);
  return { windows: quotes, grandTotal };
}
