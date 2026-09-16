import React, { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import ProductImage from "@/components/shared/ProductImage";
import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";
import { useFactoryAccess } from "@/hooks/useFactoryAccess";
import { useMonthlyProjection } from "@/hooks/useMonthlyProjection";
import { useItemAlerts, isActivePurchasing, isNotListedOnShopify } from "@/hooks/useItemAlerts";
import { useCrossChannelSales } from "@/hooks/useCrossChannelSales";
import { useIncomingShipment } from "@/hooks/useIncomingShipment";
import { fetchChannelRows, channelRowsQueryKey } from "@/lib/dashboard/channelRows";
import { fetchScProductNames, buildScNameMap } from "@/lib/forecast/newSku";
import { externalSupabase } from "@/integrations/supabase/externalClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X, Download, AlertTriangle, TrendingDown, EyeOff, AlertOctagon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Group banner background colors — mirror the Demand Planner palette
 *  (see headerBg() in MonthlyForecast). Intentionally light + theme-independent
 *  so they read as data bands rather than UI chrome. */
const GROUP_BG = {
  basic:      "bg-[#eaf2ff]",
  instock:    "bg-[#f5ff2a]",
  sales:        "bg-[#ffe08a]",
  websiteSales: "bg-[#cfe6ff]",
  otherSales:   "bg-[#e9dcff]",
  projection:   "bg-[#c9f0d4]",
  supply:       "bg-[#e4ddff]",
  inventory:    "bg-[#d9e8ff]",
  incoming:       "bg-[#bff0e6]",
  incomingBreak:  "bg-[#ffe9a3]",
} as const;

/** Short month names for the rolling 5-month window ending on the current
 *  month. Index 0 = 4 months ago (maps to *_1), index 4 = now (maps to *_5).
 *  Computed from today so labels stay correct as months pass. */
function monthLabels(): string[] {
  const now = new Date();
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (4 - i), 1);
    return d.toLocaleString("en-US", { month: "short" });
  });
}

/** Full "February 2026 – June 2026" range label for the group banners. */
function monthRangeLabel(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 4, 1);
  const fmt = (d: Date) => d.toLocaleString("en-US", { month: "long", year: "numeric" });
  return `${fmt(start)} – ${fmt(now)}`;
}

/** Short month names for the rolling 5-month window STARTING on the current
 *  month and going forward (index 0 = now → *_1, index 4 = now+4 → *_5). Used
 *  by the Monthly Projection tab; auto-shifts as months pass. Day pinned to 1 so
 *  month arithmetic never rolls over (e.g. Jan 31 + 1mo). */
function forwardMonthLabels(): string[] {
  const now = new Date();
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return d.toLocaleString("en-US", { month: "short" });
  });
}

/** Full "June 2026 – October 2026" forward range label for the projection banner. */
function forwardRangeLabel(): string {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 4, 1);
  const fmt = (d: Date) => d.toLocaleString("en-US", { month: "long", year: "numeric" });
  return `${fmt(now)} – ${fmt(end)}`;
}

/** N forward short month labels starting this month (index 0 = now). */
function forwardMonthLabelsN(n: number): string[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return d.toLocaleString("en-US", { month: "short" });
  });
}

/** Full "June 2026 – November 2026" range label spanning N forward months. */
function forwardRangeLabelN(n: number): string {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + (n - 1), 1);
  const fmt = (d: Date) => d.toLocaleString("en-US", { month: "long", year: "numeric" });
  return `${fmt(now)} – ${fmt(end)}`;
}

const MONTHS = monthLabels();
const MONTH_RANGE = monthRangeLabel();
const FORWARD_MONTHS = forwardMonthLabels();
const FORWARD_RANGE = forwardRangeLabel();
// Supply Plan shows the next 6 forward months (Jun..Nov).
const SUPPLY_MONTHS = forwardMonthLabelsN(6);
const SUPPLY_RANGE = forwardRangeLabelN(6);

/** Group-boundary separator — a thick slate left border, mirroring the Forecast
 *  Report's `mf-sep-dark` rule so columns belonging to one category read as a
 *  single band. Applied to the first column of each group across the banner row,
 *  the label row, and every body cell so the rule runs top-to-bottom. */
const SEP = "border-l-4 border-l-slate-600";

type NumCol = { key: string; label: string; group: keyof typeof GROUP_BG; bold?: boolean };

/** Numeric value columns (in display order), each tagged with its group so the
 *  banner + column header share one band color. */
const INSTOCK_COLS: NumCol[] = [
  { key: "instock_1", label: MONTHS[0], group: "instock" },
  { key: "instock_2", label: MONTHS[1], group: "instock" },
  { key: "instock_3", label: MONTHS[2], group: "instock" },
  { key: "instock_4", label: MONTHS[3], group: "instock" },
  { key: "instock_5", label: MONTHS[4], group: "instock" },
];
const SALES_COLS: NumCol[] = [
  { key: "sale_1",    label: MONTHS[0], group: "sales" },
  { key: "sale_2",    label: MONTHS[1], group: "sales" },
  { key: "sale_3",    label: MONTHS[2], group: "sales" },
  { key: "sale_4",    label: MONTHS[3], group: "sales" },
  { key: "sale_5",    label: MONTHS[4], group: "sales" },
];
/** Website + Other-Channel sales (merged by SKU) — Flagged SKUs view only. */
const WEBSITE_SALES_COLS: NumCol[] = [1, 2, 3, 4, 5].map((i) => ({ key: `wsale_${i}`, label: MONTHS[i - 1], group: "websiteSales" }));
const OTHER_SALES_COLS: NumCol[] = [1, 2, 3, 4, 5].map((i) => ({ key: `osale_${i}`, label: MONTHS[i - 1], group: "otherSales" }));
/** Forward Monthly Projection columns (computed, not from DB). Only rendered
 *  when the `showProjection` prop is set — adds a band WITHOUT touching sale_*. */
const PROJECTION_COLS: NumCol[] = [
  { key: "proj_1", label: FORWARD_MONTHS[0], group: "projection" },
  { key: "proj_2", label: FORWARD_MONTHS[1], group: "projection" },
  { key: "proj_3", label: FORWARD_MONTHS[2], group: "projection" },
  { key: "proj_4", label: FORWARD_MONTHS[3], group: "projection" },
  { key: "proj_5", label: FORWARD_MONTHS[4], group: "projection" },
];
/** Forward Supply Plan columns (computed, not from DB). Only rendered when the
 *  `showSupplyPlan` prop is set — 6 forward months (Jun..Nov). */
const SUPPLY_COLS: NumCol[] = [
  { key: "supply_1", label: SUPPLY_MONTHS[0], group: "supply" },
  { key: "supply_2", label: SUPPLY_MONTHS[1], group: "supply" },
  { key: "supply_3", label: SUPPLY_MONTHS[2], group: "supply" },
  { key: "supply_4", label: SUPPLY_MONTHS[3], group: "supply" },
  { key: "supply_5", label: SUPPLY_MONTHS[4], group: "supply" },
  { key: "supply_6", label: SUPPLY_MONTHS[5], group: "supply" },
];
const INVENTORY_COLS: NumCol[] = [
  { key: "oh_inv",    label: "OH Inv",    group: "inventory", bold: true },
  { key: "otw",       label: "OTW Units", group: "inventory", bold: true },
  { key: "oo_unit",   label: "OO Units",  group: "inventory", bold: true },
];
// Inbound Shipment band — 9 forward months (Jun..Feb), shown only on the
// Inbound Shipment Dashboard tab. Reads incoming_1..incoming_9 (empty until
// the dedicated table/pipeline is wired → renders "–").
const INCOMING_COUNT = 9;
const INCOMING_MONTHS = forwardMonthLabelsN(INCOMING_COUNT);
const INCOMING_RANGE = forwardRangeLabelN(INCOMING_COUNT);
const INCOMING_COLS: NumCol[] = Array.from({ length: INCOMING_COUNT }, (_, i) => ({
  key: `incoming_${i + 1}`, label: INCOMING_MONTHS[i], group: "incoming",
}));
// Incoming Breakdown — open-order units arriving within 30 / 60 / 90 days.
const INCOMING_BREAKDOWN_COLS: NumCol[] = [
  { key: "oo_30", label: "OO Units 30 Days", group: "incomingBreak", bold: true },
  { key: "oo_60", label: "OO Units 60 Days", group: "incomingBreak", bold: true },
  { key: "oo_90", label: "OO Units 90 Days", group: "incomingBreak", bold: true },
];

/** Keys of the first numeric column in each group — these get the vertical
 *  group separator on their left edge. */
function groupStarts(cols: NumCol[]): Set<string> {
  return new Set(cols.filter((c, i) => i === 0 || cols[i - 1].group !== c.group).map(c => c.key));
}

/** Info (non-numeric) columns under the "Product Information" banner. The first
 *  two (Product Name, Product ID) are pinned left; these scroll. */
const INFO_COLS = [
  { key: "category", label: "Category", align: "left"   as const },
  { key: "kit",      label: "Kit",      align: "center" as const },
  { key: "shadow",   label: "Shadow",   align: "center" as const },
];

type Row = {
  id: number;
  sku: string | null;
  product_name: string | null;
  factory: string | null;
  kit: string | null;
  shadow: string | null;
  category: string | null;
  instock_1: number | null;
  instock_2: number | null;
  instock_3: number | null;
  instock_4: number | null;
  instock_5: number | null;
  sale_1: number | null;
  sale_2: number | null;
  sale_3: number | null;
  sale_4: number | null;
  sale_5: number | null;
  oh_inv: number | null;
  otw: number | null;
  oo_unit: number | null;
  // Computed forward projection (only populated when showProjection is set).
  proj_1?: number | null;
  proj_2?: number | null;
  proj_3?: number | null;
  proj_4?: number | null;
  proj_5?: number | null;
  // Cross-channel sales merged by SKU (only populated when showAllChannelSales is set).
  wsale_1?: number | null; wsale_2?: number | null; wsale_3?: number | null; wsale_4?: number | null; wsale_5?: number | null;
  osale_1?: number | null; osale_2?: number | null; osale_3?: number | null; osale_4?: number | null; osale_5?: number | null;
  // Computed forward supply plan (only populated when showSupplyPlan is set).
  supply_1?: number | null;
  supply_2?: number | null;
  supply_3?: number | null;
  supply_4?: number | null;
  supply_5?: number | null;
  supply_6?: number | null;
};

type SortDir = "asc" | "desc" | null;

const STR_COLS = ["sku", "product_name", "factory", "kit", "shadow", "category"];

// Pinned-column geometry (must match the sticky `left`/width values below).
const NAME_W = 220;
const ID_W   = 140;

function numDisplay(v: number | null | undefined): string {
  if (v == null) return "0";
  return v.toLocaleString();
}

/** Incoming bands show "–" for empty/zero (nothing arriving), numbers otherwise. */
function incomingDisplay(v: number | null | undefined): string {
  if (v == null || v === 0) return "–";
  return v.toLocaleString();
}

/** Instock cells render as a percentage, mirroring the Demand Planner rule
 *  (see formatInstockDisplay in MonthlyForecast): clamp to a max of 100, show
 *  2 decimals, and suffix "%". Null/blank → "0.00%". */
function instockDisplay(v: number | null | undefined): string {
  const n = v == null ? 0 : Number(v);
  const capped = Number.isFinite(n) ? Math.min(n, 100) : 0;
  return `${capped.toFixed(2)}%`;
}

/** Text a numeric cell displays — single formatter for the body cells so
 *  every surface (grid, export) shows identical values. */
function numCellText(c: NumCol, row: Row): string {
  const v = (row as any)[c.key];
  if (c.group === "instock") return instockDisplay(v);
  if (c.group === "incoming" || c.group === "incomingBreak") return incomingDisplay(v);
  return numDisplay(v);
}

/** Text the Kit/Shadow badge displays (mirrors YesNoBadge). */
function yesNoText(v: string | null | undefined): string {
  if (!v) return "—";
  return v.trim().toLowerCase() === "yes" ? "Yes" : "No";
}

function splitProductName(name: string): { main: string; variant: string } {
  const mIn   = name.match(/^(.*?)\s+in\s+(.*)$/i);
  const mDash = name.match(/^(.*?)\s+-\s+(.*)$/);
  if (mIn)   return { main: mIn[1].trim(), variant: mIn[2].trim() };
  if (mDash) return { main: mDash[1].trim(), variant: mDash[2].trim() };
  return { main: name, variant: "" };
}

function SortIcon({ col, sortCol, sortDir }: { col: string; sortCol: string; sortDir: SortDir }) {
  if (sortCol !== col) return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
  if (sortDir === "asc") return <ChevronUp className="ml-1 inline h-3 w-3 text-primary" />;
  return <ChevronDown className="ml-1 inline h-3 w-3 text-primary" />;
}

function uniq(arr: (string | null | undefined)[]): string[] {
  return Array.from(new Set(arr.filter(Boolean) as string[])).sort();
}

function YesNoBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const isYes = value.trim().toLowerCase() === "yes";
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
      isYes
        ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
        : "bg-muted text-muted-foreground border border-border"
    )}>
      {isYes ? "Yes" : "No"}
    </span>
  );
}

type Props = {
  /** Supabase table to read (e.g. "amazon_dashboard"). */
  tableName: string;
  /** Label for the middle group banner (e.g. "Amazon Sales" / "Monthly Projection"). */
  salesLabel: string;
  /** Column prefix for the middle (sales/projection) group, e.g. "sale" or
   *  "monthly". Aliased back to sale_* so the rest of the grid is unchanged. */
  salesKeyPrefix?: string;
  /** When true, the middle (sales) group's month labels run FORWARD from the
   *  current month (Jun, Jul, Aug…) instead of trailing. For the Monthly
   *  Projection tab. Instock group stays historical/trailing. */
  forwardSales?: boolean;
  /** When true, ADD a separate "Monthly Projection ( Jun–Oct )" band after the
   *  sales group (keeping the historical sales band intact). The projection
   *  columns are computed live by SKU, not read from the table. */
  showProjection?: boolean;
  /** When true, ADD a "Supply Plan ( Jun–Nov )" band (6 forward months) right
   *  before Inventory Buckets. Computed live by SKU, not read from the table. */
  showSupplyPlan?: boolean;
  /** When true, turn this into the "Flagged SKUs" view: add an Alert column,
   *  flag summary + filter, and show only flagged SKUs (stagnant or
   *  Active·Not-Listed). Flags are global per SKU (see useItemAlerts). */
  showAlerts?: boolean;
  /** When true, ADD Website Sales + Other Channel Sales bands (trailing 5
   *  months, merged by SKU from those dashboards) after the base Sales band. */
  showAllChannelSales?: boolean;
  /** When true, HIDE the middle sales band entirely (e.g. Inbound Shipment
   *  Dashboard shows only Instock + Inventory Buckets). */
  hideSales?: boolean;
  /** When true, ADD the Inbound Shipment (12 forward months) + Incoming
   *  Breakdown (OO Units 30/60/90 Days) bands after Inventory Buckets. */
  showIncoming?: boolean;
};

type AlertFilter = "all" | "stagnant" | "activeNotListed" | "both";

/** Per-row alert verdict. */
type RowAlert = { stagnant: boolean; activeNotListed: boolean };

/** "No Recent Sales" — in stock but nothing sold in 30d+ across all channels. */
function NoSalesBadge({ on }: { on: boolean }) {
  if (!on) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950 dark:text-red-300 whitespace-nowrap">
      🔴 No Recent Sales
    </span>
  );
}

/** "Missing Shopify Listing" — Active in Purchasing but not listed on Shopify. */
function MissingListingBadge({ on }: { on: boolean }) {
  if (!on) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300 whitespace-nowrap">
      🟣 Missing Listing
    </span>
  );
}

/** Normalize status casing so "ACTIVE"/"active" both render as "Active". */
function titleCase(v: string): string {
  return v.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Only http(s) URLs are allowed as links (mirrors MonthlyForecast). */
function toSafeHttpUrl(raw: unknown): string | null {
  const s = raw != null ? String(raw).trim() : "";
  if (!s || s === "-") return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Wraps a status pill in a new-tab link when a URL is available. */
function StatusLink({ href, title, children }: { href?: string; title: string; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title} onClick={(e) => e.stopPropagation()} className="inline-flex hover:opacity-80 transition-opacity">
      {children}
    </a>
  );
}

function PurchasingStatusBadge({ value, href }: { value: string; href?: string }) {
  const v = value.trim();
  if (!v) return <span className="text-muted-foreground">—</span>;
  const lower = v.toLowerCase();
  const cls = lower === "active"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
    : lower.includes("discontinued")
      ? "bg-red-600 text-white border-red-600"
      : "bg-muted text-muted-foreground border-border";
  return (
    <StatusLink href={href} title="Open in ERP">
      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", cls)}>{titleCase(v)}</span>
    </StatusLink>
  );
}

function ShopifyStatusBadge({ value, href }: { value: string; href?: string }) {
  const pill = isNotListedOnShopify(value)
    ? <span className="inline-flex rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Not Listed</span>
    : <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800 whitespace-nowrap">{titleCase(value)}</span>;
  return <StatusLink href={href} title="Open in Shopify">{pill}</StatusLink>;
}

/** Shared channel dashboard table (toolbar + banded grid + pagination). Renders
 *  no page header — the parent supplies that. Used by the per-channel pages and
 *  the tabbed "All Channels" page. */
export default function ChannelDashboardTable({ tableName, salesLabel, salesKeyPrefix = "sale", forwardSales = false, showProjection = false, showSupplyPlan = false, showAlerts = false, showAllChannelSales = false, hideSales = false, showIncoming = false }: Props) {
  const [search, setSearch]   = useState("");
  const [sortCol, setSortCol] = useState<string>("sale_5");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");

  // Per-SKU alert inputs (only fetched in the Flagged SKUs view).
  const { shopifyStatusBySku, puStatusBySku, purchasingUrlBySku, shopifyUrlBySku, isLoading: alertsLoading } = useItemAlerts(showAlerts);

  // Factory/region access — restrict rows to the user's assigned country.
  const { allowSku, restricted, ready: accessReady } = useFactoryAccess();

  // Multi-select filter state
  const [filterProductName, setFilterProductName] = useState<string[]>([]);
  const [filterProductId,   setFilterProductId]   = useState<string[]>([]);
  const [filterFactory,     setFilterFactory]     = useState<string[]>([]);
  const [filterKit,         setFilterKit]         = useState<string[]>([]);
  const [filterShadow,      setFilterShadow]      = useState<string[]>([]);
  const [filterCategory,    setFilterCategory]    = useState<string[]>([]);
  const [filterPurchasing,  setFilterPurchasing]  = useState<string[]>([]);
  const [filterShopify,     setFilterShopify]     = useState<string[]>([]);
  const [filterNoSales,     setFilterNoSales]     = useState<string[]>([]);
  const [filterMissing,     setFilterMissing]     = useState<string[]>([]);

  // Forward-projection tab labels the middle band with the upcoming window;
  // every other tab keeps the trailing window. Instock always stays trailing.
  // ── forecast_channel_sales: per-channel Sales band (amz_/web_/oth_month_0..5,
  // month_0 = kasalukuyang buwan) + SQL-derived labels. Iisang table para sa
  // tatlong channel tabs. Nauna itong idineklara para magamit ng headers.
  const { data: fcsRows = [] } = useQuery({
    queryKey: ["forecast_channel_sales"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const all: Record<string, unknown>[] = [];
      const BATCH = 1000;
      let from = 0;
      while (true) {
        const { data: page, error } = await (externalSupabase as any)
          .from("forecast_channel_sales")
          .select("*")
          .range(from, from + BATCH - 1);
        if (error) throw error;
        if (!page || page.length === 0) break;
        all.push(...page);
        if (page.length < BATCH) break;
        from += BATCH;
      }
      return all;
    },
  });
  const fcsMap = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of fcsRows) { const s = String(r.sku ?? "").trim(); if (s) m.set(s, r); }
    return m;
  }, [fcsRows]);
  // Aling prefix ang para sa tab na ito
  const channelPrefix =
    tableName === "amazon_dashboard" ? "amz"
    : tableName === "website_dashboard" ? "web"
    : tableName === "other_channel_dashboard" ? "oth"
    : null;
  // Sales band headers STRAIGHT from the table's SQL-derived labels
  // (sale_1 = month_4_label … sale_5 = month_0_label) — hindi JS date math,
  // para hindi mag-drift ang header vs data sa month boundary.
  const fcsLabels = useMemo<string[] | null>(() => {
    if (fcsRows.length === 0) return null;
    const first = fcsRows[0];
    const l = [4, 3, 2, 1, 0].map((i) => String(first[`month_${i}_label`] ?? "").trim());
    return l.every(Boolean) ? l : null;
  }, [fcsRows]);

  const salesMonths = forwardSales ? FORWARD_MONTHS : (fcsLabels ?? MONTHS);
  const salesRange  = forwardSales ? FORWARD_RANGE : (fcsLabels ? `${fcsLabels[0]} – ${fcsLabels[4]}` : MONTH_RANGE);

  // Numeric columns in display order. The projection band is inserted between
  // sales and inventory only when showProjection is set.
  const numCols = useMemo(
    () => [
      ...INSTOCK_COLS,
      ...(showProjection ? PROJECTION_COLS : []),
      ...(hideSales ? [] : SALES_COLS),
      ...(showAllChannelSales ? WEBSITE_SALES_COLS : []),
      ...(showAllChannelSales ? OTHER_SALES_COLS : []),
      ...INVENTORY_COLS,
      ...(showSupplyPlan ? SUPPLY_COLS : []),
      ...(showIncoming ? [...INCOMING_COLS, ...INCOMING_BREAKDOWN_COLS] : []),
    ],
    [showProjection, showSupplyPlan, showAllChannelSales, hideSales, showIncoming],
  );
  const numGroupStarts = useMemo(() => groupStarts(numCols), [numCols]);

  const numGroups = useMemo(() => ([
    { key: "instock"   as const, label: `Instock ( ${MONTH_RANGE} )`, span: 5 },
    ...(showProjection
      ? [{ key: "projection" as const, label: `Monthly Projection ( ${FORWARD_RANGE} )`, span: 5 }]
      : []),
    ...(hideSales
      ? []
      : [{ key: "sales" as const, label: `${salesLabel} ( ${salesRange} )`, span: 5 }]),
    ...(showAllChannelSales
      ? [{ key: "websiteSales" as const, label: `Website Sales ( ${salesRange} )`, span: 5 },
         { key: "otherSales" as const, label: `Other Channel Sales ( ${salesRange} )`, span: 5 }]
      : []),
    { key: "inventory" as const, label: "Inventory Buckets", span: 3 },
    ...(showSupplyPlan
      ? [{ key: "supply" as const, label: `Supply Plan ( ${SUPPLY_RANGE} )`, span: 6 }]
      : []),
    ...(showIncoming
      ? [{ key: "incoming" as const, label: `Inbound Shipment ( ${INCOMING_RANGE} )`, span: INCOMING_COLS.length },
         { key: "incomingBreak" as const, label: "Incoming Breakdown", span: INCOMING_BREAKDOWN_COLS.length }]
      : []),
  ]), [salesLabel, salesRange, showProjection, showSupplyPlan, showAllChannelSales, hideSales, showIncoming]);

  /** Column header label — sales columns (sale_1..sale_5) follow `salesMonths`
   *  so the forward tab shows Jun…Oct; all other columns use their static label. */
  const colLabel = (c: NumCol): string => {
    if (c.group === "projection") {
      const n = Number(c.key.split("_")[1]);
      return FORWARD_MONTHS[n - 1] ?? c.label;
    }
    if (c.group === "supply") {
      const n = Number(c.key.split("_")[1]);
      return SUPPLY_MONTHS[n - 1] ?? c.label;
    }
    if (c.group === "incoming") {
      const n = Number(c.key.split("_")[1]);
      return INCOMING_MONTHS[n - 1] ?? c.label;
    }
    // Cross-channel sales share the base sales band's table-driven labels
    // (forecast_channel_sales month_4..0_label), never JS date math.
    if (c.group === "websiteSales" || c.group === "otherSales") {
      const n = Number(c.key.split("_")[1]);
      return salesMonths[n - 1] ?? c.label;
    }
    if (c.group !== "sales") return c.label;
    const n = Number(c.key.split("_")[1]);
    return salesMonths[n - 1] ?? c.label;
  };

  // Shared fetch + key (see lib/dashboard/channelRows) so the Flagged SKUs
  // cross-channel sales reuse the exact rows a channel tab already loaded.
  const { data = [], isLoading } = useQuery<Row[]>({
    queryKey: channelRowsQueryKey(tableName, salesKeyPrefix),
    refetchOnWindowFocus: false,
    // Keep fetched rows fresh for 5 min so switching tabs (which remounts the
    // table) shows cached data instantly instead of re-fetching every time.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: () => fetchChannelRows(tableName, salesKeyPrefix) as Promise<Row[]>,
  });

  // Monthly Projection tab: the sales band shows LIVE forecast projections
  // (proj_month_1..5 = Jun..Oct), computed in the UI exactly like the Forecast
  // Report page. Fetch only when this tab is active; overlay onto sale_1..5 by SKU.
  const { projectionMap, supplyMap } = useMonthlyProjection(forwardSales || showProjection || showSupplyPlan);
  const { websiteSalesBySku, otherSalesBySku, isLoading: crossLoading } = useCrossChannelSales(showAllChannelSales);
  // Inbound Shipment + Incoming Breakdown values, pulled from forecast_report by SKU.
  const { incomingMap } = useIncomingShipment(showIncoming);

  // ── Product Name + Category mula sa Demand Planner UI recipe ──
  // Parehong sources ng Demand Planner page: the ERP name override
  // (erp_product_details) kung meron, kung wala ay forecast_report.description;
  // Category = forecast_report.category. Fallback sa sariling laman ng
  // channel table para sa mga SKU na wala sa forecast_report.
  const { data: frInfoRows = [] } = useQuery({
    queryKey: ["channel_fr_name_category"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const all: Record<string, unknown>[] = [];
      const BATCH = 1000;
      let from = 0;
      while (true) {
        const { data: page, error } = await (externalSupabase as any)
          .from("forecast_report")
          .select(
            "sku,description,category,kit,shadow,factory," +
            "oh_inv,otw_units,on_order_units," +
            [1, 2, 3, 4, 5].map((i) => `proj_month_${i}`).join(",") + "," +
            [1, 2, 3, 4, 5, 6].map((i) => `supply_month_${i}`).join(","),
          )
          .range(from, from + BATCH - 1);
        if (error) throw error;
        if (!page || page.length === 0) break;
        all.push(...page);
        if (page.length < BATCH) break;
        from += BATCH;
      }
      return all;
    },
  });
  const { data: scNameRows = [] } = useQuery({
    queryKey: ["channel_sc_names"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        return await fetchScProductNames(externalSupabase);
      } catch {
        return [];
      }
    },
  });
  const frInfoMap = useMemo(() => {
    const m = new Map<string, {
      name: string | null; category: string | null;
      kit: string | null; shadow: string | null; factory: string | null;
      oh_inv: number | null; otw: number | null; oo: number | null;
      proj: (number | null)[]; supply: (number | null)[];
    }>();
    const yn = (v: unknown) => (/^y/i.test(String(v ?? "").trim()) ? "Yes" : "No");
    const num = (v: unknown) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    for (const r of frInfoRows) {
      const s = String(r.sku ?? "").trim();
      if (s) m.set(s, {
        name: (r.description as string) ?? null,
        category: (r.category as string) ?? null,
        kit: yn(r.kit),
        shadow: yn(r.shadow),
        factory: (r.factory as string) ?? null,
        oh_inv: num(r.oh_inv),
        otw: num(r.otw_units),
        oo: num(r.on_order_units),
        proj: [1, 2, 3, 4, 5].map((i) => num(r[`proj_month_${i}`])),
        supply: [1, 2, 3, 4, 5, 6].map((i) => num(r[`supply_month_${i}`])),
      });
    }
    return m;
  }, [frInfoRows]);

  // Proj/Supply overrides — parehong patong na ipinapakita ng Demand Planner UI
  const { data: projOvrRows = [] } = useQuery({
    queryKey: ["channel_fr_proj_override"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data: rows } = await (externalSupabase as any)
        .from("forecast_report_proj_override").select("*").limit(10000);
      return (rows ?? []) as Record<string, unknown>[];
    },
  });
  const { data: supplyOvrRows = [] } = useQuery({
    queryKey: ["channel_fr_supply_override"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data: rows } = await (externalSupabase as any)
        .from("forecast_report_supply_override").select("*").limit(10000);
      return (rows ?? []) as Record<string, unknown>[];
    },
  });
  const projOvrMap = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of projOvrRows) { const s = String(r.sku ?? "").trim(); if (s) m.set(s, r); }
    return m;
  }, [projOvrRows]);
  const supplyOvrMap = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of supplyOvrRows) { const s = String(r.sku ?? "").trim(); if (s) m.set(s, r); }
    return m;
  }, [supplyOvrRows]);
  const scNameMap = useMemo(() => buildScNameMap(scNameRows), [scNameRows]);

  const namedData = useMemo(() => {
    if (frInfoMap.size === 0 && scNameMap.size === 0) return data;
    // Habang hindi pa loaded ang forecast list, ipakita ang channel rows as-is
    // (name overlay lang kung may SC names na).
    if (frInfoMap.size === 0) {
      return data.map((r) => {
        const scName = scNameMap.get(String(r.sku ?? "").trim());
        return scName && scName !== r.product_name ? { ...r, product_name: scName } : r;
      });
    }
    // Mirror ng BUONG Demand Planner universe :
    //  - channel rows na nasa forecast → ipakita (may name/category overlay)
    //  - channel rows na WALA sa forecast (luma/discontinued) → tanggal
    //  - forecast SKUs na WALA sa channel table → synthetic row na blangko
    //    ang channel metrics (instock/sales = "—") pero buo ang product info
    const bySku = new Map<string, Row>();
    for (const r of data) {
      const k = String(r.sku ?? "").trim();
      if (k && !bySku.has(k)) bySku.set(k, r);
    }
    const out: Row[] = [];
    // Unang bahagi: sundin ang original channel order para pamilyar ang view
    for (const r of data) {
      const key = String(r.sku ?? "").trim();
      if (!key || !frInfoMap.has(key)) continue;
      const fr = frInfoMap.get(key)!;
      const scName = scNameMap.get(key);
      const name = scName ?? fr.name ?? r.product_name;
      const category = fr.category ?? r.category;
      // Sales band mula forecast_channel_sales (sale_1=Apr=*_month_4 …
      // sale_5=kasalukuyang buwan=*_month_0); fallback sa channel table
      // kapag walang row ang SKU doon.
      const fcs = channelPrefix ? fcsMap.get(key) : undefined;
      const fnum = (v: unknown) => {
        if (v == null || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const sales = fcs
        ? {
            sale_1: fnum(fcs[`${channelPrefix}_month_4`]),
            sale_2: fnum(fcs[`${channelPrefix}_month_3`]),
            sale_3: fnum(fcs[`${channelPrefix}_month_2`]),
            sale_4: fnum(fcs[`${channelPrefix}_month_1`]),
            sale_5: fnum(fcs[`${channelPrefix}_month_0`]),
          }
        : {};
      out.push({
        ...r,
        product_name: name ?? r.product_name,
        category: category ?? r.category,
        // Inventory Buckets mula sa Demand Planner UI (fallback sa channel)
        oh_inv: fr.oh_inv ?? r.oh_inv,
        otw: fr.otw ?? r.otw,
        oo_unit: fr.oo ?? r.oo_unit,
        ...sales,
      });
    }
    // Pangalawa: idagdag ang mga forecast SKU na wala sa channel table
    let synthId = -1;
    const fnum2 = (v: unknown) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    for (const [sku, fr] of frInfoMap) {
      if (bySku.has(sku)) continue;
      const scName = scNameMap.get(sku);
      const fcs = channelPrefix ? fcsMap.get(sku) : undefined;
      out.push({
        id: synthId--,
        sku,
        product_name: scName ?? fr.name ?? null,
        factory: fr.factory,
        kit: fr.kit,
        shadow: fr.shadow,
        category: fr.category,
        instock_1: null, instock_2: null, instock_3: null, instock_4: null, instock_5: null,
        sale_1: fcs ? fnum2(fcs[`${channelPrefix}_month_4`]) : null,
        sale_2: fcs ? fnum2(fcs[`${channelPrefix}_month_3`]) : null,
        sale_3: fcs ? fnum2(fcs[`${channelPrefix}_month_2`]) : null,
        sale_4: fcs ? fnum2(fcs[`${channelPrefix}_month_1`]) : null,
        sale_5: fcs ? fnum2(fcs[`${channelPrefix}_month_0`]) : null,
        oh_inv: fr.oh_inv, otw: fr.otw, oo_unit: fr.oo,
      } as Row);
    }
    return out;
  }, [data, frInfoMap, scNameMap, fcsMap, channelPrefix]);

  const projectedData = useMemo(() => {
    const needsProj = forwardSales || showProjection || showSupplyPlan;
    if (!needsProj && !showAllChannelSales && !showIncoming) return namedData;
    return namedData.map(r => {
      const proj = r.sku ? projectionMap.get(r.sku) : undefined;
      // Projection/Supply mula sa Demand Planner UI: override ?? forecast_report
      // row value — computed hook value bilang huling fallback lang.
      const frKey = String(r.sku ?? "").trim();
      const frv = frInfoMap.get(frKey);
      const pOvr = projOvrMap.get(frKey);
      const sOvr = supplyOvrMap.get(frKey);
      const ovNum = (v: unknown) => {
        if (v == null || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const projVals = [1, 2, 3, 4, 5].map(
        (i) => ovNum(pOvr?.[`proj_month_${i}_override`]) ?? frv?.proj[i - 1] ?? proj?.[i - 1] ?? 0,
      );
      // forwardSales: OVERLAY projection onto the sales band (replace).
      if (forwardSales) {
        return { ...r, sale_1: projVals[0], sale_2: projVals[1], sale_3: projVals[2], sale_4: projVals[3], sale_5: projVals[4] };
      }
      // Otherwise ADD separate bands, leaving sale_* intact.
      const supply = showSupplyPlan && r.sku ? supplyMap.get(r.sku) : undefined;
      const supplyVals = [1, 2, 3, 4, 5, 6].map(
        (i) => ovNum(sOvr?.[`supply_month_${i}_override`]) ?? frv?.supply[i - 1] ?? supply?.[i - 1] ?? 0,
      );
      // websiteSalesBySku/otherSalesBySku key on a TRIMMED sku (useCrossChannelSales
      // trims to normalize copy-pasted spreadsheet SKUs, common on kit/x4 variants) —
      // match that here or the lookup silently misses and shows 0/empty.
      const ws = showAllChannelSales && r.sku ? websiteSalesBySku.get(r.sku.trim()) : undefined;
      const os = showAllChannelSales && r.sku ? otherSalesBySku.get(r.sku.trim()) : undefined;
      const inc = showIncoming && r.sku ? incomingMap.get(r.sku) : undefined;
      return {
        ...r,
        ...(showProjection ? {
          proj_1: projVals[0], proj_2: projVals[1], proj_3: projVals[2],
          proj_4: projVals[3], proj_5: projVals[4],
        } : {}),
        ...(showAllChannelSales ? {
          wsale_1: ws?.[0] ?? 0, wsale_2: ws?.[1] ?? 0, wsale_3: ws?.[2] ?? 0, wsale_4: ws?.[3] ?? 0, wsale_5: ws?.[4] ?? 0,
          osale_1: os?.[0] ?? 0, osale_2: os?.[1] ?? 0, osale_3: os?.[2] ?? 0, osale_4: os?.[3] ?? 0, osale_5: os?.[4] ?? 0,
        } : {}),
        ...(showSupplyPlan ? {
          supply_1: supplyVals[0], supply_2: supplyVals[1], supply_3: supplyVals[2],
          supply_4: supplyVals[3], supply_5: supplyVals[4], supply_6: supplyVals[5],
        } : {}),
        ...(showIncoming ? {
          incoming_1: inc?.incoming[0] ?? 0, incoming_2: inc?.incoming[1] ?? 0, incoming_3: inc?.incoming[2] ?? 0,
          incoming_4: inc?.incoming[3] ?? 0, incoming_5: inc?.incoming[4] ?? 0, incoming_6: inc?.incoming[5] ?? 0,
          incoming_7: inc?.incoming[6] ?? 0, incoming_8: inc?.incoming[7] ?? 0, incoming_9: inc?.incoming[8] ?? 0,
          oo_30: inc?.oo[0] ?? 0, oo_60: inc?.oo[1] ?? 0, oo_90: inc?.oo[2] ?? 0,
        } : {}),
      };
    });
  }, [namedData, forwardSales, showProjection, showSupplyPlan, showAllChannelSales, showIncoming, projectionMap, supplyMap, websiteSalesBySku, otherSalesBySku, incomingMap, frInfoMap, projOvrMap, supplyOvrMap]);

  // Factory/region gate applied once — both the filter options and the table
  // derive from this, so dropdowns never reveal other countries' factories.
  const gatedData = useMemo(
    () => (restricted ? projectedData.filter(r => allowSku(r.sku)) : projectedData),
    [projectedData, restricted, allowSku],
  );

  // Per-row alert verdict, keyed by SKU. Only flagged rows are stored.
  // Stagnant cross-checks the channel's OWN recent monthly sales (sale_4 + sale_5)
  // so it can never contradict the sales the user sees — order history only
  // contributes the "days since last sale" detail when those months are zero.
  const alertBySku = useMemo(() => {
    const m = new Map<string, RowAlert>();
    if (!showAlerts) return m;
    for (const r of gatedData) {
      const sku = r.sku ?? "";
      if (!sku) continue;
      // "In stock" = any committed stock: on-hand + on-the-way + on-order.
      const stockUnits = (Number(r.oh_inv) || 0) + (Number(r.otw) || 0) + (Number(r.oo_unit) || 0);
      // Stagnant = no recent sales in the last ~2 months across ALL channels
      // (Amazon + Website + Other). An item still selling anywhere is not stale.
      const recentSales =
        (Number(r.sale_5) || 0) + (Number(r.sale_4) || 0) +
        (Number(r.wsale_5) || 0) + (Number(r.wsale_4) || 0) +
        (Number(r.osale_5) || 0) + (Number(r.osale_4) || 0);
      const stagnant = stockUnits > 0 && recentSales === 0;
      const activeNotListed = isActivePurchasing(puStatusBySku.get(sku)) && isNotListedOnShopify(shopifyStatusBySku.get(sku));
      if (stagnant || activeNotListed) m.set(sku, { stagnant, activeNotListed });
    }
    return m;
  }, [showAlerts, gatedData, puStatusBySku, shopifyStatusBySku]);

  // Derive filter options from the gated data
  const productNameOptions = useMemo(() => uniq(gatedData.map(r => r.product_name)), [gatedData]);
  const productIdOptions   = useMemo(() => uniq(gatedData.map(r => r.sku)),          [gatedData]);
  const factoryOptions     = useMemo(() => uniq(gatedData.map(r => r.factory)),      [gatedData]);
  const kitOptions         = useMemo(() => uniq(gatedData.map(r => r.kit)),          [gatedData]);
  const shadowOptions      = useMemo(() => uniq(gatedData.map(r => r.shadow)),       [gatedData]);
  const categoryOptions    = useMemo(() => uniq(gatedData.map(r => r.category)),     [gatedData]);

  // Status filter options (Flagged SKUs view) — derived from flagged rows.
  const shopifyLabelOf = (sku: string | null) =>
    isNotListedOnShopify(shopifyStatusBySku.get(sku ?? "")) ? "Not Listed" : titleCase(shopifyStatusBySku.get(sku ?? "") ?? "");
  const purchasingLabelOf = (sku: string | null) => titleCase(puStatusBySku.get(sku ?? "") ?? "");
  const flaggedRows = useMemo(() => gatedData.filter(r => r.sku && alertBySku.has(r.sku)), [gatedData, alertBySku]);
  const purchasingOptions = useMemo(() => uniq(flaggedRows.map(r => purchasingLabelOf(r.sku))), [flaggedRows, puStatusBySku]);
  const shopifyOptions    = useMemo(() => uniq(flaggedRows.map(r => shopifyLabelOf(r.sku))),    [flaggedRows, shopifyStatusBySku]);

  const filtered = useMemo(() => {
    let rows = gatedData;
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter(r => r.sku?.toLowerCase().includes(q) || r.product_name?.toLowerCase().includes(q));
    if (filterProductName.length) rows = rows.filter(r => filterProductName.includes(r.product_name ?? ""));
    if (filterProductId.length)   rows = rows.filter(r => filterProductId.includes(r.sku ?? ""));
    if (filterFactory.length)     rows = rows.filter(r => filterFactory.includes(r.factory ?? ""));
    if (filterKit.length)         rows = rows.filter(r => filterKit.includes(r.kit ?? ""));
    if (filterShadow.length)      rows = rows.filter(r => filterShadow.includes(r.shadow ?? ""));
    if (filterCategory.length)    rows = rows.filter(r => filterCategory.includes(r.category ?? ""));
    if (showAlerts) {
      rows = rows.filter(r => {
        const a = r.sku ? alertBySku.get(r.sku) : undefined;
        if (!a) return false;
        if (alertFilter === "stagnant") return a.stagnant;
        if (alertFilter === "activeNotListed") return a.activeNotListed;
        if (alertFilter === "both") return a.stagnant && a.activeNotListed;
        return true;
      });
      if (filterPurchasing.length) rows = rows.filter(r => filterPurchasing.includes(purchasingLabelOf(r.sku)));
      if (filterShopify.length)    rows = rows.filter(r => filterShopify.includes(shopifyLabelOf(r.sku)));
      if (filterNoSales.length)    rows = rows.filter(r => filterNoSales.includes(alertBySku.get(r.sku ?? "")?.stagnant ? "Yes" : "No"));
      if (filterMissing.length)    rows = rows.filter(r => filterMissing.includes(alertBySku.get(r.sku ?? "")?.activeNotListed ? "Yes" : "No"));
    }
    return rows;
  }, [gatedData, search, filterProductName, filterProductId, filterFactory, filterKit, filterShadow, filterCategory, showAlerts, alertBySku, alertFilter, filterPurchasing, filterShopify, filterNoSales, filterMissing, puStatusBySku, shopifyStatusBySku]);

  // Flag counts + on-hand units for the KPI cards — all flagged SKUs, before
  // search/sub-filter. Units come from each row's oh_inv.
  const flagCounts = useMemo(() => {
    let all = 0, allUnits = 0, stag = 0, stagUnits = 0, anl = 0, anlUnits = 0, both = 0;
    for (const r of gatedData) {
      const a = r.sku ? alertBySku.get(r.sku) : undefined;
      if (!a) continue;
      const oh = Number(r.oh_inv) || 0;
      all++; allUnits += oh;
      if (a.stagnant) { stag++; stagUnits += oh; }
      if (a.activeNotListed) { anl++; anlUnits += oh; }
      if (a.stagnant && a.activeNotListed) both++;
    }
    return { all, allUnits, stag, stagUnits, anl, anlUnits, both };
  }, [gatedData, alertBySku]);

  const sorted = useMemo(() => {
    if (!sortCol || !sortDir) return filtered;
    // Status columns live in the alert maps, not on the row — sort by those.
    if (sortCol === "__pu_status" || sortCol === "__shopify_status") {
      const lookup = sortCol === "__pu_status" ? puStatusBySku : shopifyStatusBySku;
      return [...filtered].sort((a, b) => {
        const av = (a.sku ? lookup.get(a.sku) : "") ?? "";
        const bv = (b.sku ? lookup.get(b.sku) : "") ?? "";
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return [...filtered].sort((a, b) => {
      const av = STR_COLS.includes(sortCol) ? ((a as any)[sortCol] ?? "") : ((a as any)[sortCol] ?? 0);
      const bv = STR_COLS.includes(sortCol) ? ((b as any)[sortCol] ?? "") : ((b as any)[sortCol] ?? 0);
      if (typeof av === "string")
        return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [filtered, sortCol, sortDir, puStatusBySku, shopifyStatusBySku]);

  // Pagination
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(100);

  useEffect(() => { setPage(1); }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  const [exporting, setExporting] = useState(false);

  /** Export the FULL filtered+sorted dataset (all pages) as a styled XLSX that
   *  mirrors the grid 1:1 — band colors, banners, zebra rows, pills, and the
   *  exact displayed formats. Heavy lib (exceljs) is loaded on demand. */
  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const { exportChannelDashboardXlsx } = await import("@/lib/channelDashboardXlsx");
      await exportChannelDashboardXlsx({
        fileName: `${tableName}-${new Date().toISOString().slice(0, 10)}`,
        sheetName: salesLabel.replace(/[\\/?*[\]:]/g, " ") || "Dashboard",
        groups: numGroups.map(g => ({ key: g.key, label: g.label, span: g.span })),
        numCols: numCols.map(c => ({ key: c.key, label: colLabel(c), group: c.group, bold: c.bold })),
        showAlerts,
        rows: sorted.map(row => {
          const { main, variant } = splitProductName(row.product_name ?? "");
          const a = showAlerts && row.sku ? alertBySku.get(row.sku) : undefined;
          return {
            nameMain: main || row.sku || "—",
            nameVariant: variant,
            sku: row.sku ?? "—",
            category: row.category ?? "—",
            kit: yesNoText(row.kit),
            shadow: yesNoText(row.shadow),
            ...(showAlerts ? {
              puStatus: titleCase(puStatusBySku.get(row.sku ?? "") ?? ""),
              shopifyStatus: shopifyLabelOf(row.sku),
              noSales: !!a?.stagnant,
              missingListing: !!a?.activeNotListed,
            } : {}),
            values: Object.fromEntries(numCols.map(c => [c.key, (row as any)[c.key] ?? null])),
          };
        }),
      });
    } finally {
      setExporting(false);
    }
  }

  function handleSort(col: string) {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : d === "desc" ? null : "asc");
      if (sortDir === null) setSortCol("");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  // ── Forecast-report header styling ──
  // Banner row (group bands) and column-label row both carry the group color.
  const bannerBase = "border border-border px-2 py-1 text-center text-[12px] font-bold text-slate-900 whitespace-nowrap";
  const colHeadBase = "select-none cursor-pointer border border-border px-2 py-1.5 text-center text-[11px] font-bold text-slate-900 uppercase tracking-wide whitespace-nowrap hover:brightness-95 transition";
  const tdBase   = "px-2.5 py-1.5 text-[12px] border-b border-r border-border/60 whitespace-nowrap";
  const tdSticky = "sticky z-10";
  // Opaque sticky-cell backgrounds (see .cm-sticky in index.css). MUST be
  // opaque or horizontally-scrolled content bleeds through the pinned columns.
  const stickyBg = (idx: number) => (idx % 2 === 1 ? "cm-sticky-alt" : "cm-sticky");

  const alertCards: {
    key: AlertFilter; n: number; label: string; sub: string; Icon: LucideIcon;
    iconCls: string; ringCls: string;
  }[] = [
    { key: "all", n: flagCounts.all, label: "All Flagged Items", sub: `${flagCounts.allUnits.toLocaleString()} units on hand`,
      Icon: AlertTriangle, iconCls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", ringCls: "border-slate-500 ring-slate-500" },
    { key: "stagnant", n: flagCounts.stag, label: "No Recent Sales", sub: `${flagCounts.stagUnits.toLocaleString()} idle units · 30d+`,
      Icon: TrendingDown, iconCls: "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300", ringCls: "border-red-500 ring-red-500" },
    { key: "activeNotListed", n: flagCounts.anl, label: "Missing Shopify Listing", sub: "active in purchasing, not on Shopify",
      Icon: EyeOff, iconCls: "bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300", ringCls: "border-violet-500 ring-violet-500" },
    { key: "both", n: flagCounts.both, label: "Needs Urgent Review", sub: "both issues at once",
      Icon: AlertOctagon, iconCls: "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-300", ringCls: "border-amber-500 ring-amber-500" },
  ];

  return (
    <>
      {/* ── Flagged SKUs KPI cards ── */}
      {showAlerts && (
        <div className="shrink-0 grid grid-cols-2 gap-2.5 border-b border-border bg-background/95 px-4 py-3 lg:grid-cols-4">
          {alertCards.map(c => {
            const active = alertFilter === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={active}
                onClick={() => setAlertFilter(c.key)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border bg-background px-4 py-3 text-left transition",
                  active ? cn("ring-1", c.ringCls) : "border-border hover:border-muted-foreground/40 hover:shadow-sm",
                )}
              >
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", c.iconCls)}>
                  <c.Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-2xl font-bold tabular-nums leading-none">{c.n.toLocaleString()}</div>
                  <div className="mt-1 truncate text-xs font-semibold text-foreground" title={c.label}>{c.label}</div>
                  <div className="truncate text-[11px] text-muted-foreground" title={c.sub}>{c.sub}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur-sm">
        {/* Search */}
        <div className="relative w-52">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU or product…"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <MultiSelectFilter label="Product ID"   options={productIdOptions}   value={filterProductId}   onApply={setFilterProductId}   />
        <MultiSelectFilter label="Product Name" options={productNameOptions} value={filterProductName} onApply={setFilterProductName} />
        <MultiSelectFilter label="Factory"      options={factoryOptions}     value={filterFactory}     onApply={setFilterFactory}     />
        <MultiSelectFilter label="Kit"          options={kitOptions}         value={filterKit}         onApply={setFilterKit}         formatLabel={v => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()} />
        <MultiSelectFilter label="Shadow"       options={shadowOptions}      value={filterShadow}      onApply={setFilterShadow}      formatLabel={v => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()} />
        <MultiSelectFilter label="Category"     options={categoryOptions}    value={filterCategory}    onApply={setFilterCategory}    />
        {showAlerts && (
          <>
            <MultiSelectFilter label="Purchasing Status" options={purchasingOptions} value={filterPurchasing} onApply={setFilterPurchasing} />
            <MultiSelectFilter label="Shopify Status"    options={shopifyOptions}    value={filterShopify}    onApply={setFilterShopify}    />
            <MultiSelectFilter label="No Recent Sales"   options={["Yes", "No"]}     value={filterNoSales}    onApply={setFilterNoSales}    />
            <MultiSelectFilter label="Missing Listing"   options={["Yes", "No"]}     value={filterMissing}    onApply={setFilterMissing}    />
          </>
        )}

        {/* Clear Filters — always visible */}
        {(() => {
          const activeCount = filterProductId.length + filterProductName.length + filterFactory.length + filterKit.length + filterShadow.length + filterCategory.length + filterPurchasing.length + filterShopify.length + filterNoSales.length + filterMissing.length + (search ? 1 : 0);
          return (
            <Button
              variant="ghost"
              size="sm"
              disabled={activeCount === 0}
              className="h-8 gap-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
              onClick={() => {
                setSearch("");
                setFilterProductId([]);
                setFilterProductName([]);
                setFilterFactory([]);
                setFilterKit([]);
                setFilterShadow([]);
                setFilterCategory([]);
                setFilterPurchasing([]);
                setFilterShopify([]);
                setFilterNoSales([]);
                setFilterMissing([]);
              }}
            >
              <X className="h-3.5 w-3.5" />
              Clear Filters
              {activeCount > 0 && <span className="ml-1 text-xs">({activeCount})</span>}
            </Button>
          );
        })()}

        {/* Export — full filtered dataset (all pages), styled exactly like the grid */}
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading || exporting || sorted.length === 0}
          className="ml-auto h-8 gap-1.5"
          onClick={handleExport}
        >
          <Download className={cn("h-3.5 w-3.5", exporting && "animate-bounce")} />
          {exporting ? "Exporting…" : "Export"}
        </Button>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 min-h-0 relative overflow-auto" style={{ isolation: "isolate" }}>
        {isLoading || (showAlerts && alertsLoading) || (showAllChannelSales && crossLoading) || !accessReady ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded" />
            ))}
          </div>
        ) : (
          <table className="border-separate border-spacing-0 text-sm min-w-full">
            <thead className="sticky top-0 z-30">
              {/* ── Row 1: group banners ── */}
              <tr>
                {/* Product Information — label lives in the pinned 2-col cell
                    (so it stays put on horizontal scroll) but is centered across
                    the whole 6-col group via an overflowing absolute label. */}
                <th
                  colSpan={2}
                  className={cn(bannerBase, GROUP_BG.basic, "sticky left-0 z-20 relative overflow-visible")}
                  style={{ top: 0, height: 30, width: NAME_W + ID_W, minWidth: NAME_W + ID_W, maxWidth: NAME_W + ID_W }}
                >
                  <span
                    className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-center whitespace-nowrap"
                    style={{ width: NAME_W + ID_W + INFO_COLS.length * 80 }}
                  >
                    Product Information
                  </span>
                </th>
                {/* Product Information — scrolling remainder (info cols + optional Purchasing/Shopify) */}
                <th colSpan={INFO_COLS.length + (showAlerts ? 2 : 0)} className={cn(bannerBase, GROUP_BG.basic)} style={{ top: 0, height: 30 }} />

                {/* Numeric group banners — each begins a new category, so each
                    carries the group separator on its left edge. */}
                {numGroups.map(g => (
                  <th key={g.key} colSpan={g.span} className={cn(bannerBase, GROUP_BG[g.key], SEP)} style={{ top: 0, height: 30 }}>
                    {g.label}
                  </th>
                ))}

                {/* Alert banner — two issue columns at the far right (Flagged SKUs view). */}
                {showAlerts && (
                  <th colSpan={2} className={cn(bannerBase, GROUP_BG.basic, SEP)} style={{ top: 0, height: 30 }}>Alert</th>
                )}
              </tr>

              {/* ── Row 2: column labels ── */}
              <tr>
                {/* Product Name — pinned left */}
                <th
                  onClick={() => handleSort("product_name")}
                  className={cn(colHeadBase, GROUP_BG.basic, "sticky left-0 z-20")}
                  style={{ top: 30, width: NAME_W, minWidth: NAME_W, maxWidth: NAME_W }}
                >
                  Product Name <SortIcon col="product_name" sortCol={sortCol} sortDir={sortDir} />
                </th>

                {/* Product ID — pinned left, next to Product Name */}
                <th
                  onClick={() => handleSort("sku")}
                  className={cn(colHeadBase, GROUP_BG.basic, "sticky z-20")}
                  style={{ top: 30, left: NAME_W, width: ID_W, minWidth: ID_W, maxWidth: ID_W }}
                >
                  Product ID <SortIcon col="sku" sortCol={sortCol} sortDir={sortDir} />
                </th>

                {/* Info columns */}
                {INFO_COLS.map(c => (
                  <th
                    key={c.key}
                    onClick={() => handleSort(c.key)}
                    className={cn(colHeadBase, GROUP_BG.basic, "min-w-[80px]")}
                    style={{ top: 30 }}
                  >
                    {c.label} <SortIcon col={c.key} sortCol={sortCol} sortDir={sortDir} />
                  </th>
                ))}

                {/* Purchasing + Shopify status (Flagged SKUs view only) */}
                {showAlerts && (
                  <>
                    <th onClick={() => handleSort("__pu_status")} className={cn(colHeadBase, GROUP_BG.basic, "min-w-[100px]")} style={{ top: 30 }}>
                      Purchasing<br />Status <SortIcon col="__pu_status" sortCol={sortCol} sortDir={sortDir} />
                    </th>
                    <th onClick={() => handleSort("__shopify_status")} className={cn(colHeadBase, GROUP_BG.basic, "min-w-[100px]")} style={{ top: 30 }}>
                      Shopify<br />Status <SortIcon col="__shopify_status" sortCol={sortCol} sortDir={sortDir} />
                    </th>
                  </>
                )}

                {/* Numeric columns */}
                {numCols.map(c => (
                  <th
                    key={c.key}
                    onClick={() => handleSort(c.key)}
                    className={cn(colHeadBase, GROUP_BG[c.group], "min-w-[78px]", numGroupStarts.has(c.key) && SEP)}
                    style={{ top: 30 }}
                  >
                    {colLabel(c)} <SortIcon col={c.key} sortCol={sortCol} sortDir={sortDir} />
                  </th>
                ))}

                {/* Alert — two far-right columns (Flagged SKUs view only) */}
                {showAlerts && (
                  <>
                    <th className={cn(colHeadBase, GROUP_BG.basic, SEP, "min-w-[130px] cursor-default hover:brightness-100")} style={{ top: 30 }}>
                      No Recent<br />Sales
                    </th>
                    <th className={cn(colHeadBase, GROUP_BG.basic, "min-w-[130px] cursor-default hover:brightness-100")} style={{ top: 30 }}>
                      Missing Shopify<br />Listing
                    </th>
                  </>
                )}
              </tr>
            </thead>

            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={numCols.length + INFO_COLS.length + 2 + (showAlerts ? 4 : 0)} className="py-16 text-center text-sm text-muted-foreground">
                    {showAlerts ? "Nothing needs attention right now." : <>No records{search && ` matching "${search}"`}.</>}
                  </td>
                </tr>
              ) : (
                paginated.map((row, idx) => {
                  const nameRaw = row.product_name ?? "";
                  const { main, variant } = splitProductName(nameRaw);
                  return (
                    <tr key={row.id ?? `${row.sku}-${idx}`} className={cn("group transition-colors duration-75 hover:bg-muted/40", idx % 2 === 1 && "bg-muted/20")}>
                      {/* Product Name — pinned left */}
                      <td className={cn(tdBase, tdSticky, "left-0 border-r border-border/60", stickyBg(idx))} style={{ width: NAME_W, minWidth: NAME_W, maxWidth: NAME_W }}>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <ProductImage productId={row.sku ?? ""} productName={nameRaw || (row.sku ?? "")} readOnly />
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate text-[12px] font-semibold text-foreground" title={nameRaw}>
                              {main || row.sku}
                            </div>
                            {variant && <div className="truncate text-[11px] text-muted-foreground">{variant}</div>}
                          </div>
                        </div>
                      </td>

                      {/* Product ID — pinned left, next to Product Name */}
                      <td className={cn(tdBase, tdSticky, "border-r border-border/60 text-center text-[12px] font-medium text-foreground", stickyBg(idx))} style={{ left: NAME_W, width: ID_W, minWidth: ID_W, maxWidth: ID_W }}>{row.sku ?? "—"}</td>

                      {/* Info columns */}
                      <td className={cn(tdBase, "text-center text-[12px] text-foreground")}>{row.category ?? "—"}</td>
                      <td className={cn(tdBase, "text-center")}><YesNoBadge value={row.kit} /></td>
                      <td className={cn(tdBase, "text-center")}><YesNoBadge value={row.shadow} /></td>

                      {/* Purchasing + Shopify status (Flagged SKUs view only) */}
                      {showAlerts && (
                        <>
                          <td className={cn(tdBase, "text-center")}>
                            <PurchasingStatusBadge
                              value={row.sku ? (puStatusBySku.get(row.sku) ?? "") : ""}
                              href={row.sku ? toSafeHttpUrl(purchasingUrlBySku.get(row.sku)) ?? undefined : undefined}
                            />
                          </td>
                          <td className={cn(tdBase, "text-center")}>
                            <ShopifyStatusBadge
                              value={row.sku ? (shopifyStatusBySku.get(row.sku) ?? "") : ""}
                              href={row.sku ? toSafeHttpUrl(shopifyUrlBySku.get(row.sku)) ?? undefined : undefined}
                            />
                          </td>
                        </>
                      )}

                      {/* Numeric columns */}
                      {numCols.map(c => (
                        <td
                          key={c.key}
                          className={cn(
                            tdBase, "text-center tabular-nums text-foreground",
                            c.bold && "font-semibold",
                            numGroupStarts.has(c.key) && SEP,
                          )}
                        >
                          {numCellText(c, row)}
                        </td>
                      ))}

                      {/* Alert — two far-right columns (Flagged SKUs view only) */}
                      {showAlerts && (() => {
                        const a = row.sku ? alertBySku.get(row.sku) : undefined;
                        return (
                          <>
                            <td className={cn(tdBase, "text-center", SEP)}><NoSalesBadge on={!!a?.stagnant} /></td>
                            <td className={cn(tdBase, "text-center")}><MissingListingBadge on={!!a?.activeNotListed} /></td>
                          </>
                        );
                      })()}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination Footer ── */}
      <div className={cn("flex shrink-0 items-center justify-between border-t border-border bg-background px-4 py-2 text-xs text-muted-foreground", isLoading && "invisible")}>
        <div className="flex items-center gap-2">
          <span>Rows per page:</span>
          <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="h-7 w-16 rounded border border-border text-xs shadow-none focus:ring-0 focus:ring-offset-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[100, 200, 500, 1000].map(n => (
                <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <span>{sorted.length.toLocaleString()} records</span>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setPage(1)} disabled={page === 1}
              className="rounded p-1 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronsLeft className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="rounded p-1 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-2">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="rounded p-1 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
              className="rounded p-1 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronsRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
