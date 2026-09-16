"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, Card, StatCard } from "./ui";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { number, shortDate } from "@/lib/format";
import { setOtStatus, updateOtHours } from "@/app/hr/overtime/actions";
import type { OvertimeRow } from "@/app/hr/overtime/data";
import type { OvertimeStatus } from "@/lib/hr/types";

const STATUSES: OvertimeStatus[] = ["Pending", "Approved", "Rejected"];
const TONE: Record<OvertimeStatus, string> = {
  Pending: "bg-amber-50 text-amber-700 ring-amber-600/20",
  Approved: "bg-green-50 text-green-700 ring-green-600/20",
  Rejected: "bg-red-50 text-red-700 ring-red-600/20",
};

// Inline-editable OT hours (manager can adjust the approved overtime).
function OtHoursCell({ id, hours }: { id: number; hours: number }) {
  const router = useRouter();
  const [v, setV] = useState(String(hours));
  const [pending, start] = useTransition();
  function save() {
    if (Number(v) === Number(hours) || v.trim() === "") { setV(String(hours)); return; }
    start(async () => { const r = await updateOtHours(id, Number(v)); if (!("error" in r)) router.refresh(); });
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} type="number" step="0.5" disabled={pending}
        className="w-16 rounded-lg border border-border bg-stone-50 px-2 py-1 text-center text-sm font-semibold text-amber-700 outline-none focus:border-primary focus:bg-surface" />
      <span className="text-xs text-muted">h</span>
    </span>
  );
}

export function HrOvertimeManager({ rows }: { rows: OvertimeRow[] }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<"all" | OvertimeStatus>("Pending");
  const [empFilter, setEmpFilter] = useState("all");
  const [pending, start] = useTransition();

  const employees = useMemo(() => [...new Map(rows.map((r) => [r.employee_id, r.employee_name])).entries()], [rows]);
  const filtered = useMemo(() => rows.filter((r) =>
    (statusFilter === "all" || r.status === statusFilter) && (empFilter === "all" || String(r.employee_id) === empFilter),
  ), [rows, statusFilter, empFilter]);

  const pg = usePagination(filtered);
  const pendingHrs = useMemo(() => rows.filter((r) => r.status === "Pending").reduce((s, r) => s + r.hours, 0), [rows]);
  const approvedHrs = useMemo(() => rows.filter((r) => r.status === "Approved").reduce((s, r) => s + r.hours, 0), [rows]);

  const act = (fn: () => Promise<{ ok: true } | { error: string }>) => start(async () => { await fn(); router.refresh(); });

  return (
    <div className="space-y-5">
      <div>
      </div>

      <div className="apk-hide grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pending OT" value={`${number(pendingHrs)}h`} tone="warning" />
        <StatCard label="Approved OT" value={`${number(approvedHrs)}h`} tone="success" />
        <StatCard label="Requests" value={String(rows.length)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-surface p-0.5">
          {(["all", ...STATUSES] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s as "all" | OvertimeStatus)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", statusFilter === s ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground")}>
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>
        <select value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} className="rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary">
          <option value="all">All employees</option>
          {employees.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
        </select>
      </div>

      <Card className="overflow-auto max-h-[70vh] rounded-2xl pf-scroll">
        <table className="w-full min-w-[680px] text-sm border-collapse [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <colgroup>
            <col span={2} />
            <col span={2} />
            <col span={2} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={2} className="bg-[#4a3b1a] border-b border-[#caa45a] px-5 py-2">Employee</th>
              <th colSpan={2} className="bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Overtime</th>
              <th colSpan={2} className="bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Status</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="bg-[#5a4a26] px-4 py-3">Employee</th>
              <th className="bg-[#5a4a26] px-4 py-3">Date</th>
              <th className="bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3">OT Hours</th>
              <th className="bg-[#5a4a26] px-4 py-3">Reason</th>
              <th className="bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3">Status</th>
              <th className="bg-[#5a4a26] px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {pg.slice.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-stone-50">
                <td className="px-4 py-3 font-medium">{r.employee_name}</td>
                <td className="px-4 py-3 text-muted">{shortDate(r.work_date)}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3"><OtHoursCell id={r.id} hours={r.hours} /></td>
                <td className="px-4 py-3 text-muted">{r.reason || "—"}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3"><span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE[r.status])}>{r.status}</span></td>
                <td className="px-4 py-3">
                  <div className="flex justify-center gap-2">
                    {r.status !== "Approved" && <button onClick={() => act(() => setOtStatus(r.id, "Approved"))} disabled={pending} className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">Approve</button>}
                    {r.status !== "Rejected" && <button onClick={() => act(() => setOtStatus(r.id, "Rejected"))} disabled={pending} className="rounded-lg px-2.5 py-1 text-xs font-medium text-danger ring-1 ring-inset ring-red-600/20 hover:bg-red-50 disabled:opacity-50">Reject</button>}
                    {r.status !== "Pending" && <button onClick={() => act(() => setOtStatus(r.id, "Pending"))} disabled={pending} className="rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-border hover:bg-stone-100 disabled:opacity-50">Reset</button>}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">No overtime requests.</td></tr>}
          </tbody>
        </table>
        {filtered.length > 0 && <PaginationFooter {...pg} />}
      </Card>
    </div>
  );
}
