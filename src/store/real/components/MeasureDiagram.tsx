"use client";

// DIMENSIONS — line drawing na may letrang sukat (A, B, C…) para sa bawat
// category na puwedeng i-customize: sofa/sofa bed, dining chair, accent chair,
// barstool, ottoman, side table, wall padding, dining table, swivel chair.
// Kapatid ito ng FrameDiagram (kama). Ang mga letra ay sumusunod sa
// MEASUREMENTS ng IMS Configurator (CATEGORY_MEASUREMENTS) — kapag binago ng
// customer ang isang sukat sa customizer (pb-measure-change), ang halaga sa
// legend/table ay agad sumusunod. Walang config = built-in defaults.

import type { MtoMeasure } from "@/lib/content";

const GOLD = "#8a7b2e";

export type MeasureKind =
  | "sofa" | "dining-chair" | "accent-chair" | "barstool" | "ottoman"
  | "side-table" | "wall-padding" | "dining-table" | "swivel-chair" | "decor";

export type MeasureRow = { k: string; label: string; value: string };

type Spec = { title: string; subject: string; labels: { label: string; def: number; unit?: string }[] };

// Ang pagkakasunod ng labels = letra A, B, C… — pareho ng IMS Configurator.
const SPECS: Record<MeasureKind, Spec> = {
  sofa: { title: "Sofa", subject: "Sofa", labels: [
    { label: "Total Height", def: 34 }, { label: "Armrest Height", def: 24 }, { label: "Armrest Thickness", def: 6 },
    { label: "Backrest Thickness", def: 5 }, { label: "Seat depth", def: 22 }, { label: "Legs", def: 4 },
  ] },
  "dining-chair": { title: "Dining Chair", subject: "Chair", labels: [
    { label: "Total Height", def: 36 }, { label: "Seat Height", def: 18 }, { label: "Seat Depth / Diameter", def: 17 }, { label: "Back Cushion Thickness", def: 3 },
  ] },
  "accent-chair": { title: "Accent Chair", subject: "Chair", labels: [
    { label: "Height", def: 30 }, { label: "Backrest Thickness", def: 5 }, { label: "Backrest to Seat", def: 20 }, { label: "Seat Height", def: 17 },
  ] },
  barstool: { title: "Barstool", subject: "Stool", labels: [
    { label: "Bar Counter Height", def: 34.5 }, { label: "End to End", def: 45, unit: "cm" }, { label: "Total Height", def: 34 }, { label: "Backrest to Seat", def: 55, unit: "cm" },
  ] },
  ottoman: { title: "Ottoman", subject: "Ottoman", labels: [{ label: "Total Height", def: 16 }, { label: "Seat depth", def: 18 }] },
  "side-table": { title: "Side Table", subject: "Table", labels: [{ label: "Height", def: 20 }, { label: "Depth", def: 16 }] },
  "wall-padding": { title: "Wall Padding", subject: "Panel", labels: [{ label: "Height", def: 96 }, { label: "Width", def: 120 }] },
  "dining-table": { title: "Dining Table", subject: "Table", labels: [{ label: "Length", def: 72 }, { label: "Width", def: 36 }, { label: "Height", def: 30 }] },
  "swivel-chair": { title: "Swivel Chair", subject: "Chair", labels: [
    { label: "Total Height", def: 38 }, { label: "Seat Height", def: 18 }, { label: "Seat Width", def: 20 }, { label: "Base Diameter", def: 26 },
  ] },
  // DECOR (IMS 2026-09-12): figurines, mugs, lamp, vase — kahon lang na may
  // taas / haba / lapad; ang totoong sukat ay mula sa Configurator ng IMS.
  decor: { title: "Decor", subject: "Piece", labels: [{ label: "Height", def: 12 }, { label: "Length", def: 8 }, { label: "Width", def: 8 }] },
};

// Website category slug → drawing. Regex para hindi masira kapag may
// bahagyang iba ang slug (hal. "dining-chairs", "ottoman-ph", "bar-stool").
export function measureKind(category: string): MeasureKind | null {
  const c = (category || "").toLowerCase();
  if (/figurine|mug|lamp|vase/.test(c)) return "decor";
  if (/swivel/.test(c)) return "swivel-chair";
  if (/bar.?stool|stool/.test(c)) return "barstool";
  if (/wall/.test(c)) return "wall-padding";
  if (/dining.?table/.test(c)) return "dining-table";
  if (/dining.?chair|dining-set/.test(c)) return "dining-chair";
  if (/accent/.test(c)) return "accent-chair";
  if (/ottoman/.test(c)) return "ottoman";
  if (/side.?table|end.?table/.test(c)) return "side-table";
  if (/sofa/.test(c)) return "sofa";
  return null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
const fmt = (n: number, unit?: string) => (unit && unit !== "in" ? `${n} ${unit}` : `${n}"`);

// Mga hanay ng sukat: live mula sa customizer → default ng Configurator →
// built-in. Ang mga dagdag na measurement sa Configurator na wala sa drawing ay
// isinasama sa dulo (may letra sa table, wala sa drawing).
export function measureRows(kind: MeasureKind, live?: Record<string, number> | null, mto?: MtoMeasure[] | null): { rows: MeasureRow[]; live: boolean } {
  const spec = SPECS[kind];
  const on = (mto ?? []).filter((m) => m.on && m.label.trim());
  const liveOf = (label: string) => {
    const k = Object.keys(live ?? {}).find((x) => norm(x) === norm(label));
    const n = k ? live![k] : 0;
    return n > 0 ? n : undefined;
  };
  let isLive = false;
  const rows: MeasureRow[] = spec.labels.map((l, i) => {
    const m = on.find((x) => norm(x.label) === norm(l.label));
    const lv = liveOf(l.label);
    if (lv !== undefined) isLive = true;
    const n = lv ?? (m?.def ?? l.def);
    return { k: String.fromCharCode(65 + i), label: m?.label ?? l.label, value: fmt(n, m?.unit ?? l.unit) };
  });
  let i = spec.labels.length;
  for (const m of on) {
    if (spec.labels.some((l) => norm(l.label) === norm(m.label))) continue;
    const lv = liveOf(m.label);
    if (lv !== undefined) isLive = true;
    const n = lv ?? m.def ?? 0;
    rows.push({ k: String.fromCharCode(65 + i++), label: m.label, value: n > 0 ? fmt(n, m.unit) : "—" });
  }
  return { rows, live: isLive };
}

function Lbl({ x, y, t }: { x: number; y: number; t: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="7" fill="currentColor" />
      <text x={x} y={y + 3} textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">{t}</text>
    </g>
  );
}
function DimV({ x, y1, y2 }: { x: number; y1: number; y2: number }) {
  return (<g><line x1={x} y1={y1} x2={x} y2={y2} /><path d={`M${x - 3} ${y1 + 5}l3-5 3 5M${x - 3} ${y2 - 5}l3 5 3-5`} /></g>);
}
function DimH({ y, x1, x2 }: { y: number; x1: number; x2: number }) {
  return (<g><line x1={x1} y1={y} x2={x2} y2={y} /><path d={`M${x1 + 5} ${y - 3}l-5 3 5 3M${x2 - 5} ${y - 3}l5 3-5 3`} /></g>);
}

const O = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
const D = { fill: "none", stroke: "currentColor", strokeWidth: 1 };
const FLOOR = { strokeDasharray: "2 3" };

function Drawing({ kind }: { kind: MeasureKind }) {
  switch (kind) {
    case "sofa":
      return (
        <>
          <g {...O}>
            <rect x="62" y="42" width="26" height="112" rx="4" /><rect x="88" y="118" width="150" height="26" rx="5" />
            <rect x="88" y="144" width="150" height="22" /><rect x="238" y="92" width="22" height="74" rx="4" />
            <line x1="72" y1="166" x2="72" y2="182" /><line x1="250" y1="166" x2="250" y2="182" />
            <line x1="96" y1="166" x2="96" y2="182" /><line x1="232" y1="166" x2="232" y2="182" />
            <line x1="40" y1="182" x2="290" y2="182" {...FLOOR} />
          </g>
          <g {...D}>
            <DimV x={300} y1={42} y2={182} /><DimV x={276} y1={92} y2={182} /><DimH y={80} x1={238} x2={260} />
            <DimH y={30} x1={62} x2={88} /><DimH y={108} x1={88} x2={238} /><DimV x={30} y1={166} y2={182} />
          </g>
          <Lbl x={312} y={112} t="A" /><Lbl x={288} y={137} t="B" /><Lbl x={249} y={68} t="C" />
          <Lbl x={75} y={18} t="D" /><Lbl x={163} y={96} t="E" /><Lbl x={18} y={174} t="F" />
        </>
      );
    case "dining-chair":
      return (
        <>
          <g {...O}>
            <rect x="118" y="28" width="18" height="100" rx="3" /><rect x="136" y="118" width="84" height="14" rx="3" />
            <line x1="124" y1="132" x2="124" y2="186" /><line x1="212" y1="132" x2="212" y2="186" />
            <line x1="136" y1="160" x2="212" y2="160" {...FLOOR} /><line x1="90" y1="186" x2="250" y2="186" {...FLOOR} />
          </g>
          <g {...D}>
            <DimV x={262} y1={28} y2={186} /><DimV x={240} y1={118} y2={186} /><DimH y={106} x1={136} x2={220} /><DimH y={16} x1={118} x2={136} />
          </g>
          <Lbl x={276} y={107} t="A" /><Lbl x={228} y={152} t="B" /><Lbl x={178} y={94} t="C" /><Lbl x={100} y={16} t="D" />
        </>
      );
    case "accent-chair":
      return (
        <>
          <g {...O}>
            <path d="M110 40 q-4 0 -4 4 v90 h22 v-94 z" /><rect x="128" y="118" width="96" height="22" rx="6" />
            <rect x="128" y="140" width="96" height="16" /><rect x="212" y="96" width="20" height="60" rx="5" />
            <line x1="118" y1="156" x2="118" y2="178" /><line x1="226" y1="156" x2="226" y2="178" />
            <line x1="84" y1="178" x2="260" y2="178" {...FLOOR} />
          </g>
          <g {...D}>
            <DimV x={272} y1={40} y2={178} /><DimH y={28} x1={106} x2={128} /><DimV x={92} y1={44} y2={118} /><DimV x={248} y1={118} y2={178} />
          </g>
          <Lbl x={286} y={108} t="A" /><Lbl x={96} y={16} t="B" /><Lbl x={76} y={81} t="C" /><Lbl x={260} y={148} t="D" />
        </>
      );
    case "barstool":
      return (
        <>
          <g {...O}>
            <rect x="140" y="44" width="14" height="52" rx="3" /><rect x="128" y="96" width="72" height="12" rx="4" />
            <line x1="136" y1="108" x2="128" y2="186" /><line x1="192" y1="108" x2="200" y2="186" /><line x1="132" y1="150" x2="196" y2="150" />
            <line x1="96" y1="186" x2="240" y2="186" {...FLOOR} />
            <rect x="40" y="70" width="52" height="116" strokeDasharray="3 3" />
          </g>
          <g {...D}>
            <DimV x={26} y1={70} y2={186} /><DimH y={124} x1={128} x2={200} /><DimV x={252} y1={44} y2={186} /><DimV x={224} y1={44} y2={96} />
          </g>
          <Lbl x={14} y={128} t="A" /><Lbl x={164} y={137} t="B" /><Lbl x={266} y={115} t="C" /><Lbl x={236} y={70} t="D" />
          <text x="66" y="62" textAnchor="middle" fontSize="8" fontWeight="600" fill="currentColor" opacity="0.8" fontFamily="system-ui, sans-serif">counter</text>
        </>
      );
    case "ottoman":
      return (
        <>
          <g {...O}>
            <rect x="96" y="96" width="148" height="34" rx="8" /><rect x="100" y="130" width="140" height="28" />
            <line x1="110" y1="158" x2="110" y2="176" /><line x1="230" y1="158" x2="230" y2="176" />
            <line x1="70" y1="176" x2="270" y2="176" {...FLOOR} />
          </g>
          <g {...D}><DimV x={280} y1={96} y2={176} /><DimH y={84} x1={96} x2={244} /></g>
          <Lbl x={294} y={136} t="A" /><Lbl x={170} y={72} t="B" />
        </>
      );
    case "side-table":
      return (
        <>
          <g {...O}>
            <rect x="104" y="72" width="132" height="10" rx="2" /><line x1="112" y1="82" x2="112" y2="178" /><line x1="228" y1="82" x2="228" y2="178" />
            <line x1="112" y1="140" x2="228" y2="140" /><line x1="80" y1="178" x2="260" y2="178" {...FLOOR} />
          </g>
          <g {...D}><DimV x={272} y1={72} y2={178} /><DimH y={58} x1={104} x2={236} /></g>
          <Lbl x={286} y={125} t="A" /><Lbl x={170} y={46} t="B" />
        </>
      );
    case "decor":
      return (
        <>
          <g {...O}>
            <rect x="110" y="70" width="110" height="110" rx="4" />
            <polygon points="110,70 140,46 250,46 220,70" /><polygon points="220,70 250,46 250,156 220,180" />
            <line x1="80" y1="180" x2="270" y2="180" {...FLOOR} />
          </g>
          <g {...D}><DimV x={284} y1={46} y2={156} /><DimH y={196} x1={110} x2={220} /><line x1="232" y1="184" x2="262" y2="160" /></g>
          <Lbl x={298} y={104} t="A" /><Lbl x={165} y={212} t="B" /><Lbl x={262} y={186} t="C" />
        </>
      );
    case "wall-padding":
      return (
        <>
          <g {...O}>
            <rect x="70" y="40" width="200" height="140" rx="6" />
            <line x1="110" y1="40" x2="110" y2="180" /><line x1="150" y1="40" x2="150" y2="180" /><line x1="190" y1="40" x2="190" y2="180" /><line x1="230" y1="40" x2="230" y2="180" />
            <line x1="70" y1="110" x2="270" y2="110" {...FLOOR} />
          </g>
          <g {...D}><DimV x={292} y1={40} y2={180} /><DimH y={26} x1={70} x2={270} /></g>
          <Lbl x={306} y={110} t="A" /><Lbl x={170} y={14} t="B" />
        </>
      );
    case "dining-table":
      return (
        <>
          <g {...O}>
            <path d="M70 96 l40-22 h160 l-40 22 z" /><rect x="70" y="96" width="160" height="10" />
            <line x1="78" y1="106" x2="78" y2="176" /><line x1="222" y1="106" x2="222" y2="176" /><line x1="262" y1="84" x2="262" y2="150" />
            <line x1="118" y1="84" x2="118" y2="92" strokeDasharray="2 2" /><line x1="50" y1="176" x2="250" y2="176" {...FLOOR} />
          </g>
          <g {...D}>
            <DimH y={124} x1={70} x2={230} />
            <line x1="240" y1="96" x2="280" y2="74" /><path d="M242 91l-2 5 5 0M278 79l2-5-5 0" />
            <DimV x={296} y1={106} y2={176} />
          </g>
          <Lbl x={150} y={138} t="A" /><Lbl x={270} y={60} t="B" /><Lbl x={310} y={141} t="C" />
        </>
      );
    case "swivel-chair":
      return (
        <>
          <g {...O}>
            <rect x="126" y="36" width="20" height="76" rx="4" /><rect x="140" y="106" width="76" height="16" rx="5" />
            <line x1="178" y1="122" x2="178" y2="160" /><path d="M178 160 l-46 16 M178 160 l46 16 M178 160 l-20 20 M178 160 l20 20" />
            <ellipse cx="178" cy="180" rx="52" ry="7" /><line x1="110" y1="190" x2="250" y2="190" {...FLOOR} />
          </g>
          <g {...D}>
            <DimV x={270} y1={36} y2={190} /><DimV x={246} y1={106} y2={190} /><DimH y={94} x1={140} x2={216} /><DimH y={200} x1={126} x2={230} />
          </g>
          <Lbl x={284} y={113} t="A" /><Lbl x={234} y={150} t="B" /><Lbl x={178} y={82} t="C" /><Lbl x={112} y={200} t="D" />
        </>
      );
  }
}

export default function MeasureDiagram({ kind, rows, live = false }: { kind: MeasureKind; rows: MeasureRow[]; live?: boolean }) {
  const spec = SPECS[kind];
  return (
    <div className="bg-white rounded-lg p-6">
      <h3 className="text-sm font-bold tracking-widest2 mb-6 flex items-center gap-2" style={{ color: GOLD }}>
        {spec.title.toUpperCase()} DIMENSIONS
        <span className="flex-1 border-t border-dotted" style={{ borderColor: GOLD }} />
      </h3>

      {/* Buong lapad ang drawing — ang listahan ng letra ay nasa kaliwang
          column na ng tab, kaya walang legend dito (redundant). */}
      <div className="mb-6">
        <svg viewBox="0 0 340 210" className="w-full" style={{ color: GOLD }} aria-label={`${spec.title} dimensions`}>
          <Drawing kind={kind} />
        </svg>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[320px]">
          <thead>
            <tr style={{ backgroundColor: GOLD }} className="text-white text-left">
              <th className="py-2 px-3 font-medium">{spec.subject}</th>
              {rows.map((r) => <th key={r.k} className="py-2 px-3 font-medium">{r.k}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-linen">
              <td className="py-2.5 px-3 font-bold text-ink">{live ? "As configured" : "Standard"}</td>
              {rows.map((r) => <td key={r.k} className="py-2.5 px-3 text-stone whitespace-nowrap">{r.value}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
