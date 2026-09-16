// Material band — full-width: texture/product image sa kaliwa, sa kanan
// ang "Get to know our..." heading, material details, at icon badges.
// Tulad ng sa tunay na product page.

import Image from "next/image";
import type { Product } from "@/lib/products";

const BADGES = [
  {
    label: "Quality crafted",
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M12 2l2.4 4.8L20 8l-4 3.9.9 5.6L12 15l-4.9 2.5.9-5.6L4 8l5.6-1.2z" />
      </svg>
    ),
  },
  {
    label: "One-of-a-kind",
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M12 21c-4-3-7-6-7-10a7 7 0 0114 0c0 4-3 7-7 10z" />
        <path d="M12 7a4 4 0 014 4M12 4a7 7 0 017 7" opacity="0.5" />
      </svg>
    ),
  },
  {
    label: "Indoor use only",
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M3 11l9-8 9 8" />
        <path d="M5 10v10h14V10" />
      </svg>
    ),
  },
  {
    label: "Wipe clean",
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M4 14c2-1 4-1 6 0s4 1 6 0 4-1 4-1M4 18c2-1 4-1 6 0s4 1 6 0 4-1 4-1" />
        <path d="M7 10V5a2 2 0 012-2h6a2 2 0 012 2v5" />
      </svg>
    ),
  },
];

export default function MaterialBand({ product }: { product: Product }) {
  const color = product.colors[0] && product.colors[0] !== "Default" ? product.colors[0] : "materials";
  // Unang parirala ng materials bilang heading (hal. "Full-grain aniline leather")
  const materialName = product.materials.split(",")[0].trim();

  return (
    <section className="bg-linen -mx-6 mt-14">
      <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-10 px-6 py-14 items-start">
        {/* Texture / detail image */}
        <div className="relative aspect-[4/5] bg-sand overflow-hidden">
          <Image
            src={product.images[1] ?? product.images[0]}
            alt={materialName}
            fill
            className="object-cover"
            sizes="(min-width: 768px) 640px, 100vw"
          />
        </div>

        {/* Details */}
        <div className="md:pt-8">
          <p className="text-sm text-ink mb-2">Get to know our {color}</p>
          <h2 className="font-cormorant font-medium text-3xl sm:text-4xl mb-5">{materialName}</h2>
          <p className="text-sm text-stone leading-relaxed mb-4">
            {product.description}
          </p>
          <div className="text-sm text-stone leading-relaxed space-y-2">
            <p><strong className="text-ink">Composition:</strong> {product.materials}</p>
            <p><strong className="text-ink">Character:</strong> Rich in variation, with natural texture and tonal depth that make each piece one of a kind.</p>
            <p><strong className="text-ink">Ageing:</strong> Designed to wear in beautifully, becoming more comfortable and uniquely yours with use.</p>
            <p><strong className="text-ink">Care:</strong> {product.care}</p>
          </div>

          {/* Icon badges */}
          <div className="flex flex-wrap gap-3 mt-7">
            {BADGES.map((b) => (
              <div
                key={b.label}
                className="w-24 h-24 border border-stone/40 rounded flex flex-col items-center justify-center gap-2 text-ink text-center"
              >
                {b.icon}
                <span className="text-[10px] leading-tight px-1">{b.label}</span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </section>
  );
}
