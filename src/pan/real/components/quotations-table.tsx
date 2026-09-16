"use client";

import { useState } from "react";
import type { QuotationRow } from "@/app/quotations/actions";
import { Card, cn } from "./ui";

// Listahan ng mga Formal Quotation — BUOD lang ang bawat hilera. Sa pag-click,
// ipinapakita ang MISMONG dokumentong ipinadala sa customer.
//
// APPROVED LANG ANG NARIRITO (2026-08-21): ang MTO Requests ang gumagawa at
// nagbabago ng quotation, at doon ipinipili ang Approved. Walang builder button
// dito at walang aksyon sa hilera — buod at basahan ito, hindi workspace.

// EKSAKTONG hulma ng Sales Orders table (components/orders-table.tsx): espresso
// na banda #4a3b1a, header #5a4a26, gold na divider #caa45a, border-collapse na
// may hangganan sa lahat ng cell, at naka-center ang lahat.
const TH = "px-4 py-3 font-medium whitespace-nowrap text-center";
const TD = "px-4 py-3 whitespace-nowrap text-center";
const BD = "!border-l-4 !border-l-[#caa45a]";

const peso = (n: number) => Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export function QuotationsTable({ rows }: { rows: QuotationRow[] }) {
  // Ang hilerang tinitingnan — ipinapakita ang MISMONG dokumento (SVG sa
  // storage). Buod lang ang hilera, kaya ang pag-click ay pagbubukas nito.
  const [viewing, setViewing] = useState<QuotationRow | null>(null);

  return (
    <>

      <Card className="overflow-hidden">
        <div className="max-h-[60vh] overflow-auto rounded-t-xl pf-scroll">
          <table className="w-full border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
                <th colSpan={6} className="border-b border-[#caa45a] px-4 py-2">Quotation</th>
                <th colSpan={3} className={cn("border-b border-[#caa45a] px-4 py-2", BD)}>Status</th>
              </tr>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
                <th className={TH}>FQ #</th>
                <th className={TH}>Customer</th>
                <th className={TH}>Build</th>
                <th className={TH}>Address</th>
                <th className={TH}>Contact Number</th>
                <th className={TH}>Total</th>
                <th className={cn(TH, BD)}>Status</th>
                <th className={TH}>Created By</th>
                <th className={TH}>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted">
                    No approved quotations yet. Mark a request Approved in MTO Requests and it appears here.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setViewing(r)}
                  title="Open the quotation document"
                  className="cursor-pointer hover:bg-stone-50"
                >
                  <td className={cn(TD, "font-mono text-xs font-semibold")}>
                    {r.fqNumber ?? `#${r.id}`}
                    {/* Galing sa website na quote request — ipinapakita kung
                        aling MTO request ang pinagmulan nito. */}
                    {r.mtoNumber && <span className="block text-[9.5px] font-normal text-muted">{r.mtoNumber}</span>}
                  </td>
                  <td className={cn(TD, "font-medium")}>{r.customer || "—"}</td>
                  {/* Ang piniling build — naka-clamp sa dalawang linya, buo sa
                      tooltip at nasa dokumento. */}
                  <td className="max-w-[16rem] border-b border-r border-border px-4 py-3 !text-left text-[11px] leading-snug text-muted" title={r.build ?? undefined}>
                    <span className="line-clamp-2 block">{r.build || "—"}</span>
                  </td>
                  <td className="max-w-[12rem] border-b border-r border-border px-4 py-3 text-[11.5px] leading-snug">{r.address || "—"}</td>
                  <td className={cn(TD, "text-[12px]")}>{r.contact || "—"}</td>
                  <td className={cn(TD, "font-medium")}>{peso(r.total)}</td>
                  {/* Approved lang ang nakakarating dito, kaya iyon ang laman.
                      Ang Ordered ang susunod na hakbang — ipinapakita ang order
                      number kapag naigawa na. */}
                  <td className={cn(TD, BD)}>
                    {r.orderNumber ? (
                      <span title={`Order ${r.orderNumber}`} className="font-mono text-xs font-semibold text-success">{r.orderNumber}</span>
                    ) : (
                      <span title={r.mtoNumber ? `Approved on ${r.mtoNumber}` : "Approved in MTO Requests"} className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        Approved
                      </span>
                    )}
                  </td>
                  <td className={cn(TD, "text-muted")}>{r.createdBy ?? "—"}</td>
                  <td className={cn(TD, "text-muted")}>{fmt(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── DOKUMENTO ─────────────────────────────────────────────────────────
          Buod lang ang hilera; ang aktuwal na quotation na ipinadala sa customer
          ang nasa storage bilang SVG. TINGIN LAMANG ito — ang mga aksyon ay nasa
          MTO Requests, kasunod ng daanang MTO # → FQ # → Order #. */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 sm:p-8"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setViewing(null); }}
        >
          <div className="mx-auto w-[min(52rem,100%)] overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center gap-3 border-b border-border bg-[#4a3b1a] px-4 py-2.5">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#f4ead8]">
                {viewing.fqNumber ?? `#${viewing.id}`}
                {viewing.mtoNumber ? ` — from ${viewing.mtoNumber}` : ""}
              </span>
              <span className="ml-auto text-[10px] text-[#cbb98a]">{viewing.orderNumber ? `Order ${viewing.orderNumber}` : "Approved"}</span>
              <button type="button" onClick={() => setViewing(null)} className="text-[#e7dcc4] hover:text-white">✕</button>
            </div>

            <div className="max-h-[calc(100vh-13rem)] overflow-y-auto bg-stone-100 p-4">
              {viewing.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={viewing.imageUrl} alt={`Quotation ${viewing.fqNumber ?? viewing.id}`} className="mx-auto w-full max-w-[46rem] rounded-lg bg-white shadow" />
              ) : (
                <p className="py-12 text-center text-sm text-muted">No rendered document for this quotation.</p>
              )}
            </div>

          </div>
        </div>
      )}
    </>
  );
}
