"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { syncWebStock } from "@/lib/web/stock";
import { requireEdit } from "@/lib/auth/guard";
import { resyncReserved } from "@/lib/orders/inventory";

export type NewInventory = {
  product_name: string;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  location: string | null;           // Rak #
  warehouse_location: string | null; // Zone #
  supplier: string | null;
  oh_inv: number;
  reserved: number;
  status: string;
  // INVENTORY KADA KULAY (0232): kapag may color variants ang produkto, isang
  // row kada kulay - ang oh_inv/color sa itaas ay hindi ginagamit.
  colors?: { color: string; oh_inv: number }[];
};

const statusFor = (n: number) => (n <= 0 ? "Out of stock" : n <= 3 ? "Low stock" : "In stock");

function toRow(input: NewInventory) {
  const onHand = Number(input.oh_inv) || 0;
  const reserved = Number(input.reserved) || 0;
  return {
    product_name: input.product_name.trim(),
    sku: input.sku || null,
    category: input.category || null,
    color: input.color || null,
    dimension: input.dimension || null,
    location: input.location || null,
    warehouse_location: input.warehouse_location || null,
    supplier: input.supplier || null,
    oh_inv: onHand,
    reserved: reserved,
    available: Math.max(onHand - reserved, 0), // always derived
    status: input.status || "In stock",
  };
}

export async function addInventory(
  input: NewInventory,
): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/inventory", "inventory");
  if (!input.product_name?.trim()) return { error: "Product name is required." };
  const supabase = createServerSupabase();
  // DOBLE (0232): iisang row kada (SKU, kulay). Ang dating row ay ini-edit,
  // hindi dinadagdagan ng pangalawa.
  const sku = String(input.sku ?? "").trim();
  const existing = sku
    ? (((await supabase.from("inventory").select("id, color").ilike("sku", sku)).data ?? []) as { id: number; color: string | null }[])
    : [];
  const taken = new Set(existing.map((r) => String(r.color ?? "").trim().toLowerCase()));
  let insId: number | null = null;
  if (input.colors?.length) {
    const wanted = input.colors.map((c) => ({ color: String(c.color ?? "").trim(), oh_inv: Math.max(Number(c.oh_inv) || 0, 0) })).filter((c) => c.color);
    if (!wanted.length) return { error: "Pick at least one color." };
    const dup = wanted.filter((c) => taken.has(c.color.toLowerCase()));
    if (dup.length) return { error: `Already in inventory for this SKU: ${dup.map((c) => c.color).join(", ")}. Edit those rows instead.` };
    const rows = wanted.map((c) => toRow({ ...input, color: c.color, oh_inv: c.oh_inv, reserved: 0, status: statusFor(c.oh_inv) }));
    const { data: ins, error } = await supabase.from("inventory").insert(rows).select("id");
    if (error) return { error: error.message };
    insId = ins?.[0]?.id ?? null;
  } else {
    if (sku && taken.has(String(input.color ?? "").trim().toLowerCase())) {
      return { error: `${input.product_name.trim()}${input.color ? ` (${input.color})` : ""} is already in inventory. Edit that row instead.` };
    }
    const { data: ins, error } = await supabase.from("inventory").insert(toRow(input)).select("id").single();
    if (error) return { error: error.message };
    insId = ins?.id ?? null;
  }
  const ins = insId != null ? { id: insId } : null;
  // RESYNC (2026-08-19): kapag ang inventory row ay idinagdag PAGKATAPOS may
  // confirmed (Partial+) na order sa parehong SKU, habulin agad ng Reserved —
  // dati walang nagta-trigger kaya nananatiling 0.
  await resyncReserved(supabase);
  await auditAfter({ module: "inventory", table: "inventory", recordId: ins?.id ?? "—", action: "insert", snapshotTable: "inventory", snapshotId: ins?.id });
  revalidatePath("/inventory");
  revalidatePath("/inventory/adjustments");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/quality-control");
  revalidatePath("/scan");
  revalidatePath("/stock-movements");
  revalidatePath("/products");
  revalidatePath("/locations");
  return { ok: true };
}

export async function updateInventory(
  id: number,
  input: NewInventory,
): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/inventory", "inventory");
  if (!input.product_name?.trim()) return { error: "Product name is required." };
  const supabase = createServerSupabase();
  const before = await snapshot("inventory", id);
  const { error } = await supabase.from("inventory").update(toRow(input)).eq("id", id);
  if (error) return { error: error.message };
  // Parehong resync ng addInventory — laging tugma ang Reserved sa confirmed orders.
  await resyncReserved(supabase);
  await auditAfter({ module: "inventory", table: "inventory", recordId: id, action: "update", before, snapshotTable: "inventory", snapshotId: id });
  revalidatePath("/inventory");
  revalidatePath("/inventory/adjustments");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/quality-control");
  revalidatePath("/scan");
  revalidatePath("/stock-movements");
  revalidatePath("/products");
  revalidatePath("/locations");
  return { ok: true };
}

export async function deleteInventory(
  id: number,
): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/inventory", "inventory");
  const supabase = createServerSupabase();
  const before = await snapshot("inventory", id);
  const { error } = await supabase.from("inventory").delete().eq("id", id);
  if (error) return { error: error.message };
  await syncWebStock(supabase); // stock ng website, kada kulay
  await audit({ module: "inventory", table: "inventory", recordId: id, action: "delete", before });
  revalidatePath("/inventory");
  revalidatePath("/inventory/adjustments");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/quality-control");
  revalidatePath("/scan");
  revalidatePath("/stock-movements");
  revalidatePath("/products");
  revalidatePath("/locations");
  return { ok: true };
}

// ── LINISIN ANG RESERVED (2026-08-26) ───────────────────────────────────────
// Ang Reserved ay kinukuwenta mula sa mga umiiral na order (fn_inventory_resync_
// reserved) at tumatakbo sa bawat pagbabago ng order at ng inventory. Pero kapag
// nabura ang order sa LABAS ng app — diretso sa Supabase, o bulk delete — walang
// nagta-trigger, at nananatili ang reserved sa produktong wala nang nag-aangkin.
// Nangyari iyon: tatlong hilera ang may reserved 1 habang zero ang order.
//
// Ito ang paraan para ituwid nang hindi kailangang buksan ang database.
export async function resyncReservedNow(): Promise<{ ok: true } | { error: string }> {
  try {
    await requireEdit("/inventory", "inventory");
    const supabase = createServerSupabase();
    await resyncReserved(supabase);
    revalidatePath("/inventory");
    revalidatePath("/orders");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not recalculate Reserved." };
  }
}
