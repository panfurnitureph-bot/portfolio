import { createServerSupabase } from "@/lib/supabase/server";
import type { Attendance } from "@/lib/hr/types";

// Attendance row + the employee's display name (joined manually, like
// app/audit-trail/data.ts attaches profile avatars).
export type AttendanceRow = Attendance & { employee_name: string; ot_status: string | null };

export type EmployeeLite = { id: number; name: string; role: string };

// Most-recent attendance rows (work_date desc), with employee name attached.
export async function loadAttendance(limit = 500): Promise<AttendanceRow[]> {
  const db = createServerSupabase();
  const { data } = await db
    .from("hr_attendance")
    .select("id, employee_id, work_date, time_in, time_out, status, ot_hours, source, notes")
    .order("work_date", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Attendance[];

  // Employee names and overtime status both depend only on the rows above, but
  // are independent of each other — fetch them in parallel.
  const ids = [...new Set(rows.map((r) => r.employee_id).filter(Boolean))];
  const rowIds = rows.map((r) => r.id);
  const [empsRes, otRes] = await Promise.all([
    ids.length
      ? db.from("employees").select("id, name").in("id", ids)
      : Promise.resolve({ data: [] as { id: number; name: string }[] }),
    rowIds.length
      ? db.from("hr_overtime").select("attendance_id, status").in("attendance_id", rowIds)
      : Promise.resolve({ data: [] as { attendance_id: number; status: string }[] }),
  ]);

  // Attach each employee's name.
  const byId = new Map<number, string>();
  for (const e of empsRes.data ?? []) byId.set(e.id as number, (e.name as string) ?? "—");

  // Attach overtime approval status (by attendance_id).
  const otByAtt = new Map<number, string>();
  for (const o of otRes.data ?? []) if (o.attendance_id != null) otByAtt.set(o.attendance_id as number, o.status as string);

  return rows.map((r) => ({ ...r, employee_name: byId.get(r.employee_id) ?? "—", ot_status: otByAtt.get(r.id) ?? null }));
}

// Active employees for the manual-log dropdown (id + name + role), name order.
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
