"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import type { OvertimeStatus } from "@/lib/hr/types";

async function requireManager() {
  const me = await getSession();
  if (!me || !hasPermission(me, "hr_overtime", "edit")) throw new Error("Forbidden.");
  return me;
}

export async function setOtStatus(id: number, status: OvertimeStatus): Promise<{ ok: true } | { error: string }> {
  const me = await requireManager();
  const db = createServerSupabase();
  const before = await snapshot("hr_overtime", id);
  const { error } = await db.from("hr_overtime").update({ status, approved_by: me.id }).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "hr_overtime", table: "hr_overtime", recordId: id, action: "status_change", before, snapshotTable: "hr_overtime", snapshotId: id });
  revalidatePath("/hr/overtime");
  revalidatePath("/hr/payroll");
  revalidatePath("/hr/wfh");
  revalidatePath("/hr/reports");
  return { ok: true };
}

export async function updateOtHours(id: number, hours: number): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const h = Math.max(0, Math.round((Number(hours) || 0) * 100) / 100);
  const before = await snapshot("hr_overtime", id);
  const { error } = await db.from("hr_overtime").update({ hours: h }).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "hr_overtime", table: "hr_overtime", recordId: id, action: "update", before, snapshotTable: "hr_overtime", snapshotId: id });
  revalidatePath("/hr/overtime");
  revalidatePath("/hr/payroll");
  revalidatePath("/hr/wfh");
  revalidatePath("/hr/reports");
  return { ok: true };
}

export async function deleteOvertime(id: number): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const before = await snapshot("hr_overtime", id);
  const { error } = await db.from("hr_overtime").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "hr_overtime", table: "hr_overtime", recordId: id, action: "delete", before });
  revalidatePath("/hr/overtime");
  revalidatePath("/hr/payroll");
  revalidatePath("/hr/wfh");
  revalidatePath("/hr/reports");
  return { ok: true };
}
