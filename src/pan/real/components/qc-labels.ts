// QC label printers — hinati mula warehouse-qc-manager (2026-08-10) para
// magamit din ng Locations (Reprint QR kapag nasira ang nakadikit na label).
// Client-only (document/window) — mga client component lang ang umaangkat.
import JsBarcode from "jsbarcode";
import { BrowserQRCodeSvgWriter } from "@zxing/library";
import { printHtml } from "@/lib/qz-print";

// ANG LOGO BILANG DATA URI (2026-08-28). Ang QZ ay nagre-render ng HTML sa
// sariling engine — walang session, at ang isang <img src="https://…"> ay
// kailangan pa nitong hilahin. Kapag hindi umabot sa oras, BLANGKO ang
// lumalabas na sticker: hindi ito naghihintay, at ang buong raster ay nauuwing
// walang laman. Inilalagay na lang ang larawan sa HTML mismo.
//
// Isang beses lang kinukuha kada session; kapag pumalya, walang logo — mas
// mabuti kaysa blangkong papel.
let logoUri: string | null = null;
let logoTried = false;
async function logoDataUri(): Promise<string> {
  if (logoUri != null) return logoUri;
  if (logoTried) return "";
  logoTried = true;
  try {
    const res = await fetch(`${window.location.origin}/logo.png`, { cache: "force-cache" });
    if (!res.ok) return "";
    const blob = await res.blob();
    logoUri = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("logo read failed"));
      fr.readAsDataURL(blob);
    });
    return logoUri;
  } catch { return ""; }
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

// Code128 barcode → SVG outerHTML (for embedding into the print HTML).
function barcodeSvgString(value: string): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  // Bar WIDTH (thinnest bar) drives scan reliability. 1.6 was too thin to decode;
  // 3 was too big (overflowed on short/new-item SKUs). 2 is the balance — crisp
  // enough for a 1D scanner, still a standard label size. The CSS caps the box
  // width so it scales to fit regardless of SKU length.
  try { JsBarcode(svg, value, { format: "CODE128", width: 2, height: 40, margin: 0, displayValue: false }); } catch { /* invalid → empty */ }
  return svg.outerHTML;
}

// QR SVG (opens the QC record on a phone). Returns outerHTML.
function qrSvgString(text: string): string {
  const host = document.createElement("div");
  try { host.appendChild(new BrowserQRCodeSvgWriter().write(text, 80, 80)); } catch { /* skip */ }
  return host.innerHTML;
}

// Auto-print N ORIGINAL product labels (one per good unit) — enterprise "Branded
// Header" design: logo + brand · category chip, gold hairline, product name,
// full-width barcode, then SKU + location. Printed alongside the QC-Passed label.
export async function printProductLabels(
  item: { sku: string | null; product_name: string | null; category?: string | null; location?: string | null; warehouse_location?: string | null },
  copies: number,
) {
  const value = (item.sku || item.product_name || "PF-ITEM").trim();
  const n = Math.max(1, Math.min(200, Math.floor(copies) || 1));
  const name = escapeHtml((item.product_name ?? value).split("\n")[0]);
  const cat = item.category?.trim() ? escapeHtml(item.category.trim()) : "";
  const loc = item.location?.trim() ? escapeHtml(item.location.trim()) : "";
  const sku = escapeHtml(value);
  const logo = await logoDataUri();
  // Bars-only barcode (SKU shown in footer); short height so the header+footer fit.
  const bc = barcodeSvgString(value);
  // ONE label per print job → never two on one sticker.
  const single = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: 50mm 30mm; margin: 0; }
    html,body { margin:0; padding:0; }
    .lbl { width:50mm; height:30mm; box-sizing:border-box; display:flex; flex-direction:column; justify-content:space-between; padding:1mm 1.5mm; overflow:hidden; font-family:Arial,sans-serif; color:#1c1810; }
    .hd { display:flex; align-items:center; justify-content:space-between; gap:1mm; }
    .brand { display:flex; align-items:center; gap:0.8mm; font-weight:400; font-size:6pt; letter-spacing:0.3px; color:#4a3b1a; }
    .brand img { width:2.8mm; height:2.8mm; border-radius:50%; object-fit:cover; }
    .chip { font-weight:400; font-size:5.5pt; color:#7a5e1f; background:#f4ead8; border:0.2mm solid #caa45a; border-radius:1mm; padding:0.2mm 0.8mm; white-space:nowrap; max-width:18mm; overflow:hidden; text-overflow:ellipsis; }
    .rule { height:0.3mm; background:#caa45a; margin:0.4mm 0; }
    .nm { font-weight:400; font-size:6.5pt; line-height:1.05; max-height:5mm; overflow:hidden; text-align:center; }
    .bc { text-align:center; }
    .bc svg { max-width:46mm; height:10mm; width:auto; }
    .ft { display:flex; align-items:center; justify-content:space-between; font-weight:400; font-size:6pt; }
    .loc { color:#4a3b1a; }
  </style></head><body><div class="lbl">
    <div class="hd"><span class="brand"><img src="${logo}" onerror="this.style.display='none'"/>PAN FURNITURE</span>${cat ? `<span class="chip">${cat}</span>` : ""}</div>
    <div class="rule"></div>
    <div class="nm">${name}</div>
    <div class="bc">${bc}</div>
    <div class="ft"><span>${sku}</span>${loc ? `<span class="loc">${loc}</span>` : ""}</div>
  </div></body></html>`;
  for (let i = 0; i < n; i++) {
    try { await printHtml("Xprinter XP-420B", single, { width: 50, height: 30 }); } catch { /* QC print surfaces errors */ }
  }
}

// Auto-print N QC-PASSED labels (one per good unit) after a Receiving QC pass — via
// QZ Tray → Xprinter XP-420B (silent thermal, 50×30mm). Enterprise design: brand +
// bracketed ✓ PASSED seal, QR (→ QC record), item barcode (→ product), full QC trail.
export async function printQcPassedLabels(
  item: {
    sku: string | null; product_name: string | null; category: string | null; color: string | null; dimension: string | null;
    location?: string | null; warehouse_location?: string | null; qc_id?: number | null; inspector?: string | null; qc_date?: string | null;
    direction?: "in" | "out";   // IN = stock-in (Receiving QC) · OUT = out for delivery
  },
  copies: number,
) {
  const dir = item.direction ?? "in";
  const qcRef = item.qc_id != null ? `QC-${String(item.qc_id).padStart(5, "0")}` : "QC";
  // Barcode VALUE (what the 1D scanner reads + we match on).
  //  - OUT: sku → SHORT QC ref (QC-00035), NEVER the product name.
  //  - IN: sku HABANG MAIKLI (≤14 chars — ang subok nang format); ang MAHABANG sku
  //    (hal. website items na "WEB-BED-1-SENPAI-MALIBOG") ay ginagawang sobrang
  //    dense ang Code128 sa 50×30mm sticker na HINDI na mabasa ng scanner — doon,
  //    ang maikling QC ref ang i-encode (laging maiksi, unique, at tinatanggap na
  //    rin ng verify scan bilang katunayan).
  const inValue = (item.sku || item.product_name || "PF-ITEM").trim();
  const value = dir === "out"
    ? (item.sku?.trim() || qcRef)
    : (inValue.length <= 14 ? inValue : qcRef);
  const n = Math.max(1, Math.min(200, Math.floor(copies) || 1));
  const name = escapeHtml((item.product_name ?? value).split("\n")[0]);
  const loc = item.location?.trim() ? escapeHtml(item.location.trim()) : "";
  const sku = escapeHtml(value);
  const inspector = item.inspector?.trim() ? escapeHtml(item.inspector.trim()) : "—";
  const qcDate = item.qc_date ? escapeHtml(item.qc_date) : "";
  const logo = await logoDataUri();
  const base = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  // QC-passed label = 100% the original working format (barcode + QR both unchanged
  // from HEAD so they scan exactly like the proven-good label). Direction is enforced
  // in-app: the scanned SKU is matched against the reserved QC record, which was itself
  // created for THIS station (IN vs OUT), so a match can only be this station's move.
  const bc = barcodeSvgString(value);
  const qr = qrSvgString(item.qc_id != null ? `${base}/scan?qc=${item.qc_id}` : `${base}/scan?code=${encodeURIComponent(value)}`);

  // Enterprise QC-PASSED 50×30mm label.
  const oneLabel = `<div class="lbl">
    <div class="hd">
      <span class="brand"><img src="${logo}" onerror="this.style.display='none'"/><span class="bt">PAN FURNITURE<i>Quality Assurance</i></span></span>
      <span class="hr">
        <span class="dir ${dir}">( ${dir === "out" ? "OUT" : "IN"} )</span>
        <span class="seal"><span class="sc">✓</span><span class="sp">PASSED</span></span>
      </span>
    </div>
    <div class="rule"></div>
    <div class="mid">
      <div class="qr">${qr}</div>
      <div class="info">
        <div class="nm">${name}</div>
        <div class="ln">${sku}${loc ? ` - ${loc}` : ""}</div>
        <div class="ln muted">Insp: ${inspector}</div>
        ${qcDate ? `<div class="ln muted">${qcDate}</div>` : ""}
        <div class="ln ref">${qcRef}</div>
      </div>
    </div>
    <div class="bc">${bc}</div>
  </div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: 50mm 30mm; margin: 0; }
    html,body { margin:0; padding:0; }
    .lbl { width:50mm; height:30mm; box-sizing:border-box; display:flex; flex-direction:column; padding:0.8mm 1.2mm; page-break-after:always; overflow:hidden; font-family:Arial,sans-serif; color:#1c1810; }
    .lbl:last-child { page-break-after:auto; }
    .hd { display:flex; align-items:center; justify-content:space-between; gap:1mm; }
    .brand { display:flex; align-items:center; gap:0.8mm; }
    .brand img { width:3mm; height:3mm; border-radius:50%; object-fit:cover; }
    .bt { display:flex; flex-direction:column; line-height:1; }
    .bt { font-weight:400; font-size:5.6pt; letter-spacing:0.2px; color:#4a3b1a; }
    .bt i { font-style:normal; font-weight:400; font-size:4pt; color:#7a5e1f; margin-top:0.3mm; }
    .hr { display:flex; align-items:center; gap:1.5mm; }
    /* IN / OUT movement tag. IN = stock-in (green), OUT = out for delivery (blue). */
    .dir { font-weight:400; font-size:6.5pt; letter-spacing:0.3px; }
    .dir.in { color:#15803d; }
    .dir.out { color:#1d4ed8; }
    /* Bracketed ✓ PASSED seal — corner-bracket frame, green stamp look. */
    .seal { position:relative; display:flex; flex-direction:column; align-items:center; padding:0.6mm 2.2mm; color:#15803d; }
    .seal::before,.seal::after { content:""; position:absolute; width:2mm; height:2mm; }
    .seal::before { top:0; left:0; border-top:0.4mm solid #15803d; border-left:0.4mm solid #15803d; }
    .seal::after { bottom:0; right:0; border-bottom:0.4mm solid #15803d; border-right:0.4mm solid #15803d; }
    .sc { font-size:8pt; font-weight:400; line-height:1; }
    .sp { font-size:5pt; font-weight:400; letter-spacing:0.5px; }
    .rule { height:0.3mm; background:#caa45a; margin:0.5mm 0; }
    .mid { display:flex; gap:1.2mm; align-items:center; flex:1; min-height:0; }
    .qr { flex-shrink:0; }
    .qr svg { width:11mm !important; height:11mm !important; }
    .info { min-width:0; flex:1; }
    .nm { font-weight:400; font-size:5.6pt; line-height:1.05; max-height:6mm; overflow:hidden; }
    .ln { font-size:5pt; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ln.muted { color:#555; }
    .ln.ref { font-weight:400; color:#4a3b1a; letter-spacing:0.3px; }
    .bc { text-align:center; }
    /* Let the barcode keep its natural bar width (don't squeeze to a fixed 46mm,
       which crushed the bars so a 1D scanner couldn't read it). Cap the box and
       let it scale down only if it overflows. */
    .bc svg { max-width:44mm; height:9mm; width:auto; }
  </style></head><body>${oneLabel}</body></html>`;

  try {
    // One print job PER label → one QC sticker each (no two squeezed onto one).
    for (let i = 0; i < n; i++) {
      await printHtml("Xprinter XP-420B", html, { width: 50, height: 30 });
    }
  } catch {
    // QZ down → DIRETSO sa browser print, walang tanong (hiling 2026-08-28).
    // Ang confirm ay isang hakbang lang na palaging sinasagot ng "OK": alam na
    // ng nagpi-print na gusto niyang mag-print, at ang thermal ay pumalya na.
    //
    // IFRAME, HINDI window.open: ang bagong window ay nananatiling `about:blank`
    // kapag hinabol ng browser ang `document.write` — kaya blangkong Print
    // dialog. Ang iframe ay nasa parehong dokumento, walang pop-up na
    // hinaharangan, at ang laman ay naroon na bago pa tumawag ang print.
    if (typeof window === "undefined") return;
    const head = html.replace(/<body>[\s\S]*$/, "");
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    // MAY TUNAY NA SUKAT, ITINAGO SA LABAS NG SCREEN (2026-08-28). Ang
    // `visibility:hidden` at ang 0×0 ay nagbibigay ng BLANGKONG papel: walang
    // ini-render ang Chrome sa iframe na hindi nakikita o walang laki, kaya
    // walang mapi-print. Itinutulak ito sa labas ng tanawin sa halip — nasa
    // layout pa rin, kaya kumpleto ang render, pero hindi nakikita.
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:80mm;height:200mm;border:0;opacity:0;pointer-events:none";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) { frame.remove(); return; }
    doc.open();
    doc.write(`${head}<body>${oneLabel.repeat(n)}</body></html>`);
    doc.close();
    // ANG `load` NG IFRAME AY HINDI TUMATAKBO SA document.write (2026-08-28):
    // walang navigation na nangyayari, kaya walang event. Ang mga larawan (logo)
    // ay hinihintay nang tuwiran, may hangganang panahon — mas mabuting kulang
    // ang logo kaysa hindi lumabas ang sticker.
    const imgs = Array.from(doc.images);
    const ready = Promise.all(imgs.map((im) => im.complete ? Promise.resolve() : new Promise<void>((res) => {
      im.addEventListener("load", () => res(), { once: true });
      im.addEventListener("error", () => res(), { once: true });
    })));
    await Promise.race([ready, new Promise((res) => setTimeout(res, 2500))]);
    try { frame.contentWindow?.focus(); frame.contentWindow?.print(); }
    finally { setTimeout(() => frame.remove(), 60_000); }
  }
}

