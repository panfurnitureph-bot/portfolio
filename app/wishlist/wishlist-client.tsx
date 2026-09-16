"use client";

// WISHLIST PAGE — mga na-heart na products.

import Link from "next/link";
import type { Product } from "@/lib/products";
import { useStore } from "@/components/store";
import ProductCard from "@/components/ProductCard";

// Ang `products` ay galing sa page.tsx (server) — doon lang nakukuha ang
// sariwang laman mula sa Supabase.
export default function WishlistClient({ products }: { products: Product[] }) {
  const { wishlist } = useStore();
  const items = wishlist
    .map((slug) => products.find((p) => p.slug === slug))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold mb-10">Wishlist</h1>
      {items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-stone mb-8">
            Nothing saved yet. Tap the ♥ on any product to save it here.
          </p>
          <Link
            href="/collections/new-in"
            className="inline-block bg-ink text-cream px-8 py-4 text-sm font-bold tracking-widest2 hover:bg-cognac transition-colors"
          >
            EXPLORE NEW ARRIVALS
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-10">
          {items.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
