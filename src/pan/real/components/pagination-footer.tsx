"use client";

import { useMemo, useState } from "react";

// Shared client-side pagination state. Slices `rows` for the current page.
export function usePagination<T>(rows: T[], initial = 25) {
  const [pageSize, setPageSize] = useState(initial);
  const [page, setPage] = useState(1);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages);
  const slice = useMemo(
    () => rows.slice((cur - 1) * pageSize, (cur - 1) * pageSize + pageSize),
    [rows, cur, pageSize],
  );
  return { slice, page: cur, setPage, pageSize, setPageSize, total, pages };
}

type Props = {
  page: number;
  setPage: (n: number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
  total: number;
  pages: number;
};

// Sticky pagination footer — pinned to the bottom of the scroll area, always visible.
// Place as a sibling AFTER the table's horizontal-scroll wrapper, inside an overflow-visible card.
export function PaginationFooter({ page, setPage, pageSize, setPageSize, total, pages }: Props) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const nav = "flex h-7 w-7 items-center justify-center rounded-md border border-border text-base leading-none hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    // NOT sticky: a sticky footer overlapped the last table row; keep it in normal flow.
    <div className="grid grid-cols-1 items-center gap-3 rounded-b-xl border-t border-border bg-surface px-5 py-3 text-sm text-muted sm:grid-cols-3">
      <div className="flex items-center justify-center gap-2 sm:justify-start">
        <span>Rows per page:</span>
        <select
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
          className="rounded-md border border-border bg-surface px-2 py-1 outline-none focus:border-primary"
        >
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className="text-center tabular-nums">{from}-{to} of {total}</div>
      <div className="flex items-center justify-center gap-2 sm:justify-end">
        <button onClick={() => setPage(page - 1)} disabled={page <= 1} className={nav} aria-label="Previous page">‹</button>
        <span className="tabular-nums">Page {page} of {pages}</span>
        <button onClick={() => setPage(page + 1)} disabled={page >= pages} className={nav} aria-label="Next page">›</button>
      </div>
    </div>
  );
}
