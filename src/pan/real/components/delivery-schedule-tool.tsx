"use client";

// DELIVERY SCHEDULE tool — pagkatapos ng usapan sa Messenger (RESCHED- ref):
// pumili ng order → kita agad ang BUONG detalye (customer, address, items,
// kasalukuyang schedule, team, COD, fee status) → bagong date + time window +
// one-time ₱500 fee → apply. Ginagamit sa Delivery Queue sub-tab (Ops) at sa
// sariling Sales & Service page.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "./ui";
import { opsRescheduleOrder } from "@/app/operations/delivery-queue/actions";
import type { OrderRow } from "@/lib/supabase/server";

const WINDOWS = ["9–11 AM", "11 AM–1 PM", "1–3 PM", "3–5 PM"];
const peso = (n: number) => `₱${(Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
const fmtLong = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try { return new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" }); }
  catch { return String(iso); }
};

type DqRow = OrderRow & {
  dq_status?: string | null; dq_date?: string | null; dq_time_window?: string | null;
  dq_team?: string | null; dq_driver?: string | null; customer_psid?: string | null;
};

type ItemInfo = {
  name: string; qty: number; unitPrice: number; sku: string | null; image: string | null;
  color: string | null; dimension: string | null; customized: boolean;
  // Natitirang linya ng description = spec bullets (bagong format 2026-08-18).
  specs: string[];
};

function itemInfos(o: OrderRow): ItemInfo[] {
  if (!Array.isArray(o.receipt_items)) return [];
  return (o.receipt_items as {
    description?: string; qty?: number; unitPrice?: number; sku?: string | null; image?: string | null;
    color?: string | null; dimension?: string | null; customized?: boolean;
  }[])
    .filter((it) => !/^shipping\b|^reschedule fee/i.test(String(it?.description ?? "").trim()))
    .map((it) => ({
      name: String(it.description ?? "").split("\n")[0].trim(),
      qty: Number(it.qty) || 1,
      unitPrice: Number(it.unitPrice) || 0,
      sku: it.sku || null,
      image: it.image || null,
      color: it.color || null,
      dimension: it.dimension || null,
      customized: !!it.customized,
      specs: String(it.description ?? "").split("\n").slice(1).map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^[•·\-\s]+/, "")),
    }))
    .filter((it) => !!it.name);
}

function DetailRow({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#efe9db] py-2.5 last:border-0">
      <span className="whitespace-nowrap pt-0.5 text-[10px] font-bold uppercase tracking-widest text-[#8a8272]">{label}</span>
      <span className={cn("text-right text-[13px] leading-relaxed text-[#2b2620]", bold ? "font-bold" : "font-medium")}>{value}</span>
    </div>
  );
}

export function DeliveryScheduleTool({ orders, canEdit, reworkTags = {} }: { orders: OrderRow[]; canEdit: boolean; reworkTags?: Record<number, string | null> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [orderId, setOrderId] = useState<number | "">("");
  const [date, setDate] = useState("");
  const [win, setWin] = useState<string | null>(null);
  const [applyFee, setApplyFee] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const inQueue = (orders as DqRow[]).filter((o) => o.dq_status === "confirmed" || o.dq_status === "pending");
  const sel = inQueue.find((o) => o.id === orderId) || null;
  const feeCharged = !!sel && Array.isArray(sel.receipt_items) &&
    sel.receipt_items.some((it) => /^reschedule fee/i.test(String(it?.description ?? "").trim()));
  const balance = sel
    ? Math.max(Number(sel.full_payment_price ?? 0) - Number(sel.downpayment_price ?? 0) - Number(sel.full_payment ?? 0), 0)
    : 0;
  const willCharge = applyFee && !feeCharged;

  const submit = () => {
    setMsg(null); setOk(null);
    start(async () => {
      const res = await opsRescheduleOrder({ orderId: Number(orderId), dateISO: date, timeWindow: win, applyFee: willCharge });
      if ("error" in res) { setMsg(res.error); return; }
      setOk(`Rescheduled to ${fmtLong(date)}${res.feeApplied ? " — ₱500 fee added to the COD balance" : ""}. The customer has been notified.`);
      setOrderId(""); setDate(""); setWin(null);
      router.refresh();
    });
  };

  const lbl = "mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#8a8272]";
  const inp = "w-full rounded-lg border border-[#e6dcc4] bg-white px-3 py-2.5 text-sm text-[#2b2620] outline-none focus:border-[#caa45a]";

  return (
    <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-xl border border-[#e6dcc4] bg-white shadow-sm">
      {/* Header band — brand */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-[3px] border-[#caa45a] bg-[#4a3b1a] px-6 py-4">
        <div>
          <p className="text-sm font-bold tracking-wide text-[#f4ead8]">DELIVERY SCHEDULE</p>
          <p className="mt-0.5 text-[11px] text-[#c9b896]">Set a new delivery date after coordinating with the customer on Messenger</p>
        </div>
        <span className="rounded-full bg-[#5a4a26] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#e7dcc4]">One-time ₱500 fee</span>
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-2">
        {/* ── Kaliwa: pagpili + bagong schedule ── */}
        <div className="space-y-5">
          <div>
            <label className={lbl}>Order — in queue (pending / confirmed)</label>
            <select value={orderId} onChange={(e) => { setOrderId(e.target.value ? Number(e.target.value) : ""); setOk(null); setMsg(null); }} className={inp}>
              <option value="">— select order —</option>
              {inQueue.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.order_number ?? `#${o.id}`} · {o.customer_name ?? "—"}{o.id in reworkTags ? ` · Rework${reworkTags[o.id] ? ` (${reworkTags[o.id]})` : ""}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={lbl}>New delivery date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
          </div>

          <div>
            <label className={lbl}>Preferred time window</label>
            <div className="flex flex-wrap gap-2">
              {WINDOWS.map((w) => (
                <button key={w} type="button" onClick={() => setWin(win === w ? null : w)}
                  className={win === w
                    ? "rounded-full bg-[#4a3b1a] px-3.5 py-1.5 text-xs font-bold text-[#f4ead8]"
                    : "rounded-full border border-[#e6dcc4] px-3.5 py-1.5 text-xs font-semibold text-[#6b6353] hover:border-[#caa45a]"}>
                  {w}
                </button>
              ))}
            </div>
          </div>

          <label className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-3", feeCharged ? "border-emerald-200 bg-emerald-50" : "border-[#e8c9a8] bg-[#fdf6ee]")}>
            <input type="checkbox" checked={willCharge} disabled={feeCharged || !sel} onChange={(e) => setApplyFee(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span className="text-xs leading-relaxed">
              {feeCharged
                ? <b className="text-emerald-700">₱500 reschedule fee — already charged (one-time)</b>
                : <><b className="text-[#5c421f]">Apply ₱500 reschedule fee</b><span className="text-[#7a5a34]"> — added to the COD balance, charged only once per order</span></>}
            </span>
          </label>

          <button type="button" onClick={submit} disabled={!canEdit || pending || !orderId || !date}
            className="w-full rounded-lg bg-[#4a3b1a] px-4 py-3 text-sm font-bold tracking-wide text-[#f4ead8] hover:opacity-90 disabled:opacity-50">
            {pending ? "Applying…" : "Apply New Schedule"}
          </button>
          {!canEdit && <p className="text-[11px] text-[#8a8272]">View only — this account has no edit access to this tool.</p>}
          {msg && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{msg}</p>}
          {ok && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">✓ {ok}</p>}
        </div>

        {/* ── Kanan: buong detalye ng napiling order ── */}
        <div>
          {sel ? (
            <div className="overflow-hidden rounded-xl border border-[#e6dcc4]">
              <div className="border-b border-[#efe9db] bg-[#faf6ec] px-4 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a8272]">Order Details</p>
              </div>
              <div className="px-4 py-1.5">
                <DetailRow label="Order" value={
                  <span className="inline-flex items-center gap-1.5">
                    {sel.is_rush && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600 ring-1 ring-inset ring-red-600/20">Rush</span>}
                    {sel.id in reworkTags && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-200">Rework{reworkTags[sel.id] ? ` · ${reworkTags[sel.id]}` : ""}</span>}
                    <span className="font-mono font-bold">{sel.order_number ?? `#${sel.id}`}</span>
                  </span>
                } />
                <DetailRow label="Customer" value={sel.customer_name ?? "—"} />
                <DetailRow label="Address" value={sel.address ?? "—"} bold />
                <div className="border-b border-[#efe9db] py-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#8a8272]">Items ({itemInfos(sel).length})</span>
                  <div className="mt-2 space-y-1.5">
                    {itemInfos(sel).map((it, i) => (
                      <div key={i} className="flex items-start justify-end gap-2.5 rounded-lg border border-[#e6dcc4] bg-[#faf8f3] px-2.5 py-2">
                        {it.image
                          ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={it.image} alt="" className="h-10 w-10 shrink-0 rounded object-cover ring-1 ring-[#e6dcc4]" />
                          : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-stone-200 text-base text-[#8a8272]"></div>}
                        <div className="min-w-0">
                          {it.customized && <span className="mb-0.5 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Customized</span>}
                          <p className="truncate text-[13px] font-semibold text-[#2b2620]" title={it.name}>{it.name}</p>
                          {it.sku && <p className="text-[11px] text-[#8a8272]">{it.sku}</p>}
                          <p className="text-[11px] font-medium text-[#2b2620]">{it.qty > 1 ? `${it.qty} × ` : ""}{peso(it.unitPrice)}</p>
                          {it.color && <p className="text-[11px] text-[#8a8272]">Color: <span className="font-medium text-[#2b2620]">{it.color}</span></p>}
                          {it.dimension && <p className="text-[11px] text-[#8a8272]">Dimension: <span className="font-medium text-[#2b2620]">{it.dimension}</span></p>}
                          {it.specs.map((l, si) => <p key={si} className="text-[11px] text-[#8a8272]">• {l}</p>)}
                        </div>
                      </div>
                    ))}
                    {itemInfos(sel).length === 0 && <p className="text-[13px] text-[#8a8272]">—</p>}
                  </div>
                </div>
                <DetailRow label="Current schedule" value={<>{fmtLong(sel.dq_date)}{sel.dq_time_window ? <span className="text-[#8a8272]"> · {sel.dq_time_window}</span> : null}</>} bold />
                <DetailRow label="Team · Driver" value={`${sel.dq_team ?? "—"} · ${sel.dq_driver ?? "—"}`} />
                <DetailRow label="Status" value={
                  sel.dq_status === "confirmed"
                    ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Booked</span>
                    : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-inset ring-amber-600/20">Awaiting Confirm</span>
                } />
                <DetailRow label="COD balance" value={peso(balance)} bold />
                <DetailRow label="Reschedule fee" value={
                  feeCharged
                    ? <span className="font-bold text-emerald-700">Charged ✓</span>
                    : willCharge ? <span className="font-bold text-[#b3402a]">+ ₱500.00 on apply</span> : <span className="text-[#8a8272]">Waived</span>
                } />
                {date && (
                  <DetailRow label="New schedule" value={<span className="font-bold text-[#1e5c3c]">{fmtLong(date)}{win ? ` · ${win}` : ""}</span>} bold />
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[260px] items-center justify-center rounded-xl border border-dashed border-[#e6dcc4] bg-[#faf8f3] px-6 text-center">
              <p className="text-xs leading-relaxed text-[#8a8272]">
                Select an order to see its full details —<br />customer, items, current schedule, COD balance, and fee status.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
