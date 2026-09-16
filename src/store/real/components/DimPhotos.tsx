"use client";

// DIMENSION PHOTOS — front and side view style (2026-09-04, "front and side view tapos
// ung sukat"): ang mismong litrato ng produkto (harap + gilid) na may manipis
// na guhit na NAKADIKIT sa gilid ng produkto at ang tunay na sukat bilang label.
//
// Paano dumidikit ang guhit: kinukuha ang silhouette ng produkto sa litrato
// (puting background → bounding box ng hindi-puting pixels, sa canvas sa
// browser), tapos ang bawat guhit ay iginuguhit sa gilid ng box na iyon. Ang
// mga bahagyang sukat (seat height, backrest to seat, kapal) ay proportional
// sa total height / lalim para tama ang haba ng guhit.

import Image from "next/image";
import { useSubjectBoxes, type Box } from "@/lib/subject-box";

export type DimRow = { k: string; label: string; value: string };
const num = (v: string) => { const m = /([\d.]+)/.exec(v); if (!m) return 0; const n = Number(m[1]); return /cm/i.test(v) ? n / 2.54 : n; };
const pick = (re: RegExp, pool: DimRow[]) => { const i = pool.findIndex((r) => re.test(r.label)); return i >= 0 ? pool.splice(i, 1)[0] : undefined; };

// Isang guhit na may tick sa dulo at label (walang kahon).
function VLine({ x, y1, y2, label, side }: { x: number; y1: number; y2: number; label: string; side: "left" | "right" }) {
  return (
    <>
      <span className="absolute w-px bg-stone/60" style={{ left: `${x}%`, top: `${y1}%`, height: `${y2 - y1}%` }} />
      <span className="absolute h-px w-1.5 bg-stone/60 -translate-x-1/2" style={{ left: `${x}%`, top: `${y1}%` }} />
      <span className="absolute h-px w-1.5 bg-stone/60 -translate-x-1/2" style={{ left: `${x}%`, top: `${y2}%` }} />
      <span className={`absolute text-[10.5px] text-ink tabular-nums whitespace-nowrap -translate-y-1/2 ${side === "left" ? "-translate-x-full pr-1.5" : "pl-1.5"}`} style={{ left: `${x}%`, top: `${(y1 + y2) / 2}%` }}>{label}</span>
    </>
  );
}
function HLine({ y, x1, x2, label, pos }: { y: number; x1: number; x2: number; label: string; pos: "below" | "above" }) {
  return (
    <>
      <span className="absolute h-px bg-stone/60" style={{ top: `${y}%`, left: `${x1}%`, width: `${x2 - x1}%` }} />
      <span className="absolute w-px h-1.5 bg-stone/60 -translate-y-1/2" style={{ top: `${y}%`, left: `${x1}%` }} />
      <span className="absolute w-px h-1.5 bg-stone/60 -translate-y-1/2" style={{ top: `${y}%`, left: `${x2}%` }} />
      <span className={`absolute text-[10.5px] text-ink tabular-nums whitespace-nowrap -translate-x-1/2 ${pos === "below" ? "pt-1" : "-translate-y-full pb-1"}`} style={{ left: `${(x1 + x2) / 2}%`, top: `${y}%` }}>{label}</span>
    </>
  );
}

function Fig({ src, alt, children }: { src: string; alt: string; children: React.ReactNode }) {
  return (
    <figure className="relative m-0 aspect-square bg-white">
      <Image src={src} alt={alt} fill className="object-contain p-[12%]" sizes="(min-width: 768px) 360px, 100vw" />
      {children}
    </figure>
  );
}

// object-contain p-[12%] → ang litrato ay nasa 12%..88% ng container; ang box ay
// nasa % ng litrato kaya ini-scale dito.
const inset = (box: Box): Box => ({ l: 12 + box.l * 0.76, t: 12 + box.t * 0.76, r: 12 + box.r * 0.76, b: 12 + box.b * 0.76 });
const FULL: Box = { l: 14, t: 14, r: 86, b: 86 };

// Uri ng produkto → aling sukat ang nasa aling gilid (2026-09-04, "pano pag
// table and bed"):
//   seat  — upuan/sofa: harap = taas, lapad, extra; gilid = lalim, seat height,
//           backrest to seat, kapal
//   table — harap = taas (kaliwa), haba/diameter (ibaba); gilid = lapad/lalim (ibaba)
//   bed   — harap (headboard view) = headboard height (kaliwa), lapad (ibaba),
//           base height (kanan); gilid = haba (ibaba), legs (kanan)
export type DimKind = "seat" | "table" | "bed";

export default function DimPhotos({ photos, rows, subject, kind = "seat" }: { photos: string[]; rows: DimRow[]; subject: string; kind?: DimKind }) {
  const pool = rows.filter((r) => num(r.value) > 0);
  let totalH: DimRow | undefined, width: DimRow | undefined, seatH: DimRow | undefined, depth: DimRow | undefined, backSeat: DimRow | undefined, thick: DimRow | undefined, extra: DimRow | undefined;
  if (kind === "table") {
    totalH = pick(/height/i, pool);
    width = pick(/^length$/i, pool) ?? pick(/diameter|end\s*to\s*end/i, pool) ?? pick(/width/i, pool);
    depth = pick(/^width$/i, pool) ?? pick(/depth/i, pool);
    thick = pick(/thick/i, pool);
    extra = pool[0];
  } else if (kind === "bed") {
    totalH = pick(/headboard/i, pool) ?? pick(/height/i, pool);
    width = pick(/width/i, pool);
    depth = pick(/length/i, pool);
    extra = pick(/base|frame/i, pool);
    seatH = pick(/legs?/i, pool);
  } else {
    totalH = pick(/total\s*height|^height$|bar\s*counter\s*height/i, pool);
    // Ang tahasang Width/Length (Product Management, 2026-09-04) ang mauuna;
    // End to End / Seat depth ang panakip kapag wala.
    width = pick(/^width$/i, pool) ?? pick(/end\s*to\s*end|width|diameter/i, pool);
    seatH = pick(/seat\s*height/i, pool);
    depth = pick(/^length$/i, pool) ?? pick(/seat\s*depth|depth/i, pool);
    backSeat = pick(/backrest\s*to\s*seat|armrest\s*height|back\s*cushion/i, pool);
    thick = pick(/thick/i, pool);
    extra = pool[0]; // hal. footrest / base diameter - sa harap, kanan
  }

  // HARAP vs GILID (2026-09-04, "front and side sana"): sinusuri ang lahat ng
  // litrato — ang pinakamalapad na silhouette ang harap, ang pinakamakitid ang
  // gilid (ang side view ng upuan/sofa ay laging mas makitid kaysa harap).
  // Habang nagbabasa pa: 1st = harap, 2nd = gilid.
  const all = photos.slice(0, 6);
  const boxes = useSubjectBoxes(all);
  const aspect = (b: Box | null | undefined) => (b ? (b.r - b.l) / Math.max(1, b.b - b.t) : NaN);
  let fi = 0, si = all.length > 1 ? 1 : -1;
  const known = all.map((_, i) => i).filter((i) => boxes[i]);
  if (known.length >= 2) {
    const widest = known.reduce((m, i) => (aspect(boxes[i]) > aspect(boxes[m]) ? i : m), known[0]);
    const narrowest = known.reduce((m, i) => (aspect(boxes[i]) < aspect(boxes[m]) ? i : m), known[0]);
    // Kama: ang gilid (haba) ang mas malapad kaysa harap (headboard view).
    fi = kind === "bed" ? narrowest : widest; si = kind === "bed" ? widest : narrowest;
    // Kung halos pareho ang lapad (walang tunay na side shot), 2nd photo na lang.
    if (si === fi || aspect(boxes[widest]) / aspect(boxes[narrowest]) < 1.12) si = all.length > 1 ? (fi === 0 ? 1 : 0) : -1;
  }
  const box1 = boxes[fi] ?? null, box2 = si >= 0 ? boxes[si] ?? null : null;
  const f = box1 ? inset(box1) : FULL, s = box2 ? inset(box2) : FULL;
  const H = totalH ? num(totalH.value) : Math.max(num(seatH?.value ?? "0"), num(backSeat?.value ?? "0"), 1);
  const frac = (v: string) => Math.min(1, num(v) / (H || 1));
  const hasSide = si >= 0 && !!(depth || backSeat || (kind === "seat" && thick));

  return (
    <div className={`grid gap-3.5 bg-white border border-sand p-4 ${hasSide ? "md:grid-cols-2" : ""}`}>
      <Fig src={all[fi]} alt={`${subject} — front`}>
        {totalH && <VLine x={f.l - 5} y1={f.t} y2={f.b} label={totalH.value} side="left" />}
        {width && <HLine y={f.b + 5} x1={f.l} x2={f.r} label={width.value} pos="below" />}
        {seatH && !hasSide && <VLine x={f.r + 5} y1={f.b - (f.b - f.t) * frac(seatH.value)} y2={f.b} label={seatH.value} side="right" />}
        {(hasSide ? extra ?? undefined : undefined) && <VLine x={f.r + 5} y1={f.b - (f.b - f.t) * frac(extra!.value)} y2={f.b} label={extra!.value} side="right" />}
        {!hasSide && depth && <VLine x={f.r + 12} y1={f.t} y2={f.t + (f.b - f.t) * 0.3} label={`${depth.value} D`} side="right" />}
      </Fig>
      {hasSide && (
        <Fig src={all[si]} alt={`${subject} — side`}>
          {depth && <HLine y={s.b + 5} x1={s.l} x2={s.r} label={depth.value} pos="below" />}
          {seatH && <VLine x={s.r + 5} y1={s.b - (s.b - s.t) * frac(seatH.value)} y2={s.b} label={seatH.value} side="right" />}
          {backSeat && <VLine x={s.l - 5} y1={s.t} y2={s.t + (s.b - s.t) * frac(backSeat.value)} label={backSeat.value} side="left" />}
          {thick && depth && <HLine y={s.t - 5} x1={s.r - (s.r - s.l) * Math.min(0.6, num(thick.value) / num(depth.value))} x2={s.r} label={thick.value} pos="above" />}
          {thick && !depth && <HLine y={s.t - 5} x1={s.r - (s.r - s.l) * 0.25} x2={s.r} label={thick.value} pos="above" />}
        </Fig>
      )}
    </div>
  );
}
