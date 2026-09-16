"use server";

// Requested Edit Order — ang Sales & Service ay hindi na makakapag-edit ng
// CONFIRMED na order nang direkta (server-enforced sa updateOrder). Dito sila
// nagsusumite ng IMINUMUNGKAHING pagbabago (ang buong Edit Order payload), at
// ang Operations ang nag-a-Approve (ina-apply via updateOrder) o nagre-Reject
// sa /operations/edit-requests, na may BEFORE/AFTER diff na tanaw.

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { requireAnyEdit } from "@/lib/auth/guard";
import { auditAfter } from "@/lib/audit";
import { updateOrder, type EditOrder } from "./actions";
import type { OrderRow } from "@/lib/supabase/server";

export type EditRequestRow = {
  id: number;
  order_id: number;
  order_number: string | null;
  requested_by: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  proposed: Record<string, unknown> | null;
  status: "pending" | "approved" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

// Ang "before" snapshot ay KAPAREHONG hugis ng proposed (EditOrder fields) para
// malinis ang field-by-field diff sa Operations view.
function beforeShape(o: OrderRow): Record<string, unknown> {
  return {
    order_number: o.order_number ?? "",
    date_order: o.date_order ? String(o.date_order).slice(0, 10) : null,
    customer_name: o.customer_name ?? "",
    address: o.address ?? null,
    address_lat: o.address_lat ?? null,
    address_lng: o.address_lng ?? null,
    contact_number: o.contact_number ?? null,
    email: o.email ?? null,
    fb_name: o.fb_name ?? null,
    fb_link: o.fb_link ?? null,
    source: o.Source ?? null,
    status: o.status ?? "",
    assigned: o.assigned ?? null,
    workshop_date: o.workshop_date ? String(o.workshop_date).slice(0, 10) : null,
    date_of_delivery: o.date_of_delivery ? String(o.date_of_delivery).slice(0, 10) : null,
    date_downpayment: o.date_downpayment ? String(o.date_downpayment).slice(0, 10) : null,
    full_payment_date: o.full_payment_date ? String(o.full_payment_date).slice(0, 10) : null,
    downpayment: Number(o.downpayment_price) || 0,
    full_payment: Number(o.full_payment) || 0,
    total: Number(o.full_payment_price) || 0,
    items: o.receipt_items ?? [],
    transaction_images: o.transaction_images ?? [],
    removed_images: [],
    is_rush: !!o.is_rush,
    rush_days: o.rush_days ?? null,
  };
}

export async function createEditRequest(
  orderId: number,
  proposed: EditOrder,
  reason: string,
): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me) return { error: "Not signed in." };

  const db = createServerSupabase();
  const { data: o } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!o) return { error: "Order not found." };
  const order = o as OrderRow;
  const ord = order.order_number || `#${orderId}`;

  // ISANG request lang bawat order, kahit ano pa ang kinahinatnan nito —
  // kapag may record na (pending/approved/rejected), bawal nang mag-file ulit.
  const { data: latest } = await db
    .from("order_edit_requests")
    .select("status")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1);
  const last = latest?.[0]?.status as string | undefined;
  if (last === "pending") return { error: "This order already has a pending edit request — wait for Operations to act on it first." };
  if (last) return { error: "An edit request has already been filed for this order — only one request is allowed per order." };

  if (!reason.trim()) return { error: "A note explaining the reason for this edit request is required." };

  const { error } = await db.from("order_edit_requests").insert({
    order_id: orderId,
    order_number: ord,
    requested_by: me.full_name || "Sales",
    reason: reason.trim() || null,
    before: beforeShape(order),
    proposed,
  });
  if (error) {
    // Kapag hindi pa naitatakbo ang migration 0137, mas malinaw na mensahe.
    if (/order_edit_requests.*(does not exist|not find|schema cache)/i.test(error.message)) {
      return { error: "Edit-request table is missing — run migration 0137_order_edit_requests.sql in the Supabase Dashboard first." };
    }
    return { error: error.message };
  }

  try {
    const { notifyEditRequest } = await import("@/lib/push/notify");
    await notifyEditRequest({ orderNumber: ord, requestedBy: me.full_name || "Sales", reason: reason.trim() || null });
  } catch { /* best-effort */ }
  await auditAfter({ module: "orders", table: "order_edit_requests", recordId: orderId, action: "insert" });
  revalidatePath("/operations/edit-requests");
  revalidatePath("/orders"); // Request column pill → "Requested"
  return { ok: true };
}

export async function listEditRequests(): Promise<EditRequestRow[]> {
  const db = createServerSupabase();
  const { data } = await db
    .from("order_edit_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  return (data ?? []) as EditRequestRow[];
}

export async function approveEditRequest(id: number): Promise<{ ok: true } | { error: string }> {
  try { await requireAnyEdit(["ops_approval"]); }
  catch { return { error: "Forbidden — needs Order Approval edit access." }; }
  const me = await getSession();

  const db = createServerSupabase();
  const { data } = await db.from("order_edit_requests").select("*").eq("id", id).maybeSingle();
  const req = data as EditRequestRow | null;
  if (!req) return { error: "Request not found." };
  if (req.status !== "pending") return { error: "This request has already been acted on." };

  // I-apply ang iminungkahing pagbabago sa MISMONG daan ng normal na edit —
  // parehong validation, inventory handling, at audit ang tatakbo.
  const res = await updateOrder(req.order_id, req.proposed as unknown as EditOrder);
  if ("error" in res) return res;

  await db.from("order_edit_requests").update({
    status: "approved",
    decided_by: me?.full_name ?? null,
    decided_at: new Date().toISOString(),
  }).eq("id", id);

  revalidatePath("/operations/edit-requests");
  revalidatePath("/orders");
  return { ok: true };
}

export async function rejectEditRequest(id: number): Promise<{ ok: true } | { error: string }> {
  try { await requireAnyEdit(["ops_approval"]); }
  catch { return { error: "Forbidden — needs Order Approval edit access." }; }
  const me = await getSession();

  const db = createServerSupabase();
  const { error } = await db.from("order_edit_requests").update({
    status: "rejected",
    decided_by: me?.full_name ?? null,
    decided_at: new Date().toISOString(),
  }).eq("id", id).eq("status", "pending");
  if (error) return { error: error.message };

  revalidatePath("/operations/edit-requests");
  revalidatePath("/orders"); // Request column pill → "Rejected"
  return { ok: true };
}
