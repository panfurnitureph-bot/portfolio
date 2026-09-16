// =======================================================
// 2) src/providers/RealtimeProvider.tsx  (BULK-RESET AWARE)
// - When TRUNCATE+INSERT happens, you WILL send a reset event.
// - UI clears instantly + triggers ONE refetch (no storms).
// - Normal realtime patching stays for small changes.
// =======================================================

import { useEffect, useRef, useCallback, useState, createContext, useContext, ReactNode, forwardRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { externalSupabase } from "@/integrations/supabase/externalClient";
import { onForecastEdit, onForecastColumnClear, type ForecastEditMsg } from "@/lib/forecastBroadcast";

type RealtimeStatus = "connecting" | "connected" | "disconnected";
const RealtimeStatusContext = createContext<RealtimeStatus>("connecting");

export function useRealtimeStatus() {
  return useContext(RealtimeStatusContext);
}

interface RealtimeProviderProps {
  children: ReactNode;
}

export const RealtimeProvider = forwardRef<unknown, RealtimeProviderProps>(({ children }, _ref) => {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof externalSupabase.channel> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Record<string, any[]>>({});
  const [status, setStatus] = useState<RealtimeStatus>("connecting");

  // Adjust PKs if needed
  const PRIMARY_KEYS: Record<string, string> = {
    inventory: "id", // change to "sku" if sku is unique
    shipping_request: "id",
    invoice: "id",
    sales: "id",
    container: "id",
    po_export: "id",
    predictive_purchasing: "id",
    orders: "id",
    refunds: "id",
    return: "id",
    forecast_view: "id",
    vendor_list: "id",
    monthlysale: "id",
    incoming_shipment_view: "id",
    // Forecast side tables are keyed by sku — patched live from the event payload.
    forecast_report_manual: "sku",
    forecast_report_status: "sku",
    forecast_report_proj_override: "sku",
    forecast_report_supply_override: "sku",
  };

  // Base query keys (must match useTableData queryKey)
  const TABLE_TO_BASE_QUERY_KEYS: Record<string, string[]> = {
    inventory: ["inventory"],
    shipping_request: ["shipping_request"],
    invoice: ["invoice"],
    sales: ["sales"],
    container: ["container"],
    po_export: ["po_export"],
    predictive_purchasing: ["predictive_purchasing"],
    orders: ["orders"],
    refunds: ["refunds"],
    return: ["return"],
    forecast_view: ["forecast_view"],
    vendor_list: ["vendor_list"],
    monthlysale: ["monthlysale"],
    incoming_shipment_view: ["incoming_shipment_view"],
    forecast_report_manual: ["forecast_report_manual"],
    forecast_report_status: ["forecast_report_status"],
    forecast_report_proj_override: ["forecast_report_proj_override"],
    forecast_report_supply_override: ["forecast_report_supply_override"],
  };

  const patchOneCache = useCallback(
    (cacheKey: readonly unknown[], table: string, events: any[]) => {
      const pk = PRIMARY_KEYS[table] ?? "id";

      queryClient.setQueryData(cacheKey, (prev: any) => {
        const arr: any[] | null = Array.isArray(prev) ? prev : null;
        if (!arr) return prev;

        const map = new Map<any, any>();
        for (const row of arr) map.set(row?.[pk], row);

        for (const p of events) {
          if (p.eventType === "INSERT") map.set(p.new?.[pk], p.new);
          else if (p.eventType === "UPDATE") map.set(p.new?.[pk], p.new);
          else if (p.eventType === "DELETE") map.delete(p.old?.[pk]);
        }

        return Array.from(map.values());
      });
    },
    [queryClient],
  );

  const patchAllVariantsForBaseKey = useCallback(
    (baseKey: string, table: string, events: any[]) => {
      const matches = queryClient.getQueryCache().findAll({ queryKey: [baseKey] });
      for (const q of matches) patchOneCache(q.queryKey, table, events);
    },
    [queryClient, patchOneCache],
  );

  const flushQueued = useCallback(() => {
    const queued = queueRef.current;
    queueRef.current = {};
    flushTimerRef.current = null;

    Object.entries(queued).forEach(([table, events]) => {
      const baseKeys = TABLE_TO_BASE_QUERY_KEYS[table];
      if (!baseKeys?.length) return;
      for (const baseKey of baseKeys) {
        patchAllVariantsForBaseKey(baseKey, table, events);
      }
    });
  }, [patchAllVariantsForBaseKey]);

  const queueEvent = useCallback(
    (table: string, payload: any) => {
      if (!queueRef.current[table]) queueRef.current[table] = [];
      queueRef.current[table].push(payload);

      // keep batching for small changes
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(() => flushQueued(), 200);
    },
    [flushQueued],
  );

  // ✅ HARD RESET (for TRUNCATE + bulk insert)
  const hardResetTable = useCallback(
    (table: string) => {
      const baseKeys = TABLE_TO_BASE_QUERY_KEYS[table] || [];
      for (const baseKey of baseKeys) {
        // 1) clear immediately (instant UI)
        const matches = queryClient.getQueryCache().findAll({ queryKey: [baseKey] });
        matches.forEach((q) => queryClient.setQueryData(q.queryKey, []));

        // 2) ONE refetch (not a storm)
        queryClient.invalidateQueries({ queryKey: [baseKey] });
      }
    },
    [queryClient],
  );

  // Debounced invalidate-only sync for tables we don't need to patch in place.
  // Coalesces bursts of row-change events into a single invalidation per key.
  const emailSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forecastSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleInvalidate = useCallback(
    (timerRef: { current: ReturnType<typeof setTimeout> | null }, queryKeys: readonly unknown[][], delay = 300) => {
      if (timerRef.current) return; // already queued
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        for (const key of queryKeys) {
          queryClient.invalidateQueries({ queryKey: key, refetchType: "active" });
        }
      }, delay);
    },
    [queryClient],
  );

  useEffect(() => {
    const channel = externalSupabase
      .channel("app-realtime-channel")

      // Small-change realtime (keep)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, (p) => queueEvent("inventory", p))

      // Email schedule changes (any browser edits settings → all browsers refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "email_schedule_config" }, () => {
        scheduleInvalidate(emailSyncTimerRef, [["email_schedule_config"], ["email_schedule_log"]]);
      })

      // Email factory mapping changes
      .on("postgres_changes", { event: "*", schema: "public", table: "email_factory_mapping" }, () => {
        scheduleInvalidate(emailSyncTimerRef, [["email_factory_mapping"]]);
      })

      // Forecast report row changes — invalidate the side tables and the main forecast_report key.
      // Only currently-mounted queries refetch (refetchType: 'active'), so other pages stay idle.
      .on("postgres_changes", { event: "*", schema: "public", table: "forecast_report" }, () => {
        scheduleInvalidate(
          forecastSyncTimerRef,
          [["forecast_report"], ["forecast_report_lead_time"]],
          1000,
        );
      })
      // Instant cross-user updates: patch the cache directly from the event
      // payload (REPLICA IDENTITY FULL → full row), no refetch, no debounce.
      .on("postgres_changes", { event: "*", schema: "public", table: "forecast_report_manual" }, (p) => queueEvent("forecast_report_manual", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "forecast_report_status" }, (p) => queueEvent("forecast_report_status", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "forecast_report_proj_override" }, (p) => queueEvent("forecast_report_proj_override", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "forecast_report_supply_override" }, (p) => queueEvent("forecast_report_supply_override", p))

      // ✅ RESET SIGNAL listener (THIS is what makes bulk rebuild fast)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "table_reset_events" }, (p) => {
        const tableName = p.new?.table_name as string | undefined;
        if (!tableName) return;
        hardResetTable(tableName);
      })

      .subscribe((s) => {
        if (s === "SUBSCRIBED") setStatus("connected");
        else if (s === "CHANNEL_ERROR" || s === "CLOSED") setStatus("disconnected");
      });

    channelRef.current = channel;

    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (emailSyncTimerRef.current) clearTimeout(emailSyncTimerRef.current);
      if (forecastSyncTimerRef.current) clearTimeout(forecastSyncTimerRef.current);
      if (channelRef.current) externalSupabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [queueEvent, hardResetTable, scheduleInvalidate]);

  // ── Live forecast edits via Broadcast (instant, bypasses the DB/WAL) ──
  // Apply incoming edits straight to the React Query cache, merged by sku.
  // Buffered ~60ms so a bulk burst applies in a few renders, not one each.
  // postgres_changes (above) still arrives later as the authoritative full-row
  // reconciliation; this just makes the UI update feel instant.
  useEffect(() => {
    const buffer = new Map<string, Map<string, Record<string, unknown>>>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      for (const [table, bySku] of buffer) {
        queryClient.setQueryData([table], (prev: any) => {
          const arr: any[] = Array.isArray(prev) ? [...prev] : [];
          const idxBySku = new Map<string, number>();
          arr.forEach((r, i) => idxBySku.set(String(r?.sku), i));
          for (const [sku, fields] of bySku) {
            const i = idxBySku.get(sku);
            if (i != null) arr[i] = { ...arr[i], ...fields };
            else arr.push({ sku, ...fields });
          }
          return arr;
        });
      }
      buffer.clear();
    };

    const off = onForecastEdit((msg: ForecastEditMsg) => {
      if (!buffer.has(msg.table)) buffer.set(msg.table, new Map());
      const bySku = buffer.get(msg.table)!;
      bySku.set(msg.sku, { ...(bySku.get(msg.sku) ?? {}), ...msg.fields });
      if (!timer) timer = setTimeout(flush, 60);
    });

    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [queryClient]);

  // ── Whole-column "Clear Manual Value" from another user ──
  // The editor clears the column server-side and broadcasts one signal; every
  // other client refetches just that table so the cleared values appear at once.
  useEffect(() => {
    const CLEAR_KEYS: Record<string, string[][]> = {
      forecast_report_manual: [["forecast_report_manual"]],
      forecast_report_proj_override: [["forecast_report_proj_override"]],
      forecast_report_supply_override: [["forecast_report_supply_override"]],
      forecast_report: [["forecast_report"], ["forecast_report_lead_time"]],
    };
    const off = onForecastColumnClear((msg) => {
      for (const key of CLEAR_KEYS[msg.table] ?? []) {
        queryClient.invalidateQueries({ queryKey: key, refetchType: "active" });
      }
    });
    return off;
  }, [queryClient]);

  return <RealtimeStatusContext.Provider value={status}>{children}</RealtimeStatusContext.Provider>;
});

RealtimeProvider.displayName = "RealtimeProvider";
