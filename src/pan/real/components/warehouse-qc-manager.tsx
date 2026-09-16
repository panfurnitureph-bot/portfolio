"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { RushBadge } from "./rush-badge";
import { useRouter } from "next/navigation";
import JsBarcode from "jsbarcode";
import { BrowserQRCodeSvgWriter } from "@zxing/library";
import { cn, SpecRows, isReworkItem, ReworkTag } from "./ui";
import { number } from "@/lib/format";
import { MultiImageUpload } from "./multi-image-upload";
import { PaginationFooter, usePagination } from "@/components/pagination-footer";
import { sizedImg } from "./thumbnail";
import { SpecFieldsView } from "./spec-fields-input";
import { specCategoryOf } from "./line-items-editor";
import { buildSpecLines, realValue } from "@/lib/product-columns";
import { ProductPhotoStudio } from "./product-photo-studio";
import { printProductLabels, printQcPassedLabels } from "./qc-labels";
import { submitQc, reserveQcIn, finishQcInStockIn, reserveQcOut, finishQcOutShip, type QcCheckpoint } from "@/app/quality-control/actions";
import { nextMadeToOrderSku } from "@/app/products/actions";
import { MADE_TO_ORDER_CATEGORIES } from "@/lib/categories";
import { SpecFieldsInput } from "./spec-fields-input";
import { unskipLine } from "@/app/operations/actions";
import type { QcData, QcCatalogItem, QcPendingJob, QcPendingIncoming, QcPendingPack, QcRow } from "@/app/quality-control/data";

// ── Brand tokens (match the kiosk / delivery enterprise look) ──
const BROWN = "#4a3b1a";
const GOLD = "#caa45a";
// Shared input class (module-level so QcDimBoxes / QcProductBrowser can use it too).
const INP_CLS = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[#caa45a] focus:ring-1 focus:ring-[#caa45a]";

type Picked = {
  source: "imported" | "workshop" | "order";
  job_id: number | null;
  ref_id: number | null;      // order_id for a prepack "order to pack" (source 'order')
  ref_label: string | null;
  sku: string | null;
  product_name: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  frame?: string | null;      // frame parts / add-ons (W · Hdbrd · L · Base · Legs) — display only
  image_url: string | null;
  qty: number;
  workshopQcPhotos: string[];
  workshopQcGroups?: { name: string; photos: string[] }[]; // naka-grupo per checklist item
  is_new?: boolean;        // manually-entered new item (no product record yet)
  unit_cost?: number;      // cost for a new item (auto-creates the product on pass)
  specs?: string | null;   // Specifications / design details (bagong format 2026-08-18)
  product_type?: string | null; // Local | Imported (New Item modal 2026-08-18)
  po_item_id?: number | null;  // Incoming-PO line this receive fulfils (drives PO progress)
  // Whose item this is — shown in the modal header so the inspector has context.
  order_number?: string | null;
  customer_name?: string | null;
  supplier?: string | null;
  date_order?: string | null;
  date_of_delivery?: string | null;
  order_total?: number | null;
  sales_rep?: string | null;
  address?: string | null;
};

// QC inspection points, per checkpoint. Receiving checks the item as delivered;
// outgoing (pre-pack) checks it's ready to leave. The ticked points are recorded in
// the QC remarks so every inspection is documented.
const QC_CHECKLIST: Record<"receive" | "prepack", { key: string; label: string }[]> = {
  receive: [
    { key: "frame", label: "Frame / structure solid — no cracks or wobble" },
    { key: "finish", label: "Finish clean — no scratches, stains, or dents" },
    { key: "hardware", label: "Hardware complete — screws, handles, legs" },
    { key: "dimensions", label: "Dimensions match the spec" },
    { key: "count", label: "Quantity matches the delivery" },
  ],
  prepack: [
    { key: "matches", label: "Item matches the order (SKU, color, size)" },
    { key: "condition", label: "No damage — ready to ship" },
    { key: "hardware", label: "All parts / hardware included" },
    { key: "wrapped", label: "Properly wrapped & sealed for transit" },
    { key: "label", label: "Label / QR attached and correct" },
  ],
};

function resultPill(r: string) {
  return r === "pass"
    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">✓ Pass</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 ring-1 ring-inset ring-rose-200">✕ Fail</span>;
}

function sourcePill(s: string) {
  if (s === "workshop") return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">Workshop</span>;
  if (s === "imported") return <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">Imported</span>;
  // 'order' source = a skipped sales-order line pulled straight from warehouse
  // stock (no workshop, no receiving) → "Direct Stock" reads clearer than "Order".
  return <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200">Direct Stock</span>;
}

function when(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

export function WarehouseQcManager({ data, checkedBy }: { data: QcData; checkedBy: string }) {
  const [view, setView] = useState<QcRow | null>(null);
  // Three views: QC (IN) imported/general receiving · Workshop (IN) the workshop-
  // to-receive queue only · QC (OUT) dispatch. IN + Workshop share the 'receive'
  // checkpoint; 'mode' tells the panel which queue to show.
  const [tab, setTab] = useState<"receive" | "workshop" | "incoming" | "out">("receive");
  const [scanOpen, setScanOpen] = useState(false);   // Scan-Item pop-up (QC IN)
  const checkpoint: QcCheckpoint = tab === "out" ? "prepack" : "receive";
  // Every tab opens its pop-up (scan / workshop queue / incoming PO / orders-to-pack) on
  // click — even when it's already the current tab — so the button is directly clickable.
  const openTab = (t: "receive" | "workshop" | "incoming" | "out") => { setTab(t); setScanOpen(true); };
  // Each tab is its own bordered chip with a gap between them (not one joined bar).
  const tabCls = (on: boolean) => cn(
    "flex items-center gap-1.5 rounded-xl border px-4 py-2 transition-colors",
    on ? "border-[#caa45a] bg-surface text-foreground shadow-sm" : "border-border bg-stone-50 text-muted hover:bg-stone-100 hover:text-foreground",
  );

  return (
    <div className="space-y-5">
      {/* View switch: QC (IN) · Workshop (IN) · QC (OUT). Naka-align sa kanan.
          (Dating -mt-16 para umakyat sa page-title level — pero wala nang title,
          kaya normal na flow na lang; iniwas ang pag-overlap sa header.) */}
      <div className="flex justify-end">
      <div className="inline-flex gap-2 text-sm font-medium">
        <button onClick={() => openTab("receive")} className={tabCls(tab === "receive")}>Quality Control (IN)</button>
        <button onClick={() => openTab("workshop")} className={tabCls(tab === "workshop")}>
          Workshop (IN)
          {data.pendingJobs.length > 0 && <span className="rounded-full bg-[#caa45a] px-1.5 text-[10px] font-bold text-white">{data.pendingJobs.length}</span>}
        </button>
        <button onClick={() => openTab("incoming")} className={tabCls(tab === "incoming")}>
          Incoming (IN)
          {data.pendingIncoming.length > 0 && <span className="rounded-full bg-[#caa45a] px-1.5 text-[10px] font-bold text-white">{data.pendingIncoming.length}</span>}
        </button>
        <button onClick={() => openTab("out")} className={tabCls(tab === "out")}>
          Quality Control (OUT)
          {data.pendingPacks.length > 0 && <span className="rounded-full bg-[#caa45a] px-1.5 text-[10px] font-bold text-white">{data.pendingPacks.length}</span>}
        </button>
      </div>
      </div>

      <QcPanel
        key={tab}
        checkpoint={checkpoint}
        mode={tab}
        scanOpen={scanOpen}
        setScanOpen={setScanOpen}
        catalog={data.catalog}
        pendingJobs={data.pendingJobs}
        pendingIncoming={data.pendingIncoming}
        pendingPacks={data.pendingPacks}
        designByKey={data.designByKey}
        locations={data.locations}
        zones={data.zones}
        checkedBy={checkedBy}
      />

      {/* One combined history of ALL QC records (IN + OUT), with its own In/Out
          filter so the whole log is visible in a single table. */}
      <QcHistory rows={data.history} onView={setView} />

      {view && <QcRecordDetail row={view} specs={data.catalog.find((c) => c.sku.toLowerCase() === (view.sku ?? "").trim().toLowerCase())?.specs ?? null} onClose={() => setView(null)} />}
    </div>
  );
}

// Circle step indicator — ✓ when done, filled number when active, faded when not.
function StepDot({ done, active, n }: { done: boolean; active: boolean; n: number }) {
  return (
    <span className={cn(
      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2",
      done ? "bg-emerald-600 text-white ring-emerald-600"
        : active ? "bg-[#4a3b1a] text-[#f4ead8] ring-[#4a3b1a]"
        : "bg-white text-stone-400 ring-stone-300",
    )}>{done ? "✓" : n}</span>
  );
}

// DESIGN DETAILS SA BAWAT INSPEKSYON (hiling 2026-08-31, "dapat dito sa lahat
// ng quality control dito sa warehouse naka attach lahat ang design details if
// meron"). Kapareho ng DesignSheetCard ng Workshop My Jobs: ang sheet na may
// SKU ay sa produktong iyon lang; ang walang SKU ay itinutumbas sa title, at
// kung wala ay lahat ng sheet ng order. Sariling fullscreen viewer — walang
// hinihiram na modal state sa labas.
function QcDesignSheetsCard({ picked, designByKey }: { picked: Picked; designByKey: QcData["designByKey"] }) {
  const [viewer, setViewer] = useState<{ title: string; pages: { url: string; label: string }[] } | null>(null);
  const orderKey = (picked.order_number ?? "").trim();
  const skuKey = (picked.sku ?? "").trim().toUpperCase();
  // PER ORDER AT PRODUKTO (2026-09-01, "dapat 1 nalang to kase per order
  // number at product yan e"): ang SKU bucket ay LAHAT ng sheet ng SKU na iyon
  // sa LAHAT ng order — ang ACCENT-000002 ng limang magkakaibang order ay
  // limang sheet, at ang paghalo ay nagpapakita ng sheet ng ibang customer.
  // May order = sheets ng ORDER na iyon lang (sasalain pa per product sa
  // ibaba); walang order (stock build / imported) = saka lang ang SKU bucket.
  // Ang REWORK ay gawa ng isang order, hindi stock: kapag walang order number
  // ang talaan nito, HINDI ito bumabalik sa SKU bucket — doon nakasalansan ang
  // sheets ng IBANG orders at stock runs ng parehong catalog SKU (RMA-000031 ay
  // nagpakita ng 5 sheets gayong walang DD ang order niya). Walang order →
  // walang card.
  const isReworkPick = isReworkItem(picked.ref_label) || isReworkItem(picked.product_name);
  const seen = new Set<string>();
  const all = (orderKey ? designByKey[orderKey] ?? [] : (isReworkPick ? [] : designByKey[skuKey] ?? []))
    .filter((d) => { const k = `${d.ddNumber ?? ""}|${d.imageUrl}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!all.length) return null;
  const itemName = (picked.product_name ?? "").replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "").trim().toLowerCase();
  const baseTitle = (t: string | null) => (t ?? "").replace(/\s+—\s+\d+$/, "").trim().toLowerCase();
  const withSku = all.filter((d) => d.sku);
  const noSku = all.filter((d) => !d.sku);
  const mineSku = skuKey
    ? withSku.filter((d) => (d.sku ?? "").trim().toUpperCase() === skuKey)
    : withSku.filter((d) => baseTitle(d.title) === itemName);
  const mineTitle = noSku.filter((d) => baseTitle(d.title) === itemName);
  // WALANG SHARED FALLBACK DITO (2026-09-01, "dapat per product lang din sya,
  // nagiging share e"): ang Workshop card ay bumabalik sa LAHAT ng sheet ng
  // order kapag walang title match (lumang data doon) — pero sa QC, ang limang
  // sheet ng magkakaibang produkto ng ORD-000003 ay sabay-sabay na dumapo sa
  // bawat inspeksyon. Eksaktong SKU o eksaktong pangalan lang; kung wala,
  // walang card — mas mabuti ang wala kaysa sa sheet ng ibang produkto.
  const dds = [...mineSku, ...mineTitle];
  if (!dds.length) return null;
  const first = dds[0];
  const approved = dds.filter((d) => d.status === "Accepted").length;
  return (
    <>
      <button
        type="button"
        onClick={() => setViewer({
          title: `${(picked.product_name ?? picked.sku ?? "Item").trim()} — ${dds.length} sheet${dds.length === 1 ? "" : "s"}`,
          pages: dds.map((d) => ({ url: d.imageUrl, label: `${d.ddNumber ?? "—"}${d.status === "Accepted" ? " — APPROVED" : ""}` })),
        })}
        className="block w-full overflow-hidden rounded-xl border-[1.5px] border-[#caa45a] bg-white text-left shadow-[0_0_0_3px_rgba(202,164,90,0.14)] transition-transform hover:-translate-y-0.5"
      >
        <span className="flex items-center gap-2 bg-gradient-to-r from-[#52421d] to-[#4a3b1a] px-3 py-1.5">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#f4ead8]">Design Details</span>
          <span className="ml-auto font-mono text-[10.5px] font-bold text-[#caa45a]">{dds.length > 1 ? `${dds.length} sheets` : (first.ddNumber ?? "—")}</span>
        </span>
        <span className="flex items-center gap-3 px-3 py-2.5">
          {/\.pdf($|\?)/i.test(first.imageUrl) ? (
            <span className="flex h-24 w-[74px] shrink-0 items-center justify-center rounded-md border border-border bg-stone-50 text-[10px] font-extrabold text-[#4a3b1a]">PDF</span>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={first.imageUrl} alt="design sheet" loading="lazy" className="h-24 w-[74px] shrink-0 rounded-md border border-border bg-white object-cover object-top" />
          )}
          <span className="min-w-0 flex-1">
            {approved === dds.length ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-emerald-700">✓ Approved</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-amber-700">{approved > 0 ? `${approved}/${dds.length} approved` : (first.status === "Sent" ? "Pending approval" : first.status)}</span>
            )}
            <span className="mt-1 block text-[10.5px] leading-relaxed text-muted">
              {first.approvedAt ? <>Approved <b className="text-[#3a2e14]">{first.approvedAt}</b><br /></> : null}
              {first.createdBy ? <>Prepared by <b className="text-[#3a2e14]">{first.createdBy}</b></> : null}
            </span>
          </span>
        </span>
        <span className="block border-t border-[#e6dcc4] bg-[#faf6ec] px-3 py-1.5 text-center text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[#4a3b1a]">View Full Sheet{dds.length > 1 ? "s" : ""}</span>
      </button>

      {viewer && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={() => setViewer(null)}>
          <div className="my-6 w-full max-w-3xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between rounded-xl bg-[#2b2620] px-4 py-2.5 text-[#f4ead8]">
              <p className="min-w-0 truncate text-sm font-bold">{viewer.title}</p>
              <button type="button" onClick={() => setViewer(null)} className="ml-2 rounded-md px-2.5 py-1 text-sm font-bold hover:bg-white/10">✕</button>
            </div>
            {viewer.pages.map((p, i) => (
              <div key={i} className="overflow-hidden rounded-xl bg-white">
                <p className="border-b border-border bg-[#faf6ec] px-3 py-1.5 font-mono text-[10.5px] font-bold text-[#4a3b1a]">{p.label}</p>
                {/\.pdf($|\?)/i.test(p.url)
                  ? <iframe src={p.url} title={p.label} className="h-[80vh] w-full border-0" />
                  /* eslint-disable-next-line @next/next/no-img-element */
                  : <img src={p.url} alt={p.label} className="w-full" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function QcPanel({
  checkpoint, mode, scanOpen, setScanOpen, catalog, pendingJobs, pendingIncoming, pendingPacks, designByKey, locations, zones, checkedBy,
}: {
  checkpoint: QcCheckpoint;
  mode: "receive" | "workshop" | "incoming" | "out";
  scanOpen: boolean;
  setScanOpen: (v: boolean) => void;
  catalog: QcCatalogItem[];
  pendingJobs: QcPendingJob[];
  pendingIncoming: QcPendingIncoming[];
  pendingPacks: QcPendingPack[];
  designByKey: QcData["designByKey"];
  locations: string[];
  zones: string[];
  checkedBy: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  // Auto-dismiss the success toast after 3.5s so the operator can just keep scanning.
  useEffect(() => {
    if (!okMsg) return;
    const t = setTimeout(() => setOkMsg(null), 3500);
    return () => clearTimeout(t);
  }, [okMsg]);
  const [scan, setScan] = useState("");
  // scanOpen is lifted to the parent so clicking the QC (IN) tab reopens it even
  // when it's already the active tab (no reliance on a re-mount).
  const [browse, setBrowse] = useState(false);
  const [newItem, setNewItem] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);

  const [qty, setQty] = useState("1");
  const [goodQty, setGoodQty] = useState("1");
  const [defectQty, setDefectQty] = useState("0");
  const [location, setLocation] = useState("");     // Rak #
  const [zone, setZone] = useState("");             // Zone #
  const [remarks, setRemarks] = useState("");
  // Structured QC checklist — the inspector ticks each point; the ticked list is
  // folded into the saved remarks so the inspection is documented, not just pass/fail.
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  // 3-step gate: Print → Scan-to-verify → Pass. Movement (Pass) is locked until the
  // just-printed barcode is scanned back, proving the label is on the item.
  const [printed, setPrinted] = useState(false);      // step 1 done
  const [scanVerify, setScanVerify] = useState("");    // step 2 input
  const [verified, setVerified] = useState(false);     // step 2 done → unlocks Pass
  const [scanErr, setScanErr] = useState<string | null>(null);
  // QC-IN reserve: the QC record is created at Print (so the label carries QC-<id>);
  // the scan then finishes the stock-in against this same id + final SKU.
  const [reservedQc, setReservedQc] = useState<{ id: number; sku: string } | null>(null);

  const inp = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[#caa45a] focus:ring-1 focus:ring-[#caa45a]";
  // Once the barcode is printed (QC IN or OUT), the inputs lock — nothing may change
  // while waiting for the scan-to-movement (the printed label already reflects them).
  const locked = printed;

  const bySku = useMemo(() => {
    const m = new Map<string, QcCatalogItem>();
    for (const c of catalog) m.set(c.sku.toLowerCase(), c);
    return m;
  }, [catalog]);

  // Distinct categories from the catalog → New Item category dropdown.
  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const c of catalog) if (c.category?.trim()) s.add(c.category.trim());
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [catalog]);

  function reset() {
    setPicked(null); setScan(""); setQty("1"); setGoodQty("1"); setDefectQty("0");
    setLocation(""); setZone(""); setRemarks(""); setPhotos([]); setError(null);
    setPrinted(false); setScanVerify(""); setVerified(false); setScanErr(null);
    setReservedQc(null);
  }

  function pickFromScan() {
    const code = scan.trim().toLowerCase();
    if (!code) return;
    const c = bySku.get(code);
    if (!c) { setError(`No product found for "${scan.trim()}".`); return; }
    setError(null); setOkMsg(null);
    setPicked({
      source: "imported", job_id: null, ref_id: null, ref_label: null,
      sku: c.sku, product_name: c.product_name, category: c.category, color: c.color, dimension: c.dimension,
      image_url: c.image_url, qty: 1, workshopQcPhotos: [],
    });
    setQty("1"); setGoodQty("1"); setDefectQty("0"); setPhotos([]); setRemarks(""); setChecks({});
    setLocation(c.location ?? "");            // auto-fill Rak #
    setZone(c.warehouse_location ?? "");      // auto-fill Zone #
    setScanOpen(false); // item picked → close the scan pop-up, open the inspection modal
  }

  function pickJob(j: QcPendingJob) {
    setError(null); setOkMsg(null);
    setPicked({
      source: "workshop", job_id: j.job_id, ref_id: null,
      ref_label: (j.item_desc ?? "").split("\n")[0].trim() || (j.order_number ? `Job #${j.job_id} · ${j.order_number}` : `Job #${j.job_id}`),
      sku: j.sku, product_name: (j.item_desc ?? "").split("\n")[0].replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "") || null,
      category: j.category, color: j.color, dimension: j.dimension, frame: j.frame, image_url: j.image_url, qty: j.qty,
      specs: (j.item_desc ?? "").split("\n").slice(1).join("\n").trim() || null,
      workshopQcPhotos: j.workshopQcPhotos ?? [],
      workshopQcGroups: j.workshopQcGroups ?? [],
      order_number: j.order_number ?? null,
    });
    setQty(String(j.qty || 1)); setGoodQty(String(j.qty || 1)); setDefectQty("0"); setPhotos([]); setRemarks(""); setChecks({});
    setScanOpen(false); // close the queue pop-up → open the inspection modal
  }

  // Pick an Incoming-PO line to receive. Same inspection flow as everything else
  // (Print → Scan → Pass → stock-in), plus it carries po_item_id so the pass bumps the
  // PO line's received_qty and drives the Incoming Shipment progress. source 'imported',
  // ref_id = po_id so the QC record links back to the purchase order.
  function pickIncoming(p: QcPendingIncoming) {
    setError(null); setOkMsg(null);
    const first = (p.description ?? p.item_no ?? "").split("\n")[0] || null;
    setPicked({
      source: "imported", job_id: null, ref_id: p.po_id,
      ref_label: p.pi_number ? `${p.pi_number} · ${p.item_no ?? ""}`.trim() : (p.item_no ?? null),
      sku: p.item_no, product_name: first,
      category: p.category, color: p.color, dimension: p.dimension, image_url: p.image_url,
      qty: p.remaining, workshopQcPhotos: [], po_item_id: p.po_item_id,
      supplier: p.supplier ?? null,
    });
    setQty(String(p.remaining || 1)); setGoodQty(String(p.remaining || 1)); setDefectQty("0"); setPhotos([]); setRemarks(""); setChecks({});
    setScanOpen(false); // close the queue pop-up → open the inspection modal
  }

  // Pick a skipped order line for its Pre-Pack check. ref_id = order_id and
  // ref_label = the item description so submitQc can match & clear the pack line
  // and advance the order to "For Delivery".
  function pickPack(p: QcPendingPack) {
    setError(null); setOkMsg(null);
    setPicked({
      source: "order", job_id: null, ref_id: p.order_id, ref_label: p.item_desc,
      sku: p.sku, product_name: (p.item_desc ?? "").split("\n")[0].replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "") || null,
      category: p.category, color: p.color, dimension: p.dimension, image_url: p.image_url, qty: p.qty,
      // Ang build ng customer ay nasa item_desc pagkatapos ng pangalan.
      specs: (p.item_desc ?? "").split("\n").slice(1).join("\n").trim() || null,
      workshopQcPhotos: [],
      order_number: p.order_number ?? null, customer_name: p.customer_name ?? null,
      date_order: p.date_order ?? null, date_of_delivery: p.date_of_delivery ?? null,
      order_total: p.order_total ?? null, sales_rep: p.sales_rep ?? null, address: p.address ?? null,
    });
    setQty(String(p.qty || 1)); setGoodQty(String(p.qty || 1)); setDefectQty("0"); setPhotos([]); setRemarks(""); setChecks({});
    setScanOpen(false); // close the queue pop-up → open the inspection modal
  }

  // Fold the ticked checklist into the saved remarks so the inspection is documented.
  function foldedRemarks(): string {
    const list = QC_CHECKLIST[checkpoint] ?? [];
    const passed = list.filter((c) => checks[c.key]).map((c) => c.label);
    const summary = passed.length ? `QC checks (${passed.length}/${list.length}): ${passed.join("; ")}` : "";
    return [remarks.trim(), summary].filter(Boolean).join(" — ");
  }

  // STEP 1 — reserve the QC record on the server FIRST (so we get a real QC-<id> and
  // the final SKU), THEN print the label with that exact QC number. The scan step
  // later finishes the movement (stock-IN for receive, stock-OUT for dispatch).
  function printForVerify() {
    if (!picked) { setError("Pick an item first."); return; }
    // REQUIRED ANG LOKASYON BAGO ANG LAHAT (hiling 2026-08-31): ang label ay may
    // nakalimbag na Rak/Line — kapag naka-print na bago pumili, mali ang sticker
    // at "1 product have no storage location" ang bunga sa Warehouse Location.
    if (checkpoint === "receive" && (!zone.trim() || !location.trim())) { setError("Select the Line # and Cubic # first — the stocked-in unit needs its storage location."); return; }
    if (photos.length < 1) { setError("Add at least one proof photo."); return; }
    const good = Math.max(1, Number(goodQty) || 1);
    setError(null);
    const qcDate = new Date().toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
    start(async () => {
      // ── QC OUT (dispatch): reserve → print the OUT label (no product label) ──
      if (checkpoint === "prepack") {
        const res = await reserveQcOut({
          checkpoint: "prepack", source: picked.source,
          ref_id: picked.ref_id, ref_label: picked.ref_label, job_id: picked.job_id,
          sku: picked.sku, product_name: picked.product_name,
          category: picked.category, color: picked.color, dimension: picked.dimension,
          image_url: picked.image_url, qty: good, good_qty: good, defect_qty: 0,
          result: "pass", photos, remarks: foldedRemarks(), location: location || null, warehouse_location: zone || null,
        });
        if ("error" in res) { setError(res.error); return; }
        const lblSku = res.label_sku ?? picked.sku;
        setReservedQc({ id: res.id, sku: lblSku ?? "" });
        await printQcPassedLabels(
          {
            sku: lblSku, product_name: picked.product_name,
            category: picked.category, color: picked.color, dimension: picked.dimension, location: location || null, warehouse_location: zone || null,
            qc_id: res.id, inspector: checkedBy, direction: "out", qc_date: qcDate,
          },
          good,
        );
        setPrinted(true); setScanErr(null);
        return;
      }

      // ── QC IN (receive): reserve → print product + IN label ──
      const res = await reserveQcIn({
        checkpoint: "receive", source: picked.source,
        ref_id: picked.source === "order" ? picked.ref_id : picked.job_id,
        ref_label: picked.ref_label, job_id: picked.job_id,
        sku: picked.sku, product_name: picked.product_name,
        category: picked.category, color: picked.color, dimension: picked.dimension,
        image_url: picked.image_url, qty: good, good_qty: good, defect_qty: 0,
        result: "pass", photos, remarks: foldedRemarks(),
        is_new: picked.is_new, unit_cost: picked.unit_cost, specs: picked.specs ?? null, product_type: picked.product_type ?? null, location: location || null, warehouse_location: zone || null,
      });
      if ("error" in res) { setError(res.error); return; }
      const lblSku = res.label_sku ?? picked.sku;
      setReservedQc({ id: res.id, sku: lblSku ?? "" });
      // Print with the real QC-<id> so the label matches Browse (QC-00035 etc.).
      await printProductLabels({ sku: lblSku, product_name: picked.product_name, category: picked.category, location: location || null }, good);
      await printQcPassedLabels(
        {
          sku: lblSku, product_name: picked.product_name,
          category: picked.category, color: picked.color, dimension: picked.dimension, location: location || null, warehouse_location: zone || null,
          qc_id: res.id, inspector: checkedBy, direction: "in", qc_date: qcDate,
        },
        good,
      );
      setPrinted(true);
      setScanErr(null);
    });
  }

  // Parse the QC-PASSED label's QR. It encodes a URL like ".../scan?code=SKU" or
  // ".../scan?qc=123". We accept ONLY this QR (the QC-passed proof) — a plain
  // product barcode (raw SKU, no URL) is rejected so the warehouse must scan the
  // actual QC-passed sticker, not the product label. Returns the SKU, or null if
  // the scanned value isn't a QC QR.
  // Accept BOTH the label's Code128 BARCODE (raw SKU — the reliable one that any
  // 1D scanner reads) and the QR (a ".../scan?code=SKU" URL). Returns the SKU.
  function skuFromQcQr(raw: string): { sku: string; dir: "in" | "out" | null } | null {
    const s = raw.trim();
    if (!s) return null;
    // QR URL with ?code=SKU (and optional &dir=in|out)
    if (/scan\?|[?&]code=|[?&]qc=/i.test(s)) {
      let sku: string | null = null;
      let dir: "in" | "out" | null = null;
      try {
        const u = new URL(s);
        sku = u.searchParams.get("code")?.trim() || null;
        const d = u.searchParams.get("dir")?.trim().toLowerCase();
        if (d === "in" || d === "out") dir = d;
      } catch { /* fall through to regex */ }
      if (sku == null) {
        const m = s.match(/[?&]code=([^&]+)/i);
        if (m) sku = decodeURIComponent(m[1]).trim();
      }
      if (dir == null) {
        const dm = s.match(/[?&]dir=(in|out)/i);
        if (dm) dir = dm[1].toLowerCase() as "in" | "out";
      }
      // A ?qc= QR has no code param — SKU is validated by the reserved record.
      return { sku: sku ?? "", dir };
    }
    // Raw barcode value. QC-PASSED stickers are prefixed "IN-"/"OUT-"; strip it and
    // surface the direction. A plain product barcode has no prefix → dir null.
    const bm = s.match(/^(IN|OUT)-(.+)$/i);
    if (bm) return { sku: bm[2].trim(), dir: bm[1].toLowerCase() as "in" | "out" };
    return { sku: s, dir: null };
  }

  // As the scanner types the QR, auto-verify the moment a complete QC-QR URL is
  // recognised — no "Verify" click, no Enter needed. A barcode scanner pastes the
  // whole string in one burst, so this fires once it's fully in.
  function onScanChange(v: string) {
    setScanVerify(v); setScanErr(null);
    // Auto-verify only once a COMPLETE QC token is in: a QR URL, or a barcode with
    // the IN-/OUT- direction prefix. Avoids firing on every keystroke of a raw SKU.
    const p = skuFromQcQr(v);
    // Auto-verify din ang maikling QC-ref barcode (QC-00042) — kumpletong token na iyon.
    if (p != null && (p.dir != null || /scan\?|[?&]qc=|[?&]code=/i.test(v) || /^(in-|out-)?qc-\d{3,}$/i.test(v.trim()))) verifyScan(v);
  }

  // STEP 2 (QC IN) — scan the QC-PASSED label QR back. Must be the QC QR (not a
  // plain product barcode) AND match the item's SKU. Correct → verified → AUTO
  // stock-in (the scan IS the movement). Wrong → error.
  function verifyScan(scannedValue?: string) {
    if (!picked) return;
    const raw = scannedValue ?? scanVerify;
    const parsed = skuFromQcQr(raw);
    // Only complain about a non-QC scan when the Verify/Enter path is used (raw is
    // a finished value); the live onChange path stays quiet until a QC QR appears.
    if (scannedValue === undefined && raw.trim() && parsed == null) {
      setVerified(false);
      setScanErr("Scan the QC-PASSED label QR (not a plain barcode).");
      return;
    }
    if (!parsed) return;
    const code = parsed.sku;
    // The gate this modal is running (receive → stock IN, prepack → dispatch OUT).
    const wantDir: "in" | "out" = checkpoint === "prepack" ? "out" : "in";
    // Direction gate. The QC-passed QR carries an explicit &dir — if it's the WRONG
    // one (an IN label's QR scanned at the OUT station or vice versa), reject. The
    // 1D BARCODE is the raw SKU with no dir tag (parsed.dir == null); that's allowed
    // because the reserved QC record this gate is finishing was itself created for
    // THIS station, so a SKU match here can only be this station's movement.
    if (parsed.dir != null && parsed.dir !== wantDir) {
      setVerified(false);
      setScanErr(`Wrong label — scanned an ${parsed.dir.toUpperCase()} label at the ${wantDir.toUpperCase()} station.`);
      return;
    }
    // A ?qc=<id> QR carries the direction + the QC record id but NO SKU (code == "").
    // The direction already matched above and the id identifies THIS reserved record,
    // so that's proof enough — accept without a SKU compare. The barcode / ?code= QR
    // path (which carries a SKU) is matched against the reserved SKU below.
    if (!code) {
      setVerified(true); setScanErr(null);
      finishStockIn();
      return;
    }
    // Ang maikling QC ref (QC-00042) ay valid na katunayan — ito ang barcode ng
    // mga label na MAHABA ang sku (masyadong dense ang buong sku sa Code128).
    const refWant = reservedQc ? `qc-${String(reservedQc.id).padStart(5, "0")}` : null;
    if (refWant && code.trim().toLowerCase() === refWant) {
      setVerified(true); setScanErr(null);
      finishStockIn();
      return;
    }
    // Match against the FINAL reserved SKU (what was printed) — covers a new-item
    // PF-<id> that only exists after reserveQcIn. Falls back to picked.sku.
    const want = (reservedQc?.sku || picked.sku || picked.product_name || "").trim().toLowerCase();
    if (want && code.toLowerCase() === want) {
      setVerified(true); setScanErr(null);
      finishStockIn();   // scan verified → finish the reserved QC's stock-in
    } else {
      setVerified(false);
      setScanErr(`No match. Expected: ${reservedQc?.sku || picked.sku || "—"} · scanned: ${code || "—"}`);
    }
  }

  // STEP 3 — finish the reserved QC's physical movement after the scan verifies.
  // QC IN → stock-in; QC OUT → ship (deduct on-hand + order → For Delivery).
  // Idempotent server-side (stocked_at / inventory_shipped guards).
  function finishStockIn() {
    if (!reservedQc) { setError("No reserved QC — print first."); return; }
    const good = Math.max(1, Number(goodQty) || 1);
    const qcLabel = `QC-${String(reservedQc.id).padStart(5, "0")}`;
    start(async () => {
      if (checkpoint === "prepack") {
        const res = await finishQcOutShip({ qc_id: reservedQc.id, order_id: picked?.ref_id ?? 0, good_qty: good });
        if ("error" in res) { setError(res.error); return; }
        setOkMsg(`✓ ${picked?.product_name ?? reservedQc.sku} — dispatched, deducted from stock (${qcLabel}).`);
      } else {
        const res = await finishQcInStockIn({ qc_id: reservedQc.id, sku: reservedQc.sku, location: location || null, warehouse_location: zone || null, good_qty: good, po_item_id: picked?.po_item_id ?? null });
        if ("error" in res) { setError(res.error); return; }
        setOkMsg(`✓ ${picked?.product_name ?? reservedQc.sku} — ${good} stocked in (${qcLabel}).`);
      }
      reset();
      router.refresh();
    });
  }

  // GLOBAL scanner capture for the QC-IN verify step. Barcode/QR scanners type a
  // fast burst of keystrokes then Enter — but only into whatever is focused. We
  // listen on window so it works even when the input isn't focused. Active ONLY
  // while the QC-IN gate is waiting for a scan (printed, not yet verified).
  const scanActive = printed && !verified;   // QC IN + QC OUT both gate on scan
  const verifyRef = useRef<(v: string) => void>(() => {});
  verifyRef.current = (v: string) => verifyScan(v);
  useEffect(() => {
    if (!scanActive) return;
    let buf = ""; let last = 0; let settle: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      const code = buf.trim();
      if (code.length >= 2) { setScanVerify(code); verifyRef.current(code); }
      buf = "";
    };
    const onKey = (e: KeyboardEvent) => {
      // Ignore modifier-only keys and browser shortcuts (Ctrl/Alt/Meta combos).
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const now = Date.now();
      if (now - last > 120) buf = "";  // long gap = human typing → reset
      last = now;
      if (e.key === "Enter" || e.key === "Tab") {   // scanner suffix (Enter or Tab)
        if (buf.length >= 1) e.preventDefault();     // don't let Tab move focus / Enter submit
        if (settle) { clearTimeout(settle); settle = null; }
        fire();
        return;
      }
      if (e.key.length === 1) {
        buf += e.key;
        setScanVerify(buf);                    // live-fill the field as the scan streams
        // Many scanners send NO trailing Enter. Auto-fire once the keystroke burst
        // stops (80ms of quiet) — a human can't type a whole code that fast, so this
        // only triggers on a scanner burst, not manual typing.
        if (settle) clearTimeout(settle);
        settle = setTimeout(fire, 80);
      }
    };
    window.addEventListener("keydown", onKey, true);   // capture phase → beat any focused input
    return () => { if (settle) clearTimeout(settle); window.removeEventListener("keydown", onKey, true); };
  }, [scanActive]);

  function submit(result: "pass" | "fail", scanVerified = false) {
    if (!picked) { setError("Scan or pick an item first."); return; }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) { setError("Enter a valid quantity."); return; }
    if (photos.length < 1) { setError("Add at least one proof photo."); return; }
    // QC IN gate: a PASS requires the printed label to be scanned back first.
    // (scanVerified is passed true by verifyScan's auto-submit — state may not have
    // flushed yet, so trust the explicit flag.)
    if (checkpoint === "receive" && result === "pass" && !verified && !scanVerified) {
      setError("Print and scan the barcode first before Pass."); return;
    }
    const good = result === "pass" ? Number(goodQty) : 0;
    const defect = result === "fail" ? q : Number(defectQty);
    setError(null);
    start(async () => {
      const res = await submitQc({
        checkpoint, source: picked.source,
        ref_id: picked.source === "order" ? picked.ref_id : picked.job_id,
        ref_label: picked.ref_label,
        job_id: picked.job_id, sku: picked.sku, product_name: picked.product_name,
        category: picked.category, color: picked.color, dimension: picked.dimension,
        image_url: picked.image_url,
        qty: q, good_qty: good, defect_qty: defect, result, photos, remarks: foldedRemarks(),
        is_new: picked.is_new, unit_cost: picked.unit_cost, specs: picked.specs ?? null, product_type: picked.product_type ?? null, location: location || null, warehouse_location: zone || null,
      });
      if ("error" in res) { setError(res.error); return; }
      const name = picked.product_name ?? picked.sku ?? "Item";
      // NOTE: QC IN labels are now printed UP-FRONT (printForVerify, Step 1) and
      // scanned back before this Pass, so we no longer auto-print here on receive.
      // QC-for-OUT PASS (skipped order line) → the stock was just SHIPPED (deducted)
      // server-side. Auto-print a QC label per unit marked ( OUT ) — the outgoing
      // twin of the IN sticker — so the packed item carries its dispatch proof.
      if (result === "pass" && checkpoint === "prepack" && picked.source === "order" && good > 0) {
        void printQcPassedLabels(
          {
            sku: picked.sku, product_name: picked.product_name,
            category: picked.category, color: picked.color, dimension: picked.dimension, location: location || null, warehouse_location: zone || null,
            qc_id: res.id, inspector: checkedBy, direction: "out",
            qc_date: new Date().toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }),
          },
          good,
        );
      }
      setOkMsg(result === "pass"
        ? `✓ ${name} passed${checkpoint === "receive" ? ` — ${good} stocked in (scanned & verified)` : picked.source === "order" ? ` — deducted from stock · ${good} OUT label(s) printing` : ""}.`
        : `✕ ${name} failed — ${q} written off.`);
      reset();
      router.refresh();
    });
  }

  const Spec = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="min-w-0">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{k}</div>
      <div className="break-words text-sm font-medium leading-snug">{v || "—"}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Queues + modals. QC (IN) opens the scan pop-up automatically; Workshop (IN)
          and QC (OUT) show their queue here. The inspection form is a modal on select. */}
      <div className="grid gap-4">
        {/* Scan-Item pop-up — auto-opens when the QC (IN) tab is selected (receive mode
            only; workshop/incoming/out have their own queue pop-ups). */}
        {scanOpen && mode === "receive" && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setScanOpen(false)}>
            <div className="my-10 w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-2 px-5 py-3 text-[#f4ead8]" style={{ background: `linear-gradient(to bottom, #52421d, ${BROWN})` }}>
                <span className="flex items-center gap-2 text-sm font-bold"> Scan Item</span>
                <button onClick={() => setScanOpen(false)} className="rounded-lg px-2 py-1 text-lg leading-none text-[#f4ead8]/80 hover:bg-white/10 hover:text-white">×</button>
              </div>
              <div className="space-y-2.5 p-5">
                <div className="flex gap-2">
                  <input
                    value={scan}
                    onChange={(e) => setScan(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") pickFromScan(); }}
                    placeholder="Scan or type SKU / barcode…"
                    className={inp}
                    autoFocus
                  />
                  <button onClick={pickFromScan} className="shrink-0 rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] transition hover:opacity-90">Find</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setBrowse(true)} className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#caa45a]/60 bg-[#faf8f3] px-3 py-2 text-xs font-semibold text-[#4a3b1a] transition hover:bg-[#f4ead8]">Browse catalog</button>
                  <button onClick={() => setNewItem(true)} className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-emerald-300 bg-emerald-50/60 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50">＋ New Item</button>
                </div>
                <p className="text-center text-[10px] text-muted">No label yet? Browse the catalog or add a brand-new item.</p>
              </div>
            </div>
          </div>
        )}

        {newItem && (
          <QcNewItemModal
            categories={categories}
            onClose={() => setNewItem(false)}
            onCreate={(it) => {
              setError(null); setOkMsg(null);
              // Auto-generate a SKU when none is typed, so a New Item ALWAYS has a
              // barcode value — identical label format to a Browse-catalog item.
              // We pass this SKU to the server on Pass, and the server keeps it (its
              // PF-<id> fallback only fires when sku is empty), so print + scan +
              // stock-in all share the exact same code — no mismatch.
              // Short, fixed-length auto-SKU (PF- + 6 chars) so the barcode/label
              // stays the same size/layout as a normal catalog SKU (a long random
              // SKU widened the barcode and shifted the layout).
              const autoSku = (it.sku && it.sku.trim()) || `PF-${Date.now().toString(36).slice(-6).toUpperCase()}`;
              setPicked({
                source: "imported", job_id: null, ref_id: null, ref_label: "New item",
                sku: autoSku, product_name: it.product_name, category: it.category || null,
                color: it.color || null, dimension: it.dimension || null, image_url: it.image_url,
                qty: 1, workshopQcPhotos: [], is_new: true, unit_cost: it.unit_cost, specs: it.specs || null,
                product_type: it.product_type || null,
              });
              setQty("1"); setGoodQty("1"); setDefectQty("0"); setPhotos([]); setRemarks(""); setChecks({});
              setNewItem(false); setScanOpen(false);
            }}
          />
        )}

        {browse && (
          <QcProductBrowser
            catalog={catalog}
            onClose={() => setBrowse(false)}
            onPick={(c) => {
              setError(null); setOkMsg(null);
              setPicked({
                source: "imported", job_id: null, ref_id: null, ref_label: null,
                sku: c.sku, product_name: c.product_name, category: c.category, color: c.color, dimension: c.dimension,
                image_url: c.image_url, qty: 1, workshopQcPhotos: [],
              });
              setQty("1"); setGoodQty("1"); setDefectQty("0"); setPhotos([]); setRemarks(""); setChecks({});
              setLocation(c.location ?? "");           // auto-fill Rak #
              setZone(c.warehouse_location ?? "");     // auto-fill Zone #
              setBrowse(false); setScanOpen(false);
            }}
          />
        )}

        {/* Workshop-to-Receive queue — opens as a pop-up when Workshop (IN) is selected. */}
        {mode === "workshop" && scanOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setScanOpen(false)}>
            <div className="my-10 w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-2 px-5 py-3 text-[#f4ead8]" style={{ background: `linear-gradient(to bottom, #52421d, ${BROWN})` }}>
                <span className="flex items-center gap-2 text-sm font-bold"> Workshop to Receive</span>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">{pendingJobs.length}</span>
                  <button onClick={() => setScanOpen(false)} className="rounded-lg px-2 py-1 text-lg leading-none text-[#f4ead8]/80 hover:bg-white/10 hover:text-white">×</button>
                </div>
              </div>
              {pendingJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center"><div className="mb-1 text-2xl opacity-40">✓</div><p className="text-xs text-muted">No finished workshop items waiting.</p></div>
              ) : (
                <div className="max-h-[60vh] space-y-1.5 overflow-y-auto p-3">
                  {pendingJobs.map((j) => (
                    <button key={j.job_id} onClick={() => pickJob(j)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left transition-all hover:border-[#caa45a] hover:bg-[#faf6ec]">
                      {j.image_url
                        ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={sizedImg(j.image_url,100)} loading="lazy" alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-border" />
                        : <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-stone-200 text-base text-muted"></div>}
                      <span className="min-w-0 flex-1">
                        {/* Rework: badge + RMA on top, clean product name below. */}
                        {isReworkItem(j.item_desc) && (
                          <span className="mb-0.5 flex items-center gap-1.5">
                            <ReworkTag />
                            <span className="text-[11px] font-bold text-amber-700">{(j.item_desc ?? "").match(/rma-\d+/i)?.[0]?.toUpperCase() ?? ""}</span>
                          </span>
                        )}
                        <span className="block truncate text-sm font-semibold text-foreground">{(j.item_desc ?? "—").split("\n")[0].replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "")}</span>
                        <span className="block text-[11px] text-muted">{j.is_rush && <RushBadge isRush dateOrder={j.order_date} threshold={j.rush_days ?? 14} className="mr-1" />}{j.order_number ? `${j.order_number} · ` : ""}Job #{j.job_id}{j.sku ? ` · ${j.sku}` : ""} · qty {number(j.qty)}</span>
                      </span>
                      <span className="shrink-0 text-[#caa45a]">›</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Incoming-PO queue — opens when Incoming (IN) is selected. Picking a line
            runs the SAME receive flow (Print sticker → Scan → Pass → stock-in), and
            the pass bumps the PO's received_qty to drive the Incoming progress. */}
        {mode === "incoming" && scanOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setScanOpen(false)}>
            <div className="my-10 w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-2 px-5 py-3 text-[#f4ead8]" style={{ background: `linear-gradient(to bottom, #52421d, ${BROWN})` }}>
                <span className="flex items-center gap-2 text-sm font-bold"> Incoming PO — Receive into Stock</span>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">{pendingIncoming.length}</span>
                  <button onClick={() => setScanOpen(false)} className="rounded-lg px-2 py-1 text-lg leading-none text-[#f4ead8]/80 hover:bg-white/10 hover:text-white">×</button>
                </div>
              </div>
              {pendingIncoming.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center"><div className="mb-1 text-2xl opacity-40">✓</div><p className="text-xs text-muted">No incoming PO items to receive.</p></div>
              ) : (
                <div className="max-h-[60vh] space-y-1.5 overflow-y-auto p-3">
                  {pendingIncoming.map((p) => (
                    <button key={p.po_item_id} onClick={() => pickIncoming(p)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left transition-all hover:border-[#caa45a] hover:bg-[#faf6ec]">
                      {p.image_url
                        ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={sizedImg(p.image_url,100)} loading="lazy" alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-border" />
                        : <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-stone-200 text-base text-muted"></div>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{(p.description ?? p.item_no ?? "—").split("\n")[0]}</span>
                        <span className="block text-[11px] text-muted">{p.pi_number ? `${p.pi_number} · ` : ""}{p.item_no ?? ""} · {number(p.received_qty)}/{number(p.ordered_qty)} received · <b className="text-[#4a3b1a]">{number(p.remaining)} left</b></span>
                      </span>
                      <span className="shrink-0 text-[#caa45a]">›</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Orders-to-Pack queue — opens as a pop-up when QC (OUT) is selected. */}
        {checkpoint === "prepack" && scanOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setScanOpen(false)}>
            <div className="my-10 w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-2 px-5 py-3 text-[#f4ead8]" style={{ background: `linear-gradient(to bottom, #52421d, ${BROWN})` }}>
                <span className="flex items-center gap-2 text-sm font-bold"> Orders to Pack (Skip — pulled from stock)</span>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">{pendingPacks.length}</span>
                  <button onClick={() => setScanOpen(false)} className="rounded-lg px-2 py-1 text-lg leading-none text-[#f4ead8]/80 hover:bg-white/10 hover:text-white">×</button>
                </div>
              </div>
              {pendingPacks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center"><div className="mb-1 text-2xl opacity-40">✓</div><p className="text-xs text-muted">No order items waiting to pack.</p></div>
              ) : (
                <div className="max-h-[60vh] space-y-1.5 overflow-y-auto p-3">
                  {pendingPacks.map((p) => (
                    <div key={`${p.order_id}|${p.item_desc}|${p.color ?? ""}`} className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 transition-all hover:border-[#caa45a] hover:bg-[#faf6ec]">
                      <button onClick={() => pickPack(p)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        {p.image_url
                          ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={sizedImg(p.image_url,100)} loading="lazy" alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-border" />
                          : <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-stone-200 text-base text-muted"></div>}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            {isReworkItem(p.item_desc) && <ReworkTag />}
                            <span className="block truncate text-sm font-semibold text-foreground">{(p.item_desc ?? "—").split("\n")[0].replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "")}</span>
                          </span>
                          <span className="block text-[11px] text-muted">{p.order_number ?? `#${p.order_id}`}{p.customer_name ? ` · ${p.customer_name}` : ""}{p.sku ? ` · ${p.sku}` : ""}{p.color ? ` · ${p.color}` : ""} · qty {number(p.qty)}</span>
                        </span>
                        <span className="shrink-0 text-[#caa45a]">›</span>
                      </button>
                      {/* Remove a stale line without inspecting — deletes the skip flag. */}
                      <button onClick={() => { if (confirm(`Remove from the pack queue: "${(p.item_desc ?? "").split("\n")[0]}"?`)) start(async () => { const r = await unskipLine(p.order_id, p.item_desc, p.color ?? ""); if (!("error" in r)) router.refresh(); }); }}
                        title="Remove from the queue (no QC)" className="shrink-0 rounded-lg px-2 py-1 text-sm text-muted hover:bg-rose-50 hover:text-rose-600">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Success toast — floats top-center above everything (incl. the QC modal), then
          auto-dismisses after 3.5s. Tap to close early. */}
      {okMsg && (
        <div className="fixed inset-x-0 top-4 z-[100] flex justify-center px-4" role="status" aria-live="polite">
          <button
            onClick={() => setOkMsg(null)}
            className="pf-fade flex max-w-lg items-center gap-3 rounded-2xl border border-emerald-300 bg-emerald-600 px-5 py-3.5 text-left text-sm font-semibold text-white shadow-2xl ring-1 ring-emerald-700/20"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-base">✓</span>
            <span>{okMsg}</span>
          </button>
        </div>
      )}

      {/* INSPECTION — opens as a centered modal once an item is selected. */}
      {picked && (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => reset()}>
      <div className="my-6 w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 py-3 text-[#f4ead8]" style={{ background: `linear-gradient(to bottom, #52421d, ${BROWN})` }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#caa45a] text-sm">{checkpoint === "receive" ? "" : ""}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold tracking-wide">{checkpoint === "receive" ? "Receiving Inspection" : "QC for OUT — Outgoing Check"}</div>
            <div className="text-[11px] opacity-80">{checkpoint === "receive" ? "Pass posts good units to stock" : "Check item before packing · no stock move (already reserved)"}</div>
          </div>
          <button onClick={() => reset()} className="ml-1 text-[#e7dcc4] hover:text-white">✕</button>
        </div>

          <div className="max-h-[80vh] space-y-4 overflow-y-auto p-5">
            {/* Item header */}
            <div className="flex items-center gap-3.5 rounded-xl border border-[#e7dcc4] bg-[#faf8f3] p-3.5">
              {picked.image_url
                ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={picked.image_url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-border" />
                : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-2xl text-muted"></div>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold text-[#4a3b1a]">{picked.product_name ?? picked.sku ?? "Item"}</p>
                {/* Pinagmulan lang ang badge dito — ang SKU, order at customer ay
                    may sariling naka-label na hilera sa ibaba (walang doble). */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {isReworkItem(picked.ref_label) ? <ReworkTag /> : sourcePill(picked.source)}
                </div>
              </div>
            </div>

            {/* Specs — PAREHONG hilera ng Product Details (SKU · Category ·
                Color · Qty), hindi 4-column na grid. */}
            <SpecRows items={[
              // Ang walang laman ay hindi na ipinapakita — ang buong build ay
              // nasa SPECIFICATIONS card sa ibaba.
              ...(picked.sku ? [["SKU", picked.sku] as [string, React.ReactNode]] : []),
              ...(picked.category ? [["Category", picked.category] as [string, React.ReactNode]] : []),
              // Ang kulay ay madalas ang mismong tela ("Cairo 2"), na nasa
              // specs na bilang Upholstered Finish / Fabric — huwag ulitin.
              ...(picked.color && !(picked.specs ?? "").toLowerCase().includes(picked.color.toLowerCase())
                ? [["Color", picked.color] as [string, React.ReactNode]] : []),
              ...(picked.dimension ? [["Dimension", picked.dimension] as [string, React.ReactNode]] : []),
              ["Expected", number(picked.qty)],
              ...(picked.frame ? [["Add-ons", picked.frame] as [string, React.ReactNode]] : []),
              ...(picked.order_number ? [["Order", picked.order_number] as [string, React.ReactNode]] : []),
              ...(picked.customer_name ? [["Customer", picked.customer_name] as [string, React.ReactNode]] : []),
              ...(picked.supplier ? [["Supplier", picked.supplier] as [string, React.ReactNode]] : []),
            ]} />

            {/* Ang aprubadong plano, naka-attach sa mismong inspeksyon — lahat
                ng QC dito sa bodega, kung meron. */}
            <QcDesignSheetsCard picked={picked} designByKey={designByKey} />

            {/* Ang BUONG build ng item — parehong SPECIFICATIONS card ng Product
                Details at ng Workshop QC, para makita ng inspector ang eksaktong
                dapat na laman bago i-pack. */}
            {picked.specs?.trim() ? (
              <div className="rounded-lg border border-border bg-stone-50/60 p-3">
                <SpecFieldsView category={specCategoryOf(picked.category ?? "", picked.product_name ?? "")} specs={picked.specs} />
              </div>
            ) : null}

            {/* Order context — only for order-sourced items; gives the inspector the
                full picture (deliver by when, order value, who sold it, where it goes). */}
            {picked.source === "order" && (picked.date_of_delivery || picked.order_total != null || picked.sales_rep || picked.date_order || picked.address) && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-[#e7dcc4] bg-[#fdfbf6] p-3.5 sm:grid-cols-4">
                <Spec k="Deliver by" v={picked.date_of_delivery ? new Date(picked.date_of_delivery).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : null} />
                <Spec k="Order value" v={picked.order_total != null ? `₱${picked.order_total.toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : null} />
                <Spec k="Sales rep" v={picked.sales_rep} />
                <Spec k="Ordered" v={picked.date_order ? new Date(picked.date_order).toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : null} />
                {picked.address && <div className="col-span-2 sm:col-span-4"><Spec k="Deliver to" v={picked.address} /></div>}
              </div>
            )}

            {/* Workshop QC proof — NAKA-GRUPO per checklist item (Main / Carpentry /
                Upholstery / add-ons), kapareho ng ayos sa QC declaration review. */}
            {picked.workshopQcPhotos.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-800">
                  Workshop QC Proof
                  <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{picked.workshopQcPhotos.length}</span>
                </p>
                {(picked.workshopQcGroups?.length ?? 0) > 0 ? (
                  <div className="space-y-2">
                    {picked.workshopQcGroups!.map((g, gi) => (
                      <div key={gi} className="rounded-lg border border-amber-200/70 bg-white/60 p-2">
                        <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-amber-900">
                          {g.name}
                          <span className="ml-auto text-[10px] font-medium text-amber-700">{g.photos.length} photo(s)</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                          {g.photos.map((p, i) => (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="group relative block aspect-square overflow-hidden rounded-lg ring-1 ring-amber-200">
                              <img src={p} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {picked.workshopQcPhotos.map((p, i) => (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="group relative block aspect-square overflow-hidden rounded-lg ring-1 ring-amber-200">
                        <img src={p} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
                      </a>
                    ))}
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-amber-700">Reference from the workshop. Click to enlarge. Add your own warehouse photos below.</p>
              </div>
            )}

            {/* Two columns: counts + meta on the left, photo proof + verdict on the right. */}
            <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-4">
            {/* Quantities. QC (OUT) is a go/no-go outgoing check — no Good/Defect
                split (the item was already QC'd on the way IN). Just the qty to
                dispatch; Pass = ship, Fail = pull back. Receiving keeps Good/Defect. */}
            {checkpoint === "prepack" ? (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Qty to dispatch</span>
                <input type="number" min={1} value={qty} onChange={(e) => { setQty(e.target.value); setGoodQty(e.target.value); }} className={inp} />
              </label>
            ) : (
            <div className={cn("grid grid-cols-3 gap-3", locked && "opacity-60")}>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Total qty</span>
                <input type="number" min={1} value={qty} disabled={locked} onChange={(e) => setQty(e.target.value)} className={cn(inp, "disabled:cursor-not-allowed disabled:bg-stone-100")} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-emerald-700">Good</span>
                <input type="number" min={0} value={goodQty} disabled={locked} onChange={(e) => setGoodQty(e.target.value)} className={cn(inp, "border-emerald-200 focus:border-emerald-400 focus:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-stone-100")} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-rose-700">Defect</span>
                <input type="number" min={0} value={defectQty} disabled={locked} onChange={(e) => setDefectQty(e.target.value)} className={cn(inp, "border-rose-200 focus:border-rose-400 focus:ring-rose-400 disabled:cursor-not-allowed disabled:bg-stone-100")} />
              </label>
            </div>
            )}

            {/* Warehouse location — where the stocked-in units go (printed on the label).
                LINE + CUBIC na ang ayos (2026-08-10): ang Cubic # ay naka-grupo
                kada Line (hango sa L<n>- na unahan ng code), at ang pagpili ng
                cubic ay awtomatikong pumupuno ng Line #. */}
            {checkpoint === "receive" && (
              <div className="grid grid-cols-2 gap-3">
                {/* LINE # MUNA bago Cubic # (2026-08-10) — at kapag may napiling
                    linya, ang mga cubic ng linyang iyon lang ang inaalok. */}
                <label className={cn("block", locked && "opacity-60")}>
                  <span className="mb-1 block text-xs font-medium text-muted">Line # <span className="text-rose-600">*</span></span>
                  {zones.length > 0 ? (
                    <select
                      value={zone}
                      disabled={locked}
                      onChange={(e) => {
                        setZone(e.target.value);
                        // Ibang linya na — huwag panatilihin ang cubic ng iba.
                        const m = location.match(/^L(\d+)-/i);
                        if (m && `Line ${m[1]}` !== e.target.value) setLocation("");
                      }}
                      className={cn(inp, "disabled:cursor-not-allowed disabled:bg-stone-100")}
                    >
                      <option value="">— select line —</option>
                      {zones.map((z) => <option key={z} value={z}>{z}</option>)}
                    </select>
                  ) : (
                    <input value={zone} disabled={locked} onChange={(e) => setZone(e.target.value)} placeholder="e.g. Line 1" className={cn(inp, "disabled:cursor-not-allowed disabled:bg-stone-100")} />
                  )}
                </label>
                <label className={cn("block", locked && "opacity-60")}>
                  <span className="mb-1 block text-xs font-medium text-muted">Cubic # <span className="text-rose-600">*</span></span>
                  {locations.length > 0 ? (
                    <select
                      value={location}
                      disabled={locked}
                      onChange={(e) => {
                        const code = e.target.value;
                        setLocation(code);
                        const m = code.match(/^L(\d+)-/i);
                        if (m) setZone(`Line ${m[1]}`);
                      }}
                      className={cn(inp, "disabled:cursor-not-allowed disabled:bg-stone-100")}
                    >
                      <option value="">— select cubic —</option>
                      {(() => {
                        // Kapag may napiling Line N, ang mga cubic nito lang.
                        const lineN = zone.match(/^Line\s*(\d+)$/i)?.[1] ?? null;
                        const shown = lineN
                          ? locations.filter((l) => new RegExp(`^L${lineN}-`, "i").test(l))
                          : locations;
                        const groups = new Map<string, string[]>();
                        for (const l of (shown.length ? shown : locations)) {
                          const m = l.match(/^L(\d+)-/i);
                          const g = m ? `Line ${m[1]}` : "Older racks";
                          groups.set(g, [...(groups.get(g) ?? []), l]);
                        }
                        return [...groups.entries()]
                          .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
                          .map(([g, codes]) => (
                            <optgroup key={g} label={g}>
                              {codes.map((l) => <option key={l} value={l}>{l}</option>)}
                            </optgroup>
                          ));
                      })()}
                    </select>
                  ) : (
                    <input value={location} disabled={locked} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. L1-A1" className={cn(inp, "disabled:cursor-not-allowed disabled:bg-stone-100")} />
                  )}
                </label>
              </div>
            )}

            {/* QC checklist — inspection points the checker ticks. Documents the pass. */}
            {(() => {
              const list = QC_CHECKLIST[checkpoint];
              const ticked = list.filter((c) => checks[c.key]).length;
              return (
                <div className={cn("rounded-xl border border-border p-3.5", locked && "opacity-60")}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-[#4a3b1a]">Inspection checklist</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", ticked === list.length ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-muted")}>{ticked}/{list.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {list.map((c) => (
                      <label key={c.key} className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1 text-[13px] hover:bg-stone-50">
                        <input type="checkbox" checked={!!checks[c.key]} disabled={locked}
                          onChange={(e) => setChecks((p) => ({ ...p, [c.key]: e.target.checked }))}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-emerald-600" />
                        <span className={cn(checks[c.key] ? "text-foreground" : "text-muted")}>{c.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })()}

            <label className={cn("block", locked && "opacity-60")}>
              <span className="mb-1 block text-xs font-medium text-muted">Remarks</span>
              <input value={remarks} disabled={locked} onChange={(e) => setRemarks(e.target.value)} placeholder="Notes / defect reason…" className={cn(inp, "disabled:cursor-not-allowed disabled:bg-stone-100")} />
            </label>
            </div>

            {/* RIGHT column — photo proof + verdict */}
            <div className="space-y-4">
            {/* Photo proof */}
            {/* Naka-lock ang proof hangga't walang Line # + Cubic # sa receiving
                (hiling 2026-08-31) — lokasyon muna bago print at upload. */}
            <div className={cn((locked || (checkpoint === "receive" && (!zone.trim() || !location.trim()))) && "pointer-events-none opacity-60")}>
              <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
                <span>
                  Photo proof <span className="text-rose-600">*</span>
                  {checkpoint === "receive" && (!zone.trim() || !location.trim()) && <span className="ml-2 font-semibold text-rose-600">— select Line # and Cubic # first</span>}
                </span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", photos.length >= 1 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{photos.length} photo{photos.length === 1 ? "" : "s"}</span>
              </span>
              <MultiImageUpload value={photos} onChange={setPhotos} camera folder="warehouse-qc" />
            </div>

            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}

            {/* ── 3-step gate: Print → Scan → Movement (checkbox-style). Same for
                   QC IN (stock-in) and QC OUT (stock-out / dispatch). ── */}
            {(() => { const isOut = checkpoint === "prepack"; return (
              <div className="space-y-3 rounded-xl border border-[#e7dcc4] bg-[#faf8f3] p-3.5">
                {/* STEP 1 — Print */}
                <div className="flex items-center gap-3">
                  <StepDot done={printed} active={!printed} n={1} />
                  <button
                    onClick={printForVerify}
                    disabled={pending || photos.length < 1 || (checkpoint === "receive" && (!zone.trim() || !location.trim()))}
                    className={cn("flex-1 rounded-lg px-4 py-2.5 text-sm font-bold shadow-sm transition disabled:opacity-50", printed ? "border border-emerald-300 bg-white text-emerald-700" : "bg-[#4a3b1a] text-[#f4ead8] hover:opacity-90")}
                  >
                    {printed ? `✓ Print QR ${isOut ? "OUT" : "Passed"}` : `Print QR ${isOut ? "OUT" : "Passed"}`}
                  </button>
                </div>

                {/* STEP 2 — Waiting for barcode scan (faded until printed) */}
                <div className={cn("flex items-start gap-3 transition-opacity", !printed && "opacity-40")}>
                  <StepDot done={verified} active={printed && !verified} n={2} />
                  <div className="flex-1">
                    <p className="mb-1 text-xs font-bold text-[#4a3b1a]">{verified ? "✓ QR scanned — verified" : "Waiting for QR Scan"}</p>
                    <input
                      value={scanVerify}
                      onChange={(e) => onScanChange(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); verifyScan(); } }}
                      disabled={!printed || verified}
                      placeholder="Scan the label's BARCODE or QR…"
                      className={cn(inp, "w-full", verified && "border-emerald-300 bg-emerald-50")}
                    />
                    {scanErr && <p className="mt-1 text-[11px] font-semibold text-rose-600">{scanErr}</p>}
                    {!verified && !scanErr && printed && <p className="mt-1 text-[11px] text-muted">Scan the QR — {isOut ? "dispatch" : "stock-in"} is automatic (no button to press).</p>}
                    {printed && !verified && (
                      <p className="mt-1 break-all text-[10px] text-stone-400">
                        raw: <span className="font-mono">{scanVerify || "(none yet)"}</span> · expected: <span className="font-mono">{reservedQc?.sku || picked?.sku || picked?.product_name || "—"}</span>{reservedQc ? <> or <span className="font-mono">QC-{String(reservedQc.id).padStart(5, "0")}</span></> : null}
                      </p>
                    )}
                  </div>
                </div>

                {/* STEP 3 — Movement (faded until scanned; auto after scan) */}
                <div className={cn("flex items-center gap-3 transition-opacity", !verified && "opacity-40")}>
                  <StepDot done={verified && !pending} active={pending} n={3} />
                  <span className={cn("text-sm font-bold", verified ? "text-emerald-700" : "text-muted")}>
                    {pending ? (isOut ? "Dispatching…" : "Stocking in…") : verified ? `✓ Stock (${isOut ? "OUT" : "IN"}) — done` : `Stock (${isOut ? "OUT" : "IN"})`}
                  </span>
                </div>
              </div>
            ); })()}

            {/* Verdict. Neither QC IN nor QC OUT has a Pass button — the SCAN (step 2)
                auto-triggers the movement. Only Fail is manual (locks once printed). */}
            <div className="flex gap-2.5 pt-1">
              <button
                onClick={() => submit("fail")}
                disabled={pending || locked}
                className="flex-1 rounded-xl border-2 border-rose-200 bg-white px-4 py-3 text-sm font-bold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
              >
                ✕ Fail
              </button>
            </div>
            <p className="text-center text-[11px] text-muted">Inspector · <span className="font-medium text-foreground">{checkedBy}</span></p>
            </div>
            </div>
          </div>
      </div>
      </div>
      )}
    </div>
  );
}

// Manual entry for a brand-new arrival with no product/inventory record yet. On a
// PASS the server auto-creates the product + inventory row, then stocks in.
function QcNewItemModal({
  categories, onClose, onCreate,
}: {
  categories: string[];
  onClose: () => void;
  onCreate: (it: { product_name: string; sku: string; category: string; color: string; dimension: string; specs: string; unit_cost: number; image_url: string | null; product_type: string }) => void;
}) {
  const [name, setName] = useState("");
  // LAYOUT (2026-08-18) — 100% pareho ng Add Product / Customized builder:
  // auto SKU kada category, 12 categories, segmented Local/Imported, guided
  // specs + fabric picker. Ang Color ay hango sa fabric line ng specs.
  const [category, setCategory] = useState(MADE_TO_ORDER_CATEGORIES[0]);
  const [skuPreview, setSkuPreview] = useState("");
  const [ptype, setPtype] = useState<"" | "Local" | "Imported">("");
  const [cost, setCost] = useState("");
  const [specs, setSpecs] = useState(""); // isang linya kada detalye (bagong format)
  const [image, setImage] = useState<string | null>(null); // catalog photo (auto white bg)
  const [studioOpen, setStudioOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inp = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[#caa45a] focus:ring-1 focus:ring-[#caa45a]";
  const lbl = "mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]";

  useEffect(() => {
    let live = true;
    setSkuPreview("");
    nextMadeToOrderSku(category).then((s) => { if (live) setSkuPreview(s); }).catch(() => {});
    return () => { live = false; };
  }, [category]);

  function go() {
    if (!name.trim()) { setErr("Enter the product name."); return; }
    if (!ptype) { setErr("Select Local or Imported."); return; }
    const fabricLine = /^(?:Fabric(?:\s*\/\s*Finish)?|Upholstered Finish):\s*(.+)$/m.exec(specs)?.[1]?.trim() ?? "";
    onCreate({
      product_name: name.trim(), sku: skuPreview, category,
      color: fabricLine, dimension: "", specs: specs.trim(), unit_cost: Number(cost) || 0, image_url: image,
      product_type: ptype,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      {/* Mas malapad (2026-08-19) — kasya ang guided spec steppers/chips. */}
      <div className="my-6 w-full max-w-2xl overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 py-3.5 text-[#f4ead8]" style={{ background: `linear-gradient(to bottom, #52421d, ${BROWN})` }}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#caa45a] text-base">＋</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold tracking-wide">New Item</div>
            <div className="text-[11px] opacity-80">No record yet — pass creates the product + stocks in</div>
          </div>
          <button onClick={onClose} className="ml-1 text-[#e7dcc4] hover:text-white">✕</button>
        </div>
        <div className="space-y-3 p-4">
          {/* Catalog photo — snap the real item, background auto-whitened on-device. */}
          <div className="block">
            <span className={lbl}>Photos <span className="font-normal normal-case tracking-normal text-muted/70">(auto white background)</span></span>
            <div className="flex items-center gap-3">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white">
                {image
                  /* eslint-disable-next-line @next/next/no-img-element */
                  ? <img src={image} alt="" className="h-full w-full object-contain" />
                  : <span className="text-[10px] text-muted">No photo</span>}
              </div>
              <div className="flex flex-col gap-2">
                <button type="button" onClick={() => setStudioOpen(true)} className="rounded-lg bg-[#4a3b1a] px-3 py-2 text-xs font-semibold text-[#f4ead8] transition hover:opacity-90">
                  {image ? "↺ Retake photo" : "Take photo"}
                </button>
                {image && (
                  <button type="button" onClick={() => setImage(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition hover:bg-stone-50">Remove</button>
                )}
                <p className="max-w-[9rem] text-[10px] leading-tight text-muted">Snap the item — background is auto-removed to white.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <span className={lbl}>SKU · auto</span>
              <input value={skuPreview || "…"} readOnly className={cn(inp, "cursor-not-allowed bg-stone-100 text-xs font-mono text-muted")} title="Auto per category — final on Pass → Stock In" />
            </div>
            <div>
              <span className={lbl}>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={cn(inp, "text-xs")}>
                {MADE_TO_ORDER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <span className={lbl}>Product Type *</span>
              <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border">
                {(["Local", "Imported"] as const).map((t, ti) => (
                  <button key={t} type="button" onClick={() => setPtype(t)} className={`px-1 py-1.5 text-xs font-bold ${ti > 0 ? "border-l border-border" : ""} ${ptype === t ? (t === "Imported" ? "bg-blue-700 text-white" : "bg-emerald-700 text-white") : "bg-surface text-muted hover:bg-stone-100"}`}>
                    {t}{ptype === t ? " ✓" : ""}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <span className={lbl}>Product / Name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Customized L-shape Sofa" className={inp} autoFocus />
          </div>
          <div>
            <span className={lbl}>Unit cost (for loss tracking)</span>
            <input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" className={inp} />
          </div>
          {/* SPECS — guided per-category fields + fabric picker, parehong
              panels ng Customized builder / Add Product. */}
          <SpecFieldsInput category={category} withFabricPicker onChange={setSpecs} />
          {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</p>}
          <button onClick={go} className="w-full rounded-lg bg-[#4a3b1a] px-4 py-2.5 text-sm font-bold text-[#f4ead8] transition hover:opacity-90">
            Use this item → inspect
          </button>
          <p className="text-center text-[11px] text-muted">The product + inventory record is created when you mark it <b>Pass → Stock In</b>.</p>
        </div>
      </div>
      {studioOpen && (
        <ProductPhotoStudio
          folder="products"
          onDone={(url) => setImage(url)}
          onClose={() => setStudioOpen(false)}
        />
      )}
    </div>
  );
}

// Manual product browser — category sidebar + searchable list + preview. Mirrors
// the Create-Order picker for items that have no scannable label yet (new arrivals).
// L × W × H dimension boxes for the QC browser preview (synced to "LxWxH cm").
function QcDimBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const m = /^\s*([\d.]*)\s*[x×]\s*([\d.]*)\s*[x×]\s*([\d.]*)\s*([a-z]*)/i.exec(value || "");
  const l = m?.[1] || "", w = m?.[2] || "", h = m?.[3] || "", unit = (m?.[4] || "cm").toLowerCase();
  const push = (nl: string, nw: string, nh: string, nu: string) =>
    onChange((nl || nw || nh) ? `${nl || 0}x${nw || 0}x${nh || 0} ${nu}` : "");
  const clean = (s: string) => s.replace(/[^\d.]/g, "");
  const box = cn(INP_CLS, "w-full text-center text-xs");
  return (
    <div className="flex items-center gap-1">
      <input value={l} onChange={(e) => push(clean(e.target.value), w, h, unit)} inputMode="decimal" placeholder="L" className={box} />
      <span className="text-[10px] text-muted">×</span>
      <input value={w} onChange={(e) => push(l, clean(e.target.value), h, unit)} inputMode="decimal" placeholder="W" className={box} />
      <span className="text-[10px] text-muted">×</span>
      <input value={h} onChange={(e) => push(l, w, clean(e.target.value), unit)} inputMode="decimal" placeholder="H" className={box} />
      <select value={unit} onChange={(e) => push(l, w, h, e.target.value)} className={cn(INP_CLS, "text-xs")}>
        <option value="cm">cm</option><option value="in">in</option><option value="mm">mm</option><option value="m">m</option>
      </select>
    </div>
  );
}

function QcProductBrowser({
  catalog, onClose, onPick,
}: {
  catalog: QcCatalogItem[];
  onClose: () => void;
  onPick: (c: QcCatalogItem) => void;
}) {
  const [q, setQ] = useState("");
  const [selCat, setSelCat] = useState<string | null>(null);
  const [hovered, setHovered] = useState<QcCatalogItem | null>(null);
  // Editable copy of the selected item's details — seeded (autofilled) whenever the
  // selection changes, then edited freely before inspecting.
  const [edit, setEdit] = useState<{ product_name: string; color: string; dimension: string }>(
    { product_name: "", color: "", dimension: "" },
  );

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return catalog;
    return catalog.filter((p) => (p.product_name ?? "").toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)).slice(0, 200);
  }, [catalog, q]);

  const groups = useMemo(() => {
    const out: [string, QcCatalogItem[]][] = [];
    const idx = new Map<string, QcCatalogItem[]>();
    for (const p of list) {
      const c = (p.category && p.category.trim()) || "Uncategorized";
      let arr = idx.get(c);
      if (!arr) { arr = []; idx.set(c, arr); out.push([c, arr]); }
      arr.push(p);
    }
    return out;
  }, [list]);

  const activeCat = (selCat && groups.some(([c]) => c === selCat)) ? selCat : groups[0]?.[0] ?? null;
  const activeItems = groups.find(([c]) => c === activeCat)?.[1] ?? [];
  const d = hovered ?? activeItems[0] ?? null;

  // Autofill the editable fields whenever the selected item changes.
  const dSku = d?.sku ?? "";
  useEffect(() => {
    setEdit({ product_name: d?.product_name ?? "", color: d?.color ?? "", dimension: d?.dimension ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dSku]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="flex h-[80vh] w-[min(58rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        {/* Header + search */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3.5" style={{ background: `linear-gradient(to bottom, #52421d, ${BROWN})` }}>

          <div className="flex-1">
            <div className="text-sm font-bold text-[#f4ead8]">Browse Products</div>
            <div className="text-[11px] text-[#e7dcc4]/80">Pick an item to inspect — for new arrivals with no label yet</div>
          </div>
          <button onClick={onClose} className="text-[#e7dcc4] hover:text-white">✕</button>
        </div>
        <div className="border-b border-border bg-stone-50 px-4 py-2.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search product name or SKU…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[#caa45a] focus:ring-1 focus:ring-[#caa45a]"
            autoFocus
          />
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Categories */}
          <div className="flex w-48 shrink-0 flex-col border-r border-border bg-stone-50">
            <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted">Category</div>
            <div className="flex-1 overflow-y-auto py-1">
              {groups.map(([c, ps]) => (
                <button key={c} type="button" onClick={() => setSelCat(c)} className={cn("flex w-full items-center justify-between gap-1 px-3 py-2 text-left text-xs", activeCat === c ? "bg-[#faf6ec] font-bold text-[#4a3b1a]" : "text-foreground hover:bg-stone-100")}>
                  <span className="truncate">{c}</span>
                  <span className="shrink-0 text-muted">{ps.length}</span>
                </button>
              ))}
              {groups.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted">No match.</p>}
            </div>
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto">
            <div className="sticky top-0 border-b border-border bg-stone-100 px-3 py-1.5 text-xs font-bold">{activeCat ?? "—"} {activeCat && <span className="font-normal text-muted">({activeItems.length})</span>}</div>
            {activeItems.map((p) => (
              <button
                key={p.sku}
                type="button"
                onMouseEnter={() => setHovered(p)}
                onClick={() => onPick(p)}
                className={cn("flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-stone-100", hovered?.sku === p.sku ? "bg-[#faf8f3]" : "")}
              >
                {p.image_url
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img loading="lazy" src={sizedImg(p.image_url,90)} alt="" className="h-9 w-9 shrink-0 rounded object-cover ring-1 ring-border" />
                  : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-stone-200 text-[9px] font-semibold text-stone-500">{(p.product_name ?? "?").slice(0, 2).toUpperCase()}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{p.product_name ?? "—"}</span>
                  <span className="block font-mono text-xs text-muted">{p.sku}</span>
                </span>
                <span className="shrink-0 text-[#caa45a]">›</span>
              </button>
            ))}
            {activeItems.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted">No products in this category.</p>}
          </div>

          {/* Preview */}
          <div className="hidden w-60 shrink-0 flex-col border-l border-border bg-stone-50 md:flex">
            {d ? (
              <div className="flex flex-1 flex-col overflow-y-auto p-3">
                {d.image_url
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img loading="lazy" src={d.image_url} alt="" className="mb-3 h-36 w-full rounded-lg bg-white object-contain ring-1 ring-border" />
                  : <div className="mb-3 flex h-36 w-full items-center justify-center rounded-lg bg-stone-200 text-xs text-stone-500">No image</div>}
                {d.sku && <span className="mb-2 inline-block w-fit rounded bg-stone-200 px-1.5 py-0.5 font-mono text-[10px] text-stone-600">{d.sku}</span>}
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Editable Fields</p>
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="mb-0.5 block text-[10px] text-muted">Product / Name</label>
                    <input value={edit.product_name} onChange={(e) => setEdit((p) => ({ ...p, product_name: e.target.value }))} className={cn(INP_CLS, "w-full text-xs")} />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] text-muted">Color</label>
                    <input value={edit.color} onChange={(e) => setEdit((p) => ({ ...p, color: e.target.value }))} className={cn(INP_CLS, "w-full text-xs")} />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] text-muted">Dimension (L × W × H)</label>
                    <QcDimBoxes value={edit.dimension} onChange={(v) => setEdit((p) => ({ ...p, dimension: v }))} />
                  </div>
                  {/* SPECS bullets (bagong format 2026-08-18) — read-only. */}
                  {(d.specs ?? "").trim() && (
                    <div>
                      <label className="mb-0.5 block text-[10px] text-muted">Specifications / Design details</label>
                      <div className="rounded-lg border border-border bg-stone-50 px-2 py-1.5 text-[11px] text-muted">
                        {(d.specs ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => (
                          <div key={i} className="py-0.5">• {l.replace(/^[•·\-\s]+/, "")}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="text-[10px] text-muted">Category: <span className="font-medium text-foreground">{d.category ?? "—"}</span></div>
                </div>
                <button onClick={() => onPick({ ...d, product_name: edit.product_name || null, color: edit.color || null, dimension: edit.dimension || null })} className="mt-auto rounded-lg bg-[#4a3b1a] px-4 py-2.5 text-sm font-bold text-[#f4ead8] transition hover:opacity-90">
                  Inspect this item →
                </button>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted">Hover an item to preview.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Direction pill for a QC record: receive = IN (green), prepack = OUT (blue).
function dirPill(checkpoint: "receive" | "prepack") {
  return checkpoint === "receive"
    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">▼ IN</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 ring-1 ring-inset ring-sky-200">▲ OUT</span>;
}

function QcHistory({ rows, onView }: { rows: QcRow[]; onView: (r: QcRow) => void }) {
  // In/Out filter for the combined log. "all" shows every QC record.
  const [dir, setDir] = useState<"all" | "receive" | "prepack">("all");
  const shown = dir === "all" ? rows : rows.filter((r) => r.checkpoint === dir);
  const pg = usePagination(shown, 25);
  // WALANG running Qty Before/After dito — ang QC log ay INSPECTION events lang;
  // hindi nito nakikita ang ibang stock moves (hal. delivery dispatch), kaya ang
  // computed balance ay nagne-negative at nakakalito. Ang Stock Movement Ledger
  // ang authoritative sa before/after.

  const fCls = (on: boolean) => cn("rounded px-2 py-0.5 text-[10px] font-bold transition-colors", on ? "bg-[#caa45a] text-[#3a2a05]" : "text-[#f4ead8]/60 hover:text-[#f4ead8]");
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="max-h-[70vh] overflow-auto">
        {/* Same grouped-header format as the Stock Movement Ledger — Product
            Information · Inspection · Movement · Record — para pare-pareho ang
            hitsura ng mga log tables. */}
        <table className="w-full min-w-[1200px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:px-4 [&_td]:py-3 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-[#caa45a]/40 [&_th:last-child]:border-r-0">
          <colgroup>
            <col span={5} />
            <col span={4} />
            <col span={2} />
            <col span={4} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={6} className="border-b border-[#caa45a] px-5 py-2">Product Information</th>
              <th colSpan={4} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Inspection</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Movement</th>
              <th colSpan={4} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">
                <span className="flex items-center justify-between gap-2 normal-case">
                  <span>Record</span>
                  <span className="inline-flex gap-1 rounded bg-black/20 p-0.5">
                    <button onClick={() => setDir("all")} className={fCls(dir === "all")}>All ({rows.length})</button>
                    <button onClick={() => setDir("receive")} className={fCls(dir === "receive")}>IN</button>
                    <button onClick={() => setDir("prepack")} className={fCls(dir === "prepack")}>OUT</button>
                  </span>
                </span>
              </th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="px-3 py-3">Photo</th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Color</th>
              {/* SPECS, hindi Dimension (2026-08-23): sa custom na produkto,
                  ang dimension column ay laging blangko — nasa build lines ang
                  totoong sukat. */}
              <th className="px-4 py-3">Specs</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Qty</th>
              <th className="px-4 py-3">Good</th>
              <th className="px-4 py-3">Defect</th>
              <th className="px-4 py-3">Result</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Direction</th>
              <th className="px-4 py-3">Qty</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Order #</th>
              <th className="px-4 py-3">RMA #</th>
              <th className="px-4 py-3">Inspector</th>
              <th className="px-4 py-3">Time</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={15} className="!py-12 text-center text-muted">

                No inspections yet.
              </td></tr>
            ) : pg.slice.map((r) => {
              const isIn = r.checkpoint === "receive";
              // A pass only counts as MOVED once its scan-gated stock movement ran
              // (stocked_at). One that was never scanned shows a dash — nothing
              // moved — and its line is still waiting in Quality Control (OUT).
              const moved = r.result === "pass" && r.stocked_at != null;
              return (
                <tr key={r.id} onClick={() => onView(r)} className="cursor-pointer border-b border-border last:border-0 hover:bg-stone-50">
                  {/* Hiwalay na hanay ang larawan. */}
                  <td className="px-3 py-3">
                    <span className="flex justify-center">
                      {r.image_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={sizedImg(r.image_url, 80)} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-border" />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-sm text-stone-400"></span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center font-medium">
                    <span className="flex items-center justify-center">
                      {/* Sapat na lapad para HINDI maging "B…" ang pangalan — may
                          horizontal scroll naman ang table kaya ok ang min width. */}
                      <span className="min-w-[160px] max-w-[240px]">
                        <span className="block truncate text-center" title={r.product_name ?? ""}>{r.product_name ?? "—"}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs text-muted">{r.sku ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-center text-xs">{realValue(r.category) ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-center text-xs">
                    {(() => {
                      const c = realValue(r.color);
                      return c ? <span className="mx-auto block max-w-[140px] truncate" title={c}>{c}</span> : "—";
                    })()}
                  </td>
                  {/* ISANG LINYA (2026-08-25). Isang bloke kada spec ito noon,
                      kaya ang isang sofa na may apat na spec ay may hilerang
                      apat na beses ang taas ng katabi — at ang mahahabang salita
                      ay nakabali pa. Pinagsama sa isang linya, may buong laman sa
                      hover; ang review modal ang nagpapakita ng hinati-hati. */}
                  <td className="whitespace-nowrap px-4 py-3 text-center text-xs">
                    {(() => {
                      const sp = buildSpecLines(r);
                      const txt = sp.length ? sp.join(" · ") : (realValue(r.dimension) ?? "");
                      return txt
                        ? <span className="mx-auto block max-w-[280px] truncate" title={txt}>{txt}</span>
                        : "—";
                    })()}
                  </td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center tabular-nums">{number(r.qty)}</td>
                  <td className="px-4 py-3 text-center font-semibold tabular-nums text-emerald-700">{number(r.good_qty)}</td>
                  <td className="px-4 py-3 text-center font-semibold tabular-nums text-rose-700">{r.defect_qty > 0 ? number(r.defect_qty) : "—"}</td>
                  <td className="px-4 py-3 text-center">{resultPill(r.result)}</td>
                  <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center">{dirPill(r.checkpoint)}</td>
                  <td className="px-4 py-3 text-center">
                    {moved ? (
                      <span className={cn("inline-flex items-center justify-center rounded-full px-3 py-1 text-sm font-bold ring-1 ring-inset", isIn ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-sky-50 text-sky-700 ring-sky-200")}>
                        {isIn ? "+" : "−"}{number(r.good_qty)}
                      </span>
                    ) : (
                      // WALANG GALAW, WALANG BILANG. Ang "scan" na chip dito noon
                      // ay nagmumukhang katayuan ng talang ito, samantalang ang
                      // ibig sabihin lang niyon ay hindi ito na-scan — at ang
                      // linya ay nasa pila pa rin ng Quality Control (OUT), doon
                      // ito inuulit. Gitling: walang kalakal na gumalaw.
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="!border-l-4 !border-l-[#caa45a] whitespace-nowrap px-4 py-3 text-center font-mono text-xs">{r.order_number ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-center font-mono text-xs font-bold text-amber-700">{r.rma ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-center text-xs text-muted">{r.checked_by ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-center text-xs text-muted">{when(r.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PaginationFooter page={pg.page} setPage={pg.setPage} pageSize={pg.pageSize} setPageSize={pg.setPageSize} total={pg.total} pages={pg.pages} />
    </section>
  );
}

// Read-only detail of a past QC inspection — item specs + the photo proof, so a
// record is easy to revisit. Photos open in a new tab on click.
// Exported so the Stock Movement Ledger can reuse the EXACT same modal (with the
// hover-to-enlarge photo preview) for its QC-derived movement rows.
export function QcRecordDetail({ row, specs, onClose }: { row: QcRow; specs?: string | null; onClose: () => void }) {
  const [hoverImg, setHoverImg] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center gap-4 overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-xl overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 text-[#f4ead8]" style={{ background: `linear-gradient(to bottom, #52421d, ${BROWN})` }}>
          {/* Larawan ng produkto ang preview — dating blangkong gintong kahon. */}
          {row.image_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={row.image_url} alt="" className="h-9 w-9 shrink-0 rounded-lg bg-white object-cover ring-1 ring-[#caa45a]" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#caa45a] text-xs font-bold text-[#4a3b1a]">
              {(row.product_name ?? row.sku ?? "?").slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold tracking-wide">{row.checkpoint === "receive" ? "Receiving QC" : "QC for OUT"} · {row.product_name ?? row.sku ?? "Item"}</div>
            {/* Unang linya lang ng ref_label — ang buong specs ay nasa katawan
                na ng modal, hindi na isinisiksik dito. */}
            {(() => {
              const refLine = String(row.ref_label ?? "").split("\n")[0].trim();
              const sub = [
                refLine && refLine !== (row.product_name ?? "") ? refLine : row.sku,
                when(row.created_at),
              ].filter(Boolean).join(" · ");
              return <div className="truncate text-[11px] opacity-80">{sub}</div>;
            })()}
          </div>
          {resultPill(row.result)}
          <button onClick={onClose} className="ml-1 text-[#e7dcc4] hover:text-white">✕</button>
        </div>

        <div className="space-y-4 p-5">
          {/* IISANG PORMA SA LAHAT NG MODAL (2026-08-23).

              Ang Product Details ng Orders/Operations ay may guided spec cards
              (SpecFieldsView) — ang parehong itsura ng Customized builder at ng
              Edit Inventory Item. Ang QC at ang Stock Movement Ledger ay may
              sariling itsura: mono na tekstong tumpok. Iisang record, tatlong
              magkaibang mukha.

              Pareho na sila ngayon. Ang pinagmumulan ng specs, ayon sa pagkakasunod:
                1. ang specs ng catalog (ibinibigay ng QC page), kung saan naroon
                   ang buong guided template ng produkto;
                2. ang build lines na nakasiksik sa category/color/dimension —
                   ito ang tanging meron ng Ledger, na walang catalog lookup.

              Ang tunay na category/color ng simpleng stock ay nananatiling
              hilera; ang build line (may tutuldok) ay hindi na inuulit doon. */}
          {(() => {
            const build = buildSpecLines(row);
            const specText = build.length ? build.join("\n") : (specs ?? "");
            // Kapag ang category column ay build line pala, wala nang natitirang
            // category — at kung walang category, walang template ang
            // SpecFieldsView. Ang pangalan ng produkto ang pinagkukunan.
            const specCat = specCategoryOf(row.category, row.product_name);
            const hasFabric = /^(Fabric(\s*\/\s*Finish)?|Upholstered Finish):/m.test(specText);
            const rows: Array<[string, React.ReactNode]> = [
              // Iisang hulma ng Product Details (2026-08-23): ang Product at
              // ang SKU ay hilera rin, kasama ng Category.
              ["Product", row.product_name],
              // Ang SKU at ang pinagmulan ay dating chip sa sariling kahon sa
              // itaas. Naging hilera na rin sila: ang natitirang isang maliit
              // na pill sa isang buong-lapad na kahon ay mukhang blangko.
              ...(row.sku ? [["SKU", <span key="sku" className="font-mono">{row.sku}</span>] as [string, React.ReactNode]] : []),
              ...(realValue(row.category) ? [["Category", realValue(row.category)] as [string, React.ReactNode]] : []),
              ...(!hasFabric && realValue(row.color) ? [["Color", realValue(row.color)] as [string, React.ReactNode]] : []),
              ...(realValue(row.dimension) ? [["Dimension", realValue(row.dimension)] as [string, React.ReactNode]] : []),
              ["Inspector", row.checked_by],
              ["When", when(row.created_at)],
              ["Source", sourcePill(row.source)],
            ];
            return (
              <>
                <SpecRows items={rows} />
                {/* May sariling pamagat na ang SpecFieldsView — huwag ulitin. */}
                {specText.trim() && (
                  <div className="mt-3">
                    <SpecFieldsView category={specCat} specs={specText} />
                  </div>
                )}
              </>
            );
          })()}

          {/* Result quantities */}
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border">
            <div className="bg-surface p-3 text-center"><div className="text-[10px] uppercase text-muted">Total</div><div className="text-lg font-bold tabular-nums">{number(row.qty)}</div></div>
            <div className="bg-surface p-3 text-center"><div className="text-[10px] uppercase text-muted">Good</div><div className="text-lg font-bold tabular-nums text-emerald-700">{number(row.good_qty)}</div></div>
            <div className="bg-surface p-3 text-center"><div className="text-[10px] uppercase text-muted">Defect</div><div className="text-lg font-bold tabular-nums text-rose-700">{number(row.defect_qty)}</div></div>
          </div>

          {row.remarks && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><b>Remarks:</b> {row.remarks}</div>}

          {/* Photo proof — hover a thumbnail to enlarge in the side panel. */}
          <div>
            <p className="mb-2 text-xs font-semibold text-[#4a3b1a]">Photo proof ({row.photos.length})</p>
            {row.photos.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted">No photos.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {row.photos.map((p, i) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={i}
                    src={p}
                    alt=""
                    loading="lazy"
                    onMouseEnter={() => setHoverImg(p)}
                    onMouseLeave={() => setHoverImg(null)}
                    className="aspect-square w-full cursor-zoom-in rounded-lg object-cover ring-1 ring-border hover:ring-2 hover:ring-[#caa45a]"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Enlarged hover preview — fixed side panel (reserved space) so hovering a
          photo never shifts the modal layout. */}
      <div className="pointer-events-none fixed right-4 top-1/2 z-[70] hidden w-[min(42vw,640px)] -translate-y-1/2 xl:block">
        {hoverImg && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={hoverImg} alt="" className="max-h-[85vh] w-full rounded-xl border-4 border-white bg-white object-contain shadow-2xl" />
        )}
      </div>
    </div>
  );
}
