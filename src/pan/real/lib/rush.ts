// Rush order tag — a manual flag on an order. When set, the UI shows a countdown
// from date_order to a threshold (default 14 days): days remaining, then overdue.

export const DEFAULT_RUSH_DAYS = 14;

// Read the editable threshold from an app_settings jsonb value (stored as a bare
// number, e.g. 14). Falls back to the default for null / bad values.
export function rushThresholdFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_RUSH_DAYS;
}

export type RushInfo = {
  remaining: number; // days left until the deadline (negative once overdue)
  overdue: boolean;
  label: string;     // "9 days left" | "1 day left" | "Due today" | "2 days overdue"
  tone: "ok" | "soon" | "over"; // green / amber / red
};

// Whole days between date_order and now. `now` is injected so callers control the
// clock (server page/action passes new Date()); pure otherwise.
export function rushInfo(dateOrder: string | Date | null, thresholdDays: number, now: Date): RushInfo | null {
  if (!dateOrder) return null;
  const start = new Date(dateOrder);
  if (Number.isNaN(start.getTime())) return null;
  const MS = 86_400_000;
  // Compare calendar days (strip time) so "9 days left" is stable through the day.
  const startDay = Math.floor(start.getTime() / MS);
  const nowDay = Math.floor(now.getTime() / MS);
  const elapsed = nowDay - startDay;
  const remaining = thresholdDays - elapsed;
  const overdue = remaining < 0;
  const label = remaining > 1 ? `${remaining} days left`
    : remaining === 1 ? "1 day left"
    : remaining === 0 ? "Due today"
    : `${-remaining} ${-remaining === 1 ? "day" : "days"} overdue`;
  const tone: RushInfo["tone"] = remaining <= 0 ? "over" : remaining <= 3 ? "soon" : "ok";
  return { remaining, overdue, label, tone };
}
