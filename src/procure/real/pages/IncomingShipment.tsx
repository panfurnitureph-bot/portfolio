import { useEffect, useMemo, useState, useCallback } from "react";
import React from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, Download, RefreshCw, Ship, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";
import { TablePagination } from "@/components/ui/table-pagination";
import {
  useIncomingShipmentAllData,
  usePoCargoReadyDates,
  IncomingShipmentRow,
  MONTH_KEYS,
  MONTH_LABEL_KEYS,
  rowTotal,
  rowPeakMonth,
} from "@/hooks/useIncomingShipmentViewData";
import { useCascadingFilterOptions, type FilterColumnDef } from "@/hooks/useCascadingFilters";
import { useProductNames } from "@/hooks/useProductNames";
import { useFactoryAccess } from "@/hooks/useFactoryAccess";

/* ── helpers ── */
function asNum(v: unknown) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
const fmt = (v: number) => v.toLocaleString("en-US");

function csvEscape(value: unknown) {
  const s = String(value ?? "");
  const escaped = s.replaceAll(`"`, `""`);
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

type SortKey = "product_id" | "po_numbers" | "total" | "peak" | typeof MONTH_KEYS[number];
type SortDir = "asc" | "desc";

const FILTER_COLS: FilterColumnDef[] = [
  { key: "product_id", colName: "product_id", label: "Product ID" },
  { key: "po_numbers", colName: "po_numbers", label: "PO Numbers" },
];

const PAGE_SIZES = [25, 50, 100, 200];

/* ── component ── */
export default function IncomingShipment() {
  const [searchQuery, setSearchQuery] = usePersistedState("incoming-shipment:search", "");
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  const [pageSize, setPageSize] = usePersistedState("incoming-shipment:pageSize", 50);
  const [page, setPage] = usePersistedState("incoming-shipment:page", 1);
  const [filters, setFilters] = usePersistedState<Record<string, string[]>>("incoming-shipment:filters", {});
  const [sortKey, setSortKey] = usePersistedState<SortKey | "">("incoming-shipment:sortKey", "");
  const [sortDir, setSortDir] = usePersistedState<SortDir>("incoming-shipment:sortDir", "asc");
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const { data: allRows = [], isLoading: dataLoading, isFetching, refetch } = useIncomingShipmentAllData();
  const { data: poCrdMap } = usePoCargoReadyDates();
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { allowSku, restricted: factoryRestricted, ready: accessReady } = useFactoryAccess();
  const isLoading = dataLoading || !accessReady;

  /* month labels from first row */
  const monthLabels = useMemo(() => {
    if (!allRows.length) return MONTH_LABEL_KEYS.map((_, i) => `Month ${i + 1}`);
    const first = allRows[0];
    return MONTH_LABEL_KEYS.map((k, i) => String(first[k] ?? `Month ${i + 1}`));
  }, [allRows]);

  /* derived "has incoming" */
  const rowsWithDerived = useMemo(() => {
    let rows = allRows;
    if (factoryRestricted) rows = rows.filter(r => allowSku(r.product_id));
    return rows.map(r => ({
      ...r,
      _hasIncoming: MONTH_KEYS.some(k => asNum(r[k]) > 0) ? "Has Incoming" : "No Incoming",
    }));
  },
  [allRows, factoryRestricted, allowSku]);

  /* search */
  const searchedRows = useMemo(() => {
    const s = debouncedSearch.trim().toLowerCase();
    if (!s) return rowsWithDerived;
    return rowsWithDerived.filter(r =>
      (r.product_id ?? "").toLowerCase().includes(s) ||
      (r.po_numbers ?? "").toLowerCase().includes(s)
    );
  }, [rowsWithDerived, debouncedSearch]);

  /* multi-select filters */
  const filteredRows = useMemo(() => {
    let rows = searchedRows;
    for (const col of FILTER_COLS) {
      const sel = filters[col.key];
      if (sel?.length) {
        const set = new Set(sel);
        rows = rows.filter(r => {
          const v = r[col.colName as keyof typeof r];
          return v != null && set.has(String(v));
        });
      }
    }
    const hi = filters["has_incoming"];
    if (hi?.length) {
      const set = new Set(hi);
      rows = rows.filter(r => set.has(r._hasIncoming));
    }
    const mf = filters["month"];
    if (mf?.length) {
      const monthIndices = mf.map(label => monthLabels.indexOf(label)).filter(i => i >= 0);
      if (monthIndices.length) {
        rows = rows.filter(r => monthIndices.some(i => asNum(r[MONTH_KEYS[i]]) > 0));
      }
    }
    return rows;
  }, [searchedRows, filters, monthLabels]);

  /* cascading options */
  const cascadingOptions = useCascadingFilterOptions(
    searchedRows as unknown as Record<string, unknown>[],
    FILTER_COLS,
    filters,
  );

  const hasIncomingOptions = useMemo(() => {
    let rows = searchedRows;
    for (const col of FILTER_COLS) {
      const sel = filters[col.key];
      if (sel?.length) {
        const set = new Set(sel);
        rows = rows.filter(r => {
          const v = r[col.colName as keyof typeof r];
          return v != null && set.has(String(v));
        });
      }
    }
    const mf = filters["month"];
    if (mf?.length) {
      const monthIndices = mf.map(label => monthLabels.indexOf(label)).filter(i => i >= 0);
      if (monthIndices.length) {
        rows = rows.filter(r => monthIndices.some(i => asNum(r[MONTH_KEYS[i]]) > 0));
      }
    }
    const vals = new Set(rows.map(r => r._hasIncoming));
    return Array.from(vals).sort();
  }, [searchedRows, filters, monthLabels]);

  const monthFilterOptions = useMemo(() => {
    let rows = searchedRows;
    for (const col of FILTER_COLS) {
      const sel = filters[col.key];
      if (sel?.length) {
        const set = new Set(sel);
        rows = rows.filter(r => {
          const v = r[col.colName as keyof typeof r];
          return v != null && set.has(String(v));
        });
      }
    }
    const hi = filters["has_incoming"];
    if (hi?.length) {
      const set = new Set(hi);
      rows = rows.filter(r => set.has(r._hasIncoming));
    }
    const result: string[] = [];
    for (let i = 0; i < 12; i++) {
      if (rows.some(r => asNum(r[MONTH_KEYS[i]]) > 0)) {
        result.push(monthLabels[i]);
      }
    }
    return result;
  }, [searchedRows, filters, monthLabels]);

  /* sorting */
  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const arr = [...filteredRows];
    arr.sort((a, b) => {
      let va: unknown, vb: unknown;
      if (sortKey === "total") { va = rowTotal(a); vb = rowTotal(b); }
      else if (sortKey === "peak") { va = rowPeakMonth(a).value; vb = rowPeakMonth(b).value; }
      else { va = a[sortKey as keyof IncomingShipmentRow]; vb = b[sortKey as keyof IncomingShipmentRow]; }
      const na = Number(va), nb = Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb)) return sortDir === "asc" ? na - nb : nb - na;
      const sa = String(va ?? "").toLowerCase(), sb = String(vb ?? "").toLowerCase();
      return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return arr;
  }, [filteredRows, sortKey, sortDir]);

  /* pagination */
  const totalFiltered = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  useEffect(() => { setPage(1); }, [debouncedSearch, pageSize, filters]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

  const { data: productNames } = useProductNames(pageRows.map((r) => String(r.product_id ?? "")));

  const activeFilterCount = useMemo(() =>
    Object.values(filters).filter(v => v?.length > 0).length,
  [filters]);

  const clearFilters = useCallback(() => {
    setFilters({});
    setSearchQuery("");
    setPage(1);
  }, [setFilters, setSearchQuery, setPage]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }, [sortKey, setSortKey, setSortDir]);

  const setFilterValue = useCallback((key: string, value: string[]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, [setFilters]);

  /* KPIs */
  const kpi = useMemo(() => {
    const totals = filteredRows.map(r => rowTotal(r));
    const grandTotal = totals.reduce((a, b) => a + b, 0);
    const avgPerProduct = totals.length ? grandTotal / totals.length : 0;
    let topProduct = "-";
    let topValue = 0;
    for (let i = 0; i < filteredRows.length; i++) {
      if (totals[i] > topValue) {
        topValue = totals[i];
        topProduct = filteredRows[i].product_id ?? "-";
      }
    }
    return { grandTotal, avgPerProduct, topProduct, topValue };
  }, [filteredRows]);

  /* export */
  const handleExportAll = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const headers = ["Product ID", "PO Numbers", ...monthLabels, "Total", "Peak Month"];
      const csvLines: string[] = [headers.map(csvEscape).join(",")];
      for (const r of filteredRows) {
        const monthVals = MONTH_KEYS.map(k => asNum(r[k]));
        const total = monthVals.reduce((a, b) => a + b, 0);
        const peak = rowPeakMonth(r);
        csvLines.push([r.product_id ?? "", r.po_numbers ?? "", ...monthVals, total, peak.label].map(csvEscape).join(","));
      }
      const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `incoming_shipment_${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
    } finally {
      setIsExporting(false);
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 text-primary" />
      : <ArrowDown className="h-3 w-3 text-primary" />;
  };

  /* ── Column definitions (same pattern as Sales by Month) ── */
  const COL_DEFS = useMemo(() => {
    const cols: { key: string; label: string; width: number; numeric: boolean; sticky?: number; isProductId?: boolean }[] = [
      { key: "product_id", label: "Product ID", width: 160, numeric: false, sticky: 0, isProductId: true },
      { key: "product_name", label: "Product Name", width: 240, numeric: false, sticky: 160 },
      { key: "po_numbers", label: "PO Numbers", width: 180, numeric: false, sticky: 400 },
      ...monthLabels.map((m, i) => ({ key: MONTH_KEYS[i], label: m, width: 90, numeric: true })),
      { key: "_total", label: "Total", width: 78, numeric: true },
      { key: "_peak", label: "Peak", width: 80, numeric: false },
    ];
    return cols;
  }, [monthLabels]);

  const stickyBg = "hsl(var(--table-row, var(--background)))";

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-[650px]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden min-h-0" style={{ maxWidth: "none" }}>
      {/* ── TOP BAR ── */}
      <header className="h-14 shrink-0 border-b border-border bg-gradient-to-r from-primary/5 to-background">
        <div className="h-full px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Ship className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-foreground leading-tight truncate">Inbound Shipment</h1>
                <p className="text-[11px] text-muted-foreground truncate">
                  {fmt(filteredRows.length)} of {fmt(allRows.length)} products · {fmt(kpi.grandTotal)} total qty · Avg {fmt(Math.round(kpi.avgPerProduct))}/product
                  {kpi.topProduct !== "-" ? ` · Top: ${kpi.topProduct} (${fmt(kpi.topValue)})` : ""}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" className="h-8" onClick={handleExportAll} disabled={isExporting}>
              <Download className="h-3.5 w-3.5 mr-1" /> {isExporting ? "Exporting…" : "Export"}
            </Button>
          </div>
        </div>
      </header>

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-border bg-card/30">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search Product ID or PO…"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
            className="pl-9 h-8"
          />
        </div>

        <MultiSelectFilter
          label="Product ID"
          options={cascadingOptions["product_id"] ?? []}
          value={filters["product_id"] ?? []}
          onApply={v => setFilterValue("product_id", v)}
        />
        <MultiSelectFilter
          label="PO Numbers"
          options={cascadingOptions["po_numbers"] ?? []}
          value={filters["po_numbers"] ?? []}
          onApply={v => setFilterValue("po_numbers", v)}
        />
        <MultiSelectFilter
          label="Month"
          options={monthFilterOptions}
          value={filters["month"] ?? []}
          onApply={v => setFilterValue("month", v)}
        />
        <MultiSelectFilter
          label="Has Incoming"
          options={hasIncomingOptions}
          value={filters["has_incoming"] ?? []}
          onApply={v => setFilterValue("has_incoming", v)}
        />

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => refetch()}
          disabled={isFetching}
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>

        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={clearFilters}>
            <X className="h-3 w-3 mr-1" /> Clear filters ({activeFilterCount})
          </Button>
        )}

        <span className="text-xs text-muted-foreground">{totalFiltered.toLocaleString()} records</span>
      </div>

      {/* ── Grid ── */}
      <div className="flex-1 min-h-0 border-t border-border relative overflow-auto" style={{ isolation: "isolate" }}>
        <div className="min-w-max">
          <table className="w-full text-[12px] leading-tight border-separate border-spacing-0">
            <thead>
              <tr>
                {COL_DEFS.map((col) => {
                  const isSticky = col.sticky !== undefined;
                  const isSortable = col.key !== "_peak" && col.key !== "product_name";
                  return (
                    <th
                      key={col.key}
                      className={[
                        "app-th",
                        isSortable ? "cursor-pointer" : "cursor-default",
                      ].join(" ")}
                      style={{
                        position: "sticky",
                        top: 0,
                        width: col.width,
                        minWidth: col.width,
                        ...(isSticky
                          ? { left: col.sticky, zIndex: 70 }
                          : { zIndex: 60 }),
                      }}
                      onClick={isSortable ? () => handleSort(col.key as SortKey) : undefined}
                    >
                      <span className="inline-flex items-center justify-center gap-1">
                        {col.label}
                        {isSortable && <SortIcon col={col.key as SortKey} />}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={COL_DEFS.length} className="app-td text-center text-muted-foreground">
                    No records found.
                  </td>
                </tr>
              ) : (
                pageRows.map((row, ri) => {
                  const total = rowTotal(row);
                  const peak = rowPeakMonth(row);

                  return (
                    <tr key={`${row.product_id}-${ri}`} className="hover:bg-[#3b5769]/20 dark:hover:bg-[#2a2a2a] transition-colors duration-75">
                      {COL_DEFS.map((col) => {
                        const isSticky = col.sticky !== undefined;

                        let display: React.ReactNode;
                        let cellClass = "app-td text-center whitespace-nowrap";
                        const style: React.CSSProperties = {
                          width: col.width,
                          minWidth: col.width,
                        };

                        if (isSticky) {
                          style.position = "sticky";
                          style.left = col.sticky;
                          style.zIndex = 30;
                          cellClass += " app-td-sticky";
                        }

                        if (col.key === "_total") {
                          display = total > 0 ? fmt(total) : <span className="text-muted-foreground">-</span>;
                          cellClass += " tabular-nums font-semibold";
                        } else if (col.key === "_peak") {
                          display = peak.value > 0
                            ? <Badge variant="outline" className="text-[10px] px-1.5 py-0">{peak.label}</Badge>
                            : <span className="text-muted-foreground">-</span>;
                        } else if (col.numeric) {
                          const v = asNum(row[col.key]);
                          display = v > 0 ? fmt(v) : <span className="text-muted-foreground">-</span>;
                          cellClass += " tabular-nums";
                        } else if (col.isProductId) {
                          const innerPid = String(row.product_id ?? "");
                          display = innerPid ? (
                            <span className="font-mono text-xs">{innerPid}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          );
                        } else if (col.key === "product_name") {
                          const innerPid = String(row.product_id ?? "");
                          const name = productNames?.[innerPid]?.name || "";
                          display = name ? (
                            <span className="font-medium truncate">{name}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          );
                          cellClass = cellClass.replace("whitespace-nowrap", "whitespace-normal break-words");
                        } else if (col.key === "po_numbers") {
                          const tokens = (row.po_numbers ?? "").split("|").map(t => t.trim()).filter(Boolean);
                          display = tokens.length ? (
                            <span className="inline-flex flex-wrap gap-x-1">
                              {tokens.map((t, i) => {
                                const crd = poCrdMap?.get(t);
                                const late = !!crd && crd < todayISO;
                                return (
                                  <span key={i}>
                                    <span
                                      className={late ? "text-red-600 font-semibold" : undefined}
                                      title={crd ? `CRD: ${crd}${late ? " (past due)" : ""}` : undefined}
                                    >
                                      {t}
                                    </span>
                                    {i < tokens.length - 1 ? " |" : ""}
                                  </span>
                                );
                              })}
                            </span>
                          ) : <span className="text-muted-foreground">-</span>;
                        } else {
                          display = <span className="text-muted-foreground">-</span>;
                        }

                        return (
                          <td key={col.key} className={cellClass} style={style}>
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ── */}
      <TablePagination
        currentPage={page}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={totalFiltered}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        pageSizeOptions={PAGE_SIZES}
      />
    </div>
  );
}
