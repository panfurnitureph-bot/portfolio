"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { requireEdit } from "@/lib/auth/guard";

export type SupplierInput = {
  name: string;
  type: "local" | "shopee" | "imported";
  address: string | null;
  contact_person: string | null;
  contact_number: string | null;
  email: string | null;
  link: string | null;
  materials: string | null;
  status: string;
  notes: string | null;
};

function clean(i: SupplierInput) {
  return {
    name: i.name.trim(),
    type: i.type,
    address: i.address || null,
    contact_person: i.contact_person || null,
    contact_number: i.contact_number || null,
    email: i.email || null,
    link: i.link || null,
    materials: i.materials || null,
    status: i.status || "active",
    notes: i.notes || null,
  };
}

export async function createSupplier(input: SupplierInput): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/suppliers", "suppliers");
  if (!input.name?.trim()) return { error: "Supplier name is required." };
  const supabase = createServerSupabase();
  const { data: ins, error } = await supabase.from("suppliers").insert(clean(input)).select("id").single();
  if (error) return { error: error.message };
  await auditAfter({ module: "suppliers", table: "suppliers", recordId: ins?.id ?? "—", action: "insert", snapshotTable: "suppliers", snapshotId: ins?.id });
  revalidatePath("/suppliers");
  revalidatePath("/incoming");
  revalidatePath("/purchase-orders");
  return { ok: true };
}

export async function updateSupplier(id: number, input: SupplierInput): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/suppliers", "suppliers");
  if (!input.name?.trim()) return { error: "Supplier name is required." };
  const supabase = createServerSupabase();
  const before = await snapshot("suppliers", id);
  const { error } = await supabase.from("suppliers").update(clean(input)).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "suppliers", table: "suppliers", recordId: id, action: "update", before, snapshotTable: "suppliers", snapshotId: id });
  revalidatePath("/suppliers");
  revalidatePath("/incoming");
  revalidatePath("/purchase-orders");
  return { ok: true };
}

export async function deleteSupplier(id: number): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/suppliers", "suppliers");
  const supabase = createServerSupabase();
  const before = await snapshot("suppliers", id);
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "suppliers", table: "suppliers", recordId: id, action: "delete", before });
  revalidatePath("/suppliers");
  revalidatePath("/incoming");
  revalidatePath("/purchase-orders");
  return { ok: true };
}
