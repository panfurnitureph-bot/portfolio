import type { createServerSupabase } from "@/lib/supabase/server";

// STOCK NG WEBSITE = STOCK NG INVENTORY, KADA KULAY (Joe 2026-09-06, "eto ba sa
// website natin is per color ung instock units?"). Ang web_products.data ay
// may dalawang bilang na binabasa ng storefront: `stock` (kabuuan ng SKU —
// pambalik at listing badge) at `colorSwatches[].stock` (kada kulay — ang
// napiling tela ang masusunod sa "In stock · N units"; ubos = Made to order).
//
// Dati: ang `stock` ay isinusulat lang ng Configurator publish, at ang
// per-kulay ay nabubura ng Product save (webColorFields ay walang stock) — kaya
// ang site ay nagpapakita ng lumang kabuuan sa lahat ng kulay. Ngayon: isang
// sync na tinatawag sa bawat galaw ng inventory (reserve/resync, ship,
// receive, add/edit/delete row) at sa bawat pagsusulat ng listing.
//
// Best-effort at tahimik: hindi kailanman nagpapabagsak ng tumatawag.

type SB = ReturnType<typeof createServerSupabase>;
type Swatch = { name?: unknown; stock?: unknown } & Record<string, unknown>;

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export type WebStockPatch = { stock: number; colorSwatches?: Swatch[] };

// Purong kuwenta — nasusubok nang walang DB.
export function computeWebStock(
  data: Record<string, unknown>,
  rows: { sku: string | null; color: string | null; available: number | null }[],
): WebStockPatch | null {
  const sku = norm(data.sku);
  if (!sku) return null;
  const mine = rows.filter((r) => norm(r.sku) === sku);
  const total = mine.reduce((s, r) => s + Math.max(Number(r.available) || 0, 0), 0);
  const patch: WebStockPatch = { stock: total };
  const swatches = Array.isArray(data.colorSwatches) ? (data.colorSwatches as Swatch[]) : null;
  if (swatches?.length) {
    // Kada kulay LANG kapag may inventory row na may kulay ang SKU; ang lumang
    // SKU na iisang row na walang kulay ay bumabagsak sa kabuuan (walang
    // `stock` sa swatch), hindi sa 0 sa lahat ng kulay.
    const colored = mine.filter((r) => norm(r.color));
    if (colored.length) {
      const byColor = new Map<string, number>();
      for (const r of colored) byColor.set(norm(r.color), (byColor.get(norm(r.color)) ?? 0) + Math.max(Number(r.available) || 0, 0));
      patch.colorSwatches = swatches.map((s) => ({ ...s, stock: byColor.get(norm(s.name)) ?? 0 }));
    } else {
      patch.colorSwatches = swatches.map((s) => { const { stock: _drop, ...rest } = s; void _drop; return rest; });
    }
  }
  return patch;
}

const sameStock = (data: Record<string, unknown>, p: WebStockPatch): boolean => {
  if (Number(data.stock ?? -1) !== p.stock) return false;
  if (!p.colorSwatches) return true;
  const cur = Array.isArray(data.colorSwatches) ? (data.colorSwatches as Swatch[]) : [];
  if (cur.length !== p.colorSwatches.length) return false;
  return cur.every((s, i) => (s.stock === undefined ? undefined : Number(s.stock)) === (p.colorSwatches![i].stock === undefined ? undefined : Number(p.colorSwatches![i].stock)));
};

// Isulat sa web_products ang stock ng mga SKU (lahat kapag walang ibinigay).
export async function syncWebStock(db: SB, skus?: (string | null | undefined)[] | null): Promise<void> {
  try {
    const want = skus ? new Set(skus.map(norm).filter(Boolean)) : null;
    if (want && !want.size) return;
    const [{ data: web }, { data: inv }] = await Promise.all([
      db.from("web_products").select("slug, data").limit(5000),
      db.from("inventory").select("sku, color, available").limit(20000),
    ]);
    const rows = (inv ?? []) as { sku: string | null; color: string | null; available: number | null }[];
    for (const w of (web ?? []) as { slug: string; data: Record<string, unknown> | null }[]) {
      const data = w.data ?? {};
      if (want && !want.has(norm(data.sku))) continue;
      const patch = computeWebStock(data, rows);
      if (!patch || sameStock(data, patch)) continue;
      const next = { ...data, stock: patch.stock, ...(patch.colorSwatches ? { colorSwatches: patch.colorSwatches } : {}) };
      await db.from("web_products").update({ data: next, updated_at: new Date().toISOString() }).eq("slug", w.slug);
    }
  } catch { /* best-effort — hindi dapat pigilan ang galaw ng stock */ }
}

// Sync ng SKU ng isang inventory row (id lang ang hawak ng tumatawag).
export async function syncWebStockForRow(db: SB, inventoryId: number): Promise<void> {
  try {
    const { data } = await db.from("inventory").select("sku").eq("id", inventoryId).maybeSingle();
    if (data?.sku) await syncWebStock(db, [String(data.sku)]);
  } catch { /* best-effort */ }
}
