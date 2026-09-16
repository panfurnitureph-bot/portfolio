"use client";

// DELIVERY QUEUE (Operations) — dalawang sub-tab, Orders-style tables:
//   For Scheduling  — QC-passed, auto-grouped by delivery-location proximity;
//                        per group: pili ng Team + Delivery date → isang click,
//                        sabay-sabay na confirmation emails.
//   Awaiting Confirm — na-emailan na, grouped pa rin; Resend / Unqueue per
//                        row. Pag nag-Confirm ang customer → Delivery module.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, ReworkCell } from "./ui";
import { ProductPreviewModal, previewFromItem, type ProductPreview } from "./product-preview-modal";
import { RushBadge } from "./rush-badge";
import { EditOrderModal } from "./edit-order-modal";
import { DEFAULT_RUSH_DAYS } from "@/lib/rush";
import { sendGroupConfirmations, resendConfirmation, unqueueOrder } from "@/app/operations/delivery-queue/actions";
import { useLiveData } from "@/lib/live-data";
import { DeliveryScheduleTool } from "./delivery-schedule-tool";
import type { QueueData, QueueOrder, Team, Driver } from "@/app/operations/delivery-queue/data";
import type { OrderRow, ProductRow } from "@/lib/supabase/server";

const TD = "px-3 py-2.5 border-b border-r border-border !text-center";
const peso = (n: number) => `₱${(Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

function fmtSent(iso: string | null): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-PH", { month: "numeric", day: "numeric" }); } catch { return ""; }
}

// Shared row cells ng For Scheduling tables — draggable papunta sa team boards.
// Order # at RMA # ay magkahiwalay na columns (pare-pareho sa ibang tables).
// Lokal na petsa ngayon (YYYY-MM-DD) — hindi UTC: ang pangako ay sa araw ng
// tindahan sinusukat, hindi sa Greenwich.
const todayISO = () => new Date().toLocaleDateString("en-CA");
// "2026-09-06" → "September 6, 2026" (hiling 2026-08-28). Ang ISO ay para sa
// paghahambing, hindi sa pagbasa: ang nagpaplano ay nagtitingin ng araw, hindi
// ng string. Ang `T00:00:00` ay pumipigil sa paglipat ng araw dahil sa UTC.
// ANG HANGGANAN NG "MALAPIT NA" (2026-08-28). Ang delivery na nasa loob nito ay
// nasa team boards; ang mas malayo ay nasa Scheduled Later. Iisang halaga para
// sa legend, sa paghahati, at sa pagbabalik — kung hihiwalay ang mga ito,
// magsasalungat ang sinasabi ng pahina at ang ginagawa nito.
const NEAR_DAYS = 5;
const daysOut = (iso: string | null): number | null => {
  if (!iso) return null;
  const ms = new Date(`${iso}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime();
  return Math.round(ms / 86_400_000);
};

const fmtLongDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });

// PRODUCT STATUS (hiling 2026-08-28). Ang tanong ng nag-iiskedyul ay iisa:
// buo ba ang ipapadala o hati. Ang isang order na iisa ang produkto at handa na
// ay "Completed"; ang apat na produkto na dalawa lang ang handa ay "Partial" —
// dalawa ang sasakay ngayon, dalawa ang babalik sa pila pagkahanda.
function ProductStatus({ m }: { m: QueueOrder }) {
  const partial = m.items_ready < m.items_total;
  return (
    <span className="inline-flex flex-col items-center gap-0.5 leading-tight">
      <span className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset",
        partial ? "bg-amber-50 text-amber-700 ring-amber-600/20" : "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
      )}>
        {partial ? "Partial" : "Completed"}
      </span>
      <span className="text-[10px] text-muted tabular-nums">{m.items_ready} of {m.items_total} ready</span>
      {m.items_delivered > 0 && (
        <span className="text-[10px] text-emerald-700" title="Delivered on an earlier batch">
          {m.items_delivered} delivered
        </span>
      )}
    </span>
  );
}

function QueueRowCells({ m }: { m: QueueOrder }) {
  return (
    <>
      <td className={cn(TD, "font-mono whitespace-nowrap")}>
        <div className="flex flex-col items-center gap-0.5">
          {m.is_rush && <RushBadge isRush dateOrder={m.date_order} threshold={m.rush_days ?? DEFAULT_RUSH_DAYS} />}
          <span>{m.order_number ?? `#${m.id}`}</span>
          {/* ANG DAMI LANG DITO (2026-08-28): ang kalagayan ay may sariling
              hanay na ngayon — Product Status. */}
          {m.items_total > 1 && (
            <span className="rounded-full bg-[#faf6ec] px-2 py-0.5 font-sans text-[10px] font-semibold text-[#4a3b1a] ring-1 ring-inset ring-[#caa45a]/40">
              {m.items_total} products
            </span>
          )}
        </div>
      </td>
      <td className={cn(TD, "whitespace-nowrap")}><ReworkCell isRework={m.is_rework} rmaNo={m.rma_no} /></td>
      <td className={cn(TD, "whitespace-nowrap font-medium text-[#5a4a26]")}>{m.customer_name ?? "—"}</td>
      <td className={cn(TD, "whitespace-nowrap text-muted")}>{m.sales_rep ?? "—"}</td>
      <td className={cn(TD, "max-w-0")}><span className="block truncate text-muted" title={m.address ?? undefined}>{m.address ?? "—"}</span></td>
      {/* ANG PANGAKONG PETSA (hiling 2026-08-28). Ang "Proposed Sched." ay
          itatakda pa ng planner; ito ang nakasulat sa order noong binili — at
          iyon ang batayan kung alin ang unang iruruta. Namumula kapag lumipas
          na: hindi na maaabot ang pangako. */}
      <td className={cn(TD, "whitespace-nowrap")}>
        {m.date_of_delivery
          ? <span className={cn("font-semibold", m.date_of_delivery < todayISO() ? "text-rose-600" : "text-[#5a4a26]")}
              title={m.date_of_delivery < todayISO() ? "Past the promised date" : "Promised delivery date on the order"}>
              {fmtLongDate(m.date_of_delivery)}
            </span>
          : <span className="text-muted">—</span>}
      </td>
      <td className={cn(TD, "whitespace-nowrap font-semibold")}>{peso(m.balance)}</td>
    </>
  );
}

// ── FOR SCHEDULING BOARD — Team A–D na agad + DRAG & DROP ─────────────────────
// Ang mga order ay nasa area pool (auto-grouped by proximity); i-drag ang row
// papunta sa team board (o palipat-lipat sa pagitan ng boards). Bawat board ay
// may sariling Driver + Date + isang "Set date & send confirmations" na click.
function TeamBoard({ team, members, drivers, coordinators = [], canEdit, onOpen, onDropOrder, onUnassign }: {
  team: Team; members: QueueOrder[]; drivers: Driver[]; coordinators?: string[]; canEdit: boolean;
  onOpen: (id: number) => void; onDropOrder: (orderId: number, teamId: number) => void; onUnassign: (orderId: number) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [date, setDate] = useState("");
  const [driverName, setDriverName] = useState(team.driver ?? "");
  // Delivery Coordinator ng run — auto-fill sa delivery record pagka-send.
  const [coordinatorName, setCoordinatorName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const send = () => {
    setMsg(null);
    start(async () => {
      const res = await sendGroupConfirmations({ orderIds: members.map((m) => m.id), group: `${team.name} route`, dateISO: date, teamId: team.id, driverName: driverName || undefined, coordinatorName: coordinatorName || undefined });
      if ("error" in res) { setMsg(res.error); return; }
      setMsg(res.skipped.length ? `Sent ${res.sent} — ${res.skipped.join("; ")}` : null);
      router.refresh();
    });
  };

  return (
    <div
      onDragOver={(e) => { if (!canEdit) return; e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault(); setOver(false);
        const id = Number(e.dataTransfer.getData("text/plain"));
        if (id) onDropOrder(id, team.id);
      }}
      className={cn("overflow-hidden rounded-xl border shadow-sm transition-colors", over ? "border-emerald-500 ring-2 ring-emerald-300" : "border-[#e6dcc4]")}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[#caa45a] bg-[#4a3b1a] px-4 py-2">
        <p className="text-xs font-bold uppercase tracking-wide text-[#f4ead8]">
          {team.name} <span className="font-semibold normal-case tracking-normal opacity-75">· {members.length} stop{members.length === 1 ? "" : "s"}</span>
        </p>
        <span className="ml-auto inline-flex flex-wrap items-center justify-end gap-2">
          <select value={driverName} onChange={(e) => setDriverName(e.target.value)} disabled={!canEdit}
            className="rounded-md border-0 bg-white px-2 py-1 text-xs font-semibold text-[#2b2620]" title="Driver — reserved drivers can be swapped in">
            <option value="">Driver — select</option>
            {drivers.map((d) => <option key={d.name} value={d.name}>{d.name}{d.reserved ? " (Reserved)" : ""}</option>)}
          </select>
          <select value={coordinatorName} onChange={(e) => setCoordinatorName(e.target.value)} disabled={!canEdit}
            className="rounded-md border-0 bg-white px-2 py-1 text-xs font-semibold text-[#2b2620]" title="Delivery Coordinator — auto-fills on the delivery record">
            <option value="">Coordinator — select</option>
            {coordinators.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!canEdit}
            className="rounded-md border-0 bg-white px-2 py-1 text-xs font-semibold text-[#2b2620]" />
          {/* KAILANGAN ANG TATLO BAGO IPADALA (hiling 2026-08-28). Ang petsa lang
              ang hinihingi noon — naipapadala ang confirmation email nang walang
              driver at walang coordinator, at ang stop ay lumalabas sa ruta na
              walang may-ari. Ang email ay hindi na maibabawi, kaya dito
              hinaharang, at sinasabi kung ano ang kulang sa halip na manatiling
              kupas ang pindutan nang walang paliwanag. */}
          {(() => {
            const missing = [!driverName && "driver", !coordinatorName && "coordinator", !date && "date"].filter(Boolean) as string[];
            const blocked = missing.length > 0 || !members.length;
            return (
              <button type="button" onClick={send} disabled={!canEdit || pending || blocked}
                title={missing.length ? `Set the ${missing.join(", ")} first` : undefined}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {pending ? "Sending…"
                  : missing.length && members.length ? `Set the ${missing.join(", ")} first`
                  : `Set date & send confirmations (${members.length})`}
              </button>
            );
          })()}
        </span>
      </div>
      {members.length === 0 ? (
        <div className={cn("px-4 py-6 text-center text-xs font-medium", over ? "bg-emerald-50 text-emerald-700" : "bg-white text-muted")}>
          Drag orders here to assign them to {team.name}.
        </div>
      ) : (
        <div className="overflow-x-auto">
          {/* NAKATAKDANG LAPAD (hiling 2026-08-28). `auto` ang lahat noon, at ang
              bawat team board ay sariling tabla — kaya sumusukat ang bawat isa
              sa sarili nitong laman at hindi nagtutugma ang mga hanay pababa.
              Isang set ng lapad para sa apat na board. */}
          <table className="w-full min-w-[880px] table-fixed border-collapse bg-white text-[11px] xl:text-sm [&_th]:!text-center [&_th]:font-bold [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b [&_th]:border-r [&_th]:border-border">
            <colgroup>
              <col className="w-[8%]" /><col className="w-[6%]" /><col className="w-[8%]" /><col className="w-[9%]" />
              <col className="w-[18%]" /><col className="w-[10%]" /><col className="w-[8%]" /><col className="w-[9%]" />
              <col className="w-[8%]" /><col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[2%]" />
            </colgroup>
            <thead>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&>th]:bg-[#5a4a26]">
                <th>Order #</th><th>RMA #</th><th>Customer</th><th>Sales Rep</th><th>Address</th><th>Delivery Date</th><th>Balance</th><th>Driver</th><th>Coordinator</th><th>Proposed Sched.</th><th>Product Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} draggable={canEdit}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", String(m.id))}
                  onClick={() => onOpen(m.id)} className="cursor-pointer hover:bg-[#faf6ec]" title="Drag to another team, or click to view/edit">
                  <QueueRowCells m={m} />
                  <td className={cn(TD, "whitespace-nowrap")}>{driverName || <span className="text-muted">—</span>}</td>
                  <td className={cn(TD, "whitespace-nowrap")}>{coordinatorName || <span className="text-muted">—</span>}</td>
                  <td className={cn(TD, "whitespace-nowrap")}>{date || <span className="text-muted">—</span>}</td>
                  <td className={cn(TD, "whitespace-nowrap")}><ProductStatus m={m} /></td>
                  <td className={TD} onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => onUnassign(m.id)} className="rounded px-1.5 text-muted hover:text-danger" title="Remove from this team">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg && <p className="border-t border-border bg-red-50 px-4 py-2 text-xs font-medium text-red-700">{msg}</p>}
    </div>
  );
}

// Area pool card — hindi pa naka-assign sa team; draggable ang rows.
function AreaPool({ label, members, canEdit, onOpen }: { label: string; members: QueueOrder[]; canEdit: boolean; onOpen: (id: number) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e6dcc4] shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px] xl:text-sm [&_th]:!text-center [&_th]:font-bold [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b [&_th]:border-r [&_th]:border-border">
          <thead>
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              {/* Siyam ang hanay sa ibaba — pito ito noon, kaya may dalawang
                  blangkong cell sa dulo ng banner. */}
              <th colSpan={9} className="border-b border-[#caa45a] !text-left bg-[#4a3b1a]">
                {label} <span className="font-semibold normal-case tracking-normal opacity-75">· {members.length} stop{members.length === 1 ? "" : "s"} — drag each row to a team board above</span>
              </th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&>th]:bg-[#5a4a26]">
              <th>Order #</th><th>RMA #</th><th>Customer</th><th>Sales Rep</th><th>Address</th><th>Delivery Date</th><th>Balance</th><th>Product Status</th><th>Status</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {members.map((m) => (
              <tr key={m.id} draggable={canEdit}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", String(m.id))}
                onClick={() => onOpen(m.id)} className="cursor-grab hover:bg-[#faf6ec] active:cursor-grabbing" title="Drag to a team board, or click to view/edit">
                <QueueRowCells m={m} />
                <td className={cn(TD, "whitespace-nowrap")}><ProductStatus m={m} /></td>
                <td className={TD}><span className="whitespace-nowrap rounded-full bg-[#6f6234]/15 px-2.5 py-1 text-[11px] font-bold text-[#6f6234]">For Confirmation</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Board wrapper — AUTO-ASSIGN ang bawat area cluster sa Team A–D (round-robin,
// magkakasama ang magkakalapit na stops sa iisang team); ang drag ay OVERRIDE
// lang kung sakaling gustong ilipat. ✕ = ibalik sa area pool (unassigned).
function ForSchedulingBoard({ clusters, teams, drivers, coordinators = [], canEdit, onOpen }: {
  clusters: QueueData["forScheduling"]; teams: Team[]; drivers: Driver[]; coordinators?: string[]; canEdit: boolean; onOpen: (id: number) => void;
}) {
  // 0 = sadyang inalis sa team; wala = sundin ang auto-assign.
  const [ovr, setOvr] = useState<Record<number, number>>({});
  // ── MALAPIT NA vs MALAYO PA (hiling 2026-08-28) ──────────────────────────
  // Handa na ang gamit, pero ang delivery date ay malayo pa — hindi pa dapat
  // ito nasa mga board: nagsisiksik lang doon at nawawala ang tunay na
  // apurahan sa mata ng nagpaplano.
  //   ≤ 5 araw   → For Scheduling (Team A–D)
  //   ≥ 7 araw   → Scheduled Later, sa ibaba
  // Ang order na WALANG petsa ay itinuturing na malapit: walang pangakong
  // hinihintay, kaya wala ring dahilang ipagpaliban.
  //
  // Maaari itong hilahin pabalik-balik: ang panuntunan ay panimulang lagay
  // lang, at may araw na kailangang isama o alisin ang isang stop sa run
  // kahit hindi tugma sa bilang ng araw.

  const [laterOvr, setLaterOvr] = useState<Record<number, boolean>>({});
  const isLater = (m: QueueOrder): boolean => {
    const forced = laterOvr[m.id];
    if (forced !== undefined) return forced;
    const d = daysOut(m.date_of_delivery);
    return d != null && d > NEAR_DAYS;
  };

  const near = clusters.map((c) => ({ ...c, members: c.members.filter((m) => !isLater(m)) }));
  const later = clusters.flatMap((c) => c.members).filter(isLater)
    .sort((a, b) => String(a.date_of_delivery ?? "9999").localeCompare(String(b.date_of_delivery ?? "9999")));

  const all = near.flatMap((c) => c.members);
  const validIds = new Set(all.map((m) => m.id));
  const autoTeam = new Map<number, number>();
  near.forEach((c, i) => {
    const t = teams[i % Math.max(teams.length, 1)];
    if (t) for (const m of c.members) autoTeam.set(m.id, t.id);
  });
  const teamOf = (id: number): number | null => {
    const o = ovr[id];
    if (o === 0) return null;
    return o ?? autoTeam.get(id) ?? null;
  };
  const byTeam = (tid: number) => all.filter((m) => teamOf(m.id) === tid);
  const pools = near
    .map((c) => ({ ...c, members: c.members.filter((m) => teamOf(m.id) == null) }))
    .filter((c) => c.members.length > 0);
  // Ang paghila papunta sa isang board ay nagsasabing kasama ito sa run —
  // kahit malayo pa ang petsa. Kaya inaalis din nito sa Scheduled Later.
  const drop = (orderId: number, teamId: number) => {
    setLaterOvr((p) => ({ ...p, [orderId]: false }));
    setOvr((p) => ({ ...p, [orderId]: teamId }));
  };
  const unassign = (orderId: number) => setOvr((p) => ({ ...p, [orderId]: 0 }));
  // Ibalik sa ibaba: hindi kasama sa run na ito.
  const pushLater = (orderId: number) => {
    setLaterOvr((p) => ({ ...p, [orderId]: true }));
    setOvr((p) => ({ ...p, [orderId]: 0 }));
  };

  return (
    <div className="space-y-4">
      {teams.map((t) => (
        <TeamBoard key={t.id} team={t} members={byTeam(t.id)} drivers={drivers} coordinators={coordinators} canEdit={canEdit}
          onOpen={onOpen} onDropOrder={drop}
          onUnassign={(id) => {
            // Ang inalis sa team ay bumabalik sa Scheduled Later kung malayo pa
            // ang petsa; kung malapit na, sa area pool gaya ng dati.
            const m = all.find((x) => x.id === id);
            const d = daysOut(m?.date_of_delivery ?? null);
            if (d != null && d > NEAR_DAYS) pushLater(id); else unassign(id);
          }} />
      ))}
      {pools.map((c, i) => (
        <AreaPool key={`${c.label}-${i}`} label={c.label} members={c.members} canEdit={canEdit} onOpen={onOpen} />
      ))}
      {later.length > 0 && (
        <ScheduledLater members={later} canEdit={canEdit} onOpen={onOpen} onPull={drop} teams={teams} />
      )}
    </div>
  );
}

// ── SCHEDULED LATER (hiling 2026-08-28) ──────────────────────────────────────
// Handa na ang gamit pero mahigit limang araw pa ang delivery date. Nasa mga
// board ito noon, kasama ng mga aalis ngayong linggo — nagsisiksik lang at
// nawawala ang apurahan sa mata. Nakalista ito rito, pinakamalapit na petsa sa
// taas, at maaaring hilahin papunta sa alinmang board kapag isasama sa run.
function ScheduledLater({ members, canEdit, onOpen, onPull, teams }: {
  members: QueueOrder[]; canEdit: boolean;
  onOpen: (id: number) => void; onPull: (orderId: number, teamId: number) => void; teams: Team[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e6dcc4] shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#caa45a] bg-[#6f6234] px-4 py-2">
        <p className="text-xs font-bold uppercase tracking-wide text-[#f4ead8]">
          Scheduled Later <span className="font-semibold normal-case tracking-normal opacity-75">· {members.length} order{members.length === 1 ? "" : "s"}</span>
        </p>
        <span className="text-[11px] text-[#e7dcc4]/80">Ready to ship, but due later than {NEAR_DAYS} days out. These rise to the boards on their own as the date nears — or drag one onto a team now.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] table-fixed border-collapse bg-white text-[11px] xl:text-sm [&_th]:!text-center [&_th]:font-bold [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b [&_th]:border-r [&_th]:border-border">
          <colgroup>
            <col className="w-[8%]" /><col className="w-[6%]" /><col className="w-[8%]" /><col className="w-[9%]" />
            <col className="w-[18%]" /><col className="w-[10%]" /><col className="w-[8%]" /><col className="w-[9%]" />
            <col className="w-[8%]" /><col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[2%]" />
          </colgroup>
          <thead>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&>th]:bg-[#5a4a26]">
              <th>Order #</th><th>RMA #</th><th>Customer</th><th>Sales Rep</th><th>Address</th><th>Delivery Date</th><th>Balance</th><th>Days Out</th><th>Product Status</th><th colSpan={3}>Assign to</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const d = daysOut(m.date_of_delivery);
              return (
                <tr key={m.id} draggable={canEdit}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", String(m.id))}
                  onClick={() => onOpen(m.id)}
                  className="cursor-grab hover:bg-[#faf6ec] active:cursor-grabbing" title="Drag onto a team board, or click to view the product">
                  <QueueRowCells m={m} />
                  <td className={cn(TD, "whitespace-nowrap tabular-nums text-muted")}>{d != null ? `${d} days` : "—"}</td>
                  <td className={cn(TD, "whitespace-nowrap")}><ProductStatus m={m} /></td>
                  {/* Para sa tablet na walang drag: pindutin ang team. */}
                  <td className={TD} colSpan={3} onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <div className="flex flex-wrap justify-center gap-1">
                        {teams.map((t) => (
                          <button key={t.id} type="button" onClick={() => onPull(m.id, t.id)}
                            className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold text-muted hover:border-[#caa45a] hover:text-[#4a3b1a]"
                            title={`Move to ${t.name}`}>
                            {t.name.replace(/^Team\s*/i, "")}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Awaiting Confirm group table ──────────────────────────────────────
function AwaitingGroup({ g, canEdit, onOpen }: { g: QueueData["awaiting"][number]; canEdit: boolean; onOpen: (id: number) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const act = (fn: (id: number) => Promise<{ ok: true } | { error: string }>, id: number) => {
    setMsg(null);
    start(async () => {
      const res = await fn(id);
      if ("error" in res) { setMsg(res.error); return; }
      router.refresh();
    });
  };
  return (
    <div className="overflow-hidden rounded-xl border border-[#e6dcc4] shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px] xl:text-sm [&_th]:!text-center [&_th]:font-bold [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b [&_th]:border-r [&_th]:border-border">
          <thead>
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={4} className="border-b border-[#caa45a] !text-left bg-[#4a3b1a]">
                {g.group} <span className="font-semibold normal-case tracking-normal opacity-75">· {g.members.length} stop{g.members.length === 1 ? "" : "s"}</span>
              </th>
              {/* 4 + 9 = 13, ang bilang ng hanay sa ibaba. Siyam ito noon,
                  kaya may dalawang blangkong cell na nakabitin sa dulo ng
                  banner — puting puwang na walang dahilan. */}
              <th colSpan={9} className="border-b border-[#caa45a] !text-right bg-[#4a3b1a]">
                <span className="normal-case tracking-normal text-[11px] text-[#e7dcc4]">
                  Delivery date: <b className="text-white">{g.date ?? "—"}</b> · {g.members.length} waiting
                </span>
              </th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&>th]:bg-[#5a4a26]">
              <th>Order #</th><th>RMA #</th><th>Customer</th><th>Sales Rep</th><th>Address</th><th>Delivery Date</th>
              <th>Team</th><th>Driver</th><th>Proposed Sched.</th><th>Balance</th><th>Product Status</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {g.members.map((m) => (
              <tr key={m.id} onClick={() => onOpen(m.id)} className="cursor-pointer hover:bg-[#faf6ec]" title="Click to view/edit this order">
                <td className={cn(TD, "font-mono whitespace-nowrap")}>
                  <div className="flex flex-col items-center gap-0.5">
                    {m.is_rush && <RushBadge isRush dateOrder={m.date_order} threshold={m.rush_days ?? DEFAULT_RUSH_DAYS} />}
                    <span>{m.order_number ?? `#${m.id}`}</span>
                  </div>
                </td>
                <td className={cn(TD, "whitespace-nowrap")}><ReworkCell isRework={m.is_rework} rmaNo={m.rma_no} /></td>
                <td className={cn(TD, "whitespace-nowrap font-medium text-[#5a4a26]")}>{m.customer_name ?? "—"}</td>
                <td className={cn(TD, "whitespace-nowrap text-muted")}>{m.sales_rep ?? "—"}</td>
                <td className={cn(TD, "max-w-0")}><span className="block truncate text-muted" title={m.address ?? undefined}>{m.address ?? "—"}</span></td>
                {/* Ang pangakong petsa — kulang ang cell dito kahit may header. */}
                <td className={cn(TD, "whitespace-nowrap")}>
                  {m.date_of_delivery
                    ? <span className={cn("font-semibold", m.date_of_delivery < todayISO() ? "text-rose-600" : "text-[#5a4a26]")}>{fmtLongDate(m.date_of_delivery)}</span>
                    : <span className="text-muted">—</span>}
                </td>
                <td className={cn(TD, "whitespace-nowrap")}>{m.dq_team ?? "—"}</td>
                <td className={cn(TD, "whitespace-nowrap")}>{m.dq_driver ?? "—"}</td>
                <td className={cn(TD, "whitespace-nowrap font-semibold")}>{m.dq_date ?? "—"}</td>
                <td className={cn(TD, "whitespace-nowrap font-semibold")}>{peso(m.balance)}</td>
                <td className={cn(TD, "whitespace-nowrap")}><ProductStatus m={m} /></td>
                <td className={TD}>
                  <span className="inline-flex flex-col items-center gap-0.5">
                    <span className="whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 ring-1 ring-inset ring-amber-600/20">Awaiting Confirm</span>
                    <span className={cn("text-[10px]", m.dq_followups >= 3 ? "font-bold text-red-600" : "text-muted")}>
                      {m.dq_followups >= 3 ? `${m.dq_followups}× no response — CALL` : `Email ${fmtSent(m.dq_sent_at)}${m.dq_followups ? ` · follow-up ${m.dq_followups}×` : " · first send"}`}
                    </span>
                  </span>
                </td>
                <td className={TD} onClick={(e) => e.stopPropagation()}>
                  {canEdit && (
                    <div className="flex justify-center gap-1">
                      <button type="button" disabled={pending} onClick={() => act(resendConfirmation, m.id)}
                        className="whitespace-nowrap rounded-lg border border-[#caa45a] bg-[#faf6ec] px-2 py-1 text-[11px] font-semibold text-[#4a3b1a] hover:bg-[#f4ead8] disabled:opacity-50" title="Resend the confirmation email">
                        ↻ Resend
                      </button>
                      <button type="button" disabled={pending} onClick={() => act(unqueueOrder, m.id)}
                        className="whitespace-nowrap rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50" title="Return to For Scheduling">
                        ✕ Unqueue
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <p className="border-t border-border bg-red-50 px-4 py-2 text-xs font-medium text-red-700">{msg}</p>}
    </div>
  );
}

// ── Main: sub-tab chips ───────────────────────────────────────────────
export function DeliveryQueueManager({ data: serverData, canEdit, products = [], assignees = [], constructors = [], coordinators = [] }: {
  data: QueueData;
  canEdit: boolean;
  products?: ProductRow[];
  assignees?: { name: string; role?: string }[];
  constructors?: { name: string; role: string }[];
  coordinators?: string[];
}) {
  // LIVE DATA (0216 Phase 2): kapag may kampana sa mga table na sandigan ng
  // pila, sariwang JSON ang kinukuha — ang buong derived na grupo, server pa
  // rin ang nagbuo — sa halip na buong render: ~0.5-1s ang paggalaw ng pila
  // sa bawat bukas na device.
  const data = useLiveData(serverData, "/api/live/delivery-queue",
    ["orders", "deliveries", "returns", "workshop_job", "warehouse_qc", "ops_line_skip"]);
  const [tab, setTab] = useState<"sched" | "await" | "resched">("sched");
  // Row click -> buksan ang Edit Order modal (kapareho ng Sales Orders).
  const [editing, setEditing] = useState<OrderRow | null>(null);
  // PREVIEW, HINDI EDIT (hiling 2026-08-28). Ang pag-click ay bumubukas ng Edit
  // Order noon — pero ang gawain dito ay pag-iiskedyul, hindi pag-aayos ng
  // order. Ang tinitingnan ng nagpaplano ay ANO ang ihahatid: larawan, specs,
  // dami. Ang pag-edit ay nasa Sales Orders.
  // LAHAT NG PRODUKTO, HINDI ANG UNA (2026-08-29). `items[0]` lang ang nakikita
  // noon — ang ORD-000003 na may dalawang produkto ay nagpapakita ng isa, kaya
  // walang paraang malaman kung ALIN ang handa at alin ang hindi.
  const [previewOrder, setPreviewOrder] = useState<QueueOrder | null>(null);
  const openOrder = (id: number) => {
    const q = [...data.forScheduling.flatMap((c) => c.members), ...data.awaiting.flatMap((g) => g.members)]
      .find((r) => r.id === id);
    if (q?.items?.length) setPreviewOrder(q);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([["sched", `For Scheduling · ${data.counts.forScheduling}`], ["await", `Awaiting Confirm · ${data.counts.awaiting}`], ["resched", "Delivery Schedule"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={tab === key
              ? "rounded-full bg-[#4a3b1a] px-4 py-2 text-sm font-semibold text-[#f4ead8]"
              : "rounded-full border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-black/60 hover:border-[#caa45a]"}>
            {label}
          </button>
        ))}
      </div>

      {tab === "sched" && (
        <div className="space-y-4">
          {/* LEGEND (hiling 2026-08-28). Ang panuntunan ng paghahati ay nasa
              code lang — walang makakaalam kung bakit nasa ibaba ang isang
              order maliban sa nagsulat nito. Nakasulat na ito sa mismong
              pahina, at ipinapaalala na kusa itong gumagalaw araw-araw. */}
          {data.forScheduling.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[#e6dcc4] bg-[#faf8f3] px-3.5 py-2 text-[11px] text-muted">
              <span className="font-bold uppercase tracking-wide text-[#a8842e]">How this splits</span>
              <span><b className="text-[#4a3b1a]">Due in {NEAR_DAYS} days or less</b> — on the team boards, ready to route</span>
              <span><b className="text-[#4a3b1a]">Due later than that</b> — in Scheduled Later below</span>
              <span className="text-[#8a8272]">Moves on its own each day as dates come closer. Drag any order either way to override.</span>
            </div>
          )}
          {data.forScheduling.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-muted">
              No QC-passed orders waiting to be scheduled.
            </div>
          ) : (
            <ForSchedulingBoard clusters={data.forScheduling} teams={data.teams} drivers={data.drivers} coordinators={coordinators} canEdit={canEdit} onOpen={openOrder} />
          )}
        </div>
      )}

      {tab === "await" && (
        <div className="space-y-4">
          {data.awaiting.length === 0 && (
            <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-muted">
              No confirmations waiting for a response.
            </div>
          )}
          {data.awaiting.map((g, i) => <AwaitingGroup key={`${g.group}-${g.date}-${i}`} g={g} canEdit={canEdit} onOpen={openOrder} />)}
        </div>
      )}

      {tab === "resched" && <DeliveryScheduleTool orders={data.orderRows} canEdit={canEdit} />}

      {editing && (
        <EditOrderModal
          order={editing}
          open={!!editing}
          onClose={() => setEditing(null)}
          products={products}
          assignees={assignees}
          constructors={constructors}
        />
      )}
      {previewOrder && <OrderItemsModal order={previewOrder} onClose={() => setPreviewOrder(null)} />}
    </div>
  );
}

// ── ORDER ITEMS PREVIEW (hiling 2026-08-29) ──────────────────────────────────
// Ang isang stop ay maaaring maramihan ang produkto, at ang tanong ng
// nagpaplano bago mag-load ay hindi "ilan" kundi "ALIN": alin ang handa, alin
// ang hinihintay pa. Ang `items[0]` lang ang nakikita noon — ang ORD-000003 na
// may mesa at sofa bed ay nagpapakita ng mesa lang.
//
// Nakalista silang lahat dito, may tag kada isa, at ang pagpindot sa isa ay
// nagbubukas ng buong Product Details.
function OrderItemsModal({ order, onClose }: { order: QueueOrder; onClose: () => void }) {
  const [one, setOne] = useState<ProductPreview | null>(null);
  const readyCount = order.items.filter((i) => i.ready).length;
  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
        <div className="my-8 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2.5 bg-[#4a3b1a] px-4 py-3 text-[#f4ead8]">
            <div>
              <div className="text-sm font-bold">Products · {order.order_number ?? `#${order.id}`}</div>
              <div className="text-[11px] opacity-80">
                {order.items.length} item{order.items.length === 1 ? "" : "s"} · {readyCount} ready
                {(() => {
                  const st = order.items.filter((i) => i.source === "stock").length;
                  const ws = order.items.filter((i) => i.source === "workshop").length;
                  const parts = [st ? `${st} from warehouse` : "", ws ? `${ws} from workshop` : ""].filter(Boolean);
                  return parts.length ? ` (${parts.join(", ")})` : "";
                })()}
                {order.date_of_delivery ? ` · due ${fmtLongDate(order.date_of_delivery)}` : ""}
              </div>
            </div>
            <button onClick={onClose} className="ml-auto text-[#e7dcc4] hover:text-white">✕</button>
          </div>
          <div className="divide-y divide-[#f5f1e6]">
            {order.items.map((it, i) => {
              const lines = String(it.description ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
              return (
                <button key={i} type="button"
                  onClick={() => setOne(previewFromItem(
                    { description: it.description, image_url: it.image, sku: it.sku, color: it.color, dimension: it.dimension, qty: it.qty },
                    order.order_number,
                  ))}
                  className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[#faf8f3]">
                  {it.image
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={it.image} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-[#e6dcc4] object-cover" />
                    : <div className="h-16 w-16 shrink-0 rounded-lg border border-dashed border-[#e6dcc4] bg-[#faf6ec]" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-[#2b2620]">{i + 1}. {lines[0] || "Item"}</span>
                      {it.delivered ? (
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-muted">Delivered earlier</span>
                      ) : it.ready ? (
                        <>
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Ready</span>
                          {/* SAAN KUKUNIN (2026-08-29). Pareho silang handa, pero
                              magkaiba ang lugar: ang isa ay nasa istante, ang isa
                              ay nakahanda sa workshop. Ang nagpi-pick ang
                              nangangailangan nito. */}
                          {it.source === "stock" && (
                            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-600/20" title="Skipped at Order Approval — comes off warehouse stock">
                              from warehouse
                            </span>
                          )}
                          {it.source === "workshop" && (
                            <span className="rounded-full bg-[#faf6ec] px-2 py-0.5 text-[10px] font-semibold text-[#7a5e1f] ring-1 ring-inset ring-[#caa45a]/40" title="Built by the workshop — QC passed">
                              from workshop
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-600/20">Still in production</span>
                      )}
                    </div>
                    {it.sku && <div className="font-mono text-[11px] text-[#8a6a1f]">{it.sku}</div>}
                    {lines.length > 1 && (
                      <div className="mt-0.5 text-[11px] leading-relaxed text-muted">
                        {lines.slice(1).map((l, j) => <div key={j}>{l.replace(/^[•·-]\s*/, "")}</div>)}
                      </div>
                    )}
                    <div className="mt-0.5 text-[11px] text-muted">Quantity: {it.qty}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <ProductPreviewModal item={one} onClose={() => setOne(null)} />
    </>
  );
}
