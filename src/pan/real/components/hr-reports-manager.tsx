"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Card, cn } from "@/components/ui";
import { PaginationFooter, usePagination } from "@/components/pagination-footer";

// Lazy donut (recharts kept out of the initial bundle).
const DonutChart = dynamic(() => import("@/components/charts/donut-chart"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-full bg-stone-100" /> });
import { peso, shortDate } from "@/lib/format";
import type {
  RptAttendance,
  RptPayslip,
  RptRun,
  RptAdvance,
  RptEmployee,
} from "@/app/hr/reports/data";

// ── Brand palette (espresso #4a3b1a / gold #caa45a) ──────────────────────────
const DEDUCT = { sss: "#5b5026", philhealth: "#c9a85c", pagibig: "#8a7a3a", tax: "#a8a29e" };
const GOLD = "#caa45a";
const ESPRESSO = "#4a3b1a";

const DAY = 86_400_000;

type PeriodKey = "today" | "7d" | "30d" | "qtr" | "ytd";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "qtr", label: "QTR" },
  { key: "ytd", label: "YTD" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
const dayMs = (iso: string | null) => {
  if (!iso) return NaN;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? NaN : d.setHours(0, 0, 0, 0);
};
const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "—";

function periodCutoff(period: PeriodKey): { lo: number; hi: number } {
  const now = new Date();
  const today = new Date(now).setHours(0, 0, 0, 0);
  // Upper bound extends into the future so future-dated entries still appear
  // (the period only bounds how far BACK the window starts).
  const hi = today + 366 * DAY;
  if (period === "today") return { lo: today, hi };
  if (period === "7d") return { lo: today - 6 * DAY, hi };
  if (period === "30d") return { lo: today - 29 * DAY, hi };
  if (period === "qtr") return { lo: today - 89 * DAY, hi };
  // ytd
  return { lo: new Date(now.getFullYear(), 0, 1).setHours(0, 0, 0, 0), hi };
}

function downloadCsv(filename: string, head: string[], rows: (string | number)[][]) {
  const esc = (c: string | number) => `"${String(c).replace(/"/g, '""')}"`;
  const body = [head.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([body], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Canvas mini-charts ───────────────────────────────────────────────────────
// Maliit na gold trend line sa loob ng KPI tile.
function Spark({ values, width = 88, height = 30 }: { values: number[]; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || values.length < 2) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const min = Math.min(...values), max = Math.max(...values);
    const x = (i: number) => 2 + (i * (width - 8)) / (values.length - 1);
    const y = (v: number) => height - 4 - (max === min ? 0.5 : (v - min) / (max - min)) * (height - 10);
    ctx.beginPath();
    values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x(values.length - 1), y(values[values.length - 1]), 2.6, 0, 7);
    ctx.fillStyle = GOLD;
    ctx.fill();
  }, [values, width, height]);
  if (values.length < 2) return null;
  return <canvas ref={ref} width={width} height={height} className="absolute bottom-2 right-3 opacity-90" aria-hidden />;
}

// Payroll trend — bars ng huling finalized runs, gold→espresso gradient.
function TrendBars({ points }: { points: { label: string; value: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 1160, H = 130;
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !points.length) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const max = Math.max(...points.map((p) => p.value)) || 1;
    const n = points.length;
    const slot = W / n;
    const bw = Math.min(52, slot * 0.5);
    ctx.strokeStyle = "#e7dfcd";
    ctx.beginPath(); ctx.moveTo(0, H - 24); ctx.lineTo(W, H - 24); ctx.stroke();
    points.forEach((p, i) => {
      const bh = Math.max(2, (p.value / max) * (H - 52));
      const x0 = i * slot + (slot - bw) / 2;
      const y0 = H - 24 - bh;
      const g = ctx.createLinearGradient(0, y0, 0, H - 24);
      g.addColorStop(0, GOLD); g.addColorStop(1, ESPRESSO);
      ctx.fillStyle = p.value > 0 ? g : "#ece5d4";
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") { ctx.roundRect(x0, y0, bw, bh, 4); ctx.fill(); }
      else ctx.fillRect(x0, y0, bw, bh);
      ctx.fillStyle = "#8a7f6c";
      ctx.font = "600 10px -apple-system, Segoe UI, Arial";
      ctx.textAlign = "center";
      ctx.fillText(p.label, i * slot + slot / 2, H - 8);
      if (p.value > 0) {
        ctx.fillStyle = ESPRESSO;
        ctx.font = "800 11px -apple-system, Segoe UI, Arial";
        ctx.fillText("₱" + (p.value >= 1000 ? (p.value / 1000).toFixed(1) + "k" : p.value.toFixed(0)), i * slot + slot / 2, y0 - 6);
      }
    });
  }, [points]);
  if (!points.length) return null;
  return <canvas ref={ref} width={W} height={H} className="w-full max-w-full" aria-label="Payroll trend" />;
}

// ── Main ─────────────────────────────────────────────────────────────────────
export function HrReportsManager({
  attendance,
  payslips,
  runs,
  advances,
  employees,
}: {
  attendance: RptAttendance[];
  payslips: RptPayslip[];
  runs: RptRun[];
  advances: RptAdvance[];
  employees: RptEmployee[];
}) {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  // "Updated" stamp — client-side lang para walang hydration mismatch.
  const [stamp, setStamp] = useState("");
  useEffect(() => {
    setStamp(new Date().toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
  }, []);

  // ── 1. Attendance Summary (period-filtered) ──────────────────────────────
  const attn = useMemo(() => {
    const { lo, hi } = periodCutoff(period);
    const rows = attendance.filter((a) => {
      const d = dayMs(a.work_date);
      return !isNaN(d) && d >= lo && d <= hi;
    });
    type Agg = {
      name: string;
      present: number;
      late: number;
      absent: number;
      leave: number;
      ot: number;
    };
    const m = new Map<number, Agg>();
    for (const r of rows) {
      const e = m.get(r.employee_id) ?? {
        name: r.employee_name,
        present: 0,
        late: 0,
        absent: 0,
        leave: 0,
        ot: 0,
      };
      const s = norm(r.status);
      if (s === "present" || s === "halfday" || s === "holiday") e.present++;
      else if (s === "late") e.late++;
      else if (s === "absent") e.absent++;
      else if (s === "leave" || s === "restday") e.leave++;
      e.ot += r.ot_hours;
      m.set(r.employee_id, e);
    }
    const list = [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
    const totalOt = list.reduce((s, r) => s + r.ot, 0);
    const maxOt = list.reduce((s, r) => Math.max(s, r.ot), 0);
    const totals = list.reduce(
      (s, r) => ({ present: s.present + r.present, late: s.late + r.late, absent: s.absent + r.absent, leave: s.leave + r.leave }),
      { present: 0, late: 0, absent: 0, leave: 0 },
    );
    return { list, totalOt, maxOt, totals };
  }, [attendance, period]);

  const attnPg = usePagination(attn.list, 25);

  // ── 2. Payroll Summary (finalized runs in period) ────────────────────────
  const payroll = useMemo(() => {
    const { lo, hi } = periodCutoff(period);
    const finalized = runs.filter((r) => norm(r.status) === "finalized");
    const inRange = finalized.filter((r) => {
      const d = dayMs(r.period_end);
      return !isNaN(d) && d >= lo && d <= hi;
    });
    const byRun = new Map<number, RptPayslip[]>();
    for (const p of payslips) {
      const arr = byRun.get(p.run_id) ?? [];
      arr.push(p);
      byRun.set(p.run_id, arr);
    }
    const build = (run: RptRun) => {
      const slips = byRun.get(run.id) ?? [];
      const gross = slips.reduce((s, p) => s + p.gross, 0);
      const deductions = slips.reduce((s, p) => s + p.sss + p.philhealth + p.pagibig + p.tax, 0);
      const net = slips.reduce((s, p) => s + p.net_pay, 0);
      return {
        id: run.id,
        endMs: dayMs(run.period_end),
        period: `${shortDate(run.period_start)} – ${shortDate(run.period_end)}`,
        endLabel: shortDate(run.period_start),
        count: slips.length,
        gross,
        deductions,
        net,
      };
    };
    const list = inRange.map(build).sort((a, b) => b.endMs - a.endMs);
    const totals = list.reduce(
      (s, r) => ({
        gross: s.gross + r.gross,
        deductions: s.deductions + r.deductions,
        net: s.net + r.net,
      }),
      { gross: 0, deductions: 0, net: 0 },
    );
    // Trend: huling 8 finalized runs (anuman ang period) para may konteksto lagi.
    const trend = finalized
      .map(build)
      .sort((a, b) => a.endMs - b.endMs)
      .slice(-8)
      .map((r) => ({ label: r.endLabel, value: r.net }));
    return { list, totals, trend };
  }, [runs, payslips, period]);

  // ── KPI band (headcount / attendance rate / OT / net pay ng huling run) ───
  const kpis = useMemo(() => {
    const todayMs = new Date().setHours(0, 0, 0, 0);
    const { lo } = periodCutoff(period);
    const len = Math.max(todayMs - lo + DAY, DAY);
    const winOf = (loW: number, hiW: number) => attendance.filter((a) => {
      const d = dayMs(a.work_date);
      return !isNaN(d) && d >= loW && d <= hiW;
    });
    const rateOf = (rows: RptAttendance[]) => {
      let good = 0, bad = 0;
      for (const r of rows) {
        const s = norm(r.status);
        if (s === "present" || s === "halfday" || s === "holiday" || s === "late") good++;
        else if (s === "absent") bad++;
      }
      return good + bad > 0 ? (good / (good + bad)) * 100 : null;
    };
    const cur = winOf(lo, todayMs + DAY);
    const prev = winOf(lo - len, lo - 1);
    const rate = rateOf(cur);
    const prevRate = rateOf(prev);
    const lateMarks = cur.filter((r) => norm(r.status) === "late").length;
    const otCur = cur.reduce((s, r) => s + r.ot_hours, 0);
    const otPrev = prev.reduce((s, r) => s + r.ot_hours, 0);
    // Daily series para sa sparklines (huling 8 araw).
    const days: number[] = [];
    for (let i = 7; i >= 0; i--) days.push(todayMs - i * DAY);
    const daily = (fn: (rows: RptAttendance[]) => number) =>
      days.map((d) => fn(attendance.filter((a) => dayMs(a.work_date) === d)));
    const attSpark = daily((rows) => rows.filter((r) => ["present", "halfday", "holiday", "late"].includes(norm(r.status))).length);
    const otSpark = daily((rows) => rows.reduce((s, r) => s + r.ot_hours, 0));
    const netSpark = payroll.trend.map((t) => t.value);
    const lastRun = payroll.list[0] ?? null;
    const prevRun = payroll.list[1] ?? null;
    const netDelta = lastRun && prevRun && prevRun.net > 0 ? ((lastRun.net - prevRun.net) / prevRun.net) * 100 : null;
    return { headcount: employees.length, rate, prevRate, lateMarks, otCur, otPrev, attSpark, otSpark, netSpark, lastRun, netDelta };
  }, [attendance, employees, payroll, period]);

  // ── 3. Deductions Breakdown (donut) — all payslips ───────────────────────
  const deductions = useMemo(() => {
    const agg = { sss: 0, philhealth: 0, pagibig: 0, tax: 0 };
    for (const p of payslips) {
      agg.sss += p.sss;
      agg.philhealth += p.philhealth;
      agg.pagibig += p.pagibig;
      agg.tax += p.tax;
    }
    const donut = (
      [
        { key: "sss", name: "SSS" },
        { key: "philhealth", name: "PhilHealth" },
        { key: "pagibig", name: "Pag-IBIG" },
        { key: "tax", name: "Tax" },
      ] as const
    )
      .map((d) => ({
        key: d.key,
        name: d.name,
        value: agg[d.key],
        color: DEDUCT[d.key],
      }))
      .filter((d) => d.value > 0);
    const total = donut.reduce((s, d) => s + d.value, 0);
    return { donut, total };
  }, [payslips]);

  // ── 4. 13th Month Estimate — basic_pay this year / 12 ─────────────────────
  const thirteenth = useMemo(() => {
    const year = new Date().getFullYear();
    const runIds = new Set(
      runs.filter((r) => new Date(r.period_end).getFullYear() === year).map((r) => r.id),
    );
    const m = new Map<number, { name: string; basic: number }>();
    for (const p of payslips) {
      if (!runIds.has(p.run_id)) continue;
      const e = m.get(p.employee_id) ?? { name: p.employee_name, basic: 0 };
      e.basic += p.basic_pay;
      m.set(p.employee_id, e);
    }
    const list = [...m.values()]
      .map((e) => ({ name: e.name, basic: e.basic, estimate: e.basic / 12 }))
      .sort((a, b) => b.estimate - a.estimate);
    const total = list.reduce((s, r) => s + r.estimate, 0);
    const max = list.reduce((s, r) => Math.max(s, r.estimate), 0);
    return { list, total, max, year };
  }, [payslips, runs]);

  // ── 5. Advances — outstanding (open) + paid (deducted) per employee ───────
  const advancesOut = useMemo(() => {
    const m = new Map<number, { name: string; outstanding: number; paid: number }>();
    for (const a of advances) {
      const e = m.get(a.employee_id) ?? { name: a.employee_name, outstanding: 0, paid: 0 };
      e.paid += a.deducted;
      if (norm(a.status) === "open") e.outstanding += Math.max(a.amount - a.deducted, 0);
      m.set(a.employee_id, e);
    }
    const list = [...m.values()].filter((e) => e.outstanding > 0 || e.paid > 0).sort((a, b) => b.outstanding - a.outstanding);
    const totalOut = list.reduce((s, r) => s + r.outstanding, 0);
    const totalPaid = list.reduce((s, r) => s + r.paid, 0);
    return { list, totalOut, totalPaid };
  }, [advances]);

  return (
    <div className="space-y-5">
      {/* ── Command bar ── */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-b border-border bg-[#f4efe4]/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-[#caa45a]">HR Management · Reports</p>
          <h1 className="truncate text-lg font-extrabold tracking-tight text-[#3a2e14] sm:text-xl">Workforce &amp; Payroll Overview</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          {stamp && <span className="hidden text-[11px] text-muted md:inline">Updated {stamp}</span>}
          <div className="flex rounded-lg border border-border bg-surface p-0.5 shadow-sm">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-bold transition-all sm:px-3",
                  period === p.key
                    ? "bg-[#4a3b1a] text-[#f4ead8] shadow-sm"
                    : "text-muted hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={() => window.print()} className="hidden items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-bold shadow-sm hover:bg-stone-100 sm:flex">
            Print
          </button>
        </div>
      </div>

      {/* ── KPI band ── */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Headcount active" value={String(kpis.headcount)}
          chip={<Chip tone="flat">● roster</Chip>} note="Employee Directory" />
        <Kpi label="Attendance rate"
          value={kpis.rate != null ? `${kpis.rate.toFixed(1)}%` : "—"}
          chip={kpis.rate != null && kpis.prevRate != null
            ? <Chip tone={kpis.rate >= kpis.prevRate ? "up" : "down"}>{kpis.rate >= kpis.prevRate ? "▲" : "▼"} {Math.abs(kpis.rate - kpis.prevRate).toFixed(1)} pts</Chip>
            : <Chip tone="flat">● no prior data</Chip>}
          note={`${kpis.lateMarks} late mark${kpis.lateMarks === 1 ? "" : "s"}`}
          spark={kpis.attSpark} />
        <Kpi label="Overtime" value={`${kpis.otCur.toFixed(1)} h`}
          chip={kpis.otPrev > 0
            ? <Chip tone={kpis.otCur <= kpis.otPrev ? "up" : "flat"}>{kpis.otCur <= kpis.otPrev ? "▼" : "▲"} {Math.abs(kpis.otCur - kpis.otPrev).toFixed(1)} h</Chip>
            : <Chip tone="flat">● steady</Chip>}
          note="₱ impact in payroll" spark={kpis.otSpark} />
        <Kpi label="Net pay · last run" value={kpis.lastRun ? peso(kpis.lastRun.net) : "—"}
          chip={kpis.netDelta != null
            ? <Chip tone={kpis.netDelta >= 0 ? "up" : "down"}>{kpis.netDelta >= 0 ? "▲" : "▼"} {Math.abs(kpis.netDelta).toFixed(1)}%</Chip>
            : <Chip tone="flat">● first run</Chip>}
          note={kpis.lastRun ? `${kpis.lastRun.count} payslips · ${peso(kpis.lastRun.deductions)} deductions` : "No finalized runs"}
          spark={kpis.netSpark} />
      </div>

      {/* 1. Attendance + 3. Deductions */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md xl:col-span-2">
          <CardHead icon="calendar" title="Attendance Summary" hint="Present · Late · Absent · Leave, with OT share per employee">
            <span className="hidden text-xs text-[#c9b896] sm:inline">
              Total OT <span className="font-bold text-[#f4ead8]">{attn.totalOt.toFixed(1)}h</span>
            </span>
            {attn.list.length > 0 && (
              <ExportButton
                onClick={() =>
                  downloadCsv(
                    "attendance-summary.csv",
                    ["Employee", "Present", "Late", "Absent", "Leave/Rest", "OT Hours"],
                    attn.list.map((r) => [r.name, r.present, r.late, r.absent, r.leave, r.ot.toFixed(1)]),
                  )
                }
              />
            )}
          </CardHead>
          {attn.list.length ? (
            <>
            <div className="max-h-[62vh] overflow-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#5a4a26] text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#e7dcc4] [&>th]:border-b [&>th]:border-[#6b5a2f] [&>th]:px-4 [&>th]:py-2.5 [&>th]:bg-[#5a4a26]">
                    <th className="text-left">Employee</th>
                    <th className="text-right">Present</th>
                    <th className="text-right">Late</th>
                    <th className="text-right">Absent</th>
                    <th className="text-right">Leave</th>
                    <th className="text-right">Overtime</th>
                  </tr>
                </thead>
                <tbody>
                  {attnPg.slice.map((r) => (
                    <tr key={r.name} className="border-b border-border last:border-0 hover:bg-[#faf6ec]/70">
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2.5 font-semibold text-[#3a2e14]">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4a3b1a] text-[10px] font-extrabold text-[#f4ead8]">{initials(r.name)}</span>
                          <span className="max-w-[190px] truncate" title={r.name}>{r.name}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right"><CellChip tone="good">{r.present}</CellChip></td>
                      <td className="px-4 py-2.5 text-right">{r.late > 0 ? <CellChip tone={r.late >= 2 ? "crit" : "warn"}>{r.late}</CellChip> : <span className="tabular-nums text-muted">0</span>}</td>
                      <td className="px-4 py-2.5 text-right">{r.absent > 0 ? <CellChip tone="crit">{r.absent}</CellChip> : <span className="tabular-nums text-muted">0</span>}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted">{r.leave}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center justify-end gap-2">
                          <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-stone-200 sm:block">
                            <span className="block h-full rounded-full bg-gradient-to-r from-[#caa45a] to-[#4a3b1a]" style={{ width: `${attn.maxOt > 0 ? (r.ot / attn.maxOt) * 100 : 0}%` }} />
                          </span>
                          <b className="tabular-nums text-[#3a2e14]">{r.ot.toFixed(1)} h</b>
                        </span>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-[#f4ead8]/70 font-extrabold text-[#3a2e14] [&>td]:px-4 [&>td]:py-2.5">
                    <td>Total</td>
                    <td className="text-right tabular-nums">{attn.totals.present}</td>
                    <td className="text-right tabular-nums">{attn.totals.late}</td>
                    <td className="text-right tabular-nums">{attn.totals.absent}</td>
                    <td className="text-right tabular-nums">{attn.totals.leave}</td>
                    <td className="text-right tabular-nums">{attn.totalOt.toFixed(1)} h</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="px-2">
              <PaginationFooter page={attnPg.page} setPage={attnPg.setPage} pageSize={attnPg.pageSize} setPageSize={attnPg.setPageSize} total={attnPg.total} pages={attnPg.pages} />
            </div>
            </>
          ) : (
            <Empty icon="calendar" msg="No attendance in range." />
          )}
        </Card>

        <Card className="rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md">
          <CardHead icon="pie" title="Deductions Breakdown" hint="Statutory + tax across payslips">
            {deductions.donut.length > 0 && (
              <ExportButton
                onClick={() =>
                  downloadCsv(
                    "deductions-breakdown.csv",
                    ["Type", "Total"],
                    deductions.donut.map((d) => [d.name, d.value]),
                  )
                }
              />
            )}
          </CardHead>
          {deductions.donut.length ? (
            <div className="p-5">
              <div className="mt-1 h-40 w-full">
                <DonutChart data={deductions.donut} />
              </div>
              <ul className="mt-3 space-y-1.5 text-sm">
                {deductions.donut.map((d) => (
                  <li key={d.key} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    <span className="tabular-nums font-semibold text-[#3a2e14]">{peso(d.value)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
                Total deductions: <span className="font-semibold text-foreground">{peso(deductions.total)}</span>
              </p>
            </div>
          ) : (
            <Empty icon="check" tone="success" msg="No deductions recorded this period — net pay equals gross." />
          )}
        </Card>
      </div>

      {/* 2. Payroll Summary */}
      <Card className="rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md">
        <CardHead icon="wallet" title="Payroll Summary" hint="Finalized runs · Saturday cut-off">
          {payroll.list.length > 0 && (
            <ExportButton
              onClick={() =>
                downloadCsv(
                  "payroll-summary.csv",
                  ["Period", "Payslips", "Gross", "Deductions", "Net Pay"],
                  payroll.list.map((r) => [r.period, r.count, r.gross, r.deductions, r.net]),
                )
              }
            />
          )}
        </CardHead>
        {payroll.trend.filter((t) => t.value > 0).length > 1 && (
          <div className="border-b border-border px-4 pb-1 pt-4 sm:px-5">
            <TrendBars points={payroll.trend} />
          </div>
        )}
        {payroll.list.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead>
                <tr className="bg-[#5a4a26] text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#e7dcc4] [&>th]:border-b [&>th]:border-[#6b5a2f] [&>th]:px-4 [&>th]:py-2.5 [&>th]:bg-[#5a4a26]">
                  <th className="text-left">Period</th>
                  <th className="text-left">Status</th>
                  <th className="text-right">Payslips</th>
                  <th className="text-right">Gross</th>
                  <th className="text-right">Deductions</th>
                  <th className="text-right">Net pay</th>
                </tr>
              </thead>
              <tbody>
                {payroll.list.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-[#faf6ec]/70">
                    <td className="px-4 py-2.5 font-semibold text-[#3a2e14]">{r.period}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-emerald-700 ring-1 ring-inset ring-emerald-200">● Finalized</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted">{r.count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{peso(r.gross)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-danger">{peso(r.deductions)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-extrabold text-[#3a2e14]">{peso(r.net)}</td>
                  </tr>
                ))}
                <tr className="bg-[#f4ead8]/70 font-extrabold text-[#3a2e14] [&>td]:px-4 [&>td]:py-2.5">
                  <td>Grand total</td>
                  <td />
                  <td className="text-right tabular-nums">{payroll.list.reduce((s, r) => s + r.count, 0)}</td>
                  <td className="text-right tabular-nums">{peso(payroll.totals.gross)}</td>
                  <td className="text-right tabular-nums">{peso(payroll.totals.deductions)}</td>
                  <td className="text-right tabular-nums">{peso(payroll.totals.net)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="wallet" msg="No finalized payroll runs in range." />
        )}
      </Card>

      {/* 4. 13th Month + 5. Advances */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md">
          <CardHead icon="gift" title="13th Month Estimate" hint={`Basic YTD ÷ 12 · accrual to date, ${thirteenth.year}`}>
            {thirteenth.list.length > 0 && (
              <ExportButton
                onClick={() =>
                  downloadCsv(
                    "13th-month-estimate.csv",
                    ["Employee", "Basic Pay YTD", "13th Month Estimate"],
                    thirteenth.list.map((r) => [r.name, r.basic, r.estimate.toFixed(2)]),
                  )
                }
              />
            )}
          </CardHead>
          {thirteenth.list.length ? (
            <div>
              {thirteenth.list.map((r) => (
                <div key={r.name} className="border-b border-border px-4 py-2.5 last:border-0 hover:bg-[#faf6ec]/70 sm:px-5">
                  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                    <span className="flex min-w-0 items-center gap-2.5 font-semibold text-[#3a2e14]">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4a3b1a] text-[10px] font-extrabold text-[#f4ead8]">{initials(r.name)}</span>
                      <span className="truncate" title={r.name}>{r.name}</span>
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-muted">Basic YTD</span>
                      <span className="text-sm text-muted">{peso(r.basic)}</span>
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-muted">Estimate</span>
                      <span className="text-sm font-extrabold text-[#3a2e14]">{peso(r.estimate)}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
                    <span className="block h-full rounded-full bg-gradient-to-r from-[#caa45a] to-[#4a3b1a]" style={{ width: `${thirteenth.max > 0 ? Math.max((r.estimate / thirteenth.max) * 100, 2) : 0}%` }} />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between bg-[#faf6ec] px-4 py-3 font-extrabold text-[#3a2e14] sm:px-5">
                <span>Total accrued</span>
                <span className="tabular-nums">{peso(thirteenth.total)}</span>
              </div>
            </div>
          ) : (
            <Empty icon="gift" msg="No payslips this year yet." />
          )}
        </Card>

        <Card className="rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md">
          <CardHead icon="coin" title="Advance Payments" hint="Cash advances vs. payroll offsets">
            {advancesOut.list.length > 0 && (
              <ExportButton
                onClick={() =>
                  downloadCsv(
                    "advances.csv",
                    ["Employee", "Outstanding", "Paid"],
                    advancesOut.list.map((r) => [r.name, r.outstanding, r.paid]),
                  )
                }
              />
            )}
          </CardHead>
          <div className="grid grid-cols-2 gap-3 p-4 sm:p-5">
            <div className="rounded-xl border border-amber-200/70 bg-amber-50 px-4 py-3">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-amber-700">Outstanding</p>
              <p className="mt-0.5 text-xl font-extrabold tabular-nums text-amber-700">{peso(advancesOut.totalOut)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200/70 bg-emerald-50 px-4 py-3">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-emerald-700">Repaid</p>
              <p className="mt-0.5 text-xl font-extrabold tabular-nums text-emerald-700">{peso(advancesOut.totalPaid)}</p>
            </div>
          </div>
          {advancesOut.list.length ? (
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full min-w-[360px] border-collapse text-sm">
                <thead>
                  <tr className="bg-[#5a4a26] text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#e7dcc4] [&>th]:border-b [&>th]:border-[#6b5a2f] [&>th]:px-4 [&>th]:py-2.5 [&>th]:bg-[#5a4a26]">
                    <th className="text-left">Employee</th>
                    <th className="text-right">Outstanding</th>
                    <th className="text-right">Repaid</th>
                  </tr>
                </thead>
                <tbody>
                  {advancesOut.list.map((r) => (
                    <tr key={r.name} className="border-b border-border last:border-0 hover:bg-[#faf6ec]/70">
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2.5 font-semibold text-[#3a2e14]">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4a3b1a] text-[10px] font-extrabold text-[#f4ead8]">{initials(r.name)}</span>
                          <span className="max-w-[170px] truncate" title={r.name}>{r.name}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700">{r.outstanding ? peso(r.outstanding) : "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{r.paid ? peso(r.paid) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border-t border-border">
              <Empty icon="check" msg="No advances on record — nothing will offset the next payroll run." tone="success" />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────
function Kpi({ label, value, chip, note, spark }: { label: string; value: string; chip?: React.ReactNode; note?: string; spark?: number[] }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border border-t-2 border-t-[#caa45a] bg-surface px-4 py-3.5 shadow-sm transition-shadow hover:shadow-md">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#a8842e]">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums text-[#3a2e14]">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {chip}
        {note && <span className="truncate text-[11px] text-muted">{note}</span>}
      </div>
      {spark && <Spark values={spark} />}
    </div>
  );
}

function Chip({ tone, children }: { tone: "up" | "down" | "flat"; children: React.ReactNode }) {
  return (
    <span className={cn(
      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-extrabold tabular-nums",
      tone === "up" && "bg-emerald-50 text-emerald-700",
      tone === "down" && "bg-rose-50 text-rose-700",
      tone === "flat" && "bg-amber-50 text-amber-700",
    )}>
      {children}
    </span>
  );
}

function CellChip({ tone, children }: { tone: "good" | "warn" | "crit"; children: React.ReactNode }) {
  return (
    <span className={cn(
      "inline-block min-w-[30px] rounded-lg px-2 py-0.5 text-center text-xs font-extrabold tabular-nums",
      tone === "good" && "bg-emerald-50 text-emerald-700",
      tone === "warn" && "bg-amber-50 text-amber-700",
      tone === "crit" && "bg-rose-50 text-rose-700",
    )}>
      {children}
    </span>
  );
}

// Brand header band — kapareho ng ibang IMS tables (espresso gradient + gold).
function CardHead({ icon, title, hint, children }: { icon: IconName; title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-[#caa45a] bg-gradient-to-r from-[#52421d] to-[#4a3b1a] px-4 py-3 sm:px-5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#caa45a] text-[#3a2e14]">
        <Icon name={icon} size={15} />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-extrabold tracking-wide text-[#f4ead8]">{title}</h2>
        {hint && <p className="truncate text-[11px] text-[#c9b896]">{hint}</p>}
      </div>
      <div className="ml-auto flex items-center gap-2.5">{children}</div>
    </div>
  );
}

function ExportButton({ onClick }: { onClick: () => void }) {
  // Gold-on-cream — bumabagay sa espresso header band (kapareho ng planner minis).
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-[#caa45a] bg-[#faf6ec] px-2.5 py-1.5 text-xs font-bold text-[#4a3b1a] shadow-sm transition-colors hover:bg-[#f4ead8]"
    >
      <Icon name="download" size={13} /> CSV
    </button>
  );
}

function Empty({ icon, msg, tone }: { icon: IconName; msg: string; tone?: "success" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-9 text-center">
      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-2xl",
          tone === "success" ? "bg-emerald-100 text-emerald-600" : "bg-stone-100 text-stone-400",
        )}
      >
        <Icon name={icon} size={22} />
      </span>
      <p className={cn("max-w-[280px] text-sm", tone === "success" ? "text-success" : "text-muted")}>{msg}</p>
    </div>
  );
}

// ── Icons (line-art) ──────────────────────────────────────────────────────────
type IconName = "calendar" | "wallet" | "pie" | "gift" | "coin" | "check" | "download";

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const P: Record<IconName, React.ReactNode> = {
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
      </>
    ),
    wallet: (
      <>
        <path d="M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" />
        <path d="M16 12h.01" />
      </>
    ),
    pie: (
      <>
        <path d="M12 3a9 9 0 1 0 9 9h-9Z" />
        <path d="M12 3v9h9" />
      </>
    ),
    gift: (
      <>
        <path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7S11 3 8.5 3 5 5 5 5s.5 2 3.5 2M12 7s1-4 3.5-4S19 5 19 5s-.5 2-3.5 2" />
      </>
    ),
    coin: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-1 2-2.5 2.5s-2.5 1-2.5 2.5a2.5 2.5 0 0 0 5 0" />
        <path d="M12 7v1.5M12 15.5V17" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {P[name]}
    </svg>
  );
}
