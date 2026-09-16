import React, { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useCascadingFilterOptions, FilterColumnDef } from "@/hooks/useCascadingFilters";
import { useFactoryAccess } from "@/hooks/useFactoryAccess";
import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TablePagination } from "@/components/ui/table-pagination";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search, RefreshCw, Download, ArrowUpDown, ArrowUp, ArrowDown, BarChart3,
} from "lucide-react";

const MONTH_KEYS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
] as const;
const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAGE_SIZES = [25, 50, 100];

type Row = Record<string, any>;

const n = (v: any): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Single-pass null/blank → 0 normalization for instock month columns.
 * Runs once per fetch in queryFn so downstream renders never see null/undefined.
 * Consolidates per-cell render-time guards into one pre-cache step.
 */
function normalizeInstockRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of MONTH_KEYS) {
    if (out[k] == null) out[k] = 0;
  }
  return out as T;
}

const currentMonth = new Date().getMonth(); // 0-indexed
const currentYear = new Date().getFullYear();

const rowAvg = (r: Row) => {
  const yr = Number(r.year);
  const limit = yr < currentYear ? 12 : yr === currentYear ? currentMonth + 1 : 0;
  const vals = MONTH_KEYS.slice(0, limit).map((k) => n(r[k])).filter((v) => v > 0);
  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
};

const peakMonth = (r: Row) => {
  let best = 0, idx = 0;
  MONTH_KEYS.forEach((k, i) => {
    const v = n(r[k]);
    if (v > best) { best = v; idx = i; }
  });
  return best > 0 ? MONTH_SHORT[idx] : "—";
};

const fmt = (v: number) => v.toLocaleString("en-US");

const buildYearOptions = (): string[] => {
  const years: string[] = [];
  for (let y = currentYear; y >= 2020; y--) years.push(String(y));
  return years;
};

export default function InstockPercentage() {
  const YEAR_OPTIONS = useMemo(() => buildYearOptions(), []);

  const {
    data: allRows = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery<Row[]>({
    queryKey: ["instock_percent_all"],
    queryFn: async () => {
      const batchSize = 1000;
      let all: Row[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("instock_percent_all")
          .select("year,product_id,product_name,jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec,updated_at")
          .order("product_id", { ascending: true })
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < batchSize) break;
        from += batchSize;
      }
      return all.map(normalizeInstockRow);
    },
    staleTime: 60_000,
  });

  const [selectedYear, setSelectedYear] = usePersistedState<string>(
    "instock_pct_year",
    YEAR_OPTIONS[0] ?? String(currentYear),
  );
  const activeYear = YEAR_OPTIONS.includes(selectedYear) ? selectedYear : YEAR_OPTIONS[0];

  const [search, setSearch] = useState("");
  const [filters, setFilters] = usePersistedState<Record<string, string[]>>("instock_pct_filters", {});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistedState("instock_pct_ps", 50);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Factory/region access — restrict rows to the user's assigned country (by SKU).
  const { allowSku, restricted: factoryRestricted, ready: accessReady } = useFactoryAccess();

  const yearRows = useMemo(() => {
    let rows = allRows.filter((r) => String(r.year) === activeYear);
    if (factoryRestricted) rows = rows.filter((r) => allowSku(r.product_id));
    return rows;
  }, [allRows, activeYear, factoryRestricted, allowSku]);

  const searchFiltered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return yearRows;
    return yearRows.filter(
      (r) =>
        String(r.product_id ?? "").toLowerCase().includes(s) ||
        String(r.product_name ?? "").toLowerCase().includes(s),
    );
  }, [yearRows, search]);

  const filterCols: FilterColumnDef[] = useMemo(
    () => [
      { key: "product_id", colName: "product_id", label: "Product ID" },
      { key: "product_name", colName: "product_name", label: "Product Name" },
      { key: "has_data", colName: "_has_data", label: "Has Data" },
    ],
    [],
  );

  const enriched = useMemo(
    () => searchFiltered.map((r): Row => ({ ...r, _has_data: rowAvg(r) > 0 ? "Yes" : "No" })),
    [searchFiltered],
  );

  const cascadingOptions = useCascadingFilterOptions(enriched, filterCols, filters);

  const filteredRows = useMemo(() => {
    let rows = enriched;
    for (const col of filterCols) {
      const sel = filters[col.key];
      if (sel && sel.length > 0) {
        const set = new Set(sel);
        rows = rows.filter((r) => set.has(String(r[col.colName] ?? "")));
      }
    }
    return rows;
  }, [enriched, filters, filterCols]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      let va: any, vb: any;
      if (sortKey === "_avg") { va = rowAvg(a); vb = rowAvg(b); }
      else if (MONTH_KEYS.includes(sortKey as any)) { va = n(a[sortKey]); vb = n(b[sortKey]); }
      else if (sortKey === "_total") {
        va = MONTH_KEYS.reduce((s, k) => s + n(a[k]), 0);
        vb = MONTH_KEYS.reduce((s, k) => s + n(b[k]), 0);
      } else { va = String(a[sortKey] ?? "").toLowerCase(); vb = String(b[sortKey] ?? "").toLowerCase(); }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredRows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(
    () => sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sortedRows, safePage, pageSize],
  );

  const kpis = useMemo(() => {
    let totalAvg = 0, topAvg = 0, topName = "";
    filteredRows.forEach((r) => {
      const avg = rowAvg(r);
      totalAvg += avg;
      if (avg > topAvg) { topAvg = avg; topName = String(r.product_id ?? ""); }
    });
    const overallAvg = filteredRows.length > 0 ? totalAvg / filteredRows.length : 0;
    return { totalProducts: filteredRows.length, overallAvg, topProduct: topName, topAvg };
  }, [filteredRows]);

  const activeFilterCount = Object.values(filters).filter((v) => v && v.length > 0).length;

  const clearFilters = useCallback(() => {
    setFilters({});
    setSearch("");
    setPage(1);
  }, [setFilters]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDir === "desc") setSortDir("asc");
      else { setSortKey(null); setSortDir("desc"); }
    } else { setSortKey(key); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />;
  };

  const handleExport = () => {
    const header = ["Product ID", "Product Name", ...MONTH_LABELS, "Avg %", "Peak Month"];
    const csvRows = sortedRows.map((r) => [
      r.product_id ?? "", r.product_name ?? "",
      ...MONTH_KEYS.map((k) => n(r[k]).toFixed(2)),
      rowAvg(r).toFixed(2), peakMonth(r),
    ]);
    const csv = [header, ...csvRows]
      .map((row) => row.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `instock_percent_${activeYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isFutureMonth = (monthIdx: number): boolean => {
    const yr = Number(activeYear);
    if (yr > currentYear) return true;
    if (yr === currentYear && monthIdx > currentMonth) return true;
    return false;
  };

  const COL_DEFS = useMemo(() => {
    const cols: { key: string; label: string; width: number; numeric: boolean; sticky?: number }[] = [
      { key: "product_id", label: "Product ID", width: 160, numeric: false, sticky: 0 },
      { key: "product_name", label: "Product Name", width: 200, numeric: false, sticky: 160 },
      ...MONTH_LABELS.map((m, i) => ({ key: MONTH_KEYS[i], label: m, width: 90, numeric: true })),
      { key: "_avg", label: "Avg %", width: 78, numeric: true },
      { key: "_peak", label: "Peak", width: 72, numeric: false },
    ];
    return cols;
  }, []);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden min-h-0" style={{ maxWidth: "none" }}>
      {/* Header */}
      <header className="h-14 shrink-0 border-b border-border bg-gradient-to-r from-primary/5 to-background">
        <div className="h-full px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <BarChart3 className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-foreground leading-tight truncate">Availability by Month</h1>
                <p className="text-[11px] text-muted-foreground truncate">
                  {fmt(kpis.totalProducts)} products · Avg {kpis.overallAvg.toFixed(1)}%
                  {kpis.topProduct ? ` · Top: ${kpis.topProduct} (${kpis.topAvg.toFixed(1)}%)` : ""}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" className="h-8" onClick={handleExport}>
              <Download className="h-3.5 w-3.5 mr-1" /> Export
            </Button>
          </div>
        </div>
      </header>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-border bg-card/30">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search product…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 h-8"
          />
        </div>

        <Select value={activeYear} onValueChange={(v) => { setSelectedYear(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover">
            {YEAR_OPTIONS.map((y) => (
              <SelectItem key={y} value={y}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filterCols.map((col) => (
          <MultiSelectFilter
            key={col.key}
            label={col.label}
            options={cascadingOptions[col.key] ?? []}
            value={filters[col.key] ?? []}
            onApply={(v) => { setFilters((p) => ({ ...p, [col.key]: v })); setPage(1); }}
          />
        ))}

        <Button
          variant="outline" size="icon" className="h-8 w-8"
          onClick={() => refetch()} disabled={isFetching} title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>

        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={clearFilters}>
            Clear filters ({activeFilterCount})
          </Button>
        )}

        <span className="text-xs text-muted-foreground">{sortedRows.length.toLocaleString()} records</span>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 border-t border-border relative overflow-auto" style={{ isolation: "isolate" }}>
        <div className="min-w-max">
          <table className="w-full text-[12px] leading-tight border-separate border-spacing-0">
            <thead>
              <tr>
                {COL_DEFS.map((col) => {
                  const isSticky = col.sticky !== undefined;
                  const isSortable = col.key !== "_peak";
                  return (
                    <th
                      key={col.key}
                      className={["app-th", isSortable ? "cursor-pointer" : "cursor-default"].join(" ")}
                      style={{
                        position: "sticky",
                        top: 0,
                        width: col.width,
                        minWidth: col.width,
                        ...(isSticky
                          ? { left: col.sticky, zIndex: 70 }
                          : { zIndex: 60 }),
                      }}
                      onClick={isSortable ? () => toggleSort(col.key) : undefined}
                    >
                      <span className="inline-flex items-center justify-center gap-1">
                        {col.label}
                        {isSortable && <SortIcon col={col.key} />}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {isLoading || !accessReady ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {COL_DEFS.map((col) => (
                      <td key={col.key} className="app-td">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={COL_DEFS.length} className="app-td text-center text-muted-foreground">
                    No records found.
                  </td>
                </tr>
              ) : (
                pagedRows.map((r, ri) => {
                  const avg = rowAvg(r);
                  const peak = peakMonth(r);
                  const stickyBg = "hsl(var(--background))";

                  return (
                    <tr key={`${r.product_id}-${ri}`} className="hover:bg-[#3b5769]/20 dark:hover:bg-[#2a2a2a] transition-colors duration-75">
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

                        if (col.key === "_avg") {
                          display = avg > 0 ? `${avg.toFixed(2)}%` : <span className="text-muted-foreground">-</span>;
                          cellClass += " tabular-nums font-semibold";
                        } else if (col.key === "_peak") {
                          display = peak === "—" ? <span className="text-muted-foreground">-</span> : (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{peak}</Badge>
                          );
                        } else if (col.numeric) {
                          const v = n(r[col.key]);
                          display = v > 0 ? `${v.toFixed(2)}%` : "0.00";
                          cellClass += " tabular-nums";
                        } else if (col.key === "product_id") {
                          display = r.product_id || <span className="text-muted-foreground">-</span>;
                        } else if (col.key === "product_name") {
                          const fullName = String(r.product_name || "");
                          // Extract main name and variant
                          let mainName = fullName;
                          let variant = "";
                          const mIn = fullName.match(/^(.*?)\s+in\s+(.*)$/i);
                          const mDash = fullName.match(/^(.*?)\s+-\s+(.*)$/);
                          if (mIn) {
                            mainName = mIn[1].trim();
                            variant = mIn[2].trim();
                          } else if (mDash) {
                            mainName = mDash[1].trim();
                            variant = mDash[2].trim();
                          }
                          
                          display = fullName ? (
                            <div className="min-w-0">
                              <div className="font-medium truncate">{mainName || fullName}</div>
                              {variant && (
                                <div className="text-[11px] text-muted-foreground truncate">{variant}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          );
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

      {/* Pagination */}
      <TablePagination
        currentPage={safePage}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        totalItems={sortedRows.length}
        pageSizeOptions={PAGE_SIZES}
      />
    </div>
  );
}
