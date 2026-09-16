import { createServerSupabase } from "@/lib/supabase/server";
import type { PayrollRun, Payslip } from "@/lib/hr/types";
import { DEFAULT_PAYROLL_CONFIG, type PayrollConfig } from "@/lib/hr/payroll";

// Overall benefits/contribution config (app_settings key "payroll_settings").
export async function loadPayrollConfig(): Promise<PayrollConfig> {
  const db = createServerSupabase();
  const { data } = await db.from("app_settings").select("value").eq("key", "payroll_settings").maybeSingle();
  const v = (data?.value ?? {}) as Partial<PayrollConfig>;
  return { ...DEFAULT_PAYROLL_CONFIG, ...v };
}

export type PayslipRow = Payslip & { employee_name: string };

const PAYROLL_RUN_COLS = "id, period_start, period_end, pay_date, status, notes, pay_type";
const PAYSLIP_COLS =
  "id, run_id, employee_id, days_worked, hours, ot_hours, basic_pay, ot_pay, allowance, gross, sss, philhealth, pagibig, tax, cash_advance, other_deductions, net_pay";

export async function loadRuns(): Promise<PayrollRun[]> {
  const db = createServerSupabase();
  const { data } = await db.from("hr_payroll_runs").select(PAYROLL_RUN_COLS).order("period_start", { ascending: false }).limit(200);
  return (data ?? []) as PayrollRun[];
}

export async function loadPayslips(runId: number): Promise<PayslipRow[]> {
  const db = createServerSupabase();
  const { data } = await db.from("hr_payslips").select(PAYSLIP_COLS).eq("run_id", runId).order("net_pay", { ascending: false }).limit(5000);
  const rows = (data ?? []) as Payslip[];
  const ids = [...new Set(rows.map((r) => r.employee_id))];
  const names = new Map<number, string>();
  if (ids.length) {
    const { data: emps } = await db.from("employees").select("id, name").in("id", ids);
    for (const e of emps ?? []) names.set(e.id as number, e.name as string);
  }
  return rows.map((r) => ({ ...r, employee_name: names.get(r.employee_id) ?? "—" }));
}

export type PayslipEmp = {
  code: string; name: string; position: string | null; role: string;
  sss_no: string | null; philhealth_no: string | null; pagibig_no: string | null;
  tin: string | null; bank_account: string | null; hire_date: string | null;
};
export type Ytd = { gross: number; sss: number; philhealth: number; pagibig: number; tax: number; advance: number; net: number };
export type ProjectItem = { order_number: string | null; project_name: string | null; amount: number; ot: number; work_date: string };
export type PayslipDetail = {
  slip: PayslipRow; run: PayrollRun; emp: PayslipEmp; ytd: Ytd; payslipNo: string;
  isProject: boolean; projects: ProjectItem[];
};

// Rich payslip for the printable document: employee gov't IDs + year-to-date totals.
export async function loadPayslipDetail(payslipId: number): Promise<PayslipDetail | null> {
  const db = createServerSupabase();
  const { data: slipRow } = await db.from("hr_payslips").select(PAYSLIP_COLS).eq("id", payslipId).single();
  if (!slipRow) return null;
  const slip = slipRow as Payslip;

  // run and employee both depend only on `slip` — fetch in parallel.
  const [{ data: runRow }, { data: e }] = await Promise.all([
    db.from("hr_payroll_runs").select(PAYROLL_RUN_COLS).eq("id", slip.run_id).single(),
    db.from("employees")
      .select("id, name, role, position, employment_type, sss_no, philhealth_no, pagibig_no, tin, bank_account, hire_date")
      .eq("id", slip.employee_id).single(),
  ]);
  const run = (runRow ?? {}) as PayrollRun;
  const isProject = /constructor/i.test((e?.role as string) ?? "") || (e?.employment_type as string) === "Project-based";
  const emp: PayslipEmp = {
    code: `M${String(slip.employee_id).padStart(5, "0")}`,
    name: (e?.name as string) ?? "—",
    position: (e?.position as string) ?? null,
    role: (e?.role as string) ?? "",
    sss_no: (e?.sss_no as string) ?? null,
    philhealth_no: (e?.philhealth_no as string) ?? null,
    pagibig_no: (e?.pagibig_no as string) ?? null,
    tin: (e?.tin as string) ?? null,
    bank_account: (e?.bank_account as string) ?? null,
    hire_date: (e?.hire_date as string) ?? null,
  };

  // Year-to-date = sum of this employee's payslips across runs whose period ends
  // in the same calendar year as this run.
  const ytd: Ytd = { gross: 0, sss: 0, philhealth: 0, pagibig: 0, tax: 0, advance: 0, net: 0 };
  const year = (run.period_end ?? "").slice(0, 4);

  // Project-based (constructor) gawa breakdown for the period.
  const projects: ProjectItem[] = [];

  // The YTD roll-up (internally sequential: yearRuns → payslips) and the project
  // breakdown are independent of each other — run both branches concurrently.
  await Promise.all([
    (async () => {
      if (!year) return;
      const { data: yearRuns } = await db.from("hr_payroll_runs").select("id")
        .gte("period_end", `${year}-01-01`).lte("period_end", `${year}-12-31`).limit(5000);
      const runIds = (yearRuns ?? []).map((r) => r.id as number);
      if (!runIds.length) return;
      const { data: ys } = await db.from("hr_payslips")
        .select("gross, sss, philhealth, pagibig, tax, cash_advance, net_pay")
        .eq("employee_id", slip.employee_id).in("run_id", runIds).limit(5000);
      for (const r of ys ?? []) {
        ytd.gross += Number(r.gross) || 0;
        ytd.sss += Number(r.sss) || 0;
        ytd.philhealth += Number(r.philhealth) || 0;
        ytd.pagibig += Number(r.pagibig) || 0;
        ytd.tax += Number(r.tax) || 0;
        ytd.advance += Number(r.cash_advance) || 0;
        ytd.net += Number(r.net_pay) || 0;
      }
    })(),
    (async () => {
      if (!(isProject && run.period_start && run.period_end)) return;
      const { data: pw } = await db.from("hr_project_work")
        .select("order_number, project_name, amount, ot, work_date")
        .eq("employee_id", slip.employee_id)
        .gte("work_date", run.period_start).lte("work_date", run.period_end)
        .order("work_date", { ascending: true }).limit(5000);
      for (const r of pw ?? []) projects.push({
        order_number: (r.order_number as string) ?? null,
        project_name: (r.project_name as string) ?? null,
        amount: Number(r.amount) || 0,
        ot: Number(r.ot) || 0,
        work_date: r.work_date as string,
      });
    })(),
  ]);

  const payslipNo = `PS-${year || "0000"}-${String(slip.id).padStart(4, "0")}`;
  return { slip: { ...slip, employee_name: emp.name }, run, emp, ytd, payslipNo, isProject, projects };
}
