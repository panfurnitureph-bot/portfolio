/**
 * Reorder Decisions — column registry.
 *
 * SINGLE SOURCE OF TRUTH for what the Reorder Decisions shows.
 * The UI tbody (MonthlyForecast.tsx, planner dialog), the CSV export
 * (idpCsv.ts), and the xlsx export (generateInventoryReportWorkbook) all
 * read from this list. Adding / removing / renaming a column here is
 * reflected in every surface.
 *
 * Groups drive the two-row xlsx header banner (Monthly Projection / Supply
 * Plan / 90-Day Forecast Analysis). The planner UI uses the same grouping
 * visually via colSpan headers — keep them in sync if you change groups.
 */

export type IdpColumnGroup = "basic" | "projection" | "supply" | "forecast" | "runway";

export interface IdpColumn {
  /** Field key. For raw cols matches row property; for computed cols, a stable id. */
  key: string;
  /** Header label. xlsx/CSV uses "\n" for two-line wrap; UI strips it for display. */
  label: string;
  /** xlsx column width (Excel units, ~character widths). */
  width: number;
  /** ARGB fill for xlsx header cell. */
  bg: string;
  /** Section banner the column belongs to. */
  group: IdpColumnGroup;
  /** True if the column is a calendar month (May/Jun/Jul). Drives xlsx numFmt. */
  isMonth?: boolean;
  /** True if the cell value should be formatted as a calendar date. */
  isDate?: boolean;
  /** True if the cell value is USD (xlsx applies $#,##0.00). */
  isCurrency?: boolean;
  /**
   * True when the column is derived by buildIdpExportRow (not a raw field
   * on the row). CSV reads from the export row's `derived` map; xlsx skips
   * unknown raw fields.
   */
  computed?: boolean;
}

const STATIC_BASIC: IdpColumn[] = [
  { key: "description", label: "Product Name", width: 30, bg: "FFEAF2FF", group: "basic" },
  { key: "sku",         label: "Product ID",   width: 20, bg: "FFEAF2FF", group: "basic" },
  { key: "factory",     label: "Factory",      width: 12, bg: "FFEAF2FF", group: "basic" },
  { key: "pu_status",   label: "Status",       width: 18, bg: "FFEAF2FF", group: "basic" },
];

const STATIC_FORECAST: IdpColumn[] = [
  { key: "ninety_day_projection",   label: "90-Day\nProjection",   width: 12, bg: "FFD6CCFF", group: "forecast" },
  { key: "ninety_day_supply",       label: "90-Day\nSupply",       width: 12, bg: "FFD6CCFF", group: "forecast" },
  { key: "ninety_day_deficit",      label: "90-Day\nDeficit",      width: 12, bg: "FFD6CCFF", group: "forecast" },
  { key: "ninety_day_revenue_loss", label: "90-Day\nRevenue Loss", width: 14, bg: "FFD6CCFF", group: "forecast", isCurrency: true },
  { key: "safety_stock",            label: "Safety\nStock",        width: 12, bg: "FFD6CCFF", group: "forecast" },
  { key: "order_recommended",       label: "Order\nRecommended",   width: 14, bg: "FFD6CCFF", group: "forecast" },
  { key: "lead_time",               label: "Lead\nTime",           width: 10, bg: "FFD6CCFF", group: "forecast" },
  { key: "order_date_forecast",     label: "Order\nDate",          width: 14, bg: "FFD6CCFF", group: "forecast", isDate: true },
  { key: "supply_month_forecast",   label: "Supply\nMonth",        width: 14, bg: "FFD6CCFF", group: "forecast", isDate: true },
];

const STATIC_RUNWAY: IdpColumn[] = [
  // Keys MUST match the tbody data-col attributes in MonthlyForecast.tsx
  // (and the formulaMetadataCache keys) so click-to-highlight stays wired.
  { key: "days_of_supply",          label: "Days of\nSupply Left",     width: 12, bg: "FFFFE4E1", group: "runway", computed: true },
  { key: "days_until_must_order",   label: "Days Until\nMust Order",   width: 12, bg: "FFFFE4E1", group: "runway", computed: true },
  { key: "days_without_stock",      label: "Days Without\nStock",      width: 12, bg: "FFFFE4E1", group: "runway", computed: true },
];

const STATIC_ACTION: IdpColumn[] = [
  { key: "action_label",  label: "Action",        width: 24, bg: "FFD6CCFF", group: "forecast", computed: true },
  { key: "action_detail", label: "Action Detail", width: 36, bg: "FFD6CCFF", group: "forecast", computed: true },
  // Semantic mirror of the UI's color badge so the CSV preserves the meaning
  // of the cell background even though it can't render the color itself.
  { key: "priority",      label: "Priority",      width: 12, bg: "FFD6CCFF", group: "forecast", computed: true },
  { key: "status_color",  label: "Status Color",  width: 12, bg: "FFD6CCFF", group: "forecast", computed: true },
];

/**
 * Build the full ordered column list given the three rolling-window month
 * names (e.g. ["May", "Jun", "Jul"]). Order MUST mirror the planner table
 * row in MonthlyForecast.tsx for 1:1 parity between UI / CSV / xlsx.
 */
export function buildIdpColumns(monthNames: [string, string, string]): IdpColumn[] {
  const [m1, m2, m3] = monthNames;
  return [
    ...STATIC_BASIC,
    { key: "proj_month_1",   label: m1, width: 10, bg: "FFFFF4CC", group: "projection", isMonth: true },
    { key: "proj_month_2",   label: m2, width: 10, bg: "FFFFF4CC", group: "projection", isMonth: true },
    { key: "proj_month_3",   label: m3, width: 10, bg: "FFFFF4CC", group: "projection", isMonth: true },
    { key: "supply_month_1", label: m1, width: 10, bg: "FFE8D4FF", group: "supply",     isMonth: true },
    { key: "supply_month_2", label: m2, width: 10, bg: "FFE8D4FF", group: "supply",     isMonth: true },
    { key: "supply_month_3", label: m3, width: 10, bg: "FFE8D4FF", group: "supply",     isMonth: true },
    ...STATIC_FORECAST,
    ...STATIC_RUNWAY,
    ...STATIC_ACTION,
  ];
}

/**
 * For the xlsx section-header row: count of consecutive columns per group
 * in the order returned by `buildIdpColumns`. Used to drive mergeCells.
 */
export function getGroupSpans(columns: IdpColumn[]): { group: IdpColumnGroup; span: number }[] {
  const out: { group: IdpColumnGroup; span: number }[] = [];
  for (const col of columns) {
    const last = out[out.length - 1];
    if (last && last.group === col.group) {
      last.span += 1;
    } else {
      out.push({ group: col.group, span: 1 });
    }
  }
  return out;
}

export const GROUP_BANNER_LABEL: Record<IdpColumnGroup, string> = {
  basic: "",
  projection: "Monthly Projection",
  supply: "Supply Plan",
  forecast: "90-Day Forecast Analysis",
  runway: "Supply Runway",
};

/**
 * Header rendering metadata — drives the planner table's two-row <thead>
 * directly from the registry. Returns:
 *   row1 = top banner cells (either a group banner with colSpan, or an
 *          individual column with rowSpan=2 when the column has no peers)
 *   row2 = month-name cells for the projection + supply groups
 *
 * UI styling (bg colors, min/max width, left-divider) is co-located here so
 * adding a column doesn't require touching MonthlyForecast.tsx — it's a
 * registry-only edit and both <thead> AND CSV pick it up automatically.
 */
export interface IdpHeaderCell {
  id: string;
  label: string;
  rowSpan: number;
  colSpan: number;
  bg: string;
  minWidth: string;
  maxWidth: string;
  borderClass: string;
}

const HEX_BY_ARGB: Record<string, string> = {
  FFEAF2FF: "#eaf2ff",
  FFFFF4CC: "#fff4cc",
  FFE8D4FF: "#e8d4ff",
  FFD6CCFF: "#d6ccff",
  FFFFE4E1: "#ffe4e1",
};

const COL_WIDTH_HINTS: Record<string, { min: string; max: string }> = {
  description:             { min: "180px", max: "250px" },
  sku:                     { min: "100px", max: "120px" },
  factory:                 { min: "80px",  max: "100px" },
  pu_status:               { min: "80px",  max: "100px" },
  proj_month_1:            { min: "60px",  max: "80px"  },
  proj_month_2:            { min: "60px",  max: "80px"  },
  proj_month_3:            { min: "60px",  max: "80px"  },
  supply_month_1:          { min: "60px",  max: "80px"  },
  supply_month_2:          { min: "60px",  max: "80px"  },
  supply_month_3:          { min: "60px",  max: "80px"  },
  ninety_day_projection:   { min: "70px",  max: "90px"  },
  ninety_day_supply:       { min: "70px",  max: "90px"  },
  ninety_day_deficit:      { min: "70px",  max: "90px"  },
  ninety_day_revenue_loss: { min: "80px",  max: "100px" },
  safety_stock:            { min: "70px",  max: "90px"  },
  order_recommended:       { min: "70px",  max: "90px"  },
  lead_time:               { min: "60px",  max: "80px"  },
  order_date_forecast:     { min: "90px",  max: "110px" },
  supply_month_forecast:   { min: "90px",  max: "110px" },
  days_of_supply:          { min: "90px",  max: "110px" },
  days_until_must_order:   { min: "90px",  max: "110px" },
  days_without_stock:      { min: "90px",  max: "110px" },
  action_label:            { min: "200px", max: "260px" },
  action_detail:           { min: "0px",   max: "0px"   }, // hidden in UI; CSV only
  priority:                { min: "0px",   max: "0px"   }, // hidden in UI; CSV only
  status_color:            { min: "0px",   max: "0px"   }, // hidden in UI; CSV only
};

function widthHint(key: string): { min: string; max: string } {
  return COL_WIDTH_HINTS[key] ?? { min: "70px", max: "90px" };
}

function bgHex(argb: string): string {
  return HEX_BY_ARGB[argb] ?? "#ffffff";
}

/**
 * Build the two-row planner header from the registry.
 * Columns hidden in the UI (CSV-only) are skipped here so they don't add
 * empty <th> cells. They still appear in the CSV via buildIdpColumns.
 */
export function buildIdpHeaderRows(columns: IdpColumn[]): {
  row1: IdpHeaderCell[];
  row2: IdpHeaderCell[];
} {
  const visible = columns.filter((c) => {
    const w = widthHint(c.key);
    return !(w.min === "0px" && w.max === "0px");
  });

  const row1: IdpHeaderCell[] = [];
  const row2: IdpHeaderCell[] = [];

  let i = 0;
  let lastGroupForBorder: IdpColumnGroup | null = null;
  while (i < visible.length) {
    const col = visible[i];
    const isMultiMonth = col.group === "projection" || col.group === "supply";

    if (isMultiMonth) {
      // Find run of cols sharing this group.
      let span = 1;
      while (i + span < visible.length && visible[i + span].group === col.group) span += 1;
      // Banner cell.
      row1.push({
        id: `banner-${col.group}-${i}`,
        label: GROUP_BANNER_LABEL[col.group],
        rowSpan: 1,
        colSpan: span,
        bg: bgHex(col.bg),
        minWidth: "auto",
        maxWidth: "none",
        borderClass:
          col.group === "projection" && lastGroupForBorder !== "projection"
            ? "border-l-[6px] border-l-slate-400"
            : "",
      });
      // Month-name row 2 cells.
      for (let k = 0; k < span; k += 1) {
        const sub = visible[i + k];
        const w = widthHint(sub.key);
        row2.push({
          id: `m-${sub.key}`,
          label: sub.label,
          rowSpan: 1,
          colSpan: 1,
          bg: bgHex(sub.bg),
          minWidth: w.min,
          maxWidth: w.max,
          borderClass: col.group === "projection" && k === 0 ? "border-l-[6px] border-l-slate-400" : "",
        });
      }
      lastGroupForBorder = col.group;
      i += span;
    } else {
      const w = widthHint(col.key);
      // Forecast group's first column gets the divider, matching the prior UI.
      const leftBorder =
        col.group === "forecast" && lastGroupForBorder !== "forecast"
          ? "border-l-[6px] border-l-slate-400"
          : "";
      row1.push({
        id: `h-${col.key}`,
        label: col.label,
        rowSpan: 2,
        colSpan: 1,
        bg: bgHex(col.bg),
        minWidth: w.min,
        maxWidth: w.max,
        borderClass: leftBorder,
      });
      lastGroupForBorder = col.group;
      i += 1;
    }
  }

  return { row1, row2 };
}
