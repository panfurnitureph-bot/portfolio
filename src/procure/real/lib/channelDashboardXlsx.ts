/**
 * Channel Dashboard — styled XLSX export.
 *
 * Reproduces the ChannelDashboardTable grid 1:1: the two-row banded header
 * (group banners + column labels, same hex fills as GROUP_BG), zebra body
 * rows, Yes/No + status + alert pills, thick group separators, and the exact
 * displayed number formats (instock "100.00%", locale thousands, "–" for
 * empty incoming). Exports the FULL filtered+sorted dataset, not one page.
 */
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

/** Same hex values as GROUP_BG in ChannelDashboardTable (bg-[#…] classes). */
const GROUP_FILL: Record<string, string> = {
  basic:          "FFEAF2FF",
  instock:        "FFF5FF2A",
  sales:          "FFFFE08A",
  websiteSales:   "FFCFE6FF",
  otherSales:     "FFE9DCFF",
  projection:     "FFC9F0D4",
  supply:         "FFE4DDFF",
  inventory:      "FFD9E8FF",
  incoming:       "FFBFF0E6",
  incomingBreak:  "FFFFE9A3",
};

const THIN: Partial<ExcelJS.Border>  = { style: "thin",   color: { argb: "FFD3D9E0" } };
const THICK: Partial<ExcelJS.Border> = { style: "medium", color: { argb: "FF475569" } };
const HEADER_FONT = { name: "Calibri", size: 9,  bold: true, color: { argb: "FF0F172A" } };
const BODY_FONT   = { name: "Calibri", size: 10, color: { argb: "FF1E293B" } };
const ZEBRA = "FFF6F7F9"; // ~ bg-muted/20

export type XlsxGroup = { key: string; label: string; span: number };
export type XlsxNumCol = { key: string; label: string; group: string; bold?: boolean };
export type XlsxRow = {
  nameMain: string;
  nameVariant: string;
  sku: string;
  category: string;
  kit: string;      // "Yes" | "No" | "—"
  shadow: string;   // "Yes" | "No" | "—"
  puStatus?: string;
  shopifyStatus?: string;
  values: Record<string, number | null>;
  noSales?: boolean;
  missingListing?: boolean;
};

type Opts = {
  fileName: string;    // without extension
  sheetName: string;
  groups: XlsxGroup[];
  numCols: XlsxNumCol[];
  showAlerts: boolean;
  rows: XlsxRow[];
};

function fill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

/** Yes/No pill — light emerald for Yes, muted gray otherwise. */
function styleYesNo(cell: ExcelJS.Cell, v: string) {
  cell.value = v;
  cell.alignment = { horizontal: "center", vertical: "middle" };
  if (v === "Yes") {
    cell.fill = fill("FFECFDF5");
    cell.font = { ...BODY_FONT, size: 9, bold: true, color: { argb: "FF047857" } };
  } else if (v === "No") {
    cell.font = { ...BODY_FONT, size: 9, color: { argb: "FF64748B" } };
  } else {
    cell.font = { ...BODY_FONT, color: { argb: "FF94A3B8" } };
  }
}

/** Purchasing/Shopify status pill colors (mirrors the UI badges). */
function styleStatus(cell: ExcelJS.Cell, v: string) {
  cell.value = v || "—";
  cell.alignment = { horizontal: "center", vertical: "middle" };
  const lower = v.trim().toLowerCase();
  if (lower === "active") {
    cell.fill = fill("FFECFDF5");
    cell.font = { ...BODY_FONT, size: 9, bold: true, color: { argb: "FF047857" } };
  } else if (lower.includes("discontinued")) {
    cell.fill = fill("FFDC2626");
    cell.font = { ...BODY_FONT, size: 9, bold: true, color: { argb: "FFFFFFFF" } };
  } else if (lower === "not listed" || !lower || lower === "—") {
    cell.font = { ...BODY_FONT, size: 9, color: { argb: "FF64748B" } };
  } else {
    cell.fill = fill("FFECFDF5");
    cell.font = { ...BODY_FONT, size: 9, bold: true, color: { argb: "FF047857" } };
  }
}

export async function exportChannelDashboardXlsx(opts: Opts): Promise<void> {
  const { fileName, sheetName, groups, numCols, showAlerts, rows } = opts;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31), {
    views: [{ state: "frozen", xSplit: 2, ySplit: 2 }],
  });

  // ── Column layout ──
  // A ProductName · B ProductID · C Category · D Kit · E Shadow
  // [+2 status cols when showAlerts] · numeric cols · [+2 alert cols]
  const infoCount = 5 + (showAlerts ? 2 : 0);
  const firstNum = infoCount + 1;              // 1-based col index of first numeric col
  const alertStart = firstNum + numCols.length; // 1-based, only if showAlerts

  const widths = [
    34, 16, 16, 8, 9,
    ...(showAlerts ? [14, 14] : []),
    ...numCols.map(() => 10.5),
    ...(showAlerts ? [18, 18] : []),
  ];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // 1-based indexes (within numCols) where a new group starts → thick left border.
  const groupStartIdx = new Set<number>();
  numCols.forEach((c, i) => {
    if (i === 0 || numCols[i - 1].group !== c.group) groupStartIdx.add(firstNum + i);
  });
  if (showAlerts) groupStartIdx.add(alertStart);

  const leftBorder = (colIdx: number): Partial<ExcelJS.Border> =>
    groupStartIdx.has(colIdx) ? THICK : THIN;

  // ── Row 1: group banners ──
  const banner = ws.getRow(1);
  banner.height = 22;
  ws.mergeCells(1, 1, 1, infoCount);
  const infoBanner = ws.getCell(1, 1);
  infoBanner.value = "Product Information";
  infoBanner.fill = fill(GROUP_FILL.basic);
  infoBanner.font = { ...HEADER_FONT, size: 10 };
  infoBanner.alignment = { horizontal: "center", vertical: "middle" };

  let col = firstNum;
  for (const g of groups) {
    ws.mergeCells(1, col, 1, col + g.span - 1);
    const c = ws.getCell(1, col);
    c.value = g.label;
    c.fill = fill(GROUP_FILL[g.key] ?? GROUP_FILL.basic);
    c.font = { ...HEADER_FONT, size: 10 };
    c.alignment = { horizontal: "center", vertical: "middle" };
    col += g.span;
  }
  if (showAlerts) {
    ws.mergeCells(1, alertStart, 1, alertStart + 1);
    const c = ws.getCell(1, alertStart);
    c.value = "Alert";
    c.fill = fill(GROUP_FILL.basic);
    c.font = { ...HEADER_FONT, size: 10 };
    c.alignment = { horizontal: "center", vertical: "middle" };
  }
  // Border pass across the merged banner row.
  for (let i = 1; i <= widths.length; i++) {
    ws.getCell(1, i).border = { top: THIN, bottom: THIN, right: THIN, left: leftBorder(i) };
  }

  // ── Row 2: column labels ──
  const labels = [
    "PRODUCT NAME", "PRODUCT ID", "CATEGORY", "KIT", "SHADOW",
    ...(showAlerts ? ["PURCHASING STATUS", "SHOPIFY STATUS"] : []),
    ...numCols.map(c => c.label.toUpperCase()),
    ...(showAlerts ? ["NO RECENT SALES", "MISSING SHOPIFY LISTING"] : []),
  ];
  const head = ws.getRow(2);
  head.height = 20;
  labels.forEach((label, i) => {
    const idx = i + 1;
    const cell = ws.getCell(2, idx);
    cell.value = label;
    const group = idx >= firstNum && idx < alertStart ? numCols[idx - firstNum].group : "basic";
    cell.fill = fill(GROUP_FILL[group] ?? GROUP_FILL.basic);
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { top: THIN, bottom: { style: "medium", color: { argb: "FF94A3B8" } }, right: THIN, left: leftBorder(idx) };
  });

  // ── Body rows ──
  rows.forEach((r, ri) => {
    const rowIdx = ri + 3;
    const row = ws.getRow(rowIdx);
    row.height = r.nameVariant ? 26 : 18;
    const zebra = ri % 2 === 1;

    // Product Name — bold main + gray variant on a second line (like the UI).
    const nameCell = ws.getCell(rowIdx, 1);
    nameCell.value = r.nameVariant
      ? { richText: [
          { text: r.nameMain, font: { ...BODY_FONT, bold: true } },
          { text: `\n${r.nameVariant}`, font: { ...BODY_FONT, size: 9, color: { argb: "FF64748B" } } },
        ] }
      : r.nameMain;
    nameCell.font = { ...BODY_FONT, bold: true };
    nameCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };

    const skuCell = ws.getCell(rowIdx, 2);
    skuCell.value = r.sku;
    skuCell.font = BODY_FONT;
    skuCell.alignment = { horizontal: "center", vertical: "middle" };

    const catCell = ws.getCell(rowIdx, 3);
    catCell.value = r.category;
    catCell.font = BODY_FONT;
    catCell.alignment = { horizontal: "center", vertical: "middle" };

    styleYesNo(ws.getCell(rowIdx, 4), r.kit);
    styleYesNo(ws.getCell(rowIdx, 5), r.shadow);

    if (showAlerts) {
      styleStatus(ws.getCell(rowIdx, 6), r.puStatus ?? "");
      styleStatus(ws.getCell(rowIdx, 7), r.shopifyStatus ?? "");
    }

    // Numeric cells — exact display formats.
    numCols.forEach((c, i) => {
      const cell = ws.getCell(rowIdx, firstNum + i);
      const v = r.values[c.key];
      if (c.group === "instock") {
        // UI: clamp to 100, always 2 decimals, "%" suffix (value is 0–100, not a fraction).
        const n = v == null || !Number.isFinite(Number(v)) ? 0 : Math.min(Number(v), 100);
        cell.value = n;
        cell.numFmt = '0.00"%"';
      } else if (c.group === "incoming" || c.group === "incomingBreak") {
        // UI: "–" for empty/zero, locale number otherwise.
        if (v == null || v === 0) {
          cell.value = "–";
          cell.font = { ...BODY_FONT, color: { argb: "FF94A3B8" } };
        } else {
          cell.value = Number(v);
          cell.numFmt = "#,##0";
        }
      } else {
        cell.value = v == null ? 0 : Number(v);
        cell.numFmt = "#,##0";
      }
      if (!cell.font) cell.font = c.bold ? { ...BODY_FONT, bold: true } : BODY_FONT;
      else if (c.bold) cell.font = { ...cell.font, bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    // Alert pills.
    if (showAlerts) {
      const noSales = ws.getCell(rowIdx, alertStart);
      if (r.noSales) {
        noSales.value = "🔴 No Recent Sales";
        noSales.fill = fill("FFFEE2E2");
        noSales.font = { ...BODY_FONT, size: 9, bold: true, color: { argb: "FFB91C1C" } };
      } else {
        noSales.value = "—";
        noSales.font = { ...BODY_FONT, color: { argb: "FF94A3B8" } };
      }
      noSales.alignment = { horizontal: "center", vertical: "middle" };

      const missing = ws.getCell(rowIdx, alertStart + 1);
      if (r.missingListing) {
        missing.value = "🟣 Missing Listing";
        missing.fill = fill("FFEDE9FE");
        missing.font = { ...BODY_FONT, size: 9, bold: true, color: { argb: "FF6D28D9" } };
      } else {
        missing.value = "—";
        missing.font = { ...BODY_FONT, color: { argb: "FF94A3B8" } };
      }
      missing.alignment = { horizontal: "center", vertical: "middle" };
    }

    // Zebra + borders — one pass over every cell in the row.
    for (let i = 1; i <= widths.length; i++) {
      const cell = ws.getCell(rowIdx, i);
      if (zebra && !cell.fill) cell.fill = fill(ZEBRA);
      cell.border = { top: THIN, bottom: THIN, right: THIN, left: leftBorder(i) };
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${fileName}.xlsx`);
}
