"use client";

// REWORK TRACKER (Operations Manager) — kapareho ng Order Mapping Tracker:
// isang column bawat yugto ng REWORK pipeline, may berdeng tsek ang bawat
// yugtong naabot na. Row click → ang buong RMA review modal.

import { useMemo, useState } from "react";
import { cn } from "./ui";
import { RushBadge } from "./rush-badge";
import { ViewReturn } from "./returns-manager";
import type { ReworkRow } from "@/app/rework/data";
import type { ReturnRow } from "@/app/returns/data";

// Isang yugto ng grid — ang `ok` ay hinahango sa mga leg signal ng rework row.
function stageChecks(r: ReworkRow): boolean[] {
  const onsite = r.mode === "onsite";
  const approved = !/pending|reject/i.test(r.status);
  const pickup = (r.pickup_status ?? "").toLowerCase();
  const job = (r.job_status ?? "").toLowerCase();
  const redeliver = (r.redeliver_status ?? "").toLowerCase();
  const completed = /completed/i.test(r.status);
  // CONFIRMATION ng redelivery: gumagana lang pagkatapos ng QC (auto-redeliver
  // → Completed + reset ang dq ng order, kaya sariwa ang mga signal na ito).
  const repairDone = completed || !!r.redeliver_status;
  const redeliverMoving = /out for|arrived|installation|delivered/.test(redeliver);
  return [
    /* Declared         */ true,
    /* Awaiting Payment */ r.down_met,
    /* Approved         */ approved,
    /* Pick Up          */ onsite ? approved : r.pickup_arrived || /arrived|delivered/.test(pickup),
    /* Drop Workshop    */ onsite ? approved : r.pickup_dropped || /delivered/.test(pickup),
    // ON-SITE na may totoong rework job (bagong flow): ang Workshop columns ay
    // sumusunod sa job — In Workshop pag na-dispatch, QC Passed pag na-aprubahan
    // ang QC declaration (worker pay). Legacy on-site na walang job → approved.
    /* In Workshop      */ onsite ? (r.job_status ? true : approved) : !!r.job_status,
    /* QC Passed        */ onsite
      ? (r.job_status ? /qc passed|received|done/.test(job) : approved)
      : /qc passed|received|arrived|installation|out for|deliver/.test(job) || completed,
    /* For Scheduling   */ repairDone,
    /* Awaiting Confirm */ repairDone && (r.dq_sent || r.dq_status === "pending" || r.dq_status === "confirmed" || redeliverMoving),
    /* Booked           */ repairDone && (r.dq_confirmed || r.dq_status === "confirmed" || redeliverMoving),
    /* Packed           */ r.redeliver_packed || redeliverMoving,
    /* Out for Delivery */ redeliverMoving,
    /* Arrived          */ /arrived|installation|delivered/.test(redeliver),
    /* Installation     */ /installation|delivered/.test(redeliver),
    /* Redelivered      */ /delivered/.test(redeliver),
  ];
}

const STAGE_HEADS = ["Declared", "Awaiting Payment", "Approved", "Pick Up", "Drop Workshop", "In Workshop", "QC Passed", "For Scheduling", "Awaiting Confirm", "Booked", "Packed", "Out for Delivery", "Arrived", "Installation", "Redelivered"];
// Gintong hati sa simula ng bawat pangkat: RMA(0) / Pickup(3) / Workshop(5) / Confirmation(7) / Redelivery(10).
const GROUP_START = new Set([0, 3, 5, 7, 10]);

export function ReworkTracker({ rows, returns = [] }: { rows: ReworkRow[]; returns?: ReturnRow[] }) {
  const [q, setQ] = useState("");
  const [flt, setFlt] = useState<"all" | "active" | "completed">("all");
  const [view, setView] = useState<ReworkRow | null>(null);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const visible = useMemo(() => rows
    .filter((r) => !/reject/i.test(r.status))
    .filter((r) => flt === "all" ? true : flt === "completed" ? /completed/i.test(r.status) : !/completed/i.test(r.status))
    .filter((r) => {
      const s = q.trim().toLowerCase();
      if (!s) return true;
      return [r.order_number, r.return_no, r.customer_name, r.item, r.sku, r.workshop_name].some((x) => (x ?? "").toLowerCase().includes(s));
    }), [rows, flt, q]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const shown = visible.slice(current * pageSize, current * pageSize + pageSize);
  const from = visible.length === 0 ? 0 : current * pageSize + 1;
  const to = Math.min(current * pageSize + pageSize, visible.length);

  const viewReturn: ReturnRow | null = view
    ? (returns.find((x) => x.return_no != null && x.return_no === view.return_no)
      ?? returns.find((x) => x.order_id != null && x.order_id === view.order_id && x.resolution === "rework")
      ?? null)
    : null;
  const noop = () => {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          placeholder="Search order #, RMA, customer…"
          className="max-w-xs rounded border border-black/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black/20"
        />
        <div className="flex flex-wrap gap-2">
          {([["all", "All"], ["active", "Active"], ["completed", "Completed"]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => { setFlt(key); setPage(0); }}
              className={flt === key
                ? "rounded-full bg-[#4a3b1a] px-3.5 py-1.5 text-xs font-semibold text-[#f4ead8]"
                : "rounded-full border border-black/15 bg-white px-3.5 py-1.5 text-xs font-semibold text-black/60 hover:border-[#caa45a]"}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-black/50">{visible.length} rework{visible.length === 1 ? "" : "s"}</span>
      </div>

      {/* Kaparehong disenyo ng Order Mapping Tracker grid. */}
      <div className="max-h-[70vh] overflow-auto rounded-xl border border-[#e6dcc4] shadow-sm">
        <table className="w-full border-collapse text-[11px] xl:min-w-[1400px] xl:text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={4} className="border-b border-[#caa45a] bg-[#4a3b1a]">Order</th>
              <th colSpan={3} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a]">RMA</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a]">Pickup</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a]">Workshop</th>
              <th colSpan={3} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a]">Confirmation</th>
              <th colSpan={5} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a]">Redelivery</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&>th]:bg-[#5a4a26]">
              <th className="whitespace-nowrap">Order #</th>
              <th className="whitespace-nowrap">RMA #</th>
              <th className="whitespace-nowrap">Customer</th>
              <th className="whitespace-nowrap">Type</th>
              {STAGE_HEADS.map((h, i) => (
                <th key={h} className={cn("whitespace-nowrap", GROUP_START.has(i) && "!border-l-4 !border-l-[#caa45a]")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {shown.length === 0 ? (
              <tr><td colSpan={19} className="px-4 py-12 text-center text-muted">No reworks{q.trim() ? " match your search" : ""}.</td></tr>
            ) : shown.map((r) => {
              const checks = stageChecks(r);
              return (
                <tr key={r.id} onClick={() => setView(r)} className="cursor-pointer hover:bg-[#faf6ec]" title="Click to open the RMA review">
                  <td className="whitespace-nowrap font-mono">
                    <div className="flex flex-col items-start gap-0.5">
                      {r.is_rush && <RushBadge isRush dateOrder={r.order_date} threshold={r.rush_days ?? 14} done={/completed/i.test(r.status)} />}
                      <span>{r.order_number ?? (r.order_id ? `#${r.order_id}` : "—")}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap font-semibold text-amber-700">{r.return_no ?? `#${r.id}`}</td>
                  <td className="whitespace-nowrap font-medium text-[#5a4a26]">{r.customer_name ?? "—"}</td>
                  <td className="whitespace-nowrap">
                    {r.mode === "onsite"
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-inset ring-amber-200">On-site</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold text-sky-700 ring-1 ring-inset ring-sky-200">Pull-out</span>}
                  </td>
                  {checks.map((ok, i) => (
                    <td key={i} className={cn(GROUP_START.has(i) && "!border-l-4 !border-l-[#caa45a]")}>
                      {ok ? (
                        <span className="animate-check-pop inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-white" title={`${STAGE_HEADS[i]} (done)`}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </span>
                      ) : (
                        <span className="inline-block h-5 w-5 rounded border-2 border-black/15" />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer — rows per page + pagination (tulad ng Order Mapping Tracker). */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        <label className="flex items-center gap-2 text-muted">
          Rows per page:
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} className="rounded-md border border-border bg-surface px-2 py-1 text-foreground">
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="text-muted">{from}–{to} of {visible.length}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(current - 1)} disabled={current === 0} className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-foreground transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40">‹</button>
          <span className="text-muted">Page {current + 1} of {pageCount}</span>
          <button onClick={() => setPage(current + 1)} disabled={current >= pageCount - 1} className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-foreground transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40">›</button>
        </div>
      </div>

      {/* Row click → buong RMA review modal (read-only sa tracker). */}
      {view && viewReturn && (
        <ViewReturn
          r={viewReturn}
          canApprove={false}
          busy={false}
          readOnly
          onApprove={noop} onReject={noop} onMarkReworked={noop}
          onClose={() => setView(null)}
        />
      )}
    </div>
  );
}
