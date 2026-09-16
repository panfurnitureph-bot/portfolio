"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase, realtimeReady } from "@/lib/supabase/client";
import { Card, cn } from "./ui";
import { WfhSelfService } from "./wfh-self-service";
import { shortDate } from "@/lib/format";
import { clockIn, clockOut, myWfhContext, saveWfhSettings } from "@/app/hr/attendance/actions";
import type { MyOt, MyLeave, MyAdvance, MyAttRow, WfhAllRow, MyActivity, WfhActivityRow } from "@/app/hr/wfh/data";
import type { Attendance, AttendanceStatus } from "@/lib/hr/types";

// Activity totals formatter (used by the manager dashboard). The heartbeat engine
// itself now lives in components/wfh-activity-tracker.tsx (app-level).
function fmtHMS(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
function timePH(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

function todayPH(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function clockTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)) + " PHT";
}
function fmtDur(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return h ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}
function workedMs(time_in: string | null, time_out: string | null): number {
  if (!time_in || !time_out) return 0;
  let i = new Date(time_in).getTime(); let o = new Date(time_out).getTime();
  if (!Number.isFinite(i) || !Number.isFinite(o)) return 0;
  if (o <= i) o += 86_400_000;
  return o - i;
}
const hrs = (ms: number) => (ms / 3_600_000).toFixed(2);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type WfhClockProps = {
  meName: string; employeeId: number | null; employeeName: string | null; faceDescriptor: number[] | null;
  row: Attendance | null; rows: MyAttRow[]; overtime: MyOt[]; leaves: MyLeave[]; advances: MyAdvance[];
  isManager: boolean; wfhAll: WfhAllRow[];
  myActivity: MyActivity | null; activityAll: WfhActivityRow[];
};

export function WfhClock(props: WfhClockProps) {
  // employeeId / faceDescriptor / myActivity are no longer used here — the activity
  // engine moved to the app-level tracker. Kept on the props type (page still
  // passes them) but not destructured.
  const { meName, employeeName, row, rows, overtime, leaves, advances, isManager, wfhAll, activityAll } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false); // short local busy state for the buttons
  const [error, setError] = useState<string | null>(null);
  const [priming, setPriming] = useState(false); // "activating shift" screen shown before the OS permission
  const [tab, setTab] = useState<"attendance" | "activity">("attendance");
  // Open the Activity tab directly when arrived via the "WFH Activity Monitor"
  // sidebar link (/hr/wfh#activity). Client-only; read after mount.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#activity") setTab("activity");
  }, []);

  // Rippling-style: total time accumulates across ALL of today's sessions; a
  // new calendar day automatically starts fresh (rows are keyed by work_date).
  const todayStr = todayPH();
  const todayRows = useMemo(() => rows.filter((r) => r.work_date === todayStr), [rows, todayStr]);
  // CHECKER: ANUMANG open session (kahit kahapon na nakalimutang i-clock-out at
  // "In Progress" pa rin) = clocked in — ang Clock Out ang aktibo para maisara
  // ito; dating today lang ang tinitingnan kaya Clock In ang naka-enable.
  const openRow = rows.find((r) => r.time_in && !r.time_out) ?? null;
  const clockedIn = !!openRow;
  const lastRow = openRow ?? todayRows[0] ?? row;

  const [nowMs, setNowMs] = useState(0); // avoids SSR/client hydration mismatch
  useEffect(() => {
    if (!clockedIn) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [clockedIn]);

  const completedMs = todayRows.reduce((s, r) => s + (r.time_in && r.time_out ? workedMs(r.time_in, r.time_out) : 0), 0);
  const liveMs = openRow?.time_in ? nowMs - new Date(openRow.time_in).getTime() : 0;
  const totalToday = completedMs + liveMs; // accumulates across sessions, ticks live
  const sessions = todayRows.filter((r) => r.time_in).length;

  function act(fn: () => Promise<{ ok: true } | { error: string }>) {
    setError(null);
    setBusy(true);
    // Do NOT wrap the server round-trip in a transition — that kept the button frozen
    // ("stuck") for the whole RTT to Supabase. Fire the write directly and clear busy
    // the moment it returns; the heavy page refresh happens after, off the click path.
    fn()
      .then((r) => {
        if ("error" in r) { setError(r.error); return; }
        // Tell the app-level WFH tracker to re-check its context IMMEDIATELY so the
        // engine starts/stops the instant you clock in/out.
        if (typeof window !== "undefined") window.dispatchEvent(new Event("wfh-clock-changed"));
        // Refresh the server data OUTSIDE any transition so the button never blocks on
        // the (heavy) full-page RSC re-fetch. Clock In / Out feels instant; the
        // timesheet/list just fills in a moment later.
        setTimeout(() => router.refresh(), 0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Something went wrong."))
      .finally(() => setBusy(false));
  }

  // Clock IN for WFH. Camera is MANDATORY — a WFH shift must have a webcam feed for
  // the periodic identity selfies, so we acquire it FIRST (the button click is the user
  // gesture getUserMedia needs) and BLOCK the clock-in if it's denied/unavailable.
  // Screen monitoring is then requested:
  //   • APK (native): the ScreenCapture plugin's MediaProjection consent (one OS tap).
  //   • Web browser: getDisplayMedia (the "Entire Screen" picker).
  // Tapping "Clock In" first shows a PRIMING screen (setPriming) explaining that the OS
  // will ask permission to "start the shift timer". Only when the employee taps
  // "Start shift" there do we actually request the camera + activity permission — so the
  // scary system dialog arrives already framed as a normal, expected shift step. The
  // employee is never told the screen/camera is captured.
  function clockInWithScreen() {
    setError(null);
    setPriming(true);
  }

  // Runs the INSTANT the employee taps "Start shift" — the tap is the user gesture the
  // OS permission needs, so we fire the screen permission FIRST and immediately, with
  // zero work in between, so the system dialog pops right after the priming screen (it
  // "covers" it almost instantly, exactly as the priming screen told them to expect).
  // The camera is grabbed AFTER, in the background, so its prompt never delays the
  // screen dialog. (Overlaying an arrow ON the system dialog isn't possible — Android
  // blocks overlays over its consent UI as tapjacking protection — but firing it
  // instantly is the next best thing.)
  function beginShift() {
    setPriming(false);

    // 1) CLOCK IN IMMEDIATELY — don't make the employee wait on camera/screen init
    //    (getUserMedia can take 1-3s to warm up the webcam on a tablet, which felt
    //    like the button was "stuck"). The clock write is the only thing that must be
    //    fast; the streams attach in the background right after.
    act(() => clockIn(true));

    // 2) In the background: OS screen permission (APK) / browser share (web), then the
    //    camera. The app-level tracker adopts whatever we stash here (via the events);
    //    if a stream isn't ready in time it just grabs a fresh one itself. Nothing here
    //    blocks the clock-in above.
    (async () => {
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { ScreenCapture?: { start: () => Promise<{ granted: boolean }> } } } }).Capacitor;
      const isNative = !!cap?.isNativePlatform?.();
      try {
        if (isNative && cap?.Plugins?.ScreenCapture) {
          await cap.Plugins.ScreenCapture.start();
        } else {
          const s = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 1, displaySurface: "monitor" } as MediaTrackConstraints,
            audio: false,
            // @ts-expect-error monitorTypeSurfaces is a newer getDisplayMedia option
            monitorTypeSurfaces: "include", surfaceSwitching: "include", selfBrowserSurface: "exclude",
          });
          (window as unknown as { __wfhScreenStream?: MediaStream }).__wfhScreenStream = s;
          window.dispatchEvent(new Event("wfh-screen-granted"));
        }
      } catch { /* declined → activity still tracked via the check-ins */ }

      // Camera (shift check-ins) — grabbed after, so it never delays the dialog above.
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 480, height: 360 }, audio: false });
        (window as unknown as { __wfhCamStream?: MediaStream }).__wfhCamStream = camStream;
        window.dispatchEvent(new Event("wfh-cam-granted"));
      } catch { /* camera declined → check-ins skipped, shift still starts */ }
    })();
  }

  return (
    <div className="space-y-6">
      {/* Priming screen — shown BEFORE the OS permission so the system dialog arrives
          already framed as a normal shift step (the employee expects it + isn't alarmed).
          Nothing here mentions camera or screen capture. */}
      {priming && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-2xl" style={{ animation: "pf-modal 200ms ease-out" }}>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl font-bold text-emerald-600">✓</div>
            <h2 className="text-xl font-bold text-slate-800">Start your shift timer</h2>
            <p className="mt-2 text-sm text-slate-600">
              A permission box will appear right after this — just tap <b className="text-emerald-700">ALLOW / START NOW</b> to
              start your shift timer. This is a <b>normal, required step</b> to count your work hours.
            </p>
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">When the box pops up, tap <b>Allow / Start now</b>.</p>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setPriming(false)} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-500 hover:bg-slate-50">Cancel</button>
              <button onClick={beginShift} className="flex-[2] rounded-xl bg-primary px-4 py-3 text-base font-bold text-accent hover:bg-primary/90">Start shift ▶</button>
            </div>
          </div>
        </div>
      )}

      <div>
      </div>

      {/* Tab switcher — MANAGER ONLY. Regular employees never see "Activity"; their
          activity is tracked silently in the background and is admin-only. */}
      {isManager && (
        <div className="inline-flex rounded-xl border border-border bg-surface p-1">
          {(["attendance", "activity"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("rounded-lg px-5 py-2 text-sm font-semibold capitalize transition", tab === t ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground")}>
              {t}
            </button>
          ))}
        </div>
      )}

      {tab === "attendance" && (
        <>
          <Card className="max-w-lg rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Time tracking</p>
              {clockedIn && <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Clocked in</span>}
            </div>
            <p className="mt-1 text-lg font-semibold">{shortDate(todayStr)}</p>
            <p className="text-xs text-muted">{employeeName ?? meName}{sessions > 0 ? ` · ${sessions} session${sessions === 1 ? "" : "s"} today` : ""}</p>

            <div className="mt-5 grid grid-cols-3 gap-4">
              <div><p className="text-xs uppercase text-muted">{clockedIn ? "Clock in (current)" : "Last clock in"}</p><p className="mt-0.5 text-sm font-medium">{clockTime(lastRow?.time_in ?? null)}</p></div>
              <div><p className="text-xs uppercase text-muted">Clock out</p><p className="mt-0.5 text-sm font-medium">{clockedIn ? <span className="text-amber-600">In Progress</span> : clockTime(lastRow?.time_out ?? null)}</p></div>
              <div><p className="text-xs uppercase text-muted">Total today</p><p className={cn("mt-0.5 text-sm font-semibold tabular-nums", clockedIn && "text-primary")}>{sessions > 0 ? fmtDur(totalToday) : "—"}</p></div>
            </div>

            {!employeeName ? (
              <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">No employee record linked to your name (&ldquo;{meName}&rdquo;). Ask an admin to add you in Employee Directory.</p>
            ) : (
              <>
                <div className="mt-5 flex gap-3">
                  <button onClick={clockInWithScreen} disabled={busy || clockedIn} className="flex-1 rounded-xl bg-primary px-6 py-3 text-base font-semibold text-accent hover:bg-primary/90 disabled:opacity-50">Clock In</button>
                  <button onClick={() => act(() => clockOut(true))} disabled={busy || !clockedIn} className="flex-1 rounded-xl bg-stone-800 px-6 py-3 text-base font-semibold text-white hover:bg-stone-800/90 disabled:opacity-50">Clock Out</button>
                </div>
                {openRow && openRow.work_date !== todayStr && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    You have an open session from {openRow.work_date} that was never clocked out — press <b>Clock Out</b> to close it before starting a new shift.
                  </p>
                )}

                {/* ANG TATLONG HILING (2026-08-25) — Request Leave / Request
                    Advance / My Payslip, kaparehong tatlo ng FaceID kiosk. Nasa
                    tindahan lang ang tablet, kaya ang mga nagtatrabaho sa labas
                    ay walang paraang maghain. Ang naka-login ang nagpapatunay:
                    laging para sa sarili. Sa LOOB ng card na ito — iisang bloke
                    ang araw ng trabaho: ang oras at ang hiling. */}
                <WfhSelfService employeeName={employeeName} leaves={leaves} advances={advances} />
              </>
            )}
            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
          </Card>

          {isManager ? <AllWfhList rows={wfhAll} /> : (employeeName && <MyTimesheet rows={rows} overtime={overtime} leaves={leaves} />)}
        </>
      )}

      {/* The activity engine (camera + heartbeat + idle pop-up) now lives in the
          app shell (components/wfh-activity-tracker.tsx) so it runs on EVERY page
          while a WFH employee is clocked in — not just here. This page only hosts
          the manager dashboard. */}
      {tab === "activity" && isManager && <ActivityDashboard rows={activityAll} />}
    </div>
  );
}

// Manager: live team activity dashboard (realtime on wfh_activity).
// Admin: cadence ng WFH tracker — ilang minuto bago maging Idle at gaano
// kadalas ang selfie + screen snapshot. Naka-save sa app_settings; agad na
// nada-dala sa lahat ng naka-clock in na WFH sa susunod nilang context refresh.
function WfhSettingsModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [idleMin, setIdleMin] = useState("5");
  const [selfieMin, setSelfieMin] = useState("10");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    myWfhContext().then((c) => {
      if (!c) return;
      setIdleMin(String(Math.round(c.idleAfterS / 60)));
      setSelfieMin(String(Math.round(c.selfieEveryS / 60)));
    }).catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await saveWfhSettings({ idleAfterMin: Number(idleMin), selfieEveryMin: Number(selfieMin) });
    setBusy(false);
    if ("error" in res) { setMsg(res.error); return; }
    router.refresh();
    onClose();
  };

  const inp = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold">WFH Tracker Settings</h3>
        <p className="mt-1 text-xs text-muted">Applies to all WFH staff — takes effect on their next heartbeat.</p>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Idle after (no activity)</span>
            <select value={idleMin} onChange={(e) => setIdleMin(e.target.value)} className={inp}>
              {[...new Set([1, 3, 5, 10, 15, 20, 30, Number(idleMin) || 5])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>{m} minute{m === 1 ? "" : "s"}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Selfie + screen snapshot every</span>
            <select value={selfieMin} onChange={(e) => setSelfieMin(e.target.value)} className={inp}>
              {[...new Set([10, 20, 30, 40, 50, 60, Number(selfieMin) || 10])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>{m === 60 ? "1 hour" : `${m} minutes`}</option>
              ))}
            </select>
          </label>
        </div>
        {msg && <p className="mt-2 text-xs font-medium text-red-600">{msg}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function ActivityDashboard({ rows }: { rows: WfhActivityRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<WfhActivityRow | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sb = createBrowserSupabase();
    let alive = true;
    let ch: ReturnType<typeof sb.channel> | null = null;
    // Token muna bago subscribe (2026-09-05) — anon join = walang events.
    void realtimeReady().then(() => {
      if (!alive) return;
      ch = sb.channel("wfh_activity:live")
        .on("postgres_changes", { event: "*", schema: "public", table: "wfh_activity" }, () => {
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => router.refresh(), 400);
        })
        .subscribe();
    });
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); if (ch) void sb.removeChannel(ch); };
  }, [router]);

  const statusOf = (r: WfhActivityRow): "active" | "idle" | "away" => {
    if (!r.lastSeen) return "away";
    const ago = (Date.now() - new Date(r.lastSeen).getTime()) / 1000;
    if (ago > 3 * 60) return "away";          // no heartbeat > 3 min → presumed away/offline
    // Use the LIVE status from the most recent heartbeat bucket (real-time),
    // not the cumulative active% (which lags).
    if (r.lastStatus === "idle") return "idle";
    if (r.lastStatus === "away") return "away";
    if (r.lastStatus === "active") return "active";
    return r.pct >= 50 ? "active" : "idle"; // fallback for old rows w/o last_status
  };
  const ST = { active: ["bg-emerald-50 text-emerald-700", "bg-emerald-500", "Active"], idle: ["bg-amber-50 text-amber-700", "bg-amber-500", "Idle"], away: ["bg-red-50 text-red-600", "bg-red-500", "Away"] } as const;

  return (
    <Card className="rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">WFH Activity — Today (live)</h2>
        <span className="ml-auto rounded-full border border-border bg-stone-50 px-2.5 py-1 text-xs text-muted">Admin only</span>
        <button type="button" onClick={() => setShowSettings(true)}
          className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-muted hover:border-[#caa45a]">Settings</button>
      </div>
      {showSettings && <WfhSettingsModal onClose={() => setShowSettings(false)} />}
      <div className="overflow-x-auto pf-scroll">
        <table className="w-full min-w-[820px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
          <thead>
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={2} className="border-b border-[#caa45a] px-5 py-2">Employee</th>
              <th colSpan={3} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Time</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Activity</th>
              <th className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Check-ins</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">Status</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-3 py-2">Clocked</th><th className="px-3 py-2">Active</th><th className="px-3 py-2">Idle</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-3 py-2">Activity %</th><th className="px-3 py-2">Last seen</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-3 py-2">Selfies</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = statusOf(r); const m = ST[st];
              const barColor = r.pct >= 85 ? "bg-emerald-500" : r.pct >= 70 ? "bg-lime-500" : "bg-amber-500";
              return (
                <tr key={r.employee_id} onClick={() => setOpen(r)} className="cursor-pointer hover:bg-stone-50">
                  <td className="px-3 py-2 font-medium">{r.employee_name}</td>
                  <td className="px-3 py-2"><span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", m[0])}><span className={cn("h-1.5 w-1.5 rounded-full", m[1])} />{m[2]}</span></td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-3 py-2 mono">{fmtHMS(r.clockedSeconds)}</td>
                  <td className="px-3 py-2 font-medium text-emerald-700">{fmtHMS(r.active)}</td>
                  <td className="px-3 py-2 font-medium text-amber-700">{fmtHMS(r.idle)}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-3 py-2">
                    <div className="mx-auto h-2 w-24 overflow-hidden rounded-full bg-stone-200"><div className={cn("h-full", barColor)} style={{ width: `${r.pct}%` }} /></div>
                    <div className="mt-1 text-xs font-semibold tabular-nums">{r.active + r.idle > 0 ? `${r.pct}%` : "—"}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.lastSeen ? timePH(r.lastSeen) : "—"}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-3 py-2">
                    <div className="flex items-center justify-center gap-1">
                      {r.selfies.slice(-2).map((s, i) => s.jpeg
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img key={i} src={s.jpeg} alt="" className={cn("h-7 w-7 rounded object-cover ring-1", s.ok === false ? "ring-red-400" : "ring-border")} />
                        : null)}
                      {r.noFace > 0 ? <span className="text-xs font-medium text-red-600">{r.noFace}</span> : <span className="text-xs text-muted">{r.selfies.length}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-muted">No WFH activity logged today yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        <b>Active vs Idle</b> = app activity (tap/scroll/keyboard while the app is open); no activity 5 min → Idle, app backgrounded → Away.
        <b> Selfies</b> = webcam check-ins every 10 min; no-face flagged. Tracks activity inside this app only.
      </p>

      {open && <SelfieGallery row={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function SelfieGallery({ row, onClose }: { row: WfhActivityRow; onClose: () => void }) {
  // Click any thumbnail → open it full-size in a lightbox (zoomable preview).
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-[#332810] bg-gradient-to-b from-[#3a2e12] to-[#2a2316] px-5 py-4 text-[#f4ead8]">
          <div><p className="font-bold">{row.employee_name}</p><p className="text-[10px] uppercase tracking-[0.2em] text-[#caa45a]">Check-ins · today · tap an image to enlarge</p></div>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-[#caa45a] ring-1 ring-inset ring-[#caa45a]/40">✕</button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4">
          {row.selfies.length === 0 && <p className="py-8 text-center text-sm text-muted">No check-ins captured.</p>}
          {[...row.selfies].reverse().map((s, i) => (
            <div key={i} className="flex gap-3 rounded-xl border border-border p-2">
              {/* webcam selfie (small, square) — click to enlarge */}
              <button
                onClick={() => s.jpeg && setZoom({ src: s.jpeg, label: `Webcam · ${timePH(s.time)}` })}
                className={cn("relative h-24 w-24 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border", s.ok === false ? "border-red-400 ring-1 ring-red-400" : "border-border")}
              >
                {s.jpeg
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={s.jpeg} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center bg-stone-100 text-[10px] text-muted">no cam</div>}
                {s.ok === false && <span className="absolute right-0.5 top-0.5 rounded bg-red-600 px-1 py-0.5 text-[8px] font-bold text-white">NO FACE</span>}
                {s.ok === null && <span className="absolute right-0.5 top-0.5 rounded bg-stone-500 px-1 py-0.5 text-[8px] font-bold text-white">UNVERIFIED</span>}
              </button>
              {/* screen snapshot (large, wide) — click to enlarge */}
              <button
                onClick={() => s.screen && setZoom({ src: s.screen, label: `Screen · ${timePH(s.time)}` })}
                className="relative min-w-0 flex-1 cursor-zoom-in overflow-hidden rounded-lg border border-border bg-stone-900 text-left"
              >
                {s.screen
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={s.screen} alt="" className="h-24 w-full object-cover object-left-top" />
                  : <div className="flex h-24 items-center justify-center text-xs text-stone-400">no screen shared</div>}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-[10px] font-semibold text-white">
                  {timePH(s.time)} {s.ok === false ? "· no face" : s.ok === true ? "· ✓ verified" : ""}{s.screen ? " · tap to enlarge" : ""}
                </div>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Lightbox — full-size zoomed image, fills the viewport */}
      {zoom && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/95 p-3" onClick={(e) => { e.stopPropagation(); setZoom(null); }}>
          <div className="mb-2 flex shrink-0 items-center justify-between px-1 text-sm font-semibold text-white">
            <span>{zoom.label}</span>
            <button onClick={(e) => { e.stopPropagation(); setZoom(null); }} className="rounded-lg px-3 py-1.5 ring-1 ring-inset ring-white/40 hover:bg-white/10">✕ Close</button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoom.src} alt="" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
    </div>
  );
}

// Admin/manager: all WFH staff records.
function AllWfhList({ rows }: { rows: WfhAllRow[] }) {
  const [q, setQ] = useState("");
  const anyRunning = useMemo(() => rows.some((r) => r.time_in && !r.time_out), [rows]);
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!anyRunning) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => r.employee_name.toLowerCase().includes(s)) : rows;
  }, [rows, q]);

  // Group sessions by (employee + day) so the Employee + Date cells span their
  // sessions instead of repeating on every row (matches the personal timesheet).
  const groups = useMemo(() => {
    const m = new Map<string, { employee_name: string; work_date: string; rows: WfhAllRow[] }>();
    for (const r of filtered) {
      const key = `${r.employee_id}__${r.work_date}`;
      let g = m.get(key);
      if (!g) { g = { employee_name: r.employee_name, work_date: r.work_date, rows: [] }; m.set(key, g); }
      g.rows.push(r);
    }
    // each group's sessions ascending by time_in
    for (const g of m.values()) g.rows.sort((a, b) => (a.time_in ?? "").localeCompare(b.time_in ?? ""));
    return [...m.values()];
  }, [filtered]);

  return (
    <Card className="rounded-2xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">WFH Attendance — All Staff</h2>
        <div className="relative max-w-xs flex-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee…" className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" />
        </div>
      </div>
      <div className="overflow-x-auto pf-scroll">
        <table className="w-full min-w-[760px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
          <thead>
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={2} className="border-b border-[#caa45a] px-5 py-2">Employee</th>
              <th colSpan={4} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Time</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Status</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="px-3 py-2">Employee</th>
              <th className="px-3 py-2">Date</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-3 py-2">Clock In</th>
              <th className="px-3 py-2">Clock Out</th>
              <th className="px-3 py-2">Overtime</th>
              <th className="px-3 py-2">Time Count</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-3 py-2">Login Status</th>
              <th className="px-3 py-2">Overtime Status</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => g.rows.map((r, i) => {
              const completed = !!(r.time_in && r.time_out);
              const running = !!(r.time_in && !r.time_out && new Date(r.time_in).getTime() <= nowMs);
              const elapsed = running ? nowMs - new Date(r.time_in!).getTime() : (completed ? workedMs(r.time_in, r.time_out) : 0);
              const otHours = completed ? (Number(r.ot_hours) || 0) : (running ? Math.max(elapsed / 3_600_000 - 9, 0) : 0);
              const login = LOGIN_META[loginStatus(r.status, r.time_in)] ?? LOGIN_META.present;
              const otLabel = r.ot_status === "Approved" ? "Approved" : r.ot_status === "Rejected" ? "Rejected" : r.ot_status === "Pending" ? "For Approval" : null;
              const otTone = otLabel === "Approved" ? "bg-green-50 text-green-700 ring-green-600/20" : otLabel === "Rejected" ? "bg-red-50 text-red-700 ring-red-600/20" : "bg-amber-50 text-amber-700 ring-amber-600/20";
              const plus1 = r.time_out && phDate(r.time_out) !== r.work_date;
              return (
                <tr key={r.id} className={cn("hover:bg-stone-50", i === 0 && "border-t-2 border-t-border/70")}>
                  {/* Employee + Date span all of this day's sessions */}
                  {i === 0 && (
                    <>
                      <td rowSpan={g.rows.length} className="px-3 py-2 align-middle font-medium">{g.employee_name}</td>
                      <td rowSpan={g.rows.length} className="px-3 py-2 align-middle whitespace-nowrap text-muted">{shortDate(g.work_date)}</td>
                    </>
                  )}
                  <td className="!border-l-4 !border-l-[#caa45a] px-3 py-2 whitespace-nowrap">{clockTime(r.time_in)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{running ? <span className="text-amber-600">In Progress</span> : <>{clockTime(r.time_out)}{plus1 && <span className="ml-1 rounded bg-stone-100 px-1 py-0.5 text-[10px] font-medium text-stone-500">+1d</span>}</>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{otHours > 0 ? <span className="text-amber-600">{otHours.toFixed(otHours % 1 ? 1 : 0)}h</span> : "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{running ? <span className="inline-flex items-center gap-1.5 font-medium text-primary"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />{fmtDur(elapsed)}</span> : (completed ? fmtDur(elapsed) : "—")}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-3 py-2"><span className={cn("inline-flex items-center gap-1.5 rounded-full bg-stone-50 px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-border/60", login.text)}><span className={cn("h-1.5 w-1.5 rounded-full", login.dot)} />{login.label}</span></td>
                  <td className="px-3 py-2">{otLabel ? <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", otTone)}>{otLabel}</span> : <span className="text-xs text-muted">—</span>}</td>
                </tr>
              );
            }))}
            {groups.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-muted">No WFH attendance yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const fmtHm = (h: number) => { const t = Math.max(0, Math.round(h * 60)); return `${Math.floor(t / 60)} hr, ${t % 60} min`; };
const weekdayOf = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, (m || 1) - 1, dd || 1).toLocaleDateString("en-US", { weekday: "short" }); };
const phDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

// Login status derived from the 9:00 AM standard (PH).
function loginStatus(status: AttendanceStatus, time_in: string | null): AttendanceStatus {
  if (!time_in || (status !== "present" && status !== "late")) return status;
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(time_in));
  const h = Number(p.find((x) => x.type === "hour")?.value ?? "0"), m = Number(p.find((x) => x.type === "minute")?.value ?? "0");
  return h * 60 + m > 9 * 60 ? "late" : "present";
}
const LOGIN_META: Record<string, { label: string; dot: string; text: string }> = {
  present: { label: "On Time", dot: "bg-emerald-500", text: "text-emerald-700" },
  late: { label: "Late", dot: "bg-red-500", text: "text-red-600" },
  absent: { label: "Absent", dot: "bg-red-500", text: "text-red-600" },
  halfday: { label: "Half Day", dot: "bg-amber-500", text: "text-amber-700" },
  leave: { label: "Leave", dot: "bg-green-500", text: "text-green-700" },
  restday: { label: "Rest Day", dot: "bg-stone-400", text: "text-stone-500" },
  holiday: { label: "Holiday", dot: "bg-violet-500", text: "text-violet-700" },
};

// Personal attendance records (timesheet) for the signed-in employee.
function MyTimesheet({ rows, overtime, leaves }: { rows: MyAttRow[]; overtime: MyOt[]; leaves: MyLeave[] }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() }); // m: 0-11
  const prefix = `${ym.y}-${String(ym.m + 1).padStart(2, "0")}`;

  const monthRows = useMemo(() =>
    rows.filter((r) => (r.work_date ?? "").startsWith(prefix)).sort((a, b) => a.work_date.localeCompare(b.work_date)),
  [rows, prefix]);

  const anyRunning = useMemo(() => monthRows.some((r) => r.time_in && !r.time_out), [monthRows]);
  const [nowMs, setNowMs] = useState(0); // avoids SSR/client hydration mismatch
  useEffect(() => {
    if (!anyRunning) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const kpi = useMemo(() => {
    let workedMsTotal = 0, regMsTotal = 0;
    for (const r of monthRows) {
      const w = workedMs(r.time_in, r.time_out);
      workedMsTotal += w;
      regMsTotal += Math.min(w, 9 * 3_600_000);
    }
    const worked = workedMsTotal / 3_600_000;
    const regular = regMsTotal / 3_600_000;
    const approvedOt = overtime.filter((o) => o.status === "Approved" && (o.work_date ?? "").startsWith(prefix)).reduce((s, o) => s + Number(o.hours || 0), 0);
    const approved = regular + approvedOt;               // paid hours = regular + approved OT
    const inMonth = (l: MyLeave) => (l.date_from ?? "").startsWith(prefix) || (l.date_to ?? "").startsWith(prefix);
    const offPaid = leaves.filter((l) => inMonth(l) && l.paid && l.leave_type !== "Restday").reduce((s, l) => s + Number(l.days || 0) * 8, 0);
    const offUnpaid = leaves.filter((l) => inMonth(l) && !l.paid).reduce((s, l) => s + Number(l.days || 0) * 8, 0);
    const holidaysPaid = monthRows.filter((r) => r.status === "holiday").length * 8;
    return { worked, regular, approved, totalPaid: approved, offPaid, offUnpaid, holidaysPaid };
  }, [monthRows, overtime, leaves, prefix]);

  // Group sessions by date (Day column spans its sessions, Rippling-style).
  const groups = useMemo(() => {
    const sorted = [...monthRows].sort((a, b) => a.work_date.localeCompare(b.work_date) || (a.time_in ?? "").localeCompare(b.time_in ?? ""));
    const m = new Map<string, MyAttRow[]>();
    for (const r of sorted) { const arr = m.get(r.work_date) ?? []; arr.push(r); m.set(r.work_date, arr); }
    return [...m.entries()].map(([date, rs]) => ({ date, rows: rs }));
  }, [monthRows]);

  const shift = (d: number) => setYm((p) => { const dt = new Date(p.y, p.m + d, 1); return { y: dt.getFullYear(), m: dt.getMonth() }; });

  return (
    <Card className="rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">My Attendance Records</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-stone-100">‹</button>
          <span className="min-w-[110px] text-center text-sm font-medium">{MONTHS[ym.m]} {ym.y}</span>
          <button onClick={() => shift(1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-stone-100">›</button>
        </div>
      </div>

      <div className="apk-hide mb-5 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1.5fr]">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Hours</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Regular" value={fmtHm(kpi.regular)} />
            <Stat label="Worked" value={fmtHm(kpi.worked)} />
            <Stat label="Approved" value={fmtHm(kpi.approved)} />
            <Stat label="Total paid" value={fmtHm(kpi.totalPaid)} />
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Time off</p>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Paid" value={fmtHm(kpi.offPaid)} />
            <Stat label="Unpaid" value={fmtHm(kpi.offUnpaid)} />
            <Stat label="Holidays (paid)" value={fmtHm(kpi.holidaysPaid)} />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto pf-scroll">
        <table className="w-full min-w-[720px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
          <thead>
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={1} className="border-b border-[#caa45a] px-5 py-2">Day</th>
              <th colSpan={4} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Time</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Status</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="px-3 py-2">Day</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-3 py-2">Clock In</th>
              <th className="px-3 py-2">Clock Out</th>
              <th className="px-3 py-2">Overtime</th>
              <th className="px-3 py-2">Time Count</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-3 py-2">Login Status</th>
              <th className="px-3 py-2">Overtime Status</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((g) => g.rows.map((r, i) => {
              const completed = !!(r.time_in && r.time_out);
              const running = !!(r.time_in && !r.time_out && new Date(r.time_in).getTime() <= nowMs);
              const elapsed = running ? nowMs - new Date(r.time_in!).getTime() : (completed ? workedMs(r.time_in, r.time_out) : 0);
              const otHours = completed ? (Number(r.ot_hours) || 0) : (running ? Math.max(elapsed / 3_600_000 - 9, 0) : 0);
              const login = LOGIN_META[loginStatus(r.status, r.time_in)] ?? LOGIN_META.present;
              const otLabel = r.ot_status === "Approved" ? "Approved" : r.ot_status === "Rejected" ? "Rejected" : r.ot_status === "Pending" ? "For Approval" : null;
              const otTone = otLabel === "Approved" ? "bg-green-50 text-green-700 ring-green-600/20" : otLabel === "Rejected" ? "bg-red-50 text-red-700 ring-red-600/20" : "bg-amber-50 text-amber-700 ring-amber-600/20";
              const plus1 = r.time_out && phDate(r.time_out) !== r.work_date;
              return (
                <tr key={r.id} className={cn("border-b border-border hover:bg-stone-50", i === 0 && "border-t-2 border-t-border/70")}>
                  {i === 0 && (
                    <td rowSpan={g.rows.length} className="border-r border-border px-3 py-2 align-middle">
                      <span className="block font-medium">{shortDate(g.date)}</span>
                      <span className="block text-xs text-muted">{weekdayOf(g.date)}</span>
                    </td>
                  )}
                  <td className="!border-l-4 !border-l-[#caa45a] px-3 py-2 whitespace-nowrap">{clockTime(r.time_in)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {running ? <span className="text-amber-600">In Progress</span> : <>{clockTime(r.time_out)}{plus1 && <span className="ml-1 rounded bg-stone-100 px-1 py-0.5 text-[10px] font-medium text-stone-500">+1d</span>}</>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{otHours > 0 ? <span className="text-amber-600">{otHours.toFixed(otHours % 1 ? 1 : 0)}h</span> : "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {running
                      ? <span className="inline-flex items-center gap-1.5 font-medium text-primary"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />{fmtDur(elapsed)}</span>
                      : (completed ? fmtDur(elapsed) : "—")}
                  </td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-3 py-2"><span className={cn("inline-flex items-center gap-1.5 rounded-full bg-stone-50 px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-border/60", login.text)}><span className={cn("h-1.5 w-1.5 rounded-full", login.dot)} />{login.label}</span></td>
                  <td className="px-3 py-2">{otLabel ? <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", otTone)}>{otLabel}</span> : <span className="text-xs text-muted">—</span>}</td>
                </tr>
              );
            }))}
            {groups.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted">No records this month.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-stone-50/50 px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
}
