import { createServerSupabase, type ProductRow } from "@/lib/supabase/server";

export type Stock = { onHand: number; reserved: number; available: number };
export type CatalogItem = { product: ProductRow; stock: Stock | null };

// Preload all products + their current inventory stock so scan lookups are
// instant on the client (no per-scan server round-trip).
export async function loadScanCatalog(): Promise<CatalogItem[]> {
  const supabase = createServerSupabase();
  const [{ data: prod }, { data: inv }] = await Promise.all([
    supabase.from("product").select("*").order("product_name"),
    supabase.from("inventory").select("sku, product_name, oh_inv, reserved, available"),
  ]);
  const products = (prod ?? []) as ProductRow[];
  const bySku = new Map<string, Record<string, unknown>>();
  const byName = new Map<string, Record<string, unknown>>();
  for (const r of inv ?? []) {
    if (r.sku) bySku.set(String(r.sku).toLowerCase(), r);
    byName.set(String(r.product_name ?? "").toLowerCase(), r);
  }
  return products.map((p) => {
    const r = (p.sku && bySku.get(p.sku.toLowerCase())) || byName.get(p.product_name.toLowerCase());
    const stock: Stock | null = r
      ? { onHand: Number(r.oh_inv ?? 0), reserved: Number(r.reserved ?? 0), available: Number(r.available ?? 0) }
      : null;
    return { product: p, stock };
  });
}
