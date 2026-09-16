"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, Card } from "./ui";
import { Modal } from "./modal";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { number, shortDate } from "@/lib/format";
import { createLeave, updateLeave, deleteLeave, setLeaveStatus, setRestDays, type LeaveInput } from "@/app/hr/leaves/actions";
import type { LeaveRow, EmployeeLite } from "@/app/hr/leaves/data";
import { DAYS_OFF, type LeaveType, type LeaveStatus } from "@/lib/hr/types";

const LEAVE_TYPES: LeaveType[] = ["Vacation", "Sick", "Emergency", "Unpaid", "Restday"];
const STATUS_FILTERS: ("All" | LeaveStatus)[] = ["All", "Pending", "Approved", "Rejected"];

const TYPE_TONE: Record<LeaveType, string> = {
  Vacation: "bg-blue-50 text-blue-700 ring-blue-600/20",
  Sick: "bg-rose-50 text-rose-700 ring-rose-600/20",
  Emergency: "bg-orange-50 text-orange-700 ring-orange-600/20",
  Unpaid: "bg-stone-100 text-stone-600 ring-stone-500/20",
  Restday: "bg-violet-50 text-violet-700 ring-violet-600/20",
};
const STATUS_TONE: Record<LeaveStatus, string> = {
  Pending: "bg-amber-50 text-amber-700 ring-amber-600/20",
  Approved: "bg-green-50 text-green-700 ring-green-600/20",
  Rejected: "bg-red-50 text-red-700 ring-red-600/20",
};

function Pill({ value, tone }: { value: string; tone: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tone)}>{value}</span>;
}

export function HrLeavesManager({ rows, employees }: { rows: LeaveRow[]; employees: EmployeeLite[] }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<"All" | LeaveStatus>("All");
  const [empFilter, setEmpFilter] = useState<number | "all">("all");
  const [form, setForm] = useState<LeaveRow | "new" | null>(null);
  const [restEdit, setRestEdit] = useState<EmployeeLite | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "All" && r.status !== statusFilter) return false;
      if (empFilter !== "all" && r.employee_id !== empFilter) return false;
      return true;
    });
  }, [rows, statusFilter, empFilter]);
  const pg = usePagination(filtered);

  const counts = {
    All: rows.length,
    Pending: rows.filter((r) => r.status === "Pending").length,
    Approved: rows.filter((r) => r.status === "Approved").length,
    Rejected: rows.filter((r) => r.status === "Rejected").length,
  };

  function decide(id: number, status: Extract<LeaveStatus, "Approved" | "Rejected">) {
    setErr(null);
    start(async () => {
      const res = await setLeaveStatus(id, status);
      if ("error" in res) setErr(res.error);
      else router.refresh();
    });
  }

  function remove(r: LeaveRow) {
    if (!confirm(`Delete ${r.employee_name}'s ${r.leave_type.toLowerCase()} request?`)) return;
    setErr(null);
    start(async () => {
      const res = await deleteLeave(r.id);
      if ("error" in res) setErr(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
        </div>
        <button onClick={() => setForm("new")} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90">+ Request leave</button>
      </div>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{err}</p>}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors",
                statusFilter === s ? "bg-primary text-primary-foreground ring-primary" : "bg-stone-50 text-muted ring-border hover:bg-stone-100",
              )}
            >
              {s} <span className="opacity-70">({counts[s]})</span>
            </button>
          ))}
        </div>
        <select
          value={empFilter === "all" ? "all" : String(empFilter)}
          onChange={(e) => setEmpFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="all">All employees</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <Card className="max-h-[70vh] overflow-auto pf-scroll">
        <table className="w-full min-w-[860px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={1} className="border-b border-[#caa45a] bg-[#4a3b1a] px-5 py-2">Employee</th>
              <th colSpan={5} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a] px-5 py-2">Leave Details</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a] px-5 py-2">Status</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="bg-[#5a4a26] px-5 py-3">Employee</th>
              <th className="!border-l-4 !border-l-[#caa45a] bg-[#5a4a26] px-5 py-3">Type</th>
              <th className="bg-[#5a4a26] px-5 py-3">From – To</th>
              <th className="bg-[#5a4a26] px-5 py-3">Days</th>
              <th className="bg-[#5a4a26] px-5 py-3">Paid</th>
              <th className="bg-[#5a4a26] px-5 py-3">Reason</th>
              <th className="!border-l-4 !border-l-[#caa45a] bg-[#5a4a26] px-5 py-3">Status</th>
              <th className="bg-[#5a4a26] px-5 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pg.slice.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-stone-50">
                <td className="px-5 py-3 font-medium">{r.employee_name}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3"><Pill value={r.leave_type} tone={TYPE_TONE[r.leave_type]} /></td>
                <td className="px-5 py-3 whitespace-nowrap text-muted">{shortDate(r.date_from)} – {shortDate(r.date_to)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{number(r.days)}</td>
                <td className="px-5 py-3 text-center">{r.paid ? <span className="text-success">Yes</span> : <span className="text-muted">No</span>}</td>
                <td className="px-5 py-3 max-w-[220px] truncate text-muted" title={r.reason ?? ""}>{r.reason || "—"}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3"><Pill value={r.status} tone={STATUS_TONE[r.status]} /></td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {r.status === "Pending" && (
                      <>
                        <button onClick={() => decide(r.id, "Approved")} disabled={pending} className="rounded-md px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20 hover:bg-green-50 disabled:opacity-60">Approve</button>
                        <button onClick={() => decide(r.id, "Rejected")} disabled={pending} className="rounded-md px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20 hover:bg-red-50 disabled:opacity-60">Reject</button>
                      </>
                    )}
                    <button onClick={() => setForm(r)} className="rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Edit</button>
                    <button onClick={() => remove(r)} disabled={pending} className="rounded-md px-2 py-1 text-xs font-medium text-danger ring-1 ring-inset ring-red-600/20 hover:bg-red-50 disabled:opacity-60">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-muted">No leave requests{statusFilter !== "All" ? ` with status “${statusFilter}”` : ""}.</td></tr>
            )}
          </tbody>
        </table>
        {filtered.length > 0 && <PaginationFooter {...pg} />}
      </Card>

      {/* Weekly rest days panel — click an employee to edit */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">Weekly Rest Days <span className="font-normal text-muted">· tap an employee to set</span></h2>
        {employees.length === 0 ? (
          <p className="text-sm text-muted">No active employees.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {employees.map((e) => (
              <button key={e.id} onClick={() => setRestEdit(e)} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:border-primary hover:bg-stone-50">
                <span className="truncate text-sm font-medium">{e.name}</span>
                {e.day_off
                  ? <Pill value={e.day_off} tone="bg-violet-50 text-violet-700 ring-violet-600/20" />
                  : <span className="text-xs text-muted">Not set</span>}
              </button>
            ))}
          </div>
        )}
      </Card>

      {form && <LeaveForm row={form === "new" ? null : form} employees={employees} onClose={() => setForm(null)} />}
      {restEdit && <RestDayEditor emp={restEdit} onClose={() => setRestEdit(null)} />}
    </div>
  );
}

function RestDayEditor({ emp, onClose }: { emp: EmployeeLite; onClose: () => void }) {
  const router = useRouter();
  const [days, setDays] = useState<string[]>(emp.day_off ? emp.day_off.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (d: string) => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
  function save() {
    setError(null);
    start(async () => { const r = await setRestDays(emp.id, days); if ("error" in r) setError(r.error); else { onClose(); router.refresh(); } });
  }
  return (
    <Modal open onClose={onClose} title={`Rest days — ${emp.name}`} size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
          <button onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">Save</button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">Pick one or more weekly rest days.</p>
        <div className="flex flex-wrap gap-1.5">
          {DAYS_OFF.map((d) => {
            const on = days.includes(d);
            return (
              <button key={d} type="button" onClick={() => toggle(d)}
                className={cn("rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors", on ? "bg-primary text-primary-foreground ring-primary" : "bg-surface text-muted ring-border hover:bg-stone-100")}>
                {d}
              </button>
            );
          })}
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
      </div>
    </Modal>
  );
}

function LeaveForm({ row, employees, onClose }: { row: LeaveRow | null; employees: EmployeeLite[]; onClose: () => void }) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState<number | "">(row?.employee_id ?? (employees[0]?.id ?? ""));
  const [leaveType, setLeaveType] = useState<LeaveType>(row?.leave_type ?? "Vacation");
  const [dateFrom, setDateFrom] = useState(row?.date_from ?? "");
  const [dateTo, setDateTo] = useState(row?.date_to ?? "");
  const [paid, setPaid] = useState(row?.paid ?? false);
  const [reason, setReason] = useState(row?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inp = "w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary";

  function save() {
    setError(null);
    if (!employeeId) return setError("Select an employee.");
    if (!dateFrom || !dateTo) return setError("Both dates are required.");
    const input: LeaveInput = {
      employee_id: Number(employeeId),
      leave_type: leaveType,
      date_from: dateFrom,
      date_to: dateTo,
      days: null,
      paid,
      reason: reason.trim() || null,
    };
    start(async () => {
      const res = row ? await updateLeave(row.id, input) : await createLeave(input);
      if ("error" in res) setError(res.error);
      else { onClose(); router.refresh(); }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={row ? "Edit leave request" : "Request leave"}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
          <button onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">Save</button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Employee</label>
          <select value={employeeId === "" ? "" : String(employeeId)} onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : "")} className={inp}>
            <option value="" disabled>Select employee…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Type</label>
          <select value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)} className={inp}>
            {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="mb-1 block text-sm font-medium">From</label><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inp} /></div>
          <div><label className="mb-1 block text-sm font-medium">To</label><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inp} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4 accent-primary" /> Paid leave</label>
        <div><label className="mb-1 block text-sm font-medium">Reason</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inp} placeholder="Optional" /></div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
      </div>
    </Modal>
  );
}
