"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, Card, StatCard } from "./ui";
import { Modal } from "./modal";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { peso, shortDate } from "@/lib/format";
import { createAdvance, updateAdvance, deleteAdvance, settleAdvance, type AdvanceInput } from "@/app/hr/advances/actions";
import type { AdvanceRow, EmployeeLite } from "@/app/hr/advances/data";

type Status = "Open" | "Settled";
const STATUSES: Status[] = ["Open", "Settled"];
const inp = "w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface";

const remaining = (r: AdvanceRow) => Math.max(0, (r.amount || 0) - (r.deducted || 0));

function StatusBadge({ status }: { status: Status }) {
  const tone = status === "Settled" ? "bg-green-50 text-green-700 ring-green-600/20" : "bg-amber-50 text-amber-700 ring-amber-600/20";
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tone)}>{status}</span>;
}

export function HrAdvancesManager({ rows, employees }: { rows: AdvanceRow[]; employees: EmployeeLite[] }) {
  const router = useRouter();
  const [empFilter, setEmpFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [form, setForm] = useState<AdvanceRow | "new" | null>(null);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (empFilter !== "all" && String(r.employee_id) !== empFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      return true;
    });
  }, [rows, empFilter, statusFilter]);
  const pg = usePagination(filtered);

  const totalOutstanding = useMemo(
    () => rows.filter((r) => r.status === "Open").reduce((s, r) => s + remaining(r), 0),
    [rows],
  );

  function settle(id: number) {
    if (!confirm("Mark this advance as settled?")) return;
    start(async () => { const res = await settleAdvance(id); if ("error" in res) alert(res.error); else router.refresh(); });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
        </div>
        <button onClick={() => setForm("new")} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90">+ New advance</button>
      </div>

      <div className="apk-hide grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total outstanding" value={peso(totalOutstanding)} tone="warning" />
        <StatCard label="Advances" value={String(rows.length)} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} className={cn(inp, "max-w-xs")}>
          <option value="all">All employees</option>
          {employees.map((e) => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={cn(inp, "max-w-[12rem]")}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card className="overflow-auto pf-scroll max-h-[70vh]">
        <table className="w-full min-w-[860px] text-sm border-collapse [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <colgroup>
            <col span={2} />
            <col span={3} />
            <col span={2} />
            <col span={1} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={2} className="border-b border-[#caa45a] px-5 py-2">Employee</th>
              <th colSpan={3} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Amount</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Details</th>
              <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2"></th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="px-5 py-3">Employee</th>
              <th className="px-5 py-3">Date issued</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-5 py-3">Amount</th>
              <th className="px-5 py-3">Deducted</th>
              <th className="px-5 py-3">Remaining</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-5 py-3">Reason</th>
              <th className="px-5 py-3">Status</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-5 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {pg.slice.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-stone-50">
                <td className="px-5 py-3 font-medium"><button onClick={() => setForm(r)} className="hover:underline">{r.employee_name}</button></td>
                <td className="px-5 py-3">{shortDate(r.date_issued)}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3 text-right tabular-nums">{peso(r.amount)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{peso(r.deducted)}</td>
                <td className="px-5 py-3 text-right tabular-nums font-medium">{peso(remaining(r))}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3 text-muted">{r.reason || "—"}</td>
                <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3 text-right">
                  {r.status === "Open" ? (
                    <button onClick={() => settle(r.id)} disabled={pending} className="rounded-lg px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/30 hover:bg-primary/5 disabled:opacity-60">Settle</button>
                  ) : <span className="text-xs text-muted">—</span>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-muted">No advances yet. Click &ldquo;New advance&rdquo; to record a cash advance.</td></tr>
            )}
          </tbody>
        </table>
        {filtered.length > 0 && <PaginationFooter {...pg} />}
      </Card>

      {form && <AdvanceForm row={form === "new" ? null : form} employees={employees} onClose={() => setForm(null)} />}
    </div>
  );
}

function AdvanceForm({ row, employees, onClose }: { row: AdvanceRow | null; employees: EmployeeLite[]; onClose: () => void }) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState<string>(row ? String(row.employee_id) : (employees[0] ? String(employees[0].id) : ""));
  const [amount, setAmount] = useState(row?.amount != null ? String(row.amount) : "");
  const [deducted, setDeducted] = useState(row?.deducted != null ? String(row.deducted) : "0");
  const [dateIssued, setDateIssued] = useState(row?.date_issued ?? new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState(row?.reason ?? "");
  const [status, setStatus] = useState<Status>(row?.status ?? "Open");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    const input: AdvanceInput = {
      employee_id: Number(employeeId),
      amount: amount.trim() ? Number(amount) : 0,
      deducted: deducted.trim() ? Number(deducted) : 0,
      date_issued: dateIssued,
      reason,
      status,
    };
    start(async () => {
      const res = row ? await updateAdvance(row.id, input) : await createAdvance(input);
      if ("error" in res) setError(res.error);
      else { onClose(); router.refresh(); }
    });
  }
  function del() {
    if (!row || !confirm("Delete this advance?")) return;
    start(async () => { const res = await deleteAdvance(row.id); if ("error" in res) setError(res.error); else { onClose(); router.refresh(); } });
  }

  return (
    <Modal open onClose={onClose} title={row ? "Edit advance" : "New advance"} size="sm"
      footer={
        <div className="flex items-center justify-between gap-2">
          {row ? <button onClick={del} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-danger ring-1 ring-inset ring-red-600/20 hover:bg-red-50">Delete</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
            <button onClick={save} disabled={pending || !employeeId} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">Save</button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div><label className="mb-1 block text-sm font-medium">Employee</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inp}>
            {!employees.length && <option value="">No active employees</option>}
            {employees.map((e) => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="mb-1 block text-sm font-medium">Amount</label><input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="₱" className={inp} /></div>
          <div><label className="mb-1 block text-sm font-medium">Date issued</label><input value={dateIssued} onChange={(e) => setDateIssued(e.target.value)} type="date" className={inp} /></div>
        </div>
        {row && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-sm font-medium">Deducted</label><input value={deducted} onChange={(e) => setDeducted(e.target.value)} type="number" placeholder="₱" className={inp} /></div>
            <div><label className="mb-1 block text-sm font-medium">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={inp}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        )}
        <div><label className="mb-1 block text-sm font-medium">Reason</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inp} /></div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
      </div>
    </Modal>
  );
}
