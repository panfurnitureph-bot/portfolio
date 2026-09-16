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
};

export type Product = {
  slug: string;
  name: string;
  price: number;
  compareAtPrice: number | null;
  priceFrom?: number | null;
  category: string;
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

export type SiteContent = typeof siteData;
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
  if (next.products?.length) products = next.products;
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
    categories: ["dining-table", "dining-chairs", "dining-set"],
  },
  "new-living": {
    title: "New Living",
    categories: ["sofa", "accent-chair", "side-table", "ottoman-ph", "kurtina-ni-pan"],
  },
  // --- Grupo (para sa top nav) ---
  beds: { title: "Beds", categories: ["bed", "sofa-bed", "mattress", "customized-bed"] },
  sofas: { title: "Sofas", categories: ["sofa", "sofa-bed", "accent-chair"] },
  dining: {
    title: "Dining",
    categories: ["dining-table", "dining-chairs", "dining-set"],
  },
  living: {
    title: "Living",
    categories: ["sofa", "accent-chair", "side-table", "ottoman-ph", "kurtina-ni-pan"],
  },
  // --- 13 opisyal na categories ---
  bed: { title: "Bed", categories: ["bed"] },
  "sofa-bed": { title: "Sofa Bed", categories: ["sofa-bed"] },
  sofa: { title: "Sofa", categories: ["sofa"] },
  "dining-table": { title: "Dining Table", categories: ["dining-table"] },
  "dining-chairs": { title: "Dining Chairs", categories: ["dining-chairs"] },
  "dining-set": { title: "Dining Set", categories: ["dining-set"] },
  "side-table": { title: "Side Table", categories: ["side-table"] },
  "ottoman-ph": { title: "Ottoman PH", categories: ["ottoman-ph"] },
  "kurtina-ni-pan": { title: "Kurtina ni PAN", categories: ["kurtina-ni-pan"] },
  mattress: { title: "Mattress", categories: ["mattress"] },
  "customized-bed": { title: "Customized Bed", categories: ["customized-bed"] },
  "accent-chair": { title: "Accent Chair", categories: ["accent-chair"] },
};

// Main nav — may children = lalabas na mega-menu sa hover
export type NavChild = { label: string; href: string };
export type NavLink = { label: string; href: string; children?: NavChild[] };

export const NAV_LINKS: NavLink[] = [
  {
    label: "New In",
    href: "/collections/new-in",
    children: [
      { label: "All New Arrivals", href: "/collections/new-in" },
      { label: "New Beds", href: "/collections/new-beds" },
      { label: "New Sofas", href: "/collections/new-sofas" },
      { label: "New Dining", href: "/collections/new-dining" },
      { label: "New Living", href: "/collections/new-living" },
    ],
  },
  {
    label: "Beds",
    href: "/collections/beds",
    children: [
      { label: "All Beds", href: "/collections/beds" },
      { label: "Bed", href: "/collections/bed" },
      { label: "Sofa Bed", href: "/collections/sofa-bed" },
      { label: "Mattress", href: "/collections/mattress" },
      { label: "Customized Bed", href: "/collections/customized-bed" },
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
      { label: "Dining Chairs", href: "/collections/dining-chairs" },
      { label: "Dining Set", href: "/collections/dining-set" },
    ],
  },
  {
    label: "Living",
    href: "/collections/living",
    children: [
      { label: "All Living", href: "/collections/living" },
      { label: "Side Table", href: "/collections/side-table" },
      { label: "Ottoman PH", href: "/collections/ottoman-ph" },
      { label: "Kurtina ni PAN", href: "/collections/kurtina-ni-pan" },
      { label: "Accent Chair", href: "/collections/accent-chair" },
    ],
  },
];

// 13 tiles ng "Shop by Category" sa homepage
export const CATEGORY_TILES = [
  { label: "Bed", slug: "bed" },
  { label: "Sofa Bed", slug: "sofa-bed" },
  { label: "Sofa", slug: "sofa" },
  { label: "Dining Table", slug: "dining-table" },
  { label: "Dining Chairs", slug: "dining-chairs" },
  { label: "Dining Set", slug: "dining-set" },
  { label: "Side Table", slug: "side-table" },
  { label: "Ottoman PH", slug: "ottoman-ph" },
  { label: "Kurtina ni PAN", slug: "kurtina-ni-pan" },
  { label: "Mattress", slug: "mattress" },
  { label: "Customized Bed", slug: "customized-bed" },
  { label: "Accent Chair", slug: "accent-chair" },
];

// ---------- Helpers ----------
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
  return inCat?.images[0] ?? `/images/category-${slug}.jpg`;
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
