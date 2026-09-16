// Shift schedules + late detection — shared by the self-clock (app/hr/attendance)
// and the Face kiosk (app/attendance/kiosk) so both compute 'late' identically.
//
//   Onsite (Face kiosk / office self-clock): 9:00 AM – 6:00 PM
//   WFH:                                       6:00 PM – 1:00 AM (crosses midnight)
//
// The source tag on each attendance row picks the shift: 'wfh' → WFH, anything
// else ('face', 'self', 'manual') → onsite. Tweak the times/grace here only.

import type { AttendanceStatus } from "./types";

export const GRACE_MIN = 0; // minutes of leeway before a clock-in counts as late

// start/end are minutes-from-midnight (PH). end < start means the window wraps
// past midnight (e.g. WFH 18:00 → 01:00).
export const SHIFTS = {
  onsite: { start: 9 * 60, end: 18 * 60 },   // 09:00 → 18:00
  wfh: { start: 18 * 60, end: 1 * 60 },      // 18:00 → 01:00 (next day)
} as const;
export type ShiftKey = keyof typeof SHIFTS;

export function shiftForSource(source: string | null | undefined): ShiftKey {
  return source === "wfh" ? "wfh" : "onsite";
}

// Minute-of-day (PH local) for an ISO timestamp.
function minuteOfDayPH(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

// Minutes from `start` to `mod`, going forward around the 24h clock (0..1439).
function minutesAfter(start: number, mod: number): number {
  return (mod - start + 24 * 60) % (24 * 60);
}

// 'late' if the clock-in lands AFTER the shift start (+grace) but still inside the
// shift window; otherwise 'present'. Clocking in early or exactly on time →
// present. WFH (6PM start) isn't flagged late just for being an evening clock-in.
export function statusForTimeIn(iso: string, source?: string | null): AttendanceStatus {
  const s = SHIFTS[shiftForSource(source)];
  const mod = minuteOfDayPH(iso);
  const shiftLen = minutesAfter(s.start, s.end) || 24 * 60;
  const afterStart = minutesAfter(s.start, mod);
  if (afterStart > GRACE_MIN && afterStart < shiftLen) return "late";
  return "present";
}
