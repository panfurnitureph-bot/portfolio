import { createServerSupabase } from "@/lib/supabase/server";

// ── Lightweight row shapes (only the columns the reports need) ──────────────
export type RptAttendance = {
  employee_id: number;
  employee_name: string;
  work_date: string;
  status: string;
  ot_hours: number;
};

export type RptPayslip = {
  run_id: number;
  employee_id: number;
  employee_name: string;
  gross: number;
  net_pay: number;
  sss: number;
  philhealth: number;
  pagibig: number;
  tax: number;
  basic_pay: number;
  cash_advance: number;
};

export type RptRun = {
  id: number;
  period_start: string;
  period_end: string;
  status: string;
};

export type RptAdvance = {
  employee_id: number;
  employee_name: string;
  amount: number;
  deducted: number;
  status: string;
};

export type RptEmployee = {
  id: number;
  name: string;
  role: string;
  rate: number | null;
  rate_type: string | null;
};

export type HrReportData = {
  attendance: RptAttendance[];
  payslips: RptPayslip[];
  runs: RptRun[];
  advances: RptAdvance[];
  employees: RptEmployee[];
};

// Load everything the HR Reports page needs in a handful of light selects.
// Employee names are mapped in (id → name) the same way audit-trail/data.ts
// attaches profile avatars.
export async function loadHrReportData(): Promise<HrReportData> {
  const db = createServerSupabase();

  const [
    { data: empRows },
    { data: attRows },
    { data: psRows },
    { data: runRows },
    { data: advRows },
  ] = await Promise.all([
    db
      .from("employees")
      .select("id, name, role, rate, rate_type")
      .order("name")
      .limit(5000),
    db
      .from("hr_attendance")
      .select("employee_id, work_date, status, ot_hours")
      .order("work_date", { ascending: false })
      .limit(2000),
    db
      .from("hr_payslips")
      .select(
        "run_id, employee_id, gross, net_pay, sss, philhealth, pagibig, tax, basic_pay, cash_advance",
      )
      .limit(2000),
    db
      .from("hr_payroll_runs")
      .select("id, period_start, period_end, status")
      .order("period_start", { ascending: false })
      .limit(2000),
    db
      .from("hr_advances")
      .select("employee_id, amount, deducted, status")
      .limit(2000),
  ]);

  const employees = (empRows ?? []) as RptEmployee[];
  const nameById = new Map<number, string>();
  for (const e of employees) nameById.set(e.id, e.name ?? "—");
  const nameOf = (id: number) => nameById.get(id) ?? "—";

  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

  const attendance: RptAttendance[] = (attRows ?? []).map((r) => ({
    employee_id: r.employee_id as number,
    employee_name: nameOf(r.employee_id as number),
    work_date: r.work_date as string,
    status: (r.status as string) ?? "",
    ot_hours: num(r.ot_hours),
  }));

  const payslips: RptPayslip[] = (psRows ?? []).map((r) => ({
    run_id: r.run_id as number,
    employee_id: r.employee_id as number,
    employee_name: nameOf(r.employee_id as number),
    gross: num(r.gross),
    net_pay: num(r.net_pay),
    sss: num(r.sss),
    philhealth: num(r.philhealth),
    pagibig: num(r.pagibig),
    tax: num(r.tax),
    basic_pay: num(r.basic_pay),
    cash_advance: num(r.cash_advance),
  }));

  const runs: RptRun[] = (runRows ?? []).map((r) => ({
    id: r.id as number,
    period_start: r.period_start as string,
    period_end: r.period_end as string,
    status: (r.status as string) ?? "",
  }));

  const advances: RptAdvance[] = (advRows ?? []).map((r) => ({
    employee_id: r.employee_id as number,
    employee_name: nameOf(r.employee_id as number),
    amount: num(r.amount),
    deducted: num(r.deducted),
    status: (r.status as string) ?? "",
  }));

  return { attendance, payslips, runs, advances, employees };
}
