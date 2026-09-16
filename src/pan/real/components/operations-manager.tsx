"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatCard, cn, SpecRows, isReworkItem, ReworkTag } from "./ui";
import { Modal } from "./modal";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { MultiImageUpload } from "./multi-image-upload";
import { Thumbnail } from "./thumbnail";
import type { OperationsData, AssignLine, RequestRow, MaterialRow, JobRow } from "@/app/operations/data";
import { ProductPreviewModal } from "./product-preview-modal";
import { SpecFieldsView } from "./spec-fields-input";
import { specCategoryOf } from "./line-items-editor";
import { realValue } from "@/lib/product-columns";
import { approveToWorkshop, skipLine, orderRequest, rejectRequest, followUpRequest, saveMaterial, deleteMaterial, assignMaterials } from "@/app/operations/actions";
import { saveRushThreshold } from "@/app/orders/actions";
import { parseBuildSpecs } from "@/lib/build-specs";
import { RushBadge } from "./rush-badge";
import { EditOrderModal } from "./edit-order-modal";

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";

// Light color palette cycled across workshop options in the assign dropdown.
const WS_COLORS = [
  { bg: "bg-amber-50", text: "text-amber-800", hover: "hover:bg-amber-100", dot: "bg-amber-400", arrow: "text-amber-500" },
  { bg: "bg-emerald-50", text: "text-emerald-800", hover: "hover:bg-emerald-100", dot: "bg-emerald-400", arrow: "text-emerald-500" },
  { bg: "bg-sky-50", text: "text-sky-800", hover: "hover:bg-sky-100", dot: "bg-sky-400", arrow: "text-sky-500" },
  { bg: "bg-violet-50", text: "text-violet-800", hover: "hover:bg-violet-100", dot: "bg-violet-400", arrow: "text-violet-500" },
  { bg: "bg-rose-50", text: "text-rose-800", hover: "hover:bg-rose-100", dot: "bg-rose-400", arrow: "text-rose-500" },
];

function AssignDropdown({ current, workshops, onPick }: { current: string | undefined; workshops: { id: number; name: string }[]; onPick: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200) });
    }
    setOpen((o) => !o);
  };
  return (
    <>
      <button ref={ref} type="button" onClick={toggle} className={cn(inp, "inline-flex w-44 items-center justify-center gap-2 text-center")}>
        <span className={current ? "truncate" : "truncate text-muted"}>{current ?? "— select —"}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 rounded-xl border border-border bg-surface p-1.5 shadow-xl" style={{ top: pos.top, left: pos.left, width: pos.width }}>
            {workshops.map((w, i) => {
              const c = WS_COLORS[i % WS_COLORS.length];
              const active = current === w.name;
              return (
                <button key={w.id} onClick={() => { onPick(w.id); setOpen(false); }}
                  className={cn("mb-0.5 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium last:mb-0", c.bg, c.text, c.hover)}>
                  <span className="flex items-center gap-2"><span className={cn("h-2 w-2 rounded-full", c.dot)} />{w.name}{active && <span className="ml-1 text-xs">✓</span>}</span>
                  <span className={c.arrow}>→</span>
                </button>
              );
            })}
            {workshops.length === 0 && <p className="px-3 py-3 text-center text-sm text-muted">No workshops.</p>}
          </div>
        </>
      )}
    </>
  );
}

function jobPill(s: string) {
  const v = s.toLowerCase();
  if (/delivered/.test(v)) return "bg-emerald-100 text-emerald-700";
  if (/install/.test(v)) return "bg-cyan-100 text-cyan-700";
  if (/arrived/.test(v)) return "bg-teal-100 text-teal-700";
  if (/out for delivery/.test(v)) return "bg-sky-100 text-sky-700";
  if (/qc passed/.test(v)) return "bg-green-100 text-green-700";
  if (/for approval/.test(v)) return "bg-violet-100 text-violet-700";
  if (/in_progress/.test(v)) return "bg-blue-100 text-blue-700";
  if (/accept/.test(v)) return "bg-indigo-100 text-indigo-700";
  return "bg-amber-100 text-amber-700"; // pending
}
const jobLabel = (s: string) => ({ pending: "Pending", accepted: "Accepted", in_progress: "In Progress", done: "Done", delivered: "Delivered" }[s] ?? s);

// Uniform status pill for stock requests.
function reqPill(r: { status: string; qty_fulfilled: number | null; qty_received: number }): { label: string; cls: string } {
  const s = (r.status || "").toLowerCase();
  if (/fulfilled/.test(s)) return { label: `✓ Fulfilled (+${r.qty_received || r.qty_fulfilled || 0})`, cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" };
  if (/ordered/.test(s)) return { label: `◆ Ordered (${r.qty_fulfilled ?? 0})`, cls: "bg-sky-50 text-sky-700 ring-sky-200" };
  if (/partial/.test(s)) return { label: `◐ Partial (${r.qty_received}/${r.qty_fulfilled ?? 0})`, cls: "bg-amber-50 text-amber-700 ring-amber-200" };
  if (/reject/.test(s)) return { label: "✕ Rejected", cls: "bg-stone-100 text-stone-500 ring-stone-200" };
  return { label: "Pending", cls: "bg-amber-50 text-amber-700 ring-amber-200" };
}

export type OpsSection = "approval" | "tracker" | "requests" | "materials";

export function OperationsManager({ data, currentUser, section }: { data: OperationsData; currentUser: string; section: OpsSection }) {
  const lowCount = data.materials.filter((m) => m.low_threshold > 0 && m.on_hand <= m.low_threshold).length;
  return (
    <div className="space-y-5">
      {section === "materials" ? (
        <div className="apk-hide grid grid-cols-3 gap-4">
          <StatCard label="Materials" value={String(data.materials.length)} />
          <StatCard label="Low Stock" value={String(lowCount)} tone={lowCount ? "danger" : undefined} />
          <StatCard label="Workshops" value={String(data.workshops.length)} tone="info" />
        </div>
      ) : (
        <div className="apk-hide grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="To Assign" value={String(data.kpi.toAssign)} tone="info" />
          <StatCard label="In Progress" value={String(data.kpi.inProgress)} />
          <StatCard label="Done (week)" value={String(data.kpi.doneWeek)} tone="success" />
          <StatCard label="Pending Requests" value={String(data.kpi.pendingReq)} tone={data.kpi.pendingReq ? "warning" : undefined} />
        </div>
      )}

      {section === "approval" && <ApprovalTab data={data} />}
      {section === "tracker" && <TrackerTab data={data} />}
      {section === "requests" && <RequestsTab data={data} currentUser={currentUser} />}
      {section === "materials" && <MaterialsTab data={data} />}
    </div>
  );
}

type OrderGroup = { order_id: number; order_number: string | null; customer: string | null; date: string | null; source: string | null; address: string | null; is_rush: boolean; rush_days: number | null; mto_number: string | null; fq_number: string | null; contact: string | null; lines: AssignLine[] };

const BDL = "!border-l-4 !border-l-[#caa45a]";
const fmtDate = (d: string | null) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

function ApprovalTab({ data }: { data: OperationsData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picks, setPicks] = useState<Record<string, number>>({});   // per-line: `${order_id}|${item_desc}`
  const [open, setOpen] = useState<Record<number, boolean>>({});     // product "+more" expand per order
  const [err, setErr] = useState<string | null>(null);
  const [skipTarget, setSkipTarget] = useState<AssignLine | null>(null);
  const [previewLine, setPreviewLine] = useState<AssignLine | null>(null);
  const [editOrderId, setEditOrderId] = useState<number | null>(null);
  const keyOf = (l: AssignLine) => `${l.order_id}|${l.item_desc}`;
  const wsNameById = useMemo(() => new Map(data.workshops.map((w) => [w.id, w.name])), [data.workshops]);
  // Ang rush tagging ay sa Edit Order na (may per-order days) — tanggal na ang
  // dating checkbox column dito; ang badge sa Order # ang nagpapakita ng rush.
  const editOrder = editOrderId != null ? data.ordersById[editOrderId] : null;

  const groups: OrderGroup[] = useMemo(() => {
    const m = new Map<number, OrderGroup>();
    for (const l of data.toAssign) {
      const g = m.get(l.order_id) ?? { order_id: l.order_id, order_number: l.order_number, customer: l.customer, date: l.date, source: l.source, address: l.address, is_rush: l.is_rush, rush_days: l.rush_days ?? null, mto_number: l.mto_number, fq_number: l.fq_number, contact: l.contact, lines: [] };
      g.lines.push(l); m.set(l.order_id, g);
    }
    return [...m.values()];
  }, [data.toAssign]);

  const pg = usePagination(groups, 25);

  const approveLine = (l: AssignLine, wsId: number) => {
    if (!wsId) { setErr("Select a workshop first."); return; }
    setErr(null);
    start(async () => {
      const res = await approveToWorkshop({ order_id: l.order_id, order_number: l.order_number, workshop_id: wsId, item_desc: l.full_desc || l.item_desc, qty: l.qty });
      if ("error" in res) { setErr(res.error); return; }
      router.refresh();
    });
  };

  const skipLineFn = (l: AssignLine) => {
    setErr(null);
    start(async () => {
      // full_desc = pangalan + buong build; ito ang itinatala para may
      // makita ang Warehouse QC bago i-pack (pareho ng approveToWorkshop).
      const res = await skipLine(l.order_id, l.full_desc || l.item_desc, l.color ?? "");
      if ("error" in res) { setErr(res.error); return; }
      setSkipTarget(null);
      router.refresh();
    });
  };

  if (groups.length === 0) {
    return <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-muted">No orders waiting to be assigned.</div>;
  }

  const TDc = "px-4 py-3 text-center align-middle";

  return (
    <div className="space-y-3">
      {err && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</p>}
      <div className="flex justify-end"><RushThresholdField initial={data.rushThreshold} /></div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full xl:min-w-[1600px] table-fixed text-[11px] xl:text-sm [&_td]:border-r [&_td]:border-border [&_td:last-child]:border-r-0">
            <colgroup>
              {/* Reference */}
              <col style={{ width: 96 }} />
              <col style={{ width: 92 }} />
              <col style={{ width: 106 }} />
              {/* Order information */}
              <col style={{ width: 92 }} />
              <col style={{ width: 118 }} />
              <col style={{ width: 108 }} />
              <col style={{ width: 74 }} />
              <col style={{ width: 140 }} />
              {/* Product */}
              <col style={{ width: 230 }} />
              <col style={{ width: 108 }} />
              <col style={{ width: 108 }} />
              <col style={{ width: 210 }} />
              <col style={{ width: 116 }} />
              {/* Assign */}
              <col style={{ width: 190 }} />
              <col style={{ width: 160 }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&>th]:sticky [&>th]:top-0 [&>th]:bg-[#4a3b1a]">
                <th colSpan={3} className="border-b border-[#caa45a] px-4 py-2">Reference</th>
                <th colSpan={5} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-4 py-2">Order Information</th>
                <th colSpan={5} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-4 py-2">Product</th>
                <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-4 py-2">Assign</th>
              </tr>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&>th]:px-4 [&>th]:py-2 [&>th]:sticky [&>th]:top-[33px] [&>th]:bg-[#5a4a26]">
                <th>MTO #</th><th>FQ #</th><th>Order #</th>
                <th className="!border-l-4 !border-l-[#caa45a]">Date</th><th>Customer</th><th>Contact</th><th>Source</th><th>Address</th>
                <th className="!border-l-4 !border-l-[#caa45a]">Product</th><th>SKU</th><th>Category</th><th>Build</th><th>Amount</th>
                <th className="!border-l-4 !border-l-[#caa45a]">Assign Workshop</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pg.slice.flatMap((g) => {
                const opened = open[g.order_id] === true;
                const visible = opened ? g.lines : g.lines.slice(0, 1);
                const n = visible.length;
                const extra = g.lines.length - 1;
                return visible.map((l, idx) => (
                  // ROW CLICK = Product Details preview (hiling 2026-08-19) —
                  // ang Order # cell ang bumubukas ng Edit Order.
                  <tr key={keyOf(l)} onClick={() => setPreviewLine(l)} className="cursor-pointer border-b border-border last:border-0 hover:bg-stone-50/40">
                    {idx === 0 && (
                      <>
                        {/* REFERENCE — ang daanan ng order: MTO # → FQ # → Order #.
                            Ang walk-in ay may gitling; nananatili ang mga hanay kaya
                            pantay pa rin ang hilera. */}
                        <td rowSpan={n} className={cn(TDc, "whitespace-nowrap font-mono text-[11px] font-bold text-[#B87333]")}>
                          {g.mto_number ?? (g.fq_number ? "—" : <span className="rounded-full bg-stone-100 px-2 py-0.5 font-sans text-[10px] font-semibold text-stone-600">Direct · Stock</span>)}
                        </td>
                        <td rowSpan={n} className={cn(TDc, "whitespace-nowrap font-mono text-[11px] text-muted")}>{g.fq_number ?? "—"}</td>
                        <td rowSpan={n} onClick={(e) => { e.stopPropagation(); setEditOrderId(g.order_id); }} title="Open the order" className="px-4 py-3 align-middle font-mono text-xs font-semibold hover:text-primary"><div className="flex flex-col items-center gap-1">{g.is_rush && <RushBadge isRush dateOrder={g.date} threshold={g.rush_days ?? data.rushThreshold} />}<span>{g.order_number ?? "—"}</span></div></td>
                        <td rowSpan={n} className={cn(TDc, "whitespace-nowrap !border-l-4 !border-l-[#caa45a] text-muted")}>{fmtDate(g.date)}</td>
                        <td rowSpan={n} className={cn(TDc, "truncate")} title={g.customer ?? undefined}>{g.customer ?? "—"}</td>
                        {/* Ang tatawagan kapag may kailangang linawin bago maghiwa. */}
                        <td rowSpan={n} className={cn(TDc, "whitespace-nowrap text-muted")}>{g.contact ?? "—"}</td>
                        <td rowSpan={n} className={cn(TDc, "text-muted")}>{g.source ?? "—"}</td>
                        <td rowSpan={n} className={cn(TDc, "max-w-[160px] truncate text-muted")} title={g.address ?? undefined}>{g.address ?? "—"}</td>
                      </>
                    )}
                    <td className={cn("px-4 py-2.5 max-w-[380px]", BDL)}>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setPreviewLine(l); }} title="View product details" className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-primary">
                          <Thumbnail name={l.item_desc} url={l.image} />
                          <span className="min-w-0 flex-1">
                            {l.customized && <span className="mb-0.5 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Customized</span>}
                            <span className="block max-w-[240px] truncate font-medium" title={l.item_desc}>
                              <span className="mr-1 rounded bg-stone-100 px-1 text-[11px] font-bold tabular-nums text-stone-600">{l.qty}×</span>
                              {l.item_desc}
                            </span>
                          </span>
                        </button>
                        {idx === 0 && extra > 0 && (
                          <button onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [g.order_id]: !opened })); }}
                            className="ml-auto shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600 hover:bg-stone-200">
                            {opened ? "▴ less" : `▾ +${extra} more`}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center text-muted">{l.sku || "—"}</td>
                    <td className="px-4 py-2.5 text-center text-muted">{l.category || "—"}</td>
                    {/* BUILD (2026-08-21) — buong listahan, hindi dalawang linya
                        at bilang: ang mga spec na ito ang nagpapasya kung aling
                        workshop ang kayang tumanggap, kaya walang saysay itong
                        itago sa likod ng pindot. Isang linya bawat spec, clipped
                        at hindi wrapped, para pantay ang taas ng bawat hilera.
                        Tinanggal ang Color column: sa made-to-order, ang kulay
                        ay ang tela at nasa build na. */}
                    <td className="px-3 py-2.5 text-left text-[11px] leading-snug">
                      {(() => {
                        const specs = parseBuildSpecs(l.full_desc);
                        if (!specs.length) return <div className="text-center text-muted">—</div>;
                        return (
                          <ul className="max-w-[200px]" title={specs.map((x) => (x.label ? `${x.label}: ${x.value}` : x.value)).join("\n")}>
                            {specs.map((x, i) => (
                              <li key={i} className="truncate">
                                <span className="text-[#a8842e]">•</span>{" "}
                                {x.label && <span className="text-muted">{x.label}:</span>}{x.label ? " " : ""}{x.value}
                              </li>
                            ))}
                          </ul>
                        );
                      })()}
                    </td>
                    {/* Ang natanggap na deposito ang nagpapasya kung pwede nang
                        simulan ang trabaho — dating nasa ibang pahina pa. */}
                    <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums">
                      {l.order_total > 0 ? (
                        <>
                          ₱{l.order_total.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          {l.paid > 0 && (
                            <span className="block text-[10px] text-muted">
                              DP ₱{l.paid.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} paid
                            </span>
                          )}
                          {/* Ang idinagdag na item ay nagpapataas ng total nang
                              hindi nagpapataas ng bayad, kaya kulang na ang 30%.
                              Dumaraan pa rin ito sa pila (nagsimula na ang order)
                              — pero dapat malaman ng Ops bago mag-assign. */}
                          {l.short_paid && (
                            <span className="mt-1 block whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20" title="The added item raised the total — the 30% downpayment no longer covers it. Collect before dispatching.">
                              Below 30%
                            </span>
                          )}
                        </>
                      ) : "—"}
                    </td>
                    <td className={cn("px-4 py-2.5 text-center", BDL)} onClick={(e) => e.stopPropagation()}>
                      <AssignDropdown current={wsNameById.get(picks[keyOf(l)])} workshops={data.workshops} onPick={(id) => setPicks((p) => ({ ...p, [keyOf(l)]: id }))} />
                    </td>
                    <td className="px-4 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => approveLine(l, picks[keyOf(l)])} disabled={pending} title="Assign to workshop" className="whitespace-nowrap rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Assign</button>
                        <button onClick={() => setSkipTarget(l)} disabled={pending} title="No workshop needed — remove from queue" className="whitespace-nowrap rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">Skip</button>
                      </div>
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
        <PaginationFooter {...pg} />
      </div>

      {skipTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !pending && setSkipTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Mark as “No Workshop Needed”?</h3>
            <p className="mt-2 text-sm text-muted">
              This item will be removed from the <b>To Assign</b> queue — it won&apos;t be sent to a workshop. The <b>Sales Order is not affected</b>.
            </p>
            <div className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-sm">
              <p className="font-medium">{skipTarget.order_number || `#${skipTarget.order_id}`} · {skipTarget.customer || "—"}</p>
              <p className="text-xs text-muted">{skipTarget.qty}× {skipTarget.item_desc}</p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setSkipTarget(null)} disabled={pending} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-50">Cancel</button>
              <button onClick={() => skipLineFn(skipTarget)} disabled={pending} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{pending ? "Skipping…" : "Skip — No Workshop"}</button>
            </div>
          </div>
        </div>
      )}

      <ProductPreviewModal item={previewLine ? { image_url: previewLine.image, name: previewLine.item_desc, sku: previewLine.sku, category: previewLine.category, color: previewLine.color, dimension: previewLine.dimension, specs: (previewLine.full_desc || "").split("\n").slice(1).map((l) => l.trim()).filter(Boolean).join("\n") || null, qty: previewLine.qty, order_number: previewLine.order_number, mto_number: previewLine.mto_number, fq_number: previewLine.fq_number } : null} onClose={() => setPreviewLine(null)} />

      {editOrder && (
        <EditOrderModal order={editOrder} open onClose={() => setEditOrderId(null)}
          products={data.products} assignees={data.assignees} constructors={data.constructors} canEditWorkshop />
      )}
    </div>
  );
}

// Editable rush countdown threshold (days from order date). Saves to app_settings.
function RushThresholdField({ initial }: { initial: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [val, setVal] = useState(String(initial));
  const [err, setErr] = useState<string | null>(null);
  const save = () => start(async () => {
    const res = await saveRushThreshold(Number(val));
    if ("error" in res) { setErr(res.error); return; }
    setErr(null); router.refresh();
  });
  return (
    <div className="ml-auto flex items-center gap-1.5 text-sm">
      <span className="text-muted">Rush after</span>
      <input type="number" min={1} max={365} value={val} onChange={(e) => setVal(e.target.value)} className={cn(inp, "w-16 text-center")} />
      <span className="text-muted">days</span>
      <button onClick={save} disabled={pending || val === String(initial)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-stone-100 disabled:opacity-40">{pending ? "…" : "Save"}</button>
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </div>
  );
}

function TrackerTab({ data }: { data: OperationsData }) {
  const [ws, setWs] = useState("");
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<JobRow | null>(null);
  const rows = useMemo(() => data.jobs.filter((j) =>
    (!ws || String(j.workshop_id) === ws) && (!status || j.status === status)), [data.jobs, ws, status]);
  const pg = usePagination(rows, 25);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={ws} onChange={(e) => setWs(e.target.value)} className={cn(inp, "w-44")}>
          <option value="">All Workshops</option>
          {data.workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={cn(inp, "w-44")}>
          <option value="">All Status</option>
          {["pending", "accepted", "in_progress", "done", "delivered"].map((s) => <option key={s} value={s}>{jobLabel(s)}</option>)}
        </select>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
            <colgroup>
              <col span={2} />
              <col span={3} />
              <col span={2} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&>th]:sticky [&>th]:top-0 [&>th]:bg-[#4a3b1a]">
                <th colSpan={2} className="border-b border-[#caa45a] px-5 py-2">Order</th>
                <th colSpan={3} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Item</th>
                <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Status</th>
              </tr>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&>th]:sticky [&>th]:top-[33px] [&>th]:bg-[#5a4a26]">
              <th className="px-4 py-3">Order #</th><th className="px-4 py-3">Workshop</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Item</th><th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Dispatched</th><th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Status</th><th className="px-4 py-3">Route</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">No dispatched orders.</td></tr>
              ) : pg.slice.map((j) => (
                <tr key={j.id} onClick={() => setPreview(j)} className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex flex-col items-center gap-1">
                      <RushBadge isRush={j.is_rush} dateOrder={j.date_order} threshold={j.rush_days ?? data.rushThreshold} done={/delivered|done|completed/i.test(j.status ?? "")} />
                      {/* Walang order ang stock build — tag sa halip na gitling. */}
                      {j.stock_request
                        ? <span className="whitespace-nowrap rounded-full bg-[#4a3b1a] px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-[#f4ead8]" title={j.stock_reason ?? "Built for stock — no order"}>STOCK</span>
                        : <span>{j.order_number ?? "—"}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">{j.workshop_name}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] min-w-[180px] max-w-[320px] px-4 py-3" title={j.item_desc ?? ""}>
                    {/* Rework: badge + RMA on top, clean product name below. */}
                    {isReworkItem(j.item_desc) && (
                      <span className="mb-0.5 flex items-center justify-center gap-1.5">
                        <ReworkTag />
                        <span className="text-[11px] font-bold text-amber-700">{(j.item_desc ?? "").match(/rma-\d+/i)?.[0]?.toUpperCase() ?? ""}</span>
                      </span>
                    )}
                    <span className="block truncate">{(j.item_desc ?? "—").split("\n")[0].replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "")}</span>
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">{j.qty}</td>
                  <td className="px-4 py-3 text-muted">{j.dispatched_at ?? "—"}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", jobPill(j.status))}>{jobLabel(j.status)}</span></td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                      (j.fulfillment ?? "warehouse") === "pickup" ? "bg-sky-50 text-sky-700 ring-sky-200" : "bg-amber-50 text-amber-700 ring-amber-200")}>
                      {(j.fulfillment ?? "warehouse") === "pickup" ? "Pickup" : "Warehouse"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationFooter {...pg} />
      </div>

      {preview && <TrackerDetail job={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// Read-only order-tracking detail — mirrors the Workshop "Product Details" card:
// image + specs, a horizontal status stepper, and the fulfillment route.
function TrackerDetail({ job, onClose }: { job: JobRow; onClose: () => void }) {
  const STEPS: [string, string][] = [
    ["in_progress", "In Progress"], ["qc passed", "QC Passed"], ["out for delivery", "Out for Delivery"],
    ["arrived", "Arrived"], ["installation", "Installation"], ["delivered", "Delivered"],
  ];
  const stepOf = (s: string): number => {
    const v = (s || "").toLowerCase();
    if (/deliver(ed)?$/.test(v)) return 5;
    if (/install/.test(v)) return 4;
    if (/arrived/.test(v)) return 3;
    if (/out for delivery|^ofd$/.test(v)) return 2;
    if (/qc passed/.test(v)) return 1;
    return 0; // pending / accepted / in_progress / for approval → In Progress
  };
  const cur = stepOf(job.status);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-2xl overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Product Details</h2>
            <p className="text-sm text-muted">{job.order_number ?? `#${job.order_id}`}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-stone-100 hover:text-foreground">✕</button>
        </div>

        <div className="max-h-[78vh] overflow-y-auto p-4">
          <div className="flex flex-col gap-3 overflow-hidden rounded-xl border border-[#e6dcc4] bg-stone-50/50 shadow-sm">
            {/* Card header */}
            <div className="flex items-center gap-2.5 border-b border-[#e6dcc4] bg-[#4a3b1a] px-4 py-2.5">

              <div>
                <div className="text-sm font-semibold text-white">Product</div>
                <div className="text-[11px] text-[#e7dcc4]">What to build · specs</div>
              </div>
            </div>

            <div className="space-y-3 px-3 pb-3">
              {/* Image */}
              <div className="overflow-hidden rounded-xl border border-border bg-white">
                {job.image_url
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={job.image_url} alt="" className="mx-auto max-h-52 w-full object-contain p-2" />
                  : <div className="flex h-40 items-center justify-center text-muted">No image</div>}
              </div>

              {/* IISANG PORMA SA LAHAT NG MODAL (2026-08-23) — kapareho ng
                  Product Details ng Orders at ng Edit Inventory Item:
                  pangalan, apat na hilera, tapos ang guided spec cards.
                  Dating bullet list ito at ang build ng customer ay
                  naisisiksik sa category/color ("COLOR  Custom Bed — With
                  Add-ons"), kaya label sa label ang nababasa. */}
              {(() => {
                const name = (job.item_desc ?? "").split("\n")[0] || null;
                const specs = (job.item_desc ?? "").split("\n").slice(1)
                  .map((l) => l.trim().replace(/^[•·-]\s*/, "")).filter(Boolean).join("\n");
                const hasFabric = /^(Fabric(\s*\/\s*Finish)?|Upholstered Finish):/m.test(specs);
                // Nasa catalog = tunay ang category/color (galing sa product
                // table). Wala = hula ng parseDescSpecs — huwag ipakita.
                const inCatalog = !!job.sku;
                const rows: Array<[string, React.ReactNode]> = [
                  // Iisang hulma ang lahat (2026-08-23): ang Product / Name at
                  // ang SKU ay hilera rin, kasama ng Category.
                  ["Product / Name", name],
                  ...(job.sku ? [["SKU", <span key="sku" className="font-mono">{job.sku}</span>] as [string, React.ReactNode]] : []),
                  // HINDI IPINAPAKITA ANG HINULAANG CATEGORY/COLOR. Ang
                  // parseDescSpecs ay humuhula mula sa pagkakasunod ng bullets
                  // ("una = color, huli = category"), na tama sa resibo ng
                  // simpleng produkto pero mali sa build ng customizer: ang
                  // unang bullet doon ay ang pamagat, kaya lumalabas ang
                  // "COLOR  Custom Bed — With Add-ons". Ang buong build ay
                  // nasa specs sa ibaba, kaya walang nawawala kapag inalis.
                  ...(inCatalog && realValue(job.category) ? [["Category", realValue(job.category)] as [string, React.ReactNode]] : []),
                  ...(inCatalog && !hasFabric && realValue(job.color) ? [["Color", realValue(job.color)] as [string, React.ReactNode]] : []),
                  ...(realValue(job.dimension) ? [["Dimension", realValue(job.dimension)] as [string, React.ReactNode]] : []),
                  ...(job.frame?.trim() ? [["Add-ons", job.frame] as [string, React.ReactNode]] : []),
                  ["Qty", String(job.qty)],
                ];
                return (
                  <>
                    <SpecRows items={rows} />
                    <SpecFieldsView category={specCategoryOf(job.category, name)} specs={specs} />
                  </>
                );
              })()}

              {/* Status stepper (horizontal, read-only) */}
              <div className="border-t border-border pt-3">
                <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Order Status</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {STEPS.map(([, label], i) => {
                    const done = i < cur;
                    const active = i === cur;
                    return (
                      <span key={label} className={cn("flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold",
                        active ? "bg-[#4a3b1a] text-white ring-2 ring-[#caa45a]"
                          : done ? "bg-emerald-100 text-emerald-700"
                          : "border border-dashed border-border bg-white text-muted/70")}>
                        {done ? "✓" : active ? "●" : i + 1} {label}
                      </span>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[10px] text-muted">QC Passed → Out for Delivery → Installation → Delivered advance automatically as each module updates.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RequestsTab({ data, currentUser }: { data: OperationsData; currentUser: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [statusF, setStatusF] = useState("");
  const [fulfilling, setFulfilling] = useState<RequestRow | null>(null);
  const [qtyVal, setQtyVal] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // DALAWANG TANAW (hiling 2026-08-28). May 5-way na status dropdown na dito,
  // pero ang pinakamadalas na tanong ay iisa: ano pa ang hinihintay. Ang
  // "Pending" ay ang bukas pa (pending / ordered / partial); ang "Completed" ay
  // ang sarado na (fulfilled / rejected) — wala nang gagawin doon.
  const [tab, setTab] = useState<"open" | "done">("open");
  const isDone = (r: RequestRow) => /fulfilled|rejected/i.test(r.status ?? "");
  const scoped = useMemo(
    () => data.requests.filter((r) => (tab === "done" ? isDone(r) : !isDone(r))),
    [data.requests, tab],
  );
  const doneCount = useMemo(() => data.requests.filter(isDone).length, [data.requests]);
  const openCount = data.requests.length - doneCount;
  const rows = useMemo(() => scoped.filter((r) => !statusF || r.status === statusF), [scoped, statusF]);
  const pg = usePagination(rows, 25);
  const actionable = (r: RequestRow) => /pending/i.test(r.status) || (/partial/i.test(r.status) && !r.ops_followed_up);
  const needsAction = data.requests.filter(actionable);
  const doFollowUp = (r: RequestRow) => start(async () => { await followUpRequest(r.id); router.refresh(); });

  const openFulfill = (r: RequestRow) => { setFulfilling(r); setQtyVal(String(r.qty_requested)); setErr(null); };
  const doFulfill = () => {
    if (!fulfilling) return;
    start(async () => {
      const res = await orderRequest(fulfilling.id, Number(qtyVal), currentUser);
      if ("error" in res) { setErr(res.error); return; }
      setFulfilling(null); router.refresh();
    });
  };
  const doReject = (r: RequestRow) => start(async () => { await rejectRequest(r.id, currentUser); router.refresh(); });

  return (
    <div className="space-y-3">
      {needsAction.length > 0 && (() => {
        const partials = needsAction.filter((r) => /partial/i.test(r.status)).length;
        const pendings = needsAction.length - partials;
        return (
          <div className="flex items-start gap-3 overflow-hidden rounded-xl border border-amber-200 bg-surface shadow-sm">
            <div className="self-stretch w-1 bg-amber-500" />
            <div className="flex flex-1 items-center gap-3 py-3 pr-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/></svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">Action Required</span>
                  <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{needsAction.length}</span>
                </div>
                <p className="truncate text-xs text-muted">
                  {pendings > 0 && `${pendings} pending to order`}{pendings > 0 && partials > 0 && " · "}{partials > 0 && `${partials} short shipment${partials > 1 ? "s" : ""} to follow up`}
                </p>
              </div>
              <div className="hidden shrink-0 gap-1.5 sm:flex">
                {needsAction.slice(0, 3).map((r) => (
                  <span key={r.id} className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                    {r.material_name}{r.status === "partial" ? ` · ${r.qty_received}/${r.qty_fulfilled ?? 0}` : ""}
                  </span>
                ))}
                {needsAction.length > 3 && <span className="self-center text-[11px] text-muted">+{needsAction.length - 3}</span>}
              </div>
            </div>
          </div>
        );
      })()}
      <div className="flex flex-wrap items-center gap-3">
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={cn(inp, "w-44")}>
          <option value="">All</option>
          {["pending", "ordered", "partial", "fulfilled", "rejected"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <div className="ml-auto flex gap-1.5">
          {([["open", "Pending", openCount], ["done", "Completed", doneCount]] as const).map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={cn("rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors",
                tab === k ? "bg-[#4a3b1a] text-[#f4ead8]" : "border border-border bg-surface text-muted hover:bg-stone-100")}>
              {label} · {n}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
            <colgroup>
              <col span={4} />
              <col span={2} />
              <col span={1} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&>th]:sticky [&>th]:top-0 [&>th]:bg-[#4a3b1a]">
                <th colSpan={4} className="border-b border-[#caa45a] px-5 py-2">Request</th>
                <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Status</th>
                <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a]"></th>
              </tr>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&>th]:sticky [&>th]:top-[33px] [&>th]:bg-[#5a4a26]">
              <th className="px-4 py-3">Workshop</th><th className="px-4 py-3">Material</th>
              <th className="px-4 py-3">Qty</th><th className="px-4 py-3">Reason</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Date</th><th className="px-4 py-3">Status</th><th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Action</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">No requests.</td></tr>
              ) : pg.slice.map((r) => {
                const hot = actionable(r);
                const pill = reqPill(r);
                return (
                <tr key={r.id} className={cn("border-b border-border last:border-0", hot && "bg-amber-50/40")}>
                  <td className={cn("px-4 py-3", hot && "shadow-[inset_3px_0_0_#f59e0b]")}>
                    <span className="inline-flex items-center gap-2">
                      {hot && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                      {r.workshop_name}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{r.material_name}</td>
                  <td className="px-4 py-3 text-center tabular-nums">{r.qty_requested}</td>
                  <td className="px-4 py-3 text-muted">{r.reason ?? "—"}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-muted">{r.created_at ?? "—"}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1", pill.cls)}>{pill.label}</span>
                  </td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center">
                    {/pending|approved/.test(r.status) ? (
                      <div className="flex justify-center gap-1.5">
                        <button onClick={() => openFulfill(r)} disabled={pending} className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-accent hover:opacity-90 disabled:opacity-50">Order</button>
                        <button onClick={() => doReject(r)} disabled={pending} className="rounded-lg border border-rose-200 px-2 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">✕</button>
                      </div>
                    ) : r.status === "partial" && !r.ops_followed_up ? (
                      <button onClick={() => doFollowUp(r)} disabled={pending} className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50">Follow up</button>
                    ) : r.status === "partial" && r.ops_followed_up ? (
                      <span className="text-xs text-emerald-600">✓ Followed up</span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PaginationFooter {...pg} />
      </div>

      <Modal open={!!fulfilling} onClose={() => setFulfilling(null)} title="Order Request" description={fulfilling ? `${fulfilling.workshop_name} · ${fulfilling.material_name}` : ""}
        footer={<div className="flex justify-end gap-2">
          <button onClick={() => setFulfilling(null)} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-stone-100">Cancel</button>
          <button onClick={doFulfill} disabled={pending} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-accent hover:opacity-90 disabled:opacity-50">{pending ? "Saving…" : "Order → send to workshop"}</button>
        </div>}>
        {fulfilling && (
          <div className="space-y-3">
            <p className="text-sm text-muted">Requested: <b className="text-foreground">{fulfilling.qty_requested}</b>. Workshop will <b>receive</b> it to add stock.</p>
            <label className="block text-sm font-medium">Qty to order
              <input type="number" min={0} value={qtyVal} onChange={(e) => setQtyVal(e.target.value)} className={cn(inp, "mt-1 w-full")} />
            </label>
            {err && <p className="text-sm text-rose-600">{err}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

const UNITS = ["pcs", "set", "board", "roll", "sheet", "yard", "meter", "kg", "liter", "gallon", "box", "pack", "bottle"];

// ASSIGN MASTERLIST — ang masterlist ay ang lahat ng UNIQUE materials sa
// lahat ng workshops (dedup by name). Pumili ng target workshop + mga materials
// → isang click na kopya (ang mga nasa target na ay naka-gray at nilalaktawan).
function AssignMasterlistModal({ data, onClose }: { data: OperationsData; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<number | "">("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  // per-item override ng Manager stock-out only (default = source value).
  const [lockOverride, setLockOverride] = useState<Record<number, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  // Masterlist: unang instance bawat unique name (alinmang workshop ang pinagmulan).
  const master = useMemo(() => {
    const seen = new Map<string, MaterialRow>();
    for (const m of data.materials) if (!seen.has(norm(m.name))) seen.set(norm(m.name), m);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.materials]);
  const inTarget = useMemo(() => {
    if (!target) return new Set<string>();
    return new Set(data.materials.filter((m) => m.workshop_id === target).map((m) => norm(m.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.materials, target]);
  const available = master.filter((m) => !inTarget.has(norm(m.name)));

  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = available.length > 0 && available.every((m) => picked.has(m.id));

  const submit = () => {
    if (!target) { setMsg("Pick a target workshop."); return; }
    const ids = available.filter((m) => picked.has(m.id)).map((m) => m.id);
    if (!ids.length) { setMsg("Pick at least one material."); return; }
    setMsg(null);
    start(async () => {
      const res = await assignMaterials({ targetWorkshopId: Number(target), materialIds: ids, managerOnly: lockOverride });
      if ("error" in res) { setMsg(res.error); return; }
      setMsg(`✓ Assigned ${res.copied} material${res.copied === 1 ? "" : "s"}${res.skipped ? ` · ${res.skipped} skipped (already there)` : ""}.`);
      setPicked(new Set());
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-sm font-bold">Assign Masterlist</h3>
          <p className="mt-0.5 text-xs text-muted">Copy materials to a workshop in one click — duplicates are skipped automatically.</p>
        </div>
        <div className="space-y-3 overflow-y-auto p-5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Target workshop</span>
            <select value={target} onChange={(e) => { setTarget(e.target.value ? Number(e.target.value) : ""); setPicked(new Set()); setMsg(null); }} className={cn(inp, "w-full")}>
              <option value="">— select workshop —</option>
              {data.workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          {target !== "" && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">Masterlist ({available.length} available{inTarget.size ? ` · ${inTarget.size} already in this workshop` : ""})</span>
                <button type="button" onClick={() => setPicked(allPicked ? new Set() : new Set(available.map((m) => m.id)))}
                  className="text-xs font-semibold text-primary hover:underline">{allPicked ? "Unselect all" : "Select all"}</button>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border bg-stone-50/60 p-1.5">
                {master.map((m) => {
                  const taken = inTarget.has(norm(m.name));
                  const on = picked.has(m.id);
                  const locked = m.id in lockOverride ? lockOverride[m.id] : m.manager_only;
                  return (
                    <div key={m.id}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left",
                        taken ? "border-transparent opacity-45" : on ? "border-primary bg-[#efe9d8]" : "border-border bg-surface hover:bg-stone-100",
                      )}>
                      <button type="button" disabled={taken} onClick={() => toggle(m.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-not-allowed">
                        <Thumbnail name={m.name} url={m.image_url} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{m.name}</span>
                          <span className="block text-[10px] text-muted">{m.unit}{m.category ? ` · ${m.category}` : ""}</span>
                        </span>
                        {taken ? <span className="text-[10px] font-semibold text-muted">already added</span> : on ? <span className="text-primary">✓</span> : null}
                      </button>
                      {/* Manager stock-out only — toggle bago i-assign */}
                      {!taken && (
                        <button type="button" onClick={() => setLockOverride((p) => ({ ...p, [m.id]: !locked }))}
                          title={locked ? "Manager stock-out only — click to make it available to everyone" : "Available to everyone — click to make it Manager stock-out only"}
                          className={cn(
                            "shrink-0 rounded-md px-1.5 py-0.5 text-xs ring-1 ring-inset",
                            locked ? "bg-amber-100 text-amber-700 ring-amber-300" : "bg-stone-100 text-stone-400 ring-stone-200 hover:text-stone-600",
                          )}>
                          
                        </button>
                      )}
                    </div>
                  );
                })}
                {master.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted">No materials yet — add some first.</p>}
              </div>
            </>
          )}
          {msg && <p className={cn("text-xs font-medium", msg.startsWith("✓") ? "text-emerald-700" : "text-red-600")}>{msg}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Close</button>
          <button type="button" onClick={submit} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:opacity-90 disabled:opacity-60">{pending ? "Assigning…" : "Assign"}</button>
        </div>
      </div>
    </div>
  );
}
const stockBadge = (onHand: number, low: number) => (low > 0 && onHand <= low) ? "Critical" : (low > 0 && onHand <= low * 1.2) ? "Near" : "Good";

function MaterialsTab({ data }: { data: OperationsData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ws, setWs] = useState("");
  const [modal, setModal] = useState<{ mode: "add" } | { mode: "edit"; m: MaterialRow } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const rows = useMemo(() => data.materials.filter((m) => !ws || String(m.workshop_id) === ws), [data.materials, ws]);
  const pg = usePagination(rows, 25);
  const del = (m: MaterialRow) => { if (!confirm(`Remove the material "${m.name}"?`)) return; start(async () => { await deleteMaterial(m.id); router.refresh(); }); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={ws} onChange={(e) => setWs(e.target.value)} className={cn(inp, "w-44")}>
          <option value="">All Workshops</option>
          {data.workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <button onClick={() => setAssignOpen(true)} className="ml-auto rounded-lg border border-[#caa45a] bg-surface px-3 py-2 text-sm font-semibold text-[#5c421f] hover:bg-[#faf6ec]">Assign Masterlist</button>
        <button onClick={() => setModal({ mode: "add" })} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-accent hover:opacity-90">+ Add Material</button>
      </div>
      {assignOpen && <AssignMasterlistModal data={data} onClose={() => setAssignOpen(false)} />}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&>th]:sticky [&>th]:top-0 [&>th]:bg-[#4a3b1a]">
                <th colSpan={4} className="border-b border-[#caa45a] px-5 py-2">Material</th>
                <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Status</th>
                <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2"></th>
              </tr>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&>th]:sticky [&>th]:top-[33px] [&>th]:bg-[#5a4a26]">
                <th className="px-4 py-2">Workshop</th><th className="px-4 py-2">Material</th>
                <th className="px-4 py-2">Unit</th><th className="px-4 py-2">On Hand</th><th className="!border-l-4 !border-l-[#caa45a] px-4 py-2">Status</th><th className="!border-l-4 !border-l-[#caa45a] px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">No materials. Click <b>+ Add Material</b>.</td></tr>
              ) : pg.slice.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">{m.workshop_name}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center justify-center gap-2"><Thumbnail name={m.name} url={m.image_url} /><span className="font-medium">{m.name}</span>{m.manager_only && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200" title="Manager stock-out only"></span>}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{m.unit}</td>
                  <td className="px-4 py-2.5 font-semibold tabular-nums">{m.on_hand}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-2.5 text-xs font-semibold">{stockBadge(m.on_hand, m.low_threshold)}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-2.5">
                    <div className="flex justify-center gap-1.5">
                      <button onClick={() => setModal({ mode: "edit", m })} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-stone-100">Edit</button>
                      <button onClick={() => del(m)} disabled={pending} className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationFooter {...pg} />
      </div>
      {modal && <MaterialModal workshops={data.workshops} defaultWs={ws ? Number(ws) : (data.workshops[0]?.id ?? 0)} material={modal.mode === "edit" ? modal.m : null} onClose={() => setModal(null)} />}
    </div>
  );
}

function MaterialModal({ workshops, defaultWs, material, onClose }: { workshops: { id: number; name: string }[]; defaultWs: number; material: MaterialRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [wsId, setWsId] = useState<number>(material?.workshop_id ?? defaultWs);
  const [f, setF] = useState({
    name: material?.name ?? "", barcode: material?.barcode ?? "", unit: material?.unit ?? "pcs",
    category: material?.category ?? "", low_threshold: String(material?.low_threshold ?? 0), price: String(material?.price ?? 0),
  });
  const [managerOnly, setManagerOnly] = useState<boolean>(material?.manager_only ?? false);
  const [img, setImg] = useState<string[]>(material?.image_url ? [material.image_url] : []);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string | number) => setF((p) => ({ ...p, [k]: v }));
  const save = () => start(async () => {
    const res = await saveMaterial({
      id: material?.id ?? null, workshop_ids: [wsId],
      name: f.name, barcode: f.barcode || null, unit: f.unit, category: f.category || null,
      low_threshold: Number(f.low_threshold), price: Number(f.price), image_url: img[0] ?? null,
      manager_only: managerOnly,
    });
    if ("error" in res) { setErr(res.error); return; }
    onClose(); router.refresh();
  });
  return (
    <Modal open onClose={onClose} title={material ? "Edit Material" : "Add Material"} description="Per-workshop raw material"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-stone-100">Cancel</button>
        <button onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-accent hover:opacity-90 disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
      </div>}>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-sm font-medium">Workshop</p>
          <AssignDropdown current={workshops.find((w) => w.id === wsId)?.name} workshops={workshops} onPick={setWsId} />
        </div>
        <label className="block text-sm font-medium">Name<input value={f.name} onChange={(e) => set("name", e.target.value)} className={cn(inp, "mt-1 w-full")} autoFocus /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">Unit
            <select value={f.unit} onChange={(e) => set("unit", e.target.value)} className={cn(inp, "mt-1 w-full")}>
              {UNITS.map((u) => <option key={u} value={u}>{u[0].toUpperCase() + u.slice(1)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Low at<input type="number" min={0} value={f.low_threshold} onChange={(e) => set("low_threshold", e.target.value)} className={cn(inp, "mt-1 w-full")} /></label>
        </div>
        <label className="block text-sm font-medium">Price (₱)<input type="number" min={0} step="0.01" value={f.price} onChange={(e) => set("price", e.target.value)} placeholder="0.00" className={cn(inp, "mt-1 w-full")} /></label>
        <label className="flex items-start gap-2.5 rounded-lg border border-border bg-stone-50 px-3 py-2.5 cursor-pointer">
          <input type="checkbox" checked={managerOnly} onChange={(e) => setManagerOnly(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#4a3b1a]" />
          <span>
            <span className="block text-sm font-medium">Manager stock-out only</span>
            <span className="block text-xs text-muted">Hidden from the per-job Materials Used picker. The workshop account stock-outs it via the Manager Stock-Out button (e.g. screws, bolts, nails).</span>
          </span>
        </label>
        <div><p className="mb-1 text-sm font-medium">Image</p><MultiImageUpload value={img} onChange={setImg} folder={`workshop-materials/${wsId}`} /></div>
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}
