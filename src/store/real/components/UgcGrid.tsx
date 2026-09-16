"use client";

// "PAN Furniture, in real life" — masonry photo grid (UGC style).
// Pag-click ng photo: lightbox modal (tulad ng tunay na site):
// kaliwa = malaking photo na may prev/next arrows,
// kanan = product card (rating + SHOP NOW), handle + date, caption
// na may READ MORE, thumbs up/down. Editable ang handle/caption sa
// content/homepage.json → ugc.

import Image from "next/image";
import Marquee from "@/components/home/Marquee";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { averageRating, type HomepageContent, type Product } from "@/lib/products";

const DATES = [
  "June 24, 2026", "June 18, 2026", "June 10, 2026", "May 30, 2026",
  "May 22, 2026", "May 14, 2026", "May 5, 2026", "April 27, 2026",
];

function Stars({ n }: { n: number }) {
  return (
    <span className="text-cognac tracking-tight text-sm">
      {"★".repeat(Math.round(n))}
      {"☆".repeat(5 - Math.round(n))}
    </span>
  );
}

// Stable na "review count" kapag walang totoong reviews ang product
function fakeCount(slug: string): number {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) % 97;
  return 8 + (h % 40);
}

function UgcModal({
  items,
  index,
  onClose,
  onNav,
  ugc,
}: {
  items: { src: string; product: Product }[];
  index: number;
  onClose: () => void;
  onNav: (i: number) => void;
  ugc: HomepageContent["ugc"];
}) {
  const { product, src } = items[index];
  const [expanded, setExpanded] = useState(false);
  const [likes, setLikes] = useState(0);
  const [dislikes, setDislikes] = useState(0);

  const handle = (ugc as any).handle ?? "@panfurniture";
  const caption =
    (ugc as any).caption ??
    "A little look at how our pieces are living in your homes ✨\n\nDifferent styles, different spaces, but one thing stays the same — furniture that feels like you.";
  const rating = averageRating(product) ?? 5.0;
  const count = product.reviews.length || fakeCount(product.slug);
  const title =
    product.colors[0] && product.colors[0] !== "Default"
      ? `${product.name} | ${product.colors[0]}`
      : product.name;

  const prev = useCallback(
    () => onNav((index - 1 + items.length) % items.length),
    [index, items.length, onNav]
  );
  const next = useCallback(
    () => onNav((index + 1) % items.length),
    [index, items.length, onNav]
  );

  // Esc para isara, arrow keys para mag-navigate
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, prev, next]);

  // Reset caption/reactions kapag lumipat ng photo
  useEffect(() => {
    setExpanded(false);
    setLikes(0);
    setDislikes(0);
  }, [index]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8">
      {/* Dark blurred backdrop */}
      <div
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto grid md:grid-cols-2">
        {/* ---------- LEFT: PHOTO + ARROWS ---------- */}
        <div className="relative aspect-square md:aspect-auto md:min-h-[480px] bg-sand">
          <Image src={src} alt={product.name} fill className="object-cover md:rounded-l-xl" sizes="(min-width: 768px) 450px, 100vw" />
          <button
            onClick={prev}
            aria-label="Previous"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-cream/70 hover:bg-cream text-ink flex items-center justify-center text-xl transition-colors"
          >
            ‹
          </button>
          <button
            onClick={next}
            aria-label="Next"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-cream/70 hover:bg-cream text-ink flex items-center justify-center text-xl transition-colors"
          >
            ›
          </button>
        </div>

        {/* ---------- RIGHT: PRODUCT + CAPTION ---------- */}
        <div className="relative p-6">
          {/* Close */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 text-stone hover:text-ink text-2xl leading-none"
          >
            ×
          </button>

          {/* Product card */}
          <div className="flex gap-4 items-start pr-8">
            <Link
              href={`/products/${product.slug}`}
              className="relative w-24 h-24 bg-[#F1EAE0] rounded overflow-hidden shrink-0"
            >
              <Image src={product.images[0]} alt={product.name} fill className="object-cover" sizes="96px" />
            </Link>
            <div>
              <p className="flex items-center gap-1.5 text-sm">
                <strong>{rating.toFixed(1)}</strong>
                <Stars n={rating} />
                <span className="text-stone">({count})</span>
              </p>
              <Link
                href={`/products/${product.slug}`}
                className="block font-bold text-lg leading-snug mt-1 hover:text-cognac transition-colors"
              >
                {title}
              </Link>
              <Link
                href={`/products/${product.slug}`}
                className="inline-block mt-3 bg-espresso text-cream px-5 py-2 text-xs font-bold tracking-widest2 rounded hover:bg-cognac transition-colors"
              >
                SHOP NOW
              </Link>
            </div>
          </div>

          {/* Handle + date */}
          <div className="flex items-center gap-3 mt-6">
            <span className="w-9 h-9 rounded-full bg-linen border border-sand flex items-center justify-center font-bold text-sm">
              {handle.replace("@", "").charAt(0).toUpperCase()}
            </span>
            <div className="text-sm">
              <p className="font-bold">{handle}</p>
              <p className="text-stone text-xs">{DATES[index % DATES.length]}</p>
            </div>
          </div>

          {/* Caption + READ MORE */}
          <div className="mt-4 text-sm text-ink/90 leading-relaxed whitespace-pre-line">
            {expanded ? caption : caption.slice(0, 120) + (caption.length > 120 ? "…" : "")}
          </div>
          {caption.length > 120 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-3 text-xs font-bold tracking-widest2 text-stone hover:text-ink"
            >
              {expanded ? "READ LESS" : "READ MORE"}
            </button>
          )}

          {/* Thumbs */}
          <div className="flex gap-5 mt-5 text-sm">
            <button
              onClick={() => setLikes(likes + 1)}
              className="flex items-center gap-1.5 text-stone hover:text-ink"
              aria-label="Like"
            >
              👍 {likes}
            </button>
            <button
              onClick={() => setDislikes(dislikes + 1)}
              className="flex items-center gap-1.5 text-stone hover:text-ink"
              aria-label="Dislike"
            >
              👎 {dislikes}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Ang `ugc` at `products` ay ipinapasa ng homepage (server) — doon lang
// nababasa ang sariwang laman ng Supabase.
export default function UgcGrid({
  ugc,
  products,
}: {
  ugc: HomepageContent["ugc"];
  products: Product[];
}) {
  const { title, subtitle } = ugc;
  // 9 muna (3 buong hanay), tapos +9 kada LOAD MORE — laging multiple ng 3
  // kolum, para walang bungi na huling hanay.
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // Kung may sariling photos sa admin (Videos & UGC tab) — yun ang
  // gagamitin (hal. mga FB post photos mo). Kung wala, fallback sa
  // product photos.
  const customPhotos: string[] = (ugc as any).photos ?? [];
  const fallbackProduct = products.find((p) => p.images.length > 0)!;
  const allPhotos =
    customPhotos.length > 0
      ? customPhotos.map((src) => ({ src, product: fallbackProduct }))
      : products
          .filter((p) => p.images.length > 0)
          .map((p) => ({ src: p.images[0], product: p }));
  // ISANG HILERA NA CAROUSEL (2026-09-04, bagong homepage): lahat ng litrato sa
  // Rail — caption card muna, tapos ang mga litrato; walang load-more grid.
  const photos = allPhotos;
  const handle = (ugc as any).handle as string | undefined;
  const caption = (ugc as any).caption as string | undefined;

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-8 py-12 md:py-14">
      <Marquee title={title} sub={subtitle} n={[4, 3, 2, 2]}>
        {[
          <div key="cap" className="aspect-square bg-brown text-cream p-5 flex flex-col justify-center gap-2 text-[13px]">
            {handle && <b className="text-gold text-xs tracking-[0.04em]">{handle}</b>}
            <span className="leading-relaxed">{caption || "A little look at how our pieces are living in your homes."}</span>
          </div>,
          ...photos.map((ph, i) => (
            <button
              key={ph.product.slug + i}
              onClick={() => setOpenIdx(i)}
              className="relative block w-full aspect-square overflow-hidden group bg-sand"
              aria-label={`View ${ph.product.name}`}
            >
              <Image
                src={ph.src}
                alt={ph.product.name}
                fill
                className={`${ph.src.includes("/card-") ? "object-contain bg-[#f7f0e4]" : "object-cover"} group-hover:scale-105 transition-transform duration-500`}
                sizes="(min-width: 1100px) 25vw, 60vw"
              />
            </button>
          )),
        ]}
      </Marquee>

      {/* Lightbox modal */}
      {openIdx !== null && (
        <UgcModal
          items={photos}
          index={openIdx}
          onClose={() => setOpenIdx(null)}
          onNav={setOpenIdx}
          ugc={ugc}
        />
      )}
    </section>
  );
}
