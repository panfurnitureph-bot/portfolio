// Server-safe BIR Service Invoice model + SVG renderer. Mirrors the line model in
// components/receipt-bir-button.tsx so the auto-attached receipt is byte-for-byte
// the same official invoice — but generated server-side (no DOM) for attachment.
import type { OrderRow } from "@/lib/supabase/server";
import { emailShell, panel, sectionTitle, intro, kvTable, mono, itemList, totalsTable, bigStat, attachmentNote, qrBox, whatsNext, esc, peso as pesoHtml, longDate, gmailOrderSchema, TAG_DELIVERED, TAG_THIS, TAG_NEXT, type EmailItem, type KvRow, type TotalRow } from "@/lib/email/layout";

// PARTIAL DELIVERY tags (2026-09-03): ang tumatawag (server) ang nagbibigay ng
// mapa via batchTagsFor — dito lang inilalapat, para manatiling malinis sa
// client bundle ang file na ito (inaangkat ito ng receipt button).
export type ReceiptBatchTags = ReadonlyMap<string, "this" | "delivered" | "next"> | null;
const tagCards = (cards: EmailItem[], tags: ReceiptBatchTags): EmailItem[] => !tags ? cards : cards.map((c) => {
  const t = tags.get(String(c.name ?? "").trim().toLowerCase());
  if (t === "this") return { ...c, tag: TAG_THIS };
  if (t === "delivered") return { ...c, tag: TAG_DELIVERED };
  if (t === "next") return { ...c, tag: TAG_NEXT, dimmed: true };
  return c;
});

const CO = {
  name: "PURIFICACION AND NORIEGA FURNITURE SHOP CO.",
  vatTin: "VAT Reg. TIN: 631-230-396-00000",
  addr: "Blk. 27 Lot 4 Amorsolo St., Chrysanthemum Village, Chrysanthemum 4023, City of San Pedro Laguna, Philippines",
};
// Pinalit 2026-08-10 (hiling ni Joe): tanggal ang printer-accreditation block
// (Bklts/Authority to Print/JANEROSE) at ang "valid for five years" — para sa
// PRE-PRINTED na booklet ang mga iyon; system-generated ang invoice na ito.
// Ang kapalit ay ang BIR disclaimer sa ibaba.
const DISCLAIMER_HEAD = '"THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAXES"';
const DISCLAIMER_BODY =
  '"This document shall not be allowed as proof for the claim of deductible expense if upon ' +
  'verification, this BIR Printed Invoice has not been authorized and distributed by the BIR."';

const COLS = 48;
const peso2 = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const peso = (n: number) => "₱" + peso2(n);

function twoCol(left: string, right: string, cols = COLS): string {
  const space = cols - left.length - right.length;
  if (space < 1) return left + "\n" + right.padStart(cols) + "\n";
  return left + " ".repeat(space) + right + "\n";
}
function wrap(text: string, cols = COLS): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    if (!cur.length) cur = wd;
    else if (cur.length + 1 + wd.length <= cols) cur += " " + wd;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines.join("\n") + "\n";
}
function fdate(v: string): string {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

type Line = { t: string; bold?: boolean; center?: boolean };
type Item = { qty: number; description: string; unitPrice: number; customized?: boolean; image?: string | null; category?: string | null };
export type PaymentInfo = { via: string; receiptNumber: string; paymentId: string; reference: string; amount: number };

function itemsFromOrder(order: OrderRow): Item[] {
  if (order.receipt_items && order.receipt_items.length) {
    return order.receipt_items.map((it) => ({
      qty: Number(it.qty) || 1,
      // BUONG description na LAGI (2026-08-17): kasama ang spec bullets ng
      // bawat item sa resibo — customized man o galing sa catalog (dating
      // pinuputol sa unang linya ang hindi customized kaya nawawala ang specs).
      description: (it.description ?? "").trim(),
      unitPrice: Number(it.unitPrice) || 0,
      customized: !!it.customized,
      image: it.image ?? null,
      category: it.category ?? null,
    }));
  }
  return [{ qty: 1, description: [order.product_name, order.color, order.dimension].filter(Boolean).join(" / "), unitPrice: Number(order.full_payment_price ?? 0), category: order.category ?? null }];
}

function itemLines(qty: number, name: string, amount: number): string[] {
  const price = "₱" + peso2(amount);
  // Customized items ay multi-line (specs bullets) — unang linya ang may presyo.
  const [first, ...restRaw] = name.split("\n");
  // DEDUPE (2026-08-19): ang lumang orders ay may hiwalay na color bullet na
  // kapareho ng Fabric/Upholstered line — huwag nang iprint nang doble.
  const clean = (s: string) => s.trim().replace(/^[•·*\-\s]+/, "");
  const fabricVals = restRaw
    .map((r) => /^(?:Fabric(?:\s*\/\s*Finish)?|Upholstered Finish):\s*(.+)$/.exec(clean(r))?.[1]?.trim().toLowerCase())
    .filter(Boolean) as string[];
  const rest = restRaw.filter((r) => !fabricVals.includes(clean(r).toLowerCase()));
  const lines = wrap(`${qty}x ${first}`).trimEnd().split("\n");
  const last = lines.length - 1;
  if (lines[last].length + 1 + price.length <= COLS) lines[last] = lines[last] + " ".repeat(COLS - lines[last].length - price.length) + price;
  else lines.push(price.padStart(COLS));
  // "*" ang bullet sa RESIBO (hiling 2026-08-18) — tugma sa preview/thermal.
  for (const r of rest) wrap("  " + r.trim().replace(/^[•·]\s*/, "* ")).trimEnd().split("\n").forEach((t) => lines.push(t));
  return lines;
}

function birModel(order: OrderRow, payment?: PaymentInfo): Line[] {
  const items = itemsFromOrder(order);
  const invoiceNo = order.order_number ?? "______";
  const date = (order.date_order ?? "").slice(0, 10);
  const registeredName = order.customer_name ?? "";
  const businessAddress = order.address ?? "";
  const totalSales = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  // SC/PWD/NAAC etc. discounts recorded on the order REDUCE the gross before VAT — a
  // discounted (esp. senior/PWD) sale must show the lower VAT and total due, not the
  // raw line-item VAT. Sum the saved discounts and net them out.
  const discount = (order.receipt_discounts ?? []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const grossAfterDiscount = Math.max(totalSales - discount, 0);
  const vat = grossAfterDiscount * (12 / 112);
  const netOfVat = grossAfterDiscount - vat;
  const due = grossAfterDiscount;
  const dashes = "-".repeat(COLS), eq = "=".repeat(COLS);
  const out: Line[] = [];
  const push = (t: string, o: Partial<Line> = {}) => out.push({ t, ...o });
  const cols = (s: string, o: Partial<Line> = {}) => s.trimEnd().split("\n").forEach((t) => out.push({ t, ...o }));

  wrap(CO.name).trimEnd().split("\n").forEach((t) => out.push({ t, center: true, bold: true }));
  wrap(CO.vatTin).trimEnd().split("\n").forEach((t) => out.push({ t, center: true }));
  wrap(CO.addr).trimEnd().split("\n").forEach((t) => out.push({ t, center: true }));
  push(eq);
  // "ACKNOWLEDGMENT RECEIPT" na ang pamagat (hiling 2026-08-10) — dating
  // SERVICE INVOICE; ang numero ay ang order number pa rin.
  cols(twoCol("ACKNOWLEDGMENT RECEIPT", "No. " + invoiceNo), { bold: true });
  push("[X] CASH SALES   [ ] CHARGE SALES");
  push("Date: " + fdate(date));
  push(dashes);
  const fill = (label: string, val: string) => (val ? wrap(`${label}: ${val}`) : `${label}: ${"_".repeat(Math.max(4, COLS - label.length - 2))}\n`);
  push("CUSTOMER:", { bold: true });
  fill("Registered Name", registeredName).trimEnd().split("\n").forEach((t) => push(t));
  fill("TIN", "").trimEnd().split("\n").forEach((t) => push(t));
  fill("Business Address", businessAddress).trimEnd().split("\n").forEach((t) => push(t));
  push(dashes);
  push("ITEM / NATURE OF SERVICE", { bold: true });

  // ANG MGA BAYAD AY LAGING SA DULO (2026-08-22). Ang shipping ay dating
  // nakaupo sa pagkakasunod ng receipt_items, kaya nang may naidagdag na
  // produkto sa isang order na mayroon na, napunta ito sa GITNA — sa pagitan
  // ng Item 1 at Item 2 — at parang bayad lang ng nauna. Ang bayad ay pag-aari
  // ng buong order, kaya nasa ilalim ng lahat ng produkto.
  const isFeeItem = (it: { description?: string }) =>
    /^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test(
      String(it.description ?? "").split("\n")[0].trim(),
    );
  // DALAWANG URI ANG BAYAD (2026-08-29). Ang "Shipping — Lumban, Laguna" ay
  // pag-aari ng BUONG order, kaya nasa dulo. Ang "Addtl. Shipping Fee" at
  // "Addtl. Rush Fee" ay pag-aari ng ISANG PRODUKTO — ganoon sila idinagdag sa
  // Edit Order, inline sa tabi ng item. Nang isama sila sa dulo, labing-apat na
  // magkakaparehong ₱123.00 ang nakahanay at wala nang makapagsasabi kung alin
  // ang may dalang dagdag. Ang kanilang lugar ay sa ilalim ng produkto nila.
  const isPerItemFee = (it: { description?: string }) =>
    /^addtl\.?\s|^additional\s/i.test(String(it.description ?? "").split("\n")[0].trim());
  const products = items.filter((it) => !isFeeItem(it));
  const fees = items.filter((it) => isFeeItem(it) && !isPerItemFee(it));
  const amtOf = (it: { qty?: number; unitPrice?: number }) => (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);

  // KANINO NAKAKABIT ANG BAWAT DAGDAG. Ang kaugnayan ay nasa PAGKAKASUNOD-SUNOD
  // ng receipt_items — isinisingit sila ng editor kaagad pagkatapos ng item na
  // pinagmulan (tingnan ang addFee sa line-items-editor). Kaya ang huling
  // produktong nadaanan ang may-ari.
  const feesByProduct = new Map<number, typeof items>();
  {
    let owner = -1;
    for (const it of items) {
      // Umaakyat ang bilang habang dumadaan sa produkto — hindi `indexOf`, na
      // ibabalik ang UNA kapag dalawang beses lumitaw ang iisang object.
      if (!isFeeItem(it)) { owner += 1; continue; }
      if (!isPerItemFee(it) || owner < 0) continue;
      const list = feesByProduct.get(owner) ?? [];
      list.push(it);
      feesByProduct.set(owner, list);
    }
  }

  // Isang linya kada dagdag, naka-indent sa ilalim ng produkto: "  + Shipping
  // Fee    ₱123.00". Ang "+" ang nagsasabing dagdag ito sa presyo sa itaas.
  const feeLine = (it: { description?: string; qty?: number; unitPrice?: number }) => {
    const name = String(it.description ?? "").split("\n")[0].trim().replace(/^addtl\.?\s*|^additional\s*/i, "");
    return twoCol(`  + ${name}`, peso(amtOf(it)));
  };

  products.forEach((it, i) => {
    // BILANG KADA PRODUKTO. Ang isang order ay pwede nang may tatlong
    // pinagmulan; kung walang numero, magkakasunod-sunod na bloke lang ng
    // teksto at hindi malalaman kung ilan ang binili.
    if (i > 0) out.push({ t: "-".repeat(COLS) });
    if (products.length > 1) out.push({ t: `ITEM ${i + 1} OF ${products.length}`, bold: true });
    // Header sa ibabaw ng item = CATEGORY nito (hiling 2026-08-17) — hal.
    // "* PROMO *" / "* BED *"; kapag walang category pero customized ang item,
    // "* CUSTOMIZED *" pa rin.
    const catHead = (it.category ?? "").trim().toUpperCase() || (it.customized ? "CUSTOMIZED" : "");
    if (catHead) out.push({ t: `* ${catHead} *`, bold: true });
    itemLines(Number(it.qty) || 0, it.description, amtOf(it)).forEach((t) => out.push({ t, bold: true }));
    for (const f of feesByProduct.get(i) ?? []) cols(feeLine(f), { bold: true });
    out.push({ t: "" });
  });

  // FEES (Shipping/Rush) — hindi "1x" na item line (hiling 2026-08-19):
  // isang linya lang, kasama ang lugar: "Shipping — Paete, Laguna   ₱1.00".
  if (fees.length) {
    out.push({ t: "-".repeat(COLS) });
    for (const it of fees) {
      const descLines = String(it.description ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
      const place = descLines.slice(1).map((l) => l.replace(/^[•·*\-\s]+/, "")).filter(Boolean).join(", ");
      cols(twoCol(descLines[0] + (place ? ` — ${place}` : ""), peso(amtOf(it))), { bold: true });
    }
    out.push({ t: "" });
  }
  push(dashes);
  cols(twoCol("Total Sales (VAT Inclusive)", peso(totalSales)), { bold: true });
  cols(twoCol("Less: Discount (SC/PWD/NAAC/MOV/SP)", discount > 0 ? "-" + peso(discount) : "-"), { bold: true });
  cols(twoCol("Less: VAT", peso(vat)), { bold: true });
  cols(twoCol("Amount: Net of VAT", peso(netOfVat)), { bold: true });
  cols(twoCol("Add: VAT", "-"), { bold: true });
  cols(twoCol("Less: Withholding Tax", "-"), { bold: true });
  push(dashes);
  cols(twoCol("TOTAL AMOUNT DUE", peso(due)), { bold: true });
  push(eq);
  cols(twoCol("VATable Sales", peso(netOfVat)), { bold: true });
  cols(twoCol("VAT", peso(vat)), { bold: true });
  cols(twoCol("Zero-Rated Sales", peso(0)), { bold: true });
  cols(twoCol("VAT-Exempt Sales", peso(0)), { bold: true });
  push(dashes);
  // Payment details (electronic) — Maya QR Ph
  if (payment) {
    push("PAYMENT DETAILS", { bold: true });
    cols(twoCol("Paid via", payment.via), { bold: true });
    if (payment.amount > 0) cols(twoCol("Amount Paid", peso(payment.amount)), { bold: true });
    cols(twoCol("Maya Receipt No.", payment.receiptNumber || "-"), { bold: true });
    wrap(`Payment ID: ${payment.paymentId || "-"}`).trimEnd().split("\n").forEach((t) => push(t));
    wrap(`Reference No.: ${payment.reference || "-"}`).trimEnd().split("\n").forEach((t) => push(t));
    push(dashes);
  }
  push("Received the amount of:");
  push(payment ? `  ${payment.via}${payment.amount > 0 ? "  " + peso(payment.amount) : ""}` : "____________________________");
  push("");
  push("Signature: _________________________");
  push(dashes);
  wrap(DISCLAIMER_HEAD).trimEnd().split("\n").forEach((t) => push(t, { center: true, bold: true }));
  push("");
  wrap(DISCLAIMER_BODY).trimEnd().split("\n").forEach((t) => push(t, { center: true }));
  return out;
}

const escXml = (s: string) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

// Render the BIR invoice to a monospace SVG string (72mm-style receipt).
export function renderBirInvoiceSvg(order: OrderRow, payment?: PaymentInfo): string {
  const lines = birModel(order, payment);
  const CH = 8.4, FS = 14, LH = 19, PAD = 22;
  const W = Math.ceil(COLS * CH + PAD * 2);
  const H = Math.ceil(lines.length * LH + PAD * 2);
  const body = lines.map((ln, i) => {
    const y = PAD + FS + i * LH;
    const weight = ln.bold ? ' font-weight="700"' : "";
    if (ln.center) {
      return `<text x="${W / 2}" y="${y}" text-anchor="middle"${weight}>${escXml(ln.t || " ")}</text>`;
    }
    return `<text x="${PAD}" y="${y}" xml:space="preserve"${weight}>${escXml(ln.t || " ")}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#ffffff"/>
<g font-family="'Courier New', Courier, monospace" font-size="${FS}" fill="#000000">
${body}
</g>
</svg>`;
}

// Business contact shown in the receipt email footer. Edit phone/FB to taste.
const CONTACT = {
  address: "Blk. 27 Lot 4 Amorsolo St., Chrysanthemum Village, City of San Pedro, Laguna",
  phone: "0917 000 0000",
  email: "panfurnitureph@gmail.com",
  fb: "facebook.com/PanFurniturePH",
};

// Hosted logo URL for emails (Gmail can't render local/CID images reliably). The
// server uploads public/logo.png to storage once and calls setEmailLogoUrl() with the
// public URL before rendering. Falls back to a styled "PAN" monogram if unset.
let _emailLogoUrl = "";
export function setEmailLogoUrl(url: string): void { _emailLogoUrl = url || ""; }

// Shared branded letterhead — real logo (or monogram fallback), company name, and a
// per-email subtitle. Returns the <tr> header cell HTML.
export function emailHeader(subtitle: string): string {
  const e = escXml;
  const mark = _emailLogoUrl
    ? `<img src="${e(_emailLogoUrl)}" alt="Pan Furniture" width="72" height="72" style="display:block;margin:0 auto;width:72px;height:72px;border-radius:50%;background:#fff;border:2px solid #caa45a" />`
    : `<div style="display:inline-block;width:54px;height:54px;line-height:54px;border-radius:50%;background:#caa45a;color:#3a2e12;font-weight:800;font-size:15px;letter-spacing:1px;box-shadow:0 2px 6px rgba(0,0,0,.2)">PAN</div>`;
  return `<tr><td style="background:linear-gradient(180deg,#52421d 0%,#4a3b1a 100%);background-color:#4a3b1a;padding:30px 28px 24px;text-align:center;border-bottom:4px solid #caa45a">
    ${mark}
    <div style="color:#fff;font-size:23px;font-weight:700;margin-top:14px;letter-spacing:2px">PAN FURNITURE</div>
    <div style="width:38px;height:2px;background:#caa45a;margin:9px auto 8px;border-radius:2px"></div>
    <div style="color:#e7dcc4;font-size:11px;letter-spacing:1.5px;text-transform:uppercase">${e(subtitle)}</div>
  </td></tr>`;
}

// Shared branded footer — full registered company block + system note.
export function emailFooter(note = "This is a system-generated message. No signature required."): string {
  const e = escXml;
  return `<tr><td style="padding:8px 28px 28px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f3;border:1px solid #f0ebe0;border-radius:10px"><tr><td style="padding:16px 18px">
      <div style="font-size:12px;font-weight:700;color:#4a3b1a;margin-bottom:8px;letter-spacing:.3px">PURIFICACION AND NORIEGA FURNITURE SHOP CO.</div>
      <div style="font-size:11px;color:#9a9079;margin-bottom:8px">VAT Reg. TIN: 631-230-396-00000</div>
      <div style="font-size:12px;color:#857a63;line-height:1.9">
        📍 ${e(CONTACT.address)}<br>
        📞 ${e(CONTACT.phone)} &nbsp;·&nbsp; ✉️ ${e(CONTACT.email)}<br>
        👍 ${e(CONTACT.fb)}
      </div>
    </td></tr></table>
    <p style="margin:14px 0 0;font-size:11px;color:#b3ab98;text-align:center;line-height:1.5">${e(note)}</p>
  </td></tr>`;
}

// Branded HTML body for the receipt email (email-client safe: tables + inline CSS).
// ─── SHOPEE-STYLE NA HULMA (2026-08-26) ─────────────────────────────────────
// Ang apat na email sa ibaba ay BINUBUO na mula sa lib/email/layout — iisang
// itsura ng lahat ng email ng IMS. Ang item cards ay galing sa receipt lines
// (pangalan, specs, larawan, presyo).

function emailCards(order: OrderRow): EmailItem[] {
  return itemsFromOrder(order)
    .filter((it) => !/^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test(it.description.split("\n")[0].trim()))
    .map((it) => {
      const parts = it.description.split("\n").map((x) => x.trim());
      return {
        name: parts[0] || "Item",
        specs: (() => { const ls = parts.slice(1).map((x) => x.replace(/^[\u2022\u00b7-]\s*/, "")).filter(Boolean); return ls.length ? ls : null; })(),
        qty: it.qty,
        priceTotal: Math.round(it.qty * it.unitPrice * 100) / 100,
        photoUrl: it.image ?? null,
      };
    });
}

// Opisyal na resibo ng bayad — naka-attach ang PDF.
export function renderReceiptEmailHtml(order: OrderRow, payment: PaymentInfo, batchTags: ReceiptBatchTags = null): string {
  const datePaid = order.maya_paid_at ? new Date(order.maya_paid_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "\u2014";
  return emailShell(
    panel(intro(order.customer_name, `Thank you for your payment! Your official <b>Acknowledgment Receipt</b> for order ${mono(order.order_number || `#${order.id}`)} is attached as a PDF.`), { pad: "26px 36px 4px" })
    + panel(bigStat("Amount Paid", payment.amount, { tone: "green", chip: { text: "\u2713 PAID", bg: "#e7f6ec", color: "#1a7f43" } }), { pad: "0 36px 16px" })
    + panel(`
      ${sectionTitle("Payment Details")}
      ${kvTable([
        ["Order ID", mono(order.order_number || `#${order.id}`)],
        ["Date Paid", esc(datePaid)],
        ["Paid via", esc(payment.via)],
        ...(payment.receiptNumber ? [["Maya Receipt No.", esc(payment.receiptNumber)] as KvRow] : []),
        ...(payment.reference ? [["Reference No.", esc(payment.reference)] as KvRow] : []),
      ])}
      ${attachmentNote("Official Acknowledgment Receipt")}`)
    // ANG BINAYARAN, HINDI LANG ANG HALAGA (hiling 2026-08-28). Ang resibo ay
    // nagsasabi ng halaga at ng petsa, pero hindi kung ALIN ang binayaran — at
    // ang PDF ay kailangan pang buksan. Ang item card ang tinitingnan ng
    // customer para malamang tama ang naitala.
    + panel(`
      ${sectionTitle("Order Details")}
      ${itemList(tagCards(emailCards(order), batchTags))}`)
    + whatsNext("Keep this receipt together with your warranty certificate for any future claims. This is a system-generated receipt \u2014 no signature required.")
  );
}

// "For Payment" — kasama ang 30% QR. Ito ang unang email pagkalikha ng order.
export function renderForPaymentEmailHtml(order: OrderRow, dueAmount: number, total: number, qrUrl = ""): string {
  return emailShell(
    panel(intro(order.customer_name, `Thank you for your order ${mono(order.order_number || `#${order.id}`)}! To <b>confirm and start crafting</b>, please settle the <b>30% downpayment</b> below. Your order is reserved once we receive it.`), { pad: "26px 36px 4px" })
    + panel(bigStat("Downpayment Due (30%)", dueAmount, { sub: `Order total: ${pesoHtml(total)}` }), { pad: "0 36px 16px" })
    + panel(`
      ${sectionTitle("Order Details")}
      ${itemList(emailCards(order))}`)
    + panel(qrBox(qrUrl, "Use <b>GCash / Maya / GoTyme</b> or any QR Ph bank app.<br>The amount is locked \u2014 payment is detected automatically."), { pad: "8px 36px 16px" })
    + whatsNext("Once your downpayment lands, we will email your official confirmation and our workshop starts crafting. The balance is payable upon delivery (COD).")
  );
}

// ORDER CONFIRMED — pagkapasok ng 30% downpayment. Ito ang Mockup 1 ni Joe.
export function renderAckEmailHtml(order: OrderRow, payment: PaymentInfo, balance: number): string {
  const cards = emailCards(order);
  const subtotal = cards.reduce((t, c) => t + (c.priceTotal ?? 0), 0);
  const fees = Math.max((Number(order.full_payment_price) || 0) - subtotal, 0);
  // GMAIL SUMMARY CARD: Order schema — lumalabas ang kulay-abong card sa itaas
  // ng Gmail na may order number, kapag pumasa sa mga panuntunan ng Gmail.
  return gmailOrderSchema({
    orderNumber: order.order_number || `#${order.id}`,
    status: "OrderProcessing",
    customerName: order.customer_name,
    priceTotal: Number(order.full_payment_price) || null,
    items: cards.map((c) => ({ name: c.name, image: typeof c.photoUrl === "string" && /^https?:/.test(c.photoUrl) ? c.photoUrl : null })),
  }) + emailShell(
    panel(intro(order.customer_name, `Your order ${mono(order.order_number || `#${order.id}`)} has been <b style="color:#1a7f43">confirmed</b>. We have received your downpayment and our workshop has started crafting your item(s). Your official <b>Acknowledgment Receipt</b> is attached as a PDF.`), { pad: "26px 36px 4px" })
    + panel(bigStat("Downpayment Received", payment.amount, { tone: "green", chip: { text: "\u2713 CONFIRMED", bg: "#e7f6ec", color: "#1a7f43" } }), { pad: "0 36px 16px" })
    + panel(`
      ${sectionTitle("Order Details")}
      ${kvTable([
        ["Order ID", mono(order.order_number || `#${order.id}`)],
        ["Order Date", esc(longDate(order.date_order ?? null))],
        ["Paid via", esc(payment.via)],
        ...(payment.reference ? [["Reference No.", esc(payment.reference)] as KvRow] : []),
      ])}
      ${itemList(cards)}`)
    + panel(totalsTable([
        { label: `Subtotal (${cards.length} item${cards.length === 1 ? "" : "s"})`, amount: subtotal },
        ...(fees > 0 ? [{ label: "Delivery / Other Fees", amount: fees } as TotalRow] : []),
        { label: "Downpayment Received", amount: payment.amount, tone: "green" },
        { label: "Remaining Balance", amount: balance, big: true },
      ]), { pad: "14px 36px 8px" })
    + panel(`
      ${sectionTitle("Delivery Details")}
      ${kvTable([
        ["Recipient Name", `<b>${esc(order.customer_name ?? "\u2014")}</b>`],
        ...(order.contact_number ? [["Phone Number", esc(order.contact_number)] as KvRow] : []),
        ["Delivery Address", esc(order.address ?? "\u2014")],
      ])}
      ${attachmentNote("Official Acknowledgment Receipt")}`)
    + whatsNext(`Our workshop is now crafting your items. We will email you again once each item passes quality inspection and is ready for delivery \u2014 you will choose and confirm the delivery date then. The remaining balance of <b style="color:#2b2620">${pesoHtml(balance)}</b> is payable upon delivery (COD).`)
  );
}

// Acknowledgement RECEIPT lang (72mm staff format sa PDF) — magaan na pambalot.
export function renderAckReceiptEmailHtml(order: OrderRow, balance: number): string {
  const ord = order.order_number || `#${order.id}`;
  return emailShell(
    panel(intro(order.customer_name, `Please find your <b>Acknowledgement Receipt</b> for order ${mono(ord)} attached as a PDF. It confirms the items ordered and your downpayment.`), { pad: "26px 36px 4px" })
    + panel(attachmentNote("Acknowledgement Receipt"), { pad: "0 36px 16px" })
    + whatsNext(`Remaining balance: <b style="color:#2b2620">${pesoHtml(balance)}</b>, payable upon delivery/installation. Down payments are non-refundable.`)
  );
}

export async function renderBirInvoicePdfBase64(order: OrderRow, payment?: PaymentInfo): Promise<string> {
  const lines = birModel(order, payment);
  const { jsPDF } = await import("jspdf");
  const FS = 7, LH = 9.6, PADX = 8, PADY = 16, CHARW = FS * 0.6;
  const W = Math.ceil(COLS * CHARW + PADX * 2);
  const H = Math.ceil(lines.length * LH + PADY * 2);
  const doc = new jsPDF({ unit: "pt", format: [W, H] });
  doc.setFontSize(FS);
  let y = PADY;
  for (const ln of lines) {
    doc.setFont("courier", ln.bold ? "bold" : "normal");
    const t = (ln.t || " ").replace(/₱/g, "P");
    if (ln.center) doc.text(t, W / 2, y, { align: "center" });
    else doc.text(t, PADX, y, { align: "left" });
    y += LH;
  }
  return Buffer.from(doc.output("arraybuffer")).toString("base64");
}
