// CHECKOUT PAGE — server wrapper. Dito kinukuha ang content mula sa
// Supabase, tapos ipinapasa sa client component na may mismong form.

import { products, site } from "@/lib/products";
import { primeStoreContent } from "@/lib/content";
import CheckoutClient from "./checkout-client";

// Walang cache: sariwang kuha sa Supabase kada page load, kaya ang binago sa
// PAN app admin ay lumalabas agad — hindi na kailangang maghintay.
export const revalidate = 0;

export default async function CheckoutPage() {
  // Punan muna bago basahin ang `site` / `products` sa ibaba.
  await primeStoreContent();

  return <CheckoutClient site={site} products={products} />;
}
