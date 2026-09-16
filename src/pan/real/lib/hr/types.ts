// Client-safe HR types + labels (no server imports).
import type { RateType } from "./payroll";

// Role is a free-form value (stored as-is). ROLE_OPTIONS drives the dropdown.
export type EmpRole = string;
export type EmploymentType = "Regular" | "Probationary" | "Contractual" | "Part-time" | "Project-based";

export const ROLE_OPTIONS: string[] = [
  "Sales Manager",
  "Sales Associate",
  "Online Sales Associate",
  "GMA Project Base - Carpentry",
  "GMA Project Base - Upholstery",
  "Delivery Coordinator",
  "On Call Installer",
  "Installer",
  "Quality Assurance",
  "Warehouse",
  "On Call Driver",
  "Driver",
  // Katumbas ng mga tablet user roles (Delivery Team + Production Area) para
  // ang bawat team/workshop account ay may kaparehong entry sa HR directory.
  "Delivery Team",
  "Production Area",
];

// Workshops (constructor groups) — used to tag which workshop builds an order line.
export const WORKSHOPS: string[] = ["Adelina Workshop", "LRT Workshop", "OLD WORKSHOP", "WHITE WORKSHOP"];

// Display label for a stored role (legacy short codes get a friendly name).
const LEGACY: Record<string, string> = { sales: "Sales", driver: "Driver", qa: "Quality Assurance", installer: "Installer", constructor: "Constructor" };
export const roleLabel = (r: string): string => LEGACY[r] ?? r ?? "—";

// Badge color picked by keyword so any role value gets a sensible tone.
export function roleBadge(r: string): string {
  const s = (r ?? "").toLowerCase();
  if (s.includes("constructor")) return "bg-orange-50 text-orange-700 ring-orange-600/20";
  if (s.includes("workshop")) return "bg-orange-50 text-orange-700 ring-orange-600/20";
  if (s.includes("delivery team")) return "bg-sky-50 text-sky-700 ring-sky-600/20";
  if (s.includes("driver")) return "bg-amber-50 text-amber-700 ring-amber-600/20";
  if (s.includes("install")) return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (s.includes("quality") || s === "qa") return "bg-violet-50 text-violet-700 ring-violet-600/20";
  if (s.includes("sales")) return "bg-blue-50 text-blue-700 ring-blue-600/20";
  if (s.includes("coordinator")) return "bg-teal-50 text-teal-700 ring-teal-600/20";
  if (s.includes("warehouse")) return "bg-lime-50 text-lime-700 ring-lime-600/20";
  return "bg-stone-100 text-stone-600 ring-stone-300";
}

// Project-based (constructor) detection — matches any "constructor" role.
export const isConstructorRole = (r: string): boolean => /constructor/i.test(r ?? "");

// Full HR employee record (employees table, extended).
export type HrEmployee = {
  id: number;
  name: string;
  role: EmpRole;
  on_call: boolean;
  rate: number | null;
  rate_type: RateType;
  allowance: number | null;
  contact: string | null;
  email: string | null;
  address: string | null;
  position: string | null;
  department: string | null;
  employment_type: EmploymentType;
  work_setup?: string;   // Onsite | WFH | Hybrid
  hire_date: string | null;
  birthdate: string | null;
  day_off: string | null;
  photo_url: string | null;
  sss_no: string | null;
  philhealth_no: string | null;
  pagibig_no: string | null;
  tin: string | null;
  bank_account: string | null;
  active: boolean;
  // Showroom ng empleyado (San Pedro / Carmona) — auto-tag ng branch sa orders
  // na pino-process nila, para sa PAN Overall income detection (migration 0147).
  branch?: string | null;
  // Face-ID attendance enrollment (migration 0077). face_descriptor itself is
  // not loaded into the client list — only the timestamp signals "enrolled".
  face_enrolled_at?: string | null;
};

export type AttendanceStatus = "present" | "late" | "absent" | "halfday" | "leave" | "restday" | "holiday";
export type Attendance = {
  id: number; employee_id: number; work_date: string;
  time_in: string | null; time_out: string | null;
  status: AttendanceStatus; ot_hours: number; source: string; notes: string | null;
};

export type LeaveType = "Vacation" | "Sick" | "Emergency" | "Unpaid" | "Restday";
export type LeaveStatus = "Pending" | "Approved" | "Rejected";
export type Leave = {
  id: number; employee_id: number; leave_type: LeaveType;
  date_from: string; date_to: string; days: number; paid: boolean;
  reason: string | null; status: LeaveStatus;
};

export type ProjectWork = {
  id: number; employee_id: number; project_name: string | null; order_number: string | null;
  rate: number; ot: number; description: string | null;
  amount: number; work_date: string; status: "Unpaid" | "Paid"; payslip_id: number | null;
};

export type Advance = {
  id: number; employee_id: number; amount: number; deducted: number;
  date_issued: string; reason: string | null; status: "Open" | "Settled";
};

export type OvertimeStatus = "Pending" | "Approved" | "Rejected";
export type Overtime = {
  id: number; employee_id: number; attendance_id: number | null;
  work_date: string; hours: number; reason: string | null; status: OvertimeStatus;
};

export type PayType = "Semi-monthly" | "Weekly";
export type PayrollRun = {
  id: number; period_start: string; period_end: string; pay_date: string | null;
  status: "Draft" | "Finalized"; notes: string | null; pay_type: PayType;
};

export type Payslip = {
  id: number; run_id: number; employee_id: number;
  days_worked: number; hours: number; ot_hours: number;
  basic_pay: number; ot_pay: number; allowance: number; gross: number;
  sss: number; philhealth: number; pagibig: number; tax: number;
  cash_advance: number; other_deductions: number; net_pay: number;
};

export const DAYS_OFF = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const EMPLOYMENT_TYPES: EmploymentType[] = ["Regular", "Probationary", "Contractual", "Part-time", "Project-based"];
export const RATE_TYPES: RateType[] = ["Monthly", "Daily", "Hourly"];
