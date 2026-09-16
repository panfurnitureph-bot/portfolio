// =====================================================================
// Philippine statutory payroll engine (2024/2025 rates).
// Pure functions — update the constants here when the gov't tables change.
// All contribution helpers return the EMPLOYEE share (what's deducted).
// =====================================================================

export type RateType = "Monthly" | "Daily" | "Hourly";

// Overall, editable benefits/contribution config — applies to ALL regular
// employees (constructors are project-based and never get statutory). Stored in
// app_settings (key "payroll_settings"); these are the fallback defaults.
export type PayrollConfig = {
  statutoryEnabled: boolean;
  sssEnabled: boolean;
  philhealthEnabled: boolean;
  pagibigEnabled: boolean;
  taxEnabled: boolean;
  sssRate: number;        // % of MSC (employee share)
  sssFloor: number;
  sssCeiling: number;
  philhealthRate: number; // % of basic (total; EE pays half)
  philhealthFloor: number;
  philhealthCeiling: number;
  pagibigRate: number;    // % of capped comp
  pagibigCap: number;
};

export const DEFAULT_PAYROLL_CONFIG: PayrollConfig = {
  statutoryEnabled: true,
  sssEnabled: true, philhealthEnabled: true, pagibigEnabled: true, taxEnabled: true,
  sssRate: 4.5, sssFloor: 5000, sssCeiling: 35000,
  philhealthRate: 5, philhealthFloor: 10000, philhealthCeiling: 100000,
  pagibigRate: 2, pagibigCap: 10000,
};

const WORK_DAYS_PER_MONTH = 26; // standard divisor for daily/hourly conversions

// Estimate the monthly basic salary used for contribution brackets.
export function monthlyBasicFromRate(rate: number, type: RateType): number {
  if (type === "Monthly") return rate;
  if (type === "Daily") return rate * WORK_DAYS_PER_MONTH;
  return rate * 8 * WORK_DAYS_PER_MONTH; // Hourly
}

export function dailyRateFromRate(rate: number, type: RateType): number {
  if (type === "Daily") return rate;
  if (type === "Hourly") return rate * 8;
  return rate / WORK_DAYS_PER_MONTH; // Monthly
}

// ── SSS — employee share = sssRate% of MSC (clamped to floor/ceiling) ──────
export function sssEmployee(monthlyBasic: number, c: PayrollConfig = DEFAULT_PAYROLL_CONFIG): number {
  const msc = Math.min(Math.max(Math.ceil(monthlyBasic / 500) * 500, c.sssFloor), c.sssCeiling);
  return round2(msc * (c.sssRate / 100));
}

// ── PhilHealth — philhealthRate% of basic (floor/ceiling), EE pays half ────
export function philhealthEmployee(monthlyBasic: number, c: PayrollConfig = DEFAULT_PAYROLL_CONFIG): number {
  const base = Math.min(Math.max(monthlyBasic, c.philhealthFloor), c.philhealthCeiling);
  return round2((base * (c.philhealthRate / 100)) / 2);
}

// ── Pag-IBIG — pagibigRate% of comp (capped) ──────────────────────────────
export function pagibigEmployee(monthlyBasic: number, c: PayrollConfig = DEFAULT_PAYROLL_CONFIG): number {
  const base = Math.min(monthlyBasic, c.pagibigCap);
  return round2(base * (c.pagibigRate / 100));
}

// ── Withholding tax — TRAIN semi-monthly table (per pay period) ────────────
// `taxable` = period gross minus the period's statutory EE contributions.
export function withholdingTaxSemiMonthly(taxable: number): number {
  const t = taxable;
  if (t <= 10417) return 0;
  if (t <= 16666) return round2((t - 10417) * 0.15);
  if (t <= 33332) return round2(937.5 + (t - 16667) * 0.2);
  if (t <= 83332) return round2(4270.7 + (t - 33333) * 0.25);
  if (t <= 333332) return round2(16770.7 + (t - 83333) * 0.3);
  return round2(91770.7 + (t - 333333) * 0.35);
}

export type PayslipInput = {
  rate: number;
  rateType: RateType;
  daysWorked: number;   // present days in the period (halfday counts 0.5)
  otHours: number;
  allowance: number;    // per-period allowance
  cashAdvance: number;
  otherDeductions: number;
};

export type PayslipResult = {
  daysWorked: number; hours: number; otHours: number;
  basicPay: number; otPay: number; allowance: number; gross: number;
  sss: number; philhealth: number; pagibig: number; tax: number;
  cashAdvance: number; otherDeductions: number; net: number;
};

// Compute one semi-monthly payslip. Statutory monthly contributions are split
// in half (deducted each of the two periods per month).
export function computePayslip(i: PayslipInput, c: PayrollConfig = DEFAULT_PAYROLL_CONFIG): PayslipResult {
  const daily = dailyRateFromRate(i.rate, i.rateType);
  const hourly = daily / 8;
  const basicPay = round2(daily * i.daysWorked);
  const otPay = round2(hourly * 1.25 * i.otHours);
  const allowance = round2(i.allowance);
  const gross = round2(basicPay + otPay + allowance);

  const monthly = monthlyBasicFromRate(i.rate, i.rateType);
  // Half of the monthly contribution per semi-monthly run. Zero if statutory off.
  const on = c.statutoryEnabled;
  const sss = on && c.sssEnabled ? round2(sssEmployee(monthly, c) / 2) : 0;
  const philhealth = on && c.philhealthEnabled ? round2(philhealthEmployee(monthly, c) / 2) : 0;
  const pagibig = on && c.pagibigEnabled ? round2(pagibigEmployee(monthly, c) / 2) : 0;

  const taxable = Math.max(gross - sss - philhealth - pagibig, 0);
  const tax = on && c.taxEnabled ? withholdingTaxSemiMonthly(taxable) : 0;

  const net = round2(gross - sss - philhealth - pagibig - tax - i.cashAdvance - i.otherDeductions);

  return {
    daysWorked: i.daysWorked, hours: round2(i.daysWorked * 8), otHours: i.otHours,
    basicPay, otPay, allowance, gross,
    sss, philhealth, pagibig, tax,
    cashAdvance: round2(i.cashAdvance), otherDeductions: round2(i.otherDeductions), net,
  };
}

// Project-based (Constructor) payslip — paid by output, not attendance.
// Gross = sum of project-work amounts in the period. No SSS/PhilHealth/Pag-IBIG
// /tax (contractor/pakyaw); only advances + other deductions apply.
export function computeProjectPayslip(projectsTotal: number, cashAdvance: number, otherDeductions: number): PayslipResult {
  const gross = round2(projectsTotal);
  const net = round2(gross - cashAdvance - otherDeductions);
  return {
    daysWorked: 0, hours: 0, otHours: 0,
    basicPay: gross, otPay: 0, allowance: 0, gross,
    sss: 0, philhealth: 0, pagibig: 0, tax: 0,
    cashAdvance: round2(cashAdvance), otherDeductions: round2(otherDeductions), net,
  };
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
