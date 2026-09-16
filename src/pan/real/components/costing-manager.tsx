"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { cn } from "./ui";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { saveCosting, deleteCosting, type CostingInput, type CostingItemInput } from "@/app/costing/actions";
import type { CostingData, Costing } from "@/app/costing/data";

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const peso = (n: number) => "₱" + (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const KINDS = ["material", "labor", "expense", "subcon"] as const;
const CATEGORIES = ["SUBCON", "PAN", "SUBCON W/OUT INSTALL"];
const lineTotal = (qty: string | null, unit: number) => { const n = parseFloat((qty ?? "").trim()); return (isNaN(n) ? 1 : n) * (Number(unit) || 0); };
const UNITS = ["pcs.", "pc.", "yards", "yard", "set", "lng", "bed", "ft"];
function splitQty(q: string): { n: string; u: string } {
  const s = (q ?? "").trim();
  for (const u of UNITS) if (s.toLowerCase().endsWith(u.toLowerCase())) return { n: s.slice(0, s.length - u.length).trim(), u };
  return { n: s, u: "" };
}
const joinQty = (n: string, u: string) => [String(n).trim(), u].filter(Boolean).join(" ");

// Print one costing as the Excel-style sheet.
function printCosting(c: Costing) {
  const margin = c.selling_price - c.total_cost;
  const rowsHtml = c.items.map((it) => { const q = splitQty(it.qty ?? ""); return `<tr>
    <td style="border:1px solid #000;padding:3px 6px;text-align:center">${esc(q.n)}</td>
    <td style="border:1px solid #000;padding:3px 6px;text-align:center">${esc(q.u)}</td>
    <td style="border:1px solid #000;padding:3px 6px">${esc(it.material ?? "")}</td>
    <td style="border:1px solid #000;padding:3px 6px;text-align:right">${it.unit_price ? num(it.unit_price) : ""}</td>
    <td style="border:1px solid #000;padding:3px 6px;text-align:right">${num(it.total_price)}</td></tr>`; }).join("");
  const w = window.open("", "_blank", "width=700,height=800");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.title)}</title></head>
    <body style="font-family:Arial,sans-serif;font-size:12px;margin:20px">
    <div style="max-width:560px;margin:0 auto;border:1px solid #000">
      ${c.size ? `<div style="background:#d9ead3;text-align:center;font-weight:700;padding:4px;border-bottom:1px solid #000">${esc(c.size)}</div>` : ""}
      <div style="background:#e06666;color:#fff;text-align:center;font-weight:700;padding:5px;border-bottom:1px solid #000">${esc(c.title)}</div>
      ${c.project ? `<div style="background:#f4cccc;text-align:center;font-weight:700;padding:4px;border-bottom:1px solid #000">${esc(c.project)}</div>` : ""}
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="font-weight:700">
          <td style="border:1px solid #000;padding:3px 6px">Quantity</td>
          <td style="border:1px solid #000;padding:3px 6px">Unit</td>
          <td style="border:1px solid #000;padding:3px 6px">Material</td>
          <td style="border:1px solid #000;padding:3px 6px;text-align:right">Unit price</td>
          <td style="border:1px solid #000;padding:3px 6px;text-align:right">Total price</td>
        </tr></thead>
        <tbody>${rowsHtml}
          <tr style="font-weight:700"><td colspan="4" style="border:1px solid #000;padding:4px 6px;text-align:right">TOTAL</td><td style="border:1px solid #000;padding:4px 6px;text-align:right">${num(c.total_cost)}</td></tr>
        </tbody>
      </table>
    </div>
    <div style="max-width:560px;margin:8px auto 0;text-align:right">Selling: <b>${c.selling_price ? num(c.selling_price) : "—"}</b> &nbsp; Margin: <b>${c.selling_price ? num(margin) : "—"}</b></div>
    <script>window.onload=function(){window.print()};window.onafterprint=function(){window.close()}<\/script>
    </body></html>`);
  w.document.close();
}

// Inline Excel-style costing sheet (read-only) shown on the page.
function CostingSheet({ c, onEdit }: { c: Costing; onEdit: () => void }) {
  const margin = c.selling_price - c.total_cost;
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-stone-600 bg-white shadow-sm transition-shadow hover:shadow-md">
      {c.size && <div className="bg-[#d9ead3] px-2 py-1 text-center text-[11px] font-bold">{c.size}</div>}
      <div className="border-t border-stone-600 bg-[#e06666] px-2 py-1.5 text-center text-xs font-bold leading-tight text-white">{c.title}</div>
      {c.project && <div className="border-t border-stone-600 bg-[#f4cccc] px-2 py-1 text-center text-[11px] font-bold">{c.project}</div>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs [&_td]:border [&_td]:border-stone-400 [&_th]:border [&_th]:border-stone-400">
          <thead>
            <tr className="bg-stone-100 font-bold">
              <th className="px-2 py-1 text-center">Quantity</th>
              <th className="px-2 py-1 text-center">Unit</th>
              <th className="px-2 py-1 text-left">Material</th>
              <th className="px-2 py-1 text-right">Unit price</th>
              <th className="px-2 py-1 text-right">Total price</th>
            </tr>
          </thead>
          <tbody>
            {c.items.map((it) => {
              const q = splitQty(it.qty ?? "");
              return (
                <tr key={it.id}>
                  <td className="px-2 py-1 text-center">{q.n}</td>
                  <td className="px-2 py-1 text-center text-muted">{q.u}</td>
                  <td className="px-2 py-1">{it.material || ""}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{it.unit_price ? num(it.unit_price) : ""}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{num(it.total_price)}</td>
                </tr>
              );
            })}
            <tr className="bg-stone-50 font-bold">
              <td colSpan={4} className="px-2 py-1.5 text-right">TOTAL</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{num(c.total_cost)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-[11px]">
        <span className="text-muted">{c.category || "—"} · {c.items.length} items</span>
        <span>Sell: <b>{c.selling_price ? num(c.selling_price) : "—"}</b> · Margin: <b className={margin >= 0 ? "text-success" : "text-danger"}>{c.selling_price ? num(margin) : "—"}</b></span>
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-stone-50 px-3 py-1.5">
        <button onClick={() => printCosting(c)} className="rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-stone-200">Print</button>
        <button onClick={onEdit} className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-stone-100">Edit</button>
      </div>
    </div>
  );
}

export function CostingManager({ data }: { data: CostingData }) {
  const [tab, setTab] = useState<string>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Costing | "new" | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (tab !== "all" && (r.category ?? "") !== tab) return false;
      return !s || [r.title, r.size, r.project, r.category].some((x) => (x ?? "").toLowerCase().includes(s));
    });
  }, [data.rows, tab, q]);

  const pg = usePagination(rows);

  return (
    <div className="space-y-5">
      {/* KPI */}
      <div className="apk-hide grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Total Costings" value={String(data.kpi.total)} accent="bg-primary/10 text-primary" />
        <Kpi label="Avg Cost" value={peso(data.kpi.avg)} accent="bg-blue-100 text-blue-600" />
        <Kpi label="Total Sell" value={peso(data.kpi.totalSell)} accent="bg-green-100 text-green-600" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-stone-100 p-1">
          {["all", ...CATEGORIES].map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", tab === t ? "bg-surface text-primary shadow-sm" : "text-muted hover:text-foreground")}>{t === "all" ? "All" : t}</button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search costing…" className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
        <button onClick={() => setOpen("new")} className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90">+ Add Costing</button>
      </div>

      {/* Inline Excel-style costing sheets */}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-stone-50 py-16 text-center text-sm text-muted">No costings yet. Click <b>+ Add Costing</b>.</p>
      ) : (
        <div className="overflow-visible rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto rounded-t-xl p-4">
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
          {pg.slice.map((c) => <CostingSheet key={c.id} c={c} onEdit={() => setOpen(c)} />)}
        </div>
        </div>
        <PaginationFooter {...pg} />
        </div>
      )}

      {/* Add from the bottom too */}
      {rows.length > 0 && (
        <div className="flex justify-center">
          <button onClick={() => setOpen("new")} className="rounded-lg border border-dashed border-border px-4 py-2 text-sm font-medium text-muted hover:bg-stone-100">+ Add Costing</button>
        </div>
      )}

      {open && <CostingModal c={open === "new" ? null : open} onClose={() => setOpen(null)} />}
    </div>
  );
}

type Row = CostingItemInput;
function CostingModal({ c, onClose }: { c: Costing | null; onClose: () => void }) {
  const isNew = !c;
  const [pending, start] = useTransition();
  const [delPending, startDel] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [h, setH] = useState({
    title: c?.title ?? "",
    project: c?.project ?? "",
    size: c?.size ?? "",
    category: c?.category ?? "",
    selling_price: c?.selling_price ?? 0,
    notes: c?.notes ?? "",
  });
  const setHF = (k: keyof typeof h, v: string | number) => setH((p) => ({ ...p, [k]: v }));
  const [items, setItems] = useState<Row[]>(
    c?.items.length ? c.items.map((i) => ({ kind: i.kind, qty: i.qty ?? "", material: i.material ?? "", unit_price: i.unit_price })) : [{ kind: "material", qty: "", material: "", unit_price: 0 }],
  );
  const upd = (i: number, p: Partial<Row>) => setItems((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const addRow = (kind: Row["kind"] = "material") => setItems((a) => [...a, { kind, qty: "", material: "", unit_price: 0 }]);
  const addBlank = () => setItems((a) => [...a, { kind: "material", qty: null, material: "", unit_price: 0 }]);
  const delRow = (i: number) => setItems((a) => a.filter((_, j) => j !== i));

  const grand = items.reduce((s, it) => s + lineTotal(it.qty, it.unit_price), 0);
  const margin = Number(h.selling_price) - grand;
  const [editing, setEditing] = useState(true);

  // Print the Excel-style preview.
  function printSheet() {
    const rowsHtml = items.map((it) => `<tr>
      <td style="border:1px solid #000;padding:3px 6px">${esc(it.qty ?? "")}</td>
      <td style="border:1px solid #000;padding:3px 6px">${esc(it.material ?? "")}</td>
      <td style="border:1px solid #000;padding:3px 6px;text-align:right">${it.unit_price ? num(it.unit_price) : ""}</td>
      <td style="border:1px solid #000;padding:3px 6px;text-align:right">${num(lineTotal(it.qty ?? "", it.unit_price))}</td></tr>`).join("");
    const w = window.open("", "_blank", "width=700,height=800");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(h.title)}</title></head>
      <body style="font-family:Arial,sans-serif;font-size:12px;margin:20px">
      <div style="max-width:560px;margin:0 auto;border:1px solid #000">
        ${h.size ? `<div style="background:#d9ead3;text-align:center;font-weight:700;padding:4px;border-bottom:1px solid #000">${esc(h.size)}</div>` : ""}
        <div style="background:#e06666;color:#fff;text-align:center;font-weight:700;padding:5px;border-bottom:1px solid #000">${esc(h.title)}</div>
        <div style="background:#f4cccc;text-align:center;font-weight:700;padding:4px;border-bottom:1px solid #000">${esc(h.project || "")}</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="font-weight:700">
            <td style="border:1px solid #000;padding:3px 6px">Quantity</td>
            <td style="border:1px solid #000;padding:3px 6px">Material</td>
            <td style="border:1px solid #000;padding:3px 6px;text-align:right">Unit price</td>
            <td style="border:1px solid #000;padding:3px 6px;text-align:right">Total price</td>
          </tr></thead>
          <tbody>${rowsHtml}
            <tr style="font-weight:700"><td colspan="3" style="border:1px solid #000;padding:4px 6px;text-align:right">TOTAL</td><td style="border:1px solid #000;padding:4px 6px;text-align:right">${num(grand)}</td></tr>
          </tbody>
        </table>
      </div>
      <div style="max-width:560px;margin:8px auto 0;text-align:right;font-size:12px">
        Selling: <b>${h.selling_price ? num(Number(h.selling_price)) : "—"}</b> &nbsp; Margin: <b>${h.selling_price ? num(margin) : "—"}</b>
      </div>
      <script>window.onload=function(){window.print()};window.onafterprint=function(){window.close()}<\/script>
      </body></html>`);
    w.document.close();
  }

  function save() {
    setError(null);
    if (!h.title.trim()) { setError("Title is required."); return; }
    const input: CostingInput = { ...h, selling_price: Number(h.selling_price) || 0, items: items.filter((it) => it.material?.trim() || it.unit_price) };
    start(async () => {
      const res = await saveCosting(c?.id ?? null, input);
      if ("error" in res) { setError(res.error); return; }
      onClose(); router.refresh();
    });
  }
  function remove() {
    if (!c) return;
    startDel(async () => { const res = await deleteCosting(c.id); if ("error" in res) { setError(res.error); return; } onClose(); router.refresh(); });
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "Add Costing" : h.title || "Costing"} size="2xl"
      footer={
        editing ? (
          <div className="flex items-center justify-between gap-2">
            {!isNew ? <button onClick={remove} disabled={delPending} className="rounded-lg border border-danger/40 px-3 py-2 text-sm font-medium text-danger hover:bg-red-50 disabled:opacity-60">{delPending ? "Deleting…" : "Delete"}</button> : <span />}
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">Total Cost: <span className="font-bold">{peso(grand)}</span></span>
              <button onClick={onClose} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Cancel</button>
              <button onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">{pending ? "Saving…" : isNew ? "Add Costing" : "Save"}</button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between gap-2">
            <button onClick={() => setEditing(true)} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Edit</button>
            <div className="flex gap-2">
              <button onClick={printSheet} className="rounded-lg border border-primary bg-surface px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">Print</button>
              <button onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Close</button>
            </div>
          </div>
        )
      }>
      {!editing ? (
        /* ── Excel-style preview ── */
        <div className="space-y-3">
          <div className="mx-auto max-w-2xl overflow-hidden border border-stone-800 text-sm">
            <div className="bg-[#e06666] py-2 text-center font-bold text-white">{h.title}</div>
            {h.project && <div className="border-t border-stone-800 bg-[#f4cccc] py-1.5 text-center font-bold">{h.project}</div>}
            <table className="w-full border-collapse [&_td]:border [&_td]:border-stone-700 [&_th]:border [&_th]:border-stone-700">
              <thead>
                <tr className="bg-stone-100 font-bold">
                  <th className="px-2 py-1 text-left">Quantity</th>
                  <th className="px-2 py-1 text-left">Material</th>
                  <th className="px-2 py-1 text-right">Unit price</th>
                  <th className="px-2 py-1 text-right">Total price</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">{it.qty || ""}</td>
                    <td className="px-2 py-1">{it.material || ""}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{it.unit_price ? num(it.unit_price) : ""}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{num(lineTotal(it.qty ?? "", it.unit_price))}</td>
                  </tr>
                ))}
                <tr className="bg-stone-50 font-bold">
                  <td colSpan={3} className="px-2 py-1.5 text-right">TOTAL</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{num(grand)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted">{h.size || "—"}</span>
            <span>Selling: <b>{h.selling_price ? peso(Number(h.selling_price)) : "—"}</b> · Margin: <b className={margin >= 0 ? "text-success" : "text-danger"}>{h.selling_price ? peso(margin) : "—"}</b></span>
          </div>
        </div>
      ) : (
      <div className="space-y-4">
        {/* Header fields */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <F label="Title *" full><input value={h.title} onChange={(e) => setHF("title", e.target.value)} placeholder="PROMO BED USING URATEX PU2 FOAM" className={inp} /></F>
          <F label="Project"><input value={h.project} onChange={(e) => setHF("project", e.target.value)} placeholder="PROJECT 15,000 BED PROMO" className={inp} /></F>
          <F label="Header"><input value={h.size} onChange={(e) => setHF("size", e.target.value)} placeholder="GMA WORKSHOP - PAN PRICE QUEEN SIZE" className={inp} /></F>
          <F label="Category"><select value={h.category} onChange={(e) => setHF("category", e.target.value)} className={inp}><option value="">— None —</option>{CATEGORIES.map((x) => <option key={x}>{x}</option>)}</select></F>
          <F label="Selling Price (₱)"><input type="number" min={0} value={h.selling_price || ""} onChange={(e) => setHF("selling_price", Number(e.target.value))} placeholder="10000" className={inp} /></F>
        </div>

        {/* Items table */}
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-stone-50 text-left text-xs uppercase text-muted">
                <th className="px-3 py-2 font-bold">Kind</th>
                <th className="px-3 py-2 font-bold">Quantity</th>
                <th className="px-3 py-2 font-bold">Material</th>
                <th className="px-3 py-2 text-right font-bold">Unit Price</th>
                <th className="px-3 py-2 text-right font-bold">Total</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const q = splitQty(it.qty ?? "");
                return (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1.5">{it.qty === null ? <span className="text-xs text-muted">—</span> : <select value={it.kind} onChange={(e) => upd(i, { kind: e.target.value as Row["kind"] })} className={cn(inp, "w-28")}>{KINDS.map((k) => <option key={k} value={k} className="capitalize">{k}</option>)}</select>}</td>
                  <td className="px-2 py-1.5">
                    {it.qty === null ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      <div className="flex gap-1">
                        <input value={q.n} onChange={(e) => upd(i, { qty: joinQty(e.target.value, q.u) })} placeholder="—" className={cn(inp, "w-14")} />
                        <select value={q.u} onChange={(e) => upd(i, { qty: joinQty(q.n, e.target.value) })} className={cn(inp, "w-20")}>
                          <option value="">unit</option>
                          {UNITS.map((x) => <option key={x}>{x}</option>)}
                        </select>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5"><input value={it.material ?? ""} onChange={(e) => upd(i, { material: e.target.value })} placeholder="1 Pu2 foam / Labor carpentry" className={cn(inp, "w-full")} /></td>
                  <td className="px-2 py-1.5 text-right"><input type="number" min={0} value={it.unit_price || ""} onChange={(e) => upd(i, { unit_price: Number(e.target.value) })} className={cn(inp, "w-24 text-right")} /></td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">{peso(lineTotal(it.qty ?? "", it.unit_price))}</td>
                  <td className="px-2 py-1.5"><button onClick={() => delRow(i)} className="px-1 text-muted hover:text-danger" title="Remove">✕</button></td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-stone-50 font-semibold">
                <td colSpan={4} className="px-3 py-2 text-right">GRAND TOTAL</td>
                <td className="px-3 py-2 text-right tabular-nums">{peso(grand)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => addRow("material")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-stone-100">+ Material</button>
          <button onClick={addBlank} className="rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-stone-100">+ Blank Row</button>
          <span className="ml-auto text-sm">Selling: <b>{h.selling_price ? peso(Number(h.selling_price)) : "—"}</b> · Margin: <b className={margin >= 0 ? "text-success" : "text-danger"}>{h.selling_price ? peso(margin) : "—"}</b></span>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
      </div>
      )}
    </Modal>
  );
}

function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className={cn("flex flex-col gap-1", full && "col-span-2 sm:col-span-3")}><label className="text-xs font-medium text-muted">{label}</label>{children}</div>;
}
function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", accent)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18M7 14l4-4 4 4 5-6" /></svg></span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
