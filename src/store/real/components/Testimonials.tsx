"use client";

// "What our customers are saying" — testimonial carousel na may state
// markers bilang navigation, 5 stars, italic serif quote, name + city.
// Editable ang laman sa content/homepage.json → testimonials.

import { useState } from "react";
import type { HomepageContent } from "@/lib/products";

// Pinasimpleng outline ng bawat estado (hand-drawn style, tulad ng
// tunay na site). Kung walang shape ang state code, letra ang fallback.
const STATE_PATHS: Record<string, string> = {
  WY: "M12,22 L88,18 L90,80 L14,84 Z",
  TX: "M38,6 L56,7 L55,40 L72,42 L80,50 L97,55 L88,62 L78,64 L70,78 L60,95 L52,82 L40,84 L34,72 L22,60 L8,56 L20,48 L36,44 Z",
  CA: "M22,6 L45,12 L40,38 L70,78 L68,94 L42,92 L30,70 L20,40 Z",
  NY: "M14,38 L28,30 L64,22 L74,34 L66,52 L90,72 L70,74 L58,62 L30,66 L18,56 Z",
  FL: "M8,28 L58,26 L60,34 L72,48 L84,72 L80,92 L70,88 L64,66 L52,44 L40,38 L8,38 Z",
  WA: "M14,14 L46,10 L84,16 L88,58 L58,72 L26,66 L20,52 L26,36 L12,28 Z",
  IL: "M30,8 L64,10 L68,30 L62,60 L52,88 L40,92 L34,74 L24,60 L28,34 Z",
  PA: "M14,30 L78,22 L88,34 L84,66 L70,74 L16,70 Z",
  AZ: "M30,10 L88,14 L84,88 L38,84 L20,60 L26,40 Z",
  GA: "M30,10 L60,12 L66,30 L80,60 L86,84 L60,90 L36,86 L32,50 Z",
  NC: "M8,40 L60,24 L90,36 L80,56 L60,66 L30,62 L12,52 Z",
  WI: "M20,20 L40,12 L70,18 L78,30 L74,60 L66,86 L34,84 L26,60 L14,40 Z",
};

function StateShape({ code, active }: { code: string; active: boolean }) {
  const path = STATE_PATHS[code];
  if (!path) {
    // Fallback: letra kung walang shape
    return <span className="font-cormorant text-sm">{code}</span>;
  }
  return (
    <svg viewBox="0 0 100 100" className="w-14 h-14">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 4.5 : 2.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Ipinapasa ng homepage (server) — doon galing ang Supabase content.
export default function Testimonials({
  testimonials,
}: {
  testimonials: HomepageContent["testimonials"];
}) {
  const { title, items } = testimonials;
  const [current, setCurrent] = useState(0);
  const t = items[current];

  return (
    <section className="bg-linen py-16">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="font-cormorant font-medium text-3xl sm:text-4xl mb-10">{title}</h2>

        <p className="text-cognac text-lg tracking-widest mb-4">★★★★★</p>
        <p className="font-cormorant italic text-2xl sm:text-3xl text-ink mb-6 min-h-[2.5em]">
          {t.quote}
        </p>
        <p className="font-bold text-sm">{t.name}</p>
        <p className="text-stone text-sm">{t.city}</p>

        {/* State markers bilang carousel nav */}
        <div className="flex items-center justify-center gap-3 mt-10 flex-wrap">
          <button
            onClick={() => setCurrent((current - 1 + items.length) % items.length)}
            aria-label="Previous testimonial"
            className="w-9 h-9 rounded-full bg-espresso text-cream flex items-center justify-center hover:bg-cognac transition-colors"
          >
            ‹
          </button>
          {items.map((item, i) => {
            const n = items.length;
            const inWindow =
              i === current || i === (current + 1) % n || i === (current - 1 + n) % n;
            return (
              <button
                key={item.name}
                onClick={() => setCurrent(i)}
                aria-label={`Testimonial from ${item.city}`}
                className={`w-16 h-16 items-center justify-center transition-all ${
                  inWindow ? "flex" : "hidden sm:flex"
                } ${
                  i === current
                    ? "text-espresso scale-110"
                    : "text-stone/50 hover:text-stone"
                }`}
              >
                <StateShape code={item.state} active={i === current} />
              </button>
            );
          })}
          <button
            onClick={() => setCurrent((current + 1) % items.length)}
            aria-label="Next testimonial"
            className="w-9 h-9 rounded-full bg-espresso text-cream flex items-center justify-center hover:bg-cognac transition-colors"
          >
            ›
          </button>
        </div>
      </div>
    </section>
  );
}
