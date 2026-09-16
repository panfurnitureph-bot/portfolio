"use client";

// "Featured in" — dark olive section na may serif quote at press logos.
// Desktop: lahat kita. Mobile: swipe carousel na may dots.

import { useRef, useState } from "react";
import type { HomepageContent } from "@/lib/products";

function LogoText({ name }: { name: string }) {
  return (
    <span
      className={`text-cream/60 font-bold ${
        name === "domino" ? "font-cormorant text-3xl lowercase" :
        name === "AD" ? "font-cormorant text-2xl" :
        "text-lg tracking-wide"
      }`}
    >
      {name}
    </span>
  );
}

// Ang laman ay galing sa homepage (server) — hindi na dito binabasa.
export default function PressBar({
  pressBar,
}: {
  pressBar: HomepageContent["pressBar"];
}) {
  const { title, quote, logos } = pressBar;
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  function onScroll() {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    const i = Math.round((el.scrollLeft / max) * (logos.length - 1));
    if (i !== idx) setIdx(i);
  }

  return (
    <section className="bg-olive text-cream py-14">
      <div className="max-w-6xl mx-auto px-6 text-center">
        <h2 className="font-cormorant text-2xl mb-4">{title}</h2>
        <p className="font-cormorant italic text-xl sm:text-2xl text-cream/90 mb-10">{quote}</p>

        {/* Desktop: lahat ng logos */}
        <div className="hidden md:flex flex-wrap justify-center items-center gap-x-12 gap-y-5">
          {logos.map((name) => (
            <LogoText key={name} name={name} />
          ))}
        </div>

        {/* Mobile: swipe na may dots */}
        <div className="md:hidden">
          <div
            ref={track}
            onScroll={onScroll}
            className="flex overflow-x-auto snap-x snap-mandatory items-center [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {logos.map((name) => (
              <div key={name} className="w-1/2 shrink-0 snap-center flex justify-center py-2">
                <LogoText name={name} />
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-1.5 mt-6">
            {logos.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? "bg-cream w-3" : "bg-cream/40 w-1.5"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
