import { useEffect, useState } from "react";

/** Returns the current system date used by forecast runtime formulas. */
export function getForecastNow(): Date {
  return new Date();
}

export interface ForecastDateVars {
  now: Date;
  /** ISO yyyy-mm-dd from system time. */
  current_date: string;
  elapsed_days: number;
  days_in_month: number;
  /** Remaining full days after today; always computed live, never stored. */
  remaining_days: number;
}

/** Compute current_date / days_in_month / elapsed_days / remaining_days from system time. */
export function getForecastDateVars(): ForecastDateVars {
  const now = getForecastNow();
  const elapsed_days = now.getDate();
  const days_in_month = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  // Strict live formula: May 1 → 30, May 2 → 29, May 3 → 28.
  const remaining_days = days_in_month - elapsed_days;
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(elapsed_days).padStart(2, "0");
  const current_date = `${yyyy}-${mm}-${dd}`;
  return { now, current_date, elapsed_days, days_in_month, remaining_days };
}

/**
 * Reactive hook: returns live ForecastDateVars and re-renders the consumer
 * automatically when the date rolls over (checked every 60 seconds, plus on
 * window focus / visibility change). No manual refresh needed.
 */
export function useForecastDateVars(): ForecastDateVars {
  const [vars, setVars] = useState<ForecastDateVars>(() => getForecastDateVars());

  useEffect(() => {
    const tick = () => {
      const next = getForecastDateVars();
      setVars((prev) =>
        prev.current_date === next.current_date &&
        prev.elapsed_days === next.elapsed_days &&
        prev.days_in_month === next.days_in_month &&
        prev.remaining_days === next.remaining_days
          ? prev
          : next,
      );
    };
    const id = window.setInterval(tick, 60_000);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return vars;
}
