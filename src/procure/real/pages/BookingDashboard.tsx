import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { OrderDashboardTabs, type TabGroup } from "@/components/shared/OrderDashboardTabs";
import { cn } from "@/lib/utils";
import { Anchor } from "lucide-react";

type Props = { tabGroup?: TabGroup; title?: string };
interface SRRow { booked: boolean; factory: string; carrier: string; crd: number | null; pol: string; cbm: number | null; contact: string; ref: string; }
const RECENT_WINDOW = 180 * 86400000; // carrier panel looks back this far (carrier is filled days after booking)

const DAY = 86400000;
const ORANGE = "#c2410c", GREEN = "#15803d", RED = "#b91c1c", NAVY = "#0b2239", AMBER = "#d97706";
function startOfWeek(t: number) { const x = new Date(t); const off = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); return x.getTime() - off * DAY; }
const fmtShort = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtLong = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtRange = (a: number, b: number) => `${new Date(a).toLocaleDateString("en-US", { month: "short", day: "numeric" })}–${new Date(b).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
const daysLabel = (d: number) => d < 0 ? `${Math.abs(d)} days late` : d === 0 ? "Due today" : `In ${d} days`;
const txt = (v: unknown) => String(v ?? "").trim();
function parseDate(s: string): number | null {
  if (!s) return null;
  const iso = new Date(s).getTime();
  if (Number.isFinite(iso) && /\d{4}-\d{2}-\d{2}/.test(s)) return iso;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) { let [, a, b, y] = m; if (y.length === 2) y = "20" + y; if (+a <= 12) { const t = new Date(+y, +a - 1, +b).getTime(); if (Number.isFinite(t)) return t; } const t2 = new Date(+y, +b - 1, +a).getTime(); if (Number.isFinite(t2)) return t2; }
  return Number.isFinite(iso) ? iso : null;
}

function useShippingRows(enabled: boolean) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["booking_dashboard:shipping_requests"], enabled, staleTime: 60 * 1000, refetchOnWindowFocus: false,
    queryFn: async () => {
      const CHUNK = 1000; const all: Record<string, unknown>[] = []; let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase.from("shipping_requests").select("booking_number,freight_carrier,factory_short_name,full_factory_name,cargo_ready_date,invoice_tracker_id,port_of_loading,cargo_volume_cbm,booking_info_contact,ref_calculated,record_id,id").range(from, from + CHUNK - 1);
        if (error) throw error;
        const rows = (data || []) as Record<string, unknown>[]; all.push(...rows);
        if (rows.length < CHUNK) break; from += CHUNK;
      }
      return all;
    },
  });
  useEffect(() => {
    if (!enabled) return;
    const ch = supabase.channel("booking_dashboard_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "shipping_requests" },
        () => qc.invalidateQueries({ queryKey: ["booking_dashboard:shipping_requests"] })).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled, qc]);
  return q;
}

export default function BookingDashboard({ tabGroup = "finance", title = "Booking Board" }: Props) {
  const [period, setPeriod] = useState<"week" | "next7">("week");
  const { data: raw = [], isLoading } = useShippingRows(true);
  const qc = useQueryClient();

  // Daily roll-over: the date math (overdue, days-late, this-week scope) is
  // derived from "today", so when the tab stays open past midnight we bump a
  // dayKey to recompute it AND refetch fresh rows — keeps the board current daily.
  const [dayKey, setDayKey] = useState(() => new Date().toDateString());
  const dayRef = useRef(dayKey);
  useEffect(() => {
    const id = setInterval(() => {
      const k = new Date().toDateString();
      if (k !== dayRef.current) {
        dayRef.current = k;
        setDayKey(k);
        qc.invalidateQueries({ queryKey: ["booking_dashboard:shipping_requests"] });
        qc.invalidateQueries({ queryKey: ["booking_dashboard:invoice_carriers"] });
      }
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [qc]);

  // Carrier is sparsely filled on shipping_requests (freight_carrier) and entered
  // days after booking; invoice_tracker.carrier is the fuller secondary source.
  const { data: invRaw = [] } = useQuery({
    queryKey: ["booking_dashboard:invoice_carriers"], staleTime: 60 * 1000, refetchOnWindowFocus: false,
    queryFn: async () => {
      const CHUNK = 1000; const all: Record<string, unknown>[] = []; let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase.from("invoice_tracker").select("id,carrier").range(from, from + CHUNK - 1);
        if (error) throw error;
        const rs = (data || []) as Record<string, unknown>[]; all.push(...rs);
        if (rs.length < CHUNK) break; from += CHUNK;
      }
      return all;
    },
  });
  const carrierById = useMemo(() => { const m = new Map<string, string>(); for (const r of invRaw) { const id = txt(r.id), car = txt(r.carrier); if (id && car) m.set(id, car); } return m; }, [invRaw]);

  const rows = useMemo<SRRow[]>(() => raw.map(r => ({
    booked: txt(r.booking_number) !== "",
    factory: txt(r.factory_short_name) || txt(r.full_factory_name) || "Unknown",
    carrier: txt(r.freight_carrier) || carrierById.get(txt(r.invoice_tracker_id)) || "Unassigned",
    crd: parseDate(txt(r.cargo_ready_date)),
    pol: txt(r.port_of_loading) || "Unspecified",
    cbm: Number(r.cargo_volume_cbm) || null,
    contact: txt(r.booking_info_contact),
    ref: txt(r.ref_calculated) || txt(r.record_id) || txt(r.id) || "—",
  })), [raw, carrierById]);

  const c = useMemo(() => {
    const now = Date.now(), wkStart = startOfWeek(now), wkEnd = wkStart + 7 * DAY;
    const today = new Date(); today.setHours(0, 0, 0, 0); const today0 = today.getTime();
    const inScope = (crd: number | null) => crd != null && (period === "week" ? crd >= wkStart && crd < wkEnd : crd >= now && crd < now + 7 * DAY);
    const OVERDUE_WINDOW = 30 * DAY;

    let ready = 0, booked = 0, overdue = 0, cargoReady = 0;
    const byFac = new Map<string, { waiting: number; booked: number }>();
    const byCar = new Map<string, number>(); // booked containers per carrier (recent window, not week-scoped)
    const aging = { overdue: 0, d03: 0, d47: 0, booked: 0 };
    const queue: (SRRow & { days: number; over: boolean })[] = [];

    for (const r of rows) {
      const isOver = !r.booked && r.crd != null && r.crd < today0 && r.crd >= today0 - OVERDUE_WINDOW;
      if (inScope(r.crd)) {
        cargoReady++;
        const f = byFac.get(r.factory) ?? { waiting: 0, booked: 0 };
        if (r.booked) { booked++; f.booked++; aging.booked++; }
        else {
          ready++; f.waiting++;
          const d = Math.round((r.crd! - today0) / DAY);
          if (d < 0) aging.overdue++; else if (d <= 3) aging.d03++; else aging.d47++;
        }
        byFac.set(r.factory, f);
      }
      if (isOver) overdue++;
      // action queue: anything unbooked that's in-scope OR recently overdue → "book this now"
      if (!r.booked && ((inScope(r.crd)) || isOver)) queue.push({ ...r, days: r.crd != null ? Math.round((r.crd - today0) / DAY) : 0, over: isOver });
      // carrier mix: booked w/ known carrier, CRD within recent window (carrier fills late)
      if (r.booked && r.carrier !== "Unassigned" && r.crd != null && r.crd >= today0 - RECENT_WINDOW && r.crd < now + 14 * DAY) byCar.set(r.carrier, (byCar.get(r.carrier) ?? 0) + 1);
    }

    const factories = Array.from(byFac.entries()).map(([n, v]) => ({ n, ...v, tot: v.waiting + v.booked })).sort((a, b) => b.waiting - a.waiting || b.tot - a.tot);
    const carriers = Array.from(byCar.entries()).map(([n, v]) => ({ n, v })).sort((a, b) => b.v - a.v);
    queue.sort((a, b) => (a.crd ?? Infinity) - (b.crd ?? Infinity)); // most-overdue first

    const weeks: { label: string; date: string; waiting: number; booked: number; tot: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const s = wkStart - i * 7 * DAY, e = s + 7 * DAY; let bk = 0, wt = 0;
      for (const r of rows) if (r.crd != null && r.crd >= s && r.crd < e) (r.booked ? bk++ : wt++);
      weeks.push({ label: fmtShort(s), date: fmtShort(s), waiting: wt, booked: bk, tot: bk + wt });
    }
    return { ready, booked, overdue, cargoReady, factories, carriers, weeks, wkStart, wkEnd, aging, queue };
  }, [rows, period, dayKey]); // dayKey → recompute date math on daily roll-over

  const maxFac = Math.max(1, ...c.factories.map(f => f.tot));
  const maxCar = Math.max(1, ...c.carriers.map(x => x.v));
  const maxWk = Math.max(1, ...c.weeks.map(w => w.tot));
  // Trend-line points (viewBox 0–100): x = bar center, y = total height inverted.
  const wkLinePts = c.weeks.map((w, i) => `${((i + 0.5) / c.weeks.length * 100).toFixed(2)},${((1 - w.tot / maxWk) * 100).toFixed(2)}`).join(" ");
  const clearedPct = c.ready + c.booked ? Math.round(c.booked / (c.ready + c.booked) * 100) : 0;

  return (
    <div className="flex h-screen w-full flex-col bg-[#f6f7f9] overflow-hidden min-h-0">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-slate-200 bg-white px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 h-4" />
        <span className="text-[13px] font-semibold tracking-tight text-slate-800">{title}</span>
        <span className="text-[13px] text-slate-300">/</span>
        <span className="text-[13px] text-slate-400">Dashboard</span>
      </header>

      {isLoading ? (
        <div className="space-y-2 p-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="w-full space-y-6 px-8 py-6">
            {/* title row */}
            <div className="flex flex-wrap items-start gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#0b2239] text-white shadow-sm ring-1 ring-inset ring-white/10">
                <Anchor className="h-5 w-5" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Logistics · Booking operations</p>
                <h1 className="mt-1 text-[22px] font-bold leading-tight tracking-tight text-slate-900">Booking Board</h1>
                <p className="mt-1 text-[13px] text-slate-500">Week of {fmtRange(c.wkStart, c.wkEnd - DAY)} · ready = cargo-ready with no booking #, booked = booking # assigned</p>
              </div>
              <div className="ml-auto flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
                {([["week", "This week"], ["next7", "Next 7 days"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setPeriod(k)} className={cn("rounded-md px-4 py-1.5 text-[13px] font-semibold transition", period === k ? "bg-[#0b2239] text-white shadow-sm" : "text-slate-500 hover:text-slate-700")}>{l}</button>
                ))}
              </div>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
              <Kpi color={ORANGE} label="Ready for booking" value={c.ready} sub={`of ${c.cargoReady} cargo-ready this week`} barPct={c.cargoReady ? c.ready / c.cargoReady * 100 : 0} barColor={ORANGE} />
              <Kpi color={GREEN} label="Booked this week" value={c.booked} sub={`${clearedPct}% of ready containers cleared`} />
              <Kpi color={RED} label="Overdue (CRD passed)" value={c.overdue} sub="still unbooked past cargo-ready date" />
              <Kpi color={NAVY} label="Total cargo-ready" value={c.cargoReady} sub="containers in scope this week" />
            </div>

            {/* two panels */}
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Needs booking — by Factory" sub="Who still has containers waiting · this week" legend={<><Lg c="bg-[#c2410c]" t="Needs booking" /><Lg c="bg-[#15803d]" t="Booked" /></>}>
                {c.factories.length === 0 ? <Empty /> : <div className="space-y-3 pt-1">{c.factories.map(f => (
                  <div key={f.n} className="group relative grid grid-cols-[52px_1fr_92px] items-center gap-3">
                    <BarTip title={f.n} rows={[
                      { label: "Needs booking", value: f.waiting, color: ORANGE },
                      { label: "Booked", value: f.booked, color: GREEN },
                      { label: "Total", value: `${f.tot} · ${f.tot ? Math.round(f.booked / f.tot * 100) : 0}% booked` },
                    ]} />
                    <span className="text-right text-[13px] font-bold text-slate-700">{f.n}</span>
                    <div className="flex h-7 items-center">
                      <div className="flex h-7 cursor-default overflow-hidden rounded transition-[filter] hover:brightness-110" style={{ width: `${Math.max(f.tot / maxFac * 100, 4)}%` }}>
                        {f.waiting > 0 && <Seg v={f.waiting} grow={f.waiting} bg={ORANGE} />}
                        {f.booked > 0 && <Seg v={f.booked} grow={f.booked} bg={GREEN} />}
                      </div>
                    </div>
                    <span className="text-[11.5px] leading-tight text-slate-500"><b className="text-slate-700">{f.waiting}</b> waiting · <b className="text-slate-700">{f.booked}</b> booked</span>
                  </div>
                ))}</div>}
              </Panel>

              <Panel title="Booked — by Carrier" sub="Freight carrier mix · booked, last 6 months" legend={<Lg c="bg-[#15803d]" t="Booked" />}>
                {c.carriers.length === 0 ? <p className="py-10 text-center text-[13px] text-slate-400">No carrier recorded in the last 6 months.<br /><span className="text-[11px]">Carrier is entered in Dispatch Requests / Freight Bills after booking.</span></p> : <div className="space-y-3 pt-1">{c.carriers.map(x => (
                  <div key={x.n} className="group relative grid grid-cols-[80px_1fr_72px] items-center gap-3">
                    <BarTip title={x.n} rows={[
                      { label: "Booked", value: x.v, color: GREEN },
                      { label: "Last 6 months", value: `${x.v} container${x.v === 1 ? "" : "s"}` },
                    ]} />
                    <span className="truncate text-right text-[13px] font-bold text-slate-700">{x.n}</span>
                    <div className="flex h-7 items-center">
                      <div className="flex h-7 cursor-default overflow-hidden rounded transition-[filter] hover:brightness-110" style={{ width: `${Math.max(x.v / maxCar * 100, 6)}%` }}><Seg v={x.v} grow={1} bg={GREEN} /></div>
                    </div>
                    <span className="text-[11.5px] text-slate-500"><b className="text-slate-700">{x.v}</b> booked</span>
                  </div>
                ))}</div>}
              </Panel>
            </div>

            {/* weekly tally + backlog by urgency — side by side to use the wide space */}
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Weekly tally — ready vs booked" sub="Container booking flow over the last 12 weeks" legend={<><Lg c="bg-[#c2410c]" t="Needs booking" /><Lg c="bg-[#15803d]" t="Booked" /></>}>
                <div className="relative pt-4">
                  {/* trend line connecting weekly totals — overlays the bars, aligned via gap-0 */}
                  <svg className="pointer-events-none absolute inset-x-0 top-4 z-10" style={{ height: 180 }} width="100%" height="180" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                    <polyline points={wkLinePts} fill="none" stroke={NAVY} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.85} />
                  </svg>
                  <div className="flex w-full items-end gap-0">
                  {c.weeks.map((w, i) => (
                    <div key={i} className="group relative flex flex-1 flex-col items-center gap-2">
                      <div className="relative flex w-full justify-center" style={{ height: 180 }}>
                        <div className="absolute bottom-0 flex w-full max-w-[40px] cursor-default flex-col overflow-hidden rounded-t-md transition-[filter] group-hover:brightness-110" style={{ height: `${w.tot / maxWk * 100}%` }}>
                          <div style={{ background: ORANGE, flexGrow: w.waiting || 0.0001 }} />
                          <div style={{ background: GREEN, flexGrow: w.booked || 0.0001 }} />
                        </div>
                        {/* trend dot at the total-top — crisp circle, exactly on the line */}
                        <div className="pointer-events-none absolute left-1/2 z-20 h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white" style={{ bottom: `${w.tot / maxWk * 100}%`, background: NAVY }} />
                        {/* hover card — data for this week, fires instantly on bar hover */}
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max -translate-x-1/2 scale-95 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left opacity-0 shadow-lg transition-all duration-150 group-hover:scale-100 group-hover:opacity-100">
                          <div className="text-[12px] font-bold text-slate-800">Week of {w.date}</div>
                          <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: ORANGE }} />Needs booking <b className="ml-auto tabular-nums text-slate-800">{w.waiting}</b></div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: GREEN }} />Booked <b className="ml-auto tabular-nums text-slate-800">{w.booked}</b></div>
                          <div className="mt-1 border-t border-slate-100 pt-1 text-[11.5px] text-slate-500">Total <b className="tabular-nums text-slate-800">{w.tot}</b> · {w.tot ? Math.round(w.booked / w.tot * 100) : 0}% booked</div>
                        </div>
                      </div>
                      <div className="text-[13px] font-bold tabular-nums text-slate-800">{w.tot}</div>
                      <div className="whitespace-nowrap text-[10px] text-slate-400">{w.date}</div>
                    </div>
                  ))}
                  </div>
                </div>
              </Panel>

              <Panel title="Backlog by urgency" sub="Unbooked containers by how close they are to cargo-ready — clear red first">
                {(() => {
                  const tiers = [
                    { t: "Overdue — CRD passed", v: c.aging.overdue, col: RED },
                    { t: "Due in 0–3 days", v: c.aging.d03, col: ORANGE },
                    { t: "Due in 4–7 days", v: c.aging.d47, col: AMBER },
                  ];
                  const backlog = tiers.reduce((s, t) => s + t.v, 0);
                  if (backlog === 0) return (
                    <div className="py-10 text-center">
                      <p className="text-[26px]">🎉</p>
                      <p className="mt-1 text-[13px] font-medium text-slate-500">Backlog clear — nothing unbooked in scope.</p>
                    </div>
                  );
                  const pct = (v: number) => Math.round(v / backlog * 100);
                  const mx = Math.max(1, ...tiers.map(t => t.v));
                  return (
                    <div className="pt-1">
                      {/* headline — the one number ops acts on */}
                      <div className="flex items-end justify-between gap-4">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Unbooked backlog</p>
                          <p className="mt-1 text-[34px] font-bold leading-none tabular-nums text-slate-900">{backlog}</p>
                          <p className="mt-1.5 text-[12px] text-slate-400">containers awaiting a booking #</p>
                        </div>
                        {c.aging.overdue > 0 && (
                          <div className="rounded-lg border border-red-100 bg-red-50 px-3.5 py-2 text-right">
                            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-red-600/80">Overdue now</p>
                            <p className="text-[20px] font-bold leading-tight tabular-nums text-red-700">{c.aging.overdue}</p>
                          </div>
                        )}
                      </div>
                      {/* per-tier bars — length compares volume, label carries share of backlog */}
                      <div className="mt-6 flex flex-col gap-5">
                        {tiers.map(b => (
                          <div key={b.t} className="group relative cursor-default">
                            <BarTip title={b.t} rows={[{ label: "Containers", value: `${b.v} · ${pct(b.v)}% of backlog`, color: b.col }]} />
                            <div className="mb-2 flex items-baseline justify-between">
                              <span className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.col }} />{b.t}
                              </span>
                              <span className="flex items-baseline gap-2 tabular-nums">
                                <b className="text-[16px] text-slate-900">{b.v}</b>
                                <span className="text-[11.5px] text-slate-400">{pct(b.v)}%</span>
                              </span>
                            </div>
                            <div className="h-3.5 w-full overflow-hidden rounded-full bg-slate-100/80 ring-1 ring-inset ring-slate-200/60">
                              <div className="h-full rounded-full transition-[width,filter] duration-700 ease-out group-hover:brightness-110" style={{ width: `${Math.max(b.v / mx * 100, b.v > 0 ? 4 : 0)}%`, background: `linear-gradient(90deg, ${b.col}, ${b.col}cc)` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* cleared — done work, separated from the backlog */}
                      <div className="mt-6 flex items-center gap-2.5 border-t border-slate-100 pt-4 text-[13px]">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: GREEN }} />
                        <span className="font-medium text-slate-500">Booked — cleared this period</span>
                        <b className="ml-auto tabular-nums text-slate-700">{c.aging.booked}</b>
                      </div>
                    </div>
                  );
                })()}
              </Panel>
            </div>

            {/* action queue — book now */}
            <Panel title="Book now — action queue" sub={`${c.queue.length} container${c.queue.length === 1 ? "" : "s"} to book · most-overdue first · supplier contact ready`} legend={<><Lg c="bg-[#b91c1c]" t="Overdue" /><Lg c="bg-[#d97706]" t="Ready" /></>}>
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[940px] border-separate border-spacing-0 text-[13px]">
                  <thead><tr>{["Ref", "Factory", "POL", "Volume", "Cargo ready", "Days", "Status", "Booking contact"].map(h => <th key={h} className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{h}</th>)}</tr></thead>
                  <tbody>{c.queue.length === 0 ? <tr><td colSpan={8} className="py-10 text-center text-slate-400">Nothing needs booking 🎉</td></tr> : c.queue.slice(0, 100).map((r, i) => (
                    <tr key={i} className={cn(i % 2 && "bg-slate-50/60")}>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 font-bold text-slate-700">{r.ref}</td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-slate-600">{r.factory}</td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-slate-600">{r.pol}</td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 tabular-nums text-slate-600">{r.cbm != null ? `${r.cbm} CBM` : "—"}</td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 tabular-nums text-slate-600">{r.crd != null ? fmtLong(r.crd) : "—"}</td>
                      <td className={cn("whitespace-nowrap border-b border-slate-100 px-3 py-2 font-semibold tabular-nums", r.days < 0 ? "text-red-700" : "text-slate-500")}>{daysLabel(r.days)}</td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2">{r.over ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10.5px] font-extrabold text-red-700">Overdue</span> : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-extrabold text-amber-700">Ready</span>}</td>
                      <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-[12px] text-slate-500">{r.contact || "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Panel>

            {/* accountability footer */}
            <div className="rounded-xl border border-slate-200/80 border-l-[3px] border-l-[#0b2239] bg-white px-5 py-3.5 text-[13px] leading-relaxed text-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Accountability view</span>
              <p className="mt-0.5">"Needs booking — by Factory" shows who's slacking; "Book now" lists exactly which containers to book today, most-overdue first. the buyer lead &amp; team work the list top-down.</p>
            </div>
          </div>
        </div>
      )}

      {tabGroup && <OrderDashboardTabs group={tabGroup} activeTab="dashboard" />}
    </div>
  );
}

function Kpi({ color, label, value, sub, barPct, barColor }: { color: string; label: string; value: number; sub: string; barPct?: number; barColor?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-shadow hover:shadow-md">
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: color }} />
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      </div>
      <div className="mt-2.5 text-[34px] font-bold leading-none tabular-nums text-slate-900">{value.toLocaleString()}</div>
      <div className="mt-2 text-[12px] leading-snug text-slate-400">{sub}</div>
      {typeof barPct === "number" && <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(barPct, 100)}%`, background: barColor }} /></div>}
    </div>
  );
}
/** Styled hover card for any bar/row. Colored rows = legend items; a color-less row
    renders as a divider summary line. Fires instantly via parent `.group` hover. */
function BarTip({ title, rows }: { title: string; rows: { label: string; value: number | string; color?: string }[] }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max min-w-[160px] -translate-x-1/2 scale-95 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left opacity-0 shadow-lg transition-all duration-150 group-hover:scale-100 group-hover:opacity-100">
      <div className="text-[12px] font-bold text-slate-800">{title}</div>
      {rows.map((r, i) => (
        <div key={i} className={cn("mt-1 flex items-center gap-1.5 text-[11.5px] text-slate-600", !r.color && "border-t border-slate-100 pt-1 text-slate-500")}>
          {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />}
          {r.label}
          <b className="ml-auto pl-3 tabular-nums text-slate-800">{r.value}</b>
        </div>
      ))}
    </div>
  );
}
function Seg({ v, grow, bg }: { v: number; grow: number; bg: string }) {
  return <div className="flex items-center justify-center text-[11px] font-bold text-white" style={{ flexGrow: grow, background: bg }}>{v}</div>;
}
function Panel({ title, sub, legend, children }: { title: string; sub?: string; legend?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-[14px] font-bold tracking-tight text-slate-900">{title}</h3>
          {sub && <p className="mt-0.5 text-[12px] text-slate-400">{sub}</p>}
        </div>
        {legend && <span className="ml-auto flex shrink-0 gap-3 pt-0.5 text-[11px] font-semibold text-slate-500">{legend}</span>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
function Lg({ c, t }: { c: string; t: string }) { return <span className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-full", c)} />{t}</span>; }
function Empty() { return <p className="py-10 text-center text-[13px] text-slate-400">No containers in this period.</p>; }
