"use client";

// LocationPicker — draggable pin sa OpenStreetMap (Leaflet). Libre, walang
// API key. Para i-pin ng customer ang eksaktong address nila sa checkout.
// Ang napiling coords + address ay ibinabalik sa parent (naka-save sa order).

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

// Simpleng SVG pin bilang data-URI (iwas CDN marker na hina-harang ng CSP)
const PIN_SVG =
  "data:image/svg+xml;base64," +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 11 15 27 15 27s15-16 15-27C30 6.7 23.3 0 15 0z" fill="#b1502e"/>
      <circle cx="15" cy="15" r="6" fill="#fff"/>
    </svg>`
  );

export type PickedLocation = {
  lat: number; lng: number; address: string; postcode?: string;
  // ANG KALYE LANG, hiwalay sa buong address. Ang `address` ay ang buong
  // display_name ("Bulalo, Tanauan-Talisay-Tagaytay Road, Poblacion 5, Banga,
  // Miranda, Talisay, Batangas, Calabarzon, 4220, Philippines") — kapag
  // isinalpak iyon sa Street field, madodoble ang bayan at lalawigan na nasa
  // dropdowns na. Ito ang bahaging tunay na napupunta sa kahon na iyon.
  street?: string;
  // ANG LUGAR NA ITINURO, para masabi ng tumatawag kung tugma ito sa mga
  // dropdown. Kapag hindi, ang shipping fee ay sa MALING bayan galing — ang
  // pin sa San Pedro habang nakatakda ang Paete ay nagbibigay ng ₱1 na
  // pamasahe para sa biyaheng hindi ganoon.
  city?: string;
  province?: string;
  barangay?: string;
};

export default function LocationPicker({
  value,
  onChange,
  flyTo,
}: {
  value?: { lat: number; lng: number } | null;
  onChange: (loc: PickedLocation) => void;
  // Query (e.g. "Calauan, Laguna, Philippines") — kapag nagbago, lilipat
  // ang mapa + pin doon (forward geocode via Nominatim).
  flyTo?: string;
}) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);

  // Default: San Pedro, Laguna (base ng tindahan)
  const start = value ?? { lat: 14.3583, lng: 121.0583 };

  // Reverse-geocode via OSM Nominatim (libre; walang key)
  async function reverse(lat: number, lng: number) {
    setLoading(true);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        { headers: { "Accept-Language": "en" } }
      );
      const j = await r.json();
      const addr = j.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      const a = (j.address ?? {}) as Record<string, string | undefined>;
      const postcode = a.postcode;
      // Numero muna kung meron, tapos ang kalye. Ang Nominatim ay may
      // magkakaibang pangalan para sa kalye depende sa uri ng lugar, kaya
      // sinusubukan ang mga ito ayon sa pagiging tiyak — ang subdivision o
      // purok ay isinasama bilang pangalawang bahagi kung iba ito.
      const road = a.road || a.pedestrian || a.footway || a.residential || a.neighbourhood || "";
      const area = a.hamlet || a.suburb || a.quarter || "";
      // ANG PALATANDAAN ANG UNANG SINASABI NG TAO. Kapag ang pin ay nasa isang
      // gusali — paaralan, simbahan, mall — iyon ang tinutukoy nila, hindi ang
      // kalye: "sa tapat ng Carmona National High School". Ang Nominatim ay
      // nagbabalik nito bilang amenity/building/shop, hiwalay sa `road`.
      const place = a.amenity || a.building || a.shop || a.office || a.tourism || "";
      const street = [
        place,
        [a.house_number, road].filter(Boolean).join(" "),
        area && area !== road && area !== place ? area : "",
      ].filter(Boolean).join(", ");
      setAddress(addr);
      // Ang Nominatim ay may iba't ibang antas depende sa uri ng lugar: ang
      // lungsod ay `city`, ang bayan ay `town`, ang maliit ay `municipality`.
      const cityName = a.city || a.town || a.municipality || a.village || "";
      // Ang `state` ay ang lalawigan sa PH; ang `region` ay CALABARZON atbp.
      const provinceName = a.state || a.province || "";
      const brgy = a.suburb || a.quarter || a.neighbourhood || a.village || "";
      onChange({
        lat, lng, address: addr, postcode,
        street: street || undefined,
        city: cityName || undefined,
        province: provinceName || undefined,
        barangay: brgy || undefined,
      });
    } catch {
      const addr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      setAddress(addr);
      onChange({ lat, lng, address: addr });
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapEl.current || mapRef.current) return;

      const icon = L.icon({
        iconUrl: PIN_SVG,
        iconSize: [30, 42],
        iconAnchor: [15, 42],
      });

      const map = L.map(mapEl.current).setView([start.lat, start.lng], 15);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      const marker = L.marker([start.lat, start.lng], {
        icon,
        draggable: true,
      }).addTo(map);

      marker.on("dragend", () => {
        const p = marker.getLatLng();
        reverse(p.lat, p.lng);
      });
      map.on("click", (e: any) => {
        marker.setLatLng(e.latlng);
        reverse(e.latlng.lat, e.latlng.lng);
      });

      mapRef.current = map;
      markerRef.current = marker;
      // fix: minsan kailangan i-refresh ang size pagkatapos mag-mount
      setTimeout(() => map.invalidateSize(), 200);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kapag nagbago ang napiling province+city -> forward geocode -> lumipat
  // ang mapa at pin doon (pero HINDI iaano-verride kung nag-drag na ang user)
  //
  // PH LANG: countrycodes=ph = HARD filter kay Nominatim. Dati free-text lang
  // ("Barangay, City, Province, Philippines") — kapag walang exact match ang
  // barangay sa OSM, nagda-drop si Nominatim ng terms at ang KAPANGALANG lugar
  // sa ibang bansa ang naibabalik, kaya tumatalon ang pin sa labas ng Pilipinas.
  // Dagdag pa: fallback chain (Barangay → City → Province, Shopee-style) para
  // laging may mapupuntahan ang mapa, at coordinate sanity check bilang pangwakas
  // na bantay.
  const flyDone = useRef<string>("");
  useEffect(() => {
    if (!flyTo || flyTo === flyDone.current) return;
    flyDone.current = flyTo;
    let cancelled = false;
    (async () => {
      const inPH = (lat: number, lng: number) =>
        lat >= 4.2 && lat <= 21.6 && lng >= 116 && lng <= 127.5;
      const parts = flyTo
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !/^philippines$/i.test(s));
      // ["Brgy, City, Prov", "City, Prov", "Prov"] — palapit nang palapit na zoom
      // sa mas espesipikong tama.
      const attempts = parts.map((_, i) => ({
        q: [...parts.slice(i), "Philippines"].join(", "),
        zoom: [16, 14, 11][Math.min(i, 2)],
      }));
      for (let i = 0; i < attempts.length; i++) {
        // Nominatim policy: max 1 request/segundo — maghintay bago ang fallback.
        if (i > 0) await new Promise((res) => setTimeout(res, 1100));
        if (cancelled) return;
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&q=${encodeURIComponent(attempts[i].q)}`,
            { headers: { "Accept-Language": "en" } }
          );
          const j = await r.json();
          if (cancelled || !mapRef.current || !markerRef.current) return;
          if (!j[0]) continue; // wala sa OSM ang level na ito — subukan ang mas malawak
          const lat = parseFloat(j[0].lat);
          const lng = parseFloat(j[0].lon);
          if (!inPH(lat, lng)) continue; // hindi dapat mangyari (countrycodes=ph), pero siguraduhin
          mapRef.current.setView([lat, lng], attempts[i].zoom, { animate: true });
          markerRef.current.setLatLng([lat, lng]);
          reverse(lat, lng); // punan agad ang address ng gitna ng lugar
          return;
        } catch {
          /* walang net / geocode fail — subukan ang susunod na level */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo]);

  // Panlabas na pagbabago ng value (hal. pumili ng street suggestion sa
  // Street field) → ilipat ang mapa+pin doon. Ang sariling drag/click/GPS ay
  // hindi gumagalaw ulit — ang marker ay nasa parehong coords na, kaya
  // nilalaktawan ng guard.
  useEffect(() => {
    if (!value || !mapRef.current || !markerRef.current) return;
    const cur = markerRef.current.getLatLng();
    if (Math.abs(cur.lat - value.lat) < 1e-7 && Math.abs(cur.lng - value.lng) < 1e-7) return;
    mapRef.current.setView([value.lat, value.lng], 17, { animate: true });
    markerRef.current.setLatLng([value.lat, value.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  // Hanapin ang lokasyon ng user (GPS)
  function locateMe() {
    if (!navigator.geolocation) return;
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (mapRef.current && markerRef.current) {
          mapRef.current.setView([latitude, longitude], 17);
          markerRef.current.setLatLng([latitude, longitude]);
        }
        reverse(latitude, longitude);
      },
      () => setLoading(false),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-stone">
          📍 Pin your exact location (for delivery)
        </span>
        <button
          type="button"
          onClick={locateMe}
          className="text-xs text-cognac hover:text-ink font-bold"
        >
          🎯 Find me
        </button>
      </div>
      <div
        ref={mapEl}
        className="w-full h-64 rounded border border-stone/40 overflow-hidden z-0"
      />
      <p className="text-xs text-stone mt-1 leading-snug">
        {loading
          ? "Getting address…"
          : address
          ? <>Selected: <span className="text-ink">{address}</span></>
          : "Drag the pin or tap the map to set your exact spot (streets & corners visible)."}
      </p>
    </div>
  );
}
