import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { recomputeForecastRow } from "@/lib/forecast/recomputeForecastRow";
import { useForecastDateVars } from "@/lib/forecastDateVars";

/**
 * Live forward-month projections for the "Monthly Projection" tab.
 *
 * The Monthly Projection values are NOT stored in Supabase — they are
 * auto-computed in the Demand Planner UI via `recomputeForecastRow`, which
 * derives `proj_month_1..12` every render from the effective monthly_projection,
 * sales lookup, velocities, the per-SKU forecast option, and today's
 * remaining_days (so they shift each day/month). This hook reproduces that exact
 * pipeline (full merge: forecast_report + monthly_sale_view_auto +
 * forecast_report_manual + forecast_report_proj_override) and returns the first
 * five forward months keyed by SKU so the All Channels grid can overlay them
 * onto its projection band.
 *
 * Only the projection band is reproduced — status/supply override tables are
 * intentionally skipped because they do not feed proj_month_* math.
 */
export function useMonthlyProjection(enabled: boolean) {
  const liveDateVars = useForecastDateVars();

  // ── Base forecast inputs (only the columns proj_month_* math reads) ──
  const { data: baseRows = [], isLoading: baseLoading } = useQuery({
    queryKey: ["monthly_projection:forecast_report"],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const CHUNK = 1000;
      const all: Record<string, unknown>[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("forecast_report")
          // NB: forecast_report has NO product_id column — keying by sku only.
          // Selecting a missing column 400s the whole query (empties the map).
          // Supply-plan inputs (oh_inv/fba/incoming_*/repl_*) feed supply_month_*.
          .select(
            "sku,monthly_projection,sales_velocity,actual_sale_of_month,sales_month_6," +
            "oh_inv,repl_oh_inv,fba,repl_fba," +
            [1, 2, 3, 4, 5, 6].map((i) => `incoming_month_${i}`).join(",") + "," +
            [1, 2, 3, 4, 5, 6].map((i) => `repl_month_${i}`).join(",")
          )
          .order("sku", { ascending: true })
          .range(from, from + CHUNK - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as Record<string, unknown>[]));
        if (data.length < CHUNK) break;
        from += CHUNK;
      }
      return all;
    },
  });

  // ── Sales lookup (month_6 fallback for sales_month_6) ──
  const { data: saleRows = [], isLoading: saleLoading } = useQuery({
    queryKey: ["monthly_projection:monthly_sale_view_auto"],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const CHUNK = 1000;
      const all: Record<string, unknown>[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("monthly_sale_view_auto")
          .select("sku,product_id,month_6")
          .range(from, from + CHUNK - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as Record<string, unknown>[]));
        if (data.length < CHUNK) break;
        from += CHUNK;
      }
      return all;
    },
  });

  // ── Manual overrides: effective monthly_projection + per-SKU forecast option ──
  const { data: manualRows = [], isLoading: manualLoading } = useQuery({
    queryKey: ["monthly_projection:forecast_report_manual"],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("forecast_report_manual" as any)
        .select("sku,monthly_projection,forecast_option")
        .limit(10000);
      if (error) throw error;
      return (data || []) as { sku: string; monthly_projection: number | null; forecast_option: number | null }[];
    },
  });

  // ── Per-month projection overrides ──
  const { data: projOverrideRows = [], isLoading: projLoading } = useQuery({
    queryKey: ["monthly_projection:forecast_report_proj_override"],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("forecast_report_proj_override" as any)
        .select("*")
        .limit(10000);
      if (error) throw error;
      return (data || []) as Record<string, unknown>[];
    },
  });

  // ── Per-month supply overrides (mirrors the Demand Planner supply band) ──
  const { data: supplyOverrideRows = [], isLoading: supplyOvrLoading } = useQuery({
    queryKey: ["monthly_projection:forecast_report_supply_override"],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("forecast_report_supply_override" as any)
        .select("*")
        .limit(10000);
      if (error) throw error;
      return (data || []) as Record<string, unknown>[];
    },
  });

  const saleLookup = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of saleRows) {
      const pid = String(r.product_id ?? "");
      if (pid) m.set(pid, r);
      const sku = String(r.sku ?? "");
      if (sku && sku !== pid) m.set(sku, r);
    }
    return m;
  }, [saleRows]);

  const manualMap = useMemo(() => {
    const m = new Map<string, (typeof manualRows)[number]>();
    for (const r of manualRows) m.set(String(r.sku ?? ""), r);
    return m;
  }, [manualRows]);

  const projOverrideMap = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of projOverrideRows) m.set(String(r.sku ?? ""), r);
    return m;
  }, [projOverrideRows]);

  const supplyOverrideMap = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of supplyOverrideRows) m.set(String(r.sku ?? ""), r);
    return m;
  }, [supplyOverrideRows]);

  /**
   * sku → [proj_month_1..5] (Jun..Oct forward) and sku → [supply_month_1..6]
   * (Jun..Nov forward), both mirroring the forecast page merge. Computed in one
   * pass so recomputeForecastRow runs once per SKU.
   */
  const { projectionMap, supplyMap } = useMemo(() => {
    const out = new Map<string, number[]>();
    const supplyOut = new Map<string, number[]>();
    if (!enabled) return { projectionMap: out, supplyMap: supplyOut };

    for (const row of baseRows) {
      const sku = String(row.sku ?? "");
      if (!sku) continue;

      const manual = manualMap.get(sku);
      const projOvr = projOverrideMap.get(sku);
      const supplyOvr = supplyOverrideMap.get(sku);
      const merged: Record<string, unknown> = { ...row };

      // Manual monthly_projection wins; wipe stale per-month values so recompute
      // derives proj_month_* from the effective driver (mirrors MonthlyForecast).
      if (manual?.monthly_projection != null) {
        merged.monthly_projection = manual.monthly_projection;
        for (let i = 1; i <= 12; i++) delete merged[`proj_month_${i}`];
      }

      let hasAnyProjOverride = false;
      if (projOvr) {
        for (let i = 1; i <= 12; i++) {
          if (projOvr[`proj_month_${i}_override`] != null) { hasAnyProjOverride = true; break; }
        }
      }

      // Per-row forecast option: stored value, else 0 (Baseline), clamped 0..4.
      const rawOpt = manual?.forecast_option ?? 0;
      const optionNum = Math.min(4, Math.max(0, Number.isFinite(Number(rawOpt)) ? Number(rawOpt) : 1));

      const recomputed = recomputeForecastRow(
        merged,
        saleLookup,
        hasAnyProjOverride, // drivingInputChanged only affects months_worth; harmless
        hasAnyProjOverride ? projOvr : null,
        supplyOvr ?? null,
        optionNum,
        liveDateVars,
      );

      out.set(sku, [1, 2, 3, 4, 5].map((i) => Number(recomputed[`proj_month_${i}`] ?? 0)));
      supplyOut.set(sku, [1, 2, 3, 4, 5, 6].map((i) => Number(recomputed[`supply_month_${i}`] ?? 0)));
    }
    return { projectionMap: out, supplyMap: supplyOut };
  }, [enabled, baseRows, manualMap, projOverrideMap, supplyOverrideMap, saleLookup, liveDateVars]);

  return {
    projectionMap,
    supplyMap,
    isLoading: enabled && (baseLoading || saleLoading || manualLoading || projLoading || supplyOvrLoading),
  };
}
