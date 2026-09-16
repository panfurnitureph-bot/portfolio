"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { requireAnyEdit } from "@/lib/auth/guard";

const OPS_MODULES = ["ops_approval", "ops_returns", "ops_tracker", "ops_materials", "ops_requests"];
import { money } from "@/lib/num";

export type ApproveInput = {
  order_id: number;
  order_number: string | null;
  workshop_id: number;
  item_desc: string;
  qty: number;
};

// Dispatch a sales-order line to a workshop → creates a pending job.
export async function approveToWorkshop(input: ApproveInput): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(OPS_MODULES);
  if (!input.workshop_id) return { error: "Pick a workshop first." };
  const supabase = createServerSupabase();
  // Guard against double-dispatch (double click / re-submit) of the same order line.
  const { data: dupe } = await supabase.from("workshop_job").select("id")
    .eq("order_id", input.order_id).eq("workshop_id", input.workshop_id).eq("item_desc", input.item_desc).limit(1);
  if (dupe && dupe.length) {
    revalidatePath("/orders");
    revalidatePath("/operations");
    revalidatePath("/operations/approval");
    revalidatePath("/operations/tracker");
    revalidatePath("/workshop/jobs");
    revalidatePath("/quality-control");
    revalidatePath("/delivery");
    revalidatePath("/installation");
    return { ok: true };
  }
  const { data: ins, error } = await supabase.from("workshop_job").insert({
    order_id: input.order_id, order_number: input.order_number, workshop_id: input.workshop_id,
    item_desc: input.item_desc, qty: money(input.qty) || 1, status: "pending",
  }).select("id").single();
  if (error) return { error: error.message };
  await auditAfter({ module: "operations", table: "workshop_job", recordId: ins?.id ?? "—", action: "insert", snapshotTable: "workshop_job", snapshotId: ins?.id });
  // Push the assigned workshop — a new job was dispatched to them.
  try {
    const { data: ws } = await supabase.from("workshop").select("name").eq("id", input.workshop_id).maybeSingle();
    const { notifyJobDispatched } = await import("@/lib/push/notify");
    await notifyJobDispatched({
      orderNumber: input.order_number ?? `#${input.order_id}`,
      product: input.item_desc.split("\n")[0].trim(),
      qty: money(input.qty) || 1,
      workshop: (ws?.name as string | undefined) ?? null,
    });
  } catch { /* best-effort */ }
  revalidatePath("/orders"); // Progress Status column reads the workshop stage
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/workshop");
  revalidatePath("/workshop/jobs");
  revalidatePath("/quality-control");
  revalidatePath("/delivery");
  revalidatePath("/installation");
  return { ok: true };
}

// Acknowledge a short (partial) shipment — Operations followed up the remainder.
// Clears it from the Action Required alert (workshop still receives the rest).
export async function followUpRequest(id: number): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(OPS_MODULES);
  const supabase = createServerSupabase();
  const before = await snapshot("stock_request", id);
  const { error } = await supabase.from("stock_request").update({ ops_followed_up: true }).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "operations", table: "stock_request", recordId: id, action: "update", before, snapshotTable: "stock_request", snapshotId: id });
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/operations/requests");
  revalidatePath("/workshop");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/requests");
  return { ok: true };
}

// Mark a line "no workshop needed" → drops it from the To-Assign review queue and
// hands it to the Warehouse. The item isn't built; it's pulled from existing stock
// (already RESERVED at order commit — physical on-hand only leaves at dispatch).
// The `ops_line_skip` marker doubles as the "orders to pack" source on the Quality
// Control screen: the warehouse sees it, does a QC-for-OUT (outgoing/packing
// check — no stock movement, the stock is already reserved), which then routes the
// order to Delivery. On-hand is deducted later at "Out for Delivery". Idempotent.
// Remove a skipped line ("No Workshop Needed") — drops it from the QC
// Orders-to-Pack queue without an inspection (e.g. a stale/test line).
export async function unskipLine(orderId: number, itemDesc: string, color: string | null = null): Promise<{ ok: true } | { error: string }> {
  try { await requireAnyEdit([...OPS_MODULES, "wh_qc"]); }
  catch { return { error: "Forbidden." }; }
  if (!orderId || !itemDesc) return { error: "Missing line." };
  const supabase = createServerSupabase();
  // KADA KULAY (0234): kapag may ibinigay na kulay, ang linyang iyon lang ang
  // tinatanggal; kung wala pa ang column (hindi pa tumatakbo ang migration),
  // bumabagsak sa dating asal.
  let q = supabase.from("ops_line_skip").delete().eq("order_id", orderId).eq("item_desc", itemDesc);
  if (color != null) q = q.eq("color", color);
  let { error } = await q;
  if (error && /color/i.test(error.message)) ({ error } = await supabase.from("ops_line_skip").delete().eq("order_id", orderId).eq("item_desc", itemDesc));
  if (error) return { error: error.message };
  await audit({ module: "operations", table: "ops_line_skip", recordId: orderId, action: "delete", before: { order_id: orderId, item_desc: itemDesc } });
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/quality-control");
  return { ok: true };
}

export async function skipLine(orderId: number, itemDesc: string, color: string | null = null): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(OPS_MODULES);
  if (!orderId || !itemDesc) return { error: "Missing line." };
  const supabase = createServerSupabase();
  // SKIP KADA KULAY (Joe 2026-09-06, migration 0234): parehong produkto sa
  // magkaibang kulay = magkahiwalay na linya = magkahiwalay na skip. Kapag wala
  // pa ang color column, bumabagsak sa dating (order_id, item_desc) na key.
  const c = (color ?? "").trim();
  let { error } = await supabase.from("ops_line_skip").upsert(
    { order_id: orderId, item_desc: itemDesc, color: c },
    { onConflict: "order_id,item_desc,color", ignoreDuplicates: true },
  );
  if (error && /color/i.test(error.message)) {
    ({ error } = await supabase.from("ops_line_skip").upsert(
      { order_id: orderId, item_desc: itemDesc },
      { onConflict: "order_id,item_desc", ignoreDuplicates: true },
    ));
  }
  if (error) return { error: error.message };
  await audit({ module: "operations", table: "ops_line_skip", recordId: orderId, action: "insert", after: { order_id: orderId, item_desc: itemDesc, color: c } });
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/quality-control");
  return { ok: true };
}

// Order a stock request → mark "ordered" (stock on the way). NO stock applied yet —
// the workshop adds stock when it RECEIVES the shipment (receiveStockRequest).
export async function orderRequest(id: number, qty: number, by: string | null): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(OPS_MODULES);
  const supabase = createServerSupabase();
  const { data: req } = await supabase.from("stock_request").select("id, material_id").eq("id", id).maybeSingle();
  if (!req) return { error: "Request not found." };
  if (req.material_id == null) return { error: "Request has no material." };
  const q = money(qty);
  if (q <= 0) return { error: "Enter a quantity to order." };

  const before = await snapshot("stock_request", id);
  const { error } = await supabase.from("stock_request")
    .update({ status: "ordered", qty_fulfilled: q, decided_by: by, decided_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "operations", table: "stock_request", recordId: id, action: "status_change", before, snapshotTable: "stock_request", snapshotId: id });
  // Push the workshop — their material request is on the way (ready to receive).
  try {
    const { data: mat } = await supabase.from("material").select("name, unit").eq("id", req.material_id).maybeSingle();
    const name = (mat?.name as string | undefined) ?? "material";
    const { notifyStockRequestApproved } = await import("@/lib/push/notify");
    await notifyStockRequestApproved({
      requestNo: `REQ-${String(id).padStart(3, "0")}`,
      summary: `${q}× ${name}${mat?.unit ? ` (${mat.unit})` : ""}`,
    });
  } catch { /* best-effort */ }
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/operations/requests");
  revalidatePath("/workshop");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/requests");
  return { ok: true };
}

export type MaterialInput = {
  workshop_id: number;
  name: string;
  barcode: string | null;
  unit: string;
  category: string | null;
  low_threshold: number;
  price: number;
  image_url: string | null;
  manager_only: boolean;
};

// Operations defines the per-workshop material catalog (workshops only do in/out).
export async function addMaterial(input: MaterialInput): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(OPS_MODULES);
  if (!input.workshop_id) return { error: "Pick a workshop." };
  if (!input.name?.trim()) return { error: "Material name required." };
  const supabase = createServerSupabase();
  const { data: ins, error } = await supabase.from("workshop_material").insert({
    workshop_id: input.workshop_id, name: input.name.trim(), barcode: input.barcode?.trim() || null,
    unit: input.unit || "pcs", category: input.category?.trim() || null, low_threshold: money(input.low_threshold),
    price: money(input.price), image_url: input.image_url || null, manager_only: !!input.manager_only,
  }).select("id").single();
  if (error) return { error: error.message };
  await auditAfter({ module: "operations", table: "workshop_material", recordId: ins?.id ?? "—", action: "insert", snapshotTable: "workshop_material", snapshotId: ins?.id });
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/operations/materials");
  revalidatePath("/workshop");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  return { ok: true };
}

// Save a material across one or more workshops. When `id` is given, that existing
// row is updated (and moved to the first workshop); any extra selected workshops
// get their own new copy. When `id` is null, a row is created per workshop.
export async function saveMaterial(input: Omit<MaterialInput, "workshop_id"> & { id: number | null; workshop_ids: number[] }): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(OPS_MODULES);
  if (!input.name?.trim()) return { error: "Material name required." };
  const ids = [...new Set(input.workshop_ids.filter(Boolean))];
  if (!ids.length) return { error: "Pick at least one workshop." };
  const supabase = createServerSupabase();
  const fields = {
    name: input.name.trim(), barcode: input.barcode?.trim() || null,
    unit: input.unit || "pcs", category: input.category?.trim() || null,
    low_threshold: money(input.low_threshold), price: money(input.price), image_url: input.image_url || null,
    manager_only: !!input.manager_only,
  };

  if (input.id) {
    const before = await snapshot("workshop_material", input.id);
    const { error } = await supabase.from("workshop_material").update({ ...fields, workshop_id: ids[0] }).eq("id", input.id);
    if (error) return { error: error.message };
    await auditAfter({ module: "operations", table: "workshop_material", recordId: input.id, action: "update", before, snapshotTable: "workshop_material", snapshotId: input.id });
    for (const wid of ids.slice(1)) {
      const { data: ins, error: e2 } = await supabase.from("workshop_material").insert({ ...fields, workshop_id: wid }).select("id").single();
      if (e2) return { error: e2.message };
      await auditAfter({ module: "operations", table: "workshop_material", recordId: ins?.id ?? "—", action: "insert", snapshotTable: "workshop_material", snapshotId: ins?.id });
    }
  } else {
    for (const wid of ids) {
      const { data: ins, error } = await supabase.from("workshop_material").insert({ ...fields, workshop_id: wid }).select("id").single();
      if (error) return { error: error.message };
      await auditAfter({ module: "operations", table: "workshop_material", recordId: ins?.id ?? "—", action: "insert", snapshotTable: "workshop_material", snapshotId: ins?.id });
    }
  }
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/operations/materials");
  revalidatePath("/workshop");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  return { ok: true };
}

// MASTERLIST ASSIGN — kopyahin ang mga piniling materials (source rows mula sa
// alinmang workshop) papunta sa target workshop nang isang click, sa halip na
// isa-isang manu-manong Add. Nilalaktawan ang mga KAPAREHONG pangalan na nasa
// target na (case-insensitive) para walang duplicates.
export async function assignMaterials(input: { targetWorkshopId: number; materialIds: number[]; managerOnly?: Record<number, boolean> }): Promise<{ ok: true; copied: number; skipped: number } | { error: string }> {
  await requireAnyEdit(OPS_MODULES);
  const target = Number(input.targetWorkshopId);
  const ids = [...new Set((input.materialIds ?? []).map(Number).filter(Boolean))];
  if (!target) return { error: "Pick a target workshop." };
  if (!ids.length) return { error: "Pick at least one material." };
  const supabase = createServerSupabase();

  const [{ data: sources, error: srcErr }, { data: existing }] = await Promise.all([
    supabase.from("workshop_material").select("id, name, barcode, unit, category, low_threshold, price, image_url, manager_only").in("id", ids),
    supabase.from("workshop_material").select("name").eq("workshop_id", target),
  ]);
  if (srcErr) return { error: srcErr.message };
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const have = new Set((existing ?? []).map((r) => norm(String(r.name ?? ""))));

  let copied = 0, skipped = 0;
  for (const s of sources ?? []) {
    if (have.has(norm(String(s.name ?? "")))) { skipped++; continue; }
    const { data: ins, error } = await supabase.from("workshop_material").insert({
      workshop_id: target, name: s.name, barcode: s.barcode ?? null, unit: s.unit ?? "pcs",
      category: s.category ?? null, low_threshold: s.low_threshold ?? 0, price: s.price ?? 0,
      image_url: s.image_url ?? null,
      // Per-item override mula sa modal (toggle); default = source value.
      manager_only: input.managerOnly && s.id in input.managerOnly ? !!input.managerOnly[s.id] : !!s.manager_only,
    }).select("id").single();
    if (error) return { error: `${s.name}: ${error.message}` };
    have.add(norm(String(s.name ?? "")));
    copied++;
    await auditAfter({ module: "operations", table: "workshop_material", recordId: ins?.id ?? "—", action: "insert", snapshotTable: "workshop_material", snapshotId: ins?.id });
  }
  revalidatePath("/operations/materials");
  revalidatePath("/workshop");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  return { ok: true, copied, skipped };
}

export async function updateMaterial(id: number, input: Omit<MaterialInput, "workshop_id">): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(OPS_MODULES);
  if (!input.name?.trim()) return { error: "Material name required." };
  const supabase = createServerSupabase();
  const before = await snapshot("workshop_material", id);
  const { error } = await supabase.from("workshop_material").update({
    name: input.name.trim(), barcode: input.barcode?.trim() || null,
    unit: input.unit || "pcs", category: input.category?.trim() || null, low_threshold: money(input.low_threshold),
    price: money(input.price), image_url: input.image_url || null, manager_only: !!input.manager_only,
  }).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "operations", table: "workshop_material", recordId: id, action: "update", before, snapshotTable: "workshop_material", snapshotId: id });
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/operations/materials");
  revalidatePath("/workshop");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  return { ok: true };
}

export async function deleteMaterial(id: number): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(OPS_MODULES);
  const supabase = createServerSupabase();
  // Soft-delete: keep stock/log history intact, just hide from catalog.
  const before = await snapshot("workshop_material", id);
  const { error } = await supabase.from("workshop_material").update({ active: false }).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "operations", table: "workshop_material", recordId: id, action: "delete", before, snapshotTable: "workshop_material", snapshotId: id });
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/operations/materials");
  revalidatePath("/workshop");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  return { ok: true };
}

export async function rejectRequest(id: number, by: string | null): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(OPS_MODULES);
  const supabase = createServerSupabase();
  const before = await snapshot("stock_request", id);
  const { error } = await supabase.from("stock_request")
    .update({ status: "rejected", decided_by: by, decided_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "operations", table: "stock_request", recordId: id, action: "status_change", before, snapshotTable: "stock_request", snapshotId: id });
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/operations/requests");
  revalidatePath("/workshop");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/requests");
  return { ok: true };
}
