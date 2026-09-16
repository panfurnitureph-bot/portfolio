// Ang storefront content ay nasa Supabase na (PAN app migration 0128) para
// mapamahalaan ito mula sa IMS. Dito kinukuha; ang content/*.json ay nananatili
// bilang fallback kapag hindi maabot ang Supabase, kaya hindi kailanman blangko
// ang site.
//
// SERVER-ONLY. Ang mga page ay tumatawag ng loadContent() at ipinapasa ang
// resulta sa mga component bilang props — walang client component na kumukuha
// nito nang mag-isa.

import productsJson from "@/content/products.json";
import siteJson from "@/content/site.json";
import homepageJson from "@/content/homepage.json";
import swatchesJson from "@/content/swatch-library.json";
import { primeContent, type Product, type SiteContent, type HomepageContent, type LibrarySwatch } from "./products";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type StoreContent = {
  products: Product[];
  site: SiteContent;
  homepage: HomepageContent;
  swatches: LibrarySwatch[];
  bestSellers: string[];
};

// Ang naka-bundle na JSON — ito ang ibinabalik kapag walang Supabase.
const FALLBACK: StoreContent = {
  products: productsJson as Product[],
  site: siteJson as SiteContent,
  homepage: homepageJson as HomepageContent,
  swatches: swatchesJson as LibrarySwatch[],
  bestSellers: [],
};

async function rest<T>(path: string): Promise<T | null> {
  if (!URL_ || !KEY) return null;
  try {
    const res = await fetch(`${URL_}/rest/v1/${path}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      // Ang ISR ang humahawak ng caching (revalidate sa page), hindi dito.
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Kunin ang lahat ng content nang sabay. Bawat bahagi ay may sariling fallback,
// kaya ang pagkabigo ng isa ay hindi nagpapabagsak ng iba.
export async function loadStoreContent(): Promise<StoreContent> {
  const [prodRows, swatchRows, docRows] = await Promise.all([
    rest<{ data: Product }[]>("web_products?select=data&order=slug&limit=2000"),
    rest<{ data: LibrarySwatch }[]>("web_swatches?select=data&order=name&limit=2000"),
    rest<{ key: string; value: unknown }[]>("web_content?select=key,value"),
  ]);

  const docs = new Map((docRows ?? []).map((r) => [r.key, r.value]));

  return {
    products: prodRows?.length ? prodRows.map((r) => r.data) : FALLBACK.products,
    // PUBLISHED LANG SA SITE (2026-09-06): ang tela na naka-unpublish sa IMS Fabric
    // Upholstered (`published: false`) ay hindi lumalabas sa homepage rail,
    // fabric popup, at product fabric picker. Walang flag = published.
    swatches: swatchRows?.length
      ? swatchRows.map((r) => r.data).filter((sw) => (sw as { published?: boolean }).published !== false)
      : FALLBACK.swatches,
    site: (docs.get("site") as SiteContent) ?? FALLBACK.site,
    // Isinasanib sa bundled JSON (2026-09-04): ang bagong homepage keys (trust
    // bar, promo beds, MTO, showrooms…) ay may default kahit hindi pa na-save
    // sa IMS ang dokumento.
    homepage: { ...FALLBACK.homepage, ...((docs.get("homepage") as Partial<HomepageContent> | undefined) ?? {}) } as HomepageContent,
    // BEST SELLERS (2026-09-04): awtomatiko mula sa IMS orders (top slugs ng
    // huling 90 araw, isinusulat ng IMS sa web_content.best_sellers).
    bestSellers: Array.isArray(docs.get("best_sellers")) ? (docs.get("best_sellers") as string[]) : [],
  };
}

// Ito ang tinatawag ng bawat storefront page bago mag-render: kinukuha ang
// content at ipinapasok sa lib/products, kaya ang mga synchronous na export
// doon ay naglalaman na ng galing-Supabase pagdating sa mga component.
export async function primeStoreContent(): Promise<StoreContent> {
  const content = await loadStoreContent();
  primeContent(content);
  return content;
}

// ---------- Made-to-Order Configurator (PAN app: Website → MTO Configurator) ----------
// Per-item config mula sa website_item_config (IMS migration 0168), naka-link
// sa product via SKU. Published lang ang ginagamit; draft o walang config =
// dating product page ang nire-render.
export type MtoSize = { label: string; price: number | null; on: boolean };
export type MtoAddon = {
  label: string;
  type: "ADD-ON" | "CHOICE" | "FIELD" | "FIXED";
  price: number | null;
  // CHOICE lang: presyo KADA pagpipilian, naka-index sa pagkakasunod ng
  // "A/B/C" sa label. Kapag wala, ang `price` ang para sa lahat.
  prices?: (number | null)[];
  on: boolean;
};
export type MtoMeasure = { label: string; def: number | null; unit: string; on: boolean };
export type MtoItemConfig = {
  sku: string;
  category: string;
  name: string;
  customizable: boolean;
  published: boolean;
  sizes: MtoSize[];
  measurements?: MtoMeasure[];
  addons: MtoAddon[];
  fabricsOff: string[];
  // FABRICS TOGGLE (IMS 2026-08-23): false = walang Fabric field; fabricsPick =
  // allow-list. Wala pareho = legacy (lahat maliban sa fabricsOff).
  fabricsOn?: boolean;
  fabricsPick?: string[];
};

export async function loadItemConfig(sku: string | undefined | null): Promise<MtoItemConfig | null> {
  if (!sku?.trim()) return null;
  const rows = await rest<{ data: MtoItemConfig }[]>(
    `website_item_config?select=data&sku=eq.${encodeURIComponent(sku.trim())}&limit=1`,
  );
  const cfg = rows?.[0]?.data ?? null;
  return cfg?.published ? cfg : null;
}
