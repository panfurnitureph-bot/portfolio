import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { externalSupabase } from "@/integrations/supabase/externalClient";
import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";
import { useLazyFilterOptions } from "@/hooks/useLazyFilterOptions";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { Search, Download, Upload, Plus, Pencil, Trash2, ChevronUp, ChevronDown, ChevronRight, RefreshCw, AlertTriangle } from "lucide-react";
import {
  GroupMenu, SortMenu, CrdWeekFilter, EMPTY_CRD_FILTER,
  crdFilterRanges, crdFilterActive, weekKeyOf, weekKeyLabel,
  type SortRule, type CrdFilter, type FieldOption,
} from "@/components/shared/PoViewControls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buildSearchFilter } from "@/lib/searchUtils";
import { exportAllRows, buildExportColumns } from "@/lib/serverExport";
import { TablePagination } from "@/components/ui/table-pagination";
import { usePagePermission } from "@/hooks/usePagePermission";
import { PermissionGuardButton } from "@/components/shared/PermissionGuardButton";
import { useFactoryAccess } from "@/hooks/useFactoryAccess";

// Source repointed to public.forecast_purchase_orders — the nightly n8n-fed
// PO-line snapshot (one row per PO line, po_line_id PK; many lines / POs).
// READ path only changed; layout, grouping and CRD Week stay as-is.
const TABLE_NAME = "forecast_purchase_orders";
const QUERY_KEY = "po_received";
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const EXCLUDED_SEARCH_COLUMNS = new Set(["status"]);

/* ── Filter columns mapped to the exact visible table fields ── */
const FILTER_COLUMNS = [
  { key: "vendor", label: "Vendor" },
  { key: "po_number", label: "PO Number" },
  { key: "product_id", label: "Product ID" },
  // The page exists to answer "what is arriving and when" — delivery_status
  // (Received / Partial / Overdue / Open) is the fastest route to that.
  { key: "status", label: "Status", column: "delivery_status" },
  { key: "expected_delivery", label: "Expected Delivery" },
  { key: "received_date", label: "Received Date" },
  { key: "qty_ordered", label: "Quantity Ordered" },
  { key: "qty_received", label: "Quantity Received" },
] as const;

/* ── (MultiSelectFilter is now shared from @/components/shared/MultiSelectFilter) ── */

type SchemaCol = { column_name: string; data_type: string; ordinal_position: number };

const normalizeCol = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const prettify = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const isNumericType = (dt: string) => /int|float|double|numeric|decimal|real|money/i.test(String(dt));
const isBoolType = (dt: string) => /bool/i.test(String(dt));
const isDateType = (dt: string) => /(date|time|timestamp)/i.test(String(dt));

const looksLikeISODate = (v: any) => {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return (
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|([+-]\d{2}:\d{2}))?)?$/.test(s) &&
    !Number.isNaN(new Date(s).getTime())
  );
};

const prettyDate = (val: any) => {
  if (val === null || val === undefined || val === "") return "—";
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  // Pre-1990 = zeroed-datetime sentinel from the source (1900-01-01 /
  // 2001-01-01-style), not a real date. The loader scrubs them to NULL, but
  // any survivor renders as "—" instead of poisoning earliest-arrival sorts.
  if (d.getFullYear() < 1990) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(d);
};

/** "Updated 3h ago" — freshness line from max(pulled_at). */
const timeAgo = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const formatCell = (val: any, dt: string) => {
  if (val === null || val === undefined) return "—";
  if (isBoolType(dt)) return val ? "Yes" : "No";
  if (isDateType(dt) || looksLikeISODate(val)) return prettyDate(val);

  if (typeof val === "string" && /^https?:\/\//.test(val)) {
    return (
      <a
        href={val}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline truncate max-w-[200px] inline-block"
      >
        {val}
      </a>
    );
  }

  return String(val);
};

type ColumnSpec = {
  key: string;
  label: string;
  candidates: string[];
};

const COLUMN_SPECS: ColumnSpec[] = [
  { key: "vendor", label: "Vendor", candidates: ["vendor", "vendor_name", "supplier", "supplier_name"] },
  { key: "po_number", label: "PO Number", candidates: ["po_number", "po_no", "po", "purchase_order_number"] },
  {
    key: "product_id",
    label: "Product ID",
    candidates: ["product_id", "product_master_sku", "sku", "vendor_sku", "asin", "upc"],
  },
  { key: "product_name", label: "Product Name", candidates: ["item_name", "product_name", "name", "description"] },
  {
    key: "unit_cost",
    label: "Unit Cost",
    candidates: ["unit_cost", "cost", "unit_price", "adjusted_unit_price", "price"],
  },
  { key: "requested_on", label: "Requested On", candidates: ["requested_on", "request_date", "requested_date"] },
  {
    key: "expected_delivery",
    label: "Expected Delivery",
    candidates: ["expected_delivery", "expected_date", "expected_delivery_date", "eta"],
  },
  {
    key: "received_date",
    label: "Received Date",
    candidates: ["received_date", "recieved_date", "line_item_received_date", "received_on"],
  },
  {
    key: "qty_ordered",
    label: "Quantity Ordered",
    candidates: ["quantity_ordered", "qty_ordered", "ordered_qty", "qty", "quantity"],
  },
  {
    key: "qty_received",
    label: "Quantity Recieved",
    candidates: ["quantity_received", "quantity_recieved", "qty_received", "received_qty"],
  },
];

const ALWAYS_HIDE_RAW = ["created_at", "updated_at", "refreshed_at", "Pk"];
const ALWAYS_HIDE_SET = new Set(ALWAYS_HIDE_RAW.map(normalizeCol));

function resolveVisibleColumns(schema: SchemaCol[]) {
  const schemaByNorm = new Map<string, SchemaCol>();
  for (const c of schema) schemaByNorm.set(normalizeCol(c.column_name), c);

  const resolved = COLUMN_SPECS.map((spec) => {
    for (const cand of spec.candidates) {
      const hit = schemaByNorm.get(normalizeCol(cand));
      if (hit) return { spec, col: hit };
    }
    return { spec, col: null as SchemaCol | null };
  }).filter((x) => x.col);

  return resolved as { spec: ColumnSpec; col: SchemaCol }[];
}

function displayLabel(colName: string, resolved: { spec: ColumnSpec; col: SchemaCol }[]) {
  const norm = normalizeCol(colName);
  const hit = resolved.find((r) => normalizeCol(r.col.column_name) === norm);
  return hit ? hit.spec.label : prettify(colName);
}

const toNum = (v: any) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const computeStatus = (orderedRaw: any, receivedRaw: any) => {
  const ordered = toNum(orderedRaw);
  const received = toNum(receivedRaw);

  if (ordered <= 0) return "—";
  if (received <= 0) return "Pending";
  if (received < ordered) return "Partial";
  return "Complete";
};

export default function PurchaseOrderReceived() {
  const qc = useQueryClient();
  const { canEdit, guardEdit, guardDelete } = usePagePermission('po_export');
  const { allowedSkus, restricted: factoryRestricted, ready: accessReady } = useFactoryAccess();

  const [currentPage, setCurrentPage] = usePersistedState("po-fr:page", 1);
  const [pageSize, setPageSize] = usePersistedState("po-fr:pageSize", DEFAULT_PAGE_SIZE);
  const [search, setSearch] = usePersistedState("po-fr:search", "");
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  const [filters, setFilters] = usePersistedState<Record<string, string[]>>("po-fr:filters", {});

  // Airtable-style view state — multi-column sort, group-by, CRD week filter.
  const [sortRules, setSortRules] = usePersistedState<SortRule[]>("po-fr:sortRules", []);
  const [groupBy, setGroupBy] = usePersistedState<string | null>("po-fr:groupBy", null);
  const [crdFilter, setCrdFilter] = usePersistedState<CrdFilter>("po-fr:crdFilter", EMPTY_CRD_FILTER);
  // Collapsed group keys — session-only, resets on refresh.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [editRow, setEditRow] = useState<any>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<Record<string, any>>({});
  const [deleteRow, setDeleteRow] = useState<any>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importData, setImportData] = useState<any[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: schema, isLoading: schemaLoading } = useQuery({
    queryKey: [QUERY_KEY, "schema"],
    queryFn: async () => {
      const { data, error } = await externalSupabase.rpc("get_table_columns", {
        p_schema: "public",
        p_table: TABLE_NAME,
      });
      if (error) throw error;
      return (data as SchemaCol[]) || [];
    },
    staleTime: Infinity,
  });

  const resolvedCols = useMemo(() => (schema ? resolveVisibleColumns(schema) : []), [schema]);
  const visibleCols = useMemo(() => resolvedCols.map((r) => r.col), [resolvedCols]);
  const searchableSchema = useMemo(
    () => (schema || []).filter((c) => !EXCLUDED_SEARCH_COLUMNS.has(normalizeCol(c.column_name))),
    [schema],
  );

  /* ── Resolve filter column real names from schema ── */
  const resolvedFilterCols = useMemo(() => {
    if (!schema?.length) return [];
    const schemaSet = new Set(schema.map((c) => c.column_name));

    return FILTER_COLUMNS.map((fc) => {
      const mappedCol =
        (fc as { column?: string }).column ??
        resolvedCols.find((r) => r.spec.key === fc.key)?.col.column_name;

      if (!mappedCol || !schemaSet.has(mappedCol)) return null;
      return { key: fc.key, label: fc.label, colName: mappedCol };
    }).filter(Boolean) as { key: string; label: string; colName: string }[];
  }, [schema, resolvedCols]);

  /* ── Lazy filter options (backend-driven, on-demand) ── */
  const { optionsMap: distinctOptions, markOpened: markFilterOpened, isLoadingFor: isFilterLoading } = useLazyFilterOptions(
    TABLE_NAME,
    QUERY_KEY,
    resolvedFilterCols,
    filters,
  );

  const qtyOrderedCol = useMemo(
    () => resolvedCols.find((r) => r.spec.key === "qty_ordered")?.col.column_name,
    [resolvedCols],
  );
  const qtyReceivedCol = useMemo(
    () => resolvedCols.find((r) => r.spec.key === "qty_received")?.col.column_name,
    [resolvedCols],
  );

  const pkCol = useMemo(() => {
    const cols = (schema || []).map((c) => c.column_name);
    if (cols.includes("row_id")) return "row_id";
    if (cols.includes("id")) return "id";
    return cols[0] || "id";
  }, [schema]);

  /** The CRD field — this table's expected_delivery column. */
  const crdCol = useMemo(
    () => resolvedCols.find((r) => r.spec.key === "expected_delivery")?.col.column_name,
    [resolvedCols],
  );

  /** Fallback sort keeps pagination stable when the user has no sort rules. */
  const defaultSortRules = useMemo<SortRule[]>(() => {
    if (!schema?.length) return [];
    const all = schema.map((c) => c.column_name);
    if (all.includes("po_number"))  return [{ col: "po_number",  asc: false }];
    if (all.includes("updated_at")) return [{ col: "updated_at", asc: false }];
    if (all.includes("created_at")) return [{ col: "created_at", asc: false }];
    return visibleCols[0] ? [{ col: visibleCols[0].column_name, asc: true }] : [];
  }, [schema, visibleCols]);

  const effectiveSortRules = sortRules.length ? sortRules : defaultSortRules;
  // Primary rule drives the header chevron (legacy single-sort affordance).
  const sortCol = effectiveSortRules[0]?.col ?? null;
  const sortAsc = effectiveSortRules[0]?.asc ?? false;

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

  /* ── Helper: apply the CRD date/week filter (ISO yyyy-MM-dd text compares). ── */
  const applyCrdToQuery = useCallback((q: any) => {
    if (!crdCol) return q;
    const ranges = crdFilterRanges(crdFilter);
    if (!ranges.length) return q;
    if (ranges.length === 1) return q.gte(crdCol, ranges[0].from).lte(crdCol, ranges[0].to);
    // Multiple week ranges — OR of AND pairs; separate `or` params AND with the rest.
    return q.or(ranges.map((r) => `and(${crdCol}.gte.${r.from},${crdCol}.lte.${r.to})`).join(","));
  }, [crdCol, crdFilter]);

  /* ── Helper: apply every sort rule in priority order. NULLs always sort
     LAST — a sort on expected_delivery that floats every date-less row to
     the top buries what the user came for. ── */
  const applySortToQuery = useCallback((q: any) => {
    for (const r of effectiveSortRules) q = q.order(r.col, { ascending: r.asc, nullsFirst: false });
    return q;
  }, [effectiveSortRules]);

  const activeFilterCount = useMemo(() => {
    return (
      Object.values(filters).filter((v) => v && v.length > 0).length +
      (crdFilterActive(crdFilter) ? 1 : 0)
    );
  }, [filters, crdFilter]);

  // Grouping needs the whole filtered set client-side; cap it so an unfiltered
  // 33k-row group view can't pull the entire table.
  const GROUP_FETCH_CAP = 5000;
  const GROUP_FETCH_CHUNK = 1000;

  const { data: rowsResult, isLoading: rowsLoading } = useQuery({
    queryKey: [QUERY_KEY, "rows", currentPage, pageSize, effectiveSortRules, debouncedSearch, filters, crdFilter, groupBy, factoryRestricted, allowedSkus],
    queryFn: async () => {
      const buildBase = () => {
        let q: any = externalSupabase.from(TABLE_NAME).select("*", { count: "exact" });
        const orFilter = buildSearchFilter(searchableSchema, debouncedSearch);
        if (orFilter) q = q.or(orFilter);
        q = applyFiltersToQuery(q);
        q = applyCrdToQuery(q);
        if (factoryRestricted) q = q.in("product_id", allowedSkus ?? []);
        // Grouping sorts by the group field first so fetched chunks arrive
        // contiguous; computed groups (CRD Week ≈ date, Status) map accordingly.
        if (groupBy) {
          const serverGroupCol = groupBy === "__crd_week" ? crdCol : groupBy === "__status" ? null : groupBy;
          if (serverGroupCol) q = q.order(serverGroupCol, { ascending: true });
        }
        q = applySortToQuery(q);
        return q;
      };

      if (!groupBy) {
        const from = (currentPage - 1) * pageSize;
        const { data, error, count } = await buildBase().range(from, from + pageSize - 1);
        if (error) throw error;
        return { rows: (data || []) as any[], count: count ?? 0, capped: false };
      }

      // Grouped view — page through the filtered set up to the cap.
      let all: any[] = [];
      let total = 0;
      for (let from = 0; from < GROUP_FETCH_CAP; from += GROUP_FETCH_CHUNK) {
        const { data, error, count } = await buildBase().range(from, Math.min(from + GROUP_FETCH_CHUNK, GROUP_FETCH_CAP) - 1);
        if (error) throw error;
        total = count ?? 0;
        all = all.concat(data || []);
        if (!data || data.length < GROUP_FETCH_CHUNK || all.length >= total) break;
      }
      return { rows: all, count: total, capped: total > all.length };
    },
    enabled: !!schema && effectiveSortRules.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const rows = rowsResult?.rows || [];
  const totalCount = rowsResult?.count || 0;

  // Freshness — internal tools were caught stale
  // with nothing on screen saying so; surface max(pulled_at) here.
  const { data: lastPulled } = useQuery({
    queryKey: [QUERY_KEY, "freshness"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await externalSupabase
        .from(TABLE_NAME).select("pulled_at").order("pulled_at", { ascending: false }).limit(1);
      return (data?.[0] as any)?.pulled_at ?? null;
    },
  });
  const groupCapped = rowsResult?.capped ?? false;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  /* ── Group sections (grouped view only) ── */
  const todayIso = new Date().toISOString().slice(0, 10);
  const groupSections = useMemo(() => {
    if (!groupBy) return null;

    const keyOf = (row: any): { key: string; label: string } => {
      if (groupBy === "__crd_week") {
        const v = crdCol ? row[crdCol] : null;
        if (!v || Number.isNaN(new Date(v).getTime())) return { key: "zz__none", label: "No CRD date" };
        const wk = weekKeyOf(new Date(v));
        return { key: wk, label: weekKeyLabel(wk) };
      }
      if (groupBy === "__status") {
        const s = computeStatus(qtyOrderedCol ? row[qtyOrderedCol] : null, qtyReceivedCol ? row[qtyReceivedCol] : null);
        return { key: s, label: s === "—" ? "No quantity" : s };
      }
      const v = row[groupBy];
      const s = v === null || v === undefined || v === "" ? "" : String(v);
      return s ? { key: s, label: s } : { key: "zz__none", label: "Empty" };
    };

    const map = new Map<string, { key: string; label: string; rows: any[]; overdue: number }>();
    for (const row of rows) {
      const { key, label } = keyOf(row);
      let g = map.get(key);
      if (!g) { g = { key, label, rows: [], overdue: 0 }; map.set(key, g); }
      g.rows.push(row);
      // Overdue = CRD before today and not fully received — the owner's "falling behind".
      const crdVal = crdCol ? row[crdCol] : null;
      const st = computeStatus(qtyOrderedCol ? row[qtyOrderedCol] : null, qtyReceivedCol ? row[qtyReceivedCol] : null);
      if (crdVal && String(crdVal) < todayIso && st !== "Complete") g.overdue++;
    }

    const order = ["Pending", "Partial", "Complete", "—"];
    return Array.from(map.values()).sort((a, b) => {
      if (groupBy === "__status") return order.indexOf(a.key) - order.indexOf(b.key);
      return a.key.localeCompare(b.key, undefined, { numeric: true });
    });
  }, [rows, groupBy, crdCol, qtyOrderedCol, qtyReceivedCol, todayIso]);

  useEffect(() => {
    const ch = externalSupabase
      .channel("po-received-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_NAME }, () => {
        qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      })
      .subscribe();

    return () => {
      externalSupabase.removeChannel(ch);
    };
  }, [qc]);

  /** Header click — set/toggle the PRIMARY sort, keeping secondary rules. */
  const handleSort = (col: string) => {
    setSortRules((prev) => {
      const rules = prev.length ? prev : defaultSortRules;
      if (rules[0]?.col === col) return [{ col, asc: !rules[0].asc }, ...rules.slice(1)];
      return [{ col, asc: true }, ...rules.filter((r) => r.col !== col)];
    });
    setCurrentPage(1);
  };

  const handleSaveEdit = async () => {
    if (!editRow) return;

    const payload: any = {};
    visibleCols.forEach((c) => {
      if (c.column_name !== pkCol) payload[c.column_name] = editForm[c.column_name] ?? null;
    });

    const { data, error } = await externalSupabase
      .from(TABLE_NAME)
      .update(payload)
      .eq(pkCol, editRow[pkCol])
      .select("*");

    if (error || !data?.length) {
      toast.error(error?.message || "No rows updated");
      return;
    }

    toast.success("Updated");
    setEditRow(null);
    qc.invalidateQueries({ queryKey: [QUERY_KEY] });
  };

  const handleSaveAdd = async () => {
    const payload: any = {};
    visibleCols.forEach((c) => {
      if (addForm[c.column_name] !== undefined && addForm[c.column_name] !== "") {
        payload[c.column_name] = addForm[c.column_name];
      }
    });

    const { data, error } = await externalSupabase.from(TABLE_NAME).insert(payload).select("*");

    if (error || !data?.length) {
      toast.error(error?.message || "Insert failed");
      return;
    }

    toast.success("Added");
    setAddOpen(false);
    setAddForm({});
    qc.invalidateQueries({ queryKey: [QUERY_KEY] });
  };

  const handleConfirmDelete = async () => {
    if (!deleteRow) return;

    const { data, error } = await externalSupabase.from(TABLE_NAME).delete().eq(pkCol, deleteRow[pkCol]).select("*");

    if (error || !data?.length) {
      toast.error(error?.message || "Delete failed");
      return;
    }

    toast.success("Deleted");
    setDeleteRow(null);
    qc.invalidateQueries({ queryKey: [QUERY_KEY] });
  };

  const handleExport = async () => {
    if (!schema) return;

    setExporting(true);
    setExportProgress(0);

    try {
      const visibleSet = new Set(visibleCols.map((c) => normalizeCol(c.column_name)));
      const hiddenExactNames = schema
        .map((c) => c.column_name)
        .filter((name) => {
          if (name.endsWith("_at")) return true;
          if (ALWAYS_HIDE_SET.has(normalizeCol(name))) return true;
          return !visibleSet.has(normalizeCol(name));
        });

      const columns = buildExportColumns(schema, hiddenExactNames);

      const count = await exportAllRows({
        supabaseClient: externalSupabase,
        tableName: TABLE_NAME,
        columns,
        buildQuery: (q: any) => {
          const orFilter = buildSearchFilter(searchableSchema, debouncedSearch);
          if (orFilter) q = q.or(orFilter);
          q = applyFiltersToQuery(q);
          q = applyCrdToQuery(q);
          if (factoryRestricted) q = q.in("product_id", allowedSkus ?? []);
          q = applySortToQuery(q);
          return q;
        },
        filename: "purchase_order_export",
        onProgress: setExportProgress,
      });

      toast.success(`Exported ${count} rows`);
    } catch (e: any) {
      toast.error("Export failed: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) || "";
      const lines = text.split("\n").filter((l) => l.trim());

      if (lines.length < 2) {
        toast.error("No data rows");
        return;
      }

      const headers = lines[0].split(",").map((h) => h.trim().replace(/^\"|\"$/g, ""));
      const colMap = headers.map((h) => {
        const normH = normalizeCol(h);
        const match = visibleCols.find((c) => normalizeCol(c.column_name) === normH);
        return match?.column_name || null;
      });

      const parsed = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/^\"|\"$/g, ""));
        const obj: any = {};
        colMap.forEach((col, i) => {
          if (col) obj[col] = vals[i] || null;
        });
        return obj;
      });

      setImportData(parsed);
      setImportOpen(true);
    };

    reader.readAsText(f);
    e.target.value = "";
  };

  const handleImportCommit = async () => {
    if (!importData?.length) return;

    const batchSize = 200;
    let success = 0;

    for (let i = 0; i < importData.length; i += batchSize) {
      const batch = importData.slice(i, i + batchSize);
      const { error } = await externalSupabase.from(TABLE_NAME).insert(batch);
      if (error) {
        toast.error(`Batch error: ${error.message}`);
        return;
      }
      success += batch.length;
    }

    toast.success(`Imported ${success} rows`);
    setImportOpen(false);
    setImportData(null);
    qc.invalidateQueries({ queryKey: [QUERY_KEY] });
  };

  const renderFormField = useCallback(
    (col: SchemaCol, form: Record<string, any>, setForm: (f: Record<string, any>) => void) => {
      const val = form[col.column_name] ?? "";
      const onChange = (v: any) => setForm({ ...form, [col.column_name]: v });

      if (isBoolType(col.data_type)) {
        return (
          <select
            value={val === true ? "true" : val === false ? "false" : ""}
            onChange={(e) => onChange(e.target.value === "true")}
            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
          >
            <option value="">—</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        );
      }

      if (isDateType(col.data_type)) {
        return <Input type="datetime-local" value={val} onChange={(e) => onChange(e.target.value)} />;
      }

      if (isNumericType(col.data_type)) {
        return (
          <Input
            type="number"
            step="any"
            value={val}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
        );
      }

      return <Input type="text" value={val} onChange={(e) => onChange(e.target.value)} />;
    },
    [],
  );

  const stickyBg = "hsl(var(--table-row))";
  const isLoading = schemaLoading || rowsLoading || !accessReady;

  /* ── Field lists for the Group / Sort menus ── */
  const fieldOptions: FieldOption[] = useMemo(
    () => visibleCols.map((c) => ({ value: c.column_name, label: displayLabel(c.column_name, resolvedCols) })),
    [visibleCols, resolvedCols],
  );
  const groupOptions: FieldOption[] = useMemo(
    () => [
      ...(crdCol ? [{ value: "__crd_week", label: "CRD Week" }] : []),
      { value: "__status", label: "Status" },
      ...fieldOptions,
    ],
    [crdCol, fieldOptions],
  );

  /** One data row — shared by the flat and grouped views. */
  const renderDataRow = (row: any, ri: number) => {
    const orderedVal = qtyOrderedCol ? row[qtyOrderedCol] : null;
    const receivedVal = qtyReceivedCol ? row[qtyReceivedCol] : null;
    const status = computeStatus(orderedVal, receivedVal);

    return (
      <tr key={row[pkCol] ?? ri} className="hover:bg-[#3b5769]/20 dark:hover:bg-[#2a2a2a] transition-colors duration-75">
        {visibleCols.map((col) => {
          const val = row[col.column_name];
          const isNum = isNumericType(col.data_type);
          const isLong = typeof val === "string" && val.length > 40;

          const isProductName = col.column_name === "product_name";

        return (
            <td
              key={col.column_name}
              className={`app-td text-center ${
                isNum ? "tabular-nums" : ""
              } ${isLong ? "whitespace-normal break-words max-w-[420px]" : "whitespace-nowrap"}`}
            >
              {isProductName ? (
                (() => {
                  const fullName = String(val || "");
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
                  return (
                    <div className="min-w-0 text-center">
                      <div className="font-medium truncate">{mainName || fullName || "-"}</div>
                      {variant && (
                        <div className="text-[11px] text-muted-foreground truncate">{variant}</div>
                      )}
                    </div>
                  );
                })()
              ) : isBoolType(col.data_type) && val !== null && val !== undefined ? (
                <Badge variant={val ? "default" : "secondary"} className="text-[10px]">
                  {val ? "Yes" : "No"}
                </Badge>
              ) : (
                formatCell(val, col.data_type)
              )}
            </td>
          );
        })}

        <td className="app-td text-center whitespace-nowrap">
          {status === "Pending" ? (
            <Badge className="text-[10px] bg-blue-600 text-white border-blue-600 hover:bg-blue-700">
              Pending
            </Badge>
          ) : status === "Partial" ? (
            <Badge className="text-[10px] bg-amber-600 text-white border-amber-600 hover:bg-amber-700">
              Partial
            </Badge>
          ) : status === "Complete" ? (
            <Badge className="text-[10px] bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700">
              Complete
            </Badge>
          ) : (
            "—"
          )}
        </td>

        <td className="app-td text-center whitespace-nowrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="app-action-trigger">
                Action
                <ChevronDown className="app-action-trigger-chevron" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => { setEditRow(row); setEditForm({ ...row }); }}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteRow(row)}>
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden min-h-0">
      <header className="h-14 shrink-0 border-b border-border bg-gradient-to-r from-primary/5 to-background">
        <div className="h-full px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Search className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-foreground leading-tight truncate">Purchase Order</h1>
                <p className="text-[11px] text-muted-foreground truncate">
                  {totalCount > 0 ? `${totalCount.toLocaleString()} records` : "Track all purchase orders"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />

            <PermissionGuardButton canEdit={canEdit} variant="outline" size="sm" className="h-8" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1" />
              Import
            </PermissionGuardButton>

            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />

            <PermissionGuardButton canEdit={canEdit} variant="outline" size="sm" className="h-8" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1" />
              Import
            </PermissionGuardButton>

            <Button variant="outline" size="sm" className="h-8" onClick={handleExport} disabled={exporting}>
              <Download className="h-3.5 w-3.5 mr-1" />
              {exporting ? `Exporting… ${exportProgress}` : "Export"}
            </Button>

            <PermissionGuardButton
              canEdit={canEdit}
              size="sm"
              className="h-8"
              onClick={() => {
                setAddForm({});
                setAddOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add
            </PermissionGuardButton>
          </div>
        </div>
      </header>

      {/* ── Filter bar (same style as Demand Planner) ── */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-border bg-card/30">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            className="pl-9 h-8"
          />
        </div>

        {/* Airtable-style view controls */}
        {crdCol && (
          <CrdWeekFilter
            value={crdFilter}
            onChange={(f) => { setCrdFilter(f); setCurrentPage(1); }}
          />
        )}
        <GroupMenu
          value={groupBy}
          options={groupOptions}
          onChange={(v) => { setGroupBy(v); setCollapsed({}); setCurrentPage(1); }}
        />
        <SortMenu
          rules={sortRules.length ? sortRules : defaultSortRules}
          options={fieldOptions}
          onChange={(rules) => { setSortRules(rules); setCurrentPage(1); }}
        />

        {resolvedFilterCols.map((fc) => (
          <MultiSelectFilter
            key={fc.key}
            label={fc.label}
            options={distinctOptions[fc.key] || []}
            value={filters[fc.key] || []}
            isLoading={isFilterLoading(fc.key)}
            onOpen={() => markFilterOpened(fc.key)}
            onApply={(v) => {
              setFilters((p) => ({ ...p, [fc.key]: v }));
              setCurrentPage(1);
            }}
          />
        ))}

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => qc.invalidateQueries({ queryKey: [QUERY_KEY] })}
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
              setCrdFilter(EMPTY_CRD_FILTER);
              setCurrentPage(1);
            }}
          >
            Clear filters ({activeFilterCount})
          </Button>
        )}

        <span className="text-xs text-muted-foreground">
          {totalCount.toLocaleString()} records
          {lastPulled && <span className="ml-2 opacity-75">· Updated {timeAgo(String(lastPulled))}</span>}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto" style={{ isolation: "isolate" }}>
        {isLoading || !schema ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading...</div>
        ) : visibleCols.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No matching columns found for your arrangement.</div>
        ) : (
          <table
            className="w-max min-w-full"
            style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}
          >
            <colgroup>
              {visibleCols.map((c) => (
                <col key={c.column_name} style={{ width: isNumericType(c.data_type) ? 130 : 180 }} />
              ))}
              <col style={{ width: 130 }} />
              <col style={{ width: 110 }} />
            </colgroup>

            <thead>
              <tr>
                {visibleCols.map((col) => {
                  const isSorted = sortCol === col.column_name;
                  return (
                    <th
                      key={col.column_name}
                      onClick={() => handleSort(col.column_name)}
                      className="app-th cursor-pointer"
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 40,
                      }}
                    >
                      <span className="inline-flex items-center gap-1">
                        {displayLabel(col.column_name, resolvedCols)}
                        {isSorted &&
                          (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                      </span>
                    </th>
                  );
                })}

                <th
                  className="app-th"
                  style={{ position: "sticky", top: 0, zIndex: 40 }}
                >
                  Status
                </th>

                <th
                  className="app-th"
                  style={{ position: "sticky", top: 0, zIndex: 40 }}
                >
                  Action
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleCols.length + 2}
                    className="app-td text-center text-muted-foreground"
                  >
                    No purchase orders found.
                  </td>
                </tr>
              ) : groupSections ? (
                groupSections.map((g) => (
                  <React.Fragment key={g.key}>
                    {/* ── Group header — collapsible, with record + overdue counts ── */}
                    <tr className="bg-muted/70">
                      <td colSpan={visibleCols.length + 2} className="app-td !py-1.5">
                        <button
                          type="button"
                          onClick={() => setCollapsed((p) => ({ ...p, [g.key]: !p[g.key] }))}
                          className="flex w-full items-center gap-2 text-left"
                        >
                          {collapsed[g.key]
                            ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                          <span className="text-xs font-semibold text-foreground">{g.label}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {g.rows.length.toLocaleString()} {g.rows.length === 1 ? "record" : "records"}
                          </Badge>
                          {g.overdue > 0 && (
                            <Badge className="border-red-600 bg-red-600 text-[10px] text-white hover:bg-red-700">
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              {g.overdue} overdue
                            </Badge>
                          )}
                        </button>
                      </td>
                    </tr>
                    {!collapsed[g.key] && g.rows.map((row, ri) => renderDataRow(row, ri))}
                  </React.Fragment>
                ))
              ) : (
                rows.map((row, ri) => renderDataRow(row, ri))
              )}
            </tbody>
          </table>
        )}
      </div>

      {groupSections ? (
        /* Grouped view loads the whole filtered set — pagination is replaced
           by a summary + collapse/expand-all controls. */
        <div className="flex shrink-0 items-center justify-between border-t border-border bg-background px-4 py-2 text-xs text-muted-foreground">
          <span>
            {rows.length.toLocaleString()} records in {groupSections.length.toLocaleString()} groups
            {groupCapped && (
              <span className="ml-2 font-medium text-amber-600">
                · showing first {rows.length.toLocaleString()} of {totalCount.toLocaleString()} — narrow filters to see all
              </span>
            )}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="sm" className="h-7 text-xs"
              onClick={() => setCollapsed(Object.fromEntries(groupSections.map((g) => [g.key, true])))}
            >
              Collapse all
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setCollapsed({})}>
              Expand all
            </Button>
          </div>
        </div>
      ) : (
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
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      )}

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto border-emerald-200">
          <DialogHeader>
            <DialogTitle className="text-emerald-700">Edit Record</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {visibleCols
              .filter((c) => c.column_name !== pkCol)
              .map((col) => (
                <div key={col.column_name} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {displayLabel(col.column_name, resolvedCols)}
                  </label>
                  {renderFormField(col, editForm, setEditForm)}
                </div>
              ))}
          </div>
          <DialogFooter>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSaveEdit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto border-emerald-200">
          <DialogHeader>
            <DialogTitle className="text-emerald-700">Add Record</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {visibleCols.map((col) => (
              <div key={col.column_name} className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {displayLabel(col.column_name, resolvedCols)}
                </label>
                {renderFormField(col, addForm, setAddForm)}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSaveAdd}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent className="border-emerald-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-emerald-700">Delete record?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleConfirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={importOpen} onOpenChange={(o) => !o && (setImportOpen(false), setImportData(null))}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto border-emerald-200">
          <DialogHeader>
            <DialogTitle className="text-emerald-700">Import Preview</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{importData?.length || 0} rows to import</p>

          {importData && importData.length > 0 && (
            <div className="overflow-auto max-h-60 border rounded text-xs">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {Object.keys(importData[0]).map((k) => (
                      <th key={k} className="border border-border px-2 py-1 text-left font-medium">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importData.slice(0, 10).map((r, i) => (
                    <tr key={i}>
                      {Object.values(r).map((v: any, j) => (
                        <td key={j} className="border border-border px-2 py-1">
                          {v ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleImportCommit}>
              Import {importData?.length || 0} rows
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
