// FORMAL QUOTATION — para sa mga nagtatanong pa lang (wala pang order). Ang
// output ay SVG, iniupload sa public bucket, tapos naipapadala sa Messenger
// thread ng customer bilang larawan.
//
// BAKIT SVG: napatunayan 2026-08-08 na nirerender ito ng Messenger nang tama
// (sabay na pagsubok sa SVG at PNG — pareho lumabas), at ito rin ang gamit ng
// BIR receipt (renderBirInvoiceSvg). Walang raster step na kailangan, at mas
// malinis ang teksto kaysa sa naka-scale na PNG.
//
// Ang layout ay tumutugma sa orihinal na spreadsheet: buong-border na
// talahanayan, header block na may kahon, dalawang QR card sa ibaba, at lagda.

import { COMPANY } from "@/lib/company";

export type QuoteItem = {
  qty: number;
  description: string;
  unitPrice: number;
  // PER-LINE PRICES (2026-08-20, MTO requests): kapag naka-set, ang Unit Price
  // column ay nagpapakita ng presyo KADA LINYA ng description (hal. Size
  // 35,900 / Lift Storage +4,725) — parehong porma ng approved mock. Ang una
  // ay ang base at ang mga sumunod ay dagdag; ang unitPrice ay ang kabuuan pa
  // rin. Kapag wala, isang halaga lang ang lumalabas (dating gawi).
  lineParts?: (number | null)[];
  // Larawan ng produkto bilang DATA URI. Kapag wala, blangko ang Item cell —
  // hindi nawawala ang column, gaya ng orihinal na sheet.
  image?: string | null;
};

export type QuoteInput = {
  customerName: string;
  address?: string | null;
  dateLabel: string;         // "August 9, 2026"
  items: QuoteItem[];
  deliveryFee?: number;      // hiwalay na hilera, gaya ng dating porma
  // Naka-embed nang data URIs (tingnan ang lib/quotation-assets.ts). Data URI ang
  // gamit, hindi URL: hinahatak ni Meta ang SVG sa server nila at hindi
  // maaasahan doon ang panlabas na <image href>.
  logo?: string | null;
  bpiQr?: string | null;
  bdoQr?: string | null;
  // ITAGO ANG QR CARDS (2026-08-20): kapag may QR sa larawan, dinadagdagan ito
  // ng Messenger ng sarili nitong "QR transfer / Transfer with Maya" widget
  // (kasama ang kopya ng quotation) — hindi mapipigilan sa gawi ng sender.
  // Ang account numbers ay nasa itaas pa rin, kaya kumpleto ang document.
  hideQr?: boolean;
  signature?: string | null;
  // QUOTATION SUMMARY ng isang order na may BAYAD NA (2026-08-22). Ang 30% ay
  // naibigay na noong unang quotation at hindi na ito hinihingi muli — ang mga
  // idinagdag ay napupunta sa balanse. Kapag may laman, ito ang ipinapakitang
  // downpayment (hindi ang 30% ng bagong kabuuan), at ang natitira ang balanse.
  paid?: number | null;
  paidLabel?: string | null;   // "paid Aug 20"
  // Pamagat ng dokumento; "QUOTATION" kung wala.
  title?: string | null;
};

// Bank details — hard-coded ayon sa desisyon 2026-08-09 (hindi nagbabago).
const BANKS = [
  { bank: "BPI", name: "Jessone Purificacion", account: "8529594349" },
  { bank: "BDO Unibank, Inc.", name: "Jessone Purificacion", account: "006960153572" },
];
const SIGNATORY = "Jessone B. Purificacion";
const DOWNPAYMENT_RATE = 0.3;

// Mga estado ng quotation. Nasa lib (hindi sa actions.ts) dahil ang huli ay
// "use server": ang mga export doon ay dapat PURO async function — ang array ay
// bumabagsak sa build ("A 'use server' file can only export async functions").
export const QUOTE_STATUSES = ["Draft", "Sent", "Accepted", "Declined", "Expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

// FOLLOW-UP — hanggang TATLO lang, tapos tigil: hindi kinukulit ang customer na
// tahimik. Magkaiba ang tatlo — ang paulit-ulit na parehong teksto ay mukhang bot,
// at ang layunin ay makausap, hindi mag-spam. Tumataas ang pagiging tuwiran:
// paalala → alok ng tulong → huling tanong bago tumigil.
export const MAX_FOLLOWUPS = 3;

export function followupMessage(n: number, firstName: string): string {
  const name = firstName.trim() || "there";
  switch (n) {
    case 1:
      return [
        `Hi ${name}, just following up`,
        "on the quotation we sent.",
        "",
        "Let us know if you have any",
        "questions about the items or",
        "the payment terms.",
      ].join("\n");
    case 2:
      return [
        `Hi ${name}! Checking in again`,
        "on your quotation.",
        "",
        "If anything needs changing —",
        "the items, the quantity, or",
        "the delivery — just tell us",
        "and we will revise it for you.",
      ].join("\n");
    default:
      return [
        `Hi ${name}, this is our last`,
        "follow-up on this quotation.",
        "",
        "If you are still deciding, that",
        "is completely fine. Message us",
        "anytime and we will pick this",
        "up again — the prices are held",
        "for you.",
      ].join("\n");
  }
}

// Palette — tumutugma sa espresso/gold ng IMS at ng orihinal na sheet.
const INK = "#111111";
const LINE = "#000000";

// Ang SVG ay Arial/Helvetica ng SYSTEM (hindi ang built-in na font ng PDF),
// kaya ang ₱ ay may tunay na glyph dito. Ang PDF ay nag-e-embed ng sariling
// font para sa simbolong ito — tingnan ang quotation-pdf.ts.
const peso = (n: number) =>
  `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function escXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Ang SVG ay nire-render sa server ni Meta gamit ang mga font na naroon, kaya
// ang character na wala sa Arial ay lumalabas na kahon (▨). Nasukat 2026-08-09:
// may produktong may FULLWIDTH na "＃" (U+FF03) sa color field — "UFOUND982＃02"
// ay lumabas na "UFOUND982▨▨02" sa quotation. Ginagawang normal ASCII ang
// fullwidth forms at ang mga karaniwang typographic na panipi/gitling.
function toRenderSafe(s: string): string {
  return String(s ?? "")
    // Fullwidth ASCII (U+FF01–U+FF5E) → ang katumbas na ASCII.
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")                     // ideographic space
    .replace(/[‘’‛]/g, "'")       // curly single quotes
    .replace(/[“”‟]/g, '"')       // curly double quotes
    .replace(/[–—‒]/g, "-")       // en/em dash
    .replace(/…/g, "...")
    .replace(/ /g, " ");                    // non-breaking space
}

// ── ₱ BILANG VECTOR PATH (Joe 2026-09-06, "sira ata ung Pesos sign") ──────
// Ang larawan ng quotation sa Messenger ay nire-render ng Meta gamit ang
// sarili nitong font, na WALANG U+20B1 — kahon ang lumalabas sa bawat presyo
// (ang PDF at ang browser ay may Geist/Arial, kaya doon ay ayos). Kaya ang ₱
// ay iginuguhit bilang outline (Geist Regular, 1000 units/em, advance 680)
// at ang bilang lang ang <text>. Ang lapad ng bilang ay tinatantiya sa Arial
// metrics (digits 556, "," "." 278, "+" "−" 584) para tama ang right/center
// alignment — maliit lang ang pagkakaiba ng font ng Meta sa mga digit.
const PESO_PATH = "M110 0V374H30V444H110V494H30V564H110V710H319Q411 710 472.0 672.5Q533 635 556 564H650V494H569Q570 483 570 471Q570 459 569 447V444H650V374H556Q532 303 471.0 265.5Q410 228 319 228H196V0ZM196 626V564H459Q423 626 319 626ZM479 493V494H196V444H479Q480 457 480 471Q480 483 479 493ZM196 312H319Q421 312 458 374H196Z";
const PESO_ADV = 680;
const ARIAL_W: Record<string, number> = { ",": 278, ".": 278, "+": 584, "−": 584, "-": 333, " ": 278 };
const approxWidth = (t: string, bold: boolean) =>
  [...t].reduce((w, ch) => w + (/\d/.test(ch) ? 556 : ARIAL_W[ch] ?? 556), 0) * (bold ? 1.04 : 1);
// Pinaghihiwalay: unlapi (hal. "+"), ₱, bilang. Null kapag walang ₱.
function pesoParts(t: string): { pre: string; num: string } | null {
  const i = t.indexOf("₱");
  if (i < 0) return null;
  return { pre: t.slice(0, i), num: t.slice(i + 1) };
}

// Balutin ang mahabang teksto — walang awtomatikong word-wrap ang SVG, kaya
// manu-mano; kung hindi, lalabas sa gilid ng kahon.
function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of raw.split(/\s+/).filter(Boolean)) {
      if (!line.length) line = word;
      else if (line.length + 1 + word.length <= maxChars) line += " " + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

export function quoteTotals(input: Pick<QuoteInput, "items" | "deliveryFee">) {
  const itemsTotal = (input.items ?? []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const delivery = Number(input.deliveryFee) || 0;
  const total = itemsTotal + delivery;
  const downpayment = Math.round(total * DOWNPAYMENT_RATE * 100) / 100;
  return { itemsTotal, delivery, total, downpayment, balance: total - downpayment };
}

// NAKA-PAHINA (2026-08-22). Ang quotation ay dating IISANG mahabang SVG;
// sa 30 produkto ay ~20,000px ang taas, at pinipiga ito ng Messenger sa
// manipis na guhit — hindi mababasa. Ngayon ay hinahati sa mga pahinang
// A4 ang ratio, gaya ng PDF: ang bawat pahina ay sariling larawan sa
// Messenger, at sa viewer ay nakasalansan ang mga ito.
//
// Ang maikling quotation ay IISANG pahina pa rin na eksaktong taas ng laman —
// hindi nagbabago ang hitsura ng karaniwang quotation.
export function renderQuotationSvgPages(input: QuoteInput): string[] {
  const t = quoteTotals(input);
  const W = 940;
  const PAD = 36;
  const RIGHT = W - PAD;
  // A4 ang ratio (1:1.414) — kapareho ng PDF, at katamtaman ang sukat sa
  // Messenger: mababasa ang teksto nang hindi kailangang i-zoom.
  const PAGE_H = Math.round(W * 1.4142);
  const BOTTOM = PAGE_H - PAD - 18; // palugit para sa "Page i of n"

  const pages: string[][] = [];
  let p: string[] = [];
  // Ang table header ay muling iginuguhit sa bawat bagong pahina habang nasa
  // loob ng talahanayan — kung hindi, ang hilera sa pahina 2 ay walang
  // pamagat ng column.
  let tableHead: (() => void) | null = null;
  const newPage = () => {
    pages.push(p);
    p = [];
    y = PAD;
    if (tableHead) tableHead();
  };
  // Kasya pa ba ang `need` px sa pahinang ito? Kung hindi, bagong pahina.
  const room = (need: number) => {
    if (y + need > BOTTOM) newPage();
  };
  const text = (
    x: number, y: number, s: string,
    o: { size?: number; bold?: boolean; anchor?: string; italic?: boolean; fill?: string } = {},
  ) => {
    const size = o.size ?? 13.5;
    const attrs = `font-size="${size}"${o.bold ? ' font-weight="700"' : ""}${o.italic ? ' font-style="italic"' : ""}`;
    const fill = o.fill ?? INK;
    const parts = pesoParts(s);
    if (!parts) {
      // toRenderSafe bago escXml: ang mga character na wala sa font ng Meta ay
      // lumalabas na kahon, kaya isang daanan lang ang lahat ng teksto.
      p.push(`<text x="${x}" y="${y}" ${attrs}${o.anchor ? ` text-anchor="${o.anchor}"` : ""} fill="${fill}">${escXml(toRenderSafe(s))}</text>`);
      return;
    }
    // ₱ bilang path (tingnan ang PESO_PATH): unlapi + glyph + bilang, lahat
    // start-anchored mula sa kinuwentang simula ayon sa anchor.
    const k = size / 1000;
    const wPre = approxWidth(parts.pre, !!o.bold) * k;
    const wNum = approxWidth(parts.num, !!o.bold) * k;
    const wPeso = PESO_ADV * k * (o.bold ? 1.04 : 1);
    const total = wPre + wPeso + wNum;
    const x0 = o.anchor === "end" ? x - total : o.anchor === "middle" ? x - total / 2 : x;
    if (parts.pre) p.push(`<text x="${x0.toFixed(2)}" y="${y}" ${attrs} fill="${fill}">${escXml(toRenderSafe(parts.pre))}</text>`);
    p.push(`<path d="${PESO_PATH}" fill="${fill}" transform="translate(${(x0 + wPre).toFixed(2)} ${y}) scale(${k.toFixed(5)} ${(-k).toFixed(5)})"${o.bold ? ' stroke="' + fill + '" stroke-width="28"' : ""}/>`);
    p.push(`<text x="${(x0 + wPre + wPeso).toFixed(2)}" y="${y}" ${attrs} fill="${fill}">${escXml(toRenderSafe(parts.num))}</text>`);
  };
  const box = (x: number, y: number, w: number, h: number, fill = "none", sw = 1) =>
    p.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${LINE}" stroke-width="${sw}"/>`);
  const vline = (x: number, y1: number, y2: number) =>
    p.push(`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${LINE}" stroke-width="1"/>`);

  let y = PAD;

  // ── HEADER: pamagat + Date/Name/Address sa kahon, logo sa kanan ─────────────
  const LOGO_W = 150, LOGO_H = 96;
  text(PAD, y + 30, input.title?.trim() || "QUOTATION", { size: 26, bold: true });
  if (input.logo) {
    // preserveAspectRatio para hindi ma-stretch ang transparent na logo.
    p.push(`<image href="${input.logo}" x="${RIGHT - LOGO_W}" y="${y}" width="${LOGO_W}" height="${LOGO_H}" preserveAspectRatio="xMidYMid meet"/>`);
  } else {
    // Fallback kung hindi mabasa ang logo file — hindi dapat blangko ang header.
    p.push(`<circle cx="${RIGHT - LOGO_W / 2}" cy="${y + LOGO_H / 2}" r="40" fill="#efe7d6" stroke="#caa45a" stroke-width="2"/>`);
    text(RIGHT - LOGO_W / 2, y + LOGO_H / 2 - 2, "PAN", { size: 19, bold: true, anchor: "middle", fill: "#4a3b1a" });
    text(RIGHT - LOGO_W / 2, y + LOGO_H / 2 + 16, "FURNITURE", { size: 8, anchor: "middle", fill: "#7a6a4a" });
  }

  // Date / Name / Address — naka-kahon, gaya ng sheet.
  const LBL_W = 88;
  const FLD_W = 420;
  const addrLines = wrap(input.address || "—", 52);
  const rowsMeta: { label: string; lines: string[] }[] = [
    { label: "Date:", lines: [input.dateLabel] },
    { label: "Name:", lines: wrap(input.customerName || "—", 52) },
    { label: "Address:", lines: addrLines },
  ];
  let hy = y + 46;
  const metaTop = hy;
  for (const r of rowsMeta) {
    const h = Math.max(r.lines.length * 18 + 10, 26);
    box(PAD, hy, LBL_W, h);
    box(PAD + LBL_W, hy, FLD_W, h);
    text(PAD + 6, hy + 18, r.label, { bold: true });
    r.lines.forEach((ln, i) => text(PAD + LBL_W + 8, hy + 18 + i * 18, ln));
    hy += h;
  }
  y = Math.max(hy, y + LOGO_H) + 26;

  // ── PANIMULA ────────────────────────────────────────────────────────────────
  text(PAD, y, "Dear Sir/Maam:", { bold: true }); y += 19;
  text(PAD, y, "Greetings from PAN Furniture Maker, Interior Decorator and Contractor!"); y += 19;
  text(PAD, y, "We are pleased to submit to you our quotation for the following:"); y += 19 + 16;

  // ── TALAHANAYAN ─────────────────────────────────────────────────────────────
  // Column x-boundaries: Qty | Item (larawan) | Description | Unit | Total
  // MAS MALAKING LARAWAN (Joe 2026-09-06, "lakihan ang picture ng 3x parang
  // sa warranty"): 242px ang Item column (dating 110) at 230px ang taas ng
  // larawan (dating 104) — ~5x ang lawak. Ang description ay 246px na lang,
  // kaya mas maikli ang wrap (33 chars).
  const X0 = PAD, X1 = PAD + 58, X2 = PAD + 300, X3 = PAD + 546, X4 = PAD + 716, X5 = RIGHT;
  const DESC_CHARS = 33;
  const LH = 18, ROW_PAD = 16;
  // TAAS NG THUMBNAIL — mas malaki kaysa sa lapad ng Item cell (110px) dahil ang
  // mga larawan ng produkto ay PATAYO: nasukat 2026-08-09 na ratio 0.67–0.86
  // (hal. Bed 1 = 1024×1536). Sa dating 74px na taas, ang taas ang nauubos at
  // ang patayong larawan ay lumiliit sa gitna ng puting espasyo — kita ito sa
  // kama kumpara sa mga upuan. Sa 104px, ang patayo ay pumupuno sa taas at ang
  // mas patagilid ay pumupuno sa lapad.
  const THUMB = 230;

  type Row = { qty: string; image: string | null; lines: string[]; unit: string; total: string; unitLines?: (string | null)[] };
  const rows: Row[] = (input.items ?? [])
    .filter((it) => String(it.description ?? "").trim() || Number(it.unitPrice) > 0)
    .map((it) => {
      // Ang blangkong linya ay HIWALAY sa pagitan ng pangkat — hindi ito
      // pinapalitan ng "—", na magmumukhang kulang na halaga.
      const lines = it.description ? wrap(it.description, DESC_CHARS) : ["—"];
      // PER-LINE PRICES: itatapat sa UNANG wrapped line ng bawat orihinal na
      // linya ng description, para tumugma ang presyo sa tamang detalye kahit
      // may mahabang linyang napunit sa dalawa.
      let unitLines: (string | null)[] | undefined;
      if (it.lineParts?.length) {
        const src = (it.description || "").split("\n");
        unitLines = [];
        let li = 0;
        // Ang UNANG linyang may halaga ang BASE (karaniwan ang Size) — plain
        // ang porma nito; ang mga sumunod ay karagdagan kaya may "+". Hindi ito
        // index 0: ang unang linya ay pangalan ng produkto na walang presyo.
        let baseShown = false;
        for (const srcLine of src) {
          const n = Math.max(1, wrap(srcLine, DESC_CHARS).length);
          const amt = it.lineParts[li];
          if (amt == null || amt === 0) {
            unitLines.push(null);
          } else if (!baseShown) {
            unitLines.push(peso(amt));
            baseShown = true;
          } else {
            unitLines.push(`+${peso(amt)}`);
          }
          for (let k = 1; k < n; k++) unitLines.push(null);
          li++;
        }
      }
      return {
        qty: String(Number(it.qty) || 0),
        image: it.image?.trim() || null,
        lines,
        unit: peso(it.unitPrice),
        total: peso((Number(it.qty) || 0) * (Number(it.unitPrice) || 0)),
        unitLines,
      };
    });
  // Ang Delivery ay LAGING hilera, gaya ng orihinal — kahit zero. Walang larawan.
  rows.push({ qty: "1", image: null, lines: ["Delivery and Installation fee"], unit: peso(t.delivery), total: peso(t.delivery) });

  // Header band — kayumangging-buhangin gaya ng orihinal, at bahagyang mataas
  // kaysa sa mga hilera para umangat ang pamagat ng column.
  const headH = 34;
  const drawTableHead = () => {
    box(X0, y, X5 - X0, headH, "#efe3c8");
    for (const x of [X1, X2, X3, X4]) vline(x, y, y + headH);
    text((X0 + X1) / 2, y + 22, "Qty", { bold: true, anchor: "middle" });
    text((X1 + X2) / 2, y + 22, "Item", { bold: true, anchor: "middle" });
    text((X2 + X3) / 2, y + 22, "Product Description", { bold: true, anchor: "middle" });
    text((X3 + X4) / 2, y + 22, "Unit Price", { bold: true, anchor: "middle" });
    text((X4 + X5) / 2, y + 22, "Total Price", { bold: true, anchor: "middle" });
    y += headH;
  };
  room(headH + 60);
  drawTableHead();
  tableHead = drawTableHead;

  // NAKA-CENTER ang presyo at qty sa loob ng column (kahilingan 2026-08-09) —
  // tumutugma sa orihinal na sheet. Ang description ay naka-kaliwa pa rin: mas
  // madaling sundan ang multi-line na detalye kapag pantay ang kaliwang gilid.
  for (const r of rows) {
    // Kapag may larawan, hindi bababa sa THUMB ang taas ng hilera para kasya ito.
    const textH = r.lines.length * LH + ROW_PAD * 2;
    const h = r.image ? Math.max(textH, THUMB + 16) : textH;
    // Ang hilera ay HINDI hinahati sa dalawang pahina — ang kama at ang
    // double walling nito ay magkasama lagi. Kapag hindi kasya, buong
    // hilera ang lilipat sa susunod na pahina (may sariling header band).
    room(h);
    box(X0, y, X5 - X0, h);
    for (const x of [X1, X2, X3, X4]) vline(x, y, y + h);
    // Ang description ay maaaring maraming linya, kaya may sariling simula ito;
    // ang qty at presyo ay naka-center sa GITNA ng hilera (rowMid) — kung nakatali
    // sila sa unang linya ng description, mukhang nakaangat sila kapag mataas ang
    // hilera dahil sa larawan (naiulat 2026-08-09 sa hilera ng kama).
    const rowMid = y + h / 2 + 5;
    const descTop = rowMid - ((r.lines.length - 1) * LH) / 2;
    text((X0 + X1) / 2, rowMid, r.qty, { anchor: "middle" });
    if (r.image) {
      // Naka-center sa cell, object-contain ang ugali (xMidYMid meet) kaya hindi
      // nababaluktot ang produkto anuman ang aspect ratio nito.
      const iw = X2 - X1 - 16;
      p.push(`<image href="${r.image}" x="${X1 + 8}" y="${y + (h - THUMB) / 2}" width="${iw}" height="${THUMB}" preserveAspectRatio="xMidYMid meet"/>`);
    }
    r.lines.forEach((ln, k) => text(X2 + 12, descTop + k * LH, ln));
    if (r.unitLines?.length) {
      // Per-line breakdown — katapat ng kaniyang description line.
      r.unitLines.forEach((amt, k) => {
        if (amt) text((X3 + X4) / 2, descTop + k * LH, amt, { anchor: "middle", bold: k === 0 });
      });
    } else {
      text((X3 + X4) / 2, rowMid, r.unit, { anchor: "middle" });
    }
    text((X4 + X5) / 2, rowMid, r.total, { anchor: "middle" });
    y += h;
  }

  // TOTAL PRICE — kasama ng huling hilera kung kasya, kung hindi ay
  // dadalhin ang header band para hindi nag-iisa ang kabuuan sa pahina.
  const totH = 30;
  room(totH);
  tableHead = null; // tapos na ang talahanayan — walang header band sa mga susunod na pahina
  box(X0, y, X5 - X0, totH);
  vline(X4, y, y + totH);
  text(X2 + 12, y + 20, "TOTAL PRICE", { bold: true });
  text((X4 + X5) / 2, y + 20, peso(t.total), { bold: true, anchor: "middle" });
  y += totH + 22;

  // ── PAYMENT TERMS ───────────────────────────────────────────────────────────
  // Ang halaga ay naka-center sa ILALIM ng Total Price column, kaya nakasunod sa
  // hanay ng talahanayan sa itaas — gaya ng orihinal na sheet.
  // Ang payment terms at refund policy ay magkasama sa iisang pahina —
  // ~130px; huwag hatiin ang "Downpayment" at ang "Balance".
  room(130);
  text(PAD, y, "Payment Terms (Cash)", { bold: true }); y += 20;
  // MAY BAYAD NA? Ang naibigay ang ipinapakita, hindi ang 30% ng bagong
  // kabuuan. Kung ang huli ang isusulat, mukhang wala pang naibabayad ang
  // customer gayong mayroon — at mas malaki pa ang hinihingi kaysa sa dati.
  const hasPaid = Number(input.paid) > 0;
  const paidAmt = hasPaid ? Number(input.paid) : 0;
  text(PAD, y, hasPaid ? `Downpayment (30%)${input.paidLabel ? ` — ${input.paidLabel}` : " — paid"}` : "Downpayment (30%)");
  text((X4 + X5) / 2, y, peso(hasPaid ? paidAmt : t.downpayment), { anchor: "middle" }); y += 19;
  text(PAD, y, hasPaid ? "Balance upon delivery and installation" : "Upon delivery and installation");
  text((X4 + X5) / 2, y, peso(hasPaid ? t.total - paidAmt : t.balance), { anchor: "middle" }); y += 19 + 16;

  // ── REFUND POLICY ───────────────────────────────────────────────────────────
  text(PAD, y, "Refund Policy:", { bold: true, italic: true });
  text(PAD + 96, y, "We offer refunds or exchanges for defective products within 3 days of delivery.", { italic: true }); y += 18;
  text(PAD, y, "Please note that down payments are non-refundable. Defective products will be repaired or exchanged promptly.", { italic: true, size: 12.5 });
  y += 18 + 14;

  // ── BANK DETAILS ────────────────────────────────────────────────────────────
  room(17 * 3 + 6 + 19 + 18 * BANKS.length + 16);
  for (const ln of wrap(
    "To confirm the order, you may send the 30% downpayment to any of the following accounts. Kindly note that all downpayments are strictly non-refundable, as they are used to secure materials and begin processing your order.",
    112,
  )) { text(PAD, y, ln, { italic: true, size: 12.5 }); y += 17; }
  y += 6;
  text(PAD, y, "FOR CASH PAYMENTS", { bold: true }); y += 19;
  for (const b of BANKS) {
    // Naka-tsek na kahon sa unahan, gaya ng orihinal. Iginuhit (hindi glyph) para
    // hindi umasa sa font na baka wala sa server ng Meta kapag nire-render.
    p.push(`<rect x="${PAD}" y="${y - 9}" width="10" height="10" fill="none" stroke="${LINE}" stroke-width="1"/>`);
    p.push(`<path d="M${PAD + 2} ${y - 4} l 3 3 l 5 -7" fill="none" stroke="${LINE}" stroke-width="1.4"/>`);
    text(PAD + 16, y, `${b.bank} — Account name: ${b.name}   Account number: ${b.account}`, { size: 12.5 });
    y += 18;
  }
  y += 16;

  // ── QR CARDS (BPI at BDO, katabi) ───────────────────────────────────────────
  // Ang mga card ay LARAWANG ina-upload ng admin (InstaPay QR ng bawat bangko) —
  // hindi kayang buuin ng code. Kapag wala pa, lalaktawan lang ang bahaging ito;
  // nasa itaas na ang account numbers, kaya kumpleto pa rin ang quotation.
  // WALANG QR (desisyon 2026-08-20): kapag may QR sa larawan, ini-scan ito
  // ng Messenger app sa panig ng NAKAKAKITA at kusang nagdadagdag ng "QR
  // transfer / Transfer with Maya / MariBank" card + instructions. Hindi ito
  // mensahe natin at walang Send API parameter na makakapigil — ang tanging
  // kontrol ay ang huwag isama ang QR. Ang BPI/BDO account numbers ay nasa
  // document pa rin. Ipasa ang hideQr: false kung kailangan talaga ang QR.
  const cards = (input.hideQr !== false
    ? []
    : [
        { img: input.bpiQr, bank: "BPI", account: BANKS[0].account },
        { img: input.bdoQr, bank: "BDO Unibank, Inc.", account: BANKS[1].account },
      ]
  ).filter((c) => c.img);
  if (cards.length) {
    // NAKA-CENTER ang grupo ng cards sa pahina, gaya ng orihinal na sheet.
    // Ang ina-upload na larawan ay BUONG card na (may sariling header band at
    // account text), kaya inilalagay lang ito nang buo — walang dinadagdag na
    // banda para hindi madoble.
    const CW = 300, CH = 190, GAP = 26;
    room(CH + 24);
    const groupW = cards.length * CW + (cards.length - 1) * GAP;
    const startX = PAD + Math.max(0, (X5 - X0 - groupW) / 2);
    cards.forEach((c, i) => {
      const cx = startX + i * (CW + GAP);
      p.push(`<image href="${c.img}" x="${cx}" y="${y}" width="${CW}" height="${CH}" preserveAspectRatio="xMidYMid meet"/>`);
    });
    y += CH + 24;
  }

  // ── PASASALAMAT + LAGDA ─────────────────────────────────────────────────────
  // Pareho ng orihinal: NAKA-CENTER ang pasasalamat, at ang lagda ay nakapatong
  // sa itaas ng pangalan sa gitna ng pahina.
  const MID = (X0 + X5) / 2;
  // Pasasalamat + lagda + pangalan — isang bloke, hindi hinahati.
  room(34 + 54 + 16 + 20);
  text(MID, y, "Thank you for giving us an opportunity to submit our proposal. We look forward to working with you.", { italic: true, size: 12.5, anchor: "middle" });
  y += 34;
  if (input.signature) {
    // Ang lagda ay nakalapat sa ibabaw ng pangalan (nag-o-overlap nang bahagya,
    // gaya ng tunay na pirma sa papel), kaya negatibo ang offset sa ibaba.
    const SW = 150, SH = 54;
    p.push(`<image href="${input.signature}" x="${MID - SW / 2}" y="${y}" width="${SW}" height="${SH}" preserveAspectRatio="xMidYMid meet"/>`);
    y += SH - 6;
  } else {
    y += 24;
  }
  text(MID, y, SIGNATORY, { bold: true, anchor: "middle" });
  y += 16;
  text(MID, y, COMPANY.name, { size: 10, fill: "#6b5d42", anchor: "middle" });

  pages.push(p);

  // ISANG PAHINA: eksaktong taas ng laman, gaya ng dati. MARAMI: bawat isa
  // ay A4 ang sukat, may "Page i of n" sa ibaba — para alam ng bumabasa sa
  // Messenger kung ilang larawan ang buong dokumento.
  const single = pages.length === 1;
  const H = single ? Math.ceil(y + PAD) : PAGE_H;
  return pages.map((ops, i) => {
    const foot = single
      ? ""
      : `<text x="${RIGHT}" y="${PAGE_H - PAD + 8}" font-size="11" text-anchor="end" fill="#8a7c6b">Page ${i + 1} of ${pages.length}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#ffffff"/>
<g font-family="Arial, Helvetica, sans-serif" fill="${INK}">
${ops.join("\n")}
${foot}
</g>
</svg>`;
  });
}

// ANG BUONG DOKUMENTO SA ISANG SVG — para sa viewer, sa download at sa
// imbakan. Isang pahina kapag kasya; kapag marami, nakasalansan ang mga
// pahina na may manipis na kulay-abong pagitan, gaya ng papel sa mesa.
// Ang Messenger ay HINDI ito ang ipinapadala — doon ay bawat pahina nang
// hiwalay (renderQuotationSvgPages), kung hindi ay babalik ang manipis na guhit.
export function renderQuotationSvg(input: QuoteInput): string {
  const pages = renderQuotationSvgPages(input);
  if (pages.length === 1) return pages[0];
  const W = 940;
  const GAP = 14;
  // Ang bawat pahina ay buong <svg> na — ilagay bilang nested <svg y=…>, na
  // tinatanggap ng SVG at ng mga browser; hindi na kailangang hiwain ang laman.
  const hs = pages.map((pg) => Number((pg.match(/height="(\d+)"/) ?? [])[1]) || 0);
  const H = hs.reduce((a, b) => a + b, 0) + GAP * (pages.length - 1);
  let off = 0;
  const inner = pages
    .map((pg, i) => {
      const s = `<svg y="${off}"${pg.slice("<svg".length)}`;
      off += hs[i] + GAP;
      return s;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#d9d2c3"/>
${inner}
</svg>`;
}
