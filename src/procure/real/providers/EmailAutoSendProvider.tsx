/**
 * EmailAutoSendProvider
 *
 * Mounted inside DashboardLayout so it runs while any user is logged in,
 * regardless of which page they are viewing.
 *
 * - Polls email_schedule_config every 30s.
 * - When now >= next_run_at, performs an atomic claim:
 *     UPDATE email_schedule_config
 *        SET next_run_at = <new>, last_run_at = now, ...
 *      WHERE id = X AND next_run_at = <old>
 *   Only one browser tab wins; others see 0 updated rows and skip.
 * - On claim, invokes sendEmailReport() and logs to email_schedule_log.
 * - Every tick also silently invalidates the forecast_report React Query
 *   caches with refetchType: 'active'. Only currently-mounted queries
 *   refetch in the background; React Query keeps previous data visible
 *   until the new payload arrives, so users see no flicker.
 *
 * Silent: no toasts, no UI. Console logs only.
 */

import { ReactNode, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { externalSupabase as supabase } from '@/integrations/supabase/externalClient';
import { sendEmailReport } from '@/lib/forecast/sendEmailReport';
import { computeNextRunTime, type EmailScheduleConfig } from '@/lib/forecast/schedule';

// Build-version marker. Bump when the Order Now computation or email pipeline
// changes so we can verify which JS bundle a given browser is running.
// Compare across machines — if the RDP browser logs an older version on load,
// it's serving a stale cached bundle.
const EMAIL_AUTOSEND_VERSION = '2026-05-15-v2';

/** React Query keys that drive the Reorder Decisions page.
 *  Kept in sync with src/pages/MonthlyForecast.tsx. */
const FORECAST_QUERY_KEYS: readonly (readonly unknown[])[] = [
  ['forecast_report'],
  ['forecast_report_manual'],
  ['forecast_report_status'],
  ['forecast_report_proj_override'],
  ['forecast_report_supply_override'],
  ['forecast_report_lead_time'],
];

const POLL_INTERVAL_MS = 30_000;

function log(...args: unknown[]) {
  console.log('[EmailAutoSend]', ...args);
}

function warn(...args: unknown[]) {
  console.warn('[EmailAutoSend]', ...args);
}

function err(...args: unknown[]) {
  console.error('[EmailAutoSend]', ...args);
}

async function fetchActiveSchedule(): Promise<EmailScheduleConfig | null> {
  const { data, error } = await (supabase as any)
    .from('email_schedule_config')
    .select('*')
    .eq('enabled', true)
    .eq('report_type', 'idp')
    .maybeSingle();

  if (error && (error as any).code !== 'PGRST116') {
    return null;
  }
  return (data as EmailScheduleConfig) || null;
}

async function claimAndAdvanceSchedule(
  schedule: EmailScheduleConfig,
  now: Date,
): Promise<{ claimed: boolean; newNextRun: Date | null }> {
  const newNextRun = computeNextRunTime(schedule, now);
  if (!schedule.id) {
    return { claimed: false, newNextRun };
  }

  // Atomic claim: only one client wins.
  let query = (supabase as any)
    .from('email_schedule_config')
    .update({
      last_run_at: now.toISOString(),
      next_run_at: newNextRun ? newNextRun.toISOString() : null,
      run_count: (schedule.run_count || 0) + 1,
      updated_at: now.toISOString(),
    })
    .eq('id', schedule.id);

  if (schedule.next_run_at) {
    query = query.eq('next_run_at', schedule.next_run_at);
  } else {
    query = query.is('next_run_at', null);
  }

  const { data, error } = await query.select();

  if (error) {
    return { claimed: false, newNextRun };
  }

  const claimed = Array.isArray(data) && data.length > 0;
  return { claimed, newNextRun };
}

async function logScheduleRun(
  scheduleId: string | undefined,
  now: Date,
  successCount: number,
  failCount: number,
  totalItems: number,
) {
  if (!scheduleId) return;
  try {
    await (supabase as any).from('email_schedule_log').insert({
      schedule_id: scheduleId,
      executed_at: now.toISOString(),
      status: successCount > 0 ? 'success' : 'failed',
      emails_sent: successCount,
      emails_failed: failCount,
      total_items: totalItems,
    });
  } catch (e) {
  }
}

async function silentRefetchForecastQueries(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  // refetchType: 'active' → only currently-mounted queries hit the network.
  // React Query keeps previous data on screen until the new payload lands,
  // so the user sees no spinner / flicker / layout shift.
  try {
    await Promise.all(
      FORECAST_QUERY_KEYS.map((key) =>
        queryClient.invalidateQueries({ queryKey: key as unknown[], refetchType: 'active' }),
      ),
    );
  } catch (e) {
  }
}

async function tick(
  running: { current: boolean },
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  if (running.current) {
    return;
  }
  running.current = true;
  try {
    // Kick off silent cache refresh in parallel with schedule work.
    void silentRefetchForecastQueries(queryClient);

    const schedule = await fetchActiveSchedule();
    if (!schedule || !schedule.enabled) return;
    if (!schedule.next_run_at) {
      return;
    }

    const now = new Date();
    const due = new Date(schedule.next_run_at);
    if (now < due) return;

    const { claimed } = await claimAndAdvanceSchedule(schedule, now);
    if (!claimed) {
      return;
    }

    const result = await sendEmailReport();

    await logScheduleRun(
      schedule.id,
      now,
      result.successCount,
      result.failCount,
      result.totalItemsSent,
    );
  } catch (e) {
  } finally {
    running.current = false;
  }
}

export function EmailAutoSendProvider({ children }: { children: ReactNode }) {
  const running = useRef(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await tick(running, queryClient);
    };

    // Initial check shortly after mount
    const initialTimeout = window.setTimeout(run, 5_000);
    const intervalId = window.setInterval(run, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimeout);
      window.clearInterval(intervalId);
    };
  }, [queryClient]);

  return <>{children}</>;
}
