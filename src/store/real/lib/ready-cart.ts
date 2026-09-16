// READY-UNIT CART LINE (2026-09-04, "pag direct add to cart wala description"):
// ang Add to cart sa product card at Quick View ay nagdadala ng KAPAREHONG
// detalye ng product page (MtoOptions.handleBuyReady) — ang as-is specs ng
// Product Management (End to End, Seat Height…) at ang napiling kulay — para
// pareho ang nababasa sa cart, checkout, at sa IMS order.
import type { Product } from "@/lib/products";

export type ReadyLine = { key: string; unitPrice: number; addOns: { label: string; price: number }[]; baseLabel: string };

export function readySpecLines(product: Product): string[] {
  const px = product as unknown as { mtoReadySpecs?: string };
  return String(px.mtoReadySpecs ?? "").split("\n").map((s) => s.trim().replace(/^[•·\-]\s*/, "")).filter(Boolean);
}

export function readyCartLine(product: Product, colorName: string, sizeName?: string, priceOverride?: number): ReadyLine {
  const px = product as unknown as { mtoReadyPrice?: number };
  const unitPrice = priceOverride && priceOverride > 0 ? priceOverride : Number(px.mtoReadyPrice ?? 0) > 0 ? Number(px.mtoReadyPrice) : product.price;
  const fabricLabel = colorName ? `Fabric: ${colorName}` : "";
  const sizeLabel = sizeName ? `Size: ${sizeName}` : "";
  const baseLabel = sizeName ? `Ready unit — ${sizeName}` : "Ready unit — as configured";
  const key = colorName ? `${baseLabel} — ${colorName}` : baseLabel;
  const addOns = [
    // Ang Fabric/Color line ng specs ay ang buong listahan ng kulay - hindi
    // isinasama kapag may napiling kulay, para hindi doble.
    ...readySpecLines(product)
      .filter((l) => !/^sizes:/i.test(l))
      .filter((l) => !(fabricLabel && /^(?:fabric(?:\s*\/\s*finish)?|upholstered finish|color)\s*:/i.test(l)))
      .map((l) => ({ label: l, price: 0 })),
    ...(sizeLabel ? [{ label: sizeLabel, price: 0 }] : []),
    ...(fabricLabel ? [{ label: fabricLabel, price: 0 }] : []),
  ];
  return { key, unitPrice, addOns, baseLabel };
}
