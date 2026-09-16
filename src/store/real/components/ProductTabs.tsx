"use client";

// Full-width na horizontal tabs sa ilalim ng product detail — tulad ng
// tunay na site: serif na nakasentro (Description & Features |
// Dimensions | Details & Care | Shipping, Returns & Warranty).
// Ang Shipping tab ay 3-column na may icons.

import type { JSX } from "react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { site as siteDefault, type Product, type SiteContent } from "@/lib/products";
import FrameDiagram, { DEFAULT_BED_SIZES, bedBuildRows, bedFlags, buildFromSpecs, type BedBuild } from "@/components/FrameDiagram";
import MattressDiagram, { splitDim } from "@/components/MattressDiagram";
import MeasureDiagram, { measureKind, measureRows } from "@/components/MeasureDiagram";
import DimPhotos, { type DimKind } from "@/components/DimPhotos";
import type { MtoItemConfig } from "@/lib/content";
import { frameFor } from "@/lib/double-walling";

const TABS = [
  { id: "description", label: "Description & Features" },
  { id: "dimensions", label: "Dimensions" },
  { id: "care", label: "Details & Care" },
  { id: "shipping", label: "Shipping, Returns & Warranty" },
];

// Hilahin ang W/D/H mula sa dimensions text (hal. `84.5" W x 38" D x 32" H`)
function parseDims(s: string): { w?: string; d?: string; h?: string } {
  const grab = (re: RegExp) => s.match(re)?.[1];
  return {
    w: grab(/([\d.]+)\s*(?:"|”|in)?\s*W/i),
    d: grab(/([\d.]+)\s*(?:"|”|in)?\s*D(?![a-z])/i),
    h: grab(/([\d.]+)\s*(?:"|”|in)?\s*H/i),
  };
}

// Simpleng line diagram na may sukat na arrows (front view)
function DimensionDiagram({ w, h, d }: { w?: string; d?: string; h?: string }) {
  return (
    <svg viewBox="0 0 300 210" className="w-full max-w-sm mx-auto text-ink">
      {/* produkto (kahon) */}
      <rect x="60" y="40" width="180" height="110" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1="60" y1="150" x2="45" y2="170" stroke="currentColor" strokeWidth="1.5" />
      <line x1="240" y1="150" x2="255" y2="170" stroke="currentColor" strokeWidth="1.5" />
      {/* width arrow */}
      <line x1="60" y1="22" x2="240" y2="22" stroke="currentColor" strokeWidth="1" />
      <path d="M60 22l6 -3v6zM240 22l-6 -3v6z" fill="currentColor" />
      <text x="150" y="16" textAnchor="middle" fontSize="11" fill="currentColor">
        {w ? `${w}" W` : "Width"}
      </text>
      {/* height arrow */}
      <line x1="272" y1="40" x2="272" y2="150" stroke="currentColor" strokeWidth="1" />
      <path d="M272 40l-3 6h6zM272 150l-3 -6h6z" fill="currentColor" />
      <text x="281" y="100" fontSize="11" fill="currentColor" transform="rotate(90 281 100)" textAnchor="middle">
        {h ? `${h}" H` : "Height"}
      </text>
      {/* depth arrow (pahilis) */}
      <line x1="20" y1="192" x2="52" y2="164" stroke="currentColor" strokeWidth="1" />
      <path d="M20 192l7 -1l-4 -5zM52 164l-7 1l4 5z" fill="currentColor" />
      <text x="18" y="205" fontSize="11" fill="currentColor">
        {d ? `${d}" D` : "Depth"}
      </text>
    </svg>
  );
}

// Mga size ng kama (pareho ng size selector sa itaas)
const BED_SIZES = [
  { id: "Twin", w: '39"', l: '75"' },
  { id: "Full", w: '54"', l: '75"' },
  { id: "Queen", w: '60"', l: '80"' },
  { id: "King", w: '76"', l: '80"' },
];

// Dimensions tab: shared size state — pag pinili ang isang size sa
// FrameDiagram, ang left specs ay nag-hi-highlight sa napiling size.
function DimensionsPanel({ product, mto }: { product: Product; mto?: MtoItemConfig | null }) {
  // Ang mattress ay may sariling sukat (kapal × lapad × haba) — walang frame,
  // kaya hiwalay ang panel nito sa kama.
  const isMattress = product.category === "mattress";
  // Kasama ang customized-bed — may frame din ito, kaya frame diagram ang bagay.
  const isBed =
    !isMattress && ["bed", "customized-bed", "bedroom"].includes(product.category);
  // Sofa Bed = sofa drawing (armrest, backrest, seat…) + "Opens to" na sukat
  // ng kutson mula sa napiling size — hindi frame diagram ng kama.
  const specs = product.dimensionSpecs ?? [];
  const dims = parseDims(product.dimensions);
  // Gamitin ang custom na bedSizes ng product kung meron, kung wala default
  // MATTRESS na may "Sizes:"/"Size:" sa as-is specs (IMS Products) → iyon ang
  // mga size ng diagram (36x75 → SINGLE, …), hindi ang default na kama.
  const readySpecLines = String((product as unknown as { mtoReadySpecs?: string }).mtoReadySpecs ?? "").split("\n").map((l) => l.trim());
  const SIZE_NAME: Record<string, string> = { "36x75": "SINGLE", "48x75": "TWIN", "54x75": "DOUBLE/FULL", "60x75": "QUEEN", "72x75": "KING", "72x78": "KING 2" };
  const specSizes = (() => {
    if (!isMattress) return [] as typeof DEFAULT_BED_SIZES;
    const line = readySpecLines.find((l) => /^sizes?:/i.test(l));
    if (!line) return [] as typeof DEFAULT_BED_SIZES;
    const dims = line.replace(/^sizes?:\s*/i, "").split(/\s*·\s*/).map((t) => t.trim().split(/\s+/)[0].toLowerCase().replace(/"/g, "")).filter((d) => /^\d+x\d+$/.test(d));
    return dims.map((d) => ({ size: SIZE_NAME[d] ?? d.toUpperCase(), dim: d.replace("x", '"x') + '"', A: "", B: "", C: "", D: "", E: "" }));
  })();
  const bedSizesBase = (specSizes.length
    ? specSizes
    : product.bedSizes && product.bedSizes.length
    ? product.bedSizes.filter((s: any) => s.enabled !== false)
    : DEFAULT_BED_SIZES) as typeof DEFAULT_BED_SIZES;
  // LIVE mula sa customizer (2026-08-23): kapag inangat ng customer ang Headboard
  // Height o Bedframe Height sa MTO options, sumusunod ang B at D ng diagram.
  // Ang table mismo (bedSizes) ay galing sa Publish ng Configurator.
  const [liveMeas, setLiveMeas] = useState<Record<string, number>>({});
  useEffect(() => {
    const h = (e: Event) => setLiveMeas({ ...(((e as CustomEvent).detail as Record<string, number>) ?? {}) });
    window.addEventListener("pan-measure-change", h);
    return () => window.removeEventListener("pan-measure-change", h);
  }, []);
  // BUILD mula sa customizer: bawat add-on na pinili ay may sariling layer
  // (F–M) sa diagram at hanay sa listahan — live sa bawat click.
  const [liveBuild, setLiveBuild] = useState<BedBuild | null>(null);
  useEffect(() => {
    const h = (e: Event) => setLiveBuild(((e as CustomEvent).detail as BedBuild) ?? null);
    window.addEventListener("pan-build-change", h);
    return () => window.removeEventListener("pan-build-change", h);
  }, []);
  // LOCKED / AS-IS: walang customizer → ang orihinal na specs ng produkto ang
  // build ng diagram. Customizable → ang live na pili ang nangingibabaw.
  const specBuild = isBed ? buildFromSpecs(readySpecLines) : null;
  const build = liveBuild ?? specBuild;
  const buildRows = isBed ? bedBuildRows(build) : [];
  // Pangalan ng napiling size (pb-size-change) — para sa "Opens to" ng sofa bed.
  const [sizeName, setSizeName] = useState("");
  // IBANG CATEGORY (sofa, chairs, tables, wall padding…): line drawing na may
  // letra, sumusunod sa measurements ng Configurator at sa live na pili.
  const mKind = !isMattress && !isBed ? measureKind(product.category) : null;
  // LOCKED / AS-IS (2026-09-03, "di naman sya customizable so dapat susundin
  // nya ung sa product information"): walang customizer, kaya ang sukat sa
  // Product Management (as-is specs: "Total Height: 28 inches") ang masusunod -
  // sa listahan, sa drawing, at sa table - hindi ang default ng Configurator.
  const mtoLocked = !!mto && !mto.customizable;
  const normL = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
  // Tinatanggap ang cm at ft (Add Product: in/cm/ft toggle, 2026-09-04) at
  // ginagawang pulgada - dati inches lang ang nababasa, nawawala ang iba.
  const specMeasRows = readySpecLines
    .map((l) => /^([^:]+):\s*(\d+(?:\.\d+)?)\s*(cm|ft|"|″|in\b|inch(?:es)?)?\s*$/i.exec(l))
    .filter((m): m is RegExpExecArray => !!m && !/^sizes?$/i.test(m[1].trim()))
    .map((m) => { const u = (m[3] ?? "").toLowerCase(); const raw = Number(m[2]); const n = u === "cm" ? Math.round((raw / 2.54) * 10) / 10 : u === "ft" ? raw * 12 : raw; return { label: m[1].trim(), n }; });
  const specMeas: Record<string, number> = {};
  // "Seat Height (incl. legs)" ↔ "Seat Height" ng drawing: itala rin nang
  // walang parenthetical para tumugma ang letra (B) at ang halaga.
  for (const r of specMeasRows) { specMeas[r.label] = r.n; specMeas[r.label.replace(/\s*\(.*?\)\s*/g, " ").trim()] = r.n; }
  const useSpec = mtoLocked && !Object.keys(liveMeas).length && specMeasRows.length > 0;
  const mRows = mKind ? measureRows(mKind, useSpec ? specMeas : liveMeas, mto?.measurements) : { rows: [], live: false };
  if (useSpec) mRows.live = false;
  // Listahan sa kaliwa kapag locked: ang mga linya ng Product Management, may
  // letra kung nasa drawing ang sukat (A-D), wala kung dagdag na detalye.
  const lockedRows = useSpec
    ? specMeasRows.map((r) => ({ k: mRows.rows.find((x) => normL(x.label) === normL(r.label) || normL(x.label) === normL(r.label.replace(/\s*\(.*?\)\s*/g, " ")))?.k ?? "", label: r.label, value: `${r.n}"` }))
    : null;
  if (mKind && /sofa.?bed/i.test(product.category)) {
    const on = (mto?.sizes ?? []).filter((x) => x.on !== false);
    const pick = on.find((x) => sizeName && x.label.toLowerCase().startsWith(sizeName.toLowerCase())) ?? on[0];
    const m = pick ? /(\d+)\s*x\s*(\d+)/i.exec(pick.label) : null;
    if (m) mRows.rows.push({ k: String.fromCharCode(65 + mRows.rows.length), label: "Opens to (mattress)", value: `${m[1]}"×${m[2]}"` });
  }
  const liveInch = (re: RegExp) => {
    // Live na sukat ng customizer; kung wala (locked), ang nasa orihinal na specs.
    const src = Object.keys(liveMeas).length ? liveMeas : (specBuild?.meas ?? {});
    const k = Object.keys(src).find((x) => re.test(x));
    const n = k ? src[k] : 0;
    return n > 0 ? String(n) + '"' : undefined;
  };
  const liveB = liveInch(/headboard\s*height/i), liveD = liveInch(/bedframe\s*height|base\s*height/i);
  // MATTRESS: bawat modelo ay sariling item (Linen by PAN catalog) — ang kapal
  // (T) ay FI\ED na detalye ng item sa Configurator ('Thickness: 10"'); kung
  // wala, ang napiling/unang Model option (lumang config); sa huli ang pangalan
  // ng produkto ("Trill Hybrid" → 10"). Ang size mismo ay W×L lang.
  const mattT = (() => {
    const thick = (label: string) => {
      const m = /(\d+(?:\.\d+)?)\s*(?:"|″|in\b)/i.exec(label ?? "");
      if (m) return Number(m[1]);
      const t = label ?? "";
      if (/trill\s*hybrid/i.test(t)) return 10;
      if (/trill\s*regal/i.test(t)) return 9;
      if (/trill\s*air/i.test(t)) return 5;
      if (/comfort\s*plus/i.test(t)) return 6;
      if (/airlite/i.test(t)) return 6;
      return null;
    };
    const addons = mto?.addons ?? [];
    const fixed = addons.find((a) => a.on !== false && a.type === "FIXED" && /thickness/i.test(a.label))?.label ?? "";
    // As-is specs mula sa IMS Products: "Thickness: 6 inches".
    const specThick = readySpecLines.find((l) => /^thickness:/i.test(l))?.replace(/inches?/i, "in") ?? "";
    const picked = Object.entries(build?.choices ?? {}).find(([g]) => /^model/i.test(g))?.[1] ?? "";
    const modelRows = addons.filter((a) => /^model\s*:/i.test(a.label));
    const firstOf = (rows: typeof modelRows) => rows[0]?.label.split(":")[1]?.split("/")[0]?.trim() ?? "";
    const t = thick(specThick) ?? thick(fixed) ?? thick(picked) ?? thick(firstOf(modelRows.filter((a) => a.on !== false))) ?? thick(firstOf(modelRows)) ?? thick(product.name);
    return t ? `${t}"` : undefined;
  })();
  // DOUBLE WALLING: ang frame ay lumalabas sa kutson (talaan ng team sa
  // lib/double-walling) — ang A (width) at C (length) ay sumusunod sa frame.
  // Floating legs → E = "Floating". Pareho ito ng ginagawa ng diagram.
  const flags = bedFlags(build);
  const dwOn = !!build?.checks?.some((c) => /double walling/i.test(c));
  const dwT = build?.dw?.thick ?? 8;
  const bedSizes = bedSizesBase.map((r) => {
    const f = dwOn ? frameFor(r.size, dwT) : null;
    return { ...r, A: f ? `${f.w}"` : r.A, C: f ? `${f.l}"` : r.C, B: liveB ?? r.B, D: liveD ?? r.D, E: flags.floating ? "Floating" : r.E };
  }) as typeof DEFAULT_BED_SIZES;
  const [sizeFocus, setSizeFocus] = useState<string | null>(
    isBed || isMattress ? bedSizes[0]?.size ?? null : null
  );

  // Makinig sa size selector sa taas (product info) — sabay mag-update
  useEffect(() => {
    function onSize(e: Event) {
      const id = (e as CustomEvent).detail as string;
      setSizeName(id);
      // I-match ang selector id (hal. "King 2", "Double/Full") sa table size
      const key = id.toLowerCase().replace(/[\s/"]/g, "");
      const m = bedSizes.find(
        (s) => s.size.toLowerCase().replace(/[\s/]/g, "") === key
          // mattress size buttons ay nagpapadala ng "60x75" — itugma sa dim
          || s.dim.toLowerCase().replace(/[\s"″]/g, "") === key
      );
      if (m) setSizeFocus(m.size);
    }
    window.addEventListener("pan-size-change", onSize);
    return () => window.removeEventListener("pan-size-change", onSize);
  }, []);

  // Ang measurements ng napiling size mula sa size table (A/B/C/D/E)
  const selected = bedSizes.find((s) => s.size === sizeFocus);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-9 items-start">
      {/* KALIWA: para sa beds — specs ng NAPILING size lang; para sa iba —
          buong specs list */}
      <div className="text-sm">
        {isMattress && selected ? (
          // Mattress: kapal × lapad × haba lang — walang frame na sukat
          (() => {
            const d = splitDim(selected.dim);
            return (
              <div className="space-y-4">
                <div>
                  <p className="font-bold text-ink">{selected.size} Dimensions</p>
                  <p className="text-stone">{selected.dim}</p>
                </div>
                {d && (
                  <>
                    <div>
                      <p className="font-bold text-ink">T — Thickness</p>
                      <p className="text-stone">{d.thickness ? `${d.thickness}"` : (mattT ?? "—")}</p>
                    </div>
                    <div>
                      <p className="font-bold text-ink">W — Width</p>
                      <p className="text-stone">{d.width}&quot;</p>
                    </div>
                    <div>
                      <p className="font-bold text-ink">L — Length</p>
                      <p className="text-stone">{d.length}&quot;</p>
                    </div>
                  </>
                )}
                <div>
                  <p className="font-bold text-ink">Packaged (approx.)</p>
                  <p className="text-stone">Rolled or boxed — check delivery notes</p>
                </div>
              </div>
            );
          })()
        ) : isBed && selected ? (
          // Beds: ipakita ang sukat ng napiling size (hal. SINGLE lang)
          <div className="space-y-4">
            <div>
              <p className="font-bold text-ink">{selected.size} Dimensions</p>
              <p className="text-stone">Mattress: {selected.dim}</p>
            </div>
            <div>
              <p className="font-bold text-ink">A — Width</p>
              <p className="text-stone">{selected.A}</p>
            </div>
            {!flags.noHead && (
              <div>
                <p className="font-bold text-ink">B — Headboard Height</p>
                <p className="text-stone">{selected.B}</p>
              </div>
            )}
            <div>
              <p className="font-bold text-ink">C — Length</p>
              <p className="text-stone">{selected.C}</p>
            </div>
            <div>
              <p className="font-bold text-ink">D — Base Height</p>
              <p className="text-stone">{selected.D}</p>
            </div>
            {!flags.platform && (
              <div>
                <p className="font-bold text-ink">E — Legs</p>
                <p className="text-stone">{selected.E}</p>
              </div>
            )}
            {/* Mga add-on na pinili sa customizer — kapareho ng letra sa diagram */}
            {buildRows.map((r) => (
              <div key={r.k}>
                <p className="font-bold text-ink">{r.k} — {r.label}</p>
                <p className="text-stone">{r.value}</p>
              </div>
            ))}
            <div>
              <p className="font-bold text-ink">Packaged (approx.)</p>
              <p className="text-stone">Add ~2&quot; per side</p>
            </div>
          </div>
        ) : mKind ? (
          <div className="space-y-3.5">
            {/* "Overall" lang kapag tunay na W×D×H ang text, hindi pinagdikit na specs */}
            {product.dimensions && parseDims(product.dimensions).w && parseDims(product.dimensions).h && (
              <div>
                <p className="font-semibold text-ink">Overall dimensions</p>
                <p className="text-stone">{product.dimensions}</p>
              </div>
            )}
            {(lockedRows ?? mRows.rows).map((r) => (
              <div key={r.k || r.label}>
                <p className="font-semibold text-ink">{r.k ? `${r.k} — ` : ""}{r.label}</p>
                <p className="text-stone">{r.value}</p>
              </div>
            ))}
            <div>
              <p className="font-semibold text-ink">Packaged (approx.)</p>
              <p className="text-stone">Add ~2&quot; per side</p>
            </div>
            <p className="text-[12.5px] text-stone leading-relaxed max-w-[40ch]"><b className="text-ink font-semibold">Note:</b> Measurements are taken at the widest point of the padding, not seam to seam. Handmade pieces may vary by up to ½&quot;.</p>
          </div>
        ) : specs.length > 0 ? (
          <div className="space-y-4">
            {specs.map((s) => (
              <div key={s.label}>
                <p className="font-bold text-ink">{s.label}</p>
                <p className="text-stone whitespace-pre-line">{s.value}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="font-bold text-ink">Overall Product Dimensions</p>
              <p className="text-stone">{product.dimensions}</p>
            </div>
            {dims.w && (
              <div>
                <p className="font-bold text-ink">Width</p>
                <p className="text-stone">{dims.w}&quot;</p>
              </div>
            )}
            {dims.h && (
              <div>
                <p className="font-bold text-ink">Height</p>
                <p className="text-stone">{dims.h}&quot;</p>
              </div>
            )}
            <div>
              <p className="font-bold text-ink">Packaged (approx.)</p>
              <p className="text-stone">Add ~2&quot; per side</p>
            </div>
          </div>
        )}
        <a href="/measuring" className="inline-block mt-5 text-[11.5px] font-bold tracking-[0.14em] uppercase text-ink border-b-[1.5px] border-goldDeep pb-0.5 hover:text-goldDeep">
          Measure for delivery
        </a>
      </div>

      {/* KANAN: diagram */}
      <div>
        {isMattress ? (
          <div className="bg-white border border-sand p-4"><MattressDiagram sizes={bedSizes} focus={sizeFocus} onFocus={setSizeFocus} thickness={mattT} /></div>
        ) : isBed && selected && product.images.length > 0 ? (
          // KAMA (2026-09-04): litrato rin - headboard view + haba, sukat ng
          // NAPILING size (A-E), live sa customizer (headboard/base height).
          <DimPhotos
            kind="bed"
            photos={product.images.slice(0, 6)}
            subject={product.name}
            rows={[
              { k: "A", label: "Width", value: selected.A }, { k: "B", label: "Headboard Height", value: flags.noHead ? "" : selected.B },
              { k: "C", label: "Length", value: selected.C }, { k: "D", label: "Base Height", value: selected.D },
              { k: "E", label: "Legs", value: flags.platform ? "" : selected.E },
            ].filter((r) => /[0-9]/.test(r.value))}
          />
        ) : isBed ? (
          <div className="bg-white border border-sand p-4"><FrameDiagram
            sizes={bedSizes}
            focus={sizeFocus}
            onFocus={setSizeFocus}
            hideChips
            build={build}
            addOns={(product.addOns ?? []).map((a) => {
              // gamitin ang sukat/presyo ng NAPILING size kung meron
              const perSize = sizeFocus ? a.bySize?.[sizeFocus] : undefined;
              return {
                ...a,
                detail: perSize?.detail ?? a.detail,
                price: perSize?.price ?? a.price,
              };
            })}
          /></div>
        ) : mKind && product.images.length > 0 ? (
          <DimPhotos kind={(/table/.test(mKind) ? "table" : "seat") as DimKind} photos={product.images.slice(0, 6)} rows={(lockedRows ?? mRows.rows).filter((r) => /[0-9]/.test(r.value))} subject={product.name} />
        ) : mKind ? (
          <MeasureDiagram kind={mKind} rows={mRows.rows} live={mRows.live} />
        ) : product.dimensionImage ? (
          <div className="relative aspect-[4/3] bg-white rounded p-4">
            <Image src={product.dimensionImage} alt="Dimensions" fill className="object-contain" sizes="(min-width: 768px) 500px, 100vw" />
          </div>
        ) : (
          <div className="bg-white rounded p-4">
            <DimensionDiagram {...dims} />
          </div>
        )}
      </div>
    </div>
  );
}

// Ang Shipping / Returns / Warranty na tab ay galing sa site.productTabs
// (IMS Website > Promo & Site, 2026-08-23) - dating naka-hardcode dito. Ang
// bundled site.json ang default kapag wala pa sa web_content doc.
type TabCol = { title: string; heading?: string; body?: string; note?: string; note2?: string; heading2?: string; body2?: string; linkLabel?: string; linkHref?: string };
const rich = (t: string) => t.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i} className="text-ink">{part}</strong> : part));
const ICONS: Record<string, JSX.Element> = {
  shipping: <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M1 7h12v9H1zM13 10h5l3 3v3h-8z" /><circle cx="6" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></svg>,
  guarantee: <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M21 12a9 9 0 11-3-6.7" /><path d="M21 4v4h-4" /><path d="M12 10.5c-.8-.9-2.2-.9-3 0-.7.8-.7 2 0 2.8L12 16l3-2.7c.7-.8.7-2 0-2.8-.8-.9-2.2-.9-3 0z" /></svg>,
  warranty: <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="12" cy="9" r="5" /><path d="M9 13l-2 8 5-3 5 3-2-8" /></svg>,
};

export default function ProductTabs({ product, site, mto }: { product: Product; site?: SiteContent; mto?: MtoItemConfig | null }) {
  const tabs = ((site as SiteContent | undefined)?.productTabs ?? siteDefault.productTabs) as Record<string, TabCol>;
  // Default = Dimensions para agad makita ang FRAME DIMENSIONS table
  // (hindi na kailangang pindutin ang tab o VIEW DIMENSIONS)
  const [tab, setTab] = useState("dimensions");

  // "View dimensions" link sa itaas → #dimensions → buksan ang tab
  useEffect(() => {
    function onHash() {
      if (window.location.hash === "#dimensions") setTab("dimensions");
    }
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    // MOCKUP 2026-09-04: linen na kahon na may border, tab bar sa kaliwa na may
    // gold na underline, uppercase na maliliit na heading sa bawat pane.
    <section id="dimensions" className="bg-linen border border-sand mt-14 scroll-mt-40">
      <div className="flex gap-1 border-b border-sand px-5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap px-4 py-[18px] text-sm border-b-2 -mb-px transition-colors ${
              tab === t.id ? "border-goldDeep text-ink font-semibold" : "border-transparent text-stone hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-5 py-6 md:px-9 md:py-8 text-sm text-stone leading-relaxed [&_h3]:text-[13px] [&_h3]:font-bold [&_h3]:tracking-[0.12em] [&_h3]:uppercase [&_h3]:text-ink [&_h3]:mb-3">
        {tab === "description" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-9">
            <div>
              <h3>Description</h3>
              <p className="max-w-[56ch] leading-[1.65] whitespace-pre-line">{product.description}</p>
            </div>
            <div>
              <h3>Features</h3>
              <ul className="list-disc pl-[18px] leading-[1.8]">
                {product.colors.length > 0 && <li>Upholstered in {product.colors.length === 1 ? product.colors[0] : `${product.colors.length} colors — ${product.colors.slice(0, 3).join(", ")}${product.colors.length > 3 ? "…" : ""}`}</li>}
                {product.materials && <li>{product.materials.split(/[;\n]/)[0].trim()}</li>}
                <li>{(product.stock ?? 0) > 0 ? "Ready unit — ships within the week" : "Made to order in our San Pedro, Laguna workshop · 4–6 weeks"}</li>
                <li>Delivered and set up by our own team, nationwide</li>
                <li>6-month warranty on frame, foam and workmanship</li>
              </ul>
            </div>
          </div>
        )}

        {tab === "dimensions" && <DimensionsPanel product={product} mto={mto} />}

        {tab === "care" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-9">
            <div>
              <h3>Materials</h3>
              <p className="max-w-[56ch] leading-[1.65] whitespace-pre-line">{product.materials}</p>
            </div>
            <div>
              <h3>Care</h3>
              <p className="max-w-[56ch] leading-[1.65] whitespace-pre-line">{product.care}</p>
            </div>
          </div>
        )}

        {tab === "shipping" && (
          <div className="grid md:grid-cols-3 gap-9">
            {(["shipping", "guarantee", "warranty"] as const).map((k) => {
              const c = tabs[k];
              if (!c) return null;
              return (
                <div key={k}>
                  <h3 className="flex items-center gap-3">{ICONS[k]}{c.title}</h3>
                  {c.heading && <p className="font-bold text-ink">{c.heading}</p>}
                  {c.body && <p className={c.heading ? "mt-2" : ""}>{rich(c.body)}</p>}
                  {c.note && <p className="mt-2">{rich(c.note)}</p>}
                  {c.note2 && <p className="mt-2 italic">{rich(c.note2)}</p>}
                  {c.heading2 && <p className="font-bold text-ink mt-3">{c.heading2}</p>}
                  {c.body2 && <p className="mt-2">{rich(c.body2)}</p>}
                  {c.linkLabel && c.linkHref && (
                    <a href={c.linkHref} className="inline-block mt-4 text-xs font-bold uppercase tracking-widest2 border-b border-ink pb-0.5 text-ink hover:text-cognac hover:border-cognac">{c.linkLabel}</a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
