"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase, realtimeReady } from "@/lib/supabase/client";
import { cn, Card } from "./ui";
import { Modal } from "./modal";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { number, shortDate } from "@/lib/format";
import { saveAttendance, deleteAttendance } from "@/app/hr/attendance/actions";
import type { AttendanceRow, EmployeeLite } from "@/app/hr/attendance/data";
import type { AttendanceStatus } from "@/lib/hr/types";

const STATUSES: AttendanceStatus[] = ["present", "late", "absent", "halfday", "leave", "restday", "holiday"];

// Display label + dot color per status (reference style: dot + light text).
const STATUS_META: Record<AttendanceStatus, { label: string; dot: string; text: string }> = {
  present: { label: "On Time", dot: "bg-emerald-500", text: "text-emerald-700" },
  late: { label: "Late", dot: "bg-red-500", text: "text-red-600" },
  absent: { label: "Absent", dot: "bg-red-500", text: "text-red-600" },
  halfday: { label: "Half Day", dot: "bg-amber-500", text: "text-amber-700" },
  leave: { label: "Leave Request", dot: "bg-green-500", text: "text-green-700" },
  restday: { label: "Rest Day", dot: "bg-stone-400", text: "text-stone-500" },
  holiday: { label: "Holiday", dot: "bg-violet-500", text: "text-violet-700" },
};
const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present", late: "Late", absent: "Absent", halfday: "Half-day",
  leave: "Leave", restday: "Rest day", holiday: "Holiday",
};

const inp = "w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary";

const empCode = (id: number) => `M${String(id).padStart(5, "0")}`;

const REG_MS = 9 * 3_600_000; // 9h regular cap (break included)
function workedMs(time_in: string, time_out: string): number {
  let i = new Date(time_in).getTime(); let o = new Date(time_out).getTime();
  if (!Number.isFinite(i) || !Number.isFinite(o)) return 0;
  if (o <= i) o += 86_400_000; // crosses midnight
  return o - i;
}

// "2h 5m 12s" / "5m 12s" — for the live timer.
function fmtDur(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return h ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function todayPH(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function clock(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}
// Time Count as HH:MM:SS.
function duration(time_in: string | null, time_out: string | null): string {
  if (!time_in || !time_out) return "—";
  const ms = new Date(time_out).getTime() - new Date(time_in).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
}
// "HH:MM" in PH time, for a <input type="time">.
function toTimeInput(iso: string | null): string {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("hour")}:${g("minute")}`;
}
// Build a UTC ISO from a PH date + "HH:MM" wall-clock (pinned to +08:00 — no browser-TZ drift).
function phIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}:00+08:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Live status: derive present/late from the 9:00 AM standard (PH) so old rows
// show correctly without re-saving. Manual absent/leave/etc. are kept.
function derivedStatus(status: AttendanceStatus, time_in: string | null): AttendanceStatus {
  if (!time_in || (status !== "present" && status !== "late")) return status;
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(time_in));
  const h = Number(p.find((x) => x.type === "hour")?.value ?? "0"), m = Number(p.find((x) => x.type === "minute")?.value ?? "0");
  return h * 60 + m > 9 * 60 ? "late" : "present";
}

function StatusDot({ status }: { status: AttendanceStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-stone-50 px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-border/60", m.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />{m.label}
    </span>
  );
}

type SortKey = "empid" | "name" | "status" | "date";

export function HrAttendanceManager({ rows, employees }: { rows: AttendanceRow[]; employees: EmployeeLite[] }) {
  const router = useRouter();

  // Instant live updates: subscribe directly to hr_attendance so a kiosk clock
  // (insert/update) refreshes THIS page immediately — no manual reload, and faster
  // than the global RealtimeRefresher's 600ms debounce. Lightly debounced (250ms)
  // so a burst (close-then-open) is one refresh.
  const rtTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const sb = createBrowserSupabase();
    let alive = true;
    let ch: ReturnType<typeof sb.channel> | null = null;
    // Token muna bago subscribe (2026-09-05) — anon join = walang events.
    void realtimeReady().then(() => {
      if (!alive) return;
      ch = sb
        .channel("hr_attendance:live")
        .on("postgres_changes", { event: "*", schema: "public", table: "hr_attendance" }, () => {
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
          if (rtTimer.current) clearTimeout(rtTimer.current);
          rtTimer.current = setTimeout(() => router.refresh(), 250);
        })
        .subscribe();
    });
    return () => {
      alive = false;
      if (rtTimer.current) clearTimeout(rtTimer.current);
      if (ch) void sb.removeChannel(ch);
    };
  }, [router]);

  // No default range — show all loaded logs (incl. future-dated). Narrow via Filters.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AttendanceStatus>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "wfh" | "office" | "manual">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 }); // latest date first
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<number | null>(null);
  const [form, setForm] = useState<AttendanceRow | "new" | null>(null);
  const [pending, start] = useTransition();

  // Live duration ticks while any listed row is still clocked in (no time_out).
  const anyRunning = useMemo(() => rows.some((r) => r.time_in && !r.time_out), [rows]);
  const [nowMs, setNowMs] = useState(0); // 0 on server + first client render (avoids hydration mismatch)
  useEffect(() => {
    if (!anyRunning) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const srcMatch = (src: string) => sourceFilter === "all" || (sourceFilter === "office" ? src === "self" : src === sourceFilter);
    let out = rows.filter((r) =>
      (!from || r.work_date >= from) && (!to || r.work_date <= to) &&
      (statusFilter === "all" || r.status === statusFilter) &&
      srcMatch(r.source) &&
      (!s || r.employee_name.toLowerCase().includes(s) || empCode(r.employee_id).toLowerCase().includes(s)),
    );
    out = [...out].sort((a, b) => {
      let c = 0;
      if (sort.key === "empid") c = a.employee_id - b.employee_id;
      else if (sort.key === "name") c = a.employee_name.localeCompare(b.employee_name);
      else if (sort.key === "date") c = a.work_date.localeCompare(b.work_date) || (a.id - b.id);
      else c = STATUS_META[a.status].label.localeCompare(STATUS_META[b.status].label);
      return c * sort.dir || (b.work_date.localeCompare(a.work_date)) || (b.id - a.id);
    });
    return out;
  }, [rows, from, to, q, statusFilter, sourceFilter, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const pg = usePagination(filtered);
  const allChecked = filtered.length > 0 && filtered.every((r) => sel.has(r.id));
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(filtered.map((r) => r.id)));
  const toggleOne = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function bulkDelete() {
    if (!confirm(`Delete ${sel.size} selected log(s)?`)) return;
    start(async () => { for (const id of sel) await deleteAttendance(id); setSel(new Set()); router.refresh(); });
  }

  const Arrow = ({ k }: { k: SortKey }) => <span className="ml-1 text-[10px] text-muted">{sort.key === k ? (sort.dir === 1 ? "↑" : "↓") : "↕"}</span>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
        </div>
        <button onClick={() => setForm("new")} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium shadow-sm hover:bg-stone-100">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          Time Correction
        </button>
      </div>

      {/* Toolbar: search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        {sel.size > 0 ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium">{sel.size} selected</span>
            <button onClick={bulkDelete} disabled={pending} className="rounded-lg px-3 py-1.5 text-sm font-medium text-danger ring-1 ring-inset ring-red-600/20 hover:bg-red-50">Delete</button>
            <button onClick={() => setSel(new Set())} className="text-muted hover:text-foreground">Clear</button>
          </div>
        ) : (
          <>
            <div className="relative max-w-xs flex-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or ID…" className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" />
            </div>
            <button onClick={() => setShowFilters((v) => !v)} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-stone-100">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 5h18M7 12h10M10 19h4" /></svg>
              Filters
            </button>
            <span className="ml-auto text-sm text-muted">{number(filtered.length)} record{filtered.length === 1 ? "" : "s"}</span>
          </>
        )}
      </div>

      {showFilters && (
        <Card className="rounded-2xl p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="mb-1 block text-xs font-medium text-muted">From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} /></div>
            <div><label className="mb-1 block text-xs font-medium text-muted">To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} /></div>
            <div><label className="mb-1 block text-xs font-medium text-muted">Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | AttendanceStatus)} className={inp}>
                <option value="all">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </div>
            <div><label className="mb-1 block text-xs font-medium text-muted">Source</label>
              <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as "all" | "wfh" | "office" | "manual")} className={inp}>
                <option value="all">All sources</option>
                <option value="office">Office (self)</option>
                <option value="wfh">WFH</option>
                <option value="manual">Manual</option>
              </select>
            </div>
          </div>
        </Card>
      )}

      {/* Table */}
      <Card className="max-h-[70vh] overflow-auto rounded-2xl pf-scroll">
        <table className="w-full min-w-[820px] text-sm border-collapse [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <colgroup>
            <col span={3} />
            <col span={5} />
            <col span={2} />
            <col span={1} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={3} className="sticky top-0 z-10 bg-[#4a3b1a] border-b border-[#caa45a] px-5 py-2">Employee</th>
              <th colSpan={5} className="sticky top-0 z-10 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Time</th>
              <th colSpan={2} className="sticky top-0 z-10 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Status</th>
              <th colSpan={1} className="sticky top-0 z-10 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2"></th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="sticky top-[33px] z-10 bg-[#5a4a26] w-10 px-4 py-3"><input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 rounded border-border accent-primary" /></th>
              <th className="sticky top-[33px] z-10 bg-[#5a4a26] px-4 py-3"><button onClick={() => toggleSort("empid")} className="inline-flex items-center hover:text-foreground">Employee ID<Arrow k="empid" /></button></th>
              <th className="sticky top-[33px] z-10 bg-[#5a4a26] px-4 py-3"><button onClick={() => toggleSort("name")} className="inline-flex items-center hover:text-foreground">Full Name<Arrow k="name" /></button></th>
              <th className="sticky top-[33px] z-10 bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3"><button onClick={() => toggleSort("date")} className="inline-flex items-center hover:text-foreground">Date<Arrow k="date" /></button></th>
              <th className="sticky top-[33px] z-10 bg-[#5a4a26] px-4 py-3">Clock In</th>
              <th className="sticky top-[33px] z-10 bg-[#5a4a26] px-4 py-3">Clock Out</th>
              <th className="sticky top-[33px] z-10 bg-[#5a4a26] px-4 py-3">Overtime</th>
              <th className="sticky top-[33px] z-10 bg-[#5a4a26] px-4 py-3">Time Count</th>
              <th className="sticky top-[33px] z-10 bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3"><button onClick={() => toggleSort("status")} className="inline-flex items-center hover:text-foreground">Login Status<Arrow k="status" /></button></th>
              <th className="sticky top-[33px] z-10 bg-[#5a4a26] px-4 py-3">Overtime Status</th>
              <th className="sticky top-[33px] z-10 bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Group consecutive same employee+date rows in the current page so the
              // Employee ID / Full Name / Date cells span the day's sessions (less
              // visual repetition). Only affects rendering — sort/filter/select/
              // pagination logic is unchanged; grouping is computed on the slice.
              const groupKey = (x: typeof pg.slice[number]) => `${x.employee_id}__${x.work_date}`;
              const spanCount = new Map<number, number>(); // first-row id → rows in its group
              const isFirstOfGroup = new Map<number, boolean>();
              for (let i = 0; i < pg.slice.length; i++) {
                const cur = pg.slice[i];
                const prev = i > 0 ? pg.slice[i - 1] : null;
                const first = !prev || groupKey(prev) !== groupKey(cur);
                isFirstOfGroup.set(cur.id, first);
                if (first) {
                  let n = 1;
                  for (let j = i + 1; j < pg.slice.length && groupKey(pg.slice[j]) === groupKey(cur); j++) n++;
                  spanCount.set(cur.id, n);
                }
              }
              return pg.slice.map((r) => {
              const first = isFirstOfGroup.get(r.id) ?? true;
              const span = spanCount.get(r.id) ?? 1;
              const completed = !!(r.time_in && r.time_out);
              const running = !!(r.time_in && !r.time_out && new Date(r.time_in!).getTime() <= nowMs);
              const elapsed = running ? nowMs - new Date(r.time_in!).getTime() : (completed ? workedMs(r.time_in!, r.time_out!) : 0);
              const otHours = completed ? (r.ot_hours || 0) : (running ? Math.max((elapsed / 3_600_000) - 9, 0) : 0);
              // OT status only after clock-out (when an hr_overtime record exists).
              const otLabel = r.ot_status === "Approved" ? "Approved" : r.ot_status === "Rejected" ? "Rejected" : r.ot_status === "Pending" ? "For Approval" : null;
              const otTone = otLabel === "Approved" ? "bg-green-50 text-green-700 ring-green-600/20" : otLabel === "Rejected" ? "bg-red-50 text-red-700 ring-red-600/20" : "bg-amber-50 text-amber-700 ring-amber-600/20";
              return (
              <tr key={r.id} className={cn("hover:bg-stone-50", sel.has(r.id) && "bg-primary/5", first && "border-t-2 border-t-border/70")}>
                <td className="px-4 py-3"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleOne(r.id)} className="h-4 w-4 rounded border-border accent-primary" /></td>
                {first && (
                  <>
                    <td rowSpan={span} className="px-4 py-3 align-middle font-mono text-xs text-muted">{empCode(r.employee_id)}</td>
                    <td rowSpan={span} className="px-4 py-3 align-middle font-medium">
                      <span className="flex items-center justify-center gap-1.5">{r.employee_name}
                        {r.source === "wfh" && <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20">WFH</span>}
                      </span>
                    </td>
                    <td rowSpan={span} className="px-4 py-3 align-middle whitespace-nowrap text-muted">{shortDate(r.work_date)}</td>
                  </>
                )}
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 whitespace-nowrap">{clock(r.time_in)}</td>
                <td className="px-4 py-3 whitespace-nowrap">{r.time_in && !r.time_out ? <span className="text-amber-600">In Progress</span> : clock(r.time_out)}</td>
                <td className="px-4 py-3 font-mono text-xs">{otHours > 0 ? <span className="text-amber-600">{otHours.toFixed(otHours % 1 ? 1 : 0)}h</span> : "—"}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {running
                    ? <span className="inline-flex items-center gap-1.5 font-medium text-primary"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />{fmtDur(elapsed)}</span>
                    : (completed ? fmtDur(elapsed) : (r.time_in ? <span className="text-muted">not started</span> : "—"))}
                </td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3"><StatusDot status={derivedStatus(r.status, r.time_in)} /></td>
                <td className="px-4 py-3">
                  {otLabel
                    ? <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", otTone)}>{otLabel}</span>
                    : <span className="text-xs text-muted">—</span>}
                </td>
                <td className="!border-l-4 !border-l-[#caa45a] relative px-4 py-3 text-center">
                  <button onClick={() => setMenu(menu === r.id ? null : r.id)} className="rounded-md px-2 py-1 text-muted hover:bg-stone-100 hover:text-foreground">⋯</button>
                  {menu === r.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
                      <div className="absolute right-4 z-20 mt-1 w-32 rounded-lg border border-border bg-surface py-1 shadow-lg">
                        <button onClick={() => { setMenu(null); setForm(r); }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100">Edit</button>
                        <button onClick={() => { setMenu(null); if (confirm("Delete this log?")) start(async () => { await deleteAttendance(r.id); router.refresh(); }); }} className="block w-full px-3 py-1.5 text-left text-sm text-danger hover:bg-red-50">Delete</button>
                      </div>
                    </>
                  )}
                </td>
              </tr>
              );
            });
            })()}
            {filtered.length === 0 && <tr><td colSpan={11} className="px-4 py-12 text-center text-muted">No attendance records.</td></tr>}
          </tbody>
        </table>
        {filtered.length > 0 && <PaginationFooter {...pg} />}
      </Card>

      {form && <AttendanceForm row={form === "new" ? null : form} employees={employees} onClose={() => setForm(null)} />}
    </div>
  );
}

function AttendanceForm({ row, employees, onClose }: { row: AttendanceRow | null; employees: EmployeeLite[]; onClose: () => void }) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState<string>(row ? String(row.employee_id) : (employees[0] ? String(employees[0].id) : ""));
  const [workDate, setWorkDate] = useState(row?.work_date ?? todayPH());
  const [timeIn, setTimeIn] = useState(toTimeInput(row?.time_in ?? null));
  const [timeOut, setTimeOut] = useState(toTimeInput(row?.time_out ?? null));
  const [otHours, setOtHours] = useState(row?.ot_hours != null ? String(row.ot_hours) : "");
  const [status, setStatus] = useState<AttendanceStatus>(row?.status ?? "present");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Group employees by role for the dropdown (optgroups).
  const empGroups = (() => {
    const m = new Map<string, EmployeeLite[]>();
    for (const e of employees) {
      const k = (e.role || "").trim() || "Other";
      const a = m.get(k) ?? []; a.push(e); m.set(k, a);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();

  function save() {
    setError(null);
    const input = { id: row?.id ?? null, employee_id: Number(employeeId), work_date: workDate, time_in: phIso(workDate, timeIn), time_out: phIso(workDate, timeOut), status, ot_hours: otHours.trim() ? Number(otHours) : 0, notes };
    start(async () => { const res = await saveAttendance(input); if ("error" in res) setError(res.error); else { onClose(); router.refresh(); } });
  }
  function del() { if (!row || !confirm("Delete this attendance log?")) return; start(async () => { const res = await deleteAttendance(row.id); if ("error" in res) setError(res.error); else { onClose(); router.refresh(); } }); }

  return (
    <Modal open onClose={onClose} title={row ? "Edit attendance log" : "Time Correction"} size="sm"
      footer={
        <div className="flex items-center justify-between gap-2">
          {row ? <button onClick={del} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-danger ring-1 ring-inset ring-red-600/20 hover:bg-red-50">Delete</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
            <button onClick={save} disabled={pending || !employeeId || !workDate} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">Save</button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div><label className="mb-1 block text-sm font-medium">Employee</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inp}>
            {employees.length === 0 && <option value="">No active employees</option>}
            {empGroups.map(([role, emps]) => (
              <optgroup key={role} label={role}>
                {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div><label className="mb-1 block text-sm font-medium">Date</label><input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className={inp} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="mb-1 block text-sm font-medium">Time in</label><input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} className={inp} /></div>
          <div><label className="mb-1 block text-sm font-medium">Time out</label><input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} className={inp} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="mb-1 block text-sm font-medium">OT hours</label><input type="number" step="0.5" min="0" value={otHours} onChange={(e) => setOtHours(e.target.value)} placeholder="0" className={inp} /></div>
          <div><label className="mb-1 block text-sm font-medium">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as AttendanceStatus)} className={inp}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
        <div><label className="mb-1 block text-sm font-medium">Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inp} /></div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
      </div>
    </Modal>
  );
}
