"use client";

// MADE TO ORDER, MADE HERE (2026-09-04) — kaliwa: litrato ng workshop/kama na
// may stat strip; kanan: 3-hakbang na timeline (fabric mosaic mula sa
// library + "See all 196 →" na popup, build phases, delivery areas) at
// "Talk to us on Messenger" (modal). Copy sa IMS → Website → Homepage.

import Image from "next/image";
import type { HomepageContent, LibrarySwatch } from "@/lib/products";
import { openFabrics } from "./FabricPopup";
import { openMessenger } from "./MessengerModal";

export default function MadeToOrder({ copy, swatches, fallbackImage }: { copy: HomepageContent["mto"]; swatches: LibrarySwatch[]; fallbackImage?: string }) {
  const img = copy?.image || fallbackImage || "/store/images/category-bed.jpg";
  const mosaic = swatches.filter((s) => s.color || s.swatch).slice(0, 24);
  const steps = copy?.steps ?? [];
  const areas = copy?.areas ?? ["Cavite", "Laguna", "Metro Manila", "Nationwide"];
  return (
    <section className="bg-cream border-b border-sand py-14">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-11 items-stretch">
        <div className="relative min-h-[280px] lg:min-h-[520px] bg-sand overflow-hidden">
          <Image src={img} alt="Custom bed built in the PAN workshop" fill className="object-cover" sizes="(min-width: 1024px) 45vw, 100vw" />
          <div className="absolute inset-x-0 bottom-0 grid grid-cols-2 sm:grid-cols-[1fr_1.3fr_1fr] bg-brownDeep/90 border-t-2 border-gold text-cream">
            {[
              ["Pieces built to order", copy?.stat?.pieces ?? "1,200+"],
              ["Own workshop", copy?.stat?.workshop ?? "San Pedro, Laguna"],
              ["Build time", copy?.stat?.build ?? "4–6 wks"],
            ].map(([l, v], i) => (
              <div key={l} className={`px-4 py-3.5 flex flex-col gap-1 ${i < 2 ? "sm:border-r sm:border-gold/20" : ""} ${i === 1 ? "hidden sm:flex" : ""}`}>
                <small className="text-[9.5px] tracking-[0.16em] uppercase text-cream/60">{l}</small>
                <b className="font-cormorant text-xl font-semibold text-gold whitespace-nowrap">{v}</b>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-goldDeep">{copy?.eyebrow ?? "How made-to-order works"}</p>
          <h2 className="font-cormorant font-semibold text-[clamp(24px,2.8vw,32px)] leading-[1.05] mt-1.5">{copy?.title ?? "Made to order, made here"}</h2>
          {copy?.sub && <p className="text-sm mt-2 text-stone max-w-[60ch]">{copy.sub}</p>}
          <ol className="list-none m-0 mt-5 p-0 flex flex-col">
            {steps.map((s, i) => (
              <li key={i} className="relative grid grid-cols-[44px_1fr] gap-4 pb-7 last:pb-0">
                {i < steps.length - 1 && <span className="absolute left-[21px] top-11 bottom-0 w-px bg-goldDeep/45" />}
                <span className="w-11 h-11 rounded-full bg-brown text-gold border-2 border-gold flex items-center justify-center font-cormorant font-bold text-[17px]">{i + 1}</span>
                <div className="flex flex-col gap-2 pt-1.5">
                  <h3 className="font-cormorant text-[19px] font-semibold">{s.title}</h3>
                  <p className="m-0 text-[13.5px] text-stone leading-relaxed max-w-[52ch]">{s.text}</p>
                  {i === 0 && (
                    <div className="flex flex-wrap gap-1.5 items-center mt-1">
                      {mosaic.map((sw) => (
                        <span key={sw.name} title={sw.name} className="relative w-[22px] h-[22px] block border border-black/10 overflow-hidden" style={{ background: sw.color ?? "#D9CFC0" }}>
                          {sw.swatch && <Image src={sw.swatch} alt="" fill className="object-cover" sizes="22px" />}
                        </span>
                      ))}
                      <button type="button" onClick={openFabrics} className="h-6 ml-1 border border-brown px-2.5 text-[11px] font-bold text-brown hover:bg-brown hover:text-cream">See all {swatches.length} →</button>
                    </div>
                  )}
                  {i === 1 && (
                    <div className="grid grid-cols-3 gap-2.5 mt-1.5 text-[11.5px] text-stone">
                      {[["Frame", "Week 1–2", 100], ["Upholstery", "Week 3–4", 100], ["QC & delivery", "Week 5–6", 55]].map(([n, w, p]) => (
                        <span key={n as string} className="flex flex-col gap-1.5"><i className="block h-1.5 bg-sand relative overflow-hidden"><i className="absolute inset-y-0 left-0 bg-goldDeep" style={{ width: `${p}%` }} /></i><b className="text-ink font-semibold text-xs">{n}</b>{w}</span>
                      ))}
                    </div>
                  )}
                  {i === 2 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {areas.map((a) => <span key={a} className="border border-brown text-brown text-[11px] font-bold tracking-[0.08em] uppercase px-2.5 py-1.5">{a}</span>)}
                      <span className="border border-sand text-stone text-[11px] px-2.5 py-1.5">All deliveries by our own team</span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-2">
            <button type="button" onClick={openMessenger} className="text-[11.5px] font-bold tracking-[0.14em] uppercase border-b-[1.5px] border-goldDeep pb-0.5">{copy?.messengerLabel ?? "Talk to us on Messenger"} →</button>
          </div>
        </div>
      </div>
    </section>
  );
}
