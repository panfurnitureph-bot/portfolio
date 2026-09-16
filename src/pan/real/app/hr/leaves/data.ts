import { createServerSupabase } from "@/lib/supabase/server";
import type { Leave } from "@/lib/hr/types";

// Leave row with the employee's display name attached (joined client-side).
export type LeaveRow = Leave & { created_at: string | null; approved_by: string | null; employee_name: string };

// Active employee, used for the request form + the weekly day-off panel.
export type EmployeeLite = { id: number; name: string; day_off: string | null };

// Recent leave requests (newest first), each with the employee's name resolved
// from the employees table (same id->name mapping approach as audit-trail).
export async function loadLeaves(): Promise<LeaveRow[]> {
  const db = createServerSupabase();
  const { data } = await db
    .from("hr_leaves")
    .select("id, employee_id, leave_type, date_from, date_to, days, paid, reason, status, created_at, approved_by")
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as (Leave & { created_at: string | null; approved_by: string | null })[];

  const ids = [...new Set(rows.map((r) => r.employee_id).filter((v) => v != null))];
  const byId = new Map<number, string>();
  if (ids.length) {
    const { data: emps } = await db.from("employees").select("id, name").in("id", ids);
    for (const e of emps ?? []) byId.set(e.id as number, (e.name as string) ?? "—");
  }

  return rows.map((r) => ({ ...r, employee_name: byId.get(r.employee_id) ?? "—" }));
}

// Active employees (id, name, weekly day_off) for dropdowns + the rest-day panel.
export async function loadEmployeesLite(): Promise<EmployeeLite[]> {
  const db = createServerSupabase();
  const { data } = await db
    .from("employees")
    .select("id, name, day_off")
    .eq("active", true)
    .order("name")
    .limit(5000);
  return (data ?? []) as EmployeeLite[];
}
