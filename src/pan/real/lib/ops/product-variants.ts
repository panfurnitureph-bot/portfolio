import type { createServerSupabase } from "@/lib/supabase/server";
import { cleanVariants, type ColorVariant } from "@/lib/color-variants";
import { colorLabelOfDesc } from "@/lib/orders/line-key";

// LITRATO KADA KULAY SA MGA PILA (Joe 2026-09-06, "magkaiba ung leather dapat
// maiiba ung picture"). Ang product.image_url ay ang hero ng produkto — iisa
// kahit anong kulay. Ang product.color_variants (0231) ay may sariling hanay ng
// litrato kada tela; ang unang litrato ng tugmang tela ang ipinapakita ng
// Orders to Pack / Workshop (IN) / To Assign / workshop jobs. Walang tugma o
// walang variant = hero pa rin, gaya ng dati.

type Db = ReturnType<typeof createServerSupabase>;

export type VariantIndex = Map<string, ColorVariant[]>; // key = product_name (normalized) o sku (lowercase)

const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// Hiwalay na query na may sariling fallback: kapag wala pa ang 0231 (walang
// color_variants column) ay blangkong index — hindi namamatay ang buong pila.
export async function loadVariantIndex(db: Db): Promise<VariantIndex> {
  const idx: VariantIndex = new Map();
  try {
    const { data, error } = await db.from("product").select("sku, product_name, color_variants").limit(5000);
    if (error || !data) return idx;
    for (const p of data as { sku: string | null; product_name: string | null; color_variants: unknown }[]) {
      const v = cleanVariants(p.color_variants);
      if (!v.length) continue;
      const byName = norm(p.product_name);
      if (byName && !idx.has(byName)) idx.set(byName, v);
      const bySku = norm(p.sku);
      if (bySku && !idx.has(`sku:${bySku}`)) idx.set(`sku:${bySku}`, v);
    }
  } catch { /* wala pang 0231 */ }
  return idx;
}

// Unang litrato ng telang tumutugma sa kulay ng linya. Eksakto muna
// ("Leather BE20457" = "Leather BE20457"); saka ang isa'y nasa loob ng isa
// (linya "BE20457" sa variant "Leather BE20457", o baligtad).
export function imageForColor(variants: ColorVariant[] | undefined, color: string | null | undefined): string | null {
  if (!variants?.length) return null;
  const c = norm(color);
  if (!c) return null;
  const withImg = variants.filter((v) => v.images[0]);
  const exact = withImg.find((v) => norm(v.name) === c);
  if (exact) return exact.images[0];
  const partial = withImg.find((v) => { const n = norm(v.name); return n.includes(c) || c.includes(n); });
  return partial?.images[0] ?? null;
}

// ISANG TAWAG, MARAMING LINYA (Joe 2026-09-06, "rework, refund di nasunod ung
// mga image pero tama ung sku"): ikinakarga nang isang beses ang index, saka
// bawat item ay `photo(pangalan, sku, kulay, description, pambalik)` — kulay
// mula sa ibinigay o sa "Fabric:" bullet ng description; pambalik ang hero.
export type ColorPhotoFn = (name: string | null | undefined, sku: string | null | undefined, color: string | null | undefined, desc?: string | null, fallback?: string | null) => string | null;

export async function makeColorPhoto(db: Db): Promise<ColorPhotoFn> {
  const idx = await loadVariantIndex(db);
  return (name, sku, color, desc, fallback) => {
    const c = String(color ?? "").trim() || colorLabelOfDesc(desc);
    if (!c) return fallback ?? null;
    return imageForColor(variantsFor(idx, String(name ?? "").replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, ""), sku), c) ?? fallback ?? null;
  };
}

export function variantsFor(idx: VariantIndex, productName: string | null | undefined, sku?: string | null): ColorVariant[] | undefined {
  const bySku = norm(sku);
  return (bySku ? idx.get(`sku:${bySku}`) : undefined) ?? idx.get(norm(productName));
}
