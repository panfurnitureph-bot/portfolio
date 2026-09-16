"use client";

import { useMemo, useState } from "react";
import { Card, Badge, cn } from "@/components/ui";
import { peso, number } from "@/lib/format";
import { ProductRowActions } from "@/components/product-row-actions";
import { Thumbnail } from "@/components/thumbnail";
import { CATEGORIES } from "@/lib/categories";
import type { ProductRow } from "@/lib/supabase/server";

const PAGE_SIZES = [10, 25, 50, 100];

export function ProductsTable({ products, locations = [], zones = [] }: { products: ProductRow[]; locations?: string[]; zones?: string[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const categories = useMemo(
    () =>
      Array.from(
        new Set([...CATEGORIES, ...(products.map((p) => p.category).filter(Boolean) as string[])]),
      ).sort(),
    [products],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      const matchesQuery =
        !q ||
        p.product_name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q);
      const matchesCat = category === "all" || p.category === category;
      return matchesQuery && matchesCat;
    });
  }, [products, query, category]);

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount - 1);
  const start = current * pageSize;
  const slice = rows.slice(start, start + pageSize);
  const from = total === 0 ? 0 : start + 1;
  const to = Math.min(start + pageSize, total);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          placeholder="Search name or SKU…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-2">
          <Chip active={category === "all"} onClick={() => { setCategory("all"); setPage(0); }}>
            All
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => { setCategory(c); setPage(0); }}>
              {c}
            </Chip>
          ))}
        </div>
      </div>

      <Card className="overflow-visible">
        <div className="max-h-[70vh] overflow-auto rounded-t-xl pf-scroll">
          <table className="w-full xl:min-w-[1100px] border-collapse text-center text-[11px] xl:text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_td]:align-middle [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
            {/* COLUMNS (2026-08-18) — tugma sa bagong Add Product form: tanggal
                ang Dimension at Supplier Details (Zone/Supplier/Rak); nasa
                specs na ang mga sukat, sa QC Receiving ang storage. */}
            <colgroup>
              <col span={5} />
              <col span={1} />
              <col span={1} />
              <col span={1} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
                <th colSpan={6} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] px-5 py-2">
                  Product Information
                </th>
                <th colSpan={1} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">
                  Pricing
                </th>
                <th colSpan={1} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">
                  Status
                </th>
                <th colSpan={1} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a]"></th>
              </tr>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
                <th className="sticky top-[33px] bg-[#5a4a26] px-3 py-3">Photo</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-5 py-3">Product</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-5 py-3">SKU</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-5 py-3">Category</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-5 py-3">Color</th>
                <th className="sticky top-[33px] bg-[#5a4a26] px-5 py-3">Detail</th>
                <th className="sticky top-[33px] bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-5 py-3">Price</th>
                <th className="sticky top-[33px] bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-5 py-3">Status</th>
                <th className="sticky top-[33px] bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-stone-50">
                  {/* HIWALAY NA HANAY ANG LARAWAN (2026-08-23). Nang magkasama
                      sila sa isang cell, ang mahabang pangalan ay nagtutulak sa
                      thumbnail at hindi na pantay ang hanay pababa. */}
                  <td className="px-3 py-3">
                    <div className="flex justify-center">
                      <Thumbnail name={p.product_name} url={p.image_url} />
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-center gap-3">
                      <div className="min-w-0 text-left">
                        {(p.product_type ?? "").toLowerCase() === "imported"
                          ? <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-600/20">Imported</span>
                          : <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Local</span>}
                        <div className="max-w-[240px] truncate font-medium" title={p.product_name}>
                          {p.product_name}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-muted">{p.sku ?? "—"}</td>
                  <td className="whitespace-nowrap px-5 py-3">{p.category ?? "—"}</td>
                  <td className="px-5 py-3">{p.color ?? "—"}</td>
                  {/* SPECS (bagong format 2026-08-18) — unang 2 linya, buo sa tooltip. */}
                  <td className="px-5 py-3 text-left text-xs text-muted">
                    {(() => {
                      const lines = (p.specs ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^[•·\-\s]+/, ""));
                      if (!lines.length) return "—";
                      return (
                        <div className="max-w-[200px] leading-tight" title={lines.join("\n")}>
                          {lines.slice(0, 2).map((l, i) => <div key={i} className="truncate">• {l}</div>)}
                          {lines.length > 2 && <div className="text-[10px] text-muted/70">+{lines.length - 2} more…</div>}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="!border-l-4 !border-l-[#caa45a] whitespace-nowrap px-5 py-3 text-right font-medium">
                    {p.price != null ? peso(Number(p.price)) : "—"}
                  </td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3">
                    {p.status ? <Badge value={p.status.toLowerCase()} /> : "—"}
                  </td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3 text-right">
                    <ProductRowActions product={p} locations={locations} zones={zones} />
                  </td>
                </tr>
              ))}
              {total === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted">
                    No products match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer — pagination (NOT sticky, so it can't overlap the last row) */}
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
    </div>
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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-surface text-muted hover:bg-stone-100",
      )}
    >
      {children}
    </button>
  );
}
