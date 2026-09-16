"use client";

// GIFT CARDS PAGE — pumili ng amount, idagdag sa cart bilang concept.
// (Walang totoong gift card system pa — display page muna.)

import { useState } from "react";
import { formatPrice, type SiteContent } from "@/lib/products";

const AMOUNTS = [50, 100, 250, 500, 1000];

// Ang `site` ay ipinapasa ng page.tsx (server) — hindi na binabasa dito.
export default function GiftCardsClient({ site }: { site: SiteContent }) {
  const [amount, setAmount] = useState(100);
  const [requested, setRequested] = useState(false);

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 text-center">
      <h1 className="text-4xl font-bold mb-4">Gift Cards</h1>
      <p className="text-stone mb-10 max-w-lg mx-auto">
        The perfect gift for a housewarming, wedding, or anyone who deserves a
        beautiful home. Delivered by email, never expires.
      </p>

      {/* Card preview */}
      <div className="bg-ink text-cream max-w-sm mx-auto aspect-[8/5] flex flex-col items-center justify-center mb-10 shadow-lg">
        <p className="font-cormorant text-2xl font-medium tracking-[0.25em]">
          {site.brand.name.toUpperCase()}
        </p>
        <p className="text-cognac text-3xl font-bold mt-3">{formatPrice(amount)}</p>
        <p className="text-cream/60 text-xs tracking-widest2 mt-2">GIFT CARD</p>
      </div>

      <div className="flex justify-center gap-2 flex-wrap mb-8">
        {AMOUNTS.map((a) => (
          <button
            key={a}
            onClick={() => setAmount(a)}
            className={`px-5 py-3 text-sm border transition-colors ${
              a === amount
                ? "border-cognac bg-cognac text-cream"
                : "border-stone/40 hover:border-cognac"
            }`}
          >
            {formatPrice(a)}
          </button>
        ))}
      </div>

      {requested ? (
        <p className="text-cognac font-medium">
          Gift cards coming soon — contact us to order! Email {site.contact.email}.
        </p>
      ) : (
        <button
          onClick={() => setRequested(true)}
          className="bg-ink text-cream px-10 py-4 text-sm font-bold tracking-widest2 hover:bg-cognac transition-colors"
        >
          BUY GIFT CARD
        </button>
      )}
    </div>
  );
}
