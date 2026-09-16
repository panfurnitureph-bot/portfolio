import { createServerSupabase } from "@/lib/supabase/server";
import type { Overtime } from "@/lib/hr/types";

export type OvertimeRow = Overtime & { employee_name: string };

export async function loadOvertime(): Promise<OvertimeRow[]> {
  const db = createServerSupabase();
  const { data } = await db.from("hr_overtime").select("id, employee_id, attendance_id, work_date, hours, reason, status").order("work_date", { ascending: false }).limit(500);
  const rows = (data ?? []) as Overtime[];
  const ids = [...new Set(rows.map((r) => r.employee_id))];
  const names = new Map<number, string>();
  if (ids.length) {
    const { data: emps } = await db.from("employees").select("id, name").in("id", ids);
    for (const e of emps ?? []) names.set(e.id as number, e.name as string);
  }
  return rows.map((r) => ({ ...r, employee_name: names.get(r.employee_id) ?? "—" }));
}
