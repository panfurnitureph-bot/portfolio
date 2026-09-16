// BEST SELLERS NG WEBSITE — AWTOMATIKO (2026-09-04, "dapat automatic na to").
// Dati manu-manong pinipili sa Website tab. Ngayon: bilang ng nabenta kada
// SKU sa nakaraang 90 araw (orders.receipt_items, hindi cancelled/pending),
// tinutumbas sa web_products.slug, at isinusulat sa web_content.best_sellers
// = ["slug", ...] (top 10). Binabasa ito ng homepage; walang laman = featured
// at new na produkto ang fallback ng site. Best-effort: tumatakbo kasabay ng
// inventory resync sa bawat galaw ng order, at hindi kailanman nagtatapon.

import type { createServerSupabase } from "@/lib/supabase/server";

type Db = ReturnType<typeof createServerSupabase>;

export async function refreshBestSellers(db: Db): Promise<void> {
  try {
    // orders.date_order (YYYY-MM-DD) ang petsa ng order — walang created_at.
    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const [{ data: orders }, { data: web }] = await Promise.all([
      db.from("orders").select("receipt_items, status").gte("date_order", since).limit(5000),
      db.from("web_products").select("slug, data->>sku").limit(2000),
    ]);
    const slugBySku = new Map<string, string>();
    for (const w of (web ?? []) as { slug: string; sku?: string | null }[]) {
      const k = String(w.sku ?? "").trim().toLowerCase();
      if (k) slugBySku.set(k, w.slug);
    }
    const qty = new Map<string, number>();
    for (const o of (orders ?? []) as { receipt_items?: unknown; status?: string | null }[]) {
      const st = String(o.status ?? "").toLowerCase();
      if (/cancel|pending|draft/.test(st)) continue;
      for (const it of (Array.isArray(o.receipt_items) ? o.receipt_items : []) as { sku?: string | null; qty?: unknown }[]) {
        const k = String(it?.sku ?? "").trim().toLowerCase();
        const slug = k ? slugBySku.get(k) : undefined;
        if (!slug) continue;
        qty.set(slug, (qty.get(slug) ?? 0) + (Number(it.qty) || 0));
      }
    }
    const top = [...qty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([slug]) => slug);
    await db.from("web_content").upsert({ key: "best_sellers", value: top, updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch {
    /* best-effort */
  }
}
