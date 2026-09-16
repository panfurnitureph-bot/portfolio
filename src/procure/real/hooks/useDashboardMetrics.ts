import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { toast } from "sonner";
import type { NewOrdersRange } from "@/hooks/useDashboardData";

type Filters = {
  fromDate?: Date;
  toDate?: Date;
  status?: string;
  warehouse?: string;
};

export type DashboardMetrics = {
  range_key: "today" | "7d" | "15d" | "31d" | "4m" | "6m" | "12m";

  // ✅ Executive KPIs
  gross_sales: number; // orders revenue
  fulfilled_sales: number; // shipped revenue
  fulfillment_rate: number; // %
  backlog: number; // gross - fulfilled
};

const num = (v: any) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// map UI range -> windows view key
function toWindowKey(range: NewOrdersRange, hasCustomRange: boolean): DashboardMetrics["range_key"] {
  if (hasCustomRange) return "31d";
  if (range === "today") return "today";
  if (range === "24h") return "today";
  if (range === "7d") return "7d";
  if (range === "15d") return "15d";
  if (range === "4m") return "4m";
  if (range === "6m") return "6m";
  if (range === "12m") return "12m";
  return "31d";
}

export function useDashboardMetrics(filters: Filters, range: NewOrdersRange = "31d") {
  const [isLoading, setIsLoading] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  const lastGood = useRef<DashboardMetrics | null>(null);

  const key = useMemo(
    () => toWindowKey(range, Boolean(filters.fromDate || filters.toDate)),
    [range, filters.fromDate, filters.toDate],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setLastError(null);

    try {
      const [{ data: ow, error: owErr }, { data: sw, error: swErr }] = await Promise.all([
        supabase.from("dashboard_orders_windows").select("revenue").eq("window", key).maybeSingle(),
        supabase.from("dashboard_shipped_windows").select("shipped_revenue").eq("window", key).maybeSingle(),
      ]);

      if (owErr) throw owErr;
      if (swErr) throw swErr;

      const gross = num(ow?.revenue);
      const fulfilled = num(sw?.shipped_revenue);

      const fulfillmentRate = gross > 0 ? (fulfilled / gross) * 100 : 0;
      const backlog = gross - fulfilled;

      const m: DashboardMetrics = {
        range_key: key,
        gross_sales: gross,
        fulfilled_sales: fulfilled,
        fulfillment_rate: fulfillmentRate,
        backlog,
      };

      setMetrics(m);
      lastGood.current = m;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setLastError(msg);
      toast.error(msg);

      if (lastGood.current) setMetrics(lastGood.current);
    } finally {
      setIsLoading(false);
    }
  }, [key]);

  useEffect(() => {
    load();
  }, [load]);

  return { isLoading, lastError, metrics, refetch: load };
}
