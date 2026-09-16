"use client";

import { useMemo, useState, useTransition, useEffect } from "react";
import type { ReactNode } from "react";
import { realValue } from "@/lib/product-columns";
import { useRouter } from "next/navigation";
import { cn, SpecRows, isPickupTask, PickupTag, ReworkCell } from "./ui";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { MultiImageUpload } from "./multi-image-upload";
import { sizedImg } from "./thumbnail";
import { EmployeePicker, type EmpOpt } from "./employee-picker";
import type { DeliveryData, Delivery, DeliveryQaItem, TeamMeta } from "@/app/delivery/data";
import { RushBadge } from "./rush-badge";
import { saveDelivery, deleteDelivery, startDelivery, savePackingProof, type DeliveryInput } from "@/app/delivery/actions";
// LAZY ang native-tts (2026-08-27): ang Capacitor TTS plugin ay humahawak ng
// `window` sa mismong module evaluation — ang static import ay nagpapasabog ng
// SSR ("window is not defined", recoverable pero maingay at mabagal). Kapareho
// na ng pickup-tasks: dynamic import, sa client lang tumatakbo.
const tts = () => import("@/lib/native-tts");
import { ProductPreviewModal, previewFromItem, type ProductPreview } from "./product-preview-modal";
import { SpecFieldsView } from "./spec-fields-input";
import { specCategoryOf } from "./line-items-editor";

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const MIN_PACK_PHOTOS = 5;
const DEFECT_TYPES = ["Scratched", "Dented", "Chipped", "Cracked", "Wrong color", "Wrong size", "Missing parts", "Loose joints", "Torn / damaged fabric", "Stained", "Misaligned", "Broken", "Other"];
const TIME_WINDOWS = ["8AM-12PM", "12PM-3PM", "1PM-5PM", "3PM-6PM", "9AM-6PM", "Whole Day"];
// Route Planner auto windows (per stop #) — auto-fill ng Time Window sa modal
// kapag naka-book na sa planner ang stop pero walang manual na window.
const PLANNER_WINDOWS = ["9–11 AM", "11 AM–1 PM", "1–3 PM", "3–5 PM"];
// Exact dispatch time, formatted ("Jun 25, 10:26 PM") — used to auto-fill the Time Window.
function fmtDispatch(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}
const peso = (n: number) => "₱" + (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function statusPill(s: string) {
  const v = (s ?? "").toLowerCase();
  if (/delivered/.test(v)) return "bg-green-50 text-green-700";
  if (/arrived/.test(v)) return "bg-teal-50 text-teal-700";
  if (/out for/.test(v)) return "bg-blue-50 text-blue-700";
  if (/qc passed|qa passed/.test(v)) return "bg-violet-50 text-violet-700";
  if (/failed/.test(v)) return "bg-rose-50 text-rose-700";
  return "bg-amber-50 text-amber-700";
}

export function DeliveryManager({ data, drivers = [], qaNames = [], coordinators = [] }: { data: DeliveryData; drivers?: EmpOpt[]; qaNames?: EmpOpt[]; coordinators?: EmpOpt[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Delivery | null>(null);

  // B5 · SUSUNOD NA STOP: ang mga hinto ng parehong team sa parehong araw, ayon sa
  // dq_stop. Ipinapasa sa modal para masabi ng driver map kung ano ang kasunod
  // pagkatapos ng Arrived — dating kailangang bumalik sa listahan at buksan ulit.
  const routeStops = useMemo(
    () =>
      data.rows
        .filter((r) => r.dq_team && r.dq_date && !/delivered|failed|cancel/i.test(r.status ?? ""))
        .slice()
        .sort((a, b) => (a.dq_stop ?? 999) - (b.dq_stop ?? 999))
        .map((r) => ({ order: r.order_number, team: r.dq_team, date: r.dq_date, stop: r.dq_stop, customer: r.customer_name, address: r.address })),
    [data.rows],
  );

  // Binubuksan ang isang delivery nang diretso mula sa URL: ?open=ORD-000123.
  // Ginagamit ng "Navigate →" na buton ng driver map pagkatapos ng Arrived —
  // kung wala ito, walang mangyayari sa pagpindot at mukhang sira.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("open");
    if (!want) return;
    const hit = data.rows.find((r) => r.order_number === want);
    // Sinasadya: isang beses na deep-link pagbukas ng page — hindi ito loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hit) setOpen(hit);
    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    window.history.replaceState(null, "", url.toString());
  }, [data.rows]);

  // DALAWANG TANAW (hiling 2026-08-29) — kaparehong hati ng Installation
  // Tracking. Ang gagawin pa at ang tapos na ay pinagsasama sa isang listahan,
  // kaya ang biyaheng kailangang ihanda ngayon ay nakahalo sa mga naihatid na
  // noong nakaraang linggo. Ang naihatid AT ang bumagsak ay pareho nang tapos:
  // wala nang gagawin sa dalawa mula rito.
  const [tab, setTab] = useState<"work" | "done">("work");
  const isDone = (r: Delivery) => /delivered|failed|cancel/i.test(r.status ?? "");

  const scoped = useMemo(
    () => data.rows.filter((r) => (tab === "done" ? isDone(r) : !isDone(r))),
    [data.rows, tab],
  );
  const doneCount = useMemo(() => data.rows.filter(isDone).length, [data.rows]);
  const workCount = data.rows.length - doneCount;

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return scoped.filter((r) => !s || [r.order_number, r.customer_name, r.sales_rep, r.driver_team, r.status].some((x) => (x ?? "").toLowerCase().includes(s)));
  }, [scoped, q]);

  const pg = usePagination(rows);

  return (
    <div className="space-y-5">
      <div className="apk-hide grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="To Schedule" value={String(data.kpi.toSched)} accent="bg-amber-100 text-amber-600" />
        <Kpi label="QA Passed" value={String(data.kpi.qaPassed)} accent="bg-violet-100 text-violet-600" />
        <Kpi label="Out for Delivery" value={String(data.kpi.outForDelivery)} accent="bg-blue-100 text-blue-600" />
        <Kpi label="Delivered" value={String(data.kpi.delivered)} accent="bg-green-100 text-green-600" />
        <Kpi label="COD Due" value={peso(data.kpi.codDue)} accent="bg-primary/10 text-primary" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order / customer / driver…" className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
        <span className="text-xs text-muted">
          {tab === "done"
            ? "Finished trips — delivered, failed and cancelled."
            : "Auto-listed from Sales Orders · click a row to schedule & deliver"}
        </span>
        {/* Sa DULO ng toolbar, gaya ng Installation: ang hanapan ang pangunahing
            gamit dito, at ang paglipat ng tanaw ay bihira. */}
        <div className="ml-auto flex gap-1.5">
          {([["work", "Pending", workCount], ["done", "Completed", doneCount]] as const).map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={cn("rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors",
                tab === k ? "bg-[#4a3b1a] text-[#f4ead8]" : "border border-border bg-surface text-muted hover:bg-stone-100")}>
              {label} · {n}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-visible rounded-xl border border-border bg-surface shadow-sm">
        <div className="max-h-[70vh] overflow-auto rounded-t-xl">
        <table className="w-full min-w-[920px] border-collapse text-sm border-collapse [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <colgroup>
            <col span={6} />
            <col span={5} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={6} className="border-b border-[#caa45a] px-5 py-2">Order</th>
              <th colSpan={5} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Delivery</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="px-4 py-3">Order #</th>
              <th className="px-4 py-3">RMA #</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Sales Rep</th>
              {/* KUKUNAN muna, tapos PATUTUNGUHAN — ganoon ang pagkakasunod
                  ng biyahe. Ang "Address" lang ay malabo sa tabi ng Pickup
                  Location: dalawang lugar ang nasa hilera. */}
              <th className="px-4 py-3">Pickup Location</th>
              <th className="px-4 py-3">Delivery Location</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Sched.</th>
              <th className="px-4 py-3">Balance</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-12 text-center text-muted">No deliverable orders. Completed/committed Sales Orders appear here.</td></tr>
            ) : pg.slice.map((r) => (
              <tr key={r.order_id ?? r.id} onClick={() => setOpen(r)} className="cursor-pointer border-b border-border last:border-0 hover:bg-stone-50">
                <td className="px-4 py-3 font-semibold">
                  <div className="flex flex-col items-center gap-1">
                    <RushBadge isRush={r.is_rush} dateOrder={r.date_order} threshold={r.rush_days ?? data.rushThreshold} done={/delivered/i.test(r.status ?? "")} />
                    <span>{r.order_number || "—"}</span>
                    {isPickupTask(r.items_summary) && <PickupTag />}
                    {/* PARTIAL na tag (2026-09-01): batch ito, hindi buong
                        order — ilan ang sakay sa kabuuan. */}
                    {r.partial_batch && (
                      <span className="whitespace-nowrap rounded-full bg-[#faf1dc] px-2 py-0.5 text-[10px] font-bold text-[#8a6a1f] ring-1 ring-inset ring-[#caa45a]/40">
                        PARTIAL · {r.partial_batch.thisCount} of {r.partial_batch.totalCount}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center"><ReworkCell isRework={r.is_rework} rmaNo={r.rma_no} leg={r.rework_wear ?? r.rework_leg} /></td>
                <td className="px-4 py-3">{r.customer_name || "—"}</td>
                <td className="px-4 py-3 text-center">{r.sales_rep || "—"}</td>
                <td className="px-4 py-3 text-center">
                  {r.pickup_location
                    ? <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">{r.pickup_location}</span>
                    : <span className="text-muted/50">—</span>}
                </td>
                <td className="px-4 py-3 text-muted">{r.address || "—"}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center text-muted">{r.schedule_date || "—"}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{peso(r.balance_due)}</td>
                <td className="px-4 py-3 text-center text-muted">{r.dq_team || "—"}</td>
                <td className="px-4 py-3 text-center text-muted">{r.driver_team || "—"}</td>
                <td className="px-4 py-3 text-center"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusPill(r.status))}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <PaginationFooter {...pg} />
      </div>

      {open && <DeliveryModal d={open} routeStops={routeStops} onClose={() => setOpen(null)} drivers={drivers} qaNames={qaNames} coordinators={coordinators} teams={data.teams} lastCoordinator={data.lastCoordinator} />}
    </div>
  );
}

// Exported — ginagamit din ng Driver Routes (row click = same modal).
export function DeliveryModal({ d, routeStops = [], onClose, drivers = [], qaNames = [], coordinators = [], teams = [], lastCoordinator = null, readOnly = false }: { d: Delivery; routeStops?: RouteStop[]; onClose: () => void; drivers?: EmpOpt[]; qaNames?: EmpOpt[]; coordinators?: EmpOpt[]; teams?: TeamMeta[]; lastCoordinator?: string | null; readOnly?: boolean }) {
  const [pending, start] = useTransition();
  const [delPending, startDel] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Ang meta ng team — driver at sasakyan — mula sa delivery_teams (0205-era).
  const teamOf = (name: string | null | undefined) => {
    const n = (name ?? "").trim().toLowerCase();
    return n ? teams.find((t) => t.name.trim().toLowerCase() === n) ?? null : null;
  };
  const [h, setH] = useState({
    order_id: d?.order_id ?? null as number | null,
    order_number: d.order_number ?? "",
    customer_name: d.customer_name ?? "",
    contact: d.contact ?? "",
    address: d.address ?? "",
    sales_rep: d.sales_rep ?? "",
    items_summary: d.items_summary ?? "",
    total_amount: d.total_amount ?? 0,
    paid_amount: d.paid_amount ?? 0,
    schedule_date: d.schedule_date || new Date().toLocaleDateString("en-CA"), // default to today (local YYYY-MM-DD)
    // Auto-fill: manual window → planner window (dq) → computed AUTO window ng
    // team+date run (server, kapareho ng Route table) → exact dispatch time.
    time_window: d.time_window
      || (d as { dq_window?: string | null }).dq_window
      || (d as { auto_window?: string | null }).auto_window
      || fmtDispatch(d.started_at),
    // AUTOFILL MULA SA RUTA (hiling 2026-08-28). Ang team ay naitalaga na sa
    // Route Planner (`dq_team`) at ang sasakyan ay nasa `delivery_teams` —
    // itinatanong pa rin ito noon na parang walang nakaalam, at ang tatlong
    // hanay ay blangko kahit may nakatakda nang lahat. Ang naitala sa row ay
    // laging nauuna: kung may pinalitan, iyon ang totoo.
    driver_team: d.driver_team || d.dq_team || "",
    // Ang coordinator ay walang kawing sa team — iisang tao ang nag-aayos ng
    // araw — kaya ang huling ginamit ang panimula.
    coordinator: d.coordinator || lastCoordinator || "",
    vehicle_plate: d.vehicle_plate || teamOf(d.driver_team || d.dq_team)?.vehicle || "",
    qa_by: d.qa_by ?? "",
    payment_collected: d.payment_collected ?? 0,
    received_by: d.received_by ?? "",
    status: /^(to schedule)$/i.test(d.status ?? "") ? "Scheduled" : (d.status ?? "Scheduled"),
    notes: d.notes ?? "",
  });
  const setHF = (k: keyof typeof h, v: string | number | null) => setH((p) => ({ ...p, [k]: v }));

  // Driver confirmed arrival inside the live map (iframe) → auto-close the map + flip status to Arrived.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const m = e.data;
      if (m && m.type === "driver-arrived" && (!m.order || m.order === d.order_number)) {
        setHF("status", "Arrived");
        router.refresh();
      }
      // COLLECT leg (pickup sa workshop): 'item-collected' ang ipinapadala ng
      // mapa, hindi 'driver-arrived' — i-refresh para lumipat ang Live
      // Tracking sa susunod na leg (papunta na sa customer). Hindi Arrived ang
      // status: nasa workshop pa lang, hindi pa sa customer.
      if (m && m.type === "item-collected" && (!m.order || m.order === d.order_number)) {
        router.refresh();
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.order_number]);


  const [qa, setQa] = useState<DeliveryQaItem[]>(d.qa_items ?? []);
  // PRODUCT DETAILS kada item (2026-08-23) - parehong modal ng Orders/Operations:
  // larawan, SKU/Category/Color/Qty, at ang flat na Specifications card.
  const [preview, setPreview] = useState<ProductPreview | null>(null);
  const updQa = (i: number, p: Partial<DeliveryQaItem>) => setQa((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const [proof, setProof] = useState<string[]>(d.proof_url ? [d.proof_url] : []);

  // Packing proof (must reach ≥5 before dispatch is allowed). Pre-filled if already packed.
  // LITRATO NG PAGBABALOT KADA PRODUKTO (hiling 2026-08-29). Isang bunton kada
  // order ito noon, kaya sa pitong gamit ay walang makapagsasabi kung alin ang
  // kay alin — at kayang ipadala ang lahat sa limang litrato ng iisa.
  // Nakahanay sa qa, gaya ng item_photos sa Installation. Ang LUMANG talaan ay
  // may isang order-wide na listahan lang, kaya ipinapatong ito sa UNANG
  // produkto — doon ito nakikita imbes na maglaho.
  const [itemPack, setItemPack] = useState<string[][]>(() => {
    const per = d.item_packing_photos ?? [];
    // WALANG HIRAM NA PATUNAY SA REWORK (naranasan 2026-08-29). Ang deliveries
    // row ay isa kada order at muling ginagamit sa bawat biyahe, kaya hawak pa
    // nito ang `packing_photos` ng UNANG hatid. Ang pagpatong niyon sa unang
    // produkto ay nagbigay ng walong litrato sa isang redelivery na hindi pa
    // binubuksan — at dahil `packOk` na, kayang mag-dispatch nang walang bagong
    // litrato. Ang lumang bunton ay sa lumang biyahe.
    const seed = d.is_rework ? [] : (d.packing_photos ?? []);
    return (d.qa_items ?? []).map((_, i) => per[i] ?? (i === 0 && !per.length ? seed : []));
  });
  const packPhotos = useMemo(() => itemPack.flat(), [itemPack]);
  // May bagong litrato ba mula sa huling pagkakasellyo. Kapag wala, hindi na
  // muling isinusulat ng Save Delivery ang packing — walang bagong selyo, at
  // hindi napapalitan ang `packed_at` ng isang pag-save na hindi naman
  // tungkol sa pagbabalot.
  const packDirty = useMemo(
    // Kaparehong hugis ng panimula sa itaas — kung maghiwalay sila, laging
    // "dirty" ang packing at muling isusulat ng bawat Save Delivery ang selyo.
    () => JSON.stringify(itemPack) !== JSON.stringify(
      (d.qa_items ?? []).map((_, i) => (d.item_packing_photos ?? [])[i]
        ?? (i === 0 && !(d.item_packing_photos ?? []).length ? (d.is_rework ? [] : (d.packing_photos ?? [])) : [])),
    ),
    [itemPack, d.qa_items, d.item_packing_photos, d.packing_photos, d.is_rework],
  );
  // ALIN ANG BUKAS (hiling 2026-08-29) — kaparehong hulma ng Installation. Ang
  // bawat produkto ay may 240px na larawan, SpecRows, buong SPECIFICATIONS card,
  // QA at Packing Photos: tatlong gamit ay limang screen ng scroll. Hanggang
  // DALAWA ay bukas agad; tatlo pataas ay nakatiklop, doon nagsisimula ang haba.
  const AUTO_OPEN_MAX = 2;
  const [openQa, setOpenQa] = useState<Set<number>>(
    () => new Set((d.qa_items ?? []).length <= AUTO_OPEN_MAX ? (d.qa_items ?? []).map((_, i) => i) : []),
  );
  const toggleQa = (i: number) => setOpenQa((p) => {
    const next = new Set(p);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  // Alin ang kulang pa. Lima KADA produkto — kaparehong tseke sa server
  // (savePackingProof), kung saan ito talaga hinaharang.
  // ON-SITE REPAIR: WALANG DALA (hiling 2026-08-29). Pupunta lang sila sa bahay
  // ng customer para kumpunihin doon mismo — walang ikinakarga at walang
  // inihahatid. Ang Pre-Delivery QA at ang Packing Proof ay parehong tungkol sa
  // isang gamit na aalis sa bodega; wala silang sinasagot dito. Ang kailangan
  // lang ay ang mapa papunta sa customer.
  const onsiteVisit = !!d.is_rework && d.rework_mode === "onsite";
  const packShort = onsiteVisit ? [] : itemPack.map((a, i) => i).filter((i) => (itemPack[i]?.length ?? 0) < MIN_PACK_PHOTOS);
  // NAKABALOT NA BA. Ang naitalang `packed_at` ay isang sagot; ang isa pa ay
  // ang nakikita mismo ng nagbabalot ngayon — lahat ng produkto ay may lima.
  // Kailangan ang pangalawa dahil ang selyo ay nakasakay na sa Save Delivery:
  // kung `packed_at` lang ang tinatanong, hindi mapipindot ang Start Delivery
  // hangga't hindi isinasara at binubuksan muli ang modal.
  // Walang pagbabalot sa on-site, kaya walang haharangin — handa nang umalis.
  const isPacked = onsiteVisit || !!d.packed_at || (itemPack.length > 0 && packShort.length === 0);

  // PARTIAL: ang singil ng BATCH (galing sa data — items + shipping ng unang
  // biyahe − bayad), hindi ang buong balanse ng order (2026-09-01).
  const balance = d.partial_batch
    ? Number(d.balance_due) || 0
    : Math.max((Number(h.total_amount) || 0) - (Number(h.paid_amount) || 0), 0);
  const qaAllGood = qa.length > 0 && qa.every((x) => Number(x.defect_qty || 0) === 0 && Number(x.good_qty || 0) >= Number(x.qty || 0));

  function submit() {
    if (!h.customer_name.trim()) { setError("Pick a Sales Order first."); return; }
    setError(null);
    const input: DeliveryInput = {
      id: d.id, order_id: h.order_id, order_number: h.order_number || null, customer_name: h.customer_name || null,
      contact: h.contact || null, address: h.address || null, sales_rep: h.sales_rep || null, items_summary: h.items_summary || null,
      total_amount: Number(h.total_amount) || 0, paid_amount: Number(h.paid_amount) || 0, balance_due: balance,
      schedule_date: h.schedule_date || null, time_window: h.time_window || null, driver_team: h.driver_team || null, coordinator: h.coordinator || null, vehicle_plate: h.vehicle_plate || null,
      qa_status: qaAllGood ? "Passed" : qa.some((x) => Number(x.defect_qty) > 0) ? "Failed" : "Pending", qa_by: h.qa_by || null,
      payment_collected: 0, payment_method: null, collected_by: null, // payment is collected at Installation, not delivery
      received_by: h.received_by || null, proof_url: proof[0] ?? null,
      status: h.status, notes: h.notes || null,
      qa_items: qa.map((it) => ({ id: it.id, description: it.description, image_url: it.image_url, sku: it.sku, category: it.category, color: it.color, dimension: it.dimension, qty: it.qty, good_qty: it.good_qty, defect_qty: it.defect_qty, photo_url: it.photo_url, checked_by: it.checked_by, remarks: it.remarks })),
    };
    start(async () => {
      // ISANG PINDOT (hiling 2026-08-29) — kaparehong Installation, kung saan
      // ang Save Installation ang nagsesellyo ng lahat. May sariling buton ang
      // packing dito dahil hindi ito naisusulat ng saveDelivery: hiwalay na
      // action ito (savePackingProof), at binubura pa nga ng repurpose ang
      // packing. Kaya sinusulat muna ito rito kapag may binago — hindi buton na
      // dapat pang hanapin ng nagbabalot.
      if (packDirty) {
        const pr = await savePackingProof({
          order_id: h.order_id, order_number: h.order_number || null, customer_name: h.customer_name || null,
          photos: packPhotos, item_photos: itemPack, packed_by: h.qa_by || null,
        });
        if ("error" in pr) { setError(pr.error); return; }
      }
      const res = await saveDelivery(input);
      if ("error" in res) { setError(res.error); return; }
      router.refresh(); onClose();
    });
  }
  function remove() {
    if (!d.id) return;
    const id = d.id;
    startDel(async () => { const res = await deleteDelivery(id); if ("error" in res) { setError(res.error); return; } router.refresh(); onClose(); });
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-6xl rounded-2xl bg-surface shadow-xl 2xl:max-w-[92rem]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Delivery · {h.order_number} · {h.customer_name}
            {d.partial_batch && (
              <span className="rounded-full bg-[#faf1dc] px-2 py-0.5 text-[10px] font-bold text-[#8a6a1f] ring-1 ring-inset ring-[#caa45a]/40">
                PARTIAL · {d.partial_batch.thisCount} of {d.partial_batch.totalCount}
              </span>
            )}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
        </div>
        {/* LOCKED pagkatapos ng Arrived/Delivered — view-only sa teams; ang server
            (saveDelivery) ang tunay na harang para sa hindi Admin/Ops Manager. */}
        {readOnly && (
          <p className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs font-semibold text-amber-800">
            Locked — this delivery is already Delivered. Only an Admin or Operations Manager can edit it.
          </p>
        )}
        <fieldset disabled={readOnly} className="contents">

        {/* BALANSE ANG DALAWANG HANAY (2026-08-27): isang mahabang kolum ito
            noon — Order → Packing → Schedule → QA → Notes, lahat pababa, kaya
            kailangang mag-scroll hanggang dulo bago makita ang Save. Ang
            Pre-Delivery QA ang pinakamahaba (larawan + 7 spec + good/defect),
            kaya nag-iisa ito sa KANAN; ang apat na maiikli ay sa kaliwa.

            Sa ON-SITE, ang kanan ay "Item to repair" — ang gamit lang, walang
            QA at walang packing. Dalawang tudling pa rin: may laman siya. */}
        <div className="grid gap-x-4 border-b border-border lg:grid-cols-2 lg:divide-x lg:divide-border">
          <div className="min-w-0 py-2">

        {/* Order (auto from Sales Order) */}
        <Section title="Order" plain>
          <SpecRows
            items={[
              ["Customer", h.customer_name],
              ["Sales Rep", h.sales_rep],
              ["Address", h.address],
              // Landmark — pantapos sa huling 50m; kita rin ng driver sa route.
              ...(d.landmark ? [["Landmark", d.landmark] as [string, string]] : []),
              // ANG RMA ANG PAKSA SA REWORK (2026-08-29). Ang ₱4,055 dito ay
              // ang singil ng repair — piyesa at biyahe — hindi ang ₱60,000 na
              // halaga ng order. Ang basta "Total" ay nagmumukhang halaga ng
              // binili, at malaki ang pagkakaiba ng dalawa.
              [d.is_rework ? `Repair charge${d.rma_no ? ` · ${d.rma_no}` : ""}` : "Total", peso(h.total_amount)],
              ["Paid", peso(h.paid_amount)],
              [d.is_rework ? "Collect on arrival" : "Balance Due", peso(balance)],
            ]}
          />
          <div className="mt-3">
            <F label="Contact"><input value={h.contact} onChange={(e) => setHF("contact", e.target.value)} className={cn(inp, "w-full")} /></F>
          </div>
        </Section>

        {/* Schedule */}
        <Section title="Schedule" plain>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <F label="Delivery Date"><input type="date" value={h.schedule_date} onChange={(e) => setHF("schedule_date", e.target.value)} className={cn(inp, "w-full")} /></F>
            <F label="Time Window">
              <select value={h.time_window} onChange={(e) => setHF("time_window", e.target.value)} className={cn(inp, "w-full")}>
                <option value="">— select —</option>
                {h.time_window && !TIME_WINDOWS.includes(h.time_window) && <option value={h.time_window}>{h.time_window}</option>}
                {TIME_WINDOWS.map((t) => <option key={t}>{t}</option>)}
              </select>
              {d.started_at && <p className="mt-1 text-[11px] font-medium text-sky-700">Out for delivery: {fmtDispatch(d.started_at)}</p>}
            </F>
            <F label="Delivery Coordinator"><EmployeePicker value={h.coordinator} onChange={(v) => setHF("coordinator", v)} options={coordinators} className={cn(inp, "w-full")} /></F>
            {/* Ang sasakyan ay sumusunod sa team (2026-08-28): isang plaka kada
                team sa delivery_teams. Ang manu-manong naitype ay hindi
                pinapalitan — may pagkakataong ibang sasakyan ang ginamit. */}
            <F label="Driver / Team"><EmployeePicker value={h.driver_team} onChange={(v) => {
              setHF("driver_team", v);
              const plate = teamOf(v)?.vehicle;
              if (plate && !h.vehicle_plate) setHF("vehicle_plate", plate);
            }} options={drivers} className={cn(inp, "w-full")} /></F>
            <F label="Vehicle / Plate"><input value={h.vehicle_plate} onChange={(e) => setHF("vehicle_plate", e.target.value)} className={cn(inp, "w-full")} /></F>
            {/* Ang `isPacked` ay hindi na lang ang naitalang `packed_at`: kasama
                nito ang nakikitang lima kada produkto ngayon. Kung `d.packed`
                lang ang tinatanong, hindi mapipindot ang Start Delivery hangga't
                hindi isinasara at binubuksan muli ang modal — nakasakay na kasi
                ang selyo sa Save Delivery. */}
            <LiveTrackingCard d={isPacked ? { ...d, packed: true } : d} routeStops={routeStops} status={h.status}
              onStarted={() => setHF("status", "Out for Delivery")}
              beforeStart={async () => {
                if (!packDirty) return null;
                const r = await savePackingProof({
                  order_id: h.order_id, order_number: h.order_number || null, customer_name: h.customer_name || null,
                  photos: packPhotos, item_photos: itemPack, packed_by: h.qa_by || null,
                });
                if ("error" in r) { setError(r.error); return r.error; }
                return null;
              }} />
          </div>
        </Section>

        {/* ILALAGAY SA BLANGKONG ESPASYO SA KALIWA (2026-08-27) — buong
            lapad ito sa ibaba noon, kaya may malaking blangko sa ilalim ng
            Schedule habang mahaba ang kanan.

            ANG PATUNAY AY KINUKUHA SA MAPA, HINDI DITO (inalis 2026-08-25).
            May manual na uploader dito noon — Signature / POD Photo — pero ang
            tunay na patunay ay nasa Arrived flow ng mapa: pumipirma ang
            tumatanggap at kumukuha ng litrato ang driver sa mismong pintuan,
            nakasellyo sa oras ng pagdating. Ang uploader ay pangalawang daanan
            sa iisang bagay: mapupuno nang wala sa lugar at wala sa oras. Ang
            naitala ng mapa ay nananatili, read-only.

            Received by + Status ay tinago na rin — automatic ang status
            (dispatch → OFD, map Arrived, install → Delivered) at ang pangalan
            ng tumanggap ay nasa arrival proof na. */}
        {(d.signature_url || (d.proof_photos && d.proof_photos.length > 0)) && (
          <Section title="Proof of Delivery" plain>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
              <p className="mb-2 text-xs font-semibold text-emerald-800">Driver arrival proof{d.arrived_at ? ` · ${new Date(d.arrived_at).toLocaleString()}` : ""}</p>
              {d.signature_url && (
                <div className="mb-2">
                  <p className="mb-1 text-[11px] font-medium text-muted">Driver signature</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.signature_url} alt="driver signature" className="h-20 rounded border border-border bg-white object-contain" />
                </div>
              )}
              {d.proof_photos && d.proof_photos.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted">On-site photos ({d.proof_photos.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {d.proof_photos.map((u, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a key={i} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt={`proof ${i + 1}`} className="h-16 w-16 rounded border border-border object-cover" /></a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

          </div>
          <div className="min-w-0 py-2">

        {/* ON-SITE: ANG GAMIT LANG, WALANG GATE (2026-08-29). Sobra ang inalis
            noong itinago ang buong QA section — kailangan pa ring makita ng crew
            kung ANO ang aayusin: larawan, pangalan, SKU, at ang build. Ang
            walang saysay ay ang QA (good/defect ng dalang karga) at ang packing;
            hindi ang produkto mismo. */}
        {onsiteVisit && (
        <Section title="Item to repair" plain>
          {qa.length === 0 ? <p className="py-4 text-center text-sm text-muted">No items on this order.</p> : (
            <div className="space-y-3">
              {qa.map((it, i) => {
                const name = (it.description || "").split("\n")[0] || "—";
                const rows: [string, ReactNode][] = [
                  ["Product / Name", name],
                  ...(it.sku ? [["SKU", <span key="sku" className="font-mono">{it.sku}</span>] as [string, ReactNode]] : []),
                  ...(realValue(it.category) ? [["Category", realValue(it.category)] as [string, ReactNode]] : []),
                  ...(realValue(it.color) ? [["Color", realValue(it.color)] as [string, ReactNode]] : []),
                  ["Qty", String(it.qty)],
                ];
                return (
                  <div key={i} className="overflow-hidden rounded-xl border border-[#e6dcc4] bg-stone-50/50 shadow-sm">
                    <div className="space-y-3 p-3">
                      <button type="button" onClick={() => setPreview(previewFromItem(it, d.order_number))} className="block w-full overflow-hidden rounded-xl border border-border bg-white" title="Open product details">
                        {it.image_url
                          ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={it.image_url} alt="" className="mx-auto max-h-52 w-full object-contain p-2" />
                          : <div className="flex h-32 items-center justify-center text-muted">No image</div>}
                      </button>
                      <SpecRows items={rows} />
                      {it.specs && <SpecFieldsView category={specCategoryOf(it.category, name)} specs={it.specs} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
        )}

        {/* Pre-delivery QA */}
        {!onsiteVisit && (
        <Section title={`Pre-Delivery QA ${qaAllGood ? "· ✓ PASSED" : ""}`} plain>
          {/* DECLARE RETURN — nasa Installation Tracking na (hiling 2026-08-29).
              Ang installer ang huling nakahawak sa gamit at siya ang nakakakita
              ng sira habang binubuo ito; ang QA rito ay bago pa ang biyahe. */}
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <F label="Checked by"><EmployeePicker value={h.qa_by} onChange={(v) => setHF("qa_by", v)} options={qaNames} className={cn(inp, "w-56")} /></F>
          </div>
          {/* PRODUCT DETAILS kada item (hiling 2026-08-23): parehong anyo ng Orders at
              My Jobs - larawan, Product/Name, SKU, Category, Color, Qty, at ang flat na
              Specifications. Pinalitan nito ang table + hiwalay na specs (doble). */}
          {/* ILAN NA ANG NAKABALOT. Nakatiklop ang mga bloke, kaya kailangan ng
              isang linyang nagsasabi ng natitira — kung hindi, kailangan pang
              buksan ang lahat para malaman. */}
          {qa.length > 1 && (() => {
            const ok = qa.filter((_, i) => (itemPack[i]?.length ?? 0) >= MIN_PACK_PHOTOS).length;
            const all = ok === qa.length;
            return (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-stone-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {qa.length} products
                  <span className={cn("ml-2 font-extrabold tabular-nums", all ? "text-emerald-700" : "text-[#a8842e]")}>
                    {ok} of {qa.length} packed
                  </span>
                </p>
                <button type="button"
                  onClick={() => setOpenQa(openQa.size ? new Set() : new Set(qa.map((_, i) => i)))}
                  className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted hover:bg-stone-100">
                  {openQa.size ? "Collapse all" : "Expand all"}
                </button>
              </div>
            );
          })()}
          {qa.length === 0 ? <p className="py-4 text-center text-sm text-muted">No items on this order.</p> : (
            <div className="space-y-2">
              {qa.map((it, i) => {
                const name = (it.description || "").split("\n")[0] || "—";
                const rows: [string, ReactNode][] = [
                  ["Product / Name", name],
                  ...(it.sku ? [["SKU", <span key="sku" className="font-mono">{it.sku}</span>] as [string, ReactNode]] : []),
                  ...(realValue(it.category) ? [["Category", realValue(it.category)] as [string, ReactNode]] : []),
                  ...(realValue(it.color) ? [["Color", realValue(it.color)] as [string, ReactNode]] : []),
                  ["Qty", String(it.qty)],
                ];
                const px = itemPack[i] ?? [];
                const packOk = px.length >= MIN_PACK_PHOTOS;
                const checked = (it.good_qty || 0) > 0 || (it.defect_qty || 0) > 0;
                const bad = (it.defect_qty || 0) > 0;
                const isOpen = openQa.has(i);
                return (
                  <div key={i} className={cn("overflow-hidden rounded-xl border bg-stone-50/50 shadow-sm transition-colors",
                    bad ? "border-rose-300" : packOk && checked ? "border-emerald-300" : isOpen ? "border-[#caa45a]" : "border-[#e6dcc4]")}>
                    {/* NAKATIKLOP (2026-08-29) — kaparehong hilera ng Installation.
                        Ang buod ay nagsasabi kung ano ito at ano ang kulang;
                        isang pindot para sa gawain mismo. */}
                    <button type="button" onClick={() => toggleQa(i)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-stone-100/60">
                      <span className="w-5 shrink-0 text-center text-[11px] font-extrabold tabular-nums text-muted">{i + 1}</span>
                      {it.image_url
                        ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={it.image_url} alt="" className="h-11 w-11 shrink-0 rounded-lg border border-border bg-white object-contain" />
                        : <span className="h-11 w-11 shrink-0 rounded-lg border border-dashed border-border bg-white" />}
                      <span className="min-w-0 flex-1">
                        <span className="truncate block text-sm font-semibold">{name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                          {it.sku && <span className="font-mono">{it.sku}</span>}
                          <span>Qty {it.qty}</span>
                          <span className={cn("font-semibold", packOk ? "text-emerald-700" : "text-[#a8842e]")}>
                            {px.length} / {MIN_PACK_PHOTOS} packed
                          </span>
                          {bad && <span className="font-semibold text-rose-700">{it.defect_qty} defect{it.remarks ? ` · ${it.remarks}` : ""}</span>}
                        </span>
                      </span>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide",
                        bad ? "bg-rose-100 text-rose-700" : packOk ? "bg-emerald-100 text-emerald-700" : "bg-[#f5ecd6] text-[#8a6a1f]")}>
                        {bad ? "Defect" : packOk ? "✓ Packed" : "To pack"}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{isOpen ? "−" : "+"}</span>
                    </button>

                    {isOpen && (
                    <div className="space-y-3 border-t border-border bg-white/60 p-3">
                      <button type="button" onClick={() => setPreview(previewFromItem(it, d.order_number))} className="block w-full overflow-hidden rounded-xl border border-border bg-white" title="Open product details">
                        {it.image_url
                          ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={it.image_url} alt="" className="mx-auto max-h-44 w-full object-contain p-2" />
                          : <div className="flex h-32 items-center justify-center text-muted">No image</div>}
                      </button>
                      <SpecRows items={rows} />
                      {it.specs && <SpecFieldsView category={specCategoryOf(it.category, name)} specs={it.specs} />}
                      {/* QA - Good / Defect / Remarks (dating mga column ng table) - parehong hulma
                          ng ibang field ng modal: label sa taas, tatlong hanay, buong lapad. Ang
                          Remarks ay laging naroon (naka-disable hanggang may defect) para hindi
                          lumulukso ang layout kapag nagtipa ng defect. */}
                      <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-white p-3">
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Good</span>
                          <input type="number" min={0} value={it.good_qty || ""} onChange={(e) => updQa(i, { good_qty: Number(e.target.value) })} className={cn(inp, "w-full text-center bg-green-50")} />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Defect</span>
                          <input type="number" min={0} value={it.defect_qty || ""} onChange={(e) => updQa(i, { defect_qty: Number(e.target.value) })} className={cn(inp, "w-full text-center", (it.defect_qty || 0) > 0 && "bg-rose-50 text-rose-700")} />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Remarks</span>
                          <select value={it.remarks ?? ""} disabled={!((it.defect_qty || 0) > 0)} onChange={(e) => updQa(i, { remarks: e.target.value })} className={cn(inp, "w-full", (it.defect_qty || 0) > 0 ? "border-rose-300" : "text-muted")}>
                            <option value="">{(it.defect_qty || 0) > 0 ? "— select defect —" : "— no defect —"}</option>
                            {DEFECT_TYPES.map((t) => <option key={t}>{t}</option>)}
                          </select>
                        </label>
                      </div>
                      {/* PACKING PROOF NG PRODUKTONG ITO (hiling 2026-08-29) —
                          dating isang card sa kabilang tudling para sa buong
                          order, kaya sa pitong gamit ay iisang bunton at
                          kayang makalusot ang lahat sa limang litrato ng iisa. */}
                      <div className={cn("overflow-hidden rounded-lg border-2 transition-colors", packOk ? "border-emerald-300" : "border-[#caa45a]")}>
                        <div className={cn("flex items-center justify-between gap-2 px-3 py-2", packOk ? "bg-emerald-600" : "bg-[#4a3b1a]")}>
                          <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-white">
                            Packing Photos
                            {!packOk && <span className="ml-1 text-rose-300">*</span>}
                          </p>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-extrabold tabular-nums", packOk ? "bg-white text-emerald-700" : "bg-[#caa45a] text-[#3a2e12]")}>
                            {packOk ? `✓ ${px.length}` : `${px.length} / ${MIN_PACK_PHOTOS}`}
                          </span>
                        </div>
                        <div className="bg-white p-3">
                          <p className="mb-2 text-[11px] text-muted">
                            Proof this item was <b className="text-foreground">packed correctly</b> — front, back, sealed, label.
                            {!packOk && <b className="text-rose-600"> Required before dispatch.</b>}
                          </p>
                          <MultiImageUpload
                            value={px} camera
                            onChange={(arr) => setItemPack((p) => p.map((v, j) => (j === i ? arr : v)))}
                            folder={`packing/${d.order_number || d.order_id || "unsorted"}`}
                          />
                        </div>
                      </div>
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
        )}

        {/* ANG HINDI KASYA SA LISTAHAN NG SIRA: "iniwan sa guard, wala ang
            may-ari", "nagtanong ng resibo". Ang notes ay naitatabi na noon pa
            (tingnan ang saveDelivery) — walang lugar lang na maisusulat. */}
        <Section title="Notes" plain>
          <textarea
            value={h.notes ?? ""}
            onChange={(e) => setHF("notes", e.target.value)}
            rows={2}
            placeholder="Anything worth recording about this delivery"
            className={cn(inp, "w-full resize-y")}
          />
        </Section>
          </div>
        </div>


        </fieldset>
        {error && <p className="px-5 pb-2 text-sm text-rose-600">{error}</p>}
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          {d.id && !readOnly ? <button onClick={remove} disabled={delPending} className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">{delPending ? "Deleting…" : "Reset"}</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-stone-100">{readOnly ? "Close" : "Cancel"}</button>
            {!readOnly && <button onClick={submit} disabled={pending} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{pending ? "Saving…" : "Save Delivery"}</button>}
          </div>
        </div>
      </div>
    </div>
    <ProductPreviewModal item={preview} onClose={() => setPreview(null)} />
    </>
  );
}

// Build the parametrized URL for the standalone live map page (same engine as driver-preview).
function liveMapSrc(d: Delivery, origin?: { lat: number; lng: number } | null) {
  const q = new URLSearchParams();
  if (d.address_lat != null && d.address_lng != null) { q.set("dlat", String(d.address_lat)); q.set("dlng", String(d.address_lng)); }
  else if (d.address) q.set("addr", d.address);
  // ANG SARIWANG GPS ANG PANALO (2026-08-27). Ang d.driver_lat ay ang huling
  // pin sa SERVER — null pa sa sandali ng Start Delivery, kaya ang mapa ay
  // nagsisimula sa pekeng puntong ~5km ang layo hanggang dumating ang unang
  // fix. Kinukuha na ng clickStart ang tunay na posisyon bago buksan ang mapa;
  // ipasa ito para agad na kasalukuyang lokasyon → customer ang ruta.
  if (origin) { q.set("olat", String(origin.lat)); q.set("olng", String(origin.lng)); }
  else if (d.driver_lat != null && d.driver_lng != null) { q.set("olat", String(d.driver_lat)); q.set("olng", String(d.driver_lng)); }
  if (d.order_number) q.set("order", d.order_number);
  if (d.customer_name) q.set("name", d.customer_name);
  if (d.contact) q.set("phone", d.contact);
  // Alternative contact (0224) — ipinapakita sa driver map na kasama ang relasyon.
  if (d.alt_contact) { q.set("altphone", d.alt_contact); if (d.alt_relation) q.set("altrel", d.alt_relation); }
  // Cache-buster: bump when delivery-map.html changes so the WebView/browser can't serve
  // a stale copy of the map page. NAKALIMUTAN ITONG I-BUMP (2026-08-22) sa buong
  // araw ng pagbabago — kaya lumang HTML pa rin ang ipinapakita ng WebView at ng
  // browser: lumang banner na hindi nawawala, at LUMANG VOICE CODE na walang
  // native TTS. Kapag may binago sa delivery-map.html, PALITAN ITO.
  q.set("v", "nav-0907e");
  return `/delivery-map.html?${q.toString()}`;
}

// Live Tracking card shown in the Schedule grid (the spot beside Vehicle/Plate).
type RouteStop = { order: string | null; team: string | null; date: string | null; stop: number | null; customer: string | null; address: string | null };

// `beforeStart` — ang packing ay naka-save na kasabay ng Save Delivery, kaya
// maaaring may litratong nasa screen pa lang at hindi pa naitatala. Ang server
// ay tumatanggi ng dispatch na walang `packed_at`, kaya isinusulat ito muna
// rito: mas mabuti kaysa sa butong mukhang mapipindot pero tinatanggihan.
function LiveTrackingCard({ d, routeStops = [], status, onStarted, beforeStart }: { d: Delivery; routeStops?: RouteStop[]; status: string; onStarted: () => void; beforeStart?: () => Promise<string | null> }) {
  // Sariwang GPS mula sa Start tap — ito ang origin ng mapa, hindi ang stale
  // na server pin (tingnan ang liveMapSrc).
  const [freshOrigin, setFreshOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, start] = useTransition();
  const [showMap, setShowMap] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const router = useRouter();

  // When the driver confirms arrival inside the map iframe, close the full-screen map.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const m = e.data;
      if (m && (m.type === "driver-arrived" || m.type === "item-collected") && (!m.order || m.order === d.order_number)) {
        setShowMap(false);
        setMinimized(false);
        router.refresh();
      }
      // B5: hinahanap ng mapa kung ano ang kasunod sa ruta pagkatapos ng Arrived.
      if (m && m.type === "next-stop-request" && m.order === d.order_number) {
        const mine = routeStops.filter((r) => r.team === d.dq_team && r.date === d.dq_date);
        const i = mine.findIndex((r) => r.order === d.order_number);
        const next = i >= 0 ? mine[i + 1] : null;
        if (next?.order) {
          (e.source as Window | null)?.postMessage(
            { type: "next-stop", order: next.order, customer: next.customer, address: next.address },
            "*",
          );
        }
      }
      // Pindot sa "Navigate →": isara ang mapa at buksan ang susunod na delivery.
      if (m && m.type === "open-stop" && m.order) {
        setShowMap(false);
        router.push(`/delivery?open=${encodeURIComponent(m.order)}`);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.order_number]);

  // Waze turn-by-turn VOICE relay: hindi maabot ng map iframe ang native TTS
  // plugin, kaya ipinapadala nito ang bawat prompt dito.
  //
  // ANG PLUGIN AY NAKAREHISTRO LANG KAPAG NA-IMPORT (2026-08-22): dating
  // binabasa ito mula sa window.Capacitor.Plugins.TextToSpeech nang walang
  // sinumang nag-i-import ng package — kaya hindi ito kailanman pumapasok sa
  // bundle at `undefined` ang plugin sa APK. Tahimik itong nahuhulog sa web
  // speechSynthesis, na hindi umaandar sa Android WebView: WALANG TUNOG ang
  // driver. Ang lib/native-tts.ts ang nagpaparehistro at nagbibigay ng
  // native-muna, web-fallback na daanan.
  useEffect(() => {
    if (!showMap) return;
    // Ihanda ang engine bago pa ang unang liko — kung hindi, ang unang prompt
    // ang nauubos sa pag-init ng Android TTS.
    void tts().then((m) => m.warmUpTts());
    function onSpeak(e: MessageEvent) {
      const m = e.data;
      if (!m || (m.type !== "nav-speak" && m.type !== "nav-speak-stop")) return;
      if (m.type === "nav-speak-stop") { void tts().then((t) => t.stopNav()); return; }
      void tts().then((t) => t.speakNav(String(m.text || "")));
    }
    window.addEventListener("message", onSpeak);
    return () => { window.removeEventListener("message", onSpeak); void tts().then((t) => t.stopNav()); };
  }, [showMap]);
  const delivered = /delivered/i.test(status);
  const arrived = /arrived/i.test(status);
  const live = /out for delivery/i.test(status);
  // Already dispatched (Out for Delivery / Arrived / Installation / Delivered) → no restart.
  const dispatched = d.started_at != null || /out for delivery|arrived|installation|delivered/i.test(status);
  const hasDriver = d.driver_lat != null && d.driver_lng != null;
  const hasDest = d.address_lat != null && d.address_lng != null;
  let dist: string | null = null;
  if (hasDriver && hasDest) {
    const R = 6371, r = (x: number) => (x * Math.PI) / 180;
    const dLat = r(d.address_lat! - d.driver_lat!), dLng = r(d.address_lng! - d.driver_lng!);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(d.driver_lat!)) * Math.cos(r(d.address_lat!)) * Math.sin(dLng / 2) ** 2;
    const km = R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    dist = km >= 1 ? km.toFixed(1) + " km" : Math.round(km * 1000) + " m";
  }
  function clickStart() {
    // Ang pindot na ito ang gesture na nagbubukas ng web audio (Windows app at
    // desktop): kung wala, ang unang prompt na awtomatikong pumuputok ay tahimik
    // na binabalewala at wala nang maririnig pagkatapos.
    // Inline ang web-speech unlock — kailangang tumakbo SA LOOB ng gesture;
    // ang async import ay maaaring lumagpas sa gesture window.
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis?.speak(u);
    } catch { /* walang speech synthesis */ }
    // Ipaalam sa map iframe na may gesture na — doon nito bubuksan ang sarili
    // nitong audio (magkaibang browsing context, magkaibang unlock).
    setTimeout(() => { try { (document.querySelector('iframe[title="Live delivery map"]') as HTMLIFrameElement | null)?.contentWindow?.postMessage({ type: "audio-unlock" }, "*"); } catch { /* ignore */ } }, 1200);
    onStarted();  // instantly flip the Status dropdown to Out for Delivery
    start(async () => {
      // Ask for GPS RIGHT HERE (inside the Start tap) BEFORE showing the map. This
      // one prompt grants the whole site location permission, so the map iframe we
      // open next is already connected — the driver never taps "Allow" again and
      // never presses anything but "Start Delivery". Also gives us the origin pin.
      let start_lat: number | null = null, start_lng: number | null = null;
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) => {
          if (!navigator.geolocation) return rej(new Error("no geolocation"));
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
        });
        start_lat = pos.coords.latitude; start_lng = pos.coords.longitude;
        setFreshOrigin({ lat: start_lat, lng: start_lng });
      } catch { /* denied / unavailable → the map still shows; it just can't stream */ }
      // Permission settled → open the full-screen in-app map (already GPS-connected).
      setMinimized(false); setShowMap(true);
      const pre = beforeStart ? await beforeStart() : null;
      if (pre) { setShowMap(false); return; }
      await startDelivery({ order_id: d.order_id, order_number: d.order_number, customer_name: d.customer_name, address: d.address, start_lat, start_lng });
      router.refresh();
    });
  }
  const pill = delivered || arrived ? "bg-green-100 text-green-700" : live ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-600";
  return (
    <div className="col-span-2 rounded-xl border-2 border-[#caa45a] bg-gradient-to-b from-[#fffaf0] to-white p-3 shadow-[0_0_0_4px_rgba(202,164,90,.12)] md:col-span-1">
      <div className="flex items-center gap-2 text-sm font-bold text-[#4a3b1a]">
        Live Tracking
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold", pill)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", live ? "animate-pulse bg-amber-500" : delivered ? "bg-green-500" : "bg-stone-400")} />{status}
        </span>
      </div>
      <div className="mt-1.5 text-xs text-muted">
        {delivered ? "Delivery completed" : arrived ? "Driver arrived — PIN verified" : hasDriver ? <>Driver <b className="text-foreground">{dist ?? "—"}</b> away</> : "Driver location not yet shared"}
      </div>
      {delivered ? (
        <button type="button" disabled className="mt-2 w-full cursor-not-allowed rounded-lg bg-stone-300 px-3 py-2 text-xs font-bold text-stone-500">✓ Delivered</button>
      ) : arrived ? (
        <button type="button" disabled className="mt-2 w-full cursor-not-allowed rounded-lg bg-green-100 px-3 py-2 text-xs font-bold text-green-700">Arrived — at customer</button>
      ) : (
        <>
          {/* ON-SITE REPAIR: WALANG DALA, WALANG HARANG (2026-09-01, "di maka
              proceed kase hinihingan ng photos wala naman pag uploadan"). Ang
              packed/pickedUp na gate ay para sa biyaheng MAY KARGA — ang
              declared on-site ay pagbisita lang sa bahay para ayusin doon:
              walang binabalot, walang kinukuha sa bodega, at walang Pickup
              Task na mapag-uuploadan ng loading photo kailanman. */}
          {(() => { const onsiteVisit = !!d.is_rework && d.rework_mode === "onsite"; return (
          <>
          <button type="button" onClick={dispatched ? () => { setMinimized(false); setShowMap(true); } : clickStart} disabled={busy || (!dispatched && !onsiteVisit && (!d.packed || !d.pickedUp))} className="mt-2 w-full rounded-lg bg-[#4a3b1a] px-3 py-2 text-xs font-bold text-[#f4ead8] hover:opacity-90 disabled:opacity-50">
            {busy ? "Starting…" : dispatched ? "View Live Map" : "▶ Start Delivery"}
          </button>
          {/* Ang pickup ang huling harang: nakuha na ba talaga ito bago tumulak
              ang trak? Ang packing ang nauuna, kaya iyon muna ang sinasabi. */}
          {!dispatched && !onsiteVisit && d.packed && !d.pickedUp && (
            <p className="mt-1.5 text-center text-[11px] font-medium text-amber-700">Pick it up first — take a loading photo in Pickup Task to enable dispatch.</p>
          )}
          {!dispatched && !onsiteVisit && !d.packed && (
            <p className="mt-1.5 text-center text-[11px] font-medium text-amber-700">Pack first — upload {MIN_PACK_PHOTOS} packing photos above to enable dispatch.</p>
          )}
          </>
          ); })()}
        </>
      )}

      {/* Full-screen in-app live map (not a new tab). GPS was already granted in
          clickStart, so the iframe connects immediately — nothing else to press.
          Minimize shrinks it to a corner; it never fully closes mid-delivery. */}
      {showMap && (
        <div className={minimized ? "fixed bottom-4 right-4 z-[70]" : "fixed inset-0 z-[70] flex flex-col"}>
          <div className={minimized
            ? "flex h-[280px] w-[400px] max-w-[92vw] flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/15"
            : "flex h-full w-full flex-col overflow-hidden bg-white"}>
            <div className="flex items-center justify-between bg-[#4a3b1a] px-4 py-2.5 text-[#f4ead8]">
              <div className="flex min-w-0 items-center gap-2.5">

                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">Live Tracking · {d.order_number}</div>
                  {!minimized && <div className="truncate text-[11px] opacity-80">{d.customer_name} · {d.address}</div>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMinimized((v) => !v)}
                  title={minimized ? "Maximize" : "Minimize"}
                  className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-[#f4ead8] ring-1 ring-white/20 transition hover:bg-white/20 active:scale-95"
                >
                  {minimized ? (
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M9 3h4v4M13 3l-5 5M7 13H3v-4M3 13l5-5" /></svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 11h8" /></svg>
                  )}
                  {minimized ? "Maximize" : "Minimize"}
                </button>
              </div>
            </div>
            {/* ANG IFRAME AY WALANG AUDIO NANG WALANG PAHINTULOT. Sa iOS Safari (at sa
                Android WebView) ay tahimik ang speechSynthesis sa loob ng nested
                browsing context kung wala ang `autoplay` — kaya walang boses ang
                nabigasyon kahit tama ang code sa loob (nakita 2026-08-23). */}
            <iframe src={liveMapSrc(d, freshOrigin)} title="Live delivery map" className="w-full flex-1 border-0" allow="geolocation; autoplay" />
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, plain }: { title: string; children: React.ReactNode; plain?: boolean }) {
  // `plain` — walang border-b at manipis na padding: para sa mga Section na
  // nasa loob ng hanay (2026-08-27), kung saan ang linya sa ilalim ay humahati
  // sa gitna ng kolum at hindi na buong-lapad.
  return (
    <div className={plain ? "px-5 pb-4 pt-3" : "border-b border-border p-5"}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      {children}
    </div>
  );
}
function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <label className={cn("flex flex-col gap-1", full && "col-span-2 md:col-span-3")}><span className="text-xs font-medium text-muted">{label}</span>{children}</label>;
}
function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", accent)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg></span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
