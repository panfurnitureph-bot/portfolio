"use client";

// ROUTE PLANNER — per date + per team card ng mga BOOKED na stops (dq confirmed):
// drag-reorder ng stops, auto time windows (override-able), capacity bar,
// Maps / Print / Send.
//
// ISANG PINDUTAN ANG SEND (2026-08-26). Dalawa ito noon: ang Send ay push lang
// (walang naitatala) at ang Finalize ang naglalagay ng dq_route_final_at — kaya
// may rutang nasa tablet pero hindi naka-lock, o naka-lock pero hindi
// naipadala. Ang Send na ngayon ang naglo-lock, nagsesellyo at nagpupush; ang
// selyong iyon ang nagbubukas ng Pickup Task at ng Delivery Route.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, ReworkCell } from "./ui";
import { useLiveDeliveryRows } from "@/lib/live-rows";
import type { Delivery, TeamMeta } from "@/app/delivery/data";
import { saveStopOrder, setStopWindow, finalizeRoute, sendRouteToTeam, removeFromRoute } from "@/app/delivery/route-actions";

const WINDOWS = ["9–11 AM", "11 AM–1 PM", "1–3 PM", "3–5 PM"];
const peso = (n: number) => "₱" + (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtChip = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
const fmtConfirmed = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true })}`;
};
const fmtSched = (iso: string | null) => {
  if (!iso) return "—";
  try { return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function RoutePlanner({ rows: serverRows, teams }: { rows: Delivery[]; teams: TeamMeta[] }) {
  // LIVE TAPAL (0216): ang dq_* ng bawat hilera ay tinatapalan mula sa
  // broadcast — ang confirm sa ibang device ay gumagalaw dito nang ~0.3-0.8s,
  // hindi na hinihintay ang buong render. Ang filter sa ibaba ang kusang
  // naglilipat ng stop sa tamang petsa/team.
  const rows = useLiveDeliveryRows(serverRows);
  const router = useRouter();
  const [, start] = useTransition();
  const [selDate, setSelDate] = useState<string | null>(null);
  // Optimistic stop order per "date|team" card habang hinihintay ang server save.
  const [localOrder, setLocalOrder] = useState<Record<string, number[]>>({});
  const [drag, setDrag] = useState<{ key: string; index: number } | null>(null);

  const stops = useMemo(
    // WALA RITO ANG ON-SITE NA PAGKUHA (0209). Nang mag-declare ang team ay
    // nakatayo na sila sa customer at nakaparada ang trak sa harap — wala nang
    // iruruta. Ang hintong hindi naman inaayos ng planner ay dagdag na ingay
    // lang sa araw ni Ops, at nagmumukhang may gagawin pa siya rito.
    () => rows.filter((r) => r.dq_status === "confirmed" && r.dq_date && r.dq_team && r.order_id != null && !/delivered|failed/i.test(r.status) && !r.rework_pickup_onsite),
    [rows],
  );

  const dates = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stops) m.set(s.dq_date as string, (m.get(s.dq_date as string) ?? 0) + 1);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [stops]);

  const date = selDate && dates.some(([d]) => d === date0(selDate)) ? date0(selDate) : (dates[0]?.[0] ?? null);

  const teamCards = useMemo(() => {
    if (!date) return [];
    const byTeam = new Map<string, Delivery[]>();
    for (const s of stops.filter((s) => s.dq_date === date)) {
      const a = byTeam.get(s.dq_team as string) ?? [];
      a.push(s);
      byTeam.set(s.dq_team as string, a);
    }
    return [...byTeam.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([team, list]) => {
      const sorted = [...list].sort((x, y) =>
        (x.dq_stop ?? 999) - (y.dq_stop ?? 999) || String(x.dq_confirmed_at ?? "").localeCompare(String(y.dq_confirmed_at ?? "")));
      const key = `${date}|${team}`;
      const saved = localOrder[key];
      const ordered = saved
        ? saved.map((id) => sorted.find((s) => s.order_id === id)).filter((s): s is Delivery => !!s).concat(sorted.filter((s) => !saved.includes(s.order_id as number)))
        : sorted;
      return { key, team, list: ordered };
    });
  }, [stops, date, localOrder]);

  const allFinal = teamCards.length > 0 && teamCards.every((c) => c.list.every((s) => s.dq_final));

  const reorder = (key: string, list: Delivery[], from: number, to: number) => {
    if (from === to) return;
    const ids = list.map((s) => s.order_id as number);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setLocalOrder((p) => ({ ...p, [key]: ids }));
    start(async () => { await saveStopOrder(ids); router.refresh(); });
  };

  // WALANG headerless empty state — kapag walang stops, ipakita pa rin ang
  // buong table shell (kumpletong columns) na may empty-state row sa tbody.
  if (!stops.length) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#3a3226] bg-gradient-to-r from-[#5a4a26] to-[#4a3b1a] px-4 py-2.5">
          <p className="text-xs font-bold uppercase tracking-wide text-[#f4ead8]">
            Route Planner
            <span className="ml-2 font-medium normal-case text-[#c9b896]">No booked dates yet</span>
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-sm [&_th]:border-b [&_th]:border-r [&_th]:border-[#6b5a2f] [&_th:last-child]:border-r-0">
            <thead>
              <tr className="bg-[#5a4a26] text-[10px] uppercase tracking-widest text-[#e7dcc4]">
                <th className="px-3 py-2.5 text-center font-bold">Stop</th>
                <th className="px-3 py-2.5 text-left font-bold">Order #</th>
                <th className="px-3 py-2.5 text-center font-bold">RMA #</th>
                <th className="px-3 py-2.5 text-left font-bold">Customer</th>
                <th className="px-3 py-2.5 text-left font-bold">Address</th>
                <th className="px-3 py-2.5 text-center font-bold">Confirmed On</th>
                <th className="px-3 py-2.5 text-center font-bold">Delivery Date</th>
                <th className="px-3 py-2.5 text-center font-bold">Team</th>
                <th className="px-3 py-2.5 text-center font-bold">Driver</th>
                <th className="px-3 py-2.5 text-center font-bold">Time Window</th>
                <th className="px-3 py-2.5 text-right font-bold">Balance</th>
                <th className="px-3 py-2.5 text-center font-bold">Reorder</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={12} className="px-4 py-10 text-center text-sm text-muted">No booked stops yet — confirmed deliveries from the Delivery Queue appear here, grouped per date and team.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Date chips + katayuan ng araw */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">Date:</span>
        {dates.map(([d, n]) => (
          <button key={d} type="button" onClick={() => setSelDate(d)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-bold",
              d === date ? "bg-[#4a3b1a] text-[#f4ead8] ring-1 ring-[#caa45a]" : "border border-border bg-surface text-muted hover:border-[#caa45a]",
            )}>
            {fmtChip(d)} · {n === 1 ? "1" : `${n} stops`}
          </button>
        ))}
        {/* Ang Finalize ay pinagsama na sa Send ng bawat team (2026-08-26) —
            isang pindot ang naglo-lock at nagpapadala. Tanda na lang ito. */}
        <span className={cn(
          "ml-auto rounded-lg px-3 py-1.5 text-xs font-bold",
          allFinal ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20" : "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/25",
        )}>
          {allFinal ? "✓ All routes sent" : "Not sent yet — use Send on each team"}
        </span>
      </div>

      {teamCards.map(({ key, team, list }) => (
        <TeamCard key={key} cardKey={key} team={team} list={list} meta={teams.find((t) => t.name === team) ?? null}
          date={date as string} drag={drag} setDrag={setDrag} reorder={reorder} />
      ))}
    </div>
  );
}

function date0(s: string) { return s.slice(0, 10); }

function TeamCard({ cardKey, team, list, meta, date, drag, setDrag, reorder }: {
  cardKey: string; team: string; list: Delivery[]; meta: TeamMeta | null; date: string;
  drag: { key: string; index: number } | null;
  setDrag: (d: { key: string; index: number } | null) => void;
  reorder: (key: string, list: Delivery[], from: number, to: number) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cardNote, setCardNote] = useState<string | null>(null);
  const driver = list[0]?.dq_driver ?? meta?.driver ?? "—";
  const capacity = meta?.capacity ?? 5;

  const km = useMemo(() => {
    const pins = list.filter((s) => s.address_lat != null && s.address_lng != null).map((s) => ({ lat: Number(s.address_lat), lng: Number(s.address_lng) }));
    if (pins.length < 2) return null;
    let total = 0;
    for (let i = 1; i < pins.length; i++) total += haversineKm(pins[i - 1], pins[i]);
    return Math.round(total);
  }, [list]);

  const [showMap, setShowMap] = useState(false);

  // SEND = ANG GATE (2026-08-26). Push lang ito noon — walang naitatala — at ang
  // Finalize ang naglalagay ng dq_route_final_at. Dalawang pindot para sa isang
  // pasya, at ang pangalawa ay madaling makalimutan: naipadala na ang ruta sa
  // team pero hindi pa naka-lock, o naka-lock pero hindi naipadala.
  //
  // Isang pindot na: nilo-lock ang oras ng team na ito, sinesellyuhan ang
  // dq_route_final_at (ito ang binubuksan ang Pickup Task at ang Delivery
  // Route), at saka ipinapadala sa mga tablet.
  const send = () => {
    if (!date) return;
    start(async () => {
      const stops = list.map((sItem, i) => ({
        orderId: sItem.order_id as number,
        window: sItem.dq_window ?? WINDOWS[Math.min(i, WINDOWS.length - 1)],
      }));
      const res = await finalizeRoute({ dateISO: date, stops });
      if ("error" in res) { setCardNote(res.error); router.refresh(); return; }
      // AGAD ANG SAGOT (2026-08-30). Hinihintay noon ang FCM push bago
      // magsalita ang buton — segundo-segundo iyon, at mukhang walang
      // nangyari kaya pinipindot ulit. Ang selyo ang katotohanan at tapos na
      // iyon; ang push ay best-effort sa disenyo — pinapatakbo sa likod, at
      // ang note lang ang itinatama kapag nabigo.
      setCardNote(`Route sent to ${team} — ${res.count} stop${res.count === 1 ? "" : "s"}.`);
      router.refresh();
      void sendRouteToTeam({ team, driver, dateISO: date, stops: list.length, firstStop: list[0]?.address ?? null })
        .then((push) => {
          if ("error" in push) setCardNote(`Route sent — ${res.count} stop${res.count === 1 ? "" : "s"} locked, but the push failed.`);
        })
        .catch(() => {});
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      {/* Card header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[#3a3226] bg-gradient-to-r from-[#5a4a26] to-[#4a3b1a] px-4 py-2.5">
        <p className="text-xs font-bold uppercase tracking-wide text-[#f4ead8]">
          {team} · {driver}
          <span className="ml-2 font-medium normal-case text-[#c9b896]">{meta?.vehicle ? `${meta.vehicle} · ` : ""}{km != null ? `~${km} km` : ""}</span>
        </p>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#c9b896]">Capacity</span>
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[#3a3226]">
            <span className="block h-full rounded-full bg-[#caa45a]" style={{ width: `${Math.min((list.length / capacity) * 100, 100)}%` }} />
          </span>
          <span className="text-[11px] font-bold tabular-nums text-[#f4ead8]">{list.length}/{capacity}</span>
          <button type="button" onClick={() => setShowMap(true)} className="rounded-md bg-[#3a3226] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#e7dcc4] hover:bg-[#4a4030]">Maps</button>
          <button type="button" onClick={send} disabled={pending} title="Lock this team's schedule and send it to their tablets — this is what releases the stops to Pickup Task" className="whitespace-nowrap rounded-md bg-[#e7dcc4] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#2b2620] hover:opacity-90 disabled:opacity-60">{pending ? "Sending…" : "Finalize & Send"}</button>
        </div>
      </div>
      {cardNote && <p className="border-b border-border bg-[#faf6ec] px-4 py-2 text-[11px] font-medium text-[#5c421f]">{cardNote}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td:last-child]:border-r-0 [&_th]:border-b [&_th]:border-r [&_th]:border-[#6b5a2f] [&_th:last-child]:border-r-0">
          <thead>
            <tr className="bg-[#5a4a26] text-[10px] uppercase tracking-widest text-[#e7dcc4]">
              <th className="px-3 py-2.5 text-center font-bold">Stop</th>
              <th className="px-3 py-2.5 text-left font-bold">Order #</th>
              <th className="px-3 py-2.5 text-center font-bold">RMA #</th>
              <th className="px-3 py-2.5 text-left font-bold">Customer</th>
              <th className="px-3 py-2.5 text-left font-bold">Address</th>
              <th className="px-3 py-2.5 text-center font-bold">Confirmed On</th>
              <th className="px-3 py-2.5 text-center font-bold">Delivery Date</th>
              <th className="px-3 py-2.5 text-center font-bold">Team</th>
              <th className="px-3 py-2.5 text-center font-bold">Driver</th>
              <th className="px-3 py-2.5 text-center font-bold">Time Window</th>
              <th className="px-3 py-2.5 text-right font-bold">Balance</th>
              <th className="px-3 py-2.5 text-center font-bold">Reorder</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s, i) => (
              <StopRow key={s.order_id} s={s} i={i} cardKey={cardKey}
                dragging={drag?.key === cardKey ? drag.index : null}
                onDragStart={() => setDrag({ key: cardKey, index: i })}
                onDrop={() => { if (drag?.key === cardKey) { reorder(cardKey, list, drag.index, i); } setDrag(null); }} />
            ))}
          </tbody>
        </table>
      </div>

      {showMap && <RouteMapModal team={team} driver={driver} date={date} list={list} onClose={() => setShowMap(false)} />}
    </div>
  );
}

// ── In-app route map: MISMONG Google Maps embed — pins sa customer addresses;
// 2+ stops = directions view sa stop order. Walang API key na kailangan.
// (Exported — ginagamit din ng Driver Routes dashboard.)
export function RouteMapModal({ team, driver, date, list, onClose }: { team: string; driver: string; date: string; list: Delivery[]; onClose: () => void }) {
  // Stops na walang saved pin: i-geocode ang address (Photon/OSM — same engine ng
  // address autocomplete) para SIGURADONG may eksaktong pointer sa embed, hindi
  // search-result dots lang.
  const [geo, setGeo] = useState<Record<number, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const s of list) {
        if (s.address_lat != null && s.address_lng != null) continue;
        if (!s.address || s.order_id == null || geo[s.order_id]) continue;
        try {
          const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(s.address)}&limit=1&lang=en`);
          const j = await r.json();
          const c = j?.features?.[0]?.geometry?.coordinates; // [lng, lat]
          if (!cancelled && Array.isArray(c) && c.length >= 2) {
            setGeo((p) => ({ ...p, [s.order_id as number]: `${c[1]},${c[0]}` }));
          }
        } catch { /* best-effort — address text fallback na lang */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const pts = useMemo(
    () => list.map((s) => {
      if (s.address_lat != null && s.address_lng != null) return `${s.address_lat},${s.address_lng}`;
      if (s.order_id != null && geo[s.order_id]) return geo[s.order_id];
      return s.address ? encodeURIComponent(s.address) : "";
    }).filter(Boolean),
    [list, geo],
  );
  const missing = list.length - pts.length;

  // NUMBERED overview (sariling Leaflet page): kapag may coordinates ang mga stop,
  // ang mapa mismo ang may 1..N pins sa pagkakasunod ng biyahe + OSRM route.
  const numberedStops = useMemo(
    () => list.map((s) => {
      const ll = s.address_lat != null && s.address_lng != null
        ? [Number(s.address_lat), Number(s.address_lng)]
        : (s.order_id != null && geo[s.order_id] ? geo[s.order_id].split(",").map(Number) : null);
      return ll && ll.length === 2 && !ll.some(isNaN) ? { lat: ll[0], lng: ll[1], name: s.customer_name ?? s.order_number ?? "" } : null;
    }).filter((x): x is { lat: number; lng: number; name: string } => x != null),
    [list, geo],
  );

  const embedUrl = useMemo(() => {
    if (numberedStops.length > 0) return `/route-overview.html?stops=${encodeURIComponent(JSON.stringify(numberedStops))}`;
    if (!pts.length) return null;
    if (pts.length === 1) return `https://maps.google.com/maps?q=${pts[0]}&z=16&output=embed`;
    const [first, ...rest] = pts;
    const last = rest.pop() as string;
    return `https://maps.google.com/maps?saddr=${first}&daddr=${last}${rest.length ? rest.map((p) => `+to:${p}`).join("") : ""}&dirflg=d&output=embed`;
  }, [numberedStops, pts]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[#3a3226] bg-[#1f1a12] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-[#3a3226] bg-gradient-to-r from-[#5a4a26] to-[#4a3b1a] px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[#f4ead8]">
            Route — {team} · {driver}
            <span className="ml-2 font-medium normal-case text-[#c9b896]">{date} · {list.length} stop{list.length === 1 ? "" : "s"}</span>
          </p>
          <button type="button" onClick={onClose} className="ml-auto rounded-md px-2 py-1 text-lg leading-none text-[#c9b896] hover:text-white">✕</button>
        </div>
        {embedUrl
          ? <iframe src={embedUrl} title="Delivery route map" className="h-[70vh] w-full border-0 bg-white" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          : <div className="flex h-[40vh] items-center justify-center px-8 text-center text-sm text-[#9a8f76]">No map pins or addresses on these stops yet — set delivery locations on the orders first.</div>}
        {missing > 0 && embedUrl && (
          <p className="border-t border-[#3a3226] px-4 py-2 text-[11px] text-[#9a8f76]">
            {missing} stop{missing === 1 ? "" : "s"} without a pin or address — not included in the route.
          </p>
        )}
      </div>
    </div>
  );
}

function StopRow({ s, i, cardKey, dragging, onDragStart, onDrop }: {
  s: Delivery; i: number; cardKey: string; dragging: number | null;
  onDragStart: () => void; onDrop: () => void;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const auto = WINDOWS[Math.min(i, WINDOWS.length - 1)];
  const win = s.dq_window ?? auto;

  return (
    <tr
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={cn("border-b border-border last:border-0 hover:bg-stone-50", dragging === i && "opacity-50")}
    >
      <td className="px-3 py-3 text-center">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700 ring-1 ring-inset ring-blue-300">{i + 1}</span>
      </td>
      <td className="px-3 py-3 font-mono text-xs font-semibold">{s.order_number ?? "—"}</td>
      <td className="px-3 py-3 text-center"><ReworkCell isRework={s.is_rework} rmaNo={s.rma_no} leg={s.rework_wear ?? s.rework_leg} /></td>
      <td className="px-3 py-3 font-semibold">{s.customer_name ?? "—"}</td>
      <td className="max-w-[260px] px-3 py-3 text-xs text-muted">
        <span className="block truncate" title={s.address ?? undefined}>{s.address ?? "—"}</span>
        {s.pickup_location && <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700 ring-1 ring-inset ring-orange-200">{s.pickup_location}</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-center text-xs text-muted" title="When the customer confirmed">{fmtConfirmed(s.dq_confirmed_at)}</td>
      <td className="whitespace-nowrap px-3 py-3 text-center text-sm font-bold">{fmtSched(s.dq_date)}</td>
      <td className="px-3 py-3 text-center text-xs">{s.dq_team}</td>
      <td className="px-3 py-3 text-center text-xs">{s.dq_driver ?? "—"}</td>
      <td className="px-3 py-3 text-center">
        <select
          value={s.dq_window ?? ""}
          onChange={(e) => { const v = e.target.value || null; start(async () => { await setStopWindow(s.order_id as number, v); router.refresh(); }); }}
          className="rounded-md border border-transparent bg-transparent text-center text-xs font-bold text-blue-700 outline-none hover:border-border"
          title="Auto window from stop order — pick one to override"
        >
          <option value="">{win} (auto)</option>
          {WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <span className="block text-[9px] uppercase tracking-wide text-muted">{s.dq_window ? "manual" : "auto · editable"}{s.dq_final ? " · " : ""}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums">{peso(s.balance_due)}</td>
      <td className="whitespace-nowrap px-3 py-3 text-center">
        <span className="cursor-grab text-lg text-muted active:cursor-grabbing" title={`Drag to reorder (${cardKey})`}>≡</span>
        {/* TANGGAL SA RUTA (2026-09-02): linisin ang booking — babalik ang order
            sa Delivery Queue; hindi ito pagkansela ng order. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!window.confirm(`Remove ${s.order_number ?? "this stop"} from the route? It goes back to the Delivery Queue.`)) return;
            start(async () => {
              const res = await removeFromRoute(s.order_id as number);
              if ("error" in res) { window.alert(res.error); return; }
              router.refresh();
            });
          }}
          className="ml-2 rounded px-1.5 py-0.5 text-sm font-bold text-muted hover:bg-rose-50 hover:text-rose-600"
          title="Remove from route — the order returns to the Delivery Queue"
        >✕</button>
      </td>
    </tr>
  );
}
