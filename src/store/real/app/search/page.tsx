// SEARCH PAGE — server wrapper. Dito kinukuha ang products mula sa
// Supabase, tapos ipinapasa sa client component na may mismong paghahanap.

import { products } from "@/lib/products";
import { primeStoreContent } from "@/lib/content";
import SearchClient from "./search-client";

// Walang cache: sariwang kuha sa Supabase kada page load, kaya ang binago sa
// PAN app admin ay lumalabas agad — hindi na kailangang maghintay.
export const revalidate = 0;

export default async function SearchPage() {
  // Punan muna bago basahin ang `products` sa ibaba.
  await primeStoreContent();

  return <SearchClient products={products} />;
}
