"use client";

// CONTACT PAGE — contact info + message form (walang backend pa,
// success message lang) + live chat placeholder.

import { useState } from "react";
import type { SiteContent } from "@/lib/products";

// Ang `site` ay galing sa page.tsx (server) — doon lang nakukuha ang
// sariwang laman mula sa Supabase.
export default function ContactClient({ site }: { site: SiteContent }) {
  const [sent, setSent] = useState(false);

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <h1 className="text-4xl font-bold mb-10">Contact Us</h1>

      <div className="grid md:grid-cols-2 gap-12">
        {/* Info */}
        <div className="space-y-8">
          <div>
            <h2 className="font-bold tracking-widest2 text-sm mb-2">EMAIL</h2>
            <a href={`mailto:${site.contact.email}`} className="text-cognac hover:underline">
              {site.contact.email}
            </a>
          </div>
          <div>
            <h2 className="font-bold tracking-widest2 text-sm mb-2">PHONE</h2>
            <a href={`tel:${site.contact.phone}`} className="text-cognac hover:underline">
              {site.contact.phone}
            </a>
            <p className="text-stone text-sm mt-1">{site.contact.hours}</p>
          </div>
          <div>
            <h2 className="font-bold tracking-widest2 text-sm mb-2">LIVE CHAT</h2>
            <button
              onClick={() => alert("Live chat coming soon! Email or call us in the meantime.")}
              className="border border-ink px-6 py-3 text-sm font-bold tracking-widest2 hover:bg-ink hover:text-cream transition-colors"
            >
              START CHAT
            </button>
          </div>
          <div>
            <h2 className="font-bold tracking-widest2 text-sm mb-2">ORDER SWATCHES</h2>
            <p className="text-stone text-sm">
              Want to see and feel the material before you buy? Send us a message
              using the form and we'll mail you free swatches.
            </p>
          </div>
        </div>

        {/* Form */}
        <div>
          {sent ? (
            <div className="bg-sand/50 p-8 text-center">
              <p className="text-2xl mb-2">✓</p>
              <h2 className="font-bold text-lg">Message sent!</h2>
              <p className="text-stone text-sm mt-2">
                Thank you! We&apos;ll get back to you within 1 business day.
              </p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSent(true);
              }}
              className="space-y-4"
            >
              <input
                required
                placeholder="Your name"
                className="w-full border border-stone/40 bg-white px-4 py-3 text-sm focus:outline-none focus:border-cognac"
              />
              <input
                required
                type="email"
                placeholder="Email address"
                className="w-full border border-stone/40 bg-white px-4 py-3 text-sm focus:outline-none focus:border-cognac"
              />
              <textarea
                required
                rows={6}
                placeholder="How can we help?"
                className="w-full border border-stone/40 bg-white px-4 py-3 text-sm focus:outline-none focus:border-cognac"
              />
              <button
                type="submit"
                className="bg-ink text-cream px-8 py-4 text-sm font-bold tracking-widest2 hover:bg-cognac transition-colors"
              >
                SEND MESSAGE
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
