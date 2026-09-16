import "server-only";
import type { createServerSupabase } from "@/lib/supabase/server";
import { TAG_DELIVERED, TAG_THIS, TAG_NEXT, type EmailItem } from "./layout";
import { lineKey, keySet, hasKey, lineName, colorOfDesc, keyColor } from "@/lib/orders/line-key";
import { loadVariantIndex, variantsFor, imageForColor } from "@/lib/ops/product-variants";

type SB = ReturnType<typeof createServerSupabase>;

// Mula receipt_items papunta sa email item cards: pangalan sa unang linya,
// specs sa mga bullet, larawan mula sa item o sa catalog (SKU muna, saka
// pangalan). Ang mga FEE (Shipping/Rush) ay hindi item card — nasa totals sila.
const FEE = /^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i;

export type ReceiptLine = {
  description?: string | null; qty?: number; unitPrice?: number;
  sku?: string | null; image?: string | null; color?: string | null;
};

export function feeTotalOf(items: ReceiptLine[]): number {
  return items
    .filter((it) => FEE.test(String(it.description ?? "").split("\n")[0].trim()))
    .reduce((t, it) => t + (Number(it.unitPrice) || 0) * (Number(it.qty) || 1), 0);
}

// ── LITRATO AYON SA KULAY NG LINYA (Joe 2026-09-06, "pati sa email dapat tama
// base sa kulay ng per product") ─────────────────────────────────────────────
// Ang `image` ng receipt line ay ang litratong nakuha noong ginawa ang order —
// sa lumang order ay ang hero ng produkto, iisa kahit anong kulay. Ang
// product.color_variants (0231) ay may sariling litrato kada tela: iyon ang
// una, saka ang image ng linya, saka ang hero ng catalog.
export type ColorPhotoFn = (line: { description?: string | null; sku?: string | null; color?: string | null; image?: string | null }) => string | null;

export async function colorPhotoResolver(db: SB): Promise<ColorPhotoFn> {
  const idx = await loadVariantIndex(db).catch(() => new Map());
  return (line) => {
    const color = String(line.color ?? "").trim() || colorOfDesc(line.description);
    if (!color) return line.image ?? null;
    return imageForColor(variantsFor(idx, lineName(line.description), line.sku), color) ?? line.image ?? null;
  };
}

// Kopya ng order na ang receipt_items ay may litratong ayon sa kulay — para sa
// mga email na binubuo nang sync mula sa OrderRow (resibo, For Payment,
// Order Confirmed). Hindi binabago ang orihinal.
export async function withColorPhotos<T extends { receipt_items?: unknown }>(db: SB, order: T): Promise<T> {
  const items = Array.isArray(order.receipt_items) ? (order.receipt_items as ReceiptLine[]) : null;
  if (!items?.length) return order;
  try {
    const photo = await colorPhotoResolver(db);
    return { ...order, receipt_items: items.map((it) => ({ ...it, image: photo(it) ?? it.image ?? null })) };
  } catch { return order; }
}

export function productLinesOf(items: ReceiptLine[]): ReceiptLine[] {
  return items.filter((it) => {
    const n = String(it.description ?? "").split("\n")[0].trim();
    return n && !FEE.test(n);
  });
}

export async function emailItemsFromLines(
  db: SB,
  lines: ReceiptLine[],
): Promise<EmailItem[]> {
  // Litrato ayon sa KULAY ng linya muna (color_variants), saka ang sariling
  // image ng linya, saka ang hero ng catalog.
  const photoOf = await colorPhotoResolver(db);
  const missing = lines.filter((l) => !l.image);
  const photoBySku = new Map<string, string>();
  const photoByName = new Map<string, string>();
  if (missing.length) {
    try {
      const { data: prods } = await db.from("product").select("product_name, sku, image_url").limit(10000);
      for (const p of prods ?? []) {
        if (p.image_url) {
          if (p.sku) photoBySku.set(String(p.sku).toLowerCase(), p.image_url as string);
          photoByName.set(String(p.product_name ?? "").toLowerCase(), p.image_url as string);
        }
      }
    } catch { /* walang larawan — may placeholder naman ang card */ }
  }
  return lines.map((l) => {
    const parts = String(l.description ?? "").split("\n").map((x) => x.trim());
    const name = parts[0] ?? "Item";
    const specLines = parts.slice(1).map((x) => x.replace(/^[•·-]\s*/, "")).filter(Boolean);
    const specs = specLines.length ? specLines : null;
    const qty = Number(l.qty) || 1;
    return {
      name,
      lineKey: lineKey(l.description, l.color),
      specs,
      qty,
      priceTotal: Math.round(((Number(l.unitPrice) || 0) * qty) * 100) / 100,
      photoUrl: photoOf(l)
        ?? (l.sku ? photoBySku.get(String(l.sku).toLowerCase()) : undefined)
        ?? photoByName.get(name.toLowerCase())
        ?? null,
    };
  });
}

// ── REWORK: ANG INAAYOS LANG (2026-08-29) ────────────────────────────────────
// Ang biyahe ng rework ay may isang gamit — ang inayos na produkto. Ang bawat
// email ay bumubuo ng listahan mula sa buong order, kaya ang isang RMA na
// sumasaklaw sa isang sofa ay naglilista ng tatlo; ang dalawa roon ay nasa
// bahay ng customer mula pa noong unang hatid.
//
// HINDI tinatanong kung tapos na ang repair: ang pull-out na nasa workshop pa
// ay dumadaan sa mga email na ito, at doon din mali ang buong listahan.

// Alin ang gamit na hawak ng RMA ng bawat order — unang linya ng item_desc.
export async function reworkItemDescByOrder(db: SB, orderIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!orderIds.length) return out;
  try {
    const { data } = await db.from("returns")
      .select("order_id, item_desc, status, color")
      .eq("resolution", "rework").in("order_id", orderIds)
      .order("id", { ascending: false }).limit(2000);
    for (const r of (data ?? []) as { order_id: number | null; item_desc: string | null; status: string | null; color?: string | null }[]) {
      const oid = Number(r.order_id);
      if (!Number.isFinite(oid) || out.has(oid)) continue;   // newest wins
      if (/reject/i.test(r.status ?? "")) continue;
      const nm = String(r.item_desc ?? "").split("\n")[0].trim();
      // KASAMA ANG KULAY (2026-09-06): "pangalan\n• Color: X" para ang
      // reworkItemsOnly ay ang kulay na iyon lang ang itira.
      const c = String(r.color ?? "").trim() || colorOfDesc(r.item_desc);
      if (nm) out.set(oid, c ? `${nm}\n• Color: ${c}` : nm);
    }
  } catch { /* best-effort — buong order ang ipapakita */ }
  return out;
}

// Pangalan ang pagtutugma: walang SKU ang EmailItem. Kapag walang tumugma —
// binago o binura ang linya — ang buong listahan pa rin, kaysa magpadala ng
// email na walang laman.
export function reworkItemsOnly(all: EmailItem[], itemDesc: string | null | undefined): EmailItem[] {
  const name = String(itemDesc ?? "").split("\n")[0].trim().toLowerCase();
  if (!name) return all;
  // KASAMA ANG KULAY (2026-09-06): kapag may kulay ang RMA at may kulay ang
  // card (lineKey "pangalan @ kulay"), dapat magkapareho; kung wala sa isa,
  // pangalan lang gaya ng dati.
  const rc = colorOfDesc(itemDesc);
  const only = all.filter((x) => {
    if (x.name.trim().toLowerCase() !== name) return false;
    const lc = x.lineKey ? keyColor(x.lineKey) : "";
    return !rc || !lc || rc === lc;
  });
  return only.length ? only : all;
}

// ── PARTIAL DELIVERY TAGS SA KAHIT ANONG EMAIL (2026-09-03) ──────────────────
// "dapat pala sa Payment received naka indicate din pag partial kung anong
// product" — ang confirm email lang ang may DELIVERED / THIS DELIVERY / NEXT
// DELIVERY na tag noon. Ito ang shared na bersyon: kinukuha ang batch mula sa
// dq_items (habang biyahe) o sa HULING batch ng order_line_deliveries
// (pagka-Delivered, nilinis na ang dq), at ang naihatid mula sa lahat ng
// naunang batch. Null ang balik kapag hindi partial ang order — walang tag,
// dating itsura.
export type BatchTagMap = Map<string, "this" | "delivered" | "next">;

export async function batchTagsFor(db: SB, orderId: number | null | undefined): Promise<BatchTagMap | null> {
  if (orderId == null) return null;
  try {
    // KASAMA ANG KULAY (2026-09-06): "pangalan @ kulay" ang susi; ang legacy na
    // susi (pangalan lang) ay tumutugma sa alinmang kulay (hasKey).
    const key = (t: unknown) => lineKey(String(t ?? ""));
    const { data: o } = await db.from("orders").select("dq_items, receipt_items").eq("id", orderId).maybeSingle();
    if (!o) return null;
    let batch = keySet(o.dq_items);
    const delivered = new Set<string>();
    try {
      const { data: dl } = await db.from("order_line_deliveries").select("item_desc, batch_no").eq("order_id", orderId);
      const rows = (dl ?? []) as { item_desc: string | null; batch_no: number | null }[];
      for (const r of rows) { const k = key(r.item_desc); if (k) delivered.add(k); }
      if (!batch.size && rows.length) {
        const maxB = Math.max(0, ...rows.map((r) => Number(r.batch_no) || 0));
        batch = new Set(rows.filter((r) => (Number(r.batch_no) || 0) === maxB).map((r) => key(r.item_desc)).filter(Boolean));
      }
    } catch { /* wala pang 0200 */ }
    if (!batch.size) return null;
    const lines = productLinesOf((Array.isArray(o.receipt_items) ? o.receipt_items : []) as ReceiptLine[]);
    const names = lines.map((l) => lineKey(l.description, l.color)).filter(Boolean);
    // Hindi partial: lahat ng linya ay sakay ng biyaheng ito at walang nauna.
    const earlier = names.some((n) => hasKey(delivered, n) && !hasKey(batch, n));
    const pending = names.some((n) => !hasKey(batch, n) && !hasKey(delivered, n));
    if (!earlier && !pending) return null;
    const tags: BatchTagMap = new Map();
    for (const n of names) {
      if (hasKey(batch, n)) tags.set(n, "this");
      else if (hasKey(delivered, n)) tags.set(n, "delivered");
      else tags.set(n, "next");
    }
    return tags;
  } catch { return null; }
}

// Ilapat ang mga tag sa item cards — hindi ginagalaw ang walang tugma.
export function applyBatchTags(cards: EmailItem[], tags: BatchTagMap | null): EmailItem[] {
  if (!tags) return cards;
  return cards.map((c) => {
    const t = tags.get(c.lineKey ?? lineKey(c.name));
    if (t === "this") return { ...c, tag: TAG_THIS };
    if (t === "delivered") return { ...c, tag: TAG_DELIVERED };
    if (t === "next") return { ...c, tag: TAG_NEXT, dimmed: true };
    return c;
  });
}
