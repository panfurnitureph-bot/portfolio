"use client";

// PICKUP ROUTES — per-team Pickup Rework sa MISMONG hugis ng Delivery
// Route table (same columns), status lang ang naiiba: For Pickup → En Route →
// At Customer → Picked Up. Ang bawat hilera ay isang rework pull-out na
// naka-assign sa team na ito.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "./ui";
import { RushBadge } from "./rush-badge";
import { ViewReturn } from "./returns-manager";
import { ReworkPickupPanel } from "./rework-pickup-panel";
import { markPickupStage } from "@/app/rework/actions";
import type { ReworkRow } from "@/app/rework/data";
import type { ReturnRow } from "@/app/returns/data";

const peso = (n: number) => "₱" + (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtChip = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  try { return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
};

// Pickup-status mapping mula sa delivery lifecycle ng pickup task.
function pickupStatus(r: ReworkRow): { label: string; cls: string } {
  if (r.stage === "Awaiting Payment") return { label: "Awaiting 50% Down", cls: "bg-rose-50 text-rose-700" };
  const s = (r.pickup_status ?? "").toLowerCase();
  if (/delivered|arrived.*done/.test(s)) return { label: "Picked Up", cls: "bg-green-50 text-green-700" };
  if (/arrived/.test(s)) return { label: "At Customer", cls: "bg-teal-50 text-teal-700" };
  if (/out for/.test(s)) return { label: "En Route", cls: "bg-blue-50 text-blue-700" };
  return { label: "For Pickup", cls: "bg-amber-50 text-amber-700" };
}

export function PickupRoutes({ rows, team, returns = [], heading = "Pull-out pickups for rework" }: { rows: ReworkRow[]; team: string; returns?: ReturnRow[]; heading?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Row click → ang MISMONG Returns review modal (read-only) na may Pickup Date
  // at ang Navigate buttons sa LOOB nito.
  const [view, setView] = useState<ReworkRow | null>(null);
  const viewReturn: ReturnRow | null = view
    ? (returns.find((x) => x.return_no != null && x.return_no === view.return_no)
      ?? returns.find((x) => x.order_id != null && x.order_id === view.order_id && (x.resolution === "rework" || x.resolution === "refund"))
      ?? null)
    : null;
  const noop = () => {};
  // Waze-style na navigate (parehong map ng delivery): leg 1 → customer (kunin ang
  // item, Arrived = pirma + litrato); leg 2 → workshop (Arrived & Drop = pirma +
  // litrato ulit). Ang proof ay pumapasok sa /api/delivery/pickup-proof.
  const [nav, setNav] = useState<{ src: string; order: string } | null>(null);

  // TAPOS NA ANG PICKUP = SARADO ANG MODAL (2026-08-27). Ang `loadPickups` ay
  // nagsasala ng stage === "For Pickup", kaya ang na-drop na ay NAWAWALA sa
  // `rows` — at ang `?? view` na fallback sa ibaba ay ibinabalik ang LUMANG
  // snapshot (pickup_arrived: false), kaya "Start Pickup" ang nakikita ng
  // driver sa gamit na naihatid na niya.
  useEffect(() => {
    if (view && !rows.some((x) => x.id === view.id)) setView(null);
  }, [rows, view]);
  // OPTIMISTIC leg overrides — pagka-confirm sa map, agad kumakagat ang status/
  // button (At Customer → Deliver to Workshop → Picked Up) nang hindi
  // hinihintay ang server refresh.
  const [localLeg, setLocalLeg] = useState<Record<string, "arrived" | "dropped">>({});
  const stOf = (r: ReworkRow): { label: string; cls: string } => {
    const base = pickupStatus(r);
    const o = r.order_number ? localLeg[r.order_number] : undefined;
    if (o === "dropped" && base.label !== "Picked Up") return { label: "Picked Up", cls: "bg-green-50 text-green-700" };
    if (o === "arrived" && (base.label === "For Pickup" || base.label === "En Route")) return { label: "At Customer", cls: "bg-teal-50 text-teal-700" };
    return base;
  };
  const advance = (orderId: number | null, stage: "enroute" | "arrived" | "picked_up") => {
    if (orderId == null) return;
    start(async () => {
      const res = await markPickupStage(orderId, stage);
      if ("error" in res) { window.alert(res.error); return; }
      router.refresh();
    });
  };
  const openNav = (r: ReworkRow, leg: "customer" | "workshop") => {
    if (!r.order_number) return;
    const q = new URLSearchParams();
    q.set("pickup", "1");
    if (leg === "workshop") { q.set("drop", "1"); q.set("addr", r.workshop_address || r.workshop_name || ""); q.set("name", r.workshop_name ?? "Workshop"); }
    else { q.set("addr", r.address ?? ""); q.set("name", r.customer_name ?? ""); }
    q.set("order", r.order_number);
    q.set("v", "nav-0907e");
    setNav({ src: `/delivery-map.html?${q.toString()}`, order: r.order_number });
    // Pagbukas ng navigation papunta sa customer = umandar na — En Route agad.
    if (leg === "customer" && stOf(r).label === "For Pickup" && r.order_id != null) {
      void markPickupStage(r.order_id, "enroute").then(() => router.refresh());
    }
  };
  // Pag-confirm ng Arrived/Drop sa loob ng map → isara ang map, i-apply agad ang
  // optimistic status (mabilis kumagat ang susunod na button), saka i-refresh.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const m = e.data;
      if (m && m.type === "driver-arrived") {
        const leg: "arrived" | "dropped" = nav?.src.includes("drop=1") ? "dropped" : "arrived";
        const ord = (m.order as string | undefined) ?? nav?.order;
        if (ord) setLocalLeg((p) => ({ ...p, [ord]: leg }));
        setNav(null);
        router.refresh();
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [router, nav]);
  // Date chips — group by pickup schedule date; walang petsa → "Unscheduled".
  const dates = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.pickup_date ?? "", (m.get(r.pickup_date ?? "") ?? 0) + 1);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);
  const [selDate, setSelDate] = useState<string | null>(null);
  const date = selDate != null && dates.some(([d]) => d === selDate) ? selDate : null;
  // Pinakabago sa TAAS (desc by RMA/created) — pare-pareho sa ibang tables.
  const list = useMemo(
    () => (date == null ? rows : rows.filter((r) => (r.pickup_date ?? "") === date))
      .slice()
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
    [rows, date],
  );

  const driver = list.find((r) => r.pickup_driver)?.pickup_driver ?? "—";
  const doneCount = list.filter((r) => stOf(r).label === "Picked Up").length;

  // WALANG early return kapag empty — laging naka-render ang table headers
  // (kumpletong columns) na may empty-state row sa loob ng tbody.
  return (
    <div className="space-y-4">
      {/* Date chips (planner-style toolbar) */}
      {dates.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">Date:</span>
          <button type="button" onClick={() => setSelDate(null)}
            className={cn("rounded-lg px-3 py-1.5 text-xs font-bold", date == null ? "bg-[#4a3b1a] text-[#f4ead8] ring-1 ring-[#caa45a]" : "border border-border bg-surface text-muted hover:border-[#caa45a]")}>
            All
          </button>
          {dates.map(([d, n]) => (
            <button key={d || "none"} type="button" onClick={() => setSelDate(d)}
              className={cn("rounded-lg px-3 py-1.5 text-xs font-bold", d === date ? "bg-[#4a3b1a] text-[#f4ead8] ring-1 ring-[#caa45a]" : "border border-border bg-surface text-muted hover:border-[#caa45a]")}>
              {d ? fmtChip(d) : "Unscheduled"} · {n === 1 ? "1" : `${n} stops`}
            </button>
          ))}
        </div>
      )}

      {/* Team card — MISMONG Route Planner / Delivery Route table UI */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#3a3226] bg-gradient-to-r from-[#5a4a26] to-[#4a3b1a] px-4 py-2.5">
          <p className="text-xs font-bold uppercase tracking-wide text-[#f4ead8]">
            {team} · {driver}
            <span className="ml-2 font-medium normal-case text-[#c9b896]">{heading}</span>
          </p>
          <div className="ml-auto flex items-center gap-2.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#c9b896]">Picked up</span>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[#3a3226]">
              <span className="block h-full rounded-full bg-[#caa45a]" style={{ width: `${list.length ? (doneCount / list.length) * 100 : 0}%` }} />
            </span>
            <span className="text-[11px] font-bold tabular-nums text-[#f4ead8]">{doneCount}/{list.length}</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td:last-child]:border-r-0 [&_th]:border-b [&_th]:border-r [&_th]:border-[#6b5a2f] [&_th:last-child]:border-r-0">
          <thead>
            <tr className="bg-[#5a4a26] text-[10px] uppercase tracking-widest text-[#e7dcc4] [&>th]:text-center">
              <th className="px-3 py-2.5 font-bold">Stop</th>
              <th className="px-3 py-2.5 font-bold">Order #</th>
              <th className="px-3 py-2.5 font-bold">RMA #</th>
              <th className="px-3 py-2.5 font-bold">Customer</th>
              <th className="px-3 py-2.5 font-bold">Address</th>
              <th className="px-3 py-2.5 font-bold">Drop To</th>
              <th className="px-3 py-2.5 font-bold">Declared On</th>
              <th className="px-3 py-2.5 font-bold">Pickup Date</th>
              <th className="px-3 py-2.5 font-bold">Team</th>
              <th className="px-3 py-2.5 font-bold">Driver</th>
              <th className="px-3 py-2.5 font-bold">Charge Due</th>
              <th className="px-3 py-2.5 font-bold">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-10 text-center text-sm text-muted">
                {rows.length === 0
                  ? "No items waiting for pickup — pull-out tasks appear here once a rework is approved for this team."
                  : "No pickups for this date."}
              </td></tr>
            )}
            {list.map((r, i) => {
              const st = stOf(r);
              const done = st.label === "Picked Up";
              const due = Math.max((Number(r.charge_total) || 0) - (Number(r.downpayment) || 0), 0);
              return (
                <tr key={r.id} onClick={() => setView(r)} className="cursor-pointer border-b border-border last:border-0 hover:bg-stone-50">
                  <td className="px-3 py-3 text-center">
                    <span className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ring-1 ring-inset",
                      done ? "bg-emerald-600 text-white ring-emerald-600" : "bg-orange-100 text-orange-700 ring-orange-300",
                    )}>{done ? "✓" : i + 1}</span>
                  </td>
                  <td className="px-3 py-3 text-center font-mono text-xs font-semibold">
                    {r.is_rush && <RushBadge isRush dateOrder={r.order_date} threshold={r.rush_days ?? 14} className="mx-auto mb-0.5 block w-fit" />}
                    {r.order_number ?? "—"}
                  </td>
                  <td className="px-3 py-3 text-center font-mono text-xs font-bold text-amber-700">
                    {r.return_no ?? "—"}
                    {/* REFUND tag (2026-09-01): parehong biyahe ng rework
                        pull-out, pero pera-na-balik — doble-check sa workshop,
                        tapos balik sa istante bilang malayang stock. */}
                    {r.refund
                      ? <span className="mx-auto mt-0.5 block w-fit rounded-full bg-rose-100 px-2 py-0.5 font-sans text-[9px] font-extrabold uppercase tracking-wide text-rose-700">Refund</span>
                      : <span className="mx-auto mt-0.5 block w-fit rounded-full bg-amber-100 px-2 py-0.5 font-sans text-[9px] font-extrabold uppercase tracking-wide text-amber-700">Rework</span>}
                  </td>
                  <td className="px-3 py-3 text-center font-semibold">
                    {r.customer_name ?? "—"}
                    <span className="mx-auto block max-w-[200px] truncate text-[11px] font-normal text-muted" title={r.item ?? ""}>{r.item ?? ""}</span>
                  </td>
                  <td className="max-w-[260px] truncate px-3 py-3 text-center text-xs text-muted" title={r.address ?? undefined}>{r.address ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-center">
                    {r.workshop_name
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700 ring-1 ring-inset ring-orange-200">{r.workshop_name}</span>
                      : <span className="text-xs text-muted">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-center text-xs text-muted">{fmtDate(r.created_at)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-center text-sm font-bold">{fmtDate(r.pickup_date)}</td>
                  <td className="px-3 py-3 text-center text-xs">{r.pickup_team ?? team}</td>
                  <td className="px-3 py-3 text-center text-xs">{r.pickup_driver ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-center font-bold tabular-nums">{peso(due)}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-[11px] text-muted">
        Click a row to open the RMA — navigate, arrive with signature + photos, then drop at the workshop.
      </p>

      {/* Row click → Returns review modal (read-only) + Navigate actions sa loob. */}
      {view && viewReturn && (
        <ViewReturn
          r={viewReturn}
          canApprove={false}
          busy={false}
          readOnly
          pickupDate={view.pickup_date}
          onApprove={noop} onReject={noop} onMarkReworked={noop}
          onClose={() => setView(null)}
          extraActions={(() => {
            // SARIWANG ROW LAMANG. Ang `?? view` na fallback noon ay nagpapakita
            // ng LUMANG snapshot kapag nawala na sa `rows` ang tapos nang
            // pickup — at doon ay "Start Pickup" pa ang laman. Isinasara na ito
            // ng effect sa itaas; dito, walang panel kung wala ang sariwa.
            const cur = rows.find((x) => x.id === view.id);
            if (!cur) return null;
            // ANG BUONG PANEL, HINDI LANG DALAWANG BUTON (hiling 2026-08-27):
            // Live Tracking + Trip + Pickup Proof, kaparehong hugis ng Pickup
            // Task. Ang Start Pickup / Drop to Workshop ay nasa loob nito.
            return (
              <ReworkPickupPanel
                row={cur}
                onOpenMap={(leg) => openNav(cur, leg)}
              />
            );
          })()}
        />
      )}

      {/* Full-screen Waze-style map (same engine as delivery) */}
      {nav && (
        <div className="fixed inset-0 z-[80] bg-black">
          <div className="flex items-center justify-between bg-[#4a3b1a] px-4 py-2.5">
            <div className="truncate text-sm font-bold text-[#f4ead8]">Pickup · {nav.order}</div>
            <button type="button" onClick={() => setNav(null)} className="rounded-md bg-[#3a3226] px-3 py-1 text-xs font-bold text-[#e7dcc4] hover:bg-[#4a4030]">− Minimize</button>
          </div>
          <iframe src={nav.src} title="Pickup navigation" className="h-[calc(100%-44px)] w-full border-0" allow="geolocation; camera" />
        </div>
      )}
    </div>
  );
}
