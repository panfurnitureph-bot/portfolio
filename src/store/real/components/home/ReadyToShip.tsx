// READY TO SHIP (2026-09-04) — mga produktong may stock ngayon (web_products
// .stock, isinusulat ng IMS Publish at inventory sync). Nakatago kapag wala.

import Rail from "./Rail";
import ProductCard from "@/components/ProductCard";
import type { HomepageContent, Product } from "@/lib/products";

export default function ReadyToShip({ products, copy }: { products: Product[]; copy?: HomepageContent["readyToShip"] }) {
  const ready = products.filter((p) => (p.stock ?? 0) > 0).sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0));
  if (!ready.length) return null;
  return (
    <section className="bg-linen border-y border-sand py-12 md:py-14">
      <div className="max-w-7xl mx-auto px-4 sm:px-8">
        <Rail
          eyebrow={copy?.eyebrow ?? "In stock · San Pedro, Laguna"}
          title={copy?.title ?? "Ready to ship this week"}
          sub={copy?.sub}
          link={{ label: "See all ready units →", href: "/collections/new-in?stock=1" }}
        >
          {ready.map((p) => <ProductCard key={p.slug} product={p} showStock showAddToCart />)}
        </Rail>
      </div>
    </section>
  );
}
