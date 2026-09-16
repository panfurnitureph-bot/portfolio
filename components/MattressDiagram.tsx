"use client";

// MATTRESS DIMENSIONS — katumbas ng FrameDiagram pero para sa mattress.
// Walang headboard, base, o legs — tatlong sukat lang: kapal, lapad, haba.

export type MattressSize = {
  size: string;
  dim: string; // buong sukat, hal. '6 x 36 x 75"'
  price?: number;
  enabled?: boolean;
};

// Hinihiwalay ang '6 x 36 x 75"' sa tatlong bahagi. Tinatanggap din ang
// '6"x36"x75"' at '6x36x75' — kung ano ang naitype sa admin.
export function splitDim(dim: string): { thickness: string; width: string; length: string } | null {
  const parts = (dim || "")
    .replace(/["″]/g, "")
    .split(/\s*[x×]\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  return { thickness: parts[0], width: parts[1], length: parts[2] };
}

export default function MattressDiagram({
  sizes,
  focus,
  onFocus,
}: {
  sizes: MattressSize[];
  focus?: string | null;
  onFocus?: (size: string) => void;
}) {
  const rows = sizes.filter((s) => s.enabled !== false);
  if (rows.length === 0) return null;

  const active = rows.find((r) => r.size === focus) ?? rows[0];
  const d = splitDim(active.dim);
  // Ang napiling size lang ang ipinapakita — gaya ng frame table sa kama.
  // Kung walang napili, buong talaan.
  const shown = focus ? rows.filter((r) => r.size === active.size) : rows;

  return (
    <div className="bg-linen rounded-lg p-6">
      <p className="text-xs font-bold tracking-widest2 text-olive mb-5">
        MATTRESS DIMENSIONS
        <span className="hidden sm:inline text-stone/40 font-normal"> ····································</span>
      </p>

      {/* Guhit ng kutson — makapal na slab, may label sa tatlong sukat */}
      <div className="flex justify-center mb-6">
        <svg viewBox="0 0 300 180" className="w-full max-w-[320px]" role="img" aria-label="Mattress dimensions">
          <g fill="none" stroke="#8a7a52" strokeWidth="1.4" strokeLinejoin="round">
            {/* itaas na mukha */}
            <path d="M60 60 L200 40 L270 70 L130 92 Z" />
            {/* harapan (kapal) */}
            <path d="M60 60 L60 100 L130 132 L130 92 Z" />
            {/* gilid (kapal) */}
            <path d="M130 92 L130 132 L270 110 L270 70 Z" />
          </g>

          {/* T — kapal */}
          <g stroke="#8a7a52" strokeWidth="1" fill="none">
            <path d="M44 60 L44 100" />
            <path d="M40 60 L48 60 M40 100 L48 100" />
          </g>
          <circle cx="30" cy="80" r="9" fill="#8a7a52" />
          <text x="30" y="84" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="bold">T</text>

          {/* W — lapad */}
          <g stroke="#8a7a52" strokeWidth="1" fill="none">
            <path d="M62 146 L132 178" />
            <path d="M60 142 L66 150 M128 174 L136 180" />
          </g>
          <circle cx="82" cy="168" r="9" fill="#8a7a52" />
          <text x="82" y="172" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="bold">W</text>

          {/* L — haba */}
          <g stroke="#8a7a52" strokeWidth="1" fill="none">
            <path d="M140 146 L278 124" />
            <path d="M138 142 L142 150 M276 120 L280 128" />
          </g>
          <circle cx="215" cy="145" r="9" fill="#8a7a52" />
          <text x="215" y="149" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="bold">L</text>
        </svg>
      </div>

      {/* Alin ang alin */}
      <div className="space-y-2 mb-6 text-sm">
        {[
          { k: "T", label: "Thickness", v: d?.thickness },
          { k: "W", label: "Width", v: d?.width },
          { k: "L", label: "Length", v: d?.length },
        ].map((r) => (
          <div key={r.k} className="flex items-center gap-3">
            <span className="w-5 h-5 rounded-full bg-olive text-cream text-[10px] font-bold flex items-center justify-center shrink-0">
              {r.k}
            </span>
            <span className="text-ink">{r.label}</span>
            {r.v && <span className="text-stone ml-auto tabular-nums">{r.v}&quot;</span>}
          </div>
        ))}
      </div>

      {/* Buong talaan — pindutin ang row para palitan ang nasa itaas */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-olive text-cream text-left">
              <th className="px-3 py-2 font-bold">Size</th>
              <th className="px-3 py-2 font-bold">T</th>
              <th className="px-3 py-2 font-bold">W</th>
              <th className="px-3 py-2 font-bold">L</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const p = splitDim(r.dim);
              const on = r.size === active.size;
              return (
                <tr
                  key={r.size}
                  onClick={() => onFocus?.(r.size)}
                  className={`border-b border-sand last:border-0 ${
                    onFocus ? "cursor-pointer hover:bg-sand/40" : ""
                  } ${on ? "bg-sand/60 font-bold" : ""}`}
                >
                  <td className="px-3 py-2 whitespace-nowrap">{r.size}</td>
                  <td className="px-3 py-2 tabular-nums">{p ? `${p.thickness}"` : r.dim}</td>
                  <td className="px-3 py-2 tabular-nums">{p ? `${p.width}"` : ""}</td>
                  <td className="px-3 py-2 tabular-nums">{p ? `${p.length}"` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
