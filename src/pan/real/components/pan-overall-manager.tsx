"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, cn } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { usePagination, PaginationFooter } from "@/components/pagination-footer";
import { ExportButton } from "@/components/export-button";
import {
  addTransaction, deleteTransaction,
  createAccount, updateAccount, deleteAccount,
  createCategory, updateCategory, deleteCategory,
} from "@/app/hr/overall/actions";
import { ReceiptButton } from "@/components/receipt-button";
import { OrderImagesButton } from "@/components/order-images-button";
import type { OrderRow, ProductRow } from "@/lib/supabase/server";
import type { PanAccount, PanCategory, PanTxnRow, AccountBalance, TxnKind, CategoryKind } from "@/lib/pan/types";

const inp = "w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface";
const btnP = "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60";
const btnG = "rounded-lg border border-border px-2 py-1 text-sm font-medium hover:bg-stone-100 disabled:opacity-60";

const money2 = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function Amt({ n }: { n: number }) {
  if (!n) return <span className="text-muted">—</span>;
  return n > 0
    ? <span className="font-medium text-success">₱{money2(n)}</span>
    : <span className="font-medium text-danger">(₱{money2(Math.abs(n))})</span>;
}
const monthKey = (iso: string) => (iso || "").slice(0, 7);
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabel(key: string): string {
  if (key === "all") return "All Months";
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}

const EXPORT_COLUMNS = [
  { key: "date", label: "Date" },
  { key: "transaction", label: "Transaction" },
  { key: "mop", label: "MOP" },
  { key: "detail", label: "Detail" },
  { key: "branch", label: "Showroom" },
  { key: "expense", label: "Expense" },
  { key: "income", label: "Income" },
];

export function PanOverallManager({ accounts, categories, transactions, orders = [], products = [] }: {
  accounts: PanAccount[]; categories: PanCategory[]; transactions: PanTxnRow[]; orders?: OrderRow[]; products?: ProductRow[];
}) {
  const orderById = useMemo(() => {
    const m = new Map<number, OrderRow>();
    for (const o of orders) m.set(o.id, o);
    return m;
  }, [orders]);
  const months = useMemo(() => [...new Set(transactions.map((t) => monthKey(t.txn_date)))].sort().reverse(), [transactions]);
  const [modal, setModal] = useState<null | "txn" | "accounts" | "categories">(null);
  const [fMonth, setFMonth] = useState<string>(() => months[0] ?? "all");
  // Showroom filter — mula sa branch tags ng order income (San Pedro / Carmona).
  const [fBranch, setFBranch] = useState<string>("all");
  const branches = useMemo(
    () => [...new Set(transactions.map((t) => t.branch).filter((b): b is string => !!b))].sort(),
    [transactions],
  );
  const [pending, start] = useTransition();
  const router = useRouter();

  // Showroom filter muna (kung piniling specific/no-tag), saka month — para ang
  // summary strip, KPI cards, at export ay sumusunod lahat sa napiling showroom.
  const base = useMemo(() => {
    if (fBranch === "all") return transactions;
    if (fBranch === "none") return transactions.filter((t) => !t.branch);
    return transactions.filter((t) => t.branch === fBranch);
  }, [transactions, fBranch]);

  // Rows for the active month (or all), ALWAYS sorted latest-first.
  // PINAKABAGO SA IBABAW (2026-09-01, "dapat nasa ibabaw ung bagong payment"):
  // ang txn_date ay magkahalong date-only at full-ISO, kaya ang paghahambing ay
  // sa PH-normalized na ORAS (created_at kung meron); ang huling tabla ay |id|
  // — ang derived rows ay NEGATIBO ang id, kaya ang lumang `b.id - a.id` ay
  // naglalagay ng pinakalumang bayad sa unahan.
  const rows = useMemo(() => {
    const filtered = fMonth === "all" ? base : base.filter((t) => monthKey(t.txn_date) === fMonth);
    const whenKey = (t: (typeof filtered)[number]) => {
      const c = String((t as { created_at?: string | null }).created_at ?? t.txn_date ?? "");
      try {
        if (c.includes("T")) return new Date(new Date(c).getTime() + 8 * 3600 * 1000).toISOString();
        // Date-only na tatak (walang oras na alam) — ituring na dulo ng araw,
        // para ang bagong bayad ngayong araw ay hindi malamangan ng mga row na
        // may oras mula kaninang umaga; ang |id| na ang maghihiwalay sa kanila.
        return `${c}T23:59:59.999Z`;
      } catch { return c; }
    };
    return [...filtered].sort((a, b) => {
      const ka = whenKey(a), kb = whenKey(b);
      if (ka < kb) return 1;
      if (ka > kb) return -1;
      return Math.abs(b.id) - Math.abs(a.id);
    });
  }, [base, fMonth]);

  // Period totals (whole filtered set, not just the visible page).
  const inflow = rows.reduce((s, t) => (t.kind !== "transfer" && t.amount > 0 ? s + t.amount : s), 0);
  const outflow = rows.reduce((s, t) => (t.kind !== "transfer" && t.amount < 0 ? s - t.amount : s), 0);

  // KPI balances follow the active filters. "All" = true balance (opening + all);
  // a specific month = that month's net movement per payment mode. Order income
  // is counted under the "Order Payment" mode.
  const orderPayId = useMemo(() => accounts.find((a) => a.name.trim().toLowerCase() === "order payment")?.id, [accounts]);
  const view = useMemo(() => {
    const visible = fMonth === "all" ? base : base.filter((t) => monthKey(t.txn_date) === fMonth);
    const byAcct = new Map<number, number>();
    for (const t of visible) {
      const target = t.source === "order" ? (orderPayId ?? t.account_id) : t.account_id;
      if (target) byAcct.set(target, (byAcct.get(target) ?? 0) + t.amount);
    }
    const list: AccountBalance[] = accounts.map((a) => ({ account: a, balance: (fMonth === "all" ? Number(a.opening_balance) : 0) + (byAcct.get(a.id) ?? 0) }));
    // Total includes opening balances + ALL visible amounts (incl. unmapped
    // auto rows like Payroll / Advance that have no specific payment mode).
    const openings = fMonth === "all" ? accounts.reduce((s, a) => s + Number(a.opening_balance), 0) : 0;
    const total = openings + visible.reduce((s, t) => s + t.amount, 0);
    return { list, total };
  }, [base, fMonth, accounts, orderPayId]);

  // Export the active (filtered) ledger rows, mirroring the table's columns.
  const exportRows = useMemo(
    () =>
      rows.map((t) => ({
        date: t.txn_date,
        transaction: t.category_name ?? (t.kind === "transfer" ? "Transfer" : t.kind),
        mop: t.account_name,
        detail: t.details || "",
        branch: t.branch || "",
        expense: t.amount < 0 ? Math.abs(t.amount) : "",
        income: t.amount > 0 ? t.amount : "",
      })),
    [rows],
  );

  const del = (id: number) => start(async () => { await deleteTransaction(id); router.refresh(); });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Month filter — dropdown (default = latest), with All Months */}
          <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium outline-none focus:border-primary">
            <option value="all">All Months</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          {/* Showroom filter — order income tagged San Pedro / Carmona */}
          <select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium outline-none focus:border-primary">
            <option value="all">All Showrooms</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            <option value="none">No showroom tag</option>
          </select>
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
          <ExportButton filename="pan-overall" columns={EXPORT_COLUMNS} rows={exportRows} />
          <button onClick={() => setModal("accounts")} className={btnG}>Payment Modes</button>
          <button onClick={() => setModal("categories")} className={btnG}>Categories</button>
          <button onClick={() => setModal("txn")} className={btnP}>+ Transaction</button>
        </div>
      </div>

      {/* Balances — compact, follows the month selection */}
      <div className="apk-hide grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <BalanceCard label={fMonth === "all" ? "Total Balance" : `Net · ${monthLabel(fMonth)}`} value={view.total} highlight />
        {view.list.map((b) => <BalanceCard key={b.account.id} label={b.account.name} value={b.balance} />)}
      </div>

      {/* Ledger — single clean table, latest-first, paginated */}
      <LedgerTable rows={rows} inflow={inflow} outflow={outflow} showMonth={fMonth === "all"} onDelete={del} pending={pending} orderById={orderById} products={products} />

      {modal === "txn" && <TxnModal accounts={accounts} categories={categories} onClose={() => setModal(null)} />}
      {modal === "accounts" && <AccountsModal accounts={accounts} onClose={() => setModal(null)} />}
      {modal === "categories" && <CategoriesModal categories={categories} onClose={() => setModal(null)} />}
    </div>
  );
}

// Compact KPI card — small height so the ledger stays visible without scrolling.
function BalanceCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={cn("rounded-xl border px-3 py-2 shadow-sm", highlight ? "border-primary/30 bg-primary/[0.04]" : "border-border bg-surface")}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("mt-0.5 text-base font-bold tabular-nums", value < 0 ? "text-danger" : highlight ? "text-success" : "text-foreground")}>₱{money2(value)}</p>
    </div>
  );
}

// Single clean ledger table — enterprise styling, latest-first, paginated.
// Period totals (TOTAL row + Net) reflect the WHOLE filtered set, not just the page.
function LedgerTable({ rows, inflow, outflow, showMonth, onDelete, pending, orderById, products }: {
  rows: PanTxnRow[]; inflow: number; outflow: number; showMonth: boolean; onDelete: (id: number) => void; pending: boolean;
  orderById: Map<number, OrderRow>; products: ProductRow[];
}) {
  const pg = usePagination(rows, 25);
  const net = inflow - outflow;
  const TH = "px-4 py-3 text-center font-medium";
  const TD = "px-4 py-3 text-center";
  // Per-showroom income breakdown ng filtered period (Order Payments na may branch tag).
  const branchIncome = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of rows) if (t.amount > 0 && t.branch) m.set(t.branch, (m.get(t.branch) ?? 0) + t.amount);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);
  return (
    <Card className="overflow-visible rounded-2xl p-0">
      {/* period summary strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-stone-50 px-5 py-3 text-sm">
        <span className="font-semibold">{rows.length} transaction{rows.length === 1 ? "" : "s"}</span>
        <div className="flex flex-wrap items-center gap-4 tabular-nums">
          {branchIncome.map(([b, amt]) => (
            <span key={b} className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", /san pedro/i.test(b) ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700")}>
              {b} ₱{money2(amt)}
            </span>
          ))}
          <span>Income <b className="text-success">₱{money2(inflow)}</b></span>
          <span>Expense <b className="text-danger">₱{money2(outflow)}</b></span>
          <span>Net <b className={cn(net < 0 ? "text-danger" : "text-success")}>₱{money2(net)}</b></span>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto pf-scroll">
        <table className="w-full min-w-[820px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
          <thead className="sticky top-0 z-10">
            <tr className="sticky top-0 bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={showMonth ? 5 : 4} className="border-b border-[#caa45a] px-5 py-2">Transaction</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Amount</th>
              <th className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2" />
            </tr>
            <tr className="sticky top-[30px] bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className={TH}>Date</th>
              {showMonth && <th className={TH}>Month</th>}
              <th className={TH}>Transaction</th>
              <th className={TH}>MOP</th>
              <th className={TH}>Detail</th>
              <th className={cn(TH, "!border-l-4 !border-l-[#caa45a]")}>Expense</th>
              <th className={TH}>Income</th>
              <th className={cn(TH, "!border-l-4 !border-l-[#caa45a]")} />
            </tr>
          </thead>
          <tbody>
            {pg.slice.map((t) => {
              const isTransfer = t.kind === "transfer";
              return (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-stone-50">
                  <td className={cn(TD, "whitespace-nowrap text-muted")}>{shortDate(t.txn_date)}</td>
                  {showMonth && <td className={cn(TD, "whitespace-nowrap text-muted")}>{monthLabel(monthKey(t.txn_date))}</td>}
                  <td className={TD}>
                    <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-medium",
                      t.kind === "income" ? "bg-green-50 text-green-700" : isTransfer ? "bg-stone-100 text-stone-600" : "bg-red-50 text-red-700")}>
                      {t.category_name ?? (isTransfer ? "Transfer" : t.kind)}
                    </span>
                  </td>
                  <td className={cn(TD, "font-medium")}>{t.account_name}</td>
                  <td className={cn(TD, "text-muted")}>
                    {t.details || "—"}
                    {t.branch && (
                      <span className={cn(
                        "ml-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold",
                        /san pedro/i.test(t.branch) ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700",
                      )}>{t.branch}</span>
                    )}
                    {(() => {
                      // For an order payment, surface the customer's Facebook link (if any)
                      // so it's one tap back to the Messenger chat from the ledger.
                      const o = t.source === "order" && t.order_id != null ? orderById.get(t.order_id) : null;
                      if (o?.fb_link) {
                        return <a href={o.fb_link} target="_blank" rel="noopener noreferrer" className="ml-1.5 whitespace-nowrap text-xs font-medium text-info hover:underline">· ⓕ {o.fb_name || "FB"}</a>;
                      }
                      return null;
                    })()}
                  </td>
                  <td className={cn(TD, "!border-l-4 !border-l-[#caa45a] tabular-nums", isTransfer ? "text-muted" : "text-danger")}>{t.amount < 0 ? money2(Math.abs(t.amount)) : "—"}</td>
                  <td className={cn(TD, "tabular-nums", isTransfer ? "text-muted" : "text-success")}>{t.amount > 0 ? money2(t.amount) : "—"}</td>
                  <td className={cn(TD, "!border-l-4 !border-l-[#caa45a] text-center")}>
                    {(() => {
                      const order = t.source === "order" && t.order_id != null ? orderById.get(t.order_id) : null;
                      if (order) {
                        // Order payment → its Acknowledgement Receipt + all attached
                        // receipt/slip images (same gallery as Sales Orders), so
                        // every receipt is reachable from the ledger too.
                        return (
                          <div className="flex items-center justify-center gap-1">
                            <ReceiptButton order={order} products={products} />
                            <OrderImagesButton images={order.transaction_images ?? []} title={order.order_number ?? undefined} />
                          </div>
                        );
                      }
                      // Rework payment → ang mga rework receipt slip na naka-attach
                      // sa linked order (rework-receipts/ prefix lang, hindi buong gallery).
                      if (t.source === "return" && t.order_id != null) {
                        const ro = orderById.get(t.order_id);
                        const slips = (ro?.transaction_images ?? []).filter((u) => /\/rework-receipts\//.test(u));
                        if (slips.length) return <OrderImagesButton images={slips} title={t.order_number ?? undefined} />;
                      }
                      if (t.source && t.source !== "manual") {
                        return <span title="Auto (Orders / Payroll / Advance) — read-only" className="text-[10px] font-semibold uppercase tracking-wide text-muted">Auto</span>;
                      }
                      return <button onClick={() => onDelete(t.id)} disabled={pending} className="rounded px-1.5 text-muted hover:text-danger" title="Delete">✕</button>;
                    })()}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={showMonth ? 8 : 7} className="px-4 py-16 text-center text-muted">No transactions. Click <b>+ Transaction</b>.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-border bg-stone-50 font-semibold">
                <td className={TD} colSpan={showMonth ? 5 : 4}>TOTAL · {rows.length} item{rows.length === 1 ? "" : "s"}</td>
                <td className={cn(TD, "!border-l-4 !border-l-[#caa45a] tabular-nums text-danger")}>{money2(outflow)}</td>
                <td className={cn(TD, "tabular-nums text-success")}>{money2(inflow)}</td>
                <td className={cn(TD, "!border-l-4 !border-l-[#caa45a]")} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <PaginationFooter {...pg} />
    </Card>
  );
}

function Modal({ title, subtitle, children, onClose, wide }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className={cn("w-full overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-black/5", wide ? "max-w-lg" : "max-w-md")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 bg-gradient-to-br from-[#5b5026] to-[#3a3318] px-6 py-4">
          <div>
            <h3 className="text-base font-semibold leading-tight text-white">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-white/70">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white">✕</button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto p-6 pf-scroll">{children}</div>
      </div>
    </div>
  );
}

// Searchable typeahead dropdown — fast picking from a long list (e.g. 60 categories).
function Combobox({ items, value, onChange, placeholder }: { items: { id: number; name: string }[]; value: string; onChange: (v: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = items.find((i) => String(i.id) === value);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? items.filter((i) => i.name.toLowerCase().includes(s)) : items).slice(0, 60);
  }, [items, q]);
  return (
    <div className="relative">
      <input
        value={open ? q : (selected?.name ?? "")}
        onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setQ(""); setOpen(true); }}
        placeholder={placeholder}
        className={inp}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
            <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="w-full px-3 py-1.5 text-left text-sm text-muted hover:bg-stone-100">— none —</button>
            {matches.map((i) => (
              <button key={i.id} type="button" onClick={() => { onChange(String(i.id)); setOpen(false); }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100">{i.name}</button>
            ))}
            {matches.length === 0 && <p className="px-3 py-3 text-center text-xs text-muted">No match.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function TxnModal({ accounts, categories, onClose }: { accounts: PanAccount[]; categories: PanCategory[]; onClose: () => void }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<TxnKind>("expense");
  const [f, setF] = useState({ date: today, account: "", to: "", category: "", amount: "", details: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cats = useMemo(() => categories.filter((c) => c.kind === (kind === "income" ? "income" : "expense")), [categories, kind]);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  function save() {
    setError(null);
    start(async () => {
      const r = await addTransaction({
        txn_date: f.date, kind,
        account_id: Number(f.account),
        to_account_id: kind === "transfer" ? Number(f.to) : null,
        category_id: kind === "transfer" ? null : (f.category ? Number(f.category) : null),
        amount: Number(f.amount),
        details: f.details,
      });
      if ("error" in r) { setError(r.error); return; }
      onClose(); router.refresh();
    });
  }

  return (
    <Modal title="New Transaction" subtitle="Record income, expense, or a transfer between modes" onClose={onClose}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-border bg-stone-50 p-1">
          {(["income", "expense", "transfer"] as const).map((k) => {
            const tone = k === "income" ? "bg-green-600 text-white" : k === "expense" ? "bg-red-600 text-white" : "bg-stone-700 text-white";
            return (
              <button key={k} type="button" onClick={() => setKind(k)} className={cn("rounded-lg px-3 py-2 text-sm font-semibold capitalize transition-all", kind === k ? `${tone} shadow-sm` : "text-muted hover:bg-stone-100")}>{k}</button>
            );
          })}
        </div>
        <div><label className="mb-1 block text-sm font-medium">Date</label><input value={f.date} onChange={(e) => set("date", e.target.value)} type="date" className={inp} /></div>
        {kind === "transfer" ? (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-sm font-medium">From (Mode Of Payment)</label><Combobox items={accounts} value={f.account} onChange={(v) => set("account", v)} placeholder="Search payment mode…" /></div>
            <div><label className="mb-1 block text-sm font-medium">To (Mode Of Payment)</label><Combobox items={accounts} value={f.to} onChange={(v) => set("to", v)} placeholder="Search payment mode…" /></div>
          </div>
        ) : (
          <>
            <div><label className="mb-1 block text-sm font-medium">Mode Of Payment</label><Combobox items={accounts} value={f.account} onChange={(v) => set("account", v)} placeholder="Search payment mode…" /></div>
            <div><label className="mb-1 block text-sm font-medium">Category</label><Combobox items={cats} value={f.category} onChange={(v) => set("category", v)} placeholder="Search category…" /></div>
          </>
        )}
        <div><label className="mb-1 block text-sm font-medium">Amount</label><input value={f.amount} onChange={(e) => set("amount", e.target.value)} type="number" step="0.01" placeholder="0.00" className={inp} /></div>
        <div><label className="mb-1 block text-sm font-medium">Detail</label><input value={f.details} onChange={(e) => set("details", e.target.value)} placeholder="e.g. Davao - materials" className={inp} /></div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className={btnG}>Cancel</button><button onClick={save} disabled={pending} className={btnP}>{pending ? "Saving…" : "Save"}</button></div>
    </Modal>
  );
}

function AccountsModal({ accounts, onClose }: { accounts: PanAccount[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nName, setNName] = useState("");
  const [nOpen, setNOpen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: true } | { error: string }>) => start(async () => { const r = await fn(); if ("error" in r) setError(r.error); else { setError(null); router.refresh(); } });

  return (
    <Modal title="Manage Payment Modes" onClose={onClose} wide>
      <div className="space-y-2">
        {accounts.map((a) => <AccountRow key={a.id} a={a} onSave={(name, ob) => act(() => updateAccount(a.id, name, ob))} onDelete={() => act(() => deleteAccount(a.id))} disabled={pending} />)}
      </div>
      <div className="mt-4 rounded-xl border border-dashed border-border p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Add payment mode</p>
        <div className="flex gap-2">
          <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="e.g. BPI, GCash, Cash" className={inp} />
          <input value={nOpen} onChange={(e) => setNOpen(e.target.value)} type="number" step="0.01" placeholder="Opening" className="w-32 rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary" />
          <button onClick={() => { if (nName.trim()) act(() => createAccount(nName, Number(nOpen) || 0)); setNName(""); setNOpen(""); }} disabled={pending} className={btnP}>Add</button>
        </div>
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex justify-end"><button onClick={onClose} className={btnG}>Done</button></div>
    </Modal>
  );
}

function AccountRow({ a, onSave, onDelete, disabled }: { a: PanAccount; onSave: (name: string, ob: number) => void; onDelete: () => void; disabled: boolean }) {
  const [name, setName] = useState(a.name);
  const [ob, setOb] = useState(String(a.opening_balance));
  const dirty = name !== a.name || Number(ob) !== Number(a.opening_balance);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
      <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none focus:border-border focus:bg-stone-50" />
      <span className="text-xs text-muted">open</span>
      <input value={ob} onChange={(e) => setOb(e.target.value)} type="number" step="0.01" className="w-28 rounded-md border border-border bg-stone-50 px-2 py-1 text-right text-sm outline-none focus:border-primary" />
      {dirty && <button onClick={() => onSave(name, Number(ob) || 0)} disabled={disabled} className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-accent disabled:opacity-50">Save</button>}
      <button onClick={onDelete} disabled={disabled} className="rounded px-1.5 text-muted hover:text-danger" title="Delete">✕</button>
    </div>
  );
}

function CategoriesModal({ categories, onClose }: { categories: PanCategory[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nName, setNName] = useState("");
  const [nKind, setNKind] = useState<CategoryKind>("expense");
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: true } | { error: string }>) => start(async () => { const r = await fn(); if ("error" in r) setError(r.error); else { setError(null); router.refresh(); } });

  return (
    <Modal title="Manage Categories" onClose={onClose} wide>
      <div className="space-y-2">
        {categories.map((c) => <CategoryRow key={c.id} c={c} onSave={(name, kind) => act(() => updateCategory(c.id, name, kind))} onDelete={() => act(() => deleteCategory(c.id))} disabled={pending} />)}
      </div>
      <div className="mt-4 rounded-xl border border-dashed border-border p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Add category</p>
        <div className="flex gap-2">
          <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="e.g. OPEX - Supplier Payment - X" className={inp} />
          <select value={nKind} onChange={(e) => setNKind(e.target.value as CategoryKind)} className="w-32 rounded-lg border border-border bg-stone-50 px-2 py-2 text-sm outline-none focus:border-primary"><option value="expense">Expense</option><option value="income">Income</option></select>
          <button onClick={() => { if (nName.trim()) act(() => createCategory(nName, nKind)); setNName(""); }} disabled={pending} className={btnP}>Add</button>
        </div>
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex justify-end"><button onClick={onClose} className={btnG}>Done</button></div>
    </Modal>
  );
}

function CategoryRow({ c, onSave, onDelete, disabled }: { c: PanCategory; onSave: (name: string, kind: CategoryKind) => void; onDelete: () => void; disabled: boolean }) {
  const [name, setName] = useState(c.name);
  const [kind, setKind] = useState<CategoryKind>(c.kind);
  const dirty = name !== c.name || kind !== c.kind;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
      <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none focus:border-border focus:bg-stone-50" />
      <select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)} className="rounded-md border border-border bg-stone-50 px-2 py-1 text-xs outline-none focus:border-primary"><option value="expense">Expense</option><option value="income">Income</option></select>
      {dirty && <button onClick={() => onSave(name, kind)} disabled={disabled} className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-accent disabled:opacity-50">Save</button>}
      <button onClick={onDelete} disabled={disabled} className="rounded px-1.5 text-muted hover:text-danger" title="Delete">✕</button>
    </div>
  );
}
