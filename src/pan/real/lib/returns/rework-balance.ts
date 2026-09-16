import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// RMA LEDGER ng isang order. Ang rework charge (order balance + parts + delivery)
// ay nakatala sa returns.rework_charge_total at ang bayad sa rework_downpayment —
// HINDI sa orders ledger. Kaya kapag may rework na may charge, ang RMA ang
// pinagbabatayan ng "balance" bago maging Delivered/Complete.
// null = walang rework na may service charge (normal orders ledger ang masusunod).
export async function reworkLedger(
  supabase: SupabaseClient,
  orderId: number,
): Promise<{ due: number; rma: string; charge: number; paid: number } | null> {
  const { data } = await supabase
    .from("returns")
    .select("id, return_no, rework_charge_total, rework_downpayment")
    .eq("order_id", orderId).eq("resolution", "rework")
    // `id desc`, HINDI `created_at` (2026-08-29). Ang isang order ay maaaring
    // may maraming RMA: ang ORD-000010 ay may RMA-000002 (bayad na) at
    // RMA-000004 (₱10,000 pa). Kapag ang bayad na ang nakuha, `due: 0` ang
    // isinasauli — at ang gate ng Delivered ay pumapayag sa isang order na may
    // utang pa. Ang pinakabago ang hawak ng biyahe, at `id` ang tiyak na
    // pagkakasunod: ang `created_at` ay maaaring magkatabi o kapareho.
    .order("id", { ascending: false })
    .limit(1);
  const r = data?.[0] as { id: number; return_no: string | null; rework_charge_total: number | null; rework_downpayment: number | null } | undefined;
  if (!r) return null;
  const charge = Number(r.rework_charge_total) || 0;
  if (charge <= 0) return null;
  const paid = Number(r.rework_downpayment) || 0;
  const due = Math.max(Math.round((charge - paid) * 100) / 100, 0);
  return { due, rma: r.return_no ?? `#${r.id}`, charge, paid };
}
