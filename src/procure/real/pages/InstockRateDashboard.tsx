import React, { useMemo } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useForecastInstockYearly, segmentOf, type InstockYearRow } from "@/hooks/useForecastInstockYearly";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, RefreshCw, Info } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine,
} from "recharts";

const TARGET = 90;

const YEAR_OPTIONS = ["2025", "2026", "2027", "2028", "2029", "2030"];

// Fixed segment colors — status (pula/amber/berde) ay hiwalay sa series colors.
const COLORS = { est: "#0f766e", new: "#d97706", good: "#16a34a", warn: "#b45309", crit: "#dc2626" } as const;

const MONTH_COLS: { key: keyof InstockYearRow; label: string }[] = [
  { key: "jan", label: "Jan" }, { key: "feb", label: "Feb" }, { key: "mar", label: "Mar" },
  { key: "apr", label: "Apr" }, { key: "may", label: "May" }, { key: "jun", label: "Jun" },
  { key: "jul", label: "Jul" }, { key: "aug", label: "Aug" }, { key: "sep", label: "Sep" },
  { key: "oct", label: "Oct" }, { key: "nov", label: "Nov" }, { key: "dec", label: "Dec" },
];

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

type MonthAgg = { key: string; name: string; value: number; hasData: boolean };

// Average bawat buwan sa segment — kasama ang naka-0%, laktawan lang ang NULL.
function aggregateMonthly(rows: InstockYearRow[]): MonthAgg[] {
  return MONTH_COLS.map((col) => {
    let sum = 0, count = 0;
    for (const r of rows) {
      const v = num(r[col.key]);
      if (v !== null) { sum += v; count += 1; }
    }
    const avg = count > 0 ? sum / count : 0;
    return { key: String(col.key), name: col.label, value: avg, hasData: count > 0 && avg > 0 };
  });
}

type Insight = {
  first: MonthAgg; last: MonthAgg; lastIdx: number;
  deltaPts: number; gapPts: number; onTarget: number; total: number;
  momPts: number | null;
  dir: "up" | "down" | "flat"; onTrack: boolean;
};

function buildInsight(monthly: MonthAgg[]): Insight | null {
  const withData = monthly.map((m, i) => ({ ...m, i })).filter((m) => m.hasData);
  if (withData.length < 1) return null;
  const first = withData[0];
  const last = withData[withData.length - 1];
  const prev = withData.length > 1 ? withData[withData.length - 2] : null;
  const deltaPts = last.value - first.value;
  return {
    first, last, lastIdx: last.i,
    deltaPts,
    gapPts: last.value - TARGET,
    onTarget: withData.filter((m) => m.value >= TARGET).length,
    total: withData.length,
    momPts: prev ? last.value - prev.value : null,
    dir: deltaPts <= -2 ? "down" : deltaPts >= 2 ? "up" : "flat",
    onTrack: last.value >= TARGET,
  };
}

const METHOD_NOTE =
  "Each month = average in-stock % across ALL SKUs in the segment, including items at 0% (out of stock the whole month). " +
  "Months with no data show '—'. This is stricter than a spreadsheet average, which skips blanks.";

export default function InstockRateDashboard() {
  const [year, setYear] = usePersistedState<string>("instock_rate_year", "2026");
  const activeYear = YEAR_OPTIONS.includes(year) ? year : "2026";

  const { data: allRows = [], isLoading, isFetching, refetch } = useForecastInstockYearly(activeYear);

  const today = useMemo(() => new Date(), []);
  const segmented = useMemo(() => {
    const est: InstockYearRow[] = [], nw: InstockYearRow[] = [], never: InstockYearRow[] = [];
    for (const r of allRows) {
      const s = segmentOf(r, today);
      if (s === "established") est.push(r);
      else if (s === "new_item") nw.push(r);
      else never.push(r);
    }
    return { est, nw, never };
  }, [allRows, today]);

  const estMonthly = useMemo(() => aggregateMonthly(segmented.est), [segmented.est]);
  const newMonthly = useMemo(() => aggregateMonthly(segmented.nw), [segmented.nw]);
  const estIns = useMemo(() => buildInsight(estMonthly), [estMonthly]);
  const newIns = useMemo(() => buildInsight(newMonthly), [newMonthly]);

  const estAvg = useMemo(() => yearAvg(estMonthly), [estMonthly]);
  const newAvg = useMemo(() => yearAvg(newMonthly), [newMonthly]);

  // Huling buwan na may data sa alinmang segment = "ngayon".
  const nowIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < MONTH_COLS.length; i++) if (estMonthly[i].hasData || newMonthly[i].hasData) idx = i;
    return idx;
  }, [estMonthly, newMonthly]);

  // "X / Y buwan ang pumasa" — buwan na umabot sa 90% ang KAHIT ISANG segment.
  const passfail = useMemo(() => {
    let total = 0, passed = 0;
    for (let i = 0; i < MONTH_COLS.length; i++) {
      const e = estMonthly[i], n = newMonthly[i];
      if (!e.hasData && !n.hasData) continue;
      total += 1;
      if ((e.hasData && e.value >= TARGET) || (n.hasData && n.value >= TARGET)) passed += 1;
    }
    const best = Math.max(...estMonthly.filter(m => m.hasData).map(m => m.value), ...newMonthly.filter(m => m.hasData).map(m => m.value), 0);
    return { total, passed, best };
  }, [estMonthly, newMonthly]);

  const chartData = useMemo(() =>
    MONTH_COLS.slice(0, nowIdx + 1).map((c, i) => ({
      name: c.label,
      est: estMonthly[i].hasData ? Number(estMonthly[i].value.toFixed(1)) : null,
      nw: newMonthly[i].hasData ? Number(newMonthly[i].value.toFixed(1)) : null,
    })), [estMonthly, newMonthly, nowIdx]);

  // Callouts — auto-computed.
  const callouts = useMemo(() => {
    const out: { tone: "red" | "amber" | "teal"; title: string; body: string }[] = [];
    const estData = estMonthly.filter(m => m.hasData);
    if (estData.length) {
      const lowest = estData.reduce((a, b) => (b.value < a.value ? b : a));
      out.push({
        tone: "red",
        title: `Established's lowest month: ${lowest.name}`,
        body: `Dropped to ${Math.round(lowest.value)}% — roughly ${Math.round(100 - lowest.value)}% of long-established products had no stock that month.`,
      });
    }
    let crossIdx: number | null = null;
    for (let i = 0; i <= nowIdx; i++) {
      if (estMonthly[i].hasData && newMonthly[i].hasData && newMonthly[i].value > estMonthly[i].value) { crossIdx = i; break; }
    }
    if (crossIdx !== null) {
      out.push({
        tone: "amber",
        title: `New Items overtook Established (${MONTH_COLS[crossIdx].label})`,
        body: `New SKUs are now better stocked than the long-established ones — good news for the new items, but a sign that replenishment of the older products needs attention.`,
      });
    }
    if (newIns) {
      out.push({
        tone: "teal",
        title: `New Items ${newIns.deltaPts >= 0 ? "▲ +" : "▼ "}${Math.round(newIns.deltaPts)} pts since ${newIns.first.name}`,
        body: `From ${Math.round(newIns.first.value)}% → ${Math.round(newIns.last.value)}% — ${newIns.deltaPts >= 0 ? "the ramp-up of new SKUs is working." : "new SKU supply needs another look."}`,
      });
    }
    return out;
  }, [estMonthly, newMonthly, newIns, nowIdx]);

  const nowLabel = nowIdx >= 0 ? MONTH_COLS[nowIdx].label : "";

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden min-h-0" style={{ backgroundColor: "#FBF9F6" }}>
      {/* Header */}
      <header className="h-14 shrink-0 border-b border-border bg-gradient-to-r from-primary/5 to-background">
        <div className="h-full px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <BarChart3 className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-foreground leading-tight truncate">Availability Score</h1>
                <p className="text-[11px] text-muted-foreground truncate">
                  {allRows.length.toLocaleString()} SKUs · {activeYear}
                </p>
              </div>
            </div>
            {!isLoading && segmented.never.length > 0 && (
              <span
                className="ml-1 hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                style={{ borderColor: "#ECE6DD", backgroundColor: "#F3EFEA" }}
                title="SKUs that have never arrived (no first arrival date) — counted in the total but excluded from the charts."
              >
                {segmented.never.length.toLocaleString()} never arrived
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Select value={activeYear} onValueChange={setYear}>
              <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                {YEAR_OPTIONS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => refetch()} disabled={isFetching} title="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-48 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        ) : allRows.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center" style={{ backgroundColor: "#FCFBF9", borderColor: "#ECE6DD" }}>
            <p className="text-sm font-semibold text-foreground">No data yet for {activeYear}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The loader has not written forecast_instock_yearly rows for this year — or the app's read policy is not applied yet.
            </p>
          </div>
        ) : (
          <>
            {/* ── Nasaan tayo ngayon ── */}
            <SectionHead
              title={`Where we are now${nowLabel ? ` — ${nowLabel}` : ""}`}
              sub="The bar shows how far each segment is from the 90% target. When the color reaches the red line, it passes."
              info={METHOD_NOTE}
            />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <MeterCard label="Established" subLabel={`${segmented.est.length.toLocaleString()} SKUs — arrived more than 120 days ago`} color={COLORS.est} insight={estIns} avg={estAvg} />
              <MeterCard label="New Items" subLabel={`${segmented.nw.length.toLocaleString()} SKUs — arrived within the last 120 days`} color={COLORS.new} insight={newIns} avg={newAvg} />
              <div className="rounded-2xl border p-6 flex flex-col justify-center" style={{ backgroundColor: "#FCFBF9", borderColor: "#ECE6DD" }}>
                <div className="text-3xl font-extrabold tracking-tight tabular-nums leading-tight">
                  <span style={{ color: passfail.passed > 0 ? COLORS.good : COLORS.crit }}>{passfail.passed} / {passfail.total}</span>
                  <span className="block text-xl">months hit the target</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {passfail.passed === 0
                    ? <>No month in {activeYear} has reached {TARGET}% yet — in either segment. Closest so far: {Math.round(passfail.best)}%.</>
                    : <>{passfail.passed} {passfail.passed === 1 ? "month has" : "months have"} reached the {TARGET}% target.</>}
                </p>
              </div>
            </div>

            {/* ── Buwan-buwan ── */}
            <SectionHead title="Month by month" sub="Each card is one month. The ▲▼ shows the change vs the previous month. The current month is highlighted." />
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5">
              {MONTH_COLS.slice(0, Math.max(nowIdx + 1, 0)).map((c, i) => (
                <MonthCard
                  key={c.label}
                  name={c.label}
                  isNow={i === nowIdx}
                  est={estMonthly[i]} estPrev={i > 0 ? estMonthly[i - 1] : null}
                  nw={newMonthly[i]} nwPrev={i > 0 ? newMonthly[i - 1] : null}
                />
              ))}
            </div>

            {/* ── Trend ── */}
            <SectionHead title="The year so far" sub="A compact trend — the detail lives in the cards above." />
            <div className="rounded-2xl border p-5" style={{ backgroundColor: "#FCFBF9", borderColor: "#ECE6DD" }}>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                <span className="text-sm font-bold text-foreground">In-stock % · {chartData.length ? `${chartData[0].name}–${chartData[chartData.length - 1].name}` : ""} {activeYear}</span>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className="h-1 w-3.5 rounded" style={{ backgroundColor: COLORS.est }} /> Established</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-1 w-3.5 rounded" style={{ backgroundColor: COLORS.new }} /> New Items</span>
                  <span className="inline-flex items-center gap-1.5" style={{ color: COLORS.crit }}>- - Target {TARGET}%</span>
                </div>
              </div>
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 14, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#EDE7DE" vertical={false} />
                    <XAxis dataKey="name" stroke="#9CA3AF" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval={0} />
                    <YAxis domain={[0, 100]} ticks={[0, 50, 90, 100]} stroke="#9CA3AF" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} width={40} />
                    <Tooltip
                      formatter={(v: any, key: any) => [`${Number(v).toFixed(1)}%`, key === "est" ? "Established" : "New Items"]}
                      contentStyle={{ borderRadius: 10, border: "1px solid #ECE6DD", fontSize: 12 }}
                    />
                    <ReferenceLine y={TARGET} stroke={COLORS.crit} strokeDasharray="5 4" strokeWidth={1.5} />
                    <Line type="monotone" dataKey="est" stroke={COLORS.est} strokeWidth={2.5} connectNulls={false} dot={{ r: 3, fill: COLORS.est, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="nw" stroke={COLORS.new} strokeWidth={2.5} connectNulls={false} dot={{ r: 3, fill: COLORS.new, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── Callouts ── */}
            {callouts.length > 0 && (
              <>
                <SectionHead title="Worth noting" sub="Auto-computed from the data — this updates on every refresh." />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-2">
                  {callouts.map((c, i) => (
                    <div key={i} className="rounded-2xl border p-5 border-l-4"
                      style={{ backgroundColor: "#FCFBF9", borderColor: "#ECE6DD", borderLeftColor: c.tone === "red" ? COLORS.crit : c.tone === "amber" ? COLORS.new : COLORS.est }}>
                      <p className="text-sm font-bold text-foreground">{c.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{c.body}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            <p className="mt-6 text-[11px] text-muted-foreground">
              Data: forecast_instock_yearly · {activeYear} · Segments derived from first arrival date (New = last 120 days) ·
              Averages include items at 0% (out of stock the whole month).
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function yearAvg(monthly: MonthAgg[]): number {
  const withData = monthly.filter((m) => m.hasData);
  if (!withData.length) return 0;
  return withData.reduce((s, m) => s + m.value, 0) / withData.length;
}

function SectionHead({ title, sub, info }: { title: string; sub: string; info?: string }) {
  return (
    <div className="mt-7 mb-3 first:mt-0">
      <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
        {title}
        {info && <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0"><title>{info}</title></Info>}
      </h2>
      <p className="text-xs text-muted-foreground mt-0.5 max-w-3xl">{sub}</p>
    </div>
  );
}

function MeterCard({ label, subLabel, color, insight, avg }: {
  label: string; subLabel: string; color: string;
  insight: ReturnType<typeof buildInsight>; avg: number;
}) {
  const pill = insight
    ? insight.onTrack
      ? { text: "On target", bg: "rgba(22,163,74,.10)", fg: COLORS.good }
      : insight.dir === "down"
        ? { text: "Declining", bg: "rgba(220,38,38,.09)", fg: COLORS.crit }
        : insight.dir === "up"
          ? { text: "Improving", bg: "rgba(180,83,9,.12)", fg: COLORS.warn }
          : { text: "Below target", bg: "rgba(180,83,9,.12)", fg: COLORS.warn }
    : null;
  const now = insight ? Math.round(insight.last.value) : null;
  return (
    <div className="rounded-2xl border p-6" style={{ backgroundColor: "#FCFBF9", borderColor: "#ECE6DD" }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="inline-flex items-center gap-2 text-sm font-bold text-foreground">
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          {label}
        </span>
        {pill && <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full" style={{ backgroundColor: pill.bg, color: pill.fg }}>{pill.text}</span>}
      </div>
      <p className="text-[11px] text-muted-foreground mt-0.5">{subLabel}</p>
      <div className="mt-3 text-[44px] leading-none font-extrabold tracking-tight tabular-nums text-foreground">
        {now === null ? "—" : <>{now}<span className="text-base font-semibold text-muted-foreground">% · {insight!.last.name}</span></>}
      </div>
      {insight && (
        <p className="mt-1.5 text-xs font-medium tabular-nums text-muted-foreground">
          {insight.momPts !== null && (
            <span style={{ color: insight.momPts >= 0 ? COLORS.good : COLORS.crit }}>
              {insight.momPts >= 0 ? "▲ +" : "▼ "}{Math.round(insight.momPts)} pts vs previous month
            </span>
          )}
          {insight.momPts !== null && " · "}
          <span style={{ color: insight.deltaPts >= 0 ? COLORS.good : COLORS.crit }}>
            {insight.deltaPts >= 0 ? "▲ +" : "▼ "}{Math.round(insight.deltaPts)} pts since {insight.first.name}
          </span>
        </p>
      )}
      {/* Meter papunta sa 90% */}
      <div className="relative h-3.5 rounded-full mt-6 mb-2" style={{ backgroundColor: "#ECE7DD" }}>
        {now !== null && (
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(now, 100)}%`, backgroundColor: color }} />
        )}
        <div className="absolute -top-1 -bottom-1 w-0.5" style={{ left: "90%", backgroundColor: COLORS.crit }}>
          <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-bold" style={{ color: COLORS.crit }}>90%</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {insight
          ? <><b className="text-foreground">{Math.max(0, Math.round(TARGET - insight.last.value))} pts</b> short of the {TARGET}% target · Avg <b className="text-foreground">{avg.toFixed(1)}%</b> this year</>
          : "No data yet."}
      </p>
    </div>
  );
}

function MonthCard({ name, isNow, est, estPrev, nw, nwPrev }: {
  name: string; isNow: boolean;
  est: MonthAgg; estPrev: MonthAgg | null;
  nw: MonthAgg; nwPrev: MonthAgg | null;
}) {
  const delta = (m: MonthAgg, p: MonthAgg | null) => {
    if (!m.hasData || !p || !p.hasData) return null;
    return Math.round(m.value) - Math.round(p.value);
  };
  const dEst = delta(est, estPrev), dNw = delta(nw, nwPrev);
  const DeltaTag = ({ d }: { d: number | null }) =>
    d === null ? null : d === 0
      ? <span className="text-[10px] font-medium text-muted-foreground">＝0</span>
      : <span className="text-[10px] font-bold tabular-nums" style={{ color: d > 0 ? COLORS.good : COLORS.crit }}>{d > 0 ? `▲+${d}` : `▼${d}`}</span>;
  return (
    <div className="rounded-xl border p-3"
      style={{ backgroundColor: "#FCFBF9", borderColor: isNow ? COLORS.est : "#ECE6DD", boxShadow: isNow ? `0 0 0 2px rgba(15,118,110,.12)` : undefined }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{name}</span>
        {isNow && <span className="text-[8px] font-extrabold px-1.5 py-0.5 rounded-full" style={{ color: COLORS.est, backgroundColor: "rgba(15,118,110,.10)" }}>NOW</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COLORS.est }} /> Estab
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-base font-bold tabular-nums text-foreground">{est.hasData ? `${Math.round(est.value)}%` : "—"}</span>
        <DeltaTag d={dEst} />
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COLORS.new }} /> New
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-base font-bold tabular-nums text-foreground">{nw.hasData ? `${Math.round(nw.value)}%` : "—"}</span>
        <DeltaTag d={dNw} />
      </div>
    </div>
  );
}
