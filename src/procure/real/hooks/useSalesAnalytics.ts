import { useQuery } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";

/**
 * Channel Margin Console data-access layer — READ side.
 *
 * Sources (populated hourly by n8n, plus two config tables the app writes):
 *   - forecast_sales_summary    → the five live KPI cards (one row per card)
 *   - forecast_sales_cm         → VIEW, one row per (period, sku, channel);
 *                                 CM1–CM3 recalculate live off forecast_cm_config
 *   - forecast_sales_analytics  → base table, same grain; joined only for
 *                                 returned_qty / gross_profit / net_profit / margin_pct
 *   - forecast_cm_config        → margin settings (the panel writes here)
 *   - forecast_cm_shopify_rate  → dated Shopify rates, frozen per period
 *   - catalog_products              → SKU → product-name lookup
 *
 * THE GRAIN: one row per (period, sku, channel). A SKU sold on two channels is
 * two rows. Never join on sku alone; SUM across channels at read time for an
 * all-channels figure. There is deliberately no stored "All channels" row.
 *
 * Known imperfections in the CM data (verified 2026-09-02, do not re-discover):
 *   - Landed COGS is a single CURRENT value — April uses today's cost. Fine at
 *     six months of history; would not be at twelve.
 *   - Carrier cost covers ~91% of orders (most rows). The
 *     uncovered SKUs read slightly high on the _full CM set.
 *   - Five products have no Landed COGS in Airtable: AA-101-BLK, AA-102-WAL,
 *     AA-103-GRY, AA-104-NAT, AA-105-BLK. Cost comes through as zero, so
 *     they show ~92.5% CM1. Warranty / package protection / swatches also read
 *     zero cost, which is correct.
 *   - The summary cards total runs a small amount below the per-SKU total.
 *     The per-SKU figure matches the replica exactly; the cards query has a
 *     small untraced bug.
 */

/**
 * CM column set. Two sets exist ON PURPOSE: `cm1` is the owner's formula; `cm1_full`
 * additionally subtracts the real carrier cost and the real marketplace
 * commission (they differ by ~monthly sales, from 2.9% on Website to 38.2% on
 * Marketplace A). the owner has not picked one yet — when he does, switching the whole UI
 * to the _full set is this one edit (cm2_full_pct does not exist upstream;
 * cm2 ≈ cm1 while OPEX/fulfillment are zero, so the view only ships full pcts
 * for CM1 and CM3 — recompute any missing pct as 100·cm/sales).
 */
export const CM_COLS = {
  cm1: "cm1",
  cm2: "cm2",
  cm3: "cm3",
  cm1_pct: "cm1_pct",
  cm2_pct: "cm2_pct",
  cm3_pct: "cm3_pct",
} as const;

export interface SummaryCard {
  card: string;
  card_sort: number;
  period_from: string | null;
  period_to: string | null;
  is_forecast: boolean;
  orders: number | null;
  units: number | null;
  returns: number | null;
  sales: number | null;
  cogs: number | null;
  gross_profit: number | null;
  shipping_cost: number | null;
  net_profit: number | null;
  margin_pct: number | null;
  sales_vs_prev_pct: number | null;
  net_vs_prev_pct: number | null;
  pulled_at: string | null;
}

/** One (period, sku, channel) row: forecast_sales_cm + the four legacy
 *  AverageCost columns joined in from forecast_sales_analytics. */
export interface CmRow {
  period: string;
  period_sort: number;
  period_from: string | null;
  period_to: string | null;
  sku: string;
  channel: string;
  orders: number;
  units: number;
  sales: number;
  landed_cogs_per_unit: number | null;
  landed_cogs_total: number;
  shipping_revenue: number;
  carrier_cost: number;
  channel_commission: number;
  shopify_pct: number;
  shopify_fee: number;
  returns_allowance: number;
  opex: number;
  fulfillment: number;
  marketing: number;
  avg_cost_cogs: number | null;
  cm1: number;
  cm2: number;
  cm3: number;
  cm1_pct: number | null;
  cm2_pct: number | null;
  cm3_pct: number | null;
  cm1_full: number;
  cm2_full: number;
  cm3_full: number;
  cm1_full_pct: number | null;
  cm3_full_pct: number | null;
  // joined from forecast_sales_analytics (AverageCost basis — unreliable on kits)
  returned_qty: number;
  cogs: number;
  gross_profit: number | null;
  net_profit: number | null;
  margin_pct: number | null;
}

export interface CmConfig {
  returns_pct: number;
  opex_pct: number;
  fulfillment_value: number;
  fulfillment_mode: "per_unit" | "per_order" | "percent";
  marketing_pct: number;
  shopify_override_pct: number | null;
}

export interface ShopifyRate {
  effective_from: string;
  rate_pct: number;
}

const BATCH = 1000;

async function fetchAll(table: string, select: string, order: string[]): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = (supabase as any).from(table).select(select);
    for (const col of order) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + BATCH - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < BATCH) break;
    from += BATCH;
  }
  return all;
}

/** The five live KPI cards, sorted by card_sort. Monthly-history cards are NOT
 *  here — they are derived from the CM rows (see the page). */
export function useSalesSummary() {
  return useQuery<SummaryCard[]>({
    queryKey: ["forecast_sales_summary"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("forecast_sales_summary")
        .select("*")
        .order("card_sort", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SummaryCard[];
    },
  });
}

/**
 * EVERY (period, sku, channel) row, all periods at once (~8k rows, batched).
 * One fetch feeds the table, all nine card CM strips, and the channel filter,
 * so switching period/channel is instant and needs no refetch.
 */
export function useSalesCmRows() {
  return useQuery<CmRow[]>({
    queryKey: ["forecast_sales_cm_rows"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const order = ["period_sort", "sku", "channel"]; // stable order — required for .range() paging
      const [cmRows, baseRows] = await Promise.all([
        fetchAll("forecast_sales_cm", "*", order),
        fetchAll(
          "forecast_sales_analytics",
          "period,sku,channel,returned_qty,cogs,gross_profit,net_profit,margin_pct",
          order,
        ),
      ]);
      const baseMap = new Map<string, any>();
      for (const b of baseRows) baseMap.set(`${b.period}|${b.sku}|${b.channel}`, b);
      return cmRows.map((r) => {
        const b = baseMap.get(`${r.period}|${r.sku}|${r.channel}`);
        return {
          ...r,
          returned_qty: Number(b?.returned_qty ?? 0),
          cogs: Number(b?.cogs ?? 0),
          gross_profit: b?.gross_profit ?? null,
          net_profit: b?.net_profit ?? null,
          margin_pct: b?.margin_pct ?? null,
        } as CmRow;
      });
    },
  });
}

/** Margin settings — key/value rows folded into a typed object. */
export function useCmConfig() {
  return useQuery<CmConfig>({
    queryKey: ["forecast_cm_config"],
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("forecast_cm_config")
        .select("key,num_value,text_value");
      if (error) throw error;
      const m = new Map<string, { num_value: number | null; text_value: string | null }>();
      for (const r of data ?? []) m.set(r.key, r);
      const num = (k: string, dflt: number) => {
        const v = m.get(k)?.num_value;
        return v == null || !Number.isFinite(Number(v)) ? dflt : Number(v);
      };
      const mode = m.get("fulfillment_mode")?.text_value;
      const override = m.get("shopify_override_pct")?.num_value;
      return {
        returns_pct: num("returns_pct", 5),
        opex_pct: num("opex_pct", 0),
        fulfillment_value: num("fulfillment_value", 0),
        fulfillment_mode: (mode === "per_order" || mode === "percent" ? mode : "per_unit"),
        marketing_pct: num("marketing_pct", 18),
        shopify_override_pct: override == null ? null : Number(override),
      };
    },
  });
}

/** Dated Shopify rates (frozen per period). Empty ≠ error: the view falls back
 *  to its default when no dated rate covers a period. */
export function useShopifyRates() {
  return useQuery<ShopifyRate[]>({
    queryKey: ["forecast_cm_shopify_rate"],
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("forecast_cm_shopify_rate")
        .select("effective_from,rate_pct")
        .order("effective_from", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ShopifyRate[];
    },
  });
}

/** Write one config key. The view recalculates on the next read — nothing to
 *  refresh server-side; the caller invalidates the react-query caches. */
export async function saveCmConfigKey(
  key: string,
  value: { num_value?: number | null; text_value?: string | null },
): Promise<void> {
  const { error } = await (supabase as any)
    .from("forecast_cm_config")
    .update(value)
    .eq("key", key);
  if (error) throw error;
}

/** Raising the Shopify rate is an INSERT with today's date — never an edit of
 *  an existing row, so past periods keep the rate they were calculated with. */
export async function insertShopifyRate(effectiveFrom: string, ratePct: number): Promise<void> {
  const { error } = await (supabase as any)
    .from("forecast_cm_shopify_rate")
    .insert({ effective_from: effectiveFrom, rate_pct: ratePct });
  if (error) throw error;
}

/** SKU → { name, color } lookup mula catalog_products. */
export function useBzlProductNames() {
  return useQuery<Map<string, { name: string; color: string | null }>>({
    queryKey: ["catalog_products_names"],
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const map = new Map<string, { name: string; color: string | null }>();
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await (supabase as any)
          .from("catalog_products")
          .select("sku,product_name,item_color")
          .range(from, from + BATCH - 1);
        if (error) throw error;
        const rows = (data ?? []) as { sku: string | null; product_name: string | null; item_color: string | null }[];
        for (const r of rows) {
          const s = String(r.sku ?? "").trim();
          if (s && r.product_name) map.set(s, { name: r.product_name, color: r.item_color ?? null });
        }
        if (rows.length < BATCH) break;
        from += BATCH;
      }
      return map;
    },
  });
}
