"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { cn } from "./ui";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { createSupplier, updateSupplier, deleteSupplier, type SupplierInput } from "@/app/suppliers/actions";
import { createRate, updateRate, deleteRate, type RateInput } from "@/app/suppliers/rate-actions";
import type { SuppliersData, Supplier } from "@/app/suppliers/data";
import type { Rate } from "@/app/suppliers/rates";

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const peso = (n: number) => "₱" + (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const RATE_CATS = ["Material", "Labor", "Carpentry", "Mattress", "Fabric", "Hardware", "Other"];
type Tab = "local" | "shopee" | "rates";
const TABS: { key: Tab; label: string; dot: string; text: string }[] = [
  { key: "local", label: "Supplier", dot: "bg-green-500", text: "text-green-700" },
  { key: "shopee", label: "Shopee", dot: "bg-orange-500", text: "text-orange-600" },
  { key: "rates", label: "Rates", dot: "bg-violet-500", text: "text-violet-700" },
];
const typePill = (t: string) =>
  t === "shopee" ? "bg-orange-100 text-orange-700" : t === "imported" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700";

export function SuppliersManager({ data, rates }: { data: SuppliersData; rates: Rate[] }) {
  const [tab, setTab] = useState<Tab>("local");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Supplier | "new" | null>(null);
  const [editRate, setEditRate] = useState<Rate | "new" | null>(null);
  const [rateCat, setRateCat] = useState("All");
  const [statusF, setStatusF] = useState<"All" | "active" | "inactive">("All");

  const rateCategories = useMemo(
    () => ["All", ...Array.from(new Set(rates.map((r) => r.category).filter(Boolean) as string[])).sort()],
    [rates],
  );

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      const t = r.type === "shopee" ? "shopee" : "local";
      if (t !== tab) return false;
      if (statusF !== "All" && r.status !== statusF) return false;
      if (!s) return true;
      return [r.name, r.contact_person, r.contact_number, r.materials, r.address].some((x) => (x ?? "").toLowerCase().includes(s));
    });
  }, [data.rows, tab, q, statusF]);

  const rateRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rates.filter((r) => {
      if (rateCat !== "All" && r.category !== rateCat) return false;
      return !s || [r.item, r.category, r.unit].some((x) => (x ?? "").toLowerCase().includes(s));
    });
  }, [rates, q, rateCat]);

  const pg = usePagination<Rate | Supplier>(tab === "rates" ? rateRows : rows);

  return (
    <div className="space-y-5 pb-16">
      {/* KPI */}
      <div className="apk-hide grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total Suppliers" value={data.kpi.total} accent="bg-primary/10 text-primary" />
        <Kpi label="Supplier (Local)" value={data.kpi.local + data.kpi.imported} accent="bg-green-100 text-green-600" />
        <Kpi label="Shopee Shops" value={data.kpi.shopee} accent="bg-orange-100 text-orange-600" />
        <Kpi label="Active" value={data.kpi.active} accent="bg-blue-100 text-blue-600" />
      </div>

      {/* Toolbar: search + add */}
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === "rates" ? "Search rate…" : "Search supplier…"} className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
        {tab === "rates" ? (
          <div className="flex flex-wrap gap-1.5">
            {rateCategories.map((c) => (
              <button key={c} onClick={() => setRateCat(c)} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", rateCat === c ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted hover:bg-stone-100")}>{c}</button>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(["All", "active", "inactive"] as const).map((c) => (
              <button key={c} onClick={() => setStatusF(c)} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors", statusF === c ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted hover:bg-stone-100")}>{c}</button>
            ))}
          </div>
        )}
        <button onClick={() => (tab === "rates" ? setEditRate("new") : setEdit("new"))} className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90">+ Add {tab === "shopee" ? "Shopee Shop" : tab === "rates" ? "Rate" : "Supplier"}</button>
      </div>

      {/* Table */}
      <div className="overflow-visible rounded-xl border border-border bg-surface shadow-sm">
        <div className="max-h-[70vh] overflow-auto rounded-t-xl pf-scroll">
          {tab === "rates" ? (
            /* ── Rates view ── */
            <table className="w-full min-w-[820px] border-collapse text-center text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:align-middle [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
              <colgroup>
                <col span={3} />
                <col span={1} />
                <col span={2} />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
                  <th colSpan={3} className="border-b border-[#caa45a] bg-[#4a3b1a] px-5 py-2">Rate Information</th>
                  <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a] px-5 py-2">Pricing</th>
                  <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a]"></th>
                </tr>
                <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
                  <th className="bg-[#5a4a26] px-4 py-3">Item</th>
                  <th className="bg-[#5a4a26] px-4 py-3">Category</th>
                  <th className="bg-[#5a4a26] px-4 py-3">Unit</th>
                  <th className="!border-l-4 !border-l-[#caa45a] bg-[#5a4a26] px-4 py-3">Unit Price</th>
                  <th className="!border-l-4 !border-l-[#caa45a] bg-[#5a4a26] px-4 py-3">Status</th>
                  <th className="bg-[#5a4a26] px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rateRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">No rates yet. Click <b>+ Add Rate</b>.</td></tr>
                ) : (pg.slice as typeof rateRows).map((r) => (
                  <tr key={r.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 font-medium">{r.item}</td>
                    <td className="px-4 py-3">{r.category ? <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium">{r.category}</span> : "—"}</td>
                    <td className="px-4 py-3 text-muted">{r.unit ?? "—"}</td>
                    <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 font-semibold tabular-nums">{peso(r.unit_price)}</td>
                    <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", r.status === "active" ? "bg-green-50 text-green-700" : "bg-stone-100 text-stone-500")}>{r.status}</span></td>
                    <td className="px-4 py-3"><button onClick={() => setEditRate(r)} className="rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5">Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tab === "shopee" ? (
            /* ── Shopee view (Receiving-Log style) ── */
            <table className="w-full min-w-[900px] border-collapse text-center text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:align-middle [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
              <colgroup>
                <col span={2} />
                <col span={2} />
                <col span={1} />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
                  <th colSpan={2} className="border-b border-[#caa45a] bg-[#4a3b1a] px-5 py-2">Shop Information</th>
                  <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a] px-5 py-2">Details</th>
                  <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a]"></th>
                </tr>
                <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
                  <th className="bg-[#5a4a26] px-4 py-3">Shop Name</th>
                  <th className="bg-[#5a4a26] px-4 py-3">Shopee Supplies / Items</th>
                  <th className="!border-l-4 !border-l-[#caa45a] bg-[#5a4a26] px-4 py-3">Shop Link</th>
                  <th className="bg-[#5a4a26] px-4 py-3">Status</th>
                  <th className="!border-l-4 !border-l-[#caa45a] bg-[#5a4a26] px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-muted">No Shopee shops. Click <b>+ Add Shopee Shop</b>.</td></tr>
                ) : (pg.slice as typeof rows).map((r) => (
                  <tr key={r.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 align-top font-semibold">{r.name}</td>
                    <td className="px-4 py-3 align-top whitespace-pre-line text-muted">{r.materials || "—"}</td>
                    <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 align-top">{r.link ? <a href={r.link} target="_blank" rel="noreferrer" className="text-primary hover:underline">{r.link.replace(/^https?:\/\//, "").slice(0, 26)}…</a> : "—"}</td>
                    <td className="px-4 py-3 align-top"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", r.status === "active" ? "bg-green-50 text-green-700" : "bg-stone-100 text-stone-500")}>{r.status}</span></td>
                    <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 align-top"><button onClick={() => setEdit(r)} className="rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5">Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            /* ── Supplier (Local) view (Receiving-Log style) ── */
            <table className="w-full xl:min-w-[1080px] border-collapse text-center text-[11px] xl:text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:align-middle [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
              <colgroup>
                <col span={2} />
                <col span={2} />
                <col span={2} />
                <col span={1} />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
                  <th colSpan={2} className="border-b border-[#caa45a] bg-[#4a3b1a] px-5 py-2">Company</th>
                  <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a] px-5 py-2">Contact</th>
                  <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a] px-5 py-2">Supplies</th>
                  <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] bg-[#4a3b1a]"></th>
                </tr>
                <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
                  <th className="bg-[#5a4a26] px-4 py-3">Name of Company</th>
                  <th className="bg-[#5a4a26] px-4 py-3">Address</th>
                  <th className="!border-l-4 !border-l-[#caa45a] bg-[#5a4a26] px-4 py-3">Contact Person</th>
                  <th className="bg-[#5a4a26] px-4 py-3">Contact Number</th>
                  <th className="!border-l-4 !border-l-[#caa45a] bg-[#5a4a26] px-4 py-3">List of Materials / Tools</th>
                  <th className="bg-[#5a4a26] px-4 py-3">Status</th>
                  <th className="!border-l-4 !border-l-[#caa45a] bg-[#5a4a26] px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">No suppliers yet. Click <b>+ Add Supplier</b>.</td></tr>
                ) : (pg.slice as typeof rows).map((r) => (
                  <tr key={r.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 align-top font-medium">{r.name}</td>
                    <td className="px-4 py-3 align-top text-muted">{r.address ?? "—"}</td>
                    <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 align-top text-muted">{r.contact_person ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 align-top text-muted">{r.contact_number ?? "—"}</td>
                    <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 align-top whitespace-pre-line text-muted">{r.materials || "—"}</td>
                    <td className="px-4 py-3 align-top"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", r.status === "active" ? "bg-green-50 text-green-700" : "bg-stone-100 text-stone-500")}>{r.status}</span></td>
                    <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 align-top"><button onClick={() => setEdit(r)} className="rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5">Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <PaginationFooter {...pg} />
      </div>

      {/* Excel-style sheet tabs — fixed footer (spans the main column) */}
      <div className="fixed bottom-0 left-0 right-0 z-30 flex items-center gap-1 overflow-x-auto border-t border-border bg-surface/95 px-4 py-2 backdrop-blur md:left-64 sm:px-6">
        <span className="mr-2 flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18" /></svg>
          Sheets
        </span>
        {TABS.map((t) => {
          const active = tab === t.key;
          const count = t.key === "rates" ? rates.length : data.rows.filter((r) => (r.type === "shopee" ? "shopee" : "local") === t.key).length;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} className={cn("flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3 py-1.5 text-sm font-medium transition-colors", active ? cn("border-current bg-stone-50", t.text) : "border-transparent text-muted hover:bg-stone-50")}>
              <span className={cn("h-2 w-2 rounded-full", t.dot)} />
              {t.label}
              <span className={cn("rounded-full px-1.5 text-[11px]", active ? "bg-stone-200/70" : "bg-stone-100 text-muted")}>{count}</span>
            </button>
          );
        })}
      </div>

      {edit && <SupplierForm s={edit === "new" ? null : edit} defaultType={tab === "rates" ? "local" : tab} onClose={() => setEdit(null)} />}
      {editRate && <RateForm r={editRate === "new" ? null : editRate} onClose={() => setEditRate(null)} />}
    </div>
  );
}

function RateForm({ r, onClose }: { r: Rate | null; onClose: () => void }) {
  const isNew = !r;
  const [pending, start] = useTransition();
  const [delPending, startDel] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [f, setF] = useState<RateInput>({
    item: r?.item ?? "",
    category: r?.category ?? "Material",
    unit: r?.unit ?? "",
    unit_price: r?.unit_price ?? 0,
    notes: r?.notes ?? "",
    status: r?.status ?? "active",
  });
  const set = (k: keyof RateInput, v: string | number) => setF((p) => ({ ...p, [k]: v }));

  function save() {
    setError(null);
    if (!f.item.trim()) { setError("Item is required."); return; }
    start(async () => {
      const res = isNew ? await createRate(f) : await updateRate(r!.id, f);
      if ("error" in res) { setError(res.error); return; }
      onClose(); router.refresh();
    });
  }
  function remove() {
    if (!r) return;
    startDel(async () => { const res = await deleteRate(r.id); if ("error" in res) { setError(res.error); return; } onClose(); router.refresh(); });
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "Add Rate" : `Edit ${r!.item}`} size="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          {!isNew ? <button onClick={remove} disabled={delPending} className="rounded-lg border border-danger/40 px-3 py-2 text-sm font-medium text-danger hover:bg-red-50 disabled:opacity-60">{delPending ? "Deleting…" : "Delete"}</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Cancel</button>
            <button onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">{pending ? "Saving…" : isNew ? "Add Rate" : "Save"}</button>
          </div>
        </div>
      }>
      <div className="grid grid-cols-2 gap-3">
        <F label="Item *" full><input value={f.item} onChange={(e) => set("item", e.target.value)} placeholder="e.g. 1 Pu2 foam / Labor carpentry" className={inp} /></F>
        <F label="Category"><select value={f.category ?? ""} onChange={(e) => set("category", e.target.value)} className={inp}>{RATE_CATS.map((c) => <option key={c}>{c}</option>)}</select></F>
        <F label="Unit"><input value={f.unit ?? ""} onChange={(e) => set("unit", e.target.value)} placeholder="pc / yard / bed" className={inp} /></F>
        <F label="Unit Price (₱)"><input type="number" min={0} step="0.01" value={f.unit_price || ""} onChange={(e) => set("unit_price", Number(e.target.value))} className={inp} /></F>
        <F label="Status"><select value={f.status} onChange={(e) => set("status", e.target.value)} className={inp}><option value="active">Active</option><option value="inactive">Inactive</option></select></F>
        <F label="Notes" full><input value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} className={inp} /></F>
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
    </Modal>
  );
}

function SupplierForm({ s, defaultType, onClose }: { s: Supplier | null; defaultType: SupplierInput["type"]; onClose: () => void }) {
  const isNew = !s;
  const [pending, start] = useTransition();
  const [delPending, startDel] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [f, setF] = useState<SupplierInput>({
    name: s?.name ?? "",
    type: s?.type ?? defaultType,
    address: s?.address ?? "",
    contact_person: s?.contact_person ?? "",
    contact_number: s?.contact_number ?? "",
    email: s?.email ?? "",
    link: s?.link ?? "",
    materials: s?.materials ?? "",
    status: s?.status ?? "active",
    notes: s?.notes ?? "",
  });
  const set = (k: keyof SupplierInput, v: string) => setF((p) => ({ ...p, [k]: v }));
  const isShopee = f.type === "shopee";

  function save() {
    setError(null);
    if (!f.name.trim()) { setError("Supplier name is required."); return; }
    start(async () => {
      const res = isNew ? await createSupplier(f) : await updateSupplier(s!.id, f);
      if ("error" in res) { setError(res.error); return; }
      onClose(); router.refresh();
    });
  }
  function remove() {
    if (!s) return;
    startDel(async () => { const res = await deleteSupplier(s.id); if ("error" in res) { setError(res.error); return; } onClose(); router.refresh(); });
  }

  return (
    <Modal open onClose={onClose} title={isNew ? (isShopee ? "Add Shopee Shop" : "Add Supplier") : `Edit ${s!.name}`} size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          {!isNew ? <button onClick={remove} disabled={delPending} className="rounded-lg border border-danger/40 px-3 py-2 text-sm font-medium text-danger hover:bg-red-50 disabled:opacity-60">{delPending ? "Deleting…" : "Delete"}</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Cancel</button>
            <button onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">{pending ? "Saving…" : isNew ? "Add Supplier" : "Save"}</button>
          </div>
        </div>
      }>
      <div className="grid grid-cols-2 gap-3">
        <F label={isShopee ? "Shop Name *" : "Name of Company *"}><input value={f.name} onChange={(e) => set("name", e.target.value)} className={inp} /></F>
        <F label="Status"><select value={f.status} onChange={(e) => set("status", e.target.value)} className={inp}><option value="active">Active</option><option value="inactive">Inactive</option></select></F>

        {isShopee ? (
          <>
            <F label="Shop Link" full><input value={f.link ?? ""} onChange={(e) => set("link", e.target.value)} placeholder="https://shopee.ph/shop…" className={inp} /></F>
            <F label="Shopee Supplies / Items" full><textarea value={f.materials ?? ""} onChange={(e) => set("materials", e.target.value)} rows={3} placeholder="e.g. Sunrise drawer guide (18&quot;), Blackscrew, Flap Disc…" className={cn(inp, "w-full resize-none")} /></F>
          </>
        ) : (
          <>
            <F label="Address" full><input value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder="e.g. San Pedro Laguna" className={inp} /></F>
            <F label="Contact Person"><input value={f.contact_person ?? ""} onChange={(e) => set("contact_person", e.target.value)} className={inp} /></F>
            <F label="Contact Number"><input value={f.contact_number ?? ""} onChange={(e) => set("contact_number", e.target.value)} placeholder="(+639…)" className={inp} /></F>
            <F label="List of Materials / Tools" full><textarea value={f.materials ?? ""} onChange={(e) => set("materials", e.target.value)} rows={3} placeholder="e.g. 2X2X12 and 1X2X12, finishing nails, etc." className={cn(inp, "w-full resize-none")} /></F>
          </>
        )}
        <F label="Notes" full><input value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} className={inp} /></F>
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
    </Modal>
  );
}

function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1", full && "col-span-2")}>
      <label className="text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", accent)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M3 7l2-3h14l2 3M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7M9 11h6" /></svg>
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value.toLocaleString("en-PH")}</p>
    </div>
  );
}
