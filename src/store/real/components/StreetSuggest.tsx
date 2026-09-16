"use client";

// StreetSuggest — Shopee-style na street typeahead para sa checkout. Habang
// nagta-type ang customer, live na nagmumungkahi si Photon (OpenStreetMap
// geocoder — libre, walang API key) ng kalye/lugar na naka-scope sa napiling
// Province/City/Barangay. Pagpili ng suggestion: napupunan ang field AT
// lumilipat ang pin ng mapa doon.

import { useEffect, useRef, useState } from "react";

export type StreetPick = { lat: number; lng: number; address: string };

type Feature = {
  geometry: { coordinates: [number, number] }; // [lon, lat]
  properties: {
    name?: string; housenumber?: string; street?: string; district?: string;
    city?: string; county?: string; state?: string; postcode?: string; country?: string;
  };
};

// PH bounding box — HARD na hangganan ng lahat ng suggestion (bbox param kay
// Photon + coordinate double-check dito). Walang PH match = walang suggestion;
// hinding-hindi magmumungkahi ng kapangalang lugar sa ibang bansa.
const PH_BBOX = "116,4.2,127.5,21.6";
const inPH = (lat: number, lng: number) => lat >= 4.2 && lat <= 21.6 && lng >= 116 && lng <= 127.5;

// Subdivision noise na WALA sa OpenStreetMap — "BLK 27", "LOT 4", "Phase 2",
// "Unit 3B", "Purok 5". Tinatanggal sa GEOCODE query lang; mananatili ito sa
// itinaype/naka-save na address dahil kailangan ng driver sa mismong bahay.
const NOISE_RE = /\b(?:blk|block|lot|phase|unit|bldg|building|purok)\.?\s*#?\s*\w*\d\w*\b[,\s]*/gi;
const stripNoise = (s: string) =>
  s.replace(NOISE_RE, "").replace(/\s{2,}/g, " ").replace(/^[,\s]+|[,\s]+$/g, "");

function label(p: Feature["properties"]): string {
  const line1 = [p.housenumber, p.street || p.name].filter(Boolean).join(" ");
  const parts = [line1, p.district, p.city || p.county, p.state, p.postcode].filter(Boolean);
  return Array.from(new Set(parts)).join(", ");
}

export default function StreetSuggest({
  label: fieldLabel,
  value,
  onChange,
  onPick,
  context,
  bias,
  placeholder,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  // Pagpili ng suggestion — coords + buong address (dinadala ang pin doon).
  onPick: (loc: StreetPick) => void;
  // "Barangay, City, Province" mula sa dropdowns — dito naka-scope ang search.
  context?: string;
  // Kasalukuyang pin (barangay center) — bias ng geocoder.
  bias?: { lat: number; lng: number } | null;
  placeholder?: string;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valRef = useRef(value);
  valRef.current = value;

  // isara pag nag-click sa labas
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function search(raw: string) {
    if (timer.current) clearTimeout(timer.current);
    const stripped = stripNoise(raw);
    const q = stripped.length >= 3 ? stripped : raw;
    if (q.trim().length < 3) { setResults([]); setOpen(false); return; }
    // Idagdag sa query ang mga bahagi ng context na hindi pa naitataype para
    // sa NAPILING bayan ang mga suggestion, hindi kung saan-saang probinsya.
    const ctx = (context ?? "").split(",").map((s) => s.trim()).filter(Boolean)
      .filter((p) => !q.toLowerCase().includes(p.toLowerCase()));
    const scoped = ctx.length ? `${q}, ${ctx.join(", ")}` : q;
    const b = bias ?? { lat: 14.36, lng: 121.06 }; // default: San Pedro, Laguna
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const fetchFeats = async (query: string): Promise<Feature[]> => {
          const r = await fetch(
            `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=en&lat=${b.lat}&lon=${b.lng}&bbox=${PH_BBOX}`
          );
          const j = await r.json();
          return ((j.features ?? []) as Feature[]).filter((f) => {
            const [lon, lat] = f.geometry.coordinates;
            return inPH(lat, lon) && (f.properties.country == null || /phil/i.test(f.properties.country));
          });
        };
        let feats = await fetchFeats(scoped);
        if (!feats.length && scoped !== q) feats = await fetchFeats(q);
        setResults(feats);
        setOpen(true);
        setActive(-1);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  }

  function pick(f: Feature) {
    const [lon, lat] = f.geometry.coordinates;
    // Panatilihin ang Blk/Lot/Phase ng itinaype sa unahan ng napiling label —
    // wala ito sa geocoder pero ito ang tunay na address ng bahay.
    const noise = (valRef.current.match(NOISE_RE) ?? []).join(" ").replace(/\s{2,}/g, " ").replace(/[,\s]+$/g, "").trim();
    const base = label(f.properties);
    const text = noise ? `${noise} ${base}` : base;
    onChange(text);
    onPick({ lat, lng: lon, address: text });
    setOpen(false);
    setResults([]);
  }

  return (
    <label className="block mb-3 col-span-2">
      <span className="block text-xs font-bold text-stone mb-1">{fieldLabel}</span>
      <div ref={boxRef} className="relative">
        <input
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => { onChange(e.target.value); search(e.target.value); }}
          onFocus={() => { if (results.length) setOpen(true); }}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(results[active]); }
            else if (e.key === "Escape") setOpen(false);
          }}
          className={`w-full border bg-white px-4 py-3 text-sm rounded focus:outline-none focus:border-cognac ${
            error ? "border-red-600" : "border-stone/40"
          }`}
        />
        {open && (loading || results.length > 0) && (
          <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded border border-stone/40 bg-white shadow-xl">
            {loading && <div className="px-4 py-2 text-xs text-stone">Searching…</div>}
            {results.map((f, i) => (
              <button
                key={i}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(f)}
                className={`block w-full border-b border-stone/20 px-4 py-2.5 text-left last:border-0 ${
                  active === i ? "bg-sand/60" : "hover:bg-sand/40"
                }`}
              >
                <span className="block text-sm font-medium text-ink">
                  {f.properties.name || f.properties.street || label(f.properties)}
                </span>
                <span className="block text-xs text-stone">{label(f.properties)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <span className="text-red-700 text-xs">{error}</span>}
    </label>
  );
}
