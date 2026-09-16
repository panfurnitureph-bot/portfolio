"use client";

// WILL IT FIT? (2026-09-04, product page mockup) — link sa product info na
// nagbubukas ng modal: ilagay ang lapad at taas ng pinakamasikip na daanan
// (pinto, hagdan, elevator) at agad sinasabi kung kasya ang NAKA-BALOT na
// produkto (sukat + ~2" kada gilid), patayo o nakatagilid.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import type { Packaged } from "@/lib/packaged";

export default function FitModal({ name, packaged }: { name: string; packaged: Packaged }) {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState(""), [h, setH] = useState(""), [where, setWhere] = useState("Main door");
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    setTimeout(() => first.current?.focus(), 50);
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", k); };
  }, [open]);

  // Pinakamaliit na dalawang gilid ng kahon ang dapat dumaan sa butas.
  const W = Number(w), H = Number(h);
  let verdict: { kind: "idle" | "ok" | "tight" | "no" | "bad"; title?: string; text: string };
  if (!W || !H) verdict = { kind: "idle", text: "Enter width and height — updates as you type." };
  else if (W < 12 || W > 120 || H < 24 || H > 144) verdict = { kind: "bad", text: "That does not look like a door: width is usually 24–48 in and height 78–96 in." };
  else {
    const d = [packaged.w, packaged.d, packaged.h].sort((a, b) => a - b), s = d[0], m = d[1], diag = Math.sqrt(W * W + H * H);
    const fits = (s <= W && m <= H) || (s <= H && m <= W), tilted = !fits && s <= W && m <= diag * 0.95;
    const wh = where.toLowerCase();
    if (fits) verdict = { kind: "ok", title: `Fits — passes the ${wh} upright`, text: `Clearance ${Math.round(Math.min(W - s, H - m))} in. Our team measures again on delivery day.` };
    else if (tilted) verdict = { kind: "tight", title: "Tight — passes only tilted", text: `Diagonal ${Math.round(diag)} in. Send us a photo of this spot so the team comes prepared.` };
    else verdict = { kind: "no", title: `Will not pass this ${wh}`, text: "Options: remove the door (+3\"), use another entrance, or message us before ordering." };
  }
  const tone = { idle: "bg-linen text-stone", bad: "bg-[#F7EBD4] text-[#9A6B1E]", ok: "bg-[#E6F2EA] text-[#2F7D4F]", tight: "bg-[#F7EBD4] text-[#9A6B1E]", no: "bg-[#F6E3DF] text-[#A23B2E]" }[verdict.kind];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-[11.5px] font-bold tracking-[0.14em] uppercase border-b-[1.5px] border-goldDeep pb-0.5 hover:text-goldDeep transition-colors">
        Will it fit? Check your door
      </button>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/55 p-4" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }} role="dialog" aria-modal="true" aria-label="Will it fit?">
          <div className="relative w-full max-w-[520px] max-h-[92vh] overflow-auto bg-white">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="absolute top-0 right-0 z-10 h-9 w-9 bg-ink text-white text-xl">×</button>
            <div className="px-6 pt-6 pb-1.5">
              <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-goldDeep">Will it fit?</p>
              <h3 className="font-cormorant text-2xl font-semibold mt-1.5">{name} · packaged {packaged.w} × {packaged.d} × {packaged.h} in</h3>
              <p className="text-[13px] text-stone mt-2">Enter your tightest opening — usually the front door, a stair landing or the elevator.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 px-6 pt-3.5 pb-6">
              <label className="flex flex-col gap-1.5 text-[11px] tracking-[0.12em] uppercase text-stone">Opening width (in)
                <input ref={first} value={w} onChange={(e) => setW(e.target.value)} type="number" inputMode="decimal" placeholder="32" className="h-[42px] border border-sand bg-cream px-3 text-sm text-ink" />
              </label>
              <label className="flex flex-col gap-1.5 text-[11px] tracking-[0.12em] uppercase text-stone">Opening height (in)
                <input value={h} onChange={(e) => setH(e.target.value)} type="number" inputMode="decimal" placeholder="80" className="h-[42px] border border-sand bg-cream px-3 text-sm text-ink" />
              </label>
              <label className="col-span-2 flex flex-col gap-1.5 text-[11px] tracking-[0.12em] uppercase text-stone">Where is it?
                <select value={where} onChange={(e) => setWhere(e.target.value)} className="h-[42px] border border-sand bg-cream px-3 text-sm text-ink">
                  {["Main door", "Bedroom door", "Hallway turn", "Stairs / landing", "Elevator"].map((o) => <option key={o}>{o}</option>)}
                </select>
              </label>
              <div className={`col-span-2 px-3.5 py-3 text-[13.5px] ${tone}`} aria-live="polite">
                {verdict.title && <b className="block text-[15px] mb-0.5">{verdict.title}</b>}
                {verdict.text}
              </div>
              <p className="col-span-2 text-xs text-stone">
                Typical PH doors: main 36 × 80 · bedroom 32 × 80 · condo 34 × 84 · elevator 32–36 × 80.{" "}
                <Link href="/measuring" className="underline">Full measuring guide →</Link>
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
