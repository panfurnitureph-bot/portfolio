"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "./ui";
import { PaginationFooter, usePagination } from "@/components/pagination-footer";
import type { AuditRow } from "@/app/audit-trail/data";

const ACTION: Record<string, { label: string; cls: string }> = {
  insert: { label: "Created", cls: "bg-emerald-100 text-emerald-700" },
  update: { label: "Updated", cls: "bg-blue-100 text-blue-700" },
  delete: { label: "Deleted", cls: "bg-red-100 text-red-700" },
  status_change: { label: "Status", cls: "bg-indigo-100 text-indigo-700" },
  post_movement: { label: "Movement", cls: "bg-violet-100 text-violet-700" },
  login: { label: "Login", cls: "bg-stone-100 text-stone-600" },
  logout: { label: "Logout", cls: "bg-stone-100 text-stone-600" },
};

const actionInfo = (a: string) => ACTION[a] ?? { label: a, cls: "bg-stone-100 text-stone-600" };
const prettyPage = (m: string) => m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const sourceOf = (r: AuditRow) => (r.user_id ? "PAN Furnitures" : "System");

// Human-friendly field labels (UI names) instead of raw DB column names.
const FIELD_LABELS: Record<string, string> = {
  id: "ID", sku: "SKU", mop: "Mode of Payment", upc: "UPC", po_number: "PO Number",
  gw: "G.W.", cbm: "CBM", source: "Source",
  receipt_items: "Product Name", // the item breakdown is the product list
  product_name: "Product",
};
const SMALL_WORDS = new Set(["of", "to", "by", "per", "and", "or", "the", "in", "on"]);
function prettyField(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .split("_")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  // Pretty-print ISO date / datetime values: 2026-06-19T00:00:00 -> Jun 19, 2026
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (m) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) {
        const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        const hasTime = m[4] && !(m[4] === "00" && m[5] === "00");
        return hasTime ? `${date} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : date;
      }
    }
  }
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (s.length > 80) s = s.slice(0, 80) + "…"; // keep big JSON/config from flooding the panel
  return s;
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function initials(name: string | null): string {
  if (!name) return "S";
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

function isImgUrl(s: unknown): s is string {
  return typeof s === "string" && /^https?:\/\//.test(s) && (/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(s) || s.includes("/storage/"));
}
// Pull image URLs from a value: a URL string, an array of URLs, or an array of
// receipt-item objects ({ image / image_url }).
function imgUrls(v: unknown): string[] {
  if (isImgUrl(v)) return [v];
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const it of v) {
      if (isImgUrl(it)) out.push(it);
      else if (it && typeof it === "object") {
        const im = (it as Record<string, unknown>).image ?? (it as Record<string, unknown>).image_url;
        if (isImgUrl(im)) out.push(im);
      }
    }
    return out;
  }
  return [];
}
// Thumbnail with a fixed, centered hover-preview (escapes modal overflow).
function Thumb({ url }: { url: string }) {
  return (
    <span className="group inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img loading="lazy" decoding="async" src={url} alt="" className="h-10 w-10 shrink-0 cursor-zoom-in rounded border border-stone-200 object-cover" />
      <span className="pointer-events-none fixed left-1/2 top-1/2 z-[100] hidden -translate-x-1/2 -translate-y-1/2 group-hover:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="h-72 w-72 rounded-2xl border border-stone-200 bg-white object-contain p-3 shadow-2xl" />
      </span>
    </span>
  );
}

type LineItem = { image?: string; title: string; meta: string; qty?: number };

// Detect an array of receipt/product item objects and normalise to line items.
function asItems(v: unknown): LineItem[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const first = v[0] as Record<string, unknown> | null;
  if (!first || typeof first !== "object") return null;
  if (!["description", "sku", "image", "image_url", "category"].some((k) => k in first)) return null;
  return v.map((raw) => {
    const it = raw as Record<string, unknown>;
    const img = it.image ?? it.image_url;
    return {
      image: isImgUrl(img) ? img : undefined,
      title: String(it.description ?? it.name ?? "Item").split("\n")[0],
      meta: [it.sku, it.category, it.color, it.dimension].filter(Boolean).map(String).join(" · "),
      qty: typeof it.qty === "number" ? it.qty : undefined,
    };
  });
}

function ValueCell({ v }: { v: unknown }) {
  const items = asItems(v);
  if (items) {
    return (
      <span className="flex flex-col gap-2">
        {items.map((it, i) => (
          <span key={i} className="flex items-center gap-2 text-left">
            {it.image ? <Thumb url={it.image} /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-stone-200 text-stone-300">—</span>}
            <span className="min-w-0">
              <span className="block truncate text-xs text-stone-800" title={it.title}>{it.title}{it.qty ? ` ×${it.qty}` : ""}</span>
              {it.meta && <span className="block truncate text-[10px] text-stone-400">{it.meta}</span>}
            </span>
          </span>
        ))}
      </span>
    );
  }

  const imgs = imgUrls(v);
  if (imgs.length) {
    return <span className="flex flex-wrap justify-end gap-1">{imgs.map((u, i) => <Thumb key={i} url={u} />)}</span>;
  }
  return <>{fmtVal(v)}</>;
}

type DiffRow = { key: string; before: unknown; after: unknown; changed: boolean };
function diff(prev: Record<string, unknown> | null, next: Record<string, unknown> | null): DiffRow[] {
  const keys = [...new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})])].sort();
  return keys.map((key) => ({ key, before: prev?.[key], after: next?.[key], changed: JSON.stringify(prev?.[key]) !== JSON.stringify(next?.[key]) }));
}
const changedCount = (r: AuditRow) => (r.action_type === "update" ? diff(r.previous_value, r.new_value).filter((d) => d.changed).length : 0);

// ── Detail modal (BEFORE / AFTER) ──────────────────────────────────────
function DetailModal({ r, onClose }: { r: AuditRow; onClose: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => diff(r.previous_value, r.new_value), [r]);
  const changed = rows.filter((d) => d.changed);
  const info = actionInfo(r.action_type);
  // Show the full record, but hide raw JSON/config blobs (object/array values)
  // so only the table's real data columns are displayed. Toggle reveals them.
  const isComplex = (v: unknown) => v !== null && typeof v === "object";
  const clean = rows.filter((d) => !isComplex(d.before) && !isComplex(d.after));
  const shown = showAll ? rows : clean;
  const hiddenCount = rows.length - clean.length;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-3xl rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", info.cls)}>{info.label}</span>
              <h2 className="text-base font-semibold text-stone-800">{prettyPage(r.module)}</h2>
              {r.record_id && <span className="text-sm text-stone-400">#{r.record_id}</span>}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-500">
              Edited by:
              {r.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img loading="lazy" decoding="async" src={r.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" />
              ) : null}
              <span className="font-medium text-stone-700">{r.user_name ?? "System"}</span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">{sourceOf(r)}</span>
              <span className="text-xs text-stone-400">{fmtTime(r.created_at)}</span>
            </div>
            {changed.length > 0 && (
              <p className="mt-2 text-xs text-stone-500">
                Changed:{" "}
                {changed.map((d) => (
                  <span key={d.key} className="mr-1 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">{prettyField(d.key)}</span>
                ))}
              </p>
            )}
          </div>
          <button onClick={onClose} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-stone-200 text-stone-500 hover:bg-stone-100">✕</button>
        </div>

        {hiddenCount > 0 && (
          <div className="flex justify-end px-6 pt-3">
            <button onClick={() => setShowAll((s) => !s)} className="text-xs font-medium text-primary hover:underline">
              {showAll ? "Hide raw fields" : `Show raw fields (${hiddenCount})`}
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 p-6 pt-3">
          <Panel title="BEFORE" tone="red" rows={shown} side="before" hideAll={r.action_type === "insert"} />
          <Panel title="AFTER" tone="green" rows={shown} side="after" hideAll={r.action_type === "delete"} />
        </div>
      </div>
    </div>
  );
}

function Panel({ title, tone, rows, side, hideAll }: { title: string; tone: "red" | "green"; rows: DiffRow[]; side: "before" | "after"; hideAll: boolean }) {
  const head = tone === "red" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700";
  const hl = tone === "red" ? "bg-red-50" : "bg-emerald-50";
  const tag = tone === "red" ? "text-red-600" : "text-emerald-600";
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200">
      <div className={cn("border-b border-stone-200 px-3 py-2 text-xs font-bold tracking-wide", head)}>{title}</div>
      <div>
        {hideAll ? (
          <p className="px-3 py-6 text-center text-xs text-stone-400">—</p>
        ) : rows.map((d) => {
          const v = side === "before" ? d.before : d.after;
          return (
            <div key={d.key} className={cn("flex items-start justify-between gap-2 border-b border-stone-100 px-3 py-1.5 last:border-0", d.changed && hl)}>
              <span className="text-xs text-stone-500">{prettyField(d.key)}</span>
              <span className="flex items-center gap-1 text-right text-xs text-stone-800">
                <ValueCell v={v} />
                {d.changed && <span className={cn("rounded bg-white/70 px-1 text-[9px] font-bold uppercase", tag)}>changed</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main list ──────────────────────────────────────────────────────────
export function AuditTrailManager({ rows }: { rows: AuditRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [user, setUser] = useState("all");
  const [page, setPage] = useState("all");
  const [action, setAction] = useState("all");
  const [source, setSource] = useState("all");
  const [time, setTime] = useState("all");
  const [open, setOpen] = useState<AuditRow | null>(null);

  const users = useMemo(() => [...new Set(rows.map((r) => r.user_name ?? "System"))], [rows]);
  const pages = useMemo(() => [...new Set(rows.map((r) => r.module))], [rows]);
  const actions = useMemo(() => [...new Set(rows.map((r) => r.action_type))], [rows]);
  // Diff is O(keys) with JSON.stringify per key — compute the changed-field count
  // once per row instead of on every render (was recomputed for all rows on each
  // keystroke/filter change).
  const ccById = useMemo(() => {
    const m = new Map<AuditRow["id"], number>();
    for (const r of rows) m.set(r.id, changedCount(r));
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const now = Date.now();
    const cutoff = time === "today" ? now - 864e5 : time === "7d" ? now - 7 * 864e5 : time === "30d" ? now - 30 * 864e5 : 0;
    return rows.filter((r) => {
      if (user !== "all" && (r.user_name ?? "System") !== user) return false;
      if (page !== "all" && r.module !== page) return false;
      if (action !== "all" && r.action_type !== action) return false;
      if (source !== "all" && sourceOf(r) !== source) return false;
      if (cutoff && new Date(r.created_at).getTime() < cutoff) return false;
      if (query && !`${r.user_name ?? "system"} ${r.module} ${r.table_name ?? ""} ${r.record_id ?? ""}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [rows, q, user, page, action, source, time]);

  const pg = usePagination(filtered, 25);

  function exportCsv() {
    const head = ["Timestamp", "User", "Action", "Page", "Record ID", "Fields Changed", "Source"];
    const lines = filtered.map((r) => [
      fmtTime(r.created_at), r.user_name ?? "System", actionInfo(r.action_type).label,
      prettyPage(r.module), r.record_id ?? "", String((ccById.get(r.id) ?? 0) || ""), sourceOf(r),
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "activity-log.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const selCls = "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 outline-none focus:border-primary";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Activity Log</h1>
            <p className="text-xs text-muted">Immutable audit trail · Database triggers · Every change tracked</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-600">{rows.length} records</span>
          <button onClick={() => router.refresh()} className="flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" /></svg>
            Refresh
          </button>
          <button onClick={exportCsv} className="flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
            Export
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search page, user, record ID…" className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-primary" />
        </div>
        <select value={user} onChange={(e) => setUser(e.target.value)} className={selCls}><option value="all">All Users</option>{users.map((u) => <option key={u} value={u}>{u}</option>)}</select>
        <select value={page} onChange={(e) => setPage(e.target.value)} className={selCls}><option value="all">All Pages</option>{pages.map((p) => <option key={p} value={p}>{prettyPage(p)}</option>)}</select>
        <select value={action} onChange={(e) => setAction(e.target.value)} className={selCls}><option value="all">All Actions</option>{actions.map((a) => <option key={a} value={a}>{actionInfo(a).label}</option>)}</select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className={selCls}><option value="all">All Sources</option><option value="System">System</option><option value="PAN Furnitures">PAN Furnitures</option></select>
        <select value={time} onChange={(e) => setTime(e.target.value)} className={selCls}><option value="all">All Time</option><option value="today">Last 24h</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select>
      </div>

      {/* Table */}
      <div className="overflow-auto max-h-[70vh] rounded-xl border border-stone-200 bg-white pf-scroll">
        <table className="w-full min-w-[920px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <colgroup>
            <col span={2} />
            <col span={5} />
            <col span={1} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={2} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] px-5 py-2">When / Who</th>
              <th colSpan={5} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Change</th>
              <th colSpan={1} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2"></th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="bg-[#5a4a26] px-4 py-3">Timestamp</th>
              <th className="bg-[#5a4a26] px-4 py-3">User</th>
              <th className="bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3">Action</th>
              <th className="bg-[#5a4a26] px-4 py-3">Page</th>
              <th className="bg-[#5a4a26] px-4 py-3">Record ID</th>
              <th className="bg-[#5a4a26] px-4 py-3">Fields Changed</th>
              <th className="bg-[#5a4a26] px-4 py-3">Source</th>
              <th className="bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3">Diff</th>
            </tr>
          </thead>
          <tbody>
            {pg.slice.map((r) => {
              const info = actionInfo(r.action_type);
              const cc = ccById.get(r.id) ?? 0;
              return (
                <tr key={r.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-3 text-muted">{fmtTime(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      {r.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img loading="lazy" decoding="async" src={r.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-200 text-[9px] font-semibold text-stone-600">{initials(r.user_name)}</span>
                      )}
                      {r.user_name ?? "System"}
                    </span>
                  </td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", info.cls)}>{info.label}</span></td>
                  <td className="px-4 py-3">{prettyPage(r.module)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{r.record_id ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{cc ? cc : "—"}</td>
                  <td className="px-4 py-3"><span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">{sourceOf(r)}</span></td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-right">
                    <button onClick={() => setOpen(r)} className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium hover:bg-stone-100">View</button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={8} className="px-4 py-16 text-center text-muted">No activity matches.</td></tr>}
          </tbody>
        </table>
      </div>
      <PaginationFooter page={pg.page} setPage={pg.setPage} pageSize={pg.pageSize} setPageSize={pg.setPageSize} total={pg.total} pages={pg.pages} />

      {open && <DetailModal r={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
