"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { RushBadge } from "./rush-badge";
import { useRouter } from "next/navigation";
import { cn, SpecRows } from "./ui";
import { SpecFieldsView } from "./spec-fields-input";
import { specCategoryOf } from "./line-items-editor";
import { realValue } from "@/lib/product-columns";
import { peso, number } from "@/lib/format";
import { parseDescSpecs, splitDimension } from "@/lib/receipt-desc";
import { MultiImageUpload } from "./multi-image-upload";
import { Modal } from "./modal";
import { PaginationFooter, usePagination } from "@/components/pagination-footer";
import type { ReturnsData, ReturnRow, OrderOption, PoOption, WorkshopOption } from "@/app/returns/data";
import { createReturn, approveReturn, rejectReturn, markReworked, collectReworkPayment, type CreateReturnInput } from "@/app/returns/actions";

// Preset return reasons (last = "Other" → reveals a free-text box).
// value = what we store (clean, no emoji); label = what staff sees (with emoji).
const RETURN_REASONS: { value: string; label: string }[] = [
  { value: "Damaged on arrival", label: "Damaged on arrival" },
  { value: "Defective / factory defect", label: "Defective / factory defect" },
  { value: "Wrong item delivered", label: "Wrong item delivered" },
  { value: "Wrong color", label: "Wrong color" },
  { value: "Wrong size / dimension", label: "Wrong size / dimension" },
  { value: "Not as described", label: "Not as described" },
  { value: "Customer changed mind", label: "Customer changed mind" },
  { value: "Missing parts", label: "Missing parts" },
  { value: "Quality issue", label: "Quality issue" },
  { value: "Other", label: "Other" },
];

// Where the return was declared — Sales (customer called the rep) vs Delivery /
// Warehouse (defect spotted at dispatch/receiving).
function sourcePill(s: string | null) {
  const v = (s || "").toLowerCase();
  if (v === "delivery") return <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">Delivery</span>;
  if (v === "warehouse") return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Warehouse</span>;
  if (v === "sales") return <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">Sales</span>;
  return <span className="text-xs text-muted">—</span>;
}

function statusPill(s: string) {
  const v = (s || "").toLowerCase();
  if (/completed/.test(v)) return "bg-emerald-50 text-emerald-700";
  if (/rework/.test(v)) return "bg-orange-50 text-orange-700";
  if (/approved/.test(v)) return "bg-sky-50 text-sky-700";
  if (/reject/.test(v)) return "bg-rose-50 text-rose-700";
  return "bg-amber-50 text-amber-700"; // Pending
}

function when(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

// Friendly labels — kept in sync with the New-Return dropdowns so the table/modal
// read the same way the staff entered them.
const RESOLUTION_LABEL: Record<string, string> = {
  refund: "Refund money",
  replacement: "Replace item",
  credit: "Store credit",
  rtv_credit: "Supplier credit",
  rework: "Rework",
};

// Fixed rate card for replacement parts consumed by a repair. price is per unit;
// perUnit parts (e.g. Wood Slat) accept a qty, the rest default to 1.

const REWORK_PARTS: readonly { part: string; price: number; perUnit?: boolean }[] = [
  { part: "Lift mechanism", price: 4000 },
  { part: "Drawer guide", price: 1000 },
  { part: "Wood Slat", price: 1000, perUnit: true }, // per slat
  { part: "T-Slat", price: 500 },
];

// Rework shows its mode: On Site (fixed at the customer) or Pull Out (collected +
// redelivered). Falls back to the plain label for legacy rows without a mode.
function resolutionLabel(r: { resolution?: string | null; rework_mode?: string | null; rework_declared_onsite?: boolean }): string {
  if (r.resolution !== "rework") return r.resolution ? (RESOLUTION_LABEL[r.resolution] ?? r.resolution) : "—";
  // 0217: ang dineklarang on-site ay "Rework on Site" ang suot kahit ang
  // proseso ay pull-out (walang-tsek na "We are still here" — kukunin ang
  // gamit papuntang workshop). Ang pinili ng nag-declare ang mukha.
  if (r.rework_mode === "pullout") return r.rework_declared_onsite ? "Rework on Site" : "Rework on Pull Out";
  if (r.rework_mode === "onsite") return "Rework on Site";
  return RESOLUTION_LABEL.rework;
}
const REWORK_TARGET_LABEL: Record<string, string> = {
  restock: "Back to stock",
  redeliver: "Redeliver to customer",
};
// ANG PINILING BUILD NG RMA (2026-08-27): ang `returns.dimension` ay laging
// blangko — ang specs ay nasa BULLETS ng item_desc, sa ilalim ng pangalan ng
// produkto. Ito ang naghihiwalay sa kanila; ang unang linya (pangalan) ay
// tinatanggal, at ang may tutuldok lang ang spec.
function specLinesOf(itemDesc: string | null | undefined): string[] {
  return String(itemDesc ?? "")
    .split("\n")
    .slice(1)
    .map((l) => l.trim().replace(/^[•·-]+\s*/, ""))
    .filter((l) => l.includes(":"));
}

const CONDITION_LABEL: Record<string, string> = {
  resaleable: "Resellable",
  defective: "Not resellable",
};

export function ReturnsManager({ data, canApprove = false, declaredFrom, declaredTeam }: { data: ReturnsData; canApprove?: boolean; declaredFrom?: "sales" | "warehouse" | "delivery"; /** Aling delivery team ang nagdeklara (0203) — ipinapasa ng per-team dashboard. */ declaredTeam?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ReturnRow | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // DALAWANG TANAW (hiling 2026-08-28). Ang bukas pa at ang sarado na ay
  // pinagsasama sa isang listahan, kaya ang hinihintay na aksyon ay nakahalo sa
  // mga tapos na noong nakaraang linggo. Ang "Pending" ang gawain; ang
  // "Completed" ay talaan. Ang tinanggihan ay kasama sa sarado — wala nang
  // gagawin doon.
  const [tab, setTab] = useState<"open" | "done">("open");
  // TAPOS = SARADO ANG TRABAHO AT ANG PERA (hiling 2026-08-28). Ang status lang
  // ang sinusukat noon, kaya ang isang rework na naihatid na pero may natitirang
  // singil ay lumilipat sa Completed at nawawala sa harap ng mata — walang
  // maniningil, at walang makakaalala. Habang may balanse, gawain pa rin ito.
  // Ang tinanggihan ay sarado kahit walang bayad: wala nang sisingilin doon.
  const isDone = (r: ReturnRow) => {
    if (/rejected/i.test(r.status ?? "")) return true;
    if (!/completed/i.test(r.status ?? "")) return false;
    const charge = r.rework_charge_total ?? 0;
    if (r.resolution !== "rework" || charge <= 0) return true;
    return (r.rework_downpayment ?? 0) + 0.005 >= charge;
  };
  const scoped = useMemo(
    () => data.returns.filter((r) => (tab === "done" ? isDone(r) : !isDone(r))),
    [data.returns, tab],
  );
  const doneCount = useMemo(() => data.returns.filter(isDone).length, [data.returns]);
  const openCount = data.returns.length - doneCount;
  const pg = usePagination(scoped, 25);

  function act(fn: (id: number) => Promise<{ ok: true } | { error: string }>, id: number, onDone?: () => void) {
    setError(null);
    setBusyId(id);
    start(async () => {
      const res = await fn(id);
      setBusyId(null);
      if ("error" in res) { setError(res.error); return; }
      onDone?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted">{scoped.length} return record{scoped.length === 1 ? "" : "s"}</p>
        <div className="ml-auto flex gap-1.5">
          {([["open", "Pending", openCount], ["done", "Completed", doneCount]] as const).map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={cn("rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors",
                tab === k ? "bg-[#4a3b1a] text-[#f4ead8]" : "border border-border bg-surface text-muted hover:bg-stone-100")}>
              {label} · {n}
            </button>
          ))}
        </div>
        <button onClick={() => setOpen(true)} className="rounded-lg bg-[#4a3b1a] px-4 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90">
          ＋ New Return
        </button>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse text-[11px] xl:min-w-[1500px] xl:text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:px-1.5 [&_td]:py-1.5 xl:[&_td]:px-3 xl:[&_td]:py-2.5 [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:px-1.5 [&_th]:py-1.5 xl:[&_th]:px-3 xl:[&_th]:py-2.5">
            <colgroup>
              {/* 5 + 8 + 6 + 1 = 20. Ang Resolution ay 6 (hindi 5 gaya ng dati —
                  hindi tugma ang colgroup sa 19 na column), at ang Item ay 8
                  ngayong hiwalay na ang Photos sa Product Name. */}
              <col span={5} />
              <col span={8} />
              <col span={6} />
              <col span={1} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="sticky top-0 z-10 bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&_th]:bg-[#4a3b1a]">
                <th colSpan={5} className="border-b border-[#caa45a] px-5 py-2">Return</th>
                <th colSpan={8} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Item</th>
                <th colSpan={6} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Resolution</th>
                <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Action</th>
              </tr>
              <tr className="sticky top-[33px] z-10 bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&_th]:bg-[#5a4a26]">
                <th>RMA #</th><th>Order #</th><th>Type</th><th>Source</th><th>Date</th>
                <th className="!border-l-4 !border-l-[#caa45a]">Order / Supplier</th><th>Photos</th><th>Product Name</th><th>SKU</th><th>Category</th><th>Color</th><th>Specification / Design Details</th><th>Qty</th>
                <th className="!border-l-4 !border-l-[#caa45a]">Reason</th><th>Condition</th><th>Resolution</th><th>Refund</th><th>Payment</th><th>Status</th>
                <th className="!border-l-4 !border-l-[#caa45a]">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.returns.length === 0 ? (
                <tr><td colSpan={20} className="px-3 py-12 text-muted">No returns yet. Click <b>New Return</b> to declare a customer or supplier return.</td></tr>
              ) : pg.slice.map((r) => (
                <tr key={r.id} onClick={() => setView(r)} className="cursor-pointer hover:bg-stone-50">
                  <td className="whitespace-nowrap font-mono text-xs font-semibold">{r.return_no ?? "—"}</td>
                  <td className="whitespace-nowrap font-mono text-xs text-muted">
                    {r.type === "supplier"
                      ? (r.po_id ? `PO #${r.po_id}` : "—")
                      : (<span className="inline-flex flex-col items-start gap-0.5">{r.is_rush && <RushBadge isRush dateOrder={r.order_date} threshold={r.rush_days ?? 14} />}<span className="whitespace-nowrap">{r.order_number ?? (r.order_id ? `#${r.order_id}` : "—")}</span></span>)}
                  </td>
                  <td className="capitalize text-muted">{r.type}</td>
                  <td>{sourcePill(r.source)}</td>
                  <td className="whitespace-nowrap text-xs text-muted">{when(r.created_at)}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] text-xs text-muted">
                    {r.type === "supplier"
                      ? (r.supplier ?? (r.po_id ? `PO #${r.po_id}` : "—"))
                      : (r.customer_name ?? (r.order_id ? `Order #${r.order_id}` : "—"))}
                  </td>
                  {/* HIWALAY NA HANAY ANG LARAWAN (2026-08-27, kaparehong hugis
                      ng Stock Movement Ledger at QC): pantay ang hanay pababa
                      kahit mahaba ang pangalan, at hindi na nasisikip ang
                      pangalan sa tabi ng larawan. */}
                  <td className="px-2">
                    <div className="flex justify-center">
                      {r.item_image
                        ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={r.item_image} alt="" className="h-9 w-9 shrink-0 rounded object-cover ring-1 ring-border" />
                        : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-stone-100 text-[10px] font-semibold text-muted">—</div>}
                    </div>
                  </td>
                  <td className="font-medium">
                    <span className="mx-auto block min-w-[130px] max-w-[240px] truncate" title={r.item_desc ?? ""}>{(r.item_desc ?? "—").split("\n")[0]}</span>
                  </td>
                  <td className="text-xs text-muted">{r.sku ?? "—"}</td>
                  <td className="text-xs text-muted">{r.category ?? "—"}</td>
                  <td className="text-xs text-muted">{r.color ?? "—"}</td>
                  {/* SPECIFICATION / DESIGN DETAILS, hindi Dimension (2026-08-27):
                      ang `dimension` ng RMA ay laging blangko — ang piniling
                      build ay nasa BULLETS ng item_desc. Isang linya lang dito,
                      buo sa tooltip; ang guided cards ay nasa review modal. */}
                  <td className="text-xs text-muted">
                    {(() => {
                      const lines = specLinesOf(r.item_desc);
                      const fallback = splitDimension(r.dimension).size;
                      if (!lines.length) return fallback ?? "—";
                      return <span className="block max-w-[240px] truncate text-left" title={lines.join("\n")}>{lines.join(" · ")}</span>;
                    })()}
                  </td>
                  <td className="tabular-nums">{number(r.qty)}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] text-xs text-muted">{r.reason ?? "—"}</td>
                  <td>
                    {r.item_condition
                      ? <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold xl:whitespace-nowrap", r.item_condition === "resaleable" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{CONDITION_LABEL[r.item_condition] ?? r.item_condition}</span>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="text-xs xl:whitespace-nowrap">
                    {resolutionLabel(r)}
                    {r.resolution === "rework" && r.rework_workshop_name && (
                      <span className="mt-0.5 block"><span className="inline-block whitespace-nowrap rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">{r.rework_workshop_name}</span></span>
                    )}
                  </td>
                  <td className="tabular-nums font-semibold">{r.refund_amount > 0 ? peso(r.refund_amount) : "—"}</td>
                  <td>
                    {(() => {
                      // Rework 50% downpayment status. Non-rework / no-charge → dash.
                      const ch = r.rework_charge_total ?? 0;
                      if (r.resolution !== "rework" || ch <= 0) return <span className="text-muted">—</span>;
                      const paid = r.rework_downpayment ?? 0;
                      const met = paid + 0.005 >= ch * 0.5;
                      const full = paid + 0.005 >= ch;
                      // ANG KALAGAYAN LANG, HINDI ANG HALAGA (hiling 2026-08-27).
                      // Ang ₱8,500/₱8,500 sa ilalim ay nagsisiksik sa makitid na
                      // hanay; ang buong tuos ay nasa review modal. Tooltip na
                      // lang ang halaga para hindi rin mawala.
                      return (
                        <span
                          className={cn("inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold leading-tight", met ? "bg-emerald-50 text-emerald-700" : paid > 0 ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700")}
                          title={`${peso(paid)} of ${peso(ch)}`}
                        >
                          {full ? "Rework amount Paid" : met ? "50% paid" : paid > 0 ? "Partial" : "Waiting for Payment"}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", statusPill(r.status))}>{r.status}</span>
                  </td>
                  <td className="!border-l-4 !border-l-[#caa45a]">
                    {/pending/i.test(r.status) ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-[#4a3b1a]/10 px-2.5 py-1 text-xs font-semibold text-[#4a3b1a]">Review</span>
                    ) : (
                      <span className="text-xs text-muted">{r.approved_by ? `by ${r.approved_by}` : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.returns.length > 0 && (
          <PaginationFooter page={pg.page} setPage={pg.setPage} pageSize={pg.pageSize} setPageSize={pg.setPageSize} total={pg.total} pages={pg.pages} />
        )}
      </div>

      {open && <NewReturnModal orders={data.orders} pos={data.pos} workshops={data.workshops} teams={data.teams} workers={data.workers} onClose={() => setOpen(false)}
        submitAction={declaredFrom ? (input) => createReturn({ ...input, declared_from: declaredFrom, declared_team: declaredTeam ?? null }) : undefined} />}
      {view && (
        <ViewReturn
          // Laging SARIWANG row mula sa props — pagkatapos ng router.refresh (hal.
          // auto-credit ng Maya QR), agad nag-a-update ang figures sa modal.
          r={data.returns.find((x) => x.id === view.id) ?? view}
          canApprove={canApprove}
          busy={busyId === view.id}
          actionError={busyId === null ? error : null}
          workshops={data.workshops}
          teams={data.teams}
          onApprove={(overridePayment, crewPay, pickup) => act((id) => approveReturn(id, {
            ...(overridePayment ? { overridePayment: true } : {}),
            ...(crewPay?.length ? { crewPay } : {}),
            ...(pickup ? { pickup } : {}),
          }), view.id, () => setView(null))}
          onReject={() => act((id) => rejectReturn(id), view.id, () => setView(null))}
          onMarkReworked={() => act(markReworked, view.id, () => setView(null))}
          onClose={() => setView(null)}
        />
      )}
    </div>
  );
}

// Detail / review modal — opened by clicking a return row. Shows every field + a photo
// grid (hover to enlarge) so a manager can REVIEW the proof before approving/rejecting.
// EXPORTED: ginagamit din ng Rework Tracker (Ops) bilang row preview.
export type PickupPlan = { workshopId: number | null; team: string | null; driver: string | null; date: string | null };
export function ViewReturn({ r, canApprove, busy, actionError, onApprove, onReject, onMarkReworked, onClose, readOnly = false, pickupDate = null, extraActions = null, workshops = [], teams = [] }: { r: ReturnRow; canApprove: boolean; busy: boolean; actionError?: string | null; onApprove: (overridePayment?: boolean, crewPay?: { id: number; pay: number }[], pickup?: PickupPlan) => void; onReject: () => void; onMarkReworked: () => void; onClose: () => void; readOnly?: boolean; pickupDate?: string | null; extraActions?: ReactNode; workshops?: { id: number; name: string | null }[]; teams?: { name: string; driver: string | null; reserved?: boolean }[] }) {
  const router = useRouter();
  const [hoverImg, setHoverImg] = useState<string | null>(null);
  const pending = /pending/i.test(r.status);
  // Pickup Date: mula sa prop (pickup page — live schedule ng task) o sa piniling
  // petsa sa declaration (0152) — kita sa LAHAT ng return modal pag pull-out.
  const pdate = pickupDate ?? r.rework_pickup_date ?? null;

  // Rework service-charge billing (parts + delivery). 50% down required before approval.
  const charge = r.rework_charge_total ?? 0;
  const down = r.rework_downpayment ?? 0;
  const chargeBalance = Math.max(charge - down, 0);
  // Override confirm modal — approve nang walang 50% down (galit na customer atbp.)
  const [overrideOpen, setOverrideOpen] = useState(false);
  const required = Math.round(charge * 0.5 * 100) / 100;
  const downMet = charge <= 0 || down + 0.005 >= required;
  // NAKA-OVERRIDE: naaprubahan nang walang downpayment, COD sa redelivery. Wala
  // nang 50% na gate — ang hinihingi ay BUONG balanse (hiling 2026-08-28). Ang
  // QR ay nagsasabi noon ng kalahati (₱9,417 sa ₱18,833 na dapat) — mali ang
  // halagang ipinapa-scan sa customer, at kulang ang makokolekta.
  const overridden = !!r.rework_payment_override_by;
  const askNow = Math.max(Math.round(((overridden ? charge : required) - down) * 100) / 100, 0);
  const [collecting, setCollecting] = useState(false);
  // The collect method is whatever was chosen at declaration (saved on the row).
  const [payMethod, setPayMethod] = useState(r.rework_payment_method ?? "Cash");
  const [payAmount, setPayAmount] = useState("");
  const [payMsg, setPayMsg] = useState<string | null>(null);
  // BAYAD NG ON-SITE CREW — bukas ang presyo, kada tao: nakadepende sa bigat ng
  // trabaho, kaya ang aprubador ang nagtatakda bago aprubahan. Panimula: ang
  // nakatala na sa hilera (kapag nabuksang muli), kung hindi ay blangko.
  const crewList = r.rework_onsite_crew ?? [];
  const [crewPay, setCrewPay] = useState<Record<number, string>>(() =>
    Object.fromEntries(crewList.map((w) => [w.id, w.pay ? String(w.pay) : ""])));
  const crewPayList = crewList
    .map((w) => ({ id: w.id, pay: Math.max(Number(crewPay[w.id]) || 0, 0) }))
    .filter((w) => w.pay > 0);
  const crewPayTotal = crewPayList.reduce((n, w) => n + w.pay, 0);
  const crewPaid = !!r.rework_crew_paid_at;
  // PULL-OUT SCHEDULE — SA APPROVAL NA ITINATAKDA (hiling 2026-08-27): dito
  // pinipili ng manager kung saang workshop dadalhin at sinong team/driver/
  // kailan kukunin. Wala na ito sa declare form.
  // PAREHONG MODE (2026-08-28). Ang on-site ay biyahe rin: may pupuntang team,
  // may driver na mag-Waze, may petsa — at kung walang pipiliin dito, walang
  // rutang mapupuntahan ang bisita at walang team na may-ari nito.
  // KASAMA NA ANG REFUND (2026-09-01): ang bawat customer refund ay may
  // kukunin — parehong workshop + pull-out team/driver/petsa ang itinatakda
  // dito bago maka-approve; ang gamit ay dadaan sa workshop na doble-check
  // bago bumalik sa istante bilang malayang stock.
  const pickupEdit = pending && canApprove && !readOnly
    && (r.resolution === "rework" || (r.resolution === "refund" && r.type === "customer"))
    && workshops.length > 0;
  const onsite = r.rework_mode === "onsite";
  // NANDOON NA ANG TEAM (0209): sila mismo ang nag-declare, kaya alam na natin
  // kung sino — walang dapat piliin. Ang `declared_team` ang panimula, at ang
  // driver ay ang nakatalaga sa team na iyon. Nababago pa rin ang dalawa: baka
  // ibang driver ang sumakay, o ipasa sa ibang team ang pagkuha.
  const onsiteTeam = r.rework_pickup_onsite ? (r.declared_team ?? "") : "";
  const teamDriverOf = (name: string) => teams.find((t) => t.name === name)?.driver ?? "";
  // AUTO-MAPPING (Joe 2026-09-07): ang workshop na gumawa ng gamit ang default
  // — doon din irerepair. Nababago pa rin kung ibang workshop ang gagawa.
  const wsDefault = r.rework_workshop_id != null ? String(r.rework_workshop_id) : (r.built_workshop_id != null ? String(r.built_workshop_id) : "");
  const [wsSel, setWsSel] = useState(wsDefault);
  const [teamSel, setTeamSel] = useState(r.rework_pickup_team ?? onsiteTeam);
  const [driverSel, setDriverSel] = useState(r.rework_pickup_driver ?? (onsiteTeam ? teamDriverOf(onsiteTeam) : ""));
  const [dateSel, setDateSel] = useState(r.rework_pickup_date ?? "");
  const [pickupErr, setPickupErr] = useState<string | null>(null);
  // Pagkatapos ng save ay sariwa na ang `r` (router.refresh) — isunod ang mga
  // input, kung hindi ay "Unsaved changes" pa rin ang nakikita kahit nakatala na.
  useEffect(() => {
    setWsSel(wsDefault);
    setTeamSel(r.rework_pickup_team ?? onsiteTeam);
    setDriverSel(r.rework_pickup_driver ?? (onsiteTeam ? teamDriverOf(onsiteTeam) : ""));
    setDateSel(r.rework_pickup_date ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsDefault, r.rework_pickup_team, r.rework_pickup_driver, r.rework_pickup_date, onsiteTeam]);
  const pickupPlan = (): PickupPlan | undefined => pickupEdit
    ? { workshopId: wsSel ? Number(wsSel) : null, team: teamSel || null, driver: driverSel || null, date: dateSel || null }
    : undefined;
  // Harang bago ang approve (pati ang override) — kailangan ang workshop at team.
  const approveGuard = (fn: () => void) => {
    // ANG PETSA AY KAILANGAN SA ON-SITE (2026-08-28): ito ang gumagawa ng stop
    // sa ruta ng team. Kung wala, walang mapupuntahan ang bisita — walang araw,
    // walang ruta, at walang makakakita nito maliban sa RMA mismo.
    //
    // MALIBAN KUNG NANDOON NA SILA (0209): wala ngang picker doon — ngayon ito
    // nangyayari, at ang server ang naglalagay ng petsa. Ang paghingi ng
    // `dateSel` na walang pagkukunan ay humaharang sa TATLONG buton nang tuluyan.
    const needDate = onsite && !r.rework_pickup_onsite;
    if (pickupEdit && ((!onsite && !wsSel) || !teamSel || (needDate && !dateSel))) {
      setPickupErr(onsite
        ? "Set the visit team and the visit date before approving."
        : "Set the workshop and the pull-out team before approving.");
      return;
    }
    setPickupErr(null); fn();
  };
  // SAVE NANG WALANG APPROVE (2026-08-27): naipapasa lang kasama ng approve ang
  // plano noon, kaya nawawala ang piniling workshop/team pagsara ng modal.
  // Naitatala na ito ngayon nang mag-isa — mapupuno habang hinihintay ang bayad,
  // at pag-approve ay iisang pindot lang.
  const [savingPlan, setSavingPlan] = useState(false);
  const [planMsg, setPlanMsg] = useState<string | null>(null);
  // Ano ang nakatala na sa hilera — para masabi kung may hindi pa nasaseyv.
  const planDirty = pickupEdit && (
    wsSel !== (r.rework_workshop_id != null ? String(r.rework_workshop_id) : "")
    || teamSel !== (r.rework_pickup_team ?? "")
    || driverSel !== (r.rework_pickup_driver ?? "")
    || dateSel !== (r.rework_pickup_date ?? "")
  );
  async function savePlan() {
    if (savingPlan) return;
    if ((!onsite && !wsSel) || !teamSel) { setPickupErr(onsite ? "Set the visit team." : "Set the workshop and the pull-out team."); return; }
    setPickupErr(null); setSavingPlan(true); setPlanMsg(null);
    const { saveReworkPickupPlan } = await import("@/app/returns/actions");
    const res = await saveReworkPickupPlan(r.id, {
      workshopId: Number(wsSel), team: teamSel, driver: driverSel || null, date: dateSel || null,
    });
    setSavingPlan(false);
    if ("error" in res) { setPickupErr(res.error); return; }
    setPlanMsg("Schedule saved.");
    router.refresh();
  }
  // Muling paggawa ng naka-imbak na resibo (tingnan ang pindutan sa ibaba).
  const [regen, setRegen] = useState(false);
  const [regenMsg, setRegenMsg] = useState<string | null>(null);
  async function regenSlip() {
    if (regen) return;
    setRegen(true); setRegenMsg(null);
    const { regenerateReworkSlip } = await import("@/app/returns/actions");
    const res = await regenerateReworkSlip(r.id);
    setRegen(false);
    setRegenMsg("error" in res ? res.error : "Receipt rebuilt — open the order's Receipt / Transaction Images.");
  }
  async function collectRework() {
    const amt = Number(payAmount) || (required - down > 0 ? required - down : chargeBalance);
    if (amt <= 0) { setPayMsg("Enter an amount."); return; }
    setCollecting(true); setPayMsg(null);
    const res = await collectReworkPayment(r.id, amt, payMethod);
    setCollecting(false);
    if ("error" in res) { setPayMsg(res.error); return; }
    setPayMsg(`Collected. Paid ${peso(res.downpayment)} of ${peso(res.charge)}.`);
    router.refresh();
  }
  // EMAIL QR na hindi pa bayad: LIVE ang review — poll kada 4s (kapareho ng
  // installer QR) hanggang mabayaran; pagka-paid, auto-credit sa RMA ledger at
  // magre-refresh papunta sa "Payment collected" card.
  const waitingQr = charge > 0 && !downMet && /qr|email/i.test(r.rework_payment_method ?? "");
  useEffect(() => {
    if (!waitingQr) return;
    let dead = false;
    const check = async () => {
      // 60 SEGUNDO at hindi 4 (2026-08-27) — ang 4s poll ang uri ng kumain sa
      // Vercel GB-hours noong 8/7, at ngayong laging Email QR ang rework ay
      // bawat bukas na review ang magpo-poll. Kapareho na ng installer QR:
      // isang minuto, at tahimik kapag nakatago ang tab.
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const { checkReworkPayment } = await import("@/app/orders/maya-actions");
        const s = await checkReworkPayment(r.id);
        if (!dead && !("error" in s) && s.paid) { setPayMsg("✓ Maya QR paid — credited to the RMA."); router.refresh(); }
      } catch { /* best-effort */ }
    };
    void check();
    const t = setInterval(check, 60000);
    return () => { dead = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id, waitingQr]);
  // I-render ang NAKA-IMBAK na QR body (0154) — parehong session ng na-email na QR,
  // kaya tugma ang poll/auto-credit; walang bagong session na ginagawa dito.
  const [qrImg, setQrImg] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    if (!waitingQr) { setQrImg(null); return; }
    (async () => {
      // Sabay na simulan ang qrcode chunk load at ang body fetch para mabilis.
      // Ang page-load na props ay maaaring luma (walang body pa) — kunin nang
      // sariwa sa server kapag wala, para agad lumabas ang QR.
      const qrcodeP = import("qrcode");
      let body = r.rework_qr_body;
      if (!body) {
        const { loadReworkQrBody } = await import("@/app/returns/actions");
        body = await loadReworkQrBody(r.id);
      }
      if (!body) { if (!dead) setQrImg(null); return; }
      const QRCode = (await qrcodeP).default;
      const url = await QRCode.toDataURL(body, { width: 320, margin: 1 });
      if (!dead) setQrImg(url);
    })();
    return () => { dead = true; };
  }, [r.id, r.rework_qr_body, waitingQr]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center gap-4 overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl 2xl:max-w-[88rem]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-[#4d3d1b] bg-gradient-to-b from-[#52421d] to-[#4a3b1a] px-4 py-3 text-[#f4ead8]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#caa45a] text-base">↩</span>
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-wide">Review · {r.return_no ?? `Return #${r.id}`}</div>
            <div className="text-[11px] opacity-80">
              <span className="capitalize">{r.type} return</span>
              {r.type === "supplier"
                ? (r.po_id ? ` · PO #${r.po_id}` : "")
                : (r.order_number ? ` · ${r.order_number}` : r.order_id ? ` · Order #${r.order_id}` : "")}
            </div>
          </div>
          <span className={cn("ml-auto mr-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold", statusPill(r.status))}>{r.status}</span>
          <button onClick={onClose} className="text-[#e7dcc4] hover:text-white">✕</button>
        </div>

        {/* DALAWANG TUDLING (2026-08-25) — kapareho ng New Return at ng
            Delivery modal. Isang makipot na tudling ang lahat noon, at ang
            labing-isang spec ng isang custom bed ay nagtutulak ng resolution,
            litrato at ng mga buton pababa sa dalawang screen ng scroll.
              kaliwa — ANO ang ibinalik (order, item, build)
              kanan  — ANO ang napagdesisyunan (condition, resolution, bayad,
                       litrato, at ang aksyon) */}
        {/* TATLONG HANAY SA MALAKING SCREEN (2026-08-27): ang Pickup panel
            (extraActions) ay nakasunod noon sa mahabang REWORK CHARGE sa kanan,
            kaya kailangang mag-scroll pa bago makita ang Start Pickup at ang
            Pickup Proof. May sarili na itong hanay sa 2xl. */}
        <div className={cn("grid gap-4 p-4 lg:grid-cols-[1.05fr_1fr]", (!!extraActions || (pending && !readOnly)) && "2xl:grid-cols-[1fr_1fr_1fr]")}>
          <div className="min-w-0 space-y-4">
          {/* Source */}
          <div className="rounded-xl border border-[#e7dcc4] bg-[#faf8f3] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[#caa45a]">{r.type === "supplier" ? "Supplier / Purchase Order" : "Customer / Order"}</div>
            <div className="mt-0.5 text-sm font-bold text-[#4a3b1a]">
              {r.type === "supplier"
                ? `${r.supplier ?? "—"}${r.po_id ? ` · PO #${r.po_id}` : ""}`
                : `${r.customer_name ?? "—"}${r.order_number ? ` · ${r.order_number}` : r.order_id ? ` · Order #${r.order_id}` : ""}`}
            </div>
          </div>

          {/* Item specs */}
          <div className="rounded-xl border border-border p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Returned item</div>
            {/* MALAKING LARAWAN (2026-08-27): 64px lang ito sa isang buong-lapad
                na hanay, kaya blangko ang katabi. Ang aprubador ay tumitingin ng
                sira — dapat kita ito. */}
            <div className="mt-1.5">
              {r.item_image
                ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={r.item_image} alt="" className="mx-auto h-40 w-full rounded-lg bg-stone-50 object-contain ring-1 ring-border" />
                : <div className="flex h-40 w-full items-center justify-center rounded-lg bg-stone-100 text-xs text-muted">No photo</div>}
            </div>
            {/* IISANG HULMA NG PRODUCT DETAILS (2026-08-23): Product / Name at
                SKU bilang hilera rin, at ang build ng customer ay hindi
                category/color — ang tunay na category ay walang tutuldok. */}
            <SpecRows className="mt-3" items={[
              ["Product / Name", (r.item_desc ?? "—").split("\n")[0] || null],
              ...(r.sku ? [["SKU", <span key="sku" className="font-mono">{r.sku}</span>] as [string, React.ReactNode]] : []),
              ...(realValue(r.category) ? [["Category", realValue(r.category)] as [string, React.ReactNode]] : []),
              ...(realValue(r.color) ? [["Color", realValue(r.color)] as [string, React.ReactNode]] : []),
              ...(splitDimension(r.dimension).size ? [["Dimension", splitDimension(r.dimension).size] as [string, React.ReactNode]] : []),
              ...(splitDimension(r.dimension).frame ? [["Add-ons", splitDimension(r.dimension).frame] as [string, React.ReactNode]] : []),
              ["Qty", number(r.qty)],
              ["Reason", r.reason],
            ]} />
            {/* Ang parehong guided cards ng Product Details, ng QC at ng Edit
                Inventory Item (2026-08-23) — dating bullet list. */}
            {(() => {
              const name = (r.item_desc ?? "").split("\n")[0] || null;
              const specText = (r.item_desc ?? "").split("\n").slice(1)
                .map((l) => l.trim().replace(/^[•·-]\s*/, "")).filter(Boolean).join("\n");
              if (!specText) return null;
              return (
                <div className="mt-2">
                  <SpecFieldsView category={specCategoryOf(r.category, name)} specs={specText} />
                </div>
              );
            })()}
          </div>

          {/* SA ILALIM NG SPECIFICATIONS (hiling 2026-08-27): ito ang litrato
              ng SIRA — kasama ito ng item, hindi ng pera. Nasa kanan ito noon,
              sa itaas ng REWORK CHARGE, kaya nakahiwalay sa inirereklamong
              gamit. */}
          <div>
            <p className="mb-2 text-xs font-semibold text-[#4a3b1a]">Proof photos ({r.photos.length})</p>
            {r.photos.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted">No photos.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {r.photos.map((p, i) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={i}
                    src={p}
                    alt=""
                    onMouseEnter={() => setHoverImg(p)}
                    onMouseLeave={() => setHoverImg(null)}
                    className="aspect-square w-full cursor-zoom-in rounded-lg object-cover ring-1 ring-border"
                  />
                ))}
              </div>
            )}
          </div>

          </div>

          <div className="min-w-0 space-y-4">
          {/* Resolution row — color-coded so the manager sees the outcome at a glance */}
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[#e7dcc4] bg-[#e7dcc4]">
            <div className="bg-[#faf6ec] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Condition</div>
              <div className={cn("mt-0.5 text-sm font-bold", r.item_condition === "resaleable" ? "text-emerald-700" : r.item_condition === "defective" ? "text-rose-700" : "")}>
                {r.item_condition === "resaleable" ? "Resellable" : r.item_condition === "defective" ? "Not resellable" : "—"}
              </div>
            </div>
            <div className="bg-[#faf6ec] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Resolution</div>
              <div className="mt-0.5 text-sm font-bold text-[#4a3b1a]">{resolutionLabel(r)}</div>
            </div>
            <div className="bg-[#faf6ec] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Refund</div>
              <div className={cn("mt-0.5 text-sm font-bold tabular-nums", r.refund_amount > 0 ? "text-rose-700" : "text-muted")}>{r.refund_amount > 0 ? peso(r.refund_amount) : "—"}</div>
            </div>
          </div>

          {/* Rework assignments — saang workshop aayusin + sinong team ang magpu-pull out
              (pull-out) o sinong crew ang pupunta sa customer (on-site) */}
          {r.resolution === "rework" && (r.rework_workshop_name || r.rework_pickup_team || (r.rework_onsite_crew?.length ?? 0) > 0) && (
            <div className={cn("grid gap-px overflow-hidden rounded-xl border border-[#e7dcc4] bg-[#e7dcc4]", pdate ? "grid-cols-3" : "grid-cols-2")}>
              <div className="bg-[#faf6ec] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Repair Workshop</div>
                <div className="mt-1">
                  {r.rework_workshop_name
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-bold text-orange-700 ring-1 ring-inset ring-orange-200">{r.rework_workshop_name}</span>
                    : <span className="text-sm text-muted">—</span>}
                </div>
              </div>
              <div className="bg-[#faf6ec] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{r.rework_mode === "onsite" ? "On-site Crew" : "Pull-out Team"}</div>
                <div className="mt-1">
                  {r.rework_mode === "onsite" ? (
                    crewList.length > 0 ? (
                      // ISANG HILERA KADA TAO, may bukas na presyo (hiling
                      // 2026-08-25). Chip-chip lang ito noon: kita ang pangalan,
                      // pero walang paraang sabihin kung magkano ang tatanggapin
                      // nila sa pagkumpuning ito. Kapag naitala na (crewPaid),
                      // teksto na lang — nasa payroll na, hindi na dapat mabago.
                      <div className="space-y-1">
                        {crewList.map((w) => (
                          <div key={w.id} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 ring-1 ring-inset ring-amber-200" title={w.name}>{w.name}</span>
                            {crewPaid || readOnly ? (
                              <span className="shrink-0 text-xs font-bold tabular-nums text-emerald-700">{w.pay ? peso(w.pay) : "—"}</span>
                            ) : (
                              <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted">
                                <span>₱</span>
                                <input
                                  value={crewPay[w.id] ?? ""}
                                  onChange={(e) => setCrewPay((p) => ({ ...p, [w.id]: e.target.value.replace(/[^0-9.]/g, "") }))}
                                  inputMode="decimal"
                                  placeholder="0"
                                  aria-label={`Pay for ${w.name}`}
                                  className="w-16 rounded-md border border-[#e6dcc4] bg-white px-1.5 py-0.5 text-right text-xs font-bold tabular-nums text-[#3a2e14] outline-none focus:border-primary"
                                />
                              </span>
                            )}
                          </div>
                        ))}
                        <div className="flex items-center justify-between border-t border-[#e7dcc4] pt-1 text-[11px]">
                          <span className="text-muted">{crewPaid ? "Crew pay · recorded" : "Crew pay total"}</span>
                          <b className={cn("tabular-nums", crewPaid ? "text-emerald-700" : "text-[#3a2e14]")}>{peso(crewPaid ? crewList.reduce((n, w) => n + (w.pay ?? 0), 0) : crewPayTotal)}</b>
                        </div>
                      </div>
                    ) : <span className="text-sm text-muted">—</span>
                  ) : r.rework_pickup_team
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-700 ring-1 ring-inset ring-sky-200">{r.rework_pickup_team}{r.rework_pickup_driver ? ` — ${r.rework_pickup_driver}` : ""}</span>
                    : <span className="text-sm text-muted">—</span>}
                </div>
              </div>
              {pdate && (
                <div className="bg-[#faf6ec] p-3">
                  {/* Sa on-site ay walang kinukuha — bisita ito, hindi pickup. */}
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{onsite ? "Visit Date" : "Pickup Date"}</div>
                  <div className="mt-1 text-sm font-bold">{new Date(`${pdate.slice(0, 10)}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</div>
                </div>
              )}
            </div>
          )}

          {/* Pickup history — timestamps + signature + photos ng dalawang biyahe
              (kuha sa customer, drop sa workshop). Snapshot sa return (0153),
              kaya buo pa rin kahit na-repurpose na ang delivery row. */}
          {(r.rework_pickup_proof?.arrive || r.rework_pickup_proof?.drop) && (
            <div className="space-y-2 rounded-xl border border-[#e7dcc4] bg-[#faf6ec] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Pickup History</div>
              {([["arrive", "Picked up at customer"], ["drop", "Dropped at workshop"]] as const).map(([k, label]) => {
                const leg = r.rework_pickup_proof?.[k];
                if (!leg) return null;
                return (
                  <div key={k} className="rounded-lg border border-[#efe6d2] bg-white p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#4a3b1a]">{label}</span>
                      <span className="text-[11px] text-muted">{new Date(leg.at).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-start gap-2">
                      {leg.signature && (
                        <a href={leg.signature} target="_blank" rel="noreferrer" className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={leg.signature} alt="signature" className="h-14 rounded border border-border bg-white object-contain px-1" />
                          <span className="block text-center text-[9px] uppercase tracking-wide text-muted">Signature</span>
                        </a>
                      )}
                      {(leg.photos ?? []).map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="" loading="lazy" className="h-14 w-14 rounded border border-border object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}


          {r.notes && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><b>Notes:</b> {r.notes}</div>}

          <div className="flex flex-wrap items-center justify-between gap-1 border-t border-border pt-3 text-[11px] text-muted">
            <span>Declared by <b className="text-foreground">{r.requested_by ?? "—"}</b> · {when(r.created_at)}</span>
            {r.approved_by && <span>{/reject/i.test(r.status) ? "✕ Rejected" : "✓ Approved"} by <b className="text-foreground">{r.approved_by}</b></span>}
          </div>

          {/* Rework service-charge billing — parts + delivery, with the 50%-down gate.
              Shown for any rework that carries a charge, whether pending or in progress. */}
          {r.resolution === "rework" && charge > 0 && (
            <div className="rounded-lg border border-[#e6dcc4] bg-[#fdfbf6] p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Rework charge</p>
              {/* Group 1 — the charge line items, summing to Total charge. */}
              <div className="space-y-1.5 text-[13px]">
                {(() => {
                  const orderBal = Math.max(Math.round((charge - (r.rework_parts_total ?? 0) - (r.rework_delivery_price ?? 0)) * 100) / 100, 0);
                  return orderBal > 0 ? <div className="flex justify-between"><span className="text-muted">Remaining order balance</span><b className="tabular-nums">{peso(orderBal)}</b></div> : null;
                })()}
                {/* ANG APAT NA PARTS, HINDI LANG ANG ₱6,500 (2026-08-27): ang
                    aprubador ay nagpapasya sa singil — dapat makita kung ANO ang
                    sinisingil. Naitala naman ang listahan; hindi lang ito
                    ipinapasa noon sa client. */}
                {r.rework_parts_total > 0 && (
                  <>
                    <div className="flex justify-between"><span className="text-muted">Replacement parts</span><b className="tabular-nums">{peso(r.rework_parts_total)}</b></div>
                    {r.rework_parts.length > 0 && (
                      <ul className="ml-3 space-y-0.5 border-l border-[#e6dcc4] pl-2.5 text-[11.5px] text-muted">
                        {r.rework_parts.map((p, i) => (
                          <li key={i} className="flex justify-between gap-2">
                            <span className="truncate">{p.qty > 1 ? `${p.qty}× ` : ""}{p.part}</span>
                            <span className="shrink-0 tabular-nums">{peso(p.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                {r.rework_delivery_price > 0 && <div className="flex justify-between"><span className="text-muted">{r.rework_mode === "onsite" ? "Delivery (on-site visit)" : "Delivery (redeliver)"}</span><b className="tabular-nums">{peso(r.rework_delivery_price)}</b></div>}
              </div>
              {/* Total charge — heavier divider so it clearly caps the line items. */}
              <div className="mt-2 flex justify-between border-t-2 border-[#e6dcc4] pt-2 text-[13px]">
                <span className="font-bold text-foreground">Total charge</span>
                <b className="tabular-nums text-base text-foreground">{peso(charge)}</b>
              </div>
              {/* Group 2 — payment status against the charge. */}
              <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3 text-[13px]">
                <div className="flex justify-between"><span className="text-muted">Paid ({r.rework_payment_method ?? "—"})</span><b className="tabular-nums text-emerald-700">{peso(down)}</b></div>
                <div className="flex justify-between"><span className="text-muted">Balance</span><b className={cn("tabular-nums", chargeBalance === 0 ? "text-green-700" : "text-foreground")}>{peso(chargeBalance)}</b></div>
                {/* ANG RESIBO AY NAKA-IMBAK, hindi ginagawa sa bawat pagbukas:
                    isang SVG sa gallery ng order, ginawa sa sandali ng koleksyon.
                    Ang slip na nauna sa isang pag-aayos ay nananatiling mali
                    habang buhay, kaya may paraang gawin itong muli mula sa
                    kasalukuyang datos — pinapalitan ang luma, hindi dinadagdagan. */}
                {down > 0 && (
                  <div className="pt-1">
                    <button type="button" onClick={regenSlip} disabled={regen}
                      className="text-[11px] font-semibold text-muted underline hover:text-foreground disabled:opacity-50">
                      {regen ? "Rebuilding the receipt…" : "Rebuild the receipt slip"}
                    </button>
                    {regenMsg && <p className="mt-0.5 text-[11px] text-emerald-700">{regenMsg}</p>}
                  </div>
                )}
              </div>
              {/* The gate — 50% requirement, highlighted. Kapag iniobra ang
                  override, ang harang ay hindi na tanong: ang buong balanse ay
                  kinokolekta sa redelivery, at may pangalan kung sino ang
                  nagpasya. */}
              {r.rework_payment_override_by ? (
                <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
                  <div className="flex items-center justify-between">
                    <span>Approved without the downpayment</span>
                    <b className="tabular-nums text-base">{peso(chargeBalance)}</b>
                  </div>
                  <p className="mt-0.5 text-[11px] font-normal">
                    Override by {r.rework_payment_override_by} · collected on redelivery (COD).
                  </p>
                </div>
              ) : (
                <div className={cn("mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-[13px] font-semibold", downMet ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>
                  <span>{downMet ? "✓ 50% downpayment met" : "50% downpayment required"}</span>
                  <b className="tabular-nums text-base">{peso(required)}</b>
                </div>
              )}
              {!readOnly && chargeBalance > 0 && (() => {
                // Only the method chosen at declaration is shown — just like a Sales
                // Order collects via the method that was picked on create. Bukas ito
                // hangga't may balanse — 50% para maka-approve, buo bago i-release.
                const chosen = payMethod;
                const meta = chosen === "Email QR"
                  ? { icon: "", label: "Email QR", sub: "any bank / e-wallet" }
                  // Hindi na mapipili ang Terminal (tinanggal 8/25), pero may
                  // lumang RMA na nakatala pa ito — dapat pa ring may pangalan.
                  : chosen === "Terminal"
                  ? { icon: "", label: "Terminal (POS)", sub: "in-store" }
                  : { icon: "", label: "Cash", sub: "in-store" };
                // BAYAD NA ang 50% — huwag nang maningil dito sa approval; ang
                // balance ay COD sa redelivery (o sa Installation collection).
                if (downMet) {
                  // Kapareho ng Installation "Payment collected" success card.
                  return (
                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-5 text-center">

                      <p className="text-sm font-bold text-emerald-700">Payment collected</p>
                      <p className="text-xs text-emerald-600">
                        {chargeBalance <= 0.005
                          ? `${r.return_no ?? "RMA"} fully paid (${meta.label}) · receipt sent.`
                          : `50% downpayment paid (${meta.label}) — the remaining ${peso(chargeBalance)} is collected on redelivery (COD).`}
                      </p>
                      {payMsg && <p className="mt-1 text-[11px] font-medium text-emerald-700">{payMsg}</p>}
                    </div>
                  );
                }
                // EMAIL QR: naipadala na ang QR sa deklarasyon — STATUS na lang dito
                // (Waiting for Payment), hindi paniningil; auto-kredito pagka-bayad.
                if (chosen === "Email QR") {
                  // Kapareho ng installer Maya-QR block: live QR + pulsing status +
                  // caption; ang QR ay ang NAKA-IMBAK na session (parehong na-email).
                  return (
                    <div className="mt-3 rounded-lg border border-border bg-white p-4">
                      <div className="flex flex-col items-center gap-2 text-center">
                        {qrImg ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={qrImg} alt="Maya QR Ph" className="h-44 w-44" />
                        ) : (
                          <div className="flex h-44 w-44 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-stone-50 text-xs text-muted">

                            QR emailed to the customer
                          </div>
                        )}
                        <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-amber-700"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />Waiting for payment…</span>
                        <p className="text-[11px] text-muted">Scan with GCash / GoTyme / Maya — amount locked ({peso(askNow)}){overridden ? " — full balance, no downpayment was taken" : ""}, auto-detects.</p>
                        <button type="button" disabled={collecting} onClick={async () => {
                          setCollecting(true); setPayMsg(null);
                          try {
                            const { sendReworkQrRequest } = await import("@/app/orders/maya-actions");
                            const q = await sendReworkQrRequest(r.id);
                            setPayMsg("error" in q ? q.error : q.emailed ? "✓ QR email resent." : "Order has no email address.");
                            if (!("error" in q)) router.refresh(); // kunin ang bagong session QR
                          } finally { setCollecting(false); }
                        }} className="rounded-lg border border-[#caa45a] bg-[#faf6ec] px-3 py-1.5 text-xs font-bold text-[#4a3b1a] hover:bg-[#f4ead8] disabled:opacity-60">
                          {collecting ? "Sending…" : "↻ Resend QR email"}
                        </button>
                        {payMsg && <span className="text-[11px] font-semibold text-emerald-700">{payMsg}</span>}
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                    <p className="mb-2 text-[11px] font-medium text-muted">Collect the 50% downpayment to proceed:</p>
                    <div className="flex items-center gap-3 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-primary">
                      <span className="text-lg">{meta.icon}</span>
                      <div className="flex-1"><div className="text-sm font-semibold">{meta.label}</div><div className="text-[10px]">{meta.sub}</div></div>
                      <span className="text-[10px] font-medium text-muted">chosen on declaration</span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input type="number" min={0} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={`${peso(required - down)} (50% due)`} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary" />
                      <button type="button" onClick={collectRework} disabled={collecting} className="shrink-0 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">{collecting ? "Recording…" : chosen === "Email QR" ? "Email QR" : "Collect"}</button>
                    </div>
                    <p className="mt-2 text-[10px] text-muted">
                      {chosen === "Email QR"
                        ? "A QR Ph is emailed for the amount above — payable via any bank / e-wallet (GCash, Maya, BPI, BDO)."
                        : "Collected in-store — record the amount taken now."}
                    </p>
                    {payMsg && <p className="mt-1 text-[11px] font-medium text-emerald-700">{payMsg}</p>}
                  </div>
                );
              })()}
            </div>
          )}

          </div>

          {/* SARILING HANAY ANG DESISYON (2026-08-27): ang Pull-out Schedule
              at ang Approve/Reject ay nakasunod noon sa QR sa kanang hanay,
              kaya kailangan pang mag-scroll bago makita ang mapipindot. */}
          {pending && !readOnly && (
            <div className="min-w-0 space-y-3">
              {/* PULL-OUT SCHEDULE — dito na pinipili (wala na sa declare). */}
              {pickupEdit && (
                <div className="rounded-xl border border-[#e6dcc4] bg-[#faf6ec]/60 p-3">
                  <p className="mb-2 text-[10.5px] font-extrabold uppercase tracking-wider text-[#a8842e]">{onsite ? "On-site visit — set before approving" : "Pull-out schedule — set before approving"}</p>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {/* WALANG WORKSHOP SA ON-SITE (hiling 2026-08-28). Sa bahay
                        ng customer ginagawa ang repair — walang workshop na
                        pupuntahan. Ang tanong dito ay sino ang pupunta at kailan.
                        Ang QC declaration ay may workshop pa rin sa likod:
                        itinatakda ito ng `fallbackWorkshopId` sa pag-declare. */}
                    {!onsite && (
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-muted">Workshop to repair *</span>
                        <select value={wsSel} onChange={(e) => setWsSel(e.target.value)} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary">
                          <option value="">Select workshop…</option>
                          {workshops.map((w) => <option key={w.id} value={w.id}>{w.name ?? `Workshop #${w.id}`}</option>)}
                        </select>
                        {r.built_workshop_id != null && (
                          <span className="mt-1 block text-[11px] text-muted">
                            {String(r.built_workshop_id) === wsSel ? "Built by this workshop — repairs go back to the maker." : `Built by ${r.built_workshop_name ?? "another workshop"}.`}
                          </span>
                        )}
                      </label>
                    )}
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-muted">{onsite ? "On-site visit team *" : "Pull-out delivery team *"}</span>
                      <select value={teamSel} onChange={(e) => {
                        const name = e.target.value;
                        setTeamSel(name);
                        const t = teams.find((x) => x.name === name);
                        if (t?.driver) setDriverSel(t.driver);
                      }} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary">
                        <option value="">Select team…</option>
                        {teams.filter((t) => !t.reserved && !/^reserve/i.test(t.name)).map((t) => (
                          <option key={t.name} value={t.name}>{t.name}{t.driver ? ` — ${t.driver}` : ""}</option>
                        ))}
                      </select>
                      <span className="mt-1 block text-[11px] text-muted">The pickup appears on that team&apos;s Rework (Pull Out) page.</span>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-muted">Driver</span>
                      <select value={driverSel} onChange={(e) => setDriverSel(e.target.value)} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary">
                        <option value="">Select driver…</option>
                        {Array.from(new Set(teams.map((t) => t.driver).filter(Boolean) as string[])).map((d) => (
                          <option key={d} value={d}>{d}{teams.some((t) => /^reserve/i.test(t.name) && t.driver === d) ? " (Reserve)" : ""}</option>
                        ))}
                      </select>
                      <span className="mt-1 block text-[11px] text-muted">Defaults to the team&apos;s driver — pick a Reserve if they&apos;re out.</span>

                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-muted">{onsite ? "Visit Date" : "Pickup Date"}</span>
                      {/* WALANG PIPILIING PETSA KUNG NANDOON NA SILA (0209).
                          Ngayon ito nangyayari — ang pagtatanong ay nag-aanyaya
                          ng sagot na sumasalungat sa nangyayari na. */}
                      {r.rework_pickup_onsite ? (
                        <div className="rounded-md border border-[#caa45a] bg-[#faf6ec] px-2 py-1.5 text-sm font-semibold text-[#7a5e1f]">Today — {onsite ? "crew is on site" : "team is on site"}</div>
                      ) : (
                        <input type="date" value={dateSel} onChange={(e) => setDateSel(e.target.value)} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary" />
                      )}
                      <span className="mt-1 block text-[11px] text-muted">
                        {r.rework_pickup_onsite
                          ? onsite
                            ? "The crew declared this at the customer and is repairing it on this visit — no Route Planner."
                            : "The team declared this at the customer. On approval it goes straight to their pickup list — no Route Planner."
                          : onsite
                          ? "When the team goes to the customer — becomes a stop on their route."
                          : "When the team collects the item — becomes the pickup schedule on approval."}
                      </span>
                    </label>
                  </div>
                  {pickupErr && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{pickupErr}</p>}
                  {/* Sariling Save — naitatala ang plano nang hindi nag-a-approve.
                      "✓ Saved" LANG KAPAG MAY NAITALA NA (2026-08-27): dating
                      iyon ang nakalagay kahit blangko pa ang buong schedule,
                      kaya mukhang tapos na ang hindi pa nasisimulan. */}
                  {(() => {
                    const savedOnRow = r.rework_workshop_id != null && !!r.rework_pickup_team;
                    return (
                      <div className="mt-2.5 flex items-center gap-2">
                        <button type="button" onClick={savePlan} disabled={savingPlan || !planDirty}
                          className={cn(
                            "rounded-lg px-3.5 py-1.5 text-xs font-bold",
                            planDirty
                              ? "bg-[#4a3b1a] text-[#f4ead8] hover:opacity-90"
                              : savedOnRow
                                ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
                                : "bg-stone-100 text-muted",
                          )}>
                          {savingPlan ? "Saving…" : planDirty ? "Save schedule" : savedOnRow ? "✓ Saved" : "Nothing to save yet"}
                        </button>
                        {planMsg && !planDirty && <span className="text-[11px] font-semibold text-emerald-700">{planMsg}</span>}
                        {planDirty && <span className="text-[11px] text-amber-700">Unsaved changes.</span>}
                      </div>
                    );
                  })()}
                </div>
              )}
              {/* What approval will do — so the manager confirms intentionally */}
              <div className="rounded-lg bg-stone-50 px-3 py-2 text-[11px] leading-relaxed text-muted">
                On approval:{" "}
                {r.resolution === "rework" ? (
                  /* ANG SUSUNOD NA HAKBANG, HINDI ANG KATAPUSAN (hiling
                     2026-08-28). "Dispatch to workshop" ang sinasabi noon, pero
                     ang totoo ay dumadaan muna ito sa ROUTE PLANNER — doon
                     inaayos ni Ops ang pagkakasunod bago ito makita ng team.
                     Ang parehong pindutan (Approve at Override) ay iisa ang
                     dinadaanan; ang pagkakaiba lang ay ang 50% na bayad. */
                  <span className="font-semibold text-amber-700">
                    {onsite
                      ? r.rework_pickup_onsite
                        // Nandoon na sila (0209) — walang iruruta.
                        ? <>the visit goes <b>straight to the team&apos;s Rework (On-Site)</b> route, dated today — no Route Planner. No refund, no loss.</>
                        : <>the visit goes to the <b>Route Planner</b> for sequencing → then the team&apos;s <b>Rework (On-Site)</b> route. No refund, no loss.</>
                      : r.rework_pickup_onsite
                      // Nilalaktawan ang planner kapag nandoon na sila (0209) —
                      // maling ipangako ang pagpila kung hindi naman iyon
                      // mangyayari.
                      ? <>the pickup goes <b>straight to the team&apos;s Rework (Pull Out)</b> page, dated today — no Route Planner → workshop repair → {r.rework_target === "redeliver" ? "redeliver to customer" : "restock to inventory"}. No refund, no loss.</>
                      : <>the pickup goes to the <b>Route Planner</b> for sequencing → then the team&apos;s <b>Rework (Pull Out)</b> page → workshop repair → {r.rework_target === "redeliver" ? "redeliver to customer" : "restock to inventory"}. No refund, no loss.</>}
                  </span>
                ) : r.resolution === "refund" && r.type === "customer" ? (
                  /* ANG BAGONG REFUND NA DALOY (2026-09-01): pera palabas mula
                     PAN Overall (hindi galaw sa order ledger), tapos pull-out →
                     workshop double-check → balik sa MALAYANG stock sa Receiving
                     QC — doon nagsasara ang RMA. Ang lumang "refund to the
                     order · restock 1 to inventory" ay parehong hindi na totoo. */
                  <span className="font-semibold">
                    <span className="text-rose-700">refund {peso(r.refund_amount)} queued as TO PAY on Payment Approval → Refunds (send the money, then mark it refunded)</span>
                    {" · "}
                    <span className="text-amber-700">
                      {r.rework_pickup_onsite
                        ? <>the pickup goes <b>straight to the team&apos;s Refund (Pull Out)</b> page, dated today — no Route Planner</>
                        : <>the pickup goes to the <b>Route Planner</b> → then the team&apos;s <b>Refund (Pull Out)</b> page</>}
                    </span>
                    {" → workshop double-check → "}
                    <span className="text-emerald-700">back to free stock at Receiving QC{r.sku ? ` (${r.sku})` : ""}</span>. The order&apos;s ledger is untouched.
                  </span>
                ) : <>
                  {r.resolution === "refund" && r.refund_amount > 0 && <span className="font-semibold text-rose-700">refund {peso(r.refund_amount)}</span>}
                  {r.resolution === "refund" && r.refund_amount > 0 && (r.item_condition === "resaleable") && " · "}
                  {r.item_condition === "resaleable" && <span className="font-semibold text-emerald-700">restock 1 to inventory{r.sku ? ` (${r.sku})` : ""}</span>}
                  {r.item_condition === "defective" && <span>item is scrapped (no restock)</span>}
                  {!(r.resolution === "refund" && r.refund_amount > 0) && r.item_condition !== "resaleable" && r.item_condition !== "defective" && <span>record the return.</span>}
                </>}
              </div>
              {actionError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{actionError}</p>}
              {canApprove ? (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    {/* LAGING "✓ Approve" (2026-08-27) — ang pangalang "Collect
                        50% down to approve" ay isang utos na walang mapipindot:
                        ang koleksyon ay nasa QR sa itaas, at ang daan kapag
                        hindi makabayad ay ang Override sa ibaba. Ang harang ay
                        sinasabi na ng chip na "50% downpayment required". */}
                    <button onClick={() => approveGuard(() => onApprove(false, crewPayList, pickupPlan()))} disabled={busy || !downMet} title={!downMet ? "Waiting for the 50% downpayment — or use Override below" : undefined} className="flex-[2] rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-60">
                      {busy ? "Approving…" : "✓ Approve"}
                    </button>
                    <button onClick={onReject} disabled={busy} className="flex-1 rounded-lg border border-rose-300 px-4 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                      ✕ Reject
                    </button>
                  </div>
                  {/* OVERRIDE: hindi maiiwasang may customer na ayaw/di makapagbayad
                      agad (galit — rework ito) — pwedeng i-approve nang walang 50%;
                      ang buong balanse ay makokolekta sa redelivery (COD). */}
                  {!downMet && (
                    <button
                      onClick={() => approveGuard(() => setOverrideOpen(true))}
                      disabled={busy}
                      className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
                    >
                      Override — approve without payment (collect on redelivery)
                    </button>
                  )}
                  <Modal open={overrideOpen} onClose={() => setOverrideOpen(false)} title="Approve Without Payment" description={r.return_no ?? undefined} size="sm" brand={{ icon: "!" }}
                    footer={
                      <div className="flex w-full gap-2">
                        <button onClick={() => setOverrideOpen(false)} disabled={busy} className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-bold text-muted hover:bg-stone-50 disabled:opacity-60">Cancel</button>
                        <button onClick={() => { setOverrideOpen(false); onApprove(true, crewPayList, pickupPlan()); }} disabled={busy} className="flex-[2] rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-60">
                          {busy ? "Approving…" : "✓ Approve without payment"}
                        </button>
                      </div>
                    }>
                    <div className="space-y-3 text-sm text-foreground">
                      <p>Approve this rework <b>without the 50% downpayment</b>?</p>
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                        <div className="flex justify-between text-[13px]"><span className="text-amber-800">Rework balance</span><b className="tabular-nums text-amber-900">{peso(chargeBalance)}</b></div>
                      </div>
                      <p className="text-xs text-muted">The full balance stays on this RMA and is collected on <b>redelivery (COD)</b>. It cannot be marked Delivered until it is paid.</p>
                    </div>
                  </Modal>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-center text-xs font-semibold text-amber-800">
                  Awaiting Operations Manager approval
                </div>
              )}
            </div>
          )}

          {/* SARILING HANAY ANG PICKUP PANEL (2026-08-27) — hindi na nakasunod
              sa mahabang REWORK CHARGE. Sa maliit na screen ay bumabalik ito sa
              ilalim, gaya ng dati; sa 2xl ay katabi na ng dalawa. */}
          {extraActions && <div className="min-w-0 space-y-4">{extraActions}</div>}
        </div>
      </div>

      {/* Enlarged hover preview — fixed side panel (reserved space) like the QC review,
          so hovering a photo never shifts the layout. */}
      {/* Ang modal ay 88rem na sa 2xl (2026-08-27, para kasya ang Pickup panel
          sa sariling hanay) — kaya sa 1536px ay ~128px na lang ang gilid at
          MAGSASAPAWAN ang panel na ito. Sa min-[1800px] na lang ito lumalabas,
          kung saan may tunay nang espasyo sa tabi. */}
      <div className="pointer-events-none fixed right-4 top-1/2 z-[70] hidden w-[min(20vw,380px)] -translate-y-1/2 min-[1800px]:block">
        {hoverImg && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={hoverImg} alt="" className="max-h-[85vh] w-full rounded-xl border-4 border-white bg-white object-contain shadow-2xl" />
        )}
      </div>
    </div>
  );
}

// Exported so other modules (e.g. Delivery) can open the SAME return-declare form.
// `submitAction` lets the caller route to a different create action (e.g. the
// delivery-gated createReturnFromDelivery); defaults to createReturn. `defaultOrderId`
// pre-binds a customer order (its items populate the item picker). `onCreated` fires
// after a successful declare.
export function NewReturnModal({ orders, pos, onClose, submitAction, defaultOrderId, onCreated, teams, workers }: {
  orders: OrderOption[]; pos: PoOption[]; workshops: WorkshopOption[]; onClose: () => void;
  submitAction?: (input: CreateReturnInput) => Promise<{ ok: true; id: number; return_no: string } | { error: string }>;
  defaultOrderId?: number | null;
  onCreated?: () => void;
  // Pull-out delivery teams na may driver (delivery_teams) — fallback sa plain A–D.
  teams?: { name: string; driver: string | null; reserved?: boolean }[];
  // Project-base / constructor workers — on-site crew multi-select sa ilalim ng workshop.
  workers?: { id: number; name: string; role: string | null }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const create = submitAction ?? createReturn;

  // Ang `setType` ay walang tumatawag habang nakatago ang Supplier Return tab
  // (2026-08-29) — hindi ito inaalis: iisang pagbabalik lang ng tab ang
  // kailangan, at buhay pa ang buong sangay ng supplier sa ibaba.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [type, setType] = useState<"customer" | "supplier">("customer");
  const [orderId, setOrderId] = useState<number | "">(defaultOrderId ?? "");
  const [poId, setPoId] = useState<number | "">("");
  const [supplier, setSupplier] = useState("");
  const [itemIdx, setItemIdx] = useState<number | "">("");
  // CUSTOMER RETURN (hiling 2026-08-23): ang item ay PINIPILI mula sa order, hindi
  // tina-type - nakatago ang mga field hangga't walang pinipili, at read-only
  // pagkapili (Qty ay editable: may partial return). Supplier Return ay walang
  // picker kaya laging kita at editable.
  const locked = type === "customer" && itemIdx !== "";
  const showItemFields = type === "supplier" || itemIdx !== "";
  const [itemDesc, setItemDesc] = useState("");
  const [itemImage, setItemImage] = useState<string | null>(null);
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState("");
  const [dimension, setDimension] = useState("");
  // Frame parts / add-ons (W · Hdbrd · L · Base · Legs) — saved combined into the
  // dimension column (splitDimension separates on display). HINDI na hiwalay na
  // input (bagong format 2026-08-18) — kasama na sa Specs.
  const [addons, setAddons] = useState("");
  // SPECS (bagong format): lahat ng "• …" bullets ng item description — isang
  // editable textarea sa halip na hiwa-hiwalay na Color/Dimension/Add-ons.
  const [specsText, setSpecsText] = useState("");
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("");
  const [reasonOther, setReasonOther] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderOpen, setOrderOpen] = useState(false);
  // TATLO ANG HINIHINGI (2026-08-27): Reason, Condition, Resolution. Ang
  // Condition at Resolution ay may DEFAULT noon ("Resellable" + "Refund money"),
  // kaya naisusumite ang RMA nang hindi man lang tiningnan ang dalawa — at ang
  // Refund ang pinakamabigat na resolution para maging aksidente. Blangko na
  // sila ngayon; ang submit ang naghaharang.
  // Laging "resaleable" (2026-09-01) — inalis ang Not resellable sa form; ang
  // setter ay iniwan para sa type-compat ng ibang gamit.
  const [condition] = useState<"" | "resaleable" | "defective">("resaleable");
  const [resolution, setResolution] = useState<"" | "refund" | "replacement" | "credit" | "rtv_credit" | "rework">("");
  const [refundAmount, setRefundAmount] = useState("");
  const [reworkTarget, setReworkTarget] = useState<"restock" | "redeliver">("restock");
  // ON SITE: ang DELIVERY TEAM ang nagdadala sa crew sa customer, at kailan.
  // Hindi workshop ang tanong dito — walang dinadala sa workshop.
  // Rework mode: on-site (fixed at the customer) vs pull-out (collected, repaired,
  // redelivered — charges a delivery price). The dropdown shows them as two entries.
  const [reworkMode, setReworkMode] = useState<"onsite" | "pullout">("onsite");
  // Nandoon na ang team — kukunin ngayon, laktawan ang planner (0209).
  const [pickupOnsite, setPickupOnsite] = useState(false);
  const [reworkDeliveryPrice, setReworkDeliveryPrice] = useState("");
  // On-site repair crew — multi-select mula sa project-base workers. Kapag walang
  // workers prop (declare mula sa Delivery modal), self-load via server action.
  //
  // NAKATAGO ANG PICKER SA DECLARE (2026-08-28) — ang natitirang tanong dito ay
  // tungkol sa SIRA, hindi kung sino ang gagawa. Ang state at ang paghahanap ay
  // itinira: babalik ito sa ibang lugar, at ang muling pagsulat nito ay walang
  // maidadagdag.
  const [crewIds, setCrewIds] = useState<Set<number>>(new Set());
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const toggleCrew = (id: number) => setCrewIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [crewOpts, setCrewOpts] = useState<{ id: number; name: string; role: string | null }[] | null>(workers ?? null);
  useEffect(() => {
    if (crewOpts != null || !(resolution === "rework" && reworkMode === "onsite")) return;
    let dead = false;
    (async () => {
      try {
        const { loadOnsiteCrewOptions } = await import("@/app/returns/actions");
        const list = await loadOnsiteCrewOptions();
        if (!dead) setCrewOpts(list);
      } catch { if (!dead) setCrewOpts([]); }
    })();
    return () => { dead = true; };
  }, [resolution, reworkMode, crewOpts]);
  // Replacement parts the repair consumes — picked from a fixed rate card, with qty.
  const [reworkParts, setReworkParts] = useState<{ part: string; qty: number; price: number }[]>([]);
  // LAGING Email QR (2026-08-27) — tinanggal ang method chips: ang QR ay
  // naipapadala agad sa submit; ang cash/transfer ay naitatala ng manager sa
  // review (collectReworkPayment, tumatanggap ng anumang paraan).
  // Opsyonal: singilin AGAD ang (bahagi ng) rework charge sa declaration mismo —
  // hindi na hihintayin ang review bago ma-record ang bayad.
  const [photos, setPhotos] = useState<string[]>([]);

  const order = useMemo(() => orders.find((o) => o.id === orderId) ?? null, [orders, orderId]);
  const po = useMemo(() => pos.find((p) => p.id === poId) ?? null, [pos, poId]);
  // Searchable Source-order list — filter by order # or customer name.
  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => `${o.order_number ?? ""} ${o.customer_name ?? ""}`.toLowerCase().includes(q));
  }, [orders, orderSearch]);

  const inp = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm";

  // When an order item is picked, snapshot its description / sku / default refund.
  // Item = the product NAME (first line) only; the "• …" bullets of the description
  // are parsed into their own Category / Color / Dimension fields when the per-item
  // fields are missing (website/customized orders).
  function pickItem(idx: number, from?: OrderOption) {
    // `from` ay para sa pagpili ng ORDER: ang `order` sa state ay nagmumula pa
    // sa `orderId`, at hindi pa iyon nag-a-update sa sandaling ito.
    const src = from ?? order;
    const it = src?.items[idx];
    if (!it) return;
    const specs = parseDescSpecs(it.description);
    setItemIdx(idx);
    setItemDesc(specs.name || it.description);
    setItemImage(it.image ?? null);
    setSku(it.sku ?? "");
    setCategory(it.category ?? specs.category ?? "");
    // Color/Dimension/Add-ons — itinatago pa rin sa columns (galing sa item
    // data mismo, hindi na hinuhula sa bullets), pero wala nang sariling input.
    setColor(it.color ?? "");
    const stored = splitDimension(it.dimension);
    setDimension(stored.size ?? "");
    setAddons(stored.frame ?? it.frame ?? "");
    // SPECS = lahat ng bullets ng description, editable pa.
    setSpecsText((it.description ?? "").split("\n").slice(1).map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^[•·\-\s]+/, "")).join("\n"));
    setQty(String(it.qty || 1));
    const lineVal = it.unitPrice * it.qty;
    const def = src ? Math.min(lineVal, src.balance > 0 ? src.balance : lineVal) : lineVal;
    setRefundAmount(String(Math.round(def)));
  }

  // The two rework entries share resolution "rework" and differ only by mode, so the
  // dropdown carries a composite value ("rework:onsite" / "rework:pullout") that the
  // onChange splits back into resolution + reworkMode.
  const resolutionOptions: readonly (readonly [string, string])[] =
    type === "supplier"
      ? ([["replacement", "Replace item"], ["rtv_credit", "Supplier credit"], ["refund", "Refund money"]] as const)
      // TATLO LANG ANG CUSTOMER RETURN (hiling 2026-08-27): Refund money at ang
      // dalawang rework. Tinanggal ang "Replace item" at "Store credit" — walang
      // dumadaan doon; ang sira ay kinukumpuni, hindi pinapalitan ng bagong
      // gamit o ng credit. Ang lumang RMA na may mga resolution na iyon ay
      // may pangalan pa rin sa listahan sa itaas (RESOLUTION_LABEL).
      : ([["refund", "Refund money"], ["rework:onsite", "Rework on Site"], ["rework:pullout", "Rework on Pull Out"]] as const);
  const resolutionValue = resolution === "rework" ? `rework:${reworkMode}` : resolution;

  function submit() {
    setError(null);
    if (type === "customer" && !orderId) { setError("Select the source order."); return; }
    if (type === "supplier" && !poId && !supplier.trim()) { setError("Select a PO or enter a supplier."); return; }
    if (!itemDesc.trim()) { setError("Enter the returned item."); return; }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) { setError("Enter a valid quantity."); return; }
    if (photos.length < 5) { setError(`Upload at least 5 proof photos (${photos.length}/5 so far).`); return; }
    if (!reason) { setError("Select the reason for this return."); return; }
    if (reason === "Other" && !reasonOther.trim()) { setError("Specify the reason."); return; }
    if (!condition) { setError("Select the item's condition."); return; }
    if (!resolution) { setError("Select the resolution."); return; }
    // PULLOUT: walang workshop/team/driver/petsa dito — sa Return / Defect
    // Approval na itinatakda ng manager (hiling 2026-08-27). Ang ON SITE ang
    // may tanong pa rin dito: sino ang crew, aling team, at kailan.

    const ra = Number(refundAmount);
    start(async () => {
      const res = await create({
        type,
        order_id: type === "customer" && orderId ? Number(orderId) : null,
        po_id: type === "supplier" && poId ? Number(poId) : null,
        supplier: type === "supplier" ? (po?.supplier ?? supplier) : null,
        customer_name: type === "customer" ? (order?.customer_name ?? null) : null,
        // Pangalan + spec bullets — ang review modal at iba pang views ay
        // nagbabasa ng bullets mula sa item_desc rest lines (bagong format).
        item_desc: [itemDesc.trim(), ...specsText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => "• " + l.replace(/^[•·\-\s]+/, ""))].join("\n"),
        item_image: itemImage,
        sku: sku || null,
        category: category || null,
        color: color || null,
        dimension: [dimension.trim(), addons.trim()].filter(Boolean).join(" · ") || null,
        qty: q,
        reason: (reason === "Other" ? reasonOther.trim() : reason) || null,
        item_condition: condition,
        resolution,
        refund_amount: resolution === "refund" && Number.isFinite(ra) ? ra : 0,
        rework_target: resolution === "rework" ? reworkTarget : null,
        // NULL LAHAT SA DALAWANG MODE (2026-08-28): sa Return / Defect Approval
        // itinatakda ng manager ang workshop, team, driver at petsa — siya ang
        // nakakakita ng buong ruta ng araw, hindi ang nagde-declare.
        rework_workshop_id: null,
        rework_pickup_team: null,
        rework_pickup_driver: null,
        rework_pickup_date: null,
        // ANG PAGKAKATAON ANG SINASABI NITO, hindi ang iskedyul: nandoon na
        // ang team. Ang petsa ay itinatakda ng approval (ngayon), kaya hindi
        // ito sumasalungat sa null sa itaas.
        // Kasama na ang refund (2026-09-01) — parehong "nandoon na kami" na bandera.
        rework_pickup_onsite: (resolution === "rework" || resolution === "refund") ? pickupOnsite : false,
        rework_mode: resolution === "rework" ? reworkMode : null,
        rework_onsite_crew: resolution === "rework" && reworkMode === "onsite"
          ? (crewOpts ?? []).filter((w) => crewIds.has(w.id)).map((w) => ({ id: w.id, name: w.name }))
          : null,
        rework_delivery_price: resolution === "rework" ? (Number(reworkDeliveryPrice) || 0) : 0,
        rework_parts: resolution === "rework" ? reworkParts.map((p) => ({ ...p, amount: p.qty * p.price })) : null,
        rework_payment_method: resolution === "rework" ? "Email QR" : null,
        photos,
      });
      if ("error" in res) { setError(res.error); return; }
      // Best-effort: ang declaration ay nakalista na, kaya kapag pumalya ang
      // QR email ay aabisuhan lang (makokolekta pa rin sa review). Ang manual
      // na "collect now" input ay tinanggal 2026-08-27 — sa review na
      // kinokolekta ang non-QR na bayad.
      if (resolution === "rework") {
        // LAGING Email QR: padalhan agad ang customer ng Maya QR para sa 50%
        // down — walang perang hawak kaya walang bayad na irerekord dito; ang
        // kredito ay awtomatiko pagka-scan/bayad (o manual record sa review).
        const { sendReworkQrRequest } = await import("@/app/orders/maya-actions");
        const q = await sendReworkQrRequest(res.id);
        if ("error" in q) window.alert(`Return ${res.return_no} declared, but the QR email failed: ${q.error}`);
        else if (!q.emailed) window.alert(`Return ${res.return_no} declared, but the order has no email address — collect the 50% in the review instead.`);
      }
      onCreated?.();
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 bg-[#4a3b1a] px-4 py-3 text-[#f4ead8]">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#caa45a] text-sm">↩</span>
          <div><div className="text-sm font-bold">New Return / RMA</div><div className="text-[11px] opacity-80">Declare → manager approves refund / restock</div></div>
          <button onClick={onClose} className="ml-auto text-[#e7dcc4] hover:text-white">✕</button>
        </div>
        {/* DALAWANG TUDLING (2026-08-25). Isang makipot na tudling ang lahat
            noon — ang labing-isang spec ng isang custom bed ay nagtutulak ng
            reason, resolution at ng litrato pababa sa dalawang screen na scroll,
            at hindi makikita nang sabay ang ANO ang ibinabalik at ANO ang
            gagawin dito. Tatlong pangkat ng tanong ito, hindi isang listahan:
              kaliwa  — alin ang bagay (order, item, SKU, build)
              kanan   — anong mali at anong gagawin (reason, resolution, bayad)
            Kaparehong hulma ng Delivery at Pickup modal. */}
        <div className="grid gap-4 p-4 lg:grid-cols-[1.05fr_1fr]">
          <div className="min-w-0 space-y-3">
          {/* NAKATAGO ANG SUPPLIER RETURN (hiling 2026-08-29). Isa lang ang
              uring idinedeklara ngayon: ang galing sa customer. Ang TAB lang ang
              inalis — buhay pa ang buong landas ng supplier (PO picker, `po_id`,
              at ang pagpapakita sa listahan at sa review), kaya nababasa pa rin
              ang mga naitala na at isang pagbabalik lang ang kailangan para
              maibalik ito. */}

          {type === "customer" ? (
            <>
              <div className="relative block">
                <span className="mb-1 block text-xs font-medium text-muted">Source order *</span>
                <input
                  value={order ? `${order.order_number ?? `Order #${order.id}`}${order.customer_name ? ` · ${order.customer_name}` : ""} (bal ${peso(order.balance)})` : orderSearch}
                  onChange={(e) => { setOrderSearch(e.target.value); setOrderId(""); setItemIdx(""); setOrderOpen(true); }}
                  onFocus={() => { setOrderOpen(true); if (order) { setOrderSearch(""); setOrderId(""); setItemIdx(""); } }}
                  placeholder="Search order # or customer…"
                  className={inp}
                />
                {orderOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setOrderOpen(false)} />
                    <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
                      {filteredOrders.length === 0 ? (
                        <p className="px-3 py-3 text-center text-xs text-muted">No order found.</p>
                      ) : filteredOrders.map((o) => (
                        <button
                          type="button"
                          key={o.id}
                          onClick={() => {
                            setOrderId(o.id);
                            setOrderSearch("");
                            setOrderOpen(false);
                            // ISANG ITEM LANG? WALANG PIPILIIN. Ang listahan ng
                            // isa ay hindi pagpipilian — ito na iyon. Punan agad
                            // ang detalye; ang order na maraming item ay
                            // naghihintay pa rin ng pagpili.
                            if (o.items.length === 1) pickItem(0, o);
                            else setItemIdx("");
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-stone-100"
                        >
                          <span className="font-medium">{o.order_number ?? `Order #${o.id}`}{o.customer_name ? <span className="font-normal text-muted"> · {o.customer_name}</span> : null}</span>
                          <span className="shrink-0 text-xs text-muted">bal {peso(o.balance)}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {order && order.items.length > 0 && (
                <div className="block">
                  <span className="mb-1 block text-xs font-medium text-muted">Pick item from order ({order.items.length})</span>
                  <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-stone-50/60 p-1.5">
                    {order.items.map((it, i) => {
                      const name = (it.description || "").split("\n")[0].trim();
                      const active = itemIdx === i;
                      return (
                        <button
                          type="button"
                          key={i}
                          onClick={() => pickItem(i)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                            active ? "border-primary bg-[#efe9d8] ring-1 ring-primary" : "border-border bg-surface hover:bg-stone-100",
                          )}
                        >
                          {it.image
                            ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={it.image} alt="" className="h-10 w-10 shrink-0 rounded object-cover ring-1 ring-border" />
                            : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-stone-200 text-base text-muted"></div>}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-foreground" title={name}>{name}</span>
                            <span className="block text-[11px] text-muted">{number(it.qty)} × {peso(it.unitPrice)}{it.sku ? ` · ${it.sku}` : ""}</span>
                          </span>
                          {active && <span className="shrink-0 text-primary">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                  <span className="mt-1 block text-[11px] text-muted">Click an item to fill in its details.</span>
                </div>
              )}
            </>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Purchase order (optional)</span>
                <select value={poId} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : ""; setPoId(v); const p = pos.find((x) => x.id === v); if (p?.supplier) setSupplier(p.supplier); }} className={inp}>
                  <option value="">— select PO —</option>
                  {pos.map((p) => (
                    <option key={p.id} value={p.id}>{p.pi_number ?? `PO #${p.id}`}{p.supplier ? ` · ${p.supplier}` : ""}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Supplier *</span>
                <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" className={inp} />
              </label>
            </>
          )}

          {showItemFields && (<>
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-2 block">
              <span className="mb-1 block text-xs font-medium text-muted">Item *</span>
              <input value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} placeholder="Item description" readOnly={locked} className={cn(inp, locked && "bg-stone-100 text-muted")} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Qty *</span>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className={inp} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">SKU (for restock)</span>
              <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU (optional)" readOnly={locked} className={cn(inp, locked && "bg-stone-100 text-muted")} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Category</span>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" readOnly={locked} className={cn(inp, locked && "bg-stone-100 text-muted")} />
            </label>
            {/* SPECS (bagong format 2026-08-18) — pinalitan ang hiwa-hiwalay na
                Color/Dimension/Add-ons: lahat ng detalye ay bullets dito,
                auto-fill mula sa napiling item, editable pa rin. */}
            <div className="col-span-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="block text-xs font-medium text-muted">Specifications / Design details</span>
              </div>
              {/* PAREHONG flat na card ng Product Details (2026-08-23) kapag may laman -
                  ang textarea ay para lang sa blangko (item na hindi galing sa order).
                  Walang "Edit as text" - sinisira nito ang anyo (hiling 2026-08-23). */}
              {specsText.trim() ? (
                <div className="rounded-lg border border-border bg-stone-50/60 p-3">
                  <SpecFieldsView category={specCategoryOf(category, itemDesc)} specs={specsText} />
                </div>
              ) : locked ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted">No specifications on this item.</p>
              ) : (
                <textarea value={specsText} onChange={(e) => setSpecsText(e.target.value)} rows={4} placeholder={"One line per detail — auto-fills when you pick an item, e.g.\nHeadboard Height: 4ft from floor\nLegs: 4 inches — Wood\nFabric: Amalia Cerulean"} className={cn(inp, "resize-y")} />
              )}
            </div>
          </div>
          </>)}
          </div>

          <div className="min-w-0 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Reason <span className="text-rose-600">*</span></span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={inp}>
              <option value="">— select reason —</option>
              {RETURN_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            {reason === "Other" && (
              <input value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} placeholder="Specify the reason…" className={cn(inp, "mt-2")} />
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              {/* LAGING RESELLABLE (hiling 2026-09-01, "alisin na natin ung Not
                  Resellable, automatic fill ung Resellable"). Ang pagbabalik sa
                  istante ay sa tamang yugto: refund = sa approval; rework = sa
                  Receiving QC pagbalik ng inayos na unit. */}
              <span className="mb-1 block text-xs font-medium text-muted">Condition</span>
              <input value="Resellable" readOnly className={cn(inp, "cursor-not-allowed bg-stone-100 text-muted")} />
              <span className="mt-1 block text-[11px] text-muted">Rework: restocked when it re-enters the warehouse. Refund: back to stock on approval.</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Resolution <span className="text-rose-600">*</span></span>
              <select value={resolutionValue} onChange={(e) => {
                const [res, mode] = e.target.value.split(":");
                setResolution(res as typeof resolution);
                if (res === "rework") {
                  const m = (mode as "onsite" | "pullout") ?? "onsite";
                  setReworkMode(m);
                  // Target is automatic per mode: On Site closes as delivered (item stayed
                  // with the customer); Pull Out redelivers the repaired item.
                  setReworkTarget(m === "pullout" ? "redeliver" : "redeliver");
                }
              }} className={inp}>
                <option value="">— select resolution —</option>
                {resolutionOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>

          {resolution === "refund" && type === "customer" && (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Refund amount</span>
                <input type="number" min={0} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder="0" className={inp} />
                <span className="mt-1 block text-[11px] text-muted">Paid out from PAN Overall on approval — the order&apos;s ledger is untouched.</span>
              </label>
              {/* NANDOON NA ANG TEAM (2026-09-01, hiling ni Joe) — parehong 0209
                  na bandera ng rework: kung nasa bahay pa ng customer ang team,
                  isasakay na NGAYON ang gamit — petsa ngayon, laktaw ang Route
                  Planner. Ang approval pa rin ang nagtatakda ng workshop na
                  magdodoble-check at ng pera. */}
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border-2 border-dashed border-[#caa45a] bg-[#faf6ec] px-3 py-2.5">
                <input type="checkbox" checked={pickupOnsite} onChange={(e) => setPickupOnsite(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#4a3b1a]" />
                <span className="text-[11px] leading-relaxed">
                  <b className="text-[#7a5e1f]">We are still here — loading it now.</b>
                  <span className="mt-0.5 block text-muted">
                    Tick this if the refunded item goes on the truck today. Leave it unticked if someone has to come back for it another day.
                  </span>
                </span>
              </label>
            </div>
          )}

          {resolution === "rework" && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 sm:grid-cols-2">
              {/* "After repair" is now automatic per mode — On Site closes as delivered
                  (the item never left the customer); Pull Out redelivers the repaired
                  item. So no target dropdown. Workshop applies to BOTH modes: Pull Out
                  repairs there; On Site sends that workshop's workers to the customer
                  (their QC declaration is how the repair crew gets paid). */}
              {/* ANG WORKSHOP AY PARA SA PULL OUT LANG (binago 2026-08-25) —
                  doon dadalhin ang bagay. Sa ON SITE ay walang dinadala sa
                  workshop: ang tanong ay SINONG DELIVERY TEAM ang magdadala sa
                  crew sa customer. Ang bayad ng crew ay open price sa HR
                  approval, at ang crew ang nakatala sa job — hindi ang
                  workshop, kaya hindi na iyon itinatanong dito. */}
              {/* PULLOUT: ang workshop/team/driver/petsa ay SA APPROVAL na
                  itinatakda (hiling 2026-08-27) — ang manager sa Return /
                  Defect Approval ang pipili, hindi ang nagde-declare. */}
              {/* PAREHONG MODE (hiling 2026-08-28): sa APPROVAL itinatakda ang
                  team at petsa, hindi dito. Nasa declare form pa rin ito noong
                  on-site, kaya dalawang beses itinatanong ang parehong bagay —
                  at ang sagot dito ay maaaring hindi na tama pagdating sa
                  aprubador, na siyang nakakakita ng buong ruta ng araw. */}
              <div className="block rounded-lg border border-dashed border-[#caa45a]/60 bg-white/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted sm:col-span-2">
                {reworkMode === "pullout"
                  ? <>The <b className="text-[#7a5e1f]">workshop</b>, <b className="text-[#7a5e1f]">pull-out team, driver, and pickup date</b> are set by the manager on <b className="text-[#7a5e1f]">Return / Defect Approval</b> before approving.</>
                  : <>The <b className="text-[#7a5e1f]">workshop</b>, <b className="text-[#7a5e1f]">visit team, driver, and visit date</b> are set by the manager on <b className="text-[#7a5e1f]">Return / Defect Approval</b> before approving.</>}
              </div>
              {/* NANDOON NA ANG TEAM (hiling 2026-08-29). May pagkakataong ang
                  team ay nasa bahay pa mismo ng customer nang makita ang sira —
                  naihatid nila kanina — at kukunin nila ang gamit NGAYON. Ang
                  pagpila sa Route Planner ay nangangahulugang babalik pa sila
                  bukas sa kaparehong bahay.
                  Ang APPROVAL ay hindi nilalaktawan: doon pa rin itinatakda ang
                  workshop at ang singil. Ang planner lang ang nilalampasan. */}
              {/* PAREHONG BANDERA SA DALAWANG MODE (hiling 2026-08-29). Ang
                  tinatanong ay "nandoon na ba sila", hindi kung ano ang gagawin
                  — at pareho ang sagot doon sa pagkuha at sa pagkumpuni. Iba
                  lang ang mangyayari: isasakay ang gamit, o aayusin sa lugar. */}
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border-2 border-dashed border-[#caa45a] bg-[#faf6ec] px-3 py-2.5 sm:col-span-2">
                  <input type="checkbox" checked={pickupOnsite} onChange={(e) => setPickupOnsite(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#4a3b1a]" />
                  {/* ANG GAGAWIN, HINDI ANG PROSESO (hiling 2026-08-29). Ang
                      "Route Planner" at "Rework (Pull Out) list" ay pangalan ng
                      screen — walang pakialam doon ang driver na nakatayo sa
                      harap ng customer. Isang tanong lang ang sinasagot niya:
                      isasakay ko ba ito ngayon. */}
                  <span className="text-[11px] leading-relaxed">
                    <b className="text-[#7a5e1f]">
                      {reworkMode === "pullout"
                        ? "We are still here — loading it now."
                        : "We are still here — fixing it now."}
                    </b>
                    <span className="mt-0.5 block text-muted">
                      {reworkMode === "pullout"
                        ? "Tick this if the item goes on the truck today. Leave it unticked if someone has to come back for it another day."
                        : "Tick this if the repair happens on this visit. Leave it unticked and the piece will be collected to the workshop instead — pickup with proof photos, repaired there, then redelivered."}
                    </span>
                  </span>
                </label>
              {/* TINANGGAL ANG CREW PICKER SA DECLARE (hiling 2026-08-28).
                  Ang natitirang tanong dito ay tungkol sa SIRA — ano ito, ano
                  ang ipapalit, magkano. Kung SINO ang gagawa ay desisyon ng
                  pag-apruba, kasama ng workshop at ng petsa. Nakatago lang ang
                  UI: buhay pa ang `crewIds` state at ang paghahanap ng
                  manggagawa, kaya kaya itong ibalik kahit saan mailagay. */}
              {/* Replacement parts consumed by the repair — picked from the rate card. */}
              <div className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-muted">Replacement parts</span>
                <select value="" onChange={(e) => {
                  const rc = REWORK_PARTS.find((p) => p.part === e.target.value);
                  if (rc) setReworkParts((prev) => [...prev, { part: rc.part, qty: 1, price: rc.price }]);
                }} className={inp}>
                  <option value="">＋ Add a part…</option>
                  {REWORK_PARTS.map((p) => <option key={p.part} value={p.part}>{p.part} — {peso(p.price)}{p.perUnit ? " per slat" : ""}</option>)}
                </select>
                {reworkParts.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {reworkParts.map((p, i) => {
                      const rc = REWORK_PARTS.find((x) => x.part === p.part);
                      return (
                        <div key={i} className="flex items-center gap-2 rounded-md border border-amber-200 bg-white px-2 py-1.5 text-xs">
                          <span className="flex-1 font-medium text-foreground">{p.part}</span>
                          {rc?.perUnit && (
                            <input type="number" min={1} value={p.qty}
                              onChange={(e) => { const q = Math.max(Number(e.target.value) || 1, 1); setReworkParts((prev) => prev.map((x, j) => j === i ? { ...x, qty: q } : x)); }}
                              className="w-14 rounded border border-border px-1 py-0.5 text-center tabular-nums" title="slats" />
                          )}
                          <span className="tabular-nums font-semibold text-amber-700">{peso(p.qty * p.price)}</span>
                          <button type="button" onClick={() => setReworkParts((prev) => prev.filter((_, j) => j !== i))} className="text-rose-500 hover:text-rose-700" aria-label="Remove">✕</button>
                        </div>
                      );
                    })}
                    <div className="flex justify-between border-t border-amber-200 pt-1 text-xs font-semibold">
                      <span className="text-muted">Parts total</span>
                      <span className="tabular-nums text-amber-800">{peso(reworkParts.reduce((s, p) => s + p.qty * p.price, 0))}</span>
                    </div>
                  </div>
                )}
              </div>
              {/* Both modes carry a delivery/visit price: pull-out = the redelivery run,
                  on-site = the crew's trip to the customer. */}
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-muted">Add Price (for delivery)</span>
                {/* HANGGANAN NG QR (2026-08-28). Ang buong singil ay ipinapa-QR
                    sa Maya, at tinatanggihan nito ang lampas sa ₱9,999,999 —
                    walang QR at walang email na napapadala, at ang tanging
                    nakikita ay isang API error. Dito na hinaharang, sa lugar
                    kung saan naitatala ang halaga. */}
                <input type="number" min={0} max={9999999} value={reworkDeliveryPrice} onChange={(e) => setReworkDeliveryPrice(e.target.value)} placeholder="0" className={inp} />
                {Number(reworkDeliveryPrice) > 9999999 && (
                  <span className="mt-1 block text-[11px] font-medium text-rose-700">
                    Too high for a payment QR — the limit is ₱9,999,999.
                  </span>
                )}
                <span className="mt-1 block text-[11px] text-amber-700">
                  {reworkMode === "pullout" ? "Charged to the customer for redelivering the repaired item." : "Charged to the customer for the on-site repair visit."}
                </span>
              </label>
              {/* Payment method for the 50% rework downpayment — chosen now, like an
                  order. On submit it's saved so the review shows just this one option. */}
              {/* TINANGGAL ang payment-method chips (hiling 2026-08-27): LAGING
                  Email QR — ang QR ay naipapadala sa customer agad sa submit.
                  Kapag cash/transfer pala ang ibinayad, naitatala iyon ng
                  manager sa review (manual record sa ilalim ng QR card). */}
              {/* TINANGGAL ang "Collect payment now" input (hiling 2026-08-27) —
                  ang koleksyon ay sa review / Email QR na; estimate na lang ng
                  50% ang naiwan. Server ang huling tuos. */}
              <div className="block sm:col-span-2">
                {(() => {
                  const partsTotal = reworkParts.reduce((s, p) => s + p.qty * p.price, 0);
                  const deliv = reworkMode === "pullout" ? (Number(reworkDeliveryPrice) || 0) : 0;
                  const est = Math.round(((order?.balance ?? 0) + partsTotal + deliv) * 50) / 100;
                  return <span className="mt-1 block text-[11px] text-amber-700">50% downpayment ≈ <b>{peso(est)}</b> (order balance + parts + delivery ÷ 2). A payment QR is emailed to the customer on submit — the rework can be approved once 50% is in.</span>;
                })()}
              </div>
              <span className="col-span-full text-[11px] text-amber-700">
                {reworkMode === "pullout"
                  ? <>Pull out the item → workshop repair → QC → <b>auto-redelivery</b> via the Delivery Queue.</>
                  : <>Repair on site → straight to Installation on approval. No pull-out, no delivery run.</>}
                {" "}No refund, no loss.
              </span>
            </div>
          )}

          <div>
            <span className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
              <span>Proof photos <span className="text-rose-600">* (at least 5)</span></span>
              <span className={cn("font-semibold", photos.length >= 5 ? "text-emerald-600" : "text-rose-600")}>{photos.length}/5</span>
            </span>
            <MultiImageUpload value={photos} onChange={setPhotos} camera folder="returns-photos" />
          </div>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
          {/* Ang singil na hindi kayang i-QR ay hindi dapat maitala: ang QR ang
              paraan ng pagbayad dito, at kapag tinanggihan ito ng Maya ay
              walang maipapadalang email sa customer. */}
          <button onClick={submit} disabled={pending || photos.length < 5 || Number(reworkDeliveryPrice) > 9999999} className="w-full rounded-lg bg-[#4a3b1a] px-4 py-2.5 text-sm font-bold text-[#f4ead8] hover:opacity-90 disabled:opacity-60">
            {pending ? "Submitting…"
              : Number(reworkDeliveryPrice) > 9999999 ? "Delivery price is too high for a payment QR"
              : photos.length < 5 ? `Add ${5 - photos.length} more photo${5 - photos.length === 1 ? "" : "s"} to submit` : "＋ Submit return → Pending approval"}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
