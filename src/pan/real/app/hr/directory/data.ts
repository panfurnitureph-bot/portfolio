import { createServerSupabase } from "@/lib/supabase/server";
import type { HrEmployee } from "@/lib/hr/types";

// Explicit column list = the HrEmployee fields ONLY. Deliberately excludes the heavy
// face_descriptor (a 128-float array per employee, migration 0077) which the directory
// list never uses — face_enrolled_at is enough to show "enrolled". Avoids shipping those
// arrays for every employee on each load.
const HR_EMPLOYEE_COLS =
  "id, name, role, on_call, rate, rate_type, allowance, contact, email, address, position, department, employment_type, work_setup, hire_date, birthdate, day_off, photo_url, sss_no, philhealth_no, pagibig_no, tin, bank_account, active, face_enrolled_at, can_enroll, branch";

export async function loadHrEmployees(): Promise<HrEmployee[]> {
  const db = createServerSupabase();
  const { data } = await db.from("employees").select(HR_EMPLOYEE_COLS).order("role").order("name").limit(10000);
  return (data ?? []) as unknown as HrEmployee[];
}

// ── UNIFIED DIRECTORY: mga login account (2026-09-03) ────────────────────────
// Kaninong empleyado ang account (employee_id, 0227) + ang mga SHARED na
// account (team/workshop/kiosk) na walang katumbas na tao. Best-effort: bago
// tumakbo ang 0227 ay walang employee_id/is_shared na column — walang login
// info, buhay pa rin ang Directory.
export type EmployeeLoginInfo = {
  profileId: string;
  email: string | null;
  role: string;
  status: string | null;
  fullName: string | null;
  isShared: boolean;
  // Admin-issued na temp password (0228) — para sa preview. Null kapag wala
  // pang naitalang temp (lumang account) o wala pang 0228. LUMA na ito kapag
  // pinalitan na ng empleyado ang sarili niyang password.
  tempPassword: string | null;
  tempPasswordAt: string | null;
};

export type DirectoryLogins = {
  byEmployee: Record<number, EmployeeLoginInfo>;
  shared: EmployeeLoginInfo[];
};

export async function loadDirectoryLogins(): Promise<DirectoryLogins> {
  const db = createServerSupabase();
  const out: DirectoryLogins = { byEmployee: {}, shared: [] };
  try {
    const { data, error } = await db.from("profiles")
      .select("id, full_name, email, role, status, employee_id, is_shared")
      .order("full_name").limit(2000);
    if (error) return out; // wala pang 0227
    // Admin-issued temp passwords (0228) — service-role read; ang page na
    // tumatawag nito ay admin-gated. Best-effort kapag wala pa ang table.
    const tempBy = new Map<string, { pw: string; at: string | null }>();
    try {
      const { data: tp } = await db.from("login_temp_passwords").select("profile_id, temp_password, set_at").limit(2000);
      for (const t of (tp ?? []) as { profile_id: string; temp_password: string; set_at: string | null }[]) {
        tempBy.set(t.profile_id, { pw: t.temp_password, at: t.set_at });
      }
    } catch { /* wala pang 0228 */ }
    for (const p of (data ?? []) as { id: string; full_name: string | null; email: string | null; role: string; status: string | null; employee_id: number | null; is_shared: boolean | null }[]) {
      const t = tempBy.get(p.id);
      const info: EmployeeLoginInfo = {
        profileId: p.id, email: p.email, role: p.role, status: p.status,
        fullName: p.full_name, isShared: !!p.is_shared,
        tempPassword: t?.pw ?? null, tempPasswordAt: t?.at ?? null,
      };
      if (p.employee_id != null) out.byEmployee[p.employee_id] = info;
      else if (p.is_shared) out.shared.push(info);
    }
  } catch { /* wala pang 0227 — walang login column sa Directory */ }
  return out;
}

export async function loadEmployee(id: number): Promise<HrEmployee | null> {
  const db = createServerSupabase();
  const { data } = await db.from("employees").select(HR_EMPLOYEE_COLS).eq("id", id).maybeSingle();
  return (data as unknown as HrEmployee) ?? null;
}
