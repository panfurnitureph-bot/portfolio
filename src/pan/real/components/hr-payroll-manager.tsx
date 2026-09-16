"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, cn } from "@/components/ui";
import { peso, number, shortDate } from "@/lib/format";
import type { PayrollRun } from "@/lib/hr/types";
import type { PayslipRow } from "@/app/hr/payroll/data";
import type { PayrollConfig } from "@/lib/hr/payroll";
import { createRun, deleteRun, generatePayslips, finalizeRun, reopenRun, getPayslips, savePayslip, deletePayslip, savePayrollConfig } from "@/app/hr/payroll/actions";
import { PayslipDocButton } from "@/components/payslip-doc";
import { PaginationFooter, usePagination } from "@/components/pagination-footer";

const inp = "w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface";
const btnP = "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60";
const btnG = "rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-60";

export function HrPayrollManager({ runs, initialRunId, initialSlips, config }: { runs: PayrollRun[]; initialRunId: number | null; initialSlips: PayslipRow[]; config: PayrollConfig }) {
  const router = useRouter();
  const [sel, setSel] = useState<number | null>(initialRunId);
  const [slips, setSlips] = useState<PayslipRow[]>(initialSlips);
  const [pending, start] = useTransition();
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; msg: string; label: string; danger?: boolean; onYes: () => void } | null>(null);
  const [editSlip, setEditSlip] = useState<PayslipRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = runs.find((r) => r.id === sel) ?? null;
  const finalized = run?.status === "Finalized";

  const totals = useMemo(() => slips.reduce((t, s) => ({
    gross: t.gross + s.gross, net: t.net + s.net_pay,
    ded: t.ded + s.sss + s.philhealth + s.pagibig + s.tax + s.cash_advance + s.other_deductions,
  }), { gross: 0, net: 0, ded: 0 }), [slips]);

  const pg = usePagination(slips, 25);

  // Selecting a run auto-generates if it's a Draft with no payslips yet (no
  // manual button). Existing slips are left untouched so edits aren't wiped.
  function pick(id: number) {
    setSel(id); setMsg(null);
    start(async () => {
      let s = await getPayslips(id);
      const r = runs.find((x) => x.id === id);
      if ((!r || r.status !== "Finalized") && s.length === 0) {
        // Surface WHY nothing generated (grant missing, no matching employees, etc.)
        // instead of silently showing an empty run.
        const g = await generatePayslips(id);
        if ("error" in g) setMsg(g.error);
        else if (g.count === 0) setMsg(`0 payslips — ${g.note ?? "no employee matched this period."}`);
        s = await getPayslips(id);
      }
      setSlips(s);
    });
  }
  function fin() {
    if (!sel) return;
    setConfirm({ title: "Finalize payroll?", msg: "Advances will be deducted and project work marked as Paid. This locks the run.", label: "Finalize", onYes: () => start(async () => { const r = await finalizeRun(sel); if ("error" in r) setMsg(r.error); else router.refresh(); }) });
  }
  function reopen() {
    if (!sel) return;
    setConfirm({ title: "Reopen run?", msg: "Returns the run to Draft for editing. Advance deductions already applied are NOT reversed.", label: "Reopen", onYes: () => start(async () => { const r = await reopenRun(sel); if ("error" in r) setMsg(r.error); else { setSlips(await getPayslips(sel)); router.refresh(); } }) });
  }
  function delRun(id: number) {
    setConfirm({ title: "Delete payroll run?", msg: "This run and all its payslips will be deleted. This cannot be undone.", label: "Delete", danger: true, onYes: () => start(async () => { const r = await deleteRun(id); if (!("error" in r)) { if (sel === id) { setSel(null); setSlips([]); } router.refresh(); } }) });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSettings(true)} className={btnG}>Benefits Settings</button>
          <button onClick={() => setShowNew(true)} className={btnP}>+ New Run</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        {/* Runs list */}
        <Card className="rounded-2xl p-3">
          <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">Pay Periods</p>
          <ul className="mt-1 space-y-1">
            {runs.map((r) => (
              <li key={r.id}>
                <button onClick={() => pick(r.id)} className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors", sel === r.id ? "bg-stone-200/70 font-medium" : "hover:bg-stone-100")}>
                  <span>
                    <span className="block">{shortDate(r.period_start)} – {shortDate(r.period_end)}</span>
                    <span className="flex items-center gap-1.5">
                      <span className={cn("text-[11px] font-medium", r.status === "Finalized" ? "text-success" : "text-amber-600")}>{r.status}</span>
                      <span className={cn("rounded-full px-1.5 text-[10px] font-medium", r.pay_type === "Weekly" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700")}>{r.pay_type === "Weekly" ? "Constructor" : "Regular"}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {runs.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No payroll runs yet.</li>}
          </ul>
        </Card>

        {/* Payslips */}
        <Card className="rounded-2xl p-5">
          {run ? (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">{shortDate(run.period_start)} – {shortDate(run.period_end)}</h2>
                  <p className="text-xs text-muted">{run.pay_date ? `Pay date ${shortDate(run.pay_date)} · ` : ""}<span className={finalized ? "text-success" : "text-amber-600"}>{run.status}</span></p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!finalized && slips.length > 0 && <button onClick={fin} disabled={pending} className={btnP}>Finalize</button>}
                  {finalized && <button onClick={reopen} disabled={pending} className={btnG}>Reopen to edit</button>}
                  <button onClick={() => printRun(run, slips, totals)} disabled={!slips.length} className={btnG}>Print</button>
                  {!finalized && <button onClick={() => delRun(run.id)} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-danger ring-1 ring-inset ring-red-600/20 hover:bg-red-50">Delete</button>}
                </div>
              </div>
              {msg && <p className="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-foreground">{msg}</p>}

              {slips.length ? (
                <>
                <div className="max-h-[70vh] overflow-auto pf-scroll">
                  <table className="w-full min-w-[920px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&_th]:bg-[#4a3b1a]">
                        <th colSpan={2} className="border-b border-[#caa45a] px-5 py-2">Employee</th>
                        <th colSpan={6} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Earnings &amp; Deductions</th>
                        <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Net</th>
                      </tr>
                      <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&_th]:bg-[#5a4a26]">
                        <th className="px-2 py-2">Employee</th>
                        <th className="px-2 py-2">Days</th>
                        <th className="!border-l-4 !border-l-[#caa45a] px-2 py-2">Gross</th>
                        <th className="px-2 py-2">SSS</th>
                        <th className="px-2 py-2">PhilHealth</th>
                        <th className="px-2 py-2">Pag-IBIG</th>
                        <th className="px-2 py-2">Tax</th>
                        <th className="px-2 py-2">Advance</th>
                        <th className="!border-l-4 !border-l-[#caa45a] px-2 py-2">Net Pay</th>
                        <th className="px-2 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pg.slice.map((s) => (
                        <tr key={s.id} className="border-b border-border last:border-0 hover:bg-stone-50">
                          <td className="px-2 py-2 font-medium">{s.employee_name}</td>
                          <td className="px-2 py-2 text-right text-muted">{number(s.days_worked)}</td>
                          <td className="!border-l-4 !border-l-[#caa45a] px-2 py-2 text-right">{peso(s.gross)}</td>
                          <td className="px-2 py-2 text-right text-muted">{peso(s.sss)}</td>
                          <td className="px-2 py-2 text-right text-muted">{peso(s.philhealth)}</td>
                          <td className="px-2 py-2 text-right text-muted">{peso(s.pagibig)}</td>
                          <td className="px-2 py-2 text-right text-muted">{peso(s.tax)}</td>
                          <td className="px-2 py-2 text-right text-muted">{s.cash_advance ? peso(s.cash_advance) : "—"}</td>
                          <td className="!border-l-4 !border-l-[#caa45a] px-2 py-2 text-right font-semibold text-primary">{peso(s.net_pay)}</td>
                          <td className="px-2 py-2 text-right">
                            <div className="flex justify-end gap-1.5">
                              <PayslipDocButton payslipId={s.id} />
                              {!finalized && <button onClick={() => setEditSlip(s)} className="rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Edit</button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border font-semibold">
                        <td className="px-2 py-2">Total ({slips.length})</td>
                        <td /><td className="!border-l-4 !border-l-[#caa45a] px-2 py-2 text-right">{peso(totals.gross)}</td>
                        <td colSpan={4} className="px-2 py-2 text-right text-muted">Deductions {peso(totals.ded)}</td>
                        <td /><td className="!border-l-4 !border-l-[#caa45a] px-2 py-2 text-right text-primary">{peso(totals.net)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <PaginationFooter page={pg.page} setPage={pg.setPage} pageSize={pg.pageSize} setPageSize={pg.setPageSize} total={pg.total} pages={pg.pages} />
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <p className="text-sm text-muted">{pending ? "Generating payslips…" : "No matching employees for this period."}</p>
                  <p className="max-w-sm text-xs text-muted">{run.pay_type === "Weekly" ? "Weekly runs pay constructors with project work in this period." : "Semi-monthly runs pay regular staff with attendance in this period."}</p>
                </div>
              )}
            </>
          ) : <p className="py-12 text-center text-sm text-muted">Select or create a pay period.</p>}
        </Card>
      </div>

      {showNew && <NewRunModal onClose={() => setShowNew(false)} onCreated={(id) => pick(id)} />}
      {showSettings && <BenefitsModal config={config} onClose={() => setShowSettings(false)} />}
      {editSlip && <EditSlipModal slip={editSlip} onClose={() => setEditSlip(null)} />}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="text-sm text-muted">{confirm.msg}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setConfirm(null)} className={btnG}>Cancel</button>
            <button onClick={() => { confirm.onYes(); setConfirm(null); }} className={confirm.danger ? "rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90" : btnP}>{confirm.label}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NewRunModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const router = useRouter();
  const [f, setF] = useState<{ start: string; end: string; pay: string; type: "Semi-monthly" | "Weekly" }>({ start: "", end: "", pay: "", type: "Semi-monthly" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function save() {
    setError(null);
    start(async () => {
      const r = await createRun(f.start, f.end, f.pay || null, f.type);
      if ("error" in r) { setError(r.error); return; }
      const g = await generatePayslips(r.id); // auto-generate payslips for the new run
      if ("error" in g) { setError(`Run created, but nothing was generated: ${g.error}`); return; }
      onClose();
      onCreated(r.id); // select + load the new run immediately
      router.refresh();
    });
  }
  return (
    <Modal title="New Pay Period" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Pay type</label>
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            {(["Semi-monthly", "Weekly"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setF((p) => ({ ...p, type: t }))} className={cn("flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors", f.type === t ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground")}>{t}</button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{f.type === "Weekly" ? "Pays constructors (project-based) only." : "Pays regular employees only."}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="mb-1 block text-sm font-medium">Period start</label><input value={f.start} onChange={(e) => setF((p) => ({ ...p, start: e.target.value }))} type="date" className={inp} /></div>
          <div><label className="mb-1 block text-sm font-medium">Period end</label><input value={f.end} onChange={(e) => setF((p) => ({ ...p, end: e.target.value }))} type="date" className={inp} /></div>
        </div>
        <div><label className="mb-1 block text-sm font-medium">Pay date (optional)</label><input value={f.pay} onChange={(e) => setF((p) => ({ ...p, pay: e.target.value }))} type="date" className={inp} /></div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className={btnG}>Cancel</button><button onClick={save} disabled={pending || !f.start || !f.end} className={btnP}>{pending ? "Saving…" : "Create"}</button></div>
    </Modal>
  );
}

function EditSlipModal({ slip, onClose }: { slip: PayslipRow; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    allowance: String(slip.allowance), sss: String(slip.sss), philhealth: String(slip.philhealth),
    pagibig: String(slip.pagibig), tax: String(slip.tax), cash: String(slip.cash_advance), other: String(slip.other_deductions),
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const n = (v: string) => Number(v) || 0;
  const gross = Number(slip.basic_pay) + Number(slip.ot_pay) + n(f.allowance);
  const net = gross - n(f.sss) - n(f.philhealth) - n(f.pagibig) - n(f.tax) - n(f.cash) - n(f.other);
  const fld = (key: keyof typeof f, label: string) => (
    <div><label className="mb-1 block text-sm font-medium">{label}</label><input value={f[key]} onChange={(e) => setF((p) => ({ ...p, [key]: e.target.value }))} type="number" className={inp} /></div>
  );
  function save() { setError(null); start(async () => { const r = await savePayslip(slip.id, { allowance: n(f.allowance), sss: n(f.sss), philhealth: n(f.philhealth), pagibig: n(f.pagibig), tax: n(f.tax), cash_advance: n(f.cash), other_deductions: n(f.other) }); if ("error" in r) setError(r.error); else { onClose(); router.refresh(); } }); }
  function del() { if (!confirm("Delete this payslip?")) return; start(async () => { const r = await deletePayslip(slip.id); if (!("error" in r)) { onClose(); router.refresh(); } }); }
  return (
    <Modal title={`Adjust — ${slip.employee_name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-muted">Basic {peso(slip.basic_pay)} · OT {peso(slip.ot_pay)}. Edit any value below — net updates live.</p>
        {fld("allowance", "Allowance")}
        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Contributions</p>
        <div className="grid grid-cols-2 gap-3">{fld("sss", "SSS")}{fld("philhealth", "PhilHealth")}{fld("pagibig", "Pag-IBIG")}{fld("tax", "Withholding tax")}</div>
        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Other</p>
        <div className="grid grid-cols-2 gap-3">{fld("cash", "Cash advance")}{fld("other", "Other deductions")}</div>
        <div className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2">
          <span className="text-sm">Gross {peso(gross)} → <span className="font-medium">Net pay</span></span>
          <span className={cn("text-base font-semibold", net < 0 ? "text-danger" : "text-primary")}>{peso(net)}</span>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
      <div className="mt-5 flex items-center justify-between gap-2">
        <button onClick={del} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-danger ring-1 ring-inset ring-red-600/20 hover:bg-red-50">Delete</button>
        <div className="flex gap-2"><button onClick={onClose} className={btnG}>Cancel</button><button onClick={save} disabled={pending} className={btnP}>{pending ? "Saving…" : "Save"}</button></div>
      </div>
    </Modal>
  );
}

function Switch({ on, label, hint, onToggle }: { on: boolean; label: string; hint: string; onToggle: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onToggle(!on)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-stone-50">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <span className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-stone-300")}>
        <span className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", on && "translate-x-5")} />
      </span>
    </button>
  );
}

function ContribRow({ on, label, hint, rate, onRate, onToggle }: { on: boolean; label: string; hint: string; rate?: number; onRate?: (v: number) => void; onToggle: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {onRate && (
          <div className={cn("flex items-center gap-1 rounded-lg border border-border bg-stone-50 px-2 py-1", !on && "opacity-40")}>
            <input value={String(rate ?? 0)} onChange={(e) => onRate(Number(e.target.value))} disabled={!on} type="number" step="0.1" className="w-12 bg-transparent text-right text-sm outline-none" />
            <span className="text-xs text-muted">%</span>
          </div>
        )}
        <button type="button" onClick={() => onToggle(!on)} className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-stone-300")}>
          <span className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", on && "translate-x-5")} />
        </button>
      </div>
    </div>
  );
}

function BenefitsModal({ config, onClose }: { config: PayrollConfig; onClose: () => void }) {
  const router = useRouter();
  const [c, setC] = useState<PayrollConfig>(config);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof PayrollConfig, v: number | boolean) => setC((p) => ({ ...p, [k]: v }));
  function save() { setError(null); start(async () => { const r = await savePayrollConfig(c); if ("error" in r) setError(r.error); else { onClose(); router.refresh(); } }); }

  return (
    <Modal title="Benefits Settings" onClose={onClose}>
      <div className="space-y-2.5">
        <p className="text-xs text-muted">Applies to all regular employees. Constructors (project-based) are always excluded. Set the deduction % for each below.</p>

        <Switch on={c.statutoryEnabled} label="Government contributions" hint={c.statutoryEnabled ? "ON — deductions applied" : "OFF — no deductions"} onToggle={(v) => set("statutoryEnabled", v)} />

        {c.statutoryEnabled && (
          <div className="space-y-2">
            <ContribRow on={c.sssEnabled} label="SSS" hint="deduction % of salary" rate={c.sssRate} onRate={(v) => set("sssRate", v)} onToggle={(v) => set("sssEnabled", v)} />
            <ContribRow on={c.philhealthEnabled} label="PhilHealth" hint="split with employer" rate={c.philhealthRate} onRate={(v) => set("philhealthRate", v)} onToggle={(v) => set("philhealthEnabled", v)} />
            <ContribRow on={c.pagibigEnabled} label="Pag-IBIG" hint={`max ₱${Math.round(c.pagibigCap * c.pagibigRate / 100)}`} rate={c.pagibigRate} onRate={(v) => set("pagibigRate", v)} onToggle={(v) => set("pagibigEnabled", v)} />
            <ContribRow on={c.taxEnabled} label="Withholding tax" hint="BIR TRAIN table (automatic)" onToggle={(v) => set("taxEnabled", v)} />
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">Tip: after saving, <b>Generate</b> the Draft run again to apply.</p>
      </div>
      <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className={btnG}>Cancel</button><button onClick={save} disabled={pending} className={btnP}>{pending ? "Saving…" : "Save"}</button></div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 bg-[#4a4020] bg-gradient-to-br from-[#5b5026] to-[#3a3318] px-6 py-4 text-accent">
          <h3 className="text-base font-semibold text-white">{title}</h3>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// Print a simple payroll register.
function printRun(run: PayrollRun, slips: PayslipRow[], totals: { gross: number; net: number; ded: number }) {
  const rows = slips.map((s) => `<tr><td>${s.employee_name}</td><td style="text-align:right">${number(s.days_worked)}</td><td style="text-align:right">${peso(s.gross)}</td><td style="text-align:right">${peso(s.sss)}</td><td style="text-align:right">${peso(s.philhealth)}</td><td style="text-align:right">${peso(s.pagibig)}</td><td style="text-align:right">${peso(s.tax)}</td><td style="text-align:right">${peso(s.cash_advance)}</td><td style="text-align:right"><b>${peso(s.net_pay)}</b></td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Payroll ${shortDate(run.period_start)}–${shortDate(run.period_end)}</title>
  <style>body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#2a2519}h1{font-size:18px}h2{font-size:13px;color:#666;font-weight:500}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}th,td{border:1px solid #ddd;padding:6px 8px}th{background:#f4f1e8;text-align:left}tfoot td{font-weight:700;background:#faf8f2}</style></head>
  <body><h1>Pan Furniture — Payroll Register</h1><h2>${shortDate(run.period_start)} – ${shortDate(run.period_end)} · ${run.status}</h2>
  <table><thead><tr><th>Employee</th><th>Days</th><th>Gross</th><th>SSS</th><th>PhilHealth</th><th>Pag-IBIG</th><th>Tax</th><th>Advance</th><th>Net Pay</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="2">Total (${slips.length})</td><td style="text-align:right">${peso(totals.gross)}</td><td colspan="4" style="text-align:right">Deductions ${peso(totals.ded)}</td><td></td><td style="text-align:right">${peso(totals.net)}</td></tr></tfoot></table>
  <script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open("", "_blank"); if (w) { w.document.write(html); w.document.close(); }
}
