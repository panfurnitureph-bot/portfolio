import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ProductImage from "@/components/shared/ProductImage";
import {
  useSalesSummary,
  useSalesCmRows,
  useCmConfig,
  useShopifyRates,
  useBzlProductNames,
  saveCmConfigKey,
  insertShopifyRate,
  CM_COLS,
  type SummaryCard,
  type CmRow,
  type CmConfig,
} from "@/hooks/useSalesAnalytics";
import { useFactoryAccess } from "@/hooks/useFactoryAccess";
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, TrendingUp, AlertTriangle, Settings2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* formatting                                                          */
/* ------------------------------------------------------------------ */

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "-$" : "$"}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** margin_pct etc. arrive already ×100 (e.g. 41.3). One decimal per spec. */
const pct1 = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`;
const int = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString();

/** "2026-08-01" → "Aug 1" (parsed as plain date, walang timezone shift). */
function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtRange(from: string | null | undefined, to: string | null | undefined): string {
  const a = fmtDate(from), b = fmtDate(to);
  if (!a && !b) return "";
  if (a === b || !b) return a;
  if (!a) return b;
  return `${a} – ${b}`;
}

/* ------------------------------------------------------------------ */
/* channels                                                            */
/* ------------------------------------------------------------------ */

const MAIN_CHANNELS = ["Website", "Marketplace A", "Dropship Partner", "Marketplace B", "Amazon", "Marketplace C"] as const;
/** Target, Local Store and Wholesale land in "Other" (a small combined amount). */
const CHANNEL_PILLS = ["all", ...MAIN_CHANNELS, "Other"] as const;
type ChannelPill = (typeof CHANNEL_PILLS)[number];

function rowInChannel(row: CmRow, ch: ChannelPill): boolean {
  if (ch === "all") return true;
  if (ch === "Other") return !(MAIN_CHANNELS as readonly string[]).includes(row.channel);
  return row.channel === ch;
}

/* ------------------------------------------------------------------ */
/* aggregation — the grain is (period, sku, channel), so every         */
/* all-channels or Other figure is a SUM at read time. Percentages     */
/* are recomputed from the sums, never averaged.                       */
/* ------------------------------------------------------------------ */

interface TableRow {
  sku: string;
  orders: number;
  units: number;
  returned_qty: number;
  sales: number;
  cogs: number;
  gross_profit: number;
  net_profit: number;
  margin_pct: number | null;
  landed_cogs_total: number;
  shipping_revenue: number;
  shopify_fee: number;
  returns_allowance: number;
  opex: number;
  fulfillment: number;
  marketing: number;
  cm1: number;
  cm2: number;
  cm3: number;
  cm1_pct: number | null;
  cm2_pct: number | null;
  cm3_pct: number | null;
}

const cmVal = (r: CmRow, col: string): number => Number((r as unknown as Record<string, unknown>)[col]) || 0;

function groupBySku(rows: CmRow[]): TableRow[] {
  const map = new Map<string, TableRow>();
  for (const r of rows) {
    let t = map.get(r.sku);
    if (!t) {
      t = {
        sku: r.sku, orders: 0, units: 0, returned_qty: 0, sales: 0, cogs: 0,
        gross_profit: 0, net_profit: 0, margin_pct: null,
        landed_cogs_total: 0, shipping_revenue: 0, shopify_fee: 0, returns_allowance: 0,
        opex: 0, fulfillment: 0, marketing: 0,
        cm1: 0, cm2: 0, cm3: 0, cm1_pct: null, cm2_pct: null, cm3_pct: null,
      };
      map.set(r.sku, t);
    }
    t.orders += r.orders || 0;
    t.units += r.units || 0;
    t.returned_qty += r.returned_qty || 0;
    t.sales += r.sales || 0;
    t.cogs += r.cogs || 0;
    t.gross_profit += Number(r.gross_profit) || 0;
    t.net_profit += Number(r.net_profit) || 0;
    t.landed_cogs_total += r.landed_cogs_total || 0;
    t.shipping_revenue += r.shipping_revenue || 0;
    t.shopify_fee += r.shopify_fee || 0;
    t.returns_allowance += r.returns_allowance || 0;
    t.opex += r.opex || 0;
    t.fulfillment += r.fulfillment || 0;
    t.marketing += r.marketing || 0;
    t.cm1 += cmVal(r, CM_COLS.cm1);
    t.cm2 += cmVal(r, CM_COLS.cm2);
    t.cm3 += cmVal(r, CM_COLS.cm3);
  }
  for (const t of map.values()) {
    if (t.sales > 0) {
      t.margin_pct = (100 * t.net_profit) / t.sales;
      t.cm1_pct = (100 * t.cm1) / t.sales;
      t.cm2_pct = (100 * t.cm2) / t.sales;
      t.cm3_pct = (100 * t.cm3) / t.sales;
    }
  }
  return [...map.values()];
}

interface PeriodSums {
  sales: number; orders: number; units: number; returns: number; net: number;
  cm1: number; cm2: number; cm3: number;
}

function sumPeriod(rows: CmRow[]): PeriodSums {
  const s: PeriodSums = { sales: 0, orders: 0, units: 0, returns: 0, net: 0, cm1: 0, cm2: 0, cm3: 0 };
  for (const r of rows) {
    s.sales += r.sales || 0;
    // Summing per-SKU orders over-counts multi-SKU orders slightly; the
    // summary table's distinct count is used instead wherever it exists.
    s.orders += r.orders || 0;
    s.units += r.units || 0;
    s.returns += r.returned_qty || 0;
    s.net += Number(r.net_profit) || 0;
    s.cm1 += cmVal(r, CM_COLS.cm1);
    s.cm2 += cmVal(r, CM_COLS.cm2);
    s.cm3 += cmVal(r, CM_COLS.cm3);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* small components                                                    */
/* ------------------------------------------------------------------ */

type SortKey =
  | "name" | "units" | "returned_qty" | "sales" | "gross_profit" | "net_profit" | "margin"
  | "landed_cogs_total" | "shipping_revenue" | "shopify_fee" | "returns_allowance"
  | "cm1" | "opex" | "fulfillment" | "cm2" | "marketing" | "cm3";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
  return sortDir === "asc" ? <ChevronUp className="ml-1 inline h-3 w-3 text-primary" /> : <ChevronDown className="ml-1 inline h-3 w-3 text-primary" />;
}

function Metric({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="truncate font-semibold text-foreground" title={value}>{value}<Delta d={delta} /></div>
    </div>
  );
}

/** d is an already-computed percent (e.g. -61.3). NULL → render nothing. */
function Delta({ d }: { d?: number | null }) {
  if (d == null || !Number.isFinite(d)) return null;
  const up = d >= 0;
  return <span className={cn("ml-1 text-[9px] font-bold", up ? "text-emerald-600" : "text-red-600")}>{up ? "▲" : "▼"}{Math.abs(d).toFixed(1)}%</span>;
}

const CARD_ACCENTS = [
  "from-emerald-600 to-emerald-500",
  "from-teal-600 to-teal-500",
  "from-teal-700 to-cyan-600",
  "from-cyan-700 to-sky-600",
  "from-sky-700 to-blue-600",
];

const FORECAST_TOOLTIP =
  "Projection: month-to-date sales ÷ elapsed days × days in the month. Assumes the rest of the month sells like the days already seen — no seasonality, weekday pattern, or promotions.";

const AVGCOST_WARNING =
  "Uses the ERP's AverageCost, which is unreliable on kit products — AA-200-SG reads −115.9% here but is a 54.8% CM1 product on landed COGS. CM1–CM3 use landed COGS instead.";

/* ------------------------------------------------------------------ */
/* header cell with formula tooltip                                    */
/* ------------------------------------------------------------------ */

/** Thick group separator — same 6px slate bar as the Demand Planner's mf-sep-dark. */
const SEP = "border-l-[6px] border-l-slate-600";

function Th({
  label, sign, cap, tip, col, group, divider, sortKey, sortDir, onSort, className,
}: {
  label: string;
  sign?: "-" | "+";
  cap?: string;
  tip?: React.ReactNode;
  col?: SortKey;
  group?: "cost" | "cm";
  divider?: boolean;
  sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void;
  className?: string;
}) {
  const base = "px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide whitespace-nowrap select-none align-bottom";
  const groupCls = group === "cost" ? "bg-[#fdf6e9] text-amber-900/70"
    : group === "cm" ? "bg-[#e9f6f4] text-teal-700"
    : "bg-background text-muted-foreground";
  const inner = (
    <span className={cn(col && "cursor-pointer hover:opacity-80")} onClick={col ? () => onSort(col) : undefined}>
      {sign && <span className={cn("mr-0.5 font-normal", sign === "+" ? "text-teal-600" : "text-muted-foreground/60")}>{sign === "+" ? "+" : "−"}</span>}
      {label}
      {col && <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />}
    </span>
  );
  return (
    <th className={cn(base, groupCls, "text-center border-b border-border", divider && SEP, className)}>
      {tip ? (
        <Tooltip>
          <TooltipTrigger asChild><span className="cursor-help">{inner}</span></TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[280px] text-xs font-normal normal-case tracking-normal text-left whitespace-normal">{tip}</TooltipContent>
        </Tooltip>
      ) : inner}
      {cap && <span className="block text-[9px] font-normal normal-case tracking-normal text-muted-foreground leading-tight mt-0.5 whitespace-normal">{cap}</span>}
    </th>
  );
}

/* ------------------------------------------------------------------ */
/* margin settings panel                                               */
/* ------------------------------------------------------------------ */

function MarginSettingsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: config } = useCmConfig();
  const { data: rates } = useShopifyRates();

  const [shopify, setShopify] = useState("2.5");
  const [override, setOverride] = useState(false);
  const [returns, setReturns] = useState("5");
  const [opex, setOpex] = useState("0");
  const [ful, setFul] = useState("0");
  const [fmode, setFmode] = useState<CmConfig["fulfillment_mode"]>("per_unit");
  const [mktg, setMktg] = useState("18");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Latest dated rate; the view defaults to 2.5% when no dated rate covers a period.
  const latestRate = rates && rates.length > 0 ? rates[rates.length - 1].rate_pct : 2.5;

  useEffect(() => {
    if (!open || !config) return;
    setOverride(config.shopify_override_pct != null);
    setShopify(String(config.shopify_override_pct ?? latestRate));
    setReturns(String(config.returns_pct));
    setOpex(String(config.opex_pct));
    setFul(String(config.fulfillment_value));
    setFmode(config.fulfillment_mode);
    setMktg(String(config.marketing_pct));
    setMsg(null);
  }, [open, config, latestRate]);

  const fulUnit = fmode === "percent" ? "% of sales" : fmode === "per_order" ? "$ per order" : "$ per unit";

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const num = (s: string) => {
        const n = Number(s);
        return Number.isFinite(n) && n >= 0 ? n : 0;
      };
      await saveCmConfigKey("returns_pct", { num_value: num(returns) });
      await saveCmConfigKey("opex_pct", { num_value: num(opex) });
      await saveCmConfigKey("fulfillment_value", { num_value: num(ful) });
      await saveCmConfigKey("fulfillment_mode", { text_value: fmode });
      await saveCmConfigKey("marketing_pct", { num_value: num(mktg) });
      const rate = num(shopify);
      if (override) {
        // One rate across every period, dated rates ignored until unchecked.
        await saveCmConfigKey("shopify_override_pct", { num_value: rate });
      } else {
        await saveCmConfigKey("shopify_override_pct", { num_value: null });
        // Raising the rate is an INSERT with today's date — past periods keep
        // the rate they were calculated with. Never edit an existing row.
        if (Math.abs(rate - latestRate) > 1e-9) {
          const today = new Date();
          const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          await insertShopifyRate(iso, rate);
        }
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["forecast_sales_cm_rows"] }),
        qc.invalidateQueries({ queryKey: ["forecast_cm_config"] }),
        qc.invalidateQueries({ queryKey: ["forecast_cm_shopify_rate"] }),
      ]);
      setMsg({ ok: true, text: "Saved. Every period recalculated." });
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setMsg({ ok: false, text: `Save failed: ${m}. If this mentions row-level security, the write policy on forecast_cm_config / forecast_cm_shopify_rate has not been added yet.` });
    } finally {
      setSaving(false);
    }
  }

  const label = "text-[13px] font-medium text-foreground";
  const hint = "text-[11.5px] text-muted-foreground leading-snug mt-0.5 mb-1.5";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] overflow-y-auto sm:max-w-[380px]">
        <SheetHeader><SheetTitle className="text-[15px]">Margin settings</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-5">

          <div>
            <div className={label}>Shopify fee</div>
            <div className={hint}>Charged on sales. Past periods keep the rate they were calculated with, so raising it today doesn't rewrite last month.</div>
            <div className="flex items-center gap-2">
              <Input type="number" step="0.1" min="0" value={shopify} onChange={(e) => setShopify(e.target.value)} className="h-8 w-24 text-right tabular-nums" />
              <span className="text-[13px] text-muted-foreground">% of sales</span>
            </div>
            <div className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2.5">
              <div className="text-[11px] text-muted-foreground mb-1">Rates in effect</div>
              {rates && rates.length > 0 ? (
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {rates.map((r) => (
                      <tr key={r.effective_from}>
                        <td className="py-0.5">From {fmtDate(r.effective_from)}, {r.effective_from.slice(0, 4)}</td>
                        <td className="py-0.5 text-right tabular-nums">{r.rate_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-[12px] text-muted-foreground">No dated rates visible — the view is using its 2.5% default.</div>
              )}
              <label className="mt-2 flex items-start gap-2 text-[12.5px] text-muted-foreground cursor-pointer">
                <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} className="mt-0.5" />
                <span>Apply the rate above to every past period too, instead of the dated rates. Turning this off restores them.</span>
              </label>
            </div>
          </div>

          <div>
            <div className={label}>Returns allowance</div>
            <div className={hint}>An expected rate, not the returns actually recorded — those run near zero and would leave the margin overstated.</div>
            <div className="flex items-center gap-2">
              <Input type="number" step="0.1" min="0" value={returns} onChange={(e) => setReturns(e.target.value)} className="h-8 w-24 text-right tabular-nums" />
              <span className="text-[13px] text-muted-foreground">% of sales</span>
            </div>
          </div>

          <Separator />

          <div>
            <div className={label}>OPEX</div>
            <div className={hint}>While OPEX and fulfillment sit at zero, CM2 equals CM1 — that's correct, not a bug.</div>
            <div className="flex items-center gap-2">
              <Input type="number" step="0.1" min="0" value={opex} onChange={(e) => setOpex(e.target.value)} className="h-8 w-24 text-right tabular-nums" />
              <span className="text-[13px] text-muted-foreground">% of sales</span>
            </div>
          </div>

          <div>
            <div className={label}>Fulfillment</div>
            <div className={hint}>Pick how it's charged, then the amount.</div>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {(["per_unit", "per_order", "percent"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setFmode(m)}
                  className={cn("px-3 py-1.5 text-[12.5px] border-r border-border last:border-r-0",
                    fmode === m ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground")}>
                  {m === "per_unit" ? "Per unit" : m === "per_order" ? "Per order" : "Percent"}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input type="number" step="0.5" min="0" value={ful} onChange={(e) => setFul(e.target.value)} className="h-8 w-24 text-right tabular-nums" />
              <span className="text-[13px] text-muted-foreground">{fulUnit}</span>
            </div>
          </div>

          <Separator />

          <div>
            <div className={label}>Marketing</div>
            <div className="mt-1.5 flex items-center gap-2">
              <Input type="number" step="0.5" min="0" value={mktg} onChange={(e) => setMktg(e.target.value)} className="h-8 w-24 text-right tabular-nums" />
              <span className="text-[13px] text-muted-foreground">% of sales</span>
            </div>
          </div>

          <Button className="w-full" onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save settings
          </Button>
          {msg && (
            <div className={cn("text-[12px] leading-snug", msg.ok ? "text-emerald-600 text-center" : "text-red-600")}>{msg.text}</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

interface CardData {
  key: string;
  title: string;
  sub: string;
  hist: boolean;
  isForecast: boolean;
  periodKey: string | null; // forecast_sales_cm period name; selects the table
  sales: number | null;
  orders: number | null;
  units: number | null;
  returns: number | null;
  net: number | null;
  cm1: number | null; cm2: number | null; cm3: number | null;
  salesDelta: number | null;
  netDelta: number | null;
}

/** Live cards → their per-SKU period in the view. */
const CARD_TO_PERIOD: Record<string, string> = {
  "Today": "Today",
  "Yesterday": "Yesterday",
  "Month to date": "Month to date",
  "Last month": "Last month",
};
/** Closed months in the view, newest first (matches period_sort 5–8). */
const MONTH_PERIODS = ["July 2026", "June 2026", "May 2026", "April 2026"];

export default function ChannelAnalytics() {
  const { allowSku, restricted, ready: accessReady } = useFactoryAccess();
  const [activePeriod, setActivePeriod] = useState<string>("Yesterday");
  const [channel, setChannel] = useState<ChannelPill>("all");
  const [search, setSearch] = useState("");
  // Typing stays instant; the expensive table filter re-runs at low priority.
  const deferredSearch = useDeferredValue(search);
  const [sortKey, setSortKey] = useState<SortKey>("sales");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [panelOpen, setPanelOpen] = useState(false);

  const { data: summary, isLoading: summaryLoading } = useSalesSummary();
  const { data: cmRows, isLoading: cmLoading } = useSalesCmRows();
  const { data: config } = useCmConfig();
  const { data: nameMap } = useBzlProductNames();

  const cards: SummaryCard[] = summary ?? [];

  // "needs OPEX" — while both knobs sit at zero, CM2 duplicates CM1 by design.
  const opexUnset = config != null && config.opex_pct === 0 && config.fulfillment_value === 0;

  // Staleness: replica lags the ERP — "Today" = last day with sales, not the calendar date.
  const staleness = useMemo(() => {
    const today = cards.find(c => !c.is_forecast && c.card === "Today");
    if (!today?.period_to) return null;
    const [y, m, d] = today.period_to.split("-").map(Number);
    if (!y || !m || !d) return null;
    const now = new Date();
    const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((cur.getTime() - new Date(y, m - 1, d).getTime()) / 86400000);
    return days >= 2 ? { date: fmtDate(today.period_to), days } : null;
  }, [cards]);

  /** period name → channel-filtered rows (this render's channel). */
  const rowsFor = useMemo(() => {
    const byPeriod = new Map<string, CmRow[]>();
    for (const r of cmRows ?? []) {
      if (!rowInChannel(r, channel)) continue;
      const list = byPeriod.get(r.period);
      if (list) list.push(r); else byPeriod.set(r.period, [r]);
    }
    return byPeriod;
  }, [cmRows, channel]);

  /** Same, all channels — used for the forecast card's channel share. */
  const rowsAll = useMemo(() => {
    const byPeriod = new Map<string, CmRow[]>();
    for (const r of cmRows ?? []) {
      const list = byPeriod.get(r.period);
      if (list) list.push(r); else byPeriod.set(r.period, [r]);
    }
    return byPeriod;
  }, [cmRows]);

  const periodMeta = useMemo(() => {
    const m = new Map<string, { from: string | null; to: string | null }>();
    for (const r of cmRows ?? []) if (!m.has(r.period)) m.set(r.period, { from: r.period_from, to: r.period_to });
    return m;
  }, [cmRows]);

  /* ---- nine cards -------------------------------------------------- */
  const cardData: CardData[] = useMemo(() => {
    const out: CardData[] = [];
    const filtered = channel !== "all";

    for (const c of cards) {
      const periodKey = c.is_forecast ? null : (CARD_TO_PERIOD[c.card] ?? null);
      const viewSums = periodKey ? sumPeriod(rowsFor.get(periodKey) ?? []) : null;

      if (c.is_forecast) {
        // Forecast has no per-SKU rows. Scale by the channel's MTD share and
        // apply MTD CM ratios to the (scaled) forecast sales.
        const mtd = sumPeriod(rowsFor.get("Month to date") ?? []);
        const mtdAll = sumPeriod(rowsAll.get("Month to date") ?? []);
        const blend = filtered ? (mtdAll.sales > 0 ? mtd.sales / mtdAll.sales : 0) : 1;
        const sales = c.sales != null ? c.sales * blend : null;
        const ratio = (v: number) => (mtd.sales > 0 && sales != null ? (v / mtd.sales) * sales : null);
        out.push({
          key: c.card, title: c.card, sub: fmtRange(c.period_from, c.period_to),
          hist: false, isForecast: true, periodKey: null,
          sales,
          orders: c.orders != null ? Math.round(c.orders * blend) : null,
          units: c.units != null ? Math.round(c.units * blend) : null,
          returns: filtered ? Math.round((c.returns ?? 0) * blend) : c.returns,
          net: c.net_profit != null ? c.net_profit * blend : null,
          cm1: ratio(mtd.cm1), cm2: ratio(mtd.cm2), cm3: ratio(mtd.cm3),
          salesDelta: filtered ? null : c.sales_vs_prev_pct,
          netDelta: filtered ? null : c.net_vs_prev_pct,
        });
        continue;
      }

      if (!filtered) {
        // All channels: the summary table stays authoritative (distinct order
        // counts); only the CM strip comes from the per-SKU view.
        out.push({
          key: c.card, title: c.card, sub: fmtRange(c.period_from, c.period_to),
          hist: false, isForecast: false, periodKey,
          sales: c.sales, orders: c.orders, units: c.units, returns: c.returns, net: c.net_profit,
          cm1: viewSums?.cm1 ?? null, cm2: viewSums?.cm2 ?? null, cm3: viewSums?.cm3 ?? null,
          salesDelta: c.sales_vs_prev_pct, netDelta: c.net_vs_prev_pct,
        });
      } else {
        // Channel filter: real per-channel sums from the view. (Orders are a
        // per-SKU sum here — multi-SKU orders count once per SKU.)
        const v = viewSums ?? sumPeriod([]);
        out.push({
          key: c.card, title: c.card, sub: fmtRange(c.period_from, c.period_to),
          hist: false, isForecast: false, periodKey,
          sales: v.sales, orders: v.orders, units: v.units, returns: v.returns, net: v.net,
          cm1: v.cm1, cm2: v.cm2, cm3: v.cm3,
          salesDelta: null, netDelta: null,
        });
      }
    }

    // Closed months, straight from the view (real monthly rows exist upstream).
    // Delta = vs the month before it, from the same sums.
    const monthChain = ["Last month", ...MONTH_PERIODS];
    for (let i = 1; i < monthChain.length; i++) {
      const p = monthChain[i];
      const rows = rowsFor.get(p);
      if (!rows || rows.length === 0) continue;
      const v = sumPeriod(rows);
      const prevRows = rowsFor.get(monthChain[i + 1] ?? "");
      const prev = prevRows ? sumPeriod(prevRows) : null;
      const meta = periodMeta.get(p);
      out.push({
        key: p, title: p.replace(/ \d{4}$/, ""), sub: fmtRange(meta?.from, meta?.to),
        hist: true, isForecast: false, periodKey: p,
        sales: v.sales, orders: v.orders, units: v.units, returns: v.returns, net: v.net,
        cm1: v.cm1, cm2: v.cm2, cm3: v.cm3,
        salesDelta: prev && prev.sales > 0 ? (100 * (v.sales - prev.sales)) / prev.sales : null,
        netDelta: null,
      });
    }
    return out;
  }, [cards, rowsFor, rowsAll, channel, periodMeta]);

  /* ---- table rows -------------------------------------------------- */
  const rows = useMemo(() => {
    let list = groupBySku(rowsFor.get(activePeriod) ?? []);
    if (restricted) list = list.filter(r => allowSku(r.sku));
    const q = deferredSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(r => {
        const name = nameMap?.get(r.sku)?.name ?? "";
        return r.sku.toLowerCase().includes(q) || name.toLowerCase().includes(q);
      });
    }
    const val = (r: TableRow): number | string => {
      switch (sortKey) {
        case "name": return nameMap?.get(r.sku)?.name ?? r.sku;
        case "margin":
          // cogs = 0 → 100% margin is missing cost data, not profit. Exclude from ranking.
          return !r.cogs ? Number.NEGATIVE_INFINITY : (r.margin_pct ?? Number.NEGATIVE_INFINITY);
        default: return (r[sortKey] as number | null) ?? Number.NEGATIVE_INFINITY;
      }
    };
    return [...list].sort((a, z) => {
      const av = val(a), zv = val(z);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(zv as string) : (zv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (zv as number) : (zv as number) - (av as number);
    });
  }, [rowsFor, activePeriod, restricted, allowSku, deferredSearch, sortKey, sortDir, nameMap]);

  function toggleSort(key: SortKey) {
    // Re-sorting 17 columns × hundreds of rows is a heavy render — keep the
    // click responsive by marking the state change non-urgent.
    startTransition(() => {
      if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
      else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
    });
  }

  const isLoading = summaryLoading || !accessReady;
  const td = "px-3 py-3 text-[12.5px] whitespace-nowrap tabular-nums text-center border-b border-border/60";
  const tdCost = cn(td, "bg-[#fffdf8]");
  const tdCm = cn(td, "bg-[#f6fcfb]");
  const cmCell = (v: number, p: number | null) => (
    <>
      <span className={cn("font-medium", v < 0 ? "text-red-600" : "text-teal-700")}>{money(v)}</span>
      <div className="text-[10.5px] text-muted-foreground">{pct1(p)}</div>
    </>
  );

  return (
    <TooltipProvider delayDuration={150}>
    <div className="flex h-screen w-full flex-col bg-background overflow-hidden min-h-0" style={{ maxWidth: "none" }}>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Channel Margin Console</span>
        <span className="text-sm text-muted-foreground">/ Best Sellers</span>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur-sm">
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU or product…" className="h-8 pl-8 text-xs" />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{rows.length.toLocaleString()} products</span>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => startTransition(() => setPanelOpen(true))}>
            <Settings2 className="h-3.5 w-3.5" /> Margin settings
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded" />)}</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          {staleness && (
            <div className="mx-4 mt-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Data through {staleness.date} — {staleness.days} days behind
            </div>
          )}

          {/* Channel filter. Percentages don't move with it — they're ratios. */}
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {CHANNEL_PILLS.map((ch) => (
              <button key={ch} type="button" onClick={() => startTransition(() => setChannel(ch))}
                className={cn("rounded-full border px-3 py-1 text-[12px] whitespace-nowrap",
                  channel === ch ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground")}>
                {ch === "all" ? "All channels" : ch}
              </button>
            ))}
          </div>

          {cardData.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No summary data yet — the hourly workflow has not written any rows.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
              {cardData.map((c, i) => {
                const selectable = !c.isForecast && !!c.periodKey;
                const active = selectable && activePeriod === c.periodKey;
                return (
                  <div key={c.key} className={cn("flex flex-col rounded-md border bg-background overflow-hidden",
                    active ? "border-primary ring-1 ring-primary" : "border-border",
                    c.hist && "border-dashed")}>
                    <div className={cn("px-4 py-2 text-white", c.hist ? "bg-slate-500" : cn("bg-gradient-to-r", CARD_ACCENTS[i % CARD_ACCENTS.length]))}>
                      <div className="text-xs font-bold">{c.title}</div>
                      <div className="text-[10px] opacity-90">{c.sub}</div>
                    </div>
                    <div className="flex flex-1 flex-col px-4 py-3">
                      <div className="text-[10px] text-muted-foreground">Sales</div>
                      <div className={cn("text-lg tabular-nums leading-tight", c.hist ? "font-medium" : "font-bold")}>{money(c.sales)}<Delta d={c.salesDelta} /></div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
                        <Metric label="Orders / Units" value={`${int(c.orders)} / ${int(c.units)}`} />
                        <Metric label="Returns" value={int(c.returns)} />
                        <Metric label="Net profit" value={money(c.net)} delta={c.netDelta} />
                        <Metric label="Orders" value={int(c.orders)} />
                      </div>
                      {/* CM strip — same three-column grid as the metrics above. */}
                      <div className="mt-2.5 -mx-4 grid grid-cols-3 gap-1.5 border-t border-border/60 bg-muted/30 px-4 py-2">
                        {([["CM1", c.cm1], ["CM2", c.cm2], ["CM3", c.cm3]] as const).map(([lbl, v]) => (
                          <div key={lbl} className="min-w-0">
                            <div className="text-[9.5px] text-muted-foreground">{lbl}</div>
                            {lbl === "CM2" && opexUnset ? (
                              <span className="inline-block rounded bg-amber-100 px-1 py-px text-[9px] font-semibold text-amber-800" title="OPEX and fulfillment are 0 in Margin settings, so CM2 equals CM1.">needs OPEX</span>
                            ) : (
                              <>
                                <div className={cn("truncate text-[12px] font-semibold tabular-nums", (v ?? 0) < 0 ? "text-red-600" : "text-teal-700")}>{v == null ? "—" : `$${Math.round(v).toLocaleString()}`}</div>
                                <div className="text-[9.5px] text-muted-foreground tabular-nums">{v != null && c.sales ? pct1((100 * v) / c.sales) : "—"}</div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                      <button type="button" onClick={() => selectable && c.periodKey && startTransition(() => setActivePeriod(c.periodKey!))} disabled={!selectable}
                        title={c.isForecast ? FORECAST_TOOLTIP : undefined}
                        className="mt-auto border-t border-border pt-1.5 text-center text-[11px] font-semibold text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
                        {selectable ? "View products" : "Forecast"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-4 border-b border-border px-4">
            <span className="py-2 text-sm font-semibold text-foreground">
              {activePeriod}{channel !== "all" ? ` · ${channel === "Other" ? "Other channels" : channel}` : ""}
            </span>
            <span className="border-b-2 border-primary py-2 text-sm font-medium text-primary">Products</span>
            <span className="py-2 text-sm text-muted-foreground">Order Items</span>
          </div>

          <div className="px-4 pb-4">
            <table className="w-full min-w-[2150px] border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className={cn("sticky left-0 z-20 bg-background px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap select-none align-bottom border-b border-border shadow-[1px_0_0_hsl(var(--border))] cursor-pointer hover:text-foreground")}
                    onClick={() => toggleSort("name")}>
                    Product <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <Th label="Units" col="units" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    tip="Quantity sold on completed, fully shipped orders. Kit purchases are exploded down to their components." />
                  <Th label="Returned Qty" col="returned_qty" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <Th label="Sales" col="sales" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    tip="Product revenue only — bvc_OrderItem.LineTotal. Shipping charged to the customer sits in a separate field and is not in here." />
                  <Th label="Gross profit" col="gross_profit" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    tip={<span>Sales minus the ERP's AverageCost. {AVGCOST_WARNING}</span>} />
                  <Th label="Net profit" col="net_profit" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    tip={<span>Gross profit minus outbound shipping, on the same AverageCost basis. {AVGCOST_WARNING}</span>} />
                  <Th label="Margin" col="margin" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    tip={<span>Net profit ÷ sales. {AVGCOST_WARNING}</span>} />
                  <Th label="Landed COGS" sign="-" group="cost" divider col="landed_cogs_total" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    tip="From Airtable: (FOB + duty + inbound freight) × an overhead factor, × units sold. This is the number that actually separates one SKU from another." />
                  <Th label="Shipping rev" sign="+" group="cm" col="shipping_revenue" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    tip="The delivery fee CHARGED TO THE CUSTOMER — flat values, split across the lines of an order. It is revenue, not cost, so it adds to the margin." />
                  <Th label="Shopify" sign="-" group="cost" col="shopify_fee" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    cap={config?.shopify_override_pct != null ? `${config.shopify_override_pct}% override, all periods` : "% of sales, frozen per period"}
                    tip="A flat percentage of sales, frozen per period — past months keep the rate they were calculated with. Editable in Margin settings." />
                  <Th label="Returns" sign="-" group="cost" col="returns_allowance" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    cap={config ? `${config.returns_pct}% allowance` : undefined}
                    tip="An expected allowance, not the returns actually recorded — those run near zero and would leave the margin overstated." />
                  <Th label="CM1" group="cm" col="cm1" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    cap="after product cost & fees"
                    tip={<span><b>Sales − landed COGS + shipping rev − Shopify − returns allowance.</b> Landed COGS comes from Airtable: (FOB + duty + inbound freight) × an overhead factor.</span>} />
                  <Th label="OPEX" sign="-" group="cost" divider col="opex" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    cap="% of sales"
                    tip="A percentage of sales, set in Margin settings. It sits at zero until the owner supplies the number, which is why CM2 currently equals CM1." />
                  <Th label="Fulfillment" sign="-" group="cost" col="fulfillment" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    cap={config?.fulfillment_mode === "percent" ? "% of sales" : config?.fulfillment_mode === "per_order" ? "$ per order" : "$ per unit"}
                    tip="A fixed amount, with a toggle in Margin settings to charge it per unit, per order, or as a percentage of sales." />
                  <Th label="CM2" group="cm" col="cm2" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    cap="after opex & fulfillment"
                    tip={<span><b>CM1 − OPEX − fulfillment.</b> Both are set in Margin settings; while they sit at zero, CM2 equals CM1.</span>} />
                  <Th label="Marketing" sign="-" group="cost" divider col="marketing" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    cap={config ? `${config.marketing_pct}% of sales` : undefined}
                    tip="A percentage of sales, editable in Margin settings." />
                  <Th label="CM3" group="cm" col="cm3" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                    cap="after marketing"
                    tip={<span><b>CM2 − marketing.</b> The rate is editable in Margin settings.</span>} />
                </tr>
              </thead>
              <tbody>
                {cmLoading ? (
                  <tr><td colSpan={17} className="py-16 text-center text-sm text-muted-foreground">Loading products…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={17} className="py-16 text-center text-sm text-muted-foreground">No sales in this period.</td></tr>
                ) : rows.map((r, idx) => {
                  const name = nameMap?.get(r.sku)?.name ?? "";
                  const noCost = !r.cogs;
                  return (
                    <tr key={r.sku} className={cn("hover:bg-muted/40", idx % 2 === 1 && "bg-muted/20")}>
                      <td className={cn("sticky left-0 z-[5] bg-background px-3 py-3 text-[12.5px] whitespace-nowrap border-b border-border/60 shadow-[1px_0_0_hsl(var(--border))]")}>
                        <div className="flex items-center gap-2.5">
                          <ProductImage productId={r.sku} productName={name || r.sku} readOnly />
                          <div className="min-w-0 max-w-[240px]">
                            <div className="truncate text-[12.5px] font-semibold text-foreground" title={r.sku}>{r.sku}</div>
                            <div className="truncate text-[11px] text-muted-foreground" title={name}>{name}</div>
                          </div>
                        </div>
                      </td>
                      <td className={td}>{int(r.units)}</td>
                      <td className={cn(td, r.returned_qty > 0 ? "text-red-600" : "text-muted-foreground")}>{int(r.returned_qty)}</td>
                      <td className={cn(td, "font-semibold")}>{money(r.sales)}</td>
                      <td className={cn(td, r.gross_profit >= 0 ? "text-emerald-700" : "text-red-600")}>{money(r.gross_profit)}</td>
                      <td className={cn(td, r.net_profit >= 0 ? "text-emerald-700" : "text-red-600")}>{money(r.net_profit)}</td>
                      <td className={cn(td, noCost ? "text-muted-foreground/60 font-normal" : "font-medium")} title={noCost ? "No cost data" : undefined}>{pct1(r.margin_pct)}</td>
                      <td className={cn(tdCost, SEP)}>{money(r.landed_cogs_total)}</td>
                      <td className={cn(tdCm, "text-teal-700")}>{money(r.shipping_revenue)}</td>
                      <td className={tdCost}>{money(r.shopify_fee)}</td>
                      <td className={tdCost}>{money(r.returns_allowance)}</td>
                      <td className={tdCm}>{cmCell(r.cm1, r.cm1_pct)}</td>
                      <td className={cn(tdCost, SEP)}>{money(r.opex)}</td>
                      <td className={tdCost}>{money(r.fulfillment)}</td>
                      <td className={tdCm}>{cmCell(r.cm2, r.cm2_pct)}</td>
                      <td className={cn(tdCost, SEP)}>{money(r.marketing)}</td>
                      <td className={tdCm}>{cmCell(r.cm3, r.cm3_pct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <MarginSettingsPanel open={panelOpen} onOpenChange={setPanelOpen} />
    </div>
    </TooltipProvider>
  );
}
