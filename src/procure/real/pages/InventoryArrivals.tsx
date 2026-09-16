import React, { useEffect, useMemo, useState, useCallback } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";
import { useLazyFilterOptions } from "@/hooks/useLazyFilterOptions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { TablePagination } from "@/components/ui/table-pagination";
import { Plus, Search, Download, Upload, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, ChevronDown, RefreshCw, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { parseCSV, readFileAsText } from "@/lib/csvUtils";
import { buildSearchFilter, ColumnFilters } from "@/lib/searchUtils";
import { exportAllRows, buildExportColumns } from "@/lib/serverExport";
import { ColumnFilterDropdown, ActiveFiltersIndicator } from "@/components/shared/ColumnFilterDropdown";
import { useColumnFilters } from "@/hooks/useColumnFilters";
import { usePagePermission } from "@/hooks/usePagePermission";
import { PermissionGuardButton } from "@/components/shared/PermissionGuardButton";
import { useFactoryAccess } from "@/hooks/useFactoryAccess";

const TABLE_NAME = "dashboard_inventory_arrival";
const QUERY_KEY = "inventory-arrivals-monitor";

const FILTER_COLUMNS: { key: string; label: string; column: string }[] = [
  { key: "id", label: "PO Number", column: "id" },
  { key: "vendor_name", label: "Vendor", column: "vendor_name" },
  { key: "warehouse_name", label: "Warehouse", column: "warehouse_name" },
  { key: "received_on", label: "Received Date", column: "received_on" },
  { key: "product_name", label: "Product Name", column: "product_name" },
];

const PAGE_SIZES = [25, 50, 100, 200, 500];
const EXCLUDE_COLUMNS = ["created_at", "updated_at", "refreshed_at"];

// ✅ SHOW ONLY THESE COLUMNS (match your screenshot)
// ✅ PO # uses `id`
const VIEW_ONLY = [
  { key: "id", label: "PO #" },
  { key: "date_ordered", label: "PO DATE" },
  { key: "warehouse_name", label: "WAREHOUSE" },
  { key: "vendor_name", label: "VENDOR" },
  { key: "product_name", label: "PRODUCT NAME" },
  { key: "adjusted_price", label: "PRICE" },
  { key: "received_on", label: "RECEIVED ON" },
  { key: "qty_received", label: "QTY RECEIVED" },
  { key: "qty_before_receive", label: "QTY BEFORE RECEIVE" },
] as const;

// types
type SchemaColumn = { column_name: string; data_type: string; ordinal_position: number };

const NUMERIC_TYPES = [
  "integer",
  "bigint",
  "smallint",
  "numeric",
  "real",
  "double precision",
  "decimal",
  "int8",
  "int4",
  "int2",
];
const DATE_TYPES = ["date", "timestamp without time zone", "timestamp with time zone", "timestamptz", "timestamp"];
const BOOLEAN_TYPES = ["boolean", "bool"];

const isNumericType = (dt: string) => NUMERIC_TYPES.some((t) => String(dt).toLowerCase().includes(t));
const isDateType = (dt: string) => DATE_TYPES.some((t) => String(dt).toLowerCase().includes(t));
const isBoolType = (dt: string) => BOOLEAN_TYPES.some((t) => String(dt).toLowerCase().includes(t));
const isTextType = (dt: string) => /text|char|uuid|varchar|string/i.test(String(dt));

const LONG_TEXT_HINTS = [
  "company_name",
  "vendor_name",
  "product_name",
  "warehouse_name",
  "notes",
  "comment",
  "remarks",
];

const isLongText = (col: SchemaColumn) => {
  const n = String(col.column_name ?? "").toLowerCase();
  return isTextType(col.data_type) && (LONG_TEXT_HINTS.some((h) => n.includes(h)) || n.includes("name"));
};

// ✅ PO DATE + RECEIVED ON format: "February 26, 2026"
function formatCell(value: any, dataType: string, colName?: string): React.ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;

  if (colName === "date_ordered" || colName === "received_on") {
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return String(value);
      return format(d, "MMMM d, yyyy");
    } catch {
      return String(value);
    }
  }

  if (isBoolType(dataType)) {
    return (
      <Badge variant="secondary" className="text-[11px] px-1.5 py-0">
        {value ? "Yes" : "No"}
      </Badge>
    );
  }

  if (isDateType(dataType)) {
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return String(value);
      return format(d, "MMMM d, yyyy");
    } catch {
      return String(value);
    }
  }

  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline truncate max-w-[240px] inline-block"
      >
        {value}
      </a>
    );
  }

  return String(value);
}

function parseMaybeNumber(v: any) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export default function InventoryArrivalsMonitor() {
  const qc = useQueryClient();
  const { canEdit, guardEdit, guardDelete } = usePagePermission('dashboard_inventory_arrival');
  const { allowedSkus, restricted: factoryRestricted, ready: accessReady } = useFactoryAccess();

  // header/search
  const [search, setSearch] = usePersistedState("inv-arrivals:search", "");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = usePersistedState<Record<string, string[]>>("inv-arrivals:filters", {});

  // paging
  const [page, setPage] = usePersistedState("inv-arrivals:page", 0);
  const [pageSize, setPageSize] = usePersistedState("inv-arrivals:pageSize", 50);

  // sort
  const [sortCol, setSortCol] = usePersistedState<string | null>("inv-arrivals:sortCol", null);
  const [sortAsc, setSortAsc] = usePersistedState("inv-arrivals:sortAsc", true);




  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addValues, setAddValues] = useState<Record<string, any>>({});
  const [savingAdd, setSavingAdd] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<Record<string, any> | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete dialog
  const [deleteRow, setDeleteRow] = useState<Record<string, any> | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingRow, setDeletingRow] = useState(false);

  // Import dialog
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<Record<string, any>[] | null>(null);
  const [importing, setImporting] = useState(false);

  // Export
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Debounce global search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);




  // schema
  const { data: schemaRaw = [], isLoading: schemaLoading } = useQuery({
    queryKey: [QUERY_KEY, "schema"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_table_columns", { p_schema: "public", p_table: TABLE_NAME });
      if (error) throw error;
      const cols = (data as SchemaColumn[]) ?? [];
      return cols.sort((a, b) => (a.ordinal_position ?? 0) - (b.ordinal_position ?? 0));
    },
    staleTime: Infinity,
  });

  const schema = useMemo(() => schemaRaw.filter((c) => !EXCLUDE_COLUMNS.includes(c.column_name)), [schemaRaw]);

  /* ── Filter infrastructure ── */
  const resolvedFilterCols = useMemo(() => {
    if (!schemaRaw.length) return [];
    const schemaSet = new Set(schemaRaw.map((c) => c.column_name));
    return FILTER_COLUMNS.filter((fc) => schemaSet.has(fc.column)).map((fc) => ({
      key: fc.key,
      label: fc.label,
      colName: fc.column,
    }));
  }, [schemaRaw]);

  /* ── Lazy filter options (backend-driven, on-demand) ── */
  const { optionsMap: distinctOptions, markOpened: markFilterOpened, isLoadingFor: isFilterLoading } = useLazyFilterOptions(
    TABLE_NAME,
    QUERY_KEY,
    resolvedFilterCols,
    filters,
  );
  const activeFilterCount = useMemo(() => Object.values(filters).filter((v) => v && v.length > 0).length, [filters]);

  const applyFiltersToQuery = useCallback((q: any) => {
    for (const fc of resolvedFilterCols) {
      const selected = filters[fc.key];
      if (selected && selected.length > 0) q = q.in(fc.colName, selected);
    }
    return q;
  }, [resolvedFilterCols, filters]);

  // pk is id
  const pkCol = "id";

  // grid columns are fixed to VIEW_ONLY
  const orderedCols = useMemo(() => {
    const map = new Map(schema.map((c) => [c.column_name, c]));
    return VIEW_ONLY.map((v) => map.get(v.key)).filter(Boolean) as SchemaColumn[];
  }, [schema]);

  // ✅ default sort: Received On DESC — latest first
  useEffect(() => {
    if (!sortCol) {
      setSortCol("received_on");
      setSortAsc(false);
    }
  }, [sortCol]);

  const effectiveSortCol = sortCol || "received_on";
  const effectiveSortAsc = sortAsc;

  // data query
  const { data: rowsResult, isLoading: dataLoading } = useQuery({
    queryKey: [QUERY_KEY, "rows", page, pageSize, debouncedSearch, effectiveSortCol, effectiveSortAsc, filters, factoryRestricted, allowedSkus],
    queryFn: async () => {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      // only select displayed columns (efficient)
      const selectCols = Array.from(new Set([pkCol, ...VIEW_ONLY.map((v) => v.key)])).join(",");

      let q: any = supabase.from(TABLE_NAME).select(selectCols, { count: "exact" });

      const orFilter = buildSearchFilter(schema, debouncedSearch);
      if (orFilter) q = q.or(orFilter);
      q = applyFiltersToQuery(q);
      if (factoryRestricted) q = q.in("product_id", allowedSkus ?? []);

      q = q.order(effectiveSortCol, { ascending: effectiveSortAsc });
      q = q.range(from, to);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data || []) as Record<string, any>[], count: count || 0 };
    },
    enabled: schema.length > 0 && orderedCols.length > 0,
  });

  let rows = rowsResult?.rows || [];
  const totalCount = rowsResult?.count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // numeric sort fallback if sorting by id but stored as text
  const idSchemaType = orderedCols.find((c) => c.column_name === "id")?.data_type || "";
  const idLooksText = isTextType(idSchemaType);
  if (effectiveSortCol === "id" && idLooksText) {
    rows = [...rows].sort((a, b) => {
      const an = parseMaybeNumber(a?.id);
      const bn = parseMaybeNumber(b?.id);
      if (an === null && bn === null) return 0;
      if (an === null) return 1;
      if (bn === null) return -1;
      return effectiveSortAsc ? an - bn : bn - an;
    });
  }

  // date sort fallback for received_on (may be stored as text)
  if (effectiveSortCol === "received_on") {
    rows = [...rows].sort((a, b) => {
      const da = a?.received_on ? new Date(a.received_on).getTime() : NaN;
      const db = b?.received_on ? new Date(b.received_on).getTime() : NaN;
      const aValid = !isNaN(da);
      const bValid = !isNaN(db);
      if (!aValid && !bValid) return 0;
      if (!aValid) return 1;
      if (!bValid) return -1;
      return effectiveSortAsc ? da - db : db - da;
    });
  }

  // realtime invalidate
  useEffect(() => {
    const ch = supabase
      .channel(`${TABLE_NAME}_rt`)
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_NAME }, () =>
        qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const handleSort = useCallback(
    (col: string) => {
      if (sortCol === col) setSortAsc((v) => !v);
      else {
        setSortCol(col);
        setSortAsc(true);
      }
      setPage(0);
    },
    [sortCol],
  );

  // -----------------------------
  // ADD RECORD (working)
  // -----------------------------
  const addFormCols = useMemo(() => schema.filter((c) => c.column_name !== pkCol), [schema]);

  const buildPayload = (cols: SchemaColumn[], values: Record<string, any>) => {
    const payload: Record<string, any> = {};
    cols.forEach((c) => {
      const k = c.column_name;
      if (k === pkCol) return;

      let v = values[k];
      if (v === "" || v === undefined) v = null;
      else if (isNumericType(c.data_type)) v = Number(String(v).replace(/,/g, ""));
      else if (isBoolType(c.data_type)) v = v === "true" || v === true;

      payload[k] = v;
    });
    return payload;
  };

  const handleOpenAdd = () => {
    const initial: Record<string, any> = {};
    addFormCols.forEach((c) => {
      if (c.column_name === pkCol) return;
      initial[c.column_name] = isBoolType(c.data_type) ? false : "";
    });
    setAddValues(initial);
    setAddOpen(true);
  };

  const handleSaveAdd = async () => {
    setSavingAdd(true);
    try {
      const payload = buildPayload(addFormCols, addValues);
      const { error } = await supabase.from(TABLE_NAME).insert(payload);
      if (error) throw error;
      toast.success("Added");
      setAddOpen(false);
      qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    } catch (e: any) {
      toast.error("Add failed: " + (e?.message ?? String(e)));
    } finally {
      setSavingAdd(false);
    }
  };

  // -----------------------------
  // EDIT RECORD
  // -----------------------------
  const handleOpenEdit = (row: Record<string, any>) => {
    const vals: Record<string, any> = {};
    addFormCols.forEach((c) => {
      vals[c.column_name] = row[c.column_name] ?? (isBoolType(c.data_type) ? false : "");
    });
    setEditValues(vals);
    setEditRow(row);
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editRow) return;
    setSavingEdit(true);
    try {
      const payload = buildPayload(addFormCols, editValues);
      const { data, error } = await supabase.from(TABLE_NAME).update(payload).eq(pkCol, editRow[pkCol]).select("*");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("No rows updated — check RLS policies.");
      toast.success("Updated");
      setEditOpen(false);
      setEditRow(null);
      qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    } catch (e: any) {
      toast.error("Update failed: " + (e?.message ?? String(e)));
    } finally {
      setSavingEdit(false);
    }
  };

  // -----------------------------
  // DELETE RECORD
  // -----------------------------
  const handleConfirmDelete = async () => {
    if (!deleteRow) return;
    setDeletingRow(true);
    try {
      const { data, error } = await supabase.from(TABLE_NAME).delete().eq(pkCol, deleteRow[pkCol]).select("*");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("No rows deleted — check RLS policies.");
      toast.success("Deleted");
      setDeleteOpen(false);
      setDeleteRow(null);
      qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    } catch (e: any) {
      toast.error("Delete failed: " + (e?.message ?? String(e)));
    } finally {
      setDeletingRow(false);
    }
  };

  // -----------------------------
  // IMPORT CSV (working)
  // -----------------------------
  const handleImportFilePreview = async () => {
    if (!importFile) return;
    try {
      const text = await readFileAsText(importFile);
      const parsed = parseCSV(text) as Record<string, any>[];

      const allowed = new Set(schema.map((c) => c.column_name));
      const cleaned = parsed.map((row) => {
        const out: Record<string, any> = {};
        Object.keys(row || {}).forEach((k) => {
          if (allowed.has(k) && !EXCLUDE_COLUMNS.includes(k)) out[k] = row[k];
        });
        return out;
      });

      setImportPreview(cleaned);
    } catch (e: any) {
      toast.error("Failed to parse: " + (e?.message ?? String(e)));
    }
  };

  const handleCommitImport = async () => {
    if (!importPreview?.length) return;
    setImporting(true);
    try {
      for (let i = 0; i < importPreview.length; i += 200) {
        const batch = importPreview.slice(i, i + 200);
        const { error } = await supabase.from(TABLE_NAME).insert(batch);
        if (error) throw error;
      }
      toast.success(`Imported ${importPreview.length} rows`);
      setImportOpen(false);
      setImportFile(null);
      setImportPreview(null);
      qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    } catch (e: any) {
      toast.error("Import failed: " + (e?.message ?? String(e)));
    } finally {
      setImporting(false);
    }
  };

  // -----------------------------
  // EXPORT (working)
  // -----------------------------
  const handleExport = async () => {
    setExporting(true);
    setExportProgress(0);
    try {
      const columns = buildExportColumns(schemaRaw as SchemaColumn[], EXCLUDE_COLUMNS);

      const count = await exportAllRows({
        supabaseClient: supabase,
        tableName: TABLE_NAME,
        columns,
        buildQuery: (q: any) => {
          const orFilter = buildSearchFilter(schema, debouncedSearch);
          if (orFilter) q = q.or(orFilter);
          q = applyFiltersToQuery(q);
          if (factoryRestricted) q = q.in("product_id", allowedSkus ?? []);
          q = q.order(effectiveSortCol, { ascending: effectiveSortAsc });
          return q;
        },
        filename: "inventory_arrivals",
        onProgress: setExportProgress,
      });

      toast.success(`Exported ${count} rows`);
    } catch (e: any) {
      toast.error("Export failed: " + (e?.message ?? String(e)));
    } finally {
      setExporting(false);
    }
  };

  const isLoading = schemaLoading || dataLoading || !accessReady;
  const stickyBg = "hsl(var(--table-row))";
  const stickyMutedBg = "hsl(var(--table-row-alt))";

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden min-h-0">
      {/* HEADER BAR */}
      <header className="h-14 shrink-0 border-b border-border bg-gradient-to-r from-primary/5 to-background">
        <div className="h-full px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Plus className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-foreground leading-tight truncate">Inventory Arrival</h1>
                <p className="text-[11px] text-muted-foreground truncate">Monitoring view (latest arrivals first)</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <PermissionGuardButton canEdit={canEdit} variant="outline" size="sm" className="h-8" onClick={() => setImportOpen(true)}>
              <Upload className="h-3.5 w-3.5 mr-1" /> Import
            </PermissionGuardButton>
            <Button variant="outline" size="sm" className="h-8" onClick={handleExport} disabled={exporting}>
              <Download className="h-3.5 w-3.5 mr-1" /> {exporting ? `Exporting… ${exportProgress}` : "Export"}
            </Button>
            <PermissionGuardButton canEdit={canEdit} size="sm" className="h-8" onClick={handleOpenAdd}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </PermissionGuardButton>
          </div>
        </div>
      </header>

      {/* ── Filter bar (PO style) ── */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-border bg-card/30">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9 h-8" />
        </div>
        {resolvedFilterCols.map((fc) => (
          <MultiSelectFilter key={fc.key} label={fc.label} options={distinctOptions[fc.key] || []} value={filters[fc.key] || []} isLoading={isFilterLoading(fc.key)} onOpen={() => markFilterOpened(fc.key)} onApply={(v) => { setFilters((p) => ({ ...p, [fc.key]: v })); setPage(0); }} />
        ))}
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => qc.invalidateQueries({ queryKey: [QUERY_KEY] })} title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => { setFilters({}); setPage(0); }}>
            Clear filters ({activeFilterCount})
          </Button>
        )}
        <span className="text-xs text-muted-foreground">{totalCount.toLocaleString()} records</span>
      </div>

      {/* GRID */}
      <div className="flex-1 min-h-0 relative overflow-auto border-t border-border" style={{ isolation: "isolate" }}>
        {isLoading || orderedCols.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading…</div>
        ) : (
          <table className="w-max min-w-full text-[12.5px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                {orderedCols.map((col) => {
                  const isActive = effectiveSortCol === col.column_name;
                  const label = VIEW_ONLY.find((v) => v.key === col.column_name)?.label ?? col.column_name;

                  return (
                     <th
                      key={col.column_name}
                      onClick={() => handleSort(col.column_name)}
                      className="app-th cursor-pointer"
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 60,
                      }}
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        {isActive &&
                          (effectiveSortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </span>
                    </th>
                  );
                })}
                <th
                  className="app-th"
                  style={{ position: "sticky", top: 0, right: 0, zIndex: 70, minWidth: 120 }}
                >
                  Action
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={orderedCols.length + 1} className="text-center py-16 text-muted-foreground text-sm">
                    No records found.
                  </td>
                </tr>
              ) : (
                rows.map((row, ri) => {
                  return (
                  <tr key={row[pkCol] ?? ri} className="hover:bg-[#3b5769]/20 dark:hover:bg-[#2a2a2a] transition-colors duration-75">
                    {orderedCols.map((col) => {
                      const raw = row[col.column_name];
                      const isNum = isNumericType(col.data_type);
                      const isLong = isLongText(col);
                      const isProductName = col.column_name === "product_name";

                      let cls = "app-td text-center";
                      if (isNum) cls += " tabular-nums whitespace-nowrap";
                      else if (isProductName) cls += " text-left whitespace-normal break-words max-w-[520px]";
                      else if (isLong) cls += " whitespace-normal break-words max-w-[520px]";
                      else cls += " whitespace-nowrap";

                      return (
                        <td
                          key={col.column_name}
                          className={cls}
                        >
                          {isProductName ? (
                            <div className="min-w-0">
                              <div className="font-medium truncate">{String(raw ?? "")}</div>
                            </div>
                          ) : (
                            formatCell(raw, col.data_type, col.column_name)
                          )}
                        </td>
                      );
                    })}
                    <td
                      className="app-td app-td-sticky text-center"
                      style={{ position: "sticky", right: 0, zIndex: 35, minWidth: 120 }}
                    >
                      <div className="flex items-center justify-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="app-action-trigger">
                              Action
                              <ChevronDown className="app-action-trigger-chevron" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => handleOpenEdit(row)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => { setDeleteRow(row); setDeleteOpen(true); }}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* PAGINATION */}
      <TablePagination
        currentPage={page + 1}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={totalCount}
        onPageChange={(p) => setPage(p - 1)}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
        pageSizeOptions={PAGE_SIZES}
      />

      {/* ADD RECORD DIALOG */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Record</DialogTitle>
            <DialogDescription>Insert a new inventory arrival record.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-2">
            {addFormCols
              .filter((c) => c.column_name !== pkCol)
              .map((col) => (
                <div key={col.column_name} className="space-y-1">
                  <Label className="text-xs">{col.column_name}</Label>
                  <Input
                    value={addValues[col.column_name] ?? ""}
                    onChange={(e) => setAddValues((p) => ({ ...p, [col.column_name]: e.target.value }))}
                  />
                </div>
              ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAdd} disabled={savingAdd}>
              {savingAdd ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* IMPORT DIALOG */}
      <Dialog
        open={importOpen}
        onOpenChange={(o) => {
          if (!o) {
            setImportOpen(false);
            setImportFile(null);
            setImportPreview(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import CSV</DialogTitle>
            <DialogDescription>Upload a CSV file to import records into {TABLE_NAME}.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Input
              type="file"
              accept=".csv"
              onChange={(e) => {
                setImportFile(e.target.files?.[0] || null);
                setImportPreview(null);
              }}
            />

            {importFile && !importPreview && (
              <Button onClick={handleImportFilePreview} variant="outline" size="sm">
                Preview
              </Button>
            )}

            {importPreview && (
              <div className="space-y-2">
                <p className="text-sm">
                  <strong>{importPreview.length}</strong> rows parsed.
                </p>
                <div className="max-h-[320px] overflow-auto border rounded text-xs">
                  <table className="min-w-full border-collapse">
                    <thead>
                      <tr>
                        {Object.keys(importPreview[0] || {}).map((k) => (
                          <th key={k} className="border border-border px-2 py-1 text-left font-medium bg-muted/50">
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.slice(0, 10).map((row, i) => (
                        <tr key={i}>
                          {Object.keys(importPreview[0] || {}).map((k) => (
                            <td key={k} className="border border-border px-2 py-0.5">
                              {row?.[k] === null || row?.[k] === undefined || row?.[k] === "" ? "—" : String(row[k])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Tip: CSV headers must match column names (e.g. <code>date_ordered</code>, <code>vendor_name</code>,
                  etc.).
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportOpen(false);
                setImportFile(null);
                setImportPreview(null);
              }}
            >
              Cancel
            </Button>
            {importPreview && (
              <Button onClick={handleCommitImport} disabled={importing}>
                {importing ? "Importing…" : `Import ${importPreview.length} rows`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EDIT RECORD DIALOG */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) { setEditOpen(false); setEditRow(null); } }}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Record</DialogTitle>
            <DialogDescription>Update the inventory arrival record.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-2">
            {addFormCols
              .filter((c) => c.column_name !== pkCol)
              .map((col) => (
                <div key={col.column_name} className="space-y-1">
                  <Label className="text-xs">{col.column_name}</Label>
                  <Input
                    value={editValues[col.column_name] ?? ""}
                    onChange={(e) => setEditValues((p) => ({ ...p, [col.column_name]: e.target.value }))}
                  />
                </div>
              ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); setEditRow(null); }}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION DIALOG */}
      <AlertDialog open={deleteOpen} onOpenChange={(o) => { if (!o) { setDeleteOpen(false); setDeleteRow(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Record</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this record? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteOpen(false); setDeleteRow(null); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deletingRow} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletingRow ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
