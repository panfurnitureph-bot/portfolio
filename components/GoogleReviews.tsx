"use client";

// "Reviews on Google" — rating header, masonry na review cards
// (avatar initials, stars, comment, photos, petsa), LOAD MORE.
// Pag-click ng review card: lightbox modal — photo sa kaliwa (may
// arrows para lumipat ng review), buong review sa kanan.
// Editable ang laman sa content/homepage.json → googleReviews.

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { averageRating, type HomepageContent, type Product } from "@/lib/products";

const AVATAR_COLORS = ["#7C5CBF", "#3B82C4", "#C4763B", "#4C9A6E", "#B85C7C", "#5C7CB8"];

type Review = {
  name: string;
  rating: number;
  date: string;
  text: string;
  photos: string[];
  product?: string; // slug/prefix ng product na ipapakita sa modal
};

// Stable na "review count" para sa product card sa modal
function fakeCount(slug: string): number {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) % 97;
  return 20 + (h % 150);
}

function Stars({ n }: { n: number }) {
  return (
    <span className="text-olive tracking-wider text-sm">
      {"★".repeat(n)}
      {"☆".repeat(5 - n)}
    </span>
  );
}

function Avatar({ name, index, size = "w-10 h-10" }: { name: string; index: number; size?: string }) {
  return (
    <span
      className={`${size} rounded-full text-cream flex items-center justify-center font-bold shrink-0`}
      style={{ backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
    >
      {name.charAt(0)}
    </span>
  );
}

// Hanapin ang product sa listahang ipinasa ng server — EXACT slug muna,
// saka prefix match (kapareho ng findByPrefix, pero sa props na listahan;
// ang module-level na `products` ay luma kapag nasa browser).
function findByPrefixIn(list: Product[], prefix: string): Product | undefined {
  return (
    list.find((p) => p.slug === prefix) ??
    list.find((p) => p.slug.startsWith(prefix))
  );
}

// ---------- LIGHTBOX MODAL — kapareho ng tunay na site ----------
function ReviewModal({
  items,
  index,
  onClose,
  onNav,
  products,
}: {
  items: Review[];
  index: number;
  onClose: () => void;
  onNav: (i: number) => void;
  products: Product[];
}) {
  const r = items[index];
  const [photoIdx, setPhotoIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [likes, setLikes] = useState(0);
  const [dislikes, setDislikes] = useState(0);

  // Product na naka-link sa review (para sa product card + SHOP NOW)
  const product = r.product ? findByPrefixIn(products, r.product) : undefined;
  // Kaliwang photo: HI-RES product images (1200px) — ang review photos
  // ay maliliit na thumbnails (135px) kaya blurred kapag pinalaki.
  // Kung walang naka-link na product, saka lang gagamitin ang review photos.
  const gallery = product ? product.images : r.photos;
  const prodRating = product ? (averageRating(product) ?? 4.9) : 4.9;
  const prodCount = product ? (product.reviews.length || fakeCount(product.slug)) : 0;
  const prodTitle = product
    ? product.colors[0] && product.colors[0] !== "Default"
      ? `${product.name} | ${product.colors[0]}`
      : product.name
    : "";

  // Arrows: una, iikutin ang PHOTOS ng kasalukuyang review;
  // kapag naubos na, saka lilipat sa susunod/nakaraang review.
  const prev = useCallback(() => {
    if (photoIdx > 0) {
      setPhotoIdx(photoIdx - 1);
    } else {
      onNav((index - 1 + items.length) % items.length);
    }
  }, [photoIdx, index, items.length, onNav]);
  const next = useCallback(() => {
    if (photoIdx < gallery.length - 1) {
      setPhotoIdx(photoIdx + 1);
    } else {
      onNav((index + 1) % items.length);
    }
  }, [photoIdx, gallery.length, index, items.length, onNav]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, prev, next]);

  // Reset kapag lumipat ng review
  useEffect(() => {
    setPhotoIdx(0);
    setExpanded(false);
    setLikes(0);
    setDislikes(0);
  }, [index]);

  const longText = r.text.length > 180;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8">
      <div className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto grid md:grid-cols-[48%_52%]">
        {/* ---------- LEFT: MALAKING PHOTO + ARROWS ---------- */}
        <div className="relative aspect-square md:aspect-auto md:min-h-[560px] bg-[#f7f0e4]">
          {gallery.length > 0 && (
            <Image
              src={gallery[photoIdx]}
              alt={`Photo by ${r.name}`}
              fill
              // Cards ay square — ipakita nang BUO (contain) para hindi
              // maputol ang text; ordinaryong photos ay cover pa rin
              className={`md:rounded-l-xl ${
                gallery[photoIdx].includes("/card-") ? "object-contain" : "object-cover"
              }`}
              sizes="(min-width: 768px) 440px, 100vw"
            />
          )}
          <button
            onClick={prev}
            aria-label="Previous review"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-cream/70 hover:bg-cream text-ink flex items-center justify-center text-xl transition-colors"
          >
            ‹
          </button>
          <button
            onClick={next}
            aria-label="Next review"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-cream/70 hover:bg-cream text-ink flex items-center justify-center text-xl transition-colors"
          >
            ›
          </button>
          {gallery.length > 1 && (
            <div className="absolute bottom-3 inset-x-0 flex justify-center gap-2">
              {gallery.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setPhotoIdx(i)}
                  aria-label={`Photo ${i + 1}`}
                  className={`w-2 h-2 rounded-full ${i === photoIdx ? "bg-cream" : "bg-cream/50"}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* ---------- RIGHT: PRODUCT CARD + REVIEW ---------- */}
        <div className="relative p-6">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 text-stone hover:text-ink text-2xl leading-none"
          >
            ×
          </button>

          {/* Product card — rating, pangalan, SHOP NOW */}
          {product && (
            <div className="flex gap-4 items-start pr-8">
              <Link
                href={`/products/${product.slug}`}
                className="relative w-24 h-24 bg-[#F1EAE0] border border-sand rounded overflow-hidden shrink-0"
              >
                <Image src={product.images[0]} alt={product.name} fill className="object-cover" sizes="96px" />
              </Link>
              <div>
                <p className="flex items-center gap-1.5 text-sm">
                  <strong>{prodRating.toFixed(1)}</strong>
                  <Stars n={Math.round(prodRating)} />
                  <span className="text-stone">({prodCount})</span>
                </p>
                <Link
                  href={`/products/${product.slug}`}
                  className="block font-bold text-lg leading-snug mt-1 hover:text-cognac transition-colors"
                >
                  {prodTitle}
                </Link>
                <Link
                  href={`/products/${product.slug}`}
                  className="inline-block mt-3 bg-espresso text-cream px-5 py-2 text-xs font-bold tracking-widest2 rounded hover:bg-cognac transition-colors"
                >
                  SHOP NOW
                </Link>
              </div>
            </div>
          )}

          {/* Reviewer + petsa */}
          <div className={`flex items-center gap-3 ${product ? "mt-6" : "pr-8"}`}>
            <Avatar name={r.name} index={index} />
            <div className="text-sm">
              <p className="font-bold">{r.name}</p>
              <p className="flex items-center gap-2">
                <Stars n={r.rating} />
                <span className="text-stone text-xs">{r.date}</span>
              </p>
            </div>
          </div>

          {/* Buong review text + READ MORE/SHOW LESS */}
          <div className="mt-4 text-sm text-ink/90 leading-relaxed whitespace-pre-line">
            {expanded || !longText ? r.text : r.text.slice(0, 180) + "…"}
          </div>
          {longText && (
            <div className="text-center">
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-3 text-xs font-bold tracking-widest2 text-stone hover:text-ink"
              >
                {expanded ? "SHOW LESS" : "READ MORE"}
              </button>
            </div>
          )}

          {/* Thumbs */}
          <div className="flex gap-5 mt-5 text-sm">
            <button
              onClick={() => setLikes(likes + 1)}
              className="flex items-center gap-1.5 text-stone hover:text-ink"
              aria-label="Helpful"
            >
              👍 {likes}
            </button>
            <button
              onClick={() => setDislikes(dislikes + 1)}
              className="flex items-center gap-1.5 text-stone hover:text-ink"
              aria-label="Not helpful"
            >
              👎 {dislikes}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- SECTION ----------
export default function GoogleReviews({
  googleReviews,
  products,
}: {
  googleReviews: HomepageContent["googleReviews"];
  products: Product[];
}) {
  const { title, rating, count, items } = googleReviews;
  const [shown, setShown] = useState(6);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <section className="max-w-7xl mx-auto px-6 py-14">
      <h2 className="text-2xl sm:text-3xl mb-1">{title}</h2>
      <p className="flex items-center gap-2 text-sm mb-10">
        <strong>{rating}</strong>
        <Stars n={5} />
        <span>{count.toLocaleString()} Reviews</span>
      </p>

      {/* Pantay-pantay na cards: putol ang mahabang text (SEE MORE),
          isang photo lang ang preview — buong laman sa modal */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 items-start">
        {items.slice(0, shown).map((r, i) => {
          const isLong = r.text.length > 160;
          const preview = isLong ? r.text.slice(0, 157).trimEnd() + "…" : r.text;
          const mainPhoto = r.photos[0];
          return (
            <div
              key={r.name + r.date}
              onClick={() => setOpenIdx(i)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setOpenIdx(i)}
              className="bg-linen p-6 cursor-pointer hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-3 mb-3">
                <Avatar name={r.name} index={i} />
                <div>
                  <p className="font-bold text-sm">{r.name}</p>
                  <Stars n={r.rating} />
                </div>
              </div>
              <p className="text-sm text-ink/90 leading-relaxed min-h-[60px]">
                {preview}
                {isLong && (
                  <span className="block mt-1 text-xs font-bold tracking-widest2 text-stone underline underline-offset-2">
                    SEE MORE
                  </span>
                )}
              </p>
              {mainPhoto && (
                <div className={`relative mt-4 ${mainPhoto.includes("/card-") ? "aspect-square" : "aspect-[4/3]"}`}>
                  <Image src={mainPhoto} alt={`Photo by ${r.name}`} fill className="object-cover" sizes="340px" />
                  {r.photos.length > 1 && (
                    <span className="absolute bottom-2 right-2 bg-ink/70 text-cream text-xs px-2 py-1 rounded">
                      +{r.photos.length - 1} more
                    </span>
                  )}
                </div>
              )}
              <p className="text-stone text-xs mt-4">{r.date}</p>
            </div>
          );
        })}
      </div>

      <div className="text-center mt-8 space-y-4">
        {shown < items.length && (
          <button
            onClick={() => setShown(shown + 6)}
            className="border border-stone/50 px-8 py-3 text-xs font-bold tracking-widest2 hover:border-ink transition-colors"
          >
            LOAD MORE
          </button>
        )}
        <p className="flex items-center justify-center gap-2 text-sm text-stone">
          <span className="font-bold text-lg">
            <span className="text-[#4285F4]">G</span>
            <span className="text-[#EA4335]">o</span>
            <span className="text-[#FBBC05]">o</span>
            <span className="text-[#4285F4]">g</span>
            <span className="text-[#34A853]">l</span>
            <span className="text-[#EA4335]">e</span>
          </span>
          <span className="hover:text-ink cursor-pointer">Show all Reviews</span>
        </p>
      </div>

      {/* Lightbox */}
      {openIdx !== null && (
        <ReviewModal
          items={items.slice(0, shown)}
          index={openIdx}
          onClose={() => setOpenIdx(null)}
          onNav={setOpenIdx}
          products={products}
        />
      )}
    </section>
  );
}
