"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
// xlsx (~900KB) + jszip (~150KB) loaded on demand inside the import handlers so
// they stay out of the initial /purchase-orders bundle.
import { cn } from "./ui";
import { usePagination, PaginationFooter } from "./pagination-footer";
import type { PurchaseOrderData, PurchaseOrder, POItem, POCell, POColumn } from "@/app/purchase-orders/data";
import {
  savePurchaseOrder, deletePurchaseOrder, saveImportTemplate, loadImportTemplate, uploadPoImage, uploadPoFile,
  updateDeliveryDate, type PurchaseOrderInput, type POItemInput,
} from "@/app/purchase-orders/actions";

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const STATUSES = ["Draft", "Sent", "Deposit Paid", "Ordered", "Partially Received", "Received", "Cancelled"];

// Mapping fields the importer needs to locate in the spreadsheet.
const MAP_FIELDS: { key: keyof Mapping; label: string; hints: string[] }[] = [
  { key: "item_no", label: "Item No.", hints: ["item no", "item", "model", "art"] },
  { key: "color", label: "Color", hints: ["color", "colour"] },
  { key: "description", label: "Description", hints: ["description", "descriptions", "desc"] },
  { key: "prod_size", label: "Size", hints: ["size", "prod. size", "dimension"] },
  { key: "qty", label: "Quantity", hints: ["q'ty", "qty", "quantity"] },
  { key: "unit_price", label: "Unit Price", hints: ["unit price", "unit fob", "fob price", "price"] },
];

type Mapping = { item_no: string; color: string; description: string; prod_size: string; qty: string; unit_price: string };

function colLetter(i: number): string {
  let s = "";
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
const letterToIdx = (l: string) => l.split("").reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0) - 1;

function money(n: number, cur: string): string {
  const v = (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur === "USD" ? `$${v}` : `${cur} ${v}`;
}
const num = (n: number) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Normalize a date string (incl. "July 20th, 2026" / "2026-5-13") to yyyy-mm-dd for date inputs.
function toISODate(s: string): string {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const cleaned = s.replace(/(\d+)(st|nd|rd|th)/gi, "$1").trim();
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Prefix the column's resolved currency symbol on a numeric extra value (¥ RMB / $ USD).
function curExtra(col: POColumn, value: string): string {
  if (!value || !col.cur || !/^[\d,.\s]+$/.test(value)) return value;
  return col.cur + value;
}

function statusPill(s: string) {
  const v = (s ?? "").toLowerCase();
  if (/^received/.test(v)) return "bg-green-50 text-green-700";
  if (/partial/.test(v)) return "bg-amber-50 text-amber-700";
  if (/ordered|deposit/.test(v)) return "bg-blue-50 text-blue-700";
  if (/sent/.test(v)) return "bg-violet-50 text-violet-700";
  if (/cancel/.test(v)) return "bg-rose-50 text-rose-700";
  return "bg-stone-100 text-stone-500";
}

export function PurchaseOrdersManager({ data }: { data: PurchaseOrderData }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<PurchaseOrder | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [editDel, setEditDel] = useState<number | null>(null);
  const [delPending, startDel] = useTransition();
  const router = useRouter();
  const saveDel = (id: number, v: string) => startDel(async () => { await updateDeliveryDate(id, v || null); router.refresh(); setEditDel(null); });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.rows.filter((r) => !s || [r.pi_number, r.supplier, r.status].some((x) => (x ?? "").toLowerCase().includes(s)));
  }, [data.rows, q]);

  const pg = usePagination(rows);

  return (
    <div className="space-y-5">
      {/* KPI */}
      <div className="apk-hide grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Total POs" value={String(data.kpi.total)} accent="bg-primary/10 text-primary" />
        <Kpi label="Pending" value={String(data.kpi.pending)} accent="bg-blue-100 text-blue-600" />
        <Kpi label="Partial" value={String(data.kpi.partial)} accent="bg-amber-100 text-amber-600" />
        <Kpi label="Received" value={String(data.kpi.received)} accent="bg-green-100 text-green-600" />
        <Kpi label="Total Value" value={`$${num(data.kpi.value)}`} accent="bg-violet-100 text-violet-600" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PI no / supplier…" className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
        <div className="ml-auto flex gap-2">
          <button onClick={() => setImporting(true)} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Import PI</button>
          <button onClick={() => setOpen("new")} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90">+ New PO</button>
        </div>
      </div>

      {/* List */}
      <div className="overflow-visible rounded-xl border border-border bg-surface shadow-sm">
        <div className="max-h-[70vh] overflow-auto rounded-t-xl">
        <table className="w-full min-w-[760px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <colgroup>
            <col span={2} />
            <col span={3} />
            <col span={2} />
            <col span={1} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="sticky top-0 z-10 bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={2} className="bg-[#4a3b1a] border-b border-[#caa45a] px-5 py-2">PI Info</th>
              <th colSpan={3} className="bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Shipment</th>
              <th colSpan={2} className="bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Totals</th>
              <th colSpan={1} className="bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a]"></th>
            </tr>
            <tr className="sticky top-[33px] z-10 bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="bg-[#5a4a26] px-4 py-3">PI No.</th>
              <th className="bg-[#5a4a26] px-4 py-3">Supplier</th>
              <th className="bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3">Date</th>
              <th className="bg-[#5a4a26] px-4 py-3">Delivery</th>
              <th className="bg-[#5a4a26] px-4 py-3">Items</th>
              <th className="bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3">Total</th>
              <th className="bg-[#5a4a26] px-4 py-3">Status</th>
              <th className="bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-muted">No purchase orders. Click <b>Import PI</b> or <b>+ New PO</b>.</td></tr>
            ) : pg.slice.map((r) => {
              const rcv = r.items.filter((i) => i.received_qty >= i.qty && i.qty > 0).length;
              return (
                <tr key={r.id} onClick={() => setOpen(r)} className="cursor-pointer border-b border-border last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-3 font-semibold">{r.pi_number || "—"}</td>
                  <td className="px-4 py-3">{r.supplier || "—"}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center text-muted">{r.date_order || "—"}</td>
                  <td className="px-4 py-3 text-center text-muted" onClick={(e) => e.stopPropagation()}>
                    {editDel === r.id
                      ? <input type="date" autoFocus disabled={delPending} defaultValue={toISODate(r.delivery_date ?? "")} onChange={(e) => saveDel(r.id, e.target.value)} onBlur={() => setEditDel(null)} className={cn(inp, "w-36")} />
                      : (r.delivery_date || "—")}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-muted">{rcv}/{r.items.length}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-right font-semibold tabular-nums">{money(r.total, r.currency)}</td>
                  <td className="px-4 py-3 text-center"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusPill(r.status))}>{r.status}</span></td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    {r.delivery_date ? <span className="text-xs text-muted">—</span> : <button onClick={() => setEditDel(r.id)} className="rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5">Edit</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <PaginationFooter {...pg} />
      </div>

      {open && <PoModal po={open === "new" ? null : open} onClose={() => setOpen(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onImported={() => setImporting(false)} />}
    </div>
  );
}

// ── PO detail / edit modal ──
function PoModal({ po, onClose }: { po: PurchaseOrder | null; onClose: () => void }) {
  const isNew = !po;
  const [pending, start] = useTransition();
  const [delPending, startDel] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [h, setH] = useState({
    pi_number: po?.pi_number ?? "",
    supplier: po?.supplier ?? "",
    date_order: po?.date_order ?? "",
    delivery_date: po?.delivery_date ?? "",
    currency: po?.currency ?? "USD",
    discount: po?.discount ?? 0,
    deposit_pct: po?.deposit_pct ?? 30,
    // FX rate (USD→PHP) seeded from the stored detail, so a foreign PO shows in PAN Overall.
    fx_rate: String((po?.details as Record<string, unknown> | undefined)?.["FX Rate"] ?? ""),
    status: po?.status ?? "Draft",
    notes: po?.notes ?? "",
  });
  const setHF = (k: keyof typeof h, v: string | number) => setH((p) => ({ ...p, [k]: v }));

  // Dynamic PI header details — exactly what each PO has (Terms, Ports, Container, Attn, Tel…).
  const [details] = useState<{ k: string; v: string }[]>(
    Object.entries(po?.details ?? {}).filter(([k]) => !/^fx rate$/i.test(k)).map(([k, v]) => ({ k, v: String(v) })),
  );
  const detailsObj = () => {
    const o = Object.fromEntries(details.filter((d) => d.k.trim()).map((d) => [d.k.trim(), d.v]));
    if (Number(h.fx_rate) > 0) o["FX Rate"] = String(Number(h.fx_rate)); // re-attach the FX rate
    return o;
  };

  const [items, setItems] = useState<POItemInput[]>(
    po?.items.length ? po.items.map(fromItem) : [blankItem()],
  );
  const upd = (i: number, p: Partial<POItemInput>) => setItems((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const receiveAll = () => setItems((a) => a.map((x) => ({ ...x, received_qty: Number(x.qty) || 0 })));

  // Union of extra-column keys across items, in first-seen order (Packing, CBM, G.W.…).
  const extraKeys = useMemo(() => {
    const keys: string[] = [];
    for (const it of items) for (const k of Object.keys(it.extra ?? {})) if (!keys.includes(k)) keys.push(k);
    return keys;
  }, [items]);

  // Render columns in the PI's original order (Received always last); fall back to a default for legacy POs.
  const cols = useMemo<POColumn[]>(() => {
    const base: POColumn[] = po?.columns?.length
      ? po.columns.filter((c) => c.kind !== "skip")
      : [
          { label: "Photo", kind: "photo" }, { label: "Item No.", kind: "item_no" }, { label: "Color", kind: "color" },
          { label: "Description", kind: "description" }, { label: "Size", kind: "prod_size" }, { label: "Qty", kind: "qty" },
          { label: "Unit Price", kind: "unit_price" }, { label: "Amount", kind: "amount" },
          ...extraKeys.map((k) => ({ label: k, kind: "extra" as const, key: k })),
        ];
    const rest = base.filter((c) => c.kind !== "received");
    // Assign a currency symbol to each money column by scanning left→right:
    // once an "RMB/EXW" column appears, following price/amount columns are ¥ (else $).
    let cur = "$";
    const withCur = rest.map((c) => {
      if (/rmb|exw|¥/i.test(c.label)) cur = "¥";
      else if (/usd|\$/i.test(c.label)) cur = "$";
      const money = c.kind === "unit_price" || c.kind === "amount" || (c.kind === "extra" && /amount|price/i.test(c.label));
      return money ? { ...c, cur } : c;
    });
    return [...withCur, { label: "Received", kind: "received" }];
  }, [po?.columns, extraKeys]);

  const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
  const total = Math.max(subtotal - (Number(h.discount) || 0), 0);
  const deposit = total * (Number(h.deposit_pct) || 0) / 100;
  const balance = total - deposit;

  function submit() {
    setError(null);
    const input: PurchaseOrderInput = {
      pi_number: h.pi_number, supplier: h.supplier, supplier_address: null, date_order: h.date_order, delivery_date: h.delivery_date,
      price_terms: null, payment_terms: null, port_shipment: null, port_destination: null, container: null,
      currency: h.currency || "USD", discount: Number(h.discount) || 0, deposit_pct: Number(h.deposit_pct) || 0,
      status: h.status, notes: h.notes, details: detailsObj(), items,
    };
    start(async () => {
      const res = await savePurchaseOrder(po?.id ?? null, input);
      if ("error" in res) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  }
  function remove() {
    if (!po) return;
    startDel(async () => {
      const res = await deletePurchaseOrder(po.id);
      if ("error" in res) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-6 w-fit min-w-[680px] max-w-[98vw] overflow-x-auto rounded-2xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">{isNew ? "New Purchase Order" : `PI ${h.pi_number || ""} · ${h.supplier || ""}`}</h2>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
          </div>
        </div>

        {/* Core fields — read-only except Status */}
        <div className="grid grid-cols-2 gap-3 border-b border-border p-5 md:grid-cols-4">
          <F label="PI Number"><p className="px-2 py-1.5 text-sm font-medium">{h.pi_number || "—"}</p></F>
          <F label="Supplier"><p className="px-2 py-1.5 text-sm font-medium">{h.supplier || "—"}</p></F>
          <F label="Date"><p className="px-2 py-1.5 text-sm">{h.date_order || "—"}</p></F>
          <F label="Delivery Date">{po?.delivery_date ? <p className="px-2 py-1.5 text-sm">{toISODate(h.delivery_date) || h.delivery_date}</p> : <input type="date" value={toISODate(h.delivery_date)} onChange={(e) => setHF("delivery_date", e.target.value)} className={cn(inp, "w-full")} />}</F>
          <F label="Status"><select value={h.status} onChange={(e) => setHF("status", e.target.value)} className={cn(inp, "w-full")}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="FX Rate (USD→₱)"><input type="number" min={0} step="0.01" value={h.fx_rate} onChange={(e) => setHF("fx_rate", e.target.value)} placeholder="e.g. 58.50" className={cn(inp, "w-full")} title="USD→PHP rate — makes this PO show in PAN Overall (peso ledger)" /></F>
        </div>

        {/* Dynamic PI header details — exact per PO (read-only) */}
        {details.length > 0 && (
          <div className="border-b border-border p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">PI Header Details</p>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
              {details.map((d, i) => {
                // "Attached File" holds "filename | url" (or just a url) → render a link.
                if (/^attached file$/i.test(d.k)) {
                  const [namePart, urlPart] = d.v.includes(" | ") ? d.v.split(" | ") : [d.v, d.v];
                  const url = (urlPart || namePart || "").trim();
                  const label = d.v.includes(" | ") ? namePart.trim() : "Download file";
                  return (
                    <div key={i} className="flex gap-2">
                      <dt className="shrink-0 font-medium text-muted">{d.k}:</dt>
                      <dd className="min-w-0 break-words">
                        <a href={url} target="_blank" rel="noreferrer" className="font-medium text-primary underline hover:opacity-80">{label}</a>
                      </dd>
                    </div>
                  );
                }
                return (
                  <div key={i} className="flex gap-2">
                    <dt className="shrink-0 font-medium text-muted">{d.k}:</dt>
                    <dd className="min-w-0 break-words">{d.v}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}

        {/* Line items */}
        <div className="p-5">
          <table className="w-full min-w-[820px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_td]:align-middle [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
            <thead>
              <tr className="bg-stone-50 text-xs uppercase text-muted">
                {cols.map((c, ci) => <th key={ci} className="px-2 py-2 whitespace-nowrap">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const amt = (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
                const full = Number(it.received_qty) >= Number(it.qty) && Number(it.qty) > 0;
                return (
                  <tr key={i}>
                    {cols.map((c, ci) => {
                      switch (c.kind) {
                        case "sn": return <td key={ci} className="px-2 py-1.5 text-center text-muted">{i + 1}</td>;
                        case "photo": return <td key={ci} className="px-2 py-1.5 text-center"><ZoomImg src={it.image_url} /></td>;
                        case "swatch": return <td key={ci} className="px-2 py-1.5 text-center"><ZoomImg src={it.swatch_url} /></td>;
                        case "item_no": return <td key={ci} className="px-2 py-1.5 font-medium">{it.item_no || "—"}</td>;
                        case "color": return <td key={ci} className="px-2 py-1.5 whitespace-pre-line text-muted">{it.color || "—"}</td>;
                        case "description": return <td key={ci} className="px-2 py-1.5 max-w-[280px] whitespace-pre-line text-muted">{it.description || "—"}</td>;
                        case "prod_size": return <td key={ci} className="px-2 py-1.5">{it.prod_size || "—"}</td>;
                        case "qty": return <td key={ci} className="px-2 py-1.5 text-right tabular-nums">{it.qty || ""}</td>;
                        case "received": return <td key={ci} className="px-2 py-1.5 text-right"><input type="number" min={0} value={it.received_qty || ""} onChange={(e) => upd(i, { received_qty: Number(e.target.value) })} className={cn(inp, "w-16 text-right", full && "bg-green-50 text-green-700")} /></td>;
                        case "unit_price": return <td key={ci} className="px-2 py-1.5 tabular-nums">{it.unit_price ? (c.cur ?? "$") + num(it.unit_price) : ""}</td>;
                        case "amount": return <td key={ci} className="px-2 py-1.5 font-semibold tabular-nums">{(c.cur ?? "$") + num(amt)}</td>;
                        default: return <td key={ci} className="px-2 py-1.5 whitespace-nowrap text-muted">{curExtra(c, it.extra?.[c.key ?? c.label] ?? "")}</td>;
                      }
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={receiveAll} className="rounded-lg border border-green-200 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50">✓ Receive All</button>
            <span className="text-xs text-muted">Only the Received column is editable (for receiving).</span>
          </div>
        </div>

        {/* Totals (read-only) */}
        <div className="flex flex-col items-end gap-1 border-t border-border px-5 py-4 text-sm">
          <div className="flex w-64 items-center justify-between border-t border-border pt-1 font-bold"><span>TOTAL</span><span className="tabular-nums">{money(total, h.currency)}</span></div>
          <div className="flex w-64 items-center justify-between"><span className="text-muted">{h.deposit_pct || 0}% Deposit</span><span className="tabular-nums text-blue-700">{money(deposit, h.currency)}</span></div>
          <div className="flex w-64 items-center justify-between"><span className="text-muted">Balance</span><span className="tabular-nums text-amber-700">{money(balance, h.currency)}</span></div>
        </div>

        {/* PI footer block — Delivery Date, Bank Information, BUYER/SUPPLIER (read-only) */}
        {po?.footer_rows?.length ? (
          <div className="border-t border-border p-5">
            <div className="space-y-1 text-sm text-muted">
              {po.footer_rows.map((r, i) => (
                <p key={i} className="whitespace-pre-wrap">{r.filter((c) => c.t.trim()).map((c, j) => <span key={j} style={{ color: c.c, fontWeight: c.b ? 700 : undefined, backgroundColor: c.bg }} className="mr-3">{c.t}</span>)}</p>
              ))}
            </div>
          </div>
        ) : null}

        {error && <p className="px-5 pb-2 text-sm text-rose-600">{error}</p>}
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          {!isNew ? <button onClick={remove} disabled={delPending} className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">{delPending ? "Deleting…" : "Delete"}</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-stone-100">Cancel</button>
            <button onClick={submit} disabled={pending} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Import PI modal ──
type Grid = (string | number)[][];
function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dupMsg, setDupMsg] = useState<string | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [srcFile, setSrcFile] = useState<File | null>(null); // original imported .xlsx/.csv, attached to the PO
  const [supplier, setSupplier] = useState("");
  const [piNumber, setPiNumber] = useState("");
  const [dateOrder, setDateOrder] = useState("");
  const [depositPct, setDepositPct] = useState(30);
  const [fxRate, setFxRate] = useState<string>(""); // USD→PHP so the PO shows in PAN Overall (peso ledger)
  const [details, setDetails] = useState<{ k: string; v: string }[]>([]);
  const [headerRow, setHeaderRow] = useState(0); // 0-based index into grid
  const [mapping, setMapping] = useState<Mapping>({ item_no: "", color: "", description: "", prod_size: "", qty: "", unit_price: "" });
  const [rawImages, setRawImages] = useState<EmbImage[]>([]);
  const [photoCol, setPhotoCol] = useState(-1);
  const [swatchCol, setSwatchCol] = useState(-1);
  const [styleMap, setStyleMap] = useState<Map<string, CellStyle>>(new Map());
  const [progress, setProgress] = useState("");
  const [saveTpl, setSaveTpl] = useState(true);
  const setDK = (i: number, p: Partial<{ k: string; v: string }>) => setDetails((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const delDetail = (i: number) => setDetails((a) => a.filter((_, j) => j !== i));
  const addDetail = () => setDetails((a) => [...a, { k: "", v: "" }]);

  const colCount = grid ? Math.max(...grid.map((r) => r.length), 0) : 0;
  const cols = Array.from({ length: colCount }, (_, i) => colLetter(i));

  async function onFile(file: File) {
    setError(null);
    setSrcFile(file); // keep the original so we can attach it to the PO on import
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // blankrows:true keeps row indices aligned with the sheet (needed for image anchors).
      const g = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, blankrows: true, defval: "" }) as Grid;
      setGrid(g);
      extractImages(buf).then(setRawImages);
      extractStyles(buf).then(setStyleMap);
      // Photo column = the header cell labelled Photo/Picture/Image (ignores Color Samples swatches).
      const hrCells = g[detectHeaderRow(g)] ?? [];
      setPhotoCol(hrCells.findIndex((c) => /photo|picture|image/i.test(String(c))));
      setSwatchCol(hrCells.findIndex((c) => /color\s*sample/i.test(String(c))));

      const sup = String(g[0]?.[0] ?? "").trim();
      setSupplier(sup);

      // Detect header row (start of the item table) first.
      let hr = detectHeaderRow(g);

      // Scan the header area for a PI/invoice number + date.
      for (const row of g.slice(0, 20)) {
        const cells = row.map(String);
        const c = cells.find((x) => /p\/?i\s*no|invoice no|p\.i/i.test(x));
        if (c) { const m = c.match(/[:#]\s*([A-Z0-9\-]+)/i); if (m) setPiNumber(m[1]); }
        const d = cells.find((x) => /date/i.test(x) && /\d{4}-\d{1,2}-\d{1,2}/.test(x));
        if (d) { const m = d.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) setDateOrder(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`); }
      }

      // Capture exactly the PI header fields (all "Label: value" pairs above the item table).
      const addr = String(g[1]?.[0] ?? "").trim();
      const det = scanDetails(g, hr);
      if (addr && !/proforma|invoice/i.test(addr)) det.unshift({ k: "Address", v: addr });
      setDetails(det);
      const pay = det.find((x) => /payment|terms/i.test(x.k))?.v ?? "";
      const dp = pay.match(/(\d{1,3})\s*%/); if (dp) setDepositPct(Number(dp[1]));

      autoMap(g[hr] ?? [], setMapping);

      // Apply saved template — column mapping only. Header row is always auto-detected
      // (row indices shift with blank rows, so a stored header_row can't be trusted).
      if (sup) {
        const tpl = await loadImportTemplate(sup);
        if (tpl) setMapping((m) => ({ ...m, ...(tpl.mapping as Partial<Mapping>) }));
      }
      setHeaderRow(hr);
    } catch (e) {
      setError("Failed to read file. Make sure it is a valid .xlsx/.csv.");
    }
  }

  // Item-table columns in the PI's ORIGINAL order (with source col index for import).
  const impCols = useMemo<(POColumn & { src: number })[]>(() => {
    if (!grid) return [];
    const header = grid[headerRow] ?? [];
    const idx = (l: string) => (l ? letterToIdx(l) : -1);
    const cols: (POColumn & { src: number })[] = [];
    let amountUsed = false;
    const usedKeys = new Map<string, number>();
    header.forEach((cell, i) => {
      const label = String(cell ?? "").replace(/\s+/g, " ").trim();
      if (!label) return;
      let kind: POColumn["kind"] = "extra";
      if (/^s\/?n$/i.test(label)) kind = "sn";
      else if (i === photoCol || /^photo$|^picture$/i.test(label)) kind = "photo";
      else if (i === swatchCol || /color\s*sample/i.test(label)) kind = "swatch";
      else if (i === idx(mapping.item_no)) kind = "item_no";
      else if (i === idx(mapping.color)) kind = "color";
      else if (i === idx(mapping.description)) kind = "description";
      else if (i === idx(mapping.prod_size)) kind = "prod_size";
      else if (i === idx(mapping.qty)) kind = "qty";
      else if (i === idx(mapping.unit_price)) kind = "unit_price";
      else if (/amount/i.test(label) && !amountUsed) { kind = "amount"; amountUsed = true; }
      let key: string | undefined;
      if (kind === "extra") { const n = (usedKeys.get(label) ?? 0) + 1; usedKeys.set(label, n); key = n > 1 ? `${label} (${n})` : label; }
      cols.push({ label, kind, src: i, ...(key ? { key } : {}) });
    });
    return cols;
  }, [grid, headerRow, mapping, photoCol, swatchCol]);

  const preview = useMemo<{ item: POItemInput; row: number }[]>(() => {
    if (!grid || !mapping.item_no && !mapping.description) return [];
    const out: { item: POItemInput; row: number }[] = [];
    const stopRe = /^\s*(total|sub\s*total|after discount|say total|grand total|delivery date|bank info|bank informa|details for|p\.?\s*s\.?\s*[:.]|buyer\s*[:.]?$|suppl|remark|notes?\s*[:.]|terms? of payment|amount in word)/i;
    const extraCols = impCols.filter((c) => c.kind === "extra");
    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r];
      const get = (l: string) => (l ? String(row[letterToIdx(l)] ?? "").trim() : "");
      const itemNo = get(mapping.item_no);
      const desc = get(mapping.description);
      const qty = parseFloat(get(mapping.qty)) || 0;
      const price = parseFloat(get(mapping.unit_price)) || 0;
      const firstCell = String(row[0] ?? "").trim();
      if (stopRe.test(itemNo) || stopRe.test(desc) || stopRe.test(firstCell)) break;
      if (!itemNo && !desc) continue;
      const extra: Record<string, string> = {};
      for (const ec of extraCols) { const v = String(row[ec.src] ?? "").replace(/\s+/g, " ").trim(); if (v && ec.key) extra[ec.key] = v; }
      out.push({ row: r, item: { item_no: itemNo || null, color: get(mapping.color) || null, description: desc || null, prod_size: get(mapping.prod_size) || null, qty, received_qty: 0, unit_price: price, image_url: null, swatch_url: null, extra } });
    }
    return out;
  }, [grid, mapping, headerRow, impCols]);

  // Image anchors rarely land exactly on the item's text row — assign each photo to the
  // nearest item (greedy, in document order) instead of requiring an exact row match.
  const imageByIndex = useMemo(() => {
    const res = new Map<number, EmbImage>();
    if (!rawImages.length || !preview.length) return res;
    // Keep only images in the PHOTO column (drop Color-Sample swatches) when known.
    const pool = (photoCol >= 0 ? rawImages.filter((im) => im.col < 0 || im.col === photoCol) : rawImages)
      .slice().sort((a, b) => a.row - b.row);
    const used = new Set<number>();
    preview.forEach((p, idx) => {
      let best = -1, bestDist = Infinity;
      for (let k = 0; k < pool.length; k++) {
        if (used.has(k)) continue;
        const d = Math.abs(pool[k].row - p.row);
        if (d < bestDist) { bestDist = d; best = k; }
      }
      if (best >= 0 && bestDist <= 4) { used.add(best); res.set(idx, pool[best]); }
    });
    return res;
  }, [preview, rawImages, photoCol]);
  const photoCount = imageByIndex.size;

  // Same nearest-assignment for COLOR SAMPLES swatch images (their own column).
  const swatchByIndex = useMemo(() => {
    const res = new Map<number, EmbImage>();
    if (swatchCol < 0 || !rawImages.length || !preview.length) return res;
    const pool = rawImages.filter((im) => im.col === swatchCol).slice().sort((a, b) => a.row - b.row);
    const used = new Set<number>();
    preview.forEach((p, idx) => {
      let best = -1, bestDist = Infinity;
      for (let k = 0; k < pool.length; k++) { if (used.has(k)) continue; const d = Math.abs(pool[k].row - p.row); if (d < bestDist) { bestDist = d; best = k; } }
      if (best >= 0 && bestDist <= 4) { used.add(best); res.set(idx, pool[best]); }
    });
    return res;
  }, [preview, rawImages, swatchCol]);
  const previewExtraKeys = useMemo(() => {
    const keys: string[] = [];
    for (const p of preview) for (const k of Object.keys(p.item.extra ?? {})) if (!keys.includes(k)) keys.push(k);
    return keys;
  }, [preview]);

  // Footer block = rows after the last item (Delivery Date, Bank Information, BUYER/SUPPLIER…), styled.
  const footerRows = useMemo<POCell[][]>(() => {
    if (!grid || !preview.length) return [];
    const lastRow = Math.max(...preview.map((p) => p.row));
    return styledRows(grid, lastRow + 1, grid.length, styleMap)
      .filter((r) => r.some((c) => c.t.trim()) && !/^\s*total\b/i.test(r[0]?.t ?? ""));
  }, [grid, preview, styleMap]);

  // Pull "Delivery Date" out of the footer/header if present.
  const deliveryDate = useMemo(() => {
    const scan = (rows: { t: string }[][]) => {
      for (const r of rows) for (let i = 0; i < r.length; i++) {
        if (/delivery\s*date/i.test(r[i].t)) {
          const after = r[i].t.split(":").slice(1).join(":").trim();
          if (after) return after;
          for (let j = i + 1; j < r.length; j++) if (r[j].t.trim()) return r[j].t.trim();
        }
      }
      return "";
    };
    const raw = scan(footerRows) || (grid ? scan(grid.slice(0, headerRow).map((row) => row.map((c) => ({ t: String(c ?? "") })))) : "");
    return toISODate(raw);
  }, [footerRows, grid, headerRow]);

  function confirm() {
    setError(null);
    if (preview.length === 0) { setError("No line items detected. Check your column mapping."); return; }
    start(async () => {
      // Upload embedded photos (per row) first, then attach URLs to their items.
      const items: POItemInput[] = [];
      let done = 0;
      const upload = async (img: EmbImage) => {
        const fd = new FormData();
        fd.append("file", b64ToBlob(img.b64, img.ext), `po.${img.ext}`);
        const res = await uploadPoImage(fd);
        return "url" in res ? res.url : null;
      };
      for (let idx = 0; idx < preview.length; idx++) {
        const p = preview[idx];
        const img = imageByIndex.get(idx);
        const sw = swatchByIndex.get(idx);
        let url: string | null = null, swUrl: string | null = null;
        if (img) { setProgress(`Uploading images… ${++done}`); url = await upload(img); }
        if (sw) { setProgress(`Uploading images… ${++done}`); swUrl = await upload(sw); }
        items.push({ ...p.item, image_url: url, swatch_url: swUrl });
      }
      // Attach the original imported spreadsheet so the PI file stays on record.
      let fileUrl: string | null = null, fileName: string | null = null;
      if (srcFile) {
        setProgress("Attaching PI file…");
        const fd = new FormData();
        fd.append("file", srcFile, srcFile.name);
        const fres = await uploadPoFile(fd);
        if ("url" in fres) { fileUrl = fres.url; fileName = fres.name; }
      }
      setProgress("Saving…");
      const detailMap = Object.fromEntries(details.filter((d) => d.k.trim()).map((d) => [d.k.trim(), d.v]));
      if (fileUrl) detailMap["Attached File"] = fileName ? `${fileName} | ${fileUrl}` : fileUrl;
      // FX rate (USD→PHP) → drives the PO's peso amount in PAN Overall. Stored in details.
      if (Number(fxRate) > 0) detailMap["FX Rate"] = String(Number(fxRate));
      const input: PurchaseOrderInput = {
        pi_number: piNumber || null, supplier: supplier || null, supplier_address: null,
        date_order: dateOrder || null, delivery_date: deliveryDate || null, price_terms: null, payment_terms: null,
        port_shipment: null, port_destination: null, container: null,
        currency: "USD", discount: 0, deposit_pct: Number(depositPct) || 30, status: "Draft", notes: null,
        details: detailMap,
        header_rows: grid ? styledRows(grid, 0, headerRow, styleMap) : [],
        footer_rows: footerRows,
        columns: impCols.map(({ src, ...c }) => { void src; return c; }),
        items,
      };
      const res = await savePurchaseOrder(null, input);
      setProgress("");
      if ("error" in res) {
        if (res.error.startsWith("DUPLICATE:")) setDupMsg(res.error.replace(/^DUPLICATE:\s*/, ""));
        else setError(res.error);
        return;
      }
      if (saveTpl && supplier.trim()) await saveImportTemplate({ supplier: supplier.trim(), header_row: headerRow + 1, mapping });
      router.refresh();
      onImported();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      {/* Duplicate PI popup — blocks the import, no overwrite. */}
      {dupMsg && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={(e) => { e.stopPropagation(); setDupMsg(null); }}>
          <div className="w-full max-w-sm rounded-2xl bg-surface p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
            </div>
            <h3 className="text-base font-semibold text-foreground">Duplicate PI</h3>
            <p className="mt-1 text-sm text-muted">{dupMsg}</p>
            <button onClick={() => setDupMsg(null)} className="mt-5 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">OK</button>
          </div>
        </div>
      )}
      <div className="my-6 w-full max-w-4xl rounded-2xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Import Proforma Invoice</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
        </div>

        <div className="space-y-4 p-5">
          {!grid ? (
            <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border py-16 text-muted hover:bg-stone-50">

              <span className="text-sm font-medium">Click to upload PI (.xlsx / .csv)</span>
              <span className="text-xs">MAXHOME, TIANJIN, or any — we'll map the columns</span>
            </button>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                <F label="Supplier"><input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={cn(inp, "w-full")} /></F>
                <F label="PI Number"><input value={piNumber} onChange={(e) => setPiNumber(e.target.value)} className={cn(inp, "w-full")} /></F>
                <F label="Date"><input type="date" value={dateOrder} onChange={(e) => setDateOrder(e.target.value)} className={cn(inp, "w-full")} /></F>
                <F label="Deposit %"><input type="number" min={0} max={100} value={depositPct || ""} onChange={(e) => setDepositPct(Number(e.target.value))} className={cn(inp, "w-full")} /></F>
                <F label="FX Rate (USD→₱)"><input type="number" min={0} step="0.01" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="e.g. 58.50" className={cn(inp, "w-full")} title="USD→PHP rate — makes this PO show in PAN Overall" /></F>
                <F label="Header Row"><input type="number" min={1} value={headerRow + 1} onChange={(e) => setHeaderRow(Math.max(0, Number(e.target.value) - 1))} className={cn(inp, "w-full")} /></F>
              </div>

              {/* Attached source file — the original .xlsx/.csv gets saved with the PO. */}
              {srcFile && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">

                  <span className="font-medium text-emerald-800">{srcFile.name}</span>
                  <span className="text-xs text-emerald-600">({(srcFile.size / 1024).toFixed(0)} KB) — will be attached to this PO</span>
                  <button onClick={() => fileRef.current?.click()} className="ml-auto rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">Replace</button>
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">PI Header Details · auto-captured ({details.length})</p>
                <div className="space-y-2">
                  {details.map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={d.k} onChange={(e) => setDK(i, { k: e.target.value })} placeholder="Label" className={cn(inp, "w-48")} />
                      <span className="text-muted">:</span>
                      <input value={d.v} onChange={(e) => setDK(i, { v: e.target.value })} placeholder="Value" className={cn(inp, "flex-1")} />
                      <button onClick={() => delDetail(i)} className="px-1 text-muted hover:text-danger" title="Remove">✕</button>
                    </div>
                  ))}
                </div>
                <button onClick={addDetail} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-stone-100">+ Add Field</button>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Column Mapping</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {MAP_FIELDS.map((f) => (
                    <F key={f.key} label={f.label}>
                      <select value={mapping[f.key]} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))} className={cn(inp, "w-full")}>
                        <option value="">— none —</option>
                        {cols.map((c) => <option key={c} value={c}>{c} · {String(grid[headerRow]?.[letterToIdx(c)] ?? "").slice(0, 18)}</option>)}
                      </select>
                    </F>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Preview · {preview.length} items · {photoCount} photos</p>
                <div className="max-h-64 overflow-auto rounded-lg border border-border">
                  <table className="w-full border-collapse text-xs [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:whitespace-nowrap [&_th]:px-2 [&_th]:py-1">
                    <thead className="sticky top-0 bg-stone-50 text-muted"><tr><th>Photo</th><th>Item No.</th><th>Color</th><th>Description</th><th className="text-right">Qty</th><th className="text-right">Unit Price</th>{previewExtraKeys.map((k) => <th key={k}>{k}</th>)}</tr></thead>
                    <tbody>
                      {preview.slice(0, 50).map((p, i) => {
                        const img = imageByIndex.get(i);
                        return (
                          <tr key={i}>
                            <td className="text-center">{img ? <img src={`data:image/${img.ext};base64,${img.b64}`} alt="" className="mx-auto h-10 w-10 rounded object-cover" /> : "—"}</td>
                            <td>{p.item.item_no}</td><td>{p.item.color}</td><td className="max-w-[260px] truncate">{p.item.description}</td><td className="text-right tabular-nums">{p.item.qty}</td><td className="text-right tabular-nums">{num(p.item.unit_price)}</td>
                            {previewExtraKeys.map((k) => <td key={k} className="whitespace-nowrap">{p.item.extra?.[k] ?? ""}</td>)}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={saveTpl} onChange={(e) => setSaveTpl(e.target.checked)} />
                Save the mapping as a template for <b className="text-foreground">{supplier || "supplier"}</b> (auto next time)
              </label>
            </>
          )}

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          {progress && <span className="mr-auto text-xs text-muted">{progress}</span>}
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-stone-100">Cancel</button>
          {grid && <button onClick={confirm} disabled={pending} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{pending ? "Importing…" : `Import ${preview.length} items`}</button>}
        </div>
      </div>
    </div>
  );
}

// ── helpers ──
function blankItem(): POItemInput { return { item_no: "", color: "", description: "", prod_size: "", qty: 0, received_qty: 0, unit_price: 0, image_url: null, swatch_url: null, extra: {} }; }
function fromItem(it: POItem): POItemInput { return { item_no: it.item_no, color: it.color, description: it.description, prod_size: it.prod_size, qty: it.qty, received_qty: it.received_qty, unit_price: it.unit_price, image_url: it.image_url, swatch_url: it.swatch_url, extra: it.extra ?? {} }; }

// Base64 → File (avoids passing huge strings as Server Action args).
function b64ToBlob(b64: string, ext: string): File {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : "image/png";
  return new File([arr], `po.${ext}`, { type });
}

// Parse xl/styles.xml + sheet to get each cell's font color, bold, and fill (for 1:1 print replication).
type CellStyle = { c?: string; b?: boolean; bg?: string };
async function extractStyles(buf: ArrayBuffer): Promise<Map<string, CellStyle>> {
  const map = new Map<string, CellStyle>();
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buf);
    const stylesXml = (await zip.file("xl/styles.xml")?.async("string")) ?? "";
    if (!stylesXml) return map;

    const fonts: { color?: string; bold?: boolean }[] = [];
    const fontsBlock = stylesXml.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/)?.[1] ?? "";
    for (const f of fontsBlock.matchAll(/<font>([\s\S]*?)<\/font>/g)) {
      const inner = f[1];
      fonts.push({ bold: /<b\s*\/?>/.test(inner), color: inner.match(/<color[^>]*rgb="([0-9A-Fa-f]{8})"/)?.[1] });
    }
    const fills: (string | undefined)[] = [];
    const fillsBlock = stylesXml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)?.[1] ?? "";
    for (const f of fillsBlock.matchAll(/<fill>([\s\S]*?)<\/fill>/g)) {
      const inner = f[1];
      fills.push(/patternType="solid"/.test(inner) ? inner.match(/<fgColor[^>]*rgb="([0-9A-Fa-f]{8})"/)?.[1] : undefined);
    }
    const xfs: { fontId: number; fillId: number }[] = [];
    const xfsBlock = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
    for (const x of xfsBlock.matchAll(/<xf\b[^>]*?\/?>/g)) {
      xfs.push({ fontId: Number(x[0].match(/fontId="(\d+)"/)?.[1] ?? 0), fillId: Number(x[0].match(/fillId="(\d+)"/)?.[1] ?? 0) });
    }
    const sheetPath = Object.keys(zip.files).find((p) => /xl\/worksheets\/sheet1\.xml$/.test(p)) ?? "xl/worksheets/sheet1.xml";
    const sheetXml = (await zip.file(sheetPath)?.async("string")) ?? "";
    for (const c of sheetXml.matchAll(/<c\s+([^>]*?)\/?>/g)) {
      const attrs = c[1];
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const s = attrs.match(/\bs="(\d+)"/)?.[1];
      if (!ref || s === undefined) continue;
      const xf = xfs[Number(s)]; if (!xf) continue;
      const font = fonts[xf.fontId] ?? {};
      const bg = fills[xf.fillId];
      const st: CellStyle = {};
      if (font.color && !/^FF000000$/i.test(font.color) && !/^00000000$/i.test(font.color)) st.c = "#" + font.color.slice(2);
      if (font.bold) st.b = true;
      if (bg && !/^FFFFFFFF$/i.test(bg) && !/^00000000$/i.test(bg)) st.bg = "#" + bg.slice(2);
      if (st.c || st.b || st.bg) map.set(ref, st);
    }
  } catch { /* no styles */ }
  return map;
}

// Convert a grid row-range into styled POCell rows using the extracted style map.
function styledRows(grid: Grid, start: number, end: number, styles: Map<string, CellStyle>): POCell[][] {
  const out: POCell[][] = [];
  for (let r = start; r < end; r++) {
    const row = grid[r] ?? [];
    let last = row.length; while (last > 0 && !String(row[last - 1] ?? "").trim()) last--;
    const cells: POCell[] = [];
    for (let ci = 0; ci < last; ci++) {
      const st = styles.get(`${colLetter(ci)}${r + 1}`) ?? {};
      cells.push({ t: String(row[ci] ?? ""), ...st });
    }
    if (cells.length) out.push(cells);
  }
  return out;
}

type EmbImage = { row: number; col: number; b64: string; ext: string };
// Extract embedded images from an .xlsx with their anchored (0-based) row + column.
async function extractImages(buf: ArrayBuffer): Promise<EmbImage[]> {
  const out: EmbImage[] = [];
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buf);
    const drawingPath = Object.keys(zip.files).find((p) => /xl\/drawings\/drawing\d+\.xml$/.test(p));
    if (!drawingPath) return out;
    const drawingXml = await zip.file(drawingPath)!.async("string");
    const relsPath = drawingPath.replace(/drawings\/(drawing\d+)\.xml/, "drawings/_rels/$1.xml.rels");
    const relsXml = zip.file(relsPath) ? await zip.file(relsPath)!.async("string") : "";
    const rels = new Map<string, string>();
    for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      rels.set(m[1], m[2].replace(/^\.\.\//, "xl/").replace(/^\//, ""));
    }
    for (const anc of drawingXml.matchAll(/<xdr:(?:two|one)CellAnchor[\s\S]*?<\/xdr:(?:two|one)CellAnchor>/g)) {
      const block = anc[0];
      const fromM = block.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/);
      const colM = fromM?.[1].match(/<xdr:col>(\d+)<\/xdr:col>/);
      const rowM = fromM?.[1].match(/<xdr:row>(\d+)<\/xdr:row>/);
      const embM = block.match(/r:embed="([^"]+)"/);
      if (!rowM || !embM) continue;
      const target = rels.get(embM[1]);
      if (!target) continue;
      const file = zip.file(target);
      if (!file) continue;
      const ext = (target.split(".").pop() || "png").toLowerCase();
      out.push({ row: Number(rowM[1]), col: colM ? Number(colM[1]) : -1, b64: await file.async("base64"), ext });
    }
  } catch { /* no images / unreadable drawing */ }
  return out;
}

// Capture every "Label: value" pair in the header area (rows above the item table).
// Excludes core fields (PI No, Date) and the buyer block — keeps exactly each PO's own header.
function scanDetails(g: Grid, headerIdx: number): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = [];
  const seen = new Set<string>();
  const limit = Math.min(headerIdx > 0 ? headerIdx : 20, g.length, 22);
  for (let r = 0; r < limit; r++) {
    for (const cell of g[r] ?? []) {
      const s = String(cell ?? "").replace(/\s+/g, " ").trim();
      const m = s.match(/^([A-Za-z][A-Za-z .\/'#&()-]{1,32}?)\s*:\s*(.+)$/);
      if (!m) continue;
      const k = m[1].trim();
      const v = m[2].trim();
      if (!v) continue;
      if (/^(date|p\/?i\s*no|invoice no|p\.i|to|buyer)$/i.test(k)) continue;
      const key = k.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ k, v });
    }
  }
  return out;
}

function detectHeaderRow(g: Grid): number {
  for (let r = 0; r < Math.min(g.length, 25); r++) {
    const joined = (g[r] ?? []).map((c) => String(c).toLowerCase()).join("|");
    if (/(q'?ty|quantity)/.test(joined) && /(item|description|model)/.test(joined)) return r;
  }
  return 0;
}
function autoMap(headerCells: (string | number)[], set: (m: Mapping) => void) {
  const m: Mapping = { item_no: "", color: "", description: "", prod_size: "", qty: "", unit_price: "" };
  headerCells.forEach((cell, i) => {
    const t = String(cell).toLowerCase().trim();
    for (const f of MAP_FIELDS) {
      if (!m[f.key] && f.hints.some((hint) => t.includes(hint))) m[f.key] = colLetter(i);
    }
  });
  set(m);
}

// Rebuild the PI header exactly as uploaded: green company + centered sub-lines,
// gray "PROFORMA INVOICE" band, then the buyer/meta block in its original 2-column layout.
function cellSpan(c: POCell, esc: (s: string) => string): string {
  const style = `${c.c ? `color:${c.c};` : ""}${c.b ? "font-weight:700;" : ""}${c.bg ? `background:${c.bg};padding:0 2px;` : ""}`;
  return style ? `<span style="${style}">${esc(c.t)}</span>` : esc(c.t);
}
function headerHtml(headerRows: POCell[][], esc: (s: string) => string): string {
  if (!headerRows?.length) return "";
  const lineOf = (r: POCell[]) => r.filter((c) => c.t.trim()).map((c) => cellSpan(c, esc)).join(" ");
  const piIdx = headerRows.findIndex((r) => r.some((c) => /proforma invoice/i.test(c.t)));
  const top = piIdx >= 0 ? headerRows.slice(0, piIdx) : headerRows.slice(0, 3);
  const meta = piIdx >= 0 ? headerRows.slice(piIdx + 1) : [];
  const company = lineOf(headerRows[0] ?? []);
  const subLines = top.slice(1).map(lineOf).filter((s) => s.replace(/<[^>]*>/g, "").trim());

  // Split each meta row into a leading (left) block and the next cluster (right).
  const rowsHtml = meta.map((r) => {
    let i = 0; const left: POCell[] = [];
    while (i < r.length && r[i].t.trim()) { left.push(r[i]); i++; }
    while (i < r.length && !r[i].t.trim()) i++;
    const right = r.slice(i).filter((c) => c.t.trim());
    if (!left.length && !right.length) return "";
    return `<tr><td style="padding:0 24px 2px 0;vertical-align:top">${left.map((c) => cellSpan(c, esc)).join(" ")}</td><td style="padding:0 0 2px 0;vertical-align:top">${right.map((c) => cellSpan(c, esc)).join(" ")}</td></tr>`;
  }).join("");

  return `
    <div style="margin:0;text-align:center;font-size:17px;font-weight:700">${company}</div>
    ${subLines.map((s) => `<p style="margin:1px 0;text-align:center">${s}</p>`).join("")}
    <div style="background:#d9d9d9;text-align:center;font-weight:700;letter-spacing:2px;padding:4px;margin:8px 0;border-top:2px solid #000;border-bottom:2px solid #000">PROFORMA INVOICE</div>
    <table style="width:100%;font-size:12px;margin-bottom:10px"><tbody>${rowsHtml}</tbody></table>`;
}

function printPI(h: { pi_number: string; supplier: string; supplier_address: string; date_order: string; currency: string }, details: Record<string, string>, items: POItemInput[], total: number, deposit: number, balance: number, headerRows: POCell[][], footerRows: POCell[][], columns: POColumn[]) {
  const esc = (s: string) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const cur = h.currency || "USD";
  const footerHtml = (footerRows ?? []).map((r) => {
    const line = r.filter((c) => c.t.trim()).map((c) => cellSpan(c, esc)).join("   ");
    return line ? `<div style="padding:1px 0">${line}</div>` : "";
  }).filter(Boolean).join("");
  const m = (n: number) => money(n, cur);
  const detailRows = Object.entries(details).filter(([k]) => !/^address$/i.test(k))
    .map(([k, v]) => `<tr><td style="padding:1px 8px 1px 0;color:#555;white-space:nowrap">${esc(k)}:</td><td style="padding:1px 0;font-weight:600">${esc(v)}</td></tr>`).join("");

  const cols = (columns ?? []).filter((c) => c.kind !== "skip" && c.kind !== "received");
  const td = "border:1px solid #000;padding:3px 6px";
  const right = "text-align:right";
  const headTh = cols.map((c) => `<td style="${td};${/qty|unit_price|amount/.test(c.kind) ? right : ""}">${esc(c.label)}</td>`).join("");
  const rows = items.map((it, i) => "<tr>" + cols.map((c) => {
    switch (c.kind) {
      case "sn": return `<td style="${td};text-align:center">${i + 1}</td>`;
      case "photo": return `<td style="${td};text-align:center">${it.image_url ? `<img src="${esc(it.image_url)}" style="width:54px;height:54px;object-fit:cover"/>` : ""}</td>`;
      case "swatch": return `<td style="${td};text-align:center">${it.swatch_url ? `<img src="${esc(it.swatch_url)}" style="width:50px;height:50px;object-fit:cover"/>` : ""}</td>`;
      case "item_no": return `<td style="${td}">${esc(it.item_no ?? "")}</td>`;
      case "color": return `<td style="${td}">${esc(it.color ?? "")}</td>`;
      case "description": return `<td style="${td}">${esc(it.description ?? "")}</td>`;
      case "prod_size": return `<td style="${td}">${esc(it.prod_size ?? "")}</td>`;
      case "qty": return `<td style="${td};${right}">${it.qty || ""}</td>`;
      case "unit_price": return `<td style="${td};text-align:center">${it.unit_price ? (c.cur ?? "$") + num(it.unit_price) : ""}</td>`;
      case "amount": return `<td style="${td};text-align:center">${(c.cur ?? "$") + num((Number(it.qty) || 0) * (Number(it.unit_price) || 0))}</td>`;
      default: return `<td style="${td};text-align:center">${esc(curExtra(c, it.extra?.[c.key ?? c.label] ?? ""))}</td>`;
    }
  }).join("") + "</tr>").join("");
  const w = window.open("", "_blank", "width=1100,height=900");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>PI ${esc(h.pi_number)}</title></head>
  <body style="font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111">
    ${headerRows?.length ? headerHtml(headerRows, esc) : `
    <h2 style="margin:0;text-align:center;color:#1f7a1f">${esc(h.supplier) || "SUPPLIER"}</h2>
    <p style="margin:2px 0;color:#555;text-align:center">${esc(h.supplier_address || details["Address"] || "")}</p>
    <div style="background:#d9d9d9;text-align:center;font-weight:700;letter-spacing:2px;padding:4px;margin:8px 0;border-top:2px solid #000;border-bottom:2px solid #000">PROFORMA INVOICE</div>
    <table style="font-size:12px;margin-bottom:10px">
      <tr><td style="padding:1px 8px 1px 0;color:#555">P/I No.:</td><td style="font-weight:700">${esc(h.pi_number)}</td></tr>
      <tr><td style="padding:1px 8px 1px 0;color:#555">Date:</td><td style="font-weight:600">${esc(h.date_order)}</td></tr>
      ${detailRows}</table>`}
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="font-weight:700;background:#f0f0f0">${headTh}</tr></thead>
      <tbody>${rows}</tbody></table>
    <table style="width:300px;margin-left:auto;margin-top:10px;font-size:12px">
      <tr><td>TOTAL (${cur})</td><td style="text-align:right;font-weight:700">${m(total)}</td></tr>
      <tr><td>Deposit</td><td style="text-align:right">${m(deposit)}</td></tr>
      <tr><td>Balance</td><td style="text-align:right">${m(balance)}</td></tr></table>
    ${footerHtml ? `<div style="margin-top:14px;font-size:12px">${footerHtml}</div>` : ""}
    <script>window.onload=function(){window.print()}</script>
  </body></html>`);
  w.document.close();
}

function ZoomImg({ src }: { src: string | null }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (!src) return <span className="text-muted">—</span>;
  const size = 260;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src} alt=""
        className="h-11 w-11 cursor-zoom-in rounded object-cover ring-1 ring-border"
        onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setPos(null)}
      />
      {pos && typeof document !== "undefined" && createPortal(
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src} alt=""
          style={{
            position: "fixed", width: size, height: size, zIndex: 9999,
            left: Math.min(pos.x + 18, window.innerWidth - size - 8),
            top: Math.min(Math.max(pos.y - size / 2, 8), window.innerHeight - size - 8),
          }}
          className="pointer-events-none rounded-lg border border-border bg-white object-contain shadow-2xl"
        />,
        document.body,
      )}
    </>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", accent)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18M7 14l4-4 4 4 5-6" /></svg></span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
