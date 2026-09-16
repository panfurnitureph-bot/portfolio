"use client";

// Inset na banner slideshow (hal. "Made in America. Made to order.") —
// serif headline kaliwang-baba, underlined CTAs, product label
// kanang-baba, dots sa gitna, arrows kanang-taas, fade transition.

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Slide = {
  headline: string;
  ctas: { label: string; href: string }[];
  image: string;
  label: string;
};

export default function BannerSlideshow({ slides }: { slides: Slide[] }) {
  const [current, setCurrent] = useState(0);
  const next = useCallback(
    () => setCurrent((c) => (c + 1) % slides.length),
    [slides.length]
  );
  const prev = () => setCurrent((c) => (c - 1 + slides.length) % slides.length);

  useEffect(() => {
    const t = setInterval(next, 7000);
    return () => clearInterval(t);
  }, [next, current]);

  // Touch swipe sa mobile — dati ay dots lang, kaya sa telepono parang
  // "ayaw mag-slide" ang banner.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (dx < 0) next();
    else prev();
  }

  return (
    <section className="max-w-7xl mx-auto px-0 sm:px-6 py-10">
      <div
        className="relative aspect-[3/4] sm:aspect-[21/9] overflow-hidden bg-sand"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {slides.map((slide, i) => (
          <div
            key={slide.headline}
            className={`absolute inset-0 transition-opacity duration-1000 ${
              i === current ? "opacity-100 z-10" : "opacity-0 z-0"
            }`}
            aria-hidden={i !== current}
          >
            <Image src={slide.image} alt={slide.headline} fill className="object-cover" sizes="(min-width: 1280px) 1200px, 100vw" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/40 via-transparent to-transparent" />

            {/* Headline + CTAs kaliwang-baba */}
            <div className="absolute left-6 sm:left-10 right-6 bottom-8 sm:bottom-12">
              <h2 className="font-cormorant font-medium text-cream text-3xl sm:text-5xl drop-shadow mb-4">
                {slide.headline}
              </h2>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {slide.ctas.map((c) => (
                  <Link
                    key={c.label}
                    href={c.href}
                    className="text-cream text-xs sm:text-sm font-bold tracking-widest2 border-b border-cream pb-0.5 hover:text-cognac hover:border-cognac transition-colors"
                  >
                    {c.label.toUpperCase()}
                  </Link>
                ))}
              </div>
            </div>

            {/* Product label — kanang-baba sa desktop; itago sa mobile
                (iwas overlap sa CTAs kapag sikip ang screen) */}
            {slide.label && (
              <p className="hidden sm:block absolute right-10 bottom-12 text-cream text-sm drop-shadow">
                {slide.label}
              </p>
            )}
          </div>
        ))}

        {/* Arrows kanang-taas — desktop lang (mobile = swipe/dots) */}
        <div className="hidden sm:flex absolute right-5 top-5 z-20 gap-2">
          <button
            onClick={prev}
            aria-label="Previous"
            className="w-9 h-9 rounded-full bg-cream/30 text-cream hover:bg-cream/50 flex items-center justify-center"
          >
            ‹
          </button>
          <button
            onClick={next}
            aria-label="Next"
            className="w-9 h-9 rounded-full bg-cream/30 text-cream hover:bg-cream/50 flex items-center justify-center"
          >
            ›
          </button>
        </div>

        {/* Dots */}
        <div className="absolute bottom-3 inset-x-0 z-20 flex justify-center gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`Slide ${i + 1}`}
              className={`w-1.5 h-1.5 rounded-full ${i === current ? "bg-cream" : "bg-cream/40"}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
