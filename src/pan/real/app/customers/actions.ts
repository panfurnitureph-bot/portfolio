"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { requireEdit } from "@/lib/auth/guard";

export type CustomerInput = {
  name: string;
  contact: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

function clean(i: CustomerInput) {
  return {
    name: i.name.trim(),
    contact: i.contact?.trim() || null,
    email: i.email?.trim() || null,
    address: i.address?.trim() || null,
    notes: i.notes?.trim() || null,
  };
}

export async function createCustomer(input: CustomerInput): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/customers", "customers");
  if (!input.name?.trim()) return { error: "Name is required." };
  const db = createServerSupabase();
  const { data, error } = await db.from("customers").insert(clean(input)).select("id").single();
  if (error) return { error: /duplicate|unique/i.test(error.message) ? `Customer "${input.name}" already exists.` : error.message };
  await auditAfter({ module: "customers", table: "customers", recordId: data?.id ?? "—", action: "insert", snapshotTable: "customers", snapshotId: data?.id });
  revalidatePath("/customers");
  return { ok: true };
}

export async function updateCustomer(id: number, input: CustomerInput): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/customers", "customers");
  if (!input.name?.trim()) return { error: "Name is required." };
  const db = createServerSupabase();
  const before = await snapshot("customers", id);
  const { error } = await db.from("customers").update(clean(input)).eq("id", id);
  if (error) return { error: /duplicate|unique/i.test(error.message) ? `Customer "${input.name}" already exists.` : error.message };
  await auditAfter({ module: "customers", table: "customers", recordId: id, action: "update", before, snapshotTable: "customers", snapshotId: id });
  revalidatePath("/customers");
  return { ok: true };
}

export async function deleteCustomer(id: number): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/customers", "customers");
  const db = createServerSupabase();
  const before = await snapshot("customers", id);
  const { error } = await db.from("customers").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "customers", table: "customers", recordId: id, action: "delete", before });
  revalidatePath("/customers");
  return { ok: true };
}
