import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";

/**
 * Inbound Shipment + Incoming Breakdown values for the Inbound Shipment
 * Dashboard tab, pulled from the SAME forecast_report columns the Forecast
 * Report displays:
 *   - incoming_month_1..9  → forward-month incoming shipments (Jun..Feb)
 *   - oo_units_30days/60days/90days → open-order units arriving in 30/60/90 days
 *
 * These are stored columns (not recomputed), keyed by SKU — so the dashboard
 * mirrors exactly what the Demand Planner shows.
 */
export type IncomingValues = { incoming: number[]; oo: [number, number, number] };

export function useIncomingShipment(enabled: boolean) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["incoming_shipment:forecast_report"],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const CHUNK = 1000;
      const cols =
        "sku," +
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `incoming_month_${i}`).join(",") +
        ",oo_units_30days,oo_units_60days,oo_units_90days";
      const build = (withCount: boolean) =>
        supabase
          .from("forecast_report")
          .select(cols, withCount ? { count: "exact" } : undefined)
          .order("sku", { ascending: true });
      // Page 1 returns the exact total, so the rest fetch in parallel (not serially).
      const firstRes = await build(true).range(0, CHUNK - 1);
      if (firstRes.error) throw firstRes.error;
      const all: Record<string, unknown>[] = [...((firstRes.data as Record<string, unknown>[]) ?? [])];
      const total = firstRes.count ?? all.length;
      const pages = Math.ceil(total / CHUNK);
      if (pages > 1) {
        const rest = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) => build(false).range((i + 1) * CHUNK, (i + 2) * CHUNK - 1)),
        );
        for (const r of rest) { if (r.error) throw r.error; all.push(...((r.data as Record<string, unknown>[]) ?? [])); }
      }
      return all;
    },
  });

  const incomingMap = useMemo(() => {
    const m = new Map<string, IncomingValues>();
    if (!enabled) return m;
    const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    for (const r of rows) {
      const sku = String(r.sku ?? "");
      if (!sku) continue;
      m.set(sku, {
        incoming: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => num(r[`incoming_month_${i}`])),
        oo: [num(r.oo_units_30days), num(r.oo_units_60days), num(r.oo_units_90days)],
      });
    }
    return m;
  }, [enabled, rows]);

  return { incomingMap, isLoading: enabled && isLoading };
}
