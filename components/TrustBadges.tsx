"use client";

// Trust badges — desktop: 4 sa isang hilera; mobile: swipe carousel
// na may dots (kagaya ng tunay na site).

import { useRef, useState } from "react";
import type { HomepageContent } from "@/lib/products";

const ICONS: Record<string, JSX.Element> = {
  sofa: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M4 11V8a2 2 0 012-2h12a2 2 0 012 2v3" />
      <path d="M3 11a2 2 0 012 2v1h14v-1a2 2 0 114 0v3a2 2 0 01-2 2H3a2 2 0 01-2-2v-3a2 2 0 012-2z" />
      <path d="M5 18v2M19 18v2" />
    </svg>
  ),
  guarantee: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M21 12a9 9 0 11-3-6.7" />
      <path d="M21 4v4h-4" />
      <path d="M12 10.5c-.8-.9-2.2-.9-3 0-.7.8-.7 2 0 2.8L12 16l3-2.7c.7-.8.7-2 0-2.8-.8-.9-2.2-.9-3 0z" />
    </svg>
  ),
  card: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h4" />
    </svg>
  ),
  truck: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1 7h12v9H1zM13 10h5l3 3v3h-8z" />
      <circle cx="6" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </svg>
  ),
};

// Ang badges ay ipinapasa ng page (server) — Supabase ang pinagmulan.
export default function TrustBadges({
  badges,
}: {
  badges: HomepageContent["trustBadges"];
}) {
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  function onScroll() {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    const i = Math.round((el.scrollLeft / max) * (badges.length - 1));
    if (i !== idx) setIdx(i);
  }

  return (
    <section className="border-b border-sand bg-white">
      {/* Desktop: apat sabay */}
      <div className="hidden md:grid max-w-7xl mx-auto grid-cols-4 gap-8 px-6 py-10">
        {badges.map((b) => (
          <div key={b.title} className="flex items-center gap-4">
            <span className="text-ink shrink-0">{ICONS[b.icon] ?? ICONS.sofa}</span>
            <div className="text-sm text-ink leading-snug">
              <p>{b.title}</p>
              {b.text && <p>{b.text}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Mobile: swipe carousel + dots */}
      <div className="md:hidden py-6">
        <div
          ref={track}
          onScroll={onScroll}
          className="flex overflow-x-auto snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {badges.map((b) => (
            <div key={b.title} className="w-[80vw] shrink-0 snap-center flex items-center gap-4 px-6">
              <span className="text-ink shrink-0">{ICONS[b.icon] ?? ICONS.sofa}</span>
              <div className="text-sm text-ink leading-snug">
                <p>{b.title}</p>
                {b.text && <p>{b.text}</p>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-1.5 mt-4">
          {badges.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? "bg-espresso w-3" : "bg-stone/40 w-1.5"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
