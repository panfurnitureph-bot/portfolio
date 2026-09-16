"use client";

// PAYMENT APPROVAL — listahan ng manual installation collections (Cash/BDO/
// BPI/GCash) na naghihintay ng approve. Ang pag-click ng row ay nagbubukas ng
// REVIEW POPUP (2026-08-24): malaking proof · This payment / Balance before /
// Balance after · collected by · channel · problema mula sa automatic checks
// (lib/payment-checks) kung meron · order items sa standard SPECIFICATIONS view
// · payment history · Approve / Reject; J/K next-prev, A approve, R reject, Z
// zoom sa loob ng popup. Ang Approve LANG ang nagpapatala sa
// ledger (collectManualPayment) — saka lang lalabas sa PAN Overall at magiging
// PAID ang order sa Installation. Ang Reject ay may kasamang dahilan na
// babalik sa installer screen.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { approvePayment, rejectPayment, markRefundPaid, type PaymentApprovalRow, type RefundPayoutRow } from "@/app/orders/approval-actions";
import { cn } from "@/components/ui";
import { Modal } from "@/components/modal";
import { MultiImageUpload } from "@/components/multi-image-upload";
import { SpecFieldsView } from "@/components/spec-fields-input";
import { paymentKindLabel, runPaymentChecks, summarizeChecks, type CheckLevel } from "@/lib/payment-checks";
import { usePagination, PaginationFooter } from "@/components/pagination-footer";

const peso2 = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

// "refunds" (2026-09-01): hiwalay na tab ng mga pera-palabas — ang mga refund
// payout na naitala na sa Return/Defect Approval; basahin lang dito.
type Tab = "pending" | "approved" | "rejected" | "refunds";

const levelCls: Record<CheckLevel, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warn: "bg-amber-50 text-amber-800 ring-amber-600/25",
  bad: "bg-red-50 text-red-700 ring-red-600/20",
};
const waiting = (iso: string) => {
  const ms = Date.now() - (Date.parse(iso) || Date.now());
  const m = Math.max(Math.floor(ms / 60000), 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
};

export function PaymentApprovalsManager({ rows, refunds = [], panAccounts = [] }: { rows: PaymentApprovalRow[]; refunds?: RefundPayoutRow[]; panAccounts?: { id: number; name: string }[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pending");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reject dialog — inline note (walang window.prompt: naka-block sa ibang browser).
  const [rejecting, setRejecting] = useState<PaymentApprovalRow | null>(null);
  const [note, setNote] = useState("");
  // Proof viewer — buong laki sa modal, hindi bagong tab (APK webview friendly).
  const [viewProof, setViewProof] = useState<string | null>(null);
  // Review popup — ang row na nakabukas, aling proof, at ikot ng larawan.
  const [openId, setOpenId] = useState<number | null>(null);
  // Refund review popup (2026-09-01) — buong detalye ng payout + kontak ng
  // customer, isang pindot ang tawag.
  const [openRefund, setOpenRefund] = useState<RefundPayoutRow | null>(null);
  // "Mark refunded" (2026-09-01) — ang aktwal na padala: piliin ang account na
  // pinaglabasan bago itala; saka lang papasok ang PAN expense.
  // NASA LOOB NA NG REVIEW POPUP ang buong pag-record (2026-09-01, "dapat
  // nandito ung drop down para i-fill ung details tapos upload photos") —
  // walang hiwalay na dialog: MOP + litrato ng padala + record, iisang lugar.
  const [payAcct, setPayAcct] = useState<string>("");
  const [payProof, setPayProof] = useState<string[]>([]);
  useEffect(() => { setPayAcct(""); setPayProof([]); }, [openRefund?.id]);
  const [proofIdx, setProofIdx] = useState(0);
  const [rot, setRot] = useState(0);
  useEffect(() => { setProofIdx(0); setRot(0); }, [openId]);

  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status === "pending").length,
    approved: rows.filter((r) => r.status === "approved").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
    // Ang bilang sa tab ay ang BABAYARAN PA (to pay) — iyon ang may hinihinging
    // aksyon; ang buong listahan (kasama ang bayad na) ay nasa loob pa rin.
    refunds: refunds.filter((r) => !r.paid).length,
  }), [rows, refunds]);
  const shown = useMemo(() => (tab === "refunds" ? [] : rows.filter((r) => r.status === tab)), [rows, tab]);
  const pg = usePagination(shown);
  const pgRefunds = usePagination(refunds);
  // Checks kada row — para sa popup (chips ng problema lang kapag meron).
  const enriched = useMemo(() => shown.map((r) => {
    // Ang REWORK ay ibang pitaka — ang balanceBefore/orderTotal na dala nito ay
    // sa RMA na (listPaymentApprovals), kaya tumpak na ang tsek; ang subject ang
    // nagpapaayos ng SALITA ("Rework has no remaining balance", hindi "Order").
    const subject = r.returnId ? ("rework" as const) : ("order" as const);
    const checks = runPaymentChecks({ amount: r.amount, balanceBefore: r.balanceBefore, orderTotal: r.orderTotal, proofs: r.proofs, otherPending: r.otherPending, method: r.method, createdAt: r.createdAt, history: r.history, subject });
    return { r, checks, sum: summarizeChecks(checks), kind: paymentKindLabel({ ...r, subject }) };
  }), [shown]);
  const cur = openId !== null ? enriched.find((e) => e.r.id === openId) ?? null : null;
  const curIdx = cur ? enriched.findIndex((e) => e.r.id === cur.r.id) : -1;
  const move = (d: number) => { if (curIdx < 0) return; const i = Math.min(Math.max(curIdx + d, 0), enriched.length - 1); setOpenId(enriched[i].r.id); };
  // Isara kapag nawala na sa tab ang nakabukas (na-approve/na-reject).
  useEffect(() => { if (openId !== null && !shown.some((r) => r.id === openId)) setOpenId(null); }, [shown, openId]);
  const fullyPaidAfter = (r: PaymentApprovalRow) => r.balanceBefore - r.amount <= 0.004;
  const statusChip = (st: string) => st === "approved" ? levelCls.ok : st === "rejected" ? levelCls.bad : levelCls.warn;

  async function doApprove(r: PaymentApprovalRow) {
    if (busyId) return;
    setError(null); setBusyId(r.id);
    const res = await approvePayment(r.id);
    setBusyId(null);
    if ("error" in res) { setError(res.error); return; }
    if (openId === r.id) { const next = enriched[curIdx + 1] ?? enriched[curIdx - 1] ?? null; setOpenId(next && next.r.id !== r.id ? next.r.id : null); }
    router.refresh();
  }

  // Keyboard sa loob ng popup: J/K · A · R · Z.
  useEffect(() => {
    if (!cur) return;
    const h = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement | null)?.tagName ?? "";
      if (/INPUT|TEXTAREA|SELECT/.test(t) || rejecting || viewProof) return;
      const k = e.key.toLowerCase();
      if (k === "j") { e.preventDefault(); move(1); }
      else if (k === "k") { e.preventDefault(); move(-1); }
      else if (k === "a" && tab === "pending") { e.preventDefault(); void doApprove(cur.r); }
      else if (k === "r" && tab === "pending") { e.preventDefault(); setRejecting(cur.r); setNote(""); }
      else if (k === "z" && cur.r.proofs[proofIdx]) { e.preventDefault(); setViewProof(cur.r.proofs[proofIdx]); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, curIdx, enriched, tab, busyId, proofIdx, rejecting, viewProof]);

  async function doReject() {
    if (!rejecting || busyId) return;
    setError(null); setBusyId(rejecting.id);
    const res = await rejectPayment(rejecting.id, note);
    setBusyId(null);
    if ("error" in res) { setError(res.error); return; }
    const rid = rejecting.id;
    setRejecting(null); setNote("");
    if (openId === rid) { const next = enriched[curIdx + 1] ?? enriched[curIdx - 1] ?? null; setOpenId(next && next.r.id !== rid ? next.r.id : null); }
    router.refresh();
  }

  const chip = (s: string) =>
    s === "approved" ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
    : s === "rejected" ? "bg-red-50 text-red-700 ring-red-600/20"
    : "bg-amber-50 text-amber-700 ring-amber-600/25";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Payment Approval</h1>
          <p className="mt-0.5 text-sm text-muted">
            Manual installation collections awaiting review — a payment enters the ledger and PAN Overall only once approved.
          </p>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide ring-1 ring-inset", chip("pending"))}>
          <span className={cn("h-1.5 w-1.5 rounded-full", counts.pending ? "animate-pulse bg-amber-500" : "bg-stone-300")} />
          {counts.pending} pending
        </span>
      </div>

      {/* Status tabs */}
      <div className="flex w-fit gap-1 rounded-lg border border-border bg-white p-1 text-xs font-semibold">
        {(["pending", "approved", "rejected", "refunds"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn("rounded-md px-3 py-1.5 capitalize", tab === t ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground")}
          >
            {t} · {counts[t]}
          </button>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {/* Table — parehong enterprise style ng Installation table: espresso na
          group band + gold na hati ng mga grupo + bordered/centered na cells +
          pagination footer. */}
      <div className="overflow-visible rounded-xl border border-border bg-surface shadow-sm">
        <div className="max-h-[70vh] overflow-auto rounded-t-xl">
        <table className="w-full min-w-[1240px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={6} className="border-b border-[#caa45a] px-5 py-2">Order</th>
              <th colSpan={4} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Payment</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Review</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="px-4 py-3">Submitted</th>
              {/* HIWALAY NA HANAY ANG RMA (hiling 2026-08-29). Pinagsalit sila
                  noon sa isang cell, kaya ang rework na hilera ay walang order
                  number — at iyon ang kailangan para malaman kung saan ito
                  galing. Dalawang bagay ang dalawang hanay. */}
              <th className="px-4 py-3">Order #</th>
              <th className="px-4 py-3">RMA #</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Product Name</th>
              <th className="px-4 py-3">Address</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Channel</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Collected By</th>
              <th className="px-4 py-3">Proof</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">{tab === "pending" ? "Action" : "Reviewed"}</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {/* REFUNDS TAB (2026-09-01) — pera-palabas, basahin lang: naitala
                sa Return/Defect Approval, dito lang binabantayan. */}
            {tab === "refunds" ? (
              pgRefunds.slice.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-muted">No refunds recorded yet.</td></tr>
              ) : pgRefunds.slice.map((r) => (
                <tr key={r.id} onClick={() => setOpenRefund(r)} className="cursor-pointer border-b border-border last:border-0 hover:bg-[#faf5e9]" title="Click to review">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{fmtDate(r.refundedAt ?? r.approvedAt ?? "")}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">{r.orderNumber ?? (r.orderId != null ? `#${r.orderId}` : "—")}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-[#8a6a1f]">{r.rma}</td>
                  <td className="px-4 py-3">
                    <div className="mx-auto max-w-[200px] truncate" title={r.customer || ""}>{r.customer || "—"}</div>
                    {/* Ang kontak, kita agad — tayo ang magpapadala ng pera. */}
                    {r.contact && (
                      <a href={`tel:${r.contact}`} onClick={(e) => e.stopPropagation()} className="mt-0.5 block font-mono text-[11px] font-bold text-[#8a6a1f] hover:underline" title="Call the customer">
                        {r.contact}
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs"><div className="mx-auto max-w-[200px] truncate" title={r.product || ""}>{r.product || "—"}</div></td>
                  <td className="px-4 py-3 text-xs text-muted"><div className="mx-auto max-w-[220px] truncate" title={r.address || ""}>{r.address || "—"}</div></td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3">
                    {r.account
                      ? <span className="whitespace-nowrap rounded-full bg-[#f4ead8] px-2.5 py-0.5 text-[11px] font-bold text-[#4a3b1a] ring-1 ring-inset ring-[#caa45a]/40">{r.account}</span>
                      : <span className="text-xs text-muted/50">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-bold text-rose-700">−₱{peso2(r.amount)}</td>
                  <td className="px-4 py-3 text-xs"><div className="mx-auto max-w-[160px] truncate" title={r.approvedBy || ""}>{r.approvedBy || "—"}</div></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      {r.photos.slice(0, 4).map((u, i) => (
                        <button key={i} type="button" onClick={() => setViewProof(u)} className="overflow-hidden rounded border border-border transition-transform hover:scale-105" title="View proof">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt={`proof ${i + 1}`} className="h-9 w-9 bg-white object-cover" />
                        </button>
                      ))}
                      {r.photos.length === 0 && <span className="text-xs text-muted/50">—</span>}
                      {r.photos.length > 4 && <span className="text-[10px] font-semibold text-muted">+{r.photos.length - 4}</span>}
                    </div>
                  </td>
                  <td className="!border-l-4 !border-l-[#caa45a] whitespace-nowrap px-4 py-3">
                    {r.paid ? (
                      <div className="mx-auto max-w-[180px] truncate text-xs text-muted" title={r.approvedBy || ""}>{r.approvedBy || "—"}</div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setOpenRefund(r); }}
                        disabled={busyId !== null}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Mark refunded
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.paid
                      ? <span className="whitespace-nowrap rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-extrabold uppercase text-rose-700 ring-1 ring-inset ring-rose-600/20">Refunded</span>
                      : <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-700 ring-1 ring-inset ring-amber-600/25">To Pay</span>}
                  </td>
                </tr>
              ))
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-12 text-center text-muted">
                  {tab === "pending" ? "No payments waiting for approval." : `No ${tab} payments yet.`}
                </td>
              </tr>
            ) : pg.slice.map((r) => (
              <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-[#faf5e9]" title="Click to review">
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{fmtDate(r.createdAt)}</td>
                <td className="whitespace-nowrap px-4 py-3 font-semibold">{r.orderNumber ?? `#${r.orderId}`}</td>
                {/* REWORK (2026-08-25) — ibang ledger ang tatamaan ng Approve
                    (returns.rework_downpayment), kaya dapat makita agad ng
                    aprubador kung RMA ito bago pumindot. Ang "Rework" na tanda ay
                    inalis nang mabigyan ito ng sariling hanay (2026-08-29): ang
                    pamagat na "RMA #" ang nagsasabi na niyon, at ang tanda ay
                    naulit sa bawat hilera nang walang idinaragdag. */}
                <td className="whitespace-nowrap px-4 py-3 font-semibold text-[#8a6a1f]">
                  {r.returnId ? (r.returnNo ?? `RMA#${r.returnId}`) : <span className="font-normal text-muted/50">—</span>}
                </td>
                <td className="px-4 py-3"><div className="mx-auto max-w-[200px] truncate" title={r.customer || ""}>{r.customer || "—"}</div></td>
                {/* Ang RMA ay may ISANG gamit — ang inaayos; ang order ay maaaring
                    marami, kaya ang una at ang bilang ng natitira. */}
                {(() => {
                  const names = r.returnId
                    ? [String(r.rework?.itemDesc ?? "").split("\n")[0].trim()].filter(Boolean)
                    : (r.items ?? []).map((it) => String(it.description ?? "").split("\n")[0].trim()).filter(Boolean);
                  const first = names[0] ?? "";
                  return (
                    <td className="px-4 py-3 text-xs">
                      <div className="mx-auto max-w-[200px] truncate" title={names.join(" · ")}>
                        {first || <span className="text-muted/50">—</span>}
                        {names.length > 1 && <span className="ml-1 text-[10px] font-semibold text-[#8a6a1f]">+{names.length - 1}</span>}
                      </div>
                    </td>
                  );
                })()}
                <td className="px-4 py-3 text-xs text-muted"><div className="mx-auto max-w-[220px] truncate" title={r.address || ""}>{r.address || "—"}</div></td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3">
                  <span className="whitespace-nowrap rounded-full bg-[#f4ead8] px-2.5 py-0.5 text-[11px] font-bold text-[#4a3b1a] ring-1 ring-inset ring-[#caa45a]/40">{r.method}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-bold text-primary">₱{peso2(r.amount)}</td>
                <td className="px-4 py-3 text-xs"><div className="mx-auto max-w-[160px] truncate" title={r.collectedBy || r.submittedBy || ""}>{r.collectedBy || r.submittedBy || "—"}</div></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    {r.proofs.slice(0, 4).map((u, i) => (
                      <button key={i} type="button" onClick={(e) => { e.stopPropagation(); setViewProof(u); }} className="overflow-hidden rounded border border-border transition-transform hover:scale-105" title="View proof">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt={`proof ${i + 1}`} className="h-9 w-9 bg-white object-cover" />
                      </button>
                    ))}
                    {r.proofs.length === 0 && <span className="text-xs text-muted/50">—</span>}
                    {r.proofs.length > 4 && <span className="text-[10px] font-semibold text-muted">+{r.proofs.length - 4}</span>}
                  </div>
                </td>
                {tab === "pending" ? (
                  <td className="!border-l-4 !border-l-[#caa45a] whitespace-nowrap px-4 py-3">
                    <div className="inline-flex gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); doApprove(r); }}
                        disabled={busyId !== null}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busyId === r.id ? "Approving…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setRejecting(r); setNote(""); }}
                        disabled={busyId !== null}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                ) : (
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-xs text-muted">
                    <div className="mx-auto max-w-[180px] truncate" title={r.reviewedBy || ""}>{r.reviewedBy || "—"}</div>
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ring-1 ring-inset", chip(r.status))}>{r.status}</span>
                    {r.status === "rejected" && r.note && <span className="block max-w-[220px] truncate text-xs text-red-600" title={r.note}>“{r.note}”</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {tab === "refunds" ? <PaginationFooter {...pgRefunds} /> : <PaginationFooter {...pg} />}
      </div>

      <p className="text-[11px] text-muted">
        Approve records the payment (ledger entry, receipt, order marked paid) — the installer&apos;s screen turns PAID automatically.
        Reject sends the reason back to the installer, who can fix the issue and submit again. Click a row to review the proof beside the order&apos;s numbers.
      </p>

      {/* ── REVIEW POPUP ── */}
      {/* REWORK (2026-08-25) — ang pamagat ay RMA, hindi order. Ang order id
          lang ang lumalabas noon ("#238 · joe") kahit ang aaprubahan ay ang
          singil ng RMA, kaya walang makapagsabi kung aling pera ang tinitingnan. */}
      <Modal
        open={!!cur}
        onClose={() => setOpenId(null)}
        title={cur
          ? cur.r.returnId
            ? `${cur.r.returnNo ?? `RMA#${cur.r.returnId}`} · ${cur.r.customer || "—"} · ${cur.r.orderNumber ?? `order #${cur.r.orderId}`}`
            : `${cur.r.orderNumber ?? `#${cur.r.orderId}`} · ${cur.r.customer || "—"}`
          : "Review payment"}
        description={cur ? `${cur.kind} · ${cur.r.method} · submitted ${fmtDate(cur.r.createdAt)} by ${cur.r.submittedBy || "—"}` : ""}
        size="2xl"
      >
        {cur && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {cur.sum.level === "ok"
                ? <span className={cn("rounded-full px-2 py-0.5 font-extrabold ring-1 ring-inset", levelCls.ok)}>All checks green</span>
                : cur.checks.filter((c) => c.level !== "ok").map((c, i) => <span key={i} className={cn("rounded-full px-2 py-0.5 font-bold ring-1 ring-inset", levelCls[c.level])}>{c.text}</span>)}
              {cur.r.status !== "pending" && <span className={cn("rounded-full px-2 py-0.5 font-extrabold uppercase ring-1 ring-inset", statusChip(cur.r.status))}>{cur.r.status} · {cur.r.reviewedBy || "—"}{cur.r.note ? ` — “${cur.r.note}”` : ""}</span>}
              <span className="ml-auto flex gap-1">
                <button type="button" onClick={() => move(-1)} disabled={curIdx <= 0} className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-bold disabled:opacity-40">↑ Prev (K)</button>
                <button type="button" onClick={() => move(1)} disabled={curIdx >= enriched.length - 1} className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-bold disabled:opacity-40">Next (J) ↓</button>
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-[1.05fr_1fr]">
              {/* Proof */}
              <div className="flex flex-col gap-2 rounded-lg bg-[#f1ebe1] p-3">
                <div className="relative flex aspect-[3/4] max-h-[52vh] items-center justify-center overflow-hidden rounded-lg bg-[#2b2419]">
                  {cur.r.proofs[proofIdx] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cur.r.proofs[proofIdx]} alt="payment proof" style={{ transform: `rotate(${rot}deg)` }} className="max-h-full max-w-full cursor-zoom-in object-contain" onClick={() => setViewProof(cur.r.proofs[proofIdx])} />
                  ) : <span className="text-xs text-[#f4ead8]/70">No proof photo</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {cur.r.proofs.map((u, i) => (
                    <button key={u + i} type="button" onClick={() => setProofIdx(i)} className={cn("overflow-hidden rounded border", i === proofIdx ? "border-[#caa45a] ring-2 ring-[#caa45a]/40" : "border-border")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" className="h-10 w-10 bg-white object-cover" />
                    </button>
                  ))}
                  <span className="ml-auto flex gap-1">
                    <button type="button" onClick={() => cur.r.proofs[proofIdx] && setViewProof(cur.r.proofs[proofIdx])} className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-bold">Zoom (Z)</button>
                    <button type="button" onClick={() => setRot((d) => (d + 90) % 360)} className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-bold">Rotate</button>
                    {cur.r.proofs[proofIdx] && <a href={cur.r.proofs[proofIdx]} target="_blank" rel="noreferrer" className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-bold">Original</a>}
                  </span>
                </div>
              </div>

              {/* Facts */}
              <div className="flex flex-col gap-3 text-sm">
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="flex justify-between bg-[#faf5e9] px-3 py-2 font-bold"><span>This payment</span><b className="tabular-nums">₱{peso2(cur.r.amount)}</b></div>
                  <div className="flex justify-between border-t border-border px-3 py-2"><span className="text-muted">Balance before</span><b className="tabular-nums">₱{peso2(cur.r.balanceBefore)}</b></div>
                  <div className={cn("flex justify-between border-t border-border px-3 py-2", fullyPaidAfter(cur.r) ? "bg-emerald-50" : "bg-amber-50")}>
                    <span className="text-muted">Balance after approve</span>
                    <b className={cn("tabular-nums", fullyPaidAfter(cur.r) ? "text-emerald-700" : "text-amber-800")}>₱{peso2(Math.max(cur.r.balanceBefore - cur.r.amount, 0))}{fullyPaidAfter(cur.r) ? " · FULLY PAID" : " · PARTIAL"}</b>
                  </div>
                </div>
                <div className="flex justify-between border-b border-dashed border-border py-1"><span className="text-muted">Collected by</span><b>{cur.r.collectedBy || cur.r.submittedBy || "—"}</b></div>
                <div className="flex justify-between border-b border-dashed border-border py-1"><span className="text-muted">Channel</span><b>{cur.r.method}</b></div>
                <div className="flex justify-between border-b border-dashed border-border py-1"><span className="text-muted">{cur.r.returnId ? "Rework charge · mode" : "Order total · status"}</span><b>₱{peso2(cur.r.orderTotal)} · {cur.r.orderStatus || "—"}</b></div>
                <div className="flex justify-between border-b border-dashed border-border py-1"><span className="text-muted">Customer</span><b className="text-right">{[cur.r.customerPhone, cur.r.customerEmail].filter(Boolean).join(" · ") || "—"}</b></div>
                {cur.r.address && <div className="flex justify-between border-b border-dashed border-border py-1"><span className="text-muted">Address</span><b className="max-w-[60%] text-right">{cur.r.address}</b></div>}

                {cur.r.rework && (
                  <>
                    <div className="flex justify-between border-b border-dashed border-border py-1">
                      <span className="text-muted">RMA status · target</span>
                      <b className="text-right">{cur.r.rework.status || "—"}{cur.r.rework.target ? ` · ${cur.r.rework.target === "restock" ? "back to stock" : "back to customer"}` : ""}</b>
                    </div>
                    <div className="flex justify-between border-b border-dashed border-border py-1">
                      <span className="text-muted">Item condition</span>
                      <b className="text-right">{cur.r.rework.condition || "—"}</b>
                    </div>
                    {cur.r.rework.crew.length > 0 && (
                      <div className="flex justify-between border-b border-dashed border-border py-1">
                        <span className="text-muted">On-site crew</span>
                        <b className="max-w-[60%] text-right">{cur.r.rework.crew.map((c) => c.name).join(", ")}</b>
                      </div>
                    )}
                    {cur.r.rework.workshop && (
                      <div className="flex justify-between border-b border-dashed border-border py-1">
                        <span className="text-muted">Workshop</span>
                        <b className="text-right">{cur.r.rework.workshop}</b>
                      </div>
                    )}
                    <div className="flex justify-between border-b border-dashed border-border py-1">
                      <span className="text-muted">Declared</span>
                      <b className="text-right">{cur.r.rework.createdAt ? fmtDate(cur.r.rework.createdAt) : "—"}{cur.r.rework.requestedBy ? ` · ${cur.r.rework.requestedBy}` : ""}</b>
                    </div>
                    {cur.r.rework.approvedBy && (
                      <div className="flex justify-between border-b border-dashed border-border py-1">
                        <span className="text-muted">RMA approved by</span>
                        <b className="text-right">{cur.r.rework.approvedBy}</b>
                      </div>
                    )}
                    {cur.r.rework.reason && (
                      <div>
                        <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-[#8a6a1f]">Reason for the rework</p>
                        <p className="rounded-lg border border-border bg-[#faf5e9] px-3 py-2 text-xs">{cur.r.rework.reason}</p>
                      </div>
                    )}
                    {cur.r.rework.notes && (
                      <div>
                        {/* ANG OVERRIDE AY NAKATAGO DITO. "Approved WITHOUT the 50%
                            downpayment (override by …)" — iyon ang dahilan kung
                            bakit buong ₱3,400.70 ang kinokolekta ngayon at hindi
                            kalahati, at hindi ito mababasa ng aprubador kahit saan. */}
                        <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-[#8a6a1f]">Decision on record</p>
                        <p className={cn("rounded-lg border px-3 py-2 text-xs", /override/i.test(cur.r.rework.notes) ? "border-amber-300 bg-amber-50 text-amber-900" : "border-border bg-[#faf5e9]")}>{cur.r.rework.notes}</p>
                      </div>
                    )}
                    {cur.r.rework.photos.length > 0 && (
                      <div>
                        <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-[#8a6a1f]">Photos of the fault ({cur.r.rework.photos.length})</p>
                        <div className="flex flex-wrap gap-1.5">
                          {cur.r.rework.photos.map((u) => (
                            <button key={u} type="button" onClick={() => setViewProof(u)} className="overflow-hidden rounded border border-border hover:border-[#caa45a]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={u} alt="" className="h-14 w-14 bg-white object-cover" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div>
                  <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-[#8a6a1f]">{cur.r.rework ? "Rework ledger" : "Payment history"}</p>
                  <div className="ml-1.5 space-y-1.5 border-l-2 border-border pl-3 text-xs">
                    {/* Ang REWORK ay wala sa orders ledger — sariling talaan ito
                        (returns.rework_downpayment), kaya iyon ang binibilang.
                        "No payment recorded" lang ang nakasulat noon, na tama
                        para sa orders at walang saysay para sa RMA. */}
                    {cur.r.rework ? (
                      <>
                        <div className="text-muted">
                          Charge ₱{peso2(cur.r.rework.charge)}
                          {" = "}
                          {[
                            cur.r.rework.orderBalancePart > 0 ? `₱${peso2(cur.r.rework.orderBalancePart)} order balance` : null,
                            cur.r.rework.partsTotal > 0 ? `₱${peso2(cur.r.rework.partsTotal)} parts` : null,
                            cur.r.rework.deliveryPrice > 0 ? `₱${peso2(cur.r.rework.deliveryPrice)} ${cur.r.rework.mode === "Pull out" ? "pull-out" : "crew trip"}` : null,
                          ].filter(Boolean).join(" + ")}
                        </div>
                        {/* ANG APAT NA PIYESA, HINDI LANG "₱6,500 parts"
                            (2026-08-27) — ang aprubador ay nagpapasya sa pera,
                            kaya dapat kita kung saan napunta. */}
                        {cur.r.rework.partsList.length > 0 && (
                          <ul className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-2.5 text-[11px] text-muted">
                            {cur.r.rework.partsList.map((p, i) => (
                              <li key={i} className="flex justify-between gap-2">
                                <span className="truncate">{p.qty > 1 ? `${p.qty}× ` : ""}{p.part}</span>
                                <span className="shrink-0 tabular-nums">₱{peso2(p.amount)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className={cur.r.rework.paid > 0 ? "" : "text-muted"}>
                          {cur.r.rework.paid > 0
                            ? <b>₱{peso2(cur.r.rework.paid)} already collected on this RMA</b>
                            : "Nothing collected on this RMA yet."}
                        </div>
                        {cur.r.rework.paymentMethod && <div className="text-muted">Declared method: {cur.r.rework.paymentMethod}</div>}
                      </>
                    ) : cur.r.history.length === 0 ? <p className="text-muted">No payment recorded in the ledger yet.</p> : null}
                    {cur.r.history.map((h, i) => (
                      <div key={i}><b>₱{peso2(h.amount)} · {h.method || "—"} · {h.kind || ""}</b><span className="block text-muted">{h.paidAt || "—"}{h.collectedBy ? ` · ${h.collectedBy}` : ""}{h.reference ? ` · ${h.reference}` : ""}</span></div>
                    ))}
                    <div><b className="text-[#8a6a1f]">₱{peso2(cur.r.amount)} · {cur.r.method} · {cur.r.status === "pending" ? "this one — pending" : cur.r.status}</b></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Order items — standard SPECIFICATIONS view */}
            <div>
              <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-[#8a6a1f]">{cur.r.returnId ? "Rework — what is being charged" : "Order"}</p>
              {cur.r.rework?.itemDesc && (() => {
                const parts = cur.r.rework.itemDesc.split(/\s*•\s*/).map((x) => x.trim()).filter(Boolean);
                const name = parts[0] ?? "";
                const specs = parts.slice(1).join("\n");
                return (
                  <div className="mb-2 overflow-hidden rounded-lg border border-border">
                    <div className="flex items-center justify-between gap-3 bg-[#4a3b1a] px-3 py-2 text-sm text-[#f4ead8]">
                      <span className="font-semibold">Item under repair · {name}</span>
                      <span className="font-mono text-[11px] text-[#caa45a]">{[cur.r.rework!.sku, cur.r.rework!.category].filter(Boolean).join(" · ")}</span>
                    </div>
                    <div className="flex gap-2 p-2">
                      {cur.r.rework!.itemImage && (
                        <button type="button" onClick={() => setViewProof(cur.r.rework!.itemImage!)} className="shrink-0 overflow-hidden rounded border border-border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={cur.r.rework!.itemImage!} alt="" className="h-20 w-20 bg-white object-cover" />
                        </button>
                      )}
                      {specs && <div className="min-w-0 flex-1"><SpecFieldsView category={cur.r.rework!.category ?? ""} specs={specs} /></div>}
                    </div>
                  </div>
                );
              })()}
              {cur.r.items.length === 0 && <p className="text-xs text-muted">No items on record.</p>}
              <div className="grid gap-2 md:grid-cols-2">
                {cur.r.items.map((it, i) => {
                  const parts = it.description.split(/\s*•\s*/).map((x) => x.trim()).filter(Boolean);
                  const name = parts[0] ?? it.description;
                  const specs = parts.slice(1).join("\n");
                  return (
                    <div key={i} className="overflow-hidden rounded-lg border border-border">
                      <div className="flex items-center justify-between gap-3 bg-[#faf5e9] px-3 py-2 text-sm">
                        <span className="font-semibold">{it.qty}× {name}</span>
                        <b className="tabular-nums">₱{peso2(it.unitPrice * it.qty)}</b>
                      </div>
                      {specs && <div className="px-2 pb-1"><SpecFieldsView category="" specs={specs} /></div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {tab === "pending" && (
              <>
                <div className="flex flex-wrap gap-2 rounded-lg bg-[#faf5e9] px-3 py-3">
                  <button type="button" onClick={() => doApprove(cur.r)} disabled={busyId !== null} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">{busyId === cur.r.id ? "Approving…" : `Approve ₱${peso2(cur.r.amount)} (A)`}</button>
                  <button type="button" onClick={() => { setRejecting(cur.r); setNote(""); }} disabled={busyId !== null} className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">Reject (R)</button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Reject dialog — kailangang may dahilan: ito ang babasahin ng installer. */}
      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject payment"
        description={rejecting ? `${rejecting.orderNumber ?? `#${rejecting.orderId}`} · ${rejecting.method} · ₱${peso2(rejecting.amount)}` : ""}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRejecting(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-stone-100">Cancel</button>
            <button
              type="button"
              onClick={doReject}
              disabled={busyId !== null || !note.trim()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busyId !== null ? "Rejecting…" : "Reject payment"}
            </button>
          </div>
        }
      >
        <label className="mb-1 block text-xs font-semibold text-muted">Reason — shown on the installer&apos;s screen *</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. Receipt photo is blurry — retake it and submit again."
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </Modal>

      {/* Proof viewer */}
      <Modal open={!!viewProof} onClose={() => setViewProof(null)} title="Payment proof" size="2xl">
        {viewProof && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={viewProof} alt="payment proof" className="mx-auto max-h-[70vh] w-auto rounded-lg border border-border bg-white" />
        )}
      </Modal>

      {/* REFUND REVIEW (2026-09-01) — buong detalye ng payout: sino ang
          customer at PAANO siya makokontak (tayo ang magpapadala ng pera),
          saan lumabas ang pera, at ang proof photos ng RMA. */}
      <Modal open={!!openRefund} onClose={() => setOpenRefund(null)} title={openRefund ? `${openRefund.rma} — Refund` : "Refund"} size="2xl">
        {openRefund && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-rose-700">Refund payout</p>
                <p className="text-2xl font-extrabold text-rose-700">−₱{peso2(openRefund.amount)}</p>
              </div>
              <div className="text-right text-xs text-muted">
                {openRefund.paid
                  ? (openRefund.account && <span className="rounded-full bg-[#f4ead8] px-2.5 py-0.5 text-[11px] font-bold text-[#4a3b1a] ring-1 ring-inset ring-[#caa45a]/40">{openRefund.account}</span>)
                  : <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-extrabold uppercase text-amber-700 ring-1 ring-inset ring-amber-600/25">To Pay</span>}
                <p className="mt-1">{fmtDate(openRefund.refundedAt ?? openRefund.approvedAt ?? "")}</p>
              </div>
            </div>
            <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between border-b border-dashed border-border py-1"><span className="text-muted">Order</span><b>{openRefund.orderNumber ?? "—"}</b></div>
              <div className="flex justify-between border-b border-dashed border-border py-1"><span className="text-muted">Product</span><b className="max-w-[220px] truncate text-right" title={openRefund.product || ""}>{openRefund.product || "—"}</b></div>
              <div className="flex justify-between border-b border-dashed border-border py-1"><span className="text-muted">Customer</span><b>{openRefund.customer || "—"}</b></div>
              <div className="flex justify-between border-b border-dashed border-border py-1">
                <span className="text-muted">Contact</span>
                {openRefund.contact
                  ? <a href={`tel:${openRefund.contact}`} className="font-mono font-bold text-[#8a6a1f] hover:underline">{openRefund.contact}</a>
                  : <b>—</b>}
              </div>
              <div className="flex justify-between border-b border-dashed border-border py-1">
                <span className="text-muted">Email</span>
                {openRefund.email
                  ? <a href={`mailto:${openRefund.email}`} className="max-w-[240px] truncate font-semibold text-[#8a6a1f] hover:underline" title={openRefund.email}>{openRefund.email}</a>
                  : <b>—</b>}
              </div>
              <div className="flex justify-between border-b border-dashed border-border py-1"><span className="text-muted">Approved by</span><b>{openRefund.approvedBy || "—"}</b></div>
              <div className="flex justify-between border-b border-dashed border-border py-1 sm:col-span-2"><span className="text-muted">Address</span><b className="max-w-[70%] text-right">{openRefund.address || "—"}</b></div>
            </div>
            {/* I-RECORD ANG PADALA DITO MISMO (2026-09-01): MOP + litrato ng
                transfer + record — walang hiwalay na dialog. */}
            {!openRefund.paid && (
              <div className="space-y-3 rounded-xl border-2 border-emerald-300 bg-emerald-50/40 p-4">
                <p className="text-sm font-bold text-emerald-800">Record the payout</p>
                <p className="text-xs text-muted">
                  Send <b className="text-rose-700">₱{peso2(openRefund.amount)}</b> to <b className="text-foreground">{openRefund.customer || "the customer"}</b>{openRefund.contact ? <> (<span className="font-mono">{openRefund.contact}</span>)</> : null}, then fill this in — the payout enters PAN Overall as a Refund expense. The order’s ledger stays untouched.
                </p>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-muted">Mode of payment — account the money was sent from *</span>
                  <select value={payAcct} onChange={(e) => setPayAcct(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary">
                    <option value="">— select account —</option>
                    {panAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
                <div className="block">
                  <span className="mb-1 block text-xs font-semibold text-muted">Photo of the transfer sent to the customer <span className="text-rose-600">*</span></span>
                  <MultiImageUpload value={payProof} onChange={setPayProof} camera folder="refund-payout" />
                </div>
                {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}
                <button
                  type="button"
                  disabled={busyId !== null || !payAcct || payProof.length < 1}
                  onClick={async () => {
                    const r = openRefund;
                    if (!r) return;
                    setError(null); setBusyId(r.id);
                    const res = await markRefundPaid(r.id, Number(payAcct), payProof);
                    setBusyId(null);
                    if ("error" in res) { setError(res.error); return; }
                    setOpenRefund(null);
                    router.refresh();
                  }}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busyId !== null ? "Recording…" : !payAcct ? "Pick the account first" : payProof.length < 1 ? "Add the transfer photo first" : "✓ Money sent — record it"}
                </button>
              </div>
            )}
            {/* Patunay ng padala (0223) — kita sa REFUNDED na rows. */}
            {openRefund.payoutPhotos.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted">Transfer proof — sent to the customer ({openRefund.payoutPhotos.length})</p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {openRefund.payoutPhotos.map((u, i) => (
                    <button key={i} type="button" onClick={() => setViewProof(u)} className="overflow-hidden rounded-lg border-2 border-emerald-300 transition-transform hover:scale-105" title="View full size">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`transfer proof ${i + 1}`} className="aspect-square w-full bg-white object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {openRefund.photos.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted">RMA proof photos ({openRefund.photos.length})</p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {openRefund.photos.map((u, i) => (
                    <button key={i} type="button" onClick={() => setViewProof(u)} className="overflow-hidden rounded-lg border border-border transition-transform hover:scale-105" title="View full size">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`proof ${i + 1}`} className="aspect-square w-full bg-white object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
