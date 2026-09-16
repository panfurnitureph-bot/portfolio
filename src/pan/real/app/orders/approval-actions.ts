"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/rbac";
import { collectManualPayment } from "@/app/orders/maya-actions";

// PAYMENT APPROVAL (2026-08-10) — ang manual na koleksyon sa Installation
// (Cash/BDO/BPI/GCash) ay dumadaan muna dito: ang installer ay NAGSU-SUBMIT
// lang (pending), at ang aprubador sa Payment Approval page ang magpapatala
// sa ledger (collectManualPayment) — saka lang lalabas sa PAN Overall at
// magiging bayad ang order.

export type PaymentApprovalRow = {
  id: number;
  orderId: number;
  orderNumber: string | null;
  // REWORK (2026-08-25): may laman ang dalawang ito kapag koleksyon ng RMA ang
  // hilera — ibang ledger ang tinatalaan ng Approve (returns.rework_downpayment,
  // hindi orders). Ang order_id ay nananatiling puno: laging may pinag-ugatang
  // order ang rework, kaya buo pa ang konteksto sa review desk.
  returnId: number | null;
  returnNo: string | null;
  customer: string | null;
  amount: number;
  method: string;
  collectedBy: string | null;
  submittedBy: string | null;
  proofs: string[];
  status: string;
  note: string | null;
  reviewedBy: string | null;
  createdAt: string;
  // REVIEW DESK (2026-08-24): konteksto para mabilis ang pagpapasya — pera ng
  // order, kasaysayan ng bayad, items, at katayuan. Kinukuha nang batch sa
  // listPaymentApprovals; ang checks ay sa client (lib/payment-checks).
  orderTotal: number;
  paidBefore: number;      // ledger total ng order (order_payments) — bago ang approval na ito
  balanceBefore: number;   // orderTotal − paidBefore (≥ 0)
  orderStatus: string | null;
  orderDate: string | null;
  address: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  items: { qty: number; description: string; unitPrice: number }[];
  // REWORK (2026-08-25) — ang mga detalyeng hindi kailanman nasa orders ledger:
  // ano ang item, bakit kinumpuni, sinong crew, litrato ng sira, at ang hatian
  // ng singil. Walang laman kapag order ang hilera.
  rework: {
    mode: string;                 // On site | Pull out
    target: string | null;        // redeliver | restock
    status: string | null;        // status ng RMA
    itemDesc: string | null;      // pangalan + spec ng item
    sku: string | null;
    category: string | null;
    itemImage: string | null;
    condition: string | null;     // resaleable | defective
    reason: string | null;
    notes: string | null;         // kasama ang bakas ng override
    photos: string[];             // litrato ng sira (returns-photos)
    crew: { id: number; name: string }[];  // on-site repair crew
    workshop: string | null;      // pull-out: saan kinumpuni
    requestedBy: string | null;
    approvedBy: string | null;
    createdAt: string | null;
    // Hatian ng singil: balanse ng order + piyesa + hatid = charge.
    orderBalancePart: number;
    partsTotal: number;
    // ANG LISTAHAN, HINDI LANG ANG TOTAL (2026-08-27). Ang `parts` ay kinukuha
    // na sa DB sa ibaba pero hindi naipapasa — "₱6,500 parts" lang ang nakikita
    // ng aprubador ng bayad, hindi kung anong apat na piyesa iyon.
    partsList: { part: string; qty: number; amount: number }[];
    deliveryPrice: number;
    charge: number;
    paid: number;
    paymentMethod: string | null;
  } | null;
  history: { amount: number; method: string | null; kind: string | null; paidAt: string | null; collectedBy: string | null; reference: string | null }[];
  otherPending: number;    // ibang PENDING approval sa parehong order (posibleng doble)
};

// Pangalan ng naka-login — auto-fill ng "Collected by" kapag walang naipasang
// collectorName ang embed (hal. Edit Order mula sa Operations board): hindi na
// tina-type ang sariling pangalan.
export async function currentCollectorName(): Promise<string> {
  const s = await getSession();
  return s?.full_name?.trim() || s?.email || "";
}

// ── SUBMIT (installer) ───────────────────────────────────────────────────────
export async function submitPaymentApproval(
  orderId: number,
  method: string,
  collectedBy: string,
  proofs: string[],
  dedupeKey: string,
  // Partial na koleksyon (hal. DP sa Edit Order) — naka-cap sa balanse.
  // Walang laman = ang buong balanse (dating gawi ng Installation).
  amountArg?: number,
): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me) return { error: "Forbidden." };
  const db = createServerSupabase();
  const { data: ord } = await db.from("orders")
    .select("order_number, full_payment_price, downpayment_price, full_payment")
    .eq("id", orderId).maybeSingle();
  if (!ord) return { error: "Order not found." };
  const fullBalance = Math.max(
    Math.round(((Number(ord.full_payment_price) || 0) - (Number(ord.downpayment_price) || 0) - (Number(ord.full_payment) || 0)) * 100) / 100,
    0,
  );
  if (fullBalance <= 0) return { error: "No balance to collect." };
  const balance = amountArg && amountArg > 0 ? Math.min(Math.round(amountArg * 100) / 100, fullBalance) : fullBalance;

  const { error } = await db.from("payment_approvals").insert({
    order_id: orderId,
    order_number: ord.order_number ?? null,
    amount: balance,
    method,
    collected_by: collectedBy || null,
    submitted_by: me.full_name?.trim() || me.email || null,
    proof_urls: proofs.filter(Boolean),
    status: "pending",
    dedupe_key: `pa:${dedupeKey}`,
  });
  // Dobleng submit (unique dedupe_key) = ayos lang — pending na ito.
  if (error && !/duplicate|unique/i.test(error.message)) return { error: error.message };
  revalidatePath("/payment-approval");
  return { ok: true };
}

// ── SUBMIT NG REWORK (2026-08-25) ────────────────────────────────────────────
// Kaparehong pila, ibang ledger. Ang koleksyon ng RMA sa Installation ay
// diretsong naitatala noon — isang pindot at bayad na, walang litrato, walang
// pirma, walang aprubador — habang ang koleksyon ng SALES sa parehong screen ay
// dumaraan sa lahat ng iyon. Iisang daanan na ngayon.
export async function submitReworkPaymentApproval(
  returnId: number,
  method: string,
  proofs: string[],
  dedupeKey: string,
  amountArg?: number,
): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me) return { error: "Forbidden." };
  const db = createServerSupabase();
  const { data: ret } = await db.from("returns")
    .select("id, return_no, order_id, resolution, rework_charge_total, rework_downpayment")
    .eq("id", returnId).maybeSingle();
  if (!ret) return { error: "Return not found." };
  if (ret.resolution !== "rework") return { error: "Not a rework." };
  // Ang balanse ay galing sa RMA ledger, hindi sa order: singil na hindi pa
  // nababayaran. Ang ipinasang halaga ay naka-cap dito para hindi makalusot ang
  // sobra mula sa kliyente.
  const charge = Number(ret.rework_charge_total) || 0;
  const balance = Math.max(Math.round((charge - (Number(ret.rework_downpayment) || 0)) * 100) / 100, 0);
  if (balance <= 0) return { error: "Nothing left to collect on this rework." };
  const amount = Math.min(Math.max(Number(amountArg) || balance, 0), balance);
  if (amount <= 0) return { error: "Enter an amount to collect." };
  if (!proofs.filter(Boolean).length) return { error: "Attach the proof photo and signature." };

  // ISANG PENDING KADA RMA (2026-08-25). Ang dedupe_key ay bago kada pagbukas ng
  // screen, kaya hindi ito humaharang sa PANGALAWANG submit: nakapila ang RMA-000001
  // ng dalawang beses, at ang pangalawa ay mag-a-approve ng singil na bayad na.
  // Ang pending ay hinaharang dito; ang bayad na ay nahuhuli ng balance check sa itaas.
  const { data: dup } = await db.from("payment_approvals")
    .select("id").eq("return_id", returnId).eq("status", "pending").limit(1).maybeSingle();
  if (dup) return { error: "This rework already has a payment waiting for approval." };

  const { error } = await db.from("payment_approvals").insert({
    order_id: ret.order_id as number,
    order_number: null,
    return_id: returnId,
    return_no: (ret.return_no as string | null) ?? null,
    amount,
    method,
    collected_by: me.full_name?.trim() || me.email || null,
    submitted_by: me.full_name?.trim() || me.email || null,
    proof_urls: proofs.filter(Boolean),
    status: "pending",
    dedupe_key: `rw:${dedupeKey}`,
  });
  if (error && !/duplicate|unique/i.test(error.message)) return { error: error.message };
  revalidatePath("/payment-approval");
  revalidatePath("/installation");
  return { ok: true };
}

// ── STATUS NG REWORK (poll ng installer) ─────────────────────────────────────
export async function reworkPaymentApprovalStatus(
  returnId: number,
): Promise<{ status: "none" | "pending" | "approved" | "rejected"; note: string | null; method: string | null; amount: number; submittedBy: string | null; createdAt: string | null; proofs: string[] }> {
  const me = await getSession();
  const none = { status: "none" as const, note: null, method: null, amount: 0, submittedBy: null, createdAt: null, proofs: [] as string[] };
  if (!me) return none;
  try {
    const db = createServerSupabase();
    const { data } = await db.from("payment_approvals")
      .select("status, note, method, amount, submitted_by, created_at, proof_urls").eq("return_id", returnId)
      .order("id", { ascending: false }).limit(1).maybeSingle();
    if (!data) return none;
    const st = String(data.status);
    return {
      status: st === "pending" || st === "approved" || st === "rejected" ? st : "none",
      note: (data.note as string | null) ?? null,
      method: (data.method as string | null) ?? null,
      amount: Number(data.amount) || 0,
      submittedBy: (data.submitted_by as string | null) ?? null,
      createdAt: (data.created_at as string | null) ?? null,
      proofs: ((data.proof_urls as string[] | null) ?? []).filter(Boolean),
    };
  } catch {
    return none; // wala pang migration 0195
  }
}

// ── STATUS (poll ng installer) ───────────────────────────────────────────────
// Ang PINAKAHULING approval ng order — ang installer screen ang nagpapasya ng
// itsura: pending = Waiting, approved = Paid, rejected = ipakita ang dahilan.
export async function paymentApprovalStatus(
  orderId: number,
): Promise<{ status: "none" | "pending" | "approved" | "rejected"; note: string | null; method: string | null; amount: number; submittedBy: string | null; createdAt: string | null; proofs: string[] }> {
  const me = await getSession();
  const none = { status: "none" as const, note: null, method: null, amount: 0, submittedBy: null, createdAt: null, proofs: [] as string[] };
  if (!me) return none;
  try {
    const db = createServerSupabase();
    const { data } = await db.from("payment_approvals")
      .select("status, note, method, amount, submitted_by, created_at, proof_urls").eq("order_id", orderId)
      .order("id", { ascending: false }).limit(1).maybeSingle();
    if (!data) return none;
    const st = String(data.status);
    return {
      status: st === "pending" || st === "approved" || st === "rejected" ? st : "none",
      note: (data.note as string | null) ?? null,
      method: (data.method as string | null) ?? null,
      amount: Number(data.amount) || 0,
      submittedBy: (data.submitted_by as string | null) ?? null,
      createdAt: (data.created_at as string | null) ?? null,
      proofs: ((data.proof_urls as string[] | null) ?? []).filter(Boolean),
    };
  } catch {
    return none; // wala pang migration 0165
  }
}

// ── LISTAHAN (aprubador — admin lang, gaya ng PAN Overall) ──────────────────
export async function listPaymentApprovals(): Promise<PaymentApprovalRow[]> {
  const me = await getSession();
  if (!me || !isAdmin(me.role)) return [];
  try {
    const db = createServerSupabase();
    const { data } = await db.from("payment_approvals")
      .select("*").order("id", { ascending: false }).limit(200);
    const rows = data ?? [];
    // Konteksto ng order at ledger — batch na query kada listahan.
    const ids = [...new Set(rows.map((r) => r.order_id as number))];
    type Ord = { id: number; order_number: string | null; customer_name: string | null; full_payment_price: number | null; downpayment_price: number | null; full_payment: number | null; status: string | null; date_order: string | null; address: string | null; contact_number: string | null; email: string | null; receipt_items: unknown };
    const ordById = new Map<number, Ord>();
    const payByOrder = new Map<number, PaymentApprovalRow["history"]>();
    // REWORK (2026-08-25) — sariling pera ang RMA. Ang singil nito ay ang
    // balanse ng order + piyesa + hatid, at ang naibayad na ay nasa
    // rework_downpayment — WALA sa orders ledger. Kung ang pera ng order ang
    // ipapakita, sinungaling ang buong panel: "MORE than the balance" ang babala
    // sa tamang halaga, at "FULLY PAID" ang order na may utang pa.
    type Ret = {
      id: number; return_no: string | null; status: string | null;
      rework_charge_total: number | null; rework_downpayment: number | null;
      rework_delivery_price: number | null; rework_parts_total: number | null;
      rework_mode: string | null; rework_parts: unknown; rework_target: string | null;
      rework_workshop_id: number | null; rework_onsite_crew: unknown;
      rework_payment_method: string | null;
      item_desc: string | null; sku: string | null; category: string | null;
      item_image: string | null; item_condition: string | null; reason: string | null;
      notes: string | null; photos: unknown;
      requested_by: string | null; approved_by: string | null; created_at: string | null;
    };
    const retById = new Map<number, Ret>();
    const shopById = new Map<number, string>();
    const rids = [...new Set(rows.map((r) => r.return_id as number | null).filter((x): x is number => !!x))];
    if (rids.length) {
      const { data: rets } = await db.from("returns")
        .select("id, return_no, status, rework_charge_total, rework_downpayment, rework_delivery_price, rework_parts_total, rework_mode, rework_parts, rework_target, rework_workshop_id, rework_onsite_crew, rework_payment_method, item_desc, sku, category, item_image, item_condition, reason, notes, photos, requested_by, approved_by, created_at")
        .in("id", rids);
      for (const t of (rets ?? []) as unknown as Ret[]) retById.set(t.id, t);
      // Pangalan ng workshop — sa PULL OUT lang may saysay (doon dinala).
      const wids = [...new Set([...retById.values()].map((t) => t.rework_workshop_id).filter((x): x is number => !!x))];
      if (wids.length) {
        const { data: shops } = await db.from("workshop").select("id, name").in("id", wids);
        for (const w of shops ?? []) shopById.set(w.id as number, (w.name as string) ?? "");
      }
    }
    if (ids.length) {
      const [{ data: ords }, { data: pays }] = await Promise.all([
        db.from("orders").select("id, order_number, customer_name, full_payment_price, downpayment_price, full_payment, status, date_order, address, contact_number, email, receipt_items").in("id", ids),
        db.from("order_payments").select("order_id, amount, method, kind, paid_at, collected_by, reference, created_at").in("order_id", ids).order("id", { ascending: true }),
      ]);
      for (const o of (ords ?? []) as unknown as Ord[]) ordById.set(o.id, o);
      for (const p of pays ?? []) {
        const oid = p.order_id as number;
        const list = payByOrder.get(oid) ?? [];
        list.push({
          amount: Number(p.amount) || 0,
          method: (p.method as string | null) ?? null,
          kind: (p.kind as string | null) ?? null,
          paidAt: (p.paid_at as string | null) ?? (p.created_at as string | null) ?? null,
          collectedBy: (p.collected_by as string | null) ?? null,
          reference: (p.reference as string | null) ?? null,
        });
        payByOrder.set(oid, list);
      }
    }
    const pendingByOrder = new Map<number, number>();
    for (const r of rows) if (r.status === "pending") pendingByOrder.set(r.order_id as number, (pendingByOrder.get(r.order_id as number) ?? 0) + 1);
    const ctx = (r: Record<string, unknown>) => {
      const o = ordById.get(r.order_id as number);
      const total = Number(o?.full_payment_price) || 0;
      const hist = payByOrder.get(r.order_id as number) ?? [];
      // Paid BEFORE this approval = downpayment_price + full_payment ng order
      // (ledger-owned na columns — pareho ng ginagamit ng submit para sa
      // balanse). Kapag approved na ang row, ibawas ang sarili nitong halaga
      // para tama ang "bago/pagkatapos" sa Approved tab.
      const selfRef = `approval:${r.id as number}`;
      const paidRaw = (Number(o?.downpayment_price) || 0) + (Number(o?.full_payment) || 0);
      const paid = r.status === "approved" ? Math.max(paidRaw - (Number(r.amount) || 0), 0) : paidRaw;
      const rawItems = Array.isArray(o?.receipt_items) ? (o?.receipt_items as { qty?: unknown; description?: unknown; unitPrice?: unknown }[]) : [];

      // REWORK — ibang pera, ibang listahan. Ang "total" ay ang singil ng RMA
      // (hindi ng order), ang "paid" ay rework_downpayment, at ang mga item ay
      // ang piyesa at ang hatid — iyon ang binabayaran, hindi ang kama.
      const ret = r.return_id ? retById.get(r.return_id as number) : undefined;
      if (ret) {
        const rTotal = Math.round((Number(ret.rework_charge_total) || 0) * 100) / 100;
        const rPaidRaw = Number(ret.rework_downpayment) || 0;
        const rPaid = r.status === "approved" ? Math.max(rPaidRaw - (Number(r.amount) || 0), 0) : rPaidRaw;
        const parts = Array.isArray(ret.rework_parts)
          ? (ret.rework_parts as { part?: unknown; qty?: unknown; price?: unknown; amount?: unknown }[])
          : [];
        const dprice = Number(ret.rework_delivery_price) || 0;
        const pTotal = Math.round((Number(ret.rework_parts_total) || parts.reduce((n, p) => n + (Number(p.amount) || 0), 0)) * 100) / 100;
        const mode = ret.rework_mode === "pullout" ? "Pull out" : "On site";
        // Ang singil ng rework = balanse ng order NOONG idineklara + piyesa +
        // hatid. Ang unang bahagi ay ibinabawas para makita kung saan galing ang
        // pera — kung hindi, ang ₱2,000 na hatid ang mukhang buong singil at ang
        // natira ay parang wala sa kung saan.
        const obal = Math.max(Math.round((rTotal - pTotal - dprice) * 100) / 100, 0);
        const crew = Array.isArray(ret.rework_onsite_crew)
          ? (ret.rework_onsite_crew as { id?: unknown; name?: unknown }[])
              .map((c) => ({ id: Number(c.id) || 0, name: String(c.name ?? "") })).filter((c) => c.name)
          : [];
        return {
          orderTotal: rTotal,
          paidBefore: Math.round(rPaid * 100) / 100,
          balanceBefore: Math.max(Math.round((rTotal - rPaid) * 100) / 100, 0),
          orderStatus: `Rework · ${mode}`,
          orderDate: o?.date_order ?? null,
          address: o?.address ?? null,
          customerPhone: o?.contact_number ?? null,
          customerEmail: o?.email ?? null,
          items: [
            ...(obal > 0 ? [{ qty: 1, description: "Unpaid balance on the order", unitPrice: obal }] : []),
            ...parts.map((p) => ({ qty: Number(p.qty) || 1, description: `Part · ${String(p.part ?? "")}`, unitPrice: Number(p.price) || 0 })),
            ...(dprice > 0 ? [{ qty: 1, description: mode === "Pull out" ? "Pull-out / redelivery" : "On-site crew trip", unitPrice: dprice }] : []),
          ],
          rework: {
            mode,
            target: (ret.rework_target as string | null) ?? null,
            status: (ret.status as string | null) ?? null,
            itemDesc: (ret.item_desc as string | null) ?? null,
            sku: (ret.sku as string | null) ?? null,
            category: (ret.category as string | null) ?? null,
            itemImage: (ret.item_image as string | null) ?? null,
            condition: (ret.item_condition as string | null) ?? null,
            reason: (ret.reason as string | null) ?? null,
            notes: (ret.notes as string | null) ?? null,
            photos: Array.isArray(ret.photos) ? (ret.photos as string[]).filter(Boolean) : [],
            crew,
            workshop: ret.rework_workshop_id ? shopById.get(ret.rework_workshop_id) ?? null : null,
            requestedBy: (ret.requested_by as string | null) ?? null,
            approvedBy: (ret.approved_by as string | null) ?? null,
            createdAt: (ret.created_at as string | null) ?? null,
            orderBalancePart: obal,
            partsTotal: pTotal,
            partsList: parts
              .map((x) => ({ part: String(x?.part ?? ""), qty: Number(x?.qty) || 1, amount: Number(x?.amount) || 0 }))
              .filter((x) => x.part),
            deliveryPrice: dprice,
            charge: rTotal,
            paid: Math.round(rPaid * 100) / 100,
            paymentMethod: (ret.rework_payment_method as string | null) ?? null,
          },
          // Ang kasaysayan ng orders ledger ay hindi kabilang: ibang pitaka.
          history: [],
          otherPending: 0,
        };
      }

      return {
        orderTotal: total,
        paidBefore: Math.round(paid * 100) / 100,
        balanceBefore: Math.max(Math.round((total - paid) * 100) / 100, 0),
        orderStatus: o?.status ?? null,
        orderDate: o?.date_order ?? null,
        address: o?.address ?? null,
        customerPhone: o?.contact_number ?? null,
        customerEmail: o?.email ?? null,
        items: rawItems.map((it) => ({ qty: Number(it.qty) || 1, description: String(it.description ?? ""), unitPrice: Number(it.unitPrice) || 0 })),
        rework: null,
        history: hist.filter((h) => h.reference !== selfRef),
        otherPending: Math.max((pendingByOrder.get(r.order_id as number) ?? 0) - (r.status === "pending" ? 1 : 0), 0),
      };
    };
    return rows.map((r) => ({
      ...ctx(r as Record<string, unknown>),
      id: r.id as number,
      orderId: r.order_id as number,
      // ANG ORDER MISMO ANG PANGHALILI (2026-08-29). Ang `order_number` sa
      // payment_approvals ay hindi napupunan sa koleksyon ng rework, kaya ang
      // hanay ay nagpapakita ng "#279" — raw id, walang kabuluhan sa sinumang
      // naghahanap ng ORD-000012.
      orderNumber: (r.order_number as string | null) ?? ordById.get(r.order_id as number)?.order_number ?? null,
      returnId: (r.return_id as number | null) ?? null,
      returnNo: (r.return_no as string | null) ?? null,
      customer: ordById.get(r.order_id as number)?.customer_name ?? null,
      amount: Number(r.amount) || 0,
      method: (r.method as string) ?? "",
      collectedBy: (r.collected_by as string | null) ?? null,
      submittedBy: (r.submitted_by as string | null) ?? null,
      proofs: (r.proof_urls as string[]) ?? [],
      status: (r.status as string) ?? "pending",
      note: (r.note as string | null) ?? null,
      reviewedBy: (r.reviewed_by as string | null) ?? null,
      createdAt: (r.created_at as string) ?? "",
    }));
  } catch {
    return []; // wala pang migration 0165
  }
}

// ── APPROVE — dito lang tumatakbo ang tunay na pagtatala ────────────────────
export async function approvePayment(id: number): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me || !isAdmin(me.role)) return { error: "Not allowed." };
  const db = createServerSupabase();
  const { data: pa } = await db.from("payment_approvals").select("*").eq("id", id).maybeSingle();
  if (!pa) return { error: "Approval not found." };
  if (pa.status !== "pending") return { error: `Already ${pa.status}.` };

  // REWORK (2026-08-25) — ibang ledger. Ang RMA ay may sariling singil
  // (returns.rework_charge_total) at sariling talaan ng bayad
  // (rework_downpayment); ang collectManualPayment sa ibaba ay nagtatala sa
  // ORDERS ledger, kaya maling pera ang tatamaan. Ang bilang ng RMA email ay
  // nasa loob na ng collectReworkPayment.
  if (pa.return_id) {
    const { collectReworkPayment } = await import("@/app/returns/actions");
    const rr = await collectReworkPayment(
      pa.return_id as number,
      Number(pa.amount) || 0,
      (pa.method as string) || "Cash",
      (pa.collected_by as string | null) ?? null,
    );
    if ("error" in rr) return rr;
    await db.from("payment_approvals").update({
      status: "approved",
      reviewed_by: me.full_name?.trim() || me.email || null,
      reviewed_at: new Date().toISOString(),
    }).eq("id", id);
    revalidatePath("/payment-approval");
    revalidatePath("/installation");
    revalidatePath("/returns");
    return { ok: true };
  }

  // Ang TUNAY na pagtatala: ledger + resibo + status ng order — parehong daan
  // ng dating direct collect, kaya lalabas sa PAN Overall at magiging bayad ang
  // order sa Installation. Idempotent sa approval id. deferHeavy = ang receipt
  // render + emails ay tumatakbo pagkatapos ng response para INSTANT ang
  // Approve button (naiulat 2026-08-16 na matagal).
  const r = await collectManualPayment(
    pa.order_id as number,
    (pa.method as string) || "Cash",
    (pa.collected_by as string) || "",
    `approval:${pa.id}`,
    Number(pa.amount) || undefined,
    undefined,
    undefined,
    true,
  );
  if ("error" in r) return r;

  await db.from("payment_approvals").update({
    status: "approved",
    reviewed_by: me.full_name?.trim() || me.email || null,
    reviewed_at: new Date().toISOString(),
  }).eq("id", id);
  revalidatePath("/payment-approval");
  revalidatePath("/installation");
  revalidatePath("/hr/overall");
  return { ok: true };
}

// ── BULK APPROVE (review desk) — sunod-sunod na approvePayment; huminto sa
// unang error para walang maiiwang kalahati.
export async function approvePayments(ids: number[]): Promise<{ ok: true; done: number } | { error: string; done: number }> {
  let done = 0;
  for (const id of ids) {
    const r = await approvePayment(id);
    if ("error" in r) return { error: `${r.error} (after ${done} approved)`, done };
    done += 1;
  }
  return { ok: true, done };
}

// ── REJECT ───────────────────────────────────────────────────────────────────
export async function rejectPayment(id: number, note: string): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me || !isAdmin(me.role)) return { error: "Not allowed." };
  const db = createServerSupabase();
  const { data: pa } = await db.from("payment_approvals").select("status").eq("id", id).maybeSingle();
  if (!pa) return { error: "Approval not found." };
  if (pa.status !== "pending") return { error: `Already ${pa.status}.` };
  const { error } = await db.from("payment_approvals").update({
    status: "rejected",
    note: note?.trim() || null,
    reviewed_by: me.full_name?.trim() || me.email || null,
    reviewed_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/payment-approval");
  revalidatePath("/installation");
  return { ok: true };
}

// ── REFUND PAYOUTS (2026-09-01, "dito seperate ung mga refunded") — sariling
// tab sa Payment Approval: ang mga refund na naitala na (pera palabas, PAN
// Overall expense) para kitang-kita ng admin ang lahat ng lumabas na pera sa
// tabi ng mga koleksyon. Basahin lang — ang pag-apruba ng refund ay nasa
// Return / Defect Approval.
export type RefundPayoutRow = {
  id: number;
  rma: string;
  orderId: number | null;
  orderNumber: string | null;
  customer: string | null;
  // Kontak ng customer (2026-09-01, hiling ni Joe) — tayo ang magpapadala ng
  // pera, kaya kailangang isang tingin/pindot lang ang pagtawag.
  contact: string | null;
  email: string | null;
  product: string | null;
  address: string | null;
  account: string | null;
  amount: number;
  refundedAt: string | null;
  approvedBy: string | null;
  photos: string[];
  // TO PAY vs REFUNDED (2026-09-01): ang approval ay pahintulot lang — ang
  // padala ng pera ay dito minamarkahan (markRefundPaid), saka lang papasok
  // ang PAN expense.
  paid: boolean;
  approvedAt: string | null;
  // Litrato ng padala (0223) — ang resibo/screenshot ng transfer sa customer.
  payoutPhotos: string[];
};

export async function listRefundPayouts(): Promise<RefundPayoutRow[]> {
  const me = await getSession();
  if (!me || !isAdmin(me.role)) return [];
  const db = createServerSupabase();
  // Lahat ng APROBADONG refund — TO PAY (wala pang refunded_at) at REFUNDED.
  // Ang refund_payout_photos (0223) ay may pambalik bago tumakbo ang migration.
  const RQ_COLS = "id, return_no, order_id, customer_name, item_desc, refund_amount, refunded_at, approved_by, approved_at, photos, refund_payment_id";
  const rq = (cols: string) => db.from("returns")
    .select(cols)
    .eq("resolution", "refund").eq("type", "customer")
    .not("approved_at", "is", null)
    .neq("status", "Rejected")
    .order("approved_at", { ascending: false }).limit(500);
  const r1 = await rq(`${RQ_COLS}, refund_payout_photos`);
  const rets = (r1.error ? (await rq(RQ_COLS)).data : r1.data) as unknown as Record<string, unknown>[] | null;
  const rows = (rets ?? []) as Record<string, unknown>[];
  const oids = [...new Set(rows.map((r) => r.order_id as number | null).filter((x): x is number => x != null))];
  const ordById = new Map<number, { order_number: string | null; address: string | null; contact: string | null; email: string | null }>();
  if (oids.length) {
    const { data: os } = await db.from("orders").select("id, order_number, address, contact_number, email").in("id", oids);
    for (const o of os ?? []) ordById.set(o.id as number, {
      order_number: (o.order_number as string | null) ?? null,
      address: (o.address as string | null) ?? null,
      contact: (o.contact_number as string | null) ?? null,
      email: (o.email as string | null) ?? null,
    });
  }
  // Aling account pinaglabasan — mula sa naka-link na PAN transaction.
  const txIds = [...new Set(rows.map((r) => r.refund_payment_id as number | null).filter((x): x is number => x != null))];
  const acctByTx = new Map<number, string>();
  if (txIds.length) {
    const { data: txs } = await db.from("pan_transactions").select("id, account_id").in("id", txIds);
    const accIds = [...new Set((txs ?? []).map((t) => t.account_id as number | null).filter((x): x is number => x != null))];
    const accName = new Map<number, string>();
    if (accIds.length) {
      const { data: accs } = await db.from("pan_accounts").select("id, name").in("id", accIds);
      for (const a of accs ?? []) accName.set(a.id as number, (a.name as string | null) ?? "");
    }
    for (const t of txs ?? []) if (t.account_id != null) acctByTx.set(t.id as number, accName.get(t.account_id as number) ?? "");
  }
  return rows.map((r) => ({
    id: Number(r.id),
    rma: (r.return_no as string | null) ?? `#${r.id}`,
    orderId: (r.order_id as number | null) ?? null,
    orderNumber: r.order_id != null ? ordById.get(Number(r.order_id))?.order_number ?? null : null,
    customer: (r.customer_name as string | null) ?? null,
    contact: r.order_id != null ? ordById.get(Number(r.order_id))?.contact ?? null : null,
    email: r.order_id != null ? ordById.get(Number(r.order_id))?.email ?? null : null,
    product: String(r.item_desc ?? "").split("\n")[0] || null,
    address: r.order_id != null ? ordById.get(Number(r.order_id))?.address ?? null : null,
    account: r.refund_payment_id != null ? (acctByTx.get(Number(r.refund_payment_id)) || null) : null,
    amount: Number(r.refund_amount) || 0,
    refundedAt: (r.refunded_at as string | null) ?? null,
    approvedBy: (r.approved_by as string | null) ?? null,
    photos: Array.isArray(r.photos) ? (r.photos as unknown[]).filter((x): x is string => typeof x === "string") : [],
    paid: !!r.refunded_at,
    approvedAt: (r.approved_at as string | null) ?? null,
    payoutPhotos: Array.isArray(r.refund_payout_photos) ? (r.refund_payout_photos as unknown[]).filter((x): x is string => typeof x === "string") : [],
  }));
}

// Mga PAN account para sa "Mark refunded" — pagpipilian kung saan lumabas ang pera.
export async function listPanAccountsLite(): Promise<{ id: number; name: string }[]> {
  const me = await getSession();
  if (!me || !isAdmin(me.role)) return [];
  const db = createServerSupabase();
  const { data } = await db.from("pan_accounts").select("id, name").order("id").limit(50);
  return ((data ?? []) as { id: number; name: string | null }[]).map((a) => ({ id: a.id, name: a.name ?? `Account #${a.id}` }));
}

// ANG AKTWAL NA PADALA (2026-09-01, "approval palang wala pa ung action ng
// refund mismo"): pagkatapos maipadala ang pera sa customer, dito ito
// minamarkahan — SAKA lang pumapasok ang PAN Overall expense (kategoryang
// Refund, sa piniling account) at ang refunded_at. Idempotent: ang may
// refunded_at na ay hindi na madodoble.
export async function markRefundPaid(returnId: number, accountId: number, payoutPhotos: string[] = []): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me || !isAdmin(me.role)) return { error: "Not allowed." };
  const db = createServerSupabase();
  const { data: r } = await db.from("returns")
    .select("id, return_no, order_id, resolution, type, status, refund_amount, refunded_at, notes")
    .eq("id", returnId).maybeSingle();
  if (!r) return { error: "Return not found." };
  if (r.resolution !== "refund" || r.type !== "customer") return { error: "Not a customer refund." };
  if (r.refunded_at) return { error: "Already marked refunded." };
  const amount = Number(r.refund_amount) || 0;
  if (amount <= 0) return { error: "This refund has no amount." };
  const { data: acct } = await db.from("pan_accounts").select("id, name").eq("id", accountId).maybeSingle();
  if (!acct) return { error: "Pick the account the money was sent from." };
  // ANG PATUNAY NG PADALA (0223): litrato ng resibo/screenshot ng transfer —
  // parehong disiplina ng ibang proof gates: walang litrato, walang selyo.
  const proof = (payoutPhotos ?? []).filter((u) => typeof u === "string" && !!u);
  if (proof.length < 1) return { error: "Upload at least 1 photo of the transfer sent to the customer." };

  // Kategoryang "Refund" (expense) — gawin kung wala pa.
  let catId: number | null = null;
  const { data: cat } = await db.from("pan_categories").select("id").ilike("name", "refund").limit(1);
  catId = (cat?.[0]?.id as number | undefined) ?? null;
  if (catId == null) {
    const { data: newCat } = await db.from("pan_categories").insert({ name: "Refund", kind: "expense" }).select("id").maybeSingle();
    catId = (newCat?.id as number | undefined) ?? null;
  }
  const rma = (r.return_no as string | null) ?? `#${r.id}`;
  const { data: ordNo } = r.order_id != null
    ? await db.from("orders").select("order_number").eq("id", r.order_id).maybeSingle()
    : { data: null as { order_number: string | null } | null };
  const { data: txn, error: txErr } = await db.from("pan_transactions").insert({
    txn_date: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
    account_id: acct.id,
    category_id: catId,
    kind: "expense",
    details: `${rma} (Refund${ordNo?.order_number ? ` · ${ordNo.order_number}` : ""})`,
    amount: -Math.abs(amount),
  }).select("id").maybeSingle();
  if (txErr) return { error: txErr.message };

  const stampNote = `Refund ₱${amount.toFixed(2)} sent (${(acct.name as string | null) ?? "account #" + acct.id}) — marked by ${me.full_name ?? me.email ?? "admin"}.`;
  const patch: Record<string, unknown> = {
    refunded_at: new Date().toISOString(),
    refund_payment_id: txn?.id ?? null,
    notes: [String(r.notes ?? "").trim(), stampNote].filter(Boolean).join(" "),
  };
  // 0223 — may pambalik: bago tumakbo ang migration, ang selyo ay tuloy pa rin
  // nang walang photos column (huwag ibagsak ang naitala nang PAN expense).
  const { error: upErr } = await db.from("returns").update({ ...patch, refund_payout_photos: proof }).eq("id", returnId);
  if (upErr && /refund_payout_photos/i.test(upErr.message)) {
    await db.from("returns").update(patch).eq("id", returnId);
  } else if (upErr) {
    return { error: upErr.message };
  }
  revalidatePath("/payment-approval");
  revalidatePath("/hr/overall");
  revalidatePath("/returns");
  return { ok: true };
}
