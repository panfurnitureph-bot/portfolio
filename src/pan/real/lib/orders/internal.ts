import "server-only";

// SERVER-ONLY payment plumbing.
//
// WHY THIS FILE EXISTS (security): every export of a `"use server"` file becomes an
// independently POST-reachable server-action endpoint — callable WITHOUT a session.
// Four payment-plumbing functions used to live in app/orders/maya-actions.ts and so
// were silently exposed as public endpoints:
//   confirmIfDownpaymentMet, forPaymentEmailCore, reconcileOneByCheckoutId, reconcileMayaPayments
// They are INTERNAL helpers (called only by other server code: createOrder, the Maya
// webhook route, the Orders page render, and applyPayment). Moving them into this
// `import "server-only"` module makes them NON-action functions — `server-only` modules
// are never wired up as action endpoints, so they can't be POSTed to directly. Trusted
// server callers import them from here exactly as before.
//
// The whole shared helper cluster they depend on lives here too; the remaining
// CLIENT-facing actions in maya-actions.ts (each with its own requirePay() guard)
// re-import what they need from this module.

import { revalidatePath } from "next/cache";
import { notifyPageNewOrder, notifyCustomerPaid } from "@/lib/fb/notify";
import { notifyPaymentReceived } from "@/lib/push/notify";
import { trackToken } from "@/lib/track-token";

// PAID message sa customer thread (kung pumindot sila ng CHAT WITH US NOW).
async function alertCustomer(o: OrderRow, paid: number, balance: number): Promise<void> {
  try {
    const psid = (o as { customer_psid?: string | null }).customer_psid;
    if (!psid) return;
    const ord = o.order_number || `#${o.id}`;
    const store = (process.env.NEXT_PUBLIC_STORE_URL || "").replace(/\/+$/, "");
    const tok = trackToken(ord);
    const trackUrl = store ? `${store}/track?order=${encodeURIComponent(ord)}${tok ? `&t=${tok}` : ""}` : null;
    await notifyCustomerPaid(psid, {
      orderNumber: ord,
      paid,
      balance,
      total: Number(o.full_payment_price) || 0,
      trackUrl,
    });
  } catch { /* best-effort */ }
}
import { createServerSupabase, type OrderRow } from "@/lib/supabase/server";
import { createQrPayment, getPaymentStatus, mayaConfigured, type PaymentStatus } from "@/lib/maya/client";
import { confirmIfDownpaymentMet } from "@/app/orders/actions";
import { DOWNPAYMENT_RATE } from "@/app/orders/downpayment";
import { recordPayment } from "@/lib/orders/payments";
import { renderBirInvoiceSvg, renderBirInvoicePdfBase64, renderReceiptEmailHtml, renderForPaymentEmailHtml, renderAckEmailHtml, setEmailLogoUrl, type PaymentInfo } from "@/lib/bir/invoice";
import { withColorPhotos, batchTagsFor } from "@/lib/email/items";
import { emailShell, panel, sectionTitle, intro, kvTable, mono, itemList, totalsTable, bigStat, attachmentNote, qrBox, whatsNext, esc, peso as pesoHtml, preheader, type TotalRow } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/send";
import { todayPH } from "@/lib/today";

const BUCKET = "product-images";
// Bump when the receipt template changes → paid orders auto-regenerate on next load.
export const RECEIPT_VERSION = 2;

// Ensure the brand logo is hosted (Gmail needs a public URL — it can't render local
// or CID images reliably) and register it with the email templates. Uploads
// public/logo.png to storage once, then reuses the public URL for the process.
let _logoUrlCache = "";
async function ensureEmailLogo(db: ReturnType<typeof createServerSupabase>): Promise<void> {
  try {
    if (_logoUrlCache) { setEmailLogoUrl(_logoUrlCache); return; }
    const path = "email-assets/logo.png";
    const pub = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    // Upload (idempotent) — only needs to exist once; ignore "already exists".
    const fs = await import("node:fs/promises");
    const file = await fs.readFile(process.cwd() + "/public/logo.png");
    await db.storage.from(BUCKET).upload(path, file, { contentType: "image/png", upsert: true });
    _logoUrlCache = pub;
    setEmailLogoUrl(pub);
  } catch { /* fall back to the PAN monogram if the logo can't be hosted */ }
}

export function balanceOf(o: Pick<OrderRow, "full_payment_price" | "downpayment_price" | "full_payment">): number {
  const total = Number(o.full_payment_price) || 0;
  const paid = (Number(o.downpayment_price) || 0) + (Number(o.full_payment) || 0);
  return Math.max(Math.round((total - paid) * 100) / 100, 0);
}

// Reconstruct an in-memory order after recordPayment() has resynced the ledger-derived
// mirror columns (downpayment_price/full_payment/status) in the DB. The BIR receipt and
// ack/receipt emails read those columns off the order object, so re-read them from the DB
// (source of truth post-resync) and merge onto the loaded order. Falls back to the passed
// status if the re-read fails so we never render with stale amounts.
async function freshFromLedger(
  db: ReturnType<typeof createServerSupabase>,
  order: OrderRow,
  status: string,
): Promise<OrderRow> {
  const { data } = await db.from("orders")
    .select("downpayment_price, full_payment, status")
    .eq("id", order.id).maybeSingle();
  const synced = data as Pick<OrderRow, "downpayment_price" | "full_payment" | "status"> | null;
  if (!synced) return { ...order, status } as OrderRow;
  return {
    ...order,
    downpayment_price: synced.downpayment_price,
    full_payment: synced.full_payment,
    status: synced.status ?? status,
  } as OrderRow;
}

// Mirror of withAutoComplete in actions.ts — recompute payment-driven status.
export function autoCompleteStatus(status: string, downpayment: number, fullPayment: number, total: number): string {
  const s = status || "Partial";
  if (!/^(pending|partial|completed)$/i.test(s.trim())) return s;
  const paid = Number(downpayment) + Number(fullPayment);
  if (Number(total) > 0 && paid >= Number(total)) return "Completed";
  if (paid > 0) return "Partial";
  return "Pending";
}

// Render the official BIR Service Invoice SVG, upload it to storage, and append the
// public URL to the order's transaction_images. Server-side so it works whether the
// payment is detected by live polling or by reconciliation.
function issuerName(raw: string): string {
  if (/GOTYPHM/i.test(raw)) return "GoTyme";
  if (/GXCH|GCASH/i.test(raw)) return "GCash";
  if (/PAPHPH|PAYMAYA|MAYA/i.test(raw)) return "Maya";
  if (/UBPH|UNION/i.test(raw)) return "UnionBank";
  if (/BOPI|BPI/i.test(raw)) return "BPI";
  return raw || "QR Ph";
}

// Build the receipt PaymentInfo + the order columns to persist, for either a Maya
// QR payment (from status) or a manual/cash collection.
export type PayStore = { issuer: string; receiptNo: string | null; amount: number | null };
function isCardRef(ref: string | null | undefined): boolean { return /-CARD-/.test(ref || ""); }
export function mayaPayment(order: OrderRow, st: PaymentStatus): { payment: PaymentInfo; store: PayStore } {
  const card = isCardRef(order.maya_ref);
  const issuer = issuerName(st.issuer);
  const via = card ? `Maya Card${st.issuer ? " · " + st.issuer.toUpperCase() : ""}` : `Maya QR Ph - ${issuer}`;
  return {
    payment: { via, receiptNumber: st.receiptNumber, paymentId: order.maya_checkout_id || "", reference: order.maya_ref || "", amount: st.amount },
    // Funds settle to the Maya merchant account either way.
    store: { issuer: "Maya", receiptNo: st.receiptNumber || null, amount: st.amount || null },
  };
}

// QR and Vault-card payments both settle on /payments/v1/payments/{id}.
export async function fetchStatus(order: OrderRow): Promise<PaymentStatus> {
  return getPaymentStatus(order.maya_checkout_id as string);
}

// Strip any prior auto-generated receipt, render the current BIR invoice (with
// payment details), upload it, and attach the URL. Stamps maya_receipt_v + payment
// columns so stale receipts can be detected and the preview can show details.
export async function attachReceipt(db: ReturnType<typeof createServerSupabase>, order: OrderRow, payment: PaymentInfo, store: PayStore): Promise<void> {
  try {
    const svg = renderBirInvoiceSvg(order, payment);
    const path = `receipts/${(order.order_number || `ORD${order.id}`).replace(/[^a-z0-9_-]/gi, "")}/${Date.now()}-bir.svg`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, Buffer.from(svg), { contentType: "image/svg+xml", upsert: false });
    if (upErr) return;
    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    const url = data.publicUrl;
    const kept = ((order.transaction_images as string[] | null) ?? []).filter((u) => u && !/\/receipts\//.test(u));
    await db.from("orders").update({
      transaction_images: [...kept, url], maya_receipt_v: RECEIPT_VERSION,
      maya_issuer: store.issuer, maya_receipt_no: store.receiptNo, maya_amount: store.amount,
    }).eq("id", order.id);
  } catch { /* receipt is best-effort; payment is already recorded */ }
}

// Email the BIR receipt PDF to the customer via an n8n webhook. Best-effort.
export async function sendReceiptEmail(order: OrderRow, payment: PaymentInfo): Promise<void> {
  try {
    const hook = process.env.N8N_RECEIPT_WEBHOOK;
    const to = (order.email || "").trim();
    if (!hook || !to) return;
    await ensureEmailLogo(createServerSupabase());
    const pdfBase64 = await renderBirInvoicePdfBase64(order, payment);
    const filename = `Receipt-${order.order_number || `ORD${order.id}`}.pdf`;
    const ordNo = order.order_number || `#${order.id}`;
    const subject = `Payment received — ${ordNo}`;
    // PARTIAL DELIVERY tags (2026-09-03): kita sa resibo kung aling produkto
    // ang naihatid na / sakay ng biyahe / susunod pa.
    const batchTags = await batchTagsFor(createServerSupabase(), order.id as number).catch(() => null);
    const html = preheader(`₱${(Number(payment.amount) || 0).toLocaleString("en-PH")} paid via ${payment.via} · official receipt attached`) + renderReceiptEmailHtml(await withColorPhotos(createServerSupabase(), order), payment, batchTags);
    await sendEmail({
      to, subject, html, type: "receipt", orderId: order.id as number, orderNumber: ordNo, hook,
      extra: {
        customer: order.customer_name || "", amount: payment.amount, currency: "PHP", paid_via: payment.via,
        maya_receipt_no: payment.receiptNumber, payment_id: payment.paymentId, reference: payment.reference,
        filename, pdf_base64: pdfBase64,
      },
      idempotencyKey: payment.paymentId ? `receipt:${order.id}:${payment.paymentId}` : null,
    });
  } catch { /* email is best-effort */ }
}

// Rework (repair) service email — SEPARATE from the order emails. Two kinds:
//   • "qr"      → payment request: pay the 30% rework downpayment via QR Ph
//   • "receipt" → confirmation: the rework downpayment was collected in-store
// Best-effort; needs the customer email + an n8n webhook. Self-contained HTML (no
// OrderRow) so it doesn't entangle with the order receipt template.
export type ReworkEmail = {
  to: string;
  customerName: string | null;
  rmaNo: string;
  mode: "onsite" | "pullout";
  // ANO ang kinumpuni: pangalan + SPECIFICATION / DESIGN DETAILS (returns.item_desc).
  itemDesc?: string | null;
  itemSku?: string | null;
  // Larawan ng kasangkapan sa item card — kapag walang ipinasa, hinahanap ito
  // ng sendReworkEmail sa catalog (SKU muna, saka pangalan).
  itemImage?: string | null;
  parts: { part: string; qty: number; amount: number }[];
  deliveryPrice: number;
  chargeTotal: number;
  amountDue: number;       // 30% due
  collected: number;       // already collected (for the receipt variant)
  method?: string | null;  // Email QR / Cash / Terminal
  qrDataUrl?: string | null; // QR image (payment variant)
  // Linked order — kapag meron, ang slip SVG ay naka-attach sa order's
  // transaction_images para makita sa 📎 gallery (Sales Orders + PAN Overall).
  orderId?: number | null;
};
// BRANDED shell (kapareho ng order For-Payment/Receipt emails): PAN letterhead,
// puting card, breakdown, malaking amount block + QR (payment) o ✓ PAID (receipt).
// kind "ack" = Acknowledgement Receipt variant (kapareho ng receipt, ibang framing)
// — para dalawang email ang natatanggap pagka-bayad, tulad ng normal orders.
// SHOPEE-STYLE (2026-08-26): binubuo mula sa lib/email/layout — iisang hulma
// ng lahat ng email. Ang pagbabawas ng balanse ay pareho pa rin ng resibo.
function reworkEmailHtml(e: ReworkEmail, kind: "qr" | "receipt" | "ack"): string {
  const partsSum = Math.round(e.parts.reduce((n, p) => n + (Number(p.amount) || 0), 0) * 100) / 100;
  const obal = Math.max(Math.round((e.chargeTotal - partsSum - e.deliveryPrice) * 100) / 100, 0);
  const totals: TotalRow[] = [
    ...e.parts.map((p) => ({ label: `${p.qty}\u00d7 ${p.part}`, amount: Number(p.amount) || 0 } as TotalRow)),
    ...(e.deliveryPrice > 0 ? [{ label: e.mode === "pullout" ? "Delivery (pull-out & return)" : "Delivery (redeliver)", amount: e.deliveryPrice } as TotalRow] : []),
    ...(obal > 0 ? [{ label: "Unpaid balance on the order (brought forward)", amount: obal } as TotalRow] : []),
    { label: "Total charge", amount: e.chargeTotal, big: true },
  ];
  const specLines = String(e.itemDesc ?? "").split("\n").map((l) => l.trim().replace(/^[\u2022\u00b7-]+\s*/, "")).filter(Boolean);
  const itemCard = specLines.length
    ? itemList([{ name: specLines[0], specs: specLines.length > 1 ? specLines.slice(1) : null, qty: 1, priceTotal: null, photoUrl: e.itemImage ?? null }])
    : "";
  const heroPanel = kind === "qr"
    ? panel(bigStat("Amount Due Now", e.amountDue, { chip: { text: "50% DOWNPAYMENT DUE", bg: "#fdf3e2", color: "#b07d2a" } }), { pad: "0 36px 16px" })
    : panel(bigStat(`Amount Paid (${e.method ?? "\u2014"})`, e.collected, {
        tone: "green", chip: { text: "\u2713 PAID", bg: "#e7f6ec", color: "#1a7f43" },
        sub: e.chargeTotal - e.collected > 0.005
          ? `Remaining balance ${pesoHtml(e.chargeTotal - e.collected)} \u2014 collected on redelivery (COD).`
          : "Fully paid \u2014 thank you!",
      }), { pad: "0 36px 16px" });
  const introLine = kind === "qr"
    ? `Please settle the <b>50% downpayment</b> for your repair service ${mono(e.rmaNo)} to start the rework.`
    : kind === "ack"
      ? `This acknowledges receipt of your payment for the repair service ${mono(e.rmaNo)}. Your official receipt slip is attached as a PDF.`
      : `Thank you for your payment! Your repair ${mono(e.rmaNo)} is now proceeding${e.mode === "pullout" ? " \u2014 pull-out for workshop repair, then redelivery" : " \u2014 on-site repair"}.`;
  const extra = kind === "qr" && e.qrDataUrl
    ? panel(qrBox(e.qrDataUrl, "Scan with GCash / Maya / any bank \u2014 amount locked, auto-detects."), { pad: "8px 36px 16px" })
    : kind !== "qr"
      ? panel(attachmentNote(kind === "ack" ? "Rework Acknowledgement Receipt" : "Rework receipt slip"), { pad: "0 36px 16px" })
      : "";
  return emailShell(
    panel(intro(e.customerName, introLine), { pad: "26px 36px 4px" })
    + heroPanel
    + panel(`
      ${sectionTitle("Item Repaired")}
      ${itemCard}
      ${e.itemSku ? kvTable([["SKU", `<span style="font-family:'Courier New',monospace">${esc(e.itemSku)}</span>`]]) : ""}`)
    + panel(totalsTable(totals), { pad: "14px 36px 8px" })
    + extra
    + whatsNext(kind === "qr"
        ? "Once your payment lands, the repair starts immediately and we will keep you posted."
        : "We will email you again when your item is ready for redelivery. Keep this receipt for your records.")
  );
}

export async function sendReworkEmail(e: ReworkEmail, kind: "qr" | "receipt" | "ack"): Promise<void> {
  // Order # para sa resibo (2026-09-01) — RMA lang ang dala ng payload.
  let reworkOrderNo: string | null = null;
  let reworkCollectedBy: string | null = null;
  try {
    const db0 = createServerSupabase();
    if (e.orderId != null) {
      const { data: o0 } = await db0.from("orders").select("order_number").eq("id", e.orderId).maybeSingle();
      reworkOrderNo = (o0?.order_number as string | null) ?? null;
    }
    // Sino ang kumolekta — pangalan sa signature block ng resibo.
    const { data: r0 } = await db0.from("returns").select("rework_collected_by").eq("return_no", e.rmaNo).maybeSingle();
    reworkCollectedBy = ((r0 as { rework_collected_by?: string | null } | null)?.rework_collected_by as string | null) ?? null;
  } catch { /* best-effort */ }
  // (1) I-attach ang slip SVG sa linked order's transaction_images — tumatakbo
  // kahit walang email/webhook, para laging may receipt attachment ang ledger.
  try {
    if (e.orderId != null && kind === "receipt") {
      const db = createServerSupabase();
      const { renderReworkReceiptSvg } = await import("@/lib/bir/rework-receipt");
      const svg = renderReworkReceiptSvg({
        customerName: e.customerName, rmaNo: e.rmaNo, orderNo: reworkOrderNo, collectedBy: reworkCollectedBy, mode: e.mode, parts: e.parts,
        itemDesc: e.itemDesc ?? null, itemSku: e.itemSku ?? null,
        deliveryPrice: e.deliveryPrice, chargeTotal: e.chargeTotal,
        amountDue: e.amountDue, collected: e.collected, method: e.method,
      }, kind);
      const path = `rework-receipts/${e.rmaNo.replace(/[^a-z0-9_-]/gi, "")}/${Date.now()}-rework.svg`;
      const { error: upErr } = await db.storage.from(BUCKET).upload(path, Buffer.from(svg), { contentType: "image/svg+xml", upsert: false });
      if (!upErr) {
        const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        const { data: cur } = await db.from("orders").select("transaction_images").eq("id", e.orderId).maybeSingle();
        const existing = (cur?.transaction_images as string[] | null) ?? [];
        await db.from("orders").update({ transaction_images: [...existing, url] }).eq("id", e.orderId);
      }
    }
  } catch { /* attachment is best-effort */ }
  // (2) Email via n8n. Ang "ack" ay dumadaan sa sariling ACK webhook (kapareho ng
  // normal orders) na may fallback sa receipt hook.
  try {
    const hook = kind === "ack"
      ? (process.env.N8N_ACK_RECEIPT_WEBHOOK || process.env.N8N_RECEIPT_WEBHOOK)
      : process.env.N8N_RECEIPT_WEBHOOK;
    if (!hook || !e.to) return;
    await ensureEmailLogo(createServerSupabase());
    const subject = kind === "qr"
      ? `Rework Payment — Pan Furniture ${e.rmaNo}`
      : kind === "ack"
        ? `Acknowledgement Receipt — Pan Furniture ${e.rmaNo}`
        : `Rework Receipt — Pan Furniture ${e.rmaNo}`;
    // PDF slip attachment — kapareho ng order receipts (ang n8n workflow ay
    // umaasa ng pdf_base64 attachment; email na walang PDF ay hindi naipapadala).
    let pdfBase64 = "";
    try {
      const { renderReworkReceiptPdfBase64 } = await import("@/lib/bir/rework-receipt");
      pdfBase64 = await renderReworkReceiptPdfBase64({
        customerName: e.customerName, rmaNo: e.rmaNo, orderNo: reworkOrderNo, collectedBy: reworkCollectedBy, mode: e.mode, parts: e.parts,
        itemDesc: e.itemDesc ?? null, itemSku: e.itemSku ?? null,
        deliveryPrice: e.deliveryPrice, chargeTotal: e.chargeTotal,
        amountDue: e.amountDue, collected: e.collected, method: e.method,
      }, kind === "qr" ? "qr" : "receipt");
    } catch { /* attachment is best-effort */ }
    // LARAWAN NG KASANGKAPAN (2026-08-27): blangkong kahon ang item card noon —
    // walang nagpapasa ng photo. Ang RMA row ang unang hanapan (item_image na
    // pinili sa declare), saka ang catalog ayon sa SKU o pangalan.
    if (!e.itemImage) {
      try {
        const db = createServerSupabase();
        const { data: ret } = await db.from("returns").select("item_image").eq("return_no", e.rmaNo).maybeSingle();
        e.itemImage = (ret?.item_image as string | null) ?? null;
        if (!e.itemImage) {
          const name = String(e.itemDesc ?? "").split("\n")[0].trim();
          let q = db.from("product").select("image_url").limit(1);
          q = e.itemSku ? q.eq("sku", e.itemSku) : q.ilike("product_name", name);
          const { data: prod } = await q.maybeSingle();
          e.itemImage = (prod?.image_url as string | null) ?? null;
        }
      } catch { /* walang larawan — lalabas pa rin ang card */ }
    }
    const pre = kind === "qr"
      ? `₱${e.amountDue.toLocaleString("en-PH")} downpayment (50%) · scan the QR to start the rework`
      : `₱${e.collected.toLocaleString("en-PH")} paid${e.method ? ` via ${e.method}` : ""} · ${e.rmaNo}`;
    await sendEmail({
      to: e.to, subject, html: preheader(pre) + reworkEmailHtml(e, kind),
      type: `rework_${kind}`, orderId: e.orderId ?? null, refNo: e.rmaNo, orderNumber: e.rmaNo, hook,
      extra: {
        customer: e.customerName || "", amount: kind === "qr" ? e.amountDue : e.collected,
        currency: "PHP", paid_via: e.method ?? "QR Ph",
        ...(pdfBase64 ? { filename: `${kind === "ack" ? "Acknowledgement" : "Rework"}-${e.rmaNo}.pdf`, pdf_base64: pdfBase64 } : {}),
      },
    });
  } catch { /* best-effort */ }
}

// Send the acknowledgement email after the 30% downpayment is detected: attaches the
// full-order BIR receipt (order total) and notes the remaining balance. Best-effort.
// Exported so the in-store collect path (cash/terminal) can send the same "Order
// Confirmed" email that the online Maya flow already sends.
export async function sendAckEmail(order: OrderRow, payment: PaymentInfo, balance: number): Promise<void> {
  try {
    const hook = process.env.N8N_ACK_WEBHOOK || process.env.N8N_RECEIPT_WEBHOOK;
    const to = (order.email || "").trim();
    if (!hook || !to) return;
    await ensureEmailLogo(createServerSupabase());
    // Full-order receipt: pass no payment block so the PDF shows the order total.
    const pdfBase64 = await renderBirInvoicePdfBase64(order);
    const ord = order.order_number || `#${order.id}`;
    const html = renderAckEmailHtml(await withColorPhotos(createServerSupabase(), order), payment, balance);
    await sendEmail({
      to, subject: `Order ${ord} confirmed`,
      html: preheader(`₱${(Number(payment.amount) || 0).toLocaleString("en-PH")} received · balance ₱${balance.toLocaleString("en-PH")} COD`) + html,
      type: "order_confirmed", orderId: order.id as number, orderNumber: ord, hook,
      extra: {
        customer: order.customer_name || "", amount: payment.amount, currency: "PHP",
        paid_via: payment.via, reference: payment.reference,
        filename: `Receipt-${ord}.pdf`, pdf_base64: pdfBase64,
      },
      idempotencyKey: payment.reference ? `ack:${order.id}:${payment.reference}` : null,
    });
  } catch { /* email is best-effort */ }
}

// RETIRED 2026-08-10 (hiling ni Joe): ang LUMANG 72mm Acknowledgement Receipt
// (lib/bir/ack-receipt.ts) ay HINDI na ipinapadala o sine-save — ISA na lang
// ang acknowledgment: ang dating BIR Service Invoice na pinalitan ng pamagat
// na "ACKNOWLEDGMENT RECEIPT" (sendAckEmail/sendReceiptEmail ang nagpapadala,
// attachReceipt ang nagse-save sa Receipt/Transaction Images). Tinanggal ang
// sendAckReceiptEmail() at lahat ng tawag dito.

// Render a QR Ph payload to a PNG and return its base64 (no data-URL prefix).
async function qrPngBase64(payload: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  const dataUrl = await QRCode.toDataURL(payload, { width: 480, margin: 2, errorCorrectionLevel: "M" });
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}

// Send the "For Payment" email: generates the 30% downpayment QR, persists its
// checkout id (so the later scan auto-detects), and emails the QR as an attachment.
// Best-effort — needs N8N_RECEIPT_WEBHOOK, the order's email, Maya keys, and a balance.
//
// SERVER-ONLY (moved out of "use server"): trusted server callers fire it directly
// (createOrder, and the guarded sendForPaymentEmail action). Not a POST endpoint.
// opts.amount — custom na halagang sisingilin (hal. 30% ng balanse pagkatapos
// magdagdag ng items sa order); default = klasikong downpaymentDue.
export async function forPaymentEmailCore(orderId: number, opts?: { amount?: number; subjectPrefix?: string; refTag?: string }): Promise<{ ok: true } | { error: string }> {
  try {
    const hook = process.env.N8N_FORPAYMENT_WEBHOOK || process.env.N8N_RECEIPT_WEBHOOK;
    if (!hook) return { error: "Email webhook not configured." };
    if (!mayaConfigured()) return { error: "Maya keys not set." };
    const db = createServerSupabase();
    const { data, error } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (error) return { error: error.message };
    const order = data as OrderRow | null;
    if (!order) return { error: "Order not found." };
    const to = (order.email || "").trim();
    if (!to) return { error: "Order has no email address." };
    const total = Number(order.full_payment_price) || 0;
    const balance = Math.max(Math.round((total - ((Number(order.downpayment_price) || 0) + (Number(order.full_payment) || 0))) * 100) / 100, 0);
    const due = opts?.amount != null ? Math.min(Math.max(Math.round(opts.amount * 100) / 100, 0), balance) : downpaymentDue(order);
    if (due <= 0) return { error: "No downpayment due (already paid or zero total)." };

    // Generate the downpayment QR and persist its checkout id so the scan auto-detects.
    const reference = `${order.order_number || `ORD${order.id}`}-${opts?.refTag ?? "DP"}-${Date.now()}`;
    const qr = await createQrPayment(due, reference);
    await db.from("orders").update({
      maya_checkout_id: qr.paymentId, maya_status: "PENDING_TOKEN", maya_ref: reference, maya_paid_at: null,
    }).eq("id", orderId);

    // Upload the QR PNG to storage and email a plain <img src=URL> — Gmail renders
    // hosted images inline reliably (CID-based inlining is flaky in the n8n Gmail node).
    const imageBase64 = await qrPngBase64(qr.qrCodeBody);
    const ord = order.order_number || `#${order.id}`;
    const qrPath = `payment-qr/${(order.order_number || `ORD${order.id}`).replace(/[^a-z0-9_-]/gi, "")}/${Date.now()}.png`;
    await db.storage.from(BUCKET).upload(qrPath, Buffer.from(imageBase64, "base64"), { contentType: "image/png", upsert: true });
    const qrUrl = db.storage.from(BUCKET).getPublicUrl(qrPath).data.publicUrl;
    await ensureEmailLogo(db);
    const html = preheader(`₱${due.toLocaleString("en-PH")} downpayment (30%) · scan the QR to confirm your order`) + renderForPaymentEmailHtml(await withColorPhotos(db, order), due, total, qrUrl);
    await sendEmail({
      to, subject: `${opts?.subjectPrefix ?? "Payment request"} — ${ord}`, html,
      type: "for_payment", orderId: order.id as number, orderNumber: ord, hook,
      // QR is embedded inline via the hosted qr_url in the HTML — no attachment.
      extra: { customer: order.customer_name || "", amount: due, currency: "PHP", qr_url: qrUrl },
      idempotencyKey: `forpay:${order.id}:${reference}`,
    });
    revalidatePath("/orders");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to send for-payment email." };
  }
}

// Ping the Facebook page inbox when money lands, so whoever is on Messenger
// sees the order without opening the app. Best-effort — a failure here must
// never stop a payment from being recorded.
async function alertPage(db: ReturnType<typeof createServerSupabase>, o: OrderRow, amount: number, balance: number, via?: string): Promise<void> {
  try {
    // Ang lumang order ay may relative na larawan ("/images/…"). Kinukuha ito
    // ng Meta sa server nila, kaya kailangang buong URL — kung hindi, walang
    // larawang lalabas.
    const store = (process.env.NEXT_PUBLIC_STORE_URL || "").replace(/\/+$/, "");
    const usableStore = /^https:\/\//i.test(store) && !/localhost|127\.0\.0\.1/i.test(store);
    const absolute = (u?: string | null): string | null => {
      if (!u) return null;
      if (/^https?:\/\//i.test(u)) return u;
      return usableStore ? `${store}${u.startsWith("/") ? "" : "/"}${u}` : null;
    };

    // Kung relative pa ang larawan sa order at hindi maabot ang storefront,
    // tignan kung may Supabase Storage na bersyon sa katalogo — doon napupunta
    // ang bagong upload, at yun ay laging maaabot ng Meta.
    //
    // Ang pangalan sa order ("Standard Bed 4 — Single") ay hindi laging tugma
    // sa katalogo ("Bed 4"), kaya: exact muna, tapos ang unang bahagi bago ang
    // "—/·", tapos partial contains. Kunin ang unang produkto lang.
    // Ibinabalik ang larawan AT ang slug ng katugmang produkto sa katalogo.
    type CatRow = { data?: { name?: string; slug?: string; images?: string[] } };
    const pubImg = (d: CatRow | null): string | null =>
      (d?.data?.images ?? []).find((i) => /^https:\/\//i.test(i)) ?? null;

    async function fromCatalogue(rawName: string): Promise<{ image: string | null; slug: string | null }> {
      const empty = { image: null, slug: null };
      const name = rawName.split(/\s+[—·-]\s+/)[0].trim();
      if (name.length < 2) return empty;
      try {
        const { data: all } = await db.from("web_products").select("data").limit(2000);
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const orderN = norm(name);
        const rows = (all ?? []) as CatRow[];
        const pick = (r: CatRow) => ({ image: pubImg(r), slug: (r.data?.slug as string) ?? null });

        // 1) EKSAKTONG pangalan — yun ang tama kahit walang larawan. HUWAG
        //    mag-subset: ang "Bed 1" ay hindi dapat kunin ang "C Bed 1".
        const exact = rows.find((r) => norm(String(r.data?.name ?? "")) === orderN);
        if (exact) return pick(exact);

        // 2) Katalogo-sa-loob-ng-order ("Bed 4" sa "Standard Bed 4"); piliin
        //    ang pinakamahaba (pinaka-tiyak) na may larawan.
        let best: { len: number; row: CatRow } | null = null;
        for (const r of rows) {
          const cat = String(r.data?.name ?? "").trim();
          if (cat.length < 3) continue;
          const catN = norm(cat);
          if (!(orderN.includes(catN) || catN.includes(orderN))) continue;
          if (pubImg(r) && (!best || cat.length > best.len)) best = { len: cat.length, row: r };
        }
        return best ? pick(best.row) : empty;
      } catch {
        return empty;
      }
    }

    // Buong item — kasama ang kulay, sukat, at frame dimensions na nasa
    // description, para makita agad kung ano ang gagawin.
    const raw = Array.isArray(o.receipt_items)
      ? (o.receipt_items as { qty?: number; description?: string; unitPrice?: number; image?: string | null }[])
          .filter((it) => !/^shipping\b/i.test(String(it?.description ?? "").trim()))
          .map((it) => ({
            description: String(it?.description ?? "").trim(),
            qty: Number(it?.qty) || 1,
            price: Number(it?.unitPrice) || 0,
            image: absolute(it?.image),
          }))
          .filter((it) => it.description)
      : [];

    const items = await Promise.all(
      raw.map(async (it) => {
        const cat = await fromCatalogue(it.description.split("\n")[0].trim());
        return { ...it, image: it.image ?? cat.image, slug: cat.slug };
      }),
    );

    // Ang BIR receipt (naka-attach na ng attachReceipt bago ito) — huling
    // /receipts/ na URL sa transaction_images. Public Storage, kaya maabot.
    const receiptUrl = ((o.transaction_images as string[] | null) ?? [])
      .filter((u) => /\/receipts\//.test(u))
      .pop() ?? null;

    await notifyPageNewOrder({
      orderNumber: o.order_number || `#${o.id}`,
      customer: o.customer_name || "Walk-in",
      items,
      total: Number(o.full_payment_price) || 0,
      paid: amount,
      balance,
      address: o.address,
      paidVia: via || null,
      receiptUrl,
      placedAt: (o.date_order as string) ?? null,
      scheduledFor: (o.date_of_delivery as string) ?? null,
    });
  } catch {
    /* nasa loob na ito ng try/catch ng notifyPageNewOrder — dagdag na proteksyon lang */
  }
}

// Apply a confirmed Maya payment to an order. Idempotent (skips if already paid).
export async function applyPayment(db: ReturnType<typeof createServerSupabase>, order: OrderRow, st: PaymentStatus): Promise<void> {
  if (order.maya_paid_at) return;
  // Atomically CLAIM this payment: stamp maya_paid_at only if still null. Two concurrent
  // reconcile passes (e.g. rapid Orders-page reloads) would both read paid_at=null and
  // each fire the emails — so guard with a conditional update and bail if we didn't win
  // the claim. This is what prevents the duplicate "Order Confirmed" email spam.
  const claimedAt = new Date().toISOString();
  const { data: claimed } = await db.from("orders")
    .update({ maya_paid_at: claimedAt })
    .eq("id", order.id).is("maya_paid_at", null)
    .select("id");
  if (!claimed || claimed.length === 0) return; // someone else already claimed it
  order = { ...order, maya_paid_at: claimedAt };
  const { payment, store } = mayaPayment(order, st);
  const isTest = /-TEST-/.test(order.maya_ref || "");
  if (isTest) {
    await db.from("orders").update({ maya_status: st.status, maya_paid_at: new Date().toISOString(), maya_issuer: store.issuer, maya_receipt_no: store.receiptNo, maya_amount: store.amount }).eq("id", order.id);
    return;
  }
  const total = Number(order.full_payment_price) || 0;
  const today = todayPH();
  const isDown = /-DP-/.test(order.maya_ref || "");

  if (isDown) {
    // Downpayment: record the amount paid to downpayment_price, leave the balance
    // outstanding, and confirm the order (reserve stock + lift off "Pending").
    const dp = Math.round((Number(st.amount) || 0) * 100) / 100;
    const conf = await confirmIfDownpaymentMet(db, order.id, order.status || "Partial", dp, Number(order.full_payment) || 0, total);
    // Only stamp the non-mirror fields here. downpayment_price/full_payment are now OWNED
    // by recordPayment → resyncOrderColumns (which runs even on the idempotency-skip path),
    // so writing them here too would just risk drift.
    await db.from("orders").update({
      date_downpayment: today, status: conf.status,
      maya_status: st.status, maya_paid_at: new Date().toISOString(),
    }).eq("id", order.id);
    // Record into the ledger (new source of truth). Idempotent on the Maya payment id so
    // a re-run / racing reconcile can't double-insert. Re-syncs the mirror columns.
    await recordPayment(db, {
      orderId: order.id, amount: dp, method: store.issuer, kind: "downpayment",
      reference: order.maya_ref || null, mayaPaymentId: order.maya_checkout_id || null, paidAt: today,
    });
    // Reconstruct the order from the now-synced ledger so the BIR receipt + ack emails
    // render the correct downpayment_price/full_payment (recordPayment already resynced DB).
    const fresh = await freshFromLedger(db, order, conf.status);
    // Acknowledgement: attach the FULL-order BIR receipt (no payment block — shows the
    // order total) and note the balance still due.
    await attachReceipt(db, fresh, payment, store);
    const balance = balanceOf(fresh);
    await sendAckEmail(fresh, payment, balance);
    // FCM push sa ops — ito ang GARANTISADONG alerto: ang Messenger page alert
    // sa ibaba ay tinatanggihan ni Meta kapag lampas 24h mula sa huling
    // message ng staff sa page (error #10, at deprecated na ang mga tag).
    try {
      await notifyPaymentReceived({
        orderNumber: fresh.order_number || `#${fresh.id}`,
        amount: Number(store.amount) || 0,
        kind: "downpayment",
        method: store.issuer,
      });
    } catch { /* best-effort */ }
    // Staff Messenger alert (alertPage) — INALIS 2026-08-05, kahilingan ni Joe:
    // ang FCM push + email + IMS Sales Orders na ang nagre-record; nakakagulo
    // sa personal Messenger thread. Ibalik: await alertPage(db, fresh, amount, balance, issuer).
    await alertCustomer(fresh, Number(store.amount) || 0, balance);
    return;
  }

  const dp = Number(order.downpayment_price) || 0;
  const newFull = Math.max(Math.round((total - dp) * 100) / 100, 0);
  const newStatus = autoCompleteStatus(order.status || "Partial", dp, newFull, total);
  // Balance payment completes the order; ensure stock is reserved if the
  // downpayment step somehow never did (e.g. order paid in full in one shot).
  await confirmIfDownpaymentMet(db, order.id, newStatus, dp, newFull, total);
  // full_payment is owned by recordPayment → resyncOrderColumns now; only stamp the
  // non-mirror fields here to avoid drift on the idempotency-skip path.
  await db.from("orders").update({
    full_payment_date: today, status: newStatus,
    maya_status: st.status, maya_paid_at: new Date().toISOString(),
  }).eq("id", order.id);
  // Ledger: record the AMOUNT ACTUALLY COLLECTED in this Maya payment (st.amount), not the
  // remaining-balance mirror. Idempotent on the Maya payment id. Re-syncs mirror columns
  // (which recomputes downpayment_price/full_payment from the full ledger).
  await recordPayment(db, {
    orderId: order.id, amount: Math.round((Number(st.amount) || newFull) * 100) / 100,
    method: store.issuer, kind: "balance",
    reference: order.maya_ref || null, mayaPaymentId: order.maya_checkout_id || null, paidAt: today,
  });
  // Reconstruct from the synced ledger so the receipt + emails show the right numbers.
  const fresh = await freshFromLedger(db, order, newStatus);
  await attachReceipt(db, fresh, payment, store);
  await sendReceiptEmail(fresh, payment);
  // FCM push sa ops — garantisadong alerto (ang Messenger ay 24h-window-bound).
  try {
    await notifyPaymentReceived({
      orderNumber: fresh.order_number || `#${fresh.id}`,
      amount: Math.round((Number(st.amount) || newFull) * 100) / 100,
      kind: "balance",
      method: store.issuer,
    });
  } catch { /* best-effort */ }
  await alertCustomer(fresh, Math.round((Number(st.amount) || newFull) * 100) / 100, balanceOf(fresh));
  const newBalance = balanceOf(fresh);
  // Balance cleared via Maya QR AND a signed installation warranty exists → email the
  // Warranty Certificate too, so the QR flow sends the same set as Cash/Terminal.
  try {
    if (newBalance <= 0.005) {
      const { data: inst } = await db.from("installations")
        .select("warranty_form_url").eq("order_id", order.id).not("warranty_form_url", "is", null).limit(1);
      const wUrl = (inst?.[0]?.warranty_form_url as string | null) ?? null;
      if (wUrl) {
        const { sendWarrantyEmail } = await import("@/app/installation/actions");
        await sendWarrantyEmail(order.id, wUrl);
      }
    }
  } catch { /* best-effort */ }
}

// Reconcile ONE order by its Maya checkout (payment) id.
// Called by the inbound Maya webhook (app/api/maya/webhook/route.ts) so payments
// are applied immediately on Maya's event — not only when someone opens Orders.
// Loads the order with this checkout id, fetches the authoritative status, and if
// paid runs applyPayment (which keeps its own atomic-claim guard, so this is safe to
// race with the polling fallback). Idempotent.
//
// SERVER-ONLY (moved out of "use server"): called only by the webhook route handler.
// Not a POST endpoint.
export async function reconcileOneByCheckoutId(
  checkoutId: string,
): Promise<{ ok: true; applied: boolean } | { error: string }> {
  if (!checkoutId) return { error: "Missing checkout id." };
  if (!mayaConfigured()) return { error: "Maya keys not set." };
  const db = createServerSupabase();
  const { data, error } = await db.from("orders").select("*").eq("maya_checkout_id", checkoutId).maybeSingle();
  if (error) return { error: error.message };
  const order = data as OrderRow | null;
  if (!order) return { error: "No order for that checkout id." };
  if (order.maya_paid_at) return { ok: true, applied: false }; // already settled
  const st = await getPaymentStatus(checkoutId);
  if (!st.isPaid) {
    if (st.status !== order.maya_status) await db.from("orders").update({ maya_status: st.status }).eq("id", order.id);
    return { ok: true, applied: false };
  }
  await applyPayment(db, order, st); // atomic-claim guard inside makes this idempotent
  revalidatePath("/orders");
  revalidatePath("/installation");
  return { ok: true, applied: true };
}

// The 30% downpayment due on an order (rounded to centavos), capped at the balance.
export function downpaymentDue(o: OrderRow): number {
  const total = Number(o.full_payment_price) || 0;
  const due = Math.round(total * DOWNPAYMENT_RATE * 100) / 100;
  return Math.min(due, balanceOf(o));
}

// Reconcile ALL pending Maya payments (orders with a checkout id but not yet marked
// paid). Catches payments completed after the QR modal was closed. Called on the
// Orders page load. Best-effort — failures per order are ignored.
//
// SERVER-ONLY (moved out of "use server"): called only by the Orders page render
// (a server component). Not a POST endpoint.
export async function reconcileMayaPayments(): Promise<{ updated: number }> {
  if (!mayaConfigured()) return { updated: 0 };
  const db = createServerSupabase();
  const { data } = await db.from("orders").select("*")
    .not("maya_checkout_id", "is", null).is("maya_paid_at", null)
    .neq("maya_status", "PAYMENT_SUCCESS").order("id", { ascending: false }).limit(40);
  const orders = (data ?? []) as OrderRow[];
  let updated = 0;
  for (const order of orders) {
    try {
      const st = await fetchStatus(order);
      if (st.isPaid) { await applyPayment(db, order, st); updated++; }
      else if (st.status !== order.maya_status) await db.from("orders").update({ maya_status: st.status }).eq("id", order.id);
    } catch { /* skip this order */ }
  }

  // Second pass: paid orders whose receipt was built with an older template → regenerate.
  const { data: stale } = await db.from("orders").select("*")
    .not("maya_checkout_id", "is", null).not("maya_paid_at", "is", null)
    .or(`maya_receipt_v.is.null,maya_receipt_v.lt.${RECEIPT_VERSION}`)
    .order("id", { ascending: false }).limit(20);
  for (const order of (stale ?? []) as OrderRow[]) {
    try {
      const st = await getPaymentStatus(order.maya_checkout_id as string);
      const { payment, store } = mayaPayment(order, st);
      await attachReceipt(db, order, payment, store);
      updated++;
    } catch { /* skip */ }
  }

  // (Ang dating third pass — pag-heal ng lumang 72mm acknowledgement PDF papunta
  // sa SVG — ay tinanggal 2026-08-10: retired na ang lumang acknowledgement doc;
  // ang mga naiwang lumang kopya sa transaction_images ay hinahayaan na lang.)

  // NOTE: no revalidatePath here — this runs during the Orders page render, which
  // reads fresh rows right after. Calling revalidate during render is unsupported.
  return { updated };
}
