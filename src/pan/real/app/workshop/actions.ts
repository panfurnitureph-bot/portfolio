"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { requireAnyEdit } from "@/lib/auth/guard";
import { money } from "@/lib/num";
import { applyStock } from "@/lib/workshop/stock";

const JOB_STATUSES = ["pending", "accepted", "in_progress", "done", "delivered"];
const WS_MODULES = ["ws_jobs", "ws_inventory", "ws_logs", "ws_qc", "ws_requests"];

export async function updateJobStatus(jobId: number, status: string): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(WS_MODULES);
  if (!JOB_STATUSES.includes(status)) return { error: "Invalid status." };
  const supabase = createServerSupabase();
  const { data: job } = await supabase.from("workshop_job").select("order_id").eq("id", jobId).maybeSingle();
  const before = await snapshot("workshop_job", jobId);
  const { error } = await supabase.from("workshop_job").update({ status, updated_at: new Date().toISOString() }).eq("id", jobId);
  if (error) return { error: error.message };
  await auditAfter({ module: "workshop", table: "workshop_job", recordId: jobId, action: "status_change", before, snapshotTable: "workshop_job", snapshotId: jobId });

  // Order handoff: stamp workshop_completed_at when ALL jobs for the order are done/delivered; clear otherwise.
  if (job?.order_id != null) {
    const { data: siblings } = await supabase.from("workshop_job").select("status").eq("order_id", job.order_id);
    const all = siblings ?? [];
    const allDone = all.length > 0 && all.every((j) => /done|delivered/i.test(j.status ?? ""));
    await supabase.from("orders").update({ workshop_completed_at: allDone ? new Date().toISOString() : null }).eq("id", job.order_id);
    revalidatePath("/orders");
    revalidatePath("/dashboard");
    revalidatePath("/customers");
  }
  revalidatePath("/workshop");
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  revalidatePath("/workshop/quality-control");
  revalidatePath("/quality-control");
  revalidatePath("/delivery");
  revalidatePath("/installation");
  return { ok: true };
}

// Flag whether a finished job routes through the warehouse (Receiving QC) or is
// picked up directly at the workshop (skips warehouse). Only 'warehouse' jobs
// appear in the warehouse Receiving QC queue.
export async function setJobFulfillment(jobId: number, fulfillment: "warehouse" | "pickup"): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(WS_MODULES);
  if (fulfillment !== "warehouse" && fulfillment !== "pickup") return { error: "Invalid fulfillment." };
  const supabase = createServerSupabase();
  const before = await snapshot("workshop_job", jobId);
  const { error } = await supabase.from("workshop_job").update({ fulfillment, updated_at: new Date().toISOString() }).eq("id", jobId);
  if (error) return { error: error.message };
  await auditAfter({ module: "workshop", table: "workshop_job", recordId: jobId, action: "update", before, snapshotTable: "workshop_job", snapshotId: jobId });
  revalidatePath("/workshop");
  revalidatePath("/quality-control");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  revalidatePath("/workshop/quality-control");
  revalidatePath("/delivery");
  revalidatePath("/installation");
  return { ok: true };
}

export type MaterialInput = {
  workshop_id: number;
  name: string;
  barcode: string | null;
  unit: string;
  category: string | null;
  low_threshold: number;
  image_url: string | null;
};

export async function addMaterial(input: MaterialInput): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(WS_MODULES);
  if (!input.name?.trim()) return { error: "Material name required." };
  const supabase = createServerSupabase();
  const { data: ins, error } = await supabase.from("workshop_material").insert({
    workshop_id: input.workshop_id, name: input.name.trim(), barcode: input.barcode?.trim() || null,
    unit: input.unit || "pcs", category: input.category?.trim() || null, low_threshold: money(input.low_threshold),
    image_url: input.image_url || null,
  }).select("id").single();
  if (error) return { error: error.message };
  await auditAfter({ module: "workshop", table: "workshop_material", recordId: ins?.id ?? "—", action: "insert", snapshotTable: "workshop_material", snapshotId: ins?.id });
  revalidatePath("/workshop");
  revalidatePath("/operations/materials");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  revalidatePath("/workshop/quality-control");
  return { ok: true };
}

export async function createRequest(input: { workshop_id: number; material_id: number; qty: number; reason: string; requested_by: string | null }): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(WS_MODULES);
  if (!input.material_id) return { error: "Pick a material." };
  const q = money(input.qty);
  if (q <= 0) return { error: "Enter a quantity." };
  const supabase = createServerSupabase();
  const { data: ins, error } = await supabase.from("stock_request").insert({
    workshop_id: input.workshop_id, material_id: input.material_id, qty_requested: q,
    reason: input.reason || "Low stock", status: "pending", requested_by: input.requested_by,
  }).select("id").single();
  if (error) return { error: error.message };
  await auditAfter({ module: "workshop", table: "stock_request", recordId: ins?.id ?? "—", action: "insert", snapshotTable: "stock_request", snapshotId: ins?.id });
  revalidatePath("/workshop");
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/operations/requests");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  revalidatePath("/workshop/quality-control");
  return { ok: true };
}

// Receive an ORDERED stock request → +stock + ledger, mark fulfilled. This is the
// workshop confirming the incoming shipment arrived.
export async function receiveStockRequest(id: number, by: string | null, qtyReceived?: number): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(WS_MODULES);
  const supabase = createServerSupabase();
  const { data: req } = await supabase.from("stock_request").select("*").eq("id", id).maybeSingle();
  if (!req) return { error: "Request not found." };
  if (req.material_id == null) return { error: "Request has no material." };
  if (req.status === "fulfilled") { revalidatePath("/workshop"); return { ok: true }; }
  const ordered = money(req.qty_fulfilled ?? req.qty_requested);
  const already = money(req.qty_received ?? 0);
  const remaining = Math.max(ordered - already, 0);
  if (remaining <= 0) { revalidatePath("/workshop"); return { ok: true }; }
  let q = money(qtyReceived ?? remaining);
  if (q <= 0) return { error: "Enter the quantity received." };
  if (q > remaining) q = remaining; // can't receive more than what's left

  const res = await applyStock(supabase, {
    material_id: req.material_id, workshop_id: req.workshop_id, delta: q,
    type: "request_fulfilled", source: "request", ref_type: "request", ref_id: id, by,
  });
  if ("error" in res) return { error: res.error };

  const newReceived = already + q;
  const status = newReceived >= ordered ? "fulfilled" : "partial";
  const before = await snapshot("stock_request", id);
  const { error } = await supabase.from("stock_request")
    .update({ status, qty_received: newReceived }).eq("id", id); // qty_fulfilled stays = ordered
  if (error) return { error: error.message };
  await auditAfter({ module: "workshop", table: "stock_request", recordId: id, action: "status_change", before, snapshotTable: "stock_request", snapshotId: id });
  revalidatePath("/workshop");
  revalidatePath("/operations");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/operations/requests");
  revalidatePath("/operations/materials");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  revalidatePath("/workshop/quality-control");
  return { ok: true };
}

// Commit a barcode scan session: IN = receive (+), OUT = consume (−), tied to an order ref.
export async function scanCommit(input: {
  workshop_id: number;
  mode: "in" | "out";
  ref_order_id: number | null;
  ref_order_number: string | null;
  // ALING PRODUKTO (0197): ang job na kinonsumohan. Ang order ay maraming
  // produkto; kung wala nito, ang konsumo ay sa buong order ang lakip.
  ref_job_id?: number | null;
  // used_by KADA LINYA (2026-08-23): magkakaiba ang kumuha ng plywood at ng
  // foam sa iisang job. Ang top-level used_by sa ibaba ay pambalik lang.
  lines: { material_id: number; qty: number; used_by?: string | null }[];
  by: string | null;
  // Sino ang GUMAMIT (worker). Opsyonal dito para hindi masira ang Scan page na
  // tumatawag din nito; ang My Jobs ang nag-oobliga bago mag-confirm.
  used_by?: string | null;
}): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(WS_MODULES);
  const supabase = createServerSupabase();
  const sign = input.mode === "in" ? 1 : -1;
  for (const ln of input.lines) {
    const q = money(ln.qty);
    if (!ln.material_id || q <= 0) continue;
    const res = await applyStock(supabase, {
      material_id: ln.material_id, workshop_id: input.workshop_id, delta: sign * q,
      type: input.mode === "in" ? "received" : "consumed", source: "scan",
      ref_type: input.mode === "out" ? "order" : null,
      ref_id: input.mode === "out" ? input.ref_order_id : null,
      job_id: input.mode === "out" ? input.ref_job_id ?? null : null,
      note: input.mode === "out" && input.ref_order_number ? input.ref_order_number : null,
      by: input.by,
      used_by: ln.used_by ?? input.used_by ?? null,
    });
    if ("error" in res) return { error: res.error };
    await audit({
      module: "workshop", table: "workshop_stock", recordId: ln.material_id, action: "update",
      after: { material_id: ln.material_id, workshop_id: input.workshop_id, delta: sign * q, mode: input.mode, on_hand: res.on_hand, used_by: ln.used_by ?? input.used_by ?? null, ref_order_id: input.ref_order_id, ref_order_number: input.ref_order_number },
    });
  }
  revalidatePath("/workshop");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/operations/materials");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  revalidatePath("/workshop/quality-control");
  return { ok: true };
}

// Manager stock-out — consume restricted (manager_only) materials WITHOUT tying
// them to a job/order. Only the workshop's own logged-in account does this; the
// materials are hidden from the per-job Materials Used picker.
export async function managerStockOut(input: {
  workshop_id: number;
  lines: { material_id: number; qty: number }[];
  by: string | null;
}): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(WS_MODULES);
  const supabase = createServerSupabase();
  const clean = input.lines.filter((l) => l.material_id && money(l.qty) > 0);
  if (!clean.length) return { error: "Nothing to stock out." };

  // Guard: every line must be a manager_only material that belongs to this workshop.
  const ids = clean.map((l) => l.material_id);
  const { data: mats } = await supabase.from("workshop_material")
    .select("id, manager_only, workshop_id").in("id", ids);
  const okIds = new Set((mats ?? []).filter((m) => m.manager_only && m.workshop_id === input.workshop_id).map((m) => m.id));
  if (okIds.size !== ids.length) return { error: "One or more materials are not manager stock-out items for this workshop." };

  for (const ln of clean) {
    const q = money(ln.qty);
    const res = await applyStock(supabase, {
      material_id: ln.material_id, workshop_id: input.workshop_id, delta: -q,
      type: "consumed", source: "manual", note: "Manager stock-out", by: input.by,
    });
    if ("error" in res) return { error: res.error };
    await audit({
      module: "workshop", table: "workshop_stock", recordId: ln.material_id, action: "update",
      after: { material_id: ln.material_id, workshop_id: input.workshop_id, delta: -q, type: "consumed", note: "manager_stock_out", on_hand: res.on_hand },
    });
  }
  revalidatePath("/workshop");
  revalidatePath("/operations/materials");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/logs");
  revalidatePath("/workshop/requests");
  return { ok: true };
}

// Manual receive (no scan) — single material.
export async function receiveStock(input: { workshop_id: number; material_id: number; qty: number; by: string | null }): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(WS_MODULES);
  const q = money(input.qty);
  if (!input.material_id || q <= 0) return { error: "Pick a material and quantity." };
  const supabase = createServerSupabase();
  const res = await applyStock(supabase, {
    material_id: input.material_id, workshop_id: input.workshop_id, delta: q,
    type: "received", source: "manual", by: input.by,
  });
  if ("error" in res) return { error: res.error };
  await audit({
    module: "workshop", table: "workshop_stock", recordId: input.material_id, action: "update",
    after: { material_id: input.material_id, workshop_id: input.workshop_id, delta: q, type: "received", on_hand: res.on_hand },
  });
  revalidatePath("/workshop");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/operations/materials");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  revalidatePath("/workshop/quality-control");
  return { ok: true };
}
