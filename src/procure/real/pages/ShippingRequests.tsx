import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { OrderDashboardTabs } from "@/components/shared/OrderDashboardTabs";
import { usePersistedState } from "@/hooks/usePersistedState";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { Search, RefreshCw, Plus, Pencil, Trash2, ChevronDown, Truck, UploadCloud, X, RotateCcw, Calendar, Hash, Type, AlignLeft, CircleDot, Paperclip, Maximize2, ArrowLeft, MoreHorizontal, PanelLeft } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { TablePagination } from "@/components/ui/table-pagination";
import { DeleteRowDialog } from "@/components/predictive-purchasing/DeleteRowDialog";
import { usePagePermission } from "@/hooks/usePagePermission";
import { useFactoryAccess } from "@/hooks/useFactoryAccess";
import { useAuth } from "@/contexts/AuthContext";
import { MentionInput, MentionUser } from "@/components/shared/MentionInput";
import { notifyMention } from "@/lib/notifyMention";
import { PermissionGuardButton } from "@/components/shared/PermissionGuardButton";
import { useTableView, computeGroupStat, type ViewField, type FieldType } from "@/lib/tableView";
import { TableViewToolbar, ColResizeHandle } from "@/components/shared/TableViewToolbar";
import { EditableCell, HoverSelectCell } from "@/components/shared/EditableCell";
import { useInlineEdit, type EditKind } from "@/hooks/useInlineEdit";
import { useHoverRow, useActiveRow } from "@/hooks/useHoverRow";
import { cn } from "@/lib/utils";
import { cloneElement } from "react";
import { ChevronRight } from "lucide-react";
import { CsvPreview } from "@/components/shared/CsvPreview";

const DEFAULT_TABLE     = "shipping_requests";
const DEFAULT_QUERY_KEY = "shipping-requests";
const PAGE_SIZES = [10, 25, 50, 100];

/** Props let the same Dispatch Requests page serve multiple sidebar sections
 *  (Finance / Logistics / Management), each with its own permission key, title,
 *  and persisted filter state, all backed by the same underlying table.
 *  Defaults preserve the original behavior. */
interface ShippingRequestsProps {
  tableName?: string;
  queryKey?: string;
  title?: string;
  subtitle?: string;
  permKey?: string;
  tabGroup?: import("@/components/shared/OrderDashboardTabs").TabGroup;
}

type ColType = "text" | "number" | "date";

interface ColDef { key: string; label: string; type: ColType; }

// Column order follows the requested grouping:
// 1) REF# / Date Requested / Progress · 2) cargo (Inspection before CRD) ·
// 3) approvals · 4) shipment booking · 5) factory contact · 6) the rest.
const COLUMNS: ColDef[] = [
  // ── 1. Reference ──
  { key: "ref_calculated",             label: "REF # (Calculated)",          type: "text"   },
  { key: "progress",                   label: "Progress",                     type: "text"   },
  { key: "vndr_copy",                  label: "Factory Code",                 type: "text"   },
  { key: "date_requested",             label: "Date Requested",               type: "date"   },
  // ── 2. Cargo / request info ──
  { key: "qc_check_pass",              label: "QC Check Pass?",               type: "text"   },
  { key: "inspection_date",            label: "Inspection Date",              type: "date"   },
  { key: "new_inspection",             label: "New Inspection",               type: "date"   },
  { key: "cargo_ready_date",           label: "Cargo Ready Date (CRD)",       type: "date"   },
  { key: "new_crd",                    label: "New CRD",                      type: "date"   },
  { key: "cargo_volume_cbm",           label: "Cargo Volume (CBM)",           type: "number" },
  { key: "forty_ft_aprv",              label: "40' APRV",                     type: "number" },
  { key: "port_of_loading",            label: "Port of Loading (POL)",        type: "text"   },
  { key: "pickup_location",            label: "Pickup Location",              type: "text"   },
  { key: "packing_list",                 label: "Packing List",                 type: "text"   },
  { key: "factory_notes",              label: "Factory Notes",                type: "text"   },
  { key: "pos",                        label: "PO Number (Factory)",          type: "text"   },
  { key: "po_complete_date",           label: "PO Complete Date",             type: "date"   },
  { key: "invoice_number",             label: "Invoice Number",               type: "text"   },
  // ── 3. Approvals ──
  { key: "lead_approved",               label: "Lead Approved",                 type: "text"   },
  { key: "qc_approved",                label: "QC Approved",                  type: "text"   },
  { key: "qc_comment",                 label: "QC Comment",                   type: "text"   },
  { key: "planning_approval_status",   label: "Planning Approval Status",     type: "text"   },
  { key: "planning_comment",           label: "Planning Comment",             type: "text"   },
  { key: "late_fees",                  label: "Late Fees",                    type: "number" },
  // ── 4. Shipment booking ──
  { key: "freight_forwarder",          label: "Freight Forwarder",            type: "text"   },
  { key: "freight_carrier",            label: "Freight Carrier",              type: "text"   },
  { key: "etd",                        label: "ETD",                          type: "date"   },
  { key: "bl_hbl_mbl_old",             label: "BL # (HBL/MBL) - OLD",        type: "text"   },
  { key: "rate",                       label: "RATE",                         type: "number" },
  { key: "pb_notes_old",               label: "Legacy Notes",              type: "text"   },
  { key: "booking_info_contact",       label: "Booking Information Contact",  type: "text"   },
  { key: "cancellation_fee_agreement", label: "Cancellation Fee Agreement",   type: "text"   },
  // ── 5. Everything else ──
  { key: "invoice_tracker",            label: "Freight Bills",              type: "text"   },
  { key: "created_by",                 label: "Created By",                   type: "text"   },
];

// Fetch every column so the full Airtable-style record panel has all fields,
// even those not shown in the table list.
const SELECT_FIELDS = "*";

// Engine field-type hints: option-pick (single) vs boolean checkmark columns.
// freight_forwarder deliberately NOT here — tracker request made it text entry.
const SR_SINGLE_FIELDS = new Set(["lead_approved", "qc_approved", "qc_check_pass", "planning_approval_status", "port_of_loading", "factory_short_name", "full_factory_name", "vndr_copy"]);
const SR_BOOL_FIELDS   = new Set(["cancellation_fee_agreement"]);

/** Default column width (px) for the fixed-layout <colgroup>. User drag-resize overrides this. */
const srDefaultColW = (c: ColDef) =>
  SR_BOOL_FIELDS.has(c.key) ? 90 : TRUNCATE_COLS.has(c.key) ? 200 : c.type === "number" ? 110 : c.type === "date" ? 120 : 150;

// Single-value dropdown cells for inline edit. freight_forwarder holds combined
// values, so it stays free-text. Attachments / linked refs are not inline-editable.
const SR_INLINE_SINGLE = new Set(["progress", "lead_approved", "qc_approved", "qc_check_pass", "planning_approval_status", "port_of_loading", "factory_short_name", "full_factory_name", "vndr_copy"]);
const SR_NO_INLINE = new Set(["packing_list", "invoice_tracker"]);
const srEditKind = (c: ColDef): EditKind =>
  SR_NO_INLINE.has(c.key) || SR_BOOL_FIELDS.has(c.key) ? null
    : SR_INLINE_SINGLE.has(c.key) ? "single" : c.type;

const CURRENCY_COLS  = new Set(["rate", "late_fees"]);
const WRAP_COLS      = new Set(["ref_calculated", "bl_hbl_mbl_old", "invoice_tracker", "invoice_number", "freight_carrier", "full_factory_name"]);
// Tracker request: these read as identifiers/notes, not values — left-aligned.
const LEFT_ALIGN_COLS = new Set(["ref_calculated", "bl_hbl_mbl_old", "qc_comment"]);
const DECIMAL_2_COLS = new Set(["cargo_volume_cbm"]);
const NUMBER_COLS    = new Set(COLUMNS.filter((c) => c.type === "number").map((c) => c.key));
const DATE_COLS     = new Set(COLUMNS.filter((c) => c.type === "date").map((c) => c.key));
const TRUNCATE_COLS = new Set(["qc_comment", "planning_comment", "factory_notes", "pb_notes_old", "factory_name_form", "booking_info_contact"]);
const TRUNCATE_LEN  = 80;

const VENDOR_PILL_PALETTE = [
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
  { bg: "#DDD6FE", text: "#304654" },
  { bg: "#FEF9C3", text: "#713F12" },
  { bg: "#CFFAFE", text: "#155E75" },
  { bg: "#F0FDF4", text: "#166534" },
  { bg: "#EC4899", text: "#ffffff" },
  { bg: "#9B1C1C", text: "#ffffff" },
];

function hashPill(val: string): { bg: string; text: string } {
  const trimmed = val.trim();
  let h = 0;
  for (let i = 0; i < trimmed.length; i++) h = (h * 31 + trimmed.charCodeAt(i)) >>> 0;
  return VENDOR_PILL_PALETTE[h % VENDOR_PILL_PALETTE.length];
}

function getFreightForwarderColor(val: string): { bg: string; text: string } {
  return hashPill(val);
}

const POL_COLORS: Record<string, { bg: string; text: string }> = {
  PT08:           { bg: "#d9e4ea", text: "#304654" },
  PT09:           { bg: "#d9e4ea", text: "#304654" },
  PT07:     { bg: "#d9e4ea", text: "#304654" },
  PT10:           { bg: "#d9e4ea", text: "#304654" },
  PT11:           { bg: "#d9e4ea", text: "#304654" },
  PT12:           { bg: "#d9e4ea", text: "#304654" },
  PT13:           { bg: "#d9e4ea", text: "#304654" },
  PT14:           { bg: "#d9e4ea", text: "#304654" },
  PT15:           { bg: "#d9e4ea", text: "#304654" },
  PT16:           { bg: "#d9e4ea", text: "#304654" },
  PT17:           { bg: "#d9e4ea", text: "#304654" },
  PT18:           { bg: "#d9e4ea", text: "#304654" },
  PT19:           { bg: "#d9e4ea", text: "#304654" },
  PT20:           { bg: "#D1FAE5", text: "#065F46" },
  PT21:           { bg: "#D1FAE5", text: "#065F46" },
  PT23:           { bg: "#FEF3C7", text: "#92400E" },
  PT24:           { bg: "#FEF3C7", text: "#92400E" },
  PT01: { bg: "#FEF3C7", text: "#92400E" },
  PT03:       { bg: "#FEF3C7", text: "#92400E" },
  PT04:       { bg: "#FEF3C7", text: "#92400E" },
  PT05:       { bg: "#FEF3C7", text: "#92400E" },
  PT06:         { bg: "#FEF3C7", text: "#92400E" },
  PT25:           { bg: "#FEF3C7", text: "#92400E" },
  PT02:        { bg: "#E2E8F0", text: "#475569" },
  PT26:           { bg: "#E2E8F0", text: "#475569" },
};

function getPOLColor(val: string): { bg: string; text: string } {
  const trimmed = val.trim();
  if (POL_COLORS[trimmed]) return POL_COLORS[trimmed];
  const upper = trimmed.toUpperCase();
  if (upper.startsWith("ID")) return { bg: "#d9e4ea", text: "#5B21B6" };
  if (upper.startsWith("MY")) return { bg: "#BAE6FD", text: "#0C4A6E" };
  if (upper.startsWith("KH")) return { bg: "#CFFAFE", text: "#155E75" };
  if (upper.startsWith("VN")) return { bg: "#D1FAE5", text: "#065F46" };
  if (upper.startsWith("US")) return { bg: "#DC2626", text: "#ffffff" };
  if (upper.startsWith("TH")) return { bg: "#FCE7F3", text: "#9D174D" };
  return hashPill(trimmed);
}

const PROGRESS_COLORS: Record<string, { bg: string; text: string }> = {
  "PENDING":      { bg: "#FEF9C3", text: "#713F12" },
  "APPROVED":     { bg: "#D1FAE5", text: "#065F46" },
  "CONFIRMED":    { bg: "#cfe9e9", text: "#0c4849" },
  "IN TRANSIT":   { bg: "#CCFBF1", text: "#115E59" },
  "DELIVERED":    { bg: "#166534", text: "#ffffff" },
  "CANCELLED":    { bg: "#FEE2E2", text: "#991B1B" },
  "ON HOLD":      { bg: "#FED7AA", text: "#9A3412" },
  "BOOKING REQ":  { bg: "#BAE6FD", text: "#0C4A6E" },
  "Delivered":     { bg: "#166534", text: "#ffffff" },
  "BOOKING CONF": { bg: "#cfe9e9", text: "#0c4849" },
};

function getProgressPillColor(val: string): { bg: string; text: string } {
  const trimmed = val.trim();
  if (PROGRESS_COLORS[trimmed]) return PROGRESS_COLORS[trimmed];
  const upper = trimmed.toUpperCase();
  if (PROGRESS_COLORS[upper]) return PROGRESS_COLORS[upper];
  return hashPill(trimmed);
}

function splitProgressValues(raw: string): string[] {
  const trimmed = raw.trim();
  const parts = trimmed.split(/[\r\n,;|]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  const known = Object.keys(PROGRESS_COLORS).sort((a, b) => b.length - a.length);
  const found: string[] = [];
  let pos = 0;
  while (pos < trimmed.length) {
    let matched = false;
    for (const k of known) {
      if (trimmed.toUpperCase().startsWith(k, pos)) {
        found.push(trimmed.slice(pos, pos + k.length));
        pos += k.length;
        matched = true;
        break;
      }
    }
    if (!matched) pos++;
  }
  return found.length > 0 ? found : parts;
}

// Short numeric M/D/YYYY (e.g. "8/6/2022") -- the one date format used
// everywhere across Dispatch Request, Freight Bills, and Order Pipeline.
function fmtDate(s: string): string | null {
  // Bare "YYYY-MM-DD" (no time component) is a calendar date, not a moment in
  // time — parsing it with `new Date()` reads it as UTC midnight, which then
  // renders a day EARLIER for any user in a timezone behind UTC. Format it
  // straight from the string so it never passes through timezone conversion.
  const bareDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (bareDate) {
    const [, y, mo, d] = bareDate;
    return `${Number(mo)}/${Number(d)}/${y}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime()))
      return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
  }
  return null;
}

function fmtCell(key: string, val: unknown): string {
  if (val === null || val === undefined || val === "") return "—";
  const s = String(val);
  if (CURRENCY_COLS.has(key)) {
    const n = Number(val);
    if (isNaN(n)) return fmtDate(s) ?? s;
    const abs = Math.abs(n);
    const formatted = abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return n < 0 ? `-$${formatted}` : `$${formatted}`;
  }
  if (DECIMAL_2_COLS.has(key)) {
    const n = Number(val);
    if (isNaN(n)) return fmtDate(s) ?? s;
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (NUMBER_COLS.has(key)) {
    const n = Number(val);
    if (isNaN(n)) return fmtDate(s) ?? s;
    return n.toLocaleString();
  }
  if (DATE_COLS.has(key)) {
    return fmtDate(s) ?? s;
  }
  return fmtDate(s) ?? s;
}

// Curated single-select option lists, mirroring the Airtable form fields.
const PROGRESS_OPTIONS = [
  "Needs Clarification", "Requested", "In Review", "On Hold", "Booking In Progress",
  "Instructions Sent", "Awaiting QC", "Provisionally Approved", "Partially Approved",
  "Fully Approved", "Carrier Released", "In Transit", "Delivered", "Closed", "Cancelled",
];
const YES_NO_OPTIONS = ["Yes", "No"];
const LEAD_APPROVED_OPTIONS = ["Yes", "Provisional", "Partial", "On Hold"];
const PLANNING_APPROVAL_OPTIONS = ["Completed", "Pending"];

// Airtable-matched pill colors per option, so the in-app record view reads the
// same as the board the team is used to.
type PillColor = { bg: string; text: string };
const PILL_FALLBACK: PillColor = { bg: "#E5E7EB", text: "#374151" };
const PROGRESS_PILL_COLORS: Record<string, PillColor> = {
  "Needs Clarification": { bg: "#F5621E", text: "#ffffff" },
  "Requested": { bg: "#2D7FF9", text: "#ffffff" },
  "In Review": { bg: "#CE82FF", text: "#3b0a52" },
  "On Hold": { bg: "#FCB400", text: "#3d2c00" },
  "Booking In Progress": { bg: "#18BFFF", text: "#003a52" },
  "Instructions Sent": { bg: "#E929BA", text: "#ffffff" },
  "Awaiting QC": { bg: "#6B7280", text: "#ffffff" },
  "Provisionally Approved": { bg: "#C2F5D6", text: "#0b5a2a" },
  "Partially Approved": { bg: "#1F9E54", text: "#ffffff" },
  "Fully Approved": { bg: "#0B7A33", text: "#ffffff" },
  "Carrier Released": { bg: "#20D9D2", text: "#00403d" },
  "In Transit": { bg: "#1283DA", text: "#ffffff" },
  "Delivered": { bg: "#7C3AED", text: "#ffffff" },
  "Closed": { bg: "#9B1C1C", text: "#ffffff" },
  "Cancelled": { bg: "#E03131", text: "#ffffff" },
};
const LEAD_COLORS: Record<string, PillColor> = {
  "Yes": { bg: "#20C4A0", text: "#ffffff" },
  "Provisional": { bg: "#C2F5D6", text: "#0b5a2a" },
  "Partial": { bg: "#FCB400", text: "#3d2c00" },
  "On Hold": { bg: "#F5621E", text: "#ffffff" },
};
const YESNO_COLORS: Record<string, PillColor> = {
  "Yes": { bg: "#CFE6FF", text: "#0a417a" },
  "No": { bg: "#FEE2E2", text: "#991B1B" },
};
const PLANNING_COLORS: Record<string, PillColor> = {
  "Completed": { bg: "#1F9E54", text: "#ffffff" },
  "Pending": { bg: "#FCB400", text: "#3d2c00" },
};

/** Pill color for a hover-edit trigger, matching each column's plain-display
 *  coloring so the pill doesn't change appearance when it becomes editable. */
function srPillStyle(colKey: string, value: string): PillColor | null {
  switch (colKey) {
    case "progress": return PROGRESS_PILL_COLORS[value] ?? PILL_FALLBACK;
    case "planning_approval_status": return PLANNING_COLORS[value] ?? PILL_FALLBACK;
    case "lead_approved": return LEAD_COLORS[value] ?? PILL_FALLBACK;
    case "qc_approved": case "qc_check_pass": return YESNO_COLORS[value] ?? PILL_FALLBACK;
    case "port_of_loading": case "factory_short_name": case "full_factory_name": case "vndr_copy":
      return getFreightForwarderColor(value);
    default: return null;
  }
}

function ColorPill({ label, colors }: { label: string; colors: PillColor }) {
  return (
    <span style={{
      backgroundColor: colors.bg, color: colors.text, borderRadius: "9999px", padding: "2px 12px",
      fontWeight: 600, fontSize: "12px", display: "inline-block", whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

/** Searchable single-select rendering each option as a colored pill — the
 *  Airtable "Find an option" picker, generalized over any option/color map. */
function PillSelect({
  value, onChange, options, colorMap,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  colorMap: Record<string, PillColor>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          {value ? <ColorPill label={value} colors={colorMap[value] ?? PILL_FALLBACK} /> : <span className="text-muted-foreground">Select…</span>}
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Find an option" />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            {options.map((opt) => (
              <CommandItem key={opt} value={opt} onSelect={() => { onChange(opt); setOpen(false); }} className="cursor-pointer">
                <ColorPill label={opt} colors={colorMap[opt] ?? PILL_FALLBACK} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Full record field config, mirroring the Airtable record layout 1:1 ──────
type FieldKind =
  | "text" | "longtext" | "number" | "currency" | "date"
  | "pillSingle" | "pillMulti" | "yesnoBool" | "checkbox"
  | "factory" | "pol" | "attachment" | "attachmentUpload" | "collab" | "readonly" | "invoiceCard" | "notesList" | "factoryCard" | "poCard" | "pillText";

interface RecField {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  colorMap?: Record<string, PillColor>;
}

// Order follows the requested edit-form grouping: reference → cargo →
// approvals → shipment booking → factory contact → the rest. The read-only
// team ACCOUNT pills (Airtable collab sync) moved to the very bottom — they
// were cluttering the top of the form. ref_calculated is rendered as the
// title, so it is not repeated here.
const RECORD_FIELDS: RecField[] = [
  // ── Field order mirrors the sectioned Full Edit layout exactly, so the flat
  // Edit dialog reads the same top-to-bottom (the log at top, same field
  // groupings) — only the leftover fields Full Edit doesn't surface (factory
  // sub-fields, old notes, system stamps) and the team ACCOUNT collab pills
  // are appended after, unchanged from before. ──
  { key: "shipping_request_notes",    label: "Dispatch Request Log",        kind: "notesList" },
  { key: "progress",                  label: "Progress",                    kind: "pillMulti",   options: PROGRESS_OPTIONS,           colorMap: PROGRESS_PILL_COLORS },
  { key: "factory_name_form",         label: "Factory Name (Form)",         kind: "text" },
  { key: "cancellation_fee_agreement",label: "Cancellation Fee Agreement",  kind: "checkbox" },
  { key: "factory_code",              label: "Factory Code",                kind: "factoryCard" },
  // Date Requested is a system date-stamp (set once at creation) — no longer
  // hand-editable, matching Created/Receipt Number elsewhere in this form.
  { key: "date_requested",            label: "Date Requested",              kind: "readonly" },
  { key: "inspection_date",           label: "Inspection Date",             kind: "date" },
  { key: "new_inspection",            label: "New Inspection",              kind: "date" },
  { key: "qc_check_pass",             label: "QC Check Pass?",              kind: "yesnoBool" },
  { key: "cargo_ready_date",          label: "Cargo Ready Date (CRD)",      kind: "date" },
  { key: "new_crd",                   label: "New CRD",                     kind: "date" },
  { key: "cargo_volume_cbm",          label: "Cargo Volume (CBM)",          kind: "number" },
  { key: "packing_list",              label: "Packing List",                kind: "attachment" },
  { key: "port_of_loading",           label: "Port of Loading (POL)",       kind: "pol" },
  { key: "pickup_location",           label: "Pickup Location",             kind: "text" },
  { key: "booking_info_contact",      label: "Booking Information Contact", kind: "text" },
  { key: "factory_notes",             label: "Factory Notes",               kind: "longtext" },
  { key: "pos",                       label: "PO Number (Factory)",         kind: "longtext" },
  { key: "po_complete_date",          label: "PO COMPLETE DATE",            kind: "longtext" },
  { key: "purchase_order",            label: "Purchase Order",              kind: "poCard" },
  { key: "invoice_number",            label: "Invoice Number",              kind: "text" },
  { key: "qc_approved",               label: "QC Approved",                 kind: "yesnoBool" },
  { key: "qc_comment",                label: "QC Comment",                  kind: "longtext" },
  { key: "planning_approval_status",  label: "Planning Approval Status",    kind: "pillSingle",  options: PLANNING_APPROVAL_OPTIONS,  colorMap: PLANNING_COLORS },
  { key: "planning_comment",          label: "Planning Comment",            kind: "longtext" },
  { key: "late_fees_files",           label: "Late Fees",                   kind: "attachmentUpload" },
  { key: "lead_approved",              label: "Lead Approved",                kind: "yesnoBool" },
  { key: "vessel_name",               label: "Vessel Name",                 kind: "text" },
  { key: "rate",                      label: "RATE",                        kind: "currency" },
  { key: "forty_ft_aprv",             label: "40' APRV",                    kind: "number" },
  // Tracker request: both are plain text entry now (were pill/dropdown-style).
  { key: "freight_forwarder",         label: "Freight Forwarder",           kind: "text" },
  { key: "freight_carrier",           label: "Freight Carrier",             kind: "text" },
  { key: "etd",                       label: "ETD",                         kind: "date" },
  { key: "hbl",                       label: "HBL",                         kind: "text" },
  { key: "mbl",                       label: "MBL",                         kind: "text" },
  { key: "booking_number",            label: "Booking#",                    kind: "text" },
  { key: "bl_hbl_mbl_old",            label: "BL # (HBL/MBL) - OLD",        kind: "text" },
  { key: "invoice_tracker",           label: "Freight Bills",             kind: "invoiceCard" },
  { key: "receipt_number",            label: "Receipt Number",              kind: "readonly" },
  // ── Fields not surfaced in Full Edit — kept, just moved after it ──
  { key: "full_factory_name",         label: "Full Factory Name",           kind: "text" },
  { key: "factory_short_name",        label: "Factory Short Name",          kind: "text" },
  { key: "vndr_copy",                 label: "VNDR copy",                   kind: "factory" },
  { key: "pb_notes_old",              label: "Legacy Notes",             kind: "longtext" },
  // User stamp — set automatically on create (creator's email), never editable.
  { key: "created_by",                label: "Created By",                  kind: "readonly" },
  { key: "date_submitted",            label: "Date Submitted",              kind: "date" },
  // System-assigned legacy Airtable id — other pages (e.g. Freight Bills's
  // shipping-request link) resolve this row by record_id, so hand-editing it
  // would silently break that linkage.
  { key: "record_id",                 label: "Record ID",                   kind: "readonly" },
  // ── Team accounts (read-only Airtable collab pills) ──
  { key: "supervisor_team_account",   label: "Supervisor Team Account",     kind: "collab" },
  { key: "factory_account",           label: "Factory Account",             kind: "collab" },
  { key: "qc_team_account",           label: "QC Team Account",             kind: "collab" },
  { key: "management_team_account",   label: "Management Team Account",     kind: "collab" },
  { key: "customer_service_account",  label: "Customer Service Account",    kind: "collab" },
  { key: "qc_team_account_countries", label: "QC Team Account (Countries)", kind: "collab" },
];

function recFieldIcon(kind: FieldKind) {
  switch (kind) {
    case "pillSingle": case "pillMulti": case "yesnoBool": case "checkbox": return CircleDot;
    case "attachment": return Paperclip;
    case "date": return Calendar;
    case "number": case "currency": return Hash;
    case "longtext": return AlignLeft;
    case "collab": return Type;
    default: return Type;
  }
}

/** Collaborator / linked-style field: colored pills only, matching Airtable.
 *  These come from the Airtable sync (read-only in the app), so no text editor. */
function CollabField({ value }: { value: string; onChange?: (v: string) => void }) {
  const parts = value.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5 py-1">
      {parts.map((p, i) => <ColorPill key={`${p}-${i}`} label={p} colors={hashPill(p)} />)}
    </div>
  );
}

/** Multi-select pill picker (Airtable checkbox option list). Value is comma-joined. */
function PillMultiSelect({
  value, onChange, options, colorMap,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  colorMap: Record<string, PillColor>;
}) {
  const [open, setOpen] = useState(false);
  const sel = value ? value.split(/,\s*/).map((s) => s.trim()).filter(Boolean) : [];
  const toggle = (opt: string) => {
    const next = sel.includes(opt) ? sel.filter((x) => x !== opt) : [...sel, opt];
    onChange(next.join(", "));
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-9 w-full items-center justify-between gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <span className="flex flex-wrap gap-1">
            {sel.length ? sel.map((s) => <ColorPill key={s} label={s} colors={colorMap[s] ?? PILL_FALLBACK} />)
              : <span className="text-muted-foreground">Select…</span>}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Find an option" />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            {options.map((opt) => (
              <CommandItem key={opt} value={opt} onSelect={() => toggle(opt)} className="cursor-pointer gap-2">
                <Checkbox checked={sel.includes(opt)} className="pointer-events-none" />
                <ColorPill label={opt} colors={colorMap[opt] ?? PILL_FALLBACK} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface ShippingComment {
  id: number;
  request_id: number;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
}

function commentInitials(name: string | null): string {
  return (name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

interface ShippingNote {
  id: number;
  request_id: number;
  note_type: string | null;
  content: string | null;
  note_date: string | null;
  created_by: string | null;
  author_id: string | null;
  created_at: string;
}

/** Airtable-style "empty grid" doc-stack illustration for empty sub-record panels. */
function DocStackIllustration() {
  return (
    <svg width="150" height="130" viewBox="0 0 150 130" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* back sheets */}
      <rect x="34" y="26" width="86" height="92" rx="6" fill="#F3F4F6" transform="rotate(6 34 26)" />
      <rect x="24" y="20" width="86" height="92" rx="6" fill="#F9FAFB" stroke="#E5E7EB" transform="rotate(-4 24 20)" />
      {/* front sheet */}
      <rect x="34" y="14" width="86" height="96" rx="6" fill="#FFFFFF" stroke="#E5E7EB" />
      {/* header row */}
      <path d="M42 26 l4 4 4-4" stroke="#D1D5DB" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="56" y="24" width="40" height="5" rx="2.5" fill="#D1D5DB" />
      {/* body rows */}
      {[42, 52, 62, 72].map((y) => (
        <g key={y}>
          <rect x="42" y={y} width="26" height="4" rx="2" fill="#E5E7EB" />
          <rect x="74" y={y} width="16" height="4" rx="2" fill="#E5E7EB" />
          <rect x="96" y={y} width="14" height="4" rx="2" fill={y % 20 === 2 ? "#FBCFE8" : y % 20 === 12 ? "#a5d6d6" : "#DCFCE7"} />
        </g>
      ))}
      {/* second group */}
      <path d="M42 88 l4 4 4-4" stroke="#D1D5DB" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {[92, 100].map((y) => (
        <g key={y}>
          <rect x="42" y={y} width="26" height="4" rx="2" fill="#E5E7EB" />
          <rect x="74" y={y} width="16" height="4" rx="2" fill="#E5E7EB" />
          <rect x="96" y={y} width="14" height="4" rx="2" fill={y === 92 ? "#a5d6d6" : "#FBCFE8"} />
        </g>
      ))}
    </svg>
  );
}

/** Textarea that grows to fit its content (no inner scrollbar) — used in the
 *  full-screen editor so long notes/comments show in full. */
function AutoTextarea({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  React.useLayoutEffect(() => { resize(); }, [value, resize]);
  return (
    <Textarea
      ref={ref}
      value={value}
      onChange={(e) => { onChange(e.target.value); resize(); }}
      rows={1}
      className={cn("text-sm resize-none overflow-hidden", className)}
    />
  );
}

/** Numeric input that always shows one decimal place (e.g. "1.0") when not being
 *  edited, while allowing free typing. Stores the raw number string. */
function Decimal1Field({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const fmt = (v: string) => {
    const n = Number(v);
    return v !== "" && Number.isFinite(n) ? n.toFixed(1) : v;
  };
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={draft ?? fmt(value)}
      onFocus={() => setDraft(value)}
      onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }}
      onBlur={() => { onChange(fmt(value)); setDraft(null); }}
      className="h-9 text-sm"
    />
  );
}

/** Comma-separated email list shown as clickable mailto: links (matching the
 *  Airtable reference); click the pencil to edit the raw text. */
function MailtoLinksField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  if (editing) {
    return (
      <Input
        value={value}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === "Enter") setEditing(false); }}
        className="h-9 text-sm"
      />
    );
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emails = value.split(",").map((s) => s.trim()).filter(Boolean);
  return (
    <div className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3">
      <div className="min-w-0 truncate text-sm">
        {emails.length ? emails.map((e, i) => (
          <React.Fragment key={e}>
            {i > 0 && <span className="text-muted-foreground">, </span>}
            {EMAIL_RE.test(e)
              ? <a href={`mailto:${encodeURIComponent(e).replace(/%40/, "@")}`} onClick={(ev) => ev.stopPropagation()} className="text-blue-600 hover:underline">{e}</a>
              : <span>{e}</span>}
          </React.Fragment>
        )) : <span className="text-muted-foreground">—</span>}
      </div>
      <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-muted-foreground hover:text-foreground">
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// Single-select "Type" options for a Dispatch Request Log entry (+ pill colors).
const LOG_TYPE_OPTIONS = ["Notes", "Reminders", "Log"];
const LOG_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  Notes: { bg: "#FEF3C7", text: "#92400E" },
  Reminders: { bg: "#EA580C", text: "#FFFFFF" },
  Log: { bg: "#14B8A6", text: "#FFFFFF" },
};
const logTypeColors = (t: string) => LOG_TYPE_COLORS[t] ?? { bg: "#E5E7EB", text: "#374151" };

/** Linked "Dispatch Request Notes" sub-records. "Add Log" / "Add record" opens a
 *  full "New Dispatch Request Log" modal (Type + Content) that creates a note. */
function NotesField({ requestId, variant = "compact" }: { requestId: number | null; variant?: "compact" | "panel" }) {
  const { profile } = useAuth();
  const [notes, setNotes] = useState<ShippingNote[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [noteType, setNoteType] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [openNote, setOpenNote] = useState<ShippingNote | null>(null);

  const load = useCallback(async () => {
    if (!requestId) { setNotes([]); return; }
    const { data } = await (supabase as any)
      .from("shipping_request_notes").select("*").eq("request_id", requestId).order("created_at", { ascending: false });
    setNotes((data ?? []) as ShippingNote[]);
  }, [requestId]);

  useEffect(() => { void load(); }, [load]);

  const myName = profile?.full_name || profile?.email?.split("@")[0] || "User";

  const createNote = async () => {
    if (!requestId || !profile?.id || !noteType || !content.trim()) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("shipping_request_notes").insert({
        request_id: requestId, note_type: noteType,
        content: content.trim(), note_date: null, created_by: myName, author_id: profile.id,
      });
      if (error) throw error;
      setNoteType(""); setContent(""); setFormOpen(false);
      await load();
    } catch (e: any) {
      toast.error("Failed to add log: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async (id: number) => {
    try {
      const { error } = await (supabase as any).from("shipping_request_notes").delete().eq("id", id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      toast.error("Failed to delete log: " + e.message);
    }
  };

  // Optimistic local edit + DB write for inline row editing.
  const setLocal = (id: number, patch: Partial<ShippingNote>) =>
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const persistNote = async (id: number, patch: Partial<ShippingNote>) => {
    try {
      const { error } = await (supabase as any).from("shipping_request_notes").update(patch).eq("id", id);
      if (error) throw error;
    } catch (e: any) {
      toast.error("Failed to save log: " + e.message);
      await load();
    }
  };

  const clearForm = () => { setNoteType(""); setContent(""); };

  const addDialog = (
    <Dialog open={formOpen} onOpenChange={(o) => { setFormOpen(o); if (!o) clearForm(); }}>
      <DialogContent className="max-w-3xl w-[95vw] h-[85vh] max-h-[85vh] p-0 gap-0 !flex flex-col overflow-hidden">
        <div className="px-8 pt-8 pb-4 border-b shrink-0">
          <DialogTitle className="text-3xl font-bold tracking-tight leading-tight">New Dispatch Request Log</DialogTitle>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-8 py-6 space-y-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type <span className="text-destructive">*</span></label>
              <Select value={noteType} onValueChange={setNoteType}>
                <SelectTrigger className="h-11"><SelectValue placeholder="" /></SelectTrigger>
                <SelectContent>
                  {LOG_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}><ColorPill label={o} colors={logTypeColors(o)} /></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Content <span className="text-destructive">*</span></label>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[120px] text-sm resize-y" />
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="px-8 py-4 border-t shrink-0 sm:justify-between">
          <Button variant="ghost" className="text-primary hover:text-primary" onClick={clearForm}>
            <RotateCcw className="h-4 w-4 mr-1.5" /> Clear form
          </Button>
          <Button onClick={() => void createNote()} disabled={saving || !noteType || !content.trim()}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const fmtCreated = (iso: string | null) => {
    if (!iso) return { date: "—", time: "" };
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { date: "—", time: "" };
    return {
      date: d.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" }),
      time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s/g, ""),
    };
  };

  // "Open >" record-detail modal: edit Type/Content inline, delete the log.
  const detailDialog = (
    <Dialog open={!!openNote} onOpenChange={(o) => { if (!o) setOpenNote(null); }}>
      <DialogContent className="max-w-3xl w-[95vw] h-[85vh] max-h-[85vh] p-0 gap-0 !flex flex-col overflow-hidden">
        {openNote && (() => {
          const nc = fmtCreated(openNote.created_at);
          return (
            <>
              <div className="px-8 pt-8 pb-4 border-b shrink-0 flex items-center justify-between gap-4">
                <DialogTitle className="text-2xl font-bold tracking-tight leading-tight truncate">Log #{openNote.id}</DialogTitle>
                <Button variant="destructive" className="shrink-0" onClick={() => { const id = openNote.id; setOpenNote(null); void deleteNote(id); }}>
                  <Trash2 className="h-4 w-4 mr-1.5" /> Delete Log Record
                </Button>
              </div>
              <ScrollArea className="flex-1 min-h-0">
                <div className="px-8 py-6 space-y-6">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Type</label>
                    <Select value={openNote.note_type ?? ""} onValueChange={(v) => { setLocal(openNote.id, { note_type: v }); setOpenNote({ ...openNote, note_type: v }); void persistNote(openNote.id, { note_type: v }); }}>
                      <SelectTrigger className="h-11"><SelectValue placeholder="—">{openNote.note_type ? <ColorPill label={openNote.note_type} colors={logTypeColors(openNote.note_type)} /> : null}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {LOG_TYPE_OPTIONS.map((o) => <SelectItem key={o} value={o}><ColorPill label={o} colors={logTypeColors(o)} /></SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Content</label>
                    <Textarea value={openNote.content ?? ""} className="min-h-[120px] text-sm resize-y"
                      onChange={(e) => { setLocal(openNote.id, { content: e.target.value }); setOpenNote({ ...openNote, content: e.target.value }); }}
                      onBlur={(e) => void persistNote(openNote.id, { content: e.target.value })} />
                  </div>
                  <div className="border-t pt-4 grid grid-cols-2 gap-6">
                    <div>
                      <div className="text-[13px] text-muted-foreground mb-1.5">Created By</div>
                      {openNote.created_by ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-5 w-5 shrink-0 rounded-full bg-primary/15 text-primary text-[10px] font-semibold flex items-center justify-center">{commentInitials(openNote.created_by)}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{openNote.created_by}</span>
                        </span>
                      ) : "—"}
                    </div>
                    <div>
                      <div className="text-[13px] text-muted-foreground mb-1.5">Created Date</div>
                      <div className="text-sm">{nc.date}{nc.time && <span className="ml-2 text-muted-foreground">{nc.time}</span>}</div>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </>
          );
        })()}
      </DialogContent>
    </Dialog>
  );

  const noteTable = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[13px] text-muted-foreground border-b">
            <th className="font-medium py-2 pr-4">Type</th>
            <th className="font-medium py-2 pr-4">Content</th>
            <th className="font-medium py-2 pr-4 whitespace-nowrap">Created Date</th>
            <th className="font-medium py-2 pr-4">Created By</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {notes.map((n) => {
            const c = fmtCreated(n.created_at);
            return (
              <tr key={n.id} className="border-b last:border-0 group align-middle">
                <td className="py-1.5 pr-4">
                  <div className="flex items-center gap-2">
                    <Select value={n.note_type ?? ""} onValueChange={(v) => { setLocal(n.id, { note_type: v }); void persistNote(n.id, { note_type: v }); }}>
                      <SelectTrigger className="h-8 w-[130px]"><SelectValue placeholder="—">{n.note_type ? <ColorPill label={n.note_type} colors={logTypeColors(n.note_type)} /> : null}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {LOG_TYPE_OPTIONS.map((o) => <SelectItem key={o} value={o}><ColorPill label={o} colors={logTypeColors(o)} /></SelectItem>)}
                      </SelectContent>
                    </Select>
                    <button type="button" onClick={() => setOpenNote(n)} className="shrink-0 inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
                      Open <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                </td>
                <td className="py-1.5 pr-4">
                  <Input value={n.content ?? ""} className="h-8 text-sm"
                    onChange={(e) => setLocal(n.id, { content: e.target.value })}
                    onBlur={(e) => void persistNote(n.id, { content: e.target.value })} />
                </td>
                <td className="py-1.5 pr-4 whitespace-nowrap text-muted-foreground">{c.date}{c.time && <span className="ml-2">{c.time}</span>}</td>
                <td className="py-1.5 pr-4">
                  {n.created_by ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-5 w-5 shrink-0 rounded-full bg-primary/15 text-primary text-[10px] font-semibold flex items-center justify-center">{commentInitials(n.created_by)}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{n.created_by}</span>
                    </span>
                  ) : "—"}
                </td>
                <td className="py-1.5 text-right">
                  <button type="button" title="Delete log" onClick={() => void deleteNote(n.id)}
                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // Full-screen editor: titled panel with an Airtable-style empty state.
  if (variant === "panel") {
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-base font-bold tracking-tight text-foreground">Dispatch Request Log</h3>
          <div className="flex items-center gap-3">
            <PanelLeft className="h-4 w-4 text-muted-foreground" />
            <Button size="sm" className="h-8" disabled={!requestId} onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Log
            </Button>
          </div>
        </div>
        {!requestId ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Save the record first to add logs</p>
        ) : notes.length ? (
          <div>
            {noteTable}
            <button type="button" onClick={() => setFormOpen(true)}
              className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <Plus className="h-3.5 w-3.5" /> Add record
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10">
            <DocStackIllustration />
            <p className="text-sm text-muted-foreground mt-4 mb-4">No records yet</p>
            <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Add record</Button>
          </div>
        )}
        {addDialog}
        {detailDialog}
      </section>
    );
  }

  if (!requestId) return <span className="text-sm text-muted-foreground">Save the record first to add notes</span>;

  return (
    <div className="space-y-2">
      {notes.length ? noteTable : null}
      <Button size="sm" variant="outline" className="h-8" onClick={() => setFormOpen(true)}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Add record
      </Button>
      {addDialog}
      {detailDialog}
    </div>
  );
}

/** Full-screen editor "Freight Bills" sub-record panel: links this shipping
 *  request to an Freight Bills record. Empty state mirrors the Airtable design. */
function InvoiceLinkPanel({ requestId, invoice, onLink }: {
  requestId: number | null;
  invoice: any | null;
  onLink: (inv: any | null) => void;
}) {
  const [linked, setLinked] = useState<any | null>(invoice);
  useEffect(() => setLinked(invoice), [invoice]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Prefer the deduped `invoice_tracker_latest` view (one row per invoice);
      // fall back to the raw sync table when the view isn't created yet.
      const fetchFrom = (source: string) => {
        let q = (supabase as any).from(source)
          .select("id, mbl, hbl, shipment_invoice_number, forwarder, containers_linked_to_this_invoice, container_id, container_number")
          .order("id", { ascending: false }).limit(300);
        const term = search.trim();
        if (term) q = q.or(`mbl.ilike.%${term}%,shipment_invoice_number.ilike.%${term}%,hbl.ilike.%${term}%`);
        return q;
      };
      let { data, error } = await fetchFrom("invoice_tracker_latest");
      if (error) ({ data } = await fetchFrom("invoice_tracker"));
      if (!cancelled) {
        // The Airtable sync inserts a new snapshot row on every change, so one
        // invoice appears dozens of times. Newest snapshot (highest id) wins.
        const seen = new Set<string>();
        const unique = ((data ?? []) as any[]).filter((inv) => {
          const key = `${inv.mbl ?? ""}|${inv.hbl ?? ""}`.trim().toUpperCase();
          const k = key === "|" ? `id:${inv.id}` : key;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).slice(0, 50);
        setResults(unique); setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, search]);

  const containersOf = (inv: any) =>
    inv?.containers_linked_to_this_invoice
      || String(inv?.container_id || "").replace(/^#/, "")
      || String(inv?.container_number || "").replace(/[\r\n]+/g, ", ");
  const titleOf = (inv: any) => inv?.mbl || inv?.shipment_invoice_number || inv?.hbl || `Invoice #${inv?.id}`;
  const pick = (inv: any) => { setLinked(inv); onLink(inv); setOpen(false); setSearch(""); };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b pb-2">
        <h3 className="text-base font-bold tracking-tight text-foreground">Freight Bills</h3>
        <div className="flex items-center gap-3">
        <PanelLeft className="h-4 w-4 text-muted-foreground" />
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
          <PopoverTrigger asChild>
            <Button size="sm" className="h-8" disabled={!requestId}><Plus className="h-3.5 w-3.5 mr-1" /> Add invoice</Button>
          </PopoverTrigger>
          <PopoverContent className="w-[720px] p-0" align="end">
            <Command shouldFilter={false}>
              <CommandInput placeholder="Search…" value={search} onValueChange={setSearch} />
              <CommandList>
                <CommandEmpty>{loading ? "Searching…" : "No invoices found."}</CommandEmpty>
                {results.map((inv) => {
                  const containers = containersOf(inv).split(/[\r\n,;]+/).map((s: string) => s.trim()).filter(Boolean);
                  const fwd = String(inv.forwarder ?? "").trim();
                  return (
                    <CommandItem key={inv.id} value={String(inv.id)} className="group cursor-pointer flex-col items-start gap-1.5 py-2.5" onSelect={() => pick(inv)}>
                      <span className="text-sm font-semibold truncate w-full">{titleOf(inv)}</span>
                      <div className="grid grid-cols-3 gap-4 w-full">
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground group-data-[selected=true]:text-accent-foreground/80">Containers Linked To This Invoice</div>
                          {containers.length ? (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {containers.map((c: string, i: number) => (
                                <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">{c}</span>
                              ))}
                            </div>
                          ) : <div className="text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground/80 mt-1">—</div>}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground group-data-[selected=true]:text-accent-foreground/80">Forwarder</div>
                          {fwd ? (
                            <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: getFreightForwarderColor(fwd).bg, color: getFreightForwarderColor(fwd).text }}>{fwd}</span>
                          ) : <div className="text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground/80 mt-1">—</div>}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground group-data-[selected=true]:text-accent-foreground/80">Name</div>
                          <div className="text-xs mt-1 truncate">{titleOf(inv)}</div>
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        </div>
      </div>
      {linked ? (
        <div className="rounded-md border bg-background px-3 py-2.5">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="font-semibold text-sm">{titleOf(linked)}</div>
            <button type="button" onClick={() => { setLinked(null); onLink(null); }} className="text-muted-foreground hover:text-destructive shrink-0"><X className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-1.5 text-xs">
            <div>
              <div className="uppercase text-[10px] text-muted-foreground tracking-wide">MBL</div>
              <div>{linked.mbl || "—"}</div>
            </div>
            <div>
              <div className="uppercase text-[10px] text-muted-foreground tracking-wide">Containers Linked</div>
              <div>{containersOf(linked) || "—"}</div>
            </div>
            <div>
              <div className="uppercase text-[10px] text-muted-foreground tracking-wide">Forwarder</div>
              <div>{linked.forwarder ? <ColorPill label={String(linked.forwarder)} colors={hashPill(String(linked.forwarder))} /> : "—"}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-10">
          <DocStackIllustration />
          <p className="text-sm text-muted-foreground mt-4">No invoices yet</p>
        </div>
      )}
    </section>
  );
}

function ShippingFormDialog({
  open, onOpenChange, row, onSave, loading, title, vendorOptions = [], layout = "flat", onDelete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: Record<string, unknown> | null;
  onSave: (data: Record<string, unknown>) => void;
  loading?: boolean;
  title: string;
  vendorOptions?: FactoryOption[];
  layout?: "flat" | "sections";
  onDelete?: () => void;
}) {
  const { profile } = useAuth();
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const requestId = row && (row as any).id != null ? Number((row as any).id) : null;

  // ── Comments state ──
  const [comments, setComments] = useState<ShippingComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentSending, setCommentSending] = useState(false);
  const [mentioned, setMentioned] = useState<MentionUser[]>([]);

  // ── Linked Freight Bills record (shown as an Airtable-style card) ──
  const [invoiceData, setInvoiceData] = useState<any | null>(null);
  // ── Factory master row, joined by full_factory_name for the Factory Code card ──
  const [factoryData, setFactoryData] = useState<any | null>(null);
  // ── Packing-list attachment being previewed (spreadsheet/pdf/image viewer) ──
  const [previewFile, setPreviewFile] = useState<PackingFile | null>(null);
  const [packingUploading, setPackingUploading] = useState(false);
  const [poPickerOpen, setPoPickerOpen] = useState(false);
  const [poSearch, setPoSearch] = useState("");
  const [poResults, setPoResults] = useState<any[]>([]);
  const [poSearching, setPoSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (row) {
      setFormData({ ...row });
    } else {
      const blank: Record<string, unknown> = {};
      for (const f of RECORD_FIELDS) blank[f.key] = f.kind === "number" || f.kind === "currency" ? null : "";
      setFormData(blank);
    }
  }, [open, row]);

  // Load + live-subscribe comments for this record.
  useEffect(() => {
    if (!open || !requestId) { setComments([]); return; }
    let cancelled = false;
    setCommentsLoading(true);
    (async () => {
      const { data } = await (supabase as any)
        .from("shipping_request_comments").select("*").eq("request_id", requestId).order("created_at", { ascending: true });
      if (!cancelled) { setComments((data ?? []) as ShippingComment[]); setCommentsLoading(false); }
    })();
    const ch = (supabase as any)
      .channel(`src_comments_${requestId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shipping_request_comments", filter: `request_id=eq.${requestId}` },
        (p: any) => setComments((prev) => prev.some((c) => c.id === p.new.id) ? prev : [...prev, p.new as ShippingComment]))
      .subscribe();
    return () => { cancelled = true; (supabase as any).removeChannel(ch); };
  }, [open, requestId]);

  // Resolve the linked invoice record for the Freight Bills card.
  useEffect(() => {
    const invId = row ? (row as any).invoice_tracker_id : null;
    if (!open || !invId) { setInvoiceData(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("invoice_tracker")
        .select("id, mbl, containers_linked_to_this_invoice, container_id, container_number, forwarder, shipment_invoice_number")
        .eq("id", invId).maybeSingle();
      if (!cancelled) setInvoiceData(data ?? null);
    })();
    return () => { cancelled = true; };
  }, [open, row]);

  // Resolve the factory master row (code/country/status) by full factory name.
  // Keyed on the LIVE formData value, not the original `row` prop -- unlinking
  // (the Factory Card's "X") clears formData.full_factory_name locally, but
  // that never touches `row` itself, so keying on `row` left this stale and
  // made the card look like the X hadn't done anything (code fell back to
  // the still-populated factoryData.factory_code).
  const liveFactoryName = String((formData as any).full_factory_name ?? "").trim();
  useEffect(() => {
    if (!open || !liveFactoryName) { setFactoryData(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("vendor_directory").select("factory_code, full_factory_name, factory_short_name, country_of_origin, status").eq("full_factory_name", liveFactoryName).maybeSingle();
      if (!cancelled) setFactoryData(data ? { ...data, country: data.country_of_origin } : null);
    })();
    return () => { cancelled = true; };
  }, [open, liveFactoryName]);

  // Resolve the linked Order Pipeline record for the "Purchase Order" card. The
  // `purchase_order` column only holds the raw Airtable link id (unusable —
  // po_tracker has no matching column), so join on the reverse link instead:
  // po_tracker.shipping_requests stores THIS request's own receipt_number.
  // A shipping request can legitimately have MULTIPLE linked POs (the `pos`
  // field itself already stores several PO numbers per request) — this is a
  // one-to-many list, not a single card.
  type PoRow = { id: number; po_number: string; target_completion_date: string | null };
  const [poList, setPoList] = useState<PoRow[]>([]);
  useEffect(() => {
    const receiptNumber = row ? String((row as any).receipt_number ?? "").trim() : "";
    if (!open || !receiptNumber) { setPoList([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("po_tracker").select("id, po_number, target_completion_date").eq("shipping_requests", receiptNumber).order("id", { ascending: true });
      if (!cancelled) setPoList((data ?? []) as PoRow[]);
    })();
    return () => { cancelled = true; };
  }, [open, row]);

  // Order Pipeline search (for linking a Purchase Order to this request).
  useEffect(() => {
    if (!poPickerOpen) return;
    let cancelled = false;
    setPoSearching(true);
    (async () => {
      let q = (supabase as any).from("po_tracker")
        .select("id, po_number, target_completion_date, vendor_name")
        .order("id", { ascending: false }).limit(50);
      const term = poSearch.trim();
      if (term) q = q.ilike("po_number", `%${term}%`);
      const { data } = await q;
      if (!cancelled) { setPoResults((data ?? []) as any[]); setPoSearching(false); }
    })();
    return () => { cancelled = true; };
  }, [poPickerOpen, poSearch]);

  const linkPo = async (poRow: any) => {
    const receiptNumber = String(formData["receipt_number"] ?? "").trim();
    if (!receiptNumber || poList.some((p) => p.id === poRow.id)) { setPoPickerOpen(false); setPoSearch(""); return; }
    try {
      const { error } = await (supabase as any).from("po_tracker").update({ shipping_requests: receiptNumber }).eq("id", poRow.id);
      if (error) throw error;
      setPoList((prev) => [...prev, { id: poRow.id, po_number: poRow.po_number, target_completion_date: poRow.target_completion_date }]);
      setPoPickerOpen(false); setPoSearch("");
    } catch (e: any) {
      toast.error("Failed to link PO: " + e.message);
    }
  };

  const unlinkPo = async (id: number) => {
    setPoList((prev) => prev.filter((p) => p.id !== id));
    const { error } = await (supabase as any).from("po_tracker").update({ shipping_requests: null }).eq("id", id);
    if (error) toast.error("Failed to unlink PO: " + error.message);
  };

  const set = (key: string, val: unknown) => setFormData((p) => ({ ...p, [key]: val }));

  const handleSubmit = () => {
    const payload: Record<string, unknown> = {};
    for (const f of RECORD_FIELDS) {
      if (f.kind === "readonly" || f.kind === "attachment" || f.kind === "attachmentUpload" || f.kind === "invoiceCard" || f.kind === "notesList" || f.kind === "factoryCard" || f.kind === "poCard") continue;
      const v = formData[f.key];
      if (f.kind === "number" || f.kind === "currency") payload[f.key] = v === "" || v === null || v === undefined ? null : Number(v);
      else if (f.kind === "yesnoBool") payload[f.key] = v === null || v === undefined || v === "" ? null : (v === true || String(v).toLowerCase() === "yes");
      else payload[f.key] = v === "" ? null : v ?? null;
    }
    // Linked Freight Bills record (set via the full-screen Invoice panel).
    if ("invoice_tracker_id" in formData) payload["invoice_tracker_id"] = (formData["invoice_tracker_id"] as any) ?? null;
    // ref_calculated isn't in RECORD_FIELDS (it's rendered as the dialog's
    // title, not a form row), so the loop above never picks it up -- without
    // this, correcting the REF# prefix via the Factory Card would update the
    // title on screen but silently fail to persist on Save.
    if ("ref_calculated" in formData) payload["ref_calculated"] = (formData["ref_calculated"] as any) || null;
    onSave(payload);
  };

  const addComment = async () => {
    const body = commentBody.trim();
    if (!body || !requestId || !profile?.id) return;
    setCommentSending(true);
    try {
      const author_name = profile.full_name || profile.email?.split("@")[0] || "User";
      const emails = [...new Set(mentioned.filter((u) => u.email && body.includes(`@${u.full_name || u.email}`)).map((u) => u.email as string))];
      const { data, error } = await (supabase as any)
        .from("shipping_request_comments")
        .insert({ request_id: requestId, author_id: profile.id, author_name, body, mentioned_emails: emails.length ? emails : null })
        .select().single();
      if (error) throw error;
      setCommentBody(""); setMentioned([]);
      if (data) setComments((prev) => prev.some((c) => c.id === data.id) ? prev : [...prev, data as ShippingComment]);
      if (emails.length) {
        void notifyMention({
          to: emails.join(", "), commenter: author_name, body,
          recordRef: String(formData["ref_calculated"] ?? ""),
          link: `https://demo.example.invalid/shipping-requests?open=${requestId}`,
        });
      }
    } catch (e: any) {
      toast.error("Failed to add comment: " + e.message);
    } finally {
      setCommentSending(false);
    }
  };

  const refTitle = formData["ref_calculated"] ? String(formData["ref_calculated"]) : "";
  // Attachments shown with their ORIGINAL filename (from packing_list) but the
  // downloadable Supabase URL (from packing_list_files) when available.
  const panelAttachments: PackingFile[] = (() => {
    const plf = (formData as any).packing_list_files;
    const pl = (formData as any).packing_list;
    if (Array.isArray(plf) && plf.length) {
      return plf.map((f: any, i: number) => ({
        url: String(f?.url || ""),
        filename: (Array.isArray(pl) && pl[i]?.filename) ? String(pl[i].filename) : (String(f?.storage_path || "").split("/").pop() || "file"),
        thumbnail_url: f?.thumbnail_url ? String(f.thumbnail_url) : (Array.isArray(pl) && pl[i]?.thumbnail_url ? String(pl[i].thumbnail_url) : undefined),
        type: f?.type ? String(f.type) : (Array.isArray(pl) && pl[i]?.type ? String(pl[i].type) : undefined),
      }));
    }
    if (Array.isArray(pl) && pl.length) return pl.map((f: any) => ({ url: String(f?.url || ""), filename: String(f?.filename || "file"), thumbnail_url: f?.thumbnail_url ? String(f.thumbnail_url) : undefined, type: f?.type ? String(f.type) : undefined }));
    return [];
  })();

  // Once the user adds/removes a Packing List file via the app, flatten the
  // merged list back into `packing_list` (the single source of truth going
  // forward) and clear `packing_list_files` so the two never drift apart —
  // this field is excluded from the generic Save payload, so persist directly.
  const persistPackingList = async (next: PackingFile[]) => {
    set("packing_list", next.length ? next : null);
    set("packing_list_files", null);
    if (!requestId) return;
    const { error } = await (supabase as any)
      .from("shipping_requests")
      .update({ packing_list: next.length ? next : null, packing_list_files: null })
      .eq("id", requestId);
    if (error) toast.error("Failed to save packing list: " + error.message);
  };

  const addPackingFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !requestId) return;
    setPackingUploading(true);
    try {
      const uploaded: PackingFile[] = [];
      for (const file of Array.from(fileList)) {
        const ext = sanitizeExt(file.name);
        const path = `${requestId}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
        const { error: upErr } = await (supabase as any).storage.from(PACKING_BUCKET).upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = (supabase as any).storage.from(PACKING_BUCKET).getPublicUrl(path);
        uploaded.push({ filename: file.name, url: publicUrl, type: file.type });
      }
      await persistPackingList([...panelAttachments, ...uploaded]);
      toast.success(`Uploaded ${uploaded.length} file${uploaded.length > 1 ? "s" : ""}`);
    } catch (e: any) {
      toast.error("Upload failed: " + (e?.message ?? "unknown error"));
    } finally {
      setPackingUploading(false);
    }
  };

  const removePackingFile = (i: number) => void persistPackingList(panelAttachments.filter((_, idx) => idx !== i));
  const invoiceContainers = invoiceData
    ? (invoiceData.containers_linked_to_this_invoice
        || String(invoiceData.container_id || "").replace(/^#/, "")
        || String(invoiceData.container_number || "").replace(/[\r\n]+/g, ", "))
    : "";

  const renderEditor = (f: RecField) => {
    const raw = formData[f.key];
    const str = raw === null || raw === undefined ? "" : String(raw);
    switch (f.kind) {
      case "pillMulti":
        return <PillMultiSelect value={str} onChange={(v) => set(f.key, v)} options={f.options!} colorMap={f.colorMap!} />;
      case "pillSingle":
        return <PillSelect value={str} onChange={(v) => set(f.key, v)} options={f.options!} colorMap={f.colorMap!} />;
      case "yesnoBool": {
        const yn = raw === true ? "Yes" : raw === false ? "No" : "";
        return <PillSelect value={yn} onChange={(v) => set(f.key, v === "Yes" ? true : v === "No" ? false : null)} options={YES_NO_OPTIONS} colorMap={YESNO_COLORS} />;
      }
      case "pol":
        return <PolCombobox value={str} onChange={(v) => set(f.key, v)} />;
      case "factory":
        return <FactoryCombobox value={str} options={vendorOptions} onChange={(name, code) => set(f.key, code || name)} />;
      case "collab":
        return <CollabField value={str} onChange={(v) => set(f.key, v)} />;
      case "pillText": {
        if (layout !== "sections")
          return str
            ? <div className="py-1"><ColorPill label={str} colors={hashPill(str)} /></div>
            : <span className="text-sm text-muted-foreground">—</span>;
        const colors = str ? hashPill(str) : null;
        // Freight Carrier fills the whole box solid — Freight Forwarder shows
        // as a removable chip with an X, matching the Airtable reference.
        if (f.key === "freight_carrier") {
          return (
            <div
              className="flex h-9 w-full items-center justify-between rounded-md px-3"
              style={{ backgroundColor: colors?.bg ?? "#F3F4F6", color: colors?.text ?? "#6B7280" }}
            >
              <input
                value={str}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder="—"
                className="bg-transparent border-none outline-none text-sm font-semibold w-full placeholder:opacity-70"
                style={{ color: "inherit" }}
              />
              <ChevronDown className="h-4 w-4 opacity-70 shrink-0" />
            </div>
          );
        }
        return (
          <div className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3">
            {str ? (
              <span className="inline-flex items-center gap-1 min-w-0">
                <ColorPill label={str} colors={colors!} />
                <button type="button" onClick={() => set(f.key, "")} className="shrink-0 text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ) : (
              <input value={str} onChange={(e) => set(f.key, e.target.value)} placeholder="—"
                className="bg-transparent border-none outline-none text-sm w-full min-w-0" />
            )}
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
          </div>
        );
      }
      case "notesList":
        return <NotesField requestId={requestId} />;
      case "poCard": {
        const fmtTcd = (v: string | null) => (v ? fmtDate(v) ?? "—" : "—");
        return (
          <div className="space-y-2">
            {poList.map((po) => (
              <div key={po.id} className="rounded-md border bg-background px-3 py-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-sm">{po.po_number || "—"}</div>
                  <button type="button" onClick={() => void unlinkPo(po.id)} className="text-muted-foreground hover:text-destructive shrink-0" title="Unlink PO">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Target Completion Date</div>
                  <div className="text-xs">{fmtTcd(po.target_completion_date)}</div>
                </div>
              </div>
            ))}
            <Popover open={poPickerOpen} onOpenChange={(o) => { setPoPickerOpen(o); if (!o) setPoSearch(""); }}>
              <PopoverTrigger asChild>
                <button type="button" disabled={!requestId}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
                  <Plus className="h-3.5 w-3.5" /> Add record
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[360px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Search PO number…" value={poSearch} onValueChange={setPoSearch} />
                  <CommandList>
                    <CommandEmpty>{poSearching ? "Searching…" : "No POs found."}</CommandEmpty>
                    {poResults.map((p) => (
                      <CommandItem key={p.id} value={String(p.id)} className="group cursor-pointer flex-col items-start gap-0.5" onSelect={() => void linkPo(p)}>
                        <span className="text-sm font-semibold">{p.po_number}</span>
                        <span className="text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground/80">{p.vendor_name || "—"}</span>
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        );
      }
      case "factoryCard": {
        // Prefer vndr_copy — it's the same underlying field the List View's
        // "Factory Code" column reads/writes, so inline-editing it there must
        // show up here too. Only fall back to the name-resolved lookup when
        // vndr_copy itself is blank (older records that never got it set).
        const code = String(formData["vndr_copy"] ?? "").trim() || factoryData?.factory_code || "";
        const accounts = String(formData["factory_account"] ?? "").split(/,\s*/).map((s) => s.trim()).filter(Boolean);
        const linked = !!(code || str || accounts.length);
        const addPicker = (
          <FactoryCombobox
            value=""
            options={vendorOptions}
            trigger={<Button size="sm" variant="outline" className="h-7 text-xs"><Plus className="h-3 w-3 mr-1" /> Add</Button>}
            onChange={(name, pickedCode) => {
              set("full_factory_name", name);
              if (pickedCode) {
                set("vndr_copy", pickedCode);
                // REF# was generated once at creation and never recomputed --
                // when a factory is linked/corrected after the fact, fix just
                // the prefix (prepending when the ref starts with the date),
                // keeping the date/CRD/CBM/suffix segments untouched. Only
                // when there's already a REF# to correct; doesn't fabricate
                // one from scratch here.
                const currentRef = String(formData["ref_calculated"] ?? "");
                if (currentRef) set("ref_calculated", correctRefPrefix(currentRef, pickedCode, String(formData["date_requested"] ?? "")));
              }
            }}
          />
        );
        if (!linked) return (
          <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2.5 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">No factory linked</span>
            {addPicker}
          </div>
        );
        return (
          <div className="rounded-md border bg-background px-3 py-2.5">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="font-semibold text-sm">{code || "—"}</div>
              <button type="button" onClick={() => { set("full_factory_name", null); set("vndr_copy", null); }} className="text-muted-foreground hover:text-destructive shrink-0" title="Unlink factory">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-1.5 text-xs">
              <div>
                <div className="uppercase text-[10px] text-muted-foreground tracking-wide">Factory Short Name</div>
                <div>{factoryData?.factory_short_name || "—"}</div>
              </div>
              <div>
                <div className="uppercase text-[10px] text-muted-foreground tracking-wide">Full Factory Name</div>
                <div>{factoryData?.full_factory_name || "—"}</div>
              </div>
            </div>
          </div>
        );
      }
      case "invoiceCard": {
        if (!str && !invoiceData) return <span className="text-sm text-muted-foreground">No linked invoice</span>;
        return (
          <div className="rounded-md border bg-background px-3 py-2.5">
            <div className="font-semibold text-sm mb-2">{str || invoiceData?.shipment_invoice_number || "—"}</div>
            <div className="flex flex-wrap gap-x-8 gap-y-1.5 text-xs">
              <div>
                <div className="uppercase text-[10px] text-muted-foreground tracking-wide">MBL</div>
                <div>{invoiceData?.mbl || "—"}</div>
              </div>
              <div>
                <div className="uppercase text-[10px] text-muted-foreground tracking-wide">Containers Linked</div>
                <div>{invoiceContainers || "—"}</div>
              </div>
              <div>
                <div className="uppercase text-[10px] text-muted-foreground tracking-wide">Forwarder</div>
                <div>{invoiceData?.forwarder ? <ColorPill label={String(invoiceData.forwarder)} colors={hashPill(String(invoiceData.forwarder))} /> : "—"}</div>
              </div>
            </div>
          </div>
        );
      }
      case "checkbox": {
        const on = str === "true" || str === "True" || raw === true;
        return (
          <div className="flex items-center h-9">
            <Checkbox checked={on} onCheckedChange={(c) => set(f.key, c ? "true" : "")} />
          </div>
        );
      }
      case "attachment":
        return (
          <div className="space-y-2">
            {panelAttachments.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {panelAttachments.map((file, i) => {
                  const safeUrl = /^(https?:\/\/|\/)/i.test(file.url) ? file.url : "#";
                  const ext = (file.filename.split(".").pop() ?? "").toLowerCase();
                  return (
                    <div key={i} className="relative flex items-center gap-2 rounded-md border bg-muted/30 p-1.5">
                      <button type="button" onClick={() => setPreviewFile(file)} title={`Preview ${file.filename}`}
                        className="flex items-center gap-2 text-left hover:opacity-80 transition">
                        <MiniDocPreview safeUrl={safeUrl} ext={ext} mime={file.type ?? ""} />
                        <span className="max-w-[180px] truncate text-xs">{file.filename}</span>
                      </button>
                      {layout === "sections" && requestId && (
                        <button type="button" onClick={() => removePackingFile(i)} title="Remove" className="shrink-0 text-muted-foreground hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {layout === "sections" && (
              requestId ? (
                <label
                  className="flex items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-muted-foreground/25 bg-muted/20 hover:bg-muted/30 px-4 py-3 text-center cursor-pointer transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); void addPackingFiles(e.dataTransfer.files); }}
                >
                  <UploadCloud className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{packingUploading ? "Uploading…" : "Drop files here or click to browse"}</span>
                  <input type="file" multiple className="hidden" disabled={packingUploading} onChange={(e) => void addPackingFiles(e.target.files)} />
                </label>
              ) : (
                !panelAttachments.length && <span className="text-sm text-muted-foreground">No attachment</span>
              )
            )}
            {layout !== "sections" && !panelAttachments.length && <span className="text-sm text-muted-foreground">No attachment</span>}
          </div>
        );
      case "attachmentUpload": {
        const list: LateFeeFile[] = Array.isArray(raw) ? raw : [];
        return (
          <LateFeesAttachment
            requestId={requestId}
            files={list}
            onChange={(next) => set(f.key, next)}
          />
        );
      }
      case "longtext":
        return layout === "sections"
          ? <AutoTextarea value={str} onChange={(v) => set(f.key, v)} className="min-h-[56px]" />
          : <Textarea value={str} onChange={(e) => set(f.key, e.target.value)} className="min-h-[56px] text-sm resize-y" />;
      case "currency":
        return (
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
            <Input type="number" value={str} onChange={(e) => set(f.key, e.target.value)} className="h-9 text-sm pl-6" />
          </div>
        );
      case "number":
        if (layout === "sections" && f.key === "forty_ft_aprv")
          return <Decimal1Field value={str} onChange={(v) => set(f.key, v)} />;
        return <Input type="number" value={str} onChange={(e) => set(f.key, e.target.value)} className="h-9 text-sm" />;
      case "date":
        return <Input type="date" value={str} onChange={(e) => set(f.key, e.target.value)} className="h-9 text-sm" />;
      case "readonly": {
        // Date Requested is a system date-stamp stored as a plain ISO string —
        // format it like every other date field instead of showing raw text.
        if (f.key === "date_requested" && str) {
          const formatted = fmtDate(str);
          if (formatted) return <Input value={formatted} readOnly disabled className="h-9 text-sm bg-muted/40" />;
        }
        return <Input value={str} readOnly disabled className="h-9 text-sm bg-muted/40" />;
      }
      default:
        if (layout === "sections" && f.key === "booking_info_contact")
          return <MailtoLinksField value={str} onChange={(v) => set(f.key, v)} />;
        return <Input value={str} onChange={(e) => set(f.key, e.target.value)} className="h-9 text-sm" />;
    }
  };

  // Comments sidebar — shared by the flat and full-screen (sections) layouts.
  const commentsAside = (
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
              <div className="h-7 w-7 shrink-0 rounded-full bg-primary/15 text-primary text-[11px] font-semibold flex items-center justify-center">
                {commentInitials(c.author_name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium truncate">{c.author_name || "User"}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="border-t p-3 shrink-0 space-y-2">
        <MentionInput
          value={commentBody}
          onChange={setCommentBody}
          onPick={(u) => setMentioned((prev) => prev.some((x) => x.id === u.id) ? prev : [...prev, u])}
          onEnter={() => void addComment()}
          placeholder={requestId ? "Leave a comment… (@ to mention)" : "Save the record first to comment"}
          disabled={!requestId || commentSending}
          className="min-h-[60px] text-sm resize-none bg-background"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void addComment()} disabled={!requestId || commentSending || !commentBody.trim()}>
            {commentSending ? "Sending…" : "Comment"}
          </Button>
        </div>
      </div>
    </aside>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("p-0 gap-0 !flex flex-col overflow-hidden", layout === "sections" ? "max-w-[1700px] w-[98vw] h-[95vh] max-h-[95vh]" : "max-w-5xl max-h-[90vh]")}>
        {layout === "sections" ? (
          <div className="px-6 pt-4 pb-4 border-b shrink-0">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to <span className="inline-flex items-center gap-1 font-medium text-foreground"><Truck className="h-3.5 w-3.5" /> Dispatch Requests</span>
            </button>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0 rounded-lg border bg-background px-4 py-3">
                <DialogTitle className="text-2xl font-bold tracking-tight leading-tight truncate">{refTitle || title}</DialogTitle>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete?.()}>
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete request
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="destructive" className="shrink-0" onClick={() => onDelete?.()}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete request
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-6 pt-5 pb-4 border-b shrink-0">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-1">REF # (Calculated)</p>
            <DialogTitle className="text-2xl font-bold tracking-tight leading-tight">{refTitle || title}</DialogTitle>
          </div>
        )}

        {layout === "sections" ? (
          <div className="flex flex-1 min-h-0">
          <ScrollArea className="flex-1 min-w-0">
            <div className="mx-auto max-w-5xl px-6 py-5 space-y-8 xl:max-w-6xl 2xl:max-w-7xl">
              {(() => {
                // Exact field + arrangement per the design screenshots. Reuses
                // renderEditor for every field; computed values (receipt_number)
                // render as plain text.
                const F = (key: string) => RECORD_FIELDS.find((f) => f.key === key);
                const cell = (key: string) => {
                  const f = F(key);
                  return f ? (
                    <div className="space-y-1.5 min-w-0" key={key}>
                      <label className="text-[13px] font-medium text-muted-foreground">{f.label}</label>
                      <div className="min-w-0">{renderEditor(f)}</div>
                    </div>
                  ) : null;
                };
                const plain = (key: string) => {
                  const f = F(key);
                  if (!f) return null;
                  const v = formData[f.key];
                  return (
                    <div className="space-y-1 min-w-0" key={key}>
                      <label className="text-[13px] font-medium text-muted-foreground">{f.label}</label>
                      <div className="text-sm text-foreground py-1.5">{v == null || v === "" ? "—" : String(v)}</div>
                    </div>
                  );
                };
                const sec = (secTitle: string, children: React.ReactNode, tinted = false, action?: React.ReactNode) => (
                  <section className={cn("space-y-4", tinted && "rounded-lg border bg-muted/30 p-5")}>
                    <div className="flex items-center justify-between gap-4 border-b pb-2">
                      <h3 className="text-base font-bold tracking-tight text-foreground">{secTitle}</h3>
                      {action}
                    </div>
                    {children}
                  </section>
                );
                const g2 = "grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4";
                const g3 = "grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4";
                const g4 = "grid grid-cols-1 sm:grid-cols-4 gap-x-6 gap-y-4";
                return (
                  <>
                    <NotesField requestId={requestId} variant="panel" />

                    {sec("Progress", cell("progress"))}

                    {sec("Factory Information", (
                      <div className={g2}>
                        <div className="space-y-4">
                          {cell("factory_name_form")}
                          {cell("cancellation_fee_agreement")}
                        </div>
                        {cell("factory_code")}
                      </div>
                    ))}

                    {sec("Request Information", (
                      <div className="space-y-4">
                        <div className={g3}>
                          {cell("date_requested")}
                          {cell("inspection_date")}
                          {cell("new_inspection")}
                        </div>
                        <div className={g3}>
                          {cell("cargo_ready_date")}
                          {cell("new_crd")}
                          {cell("qc_check_pass")}
                        </div>
                        <div className={g3}>
                          {cell("cargo_volume_cbm")}
                          {cell("packing_list")}
                        </div>
                        <div className={g2}>
                          {cell("port_of_loading")}
                          {cell("pickup_location")}
                        </div>
                        {cell("booking_info_contact")}
                        {cell("factory_notes")}
                      </div>
                    ))}

                    {sec("Purchase Order Information", (
                      <div className={g3}>
                        <div className="space-y-4">
                          {cell("pos")}
                          {cell("po_complete_date")}
                        </div>
                        {cell("purchase_order")}
                        {cell("invoice_number")}
                      </div>
                    ))}

                    {sec("Approval Information", (
                      <div className={g2}>
                        {cell("qc_approved")}
                        {cell("qc_comment")}
                      </div>
                    ), true)}

                    {sec("Planning Approval", (
                      <div className="space-y-4">
                        {cell("planning_approval_status")}
                        <div className={g2}>
                          {cell("planning_comment")}
                          {cell("late_fees_files")}
                        </div>
                      </div>
                    ), true, formData["planning_approval_status"] !== "Pending" && (
                      <Button size="sm" variant="destructive" onClick={() => set("planning_approval_status", "Pending")}>
                        Mark As Pending
                      </Button>
                    ))}

                    {sec("Lead Approved", cell("lead_approved"), true)}

                    {sec("Vessel Information", (
                      <div className="space-y-4">
                        <div className={g2}>
                          {cell("vessel_name")}
                          {cell("rate")}
                        </div>
                        <div className={g4}>
                          {cell("forty_ft_aprv")}
                          {cell("freight_forwarder")}
                          {cell("freight_carrier")}
                          {cell("etd")}
                        </div>
                        <div className={g3}>
                          {cell("hbl")}
                          {cell("mbl")}
                          {cell("booking_number")}
                        </div>
                        {cell("bl_hbl_mbl_old")}
                      </div>
                    ), true)}

                    <InvoiceLinkPanel
                      requestId={requestId}
                      invoice={invoiceData}
                      onLink={(inv) => set("invoice_tracker_id", inv?.id ?? null)}
                    />

                    {plain("record_id")}
                    {plain("created_by")}
                  </>
                );
              })()}
            </div>
          </ScrollArea>
          {commentsAside}
          </div>
        ) : (
        <div className="flex flex-1 min-h-0">
          {/* Fields */}
          <ScrollArea className="flex-1 min-w-0">
            <div className="px-6 py-2 divide-y divide-border/60">
              {RECORD_FIELDS.filter((f) => f.key !== "vndr_copy").map((f) => {
                // vndr_copy stays in RECORD_FIELDS (handleSubmit's save loop still
                // needs it) but is hidden here — this row was a second, uncoordinated
                // "Factory" combobox that wrote straight to vndr_copy without
                // touching full_factory_name, letting the two drift out of sync
                // (the reported "VND1 linked to wrong factory" case). The Factory
                // Code card above is now the only place vndr_copy gets edited.
                const Icon = recFieldIcon(f.kind);
                return (
                  <div key={f.key} className="grid grid-cols-[180px_1fr] gap-4 py-3 items-start">
                    <div className="flex items-center gap-2 pt-2 text-[13px] text-muted-foreground">
                      <Icon className="h-3.5 w-3.5 opacity-60 shrink-0" />
                      <span className="truncate">{f.label}</span>
                    </div>
                    <div className="min-w-0">{renderEditor(f)}</div>
                  </div>
                );
              })}
              {/* Manual invoice-tracker linking, same panel as the Full Edit view. */}
              <InvoiceLinkPanel
                requestId={requestId}
                invoice={invoiceData}
                onLink={(inv) => set("invoice_tracker_id", inv?.id ?? null)}
              />
            </div>
          </ScrollArea>

          {commentsAside}
        </div>
        )}

        <DialogFooter className="px-6 py-3 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>{loading ? "Saving…" : "Save"}</Button>
        </DialogFooter>
        {/* Must live INSIDE DialogContent: Radix's modal Dialog sets
            pointer-events:none on everything outside its content portal, so a
            sibling render out here would leave the whole preview deaf to the
            mouse (the reported "X does not work / window does not respond" bug). */}
        {previewFile && <PackingListPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
      </DialogContent>
    </Dialog>
  );
}

const PACKING_BUCKET = "packing-lists";
const LATE_FEES_BUCKET = "late-fees";

// n8n webhook that emails the booking contact when a shipping request is created.
const N8N_SHIPPING_WEBHOOK_URL =
  (import.meta as any).env?.VITE_N8N_SHIPPING_WEBHOOK_URL ||
  "https://automation.example.invalid/webhook/shipping-request";

// n8n webhook for the "Reference Number Assigned" email — fires only when the
// row has a factory_code (vndr_copy) AND progress = Requested (mirrors the Airtable
// "record matches conditions" trigger).
const N8N_NUMBER_ASSIGNED_WEBHOOK_URL =
  (import.meta as any).env?.VITE_N8N_NUMBER_ASSIGNED_WEBHOOK_URL ||
  "https://automation.example.invalid/webhook/shipping-number-assigned";

// n8n webhook for the internal "Review Dispatch Request" notice — fires when a
// request's progress transitions to In Review (mirrors the Airtable condition trigger).
const N8N_REVIEW_WEBHOOK_URL =
  (import.meta as any).env?.VITE_N8N_REVIEW_WEBHOOK_URL ||
  "https://automation.example.invalid/webhook/shipping-review";

// n8n webhook for the "Approved For Booking" email — fires when qc_approved → Yes.
const N8N_APPROVED_WEBHOOK_URL =
  (import.meta as any).env?.VITE_N8N_APPROVED_WEBHOOK_URL ||
  "https://automation.example.invalid/webhook/qc-approved";

// n8n webhook for the "Dispatch Request Cancellation" email — fires when progress → CXL.
const N8N_CANCEL_WEBHOOK_URL =
  (import.meta as any).env?.VITE_N8N_CANCEL_WEBHOOK_URL ||
  "https://automation.example.invalid/webhook/shipping-cancel";

/** True when a Yes/approved-style value. */
function isYes(v: unknown): boolean {
  return ["yes", "true", "1"].includes(String(v ?? "").trim().toLowerCase());
}

/** All packing-list files from a row's packing_list JSON, renamed to a clean,
 *  consistent attachment name: "{REF} PACKING LIST.ext" (single) or
 *  "{REF} PACKING LIST 1.ext", "... 2.ext" (multiple). The original extension is
 *  preserved. REF falls back to the row id when ref_calculated is empty. */
function packingFilesFromRow(row: Record<string, unknown>): { url: string; filename: string }[] {
  const pl = (row as any).packing_list;
  if (!pl) return [];
  let arr: any[];
  try {
    const parsed = typeof pl === "string" ? JSON.parse(pl) : pl;
    if (!Array.isArray(parsed)) return [];
    arr = parsed;
  } catch { return []; }

  const valid = arr.filter((f: any) => /^https?:\/\//i.test(String(f?.url ?? "")));
  const ref = String((row as any).ref_calculated || (row as any).id || "").trim();
  const base = ref ? `${ref} PACKING LIST` : "PACKING LIST";

  return valid.map((f: any, i: number) => {
    const url = String(f.url);
    const ext = (String(f?.filename || url).split("?")[0].split(".").pop() || "xlsx").toLowerCase();
    const name = valid.length > 1 ? `${base} ${i + 1}.${ext}` : `${base}.${ext}`;
    return { url, filename: name };
  });
}

/** Fire-and-forget: notify n8n so it sends the "Dispatch Request Received" email
 *  (and the conditional VN-ports email). Failures are logged, never block the
 *  insert — the row is already saved by the time this runs. */
async function notifyShippingRequest(row: Record<string, unknown>): Promise<void> {
  try {
    const packingFiles = packingFilesFromRow(row);
    await fetch(N8N_SHIPPING_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Subject uses the human REF when available, else the numeric row id.
        id:       (row as any).ref_calculated || (row as any).id || "",
        to:       (row as any).booking_info_contact ?? "",
        pol:      (row as any).port_of_loading ?? "",
        progress: (row as any).progress ?? "",
        packingUrl: packingFiles[0]?.url ?? "",
        packingFiles,
      }),
    });
  } catch (e) {
    console.warn("[ShippingRequests] email webhook failed:", e);
  }
}

/** Fire-and-forget: "Dispatch Request Number Assigned" email. Mirrors the Airtable
 *  "record matches conditions" trigger — only sends when the row has a factory code
 *  (vndr_copy) AND progress = Requested. */
async function notifyNumberAssigned(row: Record<string, unknown>): Promise<void> {
  const hasFactoryCode = !!(row as any).vndr_copy;
  const isNewReq = String((row as any).progress ?? "").toUpperCase() === "Requested";
  if (!hasFactoryCode || !isNewReq) return;
  try {
    const packingFiles = packingFilesFromRow(row);
    await fetch(N8N_NUMBER_ASSIGNED_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to:            (row as any).booking_info_contact ?? "",
        ref:           (row as any).ref_calculated || (row as any).id || "",
        recordId:      (row as any).record_id ?? "",
        dateRequested: (row as any).date_requested ?? "",
        cargoReadyDate:(row as any).cargo_ready_date ?? "",
        packingUrl: packingFiles[0]?.url ?? "",
        packingFiles,
      }),
    });
  } catch (e) {
    console.warn("[ShippingRequests] number-assigned webhook failed:", e);
  }
}

/** Fire-and-forget: internal "Review Dispatch Request" notice to the logistics reviewer/logistics.
 *  Called from the Edit flow only when progress transitions to In Review. */
async function notifyReview(row: Record<string, unknown>): Promise<void> {
  try {
    await fetch(N8N_REVIEW_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref:      (row as any).ref_calculated || (row as any).id || "",
        progress: (row as any).progress ?? "",
      }),
    });
  } catch (e) {
    console.warn("[ShippingRequests] review webhook failed:", e);
  }
}

/** Fire-and-forget: "Approved For Booking" email to the logistics reviewer/logistics with the
 *  packing list attached. Called from the Edit flow when qc_approved → Yes. */
async function notifyApproved(row: Record<string, unknown>): Promise<void> {
  try {
    await fetch(N8N_APPROVED_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref:          (row as any).ref_calculated || (row as any).id || "",
        qcApproved:   "Yes",
        openId:       (row as any).id ?? "",
        packingFiles: packingFilesFromRow(row),
      }),
    });
  } catch (e) {
    console.warn("[ShippingRequests] approved webhook failed:", e);
  }
}

/** Fire-and-forget: "Dispatch Request Cancellation" email to the booking contact
 *  (CC the logistics reviewer/logistics in n8n). Called from the Edit flow when progress → CXL. */
async function notifyCancellation(row: Record<string, unknown>): Promise<void> {
  try {
    await fetch(N8N_CANCEL_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to:            (row as any).booking_info_contact ?? "",
        ref:           (row as any).ref_calculated || (row as any).id || "",
        receiptNumber: (row as any).receipt_number ?? "",
        openId:        (row as any).id ?? "",
        progress:      (row as any).progress ?? "",
        packingFiles:  packingFilesFromRow(row),
      }),
    });
  } catch (e) {
    console.warn("[ShippingRequests] cancellation webhook failed:", e);
  }
}

function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// "2026-06-19" -> "260619"
function yymmdd(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) : "";
}
// "2026-06-19" -> "0619"
function mmdd(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(5, 7) + iso.slice(8, 10) : "";
}

/** Correct an existing REF# after a factory is linked or changed.
 *
 *  A ref created BEFORE any factory was linked starts with the YYMMDD date
 *  (e.g. 260901-CRD0903-67CBM-C58) — the code must be PREPENDED there. The
 *  old logic blindly swapped the first segment, so the factory code REPLACED
 *  the creation date (tracker bug, reported: VND1-CRD0910-68CBM-8E5 instead of
 *  VND1-260901-CRD0910-68CBM-8E5). Only a first segment that is none of the
 *  structural segments (YYMMDD / CRDmmdd / …CBM) is an old factory code to
 *  swap out.
 *
 *  Also self-heals refs the old logic already mangled: when no YYMMDD segment
 *  survives, it is re-inserted from date_requested right after the prefix —
 *  so re-picking the same factory on a broken record repairs its REF#. */
function correctRefPrefix(currentRef: string, factoryCode: string, dateRequested: string): string {
  const code = factoryCode.trim().toUpperCase();
  const ref = currentRef.trim();
  if (!ref || !code) return currentRef;
  const segs = ref.split("-");
  const structural = (s: string) => /^\d{6}$/.test(s) || /^CRD\d{4}$/.test(s) || /CBM$/i.test(s);
  if (structural(segs[0])) segs.unshift(code);
  else segs[0] = code;
  const dateSeg = yymmdd(dateRequested);
  if (dateSeg && !segs.some((s) => /^\d{6}$/.test(s))) segs.splice(1, 0, dateSeg);
  return segs.join("-");
}

/** Build a reference matching the legacy Airtable format:
 *  {FACTORY_CODE}-{YYMMDD}-CRD{MMDD}-{CBM}CBM-{SUFFIX}
 *  e.g. VND1-260618-CRD0728-63.7CBM-6A0
 *  The legacy `ref_calculated` was computed in Airtable (being retired), so we
 *  generate it here on insert. Prefix = factory_code (falls back to typed name);
 *  suffix = last 3 alphanumerics of the row's record_id. */
function buildShippingRef(opts: {
  prefix: string; dateRequested: string; cargoReadyDate: string; cbm: unknown; suffix: string;
}): string {
  const parts = [
    opts.prefix.trim().toUpperCase(),
    yymmdd(opts.dateRequested),
    opts.cargoReadyDate ? "CRD" + mmdd(opts.cargoReadyDate) : "",
    opts.cbm !== "" && opts.cbm !== null && opts.cbm !== undefined ? `${opts.cbm}CBM` : "",
    opts.suffix ? opts.suffix.trim().toUpperCase() : "",
  ].filter(Boolean);
  return parts.join("-");
}

// Preset Port of Loading options for the intake form (matches the Airtable form).
const POL_OPTIONS = [
  "PORT ALPHA", "PORT BRAVO", "PORT CHARLIE", "PORT DELTA", "PORT ECHO", "PORT FOXTROT",
  "PORT GOLF", "PORT HOTEL", "PORT INDIA", "PORT JULIET", "PORT KILO", "PORT LIMA",
  "PORT MIKE", "PORT NOVEMBER", "PORT OSCAR", "PORT PAPA",
];

function PolPill({ label }: { label: string }) {
  const { bg, text } = getPOLColor(label);
  return (
    <span style={{
      backgroundColor: bg, color: text, borderRadius: "9999px", padding: "2px 12px",
      fontWeight: 600, fontSize: "12px", display: "inline-block", whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

/** Searchable single-select dropdown for Port of Loading, rendering each option
 *  as a colored pill — mirrors the Airtable "Find an option" picker. Typing a
 *  port not in the fixed list is still allowed via "+ Use ...", same as the
 *  Factory picker — nobody had to wait on a dev to add a new port before. */
function PolCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const term = search.trim();
  const showCreate = !!term && !POL_OPTIONS.some((o) => o.toLowerCase() === term.toLowerCase());
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          {value ? <PolPill label={value} /> : <span className="text-muted-foreground">Select…</span>}
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput placeholder="Find an option" value={search} onValueChange={setSearch} />
          <CommandList>
            {!showCreate && <CommandEmpty>No match.</CommandEmpty>}
            {showCreate && (
              <CommandItem value={term} onSelect={() => { onChange(term); setOpen(false); setSearch(""); }} className="cursor-pointer">
                <Plus className="h-3.5 w-3.5 mr-2" /> Use &ldquo;{term}&rdquo;
              </CommandItem>
            )}
            {POL_OPTIONS.map((opt) => (
              <CommandItem
                key={opt}
                value={opt}
                onSelect={() => { onChange(opt); setOpen(false); setSearch(""); }}
                className="cursor-pointer"
              >
                <PolPill label={opt} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const CANCELLATION_FEE_TEXT =
  "Cancellation Fee Agreement - Supplier agrees that if a booking is canceled due to a QC issue or production delay, the supplier will accept the cancellation fee that is charged by the carrier, which could be an agreed amount per container canceled.";

type FactoryOption = { factory_code: string; full_factory_name: string; factory_short_name?: string };

/** Searchable Factory picker sourced from the `vendor_directory` master table.
 *  Selecting an entry captures its `factory_code` (used as the REF prefix).
 *  Typing a name not in the list is still allowed (code falls back to empty). */
function FactoryCombobox({
  value, onChange, options, trigger,
}: {
  value: string;
  onChange: (name: string, code: string) => void;
  options: FactoryOption[];
  // Custom trigger (e.g. a compact "+ Add" button) instead of the default
  // full-width "Select factory…" button -- still the same single Popover,
  // just a different opener. Nesting a whole second FactoryCombobox inside
  // an outer "+Add" popover (the previous pattern) required two clicks: one
  // to open the outer popover, a second on the inner default trigger to
  // actually open the search list.
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const term = search.trim();
  const showCreate = !!term && !options.some(
    (o) => o.full_factory_name.toLowerCase() === term.toLowerCase() || o.factory_code.toLowerCase() === term.toLowerCase(),
  );

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            {value ? <span className="truncate">{value}</span> : <span className="text-muted-foreground">Select factory…</span>}
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[360px] max-w-[90vw] p-0" align={trigger ? "end" : "start"}>
        <Command shouldFilter={true}>
          <CommandInput placeholder="Find a factory (name or code)…" value={search} onValueChange={setSearch} />
          <CommandList>
            {!showCreate && <CommandEmpty>No match.</CommandEmpty>}
            {showCreate && (
              <CommandItem value={term} onSelect={() => { onChange(term, ""); setOpen(false); setSearch(""); }} className="cursor-pointer">
                <Plus className="h-3.5 w-3.5 mr-2" /> Use &ldquo;{term}&rdquo;
              </CommandItem>
            )}
            {options.map((o) => {
              const label = o.full_factory_name || o.factory_code;
              return (
                <CommandItem
                  key={o.factory_code}
                  value={`${o.factory_code} ${o.full_factory_name} ${o.factory_short_name ?? ""}`}
                  onSelect={() => { onChange(label, o.factory_code); setOpen(false); setSearch(""); }}
                  className="group cursor-pointer flex-col items-start gap-1 py-2"
                >
                  <span className="text-sm font-semibold">{o.factory_code}</span>
                  <div className="grid grid-cols-2 gap-x-4 w-full">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Factory Short Name</div>
                      <div className="text-[11px] group-data-[selected=true]:text-accent-foreground/80">{o.factory_short_name || "—"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Full Factory Name</div>
                      <div className="text-[11px] group-data-[selected=true]:text-accent-foreground/80">{o.full_factory_name || "—"}</div>
                    </div>
                  </div>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Curated Airtable-style intake form for creating a new shipping request.
 *  Mirrors the "New Dispatch Requests" form: required validation, a Yes/No QC
 *  dropdown, the cancellation-fee acknowledgement checkbox, and a packing-list
 *  uploader that writes file objects into the `packing_list` JSON column. */
function ShippingAddForm({
  open, onOpenChange, onSave, loading, factoryOptions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (data: Record<string, unknown>) => void;
  loading?: boolean;
  factoryOptions: FactoryOption[];
}) {
  const blank = () => ({
    factory_name_form: "",
    factory_code: "",
    cancellation_fee_agreement: false,
    qc_check_pass: "",
    inspection_date: "",
    cargo_volume_cbm: "",
    cargo_ready_date: "",
    pos: "",
    invoice_number: "",
    po_complete_date: "",
    port_of_loading: "",
    pickup_location: "",
    booking_info_contact: "",
    factory_notes: "",
  });

  const [form, setForm] = useState<Record<string, unknown>>(blank);
  const [files, setFiles] = useState<PackingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const dateRequested = useMemo(() => todayISO(), [open]);

  useEffect(() => {
    if (open) { setForm(blank()); setFiles([]); }
  }, [open]);

  const set = (key: string, val: unknown) => setForm((p) => ({ ...p, [key]: val }));

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const uploaded: PackingFile[] = [];
      for (const file of Array.from(fileList)) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
        const path = `${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
        const { error: upErr } = await (supabase as any).storage
          .from(PACKING_BUCKET)
          .upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = (supabase as any).storage
          .from(PACKING_BUCKET)
          .getPublicUrl(path);
        uploaded.push({ filename: file.name, url: publicUrl, type: file.type });
      }
      setFiles((prev) => [...prev, ...uploaded]);
      toast.success(`Uploaded ${uploaded.length} file${uploaded.length > 1 ? "s" : ""}`);
    } catch (e: any) {
      toast.error("Upload failed: " + (e?.message ?? "unknown error"));
    } finally {
      setUploading(false);
    }
  };

  // Ordered required-field checks — first miss wins so the toast names it.
  const REQUIRED: Array<[string, string]> = [
    ["factory_name_form", "Factory Name"],
    ["qc_check_pass", "Did this shipment pass the final QC inspection?"],
    ["inspection_date", "Final QC Inspection date"],
    ["cargo_volume_cbm", "Cargo Volume (CBM)"],
    ["cargo_ready_date", "Cargo Ready Date (CRD)"],
    ["pos", "PO Numbers"],
    ["invoice_number", "Invoice Number"],
    ["po_complete_date", "PO Complete Date"],
    ["port_of_loading", "Port of Loading (POL)"],
    ["booking_info_contact", "Email Address of the Booking Instructions Recipient"],
  ];

  const handleSubmit = () => {
    if (!form.cancellation_fee_agreement) {
      toast.error("Please accept the Cancellation Fee Agreement");
      return;
    }
    for (const [key, label] of REQUIRED) {
      const v = form[key];
      if (v === "" || v === null || v === undefined) {
        toast.error(`${label} is required`);
        return;
      }
    }
    const payload: Record<string, unknown> = {
      factory_name_form: form.factory_name_form,
      vndr_copy: form.factory_code || null,
      cancellation_fee_agreement: "Yes",
      qc_check_pass: form.qc_check_pass,
      inspection_date: form.inspection_date,
      cargo_volume_cbm: Number(form.cargo_volume_cbm),
      cargo_ready_date: form.cargo_ready_date,
      pos: form.pos,
      invoice_number: form.invoice_number,
      po_complete_date: form.po_complete_date,
      port_of_loading: form.port_of_loading,
      pickup_location: form.pickup_location || null,
      booking_info_contact: form.booking_info_contact,
      factory_notes: form.factory_notes || null,
      date_requested: dateRequested,
      // Tracker request: Progress stays BLANK on creation — every step,
      // including Requested, is assigned manually. The "number assigned" email
      // now fires on the manual transition to Requested instead of at creation.
      progress: null,
      packing_list: files.length ? JSON.stringify(files) : null,
    };
    onSave(payload);
  };

  const busy = loading || uploading;
  const labelCls = "text-xs font-semibold text-foreground";
  const reqMark = <span className="text-destructive"> *</span>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] !flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0"><DialogTitle>New Dispatch Request</DialogTitle></DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-2">
          <div className="space-y-4 py-2">
            {/* Factory Name */}
            <div className="grid gap-1.5">
              <Label className={labelCls}>Factory Name{reqMark}</Label>
              <Input
                value={String(form.factory_name_form ?? "")}
                onChange={(e) => setForm((p) => ({ ...p, factory_name_form: e.target.value, factory_code: "" }))}
                placeholder="Enter factory name…"
              />
            </div>

            {/* Cancellation Fee Agreement */}
            <div className="flex items-start gap-2.5">
              <Checkbox
                id="cancellation_fee_agreement"
                checked={!!form.cancellation_fee_agreement}
                onCheckedChange={(c) => set("cancellation_fee_agreement", c === true)}
                className="mt-0.5"
              />
              <Label htmlFor="cancellation_fee_agreement" className="text-xs font-normal leading-snug text-muted-foreground">
                {CANCELLATION_FEE_TEXT}{reqMark}
              </Label>
            </div>

            {/* QC pass + inspection date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className={labelCls}>Did this shipment pass the final QC inspection?{reqMark}</Label>
                <Select value={String(form.qc_check_pass ?? "")} onValueChange={(v) => set("qc_check_pass", v)}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className={labelCls}>Final QC Inspection date (Scheduled/Completed){reqMark}</Label>
                <Input type="date" value={String(form.inspection_date ?? "")}
                  onChange={(e) => set("inspection_date", e.target.value)} />
              </div>
            </div>

            <Separator />
            <h3 className="text-sm font-bold text-foreground">Cargo Information</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className={labelCls}>Cargo Volume (CBM){reqMark}</Label>
                <Input type="number" step="any" value={String(form.cargo_volume_cbm ?? "")}
                  onChange={(e) => set("cargo_volume_cbm", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label className={labelCls}>Cargo Ready Date (CRD) - Should Be After Inspection{reqMark}</Label>
                <Input type="date" value={String(form.cargo_ready_date ?? "")}
                  onChange={(e) => set("cargo_ready_date", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label className={labelCls}>PO Numbers (# Only - Comma Separated){reqMark}</Label>
                <Input value={String(form.pos ?? "")} onChange={(e) => set("pos", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label className={labelCls}>Invoice Number{reqMark}</Label>
                <Input value={String(form.invoice_number ?? "")}
                  onChange={(e) => set("invoice_number", e.target.value)} />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label className={labelCls}>PO COMPLETE DATE{reqMark}</Label>
              <Textarea rows={2} value={String(form.po_complete_date ?? "")}
                onChange={(e) => set("po_complete_date", e.target.value)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className={labelCls}>Port of Loading (POL){reqMark}</Label>
                <PolCombobox value={String(form.port_of_loading ?? "")}
                  onChange={(v) => set("port_of_loading", v)} />
              </div>
              <div className="grid gap-1.5">
                <Label className={labelCls}>Different Location Container Pick up (If Relevant)</Label>
                <Input value={String(form.pickup_location ?? "")}
                  onChange={(e) => set("pickup_location", e.target.value)} />
              </div>
            </div>

            {/* Packing list upload */}
            <div className="grid gap-1.5">
              <Label className={labelCls}>Upload Packing List (Loading Plan)</Label>
              <label
                htmlFor="packing-upload"
                className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-card/30 px-4 py-6 text-center cursor-pointer hover:bg-card/60 transition-colors"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
              >
                <UploadCloud className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {uploading ? "Uploading…" : "Drop files here or click to browse"}
                </span>
                <input id="packing-upload" type="file" multiple className="hidden"
                  onChange={(e) => handleFiles(e.target.files)} />
              </label>
              {files.length > 0 && (
                <div className="flex flex-col gap-1 mt-1">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded bg-muted px-2 py-1 text-xs">
                      <span className="truncate">{f.filename}</span>
                      <button type="button" className="text-muted-foreground hover:text-destructive"
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label className={labelCls}>Email Address of the Booking Instructions Recipient{reqMark}</Label>
              <Input type="text" value={String(form.booking_info_contact ?? "")}
                onChange={(e) => set("booking_info_contact", e.target.value)}
                placeholder="email@example.com (separate multiple with commas)" />
            </div>

            <div className="grid gap-1.5">
              <Label className={labelCls}>Additional Notes</Label>
              <Textarea rows={3} value={String(form.factory_notes ?? "")}
                onChange={(e) => set("factory_notes", e.target.value)} />
            </div>

            <div className="grid gap-1.5">
              <Label className={labelCls}>Date Requested</Label>
              <Input value={dateRequested} readOnly disabled className="max-w-[160px]" />
            </div>
          </div>
        </div>
        <DialogFooter className="sm:justify-between px-6 pb-4 pt-2 border-t">
          <Button variant="ghost" size="sm" className="text-muted-foreground mr-auto"
            onClick={() => { setForm(blank()); setFiles([]); }} disabled={busy}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Clear form
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={busy}>{loading ? "Saving…" : "Submit"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PackingFile = { filename: string; url: string; thumbnail_url?: string; type?: string };

type LateFeeFile = { filename: string; path: string; type?: string };

const LATE_FEES_MAX_BYTES = 15 * 1024 * 1024; // must match the bucket's file_size_limit
const LATE_FEES_ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "pdf", "xlsx", "xls", "docx", "doc"]);

/** Strip anything but alphanumerics so a crafted filename (e.g. containing
 *  "/" or "..") can't steer the upload outside its `${requestId}/` prefix. */
function sanitizeExt(filename: string): string {
  const raw = (filename.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return raw.slice(0, 10) || "bin";
}

/** Late Fees proof-of-charge uploader: drag-drop / click-to-browse into the
 *  private `late-fees` storage bucket, persisted immediately (this field is
 *  excluded from the form's generic Save payload, same as packing_list).
 *  The bucket is private (late fee receipts can carry financial info), so
 *  reads use short-lived signed URLs generated on render instead of a
 *  permanent public URL. */
function LateFeesAttachment({
  requestId, files, onChange,
}: {
  requestId: number | null;
  files: LateFeeFile[];
  onChange: (files: LateFeeFile[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = files.filter((f) => !signedUrls[f.path]);
      if (!missing.length) return;
      const entries = await Promise.all(missing.map(async (f) => {
        const { data } = await (supabase as any).storage.from(LATE_FEES_BUCKET).createSignedUrl(f.path, 3600);
        return [f.path, data?.signedUrl as string | undefined] as const;
      }));
      if (cancelled) return;
      setSignedUrls((prev) => {
        const next = { ...prev };
        for (const [path, url] of entries) if (url) next[path] = url;
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const persist = async (next: LateFeeFile[]) => {
    onChange(next);
    if (!requestId) return;
    const { error } = await (supabase as any)
      .from("shipping_requests")
      .update({ late_fees_files: next.length ? next : null })
      .eq("id", requestId);
    if (error) toast.error("Failed to save attachment: " + error.message);
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !requestId) return;
    const incoming = Array.from(fileList);
    const oversized = incoming.find((f) => f.size > LATE_FEES_MAX_BYTES);
    if (oversized) { toast.error(`${oversized.name} is over the 15MB limit`); return; }
    const badExt = incoming.find((f) => !LATE_FEES_ALLOWED_EXT.has(sanitizeExt(f.name)));
    if (badExt) { toast.error(`${badExt.name}: unsupported file type`); return; }

    setUploading(true);
    try {
      const uploaded: LateFeeFile[] = [];
      for (const file of incoming) {
        const ext = sanitizeExt(file.name);
        const path = `${requestId}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
        const { error: upErr } = await (supabase as any).storage.from(LATE_FEES_BUCKET).upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        uploaded.push({ filename: file.name, path, type: file.type });
      }
      await persist([...files, ...uploaded]);
      toast.success(`Uploaded ${uploaded.length} file${uploaded.length > 1 ? "s" : ""}`);
    } catch (e: any) {
      toast.error("Upload failed: " + (e?.message ?? "unknown error"));
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (i: number) => {
    const removed = files[i];
    void persist(files.filter((_, idx) => idx !== i));
    if (removed) void (supabase as any).storage.from(LATE_FEES_BUCKET).remove([removed.path]);
  };

  if (!requestId) return <span className="text-sm text-muted-foreground">Save the record first to attach files</span>;

  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {files.map((file, i) => {
            const safeUrl = signedUrls[file.path] ?? "#";
            const ext = (file.filename.split(".").pop() ?? "").toLowerCase();
            return (
              <div key={file.path} className="relative flex items-center gap-2 rounded-md border bg-muted/30 p-1.5">
                <a href={safeUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2">
                  <MiniDocPreview safeUrl={safeUrl} ext={ext} mime={file.type ?? ""} />
                  <span className="max-w-[140px] truncate text-xs">{file.filename}</span>
                </a>
                <button type="button" onClick={() => removeFile(i)} className="shrink-0 text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFiles(e.dataTransfer.files); }}
        className={cn(
          "flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors",
          dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 bg-muted/20 hover:bg-muted/30",
        )}
      >
        <UploadCloud className="h-5 w-5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{uploading ? "Uploading…" : "Drop files here or click to browse"}</span>
        <input type="file" multiple className="hidden" disabled={uploading} onChange={(e) => void handleFiles(e.target.files)} />
      </label>
    </div>
  );
}

function TruncatedCell({ full, label, align = "center" }: { full: string; label: string; align?: "left" | "center" }) {
  const [open, setOpen] = useState(false);
  const truncated = full.length > 80 ? full.slice(0, 80) + "…" : full;
  const isTruncated = full.length > 80;
  return (
    <>
      <span
        style={{ whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4, textAlign: align, display: "block", cursor: isTruncated ? "pointer" : "default" }}
        onClick={isTruncated ? () => setOpen(true) : undefined}
      >
        {truncated}
        {isTruncated && <span style={{ color: "#0f7173", fontSize: 10, marginLeft: 3, fontWeight: 600 }}>more</span>}
      </span>
      {open && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }} onClick={() => setOpen(false)}>
          <div style={{ background: "#fff", borderRadius: 10, padding: "16px 20px", width: "min(90vw, 420px)", maxHeight: "60vh", overflow: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.22)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
              <button type="button" onClick={() => setOpen(false)} style={{ background: "#f3f4f6", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, padding: "2px 8px", color: "#6b7280" }}>✕</button>
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "#111827", whiteSpace: "pre-wrap" }}>{full}</p>
          </div>
        </div>
      )}
    </>
  );
}

// Global semaphore — cap concurrent Office Online iframe loads to avoid tab overload
let _previewSlots = 0;
const MAX_PREVIEW_SLOTS = 4;
const _previewQueue: Array<() => void> = [];
function acquirePreviewSlot(cb: () => void) {
  if (_previewSlots < MAX_PREVIEW_SLOTS) { _previewSlots++; cb(); }
  else _previewQueue.push(cb);
}
function releasePreviewSlot() {
  _previewSlots = Math.max(0, _previewSlots - 1);
  const next = _previewQueue.shift();
  if (next) { _previewSlots++; next(); }
}

const OFFICE_EXTS = new Set(["xlsx","xlsm","xlsb","xls","xltx","xltm","doc","docx","docm","ppt","pptx","pptm","csv"]);

function MiniDocPreview({ safeUrl, ext, mime }: { safeUrl: string; ext: string; mime: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [readyToLoad, setReadyToLoad] = useState(false);
  const [loaded, setLoaded] = useState(false);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let acquired = false;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !acquired) {
        acquired = true;
        acquirePreviewSlot(() => setReadyToLoad(true));
      }
    }, { rootMargin: "60px" });
    obs.observe(el);
    return () => { obs.disconnect(); if (acquired && !loaded) releasePreviewSlot(); };
  }, []);

  const canPreview = ext !== "csv" && (OFFICE_EXTS.has(ext) || mime.includes("spreadsheet") || mime.includes("wordprocessing") || mime.includes("presentation") || mime.includes("excel") || mime.includes("word")) && safeUrl !== "#";
  const viewerUrl  = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(safeUrl)}`;

  // 500px inner viewport → scale 0.144 → 72×72 visible. ~44% less work than 900px.
  const INNER = 500;
  const SCALE = 72 / INNER;

  const handleLoad = () => { setLoaded(true); releasePreviewSlot(); };

  return (
    <div ref={containerRef} style={{ width: 72, height: 72, overflow: "hidden", borderRadius: 6, border: "1px solid #e0e0e0", background: "#f5f5f5", position: "relative", flexShrink: 0 }}>
      {!loaded && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#c0c0c0" }}>📄</div>
      )}
      {canPreview && readyToLoad && (
        <div style={{ width: INNER, height: INNER, transform: `scale(${SCALE})`, transformOrigin: "top left", pointerEvents: "none", willChange: "transform" }}>
          <iframe src={viewerUrl} title="doc-preview" style={{ width: "100%", height: "100%", border: "none" }} onLoad={handleLoad} />
        </div>
      )}
    </div>
  );
}

function PackingListPreviewModal({ file, onClose }: { file: PackingFile; onClose: () => void }) {
  const safeUrl = /^(https?:\/\/|\/)/i.test(file.url ?? "") ? file.url : "#";
  // Derive extension from filename first, fall back to the URL path
  const nameForExt = file.filename || (file.url ?? "").split("/").pop()?.split("?")[0] || "";
  const ext = (nameForExt.split(".").pop() ?? "").toLowerCase();
  const mime = file.type ?? "";
  const displayName = file.filename || nameForExt || "File";

  const isImage  = mime.startsWith("image/") || ["jpg","jpeg","png","gif","webp","svg","bmp"].includes(ext);
  const isPdf    = mime === "application/pdf" || ext === "pdf";
  const isCsv    = ext === "csv" || mime === "text/csv";
  const isOffice = ["xlsx","xlsm","xlsb","xls","xltx","xltm","doc","docx","docm","ppt","pptx","pptm","csv"].includes(ext)
    || mime.includes("spreadsheet") || mime.includes("wordprocessing") || mime.includes("presentation") || mime.includes("excel") || mime.includes("word");
  // Unknown type with a valid URL: route to MS Office Online as catch-all (handles more formats than Google)
  const useViewerFallback = !isImage && !isPdf && !isOffice && safeUrl !== "#";
  // Legacy attachments synced straight from Airtable's own (signed, temporary)
  // CDN — those links expire and can never be previewed/downloaded again once
  // dead, regardless of viewer. Surface that plainly instead of an embedded
  // "File not found" page from the MS/Google viewer, which just confuses users
  // into thinking the app itself is broken.
  const isExpiredAirtableLink = /airtableusercontent\.com/i.test(safeUrl);

  // Microsoft Office Online — supports xlsx, xlsm, xls, doc, docx, ppt, pptx and variants
  const msViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(safeUrl)}`;
  // Google Docs viewer — fallback for unknown non-Office types
  const googleViewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(safeUrl)}&embedded=true`;

  const [loaded, setLoaded] = useState(false);
  // The expired-Airtable-link message below renders in place of an iframe, so
  // it never fires onLoad — without this exclusion the spinner overlay would
  // sit on top of that message forever instead of clearing.
  const needsIframe = !isImage && !isCsv && !isExpiredAirtableLink && safeUrl !== "#";

  return (
    <div
      // pointerEvents:auto — self-defense vs Radix modal Dialogs, which set
      // pointer-events:none on the body while open; without this the preview
      // ignores every click when rendered outside a DialogContent portal.
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "auto" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 10, overflow: "hidden", width: "min(88vw, 1300px)", height: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.45)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Compact header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", borderBottom: "1px solid #e5e7eb", flexShrink: 0, background: "#fff" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
            {displayName}
          </span>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {!isExpiredAirtableLink && (
              <a
                href={safeUrl}
                download={displayName}
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: "4px 12px", background: "#0f7173", color: "#fff", borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                ⬇ Download
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{ padding: "4px 9px", background: "#f3f4f6", border: "none", borderRadius: 6, fontSize: 17, lineHeight: 1, cursor: "pointer", color: "#6b7280" }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Preview body */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative", background: "#f5f5f5" }}>
          {/* Loading spinner — hidden once iframe fires onLoad */}
          {needsIframe && !loaded && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "#f5f5f5", zIndex: 2 }}>
              <div style={{ width: 40, height: 40, border: "4px solid #e5e7eb", borderTop: "4px solid #0f7173", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>Loading preview…</p>
            </div>
          )}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

          {isExpiredAirtableLink ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 40 }}>⚠️</div>
              <p style={{ color: "#111", fontSize: 14, fontWeight: 600, margin: 0 }}>This attachment link has expired</p>
              <p style={{ color: "#6b7280", fontSize: 13, margin: 0, maxWidth: 420 }}>
                It was synced from Airtable's own file link, which is temporary and has since gone dead —
                this file can no longer be viewed or downloaded from here. Check the original Airtable
                record for the file, then re-upload it here using the Packing List uploader.
              </p>
            </div>
          ) : isImage ? (
            <img src={safeUrl} alt={displayName} style={{ display: "block", maxWidth: "100%", maxHeight: "100%", margin: "0 auto", objectFit: "contain" }} />
          ) : isPdf ? (
            <iframe src={safeUrl} title={displayName} sandbox="allow-scripts allow-same-origin" onLoad={() => setLoaded(true)} style={{ width: "100%", height: "100%", border: "none", display: "block" }} />
          ) : isCsv && safeUrl !== "#" ? (
            <CsvPreview url={safeUrl} />
          ) : isOffice ? (
            <iframe src={msViewerUrl} title={displayName} onLoad={() => setLoaded(true)} style={{ width: "100%", height: "100%", border: "none", display: "block" }} />
          ) : useViewerFallback ? (
            <iframe src={googleViewerUrl} title={displayName} onLoad={() => setLoaded(true)} style={{ width: "100%", height: "100%", border: "none", display: "block" }} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
              <div style={{ fontSize: 56 }}>📎</div>
              <p style={{ color: "#6b7280", fontSize: 13, margin: 0 }}>Preview not available for this file type.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PackingListFiles({ files: rawFiles }: { files: unknown }) {
  const [preview, setPreview] = useState<PackingFile | null>(null);

  let files: PackingFile[] = [];
  try {
    const parsed = typeof rawFiles === "string" ? JSON.parse(rawFiles) : rawFiles;
    if (Array.isArray(parsed)) {
      files = parsed;
    } else if (parsed && typeof parsed === "object") {
      files = [parsed as PackingFile];
    }
  } catch { /* ignore */ }

  if (files.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
        {files.map((f, i) => {
          const safeThumbnail = f.thumbnail_url && /^https?:\/\//i.test(f.thumbnail_url) ? f.thumbnail_url : null;
          return (
            <button
              key={i}
              type="button"
              title={f.filename}
              onClick={() => setPreview(f)}
              style={{ display: "block", background: "none", border: "none", padding: 0, cursor: "pointer", transition: "opacity 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.75")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              {safeThumbnail ? (
                <div style={{ width: 72, height: 72, borderRadius: 6, border: "1px solid #e0e0e0", background: "#f0f0f0", overflow: "hidden", flexShrink: 0 }}>
                  <img
                    src={safeThumbnail}
                    alt={f.filename ?? ""}
                    loading="eager"
                    decoding="sync"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </div>
              ) : (
                <MiniDocPreview
                  safeUrl={/^https?:\/\//i.test(f.url ?? "") ? f.url : "#"}
                  ext={((f.filename ?? f.url ?? "").split(".").pop() ?? "").toLowerCase()}
                  mime={f.type ?? ""}
                />
              )}
            </button>
          );
        })}
      </div>
      {preview && <PackingListPreviewModal file={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

export default function ShippingRequests({
  tableName = DEFAULT_TABLE,
  queryKey = DEFAULT_QUERY_KEY,
  title = "Dispatch Requests",
  subtitle = "Factory cargo-ready to booked",
  permKey = "shipping_requests",
  tabGroup,
}: ShippingRequestsProps = {}) {
  const TABLE_NAME = tableName;
  const QUERY_KEY  = queryKey;
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // Factory/region access — shipping_requests has no country/sku, so restrict by
  // full_factory_name mapped to country via the vendor list.
  const { allowedFactoryNames, restricted: factoryRestricted, factoryReady, factoryLevel, allowedFactoryShortNames } = useFactoryAccess();
  const { canEdit } = usePagePermission(permKey as any);

  const [searchQuery, setSearchQuery] = usePersistedState(`${QUERY_KEY}:search`, "");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = usePersistedState(`${QUERY_KEY}:page`, 1);
  const [pageSize, setPageSize]         = usePersistedState(`${QUERY_KEY}:pageSize`, 50);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [editRow,      setEditRow]      = useState<Record<string, unknown> | null>(null);
  const [editOpen,     setEditOpen]     = useState(false);
  const [editLoading,  setEditLoading]  = useState(false);
  const [deleteRow,    setDeleteRow]    = useState<Record<string, unknown> | null>(null);
  const [deleteOpen,   setDeleteOpen]   = useState(false);
  const [deleteLoading,setDeleteLoading]= useState(false);
  const [addOpen,      setAddOpen]      = useState(false);
  const [addLoading,   setAddLoading]   = useState(false);

  // Full Edit is the only edit surface now (flat "Edit" was removed per
  // request) -- default to "sections" so any path that opens this dialog
  // without explicitly setting a layout (e.g. the ?open=<id> deep link
  // below) lands on Full Edit, not the retired flat layout.
  const [editLayout, setEditLayout] = useState<"flat" | "sections">("sections");
  const openFullEditRow = (row: Record<string, unknown>) => {
    setEditRow(row);
    setEditLayout("sections");
    setEditOpen(true);
    setSearchParams((p) => { const n = new URLSearchParams(p); n.set("open", String((row as any).id)); return n; }, { replace: true });
  };
  const closeEditModal = (open: boolean) => {
    setEditOpen(open);
    if (!open) setSearchParams((p) => { const n = new URLSearchParams(p); n.delete("open"); return n; }, { replace: true });
  };

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(searchQuery); setCurrentPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Factory master list — supplies factory_code for the new-request REF prefix.
  // vendor_directory (not the older/sparser vendor_list) is the properly
  // synced, complete source -- it's the one with factory_short_name filled in.
  // ALSO merged in: the in-app "Vendor List" page (`vendor_list`), which users
  // with Edit permission on that page can maintain themselves — tracker request
  // (the logistics reviewer: "allow me to edit the Factory Code selection list"). A code
  // present in both sources keeps the vendor_directory row (it carries
  // factory_short_name); codes only in vendor_list are appended.
  const { data: factoryCodeOptions = [] } = useQuery({
    queryKey: [QUERY_KEY, "airtable-factories-codes"],
    queryFn: async () => {
      const [air, vend] = await Promise.all([
        (supabase as any)
          .from("vendor_directory")
          .select("factory_code, full_factory_name, factory_short_name")
          .not("factory_code", "is", null)
          .order("factory_code", { ascending: true }),
        (supabase as any)
          .from("forecast_factory") // the Factory List page's source (was vendor_list)
          .select("factory_code, full_factory_name")
          .not("factory_code", "is", null)
          .order("factory_code", { ascending: true }),
      ]);
      if (air.error) throw air.error;
      // Vendor List is best-effort: a permission/RLS hiccup there must not
      // blank the whole Factory Code picker.
      const vendRows: any[] = vend.error ? [] : (vend.data ?? []);
      const out: FactoryOption[] = (air.data ?? [])
        .filter((f: any) => f.factory_code)
        .map((f: any) => ({
          factory_code: String(f.factory_code),
          full_factory_name: String(f.full_factory_name ?? ""),
          factory_short_name: String(f.factory_short_name ?? ""),
        }));
      const seen = new Set(out.map((f) => f.factory_code.trim().toUpperCase()));
      for (const f of vendRows) {
        const code = String(f.factory_code ?? "").trim();
        if (!code || seen.has(code.toUpperCase())) continue;
        seen.add(code.toUpperCase());
        out.push({ factory_code: code, full_factory_name: String(f.full_factory_name ?? ""), factory_short_name: "" });
      }
      return out.sort((a, b) => a.factory_code.localeCompare(b.factory_code));
    },
    staleTime: 5 * 60 * 1000,
  });
  // vndr_copy (the "Factory Code" list column) isn't populated on every row —
  // some requests only have full_factory_name set, never the code itself.
  // Fall back to resolving it through the same factory master list the
  // Full Edit card already uses, so the column doesn't show blank for those.
  const factoryCodeByName = useMemo(
    () => new Map(factoryCodeOptions.filter((f) => f.full_factory_name).map((f) => [f.full_factory_name, f.factory_code])),
    [factoryCodeOptions],
  );

  const { data: allRows = [], isLoading: queryLoading, error } = useQuery({
    queryKey: [QUERY_KEY, "all", factoryRestricted, allowedFactoryNames, factoryLevel, allowedFactoryShortNames],
    queryFn: async () => {
      const CHUNK = 1000;
      // Build an identically-filtered query for a given page; count only on the first.
      const build = (withCount: boolean) => {
        let q: any = (supabase as any).from(TABLE_NAME).select(SELECT_FIELDS, withCount ? { count: "exact" } : undefined);
        // Factory/region gate — factory-level → factory_short_name; else country-level → full_factory_name.
        if (factoryLevel) q = q.in("factory_short_name", allowedFactoryShortNames ?? []);
        else if (factoryRestricted) q = q.in("full_factory_name", allowedFactoryNames ?? []);
        return q.order("id", { ascending: false });
      };
      // Page 1 also returns the exact total, so the remaining pages can fetch in parallel.
      const firstRes = await build(true).range(0, CHUNK - 1);
      if (firstRes.error) throw firstRes.error;
      const out: Record<string, unknown>[] = [...((firstRes.data as Record<string, unknown>[]) ?? [])];
      const total = firstRes.count ?? out.length;
      const pages = Math.ceil(total / CHUNK);
      if (pages > 1) {
        const rest = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) => build(false).range((i + 1) * CHUNK, (i + 2) * CHUNK - 1))
        );
        for (const r of rest) { if (r.error) throw r.error; out.push(...((r.data as Record<string, unknown>[]) ?? [])); }
      }
      return out;
    },
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
  });

  // vndr_copy is blank on some rows (factory typed/linked without a code) —
  // resolve it the same way the Factory Card and list cell already do, but
  // here at the row-data level so the filter/sort/group engine (which reads
  // row.vndr_copy directly) and its option list see the resolved code too,
  // not just the rendered cell.
  const enrichedRows = useMemo(
    () => allRows.map((r) => {
      if ((r as any).vndr_copy) return r;
      const resolved = factoryCodeByName.get(String((r as any).full_factory_name ?? ""));
      return resolved ? { ...r, vndr_copy: resolved } : r;
    }),
    [allRows, factoryCodeByName],
  );

  // View fields from curated columns (+ runtime option lists for single-selects).
  const fields: ViewField[] = useMemo(() => {
    const optsFor = (key: string) => [...new Set(enrichedRows.map((r) => (r as any)[key]).filter(Boolean).map(String))].sort();
    return COLUMNS.map((c) => ({
      key: c.key,
      label: c.label,
      // Progress is a real multi-select (can combine steps like "In Review,
      // BOOKED") — give it the fixed step list + "multi" type so the filter
      // checklist shows each step once, and isAnyOf/isNoneOf match per-step
      // instead of against the whole combined string.
      type: (c.key === "progress" ? "multi" : SR_SINGLE_FIELDS.has(c.key) ? "single" : SR_BOOL_FIELDS.has(c.key) ? "bool" : c.type) as FieldType,
      options: c.key === "progress" ? PROGRESS_OPTIONS : SR_SINGLE_FIELDS.has(c.key) ? optsFor(c.key) : undefined,
      // Progress sorts by workflow step order, not alphabetically.
      sortOrder: c.key === "progress" ? PROGRESS_OPTIONS : undefined,
    }));
  }, [enrichedRows]);

  // Quick search runs before the engine; engine owns filter/sort/group/hide/height.
  const prefiltered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return enrichedRows;
    const cols = ["ref_calculated", "progress", "freight_forwarder", "bl_hbl_mbl_old",
      "port_of_loading", "pos", "invoice_number", "full_factory_name", "factory_short_name"];
    return enrichedRows.filter((r) => cols.some((c) => String((r as any)[c] ?? "").toLowerCase().includes(term)));
  }, [enrichedRows, debouncedSearch]);

  const view = useTableView({ storageKey: QUERY_KEY, fields, rows: prefiltered, defaultSort: [] });
  const visibleCols = useMemo(() => COLUMNS.filter((c) => !view.hiddenSet.has(c.key)), [view.hiddenSet]);
  const colW = (c: ColDef) => view.state.colWidths[c.key] ?? srDefaultColW(c);
  const tableWidth = useMemo(() => visibleCols.reduce((s, c) => s + colW(c), 0) + 120, [visibleCols, view.state.colWidths]);

  // Inline cell editing. Hovering a row shows every editable cell in it as a
  // live control (Airtable-style); double-click still works as a fallback
  // (e.g. for keyboard/touch users who never trigger hover). Attachments /
  // linked / bool → dialog only.
  const { editCell, setEditCell, commit } = useInlineEdit(TABLE_NAME, QUERY_KEY);
  // Inline-editing the Factory Code column must correct the REF# prefix the
  // same way the dialog's Factory Card does (prepend when the ref starts with
  // the date; self-heal a missing date segment) — otherwise the two paths drift.
  const commitCell = (row: Record<string, unknown>, key: string, v: string) => {
    // Progress transitions must fire the same emails whether the change comes
    // from the record dialog or an inline List-View edit — before this, only
    // the dialog Save path notified (Requested number-assigned, In Review
    // review notice, CXL cancellation).
    if (key === "progress") {
      const oldP = String((row as any).progress ?? "").toUpperCase();
      const newP = String(v ?? "").toUpperCase();
      const merged = { ...row, progress: v };
      if (newP.includes("Requested") && !oldP.includes("Requested")) void notifyNumberAssigned(merged);
      if (newP.includes("In Review") && !oldP.includes("In Review")) void notifyReview(merged);
      if (newP.includes("Cancelled") && !oldP.includes("Cancelled")) void notifyCancellation(merged);
    }
    if (key === "vndr_copy" && v.trim()) {
      const currentRef = String((row as any).ref_calculated ?? "");
      const fixed = correctRefPrefix(currentRef, v, String((row as any).date_requested ?? ""));
      if (fixed && fixed !== currentRef) {
        void (supabase as any).from(TABLE_NAME).update({ ref_calculated: fixed }).eq("id", (row as any).id)
          .then(({ error }: { error: unknown }) => {
            if (!error) queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
          });
      }
    }
    return commit(row, key, v);
  };
  const { activeRowId, setActiveRowId } = useActiveRow();
  const fieldOptions = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.options])) as Record<string, string[] | undefined>, [fields]);
  const sortField = view.state.sort[0]?.field ?? null;
  const sortDir = view.state.sort[0]?.dir ?? null;
  const grouped = view.result.groups;
  const resultRows = view.result.rows;
  const totalCount = resultRows.length;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const paginated = useMemo(() => resultRows.slice((currentPage - 1) * pageSize, currentPage * pageSize), [resultRows, currentPage, pageSize]);

  const isLoading = queryLoading || !factoryReady;

  useEffect(() => { if (currentPage > totalPages) setCurrentPage(1); }, [totalPages, currentPage, setCurrentPage]);

  const toggleGroup = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  useEffect(() => {
    const ch = (supabase as any)
      .channel(`${TABLE_NAME}_realtime`)
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_NAME }, () =>
        queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }))
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, [queryClient]);

  // Deep-link: /shipping-requests?open=<id> fetches that one record and opens it
  // directly — used by the "Approved For Booking" email so recipients land on the
  // exact record (the app equivalent of the old Airtable record URL). Works
  // regardless of pagination/filters since it queries the row by id.
  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from(TABLE_NAME).select(SELECT_FIELDS).eq("id", openId).maybeSingle();
      if (cancelled) return;
      if (data) { setEditRow(data as Record<string, unknown>); setEditOpen(true); }
      else {
        toast.error("Shipping request not found");
        const next = new URLSearchParams(searchParams);
        next.delete("open");
        setSearchParams(next, { replace: true });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveEdit = async (updates: Record<string, unknown>) => {
    if (!editRow) return;
    setEditLoading(true);
    try {
      // Mirror the Airtable "Approved For Booking" automation: when QC Approved
      // newly flips to Yes, also stamp Lead Approved = Yes in the same write.
      const willApprove =
        "qc_approved" in updates && isYes(updates.qc_approved) && !isYes((editRow as any).qc_approved);
      const finalUpdates = willApprove ? { ...updates, lead_approved: "Yes" } : updates;

      const { error } = await (supabase as any).from(TABLE_NAME).update(finalUpdates).eq("id", (editRow as any).id);
      if (error) throw error;
      toast.success("Shipping request updated");
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      const merged = { ...editRow, ...finalUpdates };
      // Review notice — only when progress newly transitions to In Review.
      const oldProgress = String((editRow as any).progress ?? "");
      const newProgress = String(updates.progress ?? (editRow as any).progress ?? "");
      if (newProgress.includes("In Review") && !oldProgress.includes("In Review")) {
        void notifyReview(merged);
      }
      // Number-assigned email — progress is no longer auto-set at creation
      // (tracker request: all steps manual), so the Requested transition is the
      // trigger now. notifyNumberAssigned itself still checks the factory code.
      if (newProgress.toUpperCase().includes("Requested") && !oldProgress.toUpperCase().includes("Requested")) {
        void notifyNumberAssigned(merged);
      }
      // Approved-for-booking email — only when qc_approved newly transitions to Yes.
      if (willApprove) {
        void notifyApproved(merged);
      }
      // Cancellation email — only when progress newly includes CXL.
      if (newProgress.toUpperCase().includes("Cancelled") && !oldProgress.toUpperCase().includes("Cancelled")) {
        void notifyCancellation(merged);
      }
    } catch (e: any) { toast.error("Update failed: " + e.message); }
    finally { setEditLoading(false); }
  };

  const handleSaveAdd = async (payload: Record<string, unknown>) => {
    setAddLoading(true);
    try {
      // shipping_requests.record_id is NOT NULL (legacy Airtable id). New rows
      // created here get a generated unique id so the insert satisfies the constraint.
      // Tracker request: the last 3 characters must never be all-numeric — a
      // digits-only tail reads as a count/sequence rather than an identifier
      // (and spreadsheet pastes can mangle it). A UUID or Date.now() tail can
      // land on 3 pure digits, so patch the final character to a letter.
      const ID_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I ambiguity
      const randLetter = () => ID_LETTERS[Math.floor(Math.random() * ID_LETTERS.length)];
      let record_id =
        (payload.record_id as string) ||
        (globalThis.crypto?.randomUUID ? `rec_${globalThis.crypto.randomUUID()}` : `rec_${Date.now()}`);
      if (!payload.record_id && /[0-9]{3}$/.test(record_id)) record_id = record_id.slice(0, -1) + randLetter();
      // Date Requested is a system stamp. The intake form sends it, but the
      // edit-dialog "Add" path does not (the field is read-only there), which
      // left the REF# without its YYMMDD segment (e.g. VND1-CRD0905-135.65CBM-SX2)
      // while the DB default still filled the column. Stamp it here for every path.
      if (!payload.date_requested) payload.date_requested = todayISO();
      // REF #: {factory_code}-{YYMMDD}-CRD{MMDD}-{CBM}CBM-{3-char alphanumeric id}
      // Prefix must be the resolved Factory CODE, never the raw factory name —
      // if vndr_copy wasn't set (e.g. the factory was typed free-text instead
      // of picked from the list), resolve it through the same vendor_directory
      // lookup the List View's Factory Code column already falls back to.
      const resolvedFactoryCode = String(payload.vndr_copy || "").trim()
        || factoryCodeByName.get(String(payload.full_factory_name ?? payload.factory_name_form ?? "")) || "";
      // REF# identifier = the LAST 3 alphanumerics of the Record ID (the legacy
      // Airtable rule — tracker: "the identifier at the tail end is not taken
      // from the Record ID"). Never all-numeric: the record_id tail was patched
      // to a letter above whenever it landed on 3 digits.
      const suffix = record_id.replace(/[^a-z0-9]/gi, "").slice(-3);
      const ref_calculated = buildShippingRef({
        prefix: resolvedFactoryCode,
        dateRequested: String(payload.date_requested ?? ""),
        cargoReadyDate: String(payload.cargo_ready_date ?? ""),
        cbm: payload.cargo_volume_cbm,
        suffix,
      });
      // User stamp (tracker request): record WHO created the record, by email.
      const created_by = (payload.created_by as string) || profile?.email || null;
      const { data, error } = await (supabase as any)
        .from(TABLE_NAME).insert([{ ...payload, record_id, created_by, ref_calculated: ref_calculated || null }]).select().single();
      if (error) throw error;
      toast.success("Shipping request added");
      setAddOpen(false);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      // Notify n8n: receipt email (always) + number-assigned email (if factory_code + Requested).
      void notifyShippingRequest(data ?? payload);
      void notifyNumberAssigned(data ?? payload);
    } catch (e: any) { toast.error("Add failed: " + e.message); }
    finally { setAddLoading(false); }
  };

  const handleConfirmDelete = async () => {
    if (!deleteRow) return;
    setDeleteLoading(true);
    try {
      const { error } = await (supabase as any).from(TABLE_NAME).delete().eq("id", (deleteRow as any).id);
      if (error) throw error;
      toast.success("Shipping request deleted");
      setDeleteOpen(false);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    } catch (e: any) { toast.error("Delete failed: " + e.message); }
    finally { setDeleteLoading(false); }
  };

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden min-h-0" style={{ maxWidth: "none" }}>

      <header className="h-14 shrink-0 border-b border-border bg-gradient-to-r from-primary/5 to-background">
        <div className="h-full px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Truck className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-foreground leading-tight truncate">{title}</h1>
                <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <PermissionGuardButton canEdit={canEdit} size="sm" className="h-8" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New Dispatch Request
            </PermissionGuardButton>
          </div>
        </div>
      </header>

      <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-border bg-card/30">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            className="pl-9 h-8"
          />
        </div>
        <TableViewToolbar view={view} fields={fields} className="ml-1" />
        <Button variant="outline" size="icon" className="h-8 w-8"
          onClick={() => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] })} title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{totalCount.toLocaleString()} records</span>
      </div>

      <div className="flex-1 min-h-0 border-t border-border relative overflow-auto" style={{ isolation: "isolate" }}>
        <div className="min-w-max">
          <table className="text-[12px] leading-tight border-separate border-spacing-0 [&_td]:overflow-hidden [&_th]:overflow-hidden" style={{ width: tableWidth, tableLayout: "fixed", ["--app-td-py" as never]: `${view.rowPadYPx}px` }}>
            <colgroup>
              {visibleCols.map((col) => <col key={col.key} style={{ width: colW(col) }} />)}
              <col style={{ width: 120 }} />
            </colgroup>
            <thead>
              <tr>
                {visibleCols.map((col, i) => (
                  <th
                    key={col.key}
                    onClick={() => view.toggleSort(col.key)}
                    className="app-th cursor-pointer select-none"
                    style={{ position: "sticky", top: 0, ...(i === 0 ? { left: 0, zIndex: 70 } : { zIndex: 60 }) }}
                  >
                    {col.label}
                    <span className="ml-1 text-[10px]">
                      {sortField === col.key ? (sortDir === "asc" ? "↑" : "↓") : <span className="opacity-30">↕</span>}
                    </span>
                    <ColResizeHandle onResize={(w) => view.setColWidth(col.key, w)} onReset={() => view.clearColWidth(col.key)} />
                  </th>
                ))}
                <th className="app-th" style={{ position: "sticky", top: 0, right: 0, zIndex: 80 }}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: visibleCols.length + 1 }).map((__, j) => (
                      <td key={j} className="app-td"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={visibleCols.length + 1} className="app-td text-center text-destructive">
                    Error: {(error as Error).message}
                  </td>
                </tr>
              ) : resultRows.length === 0 ? (
                <tr>
                  <td colSpan={visibleCols.length + 1} className="app-td text-center text-muted-foreground">
                    No records found.
                  </td>
                </tr>
              ) : (() => {
                const renderRow = (row: Record<string, unknown>, idx: number) => {
                  const rowId = (row as any).id;
                  // Hover reveals only the lightweight "Open" shortcut (below);
                  // clicking the row is what reveals its cells as live editors —
                  // matches real Airtable, and avoids a hover-triggered "ripple".
                  const isRowHovered = canEdit; // hover is CSS (group-hover) — no table re-render per row
                  const isRowActive = canEdit && activeRowId === rowId;
                  return (
                  <tr key={rowId ?? idx} data-row-id={rowId} style={{ height: view.rowHeightPx }}
                    onClick={() => canEdit && setActiveRowId(rowId)}
                    className="group hover:bg-[#3b5769]/20 dark:hover:bg-[#2a2a2a] transition-colors duration-75">
                    {visibleCols.map((col, i) => {
                      const __kind = srEditKind(col);
                      const isDblClicked = !!(editCell && editCell.id === rowId && editCell.key === col.key);
                      // Hovering the row shows every editable cell as a live control
                      // (Airtable-style); double-click still works as a fallback.
                      if (canEdit && __kind === "single" && (isRowActive || isDblClicked)) {
                        return (
                          // !overflow-visible — app-td normally clips (for text truncation),
                          // which would crop the dropdown panel the instant it opens.
                          <td key={col.key} className={cn("app-td !overflow-visible relative", i === 0 && "app-td-sticky")}
                            style={{ zIndex: i === 0 ? 30 : 20, ...(i === 0 ? { position: "sticky", left: 0 } : {}) }}>
                            <HoverSelectCell
                              value={String((row as any)[col.key] ?? "")}
                              options={fieldOptions[col.key] ?? []}
                              pillStyle={(v) => srPillStyle(col.key, v)}
                              onCommit={(v) => commitCell(row, col.key, v)}
                            />
                          </td>
                        );
                      }
                      // Column 0 stays plain on hover (it hosts the hover-reveal "Open"
                      // shortcut below, not a live editor) — double-click still edits it.
                      if (canEdit && __kind && (isDblClicked || (isRowActive && __kind !== "single" && i !== 0))) {
                        return (
                          <EditableCell key={col.key} editing canEdit kind={__kind} autoFocus={isDblClicked}
                            value={String((row as any)[col.key] ?? "")} options={fieldOptions[col.key]}
                            className={cn("app-td", i === 0 && "app-td-sticky")}
                            style={i === 0 ? { position: "sticky", left: 0, zIndex: 30 } : undefined}
                            onCommit={(v) => commitCell(row, col.key, v)} onCancel={() => setEditCell(null)}
                          >{null}</EditableCell>
                        );
                      }
                      const __cell = (() => {
                      const isNum = col.type === "number";
                      // These wrap instead of clipping so the full value is always readable.
                      const wrap = WRAP_COLS.has(col.key) ? " whitespace-normal break-words" : " whitespace-nowrap";
                      const hAlign = LEFT_ALIGN_COLS.has(col.key) ? " text-left" : " text-center";
                      let cls = "app-td" + (isNum ? " text-center tabular-nums whitespace-nowrap" : wrap + hAlign);
                      if (i === 0) cls += " app-td-sticky";

                      if (col.key === "lead_approved" || col.key === "qc_approved" || col.key === "qc_check_pass" || col.key === "cancellation_fee_agreement") {
                        const raw = (row as any)[col.key];
                        const isEmpty = raw === null || raw === undefined || raw === "";
                        const norm = String(raw ?? "").trim().toLowerCase();
                        const isYes = norm === "yes" || norm === "true" || norm === "1" || raw === true;
                        return (
                          <td key={col.key} className="app-td text-center whitespace-nowrap">
                            {isEmpty ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span style={{
                                backgroundColor: isYes ? "#cfe9e9" : "#DC2626",
                                color: isYes ? "#0c4849" : "#ffffff",
                                borderRadius: "9999px",
                                padding: "2px 12px",
                                fontWeight: 600,
                                fontSize: "11px",
                                display: "inline-block",
                                letterSpacing: "0.02em",
                              }}>
                                {isYes ? "Yes" : "No"}
                              </span>
                            )}
                          </td>
                        );
                      }

                      if (col.key === "freight_forwarder") {
                        const raw = (row as any)[col.key];
                        if (!raw || raw === "") {
                          return (
                            <td key={col.key} className="app-td text-center whitespace-nowrap">
                              <span className="text-muted-foreground">—</span>
                            </td>
                          );
                        }
                        const parts = String(raw).split(/[,;\r\n]+/).map((s) => s.trim()).filter(Boolean);
                        return (
                          <td key={col.key} className="app-td text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              {parts.map((part, pi) => {
                                const { bg, text } = getFreightForwarderColor(part);
                                return (
                                  <span key={pi} style={{
                                    backgroundColor: bg,
                                    color: text,
                                    borderRadius: "9999px",
                                    padding: "2px 10px",
                                    fontWeight: 600,
                                    fontSize: "11px",
                                    display: "inline-block",
                                    letterSpacing: "0.02em",
                                    whiteSpace: "nowrap",
                                  }}>
                                    {part}
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                        );
                      }

                      if (col.key === "port_of_loading") {
                        const raw = (row as any)[col.key];
                        if (!raw || raw === "") {
                          return (
                            <td key={col.key} className="app-td text-center whitespace-nowrap">
                              <span className="text-muted-foreground">—</span>
                            </td>
                          );
                        }
                        const { bg, text } = getPOLColor(String(raw));
                        return (
                          <td key={col.key} className="app-td text-center whitespace-nowrap">
                            <span style={{
                              backgroundColor: bg,
                              color: text,
                              borderRadius: "9999px",
                              padding: "2px 10px",
                              fontWeight: 600,
                              fontSize: "11px",
                              display: "inline-block",
                              letterSpacing: "0.02em",
                            }}>
                              {String(raw).trim()}
                            </span>
                          </td>
                        );
                      }

                      if (col.key === "progress") {
                        const raw = (row as any)[col.key];
                        if (!raw || raw === "") {
                          return (
                            <td key={col.key} className="app-td text-center whitespace-nowrap">
                              <span className="text-muted-foreground">—</span>
                            </td>
                          );
                        }
                        const parts = splitProgressValues(String(raw));
                        return (
                          <td key={col.key} className="app-td text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              {parts.map((part, pi) => {
                                const { bg, text } = getProgressPillColor(part);
                                return (
                                  <span key={pi} style={{
                                    backgroundColor: bg,
                                    color: text,
                                    borderRadius: "9999px",
                                    padding: "2px 10px",
                                    fontWeight: 600,
                                    fontSize: "11px",
                                    display: "inline-block",
                                    letterSpacing: "0.02em",
                                    whiteSpace: "nowrap",
                                  }}>
                                    {part}
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                        );
                      }

                      if (col.key === "pos") {
                        const raw = (row as any)[col.key];
                        if (!raw || raw === "") {
                          return (
                            <td key={col.key} className="app-td text-center whitespace-nowrap">
                              <span className="text-muted-foreground">—</span>
                            </td>
                          );
                        }
                        const poNums = String(raw).split(/[,;\r\n]+/).map((s) => s.trim()).filter(Boolean);
                        const poChunks: string[][] = [];
                        for (let ci = 0; ci < poNums.length; ci += 5) poChunks.push(poNums.slice(ci, ci + 5));
                        const poStyle: React.CSSProperties = {
                          backgroundColor: "hsl(var(--muted))",
                          color: "hsl(var(--muted-foreground))",
                          borderRadius: "6px",
                          padding: "1px 7px",
                          fontWeight: 500,
                          fontSize: "11px",
                          display: "inline-block",
                          letterSpacing: "0.01em",
                          whiteSpace: "nowrap",
                        };
                        return (
                          <td key={col.key} className="app-td text-center">
                            <div className="flex flex-col gap-0.5 items-center">
                              {poChunks.map((chunk, ci) => (
                                <div key={ci} className="flex gap-1">
                                  {chunk.map((po, pi) => (
                                    <span key={pi} style={poStyle}>{po}</span>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </td>
                        );
                      }

                      if (col.key === "po_complete_date") {
                        const raw = (row as any)[col.key];
                        if (!raw || raw === "") {
                          return (
                            <td key={col.key} className="app-td text-center whitespace-nowrap">
                              <span className="text-muted-foreground">—</span>
                            </td>
                          );
                        }
                        const rawStr = String(raw);
                        // split on newlines first; if one chunk, split before each "digits:" pattern
                        let entries = rawStr.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
                        if (entries.length === 1) {
                          entries = rawStr.split(/\s+(?=\d+:)/).map((s) => s.trim()).filter(Boolean);
                        }
                        return (
                          <td key={col.key} className="app-td text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              {entries.map((entry, ei) => (
                                <span key={ei} className="whitespace-nowrap text-sm">{entry}</span>
                              ))}
                            </div>
                          </td>
                        );
                      }

                      if (col.key === "packing_list") {
                        return (
                          <td key={col.key} className="app-td text-center" style={{ minWidth: 80 }}>
                            <PackingListFiles files={(row as any)[col.key]} />
                          </td>
                        );
                      }

                      const rawVal = col.key === "vndr_copy"
                        ? ((row as any).vndr_copy || factoryCodeByName.get(String((row as any).full_factory_name ?? "")) || null)
                        : (row as any)[col.key];
                      if (TRUNCATE_COLS.has(col.key)) {
                        const full = rawVal === null || rawVal === undefined || rawVal === "" ? "" : String(rawVal);
                        const alignLeft = LEFT_ALIGN_COLS.has(col.key);
                        return (
                          <td key={col.key} className={cn("app-td", alignLeft ? "text-left" : "text-center")} style={{ maxWidth: 240, minWidth: 140 }}>
                            {full
                              ? <TruncatedCell full={full} label={col.label} align={alignLeft ? "left" : "center"} />
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                        );
                      }

                      const display = fmtCell(col.key, rawVal);
                      // Column 0 gets a hover-reveal "Open ›" shortcut alongside its
                      // own text (never replacing it) — Airtable's row-hover pattern.
                      if (i === 0 && isRowHovered) {
                        return (
                          <td key={col.key} className={cls} style={{ position: "sticky", left: 0, zIndex: 30 }}>
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="truncate" title={display !== "—" ? display : undefined}>
                                {display === "—" ? <span className="text-muted-foreground">—</span> : display}
                              </span>
                              <button type="button" onClick={() => openFullEditRow(row)}
                                className="hidden group-hover:inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                                Open <ChevronRight className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                        );
                      }
                      return (
                        <td
                          key={col.key}
                          className={cls}
                          style={i === 0 ? { position: "sticky", left: 0, zIndex: 30 } : {}}
                          title={display !== "—" ? display : undefined}
                        >
                          {display === "—"
                            ? <span className="text-muted-foreground">—</span>
                            : display}
                        </td>
                      );
                      })();
                      return canEdit && __kind
                        ? cloneElement(__cell, { key: col.key, onDoubleClick: () => setEditCell({ id: (row as any).id, key: col.key }) })
                        : __cell;
                    })}
                    <td className="app-td app-td-sticky text-center w-[120px]"
                      style={{ position: "sticky", right: 0, zIndex: 35 }}>
                      <div className="flex items-center justify-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="app-action-trigger">
                              Action <ChevronDown className="app-action-trigger-chevron" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openFullEditRow(row)}>
                              <Maximize2 className="h-3.5 w-3.5 mr-2" /> Full Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => { setDeleteRow(row); setDeleteOpen(true); }}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                  );
                };

                if (grouped) {
                  const groupLabel = fields.find((f) => f.key === view.state.groupBy)?.label ?? "";
                  const stats = view.state.stats ?? {};
                  const fmtStat = (fn: string, v: number | null) => {
                    if (v === null) return "—";
                    if (fn === "count") return v.toLocaleString();
                    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
                  };
                  return grouped.flatMap((bucket) => {
                    const isCollapsed = collapsed.has(bucket.key);
                    const header = (
                      <tr key={`g-${bucket.key}`} className="bg-muted/60">
                        <td colSpan={visibleCols.length + 1} className="app-td px-3 py-2 cursor-pointer" onClick={() => toggleGroup(bucket.key)}>
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {groupLabel}: {bucket.label}
                            <span className="font-normal text-muted-foreground">({bucket.rows.length})</span>
                          </span>
                        </td>
                      </tr>
                    );
                    // Per-group summary strip (tracker request): each column gets
                    // a Sum/Average/Count/Min/Max picker; the computed value for
                    // this bucket renders beside it. Choices persist with the view.
                    const statsRow = (
                      <tr key={`gs-${bucket.key}`} className="bg-muted/30">
                        {visibleCols.map((col, i) => {
                          const fn = stats[col.key];
                          const val = fn ? computeGroupStat(bucket.rows, col.key, fn) : null;
                          return (
                            <td key={col.key} className="app-td px-1.5 py-0.5" style={i === 0 ? { position: "sticky", left: 0, zIndex: 30, background: "inherit" } : undefined}>
                              <div className="flex items-center justify-end gap-1">
                                {fn && <span className="text-[11px] font-bold tabular-nums">{fmtStat(fn, val)}</span>}
                                <select
                                  value={fn ?? ""}
                                  onChange={(e) => view.setStat(col.key, (e.target.value || null) as any)}
                                  className="max-w-[64px] cursor-pointer bg-transparent text-[9px] font-semibold uppercase tracking-wide text-muted-foreground outline-none"
                                  title={`Statistic for ${col.label}`}
                                >
                                  <option value="">—</option>
                                  <option value="sum">Sum</option>
                                  <option value="avg">Average</option>
                                  <option value="count">Count</option>
                                  <option value="min">Min</option>
                                  <option value="max">Max</option>
                                </select>
                              </div>
                            </td>
                          );
                        })}
                        <td className="app-td" />
                      </tr>
                    );
                    return isCollapsed ? [header, statsRow] : [header, statsRow, ...bucket.rows.map((r, i) => renderRow(r, i))];
                  });
                }
                return paginated.map((row, idx) => renderRow(row, idx));
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {!grouped && (
        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={totalCount}
          onPageChange={setCurrentPage}
          onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }}
          pageSizeOptions={PAGE_SIZES}
        />
      )}

      <ShippingFormDialog open={editOpen}  onOpenChange={closeEditModal}  row={editRow} onSave={handleSaveEdit} loading={editLoading}  title="Edit Dispatch Request" vendorOptions={factoryCodeOptions} layout={editLayout}
        onDelete={() => { setEditOpen(false); setDeleteRow(editRow); setDeleteOpen(true); }} />
      <ShippingAddForm   open={addOpen}    onOpenChange={setAddOpen}   onSave={handleSaveAdd}  loading={addLoading} factoryOptions={factoryCodeOptions} />
      <DeleteRowDialog   open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={handleConfirmDelete} loading={deleteLoading} />
      {tabGroup && <OrderDashboardTabs group={tabGroup} activeTab="shipping" />}
    </div>
  );
}
