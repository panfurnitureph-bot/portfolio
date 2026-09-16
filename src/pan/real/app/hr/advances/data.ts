import { createServerSupabase } from "@/lib/supabase/server";
import type { Advance } from "@/lib/hr/types";

export type AdvanceRow = Advance & { employee_name: string };
export type EmployeeLite = { id: number; name: string; role: string };

export async function loadAdvances(): Promise<AdvanceRow[]> {
  const db = createServerSupabase();
  const { data } = await db
    .from("hr_advances")
    .select("id, employee_id, amount, deducted, date_issued, reason, status")
    .order("date_issued", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as Advance[];

  // Attach employee names (map from employees id -> name).
  const ids = [...new Set(rows.map((r) => r.employee_id).filter(Boolean))] as number[];
  const byId = new Map<number, string>();
  if (ids.length) {
    const { data: emps } = await db.from("employees").select("id, name").in("id", ids);
    for (const e of emps ?? []) byId.set(e.id as number, (e.name as string) ?? "");
  }
  return rows.map((r) => ({ ...r, employee_name: byId.get(r.employee_id) ?? "—" }));
}

export async function loadEmployeesLite(): Promise<EmployeeLite[]> {
  const db = createServerSupabase();
  const { data } = await db
    .from("employees")
    .select("id, name, role")
    .eq("active", true)
    .order("name")
    .limit(5000);
  return (data ?? []) as EmployeeLite[];
}
