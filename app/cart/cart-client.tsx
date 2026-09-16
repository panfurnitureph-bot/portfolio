"use client";

// CART PAGE — items, qty controls, totals, checkout (payment naka-off,
// nagpapakita ng "contact us to order" — tingnan ang lib/checkout.ts).

import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/lib/products";
import { formatPrice } from "@/lib/products";
import { useStore } from "@/components/store";

// Ang `products` ay galing sa page.tsx (server) — doon lang nakukuha ang
// sariwang laman mula sa Supabase.
export default function CartClient({ products }: { products: Product[] }) {
  const { cart, removeFromCart, setQty } = useStore();

  // I-join ang cart items sa product data
  const rows = cart
    .map((item) => ({ item, product: products.find((p) => p.slug === item.slug) }))
    .filter((r) => r.product); // laktawan kung tinanggal na ang product sa JSON

  const subtotal = rows.reduce(
    (sum, r) => sum + (r.item.unitPrice ?? r.product!.price) * r.item.qty,
    0
  );

  if (rows.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-24 text-center">
        <h1 className="text-3xl font-bold mb-4">Your cart is empty</h1>
        <p className="text-stone mb-8">Your cart is waiting to be filled. Start shopping!</p>
        <Link
          href="/collections/sofas"
          className="inline-block bg-ink text-cream px-8 py-4 text-sm font-bold tracking-widest2 hover:bg-cognac transition-colors"
        >
          SHOP SOFAS
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold mb-10">Your Cart</h1>

      <div className="grid lg:grid-cols-[1fr_340px] gap-12">
        {/* Items */}
        <div className="space-y-6">
          {rows.map(({ item, product }) => (
            <div
              key={`${item.slug}-${item.color}`}
              className="flex gap-5 border-b border-sand pb-6"
            >
              <Link href={`/products/${product!.slug}`} className="relative w-28 h-24 bg-sand shrink-0">
                <Image src={product!.images[0]} alt={product!.name} fill className="object-cover" />
              </Link>
              <div className="flex-1">
                <Link href={`/products/${product!.slug}`} className="font-bold hover:text-cognac">
                  {product!.name}
                </Link>
                <p className="text-xs text-stone mt-0.5">
                  {item.baseLabel ?? item.color}
                </p>
                {/* Breakdown ng add-ons */}
                {item.addOns && item.addOns.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {item.addOns.map((a, i) => (
                      <p key={i} className="text-[11px] text-stone">
                        + {a.label}{" "}
                        <span className="text-stone/70">
                          {a.price > 0 ? formatPrice(a.price) : "(price TBC)"}
                        </span>
                      </p>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-4 mt-3">
                  <div className="flex items-center border border-stone/40 text-sm">
                    <button
                      onClick={() => setQty(item.slug, item.color, item.qty - 1)}
                      className="px-3 py-1.5 hover:text-cognac"
                      aria-label="Decrease"
                    >
                      −
                    </button>
                    <span className="w-7 text-center">{item.qty}</span>
                    <button
                      onClick={() => setQty(item.slug, item.color, item.qty + 1)}
                      className="px-3 py-1.5 hover:text-cognac"
                      aria-label="Increase"
                    >
                      +
                    </button>
                  </div>
                  <button
                    onClick={() => removeFromCart(item.slug, item.color)}
                    className="text-xs text-stone underline hover:text-cognac"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p className="font-bold">{formatPrice((item.unitPrice ?? product!.price) * item.qty)}</p>
            </div>
          ))}
        </div>

        {/* Summary */}
        <aside className="bg-sand/40 p-6 h-fit">
          <h2 className="font-bold text-lg mb-5">Order Summary</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-stone">Subtotal</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone">Shipping</span>
              <span className="text-cognac font-bold">FREE</span>
            </div>
            <div className="flex justify-between border-t border-stone/30 pt-3 mt-3 font-bold text-base">
              <span>Total</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
          </div>
          <Link
            href="/checkout"
            className="block w-full mt-6 bg-ink text-cream py-4 text-sm font-bold tracking-widest2 text-center hover:bg-cognac transition-colors"
          >
            CHECKOUT
          </Link>
          <p className="text-xs text-stone mt-4 text-center">
            0% APR financing available · 100-Day Guarantee
          </p>
        </aside>
      </div>
    </div>
  );
}
