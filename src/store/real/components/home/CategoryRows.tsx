"use client";

// CATEGORY ROWS (2026-09-04) — "Chairs · Swivel 9 | Dining 6 | …" na hilera
// kada grupo, awtomatiko: lumalabas lang ang row kapag ≥ minProducts ang
// buong grupo; nakatago ang tab na walang laman. Unang tab = pinakamarami.
// Ang grupo at tabs ay sa IMS → Website → Homepage.

import { useState } from "react";
import Rail from "./Rail";
import ProductCard from "@/components/ProductCard";
import type { HomepageContent, Product } from "@/lib/products";

type Row = { title: string; tabs: { label: string; slug: string }[] };

export default function CategoryRows({ products, config }: { products: Product[]; config?: HomepageContent["categoryRows"] }) {
  const min = config?.minProducts ?? 4;
  const rows: Row[] = (config?.rows ?? []) as Row[];
  const built = rows
    .map((r) => {
      const tabs = r.tabs
        .map((t) => ({ ...t, items: products.filter((p) => p.category === t.slug) }))
        .filter((t) => t.items.length > 0)
        .sort((a, b) => b.items.length - a.items.length);
      const total = new Set(tabs.flatMap((t) => t.items.map((p) => p.slug))).size;
      return { title: r.title, tabs, total };
    })
    .filter((r) => r.total >= min && r.tabs.length > 0);
  if (!built.length) return null;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 flex flex-col gap-12 md:gap-14 py-12 md:py-14">
      {built.map((r) => <RowView key={r.title} row={r} />)}
    </div>
  );
}

function RowView({ row }: { row: { title: string; tabs: { label: string; slug: string; items: Product[] }[] } }) {
  const [tab, setTab] = useState(0);
  const t = row.tabs[tab] ?? row.tabs[0];
  return (
    <section>
      <div className="flex items-end justify-between gap-4 border-b border-sand pb-2.5 mb-4 flex-wrap">
        <h2 className="font-cormorant text-[22px] font-semibold">{row.title}</h2>
        <div className="flex gap-0.5 flex-wrap">
          {row.tabs.map((x, i) => (
            <button key={x.slug} type="button" onClick={() => setTab(i)} className={`relative px-3 py-2 text-[11.5px] font-semibold tracking-[0.1em] uppercase ${i === tab ? "text-ink after:absolute after:left-3 after:right-3 after:-bottom-[11px] after:h-0.5 after:bg-goldDeep" : "text-stone"}`}>
              {x.label} <span className="font-normal text-stone ml-1 tabular-nums">{x.items.length}</span>
            </button>
          ))}
        </div>
      </div>
      <Rail key={t.slug} title="" link={{ label: `All ${t.label} →`, href: `/collections/${t.slug}` }} autoplay={false}>
        {t.items.map((p) => <ProductCard key={p.slug} product={p} showStock />)}
      </Rail>
    </section>
  );
}
