"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, cn } from "@/components/ui";
import { number } from "@/lib/format";
import { Thumbnail } from "@/components/thumbnail";
import { InventoryRowActions } from "@/components/inventory-actions";
import { ExportButton } from "@/components/export-button";
import { resyncReservedNow } from "@/app/inventory/actions";
import type { InventoryRow } from "@/lib/supabase/server";

type Row = InventoryRow & {
  imageUrl?: string | null;
  // Product details na inilalakip ng inventory page — ipinapasa sa Edit dialog.
  productSpecs?: string | null;
  productPrice?: number | null;
  productType?: string | null;
};

// COLUMNS (2026-08-18) — tugma sa bagong product forms: tanggal ang
// Dimension/Location/Supplier (nasa specs ang sukat, sa QC ang storage).
const EXPORT_COLUMNS = [
  { key: "product_name", label: "Product" },
  { key: "sku", label: "SKU" },
  { key: "category", label: "Category" },
  { key: "color", label: "Color" },
  { key: "productSpecs", label: "Detail" },
  { key: "oh_inv", label: "On Hand" },
  { key: "reserved", label: "Reserved" },
  { key: "available", label: "Available" },
  { key: "status", label: "Status" },
];

function statusClass(value: string): string {
  const v = value.toLowerCase();
  if (/out of stock/.test(v)) return "text-danger";
  if (/low/.test(v)) return "text-warning";
  return "text-success";
}

const PAGE_SIZES = [10, 25, 50, 100];

type StatusFilter = "all" | "low" | "out";

export function InventoryTable({ rows }: { rows: Row[] }) {
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  // Recount reserved — tingnan ang pindutan sa toolbar.
  const router = useRouter();
  const [busy, startRecount] = useTransition();
  const reservedTotal = useMemo(() => rows.reduce((n, r) => n + (Number(r.reserved) || 0), 0), [rows]);
  function recount() {
    startRecount(async () => {
      const res = await resyncReservedNow();
      if ("error" in res) { alert(res.error); return; }
      router.refresh();
    });
  }
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  // Apply status + text filters before paginating.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const status = (r.status ?? "").toLowerCase();
      if (statusFilter === "low" && !/low/.test(status)) return false;
      if (statusFilter === "out" && !/out/.test(status)) return false;
      if (q) {
        const hay = `${r.product_name ?? ""} ${r.sku ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, query]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount - 1);
  const start = current * pageSize;
  const slice = useMemo(
    () => filtered.slice(start, start + pageSize),
    [filtered, start, pageSize],
  );
  const from = total === 0 ? 0 : start + 1;
  const to = Math.min(start + pageSize, total);

  return (
    <Card className="overflow-visible">
      {/* Filters — search + status chips */}
      <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center">
        <input
          type="search"
          placeholder="Search product or SKU…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-2">
          <Chip active={statusFilter === "all"} onClick={() => { setStatusFilter("all"); setPage(0); }}>All</Chip>
          <Chip active={statusFilter === "low"} onClick={() => { setStatusFilter("low"); setPage(0); }}>Low stock</Chip>
          <Chip active={statusFilter === "out"} onClick={() => { setStatusFilter("out"); setPage(0); }}>Out of stock</Chip>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          {/* LINISIN ANG RESERVED (2026-08-26). Ang Reserved ay kinukuwenta
              mula sa mga umiiral na order, at tumatakbo sa bawat pagbabago ng
              order o ng inventory. Pero kapag nabura ang order sa LABAS ng app
              (diretso sa database), walang nagta-trigger — at nananatili ang
              reserved sa produktong wala nang nag-aangkin. Lumalabas lang ito
              kapag may reserved na dapat suriin. */}
          {reservedTotal > 0 && (
            <button
              type="button"
              onClick={recount}
              disabled={busy}
              title="Recalculate Reserved from the orders that actually exist"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-muted hover:bg-stone-100 disabled:opacity-60"
            >
              {busy ? "Recounting…" : "Recount reserved"}
            </button>
          )}
          <ExportButton filename="inventory" columns={EXPORT_COLUMNS} rows={filtered} />
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto pf-scroll">
        <table className="w-full border-collapse text-[11px] xl:min-w-[1000px] xl:text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
          <colgroup>
            <col span={4} />
            <col span={3} />
            <col span={1} />
            <col span={1} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8] [&_th]:sticky [&_th]:top-0 [&_th]:bg-[#4a3b1a]">
              <th colSpan={6} className="border-b border-[#caa45a] px-5 py-2">
                Product Information
              </th>
              <th colSpan={3} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">
                Inventory Bucket
              </th>
              <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">
                Status
              </th>
              <th colSpan={1} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2"></th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4] [&_th]:sticky [&_th]:top-[33px] [&_th]:bg-[#5a4a26]">
              {/* Photo | Product | SKU | Category | Color | Detail (hiling
                  2026-08-23) — kapareho ng Product Management: hiwalay ang
                  larawan, at ang Detail ay ang specs ng produkto. */}
              <th className="px-3 py-3">Photo</th>
              <th className="px-5 py-3">Product</th>
              <th className="px-5 py-3">SKU</th>
              <th className="px-5 py-3">Category</th>
              <th className="px-5 py-3">Color</th>
              <th className="px-5 py-3">Detail</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-5 py-3">On Hand</th>
              <th className="px-5 py-3">Reserved</th>
              <th className="px-5 py-3">Available</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-5 py-3">Status</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-5 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr
                key={r.id}
                className={cn(
                  "border-b border-border last:border-0",
                  /out/i.test(r.status ?? "") ? "bg-red-50/60 hover:bg-red-50" : "hover:bg-stone-50",
                )}
              >
                <td className="px-3 py-3">
                  <div className="flex justify-center">
                    <Thumbnail name={r.product_name} url={r.imageUrl} />
                  </div>
                </td>
                <td className="px-5 py-3">
                  {/* Centered gaya ng ibang columns (hiling 2026-08-19) */}
                  <div className="mx-auto max-w-[240px] truncate font-medium" title={r.product_name}>
                    {r.product_name}
                  </div>
                </td>
                <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-muted">{r.sku ?? "—"}</td>
                <td className="whitespace-nowrap px-5 py-3">{r.category ?? "—"}</td>
                <td className="px-5 py-3">{r.color ?? "—"}</td>
                {/* DETAIL — specs ng produkto: unang 2 linya, buo sa tooltip. */}
                <td className="px-5 py-3 text-left text-xs text-muted">
                  {(() => {
                    const lines = (r.productSpecs ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^[•·-]\s*/, ""));
                    if (!lines.length) return "—";
                    return (
                      <div className="mx-auto max-w-[200px] leading-tight" title={lines.join("\n")}>
                        {lines.slice(0, 2).map((l, i) => <div key={i} className="truncate">• {l}</div>)}
                        {lines.length > 2 && <div className="text-[10px] text-muted/70">+{lines.length - 2} more…</div>}
                      </div>
                    );
                  })()}
                </td>
                <td className={cn("!border-l-4 !border-l-[#caa45a] px-5 py-3 text-center font-semibold", /low|out/i.test(r.status ?? "") ? "text-danger" : "")}>
                  {number(r.oh_inv ?? 0)}
                </td>
                <td className="px-5 py-3 text-center text-info">{number(r.reserved ?? 0)}</td>
                <td className="px-5 py-3 text-center font-medium">{number(r.available ?? 0)}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3">
                  <span className={cn("whitespace-nowrap font-medium", statusClass(r.status ?? ""))}>
                    {r.status ?? "—"}
                  </span>
                </td>
                <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3">
                  <InventoryRowActions row={r} />
                </td>
              </tr>
            ))}
            {total === 0 && (
              <tr>
                <td colSpan={11} className="px-5 py-8 text-center text-muted">
                  No inventory records.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer — pagination (left: rows/page · center: range · right: nav). NOT sticky:
          a sticky footer overlapped the last table row; keep it in normal flow below the
          table so no data is hidden behind it. */}
      <div className="grid grid-cols-1 items-center gap-3 rounded-b-xl border-t border-border bg-surface px-5 py-3 text-sm text-muted sm:grid-cols-3">
        <div className="flex items-center justify-center gap-2 sm:justify-start">
          <span>Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-primary"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="text-center font-medium text-foreground">
          {from}–{to} of {number(total)}
        </div>

        <div className="flex items-center justify-center gap-1 sm:justify-end">
          <PageBtn label="‹" disabled={current === 0} onClick={() => setPage(current - 1)} />
          <span className="px-1">Page {current + 1} of {pageCount}</span>
          <PageBtn label="›" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} />
        </div>
      </div>
    </Card>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted hover:bg-stone-100",
      )}
    >
      {children}
    </button>
  );
}

function PageBtn({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-foreground transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}
