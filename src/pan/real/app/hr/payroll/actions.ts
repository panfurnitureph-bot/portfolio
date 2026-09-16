"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { money } from "@/lib/num";
import { computePayslip, computeProjectPayslip, type RateType, type PayrollConfig } from "@/lib/hr/payroll";
import { loadPayslips, loadPayrollConfig, loadPayslipDetail, type PayslipRow, type PayslipDetail } from "./data";

// Save the overall benefits/contribution settings (managers/admins).
export async function savePayrollConfig(cfg: PayrollConfig): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const num = (v: number) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const clean: PayrollConfig = {
    statutoryEnabled: !!cfg.statutoryEnabled, taxEnabled: !!cfg.taxEnabled,
    sssEnabled: !!cfg.sssEnabled, philhealthEnabled: !!cfg.philhealthEnabled, pagibigEnabled: !!cfg.pagibigEnabled,
    sssRate: num(cfg.sssRate), sssFloor: num(cfg.sssFloor), sssCeiling: num(cfg.sssCeiling),
    philhealthRate: num(cfg.philhealthRate), philhealthFloor: num(cfg.philhealthFloor), philhealthCeiling: num(cfg.philhealthCeiling),
    pagibigRate: num(cfg.pagibigRate), pagibigCap: num(cfg.pagibigCap),
  };
  const db = createServerSupabase();
  const { error } = await db.from("app_settings").upsert({ key: "payroll_settings", value: clean, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { error: error.message };
  revalidatePath("/hr/payroll");
  return { ok: true };
}

export async function getPayslips(runId: number): Promise<PayslipRow[]> {
  await requireManager();
  return loadPayslips(runId);
}

export async function getPayslipDetail(payslipId: number): Promise<PayslipDetail | null> {
  await requireManager();
  return loadPayslipDetail(payslipId);
}

async function requireManager() {
  const me = await getSession();
  if (!me || !hasPermission(me, "hr_payroll", "edit")) throw new Error("Forbidden.");
  return me;
}

type SB = ReturnType<typeof createServerSupabase>;

export async function createRun(periodStart: string, periodEnd: string, payDate: string | null, payType: "Semi-monthly" | "Weekly" = "Semi-monthly"): Promise<{ ok: true; id: number } | { error: string }> {
  await requireManager();
  if (!periodStart || !periodEnd) return { error: "Period start and end are required." };
  const db = createServerSupabase();
  const { data, error } = await db.from("hr_payroll_runs").insert({ period_start: periodStart, period_end: periodEnd, pay_date: payDate || null, status: "Draft", pay_type: payType }).select("id").single();
  if (error) return { error: /duplicate|unique/i.test(error.message) ? `A ${payType} run for this period already exists.` : error.message };
  await auditAfter({ module: "hr_payroll", table: "hr_payroll_runs", recordId: data?.id ?? "—", action: "insert", snapshotTable: "hr_payroll_runs", snapshotId: data?.id });
  revalidatePath("/hr/payroll");
  return { ok: true, id: data!.id as number };
}

export async function deleteRun(id: number): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const before = await snapshot("hr_payroll_runs", id);
  const { error } = await db.from("hr_payroll_runs").delete().eq("id", id); // payslips cascade
  if (error) return { error: error.message };
  await audit({ module: "hr_payroll", table: "hr_payroll_runs", recordId: id, action: "delete", before });
  revalidatePath("/hr/payroll");
  return { ok: true };
}

type Emp = { id: number; name: string; role: string; rate: number | null; rate_type: string; allowance: number | null; employment_type: string };

// Generate (or regenerate) payslips for a Draft run. Computes only — does NOT
// mutate advances or project work (that happens on finalize). Idempotent.
export async function generatePayslips(runId: number): Promise<{ ok: true; count: number; note?: string } | { error: string }> {
  // Return (don't throw) on a missing grant — a thrown server action crashes the
  // page instead of showing why nothing generated.
  try { await requireManager(); }
  catch { return { error: "Forbidden — this account needs HR Payroll edit access (run the role-permissions reseed if HR grants are missing)." }; }
  const db = createServerSupabase();
  const { data: run } = await db.from("hr_payroll_runs").select("*").eq("id", runId).single();
  if (!run) return { error: "Run not found." };
  if (run.status === "Finalized") return { error: "This run is finalized and can't be regenerated." };
  const start = run.period_start as string, end = run.period_end as string;

  const { data: empData } = await db.from("employees").select("id, name, role, rate, rate_type, allowance, employment_type").eq("active", true);
  const emps = (empData ?? []) as Emp[];
  const cfg = await loadPayrollConfig(); // overall benefits settings

  // Pre-load advances (open) + attendance + project work for the period.
  const { data: advData } = await db.from("hr_advances").select("employee_id, amount, deducted").eq("status", "Open");
  const remainingByEmp = new Map<number, number>();
  for (const a of advData ?? []) remainingByEmp.set(a.employee_id as number, (remainingByEmp.get(a.employee_id as number) ?? 0) + (Number(a.amount) - Number(a.deducted)));

  // Days worked = DISTINCT dates with a worked status (multi-session safe).
  const { data: attData } = await db.from("hr_attendance").select("employee_id, status, work_date").gte("work_date", start).lte("work_date", end);
  const dateSets = new Map<number, Set<string>>();
  for (const r of attData ?? []) {
    const s = String(r.status);
    if (s !== "present" && s !== "late" && s !== "halfday") continue;
    const set = dateSets.get(r.employee_id as number) ?? new Set<string>();
    set.add(r.work_date as string);
    dateSets.set(r.employee_id as number, set);
  }

  // Only APPROVED overtime is paid.
  const { data: otData } = await db.from("hr_overtime").select("employee_id, hours").eq("status", "Approved").gte("work_date", start).lte("work_date", end);
  const otByEmp = new Map<number, number>();
  for (const o of otData ?? []) otByEmp.set(o.employee_id as number, (otByEmp.get(o.employee_id as number) ?? 0) + Number(o.hours));

  const { data: projData } = await db.from("hr_project_work").select("employee_id, amount").eq("status", "Unpaid").gte("work_date", start).lte("work_date", end);
  const projByEmp = new Map<number, number>();
  for (const p of projData ?? []) projByEmp.set(p.employee_id as number, (projByEmp.get(p.employee_id as number) ?? 0) + Number(p.amount));

  const payType = (run.pay_type as string) || "Semi-monthly";
  const rows: Record<string, number>[] = [];
  for (const e of emps) {
    // Project-based by tag OR by fact: anyone with Unpaid project work in the
    // period is paid as a constructor on the Weekly run even if the Directory
    // tag is missing (and excluded from Semi-monthly, so never double-paid).
    const isProject = e.employment_type === "Project-based" || /constructor/i.test(e.role ?? "") || (projByEmp.get(e.id) ?? 0) > 0;
    // A Weekly run pays constructors only; Semi-monthly pays regular staff only.
    if (payType === "Weekly" && !isProject) continue;
    if (payType !== "Weekly" && isProject) continue;
    const advance = money(remainingByEmp.get(e.id) ?? 0);
    let slip;
    if (isProject) {
      const total = projByEmp.get(e.id) ?? 0;
      if (total <= 0) continue;
      const cap = Math.min(advance, total); // never push net below 0 via advance
      slip = computeProjectPayslip(total, cap, 0);
    } else {
      const days = dateSets.get(e.id)?.size ?? 0;
      if (days <= 0) continue;
      const ot = otByEmp.get(e.id) ?? 0; // approved OT only
      const base = computePayslip({ rate: Number(e.rate) || 0, rateType: (e.rate_type as RateType) || "Daily", daysWorked: days, otHours: ot, allowance: Number(e.allowance) || 0, cashAdvance: 0, otherDeductions: 0 }, cfg);
      const cap = Math.min(advance, Math.max(base.net, 0)); // cap advance at net
      slip = computePayslip({ rate: Number(e.rate) || 0, rateType: (e.rate_type as RateType) || "Daily", daysWorked: days, otHours: ot, allowance: Number(e.allowance) || 0, cashAdvance: cap, otherDeductions: 0 }, cfg);
    }
    rows.push({
      run_id: runId, employee_id: e.id,
      days_worked: slip.daysWorked, hours: slip.hours, ot_hours: slip.otHours,
      basic_pay: slip.basicPay, ot_pay: slip.otPay, allowance: slip.allowance, gross: slip.gross,
      sss: slip.sss, philhealth: slip.philhealth, pagibig: slip.pagibig, tax: slip.tax,
      cash_advance: slip.cashAdvance, other_deductions: slip.otherDeductions, net_pay: slip.net,
    });
  }
  // One bulk upsert instead of one round-trip per employee (same result).
  if (rows.length) {
    const { error: upErr } = await db.from("hr_payslips").upsert(rows, { onConflict: "run_id,employee_id" });
    if (upErr) return { error: upErr.message };
  }
  const count = rows.length;
  await audit({ module: "hr_payroll", table: "hr_payroll_runs", recordId: runId, action: "update", after: { generated: count } });
  revalidatePath("/hr/payroll");
  if (count === 0) {
    // Explain WHY with real numbers, so an empty run is diagnosable at a glance.
    const projEmps = emps.filter((e) => e.employment_type === "Project-based" || /constructor/i.test(e.role ?? "") || (projByEmp.get(e.id) ?? 0) > 0);
    const withProj = projEmps.filter((e) => (projByEmp.get(e.id) ?? 0) > 0).length;
    const withDays = emps.filter((e) => !projEmps.includes(e) && (dateSets.get(e.id)?.size ?? 0) > 0).length;
    const note = payType === "Weekly"
      ? `Weekly run = constructors lang. Active employees: ${emps.length} · constructor/project-based: ${projEmps.length} · may Unpaid project work sa ${start}→${end}: ${withProj} (${(projData ?? []).length} work entries nakita).`
      : `Semi-monthly run = regular staff lang. Active employees: ${emps.length} · regular: ${emps.length - projEmps.length} · may attendance sa ${start}→${end}: ${withDays}.`;
    return { ok: true, count: 0, note };
  }
  return { ok: true, count };
}

// Finalize: lock the run, commit advance deductions, mark project work Paid.
export async function finalizeRun(runId: number): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const { data: run } = await db.from("hr_payroll_runs").select("*").eq("id", runId).single();
  if (!run) return { error: "Run not found." };
  if (run.status === "Finalized") return { error: "Already finalized." };

  const { data: slips } = await db.from("hr_payslips").select("employee_id, cash_advance").eq("run_id", runId);
  const empIds = [...new Set((slips ?? []).filter((s) => (Number(s.cash_advance) || 0) > 0).map((s) => s.employee_id as number))];
  // One query for all open advances (oldest first), grouped per employee, instead
  // of a SELECT per payslip. Same oldest-first application + update result.
  const advByEmp = new Map<number, { id: number; amount: number; deducted: number }[]>();
  if (empIds.length) {
    const { data: allAdvs } = await db.from("hr_advances").select("id, employee_id, amount, deducted").in("employee_id", empIds).eq("status", "Open").order("date_issued", { ascending: true });
    for (const a of allAdvs ?? []) {
      const list = advByEmp.get(a.employee_id as number) ?? [];
      list.push({ id: a.id as number, amount: Number(a.amount), deducted: Number(a.deducted) });
      advByEmp.set(a.employee_id as number, list);
    }
  }
  for (const s of slips ?? []) {
    let toApply = Number(s.cash_advance) || 0;
    if (toApply <= 0) continue;
    for (const a of advByEmp.get(s.employee_id as number) ?? []) {
      if (toApply <= 0) break;
      const remaining = a.amount - a.deducted;
      const take = Math.min(remaining, toApply);
      if (take <= 0) continue;
      const newDeducted = a.deducted + take;
      await db.from("hr_advances").update({ deducted: newDeducted, status: newDeducted >= a.amount ? "Settled" : "Open" }).eq("id", a.id);
      a.deducted = newDeducted;
      toApply -= take;
    }
  }

  // Mark this period's unpaid project work as Paid.
  await db.from("hr_project_work").update({ status: "Paid" }).eq("status", "Unpaid").gte("work_date", run.period_start).lte("work_date", run.period_end);

  const before = await snapshot("hr_payroll_runs", runId);
  await db.from("hr_payroll_runs").update({ status: "Finalized" }).eq("id", runId);
  await auditAfter({ module: "hr_payroll", table: "hr_payroll_runs", recordId: runId, action: "status_change", before, snapshotTable: "hr_payroll_runs", snapshotId: runId });
  revalidatePath("/hr/payroll");
  revalidatePath("/hr/advances");
  revalidatePath("/hr/projects");
  return { ok: true };
}

// Reopen a finalized run back to Draft so payslips can be edited again.
// Reverses what finalize applied — advance deductions are given back and this
// period's project work is un-marked from Paid — so re-finalizing is safe and
// won't double-apply advances.
export async function reopenRun(runId: number): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const { data: run } = await db.from("hr_payroll_runs").select("*").eq("id", runId).single();
  if (!run) return { error: "Run not found." };

  // Reverse what finalize applied so a later re-finalize doesn't double-apply:
  // (1) give back advance deductions, (2) un-mark this period's project work.
  if (run.status === "Finalized") {
    const { data: slips } = await db.from("hr_payslips").select("employee_id, cash_advance").eq("run_id", runId);
    for (const s of slips ?? []) {
      let toReverse = Number(s.cash_advance) || 0;
      if (toReverse <= 0) continue;
      const { data: advs } = await db.from("hr_advances").select("id, amount, deducted").eq("employee_id", s.employee_id).gt("deducted", 0).order("date_issued", { ascending: false });
      for (const a of advs ?? []) {
        if (toReverse <= 0) break;
        const give = Math.min(Number(a.deducted), toReverse);
        const newDeducted = Number(a.deducted) - give;
        await db.from("hr_advances").update({ deducted: newDeducted, status: newDeducted >= Number(a.amount) ? "Settled" : "Open" }).eq("id", a.id);
        toReverse -= give;
      }
    }
    await db.from("hr_project_work").update({ status: "Unpaid" }).eq("status", "Paid").gte("work_date", run.period_start).lte("work_date", run.period_end);
  }

  const before = await snapshot("hr_payroll_runs", runId);
  const { error } = await db.from("hr_payroll_runs").update({ status: "Draft" }).eq("id", runId);
  if (error) return { error: error.message };
  await auditAfter({ module: "hr_payroll", table: "hr_payroll_runs", recordId: runId, action: "status_change", before, snapshotTable: "hr_payroll_runs", snapshotId: runId });
  revalidatePath("/hr/payroll");
  revalidatePath("/hr/advances");
  revalidatePath("/hr/projects");
  return { ok: true };
}

// Manual payslip adjustment — allowance + every deduction (incl. statutory
// contributions) can be overridden. Net recomputes from the edited values.
export type PayslipPatch = { allowance: number; sss: number; philhealth: number; pagibig: number; tax: number; cash_advance: number; other_deductions: number };
export async function savePayslip(id: number, patch: PayslipPatch): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const { data: s } = await db.from("hr_payslips").select("*").eq("id", id).single();
  if (!s) return { error: "Payslip not found." };
  const allowance = money(patch.allowance), sss = money(patch.sss), philhealth = money(patch.philhealth), pagibig = money(patch.pagibig), tax = money(patch.tax), cash = money(patch.cash_advance), other = money(patch.other_deductions);
  const gross = money(Number(s.basic_pay) + Number(s.ot_pay) + allowance);
  const net = money(gross - sss - philhealth - pagibig - tax - cash - other);
  const before = await snapshot("hr_payslips", id);
  const { error } = await db.from("hr_payslips").update({ allowance, sss, philhealth, pagibig, tax, cash_advance: cash, other_deductions: other, gross, net_pay: net }).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "hr_payroll", table: "hr_payslips", recordId: id, action: "update", before, snapshotTable: "hr_payslips", snapshotId: id });
  revalidatePath("/hr/payroll");
  return { ok: true };
}

export async function deletePayslip(id: number): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const before = await snapshot("hr_payslips", id);
  const { error } = await db.from("hr_payslips").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "hr_payroll", table: "hr_payslips", recordId: id, action: "delete", before });
  revalidatePath("/hr/payroll");
  return { ok: true };
}
