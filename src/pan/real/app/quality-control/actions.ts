"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { findInventoryRow, lineColor } from "@/lib/orders/inventory";
import { syncWebStock, syncWebStockForRow } from "@/lib/web/stock";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { requireEdit } from "@/lib/auth/guard";
import { addPlacement, consumePlacements } from "@/lib/placements";

export type QcCheckpoint = "receive" | "prepack";
export type QcSource = "imported" | "workshop" | "order";

// Add received units to a purchase-order line and re-drive its PO status. Called when a
// QC receive fulfils an Incoming-PO line: bumps purchase_order_items.received_qty
// (clamped to the ordered qty), then recomputes purchase_orders.status from ALL of the
// PO's lines — every line fully received → "Received"; any received → "Partially
// Received"; else leave the ordering status as-is. Never overrides a Cancelled PO. This
// is the single source of truth the Incoming Shipment page + badge read.
async function receiveIntoPoLine(
  supabase: ReturnType<typeof createServerSupabase>,
  poItemId: number,
  addQty: number,
): Promise<void> {
  if (addQty <= 0) return;
  const { data: line } = await supabase
    .from("purchase_order_items")
    .select("id, po_id, qty, received_qty")
    .eq("id", poItemId)
    .maybeSingle();
  if (!line) return;
  const ordered = Number(line.qty) || 0;
  const nextReceived = ordered > 0 ? Math.min(Number(line.received_qty ?? 0) + addQty, ordered) : Number(line.received_qty ?? 0) + addQty;
  await supabase.from("purchase_order_items").update({ received_qty: nextReceived }).eq("id", poItemId);

  const poId = Number(line.po_id);
  if (!poId) return;
  const { data: all } = await supabase
    .from("purchase_order_items")
    .select("qty, received_qty")
    .eq("po_id", poId);
  const rows = (all ?? []) as { qty: number | null; received_qty: number | null }[];
  const withQty = rows.filter((r) => (Number(r.qty) || 0) > 0);
  const anyReceived = rows.some((r) => (Number(r.received_qty) || 0) > 0);
  const allReceived = withQty.length > 0 && withQty.every((r) => (Number(r.received_qty) || 0) >= (Number(r.qty) || 0));

  const { data: po } = await supabase.from("purchase_orders").select("status, po_number, supplier").eq("id", poId).maybeSingle();
  const cur = String(po?.status ?? "");
  if (/cancel/i.test(cur)) return; // never resurrect a cancelled PO
  const nextStatus = allReceived ? "Received" : anyReceived ? "Partially Received" : cur || "Ordered";
  if (nextStatus !== cur) {
    await supabase.from("purchase_orders").update({ status: nextStatus }).eq("id", poId);
    // Push Warehouse — a purchase order was fully received into stock.
    if (nextStatus === "Received") {
      try {
        const { notifyShipmentReceived } = await import("@/lib/push/notify");
        await notifyShipmentReceived({
          poNumber: (po?.po_number as string | undefined) ?? `PO-${poId}`,
          lines: `${withQty.length} of ${withQty.length} lines received`,
          supplier: (po?.supplier as string | undefined) ?? null,
        });
      } catch { /* best-effort */ }
    }
  }
}

// Physically ship an order's lines from stock (reserved − , on_hand − ) — used at
// the QC-for-OUT pass for a skipped line. Matches each line to an inventory row by
// SKU (else first line of the description) and calls fn_inventory_ship atomically.
// Returns true only if every matched RPC succeeded (so the caller can stamp
// inventory_shipped truthfully). Unmatched lines are skipped (not all lines are
// stocked) and don't count as failures.
async function shipOrderInventory(
  supabase: ReturnType<typeof createServerSupabase>,
  items: { qty: number; description: string; sku?: string | null }[],
  // Ang may-ari ng puwesto (0219): kapag ang order na ito ang lumalabas, ang
  // placement na nakapangalan dito ang unang kino-consume — hindi FIFO lang.
  preferOrderId?: number | null,
): Promise<boolean> {
  // INVENTORY KADA KULAY (0232): SKU + tela ng linya muna, tapos ang
  // pinakaunang row ng SKU - parehong panuntunan ng applyInventory.
  const { data } = await supabase.from("inventory").select("id, sku, product_name, color");
  const rows = ([...(data ?? [])] as { id: number; sku: string | null; product_name: string | null; color?: string | null }[]).sort((a, b) => a.id - b.id);
  const bySku = new Map<string, number>();
  const bySkuColor = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const r of rows) {
    const sk = String(r.sku ?? "").trim().toLowerCase();
    if (sk) {
      if (!bySku.has(sk)) bySku.set(sk, r.id);
      const ck = `${sk}|${String(r.color ?? "").trim().toLowerCase()}`;
      if (!bySkuColor.has(ck)) bySkuColor.set(ck, r.id);
    }
    const nk = String(r.product_name ?? "").toLowerCase();
    if (!byName.has(nk)) byName.set(nk, r.id);
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
  // Ship each matched line. Prefer the race-safe RPC; if fn_inventory_ship isn't in
  // the DB (schema not migrated / stale cache), fall back to a direct UPDATE so the
  // stock-out still works. The QC movement itself is recorded as a warehouse_qc row
  // (the Stock Movement Ledger derives QC in/out from warehouse_qc), so no separate
  // received_parts row is written here.
  const results = await Promise.all(
    [...qtyById].map(([id, q]) => shipOneRow(supabase, id, q)),
  );
  // PER-CUBIC (0199, itinama 2026-08-31): ang pangkalahatang ship
  // (applyInventory) ay nagbabawas na ng placements, pero ANG SARILING ship ng
  // QC-OUT ay hindi — kaya ang na-dispatch nang DINING-000001 ay nakalista pa
  // rin sa L10-A1 ng mapa kahit wala na sa istante. FIFO ang bawas, gaya ng
  // kapatid nitong daanan; best-effort.
  {
    const skuById = new Map<number, string>();
    const colorById = new Map<number, string | null>();
    for (const r of rows) if (r.sku) { skuById.set(r.id, r.sku); colorById.set(r.id, (r as { color?: string | null }).color ?? null); }
    for (const [id, q] of qtyById) {
      const sku = skuById.get(id);
      if (sku) await consumePlacements(supabase, sku, q, preferOrderId, colorById.get(id)); // kada kulay (0235)
    }
  }
  const failed = results.filter((ok) => !ok);
  if (failed.length) {
    console.error("shipOrderInventory: ship failed for", failed.length, "row(s)");
    return false;
  }
  return true;
}

// Ship a single inventory row by id (reserved − , oh_inv − ). Prefer the race-safe
// RPC fn_inventory_ship; on a schema-cache/missing-function error, fall back to a
// direct inventory UPDATE: reserved = max(reserved-qty,0), oh_inv = max(oh_inv-qty,0),
// available = max(oh_inv-reserved,0) recomputed, status recomputed (Out/Low/In).
async function shipOneRow(
  supabase: ReturnType<typeof createServerSupabase>,
  id: number,
  qty: number,
): Promise<boolean> {
  const { error: rpcErr } = await supabase.rpc("fn_inventory_ship", { p_id: id, p_qty: qty });
  if (!rpcErr) {
    // After the RPC updated the row, alert Warehouse if it just went Low/Out.
    try { const { maybeNotifyLowStock } = await import("@/lib/push/notify"); await maybeNotifyLowStock(supabase, id); } catch { /* best-effort */ }
    await syncWebStockForRow(supabase, id); // stock ng website, kada kulay
    return true;
  }
  // Fallback: read counters, deduct with floors, recompute derived fields.
  const { data: cur } = await supabase
    .from("inventory")
    .select("oh_inv, reserved")
    .eq("id", id)
    .maybeSingle();
  const oh = Number(cur?.oh_inv ?? 0);
  const reserved = Number(cur?.reserved ?? 0);
  const nextOh = Math.max(oh - qty, 0);
  const nextReserved = Math.max(reserved - qty, 0);
  const available = Math.max(nextOh - nextReserved, 0);
  const status = nextOh <= 0 ? "Out of stock" : nextOh <= 3 ? "Low stock" : "In stock";
  const { error: upErr } = await supabase
    .from("inventory")
    .update({ oh_inv: nextOh, reserved: nextReserved, available, status })
    .eq("id", id);
  if (upErr) {
    console.error("shipOneRow: fallback UPDATE failed", upErr.message);
    return false;
  }
  // Fallback path also alerts Warehouse if the SKU just went Low/Out.
  try { const { maybeNotifyLowStock } = await import("@/lib/push/notify"); await maybeNotifyLowStock(supabase, id); } catch { /* best-effort */ }
  await syncWebStockForRow(supabase, id); // stock ng website, kada kulay
  return true;
}

export type QcSubmitInput = {
  checkpoint: QcCheckpoint;
  source: QcSource;
  ref_id?: number | null;
  ref_label?: string | null;
  job_id?: number | null;          // workshop_job to stamp qc_received_at on a receive pass
  sku?: string | null;
  product_name?: string | null;
  category?: string | null;
  color?: string | null;
  dimension?: string | null;
  image_url?: string | null;   // catalog photo (studio white-bg) for a new item's product
  qty: number;
  good_qty: number;
  defect_qty: number;
  result: "pass" | "fail";
  photos: string[];
  remarks?: string | null;
  // New-item entry: when the arriving item has no product/inventory record yet,
  // pass is_new=true so a PASS auto-creates the product + inventory row, then stocks in.
  is_new?: boolean;
  product_type?: string | null; // Local | Imported (New Item modal 2026-08-18)
  unit_cost?: number | null;   // cost for a newly-created product (defaults 0)
  specs?: string | null;       // Specifications / design details (bagong format 2026-08-18)
  location?: string | null;            // Rak # to stock the item into (Rak-01, …)
  warehouse_location?: string | null;  // Zone # (Zone A, …)
  // Incoming-PO receiving: the PO line this receive fulfils. On stock-in the good units
  // bump purchase_order_items.received_qty and re-drive the PO status + Incoming progress.
  po_item_id?: number | null;
};

// Record a QC inspection. On a RECEIVE-pass, post the good units to inventory
// (stock-in) and log the movement; the defective units are written off as loss.
// On a RECEIVE-fail (or any fail), record the whole qty as a defect write-off.
// PRE-PACK QC just records the verdict (no stock movement).
export async function submitQc(
  input: QcSubmitInput,
): Promise<{ ok: true; id: number; label_sku: string | null } | { error: string }> {
  const me = await requireEdit("/quality-control", "wh_qc");
  const supabase = createServerSupabase();
  // The barcode value to print on the stock label. For a new item with no SKU we
  // auto-generate a unique PF-<id> below and return it so the client can print it.
  let labelSku: string | null = input.sku?.trim() || null;

  const qty = Math.max(0, Math.floor(Number(input.qty) || 0));
  if (qty <= 0) return { error: "Enter a quantity (> 0)." };
  if (input.photos.length < 1) return { error: "Add at least one photo as proof." };

  const goodQty = Math.max(0, Math.min(qty, Math.floor(Number(input.good_qty) || 0)));
  const defectQty = Math.max(0, Math.min(qty, Math.floor(Number(input.defect_qty) || 0)));
  if (input.result === "pass" && goodQty <= 0) {
    return { error: "A pass needs at least 1 good unit." };
  }

  // Resolve product cost for any write-off (by exact SKU).
  let unitCost = 0;
  if (input.sku) {
    const prod = (await supabase.from("product").select("cost").eq("sku", input.sku).limit(1)).data?.[0] as
      { cost: number | null } | undefined;
    unitCost = Number(prod?.cost ?? 0) || 0;
  }

  // Insert the QC record first (the source of truth for history + realtime).
  const { data: ins, error } = await supabase
    .from("warehouse_qc")
    .insert({
      checkpoint: input.checkpoint,
      source: input.source,
      ref_id: input.ref_id ?? null,
      ref_label: input.ref_label?.trim() || null,
      sku: input.sku?.trim() || null,
      product_name: input.product_name?.trim() || null,
      category: input.category?.trim() || null,
      color: input.color?.trim() || null,
      dimension: input.dimension?.trim() || null,
      qty,
      good_qty: goodQty,
      defect_qty: defectQty,
      result: input.result,
      photos: input.photos,
      remarks: input.remarks?.trim() || null,
      checked_by: me.full_name,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  const qcId = ins!.id as number;

  // NOTE: RECEIVE-PASS stock-in is no longer done here. The QC IN flow is now split
  // into reserveQcIn (create record + label) → scan the printed QC-PASSED IN label →
  // finishQcInStockIn (the actual stock-in). submitQc only ever gets result="fail"
  // from the UI now, so the old pass stock-in block was dead and has been removed to
  // eliminate any double-count path. Same for prepack-OUT ship (see below).

  // ── DEFECT WRITE-OFF: record the defective units (fail = whole qty; pass = the
  //    defect_qty portion) as a countable loss, tied to the QC record. ──
  const scrap = input.result === "fail" ? qty : defectQty;
  if (scrap > 0) {
    const loss = Math.round(scrap * unitCost * 100) / 100;
    const { data: wo } = await supabase.from("defect_writeoffs").insert({
      return_id: null,
      return_no: `QC-${qcId}`,
      sku: input.sku?.trim() || null,
      product_name: input.product_name?.trim() || null,
      item_desc: input.product_name?.trim() || null,
      qty: scrap,
      unit_cost: unitCost,
      loss_amount: loss,
      reason: input.remarks?.trim() || `Failed warehouse QC (${input.checkpoint})`,
      written_off_by: me.full_name,
    }).select("id").single();
    if (wo?.id) await supabase.from("warehouse_qc").update({ writeoff_id: wo.id }).eq("id", qcId);
  }

  // Stamp the workshop job so it leaves the Receiving QC queue (idempotent), and
  // advance its lifecycle: passed receiving → "Received" (in warehouse stock),
  // failed → "QC Failed" (back to the workshop / for rework).
  if (input.checkpoint === "receive" && input.job_id) {
    await supabase.from("workshop_job").update({
      qc_received_at: new Date().toISOString(),
      status: input.result === "pass" ? "Received" : "QC Failed",
      updated_at: new Date().toISOString(),
    }).eq("id", input.job_id);
  }

  // NOTE: prepack-OUT ship (deduct on-hand + advance to "For Delivery") is no longer
  // done here — it moved to finishQcOutShip, run only after the QC-PASSED OUT label is
  // scanned. submitQc handles fails only now, so this pass block was dead + removed.

  await auditAfter({ module: "wh_qc", table: "warehouse_qc", recordId: qcId, action: "insert", snapshotTable: "warehouse_qc", snapshotId: qcId });
  revalidatePath("/quality-control");
  revalidatePath("/inventory");
  revalidatePath("/stock-movements");
  revalidatePath("/workshop");
  // A new item auto-creates a product/category → refresh the whole app so it shows
  // up everywhere (Sales create-order, scan, other category pickers).
  revalidatePath("/", "layout");
  return { ok: true, id: qcId, label_sku: labelSku };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPLIT QC-IN FLOW (print-before-stock-in)
//
// The single-call submitQc() stocks in immediately, so the label had to be
// printed with a placeholder before the real QC-<id> existed. These two additive
// actions split the RECEIVE-pass happy path into:
//   STEP A  reserveQcIn()        — create the QC record + (for a new item) the
//                                  inventory row + SKU + catalog product, so the
//                                  label can be printed with a FINAL QC-<id> and
//                                  a FINAL SKU. No physical stock movement yet.
//   STEP B  finishQcInStockIn()  — after the printed label is scanned back and
//                                  verified, perform ONLY the physical stock-in
//                                  for that already-created QC record.
// submitQc() is left untouched for every other path (QC OUT/prepack, workshop
// receive, fail/defect). Only the QC-IN happy path in the UI switches to these.
// ─────────────────────────────────────────────────────────────────────────────

// Row shape shared by the reserve/finish inventory lookups (mirrors submitQc).
type QcInvRow = {
  id: number;
  product_name: string | null;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  oh_inv: number | null;
};

// Pag nag-Print ULIT para sa parehong item nang hindi natapos ang scan (hal.
// hindi mabasa ang lumang label), ang mga naunang HINDI-natapos na reservation
// (stocked_at null) ay binubura — para hindi dumami ang "awaiting scan" rows sa
// Browse; iisang buhay na reservation lang bawat item ang natitira.
async function voidStaleReservations(
  supabase: ReturnType<typeof createServerSupabase>,
  scope: { checkpoint: string; source: string; ref_id: number | null; sku?: string | null; product_name?: string | null },
): Promise<void> {
  const sku = scope.sku?.trim() || null;
  const pname = scope.product_name?.trim() || null;
  if (!sku && !pname) return; // walang maaasahang scope — huwag mag-delete
  let q = supabase.from("warehouse_qc").delete()
    .eq("checkpoint", scope.checkpoint)
    .eq("source", scope.source)
    .eq("result", "pass")
    .is("stocked_at", null);
  if (scope.ref_id != null) q = q.eq("ref_id", scope.ref_id);
  if (sku) q = q.eq("sku", sku); else if (pname) q = q.eq("product_name", pname);
  await q;
}

// STEP A — Print. Everything submitQc does for a receive-pass EXCEPT the physical
// stock-in: insert the warehouse_qc record (result "pass"), and for a brand-new
// item auto-create the inventory row + SKU (PF-<inventory id> when none typed) +
// catalog product. Returns the QC id (printed as QC-<id>) and the FINAL label SKU
// so the printed barcode is correct and will resolve at stock-in time.
// NOTE: no fn_inventory_receive, no received_parts, no stocked_at stamp here.
export async function reserveQcIn(
  input: QcSubmitInput,
): Promise<{ ok: true; id: number; label_sku: string | null } | { error: string }> {
  const me = await requireEdit("/quality-control", "wh_qc");
  const supabase = createServerSupabase();
  // Barcode value to print on the stock label. For a new item with no SKU we
  // auto-generate a unique PF-<id> below and return it so the client prints it.
  let labelSku: string | null = input.sku?.trim() || null;

  const qty = Math.max(0, Math.floor(Number(input.qty) || 0));
  if (qty <= 0) return { error: "Enter a quantity (> 0)." };
  if (input.photos.length < 1) return { error: "Add at least one photo as proof." };

  const goodQty = Math.max(0, Math.min(qty, Math.floor(Number(input.good_qty) || 0)));
  const defectQty = Math.max(0, Math.min(qty, Math.floor(Number(input.defect_qty) || 0)));
  if (goodQty <= 0) return { error: "A pass needs at least 1 good unit." };

  // Resolve product cost (by exact SKU) so the auto-created product carries a cost.
  let unitCost = 0;
  if (input.sku) {
    const prod = (await supabase.from("product").select("cost").eq("sku", input.sku).limit(1)).data?.[0] as
      { cost: number | null } | undefined;
    unitCost = Number(prod?.cost ?? 0) || 0;
  }

  // Linisin muna ang mga naunang hindi-natapos na reservation ng parehong item.
  await voidStaleReservations(supabase, {
    checkpoint: input.checkpoint, source: input.source, ref_id: input.ref_id ?? null,
    sku: input.sku, product_name: input.product_name,
  });

  // Insert the QC record first — this id is the QC-<id> printed on the label.
  const { data: ins, error } = await supabase
    .from("warehouse_qc")
    .insert({
      checkpoint: input.checkpoint,
      source: input.source,
      ref_id: input.ref_id ?? null,
      ref_label: input.ref_label?.trim() || null,
      sku: input.sku?.trim() || null,
      product_name: input.product_name?.trim() || null,
      category: input.category?.trim() || null,
      color: input.color?.trim() || null,
      dimension: input.dimension?.trim() || null,
      qty,
      good_qty: goodQty,
      defect_qty: defectQty,
      result: "pass",
      photos: input.photos,
      remarks: input.remarks?.trim() || null,
      checked_by: me.full_name,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  const qcId = ins!.id as number;

  // For a brand-new item (no matching inventory row): auto-create the inventory
  // row + unique SKU + catalog product — EXACTLY as submitQc does — so the printed
  // barcode/SKU is final. No stock movement happens here (that's STEP B).
  // INVENTORY KADA KULAY (0232): ang row ng SKU + kulay ng unit kapag meron.
  let invRow = input.sku
    ? ((await findInventoryRow<QcInvRow>(supabase, input.sku, input.color, "id, product_name, sku, category, color, dimension, oh_inv")) ?? undefined)
    : undefined;

  if (!invRow) {
    const { data: created } = await supabase.from("inventory").insert({
      product_name: input.product_name?.trim() || input.sku || "New item",
      sku: input.sku?.trim() || null,
      category: input.category?.trim() || null, color: input.color?.trim() || null,
      dimension: input.dimension?.trim() || null, oh_inv: 0, status: "In stock",
      location: input.location?.trim() || null,
      warehouse_location: input.warehouse_location?.trim() || null,
    }).select("id, product_name, sku, category, color, dimension, oh_inv").single();
    invRow = (created as QcInvRow) ?? undefined;

    if (invRow) {
      // Unique SKU: use the typed one, else auto-generate PF-<inventory id>.
      const finalSku = (input.sku?.trim() || `PF-${invRow.id}`);
      labelSku = finalSku;
      if (!input.sku?.trim()) {
        await supabase.from("inventory").update({ sku: finalSku }).eq("id", invRow.id);
        invRow = { ...invRow, sku: finalSku };
      }
      await audit({ module: "wh_qc", table: "inventory", recordId: invRow.id, action: "insert", after: { sku: finalSku, name: input.product_name, via: "qc_new_item" } });

      // Create the catalog product for this SKU if it doesn't exist yet.
      const existingProd = (await supabase.from("product").select("id").eq("sku", finalSku).limit(1)).data?.[0];
      if (!existingProd) {
        await supabase.from("product").insert({
          product_name: input.product_name?.trim() || finalSku,
          sku: finalSku, barcode: finalSku,
          category: input.category?.trim() || null, color: input.color?.trim() || null,
          dimension: input.dimension?.trim() || null,
          image_url: input.image_url?.trim() || null,
          cost: Number(input.unit_cost ?? unitCost) || 0, price: 0, status: "active",
          product_type: input.product_type || "Local",
        });
        // SPECS — hiwalay na best-effort update (0166): kapag wala pa ang
        // column, tahimik na laktawan para tuloy pa rin ang stock-in.
        if (input.specs?.trim()) {
          try { await supabase.from("product").update({ specs: input.specs.trim() }).eq("sku", finalSku); } catch { /* wala pang 0166 */ }
        }
        await audit({ module: "wh_qc", table: "product", recordId: finalSku, action: "insert", after: { sku: finalSku, name: input.product_name, via: "qc_new_item" } });
      }
    }
  } else {
    // Existing item: the label SKU is simply the resolved row's SKU.
    labelSku = invRow.sku ?? labelSku;
  }

  // Record the QC insert in the audit log (mirrors submitQc), then revalidate the
  // views a new product/inventory row shows up in. Stock movements are NOT touched
  // here, so /stock-movements is intentionally left for STEP B.
  await auditAfter({ module: "wh_qc", table: "warehouse_qc", recordId: qcId, action: "insert", snapshotTable: "warehouse_qc", snapshotId: qcId });
  revalidatePath("/quality-control");
  revalidatePath("/inventory");
  // A new item auto-creates a product/category → refresh the whole app so it shows
  // up everywhere (Sales create-order, scan, other category pickers).
  revalidatePath("/", "layout");
  return { ok: true, id: qcId, label_sku: labelSku };
}

// STEP B — Stock-in. Performs ONLY the physical stock-in for a QC record already
// created by reserveQcIn(): resolve the inventory row by the FINAL printed SKU,
// receive good_qty via fn_inventory_receive, log the received_parts movement, and
// stamp warehouse_qc.stocked_at. Idempotent: if stocked_at is already set, do
// nothing — a double-scan can't double-stock.
export async function finishQcInStockIn(
  input: { qc_id: number; sku: string; location?: string | null; warehouse_location?: string | null; good_qty: number; po_item_id?: number | null },
): Promise<{ ok: true; id: number } | { error: string }> {
  const me = await requireEdit("/quality-control", "wh_qc");
  const supabase = createServerSupabase();

  const qcId = Math.floor(Number(input.qc_id) || 0);
  if (qcId <= 0) return { error: "Missing QC id." };
  const sku = (input.sku ?? "").trim();
  if (!sku) return { error: "Missing SKU." };
  const goodQty = Math.max(0, Math.floor(Number(input.good_qty) || 0));
  if (goodQty <= 0) return { error: "A stock-in needs at least 1 good unit." };

  // Idempotency guard: if this QC record was already stocked in, do nothing so a
  // double-scan can't double-stock the same units.
  const { data: qcRow, error: qcErr } = await supabase
    .from("warehouse_qc")
    .select("id, stocked_at, checkpoint, source, ref_id, color")
    .eq("id", qcId)
    .maybeSingle();
  if (qcErr) return { error: qcErr.message };
  if (!qcRow) return { error: "QC record not found." };
  if (qcRow.stocked_at) return { ok: true, id: qcId };

  // Resolve the inventory row by the FINAL printed SKU — the same SKU the reserve
  // step settled on (typed SKU or auto-generated PF-<id>).
  // INVENTORY KADA KULAY (0232): ang kulay ng QC record (itinala sa STEP A).
  const invRow = (await findInventoryRow<QcInvRow>(supabase, sku, (qcRow as { color?: string | null }).color, "id, product_name, sku, category, color, dimension, oh_inv")) ?? undefined;
  if (!invRow) return { error: `No inventory row for SKU ${sku}.` };

  // Physical stock-in. Prefer the race-safe RPC; if that function isn't in the DB
  // (schema not migrated / stale cache), fall back to a direct UPDATE so stock-in
  // still works. The direct path recomputes oh_inv/available/status inline.
  const before = Number(invRow.oh_inv ?? 0);
  const { error: rpcErr } = await supabase.rpc("fn_inventory_receive", { p_id: invRow.id, p_qty: goodQty });
  if (rpcErr) {
    const next = before + goodQty;
    const status = next <= 0 ? "Out of stock" : next <= 3 ? "Low stock" : "In stock";
    const { data: cur } = await supabase.from("inventory").select("reserved").eq("id", invRow.id).maybeSingle();
    const reserved = Number(cur?.reserved ?? 0);
    const { error: upErr } = await supabase.from("inventory")
      .update({ oh_inv: next, available: Math.max(next - reserved, 0), status })
      .eq("id", invRow.id);
    if (upErr) return { error: upErr.message };
  }
  await syncWebStock(supabase, [sku]); // stock ng website, kada kulay

  // ANG STOCK-IN AY HINDI NAGLILIPAT NG LUMANG BUNTON (2026-08-31, hiling ni
  // Joe). Ang inventory.location ay ang tahanan ng BUONG SKU na walang
  // placements — nang i-in ang ISANG inayos na unit sa L10-A1, napalitan ito
  // at ang 114 na lumang stock ay "lumipat" sa mapa nang walang gumagalaw sa
  // totoong istante. Ang cubic ng bagong batch ay dala na ng placement sa
  // ibaba; ang inventory.location ay tinatatakan na lang kapag BLANGKO pa —
  // ang unang tahanan ng isang SKU na wala pang kahit ano.
  {
    const { data: locRow } = await supabase.from("inventory")
      .select("location, warehouse_location").eq("id", invRow.id).maybeSingle();
    const patch: { location?: string; warehouse_location?: string } = {};
    // KAPAG KUMPLETO LANG ANG PUWESTO (Joe 2026-09-06, "bakit dalawa ung na-in
    // pero 1 lang naman"): ang inventory.location ang tumatanggap ng LABIS na
    // walang puwesto (spill rule ng loader). Kung may hilerang hindi pa
    // nailalagay (22 on hand, 21 ang naka-cubic) at itatatak dito ang cubic ng
    // bagong batch, ang labis na 1 ay biglang "nasa" L19-A1 — 2 ang lalabas
    // kahit 1 lang ang pinasok. Itatak lang kapag ang mga puwesto (kasama ang
    // idadagdag sa ibaba) ay sasakupin na ang buong on-hand; kung hindi, ang
    // hindi pa nailalagay ay nananatiling Needs a location.
    let placementsComplete = true;
    try {
      const rowColor = String((invRow as { color?: string | null }).color ?? "").trim();
      let plq = supabase.from("stock_placements").select("qty").eq("sku", sku);
      if (rowColor) plq = plq.ilike("color", rowColor);
      let { data: pls, error: plErr } = await plq;
      if (plErr) ({ data: pls } = await supabase.from("stock_placements").select("qty").eq("sku", sku)); // bago ang 0235
      const placed = ((pls ?? []) as { qty: number | null }[]).reduce((a2, p) => a2 + (Number(p.qty) || 0), 0);
      placementsComplete = placed >= before; // placed + goodQty >= before + goodQty
    } catch { /* wala pang 0199 — walang placements, buong SKU ang location */ }
    if (input.location?.trim() && !locRow?.location?.trim() && placementsComplete) patch.location = input.location.trim();
    if (input.warehouse_location?.trim() && !locRow?.warehouse_location?.trim()) patch.warehouse_location = input.warehouse_location.trim();
    if (Object.keys(patch).length) await supabase.from("inventory").update(patch).eq("id", invRow.id);
  }
  // PER-CUBIC (0199): ang batch na ito ay IDINADAGDAG sa piniling cubic nang
  // hindi ginagalaw ang ibang puwesto ng SKU — ang bed na nasa L1-A1 na hindi
  // na kasya ay pumupunta sa L3-A1, at pareho silang nasa mapa. (Ang
  // inventory.location sa itaas ay nananatili bilang pambalik ng mga SKU na
  // walang placements.)
  //
  // ANG MAY-ARI NG CUBIC (0219): kapag galing sa workshop job na may order,
  // ang Order # ay nakadikit sa mismong puwestong ito — sa cubic modal, ang
  // bagong unit sa L10-A1 ang may pangalan ng customer, hindi ang lumang
  // bunton sa L1-A1.
  if (input.location?.trim()) {
    let ownerOrderId: number | null = null;
    if (qcRow.checkpoint === "receive" && qcRow.source === "workshop" && qcRow.ref_id) {
      const { data: ownJob } = await supabase.from("workshop_job").select("order_id").eq("id", qcRow.ref_id).maybeSingle();
      ownerOrderId = (ownJob?.order_id as number | null) ?? null;
    }
    // ANG KULAY NG INVENTORY ROW, HINDI NG QC RECORD (2026-09-06): ang puwesto ay
    // nakakabit sa hilerang tinaasan ng stock — kapag walang kulay ang hilera
    // (lumang SKU), walang kulay din ang puwesto; kung hindi, hindi ito
    // matatagpuan ng mapa at bumabagsak ang buong SKU sa inventory.location.
    await addPlacement(supabase, sku, input.location.trim(), goodQty, ownerOrderId, (invRow as { color?: string | null }).color ?? null); // kada kulay (0235)
  }
  // Stamp the QC record shipped-in. The Stock Movement Ledger derives this IN movement
  // from the warehouse_qc record (checkpoint 'receive', stocked_at set) — no separate
  // received_parts row is written, so there's no double-count.
  await supabase.from("warehouse_qc").update({ stocked_at: new Date().toISOString() }).eq("id", qcId);
  await audit({ module: "wh_qc", table: "warehouse_qc", recordId: qcId, action: "update", after: { stockIn: goodQty, sku, location: input.location ?? null } });
  void before;

  // Workshop receive: the two-step Print→Scan flow must ALSO stamp the workshop
  // job (as submitQc does), or the job stays in the Receiving QC queue forever
  // and can be stocked-in repeatedly. ref_id = workshop_job.id for source
  // 'workshop' receives.
  if (qcRow.checkpoint === "receive" && qcRow.source === "workshop" && qcRow.ref_id) {
    const { data: jobRow } = await supabase.from("workshop_job")
      .update({ qc_received_at: new Date().toISOString(), status: "Received", updated_at: new Date().toISOString() })
      .eq("id", qcRow.ref_id).select("order_id").maybeSingle();
    // REWORK na dumaan sa warehouse: pagkatapos ma-receive, awtomatikong bumalik
    // ang order sa Delivery Queue para sa redelivery confirmation + routing.
    if (jobRow?.order_id != null) {
      const { autoRedeliverRework } = await import("@/lib/returns/redeliver");
      await autoRedeliverRework(Number(jobRow.order_id));
    }
    // REFUND PULL-OUT: DITO NAGTATAPOS (2026-09-01). Ang stock-in ng
    // double-check na unit ang selyo — sarado ang RMA (Completed + reworked_at),
    // ang pickup na deliveries row nito ay tapos na (Delivered), at ang dq_* ng
    // order ay nililinis para walang maiwan sa planner. Best-effort lahat: ang
    // stock-in mismo ay nangyari na, at hindi ito dapat mabigo dahil dito.
    try {
      const { data: refRets } = await supabase.from("returns")
        .select("id, order_id")
        .eq("rework_job_id", qcRow.ref_id)
        .eq("resolution", "refund")
        .eq("status", "Rework")
        .is("reworked_at", null)
        .limit(1);
      const refRet = refRets?.[0] as { id: number; order_id: number | null } | undefined;
      if (refRet) {
        await supabase.from("returns").update({
          status: "Completed",
          reworked_at: new Date().toISOString(),
          notes: "Refund pull-out double-checked and re-stocked at Receiving QC — back in free stock. Refund was posted at approval.",
        }).eq("id", refRet.id);
        try {
          await supabase.from("deliveries").update({ status: "Delivered", delivered_at: new Date().toISOString() })
            .eq("return_id", refRet.id).in("status", ["Scheduled", "Packed"]);
        } catch { /* wala pang 0205 o walang row — ok lang */ }
        if (refRet.order_id != null) {
          await supabase.from("orders").update({
            dq_status: null, dq_group: null, dq_date: null, dq_team: null, dq_driver: null,
            dq_sent_at: null, dq_confirmed_at: null, dq_reminder_sent_at: null, dq_followups: 0,
          }).eq("id", refRet.order_id);
        }
        revalidatePath("/returns");
      }
    } catch { /* best-effort */ }
  }

  // Incoming-PO receiving link: if this QC receive fulfils a PO line, bump that line's
  // received_qty and re-drive the PO status (Ordered → Partially Received → Received),
  // which is what the Incoming Shipment page + badge read. Best-effort — a link failure
  // must not fail the stock-in that already happened.
  if (input.po_item_id) {
    await receiveIntoPoLine(supabase, input.po_item_id, goodQty);
    revalidatePath("/incoming");
    revalidatePath("/purchase-orders");
  }

  revalidatePath("/inventory");
  revalidatePath("/inventory/adjustments");
  revalidatePath("/stock-movements");
  revalidatePath("/scan");
  revalidatePath("/quality-control");
  revalidatePath("/workshop/quality-control");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/products");
  revalidatePath("/locations");
  return { ok: true, id: qcId };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPLIT QC-OUT (dispatch) FLOW (print-before-stock-out)
//
// The old inline QC-OUT path lived in submitQc() and shipped stock the instant the
// QC passed, so the OUT label had to be printed before a real QC-<id> existed.
// These two additive actions mirror the QC-IN split (reserveQcIn + finishQcInStockIn):
//   STEP A  reserveQcOut()     — insert the warehouse_qc record (checkpoint
//                                "prepack", source "order", result "pass") and
//                                return its id so the OUT label can be printed with
//                                a FINAL QC-<id>. No ship/deduct, no status change.
//   STEP B  finishQcOutShip()  — after the printed OUT label is scanned back and
//                                verified, physically deduct on-hand for the order's
//                                lines, stamp inventory_shipped, advance the order to
//                                "For Delivery", and stamp warehouse_qc.stocked_at.
// submitQc()'s inline QC-OUT block is left intact (it just won't be triggered from
// the UI anymore); every other submitQc path is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

// STEP A — Print. Insert the QC record for a QC-OUT (dispatch) pass so the OUT
// label can be printed with a FINAL QC-<id>. Does NOT ship/deduct on-hand and does
// NOT change the order status — that all happens in STEP B after the scan verifies.
// Returns the QC id (printed as QC-<id>) and the label SKU (the scanned SKU).
export async function reserveQcOut(
  input: QcSubmitInput,
): Promise<{ ok: true; id: number; label_sku: string | null } | { error: string }> {
  const me = await requireEdit("/quality-control", "wh_qc");
  const supabase = createServerSupabase();
  const qty = Math.max(0, Math.floor(Number(input.qty) || 0));
  if (qty <= 0) return { error: "Enter a quantity (> 0)." };
  if (input.photos.length < 1) return { error: "Add at least one photo as proof." };

  const goodQty = Math.max(0, Math.min(qty, Math.floor(Number(input.good_qty) || 0)));
  const defectQty = Math.max(0, Math.min(qty, Math.floor(Number(input.defect_qty) || 0)));
  if (goodQty <= 0) return { error: "A pass needs at least 1 good unit." };

  // Linisin muna ang mga naunang hindi-natapos na OUT reservation ng parehong item.
  await voidStaleReservations(supabase, {
    checkpoint: "prepack", source: input.source, ref_id: input.ref_id ?? null,
    sku: input.sku, product_name: input.product_name,
  });

  // Insert the QC record — this id is the QC-<id> printed on the OUT label. Force
  // the QC-OUT shape (prepack / order / pass) so the record is unambiguous.
  const { data: ins, error } = await supabase
    .from("warehouse_qc")
    .insert({
      checkpoint: "prepack",
      source: "order",
      ref_id: input.ref_id ?? null,
      ref_label: input.ref_label?.trim() || null,
      sku: input.sku?.trim() || null,
      product_name: input.product_name?.trim() || null,
      category: input.category?.trim() || null,
      color: input.color?.trim() || null,
      dimension: input.dimension?.trim() || null,
      qty,
      good_qty: goodQty,
      defect_qty: defectQty,
      result: "pass",
      photos: input.photos,
      remarks: input.remarks?.trim() || null,
      checked_by: me.full_name,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  const qcId = ins!.id as number;

  // Barcode value printed on the OUT label + matched back on scan — MUST equal the
  // exact value printQcPassedLabels renders as the barcode: sku → QC-<id> ref. We
  // deliberately do NOT fall back to the product name (a long name makes an unscannable
  // Code128). The short QC ref is always present and unique, so an OUT line with no SKU
  // (e.g. Direct-Stock) still prints a scannable barcode that matches the reserved record.
  const labelSku: string = input.sku?.trim() || `QC-${String(qcId).padStart(5, "0")}`;

  // Record the QC insert in the audit log (mirrors reserveQcIn), then revalidate the
  // QC view. No stock movement / order status change happens here (that's STEP B).
  await auditAfter({ module: "wh_qc", table: "warehouse_qc", recordId: qcId, action: "insert", snapshotTable: "warehouse_qc", snapshotId: qcId });
  revalidatePath("/quality-control");
  revalidatePath("/workshop/quality-control");
  return { ok: true, id: qcId, label_sku: labelSku };
}

// STEP B — Ship. Performs ONLY the physical stock-out for a QC-OUT record already
// created by reserveQcOut(): deduct on-hand for the order's receipt_items, stamp
// orders.inventory_shipped, advance the order to "For Delivery" (guarded), and
// stamp warehouse_qc.stocked_at. Idempotent: if orders.inventory_shipped is already
// true, do nothing except return ok — a double-scan can't double-deduct.
export async function finishQcOutShip(
  input: { qc_id: number; order_id: number; good_qty?: number },
): Promise<{ ok: true; id: number } | { error: string }> {
  const me = await requireEdit("/quality-control", "wh_qc");
  const supabase = createServerSupabase();

  const qcId = Math.floor(Number(input.qc_id) || 0);
  if (qcId <= 0) return { error: "Missing QC id." };
  const orderId = Math.floor(Number(input.order_id) || 0);

  // DIRECT-STOCK OUT (no order): a walk-in / manual dispatch that isn't tied to a
  // sales order. There are no receipt_items to ship, so deduct the QC record's own
  // SKU by its good_qty, log the ledger movement, and stamp the record shipped.
  if (orderId <= 0) {
    const { data: rec, error: recErr } = await supabase
      .from("warehouse_qc")
      .select("sku, good_qty, product_name, stocked_at")
      .eq("id", qcId)
      .maybeSingle();
    if (recErr) return { error: recErr.message };
    if (!rec) return { error: "QC record not found." };
    if (rec.stocked_at) return { ok: true, id: qcId }; // already shipped — idempotent
    const shipQty = Math.max(0, Math.floor(Number(rec.good_qty) || 0));
    if (shipQty > 0) {
      await shipOrderInventory(
        supabase,
        [{ qty: shipQty, description: rec.product_name ?? "", sku: rec.sku ?? null }],
      );
    }
    await supabase.from("warehouse_qc").update({ stocked_at: new Date().toISOString() }).eq("id", qcId);
    revalidatePath("/inventory");
    revalidatePath("/inventory/adjustments");
    revalidatePath("/scan");
    revalidatePath("/stock-movements");
    revalidatePath("/quality-control");
    revalidatePath("/dashboard");
    return { ok: true, id: qcId };
  }

  // Load the order (id, status, receipt_items, inventory_shipped).
  const { data: ord, error: ordErr } = await supabase
    .from("orders")
    .select("id, status, receipt_items, inventory_shipped")
    .eq("id", orderId)
    .maybeSingle();
  if (ordErr) return { error: ordErr.message };
  if (!ord) return { error: "Order not found." };

  // Idempotency guard: if this order's stock was already shipped, skip the
  // DEDUCTION — a double-scan must not double-deduct the same units.
  //
  // PERO ANG SELYO AY HINDI DEDUKSYON (2026-08-29). Bumabalik agad ito noon,
  // kaya ang PANGALAWANG linya ng iisang order ay hindi kailanman nase-stamp:
  // ang ORD-000003 ay may mesa at sofa bed, at nang mai-scan ang mesa ay
  // naging `inventory_shipped` na ang order — kaya ang sofa bed ay naka-stuck
  // sa "scan" habambuhay, at hindi naaalis sa pack list.
  //
  // Ang deduksyon ay minsanan kada ORDER; ang selyo ay kada LINYA. Hinati na.
  const alreadyShipped = !!ord.inventory_shipped;

  // Ang QC record ng scan na ito — ang ref_label ang nagsasabi kung aling linya
  // (at kung REWORK ba ito), ang stocked_at ang selyo laban sa double-scan.
  const { data: qcRec } = await supabase.from("warehouse_qc")
    .select("sku, good_qty, ref_label, stocked_at, color").eq("id", qcId).maybeSingle();
  if (qcRec?.stocked_at) return { ok: true, id: qcId }; // na-scan na — idempotent
  const refLine = String(qcRec?.ref_label ?? "").trim();

  // Physical stock-out (once). receipt_items → shipOrderInventory per matched line
  // (fn_inventory_ship, with a resilient direct-UPDATE fallback). Only stamp
  // inventory_shipped when every matched line shipped, so the flag stays truthful.
  const items = (ord.receipt_items as { qty: number; description: string; sku?: string | null; color?: string | null }[] | null) ?? [];
  if (!alreadyShipped) {
    // ANG NA-SCAN NA LINYA LANG ANG IBINABAWAS (0225, 2026-09-01, partial
    // delivery): dating BUONG receipt_items ang dineduct sa unang scan at
    // inventory_shipped agad — sa partial, ang mga linyang wala pa sa batch ay
    // nababawasan nang maaga, at ang order-wide na selyo ay pumuputol sa buong
    // Partial Delivery machinery (shipOnDelivered guard). Ngayon: ang linyang
    // ito lang; ang selyo ay naitatakda LANG kapag kumpleto na ang lahat.
    // Bago ang 0225 (null): eksaktong lumang buong-order na ugali.
    const { lineKeyOf, readLinesShipped, addLinesShipped } = await import("@/lib/orders/inventory");
    const { hasKey, lineName } = await import("@/lib/orders/line-key");
    const ls = await readLinesShipped(supabase, orderId);
    if (ls === null || !items.length) {
      if (items.length) {
        const ok = await shipOrderInventory(supabase, items, orderId);
        if (ok) await supabase.from("orders").update({ inventory_shipped: true }).eq("id", orderId);
      } else {
        // No lines to ship — still mark shipped so we don't re-run this order's stock-out.
        await supabase.from("orders").update({ inventory_shipped: true }).eq("id", orderId);
      }
    } else {
      const isFeeLine = (d: string) => /^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test(d);
      // KASAMA ANG KULAY (2026-09-06): ang QC record ng isang kulay ay ang
      // linyang iyon lang ang ibinabawas at itinatatak sa lines_shipped.
      const qcColorKey = String((qcRec as { color?: string | null } | null)?.color ?? "").trim();
      const key = lineKeyOf(refLine, qcColorKey || null);
      const lkOf = (it: { description: string; color?: string | null }) => lineKeyOf(it.description, it.color);
      if (key && !hasKey(ls, key)) {
        const line = items.find((it) => lkOf(it) === key) ?? items.find((it) => lineName(it.description) === lineName(refLine));
        const good = Math.max(1, Math.floor(Number(input.good_qty ?? qcRec?.good_qty) || Number(line?.qty) || 1));
        await shipOrderInventory(supabase, [{ qty: good, description: refLine, sku: (qcRec?.sku as string | null) ?? line?.sku ?? null }], orderId);
        await addLinesShipped(supabase, orderId, [key]);
        ls.add(key);
      }
      const allKeys = items.filter((it) => { const k = lineName(it.description); return k && !isFeeLine(k); }).map(lkOf);
      if (allKeys.length && allKeys.every((k) => hasKey(ls, k))) {
        await supabase.from("orders").update({ inventory_shipped: true }).eq("id", orderId);
      }
    }
  } else if (/^rework\s*·/i.test(refLine)) {
    // ANG REWORK REDELIVERY AY PANGALAWANG LEHITIMONG OUT (2026-08-31,
    // naranasan: "nakapag out nako, d pa din nawawala"). Ang inventory_shipped
    // ay totoo na mula sa UNANG hatid, kaya nilalaktawan ng guard sa itaas ang
    // deduksyon — hindi bumababa ang oh_inv at hindi nako-consume ang
    // placement, kaya ang na-dispatch nang inayos na unit ay nakaupo pa rin sa
    // L10-A2 ng mapa. Ang inayos na unit ay na-stock-in ulit (+1 sa receiving),
    // kaya ang paglabas nito ay tunay na −1: ANG LINYANG ITO LANG ang
    // ibinabawas, at ang placement na pag-aari ng order na ito ang unang
    // kinukuha (preferOrderId), hindi ang lumang bunton.
    const good = Math.max(1, Math.floor(Number(input.good_qty ?? qcRec?.good_qty) || 1));
    await shipOrderInventory(supabase, [{ qty: good, description: refLine, sku: qcRec?.sku ?? null }], orderId);
  }

  // Advance the order to "For Delivery" only if it's still in an earlier fulfillment
  // state — never overwrite a later status (deliver/arrived/installation/cancel/draft).
  const st = String(ord.status ?? "");
  if (!/deliver|arrived|installation|cancel|draft/i.test(st)) {
    await supabase.from("orders").update({ status: "For Delivery" }).eq("id", orderId);
  }

  // Clear the Pre-Pack queue row for THIS LINE now that it has passed QC-OUT and
  // shipped — the Quality Control (N) badge counts ops_line_skip, so leaving it
  // makes the badge stick even after the item is dispatched.
  //
  // ISANG LINYA, HINDI ANG BUONG ORDER (2026-08-29). Ang buong order ang
  // binubura noon, kaya ang ORD-000003 — na may DALAWANG skip line, mesa at
  // sofa bed — ay nawawalan ng dalawa sa pack list nang i-scan ang isa. Ang
  // sofa bed ay hindi na kailanman lumitaw, at walang makapagsabing may
  // natitira pa. Ang `ref_label` ng QC record ang nagsasabi kung aling linya.
  // KADA KULAY (0234): ang skip row ng kulay ng QC record na ito, o ang legacy
  // row na walang kulay. Kapag wala pa ang column, bumabagsak sa dating delete.
  if (refLine) {
    const qcColor = String((qcRec as { color?: string | null } | null)?.color ?? "").trim();
    const { error: dErr } = await supabase.from("ops_line_skip").delete().eq("order_id", orderId).eq("item_desc", refLine).in("color", [qcColor, ""]);
    if (dErr && /color/i.test(dErr.message)) await supabase.from("ops_line_skip").delete().eq("order_id", orderId).eq("item_desc", refLine);
  }
  // Walang ref_label (lumang tala): ang dating asal — mas mabuting matanggal
  // ang badge kaysa maiwan itong naka-stuck habambuhay.
  else await supabase.from("ops_line_skip").delete().eq("order_id", orderId);

  // Stamp the QC record so history shows the OUT completed (mirrors the IN stock-in).
  await supabase.from("warehouse_qc").update({ stocked_at: new Date().toISOString() }).eq("id", qcId);
  await audit({ module: "wh_qc", table: "orders", recordId: orderId, action: "update", after: { inventory_shipped: true, status: "For Delivery", via: "qc_out_ship", qc_id: qcId } });

  revalidatePath("/delivery");
  revalidatePath("/installation");
  revalidatePath("/inventory");
  revalidatePath("/inventory/adjustments");
  revalidatePath("/scan");
  revalidatePath("/stock-movements");
  revalidatePath("/products");
  revalidatePath("/locations");
  revalidatePath("/quality-control");
  revalidatePath("/workshop/quality-control");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/customers");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  return { ok: true, id: qcId };
}
