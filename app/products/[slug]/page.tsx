// PRODUCT DETAIL PAGE — /products/<slug>
// Eksaktong pagkakasunod-sunod ng tunay na product page:
// 1 detail (gallery/options)      2 full-width tabs (Description...)
// 3 Explore The Collection        4 Material band + free swatches
// 5 Complete the room             6 Real Customer Reviews
// 7 "What the fuss is all about" (trust badges)   8 FAQs
// 9 pre-footer contact

import { notFound } from "next/navigation";
import Link from "next/link";
import { COLLECTIONS, getProduct, homepage, products, site } from "@/lib/products";
import { primeStoreContent } from "@/lib/content";
import ProductDetail from "@/components/ProductDetail";
import ProductTabs from "@/components/ProductTabs";
import ProductCard from "@/components/ProductCard";
import ProductReviews from "@/components/ProductReviews";
import MaterialBand from "@/components/MaterialBand";
import Carousel from "@/components/Carousel";
import TrustBadges from "@/components/TrustBadges";
import FaqAccordion from "@/components/FaqAccordion";
import PreFooter from "@/components/PreFooter";

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

export async function generateMetadata({ params }: { params: { slug: string } }) {
  // Punan din dito: hindi tiyak kung ano ang mauunang tumakbo — ito o ang page.
  // Kung hindi, ang bagong product mula sa admin ay makakakuha ng generic title.
  await primeStoreContent();
  const product = getProduct(params.slug);
  return { title: product ? `${product.name} — PAN Furnitures` : "PAN Furnitures" };
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  // Punan muna bago basahin ang `products` / `COLLECTIONS` sa ibaba.
  await primeStoreContent();

  const product = getProduct(params.slug);
  if (!product) notFound();

  // "Explore The Collection" — kaparehong category, 3 items
  const sameCollection = products
    .filter((p) => p.category === product.category && p.slug !== product.slug)
    .slice(0, 3);
  // "Complete the room" — ibang categories
  const completeTheRoom = products
    .filter((p) => p.category !== product.category && p.slug !== product.slug)
    .slice(0, 8);

  const categoryTitle =
    COLLECTIONS[product.category]?.title ?? product.category.replace(/-/g, " ");

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Breadcrumbs */}
      <nav className="text-xs text-stone mb-6">
        <Link href="/" className="hover:text-cognac">Home</Link>
        <span className="mx-2">/</span>
        <Link href={`/collections/${product.category}`} className="hover:text-cognac capitalize">
          {product.category.replace(/-/g, " ")}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink">{product.name}</span>
      </nav>

      {/* 1 — GALLERY + OPTIONS */}
      <ProductDetail product={product} site={site} />

      {/* 2 — FULL-WIDTH TABS */}
      <ProductTabs product={product} />

      {/* 3 — EXPLORE THE COLLECTION: title kaliwa + 3 cards */}
      {sameCollection.length > 0 && (
        <section className="grid lg:grid-cols-[280px_1fr] gap-10 items-center py-14">
          <div>
            <h2 className="text-2xl sm:text-3xl leading-snug">
              Explore The {categoryTitle} Collection
            </h2>
            <Link
              href={`/collections/${product.category}`}
              className="inline-block mt-4 text-xs font-bold tracking-widest2 border-b border-ink pb-0.5 hover:text-cognac hover:border-cognac"
            >
              SHOP THE FULL COLLECTION
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
            {sameCollection.map((p) => (
              <ProductCard key={p.slug} product={p} square />
            ))}
          </div>
        </section>
      )}

      {/* 4 — MATERIAL BAND + GET FREE SWATCHES */}
      <MaterialBand product={product} />

      {/* 5 — COMPLETE THE ROOM */}
      {completeTheRoom.length > 0 && (
        <div className="-mx-6">
          <Carousel title="Complete the room">
            {completeTheRoom.map((p) => (
              <div key={p.slug} className="snap-start shrink-0 w-[70vw] sm:w-[260px]">
                <ProductCard product={p} />
              </div>
            ))}
          </Carousel>
        </div>
      )}

      {/* 6 — REAL CUSTOMER REVIEWS */}
      <ProductReviews product={product} />

      {/* 7 — "WHAT THE FUSS IS ALL ABOUT" (trust badges) */}
      <section className="-mx-6 mt-16 bg-linen pt-12">
        <h2 className="font-cormorant font-medium text-3xl sm:text-4xl text-center mb-2">
          What the fuss is all about
        </h2>
        <TrustBadges badges={homepage.trustBadges} />
      </section>

      {/* 8 — FAQS */}
      <div className="-mx-6">
        <FaqAccordion />
      </div>

      {/* 9 — PRE-FOOTER CONTACT */}
      <div className="-mx-6 mt-8">
        <PreFooter />
      </div>
    </div>
  );
}
