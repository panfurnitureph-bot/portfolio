"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type GeoPoint = { lat: number; lng: number } | null;

type Feature = {
  geometry: { coordinates: [number, number] }; // [lon, lat]
  properties: {
    name?: string; housenumber?: string; street?: string; district?: string;
    city?: string; county?: string; state?: string; postcode?: string; country?: string;
  };
};

// PH bounding box — HARD na hangganan ng lahat ng geocode results. Ang Photon
// ay "bias" lang ang lat/lon (hindi filter), kaya ang kapangalang lugar sa
// ibang bansa ay nakakalusot at tumatalon ang pin sa labas ng Pilipinas.
// Ipinapasa rin ito bilang bbox param kay Photon (minLon,minLat,maxLon,maxLat)
// at dinodoble-check dito ang koordinada ng bawat resulta.
const PH_BBOX = "116,4.2,127.5,21.6";
const inPH = (lat: number, lng: number) => lat >= 4.2 && lat <= 21.6 && lng >= 116 && lng <= 127.5;

// Subdivision noise na WALA sa OpenStreetMap — "BLK 27", "LOT 4", "Phase 2",
// "Unit 3B", "Purok 5". Kapag kasama ito sa query, walang maibabalik si Photon
// kahit tama ang kalye. Tinatanggal ito sa GEOCODE query lang (mananatili sa
// itinaype/naka-save na address — kailangan ito ng driver sa mismong bahay).
// Ang \w*\d\w* ay token na may numero — hindi matatamaan ang "Philippines".
const NOISE_RE = /\b(?:blk|block|lot|phase|unit|bldg|building|purok)\.?\s*#?\s*\w*\d\w*\b[,\s]*/gi;
const stripNoise = (s: string) =>
  s.replace(NOISE_RE, "").replace(/\s{2,}/g, " ").replace(/^[,\s]+|[,\s]+$/g, "");

// Build a readable one-line address from Photon properties.
export type AddressParts = { district?: string; city?: string; county?: string; state?: string; postcode?: string; street?: string };
function partsOf(p: Feature["properties"]): AddressParts {
  return { district: p.district, city: p.city, county: p.county, state: p.state, postcode: p.postcode, street: p.street || p.name };
}
function label(p: Feature["properties"]): string {
  const line1 = [p.housenumber, p.street || p.name].filter(Boolean).join(" ");
  const parts = [line1, p.district, p.city || p.county, p.state, p.postcode].filter(Boolean);
  return [...new Set(parts)].join(", ");
}

// Address typeahead backed by Photon (OpenStreetMap geocoder — free, no API key).
// Biased toward the Philippines (Laguna/CALABARZON). On select, returns the chosen
// address text plus its lat/lng so the order carries an exact delivery pin.
export function AddressAutocomplete({
  value, coords, onChange, centerQuery, scopeQuery, placeholder,
}: {
  value: string;
  coords: GeoPoint;
  // `parts` = hiwa-hiwalay na bahagi ng napiling lugar (mula sa geocoder) —
  // ginagamit ng form para auto-fill ang Province / City / Barangay.
  onChange: (address: string, coords: GeoPoint, parts?: AddressParts) => void;
  // Pag kumpleto na ang Province/City/Barangay (Shopee-style): awtomatikong
  // bubuksan ang mapa, ige-geocode ang barangay, at doon ilalagay ang pin —
  // ida-drag na lang ng staff/customer sa mismong bahay.
  centerQuery?: string;
  // Scope ng typeahead — ang NAPILI NA (kahit Province lang). Hiwalay ito sa
  // centerQuery: ang auto-center ay naghihintay ng kumpletong tatlo, pero ang
  // search ay kailangang ma-scope AGAD. Kung wala ito, ang "Malvar Street" na
  // itinaype habang "Laguna" pa lang ang napili ay hinahanap sa BUONG bansa —
  // Lucena, Quezon ang nauuna at doon napupunta ang pin (naiulat 2026-08-08).
  scopeQuery?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [showMap, setShowMap] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapDiv = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  const valRef = useRef(value);
  valRef.current = value;

  // Move/refine the pin from the map → update coords + reverse-geocode the address.
  async function updatePin(lat: number, lng: number) {
    onChange(valRef.current, { lat, lng });
    try {
      const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en`);
      const j = await r.json();
      const f = (j.features ?? [])[0] as Feature | undefined;
      if (f) onChange(label(f.properties), { lat, lng }, partsOf(f.properties));
    } catch { /* keep typed address */ }
  }

  // Build / tear down the Leaflet map when toggled open.
  useEffect(() => {
    if (!showMap || !mapDiv.current) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapDiv.current) return;
      const center: [number, number] = coords ? [coords.lat, coords.lng] : [14.20, 121.10];
      map = L.map(mapDiv.current).setView(center, coords ? 17 : 12);
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "" }).addTo(map);
      // Branded dot pin (dating emoji pin) — gold circle na may espresso ring.
      const icon = L.divIcon({ html: '<div style="width:16px;height:16px;border-radius:50%;background:#caa45a;border:3px solid #4a3b1a;box-shadow:0 2px 4px rgba(0,0,0,.4)"></div>', className: "", iconSize: [16, 16], iconAnchor: [8, 8] });
      const marker = L.marker(center, { draggable: true, icon }).addTo(map);
      markerRef.current = marker;
      marker.on("dragend", () => { const p = marker.getLatLng(); updatePin(p.lat, p.lng); });
      map.on("click", (e: { latlng: { lat: number; lng: number } }) => { marker.setLatLng(e.latlng); updatePin(e.latlng.lat, e.latlng.lng); });
      // NAG-AABANG NG SUKAT (2026-08-29). Ang mapa ay ginagawa habang tumataas
      // pa ang modal, kaya 0×0 pa ang kahon nito; ang pagkaantala ang
      // naghihintay sa huling sukat. Pero kapag naisara ang modal bago maabot
      // ang 60ms, ang mapa ay tanggal na — buhay pa rin ang variable, kaya
      // hindi ito nahuhuli ng `map &&`, at ang invalidateSize ay naghahanap ng
      // _leaflet_pos sa DOM node na wala na. Kanselahin ang timer sa cleanup.
      timer = setTimeout(() => { if (!cancelled) map.invalidateSize(); }, 60);
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Kapag naisara ang modal habang naghihintay pa ng `import("leaflet")`,
      // ang `map` ay null pa rito — pero maitatalaga pagkatapos, at maiiwan
      // ang mapa nang walang nagtatanggal. Bantayan iyon ng `cancelled` sa
      // itaas; ito ang naglilinis kapag naabot na ang paggawa.
      if (map) map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap]);

  // Keep the map/marker in sync when a search result sets new coords.
  useEffect(() => {
    // Ang `_mapPane` ay nawawala kapag natanggal na ang mapa; ang setView sa
    // ganoong instance ay parehong _leaflet_pos na pagkabigo.
    if (mapRef.current?._mapPane && markerRef.current && coords) {
      markerRef.current.setLatLng([coords.lat, coords.lng]);
      mapRef.current.setView([coords.lat, coords.lng], 17);
    }
  }, [coords]);

  // Awtomatikong buksan + i-center ang mapa sa barangay pag kumpleto ang dropdowns.
  const lastCenterRef = useRef("");
  useEffect(() => {
    const q = (centerQuery ?? "").trim();
    if (!q || q === lastCenterRef.current) return;
    lastCenterRef.current = q;
    let dead = false;
    (async () => {
      // Subukan ang buong "Barangay, City, Province"; pag walang tama si Photon
      // (maraming barangay ang wala sa geocoder), bumagsak sa "City, Province",
      // tapos "Province" — para gumalaw pa rin ang mapa REAL TIME sa bawat
      // pagpapalit ng dropdown. PH lang ang tinatanggap (bbox + inPH check);
      // ang resultang labas ng Pilipinas ay nilalaktawan, hindi ginagamit.
      const parts = q.split(",").map((x) => x.trim()).filter(Boolean);
      const attempts = parts.map((_, i) => parts.slice(i).join(", ") + ", Philippines");
      for (const attempt of attempts) {
        try {
          const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(attempt)}&limit=1&lang=en&lat=14.20&lon=121.10&bbox=${PH_BBOX}`);
          const j = await r.json();
          const c = j?.features?.[0]?.geometry?.coordinates;
          if (dead) return;
          if (Array.isArray(c) && inPH(Number(c[1]), Number(c[0]))) {
            onChange(valRef.current, { lat: Number(c[1]), lng: Number(c[0]) });
            setShowMap(true);
            return;
          }
        } catch { /* subukan ang susunod */ }
      }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerQuery]);

  // close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function search(raw: string) {
    if (timer.current) clearTimeout(timer.current);
    // Geocode ang address nang WALANG Blk/Lot/Phase — hindi ito kilala ng
    // geocoder at nagpapawala ng resulta kahit tama ang kalye/lugar.
    const stripped = stripNoise(raw);
    const q = stripped.length >= 3 ? stripped : raw;
    if (q.trim().length < 3) { setResults([]); setOpen(false); return; }
    // I-SCOPE sa napiling Province/City/Barangay (Shopee-style): idinadagdag sa
    // query ang mga bahagi ng centerQuery na hindi pa naitataype, at ang bias
    // ay ang kasalukuyang pin (barangay center) — kaya ang "amorsolo" ay kalye
    // sa NAPILING bayan ang isusuggest, hindi kung saan-saang probinsya.
    const ctx = (scopeQuery ?? centerQuery ?? "").split(",").map((s) => s.trim()).filter(Boolean)
      .filter((p) => !q.toLowerCase().includes(p.toLowerCase()));
    const scoped = ctx.length ? `${q}, ${ctx.join(", ")}` : q;
    const bias = coords ?? { lat: 14.20, lng: 121.10 };
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        // PH LANG ang ipinapakita — ang dating fallback sa unfiltered list ang
        // nagpapalabas ng ibang-bansang suggestion na napipili ng staff, kaya
        // may mga pin na napupunta sa ibang bansa. Walang PH match = walang
        // suggestion (mas tama ang manual pin kaysa maling bansa).
        const fetchFeats = async (query: string): Promise<Feature[]> => {
          const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=en&lat=${bias.lat}&lon=${bias.lng}&bbox=${PH_BBOX}`;
          const res = await fetch(url);
          const json = await res.json();
          return ((json.features ?? []) as Feature[]).filter((f) => {
            const [lon, lat] = f.geometry.coordinates;
            return inPH(lat, lon) && (f.properties.country == null || /phil/i.test(f.properties.country));
          });
        };
        // Scoped muna; pag walang tama (kalyeng wala sa OSM ng bayang iyon),
        // subukan nang walang scope para may maipakita pa rin.
        let feats = await fetchFeats(scoped);
        if (!feats.length && scoped !== q) feats = await fetchFeats(q);
        setResults(feats);
        setOpen(true); setActive(-1);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 350);
  }

  function pick(f: Feature) {
    const [lon, lat] = f.geometry.coordinates;
    // Panatilihin ang Blk/Lot/Phase ng itinaype sa unahan ng napiling label —
    // wala ito sa geocoder pero ito ang tunay na address ng bahay.
    const noise = (valRef.current.match(NOISE_RE) ?? []).join(" ").replace(/\s{2,}/g, " ").replace(/[,\s]+$/g, "").trim();
    const base = label(f.properties);
    onChange(noise ? `${noise} ${base}` : base, { lat, lng: lon }, partsOf(f.properties));
    setOpen(false); setResults([]); setShowMap(true);
  }

  const mapsUrl = coords ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}` : null;

  return (
    <div ref={boxRef} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value, null); search(e.target.value); }}
        onFocus={() => { if (results.length) setOpen(true); }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(results[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder ?? "Type street, barangay, city…"}
        autoComplete="off"
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
      />

      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        {coords && <span className="text-success">Pinned ({coords.lat.toFixed(5)}, {coords.lng.toFixed(5)})</span>}
        <button type="button" onClick={() => setShowMap((v) => !v)} className="text-primary underline">{showMap ? "Hide map" : "Pin exact spot on map"}</button>
        {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-primary underline">View on Google Maps</a>}
      </div>

      {showMap && (
        <div className="mt-2">
          <div ref={mapDiv} style={{ height: 340, width: "100%", borderRadius: 10, overflow: "hidden", border: "1px solid #e5e0d4", zIndex: 0 }} />
          <p className="mt-1 text-[11px] text-muted">Drag the or tap the map to set the exact spot (streets &amp; corners visible).</p>
        </div>
      )}

      {open && (loading || results.length > 0) && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-surface shadow-xl">
          {loading && <div className="px-3 py-2 text-xs text-muted">Searching…</div>}
          {results.map((f, i) => {
            const [lon, lat] = f.geometry.coordinates;
            return (
              <button
                key={i} type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(f)}
                className={`flex w-full items-start gap-2 border-b border-border/60 px-3 py-2 text-left last:border-0 ${active === i ? "bg-stone-100" : "hover:bg-stone-50"}`}
              >
                
                <span className="flex-1">
                  <span className="block text-sm font-medium text-foreground">{f.properties.name || f.properties.street || label(f.properties)}</span>
                  <span className="block text-xs text-muted">{label(f.properties)}</span>
                </span>
                <span className="mt-0.5 whitespace-nowrap text-[10px] text-muted">{lat.toFixed(3)}, {lon.toFixed(3)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
