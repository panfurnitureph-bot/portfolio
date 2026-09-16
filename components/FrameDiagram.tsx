"use client";

// FRAME DIMENSIONS — malinis na line-art diagram ng bed (headboard +
// base + legs) na may A/B/C/D/E labels + size table. Pag pinili ang
// isang size (Single/Twin/.../King 2), ang row nitong lang ang naka-
// highlight; pwede ring i-filter para isa lang ang ipakita.

import { useState } from "react";

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

// Ang A at B ay para sa upholstered panel add-on (Wall Padding o
// Headboard) — dynamic ang label depende sa aktwal na add-on ng product.
function buildLegend(_panelLabel: string) {
  return [
    { k: "A", label: "Width" },
    { k: "B", label: "Headboard Height" },
    { k: "C", label: "Length" },
    { k: "D", label: "Base" },
    { k: "E", label: "Legs" },
  ];
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

export type FrameAddOn = {
  id: string;
  label: string;
  detail?: string;
  price: number;
};

export default function FrameDiagram({
  sizes = DEFAULT_BED_SIZES,
  focus,
  onFocus,
  hideChips = false,
  addOns = [],
}: {
  sizes?: BedSize[];
  focus?: string | null; // controlled: aling size ang naka-focus
  onFocus?: (size: string | null) => void; // callback pag pinili
  hideChips?: boolean; // itago ang chips kung may selector na sa taas
  addOns?: FrameAddOn[]; // hal. wall padding — sariling row sa table
}) {
  // Kung hindi controlled (walang onFocus), gumamit ng sariling state
  const [internal, setInternal] = useState<string | null>(sizes[0]?.size ?? null);
  const current = onFocus ? (focus ?? null) : internal;
  const setCurrent = onFocus ?? setInternal;
  const shown = current ? sizes.filter((s) => s.size === current) : sizes;

  // Dynamic na legend: kunin ang pangalan ng upholstered panel add-on
  // (Wall Padding / Headboard). Kung marami, pagsamahin; kung wala,
  // "upholstered panel" ang generic na label.
  const panelAddOns = addOns.filter((a) => a.price > 0);
  const panelLabel =
    panelAddOns.length > 0
      ? panelAddOns.map((a) => a.label.toLowerCase()).join(" / ")
      : "upholstered panel";
  const LEGEND = buildLegend(panelLabel);

  return (
    <div className="bg-white rounded-lg p-6">
      <h3 className="text-sm font-bold tracking-widest2 mb-6 flex items-center gap-2" style={{ color: GOLD }}>
        FRAME DIMENSIONS
        <span className="flex-1 border-t border-dotted" style={{ borderColor: GOLD }} />
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-6 items-center mb-6">
        {/* Legend */}
        <ul className="space-y-2.5">
          {LEGEND.map((l) => (
            <li key={l.k} className="flex items-center gap-2.5 text-sm text-stone">
              <Dot k={l.k} />
              {l.label}
            </li>
          ))}
        </ul>

        {/* Malinis na line-art ng bed (3/4 view) — kagaya ng poster */}
        <svg viewBox="0 0 360 270" className="w-full" style={{ color: GOLD }}>
          <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
            {/* Headboard — rounded rectangle sa kanan-likod */}
            <path d="M215 45 q0 -8 8 -8 h95 q8 0 8 8 v100 l-111 12 z" />
            {/* Base — perspective na kahon (top + front + side) */}
            <path d="M45 158 L215 128 L326 150 L326 205 L150 240 L45 210 Z" />
            {/* top edge ng base (mattress platform) */}
            <path d="M45 158 L150 185 L326 150" opacity="0.85" />
            <path d="M150 185 L150 240" opacity="0.85" />
            {/* Legs — 4 na maikling guhit */}
            <g strokeWidth="3">
              <path d="M52 208 v11" />
              <path d="M150 240 v11" />
              <path d="M320 203 v11" />
              <path d="M215 178 v9" />
            </g>
          </g>

          {/* Measurement arrows + labels A-E */}
          <g stroke="currentColor" strokeWidth="1.2" fill="currentColor" fontSize="13" fontFamily="serif">
            {/* A — Width (taas ng headboard) */}
            <line x1="223" y1="25" x2="326" y2="25" />
            <path d="M223 25 l7 -3 v6z M326 25 l-7 -3 v6z" />
            <text x="270" y="20">A</text>
            {/* B — Headboard height (kanan) */}
            <line x1="340" y1="45" x2="340" y2="157" />
            <path d="M340 45 l-3 7 h6z M340 157 l-3 -7 h6z" />
            <text x="345" y="105">B</text>
            {/* C — Length (baba-kanan, pahilis) */}
            <line x1="158" y1="252" x2="330" y2="217" />
            <path d="M158 252 l6 0 l-2 -6z M330 217 l-6 1 l2 6z" />
            <text x="250" y="262">C</text>
            {/* D — Base height (kaliwa) */}
            <line x1="30" y1="160" x2="30" y2="200" />
            <path d="M30 160 l-3 7 h6z M30 200 l-3 -7 h6z" />
            <text x="18" y="184">D</text>
            {/* E — Legs (kaliwa-baba) */}
            <line x1="30" y1="208" x2="30" y2="220" />
            <path d="M30 208 l-3 6 h6z M30 220 l-3 -6 h6z" />
            <text x="18" y="217">E</text>
          </g>
        </svg>
      </div>

      {/* Size selector chips — itinatago kung may selector na sa taas
          ng product info (para isa lang ang controller) */}
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

      {/* Size table — filtered/highlighted ayon sa pinili */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[440px]">
          <thead>
            {/* Walang A (width) at B (headboard height) — ang headboard ay
                ang WALL PADDING (hiwalay na add-on), nasa sariling table */}
            <tr style={{ backgroundColor: GOLD }} className="text-white text-left">
              <th className="py-2 px-3 font-medium">Bed</th>
              <th className="py-2 px-3 font-medium">Size</th>
              <th className="py-2 px-3 font-medium">A</th>
              <th className="py-2 px-3 font-medium">B</th>
              <th className="py-2 px-3 font-medium">C</th>
              <th className="py-2 px-3 font-medium">D</th>
              <th className="py-2 px-3 font-medium">E</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand">
            {shown.map((s) => (
              <tr key={s.size} className="bg-linen">
                <td className="py-2.5 px-3 font-bold text-ink">{s.size}</td>
                <td className="py-2.5 px-3 text-stone">{s.dim}</td>
                <td className="py-2.5 px-3 text-stone">{s.A}</td>
                <td className="py-2.5 px-3 text-stone">{s.B}</td>
                <td className="py-2.5 px-3 text-stone">{s.C}</td>
                <td className="py-2.5 px-3 text-stone">{s.D}</td>
                <td className="py-2.5 px-3 text-stone">{s.E}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
