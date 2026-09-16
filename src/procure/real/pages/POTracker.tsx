import React, { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { OrderDashboardTabs } from "@/components/shared/OrderDashboardTabs";
import { usePersistedState } from "@/hooks/usePersistedState";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { Search, RefreshCw, Upload, Package, ThumbsUp, Pencil, Trash2, ChevronDown, Maximize2, ArrowLeft, MoreHorizontal, Paperclip, Plus, RotateCcw, X, FileText, FileSpreadsheet, FileImage, File as FileIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { TablePagination } from "@/components/ui/table-pagination";
import { usePagePermission } from "@/hooks/usePagePermission";
import { PermissionGuardButton } from "@/components/shared/PermissionGuardButton";
import { useActivityLog } from "@/hooks/useActivityLog";
import { useFactoryAccess } from "@/hooks/useFactoryAccess";
import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CSVImportDialog } from "@/components/shared/CSVImportDialog";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useTableView, type ViewField, type FieldType } from "@/lib/tableView";
import { TableViewToolbar, ColResizeHandle } from "@/components/shared/TableViewToolbar";
import { EditableCell, HoverSelectCell } from "@/components/shared/EditableCell";
import { useInlineEdit, type EditKind } from "@/hooks/useInlineEdit";
import { useHoverRow, useActiveRow } from "@/hooks/useHoverRow";
import { ChevronRight } from "lucide-react";

/** Default column width (px) from a Tailwind `min-w-[Npx]` class, for the
 *  fixed-layout <colgroup>. Falls back to 120. */
const parseMinW = (w?: string) => { const m = w?.match(/\[(\d+)px\]/); return m ? Number(m[1]) : 120; };
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

const DEFAULT_TABLE     = "po_tracker";
const DEFAULT_QUERY_KEY = "po-tracker-v2";

/** Props let the same Order Pipeline serve multiple tables (Finance /
 *  Logistics / Management), each with its own data, permission key, and
 *  persisted filter state. Defaults preserve the original behavior. */
interface POTrackerProps {
  tableName?: string;
  queryKey?: string;
  title?: string;
  subtitle?: string;
  permKey?: string;
  tabGroup?: import("@/components/shared/OrderDashboardTabs").TabGroup;
}

type Row = {
  id: string;
  po_number: string;
  vendor_name: string | null;
  vendor_id: string | null;
  type: string | null;
  target_completion_date: string | null;
  priority: string | null;
  status: string | null;
  team_status: string | null;
  factory_list: string | null;
  country_of_origin: string | null;
  of_products: number | null;
  created_on: string | null;
  invoice_date: string | null;
  expected_delivery: string | null;
  received_date: string | null;
  ship: string | null;
  receive: string | null;
  payment_status_finance: string | null;
  payment_approved_lead: string | boolean | null;
  calculated_deposit_amount: number | null;
  actual_deposit_amount: number | null;
  deposit_percentage: number | null;
  grand_total: number | null;
  po_request_files: unknown;
  po_files: unknown;
  pi_file: unknown;
};

/* ── Badge helpers ─────────────────────────────────────────────────── */
const PILL_PALETTE = [
  { bg: "#FEF3C7", text: "#92400E" },
  { bg: "#FCE7F3", text: "#9D174D" },
  { bg: "#d9e4ea", text: "#5B21B6" },
  { bg: "#D1FAE5", text: "#065F46" },
  { bg: "#cfe9e9", text: "#0c4849" },
  { bg: "#CCFBF1", text: "#115E75" },
  { bg: "#FEE2E2", text: "#991B1B" },
  { bg: "#F3E8FF", text: "#6B21A8" },
  { bg: "#BBF7D0", text: "#166534" },
  { bg: "#FFF7ED", text: "#9A3412" },
];

function hashColor(val: string) {
  const t = val.trim();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return PILL_PALETTE[h % PILL_PALETTE.length];
}

function pill(bg: string, text: string): React.CSSProperties {
  return { backgroundColor: bg, color: text, borderRadius: "9999px", padding: "2px 10px", fontWeight: 600, fontSize: "11px", display: "inline-block", letterSpacing: "0.02em", whiteSpace: "nowrap" };
}

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return <Dash />;
  const l = value.toLowerCase();
  if (l === "ordered") return <span style={pill("#FEE2E2", "#991B1B")}>{value}</span>;
  if (l === "completed") return <span style={pill("#D1FAE5", "#065F46")}>{value}</span>;
  const { bg, text } = hashColor(value);
  return <span style={pill(bg, text)}>{value}</span>;
}

function TeamStatusBadge({ value }: { value: string | null }) {
  if (!value) return <Dash />;
  const l = value.toLowerCase();
  if (l === "confirmed") return <span style={pill("#D1FAE5", "#065F46")}>{value}</span>;
  const { bg, text } = hashColor(value);
  return <span style={pill(bg, text)}>{value}</span>;
}

function CountryBadge({ value }: { value: string | null }) {
  if (!value) return <Dash />;
  const l = value.toLowerCase();
  if (l === "portugal" || l === "pt") return <span style={pill("#D1FAE5", "#065F46")}>{value}</span>;
  const { bg, text } = hashColor(value);
  return <span style={pill(bg, text)}>{value}</span>;
}

function PaymentBadge({ value }: { value: string | null }) {
  if (!value) return <Dash />;
  if (value.toUpperCase() === "PAID") return <span style={pill("#D1FAE5", "#065F46")}>{value}</span>;
  const { bg, text } = hashColor(value);
  return <span style={pill(bg, text)}>{value}</span>;
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

function ApprovedCell({ value }: { value: string | boolean | null }) {
  if (value === null || value === undefined || value === "") return <Dash />;
  const isTrue = value === true || value === "true" || value === "1" || value === "yes";
  if (isTrue) return <ThumbsUp className="h-4 w-4 mx-auto" style={{ color: "#00BFA5" }} />;
  return <span className="text-muted-foreground text-xs">{String(value)}</span>;
}

function TextCell({ v }: { v: string | null }) {
  if (!v) return <Dash />;
  return <>{v}</>;
}

/* ── Formatters ───────────────────────────────────────────────────── */
function parseDateMs(s: string): number {
  if (!s) return 0;
  // ISO: 2026-06-12
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s).getTime();
  // M/D/YYYY or MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2])).getTime();
  return new Date(s).getTime() || 0;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  // Bare "YYYY-MM-DD" (no time component) is a calendar date, not a moment in
  // time — new Date(s) reads it as UTC midnight, which format() then renders
  // a day EARLIER for any user in a timezone behind UTC. Format it straight
  // from the string so it never passes through timezone conversion.
  const bareDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (bareDate) {
    const [, y, mo, d] = bareDate;
    return `${Number(mo)}/${Number(d)}/${y}`;
  }
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return format(d, "M/d/yyyy");
  } catch { return s; }
}

function fmtCurrency(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Calc. Deposit is a formula field: deposit % × grand total. Falls back to the
 *  stored value when either input is missing. */
function calcDepositAmount(pct: number | null | undefined, grandTotal: number | null | undefined, stored: number | null): number | null {
  if (pct == null || grandTotal == null || !Number.isFinite(Number(pct)) || !Number.isFinite(Number(grandTotal))) return stored;
  return Math.round(Number(grandTotal) * Number(pct)) / 100; // pct is a whole-number percentage
}

/** Keep the stored Calc. Deposit in sync with the formula when its inputs change. */
function withDeposit(row: Row): Row {
  return { ...row, calculated_deposit_amount: calcDepositAmount(row.deposit_percentage, row.grand_total, row.calculated_deposit_amount) };
}

/* ── Attachment list cells (jsonb [{filename,url,type}] columns) ──── */
const PO_FILE_COLS = new Set(["po_request_files", "po_files", "pi_file"]);
const asFiles = (v: unknown): { filename?: string; url?: string }[] => (Array.isArray(v) ? v : []);

/* In-app file preview: list cells open the same full-size preview modal the
 * record dialog's attachment dropzone uses — no download, no new tab. The
 * setter lives in page state, handed down via context because the COLUMNS
 * render closures are module-level. */
const FilePreviewCtx = React.createContext<(f: { url: string; name: string }) => void>(() => {});

function FileTypeIcon({ name, className }: { name: string; className?: string }) {
  if (/\.pdf$/i.test(name)) return <FileText className={cn("text-red-600", className)} />;
  if (/\.(xlsx|xlsm|xlsb|xls|xltx|xltm|csv)$/i.test(name)) return <FileSpreadsheet className={cn("text-emerald-600", className)} />;
  if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name)) return <FileImage className={cn("text-sky-600", className)} />;
  return <FileIcon className={cn("text-muted-foreground", className)} />;
}

/** Full-size preview modal: image inline, PDF via iframe, CSV parsed in-app,
 *  Office docs via the MS viewer. Extracted from POAttachment so the list
 *  cells and the dropzone share one implementation. */
function FilePreviewOverlay({ file, onClose }: { file: { url: string; name: string }; onClose: () => void }) {
  const pIsImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(file.name);
  const pIsPdf = /\.pdf$/i.test(file.name);
  const pIsCsv = /\.csv$/i.test(file.name);
  const pIsOffice = /\.(xlsx|xlsm|xlsb|xls|xltx|xltm|doc|docx|docm|ppt|pptx|pptm)$/i.test(file.name);
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 p-8" onClick={onClose}>
      <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
          <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold">
            <FileTypeIcon name={file.name} className="h-4 w-4 shrink-0" />
            <span className="truncate">{file.name}</span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <a href={file.url} download={file.name} target="_blank" rel="noreferrer"
              className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90">Download</a>
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-muted/20">
          {pIsImage ? (
            <div className="flex h-full items-center justify-center"><img src={file.url} alt={file.name} className="max-h-full max-w-full object-contain" /></div>
          ) : pIsPdf ? (
            <iframe src={file.url} title={file.name} className="h-full w-full border-0" />
          ) : pIsCsv ? (
            <CsvPreview url={file.url} />
          ) : pIsOffice ? (
            <iframe src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.url)}`} title={file.name} className="h-full w-full border-0" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <FileText className="h-10 w-10" />
              <span className="text-sm">Preview not available for this file type.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentCell({ value }: { value: unknown }) {
  const files = asFiles(value);
  const openPreview = React.useContext(FilePreviewCtx);
  if (!files.length) return <Dash />;
  const openAt = (f: { filename?: string; url?: string }, i: number) => {
    const name = f.filename || `file ${i + 1}`;
    const url = String(f.url || "");
    if (url) openPreview({ url, name });
  };
  // Icon-only, Airtable style: the filename lives in the hover tooltip and the
  // preview modal header. The wrapper swallows clicks so a near-miss on the
  // icon never activates the row's inline editors (that mounted inputs across
  // the whole row and shifted the layout mid-click — read as "lag" / wrong
  // file). A single-file cell opens its file from anywhere in the cell.
  return (
    <span className="flex w-full min-h-[24px] flex-wrap items-center justify-center gap-1"
      onClick={(e) => { e.stopPropagation(); if (files.length === 1) openAt(files[0], 0); }}
      onDoubleClick={(e) => e.stopPropagation()}
      role={files.length === 1 ? "button" : undefined}
      style={files.length === 1 ? { cursor: "pointer" } : undefined}>
      {files.map((f, i) => {
        const name = f.filename || `file ${i + 1}`;
        return (
          <button key={i} type="button" title={name}
            onClick={(e) => { e.stopPropagation(); openAt(f, i); }}
            className="rounded-md border border-border bg-background p-1.5 hover:border-primary hover:bg-muted/50">
            <FileTypeIcon name={name} className="h-4 w-4" />
          </button>
        );
      })}
    </span>
  );
}

/** Pill-styled single select for the Quick Edit dialog (mirrors the Full Edit
 *  pill-selects). Options = known lists + distinct values from loaded rows. */
function QuickSelect({ colKey, value, options, onChange }: {
  colKey: string; value: string; options?: string[]; onChange: (v: string) => void;
}) {
  const opts = [...new Set([value, ...(PO_KNOWN_OPTIONS[colKey] ?? []), ...(options ?? [])].filter(Boolean))];
  const c = value ? optionColor(colKey, value) : null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-9 text-sm", c && "border-transparent")} style={c ? { backgroundColor: c.bg, color: c.text } : undefined}>
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {opts.map((o) => <SelectItem key={o} value={o}><span style={{ ...pill(optionColor(colKey, o).bg, optionColor(colKey, o).text) }}>{o}</span></SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/* ── Column descriptors — single source for render + the view engine's
 *    sort/filter/group/hide fields. The Actions column is rendered separately. */
type ColDef = {
  key: string;
  label: string;
  type: FieldType;
  align?: "left" | "center" | "right";
  width?: string;
  /** When the field offers a fixed option list for filter/group (computed at runtime). */
  optionsFrom?: keyof Row;
  render: (row: Row) => React.ReactNode;
};

const COLUMNS: ColDef[] = [
  { key: "po_number",                 label: "PO #",              type: "text",   width: "min-w-[120px]", render: r => r.po_number },
  { key: "vendor_name",               label: "Vendor Name",       type: "single", width: "min-w-[160px]", optionsFrom: "vendor_name",       render: r => <TextCell v={r.vendor_name} /> },
  { key: "vendor_id",                 label: "Vendor ID",         type: "text",   width: "min-w-[110px]", render: r => <TextCell v={r.vendor_id} /> },
  { key: "type",                      label: "PO Type",           type: "single", width: "min-w-[130px]", optionsFrom: "type",              render: r => r.type ? <span style={pill(hashColor(r.type).bg, hashColor(r.type).text)}>{r.type}</span> : <Dash /> },
  { key: "status",                    label: "Status",            type: "single", width: "min-w-[120px]", optionsFrom: "status",            render: r => <StatusBadge value={r.status} /> },
  { key: "team_status",               label: "Team Status",       type: "single", width: "min-w-[220px]", optionsFrom: "team_status",       render: r => <TeamStatusBadge value={r.team_status} /> },
  { key: "priority",                  label: "Priority",          type: "single", width: "min-w-[110px]", optionsFrom: "priority",          render: r => <TextCell v={r.priority} /> },
  { key: "target_completion_date",    label: "Target Completion", type: "date",   width: "min-w-[150px]", render: r => fmtDate(r.target_completion_date) },
  { key: "factory_list",              label: "Factory List",      type: "single", width: "min-w-[140px]", optionsFrom: "factory_list",      render: r => <TextCell v={r.factory_list} /> },
  { key: "country_of_origin",         label: "Country of Origin", type: "single", width: "min-w-[150px]", optionsFrom: "country_of_origin", render: r => <CountryBadge value={r.country_of_origin} /> },
  { key: "of_products",               label: "# Products",        type: "number", align: "center", width: "min-w-[90px]",  render: r => r.of_products !== null ? r.of_products : <Dash /> },
  { key: "created_on",                label: "Created On",        type: "date",   width: "min-w-[120px]", render: r => fmtDate(r.created_on) },
  { key: "invoice_date",              label: "Invoice Date",      type: "date",   width: "min-w-[120px]", render: r => fmtDate(r.invoice_date) },
  { key: "expected_delivery",         label: "Expected Delivery", type: "date",   width: "min-w-[140px]", render: r => fmtDate(r.expected_delivery) },
  { key: "received_date",             label: "Received Date",     type: "date",   width: "min-w-[120px]", render: r => fmtDate(r.received_date) },
  { key: "ship",                      label: "Ship",              type: "text",   width: "min-w-[100px]", render: r => <TextCell v={r.ship} /> },
  { key: "receive",                   label: "Receive",           type: "text",   width: "min-w-[100px]", render: r => <TextCell v={r.receive} /> },
  { key: "payment_status_finance",    label: "Payment Status",    type: "single", width: "min-w-[140px]", optionsFrom: "payment_status_finance", render: r => <PaymentBadge value={r.payment_status_finance} /> },
  { key: "payment_approved_lead",      label: "Payment Approved",  type: "bool",   align: "center", width: "min-w-[150px]", render: r => <ApprovedCell value={r.payment_approved_lead} /> },
  { key: "po_request_files",          label: "PO Request File",   type: "text",   align: "center", width: "min-w-[150px]", render: r => <AttachmentCell value={r.po_request_files} /> },
  { key: "po_files",                  label: "PO File",           type: "text",   align: "center", width: "min-w-[150px]", render: r => <AttachmentCell value={r.po_files} /> },
  { key: "pi_file",                   label: "PI File",           type: "text",   align: "center", width: "min-w-[150px]", render: r => <AttachmentCell value={r.pi_file} /> },
  { key: "calculated_deposit_amount", label: "Calc. Deposit",     type: "number", align: "right",  width: "min-w-[140px]", render: r => fmtCurrency(calcDepositAmount(r.deposit_percentage, r.grand_total, r.calculated_deposit_amount)) },
  { key: "actual_deposit_amount",     label: "Actual Deposit",    type: "number", align: "right",  width: "min-w-[130px]", render: r => fmtCurrency(r.actual_deposit_amount) },
  { key: "deposit_percentage",        label: "Deposit %",         type: "number", align: "center", width: "min-w-[100px]", render: r => r.deposit_percentage !== null ? r.deposit_percentage : <Dash /> },
  { key: "grand_total",               label: "Grand Total",       type: "number", align: "right",  width: "min-w-[120px]", render: r => <span className="font-semibold">{fmtCurrency(r.grand_total)}</span> },
];

/* ── Sort icon (reads the view engine's single-field sort state) ──── */
function SortIcon({ col, sortField, sortDir }: { col: string; sortField: string | null; sortDir: "asc" | "desc" | null }) {
  if (sortField !== col) return <span className="ml-1 opacity-30 text-[10px]">↕</span>;
  return <span className="ml-1 text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>;
}

const thBase = "app-th text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap px-4 py-3";

/* ── Main component ───────────────────────────────────────────────── */
export default function POTracker({
  tableName = DEFAULT_TABLE,
  queryKey = DEFAULT_QUERY_KEY,
  title = "Order Pipeline",
  subtitle = "PI → deposit → shipment",
  permKey = "po_tracker",
  tabGroup,
}: POTrackerProps = {}) {
  const TABLE_NAME = tableName;
  const QUERY_KEY  = queryKey;
  const { canEdit } = usePagePermission(permKey as any);
  const { logActivity } = useActivityLog();
  const queryClient = useQueryClient();
  const { restricted: factoryRestricted, countryAliases, factoryLevel, allowedFactoryShortNames } = useFactoryAccess();
  const factoryKey = (allowedFactoryShortNames ?? []).join("|");

  const [search, setSearch] = usePersistedState(`${QUERY_KEY}:search`, "");
  const [page, setPage] = usePersistedState(`${QUERY_KEY}:page`, 1);
  const [pageSize, setPageSize] = usePersistedState(`${QUERY_KEY}:pageSize`, 100);
  const [searchParams, setSearchParams] = useSearchParams();
  const [importOpen, setImportOpen] = useState(false);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [fullEditId, setFullEditId] = useState<string | null>(null);
  const [fullEditOpen, setFullEditOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const openFullEditRow = (row: Row) => {
    setFullEditId(row.id);
    setFullEditOpen(true);
    setSearchParams((p) => { const n = new URLSearchParams(p); n.set("open", row.id); return n; }, { replace: true });
  };
  const closeFullEdit = (open: boolean) => {
    setFullEditOpen(open);
    if (!open) setSearchParams((p) => { const n = new URLSearchParams(p); n.delete("open"); return n; }, { replace: true });
  };

  const openEditRow = (row: Row) => {
    setEditRow(row);
    setEditOpen(true);
    setSearchParams((p) => { const n = new URLSearchParams(p); n.set("open", row.id); return n; }, { replace: true });
  };
  const closeEditModal = (open: boolean) => {
    setEditOpen(open);
    if (!open) setSearchParams((p) => { const n = new URLSearchParams(p); n.delete("open"); return n; }, { replace: true });
  };

  // Deep-link: ?open=<id> opens that PO record directly, in Full Edit -- the
  // flat Edit dialog was removed from the Action menu (per request), so this
  // must never land on it either.
  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId) return;
    setFullEditId(openId);
    setFullEditOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: rows = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [QUERY_KEY, factoryRestricted, countryAliases, factoryLevel, factoryKey],
    queryFn: async () => {
      const COLS = [
        "id", "po_number", "vendor_name", "vendor_id", "type",
        "target_completion_date", "priority", "status", "team_status", "factory_list",
        "country_of_origin", "of_products", "created_on", "invoice_date",
        "expected_delivery", "received_date", "ship", "receive",
        "payment_status_finance", "payment_approved_lead",
        "calculated_deposit_amount", "actual_deposit_amount",
        "deposit_percentage", "grand_total",
        "po_request_files", "po_files", "pi_file",
      ].join(",");
      const CHUNK = 1000;
      // Build an identically-filtered query for a given page; count only on the first.
      const build = (withCount: boolean) => {
        let query: any = supabase
          .from(TABLE_NAME)
          .select(COLS, withCount ? { count: "exact" } : undefined)
          .order("po_number", { ascending: false });
        if (factoryLevel && allowedFactoryShortNames?.length) query = query.in("factory_list", allowedFactoryShortNames);
        else if (factoryRestricted && countryAliases.length) query = query.or(countryAliases.map((v) => `country_of_origin.ilike.${v}`).join(","));
        return query;
      };
      // Page 1 also returns the exact total, so the remaining pages can fetch in parallel.
      const firstRes = await build(true).range(0, CHUNK - 1);
      if (firstRes.error) throw firstRes.error;
      const all: Row[] = [...((firstRes.data as Row[]) ?? [])];
      const total = firstRes.count ?? all.length;
      const pages = Math.ceil(total / CHUNK);
      if (pages > 1) {
        const rest = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) => build(false).range((i + 1) * CHUNK, (i + 2) * CHUNK - 1))
        );
        for (const r of rest) { if (r.error) throw r.error; all.push(...((r.data as Row[]) ?? [])); }
      }
      return all;
    },
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
  });

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel(`${TABLE_NAME}_realtime`)
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_NAME }, () => {
        queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(TABLE_NAME).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      logActivity({ action: "Deleted", entityType: "Order Pipeline", entityId: id, entityName: id });
      toast.success("PO deleted");
    },
    onError: (e: any) => toast.error("Delete failed: " + e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Row) => {
      const { id, ...updates } = data;
      const { error } = await supabase.from(TABLE_NAME).update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("PO updated");
      setEditOpen(false);
      setEditRow(null);
    },
    onError: (e: any) => toast.error("Update failed: " + e.message),
  });

  // ── View engine fields: inject runtime option lists for single-select cols ──
  const fields: ViewField[] = useMemo(() => {
    const optsFor = (key: keyof Row) => [...new Set(rows.map(r => r[key]).filter(Boolean).map(String))].sort();
    return COLUMNS.map(c => ({
      key: c.key,
      label: c.label,
      type: c.type,
      options: c.optionsFrom ? optsFor(c.optionsFrom) : undefined,
      // Attachment jsonb columns filter/sort by their filenames.
      getValue: PO_FILE_COLS.has(c.key)
        ? (row: Record<string, unknown>) => asFiles(row[c.key]).map((f) => f.filename ?? "").join(", ")
        : c.key === "calculated_deposit_amount"
          ? (row: Record<string, unknown>) => calcDepositAmount(row.deposit_percentage as number | null, row.grand_total as number | null, row.calculated_deposit_amount as number | null)
          : undefined,
    }));
  }, [rows]);

  // Quick free-text search runs BEFORE the engine; the engine owns
  // filter-builder / sort / group / hide-fields / row-height.
  const prefiltered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return rows as unknown as Record<string, unknown>[];
    return (rows.filter(x =>
      x.po_number.toLowerCase().includes(q) ||
      x.vendor_name?.toLowerCase().includes(q) ||
      x.factory_list?.toLowerCase().includes(q)
    ) as unknown) as Record<string, unknown>[];
  }, [rows, search]);

  const view = useTableView({
    storageKey: QUERY_KEY,
    fields,
    rows: prefiltered,
    defaultSort: [{ field: "created_on", dir: "desc" }],
  });

  const sortField = view.state.sort[0]?.field ?? null;
  const sortDir = view.state.sort[0]?.dir ?? null;
  const visibleCols = useMemo(() => COLUMNS.filter(c => !view.hiddenSet.has(c.key)), [view.hiddenSet]);

  // Inline cell editing. Hovering a row shows every editable cell in it as a
  // live control (Airtable-style); double-click still works as a fallback.
  // Bool cols edit via the dialog only.
  const { editCell, setEditCell, commit } = useInlineEdit(TABLE_NAME, QUERY_KEY);
  const { activeRowId, setActiveRowId } = useActiveRow();
  const fieldOptions = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.options])) as Record<string, string[] | undefined>, [fields]);
  // Attachments upload via the dialogs; Calc. Deposit is a formula field.
  const editKindOf = (c: ColDef): EditKind =>
    c.type === "bool" || c.type === "multi" || PO_FILE_COLS.has(c.key) || c.key === "calculated_deposit_amount" ? null : c.type;

  const grouped = view.result.groups;
  const resultRows = view.result.rows as unknown as Row[];
  const totalPages = Math.ceil(resultRows.length / pageSize);
  const paginated = useMemo(() => (resultRows.slice((page - 1) * pageSize, page * pageSize)), [resultRows, page, pageSize]);

  // Engine filters change resultRows without touching page — clamp to range.
  useEffect(() => { if (page > totalPages) setPage(1); }, [totalPages, page, setPage]);

  const toggleGroup = (key: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const handleImport = async (data: Record<string, unknown>[]) => {
    const mapped = data.map(row => ({
      po_number: String(row["PO Number"] || row["po_number"] || `PO-${Date.now()}`),
      vendor_name: String(row["Vendor Name"] || row["vendor_name"] || "") || null,
      status: String(row["Status"] || row["status"] || "") || null,
      team_status: String(row["Team Status"] || row["team_status"] || "") || null,
      factory_list: String(row["Factory List"] || row["factory_list"] || "") || null,
      country_of_origin: String(row["Country of Origin"] || row["country_of_origin"] || "") || null,
    }));
    const { error } = await supabase.from(TABLE_NAME).insert(mapped);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    toast.success(`Imported ${mapped.length} records`);
  };

  // In-app attachment preview (list cells) — opened via FilePreviewCtx.
  const [filePreview, setFilePreview] = useState<{ url: string; name: string } | null>(null);

  return (
    <FilePreviewCtx.Provider value={setFilePreview}>
    <div className="flex flex-col h-screen w-full overflow-hidden min-h-0" style={{ maxWidth: "none" }}>

      {/* Header */}
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
                <h1 className="text-sm font-semibold text-foreground leading-tight truncate">{title}</h1>
                <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => refetch()} disabled={isFetching} title="Refresh">
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </Button>
            <PermissionGuardButton canEdit={canEdit} variant="outline" size="sm" className="h-8" onClick={() => setImportOpen(true)}>
              <Upload className="h-3.5 w-3.5 mr-1" /> Import
            </PermissionGuardButton>
          </div>
        </div>
      </header>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-border bg-card/30 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search PO #, Vendor, Factory…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="h-8 pl-8 text-sm w-64"
          />
        </div>
        <TableViewToolbar view={view} fields={fields} className="ml-1" />
        <span className="ml-auto text-xs text-muted-foreground">
          {resultRows.length.toLocaleString()} record{resultRows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 relative overflow-auto" style={{ isolation: "isolate" }}>
        {error ? (
          <div className="flex items-center justify-center h-40 text-destructive text-sm">
            Error: {(error as any).message}
          </div>
        ) : (
          <table className="border-collapse text-sm min-w-full table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden" style={{ ["--app-td-py" as never]: `${view.rowPadYPx}px` }}>
            <colgroup>
              {visibleCols.map(col => (
                <col key={col.key} style={{ width: view.state.colWidths[col.key] ?? parseMinW(col.width) }} />
              ))}
              <col style={{ width: 110 }} />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                {visibleCols.map(col => (
                  <th key={col.key} onClick={() => view.toggleSort(col.key)}
                    className={cn(thBase, "relative", col.align === "center" && "text-center", col.align === "right" && "text-right", col.key === "po_number" && "sticky left-0 z-30")}>
                    {col.label} <SortIcon col={col.key} sortField={sortField} sortDir={sortDir} />
                    <ColResizeHandle onResize={(w) => view.setColWidth(col.key, w)} onReset={() => view.clearColWidth(col.key)} />
                  </th>
                ))}
                <th className={cn(thBase, "text-center cursor-default")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: visibleCols.length + 1 }).map((__, j) => (
                      <td key={j} className="app-td px-4 py-3"><Skeleton className="h-4 w-full rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : resultRows.length === 0 ? (
                <tr>
                  <td colSpan={visibleCols.length + 1} className="app-td text-center text-muted-foreground py-16">
                    No PO records found
                  </td>
                </tr>
              ) : (() => {
                const renderRow = (row: Row, idx: number) => {
                  const isOdd = idx % 2 === 1;
                  const stickyBg = cn("app-td-sticky", isOdd ? "bg-muted/30 group-hover:bg-muted/40" : "group-hover:bg-muted/40");
                  // Hover reveals only the lightweight "Open" shortcut (below);
                  // clicking the row is what reveals its cells as live editors —
                  // matches real Airtable, and avoids a hover-triggered "ripple".
                  const isRowHovered = canEdit; // hover is CSS (group-hover) — no table re-render per row
                  const isRowActive = canEdit && activeRowId === row.id;
                  return (
                    <tr key={row.id} data-row-id={row.id} style={{ height: view.rowHeightPx }}
                      onClick={() => canEdit && setActiveRowId(row.id)}
                      className={cn("group transition-colors duration-75 hover:bg-muted/40", isOdd && "bg-muted/20")}>
                      {visibleCols.map((col, i) => {
                        const kind = editKindOf(col);
                        const isDblClicked = !!editCell && editCell.id === row.id && editCell.key === col.key;
                        const stickyCls = cn("app-td whitespace-nowrap", col.align === "center" && "text-center", col.align === "right" && "text-right tabular-nums",
                          col.key === "po_number" && cn("font-medium sticky left-0 z-10", stickyBg));
                        // Column 0 gets a hover-reveal "Open ›" shortcut alongside its
                        // own text (never replacing it) — Airtable's row-hover pattern.
                        // It stays plain on hover (double-click still edits it) so the
                        // button has a stable place to sit.
                        if (i === 0 && isRowHovered) {
                          return (
                            <td key={col.key} className={stickyCls}>
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="truncate">{col.render(row)}</span>
                                <button type="button" onClick={() => openFullEditRow(row)}
                                  className="hidden group-hover:inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                                  Open <ChevronRight className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          );
                        }
                        // Hovering the row shows every editable cell in it as a live
                        // control (Airtable-style); double-click still works as a fallback.
                        if (canEdit && kind === "single" && (isRowActive || isDblClicked)) {
                          const isSticky = col.key === "po_number";
                          return (
                            // !overflow-visible — app-td normally clips (for text
                            // truncation), which would crop the dropdown panel on open.
                            <td key={col.key} className={cn(stickyCls, "!overflow-visible relative")}
                              style={{ zIndex: isSticky ? 10 : 20 }}>
                              <HoverSelectCell
                                value={String((row as any)[col.key] ?? "")}
                                options={fieldOptions[col.key] ?? []}
                                pillStyle={(v) => optionColor(col.key, v)}
                                onCommit={(v) => commit(row as any, col.key, v)}
                              />
                            </td>
                          );
                        }
                        return (
                          <EditableCell key={col.key}
                            className={stickyCls}
                            canEdit={canEdit} kind={kind} autoFocus={isDblClicked}
                            value={String((row as any)[col.key] ?? "")}
                            options={fieldOptions[col.key]}
                            editing={isDblClicked || (isRowActive && !!kind && i !== 0)}
                            onStart={() => setEditCell({ id: row.id, key: col.key })}
                            onCancel={() => setEditCell(null)}
                            onCommit={(v) => commit(row as any, col.key, v)}
                          >
                            {col.render(row)}
                          </EditableCell>
                        );
                      })}
                      <td className="app-td app-td-sticky text-center whitespace-nowrap w-[110px]" style={{ position: "sticky", right: 0, zIndex: 10 }}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="app-action-trigger">Action <ChevronDown className="app-action-trigger-chevron" /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openFullEditRow(row)}>
                              <Maximize2 className="h-3.5 w-3.5 mr-2" /> Full Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => deleteMutation.mutate(row.id)}>
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                };

                // Grouped view: section headers + rows (no pagination so groups stay intact).
                if (grouped) {
                  const groupLabel = fields.find(f => f.key === view.state.groupBy)?.label ?? "";
                  return grouped.flatMap(bucket => {
                    const isCollapsed = collapsed.has(bucket.key);
                    const header = (
                      <tr key={`g-${bucket.key}`} className="bg-muted/60 hover:bg-muted/60">
                        <td colSpan={visibleCols.length + 1} className="app-td px-3 py-2 cursor-pointer" onClick={() => toggleGroup(bucket.key)}>
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {groupLabel}: {bucket.label}
                            <span className="font-normal text-muted-foreground">({bucket.rows.length})</span>
                          </span>
                        </td>
                      </tr>
                    );
                    return isCollapsed ? [header] : [header, ...(bucket.rows as unknown as Row[]).map((r, i) => renderRow(r, i))];
                  });
                }
                return paginated.map((row, idx) => renderRow(row, idx));
              })()}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer / Pagination — hidden while grouped (groups render in full). */}
      {!grouped && (
        <div className={cn("shrink-0", isLoading && "invisible")}>
          <TablePagination
            currentPage={page}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={resultRows.length}
            onPageChange={setPage}
            onPageSizeChange={size => { setPageSize(size); setPage(1); }}
            pageSizeOptions={[25, 50, 100, 200, 500]}
          />
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={closeEditModal}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit PO — {editRow?.po_number}</DialogTitle>
          </DialogHeader>
          {editRow && (
            <div className="grid grid-cols-3 gap-4 py-4">
              <div className="space-y-1.5">
                <Label>PO Number</Label>
                <Input value={editRow.po_number} onChange={e => setEditRow({ ...editRow, po_number: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Vendor Name</Label>
                <Input value={editRow.vendor_name ?? ""} onChange={e => setEditRow({ ...editRow, vendor_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <QuickSelect colKey="status" value={editRow.status ?? ""} options={fieldOptions.status}
                  onChange={v => setEditRow({ ...editRow, status: v })} />
              </div>
              <div className="space-y-1.5">
                <Label>Team Status</Label>
                <QuickSelect colKey="team_status" value={editRow.team_status ?? ""} options={fieldOptions.team_status}
                  onChange={v => setEditRow({ ...editRow, team_status: v })} />
              </div>
              <div className="space-y-1.5">
                <Label>Factory List</Label>
                <QuickSelect colKey="factory_list" value={editRow.factory_list ?? ""} options={fieldOptions.factory_list}
                  onChange={v => setEditRow({ ...editRow, factory_list: v })} />
              </div>
              <div className="space-y-1.5">
                <Label>Country of Origin</Label>
                <QuickSelect colKey="country_of_origin" value={editRow.country_of_origin ?? ""} options={fieldOptions.country_of_origin}
                  onChange={v => setEditRow({ ...editRow, country_of_origin: v })} />
              </div>
              <div className="space-y-1.5">
                <Label># Products</Label>
                <Input type="number" value={editRow.of_products ?? ""} onChange={e => setEditRow({ ...editRow, of_products: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div className="space-y-1.5">
                <Label>Created On</Label>
                <Input value={editRow.created_on ?? ""} onChange={e => setEditRow({ ...editRow, created_on: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Invoice Date</Label>
                <Input value={editRow.invoice_date ?? ""} onChange={e => setEditRow({ ...editRow, invoice_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Expected Delivery</Label>
                <Input value={editRow.expected_delivery ?? ""} onChange={e => setEditRow({ ...editRow, expected_delivery: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Received Date</Label>
                <Input value={editRow.received_date ?? ""} onChange={e => setEditRow({ ...editRow, received_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Ship</Label>
                <Input value={editRow.ship ?? ""} onChange={e => setEditRow({ ...editRow, ship: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Receive</Label>
                <Input value={editRow.receive ?? ""} onChange={e => setEditRow({ ...editRow, receive: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Status</Label>
                <QuickSelect colKey="payment_status_finance" value={editRow.payment_status_finance ?? ""} options={fieldOptions.payment_status_finance}
                  onChange={v => setEditRow({ ...editRow, payment_status_finance: v })} />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Approved</Label>
                <Input value={String(editRow.payment_approved_lead ?? "")} onChange={e => setEditRow({ ...editRow, payment_approved_lead: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Deposit %</Label>
                <Input type="number" value={editRow.deposit_percentage ?? ""} onChange={e => setEditRow(withDeposit({ ...editRow, deposit_percentage: e.target.value ? Number(e.target.value) : null }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Grand Total</Label>
                <POCurrency value={editRow.grand_total} onChange={n => setEditRow(withDeposit({ ...editRow, grand_total: n }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Calc. Deposit <span className="text-muted-foreground font-normal">(auto: % × grand total)</span></Label>
                <div className="h-9 flex items-center px-3 rounded-md border bg-muted/40 text-sm tabular-nums">
                  {fmtCurrency(calcDepositAmount(editRow.deposit_percentage, editRow.grand_total, editRow.calculated_deposit_amount))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Actual Deposit</Label>
                <POCurrency value={editRow.actual_deposit_amount} onChange={n => setEditRow({ ...editRow, actual_deposit_amount: n })} />
              </div>
              <div className="col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t pt-4">
                <div className="space-y-1.5">
                  <Label>PO Request File</Label>
                  <POAttachment value={editRow.po_request_files} onChange={files => setEditRow({ ...editRow, po_request_files: files })} minH="min-h-[120px]" />
                </div>
                <div className="space-y-1.5">
                  <Label>PO File</Label>
                  <POAttachment value={editRow.po_files} onChange={files => setEditRow({ ...editRow, po_files: files })} minH="min-h-[120px]" />
                </div>
                <div className="space-y-1.5">
                  <Label>PI File (Proforma Invoice)</Label>
                  <POAttachment value={editRow.pi_file} onChange={files => setEditRow({ ...editRow, pi_file: files })} minH="min-h-[120px]" />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={() => editRow && updateMutation.mutate(editRow)} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full-screen sectioned editor */}
      <POFullEditDialog
        open={fullEditOpen}
        onOpenChange={closeFullEdit}
        poId={fullEditId}
        tableName={TABLE_NAME}
        canEdit={canEdit}
        onSaved={() => { queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }); }}
        onDeleted={(id) => { queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }); logActivity({ action: "Deleted", entityType: "Order Pipeline", entityId: id, entityName: id }); }}
      />

      <CSVImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={handleImport}
        expectedColumns={["PO Number", "Vendor Name", "Status", "Team Status", "Factory List", "Country of Origin"]}
        title={`Import ${title}`}
      />
      {tabGroup && <OrderDashboardTabs group={tabGroup} activeTab="po" />}
      {filePreview && <FilePreviewOverlay file={filePreview} onClose={() => setFilePreview(null)} />}
    </div>
    </FilePreviewCtx.Provider>
  );
}

/* ── Full-screen sectioned PO editor ──────────────────────────────────
 * Fetches the FULL external row (select *), arranges recognized columns into
 * titled sections (per the Airtable design), and surfaces every remaining real
 * column under "Other Fields" so nothing is hidden — this is how we learn the
 * exact external key names. Every field is editable; Save writes all columns. */

// Real external po_tracker columns → sections (order mirrors the Airtable design).
type POSection = { title: string; keys: string[]; cols?: 1 | 2 | 3 | 4; tinted?: boolean; collapsible?: boolean; defaultCollapsed?: boolean; alwaysKeys?: string[] };
// Attachment uploads reuse the existing public storage bucket.
const PO_BUCKET = "packing-lists";
const PO_SECTIONS: POSection[] = [
  { title: "Team Input", tinted: true, cols: 3, keys: ["team_status", "type", "target_completion_date", "late_po"] },
  { title: "PO Summary", collapsible: true, cols: 4, keys: ["of_products", "units", "vendor_name", "vendor_id", "warehouse", "company_name", "po_created_by", "approved", "created_on", "ordered_on", "original_cargo_ready_date", "expected_delivery", "received_date", "priority", "ship", "receive", "status", "factory_list", "country_of_origin"] },
  { title: "Financial Summary", collapsible: true, cols: 4, keys: ["shipping_total", "discount_total", "other_total", "balance", "sub_total", "grand_total", "payment", "balance_not_received_goods"] },
  { title: "PO Items", collapsible: true, defaultCollapsed: true, cols: 2, keys: ["product_list", "product_list_from_po_items", "product_sku_s", "number_of_container"] },
  { title: "Documents", cols: 2, keys: ["po_request_files", "po_files", "po_link"], alwaysKeys: ["po_request_files", "po_files", "po_link"] },
  { title: "Proforma Invoice Information (PI)", cols: 3, keys: ["pi_status", "pi_received_date", "vendor_pi", "vendor_invoice_number", "payment_terms", "pi_file"], alwaysKeys: ["pi_file"] },
  { title: "Deposit Information", cols: 3, keys: ["deposit_percentage", "calculated_deposit_amount", "actual_deposit_amount", "payment_approved_lead", "payment_status_finance", "deposit_payment_date", "invoice_date", "bank_slip_files"], alwaysKeys: ["bank_slip_files"] },
];

// Editors keyed by column: pill/select options, checkboxes, currency.
const PO_BOOL_KEYS = new Set(["late_po", "payment_approved_lead"]);
const PO_CURRENCY_KEYS = new Set(["sub_total", "discount_total", "shipping_total", "shipping_total_3rd_party", "other_total", "tax_total", "small_order_fee", "dropship_fee", "grand_total", "payment", "balance", "balance_not_received_goods", "calculated_deposit_amount", "actual_deposit_amount"]);
const PO_ATTACHMENT_KEYS = new Set(["po_request_files", "po_files", "pi_file", "bank_slip_files"]);
// Friendly labels for the app's jsonb attachment columns + remapped fields.
const PO_LABEL_OVERRIDE: Record<string, string> = {
  po_request_files: "PO Request",
  po_files: "PO",
  pi_file: "PI File",
  bank_slip_files: "Bank Slip",
  po_link: "PO Link",
  type: "PO Type",
  of_products: "# Of Products",
  po_created_by: "PO Created By",
  vendor_id: "Vendor ID",
  ship: "Ship Status",
  receive: "Receiving Status",
  status: "PO Status",
  original_cargo_ready_date: "Original Cargo Ready Date",
};
// Columns with a fixed single-select option list (Airtable "PO Type" = `type`).
const PO_SELECT_OPTIONS: Record<string, string[]> = {
  type: ["Initial Order", "Repeat Order"],
};
// Single-select status columns rendered as colored pill-selects.
const PO_STATUS_KEYS = new Set(["team_status", "type", "pi_status", "status", "priority", "ship", "receive", "payment_status_finance", "factory_list", "country_of_origin"]);
// Known option lists (from the data) so the dropdowns are always populated/editable
// even before the async distinct-fetch resolves. Merged with fetched + current value.
const PO_KNOWN_OPTIONS: Record<string, string[]> = {
  priority: ["Normal", "High"],
  ship: ["None", "Partly Shipped", "Shipped"],
  receive: ["None", "Partly Received", "Received"],
  status: ["Draft", "Cancelled", "Completed"],
  pi_status: ["Quote Requested", "Quote Received"],
  team_status: ["Draft — Quote Needed", "Awaiting Quote", "Deposit Requested", "Confirmed", "Hold", "Quote Issue"],
};
// Exact Airtable colors for known options; anything else uses a stable hash color.
const PO_OPTION_COLORS: Record<string, Record<string, { bg: string; text: string }>> = {
  type: { "Initial Order": { bg: "#FEF3C7", text: "#92400E" }, "Repeat Order": { bg: "#cfe9e9", text: "#0c4849" } },
  team_status: { "Awaiting Quote": { bg: "#cfe9e9", text: "#0c4849" } },
  pi_status: { "Quote Requested": { bg: "#FBBF24", text: "#78350F" } },
  status: { "Draft": { bg: "#FED7AA", text: "#9A3412" } },
};
const optionColor = (key: string, val: string) => PO_OPTION_COLORS[key]?.[val] ?? hashColor(val);
const PO_GRID_CLASS: Record<number, string> = {
  1: "grid grid-cols-1 gap-x-6 gap-y-4",
  2: "grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4",
  3: "grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4",
  4: "grid grid-cols-1 sm:grid-cols-4 gap-x-6 gap-y-4",
};

const PO_META_KEYS = new Set(["id", "tenant_id", "created_at", "updated_at", "row_hash", "created_time", "last_modified"]);

function prettyLabel(key: string): string {
  return PO_LABEL_OVERRIDE[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Currency input: shows "$11,814.20" when idle, raw number while editing. */
function POCurrency({ value, onChange }: { value: any; onChange: (v: number | null) => void }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const num = value === "" || value == null ? null : Number(value);
  const display = num == null || isNaN(num) ? "" : `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={focused ? draft : display}
      onFocus={() => { setDraft(num == null ? "" : String(num)); setFocused(true); }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => { setFocused(false); const raw = e.target.value.replace(/[$,]/g, "").trim(); onChange(raw === "" ? null : Number(raw)); }}
      className="h-9 text-sm"
    />
  );
}

// Dropzone heights matching the Airtable record layout proportions.
const PO_ATTACHMENT_HEIGHT: Record<string, string> = {
  po_request_files: "min-h-[300px]",
  po_files: "min-h-[300px]",
  pi_file: "min-h-[200px]",
  bank_slip_files: "min-h-[220px]",
};

/** Minimal CSV parser -- handles quoted fields (with embedded commas/quotes)
 *  well enough for a preview; doesn't need to be a full RFC 4180 parser. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Draws a static preview image of a spreadsheet's first rows/columns onto a
 *  canvas (mini grid, header row shaded) -- entirely client-side, no backend
 *  conversion service needed. Returns a PNG blob, or null if there's nothing
 *  drawable. Shared by both the csv and xlsx thumbnail generators below. */
async function drawGridThumbnail(fullRows: string[][]): Promise<Blob | null> {
  const rows = fullRows.slice(0, 8).map((r) => r.slice(0, 6));
  if (!rows.length) return null;
  const W = 320, H = 200, colW = W / (rows[0].length || 1), rowH = H / rows.length;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  ctx.font = "9px Arial"; ctx.textBaseline = "middle";
  rows.forEach((row, ri) => {
    ctx.fillStyle = ri === 0 ? "#e5e7eb" : ri % 2 ? "#ffffff" : "#f9fafb";
    ctx.fillRect(0, ri * rowH, W, rowH);
    ctx.strokeStyle = "#d1d5db"; ctx.lineWidth = 1;
    ctx.strokeRect(0, ri * rowH, W, rowH);
    ctx.fillStyle = "#374151";
    row.forEach((cell, ci) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ci * colW, ri * rowH, colW, rowH);
      ctx.clip();
      ctx.strokeRect(ci * colW, ri * rowH, colW, rowH);
      ctx.fillText(String(cell).slice(0, 14), ci * colW + 3, ri * rowH + rowH / 2);
      ctx.restore();
    });
  });
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

async function generateCsvThumbnail(text: string): Promise<Blob | null> {
  return drawGridThumbnail(parseCsv(text));
}

/** Reads the first worksheet's first rows/cols via the exceljs dependency
 *  already used elsewhere in this app for xlsx export, so no new package is
 *  needed to support xlsx thumbnails the same way csv ones work. */
async function generateXlsxThumbnail(file: File): Promise<Blob | null> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) return null;
  const rows: string[][] = [];
  for (let r = 1; r <= Math.min(8, sheet.rowCount); r++) {
    const row: string[] = [];
    const excelRow = sheet.getRow(r);
    for (let c = 1; c <= 6; c++) {
      const cell = excelRow.getCell(c).value;
      row.push(cell == null ? "" : typeof cell === "object" ? String((cell as any).text ?? (cell as any).result ?? "") : String(cell));
    }
    rows.push(row);
  }
  return drawGridThumbnail(rows);
}

const CSV_PREVIEW_MAX_ROWS = 200;

/** MS Office Online doesn't render .csv (confirmed live), so this renders it
 *  as a real HTML table client-side instead of relying on an external viewer. */
function CsvPreview({ url }: { url: string }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRows(null); setError(null);
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!cancelled) setRows(parseCsv(text));
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load file");
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <div className="flex h-full items-center justify-center text-sm text-destructive">Couldn't load preview: {error}</div>;
  if (!rows) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading preview…</div>;
  if (!rows.length) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Empty file.</div>;

  const shown = rows.slice(0, CSV_PREVIEW_MAX_ROWS);
  return (
    <div className="h-full overflow-auto p-2">
      {rows.length > CSV_PREVIEW_MAX_ROWS && (
        <div className="mb-2 text-xs text-muted-foreground">Showing first {CSV_PREVIEW_MAX_ROWS} of {rows.length} rows.</div>
      )}
      <table className="border-collapse text-xs">
        <tbody>
          {shown.map((r, ri) => (
            <tr key={ri} className={ri === 0 ? "bg-muted font-semibold" : ri % 2 ? "bg-background" : "bg-muted/20"}>
              {r.map((cell, ci) => (
                <td key={ci} className="border px-2 py-1 whitespace-nowrap">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Airtable-style attachment dropzone: shows existing files, drop/browse to
 *  upload to the shared public bucket, stored as a jsonb array on the column. */
function POAttachment({
  value, onChange, minH = "min-h-[200px]", persist,
}: {
  value: any;
  onChange: (files: any[]) => void;
  minH?: string;
  // When provided, upload/remove write straight to the DB (in addition to
  // updating local form state), so the file is never lost if the user
  // closes the dialog without clicking the separate Save button -- matches
  // how every other attachment field in this app (Pay Slip, Packing List)
  // already behaves.
  persist?: (files: any[]) => Promise<void>;
}) {
  const files: any[] = Array.isArray(value) ? value : [];
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const upload = async (list: FileList | null) => {
    if (!list || !list.length) return;
    setBusy(true);
    try {
      const added: any[] = [];
      for (const file of Array.from(list)) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
        const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        const path = `po/${stamp}.${ext}`;
        const { error } = await (supabase as any).storage.from(PO_BUCKET).upload(path, file, { upsert: true });
        if (error) throw error;
        const { data: { publicUrl } } = (supabase as any).storage.from(PO_BUCKET).getPublicUrl(path);
        const entry: any = { filename: file.name, url: publicUrl, type: file.type };
        // Generate a static thumbnail client-side for csv/xlsx (no backend
        // conversion service needed) -- best-effort, a failed thumbnail
        // shouldn't block the actual upload.
        const isCsvFile = /\.csv$/i.test(file.name);
        const isXlsxFile = /\.(xlsx|xlsm|xltx|xltm)$/i.test(file.name);
        if (isCsvFile || isXlsxFile) {
          try {
            const blob = isCsvFile ? await generateCsvThumbnail(await file.text()) : await generateXlsxThumbnail(file);
            if (!blob) {
              console.warn("[PO thumbnail] generator returned null (empty/unparseable file?)");
            } else {
              const thumbPath = `po/${stamp}-thumb.png`;
              const { error: thumbErr } = await (supabase as any).storage.from(PO_BUCKET).upload(thumbPath, blob, { upsert: true, contentType: "image/png" });
              if (thumbErr) {
                console.error("[PO thumbnail] upload failed:", thumbErr);
                toast.error("Thumbnail upload failed: " + thumbErr.message);
              } else {
                const { data: { publicUrl: thumbUrl } } = (supabase as any).storage.from(PO_BUCKET).getPublicUrl(thumbPath);
                entry.thumbnail_url = thumbUrl;
              }
            }
          } catch (e: any) {
            console.error("[PO thumbnail] generation threw:", e);
            toast.error("Thumbnail generation failed: " + (e?.message ?? String(e)));
          }
        }
        added.push(entry);
      }
      const next = [...files, ...added];
      onChange(next);
      if (persist) await persist(next);
      toast.success(`Uploaded ${added.length} file${added.length > 1 ? "s" : ""}`);
    } catch (e: any) {
      toast.error("Upload failed: " + (e?.message ?? "error"));
    } finally { setBusy(false); }
  };
  const remove = async (i: number) => {
    const next = files.filter((_, j) => j !== i);
    onChange(next);
    if (persist) await persist(next);
  };
  const isImage = (f: any) => String(f?.type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(String(f?.filename || f?.url || ""));
  // MS Office Online doesn't actually render .csv (confirmed live -- shows
  // its own "File not found" error page), so it's deliberately excluded here.
  const isOfficeDoc = (f: any) => /\.(xlsx|xlsm|xlsb|xls|xltx|xltm|doc|docx|docm|ppt|pptx|pptm)$/i.test(String(f?.filename || f?.url || ""));
  const isPdf = (f: any) => String(f?.type || "") === "application/pdf" || /\.pdf$/i.test(String(f?.filename || f?.url || ""));
  const isCsv = (f: any) => /\.csv$/i.test(String(f?.filename || f?.url || ""));
  return (
    <div className="rounded-md border bg-muted/20 overflow-hidden">
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files); }}
        className={cn(minH, "flex flex-wrap gap-2 items-center justify-center p-3 text-center")}>
        {files.length ? files.map((f, i) => {
          const url = String(f?.url || "");
          const name = String(f?.filename || url.split("/").pop() || `file ${i + 1}`);
          if (isImage(f)) {
            return (
              <div key={i} className="group relative h-full w-full max-h-full overflow-hidden rounded border bg-background">
                <img src={url} alt={name} className="h-full w-full object-contain cursor-pointer" onClick={() => setPreview({ url, name })} />
                <button type="button" onClick={() => void remove(i)}
                  className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1 text-muted-foreground opacity-0 shadow group-hover:opacity-100 hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          }
          // Client-side-generated static thumbnail (currently csv only) --
          // shows an actual mini preview of the content instead of a bare
          // filename chip. Clicking still opens the full-size live preview.
          if (f?.thumbnail_url) {
            return (
              <div key={i} className="group relative h-full w-full max-h-full overflow-hidden rounded border bg-background">
                <img src={String(f.thumbnail_url)} alt={name} className="h-full w-full object-contain object-top cursor-pointer" onClick={() => setPreview({ url, name })} />
                <div className="absolute bottom-0 left-0 right-0 truncate bg-background/90 px-2 py-1 text-[11px]">{name}</div>
                <button type="button" onClick={() => void remove(i)}
                  className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1 text-muted-foreground opacity-0 shadow group-hover:opacity-100 hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          }
          // Inline-embedding the Office viewer was tried and looked broken at
          // this box size (esp. for .csv) -- fall back to a plain filename
          // chip that opens the full-size preview modal on click instead.
          return (
            <span key={i} className="group inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs max-w-[200px]">
              {(isOfficeDoc(f) || isPdf(f) || isCsv(f)) && /^https?:/.test(url) ? (
                <button type="button" onClick={() => setPreview({ url, name })} className="truncate hover:underline text-left">{name}</button>
              ) : (
                <a href={/^https?:/.test(url) ? url : "#"} target="_blank" rel="noreferrer" className="truncate hover:underline">{name}</a>
              )}
              <button type="button" onClick={() => void remove(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
            </span>
          );
        }) : (
          <span className="text-sm text-muted-foreground">{busy ? "Uploading…" : "Drop files here or "}
            {!busy && <label className="text-primary cursor-pointer hover:underline">browse<input type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} /></label>}
          </span>
        )}
      </div>
      <div className="flex justify-end border-t bg-background/60 px-2 py-1.5">
        <label className="inline-flex items-center gap-1 text-xs rounded-md border px-2 py-1 cursor-pointer hover:bg-muted">
          <Paperclip className="h-3 w-3" /> Attach file
          <input type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
        </label>
      </div>
      {preview && <FilePreviewOverlay file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

const PO_LOG_TYPES = ["Notes", "Reminders", "Log"];
const poLogColor = (t: string) => t === "Reminders" ? { bg: "#EA580C", text: "#fff" } : t === "Log" ? { bg: "#14B8A6", text: "#fff" } : { bg: "#FEF3C7", text: "#92400E" };
const initialsOf = (n: string | null) => (n ?? "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const fmtLog = (iso: string | null) => {
  if (!iso) return { date: "—", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "—", time: "" };
  return { date: d.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" }), time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s/g, "") };
};

/** "PO Log" sub-records (po_notes). Grouped-by-type table + Add Log Record modal. */
function POLogField({ poId }: { poId: number | null }) {
  const { profile } = useAuth();
  const [notes, setNotes] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const load = React.useCallback(async () => {
    if (!poId) { setNotes([]); return; }
    const { data } = await (supabase as any).from("po_notes").select("*").eq("po_id", poId).order("created_at", { ascending: false });
    setNotes((data ?? []) as any[]);
  }, [poId]);
  useEffect(() => { void load(); }, [load]);

  const myName = profile?.full_name || profile?.email?.split("@")[0] || "User";
  const create = async () => {
    if (!poId || !type || !content.trim()) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("po_notes").insert({ po_id: poId, note_type: type, content: content.trim(), created_by: myName, author_id: profile?.id ?? null });
      if (error) throw error;
      setType(""); setContent(""); setOpen(false); await load();
    } catch (e: any) { toast.error("Failed to add log: " + e.message); } finally { setSaving(false); }
  };
  const del = async (id: number) => {
    try { const { error } = await (supabase as any).from("po_notes").delete().eq("id", id); if (error) throw error; await load(); }
    catch (e: any) { toast.error("Failed to delete: " + e.message); }
  };

  // Group by type (preserving insertion order of types).
  const groups: { type: string; rows: any[] }[] = [];
  for (const n of notes) {
    const t = n.note_type || "Notes";
    let g = groups.find((x) => x.type === t);
    if (!g) { g = { type: t, rows: [] }; groups.push(g); }
    g.rows.push(n);
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b pb-2">
        <h3 className="text-base font-bold tracking-tight text-foreground inline-flex items-center gap-1.5"><span aria-hidden>📋</span> PO Log</h3>
        <Button size="sm" className="h-8" disabled={!poId} onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Add Log Record</Button>
      </div>
      {!poId ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Save the record first to add logs</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No records yet</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.type} className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span style={{ ...pill(poLogColor(g.type).bg, poLogColor(g.type).text) }}>{g.type}</span>
                <span>{g.rows.length}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[12px] text-muted-foreground border-b">
                    <th className="font-medium py-1.5 pr-4">Content</th>
                    <th className="font-medium py-1.5 pr-4 w-[160px]">Created By</th>
                    <th className="font-medium py-1.5 pr-4 w-[170px]">Created Date</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((n) => { const c = fmtLog(n.created_at); return (
                    <tr key={n.id} className="border-b last:border-0 group">
                      <td className="py-2 pr-4">{n.content || "—"}</td>
                      <td className="py-2 pr-4">{n.created_by ? <span className="inline-flex items-center gap-1.5"><span className="h-5 w-5 rounded-full bg-primary/15 text-primary text-[10px] font-semibold flex items-center justify-center">{initialsOf(n.created_by)}</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{n.created_by}</span></span> : "—"}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{c.date}{c.time && <span className="ml-2">{c.time}</span>}</td>
                      <td className="py-2 text-right"><button type="button" onClick={() => void del(n.id)} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setType(""); setContent(""); } }}>
        <DialogContent className="max-w-3xl w-[95vw] h-[85vh] max-h-[85vh] p-0 gap-0 !flex flex-col overflow-hidden">
          <div className="px-8 pt-8 pb-4 border-b shrink-0"><DialogTitle className="text-3xl font-bold tracking-tight">New PO Log</DialogTitle></div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-8 py-6 space-y-6">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Type <span className="text-destructive">*</span></label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="" /></SelectTrigger>
                  <SelectContent>{PO_LOG_TYPES.map((o) => <SelectItem key={o} value={o}><span style={{ ...pill(poLogColor(o).bg, poLogColor(o).text) }}>{o}</span></SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Content <span className="text-destructive">*</span></label>
                <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[120px] text-sm resize-y" />
              </div>
            </div>
          </ScrollArea>
          <DialogFooter className="px-8 py-4 border-t shrink-0 sm:justify-between">
            <Button variant="ghost" className="text-primary hover:text-primary" onClick={() => { setType(""); setContent(""); }}><RotateCcw className="h-4 w-4 mr-1.5" /> Clear form</Button>
            <Button onClick={() => void create()} disabled={saving || !type || !content.trim()}>{saving ? "Creating…" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function POFullEditDialog({
  open, onOpenChange, poId, tableName, canEdit, onSaved, onDeleted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  poId: string | null;
  tableName: string;
  canEdit: boolean;
  onSaved: () => void;
  onDeleted: (id: string) => void;
}) {
  const { profile } = useAuth();
  const [form, setForm] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(PO_SECTIONS.filter((s) => s.defaultCollapsed).map((s) => s.title))
  );
  const toggleSection = (t: string) => setCollapsed((prev) => {
    const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n;
  });

  // ── Comments (po_comments, keyed by po_id) ──
  const numId = poId ? Number(poId) : null;
  const [comments, setComments] = useState<any[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentSending, setCommentSending] = useState(false);
  useEffect(() => {
    if (!open || !numId) { setComments([]); return; }
    let cancelled = false;
    setCommentsLoading(true);
    (async () => {
      const { data } = await (supabase as any).from("po_comments").select("*").eq("po_id", numId).order("created_at", { ascending: true });
      if (!cancelled) { setComments((data ?? []) as any[]); setCommentsLoading(false); }
    })();
    const ch = (supabase as any).channel(`po_comments_${numId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "po_comments", filter: `po_id=eq.${numId}` },
        (p: any) => setComments((prev) => prev.some((c) => c.id === p.new.id) ? prev : [...prev, p.new]))
      .subscribe();
    return () => { cancelled = true; (supabase as any).removeChannel(ch); };
  }, [open, numId]);
  const addComment = async () => {
    const body = commentBody.trim();
    if (!body || !numId) return;
    setCommentSending(true);
    try {
      const author_name = profile?.full_name || profile?.email?.split("@")[0] || "User";
      const { data, error } = await (supabase as any).from("po_comments")
        .insert({ po_id: numId, author_id: profile?.id ?? null, author_name, body }).select().single();
      if (error) throw error;
      setCommentBody("");
      if (data) setComments((prev) => prev.some((c) => c.id === data.id) ? prev : [...prev, data]);
    } catch (e: any) { toast.error("Failed to add comment: " + e.message); } finally { setCommentSending(false); }
  };

  const [selOpts, setSelOpts] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!open || !poId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await (supabase as any).from(tableName).select("*").eq("id", poId).maybeSingle();
      if (cancelled) return;
      if (error) toast.error("Failed to load PO: " + error.message);
      setForm(data ? { ...data } : {});
      setLoading(false);
    })();
    // Distinct option lists for the colored status selects (excludes fixed-option cols).
    (async () => {
      const cols = [...PO_STATUS_KEYS].filter((k) => !PO_SELECT_OPTIONS[k]);
      const entries = await Promise.all(cols.map(async (col) => {
        const { data } = await (supabase as any).from(tableName).select(col).not(col, "is", null).limit(2000);
        const vals = [...new Set((data ?? []).map((r: any) => String(r[col] ?? "")).filter(Boolean))].sort();
        return [col, vals] as [string, string[]];
      }));
      if (!cancelled) setSelOpts(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [open, poId, tableName]);

  const set = (k: string, v: unknown) => setForm((p) => ({ ...p, [k]: v }));
  // Attachments persist immediately on upload/remove (not just on the
  // dialog's Save button) -- matches Pay Slip/Packing List elsewhere in the
  // app, and stops an upload from being silently lost if the user closes
  // the dialog without clicking Save.
  const persistAttachment = async (key: string, files: any[]) => {
    if (!poId) return;
    // .select() so we can tell a genuine write from a silent no-op (RLS or a
    // bad filter can make Postgres report success while matching zero rows,
    // and the plain update() call can't tell those apart).
    const { data, error } = await (supabase as any).from(tableName).update({ [key]: files }).eq("id", poId).select("id");
    if (error) toast.error("Failed to save attachment: " + error.message);
    else if (!data || data.length === 0) toast.error(`Attachment upload wasn't saved -- no row matched id ${poId} in ${tableName} (permissions?)`);
  };

  const handleSave = async () => {
    if (!poId) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) if (!PO_META_KEYS.has(k)) payload[k] = v === "" ? null : v;
      // Calc. Deposit is a formula field — persist the derived value.
      payload.calculated_deposit_amount = calcDepositAmount(
        form.deposit_percentage as number | null,
        form.grand_total as number | null,
        (form.calculated_deposit_amount as number | null) ?? null,
      );
      const { error } = await (supabase as any).from(tableName).update(payload).eq("id", poId);
      if (error) throw error;
      toast.success("PO updated");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Update failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!poId) return;
    try {
      const { error } = await (supabase as any).from(tableName).delete().eq("id", poId);
      if (error) throw error;
      toast.success("PO deleted");
      onDeleted(poId);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Delete failed: " + e.message);
    }
  };

  // Per-field editor — control chosen from the column's known shape, then value.
  const renderField = (key: string) => {
    const v = form[key];
    const isDate = /(_date|_on|delivery|eta|cargo_ready)$/.test(key) || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
    let control: React.ReactNode;
    if (PO_STATUS_KEYS.has(key)) {
      const cur = String(v ?? "");
      const options = [...new Set([cur, ...(PO_SELECT_OPTIONS[key] ?? []), ...(PO_KNOWN_OPTIONS[key] ?? []), ...(selOpts[key] ?? [])].filter(Boolean))];
      const c = cur ? optionColor(key, cur) : null;
      control = (
        <Select value={cur} onValueChange={(val) => set(key, val)}>
          <SelectTrigger className={cn("h-9 text-sm", c && "border-transparent")} style={c ? { backgroundColor: c.bg, color: c.text } : undefined}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => <SelectItem key={o} value={o}><span style={{ ...pill(optionColor(key, o).bg, optionColor(key, o).text) }}>{o}</span></SelectItem>)}
          </SelectContent>
        </Select>
      );
    } else if (PO_BOOL_KEYS.has(key) || typeof v === "boolean") {
      const on = v === true || v === "true" || v === "checked" || v === 1;
      control = <div className="flex items-center h-9"><Checkbox checked={on} onCheckedChange={(c) => set(key, !!c)} /></div>;
    } else if (PO_ATTACHMENT_KEYS.has(key)) {
      control = <POAttachment value={v} onChange={(files) => set(key, files)} minH={PO_ATTACHMENT_HEIGHT[key]} persist={(files) => persistAttachment(key, files)} />;
    } else if (key === "po_link") {
      control = <Input value={String(v ?? "")} onChange={(e) => set(key, e.target.value)} placeholder="https://…" className="h-9 text-sm" />;
    } else if (PO_CURRENCY_KEYS.has(key)) {
      control = <POCurrency value={v} onChange={(n) => set(key, n)} />;
    } else if (typeof v === "number") {
      control = <Input type="number" value={v ?? ""} onChange={(e) => set(key, e.target.value === "" ? null : Number(e.target.value))} className="h-9 text-sm" />;
    } else if (isDate) {
      control = <Input type="date" value={String(v ?? "").slice(0, 10)} onChange={(e) => set(key, e.target.value)} className="h-9 text-sm" />;
    } else if (key === "notes" || key.includes("comment") || key.includes("terms") || key.includes("product") || key.includes("account") || (typeof v === "string" && v.length > 80)) {
      control = <Textarea value={String(v ?? "")} onChange={(e) => set(key, e.target.value)} className="min-h-[64px] text-sm resize-y" />;
    } else {
      control = <Input value={String(v ?? "")} onChange={(e) => set(key, e.target.value)} className="h-9 text-sm" />;
    }
    return (
      <div key={key} className="space-y-1.5 min-w-0">
        <label className="text-[13px] font-medium text-muted-foreground">{prettyLabel(key)}</label>
        <div className="min-w-0">{control}</div>
      </div>
    );
  };

  const allKeys = Object.keys(form);
  const title = String(form["po_number"] ?? "");

  // Read-only display cell (used for computed/summary values shown as plain text).
  const plainVal = (key: string, cls = "text-sm text-foreground") => (
    <div key={key} className="space-y-1.5 min-w-0">
      <label className="text-[13px] font-medium text-muted-foreground">{prettyLabel(key)}</label>
      <div className={cn(cls, "py-1")}>{form[key] == null || form[key] === "" ? "—" : (/(_date|_on)$/.test(key) ? fmtDate(String(form[key])) : String(form[key]))}</div>
    </div>
  );

  // Team Input: Team Status full-width, then PO Type / Target / Late PO row.
  const poTeamBody = (
    <div className="space-y-4">
      {renderField("team_status")}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
        {renderField("type")}
        {renderField("target_completion_date")}
        {renderField("late_po")}
      </div>
    </div>
  );

  // Hand-crafted PO Summary matching the Airtable layout exactly:
  // narrow left column (# Of Products display + Units) beside a 3-col grid,
  // then dates, Original CRD (plain), and the 4-up status row.
  const poSummaryBody = (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-x-6 gap-y-4">
        <div className="sm:row-span-2 space-y-4">
          {plainVal("of_products", "text-2xl font-bold text-foreground")}
          {renderField("units")}
        </div>
        {renderField("vendor_name")}
        {renderField("vendor_id")}
        {renderField("warehouse")}
        {renderField("company_name")}
        {renderField("po_created_by")}
        {renderField("approved")}
      </div>
      <div className="border-t pt-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 sm:w-2/3">
          {renderField("created_on")}
          {renderField("ordered_on")}
        </div>
        {plainVal("original_cargo_ready_date")}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          {renderField("expected_delivery")}
          {renderField("received_date")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-x-6 gap-y-4">
          {renderField("priority")}
          {renderField("ship")}
          {renderField("receive")}
          {renderField("status")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 sm:w-2/3">
          {renderField("factory_list")}
          {renderField("country_of_origin")}
        </div>
      </div>
    </div>
  );

  // Documents: two attachment dropzones side-by-side, then a full-width PO Link.
  const poDocsBody = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        {renderField("po_request_files")}
        {renderField("po_files")}
      </div>
      {renderField("po_link")}
    </div>
  );

  // PI: left column stacked fields (PI Status colored), right column PI File dropzone.
  const poPiBody = (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-4">
        {renderField("pi_status")}
        {renderField("pi_received_date")}
        {renderField("vendor_pi")}
        {renderField("vendor_invoice_number")}
        {renderField("payment_terms")}
      </div>
      <div className="md:border-l md:pl-6">{renderField("pi_file")}</div>
    </div>
  );

  // Deposit: Calc. Deposit is a formula (% × grand total), shown read-only.
  const depCalc = Number(calcDepositAmount(
    form.deposit_percentage as number | null,
    form.grand_total as number | null,
    (form.calculated_deposit_amount as number | null) ?? null,
  ) ?? 0);
  const depAct = Number(form.actual_deposit_amount ?? 0);
  const depSame = depCalc === depAct;
  const poDepositBody = (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-4">
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-muted-foreground">Deposit Percentage</label>
          <div className="text-sm py-1">{form.deposit_percentage != null && form.deposit_percentage !== "" ? `${form.deposit_percentage}%` : "—"}</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">Calculated Deposit Amount</label>
            <div className="text-sm py-1">{fmtCurrency(depCalc)}</div>
          </div>
          {renderField("actual_deposit_amount")}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">Calculated vs Actual Deposit Amount</label>
            <div className="py-1"><span style={{ ...pill(depSame ? "#CCFBF1" : "#FEE2E2", depSame ? "#115E75" : "#991B1B") }}>{depSame ? "Same" : "Different"}</span></div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
          {renderField("payment_approved_lead")}
          {renderField("payment_status_finance")}
          {renderField("deposit_payment_date")}
        </div>
        <div className="sm:w-1/3">{renderField("invoice_date")}</div>
      </div>
      <div className="md:border-l md:pl-6">{renderField("bank_slip_files")}</div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[96vw] h-[92vh] max-h-[92vh] p-0 gap-0 !flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-4 pb-4 border-b shrink-0">
          <button type="button" onClick={() => onOpenChange(false)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3">
            <ArrowLeft className="h-4 w-4" />
            Back to <span className="inline-flex items-center gap-1 font-medium text-foreground"><Package className="h-3.5 w-3.5" /> Order Pipeline</span>
          </button>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0 rounded-lg border bg-background px-4 py-2">
              <DialogTitle asChild>
                <input value={title} onChange={(e) => set("po_number", e.target.value)} placeholder="PO #"
                  className="w-full bg-transparent border-0 outline-none p-0 text-2xl font-bold tracking-tight leading-tight placeholder:text-muted-foreground/50" />
              </DialogTitle>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void handleDelete()}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete PO
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Body + Comments */}
        <div className="flex flex-1 min-h-0">
        <ScrollArea className="flex-1 min-w-0">
          <div className="mx-auto max-w-5xl px-6 py-5 space-y-8">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-16">Loading…</p>
            ) : (
              <>
                {PO_SECTIONS.map((s) => {
                  const keys = s.keys.filter((k) => allKeys.includes(k) || s.alwaysKeys?.includes(k));
                  if (!keys.length) return null;
                  const isCollapsed = collapsed.has(s.title);
                  const body = s.title === "Team Input" ? poTeamBody
                    : s.title === "PO Summary" ? poSummaryBody
                    : s.title === "Documents" ? poDocsBody
                    : s.title === "Proforma Invoice Information (PI)" ? poPiBody
                    : s.title === "Deposit Information" ? poDepositBody
                    : <div className={PO_GRID_CLASS[s.cols ?? 3]}>{keys.map(renderField)}</div>;
                  const sectionNode = (
                    <section key={s.title} className={cn("space-y-4", s.tinted && "rounded-lg border bg-muted/30 p-5")}>
                      <div className="flex items-center justify-between border-b pb-2">
                        <h3 className="text-base font-bold tracking-tight text-foreground">{s.title}</h3>
                        {s.collapsible && (
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => toggleSection(s.title)}>
                            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {isCollapsed ? "Expand" : "Collapse"}
                          </Button>
                        )}
                      </div>
                      {!isCollapsed && body}
                    </section>
                  );
                  // Documents flows directly after PO Items (no header in Airtable).
                  if (s.title === "Documents") return <div key="documents" className="space-y-4">{body}</div>;
                  // The PO Log sits between Team Input and PO Summary (per design).
                  if (s.title === "Team Input") return <React.Fragment key="ti-log">{sectionNode}<POLogField poId={numId} /></React.Fragment>;
                  return sectionNode;
                })}
              </>
            )}
          </div>
        </ScrollArea>

        {/* Comments */}
        <aside className="hidden md:flex w-[340px] shrink-0 flex-col border-l bg-muted/20">
          <div className="px-4 py-3 border-b shrink-0 text-sm font-semibold">Comments</div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-4">
              {commentsLoading ? (
                <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
              ) : comments.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <p className="text-sm font-medium text-foreground">Start a conversation</p>
                  <p className="text-xs mt-1">Ask questions, keep track of status updates.</p>
                </div>
              ) : comments.map((c) => (
                <div key={c.id} className="flex gap-2.5">
                  <div className="h-7 w-7 shrink-0 rounded-full bg-primary/15 text-primary text-[11px] font-semibold flex items-center justify-center">{initialsOf(c.author_name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium truncate">{c.author_name || "User"}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">{new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="border-t p-3 shrink-0 space-y-2">
            <Textarea value={commentBody} onChange={(e) => setCommentBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void addComment(); } }}
              placeholder={numId ? "Leave a comment…" : "Save the record first to comment"} disabled={!numId || commentSending}
              className="min-h-[60px] text-sm resize-none bg-background" />
            <div className="flex justify-end">
              <Button size="sm" onClick={() => void addComment()} disabled={!numId || commentSending || !commentBody.trim()}>{commentSending ? "Sending…" : "Comment"}</Button>
            </div>
          </div>
        </aside>
        </div>

        <DialogFooter className="px-6 py-3 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void handleSave()} disabled={saving || !canEdit}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
