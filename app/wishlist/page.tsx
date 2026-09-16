// WISHLIST PAGE — server wrapper. Dito kinukuha ang products mula sa
// Supabase, tapos ipinapasa sa client component na may mismong grid.

import { products } from "@/lib/products";
import { primeStoreContent } from "@/lib/content";
import WishlistClient from "./wishlist-client";

// Walang cache: sariwang kuha sa Supabase kada page load, kaya ang binago sa
// PAN app admin ay lumalabas agad — hindi na kailangang maghintay.
export const revalidate = 0;

export default async function WishlistPage() {
  // Punan muna bago basahin ang `products` sa ibaba.
  await primeStoreContent();

  return <WishlistClient products={products} />;
}
