"use client";

// SEARCH RESULTS PAGE — /search?q=sofa
// Client-side filtering ng products mula sa content/products.json.

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import type { Product } from "@/lib/products";
import ProductCard from "@/components/ProductCard";

// Katulad na katulad ng searchProducts() sa lib/products.ts — pero sa
// listahang ipinasa mula sa server, hindi sa naka-bundle na JSON.
function searchIn(products: Product[], query: string): Product[] {
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

function SearchContent({ products }: { products: Product[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.get("q") ?? "";
  const [input, setInput] = useState(query);

  const results = searchIn(products, query);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(input.trim())}`);
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold mb-6">Search</h1>

      <form onSubmit={submit} className="flex max-w-xl mb-10">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search sofas, dining, lighting…"
          className="flex-1 border border-stone/40 bg-white px-4 py-3 text-sm focus:outline-none focus:border-cognac"
        />
        <button
          type="submit"
          className="bg-ink text-cream px-6 text-sm font-bold tracking-widest2 hover:bg-cognac transition-colors"
        >
          SEARCH
        </button>
      </form>

      {query && (
        <p className="text-stone text-sm mb-8">
          {results.length} {results.length === 1 ? "result" : "results"} for{" "}
          <strong className="text-ink">&ldquo;{query}&rdquo;</strong>
        </p>
      )}

      {query && results.length === 0 ? (
        <p className="text-stone py-10">
          No results found. Try a different keyword — e.g. &ldquo;sofa&rdquo;,
          &ldquo;leather&rdquo;, &ldquo;dining&rdquo;.
        </p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-10">
          {results.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}

// Ang `products` ay galing sa page.tsx (server) — doon lang nakukuha ang
// sariwang laman mula sa Supabase.
export default function SearchClient({ products }: { products: Product[] }) {
  // useSearchParams needs a Suspense boundary sa App Router
  return (
    <Suspense>
      <SearchContent products={products} />
    </Suspense>
  );
}
