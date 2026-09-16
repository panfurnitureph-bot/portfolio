"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, Card, StatCard, StockTag } from "./ui";
import { SpecFieldsView } from "./spec-fields-input";
import { specCategoryOf } from "./line-items-editor";
import { Modal } from "./modal";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { peso } from "@/lib/format";
import { createProjectWork, updateProjectWork, deleteProjectWork, type ProjectWorkInput } from "@/app/hr/projects/actions";
import { approveQc, rejectQc, type QcDeclaration } from "@/app/workshop/qc-actions";
import type { ProjectWorkRow, EmployeeLite, OrderLite, PendingItem, ReworkMeta, OrderItemLite } from "@/app/hr/projects/data";

type Status = "Unpaid" | "Paid";
const STATUSES: Status[] = ["Unpaid", "Paid"];
const inp = "w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface";

function StatusBadge({ status }: { status: Status }) {
  const tone = status === "Paid" ? "bg-green-50 text-green-700 ring-green-600/20" : "bg-amber-50 text-amber-700 ring-amber-600/20";
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tone)}>{status}</span>;
}

// QC declarations from the workshop awaiting HR approval → on approve, a project-work entry
// is created for the worker (Made By) and flows into weekly payroll (Saturday cut).
function QcApprovalPanel({ declarations, approver }: { declarations: QcDeclaration[]; approver: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [review, setReview] = useState<QcDeclaration | null>(null);
  const forApproval = declarations.filter((d) => /for approval/i.test(d.status));
  if (!declarations.length) return null;
  function act(id: number, kind: "approve" | "reject", after?: () => void, amounts?: Record<number, number>) {
    start(async () => {
      const r = kind === "approve" ? await approveQc(id, approver, amounts) : await rejectQc(id, approver);
      if ("error" in r) { alert(r.error); return; }
      after?.(); router.refresh();
    });
  }
  // REWORK declaration na may workers: si HR ang maglalagay ng sahod bawat worker —
  // ang mabilisang Approve sa row ay binubuksan ang Review modal (doon ang inputs).
  const needsPricing = (d: QcDeclaration) => /^rework$/i.test(d.category ?? "") && (d.workers?.length ?? 0) > 0;
  return (
    <Card className="rounded-2xl border-emerald-300/60 bg-emerald-50/40 p-4">
      <p className="mb-2 text-sm font-semibold text-emerald-800">Quality Control — for approval ({forApproval.length})</p>
      {forApproval.length === 0 ? (
        <p className="text-xs text-muted">No declarations awaiting approval.</p>
      ) : (
        <div className="space-y-1.5">
          {forApproval.map((d) => (
            <div key={d.id} onClick={() => setReview(d)} className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-surface px-3 py-2 text-sm hover:bg-emerald-50/50">
              {d.stock_request ? <StockTag sku={d.stock_sku} /> : <span className="font-mono text-xs font-medium">{d.order_number}</span>}
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium">GMA Workshop</span>
              <span className="font-semibold text-[#4a3b1a]">{d.worker_name ?? "—"}</span>
              {(() => {
                const m = ((d.item ?? "").split("\n")[0]).match(/^rework\s*·\s*(rma-\d+)\s*·\s*(.*)$/i);
                return (
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-muted">
                    {m && <span className="shrink-0 text-[10px] font-bold text-amber-700">{m[1].toUpperCase()}</span>}
                    <span className="truncate">{m ? m[2] || "—" : (d.item ?? "").split("\n")[0]}{d.add_ons?.length ? ` · ${d.add_ons.map((a) => a.name).join(", ")}` : ""}</span>
                  </span>
                );
              })()}
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Review</span>
              <span className="font-bold text-[#4a3b1a]">{peso(d.total_amount)}</span>
              <button onClick={(e) => { e.stopPropagation(); if (needsPricing(d)) { setReview(d); return; } act(d.id, "approve"); }} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">Approve</button>
              <button onClick={(e) => { e.stopPropagation(); act(d.id, "reject"); }} disabled={busy} className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">Reject</button>
            </div>
          ))}
        </div>
      )}
      {review && <QcReviewModal d={review} busy={busy} onApprove={(amounts) => act(review.id, "approve", () => setReview(null), amounts)} onReject={() => act(review.id, "reject", () => setReview(null))} onClose={() => setReview(null)} />}
    </Card>
  );
}

// HR reviews the full declaration — main order + checklist photos — before approving.
// REWORK: dito rin naglalagay si HR ng sahod bawat worker (open price) bago i-approve.
function QcReviewModal({ d, busy = false, onApprove, onReject, onClose, onEdit, rmaNo }: { d: QcDeclaration; busy?: boolean; onApprove?: (amounts?: Record<number, number>) => void; onReject?: () => void; onClose: () => void; onEdit?: () => void; rmaNo?: string | null }) {
  const [hoverImg, setHoverImg] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  // Ang REWORK declaration ng workshop ay may `category` na "rework"; ang bayad
  // ng ON-SITE CREW (galing sa RMA approval) ay "On-site repair" / "Pull-out
  // repair" — pareho ring listahan ng tao at halaga ang dapat ipakita.
  const reworkWorkers = /rework|repair/i.test(d.category ?? "")
    ? ((d.workers ?? []) as { id: number; name: string; amount?: number; section?: string }[])
    : [];
  const [pay, setPay] = useState<Record<number, string>>(() =>
    Object.fromEntries(reworkWorkers.map((w) => [w.id, w.amount ? String(w.amount) : ""])));
  const payTotal = reworkWorkers.reduce((s, w) => s + (Number(pay[w.id]) || 0), 0);
  const payAmounts = (): Record<number, number> | undefined =>
    reworkWorkers.length ? Object.fromEntries(reworkWorkers.map((w) => [w.id, Number(pay[w.id]) || 0])) : undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center gap-4 overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      {/* DALAWANG HANAY (hiling 2026-08-28). Ang rework ay may hilera kada
          piyesa ngayon — tig-limang litrato — kaya ang isang haligi ay umaabot
          nang ilang screen bago pa marating ang Approve. Detalye sa kaliwa,
          katibayan sa kanan, at ang mga pindutan ay naka-pin sa ilalim kaya
          hindi na kailangang mag-scroll pabalik para umaksyon. */}
      <div className="my-6 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl lg:max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-[#4a3b1a] px-4 py-3 text-[#f4ead8]">

          {/* Ang RMA ang pinakapangalan ng pagkumpuni; ang order ay pangalawa.
              Ang lugar ay hindi laging GMA Workshop — ang on-site ay sa bahay ng
              customer nangyayari, kaya ang `workshop` ng declaration ang sinasabi. */}
          <div><div className="text-sm font-bold">Review · {rmaNo ?? (d.stock_request ? (d.stock_sku ?? "STOCK") : d.order_number)}{rmaNo && d.order_number ? <span className="ml-1.5 font-normal opacity-70">· {d.order_number}</span> : null}</div><div className="text-[11px] opacity-80">{d.workshop || "GMA Workshop"}{d.qc_name ? ` · ${rmaNo ? "Declared by" : "QC"}: ${d.qc_name}` : ""}</div></div>
          <button onClick={onClose} className="ml-auto text-[#e7dcc4] hover:text-white">✕</button>
        </div>
        {/* SA MOBILE, ANG LOOB NG CARD ANG NAG-I-SCROLL (2026-08-31, "sa apk
            di ko ma-scroll ung mahahabang pop up"): ang lumang Android WebView
            ay hindi maaasahang nag-i-scroll ng fixed overlay — ang touch ay
            napupunta sa body. Ang sariling overflow-y-auto na div ay tiyak na
            gumagana; sa lg pababa ang buong grid ang scroller, sa lg pataas
            ang tig-kanyang kolum gaya ng dati. */}
        <div className="grid max-h-[78vh] gap-4 overflow-y-auto p-4 lg:max-h-[74vh] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:overflow-hidden">
        <div className="space-y-4 lg:overflow-y-auto lg:pr-1">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-stone-50 p-3 text-sm">
            {d.item_image
              ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={d.item_image} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover ring-1 ring-border" />
              : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-stone-200 text-xs text-muted"></div>}
            <div className="min-w-0"><div className="text-[11px] uppercase tracking-wide text-muted">{d.stock_request ? "Stock build" : `Main order · ${d.order_number}`}</div>
              {(() => {
                const m = ((d.item ?? "—").split("\n")[0]).match(/^rework\s*·\s*(rma-\d+)\s*·\s*(.*)$/i);
                return m
                  ? <><div className="text-[11px] font-bold text-amber-700">{m[1].toUpperCase()}</div><div className="font-semibold">{m[2] || "—"}</div></>
                  : <div className="font-semibold">{(d.item ?? "—").split("\n")[0]}</div>;
              })()}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-[11px] uppercase tracking-wide text-muted">Made By (gets paid)</div>
              {(d.workers?.length ?? 0) > 1
                ? <ul className="font-semibold text-[#4a3b1a]">{(d.workers ?? []).map((w, i) => <li key={i}>{w.name}</li>)}</ul>
                : <div className="font-semibold text-[#4a3b1a]">{d.worker_name ?? "—"}</div>}
            </div>
            <div><div className="text-[11px] uppercase tracking-wide text-muted">Section</div><div className="font-medium">{d.category ?? "—"}</div></div>
            {/* QC AT ITEM (hiling 2026-08-28) — nasa Declaration modal ng Workshop
                QC na ito, hindi dito, kaya hindi nakikita ng aprubador kung sino
                ang nagdeklara at ano ang item nang hindi bumabalik sa larawan. */}
            {d.qc_name && (
              <div><div className="text-[11px] uppercase tracking-wide text-muted">QC</div><div className="font-medium">{d.qc_name}</div></div>
            )}
            <div className={d.qc_name ? "" : "col-span-2"}>
              <div className="text-[11px] uppercase tracking-wide text-muted">Item</div>
              <div className="font-medium">{(d.item ?? "—").split("\n")[0].replace(/^\s*rework\s*·\s*rma-\d+\s*·\s*/i, "").trim() || "—"}</div>
            </div>
            <div className="col-span-2"><div className="text-[11px] uppercase tracking-wide text-muted">Add-ons</div>{d.add_ons?.length ? <ul className="mt-0.5 space-y-0.5 font-medium">{d.add_ons.map((a, i) => <li key={i}>• {a.name} <span className="text-[#caa45a]">(+{a.amount})</span></li>)}</ul> : <div className="font-medium">—</div>}</div>
            <div className="col-span-2"><div className="text-[11px] uppercase tracking-wide text-muted">Project-base amount</div><div className="text-xl font-extrabold text-[#4a3b1a]">{peso(reworkWorkers.length ? payTotal : d.total_amount)}</div></div>
          </div>
          {/* Ang buong build ng produkto — parehong SPECIFICATIONS card ng
              Workshop QC at Product Details, para makita ng aprubador kung ano
              talaga ang ginawa bago aprubahan ang bayad. */}
          {(() => {
            const declName = (d.item ?? "").split("\n")[0];
            const declSpecs = (d.item ?? "").split("\n").slice(1).join("\n").trim();
            const specsText = declSpecs || (d.job_specs ?? "");
            if (!specsText) return null;
            const specsCat = d.job_category || (d.category && !/^(carpentry|upholstery|rework)/i.test(d.category) ? d.category : "");
            return (
              <div className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Specifications / Design details</span>
                <div className="rounded-lg border border-border bg-stone-50/60 p-3">
                  <SpecFieldsView category={specCategoryOf(specsCat, declName)} specs={specsText} />
                </div>
              </div>
            );
          })()}
          </div>
          <div className="lg:overflow-y-auto lg:pl-1">
            {/* ANG SAHOD, SA TABI NG KATIBAYAN (hiling 2026-08-28). Dito
                nagpapasya si HR ng ibabayad kada tao — at ang batayan niyan ay
                ang nakita niyang nagawa. Nasa kabilang hanay ito noon, kaya
                kailangang tumingin pabalik-balik para itapat ang halaga sa
                litrato. Ang mga pindutan ay nasa ilalim ng parehong hanay. */}
            {reworkWorkers.length > 0 && (
              <div className="mb-2 rounded-xl border border-[#caa45a] bg-[#faf6ec]/60 p-2.5">
                <p className="mb-1.5 text-xs font-semibold text-[#4a3b1a]">{onApprove ? "Set each worker’s pay (rework — open price)" : "Crew pay — recorded"}</p>
                <div className="space-y-1.5">
                  {reworkWorkers.map((w) => (
                    <div key={w.id} className="flex items-center gap-2">
                      <span className="w-40 shrink-0 truncate text-[12.5px]" title={w.name}>{w.name}{w.section && <span className="ml-1 text-[10px] text-muted">({w.section})</span>}</span>
                      <input type="number" min={0} value={pay[w.id] ?? ""} onChange={(e) => setPay((p) => ({ ...p, [w.id]: e.target.value }))} placeholder="0" disabled={!onApprove}
                        className="w-full flex-1 rounded-lg border border-border bg-white px-3 py-1.5 text-sm disabled:bg-stone-50" />
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-[#e6dcc4] pt-1.5 text-sm font-bold text-[#4a3b1a]"><span>Total</span><span>{peso(payTotal)}</span></div>
                </div>
              </div>
            )}
            <p className="mb-2 text-xs font-semibold text-[#4a3b1a]">QC Checklist — photo proof</p>
            {/* ANG PIYESANG INAPRUBAHAN, SA TAAS NG KATIBAYAN (hiling 2026-08-28).
                Hiwalay sa Add-ons: hindi bayad sa manggagawa kundi materyal na
                binayaran ng customer — at ang rework ay walang add-on rate, kaya
                blangko iyon. Dito ito nakalagay dahil may hilera ng litrato ang
                bawat piyesa sa ibaba: magkatabi ang hinihingi at ang
                pinatutunayan, kaya kitang-kita kung may kulang. */}
            {d.rework_parts?.length > 0 && (
              <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Approved replacement parts</div>
                <ul className="mt-1 space-y-0.5 text-[12.5px] text-amber-900">
                  {d.rework_parts.map((pt, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2">
                      <span><span className="text-amber-500">•</span> <span className="font-semibold">{pt.qty > 1 ? `${pt.qty}× ` : ""}{pt.part}</span></span>
                      {pt.amount > 0 && <span className="shrink-0 tabular-nums text-amber-700">{peso(pt.amount)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* MAIN ITEM AT ADD-ONS LANG (hiling 2026-08-25). Ang `base` na
                hilera ay ang piniling base rate kada seksyon — kinukunan pa rin
                ito ng litrato sa Declare, at bahagi pa rin ito ng bayad, pero
                ang mga litrato nito ay pareho ng main item: iisang bagay ang
                nakikita, limang beses. Ang pinag-iiba lang ay ang add-on. */}
            {d.checklist?.filter((c) => c.type !== "base").length ? (
              <div className="space-y-1.5">
                {d.checklist.filter((c) => c.type !== "base").map((it, i) => (
                  <div key={i} className="rounded-lg border border-border p-1.5">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">{it.name}{it.type === "main" && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700">main item</span>}{it.type === "part" && <span className="rounded bg-amber-200 px-1.5 text-[10px] font-bold text-amber-800">replacement part</span>}{it.type === "base" && <span className="rounded bg-stone-100 px-1.5 text-[10px] font-medium text-muted">base</span>}<span className="ml-auto text-[10px] text-muted">{it.photos?.length ?? 0} photo(s)</span></div>
                    <div className="flex flex-wrap gap-1">
                      {it.photos?.length ? it.photos.map((u, j) => (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img key={j} src={u} onMouseEnter={() => setHoverImg(u)} onMouseLeave={() => setHoverImg(null)} className="h-14 w-14 cursor-zoom-in rounded object-cover ring-1 ring-border hover:ring-2 hover:ring-[#caa45a]" alt="" />
                      )) : <span className="text-xs text-rose-600">No photo</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : d.item_image ? (
              /* ANG LITRATO NG PRODUKTO KAPAG WALA NANG SA SIRA (hiling
                 2026-08-28). Ang katibayan ng sira ay nabura kasama ng RMA row —
                 wala na talaga ito sa database, hindi ko ito mapapalitan. Ang
                 nasa order ay ang PRODUKTO, at iyon ang ipinapakita: kita kung
                 ano ang kinumpuni, at sinasabi ng label na hindi ito ang
                 katibayan ng depekto — hindi ipinapasa ang isa bilang isa. */
              <div className="rounded-lg border border-border p-2">
                <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold">
                  {itemName(d.item).replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "").trim() || "Item"}
                  <span className="rounded bg-stone-100 px-1.5 text-[10px] font-medium text-muted">product photo</span>
                  <span className="ml-auto text-[10px] text-amber-700">fault photos no longer on file</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.item_image} onMouseEnter={() => setHoverImg(d.item_image)} onMouseLeave={() => setHoverImg(null)} className="h-24 w-24 cursor-zoom-in rounded object-cover ring-1 ring-border hover:ring-2 hover:ring-[#caa45a]" alt="" />
                </div>
              </div>
            ) : <p className="text-xs text-muted">No checklist recorded.</p>}
          </div>
        </div>
        <div className="border-t border-border px-4 py-3">
          {payError && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{payError}</p>}
          <div className="flex gap-2">
            {onApprove ? (
              <>
                <button onClick={onReject} disabled={busy} className="flex-1 rounded-lg border border-rose-300 px-4 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-60">Reject</button>
                <button onClick={() => {
                  // Rework: pwedeng ₱0 ang worker (desisyon ni HR) — ₱0 ay hindi
                  // gagawan ng payroll row sa server; blangko = ₱0.
                  setPayError(null); onApprove?.(payAmounts());
                }} disabled={busy} className="flex-[2] rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">{busy ? "Processing…" : "✓ Approve → Project-Base Salary"}</button>
              </>
            ) : (
              <>
                {onEdit && <button onClick={onEdit} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-bold text-[#4a3b1a] hover:bg-stone-100">Edit entry</button>}
                <button onClick={onClose} className="flex-[2] rounded-lg bg-[#4a3b1a] px-4 py-2.5 text-sm font-bold text-[#f4ead8] hover:opacity-90">Close</button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="pointer-events-none fixed right-4 top-1/2 z-[70] hidden w-[min(46vw,900px)] -translate-y-1/2 xl:block">
        {hoverImg && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={hoverImg} alt="" className="max-h-[85vh] w-full rounded-xl border-4 border-white bg-white object-contain shadow-2xl" />
        )}
      </div>
    </div>
  );
}

// Ang `project_name` ay ang buong `item` ng declaration: pangalan sa unang
// linya, ang build sa mga sumunod bilang bullets. Hinihiwa rito para may
// sariling hanay ang bawat isa.
// Hinuhubad ang "Rework · RMA-000025 ·" na prefix — ang pangalan lang ang
// pangalan; ang RMA ay may sariling hanay (2026-08-31). Ang prefix dito noon
// ang dahilan kaya anim-na-linyang patayo ang Product Name at hindi tumutugma
// ang catalog lookup (blangkong SKU/kategorya/litrato).
const itemName = (v: string | null | undefined) =>
  String(v ?? "").split("\n")[0].replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "").trim();
const itemSpecs = (v: string | null | undefined) =>
  String(v ?? "").split("\n").slice(1).map((x) => x.replace(/^[\u2022\u00b7-]\s*/, "").trim()).filter(Boolean);

// "Sofa 1 (+ …) — Upholstery" → "Upholstery"; "QC inspection — Sofa 1" →
// "QC inspection". Ang huling em-dash ang naghahati; kapag wala, ang buong
// teksto ang sagot (walang seksyon ang manu-manong entry).
const workOf = (v: string | null | undefined) => {
  const t = String(v ?? "").trim();
  if (/^QC inspection/i.test(t)) return "QC inspection";
  const i = t.lastIndexOf(" \u2014 ");
  return i > 0 ? t.slice(i + 3).trim() : t;
};

// Buong petsa. Ang pinaikli ("Aug 24") ay pumuputol sa dalawang linya sa
// makipot na hanay, at ang payroll ay binabasa makalipas ang mga buwan.
const longDate = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric" }).format(new Date(iso));

export function HrProjectsManager({ rows, employees, orders, pending = [], qcDeclarations = [], reworkMeta = {}, orderItems = {}, approver = "" }: { rows: ProjectWorkRow[]; employees: EmployeeLite[]; orders: OrderLite[]; pending?: PendingItem[]; qcDeclarations?: QcDeclaration[]; reworkMeta?: Record<string, ReworkMeta>; orderItems?: Record<string, OrderItemLite>; approver?: string }) {
  const [empFilter, setEmpFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [form, setForm] = useState<ProjectWorkRow | "new" | null>(null);
  const [assign, setAssign] = useState<PendingItem | null>(null);
  const [reviewRow, setReviewRow] = useState<{ d: QcDeclaration; row: ProjectWorkRow } | null>(null);

  // ANG BAYAD NG ON-SITE REPAIR CREW ay walang QC declaration — itinatakda ito sa
  // pag-apruba ng RMA — kaya blangko ang SKU, litrato at kategorya na hinahango
  // ng listahan sa declaration. Ang RMA ang pinagmumulan; ito ang naghahanap:
  // ang description ay "RMA-000002 — On-site repair".
  const rwOf = (r: ProjectWorkRow) => {
    // Ang RMA ay nasa description ("RMA-000002 — On-site repair") O sa unahan
    // ng project_name ("Rework · RMA-000025 · …") — ang bagong on-site
    // declare pipeline ay sa pangalawa nagtatala (2026-08-31).
    const m = /\b(RMA-\d+)\b/i.exec(r.description ?? "") ?? /\b(RMA-\d+)\b/i.exec((r.project_name ?? "").split("\n")[0]);
    return m ? reworkMeta[m[1].toUpperCase()] ?? null : null;
  };
  const rmaNoOf = (r: ProjectWorkRow): string | null => {
    const m = /\b(RMA-\d+)\b/i.exec(r.description ?? "") ?? /\b(RMA-\d+)\b/i.exec((r.project_name ?? "").split("\n")[0]);
    return m ? m[1].toUpperCase() : null;
  };

  // KAPAG NABURA NA ANG RMA (2026-08-28): nananatili ang bayad sa payroll,
  // nawawala ang pinagmumulan — blangko ang SKU, litrato at kategorya, at
  // walang laman ang preview sa modal kahit buo pa ang pangalan at spec sa
  // `project_name`. Ang order ang natitirang pinagmumulan: itinutugma ang
  // pangalan ng produkto sa `receipt_items` nito.
  const itemOf = (r: ProjectWorkRow): OrderItemLite | null => {
    const on = (r.order_number ?? "").trim();
    if (!on) return null;
    const name = (r.project_name ?? "").split("\n")[0]
      .replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "").trim().toLowerCase();
    return name ? orderItems[`${on}|${name}`] ?? null : null;
  };

  // link each project-work entry back to its QC declaration (for the photo review)
  const declByPw = useMemo(() => {
    const m = new Map<number, QcDeclaration>();
    for (const d of qcDeclarations) {
      const ids = d.project_work_ids?.length ? d.project_work_ids : (d.project_work_id != null ? [d.project_work_id] : []);
      for (const id of ids) m.set(id, d);
    }
    return m;
  }, [qcDeclarations]);

  // ANG PAREHONG PREVIEW PARA SA REWORK (2026-08-25). Ang hilera ng QC ay may
  // declaration, kaya bumubukas ang Review modal: litrato, spec, add-ons,
  // checklist. Ang bayad ng crew ay walang declaration — itinatakda sa RMA
  // approval — kaya Edit form ang bumubukas at magkaibang mukha ang dalawang
  // klase ng hilera sa isang tabla. Ang RMA ay may lahat ng kailangan; ito ang
  // nagsasalin nito sa hugis na hinihingi ng modal.
  const declFromRework = (r: ProjectWorkRow, m: ReworkMeta): QcDeclaration => ({
    id: -r.id,                       // negatibo: hindi tunay na declaration id
    order_id: null,
    job_id: null,
    order_number: r.order_number,
    workshop: m.workshop ?? (m.mode === "onsite" ? "On-site · at the customer" : null),
    qc_name: m.declaredBy,
    worker_id: r.employee_id,
    worker_name: r.employee_name,
    // Ang buong crew ay nakalista, at ang halaga kada tao ay ipinapakita.
    // Ang `amount` ang nagpapapuno sa mga field ng bayad; naka-disable ito dito
    // (walang onApprove) kaya kita pero hindi mababago — nasa payroll na ang pera.
    workers: m.crew.map((c) => ({ id: c.id, name: c.name, amount: c.pay ?? 0 })),
    item: m.item,
    item_image: m.image,
    // `category` = ang SEKSYON (uri ng trabaho); ang uri ng PRODUKTO ay
    // product_category. Ganoon ang hulma ng declareQc.
    category: m.mode === "pullout" ? "Pull-out repair" : "On-site repair",
    add_ons: [],
    base_amount: r.amount,
    addon_amount: 0,
    total_amount: r.amount,
    week_ending: null,
    status: r.status === "Paid" ? "Paid" : "Approved",
    // Ang litrato ng SIRA ang katibayan dito, hindi QC checklist — ang
    // pagkumpuni ay ipinasimula ng mga larawang ito.
    checklist: m.photos.length ? [{ name: `${m.rmaNo} · photos of the fault`, type: "main", photos: m.photos }] : [],
    project_work_id: r.id,
    project_work_ids: [r.id],
    declared_at: m.declaredAt,
    approved_at: null,
    approved_by: null,
    fulfillment: "warehouse",
    job_specs: null,
    stock_request: false,
    stock_sku: null,
    sku: m.sku,
    product_category: m.category,
    job_category: m.category,
    rework_parts: m.parts,
  });

  // ── KAPAG NABURA NA ANG RMA (hiling 2026-08-28) ──────────────────────────
  // Walang `ReworkMeta`, kaya Edit form ang bumubukas at hindi ang Review —
  // magkaibang mukha ang dalawang hilera ng parehong RMA sa iisang tabla. Ang
  // natitira ay sapat naman: nasa `project_name` ang pangalan at spec, nasa
  // order ang litrato at sku, at ang KAPWA HILERA ng parehong RMA ang buong
  // crew at ang kabuuang bayad. Ito ang nagtitipon ng mga iyon sa hugis na
  // hinihingi ng modal — iisa ang mukha, may RMA row man o wala.
  const orphanDecl = (r: ProjectWorkRow): QcDeclaration | null => {
    const rma = /\b(RMA-\d+)\b/i.exec(r.description ?? "")?.[1]?.toUpperCase();
    if (!rma) return null;
    const it = itemOf(r);
    // Bawat taong binayaran sa parehong RMA — isa ang hilera kada seksyon, kaya
    // ang taong may dalawang seksyon ay isang beses lang nakalista, ang bayad
    // ay pinagsasama.
    // Ang numero mismo ang ihahambing, hindi RegExp na binuo sa template
    // literal: doon ang `\b` ay literal backspace, hindi word boundary —
    // kaya walang tumatama, nag-iisa ang tao sa MADE BY at zero ang kabuuan.
    const kin = rows.filter((x) => /\b(RMA-\d+)\b/i.exec(x.description ?? "")?.[1]?.toUpperCase() === rma);
    const byWorker = new Map<number, { id: number; name: string; amount: number; section?: string }>();
    for (const k of kin) {
      // ANG SEKSYON, HINDI ANG PANGALAN. Dalawang hugis ang description:
      //   "Rework · RMA-000002 · PAN Sofa V.03 — Carpentry"   (crew)
      //   "QC inspection — Rework · RMA-000002 · PAN Sofa V.03" (QC)
      // Ang basta pagkuha ng kasunod ng em-dash ay nagbibigay ng buong pangalan
      // ng item sa pangalawa. Ang bahaging WALANG RMA ang seksyon.
      const parts = (k.description ?? "").split("—").map((x) => x.trim()).filter(Boolean);
      const sect = parts.find((x) => !/\bRMA-\d+\b/i.test(x)) || undefined;
      const prev = byWorker.get(k.employee_id);
      if (prev) { prev.amount += k.amount; continue; }
      byWorker.set(k.employee_id, { id: k.employee_id, name: k.employee_name, amount: k.amount, section: sect });
    }
    const workers = [...byWorker.values()];
    const total = kin.reduce((sum, k) => sum + k.amount, 0);
    return {
      id: -r.id,
      order_id: null, job_id: null,
      order_number: r.order_number,
      // Wala nang RMA row, kaya hindi na malalaman kung saan kinumpuni.
      workshop: null,
      qc_name: null,
      worker_id: r.employee_id,
      worker_name: r.employee_name,
      workers,
      item: r.project_name,
      item_image: it?.image ?? null,
      category: "Rework",
      add_ons: [],
      base_amount: total, addon_amount: 0, total_amount: total,
      week_ending: null,
      status: r.status === "Paid" ? "Paid" : "Approved",
      // Nabura kasama ng RMA ang litrato ng sira — walang katibayang maipapakita.
      checklist: [],
      project_work_id: r.id,
      project_work_ids: kin.map((k) => k.id),
      declared_at: r.work_date, approved_at: null, approved_by: null,
      fulfillment: "warehouse",
      job_specs: null,
      stock_request: false, stock_sku: null,
      sku: it?.sku ?? null,
      product_category: it?.category ?? null,
      job_category: it?.category ?? null,
      // Nabura kasama ng RMA ang listahan ng piyesa — wala nang mapagkukunan.
      rework_parts: [],
    };
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (empFilter !== "all" && String(r.employee_id) !== empFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      return true;
    });
  }, [rows, empFilter, statusFilter]);
  const pg = usePagination(filtered);

  const totalUnpaid = useMemo(
    () => rows.filter((r) => r.status === "Unpaid").reduce((s, r) => s + (r.amount || 0), 0),
    [rows],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
        </div>
        <button onClick={() => setForm("new")} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90">+ Add constructor work</button>
      </div>

      <div className="apk-hide grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total unpaid" value={peso(totalUnpaid)} tone="warning" />
        <StatCard label="Entries" value={String(rows.length)} />
        <StatCard label="Pending from orders" value={String(pending.length)} tone={pending.length ? "warning" : "default"} />
      </div>

      <QcApprovalPanel declarations={qcDeclarations} approver={approver} />

      {/* Pending — order line items tagged with a constructor, not yet recorded */}
      {pending.length > 0 && (
        <Card className="rounded-2xl border-amber-300/60 bg-amber-50/40 p-4">
          <p className="mb-2 text-sm font-semibold text-amber-800">Pending constructor work from Orders ({pending.length})</p>
          <div className="space-y-1.5">
            {pending.map((p, i) => (
              <div key={`${p.order_number}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-surface px-3 py-2 text-sm">
                <span className="font-mono text-xs font-medium">{p.order_number}</span>
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">{(p.workshop ?? "").replace(/\s*-\s*constructor$/i, "") || "—"}</span>
                <span className="font-medium">{p.constructor_name}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{p.description || "—"}</span>
                <button onClick={() => setAssign(p)} className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-accent hover:bg-primary/90">Record →</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <select value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} className={cn(inp, "max-w-xs")}>
          <option value="all">All employees</option>
          {employees.map((e) => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={cn(inp, "max-w-[12rem]")}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card className="p-0">
        <div className="max-h-[70vh] overflow-auto pf-scroll">
        <table className="w-full min-w-[760px] text-sm border-collapse [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <colgroup>
            <col span={3} />
            <col span={4} />
            <col span={1} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="sticky top-0 z-10 bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&_th]:bg-[#4a3b1a]">
              <th colSpan={9} className="border-b border-[#caa45a] px-5 py-2">Project</th>
              <th colSpan={4} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Earnings</th>
              <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2"></th>
            </tr>
            <tr className="sticky top-[33px] z-10 bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&_th]:bg-[#5a4a26]">
              <th className="px-5 py-3">Employee</th>
              <th className="px-5 py-3">Order #</th>
              <th className="px-5 py-3">RMA #</th>
              <th className="px-5 py-3">SKU</th>
              <th className="px-5 py-3">Photo</th>
              <th className="px-5 py-3">Product Name</th>
              <th className="px-5 py-3">Specification / Design Details</th>
              <th className="px-5 py-3">Category</th>
              <th className="px-5 py-3">Work</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-5 py-3">Date</th>
              <th className="px-5 py-3">Rate</th>
              <th className="px-5 py-3">OT</th>
              <th className="px-5 py-3">Amount</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {pg.slice.map((r) => (
              <tr key={r.id} onClick={() => {
                  const decl = declByPw.get(r.id);
                  if (decl) { setReviewRow({ d: decl, row: r }); return; }
                  const m = rwOf(r);
                  if (m) { setReviewRow({ d: declFromRework(r, m), row: r }); return; }
                  const orphan = orphanDecl(r);
                  if (orphan) { setReviewRow({ d: orphan, row: r }); return; }
                  setForm(r);
                }} className="cursor-pointer border-b border-border last:border-0 hover:bg-stone-50">
                <td className="px-5 py-3 font-medium">{r.employee_name}</td>
                {/* ANG BUONG SPEC AY NASA project_name (tingnan ang declareQc:
                    `project_name: d.item`, at ang `item` ay pangalan + bullets).
                    Dating ito ang pumapalit sa Order # kapag walang order —
                    kaya labing-isang linya ng build ang naiipit sa hanay ng
                    numero. Hinati na: ang pangalan, ang build at ang uri ay may
                    sariling hanay, at ang stock build ay may tanda imbes na
                    numerong wala naman. */}
                <td className="px-5 py-3 font-mono text-xs">
                  {declByPw.get(r.id)?.stock_request ? <StockTag /> : (r.order_number || "—")}
                </td>
                {/* SARILING HANAY ANG RMA # (2026-08-31, hiling ni Joe):
                    Order # | RMA # | SKU — dating nakasiksik sa ilalim ng
                    Order #, at ang bagong on-site pipeline ay hindi nahahanap
                    dahil nasa project_name nakatago ang RMA, hindi sa
                    description. */}
                <td className="whitespace-nowrap px-5 py-3 font-mono text-xs font-bold text-amber-700">
                  {rmaNoOf(r) ?? <span className="font-sans font-normal text-muted/50">—</span>}
                </td>
                <td className="whitespace-nowrap px-5 py-3 font-mono text-[11px] font-semibold text-[#8a6a1f]">
                  {declByPw.get(r.id)?.sku || rwOf(r)?.sku || itemOf(r)?.sku || <span className="font-sans text-muted/50">—</span>}
                </td>
                <td className="px-5 py-3">
                  {(() => {
                    const img = declByPw.get(r.id)?.item_image || rwOf(r)?.image || itemOf(r)?.image;
                    return img
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={img} alt="" className="h-10 w-10 rounded border border-border object-cover" />
                      : <div className="h-10 w-10 rounded border border-dashed border-border bg-stone-50" />;
                  })()}
                </td>
                <td className="px-5 py-3 font-medium">{itemName(r.project_name) || "—"}</td>
                <td className="max-w-[320px] truncate px-5 py-3 text-[11px] text-muted" title={itemSpecs(r.project_name).join(" · ")}>
                  {itemSpecs(r.project_name).join(" · ") || "—"}
                </td>
                {/* Ang `category` ng declaration ay ang SEKSYON na ginawa
                    ("Carpentry + Upholstery") — iyon ang ipinapadala ng
                    Declare. Ang URI ng produkto ay nasa `product`, hinahanap sa
                    pamamagitan ng SKU. */}
                <td className="px-5 py-3 text-[11px]">{declByPw.get(r.id)?.product_category || rwOf(r)?.category || itemOf(r)?.category || "—"}</td>
                {/* ANG SEKSYON LANG, HINDI ANG BUONG DESCRIPTION. Ang naunang
                    teksto ("Sofa 1 (+ Carpentry · Tufted…) — Upholstery") ay
                    inuulit ang pangalan at ang build na nasa sariling hanay na;
                    ang tanging bagong datos ay kung ALIN ang ginawa — at iyon
                    ang dahilan kung bakit magkaiba ang bayad sa isang item. */}
                <td className="px-5 py-3 text-muted">{workOf(r.description) || "—"}</td>
                <td className="!border-l-4 !border-l-[#caa45a] whitespace-nowrap px-5 py-3">{longDate(r.work_date)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-muted">{r.rate ? peso(r.rate) : "—"}</td>
                <td className="px-5 py-3 text-right tabular-nums text-muted">{r.ot ? peso(r.ot) : "—"}</td>
                <td className="px-5 py-3 text-right font-semibold tabular-nums">{peso(r.amount)}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={13} className="px-5 py-10 text-center text-muted">No constructor work yet. Click &ldquo;Add constructor work&rdquo; to record constructor earnings.</td></tr>
            )}
          </tbody>
        </table>
        </div>
        {filtered.length > 0 && <PaginationFooter {...pg} />}
      </Card>

      {/* Ang numero ay galing sa RMA row kung nandoon pa; kung nabura na, nasa
          description pa rin ito ng bayad — kaya nananatiling "Review · RMA-…"
          ang pamagat at hindi bumabagsak sa order number. */}
      {reviewRow && <QcReviewModal d={reviewRow.d} rmaNo={rwOf(reviewRow.row)?.rmaNo ?? (/\b(RMA-\d+)\b/i.exec(reviewRow.row.description ?? "")?.[1]?.toUpperCase() ?? null)} onClose={() => setReviewRow(null)} onEdit={() => { setForm(reviewRow.row); setReviewRow(null); }} />}
      {form && <ProjectForm row={form === "new" ? null : form} employees={employees} orders={orders} meta={form === "new" ? null : rwOf(form)} item={form === "new" ? null : itemOf(form)} onClose={() => setForm(null)} />}
      {assign && <ProjectForm row={null} employees={employees} orders={orders} prefill={{ employee_id: assign.employee_id, order_number: assign.order_number, description: assign.description }} onClose={() => setAssign(null)} />}
    </div>
  );
}

function OrderCombobox({ orders, value, onChange }: { orders: OrderLite[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? orders.filter((o) => o.order_number.toLowerCase().includes(s) || (o.customer_name ?? "").toLowerCase().includes(s)) : orders;
    return list.slice(0, 50);
  }, [orders, q]);
  return (
    <div className="relative">
      <input
        value={open ? q : value}
        onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setQ(""); setOpen(true); }}
        placeholder="Search order #…"
        className={inp}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
            {matches.map((o) => (
              <button key={o.order_number} type="button"
                onClick={() => { onChange(o.order_number); setOpen(false); }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-stone-100">
                <span className="font-mono text-xs">{o.order_number}</span>
                <span className="truncate text-xs text-muted">{o.customer_name ?? "—"}</span>
              </button>
            ))}
            {matches.length === 0 && <p className="px-3 py-3 text-center text-xs text-muted">No matching order.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectForm({ row, employees, orders, onClose, prefill, meta, item }: { row: ProjectWorkRow | null; employees: EmployeeLite[]; orders: OrderLite[]; onClose: () => void; prefill?: { employee_id: number | null; order_number: string; description: string }; meta?: ReworkMeta | null; item?: OrderItemLite | null }) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState<string>(row ? String(row.employee_id) : (prefill?.employee_id != null ? String(prefill.employee_id) : (employees[0] ? String(employees[0].id) : "")));
  // Ang project_name ay ang BUONG item (pangalan + spec bilang bullet), kaya ang
  // unang linya lang ang pumapalit kapag walang order number — ang buo nito ay
  // naglalagay ng labing-isang linya sa isang field at naisusulat pabalik bilang
  // order number kapag nag-save.
  const [orderNumber, setOrderNumber] = useState(row?.order_number ?? itemName(row?.project_name) ?? prefill?.order_number ?? "");
  const [description, setDescription] = useState(row?.description ?? prefill?.description ?? "");
  const [rate, setRate] = useState(row?.rate != null ? String(row.rate) : "");
  const [ot, setOt] = useState(row?.ot != null ? String(row.ot) : "");
  const [workDate, setWorkDate] = useState(row?.work_date ?? new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<Status>(row?.status ?? "Unpaid");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const amount = (Number(rate) || 0) + (Number(ot) || 0);
  const orderCustomer = orders.find((o) => o.order_number === orderNumber.trim())?.customer_name;

  function save() {
    setError(null);
    const input: ProjectWorkInput = {
      employee_id: Number(employeeId),
      order_number: orderNumber,
      rate: rate.trim() ? Number(rate) : 0,
      ot: ot.trim() ? Number(ot) : 0,
      description,
      work_date: workDate,
      status,
    };
    start(async () => {
      const res = row ? await updateProjectWork(row.id, input) : await createProjectWork(input);
      if ("error" in res) setError(res.error);
      else { onClose(); router.refresh(); }
    });
  }
  function del() {
    if (!row || !confirm("Delete this constructor work entry?")) return;
    start(async () => { const res = await deleteProjectWork(row.id); if ("error" in res) setError(res.error); else { onClose(); router.refresh(); } });
  }

  return (
    <Modal open onClose={onClose} title={row ? "Edit constructor work" : "Add constructor work"} size="sm"
      footer={
        <div className="flex items-center justify-between gap-2">
          {row ? <button onClick={del} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-danger ring-1 ring-inset ring-red-600/20 hover:bg-red-50">Delete</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
            <button onClick={save} disabled={pending || !employeeId || !orderNumber.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">Save</button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {/* ANO ANG TRABAHONG BINABAYARAN (2026-08-25). Mga field lang ito noon:
            pangalan, numero, halaga — walang litrato, walang spec, kaya kailangang
            hulaan kung alin sa labing-isang detalye ng custom na kama ang
            pinag-uusapan. Ang hilera ng QC ay may Review modal na nagpapakita ng
            lahat; ang manu-manong entry at ang bayad ng rework ay dito dumarating,
            at wala silang declaration na pagkukunan — ang project_name at ang RMA
            ang pinagmumulan. */}
        {(() => {
          const nm = itemName(row?.project_name);
          const sp = itemSpecs(row?.project_name);
          // NABURA NA ANG RMA (2026-08-28): walang `meta`, kaya blangko noon ang
          // litrato, sku at kategorya sa preview. Ang order ang panghalili, at
          // ang numero ay nasa description pa rin ng bayad.
          const img = meta?.image ?? item?.image ?? null;
          const sku = meta?.sku ?? item?.sku ?? null;
          const cat = meta?.category ?? item?.category ?? null;
          const rma = meta?.rmaNo ?? (/\b(RMA-\d+)\b/i.exec(row?.description ?? "")?.[1]?.toUpperCase() ?? null);
          if (!nm && !meta && !rma) return null;
          return (
            <div className="flex gap-3 rounded-lg border border-border bg-stone-50 p-3">
              {img
                ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={img} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover ring-1 ring-border" />
                : <div className="h-16 w-16 shrink-0 rounded-lg border border-dashed border-border bg-stone-100" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {rma && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-700">{rma}</span>}
                  {cat && <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold text-muted">{cat}</span>}
                </div>
                <div className="mt-0.5 truncate text-sm font-bold text-[#3a2e14]" title={nm}>{nm || "—"}</div>
                {sku && <div className="font-mono text-[11px] font-semibold text-[#8a6a1f]">{sku}</div>}
                {sp.length > 0 && (
                  <div className="mt-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Specification / Design details</div>
                    <ul className="mt-0.5 ml-3.5 list-disc text-[11px] leading-snug text-muted">
                      {sp.map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        <div><label className="mb-1 block text-sm font-medium">Employee</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inp}>
            {!employees.length && <option value="">No constructors</option>}
            {[...new Map(employees.map((e) => [e.role, true])).keys()].map((role) => (
              <optgroup key={role} label={role.replace(/\s*-\s*constructor$/i, "").trim() || "Constructor"}>
                {employees.filter((e) => e.role === role).map((e) => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Order Number</label>
          <OrderCombobox orders={orders} value={orderNumber} onChange={setOrderNumber} />
          {orderCustomer && <p className="mt-1 text-xs text-muted">Customer: {orderCustomer}</p>}
        </div>
        <div><label className="mb-1 block text-sm font-medium">Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Work done…" className={inp} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="mb-1 block text-sm font-medium">Rate</label><input value={rate} onChange={(e) => setRate(e.target.value)} type="number" placeholder="₱" className={inp} /></div>
          <div><label className="mb-1 block text-sm font-medium">OT</label><input value={ot} onChange={(e) => setOt(e.target.value)} type="number" placeholder="₱" className={inp} /></div>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2">
          <span className="text-sm font-medium">Total amount</span>
          <span className="text-sm font-semibold text-primary">{peso(amount)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="mb-1 block text-sm font-medium">Date</label><input value={workDate} onChange={(e) => setWorkDate(e.target.value)} type="date" className={inp} /></div>
          <div><label className="mb-1 block text-sm font-medium">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={inp}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
      </div>
    </Modal>
  );
}
