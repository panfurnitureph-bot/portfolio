import { createServerSupabase } from "@/lib/supabase/server";
import type { PanAccount, PanCategory, PanTransaction, PanTxnRow } from "@/lib/pan/types";

// High ceiling so the ledger never silently drops rows (Supabase defaults to
// 1000 without an explicit limit). For very large datasets this should move to
// a per-period (date-windowed) query.
const LEDGER_CAP = 100_000;

export async function loadAccounts(): Promise<PanAccount[]> {
  const db = createServerSupabase();
  const { data } = await db.from("pan_accounts").select("id, name, opening_balance, sort_order, active").order("sort_order").order("id").limit(LEDGER_CAP);
  return (data ?? []) as PanAccount[];
}

export async function loadCategories(): Promise<PanCategory[]> {
  const db = createServerSupabase();
  const { data } = await db.from("pan_categories").select("id, name, kind, sort_order, active").order("sort_order").order("name").limit(LEDGER_CAP);
  return (data ?? []) as PanCategory[];
}

// MOP → pan_accounts.id mapping (mop_account_map, migration 0069). Resolved by ID so a
// name mismatch ("GCash" vs "GCASH") can no longer dump income to account_id=0.
async function loadMopAccountMap(): Promise<Map<string, number>> {
  const db = createServerSupabase();
  const { data } = await db.from("mop_account_map").select("mop, account_id").limit(LEDGER_CAP);
  return new Map<string, number>((data ?? []).map((r) => [String((r as { mop: string }).mop).trim().toLowerCase(), (r as { account_id: number }).account_id]));
}

// Resolve a payment mode to a pan_accounts.id: prefer the stable MOP→account map (by id),
// fall back to the legacy name-map. Returns null when unresolved — callers must NOT coerce
// that to 0 (which would mis-attribute the income); the row still counts in the grand total.
function resolveAccountId(mode: string, mopAccountMap: Map<string, number>, accIdByName: Map<string, number>): number | null {
  const key = mode.trim().toLowerCase();
  return mopAccountMap.get(key) ?? accIdByName.get(key) ?? null;
}

// Auto-pulled income from paid orders, as virtual read-only ledger rows. NOT stored —
// always reflects the orders table. Income amounts come from the order_payments LEDGER
// (one row per installment/refund, correct dates + per-payment method) when present, so
// 3rd+ partial payments are no longer lost. Falls back to the legacy
// downpayment_price/full_payment columns for orders with no ledger rows yet.
// account_id is resolved BY ID via mop_account_map (no name-mismatch drift to account 0).
async function loadOrderIncome(accIdByName: Map<string, number>): Promise<PanTxnRow[]> {
  const db = createServerSupabase();
  const [mopAccountMap, { data }, { data: payRows }, { data: reworkRows }, { data: mattressRows }, { data: empRows }] = await Promise.all([
    loadMopAccountMap(),
    db.from("orders")
      .select("*")
      .order("id").limit(LEDGER_CAP),
    db.from("order_payments")
      // created_at (2026-09-01): ang paid_at ay DATE-ONLY — ang created_at ang
      // may oras, at iyon ang panunudlaan ng pinakabago-muna na ayos.
      .select("id, order_id, amount, method, kind, paid_at, created_at")
      .order("order_id").order("paid_at").order("id").limit(LEDGER_CAP),
    // Rework service payments (returns) count as income too — a repair the customer
    // pays for. Only rows with money collected land in the ledger.
    db.from("returns")
      .select("id, order_id, return_no, rework_downpayment, rework_payment_method, rework_paid_at, rework_charge_total")
      .eq("resolution", "rework").gt("rework_downpayment", 0).limit(LEDGER_CAP),
    // Done mattress orders → income (their own sales channel). Only Done, with amount.
    db.from("mattress_orders")
      .select("id, client, order, amount, paid_via, done_at, order_date")
      .eq("status", "Done").gt("amount", 0).limit(LEDGER_CAP),
    // Showroom detection fallback: home branch ng sales rep. select("*") para hindi
    // mag-error bago tumakbo ang migration 0147 (branch column).
    db.from("employees").select("*").eq("active", true).limit(LEDGER_CAP),
  ]);

  // Branch ng order: explicit tag (orders.branch) > home branch ng sales rep.
  const empBranch = new Map<string, string>();
  for (const e of (empRows ?? []) as Record<string, unknown>[]) {
    const nm = typeof e.name === "string" ? e.name.trim().toLowerCase() : "";
    const br = typeof e.branch === "string" ? e.branch.trim() : "";
    if (nm && br) empBranch.set(nm, br);
  }
  const branchOf = (o: Record<string, unknown>): string | null => {
    const explicit = typeof o.branch === "string" && o.branch.trim() ? o.branch.trim() : null;
    if (explicit) return explicit;
    const rep = typeof o.assigned === "string" ? o.assigned.trim().toLowerCase() : "";
    return (rep && empBranch.get(rep)) || null;
  };

  // Group ledger rows by order so we can prefer them over the legacy columns.
  const ledgerByOrder = new Map<number, { id: number; amount: number; method: string | null; kind: string; paid_at: string }[]>();
  for (const p of payRows ?? []) {
    const oid = (p as { order_id: number }).order_id;
    const arr = ledgerByOrder.get(oid) ?? [];
    arr.push(p as { id: number; amount: number; method: string | null; kind: string; paid_at: string; order_id: number });
    ledgerByOrder.set(oid, arr);
  }

  const out: PanTxnRow[] = [];
  for (const o of data ?? []) {
    const oid = Number(o.id);
    const modeName = (o.mop as string) || (o.Source as string) || "—";
    const ord = (o.order_number as string) || `#${o.id}`;
    const br = branchOf(o as Record<string, unknown>);
    // The final payment may have been collected electronically (Maya QR Ph) even if the
    // order's MOP says Cash — settle it to the right account. Funds land in Maya (merchant)
    // for QR; "Cash" when collected manually.
    const fullMode = o.maya_paid_at
      ? (/cash|check/i.test((o.maya_status as string) || "") ? "Cash" : "Maya")
      : modeName;

    const ledger = ledgerByOrder.get(oid);
    if (ledger && ledger.length) {
      // Authoritative path: one virtual row per ledger payment (correct date/method/sign).
      for (const p of ledger) {
        const amt = Number(p.amount) || 0;
        if (amt === 0 || !p.paid_at) continue;
        const mode = (p.method && p.method.trim()) ? p.method : (p.kind === "downpayment" ? modeName : fullMode);
        const isRefund = amt < 0;
        const label = isRefund ? "Refund" : p.kind === "downpayment" ? "Partial Payment" : p.kind === "balance" ? "Full Payment" : p.kind === "installment" ? "Installment" : "Payment";
        // A refund is money going BACK to the customer → it lands in the EXPENSE column
        // (negative amount) and is categorized "Refund" so it reads as a cash-out, not as
        // negative order income. Normal payments stay income ("Order Payment").
        out.push({
          id: -(5_000_000_000 + p.id), txn_date: p.paid_at, account_id: resolveAccountId(mode, mopAccountMap, accIdByName) ?? 0,
          // Ang created_at ang TUNAY na oras ng pagtatala (ang paid_at ay
          // date-only) — ito ang binabasa ng newest-first na sort.
          category_id: null, kind: isRefund ? "expense" : "income", details: `${ord} (${label})`, amount: amt, transfer_group: null, created_at: ((p as { created_at?: string | null }).created_at ?? p.paid_at),
          account_name: mode, category_name: isRefund ? "Refund" : "Order Payment", source: "order",
          order_id: oid, order_number: (o.order_number as string) ?? null, branch: br,
        });
      }
      continue;
    }

    // Legacy fallback (no ledger rows yet) — same behaviour as before, but resolved by ID.
    const mk = (idOffset: number, date: string, amount: number, label: string, mode: string): PanTxnRow => ({
      id: -(Number(o.id) * 2 + idOffset), txn_date: date, account_id: resolveAccountId(mode, mopAccountMap, accIdByName) ?? 0, category_id: null,
      kind: "income", details: `${ord} (${label})`, amount, transfer_group: null, created_at: date,
      account_name: mode, category_name: "Order Payment", source: "order",
      order_id: oid, order_number: (o.order_number as string) ?? null, branch: br,
    });
    // Use ACTUAL collected amounts, not the order total (full_payment_price).
    const dp = Number(o.downpayment_price) || 0;
    if (dp > 0 && o.date_downpayment) out.push(mk(1, o.date_downpayment as string, dp, "Partial Payment", modeName));
    const fp = Number(o.full_payment) || 0; // actual final payment collected
    if (fp > 0 && o.full_payment_date) out.push(mk(2, o.full_payment_date as string, fp, "Full Payment", fullMode));
  }

  // Rework service payments → income, settled to the collection account (Cash / Maya /
  // account by method). Shown as "Rework Payment" so it reads distinctly from orders.
  for (const rw of reworkRows ?? []) {
    const amt = Number((rw as { rework_downpayment: number }).rework_downpayment) || 0;
    const paidAt = (rw as { rework_paid_at: string | null }).rework_paid_at;
    if (amt <= 0 || !paidAt) continue;
    const rid = Number((rw as { id: number }).id);
    const rno = ((rw as { return_no: string | null }).return_no) ?? `#${rid}`;
    const method = ((rw as { rework_payment_method: string | null }).rework_payment_method) || "Cash";
    // Email QR settles to Maya (merchant); Cash/Terminal to their own accounts.
    const mode = /qr|email/i.test(method) ? "Maya" : /terminal/i.test(method) ? "Maya Terminal" : method;
    // "Paid 50%" / "Fully Paid" label — kapareho ng Partial/Full sa normal orders.
    const charge = Number((rw as { rework_charge_total?: number | null }).rework_charge_total) || 0;
    const payLabel = charge > 0
      ? (amt + 0.005 >= charge ? "Rework Payment · Fully Paid" : `Rework Payment · ${Math.round((amt / charge) * 100)}% paid`)
      : "Rework Payment";
    // ANG PETSA AY SA PILIPINAS (2026-09-01, "bakit di na rerecord dito"):
    // ang rework_paid_at ay UTC timestamp — ang bayad na kinolekta ng Sep 1 ng
    // umaga PH ay Aug 31 pa sa UTC, kaya ang buong Rework Payment ay napupunta
    // sa MALING BUWAN at nawawala sa kasalukuyang view. Ang order payments ay
    // PH-date na ang tatak; itumbas ang rework.
    const phTxnDate = new Date(new Date(paidAt).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    out.push({
      id: -(6_000_000_000 + rid), txn_date: phTxnDate, account_id: resolveAccountId(mode, mopAccountMap, accIdByName) ?? 0,
      category_id: null, kind: "income", details: `${rno} (${payLabel})`, amount: amt, transfer_group: null, created_at: paidAt,
      account_name: mode, category_name: "Rework Payment", source: "return",
      // order_id → nabubuksan ang gallery ng linked order (naka-attach doon ang
      // rework receipt slip pagka-collect).
      order_id: ((rw as { order_id?: number | null }).order_id) ?? null, order_number: rno,
    });
  }

  // Done mattress orders → income, settled to the paid_via account (Cash default),
  // dated to done_at (else order_date). Shown as "Mattress Order".
  for (const mo of mattressRows ?? []) {
    const amt = Number((mo as { amount: number }).amount) || 0;
    if (amt <= 0) continue;
    const mid = Number((mo as { id: number }).id);
    const when = ((mo as { done_at: string | null }).done_at) || ((mo as { order_date: string | null }).order_date);
    if (!when) continue;
    const client = ((mo as { client: string | null }).client) || "Mattress";
    const mode = ((mo as { paid_via: string | null }).paid_via) || "Cash";
    out.push({
      id: -(7_000_000_000 + mid), txn_date: when, account_id: resolveAccountId(mode, mopAccountMap, accIdByName) ?? 0,
      category_id: null, kind: "income", details: `Mattress · ${client}`, amount: amt, transfer_group: null, created_at: when,
      account_name: mode, category_name: "Mattress Order", source: "order",
      order_id: null, order_number: null,
    });
  }
  return out;
}

// Auto expense from FINALIZED payroll runs (one lump per run), as virtual
// read-only rows. Amount = net pay + statutory benefits (SSS/PhilHealth/Pag-IBIG/
// tax) the company remits. Advances are excluded (already paid out earlier).
async function loadPayrollExpense(): Promise<PanTxnRow[]> {
  const db = createServerSupabase();
  const { data: runs } = await db.from("hr_payroll_runs")
    .select("id, period_start, period_end, pay_date, pay_type, status").eq("status", "Finalized").limit(LEDGER_CAP);
  if (!runs?.length) return [];
  const { data: slips } = await db.from("hr_payslips")
    .select("run_id, net_pay, sss, philhealth, pagibig, tax")
    .in("run_id", runs.map((r) => r.id as number)).limit(LEDGER_CAP);
  const byRun = new Map<number, number>();
  for (const s of slips ?? []) {
    const amt = (Number(s.net_pay) || 0) + (Number(s.sss) || 0) + (Number(s.philhealth) || 0) + (Number(s.pagibig) || 0) + (Number(s.tax) || 0);
    byRun.set(s.run_id as number, (byRun.get(s.run_id as number) ?? 0) + amt);
  }
  const out: PanTxnRow[] = [];
  for (const r of runs) {
    const total = byRun.get(r.id as number) ?? 0;
    if (total <= 0) continue;
    const date = (r.pay_date as string) || (r.period_end as string);
    const label = (r.pay_type as string) === "Weekly" ? "Constructor" : "Semi-monthly";
    out.push({
      id: -(1_000_000_000 + Number(r.id)), txn_date: date, account_id: 0, category_id: null,
      kind: "expense", details: `Payroll ${label} · ${String(r.period_start).slice(5)}–${String(r.period_end).slice(5)} (incl. benefits)`,
      amount: -total, transfer_group: null, created_at: date,
      account_name: "Payroll", category_name: "OPEX - Payroll", source: "payroll",
    });
  }
  return out;
}

// Auto expense for cash advances (vale) at the date issued — read-only.
// Recovery happens via payslip (net is already net of the advance), so counting
// the advance here once at issue + reduced net later avoids double-counting.
async function loadAdvanceExpense(): Promise<PanTxnRow[]> {
  const db = createServerSupabase();
  const { data: advs } = await db.from("hr_advances").select("id, employee_id, amount, date_issued, reason").order("id").limit(LEDGER_CAP);
  if (!advs?.length) return [];
  const ids = [...new Set(advs.map((a) => a.employee_id as number))];
  const names = new Map<number, string>();
  if (ids.length) {
    const { data: emps } = await db.from("employees").select("id, name").in("id", ids).limit(LEDGER_CAP);
    for (const e of emps ?? []) names.set(e.id as number, e.name as string);
  }
  const out: PanTxnRow[] = [];
  for (const a of advs) {
    const amt = Number(a.amount) || 0;
    if (amt <= 0 || !a.date_issued) continue;
    const who = names.get(a.employee_id as number) ?? "—";
    out.push({
      id: -(2_000_000_000 + Number(a.id)), txn_date: a.date_issued as string, account_id: 0, category_id: null,
      kind: "expense", details: `Advance · ${who}${a.reason ? " · " + a.reason : ""}`,
      amount: -amt, transfer_group: null, created_at: a.date_issued as string,
      account_name: "Advance", category_name: "OPEX - Salary Advance", source: "advance",
    });
  }
  return out;
}

// Auto expense for workshop raw materials. Two sources (no double-count):
//   1. Restock REQUESTS once Operations ORDERS them (status ordered/fulfilled) —
//      the spend is committed at order time. Amount = qty_fulfilled × unit price.
//   2. Direct receives NOT tied to a request (manual receive / barcode IN) —
//      workshop_stock_log type "received". (request_fulfilled logs are excluded
//      here because their cost is already captured by source #1.)
async function loadWorkshopExpense(): Promise<PanTxnRow[]> {
  const db = createServerSupabase();
  const [{ data: reqs }, { data: logs }, { data: ws }] = await Promise.all([
    db.from("stock_request").select("id, material_id, workshop_id, qty_fulfilled, qty_requested, status, decided_at, created_at")
      .in("status", ["ordered", "partial", "fulfilled"]).order("id").limit(LEDGER_CAP),
    db.from("workshop_stock_log").select("id, material_id, workshop_id, delta, type, created_at")
      .eq("type", "received").gt("delta", 0).order("id").limit(LEDGER_CAP),
    db.from("workshop").select("id, name").limit(LEDGER_CAP),
  ]);
  const wsName = new Map<number, string>((ws ?? []).map((w) => [w.id as number, w.name as string]));

  const matIds = [...new Set([...(reqs ?? []).map((r) => r.material_id as number), ...(logs ?? []).map((l) => l.material_id as number)].filter((x) => x != null))];
  const matInfo = new Map<number, { name: string; price: number }>();
  if (matIds.length) {
    const { data: mats } = await db.from("workshop_material").select("id, name, price").in("id", matIds).limit(LEDGER_CAP);
    for (const m of mats ?? []) matInfo.set(m.id as number, { name: (m.name as string) ?? "—", price: Number(m.price) || 0 });
  }

  const out: PanTxnRow[] = [];
  // 1) Ordered/fulfilled requests
  for (const r of reqs ?? []) {
    const info = matInfo.get(r.material_id as number);
    const qty = Number(r.qty_fulfilled) || Number(r.qty_requested) || 0;
    const amt = qty * (info?.price ?? 0);
    const when = (r.decided_at as string) || (r.created_at as string);
    if (amt <= 0 || !when) continue;
    const date = String(when).slice(0, 10);
    out.push({
      id: -(3_000_000_000 + Number(r.id)), txn_date: date, account_id: 0, category_id: null,
      kind: "expense", details: `Workshop Restock · ${info?.name ?? "—"} (${wsName.get(r.workshop_id as number) ?? "—"})`,
      amount: -amt, transfer_group: null, created_at: date,
      account_name: "Workshop", category_name: "OPEX - Workshop Supplies", source: "workshop",
    });
  }
  // 2) Direct receives (non-request)
  for (const l of logs ?? []) {
    const info = matInfo.get(l.material_id as number);
    const amt = (Number(l.delta) || 0) * (info?.price ?? 0);
    if (amt <= 0 || !l.created_at) continue;
    const date = String(l.created_at).slice(0, 10);
    out.push({
      id: -(3_500_000_000 + Number(l.id)), txn_date: date, account_id: 0, category_id: null,
      kind: "expense", details: `Workshop Material · ${info?.name ?? "—"} (${wsName.get(l.workshop_id as number) ?? "—"})`,
      amount: -amt, transfer_group: null, created_at: date,
      account_name: "Workshop", category_name: "OPEX - Workshop Supplies", source: "workshop",
    });
  }
  return out;
}

// Auto expense for supplier purchase orders (committed once paid/ordered), read-only.
// Deposit portion is dated at date_order; the balance at delivery_date (fallback date_order).
// Only PHP POs are auto-recorded — foreign-currency POs need a manual peso entry (no FX rate).
async function loadPurchaseExpense(): Promise<PanTxnRow[]> {
  const db = createServerSupabase();
  // pos and line items are independent (items are grouped by po_id in-memory) — fetch in parallel.
  const [{ data: pos }, { data: items }] = await Promise.all([
    db.from("purchase_orders")
      .select("id, pi_number, supplier, date_order, delivery_date, currency, discount, deposit_pct, status, details").order("id").limit(LEDGER_CAP),
    db.from("purchase_order_items").select("po_id, qty, unit_price").order("po_id").limit(LEDGER_CAP),
  ]);
  if (!pos?.length) return [];
  const totalByPo = new Map<number, number>();
  for (const it of items ?? []) {
    const amt = (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
    totalByPo.set(it.po_id as number, (totalByPo.get(it.po_id as number) ?? 0) + amt);
  }
  // Pull an FX rate (foreign currency → PHP) from the PO's details, under any of the
  // common keys. A foreign PO without a rate can't be converted, so it's skipped.
  const fxOf = (details: unknown): number => {
    if (!details || typeof details !== "object") return 0;
    const d = details as Record<string, unknown>;
    for (const k of Object.keys(d)) {
      if (/fx|exchange|forex|rate.*php|usd.*php/i.test(k)) {
        const n = Number(String(d[k]).replace(/[^\d.]/g, ""));
        if (n > 0) return n;
      }
    }
    return 0;
  };
  const out: PanTxnRow[] = [];
  for (const p of pos) {
    const cur = (p.currency as string | null)?.trim().toUpperCase() || "PHP";
    const isPhp = cur === "PHP" || cur === "₱";
    // Foreign currency → convert with the PO's FX rate; no rate = can't convert = skip.
    const fx = isPhp ? 1 : fxOf(p.details);
    if (!isPhp && fx <= 0) continue;
    const status = (p.status as string) || "";
    if (/draft|sent|cancel/i.test(status)) continue; // not yet a committed spend
    const gross = (totalByPo.get(p.id as number) ?? 0) * fx;
    const total = Math.max(0, gross - (Number(p.discount) || 0) * fx);
    if (total <= 0) continue;
    const dPct = Math.min(100, Math.max(0, Number(p.deposit_pct) || 0));
    const deposit = Math.round(total * (dPct / 100) * 100) / 100;
    const dateOrder = (p.date_order as string) || (p.delivery_date as string);
    const dateBal = (p.delivery_date as string) || (p.date_order as string);
    const who = (p.supplier as string) || "—";
    const ref = (p.pi_number as string) || `PO#${p.id}`;
    const depositPaidOnly = /deposit paid/i.test(status); // deposit only; balance not yet committed

    if (deposit > 0 && dateOrder) {
      out.push({
        id: -(4_000_000_000 + Number(p.id) * 2), txn_date: dateOrder, account_id: 0, category_id: null,
        kind: "expense", details: `Supplier ${ref} · ${who} (Deposit ${dPct}%)`, amount: -deposit, transfer_group: null, created_at: dateOrder,
        account_name: "Supplier", category_name: "OPEX - Supplier Payment", source: "purchase",
      });
    }
    const balance = depositPaidOnly ? 0 : Math.round((total - deposit) * 100) / 100;
    if (balance > 0 && dateBal) {
      out.push({
        id: -(4_000_000_000 + Number(p.id) * 2 + 1), txn_date: dateBal, account_id: 0, category_id: null,
        kind: "expense", details: `Supplier ${ref} · ${who} (Balance)`, amount: -balance, transfer_group: null, created_at: dateBal,
        account_name: "Supplier", category_name: "OPEX - Supplier Payment", source: "purchase",
      });
    }
  }
  return out;
}

// Auto expense for DEFECT WRITE-OFFS from approved returns (defect_writeoffs, migration
// 0075) — the production/purchase COST of a scrapped item, recorded once at approval.
// This is SEPARATE from a customer refund (which appears via loadOrderIncome as a Refund
// expense): a refunded + scrapped return is correctly a double loss. One expense row per
// write-off with loss_amount > 0. Sign convention copies loadPayrollExpense (amount: -loss).
async function loadDefectLoss(): Promise<PanTxnRow[]> {
  const db = createServerSupabase();
  const { data: wos } = await db.from("defect_writeoffs")
    .select("id, return_no, sku, product_name, item_desc, loss_amount, created_at")
    .gt("loss_amount", 0).order("id").limit(LEDGER_CAP);
  if (!wos?.length) return [];
  const out: PanTxnRow[] = [];
  for (const w of wos) {
    const loss = Number(w.loss_amount) || 0;
    if (loss <= 0 || !w.created_at) continue;
    const name = (w.product_name as string) || (w.item_desc as string) || "—";
    const rma = (w.return_no as string) || `#${w.id}`;
    const date = String(w.created_at).slice(0, 10);
    out.push({
      id: -(7_000_000_000 + Number(w.id)), txn_date: date, account_id: 0, category_id: null,
      kind: "expense", details: `Defect write-off · ${name} · ${rma}`,
      amount: -loss, transfer_group: null, created_at: date,
      account_name: "Returns", category_name: "Loss - Defective Returns", source: "return",
    });
  }
  return out;
}

// Recent transactions (joined with account + category names) + auto order income.
export async function loadTransactions(limit = LEDGER_CAP): Promise<PanTxnRow[]> {
  const db = createServerSupabase();
  // pan_transactions is independent of the account/category name lookups — fetch all three in parallel.
  const [{ data }, { data: accs }, { data: cats }] = await Promise.all([
    db.from("pan_transactions")
      .select("id, txn_date, account_id, category_id, kind, details, amount, transfer_group, created_at")
      .order("txn_date", { ascending: false }).order("id", { ascending: false }).limit(limit),
    db.from("pan_accounts").select("id, name").limit(LEDGER_CAP),
    db.from("pan_categories").select("id, name").limit(LEDGER_CAP),
  ]);
  const rows = (data ?? []) as PanTransaction[];

  const accName = new Map<number, string>((accs ?? []).map((a) => [a.id as number, a.name as string]));
  const accIdByName = new Map<string, number>((accs ?? []).map((a) => [(a.name as string).trim().toLowerCase(), a.id as number]));
  const catName = new Map<number, string>((cats ?? []).map((c) => [c.id as number, c.name as string]));

  const manual: PanTxnRow[] = rows.map((r) => ({
    ...r,
    account_name: accName.get(r.account_id) ?? "—",
    category_name: r.category_id != null ? catName.get(r.category_id) ?? null : null,
    source: "manual",
  }));
  const [orders, payroll, advances, workshop, purchases, defects] = await Promise.all([loadOrderIncome(accIdByName), loadPayrollExpense(), loadAdvanceExpense(), loadWorkshopExpense(), loadPurchaseExpense(), loadDefectLoss()]);
  // PINAKABAGO SA IBABAW (2026-09-01, "dapat ung latest transaction ung nasa
  // ibabaw"): ang tie-break sa loob ng parehong araw ay ang synthetic ID noon —
  // ang order payments (−5B…) ay laging nangunguna sa rework (−6B…) kahit mas
  // bago ang rework. Ang ORAS (created_at, isinalin sa PH kapag may oras) ang
  // tamang pangalawang susi; ang ID na lang ang huling tabla.
  const whenKey = (t: PanTxnRow) => {
    const c = String(t.created_at ?? t.txn_date ?? "");
    try {
      return c.includes("T")
        ? new Date(new Date(c).getTime() + 8 * 3600 * 1000).toISOString()
        : c;
    } catch { return c; }
  };
  return [...manual, ...orders, ...payroll, ...advances, ...workshop, ...purchases, ...defects].sort((a, b) => {
    if (a.txn_date < b.txn_date) return 1;
    if (a.txn_date > b.txn_date) return -1;
    const ka = whenKey(a), kb = whenKey(b);
    if (ka < kb) return 1;
    if (ka > kb) return -1;
    // HULING TABLA: ang PINAKABAGONG record muna (2026-09-01, "dapat lage
    // nasa una ung bagong process or approved"). Ang synthetic ids ng derived
    // rows ay NEGATIBO (−5B − payment_id), kaya ang `b.id − a.id` ay naglalagay
    // ng LUMANG bayad sa unahan. Ang |id| ang tama sa dalawang pamilya: mas
    // bagong row = mas malaking payment/txn id = mas malaking |id|.
    return Math.abs(b.id) - Math.abs(a.id);
  });
}
