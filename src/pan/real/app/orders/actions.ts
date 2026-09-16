"use server";

import { revalidatePath } from "next/cache";
import { nextDocNumber } from "@/lib/next-number";
import { createServerSupabase } from "@/lib/supabase/server";
import { todayPH } from "@/lib/today";
import { getSession } from "@/lib/auth/session";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { requireEdit, requireAnyEdit } from "@/lib/auth/guard";
import { money, qty } from "@/lib/num";
import { meetsDownpayment } from "./downpayment";
import { deductInventory, restoreInventory, adjustInventory, resyncReserved, type OrderItem } from "@/lib/orders/inventory";

type SupaClient = ReturnType<typeof createServerSupabase>;

// A committed status deducts inventory; Pending/Cancelled/Draft do not. An order
// that hasn't met the 30% downpayment is never committed, so it reserves no stock.
function deducts(status: string, downpaymentMet: boolean): boolean {
  if (!downpaymentMet) return false;
  return !/pending|cancel|draft/i.test(status || "");
}

// Payment-driven status (Pending/Partial/Completed) is recomputed from amounts paid.
// Fulfillment statuses (Processing/Workshop/For Delivery) and Cancelled/Draft are left as-is.
// Until the 30% downpayment is met the order is forced to "Pending" — it is not yet
// confirmed, regardless of the status the user picked.
// `dpMetOverride`: itinatakda ng tumatawag kapag alam nitong naabot na ang
// downpayment kahit hindi na ito umaabot sa 30% ng BAGONG kabuuan — hal. kapag
// nadagdagan ng item ang order na kumpirmado na. Kung wala, ang 30% ang masusunod.
function withAutoComplete(status: string, downpayment: number, fullPayment: number, total: number, dpMetOverride?: boolean): string {
  const s = status || "Partial";
  if (/^(cancel|draft)/i.test(s.trim())) return s;
  if (!(dpMetOverride ?? meetsDownpayment(downpayment, fullPayment, total))) return "Pending";
  if (!/^(pending|partial|completed)$/i.test(s.trim())) return s;
  const paid = Number(downpayment) + Number(fullPayment);
  if (Number(total) > 0 && paid >= Number(total)) return "Completed";
  if (paid > 0) return "Partial";
  return "Pending";
}


// Inventory helpers live in lib/orders/inventory.ts (plain module) so this
// "use server" file — which may only export async server actions — and the
// delivery actions can both use them.

// Confirm an order once its 30% downpayment has been met (e.g. paid online via Maya).
// Reserves inventory if not already, and lifts the order off "Pending" to "Partial".
// Idempotent: does nothing if the downpayment isn't met or stock is already reserved.
// Returns the status the order should now carry (caller persists it alongside payment).
export async function confirmIfDownpaymentMet(
  supabase: SupaClient,
  orderId: number,
  status: string,
  downpayment: number,
  fullPayment: number,
  total: number,
): Promise<{ status: string; reserved: boolean }> {
  if (!meetsDownpayment(downpayment, fullPayment, total)) return { status, reserved: false };
  const { data } = await supabase
    .from("orders")
    .select("inventory_deducted, receipt_items")
    .eq("id", orderId)
    .limit(1);
  const already = !!data?.[0]?.inventory_deducted;
  // Only reserve for genuinely committed statuses; "Pending"/Cancelled/Draft stay as-is.
  const nextStatus = withAutoComplete(status, downpayment, fullPayment, total);
  const commit = deducts(nextStatus, true);
  if (commit && !already) {
    const items = (data?.[0]?.receipt_items as OrderItem[]) ?? [];
    if (items.length) {
      await deductInventory(supabase, items);
      await supabase.from("orders").update({ inventory_deducted: true }).eq("id", orderId);
      // Heal any drift so reserved always matches confirmed-but-unshipped lines.
      await resyncReserved(supabase);
      return { status: nextStatus, reserved: true };
    }
  }
  return { status: nextStatus, reserved: false };
}

export type ReceiptPayload = {
  mop: string | null;
  downpayment: number;
  total: number;
  items: { qty: number; description: string; unitPrice: number; image?: string | null }[];
  discounts: { label: string; amount: number }[];
  paymentTerms: { label: string; amount: number }[];
};

// Persist the editable receipt data onto the order so it auto-loads next time.
export async function saveReceipt(
  orderId: number,
  data: ReceiptPayload,
): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/orders", "orders");
  const supabase = createServerSupabase();
  const before = await snapshot("orders", orderId);
  const { error } = await supabase
    .from("orders")
    .update({
      mop: data.mop || null,
      receipt_items: data.items,
      receipt_discounts: data.discounts,
      receipt_payment_terms: data.paymentTerms,
      // WALANG downpayment_price DITO. Ang order_payments ledger ang may hawak
      // ng mirror na iyon (resyncOrderColumns); ang pagsulat mula sa receipt
      // modal ay pumapatong sa naitalang bayad, at ibinabalik naman ito ng
      // susunod na recordPayment — kaya nagpapalit-palit ang halaga nang
      // walang nagbabago sa totoong bayad. Ito ang huling sumisira sa panuntunan.
      full_payment_price: data.total,
    })
    .eq("id", orderId);

  if (error) return { error: error.message };
  // ANG KABUUAN AY MAAARING NAGBAGO, kaya ang 30% na hangganan ay iba na rin.
  // Kung hindi ire-resync, nananatiling "Completed" ang order na may balanse,
  // at hindi natitingnan muli ng deducts() ang stock.
  // BANTAY: ang resync ay kumukuha ng bayad MULA SA LEDGER. Ang mga lumang
  // order ay binackfill ng 0068, pero kung may nakalusot (blangkong ledger
  // gayong may naitalang bayad), ang resync ay isusulat itong zero at
  // mabubura ang bayad. Mas mabuting laktawan kaysa magbura.
  try {
    const { data: pay } = await supabase.from("order_payments").select("id").eq("order_id", orderId).limit(1);
    const hasLedger = (pay ?? []).length > 0;
    const b = (before ?? {}) as { downpayment_price?: number | null; full_payment?: number | null };
    const hadPaid = (Number(b.downpayment_price) || 0) > 0 || (Number(b.full_payment) || 0) > 0;
    if (hasLedger || !hadPaid) {
      const { resyncOrderColumns } = await import("@/lib/orders/payments");
      await resyncOrderColumns(supabase, orderId);
    }
  } catch { /* hindi hinaharang ang pag-save ng resibo */ }
  await auditAfter({ module: "orders", table: "orders", recordId: orderId, action: "update", before, snapshotTable: "orders", snapshotId: orderId });
  revalidatePath("/orders");
  revalidatePath("/initial-sales");
  revalidatePath("/operations/approval");
  return { ok: true };
}

export type EditOrder = {
  order_number: string;
  date_order: string | null;
  customer_name: string;
  address: string | null;
  address_lat: number | null;
  address_lng: number | null;
  contact_number: string | null;
  // Alternatibong kontak (0224) — pangalawang tawagan + relasyon.
  alt_contact_number?: string | null;
  alt_contact_relation?: string | null;
  email: string | null;
  fb_name: string | null;
  fb_link: string | null;
  source: string | null;
  status: string;
  assigned: string | null;
  workshop_date: string | null;
  date_of_delivery: string | null;
  date_downpayment: string | null;
  full_payment_date: string | null;
  downpayment: number;
  full_payment: number;
  total: number;
  items: { qty: number; description: string; unitPrice: number; image?: string | null; sku?: string | null; category?: string | null; color?: string | null; dimension?: string | null }[];
  transaction_images: string[];
  // Images the user explicitly removed in this edit session. These are deleted
  // from the DB even if they were auto-attached (receipts/slips) after the form
  // opened — otherwise the auto-attach keep-filter would resurrect them.
  removed_images?: string[];
  // Rush tag mula sa Edit Order (kaya rin ng Sales & Service): may taning na
  // ILANG ARAW ang order na ito. rush_days = per-order deadline; null habang
  // naka-rush = gamitin ang global threshold.
  is_rush?: boolean;
  rush_days?: number | null;
};

export async function updateOrder(
  id: number,
  input: EditOrder,
): Promise<{ ok: true } | { error: string }> {
  // The Edit Order modal is reachable from Sales Orders AND the Operations Order
  // Approval board (row click, to set schedule/delivery) — allow either module's
  // editors. Ops accounts don't carry orders:edit, which made Approval edits 403
  // on the tablet. Return (don't throw) so a denied save shows as a form error
  // instead of crashing the page ("this page couldn't load").
  try { await requireAnyEdit(["orders", "ops_approval"]); }
  catch { return { error: "Forbidden — this account can't edit orders. Ask an admin to grant Orders or Order Approval edit." }; }
  // A pure Sales role can't edit a CONFIRMED order (server enforcement of the read-only
  // view). Once the order is past Pending/Awaiting Payment, only Ops/admin may change it.
  try {
    const me = await getSession();
    if (me?.role === "sales_staff") {
      const guardDb = createServerSupabase();
      const { data: srow } = await guardDb.from("orders").select("status").eq("id", id).maybeSingle();
      const st = (srow?.status ?? "").trim();
      const confirmedForSales = st !== "" && !/^(pending|draft|awaiting|unpaid|cancel)/i.test(st);
      if (confirmedForSales) return { error: "This order is confirmed — Sales can't edit it. Ask Operations to make changes." };
    }
  } catch { /* if the session/status read fails, fall through to the normal edit */ }
  if (!input.customer_name?.trim()) return { error: "Customer name is required." };
  let remaining: number | null = null;
  if (input.date_of_delivery) {
    const ms = new Date(input.date_of_delivery).getTime() - Date.now();
    remaining = Math.max(0, Math.ceil(ms / 86_400_000));
  }
  const items = input.items ?? [];
  const first = items[0];
  const firstLine = (first?.description ?? "").split("\n")[0].trim();
  const productSummary = items.length > 1 ? `${firstLine} (+${items.length - 1} more)` : (firstLine || null);

  const supabase = createServerSupabase();
  const auditBefore = await snapshot("orders", id);

  // Sync inventory with status: deduct when newly committed, restore when un-committed.
  // downpayment_price / full_payment are LEDGER-OWNED (recordPayment → resyncOrderColumns).
  // The Edit form no longer edits them, so read the current DB values and use those for
  // the downpayment-met / status calc — never overwrite the mirrors from the form (that
  // was wiping payments recorded via Mark Paid).
  const { data: cur } = await supabase.from("orders").select("inventory_deducted, receipt_items, downpayment_price, full_payment, full_payment_price, transaction_images").eq("id", id).limit(1);
  const already = !!cur?.[0]?.inventory_deducted;
  const curDp = Number(cur?.[0]?.downpayment_price) || 0;
  const curFull = Number(cur?.[0]?.full_payment) || 0;
  // ANG NAKAMIT NANG DOWNPAYMENT AY HINDI BINABAWI. Ang panuntunan ay 30% ng
  // kabuuan, kaya kapag tumaas ang kabuuan (nadagdagan ng item), tumataas din
  // ang hangganan — at ang order na kumpirmado na ay babagsak sa "Pending",
  // ibabalik ang stock ng BUONG order, at mawawalan ng reserba ang kamang
  // ginagawa na sa workshop. Kapag naabot na ito noon, nananatili itong abot;
  // ang dagdag ay sinisingil sa balanse (o kinokolekta nang hiwalay).
  //
  // ANG KATIBAYAN AY ANG RESERBA MISMO, hindi ang lumang kabuuan. Ang order ay
  // nakapag-reserba lang kung naabot ang downpayment noon (deducts() ang
  // humaharang), kaya ang `already` ay sapat na patunay. Kung ang lumang
  // kabuuan ang susundin, mabibigo ang PANGALAWANG pagdagdag: ang kabuuan noon
  // ay ang unang nadagdagan na, at kulang na rin doon ang naunang bayad.
  const dpMet = meetsDownpayment(curDp, curFull, money(input.total)) || already;
  // Auto-attached images (BIR receipts in /receipts/, Maya slip proofs in
  // /terminal-slips/) can land in the DB AFTER the form was opened (an in-flight
  // scan while the user edits), so they won't be in the form's list — preserve
  // them. EXCEPT anything the user explicitly removed this session: delete those
  // even though they're receipts/slips, or the keep-filter would resurrect them.
  const formImages = input.transaction_images ?? [];
  const removed = new Set(input.removed_images ?? []);
  const dbImages = ((cur?.[0]?.transaction_images as string[] | null) ?? []).filter(Boolean);
  const keptReceipts = dbImages.filter(
    (u) => /\/(receipts|terminal-slips|acknowledgements|warranty-forms|warranty-signatures|cash-proof)\//.test(u) && !formImages.includes(u) && !removed.has(u),
  );
  const mergedImages = [...formImages.filter((u) => !removed.has(u)), ...keptReceipts];
  const commit = deducts(input.status, dpMet);
  const willDeduct = commit && !already;
  const willRestore = !commit && already;
  const prevItems = (cur?.[0]?.receipt_items as OrderItem[]) ?? [];
  if (willDeduct) await deductInventory(supabase, items);
  // Restore against the items as they were when deducted (old receipt_items), not the edited ones.
  if (willRestore) await restoreInventory(supabase, prevItems.length ? prevItems : items);
  // NANATILING NAKA-COMMIT PERO NAGBAGO ANG LAMAN. Dating walang nangyayari
  // dito: ang idinagdag na item ay hindi nirereserba (`already` ay totoo na),
  // kaya nananatili itong nabibenta sa iba kahit nasa order na. Ang
  // ipinagkaiba lang ang kinikilos — hindi ginagalaw ang hindi nagbago.
  if (commit && already) await adjustInventory(supabase, prevItems, items);
  if (willDeduct || willRestore || (commit && already)) await resyncReserved(supabase); // heal drift after any change
  const deducted = willDeduct ? true : willRestore ? false : already;

  const { error } = await supabase
    .from("orders")
    .update({
      order_number: input.order_number || null,
      date_order: input.date_order || null,
      customer_name: input.customer_name.trim(),
      Source: input.source || null,
      address: input.address || null,
      address_lat: input.address_lat ?? null,
      address_lng: input.address_lng ?? null,
      contact_number: input.contact_number || null,
      email: input.email || null,
      fb_name: input.fb_name?.trim() || null,
      fb_link: input.fb_link?.trim() || null,
      // Parehong pasya ng inventory sa itaas — kung hindi, mananatiling
      // "Pending" ang order gayong hindi naman ibinalik ang stock nito.
      status: withAutoComplete(input.status, curDp, curFull, money(input.total), dpMet),
      assigned: input.assigned || null,
      product_name: productSummary,
      sku: first?.sku ?? null,
      category: first?.category ?? null,
      color: first?.color ?? null,
      dimension: first?.dimension ?? null,
      workshop_date: input.workshop_date || null,
      date_of_delivery: input.date_of_delivery || null,
      date_downpayment: input.date_downpayment || null,
      full_payment_date: input.full_payment_date || null,
      remaining_days: remaining,
      // downpayment_price + full_payment intentionally NOT written here — they are
      // owned by the payment ledger (resyncOrderColumns). Only the total is set.
      full_payment_price: money(input.total),
      receipt_items: items.length ? items : null,
      transaction_images: mergedImages,
      inventory_deducted: deducted,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  // Alternatibong kontak (0224) — HIWALAY na best-effort update, gaya ng rush:
  // kapag hindi pa naitatakbo ang 0224, hindi masisira ang buong save. Sinusulat
  // pati ang blangko para MABURA ang maling laman.
  if (input.alt_contact_number !== undefined || input.alt_contact_relation !== undefined) {
    await supabase.from("orders").update({
      alt_contact_number: input.alt_contact_number?.trim() || null,
      alt_contact_relation: input.alt_contact_relation?.trim() || null,
    }).eq("id", id);
  }

  // Rush tag — HIWALAY na best-effort update: kapag hindi pa naitatakbo ang
  // migration 0136 (rush_days column), hindi dapat masira ang buong save.
  if (input.is_rush !== undefined) {
    try {
      await supabase
        .from("orders")
        .update({
          is_rush: !!input.is_rush,
          rush_days: input.is_rush ? (Number(input.rush_days) > 0 ? Math.round(Number(input.rush_days)) : null) : null,
        })
        .eq("id", id);
    } catch { /* best-effort — tumakbo na ang pangunahing save */ }
  }

  await auditAfter({ module: "orders", table: "orders", recordId: id, action: "update", before: auditBefore, snapshotTable: "orders", snapshotId: id });
  revalidatePath("/orders");
  revalidatePath("/initial-sales");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/operations/approval");   // a committed order shows up in To-Assign
  revalidatePath("/workshop");
  revalidatePath("/delivery");
  return { ok: true };
}

export async function deleteOrder(id: number): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/orders", "orders");
  const supabase = createServerSupabase();
  const auditBefore = await snapshot("orders", id);
  // If this order had reserved inventory, give it back before deleting.
  const { data: cur } = await supabase.from("orders").select("inventory_deducted, receipt_items").eq("id", id).limit(1);
  const o = cur?.[0];
  if (o?.inventory_deducted && Array.isArray(o.receipt_items)) {
    await restoreInventory(supabase, o.receipt_items as OrderItem[]);
  }
  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) return { error: error.message };
  await resyncReserved(supabase); // the deleted order no longer holds any reservation
  await audit({ module: "orders", table: "orders", recordId: id, action: "delete", before: auditBefore });
  revalidatePath("/orders");
  revalidatePath("/initial-sales");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/operations/approval");
  return { ok: true };
}

// Edit the rush countdown threshold (days from order date). Stored in app_settings.
export async function saveRushThreshold(days: number): Promise<{ ok: true } | { error: string }> {
  try { await requireAnyEdit(["ops_approval"]); }
  catch { return { error: "Forbidden — needs Order Approval edit access." }; }
  const d = Math.round(Number(days));
  if (!Number.isFinite(d) || d < 1 || d > 365) return { error: "Enter 1–365 days." };
  const supabase = createServerSupabase();
  const { error } = await supabase.from("app_settings").upsert(
    { key: "rush_threshold_days", value: d, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return { error: error.message };
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/workshop/jobs");
  revalidatePath("/delivery");
  revalidatePath("/installation");
  return { ok: true };
}

// Toggle the manual Rush flag on an order. Set only from Order Approval; every
// other module (Tracker, Workshop, Delivery, Installation) shows it read-only.
export async function setOrderRush(id: number, isRush: boolean): Promise<{ ok: true } | { error: string }> {
  try { await requireAnyEdit(["ops_approval"]); }
  catch { return { error: "Forbidden — needs Order Approval edit access." }; }
  const supabase = createServerSupabase();
  const before = await snapshot("orders", id);
  const { error } = await supabase.from("orders").update({ is_rush: !!isRush }).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "orders", table: "orders", recordId: id, action: "update", before, snapshotTable: "orders", snapshotId: id });
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/workshop");
  revalidatePath("/workshop/jobs");
  revalidatePath("/delivery");
  revalidatePath("/installation");
  return { ok: true };
}

export type NewOrder = {
  order_number: string;
  date_order: string | null;
  customer_name: string;
  address: string | null;
  landmark?: string | null; // landmark / delivery notes — pantapos sa huling 50m ng driver
  address_lat: number | null;
  address_lng: number | null;
  contact_number: string | null;
  // Alternatibong kontak (0224, 2026-09-01): pangalawang numero + relasyon sa
  // customer (asawa, anak…) — pantawag kapag hindi masagot ang pangunahin.
  alt_contact_number?: string | null;
  alt_contact_relation?: string | null;
  email: string | null;
  fb_name: string | null;   // customer's Facebook display name (orders often come from Messenger)
  fb_link: string | null;   // FB profile / Messenger URL — clickable in order detail + PAN Overall
  // Messenger PSID mula sa fb_contacts picker — pag may laman, matatanggap ng
  // customer ang order/PAID updates mismo sa Messenger thread nila.
  customer_psid?: string | null;
  mop: string | null;
  status: string;
  assigned: string | null;
  workshop_date: string | null;
  date_of_delivery: string | null;
  date_downpayment: string | null;
  full_payment_date: string | null;
  downpayment: number;
  full_payment: number;
  total: number; // manual Total Amount (overrides line-item sum)
  // How the downpayment is collected. "email_qr" (default) auto-emails the QR Ph
  // for the 30% online (any bank / e-wallet); "cash"/"terminal" are paid in-store,
  // so NO QR is emailed — the receipt goes out later, once the payment is recorded
  // at the counter. ("terminal" = Maya POS machine, recorded manually for now.)
  // "terminal" retired 2026-08-16 (tinanggap pa rin para sa lumang callers);
  // ang mga transfer channel ay kapareho ng Installation collection.
  payment_method?: "email_qr" | "cash" | "terminal" | "bdo" | "bpi" | "gcash" | "maya";
  // INITIAL SALES (2026-08-10): true kapag galing sa /initial-sales — pag-encode
  // ng mga LUMANG order, kaya WALANG email na ipinapadala sa customer sa create.
  // Ang mga susunod na daloy (delivery emails, warranty) ay normal pa rin.
  suppress_emails?: boolean;
  // Showroom kung saan naganap ang sale (San Pedro / Carmona) — PAN Overall tagging.
  branch?: string | null;
  // Rush tag mula sa Create Order. Ang taning ay ang date_of_delivery mismo;
  // ang rush_days (order date → delivery date) ang threshold ng countdown na
  // RushBadge sa Orders/Operations/Delivery/Installation.
  is_rush?: boolean;
  rush_days?: number | null;
  items: { qty: number; description: string; unitPrice: number; image?: string | null; sku?: string | null; category?: string | null; color?: string | null; dimension?: string | null }[];
  discounts: { label: string; amount: number }[];
  paymentTerms: { label: string; amount: number }[];
};

export async function createOrder(
  input: NewOrder,
): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/orders", "orders");
  if (!input.customer_name?.trim()) return { error: "Customer name is required." };
  if (input.items.length === 0) return { error: "Add at least one line item." };

  const subtotal = input.items.reduce((s, it) => s + qty(it.qty) * money(it.unitPrice), 0);
  const discount = input.discounts.reduce((s, x) => s + money(x.amount), 0);
  // Use manual Total Amount if given (>0); else line-item sum minus discounts.
  const total = money(input.total) > 0 ? money(input.total) : Math.max(0, subtotal - discount);

  // Days left from delivery date.
  let remaining: number | null = null;
  if (input.date_of_delivery) {
    const ms = new Date(input.date_of_delivery).getTime() - Date.now();
    remaining = Math.max(0, Math.ceil(ms / 86_400_000));
  }

  const firstLine = (input.items[0]?.description ?? "").split("\n")[0] || "Order";
  const productSummary = input.items.length > 1 ? `${firstLine} (+${input.items.length - 1} more)` : firstLine;

  const supabase = createServerSupabase();
  const dpMet = meetsDownpayment(money(input.downpayment), money(input.full_payment), total);
  const willDeduct = deducts(input.status, dpMet);

  // SHOWROOM AUTO-TAG: pag walang piniling branch, kunin sa home showroom ng
  // naka-assign na sales rep (employees.branch, migration 0147) — para bawat
  // sale ay may San Pedro / Carmona tag sa PAN Overall nang walang extra hakbang.
  let branch = input.branch?.trim() || null;
  if (!branch && input.assigned?.trim()) {
    try {
      const { data: emp } = await supabase.from("employees").select("*")
        .ilike("name", input.assigned.trim()).limit(1).maybeSingle();
      const b = (emp as Record<string, unknown> | null)?.branch;
      if (typeof b === "string" && b.trim()) branch = b.trim();
    } catch { /* optional column pa (0147) */ }
  }

  // Order number is SERVER-assigned from a Postgres sequence (next_order_number())
  // so concurrent creates can't collide and deletes don't reuse/gap numbers — the
  // client-sent value is only an admin override. If an explicit number was passed
  // and it collides on the unique index, we retry once with a fresh sequence value.
  // SUSUNOD NA NUMERO = pinakamataas na umiiral + 1 (2026-08-23): kapag
  // naubos/na-delete ang orders, babalik sa ORD-000001 — hindi tumutuloy ang
  // lumang sequence. Ang banggaan ng sabay na create ay nasasalo ng unique
  // index + retry sa ibaba; ang RPC sequence ay fallback lang kapag hindi
  // mabasa ang table.
  async function nextNumber(): Promise<string | null> {
    return nextDocNumber(supabase, "orders", "order_number", "ORD", "next_order_number");
  }
  let orderNumber = input.order_number?.trim() || (await nextNumber());

  async function insertOrder(num: string | null) {
    return supabase.from("orders").insert({
    order_number: num,
    date_order: input.date_order || null,
    customer_name: input.customer_name.trim(),
    Source: input.mop || null,
    mop: input.mop || null,
    address: input.address || null,
    // Conditional — huwag masira bago tumakbo ang migration 0157.
    ...(input.landmark?.trim() ? { landmark: input.landmark.trim() } : {}),
    address_lat: input.address_lat ?? null,
    address_lng: input.address_lng ?? null,
    contact_number: input.contact_number || null,
    // Conditional — huwag masira bago tumakbo ang migration 0224.
    ...(input.alt_contact_number?.trim() ? { alt_contact_number: input.alt_contact_number.trim() } : {}),
    ...(input.alt_contact_relation?.trim() ? { alt_contact_relation: input.alt_contact_relation.trim() } : {}),
    email: input.email || null,
    fb_name: input.fb_name?.trim() || null,
    fb_link: input.fb_link?.trim() || null,
    product_name: productSummary,
    status: withAutoComplete(input.status, money(input.downpayment), money(input.full_payment), total),
    assigned: input.assigned || null,
    // Conditional para hindi masira ang Create Order bago tumakbo ang migration 0147.
    ...(branch ? { branch } : {}),
    // Conditional — huwag masira bago tumakbo ang migration 0136 (rush_days).
    ...(input.is_rush ? { is_rush: true, rush_days: Number(input.rush_days) > 0 ? Math.round(Number(input.rush_days)) : null } : {}),
    workshop_date: input.workshop_date || null,
    date_of_delivery: input.date_of_delivery || null,
    date_downpayment: input.date_downpayment || null,
    full_payment_date: input.full_payment_date || null,
    remaining_days: remaining,
    downpayment_price: money(input.downpayment),
    full_payment: money(input.full_payment),
    full_payment_price: total,
    receipt_items: input.items,
    receipt_discounts: input.discounts,
    receipt_payment_terms: input.paymentTerms,
    // Insert as NOT deducted; we deduct AFTER the order row exists (below) and flip
    // this to true only once the deduct fully succeeds — so a failed insert can't
    // leak stock, and the flag never claims a deduct that didn't happen.
    inventory_deducted: false,
    }).select("id").single();
  }

  let { data: inserted, error } = await insertOrder(orderNumber);
  // Unique-violation on order_number (Postgres 23505) → another insert grabbed it
  // (or the admin override collided). Retry once with a fresh sequence value.
  if (error && error.code === "23505") {
    orderNumber = await nextNumber();
    ({ data: inserted, error } = await insertOrder(orderNumber));
  }

  if (error) return { error: error.message };
  await auditAfter({ module: "orders", table: "orders", recordId: inserted?.id ?? "—", action: "insert", snapshotTable: "orders", snapshotId: inserted?.id });

  // Itali ang Messenger thread ng napiling FB contact (best-effort — kailangan
  // ng migration 0135; kung wala pa ang customer_psid column, hindi dapat
  // masira ang order create, kaya hiwalay itong update).
  if (input.customer_psid && inserted?.id) {
    try {
      await supabase.from("orders").update({ customer_psid: input.customer_psid }).eq("id", inserted.id);
    } catch { /* best-effort */ }
  }

  // Remember a manually-entered FB profile link against the matching contact, so a
  // repeat customer's link auto-fills next time. Best-effort by exact name match.
  //
  // URL LANG ang tinatanggap: may nag-type ng "test" dito noon at na-save iyon sa
  // fb_contacts — mula noon ang contact ay may "profile" na badge sa picker at
  // "test" ang inilalagay sa link ng bawat susunod na order (nilinis 2026-08-09).
  // Hindi rin itinatago ang MGA GAWA NATING inbox link (business.facebook.com…)
  // — thread iyon, hindi profile ng customer.
  const fbNm = input.fb_name?.trim();
  const fbLk = input.fb_link?.trim();
  const looksLikeProfileUrl =
    !!fbLk &&
    /^(https?:\/\/)?(www\.|web\.|m\.)?(facebook\.com|fb\.com|m\.me)\//i.test(fbLk) &&
    !/business\.facebook\.com|\/inbox\//i.test(fbLk);
  if (fbNm && fbLk && looksLikeProfileUrl) {
    await supabase.from("fb_contacts").update({ profile_url: fbLk }).ilike("name", fbNm).then(() => {}, () => {});
  }

  // Deduct inventory ONLY now that the order row exists (insert-then-deduct). This way a
  // failed insert can never leak stock. If the deduct fails (or partially fails), the
  // order is still saved — better than phantom stock loss — and inventory_deducted stays
  // false so the shortfall is visible and can be reconciled later. We only flip the flag
  // to true on a fully successful deduct. The deduct itself is race-safe (fn_inventory_apply).
  if (willDeduct && inserted?.id) {
    let deducted = false;
    try {
      deducted = await deductInventory(supabase, input.items);
    } catch (e) {
      console.error("createOrder: inventory deduct threw — order saved, inventory_deducted left false", inserted.id, e);
    }
    if (deducted) {
      const { error: flagErr } = await supabase.from("orders").update({ inventory_deducted: true }).eq("id", inserted.id);
      if (flagErr) console.error("createOrder: failed to set inventory_deducted after successful deduct", inserted.id, flagErr.message);
    } else {
      console.error("createOrder: inventory deduct did not fully succeed — order saved, inventory_deducted left false (reconcile stock)", inserted.id);
    }
    await resyncReserved(supabase); // heal reserved to match the newly-committed order
  }

  // Auto-send the "For Payment" email (30% downpayment QR) for online orders that
  // still owe a downpayment. Best-effort; dynamic import avoids a static import cycle
  // with the server-only payment module (which imports this file). Failures don't
  // block order creation. forPaymentEmailCore is a SERVER-ONLY helper (not a server
  // action), so calling it here doesn't expose it as a POST endpoint.
  // Cash/Card in-store orders skip the QR email — they pay at the counter and get
  // the receipt when that payment is recorded.
  const wantsQrEmail = (input.payment_method ?? "email_qr") === "email_qr" && !input.suppress_emails;
  if (inserted?.id && input.email?.trim() && total > 0 && !dpMet && wantsQrEmail) {
    try {
      const { forPaymentEmailCore } = await import("@/lib/orders/internal");
      await forPaymentEmailCore(inserted.id);
    } catch { /* best-effort */ }
  }

  // Push: notify Operations to approve ONLY once the order is confirmed by its
  // downpayment. An unpaid order isn't in the approval queue yet (loadToAssign gates
  // on downpaymentMet), so alerting on creation fired on an empty queue. Cash/terminal
  // orders that record their downpayment later fire this from collectManualPayment
  // instead. Best-effort — a failed push never blocks order creation.
  if (inserted?.id && dpMet) {
    try {
      const { notifyOpsNewApproval } = await import("@/lib/push/notify");
      await notifyOpsNewApproval({
        orderNumber: orderNumber ?? `#${inserted.id}`,
        product: productSummary,
        total,
        customer: input.customer_name?.trim() || null,
      });
    } catch { /* best-effort */ }
  }

  revalidatePath("/orders");
  revalidatePath("/initial-sales");
  revalidatePath("/dashboard");
  return { ok: true };
}

// ── DAGDAG NA ITEM SA ORDER NA MAYROON NA (2026-08-22) ──────────────────────
// Ang customer na may order ay madalas humihingi ng dagdag: bagong custom build
// mula sa MTO, o yaring unit mula sa showroom. Ang gusto ng team ay IISANG
// order number — tumataas ang kabuuan at ang balanse, lumilipat ang delivery.

export type OpenOrder = {
  id: number;
  order_number: string | null;
  customer_name: string | null;
  contact_number: string | null;
  customer_psid: string | null;
  address: string | null;
  status: string | null;
  total: number;
  paid: number;
  balance: number;
  itemCount: number;
  summary: string | null;
  // Ang laman mismo ng order — dito nakikita ng team kung ito nga ang order
  // na iniisip nila. Ang bilang lang ("2 items") ay walang sinasabi.
  lines: { name: string; qty: number; amount: number }[];
  date_of_delivery: string | null;
  // Paano natugma — ito ang ipinapakita sa team para malaman nila kung gaano
  // katibay ang hula, hindi para itago ito.
  matchedBy: "psid" | "contact" | "name";
};

// Ang mga BUKAS na order ng isang customer. Ang PSID ang pangunahing susi:
// galing ito kay Meta at walang taong nagtitipa niyon. Ang contact ay tinitipa
// (at may tatlong porma ang iisang numero), ang pangalan ay mas malala pa —
// pero kailangan pa rin sila para sa walk-in na walang Messenger.
//
// NAGPAPAKITA LANG ITO. Ang pagpili kung aling order ay sa team — hindi
// awtomatiko, dahil ang maling tugma ay naglalagay ng singil sa ibang tao.
export async function findOpenOrders(who: {
  psid?: string | null;
  contact?: string | null;
  name?: string | null;
}): Promise<OpenOrder[]> {
  const me = await getSession();
  if (!me) return [];
  const db = createServerSupabase();

  const COLS =
    "id, order_number, customer_name, contact_number, customer_psid, address, status, full_payment_price, downpayment_price, full_payment, receipt_items, product_name, date_of_delivery";
  // Tapos na ang Delivered at Cancelled — walang idadagdag doon.
  const isOpen = (s: string | null) => !/^(delivered|cancel)/i.test((s ?? "").trim());
  // "0917 234 4821", "09172344821" at "+639172344821" ay iisang telepono.
  const digits = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "").replace(/^63/, "0");
  const norm = (v: string | null | undefined) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

  type Row = Record<string, unknown>;
  const seen = new Set<number>();
  const out: OpenOrder[] = [];

  const collect = (rows: Row[], matchedBy: OpenOrder["matchedBy"]) => {
    for (const r of rows) {
      const id = Number(r.id);
      if (seen.has(id) || !isOpen(r.status as string | null)) continue;
      seen.add(id);
      const total = Number(r.full_payment_price) || 0;
      const paid = (Number(r.downpayment_price) || 0) + (Number(r.full_payment) || 0);
      const items = (r.receipt_items as { description?: string; qty?: number; unitPrice?: number }[] | null) ?? [];
      // Unang linya lang ng description — ang mga bullet sa ilalim ay ang
      // pagkakabuo, at masyadong mahaba para sa listahan ng pinagpipilian.
      // Ang mga bayad (Shipping/Rush) ay hindi produkto, kaya hindi kasama.
      const lines = items
        .map((it) => ({
          name: String(it.description ?? "").split("\n")[0].trim(),
          qty: Number(it.qty) || 1,
          amount: (Number(it.unitPrice) || 0) * (Number(it.qty) || 1),
        }))
        .filter((l) => l.name && !/^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test(l.name));
      out.push({
        id,
        order_number: (r.order_number as string) ?? null,
        customer_name: (r.customer_name as string) ?? null,
        contact_number: (r.contact_number as string) ?? null,
        customer_psid: (r.customer_psid as string) ?? null,
        address: (r.address as string) ?? null,
        status: (r.status as string) ?? null,
        total,
        paid,
        balance: Math.max(0, total - paid),
        itemCount: lines.length,
        summary: (r.product_name as string) ?? null,
        lines,
        date_of_delivery: (r.date_of_delivery as string) ?? null,
        matchedBy,
      });
    }
  };

  // 1) PSID — ang tanging maaasahan.
  if (who.psid?.trim()) {
    const { data } = await db.from("orders").select(COLS).eq("customer_psid", who.psid.trim()).order("id", { ascending: false }).limit(20);
    collect((data ?? []) as Row[], "psid");
  }

  // 2) Contact — inihahambing ang mga digit lang, kaya hindi nakakaligtaan ang
  // magkaibang porma ng iisang numero. Ang paghahambing ay ginagawa rito
  // dahil hindi kayang i-normalize ng PostgREST ang column.
  const wantDigits = digits(who.contact);
  if (wantDigits.length >= 10) {
    const { data } = await db.from("orders").select(COLS).not("contact_number", "is", null).order("id", { ascending: false }).limit(400);
    collect(((data ?? []) as Row[]).filter((r) => digits(r.contact_number as string) === wantDigits), "contact");
  }

  // 3) Pangalan — ang pinakamahina; nariyan para sa walk-in na walang PSID.
  const wantName = norm(who.name);
  if (wantName) {
    const { data } = await db.from("orders").select(COLS).ilike("customer_name", wantName).order("id", { ascending: false }).limit(20);
    collect(((data ?? []) as Row[]).filter((r) => norm(r.customer_name as string) === wantName), "name");
  }

  return out;
}

// ANG PAGDAGDAG NG ITEM SA ORDER NA MAYROON NA — iisang landas para sa MTO
// (may FQ) at sa yaring stock (wala).
//
// IISANG AKSYON, HINDI HIWA-HIWALAY: ang kabuuan, ang status, ang stock at ang
// resibo ay magkakasabay na gumagalaw. Kapag pinaghiwa-hiwalay, maaaring
// magtagumpay ang isa habang bumibigo ang iba, at ang order ay maglalarawan ng
// kalagayang hindi kailanman nangyari.
export async function addItemsToOrder(input: {
  orderId: number;
  items: { qty: number; description: string; unitPrice: number; image?: string | null; sku?: string | null; category?: string | null }[];
  // Saan galing ang idinagdag — nakatala sa BAWAT LINYA, hindi sa order, dahil
  // ang isang order ay maaaring may tatlong magkaibang pinagmulan.
  sourceMto?: string | null;
  sourceFq?: string | null;
  // Bagong petsa ng delivery: ang order ay may isang biyahe, kaya ang custom
  // build na idinagdag ay nagtutulak nito.
  deliveryDate?: string | null;
  // Kinumpirma ng team na ito ang tamang customer. Hindi pormalidad — ang
  // maling tugma ay naglalagay ng singil sa ibang tao.
  confirmed: boolean;
}): Promise<{ ok: true; orderNumber: string | null; total: number; balance: number } | { error: string }> {
  try { await requireAnyEdit(["orders", "ops_approval"]); }
  catch { return { error: "Forbidden — this account can't edit orders." }; }
  if (!input.confirmed) return { error: "Please confirm this is the right customer's order first." };
  const adds = (input.items ?? []).filter((it) => String(it.description ?? "").trim());
  if (!adds.length) return { error: "Nothing to add." };

  const supabase = createServerSupabase();
  const before = await snapshot("orders", input.orderId);
  const { data: cur } = await supabase
    .from("orders")
    .select("id, order_number, status, receipt_items, inventory_deducted, full_payment_price, downpayment_price, full_payment, date_of_delivery")
    .eq("id", input.orderId)
    .maybeSingle();
  if (!cur) return { error: "Order not found." };

  const status = String(cur.status ?? "").trim();
  // Tapos na — ang dagdag ay sariling order na.
  if (/^(delivered|cancel)/i.test(status)) {
    return { error: `${cur.order_number ?? "This order"} is ${status.toLowerCase()} — create a separate order instead.` };
  }

  // Ang OrderItem (inventory) ay may qty/description/sku lang; ang naka-imbak
  // na linya ay may presyo rin — kailangan iyon para sa kabuuan.
  type StoredItem = OrderItem & { unitPrice?: number };
  const prevItems = (cur.receipt_items as StoredItem[] | null) ?? [];
  const newItems = [
    ...prevItems,
    ...adds.map((it) => ({
      qty: qty(it.qty) || 1,
      description: String(it.description).trim(),
      unitPrice: money(it.unitPrice),
      image: it.image ?? null,
      ...(it.sku ? { sku: it.sku } : {}),
      ...(it.category ? { category: it.category } : {}),
      // Ang pinagmulan at ang petsa ay nakatala sa linya mismo: kapag tinanong
      // makalipas ang tatlong linggo kung bakit iba ang kabuuan sa napagkasunduan,
      // may sagot.
      ...(input.sourceMto ? { source_mto: input.sourceMto } : {}),
      ...(input.sourceFq ? { source_fq: input.sourceFq } : {}),
      added_at: todayPH(),
    })),
  ];

  // ANG KABUUAN AY MULA SA MGA LINYA, hindi sa form. Ito ang pumipigil na maging
  // libre ang idinagdag — walang ibang koda ang muling kumukuwenta nito.
  const total = money(newItems.reduce((s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.qty) || 0), 0));

  const already = !!cur.inventory_deducted;
  const curDp = Number(cur.downpayment_price) || 0;
  const curFull = Number(cur.full_payment) || 0;
  // Ang naabot nang downpayment ay hindi binabawi — tingnan ang paliwanag sa
  // updateOrder. Ang dagdag ay sinisingil sa balanse o kinokolekta nang hiwalay.
  // Ang `already` ang katibayan na naabot ang downpayment noon — nakapag-reserba
  // lang ang order kung naabot ito. Tingnan ang paliwanag sa updateOrder.
  const dpMet = meetsDownpayment(curDp, curFull, total) || already;
  const commit = deducts(status, dpMet);

  // Reserba PARA SA IDINAGDAG LANG. Ang naunang mga item ay hindi ginagalaw —
  // ang release-tapos-reserve ay magbubukas ng puwang kung saan mabibili ng iba
  // ang kamang ginagawa na.
  if (commit) {
    if (already) await adjustInventory(supabase, prevItems, newItems);
    else await deductInventory(supabase, newItems);
    await resyncReserved(supabase);
  }

  const productSummary = newItems.length > 1
    ? `${String(newItems[0]?.description ?? "").split("\n")[0]} (+${newItems.length - 1} more)`
    : String(newItems[0]?.description ?? "").split("\n")[0] || null;

  const { error } = await supabase
    .from("orders")
    .update({
      receipt_items: newItems,
      full_payment_price: total,
      product_name: productSummary,
      status: withAutoComplete(status, curDp, curFull, total, dpMet),
      inventory_deducted: commit ? true : already,
      ...(input.deliveryDate ? { date_of_delivery: input.deliveryDate } : {}),
      // Ang unang pinagmulan lang ang nasa order; ang bawat linya ay may sarili.
      ...(input.sourceMto && !(before as { mto_number?: string })?.mto_number ? { mto_number: input.sourceMto } : {}),
      ...(input.sourceFq && !(before as { fq_number?: string })?.fq_number ? { fq_number: input.sourceFq } : {}),
    })
    .eq("id", input.orderId);
  if (error) return { error: error.message };

  // ANG NAKA-IMBAK NA BIR RECEIPT AY LUMA NA. Ito ay iniisyu ng attachReceipt
  // kasabay ng isang BAYAD (kailangan nito ang detalye ng bayad), kaya hindi ito
  // maaaring basta patakbuhin dito. Ang thermal/acknowledgement receipt ay
  // binubuo sa bawat print mula sa receipt_items, kaya tama agad iyon; ang BIR
  // na kopya ay mao-overwrite sa susunod na bayad. Ang linyang idinagdag ay may
  // added_at, kaya makikita kung bakit iba ang kabuuan sa lumang kopya.

  await auditAfter({ module: "orders", table: "orders", recordId: input.orderId, action: "update", before, snapshotTable: "orders", snapshotId: input.orderId });
  revalidatePath("/orders");
  revalidatePath("/mto-requests");
  revalidatePath("/operations/approval");
  return { ok: true, orderNumber: (cur.order_number as string) ?? null, total, balance: Math.max(0, total - (curDp + curFull)) };
}
