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
};

// Ang naka-bundle na JSON — ito ang ibinabalik kapag walang Supabase.
const FALLBACK: StoreContent = {
  products: productsJson as Product[],
  site: siteJson as SiteContent,
  homepage: homepageJson as HomepageContent,
  swatches: swatchesJson as LibrarySwatch[],
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
    swatches: swatchRows?.length ? swatchRows.map((r) => r.data) : FALLBACK.swatches,
    site: (docs.get("site") as SiteContent) ?? FALLBACK.site,
    homepage: (docs.get("homepage") as HomepageContent) ?? FALLBACK.homepage,
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
