import { createServerSupabase } from "@/lib/supabase/server";
import { isShippingDesc } from "@/lib/shipping";
import type { SalesOrder, SalesTargets } from "./sales-types";
import { DEFAULT_TARGETS } from "./sales-types";

// Editable targets from app_settings (falls back to realistic defaults).
export async function loadTargets(): Promise<SalesTargets> {
  const db = createServerSupabase();
  const { data } = await db.from("app_settings").select("value").eq("key", "sales_targets").maybeSingle();
  const v = (data?.value ?? {}) as Partial<SalesTargets>;
  return {
    revenue: Number(v.revenue ?? DEFAULT_TARGETS.revenue),
    orders: Number(v.orders ?? DEFAULT_TARGETS.orders),
    collection: Number(v.collection ?? DEFAULT_TARGETS.collection),
    aov: Number(v.aov ?? DEFAULT_TARGETS.aov),
  };
}

// We load a wide-enough window once and let the client compute every
// period/aggregate reactively, so the period toggles feel instant (no refetch).
export async function loadSalesOrders(): Promise<SalesOrder[]> {
  const db = createServerSupabase();
  const [{ data }, { data: prods }] = await Promise.all([
    db.from("orders")
      .select("id, order_number, date_order, customer_name, Source, status, assigned, downpayment_price, full_payment, full_payment_price, category, receipt_items")
      .order("date_order", { ascending: false }).order("id", { ascending: false })
      .limit(2000),
    db.from("product").select("product_name, sku, category, image_url, cost").limit(10000),
  ]);

  // Stored category/image on receipt_items is often blank; resolve them (plus
  // cost) the same way the rest of the app does — match by SKU, else by name —
  // so the dashboard agrees with the UI (no "Uncategorized", real photos, COGS).
  type Prod = { product_name: string | null; sku: string | null; category: string | null; image_url: string | null; cost: number | null };
  const catBySku = new Map<string, string>(), catByName = new Map<string, string>();
  const imgBySku = new Map<string, string>(), imgByName = new Map<string, string>();
  const costBySku = new Map<string, number>(), costByName = new Map<string, number>();
  const prodList = (prods ?? []) as Prod[];
  for (const p of prodList) {
    const sku = p.sku?.toLowerCase(), name = p.product_name?.toLowerCase();
    if (p.category) { if (sku) catBySku.set(sku, p.category); if (name) catByName.set(name, p.category); }
    if (p.image_url) { if (sku) imgBySku.set(sku, p.image_url); if (name) imgByName.set(name, p.image_url); }
    if (p.cost != null) { if (sku) costBySku.set(sku, Number(p.cost)); if (name) costByName.set(name, Number(p.cost)); }
  }
  // Fuzzy substring match against the product list — memoized per name so we
  // scan the products once per distinct description instead of once per item.
  // Same first-match semantics as before (first product with each field set).
  const fuzzyCache = new Map<string, { cat: string | null; img: string | null; cost: number | null }>();
  const fuzzyAll = (name: string) => {
    if (!name) return { cat: null, img: null, cost: null };
    const hit = fuzzyCache.get(name);
    if (hit) return hit;
    let cat: string | null = null, img: string | null = null, cost: number | null = null;
    for (const p of prodList) {
      const n = (p.product_name ?? "").toLowerCase();
      if (!n) continue;
      if (!(name.startsWith(n) || n.startsWith(name) || name.includes(n) || n.includes(name))) continue;
      if (cat === null && p.category) cat = p.category;
      if (img === null && p.image_url) img = p.image_url;
      if (cost === null && p.cost != null) cost = Number(p.cost);
      if (cat !== null && img !== null && cost !== null) break;
    }
    const r = { cat, img, cost };
    fuzzyCache.set(name, r);
    return r;
  };
  const resolveCat = (sku: string | null, desc: string, orderCat: string | null): string => {
    const name = desc.toLowerCase();
    return (sku ? catBySku.get(sku.toLowerCase()) : undefined) ?? catByName.get(name) ?? fuzzyAll(name).cat ?? orderCat ?? "Uncategorized";
  };
  const resolveImg = (sku: string | null, desc: string, itemImg: string | null): string | null => {
    if (itemImg && itemImg.trim()) return itemImg;
    const name = desc.toLowerCase();
    return (sku ? imgBySku.get(sku.toLowerCase()) : undefined) ?? imgByName.get(name) ?? fuzzyAll(name).img;
  };
  const resolveCost = (sku: string | null, desc: string): number => {
    const name = desc.toLowerCase();
    return (sku ? costBySku.get(sku.toLowerCase()) : undefined) ?? costByName.get(name) ?? fuzzyAll(name).cost ?? 0;
  };

  type Raw = {
    id: number; order_number: string | null; date_order: string | null; customer_name: string | null;
    Source: string | null; status: string | null; assigned: string | null;
    downpayment_price: number | null; full_payment: number | null; full_payment_price: number | null;
    category: string | null;
    receipt_items: { qty?: number; description?: string; unitPrice?: number; category?: string | null; sku?: string | null; image?: string | null }[] | null;
  };

  return ((data ?? []) as Raw[]).map((r) => ({
    id: r.id,
    order_number: r.order_number,
    date_order: r.date_order,
    customer_name: r.customer_name,
    source: r.Source,
    status: r.status,
    assigned: r.assigned,
    downpayment: Number(r.downpayment_price ?? 0),
    full_payment: Number(r.full_payment ?? 0),
    total: Number(r.full_payment_price ?? 0),
    category: r.category,
    // Shipping Fee = bayarin, hindi produkto — labas sa product analytics.
    items: (r.receipt_items ?? []).filter((it) => !isShippingDesc(it.description)).map((it) => {
      const description = String(it.description ?? "").split("\n")[0].trim();
      return {
        qty: Number(it.qty ?? 0),
        description,
        unitPrice: Number(it.unitPrice ?? 0),
        // Use stored values if present, else resolve via product match.
        category: (it.category && it.category.trim()) || resolveCat(it.sku ?? null, description, r.category),
        image: resolveImg(it.sku ?? null, description, it.image ?? null),
        cost: resolveCost(it.sku ?? null, description),
      };
    }),
  }));
}
