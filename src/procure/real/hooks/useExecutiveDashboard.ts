import { useCallback, useEffect, useMemo, useState } from "react";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { toast } from "sonner";

type Filters = {
  fromDate?: Date;
  toDate?: Date;
  status?: string;
  warehouse?: string;
};

type KPIs = {
  totalSales: number;   // orders_grand_total
  totalRevenue: number; // shipped_grand_total
  totalLost: number;
  netProfit: number;
  profitMargin: number;
};

function toNumber(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function useExecutiveDashboard(filters: Filters) {
  const [isLoading, setIsLoading] = useState(true);
  const [kpis, setKpis] = useState<KPIs | null>(null);

  const isCustom = useMemo(() => Boolean(filters.fromDate || filters.toDate), [filters.fromDate, filters.toDate]);

  const load = useCallback(async () => {
    setIsLoading(true);

    try {
      // ✅ executive dashboard: if custom range, keep your old daily-sum logic
      if (isCustom) {
        const to = filters.toDate ?? new Date();
        const from = filters.fromDate ?? new Date(to.getTime() - 30 * 86400000);

        const fromStr = new Date(from).toISOString().slice(0, 10);
        const toStr = new Date(to).toISOString().slice(0, 10);

        const [{ data: od, error: odErr }, { data: sd, error: sdErr }] = await Promise.all([
          supabase.from("dashboard_orders_daily").select("revenue,day").gte("day", fromStr).lte("day", toStr),
          supabase.from("dashboard_shipped_daily").select("shipped_revenue,day").gte("day", fromStr).lte("day", toStr),
        ]);

        if (odErr) throw odErr;
        if (sdErr) throw sdErr;

        const ordersRevenue = (od ?? []).reduce((s: number, r: any) => s + toNumber(r.revenue), 0);
        const shippedRevenue = (sd ?? []).reduce((s: number, r: any) => s + toNumber(r.shipped_revenue), 0);

        const totalLost = 0;
        const netProfit = shippedRevenue - totalLost;
        const profitMargin = shippedRevenue > 0 ? (netProfit / shippedRevenue) * 100 : 0;

        setKpis({
          totalSales: ordersRevenue,
          totalRevenue: shippedRevenue,
          totalLost,
          netProfit,
          profitMargin,
        });

        return;
      }

      // ✅ not custom: use KPI view for consistent totals
      const { data, error } = await supabase
        .from("dashboard_kpis_windows")
        .select("orders_grand_total,shipped_grand_total,profit,margin")
        .eq("range_key", "31d")
        .maybeSingle();

      if (error) throw error;

      const ordersRevenue = toNumber((data as any)?.orders_grand_total);
      const shippedRevenue = toNumber((data as any)?.shipped_grand_total);

      const totalLost = 0;
      const netProfit = toNumber((data as any)?.profit) || (shippedRevenue - totalLost);
      const profitMargin = toNumber((data as any)?.margin) || (shippedRevenue > 0 ? (netProfit / shippedRevenue) * 100 : 0);

      setKpis({
        totalSales: ordersRevenue,
        totalRevenue: shippedRevenue,
        totalLost,
        netProfit,
        profitMargin,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Executive dashboard error");
      setKpis({
        totalSales: 0,
        totalRevenue: 0,
        totalLost: 0,
        netProfit: 0,
        profitMargin: 0,
      });
    } finally {
      setIsLoading(false);
    }
  }, [filters.fromDate, filters.toDate, isCustom]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    kpis,
    isLoading,
    refetch: load,
  };
}
