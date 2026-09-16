"use client";

import { useState, useRef } from "react";
import { printHtml } from "@/lib/print-frame";
import { Modal } from "./modal";
import { shortDate } from "@/lib/format";
import { printRaw, linesToEscpos, twoCol, wrap, COLS, type PrintLine } from "@/lib/qz-print";
import type { OrderRow } from "@/lib/supabase/server";

// Company (fixed) — from the official BIR Service Invoice.
const CO = {
  name: "PURIFICACION AND NORIEGA FURNITURE SHOP CO.",
  vatTin: "VAT Reg. TIN: 631-230-396-00000",
  addr: "Blk. 27 Lot 4 Amorsolo St., Chrysanthemum Village, Chrysanthemum 4023, City of San Pedro Laguna, Philippines",
};
// Pinalit 2026-08-10 — parehong disclaimer ng lib/bir/invoice.ts: tanggal ang
// printer-accreditation block at "valid for five years" (pang pre-printed na
// booklet ang mga iyon; system-generated ito).
const DISCLAIMER_HEAD = '"THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAXES"';
const DISCLAIMER_BODY =
  '"This document shall not be allowed as proof for the claim of deductible expense if upon ' +
  'verification, this BIR Printed Invoice has not been authorized and distributed by the BIR."';

const peso2 = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fdate(v: string): string {
  if (!v) return "-";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : shortDate(v);
}

type Item = { qty: number; description: string; unitPrice: number; customized?: boolean; category?: string | null };
type BirData = {
  invoiceNo: string;
  date: string;
  saleType: "cash" | "charge";
  registeredName: string;
  tin: string;
  businessAddress: string;
  discount: number;
  withholding: number;
};

function itemsFromOrder(order: OrderRow): Item[] {
  if (order.receipt_items && order.receipt_items.length) {
    return order.receipt_items.map((it) => ({
      qty: Number(it.qty) || 1,
      // BUONG description (2026-08-17) — kasama ang spec bullets sa resibo;
      // dating pinuputol sa unang linya kaya nawawala ang details sa preview.
      description: (it.description ?? "").trim(),
      unitPrice: Number(it.unitPrice) || 0,
      customized: !!it.customized,
      category: it.category ?? null,
    }));
  }
  return [{
    qty: 1,
    description: [order.product_name, order.color, order.dimension].filter(Boolean).join(" / "),
    unitPrice: Number(order.full_payment_price ?? 0),
  }];
}

function totals(items: Item[], d: BirData) {
  const totalSales = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const vat = totalSales * (12 / 112); // VAT-inclusive 12%
  const netOfVat = totalSales - vat;
  const due = totalSales - (Number(d.discount) || 0) - (Number(d.withholding) || 0);
  return { totalSales, vat, netOfVat, due };
}

// ── thermal line model (shared with the acknowledgement receipt) ──
type Line = PrintLine;
const peso = (n: number) => "₱" + peso2(n);
// "Nx Name ........ amount" with price on the last wrapped line.
function itemLines(qty: number, name: string, amount: number): Line[] {
  const price = "₱" + peso2(amount);
  // Multi-line: unang linya ang may presyo; ang mga sumunod (spec bullets) ay
  // naka-indent sa ilalim (2026-08-17 — dating unang linya lang ang lumalabas).
  const [first, ...restRaw] = name.split("\n");
  // DEDUPE (2026-08-19, tugma sa lib/bir/invoice.ts): tanggalin ang color
  // bullet na kapareho ng Fabric/Upholstered line.
  const cleanLn = (s: string) => s.trim().replace(/^[•·*\-\s]+/, "");
  const fabricVals = restRaw
    .map((r) => /^(?:Fabric(?:\s*\/\s*Finish)?|Upholstered Finish):\s*(.+)$/.exec(cleanLn(r))?.[1]?.trim().toLowerCase())
    .filter(Boolean) as string[];
  const rest = restRaw.filter((r) => !fabricVals.includes(cleanLn(r).toLowerCase()));
  const lines = wrap(`${qty}x ${first}`).trimEnd().split("\n");
  const last = lines.length - 1;
  if (lines[last].length + 1 + price.length <= COLS) {
    lines[last] = lines[last] + " ".repeat(COLS - lines[last].length - price.length) + price;
  } else {
    lines.push(price.padStart(COLS));
  }
  // "*" ang bullet sa RESIBO (hiling 2026-08-18): pare-pareho na ang preview,
  // print, at PDF — walang "?" sa thermal at walang pagkakaiba sa papel.
  for (const r of rest) wrap("  " + r.trim().replace(/^[•·]\s*/, "* ")).trimEnd().split("\n").forEach((t) => lines.push(t));
  return lines.map((t) => ({ t, pre: true }));
}

type PayInfo = { via: string; receiptNumber: string; paymentId: string; reference: string; amount: number };

// Build the preview/print line model — the single source of truth.
function birModel(d: BirData, items: Item[], payment?: PayInfo): Line[] {
  const { totalSales, vat, netOfVat, due } = totals(items, d);
  const dashes = "-".repeat(COLS);
  const eq = "=".repeat(COLS);
  const out: Line[] = [];
  const push = (t: string, o: Partial<Line> = {}) => out.push({ t, ...o });
  const cols = (s: string, o: Partial<Line> = {}) => s.trimEnd().split("\n").forEach((t) => out.push({ t, pre: true, ...o }));

  // Header
  wrap(CO.name).trimEnd().split("\n").forEach((t) => out.push({ t, center: true, bold: true }));
  wrap(CO.vatTin).trimEnd().split("\n").forEach((t) => out.push({ t, center: true }));
  wrap(CO.addr).trimEnd().split("\n").forEach((t) => out.push({ t, center: true }));
  push(eq);
  // Invoice no + sale type + date
  cols(twoCol("ACKNOWLEDGMENT RECEIPT", "No. " + (d.invoiceNo || "______")), { bold: true });
  push(`[${d.saleType === "cash" ? "X" : " "}] CASH SALES   [${d.saleType === "charge" ? "X" : " "}] CHARGE SALES`);
  push("Date: " + fdate(d.date));
  push(dashes);
  // Customer — blank fields become a fill-in line (handwrite), like the BIR form.
  const fill = (label: string, val: string) => {
    if (val) return wrap(`${label}: ${val}`);
    const dash = "_".repeat(Math.max(4, COLS - label.length - 2));
    return `${label}: ${dash}\n`;
  };
  push("CUSTOMER:", { bold: true });
  fill("Registered Name", d.registeredName).trimEnd().split("\n").forEach((t) => push(t));
  fill("TIN", d.tin).trimEnd().split("\n").forEach((t) => push(t));
  fill("Business Address", d.businessAddress).trimEnd().split("\n").forEach((t) => push(t));
  push(dashes);
  // Items
  push("ITEM / NATURE OF SERVICE", { bold: true });

  // ANG MGA BAYAD AY LAGING SA DULO, at ang bawat produkto ay may bilang —
  // eksaktong tugma sa lib/bir/invoice.ts (ang naka-imbak/naipapadalang kopya)
  // at sa lib/receipt-model.ts (ang thermal). Ang tatlong ito ay bumubuo ng
  // parehong resibo mula sa parehong laman; kapag isa lang ang inayos, ang
  // nakikita sa preview ay iba sa naipi-print at sa naipapadala.
  //
  // Ang shipping ay dating nakaupo sa pagkakasunod ng receipt_items, kaya nang
  // may naidagdag na produkto sa isang order na mayroon na, napunta ito sa
  // GITNA ng listahan at parang bayad lang ng nauna.
  const isFeeItem = (it: Item) =>
    /^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test(
      String(it.description ?? "").split("\n")[0].trim(),
    );
  // ANG "Addtl." AY PER-PRODUKTO (2026-08-29). Ang order-wide na "Shipping —
  // Lumban, Laguna" ay pag-aari ng buong order kaya nasa dulo; ang "Addtl.
  // Shipping Fee" at "Addtl. Rush Fee" ay idinagdag sa tabi ng ISANG item sa
  // Edit Order. Nang pagsamahin sila sa dulo, labing-apat na magkakaparehong
  // ₱123.00 ang nakahanay at wala nang makapagsasabi kung alin ang may dala.
  const isPerItemFee = (it: Item) =>
    /^addtl\.?\s|^additional\s/i.test(String(it.description ?? "").split("\n")[0].trim());
  const products = items.filter((it) => !isFeeItem(it));
  const fees = items.filter((it) => isFeeItem(it) && !isPerItemFee(it));
  const amtOf = (it: Item) => (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);

  // Kanino nakakabit: ang huling produktong nadaanan sa pagkakasunod-sunod ng
  // receipt_items — doon isinisingit ng editor ang dagdag.
  const feesByProduct = new Map<number, Item[]>();
  {
    let owner = -1;
    for (const it of items) {
      if (!isFeeItem(it)) { owner += 1; continue; }
      if (!isPerItemFee(it) || owner < 0) continue;
      const list = feesByProduct.get(owner) ?? [];
      list.push(it);
      feesByProduct.set(owner, list);
    }
  }

  products.forEach((it, i) => {
    if (i > 0) out.push({ t: "-".repeat(COLS) });
    if (products.length > 1) out.push({ t: `ITEM ${i + 1} OF ${products.length}`, bold: true });
    // Header = CATEGORY ng item ("* PROMO *" / "* BED *"); fallback
    // "* CUSTOMIZED *" kapag customized na walang category.
    const catHead = (it.category ?? "").trim().toUpperCase() || (it.customized ? "CUSTOMIZED" : "");
    if (catHead) out.push({ t: `* ${catHead} *`, bold: true });
    itemLines(Number(it.qty) || 0, it.description, amtOf(it)).forEach((l) => out.push({ ...l, bold: true }));
    // Ang dagdag ng produktong ito, naka-indent sa ilalim nito.
    for (const f of feesByProduct.get(i) ?? []) {
      const fname = String(f.description ?? "").split("\n")[0].trim().replace(/^addtl\.?\s*|^additional\s*/i, "");
      cols(twoCol(`  + ${fname}`, peso(amtOf(f))), { bold: true });
    }
    out.push({ t: "" });
  });

  // FEES (Shipping/Rush) — hindi "1x" na item line (hiling 2026-08-19):
  // isang linya lang, kasama ang lugar (tugma sa lib/bir/invoice.ts).
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
  // VAT breakdown (right side of the form) — amounts bold/highlighted
  cols(twoCol("Total Sales (VAT Inclusive)", peso(totalSales)), { bold: true });
  cols(twoCol("Less: VAT", peso(vat)), { bold: true });
  cols(twoCol("Amount: Net of VAT", peso(netOfVat)), { bold: true });
  cols(twoCol("Less: Discount (SC/PWD/NAAC/MOV/SP)", d.discount ? peso(d.discount) : "-"), { bold: true });
  cols(twoCol("Add: VAT", "-"), { bold: true });
  cols(twoCol("Less: Withholding Tax", d.withholding ? peso(d.withholding) : "-"), { bold: true });
  push(dashes);
  cols(twoCol("TOTAL AMOUNT DUE", peso(due)), { bold: true });
  push(eq);
  // Tax category summary (left side of the form)
  cols(twoCol("VATable Sales", peso(netOfVat)), { bold: true });
  cols(twoCol("VAT", peso(vat)), { bold: true });
  cols(twoCol("Zero-Rated Sales", peso(0)), { bold: true });
  cols(twoCol("VAT-Exempt Sales", peso(0)), { bold: true });
  push(dashes);
  // Electronic payment details (Maya QR Ph) — shown once the order is paid.
  if (payment) {
    push("PAYMENT DETAILS", { bold: true });
    cols(twoCol("Paid via", payment.via), { bold: true });
    if (payment.amount > 0) cols(twoCol("Amount Paid", peso(payment.amount)), { bold: true });
    cols(twoCol("Maya Receipt No.", payment.receiptNumber || "-"), { bold: true });
    wrap(`Payment ID: ${payment.paymentId || "-"}`).trimEnd().split("\n").forEach((t) => push(t));
    wrap(`Reference No.: ${payment.reference || "-"}`).trimEnd().split("\n").forEach((t) => push(t));
    push(dashes);
  }
  // Received / signatures
  push("Received the amount of:");
  push(payment ? `  ${payment.via}${payment.amount > 0 ? "  " + peso(payment.amount) : ""}` : "____________________________");
  push("");
  push("Signature: _________________________");
  push(dashes);
  wrap(DISCLAIMER_HEAD).trimEnd().split("\n").forEach((t) => out.push({ t, center: true, bold: true }));
  push("");
  wrap(DISCLAIMER_BODY).trimEnd().split("\n").forEach((t) => out.push({ t, center: true }));
  return out;
}

export function ReceiptBirButton({ order }: { order: OrderRow }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const items = itemsFromOrder(order);

  const snap = (): BirData => ({
    invoiceNo: order.order_number ?? "",
    date: (order.date_order ?? "").slice(0, 10),
    saleType: "cash",
    registeredName: order.customer_name ?? "",
    tin: "",
    businessAddress: order.address ?? "",
    discount: 0,
    withholding: 0,
  });
  const [d, setD] = useState<BirData>(snap);
  const set = <K extends keyof BirData>(k: K, v: BirData[K]) => setD((p) => ({ ...p, [k]: v }));

  // Maya payment details (populated once the order is paid via Maya QR Ph).
  const payVia = (() => {
    const iss = order.maya_issuer || "QR Ph";
    return /gotyme|gcash|maya|unionbank|bpi|qr ph/i.test(iss) ? `Maya QR Ph - ${iss}` : iss; // Cash/Check/etc shown as-is
  })();
  const payment: PayInfo | undefined = order.maya_paid_at ? {
    via: payVia,
    receiptNumber: order.maya_receipt_no || "",
    paymentId: order.maya_checkout_id || "",
    reference: order.maya_ref || "",
    amount: Number(order.maya_amount) || 0,
  } : undefined;

  function reopen() {
    setD(snap());
    setEditing(false);
    setOpen(true);
  }

  const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";

  // Render the invoice to a 72mm HTML page + open print dialog. "Save as PDF"
  // yields the download; same view is the no-QZ print fallback. <title> = filename.
  function openInvoiceDoc(title: string) {
    const body = birModel(d, items, payment)
      .map((ln) => {
        const style = [
          "white-space:pre",
          ln.center ? "text-align:center" : "text-align:left",
          ln.bold ? "font-weight:700" : "",
          ln.big ? "font-size:1.4em" : "",
        ].filter(Boolean).join(";");
        return `<div style="${style}">${(ln.t || " ").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))}</div>`;
      })
      .join("");
    // Hidden iframe, hindi popup (2026-09-07): ang about:blank popup ay
    // ipinapasa ng desktop app sa Windows ("Get an app to open this 'about' link").
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>]/g, "")}</title><style>@page{size:72mm auto;margin:0}body{margin:0;font-family:'Courier New',monospace;font-size:9px;width:72mm;padding:2mm}</style></head><body>${body}</body></html>`);
  }
  const printBrowser = () => openInvoiceDoc(`BIR Invoice ${d.invoiceNo ?? ""}`.trim());

  // One-click PDF download — snapshot the preview (keeps ₱) into a 72mm-wide PDF.
  async function downloadPdf() {
    const node = previewRef.current;
    if (!node) return;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
    const wmm = 72;
    const hmm = (wmm * canvas.height) / canvas.width;
    const pdf = new jsPDF({ unit: "mm", format: [wmm, hmm] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, wmm, hmm);
    pdf.save(`BIR Invoice ${d.invoiceNo ?? ""}`.trim() + ".pdf");
  }

  async function print() {
    setPrinting(true);
    try {
      await printRaw("Xprinter Q200", linesToEscpos(birModel(d, items, payment)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = /QZ_PRIVATE_KEY/.test(msg)
        // Ang susi ang kulang, hindi ang QZ Tray — konektado naman ito.
        // Ang pagsabing "make sure QZ Tray is running" ay nagpapahanap
        // sa maling lugar (2026-08-28).
        ? "The server has no signing key — ask IT to set QZ_PRIVATE_KEY."
        : "Make sure QZ Tray is running.";
      if (confirm(`Thermal print failed: ${msg}\n\n${hint}\n\nUse browser print instead?`)) printBrowser();
    } finally {
      setPrinting(false);
    }
  }

  const model = open ? birModel(d, items, payment) : [];

  return (
    <>
      <button onClick={reopen} aria-label="BIR invoice" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-stone-100 hover:text-primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6M9 9h1" /></svg>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Acknowledgment Receipt" description={order.order_number ?? undefined} size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Close</button>
            <button onClick={downloadPdf} className="rounded-lg border border-primary bg-surface px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">Download PDF</button>
            <button onClick={print} disabled={printing} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">{printing ? "Printing…" : "Print"}</button>
          </div>
        }>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted">{editing ? "Editing — preview updates live" : "Invoice preview"}</p>
            <button type="button" onClick={() => setEditing((v) => !v)} className="rounded-lg border border-primary bg-surface px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5">{editing ? "✓ Done editing" : "Edit"}</button>
          </div>

          {editing && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-stone-50/60 p-4">
              <Field label="Invoice No."><input value={d.invoiceNo} onChange={(e) => set("invoiceNo", e.target.value)} className={inp} /></Field>
              <Field label="Date"><input type="date" value={d.date} onChange={(e) => set("date", e.target.value)} className={inp} /></Field>
              <Field label="Sale Type"><select value={d.saleType} onChange={(e) => set("saleType", e.target.value as "cash" | "charge")} className={inp}><option value="cash">Cash Sales</option><option value="charge">Charge Sales</option></select></Field>
              <Field label="Registered Name"><input value={d.registeredName} onChange={(e) => set("registeredName", e.target.value)} className={inp} /></Field>
              <Field label="TIN"><input value={d.tin} onChange={(e) => set("tin", e.target.value)} placeholder="000-000-000-00000" className={inp} /></Field>
              <Field label="Business Address" full><input value={d.businessAddress} onChange={(e) => set("businessAddress", e.target.value)} className={inp} /></Field>
              <Field label="Less: Discount (₱)"><input type="number" min={0} value={d.discount || ""} onChange={(e) => set("discount", Number(e.target.value))} className={inp} /></Field>
              <Field label="Less: Withholding Tax (₱)"><input type="number" min={0} value={d.withholding || ""} onChange={(e) => set("withholding", Number(e.target.value))} className={inp} /></Field>
            </div>
          )}

          {/* Preview — exact thermal output (WYSIWYG) */}
          <div className={`flex justify-center overflow-auto rounded-lg border border-border bg-stone-100 p-3 ${editing ? "max-h-[44vh]" : "max-h-[74vh]"}`}>
            <div ref={previewRef} className="m-0 h-fit bg-white px-5 py-4 text-black shadow-md ring-1 ring-stone-300" style={{ fontFamily: "'Courier New', monospace", fontSize: "14px", lineHeight: 1.4, width: "max-content" }}>
              {model.map((ln, i) => (
                <div key={i} style={{ whiteSpace: "pre", textAlign: ln.center ? "center" : "left", fontWeight: ln.bold ? 700 : 400, fontSize: ln.big ? "1.4em" : undefined }}>
                  {ln.t || " "}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <label className="text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
