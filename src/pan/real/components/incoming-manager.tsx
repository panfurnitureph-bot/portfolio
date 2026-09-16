"use client";

import { useMemo, useState } from "react";
import { cn } from "./ui";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { sizedImg } from "./thumbnail";
import type { IncomingData, Incoming } from "@/app/incoming/data";

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const num = (n: number) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number, cur: string) => (cur === "USD" ? "$" : cur + " ") + num(n);

// Normalize any date string ("July 20th, 2026" / "2026-5-13") to yyyy-mm-dd for date inputs.
function toISODate(s: string | null): string {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s.replace(/(\d+)(st|nd|rd|th)/gi, "$1").trim());
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function statusPill(s: string) {
  const v = (s ?? "").toLowerCase();
  if (/^received/.test(v)) return "bg-green-50 text-green-700";
  if (/partial/.test(v)) return "bg-amber-50 text-amber-700";
  if (/ordered|deposit/.test(v)) return "bg-blue-50 text-blue-700";
  if (/sent/.test(v)) return "bg-violet-50 text-violet-700";
  return "bg-stone-100 text-stone-500";
}

export function IncomingManager({ data }: { data: IncomingData }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Incoming | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.rows.filter((r) => !s || [r.pi_number, r.supplier, r.status].some((x) => (x ?? "").toLowerCase().includes(s)));
  }, [data.rows, q]);

  const pg = usePagination(rows);

  return (
    <div className="space-y-5">
      <div className="apk-hide grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="In Transit" value={String(data.kpi.inTransit)} accent="bg-blue-100 text-blue-600" />
        <Kpi label="Arriving ≤ 7 days" value={String(data.kpi.arrivingSoon)} accent="bg-amber-100 text-amber-600" />
        <Kpi label="Partially Received" value={String(data.kpi.partial)} accent="bg-violet-100 text-violet-600" />
        <Kpi label="Total Value" value={`$${num(data.kpi.value)}`} accent="bg-green-100 text-green-600" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PI no / supplier…" className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
      </div>

      <div className="overflow-visible rounded-xl border border-border bg-surface shadow-sm">
        <div className="max-h-[70vh] overflow-auto rounded-t-xl">
        <table className="w-full min-w-[820px] border-collapse text-sm border-collapse [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <colgroup>
            <col span={2} />
            <col span={3} />
            <col span={2} />
          </colgroup>
          <thead>
            <tr className="sticky top-0 z-10 bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={2} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] px-5 py-2">Shipment</th>
              <th colSpan={3} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Transit</th>
              <th colSpan={2} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Value</th>
            </tr>
            <tr className="sticky top-[33px] z-10 bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">PI No.</th>
              <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Supplier</th>
              <th className="sticky top-[33px] bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3">ETA</th>
              <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Container</th>
              <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Progress</th>
              <th className="sticky top-[33px] bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3">Value</th>
              <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">No incoming shipments. POs marked <b>Ordered</b> appear here.</td></tr>
            ) : pg.slice.map((r) => {
              const ordered = r.items.reduce((s, i) => s + i.ordered_qty, 0);
              const received = r.items.reduce((s, i) => s + i.received_qty, 0);
              return (
                <tr key={r.po_id} onClick={() => setOpen(r)} className="cursor-pointer border-b border-border last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-3 font-semibold">{r.pi_number || "—"}</td>
                  <td className="px-4 py-3">{r.supplier || "—"}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center text-muted">{r.eta || "—"}</td>
                  <td className="px-4 py-3 text-center text-muted">{r.container || "—"}</td>
                  <td className="px-4 py-3 text-center tabular-nums">{received}/{ordered}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-right font-semibold tabular-nums">{money(r.total, r.currency)}</td>
                  <td className="px-4 py-3 text-center"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusPill(r.status))}>{r.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <PaginationFooter {...pg} />
      </div>

      {open && <ReceiveModal po={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// Read-only shipment tracking view. Receiving into stock is now done at Quality
// Control → Incoming (IN); this modal only DISPLAYS the live progress (received/
// remaining per line, driven by purchase_order_items.received_qty which QC bumps).
function ReceiveModal({ po, onClose }: { po: Incoming; onClose: () => void }) {
  const items = po.items;
  const totalOrdered = items.reduce((s, it) => s + it.ordered_qty, 0);
  const totalReceived = items.reduce((s, it) => s + it.received_qty, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-6xl rounded-2xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Shipment · PI {po.pi_number || ""} · {po.supplier || ""}</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
        </div>

        {/* Receiving moved to QC — this view is tracking only. */}
        <div className="mx-5 mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          
          <span>Receiving is done at <b>Quality Control → Incoming (IN)</b> — scan &amp; inspect each item, print its sticker, then it stocks in. This view shows live progress ({totalReceived}/{totalOrdered} received).</span>
        </div>

        {/* Shipment header — read-only */}
        <div className="grid grid-cols-1 gap-3 border-b border-border p-5 sm:grid-cols-3">
          <F label="Received by"><p className="px-2 py-1.5 text-sm">{po.received_by || "—"}</p></F>
          <F label="Arrived Date"><p className="px-2 py-1.5 text-sm">{toISODate(po.arrived_date) || "—"}</p></F>
          <F label="ETA"><p className="px-2 py-1.5 text-sm">{toISODate(po.eta) || "—"}</p></F>
        </div>

        {/* PI header details — read-only reference */}
        {Object.keys(po.details ?? {}).length > 0 && (
          <div className="border-b border-border p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">PI Header Details</p>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
              {Object.entries(po.details).map(([k, v]) => (
                <div key={k} className="flex gap-2"><dt className="shrink-0 font-medium text-muted">{k}:</dt><dd className="min-w-0 break-words">{v}</dd></div>
              ))}
            </dl>
          </div>
        )}

        {/* Item-by-item progress (read-only) */}
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[720px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:px-2 [&_th]:py-2 [&_th]:text-center">
            <thead>
              <tr className="bg-stone-50 text-xs uppercase text-muted">
                <th>Photo</th><th>Item No.</th><th className="text-left">Description</th>
                <th>Ordered</th><th>Received</th><th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const remaining = Math.max(it.ordered_qty - it.received_qty, 0);
                const done = remaining === 0 && it.ordered_qty > 0;
                return (
                  <tr key={i}>
                    <td>{it.image_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img loading="lazy" decoding="async" src={sizedImg(it.image_url,100)} alt="" className="mx-auto h-10 w-10 rounded object-cover" /> : "—"}</td>
                    <td className="font-medium">{it.item_no || "—"}</td>
                    <td className="max-w-[280px] whitespace-pre-line text-left text-muted">{it.description || "—"}</td>
                    <td className="tabular-nums">{it.ordered_qty}</td>
                    <td className={cn("tabular-nums font-semibold", done ? "text-green-700" : it.received_qty > 0 ? "text-amber-700" : "text-muted")}>{it.received_qty}</td>
                    <td className={cn("tabular-nums", remaining === 0 ? "text-green-700" : "text-amber-700")}>{remaining}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-stone-100">Close</button>
        </div>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="text-xs font-medium text-muted">{label}</span>{children}</label>;
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", accent)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg></span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
