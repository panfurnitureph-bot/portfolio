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

export type PickedLocation = { lat: number; lng: number; address: string; postcode?: string };

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
      const postcode = j.address?.postcode as string | undefined;
      setAddress(addr);
      onChange({ lat, lng, address: addr, postcode });
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
  const flyDone = useRef<string>("");
  useEffect(() => {
    if (!flyTo || flyTo === flyDone.current) return;
    flyDone.current = flyTo;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(flyTo)}`,
          { headers: { "Accept-Language": "en" } }
        );
        const j = await r.json();
        if (cancelled || !j[0] || !mapRef.current || !markerRef.current) return;
        const lat = parseFloat(j[0].lat);
        const lng = parseFloat(j[0].lon);
        mapRef.current.setView([lat, lng], 14, { animate: true });
        markerRef.current.setLatLng([lat, lng]);
        reverse(lat, lng); // punan agad ang address ng gitna ng bayan
      } catch {
        /* walang net / geocode fail — ok lang, gagana pa rin ang manual pin */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo]);

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
