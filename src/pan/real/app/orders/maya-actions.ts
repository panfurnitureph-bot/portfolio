"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createServerSupabase, type OrderRow } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { createQrPayment, getPaymentStatus, createCardPayment, mayaConfigured } from "@/lib/maya/client";
import { confirmIfDownpaymentMet } from "./actions";
import { recordPayment } from "@/lib/orders/payments";
import { type PaymentInfo } from "@/lib/bir/invoice";
import { todayPH } from "@/lib/today";
// Payment plumbing now lives in a SERVER-ONLY module (lib/orders/internal.ts) so the
// internal helpers below are NOT exposed as POST-reachable server-action endpoints.
import {
  balanceOf,
  autoCompleteStatus,
  attachReceipt,
  sendReceiptEmail,
  sendAckEmail,
  mayaPayment,
  fetchStatus,
  applyPayment,
  downpaymentDue,
  forPaymentEmailCore,
  sendReworkEmail,
  type PayStore,
} from "@/lib/orders/internal";

// Collecting payment happens in the field on several surfaces (Sales Orders,
// Installation, Delivery COD) by whoever is on the tablet. Any signed-in staff may
// generate the QR / record a payment — the restriction was only that they be logged
// in. (The old admin/ops-only check is why installers/warehouse staff hit
// "Forbidden" on the Maya QR.) Deactivated users have no session, so they're out.
async function requirePay() {
  return await getSession();
}

// Reconstruct an in-memory order after recordPayment() has resynced the ledger-derived
// mirror columns. Local copy (the server-only module keeps its own private version).
async function freshFromLedger(
  db: ReturnType<typeof createServerSupabase>,
  order: OrderRow,
  status: string,
): Promise<OrderRow> {
  const { data } = await db.from("orders")
    .select("downpayment_price, full_payment, status, maya_paid_at, date_downpayment, full_payment_date")
    .eq("id", order.id).maybeSingle();
  const synced = data as Pick<OrderRow, "downpayment_price" | "full_payment" | "status" | "maya_paid_at" | "date_downpayment" | "full_payment_date"> | null;
  if (!synced) return { ...order, status } as OrderRow;
  return {
    ...order,
    downpayment_price: synced.downpayment_price,
    full_payment: synced.full_payment,
    status: synced.status ?? status,
    // Carry the just-stamped payment dates so the receipt email shows Date Paid
    // instead of a dash (the pre-payment order object had them null).
    maya_paid_at: synced.maya_paid_at,
    date_downpayment: synced.date_downpayment,
    full_payment_date: synced.full_payment_date,
  } as OrderRow;
}

// Guarded entrypoint for the For-Payment email (staff-triggered resend). The unguarded
// core (forPaymentEmailCore) lives in the server-only module; this action gates it.
export async function sendForPaymentEmail(orderId: number): Promise<{ ok: true } | { error: string }> {
  if (!(await requirePay())) return { error: "Forbidden." };
  return forPaymentEmailCore(orderId);
}

// Collect the remaining balance manually (e.g. CASH on installation). Records the
// payment, completes the order, attaches the BIR receipt, and emails it.
//
// DOUBLE-SUBMIT GUARD (BUG 1): a double-click / two-tab retry could insert two +balance
// ledger rows and overstate income. The robust fix is a CLIENT-generated idempotency
// token, stable per user action (per modal mount), threaded in as `idempotencyKey`. We
// pass it as recordPayment's mayaPaymentId (`manual:<token>`), and the partial-unique
// index on order_payments(maya_payment_id) dedupes a fast double-submit at the DB. A
// genuine later installment uses a fresh token (new mount), so it isn't blocked. If no
// key is supplied (older callers), fall back to a synthetic per-request token (no
// cross-request dedupe, but the call still works).
// ADDITIONAL ITEMS sa umiiral na order: singilin ang 30% ng KASALUKUYANG
// balanse (dating balanse + bagong dagdag) sa iisang order/resibo pa rin —
// email QR sa customer, auto-credit pagka-scan (same Maya webhook path).
export async function sendAdditionalDpQr(orderId: number): Promise<{ ok: true; amount: number } | { error: string }> {
  if (!(await requirePay())) return { error: "Forbidden." };
  const db = createServerSupabase();
  const { data } = await db.from("orders").select("full_payment_price, downpayment_price, full_payment").eq("id", orderId).maybeSingle();
  if (!data) return { error: "Order not found." };
  const total = Number(data.full_payment_price) || 0;
  const paid = (Number(data.downpayment_price) || 0) + (Number(data.full_payment) || 0);
  const balance = Math.max(Math.round((total - paid) * 100) / 100, 0);
  if (balance <= 0) return { error: "No balance to collect." };
  const amount = Math.max(Math.round(balance * 0.30 * 100) / 100, 0.01);
  const res = await forPaymentEmailCore(orderId, { amount, subjectPrefix: "Additional Payment (30% Downpayment)", refTag: "ADP" });
  if ("error" in res) return res;
  return { ok: true, amount };
}

export async function collectManualPayment(
  orderId: number,
  method: string,
  collectedBy: string,
  idempotencyKey?: string,
  amountArg?: number, // partial collection; defaults to the full outstanding balance
  kindArg?: "downpayment" | "balance", // how to tag it in the ledger (drives the DP vs Full columns)
  // INITIAL SALES (2026-08-10): true = pag-encode ng LUMANG order na manual na
  // binabayaran ng cash — naitatala ang bayad at naka-save ang resibo sa order,
  // pero WALANG email (ack/receipt/warranty) na ipinapadala sa customer.
  silent?: boolean,
  // Kapag true, ang mabibigat na side effects (receipt render/attach + emails +
  // warranty + push) ay tumatakbo PAGKATAPOS ng response (next/server after) —
  // ginagamit ng Payment Approval para instant ang Approve.
  deferHeavy?: boolean,
): Promise<{ ok: true } | { error: string }> {
  try {
    if (!(await requirePay())) return { error: "Forbidden." };
    const db = createServerSupabase();
    const { data, error } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (error) return { error: error.message };
    const order = data as OrderRow | null;
    if (!order) return { error: "Order not found." };
    const balance = balanceOf(order);
    if (balance <= 0) return { error: "No balance to collect." };
    // Collect exactly what's asked (a partial downpayment), capped at the balance.
    // Default (no amount) = the whole balance → completes the order.
    const collected = amountArg && amountArg > 0 ? Math.min(Math.round(amountArg * 100) / 100, balance) : balance;
    if (collected <= 0) return { error: "Enter an amount to collect (greater than 0)." };

    const total = Number(order.full_payment_price) || 0;
    const dp = Number(order.downpayment_price) || 0;
    const existingFull = Number(order.full_payment) || 0;
    // Projected full-payment column after this collection (dp + full together must
    // reach total to auto-complete; a partial keeps it below → stays Partial).
    const newFull = Math.max(Math.round((existingFull + collected) * 100) / 100, 0);
    const today = todayPH();
    const newStatus = autoCompleteStatus(order.status || "Partial", dp, newFull, total);
    const channel = method || "Cash";
    const ref = order.order_number || `ORD${order.id}`;
    // Tag: an explicit downpayment collection lands in the DP column; otherwise it's
    // the remaining balance. Default = downpayment when nothing's been paid yet AND
    // this is a partial (not the whole balance); else balance.
    const kind = kindArg ?? (dp <= 0 && collected < balance ? "downpayment" : "balance");
    // Reserve stock if it wasn't already (e.g. order paid entirely in this one step).
    await confirmIfDownpaymentMet(db, orderId, newStatus, dp, newFull, total);
    // full_payment is owned by recordPayment → resyncOrderColumns; only stamp non-mirror
    // fields here so a skipped (deduped) insert can't leave the mirror disagreeing.
    // A downpayment collection stamps the DOWNPAYMENT date; a balance stamps full-payment.
    await db.from("orders").update({
      ...(kind === "downpayment" ? { date_downpayment: today } : { full_payment_date: today }),
      status: newStatus,
      maya_status: `${channel.toUpperCase()}_PAID`, maya_paid_at: new Date().toISOString(),
      maya_ref: order.maya_ref || ref,
    }).eq("id", orderId);
    // Ledger: record the manually collected amount (the outstanding balance) with the
    // channel as the method and the collector. The idempotency key (client uuid) dedupes
    // a double-submit; resync runs even on the skip path so mirrors stay correct.
    const dedupeId = `manual:${idempotencyKey || `${orderId}:${Date.now()}`}`;
    const rec = await recordPayment(db, {
      orderId, amount: collected, method: channel, kind,
      reference: ref, collectedBy: collectedBy || null, paidAt: today, mayaPaymentId: dedupeId,
    });
    // If nothing was actually inserted (deduped / zero) don't pretend it was paid.
    if (rec.skipped) return { error: "Payment was not recorded (already collected or zero amount)." };

    // MABIBIGAT na side effects (BIR receipt render + attach, emails, warranty,
    // push): kapag deferHeavy, tumatakbo sila PAGKATAPOS maibalik ang response
    // (next/server after) — ang ledger ay naitala na nang sync sa itaas, kaya
    // instant ang Approve sa Payment Approval habang kumpleto pa rin ang resibo
    // at emails ilang segundo pagkatapos.
    const sideEffects = async () => {
    // Reconstruct from the synced ledger so the BIR receipt + email show the right numbers.
    const fresh = await freshFromLedger(db, order, newStatus);
    const payment: PaymentInfo = { via: channel, receiptNumber: `${channel.toUpperCase()}-${ref}${collectedBy ? " · " + collectedBy : ""}`, paymentId: "", reference: ref, amount: collected };
    const store: PayStore = { issuer: channel, receiptNo: payment.receiptNumber, amount: collected };
    await attachReceipt(db, fresh, payment, store);
    // "Order Confirmed" acknowledgement — send it on the FIRST payment that confirms
    // the order (nothing had been paid before this one), whether that's a partial
    // downpayment OR paying in full in one go. Previously only the online Maya flow
    // sent it, so in-store cash/terminal customers never got the confirmation.
    // A later balance payment sends the Official Receipt only (no re-confirm).
    const wasUnpaid = dp <= 0 && existingFull <= 0;
    if (wasUnpaid && !silent) await sendAckEmail(fresh, payment, balanceOf(fresh));
    if (!silent) await sendReceiptEmail(fresh, payment);
    // Ang LUMANG 72mm Acknowledgement Receipt ay retired na (2026-08-10) — ang
    // "ACKNOWLEDGMENT RECEIPT" na ngayon ang dating BIR invoice na kasama na sa
    // dalawang email sa itaas; isa na lang ang acknowledgment na ipinapadala.
    // If this order already has a SIGNED installation warranty and this payment clears
    // the balance, email the Warranty Certificate alongside the receipt — so a final
    // Cash/Terminal/Maya collection at Installation sends BOTH, like the QR flow does.
    try {
      if (!silent && balanceOf(fresh) <= 0.005) {
        const { data: inst } = await db.from("installations")
          .select("warranty_form_url").eq("order_id", orderId).not("warranty_form_url", "is", null).limit(1);
        const wUrl = (inst?.[0]?.warranty_form_url as string | null) ?? null;
        if (wUrl) {
          const { sendWarrantyEmail } = await import("@/app/installation/actions");
          await sendWarrantyEmail(orderId, wUrl);
        }
      }
    } catch { /* best-effort */ }
    // Push Operations to approve — the moment THIS payment pushes the order over the
    // downpayment threshold (that's when it enters the approval queue). Fire on the
    // crossing, not just on wasUnpaid: a first partial below 30% shouldn't alert, but
    // a LATER partial that finally reaches 30% should. Compare paid-before vs paid-now
    // against the threshold so it fires exactly once, on the payment that crosses it.
    try {
      const total2 = Number(order.full_payment_price) || 0;
      const threshold = total2 * 0.3;
      const paidBefore = dp + existingFull;
      const paidNow = (Number(fresh.downpayment_price) || 0) + (Number(fresh.full_payment) || 0);
      const metBefore = total2 <= 0 ? paidBefore > 0 : paidBefore + 0.005 >= threshold;
      const metNow = total2 <= 0 ? paidNow > 0 : paidNow + 0.005 >= threshold;
      if (metNow && !metBefore) {
        const { notifyOpsNewApproval } = await import("@/lib/push/notify");
        await notifyOpsNewApproval({
          orderNumber: order.order_number ?? `#${order.id}`,
          product: order.product_name ?? null,
          total: total2,
          customer: order.customer_name ?? null,
        });
      }
    } catch { /* best-effort */ }
    };
    if (deferHeavy) after(sideEffects);
    else await sideEffects();
    revalidatePath("/orders");
  revalidatePath("/initial-sales");
    revalidatePath("/installation");
    revalidatePath("/dashboard");
    revalidatePath("/operations/approval");
    revalidatePath("/operations/tracker");
    revalidatePath("/delivery");
    revalidatePath("/customers");
    revalidatePath("/inventory");
    revalidatePath("/inventory/adjustments");
    revalidatePath("/quality-control");
    revalidatePath("/scan");
    revalidatePath("/stock-movements");
    revalidatePath("/products");
    revalidatePath("/locations");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to record payment." };
  }
}

// Generate a Maya QR Ph. By default bills the outstanding balance; pass
// mode "downpayment" to bill exactly 30% of the order total (records to
// downpayment_price and confirms the order once paid).
export async function createOrderQr(
  orderId: number,
  testAmount?: number,
  mode: "balance" | "downpayment" = "balance",
): Promise<{ ok: true; paymentId: string; qrCodeBody: string; amount: number } | { error: string }> {
  try {
    if (!(await requirePay())) return { error: "Forbidden." };
    if (!mayaConfigured()) return { error: "Maya keys not set. Add MAYA_PUBLIC_KEY / MAYA_SECRET_KEY to .env.local." };
    const db = createServerSupabase();
    const { data, error } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (error) return { error: error.message };
    const order = data as OrderRow | null;
    if (!order) return { error: "Order not found." };
    const balance = balanceOf(order);
    if (balance <= 0) return { error: "No balance to collect." };
    const isDown = mode === "downpayment";
    if (isDown && downpaymentDue(order) <= 0) return { error: "Downpayment already paid." };
    const isTest = !!testAmount && testAmount > 0;
    const amount = isTest ? Math.min(testAmount as number, balance) : isDown ? downpaymentDue(order) : balance;

    const reference = `${order.order_number || `ORD${order.id}`}-${isDown ? "DP-" : ""}${isTest ? "TEST-" : ""}${Date.now()}`.slice(0, 36);
    const qr = await createQrPayment(amount, reference);
    await db.from("orders").update({
      maya_checkout_id: qr.paymentId, maya_status: "PENDING_TOKEN", maya_ref: reference, maya_paid_at: null,
    }).eq("id", orderId);
    revalidatePath("/orders");
  revalidatePath("/initial-sales");
    revalidatePath("/dashboard");
    revalidatePath("/operations/approval");
    revalidatePath("/operations/tracker");
    revalidatePath("/delivery");
    revalidatePath("/installation");
    revalidatePath("/customers");
    return { ok: true, paymentId: qr.paymentId, qrCodeBody: qr.qrCodeBody, amount };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to generate Maya QR." };
  }
}

// ── REWORK (RMA) Maya QR ─────────────────────────────────────────────────────
// Ang rework balance ay nasa RMA LEDGER (returns.rework_charge_total − rework_
// downpayment), hindi sa orders ledger — kaya hiwalay ang QR flow: ang bayad ay
// kredito sa RMA (bumubukas ang Delivered guardrail), hindi sa orders. Ang Maya
// checkout state ay nakaimbak pa rin sa orders.maya_* columns ng kaugnay na order
// (reference prefix = RMA number para makilala).

type ReworkRet = {
  id: number; return_no: string | null; order_id: number | null; customer_name: string | null;
  resolution: string | null; rework_mode: string | null;
  rework_parts: { part: string; qty: number; amount: number }[] | null;
  rework_delivery_price: number | null; rework_charge_total: number | null; rework_downpayment: number | null;
  // Naaprubahan nang walang downpayment (COD sa redelivery) — kapag totoo ito,
  // wala nang 50% na hakbang at buong balanse na ang sinisingil.
  rework_payment_override_at: string | null;
  // Ang kasangkapan: pangalan + SPECIFICATION / DESIGN DETAILS, para masabi ng
  // resibo at ng email kung ANO ang kinumpuni.
  item_desc: string | null; sku: string | null;
};

async function loadReworkRet(db: ReturnType<typeof createServerSupabase>, returnId: number): Promise<ReworkRet | null> {
  const { data } = await db.from("returns")
    .select("id, return_no, order_id, customer_name, resolution, rework_mode, rework_parts, rework_delivery_price, rework_charge_total, rework_downpayment, rework_payment_override_at, item_desc, sku")
    .eq("id", returnId).maybeSingle();
  const r = data as ReworkRet | null;
  return r && r.resolution === "rework" ? r : null;
}

export async function createReworkQr(returnId: number): Promise<{ ok: true; paymentId: string; qrCodeBody: string; amount: number } | { error: string }> {
  try {
    if (!(await requirePay())) return { error: "Forbidden." };
    if (!mayaConfigured()) return { error: "Maya keys not set. Add MAYA_PUBLIC_KEY / MAYA_SECRET_KEY to .env.local." };
    const db = createServerSupabase();
    const r = await loadReworkRet(db, returnId);
    if (!r) return { error: "Rework return not found." };
    if (r.order_id == null) return { error: "This RMA has no linked order — QR unavailable." };
    const charge = Number(r.rework_charge_total) || 0;
    const due = Math.max(Math.round((charge - (Number(r.rework_downpayment) || 0)) * 100) / 100, 0);
    if (due <= 0) return { error: "No rework balance to collect." };
    const { data: o } = await db.from("orders").select("id, order_number").eq("id", r.order_id).maybeSingle();
    if (!o) return { error: "Linked order not found." };

    // Ang halaga ay naka-embed sa reference (-RW-<cents>-<ts>) para alam ng
    // checkReworkPayment kung magkano EKSAKTO ang ikredito pagka-paid.
    // 36 CHAR ANG HANGGANAN NG MAYA (2026-08-28). Kasama ang HALAGA sa reference
    // noon — sa malaking singil ay lumalampas ito at tinatanggihan ang QR, kaya
    // walang naipapadalang email. Ang timestamp ang nagpapabukod; ang halaga ay
    // nasa `totalAmount` naman.
    const reference = `${r.return_no ?? `RMA${r.id}`}-RW-${Date.now()}`.slice(0, 36);
    const qr = await createQrPayment(due, reference);
    await db.from("orders").update({
      maya_checkout_id: qr.paymentId, maya_status: "PENDING_TOKEN", maya_ref: reference, maya_paid_at: null,
    }).eq("id", r.order_id);
    // Itago ang QR body sa return row (0154) para maipakita ng review ang PAREHONG
    // session (poll/auto-credit intact). Best-effort — ok lang kung wala pa ang column.
    try { await db.from("returns").update({ rework_qr_body: qr.qrCodeBody }).eq("id", r.id); } catch { /* 0154 pending */ }
    return { ok: true, paymentId: qr.paymentId, qrCodeBody: qr.qrCodeBody, amount: due };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to generate the rework Maya QR." };
  }
}

// EMAIL QR sa deklarasyon ng rework: padalhan ang customer ng Maya QR para sa
// 50% DOWNPAYMENT (bago pa ang approval). Walang bayad na nirerekord dito — ang
// kredito ay awtomatiko pagka-paid (checkReworkPayment) o manual collect.
export async function sendReworkQrRequest(returnId: number): Promise<{ ok: true; amount: number; emailed: boolean } | { error: string }> {
  try {
    if (!(await requirePay())) return { error: "Forbidden." };
    if (!mayaConfigured()) return { error: "Maya keys not set." };
    const db = createServerSupabase();
    const r = await loadReworkRet(db, returnId);
    if (!r) return { error: "Rework return not found." };
    if (r.order_id == null) return { error: "This RMA has no linked order — QR unavailable." };
    const charge = Number(r.rework_charge_total) || 0;
    const down = Number(r.rework_downpayment) || 0;
    // NAKA-OVERRIDE = naaprubahan nang walang downpayment, COD sa redelivery:
    // wala nang 50% na hakbang, kaya BUONG BALANSE ang sinisingil (2026-08-28).
    // Kalahati ang ipinapa-scan noon — ₱9,417 sa ₱18,833 na dapat — kaya kulang
    // ang nakokolekta at nananatiling bukas ang natitira.
    const overridden = !!r.rework_payment_override_at;
    const due50 = Math.max(Math.round(((overridden ? charge : charge * 0.5) - down) * 100) / 100, 0);
    if (due50 <= 0) return { error: overridden ? "This rework is already fully paid." : "The 50% downpayment is already met." };
    const { data: o } = await db.from("orders").select("id, order_number, email").eq("id", r.order_id).maybeSingle();
    if (!o) return { error: "Linked order not found." };

    const reference = `${r.return_no ?? `RMA${r.id}`}-RW-${Date.now()}`.slice(0, 36);
    const qr = await createQrPayment(due50, reference);
    await db.from("orders").update({
      maya_checkout_id: qr.paymentId, maya_status: "PENDING_TOKEN", maya_ref: reference, maya_paid_at: null,
    }).eq("id", r.order_id);
    // Itago ang QR body sa return row (0154) — ipapakita ito ng Returns review bilang
    // live QR (same session ng na-email). Best-effort kung wala pa ang column.
    try { await db.from("returns").update({ rework_qr_body: qr.qrCodeBody }).eq("id", r.id); } catch { /* 0154 pending */ }

    const email = ((o.email as string | null) ?? "").trim();
    let emailed = false;
    if (email) {
      const QRCode = (await import("qrcode")).default;
      const qrDataUrl = await QRCode.toDataURL(qr.qrCodeBody, { width: 480, margin: 2 });
      const parts = (r.rework_parts ?? []).map((p) => ({ part: p.part, qty: Number(p.qty) || 1, amount: Number(p.amount) || 0 }));
      await sendReworkEmail({
        to: email, customerName: r.customer_name ?? null, rmaNo: r.return_no ?? `#${r.id}`,
        mode: (r.rework_mode as "onsite" | "pullout" | null) ?? "onsite",
        itemDesc: (r.item_desc as string | null) ?? null, itemSku: (r.sku as string | null) ?? null,
        parts, deliveryPrice: Number(r.rework_delivery_price) || 0,
        chargeTotal: charge, amountDue: due50, collected: down, method: "Email QR", qrDataUrl,
      }, "qr");
      emailed = true;
    }
    return { ok: true, amount: due50, emailed };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to send the rework QR email." };
  }
}

// Poll ng rework QR — pagka-PAID, ang kredito ay sa RMA ledger + resibo email.
export async function checkReworkPayment(returnId: number): Promise<{ ok: true; status: string; paid: boolean } | { error: string }> {
  try {
    if (!(await requirePay())) return { error: "Forbidden." };
    const db = createServerSupabase();
    const r = await loadReworkRet(db, returnId);
    if (!r || r.order_id == null) return { error: "Rework return not found." };
    const { data } = await db.from("orders").select("*").eq("id", r.order_id).maybeSingle();
    const order = data as OrderRow | null;
    if (!order?.maya_checkout_id) return { error: "No Maya payment for this RMA yet." };
    const isReworkRef = (order.maya_ref ?? "").startsWith(r.return_no ?? `RMA${r.id}`);
    if (!isReworkRef) return { error: "The current Maya session is not for this RMA — regenerate the QR." };
    // "-CREDITED" marker sa maya_ref = tapos na ang kredito (idempotent). Kapag
    // paid na pero WALANG marker (naunang na-flag ng ibang poller / lumang bug),
    // ituloy pa rin sa credit block sa baba — self-healing.
    if (order.maya_paid_at && /-CREDITED$/.test(order.maya_ref ?? "")) {
      return { ok: true, status: order.maya_status || "PAYMENT_SUCCESS", paid: true };
    }

    let stStatus = order.maya_status || "PAYMENT_SUCCESS";
    if (!order.maya_paid_at) {
      const st = await fetchStatus(order);
      if (!st.isPaid) {
        await db.from("orders").update({ maya_status: st.status }).eq("id", r.order_id);
        return { ok: true, status: st.status, paid: false };
      }
      stStatus = st.status;
    }

    // PAID → kredito sa RMA ledger. Ang EKSAKTONG halaga ng QR ay naka-embed sa
    // reference (-RW-<cents>-<ts>); legacy refs (walang cents) → buong natitirang due.
    const charge = Number(r.rework_charge_total) || 0;
    const already = Number(r.rework_downpayment) || 0;
    const refM = (order.maya_ref ?? "").replace(/-CREDITED$/, "").match(/-RW-(\d+)-\d+$/);
    const qrAmt = refM ? Number(refM[1]) / 100 : Math.max(charge - already, 0);
    const downpayment = Math.min(Math.round((already + qrAmt) * 100) / 100, charge);
    const { error: crErr } = await db.from("returns").update({
      rework_downpayment: downpayment,
      rework_payment_method: "Maya QR Ph",
      ...(already ? {} : { rework_paid_at: new Date().toISOString() }),
    }).eq("id", r.id);
    if (crErr) return { error: `Paid, but crediting the RMA failed: ${crErr.message}` };
    await db.from("orders").update({
      maya_status: stStatus,
      maya_paid_at: order.maya_paid_at ?? new Date().toISOString(),
      maya_ref: `${(order.maya_ref ?? "").replace(/-CREDITED$/, "")}-CREDITED`,
    }).eq("id", r.order_id);

    // Resibo email + slip attachment (best-effort) — kapareho ng Cash/Terminal collect.
    try {
      const email = (order.email ?? "").trim();
      {
        const parts = (r.rework_parts ?? []).map((p) => ({ part: p.part, qty: Number(p.qty) || 1, amount: Number(p.amount) || 0 }));
        const payload = {
          to: email, orderId: r.order_id, customerName: r.customer_name ?? null, rmaNo: r.return_no ?? `#${r.id}`,
          mode: (r.rework_mode as "onsite" | "pullout" | null) ?? "onsite",
          itemDesc: (r.item_desc as string | null) ?? null, itemSku: (r.sku as string | null) ?? null,
          parts, deliveryPrice: Number(r.rework_delivery_price) || 0,
          // Ang hinihinging halaga ay buong balanse kapag naka-override (walang
          // downpayment na hakbang) — kalahati lang ang sinasabi ng resibo noon.
          chargeTotal: charge,
          amountDue: r.rework_payment_override_at ? charge : Math.round(charge * 0.5 * 100) / 100,
          collected: downpayment, method: "Maya QR Ph",
        };
        // DALAWANG email pagka-bayad (tulad ng normal orders): Acknowledgement
        // Receipt + Rework (official) Receipt — parehong may PDF slip.
        await sendReworkEmail(payload, "ack");
        await sendReworkEmail(payload, "receipt");
      }
    } catch { /* best-effort */ }

    revalidatePath("/installation");
    revalidatePath("/returns");
    revalidatePath("/operations/returns");
    revalidatePath("/delivery");
    revalidatePath("/operations/delivery-queue");
    return { ok: true, status: stStatus, paid: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to check the rework payment." };
  }
}

// Charge a tokenized card (Vault) for an order's balance. The browser tokenizes the
// card (card data never touches our server); this just charges the token. Returns a
// verificationUrl when 3DS is required.
export async function chargeCardPayment(orderId: number, paymentTokenId: string): Promise<{ ok: true; paymentId: string; verificationUrl: string; isPaid: boolean; status: string } | { error: string }> {
  try {
    if (!(await requirePay())) return { error: "Forbidden." };
    if (!mayaConfigured()) return { error: "Maya keys not set." };
    if (!paymentTokenId) return { error: "Missing card token." };
    const db = createServerSupabase();
    const { data, error } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (error) return { error: error.message };
    const order = data as OrderRow | null;
    if (!order) return { error: "Order not found." };
    const amount = balanceOf(order);
    if (amount <= 0) return { error: "No balance to collect." };

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://localhost:3000").replace(/\/+$/, "");
    const ref = `${order.order_number || `ORD${order.id}`}-CARD-${Date.now()}`;
    const nameParts = (order.customer_name || "").trim().split(/\s+/);
    const buyer = {
      firstName: nameParts[0] || undefined,
      lastName: nameParts.slice(1).join(" ") || undefined,
      email: order.email || undefined, phone: order.contact_number || undefined, line1: order.address || undefined,
    };
    const pay = await createCardPayment(paymentTokenId, amount, ref, {
      success: `${appUrl}/installation?paid=1`, failure: `${appUrl}/installation?paid=0`, cancel: `${appUrl}/installation?paid=cancel`,
    }, buyer);
    await db.from("orders").update({
      maya_checkout_id: pay.paymentId, maya_status: pay.status, maya_ref: ref, maya_paid_at: null,
    }).eq("id", orderId);
    // If it settled immediately (no 3DS), record it now.
    if (pay.isPaid) {
      const fresh = { ...order, maya_checkout_id: pay.paymentId, maya_ref: ref } as OrderRow;
      const st = await getPaymentStatus(pay.paymentId);
      await applyPayment(db, fresh, st);
      revalidatePath("/orders");
  revalidatePath("/initial-sales"); revalidatePath("/installation");
      revalidatePath("/inventory");
      revalidatePath("/inventory/adjustments");
      revalidatePath("/quality-control");
      revalidatePath("/scan");
      revalidatePath("/stock-movements");
      revalidatePath("/products");
      revalidatePath("/locations");
    }
    revalidatePath("/orders");
  revalidatePath("/initial-sales");
    revalidatePath("/dashboard");
    revalidatePath("/operations/approval");
    revalidatePath("/operations/tracker");
    revalidatePath("/delivery");
    revalidatePath("/installation");
    revalidatePath("/customers");
    return { ok: true, paymentId: pay.paymentId, verificationUrl: pay.verificationUrl, isPaid: pay.isPaid, status: pay.status };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to charge card." };
  }
}

// Rebuild the BIR receipt for an already-paid order (e.g. after the receipt format
// changed). Strips prior auto-generated receipts and attaches a fresh one.
export async function regenerateMayaReceipt(orderId: number): Promise<{ ok: true } | { error: string }> {
  try {
    if (!(await requirePay())) return { error: "Forbidden." };
    const db = createServerSupabase();
    const { data, error } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (error) return { error: error.message };
    const order = data as OrderRow | null;
    if (!order) return { error: "Order not found." };
    if (!order.maya_checkout_id) return { error: "No Maya payment for this order." };
    const st = await getPaymentStatus(order.maya_checkout_id);
    const { payment, store } = mayaPayment(order, st);
    await attachReceipt(db, order, payment, store); // strips old + attaches fresh
    revalidatePath("/orders");
  revalidatePath("/initial-sales");
    revalidatePath("/dashboard");
    revalidatePath("/operations/approval");
    revalidatePath("/operations/tracker");
    revalidatePath("/delivery");
    revalidatePath("/installation");
    revalidatePath("/customers");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to regenerate receipt." };
  }
}

// Poll a single order's Maya payment status (used by the open QR modal).
export async function checkOrderPayment(orderId: number): Promise<{ ok: true; status: string; paid: boolean } | { error: string }> {
  try {
    if (!(await requirePay())) return { error: "Forbidden." };
    const db = createServerSupabase();
    const { data, error } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (error) return { error: error.message };
    const order = data as OrderRow | null;
    if (!order) return { error: "Order not found." };
    if (!order.maya_checkout_id) return { error: "No Maya payment for this order yet." };
    // REWORK QR session (-RW- sa reference): HUWAG i-apply sa orders ledger — ang
    // kredito nito ay sa RMA (checkReworkPayment ang bahala). Status lang ang iulat.
    if (/-RW-\d+/.test(order.maya_ref ?? "")) {
      if (order.maya_paid_at) return { ok: true, status: order.maya_status || "PAYMENT_SUCCESS", paid: true };
      const rst = await fetchStatus(order);
      await db.from("orders").update({ maya_status: rst.status, ...(rst.isPaid ? { maya_paid_at: new Date().toISOString() } : {}) }).eq("id", orderId);
      return { ok: true, status: rst.status, paid: rst.isPaid };
    }
    if (order.maya_paid_at) return { ok: true, status: order.maya_status || "PAYMENT_SUCCESS", paid: true };

    const st = await fetchStatus(order);
    if (st.isPaid) {
      await applyPayment(db, order, st);
      revalidatePath("/orders");
  revalidatePath("/initial-sales");
      revalidatePath("/inventory");
      revalidatePath("/inventory/adjustments");
      revalidatePath("/quality-control");
      revalidatePath("/scan");
      revalidatePath("/stock-movements");
      revalidatePath("/products");
      revalidatePath("/locations");
    } else {
      await db.from("orders").update({ maya_status: st.status }).eq("id", orderId);
    }
    revalidatePath("/orders");
  revalidatePath("/initial-sales");
    revalidatePath("/dashboard");
    revalidatePath("/operations/approval");
    revalidatePath("/operations/tracker");
    revalidatePath("/delivery");
    revalidatePath("/installation");
    revalidatePath("/customers");
    return { ok: true, status: st.status, paid: st.isPaid };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to check payment." };
  }
}
