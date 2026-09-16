import { lineKey, keySet, hasKey } from "@/lib/orders/line-key";
import type { createServerSupabase } from "@/lib/supabase/server";
import { consumePlacements } from "@/lib/placements";
import { refreshBestSellers } from "@/lib/web/best-sellers";
import { syncWebStock } from "@/lib/web/stock";

// Shared inventory helpers for the order → delivery flow. Kept OUT of a
// "use server" file so non-action modules (e.g. delivery actions) can import the
// plain functions — a "use server" module may only export async server actions.
type SupaClient = ReturnType<typeof createServerSupabase>;
export type OrderItem = { qty: number; description: string; sku?: string | null };

// Apply an inventory RPC to each matched order line. `fn` picks the operation:
//   fn_inventory_reserve  → hold stock at order commit (reserved +, oh_inv same)
//   fn_inventory_release  → give back a reservation on edit/cancel/delete
//   fn_inventory_ship     → physically deduct (reserved −, oh_inv −) at stock-out
// Matches each line to an inventory row by SKU (else first line of description) and
// accumulates qty per row so multiple lines hitting the same product stay correct.
// Returns true only if EVERY matched row's RPC succeeded; unmatched lines are
// skipped (not all lines are stocked) and don't count as failures.
// Kulay/tela ng isang linya ng order mula sa description ("Fabric: Leather
// BE20457", "Upholstered Finish: …", "Color: …"). Unang tela lang kapag marami
// (headboard/frame). Null kapag wala.
export function lineColor(description: string | null | undefined): string | null {
  const m = /(?:^|\n)\s*[•·-]?\s*(?:fabric(?:\s*\/\s*finish)?|upholstered finish|color)\s*:\s*([^\n,(]+)/i.exec(String(description ?? ""));
  const v = m?.[1]?.trim() ?? "";
  return v || null;
}

// Ang inventory row ng isang SKU: SKU + kulay kapag may ganoong row, kung
// hindi ang pinakaunang row ng SKU (pinakamababang id). Null kapag wala.
export async function findInventoryRow<T extends { id: number }>(
  supabase: SupaClient,
  sku: string,
  color: string | null | undefined,
  select = "id",
): Promise<T | null> {
  const sk = String(sku ?? "").trim();
  if (!sk) return null;
  const { data } = await supabase.from("inventory").select(select).ilike("sku", sk).order("id", { ascending: true }).limit(50);
  const rows = ((data ?? []) as unknown as (T & { color?: string | null })[]);
  if (!rows.length) return null;
  const ck = String(color ?? "").trim().toLowerCase();
  if (ck) {
    const hit = rows.find((r) => String(r.color ?? "").trim().toLowerCase() === ck);
    if (hit) return hit;
  }
  return rows[0];
}

export async function applyInventory(
  supabase: SupaClient,
  items: OrderItem[],
  fn: "fn_inventory_reserve" | "fn_inventory_release" | "fn_inventory_ship",
  actor?: string | null,
  ref?: string | null, // ORD-/RMA- reference — isinusulat sa ledger users para makita ang katumbas na order
  label?: string | null, // ang unang bahagi ng users, binabasa ng ledger bilang CATEGORY (hal. "Delivered")
  specBySku?: Map<string, string[]>, // ang PINILING build kada SKU — tingnan ang specByItem
): Promise<boolean> {
  // For a ship (physical deduct) we also log an "out" movement to the Stock Movement
  // Ledger, so pull the extra product fields + current on-hand to write qty_before/after.
  const isShip = fn === "fn_inventory_ship";
  type InvRow = { id: number; sku: string | null; product_name: string | null; category?: string | null; color?: string | null; dimension?: string | null; oh_inv?: number | null };
  const { data } = isShip
    ? await supabase.from("inventory").select("id, sku, product_name, category, color, dimension, oh_inv")
    : await supabase.from("inventory").select("id, sku, product_name, color");
  // INVENTORY KADA KULAY (0232): ang linya ay tumutukoy sa row ng SKU + kulay
  // ("Fabric: Leather BE20457" sa description) kapag meron; kung wala, ang
  // pinakaunang row ng SKU (pinakamababang id) - ang lumang gawi. Pareho ng
  // fn_inventory_resync_reserved.
  const rows = ([...(data ?? [])] as InvRow[]).sort((a, b) => a.id - b.id);
  const bySku = new Map<string, number>();
  const bySkuColor = new Map<string, number>();
  const byName = new Map<string, number>();
  const rowById = new Map<number, InvRow>();
  for (const r of rows) {
    const sk = String(r.sku ?? "").trim().toLowerCase();
    if (sk) {
      if (!bySku.has(sk)) bySku.set(sk, r.id);
      const ck = `${sk}|${String((r as { color?: string | null }).color ?? "").trim().toLowerCase()}`;
      if (!bySkuColor.has(ck)) bySkuColor.set(ck, r.id);
    }
    const nk = String(r.product_name ?? "").toLowerCase();
    if (!byName.has(nk)) byName.set(nk, r.id);
    rowById.set(r.id, r);
  }

  const qtyById = new Map<number, number>();
  for (const it of items) {
    const q = Number(it.qty) || 0;
    if (q <= 0) continue;
    const name = (it.description || "").split("\n")[0].trim().toLowerCase();
    const sk = String(it.sku ?? "").trim().toLowerCase();
    const col = lineColor(it.description);
    const id =
      (sk && col ? bySkuColor.get(`${sk}|${col.toLowerCase()}`) : undefined) ??
      (sk ? bySku.get(sk) : undefined) ??
      (name ? byName.get(name) : undefined);
    if (id == null) continue;
    qtyById.set(id, (qtyById.get(id) ?? 0) + q);
  }

  const results = await Promise.all(
    [...qtyById].map(([id, q]) => supabase.rpc(fn, { p_id: id, p_qty: q })),
  );
  // PER-CUBIC (0199): sa pisikal na paglabas, bawasan din ang mga puwesto ng
  // SKU (FIFO) para hindi maglista ang mapa ng stock na wala na. Best-effort.
  if (isShip) {
    for (const [id, q] of qtyById) {
      const r = rowById.get(id);
      if (r?.sku) await consumePlacements(supabase, r.sku, q, null, (r as { color?: string | null }).color ?? null); // kada kulay (0235)
    }
  }
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    console.error(`applyInventory(${fn}): stock adjustment failed`, failed.map((r) => r.error?.message));
    return false;
  }

  // Ledger: one "out" row per shipped inventory row. Best-effort — a logging failure
  // must not fail the ship (stock is already deducted).
  if (isShip && qtyById.size) {
    try {
      const logs = [...qtyById].map(([id, q]) => {
        const r = rowById.get(id);
        const before = Number(r?.oh_inv ?? 0);
        const spec = specBySku?.get(String(r?.sku ?? "").trim().toLowerCase()) ?? [];
        return {
          product_name: r?.product_name ?? null,
          sku: r?.sku ?? null,
          // Kapag alam ang piniling build, iyon ang itinatala — hindi ang
          // category/color ng katalogo. Tingnan ang specByItem.
          category: spec[0] ?? r?.category ?? null,
          color: spec[1] ?? r?.color ?? null,
          dimension: spec[2] ?? r?.dimension ?? null,
          direction: "out",
          qty: q,
          qty_before: before,
          qty_after: Math.max(before - q, 0),
          users: `${label?.trim() || "Dispatch"} · ${actor?.trim() || "System"}${ref ? ` · ${ref}` : ""}`,
        };
      });
      await supabase.from("received_parts").insert(logs);
    } catch (e) {
      console.error("applyInventory: ledger log failed", e);
    }
  }
  // Stock ng website = stock ng inventory (kada kulay) — lib/web/stock.
  await syncWebStock(supabase, items.map((it) => it.sku));
  return true;
}

// ANG PINILI, HINDI ANG KATALOGO (2026-08-26).
//
// Ang SPECS ng Stock Movement Ledger ay dating hinuhugot sa product.specs, at
// iyon ang BUONG guided spec: lahat ng sukat, lahat ng presyo. Ang naihatid ay
// isa lang sa mga iyon. Kaya ang hilera ng ORD-000002 ay nagpapakita ng anim na
// sukat at anim na presyo gayong "Size: 36x75" lang ang binili.
//
// Ang piniling build ay nasa description ng line item, kaya doon kunin. Isang
// bullet kada linya, at ang naka-label lang ang spec — ang unang linya ay ang
// pangalan ng produkto, at nasa sariling hanay na iyon.
//
// Tatlo lang ang hanay, at ang isang upuan ay may anim na spec. Ang basta
// paggupit sa tatlo ay itinatapon ang huli, at doon nakaupo ang tela: ang
// "Upholstered Finish: Leather BE20357" ang mawawala at tatlong sukat ang
// matitira. Kaya ang labis ay isinisiksik sa pangatlong hanay — pinagdidikit
// ng ledger ang tatlo, kaya isang linya pa rin ang bawat spec sa pagbasa.
function orderedSpecLines(description: string | null | undefined): string[] {
  const all = String(description ?? "")
    .split("\n")
    .slice(1)
    .map((l) => l.trim().replace(/^[•·-]\s*/, ""))
    .filter((l) => l.includes(":"));
  return all.length > 3 ? [all[0], all[1], all.slice(2).join("\n")] : all;
}

// Ang piniling build kada SKU, para sa ledger. Ang unang tumugma ang panalo:
// ang parehong SKU nang dalawang beses sa isang order ay parehong produkto.
export function specByItem(items: OrderItem[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const it of items) {
    const key = String(it.sku ?? "").trim().toLowerCase();
    if (key && !m.has(key)) m.set(key, orderedSpecLines(it.description));
  }
  return m;
}

// At order commit we RESERVE (hold stock) — physical on-hand only drops later at
// stock-out. `deductInventory` keeps its name for the commit sites but reserves;
// `restoreInventory` releases; `shipInventory` is the physical deduction.
export const deductInventory = (supabase: SupaClient, items: OrderItem[]) => applyInventory(supabase, items, "fn_inventory_reserve");
export const restoreInventory = (supabase: SupaClient, items: OrderItem[]) => applyInventory(supabase, items, "fn_inventory_release");
export const shipInventory = (supabase: SupaClient, items: OrderItem[], actor?: string | null, ref?: string | null, label?: string | null, specBySku?: Map<string, string[]>) => applyInventory(supabase, items, "fn_inventory_ship", actor, ref, label, specBySku);

// PAGBABAGO NG LAMAN NG ISANG NAKA-RESERBA NANG ORDER.
//
// Dating walang ginagawa: `willDeduct = commit && !already` — kapag naka-reserba
// na ang order, `already` ay totoo, kaya ang idinagdag na item ay walang
// reserba. Lumalabas ito sa order pero nananatiling nabibenta sa iba, at
// walang nagpapakita niyon hangga't hindi nauubusan sa stock-out.
//
// Dito, ang IPINAGKAIBA lang ang kinikilos: ang dumami ay nirereserba, ang
// nabawasan ay ibinabalik. Ang hindi nagbago ay hindi ginagalaw — mahalaga
// iyon, dahil ang release-tapos-reserve ay magbubukas ng puwang kung saan
// mabibili ng iba ang kamang nasa workshop na.
export async function adjustInventory(
  supabase: SupaClient,
  before: OrderItem[],
  after: OrderItem[],
): Promise<boolean> {
  // Susi ang SKU kung meron, kung wala ay ang unang linya ng description —
  // EKSAKTONG panuntunan ng applyInventory. Kapag naiba ang susi rito,
  // magkaibang produkto ang ihahambing at magiging mali ang dami.
  // KULAY (0232): kasama sa susi ang tela ng linya - ang pagpapalit ng
  // Leather BE20357 → BE20457 sa parehong SKU ay paglabas sa isang row at
  // paglaan sa isa; dating netong zero kaya walang gumagalaw.
  const keyOf = (it: OrderItem) =>
    (it.sku ? `s:${it.sku.trim().toLowerCase()}|${(lineColor(it.description) ?? "").toLowerCase()}` : `n:${(it.description || "").split("\n")[0].trim().toLowerCase()}`);
  const tally = (items: OrderItem[]) => {
    const m = new Map<string, { qty: number; it: OrderItem }>();
    for (const it of items) {
      const q = Number(it.qty) || 0;
      if (q <= 0) continue;
      const k = keyOf(it);
      if (!k || k === "n:") continue;
      const cur = m.get(k);
      if (cur) cur.qty += q;
      else m.set(k, { qty: q, it });
    }
    return m;
  };
  const b = tally(before);
  const a = tally(after);

  const add: OrderItem[] = [];
  const drop: OrderItem[] = [];
  for (const [k, v] of a) {
    const d = v.qty - (b.get(k)?.qty ?? 0);
    if (d > 0) add.push({ ...v.it, qty: d });
  }
  for (const [k, v] of b) {
    const d = v.qty - (a.get(k)?.qty ?? 0);
    if (d > 0) drop.push({ ...v.it, qty: d });
  }

  let ok = true;
  if (drop.length) ok = (await restoreInventory(supabase, drop)) && ok;
  if (add.length) ok = (await deductInventory(supabase, add)) && ok;
  return ok;
}

// Self-healing: recompute reserved for every SKU from the source of truth (reserved =
// confirmed-but-not-shipped order lines). Call after any inventory-affecting change so
// the running counter can never drift. Best-effort — never throws (a resync failure
// must not break the action that triggered it). Requires migration 0124.
export async function resyncReserved(supabase: SupaClient): Promise<void> {
  try { await supabase.rpc("fn_inventory_resync_reserved"); } catch { /* best-effort */ }
  // Bumabago ang available ng bawat SKU dito — isulat sa website (kada kulay).
  await syncWebStock(supabase);
  // Sabay ang best sellers ng website (2026-09-04): parehong sandali na
  // gumagalaw ang order, parehong best-effort.
  await refreshBestSellers(supabase);
}

// ── PER-LINE NA ALAALA NG DEDUCTION (0225, 2026-09-01) ───────────────────────
// Aling linya ng order ang NABAWASAN NA sa stock. Tatlong site ang nagbabawas
// (QC-OUT ng skip line, Start Delivery, shipOnDelivered) — lahat sila ay
// nagbabasa at nagsusulat dito para (a) walang linyang mabawasan nang doble at
// (b) walang linyang mabawasan nang maaga sa partial delivery. `null` ang
// balik kapag hindi pa tumatakbo ang 0225 — senyas sa tumatawag na gamitin ang
// LUMANG buong-order na ugali nang eksakto (walang masisira pre-migration).
// KASAMA ANG KULAY (2026-09-06, lib/orders/line-key): "pangalan @ kulay" — ang
// kulay ay mula sa `color` ng linya o sa "• Fabric: …" bullet ng description.
// Ang mga lumang susi (pangalan lang) sa lines_shipped ay binabasa pa rin ng
// hasKey bilang tugma sa alinmang kulay.
export const lineKeyOf = (d: string | null | undefined, color?: string | null): string => lineKey(d, color);

export async function readLinesShipped(supabase: SupaClient, orderId: number): Promise<Set<string> | null> {
  try {
    const { data, error } = await supabase.from("orders").select("lines_shipped").eq("id", orderId).maybeSingle();
    if (error) return null;
    const arr = (data?.lines_shipped as unknown[] | null) ?? [];
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch { return null; }
}

export async function addLinesShipped(supabase: SupaClient, orderId: number, keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    const cur = await readLinesShipped(supabase, orderId);
    if (cur === null) return;
    for (const k of keys) if (k) cur.add(k);
    await supabase.from("orders").update({ lines_shipped: [...cur] }).eq("id", orderId);
  } catch { /* best-effort */ }
}

// ── ANG PAGHAHATID ANG NAGPAPALABAS NG STOCK (2026-08-26) ────────────────────
// Ang `inventory_shipped` ay itinatakda lang ng startDelivery ("Out for
// Delivery"). Pero may dalawang daanan papuntang "Delivered" na hindi dumadaan
// doon — ang pickup-proof sa mapa, at ang pagkumpleto ng installation — kaya
// nananatiling RESERVED ang stock ng order na naihatid at bayad na.
//
// Tatlong order ang naiwang ganoon: Completed, Delivered, reserved 1.
//
// Idempotent: kung na-ship na, walang ginagawa. Ligtas itong tawagin ng bawat
// daanan, at sa muling pagpindot.
export async function shipOnDelivered(
  supabase: SupaClient,
  orderId: number,
  actor?: string | null,
): Promise<void> {
  try {
    const { data } = await supabase.from("orders")
      .select("order_number, receipt_items, inventory_shipped, dq_items, status").eq("id", orderId).maybeSingle();
    // BUKAS NA PARTIAL AY TUMATAKBO KAHIT SHIPPED NA ANG STOCK (2026-09-01):
    // sa per-line na mundo, ang inventory_shipped ay maaaring maging totoo sa
    // huling QC-OUT scan — pero ang batch record at ang "Partial Delivery" →
    // "Delivered" na pagpapalit ay kailangan pa ring tumakbo sa Delivered. Ang
    // lines_shipped na sala sa ibaba ang pipigil sa dobleng bawas.
    const isOpenPartial = /partial delivery/i.test(String(data?.status ?? ""));
    if (!data || (data.inventory_shipped && !isOpenPartial)) return;
    const all = (data.receipt_items as OrderItem[] | null) ?? [];
    if (!all.length) return;
    const ref = (data.order_number as string | null) ?? null;
    const fl = (t: string | null | undefined) => String(t ?? "").split("\n")[0].trim().toLowerCase();
    const isFee = (d: string) => /^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test(d);

    // PARTIAL DELIVERY (0200): kapag may dq_items ang order, ang mga linyang
    // IYON lang ang naihatid ngayon — sila lang ang babawasan at itatala.
    const sel = Array.isArray(data.dq_items) && data.dq_items.length ? keySet(data.dq_items) : null;
    // IKALAWANG TAWAG NG PAREHONG BIYAHE (2026-09-02): ang pagka-Delivered ng
    // INSTALLATION ay tumatawag din dito — pero sa puntong iyon ay nilinis na
    // ang dq_items ng unang tawag (mula sa delivery) at naitala na ang batch.
    // Kung ipagpapatuloy, ang "items" ay ang BUONG order: maitatala ang
    // susunod na batch bilang naihatid at magsasara ang order nang maaga.
    // Bukas na partial + walang dq + may batch record na = tapos na ang
    // trabaho dito.
    if (isOpenPartial && !sel?.size) {
      try {
        const { count } = await supabase.from("order_line_deliveries").select("id", { count: "exact", head: true }).eq("order_id", orderId);
        if ((count ?? 0) > 0) return;
      } catch { /* wala pang 0200 — walang batch record na madadaganan */ }
    }
    const lk = (it: OrderItem) => lineKey(it.description, (it as { color?: string | null }).color);
    const items = sel?.size ? all.filter((it) => hasKey(sel, lk(it))) : all;
    if (!items.length) return;
    // PER-LINE NA SALA (0225): ang mga linyang nabawasan na (sa QC-OUT o sa
    // Start Delivery) ay hindi na ibabawas ulit dito. Kapag lahat ay bawas na,
    // laktawan ang ship pero TULOY ang batch record at status sa ibaba.
    const ls = await readLinesShipped(supabase, orderId);
    const toShip = ls === null ? items : items.filter((it) => { const k = fl(it.description); return !k || isFee(k) || !hasKey(ls, lk(it)); });
    if (toShip.length) {
      const ok = await shipInventory(
        supabase, toShip, actor ?? null, ref,
        "Delivered", specByItem(toShip),
      );
      if (!ok) return;
      await addLinesShipped(supabase, orderId, toShip.filter((it) => { const k = fl(it.description); return k && !isFee(k); }).map(lk));
    }

    // Itala ang mga linyang naihatid — ito ang alaala ng batch pagdating ng
    // susunod. Best-effort: wala pang 0200 → laktawan (buong order ang daloy).
    let remaining = 0;
    try {
      const { data: prior } = await supabase.from("order_line_deliveries").select("item_desc, batch_no").eq("order_id", orderId);
      const done = new Set(((prior ?? []) as { item_desc: string | null }[]).map((r) => lineKey(r.item_desc)).filter(Boolean));
      const batchNo = Math.max(0, ...((prior ?? []) as { batch_no: number | null }[]).map((r) => Number(r.batch_no) || 0)) + 1;
      const shippedLines = items.filter((it) => { const n = fl(it.description); return n && !isFee(n); });
      if (shippedLines.length) {
        await supabase.from("order_line_deliveries").insert(shippedLines.map((it) => ({
          order_id: orderId, order_number: ref,
          sku: it.sku ?? null, item_desc: String(it.description ?? ""),
          qty: Number(it.qty) || 1,
          unit_price: Number((it as { unitPrice?: number }).unitPrice) || null,
          batch_no: batchNo,
        })));
        for (const it of shippedLines) done.add(lk(it));
      }
      remaining = all.filter((it) => { const n = fl(it.description); return n && !isFee(n) && !(it as { constructorName?: string | null }).constructorName && !hasKey(done, lk(it)); }).length;
    } catch { remaining = 0; /* wala pang 0200 */ }

    if (remaining > 0) {
      // MAY NATITIRA PA: bukas pa ang order. Status "Partial Delivery", at
      // linisin ang selyo ng pila/ruta para makabalik ito sa Delivery Queue
      // pagkahanda ng susunod na batch. HINDI itinatakda ang inventory_shipped
      // — iyon ang selyo ng BUONG order.
      await supabase.from("orders").update({
        status: "Partial Delivery",
        dq_group: null, dq_status: null, dq_date: null, dq_team: null,
        dq_driver: null, dq_token: null, dq_sent_at: null, dq_items: null,
        dq_route_final_at: null,
      }).eq("id", orderId);
      // Linisin din ang selyo ng DELIVERY ROW — ang susunod na biyahe ay
      // gagamit ulit ng parehong row (repurpose) at kailangang makapag-deduct
      // nang normal ang Start Delivery nito.
      await supabase.from("deliveries").update({ inventory_shipped: false }).eq("order_id", orderId);
    } else {
      await supabase.from("orders").update({ inventory_shipped: true, ...(String(data.status ?? "").match(/partial delivery/i) ? { status: "Delivered" } : {}) }).eq("id", orderId);
      await supabase.from("deliveries").update({ inventory_shipped: true }).eq("order_id", orderId);
    }
    // Ang reserved ay kinukuwenta mula sa mga hindi pa naihahatid na order —
    // pagkatapos ng ship, dapat bumaba.
    await resyncReserved(supabase);
  } catch { /* best-effort: hindi dapat pumalya ang paghahatid dahil dito */ }
}
