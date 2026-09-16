/**
 * Reorder Decisions — pure metric helpers.
 *
 * Single source of truth for the math + tier classification used in BOTH the
 * planner UI cells and the CSV export. Lifted out of MonthlyForecast.tsx so
 * the email/CSV pipeline can reuse it without duplicating the logic (the
 * 145-vs-201 / xlsx-drift class of bugs).
 *
 * Pure module. No React. No DB. Safe to import from anywhere.
 */

const PLANNER_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function normText(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

export function toNumberSafe(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function formatPlannerDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "-";
  return PLANNER_DATE_FMT.format(d);
}

export function puStatusCanonical(v: unknown): string {
  const raw = String(v ?? "").trim();
  const n = raw.toLowerCase().replace(/\s+/g, " ");
  if (n === "discontinued" || n === "discontinued active as a new sku") {
    return "Discontinued";
  }
  return raw;
}

export function puStatusSkipsReorder(v: unknown): boolean {
  const n = normText(v).replace(/\s+/g, " ");
  if (n === "discontinued") return true;
  if (n === "discontinued active as a new sku") return true;
  if (n.includes("item data creation")) return true;
  if (n.includes("part component")) return true;
  return false;
}

export function puStatusOverrideLabel(v: unknown): string | null {
  const n = normText(v).replace(/\s+/g, " ");
  if (n === "discontinued") return "Discontinued";
  if (n === "discontinued active as a new sku") return "Discontinued";
  if (n.includes("item data creation")) return "In Progress";
  if (n.includes("part component")) return "In Progress";
  return null;
}

export const ACTION_TIER = {
  URGENT:       "Urgent",
  ORDER_30:     "Order Within 20 Days",
  ORDER_60:     "Order Within 45 Days",
  ORDER_90:     "Order Within 75 Days",
  NO_ACTION:    "Covered",
  MISSING_LT:   "Missing LT",
  // Loader safeguard: row has no inventory data at all (oh_inv/otw/on_order
  // all NULL). Isolated so NULL-as-zero can never fake an Urgent.
  MISSING_INV:  "Missing Inventory",
  NO_DEMAND:    "No Demand",
  IN_PROGRESS:  "In Progress",
  DISCONTINUED: "Discontinued",
} as const;
export type ActionTierLabel = typeof ACTION_TIER[keyof typeof ACTION_TIER];

export const ACTION_TIER_ORDER: ActionTierLabel[] = [
  ACTION_TIER.URGENT,
  ACTION_TIER.ORDER_30,
  ACTION_TIER.ORDER_60,
  ACTION_TIER.ORDER_90,
  ACTION_TIER.NO_ACTION,
  ACTION_TIER.MISSING_LT,
  ACTION_TIER.MISSING_INV,
  ACTION_TIER.NO_DEMAND,
  ACTION_TIER.IN_PROGRESS,
  ACTION_TIER.DISCONTINUED,
];

export const ACTION_TIER_RANK: Record<ActionTierLabel, number> = Object.fromEntries(
  ACTION_TIER_ORDER.map((label, i) => [label, i]),
) as Record<ActionTierLabel, number>;
export const ACTION_TIER_RANK_NULL = ACTION_TIER_RANK[ACTION_TIER.NO_ACTION] + 0.5;

export const ACTION_TIER_THEME: Record<ActionTierLabel, { bg: string; color: string }> = {
  [ACTION_TIER.URGENT]:       { bg: "#dc2626", color: "white" },
  [ACTION_TIER.ORDER_30]:     { bg: "#ea580c", color: "white" },
  [ACTION_TIER.ORDER_60]:     { bg: "#ca8a04", color: "white" },
  [ACTION_TIER.ORDER_90]:     { bg: "#16a34a", color: "white" },
  [ACTION_TIER.NO_ACTION]:    { bg: "#e5e7eb", color: "#4b5563" },
  [ACTION_TIER.MISSING_LT]:   { bg: "#eab308", color: "white" },
  [ACTION_TIER.MISSING_INV]:  { bg: "#a855f7", color: "white" },
  [ACTION_TIER.NO_DEMAND]:    { bg: "#e5e7eb", color: "#4b5563" },
  [ACTION_TIER.IN_PROGRESS]:  { bg: "#e5e7eb", color: "#4b5563" },
  [ACTION_TIER.DISCONTINUED]: { bg: "#e5e7eb", color: "#4b5563" },
};

export function computeIdpDaysToReorder(row: any, todayMs: number): number | null {
  const leadRaw = row?.lead_time;
  const lead = leadRaw == null || leadRaw === "" ? null : Number(leadRaw);
  if (lead == null || !Number.isFinite(lead)) return null;

  const today = new Date(todayMs);
  const ninetyDayDeficit = Number(row?.ninety_day_deficit ?? 0);

  if (Number.isFinite(ninetyDayDeficit) && ninetyDayDeficit > 0) {
    const cm = row?.covered_months;
    if (cm) {
      const cmParsed = new Date(cm);
      if (!isNaN(cmParsed.getTime())) {
        const daysOfCoverage = Math.round((cmParsed.getTime() - todayMs) / 86400000);
        return daysOfCoverage - lead;
      }
    }
    const farHorizon = new Date(today.getFullYear(), today.getMonth() + 11, 1);
    const days = Math.max(0, Math.round((farHorizon.getTime() - todayMs) / 86400000));
    return days - lead;
  }

  let stockoutMonthIdx: number | null = null;
  for (let i = 1; i <= 12; i++) {
    const raw = row?.[`supply_month_${i}`];
    const v = raw == null || raw === "" ? null : Number(raw);
    if (v != null && Number.isFinite(v) && v < 0) {
      stockoutMonthIdx = i;
      break;
    }
  }
  const horizonIdx = stockoutMonthIdx ?? 12;
  const horizonDate = new Date(today.getFullYear(), today.getMonth() + (horizonIdx - 1), 1);
  const daysUntilStockout = Math.max(
    0,
    Math.round((horizonDate.getTime() - todayMs) / 86400000),
  );
  return daysUntilStockout - lead;
}

// NOTE: `__raw_ninety_day_*` now carry the UI-computed 90-day figures (set by
// the recompute from the displayed monthly values) — the Forecast UI is the
// source of truth for the planner, not the loader's stored columns.
export function computeIdpRowMetrics(row: any): {
  daysOfSupply: number;
  daysUntilMustOrder: number | null;
  daysWithoutStock: number;
  actionTier: ActionTierLabel | null;
} {
  const projRaw =
    row?.__raw_ninety_day_projection != null && row.__raw_ninety_day_projection !== ""
      ? Number(row.__raw_ninety_day_projection)
      : Number(row?.ninety_day_projection ?? 0);
  const supplyRaw =
    row?.__raw_ninety_day_supply != null && row.__raw_ninety_day_supply !== ""
      ? Number(row.__raw_ninety_day_supply)
      : Number(row?.ninety_day_supply ?? 0);
  const deficitRaw =
    row?.__raw_ninety_day_deficit != null && row.__raw_ninety_day_deficit !== ""
      ? Number(row.__raw_ninety_day_deficit)
      : Number(row?.ninety_day_deficit ?? 0);

  const proj = projRaw;
  const dailyRate = Number.isFinite(proj) && proj > 0 ? proj / 90 : 0;
  const supply90 = supplyRaw;
  const leadRaw = row?.lead_time;
  const lead = leadRaw == null || leadRaw === "" ? null : Number(leadRaw);

  const daysOfSupply =
    dailyRate > 0 && Number.isFinite(supply90) && supply90 > 0
      ? Math.floor(supply90 / dailyRate)
      : 0;

  const daysUntilMustOrder =
    lead != null && Number.isFinite(lead) ? daysOfSupply - lead : null;

  const deficit = deficitRaw;
  const daysWithoutStock =
    dailyRate > 0 && Number.isFinite(deficit) && deficit < 0
      ? Math.floor(Math.abs(deficit) / dailyRate)
      : 0;

  const inventoryMissing =
    (row?.oh_inv == null || row?.oh_inv === "") &&
    (row?.otw_units == null || row?.otw_units === "") &&
    (row?.on_order_units == null || row?.on_order_units === "");

  let actionTier: ActionTierLabel | null = null;
  if (dailyRate > 0) {
    if (inventoryMissing) {
      actionTier = ACTION_TIER.MISSING_INV;
    } else if (lead == null || !Number.isFinite(lead) || lead <= 0) {
      actionTier = ACTION_TIER.MISSING_LT;
    } else if (Number.isFinite(deficit) && deficit < 0) {
      actionTier = ACTION_TIER.URGENT;
    } else if (daysUntilMustOrder != null) {
      if (daysUntilMustOrder <= 0) actionTier = ACTION_TIER.URGENT;
      else if (daysUntilMustOrder <= 20) actionTier = ACTION_TIER.ORDER_30;
      else if (daysUntilMustOrder <= 45) actionTier = ACTION_TIER.ORDER_60;
      else if (daysUntilMustOrder <= 75) actionTier = ACTION_TIER.ORDER_90;
      else actionTier = ACTION_TIER.NO_ACTION;
    }
  }

  return { daysOfSupply, daysUntilMustOrder, daysWithoutStock, actionTier };
}

/**
 * Action-cell content for a row. Mirrors the UI badge exactly — same text,
 * subtitle, bg, color. UI overlays a lucide icon on top using `iconName`;
 * CSV/email use the same `text` + `subtitle` strings the buyer reads.
 *
 * Keep this in sync with the planner Action cell. The CSV's "Action" /
 * "Action Detail" columns echo `text` / `subtitle` literally.
 */
export type ActionIconName =
  | "MinusCircle"
  | "AlertCircle"
  | "AlertOctagon"
  | "Clock"
  | "Bell"
  | "CheckCircle2"
  | null;

export interface ActionBadgeContent {
  iconName: ActionIconName;
  text: string;
  subtitle: string;
  bg: string;
  color: string;
  /** Semantic priority for CSV export. Maps badge color to a tier word. */
  priority: "Critical" | "High" | "Medium" | "Healthy" | "Info" | "None";
}

export function buildActionBadgeContent(args: {
  effectiveTier: ActionTierLabel | null;
  daysOfSupply: number;
  daysUntilMustOrder: number | null;
  daysWithoutStock: number;
  leadTime: number | null;
}): ActionBadgeContent {
  const { effectiveTier, daysOfSupply, daysUntilMustOrder, daysWithoutStock, leadTime } = args;
  const lt = leadTime != null && Number.isFinite(leadTime) ? Math.round(leadTime) : null;
  const ltStr = lt != null ? `${lt} days` : "—";

  if (effectiveTier === ACTION_TIER.DISCONTINUED) {
    return { iconName: "MinusCircle", text: "Discontinued", subtitle: "", bg: "#e5e7eb", color: "#4b5563", priority: "None" };
  }
  if (effectiveTier === ACTION_TIER.IN_PROGRESS) {
    return { iconName: "MinusCircle", text: "In Progress", subtitle: "", bg: "#e5e7eb", color: "#4b5563", priority: "Info" };
  }
  if (effectiveTier === ACTION_TIER.NO_DEMAND) {
    return { iconName: "MinusCircle", text: "No demand", subtitle: "No sales activity", bg: "#e5e7eb", color: "#4b5563", priority: "None" };
  }
  if (effectiveTier === ACTION_TIER.MISSING_LT) {
    return { iconName: "AlertCircle", text: "Missing lead time", subtitle: "Cannot compute timing", bg: "#fef3c7", color: "#854d0e", priority: "Medium" };
  }
  if (effectiveTier === ACTION_TIER.MISSING_INV) {
    return { iconName: "AlertCircle", text: "Missing inventory data", subtitle: "No OH / OTW / on-order in the last load — check the loader", bg: "#f3e8ff", color: "#6b21a8", priority: "Info" };
  }
  if (effectiveTier === ACTION_TIER.URGENT) {
    if (daysOfSupply === 0) {
      return {
        iconName: "AlertOctagon",
        text: "No stock available",
        subtitle: `Losing sales now · Restock arrives in ${ltStr}`,
        bg: "#b91c1c",
        color: "white",
        priority: "Critical",
      };
    }
    const empty = daysWithoutStock > 0 ? ` · ${daysWithoutStock} days empty` : "";
    return {
      iconName: "Clock",
      text: `Stock runs out in ${daysOfSupply} days`,
      subtitle: `Restock arrives in ${ltStr}${empty}`,
      bg: "#fee2e2",
      color: "#b91c1c",
      priority: "Critical",
    };
  }
  if (effectiveTier === ACTION_TIER.ORDER_30) {
    const dumo = daysUntilMustOrder ?? 0;
    if (dumo <= 7) {
      return {
        iconName: "Bell",
        text: `Place order within ${dumo} days`,
        subtitle: "Order now = no stockout",
        bg: "#fed7aa",
        color: "#9a3412",
        priority: "High",
      };
    }
    return {
      iconName: "Bell",
      text: `Place order within ${dumo} days`,
      subtitle: `Stock lasts ${daysOfSupply} days · Lead time ${ltStr}`,
      bg: "#fed7aa",
      color: "#9a3412",
      priority: "High",
    };
  }
  if (
    effectiveTier === ACTION_TIER.ORDER_60 ||
    effectiveTier === ACTION_TIER.ORDER_90 ||
    effectiveTier === ACTION_TIER.NO_ACTION
  ) {
    const dumo = daysUntilMustOrder;
    return {
      iconName: "CheckCircle2",
      text: `Stock good for ${daysOfSupply} days`,
      subtitle: dumo != null ? `Next order in ${dumo} days` : "",
      bg: "#dcfce7",
      color: "#15803d",
      priority: effectiveTier === ACTION_TIER.NO_ACTION ? "Healthy" : "Medium",
    };
  }
  return { iconName: null, text: "—", subtitle: "", bg: "transparent", color: "#9ca3af", priority: "None" };
}

/** Convert a hex bg color to a human label for CSV. */
export function colorNameForBg(bg: string): string {
  const c = bg.toLowerCase();
  if (c === "#b91c1c" || c === "#dc2626") return "Red";
  if (c === "#fee2e2") return "Light Red";
  if (c === "#fed7aa" || c === "#ea580c") return "Orange";
  if (c === "#fef3c7" || c === "#eab308" || c === "#ca8a04") return "Yellow";
  if (c === "#dcfce7" || c === "#16a34a") return "Green";
  if (c === "#e5e7eb") return "Gray";
  if (c === "transparent") return "";
  return bg;
}

export function computeEffectiveTier(row: any): ActionTierLabel | null {
  const puStatus = row?.pu_status;
  const ninetyDayProjection = Number(row?.ninety_day_projection ?? 0) || 0;
  const override = puStatusOverrideLabel(puStatus);
  if (override === "Discontinued") return ACTION_TIER.DISCONTINUED;
  if (override === "In Progress") return ACTION_TIER.IN_PROGRESS;
  if (ninetyDayProjection === 0) return ACTION_TIER.NO_DEMAND;
  return computeIdpRowMetrics(row).actionTier;
}

export function actionLabelForTier(tier: ActionTierLabel | null): string {
  if (tier === ACTION_TIER.URGENT)    return "Urgent Restock";
  if (tier === ACTION_TIER.ORDER_30)  return "Order Soon";
  if (tier === ACTION_TIER.ORDER_60)  return "Plan Order";
  if (tier === ACTION_TIER.ORDER_90)  return "Plan Order";
  if (tier === ACTION_TIER.NO_ACTION) return "No Action";
  return tier ?? "—";
}
