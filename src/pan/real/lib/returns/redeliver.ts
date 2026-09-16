import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { saveDeliveryCore } from "@/lib/delivery/save";

// AUTO-REDELIVERY ng isang pull-out REWORK — tumatakbo pagkatapos ng QC:
//   • To Warehouse route → sa Receiving QC stock-in (finishQcInStockIn)
//   • Direct Pickup route → sa HR approve ng QC declaration (approveQc)
// Ginagawa nito ang dating manual na "Mark reworked → Redeliver":
//   1. gawing redelivery ang deliveries row ng order (repurpose, Scheduled)
//   2. i-reset ang dq_* ng order → bumabalik sa Delivery Queue "For Scheduling"
//      para dumaan ULIT sa confirmation → Route Planner → delivery run
//   3. isara ang return (Completed + reworked_at)
// Best-effort at idempotent: kukuha lang ng return na nasa status 'Rework' na
// wala pang reworked_at; kapag wala, walang gagalawin.
export async function autoRedeliverRework(orderId: number): Promise<void> {
  try {
    const supabase = createServerSupabase();
    const { data: rets } = await supabase
      .from("returns")
      .select("id, return_no, order_id, customer_name, item_desc, rework_mode, rework_target, status, reworked_at, rework_charge_total, rework_downpayment")
      .eq("order_id", orderId).eq("resolution", "rework").eq("status", "Rework")
      .is("reworked_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const r = rets?.[0] as {
      id: number; return_no: string | null; order_id: number | null; customer_name: string | null;
      item_desc: string | null; rework_mode: string | null; rework_target: string | null;
      rework_charge_total?: number | null; rework_downpayment?: number | null;
    } | undefined;
    if (!r) return;
    if (r.rework_mode !== "pullout" || r.rework_target === "restock") return; // on-site/restock ay iba ang daloy
    const rma = r.return_no ?? `#${r.id}`;

    const o = (await supabase.from("orders")
      .select("order_number, customer_name, address").eq("id", orderId).maybeSingle()).data as
      { order_number: string | null; customer_name: string | null; address: string | null } | null;

    // RMA ledger sa delivery row: total = rework charge, paid = nakolekta, balance =
    // natitirang due — ito ang makikita/kokolektahin ng driver sa redelivery (COD).
    const charge = Number(r.rework_charge_total) || 0;
    const paid = Number(r.rework_downpayment) || 0;
    const due = Math.max(Math.round((charge - paid) * 100) / 100, 0);
    const res = await saveDeliveryCore({
      order_id: orderId,
      order_number: o?.order_number ?? null,
      customer_name: o?.customer_name ?? r.customer_name ?? null,
      contact: null, address: o?.address ?? null, sales_rep: null,
      items_summary: `Rework redelivery · ${rma} · ${(r.item_desc ?? "").split("\n")[0] || "item"}`,
      total_amount: charge, paid_amount: paid, balance_due: due,
      schedule_date: null, time_window: null, driver_team: null, coordinator: null, vehicle_plate: null,
      status: "Scheduled", repurpose: true,
    } as Parameters<typeof saveDeliveryCore>[0]);
    if ("error" in res) return;

    // Payagan ang stock-out ng REDELIVERY: ang rework item ay pumasok ulit sa
    // stock sa warehouse receiving (+1) — sa Start Delivery ng redelivery ito
    // ibabawas ulit (rework item lang; tingnan ang startDelivery).
    await supabase.from("deliveries").update({ inventory_shipped: false }).eq("id", res.id);

    await supabase.from("orders").update({
      dq_status: null, dq_group: null, dq_date: null, dq_team: null, dq_driver: null,
      dq_sent_at: null, dq_confirmed_at: null, dq_reminder_sent_at: null, dq_followups: 0,
      // PATI ANG FINALIZE (2026-08-28). Ang dq_* ay nililinis para bumalik ang
      // order sa Delivery Queue, pero ang finalize ng NAUNANG biyahe ay
      // naiiwan — at ang Queue ay hindi na ito ipinapakita habang mukhang
      // naruruta pa. Nawawala ang order: wala sa Queue, wala sa planner.
      dq_route_final_at: null,
    }).eq("id", orderId);

    // Ang biyahe ay pag-aari na ng RMA na ito (0205) — ang order ay maaaring may
    // ibang rework na gumamit ng parehong row, at ito na ang aktibo.
    try { await supabase.from("deliveries").update({ return_id: r.id }).eq("id", res.id); }
    catch { /* wala pang 0205 */ }
    await supabase.from("returns").update({
      status: "Completed", reworked_at: new Date().toISOString(), rework_delivery_id: res.id,
      notes: `Reworked (QC passed) → back in the Delivery Queue for confirmation + routing (delivery #${res.id}).`,
    }).eq("id", r.id);
  } catch { /* best-effort — huwag ibagsak ang QC flow */ }
}
