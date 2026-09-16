"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Card, cn } from "@/components/ui";
import { pesoExact, number, shortDate } from "@/lib/format";
import { ReceiptButton } from "@/components/receipt-button";
import { ReceiptBirButton } from "@/components/receipt-bir-button";
import { messengerLink, fbLinkLabel } from "@/lib/fb-link";
import { OrderRowActions } from "@/components/order-row-actions";
import { OrderQrButton } from "@/components/order-qr-button";
import { OrderImagesButton } from "@/components/order-images-button";
import { EmailLogButton } from "@/components/email-log-button";
import { Thumbnail } from "@/components/thumbnail";
import { ProductPreviewModal, type ProductPreview } from "@/components/product-preview-modal";
import { ExportButton } from "@/components/export-button";
import { EditOrderModal } from "@/components/edit-order-modal";
import { Modal } from "@/components/modal";
import { RushBadge } from "@/components/rush-badge";
import { DEFAULT_RUSH_DAYS } from "@/lib/rush";
import { DOWNPAYMENT_RATE } from "@/app/orders/downpayment";
import type { OrderRow, ProductRow } from "@/lib/supabase/server";

const PAGE_SIZES = [10, 25, 50, 100];

// "Request Edit" — para sa Sales & Service sa mga CONFIRMED na order: binubuksan
// ang Edit Order modal sa request mode (mag-e-edit sila ng form, tapos "Submit
// Edit Request" — Ops ang mag-a-Approve sa Requested Edit Order page).
// ISANG request lang bawat order — kapag nakapag-request na, ang cell ay pill
// na lang ng estado at hindi na muling makakapag-request:
//   pending → "Requested", approved → "✓ Approved", rejected → "✕ Rejected".
export type EditRequestStatus = "pending" | "approved" | "rejected";
function RequestEditButton({ order, isSalesOnly, reqStatus, onOpen }: { order: OrderRow; isSalesOnly: boolean; reqStatus?: EditRequestStatus; onOpen: () => void }) {
  const st = (order.status ?? "").trim();
  const confirmedForSales = st !== "" && !/^(pending|draft|awaiting|unpaid|cancel)/i.test(st);
  // May direktang edit pa sila (hindi pa confirmed, o hindi sila sales-only) —
  // walang kailangang i-request.
  if (!isSalesOnly || !confirmedForSales) return <span className="text-muted">—</span>;
  if (reqStatus === "pending") {
    return <span className="whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20" title="Waiting for Operations to approve or reject">Requested</span>;
  }
  if (reqStatus === "approved") {
    return <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20" title="Edit request approved and applied — only one request per order">✓ Approved</span>;
  }
  if (reqStatus === "rejected") {
    return <span className="whitespace-nowrap rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 ring-1 ring-inset ring-red-600/20" title="Edit request rejected by Operations — only one request per order">✕ Rejected</span>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="whitespace-nowrap rounded-lg border border-[#caa45a] bg-[#faf6ec] px-2.5 py-1 text-[11px] font-semibold text-[#4a3b1a] hover:bg-[#f4ead8]"
    >
      Request Edit
    </button>
  );
}

const EXPORT_COLUMNS = [
  { key: "order_number", label: "Order #" },
  { key: "date_order", label: "Date" },
  { key: "customer_name", label: "Customer" },
  { key: "contact_number", label: "Cellphone" },
  { key: "email", label: "Email" },
  { key: "address", label: "Address" },
  { key: "product_name", label: "Product" },
  { key: "sku", label: "SKU" },
  { key: "category", label: "Category" },
  { key: "color", label: "Color" },
  { key: "dimension", label: "Specification / Design Details" },
  { key: "downpayment_price", label: "Partial Payment" },
  { key: "partial_delivery_date", label: "Partial Dlvry Date" },
  { key: "partial_delivery_paid", label: "Partial Delivery" },
  { key: "full_payment", label: "Full Payment" },
  { key: "full_payment_price", label: "Total Amount" },
  { key: "balance", label: "Balance" },
  { key: "workshop_date", label: "Workshop" },
  { key: "date_of_delivery", label: "Delivery" },
  { key: "payment_status", label: "Payment Status" },
  { key: "progress_status", label: "Progress Status" },
  { key: "built_at", label: "Source" },
  { key: "assigned", label: "Assigned" },
];

// When a pipeline stage was actually reached (workshop dispatch / out-for-delivery /
// installation) — a short date, or "—" if the order hasn't hit that stage yet.
// PLANNED FALLBACK (2026-08-24): bago pa marating ang yugto, ang petsang
// itinakda sa order mismo (Workshop Date / Delivery Date, na siya ring Rush
// deadline) ang ipinapakita — naka-italic at may tooltip na "planned", para
// malinaw na target pa lang ito at hindi pa nangyayari.
function stageDate(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return shortDate(ts);
}
function StageCell({ actual, planned }: { actual: string | null | undefined; planned: string | null | undefined }) {
  const done = stageDate(actual);
  if (done !== "—") return <span title="Actual — this stage happened on this date">{done}</span>;
  const plan = stageDate(planned);
  if (plan === "—") return <span>—</span>;
  return <span className="italic text-muted/80" title="Planned — scheduled on the order; not reached yet">{plan}</span>;
}

// PAYMENT status — derived purely from the money (not the mixed order.status),
// so it never disagrees with the actual figures.
function paymentStatus(r: OrderRow): string {
  const total = Number(r.full_payment_price) || 0;
  const paid = (Number(r.downpayment_price) || 0) + (Number(r.full_payment) || 0);
  if (total <= 0) return "Unpaid";
  if (paid <= 0) return "Unpaid";
  if (paid + 0.01 >= total) return "Fully Paid";
  return "Partial";
}
// KULANG SA HINIHINGING DOWNPAYMENT (2026-08-29). Ang stock ay nakalaan na sa
// sandaling may bayad (tingnan ang meetsDownpayment) — hindi ito harang. Pero ang
// hinihingi pa rin sa customer ay DOWNPAYMENT_RATE ng kabuuan, at kapag nadagdagan
// ng item ang order, tahimik na lumalaki ang kulang. Ipakita ang natitira para
// makita ng Sales kung magkano pa ang sisingilin.
function downpaymentShortfall(r: OrderRow): number {
  const total = Number(r.full_payment_price) || 0;
  const paid = (Number(r.downpayment_price) || 0) + (Number(r.full_payment) || 0);
  if (total <= 0 || paid <= 0) return 0; // walang kabuuan, o wala pang bayad
  return Math.max(total * DOWNPAYMENT_RATE - paid, 0);
}
function paymentPill(value: string): string {
  const s = value.toLowerCase();
  if (/fully paid/.test(s)) return "bg-green-50 text-green-700 ring-green-600/20";
  if (/partial/.test(s)) return "bg-blue-50 text-blue-700 ring-blue-600/20";
  return "bg-amber-50 text-amber-700 ring-amber-600/20"; // Unpaid
}
// PROGRESS status — the pipeline stage. delStatus already carries the resolved
// furthest stage (In Workshop / For Delivery / Out for Delivery / Arrived /
// Installation / Delivered) when the order has entered the pipeline. When it
// hasn't, the stage depends on payment: an order isn't "Confirmed" until a
// downpayment lands — before that it's "Awaiting Payment". order.status is often
// a bare payment word here, so we drive off the derived pay state, not that text.
function progressStatus(r: OrderRow, delStatus: string | undefined): string {
  // PARTIAL DELIVERY (0200): may naihatid na, may natitira — ang deliveries row
  // ay "Delivered" na ng naunang batch, pero bukas pa ang order. Ang status ng
  // order ang totoo rito, hindi ang overlay.
  if (/partial delivery/i.test(r.status ?? "")) return "Partial Delivery";
  if (delStatus) return delStatus;
  const orderStatus = (r.status ?? "").trim();
  if (/cancel/i.test(orderStatus)) return "Cancelled";
  // A real progress word already on the order (not a payment word) wins.
  // Legacy raw "For Delivery" (sine-set ng QC ship) = nasa Delivery Queue pool.
  if (/^for delivery$/i.test(orderStatus)) return "For Scheduling";
  if (orderStatus && !/^(completed|partial|pending|paid|unpaid|draft)$/i.test(orderStatus)) return orderStatus;
  // No pipeline row and only a payment word: gate on money. No payment = not yet
  // confirmed; any payment = Confirmed (order placed, awaiting workshop).
  return paymentStatus(r) === "Unpaid" ? "Awaiting Payment" : "Confirmed";
}
function progressPill(value: string): string {
  const s = value.toLowerCase();
  if (/partial delivery/.test(s)) return "bg-amber-50 text-amber-700 ring-amber-600/20";
  if (/delivered/.test(s)) return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (/install/.test(s)) return "bg-cyan-50 text-cyan-700 ring-cyan-600/20";
  if (/arrived/.test(s)) return "bg-teal-50 text-teal-700 ring-teal-600/20";
  if (/out for delivery/.test(s)) return "bg-sky-50 text-sky-700 ring-sky-600/20";
  if (/packed/.test(s)) return "bg-lime-50 text-lime-700 ring-lime-600/20";
  if (/scheduled/.test(s)) return "bg-purple-50 text-purple-700 ring-purple-600/20";
  if (/awaiting confirm/.test(s)) return "bg-amber-50 text-amber-700 ring-amber-600/20";
  if (/booked/.test(s)) return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (/reminded/.test(s)) return "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20";
  if (/for delivery|for scheduling/.test(s)) return "bg-violet-50 text-violet-700 ring-violet-600/20";
  if (/quality control|qc/.test(s)) return "bg-indigo-50 text-indigo-700 ring-indigo-600/20";
  if (/workshop|process/.test(s)) return "bg-amber-50 text-amber-700 ring-amber-600/20";
  if (/awaiting payment/.test(s)) return "bg-rose-50 text-rose-700 ring-rose-600/20";
  if (/confirmed/.test(s)) return "bg-stone-100 text-stone-600 ring-stone-400/30";
  if (/redelivered/.test(s)) return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (/rework/.test(s)) return "bg-orange-50 text-orange-700 ring-orange-600/20";
  if (/cancel|return/.test(s)) return "bg-red-50 text-red-700 ring-red-600/20";
  return "bg-stone-100 text-stone-600 ring-stone-400/30";
}

const TH = "px-4 py-3 font-medium whitespace-nowrap text-center";
const TD = "px-4 py-3 whitespace-nowrap text-center";
const BD = "!border-l-4 !border-l-[#caa45a]";

// Pagkakasunod ng pipeline — dito nakabatay ang ayos ng filter chips.
const PROGRESS_ORDER = [
  "Awaiting Payment", "Confirmed", "Processing", "In Workshop", "Quality Control",
  "For Delivery", "For Scheduling", "Awaiting Confirm", "Booked", "Scheduled", "Reminded",
  "Packed", "Out for Delivery", "Arrived",
  "Installation", "Delivered", "Rework", "Redelivered", "Completed", "Cancelled",
];

// Robust: handles a full timestamp (timestamptz) OR a bare time string.
function fmtDateTime(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v.slice(0, 5) : shortDate(v);
}

export function OrdersTable({ rows, products = [], paymentQr = "", mayaEnabled = false, assignees = [], constructors = [], deliveryStatus = {}, builtAt = {}, stageDates = {}, canEditWorkshop = false, isSalesOnly = false, rushThreshold = DEFAULT_RUSH_DAYS, editRequests = {}, reworkTags = {}, silent = false, quoteImages = {}, designImages = {}, collectorName = "" }: { rows: OrderRow[]; products?: ProductRow[]; paymentQr?: string; mayaEnabled?: boolean; assignees?: { name: string; role?: string }[]; constructors?: { name: string; role: string }[]; deliveryStatus?: Record<number, string>; builtAt?: Record<number, string>; stageDates?: Record<number, { workshop: string | null; delivery: string | null; installation: string | null }>; canEditWorkshop?: boolean; isSalesOnly?: boolean; rushThreshold?: number; editRequests?: Record<number, EditRequestStatus>; reworkTags?: Record<number, string | null>; silent?: boolean; quoteImages?: Record<string, { url: string; fq: string | null }[]>; designImages?: Record<string, string[]>; collectorName?: string }) {
  // Index products once (by lowercased SKU + exact name) so lookups are O(1)
  // instead of an O(products) scan per order row on every keystroke/render.
  const prodIndex = useMemo(() => {
    const bySku = new Map<string, ProductRow>();
    const byName = new Map<string, ProductRow>();
    for (const p of products) {
      if (p.sku) bySku.set(p.sku.toLowerCase(), p);
      const n = (p.product_name ?? "").toLowerCase();
      if (n && !byName.has(n)) byName.set(n, p);
    }
    return { bySku, byName };
  }, [products]);

  // Fuzzy fallback (startsWith/includes) — only runs when there's no exact match.
  const fuzzyByName = useCallback((name: string): ProductRow | null =>
    products.find((p) => {
      const n = (p.product_name ?? "").toLowerCase();
      return n && (name.startsWith(n) || n.startsWith(name) || name.includes(n) || n.includes(name));
    }) ?? null, [products]);

  // Resolve a product image for an order row (by SKU, then by name).
  const imageFor = useCallback((r: OrderRow): string | null => {
    if (r.sku) {
      const p = prodIndex.bySku.get(r.sku.toLowerCase());
      if (p?.image_url) return p.image_url;
    }
    const name = (r.product_name ?? "").toLowerCase().replace(/\s*\(\+\d+ more\)$/, "").trim();
    if (!name) return null;
    const p = prodIndex.byName.get(name) ?? fuzzyByName(name);
    return p?.image_url ?? null;
  }, [prodIndex, fuzzyByName]);

  // Match a product by a description's first line.
  const matchByName = useCallback((firstLine: string): ProductRow | null => {
    const fl = firstLine.trim().toLowerCase();
    if (!fl) return null;
    return prodIndex.byName.get(fl) ?? fuzzyByName(fl);
  }, [prodIndex, fuzzyByName]);

  // One display line per receipt item (else a single line from the order's product).
  type Line = { name: string; qty: number; sku: string | null; category: string | null; color: string | null; dimension: string | null; image: string | null; customized?: boolean; imported?: boolean; specs?: string | null };
  const itemLines = useCallback((r: OrderRow): Line[] => {
    if (r.receipt_items && r.receipt_items.length) {
      // Ang mga FEE (Shipping/Rush at "Addtl." variants) ay singil, hindi
      // produkto — huwag ipakita bilang sariling product row. Nananatili sila
      // sa receipt_items para buo pa rin ang receipt total at ang tracker.
      const products = r.receipt_items.filter(
        (it) => !/^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test((it.description ?? "").split("\n")[0].trim()),
      );
      const source = products.length ? products : r.receipt_items;
      return source.map((it) => {
        const allLines = (it.description ?? "").split("\n").map((l) => l.trim());
        const firstLine = allLines[0] ?? "";
        // Ang natitirang linya ng description = spec bullets (bagong format) —
        // ipinapasa sa Product Details preview.
        const specLines = allLines.slice(1).filter(Boolean).map((l) => l.replace(/^[•·\-\s]+/, ""));
        const p = matchByName(firstLine);
        // Imported: prefer the saved flag on the receipt item, else the matched product's type.
        const imported = (it as { imported?: boolean }).imported ?? ((p?.product_type ?? "").toLowerCase() === "imported");
        return {
          name: firstLine || p?.product_name || "—",
          qty: Number(it.qty) || 1,
          sku: it.sku ?? p?.sku ?? null,
          category: it.category ?? p?.category ?? null,
          color: it.color ?? p?.color ?? null,
          dimension: it.dimension ?? p?.dimension ?? null,
          image: it.image ?? p?.image_url ?? null,
          specs: specLines.length ? specLines.join("\n") : (p?.specs ?? null),
          customized: !!it.customized,
          imported,
        };
      });
    }
    return [{
      name: r.product_name ?? "—",
      qty: 1,
      sku: r.sku ?? null,
      category: r.category ?? null,
      color: r.color ?? null,
      dimension: r.dimension ?? null,
      image: imageFor(r),
    }];
  }, [matchByName, imageFor]);

  // Quotation / Design viewer — MULTI-PAGE na (2026-08-19): lahat ng design
  // sheets ng order, magkakasunod pababa (PDF o image).
  const [viewDoc, setViewDoc] = useState<{ urls: string[]; title: string } | null>(null);
  // QUOTATION SUMMARY — binubuo sa pagpindot, kaya hindi kailanman luma.
  const [summaryFor, setSummaryFor] = useState<number | null>(null);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);

  // Itinatago ang nabuo nang summary habang bukas ang pahina. Ang dokumento ay
  // binubuo mula sa receipt_items, kaya ang muling pagtingin sa parehong order
  // ay dapat agad — ang unang pagbuo ang mabigat (hinahatak at ini-embed ang
  // litrato ng bawat produkto).
  const summaryCache = useRef<Record<number, { url: string; fqs: string[] }>>({});

  // Sinisimulan sa hover: umaabot ng ilang daang milliseconds ang paglalakbay
  // ng mouse papunta sa buton, at doon kasya ang pagbuo. Isa lang ang tumatakbo
  // — hindi ito nagdadagdag ng pasanin kapag dumaan lang ang cursor sa hanay.
  const priming = useRef<Set<number>>(new Set());
  async function primeSummary(r: OrderRow) {
    if (summaryCache.current[r.id] || priming.current.has(r.id)) return;
    priming.current.add(r.id);
    try {
      const { buildOrderSummary } = await import("@/app/quotations/actions");
      const res = await buildOrderSummary(r.id);
      if (!("error" in res)) summaryCache.current[r.id] = { url: res.url, fqs: res.fqs };
    } catch { /* ang pindot mismo ang magpapakita ng tunay na error */ }
    finally { priming.current.delete(r.id); }
  }

  async function openSummary(r: OrderRow) {
    const hit = summaryCache.current[r.id];
    if (hit) {
      setViewDoc({ urls: [hit.url], title: `Quotation Summary — ${r.order_number ?? ""}${hit.fqs.length ? ` · ${hit.fqs.join(", ")}` : ""}` });
      return;
    }
    setSummaryFor(r.id);
    setSummaryErr(null);
    const { buildOrderSummary } = await import("@/app/quotations/actions");
    const res = await buildOrderSummary(r.id);
    setSummaryFor(null);
    if ("error" in res) { setSummaryErr(res.error); return; }
    summaryCache.current[r.id] = { url: res.url, fqs: res.fqs };
    setViewDoc({
      urls: [res.url],
      title: `Quotation Summary — ${r.order_number ?? ""}${res.fqs.length ? ` · ${res.fqs.join(", ")}` : ""}`,
    });
  }
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  // Payment tabs — hiwalay ang mga WALANG kahit anong bayad (Awaiting Payment):
  // para silang leads pa lang, hindi dapat kahalo ng nasa production pipeline.
  const [payFilter, setPayFilter] = useState<"all" | "Unpaid" | "Partial" | "Fully Paid">("all");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<ProductPreview | null>(null);
  // Ang order na binuksan para i-edit (pag-click ng hilera).
  const [editing, setEditing] = useState<OrderRow | null>(null);
  // Totoo lang kapag binuksan via "Request Edit" button — ang row click ng
  // sales sa confirmed ay VIEW ONLY; sa button lang ang request-edit form.
  const [editingRequest, setEditingRequest] = useState(false);
  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Ang chips at filter ay sa DERIVED progress status (ung mismong pill na
  // nakikita sa Progress Status column) — hindi sa hilaw na r.status. Ang
  // r.status ay madalas naiiwan sa "For Delivery" kahit Delivered na sa
  // pipeline, kaya hindi tugma ang filter sa nakikita.
  const statuses = useMemo(() => {
    const found = new Set(rows.map((r) => progressStatus(r, deliveryStatus[r.id])));
    return Array.from(found).sort((a, b) => {
      const ia = PROGRESS_ORDER.indexOf(a);
      const ib = PROGRESS_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [rows, deliveryStatus]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const matchQ =
        !q ||
        r.order_number?.toLowerCase().includes(q) ||
        r.customer_name?.toLowerCase().includes(q) ||
        r.product_name?.toLowerCase().includes(q) ||
        r.sku?.toLowerCase().includes(q);
      const matchS = status === "all" || progressStatus(r, deliveryStatus[r.id]) === status;
      const matchP = payFilter === "all" || paymentStatus(r) === payFilter;
      return matchQ && matchS && matchP;
    });
  }, [rows, query, status, payFilter, deliveryStatus]);

  // Bilang bawat payment tab (buong table, hindi apektado ng ibang filter).
  const payCounts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, Unpaid: 0, Partial: 0, "Fully Paid": 0 };
    for (const r of rows) c[paymentStatus(r)] = (c[paymentStatus(r)] ?? 0) + 1;
    return c;
  }, [rows]);

  // Export the filtered set, one row per order (primary product line).
  const exportRows = useMemo(
    () =>
      filtered.map((r) => ({
        order_number: r.order_number,
        date_order: r.date_order,
        customer_name: r.customer_name,
        contact_number: r.contact_number,
        email: r.email,
        fb_name: r.fb_name,
        fb_link: r.fb_link,
        address: r.address,
        product_name: r.product_name,
        sku: r.sku,
        category: r.category,
        color: r.color,
        // Katulad ng hanay: ang piniling build, hindi ang blangkong dimension.
        // Isang hilera kada order ang export, kaya pinagsasama ang lahat ng linya.
        dimension: itemLines(r).map((l) => (l.specs ?? "").split("\n").map((x) => x.trim()).filter(Boolean).join(" · ") || l.dimension || "").filter(Boolean).join(" | ") || r.dimension,
        downpayment_price: r.downpayment_price,
        // Kapareho ng hanay sa table: ang partial-trip na koleksyon ay hiwalay,
        // at ang Full Payment ay ang natitira matapos ito ibawas.
        partial_delivery_date: (r as OrderRow & { partial_delivery_date?: string | null }).partial_delivery_date ?? null,
        partial_delivery_paid: (Number((r as OrderRow & { partial_delivery_paid?: number }).partial_delivery_paid) || 0) || null,
        full_payment: r.full_payment != null
          ? Math.max(Math.round(((Number(r.full_payment) || 0) - (Number((r as OrderRow & { partial_delivery_paid?: number }).partial_delivery_paid) || 0)) * 100) / 100, 0)
          : r.full_payment,
        full_payment_price: r.full_payment_price,
        balance: Math.max(Math.round(((Number(r.full_payment_price) || 0) - ((Number(r.downpayment_price) || 0) + (Number(r.full_payment) || 0))) * 100) / 100, 0),
        workshop_date: r.workshop_date,
        date_of_delivery: r.date_of_delivery,
        payment_status: paymentStatus(r),
        progress_status: progressStatus(r, deliveryStatus[r.id]),
        built_at: builtAt[r.id] ?? "",
        assigned: r.assigned,
      })),
    [filtered, deliveryStatus, itemLines, builtAt],
  );

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount - 1);
  const start = current * pageSize;
  const slice = filtered.slice(start, start + pageSize);
  const from = total === 0 ? 0 : start + 1;
  const to = Math.min(start + pageSize, total);

  return (
    <div className="space-y-4">
      {/* Filters — search + progress chips + payment tabs, iisang row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          placeholder="Search order #, customer, product, SKU…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-2">
          <Chip active={status === "all"} onClick={() => { setStatus("all"); setPage(0); }}>All</Chip>
          {statuses.map((s) => (
            <Chip key={s} active={status === s} onClick={() => { setStatus(s); setPage(0); }}>{s}</Chip>
          ))}
        </div>
        {/* Payment tabs — hiwalay ang mga walang bayad pa (Awaiting Payment) */}
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-stone-50/60 p-0.5 sm:ml-auto">
          {([
            ["all", "All"],
            ["Unpaid", "Awaiting Payment"],
            ["Partial", "Partial"],
            ["Fully Paid", "Fully Paid"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setPayFilter(key); setPage(0); }}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-colors",
                payFilter === key ? "bg-[#4a3b1a] text-[#f4ead8] shadow-sm" : "text-muted hover:bg-white hover:text-foreground",
              )}
            >
              {label}
              <span className={cn(
                "inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
                payFilter === key ? "bg-[#caa45a] text-[#3a2e12]"
                  : key === "Unpaid" && (payCounts[key] ?? 0) > 0 ? "bg-rose-100 text-rose-700"
                  : "bg-stone-200 text-stone-600",
              )}>{payCounts[key] ?? 0}</span>
            </button>
          ))}
        </div>
        <ExportButton filename="orders" columns={EXPORT_COLUMNS} rows={exportRows} />
      </div>

      <Card className="overflow-hidden">
        {/* Kung hindi nabuo ang summary, dapat may makita — kung hindi, ang
            pindot ay parang walang nangyari. */}
        {summaryErr && (
          <p className="flex items-center gap-2 border-b border-[#f0c9c9] bg-[#fdecec] px-4 py-2 text-xs font-semibold text-[#9b2c2c]">
            {summaryErr}
            <button type="button" onClick={() => setSummaryErr(null)} className="ml-auto text-[#9b2c2c]/70 hover:text-[#9b2c2c]">✕</button>
          </p>
        )}
        <div className="max-h-[60vh] overflow-auto rounded-t-xl pf-scroll">
          <table className="w-full min-w-[3300px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
            {/* Sakto sa colSpan ng pangkat sa ibaba — kapag hindi, may
                puting siwang sa dulo ng bar (tingnan ang header test). Ang
                Payment (6) at ang Status ay dating mali rito. */}
            <colgroup>
              <col span={8} />
              <col span={5} />
              <col span={8} />
              <col span={3} />
              <col span={isSalesOnly ? 10 : 11} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
                <th colSpan={8} className="border-b border-[#caa45a] px-4 py-2">Order Information</th>
                <th colSpan={5} className={cn("border-b border-[#caa45a] px-4 py-2", BD)}>Product</th>
                <th colSpan={8} className={cn("border-b border-[#caa45a] px-4 py-2", BD)}>Payment</th>
                <th colSpan={3} className={cn("border-b border-[#caa45a] px-4 py-2", BD)}>Schedule</th>
                {/* Sales & Service: tago ang Actions column (Request Edit flow ang gamit nila). */}
                <th colSpan={isSalesOnly ? 10 : 11} className={cn("border-b border-[#caa45a] px-4 py-2", BD)}>Status</th>
              </tr>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
                <th className={TH}>Order #</th>
                <th className={TH}>Date</th>
                <th className={TH}>Customer</th>
                <th className={TH}>Cellphone</th>
                <th className={TH}>Email</th>
                <th className={TH}>Facebook</th>
                <th className={TH}>Source</th>
                <th className={TH}>Address</th>
                <th className={cn(TH, BD)}>Product</th>
                <th className={TH}>SKU</th>
                <th className={TH}>Category</th>
                <th className={TH}>Color</th>
                <th className={TH}>Specification / Design Details</th>
                <th className={cn(TH, BD)}>Downpmt Date</th>
                <th className={TH}>Partial Payment</th>
                <th className={TH}>Partial Dlvry Date</th>
                <th className={TH}>Partial Delivery</th>
                <th className={TH}>Full Pmt Date</th>
                <th className={TH}>Full Payment</th>
                <th className={TH}>Total Amount</th>
                <th className={TH}>Balance</th>
                <th className={cn(TH, BD)}>Workshop</th>
                <th className={TH}>Delivery</th>
                <th className={TH}>Installation</th>
                <th className={cn(TH, BD)}>Payment Status</th>
                <th className={TH}>Progress Status</th>
                {/* SOURCE = SAAN GINAWA (2026-08-26). Ang Source sa Order
                    Information ay bangko (BDO/GCash); ito ang pinaggawaan:
                    pangalan ng workshop, o Warehouse. */}
                <th className={TH}>Source</th>
                <th className={TH}>Assigned</th>
                {/* IISANG Receipt column na (2026-08-17): ang BIR Acknowledgment
                    Receipt ang laman; tinanggal ang lumang receipt at ang QR
                    button. */}
                <th className={cn(TH, "text-center")}>Receipt</th>
                {/* Ang bawat FQ ay hiwalay sa Quotation; ang Summary ay ang
                    buong laman ng order ngayon — iyon ang ipinapadala kapag
                    may naidagdag. */}
                <th className={cn(TH, "text-center")}>Quote Summary</th>
                <th className={cn(TH, "text-center")}>Quotation</th>
                <th className={cn(TH, "text-center")}>Design</th>
                <th className={cn(TH, "text-center")}>Images</th>
                <th className={cn(TH, "text-center")}>Request</th>
                {!isSalesOnly && <th className={cn(TH, "text-center")}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {slice.flatMap((r) => {
                const all = itemLines(r);
                const open = expanded.has(r.id);
                const lines = open ? all : all.slice(0, 1);
                const n = lines.length;
                const extra = all.length - 1;
                return lines.map((line, idx) => (
                  <tr key={`${r.id}-${idx}`} onClick={() => { setEditingRequest(false); setEditing(r); }} className="cursor-pointer border-b border-border hover:bg-stone-50" title="Click to edit this order">
                    {idx === 0 && (
                      <>
                        <td rowSpan={n} className={cn(TD, "font-mono text-xs font-medium")}><div className="flex flex-col items-center gap-1">{r.is_rush && <RushBadge isRush dateOrder={r.date_order} threshold={r.rush_days ?? rushThreshold} done={/delivered|completed/i.test(progressStatus(r, deliveryStatus[r.id]))} />}{r.id in reworkTags && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-200">Rework{reworkTags[r.id] ? ` · ${reworkTags[r.id]}` : ""}</span>}<span>{r.order_number ?? "—"}</span></div></td>
                        <td rowSpan={n} className={cn(TD, "text-muted")}>{r.date_order ? shortDate(r.date_order) : "—"}</td>
                        <td rowSpan={n} className={TD}>{r.customer_name ?? "—"}</td>
                        <td rowSpan={n} className={cn(TD, "text-muted")}>{r.contact_number ?? "—"}</td>
                        <td rowSpan={n} className="max-w-[200px] truncate px-4 py-3 text-center text-muted" title={r.email ?? undefined}>{r.email ?? "—"}</td>
                        <td rowSpan={n} className="max-w-[200px] px-4 py-3 text-center text-muted" title={r.fb_name ?? undefined}>
                          {r.fb_name ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="max-w-full truncate font-medium text-foreground">{r.fb_name}</span>
                              {r.fb_link && (
                                <span className="flex items-center gap-2">
                                  <a href={r.fb_link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-xs font-medium text-info hover:underline">{fbLinkLabel(r.fb_link)}</a>
                                  {messengerLink(r.fb_link) && (
                                    <a href={messengerLink(r.fb_link)!} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-xs font-medium text-info hover:underline">Messenger</a>
                                  )}
                                </span>
                              )}
                            </div>
                          ) : "—"}
                        </td>
                        <td rowSpan={n} className={cn(TD, "text-muted")}>{r.Source ?? "—"}</td>
                        <td rowSpan={n} className="max-w-[220px] truncate px-4 py-3 text-center text-muted" title={r.address ?? undefined}>{r.address ?? "—"}</td>
                      </>
                    )}

                    {/* Product — collapsed to first item; expand to see all */}
                    <td className={cn("px-4 py-3", BD)}>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setPreview({ image_url: line.image, name: line.name, sku: line.sku, category: line.category, color: line.color, dimension: line.dimension, specs: line.specs, qty: line.qty, order_number: r.order_number }); }} title="View product details" className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-primary">
                          <Thumbnail name={line.name} url={line.image} />
                          {/* ISANG LINYA (2026-08-26) — ang Local/Imported na
                              badge ay dating nasa sariling linya sa ibabaw ng
                              pangalan, kaya dalawang linya ang taas ng BAWAT
                              hilera ng table. Katabi na ng pangalan. */}
                          <span className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap">
                            {line.customized && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Customized</span>}
                            {line.imported
                              ? <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Imported</span>
                              : <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Local</span>}
                            <span className="min-w-0 flex-1 truncate font-medium" title={line.name}>
                              <span className="mr-1 rounded bg-stone-100 px-1 text-[11px] font-bold tabular-nums text-stone-600">{line.qty}×</span>
                              {line.name}
                            </span>
                          </span>
                        </button>
                        {idx === 0 && extra > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggle(r.id); }}
                            className="ml-auto shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600 hover:bg-stone-200"
                          >
                            {open ? "▲ less" : `▾ +${extra} more`}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={cn(TD, "font-mono text-xs text-muted")}>{line.sku ?? "—"}</td>
                    <td className={TD}>{line.category ?? "—"}</td>
                    <td className={TD}>{line.color ?? "—"}</td>
                    {/* SPECIFICATION / DESIGN DETAILS (2026-08-26) — ang hanay
                        ay dating Dimension, at ang dimension ng katalogo ay
                        halos laging blangko: pitong hilera ng gitling. Ang
                        piniling build ng order ang laman nito (tingnan ang
                        specLines sa itemLines), at ang dimension ang pambalik
                        para sa lumang stock na walang bullets.

                        BULLET ANG PAGITAN, HINDI TULDOK: ang tuldok ay nasa
                        LOOB na ng ilang spec ("Foam Type: Certified Comfort
                        Foam · Polycotton Cover"), kaya ang paggamit nito
                        bilang pagitan ay hindi na mabasa kung saan nagtatapos
                        ang isa. Isang linya lang din — ang buong listahan ay
                        nasa tooltip at sa Product Details. */}
                    <td className={cn(TD, "text-muted")}>
                      {(() => {
                        const lines = (line.specs ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
                        if (!lines.length) return <span>{line.dimension ?? "—"}</span>;
                        return (
                          <span className="mx-auto block max-w-[240px] truncate text-left" title={lines.join("\n")}>
                            {lines.map((l, i) => (
                              <span key={i}>
                                {i > 0 && <span className="px-1 text-[#caa45a]">•</span>}
                                {l}
                              </span>
                            ))}
                          </span>
                        );
                      })()}
                    </td>

                    {idx === 0 && (
                      <>
                        <td rowSpan={n} className={cn(TD, "text-muted", BD)}>{r.date_downpayment ? shortDate(r.date_downpayment) : "—"}</td>
                        <td rowSpan={n} className={TD}>{r.downpayment_price != null ? pesoExact(Number(r.downpayment_price)) : "—"}</td>
                        {(() => {
                          // PARTIAL DELIVERY na koleksyon (2026-09-02): ang bayad ng mga
                          // partial na biyahe, hiwalay sa huling bayad — ang Full Payment
                          // ay ang natitira lang matapos ibawas ito.
                          const rx = r as OrderRow & { partial_delivery_paid?: number; partial_delivery_date?: string | null };
                          const pp = Number(rx.partial_delivery_paid) || 0;
                          const fp = Math.max(Math.round(((Number(r.full_payment) || 0) - pp) * 100) / 100, 0);
                          return (
                            <>
                              <td rowSpan={n} className={cn(TD, "text-muted")}>{pp > 0 && rx.partial_delivery_date ? fmtDateTime(rx.partial_delivery_date) : "—"}</td>
                              <td rowSpan={n} className={cn(TD, pp > 0 ? "text-[#8a6a1f] font-semibold" : "text-muted")}>{pp > 0 ? pesoExact(pp) : "—"}</td>
                              <td rowSpan={n} className={cn(TD, "text-muted")}>{fmtDateTime(r.full_payment_date)}</td>
                              <td rowSpan={n} className={TD}>{r.full_payment != null && fp > 0 ? pesoExact(fp) : "—"}</td>
                            </>
                          );
                        })()}
                        <td rowSpan={n} className={cn(TD, "font-semibold")}>{r.full_payment_price != null ? pesoExact(Number(r.full_payment_price)) : "—"}</td>
                        {(() => {
                          const total = Number(r.full_payment_price) || 0;
                          const paid = (Number(r.downpayment_price) || 0) + (Number(r.full_payment) || 0);
                          const bal = Math.max(Math.round((total - paid) * 100) / 100, 0);
                          return <td rowSpan={n} className={cn(TD, "font-semibold", total > 0 && bal === 0 ? "text-green-700" : bal > 0 ? "text-amber-700" : "text-muted")}>{total > 0 ? pesoExact(bal) : "—"}</td>;
                        })()}
                        <td rowSpan={n} className={cn(TD, "text-muted", BD)}><StageCell actual={stageDates[r.id]?.workshop} planned={r.workshop_date} /></td>
                        <td rowSpan={n} className={cn(TD, "text-muted")}><StageCell actual={stageDates[r.id]?.delivery} planned={r.date_of_delivery} /></td>
                        <td rowSpan={n} className={cn(TD, "text-muted")}>{stageDate(stageDates[r.id]?.installation)}</td>
                        <td rowSpan={n} className={cn(TD, BD)}>
                          {(() => {
                            const ps = paymentStatus(r);
                            const short = ps === "Partial" ? downpaymentShortfall(r) : 0;
                            return (
                              <div className="flex flex-col items-center gap-1">
                                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", paymentPill(ps))}>{ps}</span>
                                {short > 0 && (
                                  <span
                                    className="text-[11px] font-medium text-amber-700"
                                    title={`Stock is already held for this customer. ${pesoExact(short)} more brings the order up to its ${Math.round(DOWNPAYMENT_RATE * 100)}% downpayment.`}
                                  >
                                    {pesoExact(short)} to collect
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td rowSpan={n} className={TD}>
                          {(() => { const eff = progressStatus(r, deliveryStatus[r.id]); return eff ? <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", progressPill(eff))}>{eff}</span> : "—"; })()}
                        </td>
                        {/* SOURCE = SAAN GINAWA. Ang Warehouse ay isa ring
                            hilera sa workshop table, kaya walang espesyal na
                            kaso — pero ibang kulay para makilala agad kung
                            galing sa bodega o sa isang workshop. */}
                        {/* Ang builtAt ay napupunan lang pagkatapos ng Order
                            Approval (skip → Warehouse, assign → workshop) —
                            bago niyon, gitling: wala pang pinagmulan. */}
                        <td rowSpan={n} className={TD}>
                          {builtAt[r.id]
                            ? <span className={cn(
                                "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                                /warehouse/i.test(builtAt[r.id]) ? "bg-stone-100 text-stone-700 ring-stone-600/20" : "bg-[#faf6ec] text-[#4a3b1a] ring-[#caa45a]/40",
                              )}>{builtAt[r.id]}</span>
                            : <span className="text-muted">—</span>}
                        </td>
                        <td rowSpan={n} className={cn(TD, "text-muted")}>{r.assigned ?? "—"}</td>
                        <td rowSpan={n} className={TD} onClick={(e) => e.stopPropagation()}><div className="flex justify-center"><ReceiptBirButton order={r} /></div></td>
                        <td rowSpan={n} className={TD} onClick={(e) => e.stopPropagation()}><div className="flex justify-center"><button type="button" onClick={() => void openSummary(r)} onMouseEnter={() => void primeSummary(r)} onFocus={() => void primeSummary(r)} disabled={summaryFor === r.id} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-[#faf6ec] hover:text-[#4a3b1a] disabled:opacity-40" title="Build the summary of everything on this order — this is what you send after adding items">{summaryFor === r.id ? (<span className="text-[9px] font-bold">…</span>) : (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M8 9h2"/></svg>)}</button></div></td><td rowSpan={n} className={TD} onClick={(e) => e.stopPropagation()}><div className="flex justify-center">{(quoteImages[(r.order_number ?? "").trim()] ?? []).length ? (<button type="button" onClick={() => setViewDoc({ urls: (quoteImages[(r.order_number ?? "").trim()] ?? []).map((q) => q.url), title: "Quotation — " + (r.order_number ?? "") })} className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-[#faf6ec] hover:text-[#4a3b1a]" title={"View the quotations: " + (quoteImages[(r.order_number ?? "").trim()] ?? []).map((q) => q.fq ?? "FQ").join(", ")}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>{(quoteImages[(r.order_number ?? "").trim()] ?? []).length > 1 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#4a3b1a] px-1 text-[9px] font-bold text-[#f4ead8]">{quoteImages[(r.order_number ?? "").trim()].length}</span>}</button>) : (<span className="text-xs text-muted/50">—</span>)}</div></td>
                        </>
                    )}

                    {/* ANG DESIGN SHEET AY PER-PRODUKTO, HINDI PER-ORDER
                        (2026-08-26) — kaya wala itong rowSpan at nasa labas ng
                        blokeng {idx === 0}: bawat linya ang may sariling cell,
                        at ang sheet ay lumalabas LANG sa produktong pinaglakipan.
                        Dating naka-key sa order number lang, kaya ang isang
                        disenyo ay lumilitaw sa lahat ng item ng order. */}
                    {(() => {
                      const sku = (line.sku ?? "").trim().toUpperCase();
                      const ord = (r.order_number ?? "").trim();
                      const urls = designImages[sku ? `${ord}|${sku}` : ord] ?? designImages[ord] ?? [];
                      return (
                        <td className={TD} onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-center">
                            {urls.length ? (
                              <button type="button" onClick={() => setViewDoc({ urls, title: `Design Details — ${line.name}` })} className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-[#faf6ec] hover:text-[#4a3b1a]" title={`View the design sheets for ${line.name}`}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>
                                {urls.length > 1 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#4a3b1a] px-1 text-[9px] font-bold text-[#f4ead8]">{urls.length}</span>}
                              </button>
                            ) : <span className="text-xs text-muted/50">—</span>}
                          </div>
                        </td>
                      );
                    })()}

                    {idx === 0 && (
                      <>
                        <td rowSpan={n} className={TD} onClick={(e) => e.stopPropagation()}><div className="flex justify-center gap-1"><OrderImagesButton images={r.transaction_images ?? []} title={r.order_number ?? undefined} /><EmailLogButton orderId={r.id} orderNumber={r.order_number ?? null} canResend={!isSalesOnly} /></div></td>
                        <td rowSpan={n} className={TD} onClick={(e) => e.stopPropagation()}><div className="flex justify-center"><RequestEditButton order={r} isSalesOnly={isSalesOnly} reqStatus={editRequests[r.id]} onOpen={() => { setEditingRequest(true); setEditing(r); }} /></div></td>
                        {!isSalesOnly && <td rowSpan={n} className={TD} onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-center gap-1"><OrderRowActions order={r} products={products} assignees={assignees} constructors={constructors} canEditWorkshop={canEditWorkshop} isSalesOnly={isSalesOnly} /></div></td>}
                      </>
                    )}
                  </tr>
                ));
              })}
              {total === 0 && (
                <tr>
                  <td colSpan={35} className="px-5 py-8 text-center text-muted">No orders match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="grid grid-cols-1 items-center gap-3 rounded-b-xl border-t border-border bg-surface px-5 py-3 text-sm text-muted sm:grid-cols-3">
          <div className="flex items-center justify-center gap-2 sm:justify-start">
            <span>Rows per page:</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} className="rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-primary">
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="text-center font-medium text-foreground">{from}–{to} of {number(total)}</div>
          <div className="flex items-center justify-center gap-1 sm:justify-end">
            <PageBtn label="‹" disabled={current === 0} onClick={() => setPage(current - 1)} />
            <span className="px-1">Page {current + 1} of {pageCount}</span>
            <PageBtn label="›" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} />
          </div>
        </div>
      </Card>
      {viewDoc && (
        <Modal open onClose={() => setViewDoc(null)} title={viewDoc.title} size="2xl" footer={<div className="flex justify-end"><button type="button" onClick={() => setViewDoc(null)} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90">Close</button></div>}>
          <div className="space-y-6">
            {viewDoc.urls.map((u, i) => (
              <div key={u}>
                {viewDoc.urls.length > 1 && <div className="mb-1 text-xs"><span className="rounded bg-[#4a3b1a] px-1.5 py-0.5 font-extrabold text-[#f4ead8]">{i + 1}</span></div>}
                {/\.pdf($|\?)/i.test(u) ? (
                  <iframe src={`${u}#toolbar=0&navpanes=0&view=Fit`} title={viewDoc.title} className="mx-auto h-[80vh] w-full max-w-[900px] rounded-lg border border-border bg-white" />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={u} alt={viewDoc.title} className="mx-auto w-full max-w-[900px] rounded-lg border border-border bg-white" />
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
      <ProductPreviewModal item={preview} onClose={() => setPreview(null)} />
      {/* Edit Order — bumubukas pag-click ng kahit saan sa hilera. */}
      {editing && (
        <EditOrderModal
          order={editing}
          open={!!editing}
          onClose={() => setEditing(null)}
          products={products}
          assignees={assignees}
          constructors={constructors}
          canEditWorkshop={canEditWorkshop}
          isSalesOnly={isSalesOnly}
          requestEdit={editingRequest}
          silent={silent}
        />
      )}
    </div>
  );
}

function PageBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-foreground transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40">{label}</button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted hover:bg-stone-100")}>{children}</button>
  );
}
