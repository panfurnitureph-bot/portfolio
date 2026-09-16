import { createServerSupabase } from "@/lib/supabase/server";
import type { Attendance } from "@/lib/hr/types";

function todayPH(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// The signed-in user's employee + today's row + their recent attendance records
// (for the personal timesheet). Matches by email first, then name.
export type MyOt = { work_date: string; hours: number; status: string };
// Ang KATAYUAN ay wala rito noon, kaya walang paraang malaman ng naghain kung
// naaprubahan na ang hiling niya — nagpapadala lang, walang balita.
export type MyLeave = { date_from: string; date_to: string; days: number; paid: boolean; leave_type: string; status: string; reason: string | null; created_at: string | null };
export type MyAdvance = { amount: number; deducted: number; date_issued: string; reason: string | null; status: string; created_at: string | null };
export type MyAttRow = Attendance & { ot_status: string | null };
export type WfhAllRow = MyAttRow & { employee_name: string };

// All WFH-sourced attendance (admin/manager view) — recent first, with names + OT status.
export async function loadWfhAll(): Promise<WfhAllRow[]> {
  const db = createServerSupabase();
  const { data } = await db.from("hr_attendance").select("id, employee_id, work_date, time_in, time_out, status, ot_hours, source, notes").eq("source", "wfh").order("work_date", { ascending: false }).order("id", { ascending: false }).limit(500);
  const base = (data ?? []) as Attendance[];
  const empIds = [...new Set(base.map((r) => r.employee_id))];
  const attIds = base.map((r) => r.id);
  // employees + overtime both depend only on the first query and are independent
  // of each other → fetch them in parallel (one round-trip instead of two).
  const [{ data: emps }, { data: ot }] = await Promise.all([
    empIds.length ? db.from("employees").select("id, name").in("id", empIds) : Promise.resolve({ data: [] as { id: number; name: string }[] }),
    attIds.length ? db.from("hr_overtime").select("attendance_id, status").in("attendance_id", attIds) : Promise.resolve({ data: [] as { attendance_id: number | null; status: string }[] }),
  ]);
  const names = new Map<number, string>();
  for (const e of emps ?? []) names.set(e.id as number, e.name as string);
  const otByAtt = new Map<number, string>();
  for (const o of ot ?? []) if (o.attendance_id != null) otByAtt.set(o.attendance_id as number, o.status as string);
  return base.map((r) => ({ ...r, ot_status: otByAtt.get(r.id) ?? null, employee_name: names.get(r.employee_id) ?? "—" }));
}

export async function loadMyWfh(fullName: string, email?: string): Promise<{ employeeId: number | null; employeeName: string | null; faceDescriptor: number[] | null; today: MyAttRow | null; rows: MyAttRow[]; overtime: MyOt[]; leaves: MyLeave[]; advances: MyAdvance[] }> {
  const db = createServerSupabase();
  const em = (email ?? "").trim();
  const name = (fullName ?? "").trim();
  type EmpRow = { id: number; name: string; face_descriptor: unknown };
  let e: EmpRow | null = null;
  if (em) {
    const { data } = await db.from("employees").select("id, name, face_descriptor").ilike("email", em);
    if (data?.[0]) e = data[0] as unknown as EmpRow;
  }
  if (!e && name) {
    const { data } = await db.from("employees").select("id, name, face_descriptor").ilike("name", name);
    if (data?.[0]) e = data[0] as unknown as EmpRow;
  }
  if (!e) return { employeeId: null, employeeName: null, faceDescriptor: null, today: null, rows: [], overtime: [], leaves: [], advances: [] };
  const faceDescriptor = Array.isArray(e.face_descriptor) && (e.face_descriptor as number[]).length === 128 ? (e.face_descriptor as number[]) : null;

  const [{ data }, { data: ot }, { data: lv }, { data: adv }] = await Promise.all([
    db.from("hr_attendance").select("id, employee_id, work_date, time_in, time_out, status, ot_hours, source, notes").eq("employee_id", e.id as number).order("work_date", { ascending: false }).order("id", { ascending: false }).limit(400),
    db.from("hr_overtime").select("attendance_id, work_date, hours, status").eq("employee_id", e.id as number).limit(500),
    db.from("hr_leaves").select("date_from, date_to, days, paid, leave_type, status, reason, created_at").eq("employee_id", e.id as number).order("id", { ascending: false }).limit(500),
    db.from("hr_advances").select("amount, deducted, date_issued, reason, status, created_at").eq("employee_id", e.id as number).order("id", { ascending: false }).limit(500),
  ]);
  const base = (data ?? []) as Attendance[];
  // Build the per-attendance OT status map from the SAME overtime fetch (no 2nd query).
  const otByAtt = new Map<number, string>();
  for (const o of ot ?? []) if (o.attendance_id != null) otByAtt.set(o.attendance_id as number, o.status as string);
  const rows: MyAttRow[] = base.map((r) => ({ ...r, ot_status: otByAtt.get(r.id) ?? null }));
  // Latest session for today (so the clock card reflects the current open session).
  const today = rows.find((r) => r.work_date === todayPH()) ?? null;
  return { employeeId: e.id as number, employeeName: e.name as string, faceDescriptor, today, rows, overtime: (ot ?? []) as MyOt[], leaves: (lv ?? []) as MyLeave[], advances: (adv ?? []) as MyAdvance[] };
}

// ── WFH ACTIVITY loaders ─────────────────────────────────────────────────────
export type WfhBucket = { id: number; bucket_start: string; active_seconds: number; idle_seconds: number; away_seconds: number; selfie_jpeg: string | null; screen_jpeg: string | null; face_ok: boolean | null };
export type WfhShot = { time: string; jpeg: string | null; screen: string | null; ok: boolean | null };
export type MyActivity = { active: number; idle: number; away: number; pct: number; selfies: WfhShot[] };
export type WfhActivityRow = {
  employee_id: number; employee_name: string;
  active: number; idle: number; away: number; pct: number;
  clockedSeconds: number; lastSeen: string | null; lastStatus: string | null;
  selfies: WfhShot[];
  noFace: number;
};

// Today's activity for ONE employee (the signed-in WFH user) — totals + selfies.
export async function loadMyWfhActivity(employeeId: number): Promise<MyActivity> {
  const db = createServerSupabase();
  const { data } = await db
    .from("wfh_activity")
    .select("bucket_start, active_seconds, idle_seconds, away_seconds, selfie_jpeg, screen_jpeg, face_ok")
    .eq("employee_id", employeeId)
    .eq("work_date", todayPH())
    .order("bucket_start", { ascending: true })
    .limit(400);
  const rows = (data ?? []) as Omit<WfhBucket, "id">[];
  let active = 0, idle = 0, away = 0;
  const selfies: MyActivity["selfies"] = [];
  for (const r of rows) {
    active += r.active_seconds; idle += r.idle_seconds; away += r.away_seconds;
    if (r.selfie_jpeg || r.screen_jpeg) selfies.push({ time: r.bucket_start, jpeg: r.selfie_jpeg, screen: r.screen_jpeg, ok: r.face_ok });
  }
  const denom = active + idle;
  return { active, idle, away, pct: denom > 0 ? Math.round((active / denom) * 100) : 0, selfies: selfies.slice(-8) };
}

// Today's activity for ALL WFH staff (manager dashboard) — one aggregated row per
// employee with clocked hours (from hr_attendance) joined in.
export async function loadWfhActivityAll(): Promise<WfhActivityRow[]> {
  const db = createServerSupabase();
  const work_date = todayPH();
  const { data } = await db
    .from("wfh_activity")
    .select("employee_id, bucket_start, active_seconds, idle_seconds, away_seconds, selfie_jpeg, screen_jpeg, face_ok, last_status")
    .eq("work_date", work_date)
    .order("bucket_start", { ascending: true })
    .limit(4000);
  const rows = (data ?? []) as ({ employee_id: number; last_status: string | null } & Omit<WfhBucket, "id">)[];
  if (rows.length === 0) return [];

  const empIds = [...new Set(rows.map((r) => r.employee_id))];
  // employees + today's attendance both depend only on empIds and are independent
  // of each other → fetch them in parallel (one round-trip instead of two).
  const [{ data: emps }, { data: att }] = await Promise.all([
    db.from("employees").select("id, name").in("id", empIds),
    db
      .from("hr_attendance")
      .select("employee_id, time_in, time_out")
      .eq("source", "wfh").eq("work_date", work_date)
      .in("employee_id", empIds)
      .limit(5000),
  ]);
  const names = new Map<number, string>();
  for (const e of emps ?? []) names.set(e.id as number, e.name as string);

  // Today's WFH clocked seconds per employee (open session counts up to now).
  const clocked = new Map<number, number>();
  const nowMs = Date.now();
  for (const a of att ?? []) {
    if (!a.time_in) continue;
    const inMs = new Date(a.time_in as string).getTime();
    const outMs = a.time_out ? new Date(a.time_out as string).getTime() : nowMs;
    clocked.set(a.employee_id as number, (clocked.get(a.employee_id as number) ?? 0) + Math.max(0, Math.round((outMs - inMs) / 1000)));
  }

  const byEmp = new Map<number, WfhActivityRow>();
  for (const r of rows) {
    let row = byEmp.get(r.employee_id);
    if (!row) {
      row = { employee_id: r.employee_id, employee_name: names.get(r.employee_id) ?? "—", active: 0, idle: 0, away: 0, pct: 0, clockedSeconds: clocked.get(r.employee_id) ?? 0, lastSeen: null, lastStatus: null, selfies: [], noFace: 0 };
      byEmp.set(r.employee_id, row);
    }
    row.active += r.active_seconds; row.idle += r.idle_seconds; row.away += r.away_seconds;
    row.lastSeen = r.bucket_start;
    row.lastStatus = r.last_status; // rows are ascending → last wins
    if (r.selfie_jpeg || r.screen_jpeg) { row.selfies.push({ time: r.bucket_start, jpeg: r.selfie_jpeg, screen: r.screen_jpeg, ok: r.face_ok }); if (r.face_ok === false) row.noFace += 1; }
  }
  const out = [...byEmp.values()];
  for (const row of out) {
    const denom = row.active + row.idle;
    row.pct = denom > 0 ? Math.round((row.active / denom) * 100) : 0;
    // Keep the latest 60 selfies for the gallery (a full ~8-hr shift at 1 every
    // ~10 min ≈ 48). The dashboard row only renders 2 thumbnails; the modal shows
    // them all (scrollable).
    row.selfies = row.selfies.slice(-60);
  }
  return out.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
}
