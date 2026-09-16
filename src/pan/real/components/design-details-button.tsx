"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import {
  createDesignDetails, previewDesignDetails, uploadDesignImage, openOrdersForDesign, importDesignDetailsXlsx,
  type DesignDetailsRow, type OpenOrderPick,
} from "@/app/design-details/actions";
import { loadFollowupTargets, type FollowupTarget } from "@/app/orders/fb-followup-actions";
import { DESIGN_NOTE_DEFAULT } from "@/lib/design-details";
import type { DesignLabel, DesignInset } from "@/lib/design-details";
import type { LibSwatch } from "./website/SwatchManager";
import { imageUrl } from "./website/util";

// DESIGN DETAILS BUILDER — spec sheet na ipapadala sa customer para aprubahan.
//
// ANG PINAKA-PUSO: iba-iba ang headboard at ang mga komento bawat order, kaya
// ang mga label ay HINDI naka-fixed sa layout. Mag-type ng label, tapos I-CLICK
// ang parte ng litrato kung saan ito dapat — kahit ilan, kahit saan. Ang click
// ay iniimbak na fraction (0..1) ng litrato para sa renderer.

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const MAX = 50;

// Pangkat ng form — maliit na uppercase na pamagat na may guhit sa itaas, para
// madaling basahin ang mahabang form (kahilingan 2026-08-10: "enhance ang form").
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  // ENTERPRISE band (2026-08-16) — kapareho ng Create Order / Formal Quotation:
  // gold marker + espresso label + hairline, puting card na laman.
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="h-3.5 w-1 rounded-full bg-[#caa45a]" />
        <h4 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#4a3b1a]">{title}</h4>
        <span className="h-px flex-1 bg-gradient-to-r from-[#e6dcc4] to-transparent" />
      </div>
      <div className="rounded-xl border border-[#e6dcc4] bg-white p-4 shadow-sm">{children}</div>
    </div>
  );
}

// Malinaw na upload — ang hubad na <input type=file> ay maliit at madaling
// malampasan ("di masyado kita", 2026-08-10). Malaking dashed na kahon bago
// makapag-upload; kapag may laman na, status chip + Replace/Remove.
function UploadBox({
  label, busy, hasFile, onFile, onClear,
}: {
  label: string;
  busy: boolean;
  hasFile: boolean;
  onFile: (f: File | null) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }}
      />
      {!hasFile ? (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-stone-50 px-4 py-5 text-sm font-semibold text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" />
          </svg>
          {busy ? "Uploading…" : label}
        </button>
      ) : (
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            {busy ? "Uploading…" : "Uploaded"}
          </span>
          <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="font-semibold text-primary underline disabled:opacity-50">
            Replace
          </button>
          <button type="button" onClick={onClear} disabled={busy} className="font-semibold text-danger underline disabled:opacity-50">
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function when(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

// Litrato ng telepono = 8–15MB; ang server action ay may body limit at ang
// storage ay 5MB ang cap — kaya nire-resize muna sa browser (parehong dahilan
// ng components/website/upload.ts). Ibinabalik din ang tunay na sukat: kailangan
// ito ng renderer para tumapat ang mga label.
//
// trim=true (product photo lang): TINATABAS ang puting paligid — ang mga
// product shot ay may malaking puting palibot, kaya ang kama ay lumiliit sa
// gitna ng puting kahon sa sheet. Sa orihinal na sheet nila, halos buong lapad
// ang muwebles mismo. Parehong pag-iingat ng website upload path: tumatabas
// LANG kapag pare-parehong mapusyaw ang apat na sulok (tunay na eksena =
// hindi ginagalaw).
async function compressToDataUrl(file: File, trim = false): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    let sx = 0, sy = 0, sw = w, sh = h;
    if (trim) {
      const { data: d } = ctx.getImageData(0, 0, w, h);
      const corner = (cx: number, cy: number): [number, number, number] => {
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = cy; y < cy + 6 && y < h; y++)
          for (let x = cx; x < cx + 6 && x < w; x++) {
            const i = (y * w + x) * 4;
            r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
          }
        return [r / n, g / n, b / n];
      };
      const corners = [corner(0, 0), corner(w - 6, 0), corner(0, h - 6), corner(w - 6, h - 6)];
      const bg = corners[0];
      const light = corners.every((c) => c[0] > 225 && c[1] > 225 && c[2] > 225);
      const uniform = corners.every((c) => Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) < 36);
      if (light && uniform) {
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 78) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        if (maxX > minX && maxY > minY && (maxX - minX) * (maxY - minY) > 0.02 * w * h) {
          const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.03);
          sx = Math.max(0, minX - pad);
          sy = Math.max(0, minY - pad);
          sw = Math.min(w, maxX + pad) - sx;
          sh = Math.min(h, maxY + pad) - sy;
        }
      }
    }

    if (sx || sy || sw !== w || sh !== h) {
      const out = document.createElement("canvas");
      out.width = sw; out.height = sh;
      const octx = out.getContext("2d");
      if (!octx) return null;
      octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      return { dataUrl: out.toDataURL("image/jpeg", 0.85), w: sw, h: sh };
    }
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.85), w, h };
  } catch {
    return null;
  }
}

export function DesignDetailsButton({
  initial = null,
  openNow = false,
  onClosed,
  swatchLibrary = [],
  hideTrigger = false,
}: {
  // Panimulang laman kapag binuksan mula sa hilera ng listahan — kaya kayang
  // baguhin at muling ipadala ang naunang sheet nang hindi itinataype ulit.
  initial?: DesignDetailsRow | null;
  openNow?: boolean;
  onClosed?: () => void;
  // Ang web_swatches library — para ang tela ay PILIIN na lang, gaya ng
  // Colors/Variants picker sa Website Products (kahilingan 2026-08-09).
  swatchLibrary?: LibSwatch[];
  // Itago ang "Create Design Details" na buton, panatilihin ang builder.
  // Ang component na ito ay hindi lang buton — ito rin ang modal na
  // binubuksan ng Edit sa preview at ng pag-click sa hilera, kaya hindi ito
  // maaaring tanggalin nang buo kahit hindi na kailangan ang buton.
  hideTrigger?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const [customer, setCustomer] = useState("");
  const [address, setAddress] = useState("");
  const [orderNo, setOrderNo] = useState("");
  // RESEND target — id ng DD row na ina-update (null = bagong DD).
  const [resendId, setResendId] = useState<number | null>(null);
  // ORDER PICKER (2026-08-16): dropdown ng mga order na HINDI PA delivered —
  // pagpili, awtomatikong napupunan ang Customer name at Address.
  const [openOrders, setOpenOrders] = useState<OpenOrderPick[] | null>(null);
  const [orderDropOpen, setOrderDropOpen] = useState(false);
  function loadOpenOrdersOnce() {
    if (openOrders !== null) return;
    openOrdersForDesign().then(setOpenOrders).catch(() => setOpenOrders([]));
  }
  const [title, setTitle] = useState("");
  const [bullets, setBullets] = useState("");
  const [mattress, setMattress] = useState("n/a");
  const [headboard, setHeadboard] = useState("");
  const [note, setNote] = useState(DESIGN_NOTE_DEFAULT);

  // Litrato + mga label na naka-click sa ibabaw nito.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoDims, setPhotoDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [labels, setLabels] = useState<DesignLabel[]>([]);
  const [labelText, setLabelText] = useState("");
  // Anyo ng susunod na ilalagay: karaniwang label, o may sukat-arrow (patayo /
  // pahiga) na dumadaan sa likod nito — gaya ng "16 from floor" sa sample.
  const [labelMode, setLabelMode] = useState<"label" | "v" | "h">("label");
  // Numero ng spec na itatali sa susunod na label (0 = wala) — ang parehong
  // pulang numero ay lalabas sa specs list at sa label sa litrato.
  const [labelNum, setLabelNum] = useState(0);
  // IN-PLACE EDIT (2026-08-10): doble-click sa nakalagay nang label = editable
  // mismo sa puwesto — text at spec number, hindi na tinatanggal-at-inuulit.
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editNum, setEditNum] = useState(0);
  // INSET PHOTOS — maliliit na halimbawang litrato (hal. bukas na lift storage)
  // na nakapatong sa main photo, may orange na label (kahilingan 2026-08-10).
  const [insets, setInsets] = useState<DesignInset[]>([]);
  // Inline editor ng inset label — dating window.prompt() na naka-block sa ilang
  // browser/WebView kaya "hindi gumagana" ang edit (naiulat 2026-08-10).
  const [insetEditIdx, setInsetEditIdx] = useState<number | null>(null);
  const [insetEditText, setInsetEditText] = useState("");
  const [uploading, setUploading] = useState<"photo" | "swatch" | "inset" | null>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const photoBoxRef = useRef<HTMLDivElement>(null);
  // Sukat ng photo box sa px — kailangan ng SVG overlay ng mga arrow (ang
  // pahilis na linya ay hindi maayos na naiguguhit sa puro CSS %).
  const [boxDim, setBoxDim] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = photoBoxRef.current;
    if (!el || !photoUrl || !open) return;
    const ro = new ResizeObserver(() => setBoxDim({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [photoUrl, open]);

  // Swatch ng tela.
  const [swatchUrl, setSwatchUrl] = useState<string | null>(null);
  const [swatchLabel, setSwatchLabel] = useState("");
  const [swatchPickerOpen, setSwatchPickerOpen] = useState(false);
  const [swatchQ, setSwatchQ] = useState("");

  // Preview ng mismong SVG na maipapadala.
  const [preview, setPreview] = useState<string | null>(null);

  // Tatanggap — parehong 24h listahan ng quotation / follow-up.
  const [targets, setTargets] = useState<FollowupTarget[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  function loadTargetsOnce() {
    if (loaded) return;
    start(async () => {
      setTargets(await loadFollowupTargets());
      setLoaded(true);
    });
  }

  function reset() {
    setCustomer(""); setAddress(""); setOrderNo(""); setTitle("");
    setBullets(""); setMattress("n/a"); setHeadboard(""); setNote(DESIGN_NOTE_DEFAULT);
    setPhotoUrl(null); setPhotoDims({ w: 0, h: 0 }); setLabels([]); setLabelText(""); setInsets([]);
    setSwatchUrl(null); setSwatchLabel("");
    setPreview(null); setMsg(null); setUrl(null); setDone(false);
    setPicked(new Set()); setQ("");
    setResendId(null);
  }

  // Pagbukas mula sa hilera: punan ang form. Ang `seeded` ay panangga sa muling
  // pagpuno tuwing nagre-render (parehong pattern ng QuotationButton).
  const [seeded, setSeeded] = useState<string | null>(null);
  // IMPORT FROM EXCEL (2026-08-18): ang punong .xlsx template ng team →
  // isang upload, buo na ang buong builder (fields, photos, labels).
  const xlsxRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  async function onXlsxPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setImporting(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await importDesignDetailsXlsx(fd);
      if ("error" in res) { setMsg(res.error); return; }
      if (res.customer) setCustomer(res.customer);
      if (res.address) setAddress(res.address);
      if (res.orderNo) setOrderNo(res.orderNo);
      if (res.title) setTitle(res.title);
      if (res.bullets.length) setBullets(res.bullets.join("\n"));
      if (res.mattress) setMattress(res.mattress);
      if (res.headboard) setHeadboard(res.headboard);
      if (res.note) setNote(res.note);
      if (res.swatchLabel) setSwatchLabel(res.swatchLabel);
      if (res.swatchUrl) setSwatchUrl(res.swatchUrl);
      if (res.photoUrl) { setPhotoUrl(res.photoUrl); if (res.photoW) setPhotoDims({ w: res.photoW, h: res.photoH }); }
      if (res.labels.length) setLabels(res.labels.map((l) => ({ x: l.x, y: l.y, text: l.text, arrow: l.arrow ?? null, len: l.len })));
      setPreview(null);
      setMsg(`Imported: ${res.bullets.length} details, ${res.labels.length} labels${res.photoUrl ? ", photo" : ""}${res.swatchUrl ? ", swatch" : ""} — adjust the label positions, then Preview.`);
    } catch {
      setMsg("Import failed — check the file and try again.");
    } finally { setImporting(false); }
  }
  const initKey = initial ? `${initial.id}` : null;
  useEffect(() => {
    if (!openNow || !initial || seeded === initKey) return;
    setSeeded(initKey);
    // Galing sa hilera (Resend): PAREHONG DD row ang ia-update ng padala —
    // hindi gagawa ng bagong DD # (naiulat 2026-08-17).
    setResendId(initial.id ?? null);
    setCustomer(initial.customer);
    setAddress(initial.address ?? "");
    setOrderNo(initial.orderNumber ?? "");
    setTitle(initial.title);
    setBullets(initial.bullets.join("\n"));
    setMattress(initial.mattress ?? "");
    setHeadboard(initial.headboard ?? "");
    setNote(initial.note ?? DESIGN_NOTE_DEFAULT);
    setPhotoUrl(initial.photoUrl);
    setPhotoDims({ w: initial.photoW, h: initial.photoH });
    setLabels(initial.labels ?? []);
    setInsets(initial.insets ?? []);
    setSwatchUrl(initial.swatchUrl);
    setSwatchLabel(initial.swatchLabel ?? "");
    setLabelText(""); setPreview(null); setMsg(null); setUrl(null); setDone(false);
    setPicked(new Set()); setQ("");
    setOpen(true);
    loadTargetsOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNow, initKey]);

  function close() {
    setOpen(false);
    setSeeded(null);
    onClosed?.();
  }

  async function pickImage(kind: "photo" | "swatch" | "inset", file: File | null) {
    if (!file) return;
    setMsg(null);
    setUploading(kind);
    try {
      // Ang product photo ay tinatabasan ng puting paligid para malaki ang
      // muwebles mismo sa sheet; ang swatch/inset ay hindi (buong eksena).
      const c = await compressToDataUrl(file, kind === "photo");
      if (!c) { setMsg(`${file.name}: could not read that image.`); return; }
      const r = await uploadDesignImage(c.dataUrl);
      if ("error" in r) { setMsg(r.error); return; }
      if (kind === "photo") {
        setPhotoUrl(r.url);
        setPhotoDims({ w: c.w, h: c.h });
        setLabels([]); // ibang litrato = ibang puwesto ng mga label
        setInsets([]);
      } else if (kind === "inset") {
        // Panimulang puwesto: kanang ibaba, ~35% ng lapad — kaladkarin na lang.
        setInsets((prev) => [...prev, { url: r.url, x: 0.72, y: 0.72, w: 0.35, iw: c.w, ih: c.h, text: "" }]);
      } else {
        setSwatchUrl(r.url);
      }
      setPreview(null);
    } catch (e) {
      // Dating WALANG catch — ang biglaang pagkabigo ng server action ay
      // tahimik na nilalamon, walang nakikita ang staff at walang thumbnail,
      // kaya akala nila naka-attach na (naiulat 2026-08-09).
      setMsg(`${file.name}: upload failed — ${e instanceof Error ? e.message : "try again"}.`);
    } finally {
      setUploading(null);
    }
  }

  // ANG CLICK-TO-PLACE: kunin ang fraction ng click sa loob ng litrato.
  // Sa ARROW mode, lumalabas AGAD ang arrow kahit walang text (kahilingan
  // 2026-08-09) — ang label ay maipapatong na lang pagkatapos, o isulat muna
  // bago mag-click para sabay silang lumabas.
  function placeLabel(e: React.MouseEvent<HTMLDivElement>) {
    const t = labelText.trim();
    if (!t && labelMode === "label") {
      setMsg("Type the label text first, then click the photo where it should go.");
      labelInputRef.current?.focus();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setLabels((prev) => [...prev, {
      x, y, text: t,
      ...(labelNum > 0 ? { num: labelNum } : {}),
      // Ang arrow ay iniimbak bilang DALAWANG DULO (fractions) — kaya kayang
      // iikot sa kahit anong hilig sa paghila ng dulo. Ang v/h chip ay ang
      // panimulang tindig lang.
      ...(labelMode === "v" ? { arrow: "v" as const, ax: x, ay: clamp01(y - 0.15), bx: x, by: clamp01(y + 0.15) } : {}),
      ...(labelMode === "h" ? { arrow: "h" as const, ax: clamp01(x - 0.15), ay: y, bx: clamp01(x + 0.15), by: y } : {}),
    }]);
    setLabelText("");
    setMsg(null);
    setPreview(null);
  }

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

  // Ang mga spec (para sa number picker) — hinuhugasan ang nakaunang bullet.
  const specsList = bullets.split("\n").map((b) => b.trim().replace(/^[\s•·▪◦●○*–—-]+\s*/, "")).filter(Boolean);

  // AUTO-PLACE (2026-08-10): bawat spec line ay nagiging numbered label agad.
  // MAY PAKIRAMDAM sa salita ("di sakto" ang dating basta-salansan): ang mga
  // karaniwang termino ng kama ay itinuturo sa tamang REHIYON ng litrato —
  // headboard sa taas, legs sa baba, fabric sa gilid, at ang mga sukat
  // (height-from-floor, width) ay may kasama nang arrow. Tantiya pa rin ito —
  // kaladkad/doble-click ang pinong ayos. Ang spec na hindi kilala ay
  // sumasalansan sa gilid gaya ng dati.
  function autoPlace() {
    // Rehiyon kada termino (fraction ng litrato); una ang mas tiyak na tugma.
    const ZONES: { re: RegExp; x: number; y: number; arrow?: "v" | "h" }[] = [
      { re: /headboard.*(height|\bft\b|feet|taas)/i, x: 0.5, y: 0.09 },
      { re: /wing/i, x: 0.75, y: 0.2 },
      { re: /headboard/i, x: 0.5, y: 0.17 },
      { re: /mattress|insert/i, x: 0.5, y: 0.5 },
      { re: /fabric|tela|velvet|leather|color/i, x: 0.2, y: 0.58 },
      { re: /lift|storage/i, x: 0.6, y: 0.74 },
      { re: /platform|frame|base/i, x: 0.66, y: 0.8 },
      { re: /\blegs?\b|feet|paa/i, x: 0.78, y: 0.9 },
      { re: /floor|height/i, x: 0.09, y: 0.72, arrow: "v" },
      { re: /width|end to end|\d+\s*x\s*\d+|size/i, x: 0.5, y: 0.94, arrow: "h" },
      { re: /^\s*\d*\.?\s*(length|depth|lalim)/i, x: 0.86, y: 0.6, arrow: "h" },
      { re: /design|panel|tufted|vertical|horizontal|banana/i, x: 0.34, y: 0.28 },
    ];
    const existing = new Set(labels.map((l) => Number(l.num)).filter((n) => n > 0));
    const taken: { x: number; y: number }[] = labels.map((l) => ({ x: l.x, y: l.y }));
    const added: DesignLabel[] = [];
    let fallback = 0;
    specsList.forEach((s, i) => {
      const num = i + 1;
      if (existing.has(num)) return;
      const t = s.length > 48 ? s.slice(0, 46).trimEnd() + "…" : s;
      const zone = ZONES.find((z) => z.re.test(s));
      let x: number, y: number;
      if (zone) {
        x = zone.x; y = zone.y;
      } else {
        x = fallback % 2 === 0 ? 0.24 : 0.76;
        y = 0.1 + Math.floor(fallback / 2) * 0.17;
        fallback++;
      }
      // Iwas patong-patong: ibaba nang kaunti hangga't may kalapit.
      let guard = 0;
      while (taken.some((p) => Math.abs(p.x - x) < 0.16 && Math.abs(p.y - y) < 0.07) && guard++ < 12) {
        y = clamp01(y + 0.08);
      }
      taken.push({ x, y });
      added.push({
        x, y: clamp01(y), text: t, num,
        // Ang mga sukat ay may arrow agad: patayo para sa height-from-floor,
        // pahiga para sa width — hilahin na lang ang dulo para itapat.
        ...(zone?.arrow === "v" ? { arrow: "v" as const, ax: x, ay: clamp01(y - 0.16), bx: x, by: clamp01(y + 0.16) } : {}),
        ...(zone?.arrow === "h" ? { arrow: "h" as const, ax: clamp01(x - 0.24), ay: y, bx: clamp01(x + 0.24), by: y } : {}),
      });
    });
    if (!added.length) {
      setMsg("Every spec already has its numbered label.");
      return;
    }
    setLabels((prev) => [...prev, ...added]);
    setMsg(null);
    setPreview(null);
  }

  // Kaladkarin ang inset ("move") o hilahin ang kanto para lakihan/liitan
  // ("size") — parehong delta-mula-snapshot na gawi ng mga label.
  function startInsetDrag(e: React.PointerEvent, i: number, part: "move" | "size") {
    e.preventDefault();
    e.stopPropagation();
    const rect = photoBoxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fx0 = (e.clientX - rect.left) / rect.width;
    const fy0 = (e.clientY - rect.top) / rect.height;
    const snap = insets[i];
    const onMove = (ev: PointerEvent) => {
      const fx = clamp01((ev.clientX - rect.left) / rect.width);
      const fy = clamp01((ev.clientY - rect.top) / rect.height);
      setInsets((prev) => prev.map((ins, k) => {
        if (k !== i) return ins;
        if (part === "move") return { ...ins, x: clamp01(snap.x + fx - fx0), y: clamp01(snap.y + fy - fy0) };
        // size: ang lapad ay dalawang beses ng layo ng cursor mula sa gitna.
        return { ...ins, w: Math.min(0.9, Math.max(0.1, Math.abs(fx - ins.x) * 2)) };
      }));
      setPreview(null);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function saveEdit() {
    if (editIdx === null) return;
    const t = editText.trim();
    setLabels((prev) => prev
      .map((l, k) => (k === editIdx ? { ...l, text: t, num: editNum > 0 ? editNum : undefined } : l))
      // Walang text at walang arrow = wala nang laman — tanggalin na.
      .filter((l) => l.text || arrowPts(l)));
    setEditIdx(null);
    setPreview(null);
  }

  // Mga dulo ng arrow — kasama ang lumang v/h + len na anyo (na-convert sa
  // dalawang dulo) para ma-edit pa rin ang mga naunang naka-imbak na sheet.
  function arrowPts(l: DesignLabel): { ax: number; ay: number; bx: number; by: number } | null {
    if ([l.ax, l.ay, l.bx, l.by].every((n) => typeof n === "number" && isFinite(n as number))) {
      return { ax: l.ax as number, ay: l.ay as number, bx: l.bx as number, by: l.by as number };
    }
    const half = (l.len ?? 0.3) / 2;
    if (l.arrow === "v") return { ax: l.x, ay: clamp01(l.y - half), bx: l.x, by: clamp01(l.y + half) };
    if (l.arrow === "h") return { ax: clamp01(l.x - half), ay: l.y, bx: clamp01(l.x + half), by: l.y };
    return null;
  }

  // KALADKARIN: ang label ay naiisod ("move" — sabay ang arrow), at ang bawat
  // dulo ng arrow ay nahihila KAHIT SAAN — habaan, iksian, o IKUTIN pahilis.
  // Delta mula sa snapshot ang gamit para sabay gumalaw ang label at arrow.
  function startDrag(e: React.PointerEvent, i: number, part: "move" | "tipA" | "tipB") {
    e.preventDefault();
    e.stopPropagation();
    const rect = photoBoxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fx0 = (e.clientX - rect.left) / rect.width;
    const fy0 = (e.clientY - rect.top) / rect.height;
    const snap = { ...labels[i], ...(arrowPts(labels[i]) ?? {}) } as DesignLabel;
    const onMove = (ev: PointerEvent) => {
      const fx = clamp01((ev.clientX - rect.left) / rect.width);
      const fy = clamp01((ev.clientY - rect.top) / rect.height);
      setLabels((prev) => prev.map((l, k) => {
        if (k !== i) return l;
        const pts = arrowPts(snap);
        if (part === "move") {
          const dx = fx - fx0, dy = fy - fy0;
          return {
            ...l,
            x: clamp01(snap.x + dx),
            y: clamp01(snap.y + dy),
            ...(pts ? {
              ax: clamp01(pts.ax + dx), ay: clamp01(pts.ay + dy),
              bx: clamp01(pts.bx + dx), by: clamp01(pts.by + dy),
              len: undefined,
            } : {}),
          };
        }
        if (!pts) return l;
        const next = part === "tipA"
          ? { ...pts, ax: fx, ay: fy }
          : { ...pts, bx: fx, by: fy };
        // Ang label ay sumusunod sa gitna ng arrow habang iniikot/hinahaba.
        return { ...l, ...next, len: undefined, x: (next.ax + next.bx) / 2, y: (next.ay + next.by) / 2 };
      }));
      setPreview(null);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function currentInput() {
    return {
      customerName: customer.trim(),
      address: address.trim() || null,
      orderNumber: orderNo.trim() || null,
      title: title.trim(),
      bullets: bullets.split("\n").map((b) => b.trim()).filter(Boolean),
      photoUrl,
      photoW: photoDims.w,
      photoH: photoDims.h,
      labels,
      insets,
      swatchUrl,
      swatchLabel: swatchLabel.trim() || null,
      mattress: mattress.trim() || null,
      headboard: headboard.trim() || null,
      note: note.trim() || null,
    };
  }

  function showPreview() {
    setMsg(null);
    start(async () => {
      const r = await previewDesignDetails(currentInput());
      if ("error" in r) { setMsg(r.error); return; }
      // btoa ay bumabagsak sa non-Latin1 — encodeURIComponent ang ligtas.
      setPreview(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}`);
    });
  }

  function submit() {
    setMsg(null); setUrl(null);
    start(async () => {
      const r = await createDesignDetails({ ...currentInput(), psids: [...picked], resendId });
      if ("error" in r) { setMsg(r.error); return; }
      setUrl(r.url);
      setPicked(new Set());
      setDone(true);
      router.refresh();
      // Auto-close kapag malinis ang padala — parehong ugali ng quotation:
      // may hilera na sa listahan, at ang naiwang bukas na form ay madaling
      // makapagpadala ng doble. Kapag may pumalya/na-skip, manatiling bukas.
      if (!r.failed && !r.skipped) { close(); return; }
      const parts: string[] = [];
      if (r.ddNumber) parts.push(r.ddNumber);
      if (r.sent) parts.push(`sent to ${r.sent}`);
      if (r.failed) parts.push(`${r.failed} failed`);
      if (r.skipped) parts.push(`${r.skipped} outside the 24h window`);
      setMsg(parts.join(" · "));
    });
  }

  const term = q.trim().toLowerCase();
  const shown = term ? targets.filter((t) => t.name.toLowerCase().includes(term)) : targets;

  function toggle(psid: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(psid)) next.delete(psid);
      else if (next.size < MAX) next.add(psid);
      if (next.size === 1 && !customer.trim()) {
        const only = targets.find((t) => t.psid === [...next][0]);
        if (only) setCustomer(only.name);
      }
      return next;
    });
  }

  return (
    <div className="apk-hide">
      {!hideTrigger && (
      <button
        // LAGING SARIWA sa pagbukas (hiling 2026-08-16): "Create" ang buton —
        // bagong sheet ang gagawin, kaya blangko ang form tuwing pipindutin.
        // (Ang dating draft-preserve na gawi ay pinalitan nito; ang hindi pa
        // naipapadalang draft ay nawawala sa muling pagbukas.)
        onClick={() => { reset(); setOpen(true); loadTargetsOnce(); }}
        title="Build a design details sheet and send it on Messenger for approval"
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-stone-100"
      >
        Create Design Details
      </button>
      )}

      <Modal
        open={open}
        onClose={close}
        title="Design Details"
        description="The spec sheet the customer approves before production starts."
        size="xl"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted">
              {picked.size} selected
              {msg && <span className="ml-3 font-medium text-foreground">{msg}</span>}
              {url && <a href={url} target="_blank" rel="noreferrer" className="ml-2 text-primary underline">View</a>}
            </span>
            <span className="flex gap-2">
              {/* Naka-disable habang may umaakyat na litrato — kung hindi, ang
                  padala habang nag-a-upload ay lalabas na walang larawan. */}
              <button onClick={showPreview} disabled={pending || !!uploading} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-stone-100 disabled:opacity-50">
                Preview
              </button>
              <button onClick={close} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-stone-100">Close</button>
              <button
                onClick={submit}
                disabled={pending || done || !!uploading || !customer.trim() || !title.trim()}
                className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Working…" : uploading ? "Uploading…" : done ? "Done" : picked.size ? `Create & send to ${picked.size}` : "Create design details"}
              </button>
            </span>
          </div>
        }
      >
        {/* IMPORT FROM EXCEL — ang punong Design-Details-Template (.xlsx) ng
            team: isang upload at buo na ang builder; aayusin na lang ang mga
            label position at arrows bago i-send. */}
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-dashed border-[#caa45a] bg-[#faf5e9] px-3 py-2">
          <span className="rounded border border-[#caa45a] bg-white px-1 text-[8px] font-extrabold uppercase text-[#8a6a1f]">Excel</span>
          <span className="text-xs text-[#7a5c14]">Filled the Excel template? Import it — fields, photos, and labels load in one go.</span>
          <button type="button" onClick={() => xlsxRef.current?.click()} disabled={importing} className="ml-auto shrink-0 rounded-lg bg-[#4a3b1a] px-3 py-1.5 text-xs font-bold text-[#f4ead8] hover:opacity-90 disabled:opacity-50">
            {importing ? "Importing…" : "Import from Excel"}
          </button>
          <input ref={xlsxRef} type="file" accept=".xlsx" onChange={onXlsxPicked} className="hidden" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Customer name *</span>
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer name" className={`${inp} w-full`} />
          </label>
          <label className="relative block">
            <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Order number</span>
            <input
              value={orderNo}
              onChange={(e) => { setOrderNo(e.target.value); setOrderDropOpen(true); }}
              onFocus={() => { loadOpenOrdersOnce(); setOrderDropOpen(true); }}
              onBlur={() => setTimeout(() => setOrderDropOpen(false), 150)}
              placeholder="Optional — pick an in-progress order"
              className={`${inp} w-full`}
            />
            {orderDropOpen && (
              <ul className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
                {openOrders === null ? (
                  <li className="px-3 py-3 text-xs text-muted">Loading orders…</li>
                ) : (() => {
                  const q = orderNo.trim().toLowerCase();
                  const shown = openOrders.filter((o) => !q
                    || o.orderNumber.toLowerCase().includes(q)
                    || o.customer.toLowerCase().includes(q)).slice(0, 12);
                  if (shown.length === 0) return <li className="px-3 py-3 text-xs text-muted">No in-progress orders match.</li>;
                  return shown.map((o) => (
                    <li key={o.orderNumber}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          // AUTOFILL: order # + pangalan + address mula sa order.
                          setOrderNo(o.orderNumber);
                          if (o.customer) setCustomer(o.customer);
                          if (o.address) setAddress(o.address);
                          setOrderDropOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#faf6ec]"
                      >
                        <span className="shrink-0 font-mono text-xs font-bold text-[#8a6a1f]">{o.orderNumber}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{o.customer || "—"}</span>
                      </button>
                    </li>
                  ));
                })()}
              </ul>
            )}
          </label>
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Address</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" className={`${inp} w-full`} />
        </label>

        <Section title="Design">
          <label className="block">
            <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Design title *</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="PROMO BED: FULL DOUBLE SIZE 54X75" className={`${inp} w-full`} />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Specs — one per line (numbered on the sheet)</span>
            <textarea
              value={bullets}
              onChange={(e) => setBullets(e.target.value)}
              rows={4}
              placeholder={"Headboard Height: 4ft from floor\nStandard Wood Legs (4”)\nFabric: Promo Beige\nDesign: Banana/Vertical"}
              className={`${inp} w-full font-mono text-xs`}
            />
          </label>
        </Section>

        {/* ── LITRATO + CLICK-TO-PLACE LABELS ────────────────────────────────── */}
        {/* NAUUNA ang product photo — ito ang pangunahing laman; nauna dati ang
            swatch at doon naiupload ang kama (DD-000001, 2026-08-09). */}
        <Section title="Product photo & labels">
          <UploadBox
            label="Upload product photo"
            busy={uploading === "photo"}
            hasFile={!!photoUrl}
            onFile={(f) => pickImage("photo", f)}
            onClear={() => { setPhotoUrl(null); setPhotoDims({ w: 0, h: 0 }); setLabels([]); setPreview(null); }}
          />

          {photoUrl && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  ref={labelInputRef}
                  value={labelText}
                  onChange={(e) => setLabelText(e.target.value)}
                  placeholder={'Label text — e.g. Mattress Insert: 2"'}
                  className={`${inp} min-w-40 flex-1`}
                />
                {/* Anyo ng ilalagay: label lang, o may dilaw na sukat-arrow. */}
                {([["label", "Label"], ["v", "↕ Arrow"], ["h", "↔ Arrow"]] as const).map(([m, cap]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setLabelMode(m)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${labelMode === m ? "border-primary bg-primary text-white" : "border-border bg-surface hover:bg-stone-100"}`}
                  >
                    {cap}
                  </button>
                ))}
                {/* Numero ng spec na itatali — ang parehong pulang numero sa
                    specs list ang lalabas sa label (enterprise template). */}
                <select
                  value={labelNum}
                  onChange={(e) => setLabelNum(Number(e.target.value))}
                  title="Link this label to a numbered spec"
                  className={`${inp} max-w-44`}
                >
                  <option value={0}>No spec #</option>
                  {specsList.map((s, i) => (
                    <option key={i} value={i + 1}>{i + 1} — {s.slice(0, 26)}{s.length > 26 ? "…" : ""}</option>
                  ))}
                </select>
                {specsList.length > 0 && (
                  <button
                    type="button"
                    onClick={autoPlace}
                    title="Place a numbered label for every spec at once — drag each one to its spot after"
                    className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold hover:bg-stone-100"
                  >
                    Auto-place specs
                  </button>
                )}
                <span className="text-[11px] text-muted">then click the photo where it goes</span>
              </div>
              <div
                ref={photoBoxRef}
                onClick={placeLabel}
                className="relative mt-2 block w-full cursor-crosshair select-none"
                title="Click to place the label"
              >
                {/* FULL WIDTH ang litrato dito — mas madaling tumpakan ang mga
                    label (kahilingan 2026-08-09); fraction ang koordinata kaya
                    tama pa rin anuman ang laki ng pagpapakita. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="product" className="w-full rounded border border-border" draggable={false} />
                {/* ── INSET PHOTOS — kaladkarin para iisod; hilahin ang puting
                    kanto para lakihan/liitan; doble-click ang orange na label
                    para palitan ang teksto; × para tanggalin. ── */}
                {insets.map((ins, i) => (
                  <span
                    key={`ins-${i}`}
                    onPointerDown={(e) => startInsetDrag(e, i, "move")}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute -translate-x-1/2 -translate-y-1/2 cursor-move"
                    style={{ left: `${ins.x * 100}%`, top: `${ins.y * 100}%`, width: `${ins.w * 100}%`, touchAction: "none" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ins.url} alt="inset" draggable={false} className="w-full border-2 border-white shadow-lg" />
                    {insetEditIdx === i ? (
                      <span
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute -top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-white p-1 shadow-lg"
                      >
                        <input
                          autoFocus
                          value={insetEditText}
                          onChange={(e) => setInsetEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setInsets((prev) => prev.map((x, k) => (k === i ? { ...x, text: insetEditText.trim() } : x)));
                              setInsetEditIdx(null); setPreview(null);
                            }
                            if (e.key === "Escape") setInsetEditIdx(null);
                          }}
                          placeholder="e.g. Lift Storage"
                          className="w-36 rounded border border-border px-1.5 py-1 text-[11px] text-black outline-none focus:border-primary"
                        />
                        <button
                          onClick={() => {
                            setInsets((prev) => prev.map((x, k) => (k === i ? { ...x, text: insetEditText.trim() } : x)));
                            setInsetEditIdx(null); setPreview(null);
                          }}
                          className="rounded bg-primary px-2 py-1 text-[10px] font-bold text-white"
                        >
                          OK
                        </button>
                      </span>
                    ) : (
                      <span
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setInsetEditIdx(i); setInsetEditText(ins.text ?? ""); }}
                        title="Click to edit the label"
                        className="absolute -top-3 left-1/2 -translate-x-1/2 cursor-pointer whitespace-nowrap border border-[#8a3f0e] bg-[#e8712c] px-2 py-0.5 text-[11px] font-bold text-black"
                      >
                        {ins.text?.trim() || "Click to label"}
                      </span>
                    )}
                    <span
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setInsets((prev) => prev.filter((_, k) => k !== i)); setPreview(null); }}
                      title="Remove this inset"
                      className="absolute -right-2 -top-2 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-rose-600 text-[11px] font-bold text-white shadow"
                    >
                      ×
                    </span>
                    <span
                      onPointerDown={(e) => startInsetDrag(e, i, "size")}
                      title="Drag to resize"
                      className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border border-stone-400 bg-white shadow"
                      style={{ touchAction: "none" }}
                    />
                  </span>
                ))}
                {/* Ang mga LINYA ng arrow sa isang SVG overlay — kaya nitong
                    iguhit ang KAHIT ANONG HILIG (rotate sa paghila ng dulo),
                    na hindi kaya ng CSS % na div. */}
                {boxDim.w > 0 && (
                  <svg
                    className="pointer-events-none absolute inset-0"
                    width={boxDim.w}
                    height={boxDim.h}
                    viewBox={`0 0 ${boxDim.w} ${boxDim.h}`}
                  >
                    {labels.map((l, i) => {
                      const pts = arrowPts(l);
                      if (!pts) return null;
                      const x1 = pts.ax * boxDim.w, y1 = pts.ay * boxDim.h;
                      const x2 = pts.bx * boxDim.w, y2 = pts.by * boxDim.h;
                      const ang = Math.atan2(y2 - y1, x2 - x1);
                      const deg = (ang * 180) / Math.PI;
                      const ux = Math.cos(ang), uy = Math.sin(ang);
                      return (
                        <g key={i} fill="#ffd400">
                          <line x1={x1 + ux * 9} y1={y1 + uy * 9} x2={x2 - ux * 9} y2={y2 - uy * 9} stroke="#ffd400" strokeWidth="3" />
                          <path d="M0 0 L-6 11 L6 11 Z" transform={`translate(${x1} ${y1}) rotate(${deg + 270})`} />
                          <path d="M0 0 L-6 11 L6 11 Z" transform={`translate(${x2} ${y2}) rotate(${deg + 90})`} />
                        </g>
                      );
                    })}
                  </svg>
                )}
                {labels.map((l, i) => {
                  const pts = arrowPts(l);
                  return (
                    <span key={i}>
                      {/* Ang mga bilog na dulo — hilahin KAHIT SAAN: haba,
                          iksi, o ikot pahilis. */}
                      {pts &&
                        (["tipA", "tipB"] as const).map((part) => (
                          <span
                            key={part}
                            onPointerDown={(e) => startDrag(e, i, part)}
                            onClick={(e) => e.stopPropagation()}
                            title="Drag to resize or rotate the arrow"
                            className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full bg-[#ffd400] shadow ring-1 ring-black/40"
                            style={{
                              left: `${(part === "tipA" ? pts.ax : pts.bx) * 100}%`,
                              top: `${(part === "tipA" ? pts.ay : pts.by) * 100}%`,
                              touchAction: "none",
                            }}
                          />
                        ))}
                      {/* Kapag may text: ang puting label box. Kapag WALA (arrow
                          na inilagay nang mag-isa): maliit na hawakan lang —
                          kaladkarin para iisod, × para tanggalin. DOBLE-CLICK
                          para i-edit mismo sa puwesto (text + spec number). */}
                      {editIdx === i ? (
                        <span
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-md border border-border bg-white p-1 shadow-lg"
                          style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%` }}
                        >
                          <input
                            autoFocus
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit();
                              if (e.key === "Escape") setEditIdx(null);
                            }}
                            placeholder="Label text"
                            className="w-44 rounded border border-border px-1.5 py-1 text-[11px] text-black outline-none focus:border-primary"
                          />
                          <select
                            value={editNum}
                            onChange={(e) => setEditNum(Number(e.target.value))}
                            title="Spec number"
                            className="max-w-20 rounded border border-border px-1 py-1 text-[10px] text-black"
                          >
                            <option value={0}>No #</option>
                            {specsList.map((s, k) => (
                              <option key={k} value={k + 1}>{k + 1} — {s.slice(0, 16)}</option>
                            ))}
                          </select>
                          <button onClick={saveEdit} className="rounded bg-primary px-2 py-1 text-[10px] font-bold text-white">OK</button>
                          <button onClick={() => setEditIdx(null)} className="rounded border border-border px-1.5 py-1 text-[10px] font-semibold text-black">Esc</button>
                        </span>
                      ) : (
                      <span
                        onPointerDown={(e) => startDrag(e, i, "move")}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditIdx(i);
                          setEditText(l.text);
                          setEditNum(Number(l.num) > 0 ? Number(l.num) : 0);
                        }}
                        title="Drag to move · double-click to edit"
                        className={`absolute flex -translate-x-1/2 -translate-y-1/2 cursor-move items-center whitespace-nowrap border border-black bg-white text-[11px] font-semibold text-black shadow ${l.text ? "gap-1.5 px-2 py-0.5" : "gap-0.5 rounded px-1 py-0.5 opacity-80"}`}
                        style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, touchAction: "none" }}
                      >
                        {Number(l.num) > 0 && (
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-[#c0392f] text-[9px] font-bold text-white">
                            {l.num}
                          </span>
                        )}
                        {l.text}
                        <span
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); setLabels((prev) => prev.filter((_, k) => k !== i)); setPreview(null); }}
                          title="Remove"
                          className="cursor-pointer font-bold text-rose-600"
                        >
                          ×
                        </span>
                      </span>
                      )}
                    </span>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {labels.length
                  ? `${labels.length} label${labels.length > 1 ? "s" : ""} placed — drag to move, double-click to edit, drag the yellow dots to resize an arrow, × to remove.`
                  : "No labels yet."}
              </p>
              {/* Inset — maliit na halimbawang litrato sa ibabaw ng main photo
                  (hal. bukas na lift storage). Pwede ang marami. */}
              <div className="mt-3 max-w-sm">
                <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Inset photo — small example picture on the sheet (e.g. open lift storage)</span>
                <UploadBox
                  label="Add inset photo"
                  busy={uploading === "inset"}
                  hasFile={false}
                  onFile={(f) => pickImage("inset", f)}
                  onClear={() => {}}
                />
              </div>
            </>
          )}
        </Section>

        {/* ── SWATCH — piliin sa library (gaya ng Colors/Variants sa Website
            Products), o mag-upload ng sariling litrato ─────────────────────── */}
        <Section title="Fabric swatch — shown top-right of the sheet">
          <button
            type="button"
            onClick={() => setSwatchPickerOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-stone-50"
          >
            <span className="font-semibold">+ Pick fabric from library</span>
            <span className="text-muted">{swatchPickerOpen ? "▲" : "▼"}</span>
          </button>
          {swatchPickerOpen && (
            <div className="mt-1 rounded-md border border-border p-2">
              <input value={swatchQ} onChange={(e) => setSwatchQ(e.target.value)} placeholder="Search color or material…" className={`${inp} mb-2 w-full`} />
              <div className="grid max-h-56 grid-cols-4 gap-2 overflow-auto pf-scroll">
                {swatchLibrary
                  .filter((l) => l.swatch)
                  .filter((l) => {
                    const t = swatchQ.trim().toLowerCase();
                    return !t || l.name.toLowerCase().includes(t) || (l.material ?? "").toLowerCase().includes(t);
                  })
                  .map((l) => (
                    <button
                      key={l.name}
                      type="button"
                      onClick={() => {
                        // Ang label sa puting kahon ay ang pangalan ng tela —
                        // maaari pa ring baguhin sa kabilang field.
                        setSwatchUrl(imageUrl(l.swatch));
                        setSwatchLabel(l.name);
                        setSwatchPickerOpen(false);
                        setPreview(null);
                      }}
                      title={l.name}
                      className="group text-left"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl(l.swatch)} alt={l.name} className="h-16 w-full rounded border border-border object-cover group-hover:ring-2 group-hover:ring-primary" loading="lazy" />
                      <span className="block truncate text-[10px] text-muted">{l.name}</span>
                    </button>
                  ))}
                {swatchLibrary.filter((l) => l.swatch).length === 0 && (
                  <p className="col-span-4 px-2 py-4 text-sm text-muted">No swatches in the library yet — upload one below.</p>
                )}
              </div>
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">…or upload a swatch photo</span>
              <UploadBox
                label="Upload swatch photo"
                busy={uploading === "swatch"}
                hasFile={!!swatchUrl}
                onFile={(f) => pickImage("swatch", f)}
                onClear={() => { setSwatchUrl(null); setPreview(null); }}
              />
              {swatchUrl && (
                <span className="mt-2 block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={swatchUrl} alt="swatch" className="h-16 w-16 rounded border border-border object-cover" />
                </span>
              )}
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Fabric name (white box on the swatch)</span>
              <input value={swatchLabel} onChange={(e) => setSwatchLabel(e.target.value)} placeholder="BEIGE" className={`${inp} w-full`} />
            </label>
          </div>
        </Section>

        {/* ── IMPORTANT NOTE ─────────────────────────────────────────────────── */}
        <Section title="Important note">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Mattress thickness</span>
              <input value={mattress} onChange={(e) => setMattress(e.target.value)} placeholder="n/a" className={`${inp} w-full`} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Net visible height of headboard</span>
              <input value={headboard} onChange={(e) => setHeadboard(e.target.value)} placeholder="34 inches" className={`${inp} w-full`} />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Note shown at the bottom of the sheet</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={`${inp} w-full text-xs`} />
          </label>
        </Section>

        {/* ── PREVIEW — POP-UP na (hiling 2026-08-16), hindi na sa ilalim ng
            form: buong laki ang sheet sa sariling modal, Close pag okay na. */}
        <Modal
          open={!!preview}
          onClose={() => setPreview(null)}
          title="Preview"
          description="This exact image is what the customer receives"
          size="2xl"
          footer={
            <div className="flex justify-end">
              <button type="button" onClick={() => setPreview(null)} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90">Close</button>
            </div>
          }
        >
          {preview && (
            // BUONG LAPAD ang sheet para mabasa ang detalye (naiulat 2026-08-17
            // na maliit); ang modal body ang nagsi-scroll pababa.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="design details preview" className="mx-auto w-full max-w-[900px] rounded-lg border border-border bg-white" />
          )}
        </Modal>

        {/* ── TATANGGAP — parehong 24h listahan ng quotation ─────────────────── */}
        <Section title="Send on Messenger">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">
              Send to {loaded && (term ? `(${shown.length} of ${targets.length})` : `(${targets.length} available)`)}
            </span>
            {targets.length > 0 && (
              <button
                onClick={() => setPicked(picked.size ? new Set() : new Set(shown.slice(0, MAX).map((t) => t.psid)))}
                className="text-xs text-primary underline"
              >
                {picked.size ? "Clear" : `Select first ${Math.min(MAX, shown.length)}`}
              </button>
            )}
          </div>
          <p className="mb-1 text-[11px] text-muted">
            Customers who chatted in the last 24 hours — Meta only allows sending inside that window.
          </p>
          {targets.length > 0 && (
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name…" className={`${inp} mb-1 w-full`} />
          )}
          <div className="max-h-56 overflow-auto rounded-md border border-border">
            {!loaded && <p className="px-3 py-4 text-sm text-muted">Loading…</p>}
            {loaded && targets.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted">
                Nobody chatted in the last 24 hours. The sheet will still be saved — you can send the link yourself.
              </p>
            )}
            {loaded && targets.length > 0 && shown.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted">No one matches “{q.trim()}”.</p>
            )}
            {shown.map((t) => (
              <label
                key={t.psid}
                className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0 hover:bg-stone-50"
              >
                <input type="checkbox" checked={picked.has(t.psid)} onChange={() => toggle(t.psid)} className="h-4 w-4 accent-primary" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
                <span className="shrink-0 text-[11px] text-muted">{when(t.lastMsg)}</span>
              </label>
            ))}
          </div>
        </Section>
      </Modal>
    </div>
  );
}
