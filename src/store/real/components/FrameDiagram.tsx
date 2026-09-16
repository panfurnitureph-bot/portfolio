"use client";

// FRAME DIMENSIONS — malinis na 2D na gilid-na-tanaw ng kama (headboard +
// base + paa + footboard) na may A–E na sukat at size table. Binago 2026-08-23:
// dating 3/4 na perspektiba; ngayon ay side elevation, dahil dito kumakasya ang
// ADD-ON LAYERS nang malinaw — bawat add-on na pinili ng customer sa customizer
// ay lumilitaw sa sariling puwesto (manipis/dashed), may letra (F–M), may
// leader line sa bahagi, at may hanay sa table. Walang pinili = frame lang.
//
// Ang `build` ay galing sa pb-build-change ng MtoOptions (ProductTabs ang
// nakikinig at nagpapasa). Ang `sizes` (A–E kada size) ay galing sa Publish ng
// IMS Configurator (deriveBedSizes) — o sa default dito kapag wala.

import type { JSX } from "react";
import { useState } from "react";
import { frameFor } from "@/lib/double-walling";

const GOLD = "#8a7b2e";

export type BedSize = {
  size: string;
  dim: string;
  A: string;
  B: string;
  C: string;
  D: string;
  E: string;
};

export const DEFAULT_BED_SIZES: BedSize[] = [
  { size: "SINGLE", dim: '36"x75"', A: '40"', B: '48"', C: '81"', D: '12"', E: '4"' },
  { size: "TWIN", dim: '48"x75"', A: '52"', B: '48"', C: '81"', D: '12"', E: '4"' },
  { size: "DOUBLE/FULL", dim: '54"x75"', A: '58"', B: '48"', C: '81"', D: '12"', E: '4"' },
  { size: "QUEEN", dim: '60"x75"', A: '64"', B: '48"', C: '81"', D: '12"', E: '4"' },
  { size: "KING", dim: '72"x75"', A: '76"', B: '48"', C: '81"', D: '12"', E: '4"' },
  { size: "KING 2", dim: '72"x78"', A: '76"', B: '48"', C: '84"', D: '12"', E: '4"' },
];

export type FrameAddOn = {
  id: string;
  label: string;
  detail?: string;
  price: number;
};

// ANG BUILD NG CUSTOMER — normalized na kopya ng estado ng customizer.
export type BedBuild = {
  size?: string;
  checks?: string[];                 // naka-check na ADD-ON label ("2 built-in drawers", "Pullout 30X70", …)
  choices?: Record<string, string>;  // choice group -> napiling value ("Drawer Position…" -> "Left")
  dw?: { thick?: number; h?: string; pad?: string; w?: string; nails?: string; accent?: boolean };
  meas?: Record<string, number>;     // measurement label -> halaga (Headboard Height, Exceed…)
};

export type BuildRow = { k: string; label: string; value: string };

// Mula sa build → mga aktibong add-on na may letra at halaga. Ginagamit din ng
// ProductTabs para sa kaliwang listahan, kaya iisa ang pinagmumulan.
export function bedBuildRows(build?: BedBuild | null): BuildRow[] {
  if (!build) return [];
  const checks = build.checks ?? [];
  const pick = (re: RegExp) => checks.find((l) => re.test(l));
  const choice = (re: RegExp) => {
    const k = Object.keys(build.choices ?? {}).find((g) => re.test(g));
    return k ? (build.choices?.[k] ?? "") : "";
  };
  const rows: BuildRow[] = [];
  const drawers = pick(/drawer/i);
  if (drawers) {
    const pos = choice(/drawer position|footboard drawer/i);
    rows.push({ k: "F", label: "Drawers", value: drawers + (pos ? " · " + pos : "") });
  }
  const pullout = pick(/pullout/i);
  if (pullout) {
    const m = /(\d+)\s*X\s*(\d+)/i.exec(pullout);
    rows.push({ k: "G", label: "Pullout Bed", value: m ? `${m[1]}"×${m[2]}"` : pullout });
  }
  if (pick(/double walling/i)) {
    // Kapal ng dingding + sukat ng FRAME mula sa talaan ng team (frameFor) —
    // ito ang sinusunod ng A at C sa table kapag naka-double wall.
    const t = build.dw?.thick ?? 8;
    const f = build.size ? frameFor(build.size, t) : null;
    const extra = [
      build.dw?.h?.trim() && `H ${build.dw.h.trim()}"`,
      build.dw?.pad?.trim() && `T ${build.dw.pad.trim()}"`,
      build.dw?.w?.trim() && `W ${build.dw.w.trim()}"`,
      build.dw?.nails?.trim() && `${build.dw.nails.trim()} nails`,
      build.dw?.accent && "Gold accent",
    ].filter(Boolean).join(" · ");
    rows.push({ k: "H", label: "Double Walling", value: `${t}"` + (f ? ` · frame ${f.w}"×${f.l}"` : "") + (extra ? ` · ${extra}` : "") });
  }
  const tuft = pick(/tufted/i);
  if (tuft) {
    const mt = Object.entries(build.meas ?? {}).find(([k, v]) => /mattress thickness/i.test(k) && v > 0);
    rows.push({ k: "I", label: /elevated/i.test(tuft) ? "Elevated Footboard" : "Tufted Footboard", value: mt ? `mattress ${mt[1]}"` : "Tufted" });
  }
  if (/^winged$/i.test(choice(/wing/i).trim())) rows.push({ k: "J", label: "Winged Headboard", value: "Winged" });
  const exChoice = choice(/exceed/i);
  const ex = Object.entries(build.meas ?? {}).find(([k, v]) => /exceed/i.test(k) && v > 0);
  if (exChoice && !/none/i.test(exChoice)) rows.push({ k: "K", label: "Exceed Headboard", value: exChoice });
  else if (ex) rows.push({ k: "K", label: "Exceed Headboard", value: `${ex[1]}"` });
  const insert = choice(/mattress insert/i);
  const insMeas = Object.entries(build.meas ?? {}).find(([k, v]) => /mattress insert/i.test(k) && v > 0);
  if (insert && !/none/i.test(insert)) rows.push({ k: "L", label: "Mattress Insert", value: insert });
  else if (insMeas) rows.push({ k: "L", label: "Mattress Insert", value: `${insMeas[1]}"` });
  if (pick(/lift storage/i)) rows.push({ k: "M", label: "Lift Storage", value: "Platform base" });
  return rows;
}

// Mga bandila ng frame mula sa build — ginagamit ng diagram AT ng kaliwang
// column ng ProductTabs para iisa ang pinagmumulan.
export function bedFlags(build?: BedBuild | null) {
  const choice = (re: RegExp) => {
    const k = Object.keys(build?.choices ?? {}).find((g) => re.test(g));
    return k ? (build?.choices?.[k] ?? "") : "";
  };
  const noHead = /none/i.test(choice(/^headboard/i));
  const legs = choice(/^legs?\b/i);
  const lift = (build?.checks ?? []).some((l) => /lift storage/i.test(l));
  const wallPad = parseFloat(build?.dw?.pad ?? "") || 0;
  return { noHead, platform: lift || /platform/i.test(legs), floating: /floating/i.test(legs), wallPad };
}

// LOCKED / AS-IS NA ITEM: walang customizer na nagpapadala ng build, kaya ang
// ORIHINAL na specs ng produkto (IMS Products, composeBedSpecs) ang binabasa
// pabalik sa BedBuild — sumusunod ang diagram sa nakalagay: drawers, pullout,
// double walling (kapal + H/T/W + nails/accent), lift, legs, insert, tufted,
// winged, exceed, headboard height. Ang customizable na item ay live pa rin
// (pb-build-change ang nangingibabaw).
export function buildFromSpecs(lines: string[]): BedBuild | null {
  const L = (lines ?? []).map((l) => l.trim()).filter(Boolean);
  if (!L.length) return null;
  const b: BedBuild = { checks: [], choices: {}, dw: {}, meas: {} };
  const num = (v: string) => { const m = /(\d+(?:\.\d+)?)/.exec(v); return m ? Number(m[1]) : 0; };
  let touched = false;
  // Bare na Height/Thickness/Width = sukat ng DINGDING kapag KASUNOD ng "Double
  // walling" (2026-09-04); bago iyon, sukat ng produkto (Width/Length/Height ng
  // Product Management) - hindi ipinapasok sa double-walling na kahon.
  const wallIdx = L.findIndex((l) => /^double walling\s*:/i.test(l));
  let li = -1;
  for (const l of L) {
    li++;
    const afterWall = wallIdx >= 0 && li > wallIdx;
    const m = /^([^:]+):\s*(.+)$/.exec(l);
    const label = (m ? m[1] : "").trim().toLowerCase();
    const value = (m ? m[2] : l).trim();
    if (label === "size") { b.size = value; touched = true; continue; }
    if (label === "headboard" && /none/i.test(value)) { b.choices!["Headboard"] = "None Headboard"; touched = true; continue; }
    if (/^headboard height/.test(label)) { if (num(value) > 0) b.meas!["Headboard Height"] = num(value); touched = true; continue; }
    if (/^bedframe height|^base height/.test(label)) { if (num(value) > 0) b.meas!["Bedframe Height"] = num(value); touched = true; continue; }
    if (label === "drawers") {
      const [what, pos] = value.split(/\s*—\s*|\s+-\s+/);
      b.checks!.push(what.trim());
      if (pos) b.choices!["Drawer Position"] = pos.split(",")[0].trim();
      touched = true; continue;
    }
    if (label === "pullout bed") {
      const d = /(\d+)\s*[xX×]\s*(\d+)/.exec(value);
      b.checks!.push(d ? `Pullout ${d[1]}X${d[2]}` : "Pullout");
      touched = true; continue;
    }
    if (label === "lift storage" && /yes/i.test(value)) { b.checks!.push("Lift Storage"); touched = true; continue; }
    if (label === "legs") { b.choices!["Legs"] = value.replace(/\s*\(.*\)$/, "").trim(); touched = true; continue; }
    if (label === "mattress insert") { b.choices!["Mattress Insert"] = value; touched = true; continue; }
    if (label === "double walling") { b.checks!.push("Double Walling"); b.dw!.thick = num(value) || 8; touched = true; continue; }
    if (label === "height") { if (afterWall) b.dw!.h = String(num(value) || ""); continue; }
    if (label === "thickness") { if (afterWall) b.dw!.pad = String(num(value) || ""); continue; }
    if (label === "width") { if (afterWall) b.dw!.w = String(num(value) || ""); continue; }
    if (label === "decorative nails") { b.dw!.nails = value; continue; }
    if (label === "gold accent") { b.dw!.accent = /yes/i.test(value); continue; }
    if (/^tufted/i.test(l)) {
      b.checks!.push(/elevated/i.test(l) ? "Tufted Elevated Footboard" : "Tufted Footboard");
      const mt = /mattress thickness:\s*(\d+(?:\.\d+)?)/i.exec(l);
      if (mt) b.meas!["Mattress Thickness"] = Number(mt[1]);
      touched = true; continue;
    }
    if (label === "winged headboard") { b.choices!["Winged"] = /not/i.test(value) ? "Not winged" : "Winged"; touched = true; continue; }
    if (label === "exceed headboard") { b.choices!["Exceed Headboard"] = value; touched = true; continue; }
  }
  return touched ? b : null;
}

function Dot({ k }: { k: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-bold shrink-0"
      style={{ backgroundColor: GOLD }}
    >
      {k}
    </span>
  );
}

// Letra sa loob ng SVG at leader line papunta sa bahagi.
function Lbl({ x, y, t }: { x: number; y: number; t: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="7.5" fill="currentColor" />
      <text x={x} y={y + 3.2} textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">{t}</text>
    </g>
  );
}
function Leader({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="0.9" opacity="0.85" />
      <circle cx={x2} cy={y2} r="1.8" fill="currentColor" />
    </g>
  );
}
function DimV({ x, y1, y2 }: { x: number; y1: number; y2: number }) {
  return (<g><line x1={x} y1={y1} x2={x} y2={y2} /><path d={`M${x - 3} ${y1 + 5}l3-5 3 5M${x - 3} ${y2 - 5}l3 5 3-5`} /></g>);
}
function DimH({ y, x1, x2 }: { y: number; x1: number; x2: number }) {
  return (<g><line x1={x1} y1={y} x2={x2} y2={y} /><path d={`M${x1 + 5} ${y - 3}l-5 3 5 3M${x2 - 5} ${y - 3}l5 3-5 3`} /></g>);
}

// Maliit na drawing kada add-on para sa "Add-ons on this build" tiles.
const TILE_ART: Record<string, JSX.Element> = {
  F: (<><rect x="14" y="22" width="92" height="30" /><rect x="20" y="28" width="38" height="18" rx="1" /><rect x="62" y="28" width="38" height="18" rx="1" /><line x1="35" y1="37" x2="43" y2="37" /><line x1="77" y1="37" x2="85" y2="37" /></>),
  G: (<><rect x="30" y="18" width="80" height="22" /><rect x="10" y="44" width="80" height="14" strokeDasharray="3 2" /><path d="M2 51 l4-3 M2 51 l4 3 M2 51 l8 0" /></>),
  H: (<><rect x="18" y="14" width="84" height="42" strokeWidth="5" opacity="0.45" /><rect x="26" y="22" width="68" height="26" /></>),
  I: (<><rect x="12" y="40" width="84" height="14" /><rect x="96" y="18" width="12" height="36" rx="2" /><rect x="18" y="30" width="74" height="10" rx="3" strokeDasharray="2 2" /></>),
  J: (<><rect x="34" y="16" width="52" height="42" rx="2" /><path d="M34 16 l-16 8 v34 l16 -8" /><path d="M86 16 l16 8 v34 l-16 -8" /></>),
  K: (<><rect x="44" y="14" width="14" height="44" /><rect x="58" y="38" width="50" height="14" /><line x1="30" y1="38" x2="118" y2="38" strokeDasharray="2 2" /><g strokeWidth="1"><line x1="26" y1="14" x2="26" y2="38" /><path d="M23 19l3-5 3 5M23 33l3 5 3-5" /></g></>),
  L: (<><rect x="14" y="26" width="92" height="30" /><rect x="22" y="18" width="76" height="20" rx="4" strokeDasharray="3 2" /><g strokeWidth="1"><line x1="112" y1="26" x2="112" y2="38" /><path d="M109 31l3-5 3 5M109 33l3 5 3-5" /></g></>),
  M: (<><rect x="14" y="30" width="92" height="24" /><path d="M24 30 l0-10 l80 0" strokeDasharray="3 2" /><path d="M60 12 l0 12" /><path d="M56 16 l4-4 4 4" /></>),
};

function Tile({ row }: { row: BuildRow }) {
  return (
    <div className="rounded-lg border border-sand bg-linen px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-bold text-ink mb-2"><Dot k={row.k} />{row.label}</div>
      <svg viewBox="0 0 120 70" className="w-full" style={{ color: GOLD }} aria-hidden>
        <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">{TILE_ART[row.k]}</g>
      </svg>
      <div className="text-xs text-stone mt-1.5">{row.value}</div>
    </div>
  );
}

export default function FrameDiagram({
  sizes = DEFAULT_BED_SIZES,
  focus,
  onFocus,
  hideChips = false,
  addOns = [],
  build = null,
}: {
  sizes?: BedSize[];
  focus?: string | null;
  onFocus?: (size: string | null) => void;
  hideChips?: boolean;
  addOns?: FrameAddOn[]; // pinapanatili para sa mga tumatawag; wala nang sariling hanay
  build?: BedBuild | null;
}) {
  void addOns;
  const [internal, setInternal] = useState<string | null>(sizes[0]?.size ?? null);
  const current = onFocus ? (focus ?? null) : internal;
  const setCurrent = onFocus ?? setInternal;
  const shown = current ? sizes.filter((s) => s.size === current) : sizes;

  const rows = bedBuildRows(build);
  const on = (k: string) => rows.some((r) => r.k === k);
  const val = (k: string) => rows.find((r) => r.k === k)?.value ?? "";
  const choice = (re: RegExp) => {
    const k = Object.keys(build?.choices ?? {}).find((g) => re.test(g));
    return k ? (build?.choices?.[k] ?? "") : "";
  };
  const { noHead, platform, floating, wallPad } = bedFlags(build);
  const wallOff = 5 + Math.min(wallPad * 2, 10); // kapal ng dingding → lapad ng dashed outline
  const drawerPos = choice(/drawer position|footboard drawer/i);
  const footHigh = on("I") && /mattress|elevated/i.test(val("I") + " " + (rows.find((r) => r.k === "I")?.label ?? ""));

  // Geometry (side elevation): sahig y=196 · headboard x96–114, y40–156 · base x114–444, y132–156 · footboard x444–460
  const frame = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinejoin: "round" as const };
  const add = { fill: "none", stroke: "currentColor", strokeWidth: 1, strokeDasharray: "4 2.5", opacity: 0.95 };
  const thin = { fill: "none", stroke: "currentColor", strokeWidth: 1 };

  return (
    <div className="bg-white rounded-lg p-6">
      <h3 className="text-sm font-bold tracking-widest2 mb-6 flex items-center gap-2" style={{ color: GOLD }}>
        FRAME DIMENSIONS
        <span className="flex-1 border-t border-dotted" style={{ borderColor: GOLD }} />
      </h3>

      {/* Buong lapad ang drawing — ang listahan ng letra ay nasa kaliwang
          column na ng tab, kaya walang legend dito (redundant). */}
      <div className="mb-6">

        <svg viewBox="0 0 560 236" className="w-full" style={{ color: GOLD }} aria-label="Bed frame side view with dimensions">
          <defs>
            <pattern id="fd-tuft" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="4" cy="4" r="0.9" fill="currentColor" opacity="0.6" />
            </pattern>
          </defs>
          <line x1="30" y1="196" x2="540" y2="196" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />

          {/* FRAME */}
          <g {...frame}>
            {!noHead && <rect x="96" y="40" width="18" height="116" fill="url(#fd-tuft)" />}
            {platform ? (
              <rect x="114" y="132" width="330" height="64" />
            ) : (
              <>
                <rect x="114" y="132" width="330" height="24" />
                <line x1="126" y1="156" x2="126" y2={floating ? 172 : 196} />
                <line x1="432" y1="156" x2="432" y2={floating ? 172 : 196} />
                {floating && <line x1="140" y1="196" x2="418" y2="196" strokeWidth="3" opacity="0.25" />}
              </>
            )}
            {on("I") && <rect x="444" y={footHigh ? 84 : 104} width="16" height={footHigh ? 72 : 52} fill="url(#fd-tuft)" />}
          </g>

          {/* ADD-ON LAYERS — manipis at dashed */}
          <g {...add}>
            {on("H") && <rect x={114 - wallOff} y={132 - wallOff} width={330 + 2 * wallOff} height={24 + 2 * wallOff} rx="1" />}
            {on("L") && <rect x="122" y="121" width="314" height="15" rx="4" />}
            {on("J") && !noHead && <path d="M96 58 l-9 5 v88 l9 -5" />}
            {on("G") && <rect x="66" y="178" width="246" height="12" />}
            {on("K") && !noHead && <line x1="84" y1="27" x2="134" y2="27" />}
            {on("M") && <path d="M124 132 l0 -12 l310 0" />}
          </g>
          {on("H") && build?.dw?.nails?.trim() && (
            <g fill="currentColor" stroke="none">
              {[140, 170, 200, 230, 260, 290, 320, 350, 380, 410].map((x) => <circle key={x} cx={x} cy={132 - wallOff + 3} r="1.1" />)}
            </g>
          )}
          <g {...thin}>
            {on("F") && (/footboard/i.test(drawerPos) ? (
              <rect x="446" y="136" width="12" height="16" rx="1" />
            ) : /^right$/i.test(drawerPos) ? (
              <g strokeDasharray="3 2" opacity="0.7"><rect x="140" y="136" width="118" height="16" rx="1" /><rect x="270" y="136" width="118" height="16" rx="1" /></g>
            ) : (
              <>
                <rect x="140" y="136" width="118" height="16" rx="1" />
                {/^2/.test(val("F")) && <rect x="270" y="136" width="118" height="16" rx="1" />}
                <line x1="192" y1="144" x2="206" y2="144" />
                {/^2/.test(val("F")) && <line x1="322" y1="144" x2="336" y2="144" />}
              </>
            ))}
            {on("G") && <path d="M56 184 l10 0 M56 184 l5 -4 M56 184 l5 4" />}
            {on("M") && <path d="M279 120 l0 -12 M275 112 l4 -4 4 4" />}
          </g>

          {/* SUKAT */}
          <g {...thin}>
            {!noHead && <DimV x={46} y1={40} y2={156} />}
            <DimH y={214} x1={114} x2={444} />
            <DimV x={486} y1={132} y2={platform ? 196 : 156} />
            {!platform && <DimV x={486} y1={160} y2={196} />}
            {on("I") && <DimV x={514} y1={footHigh ? 84 : 104} y2={132} />}
            {on("K") && !noHead && <DimV x={70} y1={27} y2={40} />}
            {on("H") && <DimV x={464} y1={132 - wallOff} y2={132} />}
          </g>

          {/* LEADERS */}
          {on("F") && !/right|footboard/i.test(drawerPos) && <Leader x1={330} y1={165} x2={329} y2={153} />}
          {on("F") && /footboard/i.test(drawerPos) && <Leader x1={470} y1={172} x2={458} y2={152} />}
          {on("H") && <Leader x1={464} y1={170} x2={452} y2={161} />}
          {on("J") && !noHead && <Leader x1={74} y1={143} x2={89} y2={140} />}
          {on("L") && <Leader x1={220} y1={101} x2={220} y2={121} />}
          {on("G") && <Leader x1={52} y1={176} x2={66} y2={184} />}
          {on("M") && <Leader x1={300} y1={100} x2={283} y2={112} />}

          {/* LETRA */}
          {!noHead && <Lbl x={32} y={98} t="B" />}
          <Lbl x={279} y={222} t="C" />
          <Lbl x={500} y={platform ? 164 : 144} t="D" />
          {!platform && <Lbl x={500} y={178} t="E" />}
          {on("F") && <Lbl x={/footboard/i.test(drawerPos) ? 470 : 330} y={/footboard/i.test(drawerPos) ? 180 : 172} t="F" />}
          {on("G") && <Lbl x={44} y={170} t="G" />}
          {on("H") && <Lbl x={464} y={178} t="H" />}
          {on("I") && <Lbl x={528} y={108} t="I" />}
          {on("J") && !noHead && <Lbl x={66} y={143} t="J" />}
          {on("K") && !noHead && <Lbl x={56} y={33} t="K" />}
          {on("L") && <Lbl x={220} y={94} t="L" />}
          {on("M") && <Lbl x={310} y={96} t="M" />}
          <Lbl x={150} y={56} t="A" />
          <text x="162" y="59" fontSize="8" fontWeight="600" fill="currentColor" opacity="0.8" fontFamily="system-ui, sans-serif">width — into the page (see table)</text>
        </svg>
      </div>

      {!hideChips && (
        <div className="flex flex-wrap gap-2 mb-4">
          {sizes.map((s) => (
            <button
              key={s.size}
              onClick={() => setCurrent(s.size)}
              className={`px-3 py-1.5 text-xs font-bold rounded border transition-colors ${
                current === s.size ? "text-white border-transparent" : "text-stone border-stone/40 hover:border-ink"
              }`}
              style={current === s.size ? { backgroundColor: GOLD } : {}}
            >
              {s.size}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[440px]">
          <thead>
            <tr style={{ backgroundColor: GOLD }} className="text-white text-left">
              <th className="py-2 px-3 font-medium">Bed</th>
              <th className="py-2 px-3 font-medium">Size</th>
              {["A", "B", "C", "D", "E"].filter((k) => !(k === "E" && platform) && !(k === "B" && noHead)).map((k) => <th key={k} className="py-2 px-3 font-medium">{k}</th>)}
              {rows.map((r) => <th key={r.k} className="py-2 px-3 font-medium whitespace-nowrap">{r.k} {r.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-sand">
            {shown.map((s) => (
              <tr key={s.size} className="bg-linen">
                <td className="py-2.5 px-3 font-bold text-ink">{s.size}</td>
                <td className="py-2.5 px-3 text-stone">{s.dim}</td>
                <td className="py-2.5 px-3 text-stone">{s.A}</td>
                {!noHead && <td className="py-2.5 px-3 text-stone">{s.B}</td>}
                <td className="py-2.5 px-3 text-stone">{s.C}</td>
                <td className="py-2.5 px-3 text-stone">{s.D}</td>
                {!platform && <td className="py-2.5 px-3 text-stone">{floating ? "Floating" : s.E}</td>}
                {rows.map((r) => <td key={r.k} className="py-2.5 px-3 text-stone whitespace-nowrap">{r.value}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <div className="mt-5">
          <p className="text-[10px] font-bold tracking-widest2 mb-2" style={{ color: GOLD }}>ADD-ONS ON THIS BUILD</p>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => <Tile key={r.k} row={r} />)}
          </div>
        </div>
      )}
    </div>
  );
}
