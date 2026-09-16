// FOOTER (2026-09-04, pinayat) — brand + tagline + contact, Shop (grupo, hindi
// bawat category), Help. Tanggal ang Company/Account columns (walang page ang
// About/Careers; Cart at Quotation ay nasa header). Socials + payment sa bar.

import Link from "next/link";
import { contactLinks, type SiteContent } from "@/lib/products";

const SHOP = [
  { label: "Beds & Mattress", href: "/collections/beds" },
  { label: "Sofas", href: "/collections/sofas" },
  { label: "Dining", href: "/collections/dining" },
  { label: "Living", href: "/collections/living" },
  { label: "Made to order", href: "/collections/customized-bed" },
];
const HELP = [
  { label: "FAQs", href: "/faqs" },
  { label: "Shipping & returns", href: "/shipping" },
  { label: "Track my delivery", href: "/track" },
  { label: "Measuring guide", href: "/measuring" },
  { label: "Wishlist", href: "/wishlist" },
];

export default function Footer({ site }: { site: SiteContent; shop?: { label: string; href: string }[] }) {
  const cl = contactLinks(site);
  const social = Object.entries((site as unknown as { social?: Record<string, string> }).social ?? {}).filter(([, u]) => u && !/facebook\.com\/?$/.test(u));
  return (
    <footer className="bg-brownDeep text-cream mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-11 pb-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr] gap-6 max-w-[820px] text-[13px]">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full bg-brown border-2 border-gold text-gold flex items-center justify-center font-cormorant font-bold text-[11px]">PAN</span>
              <span className="font-cormorant font-semibold tracking-[0.3em] text-lg">{site.brand.name.toUpperCase()}</span>
            </Link>
            <p className="text-[12.5px] text-cream/70 max-w-[32ch] mt-2.5">Made to order in San Pedro, Laguna. Delivered nationwide by our own team.</p>
            <ul className="list-none m-0 p-0 mt-3.5 text-[12.5px] text-cream/80 space-y-1.5">
              <li>Messenger · replies within the hour</li>
              {cl.whatsapp && <li><a href={cl.whatsappHref} target="_blank" rel="noopener noreferrer" className="hover:text-gold">WhatsApp · {cl.whatsapp}</a></li>}
              {cl.viber && <li><a href={cl.viberHref} className="hover:text-gold">Viber · {cl.viber}</a></li>}
              <li><a href={`mailto:${site.contact.email}`} className="hover:text-gold">{site.contact.email}</a></li>
              {cl.email2 && <li><a href={`mailto:${cl.email2}`} className="hover:text-gold">{cl.email2}</a></li>}
              <li>2 showrooms · Mon–Sun 9 AM – 7 PM</li>
            </ul>
          </div>
          <div>
            <h4 className="m-0 mb-2.5 text-[11px] tracking-[0.16em] uppercase text-gold">Shop</h4>
            <ul className="list-none m-0 p-0 space-y-1.5 text-cream/90">{SHOP.map((l) => <li key={l.href}><Link href={l.href} className="hover:text-gold">{l.label}</Link></li>)}</ul>
          </div>
          <div>
            <h4 className="m-0 mb-2.5 text-[11px] tracking-[0.16em] uppercase text-gold">Help</h4>
            <ul className="list-none m-0 p-0 space-y-1.5 text-cream/90">{HELP.map((l) => <li key={l.href}><Link href={l.href} className="hover:text-gold">{l.label}</Link></li>)}</ul>
          </div>
        </div>
        <div className="mt-8 pt-3.5 border-t border-gold/20 flex justify-between gap-3 flex-wrap text-[11px] text-cream/70">
          <span>© {new Date().getFullYear()} {site.brand.name}</span>
          <span className="flex gap-3">{social.map(([n, u]) => <a key={n} href={u} target="_blank" rel="noopener noreferrer" className="capitalize hover:text-gold">{n}</a>)}</span>
          <span>GCash · Maya · BDO · BPI</span>
        </div>
      </div>
    </footer>
  );
}
