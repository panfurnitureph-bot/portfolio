"use client";

// STOCK BUILD — ipinapagawa ng Operations sa isang workshop nang WALANG order.
// Parehong item picker ng Create Order: pumili sa records (gagamitin ang umiiral
// na SKU) o gumawa ng bago sa guided builder. Bago tumuloy ang BAGO, hinahanap
// ng server kung may eksaktong katulad na — kapag meron, hindi ito basta
// nagpapatuloy: pipiliin ng Operations kung gagamitin ang umiiral, o tutuloy sa
// bago na may DAHILAN (naitatala kung sino at bakit).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LineItemsEditor, type LineItem } from "./line-items-editor";
import { assignStockBuild } from "@/app/operations/stock-build/actions";
import { cn, SpecRows } from "./ui";
import { SpecFieldsView } from "./spec-fields-input";
import { specCategoryOf } from "./line-items-editor";
import type { ProductRow } from "@/lib/supabase/server";

type WorkshopLite = { id: number; name: string };

export function StockBuildManager({ workshops, products }: { workshops: WorkshopLite[]; products: ProductRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Isang item lang ang stock build — nagsisimula nang may blangkong row para
  // hindi kailangang pindutin ang "+ Add item" (nakatago sa build mode).
  const [items, setItems] = useState<LineItem[]>([{ qty: 1, description: "", unitPrice: 0 }]);
  const [workshopId, setWorkshopId] = useState<number | "">(workshops[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  // Nahanap na katulad — hinihintay ang desisyon ng Operations.
  const [dupe, setDupe] = useState<{ sku: string; product_name: string; specs: string | null } | null>(null);
  const [forceReason, setForceReason] = useState("");
  // Bukas ang picker hangga't walang napili; pagkapili, preview na — may Edit
  // pabalik sa picker nang hindi nawawala ang naitakda.
  const [picking, setPicking] = useState(true);

  const item = items[0] ?? null;
  const hasItem = !!item?.description.trim();
  const specsOf = (l: LineItem) => l.description.split("\n").slice(1).join("\n");
  const nameOf = (l: LineItem) => l.description.split("\n")[0] ?? "";

  const submit = (forceNew?: string) => {
    if (!hasItem || !item) { setError("Pick or build an item first."); return; }
    if (!workshopId) { setError("Pick a workshop."); return; }
    setError(null); setOkMsg(null);
    start(async () => {
      const res = await assignStockBuild({
        workshop_id: Number(workshopId),
        category: item.category ?? "",
        product_name: nameOf(item),
        specs: specsOf(item),
        qty: item.qty || 1,
        reason,
        // Para kumpleto agad ang record sa Product Management.
        color: item.color ?? null,
        image_url: item.image ?? null,
        price: item.unitPrice || 0,
        // Ang picker ay laging may SKU — sa listahan o ginawa ng builder. Ang
        // is_new ang nagsasabi kung alin, kaya ang duplicate check ay tumatakbo
        // lang sa bagong gawa (at hindi tumutugma sa sarili nitong record).
        sku: item.sku ?? null,
        is_new: !!item.customized,
        force_new_reason: forceNew ?? null,
      });
      if ("error" in res) { setError(res.error); return; }
      if ("duplicate" in res) { setDupe(res.duplicate); return; }
      setDupe(null); setForceReason("");
      const ws = workshops.find((w) => w.id === Number(workshopId))?.name ?? "workshop";
      setOkMsg(res.reused
        ? `Assigned to ${ws} — ${res.sku}, an item already in Product Management.`
        : `Assigned to ${ws} — ${res.sku} created in Product Management, stock arrives after Receiving QC.`);
      setItems([{ qty: 1, description: "", unitPrice: 0 }]); setReason(""); setPicking(true);
      router.refresh();
    });
  };

  const inp = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className="space-y-4">
      {okMsg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{okMsg}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Ang picker ang unang nakikita; kapag may napili na, preview ang
          ipinapakita at ang picker ay nakatago (hindi binubura) — kaya ang
          Edit ay bumabalik sa mismong setup na ginawa. */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-[#4a3b1a] px-4 py-2.5">
          <p className="text-xs font-bold uppercase tracking-wide text-[#f4ead8]">What to build</p>
          {hasItem && !picking && (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="rounded-lg border border-[#caa45a] px-3 py-1 text-xs font-bold text-[#f4ead8] hover:bg-white/10"
            >
              Edit item
            </button>
          )}
          {picking && (
            <p className="text-[11px] text-[#e7dcc4]">
              Pick an item you already carry — the same SKU is used. Use <b>Customized</b> for something new.
            </p>
          )}
        </div>

        <div className="p-4">
          <LineItemsEditor
            items={items}
            onChange={(next) => {
              setItems(next.slice(-1));
              // Pagkapili (may laman na ang description) → preview agad.
              if (next.slice(-1)[0]?.description.trim()) setPicking(false);
            }}
            products={products}
            buildMode
            hidden={!picking}
          />

          {hasItem && !picking && item && (
            // PAREHONG preview ng Product Details: larawan, SKU / Category /
            // Color / Qty na hilera, tapos ang SPECIFICATIONS card.
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="w-full shrink-0 sm:w-52">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt="" className="aspect-square w-full rounded-lg border border-border bg-white object-cover" />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-border bg-stone-50 text-xs text-muted">No photo</div>
                )}
                <span className={cn(
                  "mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold",
                  item.customized || !item.sku ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700",
                )}>
                  {item.customized || !item.sku ? "New item" : "Existing item"}
                </span>
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted">Product / Name</p>
                  <p className="text-lg font-bold">{nameOf(item)}</p>
                </div>
                <SpecRows items={[
                  ...(item.sku ? [["SKU", item.sku] as [string, React.ReactNode]] : []),
                  ...(item.category ? [["Category", item.category] as [string, React.ReactNode]] : []),
                  ...(item.color && !specsOf(item).toLowerCase().includes(item.color.toLowerCase())
                    ? [["Color", item.color] as [string, React.ReactNode]] : []),
                ]} />
                {specsOf(item).trim() && (
                  <div className="rounded-lg border border-border bg-stone-50/60 p-3">
                    <SpecFieldsView category={specCategoryOf(item.category ?? "", nameOf(item))} specs={specsOf(item)} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Saan gagawin, ilan, at bakit — isang card na may sariling footer. */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="border-b border-border bg-[#4a3b1a] px-4 py-2.5">
          <p className="text-xs font-bold uppercase tracking-wide text-[#f4ead8]">Assignment</p>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-[110px_1fr_1.4fr]">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Qty *</span>
            <input
              type="number"
              min={1}
              value={item?.qty ?? 1}
              onChange={(e) => setItems((cur) => cur.map((l) => ({ ...l, qty: Math.max(1, Number(e.target.value) || 1) })))}
              className={inp}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Workshop *</span>
            <select value={workshopId} onChange={(e) => setWorkshopId(e.target.value ? Number(e.target.value) : "")} className={inp}>
              <option value="">— select —</option>
              {workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Reason</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Low stock — 2 left" className={inp} />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-stone-50/60 px-4 py-3">
          <p className="text-[11px] text-muted">
            {hasItem
              ? "Paid by the workshop rate sheet — the item returns through Receiving QC before it becomes stock."
              : "Pick what to build first."}
          </p>
          <button
            type="button"
            disabled={pending || !hasItem || !workshopId}
            onClick={() => submit()}
            className="rounded-lg bg-[#4a3b1a] px-5 py-2.5 text-sm font-bold text-[#f4ead8] hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Assigning…" : "Assign to workshop →"}
          </button>
        </div>
      </div>

      {/* Katulad na natagpuan — desisyon ng Operations */}
      {dupe && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4">
          <p className="text-sm font-bold text-amber-900">This item already exists</p>
          <div className="mt-2 rounded-lg border border-amber-200 bg-white/70 p-3 text-sm">
            <p className="font-mono text-xs text-muted">{dupe.sku}</p>
            <p className="font-semibold">{dupe.product_name}</p>
            {dupe.specs && <p className="mt-1 whitespace-pre-line text-xs text-muted">{dupe.specs}</p>}
          </div>
          <p className="mt-2 text-xs text-amber-900">
            Every specification matches what you are about to build. Use it so the same product does not get listed twice.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                // Gamitin ang umiiral: ipasa ang SKU nito, laktawan ang check.
                setItems((cur) => cur.map((l) => ({ ...l, sku: dupe.sku, customized: false })));
                setDupe(null);
                setTimeout(() => submit(), 0);
              }}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Use {dupe.sku}
            </button>
            <span className="text-xs text-muted">or</span>
            <input
              value={forceReason}
              onChange={(e) => setForceReason(e.target.value)}
              placeholder="Why it must be a new item…"
              className={cn(inp, "w-auto min-w-[240px] flex-1")}
            />
            <button
              type="button"
              disabled={pending || !forceReason.trim()}
              onClick={() => submit(forceReason.trim())}
              className="rounded-lg border border-amber-400 px-4 py-2 text-sm font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              Build as new
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
