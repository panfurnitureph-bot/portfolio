"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Pagkatapos magbayad, ibinabalik ang customer sa home page — may nakikitang
// countdown para hindi ito bigla, at may buton kung ayaw niyang maghintay.
export default function RedirectCountdown({
  seconds = 5,
  to = "/",
  label = "BACK TO SHOP",
}: {
  seconds?: number;
  to?: string;
  label?: string;
}) {
  const [left, setLeft] = useState(seconds);
  const router = useRouter();

  useEffect(() => {
    if (left <= 0) {
      router.push(to);
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, to, router]);

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={() => router.push(to)}
        className="inline-block bg-ink text-cream px-8 py-4 text-sm font-bold tracking-widest2 hover:bg-cognac transition-colors rounded"
      >
        {label}
      </button>
      <p className="text-xs text-stone" aria-live="polite">
        Babalik ka sa home page in {left}s…
      </p>
    </div>
  );
}
