"use server";

// SELF-SERVICE PARA SA WFH (2026-08-25) — ang tatlong hiling na matagal nang
// nasa FaceID kiosk: Request Leave, Request Advance, My Payslip. Nasa tindahan
// lang ang tablet, kaya ang mga nagtatrabaho sa labas ay walang paraan.
//
// KUNG BAKIT HINDI ANG KIOSK ACTIONS: doon, ang MUKHA ang nagpapatunay kung
// sino ang humihiling, at ang employee_id ay ipinapasa ng kliyente — sinumang
// may `hr_kiosk` na permiso ay maaaring maghain para kaninuman. Sa WFH, walang
// scan; ang naka-login ang tao. Kaya ang employee_id ay HINDI tinatanggap dito:
// hinahanap ito sa session, at ang hiling ay laging para sa sarili.

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { auditAfter } from "@/lib/audit";
import type { LeaveType } from "@/lib/hr/types";
import type { PayslipDetail } from "@/app/hr/payroll/data";

const LEAVE_TYPES: LeaveType[] = ["Vacation", "Sick", "Emergency", "Unpaid", "Restday"];
const ADVANCE_CAP = 100_000;

function todayPH(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

// Mirrors app/hr/leaves/actions.ts inclusiveDays.
function inclusiveDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  return diff > 0 ? diff : 1;
}

// ANG NAKA-LOGIN, WALANG IBA. Email muna tapos pangalan — kaparehong tugma ng
// loadMyWfh, kaya iisang empleyado ang nakikita ng pahina at ng hiling.
async function meAsEmployee(): Promise<{ id: number; name: string } | { error: string }> {
  const me = await getSession();
  if (!me) return { error: "Forbidden." };
  const db = createServerSupabase();
  const em = (me.email ?? "").trim();
  const nm = (me.full_name ?? "").trim();
  type Emp = { id: number; name: string; active: boolean | null };
  let e: Emp | null = null;
  if (em) {
    const { data } = await db.from("employees").select("id, name, active").ilike("email", em).limit(1);
    if (data?.[0]) e = data[0] as Emp;
  }
  if (!e && nm) {
    const { data } = await db.from("employees").select("id, name, active").ilike("name", nm).limit(1);
    if (data?.[0]) e = data[0] as Emp;
  }
  if (!e) return { error: "No employee record is linked to your account. Ask an admin to add you in Employee Directory." };
  if (e.active === false) return { error: "Your employee record is inactive." };
  return { id: Number(e.id), name: e.name ?? "Employee" };
}

// Ang hr_* tables ay RLS-sarado sa realtime (sensitibo), kaya ang bukas-basa na
// pinger ang nagpapa-refresh sa HR pages. Kaparehong paraan ng kiosk.
async function syncPing(db: ReturnType<typeof createServerSupabase>, tag: string): Promise<void> {
  try {
    await db.from("sync_ping").upsert({ id: 1, tag, at: new Date().toISOString() });
  } catch { /* 0156 hindi pa naitatakbo — ok lang */ }
}

// ── LEAVE ────────────────────────────────────────────────────────────────────
export type SelfLeaveInput = {
  leave_type: LeaveType;
  date_from: string;
  date_to: string;
  reason: string | null;
};

export async function requestOwnLeave(input: SelfLeaveInput): Promise<{ ok: true } | { error: string }> {
  try {
    const who = await meAsEmployee();
    if ("error" in who) return who;
    const db = createServerSupabase();

    if (!LEAVE_TYPES.includes(input.leave_type)) return { error: "Pick a valid leave type." };
    if (!input.date_from || !input.date_to) return { error: "Both dates are required." };
    if (input.date_to < input.date_from) return { error: "End date is before start date." };

    const days = inclusiveDays(input.date_from, input.date_to);
    // paid=false: ang manager ang magpapasya kung bayad ito sa pag-apruba —
    // kaparehong hugis ng kiosk at ng createLeave.
    const { data, error } = await db.from("hr_leaves").insert({
      employee_id: who.id,
      leave_type: input.leave_type,
      date_from: input.date_from,
      date_to: input.date_to,
      days,
      paid: false,
      reason: input.reason?.trim() || null,
      status: "Pending",
    }).select("id").single();
    if (error) return { error: error.message };
    await auditAfter({ module: "hr_leaves", table: "hr_leaves", recordId: data?.id ?? "—", action: "insert", snapshotTable: "hr_leaves", snapshotId: data?.id });
    revalidatePath("/hr/leaves");
    revalidatePath("/hr/wfh");
    await syncPing(db, "leave");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not submit leave request." };
  }
}

// ── ADVANCE ──────────────────────────────────────────────────────────────────
export type SelfAdvanceInput = { amount: number; reason: string | null };

export async function requestOwnAdvance(input: SelfAdvanceInput): Promise<{ ok: true } | { error: string }> {
  try {
    const who = await meAsEmployee();
    if ("error" in who) return who;
    const db = createServerSupabase();

    const amount = money(input.amount);
    if (!(amount > 0)) return { error: "Amount must be greater than zero." };
    if (amount > ADVANCE_CAP) return { error: `Amount cannot exceed ₱${ADVANCE_CAP.toLocaleString()}.` };

    // Walang perang ipinapalabas dito — "Open" ang katayuan hangga't hindi pa
    // inaayos ng manager.
    const { data, error } = await db.from("hr_advances").insert({
      employee_id: who.id,
      amount,
      deducted: 0,
      date_issued: todayPH(),
      reason: input.reason?.trim() || null,
      status: "Open",
    }).select("id").single();
    if (error) return { error: error.message };
    await auditAfter({ module: "hr_advances", table: "hr_advances", recordId: data?.id ?? "—", action: "insert", snapshotTable: "hr_advances", snapshotId: data?.id });
    revalidatePath("/hr/advances");
    revalidatePath("/hr/wfh");
    await syncPing(db, "advance");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not submit advance request." };
  }
}

// ── PAYSLIP ──────────────────────────────────────────────────────────────────
// ANG BUONG SLIP, hindi listahan ng bilang (hiling 2026-08-25) — kaparehong
// dokumento ng Payroll: header ng kompanya, gov’t IDs, attendance, earnings,
// deductions, YTD, at ang halaga sa salita. Ginagamit ang parehong loader; ang
// getPayslipDetail ay naka-gate sa `hr_payroll` edit (manager), kaya ito ang
// bersyong SARILI LANG: hinahanap ang pinakabagong payslip ng naka-login, at
// pinapatunayan na sa kanya nga ito bago ibigay.
export async function loadOwnPayslipDoc(): Promise<{ ok: true; detail: PayslipDetail } | { error: string }> {
  try {
    const who = await meAsEmployee();
    if ("error" in who) return who;
    const db = createServerSupabase();
    const { data: slip } = await db.from("hr_payslips")
      .select("id, employee_id")
      .eq("employee_id", who.id)
      .order("run_id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!slip) return { error: "No payslip yet." };
    // Doble-tsek: ang loader ay kumukuha ayon sa id, kaya tiniyak muna na ang
    // hilerang iyon ay sa naka-login.
    if (Number(slip.employee_id) !== who.id) return { error: "Forbidden." };
    const { loadPayslipDetail } = await import("@/app/hr/payroll/data");
    const detail = await loadPayslipDetail(Number(slip.id));
    if (!detail) return { error: "No payslip yet." };
    return { ok: true, detail };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not load your payslip." };
  }
}


export type SelfPayslip = {
  period_start: string | null;
  period_end: string | null;
  pay_date: string | null;
  net_pay: number;
  gross: number;
  sss: number;
  philhealth: number;
  pagibig: number;
  tax: number;
  cash_advance: number;
  other_deductions: number;
};

// Ang PINAKABAGONG payslip ng naka-login. "Latest" = pinakamataas na run_id.
export async function loadOwnPayslip(): Promise<{ ok: true; payslip: SelfPayslip } | { error: string }> {
  try {
    const who = await meAsEmployee();
    if ("error" in who) return who;
    const db = createServerSupabase();

    const { data: slip } = await db.from("hr_payslips")
      .select("run_id, net_pay, gross, sss, philhealth, pagibig, tax, cash_advance, other_deductions")
      .eq("employee_id", who.id)
      .order("run_id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!slip) return { error: "No payslip yet." };

    const { data: run } = await db.from("hr_payroll_runs")
      .select("period_start, period_end, pay_date")
      .eq("id", slip.run_id as number)
      .maybeSingle();

    return {
      ok: true,
      payslip: {
        period_start: (run?.period_start as string | null) ?? null,
        period_end: (run?.period_end as string | null) ?? null,
        pay_date: (run?.pay_date as string | null) ?? null,
        net_pay: Number(slip.net_pay) || 0,
        gross: Number(slip.gross) || 0,
        sss: Number(slip.sss) || 0,
        philhealth: Number(slip.philhealth) || 0,
        pagibig: Number(slip.pagibig) || 0,
        tax: Number(slip.tax) || 0,
        cash_advance: Number(slip.cash_advance) || 0,
        other_deductions: Number(slip.other_deductions) || 0,
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not load your payslip." };
  }
}
