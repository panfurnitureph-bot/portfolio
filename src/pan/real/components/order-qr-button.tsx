"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { qrWithAmount, isMerchant } from "@/lib/qrph";
import { savePaymentQr } from "@/app/orders/qr-actions";
import { createOrderQr, checkOrderPayment } from "@/app/orders/maya-actions";
import type { OrderRow } from "@/lib/supabase/server";
import { DOWNPAYMENT_RATE } from "@/app/orders/downpayment";

const peso2 = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function balanceOf(o: OrderRow): number {
  const total = Number(o.full_payment_price) || 0;
  const paid = (Number(o.downpayment_price) || 0) + (Number(o.full_payment) || 0);
  return Math.max(total - paid, 0);
}

// 30% of the order total, capped at the balance. Returns 0 once any downpayment
// has been recorded (downpayment_price set) — i.e. the downpayment step is done.
function downpaymentDue(o: OrderRow): number {
  if ((Number(o.downpayment_price) || 0) > 0) return 0;
  const total = Number(o.full_payment_price) || 0;
  const due = Math.round(total * DOWNPAYMENT_RATE * 100) / 100;
  return Math.min(due, balanceOf(o));
}

export function OrderQrButton({ order, paymentQr = "", mayaEnabled = false }: { order: OrderRow; paymentQr?: string; mayaEnabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const balance = balanceOf(order);
  const dpDue = downpaymentDue(order);
  // "Already paid" means the order is FULLY settled (no balance left). A prior
  // downpayment sets maya_paid_at but leaves a balance — that must still allow a new
  // QR for the remaining amount, so gate on balance, not just maya_paid_at.
  const alreadyPaid = !!order.maya_paid_at && balance <= 0;
  // Default to billing the 30% downpayment when it's still due; else the balance.
  const [mode, setMode] = useState<"balance" | "downpayment">(dpDue > 0 ? "downpayment" : "balance");
  const chargeAmount = mode === "downpayment" ? dpDue : balance;

  // ── Maya QR Ph (scannable, auto-detect) ─────────────────────────────────
  const [mayaQr, setMayaQr] = useState<string | null>(null);
  const [mayaStatus, setMayaStatus] = useState<string>(alreadyPaid ? "PAYMENT_SUCCESS" : "");
  const [mayaPaid, setMayaPaid] = useState<boolean>(alreadyPaid);
  const [mayaBusy, setMayaBusy] = useState(false);
  const [isTest, setIsTest] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPoll() { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }
  useEffect(() => () => stopPoll(), []);

  useEffect(() => {
    if (open && mayaEnabled && balance > 0 && !mayaQr && !mayaPaid && !mayaBusy) startMaya();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  async function genQrImage(text: string, set: (u: string) => void) {
    const QRCode = (await import("qrcode")).default;
    set(await QRCode.toDataURL(text, { width: 360, margin: 1, errorCorrectionLevel: "M" }));
  }

  async function startMaya(testAmount?: number) {
    setError(null); setMayaBusy(true); setMayaQr(null); setMayaStatus(""); setMayaPaid(false); setIsTest(!!testAmount);
    try {
      const r = await createOrderQr(order.id, testAmount, mode);
      if ("error" in r) { setError(r.error); setMayaBusy(false); return; }
      await genQrImage(r.qrCodeBody, setMayaQr); // qrCodeBody is a real QR Ph payload
      setMayaStatus("PENDING_TOKEN");
      setMayaBusy(false);
      stopPoll();
      pollRef.current = setInterval(async () => {
        const s = await checkOrderPayment(order.id);
        if ("error" in s) return;
        setMayaStatus(s.status);
        // Payment + receipt are applied server-side; just reflect the result.
        if (s.paid) { setMayaPaid(true); stopPoll(); router.refresh(); }
      }, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Maya error."); setMayaBusy(false);
    }
  }

  // ── Static QR Ph fallback (no Maya keys) ────────────────────────────────
  const [payload, setPayload] = useState(paymentQr);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [pending, start] = useTransition();
  const merchant = isMerchant(payload);

  async function genStatic(p: string) {
    setError(null);
    try {
      const clean = p.replace(/[\r\n\t]+/g, "").trim();
      const payloadForQr = isMerchant(clean) ? qrWithAmount(clean, balance) : clean;
      const QRCode = (await import("qrcode")).default;
      setQrUrl(await QRCode.toDataURL(payloadForQr, { width: 360, margin: 1, errorCorrectionLevel: "M" }));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to generate QR."); }
  }
  function saveQr() {
    setError(null);
    start(async () => {
      const clean = paste.replace(/[\r\n\t]+/g, "").trim();
      const r = await savePaymentQr(clean);
      if ("error" in r) { setError(r.error); return; }
      setPayload(clean); router.refresh(); genStatic(clean);
    });
  }

  function openModal() {
    setOpen(true); setError(null);
    if (!mayaEnabled && payload && balance > 0) genStatic(payload);
  }
  function closeModal() { stopPoll(); setOpen(false); }

  function printQr() {
    const img = mayaEnabled ? mayaQr : qrUrl;
    if (!img) return;
    const w = window.open("", "_blank", "width=420,height=600");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Payment QR ${order.order_number ?? ""}</title>
      <style>body{font-family:Arial,sans-serif;text-align:center;margin:0;padding:24px}h2{margin:4px 0}img{width:300px;height:300px}</style></head>
      <body><h2>Pay ₱${peso2(chargeAmount)}</h2><p>${order.order_number ?? ""} · ${(order.customer_name ?? "").replace(/[<>]/g, "")}</p>
      <img src="${img}" alt="QR" /><p style="font-size:12px;color:#666">Scan with GCash / Maya / GoTyme / any QR Ph app</p>
      <script>window.onload=function(){window.print()};window.onafterprint=function(){window.close()}<\/script></body></html>`);
    w.document.close();
  }

  const statusLabel = (s: string) =>
    /PAYMENT_SUCCESS/i.test(s) ? "✓ Paid" :
    /PENDING/i.test(s) ? "Waiting for payment…" :
    /FAIL/i.test(s) ? "Payment failed" :
    /EXPIRE/i.test(s) ? "QR expired" :
    /CANCEL|VOID/i.test(s) ? "Cancelled" : s || "—";

  return (
    <>
      <button onClick={openModal} aria-label="Generate payment QR" title="Payment QR" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-stone-100 hover:text-primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM21 14v7M17 21h4" /></svg>
      </button>

      <Modal open={open} onClose={closeModal} title="Payment QR" description={order.order_number ?? undefined}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={closeModal} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Close</button>
            {((mayaEnabled && mayaQr) || (!mayaEnabled && qrUrl)) && <button onClick={printQr} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Print</button>}
          </div>
        }>
        {balance <= 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">

            <p className="text-sm font-semibold text-success">Fully paid — no balance to collect.</p>
            {order.maya_paid_at && <p className="text-xs text-muted">Receipt generated &amp; emailed to the customer.</p>}
          </div>
        ) : mayaEnabled ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-lg font-bold text-primary">Pay ₱{peso2(chargeAmount)}</p>
            <p className="text-xs text-muted">{order.customer_name ?? ""} · {order.order_number ?? ""}</p>
            {dpDue > 0 && !mayaPaid && (
              <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
                <button
                  onClick={() => { if (mode !== "downpayment") { setMode("downpayment"); setMayaQr(null); } }}
                  className={`rounded-md px-3 py-1 font-medium ${mode === "downpayment" ? "bg-primary text-primary-foreground" : "text-muted hover:bg-stone-100"}`}>
                  30% Downpayment · ₱{peso2(dpDue)}
                </button>
                <button
                  onClick={() => { if (mode !== "balance") { setMode("balance"); setMayaQr(null); } }}
                  className={`rounded-md px-3 py-1 font-medium ${mode === "balance" ? "bg-primary text-primary-foreground" : "text-muted hover:bg-stone-100"}`}>
                  Full ₱{peso2(balance)}
                </button>
              </div>
            )}

            {mayaPaid ? (
              <div className="my-4 rounded-xl bg-emerald-50 px-6 py-8 text-center">

                <p className="mt-1 text-base font-bold text-emerald-700">Payment received</p>
                <p className="text-xs text-emerald-600">Order auto-marked paid.</p>
                {!isTest && <p className="mt-1 text-[11px] text-emerald-600">Receipt saved to order images.</p>}
              </div>
            ) : mayaQr ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mayaQr} alt="Maya QR Ph" className="h-72 w-72" />
                <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />{statusLabel(mayaStatus)}
                </span>
                <p className="text-[11px] text-muted">Scan with <b>GCash / GoTyme / Maya / any bank</b> — amount is locked. Auto-detects payment.</p>
                <button onClick={() => startMaya(1)} disabled={mayaBusy} className="text-[11px] text-muted underline">Test ₱1 instead (won&apos;t change balance)</button>
              </>
            ) : (
              <p className="py-16 text-sm text-muted">{mayaBusy ? "Generating QR…" : "Preparing…"}</p>
            )}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
        ) : !payload ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">No payment QR set yet. Paste your <b>GCash/Maya QR Ph payload</b> (the long text starting with <code>000201…</code>) once — it will be reused for all orders.</p>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} placeholder="000201010211…" className="w-full rounded-lg border border-border bg-stone-50 px-3 py-2 font-mono text-xs outline-none focus:border-primary" />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button onClick={saveQr} disabled={pending || !paste.trim()} className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">{pending ? "Saving…" : "Save QR"}</button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-lg font-bold text-primary">Pay ₱{peso2(balance)}</p>
            <p className="text-xs text-muted">{order.customer_name ?? ""} · {order.order_number ?? ""}</p>
            {qrUrl
              ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={qrUrl} alt="Payment QR" className="h-72 w-72" />
              : <p className="py-16 text-sm text-muted">Generating…</p>}
            {merchant
              ? <p className="text-[11px] text-muted">Amount is locked. Scan with GCash / Maya / any QR Ph app, then mark the order paid.</p>
              : <p className="text-[11px] text-amber-700">Personal QR — customer must <b>type ₱{peso2(balance)}</b> manually.</p>}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button onClick={() => { setPayload(""); setQrUrl(null); }} className="text-[11px] text-muted underline">Update payment QR</button>
          </div>
        )}
      </Modal>
    </>
  );
}
