import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";

/**
 * Trailing 5-month Website + Other-Channel sales for the Flagged SKUs view,
 * keyed by SKU — read from forecast_channel_sales (web_/oth_month_4..0,
 * month_0 = current month), the SAME table the channel tabs' sales bands use.
 *
 * Shares the ["forecast_channel_sales"] query key with ChannelDashboardTable's
 * fcsRows fetch, so if any channel tab already loaded it this is a pure cache
 * hit — no second fetch.
 *
 * Ordering: index 0 = oldest (month_4) … index 4 = current month (month_0),
 * matching wsale_1..5 / osale_1..5 like the base sale_1..5 band.
 */

function salesMapFromRows(rows: Record<string, unknown>[], prefix: "web" | "oth"): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const sku = String(r.sku ?? "").trim();
    if (!sku) continue;
    out.set(sku, [4, 3, 2, 1, 0].map((i) => Number(r[`${prefix}_month_${i}`]) || 0));
  }
  return out;
}

export interface CrossChannelSales {
  websiteSalesBySku: Map<string, number[]>;
  otherSalesBySku: Map<string, number[]>;
  isLoading: boolean;
}

export function useCrossChannelSales(enabled: boolean): CrossChannelSales {
  const { data: fcsRows = [], isLoading } = useQuery({
    queryKey: ["forecast_channel_sales"],
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const all: Record<string, unknown>[] = [];
      const BATCH = 1000;
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: page, error } = await (supabase as any)
          .from("forecast_channel_sales")
          .select("*")
          .range(from, from + BATCH - 1);
        if (error) throw error;
        if (!page || page.length === 0) break;
        all.push(...page);
        if (page.length < BATCH) break;
        from += BATCH;
      }
      return all;
    },
  });

  const websiteSalesBySku = useMemo(() => salesMapFromRows(fcsRows, "web"), [fcsRows]);
  const otherSalesBySku = useMemo(() => salesMapFromRows(fcsRows, "oth"), [fcsRows]);

  return { websiteSalesBySku, otherSalesBySku, isLoading: enabled && isLoading };
}
