// FAQs sa homepage — 2-column accordion na may SEE ALL link.
import Link from "next/link";
import { homepage } from "@/lib/products";

export default function FaqAccordion() {
  const { title, items } = homepage.faqs;
  const half = Math.ceil(items.length / 2);
  const cols = [items.slice(0, half), items.slice(half)];

  return (
    <section className="max-w-7xl mx-auto px-6 py-14">
      <h2 className="text-2xl sm:text-3xl mb-1">{title}</h2>
      <Link
        href="/faqs"
        className="inline-block text-xs font-bold tracking-widest2 border-b border-ink pb-0.5 mb-8 hover:text-cognac hover:border-cognac"
      >
        SEE ALL
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {cols.map((col, ci) => (
          <div key={ci} className="border border-sand bg-white px-6 divide-y divide-sand">
            {col.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="font-bold text-sm cursor-pointer list-none flex justify-between items-center gap-4">
                  {f.q}
                  <span className="text-stone group-open:rotate-180 transition-transform">⌄</span>
                </summary>
                <p className="text-stone text-sm mt-3 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
