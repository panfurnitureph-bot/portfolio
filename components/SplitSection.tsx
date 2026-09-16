"use client";

// Split section — malaking banner sa kaliwa (headline + subtext + CTA),
// 3 product cards sa kanan. Sa mobile: swipe row na may dots.

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import type { Product } from "@/lib/products";
import ProductCard from "@/components/ProductCard";

export default function SplitSection({
  image,
  headline,
  subtext,
  cta,
  href,
  products,
}: {
  image: string;
  headline: string;
  subtext: string;
  cta: string;
  href: string;
  products: Product[];
}) {
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  function onScroll() {
    const el = track.current;
    if (!el || products.length < 2) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    const i = Math.round((el.scrollLeft / max) * (products.length - 1));
    if (i !== idx) setIdx(i);
  }

  return (
    <section className="max-w-7xl mx-auto px-6 py-10">
      <div className="grid grid-cols-1 lg:grid-cols-[38%_1fr] gap-8 items-start">
        {/* Banner */}
        <Link href={href} className="relative block aspect-[4/3] lg:aspect-[5/4] overflow-hidden group">
          <Image
            src={image}
            alt={headline}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-700"
            sizes="(min-width: 1024px) 450px, 100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/50 via-transparent to-transparent" />
          <div className="absolute left-6 bottom-6">
            <h2 className="text-cream text-2xl sm:text-3xl font-medium drop-shadow">{headline}</h2>
            <p className="text-cream/90 text-sm mt-1 drop-shadow">{subtext}</p>
            <span className="inline-block mt-4 text-cream text-xs font-bold tracking-widest2 border-b border-cream pb-0.5 group-hover:text-cognac group-hover:border-cognac transition-colors">
              {cta.toUpperCase()}
            </span>
          </div>
        </Link>

        {/* 3 products — desktop: grid; mobile: swipe row */}
        <div className="hidden sm:grid grid-cols-3 gap-5">
          {products.map((p) => (
            <ProductCard key={p.slug} product={p} square />
          ))}
        </div>
        <div className="sm:hidden">
          <div
            ref={track}
            onScroll={onScroll}
            className="flex gap-4 overflow-x-auto snap-x [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {products.map((p) => (
              <div key={p.slug} className="w-[46vw] shrink-0 snap-start">
                <ProductCard product={p} square />
              </div>
            ))}
          </div>
          {/* Dots — kagaya ng tunay na site */}
          {products.length > 1 && (
            <div className="flex justify-center gap-1.5 mt-5">
              {products.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === idx ? "bg-espresso w-3" : "bg-stone/40 w-1.5"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
