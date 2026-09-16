"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { money } from "@/lib/num";
import type { EmpRole, EmploymentType } from "@/lib/hr/types";
import type { RateType } from "@/lib/hr/payroll";

async function requireManager() {
  const me = await getSession();
  if (!me || !hasPermission(me, "hr_directory", "edit")) {
    throw new Error("Forbidden.");
  }
  return me;
}

export type HrEmployeeInput = {
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
  work_setup: string;   // Onsite | WFH | Hybrid
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
  // Showroom ng empleyado (San Pedro / Carmona) — PAN Overall branch detection.
  branch?: string | null;
};

function txt(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s || null;
}

function clean(i: HrEmployeeInput) {
  return {
    name: i.name.trim(),
    role: i.role,
    on_call: !!i.on_call,
    rate: i.rate == null ? null : money(i.rate),
    rate_type: i.rate_type,
    allowance: i.allowance == null ? null : money(i.allowance),
    contact: txt(i.contact),
    email: txt(i.email),
    address: txt(i.address),
    position: txt(i.position),
    department: txt(i.department),
    employment_type: i.employment_type,
    work_setup: ["Onsite", "WFH", "Hybrid"].includes(i.work_setup) ? i.work_setup : "Onsite",
    hire_date: txt(i.hire_date),
    birthdate: txt(i.birthdate),
    day_off: txt(i.day_off),
    photo_url: txt(i.photo_url),
    sss_no: txt(i.sss_no),
    philhealth_no: txt(i.philhealth_no),
    pagibig_no: txt(i.pagibig_no),
    tin: txt(i.tin),
    bank_account: txt(i.bank_account),
    active: i.active !== false,
    // Conditional para hindi masira ang save bago tumakbo ang migration 0147.
    ...(txt(i.branch) ? { branch: txt(i.branch) } : {}),
  };
}

export async function createEmployee(input: HrEmployeeInput): Promise<{ ok: true; id?: number | null } | { error: string }> {
  try {
    await requireManager();
    if (!input.name?.trim()) return { error: "Name is required." };
    const db = createServerSupabase();
    const { data, error } = await db.from("employees").insert(clean(input)).select("id").single();
    if (error) return { error: /role_check/i.test(error.message) ? "Run migration 0031 — role check constraint still blocks new roles." : /duplicate|unique/i.test(error.message) ? `${input.name} already exists for ${input.role}.` : error.message };
    await auditAfter({ module: "employees", table: "employees", recordId: data?.id ?? "—", action: "insert", snapshotTable: "employees", snapshotId: data?.id });
    revalidatePath("/hr/directory");
    revalidatePath("/hr/attendance");
    revalidatePath("/hr/leaves");
    revalidatePath("/hr/advances");
    revalidatePath("/hr/projects");
    revalidatePath("/hr/reports");
    // Ang id ay kailangan ng unified na App Login (2026-09-03): ang bagong
    // empleyado ay maaaring sabay na gawan ng login account na naka-link agad.
    return { ok: true, id: (data?.id as number | null) ?? null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create employee." };
  }
}

export async function updateEmployee(id: number, input: HrEmployeeInput): Promise<{ ok: true } | { error: string }> {
  try {
    await requireManager();
    if (!input.name?.trim()) return { error: "Name is required." };
    const db = createServerSupabase();
    const before = await snapshot("employees", id);
    const { error } = await db.from("employees").update(clean(input)).eq("id", id);
    if (error) return { error: /role_check/i.test(error.message) ? "Run migration 0031 — role check constraint still blocks new roles." : /duplicate|unique/i.test(error.message) ? `${input.name} already exists for ${input.role}.` : error.message };
    await auditAfter({ module: "employees", table: "employees", recordId: id, action: "update", before, snapshotTable: "employees", snapshotId: id });
    revalidatePath("/hr/directory");
    revalidatePath("/hr/directory/[id]", "page");
    revalidatePath("/hr/attendance");
    revalidatePath("/hr/leaves");
    revalidatePath("/hr/advances");
    revalidatePath("/hr/projects");
    revalidatePath("/hr/reports");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update employee." };
  }
}

export async function deleteEmployee(id: number): Promise<{ ok: true } | { error: string }> {
  try {
    await requireManager();
    const db = createServerSupabase();
    const before = await snapshot("employees", id);
    // Monitoring data (WFH activity buckets/selfies) ay pumipigil sa delete via FK
    // — burahin muna; puro surveillance snapshots lang ito, hindi payroll history.
    await db.from("wfh_activity").delete().eq("employee_id", id);
    // KASAMA ANG LOGIN (Joe 2026-09-06, "dapat pag Delete, madedelete talaga sa
    // DB"): ang profile na nakakabit sa empleyadong ito (employee_id, o parehong
    // email) ay binubura kasama ang auth user nito — kung hindi, naiiwan ang
    // email na "already registered" at hindi na magamit sa bagong login.
    {
      const emp = (before ?? {}) as { email?: string | null };
      const { data: linked } = await db.from("profiles").select("id").eq("employee_id", id);
      const ids = new Set<string>((linked ?? []).map((p) => p.id as string));
      const em = (emp.email ?? "").trim();
      if (em) {
        const { data: byEmail } = await db.from("profiles").select("id").ilike("email", em);
        for (const p of byEmail ?? []) ids.add(p.id as string);
      }
      for (const pid of ids) {
        const { error: dErr } = await db.auth.admin.deleteUser(pid);
        if (dErr) return { error: `Login not deleted: ${dErr.message}` };
      }
    }
    const { error } = await db.from("employees").delete().eq("id", id);
    if (error) {
      // Payroll/attendance history — SADYANG hinaharang (huwag burahin ang record
      // ng sahod); ang tamang hakbang ay i-deactivate.
      if (/foreign key|violates/i.test(error.message)) {
        return { error: "This employee has attendance/payroll history and cannot be deleted — uncheck Active to hide them instead." };
      }
      return { error: error.message };
    }
    await audit({ module: "employees", table: "employees", recordId: id, action: "delete", before });
    revalidatePath("/hr/directory");
    revalidatePath("/hr/directory/[id]", "page");
    revalidatePath("/hr/attendance");
    revalidatePath("/hr/leaves");
    revalidatePath("/hr/advances");
    revalidatePath("/hr/projects");
    revalidatePath("/hr/reports");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete employee." };
  }
}

export async function uploadEmployeePhoto(formData: FormData): Promise<{ url: string } | { error: string }> {
  await requireManager();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file provided." };
  try {
    const db = createServerSupabase();
    const safe = (file.name || "photo").replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `employees/${Date.now()}-${safe}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error } = await db.storage.from("public").upload(path, buf, { contentType: file.type || "image/jpeg", upsert: true });
    if (error) return { error: error.message };
    const { data } = db.storage.from("public").getPublicUrl(path);
    return { url: `${data.publicUrl}?t=${file.lastModified || Date.now()}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }
}
