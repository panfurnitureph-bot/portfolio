import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";

export type ProductMeta = { name: string; imageUpdatedAt: string | null };
export type ProductNameMap = Record<string, ProductMeta>;

const EMPTY_MAP: ProductNameMap = {};
const BATCH_SIZE = 200;

/**
 * Bulk-resolves productid → { name, imageUpdatedAt } from inventory.
 * Stable cache key from sorted, deduped, non-empty ids. Batches the .in()
 * call so we never exceed Supabase's parameter list limit.
 */
export function useProductNames(productIds: Array<string | null | undefined>) {
  const uniqueIds = useMemo(() => {
    const set = new Set<string>();
    for (const id of productIds) {
      if (id != null && String(id).length > 0) set.add(String(id));
    }
    return Array.from(set).sort();
  }, [productIds]);

  const query = useQuery({
    queryKey: ["product-names", uniqueIds.join(",")],
    queryFn: async (): Promise<ProductNameMap> => {
      if (!uniqueIds.length) return EMPTY_MAP;
      const map: ProductNameMap = {};
      for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
        const batch = uniqueIds.slice(i, i + BATCH_SIZE);
        const { data, error } = await (supabase as any)
          .from("inventory")
          .select("productid, productname, image_updated_at")
          .in("productid", batch);
        if (error) throw error;
        for (const row of (data || []) as Array<{
          productid: string | null;
          productname: string | null;
          image_updated_at: string | null;
        }>) {
          if (row?.productid == null) continue;
          map[String(row.productid)] = {
            name: row.productname || "",
            imageUpdatedAt: row.image_updated_at,
          };
        }
      }
      return map;
    },
    enabled: uniqueIds.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  return { data: query.data ?? EMPTY_MAP, ...query };
}

export default useProductNames;
