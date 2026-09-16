"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { requireEdit } from "@/lib/auth/guard";

export type MattressInput = {
  client: string;
  order: string | null;
  order_date: string | null;
  status: string | null;
  region: string;
  amount: number | null;
  paid_via: string | null;
};

export async function saveMattressOrder(id: number | null, input: MattressInput): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/mattress-orders", "mattress_orders");
  if (!input.client?.trim()) return { error: "Client is required." };
  const supabase = createServerSupabase();

  const isDone = /done/i.test(input.status ?? "");

  // A Done mattress order is FROZEN — no further edits. Block any save against a row
  // already stamped done_at (except the transition INTO Done, which we allow once).
  if (id) {
    const { data: cur } = await supabase.from("mattress_orders").select("done_at").eq("id", id).maybeSingle();
    if (cur?.done_at) return { error: "This order is Done and locked — it can no longer be edited." };
  }

  const row = {
    client: input.client.trim(),
    order: input.order || null,
    order_date: input.order_date || null,
    status: input.status || null,
    region: input.region || "Luzon",
    amount: Math.max(Number(input.amount) || 0, 0),
    paid_via: input.paid_via || null,
    // Stamp done_at on the transition to Done → locks the row + drives PAN Overall.
    ...(isDone ? { done_at: new Date().toISOString() } : {}),
  };

  if (id) {
    const before = await snapshot("mattress_orders", id);
    const { error } = await supabase.from("mattress_orders").update(row).eq("id", id);
    if (error) return { error: error.message };
    await auditAfter({ module: "mattress_orders", table: "mattress_orders", recordId: id, action: "update", before, snapshotTable: "mattress_orders", snapshotId: id });
  } else {
    const { data: ins, error } = await supabase.from("mattress_orders").insert(row).select("id").single();
    if (error) return { error: error.message };
    await auditAfter({ module: "mattress_orders", table: "mattress_orders", recordId: ins?.id ?? "—", action: "insert", snapshotTable: "mattress_orders", snapshotId: ins?.id });
  }

  revalidatePath("/mattress-orders");
  revalidatePath("/hr/overall"); // a Done mattress order shows as income in PAN Overall
  return { ok: true };
}

export async function deleteMattressOrder(id: number): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/mattress-orders", "mattress_orders");
  const supabase = createServerSupabase();
  const before = await snapshot("mattress_orders", id);
  const { error } = await supabase.from("mattress_orders").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "mattress_orders", table: "mattress_orders", recordId: id, action: "delete", before });
  revalidatePath("/mattress-orders");
  return { ok: true };
}
