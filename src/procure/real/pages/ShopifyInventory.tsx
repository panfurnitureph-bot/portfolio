import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/ui/table-pagination";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Search, RefreshCw, Mail, Clock, Send, Info, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";
import { useLazyFilterOptions } from "@/hooks/useLazyFilterOptions";
import { Badge } from "@/components/ui/badge";
import { ShopifyVariantDialog, type ShopifyRow } from "@/components/shopify/ShopifyVariantDialog";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { sendShopifyEmailReport } from "@/lib/shopify/sendShopifyEmailReport";
import { computeNextRunTime } from "@/lib/shopify/shopifySchedule";


function parseNameColor(desc: string | null) {
  if (!desc) return { name: "", color: "" };
  const m = desc.match(/^(.*?)\s+in\s+(.*)$/i);
  if (m) return { name: m[1].trim(), color: m[2].trim() };
  const p = desc.split("|").map((s) => s.trim());
  if (p.length === 2) return { name: p[0], color: p[1] };
  return { name: desc, color: "" };
}

const TABLE_NAME = "shopify_store";
const QUERY_KEY = "shopify-inventory";
const PAGE_SIZES = [50, 100, 200, 1000];

type ColumnDef = { key: string; label: string; numeric?: boolean; align?: "left" | "center" | "right" };

const OO_BUCKETS = ["30", "60", "90", "120"] as const;

const COLUMNS: ColumnDef[] = [
  { key: "sku", label: "SKU", align: "center" },
  { key: "description", label: "Product Name", align: "left" },
  { key: "oh_inv", label: "OH Units", numeric: true, align: "center" },
  { key: "otw_units", label: "OTW Units", numeric: true, align: "center" },
  { key: "on_order_units", label: "OO Units", numeric: true, align: "center" },
  { key: "po_in_progress", label: "PO Units", numeric: true, align: "center" },
  { key: "oo_units_30days", label: "OO Units 30 Days", numeric: true, align: "center" },
  { key: "oo_units_60days", label: "OO Units 60 Days", numeric: true, align: "center" },
  { key: "oo_units_90days", label: "OO Units 90 Days", numeric: true, align: "center" },
  { key: "oo_units_120days", label: "OO Units 120 Days", numeric: true, align: "center" },
];

const FILTER_COLUMNS = [
  { key: "description", label: "Product Name", colName: "description" },
  { key: "sku", label: "SKU", colName: "sku" },
  { key: "oh_inv", label: "OH Units", colName: "oh_inv" },
  { key: "otw_units", label: "OTW Units", colName: "otw_units" },
  { key: "on_order_units", label: "OO Units", colName: "on_order_units" },
  { key: "po_in_progress", label: "PO Units", colName: "po_in_progress" },
];

export default function ShopifyInventory() {
  const queryClient = useQueryClient();
  const [search, setSearch] = usePersistedState("shopify-inventory:search", "");
  const [debounced, setDebounced] = useState(search);
  const [page, setPage] = usePersistedState("shopify-inventory:page", 1);
  const [pageSize, setPageSize] = usePersistedState("shopify-inventory:pageSize", 50);
  const [filters, setFilters] = usePersistedState<Record<string, string[]>>("shopify-inventory:filters", {});
  const [incomingDaysSort, setIncomingDaysSort] = usePersistedState<string | null>(
    "shopify-inventory:incoming-days-sort",
    null,
  );
  const [selectedRow, setSelectedRow] = useState<ShopifyRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Email & Schedule Settings State
  const [showEmailSettingsDialog, setShowEmailSettingsDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailFactoryGroups, setEmailFactoryGroups] = useState<Record<string, string[]>>({});
  const [scheduleEnabled, setScheduleEnabled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    optionsMap: distinctOptions,
    markOpened,
    isLoadingFor,
  } = useLazyFilterOptions(TABLE_NAME, QUERY_KEY, FILTER_COLUMNS, filters);

  const activeFilterCount = useMemo(() => Object.values(filters).filter((v) => v && v.length > 0).length, [filters]);

  const applyFiltersToQuery = useCallback(
    (q: any) => {
      for (const fc of FILTER_COLUMNS) {
        const sel = filters[fc.key];
        if (sel && sel.length > 0) q = q.in(fc.colName, sel);
      }
      return q;
    },
    [filters],
  );

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: [QUERY_KEY, page, pageSize, debounced, filters, incomingDaysSort],
    queryFn: async () => {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      let q: any = supabase
        .from(TABLE_NAME)
        .select("id,sku,description,oh_inv,otw_units,on_order_units,po_in_progress,oo_units_30days,oo_units_60days,oo_units_90days,oo_units_120days", { count: "exact" });
      if (debounced.trim()) {
        const term = `%${debounced.trim()}%`;
        q = q.or(`description.ilike.${term},sku.ilike.${term}`);
      }
      q = applyFiltersToQuery(q);
      if (incomingDaysSort) {
        q = q.order(`oo_units_${incomingDaysSort}days`, { ascending: false, nullsFirst: false });
      }
      q = q.order("sku", { ascending: true, nullsFirst: false }).range(from, to);
      const { data, error, count } = await q;
      if (error) throw error;
      return { items: (data ?? []) as any[], totalCount: count ?? 0 };
    },
    staleTime: 60_000,
  });

  const items = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const formatCell = (v: unknown, numeric?: boolean) => {
    if (v === null || v === undefined || v === "") return "—";
    if (numeric && typeof v === "number") return v.toLocaleString();
    return String(v);
  };

  // ── Email Factory Mappings Query ──
  const { data: emailMappingsData, refetch: refetchEmailMappings } = useQuery({
    queryKey: ["shopify-email-factory-mapping"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_factory_mapping")
        .select("*")
        .eq("report_type", "shopify")
        .order("email", { ascending: true });
      if (error) throw error;
      return data as { id: string; email: string; factory: string }[];
    },
    staleTime: 30_000,
  });

  // Build email → factories mapping
  useEffect(() => {
    if (!emailMappingsData) return;
    const groups: Record<string, string[]> = {};
    for (const row of emailMappingsData) {
      if (!row.email) continue;
      if (!groups[row.email]) groups[row.email] = [];
      if (row.factory && row.factory !== "UNASSIGNED") {
        groups[row.email].push(row.factory);
      }
    }
    setEmailFactoryGroups(groups);
  }, [emailMappingsData]);

  // ── Schedule Config Query ──
  const { data: scheduleConfigData, refetch: refetchSchedule } = useQuery({
    queryKey: ["shopify-email-schedule-config", "v2"], // Added v2 to force cache bust
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_schedule_config")
        .select("*")
        .eq("report_type", "shopify")
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        throw error;
      }

      return data as {
        id?: string;
        enabled?: boolean;
        recurrence_type?: string;
        next_run_at?: string;
        last_run_at?: string;
        run_count?: number;
        minutes_interval?: number;
        hours_interval?: number;
        report_type?: string;
      } | null;
    },
    staleTime: 0, // Force refetch every time
    cacheTime: 0, // Don't cache
  });

  useEffect(() => {
    if (scheduleConfigData) {
      setScheduleEnabled(scheduleConfigData.enabled ?? false);
    }
  }, [scheduleConfigData]);

  // ── Available emails from description field ──
  const availableEmails = useMemo(() => {
    // Extract unique emails from items or provide some defaults
    const emails = new Set<string>();
    // Add any existing emails from mapping
    Object.keys(emailFactoryGroups).forEach(e => emails.add(e));
    // Add common placeholder
    if (emails.size === 0) {
      emails.add("buyer1@example.com");
      emails.add("buyer2@example.com");
    }
    return Array.from(emails).sort();
  }, [emailFactoryGroups]);

  // ── All factories from data ──
  const allFactories = useMemo(() => {
    // In real scenario, extract from items or separate query
    return ["Factory A", "Factory B", "Factory C", "VND1", "VND2", "VND3"];
  }, []);

  // ── Handle Add Emails ──
  const handleAddEmailsFromMultiSelect = async (emails: string[]) => {
    try {
      for (const email of emails) {
        if (emailFactoryGroups[email]) continue; // already exists
        await supabase.from("email_factory_mapping").insert({ email, factory: "UNASSIGNED", report_type: "shopify" });
      }
      refetchEmailMappings();
      toast.success(`✅ Added ${emails.length} email(s)`);
    } catch (e: any) {
      toast.error("Failed to add emails");
    }
  };

  // ── Send Email Report ──
  const handleSendEmailReport = async () => {
    setSendingEmail(true);
    try {
      const result = await sendShopifyEmailReport();
      
      if (result.ok) {
        toast.success(`✅ Sent reports to ${result.successCount} recipient(s) with ${result.totalItemsSent} total items`);
      } else {
        toast.error(`❌ Failed to send email report: ${result.reason || 'Unknown error'}`);
      }

      if (result.failCount > 0) {
        toast.warning(`⚠️ ${result.failCount} email(s) failed to send`);
      }

    } catch (e: any) {
      toast.error("Failed to send email report: " + (e?.message || String(e)));
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden min-h-0" style={{ maxWidth: "none" }}>
      {/* HEADER */}
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
                <h1 className="text-sm font-semibold text-foreground leading-tight truncate">Storefront Stock</h1>
                <p className="text-[11px] text-muted-foreground truncate">Monitoring view (sorted by SKU)</p>
              </div>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2"
              onClick={() => setShowEmailSettingsDialog(true)}
            >
              <Mail className="h-3.5 w-3.5" />
              Email Settings
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2"
              onClick={() => setShowScheduleDialog(true)}
            >
              <Clock className="h-3.5 w-3.5" />
              Schedule Settings
              {scheduleEnabled && (
                <Badge variant="default" className="ml-1 h-4 px-1 text-[10px]">
                  ACTIVE
                </Badge>
              )}
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-8 gap-2"
              onClick={handleSendEmailReport}
              disabled={sendingEmail}
            >
              {sendingEmail ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  Send Email Report
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-border bg-card/30">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9 h-8"
          />
        </div>
        {FILTER_COLUMNS.map((fc) => (
          <MultiSelectFilter
            key={fc.key}
            label={fc.label}
            options={distinctOptions[fc.key] || []}
            value={filters[fc.key] || []}
            isLoading={isLoadingFor(fc.key)}
            onOpen={() => markOpened(fc.key)}
            onApply={(v) => {
              setFilters((p) => ({ ...p, [fc.key]: v }));
              setPage(1);
            }}
          />
        ))}
        <MultiSelectFilter
          label="Incoming Breakdown"
          options={[...OO_BUCKETS]}
          value={incomingDaysSort ? [incomingDaysSort] : []}
          onApply={(v) => {
            const next = v.find((x) => x !== incomingDaysSort) ?? v[0] ?? null;
            setIncomingDaysSort(next);
            setPage(1);
          }}
          formatLabel={(v) => `${v} Days`}
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
        <Button
          variant={activeFilterCount > 0 ? "destructive" : "outline"}
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setFilters({});
            setIncomingDaysSort(null);
            setSearch("");
            setPage(1);
          }}
          disabled={activeFilterCount === 0 && !search && !incomingDaysSort}
        >
          Clear Filters
          {activeFilterCount > 0 && ` (${activeFilterCount})`}
        </Button>
        <span className="text-xs text-muted-foreground">{totalCount.toLocaleString()} records</span>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 border-t border-border relative overflow-auto" style={{ isolation: "isolate" }}>
        <div className="min-w-max">
          <table className="w-full text-[12px] leading-tight" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className="app-th"
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 40,
                    }}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="app-td">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="app-td text-center text-destructive">
                    Error: {(error as Error).message}
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLUMNS.length}
                    className="app-td text-center text-muted-foreground"
                  >
                    No records found.
                  </td>
                </tr>
              ) : (
                items.map((row, idx) => {
                  const r = row as ShopifyRow;
                  const { name, color } = parseNameColor(r.description);
                  return (
                    <tr
                      key={r.id ?? idx}
                      onClick={() => {
                        setSelectedRow(r);
                        setDialogOpen(true);
                      }}
                      className={`cursor-pointer hover:bg-[#3b5769]/20 dark:hover:bg-[#2a2a2a] transition-colors duration-75 ${idx % 2 === 1 ? "bg-muted/20" : ""}`}
                    >
                      {COLUMNS.map((c) => {
                        const style: React.CSSProperties = {};

                        if (c.key === "description") {
                          return (
                            <td
                              key={c.key}
                              className="app-td text-left whitespace-nowrap"
                              style={style}
                            >
                              <div className="min-w-0">
                                <div className="font-semibold text-foreground truncate">
                                  {name || r.description || "—"}
                                </div>
                                {color && (
                                  <Badge
                                    variant="secondary"
                                    className="mt-0.5 h-5 px-2 text-[11px] font-normal bg-muted text-muted-foreground hover:bg-muted"
                                  >
                                    {color}
                                  </Badge>
                                )}
                              </div>
                            </td>
                          );
                        }

                        const display = formatCell((r as any)[c.key], c.numeric);
                        return (
                          <td
                            key={c.key}
                            className={`app-td text-${c.align ?? "center"} whitespace-nowrap ${c.numeric ? "tabular-nums" : ""}`}
                            style={style}
                            title={display !== "—" ? display : undefined}
                          >
                            {display === "—" ? <span className="text-muted-foreground">—</span> : display}
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

      <TablePagination
        currentPage={page}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={totalCount}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZES}
      />

      <ShopifyVariantDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        row={selectedRow}
        onSaved={() => refetch()}
      />

      {/* Email Settings Dialog */}
      <AlertDialog open={showEmailSettingsDialog} onOpenChange={setShowEmailSettingsDialog}>
        <AlertDialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <AlertDialogHeader className="space-y-3">
            <AlertDialogTitle className="text-xl font-bold flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Shopify Email Factory Assignments
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Configure email recipients and their assigned factories for Storefront Stock reports.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex-1 overflow-auto">
            {/* Add Email */}
            <div className="p-4 border-b bg-muted/30 flex gap-3 items-center">
              <MultiSelectFilter
                label="Add Email"
                options={availableEmails}
                value={[]}
                onApply={(selected) => {
                  if (selected.length > 0) {
                    handleAddEmailsFromMultiSelect(selected);
                  }
                }}
              />
            </div>

            {/* Table */}
            <div className="overflow-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-muted/50 z-10">
                  <tr>
                    <th className="text-left p-3 font-semibold border-b text-sm">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        Email Address
                      </div>
                    </th>
                    <th className="text-left p-3 font-semibold border-b text-sm">
                      <div className="flex items-center gap-2">
                        Assigned Factories
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(emailFactoryGroups).length === 0 ? (
                    <tr>
                      <td colSpan={2} className="text-center py-16 text-muted-foreground">
                        <div className="flex flex-col items-center gap-3">
                          <div className="rounded-full bg-muted p-4">
                            <Mail className="h-8 w-8 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium text-base">No email assignments yet</p>
                            <p className="text-sm mt-1">Click "Add Email" above to get started</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    Object.entries(emailFactoryGroups).map(([email, assignedFactories]) => (
                      <tr key={email} className="border-b hover:bg-primary/5 transition-colors">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="rounded-full bg-primary/10 p-1.5">
                              <Mail className="h-3.5 w-3.5 text-primary" />
                            </div>
                            <span className="font-medium text-sm">{email}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <MultiSelectFilter
                              label={assignedFactories.length === 0 
                                ? "Select Factories" 
                                : `${assignedFactories.length} ${assignedFactories.length === 1 ? 'factory' : 'factories'}`
                              }
                              options={allFactories}
                              value={assignedFactories}
                              onApply={async (selected) => {
                                const toAdd = selected.filter(f => !assignedFactories.includes(f));
                                const toRemove = assignedFactories.filter(f => !selected.includes(f));
                                
                                try {
                                  if (toAdd.length > 0 && assignedFactories.length === 0) {
                                    await supabase
                                      .from("email_factory_mapping")
                                      .delete()
                                      .eq("email", email)
                                      .eq("factory", "UNASSIGNED")
                                      .eq("report_type", "shopify");
                                  }
                                  
                                  await Promise.all([
                                    ...toAdd.map(factory => 
                                      supabase.from("email_factory_mapping").insert({ email, factory, report_type: "shopify" })
                                    ),
                                    ...toRemove.map(factory =>
                                      supabase.from("email_factory_mapping").delete().eq("email", email).eq("factory", factory).eq("report_type", "shopify")
                                    )
                                  ]);
                                  
                                  refetchEmailMappings();
                                  toast.success(`✅ Updated factories for ${email}`);
                                } catch (e) {
                                  toast.error("Failed to update factories");
                                }
                              }}
                            />
                            {assignedFactories.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {assignedFactories.slice(0, 3).map(factory => (
                                  <Badge key={factory} variant="secondary" className="text-xs font-medium">
                                    {factory}
                                  </Badge>
                                ))}
                                {assignedFactories.length > 3 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{assignedFactories.length - 3} more
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <AlertDialogFooter className="border-t pt-4 bg-muted/20">
            <AlertDialogCancel className="h-9">Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Schedule Settings Dialog */}
      <AlertDialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <AlertDialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Shopify Email Schedule Configuration
            </AlertDialogTitle>
            <AlertDialogDescription>
              Configure automated email scheduling for Storefront Stock reports.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex-1 overflow-auto p-6 space-y-6">
            <div className="bg-muted/30 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm">Schedule Status</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {scheduleEnabled ? "Automated emails are active" : "Automated emails are disabled"}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={(e) => setScheduleEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
            </div>

            {scheduleConfigData && (
              <div className="bg-white dark:bg-slate-800 border rounded-lg p-4">
                <h3 className="font-semibold text-sm mb-3">Current Schedule Info</h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">Next Run:</span>
                    <p className="font-medium mt-0.5">
                      {scheduleConfigData.next_run_at 
                        ? new Date(scheduleConfigData.next_run_at).toLocaleString()
                        : 'Not scheduled'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last Run:</span>
                    <p className="font-medium mt-0.5">
                      {scheduleConfigData.last_run_at 
                        ? new Date(scheduleConfigData.last_run_at).toLocaleString()
                        : 'Never'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total Runs:</span>
                    <p className="font-medium mt-0.5">{scheduleConfigData.run_count || 0}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <p className="font-medium mt-0.5">
                      <Badge variant={scheduleConfigData.enabled ? "default" : "secondary"}>
                        {scheduleConfigData.enabled ? 'Active' : 'Inactive'}
                      </Badge>
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-slate-800 border rounded-lg p-4">
              <h3 className="font-semibold text-sm mb-3">Recipients Preview</h3>
              {Object.keys(emailFactoryGroups).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No recipients configured. Please set up Email Settings first.
                </p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(emailFactoryGroups).map(([email, factories]) => (
                    <div key={email} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                      <span className="text-sm font-medium">{email}</span>
                      <Badge variant="outline" className="text-xs">
                        {factories.length} {factories.length === 1 ? 'factory' : 'factories'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <AlertDialogFooter className="border-t pt-4">
            <AlertDialogCancel>Close</AlertDialogCancel>
            <Button
              onClick={async () => {
                try {
                  // Only toggle enabled — never overwrite recurrence settings configured in the full modal
                  const { error } = scheduleConfigData?.id
                    ? await supabase
                        .from("email_schedule_config")
                        .update({ enabled: scheduleEnabled, updated_at: new Date().toISOString() })
                        .eq("id", scheduleConfigData.id)
                    : await supabase
                        .from("email_schedule_config")
                        .insert({
                          enabled: scheduleEnabled,
                          recurrence_type: 'minutes',
                          minutes_interval: 30,
                          report_type: 'shopify',
                          updated_at: new Date().toISOString(),
                        });
                  
                  if (error) {
                    throw error;
                  }

                  await refetchSchedule();
                  setShowScheduleDialog(false);
                  toast.success("✅ Schedule settings saved");
                } catch (e: any) {
                  toast.error(`Failed to save schedule: ${e.message || 'Unknown error'}`);
                }
              }}
            >
              Save Settings
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
