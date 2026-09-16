"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireEdit } from "@/lib/auth/guard";
import { audit, snapshot, auditAfter } from "@/lib/audit";

export type RateInput = {
  item: string;
  category: string | null;
  unit: string | null;
  unit_price: number;
  notes: string | null;
  status: string;
};

function clean(i: RateInput) {
  return {
    item: i.item.trim(),
    category: i.category || null,
    unit: i.unit || null,
    unit_price: Number(i.unit_price) || 0,
    notes: i.notes || null,
    status: i.status || "active",
  };
}

export async function createRate(input: RateInput): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/suppliers", "suppliers");
  if (!input.item?.trim()) return { error: "Item is required." };
  const supabase = createServerSupabase();
  const { data, error } = await supabase.from("rates").insert(clean(input)).select("id").limit(1);
  if (error) return { error: error.message };
  const id = data?.[0]?.id;
  if (id != null) {
    await auditAfter({ module: "suppliers", table: "rates", recordId: id, action: "insert", snapshotTable: "rates", snapshotId: id });
  }
  revalidatePath("/suppliers");
  return { ok: true };
}

export async function updateRate(id: number, input: RateInput): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/suppliers", "suppliers");
  if (!input.item?.trim()) return { error: "Item is required." };
  const supabase = createServerSupabase();
  const before = await snapshot("rates", id);
  const { error } = await supabase.from("rates").update(clean(input)).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "suppliers", table: "rates", recordId: id, action: "update", before, snapshotTable: "rates", snapshotId: id });
  revalidatePath("/suppliers");
  return { ok: true };
}

export async function deleteRate(id: number): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/suppliers", "suppliers");
  const supabase = createServerSupabase();
  const before = await snapshot("rates", id);
  const { error } = await supabase.from("rates").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "suppliers", table: "rates", recordId: id, action: "delete", before });
  revalidatePath("/suppliers");
  return { ok: true };
}
