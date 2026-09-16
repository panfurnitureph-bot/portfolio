// ADMIN — inilipat na sa PAN Furnitures app.
//
// Ang panel na ito ay nagsusulat dati sa content/*.json sa mismong computer,
// kaya kailangan pa ng `git push` bago lumabas sa live site — at hindi ito
// naaabot ng windows app at ng APK.
//
// Nasa Supabase na ang content ngayon (tingnan ang lib/content.ts). Isang
// lugar lang ang binabago at sabay nang nag-uupdate ang website, ang windows
// app, at ang APK.
//
// Nananatili ang recolor at photo tools (/api/admin/recolor, make-card,
// clean-photo, make-dim-photo, sync-google-reviews) — lokal na Python ang mga
// iyon at hindi kayang patakbuhin ng app sa Vercel.

import Link from "next/link";

export const metadata = { title: "Admin — moved" };

const APP_URL =
  process.env.PAN_APP_URL?.replace(/\/$/, "") ?? "https://pan-furnitures.vercel.app";

export default function AdminMoved() {
  return (
    <div className="max-w-lg mx-auto px-6 py-24 text-center">
      <h1 className="text-2xl font-bold mb-3">Nasa PAN app na ang admin</h1>

      <p className="text-stone mb-6 leading-relaxed">
        Ang pag-edit ng nilalaman ng website ay nasa PAN Furnitures app na.
        Doon nagse-save sa Supabase, kaya sabay nang nag-uupdate ang website,
        ang windows app, at ang APK — hindi na kailangang mag-deploy.
      </p>

      <a
        href={`${APP_URL}/website/products`}
        className="inline-block bg-ink text-cream px-8 py-4 text-sm font-bold tracking-widest2 hover:bg-cognac transition-colors rounded"
      >
        BUKSAN ANG PAN APP ADMIN
      </a>

      <div className="mt-10 pt-6 border-t border-sand text-left">
        <p className="text-xs font-bold tracking-widest2 text-stone mb-3">
          NASA PAN APP NGAYON
        </p>
        <ul className="text-sm text-stone space-y-1.5">
          <li>Products · Promo &amp; Site · Shipping Rates</li>
          <li>Hero Slides · Banners &amp; Sections</li>
          <li>Reviews &amp; FAQs · Videos &amp; UGC</li>
          <li>FB AI Agent</li>
        </ul>
      </div>

      <p className="text-xs text-stone mt-8">
        <Link href="/" className="underline hover:text-ink">
          Bumalik sa tindahan
        </Link>
      </p>
    </div>
  );
}
