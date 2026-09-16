// Pre-footer contact strip — "Any questions? We are happy to help!"
// + phone / chat / email columns na may icons.
import { homepage } from "@/lib/products";

export default function PreFooter() {
  const c = homepage.preFooter;
  return (
    <section className="bg-linen border-t border-sand">
      <div className="max-w-7xl mx-auto px-6 py-10 grid md:grid-cols-[1.2fr_1fr_1fr_1fr] gap-8 items-center max-md:text-center">
        <h2 className="text-2xl sm:text-3xl leading-snug">
          {c.title}
          <br />
          {c.subtitle}
        </h2>

        <div className="flex items-center gap-4 max-md:flex-col max-md:gap-2 max-md:justify-center">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-ink shrink-0">
            <path d="M4 4h4l2 5-2.5 1.5a12 12 0 006 6L15 14l5 2v4a2 2 0 01-2 2A16 16 0 012 6a2 2 0 012-2z" />
          </svg>
          <div className="text-sm">
            <p className="font-bold">{c.phone}</p>
            <p className="text-stone">{c.phoneHours}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 max-md:flex-col max-md:gap-2 max-md:justify-center">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-ink shrink-0">
            <path d="M4 5h12a2 2 0 012 2v6a2 2 0 01-2 2H9l-4 3v-3H4a2 2 0 01-2-2V7a2 2 0 012-2z" />
            <path d="M20 9h1a1 1 0 011 1v9l-3-2h-6" />
          </svg>
          <div className="text-sm">
            <p className="font-bold">{c.chatLabel}</p>
            <p className="text-stone">{c.chatText}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 max-md:flex-col max-md:gap-2 max-md:justify-center">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-ink shrink-0">
            <rect x="2" y="5" width="20" height="14" rx="1" />
            <path d="M2 6l10 7L22 6" />
          </svg>
          <div className="text-sm">
            <p className="font-bold">{c.email}</p>
            <p className="text-stone">{c.emailText}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
