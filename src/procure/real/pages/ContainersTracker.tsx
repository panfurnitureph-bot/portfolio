import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";
import { useCascadingFilterOptions, FilterColumnDef } from "@/hooks/useCascadingFilters";
import {
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  RefreshCw,
  Pencil,
  Trash2,
  Upload,
  Download,
  Plus,
  Package,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { TablePagination } from "@/components/ui/table-pagination";

import {
  SchemaColumn,
  formatCellValue,
  isNumericType,
  isTextType,
  isBoolType,
  isDateType,
} from "@/hooks/usePredictiveSchema";
import { useProductNames } from "@/hooks/useProductNames";

import { DeleteRowDialog } from "@/components/predictive-purchasing/DeleteRowDialog";
import { CSVImportDialog } from "@/components/shared/CSVImportDialog";
import { buildSearchFilter } from "@/lib/searchUtils";
import { exportAllRows, buildExportColumns } from "@/lib/serverExport";
import { usePagePermission } from "@/hooks/usePagePermission";
import { PermissionGuardButton } from "@/components/shared/PermissionGuardButton";
import { useFactoryAccess } from "@/hooks/useFactoryAccess";

const TABLE_NAME = "container";
const QUERY_KEY = "container-product-list-view";
const PAGE_SIZES = [10, 25, 50, 100];

const HIDDEN_ALWAYS = ["id", "created_at"];
const FORCE_DATE_COLS = new Set<string>([]);

/* ── Filter columns we want multi-select dropdowns for ── */
const FILTER_COLUMNS = [
  { key: "container_id", label: "Container Id", candidates: ["container_id", "containerid", "container_no", "container_number"] },
  { key: "po_id", label: "PO ID", candidates: ["po_id", "poid", "po_number", "po_no", "purchase_order_id"] },
  { key: "container_name", label: "Container Name", candidates: ["container_name", "name", "container"] },
  { key: "invoice_number", label: "Invoice Number", candidates: ["invoice_number", "invoice_no", "invoice"] },
  { key: "product_id", label: "Product ID", candidates: ["product_id"] },
  { key: "receiving_warehouse", label: "Receiving Warehouse", candidates: ["receiving_warehouse", "warehouse", "warehouse_name", "receive_warehouse"] },
  { key: "qty", label: "Total Qty", candidates: ["qty", "quantity", "total_qty", "qty_total"] },
  { key: "qty_received", label: "Total Received", candidates: ["qty_received", "qty_recieved", "quantity_received", "total_received", "received_qty"] },
  { key: "vessel_number", label: "Vessel Number", candidates: ["vessel_number", "vessel_no", "vessel"] },
  { key: "status_filter", label: "Status", candidates: ["status"] },
] as const;

/* ── (MultiSelectFilter is now shared from @/components/shared/MultiSelectFilter) ── */

const normalizeCol = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

function colKeyLower(name: string) {
  return name.trim().toLowerCase();
}

function stripCommas(s: string) {
  return String(s ?? "").replace(/,/g, "");
}

const looksLikeISODate = (v: any) => {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return (
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|([+-]\d{2}:\d{2}))?)?$/.test(s) &&
    !Number.isNaN(new Date(s).getTime())
  );
};

const looksLikeUSDateTime = (v: any) => {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return /^\d{1,2}\/\d{1,2}\/\d{4}(\s+\d{1,2}:\d{2}:\d{2}\s*(AM|PM))?$/.test(s) && !Number.isNaN(new Date(s).getTime());
};

const prettyDate = (val: any) => {
  if (val === null || val === undefined || val === "") return "—";
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(d);
};

function formatCellSmart(value: any, dataType: string, columnName?: string) {
  if (value === null || value === undefined || value === "") return { display: "—", isLink: false };

  const colLower = (columnName || "").toLowerCase();

  if (FORCE_DATE_COLS.has(colLower)) {
    return { display: prettyDate(value), isLink: false };
  }

  if (isDateType(dataType) || looksLikeISODate(value) || looksLikeUSDateTime(value)) {
    return { display: prettyDate(value), isLink: false };
  }

  return formatCellValue(value, dataType);
}

const LONG_TEXT_HINTS = ["name", "notes", "comment", "remarks", "invoice", "vessel", "port", "warehouse"];
function isLongText(col: SchemaColumn) {
  const n = col.column_name.toLowerCase();
  return isTextType(col.data_type) && LONG_TEXT_HINTS.some((h) => n.includes(h));
}

function isRequired(col: SchemaColumn) {
  const anyCol = col as any;
  const isNullable = anyCol?.is_nullable;
  if (isNullable === "NO") return true;
  if (isNullable === false) return true;
  return false;
}

function hasDefault(col: SchemaColumn) {
  const anyCol = col as any;
  return !!(anyCol?.column_default ?? anyCol?.default_value);
}

type StatusValue = "Pending" | "Partial" | "Complete";
function computeStatus(qty: any, received: any): StatusValue {
  const q = Number(qty ?? 0);
  const r = Number(received ?? 0);

  if (!Number.isFinite(q) || q <= 0) return "Pending";
  if (!Number.isFinite(r) || r <= 0) return "Pending";
  if (r >= q) return "Complete";
  return "Partial";
}

type ColumnSpec = {
  key: string;
  label: string;
  candidates: string[];
};

const COLUMN_SPECS: ColumnSpec[] = [
  {
    key: "container_id",
    label: "Container Id",
    candidates: ["container_id", "containerid", "container_no", "container_number"],
  },
  { key: "po_id", label: "Po ID", candidates: ["po_id", "poid", "po_number", "po_no", "purchase_order_id"] },
  { key: "container_name", label: "Container Name", candidates: ["container_name", "name", "container"] },
  { key: "shipped_on", label: "Shipped On", candidates: ["shipped_on", "ship_date", "shipped_date"] },
  { key: "eta_port", label: "Eta Port", candidates: ["eta_port", "port_eta", "eta_port_name", "port"] },
  {
    key: "estimated_arrival_date",
    label: "Estimated Arrival Date",
    candidates: ["estimated_arrival_date", "eta", "arrival_date", "estimated_arrival"],
  },
  {
    key: "received_date",
    label: "Recieved Date",
    candidates: ["received_date", "recieved_date", "receive_date", "received_on"],
  },
  { key: "invoice_number", label: "Invoice Number", candidates: ["invoice_number", "invoice_no", "invoice"] },
  { key: "notes", label: "Notes", candidates: ["notes", "note", "remarks", "comment"] },
  {
    key: "product_id",
    label: " Product ID",
    candidates: ["product_id"],
  },
  {
    key: "receiving_warehouse",
    label: "Recieving Warehouse",
    candidates: ["receiving_warehouse", "warehouse", "warehouse_name", "receive_warehouse"],
  },
  { key: "qty", label: "Total Qty", candidates: ["qty", "quantity", "total_qty", "qty_total"] },
  {
    key: "qty_received",
    label: "Total Recievced",
    candidates: ["qty_received", "qty_recieved", "quantity_received", "total_received", "received_qty"],
  },
  { key: "vessel_number", label: "Vessel Number", candidates: ["vessel_number", "vessel_no", "vessel"] },
  { key: "total_cost", label: "Total Cost", candidates: ["total_cost", "cost_total", "total_amount", "amount_total"] },
];

function resolveVisibleSchema(allSchema: SchemaColumn[]) {
  const byNorm = new Map<string, SchemaColumn>();
  for (const c of allSchema) byNorm.set(normalizeCol(c.column_name), c);

  const resolved = COLUMN_SPECS.map((spec) => {
    for (const cand of spec.candidates) {
      const hit = byNorm.get(normalizeCol(cand));
      if (hit) return { spec, col: hit };
    }
    return { spec, col: null as SchemaColumn | null };
  }).filter((x) => x.col);

  return resolved as { spec: ColumnSpec; col: SchemaColumn }[];
}

function getLabelForColumn(colName: string, resolved: { spec: ColumnSpec; col: SchemaColumn }[]) {
  const norm = normalizeCol(colName);
  const hit = resolved.find((r) => normalizeCol(r.col.column_name) === norm);
  return hit ? hit.spec.label : colName;
}

function SchemaFormDialog({
  open,
  onOpenChange,
  row,
  schema,
  labelLookup,
  onSave,
  loading,
  title,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: Record<string, unknown> | null;
  schema: SchemaColumn[];
  labelLookup: (colName: string) => string;
  onSave: (data: Record<string, unknown>) => void;
  loading?: boolean;
  title: string;
}) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const idCol = schema.find((c) => c.column_name.toLowerCase() === "id");
  const needsManualIdOnInsert = !!idCol && isRequired(idCol) && !hasDefault(idCol);

  const editableSchema = useMemo(() => {
    const base = schema.filter((c) => !HIDDEN_ALWAYS.includes(c.column_name.toLowerCase()));
    return base.filter((c) => {
      const isId = c.column_name.toLowerCase() === "id";
      if (isId) return !row && needsManualIdOnInsert;
      return true;
    });
  }, [schema, row, needsManualIdOnInsert]);

  useEffect(() => {
    if (!open) return;

    if (row) {
      setFormData({ ...row });
      return;
    }

    const blank: Record<string, unknown> = {};
    for (const c of editableSchema) {
      if (isBoolType(c.data_type)) blank[c.column_name] = false;
      else if (isTextType(c.data_type)) blank[c.column_name] = "";
      else blank[c.column_name] = null;
    }
    setFormData(blank);
  }, [open, row, editableSchema]);

  const handleChange = (col: string, value: unknown) => setFormData((p) => ({ ...p, [col]: value }));

  const validateRequired = () => {
    const requiredCols = editableSchema.filter((c) => isRequired(c));
    for (const c of requiredCols) {
      const v = formData[c.column_name];
      const emptyText = isTextType(c.data_type) && (v === "" || v === null || v === undefined);
      const emptyOther = !isTextType(c.data_type) && (v === null || v === undefined);
      if (emptyText || emptyOther) {
        toast.error(`Required: ${labelLookup(c.column_name)}`);
        return false;
      }
    }
    return true;
  };

  const handleSubmit = () => {
    if (!validateRequired()) return;

    const payload: Record<string, unknown> = {};
    for (const c of editableSchema) {
      const v = formData[c.column_name];
      if (isTextType(c.data_type)) payload[c.column_name] = v === null || v === undefined ? "" : String(v);
      else payload[c.column_name] = v ?? null;
    }
    onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 pr-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 py-2">
            {editableSchema.map((col) => {
              const val = formData[col.column_name];
              const required = isRequired(col);

              if (isBoolType(col.data_type)) {
                return (
                  <div key={col.column_name} className="flex items-center justify-between col-span-1">
                    <Label className="text-xs">
                      {labelLookup(col.column_name)}
                      {required ? <span className="text-destructive"> *</span> : null}
                    </Label>
                    <Switch checked={!!val} onCheckedChange={(v) => handleChange(col.column_name, v)} />
                  </div>
                );
              }

              return (
                <div key={col.column_name} className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">
                    {labelLookup(col.column_name)}
                    {required ? <span className="text-destructive"> *</span> : null}
                  </Label>
                  <Input
                    type={isNumericType(col.data_type) ? "number" : isDateType(col.data_type) ? "date" : "text"}
                    value={val === null || val === undefined ? "" : String(val)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") {
                        handleChange(col.column_name, isTextType(col.data_type) ? "" : null);
                        return;
                      }
                      handleChange(col.column_name, isNumericType(col.data_type) ? Number(v) : v);
                    }}
                    className="h-8 text-sm"
                  />
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ViewCol = { kind: "db"; col: SchemaColumn; label: string } | { kind: "virtual"; key: "status"; label: string };

export default function ContainerProductListView() {
  const queryClient = useQueryClient();
  const { canEdit, guardEdit, guardDelete } = usePagePermission('container');
  const { allowedSkus, restricted: factoryRestricted, ready: accessReady } = useFactoryAccess();

  const { data: allSchema = [], isLoading: schemaLoading } = useQuery({
    queryKey: ["container-schema"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_table_columns", {
        p_schema: "public",
        p_table: TABLE_NAME,
      });
      if (error) throw error;
      const cols = (data as SchemaColumn[]) ?? [];
      return cols.sort((a, b) => a.ordinal_position - b.ordinal_position);
    },
    staleTime: 5 * 60 * 1000,
  });

  /* ── Resolve filter column real names from schema ── */
  const resolvedFilterCols = useMemo(() => {
    if (!allSchema.length) return [];
    const schemaByNorm = new Map<string, string>();
    for (const c of allSchema) schemaByNorm.set(normalizeCol(c.column_name), c.column_name);

    return FILTER_COLUMNS.map((fc) => {
      for (const cand of fc.candidates) {
        const real = schemaByNorm.get(normalizeCol(cand));
        if (real) return { key: fc.key, label: fc.label, colName: real };
      }
      return null;
    }).filter(Boolean) as { key: string; label: string; colName: string }[];
  }, [allSchema]);

  /* ── Fetch ALL rows (filter cols only) for cascading filter options ── */
  const { data: allFilterRows = [] } = useQuery({
    queryKey: [QUERY_KEY, "filter-rows"],
    queryFn: async () => {
      let allRows: Record<string, unknown>[] = [];
      let offset = 0;
      const batchSize = 1000;
      const selectCols = resolvedFilterCols.map((fc) => fc.colName).join(",");

      while (true) {
        const { data, error } = await supabase
          .from(TABLE_NAME)
          .select(selectCols)
          .range(offset, offset + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows = allRows.concat(data as Record<string, unknown>[]);
        if (data.length < batchSize) break;
        offset += batchSize;
      }

      return allRows;
    },
    enabled: resolvedFilterCols.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });


  const resolved = useMemo(() => (allSchema.length ? resolveVisibleSchema(allSchema) : []), [allSchema]);

  const visibleSchema = useMemo(() => {
    const cols = resolved.map((r) => r.col);
    return cols.filter((c) => !HIDDEN_ALWAYS.includes(c.column_name.toLowerCase()));
  }, [resolved]);

  const labelLookup = useCallback((colName: string) => getLabelForColumn(colName, resolved), [resolved]);

  const qtyColName = useMemo(() => resolved.find((r) => r.spec.key === "qty")?.col.column_name || "qty", [resolved]);
  const qtyReceivedColName = useMemo(
    () => resolved.find((r) => r.spec.key === "qty_received")?.col.column_name || "qty_received",
    [resolved],
  );

  const viewColumns: ViewCol[] = useMemo(() => {
    const dbCols: ViewCol[] = visibleSchema.map((c) => ({
      kind: "db",
      col: c,
      label: labelLookup(c.column_name),
    }));
    return [...dbCols, { kind: "virtual", key: "status", label: "Status" }];
  }, [visibleSchema, labelLookup]);

  const [searchQuery, setSearchQuery] = usePersistedState("container:search", "");
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  const [currentPage, setCurrentPage] = usePersistedState("container:page", 1);
  const [pageSize, setPageSize] = usePersistedState("container:pageSize", 50);
  const [sortColumn, setSortColumn] = usePersistedState("container:sortCol", "");
  const [sortDirection, setSortDirection] = usePersistedState<"asc" | "desc">("container:sortDir", "desc");
  const [filters, setFilters] = usePersistedState<Record<string, string[]>>("container:filters", {});

  /* ── Cascading filter options ── */
  const cascadingFilterDefs: FilterColumnDef[] = useMemo(
    () => resolvedFilterCols.map((fc) => ({ key: fc.key, colName: fc.colName, label: fc.label })),
    [resolvedFilterCols],
  );
  const distinctOptions = useCascadingFilterOptions(allFilterRows, cascadingFilterDefs, filters);

  /* ── Helper: apply active filters to a query ── */
  const applyFiltersToQuery = useCallback((q: any) => {
    for (const fc of resolvedFilterCols) {
      const selected = filters[fc.key];
      if (selected && selected.length > 0) {
        q = q.in(fc.colName, selected);
      }
    }
    return q;
  }, [resolvedFilterCols, filters]);

  const activeFilterCount = useMemo(() => {
    return Object.values(filters).filter((v) => v && v.length > 0).length;
  }, [filters]);

  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);

  const [deleteRow, setDeleteRow] = useState<Record<string, unknown> | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (!visibleSchema.length || sortColumn) return;
    const names = new Set(visibleSchema.map((c) => colKeyLower(c.column_name)));
    const preferred = ["po_id", "shipped_on", "estimated_arrival_date", "received_date", "eta_port", "container_id"];
    const pick = preferred.find((c) => names.has(c)) || visibleSchema[0].column_name;
    setSortColumn(pick);
    setSortDirection("desc");
  }, [visibleSchema]);

  const {
    data: queryResult,
    isLoading: dataLoading,
    error,
  } = useQuery({
    queryKey: [
      QUERY_KEY,
      currentPage,
      pageSize,
      debouncedSearch,
      sortColumn,
      sortDirection,
      qtyColName,
      qtyReceivedColName,
      filters,
      factoryRestricted,
      allowedSkus,
    ],
    queryFn: async () => {
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;

      let query: any = supabase.from(TABLE_NAME).select("*", { count: "exact" });

      const orFilter = buildSearchFilter(allSchema, debouncedSearch);
      if (orFilter) query = query.or(orFilter);

      query = applyFiltersToQuery(query);

      if (factoryRestricted) query = query.in("product_id", allowedSkus ?? []);

      if (sortColumn) query = query.order(sortColumn, { ascending: sortDirection === "asc" });

      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      return {
        items: (data || []) as Record<string, unknown>[],
        totalCount: count ?? 0,
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: allSchema.length > 0 && visibleSchema.length > 0 && !!sortColumn,
  });

  const items = queryResult?.items ?? [];
  const totalCount = queryResult?.totalCount ?? 0;
  const { data: productNames } = useProductNames(items.map((r: any) => String(r.product_id ?? "")));
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  useEffect(() => {
    const channel = supabase
      .channel("container_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_NAME }, () =>
        queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const handleSort = useCallback(
    (col: string) => {
      if (sortColumn === col) setSortDirection((p) => (p === "asc" ? "desc" : "asc"));
      else {
        setSortColumn(col);
        setSortDirection("asc");
      }
      setCurrentPage(1);
    },
    [sortColumn],
  );

  const handleSaveEdit = async (updates: Record<string, unknown>) => {
    if (!editRow) return;
    const pk = (editRow as any).id;
    if (pk === null || pk === undefined) {
      toast.error("Cannot update: missing primary key (id).");
      return;
    }

    setEditLoading(true);
    try {
      const { data, error } = await supabase.from(TABLE_NAME).update(updates).eq("id", pk).select("*");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("No rows updated — check RLS policies or primary key.");
      toast.success("Row updated");
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    } catch (e: any) {
      toast.error("Update failed: " + e.message);
    } finally {
      setEditLoading(false);
    }
  };

  const handleSaveAdd = async (payload: Record<string, unknown>) => {
    setAddLoading(true);
    try {
      const { data, error } = await supabase.from(TABLE_NAME).insert([payload]).select("*");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Insert failed — no rows returned.");
      toast.success("Row added");
      setAddOpen(false);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    } catch (e: any) {
      toast.error("Add failed: " + e.message);
    } finally {
      setAddLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteRow) return;
    const pk = (deleteRow as any).id;
    if (pk === null || pk === undefined) {
      toast.error("Cannot delete: missing primary key (id).");
      return;
    }

    setDeleteLoading(true);
    try {
      const { data, error } = await supabase.from(TABLE_NAME).delete().eq("id", pk).select("*");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("No rows deleted — check RLS policies or primary key.");
      toast.success("Row deleted");
      setDeleteOpen(false);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    } catch (e: any) {
      toast.error("Delete failed: " + e.message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleExport = async () => {
    if (!allSchema.length) return;
    setExporting(true);
    setExportProgress(0);
    try {
      const visibleSet = new Set(visibleSchema.map((c) => normalizeCol(c.column_name)));
      const hiddenCols = allSchema
        .filter((c) => {
          const n = normalizeCol(c.column_name);
          if (HIDDEN_ALWAYS.includes(c.column_name.toLowerCase())) return true;
          return !visibleSet.has(n);
        })
        .map((c) => c.column_name);

      const columns = buildExportColumns(allSchema, hiddenCols);

      const count = await exportAllRows({
        supabaseClient: supabase,
        tableName: TABLE_NAME,
        columns,
        buildQuery: (q: any) => {
          const orFilter = buildSearchFilter(allSchema, debouncedSearch);
          if (orFilter) q = q.or(orFilter);
          q = applyFiltersToQuery(q);
          if (factoryRestricted) q = q.in("product_id", allowedSkus ?? []);
          if (sortColumn) q = q.order(sortColumn, { ascending: sortDirection === "asc" });
          return q;
        },
        filename: "container_list_view",
        onProgress: setExportProgress,
      });

      toast.success(`Exported ${count} rows`);
    } catch (e: any) {
      toast.error("Export failed: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (data: Record<string, unknown>[]) => {
    if (!allSchema.length) return;

    const schemaLower = new Map(allSchema.map((c) => [colKeyLower(c.column_name), c] as const));
    const allowedLower = new Set(visibleSchema.map((c) => colKeyLower(c.column_name)));

    const mapped = data.map((row) => {
      const out: Record<string, unknown> = {};
      for (const rk of Object.keys(row)) {
        const kLower = colKeyLower(rk);
        if (!allowedLower.has(kLower)) continue;

        const schemaCol = schemaLower.get(kLower);
        if (!schemaCol) continue;

        const raw = (row as any)[rk];
        if (raw === undefined) continue;

        if (isBoolType(schemaCol.data_type)) out[schemaCol.column_name] = String(raw).toLowerCase() === "true";
        else if (isNumericType(schemaCol.data_type))
          out[schemaCol.column_name] = raw === "" || raw === null ? null : Number(raw);
        else if (isTextType(schemaCol.data_type))
          out[schemaCol.column_name] = raw === null || raw === undefined ? "" : String(raw);
        else out[schemaCol.column_name] = raw === "" ? null : raw;
      }
      return out;
    });

    const BATCH = 200;
    for (let i = 0; i < mapped.length; i += BATCH) {
      const batch = mapped.slice(i, i + BATCH);
      const { error } = await supabase.from(TABLE_NAME).insert(batch);
      if (error) throw error;
    }

    queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    toast.success(`Imported ${mapped.length} rows`);
  };

  const isLoading = schemaLoading || dataLoading || !accessReady;
  const stickyBg = "hsl(var(--table-row))";
  const expectedColumns = useMemo(() => visibleSchema.map((c) => c.column_name), [visibleSchema]);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden min-h-0" style={{ maxWidth: "none" }}>
      <header className="h-14 shrink-0 border-b border-border bg-gradient-to-r from-primary/5 to-background">
        <div className="h-full px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Package className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-foreground leading-tight truncate">Shipping Container</h1>
                <p className="text-[11px] text-muted-foreground truncate">Track all shipping containers</p>
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
            <PermissionGuardButton canEdit={canEdit} size="sm" className="h-8" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </PermissionGuardButton>
          </div>
        </div>
      </header>

      {/* ── Filter bar (same style as Purchase Order) ── */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-border bg-card/30">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="pl-9 h-8"
          />
        </div>

        {resolvedFilterCols.map((fc) => (
          <MultiSelectFilter
            key={fc.key}
            label={fc.label}
            options={distinctOptions[fc.key] || []}
            value={filters[fc.key] || []}
            onApply={(v) => {
              setFilters((prev) => ({ ...prev, [fc.key]: v }));
              setCurrentPage(1);
            }}
          />
        ))}

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] })}
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => {
              setFilters({});
              setSearchQuery("");
              setCurrentPage(1);
            }}
          >
            Clear filters ({activeFilterCount})
          </Button>
        )}

        <span className="text-xs text-muted-foreground">{totalCount.toLocaleString()} records</span>
      </div>

      <div className="flex-1 min-h-0 border-t border-border relative overflow-auto" style={{ isolation: "isolate" }}>
        <div className="min-w-max">
          <table className="w-full text-[12px] leading-tight border-separate border-spacing-0">
            <thead>
              <tr>
                {viewColumns.map((vc) => {
                  const isSortable = vc.kind === "db";
                  const colName = vc.kind === "db" ? vc.col.column_name : "__status__";
                  const isProductIdCol = vc.kind === "db" && vc.col.column_name === "product_id";

                  return (
                    <React.Fragment key={colName}>
                    <th
                      onClick={() => {
                        if (!isSortable) return;
                        handleSort(colName);
                      }}
                      className={["app-th", isSortable ? "cursor-pointer" : "cursor-default"].join(" ")}
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 60,
                      }}
                    >
                      <span className="inline-flex items-center justify-center gap-0.5">
                        {vc.label}
                        {vc.kind === "db" ? (
                          sortColumn === vc.col.column_name ? (
                            sortDirection === "asc" ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-30" />
                          )
                        ) : null}
                      </span>
                    </th>
                    {isProductIdCol && (
                      <th
                        key="__product_name__"
                        className="app-th"
                        style={{
                          position: "sticky",
                          top: 0,
                          zIndex: 60,
                        }}
                      >
                        Product Name
                      </th>
                    )}
                    </React.Fragment>
                  );
                })}

                <th
                  className="app-th w-[120px]"
                  style={{
                    position: "sticky",
                    top: 0,
                    right: 0,
                    zIndex: 80,
                  }}
                >
                  Action
                </th>
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: Math.max(viewColumns.length, 6) + 2 }).map((__, j) => (
                      <td key={j} className="app-td">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td
                    colSpan={(viewColumns.length || 6) + 2}
                    className="app-td text-center text-destructive"
                  >
                    Error: {(error as Error).message}
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={(viewColumns.length || 6) + 2}
                    className="app-td text-center text-muted-foreground"
                  >
                    No records found.
                  </td>
                </tr>
              ) : (
                items.map((row, idx) => {
                  const rowProductId = String((row as any).product_id ?? "");
                  const rowProductName = productNames?.[rowProductId]?.name || "";
                  return (
                  <tr key={((row as any).id as any) ?? idx} className="hover:bg-[#3b5769]/20 dark:hover:bg-[#2a2a2a] transition-colors duration-75">
                    {viewColumns.map((vc) => {
                      const baseCls = "app-td text-center";

                      if (vc.kind === "virtual" && vc.key === "status") {
                        const qty = (row as any)[qtyColName];
                        const received = (row as any)[qtyReceivedColName];
                        const status = computeStatus(qty, received);

                        const badgeClass =
                          status === "Complete"
                            ? "bg-emerald-600 text-white border-emerald-600"
                            : status === "Partial"
                              ? "bg-amber-600 text-white border-amber-600"
                              : "bg-blue-600 text-white border-blue-600";

                        return (
                          <td key="__status__" className={baseCls}>
                            <Badge className={`text-[10px] px-2 py-0.5 rounded-full border ${badgeClass}`}>
                              {status}
                            </Badge>
                          </td>
                        );
                      }

                      if (vc.kind !== "db") return null;

                      const col = vc.col;
                      const isNum = isNumericType(col.data_type);
                      const isLong = isLongText(col);
                      const isProductId = col.column_name === "product_id";

                      const { display, isLink } = formatCellSmart(
                        (row as any)[col.column_name],
                        col.data_type,
                        col.column_name,
                      );
                      const cleanDisplay = isNum ? stripCommas(display) : display;

                      let cls = baseCls;
                      if (isProductId) cls += " text-left font-mono text-[12px]";
                      else if (isNum) cls += " tabular-nums";
                      else if (isLong) cls += " whitespace-normal break-words max-w-[420px]";
                      else cls += " whitespace-nowrap";

                      return (
                        <React.Fragment key={col.column_name}>
                        <td
                          className={cls}
                          title={cleanDisplay !== "—" ? cleanDisplay : undefined}
                        >
                          {isProductId ? (
                            rowProductId ? <span>{rowProductId}</span> : <span className="text-muted-foreground">—</span>
                          ) : cleanDisplay === "—" ? (
                            <span className="text-muted-foreground">—</span>
                          ) : isLink ? (
                            <a
                              href={cleanDisplay}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline break-all block"
                            >
                              {cleanDisplay}
                            </a>
                          ) : (
                            cleanDisplay
                          )}
                        </td>
                        {isProductId && (
                          <td
                            key="__product_name__"
                            className="app-td text-center whitespace-normal break-words"
                            style={{ maxWidth: 420 }}
                          >
                            {rowProductName ? (
                              <span className="font-medium">{rowProductName}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        )}
                        </React.Fragment>
                      );
                    })}

                    <td
                      className="app-td app-td-sticky text-center w-[120px]"
                      style={{ position: "sticky", right: 0, zIndex: 35 }}
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
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditRow(row);
                                setEditOpen(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => {
                                setDeleteRow(row);
                                setDeleteOpen(true);
                              }}
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
        </div>
      </div>

      <TablePagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={totalCount}
        onPageChange={setCurrentPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setCurrentPage(1);
        }}
        pageSizeOptions={PAGE_SIZES}
      />

      <SchemaFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        row={editRow}
        schema={visibleSchema}
        labelLookup={labelLookup}
        onSave={handleSaveEdit}
        loading={editLoading}
        title="Edit Row"
      />

      <SchemaFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        row={null}
        schema={visibleSchema}
        labelLookup={labelLookup}
        onSave={handleSaveAdd}
        loading={addLoading}
        title="Add Row"
      />

      <DeleteRowDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleConfirmDelete}
        loading={deleteLoading}
      />

      <CSVImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={handleImport}
        expectedColumns={expectedColumns}
        title="Import Container List"
      />
    </div>
  );
}
