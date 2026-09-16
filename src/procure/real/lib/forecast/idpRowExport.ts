/**
 * Reorder Decisions — per-row export builder.
 *
 * SINGLE SOURCE OF TRUTH for the values displayed in every column of the
 * planner. The UI cells, the CSV download, and the emailed CSV attachment
 * all read from buildIdpExportRow → if you change a value here, all three
 * surfaces follow.
 *
 * Pure module. No React. Safe to import from the browser UI and from the
 * background email pipeline.
 */

import {
  computeIdpDaysToReorder,
  computeIdpRowMetrics,
  computeEffectiveTier,
  buildActionBadgeContent,
  colorNameForBg,
  formatPlannerDate,
  toNumberSafe,
  type ActionTierLabel,
} from "./idpMetrics";

export interface IdpExportRow {
  sku: string;
  /** Raw row reference (still useful when callers need fields not in the export). */
  raw: any;
  /** Effective action tier (post pu_status / no-demand overrides). */
  effectiveTier: ActionTierLabel | null;
  /** Cell values keyed by column key from buildIdpColumns(). */
  values: Record<string, unknown>;
  /** Formatted (display-ready) strings keyed by column key. CSV uses these. */
  formatted: Record<string, string>;
}

function roundOrEmpty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return String(Math.round(n));
}

/** UI deficit cell: "+12.5" / "-3.0" / "0". One decimal, leading sign. */
function formatDeficitText(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n < 0) return n.toFixed(1);
  if (n > 0) return `+${n.toFixed(1)}`;
  return "0";
}

/** UI revenue-loss cell: "$1,234" when >0, "-" otherwise. No cents. */
function formatRevenueLoss(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Build the export row for a single planner row. Mirrors the cell-level
 * rendering in MonthlyForecast.tsx's planner tbody — same rounding, same
 * pu_status / no-demand overrides, same action label.
 *
 * @param row raw merged row (after recomputeForecastRow).
 * @param todayMs reference timestamp for days-until-must-order.
 */
export function buildIdpExportRow(row: any, todayMs: number): IdpExportRow {
  const sku = String(row?.sku ?? "");

  const ninetyDayProjection = toNumberSafe(row?.ninety_day_projection) ?? 0;
  const ninetyDaySupply     = toNumberSafe(row?.ninety_day_supply) ?? 0;
  const ninetyDayDeficit    = toNumberSafe(row?.ninety_day_deficit) ?? 0;
  const revenueLoss         = toNumberSafe(row?.ninety_day_revenue_loss) ?? 0;
  const safetyStock         = toNumberSafe(row?.safety_stock) ?? 0;
  const orderRecommended    = toNumberSafe(row?.order_recommended) ?? 0;
  const leadTime            = toNumberSafe(row?.lead_time);

  const proj1 = toNumberSafe(row?.proj_month_1) ?? 0;
  const proj2 = toNumberSafe(row?.proj_month_2) ?? 0;
  const proj3 = toNumberSafe(row?.proj_month_3) ?? 0;
  const sup1  = toNumberSafe(row?.supply_month_1) ?? 0;
  const sup2  = toNumberSafe(row?.supply_month_2) ?? 0;
  const sup3  = toNumberSafe(row?.supply_month_3) ?? 0;

  const metrics = computeIdpRowMetrics(row);
  const daysOfSupply = metrics.daysOfSupply;
  const daysUntilMustOrderRunway = metrics.daysUntilMustOrder;
  const daysWithoutStock = metrics.daysWithoutStock;

  // Reorder-trigger countdown (uses lead time + deficit / first stockout month).
  // Distinct from `days_until_must_order` runway above (which is daysOfSupply-leadTime).
  const _daysToReorder = computeIdpDaysToReorder(row, todayMs);

  const effectiveTier = computeEffectiveTier(row);
  const badge = buildActionBadgeContent({
    effectiveTier,
    daysOfSupply,
    daysUntilMustOrder: daysUntilMustOrderRunway,
    daysWithoutStock,
    leadTime,
  });

  const orderDateRaw   = String(row?.order_date_forecast ?? "");
  const supplyMonthRaw = String(row?.supply_month_forecast ?? "");

  const values: Record<string, unknown> = {
    description: row?.description ?? "",
    sku,
    factory: row?.factory ?? "-",
    pu_status: row?.pu_status ?? "",
    proj_month_1: Math.round(proj1),
    proj_month_2: Math.round(proj2),
    proj_month_3: Math.round(proj3),
    supply_month_1: Math.round(sup1),
    supply_month_2: Math.round(sup2),
    supply_month_3: Math.round(sup3),
    ninety_day_projection: Math.round(ninetyDayProjection),
    ninety_day_supply: Math.round(ninetyDaySupply),
    ninety_day_deficit: ninetyDayDeficit, // raw — UI shows 1-decimal signed
    ninety_day_revenue_loss: revenueLoss,
    safety_stock: Math.round(safetyStock),
    order_recommended: Math.round(orderRecommended),
    lead_time: leadTime == null ? "" : Math.round(leadTime),
    order_date_forecast: orderDateRaw || "",
    supply_month_forecast: supplyMonthRaw || "",
    days_of_supply: daysOfSupply,
    days_until_must_order: daysUntilMustOrderRunway,
    days_without_stock: daysWithoutStock,
    action_label: badge.text,
    action_detail: badge.subtitle,
    status_color: colorNameForBg(badge.bg),
    priority: badge.priority,
  };

  const formatted: Record<string, string> = {
    description: String(values.description ?? ""),
    sku,
    factory: String(values.factory ?? "-"),
    pu_status: String(values.pu_status ?? ""),
    proj_month_1: roundOrEmpty(proj1),
    proj_month_2: roundOrEmpty(proj2),
    proj_month_3: roundOrEmpty(proj3),
    supply_month_1: roundOrEmpty(sup1),
    supply_month_2: roundOrEmpty(sup2),
    supply_month_3: roundOrEmpty(sup3),
    ninety_day_projection: roundOrEmpty(ninetyDayProjection),
    ninety_day_supply: roundOrEmpty(ninetyDaySupply),
    // UI shows signed 1-decimal (+12.5 / -3.0 / 0). Mirror exactly.
    ninety_day_deficit: formatDeficitText(ninetyDayDeficit),
    // UI shows "$1,234" (no decimals) when revenue_loss > 0, else "-". Match.
    ninety_day_revenue_loss: formatRevenueLoss(revenueLoss),
    safety_stock: roundOrEmpty(safetyStock),
    order_recommended: roundOrEmpty(orderRecommended),
    lead_time: leadTime == null ? "-" : `${Math.round(leadTime)}`,
    order_date_forecast: formatPlannerDate(orderDateRaw),
    supply_month_forecast: formatPlannerDate(supplyMonthRaw),
    // UI: "0" when zero, locale-formatted otherwise.
    days_of_supply:
      daysOfSupply > 0 ? daysOfSupply.toLocaleString("en-US") : "0",
    // UI: "—" when null, signed number otherwise.
    days_until_must_order:
      daysUntilMustOrderRunway == null
        ? "—"
        : daysUntilMustOrderRunway.toLocaleString("en-US"),
    // UI: "—" when zero, locale-formatted otherwise.
    days_without_stock:
      daysWithoutStock > 0 ? daysWithoutStock.toLocaleString("en-US") : "—",
    action_label: badge.text,
    action_detail: badge.subtitle,
    status_color: colorNameForBg(badge.bg),
    priority: badge.priority,
  };

  return { sku, raw: row, effectiveTier, values, formatted };
}

export function buildIdpExportRows(rows: any[], todayMs: number): IdpExportRow[] {
  return rows.map((r) => buildIdpExportRow(r, todayMs));
}
