"use client";

// Generic na horizontal carousel — heading kaliwa; sa DESKTOP may
// bilog na arrow buttons sa kanan; sa MOBILE ay swipe na may DOTS sa
// ibaba (kagaya ng tunay na site — walang arrows sa mobile).

import Link from "next/link";
import { Children, useRef, useState, type ReactNode } from "react";
import { useSwipeFallback } from "@/components/useSwipeFallback";

export default function Carousel({
  title,
  eyebrow,
  href,
  children,
}: {
  title: string;
  eyebrow?: string;
  // Kapag may href, nagiging link ang heading (hal. "Best-selling Bed" →
  // /collections/bed) — dating patay na text lang ito kapag pinindot.
  href?: string;
  children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const count = Children.count(children);
  const swipe = useSwipeFallback(track);

  function scroll(dir: 1 | -1) {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  }

  // I-track ang scroll position para sa dots. Naka-throttle sa isang frame —
  // ang scroll event ay pwedeng pumutok nang napakadalas sa mobile at bawat
  // setState ay re-render; dating nagpapabigat ito sa swipe.
  const raf = useRef(0);
  function onScroll() {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = track.current;
      if (!el || count < 2) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const i = Math.round((el.scrollLeft / max) * (count - 1));
      setIdx((prev) => (i !== prev ? i : prev));
    });
  }

  return (
    <section className="max-w-7xl mx-auto px-6 py-12">
      <div className="flex items-end justify-between mb-8">
        <div>
          {eyebrow && <p className="text-sm text-ink mb-1">{eyebrow}</p>}
          <h2 className="text-2xl sm:text-3xl text-ink">
            {href ? (
              <Link href={href} className="hover:text-cognac transition-colors">
                {title}
              </Link>
            ) : (
              title
            )}
          </h2>
        </div>
        {/* Arrows — desktop lang */}
        <div className="hidden md:flex items-center gap-3">
          <button
            onClick={() => scroll(-1)}
            aria-label="Previous"
            className="w-9 h-9 rounded-full text-stone hover:text-ink flex items-center justify-center text-xl"
          >
            ‹
          </button>
          <button
            onClick={() => scroll(1)}
            aria-label="Next"
            className="w-11 h-11 rounded-full bg-espresso text-cream hover:bg-cognac transition-colors flex items-center justify-center text-xl"
          >
            ›
          </button>
        </div>
      </div>
      <div
        ref={track}
        onScroll={onScroll}
        onTouchStart={swipe.onTouchStart}
        onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd}
        onTouchCancel={swipe.onTouchCancel}
        // WALANG `scroll-smooth` at WALANG `snap-x` dito — parehong may iOS
        // Safari bug. Ang scroll-snap ay nagka-cache ng snap points sa WebKit;
        // kapag nagbago ang laman ng mga card (lazy na larawan, hover scale),
        // nasisira ang cache at NAGFI-FREEZE ang swipe pagkatapos ng una.
        // Free momentum scroll (tulad ng Amazon) — gumagana palagi.
        className="flex gap-5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      {/* Dots — mobile lang */}
      {count > 1 && (
        <div className="md:hidden flex justify-center gap-1.5 mt-5">
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? "bg-espresso w-3" : "bg-stone/40 w-1.5"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
