/**
 * ShopifyEmailAutoSendProvider
 *
 * Background service for automated Storefront Stock email reports.
 * Separate from forecast email system.
 * 
 * - Polls shopify_email_schedule_config every 30s
 * - Atomic claim when schedule is due
 * - Sends email via sendShopifyEmailReport()
 * - Logs execution to shopify_email_schedule_log
 * - Silent operation (console logs only, no toasts)
 */

import { ReactNode, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { externalSupabase as supabase } from '@/integrations/supabase/externalClient';
import { sendShopifyEmailReport } from '@/lib/shopify/sendShopifyEmailReport';
import { computeNextRunTime, type ShopifyEmailScheduleConfig } from '@/lib/shopify/shopifySchedule';

const SHOPIFY_AUTOSEND_VERSION = '2026-06-07-v1';

const SHOPIFY_QUERY_KEYS: readonly (readonly unknown[])[] = [
  ['shopify-inventory'],
  ['shopify-email-factory-mapping'],
  ['shopify-email-schedule-config'],
];

const POLL_INTERVAL_MS = 30_000;

function log(...args: unknown[]) {
  console.log('[ShopifyEmailAutoSend]', ...args);
}

function warn(...args: unknown[]) {
  console.warn('[ShopifyEmailAutoSend]', ...args);
}

function err(...args: unknown[]) {
  console.error('[ShopifyEmailAutoSend]', ...args);
}

async function fetchActiveSchedule(): Promise<ShopifyEmailScheduleConfig | null> {
  const { data, error } = await (supabase as any)
    .from('email_schedule_config')
    .select('*')
    .eq('enabled', true)
    .eq('report_type', 'shopify')
    .maybeSingle();

  if (error && (error as any).code !== 'PGRST116') {
    return null;
  }
  return (data as ShopifyEmailScheduleConfig) || null;
}

async function claimAndAdvanceSchedule(
  schedule: ShopifyEmailScheduleConfig,
  now: Date,
): Promise<{ claimed: boolean; newNextRun: Date | null }> {
  const newNextRun = computeNextRunTime(schedule, now);
  if (!schedule.id) {
    return { claimed: false, newNextRun };
  }

  let query = (supabase as any)
    .from('email_schedule_config')
    .update({
      last_run_at: now.toISOString(),
      next_run_at: newNextRun ? newNextRun.toISOString() : null,
      run_count: (schedule.run_count || 0) + 1,
      updated_at: now.toISOString(),
    })
    .eq('id', schedule.id)
    .eq('report_type', 'shopify');

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
    await (supabase as any).from('shopify_email_schedule_log').insert({
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

async function silentRefetchShopifyQueries(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  try {
    await Promise.all(
      SHOPIFY_QUERY_KEYS.map((key) =>
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
    void silentRefetchShopifyQueries(queryClient);

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

    const result = await sendShopifyEmailReport();

    if (result.ok) {
      toast.success(`📦 Shopify schedule sent to ${result.successCount} recipient(s) (${result.totalItemsSent} items)`);
    } else {
      const detail = result.lastError || result.reason || 'unknown';
      toast.error(`❌ Shopify schedule failed: ${detail}`);
    }

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

export function ShopifyEmailAutoSendProvider({ children }: { children: ReactNode }) {
  const running = useRef(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await tick(running, queryClient);
    };

    const initialTimeout = window.setTimeout(run, 5_000);
    const intervalId = window.setInterval(run, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(initialTimeout);
      clearInterval(intervalId);
    };
  }, [queryClient]);

  return <>{children}</>;
}
