import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";

/**
 * Shared fetch for the channel dashboard tables (amazon/website/other_channel_
 * dashboard, monthly_projection_dashboard). Both ChannelDashboardTable and the
 * Flagged SKUs cross-channel sales read through this under the SAME
 * react-query key, so a table fetched by one tab is reused by the other with no
 * second network round-trip.
 */

const CHUNK = 1000;

const BASE_COLS = "id,sku,product_name,factory,kit,shadow,category,instock_1,instock_2,instock_3,instock_4,instock_5";
const TAIL_COLS = "oh_inv,otw,oo_unit";

/** Select list — the middle (sales) group is read under its real prefix and
 *  aliased back to sale_* so every consumer sees an identical row shape. */
export function channelSelectCols(salesKeyPrefix: string): string {
  const sales = salesKeyPrefix === "sale"
    ? "sale_1,sale_2,sale_3,sale_4,sale_5"
    : [1, 2, 3, 4, 5].map((i) => `sale_${i}:${salesKeyPrefix}_${i}`).join(",");
  return `${BASE_COLS},${sales},${TAIL_COLS}`;
}

/** Canonical react-query key for a channel table — shared across consumers. */
export function channelRowsQueryKey(tableName: string, salesKeyPrefix: string) {
  return [tableName, salesKeyPrefix] as const;
}

export async function fetchChannelRows(tableName: string, salesKeyPrefix: string): Promise<Record<string, unknown>[]> {
  const select = channelSelectCols(salesKeyPrefix);
  const orderCol = `${salesKeyPrefix}_5`;
  const all: Record<string, unknown>[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select(select)
      .order(orderCol, { ascending: false })
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as Record<string, unknown>[]));
    if (data.length < CHUNK) break;
    from += CHUNK;
  }
  return all;
}
