"use client";

import { useState, useTransition, useRef } from "react";
import { printHtml } from "@/lib/print-frame";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { saveReceipt } from "@/app/orders/actions";
import { printRaw, linesToEscpos } from "@/lib/qz-print";
import { ASSIGNEES } from "@/lib/assignees";
import { PAYMENT_METHODS } from "@/lib/payment-methods";
import type { OrderRow, ProductRow } from "@/lib/supabase/server";
import {
  receiptModel, initFromOrder, receiptTotals as totals, peso2,
  type ReceiptData, type ReceiptItem as Item, type ReceiptLabeledAmount as LabeledAmount,
} from "@/lib/receipt-model";

// Fixed discount labels — picked from a dropdown in the receipt editor.
const DISCOUNT_LABELS = ["Discount Kurtina ni PAN", "Discount Warehouse", "Discount Show Room"];

// ---------------------------------------------------------------- UI
const inp =
  "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";

// `hideTrigger` + `openSignal` let another component (e.g. Edit Order after a
// Mark-Paid) open this receipt preview modal programmatically: bump openSignal to
// a new number to open. Without them, it renders its own trigger button as before.
export function ReceiptButton({ order, products = [], hideTrigger = false, openSignal }: { order: OrderRow; products?: ProductRow[]; hideTrigger?: boolean; openSignal?: number }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<ReceiptData>(() => initFromOrder(order, products));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [lastSignal, setLastSignal] = useState<number | undefined>(openSignal);
  const previewRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Open when the parent bumps openSignal to a new value.
  if (openSignal !== undefined && openSignal !== lastSignal) {
    setLastSignal(openSignal);
    setD(initFromOrder(order, products));
    setSaved(null);
    setOpen(true);
  }

  function reopen() {
    setD(initFromOrder(order, products));
    setSaved(null);
    setOpen(true);
  }

  function save() {
    setSaved(null);
    startTransition(async () => {
      const res = await saveReceipt(order.id, {
        mop: d.mop || null,
        downpayment: Number(d.downpayment) || 0,
        total: totals(d).total,
        items: d.items,
        discounts: d.discounts,
        paymentTerms: d.paymentTerms,
      });
      setSaved("error" in res ? `Error: ${res.error}` : "Saved ✓");
      if (!("error" in res)) router.refresh();
    });
  }

  const set = <K extends keyof ReceiptData>(k: K, v: ReceiptData[K]) =>
    setD((p) => ({ ...p, [k]: v }));
  const updItem = (i: number, patch: Partial<Item>) =>
    setD((p) => ({ ...p, items: p.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const updLA = (key: "discounts" | "paymentTerms", i: number, patch: Partial<LabeledAmount>) =>
    setD((p) => ({ ...p, [key]: p[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  const t = totals(d);

  // Render the receipt to a 72mm HTML page and open the print dialog. The browser
  // "Save as PDF" destination produces the downloadable PDF; same view also acts
  // as the no-QZ print fallback. The page <title> becomes the PDF's filename.
  function openReceiptDoc(title: string) {
    const body = receiptModel(d)
      .map((ln) => {
        const style = [
          "white-space:pre",
          ln.center ? "text-align:center" : "text-align:left",
          ln.bold ? "font-weight:700" : "",
          ln.big ? "font-size:1.4em" : "",
        ].filter(Boolean).join(";");
        const safe = (ln.t || " ").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
        return `<div style="${style}">${safe}</div>`;
      })
      .join("");
    // Hidden iframe, hindi popup (2026-09-07): ang about:blank popup ay
    // ipinapasa ng desktop app sa Windows ("Get an app to open this 'about' link").
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>]/g, "")}</title><style>@page{size:72mm auto;margin:0}body{margin:0;font-family:'Courier New',monospace;font-size:9px;width:72mm;padding:2mm}</style></head><body>${body}</body></html>`);
  }
  const printBrowser = () => openReceiptDoc(`Receipt ${order.order_number ?? ""}`.trim());

  // One-click PDF download — snapshot the preview (keeps ₱) into a 72mm-wide PDF.
  async function downloadPdf() {
    const node = previewRef.current;
    if (!node) return;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
    const wmm = 72;
    const hmm = (wmm * canvas.height) / canvas.width;
    const pdf = new jsPDF({ unit: "mm", format: [wmm, hmm] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, wmm, hmm);
    pdf.save(`Receipt ${order.order_number ?? ""}`.trim() + ".pdf");
  }

  // Primary: raw ESC/POS via QZ Tray → exact auto-fit length + auto-cut.
  async function print() {
    setPrinting(true);
    setSaved(null);
    try {
      await printRaw("Xprinter Q200", linesToEscpos(receiptModel(d)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // QZ not running / not allowed → offer the browser fallback. Kapag ang
      // SUSI ang kulang, hindi QZ Tray ang problema — huwag doon ituro.
      const hint = /QZ_PRIVATE_KEY/.test(msg)
        ? "The server has no signing key — ask IT to set QZ_PRIVATE_KEY."
        : "Make sure QZ Tray is running.";
      if (confirm(`Thermal print failed: ${msg}\n\n${hint}\n\nUse the browser print instead?`)) {
        printBrowser();
      }
    } finally {
      setPrinting(false);
    }
  }

  return (
    <>
      {!hideTrigger && (
        <button
          onClick={reopen}
          aria-label="Receipt"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-stone-100 hover:text-primary"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
            <path d="M8 7h8M8 11h8M8 15h5" />
          </svg>
        </button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Acknowledgement Receipt — Editable"
        description={order.order_number ?? undefined}
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">
              Total: ₱{peso2(t.total)} · Balance: ₱{peso2(t.balance)}
              {saved && <span className="ml-3 text-xs text-success">{saved}</span>}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Close</button>
              <button onClick={save} disabled={pending} className="rounded-lg border border-primary bg-surface px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
              <button onClick={downloadPdf} className="rounded-lg border border-primary bg-surface px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">Download PDF</button>
              <button onClick={print} disabled={printing} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">{printing ? "Printing…" : "Print"}</button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted">
              {editing ? "Editing — preview updates live" : "Receipt preview"}
            </p>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="rounded-lg border border-primary bg-surface px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              {editing ? "✓ Done editing" : "Edit"}
            </button>
          </div>

          {/* ---------------- Editor (on demand) ---------------- */}
          {editing && (
          <div className="space-y-4 rounded-lg border border-border bg-stone-50/60 p-4">
            {/* Line items */}
            <Group title="Line Items" onAdd={() => set("items", [...d.items, { qty: 1, description: "", unitPrice: 0 }])}>
              {d.items.map((it, i) => (
                <div key={i} className="rounded-lg border border-border p-2">
                  <div className="flex gap-2">
                    <input type="number" min={0} value={it.qty} onChange={(e) => updItem(i, { qty: Number(e.target.value) })} className={`${inp} w-16`} title="Qty" />
                    <input type="number" min={0} value={it.unitPrice} onChange={(e) => updItem(i, { unitPrice: Number(e.target.value) })} className={`${inp} flex-1`} placeholder="Unit Price" />
                    <button onClick={() => set("items", d.items.filter((_, j) => j !== i))} className="px-2 text-muted hover:text-danger" title="Remove">✕</button>
                  </div>
                  <textarea value={it.description} onChange={(e) => updItem(i, { description: e.target.value })} rows={3} placeholder="Product Description (one line per detail)" className={`${inp} mt-2 w-full resize-none`} />
                </div>
              ))}
              {d.items.length === 0 && <Empty />}
            </Group>

            {/* Discounts — label picked from a fixed dropdown */}
            <Group title="Discounts" onAdd={() => set("discounts", [...d.discounts, { label: DISCOUNT_LABELS[0], amount: 0 }])}>
              {d.discounts.map((x, i) => (
                <Line key={i} x={x} options={DISCOUNT_LABELS} onLabel={(v) => updLA("discounts", i, { label: v })} onAmount={(v) => updLA("discounts", i, { amount: v })} onRemove={() => set("discounts", d.discounts.filter((_, j) => j !== i))} />
              ))}
              {d.discounts.length === 0 && <Empty />}
            </Group>

            {/* Downpayment */}
            <Field label="Downpayment (₱)"><input type="number" min={0} value={d.downpayment} onChange={(e) => set("downpayment", Number(e.target.value))} className={inp} /></Field>

            {/* Payment term breakdown */}
            <Group title="Payment Term Breakdown (optional)" onAdd={() => set("paymentTerms", [...d.paymentTerms, { label: "Bank Transfer", amount: 0 }])}>
              {d.paymentTerms.map((x, i) => (
                <Line key={i} x={x} options={PAYMENT_METHODS} onLabel={(v) => updLA("paymentTerms", i, { label: v })} onAmount={(v) => updLA("paymentTerms", i, { amount: v })} onRemove={() => set("paymentTerms", d.paymentTerms.filter((_, j) => j !== i))} />
              ))}
              {d.paymentTerms.length === 0 && <Empty />}
            </Group>

            <Field label="Sales Representative"><select value={d.salesRep} onChange={(e) => set("salesRep", e.target.value)} className={inp}><option value="">— Select —</option>{ASSIGNEES.map((n) => <option key={n}>{n}</option>)}{d.salesRep && !ASSIGNEES.includes(d.salesRep) && <option value={d.salesRep}>{d.salesRep}</option>}</select></Field>
          </div>
          )}

          {/* ---------------- Preview (exact printed receipt, WYSIWYG) ---------------- */}
          <div className={`flex justify-center overflow-auto rounded-lg border border-border bg-stone-100 p-3 ${editing ? "max-h-[44vh]" : "max-h-[74vh]"}`}>
            <div
              ref={previewRef}
              className="m-0 h-fit bg-white px-5 py-4 text-black shadow-md ring-1 ring-stone-300"
              style={{ fontFamily: "'Courier New', monospace", fontSize: "15px", lineHeight: 1.4, width: "max-content" }}
            >
              {receiptModel(d).map((ln, i) => (
                <div
                  key={i}
                  style={{
                    whiteSpace: "pre",
                    textAlign: ln.center ? "center" : "left",
                    fontWeight: ln.bold ? 700 : 400,
                    fontSize: ln.big ? "1.5em" : undefined,
                    lineHeight: ln.big ? 1.2 : undefined,
                  }}
                >
                  {ln.t || " "}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <label className="text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
function Group({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted">{title}</p>
        <button onClick={onAdd} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-stone-100">+ Add</button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Line({ x, onLabel, onAmount, onRemove, options }: { x: LabeledAmount; onLabel: (v: string) => void; onAmount: (v: number) => void; onRemove: () => void; options?: string[] }) {
  return (
    <div className="flex gap-2">
      {options ? (
        <select value={x.label} onChange={(e) => onLabel(e.target.value)} className={`${inp} flex-1`}>
          {options.map((o) => <option key={o}>{o}</option>)}
          {x.label && !options.includes(x.label) && <option value={x.label}>{x.label}</option>}
        </select>
      ) : (
        <input value={x.label} onChange={(e) => onLabel(e.target.value)} className={`${inp} flex-1`} placeholder="Label" />
      )}
      <input type="number" value={x.amount} onChange={(e) => onAmount(Number(e.target.value))} className={`${inp} w-28`} placeholder="Amount" />
      <button onClick={onRemove} className="px-2 text-muted hover:text-danger" title="Remove">✕</button>
    </div>
  );
}
function Empty() {
  return <p className="text-xs text-muted">None. Click “+ Add”.</p>;
}
