"use client";

import { useState, useTransition } from "react";
import { Modal } from "./modal";
import { cn } from "./ui";
import { loadEmailLog, resendEmail, type EmailLogRow } from "@/app/orders/email-log-actions";
import { sendForPaymentEmail } from "@/app/orders/maya-actions";
import { resendConfirmation } from "@/app/operations/delivery-queue/actions";

// SOBRE-BUTTON sa Sales Orders (0201): bawat email na ipinadala sa order na
// ito — uri, kanino, kailan, status — at Resend kada hilera. Dating tahimik
// na nawawala ang bigong email; dito na ito kita at naipapadala ulit.
const TYPE_LABEL: Record<string, string> = {
  for_payment: "Payment Request",
  order_confirmed: "Order Confirmed",
  receipt: "Payment Receipt",
  rework_qr: "Rework — Payment Request",
  rework_receipt: "Rework — Receipt",
  rework_ack: "Rework — Acknowledgement",
  delivery_confirmation: "Delivery Confirmation",
  delivery_followup: "Delivery Follow-up",
  delivery_confirmed_ack: "Delivery Confirmed",
  delivery_rescheduled: "Delivery Rescheduled",
  delivery_reminder: "Delivery Reminder",
  out_for_delivery: "Out for Delivery",
  arrived: "Arrived",
  warranty: "Warranty Certificate",
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

export function EmailLogButton({ orderId, orderNumber, canResend }: { orderId: number; orderNumber: string | null; canResend: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<EmailLogRow[] | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => start(async () => setRows(await loadEmailLog(orderId)));
  const openLog = () => { setOpen(true); setMsg(null); load(); };
  const doResend = (id: number) => start(async () => {
    const r = await resendEmail(id);
    setMsg("error" in r ? r.error : "Resent.");
    load();
  });
  // SEND (2026-08-26): mga email na maaaring ipadala on-demand mula rito.
  // Ang iba (receipt, warranty, out-for-delivery) ay ipinapadala ng kani-
  // kanilang daloy at hindi basta maipapadala nang wala ang konteksto nila.
  const doSend = (fn: () => Promise<{ ok?: true; error?: string } | { ok: true } | { error: string }>, label: string) => start(async () => {
    const r = await fn();
    setMsg("error" in r && r.error ? r.error : `${label} sent.`);
    load();
  });

  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); openLog(); }} title="Email log — every email sent for this order" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-[#faf6ec] hover:text-[#4a3b1a]">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Email Log" description={orderNumber ?? `#${orderId}`} size="xl"
          footer={<div className="flex justify-end"><button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90">Close</button></div>}>
          {msg && <p className={cn("mb-2 rounded-lg px-3 py-2 text-xs font-medium", /Resent/.test(msg) ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-red-200 bg-red-50 text-red-700")}>{msg}</p>}
          {canResend && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-[#faf6ec]/60 px-3 py-2">
              <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-muted">Send</span>
              <button type="button" disabled={pending} onClick={() => doSend(() => sendForPaymentEmail(orderId), "Payment request")} title="Email the 30% downpayment QR for this order" className="rounded-lg border border-[#caa45a] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#4a3b1a] hover:bg-[#f4ead8] disabled:opacity-50">Payment Request (QR)</button>
              <button type="button" disabled={pending} onClick={() => doSend(() => resendConfirmation(orderId), "Delivery confirmation")} title="Resend the delivery confirmation — the order must be Awaiting Confirm" className="rounded-lg border border-[#caa45a] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#4a3b1a] hover:bg-[#f4ead8] disabled:opacity-50">Delivery Confirmation</button>
              <span className="text-[10px] text-muted">Other emails (receipt, warranty, out-for-delivery) are sent by their own steps in the flow.</span>
            </div>
          )}
          {rows == null ? (
            <p className="py-8 text-center text-sm text-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No emails recorded yet for this order. (Emails sent before the outbox existed are not listed.)</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[720px] border-collapse text-center text-xs [&_td]:border-b [&_td]:border-border [&_th]:border-b [&_th]:border-border [&_th]:font-bold">
                <thead>
                  <tr className="bg-[#5a4a26] text-[10px] uppercase tracking-wide text-[#e7dcc4]">
                    <th className="px-3 py-2.5">Email</th>
                    <th className="px-3 py-2.5">To</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">When</th>
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-stone-50">
                      <td className="px-3 py-2.5 text-left">
                        <span className="block font-semibold">{TYPE_LABEL[r.email_type] ?? r.email_type}</span>
                        <span className="block truncate text-[11px] text-muted" title={r.subject}>{r.subject}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted">{r.to_email}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset",
                          r.status === "sent" ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                          : r.status === "failed" ? "bg-red-50 text-red-700 ring-red-600/20"
                          : "bg-amber-50 text-amber-700 ring-amber-600/20")}
                          title={r.error ?? undefined}>
                          {r.status === "sent" ? "Sent" : r.status === "failed" ? "Failed" : "Pending"}
                        </span>
                        {r.error && <span className="mt-0.5 block max-w-[180px] truncate text-[10px] text-red-600" title={r.error}>{r.error}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted">{fmtWhen(r.sent_at ?? r.created_at)}</td>
                      <td className="px-3 py-2.5">
                        {canResend && (
                          <button type="button" disabled={pending} onClick={() => doResend(r.id)}
                            title={r.has_attachment ? "Resend — the PDF attachment is not stored, only the email body resends" : "Resend this email"}
                            className="rounded-lg border border-[#caa45a] bg-[#faf6ec] px-2.5 py-1 text-[11px] font-semibold text-[#4a3b1a] hover:bg-[#f4ead8] disabled:opacity-50">
                            Resend{r.has_attachment ? " *" : ""}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.some((r) => r.has_attachment) && <p className="px-3 py-2 text-left text-[10.5px] text-muted">* The original carried a PDF attachment — a resend delivers the email body only.</p>}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
