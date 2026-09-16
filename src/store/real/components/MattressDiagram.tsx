"use client";

// MATTRESS DIMENSIONS — isometric na slab na may T (kapal), W (lapad), L (haba)
// at size table. Kapatid ng FrameDiagram/MeasureDiagram: puting card, gold na
// guhit, buong lapad na drawing, walang legend sa loob (nasa kaliwang column
// ng tab ang listahan). Ang size ay W×L mula sa Configurator ("Single 36X75");
// ang T ay mula sa `thickness` prop (live na Thickness measurement ng
// customizer, o default ng Configurator) — o mula sa 3-bahaging dim
// ("8x36x75") ng lumang products.json.

const GOLD = "#8a7b2e";

export type MattressSize = {
  size: string;
  dim: string; // '36x75' o '8 x 36 x 75"'
  price?: number;
  enabled?: boolean;
};

// "8x36x75" → T/W/L; "36x75" → W/L (walang T). Null kapag hindi mabasa.
export function splitDim(dim: string): { thickness: string; width: string; length: string } | null {
  const parts = (dim || "")
    .replace(/["″]/g, "")
    .split(/\s*[x×]\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 3) return { thickness: parts[0], width: parts[1], length: parts[2] };
  if (parts.length === 2) return { thickness: "", width: parts[0], length: parts[1] };
  return null;
}

function Lbl({ x, y, t }: { x: number; y: number; t: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="9" fill="currentColor" />
      <text x={x} y={y + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">{t}</text>
    </g>
  );
}

export default function MattressDiagram({
  sizes,
  focus,
  onFocus,
  thickness,
}: {
  sizes: MattressSize[];
  focus?: string | null;
  onFocus?: (size: string) => void;
  thickness?: string; // hal. '8"' — live/default na kapal kapag W×L lang ang dim
}) {
  const rows = sizes.filter((s) => s.enabled !== false);
  if (rows.length === 0) return null;

  const active = rows.find((r) => r.size === focus) ?? rows[0];
  const shown = focus ? rows.filter((r) => r.size === active.size) : rows;
  const tOf = (dim: string) => {
    const p = splitDim(dim);
    if (p?.thickness) return `${p.thickness}"`;
    return thickness ?? "—";
  };

  return (
    <div className="bg-white rounded-lg p-6">
      <h3 className="text-sm font-bold tracking-widest2 mb-6 flex items-center gap-2" style={{ color: GOLD }}>
        MATTRESS DIMENSIONS
        <span className="flex-1 border-t border-dotted" style={{ borderColor: GOLD }} />
      </h3>

      <div className="mb-6">
        <svg viewBox="0 0 300 180" className="w-full" style={{ color: GOLD }} role="img" aria-label="Mattress dimensions">
          <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
            <path d="M60 60 L200 40 L270 70 L130 92 Z" />
            <path d="M60 60 L60 100 L130 132 L130 92 Z" />
            <path d="M130 92 L130 132 L270 110 L270 70 Z" />
            {/* quilting — manipis na linya sa ibabaw */}
            <g strokeWidth="0.7" opacity="0.5">
              <path d="M95 55 L165 87 M130 50 L200 82 M165 45 L235 77" />
              <path d="M78 68 L218 48 M96 76 L236 56 M114 84 L254 64" />
            </g>
          </g>
          <g stroke="currentColor" strokeWidth="1" fill="none">
            <path d="M44 60 L44 100 M40 60 L48 60 M40 100 L48 100" />
            <path d="M62 146 L132 178 M60 142 L66 150 M128 174 L136 180" />
            <path d="M140 146 L278 124 M138 142 L142 150 M276 120 L280 128" />
          </g>
          <Lbl x={30} y={80} t="T" />
          <Lbl x={82} y={168} t="W" />
          <Lbl x={215} y={145} t="L" />
        </svg>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[320px]">
          <thead>
            <tr style={{ backgroundColor: GOLD }} className="text-white text-left">
              <th className="py-2 px-3 font-medium">Size</th>
              <th className="py-2 px-3 font-medium">Mattress</th>
              <th className="py-2 px-3 font-medium">T</th>
              <th className="py-2 px-3 font-medium">W</th>
              <th className="py-2 px-3 font-medium">L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand">
            {shown.map((r) => {
              const p = splitDim(r.dim);
              const on = r.size === active.size;
              return (
                <tr
                  key={r.size}
                  onClick={() => onFocus?.(r.size)}
                  className={`bg-linen ${onFocus ? "cursor-pointer hover:bg-sand/40" : ""} ${on ? "font-bold" : ""}`}
                >
                  <td className="py-2.5 px-3 text-ink whitespace-nowrap">{r.size}</td>
                  <td className="py-2.5 px-3 text-stone whitespace-nowrap">{p ? `${p.width}"×${p.length}"` : r.dim}</td>
                  <td className="py-2.5 px-3 text-stone tabular-nums">{tOf(r.dim)}</td>
                  <td className="py-2.5 px-3 text-stone tabular-nums">{p ? `${p.width}"` : "—"}</td>
                  <td className="py-2.5 px-3 text-stone tabular-nums">{p ? `${p.length}"` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
