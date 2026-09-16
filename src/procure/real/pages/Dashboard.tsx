import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useExecutiveDashboard } from "@/hooks/useExecutiveDashboard";
import { useDashboardData, type NewOrdersRange } from "@/hooks/useDashboardData";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { useCountUp } from "@/hooks/useCountUp";
import { useFactoryAccess } from "@/hooks/useFactoryAccess";

import { ShoppingCart, RefreshCw, Truck, MoreVertical, DollarSign, Percent, Package, ArrowRight } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { CartesianGrid, Line, LineChart, Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { format, parseISO } from "date-fns";

import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";

// unit_cost → landed_cost fallback cache (Revenue Loss parity with the
// planner). Kicked at module load; the card pipelines apply it per-row.
void primeLandedCostCache(supabase);
import { Link } from "react-router-dom";
import { ProductImage } from "@/components/shared/ProductImage";
import { recomputeForecastRow, toNumberSafe, primeLandedCostCache, applyLandedCostFallback } from "@/lib/forecast/recomputeForecastRow";
import {
  computeEffectiveTier,
  computeIdpRowMetrics,
  buildActionBadgeContent,
  ACTION_TIER,
  type ActionBadgeContent,
} from "@/lib/forecast/idpMetrics";

/* =============================
   Helpers
============================= */

function formatFullCurrency(value: number) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "$0";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function money2(value: number) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatGrowth(value: number): { text: string; color: string } {
  const rounded = Math.round(value * 10) / 10;
  if (rounded > 0) return { text: `↑ +${rounded}%`, color: "text-green-600 dark:text-green-400" };
  if (rounded < 0) return { text: `↓ ${rounded}%`, color: "text-destructive" };
  return { text: "— 0%", color: "text-muted-foreground" };
}

/**
 * ✅ Universal Date Parser
 */
function parseDashboardDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  if (s.includes("T")) {
    try {
      const dt = parseISO(s);
      return Number.isFinite(dt.getTime()) ? dt : null;
    } catch {}
  }

  if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(:\d{2})?/.test(s)) {
    const isoLike = s.replace(" ", "T");
    try {
      const dt = parseISO(isoLike);
      return Number.isFinite(dt.getTime()) ? dt : null;
    } catch {}
  }

  const dt = new Date(s);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function formatDashboardDate(value: string | null | undefined) {
  const dt = parseDashboardDate(value);
  if (!dt) return "—";
  return format(dt, "MMMM d, yyyy h:mm a");
}

function toDashboardTime(value: string | null | undefined) {
  const dt = parseDashboardDate(value);
  return dt ? dt.getTime() : 0;
}

/**
 * Tooltip (supports "Grand Total: $X")
 */
function ChartTooltip({ active, payload, label, valueFormatter, labelFormatter }: any) {
  if (!active || !payload?.length) return null;

  const raw = payload[0]?.value;

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <div className="text-xs text-muted-foreground">{labelFormatter ? labelFormatter(label) : String(label)}</div>
      <div className="mt-1 font-semibold text-foreground">
        {valueFormatter ? valueFormatter(raw, payload[0]?.payload) : String(raw)}
      </div>
    </div>
  );
}

/**
 * ✅ Dot/pointer renderer:
 * - show dot ONLY if __hasData === true
 * - keeps line continuous (connectNulls stays true)
 */
function DataDot(props: any) {
  const { cx, cy, payload } = props;
  if (!payload?.__hasData) return null;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;

  return <circle cx={cx} cy={cy} r={4} stroke="white" strokeWidth={2} fill="white" opacity={0.95} />;
}

/* =============================
   Status Badge
============================= */

function StatusBadge({ status }: { status?: string | null }) {
  const s = (status ?? "").toLowerCase();
  let classes = "px-2.5 py-1 text-xs font-semibold rounded-full inline-block transition-all duration-200 hover:scale-105";

  if (
    s.includes("ready") ||
    s.includes("completed") ||
    s.includes("shipped") ||
    s.includes("confirmed") ||
    s.includes("open")
  ) {
    classes += " bg-[#74bfbf]/20 text-[#6B7F63] dark:bg-[#74bfbf]/30 dark:text-[#74bfbf] border border-[#74bfbf]/40";
  } else if (s.includes("pending") || s.includes("processing")) {
    classes += " bg-[#C4A68A]/20 text-[#8B6F47] dark:bg-[#C4A68A]/30 dark:text-[#C4A68A] border border-[#C4A68A]/40";
  } else if (s.includes("cancel") || s.includes("error") || s.includes("failed") || s.includes("not received")) {
    classes += " bg-[#3b5769]/20 text-[#6B5642] dark:bg-[#3b5769]/30 dark:text-[#A89080] border border-[#3b5769]/40";
  } else {
    classes += " bg-[#5D5A52]/20 text-[#3D3A32] dark:bg-[#5D5A52]/30 dark:text-[#7A7568] border border-[#5D5A52]/40";
  }

  return <span className={classes}>{status ?? "Unknown"}</span>;
}

/* =============================
   "+1" parser
============================= */

function splitProductWithPlus(v: unknown): { base: string; plus: number | null } {
  const s = String(v ?? "").trim();
  if (!s) return { base: "—", plus: null };
  const m = s.match(/^(.*?)(?:\s*\+\s*(\d+))\s*$/);
  if (!m) return { base: s, plus: null };
  const base = (m[1] ?? "").trim() || s;
  const plus = Number(m[2]);
  return { base, plus: Number.isFinite(plus) ? plus : null };
}

/* =============================
   Animated KPI value
============================= */

function AnimatedKpiValue({
  target,
  format,
  durationMs = 1500,
}: {
  target: number;
  format: (n: number) => string;
  durationMs?: number;
}) {
  const v = useCountUp(target, durationMs);
  return <>{format(v)}</>;
}

/* =============================
   Skeleton table rows
============================= */

function SkeletonRows({ rows = 5, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-border/60">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="py-2 pr-3">
              <Skeleton className="h-3.5 w-full max-w-[120px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* =============================
   Card Shell
============================= */

function DataCardShell({
  title,
  onRefresh,
  refreshing,
  children,
  footerHref,
  delayMs = 0,
  gradientFrom,
  gradientTo,
  childrenClassName = "p-4",
}: {
  title: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: React.ReactNode;
  footerHref: string;
  delayMs?: number;
  gradientFrom?: string;
  gradientTo?: string;
  childrenClassName?: string;
}) {
  const headerClasses = gradientFrom && gradientTo
    ? `flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r ${gradientFrom} ${gradientTo} animate-gradient`
    : "flex items-center justify-between px-4 py-3 bg-muted/40 border-b border-border";

  const buttonClasses = gradientFrom && gradientTo
    ? "h-9 w-9 inline-flex items-center justify-center rounded-md border border-white/30 bg-white/10 hover:bg-white/20 disabled:opacity-50 transition-colors duration-150 text-white"
    : "h-9 w-9 inline-flex items-center justify-center rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 transition-colors duration-150";

  return (
    <Card
      className="border-border shadow-sm overflow-hidden transition-shadow duration-200 hover:shadow-md motion-safe:animate-stagger-in flex flex-col h-full"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className={headerClasses + " shrink-0"}>
        <div className="text-sm font-semibold tracking-wide uppercase text-white">{title}</div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={!onRefresh || !!refreshing}
          className={buttonClasses}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <CardContent className="p-0 flex flex-col flex-1 min-h-0">
        <div className={cn(childrenClassName, "flex-1 min-h-0 overflow-auto")}>{children}</div>

        <div className="px-4 pb-4 shrink-0">
          <Link
            to={footerHref}
            className="group inline-flex items-center gap-1 text-xs font-medium text-[#3b5769] hover:text-[#6B5642] transition-colors duration-200"
          >
            <span className="relative">
              See more
              <span className="absolute inset-x-0 -bottom-0.5 h-px w-0 bg-[#3b5769] transition-all duration-200 group-hover:w-full" />
            </span>
            <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/* =============================
   INVENTORY ARRIVALS
============================= */

// Mirrors the Reorder Decisions row shape. Numbers + Urgent tier +
// Action badge all come from the planner's own helpers (idpMetrics) so the
// dashboard preview always matches what the planner shows.
type UrgentPlannerRow = {
  sku: string;
  product_name: string;
  image_url: string | null;
  factory: string | null;
  ninety_day_projection: number;
  ninety_day_supply: number;
  ninety_day_deficit: number;
  ninety_day_revenue_loss: number;
  safety_stock: number;
  order_recommended: number;
  lead_time: number | null;
  order_date_forecast: string | null;
  badge: ActionBadgeContent;
};

function fmtInt(v: unknown) {
  const n = toNumberSafe(v);
  if (n == null) return "—";
  return Math.round(n).toLocaleString();
}
function fmtSignedInt(v: unknown) {
  const n = toNumberSafe(v);
  if (n == null) return "—";
  const r = Math.round(n);
  return (r > 0 ? "+" : "") + r.toLocaleString();
}
function fmtMoney(v: unknown) {
  const n = toNumberSafe(v);
  if (n == null || n === 0) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function InventoryArrivalsCard({ delayMs = 0, onCountChange }: { delayMs?: number; onCountChange?: (n: number) => void }) {
  const { restricted: factoryRestricted, assignedCountry, factoryLevel, allowedFactoryShortNames } = useFactoryAccess();
  const [rows, setRows] = useState<UrgentPlannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [urgentCount, setUrgentCount] = useState<number>(0);
  const retryCount = useRef(0);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    const t0 = performance.now();
    try {
      mode === "initial" ? setLoading(true) : setRefreshing(true);
      setErr(null);

      // Fetch forecast_report + side tables (mirrors sendEmailReport pipeline).
      const PAGE = 1000;
      let offset = 0;
      let base: Record<string, unknown>[] = [];
      while (true) {
        let qb = (supabase as any)
          .from("forecast_report")
          .select("*")
          .order("sku", { ascending: true });
        if (factoryLevel && allowedFactoryShortNames?.length) qb = qb.in("factory", allowedFactoryShortNames);
        else if (factoryRestricted && assignedCountry) qb = qb.ilike("country", assignedCountry);
        const { data, error } = await qb.range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        base = base.concat(data);
        if (data.length < PAGE) break;
        offset += PAGE;
      }

      const [manualRes, statusRes, projRes, supplyRes, leadTimeRes, monthlySaleRes, imageRes] = await Promise.all([
        (supabase as any)
          .from("forecast_report_manual")
          .select("sku,order_proposal_qty,buyer_notes,planner_notes,analyst_notes,monthly_projection,forecast_option")
          .limit(10000),
        (supabase as any)
          .from("forecast_report_status")
          .select("sku,factory,status,kit,category")
          .limit(10000),
        (supabase as any).from("forecast_report_proj_override").select("*").limit(10000),
        (supabase as any).from("forecast_report_supply_override").select("*").limit(10000),
        (supabase as any)
          .from("forecast_report")
          .select("sku,lead_time,buyer,inventory_analyst,country")
          .limit(10000),
        (supabase as any).from("monthly_sale_view_auto").select("*").limit(10000),
        (supabase as any)
          .from("shopify_variant_mapping")
          .select("sku,image_url_1")
          .limit(10000)
          .then((r: any) => r.error ? { data: [], error: null } : r),
      ]);

      const imageMap = new Map<string, string | null>();
      for (const r of imageRes.data || []) {
        const s = String((r as any).sku ?? "");
        if (s) imageMap.set(s, (r as any).image_url_1 ?? null);
      }

      const manualMap = new Map<string, any>();
      for (const r of manualRes.data || []) manualMap.set(String((r as any).sku), r);
      const statusMap = new Map<string, any>();
      for (const r of statusRes.data || []) statusMap.set(String((r as any).sku), r);
      const projMap = new Map<string, any>();
      for (const r of projRes.data || []) projMap.set(String((r as any).sku ?? ""), r);
      const supplyMap = new Map<string, any>();
      for (const r of supplyRes.data || []) supplyMap.set(String((r as any).sku ?? ""), r);
      const leadMap = new Map<string, any>();
      for (const r of leadTimeRes.data || []) leadMap.set(String((r as any).sku), r);
      const monthlySaleMap = new Map<string, Record<string, unknown>>();
      for (const r of monthlySaleRes.data || []) {
        const pid = String((r as any).product_id ?? "");
        if (pid) monthlySaleMap.set(pid, r as any);
        const sku = String((r as any).sku ?? "");
        if (sku && sku !== pid) monthlySaleMap.set(sku, r as any);
      }

      // Merge + recompute (kit/category/pu_status NOT overridden — per
      // earlier policy change. factory/status still overridable.)
      const merged = base.map((row) => {
        const sku = String((row as any).sku ?? "");
        const manual = manualMap.get(sku);
        const statusOvr = statusMap.get(sku);
        const projOvr = projMap.get(sku);
        const supplyOvr = supplyMap.get(sku);
        const leadRow = leadMap.get(sku);
        let m: Record<string, unknown> = { ...row };
        if (manual) {
          (m as any).order_proposal_qty = manual.order_proposal_qty ?? (row as any).order_proposal_qty;
          (m as any).monthly_projection = manual.monthly_projection ?? (row as any).monthly_projection;
        }
        if (statusOvr) {
          if ((statusOvr as any).factory != null) (m as any).factory = (statusOvr as any).factory;
          if ((statusOvr as any).status != null) (m as any).status = (statusOvr as any).status;
        }
        if (leadRow) {
          (m as any).lead_time = (leadRow as any).lead_time;
        }
        applyLandedCostFallback(m); // Revenue Loss parity with the planner
        const rawOpt = manual?.forecast_option ?? 0;
        const optionNum = Math.min(4, Math.max(0, Number.isFinite(Number(rawOpt)) ? Number(rawOpt) : 1));
        const drivingChanged = manual?.monthly_projection != null;
        m = recomputeForecastRow(m, monthlySaleMap, drivingChanged, projOvr ?? null, supplyOvr ?? null, optionNum);
        return m;
      });

      // Filter Urgent using the planner's canonical tier helper (same as the
      // planner's Action=Urgent dropdown). Count matches the planner badge.
      const urgent = merged.filter((m) => computeEffectiveTier(m) === ACTION_TIER.URGENT);
      setUrgentCount(urgent.length);
      onCountChange?.(urgent.length);

      // Highest revenue loss first — "most urgent" first.
      urgent.sort((a, b) => (toNumberSafe((b as any).ninety_day_revenue_loss) ?? 0) - (toNumberSafe((a as any).ninety_day_revenue_loss) ?? 0));

      const top: UrgentPlannerRow[] = urgent.slice(0, 5).map((m) => {
        const metrics = computeIdpRowMetrics(m);
        const lead = toNumberSafe((m as any).lead_time);
        const badge = buildActionBadgeContent({
          effectiveTier: ACTION_TIER.URGENT,
          daysOfSupply: metrics.daysOfSupply,
          daysUntilMustOrder: metrics.daysUntilMustOrder,
          daysWithoutStock: metrics.daysWithoutStock,
          leadTime: lead,
        });
        const sku = String((m as any).sku ?? "");
        return {
          sku,
          product_name: String((m as any).product_name ?? (m as any).description ?? "—"),
          image_url: imageMap.get(sku) ?? null,
          factory: ((m as any).factory ?? null) as string | null,
          ninety_day_projection: toNumberSafe((m as any).ninety_day_projection) ?? 0,
          ninety_day_supply: toNumberSafe((m as any).ninety_day_supply) ?? 0,
          ninety_day_deficit: toNumberSafe((m as any).ninety_day_deficit) ?? 0,
          ninety_day_revenue_loss: toNumberSafe((m as any).ninety_day_revenue_loss) ?? 0,
          safety_stock: toNumberSafe((m as any).safety_stock) ?? 0,
          order_recommended: toNumberSafe((m as any).order_recommended) ?? 0,
          lead_time: lead,
          order_date_forecast: ((m as any).order_date_forecast ?? null) as string | null,
          badge,
        };
      });

      retryCount.current = 0;
      setRows(top);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load urgent planner items.";
      if (retryCount.current < 1 && (msg.includes("timeout") || msg.includes("upstream"))) {
        retryCount.current++;
        setTimeout(() => load(mode), 2000);
        return;
      }
      setErr("Data temporarily unavailable. Click refresh to retry.");
      setRows([]);
    } finally {
      mode === "initial" ? setLoading(false) : setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const delay = setTimeout(() => load("initial"), 0);
    return () => clearTimeout(delay);
  }, [load]);

  return (
    <DataCardShell
      title={urgentCount > 0 ? `Demand Planner (${urgentCount} urgent)` : "Demand Planner"}
      footerHref="/inventory-planner?action=Urgent"
      onRefresh={() => load("refresh")}
      refreshing={refreshing}
      delayMs={delayMs}
      gradientFrom="from-[#3b5769]"
      gradientTo="to-[#A89080]"
      childrenClassName=""
    >
      {err && (
        <div className="m-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">
          {err}
        </div>
      )}

      <div className="w-full min-w-max">
        <style>{`
          /* Mirrors the planner's .idp-compact-table — tight padding, 11px font,
             but with cell borders + lavender header so the dashboard preview
             reads like the planner. */
          .idp-preview-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            background: #ffffff;
          }
          .idp-preview-table th,
          .idp-preview-table td {
            padding: 4px 6px;
            border: 1px solid #D1D5DB;
            white-space: nowrap;
            vertical-align: middle;
            text-align: center;
          }
          .idp-preview-table thead th {
            background: #E0E3F5;
            color: #111827;
            font-size: 10px;
            font-weight: 700;
            text-align: center;
            line-height: 1.3;
            white-space: pre-line;
            text-transform: none;
            letter-spacing: 0;
            position: sticky;
            top: 0;
            z-index: 10;
          }
          .idp-preview-table tbody tr:nth-child(even) td { background: #F8FAFC; }
          .idp-preview-table tbody tr:hover td { background: rgba(139, 115, 85, 0.10); }
          .idp-preview-table td.num { text-align: center; font-variant-numeric: tabular-nums; }
          .idp-preview-table td.center { text-align: center; }
          .idp-preview-table td.neg { color: #b91c1c; font-weight: 600; }
          .dark .idp-preview-table { background: hsl(var(--background)); }
          .dark .idp-preview-table th,
          .dark .idp-preview-table td { border-color: hsl(var(--border)); }
          .dark .idp-preview-table thead th {
            background: hsl(var(--muted));
            color: hsl(var(--foreground));
          }
          .dark .idp-preview-table tbody tr:nth-child(even) td { background: hsl(var(--muted) / 0.3); }
        `}</style>
        <table className="idp-preview-table">
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Product ID</th>
              <th>Factory</th>
              <th>{"90-Day\nProjection"}</th>
              <th>{"90-Day\nSupply"}</th>
              <th>{"90-Day\nDeficit"}</th>
              <th>{"90-Day\nRevenue Loss"}</th>
              <th>{"Safety\nStock"}</th>
              <th>{"Order\nRecommended"}</th>
              <th>{"Lead\nTime"}</th>
              <th>{"Order\nDate"}</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <SkeletonRows rows={5} cols={12} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-5 text-center text-muted-foreground">
                  No urgent items.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr
                  key={r.sku}
                  className="motion-safe:animate-stagger-in"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <td title={r.product_name} style={{ maxWidth: 280, textAlign: "left" }}>
                    {(() => {
                      const descRaw = r.product_name;
                      let mainName = descRaw;
                      let variant = "";
                      const mIn = descRaw.match(/^(.*?)\s+in\s+(.*)$/i);
                      const mDash = descRaw.match(/^(.*?)\s+-\s+(.*)$/);
                      if (mIn) { mainName = mIn[1].trim(); variant = mIn[2].trim(); }
                      else if (mDash) { mainName = mDash[1].trim(); variant = mDash[2].trim(); }
                      return (
                        <div className="flex items-center gap-2 min-w-0">
                          <ProductImage
                            productId={r.sku}
                            productName={r.product_name}
                            thumbSize={36}
                            readOnly
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold truncate" style={{ fontSize: 11 }}>{mainName}</div>
                            {variant && <div className="text-muted-foreground truncate" style={{ fontSize: 10 }}>{variant}</div>}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="font-mono">{r.sku}</td>
                  <td>{r.factory ?? "—"}</td>
                  <td className="num">{fmtInt(r.ninety_day_projection)}</td>
                  <td className="num">{fmtInt(r.ninety_day_supply)}</td>
                  <td className={`num ${r.ninety_day_deficit < 0 ? "neg" : ""}`}>{fmtSignedInt(r.ninety_day_deficit)}</td>
                  <td className="num neg">{fmtMoney(r.ninety_day_revenue_loss)}</td>
                  <td className="num">{fmtInt(r.safety_stock)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmtInt(r.order_recommended)}</td>
                  <td className="num">{r.lead_time != null ? `${Math.round(r.lead_time)}` : "—"}</td>
                  <td>{r.order_date_forecast ? formatDashboardDate(r.order_date_forecast) : "—"}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                        style={{ background: r.badge.bg, color: r.badge.color }}
                      >
                        {r.badge.text}
                      </span>
                      {r.badge.subtitle && (
                        <span className="text-[10px] text-muted-foreground whitespace-normal max-w-[260px] text-center">
                          {r.badge.subtitle}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </DataCardShell>
  );
}

/* =============================
   INVENTORY KPI STRIP
============================= */

const KPI_TIERS = [
  { key: "urgent",   label: "Urgent",         color: "#C0392B", icon: "🚨" },
  { key: "order30",  label: "Order Within 20 Days", color: "#D35400", icon: "📦" },
  { key: "order60",  label: "Order Within 45 Days", color: "#B7950B", icon: "🕐" },
  { key: "order90",  label: "Order Within 75 Days", color: "#1E8449", icon: "📅" },
] as const;

function InventoryKpiStrip({ urgentCount, order30Count, order60Count, order90Count }: {
  urgentCount: number; order30Count: number; order60Count: number; order90Count: number;
}) {
  const counts = { urgent: urgentCount, order30: order30Count, order60: order60Count, order90: order90Count };
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      {KPI_TIERS.map((tier) => (
        <div
          key={tier.key}
          className="rounded-xl border border-border bg-card overflow-hidden"
          style={{ borderLeft: `4px solid ${tier.color}` }}
        >
          <div className="px-5 py-4 flex items-center gap-4">
            <div
              className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg"
              style={{ background: `${tier.color}18` }}
            >
              <span>{tier.icon}</span>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground leading-none mb-1">
                {tier.label}
              </p>
              <p className="text-2xl font-bold leading-none" style={{ color: tier.color }}>
                {counts[tier.key].toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* =============================
   SHARED: Planner Mini Table
============================= */

function PlannerMiniTable({ rows, loading, emptyText = "No items." }: { rows: UrgentPlannerRow[]; loading: boolean; emptyText?: string }) {
  return (
    <div className="w-full min-w-max">
      <style>{`
        .idp-po-table { width: 100%; border-collapse: collapse; font-size: 11px; background: #ffffff; }
        .idp-po-table th, .idp-po-table td { padding: 4px 6px; border: 1px solid #D1D5DB; white-space: nowrap; vertical-align: middle; text-align: center; }
        .idp-po-table thead th { background: #E0E3F5; color: #111827; font-size: 10px; font-weight: 700; line-height: 1.3; white-space: pre-line; position: sticky; top: 0; z-index: 10; }
        .idp-po-table tbody tr:nth-child(even) td { background: #F8FAFC; }
        .idp-po-table tbody tr:hover td { background: rgba(93,90,82,0.10); }
        .idp-po-table td.num { text-align: center; font-variant-numeric: tabular-nums; }
        .idp-po-table td.neg { color: #b91c1c; font-weight: 600; }
        .dark .idp-po-table { background: hsl(var(--background)); }
        .dark .idp-po-table th, .dark .idp-po-table td { border-color: hsl(var(--border)); }
        .dark .idp-po-table thead th { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
        .dark .idp-po-table tbody tr:nth-child(even) td { background: hsl(var(--muted) / 0.3); }
      `}</style>
      <table className="idp-po-table">
        <thead>
          <tr>
            <th>Product Name</th>
            <th>Product ID</th>
            <th>Factory</th>
            <th>{"90-Day\nProjection"}</th>
            <th>{"90-Day\nSupply"}</th>
            <th>{"90-Day\nDeficit"}</th>
            <th>{"90-Day\nRevenue Loss"}</th>
            <th>{"Safety\nStock"}</th>
            <th>{"Order\nRecommended"}</th>
            <th>{"Lead\nTime"}</th>
            <th>{"Order\nDate"}</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={5} cols={12} />
          ) : rows.length === 0 ? (
            <tr><td colSpan={12} className="py-5 text-center text-muted-foreground">{emptyText}</td></tr>
          ) : (
            rows.map((r, i) => (
              <tr key={r.sku} className="motion-safe:animate-stagger-in" style={{ animationDelay: `${i * 50}ms` }}>
                <td title={r.product_name} style={{ maxWidth: 280, textAlign: "left" }}>
                  {(() => {
                    const descRaw = r.product_name;
                    let mainName = descRaw; let variant = "";
                    const mIn = descRaw.match(/^(.*?)\s+in\s+(.*)$/i);
                    const mDash = descRaw.match(/^(.*?)\s+-\s+(.*)$/);
                    if (mIn) { mainName = mIn[1].trim(); variant = mIn[2].trim(); }
                    else if (mDash) { mainName = mDash[1].trim(); variant = mDash[2].trim(); }
                    return (
                      <div className="flex items-center gap-2 min-w-0">
                        <ProductImage productId={r.sku} productName={r.product_name} thumbSize={36} readOnly />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold truncate" style={{ fontSize: 11 }}>{mainName}</div>
                          {variant && <div className="text-muted-foreground truncate" style={{ fontSize: 10 }}>{variant}</div>}
                        </div>
                      </div>
                    );
                  })()}
                </td>
                <td className="font-mono">{r.sku}</td>
                <td>{r.factory ?? "—"}</td>
                <td className="num">{fmtInt(r.ninety_day_projection)}</td>
                <td className="num">{fmtInt(r.ninety_day_supply)}</td>
                <td className={`num ${r.ninety_day_deficit < 0 ? "neg" : ""}`}>{fmtSignedInt(r.ninety_day_deficit)}</td>
                <td className="num neg">{fmtMoney(r.ninety_day_revenue_loss)}</td>
                <td className="num">{fmtInt(r.safety_stock)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{fmtInt(r.order_recommended)}</td>
                <td className="num">{r.lead_time != null ? `${Math.round(r.lead_time)}` : "—"}</td>
                <td>{r.order_date_forecast ? formatDashboardDate(r.order_date_forecast) : "—"}</td>
                <td style={{ whiteSpace: "normal" }}>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap" style={{ background: r.badge.bg, color: r.badge.color }}>
                      {r.badge.text}
                    </span>
                    {r.badge.subtitle && (
                      <span className="text-[10px] text-muted-foreground whitespace-normal max-w-[260px] text-center">{r.badge.subtitle}</span>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* =============================
   PURCHASE ORDERS  (Order Within 20 Days from planner)
============================= */

function PurchaseOrdersCard({ delayMs = 0, onCountChange }: { delayMs?: number; onCountChange?: (n: number) => void }) {
  const { restricted: factoryRestricted, assignedCountry, factoryLevel, allowedFactoryShortNames } = useFactoryAccess();
  const [rows, setRows] = useState<UrgentPlannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [order30Count, setOrder30Count] = useState<number>(0);
  const retryCount = useRef(0);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    const t0 = performance.now();
    try {
      mode === "initial" ? setLoading(true) : setRefreshing(true);
      setErr(null);

      const PAGE = 1000;
      let offset = 0;
      let base: Record<string, unknown>[] = [];
      while (true) {
        let qb = (supabase as any)
          .from("forecast_report")
          .select("*")
          .order("sku", { ascending: true });
        if (factoryLevel && allowedFactoryShortNames?.length) qb = qb.in("factory", allowedFactoryShortNames);
        else if (factoryRestricted && assignedCountry) qb = qb.ilike("country", assignedCountry);
        const { data, error } = await qb.range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        base = base.concat(data);
        if (data.length < PAGE) break;
        offset += PAGE;
      }

      const [manualRes, statusRes, projRes, supplyRes, leadTimeRes, monthlySaleRes] = await Promise.all([
        (supabase as any).from("forecast_report_manual").select("sku,order_proposal_qty,buyer_notes,planner_notes,analyst_notes,monthly_projection,forecast_option").limit(10000),
        (supabase as any).from("forecast_report_status").select("sku,factory,status,kit,category").limit(10000),
        (supabase as any).from("forecast_report_proj_override").select("*").limit(10000),
        (supabase as any).from("forecast_report_supply_override").select("*").limit(10000),
        (supabase as any).from("forecast_report").select("sku,lead_time,buyer,inventory_analyst,country").limit(10000),
        (supabase as any).from("monthly_sale_view_auto").select("*").limit(10000),
      ]);

      const manualMap = new Map<string, any>();
      for (const r of manualRes.data || []) manualMap.set(String((r as any).sku), r);
      const statusMap = new Map<string, any>();
      for (const r of statusRes.data || []) statusMap.set(String((r as any).sku), r);
      const projMap = new Map<string, any>();
      for (const r of projRes.data || []) projMap.set(String((r as any).sku ?? ""), r);
      const supplyMap = new Map<string, any>();
      for (const r of supplyRes.data || []) supplyMap.set(String((r as any).sku ?? ""), r);
      const leadMap = new Map<string, any>();
      for (const r of leadTimeRes.data || []) leadMap.set(String((r as any).sku), r);
      const monthlySaleMap = new Map<string, Record<string, unknown>>();
      for (const r of monthlySaleRes.data || []) {
        const pid = String((r as any).product_id ?? "");
        if (pid) monthlySaleMap.set(pid, r as any);
        const sku = String((r as any).sku ?? "");
        if (sku && sku !== pid) monthlySaleMap.set(sku, r as any);
      }

      const merged = base.map((row) => {
        const sku = String((row as any).sku ?? "");
        const manual = manualMap.get(sku);
        const statusOvr = statusMap.get(sku);
        const projOvr = projMap.get(sku);
        const supplyOvr = supplyMap.get(sku);
        const leadRow = leadMap.get(sku);
        let m: Record<string, unknown> = { ...row };
        if (manual) {
          (m as any).order_proposal_qty = manual.order_proposal_qty ?? (row as any).order_proposal_qty;
          (m as any).monthly_projection = manual.monthly_projection ?? (row as any).monthly_projection;
        }
        if (statusOvr) {
          if ((statusOvr as any).factory != null) (m as any).factory = (statusOvr as any).factory;
          if ((statusOvr as any).status != null) (m as any).status = (statusOvr as any).status;
        }
        if (leadRow) (m as any).lead_time = (leadRow as any).lead_time;
        applyLandedCostFallback(m); // Revenue Loss parity with the planner
        const rawOpt = manual?.forecast_option ?? 0;
        const optionNum = Math.min(4, Math.max(0, Number.isFinite(Number(rawOpt)) ? Number(rawOpt) : 1));
        const drivingChanged = manual?.monthly_projection != null;
        m = recomputeForecastRow(m, monthlySaleMap, drivingChanged, projOvr ?? null, supplyOvr ?? null, optionNum);
        return m;
      });

      const order30 = merged.filter((m) => computeEffectiveTier(m) === ACTION_TIER.ORDER_30);
      setOrder30Count(order30.length);
      onCountChange?.(order30.length);
      order30.sort((a, b) => {
        const da = computeIdpRowMetrics(a).daysUntilMustOrder ?? 999;
        const db = computeIdpRowMetrics(b).daysUntilMustOrder ?? 999;
        if (da !== db) return da - db;
        return (toNumberSafe((b as any).ninety_day_revenue_loss) ?? 0) - (toNumberSafe((a as any).ninety_day_revenue_loss) ?? 0);
      });

      const top: UrgentPlannerRow[] = order30.slice(0, 5).map((m) => {
        const metrics = computeIdpRowMetrics(m);
        const lead = toNumberSafe((m as any).lead_time);
        const badge = buildActionBadgeContent({
          effectiveTier: ACTION_TIER.ORDER_30,
          daysOfSupply: metrics.daysOfSupply,
          daysUntilMustOrder: metrics.daysUntilMustOrder,
          daysWithoutStock: metrics.daysWithoutStock,
          leadTime: lead,
        });
        const sku = String((m as any).sku ?? "");
        return {
          sku,
          product_name: String((m as any).product_name ?? (m as any).description ?? "—"),
          image_url: null,
          factory: ((m as any).factory ?? null) as string | null,
          ninety_day_projection: toNumberSafe((m as any).ninety_day_projection) ?? 0,
          ninety_day_supply: toNumberSafe((m as any).ninety_day_supply) ?? 0,
          ninety_day_deficit: toNumberSafe((m as any).ninety_day_deficit) ?? 0,
          ninety_day_revenue_loss: toNumberSafe((m as any).ninety_day_revenue_loss) ?? 0,
          safety_stock: toNumberSafe((m as any).safety_stock) ?? 0,
          order_recommended: toNumberSafe((m as any).order_recommended) ?? 0,
          lead_time: lead,
          order_date_forecast: ((m as any).order_date_forecast ?? null) as string | null,
          badge,
        };
      });

      retryCount.current = 0;
      setRows(top);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load order data.";
      if (retryCount.current < 1 && (msg.includes("timeout") || msg.includes("upstream"))) {
        retryCount.current++;
        setTimeout(() => load(mode), 2000);
        return;
      }
      setErr("Data temporarily unavailable. Click refresh to retry.");
      setRows([]);
    } finally {
      mode === "initial" ? setLoading(false) : setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const delay = setTimeout(() => load("initial"), 300);
    return () => clearTimeout(delay);
  }, [load]);

  return (
    <DataCardShell
      title={order30Count > 0 ? `Demand Planner (${order30Count}) Order Within 20 Days` : "Demand Planner Order Within 20 Days"}
      footerHref="/inventory-planner?action=Order+Within+20+Days"
      onRefresh={() => load("refresh")}
      refreshing={refreshing}
      delayMs={delayMs}
      gradientFrom="from-[#5D5A52]"
      gradientTo="to-[#7A7568]"
      childrenClassName=""
    >
      {err && <div className="m-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">{err}</div>}
      <PlannerMiniTable rows={rows} loading={loading} emptyText="No items due ≤ 30 days." />
    </DataCardShell>
  );
}

/* =============================
   ORDER WITHIN 45 DAYS
============================= */

function Order60Card({ delayMs = 0, onCountChange }: { delayMs?: number; onCountChange?: (n: number) => void }) {
  const { restricted: factoryRestricted, assignedCountry, factoryLevel, allowedFactoryShortNames } = useFactoryAccess();
  const [rows, setRows] = useState<UrgentPlannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState<number>(0);
  const retryCount = useRef(0);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    const t0 = performance.now();
    try {
      mode === "initial" ? setLoading(true) : setRefreshing(true);
      setErr(null);

      const PAGE = 1000;
      let offset = 0;
      let base: Record<string, unknown>[] = [];
      while (true) {
        let qb = (supabase as any).from("forecast_report").select("*").order("sku", { ascending: true });
        if (factoryLevel && allowedFactoryShortNames?.length) qb = qb.in("factory", allowedFactoryShortNames);
        else if (factoryRestricted && assignedCountry) qb = qb.ilike("country", assignedCountry);
        const { data, error } = await qb.range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        base = base.concat(data);
        if (data.length < PAGE) break;
        offset += PAGE;
      }

      const [manualRes, statusRes, projRes, supplyRes, leadTimeRes, monthlySaleRes] = await Promise.all([
        (supabase as any).from("forecast_report_manual").select("sku,order_proposal_qty,buyer_notes,planner_notes,analyst_notes,monthly_projection,forecast_option").limit(10000),
        (supabase as any).from("forecast_report_status").select("sku,factory,status,kit,category").limit(10000),
        (supabase as any).from("forecast_report_proj_override").select("*").limit(10000),
        (supabase as any).from("forecast_report_supply_override").select("*").limit(10000),
        (supabase as any).from("forecast_report").select("sku,lead_time,buyer,inventory_analyst,country").limit(10000),
        (supabase as any).from("monthly_sale_view_auto").select("*").limit(10000),
      ]);

      const manualMap = new Map<string, any>(); for (const r of manualRes.data || []) manualMap.set(String((r as any).sku), r);
      const statusMap = new Map<string, any>(); for (const r of statusRes.data || []) statusMap.set(String((r as any).sku), r);
      const projMap = new Map<string, any>(); for (const r of projRes.data || []) projMap.set(String((r as any).sku ?? ""), r);
      const supplyMap = new Map<string, any>(); for (const r of supplyRes.data || []) supplyMap.set(String((r as any).sku ?? ""), r);
      const leadMap = new Map<string, any>(); for (const r of leadTimeRes.data || []) leadMap.set(String((r as any).sku), r);
      const monthlySaleMap = new Map<string, Record<string, unknown>>();
      for (const r of monthlySaleRes.data || []) {
        const pid = String((r as any).product_id ?? ""); if (pid) monthlySaleMap.set(pid, r as any);
        const sku = String((r as any).sku ?? ""); if (sku && sku !== pid) monthlySaleMap.set(sku, r as any);
      }

      const merged = base.map((row) => {
        const sku = String((row as any).sku ?? "");
        const manual = manualMap.get(sku); const statusOvr = statusMap.get(sku);
        const projOvr = projMap.get(sku); const supplyOvr = supplyMap.get(sku);
        const leadRow = leadMap.get(sku);
        let m: Record<string, unknown> = { ...row };
        if (manual) { (m as any).order_proposal_qty = manual.order_proposal_qty ?? (row as any).order_proposal_qty; (m as any).monthly_projection = manual.monthly_projection ?? (row as any).monthly_projection; }
        if (statusOvr) { if ((statusOvr as any).factory != null) (m as any).factory = (statusOvr as any).factory; if ((statusOvr as any).status != null) (m as any).status = (statusOvr as any).status; }
        if (leadRow) (m as any).lead_time = (leadRow as any).lead_time;
        applyLandedCostFallback(m); // Revenue Loss parity with the planner
        const rawOpt = manual?.forecast_option ?? 0;
        const optionNum = Math.min(4, Math.max(0, Number.isFinite(Number(rawOpt)) ? Number(rawOpt) : 1));
        m = recomputeForecastRow(m, monthlySaleMap, manual?.monthly_projection != null, projOvr ?? null, supplyOvr ?? null, optionNum);
        return m;
      });

      const filtered = merged.filter((m) => computeEffectiveTier(m) === ACTION_TIER.ORDER_60);
      setCount(filtered.length);
      onCountChange?.(filtered.length);
      filtered.sort((a, b) => {
        const da = computeIdpRowMetrics(a).daysUntilMustOrder ?? 999;
        const db = computeIdpRowMetrics(b).daysUntilMustOrder ?? 999;
        if (da !== db) return da - db;
        return (toNumberSafe((b as any).ninety_day_revenue_loss) ?? 0) - (toNumberSafe((a as any).ninety_day_revenue_loss) ?? 0);
      });

      const top: UrgentPlannerRow[] = filtered.slice(0, 5).map((m) => {
        const metrics = computeIdpRowMetrics(m); const lead = toNumberSafe((m as any).lead_time);
        const badge = buildActionBadgeContent({ effectiveTier: ACTION_TIER.ORDER_60, daysOfSupply: metrics.daysOfSupply, daysUntilMustOrder: metrics.daysUntilMustOrder, daysWithoutStock: metrics.daysWithoutStock, leadTime: lead });
        const sku = String((m as any).sku ?? "");
        return { sku, product_name: String((m as any).product_name ?? (m as any).description ?? "—"), image_url: null, factory: ((m as any).factory ?? null) as string | null, ninety_day_projection: toNumberSafe((m as any).ninety_day_projection) ?? 0, ninety_day_supply: toNumberSafe((m as any).ninety_day_supply) ?? 0, ninety_day_deficit: toNumberSafe((m as any).ninety_day_deficit) ?? 0, ninety_day_revenue_loss: toNumberSafe((m as any).ninety_day_revenue_loss) ?? 0, safety_stock: toNumberSafe((m as any).safety_stock) ?? 0, order_recommended: toNumberSafe((m as any).order_recommended) ?? 0, lead_time: lead, order_date_forecast: ((m as any).order_date_forecast ?? null) as string | null, badge };
      });

      retryCount.current = 0; setRows(top);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load order data.";
      if (retryCount.current < 1 && (msg.includes("timeout") || msg.includes("upstream"))) { retryCount.current++; setTimeout(() => load(mode), 2000); return; }
      setErr("Data temporarily unavailable. Click refresh to retry."); setRows([]);
    } finally { mode === "initial" ? setLoading(false) : setRefreshing(false); }
  }, []);

  useEffect(() => { const delay = setTimeout(() => load("initial"), delayMs + 100); return () => clearTimeout(delay); }, [load]);

  return (
    <DataCardShell
      title={count > 0 ? `Demand Planner (${count}) Order Within 45 Days` : "Demand Planner Order Within 45 Days"}
      footerHref="/inventory-planner?action=Order+Within+45+Days"
      onRefresh={() => load("refresh")} refreshing={refreshing} delayMs={delayMs}
      gradientFrom="from-[#78620A]" gradientTo="to-[#A08820]"
      childrenClassName=""
    >
      {err && <div className="m-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">{err}</div>}
      <PlannerMiniTable rows={rows} loading={loading} emptyText="No items due ≤ 60 days." />
    </DataCardShell>
  );
}

/* =============================
   ORDER WITHIN 75 DAYS
============================= */

function Order90Card({ delayMs = 0, onCountChange }: { delayMs?: number; onCountChange?: (n: number) => void }) {
  const { restricted: factoryRestricted, assignedCountry, factoryLevel, allowedFactoryShortNames } = useFactoryAccess();
  const [rows, setRows] = useState<UrgentPlannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState<number>(0);
  const retryCount = useRef(0);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    const t0 = performance.now();
    try {
      mode === "initial" ? setLoading(true) : setRefreshing(true);
      setErr(null);

      const PAGE = 1000;
      let offset = 0;
      let base: Record<string, unknown>[] = [];
      while (true) {
        let qb = (supabase as any).from("forecast_report").select("*").order("sku", { ascending: true });
        if (factoryLevel && allowedFactoryShortNames?.length) qb = qb.in("factory", allowedFactoryShortNames);
        else if (factoryRestricted && assignedCountry) qb = qb.ilike("country", assignedCountry);
        const { data, error } = await qb.range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        base = base.concat(data);
        if (data.length < PAGE) break;
        offset += PAGE;
      }

      const [manualRes, statusRes, projRes, supplyRes, leadTimeRes, monthlySaleRes] = await Promise.all([
        (supabase as any).from("forecast_report_manual").select("sku,order_proposal_qty,buyer_notes,planner_notes,analyst_notes,monthly_projection,forecast_option").limit(10000),
        (supabase as any).from("forecast_report_status").select("sku,factory,status,kit,category").limit(10000),
        (supabase as any).from("forecast_report_proj_override").select("*").limit(10000),
        (supabase as any).from("forecast_report_supply_override").select("*").limit(10000),
        (supabase as any).from("forecast_report").select("sku,lead_time,buyer,inventory_analyst,country").limit(10000),
        (supabase as any).from("monthly_sale_view_auto").select("*").limit(10000),
      ]);

      const manualMap = new Map<string, any>(); for (const r of manualRes.data || []) manualMap.set(String((r as any).sku), r);
      const statusMap = new Map<string, any>(); for (const r of statusRes.data || []) statusMap.set(String((r as any).sku), r);
      const projMap = new Map<string, any>(); for (const r of projRes.data || []) projMap.set(String((r as any).sku ?? ""), r);
      const supplyMap = new Map<string, any>(); for (const r of supplyRes.data || []) supplyMap.set(String((r as any).sku ?? ""), r);
      const leadMap = new Map<string, any>(); for (const r of leadTimeRes.data || []) leadMap.set(String((r as any).sku), r);
      const monthlySaleMap = new Map<string, Record<string, unknown>>();
      for (const r of monthlySaleRes.data || []) {
        const pid = String((r as any).product_id ?? ""); if (pid) monthlySaleMap.set(pid, r as any);
        const sku = String((r as any).sku ?? ""); if (sku && sku !== pid) monthlySaleMap.set(sku, r as any);
      }

      const merged = base.map((row) => {
        const sku = String((row as any).sku ?? "");
        const manual = manualMap.get(sku); const statusOvr = statusMap.get(sku);
        const projOvr = projMap.get(sku); const supplyOvr = supplyMap.get(sku);
        const leadRow = leadMap.get(sku);
        let m: Record<string, unknown> = { ...row };
        if (manual) { (m as any).order_proposal_qty = manual.order_proposal_qty ?? (row as any).order_proposal_qty; (m as any).monthly_projection = manual.monthly_projection ?? (row as any).monthly_projection; }
        if (statusOvr) { if ((statusOvr as any).factory != null) (m as any).factory = (statusOvr as any).factory; if ((statusOvr as any).status != null) (m as any).status = (statusOvr as any).status; }
        if (leadRow) (m as any).lead_time = (leadRow as any).lead_time;
        applyLandedCostFallback(m); // Revenue Loss parity with the planner
        const rawOpt = manual?.forecast_option ?? 0;
        const optionNum = Math.min(4, Math.max(0, Number.isFinite(Number(rawOpt)) ? Number(rawOpt) : 1));
        m = recomputeForecastRow(m, monthlySaleMap, manual?.monthly_projection != null, projOvr ?? null, supplyOvr ?? null, optionNum);
        return m;
      });

      const filtered = merged.filter((m) => computeEffectiveTier(m) === ACTION_TIER.ORDER_90);
      setCount(filtered.length);
      onCountChange?.(filtered.length);
      filtered.sort((a, b) => {
        const da = computeIdpRowMetrics(a).daysUntilMustOrder ?? 999;
        const db = computeIdpRowMetrics(b).daysUntilMustOrder ?? 999;
        if (da !== db) return da - db;
        return (toNumberSafe((b as any).ninety_day_revenue_loss) ?? 0) - (toNumberSafe((a as any).ninety_day_revenue_loss) ?? 0);
      });

      const top: UrgentPlannerRow[] = filtered.slice(0, 5).map((m) => {
        const metrics = computeIdpRowMetrics(m); const lead = toNumberSafe((m as any).lead_time);
        const badge = buildActionBadgeContent({ effectiveTier: ACTION_TIER.ORDER_90, daysOfSupply: metrics.daysOfSupply, daysUntilMustOrder: metrics.daysUntilMustOrder, daysWithoutStock: metrics.daysWithoutStock, leadTime: lead });
        const sku = String((m as any).sku ?? "");
        return { sku, product_name: String((m as any).product_name ?? (m as any).description ?? "—"), image_url: null, factory: ((m as any).factory ?? null) as string | null, ninety_day_projection: toNumberSafe((m as any).ninety_day_projection) ?? 0, ninety_day_supply: toNumberSafe((m as any).ninety_day_supply) ?? 0, ninety_day_deficit: toNumberSafe((m as any).ninety_day_deficit) ?? 0, ninety_day_revenue_loss: toNumberSafe((m as any).ninety_day_revenue_loss) ?? 0, safety_stock: toNumberSafe((m as any).safety_stock) ?? 0, order_recommended: toNumberSafe((m as any).order_recommended) ?? 0, lead_time: lead, order_date_forecast: ((m as any).order_date_forecast ?? null) as string | null, badge };
      });

      retryCount.current = 0; setRows(top);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load order data.";
      if (retryCount.current < 1 && (msg.includes("timeout") || msg.includes("upstream"))) { retryCount.current++; setTimeout(() => load(mode), 2000); return; }
      setErr("Data temporarily unavailable. Click refresh to retry."); setRows([]);
    } finally { mode === "initial" ? setLoading(false) : setRefreshing(false); }
  }, []);

  useEffect(() => { const delay = setTimeout(() => load("initial"), delayMs + 100); return () => clearTimeout(delay); }, [load]);

  return (
    <DataCardShell
      title={count > 0 ? `Demand Planner (${count}) Order Within 75 Days` : "Demand Planner Order Within 75 Days"}
      footerHref="/inventory-planner?action=Order+Within+75+Days"
      onRefresh={() => load("refresh")} refreshing={refreshing} delayMs={delayMs}
      gradientFrom="from-[#166534]" gradientTo="to-[#22a35e]"
      childrenClassName=""
    >
      {err && <div className="m-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">{err}</div>}
      <PlannerMiniTable rows={rows} loading={loading} emptyText="No items due ≤ 90 days." />
    </DataCardShell>
  );
}

/* =============================
   FORECAST CRITICAL STATUS
============================= */

type ForecastCriticalRow = {
  sku: string | null;
  description: string | null;
  factory: string | null;
  oh_inv: number | null;
  supply_status: string | null;
};

function SupplyStatusBadge({ status }: { status?: string | null }) {
  const s = (status ?? "").trim().toLowerCase();
  let classes = "inline-flex items-center justify-center h-5 px-2.5 rounded-full text-[10px] font-semibold whitespace-nowrap shadow-sm transition-all duration-200 hover:scale-105";
  if (s === "good") classes += " bg-[#74bfbf] text-white border border-[#74bfbf]";
  else if (s === "critical") classes += " bg-[#C4A68A] text-white motion-safe:animate-pulse border border-[#C4A68A]";
  else classes += " bg-[#5D5A52] text-white border border-[#5D5A52]";
  return <span className={classes}>{status ?? "—"}</span>;
}

function ForecastCriticalStatusCard({ delayMs = 0 }: { delayMs?: number }) {
  const { restricted: factoryRestricted, assignedCountry, factoryLevel, allowedFactoryShortNames } = useFactoryAccess();
  const [rows, setRows] = useState<ForecastCriticalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const retryCount = useRef(0);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    const t0 = performance.now();
    try {
      mode === "initial" ? setLoading(true) : setRefreshing(true);
      setErr(null);

      let cq = supabase
        .from("forecast_report")
        .select("sku,description,factory,oh_inv,supply_status")
        .ilike("supply_status", "critical");
      if (factoryLevel && allowedFactoryShortNames?.length) cq = cq.in("factory", allowedFactoryShortNames);
      else if (factoryRestricted && assignedCountry) cq = cq.ilike("country", assignedCountry);
      const { data, error } = await cq
        .order("sku", { ascending: true })
        .limit(5);

      if (error) throw error;

      retryCount.current = 0;
      setRows((data ?? []) as ForecastCriticalRow[]);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load forecast data.";
      if (retryCount.current < 1 && (msg.includes("timeout") || msg.includes("upstream"))) {
        retryCount.current++;
        setTimeout(() => load(mode), 3000);
        return;
      }
      setErr("Data temporarily unavailable. Click refresh to retry.");
      setRows([]);
    } finally {
      mode === "initial" ? setLoading(false) : setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const delay = setTimeout(() => load("initial"), 600);
    return () => clearTimeout(delay);
  }, [load]);

  return (
    <DataCardShell
      title="FORECAST CRITICAL STATUS"
      footerHref="/monthly-forecast?supply_status=Critical"
      onRefresh={() => load("refresh")}
      refreshing={refreshing}
      delayMs={delayMs}
      gradientFrom="from-[#C4A68A]"
      gradientTo="to-[#D4B5A0]"
    >
      {err && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">
          {err}
        </div>
      )}

      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground sticky top-0 bg-card z-10">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 text-left font-semibold whitespace-nowrap">Product ID</th>
              <th className="py-2 pr-3 text-left font-semibold whitespace-nowrap">Description</th>
              <th className="py-2 pr-3 text-left font-semibold whitespace-nowrap">Factory</th>
              <th className="py-2 pr-3 text-right font-semibold whitespace-nowrap">OH Inv</th>
              <th className="py-2 pr-2 text-right font-semibold whitespace-nowrap">Supply Status</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <SkeletonRows rows={5} cols={5} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-5 text-center text-muted-foreground">
                  No forecast data found.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr
                  key={`${r.sku}-${i}`}
                  className="border-b border-border/60 transition-colors duration-150 hover:bg-muted/50 motion-safe:animate-stagger-in"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <td className="py-2 pr-3 whitespace-nowrap">{r.sku ?? "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap max-w-[200px] truncate" title={r.description ?? ""}>{r.description ?? "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.factory ?? "—"}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">{r.oh_inv != null ? Number(r.oh_inv).toLocaleString() : "—"}</td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    <div className="flex justify-end">
                      <SupplyStatusBadge status={r.supply_status} />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </DataCardShell>
  );
}

/* =============================
   RECENT RMA
============================= */

type RecentRmaRow = {
  id: number | null;
  product_id: string | null;
  marketplace: string | null;
  status: string | null;
  received_status: string | null;
};

function RecentRmaCard({ delayMs = 0 }: { delayMs?: number }) {
  const [rows, setRows] = useState<RecentRmaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const retryCount = useRef(0);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    const t0 = performance.now();
    try {
      mode === "initial" ? setLoading(true) : setRefreshing(true);
      setErr(null);

      const { data, error } = await supabase
        .from("dashboard_rma")
        .select("id,product_id,marketplace,status,received_status")
        .order("id", { ascending: false })
        .limit(5);

      if (error) throw error;

      retryCount.current = 0;
      setRows((data ?? []) as RecentRmaRow[]);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load Recent RMA.";
      if (retryCount.current < 1 && (msg.includes("timeout") || msg.includes("upstream"))) {
        retryCount.current++;
        setTimeout(() => load(mode), 3500);
        return;
      }
      setErr("Data temporarily unavailable. Click refresh to retry.");
      setRows([]);
    } finally {
      mode === "initial" ? setLoading(false) : setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const delay = setTimeout(() => load("initial"), 900);
    return () => clearTimeout(delay);
  }, [load]);

  return (
    <DataCardShell
      title="RECENT RMA"
      footerHref="/manage-rma"
      onRefresh={() => load("refresh")}
      refreshing={refreshing}
      delayMs={delayMs}
      gradientFrom="from-[#74bfbf]"
      gradientTo="to-[#B8C5B0]"
    >
      {err && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">
          {err}
        </div>
      )}

      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground sticky top-0 bg-card z-10">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 text-left font-semibold whitespace-nowrap">ID</th>
              <th className="py-2 pr-3 text-left font-semibold whitespace-nowrap">Product ID</th>
              <th className="py-2 pr-3 text-left font-semibold whitespace-nowrap">Category</th>
              <th className="py-2 pr-3 text-right font-semibold whitespace-nowrap">Status</th>
              <th className="py-2 pr-2 text-right font-semibold whitespace-nowrap">Received Status</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <SkeletonRows rows={5} cols={5} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-5 text-center text-muted-foreground">
                  No RMA found.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const { base, plus } = splitProductWithPlus(r.product_id);
                return (
                  <tr
                    key={String(r.id)}
                    className="border-b border-border/60 transition-colors duration-150 hover:bg-muted/50 motion-safe:animate-stagger-in"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <td className="py-2 pr-3 whitespace-nowrap">{r.id ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <span>{base}</span>
                        {plus !== null ? (
                          <span className="text-xs font-semibold text-muted-foreground">{`+${plus}`}</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.marketplace ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <div className="flex justify-end">
                        <StatusBadge status={r.status} />
                      </div>
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      <div className="flex justify-end">
                        <StatusBadge status={r.received_status} />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </DataCardShell>
  );
}

/* =============================
   Dashboard
============================= */

export default function Dashboard() {
  const [fromDate] = useState<Date | undefined>(undefined);
  const [toDate] = useState<Date | undefined>(undefined);
  const [status] = useState("all");
  const [warehouse] = useState("all");

  // KPI strip counts — populated by each card via onCountChange callback
  const [kpiUrgent, setKpiUrgent] = useState(0);
  const [kpiOrder30, setKpiOrder30] = useState(0);
  const [kpiOrder60, setKpiOrder60] = useState(0);
  const [kpiOrder90, setKpiOrder90] = useState(0);

  // ✅ range options (same for both cards)
  const [newOrdersRange, setNewOrdersRange] = useState<NewOrdersRange>("31d");

  // toggles
  const [showOrderCount, setShowOrderCount] = useState(false); // orders: count vs revenue
  const [showShippedCount, setShowShippedCount] = useState(false); // shipped: count vs revenue

  const filters = useMemo(
    () => ({
      fromDate,
      toDate,
      status: status === "all" ? undefined : status,
      warehouse: warehouse === "all" ? undefined : warehouse,
    }),
    [fromDate, toDate, status, warehouse],
  );

  // keep existing
  useExecutiveDashboard(filters);

  const {
    isLoading,
    lastError,
    refetch,
    newOrderSeries,
    newOrderCount,
    newOrderRevenue,
    shippedSeries,
    shippedCount,
    shippedRevenue,
  } = useDashboardData(filters, newOrdersRange);

  const { metrics } = useDashboardMetrics(filters, newOrdersRange);

  const rangeLabel = useMemo(() => {
    if (fromDate || toDate) return "CUSTOM RANGE";
    switch (newOrdersRange) {
      case "24h":
        return "LAST 24 HOURS";
      case "7d":
        return "LAST 7 DAYS";
      case "15d":
        return "LAST 15 DAYS";
      case "4m":
        return "LAST 4 MONTHS";
      case "6m":
        return "LAST 6 MONTHS";
      case "12m":
        return "LAST 12 MONTHS";
      default:
        return "LAST 31 DAYS";
    }
  }, [newOrdersRange, fromDate, toDate]);

  const newValue = showOrderCount ? newOrderCount : newOrderRevenue;
  const shippedValue = showShippedCount ? shippedCount : shippedRevenue;

  /**
   * ✅ Build chart data with __hasData flag
   * - line stays smooth (connectNulls)
   * - dots show ONLY if __hasData true
   */
  const newSpark = (newOrderSeries ?? []).map((p: any) => {
    const count = Number(p.count ?? 0);
    const revenue = p.revenue === null || p.revenue === undefined ? null : Number(p.revenue);
    const hasData = count > 0 || (revenue !== null && Number.isFinite(revenue));
    return {
      date: p.date,
      v: showOrderCount ? count : revenue, // keep nulls for missing revenue (so we don't fake data)
      __hasData: hasData,
    };
  });

  const shippedSpark = (shippedSeries ?? []).map((p: any) => {
    const count = Number(p.shipped_count ?? 0);
    const revenue = p.shipped_revenue === null || p.shipped_revenue === undefined ? null : Number(p.shipped_revenue);
    const hasData = count > 0 || (revenue !== null && Number.isFinite(revenue));
    return {
      date: p.date,
      v: showShippedCount ? count : revenue,
      __hasData: hasData,
    };
  });

  const formatXAxis = (v: any) => {
    const dt = parseDashboardDate(String(v));
    if (!dt) return String(v);
    if (newOrdersRange === "24h") return format(dt, "MMM d h a");
    if (newOrdersRange === "4m" || newOrdersRange === "6m" || newOrdersRange === "12m") return format(dt, "MMM d");
    return format(dt, "MMM d");
  };

  /* ── Executive KPI helpers ── */
  const safeNum = (v: any) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };

  function computeTrendPct(series: any[], field: string): number | null {
    const valid = (series ?? []).filter((p: any) => p.has_data === true);
    if (valid.length < 2) return null;
    const prev = safeNum(valid[valid.length - 2][field]);
    const curr = safeNum(valid[valid.length - 1][field]);
    if (prev === 0) return null;
    return ((curr - prev) / Math.abs(prev)) * 100;
  }

  function trendMeta(pct: number | null): { text: string; cls: string } {
    if (pct === null || !Number.isFinite(pct)) return { text: "—", cls: "text-muted-foreground" };
    const r = Math.round(pct * 10) / 10;
    if (r > 0) return { text: `↑ ${r}%`, cls: "text-green-600 dark:text-green-400" };
    if (r < 0) return { text: `↓ ${Math.abs(r)}%`, cls: "text-destructive" };
    return { text: "—", cls: "text-muted-foreground" };
  }

  const grossSales = safeNum(newOrderRevenue);
  const fulfilledSales = safeNum(shippedRevenue);
  const fulfillmentRate = grossSales > 0 ? (fulfilledSales / grossSales) * 100 : 0;
  const backlog = grossSales - fulfilledSales;

  // Trend: last 2 valid points
  const grossTrend = trendMeta(computeTrendPct(newOrderSeries, "revenue"));
  const fulfilledTrend = trendMeta(computeTrendPct(shippedSeries, "shipped_revenue"));

  // Fulfillment rate trend from last 2 valid points
  const frTrendPct = (() => {
    const oValid = (newOrderSeries ?? []).filter((p: any) => p.has_data);
    const sValid = (shippedSeries ?? []).filter((p: any) => p.has_data);
    if (oValid.length < 2 || sValid.length < 2) return null;
    const prevGross = safeNum(oValid[oValid.length - 2].revenue);
    const currGross = safeNum(oValid[oValid.length - 1].revenue);
    const prevShip = safeNum(sValid[sValid.length - 2].shipped_revenue);
    const currShip = safeNum(sValid[sValid.length - 1].shipped_revenue);
    const prevRate = prevGross > 0 ? (prevShip / prevGross) * 100 : 0;
    const currRate = currGross > 0 ? (currShip / currGross) * 100 : 0;
    if (prevRate === 0) return null;
    return ((currRate - prevRate) / Math.abs(prevRate)) * 100;
  })();
  const frTrend = trendMeta(frTrendPct);

  // Backlog trend
  const blTrendPct = (() => {
    const oValid = (newOrderSeries ?? []).filter((p: any) => p.has_data);
    const sValid = (shippedSeries ?? []).filter((p: any) => p.has_data);
    if (oValid.length < 2 || sValid.length < 2) return null;
    const prevBL = safeNum(oValid[oValid.length - 2].revenue) - safeNum(sValid[sValid.length - 2].shipped_revenue);
    const currBL = safeNum(oValid[oValid.length - 1].revenue) - safeNum(sValid[sValid.length - 1].shipped_revenue);
    if (prevBL === 0) return null;
    return ((currBL - prevBL) / Math.abs(prevBL)) * 100;
  })();
  const blTrend = trendMeta(blTrendPct);

  // Dynamic tones
  const frIconColor = fulfillmentRate >= 95
    ? "text-green-600 dark:text-green-400"
    : fulfillmentRate >= 85
      ? "text-yellow-600 dark:text-yellow-400"
      : "text-destructive";
  const frIconBg = fulfillmentRate >= 95
    ? "bg-green-500/15"
    : fulfillmentRate >= 85
      ? "bg-yellow-500/15"
      : "bg-destructive/15";

  const blIconColor = backlog > 0 ? "text-destructive" : "text-green-600 dark:text-green-400";
  const blIconBg = backlog > 0 ? "bg-destructive/15" : "bg-green-500/15";

  const kpiCards: Array<{
    label: string;
    target: number;
    format: (n: number) => string;
    sub: string;
    trend: { text: string; cls: string };
    icon: typeof DollarSign;
    iconColor: string;
    iconBg: string;
    gradientClass: string;
  }> = [
    {
      label: "Gross Sales",
      target: grossSales,
      format: (n) => formatFullCurrency(n),
      sub: rangeLabel,
      trend: grossTrend,
      icon: DollarSign,
      iconColor: "text-white",
      iconBg: "icon-glow-blue",
      gradientClass: "metric-card-gradient-blue",
    },
    {
      label: "Fulfilled Sales",
      target: fulfilledSales,
      format: (n) => formatFullCurrency(n),
      sub: rangeLabel,
      trend: fulfilledTrend,
      icon: Truck,
      iconColor: "text-white",
      iconBg: "icon-glow-green",
      gradientClass: "metric-card-gradient-green",
    },
    {
      label: "Fulfillment Rate",
      target: fulfillmentRate,
      format: (n) => `${n.toFixed(1)}%`,
      sub: rangeLabel,
      trend: frTrend,
      icon: Percent,
      iconColor: "text-white",
      iconBg: "icon-glow-purple",
      gradientClass: "metric-card-gradient-purple",
    },
    {
      label: "Backlog",
      target: backlog,
      format: (n) => formatFullCurrency(n),
      sub: rangeLabel,
      trend: blTrend,
      icon: Package,
      iconColor: "text-white",
      iconBg: "icon-glow-orange",
      gradientClass: "metric-card-gradient-orange",
    },
  ];

  // ✅ shared menu items (same order)
  const RangeMenu = ({ onPick }: { onPick: (r: NewOrdersRange) => void }) => (
    <>
      <DropdownMenuItem onClick={() => onPick("24h")}>Last 24 hours</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onPick("7d")}>Last 7 days</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onPick("15d")}>Last 15 days</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onPick("31d")}>Last 31 days</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onPick("4m")}>Last 4 months</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onPick("6m")}>Last 6 months</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onPick("12m")}>Last 12 months</DropdownMenuItem>
    </>
  );

  return (
    <div className="flex flex-col h-full">
      <header className="h-14 shrink-0 border-b border-border bg-card flex items-center px-4 gap-3">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground md:hidden" />
        <Separator orientation="vertical" className="h-6 md:hidden" />
        <div>
          <h1 className="text-sm font-semibold text-foreground leading-tight">Replenishment Cockpit</h1>
          <p className="text-[11px] text-muted-foreground">Buyer overview — what to order, and when</p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6 bg-background space-y-6 motion-safe:animate-fade-in">
        {lastError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            Dashboard error: {lastError}
          </div>
        )}

        {/* INVENTORY KPI STRIP — replaces old metric cards */}
        <InventoryKpiStrip
          urgentCount={kpiUrgent}
          order30Count={kpiOrder30}
          order60Count={kpiOrder60}
          order90Count={kpiOrder90}
        />

        {/* CHARTS */}
        <div
          className={cn(
            "grid grid-cols-1 xl:grid-cols-2 gap-6 transition-opacity duration-300",
            isLoading && "opacity-60",
          )}
        >
          {/* NEW ORDERS */}
          <Card
            className="border-border shadow-lg overflow-hidden transition-all duration-200 hover:shadow-xl motion-safe:animate-stagger-in chart-card-enhanced chart-card-border"
            style={{ animationDelay: "400ms" }}
          >
            <CardContent className="p-0 chart-container-enhanced">
              <div className="flex items-center justify-between px-6 pt-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#3b5769]">New Orders</p>
                  <div className="mt-2 flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-[#3b5769]/10 flex items-center justify-center border border-[#3b5769]/20">
                      <ShoppingCart className="h-6 w-6 text-[#3b5769]" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground number-highlight">
                        {showOrderCount
                          ? Number(newValue ?? 0).toLocaleString()
                          : formatFullCurrency(Number(newValue ?? 0))}
                      </p>
                      <p className="text-xs text-muted-foreground font-semibold tracking-widest">{rangeLabel}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-xs text-primary hover:opacity-80 underline underline-offset-4"
                    onClick={() => setShowOrderCount((p) => !p)}
                  >
                    {showOrderCount ? "Show amount" : "Show number of orders"}
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border bg-background hover:bg-muted"
                        aria-label="Range filter"
                      >
                        <MoreVertical className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <RangeMenu onPick={(r) => setNewOrdersRange(r)} />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="h-[220px] px-3 pb-4 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={newSpark}>
                    <defs>
                      <linearGradient id="colorNewOrders" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b5769" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3b5769" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tickFormatter={formatXAxis} />
                    <Tooltip
                      cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                      content={
                        <ChartTooltip
                          labelFormatter={(l: any) => formatXAxis(l)}
                          valueFormatter={(v: any, row: any) => {
                            if (!row?.__hasData) return "—";
                            if (showOrderCount) return `Orders: ${Number(v ?? 0).toLocaleString()}`;
                            return `Grand Total: ${formatFullCurrency(Number(v ?? 0))}`;
                          }}
                        />
                      }
                    />
                    <Area
                      type="natural"
                      dataKey="v"
                      stroke="#3b5769"
                      strokeWidth={2.5}
                      fill="url(#colorNewOrders)"
                      dot={false}
                      activeDot={{ r: 7 }}
                      connectNulls
                      isAnimationActive
                      animationDuration={1000}
                      animationEasing="ease-out"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* SHIPPED */}
          <Card
            className="border-border shadow-lg overflow-hidden transition-all duration-200 hover:shadow-xl motion-safe:animate-stagger-in chart-card-enhanced chart-card-border"
            style={{ animationDelay: "500ms" }}
          >
            <CardContent className="p-0 chart-container-enhanced">
              <div className="flex items-center justify-between px-6 pt-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#74bfbf]">Shipped</p>
                  <div className="mt-2 flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-[#74bfbf]/10 flex items-center justify-center border border-[#74bfbf]/20">
                      <Truck className="h-6 w-6 text-[#74bfbf]" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground number-highlight">
                        {showShippedCount
                          ? Number(shippedValue ?? 0).toLocaleString()
                          : formatFullCurrency(Number(shippedValue ?? 0))}
                      </p>
                      <p className="text-xs text-muted-foreground font-semibold tracking-widest">{rangeLabel}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-xs text-green-600 dark:text-green-400 hover:opacity-80 underline underline-offset-4"
                    onClick={() => setShowShippedCount((p) => !p)}
                  >
                    {showShippedCount ? "Show amount" : "Show shipped count"}
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border bg-background hover:bg-muted"
                        aria-label="Range filter"
                      >
                        <MoreVertical className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <RangeMenu onPick={(r) => setNewOrdersRange(r)} />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="h-[220px] px-3 pb-4 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={shippedSpark}>
                    <defs>
                      <linearGradient id="colorShipped" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#74bfbf" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#74bfbf" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tickFormatter={formatXAxis} />
                    <Tooltip
                      cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                      content={
                        <ChartTooltip
                          labelFormatter={(l: any) => formatXAxis(l)}
                          valueFormatter={(v: any, row: any) => {
                            if (!row?.__hasData) return "—";
                            if (showShippedCount) return `Shipped: ${Number(v ?? 0).toLocaleString()}`;
                            return `Grand Total: ${formatFullCurrency(Number(v ?? 0))}`;
                          }}
                        />
                      }
                    />
                    <Area
                      type="natural"
                      dataKey="v"
                      stroke="#74bfbf"
                      strokeWidth={2.5}
                      fill="url(#colorShipped)"
                      dot={false}
                      activeDot={{ r: 7 }}
                      connectNulls
                      isAnimationActive
                      animationDuration={1000}
                      animationEasing="ease-out"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* BOTTOM CARDS */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <InventoryArrivalsCard delayMs={600} onCountChange={setKpiUrgent} />
          <PurchaseOrdersCard delayMs={700} onCountChange={setKpiOrder30} />
          <Order60Card delayMs={800} onCountChange={setKpiOrder60} />
          <Order90Card delayMs={900} onCountChange={setKpiOrder90} />
        </div>
      </div>
    </div>
  );
}
