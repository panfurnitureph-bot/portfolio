// TRUST BAR (2026-09-04) — apat na totoong pangako ni PAN sa isang linya,
// brown na banda sa ilalim ng hero. Copy sa IMS → Website → Homepage.

import type { JSX } from "react";
import type { HomepageContent } from "@/lib/products";

const ICON: Record<string, JSX.Element> = {
  home: <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />,
  shield: <><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></>,
  truck: <><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>,
  card: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 14h4" /></>,
};

const DEFAULT = [
  { icon: "home", title: "Made in San Pedro, Laguna", sub: "Our own workshop crew" },
  { icon: "shield", title: "6-month warranty", sub: "Frame, foam, workmanship" },
  { icon: "truck", title: "Delivered & set up by our team", sub: "Nationwide · live tracking" },
  { icon: "card", title: "30% downpayment", sub: "GCash · Maya · BDO · BPI" },
];

export default function TrustBar({ items }: { items?: HomepageContent["trustBar"] }) {
  const list = items?.length ? items : DEFAULT;
  return (
    <div className="bg-brown text-cream border-t border-goldDeep">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 grid grid-cols-2 lg:grid-cols-4 gap-x-3">
        {list.map((t, i) => (
          <div key={i} className={`flex items-center gap-2.5 py-2.5 lg:py-3 lg:pr-4 lg:mr-4 min-h-[50px] ${i < list.length - 1 ? "lg:border-r lg:border-gold/20" : ""}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0 text-gold">{ICON[t.icon] ?? ICON.home}</svg>
            <span className="flex flex-col leading-tight">
              <b className="font-semibold text-[11.5px] sm:text-[12.5px]">{t.title}</b>
              <em className="not-italic text-[11px] text-cream/60 hidden sm:block">{t.sub}</em>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
