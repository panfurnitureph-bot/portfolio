"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { requireEdit } from "@/lib/auth/guard";
import { money, qty } from "@/lib/num";
import type { POCell, POColumn } from "@/app/purchase-orders/data";

export type POItemInput = {
  item_no: string | null;
  color: string | null;
  description: string | null;
  prod_size: string | null;
  qty: number;
  received_qty: number;
  unit_price: number;
  image_url: string | null;
  swatch_url: string | null;
  extra: Record<string, string>;
};

export type PurchaseOrderInput = {
  pi_number: string | null;
  supplier: string | null;
  supplier_address: string | null;
  date_order: string | null;
  delivery_date: string | null;
  price_terms: string | null;
  payment_terms: string | null;
  port_shipment: string | null;
  port_destination: string | null;
  container: string | null;
  currency: string;
  discount: number;
  deposit_pct: number;
  status: string;
  notes: string | null;
  details: Record<string, string>;
  header_rows?: POCell[][];
  footer_rows?: POCell[][];
  columns?: POColumn[];
  items: POItemInput[];
};

const lineAmount = (q: number, unit: number) => qty(q) * money(unit);

// Receiving drives status: all lines in → Received, some → Partially Received.
// Draft/Sent/Deposit Paid/Ordered kept until receiving starts; Cancelled never overridden.
function withReceiveStatus(status: string, items: POItemInput[]): string {
  if (/cancel/i.test(status)) return status;
  const withQty = items.filter((i) => Number(i.qty) > 0);
  const anyReceived = items.some((i) => Number(i.received_qty) > 0);
  const allReceived = withQty.length > 0 && withQty.every((i) => Number(i.received_qty) >= Number(i.qty));
  if (allReceived) return "Received";
  if (anyReceived) return "Partially Received";
  return status || "Draft";
}

async function replaceItems(supabase: ReturnType<typeof createServerSupabase>, poId: number, items: POItemInput[]): Promise<{ error?: string }> {
  // Atomic delete-then-insert via a single plpgsql function (one implicit
  // transaction) so a failed insert can't orphan the PO with zero items.
  const payload = items.map((it, i) => ({
    item_no: it.item_no || null,
    color: it.color || null,
    description: it.description || null,
    prod_size: it.prod_size || null,
    qty: qty(it.qty),
    received_qty: qty(it.received_qty),
    unit_price: money(it.unit_price),
    amount: lineAmount(it.qty, it.unit_price),
    image_url: it.image_url || null,
    swatch_url: it.swatch_url || null,
    extra: it.extra && typeof it.extra === "object" ? it.extra : {},
    sort: i,
  }));
  const { error } = await supabase.rpc("fn_replace_po_items", { p_po_id: poId, p_items: payload });
  if (error) return { error: error.message };
  return {};
}

export async function savePurchaseOrder(id: number | null, input: PurchaseOrderInput): Promise<{ ok: true; id: number } | { error: string }> {
  await requireEdit("/purchase-orders", "purchase_orders");
  const supabase = createServerSupabase();
  const subtotal = input.items.reduce((s, it) => s + lineAmount(it.qty, it.unit_price), 0);
  const total = Math.max(subtotal - money(input.discount), 0);

  const header = {
    pi_number: input.pi_number || null,
    supplier: input.supplier || null,
    supplier_address: input.supplier_address || null,
    date_order: input.date_order || null,
    delivery_date: input.delivery_date || null,
    price_terms: input.price_terms || null,
    payment_terms: input.payment_terms || null,
    port_shipment: input.port_shipment || null,
    port_destination: input.port_destination || null,
    container: input.container || null,
    currency: input.currency || "USD",
    discount: money(input.discount),
    total,
    deposit_pct: money(input.deposit_pct),
    status: withReceiveStatus(input.status, input.items),
    notes: input.notes || null,
    details: input.details && typeof input.details === "object" ? input.details : {},
    ...(input.header_rows ? { header_rows: input.header_rows } : {}),
    ...(input.footer_rows ? { footer_rows: input.footer_rows } : {}),
    ...(input.columns ? { columns: input.columns } : {}),
  };

  let poId = id;
  // Duplicate guard: a NEW PO / import whose PI number already exists is
  // blocked — no insert, no overwrite. The user must edit the existing PO.
  if (!poId && input.pi_number?.trim()) {
    const { data: dup } = await supabase
      .from("purchase_orders").select("id").ilike("pi_number", input.pi_number.trim()).limit(1);
    if (dup?.[0]?.id) {
      return { error: `DUPLICATE: PI "${input.pi_number.trim()}" already exists. Duplicates are not allowed.` };
    }
  }

  if (poId) {
    const before = await snapshot("purchase_orders", poId);
    const { error } = await supabase.from("purchase_orders").update(header).eq("id", poId);
    if (error) return { error: error.message };
    await auditAfter({ module: "purchase_orders", table: "purchase_orders", recordId: poId, action: "update", before, snapshotTable: "purchase_orders", snapshotId: poId });
  } else {
    const { data, error } = await supabase.from("purchase_orders").insert(header).select("id").limit(1);
    if (error) return { error: error.message };
    poId = data?.[0]?.id;
    if (poId) await auditAfter({ module: "purchase_orders", table: "purchase_orders", recordId: poId, action: "insert", snapshotTable: "purchase_orders", snapshotId: poId });
  }
  if (!poId) return { error: "Failed to save purchase order." };

  const ri = await replaceItems(supabase, poId, input.items);
  if (ri.error) return { error: ri.error };
  revalidatePath("/purchase-orders");
  revalidatePath("/incoming");
  return { ok: true, id: poId };
}

export async function updateDeliveryDate(id: number, deliveryDate: string | null): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/purchase-orders", "purchase_orders");
  const supabase = createServerSupabase();
  const before = await snapshot("purchase_orders", id);
  const { error } = await supabase.from("purchase_orders").update({ delivery_date: deliveryDate || null }).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "purchase_orders", table: "purchase_orders", recordId: id, action: "update", before, snapshotTable: "purchase_orders", snapshotId: id });
  revalidatePath("/purchase-orders");
  revalidatePath("/incoming");
  return { ok: true };
}

export async function deletePurchaseOrder(id: number): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/purchase-orders", "purchase_orders");
  const supabase = createServerSupabase();
  const before = await snapshot("purchase_orders", id);
  const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "purchase_orders", table: "purchase_orders", recordId: id, action: "delete", before });
  revalidatePath("/purchase-orders");
  revalidatePath("/incoming");
  return { ok: true };
}

// ── Import column-mapping templates (per supplier) ──
export type ImportTemplate = { supplier: string; header_row: number; mapping: Record<string, string> };

export async function loadImportTemplate(supplier: string): Promise<ImportTemplate | null> {
  await requireEdit("/purchase-orders", "purchase_orders");
  if (!supplier?.trim()) return null;
  const supabase = createServerSupabase();
  const { data } = await supabase.from("po_import_templates").select("*").ilike("supplier", supplier.trim()).limit(1);
  const t = data?.[0];
  if (!t) return null;
  return { supplier: t.supplier, header_row: Number(t.header_row ?? 1), mapping: t.mapping ?? {} };
}

// Upload one extracted PI image (sent as FormData/Blob) to storage → returns a public URL.
export async function uploadPoImage(formData: FormData): Promise<{ url: string } | { error: string }> {
  await requireEdit("/purchase-orders", "purchase_orders");
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "No image." };
    const supabase = createServerSupabase();
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const rand = Math.random().toString(36).slice(2);
    const path = `po/${Date.now()}-${rand}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error } = await supabase.storage.from("product-images").upload(path, bytes, {
      contentType: file.type || "image/png", upsert: false,
    });
    if (error) return { error: error.message };
    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    return { url: data.publicUrl };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }
}

// Upload the original imported PI spreadsheet (.xlsx/.csv) so it stays attached to the
// PO for reference. Any file type (not just images) — stored in the same bucket.
export async function uploadPoFile(formData: FormData): Promise<{ url: string; name: string } | { error: string }> {
  await requireEdit("/purchase-orders", "purchase_orders");
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "No file." };
    const supabase = createServerSupabase();
    const ext = (file.name.split(".").pop() || "xlsx").toLowerCase();
    const rand = Math.random().toString(36).slice(2);
    const path = `po-files/${Date.now()}-${rand}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error } = await supabase.storage.from("product-images").upload(path, bytes, {
      contentType: file.type || "application/octet-stream", upsert: false,
    });
    if (error) return { error: error.message };
    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    return { url: data.publicUrl, name: file.name };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }
}

export async function saveImportTemplate(t: ImportTemplate): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/purchase-orders", "purchase_orders");
  if (!t.supplier?.trim()) return { error: "Supplier is required for a template." };
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("po_import_templates")
    .upsert({ supplier: t.supplier.trim(), header_row: t.header_row, mapping: t.mapping }, { onConflict: "supplier" });
  if (error) return { error: error.message };
  return { ok: true };
}
