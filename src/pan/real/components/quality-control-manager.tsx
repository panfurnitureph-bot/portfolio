"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { RushBadge } from "./rush-badge";
import { useRouter } from "next/navigation";
import { cn, SpecRows, StockTag, ReworkCell, isReworkItem } from "./ui";
import { SpecFieldsView } from "./spec-fields-input";
import { specCategoryOf } from "./line-items-editor";
import { MultiImageUpload } from "./multi-image-upload";
import type { WorkshopData } from "@/app/workshop/data";
import type { EmployeeLite } from "@/app/hr/projects/data";
import { declareQc, type QcRate, type QcDeclaration } from "@/app/workshop/qc-actions";
import { PaginationFooter, usePagination } from "@/components/pagination-footer";

const peso = (n: number) => "₱" + (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const peso2 = (n: number) => "₱" + (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function statusPill(s: string) {
  const v = (s || "").toLowerCase();
  if (/approved/.test(v)) return "bg-emerald-50 text-emerald-700";
  if (/paid/.test(v)) return "bg-violet-50 text-violet-700";
  if (/reject/.test(v)) return "bg-rose-50 text-rose-700";
  return "bg-amber-50 text-amber-700"; // For Approval
}

export function QualityControlManager({ data, rates, declarations: allDeclarations, workers, qcStaff, qcName, qaFixed = false }: {
  data: WorkshopData; rates: QcRate[]; declarations: QcDeclaration[]; workers: EmployeeLite[]; qcStaff: { id: number; name: string }[]; qcName: string; qaFixed?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<QcDeclaration | null>(null);
  const [declareOpen, setDeclareOpen] = useState(false);

  const sections = useMemo(() => [...new Set(rates.map((r) => r.section))].filter((s) => /^(carpentry|upholstery)$/i.test(s)), [rates]);
  // orders already declared (not rejected) → hide from the Order # picker to avoid double-declaring
  // ISANG WORKSHOP LANG ang nakikita ng bawat pahina: ang mga declaration ng
  // ibang workshop ay wala sa KPI, sa talaan, at hindi humaharang sa pag-declare
  // dito (iba-ibang gawain ang bawat workshop kahit iisa ang order).
  const declarations = useMemo(
    () => allDeclarations.filter((d) => !data.active?.name || (d.workshop ?? "") === data.active.name),
    [allDeclarations, data.active?.name],
  );
  // ANG DEKLARASYON AY SA ISANG JOB (2026-08-26). Ang pagtatago sa buong order
  // ay nagpapawala ng KAPATID na produkto: ang ORD-000006 ay may tatlong job sa
  // workshop na ito, at nang madeklara ang isa, nawala ang dalawa sa picker.
  // Ang may job_id ay hinahambing sa job; ang lumang tala na wala nito ay
  // buong order pa rin ang saklaw - hindi na malalaman kung aling produkto.
  const declaredJobs = useMemo(() => new Set(declarations.filter((d) => !/reject/i.test(d.status)).map((d) => d.job_id).filter((x): x is number => x != null)), [declarations]);
  const declaredOrders = useMemo(() => new Set(declarations.filter((d) => !/reject/i.test(d.status) && d.job_id == null).map((d) => d.order_number).filter(Boolean) as string[]), [declarations]);
  // Rush ng order (galing sa workshop jobs) — badge sa taas ng order number.
  const rushByOrder = useMemo(() => {
    const m = new Map<string, { rush_days: number | null; date_order: string | null }>();
    for (const j of data.jobs) {
      if (j.is_rush && j.order_number) m.set(j.order_number, { rush_days: j.rush_days ?? null, date_order: j.date_order });
    }
    return m;
  }, [data.jobs]);

  // KPIs for this week / pipeline
  const kpi = useMemo(() => {
    const forApproval = declarations.filter((d) => /for approval/i.test(d.status));
    const approved = declarations.filter((d) => /approved/i.test(d.status));
    const toPay = approved.reduce((s, d) => s + Number(d.total_amount || 0), 0);
    return { declared: declarations.length, forApproval: forApproval.length, approved: approved.length, toPay };
  }, [declarations]);

  // DALAWANG TANAW (hiling 2026-08-28). Ang naaprubahan na ni HR ay nananatili
  // sa listahan, kaya ang hinihintay pang aksyon ay nakahalo sa mga bayad na.
  // Ang "Pending" ang gawain — nakadeklara pero hindi pa naaprubahan; ang
  // "Completed" ay ang naaprubahan at ang bayad na. Ang tinanggihan ay kasama
  // sa Pending: may gagawin pa doon.
  const [tab, setTab] = useState<"open" | "done">("open");
  const isDone = (d: QcDeclaration) => /approved|paid/i.test(d.status ?? "");
  const scoped = useMemo(
    () => declarations.filter((d) => (tab === "done" ? isDone(d) : !isDone(d))),
    [declarations, tab],
  );
  const doneCount = useMemo(() => declarations.filter(isDone).length, [declarations]);
  const openCount = declarations.length - doneCount;
  const pg = usePagination(scoped, 25);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <select value={data.active?.id ?? ""} onChange={(e) => router.push(`/workshop/quality-control?ws=${e.target.value}`)} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          {data.workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
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
        <button onClick={() => setDeclareOpen(true)} className="rounded-lg bg-[#4a3b1a] px-4 py-2 text-sm font-bold text-[#f4ead8] shadow-sm hover:opacity-90">
          Declare Completed Item
        </button>
      </div>

      <div className="apk-hide grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Declared" value={String(kpi.declared)} accent="text-foreground" />
        <Kpi label="For HR Approval" value={String(kpi.forApproval)} accent="text-amber-600" />
        <Kpi label="Approved" value={String(kpi.approved)} accent="text-emerald-600" />
        <Kpi label="To pay (approved)" value={peso(kpi.toPay)} accent="text-violet-600" />
      </div>

      {/* Declaration form — opens as a popup from the "Declare Completed Item" button. */}
      <DeclarePanel data={data} rates={rates} sections={sections} workers={workers} qcStaff={qcStaff} qcName={qcName} qaFixed={qaFixed} declaredOrders={declaredOrders} declaredJobs={declaredJobs} open={declareOpen} onClose={() => setDeclareOpen(false)} />

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full xl:min-w-[1120px] border-collapse text-[11px] xl:text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:px-1.5 [&_td]:py-1.5 xl:[&_td]:px-3 xl:[&_td]:py-2.5 [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:px-1.5 [&_th]:py-1.5 xl:[&_th]:px-3 xl:[&_th]:py-2.5">
            <colgroup>
              <col span={5} />
              <col span={4} />
              <col span={3} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
                <th colSpan={5} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] px-5 py-2">Order</th>
                <th colSpan={4} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Production</th>
                <th colSpan={3} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Result</th>
              </tr>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="bg-[#5a4a26]">Date</th><th className="bg-[#5a4a26]">Order #</th><th className="bg-[#5a4a26]">RMA #</th><th className="bg-[#5a4a26]">Workshop</th><th className="bg-[#5a4a26]">QC</th><th className="bg-[#5a4a26] !border-l-4 !border-l-[#caa45a]">Made By </th><th className="bg-[#5a4a26]">Item</th><th className="bg-[#5a4a26]">Section</th><th className="bg-[#5a4a26]">Add-ons</th><th className="bg-[#5a4a26] !border-l-4 !border-l-[#caa45a]">Amount</th><th className="bg-[#5a4a26]">Status</th><th className="bg-[#5a4a26]">Route</th>
            </tr></thead>
            <tbody>
              {scoped.length === 0 ? (
                <tr><td colSpan={12} className="px-3 py-12 text-center text-muted">No declarations yet. Click <b>Declare Completed Item</b>.</td></tr>
              ) : pg.slice.map((d) => (
                <tr key={d.id} onClick={() => setView(d)} className="cursor-pointer hover:bg-stone-50">
                  <td className="text-center text-muted">{d.declared_at ? new Date(d.declared_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : "—"}</td>
                  <td className="text-center font-semibold"><div className="flex flex-col items-center gap-0.5">{d.order_number && rushByOrder.has(d.order_number) && <RushBadge isRush dateOrder={rushByOrder.get(d.order_number)!.date_order} threshold={rushByOrder.get(d.order_number)!.rush_days ?? data.rushThreshold} />}{d.stock_request ? <StockTag sku={d.stock_sku} /> : <span>{d.order_number || "—"}</span>}</div></td>
                  {/* Ang RMA # ay nakabaon sa pangalan ng item ("Rework · RMA-12 · Sofa"),
                      hindi sa sariling hanay — doon ito nakasulat ng Declare. */}
                  <td className="text-center">{(() => {
                    const m = (d.item ?? "").match(/^rework\s*·\s*(rma-\d+)/i);
                    return <ReworkCell isRework={!!m} rmaNo={m?.[1]?.toUpperCase()} />;
                  })()}</td>
                  <td className="text-center text-muted">{d.workshop || "—"}</td>
                  <td className="text-center text-muted">{d.qc_name || "—"}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] text-center font-semibold text-[#4a3b1a]">{d.worker_name || "—"}</td>
                  <td className="text-left text-muted">{(d.item ?? "—").split("\n")[0].replace(/^rework\s*·\s*rma-\d+\s*·\s*/i, "") || "—"}</td>
                  <td className="text-center text-muted">{d.category || "—"}</td>
                  {/* ANG PIYESA SA REWORK (hiling 2026-08-28). Ang rework ay
                      walang add-on rate, kaya laging blangko ang hanay — kahit
                      may listahan ng ipinalit na binayaran ng customer. */}
                  <td className="text-left text-muted">
                    {d.rework_parts?.length
                      ? <span className="text-amber-800">{d.rework_parts.map((pt) => `${pt.qty > 1 ? `${pt.qty}× ` : ""}${pt.part}`).join(", ")}</span>
                      : (d.add_ons?.length ? d.add_ons.map((a) => a.name).join(", ") : "—")}
                  </td>
                  <td className="!border-l-4 !border-l-[#caa45a] text-center font-bold text-[#4a3b1a]">{peso2(d.total_amount)}</td>
                  <td className="text-center"><span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", statusPill(d.status))}>{d.status}</span></td>
                  <td className="text-center">
                    <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                      d.fulfillment === "pickup" ? "bg-sky-50 text-sky-700 ring-sky-200" : "bg-amber-50 text-amber-700 ring-amber-200")}>
                      {d.fulfillment === "pickup" ? "Pickup" : "Warehouse"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationFooter page={pg.page} setPage={pg.setPage} pageSize={pg.pageSize} setPageSize={pg.setPageSize} total={pg.total} pages={pg.pages} />
      </div>

      {view && <ViewDeclaration d={view} onClose={() => setView(null)} />}
    </div>
  );
}

function ViewDeclaration({ d, onClose }: { d: QcDeclaration; onClose: () => void }) {
  const [hoverImg, setHoverImg] = useState<string | null>(null);
  // Ang BUONG build. Ang bagong declaration ay may kabuuang item na nakatala;
  // ang mga LUMANG tala ay pangalan lang, kaya doon ay ang job ng parehong
  // order at item ang pinagkukunan (job_specs).
  const declName = (d.item ?? "").split("\n")[0];
  const declSpecs = (d.item ?? "").split("\n").slice(1).join("\n").trim();
  const specsText = declSpecs || (d.job_specs ?? "");
  // Ang `category` ng declaration ay SEKSYON ng bayad (Carpentry + Upholstery),
  // hindi uri ng produkto — ang job_category ang tamang batayan ng template.
  const specsCat = d.job_category || (d.category && !/^(carpentry|upholstery|rework)/i.test(d.category) ? d.category : "");
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center gap-4 overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      {/* DALAWANG HANAY (hiling 2026-08-28). Ang rework ay may hilera kada
          piyesa ngayon — lima kada deklarasyon, tig-limang litrato — kaya ang
          isang mahabang haligi ay umaabot nang ilang screen at kailangang
          i-scroll nang matagal para lang makita ang Approve. Ang detalye ay
          nasa kaliwa, ang katibayan sa kanan, at ang bawat isa ay may sariling
          scroll. Sa maliit na screen ay bumabagsak pa rin sa isang haligi. */}
      <div className="my-6 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl lg:max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-[#4a3b1a] px-4 py-3 text-[#f4ead8]">

          <div><div className="text-sm font-bold">Declaration · {d.stock_request ? (d.stock_sku ?? "STOCK") : d.order_number}</div><div className="text-[11px] opacity-80">{d.workshop} · {d.status}</div></div>
          <button onClick={onClose} className="ml-auto text-[#e7dcc4] hover:text-white">✕</button>
        </div>
        <div className="grid gap-4 p-4 lg:max-h-[82vh] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:overflow-hidden">
        <div className="space-y-4 lg:overflow-y-auto lg:pr-1">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-stone-50 p-2.5">
            {d.item_image
              ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={d.item_image} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover ring-1 ring-border" />
              : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-stone-200 text-xs text-muted"></div>}
            <div className="min-w-0"><div className="text-[11px] uppercase tracking-wide text-muted">{d.stock_request ? "Stock build" : `Main order · ${d.order_number}`}</div>
              {(() => {
                const m = ((d.item ?? "—").split("\n")[0]).match(/^rework\s*·\s*(rma-\d+)\s*·\s*(.*)$/i);
                return m
                  ? <><div className="text-[11px] font-bold text-amber-700">{m[1].toUpperCase()}</div><div className="text-sm font-semibold">{m[2] || "—"}</div></>
                  : <div className="text-sm font-semibold">{(d.item ?? "—").split("\n")[0]}</div>;
              })()}
            </div>
          </div>
          <SpecRows items={[["Made By ", d.worker_name], ["QC", d.qc_name], ["Section", d.category], ["Amount", peso2(d.total_amount)], ["Item", declName.replace(/^rework\s*·\s*rma-\d+\s*·\s*/i, "")]]} />
          {/* Ang buong build ng item — parehong SPECIFICATIONS card ng Declare
              at ng Product Details, para makita ng aprubador kung ano talaga
              ang ginawa bago mag-approve. */}
          {specsText ? (
            <div className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Specifications / Design details</span>
              <div className="rounded-lg border border-border bg-stone-50/60 p-3">
                <SpecFieldsView category={specCategoryOf(specsCat, declName)} specs={specsText} />
              </div>
            </div>
          ) : null}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted">Add-ons</div>
            {d.add_ons?.length
              ? <ul className="mt-0.5 space-y-0.5 font-medium">{d.add_ons.map((a, i) => <li key={i}>• {a.name} <span className="text-[#caa45a]">(+{a.amount})</span></li>)}</ul>
              : <div className="font-medium">—</div>}
          </div>
          </div>
          <div className="lg:overflow-y-auto lg:pl-1">
            <p className="mb-2 text-xs font-semibold text-[#4a3b1a]">QC Checklist — photo proof</p>
            {/* ANG PIYESANG INAPRUBAHAN, SA TAAS NG KATIBAYAN (hiling 2026-08-28).
                Hiwalay sa Add-ons: hindi ito bayad sa manggagawa kundi materyal na
                binayaran ng customer. Dito ito nakalagay dahil may hilera ng
                litrato ang bawat piyesa sa ibaba — magkatabi ang hinihingi at ang
                pinatutunayan, kaya kitang-kita kung may kulang. */}
            {d.rework_parts?.length > 0 && (
              <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Approved replacement parts</div>
                <ul className="mt-1 space-y-0.5 text-[12.5px] text-amber-900">
                  {d.rework_parts.map((pt, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2">
                      <span><span className="text-amber-500">•</span> <span className="font-semibold">{pt.qty > 1 ? `${pt.qty}× ` : ""}{pt.part}</span></span>
                      {pt.amount > 0 && <span className="shrink-0 tabular-nums text-amber-700">{peso2(pt.amount)}</span>}
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
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold">
                      {it.name}
                      {it.type === "main" && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700">main item</span>}{it.type === "part" && <span className="rounded bg-amber-200 px-1.5 text-[10px] font-bold text-amber-800">replacement part</span>}
                      {it.type === "base" && <span className="rounded bg-stone-100 px-1.5 text-[10px] font-medium text-muted">base</span>}
                      <span className="ml-auto text-[10px] text-muted">{it.photos?.length ?? 0} photo(s)</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {it.photos?.length ? it.photos.map((u, j) => (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img key={j} src={u} onMouseEnter={() => setHoverImg(u)} onMouseLeave={() => setHoverImg(null)} className="h-14 w-14 cursor-zoom-in rounded object-cover ring-1 ring-border hover:ring-2 hover:ring-[#caa45a]" alt="" />
                      )) : <span className="text-xs text-muted">No photo</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-muted">No checklist recorded.</p>}
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
function DeclarePanel({ data, rates, sections, workers, qcStaff, qcName, qaFixed = false, declaredOrders, declaredJobs, open, onClose }: {
  data: WorkshopData; rates: QcRate[]; sections: string[]; workers: EmployeeLite[]; qcStaff: { id: number; name: string }[]; qcName: string; qaFixed?: boolean; declaredOrders: Set<string>; declaredJobs: Set<number>; open: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  // not-yet-done jobs of this workshop (for the Order # dropdown). A REWORK job is
  // declarable even if the order was declared before — the repair is a NEW payable
  // job on the same order number (the original declaration stays untouched).
  const jobs = useMemo(() => data.jobs.filter((j) =>
    !/^(done|delivered|for approval hr|qc passed)$/i.test(j.status)
    // Ang STOCK BUILD ay walang order number — hindi ito maaaring ihambing sa
    // declaredOrders (magkakatugma ang lahat ng walang laman). Ang status
    // mismo ang naghuhudyat kung nadeklara na ito.
    // Ang nadeklara nang JOB ay wala na; ang kapatid na produkto ng parehong
    // order ay nananatili. Ang declaredOrders ay legacy na lang (walang job_id).
    && !declaredJobs.has(j.id)
    && (isReworkItem(j.item_desc) || j.stock_request || !declaredOrders.has(j.order_number ?? ""))
  ), [data.jobs, declaredOrders, declaredJobs]);
  const [jobId, setJobId] = useState<number | "">("");
  // Order muna, tapos ang item — pareho ng New Return / RMA: ang dropdown ay
  // order number, at ang mga job ng order na iyon ang lumalabas bilang cards.
  const [orderNo, setOrderNo] = useState("");
  // Ang STOCK BUILD ay walang order, kaya HIWA-HIWALAY sila: isang entry kada
  // job, hindi isang "STOCK REQUEST · 2 items" na kumpol. Walang pinagsasama
  // ang isang order — ang bawat stock build ay sariling ipinagawa.
  const nameOfJob = (j: { item_desc?: string | null }) => String(j.item_desc ?? "").split("\n")[0].trim();
  const orderJobs = useMemo(
    () => (orderNo.startsWith("stock:")
      ? jobs.filter((j) => j.stock_request && String(j.id) === orderNo.slice(6))
      : jobs.filter((j) => !j.stock_request && (j.order_number ?? "") === orderNo)),
    [jobs, orderNo],
  );
  // Bawat pagpipilian ay may pangalan ng item — ang numero lang ay hindi
  // sapat para malaman kung alin ang ide-declare.
  const orderOptions = useMemo(() => {
    const byOrder = new Map<string, { n: number; first: string }>();
    const stock: { key: string; label: string }[] = [];
    for (const j of jobs) {
      if (j.stock_request) {
        const sku = (j.stock_sku ?? "").trim();
        stock.push({ key: `stock:${j.id}`, label: `STOCK${sku ? ` · ${sku}` : ""} — ${nameOfJob(j) || "item"}` });
        continue;
      }
      const k = j.order_number ?? "";
      if (!k) continue;
      const cur = byOrder.get(k);
      if (cur) cur.n += 1;
      else byOrder.set(k, { n: 1, first: nameOfJob(j) });
    }
    const orders = [...byOrder.entries()].map(([no, v]) => ({
      key: no,
      label: v.n > 1 ? `${no} — ${v.n} items` : `${no}${v.first ? ` — ${v.first}` : ""}`,
    }));
    return [...stock, ...orders];
  }, [jobs]);
  const job = jobs.find((j) => j.id === jobId) ?? null;
  // REWORK job: the repair is already charged to the customer on the RMA, so there is
  // no rate sheet — each section instead offers the worker list + an OPEN price that
  // becomes that worker's payout. A ₱0 declaration (no sections) is still allowed.
  const isRework = !!job && isReworkItem(job.item_desc);
  // Fulfillment route chosen at declaration: 'warehouse' → goes to warehouse
  // Receiving QC after HR approval; 'pickup' → collected at the workshop (skips it).
  const [fulfillment, setFulfillment] = useState<"warehouse" | "pickup">("warehouse");
  // Ang stock build ay LAGING dumadaan sa bodega — walang customer na
  // pupuntahan, kaya hindi mapipili ang ruta.
  const isStock = !!job?.stock_request;
  useEffect(() => { if (isStock) setFulfillment("warehouse"); }, [isStock]);

  // A declaration can cover BOTH skills (e.g. a sofa = Carpentry frame + Upholstery).
  // One independent block PER section; each has its own base/workers/add-ons and is
  // optional (skip a section by leaving its base unselected). On submit each active
  // section becomes its own declaration so its workers are paid its own subtotal.
  type SecState = { baseId: number | ""; addonIds: Set<number>; workerIds: Set<number>; addonsOpen: boolean; workersOpen: boolean; helperId: number | ""; helperPrice: number | ""; wPrices: Record<number, number | ""> };
  const blank = (): SecState => ({ baseId: "", addonIds: new Set(), workerIds: new Set(), addonsOpen: false, workersOpen: false, helperId: "", helperPrice: "", wPrices: {} });
  const [sec, setSec] = useState<Record<string, SecState>>(() => Object.fromEntries(sections.map((s) => [s, blank()])));
  // QC sign-off = LAGING ang naka-login na account — hindi na pinipili, para
  // walang maling pangalan (at sa kanya mapupunta ang QC inspection fee).
  const qcSel = qcName || qcStaff[0]?.name || "";
  const upd = (name: string, patch: Partial<SecState>) => setSec((p) => ({ ...p, [name]: { ...(p[name] ?? blank()), ...patch } }));
  const st = (name: string): SecState => sec[name] ?? blank();

  // worker skill = part after "- " in role ("GMA Project Base - Carpentry" → "Carpentry")
  const workerSkill = (w: (typeof workers)[number]) => ((w.role || "").split(" - ").pop() ?? "").trim().toLowerCase();
  const sectionWorkers = (name: string) => workers.filter((w) => workerSkill(w) === name.trim().toLowerCase());

  const basesOf = (name: string) => rates.filter((r) => r.section === name && r.kind === "base");
  const addonsOf = (name: string) => rates.filter((r) => r.section === name && r.kind === "addon");
  const baseOf = (name: string) => basesOf(name).find((b) => b.id === st(name).baseId) ?? null;
  const selAddonsOf = (name: string) => addonsOf(name).filter((a) => st(name).addonIds.has(a.id));
  const helperAmtOf = (name: string) => Number(st(name).helperPrice) || 0;
  // Rework: WALANG presyo dito — si HR ang maglalagay ng sahod bawat worker sa approve.
  const subtotalOf = (name: string) => (isRework ? 0 : (baseOf(name)?.amount ?? 0) + selAddonsOf(name).reduce((s, a) => s + a.amount, 0)) + helperAmtOf(name);
  const selWorkersOf = (name: string) => workers.filter((w) => st(name).workerIds.has(w.id)).map((w) => ({ id: w.id, name: w.name }));

  // Rework: piniling worker ang nag-a-activate ng section (walang base rate).
  const activeSections = sections.filter((s) => (isRework ? st(s).workerIds.size > 0 : st(s).baseId !== ""));
  const total = activeSections.reduce((s, n) => s + subtotalOf(n), 0);

  // QC CHECKLIST — ang MAIN item, at ang mga NAPILING ADD-ONS (2026-08-26).
  //
  // May sariling hilera ang BASE RATE ng bawat seksyon noon — pero ang base ay
  // ang mismong item: "Carpentry · All sizes (including legs)" ay kaparehong
  // kama ng main. Kaya ang isang kama na may dalawang seksyon ay humihingi ng
  // limang set ng litrato para sa tatlong bagay — 25 kuha — at ang dalawang
  // review screen ay itinatago pa naman ang base (filter c.type !== "base"):
  // kinukunan, hindi tinitingnan.
  //
  // Ngayon: ang main item, at ang bawat add-on na napili. Iyon lang ang
  // hiwalay na bagay na dapat may litrato, sa lahat ng category.
  const MIN_PHOTOS = 5;
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const mainName = (job?.item_desc ?? "").split("\n")[0] || "Main item";
  //
  // ANG BAWAT PIYESANG IPINALIT AY SARILING HILERA (hiling 2026-08-28). Ang
  // rework ay may isang hilera lang noon — ang buong item — kaya ang apat na
  // piyesang binayaran ng customer ay walang sariling katibayan: hindi
  // mapapatunayan na nailagay nga ang lift mechanism at hindi lang ang slat.
  const checklistItems = [
    ...(job ? [{ key: "main", name: mainName, type: "main" as const, section: null as string | null }] : []),
    ...(job?.rework_parts ?? []).map((pt, i) => ({
      key: `p${i}`,
      name: `${pt.qty > 1 ? `${pt.qty}× ` : ""}${pt.part}`,
      type: "part" as const,
      section: null as string | null,
    })),
    ...activeSections.flatMap((n) =>
      selAddonsOf(n).map((a) => ({ key: `a${n}-${a.id}`, name: `${n} · ${a.name}`, type: "addon" as const, section: n })),
    ),
  ];
  const doneCount = checklistItems.filter((it) => (photos[it.key]?.length ?? 0) >= MIN_PHOTOS).length;
  const allPhotographed = checklistItems.length > 0 && doneCount === checklistItems.length;

  const inp = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm";

  const toggleAddon = (name: string, id: number) => upd(name, { addonIds: (() => { const n = new Set(st(name).addonIds); n.has(id) ? n.delete(id) : n.add(id); return n; })() });
  const toggleWorker = (name: string, id: number) => upd(name, { workerIds: (() => { const n = new Set(st(name).workerIds); n.has(id) ? n.delete(id) : n.add(id); return n; })() });

  // validation shared by both steps: ≥1 active section; every active section needs ≥1 worker.
  // A REWORK may skip the sections entirely (₱0 declaration).
  function validate(): string | null {
    if (!job) return "Select the Order # (done job) first.";
    if (activeSections.length === 0 && !isRework) return "Select a base rate for at least one section (Carpentry / Upholstery).";
    for (const n of activeSections) if (st(n).workerIds.size === 0) return `Select at least one ${n} worker (Made By) — they get paid for this.`;
    return null;
  }

  function proceed() {
    const e = validate();
    if (e) { setError(e); return; }
    setError(null); setStep(2);
  }

  function submit() {
    const e = validate();
    if (e) { setError(e); return; }
    if (!allPhotographed) { setError(`Add at least ${MIN_PHOTOS} photos for each QC checklist item before sending.`); return; }
    setError(null);
    start(async () => {
      // REWORK with no sections filled: a single ₱0 declaration — the repair is
      // already charged on the RMA, this just records the QC + moves the pipeline.
      if (activeSections.length === 0 && isRework) {
        const res = await declareQc({
          order_id: job!.order_id, order_number: job!.order_number, workshop: data.active?.name ?? null,
          job_id: job!.id,
          qc_name: qcSel || null, workers: [],
          item: (job!.item_desc ?? "") || null, item_image: job!.image_url ?? null,
          category: "Rework", base_amount: 0, add_ons: [],
          checklist: checklistItems.map((it) => ({ name: it.name, type: it.type, photos: photos[it.key] ?? [] })),
          fulfillment,
        });
        if ("error" in res) { setError(res.error); return; }
        setOkMsg(`✓ ${job!.order_number ?? "Item"} declared — sent to HR Approval.`);
        setJobId(""); setStep(1); setPhotos({}); setFulfillment("warehouse");
        setSec(Object.fromEntries(sections.map((s) => [s, blank()])));
        router.refresh();
        onClose();
        return;
      }
      // REWORK na may workers: ISANG declaration/row para sa BUONG rework — lahat
      // ng napiling workers (Carpentry + Upholstery) na may kanya-kanyang open
      // price sa `amount`; ang HR approve ang magbabayad bawat isa sa sarili
      // niyang presyo. Section column = "Rework".
      if (isRework) {
        // Walang presyo dito — section lang ang dala ng bawat worker; si HR ang
        // maglalagay ng amount bawat isa sa approve.
        const workersAll = activeSections.flatMap((n) =>
          selWorkersOf(n).map((w) => ({ ...w, section: n })));
        const res = await declareQc({
          order_id: job!.order_id, order_number: job!.order_number, workshop: data.active?.name ?? null,
          job_id: job!.id,
          qc_name: qcSel || null, workers: workersAll,
          item: (job!.item_desc ?? "") || null, item_image: job!.image_url ?? null,
          category: "Rework", base_amount: 0, add_ons: [],
          checklist: checklistItems.map((it) => ({ name: it.name, type: it.type, photos: photos[it.key] ?? [] })),
          fulfillment,
        });
        if ("error" in res) { setError(res.error); return; }
        setOkMsg(`✓ ${job!.order_number ?? "Item"} declared — sent to HR Approval.`);
        setJobId(""); setStep(1); setPhotos({}); setFulfillment("warehouse");
        setSec(Object.fromEntries(sections.map((s) => [s, blank()])));
        router.refresh();
        onClose();
        return;
      }
      // ISANG declaration/row para sa BUONG order — lahat ng active sections
      // (Carpentry + Upholstery) at helpers sa iisang record. Bawat worker ay may
      // sariling `amount` (section subtotal / helper price) — ang HR approve ang
      // magbabayad kanya-kanya (walang hatian).
      {
        const workersAll: { id: number; name: string; amount: number; section: string }[] = [];
        const addOnsAll: { name: string; amount: number }[] = [];
        for (const n of activeSections) {
          const secAmt = (baseOf(n)?.amount ?? 0) + selAddonsOf(n).reduce((s, a) => s + a.amount, 0);
          workersAll.push(...selWorkersOf(n).map((w) => ({ ...w, amount: secAmt, section: n })));
          addOnsAll.push(...selAddonsOf(n).map((a) => ({ name: `${n} · ${a.name}`, amount: a.amount })));
          const helper = workers.find((w) => w.id === st(n).helperId);
          const helperAmt = helperAmtOf(n);
          if (helper && helperAmt > 0) workersAll.push({ id: helper.id, name: helper.name, amount: helperAmt, section: `${n} · Helper` });
        }
        const addonsTotal = addOnsAll.reduce((s, a) => s + a.amount, 0);
        const res = await declareQc({
          order_id: job!.order_id, order_number: job!.order_number, workshop: data.active?.name ?? null,
          job_id: job!.id,
          qc_name: qcSel || null, workers: workersAll,
          item: (job!.item_desc ?? "") || null, item_image: job!.image_url ?? null,
          category: activeSections.join(" + "), base_amount: total - addonsTotal,
          add_ons: addOnsAll,
          checklist: checklistItems.map((it) => ({ name: it.name, type: it.type, photos: photos[it.key] ?? [] })),
          fulfillment,
        });
        if ("error" in res) { setError(res.error); return; }
      }
      // Success → reset the form, refresh, and close the popup.
      setOkMsg(`✓ ${job!.order_number ?? "Item"} declared — sent to HR Approval.`);
      setJobId(""); setStep(1); setPhotos({}); setFulfillment("warehouse");
      setSec(Object.fromEntries(sections.map((s) => [s, blank()])));
      router.refresh();
      onClose();
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      {/* DALAWANG TUDLING (2026-08-26) — kapareho ng Installation, New Return at
          RMA review. Isang mahabang tudling ito noon: ang apat na spec ng isang
          mattress ay nagtutulak ng route, ng bayad at ng total sa ilalim ng
          screen, at kailangang mag-scroll bago pa makita kung magkano ang
          babayaran. */}
      <div className="my-6 w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl lg:max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 rounded-t-2xl px-5 py-3.5 text-[#f4ead8]" style={{ background: "linear-gradient(to bottom, #52421d, #4a3b1a)" }}>

          <div className="min-w-0 flex-1"><div className="text-sm font-bold tracking-wide">Declare Completed Item</div><div className="text-[11px] opacity-80">{data.active?.name} · Project-base QC → HR approval → weekly payout</div></div>
          <button onClick={onClose} className="ml-1 text-xl leading-none text-[#e7dcc4] hover:text-white">×</button>
        </div>
        <div className="space-y-3 p-4">
          {okMsg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{okMsg}</div>}
          <div className="flex items-center gap-2 text-[11px] font-bold">
            <span className={step === 1 ? "text-[#4a3b1a]" : "text-muted"}>① Details</span>
            <span className="text-muted">›</span>
            <span className={step === 2 ? "text-[#4a3b1a]" : "text-muted"}>② Checklist</span>
          </div>
          {step === 1 && (<>
          <div className="grid gap-x-5 gap-y-3 lg:grid-cols-2">
          {/* KALIWA — ANO ang idinedeklara: order, item, spec */}
          <div className="min-w-0 space-y-3">

          <Field label="Source order *">
            <select value={orderNo} onChange={(e) => {
              const k = e.target.value;
              setOrderNo(k);
              // Iisa lang ang item (laging ganito ang stock build)? Wala nang
              // pipiliin — piliin na ito agad.
              const only = k.startsWith("stock:")
                ? jobs.filter((j) => j.stock_request && String(j.id) === k.slice(6))
                : jobs.filter((j) => !j.stock_request && (j.order_number ?? "") === k);
              setJobId(only.length === 1 ? only[0].id : "");
              setSec(Object.fromEntries(sections.map((s) => [s, blank()])));
              setPhotos({});
            }} className={inp}>
              <option value="">— select —</option>
              {orderOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
          {orderNo && orderJobs.length > 0 && (
            <div className="block">
              <span className="mb-1 block text-xs font-medium text-muted">
                {orderNo.startsWith("stock:") ? "Item to declare" : `Pick item from order (${orderJobs.length})`}
              </span>
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-stone-50/60 p-1.5">
                {orderJobs.map((j) => {
                  const name = (j.item_desc ?? "").split("\n")[0].trim();
                  const active = jobId === j.id;
                  return (
                    <button
                      type="button"
                      key={j.id}
                      onClick={() => { setJobId(j.id); setSec(Object.fromEntries(sections.map((s) => [s, blank()]))); setPhotos({}); }}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                        active ? "border-primary bg-[#efe9d8] ring-1 ring-primary" : "border-border bg-surface hover:bg-stone-100",
                      )}
                    >
                      {j.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={j.image_url} alt="" className="h-10 w-10 shrink-0 rounded object-cover ring-1 ring-border" />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded bg-stone-200" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-foreground" title={name}>{name}</span>
                        <span className="block text-[11px] text-muted">{j.qty} × {j.unit_price != null ? peso2(j.unit_price) : "—"}{j.sku ? ` · ${j.sku}` : ""}</span>
                      </span>
                      {active && <span className="shrink-0 text-primary">✓</span>}
                    </button>
                  );
                })}
              </div>
              <span className="mt-1 block text-[11px] text-muted">Click an item to fill in its details.</span>
            </div>
          )}
          {job && (<>
            {isStock && (
              // Walang order ito — ipinagawa para lang magkastock. Bayad pa rin
              // ayon sa rate sheet; ang gawa ay babalik sa bodega.
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#caa45a] bg-[#faf6ec] px-3 py-2">
                <span className="rounded-full bg-[#4a3b1a] px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-[#f4ead8]">STOCK REQUEST</span>
                <span className="text-xs text-[#5c421f]">
                  No order — built for stock{job.stock_reason ? ` · ${job.stock_reason}` : ""}. Paid the same way; it returns to the warehouse.
                </span>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs font-medium text-muted">Item *</span>
                <input value={(job.item_desc ?? "").split("\n")[0]} readOnly className={cn(inp, "bg-stone-100 text-muted")} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Qty *</span>
                <input value={String(job.qty ?? 1)} readOnly className={cn(inp, "bg-stone-100 text-muted")} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">SKU (for restock)</span>
                <input value={job.sku ?? ""} readOnly className={cn(inp, "bg-stone-100 text-muted")} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Category</span>
                <input value={job.category ?? ""} readOnly className={cn(inp, "bg-stone-100 text-muted")} />
              </label>
            </div>
            {(job.item_desc ?? "").split("\n").slice(1).join("\n").trim() ? (
              <div className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Specifications / Design details</span>
                <div className="rounded-lg border border-border bg-stone-50/60 p-3">
                  <SpecFieldsView category={specCategoryOf(job.category ?? "", (job.item_desc ?? "").split("\n")[0])} specs={(job.item_desc ?? "").split("\n").slice(1).join("\n")} />
                </div>
              </div>
            ) : null}
            {/* ANG PIYESANG INAPRUBAHAN (hiling 2026-08-28). Dito nagdedeklara ng
                tapos ang QC — at ito ang listahang binayaran ng customer, kaya
                dito nakikita kung nagawa ba talaga ang lahat bago i-sign-off. */}
            {(job.rework_parts?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-amber-700">Approved replacement parts</span>
                <ul className="space-y-0.5 text-[12.5px] text-amber-900">
                  {job.rework_parts.map((pt, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2">
                      <span><span className="text-amber-500">•</span> <span className="font-semibold">{pt.qty > 1 ? `${pt.qty}× ` : ""}{pt.part}</span></span>
                      {pt.amount > 0 && <span className="shrink-0 tabular-nums text-amber-700">{peso2(pt.amount)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>)}

          </div>

          {/* KANAN — ANG GAWAIN: saan ito pupunta, magkano, sinong nag-sign-off */}
          <div className="min-w-0 space-y-3">

          {/* Fulfillment route — where the item goes after HR approves this QC.
              Ang stock build ay laging To Warehouse: walang order, kaya walang
              customer na pupuntahan — naka-lock ito. */}
          <Field label={isStock ? "Fulfillment route — locked for a stock build" : "Fulfillment route"}>
            <div className="grid grid-cols-2 gap-2">
              {([["warehouse", "To Warehouse", "Goes through warehouse Receiving QC"], ["pickup", "Direct Pickup", "Collected at the workshop — skips warehouse"]] as const).map(([val, label, hint]) => (
                <button
                  key={val}
                  type="button"
                  disabled={isStock}
                  onClick={() => setFulfillment(val)}
                  className={cn("rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors",
                    fulfillment === val ? "border-[#4a3b1a] bg-[#faf6ec] text-[#4a3b1a] ring-1 ring-[#caa45a]" : "border-border bg-white text-muted hover:bg-stone-50",
                    isStock && "cursor-not-allowed opacity-50 hover:bg-white")}
                >
                  <div>{label}</div>
                  <div className="mt-0.5 text-[10px] font-normal text-muted">{hint}</div>
                </button>
              ))}
            </div>
          </Field>
          <p className="text-[11px] text-muted">Fill a section only if it applies. An item can have <b>both</b> Carpentry and Upholstery — each is paid to its own workers.</p>
          {sections.map((name) => {
            const s = st(name);
            const bases = basesOf(name); const addons = addonsOf(name);
            const selectedAddons = selAddonsOf(name);
            const secWorkers = sectionWorkers(name);
            const addonAmt = selectedAddons.reduce((x, a) => x + a.amount, 0);
            const on = isRework ? s.workerIds.size > 0 : s.baseId !== "";
            return (
            <div key={name} className={cn("rounded-xl border p-3 space-y-3 transition-colors", on ? "border-[#caa45a] bg-[#faf6ec]/60" : "border-border bg-stone-50/40")}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[#4a3b1a]">{name}</span>
                {on ? <span className="text-sm font-extrabold text-[#4a3b1a]">{peso2(subtotalOf(name))}</span>
                    : <span className="text-[11px] text-muted">not included</span>}
              </div>
              {/* REWORK: walang rate sheet — MULTI-select ng workers + OPEN price
                  (hinahati nang pantay sa mga napili). Walang helper dito. */}
              {isRework ? (<>
              <div>
                <p className="mb-1 text-xs font-medium text-muted">Made by — {name} workers (HR sets each worker&apos;s pay on approval)</p>
                <div className="relative">
                  <button type="button" onClick={() => upd(name, { workersOpen: !s.workersOpen })} className={cn(inp, "flex items-center justify-between text-left")}>
                    <span className={s.workerIds.size ? "" : "text-muted"}>{s.workerIds.size ? secWorkers.filter((w) => s.workerIds.has(w.id)).map((w) => w.name).join(", ") : "— skip / select workers —"}</span>
                    <span className="text-muted">▾</span>
                  </button>
                  {s.workersOpen && (
                    <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-white shadow-lg">
                      {secWorkers.length === 0 && <p className="px-3 py-2 text-xs text-muted">No {name} workers — assign role &quot;GMA Project Base - {name}&quot; in Employee Directory</p>}
                      {secWorkers.map((w) => (
                        <label key={w.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-stone-50">
                          <input type="checkbox" checked={s.workerIds.has(w.id)} onChange={() => toggleWorker(name, w.id)} className="h-4 w-4 accent-[#4a3b1a]" />
                          <span className="flex-1">{w.name}</span>
                        </label>
                      ))}
                      <div className="border-t border-border px-3 py-1.5 text-right"><button type="button" onClick={() => upd(name, { workersOpen: false })} className="text-xs font-semibold text-[#4a3b1a]">Done</button></div>
                    </div>
                  )}
                </div>
              </div>
              {on && (
                <p className="rounded-lg bg-stone-50 px-3 py-2 text-[11px] text-muted">Each worker&apos;s pay is set by HR at approval.</p>
              )}
              </>) : (<>
              {/* Base rate at Made by ay KATABI (2026-08-26) — dalawang buong-
                  lapad na dropdown na naka-stack ito noon, kaya ang isang
                  seksyon ay anim na hilera ang taas. */}
              <div className={on ? "grid grid-cols-2 gap-2" : ""}>
                <Field label="Base rate">
                  <select value={s.baseId} onChange={(e) => upd(name, { baseId: e.target.value ? Number(e.target.value) : "", addonIds: new Set(), workerIds: new Set(), addonsOpen: false })} className={inp}>
                    <option value="">— select base —</option>
                    {bases.map((b) => <option key={b.id} value={b.id}>{b.name} · {peso(b.amount)}</option>)}
                  </select>
                </Field>
                {on && (
                  <Field label="Made by (gets paid)">
                    <select value={[...s.workerIds][0] ?? ""} onChange={(e) => upd(name, { workerIds: e.target.value ? new Set([Number(e.target.value)]) : new Set() })} className={inp}>
                      <option value="">— select worker —</option>
                      {secWorkers.length === 0 && <option value="" disabled>No {name} workers — assign role &quot;GMA Project Base - {name}&quot; in Employee Directory</option>}
                      {secWorkers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </Field>
                )}
              </div>
              {on && (<>
              {/* Add-ons at Helper ay KATABI — magkasamang tatlong hilera ito
                  noon (add-ons, tapos helper + presyo). */}
              <div className="grid gap-2 sm:grid-cols-2">
              {addons.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted">Add-ons</p>
                  <div className="relative">
                    <button type="button" onClick={() => upd(name, { addonsOpen: !s.addonsOpen })} className={cn(inp, "flex items-center justify-between text-left")}>
                      <span className={s.addonIds.size ? "" : "text-muted"}>{s.addonIds.size ? `${s.addonIds.size} selected · +${peso(addonAmt)}` : "— select add-ons —"}</span>
                      <span className="text-muted">▾</span>
                    </button>
                    {s.addonsOpen && (
                      <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-[min(20rem,calc(100vw-3rem))] overflow-auto rounded-lg border border-border bg-white shadow-lg">
                        {addons.map((a) => (
                          <label key={a.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-stone-50">
                            <input type="checkbox" checked={s.addonIds.has(a.id)} onChange={() => toggleAddon(name, a.id)} className="h-4 w-4 shrink-0 accent-[#4a3b1a]" />
                            <span className="min-w-0 flex-1 truncate" title={a.name}>{a.name}</span>
                            <span className="shrink-0 font-semibold text-[#4a3b1a]">+{a.amount}</span>
                          </label>
                        ))}
                        <div className="border-t border-border px-3 py-1.5 text-right"><button type="button" onClick={() => upd(name, { addonsOpen: false })} className="text-xs font-semibold text-[#4a3b1a]">Done</button></div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Optional helper — another worker from this section, paid an open
                  (manual) price. Ang presyo ay lumalabas lang kapag may napiling
                  helper: blangkong inputan ito noon sa bawat seksyon. */}
              <div>
                <p className="mb-1 text-xs font-medium text-muted">Helper (optional)</p>
                <div className="grid grid-cols-[1fr_88px] gap-2">
                  <select value={s.helperId} onChange={(e) => upd(name, { helperId: e.target.value ? Number(e.target.value) : "" })} className={inp}>
                    <option value="">— none —</option>
                    {secWorkers.filter((w) => !s.workerIds.has(w.id)).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  {s.helperId !== "" && (
                    <input type="number" min={0} value={s.helperPrice} onChange={(e) => upd(name, { helperPrice: e.target.value === "" ? "" : Number(e.target.value) })} placeholder="₱" className={inp} title="Helper price (open)" />
                  )}
                </div>
              </div>
              </div>
              {/* TINANGGAL ANG PER-SECTION BREAKDOWN (2026-08-26) — tatlong linya
                  kada seksyon na inuulit ang halagang nasa header na ng seksyon
                  (₱1,300.00) at nasa grand total na sa ibaba. */}
              </>)}
              </>)}
            </div>
            );
          })}

          <Field label={qaFixed ? "Quality Assurance (fixed for this workshop)" : "Quality Control (sign-off)"}>
            <div className="rounded-lg border border-border bg-stone-50/40 px-3 py-2 text-sm font-semibold text-[#4a3b1a]">
              {qcSel || "—"}
              {qaFixed && <span className="ml-2 rounded bg-[#faf1dc] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8a6a1f]">QA fee goes here</span>}
            </div>
          </Field>

          <div className="rounded-xl border border-dashed border-[#caa45a] bg-[#faf6ec] p-3 text-center">
            <div className="text-[10px] uppercase tracking-wide text-muted">Project-base amount (grand total)</div>
            <div className="text-2xl font-extrabold text-[#4a3b1a]">{peso2(total)}</div>
            {activeSections.length > 0 && (
              <div className="mx-auto mt-2 max-w-xs space-y-0.5 text-left text-[11px] text-muted">
                {activeSections.map((n) => <div key={n} className="flex justify-between gap-3"><span className="truncate">{n}</span><span className="shrink-0">{peso(subtotalOf(n))}</span></div>)}
                <div className="mt-0.5 flex justify-between gap-3 border-t border-[#e6dcc4] pt-1 font-bold text-[#4a3b1a]"><span>Total</span><span>{peso(total)}</span></div>
              </div>
            )}
          </div>
          {isRework && activeSections.length === 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Rework — no rate sheet: pick the workers per section (HR sets each worker&apos;s pay on approval), or proceed with none. The QC checklist still applies.</p>
          )}
          </div>
          </div>

          {/* Ang pindutan ay tumatawid sa dalawang tudling — iisang hakbang ito,
              hindi bahagi ng kahit alin sa dalawa. */}
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
          <button onClick={proceed} className="w-full rounded-lg bg-[#4a3b1a] px-4 py-2.5 text-sm font-bold text-[#f4ead8] hover:opacity-90">Proceed to Checklist →</button>
          </>)}

          {step === 2 && (<>
          <button type="button" onClick={() => setStep(1)} className="text-xs font-semibold text-muted hover:text-foreground">← Back to details</button>
          {checklistItems.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-[#e6dcc4] bg-white shadow-sm ring-1 ring-black/[0.03]">
              {/* header + progress */}
              <div className="relative overflow-hidden border-b border-[#e6dcc4] bg-[#4a3b1a] bg-gradient-to-br from-[#4a3b1a] via-[#5c4a22] to-[#3a2e18] px-4 py-3.5 text-[#f4ead8]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">

                    <div className="leading-tight">
                      <div className="text-sm font-bold">QC Photo Checklist</div>
                      <div className="flex items-center gap-1 text-[10px] opacity-80">Security record — tamper-proof proof of quality</div>
                    </div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums", allPhotographed ? "bg-emerald-400 text-emerald-950" : "bg-[#caa45a] text-[#3a2e20]")}>{doneCount}/{checklistItems.length} done</span>
                </div>
                <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-black/30">
                  <div className={cn("h-full rounded-full transition-all duration-300", allPhotographed ? "bg-emerald-400" : "bg-[#caa45a]")} style={{ width: `${(doneCount / checklistItems.length) * 100}%` }} />
                </div>
                <p className="mt-2 text-[11px] opacity-85">Upload <b>at least {MIN_PHOTOS} photos</b> per item. Capture different angles — front, back, sides, joints, finish.</p>
                {/* Ang piyesa ay ibang katibayan: hindi anggulo ng tapos na
                    kama ang hinahanap doon kundi na NAILAGAY nga ang ipinalit. */}
                {checklistItems.some((c) => c.type === "part") && (
                  <p className="mt-1 text-[11px] opacity-85">For each <b>replacement part</b>, photograph the part fitted in place — that is what proves it was actually installed.</p>
                )}
              </div>
              <div className="space-y-2.5 bg-[#fbf8f1] p-3">
                {/* ANG PIYESANG INAPRUBAHAN, SA TAAS NG KATIBAYAN (hiling
                    2026-08-28). Nasa Details tab lang ito, at ang Checklist ay
                    hiwalay na tab — kaya habang kinukunan ng litrato ang bawat
                    piyesa, wala nang makikitang listahan ng dapat ipalit. */}
                {(job?.rework_parts?.length ?? 0) > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-2.5">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-amber-700">Approved replacement parts</span>
                    <ul className="space-y-0.5 text-[12.5px] text-amber-900">
                      {job!.rework_parts.map((pt, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-2">
                          <span><span className="text-amber-500">•</span> <span className="font-semibold">{pt.qty > 1 ? `${pt.qty}× ` : ""}{pt.part}</span></span>
                          {pt.amount > 0 && <span className="shrink-0 tabular-nums text-amber-700">{peso2(pt.amount)}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {checklistItems.map((it, idx) => {
                  const n = photos[it.key]?.length ?? 0;
                  const ok = n >= MIN_PHOTOS;
                  const pct = Math.min(100, (n / MIN_PHOTOS) * 100);
                  return (
                  <div key={it.key} className={cn("overflow-hidden rounded-xl border bg-white shadow-sm transition-all", ok ? "border-emerald-300 ring-1 ring-emerald-200" : "border-[#e6dcc4]")}>
                    <div className={cn("flex items-center gap-2.5 px-3 py-2.5 transition-colors", ok ? "bg-emerald-50/70" : "bg-stone-50/70")}>
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow", ok ? "bg-emerald-500" : "bg-[#caa45a]")}>{ok ? "✓" : idx + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold text-[#3a2e20]">
                          <span className="truncate">{it.name}</span>
                          {it.type === "main" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">main item</span>}{it.type === "part" && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">replacement part</span>}
                          {it.type === "addon" && <span className="rounded bg-[#caa45a]/20 px-1.5 py-0.5 text-[10px] font-medium text-[#7a5e1f]">add-on</span>}
                        </div>
                        <div className="mt-1 h-1 w-full max-w-[160px] overflow-hidden rounded-full bg-stone-200">
                          <div className={cn("h-full rounded-full transition-all", ok ? "bg-emerald-500" : "bg-[#caa45a]")} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums", ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{ok ? `✓ ${n}` : `${n}/${MIN_PHOTOS}`} photos</span>
                    </div>
                    <div className="p-3 pt-2.5">
                      <MultiImageUpload value={photos[it.key] ?? []} onChange={(u) => setPhotos((p) => ({ ...p, [it.key]: u }))} camera folder={`qc/${job?.order_number || "unsorted"}`} />
                    </div>
                  </div>
                  );
                })}
              </div>
              {!allPhotographed && (
                <div className="flex items-center gap-2 border-t border-[#e6dcc4] bg-amber-50 px-4 py-2.5 text-[11px] font-medium text-amber-800">
                  {checklistItems.length - doneCount} item{checklistItems.length - doneCount === 1 ? "" : "s"} still need {MIN_PHOTOS}+ photos before you can declare.
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-dashed border-[#caa45a] bg-[#faf6ec] p-3 text-center">
            <div className="text-[10px] uppercase tracking-wide text-muted">Project-base amount (grand total)</div>
            <div className="text-2xl font-extrabold text-[#4a3b1a]">{peso2(total)}</div>
            {activeSections.length > 0 && (
              <div className="mx-auto mt-2 max-w-xs space-y-0.5 text-left text-[11px] text-muted">
                {activeSections.map((n) => <div key={n} className="flex justify-between gap-3"><span className="truncate">{n}</span><span className="shrink-0">{peso(subtotalOf(n))}</span></div>)}
                <div className="mt-0.5 flex justify-between gap-3 border-t border-[#e6dcc4] pt-1 font-bold text-[#4a3b1a]"><span>Total</span><span>{peso(total)}</span></div>
              </div>
            )}
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
          <button onClick={submit} disabled={pending} className="w-full rounded-lg bg-[#4a3b1a] px-4 py-2.5 text-sm font-bold text-[#f4ead8] hover:opacity-90 disabled:opacity-60">
            {pending ? "Declaring…" : "＋ Declare → send to HR Approval"}
          </button>
          </>)}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-muted">{label}</span>{children}</label>;
}
function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums", accent)}>{value}</p>
    </div>
  );
}
