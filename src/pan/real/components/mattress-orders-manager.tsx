"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "./ui";
import { usePagination, PaginationFooter } from "./pagination-footer";
import type { MattressData, MattressOrder } from "@/app/mattress-orders/data";
import { saveMattressOrder, deleteMattressOrder, type MattressInput } from "@/app/mattress-orders/actions";

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const STATUSES = ["Pending", "Ordered", "Done", "Cancelled"];
const REGIONS = [
  { key: "Luzon", dot: "bg-blue-500", text: "text-blue-700" },
  { key: "Davao", dot: "bg-amber-500", text: "text-amber-700" },
];

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1] ?? m;
  return `${mo} ${Number(day)}, ${y}`;
}

function statusPill(s: string | null) {
  const v = (s ?? "").toLowerCase();
  const map: Record<string, string> = {
    done: "bg-green-50 text-green-700",
    ordered: "bg-blue-50 text-blue-700",
    pending: "bg-amber-50 text-amber-700",
    cancelled: "bg-rose-50 text-rose-700",
  };
  return map[v] ?? "bg-stone-100 text-stone-500";
}

export function MattressOrdersManager({ data }: { data: MattressData }) {
  const [tab, setTab] = useState("Luzon");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<MattressOrder | "new" | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (r.region !== tab) return false;
      return !s || [r.client, r.order, r.status].some((x) => (x ?? "").toLowerCase().includes(s));
    });
  }, [data.rows, tab, q]);

  const pg = usePagination(rows);

  return (
    <div className="space-y-5">
      {/* KPI */}
      <div className="apk-hide grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total Orders" value={String(data.kpi.total)} accent="bg-primary/10 text-primary" icon="list" />
        <Kpi label="Luzon" value={String(data.kpi.luzon)} accent="bg-blue-100 text-blue-600" icon="pin" />
        <Kpi label="Davao" value={String(data.kpi.davao)} accent="bg-amber-100 text-amber-600" icon="pin" />
        <Kpi label="Done" value={String(data.kpi.done)} accent="bg-green-100 text-green-600" icon="check" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client / order…" className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
        <button onClick={() => setEdit("new")} className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90">+ Add Order</button>
      </div>

      {/* Table */}
      <div className="overflow-visible rounded-xl border border-border bg-surface shadow-sm">
        <div className="max-h-[70vh] overflow-auto rounded-t-xl">
        <table className="w-full min-w-[820px] border-collapse text-center text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:align-middle [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
          <colgroup>
            <col />
            <col span={2} />
            <col span={2} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th className="border-b border-[#caa45a] px-5 py-2">Client</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Order Details</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2"></th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="px-4 py-3">Name of Client</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Order</th>
              <th className="px-4 py-3">Order Date</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-muted">No {tab} orders. Click <b>+ Add Order</b>.</td></tr>
            ) : pg.slice.map((r) => (
              <tr key={r.id} className="hover:bg-stone-50">
                <td className="px-4 py-3 font-semibold">{r.client}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 align-middle whitespace-pre-line text-muted">{r.order || "—"}</td>
                <td className="px-4 py-3 tabular-nums text-muted">{fmtDate(r.order_date)}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusPill(r.status))}>{r.status || "—"}</span></td>
                <td className="px-4 py-3"><button onClick={() => setEdit(r)} className="rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5">Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <PaginationFooter {...pg} />
      </div>

      {/* Excel-style region tabs — fixed footer */}
      <div className="fixed bottom-0 left-0 right-0 z-30 flex items-center gap-1 overflow-x-auto border-t border-border bg-surface/95 px-4 py-2 backdrop-blur md:left-64 sm:px-6">
        <span className="mr-2 flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18" /></svg>
          Region
        </span>
        {REGIONS.map((t) => {
          const active = tab === t.key;
          const count = data.rows.filter((r) => r.region === t.key).length;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} className={cn("flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3 py-1.5 text-sm font-medium transition-colors", active ? cn("border-current bg-stone-50", t.text) : "border-transparent text-muted hover:bg-stone-50")}>
              <span className={cn("h-2 w-2 rounded-full", t.dot)} />
              {t.key}
              <span className={cn("rounded-full px-1.5 text-[11px]", active ? "bg-stone-200/70" : "bg-stone-100 text-muted")}>{count}</span>
            </button>
          );
        })}
      </div>

      {edit && <OrderForm o={edit === "new" ? null : edit} defaultRegion={tab} onClose={() => setEdit(null)} />}
    </div>
  );
}

function OrderForm({ o, defaultRegion, onClose }: { o: MattressOrder | null; defaultRegion: string; onClose: () => void }) {
  const isNew = !o;
  const [pending, start] = useTransition();
  const [delPending, startDel] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  // A Done order is LOCKED — no edits (matches the server guard).
  const locked = !!o?.done_at;
  const [f, setF] = useState<MattressInput>({
    client: o?.client ?? "",
    order: o?.order ?? "",
    order_date: o?.order_date ?? "",
    status: o?.status ?? "Pending",
    region: o?.region ?? defaultRegion,
    amount: o?.amount ?? 0,
    paid_via: o?.paid_via ?? "Cash",
  });
  const set = (k: keyof MattressInput, v: string | number) => setF((p) => ({ ...p, [k]: v }));

  function submit() {
    setError(null);
    start(async () => {
      const res = await saveMattressOrder(o?.id ?? null, f);
      if ("error" in res) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  }
  function remove() {
    if (!o) return;
    startDel(async () => {
      const res = await deleteMattressOrder(o.id);
      if ("error" in res) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">{isNew ? "Add Mattress Order" : "Edit Mattress Order"}</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
        </div>
        {locked && (
          <p className="mx-5 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">✓ This order is Done and locked — recorded in PAN Overall. It can no longer be edited.</p>
        )}
        <div className={cn("grid grid-cols-2 gap-3 p-5", locked && "pointer-events-none opacity-60")}>
          <F label="Name of Client *" full><input value={f.client} disabled={locked} onChange={(e) => set("client", e.target.value)} placeholder="Juan Dela Cruz" className={cn(inp, "w-full")} /></F>
          <F label="Order" full><textarea value={f.order ?? ""} disabled={locked} onChange={(e) => set("order", e.target.value)} rows={2} placeholder="Uratex 6x60x75 comfort plus mattress" className={cn(inp, "w-full resize-none")} /></F>
          <F label="Amount (₱)"><input type="number" min={0} value={f.amount || ""} disabled={locked} onChange={(e) => set("amount", Number(e.target.value))} placeholder="0" className={cn(inp, "w-full")} /></F>
          <F label="Paid via"><select value={f.paid_via ?? "Cash"} disabled={locked} onChange={(e) => set("paid_via", e.target.value)} className={cn(inp, "w-full")}>{["Cash", "Maya", "Maya Terminal", "GCash", "BPI", "BDO", "SEABANK", "Bank Transfer"].map((m) => <option key={m}>{m}</option>)}</select></F>
          <F label="Order Date"><input type="date" value={f.order_date ?? ""} disabled={locked} onChange={(e) => set("order_date", e.target.value)} className={cn(inp, "w-full")} /></F>
          <F label="Status"><select value={f.status ?? ""} disabled={locked} onChange={(e) => set("status", e.target.value)} className={cn(inp, "w-full")}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Region"><select value={f.region} disabled={locked} onChange={(e) => set("region", e.target.value)} className={cn(inp, "w-full")}>{REGIONS.map((r) => <option key={r.key}>{r.key}</option>)}</select></F>
        </div>
        {error && <p className="px-5 pb-2 text-sm text-rose-600">{error}</p>}
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          {!isNew ? <button onClick={remove} disabled={delPending} className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">{delPending ? "Deleting…" : "Delete"}</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-stone-100">{locked ? "Close" : "Cancel"}</button>
            {!locked && <button onClick={submit} disabled={pending} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={cn("flex flex-col gap-1", full && "col-span-2")}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, value, accent, icon }: { label: string; value: string; accent: string; icon: "list" | "pin" | "check" }) {
  const paths: Record<string, React.ReactNode> = {
    list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
    pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m9 12 2 2 4-4" /></>,
  };
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", accent)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[icon]}</svg></span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
