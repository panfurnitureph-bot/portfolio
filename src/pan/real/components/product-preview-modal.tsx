"use client";

import type { ReactNode } from "react";
import { Modal } from "./modal";
import { SpecRows } from "./ui";
import { SpecFieldsView } from "./spec-fields-input";
import { realValue } from "@/lib/product-columns";

export type ProductPreview = {
  image_url: string | null;
  name: string | null;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  // Specifications / design details — isang linya kada spec (bagong format).
  specs?: string | null;
  qty?: number | null;
  unit_price?: number | null;
  order_number?: string | null;
  // Ang daanan pabalik sa website request — MTO # → FQ # → Order #. Wala nito
  // ang walk-in, kaya hindi lumalabas ang bar.
  mto_number?: string | null;
  fq_number?: string | null;
};

// Branded product preview (matches the workshop "Product" card). Read-only.
export function ProductPreviewModal({ item, onClose }: { item: ProductPreview | null; onClose: () => void }) {
  // COLOR row — itago kapag may Fabric/Upholstered line na sa specs (2026-08-19):
  // doble lang; nasa guided specs cards na sa ibaba ang tela. Dimension din,
  // itago kapag blanko — nasa specs na ang mga sukat.
  const hasFabricLine = /^(Fabric(\s*\/\s*Finish)?|Upholstered Finish):/m.test(item?.specs ?? "");
  // IISANG HULMA ANG LAHAT (2026-08-23): ang Product / Name at ang SKU ay
  // hilera rin, kasama ng Category — hindi sariling kahon sa itaas. Iisang
  // talahanayan ang binabasa, hindi tatlong magkaibang anyo.
  const rows: Array<[string, ReactNode]> = item
    ? ([
        ["Product / Name", item.name],
        ...(item.sku ? [["SKU", <span key="sku" className="font-mono">{item.sku}</span>] as [string, ReactNode]] : []),
        ["Category", item.category],
        ...(!hasFabricLine ? [["Color", item.color] as [string, ReactNode]] : []),
        ...(item.dimension?.trim() ? [["Dimension", item.dimension] as [string, ReactNode]] : []),
      ])
    : [];
  if (item?.unit_price != null) rows.push(["Unit Price", `₱${item.unit_price.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`]);
  if (item?.qty != null) rows.push(["Qty", String(item.qty)]);
  return (
    <Modal open={!!item} onClose={onClose} title="Product Details" description={item?.order_number ?? undefined} size="lg">
      {/* Kung saan nanggaling ang build — para mahanap ang quotation na
          pinagbatayan ng presyo nang hindi na babalik sa MTO Requests. */}
      {item?.mto_number && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-[#caa45a] bg-[#FAF7F2] px-2.5 py-1.5">
          <span className="rounded border border-[#B87333] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#B87333]">{item.mto_number}</span>
          <span className="text-[11px] text-muted">→</span>
          {item.fq_number && (
            <>
              <span className="rounded border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold">{item.fq_number}</span>
              <span className="text-[11px] text-muted">→</span>
            </>
          )}
          <span className="rounded border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold">{item.order_number ?? "—"}</span>
        </div>
      )}
      {item && (
        <div className="overflow-hidden rounded-xl border border-[#e6dcc4] bg-stone-50/50 shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-[#e6dcc4] bg-[#4a3b1a] px-4 py-2.5">

            <div>
              <div className="text-sm font-semibold text-white">Product</div>
              <div className="text-[11px] text-[#e7dcc4]">Item specs</div>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <div className="overflow-hidden rounded-xl border border-border bg-white">
              {item.image_url
                ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={item.image_url} alt="" className="mx-auto max-h-60 w-full object-contain p-2" />
                : <div className="flex h-44 items-center justify-center text-muted">No image</div>}
            </div>
            <SpecRows items={rows} />
            {/* SPECS — parehong guided cards ng Customized builder, read-only
                (SpecFieldsView): iisang format kahit saan. */}
            <SpecFieldsView category={item.category ?? ""} specs={item.specs} />
          </div>
        </div>
      )}
    </Modal>
  );
}

// ISANG MAPPING para sa item ng Delivery QA / Installation / Pickup (2026-08-23):
// ang description ay pangalan sa unang linya at specs sa sumunod; ang
// category/color ng custom na item ay build line kaya nililinis (realValue).
// Iisang modal, iisang mapping - hindi tatlong kopya.
export function previewFromItem(
  it: { description?: string | null; image_url?: string | null; sku?: string | null; category?: string | null; color?: string | null; dimension?: string | null; specs?: string | null; qty?: number | null },
  orderNumber?: string | null,
): ProductPreview {
  const lines = String(it.description ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const name = (lines[0] ?? "").replace(/^\s*rework\s*\u00b7\s*(rma-\d+\s*\u00b7\s*)?/i, "") || null;
  // Ang build: ang `specs` field kung dala (Delivery QA / Installation - pangalan
  // lang ang description doon), kundi ang mga linya pagkatapos ng pangalan,
  // kundi ang Dimension cell na pinaghiwalay ng " · " (lumang QA rows).
  const specs = it.specs
    ?? (lines.slice(1).map((l) => l.replace(/^[\u2022\u00b7-]\s*/, "")).join("\n") || null)
    ?? (String(it.dimension ?? "").split(" · ").map((x) => x.trim()).filter((x) => x.includes(":")).join("\n") || null);
  return {
    image_url: it.image_url ?? null, name, sku: it.sku ?? null,
    category: realValue(it.category), color: realValue(it.color), dimension: realValue(it.dimension),
    specs, qty: it.qty ?? null, order_number: orderNumber ?? null,
  };
}
