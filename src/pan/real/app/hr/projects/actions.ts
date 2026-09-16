"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { money } from "@/lib/num";

async function requireManager() {
  const me = await getSession();
  if (!me || !hasPermission(me, "hr_constructor", "edit")) {
    throw new Error("Forbidden.");
  }
  return me;
}

export type ProjectWorkInput = {
  employee_id: number;
  order_number: string;
  rate: number;
  ot: number;
  description: string | null;
  work_date: string;
  status: "Unpaid" | "Paid";
};

function txt(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s || null;
}

// `keepProject` = HUWAG hawakan ang project_name. Ito ang may hawak ng BUONG
// item — pangalan sa unang linya, spec sa mga sumunod bilang bullet — at ang
// listahan at ang payslip ay dito naghahango. Ang Save sa Edit form ay
// nagpapalit nito ng order number, kaya ang pagbukas ng hilerang galing sa QC o
// sa rework at pagpindot ng Save ay bumubura ng labing-isang linya ng spec.
// Sa BAGONG entry, order number pa rin ang panimula (walang item na naitala).
function clean(i: ProjectWorkInput, keepProject = false) {
  const order = i.order_number.trim();
  const rate = money(i.rate);
  const ot = money(i.ot);
  return {
    employee_id: Number(i.employee_id),
    order_number: order || null,
    ...(keepProject ? {} : { project_name: order || "Project" }),
    rate,
    ot,
    amount: rate + ot, // total = rate + OT
    description: txt(i.description),
    work_date: i.work_date,
    status: i.status === "Paid" ? "Paid" : "Unpaid",
  };
}

const MODULE = "hr_project_work";
const TABLE = "hr_project_work";

export async function createProjectWork(input: ProjectWorkInput): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  if (!input.employee_id) return { error: "Employee is required." };
  if (!input.order_number?.trim()) return { error: "Order number is required." };
  if (!input.work_date) return { error: "Work date is required." };
  const db = createServerSupabase();
  const { data, error } = await db.from(TABLE).insert(clean(input)).select("id").single();
  if (error) return { error: error.message };
  await auditAfter({ module: MODULE, table: TABLE, recordId: data?.id ?? "—", action: "insert", snapshotTable: TABLE, snapshotId: data?.id });
  revalidatePath("/hr/projects");
  revalidatePath("/hr/payroll");
  return { ok: true };
}

export async function updateProjectWork(id: number, input: ProjectWorkInput): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  if (!input.employee_id) return { error: "Employee is required." };
  if (!input.order_number?.trim()) return { error: "Order number is required." };
  if (!input.work_date) return { error: "Work date is required." };
  const db = createServerSupabase();
  const before = await snapshot(TABLE, id);
  const { error } = await db.from(TABLE).update(clean(input, true)).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: MODULE, table: TABLE, recordId: id, action: "update", before, snapshotTable: TABLE, snapshotId: id });
  revalidatePath("/hr/projects");
  revalidatePath("/hr/payroll");
  return { ok: true };
}

export async function deleteProjectWork(id: number): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const before = await snapshot(TABLE, id);
  const { error } = await db.from(TABLE).delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: MODULE, table: TABLE, recordId: id, action: "delete", before });
  revalidatePath("/hr/projects");
  revalidatePath("/hr/payroll");
  return { ok: true };
}
