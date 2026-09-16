"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, Card, StatCard, Badge } from "./ui";
import { Modal } from "./modal";
import { peso, shortDate } from "@/lib/format";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { createCustomer, updateCustomer, deleteCustomer } from "@/app/customers/actions";
import { ExportButton } from "./export-button";
import type { CustomerData, Customer } from "@/app/customers/data";

const EXPORT_COLUMNS = [
  { key: "name", label: "Customer" },
  { key: "contact", label: "Contact" },
  { key: "email", label: "Email" },
  { key: "address", label: "Address" },
  { key: "orderCount", label: "Orders" },
  { key: "totalSpent", label: "Total" },
  { key: "balance", label: "Balance" },
  { key: "lastOrder", label: "Last Order" },
];

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

export function CustomersManager({ data }: { data: CustomerData }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Customer | null>(null);
  const [form, setForm] = useState<Customer | "new" | null>(null);

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return data.rows;
    return data.rows.filter((c) => `${c.name} ${c.contact ?? ""} ${c.email ?? ""} ${c.address ?? ""}`.toLowerCase().includes(query));
  }, [data.rows, q]);
  const pg = usePagination(rows);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton filename="customers" columns={EXPORT_COLUMNS} rows={rows} />
          <button onClick={() => setForm("new")} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90">+ Add customer</button>
        </div>
      </div>

      <div className="apk-hide grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Customers" value={String(data.kpi.customers)} />
        <StatCard label="Total Orders" value={String(data.kpi.orders)} />
        <StatCard label="Revenue" value={peso(data.kpi.revenue)} tone="success" />
      </div>

      <Card className="p-5">
        <div className="relative mb-4 max-w-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, contact, address…" className="w-full rounded-lg border border-border bg-stone-50 py-2 pl-8 pr-3 text-sm outline-none focus:border-primary focus:bg-surface" />
        </div>

        <div className="max-h-[70vh] overflow-auto pf-scroll">
          <table className="w-full min-w-[820px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
            <colgroup>
              <col span={4} />
              <col span={4} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&_th]:bg-[#4a3b1a]">
                <th colSpan={4} className="border-b border-[#caa45a] px-5 py-2">Customer</th>
                <th colSpan={4} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Orders</th>
              </tr>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&_th]:bg-[#5a4a26]">
                <th className="px-3 py-2.5">Customer</th>
                <th className="px-3 py-2.5">Contact</th>
                <th className="px-3 py-2.5">Email</th>
                <th className="px-3 py-2.5">Address</th>
                <th className="!border-l-4 !border-l-[#caa45a] px-3 py-2.5">Orders</th>
                <th className="px-3 py-2.5">Total</th>
                <th className="px-3 py-2.5">Balance</th>
                <th className="px-3 py-2.5">Last Order</th>
              </tr>
            </thead>
            <tbody>
              {pg.slice.map((c) => (
                <tr key={c.name} onClick={() => setOpen(c)} className="cursor-pointer border-b border-border last:border-0 hover:bg-stone-50">
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{initials(c.name)}</span>
                      <span className="font-medium">{c.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-muted">{c.contact ?? "—"}</td>
                  <td className="px-3 py-3 text-muted"><span className="line-clamp-1 max-w-[200px]">{c.email ?? "—"}</span></td>
                  <td className="px-3 py-3 text-muted"><span className="line-clamp-1 max-w-[220px]">{c.address ?? "—"}</span></td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-3 py-3 text-right">{c.orderCount}</td>
                  <td className="px-3 py-3 text-right">{peso(c.totalSpent)}</td>
                  <td className={cn("px-3 py-3 text-right", c.balance > 0 ? "text-danger" : "text-muted")}>{peso(c.balance)}</td>
                  <td className="px-3 py-3 text-muted">{c.lastOrder ? shortDate(c.lastOrder) : "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted">No customers found.</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && <PaginationFooter {...pg} />}
      </Card>

      {open && (
        <CustomerModal
          c={open}
          onClose={() => setOpen(null)}
          onEdit={() => { setForm(open); setOpen(null); }}
        />
      )}
      {form && <CustomerForm c={form === "new" ? null : form} onClose={() => setForm(null)} />}
    </div>
  );
}

function CustomerForm({ c, onClose }: { c: Customer | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(c?.name ?? "");
  const [contact, setContact] = useState(c?.contact ?? "");
  const [email, setEmail] = useState(c?.email ?? "");
  const [address, setAddress] = useState(c?.address ?? "");
  const [notes, setNotes] = useState(c?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editing = !!c?.id;
  const inp = "w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface";

  function save() {
    setError(null);
    const input = { name, contact, email, address, notes };
    start(async () => {
      const res = editing ? await updateCustomer(c!.id!, input) : await createCustomer(input);
      if ("error" in res) setError(res.error);
      else { onClose(); router.refresh(); }
    });
  }

  function del() {
    if (!c?.id || !confirm(`Delete ${c.name}?`)) return;
    start(async () => {
      const res = await deleteCustomer(c.id!);
      if ("error" in res) setError(res.error);
      else { onClose(); router.refresh(); }
    });
  }

  return (
    <Modal open onClose={onClose} title={editing ? "Edit customer" : "Add customer"} size="sm"
      footer={
        <div className="flex items-center justify-between gap-2">
          {editing ? <button onClick={del} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-danger ring-1 ring-inset ring-red-600/20 hover:bg-red-50">Delete</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
            <button onClick={save} disabled={pending || !name.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div><label className="mb-1 block text-sm font-medium">Name</label><input value={name} onChange={(e) => setName(e.target.value)} className={inp} /></div>
        <div><label className="mb-1 block text-sm font-medium">Contact</label><input value={contact} onChange={(e) => setContact(e.target.value)} className={inp} placeholder="+63 9xx xxx xxxx" /></div>
        <div><label className="mb-1 block text-sm font-medium">Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inp} /></div>
        <div><label className="mb-1 block text-sm font-medium">Address</label><input value={address} onChange={(e) => setAddress(e.target.value)} className={inp} /></div>
        <div><label className="mb-1 block text-sm font-medium">Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inp} /></div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
      </div>
    </Modal>
  );
}

function CustomerModal({ c, onClose, onEdit }: { c: Customer; onClose: () => void; onEdit: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-3xl rounded-2xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{initials(c.name)}</span>
            <div>
              <h2 className="text-base font-semibold">{c.name}</h2>
              <p className="text-xs text-muted">{c.contact ?? "No contact"}{c.email ? ` · ${c.email}` : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">{c.id ? "Edit" : "Add to customers"}</button>
            <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Info label="Orders" v={String(c.orderCount)} />
            <Info label="Total" v={peso(c.totalSpent)} />
            <Info label="Paid" v={peso(c.totalPaid)} />
            <Info label="Balance" v={peso(c.balance)} tone={c.balance > 0 ? "danger" : undefined} />
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">Address</p>
            <p className="text-sm text-muted">{c.address ?? "—"}</p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Orders ({c.orders.length})</p>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-stone-50 text-xs uppercase text-muted">
                    <th className="px-3 py-2 text-left font-medium">Order #</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Product</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {c.orders.map((o, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium">{o.order_number ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{o.date_order ? shortDate(o.date_order) : "—"}</td>
                      <td className="px-3 py-2 text-muted"><span className="line-clamp-1 max-w-[220px]">{o.product_name ?? "—"}</span></td>
                      <td className="px-3 py-2">{o.status ? <Badge value={o.status} /> : "—"}</td>
                      <td className="px-3 py-2 text-right">{peso(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, v, tone }: { label: string; v: string; tone?: "danger" }) {
  return (
    <div className="rounded-lg border border-border bg-stone-50/50 px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("text-base font-semibold", tone === "danger" && "text-danger")}>{v}</p>
    </div>
  );
}
