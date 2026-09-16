"use client";

import { useEffect, useState, type ReactNode } from "react";
import { contactLinks, type SiteContent } from "@/lib/products";

// CONTACT RAIL (Joe 2026-09-12, "gawin na icon, ilagay sa left side, may
// bubble text"): WhatsApp / Viber / Email bilang bilog na icon sa kaliwang-
// ibabang sulok ng bawat pahina — kapareha ng chat bubble sa kanan. Sa hover
// (o focus) ay lumalabas ang bubble na may numero / email; sa tap ay diretso
// sa app (wa.me, viber://, mailto:). Ang mga halaga ay mula sa site.contact
// (IMS › Website Content › Site › Contact); ang blangko ay hindi lumalabas.
export default function ContactRail({ site }: { site: SiteContent }) {
  const cl = contactLinks(site);
  const [open, setOpen] = useState<string | null>(null);
  // LOADING BAGO MAG-REDIRECT (Joe 2026-09-12): umiikot na singsing sa icon
  // saglit bago bumukas ang app/tab — kita na may nangyayari. Ang bagong tab
  // (WhatsApp, Gmail) ay binubuksan agad sa loob ng pindot (pinipigilan ng
  // popup blocker kapag naantala); ang viber:// at ang chat/track panel ay
  // naghihintay ng 650ms.
  const [loading, setLoading] = useState<string | null>(null);
  const spin = (key: string, ms = 650) => { setLoading(key); window.setTimeout(() => setLoading((k) => (k === key ? null : k)), ms + 250); };
  // POP-UP NA MENSAHE (Joe 2026-09-12, "may animation tapos pop-up message
  // bubble"): 3.5s pagkabukas ng pahina ay lumilitaw ang bati sa tabi ng
  // Messenger icon; kusang nawawala pagkalipas ng 14s o kapag isinara /
  // pinindot. Isang beses lang kada session (sessionStorage) — hindi nagngangawa
  // sa bawat pahina.
  const [greet, setGreet] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("pan-rail-greeted") === "1"; } catch {}
    if (seen) return;
    const show = setTimeout(() => setGreet(true), 3500);
    const hide = setTimeout(() => setGreet(false), 3500 + 14000);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, []);
  const dismissGreet = () => { setGreet(false); try { sessionStorage.setItem("pan-rail-greeted", "1"); } catch {} };
  const openChat = () => { dismissGreet(); window.dispatchEvent(new Event("pan-open-chat")); };
  const items = [
    // MESSENGER at TRACK (Joe 2026-09-12): mula sa kanang gilid, dito na —
    // isang hanay ng lahat ng paraan ng pakikipag-ugnayan. Event lang ang
    // ipinapadala; ang ChatBubble at TrackButton ang may hawak ng panel.
    {
      key: "messenger", label: "Messenger", text: "replies within the hour", bg: "#0084FF", badge: true,
      onClick: () => openChat(),
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
          <path d="M12 2C6.5 2 2 6.1 2 11.3c0 2.9 1.4 5.5 3.7 7.2V22l3.4-1.9c.9.3 1.9.4 2.9.4 5.5 0 10-4.1 10-9.3S17.5 2 12 2zm1 12.5-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 5-2.7-5.5 5.8z" />
        </svg>
      ),
    },
    cl.whatsapp && {
      key: "whatsapp", label: "WhatsApp", text: cl.whatsapp, href: cl.whatsappHref, external: true, bg: "#25D366",
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 1 1-4.2 15.3l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8zm-3.3 4.4c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.2 5 4.4 2.5 1 3 .8 3.5.7.5-.1 1.7-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3l-2-1c-.3-.1-.5-.1-.7.1l-.9 1.1c-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.4-1.5-.9-.8-1.5-1.8-1.6-2.1-.2-.3 0-.4.1-.6l.5-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.1c-.2-.6-.5-.5-.7-.5h-.5z" />
        </svg>
      ),
    },
    cl.viber && {
      key: "viber", label: "Viber", text: cl.viber, href: cl.viberHref, external: false, bg: "#7360F2",
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
          <path d="M12 1.5c-1.6 0-5 .2-7 2-1.5 1.4-2 3.6-2 6.6 0 3 .5 5.2 2 6.6.7.6 1.6 1 2.5 1.3v3.4l.4.1c.2 0 .4-.1.5-.2l2.4-2.6c.4 0 .8.1 1.2.1 1.6 0 5-.2 7-2 1.5-1.4 2-3.6 2-6.6 0-3-.5-5.2-2-6.6-2-1.8-5.4-2.1-7-2.1zm0 1.7c1.5 0 4.4.2 5.9 1.6 1.1 1 1.4 2.9 1.4 5.3s-.3 4.3-1.4 5.3c-1.5 1.4-4.4 1.6-5.9 1.6-.5 0-1 0-1.5-.1l-.4-.1-1.9 2.1v-2.6l-.6-.2c-.8-.2-1.5-.6-2-1.1-1.1-1-1.4-2.9-1.4-5.3s.3-4.3 1.4-5.3c1.5-1.4 4.4-1.6 5.9-1.6zm-.1 1.9v1.3c1.4 0 2.7.5 3.6 1.4 1 1 1.4 2.3 1.4 3.7h1.3c0-1.8-.6-3.4-1.8-4.6-1.2-1.2-2.8-1.8-4.5-1.8zm.1 2.3v1.3c.8 0 1.5.3 2 .8.5.5.8 1.2.8 2h1.3c0-1.1-.4-2.2-1.2-2.9-.8-.8-1.8-1.2-2.9-1.2zm0 2.2v1.2c.4 0 .7.3.7.7h1.2c0-1-.9-1.9-1.9-1.9zM8.7 7.4c-.3 0-.6.1-.8.3-.6.5-1 1.2-.9 1.9.1.9.6 2.2 2 3.9 1.5 1.7 2.7 2.4 3.6 2.7.7.2 1.5-.1 2-.7.3-.3.4-.7.2-1l-1.2-1.3c-.2-.2-.5-.3-.8-.1l-.8.5c-.2.1-.4.1-.6 0-.5-.3-1.5-1.1-2.1-2-.1-.2-.1-.4 0-.5l.6-.7c.2-.2.2-.5.1-.8L9.4 7.7c-.2-.2-.4-.3-.7-.3z" />
        </svg>
      ),
    },
    {
      // GMAIL (Joe 2026-09-12): Gmail na logo, at ang click ay diretso sa
      // Gmail compose (web o app) na naka-address na — hindi generic na mailto.
      key: "email", label: "Gmail", text: cl.email2 || site.contact.email,
      href: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(cl.email2 || site.contact.email)}`, external: true, bg: "#ffffff",
      icon: (
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path fill="#4285F4" d="M2 8v9.5A1.5 1.5 0 0 0 3.5 19H6V10.5L2 8z" />
          <path fill="#34A853" d="M18 10.5V19h2.5a1.5 1.5 0 0 0 1.5-1.5V8l-4 2.5z" />
          <path fill="#FBBC04" d="M2 8V6.4c0-1.6 1.7-2.5 3-1.6L6 5.5v5L2 8z" />
          <path fill="#C5221F" d="M22 8V6.4c0-1.6-1.7-2.5-3-1.6L18 5.5v5L22 8z" />
          <path fill="#EA4335" d="M6 5.5 12 10l6-4.5v5l-6 4.5-6-4.5v-5z" />
        </svg>
      ),
    },
    {
      key: "track", label: "Track your order", text: "live delivery map", bg: "#3b2a1a",
      onClick: () => window.dispatchEvent(new Event("pan-open-track")),
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" />
          <circle cx="7" cy="17" r="1.6" />
          <circle cx="17.5" cy="17" r="1.6" />
        </svg>
      ),
    },
  ].filter((x): x is Exclude<typeof x, false | "" | null | undefined> => !!x) as {
    key: string; label: string; text: string; bg: string; icon: ReactNode;
    href?: string; external?: boolean; onClick?: () => void; badge?: boolean;
  }[];

  return (
    // NASA GITNA NG KALIWANG GILID (Joe 2026-09-12, "i-center, nasa baba e").
    <div data-floating className="fixed left-4 top-1/2 z-50 flex -translate-y-1/2 flex-col gap-5 sm:left-5">
      {/* ANIMATION (2026-09-12): sunud-sunod na pagpasok mula kaliwa, pintig na
          singsing sa Messenger, at pop ng bati. Naka-off sa reduced-motion. */}
      <style>{`
        @keyframes pan-rail-in { from { opacity: 0; transform: translateX(-28px) scale(.9); } to { opacity: 1; transform: none; } }
        @keyframes pan-rail-ring { 0% { transform: scale(1); opacity: .55; } 70% { transform: scale(1.75); opacity: 0; } 100% { transform: scale(1.75); opacity: 0; } }
        @keyframes pan-rail-pop { from { opacity: 0; transform: translateX(-10px) scale(.94); } to { opacity: 1; transform: none; } }
        @keyframes pan-rail-wiggle { 0%, 14%, 100% { transform: rotate(0); } 3% { transform: rotate(-11deg); } 6% { transform: rotate(10deg); } 9% { transform: rotate(-7deg); } 12% { transform: rotate(4deg); } }
        .pan-rail-item { animation: pan-rail-in .55s cubic-bezier(.2,.9,.3,1.2) both; }
        .pan-rail-ring { animation: pan-rail-ring 2.4s ease-out infinite; }
        .pan-rail-pop { animation: pan-rail-pop .35s cubic-bezier(.2,.9,.3,1.2) both; }
        .pan-rail-wiggle { animation: pan-rail-wiggle 7s ease-in-out infinite; }
        @keyframes pan-rail-spin { to { transform: rotate(360deg); } }
        .pan-rail-spin { animation: pan-rail-spin .8s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .pan-rail-item, .pan-rail-ring, .pan-rail-pop, .pan-rail-wiggle { animation: none !important; } }
      `}</style>
      {items.map((it, i) => (
        <div key={it.key} className="pan-rail-item relative flex items-center" style={{ animationDelay: `${i * 90}ms` }}
          onMouseEnter={() => setOpen(it.key)} onMouseLeave={() => setOpen((o) => (o === it.key ? null : o))}>
          {/* LAHAT NG ICON MAY ANIMATION (Joe 2026-09-12): pintig na singsing at
              pana-panahong wiggle sa bawat isa, magkakaiba ang oras para hindi
              sabay-sabay. */}
          {/* Laging may halo (highlighted na bilog) ang bawat icon, gaya ng Messenger — at pintig na singsing sa ibabaw nito. */}
          <span aria-hidden="true" className="pointer-events-none absolute -inset-1.5 rounded-full opacity-20" style={{ background: it.bg === "#ffffff" ? "#EA4335" : it.bg }} />
          <span aria-hidden="true" className="pan-rail-ring pointer-events-none absolute left-0 top-0 h-11 w-11 rounded-full" style={{ background: it.bg === "#ffffff" ? "#EA4335" : it.bg, animationDelay: `${600 + i * 300}ms` }} />
          {it.onClick ? (
            <button
              type="button"
              aria-label={`${it.label} · ${it.text}`}
              onClick={() => { if (loading) return; spin(it.key); window.setTimeout(() => it.onClick?.(), 650); }}
              onFocus={() => setOpen(it.key)} onBlur={() => setOpen(null)}
              className="pan-rail-wiggle relative flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gold"
              style={{ background: it.bg, animationDelay: `${1200 + i * 1400}ms` }}
            >
              <span className={loading === it.key ? "opacity-30" : ""}>{it.icon}</span>
              {loading === it.key && <span aria-hidden="true" className="pan-rail-spin absolute inset-1 rounded-full border-[3px] border-white/30 border-t-white" />}
              {it.badge && loading !== it.key && <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">1</span>}
            </button>
          ) : (
          <a
            href={it.href}
            target={it.external ? "_blank" : undefined}
            rel={it.external ? "noopener noreferrer" : undefined}
            aria-label={`${it.label} · ${it.text}`}
            onClick={(e) => {
              if (loading) { e.preventDefault(); return; }
              spin(it.key, it.external ? 900 : 650);
              if (!it.external) { e.preventDefault(); const href = it.href ?? ""; window.setTimeout(() => { window.location.href = href; }, 650); }
            }}
            onFocus={() => setOpen(it.key)} onBlur={() => setOpen(null)}
            className="pan-rail-wiggle relative flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gold"
            style={{ background: it.bg, animationDelay: `${1200 + i * 1400}ms` }}
          >
            <span className={loading === it.key ? "opacity-30" : ""}>{it.icon}</span>
            {loading === it.key && <span aria-hidden="true" className="pan-rail-spin absolute inset-1 rounded-full border-[3px] border-black/10 border-t-current" style={{ color: it.bg === "#ffffff" ? "#EA4335" : "#ffffff" }} />}
          </a>
          )}
          {/* Pop-up na bati sa tabi ng Messenger — pinipindot para magbukas ng chat. */}
          {it.badge && greet && (
            <div className="pan-rail-pop absolute bottom-0 left-[56px] z-10 w-[15.5rem] rounded-xl border border-sand bg-white p-3 pr-8 shadow-2xl">
              <span className="absolute -left-1.5 bottom-4 h-3 w-3 rotate-45 border-b border-l border-sand bg-white" />
              <button type="button" aria-label="Close" onClick={dismissGreet} className="absolute right-2 top-2 text-[13px] leading-none text-stone hover:text-ink">✕</button>
              <button type="button" onClick={openChat} className="flex items-start gap-2 text-left">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sand bg-cream text-[10px] font-bold text-ink">PF</span>
                <span className="text-[12.5px] leading-snug text-ink">
                  <b>Hi there!</b> Need help with a build or an order? Message us — we reply within the hour.
                </span>
              </button>
            </div>
          )}
          {/* Bubble text — kanan ng icon, may maliit na tuldok na nakaturo. */}
          <span
            role="tooltip"
            className={`pointer-events-none absolute left-[52px] whitespace-nowrap rounded-lg bg-ink px-3 py-1.5 text-[12px] font-semibold text-cream shadow-lg transition-opacity ${open === it.key && !(it.badge && greet) ? "opacity-100" : "opacity-0"}`}
          >
            <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-ink" />
            {it.label} · {it.text}
          </span>
        </div>
      ))}
    </div>
  );
}
