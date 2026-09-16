/**
 * Schedule helpers for email auto-send.
 *
 * Mirrors the inline versions inside src/pages/MonthlyForecast.tsx
 * (parseScheduleTime, getDayName, computeNextRunTime). Keep in sync.
 */

export interface EmailScheduleConfig {
  id?: string;
  enabled?: boolean;
  recurrence_type?: 'minutes' | 'hours' | 'daily' | 'weekly' | 'monthly' | 'custom' | string;
  minutes_interval?: number | string | null;
  hours_interval?: number | string | null;
  days_of_week?: string[] | null;
  time_of_day?: string | null;
  day_of_month?: number | string | null;
  last_day_of_month?: boolean | null;
  expire_type?: 'never' | 'onDate' | string | null;
  expire_date?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  run_count?: number | null;
}

export function parseScheduleTime(timeValue: string): { hours: number; minutes: number } {
  const [hours = '0', minutes = '0'] = String(timeValue).split(':');
  return {
    hours: Number(hours) || 0,
    minutes: Number(minutes) || 0,
  };
}

export function getDayName(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date);
}

export function computeNextRunTime(
  schedule: EmailScheduleConfig,
  fromDate: Date = new Date(),
): Date | null {
  const now = new Date(fromDate);
  const type = schedule.recurrence_type || 'daily';
  const minutesInterval = Number(schedule.minutes_interval || 30);
  const hoursInterval = Number(schedule.hours_interval || 1);
  const selectedDays = Array.isArray(schedule.days_of_week)
    ? schedule.days_of_week
    : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const { hours, minutes } = parseScheduleTime(String(schedule.time_of_day || '09:00'));

  const makeTargetDate = (date: Date) => {
    const target = new Date(date);
    target.setHours(hours, minutes, 0, 0);
    return target;
  };

  const addDays = (date: Date, days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };

  const getLastDayOfMonth = (year: number, month: number) =>
    new Date(year, month + 1, 0).getDate();

  if (schedule.expire_type === 'onDate' && schedule.expire_date) {
    const expireDate = new Date(String(schedule.expire_date));
    expireDate.setHours(23, 59, 59, 999);
    if (now > expireDate) {
      return null;
    }
  }

  if (type === 'minutes') {
    return new Date(now.getTime() + minutesInterval * 60000);
  }

  if (type === 'hours') {
    return new Date(now.getTime() + hoursInterval * 3600000);
  }

  if (type === 'daily') {
    const todayTarget = makeTargetDate(now);
    if (todayTarget > now) {
      return todayTarget;
    }
    return addDays(todayTarget, 1);
  }

  if (type === 'weekly' || type === 'custom') {
    let next = makeTargetDate(now);
    const todayName = getDayName(next);
    if (selectedDays.includes(todayName) && next > now) {
      return next;
    }

    next = addDays(next, 1);
    while (!selectedDays.includes(getDayName(next))) {
      next = addDays(next, 1);
    }
    return next;
  }

  if (type === 'monthly') {
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const useLastDay = Boolean(schedule.last_day_of_month);
    let targetDay = Number(schedule.day_of_month || 1);
    let next: Date;

    if (useLastDay) {
      const lastDay = getLastDayOfMonth(currentYear, currentMonth);
      next = new Date(currentYear, currentMonth, lastDay, hours, minutes, 0, 0);
      if (next <= now) {
        const nextMonth = currentMonth + 1;
        const nextLastDay = getLastDayOfMonth(currentYear, nextMonth);
        next = new Date(currentYear, nextMonth, nextLastDay, hours, minutes, 0, 0);
      }
    } else {
      const thisMonthLastDay = getLastDayOfMonth(currentYear, currentMonth);
      if (targetDay > thisMonthLastDay) {
        targetDay = thisMonthLastDay;
      }
      next = new Date(currentYear, currentMonth, targetDay, hours, minutes, 0, 0);
      if (next <= now) {
        const nextMonth = currentMonth + 1;
        const nextMonthLastDay = getLastDayOfMonth(currentYear, nextMonth);
        const dayForNextMonth = Math.min(targetDay, nextMonthLastDay);
        next = new Date(currentYear, nextMonth, dayForNextMonth, hours, minutes, 0, 0);
      }
    }

    return next;
  }

  return addDays(now, 1);
}
