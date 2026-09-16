"use client";

// TOTOONG MAPA NG SHOWROOM (2026-09-04, "dapat automatic din") — Google Maps
// embed (walang API key) na awtomatikong sumusunod sa Google Maps link o
// address ng bawat showroom sa IMS → Website → Homepage → Showrooms. Tab kada
// showroom; ang "Open in Google Maps" at Waze ay ang mismong link ng branch.

import { useState } from "react";

type Item = { name: string; address?: string; maps?: string; waze?: string };

// Ano ang hahanapin ng embed: coordinates (@lat,lng) o q= sa link kung meron,
// kung hindi ang address (mas tiyak ang pin kaysa pangalan ng tindahan).
function queryFor(s: Item): string {
  const link = s.maps ?? "";
  const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(link);
  if (at) return `${at[1]},${at[2]}`;
  try {
    const u = new URL(link);
    const q = u.searchParams.get("q") ?? u.searchParams.get("query") ?? u.searchParams.get("destination");
    if (q) return q;
    const place = /\/place\/([^/]+)/.exec(u.pathname);
    if (place) return decodeURIComponent(place[1]).replace(/\+/g, " ");
  } catch { /* hindi URL o short link (maps.app.goo.gl) — address na lang */ }
  return s.address?.trim() || s.name;
}

export default function ShowroomMap({ items }: { items: Item[] }) {
  const [i, setI] = useState(0);
  const s = items[i] ?? items[0];
  if (!s) return null;
  const src = `https://maps.google.com/maps?q=${encodeURIComponent(queryFor(s))}&z=16&output=embed`;
  return (
    <div className="border border-sand bg-white flex flex-col overflow-hidden min-h-[280px]">
      {items.length > 1 && (
        <div className="flex border-b border-sand">
          {items.map((it, k) => (
            <button key={it.name} type="button" onClick={() => setI(k)} className={`flex-1 px-3 py-2.5 text-[11px] font-bold tracking-[0.08em] uppercase border-b-2 -mb-px ${k === i ? "border-goldDeep text-ink" : "border-transparent text-stone hover:text-ink"}`}>
              {it.name}
            </button>
          ))}
        </div>
      )}
      <div className="relative flex-1 min-h-[260px] bg-[#F1EBE1]">
        <iframe
          key={src}
          src={src}
          title={`Map — ${s.name}`}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
      <div className="flex justify-between items-center gap-3 px-3.5 py-2.5 border-t border-sand text-xs text-stone">
        <span className="min-w-0 truncate">{s.address || s.name}</span>
        <span className="flex gap-2 shrink-0">
          {s.waze && <a href={s.waze} target="_blank" rel="noopener noreferrer" className="border border-brown text-brown text-[11px] font-bold tracking-[0.08em] uppercase px-2.5 py-1.5">Waze</a>}
          <a href={s.maps || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryFor(s))}`} target="_blank" rel="noopener noreferrer" className="border border-ink text-ink text-[11px] font-bold tracking-[0.08em] uppercase px-2.5 py-1.5">Open in Google Maps</a>
        </span>
      </div>
    </div>
  );
}
