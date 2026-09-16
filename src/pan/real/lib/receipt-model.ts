// Acknowledgement Receipt model — the single source of truth for the printed /
// previewed / auto-printed receipt. Pure (no React), so it can be built from an
// order both in the ReceiptButton modal and programmatically (e.g. auto-print on
// Cash/Terminal completion). Rendering to ESC/POS is done via linesToEscpos.
import { shortDate } from "@/lib/format";
import { printRaw, linesToEscpos, twoCol, wrap, COLS, type PrintLine } from "@/lib/qz-print";
import type { OrderRow, ProductRow } from "@/lib/supabase/server";

export const PROPRIETOR = "Jessone B. Purificacion";

export type ReceiptItem = { qty: number; description: string; unitPrice: number; image?: string | null; customized?: boolean };
export type ReceiptLabeledAmount = { label: string; amount: number };
export type ReceiptData = {
  date: string;
  mop: string;
  customer: string;
  address: string;
  items: ReceiptItem[];
  discounts: ReceiptLabeledAmount[];
  downpayment: number;
  paymentTerms: ReceiptLabeledAmount[];
  proprietor: string;
  salesRep: string;
  orderNo?: string;        // shown as "Order #" when present
  dpPercent?: number;      // DP-REQUEST mode: show "DOWN PAYMENT (XX%)" + "BALANCE (on delivery)"
};

function fdate(v: string): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : shortDate(v);
}
export const peso2 = (n: number) =>
  (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function receiptTotals(d: ReceiptData) {
  const subtotal = d.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const discount = d.discounts.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const total = subtotal - discount;
  const balance = total - (Number(d.downpayment) || 0);
  return { subtotal, discount, total, balance };
}

// One item rendered as "Nx Product Name ........ total" (price right-aligned on
// the first line; long names wrap to the next lines). Returns the text lines.
function itemTextLines(qty: number, name: string, total: number): string[] {
  const price = "₱" + peso2(total);
  const lines = wrap(`${qty}x ${name}`).trimEnd().split("\n");
  const last = lines.length - 1;
  if (lines[last].length + 1 + price.length <= COLS) {
    lines[last] = lines[last] + " ".repeat(COLS - lines[last].length - price.length) + price;
  } else {
    lines.push(price.padStart(COLS));
  }
  return lines;
}

// The line model — both the printer (via linesToEscpos) and the on-screen preview render this.
export function receiptModel(d: ReceiptData): PrintLine[] {
  const { total, balance } = receiptTotals(d);
  const peso = (n: number) => "₱" + peso2(n);
  const dashes = "-".repeat(COLS);
  const eq = "=".repeat(COLS);
  const out: PrintLine[] = [];
  const push = (t: string, o: Partial<PrintLine> = {}) => out.push({ t, ...o });
  const cols = (s: string, o: Partial<PrintLine> = {}) =>
    s.trimEnd().split("\n").forEach((t) => out.push({ t, pre: true, ...o }));

  push("PAN FURNITURE", { center: true, big: true, bold: true });
  push("ACKNOWLEDGEMENT RECEIPT", { center: true, bold: true });
  push(eq);
  cols(twoCol("Date", fdate(d.date)));
  if (d.orderNo) cols(twoCol("Order #", d.orderNo));
  if (!d.dpPercent) cols(twoCol("Payment", d.mop || "-"));
  cols(twoCol("Customer", d.customer || "-"));
  if (d.address) wrap("Address: " + d.address).trimEnd().split("\n").forEach((t) => push(t));
  push(dashes);
  push("ORDER ITEMS", { bold: true });
  push("");
  // ANG MGA BAYAD AY LAGING SA DULO, at ang bawat produkto ay may bilang —
  // kapareho ng BIR receipt. Ang shipping ay dating nakaupo sa pagkakasunod ng
  // receipt_items, kaya nang may naidagdag na produkto sa isang order na
  // mayroon na, napunta ito sa gitna ng listahan.
  const isFeeLine = (it: { description?: string }) =>
    /^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test(
      String(it.description || "").split("\n")[0].trim(),
    );
  // ANG "Addtl." AY PER-PRODUKTO (2026-08-29) — ganoon sila idinagdag sa Edit
  // Order, inline sa tabi ng item. Nang isama sila sa dulo kasama ang order-wide
  // na shipping, labing-apat na magkakaparehong ₱123.00 ang nakahanay at wala
  // nang makapagsasabi kung alin ang may dalang dagdag. Kapareho ng BIR receipt.
  const isPerItemFee = (it: { description?: string }) =>
    /^addtl\.?\s|^additional\s/i.test(String(it.description || "").split("\n")[0].trim());
  const prods = d.items.filter((it) => !isFeeLine(it));
  const feeItems = d.items.filter((it) => isFeeLine(it) && !isPerItemFee(it));

  // Kanino nakakabit ang bawat dagdag: ang huling produktong nadaanan sa
  // pagkakasunod-sunod ng receipt_items — doon sila isinisingit ng editor.
  const feesByProduct = new Map<number, typeof d.items>();
  {
    let owner = -1;
    for (const it of d.items) {
      if (!isFeeLine(it)) { owner += 1; continue; }
      if (!isPerItemFee(it) || owner < 0) continue;
      const list = feesByProduct.get(owner) ?? [];
      list.push(it);
      feesByProduct.set(owner, list);
    }
  }

  prods.forEach((it, i) => {
    const qty = Number(it.qty) || 0;
    const amt = qty * (Number(it.unitPrice) || 0);
    const descLines = (it.description || "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (i > 0) push(dashes);
    if (prods.length > 1) push(`ITEM ${i + 1} OF ${prods.length}`, { bold: true });
    const name = descLines[0] ?? "";
    if (it.customized) push("* CUSTOMIZED *", { bold: true });
    itemTextLines(qty, name, amt).forEach((t) => push(t, { pre: true, bold: true }));
    // ANG BUONG BUILD (2026-09-01, "di pa ayos ung Acknowledgement Receipt"):
    // kapareho ng BIR invoice — ang specs bullets ng item (Height, Frame,
    // Finish…) ay kasama sa AR, hindi pangalan lang.
    for (const sp of descLines.slice(1)) {
      wrap(`* ${sp.replace(/^[•·*-]\s*/, "")}`).trimEnd().split("\n").forEach((t) => push(t, { pre: true }));
    }
    // Ang dagdag ng produktong ito, naka-indent sa ilalim nito: ang "+" ang
    // nagsasabing dagdag ito sa presyong nasa itaas.
    for (const f of feesByProduct.get(i) ?? []) {
      const fname = String(f.description || "").split("\n")[0].trim().replace(/^addtl\.?\s*|^additional\s*/i, "");
      cols(twoCol(`  + ${fname}`, peso((Number(f.qty) || 0) * (Number(f.unitPrice) || 0))), { bold: true });
    }
    push("");
  });

  // FEES (Shipping/Rush) — hindi "1x" na item line (2026-08-19): isang linya
  // lang kasama ang lugar, tugma sa BIR receipt.
  if (feeItems.length) {
    push(dashes);
    for (const it of feeItems) {
      const amt = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
      const descLines = (it.description || "").split("\n").map((l) => l.trim()).filter(Boolean);
      const place = descLines.slice(1).map((l) => l.replace(/^[•·*\-\s]+/, "")).filter(Boolean).join(", ");
      cols(twoCol(descLines[0] + (place ? ` — ${place}` : ""), peso(amt)), { bold: true });
    }
    push("");
  }
  if (d.discounts.length) {
    for (const x of d.discounts) cols(twoCol(x.label, "-" + peso(Number(x.amount) || 0)), { bold: true });
  }
  push(dashes);
  cols(twoCol("TOTAL", peso(total)), { bold: true });
  cols(twoCol("Downpayment", peso(Number(d.downpayment) || 0)), { bold: true });
  cols(twoCol("BALANCE DUE", peso(balance)), { bold: true });
  if (d.paymentTerms.length) {
    push(dashes);
    push("PAYMENT TERMS", { bold: true });
    for (const x of d.paymentTerms) cols(twoCol(x.label, peso(Number(x.amount) || 0)), { bold: true });
  }
  push(eq);
  push(`Balance as of ${fdate(d.date)}: ${peso(balance)}`, { center: true });
  push("");
  wrap("Down payments are non-refundable. Refunds or exchanges for defective items within 3 days of delivery.")
    .trimEnd().split("\n").forEach((t) => push(t, { center: true }));
  push("");
  push("");
  push("______________________", { center: true });
  push(d.salesRep || "-", { center: true, bold: true });
  push("Sales Representative", { center: true });
  push("");
  push("Thank you for your business!", { center: true });
  return out;
}

export function initFromOrder(order: OrderRow, products: ProductRow[]): ReceiptData {
  const descBullets = [order.color, order.dimension, order.category].filter(Boolean) as string[];

  const imgFor = (desc: string): string | null => {
    const fl = (desc || "").split("\n")[0].trim().toLowerCase();
    if (!fl) return null;
    const p = products.find((p) => {
      const n = (p.product_name ?? "").toLowerCase();
      return n && (n === fl || fl.startsWith(n) || n.startsWith(fl) || fl.includes(n) || n.includes(fl));
    });
    return p?.image_url ?? null;
  };

  const matched =
    (order.sku && products.find((p) => p.sku?.toLowerCase() === order.sku!.toLowerCase())) ||
    products.find((p) => p.product_name?.toLowerCase() === (order.product_name ?? "").toLowerCase());

  const items =
    order.receipt_items && order.receipt_items.length
      ? order.receipt_items.map((it) => ({
          qty: Number(it.qty) || 0,
          description: it.description ?? "",
          unitPrice: Number(it.unitPrice) || 0,
          customized: !!it.customized,
          image: it.image ?? imgFor(it.description ?? ""),
        }))
      : [
          {
            qty: 1,
            description: [order.product_name ?? "", ...descBullets.map((b) => "• " + b)].join("\n"),
            unitPrice: Number(order.full_payment_price ?? 0),
            image: matched?.image_url ?? null,
          },
        ];
  return {
    date: (order.date_downpayment || order.date_order || "").slice(0, 10),
    mop: order.mop ?? order.Source ?? "",
    customer: order.customer_name ?? "",
    address: order.address ?? "",
    items,
    discounts: order.receipt_discounts ?? [],
    downpayment: Number(order.downpayment_price ?? 0),
    paymentTerms: order.receipt_payment_terms ?? [],
    proprietor: PROPRIETOR,
    salesRep: order.assigned ?? "",
    orderNo: order.order_number ?? undefined,
  };
}

// Programmatic thermal print of an order's Acknowledgement Receipt via QZ Tray.
// Throws if QZ isn't reachable — callers handle the fallback (browser print).
export async function printOrderReceipt(order: OrderRow, products: ProductRow[]): Promise<void> {
  await printRaw("Xprinter Q200", linesToEscpos(receiptModel(initFromOrder(order, products))));
}
