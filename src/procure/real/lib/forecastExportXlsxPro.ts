/**
 * Demand Planner — Pixel-Perfect XLSX Export
 *
 * PRIORITY 1: Exact displayed data (Sheet 1 — no formulas, matches UI 1:1)
 * PRIORITY 2: Formula reference for audit (Sheet 2)
 */
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import type { SchemaColumn } from "@/hooks/usePredictiveSchema";
import { isNumericType, isDateType, isBoolType, formatCellValue } from "@/hooks/usePredictiveSchema";

/* ================================================================
 * SECTION COLORS — exact hex from the dashboard headerBg classes
 * ================================================================ */
const SECTION_FILL: Record<string, string> = {
  basic:                  "FFEAF2FF",
  instock:                "FFF5FF2A",
  sales_monthly:          "FFFFE08A",
  sales_metrics:          "FFFFE08A",
  projection:             "FF4CFF4C",
  inventory:              "FFD9E8FF",
  incoming:               "FFC8FFF1",
  rates:                  "FFFFE6A6",
  order:                  "FFFFD9B3",
  supply_plan:            "FFD6CCFF",
  replacement:            "FFFFD0E6",
  replacement_inventory:  "FFFFD0E6",
  replacement_incoming:   "FFFFD0E6",
  other:                  "FFEAF2FF",
};

const ROW_TINT: Record<string, [string, string]> = {
  basic:                  ["FFF5F9FF", "FFFFFFFF"],
  instock:                ["FFFFFCE8", "FFFFFFFA"],
  sales_monthly:          ["FFFFF8E1", "FFFFFDF5"],
  sales_metrics:          ["FFFFF8E1", "FFFFFDF5"],
  projection:             ["FFE8FFE8", "FFF5FFF5"],
  inventory:              ["FFEDF3FF", "FFF7FAFF"],
  incoming:               ["FFE6FFF8", "FFF0FFF9"],
  rates:                  ["FFFFF5E0", "FFFFFBF0"],
  order:                  ["FFFFF0E5", "FFFFF8F2"],
  supply_plan:            ["FFEEEAFF", "FFF5F3FF"],
  replacement:            ["FFFFE8F2", "FFFFF2F8"],
  replacement_inventory:  ["FFFFE8F2", "FFFFF2F8"],
  replacement_incoming:   ["FFFFE8F2", "FFFFF2F8"],
  other:                  ["FFF5F9FF", "FFFFFFFF"],
};

const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFB0B8C4" } };
const THICK: Partial<ExcelJS.Border> = { style: "medium", color: { argb: "FF475569" } };

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parsePercentFraction(v: unknown): number | null {
  if (v == null) return null;

  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return Math.abs(v) > 1 ? v / 100 : v;
  }

  if (typeof v === "string") {
    const s = v.replace(/—/g, "-").trim();
    if (!s || s === "-") return null;

    const hasPercent = s.includes("%");
    const n = Number(s.replace(/,/g, "").replace("%", ""));
    if (!Number.isFinite(n)) return null;

    if (hasPercent) return n / 100;
    return Math.abs(n) > 1 ? n / 100 : n;
  }

  return null;
}

function resolveUiDisplayValue(v: unknown, dataType: string): string {
  let { display } = formatCellValue(v, dataType);
  if (typeof display === "string") display = display.replace(/—/g, "-");
  const text = String(display ?? "").trim();
  return text || "-";
}

function formatDate(v: unknown): string | null {
  if (!v) return null;
  let d: Date | null = null;
  if (v instanceof Date) d = v;
  else if (typeof v === "string") {
    const mdy = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (mdy) d = new Date(+mdy[3], +mdy[1] - 1, +mdy[2]);
    else { const p = new Date(v); if (!isNaN(p.getTime())) d = p; }
  }
  if (!d) return null;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(d);
}

function colLetter(oneBasedIdx: number): string {
  let r = "", n = oneBasedIdx;
  while (n > 0) { n--; r = String.fromCharCode(65 + (n % 26)) + r; n = Math.floor(n / 26); }
  return r;
}

/* ================================================================
 * PILL / BADGE STYLING
 * ================================================================ */
const W = "FFFFFFFF";
type PillResult = { fill: string; font: string } | null;

function getPillStyle(colName: string, raw: unknown): PillResult {
  const n = String(raw ?? "").trim().toLowerCase();
  switch (colName) {
    case "priority_level":
      if (n.includes("1st")) return { fill: "FFEF4444", font: W };
      if (n.includes("2nd")) return { fill: "FFF59E0B", font: W };
      if (n.includes("least")) return { fill: "FF3B82F6", font: W };
      return null;
    case "status":
      if (n === "active") return { fill: "FF16A34A", font: W };
      if (n === "inactive") return { fill: "FFEF4444", font: W };
      return null;
    case "supply_status":
      if (n === "good") return { fill: "FF16A34A", font: W };
      if (n === "critical") return { fill: "FFEF4444", font: W };
      return null;
    case "sku_status":
      if (n === "new sku") return { fill: "FF16A34A", font: W };
      if (n === "not new sku") return { fill: "FF3B82F6", font: W };
      return null;
    case "kit":
      if (n === "yes" || raw === true) return { fill: "FF0F172A", font: W };
      return { fill: "FFE2E8F0", font: "FF1E293B" };
    default:
      return null;
  }
}

const PILL_COLUMNS = new Set(["status", "priority_level", "kit", "sku_status", "supply_status"]);

/* ================================================================
 * EXPORT OPTIONS INTERFACE
 * ================================================================ */
export interface ExportProOptions {
  schema: SchemaColumn[];
  headerGroups: { key: string; start: number; end: number }[];
  filteredData: Record<string, unknown>[];
  groupKey: (col: string) => string;
  labelForColumnDynamic: (col: string) => string;
  groupHeaderLabel: (groupKey: string) => string;
  filename?: string;
  /** When true, computed columns (Sales Diff, Velocity, Projection) use real Excel formulas */
  useFormulas?: boolean;
}

/* ================================================================
 * MAIN EXPORT FUNCTION
 * ================================================================ */
export async function exportForecastDashboardXlsx({
  schema,
  headerGroups,
  filteredData,
  groupKey: getGroup,
  labelForColumnDynamic,
  groupHeaderLabel,
  filename = "forecast_report",
  useFormulas = false,
}: ExportProOptions): Promise<number> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Northwind Dashboard";
  wb.created = new Date();

  const colCount = schema.length;
  const rowCount = filteredData.length;

  const colGroup: string[] = schema.map(c => getGroup(c.column_name));
  const isGroupStart: boolean[] = colGroup.map((g, i) => i === 0 || colGroup[i - 1] !== g);
  const isGroupEnd: boolean[] = colGroup.map((g, i) => i === colCount - 1 || colGroup[i + 1] !== g);

  const idxOf = (name: string) => schema.findIndex(c => c.column_name === name);
  const sm1Idx = idxOf("sales_month_1");
  const sm2Idx = idxOf("sales_month_2");
  const sm3Idx = idxOf("sales_month_3");
  const sdIdx = idxOf("sales_diff");
  const svIdx = idxOf("sales_velocity");
  const mpIdx = idxOf("monthly_projection");

  const centerAlign: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle" };

  /* ════════════════════════════════════════════════════════
   * SHEET 1: FORECAST REPORT — exact displayed values
   * ════════════════════════════════════════════════════════ */
  const ws = wb.addWorksheet("Demand Planner");

  /* ── ROW 1: Merged Section Title Headers ── */
  ws.getRow(1).height = 32;
  for (const g of headerGroups) {
    const startCol = g.start + 1;
    const endCol = g.end + 1;
    if (startCol !== endCol) ws.mergeCells(1, startCol, 1, endCol);
    const cell = ws.getCell(1, startCol);
    cell.value = groupHeaderLabel(g.key);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL[g.key] ?? SECTION_FILL.other } };
    cell.font = { bold: true, size: 12, color: { argb: "FF1E293B" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { top: THICK, bottom: THICK, left: THICK, right: THICK };
  }

  /* ── ROW 2: Column Sub-Headers ── */
  ws.getRow(2).height = 52;
  for (let c = 0; c < colCount; c++) {
    const cell = ws.getCell(2, c + 1);
    cell.value = labelForColumnDynamic(schema[c].column_name).replace(/\n/g, "\r\n");
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL[colGroup[c]] ?? SECTION_FILL.other } };
    cell.font = { bold: true, size: 10, color: { argb: "FF1E293B" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: THICK, bottom: THICK,
      left: isGroupStart[c] ? THICK : THIN,
      right: isGroupEnd[c] ? THICK : THIN,
    };
  }

  /* ── Column Widths ── */
  const FIXED_WIDTHS: Record<string, number> = {
    sku: 18, description: 48, priority_level: 18, factory: 14, status: 12, kit: 8,
    category: 16, supply_status: 16, sku_status: 14, po_number: 14,
    factory_latest_po_ordered: 18, order_date: 16, supply_month: 16, country: 12,
    order_proposal_qty: 14, months_worth: 12, cbm: 10, total_cbm_approved: 14,
    replacement_sku: 18, replacement_rate: 14, return_rate: 12, unshipped: 12,
    buyer_notes: 20, planner_notes: 20, po_notes: 20, analyst_notes: 20,
    sales_diff: 14, sales_velocity: 14, monthly_projection: 16, actual_sale_of_month: 14,
  };
  for (let c = 0; c < colCount; c++) {
    ws.getColumn(c + 1).width = FIXED_WIDTHS[schema[c].column_name] ?? (isNumericType(schema[c].data_type) ? 12 : 16);
  }

  /* ── DATA ROWS (starting row 3) — write EXACT displayed values ── */
  const DATA_START = 3;
  const defaultFont: Partial<ExcelJS.Font> = { size: 10, color: { argb: "FF1E293B" } };
  const dimFont: Partial<ExcelJS.Font> = { size: 10, color: { argb: "FF9CA3AF" } };
  const leftAlign: Partial<ExcelJS.Alignment> = { horizontal: "left", vertical: "middle", wrapText: true };

  for (let r = 0; r < rowCount; r++) {
    const row = filteredData[r];
    const excelRow = r + DATA_START;
    ws.getRow(excelRow).height = 22;
    const isOddRow = r % 2 === 0;

    for (let c = 0; c < colCount; c++) {
      const cn = schema[c].column_name;
      const v = row[cn];
      const cell = ws.getCell(excelRow, c + 1);
      const grp = colGroup[c];

      cell.border = {
        top: THIN, bottom: THIN,
        left: isGroupStart[c] ? THICK : THIN,
        right: isGroupEnd[c] ? THICK : THIN,
      };
      cell.alignment = cn === "description" ? leftAlign : centerAlign;
      cell.font = { ...defaultFont };

      const tint = ROW_TINT[grp] ?? ROW_TINT.other;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isOddRow ? tint[0] : tint[1] } };

      /* ── VALUE RESOLUTION — all columns go through the same path ── */
      const isEmpty = v == null || v === "" || v === "-";
      const nv = toNum(v);
      const isZero = !isEmpty && nv === 0;
      const isInstock = /^month_[1-5]$/i.test(cn);
      const isNumCol = isNumericType(schema[c].data_type);
      const isDisplayEmpty = isEmpty || (isNumCol && isZero);

      // Sales Diff — formula mode: =IFERROR((Feb-Jan)/Jan, 0)
      if (cn === "sales_diff") {
        if (useFormulas && sm2Idx >= 0 && sm3Idx >= 0) {
          const febCol = colLetter(sm2Idx + 1);
          const janCol = colLetter(sm3Idx + 1);
          cell.value = { formula: `IFERROR((${febCol}${excelRow}-${janCol}${excelRow})/${janCol}${excelRow},0)` } as any;
          cell.numFmt = "0%";
        } else {
          const uiDisplay = resolveUiDisplayValue(v, schema[c].data_type);
          const rawIsZeroNumeric = isNumericType(schema[c].data_type) && toNum(v) === 0;
          if (uiDisplay === "-" || rawIsZeroNumeric) {
            cell.value = "-";
            cell.font = dimFont;
          } else {
            const pct = parsePercentFraction(uiDisplay) ?? parsePercentFraction(v);
            if (pct != null) {
              cell.value = pct;
              cell.numFmt = "0%";
            } else {
              cell.value = uiDisplay;
            }
          }
        }
      }
      // Sales Velocity — formula mode: =IFERROR(AVERAGE(sm1, sm2, sm3), 0)
      else if (cn === "sales_velocity") {
        if (useFormulas && sm1Idx >= 0 && sm2Idx >= 0 && sm3Idx >= 0) {
          const refs = [sm1Idx, sm2Idx, sm3Idx].map(i => colLetter(i + 1) + excelRow).join(",");
          cell.value = { formula: `IFERROR(AVERAGE(${refs}),0)` } as any;
          cell.numFmt = "#,##0";
        } else {
          if (isDisplayEmpty) {
            cell.value = "-";
            cell.font = dimFont;
          } else if (nv != null) {
            cell.value = nv;
            cell.numFmt = "#,##0";
          } else {
            cell.value = "-";
            cell.font = dimFont;
          }
        }
      }
      // Monthly Projection — formula mode: =VelocityCell * 30
      else if (cn === "monthly_projection") {
        if (useFormulas && svIdx >= 0) {
          const velCol = colLetter(svIdx + 1);
          cell.value = { formula: `${velCol}${excelRow}*30` } as any;
          cell.numFmt = "#,##0";
        } else {
          if (isDisplayEmpty) {
            cell.value = "-";
            cell.font = dimFont;
          } else if (nv != null) {
            cell.value = nv;
            cell.numFmt = "#,##0";
          } else {
            cell.value = "-";
            cell.font = dimFont;
          }
        }
      }
      // Kit column
      else if (cn === "kit") {
        if (isEmpty || v == null) { cell.value = "-"; cell.font = dimFont; }
        else cell.value = v ? "Yes" : "No";
      }
      // Date columns
      else if (isDateType(schema[c].data_type)) {
        cell.value = isEmpty ? "-" : (formatDate(v) ?? String(v));
        if (cell.value === "-") cell.font = dimFont;
      }
      // Bool columns
      else if (isBoolType(schema[c].data_type)) {
        if (isEmpty) { cell.value = "-"; cell.font = dimFont; }
        else cell.value = v ? "Yes" : "No";
      }
      // Numeric columns
      else if (isNumCol) {
        if (isDisplayEmpty) {
          cell.value = "-";
          cell.font = dimFont;
        } else if (nv != null) {
          cell.value = isInstock ? Math.min(nv, 100) : nv;
          cell.numFmt = isInstock ? "0.00" : "#,##0";
        } else {
          cell.value = "-";
          cell.font = dimFont;
        }
      }
      // Text columns
      else {
        const s = isEmpty ? "-" : String(v).replace(/—/g, "-");
        cell.value = s.trim() === "" ? "-" : s;
        if (cell.value === "-") cell.font = dimFont;
      }

      /* ── ACTUAL SALES — Fixed Blue ── */
      if (cn === "actual_sale_of_month") {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
        cell.font = isDisplayEmpty
          ? { size: 10, color: { argb: "FF93C5FD" } }
          : { bold: true, size: 10, color: { argb: "FF1E3A8A" } };
      }

      /* ── PILL STYLING ── */
      if (!isDisplayEmpty && PILL_COLUMNS.has(cn)) {
        const pill = getPillStyle(cn, v);
        if (pill) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: pill.fill } };
          cell.font = { bold: true, size: 10, color: { argb: pill.font } };
        }
      }

      /* ── OH INV — red bold for non-zero ── */
      if ((cn === "oh_inv" || cn === "repl_oh_inv") && !isDisplayEmpty && nv != null && nv !== 0) {
        cell.font = { bold: true, size: 10, color: { argb: "FFDC2626" } };
      }

      /* ── SUPPLY PLAN — red bold for negative ── */
      if (/^supply_month_\d{1,2}$/.test(cn) && !isDisplayEmpty && nv != null && nv < 0) {
        cell.font = { bold: true, size: 10, color: { argb: "FFDC2626" } };
      }
    }
  }

  /* ────────────────────────────────────────────────────
   * CONDITIONAL FORMATTING (native Excel rules)
   * ──────────────────────────────────────────────────── */
  const lastDataRow = DATA_START + rowCount - 1;

  if (lastDataRow >= DATA_START) {
    // Sales Diff — percentage-based color tiers
    if (sdIdx >= 0) {
      const col = colLetter(sdIdx + 1);
      const ref = `${col}${DATA_START}:${col}${lastDataRow}`;
      ws.addConditionalFormatting({ ref, rules: [
        { type: "cellIs", operator: "greaterThanOrEqual" as any, priority: 1, formulae: ["0.3"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFBBF7D0" } }, font: { color: { argb: "FF14532D" }, bold: true } } },
        { type: "cellIs", operator: "greaterThan" as any, priority: 2, formulae: ["0"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFDCFCE7" } }, font: { color: { argb: "FF166534" } } } },
        { type: "cellIs", operator: "equal" as any, priority: 3, formulae: ["0"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF3F4F6" } }, font: { color: { argb: "FF6B7280" } } } },
        { type: "cellIs", operator: "lessThanOrEqual" as any, priority: 5, formulae: ["-0.3"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFECACA" } }, font: { color: { argb: "FF7F1D1D" }, bold: true } } },
        { type: "cellIs", operator: "lessThan" as any, priority: 4, formulae: ["0"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEE2E2" } }, font: { color: { argb: "FF991B1B" } } } },
      ]});
    }

    // Sales Velocity — absolute-value tiers
    if (svIdx >= 0) {
      const col = colLetter(svIdx + 1);
      const ref = `${col}${DATA_START}:${col}${lastDataRow}`;
      ws.addConditionalFormatting({ ref, rules: [
        { type: "cellIs", operator: "greaterThanOrEqual" as any, priority: 1, formulae: ["30"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFBBF7D0" } }, font: { color: { argb: "FF14532D" }, bold: true } } },
        { type: "cellIs", operator: "greaterThan" as any, priority: 2, formulae: ["0"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFDCFCE7" } }, font: { color: { argb: "FF166534" } } } },
        { type: "cellIs", operator: "equal" as any, priority: 3, formulae: ["0"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF3F4F6" } }, font: { color: { argb: "FF6B7280" } } } },
        { type: "cellIs", operator: "lessThanOrEqual" as any, priority: 5, formulae: ["-30"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFECACA" } }, font: { color: { argb: "FF7F1D1D" }, bold: true } } },
        { type: "cellIs", operator: "lessThan" as any, priority: 4, formulae: ["0"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEE2E2" } }, font: { color: { argb: "FF991B1B" } } } },
      ]});
    }

    // Supply Plan — red bold for negatives
    for (let c = 0; c < colCount; c++) {
      if (/^supply_month_\d{1,2}$/.test(schema[c].column_name)) {
        const col = colLetter(c + 1);
        const ref = `${col}${DATA_START}:${col}${lastDataRow}`;
        ws.addConditionalFormatting({ ref, rules: [
          { type: "cellIs", operator: "lessThan" as any, priority: 1, formulae: ["0"],
            style: { font: { bold: true, color: { argb: "FFDC2626" } } } },
        ]});
      }
    }

    // OH Inv — red bold for non-zero
    for (const ohCol of ["oh_inv", "repl_oh_inv"]) {
      const idx = idxOf(ohCol);
      if (idx >= 0) {
        const col = colLetter(idx + 1);
        const ref = `${col}${DATA_START}:${col}${lastDataRow}`;
        ws.addConditionalFormatting({ ref, rules: [
          { type: "cellIs", operator: "greaterThan" as any, priority: 1, formulae: ["0"],
            style: { font: { bold: true, color: { argb: "FFDC2626" } } } },
          { type: "cellIs", operator: "lessThan" as any, priority: 2, formulae: ["0"],
            style: { font: { bold: true, color: { argb: "FFDC2626" } } } },
        ]});
      }
    }
  }

  /* ── Freeze panes ── */
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 2, topLeftCell: "A3", activeCell: "A3" }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  /* ════════════════════════════════════════════════════════
   * SHEET 2: FORMULA REFERENCE — comprehensive audit
   * ════════════════════════════════════════════════════════ */
  {
    const ws2 = wb.addWorksheet("Formula Reference");
    const hdrFont: Partial<ExcelJS.Font> = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    const hdrFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } };
    const secFont: Partial<ExcelJS.Font> = { bold: true, size: 12, color: { argb: "FF1E293B" } };
    const secFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    const wrapAlign: Partial<ExcelJS.Alignment> = { vertical: "top", wrapText: true };

    ws2.getColumn(1).width = 22;
    ws2.getColumn(2).width = 22;
    ws2.getColumn(3).width = 50;
    ws2.getColumn(4).width = 40;
    ws2.getColumn(5).width = 50;
    ws2.getColumn(6).width = 40;

    // Title
    ws2.getCell("A1").value = "Formula Reference — Full Computation Audit";
    ws2.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1E293B" } };
    ws2.mergeCells("A1:F1");
    ws2.getCell("A2").value = "Documents ALL computed/derived metrics in the Demand Planner dashboard. Sheet 1 contains the actual displayed values.";
    ws2.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" }, italic: true };
    ws2.mergeCells("A2:F2");

    const REF_HEADERS = ["Section", "Metric / Column", "Formula Logic", "Source Variables", "Excel Equivalent", "Notes"];
    const hdrRow = ws2.getRow(4);
    REF_HEADERS.forEach((h, i) => {
      const c = hdrRow.getCell(i + 1);
      c.value = h; c.font = hdrFont; c.fill = hdrFill;
      c.alignment = { horizontal: "center", vertical: "middle" };
    });

    let r = 5;
    const addSection = (title: string) => {
      ws2.mergeCells(r, 1, r, 6);
      const c = ws2.getCell(r, 1);
      c.value = title; c.font = secFont; c.fill = secFill;
      r++;
    };
    const addRow = (section: string, metric: string, formula: string, sources: string, excel: string, notes: string) => {
      const row = ws2.getRow(r);
      [section, metric, formula, sources, excel, notes].forEach((v, i) => {
        const c = row.getCell(i + 1); c.value = v; c.alignment = wrapAlign;
      });
      r++;
    };

    // Helper column letters
    const cl = (name: string) => { const i = idxOf(name); return i >= 0 ? colLetter(i + 1) : "?"; };
    const lbl = (name: string) => labelForColumnDynamic(name).replace(/\n/g, " ");

    // ─── INSTOCK ───
    addSection("Instock (month_1 … month_5)");
    addRow("Instock", "month_1 … month_5", "Direct value from forecast_report view. Display capped at 100.00.", "month_1, month_2, month_3, month_4, month_5", `=MIN(${cl("month_1")}3, 100)`, "Rolling 5 months (current → 4 months back). Values represent instock percentage. Capped at 100 for display.");

    // ─── MONTHLY SALES ───
    addSection("Monthly Sales (sales_month_1 … sales_month_13)");
    addRow("Monthly Sales", "sales_month_1 … sales_month_13", "Joined from monthly_sale_view_auto by SKU + Product ID. sales_month_1 = current month (month_0), sales_month_13 = oldest (month_12).", "monthly_sale_view_auto.month_0 … month_12", "Direct value from joined view", "Rolling 13 months in chronological order (oldest → newest). Labels resolved from DB month_X_label fields.");

    // ─── SALES METRICS ───
    addSection("Sales Metrics");
    const sm2Label = sm2Idx >= 0 ? lbl(schema[sm2Idx].column_name) : "sales_month_2";
    const sm3Label = sm3Idx >= 0 ? lbl(schema[sm3Idx].column_name) : "sales_month_3";
    const sm1Label = sm1Idx >= 0 ? lbl(schema[sm1Idx].column_name) : "sales_month_1";

    addRow("Sales Metrics", lbl("sales_diff"), "(sales_month_2 - sales_month_3) / sales_month_3", `${sm2Label}, ${sm3Label}`,
      sm2Idx >= 0 && sm3Idx >= 0 ? `=IFERROR((${cl(schema[sm2Idx].column_name)}R-${cl(schema[sm3Idx].column_name)}R)/${cl(schema[sm3Idx].column_name)}R,0)` : "N/A",
      "Percentage change between the two most recent prior months. IFERROR wraps division-by-zero to 0. Displayed as %.");

    addRow("Sales Metrics", lbl("actual_sale_of_month"), "Direct value from forecast_report view.", "actual_sale_of_month", `=${cl("actual_sale_of_month")}R`, "Current month actual sales. Highlighted with blue background.");

    addRow("Sales Metrics", lbl("sales_velocity"), "AVERAGE(sales_month_1, sales_month_2, sales_month_3)", `${sm1Label}, ${sm2Label}, ${sm3Label}`,
      sm1Idx >= 0 ? `=IFERROR(AVERAGE(${[sm1Idx, sm2Idx, sm3Idx].filter(x => x >= 0).map(x => cl(schema[x].column_name) + "R").join(",")}),0)` : "N/A",
      "Average of the 3 most recent months of sales.");

    addRow("Sales Metrics", lbl("monthly_projection"), "sales_velocity × 30", "sales_velocity",
      svIdx >= 0 ? `=${cl("sales_velocity")}R*30` : "N/A",
      "30-day projected sales based on current velocity.");

    addRow("Sales Metrics", lbl("unshipped"), "Direct value from forecast_report view.", "unshipped", `=${cl("unshipped")}R`, "Unshipped order quantity.");

    // ─── MONTHLY PROJECTION ───
    addSection("Monthly Projection (proj_month_1 … proj_month_12)");
    addRow("Projection", "proj_month_1 … proj_month_12", "Direct values from forecast_report view. Rolling 12 months starting from current month.", "proj_month_1 … proj_month_12", "Direct value", "Each column represents projected inventory/supply for that future month. Labels are dynamic rolling month abbreviations.");

    // ─── INVENTORY BUCKETS ───
    addSection("Inventory Buckets");
    for (const col of ["fba_reserved", "intransit_fba", "fba", "oh_inv", "otw_units", "on_order_units", "po_in_progress"]) {
      const extra = col === "oh_inv" ? "Non-zero values displayed in red bold." : "Direct value.";
      addRow("Inventory", lbl(col), "Direct value from forecast_report view.", col, `=${cl(col)}R`, extra);
    }

    // ─── INCOMING SHIPMENT ───
    addSection("Inbound Shipment (incoming_month_1 … incoming_month_12)");
    addRow("Incoming", "incoming_month_1 … incoming_month_12", "Direct values from forecast_report view. Rolling 12 months starting from current month.", "incoming_month_1 … incoming_month_12", "Direct value", "Units expected to arrive in each future month.");

    // ─── REPLACEMENT / RETURN RATES ───
    addSection("Replacement / Return Rates");
    addRow("Rates", lbl("replacement_rate"), "Direct value from forecast_report view.", "replacement_rate", `=${cl("replacement_rate")}R`, "Replacement rate percentage.");
    addRow("Rates", lbl("return_rate"), "Direct value from forecast_report view.", "return_rate", `=${cl("return_rate")}R`, "Return rate percentage.");

    // ─── ORDER / PO DETAILS ───
    addSection("Order / PO Details");
    addRow("Order", lbl("sku_status"), "Direct value. Pill: 'New SKU' = green, 'Not New SKU' = blue.", "sku_status", "Text value", "Status badge.");
    addRow("Order", lbl("order_proposal_qty"), "Direct value from forecast_report view.", "order_proposal_qty", `=${cl("order_proposal_qty")}R`, "Proposed order quantity.");
    addRow("Order", lbl("months_worth"), "Direct value from forecast_report view.", "months_worth", `=${cl("months_worth")}R`, "How many months of inventory the order covers.");
    addRow("Order", lbl("cbm"), "Direct value from forecast_report view.", "cbm", `=${cl("cbm")}R`, "Cubic meters per unit/order.");
    addRow("Order", lbl("total_cbm_approved"), "Direct value from forecast_report view.", "total_cbm_approved", `=${cl("total_cbm_approved")}R`, "Total approved CBM.");
    addRow("Order", lbl("factory_latest_po_ordered"), "Direct value from forecast_report view.", "factory_latest_po_ordered", "Text value", "Latest PO ordered from factory.");
    addRow("Order", lbl("po_number"), "Direct value.", "po_number", "Text value", "PO reference number.");
    addRow("Order", lbl("country"), "Direct value.", "country", "Text value", "Country of origin.");
    addRow("Order", lbl("order_date"), "Direct value. Displayed as formatted date.", "order_date", "Date value", "Date the order was placed.");
    addRow("Order", lbl("supply_month"), "Direct value.", "supply_month", "Text value", "Month the order is intended to supply.");
    addRow("Order", lbl("supply_status"), "Direct value. Pill: 'Good' = green, 'Critical' = red.", "supply_status", "Text value", "Overall supply health status.");

    // ─── SUPPLY PLAN ───
    addSection("Supply Plan (supply_month_1 … supply_month_12)");
    addRow("Supply Plan", "supply_month_1 … supply_month_12", "Direct values from forecast_report view. Rolling 12 months. Negative values displayed in red bold.", "supply_month_1 … supply_month_12", "Direct value", "Projected supply balance for each future month. Negative = shortfall.");

    // ─── REPLACEMENT INVENTORY ───
    addSection("Replacement Inventory");
    for (const col of ["repl_fba_reserved", "repl_intransit_fba", "repl_fba", "repl_oh_inv", "repl_otw_units", "repl_on_order_units", "repl_po_in_progress"]) {
      const extra = col === "repl_oh_inv" ? "Non-zero values displayed in red bold." : "Direct value.";
      addRow("Replacement Inventory", lbl(col), "Direct value from forecast_report view.", col, `=${cl(col)}R`, extra);
    }

    // ─── REPLACEMENT INCOMING SHIPMENT ───
    addSection("Replacement Incoming (repl_month_1 … repl_month_12)");
    addRow("Replacement Incoming", "repl_month_1 … repl_month_12", "Direct values from forecast_report view. Rolling 12 months.", "repl_month_1 … repl_month_12", "Direct value", "Replacement units expected per month.");

    // ─── REPLACEMENT SKU ───
    addSection("Replacement SKU");
    addRow("Replacement", lbl("replacement_sku") || "Replacement SKU", "Direct value from forecast_report view.", "replacement_sku", "Text value", "The SKU that replaces this product if applicable.");

    // ─── PRODUCT INFORMATION ───
    addSection("Product Information (non-computed)");
    addRow("Product Info", "sku (Product ID)", "Direct value — primary identifier.", "sku", "Text", "Frozen first column in the UI.");
    addRow("Product Info", "description", "Direct value.", "description", "Text", "Product description.");
    addRow("Product Info", "priority_level", "Direct value. Pill: 1st = red, 2nd = orange, Least = blue.", "priority_level", "Text", "Priority badge.");
    addRow("Product Info", "factory", "Direct value.", "factory", "Text", "Factory name.");
    addRow("Product Info", "status", "Direct value. Pill: Active = green, Inactive = red.", "status", "Text", "Product status badge.");
    addRow("Product Info", "kit", "Direct value. Displayed as Yes/No.", "kit (boolean)", "Yes/No", "Whether the product is a kit.");
    addRow("Product Info", "category", "Direct value.", "category", "Text", "Product category.");

    // ─── NOTES COLUMNS ───
    addSection("Notes Columns");
    for (const col of ["buyer_notes", "planner_notes", "po_notes", "analyst_notes"]) {
      if (idxOf(col) >= 0) addRow("Notes", lbl(col), "Direct text value.", col, "Text", "Free-text notes field.");
    }

    // ─── DISPLAY RULES ───
    addSection("General Display Rules");
    addRow("Display", "Zero values", "All numeric zero values are displayed as '-'.", "All numeric columns", "N/A", "Applies to instock, sales, inventory, supply, projection, incoming, replacement.");
    addRow("Display", "Empty / null values", "Displayed as '-' with dimmed font.", "All columns", "N/A", "Consistent across all sections.");
    addRow("Display", "Instock cap", "Instock values capped at 100.00 for display.", "month_1 … month_5", "=MIN(value, 100)", "Prevents > 100% display.");
    addRow("Display", "Em-dash normalization", "Unicode em-dash (—) converted to hyphen (-).", "All text columns", "N/A", "Ensures consistent display.");
    addRow("Display", "Dates", "Formatted as 'Month Day, Year' (e.g., March 23, 2026).", "order_date, supply_month", "N/A", "US English long date format.");
    addRow("Display", "Negative supply plan", "Negative values in supply_month_X shown in red bold.", "supply_month_1 … supply_month_12", "N/A", "Visual indicator of supply shortfall.");
    addRow("Display", "OH Inv highlight", "Non-zero OH Inv and Repl OH Inv values shown in red bold.", "oh_inv, repl_oh_inv", "N/A", "Draws attention to on-hand inventory.");

    ws2.views = [{ state: "frozen", xSplit: 0, ySplit: 4, topLeftCell: "A5", activeCell: "A5" }];
  }

  /* ════════════════════════════════════════════════════════
   * SHEET 3: SOURCE VARIABLES / AUDIT DATA
   * ════════════════════════════════════════════════════════ */
  {
    const ws3 = wb.addWorksheet("Source Variables");
    const hdrFont: Partial<ExcelJS.Font> = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    const hdrFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
    const secFont: Partial<ExcelJS.Font> = { bold: true, size: 12, color: { argb: "FF1E293B" } };
    const secFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

    ws3.getColumn(1).width = 18;
    ws3.getColumn(2).width = 20;

    // Title
    ws3.getCell("A1").value = "Source Variables — Audit Trail";
    ws3.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1E293B" } };
    ws3.mergeCells("A1:H1");
    ws3.getCell("A2").value = "Raw input values for first 20 rows, enabling reviewers to trace: displayed value → source variables → formula.";
    ws3.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" }, italic: true };
    ws3.mergeCells("A2:H2");

    // Identify key source columns
    const sourceColumns = [
      "sku", "description",
      ...(sm1Idx >= 0 ? [schema[sm1Idx].column_name] : []),
      ...(sm2Idx >= 0 ? [schema[sm2Idx].column_name] : []),
      ...(sm3Idx >= 0 ? [schema[sm3Idx].column_name] : []),
      "sales_diff", "actual_sale_of_month", "sales_velocity", "monthly_projection", "unshipped",
      "month_1", "month_2", "month_3", "month_4", "month_5",
      "fba_reserved", "intransit_fba", "fba", "oh_inv", "otw_units", "on_order_units", "po_in_progress",
      "repl_fba_reserved", "repl_intransit_fba", "repl_fba", "repl_oh_inv", "repl_otw_units", "repl_on_order_units", "repl_po_in_progress",
      "replacement_rate", "return_rate", "supply_status", "months_worth", "order_proposal_qty", "total_cbm_approved",
    ].filter(n => idxOf(n) >= 0);

    // Add some supply/proj/incoming columns dynamically
    for (let i = 1; i <= 12; i++) {
      for (const pfx of ["supply_month_", "proj_month_", "incoming_month_", "repl_month_"]) {
        if (idxOf(pfx + i) >= 0) sourceColumns.push(pfx + i);
      }
    }

    // Deduplicate
    const srcCols = Array.from(new Set(sourceColumns));

    // Headers
    const hdrR = ws3.getRow(4);
    srcCols.forEach((col, i) => {
      const c = hdrR.getCell(i + 1);
      c.value = labelForColumnDynamic(col).replace(/\n/g, " ");
      c.font = hdrFont; c.fill = hdrFill;
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      ws3.getColumn(i + 1).width = Math.max(ws3.getColumn(i + 1).width || 10, 14);
    });

    // Data rows (first 20)
    const sampleRows = filteredData.slice(0, 20);
    sampleRows.forEach((row, ri) => {
      const excelR = ws3.getRow(5 + ri);
      srcCols.forEach((col, ci) => {
        const v = row[col];
        const cell = excelR.getCell(ci + 1);
        if (v == null || v === "") cell.value = "-";
        else if (typeof v === "number") cell.value = v;
        else cell.value = String(v).replace(/—/g, "-");
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });
    });

    ws3.views = [{ state: "frozen", xSplit: 2, ySplit: 4, topLeftCell: "C5", activeCell: "C5" }];
  }

  /* ── Write & download ── */
  const buf = await wb.xlsx.writeBuffer();
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${filename}.xlsx`,
  );

  return rowCount;
}
