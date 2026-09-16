"use client";

// Hero slideshow — kapareho ng polyandbark.com homepage:
// full-bleed images, serif headline sa gitna, CTA na naka-underline sa
// baba, fade animation, auto-advance bawat 6 segundo, may dots at arrows.
// Desktop at mobile ay magkaibang image (tulad ng tunay na site).
// Mga slide ay editable sa content/homepage.json → heroSlides.

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { HomepageContent } from "@/lib/products";

const AUTOPLAY_MS = 6000;

// Ang mga slide ay ipinapasa ng homepage (server) — galing sa Supabase.
export default function HeroSlideshow({
  slides,
}: {
  slides: HomepageContent["heroSlides"];
}) {
  const [current, setCurrent] = useState(0);

  const next = useCallback(
    () => setCurrent((c) => (c + 1) % slides.length),
    [slides.length]
  );
  const prev = () => setCurrent((c) => (c - 1 + slides.length) % slides.length);

  // Auto-advance; nagre-reset kapag nag-navigate ang user
  useEffect(() => {
    const t = setInterval(next, AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [next, current]);

  return (
    // Desktop: ~16:9 na banner (hindi full-screen — kita agad ang trust
    // badges sa baba, kagaya ng tunay). Mobile: 4:5 aspect.
    <section className="relative md:aspect-[1.85/1] md:max-h-[86vh] md:w-full max-md:aspect-[4/5] overflow-hidden bg-sand">
      {slides.map((slide, i) => (
        <div
          key={i}
          className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
            i === current ? "opacity-100 z-10" : "opacity-0 z-0"
          }`}
          aria-hidden={i !== current}
        >
          {/* Desktop image */}
          <Image
            src={slide.imageDesktop}
            alt={slide.headline}
            fill
            priority={i === 0}
            className="object-cover hidden md:block"
            sizes="100vw"
          />
          {/* Mobile image (ibang crop, tulad ng tunay na site) */}
          <Image
            src={slide.imageMobile}
            alt={slide.headline}
            fill
            priority={i === 0}
            className="object-cover md:hidden"
            sizes="100vw"
          />
          {/* Kung may headline — text overlay; kung wala (hal. sale GIF
              na may text na nakabake sa image), image lang */}
          {slide.headline && (
            <>
              <div className="absolute inset-0 bg-ink/20" />
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                <h1 className="font-cormorant font-medium text-cream text-4xl sm:text-5xl lg:text-6xl max-w-3xl leading-tight drop-shadow-md">
                  {slide.headline}
                </h1>
                <p className="text-cream/95 mt-4 max-w-xl text-base sm:text-lg drop-shadow">
                  {slide.subtext}
                </p>
              </div>
            </>
          )}

          {/* CTA sa baba, underlined — tulad ng tunay na site */}
          <div className="absolute bottom-10 inset-x-0 flex justify-center">
            <Link
              href={slide.ctaHref}
              className="text-cream text-sm sm:text-base font-bold tracking-widest2 border-b-2 border-cream pb-1 hover:text-cognac hover:border-cognac transition-colors drop-shadow"
            >
              {slide.cta.toUpperCase()}
            </Link>
          </div>
        </div>
      ))}

      {/* Arrows */}
      <button
        onClick={prev}
        aria-label="Previous slide"
        className="absolute left-4 top-1/2 -translate-y-1/2 z-20 text-cream/80 hover:text-cream text-3xl w-10 h-10 flex items-center justify-center"
      >
        ‹
      </button>
      <button
        onClick={next}
        aria-label="Next slide"
        className="absolute right-4 top-1/2 -translate-y-1/2 z-20 text-cream/80 hover:text-cream text-3xl w-10 h-10 flex items-center justify-center"
      >
        ›
      </button>

      {/* Dots */}
      <div className="absolute bottom-4 inset-x-0 z-20 flex justify-center gap-2">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            aria-label={`Go to slide ${i + 1}`}
            className={`w-2 h-2 rounded-full transition-colors ${
              i === current ? "bg-cream" : "bg-cream/40"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
