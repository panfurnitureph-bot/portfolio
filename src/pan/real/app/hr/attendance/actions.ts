"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { todayPH } from "@/lib/today";
import { getSession, getSessionFast } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { isAdmin } from "@/lib/auth/rbac";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { money } from "@/lib/num";
import type { AttendanceStatus } from "@/lib/hr/types";
import { statusForTimeIn } from "@/lib/hr/shift";

const STATUSES: AttendanceStatus[] = ["present", "late", "absent", "halfday", "leave", "restday", "holiday"];

async function requireManager() {
  const me = await getSession();
  if (!me || !hasPermission(me, "hr_attendance", "edit")) {
    throw new Error("Forbidden.");
  }
  return me;
}

// Today's date in PHP local time (YYYY-MM-DD) — matches a `date` column.
// Late detection lives in lib/hr/shift.ts (shared with the Face kiosk) so both
// paths use the same onsite-9AM / WFH-6PM rules. Imported above.

export type AttendanceInput = {
  id?: number | null;
  employee_id: number;
  work_date: string;
  time_in: string | null;
  time_out: string | null;
  status: AttendanceStatus;
  ot_hours: number;
  notes: string | null;
};

// Regular shift caps at 9 hours (break included); anything beyond → overtime.
// Falls back to the manual OT value when there's no clock-in/out pair.
const MAX_REGULAR_HOURS = 9;
function otFromTimes(time_in: string | null, time_out: string | null, manualOt: number): number {
  if (!time_in || !time_out) return manualOt;
  let inMs = new Date(time_in).getTime();
  let outMs = new Date(time_out).getTime();
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return manualOt;
  if (outMs <= inMs) outMs += 86_400_000; // crosses midnight
  const worked = (outMs - inMs) / 3_600_000;
  return Math.round(Math.max(worked - MAX_REGULAR_HOURS, 0) * 100) / 100;
}

type SB = ReturnType<typeof createServerSupabase>;

// Keep an hr_overtime row in sync with a computed OT. Preserves the existing
// approval status on update; removes the OT row when OT drops to 0.
async function syncOvertime(db: SB, attendanceId: number, employeeId: number, workDate: string, otHours: number): Promise<string | null> {
  if (otHours > 0) {
    const { data: ex } = await db.from("hr_overtime").select("id").eq("attendance_id", attendanceId).maybeSingle();
    const isNew = !ex?.id;
    const { error } = ex?.id
      ? await db.from("hr_overtime").update({ hours: otHours, employee_id: employeeId, work_date: workDate }).eq("id", ex.id)
      : await db.from("hr_overtime").insert({ attendance_id: attendanceId, employee_id: employeeId, work_date: workDate, hours: otHours, status: "Pending" });
    // Push HR on a NEW overtime row only (not every attendance re-sync).
    if (!error && isNew) {
      try {
        const { data: emp } = await db.from("employees").select("name").eq("id", employeeId).maybeSingle();
        const { notifyHrRequest } = await import("@/lib/push/notify");
        await notifyHrRequest({
          kind: "Overtime",
          employee: (emp?.name as string | undefined) ?? `Employee #${employeeId}`,
          date: workDate,
          detail: `${otHours} hr${otHours === 1 ? "" : "s"}`,
        });
      } catch { /* best-effort */ }
    }
    return error ? error.message : null;
  }
  const { error } = await db.from("hr_overtime").delete().eq("attendance_id", attendanceId);
  return error ? error.message : null;
}

function clean(i: AttendanceInput) {
  return {
    employee_id: Number(i.employee_id),
    work_date: i.work_date,
    time_in: i.time_in || null,
    time_out: i.time_out || null,
    status: STATUSES.includes(i.status) ? i.status : "present",
    ot_hours: money(i.ot_hours),
    notes: i.notes?.trim() || null,
  };
}

// Insert or update one manual attendance row (upsert by employee_id + work_date).
export async function saveAttendance(
  input: AttendanceInput,
): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  if (!input.employee_id) return { error: "Employee is required." };
  if (!input.work_date) return { error: "Date is required." };
  const db = createServerSupabase();
  const row = { ...clean(input), source: "manual" };
  // Regular hours cap at 9 (incl. break); excess auto-goes to overtime.
  row.ot_hours = otFromTimes(row.time_in, row.time_out, row.ot_hours);
  // Auto late detection per the row's shift (onsite 9AM / WFH 6PM) for worked
  // entries — manual absent/leave/restday/holiday selections are kept as-is.
  if (row.time_in && (row.status === "present" || row.status === "late")) {
    row.status = statusForTimeIn(row.time_in, row.source);
  }

  // Editing a specific row → update THAT row by id (allows changing the date).
  if (input.id) {
    const before = await snapshot("hr_attendance", input.id);
    const { error } = await db.from("hr_attendance").update(row).eq("id", input.id);
    if (error) return { error: /duplicate|unique/i.test(error.message) ? "A log already exists for that employee and date." : error.message };
    await auditAfter({ module: "hr_attendance", table: "hr_attendance", recordId: input.id, action: "update", before, snapshotTable: "hr_attendance", snapshotId: input.id });
    const otErr = await syncOvertime(db, input.id, row.employee_id, row.work_date, row.ot_hours);
    if (otErr) return { error: `Overtime sync failed: ${otErr}` };
    revalidatePath("/hr/attendance");
    revalidatePath("/hr/overtime");
    return { ok: true };
  }

  // New entry → find an existing row for this employee/date to choose insert vs update.
  const { data: existing } = await db
    .from("hr_attendance")
    .select("id")
    .eq("employee_id", row.employee_id)
    .eq("work_date", row.work_date)
    .maybeSingle();

  if (existing?.id) {
    const before = await snapshot("hr_attendance", existing.id as number);
    const { error } = await db.from("hr_attendance").update(row).eq("id", existing.id);
    if (error) return { error: error.message };
    await auditAfter({ module: "hr_attendance", table: "hr_attendance", recordId: existing.id as number, action: "update", before, snapshotTable: "hr_attendance", snapshotId: existing.id as number });
    const otErr = await syncOvertime(db, existing.id as number, row.employee_id, row.work_date, row.ot_hours);
    if (otErr) return { error: `Overtime sync failed: ${otErr}` };
  } else {
    const { data, error } = await db.from("hr_attendance").insert(row).select("id").single();
    if (error) return { error: /duplicate|unique/i.test(error.message) ? "A log already exists for that employee and date." : error.message };
    await auditAfter({ module: "hr_attendance", table: "hr_attendance", recordId: data?.id ?? "—", action: "insert", snapshotTable: "hr_attendance", snapshotId: data?.id });
    if (data?.id) {
      const otErr = await syncOvertime(db, data.id as number, row.employee_id, row.work_date, row.ot_hours);
      if (otErr) return { error: `Overtime sync failed: ${otErr}` };
    }
  }
  revalidatePath("/hr/attendance");
  revalidatePath("/hr/overtime");
  return { ok: true };
}

export async function deleteAttendance(id: number): Promise<{ ok: true } | { error: string }> {
  await requireManager();
  const db = createServerSupabase();
  const before = await snapshot("hr_attendance", id);
  const { error } = await db.from("hr_attendance").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "hr_attendance", table: "hr_attendance", recordId: id, action: "delete", before });
  revalidatePath("/hr/attendance");
  return { ok: true };
}

// Resolve the current user's linked employee — by email first (reliable), then
// by name. Set the employee's email = the user's login email to link them.
async function myEmployee(db: ReturnType<typeof createServerSupabase>, fullName: string, email?: string) {
  const em = (email ?? "").trim();
  if (em) {
    const { data } = await db.from("employees").select("id, name").ilike("email", em);
    if (data && data[0]) return data[0];
  }
  const name = (fullName ?? "").trim();
  if (name) {
    const { data } = await db.from("employees").select("id, name").ilike("name", name);
    if (data && data[0]) return data[0];
  }
  return null;
}

// Self clock-in: set time_in on today's row; 'late' after 9:00 AM.
// wfh=true tags the source as 'wfh' (work-from-home), else 'self' (office).
export async function clockIn(wfh = false): Promise<{ ok: true } | { error: string }> {
  const me = await getSessionFast(); // cookie-based; avoids extra auth.getUser() (rate limits)
  if (!me) return { error: "Not signed in." };
  const db = createServerSupabase();
  const emp = await myEmployee(db, me.full_name, me.email);
  if (!emp) return { error: "No employee record linked to your account." };

  const work_date = todayPH();
  const now = new Date().toISOString();
  const source = wfh ? "wfh" : "self";
  const status = statusForTimeIn(now, source);

  // Block double clock-in: must close the open session first.
  const { data: open } = await db
    .from("hr_attendance")
    .select("id")
    .eq("employee_id", emp.id)
    .eq("work_date", work_date)
    .not("time_in", "is", null)
    .is("time_out", null)
    .limit(1)
    .maybeSingle();
  if (open?.id) return { error: "You're already clocked in. Clock out first." };

  // Start a NEW session for today (multiple sessions per day allowed).
  const { data, error } = await db
    .from("hr_attendance")
    .insert({ employee_id: emp.id, work_date, time_in: now, status, source, ot_hours: 0 })
    .select("id")
    .single();
  if (error) return { error: error.message };
  // Audit is best-effort logging — don't make the user wait on two extra round-trips
  // (snapshot + audit insert) before Clock In returns. Fire it without awaiting.
  void audit({ module: "hr_attendance", table: "hr_attendance", recordId: data?.id ?? "—", action: "insert", after: { time_in: now, status, source } });
  revalidatePath("/hr/attendance");
  revalidatePath("/hr/wfh");
  return { ok: true };
}

// Self clock-out: set time_out on today's row.
export async function clockOut(wfh = false): Promise<{ ok: true } | { error: string }> {
  const me = await getSessionFast(); // cookie-based; avoids extra auth.getUser() (rate limits)
  if (!me) return { error: "Not signed in." };
  const db = createServerSupabase();
  const emp = await myEmployee(db, me.full_name, me.email);
  if (!emp) return { error: "No employee record linked to your account." };

  const work_date = todayPH();
  const now = new Date().toISOString();
  const source = wfh ? "wfh" : "self";

  // Close the LATEST open session — KAHIT KAILAN pa ito nagsimula. Ang nakalimutang
  // i-clock-out kahapon ay nananatiling "In Progress" at dating WALANG paraan
  // isara (today-only ang lumang filter) — ngayon ang Clock Out ang nagsasara nito.
  const { data: open } = await db
    .from("hr_attendance")
    .select("id, time_in, ot_hours, work_date")
    .eq("employee_id", emp.id)
    .not("time_in", "is", null)
    .is("time_out", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!open?.id) return { error: "No open clock-in to close." };

  const ot = otFromTimes((open.time_in as string) ?? null, now, Number(open.ot_hours) || 0);
  const { error } = await db.from("hr_attendance").update({ time_out: now, ot_hours: ot, source }).eq("id", open.id);
  if (error) return { error: error.message };
  const otErr = await syncOvertime(db, open.id as number, emp.id, (open.work_date as string | null) ?? work_date, ot);
  if (otErr) return { error: `Overtime sync failed: ${otErr}` };
  // Best-effort audit — fire without awaiting so Clock Out returns fast (skips the two
  // extra snapshot round-trips it used to await).
  void audit({ module: "hr_attendance", table: "hr_attendance", recordId: open.id as number, action: "update", after: { time_out: now, ot_hours: ot } });
  revalidatePath("/hr/attendance");
  revalidatePath("/hr/wfh");
  revalidatePath("/hr/overtime");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// WFH ACTIVITY — periodic heartbeat from the WFH client (Activity tab). Records a
// ~5-min bucket of active/idle/away seconds, optionally with a webcam selfie +
// face-match flag. ADDITIVE: never touches hr_attendance (clocked hours stay the
// payroll basis). Best-effort: returns {ok} even on soft failures so the client
// loop never breaks; only writes while a WFH session is actually open today.
// ─────────────────────────────────────────────────────────────────────────────
type WfhBeat = {
  activeSeconds: number;
  idleSeconds: number;
  awaySeconds: number;
  selfie?: string | null;   // webcam data URL (<=60KB) — optional
  screen?: string | null;   // screen-share data URL (<=200KB) — optional
  faceOk?: boolean | null;  // true matched / false no-or-unmatched face / null no selfie/no-enrolled
  bucketStart?: string;     // ISO; client window start (defaults to now)
  lastStatus?: "active" | "idle" | "away"; // live status at the moment of this beat
};

export async function wfhHeartbeat(beat: WfhBeat): Promise<{ ok: true } | { error: string }> {
  try {
    const me = await getSessionFast();
    if (!me) return { error: "Not signed in." };
    const db = createServerSupabase();
    const emp = await myEmployee(db, me.full_name, me.email);
    if (!emp) return { error: "No employee record linked to your account." };

    const work_date = todayPH();

    // Only record while a WFH session is OPEN today — no point logging activity
    // for someone who isn't clocked in (and stops stale clients from writing).
    const { data: open } = await db
      .from("hr_attendance")
      .select("id")
      .eq("employee_id", emp.id)
      .eq("work_date", work_date)
      .eq("source", "wfh")
      .not("time_in", "is", null)
      .is("time_out", null)
      .limit(1)
      .maybeSingle();
    if (!open?.id) return { ok: true }; // not clocked in (WFH) → silently ignore

    const clampSec = (n: unknown) => {
      const v = Math.round(Number(n) || 0);
      return v < 0 ? 0 : v > 3600 ? 3600 : v; // a bucket can't exceed an hour
    };
    let selfie_jpeg: string | null = null;
    if (typeof beat.selfie === "string" && /^data:image\/(jpeg|png);base64,/.test(beat.selfie)) {
      selfie_jpeg = beat.selfie.length <= 60_000 ? beat.selfie : null;
    }
    let screen_jpeg: string | null = null;
    if (typeof beat.screen === "string" && /^data:image\/(jpeg|png);base64,/.test(beat.screen)) {
      screen_jpeg = beat.screen.length <= 350_000 ? beat.screen : null; // ~1280px JPEG fits
    }
    const bucket_start = beat.bucketStart && !Number.isNaN(Date.parse(beat.bucketStart))
      ? beat.bucketStart
      : new Date().toISOString();

    const last_status = beat.lastStatus === "idle" || beat.lastStatus === "away" || beat.lastStatus === "active" ? beat.lastStatus : null;
    const { error } = await db.from("wfh_activity").insert({
      employee_id: emp.id,
      work_date,
      bucket_start,
      active_seconds: clampSec(beat.activeSeconds),
      idle_seconds: clampSec(beat.idleSeconds),
      away_seconds: clampSec(beat.awaySeconds),
      selfie_jpeg,
      screen_jpeg,
      // true=matched, false=read-but-no-match, null=unverified (no enrolled face) or no selfie
      face_ok: selfie_jpeg ? (beat.faceOk === true ? true : beat.faceOk === false ? false : null) : null,
      last_status,
    });
    if (error) return { error: error.message };
    revalidatePath("/hr/wfh");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Heartbeat failed." };
  }
}

// Lightweight context for the APP-LEVEL WFH activity tracker (mounted in the shell
// on every page). Tells the client: which employee this user is, their enrolled
// face descriptor (for selfie match), and whether they currently have an OPEN WFH
// session today — so the global heartbeat runs ONLY for clocked-in WFH employees,
// regardless of which page they're on. Returns null if not signed in.
export type WfhContext = {
  employeeId: number | null; faceDescriptor: number[] | null; hasOpenWfhSession: boolean;
  // Admin-configurable cadence (app_settings; Settings sa WFH Activity tab):
  idleAfterS: number;    // ilang segundo na walang input bago maging Idle
  selfieEveryS: number;  // ilang segundo bawat selfie + screen snapshot
};

// Defaults kapag walang naka-save na setting (production cadence).
const WFH_DEFAULT_IDLE_MIN = 5;
const WFH_DEFAULT_SELFIE_MIN = 10;

async function readWfhSettings(db: ReturnType<typeof createServerSupabase>): Promise<{ idleAfterS: number; selfieEveryS: number }> {
  const { data } = await db.from("app_settings").select("key, value").in("key", ["wfh_idle_after_min", "wfh_selfie_every_min"]);
  const get = (k: string, defMin: number) => {
    const raw = (data ?? []).find((r) => r.key === k)?.value;
    const n = Number(typeof raw === "string" ? raw : (raw as { min?: number } | null)?.min ?? raw);
    return (Number.isFinite(n) && n > 0 ? n : defMin) * 60;
  };
  return { idleAfterS: get("wfh_idle_after_min", WFH_DEFAULT_IDLE_MIN), selfieEveryS: get("wfh_selfie_every_min", WFH_DEFAULT_SELFIE_MIN) };
}

// Admin: itakda ang WFH tracker cadence (minutes). Ginagamit ng Settings modal.
export async function saveWfhSettings(input: { idleAfterMin: number; selfieEveryMin: number }): Promise<{ ok: true } | { error: string }> {
  try {
    // Permission din (2026-09-05): Edit sa HR Attendance sa grid.
    const me = await getSessionFast();
    if (!me || !(isAdmin(me.role) || me.role === "operations_manager" || hasPermission(me, "hr_attendance", "edit"))) return { error: "Forbidden." };
    const idle = Math.min(Math.max(Math.round(Number(input.idleAfterMin) || 0), 1), 120);
    const selfie = Math.min(Math.max(Math.round(Number(input.selfieEveryMin) || 0), 1), 240);
    const db = createServerSupabase();
    for (const [key, value] of [["wfh_idle_after_min", String(idle)], ["wfh_selfie_every_min", String(selfie)]] as const) {
      await db.from("app_settings").upsert({ key, value }, { onConflict: "key" });
    }
    revalidatePath("/hr/wfh");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save settings." };
  }
}

export async function myWfhContext(): Promise<WfhContext | null> {
  try {
    const me = await getSessionFast();
    if (!me) return null;
    const db = createServerSupabase();
    const emp = await myEmployee(db, me.full_name, me.email);
    const cadence = await readWfhSettings(db);
    if (!emp) return { employeeId: null, faceDescriptor: null, hasOpenWfhSession: false, ...cadence };

    // Enrolled face descriptor (for selfie match) + open WFH session check, parallel.
    const work_date = todayPH();
    const [{ data: e }, { data: open }] = await Promise.all([
      db.from("employees").select("face_descriptor").eq("id", emp.id).maybeSingle(),
      db.from("hr_attendance").select("id")
        .eq("employee_id", emp.id).eq("work_date", work_date).eq("source", "wfh")
        .not("time_in", "is", null).is("time_out", null).limit(1).maybeSingle(),
    ]);
    const fd = e?.face_descriptor;
    const faceDescriptor = Array.isArray(fd) && (fd as number[]).length === 128 ? (fd as number[]) : null;
    return { employeeId: emp.id as number, faceDescriptor, hasOpenWfhSession: !!open?.id, ...cadence };
  } catch {
    return null;
  }
}
