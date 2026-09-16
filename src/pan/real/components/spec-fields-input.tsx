"use client";

// GUIDED SPECS INPUT (2026-08-18) — parehong grouped-cards UI ng Customized
// builder (line-items-editor) para sa ibang forms (hal. Add Product): pumili
// ng category → lalabas ang eksaktong field list ng team (steppers, unit
// chips, choice chips, AS-IS na sukat), text mode lang kapag hindi ma-parse ang na-save; may live
// preview. Ang output ay ang parehong specs string (isang linya kada detalye)
// na pinapasok sa hidden <input name="specs">.

import { useEffect, useRef, useState } from "react";
import {
  BED_DEFAULT,
  BedOptionsPanel,
  MATTRESS_MODELS,
  MattressPanel,
  SPEC_FIELDS,
  composeBedSpecs,
  composeMatSpecs,
  parseMatState,
  matPrice,
  composeSpecs,
  fmtHalf,
  collectionRank,
  isNoLeatherCategory,
  parseHalfStr,
  sortCollections,
  type BedState,
  type MatState,
  type SpecField,
  type SpecRowVal,
} from "./line-items-editor";
import { loadSwatches, type WebSwatch } from "@/app/website/actions";
import { imageUrl } from "./website/util";
import { MultiImageUpload } from "./multi-image-upload";
import type { ColorVariant } from "@/lib/color-variants";
import { parseBuildSpecs } from "@/lib/build-specs";
import { parseBedSpecs } from "@/lib/bed-specs";

const inp =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

function defsFor(category: string): SpecField[] | undefined {
  return SPEC_FIELDS[category];
}
const isBedCat = (c: string) => c === "Promo Bed" || c === "Custom Bed";
const seedBed = (c: string): BedState => ({ ...BED_DEFAULT, btype: c === "Custom Bed" ? "Custom" : "Promo" });

// SPECS STRING → ROWS (para sa Edit): baliktad ng composeSpecs. Bawat linyang
// "Label: value" ay ibinabalik sa tamang field — numero + unit, chips pagkatapos
// ng " — ", choice chips. Null kapag may linyang hindi tugma sa template
// (para text mode na lang — walang data na mawawala).
// Isang linya → tamang row; false kapag hindi tugma sa template.
function applySpecLine(defs: SpecField[], rows: SpecRowVal[], ln: string): boolean {
  const m = /^([^:]+):\s*(.+)$/.exec(ln);
  if (!m) return false;
  const idx = defs.findIndex((f) => f.label.toLowerCase() === m[1].trim().toLowerCase());
  if (idx < 0) return false;
  const f = defs[idx];
  const row = rows[idx];
  let val = m[2].trim();
  if (f.type === "choice") {
    // Ang chip labels ay maaaring may " — " sa loob (hal. Seater) — buong
    // string ang itinutugma, comma ang paghihiwalay ng multi-select.
    const opts = val.split(/,\s*/).map((s) => s.trim());
    const full = opts.map((o) => (f.chips ?? []).find((c) => c === o || c.split(" — ")[0] === o));
    if (full.some((c) => !c)) return false;
    row.opts = full as string[];
    return true;
  }
  if (f.chips) {
    const dash = val.split(/\s+—\s+/);
    if (dash.length > 1) {
      const opts = dash[1].split(/,\s*/).map((s) => s.trim());
      if (opts.some((o) => !f.chips!.includes(o))) return false;
      row.opts = opts;
      val = dash[0].trim();
    }
  }
  if (f.type === "num") {
    // Tumatanggap ng "34.5", "3 ½", at "3 1/2" — laging naka-normalize sa
    // fraction display (2026-08-19).
    const nm = /^([\d.]+(?:\s*(?:½|1\/2))?|½)\s*(inches|cm|ft|in)?\.?$/.exec(val);
    if (!nm) return false;
    const n = parseHalfStr(nm[1]);
    if (!Number.isFinite(n)) return false;
    row.value = fmtHalf(n);
    const u = nm[2] === "in" ? "inches" : nm[2];
    row.unit = u && (f.units ?? []).includes(u) ? u : (f.units ? f.units[0] : "");
    if (nm[2] && !u) return false;
  } else {
    row.value = val;
  }
  return true;
}
const seedRows = (defs: SpecField[]): SpecRowVal[] =>
  defs.map((f) => ({ label: f.label, value: "", unit: f.units ? f.units[0] : "", opts: undefined }));

// STRICT (para sa Edit form): null kapag may kahit isang linyang hindi tugma —
// text mode na lang para walang data na mawala sa pag-save.
function parseSpecsToRows(defs: SpecField[], text: string): SpecRowVal[] | null {
  const rows = seedRows(defs);
  for (const ln of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (!applySpecLine(defs, rows, ln)) return null;
  }
  return rows;
}

// LOOSE (para sa read-only view): ang tugma ay pumapasok sa guided rows, ang
// hindi (hal. lumang description lines) ay hiwalay na "Other details" card —
// hindi nasisira ang buong format dahil sa isang extra line.
function parseSpecsLoose(defs: SpecField[], text: string): { rows: SpecRowVal[]; extras: string[] } {
  const rows = seedRows(defs);
  const extras: string[] = [];
  for (const ln of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const clean = ln.replace(/^[•·\-\s]+/, "");
    if (!applySpecLine(defs, rows, clean)) extras.push(clean);
  }
  return { rows, extras };
}

// READ-ONLY na bersyon ng guided cards (2026-08-18, para sa Add/Edit
// Inventory): EKSAKTONG markup ng editable version — steppers, unit chips,
// chips pills, ✓ column — pero lahat disabled/hindi nagagalaw, para iisa
// ang itsura ng buong category format kahit saan. Fallback sa linya-por-
// linyang card kapag hindi ma-parse (hal. bed/mattress o free-form notes).
// `flat` — IISANG CARD, ang naitala lang (hiling 2026-08-23).
//
// Kapag may template ang category, ipinapakita ang BUONG template: ang Sofa ay
// may limang sukat, kaya lumalabas silang lima kahit isa lang ang naitala —
// apat na "0" na hindi naman sinukat. Tama iyon sa builder (checklist ng dapat
// punan) pero mali sa TALA: tapos na ang QC record, at ang "0" ay
// nagsisinungaling — hindi 0 pulgada ang armrest, hindi lang ito naitala.
//
// Ito ang parehong itsura ng Product Details, na natural na napupunta rito
// dahil ang "Custom Bed" ay walang template.
// FLAT ANG DEFAULT (hiling 2026-08-23): iisang SPECIFICATIONS na card, ang
// naitala lang, kahit anong category - Custom Bed man na walang template o Sofa
// na may lima. Lahat ng tumatawag nito ay read-only na detail view (Orders,
// Operations, My Jobs, QC, Ledger, RMA, Inventory, Upload sheet). Ang template
// na anyo (Measurements/Details, chips, pills) ay ang FORM - SpecFieldsInput -
// at dito ay opt-in na lang: flat={false}.
export function SpecFieldsView({ category, specs, flat = true }: { category: string; specs?: string | null; flat?: boolean }) {
  const s = (specs ?? "").trim();
  if (!s) return null;
  const defs = flat ? undefined : defsFor(category);
  // LOOSE parse: ang tugma sa template ay guided rows; ang sobra (lumang
  // description lines, notes) ay hiwalay na card — pareho pa rin ang format.
  const loose = defs ? parseSpecsLoose(defs, s) : null;
  const parsed = loose && (loose.rows.some((r) => r.value.trim() || (r.opts?.length ?? 0) > 0)) ? loose.rows : null;
  const extras = loose?.extras ?? [];

  const rowShell = (key: string, body: React.ReactNode, chips?: React.ReactNode) => (
    <div key={key} className="border-t border-dashed border-stone-200 py-1 first:border-t-0">
      <div className="flex items-center gap-1.5">{body}</div>
      {chips}
    </div>
  );
  const labelEl = (label: string) => (
    <span className="w-[118px] shrink-0 truncate text-[10.5px] font-semibold leading-tight text-[#3a2e14]" title={label}>{label}</span>
  );
  const checkEl = (filled: boolean) => (
    <span className={`w-4 shrink-0 text-center text-xs ${filled ? "text-emerald-600" : "text-stone-300"}`}>{filled ? "✓" : "•"}</span>
  );
  // READ-ONLY number row (pinasimple 2026-08-19): isang value box + dark unit
  // chip lang — ang −/+ na nested flex-stretch ay nagpapatong sa lumang
  // Android WebView (APK); walang silbi ang stepper sa read-only view.
  const numEl = (r: SpecRowVal) => (
    <>
      <span className="flex h-9 min-w-0 flex-1 items-center justify-center rounded-lg border border-border bg-surface px-3 text-center text-sm font-bold tabular-nums">{r.value || "0"}</span>
      {r.unit && (
        <span className="flex h-9 shrink-0 items-center rounded-lg bg-[#4a3b1a] px-2.5 text-[10.5px] font-extrabold text-[#f4ead8]">
          {r.unit === "inches" ? "in" : r.unit}
        </span>
      )}
    </>
  );
  const pillEl = (c: string, on: boolean) => (
    <span key={c} className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${on ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-surface text-muted"}`}>
      {c.split(" — ")[0]}{on ? " ✓" : ""}
    </span>
  );
  const textEl = (value: string) => (
    <span className="flex h-9 w-full min-w-0 flex-1 items-center rounded-lg border border-border bg-surface px-3 text-xs">{value}</span>
  );
  const cardEl = (n: string, t: string, count: string, body: React.ReactNode[]) => (body.length === 0 ? null : (
    <div key={t} className="mt-2 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-[#faf5e9] px-2.5 py-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#4a3b1a] text-[9px] font-extrabold text-[#f4ead8]">{n}</span>
        <span className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#5a4718]">{t}</span>
        <span className="ml-auto text-[10px] font-bold tabular-nums text-[#8a6a1f]">{count}</span>
      </div>
      <div className="px-2.5 pb-1">{body}</div>
    </div>
  ));

  let content: React.ReactNode;
  if (parsed && defs) {
    const entries = parsed.map((r) => ({ r, def: defs.find((f) => f.label === r.label) }));
    const isMeas = (e: (typeof entries)[number]) => e.def?.type === "num" && !e.def?.chips;
    const filledOf = (list: typeof entries) => list.filter(({ r }) => r.value.trim() || (r.opts?.length ?? 0) > 0).length;
    const renderRow = ({ r, def }: (typeof entries)[number]) => {
      const filled = !!r.value.trim() || (r.opts?.length ?? 0) > 0;
      if (def?.fixed) {
        return rowShell(r.label, <>
          {labelEl(r.label)}
          <span className="flex h-9 min-w-0 flex-1 items-center rounded-lg border border-dashed border-[#caa45a] bg-[#faf5e9] px-3 text-sm font-bold text-[#3a2e14]">
            {r.value}{r.unit ? ` ${r.unit === "inches" ? "in" : r.unit}` : ""}
            <span className="ml-auto text-[9px] font-extrabold uppercase tracking-[0.1em] text-[#8a6a1f]">as-is</span>
          </span>
          {checkEl(filled)}
        </>);
      }
      if (def?.type === "num") {
        return rowShell(r.label, <>
          {labelEl(r.label)}
          {numEl(r)}
          {checkEl(filled)}
        </>, def.chips ? (
          <div className="mt-1 flex flex-wrap gap-1 pl-[124px]">
            {def.chips.map((c) => pillEl(c, (r.opts ?? []).includes(c)))}
          </div>
        ) : undefined);
      }
      if (def?.type === "choice") {
        return rowShell(r.label, <>
          {labelEl(r.label)}
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {(def.chips ?? []).map((c) => pillEl(c, (r.opts ?? []).includes(c)))}
          </span>
          {checkEl(filled)}
        </>);
      }
      return rowShell(r.label, <>
        {labelEl(r.label)}
        {textEl(r.value)}
        {checkEl(filled)}
      </>);
    };
    const meas = entries.filter(isMeas);
    const dets = entries.filter((e) => !isMeas(e));
    // Ang mga linyang hindi tugma sa template — sariling card, parehong format.
    const extraRows = extras.map((l, i) => {
      const m = /^([^:]+):\s*(.+)$/.exec(l);
      return rowShell(`x${i}`, <>
        {labelEl(m ? m[1] : "Note")}
        {textEl(m ? m[2] : l)}
        {checkEl(true)}
      </>);
    });
    const n3 = 1 + (meas.length ? 1 : 0) + (dets.length ? 1 : 0);
    content = (
      <>
        {cardEl("1", "Measurements", `${filledOf(meas)} / ${meas.length} filled`, meas.map(renderRow))}
        {cardEl(meas.length ? "2" : "1", "Details", `${filledOf(dets)} / ${dets.length} filled`, dets.map(renderRow))}
        {cardEl(String(n3), "Other details", `${extraRows.length} filled`, extraRows)}
      </>
    );
  } else {
    // Ang mga bullet na walang "Label: value" ay dating tinatawag na "Detail 3",
    // "Detail 4" — hindi nagsasabi ng kahit ano. Ang build mismo ang may sabi
    // kung ano ang bawat linya ("Tufted Footboard" → Footboard), kaya iyon ang
    // ginagamit; ang walang matukoy ay ipinapakita nang walang label.
    const specs = parseBuildSpecs("\n" + s);
    // "Sizes: 36x75 ₱16,150 · 48x75 ₱19,400 · …" (mattress) → isang chip kada
    // size na may presyo, hindi isang mahabang linya.
    const sizesEl = (value: string) => (
      <span className="flex min-w-0 flex-1 flex-wrap gap-1 py-1">
        {value.split(/\s*·\s*/).filter(Boolean).map((t) => {
          const [sz, ...rest] = t.trim().split(/\s+/);
          return (
            <span key={t} className="rounded-full border border-[#4a3b1a] bg-[#4a3b1a] px-2.5 py-1 text-[10px] font-bold text-[#f4ead8]">
              {sz}{rest.length > 0 && <span className="ml-1 font-normal opacity-80">{rest.join(" ")}</span>}
            </span>
          );
        })}
      </span>
    );
    content = cardEl("1", "Specifications", `${specs.length} filled`, specs.map((sp, i) =>
      rowShell(`${i}`, <>
        {labelEl(sp.label ?? "")}
        {/^sizes$/i.test(sp.label ?? "") && sp.value.includes("·") ? sizesEl(sp.value) : textEl(sp.value)}
        {checkEl(true)}
      </>),
    ));
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Specifications / Design details</label>
      {content}
    </div>
  );
}

// `mode="order"` — ito ay linya ng ORDER, hindi paggawa ng produkto. Sa
// mattress, ang model ay napagpasyahan na ng piniling produkto at ang tanong ay
// SIZE lang; ipinapasa ito sa MattressPanel. (2026-08-26)
export function SpecFieldsInput({ category, name = "specs", withFabricPicker = false, initialText, onChange, showPreview = true, mode = "catalog", variants, onVariantsChange }: {
  category: string; name?: string; withFabricPicker?: boolean; initialText?: string | null; onChange?: (specs: string) => void; showPreview?: boolean; mode?: "catalog" | "order";
  // COLOR VARIANTS (0231, Add/Edit Product lang): kapag may `variants`, ang
  // library ay MULTI-select - bawat napiling tela ay lumalabas sa ilalim ng
  // picker na may sariling photo strip; ang Fabric row ay listahan ng pangalan.
  variants?: ColorVariant[]; onVariantsChange?: (v: ColorVariant[]) => void;
}) {
  const multiColor = !!variants && !!onVariantsChange;
  const [rows, setRows] = useState<SpecRowVal[] | null>(null);
  // Promo/Custom Bed at Mattress — parehong guided panels ng Customized builder.
  const [bed, setBed] = useState<BedState | null>(null);
  const [mat, setMat] = useState<MatState | null>(null);
  const [text, setText] = useState("");
  // MATTRESS: ang presyo ng product (input name="price" ng form) ay auto mula
  // sa pinakamababang napiling size — starting price; editable pa rin.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mat) return;
    const p = matPrice(mat);
    if (p <= 0) return;
    const el = rootRef.current?.closest("form")?.querySelector<HTMLInputElement>('input[name="price"]');
    if (el) el.value = String(p);
  }, [mat]);
  const lastCat = useRef<string | null>(null);
  // FABRIC LIBRARY — parehong web_swatches ng Customized builder; ang napili
  // ay diretso sa Upholstered Finish (Custom Bed) o Fabric row ng specs.
  const [fabricOpen, setFabricOpen] = useState(false);
  const [fabricQ, setFabricQ] = useState("");
  const [fabricLib, setFabricLib] = useState<WebSwatch[] | null>(null);
  // COLLECTION chips (2026-08-19): ~200 na ang swatches — filter per
  // collection (unang salita ng pangalan; "New Sahara" = dalawang salita).
  const [fabricCol, setFabricCol] = useState("");
  const openFabric = () => {
    setFabricOpen((v) => !v);
    if (fabricLib === null) void loadSwatches().then(setFabricLib).catch(() => setFabricLib([]));
  };
  function pickFabric(nm: string) {
    if (bed) { if (bed.btype === "Custom") setBed((p) => (p ? { ...p, uph: nm } : p)); return; }
    if (multiColor) {
      // Toggle ng kulay; ang Fabric row = lahat ng napili, magkahiwalay ng kuwit.
      const cur = variants ?? [];
      const on = cur.some((v) => v.name === nm);
      const lib = (fabricLib ?? []).find((l) => l.name === nm);
      const next = on ? cur.filter((v) => v.name !== nm) : [...cur, { name: nm, images: [], ...(lib?.swatch ? { swatch: String(lib.swatch) } : {}), ...(lib?.color ? { color: String(lib.color) } : {}) }];
      onVariantsChange!(next);
      nm = next.map((v) => v.name).join(", ");
    }
    if (rows) {
      const idx = rows.findIndex((r) => /fabric|upholstered/i.test(r.label));
      if (idx >= 0) { upd(idx, { value: nm }); return; }
    }
    // Text mode: palitan ang umiiral na Fabric line, o idagdag sa dulo.
    setText((t) => (/^(Fabric|Upholstered Finish):/m.test(t)
      ? t.replace(/^(Fabric|Upholstered Finish):.*$/m, `$1: ${nm}`)
      : (t.trim() ? t + "\n" : "") + `Fabric: ${nm}`));
  }

  // Pagpalit ng category: i-seed ang tamang guided mode ng bagong template.
  // EDIT mode (may initialText): magsimula sa text para hindi mabura ang
  // na-save nang specs; walang "Edit as text" toggle (sinisira ang anyo, 2026-08-23).
  const firstRun = useRef(true);
  useEffect(() => {
    if (lastCat.current === category) return;
    lastCat.current = category;
    if (firstRun.current) {
      firstRun.current = false;
      if (initialText?.trim()) {
        // GUIDED agad na may laman (hiling 2026-08-18): i-parse ang na-save
        // na specs pabalik sa fields; text mode lang kapag hindi kaya i-parse.
        if (category === "Mattress") {
          const model = /^Model:\s*(.+)$/m.exec(initialText)?.[1]?.trim();
          if (model && MATTRESS_MODELS.some((x) => x.name === model)) {
            const st = parseMatState(initialText, model);
            // ORDER: LAHAT ng size na ipinagbibili ang nasa specs ng produkto
            // ("Sizes: 36x75 ₱7,250 · 48x75 ₱9,100 · …"), kaya lahat ay naka-tsek
            // pagbukas — na para sa order ay nangangahulugang "lima ang binili".
            // Ang presyo ay pinapanatili (iyon ang tunay, hindi ang naka-hardcode
            // na katalogo); ang PAGPILI ay iniiwang blangko, at ang tindero ang
            // pipili ng isa.
            setMat(mode === "order" ? { ...st, sizes: [] } : st);
            return;
          }
          setText(initialText);
          return;
        }
        // BED (2026-08-23): ibalik ang na-save na specs sa BedOptionsPanel -
        // parehong "guided agad" ng Sofa/Ottoman. Dating text mode lagi ang bed
        // dahil walang kabaligtaran ang composeBedSpecs; text mode pa rin kapag
        // may linyang hindi kilala (null), para walang mawawala.
        if (isBedCat(category)) {
          const parsedBed = parseBedSpecs(initialText, seedBed(category));
          if (parsedBed) { setBed(parsedBed); return; }
        }
        if (!isBedCat(category)) {
          const defs0 = defsFor(category);
          const parsed = defs0 ? parseSpecsToRows(defs0, initialText) : null;
          if (parsed) { setRows(parsed); return; }
        }
        setText(initialText);
        return;
      }
    }
    setRows(null); setBed(null); setMat(null); setText("");
    if (isBedCat(category)) setBed(seedBed(category));
    else if (category === "Mattress") setMat({ model: "", sizes: [] });
    else {
      const defs = defsFor(category);
      if (defs) setRows(defs.map((f) => ({ label: f.label, value: f.def && f.type === "num" ? fmtHalf(parseHalfStr(f.def)) : (f.def ?? ""), unit: f.units ? f.units[0] : "", opts: f.defOpts })));
    }
  }, [category, initialText]);

  const defs = defsFor(category) ?? [];
  const specs = bed ? composeBedSpecs(bed) : mat ? composeMatSpecs(mat) : rows ? composeSpecs(rows) : text;
  // AUTO-BAN (team 2026-08-20): Sofa at Sofa Bed = bawal ang leather — tago
  // ang leather swatches sa picker, may babala kapag leather ang nakalagay.
  const noLeather = isNoLeatherCategory(category);
  const fabricVal = /^(?:Fabric(?:\s*\/\s*Finish)?|Upholstered Finish):\s*(.+)$/m.exec(specs)?.[1]?.trim() ?? "";
  const leatherPicked = noLeather && /leather/i.test(fabricVal);
  const guided = !!(defsFor(category) || isBedCat(category) || category === "Mattress");
  const usingFields = !!(rows || bed || mat);
  // Para sa mga host na state-based (hindi <form>) — hal. QC New Item.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => { onChangeRef.current?.(specs); }, [specs]);

  function upd(ri: number, patch: Partial<SpecRowVal>) {
    setRows((prev) => (prev ? prev.map((r, i) => (i === ri ? { ...r, ...patch } : r)) : prev));
  }

  const entries = (rows ?? []).map((r, ri) => ({ r, ri, def: defs.find((f) => f.label === r.label) }));
  const isMeas = (e: (typeof entries)[number]) => e.def?.type === "num" && !e.def?.chips;
  const meas = entries.filter(isMeas);
  const dets = entries.filter((e) => !isMeas(e));
  const filledOf = (list: typeof entries) => list.filter((e) => e.r.value.trim() || (e.r.opts?.length ?? 0) > 0).length;

  const renderRow = (e: (typeof entries)[number]) => {
    const { r, ri, def } = e;
    const filled = !!r.value.trim() || (r.opts?.length ?? 0) > 0;
    // ±½ na may FRACTION display: 3 → "3 ½" → 4 (2026-08-19).
    const stepNum = (d: number) => {
      const cur = parseHalfStr(r.value);
      const nv = Math.max(0, (Number.isFinite(cur) ? cur : 0) + d);
      upd(ri, { value: nv > 0 ? fmtHalf(nv) : "" });
    };
    return (
      <div key={r.label} className="border-t border-dashed border-stone-200 py-1 first:border-t-0">
        <div className="flex items-center gap-1.5">
          <span className="w-[118px] shrink-0 truncate text-[10.5px] font-semibold leading-tight text-[#3a2e14]" title={r.label}>{r.label}</span>
          {def?.fixed ? (
            <span className="flex h-9 min-w-0 flex-1 items-center rounded-lg border border-dashed border-[#caa45a] bg-[#faf5e9] px-3 text-sm font-bold text-[#3a2e14]">
              {r.value}{r.unit ? ` ${r.unit === "inches" ? "in" : r.unit}` : ""}
              <span className="ml-auto text-[9px] font-extrabold uppercase tracking-[0.1em] text-[#8a6a1f]">as-is</span>
            </span>
          ) : def?.type === "num" ? (
            <>
              <span className="flex min-w-0 flex-1 items-stretch">
                <button type="button" tabIndex={-1} onMouseDown={(ev) => { ev.preventDefault(); stepNum(-0.5); }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-l-lg border border-border bg-cream text-base font-bold text-[#4a3b1a] hover:bg-stone-100">−</button>
                <input
                  type="text"
                  inputMode="decimal"
                  value={r.value}
                  onChange={(ev) => upd(ri, { value: ev.target.value })}
                  onBlur={(ev) => { const n = parseHalfStr(ev.target.value); upd(ri, { value: Number.isFinite(n) && n > 0 ? fmtHalf(n) : "" }); }}
                  placeholder="0"
                  // min-w-[5.5rem] — sa makikitid na panel (hal. Create Order
                  // preview) huwag hayaang mag-collapse ang value box.
                  className="h-9 w-full min-w-[5.5rem] border-y border-border bg-surface text-center text-sm font-bold tabular-nums outline-none focus:border-primary"
                />
                <button type="button" tabIndex={-1} onMouseDown={(ev) => { ev.preventDefault(); stepNum(0.5); }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-r-lg border border-border bg-cream text-base font-bold text-[#4a3b1a] hover:bg-stone-100">+</button>
              </span>
              <span className="flex shrink-0 overflow-hidden rounded-lg border border-border">
                {(def.units ?? []).map((u, ui) => (
                  <button key={u} type="button" tabIndex={-1} onMouseDown={(ev) => { ev.preventDefault(); upd(ri, { unit: u }); }} className={`px-2.5 py-2 text-[10.5px] font-extrabold ${ui > 0 ? "border-l border-border" : ""} ${r.unit === u ? "bg-[#4a3b1a] text-[#f4ead8]" : "bg-surface text-muted hover:bg-stone-100"}`}>
                    {u === "inches" ? "in" : u}
                  </button>
                ))}
              </span>
            </>
          ) : def?.type === "choice" ? (
            <div className="flex min-w-0 flex-1 flex-wrap gap-1">
              {(def.chips ?? []).map((c) => {
                const on = (r.opts ?? []).includes(c);
                return (
                  <button key={c} type="button" tabIndex={-1} onMouseDown={(ev) => {
                    ev.preventDefault();
                    upd(ri, { opts: def.single ? (on ? [] : [c]) : (on ? (r.opts ?? []).filter((x) => x !== c) : [...(r.opts ?? []), c]) });
                  }} className={`rounded-full border px-2.5 py-1.5 text-[10px] font-bold ${on ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-surface text-muted hover:bg-stone-100"}`}>
                    {c.split(" — ")[0]}{on ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          ) : (
            <input
              value={r.value}
              onChange={(ev) => upd(ri, { value: ev.target.value })}
              placeholder={def?.ph ?? ""}
              className={`${inp} h-9 w-full min-w-0 flex-1 text-xs`}
            />
          )}
          <span className={`w-4 shrink-0 text-center text-xs ${filled ? "text-emerald-600" : "text-stone-300"}`}>{filled ? "✓" : "•"}</span>
        </div>
        {def?.chips && def.type !== "choice" && (
          <div className="mt-1 flex flex-wrap gap-1 pl-[124px]">
            {def.chips.map((c) => {
              const on = (r.opts ?? []).includes(c);
              return (
                <button key={c} type="button" tabIndex={-1} onMouseDown={(ev) => {
                  ev.preventDefault();
                  const set = new Set(r.opts ?? []);
                  if (on) set.delete(c); else set.add(c);
                  upd(ri, { opts: (def.chips ?? []).filter((x) => set.has(x)) });
                }} className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${on ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-surface text-muted hover:bg-stone-100"}`}>
                  {c}{on ? " ✓" : ""}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const cardEl = (n: string, t: string, list: typeof entries) => (list.length === 0 ? null : (
    <div key={t} className="mt-2 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-[#faf5e9] px-2.5 py-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#4a3b1a] text-[9px] font-extrabold text-[#f4ead8]">{n}</span>
        <span className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#5a4718]">{t}</span>
        <span className="ml-auto text-[10px] font-bold tabular-nums text-[#8a6a1f]">{filledOf(list)} / {list.length} filled</span>
      </div>
      <div className="px-2.5 pb-1">{list.map(renderRow)}</div>
    </div>
  ));

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5 sm:col-span-2">
      {/* Ang specs string mismo ang sumasama sa form payload */}
      <input type="hidden" name={name} value={specs} />
      {/* Fabric library picker — pareho ng Customized builder; wala sa Promo
          Bed (Beige/Gray chips lang) at Mattress. */}
      {withFabricPicker && !(bed && bed.btype === "Promo") && !mat && (
        <div>
          <button type="button" onMouseDown={(e) => { e.preventDefault(); openFabric(); }} className="flex w-full items-center justify-between rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-stone-50">
            <span className="font-semibold">+ Pick fabric from library{noLeather ? " (no leather)" : ""}</span>
            <span className="text-muted">{fabricOpen ? "▲" : "▼"}</span>
          </button>
          {leatherPicked && <p className="mt-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10.5px] font-semibold text-rose-700">Leather is not allowed for {category} — pick a non-leather fabric.</p>}
          {fabricOpen && (
            <div className="mt-1 rounded-md border border-border p-2">
              <input value={fabricQ} onChange={(e) => setFabricQ(e.target.value)} placeholder="Search color or material…" className={`${inp} mb-2 w-full text-xs`} />
              {/* COLLECTION chips — mabilis na filter kapag marami ang library */}
              {fabricLib !== null && fabricLib.length > 12 && (() => {
                const colOf = (n: string) => { const w = n.trim().split(/\s+/); return w[0]?.toLowerCase() === "new" && w[1] ? `${w[0]} ${w[1]}` : (w[0] ?? ""); };
                const cols = sortCollections([...new Set(fabricLib.filter((l) => (l.swatch || l.color) && !(noLeather && /leather/i.test(l.name))).map((l) => colOf(l.name)))]);
                if (cols.length < 2) return null;
                return (
                  <div className="mb-2 flex gap-1 overflow-x-auto pf-scroll pb-1">
                    <button type="button" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); setFabricCol(""); }} className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${!fabricCol ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-surface text-muted hover:bg-stone-100"}`}>All</button>
                    {cols.map((c) => (
                      <button key={c} type="button" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); setFabricCol(fabricCol === c ? "" : c); }} className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold capitalize ${fabricCol === c ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8]" : "border-border bg-surface text-muted hover:bg-stone-100"}`}>{c}</button>
                    ))}
                  </div>
                );
              })()}
              {fabricLib === null ? (
                <p className="px-2 py-3 text-xs text-muted">Loading swatches…</p>
              ) : (
                <div className="flex max-h-52 flex-wrap content-start gap-1.5 overflow-auto pf-scroll">
                  {/* CARD-GRID (2026-08-20, gaya ng website mock): fixed-width
                      na white cards — tile sa taas, pangalan sa ilalim. */}
                  {fabricLib
                    .filter((l) => (l.swatch || l.color) && !(noLeather && /leather/i.test(l.name)))
                    .filter((l) => {
                      if (fabricCol) {
                        const w = l.name.trim().split(/\s+/);
                        const col = w[0]?.toLowerCase() === "new" && w[1] ? `${w[0]} ${w[1]}` : (w[0] ?? "");
                        if (col !== fabricCol) return false;
                      }
                      const t = fabricQ.trim().toLowerCase();
                      return !t || l.name.toLowerCase().includes(t) || String(l.material ?? "").toLowerCase().includes(t);
                    })
                    // Collection order muna (Leather → Tanya → …), tapos pangalan.
                    .sort((a, b) => {
                      const w = (n: string) => { const p = n.trim().split(/\s+/); return p[0]?.toLowerCase() === "new" && p[1] ? `${p[0]} ${p[1]}` : (p[0] ?? ""); };
                      return collectionRank(w(a.name)) - collectionRank(w(b.name)) || a.name.localeCompare(b.name, undefined, { numeric: true });
                    })
                    .map((l) => {
                      const on = multiColor ? (variants ?? []).some((v) => v.name === l.name) : specs.includes(l.name);
                      return (
                        <button
                          key={l.name}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); pickFabric(l.name); if (!multiColor) setFabricOpen(false); }}
                          className={`w-[92px] flex-none overflow-hidden rounded-md bg-surface text-center ${on ? "border-2 border-primary shadow-[0_0_0_2px_rgba(184,115,51,0.22)]" : "border border-border hover:border-primary"}`}
                          title={l.name}
                        >
                          {/* Color-only na seed (walang photo pa): kulay na tile ang tile. */}
                          {l.swatch ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={imageUrl(String(l.swatch))} alt={l.name} className="h-9 w-full object-cover" />
                          ) : (
                            <span className="block h-9 w-full" style={{ backgroundColor: String(l.color ?? "#ddd") }} />
                          )}
                          <span className={`block truncate px-1 py-0.5 text-[9px] leading-tight ${on ? "font-bold text-foreground" : "text-muted"}`}>{l.name}{on ? " ✓" : ""}</span>
                        </button>
                      );
                    })}
                  {fabricLib.filter((l) => l.swatch || l.color).length === 0 && (
                    <p className="w-full px-2 py-3 text-xs text-muted">No swatches in the library yet.</p>
                  )}
                </div>
              )}
            </div>
          )}
          {/* COLOR VARIANTS (0231): bawat napiling kulay = sariling photo strip.
              Unang litrato = hero ng kulay sa site; walang litrato = ang
              pangkalahatang product photos ang gallery ng kulay na iyon. */}
          {multiColor && (variants ?? []).length > 0 && (
            <div className="mt-2 space-y-2">
              {(variants ?? []).map((v) => (
                <div key={v.name} className="rounded-lg border border-border bg-surface p-2">
                  <div className="mb-1.5 flex items-center gap-2">
                    {v.swatch ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageUrl(v.swatch)} alt={v.name} className="h-6 w-6 shrink-0 rounded border border-border object-cover" />
                    ) : (
                      <span className="h-6 w-6 shrink-0 rounded border border-border" style={{ backgroundColor: v.color ?? "#ddd" }} />
                    )}
                    <span className="flex-1 truncate text-xs font-bold">{v.name}</span>
                    <span className="text-[10px] text-muted">{v.images.length} photo{v.images.length === 1 ? "" : "s"}</span>
                    <button type="button" onClick={() => onVariantsChange!((variants ?? []).filter((x) => x.name !== v.name))} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold text-rose-600 hover:bg-rose-50">Remove</button>
                  </div>
                  <MultiImageUpload value={v.images} onChange={(urls) => onVariantsChange!((variants ?? []).map((x) => (x.name === v.name ? { ...x, images: urls } : x)))} camera folder="products" />
                </div>
              ))}
              <p className="text-[10px] text-muted">Photos of the product in each color. The first photo is the hero on the site; the site gallery switches to these when the color is picked.</p>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Specifications / Design details</label>
        {rows && (
          <span className="text-[10px] font-bold tabular-nums text-muted">
            {rows.filter((r) => r.value.trim() || (r.opts?.length ?? 0) > 0).length} / {rows.length}
          </span>
        )}
      </div>
      {bed ? (
        <BedOptionsPanel b={bed} upd={(p) => setBed((prev) => (prev ? { ...prev, ...p } : prev))} />
      ) : mat ? (
        <MattressPanel
          s={mat}
          mode={mode}
          onModel={(m) => setMat({ model: m, sizes: [] })}
          onSize={(sz) => setMat((prev) => (prev
            // ORDER: pumapalit, hindi nagdadagdag — isang size kada linya, at
            // ang muling pagpindot ay hindi nag-aalis (laging may size).
            ? mode === "order" ? { ...prev, sizes: [sz] }
            : { ...prev, sizes: prev.sizes.includes(sz) ? prev.sizes.filter((z) => z !== sz) : [...prev.sizes, sz] }
            : prev))}
          onThick={(t) => setMat((prev) => (prev ? { ...prev, thick: t } : prev))}
          onPrice={mode === "order" ? undefined : (sz, p) => setMat((prev) => { if (!prev) return prev; const prices = { ...(prev.prices ?? {}) }; if (p == null) delete prices[sz]; else prices[sz] = p; return { ...prev, prices }; })}
        />
      ) : rows ? (
        <div>
          {cardEl("1", "Measurements", meas)}
          {cardEl(meas.length ? "2" : "1", "Details", dets)}
          <p className="mt-1 text-[10px] text-muted">Blank fields are left off the product.</p>
        </div>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder={"One line per detail, e.g.\nTotal Height: 34 inches\nLegs: 4 inches — Wood\nFabric: Amalia Cerulean"}
          className={`${inp} resize-y`}
        />
      )}
      {showPreview && usingFields && specs.trim() && (
        <div className="mt-1 rounded-lg border border-border bg-[#faf5e9] px-2.5 py-2">
          <p className="mb-1 text-[8.5px] font-extrabold uppercase tracking-[0.14em] text-[#a8842e]">Specifications — will show on product · orders · receipts</p>
          <pre className="whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-[#3a2e14]">{specs}</pre>
        </div>
      )}
    </div>
  );
}
