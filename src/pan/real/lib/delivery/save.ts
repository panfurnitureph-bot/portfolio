import "server-only";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { snapshot, auditAfter } from "@/lib/audit";
import { money, qty } from "@/lib/num";
import type { DeliveryInput } from "@/app/delivery/actions";

// CORE ng saveDelivery — WALANG permission guard. Ang guard ay nasa mga caller:
//   • app/delivery/actions.ts saveDelivery → requireEdit("/delivery")
//   • app/returns/actions.ts approve/markReworked → requireManager()/requireEdit
// DAHILAN: dati, ang returns approve ay tumatawag sa guarded saveDelivery para
// gumawa ng pickup/redelivery task — kaya ang Operation Manager (walang delivery
// edit permission) ay nag-500 SA GITNA ng approve (status na-update na, sabog na
// ang natitira). Ang cross-module na paggawa ng delivery task ay bahagi ng
// approve mismo, hindi hiwalay na delivery edit.
export async function saveDeliveryCore(input: DeliveryInput): Promise<{ ok: true; id: number } | { error: string }> {
  const supabase = createServerSupabase();

  // Don't let a stale form status DOWNGRADE the delivery. The Status dropdown often
  // still reads "Scheduled" while dispatch already moved the row to Out for Delivery /
  // Arrived / Delivered (Start Delivery, the driver's Arrived button). Saving the form
  // (e.g. after uploading packing photos) would otherwise clobber it back to Scheduled.
  const repurpose = input.repurpose === true;
  const RANK: Record<string, number> = { scheduled: 1, packed: 1, "out for delivery": 2, arrived: 3, installation: 4, delivered: 5 };
  let effStatus = input.status || "Scheduled";
  if (input.id && !repurpose) {
    const { data: curRow } = await supabase.from("deliveries").select("status").eq("id", input.id).maybeSingle();
    const curStatus = (curRow?.status as string | null) ?? "";
    const curRank = RANK[curStatus.toLowerCase()] ?? 0;
    const newRank = RANK[effStatus.toLowerCase()] ?? 0;
    // Keep the more-advanced DB status unless the user explicitly picked a further one.
    if (curRank > newRank) effStatus = curStatus;
  }
  const delivered = /delivered/i.test(effStatus);

  const header = {
    order_id: input.order_id, order_number: input.order_number || null, customer_name: input.customer_name || null,
    contact: input.contact || null, address: input.address || null, sales_rep: input.sales_rep || null, items_summary: input.items_summary || null,
    total_amount: money(input.total_amount), paid_amount: money(input.paid_amount), balance_due: money(input.balance_due),
    schedule_date: input.schedule_date || null, time_window: input.time_window || null, driver_team: input.driver_team || null, coordinator: input.coordinator || null, vehicle_plate: input.vehicle_plate || null,
    qa_status: input.qa_status || "Pending", qa_by: input.qa_by || null,
    payment_collected: money(input.payment_collected), payment_method: input.payment_method || null, collected_by: input.collected_by || null,
    received_by: input.received_by || null, proof_url: input.proof_url || null,
    delivered_at: delivered ? new Date().toISOString() : null,
    status: effStatus, notes: input.notes || null,
    // Bagong gamit ng row (rework pickup/redelivery): linisin ang lifecycle ng
    // nakaraang delivery para hindi manahin ng bagong task ang lumang arrival/
    // proof/packing state.
    ...(repurpose ? {
      arrived_at: null, started_at: null, signature_url: null, proof_photos: null,
      packed_at: null, packed_by: null, packing_photos: [], pin: null,
      driver_lat: null, driver_lng: null, loc_updated_at: null, cod_applied: 0,
      // ANG PICKUP AY BAGONG BIYAHE RIN (2026-08-31). Ang pickup_at ng
      // NAKARAANG biyahe ay nanahin ng redelivery noon — akala ng Delivery
      // Route ay nakuha na, kaya nilaktawan ang Pickup Task at dumiretso ang
      // stop sa ruta nang walang kumukuhang trak. Ang RMA-000005 ang unang
      // nahuli: ang haul kagabi ang may selyo, ang redelivery kaninang umaga
      // ang nagsuot.
      pickup_started_at: null, pickup_arrived_at: null, pickup_at: null,
      // NOT NULL ang pickup_photos (jsonb) — [] ang walang laman, hindi null;
      // ang null dito ay nagpapabagsak ng buong repurpose save.
      pickup_by: null, pickup_photos: [], pickup_signature: null,
      pickup_good: null, pickup_defect: null, pickup_remarks: null,
      pickup_notes: null, pickup_rejected_at: null, pickup_reject_reason: null,
      pickup_lat: null, pickup_lng: null,
    } : {}),
  };

  let id = input.id;
  // No explicit row id? An order already has AT MOST ONE delivery row (0126 unique
  // index) — reuse it instead of inserting a duplicate (the double-dispatch that left
  // one Delivered + one stale Arrived row per order).
  if (!id && input.order_id != null) {
    const { data: existing } = await supabase.from("deliveries").select("id").eq("order_id", input.order_id).limit(1);
    if (existing?.[0]?.id) id = existing[0].id as number;
  }
  // ANG PER-PRODUKTONG LITRATO AY NILILINIS DIN (2026-08-29). Ang listahan sa
  // itaas ay may `packing_photos` pero hindi ang `item_packing_photos` — bago
  // pa lang ang hanay na iyon (0208) at hindi ito naabot. Kaya ang litrato ng
  // UNANG hatid ay nabuhay sa redelivery: walong litrato sa isang biyaheng
  // hindi pa binubuksan, at handa nang umalis ang trak nang walang patunay ng
  // aktwal na dala nito. Hiwalay ang pag-update para hindi bumagsak ang buong
  // save kapag hindi pa tumatakbo ang 0208.
  const headerFull = repurpose ? { ...header, item_packing_photos: [] } : header;
  const missingCol = (m: string | undefined) => /item_packing_photos/.test(m ?? "");
  if (id) {
    const before = await snapshot("deliveries", id);
    let { error } = await supabase.from("deliveries").update(headerFull).eq("id", id);
    if (error && missingCol(error.message)) ({ error } = await supabase.from("deliveries").update(header).eq("id", id));
    if (error) return { error: error.message };
    await auditAfter({ module: "delivery", table: "deliveries", recordId: id, action: "update", before, snapshotTable: "deliveries", snapshotId: id });
  } else {
    let { data, error } = await supabase.from("deliveries").insert(headerFull).select("id").limit(1);
    if (error && missingCol(error.message)) ({ data, error } = await supabase.from("deliveries").insert(header).select("id").limit(1));
    if (error) return { error: error.message };
    id = data?.[0]?.id;
    if (id) await auditAfter({ module: "delivery", table: "deliveries", recordId: id, action: "insert", snapshotTable: "deliveries", snapshotId: id });
  }
  if (!id) return { error: "Failed to save delivery." };
  // Ang pickup_lines (0206) ay nililinis nang hiwalay at best-effort — kapag
  // isinama sa pangunahing update sa env na hindi pa tumatakbo ang 0206, ang
  // BUONG save ay babagsak sa "column does not exist". Dito na, resolbado na
  // ang id (kasama ang order-lookup na daan ng autoRedeliver).
  if (repurpose) {
    try { await supabase.from("deliveries").update({ pickup_lines: null }).eq("id", id); } catch { /* wala pang 0206 */ }
  }

  // QA items — DEFENSIVE: ang mga rework caller ay hindi nagpapasa ng qa_items
  // (undefined) — huwag mag-crash at huwag ding burahin ang existing QA rows;
  // ang [] lang (sinadyang walang laman) ang nagli-linis.
  const qaItems = Array.isArray(input.qa_items) ? input.qa_items : null;
  if (qaItems) {
    await supabase.from("delivery_qa_items").delete().eq("delivery_id", id);
  }
  if (qaItems && qaItems.length) {
    await supabase.from("delivery_qa_items").insert(qaItems.map((it, i) => ({
      delivery_id: id, description: it.description || null, image_url: it.image_url || null,
      sku: it.sku || null, category: it.category || null, color: it.color || null, dimension: it.dimension || null,
      qty: qty(it.qty), good_qty: qty(it.good_qty), defect_qty: qty(it.defect_qty),
      photo_url: it.photo_url || null, checked_by: it.checked_by || null, remarks: it.remarks || null, sort: i,
    })));
  }

  // COD / final payment → sync back to the Sales Order (Full Payment → Completed when settled).
  // IDEMPOTENT: `collected` is the CURRENT total collected on this delivery (a snapshot, not an
  // increment). We post only the DELTA vs. what this delivery already applied (cod_applied), so
  // re-saving the same delivery never double-credits the order. We read cod_applied from the row
  // we just wrote (it's unchanged by the header upsert) so retries are safe.
  const collected = money(input.payment_collected);
  if (input.order_id) {
    const { data: delRow } = await supabase.from("deliveries").select("cod_applied").eq("id", id).limit(1);
    const prevApplied = money(delRow?.[0]?.cod_applied ?? 0);
    // Signed delta (money() would clamp negatives to 0); allows a downward correction too.
    const delta = Math.round((collected - prevApplied) * 100) / 100;
    if (delta !== 0) {
      const { data: ord } = await supabase.from("orders").select("downpayment_price, full_payment, full_payment_price, status").eq("id", input.order_id).limit(1);
      const o = ord?.[0];
      if (o) {
        const dp = Number(o.downpayment_price ?? 0);
        const total = Number(o.full_payment_price ?? 0);
        // Apply only the delta; clamp so Full Payment never exceeds the remaining order balance.
        const raw = money(Number(o.full_payment ?? 0) + delta);
        const newFull = total > 0 ? Math.min(raw, Math.max(total - dp, 0)) : Math.max(raw, 0);
        const cur = String(o.status ?? "");
        let status = cur;
        if (/^(pending|partial|completed)$/i.test(cur.trim())) {
          status = total > 0 && dp + newFull >= total ? "Completed" : dp + newFull > 0 ? "Partial" : "Pending";
        }
        await supabase.from("orders").update({ full_payment: newFull, status }).eq("id", input.order_id);
        // Remember what we've now posted for this delivery so the next save only posts the new delta.
        await supabase.from("deliveries").update({ cod_applied: collected }).eq("id", id);
      }
    }
  }

  // I-SYNC ang piniling Driver/Team pabalik sa PLANNER BOOKING ng order (dq_*),
  // para ang Route Planner / Delivery Route / Queue ay sumunod din sa binago sa
  // modal — hindi lang ang deliveries row. Pangalan ng driver → dq_driver;
  // "Team X" → dq_team. Best-effort.
  if (input.order_id && input.driver_team?.trim()) {
    const v = input.driver_team.trim();
    const patch = /^team\s/i.test(v) ? { dq_team: v } : { dq_driver: v };
    await supabase.from("orders").update(patch).eq("id", input.order_id);
  }

  revalidatePath("/delivery");
  revalidatePath("/orders");
  revalidatePath("/installation");
  revalidatePath("/dashboard");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  return { ok: true, id };
}
