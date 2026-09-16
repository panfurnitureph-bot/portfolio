"use client";

import { useMemo, useState } from "react";
import { Modal } from "./modal";
import { cn } from "./ui";
import { computeQuote, computeAddon, type Unit, type CurtainWindow } from "@/lib/curtain";

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const peso = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = { label: string; height: string; width: string; unit: Unit };

// Curtain (Kurtina ni PAN) quotation calculator. Enter each window's H×W → auto
// yardage/panel/rods/price per the shop formula. "Add to order" emits one line item
// per window (description = breakdown, unitPrice = that window's total).
export function CurtainCalculator({
  onAdd,
}: {
  // Emits line items to the order (qty 1 each): description + unit price.
  onAdd: (items: { description: string; unitPrice: number }[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([{ label: "Window 1", height: "", width: "", unit: "in" }]);
  const [delivery, setDelivery] = useState(""); // delivery & installation fee
  const [ocular, setOcular] = useState("");     // ocular fee
  // "Additional" add-ons — extra fabric/labor on top of the base windows (receipts
  // show these). Optional price override for a manually-added rod/track/accessory.
  const [addons, setAddons] = useState<{ blackout: string; sheer: string; labor: string; override: string }[]>([]);

  const windows: CurtainWindow[] = rows.map((r, i) => ({
    label: r.label.trim() || `Window ${i + 1}`,
    height: Number(r.height) || 0,
    width: Number(r.width) || 0,
    unit: r.unit,
  }));
  const quote = useMemo(() => computeQuote(windows), [JSON.stringify(windows)]);

  const upd = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { label: `Window ${rs.length + 1}`, height: "", width: "", unit: rs[rs.length - 1]?.unit ?? "in" }]);
  const rmRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  function addToOrder() {
    // One BLENDED curtain line per window (rod is included in the price, exactly like
    // the acknowledgement receipt: "SLIDING / N yards blackout / N yards sheer /
    // N labor panels / sfold Type" = the window total).
    const items = quote.windows
      .filter((w) => w.total > 0)
      .map((w) => ({
        description: [
          "SLIDING",
          `${w.yardage} yards blackout`,
          `${w.yardage} yards sheer`,
          `${w.panel} labor panels`,
          "sfold Type",
        ].join("\n"),
        unitPrice: w.total,
      }));
    // "Additional" add-on lines (extra fabric/labor beyond the base windows).
    for (const a of addons) {
      const calc = computeAddon({ blackoutYards: Number(a.blackout) || 0, sheerYards: Number(a.sheer) || 0, laborPanels: Number(a.labor) || 0 });
      const override = Number(a.override) || 0; // manual rod/track/accessory price
      const total = calc.total + override;
      if (total <= 0) continue;
      const descLines = ["Additional", ...calc.lines.map((l) => l.label), "sfold Type"];
      items.push({ description: descLines.join("\n"), unitPrice: total });
    }

    // Optional separate fee lines (matches the receipt's Delivery / Ocular rows).
    const deliveryFee = Number(delivery) || 0;
    const ocularFee = Number(ocular) || 0;
    if (deliveryFee > 0) items.push({ description: "Delivery and installation fee", unitPrice: deliveryFee });
    if (ocularFee > 0) items.push({ description: "Ocular Fee", unitPrice: ocularFee });

    if (items.length) onAdd(items);
    setOpen(false);
    setRows([{ label: "Window 1", height: "", width: "", unit: "in" }]);
    setDelivery(""); setOcular(""); setAddons([]);
  }
  const addonTotal = addons.reduce((s, a) => s + computeAddon({ blackoutYards: Number(a.blackout) || 0, sheerYards: Number(a.sheer) || 0, laborPanels: Number(a.labor) || 0 }).total + (Number(a.override) || 0), 0);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-stone-100">
        Curtain Quote
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Curtain Quotation — Kurtina ni PAN" description="Measure the window, enter it here, and the price is automatic." size="xl"
        footer={
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted">Grand Total ({rows.length} window{rows.length === 1 ? "" : "s"}{addons.length ? ` + ${addons.length} add-on` : ""}{(Number(delivery) || Number(ocular)) ? " + fees" : ""})</p>
              <p className="text-xl font-bold text-primary tabular-nums">₱{peso(quote.grandTotal + addonTotal + (Number(delivery) || 0) + (Number(ocular) || 0))}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Cancel</button>
              <button onClick={addToOrder} disabled={quote.grandTotal <= 0} className="rounded-lg bg-primary px-5 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50">Add to order →</button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Simple 3-step guide so no one gets lost */}
          <div className="rounded-xl bg-blue-50 p-3 text-xs text-blue-800 ring-1 ring-inset ring-blue-600/15">
            <b>How to use:</b> ① Measure the window (height × width). ② Enter it here and pick the unit. ③ The price is automatic — click <b>Add to order</b>. One card per window.
          </div>

          {rows.map((r, i) => {
            const q = quote.windows[i];
            return (
              <div key={i} className="rounded-2xl border border-border p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                  <input value={r.label} onChange={(e) => upd(i, { label: e.target.value })} className={cn(inp, "flex-1 font-semibold")} placeholder={`Window ${i + 1}`} />
                  {rows.length > 1 && <button type="button" onClick={() => rmRow(i)} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-red-50 hover:text-danger">Remove</button>}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <label className="text-xs font-medium text-muted">Height<input type="number" min={0} value={r.height} onChange={(e) => upd(i, { height: e.target.value })} placeholder="e.g. 100" className={cn(inp, "mt-1 w-full text-base")} /></label>
                  <label className="text-xs font-medium text-muted">Width<input type="number" min={0} value={r.width} onChange={(e) => upd(i, { width: e.target.value })} placeholder="e.g. 80" className={cn(inp, "mt-1 w-full text-base")} /></label>
                  <label className="text-xs font-medium text-muted">Unit<select value={r.unit} onChange={(e) => upd(i, { unit: e.target.value as Unit })} className={cn(inp, "mt-1 w-full text-base")}><option value="in">inches</option><option value="cm">cm</option><option value="mm">mm</option></select></label>
                </div>

                {/* Client-style quotation — plain wording, big total, no jargon */}
                {q.total > 0 ? (
                  <div className="mt-3 rounded-xl bg-stone-50 p-4">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Quotation · {q.label}</p>
                    {r.unit !== "in" && <p className="mb-2 text-[11px] text-muted">Size: {q.heightIn}″ × {q.widthIn}″ (from {r.height || 0}{r.unit} × {r.width || 0}{r.unit})</p>}
                    <div className="space-y-1 text-sm">
                      {q.lines.map((l, k) => (
                        <div key={k} className="flex justify-between"><span>{l.label}</span><span className="tabular-nums text-muted">₱{peso(l.amount)}</span></div>
                      ))}
                    </div>
                    <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
                      <span className="text-sm font-semibold">Total ({q.label})</span>
                      <span className="text-xl font-bold text-primary tabular-nums">₱{peso(q.total)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl bg-stone-50 px-3 py-4 text-center text-xs text-muted">Enter the height and width to see the price.</p>
                )}
              </div>
            );
          })}

          <button type="button" onClick={addRow} className="w-full rounded-xl border-2 border-dashed border-border py-3 text-sm font-semibold text-muted hover:border-primary hover:text-foreground">+ Add another window</button>

          {/* "Additional" add-ons — extra fabric/labor beyond the base windows (receipts
              show these as "Additional …"). Blackout and/or sheer, own labor, plus an
              optional manual price for a rod/track/accessory. */}
          {addons.map((a, i) => {
            const c = computeAddon({ blackoutYards: Number(a.blackout) || 0, sheerYards: Number(a.sheer) || 0, laborPanels: Number(a.labor) || 0 });
            const line = c.total + (Number(a.override) || 0);
            const setA = (patch: Partial<typeof a>) => setAddons((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="rounded-xl border border-amber-300 bg-amber-50/40 p-4">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Additional {i + 1}</p>
                  <button type="button" onClick={() => setAddons((xs) => xs.filter((_, j) => j !== i))} className="text-xs text-muted hover:text-danger">Remove</button>
                </div>
                <p className="mb-2 text-[11px] text-amber-800/80">Fabric + labor is automatic. Type the rod/track/accessory amount manually — it varies per order.</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <label className="text-xs font-medium text-muted">Blackout yards<input type="number" min={0} value={a.blackout} onChange={(e) => setA({ blackout: e.target.value })} placeholder="0" className={cn(inp, "mt-1 w-full")} /></label>
                  <label className="text-xs font-medium text-muted">Sheer yards<input type="number" min={0} value={a.sheer} onChange={(e) => setA({ sheer: e.target.value })} placeholder="0" className={cn(inp, "mt-1 w-full")} /></label>
                  <label className="text-xs font-medium text-muted">Labor panels<input type="number" min={0} value={a.labor} onChange={(e) => setA({ labor: e.target.value })} placeholder="0" className={cn(inp, "mt-1 w-full")} /></label>
                  <label className="text-xs font-medium text-muted">+ Rod/track (₱)<input type="number" min={0} value={a.override} onChange={(e) => setA({ override: e.target.value })} placeholder="0" className={cn(inp, "mt-1 w-full")} /></label>
                </div>
                <p className="mt-2 text-right text-sm font-semibold">Additional total: ₱{peso(line)}</p>
              </div>
            );
          })}
          <button type="button" onClick={() => setAddons((xs) => [...xs, { blackout: "", sheer: "", labor: "", override: "" }])} className="w-full rounded-xl border-2 border-dashed border-amber-300 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-50">+ Add &quot;Additional&quot; item <span className="font-normal text-amber-600/80">(extra yards/labor with no window size — like the receipt&apos;s &quot;Additional&quot; rows)</span></button>

          {/* Optional extra fees — added as their own order lines (like the receipt). */}
          <div className="rounded-xl border border-border p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Additional fees (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-muted">Delivery &amp; installation fee<input type="number" min={0} value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="e.g. 1500" className={cn(inp, "mt-1 w-full")} /></label>
              <label className="text-xs font-medium text-muted">Ocular fee<input type="number" min={0} value={ocular} onChange={(e) => setOcular(e.target.value)} placeholder="e.g. 500" className={cn(inp, "mt-1 w-full")} /></label>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
