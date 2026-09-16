// SHOWROOMS + CONTACT (2026-09-04) — dalawang branch (litrato, address, oras,
// Waze / Google Maps), map card, at PH contact strip. Kapalit ng dating
// "Any questions?" (US number). Laman sa IMS → Website → Homepage.

import Image from "next/image";
import type { HomepageContent } from "@/lib/products";
import ShowroomMap from "./ShowroomMap";

function openNow(hours: string) {
  // "Mon–Sun · 9:00 AM – 7:00 PM" → bukas ba ngayon (PH time)?
  const m = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[–-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(hours);
  if (!m) return null;
  const to24 = (h: string, mm: string | undefined, ap: string) => (parseInt(h, 10) % 12) + (ap.toUpperCase() === "PM" ? 12 : 0) + (mm ? parseInt(mm, 10) / 60 : 0);
  const open = to24(m[1], m[2], m[3]), close = to24(m[4], m[5], m[6]);
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= open && h < close ? `Open now · until ${m[4]}${m[5] ? ":" + m[5] : ""} ${m[6].toUpperCase()}` : `Opens ${m[1]}${m[2] ? ":" + m[2] : ""} ${m[3].toUpperCase()}`;
}

export default function Showrooms({ copy }: { copy?: HomepageContent["showrooms"] }) {
  const items = (copy?.items ?? []).filter((s) => s.name);
  if (!items.length) return null;
  const c = copy?.contact;
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-8 py-14">
      <div className="mb-5">
        <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-goldDeep">{copy?.eyebrow ?? "Showrooms"}</p>
        <h2 className="font-cormorant font-semibold text-[clamp(22px,2.6vw,30px)] leading-[1.05] mt-1.5">{copy?.title ?? "Come sit on it first"}</h2>
        {copy?.sub && <p className="text-sm mt-1.5 text-stone max-w-[60ch]">{copy.sub}</p>}
      </div>
      <div className="grid lg:grid-cols-[1.25fr_1fr] gap-4">
        <div className={`grid ${items.length > 1 ? "sm:grid-cols-2" : ""} gap-3.5`}>
          {items.map((s) => {
            const st = openNow(s.hours ?? "");
            return (
              <div key={s.name} className="bg-white border border-sand flex flex-col">
                <div className="relative aspect-[4/3] bg-sand overflow-hidden">
                  {s.image && <Image src={s.image} alt={s.name} fill className="object-cover" sizes="(min-width: 1024px) 30vw, 100vw" />}
                  {st && <span className={`absolute top-2.5 left-2.5 text-[10px] font-bold tracking-[0.06em] uppercase px-2 py-1 rounded-full ${st.startsWith("Open") ? "bg-[#E6F2EA] text-[#2F7D4F]" : "bg-goldSoft text-brown"}`}>{st}</span>}
                </div>
                <div className="p-4 flex flex-col gap-1.5 text-[12.5px]">
                  <b className="text-[15px] font-semibold">{s.name}</b>
                  {s.address && <span className="text-stone">{s.address}</span>}
                  {s.hours && <span className="text-stone">{s.hours}</span>}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {s.waze && <a href={s.waze} target="_blank" rel="noopener noreferrer" className="border border-brown text-brown text-[11px] font-bold tracking-[0.08em] uppercase px-2.5 py-1.5">Waze</a>}
                    {s.maps && <a href={s.maps} target="_blank" rel="noopener noreferrer" className="border border-brown text-brown text-[11px] font-bold tracking-[0.08em] uppercase px-2.5 py-1.5">Google Maps</a>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {/* Totoong Google Maps embed, awtomatiko mula sa link/address ng branch. */}
        <ShowroomMap items={items.map((s) => ({ name: s.name, address: s.address, maps: s.maps, waze: s.waze }))} />
      </div>
      {c && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          {c.phone && <div className="border border-sand bg-white px-4 py-3.5 text-xs text-stone flex flex-col gap-0.5"><b className="text-ink text-sm font-semibold">{c.phone}</b><span>{c.phoneHours}</span></div>}
          <div className="border border-sand bg-white px-4 py-3.5 text-xs text-stone flex flex-col gap-0.5"><b className="text-ink text-sm font-semibold">Messenger</b><span>{c.messengerNote}</span></div>
          {c.email && <div className="border border-sand bg-white px-4 py-3.5 text-xs text-stone flex flex-col gap-0.5"><b className="text-ink text-sm font-semibold">{c.email}</b><span>{c.emailNote}</span></div>}
          <div className="border border-sand bg-white px-4 py-3.5 text-xs text-stone flex flex-col gap-0.5"><b className="text-ink text-sm font-semibold">Delivery</b><span>{c.deliveryNote}</span></div>
        </div>
      )}
    </section>
  );
}
