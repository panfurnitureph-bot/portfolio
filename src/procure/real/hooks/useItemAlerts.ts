import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";

/**
 * Per-SKU listing/purchasing status for the dashboard "Flagged SKUs" flags.
 *
 * Intentionally lightweight: it only reads sku + shopify_status + pu_status from
 * forecast_report. Stagnancy is decided in ChannelDashboardTable straight from
 * the channel's own monthly sales (sale_4 + sale_5) — the numbers the user
 * sees — so we DON'T scan order history here (that was both slow and, due to
 * SKU↔product_id mapping gaps, occasionally contradicted the visible sales).
 */

const CHUNK = 1000;

export const STAGNANT_DAYS = 30;

type StatusRow = {
  sku: string | null;
  shopify_status: string | null;
  pu_status: string | null;
  purchasing_url: string | null;
  shopify_url: string | null;
};

/** "Not Listed on Shopify" — same definition the Shopify email report uses:
 *  blank, "-", or any "inactive" variant. (sendShopifyEmailReport.ts) */
export function isNotListedOnShopify(shopifyStatus: string | null | undefined): boolean {
  const s = String(shopifyStatus ?? "").trim().toLowerCase();
  return s === "" || s === "-" || s.includes("inactive") || s === "not listed";
}

/** "Active in Purchasing" — pu_status is exactly Active. ("Discontinued Active
 *  as a new SKU" is NOT active.) */
export function isActivePurchasing(puStatus: string | null | undefined): boolean {
  return String(puStatus ?? "").trim().toLowerCase() === "active";
}

export interface ItemAlertsData {
  /** sku → raw Shopify status string. */
  shopifyStatusBySku: Map<string, string>;
  /** sku → raw Purchasing status string. */
  puStatusBySku: Map<string, string>;
  /** sku → the ERP product URL (purchasing_url), if any. */
  purchasingUrlBySku: Map<string, string>;
  /** sku → Shopify product URL (shopify_url), if any. */
  shopifyUrlBySku: Map<string, string>;
  isLoading: boolean;
}

export function useItemAlerts(enabled: boolean): ItemAlertsData {
  const { data: statusRows = [], isLoading } = useQuery({
    queryKey: ["item_alerts:forecast_status"],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const all: StatusRow[] = [];
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("forecast_report")
          .select("sku,shopify_status,pu_status,purchasing_url,shopify_url")
          .order("sku")
          .range(from, from + CHUNK - 1);
        if (error) throw error;
        const rows = (data || []) as StatusRow[];
        all.push(...rows);
        if (rows.length < CHUNK) break;
        from += CHUNK;
      }
      return all;
    },
  });

  const { shopifyStatusBySku, puStatusBySku, purchasingUrlBySku, shopifyUrlBySku } = useMemo(() => {
    const shop = new Map<string, string>();
    const pu = new Map<string, string>();
    const puUrl = new Map<string, string>();
    const shopUrl = new Map<string, string>();
    for (const r of statusRows) {
      const sku = (r.sku ?? "").trim();
      if (!sku) continue;
      shop.set(sku, (r.shopify_status ?? "").trim());
      pu.set(sku, (r.pu_status ?? "").trim());
      const pUrl = (r.purchasing_url ?? "").trim();
      if (pUrl && pUrl !== "-") puUrl.set(sku, pUrl);
      const sUrl = (r.shopify_url ?? "").trim();
      if (sUrl && sUrl !== "-") shopUrl.set(sku, sUrl);
    }
    return { shopifyStatusBySku: shop, puStatusBySku: pu, purchasingUrlBySku: puUrl, shopifyUrlBySku: shopUrl };
  }, [statusRows]);

  return { shopifyStatusBySku, puStatusBySku, purchasingUrlBySku, shopifyUrlBySku, isLoading: enabled && isLoading };
}
