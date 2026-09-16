// PRODUCT DETAIL PAGE — /products/<slug>
// MOCKUP 2026-09-04 ("eto lang dapat, wala ung iba"): breadcrumb, detail
// (gallery + options), tabs — tapos footer na. Tinanggal ang Explore the
// collection, material band, Complete the room, reviews, trust badges, FAQs
// at pre-footer contact.

import { notFound } from "next/navigation";
import Link from "next/link";
import { COLLECTIONS, getProduct, products, site } from "@/lib/products";
import { loadItemConfig, primeStoreContent } from "@/lib/content";
import ProductDetail from "@/components/ProductDetail";
import ProductTabs from "@/components/ProductTabs";

// Walang cache: sariwang kuha sa Supabase kada page load, kaya ang binago sa
// PAN app admin ay lumalabas agad — hindi na kailangang maghintay.
export const revalidate = 0;

// Pinapayagan ang produktong wala pa noong huling build — hindi 404 agad.
export const dynamicParams = true;

export async function generateStaticParams() {
  // Punan muna para galing sa Supabase ang listahan, hindi sa lumang JSON.
  await primeStoreContent();
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  // Punan din dito: hindi tiyak kung ano ang mauunang tumakbo — ito o ang page.
  // Kung hindi, ang bagong product mula sa admin ay makakakuha ng generic title.
  await primeStoreContent();
  const product = getProduct(params.slug);
  if (!product) return { title: "PAN Furniture" };
  // Branded OG card (2026-09-03): ang hilaw na portrait photo ay pinuputol ng
  // Messenger card - ang /api/og ay 1200x630 na laging maayos, buong litrato.
  const price = product.priceFrom ?? product.price;
  const og = `/api/og?title=${encodeURIComponent(product.name)}&price=${encodeURIComponent(price ? `₱${Number(price).toLocaleString("en-PH")}` : "")}&img=${encodeURIComponent(product.images[0] ?? "")}&v=2`;
  const description = (product.description || `${product.name} by PAN Furniture — made to order in San Pedro, Laguna.`).slice(0, 160);
  return {
    title: `${product.name} — PAN Furniture`,
    description,
    openGraph: { type: "website", url: `/products/${product.slug}`, siteName: "PAN Furniture", title: `${product.name} — PAN Furniture`, description, images: [{ url: og, width: 1200, height: 630, alt: product.name }] },
    twitter: { card: "summary_large_image", title: `${product.name} — PAN Furniture`, images: [og] },
  };
}

export default async function ProductPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  // Punan muna bago basahin ang `products` / `COLLECTIONS` sa ibaba.
  await primeStoreContent();

  const product = getProduct(params.slug);
  if (!product) notFound();

  // Made-to-Order config (IMS Website → MTO Configurator) — published lang;
  // kapag meron, ang MTO options panel ang papalit sa classic options.
  const mto = await loadItemConfig(product.sku);

  const categoryTitle =
    COLLECTIONS[product.category]?.title ?? product.category.replace(/-/g, " ");

  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 pb-4">
      {/* Breadcrumbs */}
      <nav className="text-xs text-stone mb-6">
        <Link href="/" className="hover:text-cognac">Home</Link>
        <span className="mx-2">/</span>
        <Link href={`/collections/${product.category}`} className="hover:text-cognac">
          {categoryTitle}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink">{product.name}</span>
      </nav>

      {/* 1 — GALLERY + OPTIONS */}
      <ProductDetail product={product} site={site} mto={mto} categoryTitle={categoryTitle} />

      {/* 2 — FULL-WIDTH TABS */}
      <ProductTabs product={product} site={site} mto={mto} />

    </div>
  );
}
