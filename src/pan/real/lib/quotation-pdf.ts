import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { quoteTotals, type QuoteInput } from "@/lib/quotation";

// QUOTATION PDF (2026-08-21) — ang buong quotation bilang isang-pahinang PDF,
// ipinapadala kasunod ng larawan sa Messenger thread.
//
// BAKIT PDF: kapag may QR sa LARAWAN, ini-scan ito ng Messenger app ng
// tumatanggap at kusang nagdadagdag ng "QR transfer / Transfer with Maya /
// MariBank" card — hindi mensahe natin at walang Send API na pumipigil. Ang
// PDF ay hindi ini-scan, kaya doon nakalagay ang bank QR cards.
//
// BAKIT PUROng jsPDF (walang sharp): ang sharp ay native binary at ang npm ay
// nag-i-install lang ng binaries ng KASALUKUYANG platform — Windows dito, kaya
// walang Linux libvips sa Vercel ("ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3").
// Ang pagpilit ng Linux packages sa dependencies ay sumisira naman sa local
// `npm install`. Kaya ito ay iginuguhit nang deretso: teksto, kahon, at ang mga
// naka-embed na larawan (data URI mula sa Quotation assets).

const INK = 17, MUTED = 110;

export async function renderQuotationPdf(input: QuoteInput): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const t = quoteTotals(input);
  const peso = (n: number) => `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // A4 portrait — pamilyar na sukat, mabilis buksan, malinis kapag ni-print.
  const W = 595, H = 842, PAD = 36;
  const RIGHT = W - PAD;
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  let y = PAD;

  // ANG ₱ AY WALA SA HELVETICA. Ang mga built-in na font ng PDF ay WinAnsi;
  // ang U+20B1 ay tahimik na bumabagsak sa pinakamalapit na byte at lumalabas
  // na "±" sa dokumentong natatanggap ng customer — walang error, walang
  // kulang na glyph box, ibang simbolo lang.
  //
  // Isang font lang ang idinadagdag PARA SA ₱; helvetica pa rin ang lahat ng
  // iba. Ang Geist ay ~6% na mas malapad, at ang word-wrap dito ay bilang ng
  // titik (hindi lapad) — kapag ito ang naging font ng buong dokumento,
  // lalabas sa hangganan ng hanay ang mahahabang linya. Sarili nitong glyph
  // lang ang naka-embed (subset), kaya ~1KB lang ang idinagdag sa PDF.
  let pesoFont: string | null = null;
  try {
    // WALANG MODULE RESOLUTION DITO (2026-08-28). Ang `.ttf` ay BASAHIN, hindi
    // i-import — pero ang `createRequire(...).resolve(REL)` na may variable na
    // specifier ay itinuturing pa rin ng Turbopack na dynamic import, at
    // ini-uulat nito ang buong module bilang "Can't resolve <dynamic>" tuwing
    // kino-compile ang quotations. (Ang literal namang `.ttf` na string ay
    // sinusubukan nitong i-bundle bilang module — "Unknown module type" — kaya
    // pinagdudugtong pa rin ang specifier.)
    //
    // Plain path search na lang: sinusubukan ang mga kilalang lugar hanggang may
    // mabasa. Ang cwd ng lambda ay hindi ang cwd ng dev server, kaya hindi
    // sapat ang iisang hula — pero tatlong subok ay sapat, at ang bawat pagkabigo
    // ay nauuwi lang sa nawawalang simbolo, hindi sa nawawalang PDF.
    const REL = ["next/dist/compiled", "@vercel/og", "Geist-Regular" + ".ttf"].join("/");
    const roots = [process.cwd(), path.join(process.cwd(), ".."), "/var/task"];
    let ttf: Buffer | null = null;
    for (const root of roots) {
      try { ttf = await readFile(path.join(root, "node_modules", REL)); break; }
      catch { /* subukan ang susunod */ }
    }
    if (!ttf) throw new Error("peso font not found");
    doc.addFileToVFS("GeistPeso.ttf", ttf.toString("base64"));
    doc.addFont("GeistPeso.ttf", "GeistPeso", "normal");
    pesoFont = "GeistPeso";
  } catch {
    // Walang font: ang bilang ay nananatiling tama, ang simbolo ang nawawala.
    // Mas mabuti kaysa "±" — huwag i-render ang tandang mali.
    pesoFont = null;
  }


  const text = (x: number, yy: number, s: string, o: { size?: number; bold?: boolean; align?: "left" | "center" | "right"; color?: number; italic?: boolean } = {}) => {
    const helv = () => doc.setFont("helvetica", o.bold ? "bold" : o.italic ? "italic" : "normal");
    const size = o.size ?? 8.5;
    doc.setFontSize(size).setTextColor(o.color ?? INK);
    const align = o.align ?? "left";

    // Walang ₱ sa string (o walang font para dito): isang guhit lang, gaya ng dati.
    if (!s.includes("₱") || !pesoFont) {
      helv();
      doc.text(pesoFont ? s : s.replace(/₱/g, ""), x, yy, { align });
      return;
    }

    // MAY ₱: pinagsasama ang dalawang font sa isang linya, kaya ang posisyon ay
    // kinakalkula mano-mano — hindi kayang paghaluin ng align option ng jsPDF
    // ang magkaibang font sa isang tawag.
    const segs = s.split(/(₱)/).filter(Boolean);
    const widthOf = (seg: string) => {
      if (seg === "₱") doc.setFont(pesoFont!, "normal");
      else helv();
      return doc.getTextWidth(seg);
    };
    const total = segs.reduce((sum, seg) => sum + widthOf(seg), 0);
    let cx = align === "right" ? x - total : align === "center" ? x - total / 2 : x;
    for (const seg of segs) {
      if (seg === "₱") doc.setFont(pesoFont!, "normal");
      else helv();
      doc.text(seg, cx, yy, { align: "left" });
      cx += doc.getTextWidth(seg);
    }
  };
  const img = (data: string | null | undefined, x: number, yy: number, w: number, h: number) => {
    if (!data) return;
    for (const fmt of ["PNG", "JPEG"] as const) {
      try { doc.addImage(data, fmt, x, yy, w, h, undefined, "FAST"); return; } catch { /* subukan ang susunod */ }
    }
  };

  // ── HEADER: pamagat + Date/Name/Address, logo sa kanan ──
  text(PAD, y + 16, "QUOTATION", { size: 18, bold: true });
  img(input.logo, RIGHT - 62, y - 4, 62, 62);
  y += 30;
  const LBL = 58, FLD = 250, RH = 17;
  // ANG ADDRESS AY NAGWA-WRAP, HINDI PINUPUTOL. Ang buong address mula sa
  // website (kalye, barangay, city, probinsya, postal) ay umaabot ng 80+ na
  // titik; ang dating .slice(0, 58) ay tahimik na nagtatapon ng lungsod at
  // probinsya, at ang PDF ang ipinapadala sa customer bilang dokumento.
  const wrapAt = 58;
  const wrapPdf = (v: string) => {
    const out: string[] = [];
    let line = "";
    for (const w of String(v).split(/\s+/).filter(Boolean)) {
      if (!line) line = w;
      else if ((line + " " + w).length <= wrapAt) line += " " + w;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
    return out.length ? out : ["—"];
  };
  for (const [label, value] of [["Date:", input.dateLabel], ["Name:", input.customerName || "—"], ["Address:", input.address || "—"]] as const) {
    const lines = wrapPdf(String(value));
    const h = Math.max(RH, lines.length * 11 + 6);
    doc.setDrawColor(20).setLineWidth(0.6);
    doc.rect(PAD, y, LBL, h);
    doc.rect(PAD + LBL, y, FLD, h);
    text(PAD + 5, y + 12, label, { bold: true });
    lines.forEach((l, i) => text(PAD + LBL + 6, y + 12 + i * 11, l));
    y += h;
  }
  y += 16;

  text(PAD, y, "Dear Sir/Maam:", { bold: true }); y += 12;
  text(PAD, y, "Greetings from PAN Furniture Maker, Interior Decorator and Contractor!"); y += 12;
  text(PAD, y, "We are pleased to submit to you our quotation for the following:"); y += 18;

  // ── TALAHANAYAN ──
  const X0 = PAD, X1 = PAD + 34, X2 = PAD + 100, X3 = PAD + 340, X4 = PAD + 440, X5 = RIGHT;
  const head = 20;
  const tableHead = () => {
    doc.setFillColor(239, 227, 200).setDrawColor(20);
    doc.rect(X0, y, X5 - X0, head, "FD");
    for (const x of [X1, X2, X3, X4]) doc.line(x, y, x, y + head);
    for (const [x0, x1, label] of [[X0, X1, "Qty"], [X1, X2, "Item"], [X2, X3, "Product Description"], [X3, X4, "Unit Price"], [X4, X5, "Total Price"]] as const) {
      text((x0 + x1) / 2, y + 13, label, { bold: true, align: "center" });
    }
    y += head;
  };
  tableHead();

  // MARAMING PAHINA (2026-08-22). Isang A4 lang ito noon, kaya ang mahabang
  // quotation ay naguguhit sa labas ng pahina at TAHIMIK NA NAWAWALA — sa
  // FQ-000031, ang Refund Policy, ang bank accounts at ang pirma ay
  // naputol. Ang isang hilera ay hindi hinahati sa dalawang pahina: buo ang
  // build ng isang produkto o nasa susunod na pahina ito.
  const BOTTOM = H - PAD;
  const newPage = (withHead: boolean) => {
    doc.addPage();
    y = PAD;
    if (withHead) tableHead();
  };
  const room = (need: number, withHead = true) => {
    if (y + need <= BOTTOM) return;
    newPage(withHead);
  };

  const LH = 11, THUMB = 52;
  const rows = (input.items ?? []).filter((it) => String(it.description ?? "").trim() || Number(it.unitPrice) > 0);
  for (const it of rows) {
    const lines = String(it.description ?? "—").split("\n").flatMap((l) => doc.splitTextToSize(l, X3 - X2 - 12) as string[]);
    const rowH = Math.max(lines.length * LH + 14, it.image ? THUMB + 12 : 24);
    room(rowH);
    doc.setDrawColor(20).rect(X0, y, X5 - X0, rowH);
    for (const x of [X1, X2, X3, X4]) doc.line(x, y, x, y + rowH);
    const mid = y + rowH / 2 + 3;
    text((X0 + X1) / 2, mid, String(Number(it.qty) || 0), { align: "center" });
    if (it.image) img(it.image, X1 + 6, y + (rowH - THUMB) / 2, X2 - X1 - 12, THUMB);
    const top = mid - ((lines.length - 1) * LH) / 2;
    lines.forEach((ln, i) => text(X2 + 6, top + i * LH, ln));
    // Unit Price: per-line breakdown kapag may lineParts, kung hindi isang halaga.
    if (it.lineParts?.length) {
      const src = String(it.description ?? "").split("\n");
      let li = 0, baseShown = false, wy = top;
      for (const srcLine of src) {
        const n = srcLine ? Math.max(1, (doc.splitTextToSize(srcLine, X3 - X2 - 12) as string[]).length) : 1;
        const amt = it.lineParts[li];
        if (amt != null && amt !== 0) {
          text((X3 + X4) / 2, wy, baseShown ? `+${peso(amt)}` : peso(amt), { align: "center", bold: !baseShown });
          baseShown = true;
        }
        wy += n * LH; li++;
      }
    } else {
      text((X3 + X4) / 2, mid, peso(it.unitPrice), { align: "center" });
    }
    text((X4 + X5) / 2, mid, peso((Number(it.qty) || 0) * (Number(it.unitPrice) || 0)), { align: "center" });
    y += rowH;
  }
  // Delivery — laging may hilera, gaya ng orihinal.
  room(22);
  doc.rect(X0, y, X5 - X0, 22);
  for (const x of [X1, X2, X3, X4]) doc.line(x, y, x, y + 22);
  text((X0 + X1) / 2, y + 14, "1", { align: "center" });
  text(X2 + 6, y + 14, "Delivery and Installation fee");
  text((X3 + X4) / 2, y + 14, peso(t.delivery), { align: "center" });
  text((X4 + X5) / 2, y + 14, peso(t.delivery), { align: "center" });
  y += 22;
  room(20);
  doc.rect(X0, y, X5 - X0, 20);
  doc.line(X4, y, X4, y + 20);
  text(X2 + 6, y + 13, "TOTAL PRICE", { bold: true });
  text((X4 + X5) / 2, y + 13, peso(t.total), { bold: true, align: "center" });
  y += 34;

  // ── PAYMENT TERMS ──
  // Ang buong footer (terms + refund + accounts) ay humigit-kumulang 120pt.
  // Kapag hinati, ang "Downpayment (30%)" ay mapupunta sa isang pahina at ang
  // halaga sa isa pa — kaya buo ito o nasa bagong pahina. Walang table header
  // dito: tapos na ang talahanayan.
  room(120, false);
  text(PAD, y, "Payment Terms (Cash)", { bold: true }); y += 12;
  text(PAD, y, "Downpayment (30%)"); text(RIGHT, y, peso(t.downpayment), { align: "right" }); y += 12;
  text(PAD, y, "Upon delivery and installation"); text(RIGHT, y, peso(t.balance), { align: "right" }); y += 20;

  text(PAD, y, "Refund Policy:", { bold: true, italic: true });
  text(PAD + 60, y, "We offer refunds or exchanges for defective products within 3 days of delivery.", { italic: true }); y += 11;
  text(PAD, y, "Please note that down payments are non-refundable. Defective products will be repaired or exchanged promptly.", { italic: true }); y += 18;

  for (const ln of doc.splitTextToSize(
    "To confirm the order, you may send the 30% downpayment to any of the following accounts. Kindly note that all downpayments are strictly non-refundable, as they are used to secure materials and begin processing your order.",
    X5 - X0,
  ) as string[]) { text(PAD, y, ln); y += 11; }
  y += 8;
  text(PAD, y, "FOR CASH PAYMENTS", { bold: true }); y += 12;
  text(PAD, y, "BPI - Account name: Jessone Purificacion   Account number: 8529594349"); y += 11;
  text(PAD, y, "BDO Unibank, Inc. - Account name: Jessone Purificacion   Account number: 006960153572"); y += 16;

  // ── QR CARDS — ito ang dahilan ng PDF ──
  const cards = [input.bpiQr, input.bdoQr].filter(Boolean) as string[];
  if (cards.length) {
    const CW = 190, CH = 124, GAP = 22;
    // Ang QR + ang pirma sa ilalim nito ay ~200pt.
    room(CH + 80, false);
    const startX = PAD + Math.max(0, (X5 - X0 - (cards.length * CW + (cards.length - 1) * GAP)) / 2);
    cards.forEach((c, i) => img(c, startX + i * (CW + GAP), y, CW, CH));
    y += CH + 14;
  }

  room(70, false);
  text(W / 2, y, "Thank you for giving us an opportunity to submit our proposal. We look forward to working with you.", { align: "center", italic: true });
  y += 26;
  img(input.signature, W / 2 - 30, y - 14, 60, 26);
  y += 20;
  doc.setDrawColor(150).line(W / 2 - 80, y - 4, W / 2 + 80, y - 4);
  text(W / 2, y + 8, "Jessone B. Purificacion", { align: "center", bold: true, size: 9 });
  text(W / 2, y + 19, "PURIFICACION AND NORIEGA FURNITURE SHOP CO.", { align: "center", size: 7, color: MUTED });

  return Buffer.from(doc.output("arraybuffer"));
}
