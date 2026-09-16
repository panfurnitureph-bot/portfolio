"use client";

// DRIVER ROUTES — kanya-kanyang dashboard per team (A/B/C/D), KAPAREHONG UI
// ng Route Planner table: ang naka-login na driver ay diretso (at naka-lock) sa
// SARILING route ng araw; Ops/Admin ay may team chips para silipin ang bawat isa.
// Ang bawat stop ay galing mismo sa Route Planner (dq_* sa orders); ang Navigate
// ay ang existing Waze-style delivery map (full-screen in-app, hindi bagong tab).

import { useEffect, useMemo, useState } from "react";
import { cn, ReworkCell } from "./ui";
import { RouteMapModal } from "./route-planner";
import { DeliveryModal } from "./delivery-manager";
import type { EmpOpt } from "./employee-picker";
import { useLiveDeliveryRows } from "@/lib/live-rows";
import type { Delivery, TeamMeta } from "@/app/delivery/data";

const WINDOWS = ["9–11 AM", "11 AM–1 PM", "1–3 PM", "3–5 PM"];
const peso = (n: number) => "₱" + (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtChip = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
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

function statusPill(s: string) {
  const v = (s ?? "").toLowerCase();
  if (/delivered/.test(v)) return "bg-green-50 text-green-700";
  if (/arrived/.test(v)) return "bg-teal-50 text-teal-700";
  if (/out for/.test(v)) return "bg-blue-50 text-blue-700";
  if (/qc passed|qa passed/.test(v)) return "bg-violet-50 text-violet-700";
  if (/failed/.test(v)) return "bg-rose-50 text-rose-700";
  return "bg-amber-50 text-amber-700";
}

function todayISO(): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function DriverRoutes({ rows: serverRows, teams, userName, isPrivileged, forceTeam = null, drivers = [], qaNames = [], coordinators = [], mode = "delivery" }: {
  rows: Delivery[]; teams: TeamMeta[]; userName: string; isPrivileged: boolean;
  // Dedicated per-team page (isang tablet = isang team): naka-pinned sa team na
  // ito, walang team chips kahit Ops/Admin ang naka-login.
  forceTeam?: string | null;
  drivers?: EmpOpt[]; qaNames?: EmpOpt[]; coordinators?: EmpOpt[];
  // DALAWANG RUTA, IISANG COMPONENT (hiling 2026-08-28):
  //   "delivery" — hatid at pull-out; ang gamit ay may kinukuha o dinadala
  //   "onsite"   — pagkumpuni sa BAHAY ng customer; walang dalang gamit
  // Magkahiwalay ang listahan dahil magkaibang gawain, pero iisang mapa at
  // iisang hakbang ang sinusundan: i-Waze, dumating, tapusin.
  mode?: "delivery" | "onsite";
}) {
  // GATE: FINALIZED lang sa Route Planner (dq_final) ang lalabas sa driver —
  // ang planner ang nagdidikta ng pagkakasunod at time windows bago ipadala.
  //
  // AT KAILANGANG NAKUHA NA (0186). Ang isang bagay na nasa istante o nasa
  // workshop pa ay wala sa trak, kaya wala rin itong dapat gawin sa ruta — ang
  // Pickup Task muna ang daraanan nito. Ang naikarga na, ang naiuwi na, at ang
  // mga naunang stop na walang naitalang pickup ay dumadaan pa rin: ang huli ay
  // hindi dapat maipit ng panuntunang wala pa noong iruta sila.
  // ANG ON-SITE AY WALANG PICKUP GATE. Walang gamit na dapat munang makuha sa
  // istante o sa workshop — nasa customer na ito, at doon mismo kukumpunihin.
  // Ang paghihintay ng `pickedUp` ay magtatago sa bawat on-site visit habang
  // buhay. Ang mode na ito ang nagsasala kung alin ang nakikita ng bawat ruta.
  const isOnsite = (r: Delivery) => !!r.is_rework && r.rework_mode === "onsite";
  // ANG PULL-OUT PICKUP AY NASA SARILING PAHINA. Nasa Route Planner ito
  // (2026-08-28) para makita ni Ops ang buong araw ng team at maisama sa
  // pagkakasunod — pero ang GAWAIN ay nasa Rework (Pull Out): doon ang Pickup
  // Proof at ang Drop Proof. Kung lalabas din ito rito, dalawang lugar ang
  // LIVE TAPAL (0216): kapareho ng Route Planner — ang dq_*/delivery status ay
  // tinatapalan mula sa broadcast para ang stop ay lumipat/lumitaw sa rutang
  // ito nang hindi hinihintay ang render.
  const rows = useLiveDeliveryRows(serverRows);
  // masusundan ng driver para sa iisang stop, at ang isa ay walang proof gate.
  const isPullPickup = (r: Delivery) => !!r.is_rework && r.rework_leg === "pickup";
  const stops = useMemo(
    () => rows.filter((r) => r.dq_status === "confirmed" && r.dq_date && r.dq_team && r.dq_final && !/failed/i.test(r.status))
      .filter((r) => (mode === "onsite" ? isOnsite(r) : !isOnsite(r) && !isPullPickup(r)))
      .filter((r) => mode === "onsite" || r.pickedUp || /out for delivery|arrived|delivered|complete/i.test(r.status))
      // ANG TAPOS NA BISITA AY WALA NANG GAWAIN (2026-08-30). Sa paghahatid ay
      // nananatili ang natapos — iyon ang "0/1 delivered" na sinusundan ng
      // driver sa araw na iyon. Sa on-site rework ay walang susunod na hakbang:
      // isang bisita ang buong RMA, at pagkarating ay sa Installation Tracking
      // na ang natitira. Ang pag-iwan dito ay nagpapakita ng gawaing wala nang
      // dapat gawin, at ang bilang ng "Pending" ay hindi na tumutugma sa
      // nakikita.
      .filter((r) => mode !== "onsite" || !/arrived|delivered|complete/i.test(r.status)),
    [rows, mode],
  );

  // Ilan ang nakaruta na pero hindi pa nakukuha — para masabi kung bakit
  // blangko ang listahan sa halip na iwang nagtataka ang driver.
  const awaitingPickup = useMemo(
    () => (mode === "onsite" ? 0 : rows.filter((r) => r.dq_status === "confirmed" && r.dq_date && r.dq_team && r.dq_final
      && !isOnsite(r) && !r.pickedUp && !/out for delivery|arrived|delivered|complete|failed/i.test(r.status)).length),
    [rows, mode],
  );

  // Sariling team ng naka-login (match sa driver name ng stop o ng team meta).
  const me = userName.trim().toLowerCase();
  const myTeam = useMemo(() => {
    const hit = stops.find((s) => (s.dq_driver ?? "").trim().toLowerCase() === me)?.dq_team
      ?? teams.find((t) => (t.driver ?? "").trim().toLowerCase() === me)?.name;
    return hit ?? null;
  }, [stops, teams, me]);
  const locked = !isPrivileged && !!myTeam;

  const teamNames = useMemo(() => {
    const withStops = new Set(stops.map((s) => s.dq_team as string));
    const all = new Set<string>([...teams.map((t) => t.name), ...withStops]);
    return [...all].sort();
  }, [teams, stops]);

  const [selTeam, setSelTeam] = useState<string | null>(null);
  const pinned = !!forceTeam;
  const team = forceTeam ?? (locked ? (myTeam as string) : (selTeam ?? myTeam ?? teamNames[0] ?? null));

  const teamStops = useMemo(() => stops.filter((s) => s.dq_team === team), [stops, team]);
  // Confirmed pero HINDI pa finalized sa Route Planner — paalala para kay Ops
  // (hindi pa kasama sa ruta sa ibaba hangga't hindi fina-finalize).
  //
  // KAPAREHONG SALAAN NG PLANNER (2026-08-30). Ang `rework_pickup_onsite` ay
  // wala rito noon, samantalang tinatanggal ito ng planner mismo — nandoon na
  // ang team nang mag-declare sila, kaya wala nang iruruta. Ang bilang ay
  // nagsasabing "1 confirmed stop is waiting in the Route Planner", at ang
  // planner ay blangko pagdating doon. Kapag naghiwalay ang dalawang listahan,
  // ang babala ay nagpapadala kay Ops sa pahinang walang laman.
  const pendingPlan = useMemo(
    () => rows.filter((r) => r.dq_status === "confirmed" && r.dq_date && r.dq_team === team && !r.dq_final && !r.rework_pickup_onsite && !/failed|delivered/i.test(r.status)).length,
    [rows, team],
  );
  const today = todayISO();
  const [selDate, setSelDate] = useState<string | null>(null);
  // DALAWANG TANAW (hiling 2026-08-28). Ang naihatid na ay tinatago noon —
  // nawawala sila nang tuluyan, at walang paraang tingnan ang tapos na ruta.
  //   "Pending"   — NGAYON at ang mga PAPARATING lamang. Ang lumipas na ay
  //                 hindi na maaaring gawin, kaya walang dahilang nasa listahan
  //                 ng gagawin — nagdadagdag lang ito ng petsang pipiliin pa.
  //   "Completed" — LAHAT ng natapos, walang salaan ng petsa: isang talaan,
  //                 hindi isang araw. Ang hinahanap doon ay hindi "ano ngayon"
  //                 kundi "nagawa ba ito", at maaaring noong isang linggo pa.
  const [tab, setTab] = useState<"route" | "done">("route");

  // ANG BILANG SA CHIP AY ANG NATITIRANG GAWAIN (2026-08-28). Lahat ng stop ang
  // binibilang noon — kasama ang naihatid na — kaya ang isang araw na tapos na
  // ay nagsasabing "5 stops" habang blangko ang tabla sa ilalim.
  const dates = useMemo(() => {
    const m = new Map<string, { left: number; total: number }>();
    for (const s of teamStops) {
      const d = s.dq_date as string;
      const done = /delivered/i.test(s.status);
      // OVERDUE AY GAWAIN PA RIN (Joe 2026-09-07, "bakit nawala sa Delivery
      // Route"): 5 stops na Sep 6 ang naglaho sa Pending pagpatak ng hatinggabi
      // — tinatago noon ang LAHAT ng nakaraang petsa. Ang naihatid na ay
      // lumipas na nga; ang HINDI PA naihahatid ay dapat manatili hanggang
      // magawa (o ilipat ng Ops sa ibang araw). Ang nakaraang araw na tapos na
      // lahat ang tanging nawawala.
      if (d < today && done) continue;
      const cur = m.get(d) ?? { left: 0, total: 0 };
      cur.total += 1;
      if (!done) cur.left += 1;
      m.set(d, cur);
    }
    return [...m.entries()].filter(([d, n]) => d >= today || n.left > 0).sort(([a], [b]) => a.localeCompare(b));
  }, [teamStops, today]);
  // Ang araw na may NATITIRANG gawain ang binubuksan: ang ngayon kung may
  // natira, kung hindi ay ang susunod na may laman — hindi ang araw na tapos na.
  const date = selDate && dates.some(([d]) => d === selDate)
    ? selDate
    : (dates.find(([d, n]) => d === today && n.left > 0)?.[0]
      ?? dates.find(([d, n]) => d < today && n.left > 0)?.[0]
      ?? dates.find(([d, n]) => d > today && n.left > 0)?.[0]
      ?? dates.find(([d]) => d === today)?.[0]
      ?? dates.find(([d]) => d > today)?.[0]
      ?? dates.at(-1)?.[0] ?? null);

  const list = useMemo(
    () => teamStops
      .filter((s) => s.dq_date === date)
      .sort((x, y) => (x.dq_stop ?? 999) - (y.dq_stop ?? 999) || String(x.dq_confirmed_at ?? "").localeCompare(String(y.dq_confirmed_at ?? ""))),
    [teamStops, date],
  );
  // OPTIMIZED STOP ORDER (OSRM Trip — kapareho ng Maps): ang Stop # ay ang
  // pinaka-episyenteng pagkakasunod ng biyahe, hindi ang lumang planner index,
  // para tugma ang 1 2 3 4 sa table at sa mapa.
  const [tripSeq, setTripSeq] = useState<Record<number, number> | null>(null);
  // ETA bawat stop (ms epoch): oras ng PAG-ALIS ng team (started_at ng run; 9:00 AM
  // kung hindi pa umaalis) + OSRM travel time kada leg + ~30 min na paghahatid
  // kada naunang stop — ito ang awtomatikong Time Window.
  const SERVICE_MS = 30 * 60 * 1000;
  const [tripEta, setTripEta] = useState<Record<number, number> | null>(null);
  useEffect(() => {
    const pts = list
      .filter((s) => !/delivered/i.test(s.status) && s.order_id != null && s.address_lat != null && s.address_lng != null)
      .map((s) => ({ id: s.order_id as number, lat: Number(s.address_lat), lng: Number(s.address_lng) }));
    if (pts.length < 2) { setTripSeq(null); setTripEta(null); return; }
    let dead = false;
    const coords = pts.map((p) => `${p.lng},${p.lat}`).join(";");
    // Departure: pinakaunang started_at sa run na ito; wala pa → 9:00 AM ng delivery date.
    const started = list.map((s) => (s as { started_at?: string | null }).started_at).filter(Boolean).sort()[0] as string | undefined;
    const departure = started
      ? new Date(started).getTime()
      : new Date(`${date ?? todayISO()}T09:00:00`).getTime();
    // roundtrip=false + source=first ang suportadong combo (any+any = InvalidOptions).
    fetch(`https://router.project-osrm.org/trip/v1/driving/${coords}?roundtrip=false&source=first&destination=any&overview=false`)
      .then((r) => r.json())
      .then((j) => {
        if (dead || !Array.isArray(j?.waypoints)) return;
        const m: Record<number, number> = {};
        (j.waypoints as { waypoint_index: number }[]).forEach((w, i) => { m[pts[i].id] = w.waypoint_index + 1; });
        setTripSeq(m);
        // Cumulative ETA sa trip order: legs[k] = biyahe mula stop k → k+1.
        const legs: number[] = ((j.trips?.[0]?.legs ?? []) as { duration: number }[]).map((l) => Number(l.duration) || 0);
        if (legs.length) {
          const etaAtPos: number[] = [];
          let t = departure;
          for (let p = 0; p < pts.length; p++) {
            if (p > 0) t += (legs[p - 1] ?? 0) * 1000 + SERVICE_MS;
            etaAtPos[p] = t;
          }
          const e: Record<number, number> = {};
          (j.waypoints as { waypoint_index: number }[]).forEach((w, i) => { e[pts[i].id] = etaAtPos[w.waypoint_index]; });
          setTripEta(e);
        }
      })
      .catch(() => { /* best-effort — fallback sa dating order */ });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, date]);
  // I-round sa 15 min ang ETA at gawing "10:30 AM–12:30 PM" na window.
  const fmtEtaWindow = (ms: number): string => {
    const r = Math.round(ms / (15 * 60 * 1000)) * 15 * 60 * 1000;
    const f = (t: number) => new Date(t).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
    return `${f(r)}–${f(r + 2 * 3600 * 1000)}`;
  };

  // TABLE display: ang "Route" ay ang hindi pa naihatid; ang "Delivered" ay ang
  // naihatid na. Kapag may optimized trip order, iyon ang sunod-sunod (1 → N);
  // kung wala, newest-first fallback.
  // ANG COMPLETED AY BUONG TALAAN, HINDI ISANG ARAW (hiling 2026-08-28). Ang
  // `list` ay nakakulong sa piniling petsa dahil doon nakasalalay ang mapa at
  // ang ETA — pero ang hinahanap sa natapos ay "nagawa ba ito", at maaaring
  // noong isang linggo pa iyon. Kaya buong `teamStops` ang pinagkukunan nito,
  // pinakabago sa taas.
  const doneList = useMemo(
    () => teamStops.filter((s) => /delivered/i.test(s.status))
      .sort((x, y) => String(y.dq_date ?? "").localeCompare(String(x.dq_date ?? ""))
        || String(y.order_number ?? "").localeCompare(String(x.order_number ?? ""))),
    [teamStops],
  );
  // Ang bilang ng Pending ay LAHAT ng hindi pa nagawa mula ngayon pataas — hindi
  // lang ang piniling araw: iyon ang natitirang gawain ng team.
  const pendingCount = useMemo(
    () => teamStops.filter((s) => !/delivered/i.test(s.status)).length,
    [teamStops, today],
  );
  const displayList = useMemo(() => {
    if (tab === "done") return doneList;
    const pick = list.filter((s) => !/delivered/i.test(s.status));
    if (tripSeq) return [...pick].sort((x, y) => (tripSeq[x.order_id ?? -1] ?? 99) - (tripSeq[y.order_id ?? -1] ?? 99));
    return [...pick].sort((x, y) => String(y.order_number ?? "").localeCompare(String(x.order_number ?? "")));
  }, [list, doneList, tripSeq, tab]);

  const meta = teams.find((t) => t.name === team) ?? null;
  const driver = list[0]?.dq_driver ?? meta?.driver ?? "—";
  const doneCount = list.filter((s) => /delivered/i.test(s.status)).length;
  const currentIdx = list.findIndex((s) => !/delivered/i.test(s.status));
  const codTotal = list.reduce((sum, s) => sum + (/delivered/i.test(s.status) ? 0 : s.balance_due), 0);

  const [showMap, setShowMap] = useState(false);
  // Row click → same Delivery modal ng Delivery Scheduling (packing/QA/COD/dispatch).
  const [openDel, setOpenDel] = useState<Delivery | null>(null);

  // WALANG early return kapag empty — laging naka-render ang table headers
  // (kumpletong columns) na may empty-state row sa loob ng tbody.
  return (
    <div className="space-y-4">
      {/* Team chips + date chips (planner-style toolbar) */}
      <div className="flex flex-wrap items-center gap-2">
        {!locked && !pinned && (
          <>
            <span className="text-sm font-bold">Team:</span>
            {teamNames.map((t) => (
              <button key={t} type="button" onClick={() => { setSelTeam(t); setSelDate(null); }}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-bold",
                  t === team ? "bg-[#4a3b1a] text-[#f4ead8] ring-1 ring-[#caa45a]" : "border border-border bg-surface text-muted hover:border-[#caa45a]",
                )}>
                {t}
              </button>
            ))}
          </>
        )}
        {(locked || pinned) && <span className="rounded-full bg-[#4a3b1a] px-3 py-1.5 text-xs font-bold text-[#f4ead8]">{pinned ? team : `My Route — ${team}`}</span>}
        {tab === "route" && dates.length > 1 && (
          <>
            <span className="ml-3 text-sm font-bold">Date:</span>
            {dates.map(([d, n]) => (
              <button key={d} type="button" onClick={() => setSelDate(d)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-bold",
                  d === date ? "bg-[#4a3b1a] text-[#f4ead8] ring-1 ring-[#caa45a]" : "border border-border bg-surface text-muted hover:border-[#caa45a]",
                )}>
                {fmtChip(d)}{d === today ? " · Today" : d < today ? " · Overdue" : ""} · {n.left === 0 ? "done" : n.left === 1 ? "1 stop" : `${n.left} stops`}
              </button>
            ))}
          </>
        )}
        {/* Sa DULO: ang team at ang petsa ang pinipili ng driver bawat umaga;
            ang paglipat sa talaan ng natapos ay bihira. */}
        <div className="ml-auto flex gap-1.5">
          {([["route", "Pending", pendingCount], ["done", "Completed", doneList.length]] as const).map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={cn("rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors",
                tab === k ? "bg-[#4a3b1a] text-[#f4ead8] ring-1 ring-[#caa45a]" : "border border-border bg-surface text-muted hover:border-[#caa45a]")}>
              {label} · {n}
            </button>
          ))}
        </div>
      </div>

      {/* May confirmed na pero hindi pa finalized sa Route Planner — hindi pa
          kasama sa ruta; paalala para hindi malimutan ni Ops ang planner. */}
      {pendingPlan > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] font-semibold text-amber-800">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          {pendingPlan === 1 ? "1 confirmed stop is" : `${pendingPlan} confirmed stops are`} waiting in the Route Planner — finalize the route to send {pendingPlan === 1 ? "it" : "them"} to this team.
        </div>
      )}

      {/* Team card — MISMONG Route Planner table UI */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#3a3226] bg-gradient-to-r from-[#5a4a26] to-[#4a3b1a] px-4 py-2.5">
          <p className="text-xs font-bold uppercase tracking-wide text-[#f4ead8]">
            {team ?? "—"} · {driver}
            <span className="ml-2 font-medium normal-case text-[#c9b896]">{meta?.vehicle ? `${meta.vehicle} · ` : ""}{date ? fmtSched(date) : "no booked dates"}{date && date < today ? " · OVERDUE" : ""}</span>
          </p>
          <div className="ml-auto flex items-center gap-2.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#c9b896]">Delivered</span>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[#3a3226]">
              <span className="block h-full rounded-full bg-[#caa45a]" style={{ width: `${list.length ? (doneCount / list.length) * 100 : 0}%` }} />
            </span>
            <span className="text-[11px] font-bold tabular-nums text-[#f4ead8]">{doneCount}/{list.length}</span>
            <span className="rounded-md bg-[#3a3226] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#e7dcc4]">COD {peso(codTotal)}</span>
            <button type="button" onClick={() => setShowMap(true)} className="rounded-md bg-[#3a3226] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#e7dcc4] hover:bg-[#4a4030]">Maps</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td:last-child]:border-r-0 [&_th]:border-b [&_th]:border-r [&_th]:border-[#6b5a2f] [&_th:last-child]:border-r-0">
            <thead>
              <tr className="bg-[#5a4a26] text-[10px] uppercase tracking-widest text-[#e7dcc4]">
                <th className="px-3 py-2.5 text-center font-bold">Stop</th>
                <th className="px-3 py-2.5 text-center font-bold">Order #</th>
                <th className="px-3 py-2.5 text-center font-bold">RMA #</th>
                <th className="px-3 py-2.5 text-center font-bold">Customer</th>
                <th className="px-3 py-2.5 text-center font-bold">Address</th>
                {/* ANG ON-SITE AY WALANG PICKUP AT WALANG HATID (2026-08-30):
                    isang bisita — pupunta ang crew sa customer at doon aayusin.
                    Ang "Pickup From: Warehouse" at "Delivery Date" dito noon ay
                    nagmumukhang may kukunin at ihahatid, kaya nalilito ang
                    bumabasa kung nasaan ang pick-up at drop-off na wala naman. */}
                <th className="px-3 py-2.5 text-center font-bold">{mode === "onsite" ? "Repair At" : "Pickup From"}</th>
                <th className="px-3 py-2.5 text-center font-bold">Confirmed On</th>
                <th className="px-3 py-2.5 text-center font-bold">{mode === "onsite" ? "Visit Date" : "Delivery Date"}</th>
                <th className="px-3 py-2.5 text-center font-bold">Team</th>
                <th className="px-3 py-2.5 text-center font-bold">Driver</th>
                <th className="px-3 py-2.5 text-center font-bold">Time Window</th>
                <th className="px-3 py-2.5 text-right font-bold">Balance</th>
                <th className="px-3 py-2.5 text-center font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && displayList.length === 0 && (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-sm text-muted">
                  {stops.length === 0 && awaitingPickup > 0
                    ? `${awaitingPickup} stop${awaitingPickup === 1 ? "" : "s"} waiting in Pickup Task — collect ${awaitingPickup === 1 ? "it" : "them"} first and ${awaitingPickup === 1 ? "it appears" : "they appear"} here.`
                    : stops.length === 0
                    ? "No booked routes yet — stops appear here once deliveries are confirmed and assigned to a team."
                    : "No stops for this date."}
                </td></tr>
              )}
              {list.length > 0 && displayList.length === 0 && (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-sm text-muted">
                  {tab === "done" ? "Nothing delivered by this team yet." : "All stops for this date have been delivered."}
                </td></tr>
              )}
              {displayList.map((s, di) => {
                const i = list.indexOf(s); // planner index — NOW marker at auto window
                // Stop # = optimized na pagkakasunod ng biyahe (tugma sa mapa).
                const seq = tripSeq?.[s.order_id ?? -1] ?? di + 1;
                const done = /delivered/i.test(s.status);
                const current = i === currentIdx;
                // Time Window: manual > ETA-based (alis + biyahe + hatid) > positional.
                const eta = tripEta?.[s.order_id ?? -1];
                const win = s.dq_window ?? (eta != null ? `${fmtEtaWindow(eta)} (auto)` : `${WINDOWS[Math.min(i, WINDOWS.length - 1)]} (auto)`);
                return (
                  <tr key={s.order_id} onClick={() => setOpenDel(s)}
                    className={cn("cursor-pointer border-b border-border last:border-0 hover:bg-stone-50", current && "bg-blue-50/60")}>
                    <td className="px-3 py-3 text-center">
                      <span className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ring-1 ring-inset",
                        done ? "bg-emerald-600 text-white ring-emerald-600" : "bg-blue-100 text-blue-700 ring-blue-300",
                      )}>{done ? "✓" : seq}</span>
                    </td>
                    <td className="px-3 py-3 text-center font-mono text-xs font-semibold">{s.order_number ?? "—"}</td>
                    <td className="px-3 py-3 text-center"><ReworkCell isRework={s.is_rework} rmaNo={s.rma_no} leg={s.rework_wear ?? s.rework_leg} /></td>
                    <td className="px-3 py-3 text-center font-semibold">
                      {s.customer_name ?? "—"}
                      {current && <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">NOW</span>}
                    </td>
                    <td className="max-w-[260px] px-3 py-3 text-center text-xs text-muted" title={s.address ?? undefined}><span className="block truncate">{s.address ?? "—"}</span>{s.landmark && <span className="mt-0.5 block truncate rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800" title={s.landmark}>◆ {s.landmark}</span>}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-center">
                      {mode === "onsite"
                        ? <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-200">Customer’s home</span>
                        : s.pickup_location
                        ? <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700 ring-1 ring-inset ring-orange-200">{s.pickup_location}</span>
                        : <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">Warehouse</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-center text-xs text-muted">{fmtConfirmed(s.dq_confirmed_at)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-center text-sm font-bold">{fmtSched(s.dq_date)}</td>
                    <td className="px-3 py-3 text-center text-xs">{s.dq_team}</td>
                    <td className="px-3 py-3 text-center text-xs">{s.dq_driver ?? "—"}</td>
                    <td className="px-3 py-3 text-center">
                      <span className="text-xs font-bold text-blue-700">{win}</span>
                      <span className="block text-[9px] uppercase tracking-wide text-muted">{s.dq_window ? "manual" : "auto"}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums">{peso(s.balance_due)}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", statusPill(s.status))}>{s.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-[11px] text-muted">
        Arrived / proof / delivered are handled inside the Navigate map and the Delivery module, same as before.
      </p>

      {/* Maps: ang mga DELIVERED nang stop ay hindi na kasama sa ruta. */}
      {showMap && <RouteMapModal team={team ?? "—"} driver={driver} date={date ?? ""} list={list.filter((s) => !/delivered/i.test(s.status))} onClose={() => setShowMap(false)} />}

      {/* LOCKED pagkatapos ng Arrived/Delivered — view-only sa teams; Admin/Ops lang ang maka-e-edit. */}
      {openDel && <DeliveryModal d={openDel} onClose={() => setOpenDel(null)} drivers={drivers} qaNames={qaNames} coordinators={coordinators}
        teams={teams}
        readOnly={false} />}
    </div>
  );
}
