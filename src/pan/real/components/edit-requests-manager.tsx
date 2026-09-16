"use client";

// REQUESTED EDIT ORDER (Operations) — mga edit request ng Sales & Service sa
// mga confirmed na order, sa KAPAREHONG table design ng Orders (madilim na
// kayumangging banda + gintong border). Pag-click ng row → modal na nagpapakita
// ng LAHAT ng field, BEFORE/AFTER magkatabi, naka-highlight lang ang mga
// binago; Approve (apply via updateOrder) / Reject sa footer habang pending.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "./ui";
import { Modal } from "./modal";
import { RushBadge } from "./rush-badge";
import { DEFAULT_RUSH_DAYS } from "@/lib/rush";
import {
  approveEditRequest,
  rejectEditRequest,
  type EditRequestRow,
} from "@/app/orders/edit-request-actions";

// ── Field labels (EditOrder-shaped snapshots) ──────────────────────────
const FIELD_LABEL: Record<string, string> = {
  order_number: "Order #",
  date_order: "Order Date",
  customer_name: "Customer",
  address: "Address",
  address_lat: "Latitude",
  address_lng: "Longitude",
  contact_number: "Cellphone",
  email: "Email",
  fb_name: "FB Name",
  fb_link: "FB Link",
  source: "Source",
  status: "Status",
  assigned: "Assigned",
  workshop_date: "Workshop Date",
  date_of_delivery: "Delivery Date",
  date_downpayment: "Downpayment Date",
  full_payment_date: "Full Payment Date",
  downpayment: "Downpayment",
  full_payment: "Full Payment",
  total: "Total",
  items: "Items",
  transaction_images: "Transaction Images",
  removed_images: "Removed Images",
  is_rush: "Rush",
  rush_days: "Rush Days",
};
const prettyField = (k: string) => FIELD_LABEL[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function isImgUrl(s: unknown): s is string {
  return typeof s === "string" && /^https?:\/\//.test(s) && (/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(s) || s.includes("/storage/"));
}

// Thumbnail na may fixed at naka-gitnang hover-preview (kapareho ng Audit Trail).
function Thumb({ url }: { url: string }) {
  return (
    <span className="group inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img loading="lazy" decoding="async" src={url} alt="" className="h-10 w-10 shrink-0 cursor-zoom-in rounded border border-stone-200 object-cover" />
      <span className="pointer-events-none fixed left-1/2 top-1/2 z-[100] hidden -translate-x-1/2 -translate-y-1/2 group-hover:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="max-h-[85vh] max-w-[85vw] rounded-2xl border border-stone-200 bg-white object-contain p-3 shadow-2xl" />
      </span>
    </span>
  );
}

type ItemLine = { image?: string; text: string; meta: string[] };
// Items array → linya + detalye (color/dimension/category) + thumbnail para
// buo ang kita ng diff, kapareho ng laman ng order form.
function itemLines(v: unknown): ItemLine[] | null {
  if (!Array.isArray(v) || v.some((x) => typeof x === "string")) return null;
  return v.map((raw) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    // Ang description mula sa form ay maaaring multi-line na ("Bed\n• Any
    // Color\n• 35x75x0 cm") — unang linya ang pangalan, ang iba detalye na.
    const descLines = String(it.description ?? it.name ?? "Item").split("\n").map((s) => s.trim()).filter(Boolean);
    const desc = descLines[0];
    const descMeta = descLines.slice(1).map((s) => s.replace(/^[•·-]\s*/, ""));
    const qty = typeof it.qty === "number" ? it.qty : Number(it.qty) || 1;
    const price = Number(it.unitPrice ?? it.price) || 0;
    const img = it.image ?? it.image_url;
    // Field-level na detalye + mga natirang linya ng description, walang ulit.
    const metaParts = [...new Set([
      ...[it.sku, it.category, it.color, it.dimension].filter(Boolean).map(String),
      ...descMeta,
    ])];
    return {
      image: isImgUrl(img) ? img : undefined,
      text: `${desc} ×${qty}${price ? ` — ₱${price.toLocaleString()}` : ""}`,
      meta: metaParts,
    };
  });
}

function ValueCell({ v }: { v: unknown }) {
  // Isang image URL, o array ng mga image URL — ipakita ang mga thumbnail
  // mismo (may hover zoom), hindi bilang lang.
  if (isImgUrl(v)) return <Thumb url={v} />;
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) {
    const imgs = v.filter(isImgUrl);
    if (imgs.length) {
      return <span className="flex flex-wrap justify-end gap-1">{imgs.map((u, i) => <Thumb key={i} url={u} />)}</span>;
    }
    return <>{`${v.length} file${v.length === 1 ? "" : "s"}`}</>;
  }
  const items = itemLines(v);
  if (items) {
    if (items.length === 0) return <>—</>;
    return (
      <span className="flex flex-col items-end gap-1.5">
        {items.map((it, i) => (
          <span key={i} className="flex items-start justify-end gap-2">
            {/* Kapareho ng format ng order form: pangalan sa taas, tapos
                bullet list ng detalye (• Any Color / • 35x75x0 cm / • Bed). */}
            <span className="min-w-0 text-left">
              <span className="block max-w-[240px]" title={it.text}>{it.text}</span>
              {it.meta.map((m, j) => (
                <span key={j} className="block max-w-[240px] truncate text-[10px] text-stone-500" title={m}>• {m}</span>
              ))}
            </span>
            {it.image && <Thumb url={it.image} />}
          </span>
        ))}
      </span>
    );
  }
  return <>{fmtVal(v)}</>;
}

// ── Diff ───────────────────────────────────────────────────────────────
// Ang before (raw receipt_items ng order) at proposed (LineItem mula sa form)
// ay magkaibang hugis kahit WALANG binago (null vs undefined, price vs
// unitPrice, nilinis na description) — kaya sa paghahambing, ipinapareho muna
// ang mga item sa iisang canonical na anyo para hindi maling ma-tag na CHANGED.
function canonItems(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  return v.map((raw) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    return {
      qty: Number(it.qty) || 1,
      description: String(it.description ?? it.name ?? "").trim(),
      unitPrice: Number(it.unitPrice ?? it.price) || 0,
      sku: it.sku ?? null,
      category: it.category ?? null,
      color: it.color ?? null,
      dimension: it.dimension ?? null,
      image: it.image ?? it.image_url ?? null,
    };
  });
}
function canon(key: string, v: unknown): unknown {
  if (v === undefined || v === "") return null;
  // Walang laman na array = walang value — huwag i-flag ang [] vs null.
  if (Array.isArray(v) && v.length === 0) return null;
  if (key === "items") return canonItems(v);
  if (typeof v === "number") return Number(v.toFixed(2));
  return v;
}

type DiffRow = { key: string; before: unknown; after: unknown; changed: boolean };
function diff(prev: Record<string, unknown> | null, next: Record<string, unknown> | null): DiffRow[] {
  // Sundin ang ayos ng FIELD_LABEL para pare-pareho ang hanay bawat request.
  const known = Object.keys(FIELD_LABEL);
  const extra = [...new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})])].filter((k) => !known.includes(k)).sort();
  return [...known, ...extra]
    .filter((k) => (prev && k in prev) || (next && k in next))
    .map((key) => ({
      key,
      before: prev?.[key],
      after: next?.[key],
      // Kapag WALA ang key sa isang panig ng snapshot (mga lumang record na
      // kulang ang before), hindi natin alam ang baseline — huwag i-flag na
      // CHANGED; ang tunay na paghahambing ay kapag parehong panig may key.
      changed: !!prev && key in prev && !!next && key in next
        && JSON.stringify(canon(key, prev[key]) ?? null) !== JSON.stringify(canon(key, next[key]) ?? null),
    }));
}

function Panel({ title, tone, rows, side }: { title: string; tone: "red" | "green"; rows: DiffRow[]; side: "before" | "after" }) {
  const head = tone === "red" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700";
  const hl = tone === "red" ? "bg-red-50" : "bg-emerald-50";
  const tag = tone === "red" ? "text-red-600" : "text-emerald-600";
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className={cn("border-b border-stone-200 px-3 py-2 text-xs font-bold tracking-wide", head)}>{title}</div>
      <div>
        {rows.map((d) => (
          <div key={d.key} className={cn("flex items-start justify-between gap-2 border-b border-stone-100 px-3 py-1.5 last:border-0", d.changed && hl)}>
            <span className="shrink-0 text-xs text-stone-500">{prettyField(d.key)}</span>
            <span className="flex items-center gap-1 text-right text-xs text-stone-800">
              <ValueCell v={side === "before" ? d.before : d.after} />
              {d.changed && <span className={cn("rounded bg-white/70 px-1 text-[9px] font-bold uppercase", tag)}>changed</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Status pill ────────────────────────────────────────────────────────
const STATUS_PILL: Record<EditRequestRow["status"], string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-600/20",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  rejected: "bg-red-50 text-red-700 ring-red-600/20",
};
const STATUS_TEXT: Record<EditRequestRow["status"], string> = {
  pending: "Pending",
  approved: "✓ Approved",
  rejected: "✕ Rejected",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return iso; }
}

// ── Detail modal — LAHAT ng field, BEFORE/AFTER, highlight lang ang binago ──
function DetailModal({ r, canDecide, onClose }: { r: EditRequestRow; canDecide: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => diff(r.before, r.proposed), [r]);
  const changed = rows.filter((d) => d.changed);

  const decide = (fn: typeof approveEditRequest) => {
    setError(null);
    start(async () => {
      const res = await fn(r.id);
      if ("error" in res) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal open onClose={onClose} title={`Edit Request — ${r.order_number ?? `#${r.order_id}`}`} description={`Requested by ${r.requested_by ?? "Sales"} · ${fmtTime(r.created_at)}`} size="2xl"
      footer={
        <div className="flex w-full flex-col gap-2">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
          <div className="flex w-full items-center gap-2">
            <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset", STATUS_PILL[r.status])}>{STATUS_TEXT[r.status]}</span>
            {r.status !== "pending" && r.decided_by && (
              <span className="text-xs text-muted">by {r.decided_by} · {fmtTime(r.decided_at)}</span>
            )}
            <div className="ml-auto flex gap-2">
              <button onClick={onClose} disabled={pending} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-60">Close</button>
              {r.status === "pending" && canDecide && (
                <>
                  <button
                    type="button"
                    onClick={() => decide(rejectEditRequest)}
                    disabled={pending}
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    ✕ Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(approveEditRequest)}
                    disabled={pending}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {pending ? "Applying…" : "✓ Approve & Apply"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      }>
      <div className="space-y-4">
        {r.reason && (
          <p className="rounded-lg border border-[#caa45a] bg-[#faf6ec] px-3 py-2 text-xs text-[#4a3b1a]">
            <span className="font-semibold">Reason:</span> {r.reason}
          </p>
        )}
        <p className="text-xs text-muted">
          {changed.length === 0
            ? "No field changes detected in this request."
            : <>Showing all fields — <span className="font-semibold text-foreground">{changed.length} field{changed.length === 1 ? "" : "s"} changed</span> (highlighted).</>}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Panel title="BEFORE" tone="red" rows={rows} side="before" />
          <Panel title="AFTER (REQUESTED)" tone="green" rows={rows} side="after" />
        </div>
      </div>
    </Modal>
  );
}

// ── Main table — kapareho ng Orders table design ───────────────────────
const TD = "px-3 py-2.5 border-b border-r border-border !text-center";

export function EditRequestsManager({ rows, canDecide }: { rows: EditRequestRow[]; canDecide: boolean }) {
  // Default ALL — mananatili dito ang buong kasaysayan ng mga request.
  const [flt, setFlt] = useState<"pending" | "all" | "approved" | "rejected">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<EditRequestRow | null>(null);

  const filtered = rows.filter((r) => {
    if (flt !== "all" && r.status !== flt) return false;
    if (q.trim()) {
      const b = r.before ?? {};
      const hay = `${r.order_number ?? ""} ${r.requested_by ?? ""} ${r.reason ?? ""} ${String(b.customer_name ?? "")}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  // Bilang ng nabagong field bawat request — ipinapakita sa listahan.
  const changedById = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) m.set(r.id, diff(r.before, r.proposed).filter((d) => d.changed).length);
    return m;
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search order #, customer, requester, or reason…"
          className="max-w-xs rounded border border-black/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black/20"
        />
        <div className="flex flex-wrap gap-2">
          {([["all", "All"], ["pending", `Pending${pendingCount ? ` (${pendingCount})` : ""}`], ["approved", "Approved"], ["rejected", "Rejected"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFlt(key)}
              className={
                flt === key
                  ? "rounded-full bg-[#4a3b1a] px-3.5 py-1.5 text-xs font-semibold text-[#f4ead8]"
                  : "rounded-full border border-black/15 bg-white px-3.5 py-1.5 text-xs font-semibold text-black/60 hover:border-[#caa45a]"
              }
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-black/50">{filtered.length} request{filtered.length === 1 ? "" : "s"}</span>
      </div>

      {/* Kapareho ng Orders table: madilim na kayumangging banda + sub-header,
          gintong border, puting rows na naka-hover highlight. */}
      <div className="overflow-auto rounded-xl border border-[#e6dcc4] shadow-sm">
        <table className="w-full border-collapse text-[11px] xl:text-sm [&_th]:!text-center [&_th]:font-bold [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b [&_th]:border-r [&_th]:border-border">
          <thead>
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={8} className="border-b border-[#caa45a] bg-[#4a3b1a]">Requested Edit Order</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&>th]:bg-[#5a4a26]">
              <th className="whitespace-nowrap">Order #</th>
              <th className="whitespace-nowrap">Date Requested</th>
              <th className="whitespace-nowrap">Customer</th>
              <th className="whitespace-nowrap">Requested By</th>
              <th className="whitespace-nowrap">Reason</th>
              <th className="whitespace-nowrap">Fields Changed</th>
              <th className="whitespace-nowrap">Status</th>
              <th className="whitespace-nowrap">Decided By</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {filtered.map((r) => {
              const b = (r.before ?? {}) as Record<string, unknown>;
              const nChanged = changedById.get(r.id) ?? 0;
              return (
                <tr
                  key={r.id}
                  onClick={() => setOpen(r)}
                  className="cursor-pointer hover:bg-[#faf6ec]"
                  title="Click to review this edit request"
                >
                  <td className={cn(TD, "font-mono whitespace-nowrap")}>
                    <div className="flex flex-col items-start gap-0.5">
                      {!!b.is_rush && <RushBadge isRush dateOrder={String(b.date_order ?? "") || null} threshold={Number(b.rush_days) || DEFAULT_RUSH_DAYS} />}
                      <span>{r.order_number ?? `#${r.order_id}`}</span>
                    </div>
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>{fmtTime(r.created_at)}</td>
                  <td className={cn(TD, "whitespace-nowrap font-medium text-[#5a4a26]")}>{String(b.customer_name ?? "") || "—"}</td>
                  <td className={cn(TD, "whitespace-nowrap")}>{r.requested_by ?? "—"}</td>
                  <td className={cn(TD, "max-w-[260px]")}>
                    <span className="block truncate" title={r.reason ?? undefined}>{r.reason ?? "—"}</span>
                  </td>
                  <td className={TD}>
                    <span className="rounded bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">{nChanged} field{nChanged === 1 ? "" : "s"}</span>
                  </td>
                  <td className={TD}>
                    <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset", STATUS_PILL[r.status])}>{STATUS_TEXT[r.status]}</span>
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>{r.decided_by ?? "—"}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted">
                  {flt === "pending" ? "No pending edit requests." : "No edit requests."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && <DetailModal r={open} canDecide={canDecide} onClose={() => setOpen(null)} />}
    </div>
  );
}
