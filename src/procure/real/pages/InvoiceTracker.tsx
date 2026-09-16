import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { externalSupabase as supabase, EXTERNAL_PROJECT_URL } from "@/integrations/supabase/externalClient";
import { useSearchParams } from "react-router-dom";
import { OrderDashboardTabs } from "@/components/shared/OrderDashboardTabs";
import { useAuth } from "@/contexts/AuthContext";
import { MentionInput, MentionUser } from "@/components/shared/MentionInput";
import { notifyMention } from "@/lib/notifyMention";
import { Search, RefreshCw, Plus, Trash2, ChevronDown, CheckCircle2, RotateCcw, X, Check, Maximize2, ArrowLeft, MoreHorizontal, FileText, UploadCloud } from "lucide-react";
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
import { PermissionGuardButton } from "@/components/shared/PermissionGuardButton";
import { useFactoryAccess } from "@/hooks/useFactoryAccess";
import { useTableView, computeGroupStat, type ViewField, type FieldType } from "@/lib/tableView";
import { TableViewToolbar, ColResizeHandle } from "@/components/shared/TableViewToolbar";
import { EditableCell, HoverSelectCell } from "@/components/shared/EditableCell";
import { useInlineEdit, type EditKind } from "@/hooks/useInlineEdit";
import { useHoverRow, useActiveRow } from "@/hooks/useHoverRow";
import { cn } from "@/lib/utils";
import { cloneElement } from "react";
import { ChevronRight } from "lucide-react";
import { CsvPreview } from "@/components/shared/CsvPreview";

const DEFAULT_TABLE     = "invoice_tracker";
const DEFAULT_QUERY_KEY = "invoice-tracker";
const PAGE_SIZES = [10, 25, 50, 100];

/** Props let the same Freight Bills serve multiple tables (Finance /
 *  Logistics / Management), each with its own data, permission key, and
 *  persisted filter state. Defaults preserve the original Finance behavior. */
interface InvoiceTrackerProps {
  tableName?: string;
  queryKey?: string;
  title?: string;
  subtitle?: string;
  permKey?: string;
  tabGroup?: import("@/components/shared/OrderDashboardTabs").TabGroup;
}

type ColType = "text" | "number" | "date";

interface ColDef { key: string; label: string; type: ColType; }

// The Logistics and Finance teams see different column sets/order (per user
// spec) — Logistics gets the full schedule + derived-field detail, Finance a
// leaner payment-focused subset. Management (no spec given) defaults to the
// fuller Logistics set. LOGISTICS_COLUMNS also serves as the superset used
// by the module-level type lookups below (NUMBER_COLS/DATE_COLS etc.) and
// the blank-record initializer, since every Finance field is also in it.
const LOGISTICS_COLUMNS: ColDef[] = [
  { key: "hbl",                      label: "HBL",                      type: "text"   },
  { key: "mbl",                      label: "MBL",                      type: "text"   },
  { key: "ddp",                      label: "DDP",                      type: "text"   },
  { key: "forwarder",                label: "Forwarder",                type: "text"   },
  { key: "vendor",                   label: "Vendor",                   type: "text"   },
  { key: "country_of_origin",        label: "Country of Origin",        type: "text"   },
  { key: "pol",                      label: "POL",                      type: "text"   },
  { key: "carrier",                  label: "Carrier",                  type: "text"   },
  { key: "ata_pod",                  label: "ATA POD",                  type: "date"   },
  { key: "eta_pod",                  label: "ETA POD",                  type: "date"   },
  { key: "atd",                      label: "ATD",                      type: "date"   },
  { key: "etd",                      label: "ETD",                      type: "date"   },
  { key: "atd_delay",                label: "ATD Delay",                type: "number" },
  { key: "vessel_name",              label: "Vessel Name",              type: "text"   },
  { key: "hc_40_count",             label: "40HC Count",               type: "number" },
  { key: "invoice_status",           label: "Invoice Status",           type: "text"   },
  { key: "telex_received",           label: "Telex Received",           type: "text"   },
  { key: "dx2fdr",                   label: "DX2FDR",                   type: "date"   },
  { key: "do_dispatch",              label: "D/O Dispatch",             type: "date"   },
  { key: "drayage",                  label: "Drayage",                  type: "text"   },
  { key: "payment_due",              label: "Payment Due",              type: "date"   },
  { key: "rate",                     label: "Rate",                     type: "number" },
  { key: "purchase_order",           label: "Purchase Order",           type: "text"   },
  { key: "shipment_invoice_number",  label: "Shipment Invoice Number",  type: "text"   },
  { key: "arrival_notice",           label: "Arrival Notice",           type: "date"   },
  { key: "freight_invoice",          label: "Freight Invoice",          type: "date"   },
  { key: "container_number",         label: "Container Number",         type: "text"   },
  { key: "container_id",             label: "Container ID",             type: "text"   },
  { key: "value",                    label: "Value",                    type: "number" },
  { key: "adjustment_amount",        label: "Adjustment Amount",        type: "number" },
  { key: "amount_due",               label: "Amount Due",               type: "number" },
  { key: "unpaid",                   label: "Unpaid",                   type: "number" },
  { key: "pmt_rq_date",              label: "PMT RQ Date",              type: "date"   },
  { key: "pmt_status_finance",       label: "PMT Status - Finance",     type: "text"   },
  { key: "pmt_approved_lead",         label: "PMT Approved - Lead",       type: "text"   },
  { key: "paid",                     label: "Paid",                     type: "date"   },
  { key: "ata_week",                 label: "ATA-Week",                 type: "text"   },
  { key: "ata_month",                label: "ATA - Month",              type: "text"   },
  { key: "atd_week",                 label: "ATD Week",                 type: "text"   },
  { key: "atd_month",                label: "ATD-Month",                type: "text"   },
  { key: "on_water_transit",         label: "On Water Transit",         type: "number" },
  // Not in the user's Logistics list but still needed elsewhere (Booking#,
  // Created, Estimated Total Freight) — kept available via Hide fields
  // rather than left completely inaccessible.
  { key: "booking_num",              label: "Booking #",                type: "text"   },
  { key: "created",                  label: "Created",                  type: "date"   },
  { key: "estimated_total_freight",  label: "Estimated Total Freight",  type: "number" },
  // Tracker request: Pay Slip was missing from the List View.
  { key: "pay_slip",                 label: "Pay Slip",                 type: "text"   },
];

const FINANCE_COLUMNS: ColDef[] = [
  { key: "hbl",                      label: "HBL",                      type: "text"   },
  { key: "mbl",                      label: "MBL",                      type: "text"   },
  { key: "ddp",                      label: "DDP",                      type: "text"   },
  { key: "forwarder",                label: "Forwarder",                type: "text"   },
  { key: "arrival_notice",           label: "Arrival Notice",           type: "date"   },
  { key: "freight_invoice",          label: "Freight Invoice",          type: "date"   },
  { key: "telex_received",           label: "Telex Received",           type: "text"   },
  { key: "vendor",                   label: "Vendor",                   type: "text"   },
  { key: "country_of_origin",        label: "Country of Origin",        type: "text"   },
  { key: "carrier",                  label: "Carrier",                  type: "text"   },
  { key: "ata_pod",                  label: "ATA POD",                  type: "date"   },
  { key: "atd",                      label: "ATD",                      type: "date"   },
  { key: "atd_delay",                label: "ATD Delay",                type: "number" },
  { key: "vessel_name",              label: "Vessel Name",              type: "text"   },
  { key: "hc_40_count",             label: "40HC Count",               type: "number" },
  { key: "invoice_status",           label: "Invoice Status",           type: "text"   },
  { key: "payment_due",              label: "Payment Due",              type: "date"   },
  { key: "rate",                     label: "Rate",                     type: "number" },
  { key: "purchase_order",           label: "Purchase Order",           type: "text"   },
  { key: "shipment_invoice_number",  label: "Shipment Invoice Number",  type: "text"   },
  { key: "container_number",         label: "Container Number",         type: "text"   },
  { key: "container_id",             label: "Container ID",             type: "text"   },
  { key: "value",                    label: "Value",                    type: "number" },
  { key: "adjustment_amount",        label: "Adjustment Amount",        type: "number" },
  { key: "amount_due",               label: "Amount Due",               type: "number" },
  { key: "unpaid",                   label: "Unpaid",                   type: "number" },
  { key: "pmt_status_finance",       label: "PMT Status - Finance",     type: "text"   },
  { key: "pmt_approved_lead",         label: "PMT Approved - Lead",       type: "text"   },
  { key: "paid",                     label: "Paid",                     type: "date"   },
  // Tracker request: Pay Slip was missing from the List View.
  { key: "pay_slip",                 label: "Pay Slip",                 type: "text"   },
];

// Fetch all columns so the record panel can show linked fields (shipping_requests,
// container_id, etc.) that are not in the curated table column list.
const SELECT_FIELDS = "*";

// Engine field-type hints: which curated columns are option-pick (single) vs
// boolean checkmarks. Everything else falls back to its ColDef type.
// forwarder deliberately NOT here — tracker request made it plain text entry.
const INV_SINGLE_FIELDS = new Set(["vendor", "country_of_origin", "pol", "carrier", "pmt_status_finance"]);
const INV_BOOL_FIELDS   = new Set(["ddp", "arrival_notice", "freight_invoice", "pmt_approved_lead"]);

/** Default column width (px) for the fixed-layout <colgroup>. User drag-resize overrides this. */
const invDefaultColW = (c: ColDef) =>
  INV_BOOL_FIELDS.has(c.key) ? 90 : c.type === "number" ? 110 : c.type === "date" ? 120 : 150;

// Single-value dropdown cells for inline edit.
// Carrier is free text (no fixed option list / pill color), matching the
// plain-display list column — it's not in this set on purpose.
const INV_INLINE_SINGLE = new Set(["vendor", "country_of_origin", "pol"]);
// Multi-select pill dropdown for inline edit (comma-combined values).
const INV_INLINE_MULTI = new Set(["invoice_status"]);
const invEditKind = (c: ColDef): EditKind =>
  // Derived formula fields and the system CREATED stamp are never hand-edited.
  INV_BOOL_FIELDS.has(c.key) || COMPUTED_INV_COLS.has(c.key) || c.key === "estimated_total_freight" || c.key === "created" ? null
  : INV_INLINE_MULTI.has(c.key) ? "pillMulti"
  : INV_INLINE_SINGLE.has(c.key) ? "single"
  : c.type;

const CURRENCY_COLS  = new Set(["rate", "value", "adjustment_amount", "unpaid", "amount_due", "estimated_total_freight"]);
const DECIMAL_1_COLS = new Set(["hc_40_count"]);
const WRAP_COLS      = new Set(["hbl", "mbl", "purchase_order", "shipment_invoice_number", "container_id", "vessel_name", "carrier"]);

/* ── Derived (formula) fields ───────────────────────────────────────────────
 * The Airtable sync is supposed to deliver these but often leaves them empty,
 * so we derive them client-side from ATD / ATA POD / ETD whenever the stored
 * value is blank. Stored (synced) values always win. Display-only — never
 * written back to the DB (they're in ISAVE_SKIP / not inline-editable). */
const COMPUTED_INV_COLS = new Set(["atd_week", "atd_month", "ata_week", "ata_month", "atd_delay", "on_water_transit"]);

function parseYmd(v: unknown): Date | null {
  const s = String(v ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** ISO week label, e.g. "2026-23" — matches the format the Airtable sync
 *  delivers (see stored atd_week values), so mixed synced/derived rows group
 *  and sort together. */
function isoWeekLabel(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}
/** Month label, e.g. "2026-06" (sorts naturally as text). */
function monthLabel(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const dayDiff = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86400000);

/** Fixed handling/doc fee baked into every freight estimate, confirmed against
 *  live data (rate × 40' HC count + 75 matches every populated sample exactly). */
const FREIGHT_FLAT_FEE = 75;
function toNumOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Live formula fields, recomputed from the record's own dates/amounts every
 *  time this runs — true Airtable-style formulas, not a fill-blank-once
 *  fallback. Always overrides whatever the sync last wrote, so editing a
 *  date/rate/value immediately reflects in the dependent field. */
function withDerivedInvoiceFields(row: Record<string, unknown>): Record<string, unknown> {
  const atd = parseYmd(row.atd), ata = parseYmd(row.ata_pod), etd = parseYmd(row.etd);
  const out = { ...row };
  if (atd) {
    out.atd_week  = isoWeekLabel(atd);
    out.atd_month = monthLabel(atd);
    // Delay departing = ATD vs planned ETD, in days (positive = departed late).
    if (etd) out.atd_delay = dayDiff(atd, etd);
    // Days on water: ATA − ATD once arrived, else days since departure.
    out.on_water_transit = dayDiff(ata ?? new Date(), atd);
  }
  if (ata) {
    out.ata_week  = isoWeekLabel(ata);
    out.ata_month = monthLabel(ata);
  }
  // Amount Due = Value + Adjustment Amount (confirmed against live data — the
  // synced value always equals this sum, adjustment typically negative).
  const value = toNumOrNull(row.value), adj = toNumOrNull(row.adjustment_amount);
  if (value != null) out.amount_due = value + (adj ?? 0);
  // Estimated Total Freight = Rate × 40' HC Count + flat fee.
  const rate = toNumOrNull(row.rate), count = toNumOrNull(row.hc_40_count);
  if (rate != null && count != null) out.estimated_total_freight = rate * count + FREIGHT_FLAT_FEE;
  return out;
}
const NUMBER_COLS    = new Set(LOGISTICS_COLUMNS.filter((c) => c.type === "number").map((c) => c.key));
const DATE_COLS     = new Set(LOGISTICS_COLUMNS.filter((c) => c.type === "date").map((c) => c.key));

function splitContainerNumbers(val: unknown): string[] {
  if (val === null || val === undefined || val === "") return [];
  return String(val).split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

/* ── Forwarder pill colors ── */
const FORWARDER_COLORS: Record<string, { bg: string; text: string }> = {
  TBD:       { bg: "#EC4899", text: "#ffffff" },
  FW27:        { bg: "#C0392B", text: "#ffffff" },
  FW24:       { bg: "#F59E0B", text: "#000000" },
  FW23:       { bg: "#0f7173", text: "#ffffff" },
  FW21:       { bg: "#06B6D4", text: "#000000" },
  FW22:       { bg: "#C4B5FD", text: "#1e1b4b" },
  FW16:       { bg: "#22D3EE", text: "#083344" },
  FW28:        { bg: "#7F1D1D", text: "#ffffff" },
  FW13:       { bg: "#FCA5A5", text: "#450a0a" },
  FW08:     { bg: "#7C3AED", text: "#ffffff" },
  FW04:     { bg: "#DB2777", text: "#ffffff" },
  "CIF/COD": { bg: "#E5E7EB", text: "#374151" },
  FW05:     { bg: "#A7F3D0", text: "#065F46" },
  FW12:      { bg: "#92400E", text: "#ffffff" },
  FW09:      { bg: "#DDD6FE", text: "#304654" },
  FW17:       { bg: "#C4B5FD", text: "#304654" },
  FW18:      { bg: "#99F6E4", text: "#115E59" },
  FW10:      { bg: "#FECACA", text: "#7F1D1D" },
  FW20:       { bg: "#CCFBF1", text: "#115E59" },
  FW06:     { bg: "#CCFBF1", text: "#115E59" },
  FW19:       { bg: "#BBF7D0", text: "#166534" },
  FW07:     { bg: "#FECACA", text: "#7F1D1D" },
  FW14:       { bg: "#FEF9C3", text: "#713F12" },
  FW11:      { bg: "#FEF9C3", text: "#713F12" },
  "N/A":     { bg: "#FCE7F3", text: "#831843" },
  PREPAY:    { bg: "#B91C1C", text: "#ffffff" },
  FW25:       { bg: "#166534", text: "#ffffff" },
  FW15:       { bg: "#7C3AED", text: "#ffffff" },
  DOM:       { bg: "#DB2777", text: "#ffffff" },
  FW01:   { bg: "#374151", text: "#ffffff" },
  FW02:    { bg: "#A5F3FC", text: "#155E75" },
  FW03:   { bg: "#A5F3FC", text: "#155E75" },
  FW26:       { bg: "#A5F3FC", text: "#155E75" },
};

const PILL_PALETTE = [
  { bg: "#cfe9e9", text: "#0c4849" },
  { bg: "#DCF5DC", text: "#15803D" },
  { bg: "#FEF3C7", text: "#92400E" },
  { bg: "#FCE7F3", text: "#9D174D" },
  { bg: "#d9e4ea", text: "#5B21B6" },
  { bg: "#CCFBF1", text: "#115E59" },
  { bg: "#FEE2E2", text: "#991B1B" },
  { bg: "#F0FDF4", text: "#166534" },
  { bg: "#FFF7ED", text: "#92400E" },
  { bg: "#cfe9e9", text: "#0369A1" },
];

function getForwarderColor(val: string): { bg: string; text: string } {
  const trimmed = val.trim();
  if (FORWARDER_COLORS[trimmed]) return FORWARDER_COLORS[trimmed];
  const upper = trimmed.toUpperCase();
  if (FORWARDER_COLORS[upper]) return FORWARDER_COLORS[upper];
  let h = 0;
  for (let i = 0; i < trimmed.length; i++) h = (h * 31 + trimmed.charCodeAt(i)) >>> 0;
  return PILL_PALETTE[h % PILL_PALETTE.length];
}

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

function getVendorColor(val: string): { bg: string; text: string } {
  const trimmed = val.trim();
  let h = 0;
  for (let i = 0; i < trimmed.length; i++) h = (h * 31 + trimmed.charCodeAt(i)) >>> 0;
  return VENDOR_PILL_PALETTE[h % VENDOR_PILL_PALETTE.length];
}

const COUNTRY_COLORS: Record<string, { bg: string; text: string }> = {
  CN: { bg: "#DDD6FE", text: "#304654" },
  VN: { bg: "#D1FAE5", text: "#065F46" },
  ID: { bg: "#cfe9e9", text: "#0c4849" },
  MY: { bg: "#BAE6FD", text: "#0C4A6E" },
  IN: { bg: "#FEF3C7", text: "#92400E" },
  TR: { bg: "#E2E8F0", text: "#475569" },
  US: { bg: "#DC2626", text: "#ffffff" },
  KH: { bg: "#CFFAFE", text: "#155E75" },
  BD: { bg: "#FEE2E2", text: "#991B1B" },
  PK: { bg: "#D1FAE5", text: "#065F46" },
  LK: { bg: "#FEF9C3", text: "#713F12" },
  TH: { bg: "#FCE7F3", text: "#9D174D" },
  PH: { bg: "#d9e4ea", text: "#5B21B6" },
  MM: { bg: "#FFF7ED", text: "#9A3412" },
  FW28: { bg: "#CCFBF1", text: "#115E59" },
  KR: { bg: "#cfe9e9", text: "#0c4849" },
  JP: { bg: "#FEE2E2", text: "#991B1B" },
  MX: { bg: "#D1FAE5", text: "#065F46" },
  DE: { bg: "#FEF3C7", text: "#92400E" },
  IT: { bg: "#D1FAE5", text: "#065F46" },
};

function getCountryColor(val: string): { bg: string; text: string } {
  const upper = val.trim().toUpperCase();
  if (COUNTRY_COLORS[upper]) return COUNTRY_COLORS[upper];
  let h = 0;
  for (let i = 0; i < upper.length; i++) h = (h * 31 + upper.charCodeAt(i)) >>> 0;
  return VENDOR_PILL_PALETTE[h % VENDOR_PILL_PALETTE.length];
}

/** Pill color for a hover-edit trigger, matching each column's plain-display
 *  coloring so the pill doesn't change appearance when it becomes editable. */
function invPillStyle(colKey: string, value: string): { bg: string; text: string } | null {
  switch (colKey) {
    case "forwarder": case "pol": return getForwarderColor(value);
    case "vendor": return getVendorColor(value);
    case "country_of_origin": return getCountryColor(value);
    default: return null; // carrier — plain text in the list view too
  }
}

const POL_COLORS: Record<string, { bg: string; text: string }> = {
  // Chinese ports — light pink/lavender
  PT08:             { bg: "#d9e4ea", text: "#304654" },
  PT09:             { bg: "#d9e4ea", text: "#304654" },
  PT07:       { bg: "#d9e4ea", text: "#304654" },
  PT10:             { bg: "#d9e4ea", text: "#304654" },
  PT11:             { bg: "#d9e4ea", text: "#304654" },
  PT12:             { bg: "#d9e4ea", text: "#304654" },
  PT13:             { bg: "#d9e4ea", text: "#304654" },
  PT14:             { bg: "#d9e4ea", text: "#304654" },
  PT15:             { bg: "#d9e4ea", text: "#304654" },
  PT16:             { bg: "#d9e4ea", text: "#304654" },
  PT17:             { bg: "#d9e4ea", text: "#304654" },
  PT18:             { bg: "#d9e4ea", text: "#304654" },
  PT19:             { bg: "#d9e4ea", text: "#304654" },
  // Vietnamese ports — light green
  PT20:             { bg: "#D1FAE5", text: "#065F46" },
  PT21:             { bg: "#D1FAE5", text: "#065F46" },
  PT22:             { bg: "#D1FAE5", text: "#065F46" },
  // Indian ports — light amber
  PT23:             { bg: "#FEF3C7", text: "#92400E" },
  PT24:             { bg: "#FEF3C7", text: "#92400E" },
  PT01:   { bg: "#FEF3C7", text: "#92400E" },
  PT06:           { bg: "#FEF3C7", text: "#92400E" },
  PT05:         { bg: "#FEF3C7", text: "#92400E" },
  PT03:         { bg: "#FEF3C7", text: "#92400E" },
  PT04:         { bg: "#FEF3C7", text: "#92400E" },
  PT25:             { bg: "#FEF3C7", text: "#92400E" },
  // Turkish ports — light gray
  PT02:          { bg: "#E2E8F0", text: "#475569" },
  PT26:             { bg: "#E2E8F0", text: "#475569" },
};

function getPOLColor(val: string): { bg: string; text: string } {
  const trimmed = val.trim();
  if (POL_COLORS[trimmed]) return POL_COLORS[trimmed];
  // Country-prefix detection (e.g. IDJKT, MYTPP, KHKOS, USHOU, VNHCM)
  const upper = trimmed.toUpperCase();
  if (upper.startsWith("ID")) return { bg: "#d9e4ea", text: "#5B21B6" };
  if (upper.startsWith("MY")) return { bg: "#BAE6FD", text: "#0C4A6E" };
  if (upper.startsWith("KH")) return { bg: "#CFFAFE", text: "#155E75" };
  if (upper.startsWith("VN")) return { bg: "#D1FAE5", text: "#065F46" };
  if (upper.startsWith("US")) return { bg: "#DC2626", text: "#ffffff" };
  if (upper.startsWith("TH")) return { bg: "#FCE7F3", text: "#9D174D" };
  if (upper.startsWith("PH")) return { bg: "#DDD6FE", text: "#304654" };
  if (upper.startsWith("BD")) return { bg: "#FEE2E2", text: "#991B1B" };
  if (upper.startsWith("PK")) return { bg: "#D1FAE5", text: "#065F46" };
  let h = 0;
  for (let i = 0; i < trimmed.length; i++) h = (h * 31 + trimmed.charCodeAt(i)) >>> 0;
  return VENDOR_PILL_PALETTE[h % VENDOR_PILL_PALETTE.length];
}

const INVOICE_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  "Booking Requested":   { bg: "#BAE6FD", text: "#0C4A6E" },
  "Carrier Confirmed":  { bg: "#FED7AA", text: "#9A3412" },
  "Customs Filed": { bg: "#DDD6FE", text: "#304654" },
  "Documents Received":  { bg: "#FCE7F3", text: "#831843" },
  "Documents Forwarded": { bg: "#CCFBF1", text: "#115E59" },
  "Payment Requested":    { bg: "#FEF9C3", text: "#713F12" },
  "PAID":       { bg: "#166534", text: "#ffffff" },
  "Receipt Sent":  { bg: "#FEF3C7", text: "#92400E" },
  "Document Issue":  { bg: "#DC2626", text: "#ffffff" },
};

const PMT_FINANCE_COLORS: Record<string, { bg: string; text: string }> = {
  "ISSUE":    { bg: "#FCE7F3", text: "#831843" },
  "Approval Requested": { bg: "#7C3AED", text: "#ffffff" },
  "PAID":     { bg: "#D1FAE5", text: "#065F46" },
};

function getStatusPillColor(
  map: Record<string, { bg: string; text: string }>,
  val: string,
): { bg: string; text: string } {
  const trimmed = val.trim();
  if (map[trimmed]) return map[trimmed];
  const upper = trimmed.toUpperCase();
  if (map[upper]) return map[upper];
  let h = 0;
  for (let i = 0; i < trimmed.length; i++) h = (h * 31 + trimmed.charCodeAt(i)) >>> 0;
  return VENDOR_PILL_PALETTE[h % VENDOR_PILL_PALETTE.length];
}

function splitStatusValues(
  raw: string,
  knownMap: Record<string, { bg: string; text: string }>,
): string[] {
  const trimmed = raw.trim();
  // Try common separators first
  const parts = trimmed.split(/[\r\n,;|]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  // Fallback: greedy-match against known status strings (handles no-separator storage)
  const known = Object.keys(knownMap).sort((a, b) => b.length - a.length);
  const found: string[] = [];
  let pos = 0;
  while (pos < trimmed.length) {
    let matched = false;
    for (const k of known) {
      if (trimmed.startsWith(k, pos)) {
        found.push(k);
        pos += k.length;
        matched = true;
        break;
      }
    }
    if (!matched) pos++;
  }
  return found.length > 0 ? found : parts;
}

// Short numeric M/D/YYYY (e.g. "6/6/2025") — the one date format used
// everywhere in this page (list cells, linked-record cards, Full Edit).
function fmtDate(s: string): string | null {
  // Bare "YYYY-MM-DD" (no time component) is a calendar date, not a moment in
  // time — parsing it with `new Date()` reads it as UTC midnight, which then
  // renders a day EARLIER for any user in a timezone behind UTC (e.g. a
  // record created 7/14 shows as 7/13). Format it straight from the string
  // so it never passes through timezone conversion.
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
    const formatted = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? `-$${formatted}` : `$${formatted}`;
  }
  if (DECIMAL_1_COLS.has(key)) {
    const n = Number(val);
    if (isNaN(n)) return fmtDate(s) ?? s;
    return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  if (NUMBER_COLS.has(key)) {
    const n = Number(val);
    if (isNaN(n)) return fmtDate(s) ?? s;
    return n.toLocaleString();
  }
  if (DATE_COLS.has(key)) {
    return fmtDate(s) ?? s;
  }
  // Any text column that happens to store an ISO date — format it too
  return fmtDate(s) ?? s;
}

/* ── Add / Edit Dialog ── */
// Fields shown as colored pills (read) above an editable input, mirroring Airtable.
const SELECT_PILL_FIELDS = new Set([
  "forwarder", "carrier", "vendor", "country_of_origin", "pol", "invoice_status", "pmt_status_finance", "pmt_approved_lead",
]);

function invoicePillColor(key: string, value: string): { bg: string; text: string } {
  if (key === "invoice_status") return getStatusPillColor(INVOICE_STATUS_COLORS, value);
  if (key === "pmt_status_finance") return getStatusPillColor(PMT_FINANCE_COLORS, value);
  return getForwarderColor(value);
}

// Full invoice record field config, mirroring the Airtable expanded-record view
// top-to-bottom. The MBL is the record title, so it is also the first row.
type IFieldKind =
  | "text" | "textarea" | "longtext" | "number" | "decimal1" | "currency" | "readonlyCurrency" | "date"
  | "pill" | "pillMulti" | "checkbox" | "collab" | "readonly"
  | "containerLink" | "poLink" | "shipCard" | "shipLookup" | "attachment";
interface IField { key: string; label: string; kind: IFieldKind; lookup?: string; }

// Order follows the same grouping as the list-view COLUMNS: reference →
// shipping details → schedule → cargo → financials → payment status →
// linked records → attachments/notes → system. Drives the flat/simple Edit
// dialog (INVOICE_FIELDS.map); the sectioned "Full Edit" layout above ignores
// array order and looks fields up individually via F().
const INVOICE_FIELDS: IField[] = [
  // ── Reference ──
  { key: "mbl",                       label: "MBL",                              kind: "text" },
  { key: "hbl",                       label: "HBL",                              kind: "text" },
  { key: "booking_num",               label: "Booking Number",                   kind: "text" },
  // ── Status / linking (per requested EDIT-form order) ──
  { key: "ddp",                       label: "DDP",                              kind: "checkbox" },
  { key: "invoice_status",            label: "Invoice Status",                   kind: "pillMulti" },
  { key: "shipping_requests",         label: "Dispatch Requests",                kind: "shipCard" },
  { key: "factory_account",           label: "Factory Account (from Dispatch Requests)", kind: "shipLookup", lookup: "factory_account" },
  { key: "qc_team_account",           label: "QC Team Account",                  kind: "shipLookup", lookup: "qc_team_account" },
  { key: "managment_team_account",    label: "Managment Team Account",           kind: "shipLookup", lookup: "management_team_account" },
  { key: "customer_service_account",  label: "Customer Service Account",         kind: "shipLookup", lookup: "customer_service_account" },
  { key: "qc_team_account_countries", label: "QC Team Account (Countries)",      kind: "shipLookup", lookup: "qc_team_account_countries" },
  // ── Vendor / origin ──
  { key: "vendor",                    label: "Vendor",                           kind: "pillMulti" },
  { key: "country_of_origin",         label: "Country of Origin",                kind: "pill" },
  { key: "pol",                       label: "POL",                              kind: "pill" },
  { key: "hc_40_count",               label: "40HC Count",                       kind: "decimal1" },
  // ── Invoice / PO ──
  { key: "shipment_invoice_number",   label: "Shipment Invoice Number",          kind: "text" },
  { key: "purchase_order",            label: "Purchase Order",                   kind: "poLink" },
  { key: "po_number",                 label: "PO Number (from PO Number)",       kind: "readonly" },
  // ── Arrival ──
  { key: "arrival_notice",            label: "Arrival Notice",                   kind: "checkbox" },
  { key: "freight_invoice",           label: "Freight Invoice",                  kind: "checkbox" },
  // ── Schedule (ATD/ATA-Week/Month/On Water Transit are derived formula fields, pushed to the bottom) ──
  { key: "ata_pod",                   label: "ATA POD",                          kind: "date" },
  { key: "eta_pod",                   label: "ETA POD",                          kind: "date" },
  { key: "atd",                       label: "ATD",                              kind: "date" },
  { key: "etd",                       label: "ETD",                              kind: "date" },
  { key: "atd_delay",                 label: "ATD Delay",                        kind: "readonly" },
  { key: "etd_calc",                  label: "ETD*",                             kind: "readonly" },
  { key: "dx2fdr",                    label: "DX2FDR",                           kind: "date" },
  { key: "telex_received",            label: "Telex Received",                   kind: "pill" },
  { key: "do_dispatch",               label: "D/O Dispatch",                     kind: "date" },
  // ── Shipment ──
  // Tracker request: Forwarder is plain text entry now (was a pill dropdown).
  { key: "forwarder",                 label: "Forwarder",                        kind: "text" },
  { key: "carrier",                   label: "Carrier",                          kind: "text" },
  { key: "vessel_name",               label: "Vessel Name",                      kind: "text" },
  { key: "rate",                      label: "Rate",                             kind: "currency" },
  { key: "estimated_total_freight",   label: "Estimated Total Freight",          kind: "readonlyCurrency" },
  { key: "drayage",                   label: "Drayage",                          kind: "text" },
  // ── Containers / notes ──
  { key: "container_number",          label: "Container Number",                 kind: "text" },
  // Tracker request: the link is MANUAL and keyed by the ERP Container ID —
  // its own column, no longer derived from the free-text Container Number.
  { key: "containers_linked_to_this_invoice", label: "Containers Linked To This Invoice", kind: "containerLink" },
  { key: "container_id",              label: "Container ID",                     kind: "text" },
  { key: "notes",                     label: "NOTES",                            kind: "longtext" },
  // ── Finance ──
  { key: "payment_due",               label: "Payment Due",                      kind: "date" },
  { key: "pmt_rq_date",               label: "PMT RQ Date",                      kind: "date" },
  { key: "pmt_status_finance",        label: "PMT Status - Finance",             kind: "pill" },
  { key: "pmt_approved_lead",          label: "PMT Approved - Lead",               kind: "checkbox" },
  { key: "pmt_approved_date",         label: "PMT Approved Date",                kind: "date" },
  { key: "paid",                      label: "Paid",                             kind: "date" },
  { key: "value",                     label: "Value",                            kind: "currency" },
  { key: "adjustment_amount",         label: "Adjustment Amount",                kind: "currency" },
  { key: "amount_due",                label: "Amount Due",                       kind: "readonlyCurrency" },
  { key: "unpaid",                    label: "Unpaid",                           kind: "currency" },
  { key: "pay_slip",                  label: "Pay Slip",                         kind: "attachment" },
  // ── Pushed to the bottom (derived formula fields, per request) ──
  { key: "atd_week",                  label: "ATD Week",                         kind: "readonly" },
  { key: "atd_month",                 label: "ATD-Month",                        kind: "readonly" },
  { key: "ata_week",                  label: "ATA-Week",                         kind: "readonly" },
  { key: "ata_month",                 label: "ATA - Month",                      kind: "readonly" },
  { key: "on_water_transit",          label: "On Water Transit",                 kind: "readonly" },
  // ── System ──
  // Created is a system creation stamp — set once on insert, never hand-edited.
  { key: "created",                   label: "Created",                          kind: "readonly" },
  { key: "created_by",                label: "Created By",                       kind: "collab" },
  { key: "wk_num",                    label: "WK #",                             kind: "number" },
];

const ISAVE_SKIP = new Set<IFieldKind>(["readonly", "readonlyCurrency", "shipCard", "shipLookup", "attachment"]);

/** Currency input: shows $1,234.56 (commas, 2 decimals) when blurred/read-only,
 *  raw editable value when focused. Trims float noise like 18903.6200000003. */
function CurrencyInput({ value, onChange, readOnly }: { value: string; onChange?: (v: string) => void; readOnly?: boolean }) {
  const [focused, setFocused] = useState(false);
  const raw = value ?? "";
  const n = raw === "" ? NaN : Number(String(raw).replace(/[$,]/g, ""));
  const formatted = Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : raw;
  const display = readOnly ? formatted : (focused ? raw : formatted);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
      <Input
        value={display}
        readOnly={readOnly}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange?.(e.target.value)}
        className="h-9 text-sm pl-6"
      />
    </div>
  );
}

/** Number input that shows 1 decimal place (e.g. 1.0) when not focused. */
function Decimal1Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  const raw = value ?? "";
  const n = raw === "" ? NaN : Number(raw);
  const display = focused ? raw : (Number.isFinite(n) ? n.toFixed(1) : raw);
  return (
    <Input value={display} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value)} className="h-9 text-sm" />
  );
}

const PMT_FINANCE_OPTIONS = ["PAID", "ISSUE", "Approval Requested"];

function InvPill({ label, colors }: { label: string; colors: { bg: string; text: string } }) {
  return (
    <span style={{
      backgroundColor: colors.bg, color: colors.text, borderRadius: "9999px", padding: "2px 12px",
      fontWeight: 600, fontSize: "12px", display: "inline-block", whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

/** Linked Purchase Order(s) shown as Airtable-style cards + an Add picker. */
function PoCards({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    const nums = value.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!nums.length) { setRows([]); return; }
    let cancelled = false;
    (async () => {
      const ints = nums.map(Number).filter((n) => Number.isFinite(n));
      const { data } = await (supabase as any)
        .from("po_export").select("po_number, vendor, po_date, updated_at").in("po_number", ints.length ? ints : nums);
      if (cancelled) return;
      const seen = new Set<string>(); const out: any[] = [];
      for (const r of data ?? []) { const k = String(r.po_number); if (seen.has(k)) continue; seen.add(k); out.push(r); }
      // Keep the invoice's order; show unmatched (e.g. mistyped) PO numbers as
      // bare cards so they can still be removed.
      const byNum = new Map(out.map((r) => [String(r.po_number), r]));
      setRows(nums.map((n) => byNum.get(n) ?? { po_number: n, vendor: null, po_date: null, updated_at: null }));
    })();
    return () => { cancelled = true; };
  }, [value]);
  const removePo = (po: string) => {
    const next = value.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean).filter((p) => p !== po);
    onChange(next.join(", "));
  };
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="rounded-md border bg-background px-3 py-2.5 relative group">
          <button type="button" onClick={() => removePo(String(r.po_number))}
            className="absolute right-2 top-2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100" title="Remove">
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="font-semibold text-sm mb-1.5">{String(r.po_number)}</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Factory List</div>
              <div>{r.vendor ? <InvPill label={String(r.vendor)} colors={getForwarderColor(String(r.vendor))} /> : "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Last Modified</div>
              <div>{fmtLinkCell(r.updated_at) || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Created</div>
              <div>{fmtLinkCell(r.po_date) || "—"}</div>
            </div>
          </div>
        </div>
      ))}
      <LinkPicker value={value} onChange={onChange}
        table="po_export" keyField="po_number" primaryField="po_number" buttonLabel="Add record"
        metaFields={[{ key: "vendor", label: "Vendor" }, { key: "item_name", label: "Item" }, { key: "po_date", label: "PO Date" }]} />
    </div>
  );
}

/** Linked container(s) shown as Airtable-style cards + an Add item picker.
 *  MANUAL link keyed by the ERP Container ID (tracker request): the stored
 *  value is a comma list of container_ids, joined against the `container`
 *  table by container_id. Nothing here is derived from the free-text
 *  Container Number field — linking happens only when a user picks/types an ID,
 *  after the container exists in the ERP. */
function ContainerCards({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    const ids = value.split(/[\r\n,;]+/).map((s) => s.trim().replace(/^#/, "")).filter(Boolean);
    if (!ids.length) { setRows([]); return; }
    let cancelled = false;
    (async () => {
      const numeric = ids.filter((s) => /^\d+$/.test(s)).map(Number);
      const { data } = numeric.length
        ? await (supabase as any)
            .from("container").select("container_id, container_name, created_at, shipped_on, eta_port, estimated_arrival_date").in("container_id", numeric)
        : { data: [] };
      if (cancelled) return;
      const seen = new Set<string>(); const out: any[] = [];
      for (const r of data ?? []) { const k = String(r.container_id); if (seen.has(k)) continue; seen.add(k); out.push(r); }
      // keep the invoice's order; an ID with no matching container row (not in
      // the the ERP feed yet) still shows as a bare card so it's not lost.
      const byId = new Map(out.map((r) => [String(r.container_id), r]));
      const ordered = ids.map((c) => byId.get(c) ?? { container_id: c, container_name: null, created_at: null, shipped_on: null });
      setRows(ordered);
    })();
    return () => { cancelled = true; };
  }, [value]);

  const removeId = (id: string) => {
    const next = value.split(/[\r\n,;]+/).map((s) => s.trim().replace(/^#/, "")).filter(Boolean).filter((c) => c !== id);
    onChange(next.join(", "));
  };

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="rounded-md border bg-background px-3 py-2.5 relative group">
          <button type="button" onClick={() => removeId(String(r.container_id))}
            className="absolute right-2 top-2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100" title="Remove">
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="font-semibold text-sm mb-1.5">{String(r.container_id ?? r.container_name ?? "—")}</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Container Name</div>
              <div>{r.container_name || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Created On</div>
              <div>{fmtLinkCell(r.created_at) || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Shipped On</div>
              <div>{fmtLinkCell(r.shipped_on) || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">ETA Port</div>
              <div>{fmtLinkCell(r.eta_port) || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Estimated Arrival Date</div>
              <div>{fmtLinkCell(r.estimated_arrival_date) || "—"}</div>
            </div>
          </div>
        </div>
      ))}
      <LinkPicker value={value} onChange={onChange}
        table="container" keyField="container_id" primaryField="container_name" primaryLabel="Container Name"
        titleField="container_id" serverSearchField="container_name" serverSearchIdField="container_id" buttonLabel="Link container by ID"
        metaFields={[
          { key: "created_at", label: "Created On" },
          { key: "shipped_on", label: "Shipped On" },
          { key: "eta_port", label: "ETA Port" },
          { key: "estimated_arrival_date", label: "Estimated Arrival Date" },
        ]} />
    </div>
  );
}

type ShipPackFile = { filename: string; url: string; thumbnail_url?: string; type?: string };

function parseShipPackFiles(raw: unknown): ShipPackFile[] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) return parsed as ShipPackFile[];
    if (parsed && typeof parsed === "object") return [parsed as ShipPackFile];
  } catch { /* ignore */ }
  return [];
}

// (ShipPackingListUploader removed — packing lists are uploaded on the
//  Dispatch Request page itself; Freight Bills no longer offers the upload.)

/** Pay Slip attachment with a drop/browse uploader (stored in the packing-lists bucket). */
function PaySlipField({ value, onChange, invoiceId, onPreview }: { value: string; onChange: (v: string) => void; invoiceId: number | null; onPreview?: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    if (!invoiceId) return;
    setUploading(true);
    try {
      const path = `pay-slips/${invoiceId}/${Date.now()}_${file.name}`;
      const { error } = await (supabase as any).storage.from("packing-lists").upload(path, file, { upsert: true });
      if (error) throw error;
      onChange(`${EXTERNAL_PROJECT_URL}/storage/v1/object/public/packing-lists/${path}`);
      toast.success("Pay slip uploaded");
    } catch (e: any) {
      toast.error("Upload failed: " + e.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  return (
    <div>
      <input ref={inputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      {value ? (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onPreview?.(value)} title="Preview pay slip"
            className="shrink-0 h-12 w-10 rounded border bg-muted/30 overflow-hidden flex items-center justify-center text-base hover:bg-muted cursor-pointer">
            {/^https?:.*\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(value)
              ? <img src={value} alt="Pay slip" className="h-full w-full object-cover" loading="lazy" />
              : "📄"}
          </button>
          <button type="button" onClick={() => onPreview?.(value)} className="min-w-0 flex-1 truncate text-left text-xs text-primary hover:underline">{value.split("/").pop()}</button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => inputRef.current?.click()} disabled={uploading}>Replace</Button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={!invoiceId || uploading}
          className="w-full rounded-md border border-dashed bg-muted/20 py-4 text-center text-xs text-muted-foreground hover:bg-muted/40 disabled:opacity-60">
          {uploading ? "Uploading…" : "⤓ Drop files here or click to browse"}
        </button>
      )}
    </div>
  );
}

// Fixed Invoice Status options (the column stores comma-combined values).
const INVOICE_STATUS_OPTIONS = [
  "Booking Requested", "Carrier Confirmed", "Customs Filed", "Documents Received", "Documents Forwarded", "Payment Requested", "PAID", "Receipt Sent", "Document Issue",
];

/** Multi-select pill dropdown (Airtable checkbox option list). Value is comma-joined. */
function PillMultiSearch({
  value, onChange, options, colorFn,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  colorFn: (v: string) => { bg: string; text: string };
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const sel = value.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const toggle = (opt: string) => {
    const next = sel.includes(opt) ? sel.filter((x) => x !== opt) : [...sel, opt];
    onChange(next.join(", "));
  };
  const term = search.trim().toLowerCase();
  const opts = options.filter((o) => !term || o.toLowerCase().includes(term));
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button type="button" className="flex min-h-10 w-full items-center justify-between gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          <span className="flex flex-wrap gap-1">
            {sel.length ? sel.map((s) => <InvPill key={s} label={s} colors={colorFn(s)} />) : <span className="text-muted-foreground">Select…</span>}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Find an option" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            {opts.map((o) => (
              <CommandItem key={o} value={o} onSelect={() => toggle(o)} className="cursor-pointer gap-2">
                <Checkbox checked={sel.includes(o)} className="pointer-events-none" />
                <InvPill label={o} colors={colorFn(o)} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface InvoiceFieldOpts {
  vendor: string[]; forwarder: string[]; country: string[]; pol: string[]; pmtFinance: string[]; telex: string[];
}

interface InvoiceComment {
  id: number;
  invoice_id: number;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
}

function invInitials(name: string | null): string {
  return (name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function fmtLinkCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return fmtDate(s) ?? s;
}

interface LinkMeta { key: string; label: string; }

/** Airtable-style "+ Add record/item" picker: searches a source table and links
 *  the chosen record by appending its key value to the comma/newline field. */
function LinkPicker({
  value, onChange, table, keyField, primaryField, primaryLabel, titleField, metaFields, buttonLabel, serverSearchField,
}: {
  value: string;
  onChange: (v: string) => void;
  table: string;
  keyField: string;
  primaryField: string;
  // Label for primaryField's own column -- only shown when titleField differs
  // from primaryField (e.g. container_id as the bold title, container_name
  // as a labeled column alongside the other metaFields).
  primaryLabel?: string;
  // Field shown as the bold title above the label/value grid; defaults to
  // primaryField (e.g. PO number, which has no separate id/name split).
  titleField?: string;
  metaFields: LinkMeta[];
  buttonLabel: string;
  serverSearchField?: string;
  /** Numeric id column to ALSO match when the search term is all digits
   *  (ilike can't run on a numeric column). E.g. container_id. */
  serverSearchIdField?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      let q = (supabase as any).from(table).select("*");
      const t = search.trim();
      if (serverSearchField && t) {
        q = serverSearchIdField && /^\d+$/.test(t)
          ? q.or(`${serverSearchIdField}.eq.${t},${serverSearchField}.ilike.%${t}%`)
          : q.ilike(serverSearchField, `%${t}%`);
      }
      q = q.order("id", { ascending: false }).limit(serverSearchField ? 50 : 300);
      const { data } = await q;
      if (cancelled) return;
      const seen = new Set<string>();
      const out: any[] = [];
      for (const r of data ?? []) {
        const k = String(r[keyField] ?? "").trim();
        if (!k || seen.has(k)) continue;
        seen.add(k); out.push(r);
      }
      setRows(out);
    })();
    return () => { cancelled = true; };
  }, [open, search, table, serverSearchField, keyField]);

  const current = value.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const term = search.trim().toLowerCase();
  const titleKey = titleField ?? primaryField;
  const showPrimaryAsColumn = titleKey !== primaryField;
  const filtered = (serverSearchField || !term
    ? rows
    : rows.filter((r) => [primaryField, ...metaFields.map((m) => m.key)].some((k) => String(r[k] ?? "").toLowerCase().includes(term)))
  ).filter((r) => !current.includes(String(r[keyField] ?? "").trim()));

  // Stays open after each pick so several records can be added in one go --
  // only closes when the user clicks away or presses the trigger again.
  const link = (r: any) => {
    const k = String(r[keyField] ?? "").trim();
    if (!k || current.includes(k)) return;
    onChange([...current, k].join(", "));
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8"><Plus className="h-3.5 w-3.5 mr-1" /> {buttonLabel}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search…" value={search} onValueChange={setSearch} />
          <CommandList className="max-h-[360px]">
            <CommandEmpty>No match — type the full code and use "Add manually" below.</CommandEmpty>
            {/* Manual add — the the ERP feed is not 100% of all existing
                records (tracker report), so a code missing from the list can
                still be linked by typing it in full. Uppercased to match the
                feed's code format, so a later feed row joins onto it cleanly. */}
            {term && !current.includes(search.trim().toUpperCase()) && (
              <CommandItem
                key="__manual_add__"
                value="__manual_add__"
                onSelect={() => { onChange([...current, search.trim().toUpperCase()].join(", ")); setSearch(""); }}
                className="cursor-pointer gap-1.5 border-b border-border/60"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="text-sm">Add "<b>{search.trim().toUpperCase()}</b>" manually</span>
                <span className="ml-auto text-[10px] text-muted-foreground">not in the feed</span>
              </CommandItem>
            )}
            {filtered.map((r, i) => (
              <CommandItem key={String(r.id) + "|" + i} value={String(r.id) + "|" + i} onSelect={() => link(r)} className="cursor-pointer flex-col items-start gap-1.5 py-2.5 data-[selected=true]:bg-transparent data-[selected=true]:text-foreground">
                <span className="text-sm font-semibold">{String(r[titleKey] ?? "—")}</span>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs w-full">
                  {showPrimaryAsColumn && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{primaryLabel ?? primaryField}</div>
                      <div>{String(r[primaryField] ?? "—")}</div>
                    </div>
                  )}
                  {metaFields.map((m) => (
                    <div key={m.key}>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
                      <div>{fmtLinkCell(r[m.key]) || "—"}</div>
                    </div>
                  ))}
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** "Link Dispatch Request" — searchable picker that links a shipping request to
 *  the invoice. onPick receives the chosen row; the caller stores its id + shows
 *  the linked card. */
function ShipRequestLinker({ onPick }: { onPick: (sr: any) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      let query = (supabase as any)
        .from("shipping_requests")
        .select("id, ref_calculated, ref_manual_old, date_requested, etd, factory_short_name, lead_approved, packing_list_files, packing_list, receipt_number, record_id")
        .order("date_requested", { ascending: false })
        .limit(50);
      if (q.trim()) query = query.ilike("ref_calculated", `%${q.trim()}%`);
      const { data } = await query;
      if (!cancel) { setRows(data ?? []); setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [open, q]);

  const isYes = (v: any) => { const s = String(v ?? "").trim().toLowerCase(); return s === "yes" || s === "true" || s === "1" || v === true; };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <Button size="sm" className="h-8">Link Dispatch Request</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[560px] p-0">
        <div className="p-2 border-b">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-8" autoFocus />
        </div>
        <div className="max-h-[360px] overflow-auto divide-y divide-border/60">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground text-center">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">No shipping requests.</p>
          ) : rows.map((sr) => {
            const facCode = String(sr.ref_calculated ?? "").split("-")[0] || String(sr.factory_short_name ?? "") || "—";
            const plf = sr.packing_list_files; const pl = sr.packing_list;
            const thumb = (Array.isArray(plf) && plf[0]?.thumbnail_url) ? String(plf[0].thumbnail_url)
              : (Array.isArray(pl) && pl[0]?.thumbnail_url) ? String(pl[0].thumbnail_url) : "";
            return (
              <button key={sr.id} type="button" onClick={() => { onPick(sr); setOpen(false); }}
                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{sr.ref_calculated || "—"}</div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-[11px]">
                    <div><div className="text-muted-foreground">Date Requested</div><div>{sr.date_requested ? fmtDate(String(sr.date_requested)) ?? "—" : "—"}</div></div>
                    <div><div className="text-muted-foreground">ETD</div><div>{sr.etd ? fmtDate(String(sr.etd)) ?? "—" : "—"}</div></div>
                    <div><div className="text-muted-foreground">Factory Code</div><div>{facCode !== "—" ? <InvPill label={facCode} colors={getForwarderColor(facCode)} /> : "—"}</div></div>
                    <div><div className="text-muted-foreground">Lead Approved</div><div>{isYes(sr.lead_approved) ? <span className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-semibold bg-teal-100 text-teal-800">Yes</span> : <span className="text-muted-foreground">—</span>}</div></div>
                  </div>
                </div>
                <div className="shrink-0 h-12 w-11 rounded border bg-muted/30 flex items-center justify-center overflow-hidden text-muted-foreground">
                  {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : "📎"}
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function InvoiceFormDialog({
  open, onOpenChange, row, onSave, loading, title, opts, layout = "flat", onDelete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: Record<string, unknown> | null;
  onSave: (data: Record<string, unknown>) => void;
  loading?: boolean;
  title: string;
  opts: InvoiceFieldOpts;
  layout?: "flat" | "sections";
  onDelete?: () => void;
}) {
  const { profile } = useAuth();
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const invoiceId = row && (row as any).id != null ? Number((row as any).id) : null;

  const [comments, setComments] = useState<InvoiceComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentSending, setCommentSending] = useState(false);
  const [mentioned, setMentioned] = useState<MentionUser[]>([]);
  // Linked Dispatch Request (reverse link via record_id) shown as a card.
  const [shipLink, setShipLink] = useState<any | null>(null);
  // In-app spreadsheet preview (Office Online viewer).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (row) {
      setFormData(withDerivedInvoiceFields({ ...row }));
    } else {
      const blank: Record<string, unknown> = {};
      for (const c of LOGISTICS_COLUMNS) blank[c.key] = c.type === "number" ? null : "";
      setFormData(blank);
    }
  }, [open, row]);

  useEffect(() => {
    if (!open || !invoiceId) { setComments([]); return; }
    let cancelled = false;
    setCommentsLoading(true);
    (async () => {
      const { data } = await (supabase as any)
        .from("invoice_comments").select("*").eq("invoice_id", invoiceId).order("created_at", { ascending: true });
      if (!cancelled) { setComments((data ?? []) as InvoiceComment[]); setCommentsLoading(false); }
    })();
    const ch = (supabase as any)
      .channel(`invoice_comments_${invoiceId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "invoice_comments", filter: `invoice_id=eq.${invoiceId}` },
        (p: any) => setComments((prev) => prev.some((c) => c.id === p.new.id) ? prev : [...prev, p.new as InvoiceComment]))
      .subscribe();
    return () => { cancelled = true; (supabase as any).removeChannel(ch); };
  }, [open, invoiceId]);

  // Resolve the linked shipping request by its Airtable record_id.
  useEffect(() => {
    const recId = row ? String((row as any).shipping_requests ?? "").trim() : "";
    if (!open || !recId) { setShipLink(null); return; }
    let cancelled = false;
    (async () => {
      // invoice.shipping_requests holds the Airtable record id, which the shipping
      // sync stored in receipt_number (record_id holds a different "Record ID" field).
      const { data } = await (supabase as any)
        .from("shipping_requests")
        .select("id, ref_calculated, ref_manual_old, full_factory_name, factory_short_name, factory_account, qc_team_account, management_team_account, customer_service_account, qc_team_account_countries, etd, packing_list, packing_list_files")
        .or(`receipt_number.eq.${recId},record_id.eq.${recId}`).maybeSingle();
      if (!cancelled) setShipLink(data ?? null);
    })();
    return () => { cancelled = true; };
  }, [open, row]);

  const set = (key: string, val: unknown) => setFormData((p) => withDerivedInvoiceFields({ ...p, [key]: val }));

  const handleSubmit = () => {
    // invoice_tracker columns are all text — save string values as-is.
    const payload: Record<string, unknown> = {};
    for (const f of INVOICE_FIELDS) {
      if (ISAVE_SKIP.has(f.kind)) continue;
      const v = formData[f.key];
      payload[f.key] = v === "" || v === undefined ? null : v ?? null;
    }
    // Persist the linked shipping request id (shipCard kind is otherwise skipped).
    payload["shipping_requests"] = (formData["shipping_requests"] as string) || null;
    onSave(payload);
  };

  const addComment = async () => {
    const body = commentBody.trim();
    if (!body || !invoiceId || !profile?.id) return;
    setCommentSending(true);
    try {
      const author_name = profile.full_name || profile.email?.split("@")[0] || "User";
      const emails = [...new Set(mentioned.filter((u) => u.email && body.includes(`@${u.full_name || u.email}`)).map((u) => u.email as string))];
      const { data, error } = await (supabase as any)
        .from("invoice_comments")
        .insert({ invoice_id: invoiceId, author_id: profile.id, author_name, body, mentioned_emails: emails.length ? emails : null })
        .select().single();
      if (error) throw error;
      setCommentBody(""); setMentioned([]);
      if (data) setComments((prev) => prev.some((c) => c.id === data.id) ? prev : [...prev, data as InvoiceComment]);
      if (emails.length) {
        void notifyMention({
          to: emails.join(", "), commenter: author_name, body,
          recordRef: String(formData["mbl"] ?? ""),
          link: `https://demo.example.invalid/invoice-tracker?open=${invoiceId}`,
        });
      }
    } catch (e: any) {
      toast.error("Failed to add comment: " + e.message);
    } finally {
      setCommentSending(false);
    }
  };

  const refTitle = formData["mbl"] || formData["hbl"] || formData["shipment_invoice_number"] || "";
  // Which field the header title resolved from — that's the one the editable
  // header box writes back to (default to mbl when all are empty).
  const titleKey = formData["mbl"] ? "mbl" : formData["hbl"] ? "hbl" : formData["shipment_invoice_number"] ? "shipment_invoice_number" : "mbl";

  const pillList = (str: string, colorFn: (v: string) => { bg: string; text: string }) => {
    const parts = str.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    return <div className="flex flex-wrap gap-1.5">{parts.map((p, i) => <InvPill key={`${p}-${i}`} label={p} colors={colorFn(p)} />)}</div>;
  };

  const renderEditor = (f: IField) => {
    const raw = formData[f.key];
    const str = raw === null || raw === undefined ? "" : String(raw);
    // HBL/MBL often hold long descriptive text (e.g. "PREPAY MLHD PO7050 BAL
    // (Pay w 0000000000)") — show it bold, larger, and wrapped across lines
    // instead of truncated on one line.
    if (f.kind === "text" && (f.key === "hbl" || f.key === "mbl")) {
      return (
        <Textarea value={str} onChange={(e) => set(f.key, e.target.value)}
          rows={2} className="text-sm font-bold resize-y min-h-[52px]" />
      );
    }
    // Tracker request: Container Number / Container ID hold several codes at
    // once — multi-line entry that expands vertically, not a one-line input.
    if (f.kind === "text" && (f.key === "container_number" || f.key === "container_id")) {
      return (
        <Textarea value={str} onChange={(e) => set(f.key, e.target.value)}
          rows={2} className="text-sm resize-y min-h-[52px]" />
      );
    }
    switch (f.kind) {
      case "pill": {
        const cfg: Record<string, { options: string[]; color: (v: string) => { bg: string; text: string }; create: boolean }> = {
          forwarder:          { options: opts.forwarder, color: getForwarderColor, create: true },
          vendor:             { options: opts.vendor, color: getVendorColor, create: true },
          country_of_origin:  { options: opts.country, color: getCountryColor, create: true },
          pol:                { options: opts.pol, color: getForwarderColor, create: true },
          pmt_status_finance: { options: PMT_FINANCE_OPTIONS, color: (v) => getStatusPillColor(PMT_FINANCE_COLORS, v), create: false },
          telex_received:     { options: opts.telex, color: getForwarderColor, create: true },
        };
        const c = cfg[f.key] ?? { options: [], color: getForwarderColor, create: true };
        return <ComboboxField value={str} onChange={(v) => set(f.key, v)} options={c.options} colorFn={c.color} allowCreate={c.create} />;
      }
      case "pillMulti":
        if (f.key === "vendor")
          return <PillMultiSearch value={str} onChange={(v) => set(f.key, v)} options={opts.vendor} colorFn={getVendorColor} />;
        return <PillMultiSearch value={str} onChange={(v) => set(f.key, v)} options={INVOICE_STATUS_OPTIONS} colorFn={(v) => getStatusPillColor(INVOICE_STATUS_COLORS, v)} />;
      case "checkbox": {
        const on = str === "true" || str === "True" || raw === true;
        return <div className="flex items-center h-9"><Checkbox checked={on} onCheckedChange={(c) => set(f.key, c ? "true" : "")} /></div>;
      }
      case "collab":
        return pillList(str, getForwarderColor) ?? <Input value="" readOnly className="h-9 text-sm" />;
      case "shipLookup": {
        const v = String(shipLink?.[f.lookup ?? ""] ?? "");
        return pillList(v, getForwarderColor) ?? <Input value="" readOnly className="h-9 text-sm" />;
      }
      case "shipCard": {
        const linker = (
          <ShipRequestLinker onPick={(sr) => {
            set("shipping_requests", sr.receipt_number ?? sr.record_id ?? String(sr.id));
            setShipLink(sr);
          }} />
        );
        if (!shipLink) return (
          <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2.5 flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">No shipping request linked</span>
            {linker}
          </div>
        );
        const facCode = String(shipLink.ref_calculated ?? "").split("-")[0];
        const plf = shipLink.packing_list_files; const pl = shipLink.packing_list;
        const packFiles = Array.isArray(plf) && plf.length ? parseShipPackFiles(plf) : parseShipPackFiles(pl);
        const packUrl = packFiles[0]?.url ?? "";
        const thumbUrl = packFiles[0]?.thumbnail_url ?? "";
        return (
          <div className="space-y-2">
            <div className="rounded-md border bg-background px-3 py-2.5 flex gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="font-semibold text-sm">{shipLink.ref_calculated || "—"}</div>
                  <button type="button" onClick={() => { set("shipping_requests", null); setShipLink(null); }}
                    className="text-muted-foreground hover:text-destructive shrink-0" title="Unlink shipping request">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-8 gap-y-1.5 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">REF# (Manual - OLD)</div>
                    <div>{shipLink.ref_manual_old || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Factory Code</div>
                    <div>{facCode ? <InvPill label={facCode} colors={getForwarderColor(facCode)} /> : "—"}</div>
                  </div>
                </div>
                <a href={`/shipping-requests?open=${shipLink.id}`} className="text-xs text-primary hover:underline mt-2 inline-block">Open shipping request →</a>
              </div>
              {packUrl && (
                <button type="button" onClick={() => setPreviewUrl(packUrl)} title="Preview packing list"
                  className="shrink-0 h-16 w-14 rounded border bg-muted/30 overflow-hidden flex items-center justify-center text-lg hover:bg-muted cursor-pointer">
                  {thumbUrl
                    ? <img src={thumbUrl} alt="Packing list" className="h-full w-full object-cover" loading="lazy" />
                    : "📄"}
                </button>
              )}
            </div>
            {/* Packing List uploader removed per tracker request — packing lists
                are uploaded on the Dispatch Request itself, not from here. The
                read-only thumbnail above still previews the linked file. */}
            {linker}
          </div>
        );
      }
      case "containerLink":
        return <ContainerCards value={str} onChange={(v) => set(f.key, v)} />;
      case "poLink":
        return <PoCards value={str} onChange={(v) => set(f.key, v)} />;
      case "attachment":
        return <PaySlipField value={str} onChange={(v) => set(f.key, v)} invoiceId={invoiceId} onPreview={setPreviewUrl} />;
      case "currency":
        return <CurrencyInput value={str} onChange={(v) => set(f.key, v)} />;
      case "readonlyCurrency":
        return <CurrencyInput value={str} readOnly />;
      case "readonly": {
        // "Created" stores a date string under a "readonly" kind (not "date") —
        // format it the same way as every other date so it doesn't show raw.
        const display = f.key === "etd_calc" && !str ? String(shipLink?.etd ?? "").slice(0, 10)
          : f.key === "created" ? (fmtDate(str) ?? str)
          : str;
        return <Input value={display} readOnly className="h-9 text-sm" />;
      }
      case "number":
        return <Input type="number" value={str} onChange={(e) => set(f.key, e.target.value)} className="h-9 text-sm" />;
      case "decimal1":
        return <Decimal1Input value={str} onChange={(v) => set(f.key, v)} />;
      case "longtext":
      case "textarea":
        return <Textarea value={str} onChange={(e) => set(f.key, e.target.value)} className="min-h-[52px] text-sm resize-y" />;
      case "date":
        return <Input type="date" value={str.slice(0, 10)} onChange={(e) => set(f.key, e.target.value)} className="h-9 text-sm" />;
      default:
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
                {invInitials(c.author_name)}
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
          placeholder={invoiceId ? "Leave a comment… (@ to mention)" : "Save the record first to comment"}
          disabled={!invoiceId || commentSending}
          className="min-h-[60px] text-sm resize-none bg-background"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void addComment()} disabled={!invoiceId || commentSending || !commentBody.trim()}>
            {commentSending ? "Sending…" : "Comment"}
          </Button>
        </div>
      </div>
    </aside>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("p-0 gap-0 !flex flex-col overflow-hidden", layout === "sections" ? "max-w-6xl w-[96vw] h-[92vh] max-h-[92vh]" : "max-w-5xl max-h-[90vh]")}>
        {layout === "sections" ? (
          <div className="px-6 pt-4 pb-4 border-b shrink-0">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to <span className="inline-flex items-center gap-1 font-medium text-foreground"><FileText className="h-3.5 w-3.5" /> Freight Bills</span>
            </button>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0 rounded-lg border bg-background px-4 py-2">
                <DialogTitle asChild>
                  <input
                    value={String(formData[titleKey] ?? "")}
                    onChange={(e) => set(titleKey, e.target.value)}
                    placeholder={title}
                    className="w-full bg-transparent border-0 outline-none p-0 text-2xl font-bold tracking-tight leading-tight placeholder:text-muted-foreground/50"
                  />
                </DialogTitle>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => onDelete?.()}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete invoice
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="destructive" className="shrink-0" onClick={() => onDelete?.()}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete invoice
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-6 pt-5 pb-4 border-b shrink-0">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Invoice</p>
            <DialogTitle className="text-2xl font-bold tracking-tight leading-tight">{String(refTitle) || title}</DialogTitle>
          </div>
        )}

        {layout === "sections" ? (
          <div className="flex flex-1 min-h-0">
          <ScrollArea className="flex-1 min-w-0">
            <div className="mx-auto max-w-5xl px-6 py-5 space-y-8">
              {(() => {
                // Exact field + arrangement per the design. Editable fields use
                // renderEditor; computed/derived values render as plain text.
                const F = (key: string, kind?: IFieldKind) =>
                  INVOICE_FIELDS.find((f) => f.key === key && (!kind || f.kind === kind));
                const cell = (f?: IField) => (f ? (
                  <div className="space-y-1.5 min-w-0">
                    <label className="text-[13px] font-medium text-muted-foreground">{f.label}</label>
                    <div className="min-w-0">{renderEditor(f)}</div>
                  </div>
                ) : null);
                const plain = (f?: IField) => (f ? (
                  <div className="space-y-1 min-w-0">
                    <label className="text-[13px] font-medium text-muted-foreground">{f.label}</label>
                    <div className="text-sm text-foreground py-1.5">
                      {(() => {
                        const v = formData[f.key];
                        if (v == null || v === "") return "—";
                        if (f.kind === "readonlyCurrency") {
                          const n = Number(String(v).replace(/[$,]/g, ""));
                          return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(v);
                        }
                        // "Created" is kind "readonly" (not "date"), but its value is
                        // still a date string — format it the same way so it doesn't
                        // show as a raw, differently-formatted value. fmtDate parses
                        // bare "YYYY-MM-DD" without going through timezone conversion
                        // (new Date() would read it as UTC midnight and show a day early).
                        if (f.kind === "date" || f.key === "created") {
                          return fmtDate(String(v)) ?? String(v);
                        }
                        return String(v);
                      })()}
                    </div>
                  </div>
                ) : null);
                const sec = (title: string, children: React.ReactNode) => (
                  <section className="space-y-4">
                    <h3 className="text-base font-bold tracking-tight text-foreground border-b pb-2">{title}</h3>
                    {children}
                  </section>
                );
                const g2 = "grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4";
                const g3 = "grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4";
                const g4 = "grid grid-cols-1 sm:grid-cols-4 gap-x-6 gap-y-4";
                return (
                  <>
                    {sec("Dispatch Requests", <div>{renderEditor(F("shipping_requests")!)}</div>)}
                    {sec("Status", cell(F("invoice_status")))}
                    {sec("Vendor Information", <div className={g3}>{cell(F("vendor"))}{cell(F("country_of_origin"))}{cell(F("pol"))}</div>)}
                    {sec("Invoice Information", <div className="space-y-4">
                      <div className={g3}>{cell(F("hbl"))}{cell(F("mbl", "text"))}{cell(F("booking_num"))}</div>
                      <div className={g2}>{cell(F("ddp"))}</div>
                      <div className={g2}>{cell(F("shipment_invoice_number"))}{cell(F("purchase_order"))}</div>
                    </div>)}
                    {sec("Arrival Information", <div className="space-y-4">
                      <div className={g2}>{cell(F("arrival_notice"))}{cell(F("freight_invoice"))}</div>
                      <div className={g4}>{cell(F("dx2fdr"))}{cell(F("telex_received"))}{cell(F("do_dispatch"))}{cell(F("drayage"))}</div>
                      <div className={g4}>{cell(F("ata_pod"))}{cell(F("eta_pod"))}{cell(F("atd"))}{cell(F("etd"))}</div>
                      <div className={g2}>{plain(F("atd_week"))}{plain(F("atd_month"))}{plain(F("ata_week"))}{plain(F("ata_month"))}{plain(F("on_water_transit"))}{plain(F("atd_delay"))}</div>
                    </div>)}
                    {sec("Shipment Information", <div className="space-y-4">
                      <div className={g3}>{cell(F("forwarder"))}{cell(F("carrier"))}{cell(F("vessel_name"))}</div>
                      {cell(F("hc_40_count"))}
                      {cell(F("rate"))}
                      <div className={g2}>{cell(F("container_number", "text"))}{cell(F("container_id"))}</div>
                    </div>)}
                    {sec("Containers Linked To This Invoice", <div className="space-y-4">
                      {cell(F("containers_linked_to_this_invoice", "containerLink"))}
                      {plain(F("estimated_total_freight"))}
                      {cell(F("notes"))}
                    </div>)}
                    {sec("Finance Information", <div className="space-y-4">
                      <div className={g2}>{cell(F("payment_due"))}{cell(F("pmt_rq_date"))}</div>
                      {cell(F("pmt_status_finance"))}
                      <div className={g2}>{cell(F("pmt_approved_lead"))}{cell(F("paid"))}</div>
                      <div className={g2}>{cell(F("value"))}{cell(F("adjustment_amount"))}</div>
                      <div className={g2}>{plain(F("amount_due"))}{cell(F("unpaid"))}</div>
                    </div>)}
                    {sec("Pay Slip", cell(F("pay_slip")))}
                    <div className={g2 + " pt-4 border-t border-border/60"}>{plain(F("created"))}{cell(F("created_by"))}</div>
                  </>
                );
              })()}
            </div>
          </ScrollArea>
          {commentsAside}
          </div>
        ) : (
        <div className="flex flex-1 min-h-0">
          <ScrollArea className="flex-1 min-w-0">
            <div className="px-6 py-2 divide-y divide-border/60">
              {INVOICE_FIELDS.map((f, idx) => (
                <div key={`${f.key}-${idx}`} className="grid grid-cols-[180px_1fr] gap-4 py-3 items-start">
                  <div className="pt-2 text-[13px] text-muted-foreground truncate">{f.label}</div>
                  <div className="min-w-0">{renderEditor(f)}</div>
                </div>
              ))}
            </div>
          </ScrollArea>
          {commentsAside}
        </div>
        )}

        <DialogFooter className="px-6 py-3 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>{loading ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* In-app preview — spreadsheets/docs via Office Online, images/PDFs inline. */}
    <Dialog open={!!previewUrl} onOpenChange={(o) => { if (!o) setPreviewUrl(null); }}>
      <DialogContent className="max-w-5xl h-[85vh] p-0 gap-0 !flex flex-col overflow-hidden">
        <DialogTitle className="px-5 py-3 border-b text-sm font-semibold shrink-0">Preview</DialogTitle>
        {previewUrl && (() => {
          const ext = (previewUrl.split("?")[0].split(".").pop() ?? "").toLowerCase();
          const isImage = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext);
          const isPdf = ext === "pdf";
          const isCsv = ext === "csv";
          // Legacy files synced straight from Airtable's own (signed, temporary)
          // CDN link — those expire and can never be re-fetched once dead, so an
          // embedded viewer just shows a confusing "File not found" page instead.
          if (/airtableusercontent\.com/i.test(previewUrl)) {
            return (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
                <div className="text-4xl">⚠️</div>
                <p className="text-sm font-semibold">This attachment link has expired</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  It was synced from Airtable's own file link, which is temporary and has since gone dead —
                  this file can no longer be viewed or downloaded from here. Check the original Airtable
                  record for the file, then re-upload it here.
                </p>
              </div>
            );
          }
          if (isImage) return <div className="flex-1 overflow-auto bg-muted/20 flex items-center justify-center"><img src={previewUrl} alt="Preview" className="max-h-full max-w-full object-contain" /></div>;
          if (isPdf) return <iframe title="PDF preview" src={previewUrl} className="flex-1 w-full border-0" />;
          if (isCsv) return <div className="flex-1 min-h-0"><CsvPreview url={previewUrl} /></div>;
          return <iframe title="Document preview" src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewUrl)}`} className="flex-1 w-full border-0" />;
        })()}
        {!/airtableusercontent\.com/i.test(previewUrl ?? "") && (
          <div className="px-5 py-2.5 border-t shrink-0">
            <a href={previewUrl ?? "#"} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Open / download original →</a>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// n8n webhook for the "Payment Request" email — fires when an invoice's status
// becomes Payment Requested while Payment Due is set (mirrors the Airtable condition trigger).
const N8N_PAYMENT_REQUEST_WEBHOOK_URL =
  (import.meta as any).env?.VITE_N8N_PAYMENT_REQUEST_WEBHOOK_URL ||
  "https://automation.example.invalid/webhook/payment-review";

/** True when the value matches the "Payment Requested" payment-request status. */
function isPmtReq(v: unknown): boolean {
  return String(v ?? "").trim().toUpperCase().includes("Payment Requested");
}

/** True when PMT Status - Finance is "Approval Requested" (approval requested). */
function isAprvReq(v: unknown): boolean {
  return String(v ?? "").trim().toUpperCase().includes("Approval Requested");
}

// n8n webhook for the "Approval Request" email — fires when PMT Status - Finance
// becomes Approval Requested (mirrors the Airtable condition trigger). Emails the buyer lead from the payables lead.
const N8N_APPROVAL_REQUEST_WEBHOOK_URL =
  (import.meta as any).env?.VITE_N8N_APPROVAL_REQUEST_WEBHOOK_URL ||
  "https://automation.example.invalid/webhook/payment-approval";

/** True when a checkbox-style value is checked (stored as "true"). */
function isChecked(v: unknown): boolean {
  return v === true || String(v ?? "").trim().toLowerCase() === "true";
}

/** True when PMT Status - Finance is PAID. */
function isPaid(v: unknown): boolean {
  return String(v ?? "").trim().toUpperCase() === "PAID";
}

/** True when Invoice Status includes "Documents Received". */
function isDocsRcvd(v: unknown): boolean {
  return String(v ?? "").toUpperCase().includes("Documents Received");
}

// n8n webhook for the "Docs Received" email — fires when Invoice Status includes
// Documents Received. Emails the shipping-docs inbox (CC the logistics reviewer + logistics).
const N8N_DOCS_RCVD_WEBHOOK_URL =
  (import.meta as any).env?.VITE_N8N_DOCS_RCVD_WEBHOOK_URL ||
  "https://automation.example.invalid/webhook/docs-received";

/** Fire-and-forget: "Docs Received" email. Called from the Edit flow when
 *  invoice_status → Documents Received. */
async function notifyDocsReceived(row: Record<string, unknown>): Promise<void> {
  try {
    await fetch(N8N_DOCS_RCVD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceStatus: (row as any).invoice_status ?? "",
        hbl:           (row as any).hbl ?? "",
        mbl:           (row as any).mbl ?? "",
        vendor:        (row as any).vendor ?? "",
        invoiceNumber: (row as any).shipment_invoice_number ?? "",
        openId:        (row as any).id ?? "",
      }),
    });
  } catch (e) {
    console.warn("[InvoiceTracker] docs-received webhook failed:", e);
  }
}

// n8n webhook for the "Paid" email — fires when PMT Status - Finance becomes PAID
// while Invoice Status = Payment Requested. Emails finance + accounting (CC the logistics reviewer) from the payables lead.
const N8N_PAID_WEBHOOK_URL =
  (import.meta as any).env?.VITE_N8N_PAID_WEBHOOK_URL ||
  "https://automation.example.invalid/webhook/payment-paid";

/** Fire-and-forget: "Paid" email to finance + accounting. Called from the Edit flow
 *  when pmt_status_finance → PAID (and Invoice Status = Payment Requested). */
async function notifyPaid(row: Record<string, unknown>): Promise<void> {
  try {
    await fetch(N8N_PAID_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pmtStatus:     (row as any).pmt_status_finance ?? "",
        vendor:        (row as any).vendor ?? "",
        invoiceNumber: (row as any).shipment_invoice_number ?? "",
        hbl:           (row as any).hbl ?? "",
        mbl:           (row as any).mbl ?? "",
        openId:        (row as any).id ?? "",
      }),
    });
  } catch (e) {
    console.warn("[InvoiceTracker] paid webhook failed:", e);
  }
}

// n8n webhook for the "Payment Approved" email — fires when PMT Approved - Lead is
// checked while Invoice Status = Payment Requested. Emails the payables lead from the buyer lead.
const N8N_PAYMENT_APPROVED_WEBHOOK_URL =
  (import.meta as any).env?.VITE_N8N_PAYMENT_APPROVED_WEBHOOK_URL ||
  "https://automation.example.invalid/webhook/payment-approved-only";

/** Fire-and-forget: "Payment Approved" email to the payables lead. Called from the Edit flow
 *  when pmt_approved_lead → checked (and Invoice Status = Payment Requested). */
async function notifyPaymentApproved(row: Record<string, unknown>): Promise<void> {
  try {
    await fetch(N8N_PAYMENT_APPROVED_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approved:      "true",
        vendor:        (row as any).vendor ?? "",
        invoiceNumber: (row as any).shipment_invoice_number ?? "",
        hbl:           (row as any).hbl ?? "",
        mbl:           (row as any).mbl ?? "",
        openId:        (row as any).id ?? "",
      }),
    });
  } catch (e) {
    console.warn("[InvoiceTracker] payment-approved webhook failed:", e);
  }
}

/** Fire-and-forget: "Approval Request" email to the buyer lead. Called from the Edit flow
 *  when pmt_status_finance → Approval Requested. */
async function notifyApprovalRequest(row: Record<string, unknown>): Promise<void> {
  try {
    await fetch(N8N_APPROVAL_REQUEST_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pmtStatus:     (row as any).pmt_status_finance ?? "",
        vendor:        (row as any).vendor ?? "",
        invoiceNumber: (row as any).shipment_invoice_number ?? "",
        hbl:           (row as any).hbl ?? "",
        mbl:           (row as any).mbl ?? "",
        openId:        (row as any).id ?? "",
      }),
    });
  } catch (e) {
    console.warn("[InvoiceTracker] approval-request webhook failed:", e);
  }
}

/** Fire-and-forget: "Payment Request" email to the payables lead/accounting (CC the logistics reviewer in
 *  n8n). Called from the Edit flow when invoice_status → Payment Requested. */
async function notifyPaymentRequest(row: Record<string, unknown>): Promise<void> {
  try {
    await fetch(N8N_PAYMENT_REQUEST_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceStatus: (row as any).invoice_status ?? "Payment Requested",
        vendor: (row as any).vendor ?? "",
        hbl:    (row as any).hbl ?? "",
        mbl:    (row as any).mbl ?? "",
        eta:    (row as any).eta_pod ?? "",
        ataPod: (row as any).ata_pod ?? "",
        invoiceNumber: (row as any).shipment_invoice_number ?? "",
        openId: (row as any).id ?? "",
      }),
    });
  } catch (e) {
    console.warn("[InvoiceTracker] payment-request webhook failed:", e);
  }
}

/** Searchable single-select dropdown rendering options as colored pills.
 *  With `allowCreate`, a typed value not in the list can be added on the fly
 *  (mirrors Airtable's linked-record "+" add behavior). */
function ComboboxField({
  value, onChange, options, colorFn, allowCreate, placeholder = "Select…",
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  colorFn: (v: string) => { bg: string; text: string };
  allowCreate?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const Pill = ({ label }: { label: string }) => {
    const { bg, text } = colorFn(label);
    return (
      <span style={{
        backgroundColor: bg, color: text, borderRadius: "9999px", padding: "2px 12px",
        fontWeight: 600, fontSize: "12px", display: "inline-block", whiteSpace: "nowrap",
      }}>
        {label}
      </span>
    );
  };

  const term = search.trim();
  const showCreate = !!allowCreate && !!term &&
    !options.some((o) => o.toLowerCase() === term.toLowerCase());

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          {value ? <Pill label={value} /> : <span className="text-muted-foreground">{placeholder}</span>}
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Find an option" value={search} onValueChange={setSearch} />
          <CommandList>
            {!showCreate && <CommandEmpty>No match.</CommandEmpty>}
            {showCreate && (
              <CommandItem value={term} onSelect={() => { onChange(term); setOpen(false); setSearch(""); }} className="cursor-pointer">
                <Plus className="h-3.5 w-3.5 mr-2" /> Add &ldquo;{term}&rdquo;
              </CommandItem>
            )}
            {options.map((opt) => (
              <CommandItem
                key={opt}
                value={opt}
                onSelect={() => { onChange(opt); setOpen(false); setSearch(""); }}
                className="cursor-pointer"
              >
                <Pill label={opt} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

type ContainerOption = { container_id: unknown; container_name: string };

/** Multi-select linked-record picker over the `container` table — mirrors the
 *  Airtable "Link A Containers" field. Selected container codes are stored as a
 *  comma-separated string (the same shape `container_number` already holds, so
 *  the table's existing pill rendering keeps working). */
function ContainerPicker({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ContainerOption[];
}) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => String(value || "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean),
    [value],
  );
  const selectedSet = new Set(selected.map((s) => s.toLowerCase()));

  const toggle = (name: string) => {
    const next = selectedSet.has(name.toLowerCase())
      ? selected.filter((s) => s.toLowerCase() !== name.toLowerCase())
      : [...selected, name];
    onChange(next.join(", "));
  };

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((name, i) => (
            <span key={i} style={{
              backgroundColor: "#e9f5f5", color: "#0d5b5d", borderRadius: "9999px",
              padding: "2px 8px 2px 10px", fontSize: "12px", fontWeight: 500,
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              {name}
              <button type="button" onClick={() => toggle(name)} className="hover:opacity-60">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add item
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search" />
            <CommandList>
              <CommandEmpty>No containers found.</CommandEmpty>
              {options.map((c) => {
                const name = c.container_name;
                const isSel = selectedSet.has(name.toLowerCase());
                return (
                  <CommandItem
                    key={String(c.container_id) + "|" + name}
                    value={`${String(c.container_id ?? "")} ${name}`}
                    onSelect={() => toggle(name)}
                    className="cursor-pointer"
                  >
                    <div className="flex w-full flex-col gap-0.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{String(c.container_id ?? "")}</span>
                        {isSel && <Check className="h-4 w-4 text-primary" />}
                      </div>
                      <span className="text-[11px] text-muted-foreground">Container Name</span>
                      <span className="text-xs">{name}</span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Curated Airtable-style "Invoice Form" for creating a new invoice row.
 *  Dropdowns are searchable comboboxes seeded from existing table values. */
function InvoiceAddForm({
  open, onOpenChange, onSave, loading, forwarderOptions, vendorOptions, countryOptions, containerOptions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (data: Record<string, unknown>) => void;
  loading?: boolean;
  forwarderOptions: string[];
  vendorOptions: string[];
  countryOptions: string[];
  containerOptions: ContainerOption[];
}) {
  const blank = () => ({
    mbl: "",
    forwarder: "",
    ata_pod: todayISO(),
    vendor: "",
    eta_pod: "",
    atd: "",
    etd: "",
    country_of_origin: "",
    container_number: "",
  });

  const [form, setForm] = useState<Record<string, unknown>>(blank);

  useEffect(() => { if (open) setForm(blank()); }, [open]);

  const set = (key: string, val: unknown) => setForm((p) => ({ ...p, [key]: val }));

  const handleSubmit = () => {
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) payload[k] = v === "" ? null : v;
    // System creation stamp — CREATED is read-only everywhere else.
    payload.created = todayISO();
    onSave(payload);
  };

  const labelCls = "text-xs font-semibold text-foreground";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* !flex overrides DialogContent's base `grid` (which otherwise wins by CSS
          order and breaks the flex-scroll layout); overflow-hidden clips so the
          flex-1 ScrollArea bounds to the viewport and scrolls on short screens. */}
      <DialogContent className="max-w-4xl max-h-[88vh] !flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Invoice Form</DialogTitle></DialogHeader>
        {/* Plain overflow-y-auto (not Radix ScrollArea) — the ScrollArea viewport
            doesn't get a bounded height inside this flex dialog, so it never
            scrolled. Same pattern as ShippingAddForm, which scrolls fine. */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-4">
          <div className="space-y-4 py-2">
            <div className="grid gap-1.5">
              <Label className={labelCls}>MBL</Label>
              <Input value={String(form.mbl ?? "")} onChange={(e) => set("mbl", e.target.value)} />
            </div>

            <div className="grid gap-1.5">
              <Label className={labelCls}>Forwarder</Label>
              {/* Plain text per tracker request (was a pill combobox). */}
              <Input value={String(form.forwarder ?? "")} onChange={(e) => set("forwarder", e.target.value)} />
            </div>

            <div className="grid gap-1.5">
              <Label className={labelCls}>Vendor</Label>
              <ComboboxField value={String(form.vendor ?? "")} onChange={(v) => set("vendor", v)}
                options={vendorOptions} colorFn={getVendorColor} allowCreate />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className={labelCls}>ATA POD</Label>
                <Input type="date" value={String(form.ata_pod ?? "")} onChange={(e) => set("ata_pod", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label className={labelCls}>ETA POD</Label>
                <Input type="date" value={String(form.eta_pod ?? "")} onChange={(e) => set("eta_pod", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label className={labelCls}>ATD</Label>
                <Input type="date" value={String(form.atd ?? "")} onChange={(e) => set("atd", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label className={labelCls}>ETD</Label>
                <Input type="date" value={String(form.etd ?? "")} onChange={(e) => set("etd", e.target.value)} />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label className={labelCls}>Country of Origin</Label>
              <ComboboxField value={String(form.country_of_origin ?? "")} onChange={(v) => set("country_of_origin", v)}
                options={countryOptions} colorFn={getCountryColor} />
            </div>

            <div className="grid gap-1.5">
              <Label className={labelCls}>Container Number</Label>
              <Textarea rows={2} value={String(form.container_number ?? "")}
                onChange={(e) => set("container_number", e.target.value)}
                placeholder="Type codes, or link from the list below" />
            </div>

            <div className="grid gap-1.5">
              <Label className={labelCls}>Link A Containers</Label>
              <ContainerPicker
                value={String(form.container_number ?? "")}
                onChange={(v) => set("container_number", v)}
                options={containerOptions}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" className="text-muted-foreground mr-auto"
            onClick={() => setForm(blank())} disabled={loading}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Clear form
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={loading}>{loading ? "Saving…" : "Submit"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Page ── */
export default function InvoiceTracker({
  tableName = DEFAULT_TABLE,
  queryKey = DEFAULT_QUERY_KEY,
  title = "Freight Bills",
  subtitle = "Freight bills per container",
  permKey = "invoice_tracker",
  tabGroup,
}: InvoiceTrackerProps = {}) {
  const TABLE_NAME = tableName;
  const QUERY_KEY  = queryKey;
  // Finance gets a leaner payment-focused column set; Logistics (and
  // Management, which has no separate spec) get the fuller schedule/detail set.
  const COLUMNS = tabGroup === "finance" ? FINANCE_COLUMNS : LOGISTICS_COLUMNS;
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canEdit } = usePagePermission(permKey as any);
  const { restricted: factoryRestricted, countryAliases } = useFactoryAccess();
  const { profile } = useAuth();

  const [searchQuery, setSearchQuery] = usePersistedState(`${QUERY_KEY}:search`, "");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = usePersistedState(`${QUERY_KEY}:page`, 1);
  const [pageSize, setPageSize]         = usePersistedState(`${QUERY_KEY}:pageSize`, 50);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [editRow,      setEditRow]      = useState<Record<string, unknown> | null>(null);
  const [editOpen,     setEditOpen]     = useState(false);
  const [editLoading,  setEditLoading]  = useState(false);
  // Full Edit is the only edit surface now (flat "Edit" was removed per
  // request) -- default to "sections" so any path that opens this dialog
  // without explicitly setting a layout (e.g. the ?open=<id> deep link
  // below) lands on Full Edit, not the retired flat layout.
  const [editLayout,   setEditLayout]   = useState<"flat" | "sections">("sections");
  const [deleteRow,    setDeleteRow]    = useState<Record<string, unknown> | null>(null);
  const [deleteOpen,   setDeleteOpen]   = useState(false);
  const [deleteLoading,setDeleteLoading]= useState(false);
  const [addOpen,      setAddOpen]      = useState(false);
  const [addLoading,   setAddLoading]   = useState(false);

  // Full-screen sectioned editor — the only Edit surface now. The flat "Edit"
  // dialog was removed per request (it duplicated Full Edit's fields with no
  // section grouping, and the user confirmed there's no need for both).
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

  // Deep-link: /invoice-tracker?open=<id> opens that invoice record directly —
  // used by the "Payment Request" email so recipients land on the exact invoice.
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
        toast.error("Invoice not found");
        const next = new URLSearchParams(searchParams);
        next.delete("open");
        setSearchParams(next, { replace: true });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Filter option lists (single combined query) ── */
  const { data: filterOptions } = useQuery({
    queryKey: [QUERY_KEY, "opts"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from(TABLE_NAME)
        .select("invoice_status, vendor, forwarder, country_of_origin, carrier, pmt_status_finance, pol, telex_received");
      const rows = data ?? [];
      const uniq = (key: string) =>
        [...new Set(rows.map((r: any) => r[key]).filter(Boolean))].sort() as string[];
      return {
        statusOptions:     uniq("invoice_status"),
        vendorOptions:     uniq("vendor"),
        forwarderOptions:  uniq("forwarder"),
        countryOptions:    uniq("country_of_origin"),
        carrierOptions:    uniq("carrier"),
        pmtFinanceOptions: uniq("pmt_status_finance"),
        polOptions:        uniq("pol"),
        telexOptions:      uniq("telex_received"),
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  /* ── Container picker options (from the `container` table) ──
   * The table holds one row per PO item, so container_id/container_name repeat.
   * Fetch a generous window of recent rows and dedupe by container_id. */
  const { data: containerOptions = [] } = useQuery({
    queryKey: [QUERY_KEY, "container-options"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("container")
        .select("container_id, container_name")
        .order("container_id", { ascending: false })
        .limit(8000);
      if (error) throw error;
      const seen = new Set<string>();
      const out: { container_id: unknown; container_name: string }[] = [];
      for (const c of (data ?? []) as any[]) {
        if (!c.container_name) continue;
        const key = String(c.container_id);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ container_id: c.container_id, container_name: c.container_name });
      }
      return out;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Kept for the Add/Edit dialog option pickers (the filter bar dropdowns are
  // gone — the Airtable Filter builder replaces them).
  const vendorOptions     = filterOptions?.vendorOptions     ?? [];
  const forwarderOptions  = filterOptions?.forwarderOptions  ?? [];
  const countryOptions    = filterOptions?.countryOptions    ?? [];

  /* ── Main data query.
   *
   * The Airtable→Supabase sync is INSERT-only: every change in Airtable lands
   * as a NEW snapshot row (many rows and growing, 60+ copies of one MBL —
   * ~1.4MB per 1,000 rows, so fetching everything is a ~165MB+ download that
   * hangs the page). The sync table can't be cleaned (the automation owns
   * it), so:
   *   1. PREFERRED — read the `<table>_latest` VIEW (newest snapshot per
   *      MBL|HBL, deduped in the DB; see CREATE_INVOICE_LATEST_VIEW.sql).
   *   2. FALLBACK (view not created yet) — collapse duplicates client-side.
   * Either way, only the newest PAGE_FETCH_CAP rows are pulled — a light
   * "recent window" rather than the full table, so the page stays fast even
   * as the sync keeps growing. Increase the cap here if older records need
   * to be reachable without search. Writes (edit / inline edit / delete /
   * realtime) stay on the base table regardless of read source. ── */
  const PAGE_FETCH_CAP = 5000;
  const { data: allRows = [], isLoading, error } = useQuery({
    queryKey: [QUERY_KEY, "all", factoryRestricted, countryAliases],
    queryFn: async () => {
      const CHUNK = 1000;
      // Chunked fetch of the newest `cap` rows from a table or view.
      const fetchCapped = async (source: string, cap: number) => {
        const build = (withCount: boolean) => {
          let q: any = (supabase as any).from(source).select(SELECT_FIELDS, withCount ? { count: "exact" } : undefined);
          // Factory/region gate — country_of_origin may be a full name or ISO code.
          if (factoryRestricted && countryAliases.length) {
            q = q.or(countryAliases.map((v) => `country_of_origin.ilike.${v}`).join(","));
          }
          // created_at = real insert time, so newest snapshots come first.
          return q.order("created_at", { ascending: false, nullsFirst: false });
        };
        const firstRes = await build(true).range(0, CHUNK - 1);
        if (firstRes.error) throw firstRes.error;
        const out: Record<string, unknown>[] = [...((firstRes.data as Record<string, unknown>[]) ?? [])];
        const total = Math.min(firstRes.count ?? out.length, cap);
        const pages = Math.ceil(total / CHUNK);
        if (pages > 1) {
          const rest = await Promise.all(
            Array.from({ length: pages - 1 }, (_, i) => build(false).range((i + 1) * CHUNK, (i + 2) * CHUNK - 1))
          );
          for (const r of rest) { if (r.error) throw r.error; out.push(...((r.data as Record<string, unknown>[]) ?? [])); }
        }
        return out;
      };

      // Preferred: the deduped DB view (already one row per invoice). Any
      // failure here — PostgREST returns "PGRST205" (schema-cache miss)
      // rather than the raw Postgres "42P01" for a relation that doesn't
      // exist yet — just means CREATE_INVOICE_LATEST_VIEW.sql hasn't been
      // run on this project, so fall through to the raw-table path.
      try {
        return await fetchCapped(`${TABLE_NAME}_latest`, PAGE_FETCH_CAP);
      } catch {
        // fall through to the raw-table fallback
      }

      // Fallback: newest snapshots from the raw sync table, deduped client-side.
      const out = await fetchCapped(TABLE_NAME, PAGE_FETCH_CAP);
      const seen = new Set<string>();
      const deduped = out.filter((r) => {
        const key = `${r.mbl ?? ""}|${r.hbl ?? ""}`.trim().toUpperCase();
        if (key === "|") return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (deduped.length < out.length) {
        console.info(`[invoice-tracker] collapsed ${out.length - deduped.length} duplicate sync snapshots (${deduped.length} unique invoices shown)`);
      }
      return deduped;
    },
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
  });

  // Fill blank formula fields (ATD/ATA week & month, delay, transit) client-side.
  const enrichedRows = useMemo(() => allRows.map(withDerivedInvoiceFields), [allRows]);

  // View fields from curated columns, with runtime option lists for single-selects.
  const fields: ViewField[] = useMemo(() => {
    const optsFor = (key: string) => [...new Set(enrichedRows.map((r) => (r as any)[key]).filter(Boolean).map(String))].sort();
    return COLUMNS.map((c) => ({
      key: c.key,
      label: c.label,
      // invoice_status is a real multi-select (comma-combined tags like "PMT
      // REQ, PAID") — give it the fixed tag list + "multi" type so the filter
      // checklist shows each status once, and isAnyOf/isNoneOf match per-tag
      // instead of against the whole combined string.
      type: (c.key === "invoice_status" ? "multi" : INV_SINGLE_FIELDS.has(c.key) ? "single" : INV_BOOL_FIELDS.has(c.key) ? "bool" : c.type) as FieldType,
      options: c.key === "invoice_status" ? INVOICE_STATUS_OPTIONS : INV_SINGLE_FIELDS.has(c.key) ? optsFor(c.key) : undefined,
    }));
  }, [enrichedRows]);

  // Quick search runs before the engine; engine owns filter/sort/group/hide/height.
  const prefiltered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return enrichedRows;
    const cols = ["hbl", "mbl", "booking_num", "forwarder", "vendor", "carrier",
      "invoice_status", "purchase_order", "shipment_invoice_number", "container_number"];
    return enrichedRows.filter((r) => cols.some((c) => String((r as any)[c] ?? "").toLowerCase().includes(term)));
  }, [enrichedRows, debouncedSearch]);

  const view = useTableView({ storageKey: QUERY_KEY, fields, rows: prefiltered, defaultSort: [{ field: "created", dir: "desc" }] });
  const visibleCols = useMemo(() => COLUMNS.filter((c) => !view.hiddenSet.has(c.key)), [view.hiddenSet]);
  const colW = (c: ColDef) => view.state.colWidths[c.key] ?? invDefaultColW(c);
  const tableWidth = useMemo(() => visibleCols.reduce((s, c) => s + colW(c), 0) + 120, [visibleCols, view.state.colWidths]);

  // Inline cell editing. Hovering a row shows every editable cell in it as a
  // live control (Airtable-style); double-click still works as a fallback.
  // Bool cols edit via the dialog only.
  const { editCell, setEditCell, commit } = useInlineEdit(TABLE_NAME, QUERY_KEY);
  const { activeRowId, setActiveRowId } = useActiveRow();
  const fieldOptions = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.options])) as Record<string, string[] | undefined>, [fields]);
  const sortField = view.state.sort[0]?.field ?? null;
  const sortDir = view.state.sort[0]?.dir ?? null;
  const grouped = view.result.groups;
  const resultRows = view.result.rows;
  const totalCount = resultRows.length;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const paginated = useMemo(() => resultRows.slice((currentPage - 1) * pageSize, currentPage * pageSize), [resultRows, currentPage, pageSize]);

  useEffect(() => { if (currentPage > totalPages) setCurrentPage(1); }, [totalPages, currentPage, setCurrentPage]);

  const toggleGroup = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  /* ── Realtime ── */
  useEffect(() => {
    const ch = (supabase as any)
      .channel(`${TABLE_NAME}_realtime`)
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_NAME }, () =>
        queryClient.invalidateQueries({
          queryKey: [QUERY_KEY],
          predicate: (q) => (q.queryKey as unknown[])[1] !== "opts",
        })
      )
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, [queryClient]);

  /* ── CRUD ── */
  const handleSaveEdit = async (updates: Record<string, unknown>) => {
    if (!editRow) return;
    setEditLoading(true);
    try {
      const { error } = await (supabase as any).from(TABLE_NAME).update(updates).eq("id", (editRow as any).id);
      if (error) throw error;
      toast.success("Invoice updated");
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      // Payment-request email — only when invoice_status newly becomes Payment Requested
      // and Payment Due is set (mirrors the Airtable condition trigger).
      const merged = { ...editRow, ...updates };
      const hasDue = !!String((merged as any).payment_due ?? "").trim();
      if (isPmtReq((merged as any).invoice_status) && !isPmtReq((editRow as any).invoice_status) && hasDue) {
        void notifyPaymentRequest(merged);
      }
      // Approval-request email — when PMT Status - Finance newly becomes Approval Requested.
      if (isAprvReq((merged as any).pmt_status_finance) && !isAprvReq((editRow as any).pmt_status_finance)) {
        void notifyApprovalRequest(merged);
      }
      // Payment-approved email — when PMT Approved - Lead is newly checked while Invoice Status = Payment Requested.
      if (isChecked((merged as any).pmt_approved_lead) && !isChecked((editRow as any).pmt_approved_lead) && isPmtReq((merged as any).invoice_status)) {
        void notifyPaymentApproved(merged);
      }
      // Paid email — when PMT Status - Finance newly becomes PAID while Invoice Status = Payment Requested.
      if (isPaid((merged as any).pmt_status_finance) && !isPaid((editRow as any).pmt_status_finance) && isPmtReq((merged as any).invoice_status)) {
        void notifyPaid(merged);
      }
      // Docs-received email — when Invoice Status newly includes Documents Received.
      if (isDocsRcvd((merged as any).invoice_status) && !isDocsRcvd((editRow as any).invoice_status)) {
        void notifyDocsReceived(merged);
      }
    } catch (e: any) { toast.error("Update failed: " + e.message); }
    finally { setEditLoading(false); }
  };

  const handleSaveAdd = async (payload: Record<string, unknown>) => {
    setAddLoading(true);
    try {
      // Created By is a system stamp — the creating user, set once at insert.
      // Fall back to email so this is never blank for a logged-in user whose
      // profile doesn't have full_name filled in.
      const stamped = { ...payload, created_by: profile?.full_name || profile?.email || null };
      const { error } = await (supabase as any).from(TABLE_NAME).insert([stamped]);
      if (error) throw error;
      toast.success("Invoice added");
      setAddOpen(false);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    } catch (e: any) { toast.error("Add failed: " + e.message); }
    finally { setAddLoading(false); }
  };

  const handleConfirmDelete = async () => {
    if (!deleteRow) return;
    setDeleteLoading(true);
    try {
      // An invoice referenced by a shipping request can't be deleted outright —
      // the FK (shipping_requests_invoice_tracker_id_fkey) blocks it. Unlink
      // those requests first: the shipping request survives, it just loses its
      // invoice link (tracker bug, a user: HBL XXXX000000000 was undeletable).
      const { error: unlinkError } = await (supabase as any)
        .from("shipping_requests")
        .update({ invoice_tracker_id: null })
        .eq("invoice_tracker_id", (deleteRow as any).id);
      if (unlinkError) throw unlinkError;
      const { error } = await (supabase as any).from(TABLE_NAME).delete().eq("id", (deleteRow as any).id);
      if (error) throw error;
      toast.success("Invoice deleted");
      setDeleteOpen(false);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    } catch (e: any) { toast.error("Delete failed: " + e.message); }
    finally { setDeleteLoading(false); }
  };

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden min-h-0" style={{ maxWidth: "none" }}>

      {/* ── Header ── */}
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
                <h1 className="text-sm font-semibold text-foreground leading-tight truncate">{title}</h1>
                <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <PermissionGuardButton canEdit={canEdit} size="sm" className="h-8" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New Invoice
            </PermissionGuardButton>
          </div>
        </div>
      </header>

      {/* ── Filter bar ── */}
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

      {/* ── Table ── */}
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
                      const __kind = invEditKind(col);
                      const isDblClicked = !!(editCell && editCell.id === rowId && editCell.key === col.key);
                      // Boolean columns (DDP, Arrival Notice, Freight Invoice, PMT
                      // Approved) are stored as the string "true"/blank, not a real
                      // date/text value — always render+toggle as a checkbox, never
                      // the text/date editor their ColDef.type would otherwise imply.
                      if (canEdit && INV_BOOL_FIELDS.has(col.key)) {
                        const raw = (row as any)[col.key];
                        const checked = raw === true || raw === "true" || raw === "1" || raw === 1;
                        return (
                          <td key={col.key} className={cn("app-td text-center whitespace-nowrap", i === 0 && "app-td-sticky")}
                            style={i === 0 ? { position: "sticky", left: 0, zIndex: 30 } : undefined}>
                            <button type="button" title="Click to toggle"
                              onClick={(e) => { e.stopPropagation(); void commit(row, col.key, checked ? "" : "true"); }}
                              className="inline-flex cursor-pointer">
                              <CheckCircle2
                                className="h-5 w-5"
                                style={checked
                                  ? { fill: "#16a34a", stroke: "white", strokeWidth: 2 }
                                  : { fill: "transparent", stroke: "#d1d5db", strokeWidth: 1.5 }}
                              />
                            </button>
                          </td>
                        );
                      }
                      // Hovering the row shows every editable cell in it as a live
                      // control (Airtable-style); double-click still works as a
                      // fallback (also the only trigger for invoice_status, a
                      // multi-select whose full picker is too big to auto-open on hover).
                      if (canEdit && __kind === "single" && (isRowActive || isDblClicked)) {
                        return (
                          // !overflow-visible — app-td normally clips (for text truncation),
                          // which would crop the dropdown panel the instant it opens.
                          <td key={col.key} className={cn("app-td !overflow-visible relative", i === 0 && "app-td-sticky")}
                            style={{ zIndex: i === 0 ? 30 : 20, ...(i === 0 ? { position: "sticky", left: 0 } : {}) }}>
                            <HoverSelectCell
                              value={String((row as any)[col.key] ?? "")}
                              options={fieldOptions[col.key] ?? []}
                              pillStyle={(v) => invPillStyle(col.key, v)}
                              onCommit={(v) => commit(row, col.key, v)}
                            />
                          </td>
                        );
                      }
                      // Column 0 stays plain on hover (it hosts the hover-reveal "Open"
                      // shortcut below, not a live editor) — double-click still edits it.
                      if (canEdit && __kind && (isDblClicked || (isRowActive && __kind !== "pillMulti" && i !== 0))) {
                        return (
                          <EditableCell key={col.key} editing canEdit kind={__kind} autoFocus={isDblClicked}
                            value={String((row as any)[col.key] ?? "")}
                            options={col.key === "invoice_status" ? INVOICE_STATUS_OPTIONS : fieldOptions[col.key]}
                            className={cn("app-td", i === 0 && "app-td-sticky")}
                            style={i === 0 ? { position: "sticky", left: 0, zIndex: 30 } : undefined}
                            onCommit={(v) => commit(row, col.key, v)} onCancel={() => setEditCell(null)}
                          >{null}</EditableCell>
                        );
                      }
                      const __cell = (() => {
                      const isNum = col.type === "number";
                      let cls = "app-td" + (isNum ? " text-center tabular-nums whitespace-nowrap"
                        : WRAP_COLS.has(col.key) ? " whitespace-normal break-words text-center"
                        : " whitespace-nowrap text-center");
                      if (i === 0) cls += " app-td-sticky";

                      if (col.key === "forwarder") {
                        const raw = (row as any)[col.key];
                        if (!raw || raw === "") {
                          return (
                            <td key={col.key} className="app-td text-center whitespace-nowrap">
                              <span className="text-muted-foreground">—</span>
                            </td>
                          );
                        }
                        const { bg, text } = getForwarderColor(String(raw));
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

                      if (col.key === "vendor") {
                        const raw = (row as any)[col.key];
                        if (!raw || raw === "") {
                          return (
                            <td key={col.key} className="app-td text-center whitespace-nowrap">
                              <span className="text-muted-foreground">—</span>
                            </td>
                          );
                        }
                        const { bg, text } = getVendorColor(String(raw));
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

                      if (col.key === "country_of_origin" || col.key === "pol") {
                        const raw = (row as any)[col.key];
                        if (!raw || raw === "") {
                          return (
                            <td key={col.key} className="app-td text-center whitespace-nowrap">
                              <span className="text-muted-foreground">—</span>
                            </td>
                          );
                        }
                        const { bg, text } = col.key === "pol"
                          ? getPOLColor(String(raw))
                          : getCountryColor(String(raw));
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

                      if (col.key === "purchase_order") {
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
                          <td key={col.key} className="app-td">
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

                      if (col.key === "invoice_status" || col.key === "pmt_status_finance") {
                        const raw = (row as any)[col.key];
                        if (!raw || raw === "") {
                          return (
                            <td key={col.key} className="app-td text-center whitespace-nowrap">
                              <span className="text-muted-foreground">—</span>
                            </td>
                          );
                        }
                        const colorMap = col.key === "invoice_status" ? INVOICE_STATUS_COLORS : PMT_FINANCE_COLORS;
                        const parts = splitStatusValues(String(raw), colorMap);
                        return (
                          <td key={col.key} className="app-td text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              {parts.map((part, pi) => {
                                const { bg, text } = getStatusPillColor(colorMap, part);
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

                      if (col.key === "container_number") {
                        const nums = splitContainerNumbers((row as any)[col.key]);
                        return (
                          <td key={col.key} className="app-td text-center">
                            {nums.length === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-col items-center gap-0.5">
                                {nums.map((n, idx) => (
                                  <span key={idx} style={{
                                    backgroundColor: "#e9f5f5",
                                    color: "#0d5b5d",
                                    borderRadius: "9999px",
                                    padding: "2px 10px",
                                    fontWeight: 500,
                                    fontSize: "11px",
                                    display: "inline-block",
                                    letterSpacing: "0.02em",
                                    whiteSpace: "nowrap",
                                  }}>
                                    {n}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      }

                      // Pay Slip holds a file URL — show a short link, not the raw URL.
                      if (col.key === "pay_slip") {
                        const url = String((row as any)[col.key] ?? "").trim();
                        return (
                          <td key={col.key} className="app-td text-center">
                            {/^https?:\/\//i.test(url)
                              ? <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-primary hover:underline text-xs font-medium">📄 View</a>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                        );
                      }

                      const display = fmtCell(col.key, (row as any)[col.key]);
                      // Column 0 gets a hover-reveal "Open ›" shortcut alongside its
                      // own text (never replacing it) — Airtable's row-hover pattern.
                      if (i === 0 && isRowHovered) {
                        return (
                          <td key={col.key} className={cls} style={{ position: "sticky", left: 0, zIndex: 30 }}>
                            <div className="flex items-center justify-between gap-1.5">
                              <span className={WRAP_COLS.has(col.key) ? "min-w-0" : "truncate"} title={!WRAP_COLS.has(col.key) && display !== "—" ? display : undefined}>
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
                  const STAT_LABEL: Record<string, string> = { sum: "SUM", avg: "AVG", count: "COUNT", min: "MIN", max: "MAX" };
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
                    // Airtable-style per-group summary strip: every column gets a
                    // stat picker (Sum/Avg/Count/Min/Max); the computed value for
                    // THIS bucket's rows renders beside it. Choices persist with
                    // the view (tracker request: "statistic function when Group
                    // is enabled").
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

      {/* ── Pagination (hidden while grouped — groups render in full) ── */}
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

      <InvoiceFormDialog open={editOpen}  onOpenChange={closeEditModal}  row={editRow} onSave={handleSaveEdit} loading={editLoading}  title="Edit Invoice" layout={editLayout}
        onDelete={() => { setEditOpen(false); setDeleteRow(editRow); setDeleteOpen(true); }}
        opts={{
          vendor: filterOptions?.vendorOptions ?? [],
          forwarder: filterOptions?.forwarderOptions ?? [],
          country: filterOptions?.countryOptions ?? [],
          pol: filterOptions?.polOptions ?? [],
          pmtFinance: filterOptions?.pmtFinanceOptions ?? [],
          telex: filterOptions?.telexOptions ?? [],
        }} />
      <InvoiceAddForm
        open={addOpen}
        onOpenChange={setAddOpen}
        onSave={handleSaveAdd}
        loading={addLoading}
        forwarderOptions={forwarderOptions}
        vendorOptions={vendorOptions}
        countryOptions={countryOptions}
        containerOptions={containerOptions}
      />
      <DeleteRowDialog   open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={handleConfirmDelete} loading={deleteLoading} />
      {tabGroup && <OrderDashboardTabs group={tabGroup} activeTab="invoice" />}
    </div>
  );
}
