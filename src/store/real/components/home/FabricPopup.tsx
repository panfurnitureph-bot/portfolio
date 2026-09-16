"use client";

// FABRIC POPUP (2026-09-04) — "See all 196 →" sa Made-to-order section:
// preview lang ng buong fabric library ng IMS, tabs kada collection, grid ng
// tela (swatch photo kung meron, kulay kung wala). Click ng tela → collection
// page na dala ang fabric bilang query, para naka-preselect sa configurator.
// Bukas via `window.dispatchEvent(new Event("pan:fabrics"))`.

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { LibrarySwatch } from "@/lib/products";

const ORDER = ["Leather", "Tanya", "Cairo", "Sofia", "Bristol", "New Sahara", "Lafayette", "Madrid", "Feather", "Velbert", "Tahoe"];
const colOf = (n: string) => { const w = n.trim().split(/\s+/); return w[0]?.toLowerCase() === "new" && w[1] ? `${w[0]} ${w[1]}` : (w[0] ?? ""); };
const num = (s: string) => { const m = /(\d+)/.exec(s); return m ? +m[1] : 0; };

export default function FabricPopup({ swatches }: { swatches: LibrarySwatch[] }) {
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [tab, setTab] = useState(0);
  // HOVER PREVIEW (Joe 2026-09-06): malaking litrato ng tela na sumusunod sa
  // cursor habang naka-hover; nawawala pag-alis. Mouse lang — walang hover sa touch.
  const [hov, setHov] = useState<{ s: LibrarySwatch; x: number; y: number } | null>(null);
  const groups = useMemo(() => {
    const by = new Map<string, LibrarySwatch[]>();
    for (const s of swatches) { const c = colOf(s.name); if (!by.has(c)) by.set(c, []); by.get(c)!.push(s); }
    const cols = [...ORDER.filter((c) => by.has(c)), ...Array.from(by.keys()).filter((c) => !ORDER.includes(c))];
    return cols.map((c) => ({ name: c, items: by.get(c)!.sort((a, b) => num(a.name) - num(b.name) || a.name.localeCompare(b.name)) }));
  }, [swatches]);
  useEffect(() => {
    const open = () => { setOn(true); document.body.style.overflow = "hidden"; };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pan:fabrics", open);
    document.addEventListener("keydown", key);
    return () => { window.removeEventListener("pan:fabrics", open); document.removeEventListener("keydown", key); };
  }, []);
  // PAINIT NG LAHAT NG TELA PAGBUKAS (Joe 2026-09-06, "may delay na 1-2s"): ang
  // bawat tab ay naghihintay noon sa network ng sarili nitong litrato. Ngayon,
  // pagbukas ng popup ay kinukuha na ng browser ang LAHAT ng swatch (bukas na
  // tab muna, saka ang iba, 12 kada 60ms para hindi masakal ang koneksyon) —
  // paglipat ng tab ay galing na sa cache, agad na lumalabas.
  useEffect(() => {
    if (!on) return;
    const ordered = [...groups.slice(tab), ...groups.slice(0, tab)];
    const urls = ordered.flatMap((gr) => gr.items.map((x) => x.swatch)).filter((u): u is string => !!u);
    let i = 0, t: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      for (let k = 0; k < 12 && i < urls.length; k++, i++) { const im = new window.Image(); im.decoding = "async"; im.src = urls[i]; }
      if (i < urls.length) t = setTimeout(tick, 60);
    };
    tick();
    return () => { if (t) clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, groups]);
  function close() { setOn(false); setHov(null); document.body.style.overflow = ""; }
  if (!on) return null;
  const g = groups[tab] ?? groups[0];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/55" onClick={(e) => { if (e.target === e.currentTarget) close(); }} role="dialog" aria-modal="true" aria-label="Pick your fabric">
      <div className="relative bg-cream w-[min(1100px,100%)] max-h-[92vh] min-h-[min(70vh,640px)] overflow-auto p-5 md:p-7 shadow-2xl">
        <button onClick={close} aria-label="Close" className="absolute top-0 right-0 z-10 w-9 h-9 bg-ink text-white text-xl hover:bg-brown">×</button>
        <div className="pr-10 mb-3">
          <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-goldDeep">{swatches.length} fabrics · real swatches at both showrooms</p>
          <h2 className="font-cormorant text-[26px] font-semibold leading-tight mt-1">Pick your fabric</h2>
        </div>
        <div className="flex flex-wrap gap-0.5 border-b border-sand mb-4">
          {groups.map((gr, i) => (
            <button key={gr.name} type="button" onClick={() => setTab(i)} onMouseEnter={() => { for (const x of gr.items) if (x.swatch) { const im = new window.Image(); im.src = x.swatch; } }} className={`relative px-2.5 py-2 text-[11.5px] font-semibold tracking-[0.1em] uppercase ${i === tab ? "text-ink after:absolute after:left-2.5 after:right-2.5 after:-bottom-px after:h-0.5 after:bg-goldDeep" : "text-stone"}`}>
              {gr.name} <span className="font-normal text-stone ml-1 tabular-nums">{gr.items.length}</span>
            </button>
          ))}
        </div>
        {hov && hov.s.swatch && typeof window !== "undefined" && (() => {
          const W = 260, H = 300, M = 18;
          const left = Math.min(Math.max(hov.x + M, 8), window.innerWidth - W - 8);
          const top = hov.y + M + H > window.innerHeight - 8 ? Math.max(hov.y - M - H, 8) : hov.y + M;
          return (
            <div className="pointer-events-none fixed z-[70] border border-black/10 bg-cream shadow-2xl" style={{ left, top, width: W }} aria-hidden>
              <div className="relative h-[260px] w-full overflow-hidden" style={{ background: hov.s.color ?? "#D9CFC0" }}>
                <Image src={hov.s.swatch} alt="" fill unoptimized className="object-cover" sizes="260px" />
              </div>
              <div className="px-3 py-2">
                <p className="text-[12.5px] font-semibold text-ink truncate">{hov.s.name}</p>
                {hov.s.material && <p className="text-[11px] text-stone truncate">{hov.s.material}</p>}
              </div>
            </div>
          );
        })()}
        {g && (
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(92px,1fr))]">
            {g.items.map((s) => (
              <button key={s.name} type="button" title={s.name} onClick={() => { close(); router.push(`/collections/customized-bed?fabric=${encodeURIComponent(s.name)}`); }}
                onMouseEnter={(e) => setHov({ s, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHov((h) => (h && h.s === s ? { s, x: e.clientX, y: e.clientY } : { s, x: e.clientX, y: e.clientY }))}
                onMouseLeave={() => setHov(null)} className="group flex flex-col gap-1.5 text-center">
                <span className="relative block aspect-square border border-black/10 overflow-hidden transition-transform group-hover:scale-[1.06] group-hover:shadow-lg" style={{ background: s.color ?? "#D9CFC0" }}>
                  {/* Maliit na 200px JPEG na (~8KB) mula sa Storage CDN — laktawan ang
                      next/image optimizer (bawat isa ay server resize noon = mabagal ang
                      unang bukas); lazy para ang nakikitang tab lang ang kinukuha. */}
                  {s.swatch && <Image src={s.swatch} alt={s.name} fill unoptimized loading="eager" className="object-cover" sizes="110px" />}
                </span>
                <span className="text-[11px] font-medium text-ink truncate">{s.name.replace(g.name + " ", "")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function openFabrics() { window.dispatchEvent(new Event("pan:fabrics")); }
