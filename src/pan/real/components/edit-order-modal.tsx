"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { cn } from "./ui";
import { MultiImageUpload } from "./multi-image-upload";
import { LineItemsEditor, type LineItem } from "./line-items-editor";
import { AddressAutocomplete } from "./address-autocomplete";
import { updateOrder, type EditOrder } from "@/app/orders/actions";
import { createEditRequest } from "@/app/orders/edit-request-actions";
import { messengerLink, fbLinkLabel } from "@/lib/fb-link";
import { collectManualPayment } from "@/app/orders/maya-actions";
import { InstallerPayment } from "./installer-payment";
import { scanSlipInBrowser } from "@/lib/client-slip-ocr";
import type { MayaSlipFields, SlipScanResult } from "@/lib/maya-slip-parse";
import { attachSlipPhoto } from "@/app/orders/slip-actions";
import { printOrderReceipt } from "@/lib/receipt-model";
import type { OrderRow, ProductRow } from "@/lib/supabase/server";

const STATUS = ["Pending", "Partial", "Processing", "Workshop", "For Delivery", "Completed", "Cancelled"];
const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const dateOnly = (v: string | null) => (v ? v.slice(0, 10) : "");
const todayISO = () => new Date().toISOString().slice(0, 10);
// Unang mungkahing petsa pag-check ng Rush (order date + ito). Hindi
// DEFAULT_RUSH_DAYS (14) — iyon ang NORMAL na turnaround; ang rush ay mas
// maikli. Napapalitan naman agad sa calendar.
const RUSH_SEED_DAYS = 7;
// Rush deadline → Delivery Date: order date + N araw (ISO yyyy-mm-dd).
function addDaysISO(baseISO: string | null, days: number): string {
  const base = baseISO ? new Date(baseISO) : new Date();
  const d = Number.isNaN(base.getTime()) ? new Date() : base;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
// Kabaligtaran ng addDaysISO: mula sa napiling rush DATE, ilang araw ito mula
// sa order date? Ito ang `rush_days` na iniimbak — ito ang threshold ng
// countdown na RushBadge sa Orders/Operations/Delivery/Installation.
function daysBetweenISO(fromISO: string | null, toISO: string): number | null {
  if (!toISO) return null;
  const from = new Date((fromISO || todayISO()) + "T00:00:00");
  const to = new Date(toISO + "T00:00:00");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return days > 0 ? days : null;
}

// Ang shipping description ng mga LUMANG website order ay may kasamang buong
// address (dumodoble sa address ng order mismo). Linisin sa pagbukas: pamagat +
// destinasyon lang ang itira ("Shipping\n• City, Province") — pagka-Save,
// malinis na rin ang maiimbak.
function cleanShippingDescription(desc: string): string {
  if (!/^shipping/i.test(desc.trim())) return desc;
  const lines = desc.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, 2).join("\n");
}

// Ang shipping ay singil, hindi produkto — sa form, hinihiwalay ito sa sarili
// nitong "Shipping Fee" section sa halip na makihalo sa product line items
// (walang saysay dito ang qty, product search, at Mark Customized).
export const isShippingItem = (it: LineItem) => /^shipping/i.test((it.description ?? "").trim());

export function lineItemsFromOrder(order: OrderRow): LineItem[] {
  if (order.receipt_items && order.receipt_items.length) {
    return order.receipt_items.map((it) => ({
      qty: Number(it.qty) || 1,
      description: cleanShippingDescription(it.description ?? ""),
      unitPrice: Number(it.unitPrice) || 0,
      image: it.image ?? null,
      sku: it.sku ?? null,
      category: it.category ?? null,
      color: it.color ?? null,
      dimension: it.dimension ?? null,
      workshop: it.workshop ?? undefined,
      constructorName: it.constructorName ?? undefined,
      customized: !!it.customized,
    }));
  }
  // Single line from the order's product fields.
  const bullets = [order.color, order.dimension, order.category].filter(Boolean).map((b) => "• " + b);
  return [{
    qty: 1,
    description: [order.product_name ?? "", ...bullets].join("\n").trim(),
    unitPrice: Number(order.full_payment_price ?? 0),
    sku: order.sku ?? null,
    category: order.category ?? null,
    color: order.color ?? null,
    dimension: order.dimension ?? null,
  }];
}

// The full Edit Order form, used from Sales Orders (edit button) and the
// Operations Order Approval board (row click → set schedule/delivery). Controlled
// open/onClose so the caller decides how it's triggered.
export function EditOrderModal({ order, open, onClose, products = [], assignees = [], constructors = [], canEditWorkshop = false, isSalesOnly = false, requestEdit = false, silent = false, collectorName = "" }: {
  order: OrderRow;
  open: boolean;
  onClose: () => void;
  // Naka-login na account — auto-fill ng "Collected by" sa transfer collect.
  collectorName?: string;
  products?: ProductRow[];
  assignees?: { name: string; role?: string }[];
  constructors?: { name: string; role: string }[];
  canEditWorkshop?: boolean;
  isSalesOnly?: boolean;
  /** Binuksan mula sa "Request Edit" button — sales+confirmed → editable request mode. */
  requestEdit?: boolean;
  /** INITIAL SALES: ang manual collect ay hindi magpapadala ng email. */
  silent?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Sales role sa CONFIRMED na order:
  //   • row click (requestEdit=false) → VIEW ONLY — walang edit dito;
  //   • "Request Edit" button (requestEdit=true) → editable form na isusumite
  //     bilang EDIT REQUEST (aaprubahan ng Ops; server-blocked pa rin ang save).
  const orderStatus = (order.status ?? "").trim();
  const isConfirmedForSales = !/^(pending|draft|awaiting|unpaid|cancel)/i.test(orderStatus) && orderStatus !== "";
  const requestMode = isSalesOnly && isConfirmedForSales && requestEdit;
  const readOnly = isSalesOnly && isConfirmedForSales && !requestEdit;
  const [requestReason, setRequestReason] = useState("");
  const [collecting, setCollecting] = useState(false);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);
  const [paidMethod, setPaidMethod] = useState<string | null>(null); // set after a successful collect → locks the button
  // Terminal (POS) slip: photo of the printed Maya slip → server OCR → verify.
  const [slipPhotos, setSlipPhotos] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<SlipScanResult | null>(null);
  const [slipModal, setSlipModal] = useState(false); // pop-up: loading habang binabasa → mapped data pag tapos
  // Auto-map: fires as soon as the slip photo finishes uploading. Opens a pop-up
  // with a loading state, then shows the mapped fields when the OCR finishes.
  // When the scanned amount EXACTLY matches the amount to collect, the payment is
  // recorded automatically (same path as Mark Paid — save + print + email); any
  // mismatch or unread amount still requires the manual button.
  async function autoScan(url: string) {
    setScanning(true); setScan(null); setSlipModal(true);
    // Attach the photo as proof server-side (light update) while the OCR runs
    // right here in the browser — no serverless limits. Also mirror it into the
    // form's own image list so it shows up in the Receipt section and can be
    // removed there; the server-attach is DB insurance in case Save never happens.
    void attachSlipPhoto(order.id, url).catch(() => {});
    setTxnImages((prev) => (prev.includes(url) ? prev : [...prev, url]));
    try {
      const res = await scanSlipInBrowser(url);
      setScan(res);
      setScanning(false);
      if (!("error" in res) && res.amount != null && Math.abs(res.amount - toCollect) < 0.01
        && paidMethod === null && !collecting && !alreadyDone && savedBalance > 0) {
        await collectAndPrint("Maya Terminal");
      }
    } catch (e) {
      setScan({ error: e instanceof Error ? e.message : "Slip scan failed." });
    } finally {
      setScanning(false);
    }
  }
  const scanOk = scan != null && !("error" in scan);
  const slipF: MayaSlipFields | null = scanOk ? (scan as MayaSlipFields) : null;
  const scanAmount = slipF?.amount ?? null;

  // ADDITIONAL ITEMS na idinagdag sa order: singilin ang 30% ng KASALUKUYANG
  // balanse via email QR — iisang order/resibo pa rin, auto-credit pagka-bayad.
  const [adpSending, setAdpSending] = useState(false);
  const [adpMsg, setAdpMsg] = useState<string | null>(null);
  async function sendAdditionalDp() {
    setAdpSending(true); setAdpMsg(null);
    try {
      const { sendAdditionalDpQr } = await import("@/app/orders/maya-actions");
      const r = await sendAdditionalDpQr(order.id);
      setAdpMsg("error" in r ? r.error : `✓ QR emailed — ₱${r.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })} (30% of balance)`);
    } catch {
      setAdpMsg("Failed to send — try again.");
    } finally { setAdpSending(false); }
  }

  // Outstanding balance on the SAVED order (from the DB row, not the form draft) —
  // what "Mark Paid & Complete" collects. Mirrors balanceOf on the server.
  const savedTotal = Number(order.full_payment_price) || 0;
  const savedPaid = (Number(order.downpayment_price) || 0) + (Number(order.full_payment) || 0);
  const savedBalance = Math.max(Math.round((savedTotal - savedPaid) * 100) / 100, 0);
  const alreadyDone = /completed/i.test(order.status ?? "");
  // Which in-store method this order used (from its saved MOP) → show only that
  // Mark Paid button. Unknown/legacy MOP → offer both.
  const mopStr = (order.mop ?? "").toLowerCase();
  const isTerminalOrder = /terminal/.test(mopStr);
  const isCashOrder = /cash/.test(mopStr);
  // TRANSFER channels (2026-08-16): ang Create Order ay BDO/BPI/GCash/Maya na
  // (tinanggal ang Terminal POS) — ang ganoong order ay iisang "Mark Paid —
  // {channel}" button, ang channel ang naitatalang method sa ledger/resibo.
  // ("Maya Terminal" ang lumang terminal mop kaya unang tsek ang /terminal/.)
  const transferChannel = isTerminalOrder ? null
    : mopStr.includes("gcash") ? "GCash"
    : mopStr.includes("bdo") ? "BDO"
    : mopStr.includes("bpi") ? "BPI"
    : /\bmaya\b/.test(mopStr) ? "Maya"
    : null;
  const showTerminal = isTerminalOrder;
  // Lumang order na walang MOP (o hindi kilala): dating may cash button. Ngayong
  // may approval na ang cash, ito ang default — kaysa maiwang walang anumang
  // paraan para makolekta ang balanse.
  const cashApproval = isCashOrder || (!isTerminalOrder && !transferChannel);

  // Collect in-store (Cash / Maya Terminal): records the payment + BIR receipt +
  // email server-side, then AUTO-PRINTS the Acknowledgement Receipt (no pop-up) and
  // updates the form's payment figures in place.
  // Plain async (own `collecting` flag) — kept OUT of the form transition so the
  // footer Save button doesn't show "Saving…" while a payment is being recorded.
  async function collectAndPrint(method: string) {
    setCollectMsg(null); setError(null); setCollecting(true);
    // Collect the amount shown in the Downpayment field (30% by default), capped at
    // the balance — a partial keeps the order Partial; the full balance completes it.
    const amt = toCollect;
    const collected = amt > 0 ? amt : savedBalance;
    // A partial (less than the whole balance) is a downpayment; paying it all is the balance.
    const kind = collected < savedBalance ? "downpayment" : "balance";
    try {
      const res = await collectManualPayment(order.id, method, "", undefined, amt > 0 ? amt : undefined, kind, silent);
      if ("error" in res) { setError(res.error); return; }
      // Optimistically reflect the payment in the form: field + balance update live.
      const newPaid = Math.round(((Number(order.downpayment_price) || 0) + (Number(order.full_payment) || 0) + collected) * 100) / 100;
      set("downpayment", newPaid);
      set("date_downpayment", todayISO());
      setPaidMethod(method === "Maya Terminal" ? "Terminal" : method); // lock the button
      // Thermal print straight away — no preview. Falls back with a note if QZ is down.
      let printed = true;
      try { await printOrderReceipt({ ...order, downpayment_price: newPaid, full_payment: 0 }, products); }
      catch { printed = false; }
      setCollectMsg(printed ? "Paid ✓ — receipt printed + emailed." : "Paid ✓ — receipt emailed. Thermal print failed (QZ Tray not running) — use the Receipt button to print.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record payment.");
    } finally {
      setCollecting(false);
    }
  }

  const snapshot = () => ({
    order_number: order.order_number ?? "",
    date_order: dateOnly(order.date_order),
    customer_name: order.customer_name ?? "",
    address: order.address ?? "",
    address_lat: order.address_lat ?? null,
    address_lng: order.address_lng ?? null,
    contact_number: order.contact_number ?? "",
    alt_contact: (order as typeof order & { alt_contact_number?: string | null }).alt_contact_number ?? "",
    alt_relation: (order as typeof order & { alt_contact_relation?: string | null }).alt_contact_relation ?? "",
    email: order.email ?? "",
    fb_name: order.fb_name ?? "",
    fb_link: order.fb_link ?? "",
    source: order.Source ?? "",
    status: order.status ?? "Pending",
    assigned: order.assigned ?? "",
    product_name: order.product_name ?? "",
    sku: order.sku ?? "",
    category: order.category ?? "",
    color: order.color ?? "",
    dimension: order.dimension ?? "",
    workshop_date: dateOnly(order.workshop_date),
    date_of_delivery: dateOnly(order.date_of_delivery),
    date_downpayment: dateOnly(order.date_downpayment),
    full_payment_date: dateOnly(order.full_payment_date ?? null),
    downpayment: Number(order.downpayment_price ?? 0),
    full_payment: Number(order.full_payment ?? 0),
    total: Number(order.full_payment_price ?? 0),
  });

  const [f, setF] = useState(snapshot);
  const [txnImages, setTxnImages] = useState<string[]>(order.transaction_images ?? []);
  // Images the user explicitly removed in this session. A slip photo can get
  // auto-attached to the DB (attachSlipPhoto) after the form opened, so Save
  // can't tell "removed" from "never had it" by list-diffing alone — we track
  // removals directly and tell the server to delete exactly these.
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const removeTxnImage = (url: string) => {
    setTxnImages((prev) => prev.filter((u) => u !== url));
    setRemovedImages((prev) => (prev.includes(url) ? prev : [...prev, url]));
  };
  const [items, setItems] = useState<LineItem[]>(() => lineItemsFromOrder(order).filter((it) => !isShippingItem(it)));
  // Hiwalay na hawak ang shipping — sarili nitong section sa form, pero sa
  // pag-save ay isinasama ulit sa receipt_items (buo pa rin ang receipt total,
  // tracker, at inventory resync).
  const [shipping, setShipping] = useState<LineItem | null>(() => lineItemsFromOrder(order).find(isShippingItem) ?? null);
  // Rush tag — kaya rin ng Sales & Service dito sa Edit Order. Walang fixed na
  // araw: ang rushDays ang taning ng MISMONG order na ito (blank = global default).
  const [isRush, setIsRush] = useState<boolean>(!!order.is_rush);
  const [rushDays, setRushDays] = useState<string>(order.rush_days != null ? String(order.rush_days) : "");
  const set = (k: keyof ReturnType<typeof snapshot>, v: string | number | null) => setF((p) => ({ ...p, [k]: v }));

  // Reload the form from the order whenever it (re)opens for a different order.
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  if (open && loadedFor !== order.id) {
    setF(snapshot());
    setTxnImages(order.transaction_images ?? []);
    setRemovedImages([]);
    setItems(lineItemsFromOrder(order).filter((it) => !isShippingItem(it)));
    setShipping(lineItemsFromOrder(order).find(isShippingItem) ?? null);
    setIsRush(!!order.is_rush);
    setRushDays(order.rush_days != null ? String(order.rush_days) : "");
    setError(null);
    // A downpayment already recorded (via Mark Paid) keeps the button locked as
    // "✓ Paid" across reopens — the remaining balance is collected on delivery.
    setPaidMethod((Number(order.downpayment_price) || 0) > 0
      ? (/terminal/i.test(order.mop ?? "") ? "Terminal" : (transferChannel ?? "Cash"))
      : null);
    setCollectMsg(null);
    setSlipPhotos([]); setScan(null); setSlipModal(false);
    setLoadedFor(order.id);
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  function validate(): boolean {
    setError(null);
    if (!f.customer_name.trim()) { setError("Customer name is required."); return false; }
    if (!f.contact_number.trim()) { setError("Cellphone number is required."); return false; }
    if (!f.email.trim()) { setError("Email address is required."); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) { setError("Enter a valid email address."); return false; }
    if (!f.address.trim()) { setError("Address is required."); return false; }
    return true;
  }

  function buildPayload(): EditOrder {
    return {
        order_number: f.order_number.trim(),
        date_order: f.date_order || null,
        customer_name: f.customer_name.trim(),
        address: f.address || null,
        address_lat: f.address_lat ?? null,
        address_lng: f.address_lng ?? null,
        contact_number: f.contact_number || null,
        alt_contact_number: f.alt_contact || null,
        alt_contact_relation: f.alt_relation || null,
        email: f.email || null,
        fb_name: f.fb_name.trim() || null,
        fb_link: f.fb_link.trim() || null,
        source: f.source || null,
        status: f.status,
        assigned: f.assigned || null,
        workshop_date: f.workshop_date || null,
        date_of_delivery: f.date_of_delivery || null,
        date_downpayment: f.date_downpayment || null,
        full_payment_date: f.full_payment_date || null,
        downpayment: Number(f.downpayment) || 0,
        full_payment: Number(f.full_payment) || 0,  // preserved (no longer edited in the form)
        total: [...items, ...(shipping ? [shipping] : [])].reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0),
        items: [...items, ...(shipping ? [shipping] : [])],
        transaction_images: txnImages,
        removed_images: removedImages,
        is_rush: isRush,
        rush_days: isRush && rushDays.trim() ? Number(rushDays) : null,
    };
  }

  function save() {
    if (!validate()) return;
    start(async () => {
      const res = await updateOrder(order.id, buildPayload());
      if ("error" in res) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  }

  // Request mode: isumite ang iminumungkahing pagbabago para aprubahan ng Ops.
  function submitRequest() {
    if (!validate()) return;
    if (!requestReason.trim()) { setError("Please add a note explaining why this order needs to be changed."); return; }
    start(async () => {
      const res = await createEditRequest(order.id, buildPayload(), requestReason);
      if ("error" in res) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  }

  // Total comes from the line items (qty × price) + shipping — no manual override.
  const computedTotal =
    items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0) +
    (shipping ? (Number(shipping.qty) || 1) * (Number(shipping.unitPrice) || 0) : 0);
  // Downpayment field auto-suggests 30% when the order hasn't recorded one yet
  // (the usual Cash/Terminal case). A saved/typed value wins.
  const suggestedDp = computedTotal > 0 ? Math.round(computedTotal * 0.3 * 100) / 100 : 0;
  const dpShown = (Number(f.downpayment) || 0) > 0 ? Number(f.downpayment) : suggestedDp;
  // ANG KOKOLEKTAHIN, hindi ang naitala na. Magkapareho lang sila habang wala
  // pang bayad: doon, ang Downpayment field ang hinihinging halaga. Kapag may
  // naitalang bayad, ang natitirang BALANSE ang kokolektahin — dating ang
  // Downpayment field pa rin ang batayan, kaya paulit-ulit na hinihingi ang
  // dating nabayaran na (naiulat 2026-08-21 sa ORD-000177: bayad na ang
  // ₱10,528.50 pero muli pa ring humihingi ng QR para sa parehong halaga).
  const toCollect = savedPaid > 0 ? savedBalance : Math.min(dpShown, savedBalance);
  const dpDateShown = f.date_downpayment || todayISO();
  const balance = Math.max(computedTotal - dpShown - (Number(f.full_payment) || 0), 0);

  return (
    <Modal open={open} onClose={onClose} title={readOnly ? "View Order" : requestMode ? "Request Edit" : "Edit Order"} description={order.order_number ?? undefined} size="xl"
      footer={
        <div className="flex w-full flex-col gap-2">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
          <div className="flex w-full items-center justify-end gap-2">
            <button onClick={onClose} disabled={pending} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-60">{readOnly ? "Close" : "Cancel"}</button>
            {!readOnly && (requestMode ? (
              <button onClick={submitRequest} disabled={pending} className="rounded-lg bg-[#4a3b1a] px-4 py-2 text-sm font-medium text-[#f4ead8] hover:opacity-90 disabled:opacity-60">{pending ? "Submitting…" : "Submit Edit Request"}</button>
            ) : (
              <button onClick={save} disabled={pending} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] shadow-sm hover:opacity-90 disabled:opacity-60">{pending ? "Saving…" : "Save Changes"}</button>
            ))}
          </div>
        </div>
      }>
      {readOnly && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          This order is confirmed — view only. To propose changes, use the <b>Request Edit</b> button on the orders table.
        </div>
      )}
      {requestMode && (
        <div className="mb-4 space-y-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            This order is confirmed — your changes will be submitted as an <b>Edit Request</b> and must be approved by Operations before they take effect.
          </div>
          <div className="rounded-lg border border-[#caa45a] bg-[#faf6ec] p-3">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#4a3b1a]">Reason for this edit request *</label>
            <textarea
              value={requestReason}
              onChange={(e) => setRequestReason(e.target.value)}
              rows={2}
              placeholder="Explain what needs to change and why — Operations will review this note."
              className={cn(inp, "w-full resize-y")}
            />
          </div>
        </div>
      )}
      <div className={cn("space-y-5", readOnly && "pointer-events-none select-none opacity-70")} aria-disabled={readOnly}>
        <Section title="Order Details">
          <div className="grid grid-cols-2 gap-3">
            <F label="Order #"><input value={f.order_number} onChange={(e) => set("order_number", e.target.value)} className={inp} /></F>
            {/* Pagbago ng order date habang naka-rush: kailangang mag-recompute
                ang rush_days — ang bilang ng araw ay mula dito. */}
            <F label="Order Date"><input type="date" value={f.date_order} onChange={(e) => {
              set("date_order", e.target.value);
              if (isRush && f.date_of_delivery) { const d = daysBetweenISO(e.target.value, f.date_of_delivery); setRushDays(d != null ? String(d) : ""); }
            }} className={inp} /></F>
            <F label="Customer *" full><input value={f.customer_name} onChange={(e) => set("customer_name", e.target.value)} className={inp} /></F>
            <F label="Cellphone Number *"><input value={f.contact_number} onChange={(e) => set("contact_number", e.target.value)} placeholder="09xx xxx xxxx" className={inp} /></F>
            <F label="Email Address *"><input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="name@email.com" className={inp} /></F>
            {/* Alternatibong kontak (0224) — pangalawang tawagan + relasyon, gaya ng Create Order. */}
            <F label="Alternative CP #"><input value={f.alt_contact} onChange={(e) => set("alt_contact", e.target.value)} placeholder="09xx xxx xxxx" autoComplete="off" name="alt-cp-no-fill" className={inp} /></F>
            <F label="Relation to Customer"><input value={f.alt_relation} onChange={(e) => set("alt_relation", e.target.value)} placeholder="e.g. Spouse, Sibling, Parent" autoComplete="off" name="alt-rel-no-fill" className={inp} /></F>
            <F label="Facebook Name"><input value={f.fb_name} onChange={(e) => set("fb_name", e.target.value)} placeholder="Customer's FB name" className={inp} /></F>
            <F label="Facebook Profile Link (optional)">
              <input type="url" value={f.fb_link} onChange={(e) => set("fb_link", e.target.value)} placeholder="Paste facebook.com/username…" className={inp} />
              {f.fb_link && (
                <span className="mt-1 flex items-center gap-3">
                  <a href={f.fb_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-info hover:underline">
                    {fbLinkLabel(f.fb_link)}
                  </a>
                  {messengerLink(f.fb_link) && (
                    <a href={messengerLink(f.fb_link)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-info hover:underline">
                      Open Messenger
                    </a>
                  )}
                </span>
              )}
            </F>
            <F label="Address *" full><AddressAutocomplete value={f.address} coords={f.address_lat != null && f.address_lng != null ? { lat: f.address_lat, lng: f.address_lng } : null} onChange={(a, c) => { set("address", a); set("address_lat", c?.lat ?? null); set("address_lng", c?.lng ?? null); }} /></F>
            <F label="Status"><select value={f.status} onChange={(e) => set("status", e.target.value)} className={inp}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select></F>
            <F label="Assigned"><select value={f.assigned} onChange={(e) => set("assigned", e.target.value)} className={inp}><option value="">— Select —</option>{[...new Map(assignees.map((a) => [a.role?.trim() || "Sales", true])).keys()].map((role) => (<optgroup key={role} label={role}>{assignees.filter((a) => (a.role?.trim() || "Sales") === role).map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}</optgroup>))}{f.assigned && !assignees.some((a) => a.name === f.assigned) && <option value={f.assigned}>{f.assigned}</option>}</select></F>
            <F label="Rush Order">
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
                <input type="checkbox" checked={isRush} onChange={(e) => {
                  setIsRush(e.target.checked);
                  // Pag-check: agad na buksan ang calendar na may nakatakdang
                  // petsa — ang kasalukuyang Delivery Date kung meron, kung hindi
                  // ay order date + default na araw. Ang petsang ito MISMO ang
                  // delivery date (sinasalamin agad sa Schedule sa ibaba).
                  if (e.target.checked) {
                    // Panatilihin ang naka-set na Delivery Date kung MAY SAYSAY
                    // pa (matapos ang order date); kung wala o lumipas na,
                    // mag-alok ng order date + RUSH_SEED_DAYS.
                    const existing = daysBetweenISO(f.date_order, f.date_of_delivery) != null ? f.date_of_delivery : "";
                    const seed = existing || addDaysISO(f.date_order || todayISO(), RUSH_SEED_DAYS);
                    set("date_of_delivery", seed);
                    setRushDays(String(daysBetweenISO(f.date_order, seed) ?? RUSH_SEED_DAYS));
                  }
                }} className="h-4 w-4 accent-rose-600" />
                <span className="text-sm font-semibold text-rose-600">Rush</span>
              </label>
            </F>
            {isRush && (
              <F label="Rush deadline (= Delivery Date)">
                <input
                  type="date"
                  value={f.date_of_delivery || ""}
                  // Kahit isang araw pagkatapos ng order — ang zero/negatibong
                  // taning ay walang countdown na maipapakita.
                  min={addDaysISO(f.date_order || todayISO(), 1)}
                  onChange={(e) => {
                    // Ang napiling petsa ANG delivery date. Ang rush_days ay
                    // deri-derive dito (order date → petsa) dahil ito ang
                    // threshold ng countdown na RushBadge sa buong system.
                    set("date_of_delivery", e.target.value);
                    const d = daysBetweenISO(f.date_order, e.target.value);
                    setRushDays(d != null ? String(d) : "");
                  }}
                  className={inp}
                />
              </F>
            )}
          </div>
        </Section>

        <Section title="Line Items">
          <LineItemsEditor items={items} onChange={setItems} products={products} constructors={constructors} deliveredKeys={(order as typeof order & { delivered_line_keys?: string[] }).delivered_line_keys ?? []} />
        </Section>

        {/* Shipping — singil, hindi produkto: sariling hilera, hindi kahalo sa items */}
        {shipping && (
          <Section title="Shipping Fee">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">

              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Shipping</div>
                <div className="truncate text-xs text-muted">
                  {(shipping.description ?? "").split("\n").slice(1).join(" ").replace(/^•\s*/, "") || "—"}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted">₱</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={shipping.unitPrice}
                  onChange={(e) => setShipping({ ...shipping, qty: 1, unitPrice: Number(e.target.value) || 0 })}
                  className={cn(inp, "w-28 text-right")}
                />
              </div>
              <button
                type="button"
                onClick={() => setShipping(null)}
                title="Remove shipping fee"
                className="text-muted hover:text-danger"
              >
                ✕
              </button>
            </div>
          </Section>
        )}

        <Section title="Schedule">
          {/* Workshop Date is Operations-only (Order Approval); Sales sees Delivery Date only. */}
          <div className="grid grid-cols-2 gap-3">
            {canEditWorkshop && <F label="Workshop Date"><input type="date" value={f.workshop_date} onChange={(e) => set("workshop_date", e.target.value)} className={inp} /></F>}
            {/* Isa lang ang delivery date — pareho ang field na ito at ang Rush
                deadline sa itaas. Pagbago dito, sumusunod ang rush_days para
                tugma ang countdown badge. */}
            <F label="Delivery Date" full={!canEditWorkshop}><input type="date" value={f.date_of_delivery} onChange={(e) => {
              set("date_of_delivery", e.target.value);
              if (isRush) { const d = daysBetweenISO(f.date_order, e.target.value); setRushDays(d != null ? String(d) : ""); }
            }} className={inp} /></F>
          </div>
        </Section>

        <Section title="Payment">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <F label="Downpayment Date"><input type="date" value={dpDateShown} onChange={(e) => set("date_downpayment", e.target.value)} className={inp} /></F>
              <F label="Downpayment (₱) · 30% suggested"><input type="number" min={0} value={dpShown || ""} onChange={(e) => set("downpayment", Number(e.target.value))} className={inp} /></F>
            </div>
            {/* Collect the downpayment amount above in-store → receipt emailed + printed.
                Only the button for the method the order used (from its MOP). */}
            {/* May idinagdag na items? Isang click: email QR para sa 30% ng bagong balanse. */}
            {/* Para lang sa Maya email-QR flow — itago kapag transfer channel
                (BDO/BPI/GCash/Maya QR display) ang bayaran (hiling 2026-08-19). */}
            {!alreadyDone && savedBalance > 0 && !transferChannel && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#caa45a]/50 bg-[#faf6ec] p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-[#4a3b1a]">Added items? Request a new 30% downpayment</p>
                  <p className="text-[11px] text-muted">Emails a Maya QR for <b className="text-foreground">₱{(Math.round(savedBalance * 0.30 * 100) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</b> — 30% of the current balance (₱{savedBalance.toLocaleString("en-PH", { minimumFractionDigits: 2 })}). Same order, same receipt — auto-credits when paid.</p>
                  {adpMsg && <p className="mt-1 text-[11px] font-semibold text-emerald-700">{adpMsg}</p>}
                </div>
                <button type="button" disabled={adpSending} onClick={sendAdditionalDp} className="rounded-lg border border-[#caa45a] bg-white px-3 py-2 text-xs font-bold text-[#4a3b1a] hover:bg-[#f4ead8] disabled:opacity-60">
                  {adpSending ? "Sending…" : "Email QR — 30% of balance"}
                </button>
              </div>
            )}
            {/* TRANSFER MOP (BDO/BPI/GCash/Maya): PAREHONG flow ng Installation
                (hiling 2026-08-16) — QR display, receipt photo, pirma ng
                customer, Submit for Approval, Waiting/PAID cards. Ang halagang
                kokolektahin ay ang Downpayment field habang wala pang bayad;
                kapag may naitala na, ang natitirang balanse (tingnan ang
                toCollect). */}
            {/* CASH → DUMADAAN DIN SA APPROVAL (hiling 2026-08-23).
                Dating diretso ang "Mark Paid — Cash": naitatala agad sa ledger,
                walang litrato, walang pirma, walang tumitingin. Ang perang
                nakolekta ay walang ibang patunay kundi ang pindot mismo. Ang
                transfer (BDO/BPI/GCash/Maya) ay may checking na simula pa 08-16
                — ang cash, na siyang pinakamadaling mawala, ang wala. Pareho na
                sila ngayon: litrato + pirma + Submit for Approval. */}
            {!alreadyDone && savedBalance > 0 && (transferChannel || cashApproval) && (
              <InstallerPayment
                orderId={order.id}
                orderNumber={order.order_number}
                balance={toCollect}
                initialMode={(transferChannel ?? "Cash") as "Cash" | "BDO" | "BPI" | "GCash" | "Maya"}
                // Collected by = ang NAKA-ASSIGN sa order (hiling 2026-08-17);
                // kapag walang assigned, ang naka-login na account. Ang f.assigned
                // ang live na value ng Assigned dropdown sa form na ito.
                collectorName={(f.assigned || "").trim() || collectorName}
                lockMode
              />
            )}
            {!alreadyDone && savedBalance > 0 && showTerminal && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                <p className="mb-2 text-[11px] text-muted">Collects <b className="text-foreground">₱{toCollect.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</b> in-store{savedPaid === 0 && dpShown > savedBalance && <span className="text-amber-700"> (capped at the balance)</span>}. A partial keeps the order Partial; paying the full balance (₱{savedBalance.toLocaleString("en-PH", { minimumFractionDigits: 2 })}) completes it. Emails + prints the receipt.</p>
                {/* Terminal: photograph the printed Maya slip → OCR verifies the amount
                    before the payment can be recorded. Photo attaches as proof. */}
                {showTerminal && !paidMethod && (
                  <div className="mb-3 rounded-lg border border-[#e6dcc4] bg-white p-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Maya slip — capture a photo (proof)</p>
                    <MultiImageUpload value={slipPhotos}
                      onChange={(v) => { setSlipPhotos(v); if (v[0] && v[0] !== slipPhotos[0]) void autoScan(v[0]); }}
                      camera folder={`terminal-slips/${(order.order_number || `ORD${order.id}`).replace(/[^a-z0-9_-]/gi, "")}`} />
                    <p className="mt-2 text-[11px]">
                      {scanning ? (
                        <span className="text-muted">Reading the slip in the background… (you can keep working — no need to wait)</span>
                      ) : scan && "error" in scan ? (
                        <span className="text-amber-700">The slip could not be read ({scan.error}) — no problem, the photo serves as proof; please verify the amount above.</span>
                      ) : scanOk ? (
                        scanAmount != null ? (
                          Math.abs(scanAmount - toCollect) < 0.01
                            ? <span className="font-semibold text-emerald-700">✓ Slip amount ₱{scanAmount.toLocaleString("en-PH", { minimumFractionDigits: 2 })} — match</span>
                            : <span className="font-semibold text-amber-700">Slip ₱{scanAmount.toLocaleString("en-PH", { minimumFractionDigits: 2 })} ≠ amount to collect ₱{toCollect.toLocaleString("en-PH", { minimumFractionDigits: 2 })} — review before recording</span>
                        ) : <span className="text-amber-700">The amount could not be read from the photo — please verify the amount above.</span>
                      ) : (
                        <span className="text-muted">The photo is the proof — you can record it right away; the slip is read automatically in the background.</span>
                      )}
                    </p>
                    {slipF && (
                      <p className="mt-1 text-[11px] text-muted">
                        {slipF.cardType ?? ""} · Ref No: <b className="text-foreground">{slipF.refNo ?? "—"}</b> ·
                        Appr Code: <b className="text-foreground">{slipF.apprCode ?? "—"}</b> · {slipF.dateTime ?? ""}
                      </p>
                    )}

                    {/* Pop-up: loading habang binabasa → mapped slip data pag tapos. */}
                    <Modal open={slipModal} onClose={() => setSlipModal(false)} title="Maya Slip — Auto-mapping" description={order.order_number ?? undefined} size="sm"
                      footer={<div className="flex justify-end gap-2">
                        {scanOk && scanAmount != null && Math.abs(scanAmount - toCollect) >= 0.01 && (
                          <button type="button" onClick={() => { set("downpayment", scanAmount); setSlipModal(false); }}
                            className="rounded-lg bg-[#caa45a] px-3 py-1.5 text-sm font-bold text-[#3a2e14] hover:opacity-90">Use ₱{scanAmount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</button>
                        )}
                        <button type="button" onClick={() => setSlipModal(false)} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-accent hover:opacity-90">OK</button>
                      </div>}>
                      {scanning ? (
                        <div className="flex flex-col items-center gap-3 py-8">
                          <span className="h-8 w-8 animate-spin rounded-full border-4 border-[#caa45a] border-t-transparent" />
                          <p className="text-sm font-medium">Reading the slip…</p>
                          <p className="text-xs text-muted">The first scan takes longer (one time only).</p>
                        </div>
                      ) : scan && "error" in scan ? (
                        <div className="space-y-2 py-2">
                          <p className="text-sm font-semibold text-amber-700">The slip could not be read</p>
                          <p className="text-xs text-muted">{scan.error}</p>
                          <p className="text-xs text-muted">That is fine — the photo is the proof. Make sure the amount is correct, then Mark Paid.</p>
                        </div>
                      ) : scanOk ? (
                        <div className="space-y-1.5 py-1 text-sm">
                          <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
                            <span className="text-muted">Amount</span>
                            <span className={cn("font-bold tabular-nums", scanAmount != null && Math.abs(scanAmount - toCollect) < 0.01 ? "text-emerald-700" : "text-amber-700")}>
                              {scanAmount != null ? `₱${scanAmount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : "not read"}
                              {scanAmount != null && (Math.abs(scanAmount - toCollect) < 0.01 ? " ✓" : " ")}
                            </span>
                          </div>
                          {scanAmount != null && Math.abs(scanAmount - toCollect) >= 0.01 && (
                            <p className="text-[11px] text-amber-700">Differs from the amount to collect (₱{toCollect.toLocaleString("en-PH", { minimumFractionDigits: 2 })}) — press “Use” if the slip is correct.</p>
                          )}
                          {scanAmount != null && Math.abs(scanAmount - toCollect) < 0.01 && (
                            <p className="text-[11px] font-semibold text-emerald-700">
                              {paidMethod ? "✓ Match — payment RECORDED (auto). Receipt printed + emailed." : collecting ? "Match — recording the payment automatically…" : error ? `Match, but recording failed: ${error}` : "✓ Matches the amount to collect."}
                            </p>
                          )}
                          {/* Same order as the printed slip, top to bottom — easier to eyeball
                              against the physical receipt than an arbitrary grouping. */}
                          <SlipRow label="Merchant ID" value={slipF?.merchantId} />
                          <SlipRow label="Terminal ID" value={slipF?.terminalId} />
                          <SlipRow label="Payment Channel" value={slipF?.paymentChannel} />
                          <SlipRow label="Card Type" value={slipF?.cardType} />
                          <SlipRow label="Card No" value={slipF?.cardNo ? `•••• ${slipF.cardNo}` : null} />
                          <SlipRow label="Cardholder Name" value={slipF?.cardholderName} />
                          <SlipRow label="Trans. Type" value={slipF?.transType} />
                          <SlipRow label="Batch No" value={slipF?.batchNo} />
                          <SlipRow label="Trace No" value={slipF?.traceNo} />
                          <SlipRow label="Reference No" value={slipF?.refNo} />
                          <SlipRow label="Network Ref No" value={slipF?.networkRefNo} />
                          <SlipRow label="Appr Code" value={slipF?.apprCode} />
                          <SlipRow label="Date / Time" value={slipF?.dateTime} />
                          <SlipRow label="AID" value={slipF?.aid} last />
                          <details className="mt-2 rounded-lg bg-stone-50 p-2 text-[11px] text-muted">
                            <summary className="cursor-pointer font-semibold">Scanned text (debug — open if the reading looks wrong)</summary>
                            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px]">{(scan as { rawText?: string }).rawText || "(no text)"}</pre>
                          </details>
                        </div>
                      ) : null}
                    </Modal>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {showTerminal && (
                    <button type="button" disabled={collecting || pending || paidMethod !== null || !slipPhotos[0]} onClick={() => collectAndPrint("Maya Terminal")}
                      title={!slipPhotos[0] ? "Take a photo of the Maya slip first (proof)" : undefined}
                      className={cn("rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-100", paidMethod ? "bg-[#3a2e14] cursor-default" : "bg-[#4a3b1a] hover:opacity-90 disabled:opacity-50")}>
                      {paidMethod ? "✓ Paid — Terminal" : `${collecting ? "Recording…" : "Mark Paid — Terminal"}`}</button>
                  )}
                </div>
                {collectMsg && <p className="mt-2 text-xs font-medium text-emerald-700">{collectMsg}</p>}
              </div>
            )}
            <p className="rounded-lg bg-stone-50/60 px-3 py-2 text-[11px] text-muted">
              Total <b className="text-foreground">₱{computedTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</b> · Balance <b className={cn(balance === 0 && computedTotal > 0 ? "text-green-700" : "text-foreground")}>₱{balance.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</b> — from the Line Items above.
              {balance === 0 && computedTotal > 0 && <span className="ml-1 font-medium text-green-700">✓ Fully paid</span>}
            </p>
          </div>
        </Section>

        <Section title="Receipt / Transaction Images">
          <MultiImageUpload value={txnImages} onChange={setTxnImages} onRemove={removeTxnImage} />
        </Section>
      </div>
    </Modal>
  );
}

// One label/value row in the slip auto-mapping pop-up — dash when unread.
function SlipRow({ label, value, last }: { label: string; value: string | null | undefined; last?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between", !last && "border-b border-border/60 pb-1.5")}>
      <span className="text-muted">{label}</span>
      <b className="tabular-nums">{value ?? "—"}</b>
    </div>
  );
}

// ENTERPRISE section band (2026-08-16) — kapareho ng Create Order: espresso
// label na may gold marker + hairline, puting card na laman.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2.5">
        <span className="h-3.5 w-1 rounded-full bg-[#caa45a]" />
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#4a3b1a]">{title}</p>
        <span className="h-px flex-1 bg-gradient-to-r from-[#e6dcc4] to-transparent" />
      </div>
      <div className="rounded-xl border border-[#e6dcc4] bg-white p-4 shadow-sm">{children}</div>
    </div>
  );
}
function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <label className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">{label}</label>
      {children}
    </div>
  );
}
