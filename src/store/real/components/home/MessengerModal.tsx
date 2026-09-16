"use client";

// MESSENGER MODAL (2026-09-04) — "Talk to us on Messenger" at ang Showrooms na
// link ay hindi na diretsong tumatalon sa m.me: maliit na panel muna na may
// quick-reply chips (build, delivery quote, showroom visit, stock) at free
// text, saka "Continue in Messenger" na dala ang mensahe bilang ref. Ang
// ChatBubble sa kanang-ibaba ay hindi ginagalaw.
// Bukas via `window.dispatchEvent(new Event("pan:messenger"))`.

import { useEffect, useState } from "react";
import { messengerUrl } from "@/lib/messenger";

const CHIPS = ["Ask about a made-to-order build", "Get a delivery quote for my address", "Book a showroom visit", "Check stock on a ready unit"];

export default function MessengerModal({ handle }: { handle: string | null }) {
  const [on, setOn] = useState(false);
  const [text, setText] = useState("");
  useEffect(() => {
    const open = () => { setOn(true); document.body.style.overflow = "hidden"; };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pan:messenger", open);
    document.addEventListener("keydown", key);
    return () => { window.removeEventListener("pan:messenger", open); document.removeEventListener("keydown", key); };
  }, []);
  function close() { setOn(false); document.body.style.overflow = ""; }
  if (!on) return null;
  const href = handle ? messengerUrl(handle, text ? `web_${text.slice(0, 40).replace(/[^a-z0-9]+/gi, "_")}` : "web_home") : "/contact";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/55" onClick={(e) => { if (e.target === e.currentTarget) close(); }} role="dialog" aria-modal="true" aria-label="Message PAN Furniture">
      <div className="relative bg-white w-[min(440px,100%)] shadow-2xl">
        <button onClick={close} aria-label="Close" className="absolute top-0 right-0 z-10 w-9 h-9 bg-white text-ink text-xl hover:bg-sand">×</button>
        <div className="flex items-center gap-3 px-5 py-4 bg-brown text-cream">
          <span className="w-10 h-10 rounded-full bg-brownDeep border-2 border-gold text-gold flex items-center justify-center font-cormorant font-bold text-xs">PAN</span>
          <div><b className="block text-sm">PAN Furniture</b><span className="text-[11.5px] text-cream/70">Typically replies within the hour · 9 AM – 7 PM</span></div>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <div className="bg-linen px-3.5 py-2.5 text-[13.5px] rounded-[14px_14px_14px_4px] w-max max-w-full">Hi! What can we help you with today?</div>
          <div className="flex flex-col gap-2">
            {CHIPS.map((c) => (
              <button key={c} type="button" onClick={() => setText(c)} className={`text-left border border-brown px-3.5 py-2.5 text-[13px] rounded-full ${text === c ? "bg-brown text-cream" : "bg-white text-brown hover:bg-brown hover:text-cream"}`}>{c}</button>
            ))}
          </div>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type your message…" className="w-full border border-sand px-3 py-2.5 text-[13px] bg-cream resize-y" />
        </div>
        <div className="px-5 pb-5 flex flex-col gap-2 text-[11.5px] text-stone">
          <a href={href} target="_blank" rel="noopener noreferrer" onClick={close} className="h-11 flex items-center justify-center bg-brown text-cream text-[12px] font-bold tracking-[0.14em] uppercase hover:bg-brownDeep">Continue in Messenger</a>
          <span>Opens Messenger with your message</span>
        </div>
      </div>
    </div>
  );
}

export function openMessenger() { window.dispatchEvent(new Event("pan:messenger")); }
