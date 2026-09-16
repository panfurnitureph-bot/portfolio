"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Thumbnail } from "@/components/thumbnail";
import { cn } from "@/components/ui";
import { usePagination, PaginationFooter } from "@/components/pagination-footer";
import { ExportButton } from "@/components/export-button";
import { QcRecordDetail } from "@/components/warehouse-qc-manager";
import { Modal } from "@/components/modal";
import { SpecFieldsView } from "@/components/spec-fields-input";
import { specCategoryOf } from "@/components/line-items-editor";
import { buildSpecLines, realValue } from "@/lib/product-columns";
import type { LedgerMonitor, Movement } from "@/app/scan/movements";
import type { QcRow } from "@/app/quality-control/data";

// Map a QC-derived ledger movement to the QcRow shape the shared QC detail modal
// expects, so the ledger opens the EXACT same record view (with hover preview).
function toQcRow(r: Movement): QcRow {
  const qc = r.qc!;
  return {
    id: r.id,
    checkpoint: qc.checkpoint,
    source: (qc.source as QcRow["source"]) ?? "order",
    ref_label: r.product_name,
    // Tanaw lang ang ledger — hindi ito ang landas ng "Mark dispatched",
    // kaya walang order id na dala. Ang buton na iyon ay nasa QC history.
    ref_id: null,
    sku: r.sku,
    product_name: r.product_name,
    build_specs: r.build_specs ?? [],
    category: r.category,
    color: r.color,
    dimension: r.dimension,
    qty: qc.good_qty + qc.defect_qty,
    good_qty: qc.good_qty,
    defect_qty: qc.defect_qty,
    result: "pass",
    photos: qc.photos,
    remarks: qc.remarks,
    checked_by: qc.inspector,
    created_at: r.created_at,
    stocked_at: r.created_at,
    image_url: r.image_url ?? null,
    order_number: r.ref ?? null,
    rma: r.rma ?? null,
  };
}

const EXPORT_COLUMNS = [
  { key: "created_at", label: "Created At" },
  { key: "product_name", label: "Product" },
  { key: "sku", label: "SKU" },
  { key: "category", label: "Category" },
  { key: "color", label: "Color" },
  { key: "specs", label: "Specs" },
  { key: "direction", label: "Direction" },
  { key: "qty", label: "Qty" },
  { key: "qty_before", label: "Qty Before" },
  { key: "qty_after", label: "Qty After" },
  { key: "ref", label: "Order #" },
  { key: "rma", label: "RMA #" },
  { key: "users", label: "Users" },
];

// "QC receive · Joe Marie Casela" → { cat: "QC receive", who: "Joe Marie Casela" }.
// Ang unang bahagi bago ang " · " ay ang uri ng galaw; ang natitira ay ang tao.
// Ang mahahabang notes ("Dispatch - rework redelivery correction (RMA-…)") ay
// pinuputol sa maikling category — nasa Order #/RMA # columns na ang mga numero.
function splitUsers(users: string | null): { cat: string; who: string } {
  const s = (users ?? "").trim();
  if (!s) return { cat: "—", who: "—" };
  const i = s.indexOf("·");
  const rawCat = (i < 0 ? s : s.slice(0, i)).trim();
  const cat = rawCat.split(" (")[0].split(" - ")[0].trim() || "—";
  if (i < 0) return { cat, who: "—" };
  // Tanggalin sa pangalan ang trailing ORD-/RMA- tokens — nasa sariling columns na.
  // Tanggalin pati ang HUBAD na ORD-/RMA- token (walang aktor ang hilera:
  // "Delivered · ORD-000001") — kung hindi, ang order number ang nagiging USERS.
  const who = s.slice(i + 1).trim()
    .replace(/(\s*·\s*(ORD-\d+|RMA-\d+))+\s*$/i, "")
    .replace(/^(ORD-\d+|RMA-\d+)$/i, "")
    .trim();
  return { cat, who: who || "—" };
}

const fmt = (n: number) => (Number(n) || 0).toLocaleString("en-PH");
function when(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

const FILTERS = ["All", "In", "Out"] as const;

// Unified Stock Movement Ledger — every in/out movement in one log, filterable + searchable.
export function StockLedger({ data, scanSlot }: { data: LedgerMonitor; scanSlot?: ReactNode }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [q, setQ] = useState("");
  const [view, setView] = useState<Movement | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (filter !== "All" && r.direction !== filter.toLowerCase()) return false;
      if (!s) return true;
      return [r.product_name, r.sku, r.category, r.color, r.dimension, r.users, r.ref, r.rma].join(" ").toLowerCase().includes(s);
    });
  }, [data.rows, q, filter]);

  const pg = usePagination(rows);

  // Export the filtered set with display-friendly values (first line of name, formatted date).
  const exportRows = useMemo(
    () =>
      rows.map((r) => ({
        created_at: when(r.created_at),
        product_name: (r.product_name ?? "").split("\n")[0],
        sku: r.sku,
        // Pareho ng table: ang build line ay hindi category/color, at ang
        // Specs ang may hawak ng build (tingnan ang lib/product-columns).
        category: realValue(r.category) ?? "",
        color: realValue(r.color) ?? "",
        specs: buildSpecLines(r).join(" · ") || realValue(r.dimension) || "",
        direction: r.direction,
        qty: r.qty,
        qty_before: r.qty_before,
        qty_after: r.qty_after,
        ref: r.ref,
        rma: r.rma,
        users: splitUsers(r.users).who,
      })),
    [rows],
  );

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="apk-hide grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Stock In Today" value={`+${fmt(data.inToday)}`} sub="units" tone="text-success" />
        <Kpi label="Stock Out Today" value={`−${fmt(data.outToday)}`} sub="units" tone="text-danger" />
        <Kpi label="Net Today" value={`${data.netToday >= 0 ? "+" : "−"}${fmt(Math.abs(data.netToday))}`} sub="in − out" tone={data.netToday >= 0 ? "text-success" : "text-danger"} />
        <Kpi label="Units This Week" value={fmt(data.unitsWeek)} sub="last 7 days" tone="text-foreground" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product / SKU / user…" className="w-72 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary" />
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn("rounded-md px-3 py-1 text-xs font-medium", filter === f ? "bg-primary text-primary-foreground" : "text-muted hover:bg-stone-100")}>{f}</button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted">{rows.length} record{rows.length === 1 ? "" : "s"}</span>
        <ExportButton filename="stock-ledger" columns={EXPORT_COLUMNS} rows={exportRows} />
        {/* Scan In / Out — kasabay ng filter row (right side), hindi na sa taas. */}
        {scanSlot}
      </div>

      {/* Log */}
      <div className="overflow-visible rounded-xl border border-border bg-surface">
        <div className="max-h-[70vh] overflow-auto rounded-t-xl pf-scroll">
          <table className="w-full xl:min-w-[1200px] border-collapse text-center text-[11px] xl:text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_td]:align-middle [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
            <colgroup>
              <col span={8} />
              <col span={4} />
              <col span={2} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
                <th colSpan={8} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] px-5 py-2">Product Information</th>
                <th colSpan={4} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Movement</th>
                <th colSpan={2} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Record</th>
              </tr>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
                <th className="sticky top-[33px] bg-[#5a4a26] px-3 py-3">Photo</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Order #</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">RMA</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Product</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">SKU</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Category</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Color</th>
                {/* SPECS, hindi Dimension (2026-08-23) — tingnan ang
                    lib/product-columns. */}
                <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Specs</th>
                <th className="sticky top-[33px] bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3">Direction</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Qty</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Qty Before</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Qty After</th>
                <th className="sticky top-[33px] bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3">Users</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Created At</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={14} className="px-4 py-10 text-center text-muted">No movements. Scan to Receive / Dispatch, or receive an incoming shipment.</td></tr>
              ) : (
                pg.slice.map((r) => {
                  const isIn = r.direction === "in";
                  // LAHAT NG ROW AY CLICKABLE NA (2026-08-26): ang QC row ay
                  // bubukas sa QC record; ang iba (hal. delivery stock-out) ay
                  // sa Product Details — dating walang nangyayari sa click.
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setView(r)}
                      className="cursor-pointer hover:bg-stone-50"
                      title={r.qc ? "View QC detail" : "View product details"}
                    >
                      {/* Hiwalay na hanay ang larawan — pantay ang hanay pababa
                          kahit mahaba ang pangalan ng produkto. */}
                      <td className="px-3 py-3">
                        <div className="flex justify-center">
                          <Thumbnail name={(r.product_name ?? "—").split("\n")[0]} url={r.image_url} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center font-mono text-xs font-semibold">{r.ref ?? "—"}</td>
                      {/* Karamihan ng galaw ay walang rework, at ang isang gitling
                          doon ay nababasa bilang kulang na datos. Ang tahasang
                          tag ang sagot: walang rework ang hilerang ito. */}
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        {r.rma
                          ? <span className="font-mono text-xs font-bold text-amber-700">{r.rma}</span>
                          : <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-muted">No Rework</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-3">
                          <span className="block min-w-[150px] max-w-[240px] truncate text-center font-medium" title={r.product_name ?? ""}>{(r.product_name ?? "—").split("\n")[0]}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted">{r.sku ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3">{realValue(r.category) ?? "—"}</td>
                      {/* Isang linya para normal ang row height — buong color
                          sa tooltip kapag naputol. */}
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="block max-w-[160px] truncate" title={realValue(r.color) ?? ""}>{realValue(r.color) ?? "—"}</span>
                      </td>
                      {/* ISANG LINYA (2026-08-26) — ang bawat spec ay dating
                          sariling linya, kaya ang upuang may anim ay anim na
                          linyang taas, at ang buong hanay ay umaayon doon. Ang
                          buong listahan ay nasa modal; dito ay sapat na ang
                          sulyap, may tooltip kapag hindi kasya. */}
                      <td className="px-4 py-3 text-muted">
                        {(() => {
                          const lines = buildSpecLines(r);
                          const text = lines.length ? lines.join(" · ") : (realValue(r.dimension) ?? "—");
                          return <span className="block max-w-[260px] truncate text-left" title={lines.join("\n")}>{text}</span>;
                        })()}
                      </td>
                      <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold uppercase", isIn ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>{r.direction}</span>
                      </td>
                      <td className={cn("whitespace-nowrap px-4 py-3 font-semibold", isIn ? "text-success" : "text-danger")}>{isIn ? "+" : "−"}{fmt(r.qty)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{r.qty_before ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold">{r.qty_after ?? "—"}</td>
                      <td className="!border-l-4 !border-l-[#caa45a] whitespace-nowrap px-4 py-3 text-muted">{splitUsers(r.users).who}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{when(r.created_at)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <PaginationFooter {...pg} />
      </div>

      {view?.qc && <QcRecordDetail row={toQcRow(view)} specs={view.specs ?? null} onClose={() => setView(null)} />}
      {view && !view.qc && <MovementDetail r={view} onClose={() => setView(null)} />}
    </div>
  );
}

// PRODUCT DETAILS NG ISANG GALAW NA HINDI QC (2026-08-26) — ang delivery
// stock-out ay walang QC record, kaya walang binubuksan ang click dati. Ito ang
// katapat: larawan, SKU/Category tiles, ang piniling build sa guided spec
// cards, at ang mismong galaw (qty, before/after, sino, kailan).
function MovementDetail({ r, onClose }: { r: Movement; onClose: () => void }) {
  const specText = buildSpecLines(r).join("\n") || r.specs || "";
  const isIn = r.direction === "in";
  return (
    <Modal open onClose={onClose} title="Product Details" description={r.ref ?? r.rma ?? (r.product_name ?? "").split("\n")[0]} size="lg"
      footer={<div className="flex justify-end"><button type="button" onClick={onClose} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90">Close</button></div>}>
      <div className="space-y-4">
        {r.image_url && (
          <div className="flex justify-center rounded-xl border border-border bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.image_url} alt="" className="max-h-48 object-contain" />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg border border-border bg-[#faf6ec]/60 px-3 py-2"><p className="text-[10px] font-bold uppercase text-muted">Product</p><p className="text-xs font-medium">{(r.product_name ?? "—").split("\n")[0]}</p></div>
          <div className="rounded-lg border border-border bg-[#faf6ec]/60 px-3 py-2"><p className="text-[10px] font-bold uppercase text-muted">SKU</p><p className="font-mono text-xs">{r.sku ?? "—"}</p></div>
          <div className="rounded-lg border border-border bg-[#faf6ec]/60 px-3 py-2"><p className="text-[10px] font-bold uppercase text-muted">Category</p><p className="text-xs font-medium">{realValue(r.category) ?? "—"}</p></div>
          <div className="rounded-lg border border-border bg-[#faf6ec]/60 px-3 py-2"><p className="text-[10px] font-bold uppercase text-muted">Color</p><p className="text-xs font-medium">{realValue(r.color) ?? "—"}</p></div>
        </div>
        {specText && <SpecFieldsView category={specCategoryOf(realValue(r.category), (r.product_name ?? "").split("\n")[0])} specs={specText} />}
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="bg-[#4a3b1a] px-3 py-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-[#f4ead8]">Movement</div>
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            <div className="bg-surface p-2.5 text-center"><p className="text-[9.5px] uppercase text-muted">Direction</p><p className={cn("text-sm font-bold", isIn ? "text-emerald-700" : "text-rose-700")}>{isIn ? "IN" : "OUT"} {isIn ? "+" : "−"}{fmt(r.qty)}</p></div>
            <div className="bg-surface p-2.5 text-center"><p className="text-[9.5px] uppercase text-muted">Qty Before</p><p className="text-sm font-bold tabular-nums">{r.qty_before ?? "—"}</p></div>
            <div className="bg-surface p-2.5 text-center"><p className="text-[9.5px] uppercase text-muted">Qty After</p><p className="text-sm font-bold tabular-nums">{r.qty_after ?? "—"}</p></div>
            <div className="bg-surface p-2.5 text-center"><p className="text-[9.5px] uppercase text-muted">Order # / RMA</p><p className="font-mono text-xs font-bold text-[#8a6a1f]">{r.ref ?? r.rma ?? "—"}</p></div>
          </div>
          <div className="flex items-center justify-between border-t border-border bg-[#faf6ec]/60 px-3 py-2 text-[11px] text-muted">
            <span>{splitUsers(r.users).cat} · <b className="text-foreground">{splitUsers(r.users).who}</b></span>
            <span>{when(r.created_at)}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-2 text-3xl font-bold tabular-nums leading-none", tone)}>{value}</p>
      <p className="mt-1.5 text-xs text-muted">{sub}</p>
    </div>
  );
}
