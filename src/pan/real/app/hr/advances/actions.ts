"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { money } from "@/lib/num";

async function requireManager() {
  const me = await getSession();
  if (!me || !hasPermission(me, "hr_advances", "edit")) {
    throw new Error("Forbidden.");
  }
  return me;
}

export type AdvanceInput = {
  employee_id: number;
  amount: number;
  deducted: number;
  date_issued: string;
  reason: string | null;
  status: "Open" | "Settled";
};

function txt(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s || null;
}

function clean(i: AdvanceInput) {
  return {
    employee_id: Number(i.employee_id),
    amount: money(i.amount),
    deducted: money(i.deducted),
    date_issued: i.date_issued,
    reason: txt(i.reason),
    status: i.status === "Settled" ? "Settled" : "Open",
  };
}

const MODULE = "hr_advances";
const TABLE = "hr_advances";

export async function createAdvance(input: AdvanceInput): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  if (!input.employee_id) return { error: "Employee is required." };
  if (!input.date_issued) return { error: "Date issued is required." };
  if (money(input.amount) <= 0) return { error: "Amount must be greater than zero." };
  const db = createServerSupabase();
  const { data, error } = await db.from(TABLE).insert(clean(input)).select("id").single();
  if (error) return { error: error.message };
  await auditAfter({ module: MODULE, table: TABLE, recordId: data?.id ?? "—", action: "insert", snapshotTable: TABLE, snapshotId: data?.id });
  revalidatePath("/hr/advances");
  revalidatePath("/hr/payroll");
  return { ok: true };
}

export async function updateAdvance(id: number, input: AdvanceInput): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  if (!input.employee_id) return { error: "Employee is required." };
  if (!input.date_issued) return { error: "Date issued is required." };
  const db = createServerSupabase();
  const before = await snapshot(TABLE, id);
  const { error } = await db.from(TABLE).update(clean(input)).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: MODULE, table: TABLE, recordId: id, action: "update", before, snapshotTable: TABLE, snapshotId: id });
  revalidatePath("/hr/advances");
  revalidatePath("/hr/payroll");
  return { ok: true };
}

export async function deleteAdvance(id: number): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const before = await snapshot(TABLE, id);
  const { error } = await db.from(TABLE).delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: MODULE, table: TABLE, recordId: id, action: "delete", before });
  revalidatePath("/hr/advances");
  revalidatePath("/hr/payroll");
  return { ok: true };
}

export async function settleAdvance(id: number): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const before = await snapshot(TABLE, id);
  const { error } = await db.from(TABLE).update({ status: "Settled" }).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: MODULE, table: TABLE, recordId: id, action: "status_change", before, snapshotTable: TABLE, snapshotId: id });
  revalidatePath("/hr/advances");
  revalidatePath("/hr/payroll");
  return { ok: true };
}
