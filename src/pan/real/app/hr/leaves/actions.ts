"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import type { LeaveType, LeaveStatus } from "@/lib/hr/types";

async function requireManager() {
  const me = await getSession();
  if (!me || !hasPermission(me, "hr_leaves", "edit")) {
    throw new Error("Forbidden.");
  }
  return me;
}

// Set an employee's weekly rest days (stored on employees.day_off, comma-joined).
export async function setRestDays(employeeId: number, days: string[]): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const value = days.length ? days.join(", ") : null;
  const before = await snapshot("employees", employeeId);
  const { error } = await db.from("employees").update({ day_off: value }).eq("id", employeeId);
  if (error) return { error: error.message };
  await auditAfter({ module: "employees", table: "employees", recordId: employeeId, action: "update", before, snapshotTable: "employees", snapshotId: employeeId });
  revalidatePath("/hr/leaves");
  revalidatePath("/hr/directory");
  return { ok: true };
}

export type LeaveInput = {
  employee_id: number;
  leave_type: LeaveType;
  date_from: string;
  date_to: string;
  days: number | null;
  paid: boolean;
  reason: string | null;
};

// Inclusive whole-day count between two ISO dates (date_from..date_to). Min 1.
function inclusiveDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  return diff > 0 ? diff : 1;
}

function clean(i: LeaveInput) {
  const days = i.days != null && !Number.isNaN(i.days) && Number(i.days) > 0
    ? Number(i.days)
    : inclusiveDays(i.date_from, i.date_to);
  return {
    employee_id: Number(i.employee_id),
    leave_type: i.leave_type,
    date_from: i.date_from,
    date_to: i.date_to,
    days,
    paid: !!i.paid,
    reason: i.reason?.trim() || null,
  };
}

export async function createLeave(input: LeaveInput): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  if (!input.employee_id) return { error: "Employee is required." };
  if (!input.date_from || !input.date_to) return { error: "Both dates are required." };
  if (input.date_to < input.date_from) return { error: "End date is before start date." };
  const db = createServerSupabase();
  const { data, error } = await db
    .from("hr_leaves")
    .insert({ ...clean(input), status: "Pending" })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await auditAfter({ module: "hr_leaves", table: "hr_leaves", recordId: data?.id ?? "—", action: "insert", snapshotTable: "hr_leaves", snapshotId: data?.id });
  // Push HR — a leave request is pending approval.
  try {
    const c = clean(input);
    const { data: emp } = await db.from("employees").select("name").eq("id", c.employee_id).maybeSingle();
    const { notifyHrRequest } = await import("@/lib/push/notify");
    await notifyHrRequest({
      kind: "Day off",
      employee: (emp?.name as string | undefined) ?? `Employee #${c.employee_id}`,
      date: c.date_from === c.date_to ? c.date_from : `${c.date_from} – ${c.date_to}`,
      detail: c.reason ? `reason: ${c.reason}` : null,
    });
  } catch { /* best-effort */ }
  revalidatePath("/hr/leaves");
  revalidatePath("/hr/wfh");
  return { ok: true };
}

export async function updateLeave(id: number, input: LeaveInput): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  if (!input.employee_id) return { error: "Employee is required." };
  if (!input.date_from || !input.date_to) return { error: "Both dates are required." };
  if (input.date_to < input.date_from) return { error: "End date is before start date." };
  const db = createServerSupabase();
  const before = await snapshot("hr_leaves", id);
  const { error } = await db.from("hr_leaves").update(clean(input)).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "hr_leaves", table: "hr_leaves", recordId: id, action: "update", before, snapshotTable: "hr_leaves", snapshotId: id });
  revalidatePath("/hr/leaves");
  revalidatePath("/hr/wfh");
  return { ok: true };
}

export async function deleteLeave(id: number): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const before = await snapshot("hr_leaves", id);
  const { error } = await db.from("hr_leaves").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "hr_leaves", table: "hr_leaves", recordId: id, action: "delete", before });
  revalidatePath("/hr/leaves");
  revalidatePath("/hr/wfh");
  return { ok: true };
}

// Approve / reject a pending request, stamping the current manager as approver.
export async function setLeaveStatus(id: number, status: Extract<LeaveStatus, "Approved" | "Rejected">): Promise<{ ok: true } | { error: string }> {
  const me = await requireManager();
  const db = createServerSupabase();
  const before = await snapshot("hr_leaves", id);
  const { error } = await db.from("hr_leaves").update({ status, approved_by: me.id }).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "hr_leaves", table: "hr_leaves", recordId: id, action: "status_change", before, snapshotTable: "hr_leaves", snapshotId: id });
  revalidatePath("/hr/leaves");
  revalidatePath("/hr/wfh");
  return { ok: true };
}
