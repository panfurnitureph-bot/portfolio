"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatCard, cn, SpecRows, isReworkItem, ReworkTag } from "./ui";
import { SpecFieldsView } from "./spec-fields-input";
import { firstWithoutWorker, type WorkerLite } from "@/lib/workshop/workers";
import { Modal } from "./modal";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { Thumbnail } from "./thumbnail";
import type { WorkshopData, WMaterial, WJob, WRequest, WLog } from "@/app/workshop/data";
import { updateJobStatus, createRequest, scanCommit, receiveStockRequest, managerStockOut } from "@/app/workshop/actions";
import { RushBadge } from "./rush-badge";

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";

export type WSSection = "jobs" | "rework" | "inventory" | "logs" | "requests";

// Liquids (paint/rugby/solignum) are bought & used by the gallon/liter — allow
// fractional amounts. Show ¼/½/¾ quick-pick chips for these units.
const isLiquid = (unit?: string | null) => /gallon|liter|litre|can/i.test(unit || "");
const FRACTIONS: [string, number][] = [["¼", 0.25], ["½", 0.5], ["¾", 0.75], ["1", 1]];

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
  return "bg-amber-100 text-amber-700";
}
const jobLabel = (s: string) => ({ pending: "Pending", accepted: "Accepted", in_progress: "In Progress", done: "Done", delivered: "Delivered" }[s] ?? s);
const stockBadge = (s: WMaterial["status"]) => s === "low" ? "Critical" : s === "near" ? "Near" : "Good";
const stockCls = (s: WMaterial["status"]) => s === "low" ? "text-rose-600" : s === "near" ? "text-amber-600" : "text-emerald-600";

// "2026-08-23 17:52" → "Aug 23, 5:52 PM". Kung hindi mabasa, ang orihinal.
function logStamp(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts.replace(" ", "T"));
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function WorkshopManager({ data, currentUser, section }: { data: WorkshopData; currentUser: string; section: WSSection }) {
  const router = useRouter();

  if (!data.active) {
    return <div className="rounded-xl border border-border bg-surface p-8 text-center text-muted">No workshop. Seed one in the migration first.</div>;
  }
  const wsId = data.active.id;

  return (
    <div className="space-y-5">
      {/* Workshop selector — hidden on My Jobs / Rework Jobs (read-only boards). */}
      {section !== "jobs" && section !== "rework" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <select value={wsId} onChange={(e) => router.push(`/workshop/${section}?ws=${e.target.value}`)} className={cn(inp, "w-56 font-medium")}>
            {data.workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      )}

      <div className="apk-hide grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active Jobs" value={String(data.kpi.activeJobs)} tone="info" />
        <StatCard label="Low Stock" value={String(data.kpi.low)} tone={data.kpi.low ? "danger" : undefined} />
        <StatCard label="My Requests" value={String(data.kpi.pendingReq)} tone={data.kpi.pendingReq ? "warning" : undefined} />
        <StatCard label="Materials" value={String(data.kpi.materials)} />
      </div>

      {section === "jobs" && <JobsTab data={data} currentUser={currentUser} mode="normal" />}
      {section === "rework" && <JobsTab data={data} currentUser={currentUser} mode="rework" />}
      {section === "inventory" && <InventoryTab data={data} wsId={wsId} currentUser={currentUser} />}
      {section === "logs" && <LogsTab data={data} />}
      {section === "requests" && <RequestsTab data={data} wsId={wsId} currentUser={currentUser} />}
    </div>
  );
}

function JobsTab({ data, currentUser, mode = "normal" }: { data: WorkshopData; currentUser: string; mode?: "normal" | "rework" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<WJob | null>(null);
  // APPROVED na Design Details — buong-lapad na viewer (hiling 2026-08-17).
  // MULTI-PAGE viewer (2026-08-19) — magkakadugtong ang sheets pababa.
  const [viewSheet, setViewSheet] = useState<{ title: string; pages: { url: string; label: string }[] } | null>(null);
  // DEDICATED na page ang REWORK jobs (sidebar: Rework Jobs, sa ilalim ng My
  // Jobs) — parehong table/modal, hiwalay lang ang laman para hindi maghalo ang
  // production at repairs.
  const scoped = useMemo(
    () => data.jobs.filter((j) => (mode === "rework" ? isReworkItem(j.item_desc) : !isReworkItem(j.item_desc))),
    [data.jobs, mode],
  );
  // DALAWANG TANAW (hiling 2026-08-28). Ang naihatid na ay nananatili sa
  // listahan, kaya ang gagawin pa ay nakahalo sa mga tapos na buwan-buwan.
  // Ang "Pending" ang gawain; ang "Completed" ay talaan.
  const [tab, setTab] = useState<"open" | "done">("open");
  // KASAMA ANG "Received" (2026-09-01, "naiipon kase"): ang na-stock-in na sa
  // bodega — stock build, to-warehouse, refund pull-out — ay tapos na sa
  // kamay ng workshop; wala nang "Delivered" na darating sa marami sa kanila,
  // kaya nakabaon sila sa Pending habambuhay kung hindi ito kasama.
  const isDone = (j: WJob) => /delivered|completed|received/i.test(j.status ?? "");
  const jobs = useMemo(
    () => scoped.filter((j) => (tab === "done" ? isDone(j) : !isDone(j))),
    [scoped, tab],
  );
  const doneCount = useMemo(() => scoped.filter(isDone).length, [scoped]);
  const openCount = scoped.length - doneCount;
  const pg = usePagination(jobs, 25);

  // Job lifecycle. Only "In Progress" is set here; the rest advance from their own
  // modules (QC approval → QC Passed, Delivery → Out for Delivery, Installation, Delivered).
  const STEPS: [string, string][] = [["in_progress", "In Progress"], ["QC Passed", "QC Passed"], ["Out for Delivery", "Out for Delivery"], ["Arrived", "Arrived"], ["Installation", "Installation"], ["delivered", "Delivered"]];
  // current stage index, tolerant of casing / module-set values.
  const statusStep = (s: string): number => {
    const v = (s || "").toLowerCase();
    if (/deliver(ed)?$/.test(v) || v === "delivered") return 5;
    if (/install/.test(v)) return 4;
    if (/arrived/.test(v)) return 3;
    if (/out for delivery|^ofd$/.test(v)) return 2;
    if (/qc passed/.test(v)) return 1;
    return 0; // pending / accepted / in_progress / for approval hr → In Progress stage
  };

  return (
    <>
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <p className="text-sm text-muted">{jobs.length} job{jobs.length === 1 ? "" : "s"}</p>
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
        <table className="w-full xl:min-w-[1080px] border-collapse text-[11px] xl:text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
          <colgroup>
            <col span={mode === "rework" ? 3 : 2} />
            <col span={4} />
            <col span={4} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&_th]:bg-[#4a3b1a]">
              <th colSpan={mode === "rework" ? 3 : 2} className="border-b border-[#caa45a] px-5 py-2">Order</th>
              <th colSpan={4} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Details</th>
              <th colSpan={4} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Status</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&_th]:bg-[#5a4a26]">
            <th className="px-4 py-3">Order #</th>{mode === "rework" && <th className="px-4 py-3">RMA #</th>}<th className="px-4 py-3">Product</th>
            <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">SKU</th><th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Color</th><th className="px-4 py-3">Specs</th>
            <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Qty</th><th className="px-4 py-3">Dispatched</th>
            <th className="px-4 py-3">Status</th><th className="px-4 py-3">Route</th>
          </tr></thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr><td colSpan={mode === "rework" ? 11 : 10} className="px-4 py-12 text-center text-muted">{mode === "rework" ? "No rework jobs for this workshop." : "No jobs assigned."}</td></tr>
            ) : pg.slice.map((j) => (
              <tr key={j.id} onClick={() => setPreview(j)} className="cursor-pointer border-b border-border last:border-0 hover:bg-stone-50">
                <td className="px-4 py-3 font-medium">
                  <div className="flex flex-col items-center gap-1">
                    <RushBadge isRush={j.is_rush} dateOrder={j.date_order} threshold={j.rush_days ?? data.rushThreshold} />
                    {/* Walang order ang stock build — sinasabi ng tag kung bakit,
                        sa halip na gitling na walang paliwanag. */}
                    {j.stock_request
                      ? <span className="whitespace-nowrap rounded-full bg-[#4a3b1a] px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-[#f4ead8]" title={j.stock_reason ?? "Built for stock — no order"}>STOCK</span>
                      : <span>{j.order_number ?? "—"}</span>}
                  </div>
                </td>
                {/* Rework Jobs: sariling RMA # column — walang badge sa Product cell. */}
                {mode === "rework" && (
                  <td className="px-4 py-3 text-[11px] font-bold text-amber-700">{j.rma_no ?? ((j.item_desc ?? "").match(/rma-\d+/i)?.[0]?.toUpperCase() ?? "—")}</td>
                )}
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-2">
                    {j.image_url
                      ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={j.image_url} alt="" className="h-9 w-9 shrink-0 rounded object-cover ring-1 ring-border" />
                      : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-stone-100 text-[10px] text-muted">—</div>}
                    <div className="min-w-0">
                      <span className="block max-w-[240px] truncate" title={j.item_desc ?? ""}>{(j.item_desc ?? "—").split("\n")[0].replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "")}</span>
                    </div>
                  </div>
                </td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-muted">{j.sku ?? "—"}</td>
                <td className="px-4 py-3 text-muted">{j.category ?? "—"}</td>
                <td className="px-4 py-3 text-muted">{j.color ?? "—"}</td>
                {/* WALANG "Parts" NA HANAY (Joe 2026-09-06, "sa lahat ng rework alisin
                    ung column ng Parts") — ang mga piyesa ay nasa Product Details. */}
                {/* SPECS sa halip na Dimension (2026-08-19) — unang 2 linya ng
                    dispatched description; buo sa hover at sa Product Details. */}
                <td className="px-4 py-3 text-left text-xs text-muted">
                  {(() => {
                    const lines = (j.item_desc ?? "").split("\n").slice(1).map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/^[•·\-\s]+/, ""));
                    if (!lines.length) return <div className="text-center">{j.dimension ?? "—"}</div>;
                    return (
                      <div className="mx-auto max-w-[200px] leading-tight" title={lines.join("\n")}>
                        {lines.slice(0, 2).map((s, i) => <div key={i} className="truncate">• {s}</div>)}
                        {lines.length > 2 && <div className="text-[10px] text-muted/70">+{lines.length - 2} more…</div>}
                      </div>
                    );
                  })()}
                </td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center tabular-nums">{j.qty}</td>
                <td className="px-4 py-3 text-muted">{j.dispatched_at ?? "—"}</td>
                <td className="px-4 py-3 text-center"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", jobPill(j.status))}>{jobLabel(j.status)}</span></td>
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

      <Modal open={!!preview} onClose={() => setPreview(null)} title="Product Details" description={preview?.order_number ?? undefined} size="3xl">
        {preview && (
          <div className="grid gap-5 md:grid-cols-3">
            {/* LEFT — product details + status */}
            <div className="flex flex-col gap-3 overflow-hidden rounded-xl border border-[#e6dcc4] bg-stone-50/50 p-0 shadow-sm">
              <div className="flex items-center gap-2.5 border-b border-[#e6dcc4] bg-[#4a3b1a] px-4 py-2.5">

                <div>
                  <div className="text-sm font-semibold text-white">Product</div>
                  <div className="text-[11px] text-[#e7dcc4]">What to build · specs</div>
                </div>
              </div>
              <div className="space-y-3 px-3 pb-3">
              {/* Rework banner — the tag + RMA number live UP HERE, so the Product
                  row below stays the clean product name. */}
              {isReworkItem(preview.item_desc) && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <ReworkTag />
                  <span className="text-sm font-bold text-amber-800">{preview.rma_no ?? ((preview.item_desc ?? "").match(/rma-\d+/i)?.[0]?.toUpperCase() ?? "RMA")}</span>
                  <span className="ml-auto text-[11px] text-amber-700">Repair job</span>
                </div>
              )}
              <div className="overflow-hidden rounded-xl border border-border bg-white">
                {preview.image_url
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={preview.image_url} alt="" className="mx-auto max-h-52 w-full object-contain p-2" />
                  : <div className="flex h-40 items-center justify-center text-muted">No image</div>}
              </div>
              {/* HEADER + GUIDED SPECS (2026-08-19) — parehong itsura ng Add/Edit
                  Product: SKU · auto | Category | Product Type, Product/Name,
                  tapos ang guided spec cards (SpecFieldsView). Sanitized ang
                  category/color — sa lumang jobs, spec lines ang laman nila. */}
              {(() => {
                const clean = (v: string | null | undefined) => { const s = (v ?? "").trim(); return s && !s.includes(":") ? s : null; };
                const specsText = (preview.item_desc ?? "").split("\n").slice(1).map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^[•·\-\s]+/, "")).join("\n");
                const hasFabric = /^(Fabric(\s*\/\s*Finish)?|Upholstered Finish):/m.test(specsText);
                const cat = clean(preview.category);
                const ptype = (preview.product_type ?? "").toLowerCase() === "imported" ? "Imported" : "Local";
                const lbl = "mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]";
                const ro = "w-full rounded-lg border border-border bg-stone-100 px-3 py-2 text-xs text-muted";
                const rows: [string, string | null][] = [
                  ...(!hasFabric && clean(preview.color) ? [["Color", clean(preview.color)] as [string, string | null]] : []),
                  ...(clean(preview.dimension) ? [["Dimension", preview.dimension ?? null] as [string, string | null]] : []),
                  ...(preview.frame?.trim() ? [["Add-ons", preview.frame] as [string, string | null]] : []),
                ];
                return (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div><span className={lbl}>SKU · auto</span><input value={preview.sku ?? "—"} readOnly className={cn(ro, "font-mono")} /></div>
                      <div><span className={lbl}>Category</span><input value={cat ?? "—"} readOnly className={ro} /></div>
                      <div>
                        <span className={lbl}>Product Type</span>
                        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border">
                          {(["Local", "Imported"] as const).map((t, ti) => (
                            <span key={t} className={`px-1 py-1.5 text-center text-[11px] font-bold ${ti > 0 ? "border-l border-border" : ""} ${ptype === t ? (t === "Imported" ? "bg-blue-700 text-white" : "bg-emerald-700 text-white") : "bg-surface text-muted"}`}>
                              {t}{ptype === t ? " ✓" : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div>
                      <span className={lbl}>Product / Name</span>
                      <input value={(preview.item_desc ?? "").split("\n")[0].replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "") || "—"} readOnly className={cn(ro, "text-sm text-foreground")} />
                    </div>
                    {/* Kaparehong hulma ng Product / Name (2026-08-23) — dating
                        hilera sa SpecRows, kaya iba ang anyo sa mga kahon sa
                        itaas nito. */}
                    <div>
                      <span className={lbl}>Qty</span>
                      <input value={String(preview.qty)} readOnly className={cn(ro, "text-sm text-foreground")} />
                    </div>
                    {rows.length > 0 && <SpecRows items={rows} />}
                    {/* FLAT - iisang SPECIFICATIONS na card, ang naitala lang (hiling 2026-08-23). Ang template (Measurements/Details, unit chips, pills) ay para sa builder; dito ay TALA ang tinitingnan, at dapat iisa ang anyo kahit may template ang category (Sofa, Ottoman) o wala (Custom Bed). */}
                    <SpecFieldsView category={cat ?? ""} specs={specsText} />
                  </>
                );
              })()}
              {/* Badge lang — tanggal ang redundant na "RUSH" label (2026-08-19). */}
              {preview.order_id != null && preview.is_rush && (
                <div className="flex items-center border-t border-border pt-3">
                  <RushBadge isRush={preview.is_rush} dateOrder={preview.date_order} threshold={preview.rush_days ?? data.rushThreshold} />
                </div>
              )}
              <div className="border-t border-border pt-3">
                <div className="mb-2 text-[11px] uppercase tracking-wide text-muted">Update Status</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {STEPS.map(([val, label], i) => {
                    const cur = statusStep(preview.status);
                    const done = i < cur;
                    const active = i === cur;
                    const manual = val === "in_progress"; // only this stage is settable from the Workshop
                    return (
                      <button key={val} disabled={pending || active || !manual}
                        onClick={() => manual && start(async () => { await updateJobStatus(preview.id, val); setPreview(null); router.refresh(); })}
                        title={manual ? label : `${label} — set automatically by its module`}
                        className={cn("flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold transition-colors disabled:cursor-default",
                          active ? "bg-[#4a3b1a] text-white ring-2 ring-[#caa45a]"
                            : done ? "bg-emerald-100 text-emerald-700"
                            : manual ? "border border-border bg-white text-muted hover:bg-stone-100"
                            : "border border-dashed border-border bg-white text-muted/70")}>
                        {done ? "✓" : active ? "●" : i + 1} {label}
                      </button>
                    );
                  })}
                  {/* Route badge at the end of the status row */}
                  <span className="mx-0.5 text-muted">→</span>
                  <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset",
                    (preview.fulfillment ?? "warehouse") === "pickup" ? "bg-sky-50 text-sky-700 ring-sky-200" : "bg-amber-50 text-amber-700 ring-amber-200")}>
                    {(preview.fulfillment ?? "warehouse") === "pickup" ? "Direct Pickup" : "Warehouse"}
                  </span>
                </div>
                <p className="mt-1.5 text-[10px] text-muted">Route set at QC declaration. {(preview.fulfillment ?? "warehouse") === "pickup" ? "Direct pickup → straight to Delivery Scheduling." : "Warehouse → Receiving QC → Delivery Scheduling."}</p>
              </div>
              </div>
            </div>
            {/* MIDDLE — materials used picker (from this workshop's inventory) */}
            <MaterialsUsedPanel materials={data.materials} workers={data.workers} wsId={data.active!.id} job={preview} currentUser={currentUser} onDone={() => setPreview(null)}
              footer={<DesignSheetCard preview={preview} designByOrder={data.designByOrder} onOpen={setViewSheet} />} />
            {/* RIGHT — usage history for this order */}
            <UsageHistory logs={data.logs} job={preview} />
          </div>
        )}
      </Modal>

      {/* Buong-lapad na viewer ng APPROVED na Design Details sheet. */}
      {viewSheet && (
        <Modal
          open
          onClose={() => setViewSheet(null)}
          title={viewSheet.title}
          size="2xl"
          footer={<div className="flex justify-end"><button type="button" onClick={() => setViewSheet(null)} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90">Close</button></div>}
        >
          {/* MULTI-PAGE: bawat sheet magkakadugtong pababa; PDF = malinis na
              iframe (walang viewer chrome), image = <img>. */}
          <div className="space-y-6">
            {viewSheet.pages.map((p, i) => (
              <div key={p.url}>
                {viewSheet.pages.length > 1 && (
                  <div className="mb-1 flex items-center gap-2 text-xs">
                    <span className="rounded bg-[#4a3b1a] px-1.5 py-0.5 font-extrabold text-[#f4ead8]">{i + 1}</span>
                    <span className="font-mono font-semibold">{p.label}</span>
                  </div>
                )}
                {/\.pdf($|\?)/i.test(p.url) ? (
                  <iframe src={`${p.url}#toolbar=0&navpanes=0&view=Fit`} title={p.label} className="mx-auto h-[80vh] w-full max-w-[900px] rounded-lg border border-border bg-white" />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={p.url} alt={p.label} className="mx-auto w-full max-w-[900px] rounded-lg border border-border bg-white" />
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
    </>
  );
}

function InventoryTab({ data, wsId, currentUser }: { data: WorkshopData; wsId: number; currentUser: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reqMat, setReqMat] = useState<WMaterial | null>(null);
  const [reqQty, setReqQty] = useState("");
  const [reqReason, setReqReason] = useState("Low stock");
  const [mgrOpen, setMgrOpen] = useState(false);
  const pg = usePagination(data.materials, 25);
  const restricted = data.materials.filter((m) => m.manager_only);

  // Reset the request form whenever a new material is picked.
  const openReq = (m: WMaterial) => { setReqQty(String(Math.max(m.low_threshold, 1))); setReqReason("Low stock"); setReqMat(m); };

  return (
    <div className="space-y-3">
      {restricted.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
          <p className="text-sm text-amber-800"><b>{restricted.length}</b> manager-only material{restricted.length !== 1 ? "s" : ""} (screws, bolts, nails…) — not in the per-job picker.</p>
          <button onClick={() => setMgrOpen(true)} className="rounded-lg bg-[#4a3b1a] px-3 py-2 text-sm font-semibold text-white hover:opacity-90">Manager Stock-Out</button>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
            <colgroup>
              <col span={3} />
              <col span={2} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&_th]:bg-[#4a3b1a]">
                <th colSpan={3} className="border-b border-[#caa45a] px-5 py-2">Material</th>
                <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Status</th>
              </tr>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&_th]:bg-[#5a4a26]">
              <th className="px-4 py-3">Material</th>
              <th className="px-4 py-3">Unit</th><th className="px-4 py-3">On Hand</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Status</th><th className="px-4 py-3">Action</th>
            </tr></thead>
            <tbody>
              {data.materials.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-muted">No materials yet. Add them in <b>Operations → Materials</b>.</td></tr>
              ) : pg.slice.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">
                    <span className="flex items-center justify-center gap-2"><Thumbnail name={m.name} url={m.image_url} /><span>{m.name}</span>{m.manager_only && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200" title="Manager stock-out only">MGR</span>}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">{m.unit}</td>
                  <td className="px-4 py-3 text-center tabular-nums font-semibold">{m.on_hand}</td>
                  <td className={cn("!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center text-xs font-semibold", stockCls(m.status))}>{stockBadge(m.status)}</td>
                  <td className="px-4 py-3 text-center">
                    {m.status === "low"
                      ? <button onClick={() => openReq(m)} className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-200">Request</button>
                      : <span className="text-xs text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationFooter {...pg} />
      </div>

      <Modal open={!!reqMat} onClose={() => setReqMat(null)} title="Request Stock" description={reqMat?.name}
        footer={<div className="flex justify-end gap-2">
          <button onClick={() => setReqMat(null)} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-stone-100">Cancel</button>
          <RequestBtn mat={reqMat} wsId={wsId} currentUser={currentUser} pending={pending} start={start} qty={reqQty} reason={reqReason} onDone={() => { setReqMat(null); router.refresh(); }} />
        </div>}>
        {reqMat && <RequestBody mat={reqMat} qty={reqQty} setQty={setReqQty} reason={reqReason} setReason={setReqReason} />}
      </Modal>

      {mgrOpen && <ManagerStockOutModal materials={restricted} wsId={wsId} currentUser={currentUser} onClose={() => setMgrOpen(false)} onDone={() => { setMgrOpen(false); router.refresh(); }} />}
    </div>
  );
}

// Manager stock-out modal — consume restricted (manager_only) materials without
// tying them to a job. Only reachable from the Inventory tab's Manager Stock-Out button.
function ManagerStockOutModal({ materials, wsId, currentUser, onClose, onDone }: { materials: WMaterial[]; wsId: number; currentUser: string; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [lines, setLines] = useState<Record<number, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const setQty = (m: WMaterial, q: number) => setLines((p) => ({ ...p, [m.id]: Math.max(0, Math.min(q, m.on_hand)) }));
  const picked = materials.filter((m) => (lines[m.id] ?? 0) > 0);

  const commit = () => {
    if (!picked.length) { setErr("Set a quantity on at least one material."); return; }
    setErr(null);
    start(async () => {
      const res = await managerStockOut({ workshop_id: wsId, by: currentUser, lines: picked.map((m) => ({ material_id: m.id, qty: lines[m.id] })) });
      if ("error" in res) { setErr(res.error); return; }
      onDone();
    });
  };

  return (
    <Modal open onClose={onClose} title="Manager Stock-Out" description="Restricted materials — consumed by the workshop account, not tied to a job."
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-stone-100">Cancel</button>
        <button onClick={commit} disabled={pending || !picked.length} className="rounded-lg bg-[#4a3b1a] px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{pending ? "Saving…" : `Stock Out (${picked.length})`}</button>
      </div>}>
      <div className="space-y-2">
        {materials.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No manager-only materials.</p>
        ) : materials.map((m) => {
          const liquid = isLiquid(m.unit);
          const step = liquid ? 0.25 : 1;
          const q = lines[m.id] ?? 0;
          const out = m.on_hand <= 0;
          return (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              {m.image_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={m.image_url} alt="" className="h-9 w-9 shrink-0 rounded object-cover ring-1 ring-border" /> : <div className="h-9 w-9 shrink-0 rounded bg-stone-100" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.name}</div>
                <div className="text-[11px] text-muted">On hand: {m.on_hand} {m.unit}</div>
              </div>
              {out ? (
                <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">OUT</span>
              ) : (
                <div className="flex items-center gap-1">
                  <button onClick={() => setQty(m, q - step)} disabled={q <= 0} className="h-7 w-7 rounded border border-border text-sm hover:bg-stone-100 disabled:opacity-40">−</button>
                  <input value={q} onChange={(e) => setQty(m, Number(e.target.value) || 0)} className="h-7 w-14 rounded border border-border text-center text-sm" />
                  <button onClick={() => setQty(m, q + step)} className="h-7 w-7 rounded border border-border text-sm hover:bg-stone-100">+</button>
                </div>
              )}
            </div>
          );
        })}
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}


function RequestBody({ mat, qty, setQty, reason, setReason }: { mat: WMaterial; qty: string; setQty: (v: string) => void; reason: string; setReason: (v: string) => void }) {
  const liquid = isLiquid(mat.unit);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">On hand: <b className="text-foreground">{mat.on_hand} {mat.unit}</b> · low at {mat.low_threshold} {mat.unit}</p>
      <label className="block text-sm font-medium">Qty <span className="font-normal text-muted">(in {mat.unit})</span>
        <input type="number" min={0} step={liquid ? 0.25 : 1} value={qty} onChange={(e) => setQty(e.target.value)} className={cn(inp, "mt-1 w-full")} autoFocus />
      </label>
      {liquid && (
        <div className="flex flex-wrap gap-1.5">
          {FRACTIONS.map(([label, val]) => (
            <button key={label} type="button" onClick={() => setQty(String((Number(qty) || 0) + val))}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-semibold hover:bg-stone-100">+{label}</button>
          ))}
          <button type="button" onClick={() => setQty("0")} className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm text-muted hover:bg-stone-100">Clear</button>
        </div>
      )}
      <label className="block text-sm font-medium">Reason
        <select value={reason} onChange={(e) => setReason(e.target.value)} className={cn(inp, "mt-1 w-full")}>
          {["Low stock", "Urgent job", "Restock", "Other"].map((r) => <option key={r}>{r}</option>)}
        </select>
      </label>
    </div>
  );
}
function RequestBtn({ mat, wsId, currentUser, pending, start, qty, reason, onDone }: { mat: WMaterial | null; wsId: number; currentUser: string; pending: boolean; start: (fn: () => void) => void; qty: string; reason: string; onDone: () => void }) {
  return <button disabled={pending} onClick={() => mat && start(async () => { await createRequest({ workshop_id: wsId, material_id: mat.id, qty: Number(qty), reason, requested_by: currentUser }); onDone(); })}
    className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-accent hover:opacity-90 disabled:opacity-50">{pending ? "Sending…" : "Send Request"}</button>;
}

const TYPE_META: Record<string, { label: string; cls: string }> = {
  received: { label: "Received", cls: "bg-emerald-100 text-emerald-700" },
  request_fulfilled: { label: "Restock", cls: "bg-sky-100 text-sky-700" },
  consumed: { label: "Consumed", cls: "bg-rose-100 text-rose-700" },
  adjust: { label: "Adjustment", cls: "bg-stone-100 text-stone-600" },
};
function typeMeta(t: string) {
  return TYPE_META[t] ?? { label: t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), cls: "bg-stone-100 text-stone-600" };
}

function LogsTab({ data }: { data: WorkshopData }) {
  const pg = usePagination(data.logs, 25);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
          <colgroup>
            <col span={3} />
            <col span={2} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&_th]:bg-[#4a3b1a]">
              <th colSpan={3} className="border-b border-[#caa45a] px-5 py-2">Movement</th>
              <th colSpan={4} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Record</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&_th]:bg-[#5a4a26]">
            <th className="px-4 py-3">Date</th><th className="px-4 py-3">Material</th>
            <th className="px-4 py-3">Change</th><th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Type</th><th className="px-4 py-3">Order</th><th className="px-4 py-3">Used By</th><th className="px-4 py-3">Logged By</th>
          </tr></thead>
          <tbody>
            {data.logs.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">No stock movements.</td></tr>
            ) : pg.slice.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-muted">{logStamp(l.created_at) || "—"}</td>
                <td className="px-4 py-3 font-medium"><span className="flex items-center justify-center gap-2"><Thumbnail name={l.material_name} url={l.material_image} /><span>{l.material_name}</span></span></td>
                <td className={cn("px-4 py-3 text-center font-semibold tabular-nums", l.delta < 0 ? "text-rose-600" : "text-emerald-600")}>{l.delta > 0 ? `+${l.delta}` : l.delta}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center"><span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", typeMeta(l.type).cls)}>{typeMeta(l.type).label}{l.source === "manual" && l.type === "consumed" ? " · manual" : ""}</span></td>
                {/* Hiwalay na hanay: saang order, sino ang gumamit (0178), at
                    sino ang naglagay sa sistema — hindi na pinagsasama-sama. */}
                <td className="px-4 py-3 text-muted">{l.ref_type === "order" ? (l.note || `#${l.ref_id ?? ""}`) : "—"}</td>
                <td className="px-4 py-3">{l.used_by ? <span className="font-medium text-foreground">{l.used_by}</span> : <span className="text-muted">—</span>}</td>
                <td className="px-4 py-3 text-muted">{l.by ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationFooter {...pg} />
    </div>
  );
}

// Uniform status pill (mirrors the Operations side).
function wReqPill(r: WRequest): { label: string; cls: string } {
  const s = (r.status || "").toLowerCase();
  if (/fulfilled/.test(s)) return { label: `✓ Fulfilled (+${r.qty_received || r.qty_fulfilled || 0})`, cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" };
  if (/ordered/.test(s)) return { label: `◆ Incoming (${r.qty_fulfilled ?? 0})`, cls: "bg-sky-50 text-sky-700 ring-sky-200" };
  if (/partial/.test(s)) return { label: `◐ Partial (${r.qty_received}/${r.qty_fulfilled ?? 0})`, cls: "bg-amber-50 text-amber-700 ring-amber-200" };
  if (/reject/.test(s)) return { label: "✕ Rejected", cls: "bg-stone-100 text-stone-500 ring-stone-200" };
  return { label: "Pending", cls: "bg-amber-50 text-amber-700 ring-amber-200" };
}

function RequestsTab({ data, currentUser }: { data: WorkshopData; wsId: number; currentUser: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [receiving, setReceiving] = useState<WRequest | null>(null);
  const [qtyVal, setQtyVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const pg = usePagination(data.requests, 25);
  const remainingOf = (r: WRequest) => Math.max((Number(r.qty_fulfilled ?? r.qty_requested) || 0) - (Number(r.qty_received) || 0), 0);
  const openReceive = (r: WRequest) => { setReceiving(r); setQtyVal(String(remainingOf(r))); setErr(null); };
  const doReceive = () => {
    if (!receiving) return;
    start(async () => {
      const res = await receiveStockRequest(receiving.id, currentUser, Number(qtyVal));
      if ("error" in res) { setErr(res.error); return; }
      setReceiving(null); router.refresh();
    });
  };
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-sm border-collapse [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&_th]:bg-[#4a3b1a]">
              <th colSpan={4} className="border-b border-[#caa45a] px-5 py-2">Request</th>
              <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Status</th>
              <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2"></th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&_th]:bg-[#5a4a26]">
              <th className="px-4 py-3">Material</th><th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Reason</th><th className="px-4 py-3">Date</th><th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Status</th><th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.requests.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">No requests.</td></tr>
            ) : pg.slice.map((r) => {
              const hot = r.status === "ordered" || r.status === "partial";
              const p = wReqPill(r);
              return (
              <tr key={r.id} className={cn("border-b border-border last:border-0", hot && "bg-amber-50/40")}>
                <td className={cn("px-4 py-3 font-medium", hot && "shadow-[inset_3px_0_0_#f59e0b]")}>{r.material_name}</td>
                <td className="px-4 py-3 text-center tabular-nums">{r.qty_requested}</td>
                <td className="px-4 py-3 text-muted">{r.reason ?? "—"}</td>
                <td className="px-4 py-3 text-muted">{r.created_at ?? "—"}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center">
                  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1", p.cls)}>{p.label}</span>
                </td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center">
                  {hot
                    ? <button onClick={() => openReceive(r)} disabled={pending} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">✓ Receive{r.status === "partial" ? ` ${remainingOf(r)} left` : ""}</button>
                    : <span className="text-xs text-muted">—</span>}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PaginationFooter {...pg} />

      <Modal open={!!receiving} onClose={() => setReceiving(null)} title="Receive Stock" description={receiving ? receiving.material_name : ""}
        footer={<div className="flex justify-end gap-2">
          <button onClick={() => setReceiving(null)} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-stone-100">Cancel</button>
          <button onClick={doReceive} disabled={pending} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{pending ? "Receiving…" : "✓ Confirm Receive"}</button>
        </div>}>
        {receiving && (
          <div className="space-y-3">
            <p className="text-sm text-muted">Ordered: <b className="text-foreground">{receiving.qty_fulfilled ?? receiving.qty_requested}</b> · Already received: <b className="text-foreground">{receiving.qty_received}</b> · Remaining: <b className="text-foreground">{remainingOf(receiving)}</b>. Enter what arrived now (partial OK).</p>
            <label className="block text-sm font-medium">Qty received
              <input type="number" min={0} value={qtyVal} onChange={(e) => setQtyVal(e.target.value)} className={cn(inp, "mt-1 w-full")} />
            </label>
            {err && <p className="text-sm text-rose-600">{err}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

// Material consumption picker (right side of the job preview) — pick from THIS
// workshop's inventory by category, set qty, then commit a stock-OUT tied to the job.
// DESIGN DETAILS ng MISMONG ITEM (2026-08-19): ang mga sheet na ang title ay
// tugma sa item na ito lang; kung marami, IISANG card — magkakadugtong ang pages
// sa viewer, hindi dobleng cards. Fallback sa lahat ng sheets ng order kung
// walang title match (lumang data).
//
// SARILING COMPONENT (hiling 2026-08-28). Nasa Product panel ito noon, kasunod
// ng specs — kaya para makita ang plano habang pumipili ng materyales, kailangang
// tumingin pabalik sa kabilang hanay. Nasa Materials Used na ito ngayon: ang
// gagawin at ang kukunin, magkatabi.
function DesignSheetCard({ preview, designByOrder, onOpen }: {
  preview: WJob;
  designByOrder: WorkshopData["designByOrder"];
  onOpen: (v: { title: string; pages: { url: string; label: string }[] }) => void;
}) {
  // Ang STOCK BUILD ay walang order — ang SKU nito ang susi. Ang REWORK ay
  // hindi stock build kahit stock_request ang gawa nito: ang sarili niyang
  // order ang susi, at kung wala, walang sheet — hindi ang sheets ng ibang
  // gawa na parehong catalog SKU.
  const isReworkJob = /^\s*rework\b/i.test(preview.item_desc ?? "");
  const key = ((preview.stock_request && !isReworkJob) ? preview.stock_sku : preview.order_number) ?? "";
  const all = key.trim() ? (designByOrder[key.trim()] ?? []) : [];
  if (!all.length) return null;
  const itemName = (preview.item_desc ?? "").split("\n")[0].replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "").trim().toLowerCase();
  // Tanggalin ang " — N" na page suffix ng multi-file upload bago itugma.
  const baseTitle = (t: string | null) => (t ?? "").replace(/\s+—\s+\d+$/, "").trim().toLowerCase();
  // ANG SHEET NA MAY SKU AY SA ISANG PRODUKTO LANG (2026-08-26).
  // Ang "Attach to product" ng upload ay nagtatala ng sku — ang
  // sheet ng SOFA-000003 ay hindi dapat lumabas sa Accent Chair
  // ng parehong order. Ang sheet na WALANG sku (bago ang 0183)
  // ang nananatili sa lumang landas: title match, kung wala ay
  // lahat — hindi na maiuugnay, at ang pagtatago ay mas masama.
  const jobSku = (((preview.stock_request && !isReworkJob) ? preview.stock_sku : preview.sku) ?? "").trim().toUpperCase();
  const withSku = all.filter((d) => d.sku);
  const noSku = all.filter((d) => !d.sku);
  const mineSku = jobSku
    ? withSku.filter((d) => (d.sku ?? "").trim().toUpperCase() === jobSku)
    // Walang catalog match ang job — ang title na lang ang
    // maitutumbas sa mga naka-sku na sheet.
    : withSku.filter((d) => baseTitle(d.title) === itemName);
  const mineTitle = noSku.filter((d) => baseTitle(d.title) === itemName);
  // WALANG SHARED FALLBACK (2026-09-02, "dapat kung ano lang mismo naka attach
  // sayo un lang tlga"): dating bumabalik sa LAHAT ng no-SKU sheets ng order
  // kapag walang title match, kaya ang sheet ng ibang produkto ay dumadapo sa
  // bawat job ng order. Eksaktong SKU o eksaktong pangalan lang — kung wala,
  // walang card, gaya na rin ng QC.
  const dds = [...mineSku, ...mineTitle];
  if (!dds.length) return null;
  const first = dds[0];
  const approved = dds.filter((d) => d.status === "Accepted").length;
  return (
    <button
      type="button"
      onClick={() => onOpen({
        title: `${key.trim()} — ${dds.length} sheet${dds.length === 1 ? "" : "s"}`,
        pages: dds.map((d) => ({ url: d.imageUrl, label: `${d.ddNumber ?? "—"}${d.status === "Accepted" ? " — APPROVED" : ""}` })),
      })}
      className="mx-3 mb-3 mt-auto block w-[calc(100%-1.5rem)] overflow-hidden rounded-xl border-[1.5px] border-[#caa45a] bg-white text-left shadow-[0_0_0_3px_rgba(202,164,90,0.14)] transition-transform hover:-translate-y-0.5"
    >
      <span className="flex items-center gap-2 bg-gradient-to-r from-[#52421d] to-[#4a3b1a] px-3 py-1.5">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#f4ead8]">Design Details</span>
        <span className="ml-auto font-mono text-[10.5px] font-bold text-[#caa45a]">{dds.length > 1 ? `${dds.length} sheets` : (first.ddNumber ?? "—")}</span>
      </span>
      <span className="flex items-center gap-3 px-3 py-2.5">
        {/\.pdf($|\?)/i.test(first.imageUrl) ? (
          <span className="flex h-24 w-[74px] shrink-0 items-center justify-center rounded-md border border-border bg-stone-50 text-[10px] font-extrabold text-[#4a3b1a]">PDF</span>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={first.imageUrl} alt="design sheet" loading="lazy" className="h-24 w-[74px] shrink-0 rounded-md border border-border bg-white object-cover object-top" />
        )}
        <span className="min-w-0 flex-1">
          {approved === dds.length ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-emerald-700">✓ Approved</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-amber-700">{approved > 0 ? `${approved}/${dds.length} approved` : (first.status === "Sent" ? "Pending approval" : first.status)}</span>
          )}
          <span className="mt-1 block text-[10.5px] leading-relaxed text-muted">
            {first.approvedAt ? <>Approved <b className="text-[#3a2e14]">{first.approvedAt}</b><br /></> : null}
            {first.createdBy ? <>Prepared by <b className="text-[#3a2e14]">{first.createdBy}</b></> : null}
          </span>
        </span>
      </span>
      <span className="block border-t border-[#e6dcc4] bg-[#faf6ec] px-3 py-1.5 text-center text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[#4a3b1a]">View Full Sheet{dds.length > 1 ? "s" : ""}</span>
    </button>
  );
}

function MaterialsUsedPanel({ materials, workers, wsId, job, currentUser, onDone, footer }: { materials: WMaterial[]; workers: WorkerLite[]; wsId: number; job: WJob; currentUser: string; onDone: () => void; footer?: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cat, setCat] = useState<string>("");
  const [lines, setLines] = useState<{ id: number; name: string; qty: number; on_hand: number; image: string | null; unit: string; usedBy: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // USED BY KADA LINYA (2026-08-23): magkakaiba ang kumuha ng plywood at ng foam
  // sa iisang job, kaya kada material ang pangalan - hindi iisang dropdown.
  const setUsedBy = (id: number, name: string) => setLines((p) => p.map((l) => l.id === id ? { ...l, usedBy: name } : l));
  const locked = /^(done|delivered|for approval hr|qc passed)$/i.test(job.status); // job declared/finished → no more material changes

  // hide out-of-stock (0 on-hand) and manager-only materials — the latter are
  // stock-outed separately by the workshop account, not consumed per-job.
  const inStock = materials.filter((m) => m.on_hand > 0 && !m.manager_only);
  const cats = [...new Set(inStock.map((m) => m.category || "Uncategorized"))];
  const shown = inStock.filter((m) => !cat || (m.category || "Uncategorized") === cat);
  const add = (m: WMaterial) => {
    if (locked) { setErr("This job is Done — materials are locked."); return; }
    if (m.on_hand <= 0) { setErr(`Out of stock — no available "${m.name}". Request a restock first.`); return; }
    setErr(null);
    setLines((p) => {
      const ex = p.find((l) => l.id === m.id);
      if (ex && ex.qty >= m.on_hand) { setErr(`Reached available stock for "${m.name}" (${m.on_hand}).`); return p; }
      // liquids start at ¼ gallon and step by ¼; others start at 1 whole unit.
      const step = isLiquid(m.unit) ? 0.25 : 1;
      // Ang bagong linya ay nagmamana ng worker ng huling linya - kadalasan iisa;
      // napapalitan pa rin kada linya.
      return ex ? p.map((l) => l.id === m.id ? { ...l, qty: l.qty + step } : l) : [...p, { id: m.id, name: m.name, qty: step, on_hand: m.on_hand, image: m.image_url, unit: m.unit, usedBy: p.length ? p[p.length - 1].usedBy : "" }];
    });
  };
  const setQty = (id: number, q: number) => setLines((p) => p.map((l) => l.id === id ? { ...l, qty: Math.max(isLiquid(l.unit) ? 0.25 : 1, q) } : l));
  const remove = (id: number) => setLines((p) => p.filter((l) => l.id !== id));
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  const confirm = () => {
    if (!lines.length) { setErr("Select the materials used first."); return; }
    const missing = firstWithoutWorker(lines);
    if (missing) { setErr("Pick who used " + missing.name + "."); return; }
    setErr(null);
    start(async () => {
      const res = await scanCommit({ workshop_id: wsId, mode: "out", ref_order_id: job.order_id, ref_order_number: job.order_number, ref_job_id: job.id, lines: lines.map((l) => ({ material_id: l.id, qty: l.qty, used_by: l.usedBy.trim() || null })), by: currentUser });
      if ("error" in res) { setErr(res.error); return; }
      onDone(); router.refresh();
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#e6dcc4] bg-stone-50/50 shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-[#e6dcc4] bg-[#4a3b1a] px-4 py-2.5">

        <div>
          <div className="text-sm font-semibold text-white">Materials Used</div>
          <div className="text-[11px] text-[#e7dcc4]">From this workshop&apos;s inventory · stock-out</div>
        </div>
      </div>
      {locked && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700">Job is <b>Done</b> — materials are locked. No more additions.</div>}
      <div className="flex gap-2 overflow-x-auto border-b border-border px-3 py-2">
        <button onClick={() => setCat("")} className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", !cat ? "bg-primary text-primary-foreground" : "bg-white text-muted ring-1 ring-border")}>All</button>
        {cats.map((c) => (
          <button key={c} onClick={() => setCat(c)} className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", cat === c ? "bg-primary text-primary-foreground" : "bg-white text-muted ring-1 ring-border")}>{c}</button>
        ))}
      </div>
      <div className="grid max-h-[240px] grid-cols-2 gap-x-2 overflow-y-auto px-2 py-1">
        {shown.length === 0 ? <p className="col-span-2 px-2 py-4 text-center text-xs text-muted">No materials.</p> : shown.map((m) => {
          const out = m.on_hand <= 0;
          return (
          <button key={m.id} onClick={() => add(m)} disabled={out || locked} title={locked ? "Job is Done — locked" : out ? "Out of stock" : undefined}
            className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left", out || locked ? "cursor-not-allowed opacity-50" : "hover:bg-white")}>
            {m.image_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={m.image_url} alt="" className="h-7 w-7 shrink-0 rounded object-cover ring-1 ring-border" /> : <div className="h-7 w-7 shrink-0 rounded bg-stone-100" />}
            <span className="flex-1 truncate text-sm" title={m.name}>{m.name}</span>
            <span className={cn("shrink-0 text-[11px] tabular-nums", out ? "text-rose-500" : "text-muted")} title="on hand">{m.on_hand}</span>
            {out
              ? <span className="shrink-0 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">OUT</span>
              : <span className="shrink-0 rounded-md bg-primary/10 px-1.5 text-xs font-semibold text-primary">+</span>}
          </button>
          );
        })}
      </div>
      <div className="border-t border-border px-3 py-2">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Selected ({lines.length})</div>
        <div className="rounded-lg border border-dashed border-border bg-white p-2">
          {lines.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted">Click a material above to add it here.</p>
          ) : lines.map((l) => {
            const liquid = isLiquid(l.unit);
            const step = liquid ? 0.25 : 1;
            return (
            <div key={l.id} className="rounded-md px-1 py-1 hover:bg-stone-50">
              <div className="flex items-center gap-2">
                {l.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={l.image} alt="" className="h-8 w-8 shrink-0 rounded object-cover ring-1 ring-border" /> : <div className="h-8 w-8 shrink-0 rounded bg-stone-100" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{l.name}</div>
                  <div className="text-[10px] text-muted">{l.qty} {l.unit}{l.qty > l.on_hand ? <span className="ml-1 font-medium text-rose-500">{l.on_hand} on hand</span> : null}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setQty(l.id, l.qty - step)} className="h-6 w-6 rounded border border-border text-sm hover:bg-stone-100">−</button>
                  <input value={l.qty} onChange={(e) => setQty(l.id, Number(e.target.value) || step)} className="h-6 w-14 rounded border border-border text-center text-sm" />
                  <button onClick={() => setQty(l.id, l.qty + step)} className="h-6 w-6 rounded border border-border text-sm hover:bg-stone-100">+</button>
                </div>
                <button onClick={() => remove(l.id)} className="text-muted hover:text-rose-600">✕</button>
              </div>
              {/* USED BY kada linya (2026-08-23). Amber ang gilid habang blangko. */}
              <div className="mt-1 flex items-center gap-2 pl-10">
                <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Used by</span>
                <select value={l.usedBy} onChange={(e) => setUsedBy(l.id, e.target.value)} disabled={locked}
                  className={cn("h-7 min-w-0 flex-1 rounded-md border bg-surface px-2 text-xs outline-none focus:border-primary disabled:opacity-60", l.usedBy ? "border-border" : "border-amber-400")}>
                  <option value="">— select worker —</option>
                  {workers.map((w) => <option key={w.id} value={w.name}>{w.name}</option>)}
                </select>
              </div>
              {liquid && (
                <div className="mt-1 flex flex-wrap gap-1 pl-10">
                  {FRACTIONS.map(([label, val]) => (
                    <button key={label} type="button" onClick={() => setQty(l.id, val)}
                      className={cn("rounded border px-2 py-0.5 text-xs font-semibold", l.qty === val ? "border-primary bg-primary/10 text-primary" : "border-border bg-white hover:bg-stone-100")}>{label}</button>
                  ))}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>
      {err && <p className="px-3 pb-1 text-xs text-rose-600">{err}</p>}
      {workers.length === 0 && <p className="px-4 pb-1 text-[11px] text-muted">No Project Base workers — assign the role in Employee Directory.</p>}
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        <span className="text-xs text-muted">{totalQty} item{totalQty !== 1 ? "s" : ""}</span>
        <button onClick={confirm} disabled={pending || !lines.length || locked} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:opacity-90 disabled:opacity-50">{pending ? "Saving…" : locked ? "Locked (Done)" : "✓ Confirm Materials Used"}</button>
      </div>
      {/* ANG PLANO, SA ILALIM NG PAGPILI (hiling 2026-08-28). Blangko ang espasyong
          ito noon habang ang design sheet ay nasa kabilang hanay pa. Ang node
          mismo ang may hawak ng kahon nito — kapag walang sheet, bumabalik ito
          ng null at walang naiiwang padding. */}
      {footer}
    </div>
  );
}

// Read-only history of materials consumed for THIS JOB (from the stock ledger).
// Ang isang order ay maraming produkto — bawat isa ay sariling job, at ang
// plywood ng job 1 ay hindi dapat lumabas sa kasaysayan ng job 2. Ang lumang
// tala na walang job_id (bago ang 0197, o hindi na-backfill dahil maraming job
// ang order) ay nananatiling nakikita sa lahat ng job ng order na iyon: hindi
// na malalaman kung alin talaga, at ang pagtatago ay mas masama.
function UsageHistory({ logs, job }: { logs: WLog[]; job: WJob }) {
  const used = logs.filter((l) =>
    /consumed/i.test(l.type) && l.delta < 0 &&
    (l.job_id != null ? l.job_id === job.id : l.ref_type === "order" && l.ref_id === job.order_id));
  const total = used.reduce((s, l) => s + Math.abs(l.delta), 0);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#e6dcc4] bg-stone-50/50 shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-[#e6dcc4] bg-[#4a3b1a] px-4 py-2.5">

        <div>
          <div className="text-sm font-semibold text-white">Usage History</div>
          <div className="text-[11px] text-[#e7dcc4]">Consumed for {(job.item_desc ?? "").split("\n")[0].trim() || job.order_number || "this job"}</div>
        </div>
      </div>
      <div className="max-h-[460px] overflow-y-auto px-3 py-2">
        {used.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted">No materials logged yet for this item.</p>
        ) : used.map((l) => (
          <div key={l.id} className="flex items-start gap-2 border-b border-border/60 py-2 last:border-0">
            {l.material_image
              ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={l.material_image} alt="" className="h-8 w-8 shrink-0 rounded object-cover ring-1 ring-border" />
              : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-stone-100 text-[10px] text-muted">—</div>}
            <div className="min-w-0 flex-1">
              {/* Isang linya kada bagay: pangalan ng materyal, sino ang gumamit,
                  tapos ang petsa at kung sino ang nag-log — hindi na
                  pinagsasama-sama sa isang mahabang linyang nagwa-wrap. */}
              <div className="truncate text-sm font-medium">{l.material_name}</div>
              <div className="truncate text-[11px]">{l.used_by ? <span className="font-semibold text-foreground">{l.used_by}</span> : <span className="italic text-muted">no name recorded</span>}</div>
              <div className="truncate text-[11px] text-muted">{[logStamp(l.created_at), l.by ? `logged by ${l.by}` : ""].filter(Boolean).join(" · ")}</div>
            </div>
            <span className="shrink-0 self-start rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600 tabular-nums">−{Math.abs(l.delta)}</span>
          </div>
        ))}
      </div>
      {/* SA PINAKAILALIM: totals, ang inaprubahang piyesa, ang litrato ng sira
          (hiling 2026-08-28) — kapantay ng Design Details sa kabilang panel,
          kaya magkatapat ang dalawang kahon. Ang `mt-auto` ay nasa totals bar,
          ang unang kapatid sa pangkat, kaya sabay itong itinutulak sa dulo. */}
      <div className="mt-auto flex items-center justify-between border-t border-border px-4 py-2.5 text-xs">
        <span className="text-muted">{used.length} entr{used.length === 1 ? "y" : "ies"}</span>
        <span className="font-semibold">Total used: {total}</span>
      </div>
      {/* ANG PIYESANG INAPRUBAHAN, SA TAAS NG LITRATO (hiling 2026-08-28). Nasa
          Materials Used ito noon; dito ay magkasunod na ang binabasa: ano ang
          ipapalit, tapos ano ang sira. Isang tingin, hindi dalawang panel. */}
      {(job.rework_parts?.length ?? 0) > 0 && (
        <div className="border-t border-amber-200 bg-amber-50/60 px-4 py-2.5">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">Approved replacement parts</p>
          <ul className="space-y-0.5 text-[11.5px] text-amber-900">
            {job.rework_parts.map((pt, i) => (
              <li key={i} className="flex items-baseline gap-1.5">
                <span className="text-amber-500">•</span>
                <span className="font-semibold">{pt.qty > 1 ? `${pt.qty}× ` : ""}{pt.part}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(job.rework_photos?.length ?? 0) > 0 && (
        <div className="border-t border-border bg-white px-3 py-3">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">Proof of damage ({job.rework_photos.length})</p>
          <div className="grid grid-cols-3 gap-1.5">
            {job.rework_photos.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg ring-1 ring-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" loading="lazy" className="h-20 w-full object-cover transition-transform hover:scale-105" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
