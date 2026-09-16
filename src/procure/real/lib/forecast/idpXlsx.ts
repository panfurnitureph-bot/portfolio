/**
 * Reorder Decisions — styled XLSX exporter.
 *
 * Produces a workbook that visually mirrors the planner table in the UI:
 *   • Frozen two-row header (banner + column labels / month names)
 *   • Purple "Monthly Projection" + purple "Supply Plan" group banners
 *   • Forecast-analysis purple group and runway pink-red group
 *   • Alternating row tint matching the live grid
 *   • Red bold negatives for deficit / days-until-must-order / days-without-stock
 *   • Green Active pill for status; colored Action pill per tier
 *   • Centered numeric cells, left-aligned product cell with sku + variant
 *   • Group dividers (thick left border between sections)
 *
 * Single source: rows flow through buildIdpExportRow() — same formatter as
 * the planner UI cells. Column order/labels come from buildIdpColumns().
 *
 * Pure async function. ExcelJS is dynamically imported so the planner page
 * keeps its lazy-load behavior.
 */

import {
  buildIdpColumns,
  GROUP_BANNER_LABEL,
  type IdpColumn,
  type IdpColumnGroup,
} from "./idpColumns";
import { buildIdpExportRows } from "./idpRowExport";
import {
  buildActionBadgeContent,
  computeEffectiveTier,
  computeIdpRowMetrics,
  toNumberSafe,
} from "./idpMetrics";

export interface BuildIdpXlsxOptions {
  /** Rolling-window month names for projection + supply month columns. */
  monthNames: [string, string, string];
  /** Reference timestamp for derived metrics. Defaults to Date.now(). */
  todayMs?: number;
}

// ── ARGB palette matching the UI (FF prefix = alpha 100%). ─────────────
const ARGB = {
  bannerBg: "FFE5E7EB",          // group banner row
  basicLight: "FFF5F9FF",        // alt row basic
  basicDark:  "FFFFFFFF",
  projLight:  "FFFFFCE8",        // alt row projection (yellow)
  projDark:   "FFFFFFF7",
  supplyLight:"FFEEEAFF",        // alt row supply (light purple)
  supplyDark: "FFF5F3FF",
  forecastLight:"FFEEEAFF",      // alt row forecast/analysis
  forecastDark:"FFF5F3FF",
  runwayLight:"FFFFE4E1",        // alt row runway (pinkish)
  runwayDark: "FFFFF5F5",
  border:     "FFD1D5DB",
  divider:    "FF94A3B8",        // thick group divider
  headerProj: "FFFFF4CC",        // banner: Monthly Projection
  headerSupply:"FFE8D4FF",       // banner: Supply Plan
  headerForecast:"FFD6CCFF",     // banner: 90-Day Forecast
  headerRunway:"FFFFE4E1",       // banner: Supply Runway
  headerBasic:"FFEAF2FF",
  text:       "FF111827",
  textMuted:  "FF6B7280",
  negRed:     "FFDC2626",
  posGreen:   "FF16A34A",
  revLossRed: "FFDC2626",
} as const;

// Borders helpers
const thinBorder = {
  top:    { style: "thin" as const, color: { argb: ARGB.border } },
  left:   { style: "thin" as const, color: { argb: ARGB.border } },
  bottom: { style: "thin" as const, color: { argb: ARGB.border } },
  right:  { style: "thin" as const, color: { argb: ARGB.border } },
};
const dividerLeft = { style: "medium" as const, color: { argb: ARGB.divider } };

function bannerFillFor(group: IdpColumnGroup): string {
  switch (group) {
    case "projection": return ARGB.headerProj;
    case "supply":     return ARGB.headerSupply;
    case "forecast":   return ARGB.headerForecast;
    case "runway":     return ARGB.headerRunway;
    default:           return ARGB.headerBasic;
  }
}

function rowFillFor(group: IdpColumnGroup, alt: boolean): string {
  switch (group) {
    case "projection": return alt ? ARGB.projLight   : ARGB.projDark;
    case "supply":     return alt ? ARGB.supplyLight : ARGB.supplyDark;
    case "forecast":   return alt ? ARGB.forecastLight : ARGB.forecastDark;
    case "runway":     return alt ? ARGB.runwayLight   : ARGB.runwayDark;
    default:           return alt ? ARGB.basicLight    : ARGB.basicDark;
  }
}

// Group spans built once so we know where banners merge and where dividers go.
function groupRuns(columns: IdpColumn[]): { group: IdpColumnGroup; start: number; len: number }[] {
  const runs: { group: IdpColumnGroup; start: number; len: number }[] = [];
  let i = 0;
  while (i < columns.length) {
    let j = i;
    while (j < columns.length && columns[j].group === columns[i].group) j += 1;
    runs.push({ group: columns[i].group, start: i, len: j - i });
    i = j;
  }
  return runs;
}

function isCsvOnly(col: IdpColumn): boolean {
  return col.key === "action_detail" || col.key === "priority" || col.key === "status_color";
}

// Action badge → ARGB fill + font color.
function argbFromHex(hex: string): string {
  // "#dc2626" → "FFDC2626"; pass-through for words like "white".
  if (/^#[0-9a-f]{6}$/i.test(hex)) return `FF${hex.slice(1).toUpperCase()}`;
  if (hex === "white") return "FFFFFFFF";
  if (hex === "transparent") return "FFFFFFFF";
  return "FF000000";
}

export interface IdpXlsxResult {
  workbook: any; // ExcelJS.Workbook — keep loose so callers don't need exceljs types
  buffer: ArrayBuffer;
  rowCount: number;
}

/**
 * Build the styled XLSX. Returns workbook + serialized buffer.
 * Use the buffer directly for email attachment (base64-encode it) or write
 * with saveAs(blob) for a browser download.
 */
export async function buildIdpXlsx(
  rows: any[],
  opts: BuildIdpXlsxOptions,
): Promise<IdpXlsxResult> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Reorder Decisions";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("Reorder Decisions", {
    views: [
      // Freeze first column (Row #) + two header rows.
      { state: "frozen", xSplit: 1, ySplit: 2 },
    ],
  });

  const allColumns = buildIdpColumns(opts.monthNames);
  // Visible columns only — CSV-only computed cols (priority/status_color/
  // action_detail) are skipped here; the styled XLSX mirrors what the user
  // sees in the planner table.
  const columns = allColumns.filter((c) => !isCsvOnly(c));
  const runs = groupRuns(columns);

  // ─── Set widths ───────────────────────────────────────────────────
  ws.columns = [
    { width: 5 }, // row # column
    ...columns.map((c) => ({ width: c.width })),
  ];

  // ─── Row 1: banner row (group titles for multi-col groups, blank otherwise) ─
  const row1Values: (string | null)[] = [""]; // row # placeholder
  for (const col of columns) row1Values.push(GROUP_BANNER_LABEL[col.group] || "");
  const row1 = ws.addRow(row1Values);
  row1.height = 22;

  // Merge banner cells per group. Skip basic group (no banner).
  for (const run of runs) {
    if (run.len <= 1 && run.group === "basic") continue;
    if (run.group === "basic") continue;
    const startCol = run.start + 2; // +1 for # column, +1 for 1-based
    const endCol = startCol + run.len - 1;
    if (endCol > startCol) {
      ws.mergeCells(1, startCol, 1, endCol);
    }
  }

  // Style row 1.
  row1.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = { bold: true, size: 11, color: { argb: ARGB.text } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder;
    // Banner fill follows the group's tint.
    let fillArgb = ARGB.headerBasic;
    if (colNumber > 1) {
      const col = columns[colNumber - 2];
      fillArgb = bannerFillFor(col.group);
    }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
  });

  // ─── Row 2: column header labels ──────────────────────────────────
  const row2Values: string[] = ["#"];
  for (const col of columns) row2Values.push(col.label.replace(/\n/g, " "));
  const row2 = ws.addRow(row2Values);
  row2.height = 28;
  let lastGroup: IdpColumnGroup | null = null;
  row2.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    cell.font = { bold: true, size: 10, color: { argb: ARGB.text } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { ...thinBorder };
    if (colNumber === 1) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.headerBasic } };
      return;
    }
    const col = columns[colNumber - 2];
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bannerFillFor(col.group) } };
    // Thick left divider on the first cell of projection + forecast groups
    // matching the UI's slate-400 6px left border.
    if (col.group !== lastGroup && (col.group === "projection" || col.group === "forecast" || col.group === "runway")) {
      cell.border = { ...thinBorder, left: dividerLeft };
    }
    lastGroup = col.group;
  });

  // ─── Banner row 1 also gets the divider on its first cell per group. ─
  let bannerLastGroup: IdpColumnGroup | null = null;
  row1.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber === 1) return;
    const col = columns[colNumber - 2];
    if (col.group !== bannerLastGroup && (col.group === "projection" || col.group === "forecast" || col.group === "runway")) {
      cell.border = { ...thinBorder, left: dividerLeft };
    }
    bannerLastGroup = col.group;
  });

  // ─── Data rows ────────────────────────────────────────────────────
  const todayMs = opts.todayMs ?? Date.now();
  const exportRows = buildIdpExportRows(rows, todayMs);

  exportRows.forEach((exp, idx) => {
    const alt = idx % 2 === 0;
    const rowValues: any[] = [idx + 1];
    const numericKeys = new Set([
      "proj_month_1","proj_month_2","proj_month_3",
      "supply_month_1","supply_month_2","supply_month_3",
      "ninety_day_projection","ninety_day_supply","ninety_day_deficit",
      "ninety_day_revenue_loss","safety_stock","order_recommended","lead_time",
      "days_of_supply","days_until_must_order","days_without_stock",
    ]);
    for (const col of columns) {
      if (col.isDate) {
        // Use the formatted date string so the xlsx cell carries the same
        // human-readable label as the UI ("May 22, 2026").
        rowValues.push(exp.formatted[col.key] ?? "");
      } else if (numericKeys.has(col.key)) {
        const v = exp.values[col.key];
        if (v == null || v === "") {
          rowValues.push("");
        } else {
          const n = typeof v === "number" ? v : Number(v);
          rowValues.push(Number.isFinite(n) ? n : "");
        }
      } else {
        rowValues.push(exp.formatted[col.key] ?? "");
      }
    }
    const xRow = ws.addRow(rowValues);
    xRow.height = 26;

    // Style each cell.
    xRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: false };
      cell.border = thinBorder;
      cell.font = { size: 10, color: { argb: ARGB.text } };

      if (colNumber === 1) {
        // Row number cell.
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: alt ? ARGB.basicLight : ARGB.basicDark } };
        cell.font = { size: 9, color: { argb: ARGB.textMuted } };
        return;
      }
      const col = columns[colNumber - 2];
      const baseFill = rowFillFor(col.group, alt);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: baseFill } };

      // Group divider on the first cell of projection / forecast / runway groups.
      const prevCol = colNumber === 2 ? null : columns[colNumber - 3];
      if (
        (!prevCol || prevCol.group !== col.group) &&
        (col.group === "projection" || col.group === "forecast" || col.group === "runway")
      ) {
        cell.border = { ...thinBorder, left: dividerLeft };
      }

      // ── Per-column conditional formatting + alignment overrides ──
      if (col.key === "description") {
        cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
        cell.font = { size: 10, color: { argb: ARGB.text }, bold: true };
      }
      if (col.key === "sku") {
        cell.font = { size: 10, color: { argb: ARGB.text }, name: "Consolas" };
      }

      // pu_status: render Active-style pill via cell fill + bold text.
      if (col.key === "pu_status") {
        const txt = String(cell.value ?? "").trim().toLowerCase();
        if (txt === "active") {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } }; // light green
          cell.font = { size: 10, color: { argb: "FF166534" }, bold: true };
        } else if (txt === "discontinued" || txt === "discontinued active as a new sku") {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
          cell.font = { size: 10, color: { argb: "FF991B1B" }, bold: true };
        } else if (txt) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
          cell.font = { size: 10, color: { argb: "FF334155" }, bold: true };
        }
      }

      // Numeric formatting + red negatives.
      if (typeof cell.value === "number") {
        if (col.key === "ninety_day_revenue_loss") {
          cell.numFmt = '"$"#,##0;[Red]-"$"#,##0';
          if (cell.value > 0) cell.font = { size: 10, color: { argb: ARGB.revLossRed }, bold: true };
        } else {
          cell.numFmt = "#,##0;[Red]-#,##0";
        }
        if (cell.value < 0) {
          cell.font = { size: 10, color: { argb: ARGB.negRed }, bold: true };
        }
      }

      // Deficit emphasis even on positive surplus (bold black).
      if (col.key === "ninety_day_deficit" && typeof cell.value === "number" && cell.value > 0) {
        cell.font = { size: 10, color: { argb: "FF000000" }, bold: true };
      }

      // Days without stock: bold red whenever > 0.
      if (col.key === "days_without_stock" && typeof cell.value === "number" && cell.value > 0) {
        cell.font = { size: 10, color: { argb: ARGB.negRed }, bold: true };
      }

      // Action label cell → colored pill mirroring the UI badge.
      if (col.key === "action_label") {
        const tier = computeEffectiveTier(exp.raw);
        const metrics = computeIdpRowMetrics(exp.raw);
        const leadTime = toNumberSafe(exp.raw?.lead_time);
        const badge = buildActionBadgeContent({
          effectiveTier: tier,
          daysOfSupply: metrics.daysOfSupply,
          daysUntilMustOrder: metrics.daysUntilMustOrder,
          daysWithoutStock: metrics.daysWithoutStock,
          leadTime,
        });
        // Combine main label + subtitle on two lines for the spreadsheet cell.
        const labelLines = badge.subtitle
          ? `${badge.text}\n${badge.subtitle}`
          : badge.text;
        cell.value = labelLines;
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argbFromHex(badge.bg) } };
        cell.font = { size: 10, color: { argb: argbFromHex(badge.color) }, bold: true };
        // Bumping height for two-line action text.
        if (badge.subtitle && xRow.height < 32) xRow.height = 36;
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { workbook, buffer: buffer as ArrayBuffer, rowCount: exportRows.length };
}

/** Suggested filename, e.g. `purchasing_report_05242026.xlsx`. */
export function idpXlsxFilename(date = new Date()): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `purchasing_report_${mm}${dd}${yyyy}.xlsx`;
}

/** Base64-encode an ArrayBuffer for n8n payloads. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
  }
  // btoa exists in browser global; n8n autosend pipeline runs in browser.
  return btoa(binary);
}
