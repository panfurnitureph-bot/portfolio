"use client";

// "Real Customer Reviews" — kapareho ng tunay na site:
// serif na nakasentrong heading, malaking average + stars +
// "Based on verified reviews" | Write A Review pill button,
// Search reviews + With media toggle, row layout (pangalan sa kaliwa),
// "Was this review helpful?" 👍👎 bawat review, LOAD MORE.
// Ang isinusumiteng review ay naka-save sa browser (demo).

import Image from "next/image";
import { useState } from "react";
import type { Product } from "@/lib/products";

function Stars({ n, size = "text-base" }: { n: number; size?: string }) {
  return (
    <span className={`text-olive tracking-tight ${size}`}>
      {Array.from({ length: 5 }, (_, i) => (i < Math.round(n) ? "★" : "☆")).join("")}
    </span>
  );
}

function HelpfulRow({ initial }: { initial: number }) {
  const [up, setUp] = useState(initial);
  const [down, setDown] = useState(0);
  return (
    <p className="text-right text-xs text-stone mt-3">
      Was this review helpful?{" "}
      <button onClick={() => setUp(up + 1)} className="hover:text-ink ml-1">
        👍 {up}
      </button>
      <button onClick={() => setDown(down + 1)} className="hover:text-ink ml-2">
        👎 {down}
      </button>
    </p>
  );
}

export default function ProductReviews({ product }: { product: Product }) {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [ratingInput, setRatingInput] = useState(5);
  const [text, setText] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — tago, para sa bots
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [withMedia, setWithMedia] = useState(false);
  const [shown, setShown] = useState(5);

  const all = product.reviews;
  const avg = all.length ? all.reduce((s, r) => s + r.rating, 0) / all.length : null;

  const filtered = all.filter((r) => {
    if (withMedia && !(r.photos && r.photos.length)) return false;
    if (search && !(r.text + r.author).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Isusumite sa server → pending queue → aprubahan sa admin bago lumabas
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !text.trim()) {
      setError("Please fill in your name and review.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productSlug: product.slug,
          name: name.trim(),
          rating: ratingInput,
          text: text.trim(),
          website,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not submit review.");
      setSubmitted(true);
      setFormOpen(false);
      setName("");
      setText("");
      setRatingInput(5);
    } catch (err) {
      setError((err as Error).message);
    }
    setSending(false);
  }

  return (
    <section id="reviews" className="mt-16 scroll-mt-40">
      {/* Serif na nakasentrong heading */}
      <h2 className="font-cormorant font-medium text-3xl sm:text-4xl text-center mb-10">
        Real Customer Reviews
      </h2>

      {/* Summary: malaking numero + stars | divider | Write A Review pill */}
      <div className="flex flex-wrap items-center justify-center gap-8 border-b border-sand pb-10">
        <div className="flex items-center gap-4">
          <span className="font-cormorant text-6xl leading-none">
            {avg !== null ? (Number.isInteger(avg) ? avg : avg.toFixed(1)) : "—"}
          </span>
          <div>
            <Stars n={avg ?? 5} size="text-2xl" />
            <p className="text-stone text-sm mt-1">Based on verified reviews</p>
          </div>
        </div>
        <span className="hidden sm:block w-px h-14 bg-sand" />
        <button
          onClick={() => setFormOpen(!formOpen)}
          className="bg-espresso text-cream px-7 py-3 text-sm font-bold rounded-full hover:bg-cognac transition-colors"
        >
          Write A Review
        </button>
      </div>

      {/* Success message pagkatapos mag-submit */}
      {submitted && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded p-5 my-8 max-w-2xl mx-auto text-center">
          ✓ Thank you! Your review was submitted and will appear once it&apos;s approved.
        </div>
      )}

      {/* Write a review form */}
      {formOpen && (
        <form onSubmit={submit} className="border border-sand bg-white p-6 rounded my-8 max-w-2xl mx-auto">
          {/* Honeypot — tago sa tao, bots lang ang magfi-fill */}
          <input
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            name="website"
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            aria-hidden="true"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <label className="block">
              <span className="block text-xs font-bold text-stone mb-1">Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-stone/40 px-4 py-3 text-sm rounded focus:outline-none focus:border-cognac"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-stone mb-1">Rating</span>
              <div className="flex gap-1 pt-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRatingInput(n)}
                    aria-label={`${n} stars`}
                    className={`text-2xl ${n <= ratingInput ? "text-olive" : "text-stone/30"}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </label>
          </div>
          <label className="block mb-4">
            <span className="block text-xs font-bold text-stone mb-1">Your review</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="w-full border border-stone/40 px-4 py-3 text-sm rounded focus:outline-none focus:border-cognac"
            />
          </label>
          {error && <p className="text-red-700 text-sm mb-3">{error}</p>}
          <button
            type="submit"
            disabled={sending}
            className="bg-espresso text-cream px-8 py-3 text-sm font-bold rounded-full hover:bg-cognac transition-colors disabled:opacity-60"
          >
            {sending ? "Submitting…" : "Submit Review"}
          </button>
          <p className="text-xs text-stone mt-3">
            Your review will be published after a quick approval.
          </p>
        </form>
      )}

      {/* Search + With media toggle */}
      <div className="flex flex-wrap items-center gap-3 py-6 border-b border-sand">
        <div className="flex items-center border border-stone/40 rounded-full px-4 py-2 bg-white">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShown(5);
            }}
            placeholder="Search reviews"
            className="text-sm focus:outline-none w-36"
          />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-stone">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.5-4.5" />
          </svg>
        </div>
        <button
          onClick={() => {
            setWithMedia(!withMedia);
            setShown(5);
          }}
          className={`flex items-center gap-2 border rounded-full px-4 py-2 text-sm transition-colors ${
            withMedia ? "border-ink bg-white" : "border-stone/40 bg-white text-stone"
          }`}
        >
          With media
          <span
            className={`w-4 h-4 rounded-full border ${
              withMedia ? "bg-ink border-ink" : "border-stone/60"
            }`}
          />
        </button>
      </div>

      {/* Review rows — pangalan kaliwa, laman kanan */}
      {filtered.length === 0 ? (
        <p className="text-stone text-sm py-10 text-center">No reviews match your search.</p>
      ) : (
        <div className="divide-y divide-sand">
          {filtered.slice(0, shown).map((r, i) => (
            <div key={r.author + i} className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-4 py-8">
              <div>
                <p className="text-sm text-ink">{r.author}</p>
                {r.verified && (
                  <p className="text-xs text-stone mt-1">✓ Verified Buyer</p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Stars n={r.rating} size="text-lg" />
                  {r.date && <span className="text-xs text-stone">{r.date}</span>}
                </div>
                <p className="text-sm text-ink/90 leading-relaxed mt-2">{r.text}</p>
                {r.photos && r.photos.length > 0 && (
                  <div className="flex gap-2 mt-3">
                    {r.photos.map((ph) => (
                      <div key={ph} className="relative w-24 h-24 bg-sand overflow-hidden">
                        <Image src={ph} alt={`Photo by ${r.author}`} fill className="object-cover" sizes="96px" />
                      </div>
                    ))}
                  </div>
                )}
                <HelpfulRow initial={r.helpful ?? 0} />
              </div>
            </div>
          ))}
        </div>
      )}

      {shown < filtered.length && (
        <div className="text-center mt-4">
          <button
            onClick={() => setShown(shown + 5)}
            className="border border-stone/50 px-8 py-3 text-xs font-bold tracking-widest2 hover:border-ink transition-colors"
          >
            LOAD MORE
          </button>
        </div>
      )}
    </section>
  );
}
