"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireEdit } from "@/lib/auth/guard";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { money } from "@/lib/num";

export type CostingItemInput = {
  kind: "material" | "labor" | "expense" | "subcon";
  qty: string | null;
  material: string | null;
  unit_price: number;
};

export type CostingInput = {
  title: string;
  project: string | null;
  size: string | null;
  category: string | null;
  selling_price: number;
  notes: string | null;
  items: CostingItemInput[];
};

// Total per line: (leading number in qty, default 1) × unit price.
// Handles "3 pcs." → 3, "9 yards" → 9, "2.5 pcs" → 2.5, blank (labor) → 1.
function lineTotal(qty: string | null, unit: number): number {
  const n = parseFloat((qty ?? "").trim());
  return (isNaN(n) ? 1 : Math.max(n, 0)) * money(unit);
}

// Atomic delete + reinsert of line items AND total_cost update in a single plpgsql
// function (one implicit transaction). A failure mid-way rolls back, so a costing
// can't be left with no items or a stale total. Returns the new total.
async function replaceItems(supabase: ReturnType<typeof createServerSupabase>, costingId: number, items: CostingItemInput[]) {
  const total = items.reduce((s, it) => s + lineTotal(it.qty, it.unit_price), 0);
  const payload = items.map((it, i) => ({
    kind: it.kind,
    qty: it.qty || null,
    material: it.material || null,
    unit_price: money(it.unit_price),
    total_price: lineTotal(it.qty, it.unit_price),
    sort: i,
  }));
  await supabase.rpc("fn_replace_costing_items", { p_costing_id: costingId, p_items: payload, p_total: total });
  return total;
}

export async function saveCosting(id: number | null, input: CostingInput): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/costing", "costing");
  if (!input.title?.trim()) return { error: "Title is required." };
  const supabase = createServerSupabase();

  const header = {
    title: input.title.trim(),
    project: input.project || null,
    size: input.size || null,
    category: input.category || null,
    selling_price: money(input.selling_price),
    notes: input.notes || null,
  };

  let costingId = id;
  const before = id ? await snapshot("product_costings", id) : null;
  if (id) {
    const { error } = await supabase.from("product_costings").update(header).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await supabase.from("product_costings").insert(header).select("id").limit(1);
    if (error) return { error: error.message };
    costingId = data?.[0]?.id;
  }
  if (!costingId) return { error: "Failed to save costing." };

  // Items + total_cost are written atomically inside replaceItems (RPC).
  await replaceItems(supabase, costingId, input.items);

  await auditAfter({
    module: "costing",
    table: "product_costings",
    recordId: costingId,
    action: id ? "update" : "insert",
    before,
    snapshotTable: "product_costings",
    snapshotId: costingId,
  });
  revalidatePath("/costing");
  return { ok: true };
}

export async function deleteCosting(id: number): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/costing", "costing");
  const supabase = createServerSupabase();
  const before = await snapshot("product_costings", id);
  const { error } = await supabase.from("product_costings").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "costing", table: "product_costings", recordId: id, action: "delete", before });
  revalidatePath("/costing");
  return { ok: true };
}
