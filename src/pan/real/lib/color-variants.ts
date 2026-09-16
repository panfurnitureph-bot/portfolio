// COLOR VARIANTS (0231, 2026-09-03) — tela mula sa library na pinili sa Add/Edit
// Product, bawat isa may sariling hanay ng litrato. Ito ang pinagmumulan ng
// `colors` / `colorSwatches` ng listing sa website: kulay ang thumbs ng card,
// at kapag pinili ang kulay sa product page ay nagpapalit ang buong gallery.
// Shared ng server actions at ng client forms — walang server-only import dito.

export type ColorVariant = {
  name: string;      // pangalan ng tela sa library, hal. "Leather BE20357"
  swatch?: string;   // tile ng tela (URL) — thumb ng kulay sa card
  color?: string;    // hex fallback kapag walang swatch photo
  images: string[];  // litrato ng produkto sa kulay na ito (unang isa = hero)
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// Linisin ang galing sa form/DB: buong pangalan lang, string URLs lang.
export function cleanVariants(raw: unknown): ColorVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: ColorVariant[] = [];
  const seen = new Set<string>();
  for (const v of raw as Record<string, unknown>[]) {
    const name = str(v?.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const images = Array.isArray(v?.images) ? (v.images as unknown[]).map(str).filter(Boolean) : [];
    const cv: ColorVariant = { name, images };
    if (str(v?.swatch)) cv.swatch = str(v.swatch);
    if (str(v?.color)) cv.color = str(v.color);
    out.push(cv);
  }
  return out;
}

// Mga field ng listing (web_products.data) na hango sa variants. Walang
// variant = blangkong colors — lahat ng litrato ang thumbs ng card (dati).
export type WebColorSwatch = { name: string; swatch?: string; image?: string; hex?: string; images?: string[]; stock?: number };

export function webColorFields(variants: ColorVariant[]): { colors: string[]; colorSwatches: WebColorSwatch[] } {
  const v = cleanVariants(variants);
  return {
    colors: v.map((x) => x.name),
    colorSwatches: v.map((x) => ({
      name: x.name,
      ...(x.swatch ? { swatch: x.swatch } : {}),
      ...(x.color ? { hex: x.color } : {}),
      ...(x.images[0] ? { image: x.images[0] } : {}),
      ...(x.images.length ? { images: x.images } : {}),
    })),
  };
}
