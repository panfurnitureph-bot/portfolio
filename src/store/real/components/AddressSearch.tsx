"use client";

import { useEffect, useRef, useState } from "react";

// ISANG HANAPAN PARA SA BUONG ADDRESS.
//
// Ang form ay humihingi ng Region, Province, City, Barangay, Street at Postal
// bago pa lumitaw ang mapa — anim na hakbang, at ang search box na kayang sagutin
// silang lahat ay nasa ilalim, pumupuno lang ng isang field.
//
// Ito ang paraan ng Angkas at Grab: mag-type, pumindot, tapos. Ang mga dropdown
// ay nananatili sa ilalim para sa pag-aayos — kailangan pa rin ang City para sa
// shipping fee, at kailangan ng paraan para itama kapag mali ang hula ng search.

export type PlaceDetail = {
  name: string;
  street: string;
  barangay: string;
  city: string;
  province: string;
  postal: string;
  formatted: string;
  lat: number | null;
  lng: number | null;
};

type Suggestion = { id: string; main: string; secondary: string; source: "google" | "photon"; lat?: number; lng?: number };

export default function AddressSearch({
  onPick,
  onClear,
  placeholder = "House, school, church, or town…",
  label = "Where should we deliver?",
}: {
  onPick: (d: PlaceDetail) => void;
  // Pagbura ng hanapan — dapat mawala rin ang address na pinunan nito, kung
  // hindi ay may naiiwang lugar na hindi na tumutugma sa nakikita sa taas.
  onClear?: () => void;
  placeholder?: string;
  label?: string;
}) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  // Ang bawat keystroke ay isang API call kung walang pigil; ang huli lang ang
  // mahalaga, kaya kinakansela ang nauna.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    function away(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  function type(v: string) {
    setQ(v);
    setHi(-1);
    if (timer.current) clearTimeout(timer.current);
    // Binura nang manu-mano hanggang blangko — parehong kahulugan ng pagpindot
    // sa ✕: ang address na pinunan ng hanapan ay hindi na dapat naroon.
    if (!v.trim()) { setList([]); setOpen(false); onClear?.(); return; }
    if (v.trim().length < 2) { setList([]); setOpen(false); return; }
    // 280 ms: sapat para hindi tumawag kada letra, maikli para hindi maramdaman.
    timer.current = setTimeout(async () => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      setBusy(true);
      try {
        const r = await fetch(`/api/places?q=${encodeURIComponent(v.trim())}`, { signal: ac.signal });
        const j = (await r.json()) as { suggestions?: Suggestion[] };
        setList(j.suggestions ?? []);
        setOpen(true);
      } catch { /* kinansela o walang linya — hindi nagbabago ang nakikita */ }
      finally { if (!ac.signal.aborted) setBusy(false); }
    }, 280);
  }

  async function choose(s: Suggestion) {
    setOpen(false);
    setQ(s.main);
    // Ang Photon ay may coordinates na sa suggestion; ang Google ay kailangang
    // hingan ng detalye para sa bawat bahagi ng address.
    if (s.source === "photon") {
      const parts = s.secondary.split(",").map((x) => x.trim());
      onPick({
        name: s.main, street: s.main, barangay: parts[0] ?? "", city: parts[1] ?? "",
        province: parts[2] ?? "", postal: "", formatted: [s.main, s.secondary].filter(Boolean).join(", "),
        lat: s.lat ?? null, lng: s.lng ?? null,
      });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id }),
      });
      const d = (await r.json()) as PlaceDetail & { error?: string };
      if (!d.error) onPick(d);
    } catch { /* hindi umabot — nananatili ang tinipa, may dropdown pa rin sa ibaba */ }
    finally { setBusy(false); }
  }

  function key(e: React.KeyboardEvent) {
    if (!open || !list.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(i + 1, list.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); void choose(list[hi >= 0 ? hi : 0]); }
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="mb-3" ref={box}>
      <span className="mb-1 block text-[11px] font-bold text-stone">📍 {label}</span>
      <div className="relative">
        <div className="flex items-center gap-2 rounded border-[1.5px] border-cognac bg-white px-3 py-2.5 focus-within:ring-2 focus-within:ring-cognac/20">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" className="shrink-0 text-cognac" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => type(e.target.value)}
            onKeyDown={key}
            onFocus={() => list.length && setOpen(true)}
            placeholder={placeholder}
            autoComplete="off"
            aria-label={label}
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-stone/60"
          />
          {busy && <span className="shrink-0 text-[10px] font-bold text-stone">…</span>}
          {!!q && !busy && (
            <button
              type="button"
              onClick={() => { setQ(""); setList([]); setOpen(false); onClear?.(); }}
              className="shrink-0 text-stone hover:text-ink"
              aria-label="Clear"
            >
              ✕
            </button>
          )}
        </div>

        {open && (
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded border border-stone/30 bg-white shadow-lg">
            {list.length === 0 ? (
              <p className="px-3 py-3 text-xs text-stone">
                No matches. Try the town name, or fill in the address below.
              </p>
            ) : (
              list.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => void choose(s)}
                  onMouseEnter={() => setHi(i)}
                  className={`flex w-full items-start gap-2.5 border-t border-stone/15 px-3 py-2.5 text-left first:border-t-0 ${i === hi ? "bg-sand" : "hover:bg-sand"}`}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="mt-0.5 shrink-0 text-stone" aria-hidden="true">
                    <circle cx="12" cy="10" r="3" /><path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" />
                  </svg>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold leading-tight text-ink">{s.main}</span>
                    <span className="block text-[11px] leading-snug text-stone">{s.secondary}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
