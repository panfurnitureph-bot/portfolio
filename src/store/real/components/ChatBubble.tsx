"use client";

// Chat bubble sa kanang-babang sulok. Dinadala ang customer sa Messenger ng
// tindahan — doon sila tunay na sinasagot, at nananatili ang usapan sa inbox
// ng page kaya may history.
//
// ITSURA NG CHAT, HINDI TUNAY NA CHAT (2026-08-22). May header, bubble ng
// pagbati at form ng pangalan/numero — pero WALANG AI at walang sagot dito.
// Ang team pa rin ang sumasagot, sa Messenger. Ang porma ay kilala na ng
// customer, kaya alam nila kung ano ang gagawin; ang pangalan at numero ay
// dinadala sa thread para hindi na itanong muli.
//
// Kapag walang naka-set na Facebook page sa admin, bumabalik ito sa email at
// telepono — mas mabuti nang may makontak kaysa may butong papunta sa mali.

import { useEffect, useState } from "react";
import { contactLinks, type SiteContent } from "@/lib/products";
import { messengerHandle, messengerUrl } from "@/lib/messenger";

// Ang `site` ay galing sa server (layout) — hindi na ito kinukuha dito,
// dahil sa browser ay luma pa ang naka-bundle na JSON.
export default function ChatBubble({ site }: { site: SiteContent }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const handle = messengerHandle((site as unknown as { social?: { facebook?: string } }).social?.facebook);
  // ANG LAUNCHER AY NASA CONTACT RAIL NA (Joe 2026-09-12, kaliwang gilid):
  // ang Messenger icon doon ang nagbubukas nito sa pamamagitan ng event.
  useEffect(() => {
    const on = () => setOpen((v) => !v);
    window.addEventListener("pan-open-chat", on);
    return () => window.removeEventListener("pan-open-chat", on);
  }, []);

  // Ang pangalan at numero ay isinasama sa ref para makita ng bot sa pagbukas
  // ng thread — kaya hindi na itinatanong muli ang kakatipa lang nila.
  //
  // Ang ref ay teksto lang na ipinapasa ni Meta sa page; walang espasyo at
  // walang bantas na kayang dalhin nang buo, kaya sinasalà ito.
  const start = () => {
    if (!handle) return;
    const who = name.trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30);
    const num = phone.replace(/\D/g, "").slice(0, 13);
    const ref = [who && `n-${who}`, num && `m-${num}`].filter(Boolean).join("__");
    window.open(messengerUrl(handle, ref || undefined), "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  return (
    // KATABI NG CONTACT RAIL (2026-09-12): ang panel ay bumubukas sa kanan ng
    // Messenger icon sa kaliwang gilid — hindi na sa kanang-ibaba.
    <div data-floating className="fixed inset-x-3 top-1/2 z-50 -translate-y-1/2 sm:inset-x-auto sm:left-[4.75rem]">
      {open && (
        <div className="ml-14 w-[21rem] max-w-[calc(100%-3.5rem)] overflow-hidden rounded-xl border border-sand bg-white shadow-2xl sm:ml-0 sm:max-w-[calc(100vw-6rem)]">
          {/* ── HEADER ── */}
          <div className="flex items-center gap-3 bg-stone-200/70 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-ink">{site.brand.name}</p>
              <p className="flex items-center gap-1.5 text-[11px] text-stone">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                {handle ? "We reply on Messenger" : "Leave us a message"}
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="shrink-0 text-stone hover:text-ink"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="max-h-[26rem] overflow-y-auto px-4 py-4">
            {/* Hati na may petsa — porma ng chat, kaya kilala agad. */}
            <div className="mb-3 flex items-center gap-3">
              <span className="h-px flex-1 bg-sand" />
              <span className="text-[11px] text-stone">Today</span>
              <span className="h-px flex-1 bg-sand" />
            </div>

            {handle ? (
              <>
                {/* PAGBATI — hindi nagsasabing AI ito; ang team ang sasagot. */}
                <div className="mb-3 flex gap-2">
                  <Avatar />
                  <p className="rounded-lg rounded-tl-none bg-linen px-3 py-2 text-[13px] leading-snug text-ink">
                    Hello 👋 Send us your build or question and our team will reply on Messenger.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Avatar />
                  <div className="min-w-0 flex-1 rounded-lg rounded-tl-none bg-linen px-3 py-3">
                    <p className="mb-2 text-[13px] leading-snug text-ink">
                      Tell us who you are so we can keep you updated with our replies.
                    </p>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && start()}
                      placeholder="Name"
                      className="mb-2 w-full rounded-lg border border-sand bg-white px-3 py-2.5 text-sm focus:border-cognac focus:outline-none"
                    />
                    <div className="mb-2 flex gap-2">
                      <span className="flex shrink-0 items-center gap-1 rounded-lg border border-sand bg-white px-2.5 text-sm">
                        🇵🇭
                      </span>
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && start()}
                        inputMode="tel"
                        placeholder="+63"
                        className="w-full min-w-0 rounded-lg border border-sand bg-white px-3 py-2.5 text-sm focus:border-cognac focus:outline-none"
                      />
                    </div>
                    <p className="mb-2.5 text-[11px] leading-snug text-stone">
                      By sending us a message, you agree to our{" "}
                      <a href="/privacy" className="text-cognac underline">privacy policy</a>.
                    </p>
                    {/* WALANG HINIHINGING SAGOT: ang pangalan ay para lang sa
                        pagbati sa thread. Ang paghahadlang dito ay
                        pumipigil sa taong gustong magtanong agad. */}
                    <button
                      onClick={start}
                      className="w-full rounded-lg bg-[#0084FF] py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
                    >
                      Start chat
                    </button>
                  </div>
                </div>

                <p className="mt-3 text-center text-[11px] text-stone">
                  Or email{" "}
                  <a href={`mailto:${site.contact.email}`} className="text-cognac underline">
                    {site.contact.email}
                  </a>
                </p>
              </>
            ) : (
              <div className="flex gap-2">
                <Avatar />
                <p className="rounded-lg rounded-tl-none bg-linen px-3 py-2 text-[13px] leading-snug text-ink">
                  Reach us at{" "}
                  <a href={`mailto:${site.contact.email}`} className="text-cognac underline">
                    {site.contact.email}
                  </a>{" "}
                  or {site.contact.phone}
                  {contactLinks(site).whatsapp ? ` · WhatsApp / Viber ${contactLinks(site).whatsapp}` : ""}.
                </p>
              </div>
            )}

            <p className="mt-2 text-center text-[11px] text-stone">{site.contact.hours}</p>
          </div>
        </div>
      )}

      {/* Walang launcher dito — nasa ContactRail (kaliwa) ang Messenger icon. */}
    </div>
  );
}

// Maliit na monogram sa tabi ng bawat bubble — porma ng chat.
function Avatar() {
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sand bg-white text-[10px] font-bold tracking-tight text-ink">
      PF
    </span>
  );
}
