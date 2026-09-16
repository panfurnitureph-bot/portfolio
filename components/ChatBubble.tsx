"use client";

// Chat bubble sa kanang-babang sulok. Dinadala ang customer sa Messenger ng
// tindahan — doon sila tunay na sinasagot, at nananatili ang usapan sa inbox
// ng page kaya may history.
//
// Kapag walang naka-set na Facebook page sa admin, bumabalik ito sa email at
// telepono — mas mabuti nang may makontak kaysa may butong papunta sa mali.

import { useState } from "react";
import type { SiteContent } from "@/lib/products";
import { messengerHandle, messengerUrl } from "@/lib/messenger";

// Ang `site` ay galing sa server (layout) — hindi na ito kinukuha dito,
// dahil sa browser ay luma pa ang naka-bundle na JSON.
export default function ChatBubble({ site }: { site: SiteContent }) {
  const [open, setOpen] = useState(false);
  const handle = messengerHandle((site as any).social?.facebook);

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open && (
        <div className="absolute bottom-16 right-0 w-72 bg-white shadow-xl border border-sand p-5 rounded-lg">
          <p className="font-bold text-ink">{site.brand.name}</p>

          {handle ? (
            <>
              <p className="text-sm text-stone mt-2">
                Message us on Facebook — we usually reply within business hours.
              </p>
              <a
                href={messengerUrl(handle)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center justify-center gap-2 bg-[#0084FF] text-white rounded py-2.5 text-sm font-bold hover:opacity-90 transition-opacity"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C6.36 2 2 6.13 2 11.7c0 3.19 1.44 6.03 3.69 7.88V24l3.38-1.86c.9.25 1.86.38 2.93.38 5.64 0 10-4.13 10-9.7S17.64 2 12 2zm1.01 13.06l-2.55-2.72-4.97 2.72 5.47-5.81 2.61 2.72 4.9-2.72-5.46 5.81z" />
                </svg>
                CHAT ON MESSENGER
              </a>
              <p className="text-xs text-stone mt-3">
                Or email{" "}
                <a href={`mailto:${site.contact.email}`} className="text-cognac underline">
                  {site.contact.email}
                </a>
              </p>
            </>
          ) : (
            <p className="text-sm text-stone mt-2">
              Reach us at{" "}
              <a href={`mailto:${site.contact.email}`} className="text-cognac underline">
                {site.contact.email}
              </a>{" "}
              or {site.contact.phone}.
            </p>
          )}

          <p className="text-xs text-stone mt-2">{site.contact.hours}</p>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        aria-label="Chat with us"
        className="relative w-14 h-14 rounded-full bg-ink text-cream shadow-lg flex items-center justify-center hover:bg-cognac transition-colors"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M21 12a8 8 0 01-8 8H5l-2 2V12a8 8 0 018-8h2a8 8 0 018 8z" />
        </svg>
        <span className="absolute -top-1 -right-1 bg-red-500 text-cream text-[10px] rounded-full w-5 h-5 flex items-center justify-center">
          1
        </span>
      </button>
    </div>
  );
}
