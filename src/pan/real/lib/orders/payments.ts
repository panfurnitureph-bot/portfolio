import "server-only";
import type { createServerSupabase } from "@/lib/supabase/server";
import type { OrderRow } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { DOWNPAYMENT_RATE, meetsDownpayment } from "@/app/orders/downpayment";

type Db = ReturnType<typeof createServerSupabase>;

export type PaymentKind = "downpayment" | "installment" | "balance" | "refund" | "full";

export type OrderPaymentRow = {
  id: number;
  order_id: number;
  amount: number;
  method: string | null;
  kind: string;
  reference: string | null;
  maya_payment_id: string | null;
  collected_by: string | null;
  paid_at: string;
  created_at: string;
};

// Payment-driven status (Pending/Partial/Completed) recomputed from amounts paid.
// Mirror of withAutoComplete in app/orders/actions.ts (kept local so this stays a plain
// module — actions.ts is "use server" and may only export async functions). Fulfillment
// statuses and Cancelled/Draft are left as-is.
function withAutoComplete(status: string, downpayment: number, fullPayment: number, total: number): string {
  const s = status || "Partial";
  if (/^(cancel|draft)/i.test(s.trim())) return s;
  if (!meetsDownpayment(downpayment, fullPayment, total)) return "Pending";
  if (!/^(pending|partial|completed)$/i.test(s.trim())) return s;
  const paid = Number(downpayment) + Number(fullPayment);
  if (Number(total) > 0 && paid >= Number(total)) return "Completed";
  if (paid > 0) return "Partial";
  return "Pending";
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Signed sum of every ledger row for an order = the authoritative paid total.
export async function paidTotal(db: Db, orderId: number): Promise<number> {
  const { data } = await db.from("order_payments").select("amount").eq("order_id", orderId);
  const sum = (data ?? []).reduce((s, r) => s + (Number((r as { amount: number }).amount) || 0), 0);
  return round2(sum);
}

// Re-sync the order's legacy DERIVED-MIRROR columns from the ledger so every existing
// reader (BIR receipt, balanceOf, PAN income, KPIs) keeps working unchanged:
//   downpayment_price = the recorded downpayment(s) (or the earliest payments up to the
//                       30% due if no row is explicitly tagged 'downpayment'), clamped to total
//   full_payment      = (total positive payments − downpayment_price), clamped to >= 0
// Status is recomputed via the same withAutoComplete logic the rest of the app uses.
// Naka-export (2026-08-22): tinatawag din ito ng saveReceipt at ng add-items
// na daan, na parehong nagbabago ng KABUUAN. Kapag nagbago ang kabuuan, iba na
// ang 30% na hangganan — kaya kailangang muling kuwentahin ang status at ang
// mga mirror, hindi lang kapag may bagong bayad.
export async function resyncOrderColumns(db: Db, orderId: number): Promise<void> {
  const { data: order } = await db.from("orders")
    .select("id, status, full_payment_price")
    .eq("id", orderId).maybeSingle();
  if (!order) return;
  const total = Number((order as Pick<OrderRow, "full_payment_price">).full_payment_price) || 0;

  const { data: rows } = await db.from("order_payments")
    .select("amount, kind, paid_at, id")
    .eq("order_id", orderId)
    .order("paid_at", { ascending: true })
    .order("id", { ascending: true });
  const pays = (rows ?? []) as Pick<OrderPaymentRow, "amount" | "kind" | "paid_at" | "id">[];

  // Net positive vs refunds. Refunds reduce the paid total but aren't a "payment" event.
  const positives = pays.filter((p) => Number(p.amount) > 0);
  const refunds = pays.filter((p) => Number(p.amount) < 0).reduce((s, p) => s + Math.abs(Number(p.amount) || 0), 0);
  const grossPositive = positives.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  // Downpayment mirror: explicit 'downpayment'-kind rows if present; otherwise the
  // earliest positive payments accumulated up to the 30% due (legacy behaviour).
  const explicitDp = positives.filter((p) => p.kind === "downpayment").reduce((s, p) => s + (Number(p.amount) || 0), 0);
  let downpayment: number;
  if (explicitDp > 0) {
    downpayment = explicitDp;
  } else {
    const due = total > 0 ? round2(total * DOWNPAYMENT_RATE) : 0;
    let acc = 0;
    for (const p of positives) {
      acc += Number(p.amount) || 0;
      if (due > 0 && acc >= due) break;
    }
    downpayment = total > 0 ? Math.min(acc, total) : acc;
  }
  downpayment = round2(total > 0 ? Math.min(downpayment, total) : downpayment);

  // full_payment mirror = everything paid beyond the downpayment, net of refunds, clamped.
  let fullPayment = round2(grossPositive - downpayment - refunds);
  if (fullPayment < 0) {
    // Refunds ate into the downpayment portion too — shrink the downpayment mirror.
    downpayment = round2(Math.max(0, downpayment + fullPayment));
    fullPayment = 0;
  }

  const status = withAutoComplete(
    String((order as Pick<OrderRow, "status">).status || "Partial"),
    downpayment, fullPayment, total,
  );

  // DATE mirrors mula sa ledger (2026-08-17 — naiulat na blanko ang Downpmt
  // Date sa table kahit may naitalang DP): pinakauna sa mga downpayment-kind
  // na row ang date_downpayment; ang full_payment_date ay ang PINAKAHULING
  // bayad kapag bayad na nang buo. Self-healing — kahit ma-overwrite ng edit
  // form, naitatama sa susunod na resync.
  const dpDate = positives.find((p) => p.kind === "downpayment")?.paid_at
    ?? (downpayment > 0 ? positives[0]?.paid_at ?? null : null);
  const paidInFull = total > 0 && round2(downpayment + fullPayment) >= total;
  const fullDate = paidInFull ? (positives[positives.length - 1]?.paid_at ?? null) : null;

  await db.from("orders").update({
    downpayment_price: downpayment,
    full_payment: fullPayment,
    status,
    ...(dpDate ? { date_downpayment: dpDate } : {}),
    ...(fullDate ? { full_payment_date: fullDate } : {}),
  }).eq("id", orderId);

  // ANG BAYAD ANG NAGLALAAN NG STOCK (2026-08-29). Ang `reserved` ay binibilang
  // ng fn_inventory_resync_reserved mula sa mga order na hindi pa naipapadala AT
  // bayad na ng 30% — ang pera ang bantay, hindi ang produksyon. Kaya ang mismong
  // sandaling nagiging kwalipikado ang isang order ay DITO, at walang landas ng
  // bayad ang nagre-recompute noon: ang ORD-000013 ay `Partial`, bayad na ng
  // ₱18,750 sa ₱62,500, at `reserved = 0` pa rin — lumalabas ang 118 sa L1-A2 na
  // parang walang nakalaan gayong may tatlong linyang palabas.
  //
  // Best-effort: ang bayad ay naitala na; hindi ito dapat bumagsak dahil sa
  // isang counter na naghihilom mag-isa sa susunod na resync.
  try {
    const { resyncReserved } = await import("@/lib/orders/inventory");
    await resyncReserved(db);
  } catch { /* best-effort */ }
}

export type RecordPaymentInput = {
  orderId: number;
  amount: number;            // positive
  method?: string | null;    // Cash | Bank Transfer | GCash | Maya | Check | Online | Debit/Credit Card
  kind?: PaymentKind;        // default 'installment'
  reference?: string | null;
  mayaPaymentId?: string | null;
  collectedBy?: string | null;
  paidAt?: string | null;    // YYYY-MM-DD; defaults to DB current_date
};

// Insert one ledger row, then re-sync the legacy mirror columns. Idempotent on
// mayaPaymentId: if a row already exists for that Maya payment, do nothing (no double
// insert / double count). Audits the insert. Returns the new row id (or 0 if skipped).
export async function recordPayment(db: Db, input: RecordPaymentInput): Promise<{ id: number; skipped?: boolean }> {
  const amount = round2(input.amount);
  if (!(amount > 0)) return { id: 0, skipped: true };

  // Idempotency: never double-insert the same Maya payment. Even when skipped, still
  // re-sync the mirror columns so they're always reconciled to the ledger (the direct
  // mirror writes in maya-actions were removed; resync is idempotent and safe to repeat).
  if (input.mayaPaymentId) {
    const { data: existing } = await db.from("order_payments")
      .select("id").eq("maya_payment_id", input.mayaPaymentId).maybeSingle();
    if (existing) {
      await resyncOrderColumns(db, input.orderId);
      return { id: (existing as { id: number }).id, skipped: true };
    }
  }

  const insertRow: Record<string, unknown> = {
    order_id: input.orderId,
    amount,
    method: input.method ?? null,
    kind: input.kind ?? "installment",
    reference: input.reference ?? null,
    maya_payment_id: input.mayaPaymentId ?? null,
    collected_by: input.collectedBy ?? null,
  };
  if (input.paidAt) insertRow.paid_at = input.paidAt;

  const { data: inserted, error } = await db.from("order_payments")
    .insert(insertRow).select("id").single();
  if (error) {
    // Unique violation on maya_payment_id (concurrent claim) → treat as already recorded,
    // but still reconcile the mirror columns to the ledger before returning.
    if (error.code === "23505") {
      await resyncOrderColumns(db, input.orderId);
      return { id: 0, skipped: true };
    }
    throw new Error(error.message);
  }
  const id = (inserted as { id: number }).id;

  await resyncOrderColumns(db, input.orderId);
  await audit({ module: "orders", table: "order_payments", recordId: id, action: "insert", after: insertRow });
  return { id };
}

export type RefundInput = {
  orderId: number;
  amount: number;            // positive magnitude (stored negative)
  method?: string | null;
  reason?: string | null;
  collectedBy?: string | null;
  paidAt?: string | null;
};

// Record a refund as a NEGATIVE-amount ledger row, re-sync the mirror columns, audit.
export async function refundPayment(db: Db, input: RefundInput): Promise<{ id: number; skipped?: boolean }> {
  const mag = round2(input.amount);
  if (!(mag > 0)) return { id: 0, skipped: true };

  const insertRow: Record<string, unknown> = {
    order_id: input.orderId,
    amount: -mag,
    method: input.method ?? null,
    kind: "refund",
    reference: input.reason ?? null,
    collected_by: input.collectedBy ?? null,
  };
  if (input.paidAt) insertRow.paid_at = input.paidAt;

  const { data: inserted, error } = await db.from("order_payments")
    .insert(insertRow).select("id").single();
  if (error) throw new Error(error.message);
  const id = (inserted as { id: number }).id;

  await resyncOrderColumns(db, input.orderId);
  await audit({ module: "orders", table: "order_payments", recordId: id, action: "insert", after: insertRow });
  return { id };
}
