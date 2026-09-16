import productsData from "@/content/products.json";
import siteData from "@/content/site.json";
import homepageData from "@/content/homepage.json";
import swatchLibraryData from "@/content/swatch-library.json";

// ---------- Types ----------
export type Review = {
  author: string;
  rating: number;
  text: string;
  date?: string;
  verified?: boolean;
  helpful?: number;
  photos?: string[];
};

// Isang variant/kulay: pangalan, material, swatch photo (close-up ng
// tela), at main photo na ipapakita sa gallery kapag napili
export type ColorSwatch = {
  name: string;
  material?: string;
  swatch?: string; // close-up ng tela (para sa swatch circle + hover)
  image?: string; // buong product photo sa kulay na ito
  hex?: string; // opsyonal na kulay (ginagamit ng recolor kung walang swatch)
  // LITRATO KADA KULAY (IMS 0231, 2026-09-03): kapag may laman, ito ang buong
  // gallery ng product page habang napili ang kulay na ito.
  images?: string[];
  // STOCK KADA KULAY (IMS 0232): available na yari na unit sa kulay na ito.
  stock?: number;
};

export type Product = {
  slug: string;
  name: string;
  price: number;
  compareAtPrice: number | null;
  priceFrom?: number | null;
  category: string;
  // Galing sa IMS publish (2026-08-23): pangalan ng category sa IMS at mga
  // nav group nito — dito hinahango ng site ang collections/nav/tiles.
  categoryTitle?: string;
  categoryGroups?: string[];
  categoryListed?: boolean; // false = may page pero wala sa nav/tiles/footer (hal. Wall Padding)
  sku?: string; // internal lang — hindi ipinapakita sa customer
  stock?: number; // 0 = Out of stock sa product page
  colors: string[];
  colorSwatches?: ColorSwatch[]; // mas detalyadong variant info
  // Dimensions tab: mga sukat (label → value) + diagram image
  dimensionSpecs?: { label: string; value: string }[];
  dimensionImage?: string;
  // Per-size na sukat + presyo (para sa beds) — bawat size may sariling
  // measurements at presyo. Kung wala, standard table + size adjustments.
  bedSizes?: {
    size: string;
    dim: string;
    A: string;
    B: string;
    C: string;
    D: string;
    E: string;
    price?: number; // presyo ng size na ito (override sa base price)
    enabled?: boolean; // false = itago ang size na ito
  }[];
  // Add-ons (hal. wall padding, headboard) — opsyonal, may sariling presyo.
  // Kapag pinili ng customer, idadagdag sa total at sa cart variant.
  //
  // PER-SIZE: kung may `bySize`, ang sukat at presyo ay nakadepende sa
  // napiling bed size (Single/Twin/.../King 2). Ang `detail`/`price` sa
  // itaas ang fallback kung walang entry para sa napiling size.
  addOns?: {
    id: string;
    label: string; // hal. "Uratex Comfort Plus"
    detail?: string; // fallback na sukat/detalye
    price: number; // fallback na presyo
    // Pangkat sa product page (hal. "Mattress", "Wall Padding").
    // Kung wala, "Add-ons" ang default na heading.
    group?: string;
    // Kung may priceMax: RANGE ang presyo (hal. ₱5,000–₱8,000).
    // Hindi idinadagdag sa total — kinukumpirma sa order.
    priceMax?: number;
    // Kung may perUnit: kinakalkula per dami (hal. ₱1,500/ft × 2 ft).
    perUnit?: string; // hal. "ft"
    bySize?: Record<string, { detail?: string; price: number }>;
  }[];
  images: string[];
  description: string;
  dimensions: string;
  materials: string;
  care: string;
  featured: boolean;
  isNew: boolean;
  reviews: Review[];
};

// MENU IMAGES (2026-08-26): larawan sa kanan ng mega-menu, kada top menu
// ("beds" | "sofas" | "dining" | "living"), pinamamahalaan sa PAN app
// (Website > Promo & Site > Menu Images). Hindi kasama sa content/site.json —
// opsyonal ito at galing sa Supabase, kaya nakadagdag sa tipo.
export type SiteContent = typeof siteData & { menuImages?: Record<string, string> };

// WHATSAPP / VIBER / PANGALAWANG EMAIL (Joe 2026-09-12): mula sa site.contact
// ng IMS (Website Content › Site › Contact); kapag wala pa ang susi sa naka-save
// na content, ang default ng site.json ang gamit. Blangko = itinatago.
export function contactLinks(site: SiteContent) {
  const c = site.contact as { whatsapp?: string; viber?: string; email2?: string };
  const d = siteData.contact as { whatsapp?: string; viber?: string; email2?: string };
  const wa = (c.whatsapp ?? d.whatsapp ?? "").trim();
  const vb = (c.viber ?? d.viber ?? "").trim();
  const e2 = (c.email2 ?? d.email2 ?? "").trim();
  // 09XX… → 639XX… para sa wa.me / viber; ang ipinapakita ay 0962 120 7730.
  const intl = (n: string) => { const g = n.replace(/\D/g, ""); return g.startsWith("0") ? "63" + g.slice(1) : g; };
  const pretty = (n: string) => { const g = n.replace(/\D/g, ""); return g.length === 11 ? `${g.slice(0, 4)} ${g.slice(4, 7)} ${g.slice(7)}` : n; };
  return {
    whatsapp: wa ? pretty(wa) : "", whatsappHref: wa ? `https://wa.me/${intl(wa)}` : "",
    viber: vb ? pretty(vb) : "", viberHref: vb ? `viber://chat?number=%2B${intl(vb)}` : "",
    email2: e2,
  };
}
export type HomepageContent = typeof homepageData;

// ---------- Swatch library (name -> texture image + hex) ----------
export type LibrarySwatch = {
  name: string;
  material?: string;
  color?: string; // hex
  swatch?: string; // /images/swatches/library/...
};
export let swatchLibrary: LibrarySwatch[] = swatchLibraryData as LibrarySwatch[];

// Mabilis na lookup: swatch name (lowercase) -> library entry
let swatchByName = new Map(
  swatchLibrary.map((s) => [s.name.toLowerCase(), s])
);
export function findSwatch(name: string): LibrarySwatch | undefined {
  return swatchByName.get(name.toLowerCase());
}

// ---------- Data ----------
// Ang content ay nasa Supabase na (pinamamahalaan mula sa PAN app), pero ang
// mga export dito ay kailangang manatiling SYNCHRONOUS — 24 client component
// ang umaasa sa kanila at hindi sila makaka-await.
//
// Kaya: ang naka-bundle na JSON ang laman sa simula, at pinupunan ito ng
// primeContent() mula sa server bago mag-render ang page. Sabay ding napupunan
// ang mga helper sa ibaba (getProduct, collectionProducts …) dahil sa listahang
// ito rin sila tumitingin.
export let products: Product[] = productsData as Product[];
export let site: SiteContent = siteData;
export let homepage: HomepageContent = homepageData;

// Tinatawag ng server components (tingnan ang lib/content.ts) bago mag-render.
// Kapag hindi maabot ang Supabase, hindi ito napupunan at nananatili ang JSON.
export function primeContent(next: {
  products?: Product[];
  site?: SiteContent;
  homepage?: HomepageContent;
  swatches?: LibrarySwatch[];
}): void {
  if (next.products?.length) {
    products = next.products;
    syncCategoriesFromProducts(products);
  }
  if (next.site) site = next.site;
  if (next.homepage) homepage = next.homepage;
  if (next.swatches?.length) {
    swatchLibrary = next.swatches;
    swatchByName = new Map(swatchLibrary.map((s) => [s.name.toLowerCase(), s]));
  }
}

// ---------- Collections ----------
// Ang 13 opisyal na categories ng PAN Furniture + mga grupo para sa nav.
// Magdagdag dito kung may bago kang category.
export const COLLECTIONS: Record<string, { title: string; categories: string[] }> = {
  "new-in": { title: "New In", categories: [] }, // special: lahat ng isNew
  // "new-*" = mga BAGONG items lang ng grupong yun (isNew filter)
  "new-beds": { title: "New Beds", categories: ["bed", "sofa-bed", "mattress", "customized-bed"] },
  "new-sofas": { title: "New Sofas", categories: ["sofa", "sofa-bed", "accent-chair"] },
  "new-dining": {
    title: "New Dining",
    categories: ["dining-table", "dining-chairs", "dining-set", "barstool"],
  },
  "new-living": {
    title: "New Living",
    categories: ["accent-chair", "side-table", "ottoman-ph", "swivel-chair"],
  },
  // --- Grupo (para sa top nav) ---
  beds: { title: "Beds", categories: ["bed", "sofa-bed", "mattress", "customized-bed"] },
  sofas: { title: "Sofas", categories: ["sofa", "sofa-bed", "accent-chair"] },
  dining: {
    title: "Dining",
    categories: ["dining-table", "dining-chairs", "dining-set", "barstool"],
  },
  living: {
    title: "Living",
    // DECOR (2026-09-12): figurines, mugs, lamp, vase — sa Living din.
    // SOFA ay Sofas lang (Joe 2026-09-12) — tanggal sa Living.
    categories: ["accent-chair", "side-table", "ottoman-ph", "swivel-chair", "collective-figurines", "mugs", "lamp", "vase"],
  },
  // --- Opisyal na categories — PAREHONG PANGALAN ng IMS MTO categories
  //     (lib/categories.ts sa IMS); ang slug ay URL lang, hindi binabago. ---
  bed: { title: "Promo Bed", categories: ["bed"] },
  "sofa-bed": { title: "Sofa Bed", categories: ["sofa-bed"] },
  sofa: { title: "Sofa", categories: ["sofa"] },
  "dining-table": { title: "Dining Table", categories: ["dining-table"] },
  "dining-chairs": { title: "Dining Chair", categories: ["dining-chairs"] },
  "dining-set": { title: "Dining Set", categories: ["dining-set"] },
  "side-table": { title: "Side Table", categories: ["side-table"] },
  "ottoman-ph": { title: "Ottoman", categories: ["ottoman-ph"] },
  mattress: { title: "Mattress", categories: ["mattress"] },
  "customized-bed": { title: "Custom Bed", categories: ["customized-bed"] },
  "accent-chair": { title: "Accent Chair", categories: ["accent-chair"] },
  // MTO categories ng IMS Configurator (2026-08-23) — pareho ng SITE_CATEGORY
  // sa IMS publish, kaya ang na-publish doon ay lumalabas dito agad.
  barstool: { title: "Barstool", categories: ["barstool"] },
  "swivel-chair": { title: "Swivel Chair", categories: ["swivel-chair"] },
  // DECOR (IMS 2026-09-12): Height / Length / Width lang ang sukat.
  decoration: { title: "Decoration", categories: ["collective-figurines", "mugs", "lamp", "vase"] },
  "collective-figurines": { title: "Collective Figurines", categories: ["collective-figurines"] },
  mugs: { title: "Mugs", categories: ["mugs"] },
  lamp: { title: "Lamp", categories: ["lamp"] },
  vase: { title: "Vase", categories: ["vase"] },
};

// Main nav — may children = lalabas na mega-menu sa hover
export type NavChild = { label: string; href: string };
export type NavLink = { label: string; href: string; children?: NavChild[] };

// NAV (2026-09-04): Beds · Sofas · Dining · Living lang — tanggal ang "New In"
// (nasa homepage na ang bago bilang badge, at kakaunti pa ang catalog).
// PROMO BED sa unahan (Joe 2026-09-12): direktang link, walang dropdown.
export const NAV_LINKS: NavLink[] = [
  { label: "Promo Bed", href: "/collections/bed" },
  {
    label: "Beds",
    href: "/collections/beds",
    children: [
      { label: "All Beds", href: "/collections/beds" },
      { label: "Promo Bed", href: "/collections/bed" },
      { label: "Sofa Bed", href: "/collections/sofa-bed" },
      { label: "Mattress", href: "/collections/mattress" },
      { label: "Custom Bed", href: "/collections/customized-bed" },
    ],
  },
  {
    label: "Sofas",
    href: "/collections/sofas",
    children: [
      { label: "All Sofas", href: "/collections/sofas" },
      { label: "Sofa", href: "/collections/sofa" },
      { label: "Sofa Bed", href: "/collections/sofa-bed" },
      { label: "Accent Chair", href: "/collections/accent-chair" },
    ],
  },
  {
    label: "Dining",
    href: "/collections/dining",
    children: [
      { label: "All Dining", href: "/collections/dining" },
      { label: "Dining Table", href: "/collections/dining-table" },
      { label: "Dining Chair", href: "/collections/dining-chairs" },
      { label: "Dining Set", href: "/collections/dining-set" },
      { label: "Barstool", href: "/collections/barstool" },
    ],
  },
  {
    label: "Living",
    href: "/collections/living",
    children: [
      { label: "All Living", href: "/collections/living" },
      { label: "Side Table", href: "/collections/side-table" },
      { label: "Ottoman", href: "/collections/ottoman-ph" },
      { label: "Accent Chair", href: "/collections/accent-chair" },
      { label: "Swivel Chair", href: "/collections/swivel-chair" },
      // DECORATION (Joe 2026-09-12): isang entry para sa figurines, mugs,
      // lamp at vase — /collections/decoration ang lahat ng ito.
      { label: "Decoration", href: "/collections/decoration" },
    ],
  },
];

// 13 tiles ng "Shop by Category" sa homepage
export const CATEGORY_TILES = [
  { label: "Promo Bed", slug: "bed" },
  { label: "Sofa Bed", slug: "sofa-bed" },
  { label: "Sofa", slug: "sofa" },
  { label: "Dining Table", slug: "dining-table" },
  { label: "Dining Chair", slug: "dining-chairs" },
  { label: "Dining Set", slug: "dining-set" },
  { label: "Side Table", slug: "side-table" },
  { label: "Ottoman", slug: "ottoman-ph" },
  { label: "Mattress", slug: "mattress" },
  { label: "Custom Bed", slug: "customized-bed" },
  { label: "Accent Chair", slug: "accent-chair" },
  { label: "Barstool", slug: "barstool" },
  { label: "Swivel Chair", slug: "swivel-chair" },
];

// ---------- Categories follow the IMS ----------
// ANG IMS ANG PINAGMUMULAN NG CATEGORIES. Bawat published product ay may
// `category` (slug), `categoryTitle` (pangalan sa IMS) at `categoryGroups`
// (beds/sofas/dining/living). Dito idinadagdag/ina-update ang collection,
// ang nav children ng group, at ang homepage tile — kaya ang i-publish sa MTO
// Configurator ay agad may lugar sa site nang walang code change. Idempotent:
// tinatawag kada primeContent().
// Mga category na nasa ilalim ng "Decoration" sa nav (Living group).
export const DECOR_CATEGORIES = ["collective-figurines", "mugs", "lamp", "vase"];
export function syncCategoriesFromProducts(list: Product[]): void {
  for (const p of list) {
    const slug = (p.category ?? "").trim();
    if (!slug) continue;
    const title = (p.categoryTitle ?? "").trim() || COLLECTIONS[slug]?.title || slug.replace(/-/g, " ");
    // 1) sariling collection ng category
    if (!COLLECTIONS[slug]) COLLECTIONS[slug] = { title, categories: [slug] };
    else if (p.categoryTitle && COLLECTIONS[slug].title !== title) COLLECTIONS[slug].title = title;
    // Hindi nakalista (IMS: listed=false) → may /collections/<slug> pa rin,
    // pero wala sa nav, tiles at footer.
    if (p.categoryListed === false) continue;
    // 2) mga group (Beds/Sofas/Dining/Living + New *)
    for (const g of p.categoryGroups ?? []) {
      const grp = COLLECTIONS[g];
      if (!grp) continue;
      if (!grp.categories.includes(slug)) grp.categories.push(slug);
      const newGrp = COLLECTIONS["new-" + g];
      if (newGrp && !newGrp.categories.includes(slug)) newGrp.categories.push(slug);
      // Ang decor ay nasa iisang "Decoration" na nav entry — huwag idagdag
      // bilang sariling child (pero kasama pa rin sa group at sa tiles).
      if (DECOR_CATEGORIES.includes(slug)) { const dec = COLLECTIONS.decoration; if (dec && !dec.categories.includes(slug)) dec.categories.push(slug); continue; }
      const nav = NAV_LINKS.find((l) => l.href === "/collections/" + g);
      if (nav?.children) {
        const href = "/collections/" + slug;
        const child = nav.children.find((c) => c.href === href);
        if (!child) nav.children.push({ label: title, href });
        else if (child.label !== title) child.label = title;
      }
    }
    // 3) homepage tile
    const tile = CATEGORY_TILES.find((t) => t.slug === slug);
    if (!tile) CATEGORY_TILES.push({ label: title, slug });
    else if (tile.label !== title) tile.label = title;
  }
}

// Footer "SHOP" links — lahat ng opisyal na category (isang slug bawat isa),
// sa pagkakasunod ng tiles, para pareho ng nav at ng IMS.
export function shopLinks(): { label: string; href: string }[] {
  return CATEGORY_TILES.map((t) => ({ label: t.label, href: "/collections/" + t.slug }));
}

// ---------- Helpers ----------
// Pangalan ng category para ipakita — PAREHO ng IMS (Promo Bed, Custom Bed,
// Dining Chair, Ottoman…). Ang slug ay URL lang.
export function categoryTitle(slug: string): string {
  return COLLECTIONS[slug]?.title ?? slug.replace(/-/g, " ");
}

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export function getCollectionProducts(collectionSlug: string): Product[] {
  const collection = COLLECTIONS[collectionSlug];
  if (!collection) return [];
  if (collectionSlug === "new-in") return products.filter((p) => p.isNew);
  // "new-*" collections = mga BAGONG items lang ng grupong yun
  if (collectionSlug.startsWith("new-")) {
    return products.filter(
      (p) => p.isNew && collection.categories.includes(p.category)
    );
  }
  return products.filter((p) => collection.categories.includes(p.category));
}

export function getRelatedProducts(product: Product, limit = 4): Product[] {
  const sameCategory = products.filter(
    (p) => p.category === product.category && p.slug !== product.slug
  );
  const others = products.filter(
    (p) => p.category !== product.category && p.slug !== product.slug
  );
  return [...sameCategory, ...others].slice(0, limit);
}

export function searchProducts(query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return products.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.materials.toLowerCase().includes(q)
  );
}

export function averageRating(p: Product): number | null {
  if (!p.reviews.length) return null;
  return p.reviews.reduce((sum, r) => sum + r.rating, 0) / p.reviews.length;
}

export function formatPrice(n: number): string {
  return `₱${n.toLocaleString("en-PH")}`;
}

// Hanapin ang product — EXACT slug muna, saka prefix match
// (iwas collision: ang "bed-1" ay hindi dapat tumama sa "bed-13")
export function findByPrefix(prefix: string): Product | undefined {
  return (
    products.find((p) => p.slug === prefix) ??
    products.find((p) => p.slug.startsWith(prefix))
  );
}

// Photo para sa "Shop by category" tile — kukunin ang unang product
// ng category na may photo (auto-update kapag nagbago ang products).
// Fallback sa naka-save na /images/category-<slug>.jpg kung wala.
export function categoryTileImage(slug: string): string {
  const inCat = products.find(
    (p) => (COLLECTIONS[slug]?.categories ?? [slug]).includes(p.category) && p.images.length > 0
  );
  return inCat?.images[0] ?? `/store/images/category-${slug}.jpg`;
}

export function findManyByPrefix(prefixes: string[]): Product[] {
  const seen = new Set<string>();
  const result: Product[] = [];
  for (const pre of prefixes) {
    const p = findByPrefix(pre);
    if (p && !seen.has(p.slug)) {
      seen.add(p.slug);
      result.push(p);
    }
  }
  return result;
}
