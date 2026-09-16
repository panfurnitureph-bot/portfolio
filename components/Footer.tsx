"use client";

// Footer — dark brown (espresso), "Keep in touch" na may underline
// email input + arrow, social icons, 4 link columns
// (SHOP / COMPANY / ACCOUNT / HELP), copyright + payment badges.

import Link from "next/link";
import { useState } from "react";
import type { SiteContent } from "@/lib/products";

const FOOTER_COLUMNS = [
  {
    title: "SHOP",
    links: [
      { label: "Bed", href: "/collections/bed" },
      { label: "Sofa", href: "/collections/sofa" },
      { label: "Sofa Bed", href: "/collections/sofa-bed" },
      { label: "Dining", href: "/collections/dining" },
      { label: "Side Table", href: "/collections/side-table" },
      { label: "Ottoman PH", href: "/collections/ottoman-ph" },
      { label: "Kurtina ni PAN", href: "/collections/kurtina-ni-pan" },
      { label: "Mattress", href: "/collections/mattress" },
      { label: "Accent Chair", href: "/collections/accent-chair" },
    ],
  },
  {
    title: "COMPANY",
    links: [
      { label: "Real Customer Reviews", href: "/#reviews" },
      { label: "About Us", href: "/about" },
      { label: "Blog", href: "/about" },
      { label: "Privacy Policy", href: "/faqs" },
      { label: "Terms & Conditions", href: "/faqs" },
      { label: "Your Privacy Choices", href: "/faqs" },
    ],
  },
  {
    title: "ACCOUNT",
    links: [
      { label: "Login / Register", href: "/contact" },
      { label: "Rewards", href: "/faqs" },
      { label: "Cart", href: "/cart" },
      { label: "Order Status", href: "/contact" },
      { label: "Trade", href: "/contact" },
    ],
  },
  {
    title: "HELP",
    links: [
      { label: "FAQs", href: "/faqs" },
      { label: "Shipping Guide", href: "/shipping" },
      { label: "Return Policy", href: "/shipping" },
      { label: "Product Care", href: "/faqs" },
      { label: "Contact Us", href: "/contact" },
      { label: "Financing", href: "/faqs" },
      { label: "Sitemap", href: "/" },
    ],
  },
];

const PAYMENTS = ["Visa", "Pay", "GPay", "MC", "Klarna", "G Pay"];

// Ang `site` ay ipinapasa ng layout (server) — hindi na binabasa dito.
export default function Footer({ site }: { site: SiteContent }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  return (
    <footer className="bg-espresso text-cream mt-20">
      <div className="max-w-7xl mx-auto px-6 py-14 grid lg:grid-cols-[1.2fr_2fr] gap-12">
        {/* Keep in touch */}
        <div>
          <h3 className="text-lg mb-6">Keep in touch</h3>
          {done ? (
            <p className="text-sm text-cognac">✓ Thank you! You&apos;re on the list.</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (email.includes("@")) setDone(true);
              }}
              className="flex items-center border-b border-cream/50 pb-2 max-w-sm"
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="flex-1 bg-transparent text-sm text-cream placeholder:text-cream/50 focus:outline-none"
              />
              <button type="submit" aria-label="Subscribe" className="text-cream hover:text-cognac text-lg">
                →
              </button>
            </form>
          )}

          {/* Social icons */}
          <div className="flex gap-5 mt-8">
            {Object.entries(site.social).map(([name, url]) => (
              <a
                key={name}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={name}
                className="text-cream/80 hover:text-cognac transition-colors capitalize text-sm"
              >
                {name === "facebook" ? "ⓕ" : name === "twitter" ? "𝕏" : name === "pinterest" ? "ⓟ" : "ⓘ"}
              </a>
            ))}
          </div>

          <p className="text-xs text-cream/50 mt-10">
            © {new Date().getFullYear()} {site.brand.name}. All rights reserved.
          </p>

          {/* Payment badges */}
          <div className="flex gap-1.5 mt-4 flex-wrap">
            {PAYMENTS.map((m, i) => (
              <span
                key={m + i}
                className="bg-cream text-ink rounded px-2 py-0.5 text-[10px] font-bold"
              >
                {m}
              </span>
            ))}
          </div>
        </div>

        {/* Link columns — desktop: grid; mobile: accordion (tap para buksan) */}
        <div className="hidden md:grid grid-cols-4 gap-8">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-bold tracking-widest2 mb-5">{col.title}</h4>
              <ul className="space-y-3 text-sm text-cream/80">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="hover:text-cognac transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="md:hidden divide-y divide-cream/20 border-y border-cream/20">
          {FOOTER_COLUMNS.map((col) => (
            <details key={col.title} className="group py-4">
              <summary className="flex justify-between items-center text-sm font-bold tracking-widest2 cursor-pointer list-none">
                {col.title}
                <span className="text-cream/60 group-open:rotate-180 transition-transform">⌄</span>
              </summary>
              <ul className="space-y-3 text-sm text-cream/80 pt-4">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="hover:text-cognac transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </div>
    </footer>
  );
}
