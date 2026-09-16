"use client";

// WAREHOUSE LOCATIONS — enterprise redesign (aprubado 2026-08-16, artifact
// 2dab399f): isang-row na line rail, manipis na KPI band, WAREHOUSE MAP
// (floor plan: dock + rack banks + mini cubic grids + line detail panel),
// SEARCH SPOTLIGHT (instant hits + map dim/pulse), dated-only na Priority
// table, at cubic modal na buong columns nang walang side-scroll.

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { SpecFieldsView } from "./spec-fields-input";
import { specCategoryOf } from "./line-items-editor";
import { cn } from "./ui";
import { assignLocation, assignPlacements, createLocation, updateLocation, deleteLocation, type LocationInput } from "@/app/locations/actions";
import { printQcPassedLabels } from "./qc-labels";
import type { LocationsData, LocCard, LocProduct, LocOrderRef } from "@/app/locations/data";

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
// BAGONG AYOS 2026-08-10 (hiling ng warehouse): ang mga grupo ay LINE 1–40
// (dating Zone A–E), at ang bawat lokasyon ay isang CUBIC (A1–E6) sa loob ng
// linya. Ang naka-imbak na code ay "L<line>-<cubic>" (hal. L1-A1) para
// natatangi kahit inuulit ang cubic letters sa bawat linya — ang code na ito
// ang ginagamit ng inventory.location at ng scan/QC.
const LINES = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`);
const CUBICS = ["A", "B", "C", "D", "E"].flatMap((L) => Array.from({ length: 6 }, (_, i) => `${L}${i + 1}`));
const CAPACITIES = [50, 100, 150, 200, 300, 500];

// Ang code na maiimbak para sa napiling linya + cubic. Ang lumang code na
// hindi cubic (hal. "Rak-01") ay pinapasa nang buo para hindi masira ang mga
// dating lokasyon habang hindi pa nae-edit.
function derivedCode(line: string | null | undefined, cubic: string): string {
  const n = (line ?? "").match(/\d+/)?.[0];
  return n && /^[A-E][1-6]$/.test(cubic) ? `L${n}-${cubic}` : cubic;
}

const fmt = (n: number) => (Number(n) || 0).toLocaleString("en-PH");

// Numero ng linya mula sa zone ("Line 12" → 12); null kapag walang numero.
const lineNo = (zone: string | null | undefined): number | null => {
  const m = /(\d+)/.exec(zone ?? "");
  return m ? Number(m[1]) : null;
};
// Puwesto ng cubic sa 6×5 grid (A1..A6, B1.. — hilera A–E, hanay 1–6).
const cubicSlot = (code: string): number => {
  const m = /([A-E])([1-6])$/i.exec(code);
  return m ? (m[1].toUpperCase().charCodeAt(0) - 65) * 6 + (Number(m[2]) - 1) : 99;
};
// Pinakamalapit na delivery date ng mga order na nakalaan sa cubic.
function nextDelivery(l: LocCard): { date: string; order: string } | null {
  let out: { date: string; order: string } | null = null;
  for (const p of l.products) {
    for (const o of p.orders ?? []) {
      if (!o.deliveryDate) continue;
      if (!out || o.deliveryDate < out.date) out = { date: o.deliveryDate, order: o.orderNumber };
    }
  }
  return out;
}

type StatusMeta = { label: string; pill: string; ring: string };
function statusOf(l: LocCard): StatusMeta {
  const u = l.utilization;
  // May naka-assign na SKU pero wala pang stock — ipakita bilang "Assigned"
  // (hindi Empty) para kita agad ang laman ng rack kahit 0 pa ang on-hand.
  if (l.units === 0 && l.skuCount === 0) return { label: "Empty", pill: "bg-stone-100 text-stone-500", ring: "stroke-stone-300" };
  if (l.units === 0) return { label: "Assigned", pill: "bg-[#f0e2c4] text-[#4a3b1a]", ring: "stroke-stone-300" };
  if (u != null && u >= 1) return { label: "Full", pill: "bg-rose-100 text-rose-700", ring: "stroke-rose-500" };
  if (u != null && u >= 0.85) return { label: "Low space", pill: "bg-amber-100 text-amber-700", ring: "stroke-amber-500" };
  return { label: "Occupied", pill: "bg-emerald-100 text-emerald-700", ring: "stroke-[#caa45a]" };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{children}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
  );
}

// Isang hit sa Search Spotlight — produkto (o order) + saang cubics ito.
type SpotHit = {
  kind: "product" | "order";
  label: string;
  sub: string;
  // Kada cubic ang dami (0199): ang isang SKU ay maaaring hati sa ilang
  // puwesto — L3-A1 · 3 at L3-A2 · 2 — at ang bawat isa ay sariling linya
  // sa resulta. Ang qty ay null sa order hits (walang per-cubic na bilang doon).
  cubics: { code: string; loc: LocCard; qty: number | null }[];
};

export function LocationsManager({ data }: { data: LocationsData }) {
  const [q, setQ] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [zoneFlt, setZoneFlt] = useState<string>("all");
  const [open, setOpen] = useState<LocCard | null>(null);
  const [editOpen, setEditOpen] = useState<LocCard | "new" | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  // WAREHOUSE MAP: napiling linya (detail panel) + kumikislap na cubic
  // (mula sa Locate / spotlight).
  const [selLine, setSelLine] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);

  // Numeric-aware ang sort para "Line 10" ay sumunod sa "Line 9", hindi sa "Line 1".
  const zones = useMemo(
    () => [...new Set(data.locations.map((l) => l.zone ?? "No line"))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [data.locations],
  );
  // Units kada linya — pang-badge ng line rail at ng map.
  const unitsByZone = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of data.locations) m.set(l.zone ?? "No line", (m.get(l.zone ?? "No line") ?? 0) + l.units);
    return m;
  }, [data.locations]);

  // Mga cubic kada line number (1..40), naka-ayos sa puwesto sa grid.
  const byLine = useMemo(() => {
    const m = new Map<number, LocCard[]>();
    for (const l of data.locations) {
      const n = lineNo(l.zone);
      if (n == null) continue;
      m.set(n, [...(m.get(n) ?? []), l]);
    }
    for (const [, arr] of m) arr.sort((a, b) => cubicSlot(a.code) - cubicSlot(b.code));
    return m;
  }, [data.locations]);

  // SEARCH SPOTLIGHT (2026-08-16): habang nagta-type, agad na hits — produkto
  // (name/SKU) at order (order#/customer) na may EKSAKTONG cubic ng bawat isa;
  // ang map ay nagdi-dim ng hindi tugma at kumikislap ang tumutugmang cells.
  const spotlight = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return { hits: [] as SpotHit[], codes: new Set<string>(), lines: new Set<number>() };
    const prodHits = new Map<string, SpotHit>();
    const ordHits = new Map<string, SpotHit>();
    const codes = new Set<string>();
    const lines = new Set<number>();
    for (const l of data.locations) {
      const ln = lineNo(l.zone);
      const codeMatch = l.code.toLowerCase().includes(s);
      for (const p of l.products) {
        const pMatch = codeMatch || p.product_name.toLowerCase().includes(s) || (p.sku ?? "").toLowerCase().includes(s);
        if (pMatch) {
          const k = (p.sku ?? p.product_name).toLowerCase();
          const hit = prodHits.get(k) ?? {
            kind: "product" as const,
            label: p.product_name,
            sub: "",
            cubics: [],
          };
          hit.cubics.push({ code: l.code, loc: l, qty: p.onHand });
          // Ang "on hand" ay ang KABUUAN ng lahat ng puwesto — hindi ang unang
          // cubic lang (3 ang ipinakita noon gayong 5 ang totoo: 3 + 2).
          const totalOh = hit.cubics.reduce((t, c) => t + (c.qty ?? 0), 0);
          hit.sub = `${p.sku ?? "no SKU"} · ${fmt(totalOh)} on hand`;
          prodHits.set(k, hit);
          codes.add(l.code); if (ln != null) lines.add(ln);
        }
        for (const o of p.orders ?? []) {
          if (o.orderNumber.toLowerCase().includes(s) || (o.customer ?? "").toLowerCase().includes(s)) {
            const hit = ordHits.get(o.orderNumber) ?? {
              kind: "order" as const,
              label: `${o.orderNumber} · ${o.customer ?? "—"}`,
              sub: `${p.product_name}${o.deliveryDate ? ` · delivery ${new Date(o.deliveryDate).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}` : " · no date yet"}`,
              cubics: [],
            };
            if (!hit.cubics.some((c) => c.code === l.code)) hit.cubics.push({ code: l.code, loc: l, qty: null });
            ordHits.set(o.orderNumber, hit);
            codes.add(l.code); if (ln != null) lines.add(ln);
          }
        }
      }
    }
    return { hits: [...prodHits.values(), ...ordHits.values()].slice(0, 8), codes, lines };
  }, [data.locations, q]);
  const searching = q.trim().length > 0 && spotlight.codes.size > 0;

  // LINES & CUBICS na listahan. Kapag NAGHAHANAP (spotlight): ang mga
  // TUMUTUGMANG cubic LANG ang lalabas (may gold ring) — hindi ang buong
  // linya na puro dimmed na empty cards (naiulat 2026-08-16). Kapag hindi
  // naghahanap, ang dating text filter ang gamit.
  const list = useMemo(() => {
    const base = data.locations.filter((l) => zoneFlt === "all" || (l.zone ?? "No line") === zoneFlt);
    const s = q.trim().toLowerCase();
    if (!s) return base;
    if (searching) return base.filter((l) => spotlight.codes.has(l.code));
    // Walang spotlight hit (hal. hanap sa zone text) — lumang filter.
    return base.filter((l) =>
      l.code.toLowerCase().includes(s)
      || (l.zone ?? "").toLowerCase().includes(s)
      || l.products.some((p) =>
        p.product_name.toLowerCase().includes(s)
        || (p.sku ?? "").toLowerCase().includes(s)
        || (p.orders ?? []).some((o) =>
          o.orderNumber.toLowerCase().includes(s)
          || (o.customer ?? "").toLowerCase().includes(s))));
  }, [data.locations, q, zoneFlt, searching, spotlight.codes]);

  // I-locate ang isang cubic: piliin ang linya sa map, pakislapin ang cell,
  // i-scroll ang map sa view, at BUKSAN AGAD ang cubic modal (hiling
  // 2026-08-16) — isang pindot mula Priority/Spotlight papunta sa detalye.
  function locate(l: LocCard) {
    const n = lineNo(l.zone);
    if (n != null) setSelLine(n);
    setFlash(l.code);
    mapRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setOpen(l);
  }

  const totalUnits = useMemo(() => data.locations.reduce((s, l) => s + l.units, 0), [data.locations]);
  const totalSkus = useMemo(() => data.locations.reduce((s, l) => s + l.skuCount, 0), [data.locations]);

  // PRIORITY (2026-08-16, aprubadong redesign): MAY DELIVERY DATE LANG ang
  // lumalabas — pinakamalapit muna. Ang walang petsa ay nasa search at cubic
  // cards pa rin, hindi na sa priority list.
  const priorities = useMemo(() => {
    const out: { loc: LocCard; product: string; qty: number; order: string; customer: string | null; date: string; days: number }[] = [];
    for (const l of data.locations) {
      for (const p of l.products) {
        for (const o of p.orders ?? []) {
          if (!o.deliveryDate) continue;
          out.push({
            loc: l,
            product: p.product_name,
            qty: Math.max(1, o.qty),
            order: o.orderNumber,
            customer: o.customer,
            date: o.deliveryDate,
            days: Math.ceil((new Date(o.deliveryDate).getTime() - Date.now()) / 86_400_000),
          });
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);
  }, [data.locations]);

  // Default na napiling linya: ang unang may laman.
  const firstOccupied = useMemo(() => {
    for (let n = 1; n <= 40; n++) if ((byLine.get(n) ?? []).some((l) => l.units > 0)) return n;
    return 1;
  }, [byLine]);
  const shownLine = selLine ?? firstOccupied;

  // Bank C (21–30) at Bank D (31–40): naka-collapse kapag lahat walang laman.
  const bankCOccupied = useMemo(() => {
    for (let n = 21; n <= 30; n++) if ((byLine.get(n) ?? []).some((l) => l.units > 0)) return true;
    return false;
  }, [byLine]);
  const bankDOccupied = useMemo(() => {
    for (let n = 31; n <= 40; n++) if ((byLine.get(n) ?? []).some((l) => l.units > 0)) return true;
    return false;
  }, [byLine]);

  const occupiedShare = data.kpi.total > 0 ? Math.round((data.kpi.occupied / data.kpi.total) * 1000) / 10 : 0;

  return (
    <div className="space-y-5">
      {/* Toolbar: search (may spotlight dropdown) + isang-row na line rail + add */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-72">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setTimeout(() => setSearchFocus(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setQ(""); (e.target as HTMLInputElement).blur(); }
              if (e.key === "Enter" && spotlight.hits[0]?.cubics[0]) locate(spotlight.hits[0].cubics[0].loc);
            }}
            placeholder="Search cubic, SKU, order #, or customer…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[#caa45a]"
          />
          {/* SPOTLIGHT DROPDOWN — instant hits habang nagta-type; ang bawat hit
              ay may cubic chips; pindot = locate sa map (dim + pulse). */}
          {searchFocus && q.trim() && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
              {spotlight.hits.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted">No stored stock matches “{q.trim()}”.</p>
              ) : (
                <>
                  <p className="border-b border-border bg-[#faf6ec] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted">
                    {spotlight.hits.length} hit{spotlight.hits.length === 1 ? "" : "s"} · {spotlight.codes.size} cubic{spotlight.codes.size === 1 ? "" : "s"}
                  </p>
                  <ul className="max-h-72 overflow-y-auto">
                    {spotlight.hits.map((h, i) => (
                      <li key={i} className="border-b border-border/60 last:border-0">
                        {/* BAWAT CUBIC AY SARILING PINDUTAN (2026-09-06, "dapat na-click
                            ko mismo ung magkakaibang location"): ang stock na hati sa
                            tatlong cubic ay tatlong tumbukin — hindi laging ang una. */}
                        <div className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[#faf6ec]">
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { if (h.cubics[0]) locate(h.cubics[0].loc); }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block truncate text-sm font-semibold text-[#3a2e14]">{h.label}</span>
                            <span className="block truncate font-mono text-[10.5px] text-muted">{h.sub}</span>
                          </button>
                          {/* Isang LINYA kada cubic, may dami — kitang-kita kung
                              saan-saan nahati ang stock (L3-A1 · 3 / L3-A2 · 2). */}
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            {h.cubics.slice(0, 4).map((c) => (
                              <button
                                key={c.code}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => locate(c.loc)}
                                title={`Open ${c.code}`}
                                className="rounded-md border border-[#caa45a] bg-[#fffaf0] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#4a3b1a] transition-colors hover:bg-[#caa45a] hover:text-white"
                              >
                                {c.code}{c.qty != null ? ` · ${fmt(c.qty)}` : ""}
                              </button>
                            ))}
                            {h.cubics.length > 4 && <span className="text-[10px] text-muted">+{h.cubics.length - 4} more</span>}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-border bg-[#faf6ec]/70 px-3 py-1.5 text-[10px] text-muted">Click a cubic to open it · Enter = first cubic · Esc = clear</p>
                </>
              )}
            </div>
          )}
        </div>
        <button onClick={() => setEditOpen("new")} className="ml-auto rounded-lg bg-[#4a3b1a] px-4 py-2 text-sm font-bold text-[#f4ead8] shadow-sm hover:opacity-90">+ Add Location</button>
      </div>

      {/* LINE RAIL — isang scrollable row; ang may lamang linya ay may gold
          outline + bilang ng units, ang walang laman ay tahimik. */}
      <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-border bg-[#faf6ec]/60 p-1.5">
        <button onClick={() => setZoneFlt("all")} className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all", zoneFlt === "all" ? "bg-[#4a3b1a] text-[#f4ead8]" : "text-muted hover:text-foreground")}>
          All Lines
          <span className="rounded-full bg-[#caa45a] px-1.5 py-px font-mono text-[10px] font-extrabold text-[#3a2e14]">{fmt(totalUnits)}</span>
        </button>
        {zones.map((z) => {
          const u = unitsByZone.get(z) ?? 0;
          return (
            <button
              key={z}
              onClick={() => { setZoneFlt(z); const n = lineNo(z); if (n != null) setSelLine(n); }}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                zoneFlt === z ? "bg-[#4a3b1a] text-[#f4ead8]" : u > 0 ? "border border-[#caa45a] bg-surface text-[#3a2e14]" : "text-muted hover:text-foreground",
              )}
            >
              {z}
              {u > 0 && <span className="rounded-full bg-[#caa45a] px-1.5 py-px font-mono text-[10px] font-extrabold text-[#3a2e14]">{fmt(u)}</span>}
            </button>
          );
        })}
      </div>

      {/* KPI — manipis na stat band (dating 6 malalaking cards). */}
      <div className="apk-hide grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-surface shadow-sm sm:grid-cols-3 xl:grid-cols-6">
        <SlimKpi label="Total Cubics" value={fmt(data.kpi.total)} note="40 lines × A1–E6" />
        <SlimKpi label="Occupied" value={fmt(data.kpi.occupied)} chip={{ text: `${occupiedShare}%`, cls: "bg-emerald-50 text-emerald-700" }} />
        <SlimKpi label="Empty" value={fmt(data.kpi.empty)} note="Ready to receive" />
        <SlimKpi label="Utilization" value={data.kpi.util != null ? `${Math.round(data.kpi.util * 100)}%` : `${occupiedShare}%`} meter={data.kpi.util != null ? Math.round(data.kpi.util * 100) : occupiedShare} />
        <SlimKpi label="Units Stored" value={fmt(totalUnits)} note={`${fmt(totalSkus)} SKUs on hand`} />
        <SlimKpi label="Unassigned SKUs" value={fmt(data.unassigned.length)} chip={data.unassigned.length > 0 ? { text: "Needs a location", cls: "bg-amber-100 text-amber-700" } : { text: "All assigned", cls: "bg-emerald-50 text-emerald-700" }} />
      </div>

      {/* Needs Attention — unassigned products */}
      {data.unassigned.length > 0 && (
        <>
          <SectionLabel>Needs Attention</SectionLabel>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-sm font-extrabold text-white">!</span>
            <span className="text-sm"><b className="text-[#3a2e14]">{data.unassigned.length} product{data.unassigned.length === 1 ? "" : "s"} have no storage location</b> — assign a cubic so scanning and picking work end to end.</span>
            {data.unassigned.slice(0, 5).map((p) => (
              <span key={p.key} className="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11px]">
                {p.sku ?? p.product_name.slice(0, 14)}{p.color ? <span className="ml-1 font-sans text-[10px] text-muted">{p.color}</span> : null}
                {/* NAKALAANG ORDER KAHIT WALANG CUBIC (2026-09-06, "dapat kita agad"):
                    ang paparating na hatid ng stock na wala pang puwesto ay dito
                    lang makikita — wala itong linya sa mapa. */}
                {(p.orders ?? []).slice(0, 2).map((o) => (
                  <span key={o.orderNumber} className="ml-1.5 rounded bg-amber-50 px-1 font-sans text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200" title={o.customer ?? undefined}>
                    {o.orderNumber}{o.deliveryDate ? ` · ${new Date(o.deliveryDate).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}` : ""}
                  </span>
                ))}
              </span>
            ))}
            {data.unassigned.length > 5 && <span className="text-[11px] text-muted">+{data.unassigned.length - 5} more</span>}
            <button onClick={() => setAssignOpen(true)} className="ml-auto rounded-lg border border-[#caa45a] bg-[#faf6ec] px-3 py-1.5 text-xs font-bold text-[#4a3b1a] hover:bg-[#f4ead8]">Assign locations</button>
          </div>
        </>
      )}

      {/* WAREHOUSE MAP — bird's-eye ng buong 900 cubics: bawat linya ay mini
          6×5 grid (gold = may laman, amber outline = may paparating na
          delivery). Pindutin ang linya → detail panel sa kanan. */}
      <SectionLabel>Warehouse Map</SectionLabel>
      <div ref={mapRef} className="grid gap-4 xl:grid-cols-[1fr_330px]">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
          {/* Receiving dock — dito pumapasok ang QC Passed stock. */}
          <div className="mb-3 rounded-lg border-2 border-dashed border-[#caa45a] bg-[#fffaf0] px-3 py-1.5 text-center text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#8a6a1f]">
            Receiving Dock — QC Passed stock enters here
          </div>
          <MapBank title="Rack Bank A · Lines 1–10" from={1} to={10} byLine={byLine} shownLine={shownLine} onPick={setSelLine} searching={searching} matchCodes={spotlight.codes} matchLines={spotlight.lines} flash={flash} />
          <div className="my-3 flex items-center gap-3 text-[#8a6a1f]">
            <span className="h-0 flex-1 border-t-2 border-dashed border-[#dccb9e]" />
            <span className="text-[9px] font-extrabold uppercase tracking-[0.3em]">Main Aisle</span>
            <span className="h-0 flex-1 border-t-2 border-dashed border-[#dccb9e]" />
          </div>
          <MapBank title="Rack Bank B · Lines 11–20" from={11} to={20} byLine={byLine} shownLine={shownLine} onPick={setSelLine} searching={searching} matchCodes={spotlight.codes} matchLines={spotlight.lines} flash={flash} />
          {bankCOccupied ? (
            <>
              <div className="my-3 flex items-center gap-3 text-[#8a6a1f]">
                <span className="h-0 flex-1 border-t-2 border-dashed border-[#dccb9e]" />
                <span className="text-[9px] font-extrabold uppercase tracking-[0.3em]">Aisle</span>
                <span className="h-0 flex-1 border-t-2 border-dashed border-[#dccb9e]" />
              </div>
              <MapBank title="Rack Bank C · Lines 21–30" from={21} to={30} byLine={byLine} shownLine={shownLine} onPick={setSelLine} searching={searching} matchCodes={spotlight.codes} matchLines={spotlight.lines} flash={flash} />
            </>
          ) : (
            <p className="mt-3 text-right font-mono text-[10.5px] text-muted">L21–L30 collapsed — all empty</p>
          )}
          {bankDOccupied ? (
            <>
              <div className="my-3 flex items-center gap-3 text-[#8a6a1f]">
                <span className="h-0 flex-1 border-t-2 border-dashed border-[#dccb9e]" />
                <span className="text-[9px] font-extrabold uppercase tracking-[0.3em]">Aisle</span>
                <span className="h-0 flex-1 border-t-2 border-dashed border-[#dccb9e]" />
              </div>
              <MapBank title="Rack Bank D · Lines 31–40" from={31} to={40} byLine={byLine} shownLine={shownLine} onPick={setSelLine} searching={searching} matchCodes={spotlight.codes} matchLines={spotlight.lines} flash={flash} />
            </>
          ) : (
            <p className="mt-1 text-right font-mono text-[10.5px] text-muted">L31–L40 collapsed — all empty</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted">
            <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[#caa45a] align-[-1px]" />Occupied</span>
            <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm border border-[#e5dabd] bg-[#faf6ec] align-[-1px]" />Empty</span>
            <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm border-2 border-amber-600 bg-white align-[-1px]" />Upcoming delivery</span>
            {searching && <span className="ml-auto font-semibold text-[#8a6a1f]">Showing matches for “{q.trim()}” — other lines dimmed</span>}
          </div>
        </div>

        {/* LINE DETAIL PANEL — A1–E6 ng napiling linya. */}
        <LineDetail
          line={shownLine}
          locs={byLine.get(shownLine) ?? []}
          flash={flash}
          onOpen={setOpen}
        />
      </div>

      {/* PRIORITY — MAY DELIVERY DATE LANG, pinakamalapit muna; Locate =
          ilawan ang cubic sa map. */}
      {priorities.length > 0 && (
        <>
          <SectionLabel>Priority — Upcoming Deliveries</SectionLabel>
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
            {/* Buong enterprise table view (2026-08-16) — bordered/centered na
                cells gaya ng Installation at cubic modal tables. */}
            <table className="w-full min-w-[760px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:align-middle [&_th]:border-b [&_th]:border-r [&_th]:border-[#6b5a2f] [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0 [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
              <thead>
                <tr className="bg-[#5a4a26] text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#e7dcc4]">
                  <th className="px-3 py-2.5">Urgency</th>
                  <th className="px-3 py-2.5">Delivery</th>
                  <th className="px-3 py-2.5">Cubic</th>
                  <th className="px-3 py-2.5">Product</th>
                  <th className="px-3 py-2.5">Qty</th>
                  <th className="px-3 py-2.5">Order #</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {priorities.map((pr, i) => {
                  const tone = pr.days < 0 ? "bg-rose-100 text-rose-700" : pr.days <= 7 ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-600";
                  return (
                    <tr key={i} className="hover:bg-[#faf6ec]">
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className={cn("rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold", tone)}>
                          {pr.days < 0 ? `OVERDUE ${Math.abs(pr.days)}D` : pr.days === 0 ? "TODAY" : pr.days <= 7 ? `IN ${pr.days} DAY${pr.days === 1 ? "" : "S"}` : new Date(pr.date).toLocaleDateString("en-PH", { month: "short", day: "numeric" }).toUpperCase()}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs font-semibold tabular-nums">{new Date(pr.date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className="rounded-md border border-[#caa45a] bg-[#fffaf0] px-2 py-0.5 font-mono text-[11px] font-bold text-[#4a3b1a]">{pr.loc.code}</span>
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2.5 text-sm font-medium" title={pr.product}>{pr.product}</td>
                      <td className="px-3 py-2.5 font-mono text-xs font-bold tabular-nums">{pr.qty}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs font-bold text-[#8a6a1f]">{pr.order}</td>
                      <td className="max-w-[180px] truncate px-3 py-2.5 text-xs" title={pr.customer ?? undefined}>{pr.customer ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <button onClick={() => locate(pr.loc)} className="rounded-lg border border-border bg-surface px-3 py-1 text-[11px] font-bold text-[#4a3b1a] hover:bg-[#faf6ec]">Locate</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Zone bands + rack cards — MAY LAMAN LANG (2026-08-16): ang 898 na
          empty cards ay tinanggal dahil sobrang haba; ang empty cubics ay
          kita at napipindot na sa Warehouse Map (detail panel → modal). */}
      <SectionLabel>Stored Stock — Occupied Cubics</SectionLabel>
      {(() => {
        const stocked = list.filter((l) => l.units > 0 || l.skuCount > 0);
        // Group per zone para sa zone bands.
        const m = new Map<string, LocCard[]>();
        for (const l of stocked) {
          const z = l.zone ?? "No line";
          m.set(z, [...(m.get(z) ?? []), l]);
        }
        const grouped = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
        if (grouped.length === 0) {
          return (
            <p className="rounded-xl border border-dashed border-border bg-stone-50 py-16 text-center text-sm text-muted">
              {q.trim() ? "No stored stock matches your search." : "No occupied cubics yet — stock enters a cubic through QC Receiving. Empty cubics are on the Warehouse Map above."}
            </p>
          );
        }
        return grouped.map(([zone, locs]) => {
        const zUnits = locs.reduce((s, l) => s + l.units, 0);
        const zUtils = locs.filter((l) => l.utilization != null);
        const zUtil = zUtils.length ? Math.round((zUtils.reduce((s, l) => s + (l.utilization ?? 0), 0) / zUtils.length) * 100) : null;
        return (
          <div key={zone} className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b border-[#caa45a] bg-gradient-to-r from-[#52421d] to-[#4a3b1a] px-4 py-3 sm:px-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#caa45a] text-sm font-extrabold text-[#3a2e14]">{zone.replace(/^(zone|line)\s*/i, "").slice(0, 2) || "—"}</span>
              <b className="text-sm font-extrabold tracking-wide text-[#f4ead8]">{zone}</b>
              <div className="ml-auto flex items-center gap-4 text-[11.5px] text-[#c9b896]">
                <span>Occupied <b className="text-white">{locs.length}</b>{(() => { const n = lineNo(zone); const tot = n != null ? (byLine.get(n) ?? []).length : 0; return tot ? <span className="text-[#c9b896]"> / {tot}</span> : null; })()}</span>
                <span>Units <b className="text-white">{fmt(zUnits)}</b></span>
                {zUtil != null && (
                  <>
                    <span>Utilization <b className="text-white">{zUtil}%</b></span>
                    <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-white/15 sm:inline-block">
                      <span className="block h-full rounded-full bg-[#caa45a]" style={{ width: `${Math.min(zUtil, 100)}%` }} />
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 p-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {locs.map((l) => {
                const st = statusOf(l);
                const pct = l.utilization != null ? Math.round(l.utilization * 100) : null;
                // "Empty" placeholder LANG kapag talagang walang laman — kapag may
                // naka-assign na SKU (kahit 0 pa ang stock), ipakita ang preview.
                const empty = l.units === 0 && l.skuCount === 0;
                // PRIORITY DATE (2026-08-10): ang pinakamalapit na delivery date
                // ng mga order na nakalaan sa cubic na ito — kita agad kung alin
                // ang dapat i-ready. Pula = lampas na, amber = sa loob ng 7 araw.
                const nextDel = nextDelivery(l);
                const days = nextDel ? Math.ceil((new Date(nextDel.date).getTime() - Date.now()) / 86_400_000) : null;
                const delTone = days == null ? "" : days < 0 ? "bg-rose-50 text-rose-700 ring-rose-600/20" : days <= 7 ? "bg-amber-50 text-amber-700 ring-amber-600/20" : "bg-stone-100 text-stone-600 ring-stone-300";
                // SPOTLIGHT sa cards (2026-08-16): habang naghahanap, ang mga
                // hit LANG ang nakalista — bawat isa may gold ring; ang
                // ni-Locate ay kumikislap.
                const hit = (searching && spotlight.codes.has(l.code)) || flash === l.code;
                return (
                  <button key={l.id} onClick={() => setOpen(l)} className={cn("group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface text-left transition-all hover:-translate-y-0.5 hover:shadow-md", empty && "border-dashed", hit && "border-[#caa45a] shadow-md ring-2 ring-[#caa45a]", flash === l.code && "animate-pulse")}>
                    {/* PLAIN ANG DATING CARDS (2026-08-26) — puting header,
                        malaking blangkong gitna. Ngayon: kayumangging strip na
                        kapareho ng mga modal, may gintong guhit sa ilalim. */}
                    <div className={cn("flex items-center gap-2.5 border-b-2 px-3.5 py-2.5", empty ? "border-border bg-[#faf6ec]" : "border-[#caa45a] bg-gradient-to-r from-[#52421d] to-[#4a3b1a]")}>
                      <span className={cn("font-mono text-sm font-extrabold", empty ? "text-[#3a2e14]" : "text-[#f4ead8]")}>{l.code}</span>
                      <span className={cn("ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-extrabold", st.pill)}>{st.label}</span>
                    </div>
                    {empty ? (
                      <div className="flex flex-1 items-center justify-center px-4 py-8">
                        <p className="text-xs font-semibold text-muted/70">No items yet</p>
                      </div>
                    ) : (
                      <div className="flex flex-1 flex-col gap-2.5 px-3.5 py-3">
                        {/* Utilization ring LANG kapag may capacity — walang "∞" na ring.
                            Naka-center ang units block para malinis tingnan. */}
                        <div className="flex items-center justify-center gap-3 rounded-xl border border-[#e6dcc4] bg-[#faf6ec]/70 px-3 py-2 text-center">
                          {pct != null && <Donut pct={pct} stroke={st.ring} tone="text-[#3a2e14]" />}
                          <div className="min-w-0">
                            <div className="flex items-baseline justify-center gap-1.5">
                              <span className="text-2xl font-extrabold tabular-nums leading-none text-[#3a2e14]">{fmt(l.units)}</span>
                              <span className="text-[11px] font-semibold text-[#8a6a1f]">units</span>
                            </div>
                            <p className="mt-1 text-[10.5px] text-muted">{l.skuCount} SKU{l.skuCount === 1 ? "" : "s"} stored{l.capacity != null ? ` · cap ${fmt(l.capacity)}` : ""}</p>
                          </div>
                        </div>
                        <div className="grid gap-1">
                          {l.products.slice(0, 3).map((p) => (
                            <span key={p.key} className="flex flex-col gap-0.5">
                              <span className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-[11.5px] transition-colors group-hover:bg-[#faf6ec]/60">
                                <ProductImg p={p} small />
                                <span className="min-w-0 flex-1 truncate font-medium" title={p.color ? `${p.product_name} · ${p.color}` : p.product_name}>{p.product_name}{p.color ? <span className="ml-1 text-[10px] font-normal text-muted">{p.color}</span> : null}</span>
                                {(p.reserved ?? 0) > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" title={`${fmt(p.reserved!)} reserved`} />}
                                <b className="shrink-0 rounded bg-[#faf6ec] px-1.5 font-mono text-[10.5px] tabular-nums text-[#8a6a1f] ring-1 ring-inset ring-[#caa45a]/30">×{fmt(p.onHand)}</b>
                              </span>
                              {/* ORDER # SA CARD (2026-08-26) — kung may nakalaang
                                  order ang stock dito, kita agad sa mapa nang
                                  hindi na binubuksan ang modal. */}
                              {(p.orders ?? []).length > 0 && (
                                <span className="flex flex-wrap gap-1 pl-7">
                                  {(p.orders ?? []).slice(0, 2).map((o) => (
                                    <span key={o.orderNumber} className="rounded bg-[#fffaf0] px-1.5 py-px font-mono text-[9.5px] font-bold text-[#8a6a1f] ring-1 ring-inset ring-[#caa45a]/40" title={o.customer ?? undefined}>{o.orderNumber}</span>
                                  ))}
                                  {(p.orders ?? []).length > 2 && <span className="text-[9.5px] text-muted">+{(p.orders ?? []).length - 2}</span>}
                                </span>
                              )}
                            </span>
                          ))}
                          {l.products.length > 3 && <span className="text-[10.5px] text-muted">+{l.products.length - 3} more…</span>}
                        </div>
                        {/* Priority: kailan ang pinakamalapit na delivery ng laman nito. */}
                        {nextDel && (
                          <span className={cn("inline-flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[10.5px] font-bold ring-1 ring-inset", delTone)}>
                            {days != null && days < 0
                              ? `Delivery overdue ${Math.abs(days)}d`
                              : days === 0
                                ? "Delivery TODAY"
                                : `Delivery in ${days}d`}
                            <span className="font-medium opacity-80">
                              · {new Date(nextDel.date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })} · {nextDel.order}
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-border bg-[#faf6ec]/50 px-3.5 py-2 text-[10.5px] text-muted">
                      <span className="truncate">{l.zone ?? "No line"}</span>
                      <span className="shrink-0 rounded-md bg-[#4a3b1a] px-3 py-1 font-bold text-[#f4ead8] transition-opacity group-hover:opacity-90">View</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
        });
      })()}

      {open && <LocationModal loc={open} all={data.allProducts} unassigned={data.unassigned} onClose={() => setOpen(null)} onEdit={() => { setEditOpen(open); setOpen(null); }} />}
      {editOpen && <LocationForm loc={editOpen === "new" ? null : editOpen} usedCodes={data.locations.map((l) => l.code)} onClose={() => setEditOpen(null)} />}
      {assignOpen && <AssignUnassignedModal unassigned={data.unassigned} locations={data.locations} onClose={() => setAssignOpen(false)} />}
    </div>
  );
}

// Isang bank ng map (10 linya, bawat isa mini 6×5 cubic grid).
function MapBank({ title, from, to, byLine, shownLine, onPick, searching, matchCodes, matchLines, flash }: {
  title: string; from: number; to: number;
  byLine: Map<number, LocCard[]>;
  shownLine: number;
  onPick: (n: number) => void;
  searching: boolean;
  matchCodes: Set<string>;
  matchLines: Set<number>;
  flash: string | null;
}) {
  return (
    <div className="relative rounded-xl border border-border bg-[#fffdf7] p-3 pt-4">
      <span className="absolute -top-2.5 left-3 rounded bg-[#4a3b1a] px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#f4ead8]">{title}</span>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
        {Array.from({ length: to - from + 1 }, (_, i) => {
          const n = from + i;
          const locs = byLine.get(n) ?? [];
          const units = locs.reduce((s, l) => s + l.units, 0);
          const dimmed = searching && !matchLines.has(n);
          // 30 cell sa puwesto A1..E6 — hanapin ang cubic sa slot nito.
          const bySlot = new Map<number, LocCard>();
          for (const l of locs) bySlot.set(cubicSlot(l.code), l);
          return (
            <button
              key={n}
              type="button"
              onClick={() => onPick(n)}
              className={cn(
                "rounded-lg border p-1.5 text-left transition-all",
                shownLine === n ? "border-[#caa45a] bg-surface shadow-[0_0_0_2px_rgba(202,164,90,0.3)]" : units > 0 ? "border-[#d9c48e] bg-[#fffaf0]" : "border-border bg-surface hover:border-[#d9c48e]",
                dimmed && "opacity-30",
              )}
              title={`Line ${n} · ${units} unit${units === 1 ? "" : "s"}`}
            >
              <span className="mb-1 flex items-center justify-between font-mono text-[9px] font-bold text-muted">
                L{n}
                {units > 0 && <em className="not-italic font-extrabold text-[#8a6a1f]">{units}</em>}
              </span>
              <span className="grid grid-cols-6 gap-px">
                {Array.from({ length: 30 }, (_, s) => {
                  const l = bySlot.get(s);
                  const occ = (l?.units ?? 0) > 0;
                  const due = l ? !!nextDelivery(l) : false;
                  const hit = l ? (matchCodes.has(l.code) || flash === l.code) : false;
                  return (
                    <i
                      key={s}
                      className={cn(
                        "block aspect-square rounded-[2px] border",
                        occ ? "border-[#8a6a1f] bg-[#caa45a]" : "border-[#efe5cd] bg-[#faf6ec]",
                        due && "border-2 border-amber-600 bg-white",
                        due && occ && "bg-[#caa45a]",
                        hit && "animate-pulse ring-2 ring-[#caa45a]",
                        searching && !hit && "opacity-40",
                      )}
                    />
                  );
                })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Detail panel ng napiling linya — A1–E6 grid, laman + reserved dot + due
// date; pindutin ang cubic para buksan ang modal nito.
function LineDetail({ line, locs, flash, onOpen }: {
  line: number;
  locs: LocCard[];
  flash: string | null;
  onOpen: (l: LocCard) => void;
}) {
  const byCode = new Map(locs.map((l) => [cubicSlot(l.code), l]));
  const units = locs.reduce((s, l) => s + l.units, 0);
  const occupied = locs.filter((l) => l.units > 0).length;
  // Pinakamalapit na paparating na delivery sa buong linya.
  let next: { date: string; order: string; code: string } | null = null;
  for (const l of locs) {
    const d = nextDelivery(l);
    if (d && (!next || d.date < next.date)) next = { ...d, code: l.code };
  }
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-[#caa45a] bg-surface shadow-sm">
      <div className="bg-[#4a3b1a] px-4 py-2.5 text-[#f4ead8]">
        <div className="flex items-baseline justify-between">
          <b className="text-[15px] font-extrabold tracking-wide">Line {line}</b>
          <span className="font-mono text-[10.5px] text-[#e7dcc4]">{occupied} / 30 cubics · {fmt(units)} unit{units === 1 ? "" : "s"}</span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/15">
          <span className="block h-full rounded-full bg-[#caa45a]" style={{ width: `${Math.round((occupied / 30) * 100)}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-6 gap-1.5 p-3">
        {CUBICS.map((c, s) => {
          const l = byCode.get(s);
          const occ = (l?.units ?? 0) > 0;
          const due = l ? nextDelivery(l) : null;
          const hasRes = !!l && l.products.some((p) => (p.reserved ?? 0) > 0);
          const first = l?.products[0];
          return (
            <button
              key={c}
              type="button"
              disabled={!l}
              onClick={() => l && onOpen(l)}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center gap-px rounded-lg border p-0.5 text-center transition-all",
                occ ? "border-[#caa45a] bg-[#fffaf0] shadow-[inset_0_0_0_1px_rgba(202,164,90,0.35)] hover:shadow-md" : l ? "border-border bg-[#fffdf7] hover:border-[#d9c48e]" : "border-dashed border-border/60 bg-stone-50 opacity-50",
                due && "border-amber-600",
                flash === l?.code && "animate-pulse ring-2 ring-[#caa45a]",
              )}
              title={l ? `${l.code} · ${fmt(l.units)} unit${l.units === 1 ? "" : "s"}${first ? ` · ${first.product_name}${first.color ? ` (${first.color})` : ""}` : ""}` : `${c} — not created yet`}
            >
              {hasRes && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-600 ring-2 ring-white" title="Has reserved units" />}
              <span className="font-mono text-[8.5px] text-muted">{c}</span>
              {occ && first && (
                <>
                  <b className="max-w-full truncate text-[9px] leading-tight text-[#3a2e14]">{first.product_name}</b>
                  <i className="font-mono text-[8px] font-bold not-italic text-[#8a6a1f]">×{fmt(l!.units)}</i>
                </>
              )}
              {due && <u className="absolute inset-x-0 bottom-0.5 font-mono text-[7px] font-extrabold uppercase text-amber-700 no-underline">{new Date(due.date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</u>}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 px-3.5 pb-2 text-[10px] text-muted">
        <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-600 align-[1px]" />Has reserved units</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm border-2 border-amber-600 bg-white align-[-1px]" />Upcoming delivery + date</span>
      </div>

      {/* ANG DATING BLANGKONG GITNA (2026-08-26) — dalawang buod na dating
          kailangang i-click-click pa: ano ang laman ng linya (kada SKU, saang
          mga cubic), at ang mga paparating na delivery nito (click = bukas ang
          cubic). */}
      {(() => {
        const bySku = new Map<string, { name: string; units: number; cubics: string[] }>();
        for (const l of locs) {
          for (const p of l.products) {
            // KADA KULAY (0235): hiwalay na hilera ang bawat kulay ng SKU.
            const k = p.key;
            const b = bySku.get(k) ?? { name: p.color ? `${p.product_name} · ${p.color}` : p.product_name, units: 0, cubics: [] };
            b.units += p.onHand;
            b.cubics.push(l.code.split("-")[1] ?? l.code);
            bySku.set(k, b);
          }
        }
        const stored = [...bySku.values()].sort((x, y) => y.units - x.units);
        const dels: { date: string; order: string; loc: LocCard }[] = [];
        for (const l of locs) {
          for (const p of l.products) {
            for (const o of p.orders ?? []) {
              if (o.deliveryDate) dels.push({ date: o.deliveryDate, order: o.orderNumber, loc: l });
            }
          }
        }
        dels.sort((x, y) => x.date.localeCompare(y.date));
        if (!stored.length) return null;
        return (
          <div className="space-y-3 border-t border-border px-3.5 py-3">
            <div>
              <p className="mb-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-muted">Stored in this line</p>
              <div className="space-y-1">
                {stored.slice(0, 8).map((r) => (
                  <div key={r.name} className="flex items-center gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate" title={r.name}>{r.name}</span>
                    <span className="flex shrink-0 gap-0.5">
                      {r.cubics.slice(0, 4).map((c, i) => <span key={i} className="rounded bg-[#faf6ec] px-1 font-mono text-[8.5px] font-bold text-[#8a6a1f] ring-1 ring-inset ring-[#caa45a]/30">{c}</span>)}
                      {r.cubics.length > 4 && <span className="text-[8.5px] text-muted">+{r.cubics.length - 4}</span>}
                    </span>
                    <b className="shrink-0 font-mono text-[10.5px] tabular-nums text-[#3a2e14]">×{fmt(r.units)}</b>
                  </div>
                ))}
                {stored.length > 8 && <p className="text-[9.5px] text-muted">+{stored.length - 8} more SKUs</p>}
              </div>
            </div>
            {dels.length > 0 && (
              <div>
                <p className="mb-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-muted">Upcoming deliveries</p>
                <div className="space-y-1">
                  {dels.slice(0, 4).map((d, i) => (
                    <button key={i} type="button" onClick={() => onOpen(d.loc)} className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-[11px] hover:bg-[#faf6ec]" title="Open this cubic">
                      <span className="shrink-0 rounded bg-amber-50 px-1.5 py-px font-mono text-[9px] font-extrabold text-amber-700 ring-1 ring-inset ring-amber-600/20">{new Date(d.date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</span>
                      <span className="shrink-0 font-mono text-[9.5px] font-bold text-[#4a3b1a]">{d.loc.code}</span>
                      <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] font-bold text-[#8a6a1f]">{d.order}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
      <div className="mt-auto flex items-center justify-between border-t border-border bg-[#faf6ec] px-4 py-2.5 text-[11.5px] text-muted">
        {next ? (
          <>
            <span>Next out: <b className="text-[#3a2e14]">{next.code} · {new Date(next.date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</b></span>
            <span className="font-mono text-[11px] font-bold text-[#8a6a1f]">{next.order}</span>
          </>
        ) : (
          <span>No upcoming deliveries on this line.</span>
        )}
      </div>
    </div>
  );
}

// Manipis na KPI cell — kapalit ng malalaking cards; hati-hati ng border.
function SlimKpi({ label, value, note, chip, meter }: {
  label: string; value: string; note?: string;
  chip?: { text: string; cls: string }; meter?: number;
}) {
  return (
    <div className="border-b border-r border-border px-4 py-2.5 last:border-r-0 sm:[&:nth-child(3n)]:border-r-0 xl:!border-b-0 xl:[&:nth-child(3n)]:border-r xl:last:!border-r-0">
      <p className="text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-[#a8842e]">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-2">
        <span className="text-lg font-extrabold tracking-tight tabular-nums text-[#3a2e14]">{value}</span>
        {chip && <span className={cn("rounded-full px-1.5 py-px text-[9.5px] font-extrabold", chip.cls)}>{chip.text}</span>}
      </p>
      {note && <p className="text-[10.5px] text-muted">{note}</p>}
      {meter != null && (
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-stone-200">
          <span className="block h-full rounded-full bg-gradient-to-r from-[#caa45a] to-[#4a3b1a]" style={{ width: `${Math.min(meter, 100)}%` }} />
        </span>
      )}
    </div>
  );
}

// LINE # | CUBIC # | QTY (2026-08-26). Hiling ni Joe: dropdown na hati-hati —
// ang stock ng isang produkto ay maaaring nasa ilang cubic (L1-A1 ang luma,
// L3-A1 ang bagong dating na hindi na kasya). Bawat hilera ay isang puwesto;
// ang "+" ay nagdadagdag ng hilera, at ang Save ang nagtatala nang sabay
// (assignPlacements — pinapalitan ang buong larawan ng puwesto ng SKU).
type SplitRow = { line: string; cubic: string; qty: number };
function SplitAssign({ byLine, disabled, onHand, onSave }: {
  byLine: [string, LocCard[]][];
  disabled?: boolean;
  onHand: number;
  onSave: (splits: { code: string; qty: number }[]) => void;
}) {
  const [rows, setRows] = useState<SplitRow[]>([{ line: "", cubic: "", qty: Math.max(onHand, 1) }]);
  const [err, setErr] = useState<string | null>(null);
  const cubicsOf = (line: string) => byLine.find(([l]) => l === line)?.[1] ?? [];
  const set = (i: number, patch: Partial<SplitRow>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = () => {
    const filled = rows.filter((r) => r.line && r.cubic && r.qty > 0);
    if (!filled.length) { setErr("Pick a line, a cubic, and a quantity."); return; }
    if (filled.length < rows.length) { setErr("Complete or remove the empty split row."); return; }
    const total = filled.reduce((a, r) => a + r.qty, 0);
    if (onHand > 0 && total > onHand) { setErr(`Splits total ${total} but only ${onHand} on hand.`); return; }
    setErr(null);
    onSave(filled.map((r) => ({ code: r.cubic, qty: r.qty })));
  };
  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select disabled={disabled} value={r.line} onChange={(e) => set(i, { line: e.target.value, cubic: "" })} className={cn(inp, "w-[92px] px-2 py-1.5 text-xs")}>
            <option value="">Line #</option>
            {byLine.map(([line]) => <option key={line} value={line}>{line}</option>)}
          </select>
          <select disabled={disabled || !r.line} value={r.cubic} onChange={(e) => set(i, { cubic: e.target.value })} className={cn(inp, "w-[92px] px-2 py-1.5 font-mono text-xs")}>
            <option value="">Cubic #</option>
            {cubicsOf(r.line).map((l) => <option key={l.id} value={l.code}>{l.code.split("-")[1] ?? l.code}</option>)}
          </select>
          <input disabled={disabled} type="number" min={1} value={r.qty || ""} onChange={(e) => set(i, { qty: Math.max(Math.floor(Number(e.target.value) || 0), 0) })} className={cn(inp, "w-[64px] px-2 py-1.5 text-center text-xs")} placeholder="Qty" />
          {rows.length > 1 ? (
            <button type="button" disabled={disabled} onClick={() => setRows((p) => p.filter((_, j) => j !== i))} title="Remove this split" className="text-muted hover:text-red-600">✕</button>
          ) : <span className="w-[13px]" />}
        </div>
      ))}
      <div className="flex items-center gap-2">
        {err && <span className="text-[11px] font-medium text-red-600">{err}</span>}
        <button type="button" disabled={disabled} onClick={() => setRows((p) => [...p, { line: "", cubic: "", qty: 1 }])} className="rounded-lg border border-[#caa45a] bg-[#faf6ec] px-2.5 py-1 text-[11px] font-semibold text-[#4a3b1a] hover:bg-[#f4ead8]" title="Add another cubic for the remaining pieces">+</button>
        <button type="button" disabled={disabled} onClick={save} className="rounded-lg bg-[#4a3b1a] px-3 py-1 text-[11px] font-bold text-[#f4ead8] hover:opacity-90 disabled:opacity-50">Save</button>
      </div>
    </div>
  );
}

// Mabilisang pag-assign ng lahat ng WALANG lokasyon — bawat produkto ay may
// rack dropdown; ang pag-pili ay agad nagse-save (assignLocation).
function AssignUnassignedModal({ unassigned, locations, onClose }: { unassigned: LocProduct[]; locations: LocCard[]; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const router = useRouter();
  // Naka-grupo kada LINYA (optgroup) — hindi nakakalito ang mahabang listahan
  // ng cubics kapag may Line 1/2/… na heading (kahilingan 2026-08-10).
  const byLine = useMemo(() => {
    const m = new Map<string, LocCard[]>();
    for (const l of locations) m.set(l.zone ?? "No line", [...(m.get(l.zone ?? "No line") ?? []), l]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [locations]);
  // PARTIAL NA PAGLALAGAY (2026-08-26): ang 5 piraso na nailagay nang 3 ay may
  // 2 pang naghihintay — nananatili ang hilera na may natitirang bilang para
  // maiassign ulit sa ibang cubic. Kumpleto lang ang "✓ Assigned".
  const [leftById, setLeftById] = useState<Map<string, number>>(new Map());
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const act = (p: LocProduct, splits: { code: string; qty: number }[]) => start(async () => {
    const res = await assignPlacements(p.id, { sku: p.sku, name: p.product_name, color: p.color }, splits);
    if ("error" in res) { setSaveErr(res.error); return; }
    setSaveErr(null);
    const placed = splits.reduce((a, x) => a + x.qty, 0);
    const before = leftById.get(p.key) ?? p.onHand;
    const left = Math.max(before - placed, 0);
    if (left <= 0) setDoneIds((prev) => new Set(prev).add(p.key));
    else setLeftById((prev) => new Map(prev).set(p.key, left));
    router.refresh();
  });
  return (
    <Modal open onClose={onClose} title="Assign Storage Locations" description={`${unassigned.length} product${unassigned.length === 1 ? "" : "s"} without a rack`} size="lg" brand={{ icon: "AS" }}
      footer={<div className="flex justify-end"><button onClick={onClose} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90">Done</button></div>}>
      {saveErr && <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{saveErr}</p>}
      <ul className="max-h-[55vh] space-y-2.5 overflow-y-auto">
        {unassigned.map((p) => (
          <li key={p.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-[#faf6ec]/60 px-4 py-3">
            <ProductImg p={p} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[#3a2e14]">{p.product_name}</span>
              <span className="block font-mono text-[11px] text-muted">{p.sku ?? "—"}{p.color ? <span className="ml-1.5 font-sans text-[11px] text-[#8a6a1f]">{p.color}</span> : null}</span>
            </span>
            {doneIds.has(p.key) ? (
              <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">✓ Assigned</span>
            ) : (() => {
              const left = leftById.get(p.key) ?? p.onHand;
              return (
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {left < p.onHand && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                      {p.onHand - left} placed · {left} left
                    </span>
                  )}
                  {/* Bagong key kada natitira — nagre-reset ang split rows sa
                      bagong default (ang natitira) pagkatapos ng partial save. */}
                  <SplitAssign key={left} byLine={byLine} disabled={pending} onHand={left} onSave={(splits) => act(p, splits)} />
                </span>
              );
            })()}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function LocationForm({ loc, usedCodes, onClose }: { loc: LocCard | null; usedCodes: string[]; onClose: () => void }) {
  const isNew = !loc;
  const used = new Set(usedCodes.map((c) => c.toLowerCase()));
  const [pending, start] = useTransition();
  const [delPending, startDel] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [f, setF] = useState<LocationInput>({
    code: loc?.code ?? "",
    zone: loc?.zone ?? "",
    aisle: "",
    rack: "",
    bin: "",
    capacity: loc?.capacity ?? null,
    description: "",
    status: loc?.status ?? "active",
  });
  const set = (k: keyof LocationInput, v: string | number | null) => setF((p) => ({ ...p, [k]: v }));
  // Cubic # — hango sa code kapag nag-e-edit (tinatanggal ang "L<n>-" na unahan);
  // ang lumang code na hindi cubic (hal. Rak-01) ay lalabas nang buo.
  const [cubic, setCubic] = useState(() => (loc?.code ?? "").replace(/^L\d+-/, ""));

  // Alin sa mga cubic ang bakante PA sa napiling linya (tago ang ginagamit na,
  // maliban sa sariling cubic kapag nag-e-edit).
  const cubicOptions = CUBICS.filter((c) => {
    const code = derivedCode(f.zone, c).toLowerCase();
    return !used.has(code) || (loc && code === loc.code.toLowerCase());
  });

  function save() {
    setError(null);
    const code = derivedCode(f.zone, cubic.trim());
    if (!cubic.trim()) { setError("Pick a cubic number."); return; }
    start(async () => {
      const payload = { ...f, code };
      const res = isNew ? await createLocation(payload) : await updateLocation(loc!.id, payload);
      if ("error" in res) { setError(res.error); return; }
      onClose(); router.refresh();
    });
  }
  function remove() {
    if (!loc) return;
    startDel(async () => {
      const res = await deleteLocation(loc.id);
      if ("error" in res) { setError(res.error); return; }
      onClose(); router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "Add Location" : `Edit ${loc!.code}`} description={isNew ? "Create a new storage cubic" : loc!.zone ?? undefined} size="md" brand={{ icon: isNew ? "+" : "RK" }}
      footer={
        <div className="flex items-center justify-between gap-2">
          {!isNew ? <button onClick={remove} disabled={delPending} className="rounded-lg border border-danger/40 px-3 py-2 text-sm font-medium text-danger hover:bg-red-50 disabled:opacity-60">{delPending ? "Deleting…" : "Delete"}</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Cancel</button>
            <button onClick={save} disabled={pending} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90 disabled:opacity-60">{pending ? "Saving…" : isNew ? "Add Location" : "Save"}</button>
          </div>
        </div>
      }>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <F label="Line Number *"><select value={f.zone ?? ""} onChange={(e) => set("zone", e.target.value)} className={cn(inp, "w-full px-3 py-2")}><option value="">— Select —</option>{LINES.map((z) => <option key={z}>{z}</option>)}{f.zone && !LINES.includes(f.zone) && <option value={f.zone}>{f.zone}</option>}</select></F>
        {/* Naka-grupo kada letra (optgroup) — hindi nakakalito ang mahabang
            listahan kapag may A/B/C/D/E na heading (kahilingan 2026-08-10). */}
        <F label="Cubic # *"><select value={cubic} onChange={(e) => setCubic(e.target.value)} className={cn(inp, "w-full px-3 py-2")}>
          <option value="">— Select —</option>
          {["A", "B", "C", "D", "E"].map((L) => {
            const opts = cubicOptions.filter((c) => c.startsWith(L));
            return opts.length ? (
              <optgroup key={L} label={`Cubic ${L}`}>
                {opts.map((c) => <option key={c}>{c}</option>)}
              </optgroup>
            ) : null;
          })}
          {cubic && !cubicOptions.includes(cubic) && <option value={cubic}>{cubic}</option>}
        </select></F>
        <F label="Capacity (units)"><select value={f.capacity ?? ""} onChange={(e) => set("capacity", e.target.value === "" ? null : Number(e.target.value))} className={cn(inp, "w-full px-3 py-2")}><option value="">Unlimited</option>{CAPACITIES.map((c) => <option key={c} value={c}>{c}</option>)}{f.capacity != null && !CAPACITIES.includes(f.capacity) && <option value={f.capacity}>{f.capacity}</option>}</select></F>
        <F label="Status"><select value={f.status} onChange={(e) => set("status", e.target.value)} className={cn(inp, "w-full px-3 py-2")}><option value="active">Active</option><option value="inactive">Inactive</option></select></F>
        <F label="Description" full><input value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="Optional note about this rack…" className={cn(inp, "w-full px-3 py-2")} /></F>
      </div>
      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
    </Modal>
  );
}

function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1.5", full && "sm:col-span-2")}>
      <label className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#a8842e]">{label}</label>
      {children}
    </div>
  );
}

function LocationModal({ loc, all, unassigned, onClose, onEdit }: { loc: LocCard; all: LocProduct[]; unassigned: LocProduct[]; onClose: () => void; onEdit: () => void }) {
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  // Design sheet viewer — parehong pop-up ng workshop, hindi bagong tab.
  const [viewSheet, setViewSheet] = useState<{ title: string; url: string } | null>(null);
  // PRODUCT DETAILS sa pag-click ng row (2026-08-26) — parehong itsura ng
  // workshop: larawan, SKU, specs cards, at ang Design Details card.
  const [details, setDetails] = useState<{ p: LocProduct; o: LocOrderRef | null } | null>(null);
  const [q, setQ] = useState("");
  const router = useRouter();

  const pool = useMemo(() => {
    const s = q.trim().toLowerCase();
    // MAY STOCK LANG ang inaalok (onHand > 0): ang mga cubic card ay hinango sa
    // INVENTORY, kaya ang produktong walang stock ay hindi kailanman lalabas sa
    // card kahit i-assign — mukhang sira ang Assign (naiulat 2026-08-10 sa
    // L1-A3). Ang stock ay pumapasok sa cubic sa QC Receiving (Cubic # picker).
    const base = (unassigned.length ? unassigned : all.filter((p) => !loc.products.some((x) => x.key === p.key)))
      .filter((p) => p.onHand > 0);
    return (s ? base.filter((p) => p.product_name.toLowerCase().includes(s) || (p.sku ?? "").toLowerCase().includes(s)) : base).slice(0, 8);
  }, [q, all, unassigned, loc.products]);

  const act = (p: LocProduct, code: string | null) => start(async () => { await assignLocation(p.id, code, { sku: p.sku, name: p.product_name, color: p.color }); router.refresh(); });

  // Reprint QR — parehong QC-passed label ng QC IN (isang sticker kada pindot).
  const reprint = (p: LocProduct) => printQcPassedLabels({
    sku: p.sku,
    product_name: p.product_name,
    category: p.category,
    color: p.color,
    dimension: p.dimension,
    location: loc.code,
    warehouse_location: loc.zone,
    qc_id: p.qc?.id ?? null,
    inspector: p.qc?.inspector ?? null,
    qc_date: p.qc?.date ?? null,
    direction: "in",
  }, 1);

  return (
    <>
    <Modal open onClose={onClose} title={loc.code} description={loc.zone ?? "No line"} size="full" brand={{ icon: loc.code.replace(/[^0-9]/g, "").slice(-2) || "RK" }}
      footer={<div className="flex justify-between"><button onClick={onEdit} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Edit Location</button><button onClick={onClose} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90">Close</button></div>}>
      <div className="space-y-5">
        {/* Stat band — manipis (aprubadong redesign 2026-08-16): hindi na
            malalaking cards, kasama na ang utilization kapag may capacity. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-[#faf6ec]/70 px-4 py-2.5">
          <MiniStat label="Units" value={fmt(loc.units)} />
          <MiniStat label="SKUs" value={fmt(loc.skuCount)} />
          <MiniStat label="Capacity" value={loc.capacity != null ? fmt(loc.capacity) : "Unlimited"} />
          {loc.utilization != null && (
            <div className="flex min-w-[160px] flex-1 items-center gap-2.5">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#a8842e]">Utilization</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-stone-200">
                <span className={cn("block h-full rounded-full", loc.utilization >= 1 ? "bg-rose-500" : loc.utilization >= 0.85 ? "bg-amber-500" : "bg-gradient-to-r from-[#caa45a] to-[#4a3b1a]")} style={{ width: `${Math.round(loc.utilization * 100)}%` }} />
              </span>
              <span className="text-xs font-extrabold tabular-nums text-[#3a2e14]">{Math.round(loc.utilization * 100)}%</span>
            </div>
          )}
        </div>

        {/* Products header + assign */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-extrabold text-[#3a2e14]">Stored in this location <span className="font-semibold text-muted">({loc.products.length})</span></p>
          <button onClick={() => setAdding((v) => !v)} className="rounded-lg border border-[#caa45a] bg-[#faf6ec] px-3.5 py-2 text-xs font-bold text-[#4a3b1a] hover:bg-[#f4ead8]">{adding ? "✕ Cancel" : "+ Assign product"}</button>
        </div>

        {adding && (
          <div className="rounded-xl border border-[#caa45a]/50 bg-[#faf6ec]/60 p-4">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product to assign…" className="mb-3 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[#caa45a]" autoFocus />
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {pool.length === 0 ? (
                <li className="px-2 py-4 text-center text-xs text-muted">
                  No products with stock to assign. Stock enters a cubic through QC Receiving (Cubic # on the inspection form).
                </li>
              ) : pool.map((p) => (
                <li key={p.key}>
                  <button disabled={pending} onClick={() => act(p, loc.code)} className="flex w-full items-center gap-3 rounded-lg bg-surface px-3 py-2 text-left ring-1 ring-border transition-colors hover:ring-[#caa45a] disabled:opacity-60">
                    <ProductImg p={p} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.product_name}</span><span className="block font-mono text-[11px] text-muted">{p.sku ?? "—"}{p.color ? <span className="ml-1.5 font-sans text-[11px] text-[#8a6a1f]">{p.color}</span> : null}</span></span>
                    <span className="shrink-0 rounded-md bg-[#4a3b1a] px-3 py-1.5 text-xs font-bold text-[#f4ead8]">Assign</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Products table — BUONG detail columns (SKU/Category/Color/Dimension
            hiwa-hiwalay pa rin) na kasya nang WALANG side-scroll: table-fixed
            + naka-budget na column widths (aprubadong redesign 2026-08-16). */}
        {loc.products.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-stone-50 py-12 text-center text-sm text-muted">No products stored here yet. Click <b>+ Assign product</b>.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[1240px] table-fixed border-collapse text-center text-xs [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:align-middle [&_th]:border-b [&_th]:border-r [&_th]:border-[#6b5a2f] [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0 [&_td]:!text-center [&_th]:!text-center">
              {/* Tanggal ang Dimension (2026-08-19) — nasa specs na ang sukat;
                  ang laya ay ibinigay sa Product/Color/Order columns. */}
              {/* May sariling Photo column na (2026-08-26), at ang SKU ay
                  hindi na pinuputol — buong ACCENT-000012, hindi "ACCENT-0000…". */}
              <colgroup>
                <col className="w-[5.5%]" />
                <col className="w-[14%]" />
                <col className="w-[11%]" />
                <col className="w-[8%]" />
                <col className="w-[9%]" />
                <col className="w-[5.5%]" />
                <col className="w-[6%]" />
                <col className="w-[6%]" />
                <col className="w-[7%]" />
                <col className="w-[9.5%]" />
                <col className="w-[10%]" />
                <col className="w-[9.5%]" />
                <col className="w-[4.5%]" />
              </colgroup>
              <thead>
                <tr className="bg-[#5a4a26] text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-[#e7dcc4]">
                  <th className="px-2 py-2.5">Photo</th>
                  <th className="px-2 py-2.5">Product</th>
                  <th className="px-2 py-2.5">SKU</th>
                  <th className="px-2 py-2.5">Category</th>
                  <th className="px-2 py-2.5">Color</th>
                  <th className="px-2 py-2.5">On Hand</th>
                  <th className="px-2 py-2.5">Reserved</th>
                  <th className="px-2 py-2.5">Available</th>
                  <th className="px-2 py-2.5">Design Details</th>
                  <th className="px-2 py-2.5">Order #</th>
                  <th className="px-2 py-2.5">Customer</th>
                  <th className="px-2 py-2.5">Delivery</th>
                  <th className="px-2 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {loc.products.map((p) => {
                  // NAKA-ASSIGN NA ORDERS bilang sariling row: isang row kada
                  // order (Order # + Customer + Delivery), blank kapag wala pa.
                  // HANGGANG ON-HAND LANG (2 units = 2 order na aabutan) — ang
                  // mga lumang sobrang naka-reserve ay bilang na lang sa dulo.
                  const sorted = [...(p.orders ?? [])].sort((a, b) => {
                    if (a.deliveryDate && b.deliveryDate) return a.deliveryDate.localeCompare(b.deliveryDate);
                    if (a.deliveryDate) return -1;
                    if (b.deliveryDate) return 1;
                    return b.orderNumber.localeCompare(a.orderNumber);
                  });
                  const shown: typeof sorted = [];
                  let used = 0;
                  for (const o of sorted) {
                    if (used >= p.onHand) break;
                    shown.push(o);
                    used += Math.max(1, o.qty);
                  }
                  const rest = sorted.length - shown.length;
                  const N = Math.max(1, shown.length);
                  return (
                    <Fragment key={p.key}>
                      {Array.from({ length: N }, (_, i) => {
                        const o = shown[i];
                        return (
                          <tr key={i} onClick={() => setDetails({ p, o: o ?? null })} className="cursor-pointer hover:bg-stone-50" title="View product details">
                            {i === 0 && (
                              <>
                                <td rowSpan={N} className="px-2 py-2.5">
                                  <div className="flex justify-center"><ProductImg p={p} small /></div>
                                </td>
                                <td rowSpan={N} className="px-2 py-2.5">
                                  <span className="block min-w-0 truncate text-center font-medium" title={p.product_name}>{p.product_name}</span>
                                </td>
                                <td rowSpan={N} className="whitespace-nowrap px-2 py-2.5 font-mono text-[10.5px] text-muted">{p.sku ?? "—"}</td>
                                <td rowSpan={N} className="truncate px-2 py-2.5" title={p.category ?? undefined}>{p.category ?? "—"}</td>
                                <td rowSpan={N} className="truncate px-2 py-2.5" title={p.color ?? undefined}>{p.color ?? "—"}</td>
                                {/* On Hand at Available = ISANG cell kada produkto (span);
                                    ang Reserved ay PER ROW — ang laan ng mismong order sa
                                    row na iyon (kahilingan 2026-08-10). */}
                                <td rowSpan={N} className="px-2 py-2.5 font-semibold tabular-nums">{fmt(p.onHand)}</td>
                              </>
                            )}
                            {/* RESERVED = ISANG CELL KADA PRODUKTO (2026-08-29), gaya ng
                                On Hand at Available sa magkabilang tabi nito.
                                Per-hilera ito noon, at ang ipinapakita ay ang dami ng
                                order sa tabi — kaya kapag mas marami ang naglalaan
                                kaysa sa mga nakalista rito, hindi nagkakasundo ang
                                hilera sa sarili nito: ang ACCENT-000014 ay may
                                `reserved` na 2 mula sa dalawang order, pero isa lang
                                ang nakalista, at ang hilera ay nagbasa ng
                                "4 on hand, 1 reserved, 2 available".
                                Ang `inventory.reserved` ang buong laan ng produkto;
                                ang mga order sa tabi ang nagsasabi kung kanino. */}
                            {i === 0 && (
                              <td rowSpan={N} className="px-2 py-2.5 font-semibold tabular-nums text-amber-700">
                                {(p.reserved ?? 0) > 0
                                  ? fmt(p.reserved!)
                                  : <span className="font-normal text-muted">—</span>}
                              </td>
                            )}
                            {i === 0 && (
                              <td rowSpan={N} className={cn("px-2 py-2.5 font-semibold tabular-nums", (p.available ?? 0) > 0 ? "text-emerald-700" : "text-rose-700")}>{fmt(p.available ?? 0)}</td>
                            )}
                            {/* DESIGN DETAILS (2026-08-26) — ang sheet ng
                                produktong ito sa order na ito; bukas sa bagong
                                tab. Gitna, gaya ng lahat. */}
                            <td className="px-2 py-2.5">
                              {o?.designUrl ? (
                                <button type="button" onClick={(e) => { e.stopPropagation(); setViewSheet({ title: `Design Details — ${o.orderNumber} · ${p.product_name}`, url: o.designUrl! }); }} className="inline-flex items-center gap-1 rounded-lg border border-[#caa45a] bg-[#fffaf0] px-2 py-0.5 text-[10px] font-bold text-[#4a3b1a] hover:bg-[#f4ead8]">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>
                                  View
                                </button>
                              ) : <span className="text-muted">—</span>}
                            </td>
                            <td className="truncate px-2 py-2.5">
                              {o ? (
                                <span className="font-mono text-[10.5px] font-bold text-[#8a6a1f]">{o.orderNumber}</span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                              {i === N - 1 && rest > 0 && (
                                <span className="ml-1 text-[9.5px] text-muted" title="More reserved orders than the on-hand units here can cover">+{rest}</span>
                              )}
                            </td>
                            <td className="truncate px-2 py-2.5" title={o?.customer ?? undefined}>
                              {o ? <span className="font-medium">{o.customer ?? "—"}</span> : <span className="text-muted">—</span>}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2.5">
                              {o ? (
                                o.deliveryDate
                                  ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700 ring-1 ring-inset ring-amber-600/20">{new Date(o.deliveryDate).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}</span>
                                  : <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-500">No date</span>
                              ) : <span className="text-muted">—</span>}
                            </td>
                            {/* PRINT PER ROW (aprubadong redesign 2026-08-16):
                                bawat order row ay may sariling Reprint QR;
                                ang Remove ay minsanan kada produkto. */}
                            <td className="px-1 py-2.5">
                              <div className="flex items-center justify-center gap-0.5">
                                <button
                                  onClick={(e) => { e.stopPropagation(); reprint(p); }}
                                  aria-label="Reprint QR label"
                                  title="Reprint the QC-passed QR label (one sticker)"
                                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-[#faf6ec] hover:text-[#4a3b1a]"
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
                                </button>
                                {i === 0 && (
                                  <button disabled={pending} onClick={(e) => { e.stopPropagation(); act(p, null); }} aria-label="Remove" className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-danger disabled:opacity-60" title="Remove from location">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
      {details && (() => {
        const { p, o: oRow } = details;
        // ANG SPECS AY SA PRODUKTO, HINDI SA PUWESTO (2026-08-26). Ang order
        // ref ay nakalakip sa UNANG cubic lang ng hati — pero ang pag-click sa
        // pangalawang puwesto ay dapat pa ring magpakita ng build at design
        // sheet. Pambalik: ang kumpletong product entry mula sa catalog list
        // (`all`), na buo ang orders anuman ang cubic.
        const full = p.sku ? all.find((x) => (x.sku ?? "").toLowerCase() === p.sku!.toLowerCase()) : undefined;
        const o = oRow ?? full?.orders?.[0] ?? null;
        const buildText = (o?.itemDesc ?? "").split("\n").slice(1).map((l: string) => l.trim().replace(/^[•·-]\s*/, "")).filter(Boolean).join("\n");
        // Walang order build (stock na walang nakalaan) → ang catalog specs ang
        // ipakita — LAHAT ng produkto ay may specification section.
        const specText = buildText || full?.specs || p.specs || "";
        return (
          <Modal open onClose={() => setDetails(null)} title="Product Details" description={oRow?.orderNumber ?? loc.code} size="lg"
            footer={<div className="flex justify-end"><button type="button" onClick={() => setDetails(null)} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90">Close</button></div>}>
            <div className="space-y-4">
              {p.image_url && (
                <div className="flex justify-center rounded-xl border border-border bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.image_url} alt={p.product_name} className="max-h-56 object-contain" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-border bg-[#faf6ec]/60 px-3 py-2"><p className="text-[10px] font-bold uppercase text-muted">SKU</p><p className="font-mono text-xs">{p.sku ?? "—"}</p></div>
                <div className="rounded-lg border border-border bg-[#faf6ec]/60 px-3 py-2"><p className="text-[10px] font-bold uppercase text-muted">Category</p><p className="text-xs font-medium">{p.category ?? "—"}</p></div>
                <div className="rounded-lg border border-border bg-[#faf6ec]/60 px-3 py-2"><p className="text-[10px] font-bold uppercase text-muted">Product / Name</p><p className="text-xs font-medium">{p.product_name}</p></div>
                <div className="rounded-lg border border-border bg-[#faf6ec]/60 px-3 py-2"><p className="text-[10px] font-bold uppercase text-muted">Qty</p><p className="text-xs font-semibold tabular-nums">{oRow ? fmt(Math.min(oRow.qty, p.onHand)) : fmt(p.onHand)}</p></div>
              </div>
              {specText && (
                <div>
                  {/* May sariling pamagat na ang SpecFieldsView — huwag ulitin. */}
                  <SpecFieldsView category={specCategoryOf(p.category ?? "", p.product_name)} specs={specText} />
                </div>
              )}
              {o?.design && (
                <div className="overflow-hidden rounded-xl border-[1.5px] border-[#caa45a] bg-white shadow-[0_0_0_3px_rgba(202,164,90,0.14)]">
                  <div className="flex items-center justify-between bg-gradient-to-r from-[#52421d] to-[#4a3b1a] px-3 py-1.5">
                    <span className="text-xs font-bold tracking-wide text-[#f4ead8]">DESIGN DETAILS</span>
                    <span className="font-mono text-[10.5px] text-[#e7dcc4]">{o.design.ddNumber ?? ""}</span>
                  </div>
                  <div className="flex items-center gap-3 p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={o.design.url} alt="" className="h-16 w-12 rounded border border-border object-cover" />
                    <div className="min-w-0 flex-1">
                      {/^accepted$/i.test(o.design.status ?? "") && <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">✓ APPROVED</span>}
                      {o.design.preparedBy && <p className="mt-1 text-[11px] text-muted">Prepared by <b className="text-foreground">{o.design.preparedBy}</b></p>}
                    </div>
                  </div>
                  <button type="button" onClick={() => setViewSheet({ title: `Design Details — ${o.orderNumber} · ${p.product_name}`, url: o.design!.url })} className="w-full border-t border-[#e6dcc4] bg-[#fffaf0] py-2 text-center text-[11px] font-extrabold uppercase tracking-wider text-[#4a3b1a] hover:bg-[#f4ead8]">View Full Sheet</button>
                </div>
              )}
            </div>
          </Modal>
        );
      })()}
      {/* Parehong viewer ng workshop: PDF = iframe, image = img, isang pop-up. */}
      {viewSheet && (
        <Modal open onClose={() => setViewSheet(null)} title={viewSheet.title} size="2xl"
          footer={<div className="flex justify-end"><button type="button" onClick={() => setViewSheet(null)} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90">Close</button></div>}>
          {/\.pdf($|\?)/i.test(viewSheet.url) ? (
            <iframe src={`${viewSheet.url}#toolbar=0&navpanes=0&view=Fit`} title={viewSheet.title} className="mx-auto h-[80vh] w-full max-w-[900px] rounded-lg border border-border bg-white" />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={viewSheet.url} alt={viewSheet.title} className="mx-auto w-full max-w-[900px] rounded-lg border border-border bg-white" />
          )}
        </Modal>
      )}
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#a8842e]">{label}</span>
      <span className="text-base font-extrabold tabular-nums text-[#3a2e14]">{value}</span>
    </div>
  );
}

// Circular occupancy ring. Shows % when capacity is set, else a "∞" badge.
function Donut({ pct, stroke, tone }: { pct: number | null; stroke: string; tone: string }) {
  const r = 20, c = 2 * Math.PI * r;
  const off = pct != null ? c * (1 - Math.min(pct, 100) / 100) : c;
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 48 48" className="h-14 w-14 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" className="stroke-stone-100" strokeWidth="5" />
        {pct != null && <circle cx="24" cy="24" r={r} fill="none" className={cn("transition-all", stroke)} strokeWidth="5" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />}
      </svg>
      <span className={cn("absolute inset-0 flex items-center justify-center text-xs font-bold", tone)}>
        {pct != null ? `${pct}%` : "∞"}
      </span>
    </div>
  );
}

function ProductImg({ p, small }: { p: LocProduct; small?: boolean }) {
  const sz = small ? "h-6 w-6 rounded-md text-[8px]" : "h-8 w-8 rounded text-[9px]";
  return p.image_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img loading="lazy" decoding="async" src={p.image_url} alt="" className={cn("shrink-0 object-cover ring-1 ring-border", sz)} />
  ) : (
    <span className={cn("flex shrink-0 items-center justify-center bg-stone-200 font-semibold text-stone-500", sz)}>{p.product_name.slice(0, 2).toUpperCase()}</span>
  );
}
