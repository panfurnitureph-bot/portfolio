"use client";

// Swatch manager — bawat kulay ng product: pangalan, material, at
// swatch photo (close-up ng tela). Ito ang lalabas na color circles +
// hover popup sa product page. Sabay ini-update ang plain colors array.

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { apiUpload, extOf } from "./api";
import swatchLibrary from "@/content/swatch-library.json";

type Swatch = { name: string; material?: string; swatch?: string; image?: string };
type LibSwatch = { name: string; material?: string; swatch?: string; color?: string };

const LIBRARY = swatchLibrary as LibSwatch[];

// Library picker — grid ng swatch IMAGES na may search. Click ng box para
// idagdag ang kulay (kita agad ang tela, hindi na nakakalitong text list).
function LibraryPicker({
  library,
  used,
  onPick,
}: {
  library: LibSwatch[];
  used: string[];
  onPick: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const usedSet = new Set(used.map((n) => n.toLowerCase()));
  const filtered = useMemo(
    () =>
      library.filter(
        (l) =>
          l.name.toLowerCase().includes(q.toLowerCase()) ||
          (l.material ?? "").toLowerCase().includes(q.toLowerCase())
      ),
    [library, q]
  );

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between border border-stone/40 bg-white px-3 py-2 text-sm rounded hover:border-cognac"
      >
        <span className="font-bold">+ Add color from library</span>
        <span className="text-stone">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border border-sand rounded mt-2 p-3 bg-linen/40">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search color or material…"
            className="w-full border border-stone/40 bg-white px-3 py-2 text-sm rounded mb-3 focus:outline-none focus:border-cognac"
          />
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-auto">
            {filtered.map((l) => {
              const already = usedSet.has(l.name.toLowerCase());
              return (
                <button
                  key={l.name}
                  type="button"
                  disabled={already}
                  onClick={() => onPick(l.name)}
                  title={`${l.name}${l.material ? " — " + l.material : ""}`}
                  className={`text-left group ${already ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  <div className="relative w-full aspect-square rounded overflow-hidden border-2 border-stone/20 group-hover:border-cognac bg-sand">
                    {l.swatch ? (
                      <Image src={l.swatch} alt={l.name} fill className="object-cover" sizes="80px" />
                    ) : (
                      <div className="w-full h-full" style={{ backgroundColor: l.color ?? "#ddd" }} />
                    )}
                    {already && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-[10px] font-bold">
                        ADDED
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] leading-tight mt-1 text-stone line-clamp-2">
                    {l.name}
                  </p>
                </button>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <p className="text-xs text-stone text-center py-4">No matching colors.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SwatchUpload({
  label,
  value,
  onChange,
  baseName,
}: {
  label: string;
  value?: string;
  onChange: (url: string) => void;
  baseName: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function handle(f: File) {
    setBusy(true);
    try {
      const url = await apiUpload(`images/swatches/${baseName}-${Date.now()}.${extOf(f)}`, f);
      onChange(url);
    } catch {}
    setBusy(false);
  }
  return (
    <div className="flex items-center gap-2">
      {value ? (
        <div className="relative w-12 h-12 rounded-full overflow-hidden border border-sand shrink-0">
          <Image src={value} alt="" fill className="object-cover" sizes="48px" />
        </div>
      ) : (
        <div className="w-12 h-12 rounded-full border border-dashed border-stone/40 shrink-0" />
      )}
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="text-xs border border-stone/40 hover:border-cognac px-2 py-1 rounded"
      >
        {busy ? "..." : value ? "Change" : label}
      </button>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
    </div>
  );
}

export default function SwatchManager({
  colors,
  swatches,
  slug,
  onChange,
}: {
  colors: string[];
  swatches: Swatch[];
  slug: string;
  onChange: (colors: string[], swatches: Swatch[]) => void;
}) {
  // I-normalize: gawing swatch entry bawat color
  const rows: Swatch[] = colors.map((c, i) => swatches[i] ?? { name: c });

  function update(i: number, patch: Partial<Swatch>) {
    const next = rows.map((r, x) => {
      if (x !== i) return r;
      const merged = { ...r, ...patch };
      // Kung binago ang pangalan at tumugma sa library (case-insensitive),
      // auto-lagay ang swatch + material — kahit tinype lang
      if (patch.name !== undefined) {
        const lib = LIBRARY.find(
          (l) => l.name.toLowerCase() === patch.name!.trim().toLowerCase()
        );
        if (lib) {
          if (!merged.swatch) merged.swatch = lib.swatch;
          if (!merged.material) merged.material = lib.material;
        }
      }
      return merged;
    });
    onChange(next.map((r) => r.name), next);
  }
  function add() {
    const next = [...rows, { name: "New color" }];
    onChange(next.map((r) => r.name), next);
  }
  function remove(i: number) {
    const next = rows.filter((_, x) => x !== i);
    onChange(next.map((r) => r.name), next);
  }
  // Pumili mula sa color library — auto-lagay ang pangalan/material/swatch
  function addFromLibrary(name: string) {
    if (!name) return;
    const lib = LIBRARY.find((l) => l.name === name);
    if (!lib) return;
    const next = [...rows, { name: lib.name, material: lib.material, swatch: lib.swatch }];
    onChange(next.map((r) => r.name), next);
  }

  return (
    <div className="mb-3 col-span-2">
      <span className="block text-xs font-bold text-stone mb-2">
        Colors / Variants — pick from the library or add a custom one
      </span>

      {/* Library picker — grid ng swatch IMAGES (may search), hindi text-lang */}
      <LibraryPicker
        library={LIBRARY}
        used={rows.map((r) => r.name)}
        onPick={addFromLibrary}
      />
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="border border-sand rounded p-3 bg-linen/40">
            <div className="flex items-start justify-between gap-3">
              <div className="grid sm:grid-cols-2 gap-x-3 flex-1">
                <label className="block mb-2">
                  <span className="block text-[11px] font-bold text-stone mb-1">Color name</span>
                  <input
                    value={r.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder="e.g. Maserati"
                    className="w-full border border-stone/40 bg-white px-2 py-1.5 text-sm rounded focus:outline-none focus:border-cognac"
                  />
                </label>
                <label className="block mb-2">
                  <span className="block text-[11px] font-bold text-stone mb-1">Material</span>
                  <input
                    value={r.material ?? ""}
                    onChange={(e) => update(i, { material: e.target.value })}
                    placeholder="e.g. Burly Wood / Performance Chenille"
                    className="w-full border border-stone/40 bg-white px-2 py-1.5 text-sm rounded focus:outline-none focus:border-cognac"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove color"
                className="text-red-700 hover:text-red-900 text-lg leading-none mt-1"
              >
                ×
              </button>
            </div>
            <div className="flex flex-wrap gap-4 mt-1">
              <div>
                <span className="block text-[11px] text-stone mb-1">Swatch (fabric close-up)</span>
                <SwatchUpload label="Upload swatch" value={r.swatch} onChange={(u) => update(i, { swatch: u })} baseName={`${slug}-sw-${i}`} />
              </div>
              <div>
                <span className="block text-[11px] text-stone mb-1">Product photo in this color (optional)</span>
                <SwatchUpload label="Upload photo" value={r.image} onChange={(u) => update(i, { image: u })} baseName={`${slug}-img-${i}`} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-3 border border-stone/40 hover:border-cognac text-xs font-bold px-3 py-1.5 rounded"
      >
        + ADD COLOR
      </button>
    </div>
  );
}
