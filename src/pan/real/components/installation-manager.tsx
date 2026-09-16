"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { realValue } from "@/lib/product-columns";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { cn, SpecRows, ReworkCell } from "./ui";
import { ProductPreviewModal, previewFromItem, type ProductPreview } from "./product-preview-modal";
import { SpecFieldsView } from "./spec-fields-input";
import { specCategoryOf } from "./line-items-editor";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { MultiImageUpload } from "./multi-image-upload";
import { SignaturePad } from "./signature-pad";
import { type EmpOpt } from "./employee-picker";
import { InstallerPayment } from "./installer-payment";
import { ReworkInstallerPayment } from "./rework-installer-payment";
import { uploadProductImage } from "@/app/products/actions";
import type { InstallationData, Installation } from "@/app/installation/data";
import { RushBadge } from "./rush-badge";
import { saveInstallation, deleteInstallation, type InstallationInput } from "@/app/installation/actions";
// DECLARE RETURN DITO RIN (hiling 2026-08-29). Ang installer ang huling
// nakahawak sa gamit at siya ang nakakakita ng sira habang binubuo ito — kaya
// hindi lang sa Delivery Tracker dapat matawag ang RMA. Parehong form, parehong
// gated action (createReturnFromDelivery).
import { NewReturnModal } from "./returns-manager";
import { createReturnFromDelivery, type CreateReturnInput } from "@/app/returns/actions";
import type { OrderOption, PoOption, WorkshopOption } from "@/app/returns/data";

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const STATUSES = ["In Progress", "Delivered"];
const DURATIONS = ["6 Months", "1 Year", "2 Years", "3 Years", "5 Years"];

// Compute warranty end date from start + "1 Year" / "6 Months" etc.
function addDuration(start: string, dur: string): string {
  if (!start) return "";
  const d = new Date(start + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  const m = dur.match(/(\d+)\s*(month|year)/i);
  if (m) { const n = Number(m[1]); if (/year/i.test(m[2])) d.setFullYear(d.getFullYear() + n); else d.setMonth(d.getMonth() + n); }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Warranty No. is derived from the order number (1:1) — strip an "ORD-" prefix: ORD-000003 → WR-000003.
function warrantyNo(orderNumber: string | null, id?: number | null): string {
  if (orderNumber) return `WR-${orderNumber.replace(/^ord-?/i, "")}`;
  return id ? `WR-${String(id).padStart(6, "0")}` : "—";
}

function statusPill(s: string) {
  const v = (s ?? "").toLowerCase();
  if (/delivered|completed/.test(v)) return "bg-green-50 text-green-700";
  if (/in progress|installation/.test(v)) return "bg-blue-50 text-blue-700";
  if (/arrived/.test(v)) return "bg-teal-50 text-teal-700";
  return "bg-amber-50 text-amber-700";
}

export function InstallationManager({ data, installers = [], canEditDelivered = true, collectorName = "", returnOrders = [], returnPos = [], returnWorkshops = [] }: { data: InstallationData; installers?: EmpOpt[]; canEditDelivered?: boolean; collectorName?: string; returnOrders?: OrderOption[]; returnPos?: PoOption[]; returnWorkshops?: WorkshopOption[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Installation | null>(null);
  // DALAWANG TANAW (hiling 2026-08-28). Ang gagawin pa at ang tapos na ay
  // pinagsasama sa isang listahan — 18 hilera dito, at ang kailangang gawin
  // ngayon ay nakahalo sa mga natapos na noong nakaraang linggo. Ang
  // "Installation" ang gawain; ang "Delivered" ay talaan.
  const [tab, setTab] = useState<"work" | "done">("work");
  const isDone = (r: Installation) => /delivered|completed/i.test(r.status ?? "");

  const scoped = useMemo(
    () => data.rows.filter((r) => (tab === "done" ? isDone(r) : !isDone(r))),
    [data.rows, tab],
  );
  const doneCount = useMemo(() => data.rows.filter(isDone).length, [data.rows]);
  const workCount = data.rows.length - doneCount;

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtered = scoped.filter((r) => !s || [r.order_number, r.customer_name, r.installer_team, r.installer_names, r.rework_crew, r.rma_no, r.status].some((x) => (x ?? "").toLowerCase().includes(s)));
    // ANG REWORK AY NASA IBABAW (2026-09-01, hiling ni Joe): ang rework install
    // ay nakasakay sa nire-repurpose na LUMANG deliveries row, kaya sa
    // created_at na ayos ay lumulubog ito sa baba kahit ito ang pinakabagong
    // trabaho. Stable ang sort — sa loob ng bawat pangkat, dating ayos pa rin.
    return [...filtered].sort((a, b) => Number(!!b.rma_no) - Number(!!a.rma_no));
  }, [scoped, q]);

  const pg = usePagination(rows);
  const onCallSet = useMemo(() => new Set(installers.filter((o) => o.on_call).map((o) => o.name)), [installers]);

  return (
    <div className="space-y-5">
      <div className="apk-hide grid grid-cols-3 gap-3">
        <Kpi label="To Install" value={String(data.kpi.scheduled)} accent="bg-amber-100 text-amber-600" />
        <Kpi label="In Progress" value={String(data.kpi.inProgress)} accent="bg-blue-100 text-blue-600" />
        <Kpi label="Delivered" value={String(data.kpi.completed)} accent="bg-green-100 text-green-600" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order / customer / installer…" className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
        <span className="text-xs text-muted">
          {tab === "done"
            ? "Finished installs — read-only record."
            : "Auto-listed from Out-for-Delivery / Delivered orders · click a row to install"}
        </span>
        {/* Sa DULO ng toolbar: ang hanapan ang pangunahing gamit dito, at ang
            paglipat ng tanaw ay bihira — hindi ito dapat mauna sa mata. */}
        <div className="ml-auto flex gap-1.5">
          {([["work", "Pending", workCount], ["done", "Completed", doneCount]] as const).map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={cn("rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors",
                tab === k ? "bg-[#4a3b1a] text-[#f4ead8]" : "border border-border bg-surface text-muted hover:bg-stone-100")}>
              {label} · {n}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-visible rounded-xl border border-border bg-surface shadow-sm">
        <div className="max-h-[70vh] overflow-auto rounded-t-xl">
        <table className="w-full min-w-[820px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <colgroup>
            <col span={5} />
            <col span={3} />
            <col span={2} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={7} className="border-b border-[#caa45a] px-5 py-2">Order</th>
              <th colSpan={5} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Install</th>
              <th colSpan={2} className="border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Payment</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="px-4 py-3">Order #</th>
              <th className="px-4 py-3">RMA #</th>
              <th className="px-4 py-3">Warranty #</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Sales Rep</th>
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3">Workshop</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Install Date</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Installer</th>
              <th className="px-4 py-3">Warranty</th>
              <th className="!border-l-4 !border-l-[#caa45a] px-4 py-3">Pending Payment</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={14} className="px-4 py-12 text-center text-muted">No items to install. Out-for-Delivery / Delivered orders appear here.</td></tr>
            ) : pg.slice.map((r) => (
              <tr key={`${r.order_id ?? r.delivery_id}-${r.id ?? "new"}-${r.is_rework ? "rw" : "o"}`} onClick={() => setOpen(r)} className="cursor-pointer border-b border-border last:border-0 hover:bg-stone-50">
                {/* Isang linya ang bawat cell para normal ang row height. */}
                <td className="px-4 py-3 font-semibold">
                  <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                    <RushBadge isRush={r.is_rush} dateOrder={r.date_purchase} threshold={r.rush_days ?? data.rushThreshold} done={/delivered|completed/i.test(`${r.delivery_status ?? ""} ${r.status ?? ""}`)} />
                    <span className="whitespace-nowrap">{r.order_number || "—"}</span>
                  </div>
                  {/* PARTIAL na tag (2026-09-01): bukas pa ang partial delivery
                      ng order — batch pa lang ang install na ito. */}
                  {r.partial_open && (
                    <span className="mx-auto mt-1 block w-fit whitespace-nowrap rounded-full bg-[#faf1dc] px-2 py-0.5 text-[10px] font-bold text-[#8a6a1f] ring-1 ring-inset ring-[#caa45a]/40">PARTIAL</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <ReworkCell isRework={r.is_rework} rmaNo={r.rma_no} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-primary">{warrantyNo(r.order_number, r.id)}</td>
                <td className="whitespace-nowrap px-4 py-3">{r.customer_name || "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-center">{r.sales_rep || "—"}</td>
                <td className="px-4 py-3 text-muted"><div className="max-w-[220px] truncate" title={r.address || ""}>{r.address || "—"}</div></td>
                <td className="px-4 py-3 text-center">
                  {/* Walang workshop job = direct mula sa stock — Warehouse ang
                      pinagmulan, hindi blangko. */}
                  {r.workshop_name
                    ? <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700 ring-1 ring-inset ring-orange-200">{r.workshop_name}</span>
                    : <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-600 ring-1 ring-inset ring-stone-200">Warehouse</span>}
                </td>
                <td className="!border-l-4 !border-l-[#caa45a] whitespace-nowrap px-4 py-3 text-center text-muted">{r.install_date || "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-center">{r.team_label || "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-center text-muted">{r.team_driver || r.driver_team || "—"}</td>
                {/* Isang linya ang mga installer — buong listahan sa tooltip
                    kapag naputol; kasama pa rin ang On Call chip inline. */}
                <td className="whitespace-nowrap px-4 py-3 text-center text-muted">{r.installer_names
                  ? <span className="mx-auto block max-w-[240px] truncate" title={r.installer_names.split(", ").map((n) => onCallSet.has(n) ? `${n} (On Call)` : n).join(", ")}>
                      {r.installer_names.split(", ").map((n, i) => (
                        <span key={n}>{i > 0 && ", "}{n}{onCallSet.has(n) && <span className="ml-0.5 rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-700">On Call</span>}</span>
                      ))}
                    </span>
                  : (r.installer_team || "—")}
                  {/* Ang crew ng rework ay hiwalay sa installer: sila ang
                      kumukumpuni, hindi nag-i-install — pero magkasama sa isang
                      biyahe, kaya dito nakadikit. */}
                  {r.is_rework && r.rework_crew && (
                    <span className="mt-1 block text-[10px] font-semibold text-amber-700">
                      Repair: {r.rework_crew}
                    </span>
                  )}</td>
                <td className="px-4 py-3 text-center text-muted">{r.warranty_duration || "—"}</td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center">{r.balance > 0
                  ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">₱{r.balance.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</span>
                  : <span className="text-xs font-medium text-success">✓ Paid</span>}</td>
                <td className="px-4 py-3 text-center"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusPill(r.status))}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <PaginationFooter {...pg} />
      </div>

      {/* LOCKED pagkatapos ng Delivered — view-only sa teams; Admin/Ops lang ang maka-e-edit. */}
      {open && <InstallModal it={open} onClose={() => setOpen(null)} installers={installers} collectorName={collectorName}
        returnOrders={returnOrders} returnPos={returnPos} returnWorkshops={returnWorkshops}
        readOnly={!canEditDelivered && !open.is_rework && /delivered|completed/i.test(open.status ?? "")} />}
    </div>
  );
}

function InstallModal({ it, onClose, installers = [], readOnly = false, collectorName = "", returnOrders = [], returnPos = [], returnWorkshops = [] }: { it: Installation; onClose: () => void; installers?: EmpOpt[]; readOnly?: boolean; collectorName?: string; returnOrders?: OrderOption[]; returnPos?: PoOption[]; returnWorkshops?: WorkshopOption[] }) {
  const [pending, start] = useTransition();
  const [delPending, startDel] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [declareOpen, setDeclareOpen] = useState(false);
  const router = useRouter();

  // ANG ORDER NA IDEDEKLARA. Ang picker ang pinagmumulan kapag naroon (buo ang
  // presyo at balanse doon); kung wala — hal. isang order na hindi umabot sa
  // listahan ng Returns — binubuo ito mula sa hawak na ng install record, kaya
  // hindi nawawala ang buton dahil lang sa kulang ang picker. Kapareho ng
  // returnOrderOption sa delivery-manager.
  const returnOrderOption: OrderOption | null = useMemo(() => {
    if (it.order_id == null) return null;
    const fromPicker = returnOrders.find((o) => o.id === it.order_id);
    if (fromPicker) return fromPicker;
    return {
      id: it.order_id,
      order_number: it.order_number,
      customer_name: it.customer_name,
      balance: Math.max(Number(it.balance) || 0, 0),
      items: (it.items ?? []).map((x) => ({
        // BUONG DESCRIPTION, hindi ang unang linya lang. Ang RMA form ay
        // kumukuha ng Specifications / Design details mula rito — hinahati
        // nito ang description at ang mga sumunod na linya ang specs. Ang
        // InstallItem ay hiwalay ang dalawa, kaya pinagsasama muli rito;
        // kung hindi, "No specifications on this item." ang nakikita ng
        // installer sa isang gamit na may labing-isang spec.
        description: [x.description ?? "", ...(x.specs ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => "• " + l)].join("\n"),
        sku: x.sku ?? null,
        unitPrice: Number(x.unitPrice) || 0,
        qty: Number(x.qty ?? 1),
        image: x.image_url ?? null,
        category: x.category ?? null,
        color: x.color ?? null,
        dimension: x.dimension ?? null,
        frame: x.frame ?? null,
      })),
    };
  }, [it, returnOrders]);

  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const completed = /delivered|completed/i.test(it.status ?? "");
  const [h, setH] = useState({
    install_date: completed ? (it.install_date ?? "") : todayISO,    // auto today while In Progress; frozen once Delivered
    installer_team: it.installer_team ?? "",
    warranty_terms: it.warranty_terms ?? "Parts & labor",
    warranty_duration: it.warranty_duration ?? "1 Year",
    // WARRANTY START: sa REWORK visit, mananatili ang ORIHINAL na start date ng
    // unang delivery (hindi nagre-renew ang coverage dahil sa repair) — ang
    // it.warranty_start ay minana mula sa orihinal na install record. Normal na
    // bagong install lang ang nagde-default sa today.
    warranty_start: completed
      ? (it.warranty_start ?? "")
      : (it.is_rework && it.warranty_start ? it.warranty_start : todayISO),
    feedback: it.feedback ?? "",
    status: completed ? "Delivered" : "In Progress",
    notes: it.notes ?? "",
  });
  const setHF = (k: keyof typeof h, v: string | number | null) => setH((p) => ({ ...p, [k]: v }));
  const onStatus = (v: string) => setHF("status", v);
  const [signature, setSignature] = useState<string[]>(it.signature_url ? [it.signature_url] : []);
  const [warrantyFormUrl, setWarrantyFormUrl] = useState<string | null>(it.warranty_form_url ?? null);
  // Per-item installers — aligned to it.items, each entry a list of installer names.
  const [itemInstallers, setItemInstallers] = useState<string[][]>(() => it.items.map((_, i) => it.item_installers?.[i] ?? []));
  // LITRATO KADA PRODUKTO (hiling 2026-08-29). Ang isang order na may pitong
  // mesa ay may pitong hiwalay na install, at ang isang bunton ay hindi
  // makapagsasabi kung alin ang kay alin. Nakahanay sa it.items gaya ng
  // itemInstallers. Ang LUMANG talaan ay may isang order-wide na listahan lang
  // (`it.photos`), kaya ipinapatong ito sa UNANG produkto — doon ito nakikita
  // ng installer imbes na maglaho.
  // ALIN ANG BUKAS. Isa lang: ang installer ay nasa harap ng isang gamit, at
  // ang pitong bukas na bloke ay ang mismong limang screen ng scroll na
  // inaalis nito. Isang produkto lang ang order → bukas agad; kapag marami,
  // sarado lahat at ang listahan mismo ang unang nakikita.
  // ALIN ANG BUKAS. Hanggang DALAWANG produkto ay bukas agad ang lahat (hiling
  // 2026-08-29) — kasya sila, at walang pinapanalunan sa pagtatago ng dalawa.
  // Tatlo pataas ay nakatiklop: doon nagsisimula ang scroll at doon kailangan
  // ng buod ang installer. Set, hindi isang index, para sa 1–2 na parehong
  // bukas nang sabay.
  const AUTO_OPEN_MAX = 2;
  const [openItems, setOpenItems] = useState<Set<number>>(
    () => new Set(it.items.length <= AUTO_OPEN_MAX ? it.items.map((_, i) => i) : []),
  );
  const toggleItem = (i: number) => setOpenItems((p) => {
    const next = new Set(p);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  const [itemPhotos, setItemPhotos] = useState<string[][]>(() =>
    it.items.map((_, i) => it.item_photos?.[i] ?? (i === 0 && !(it.item_photos?.length) ? (it.photos ?? []) : [])));
  // PRODUCT DETAILS kada item (2026-08-23) - parehong modal ng Orders/Operations.
  const [preview, setPreview] = useState<ProductPreview | null>(null);
  // Unique union of all per-item installers (+ team) — used in the warranty cert & monitoring.
  const allInstallerNames = [...new Set(itemInstallers.flat().filter(Boolean))].join(", ");
  // KAILANGAN NG INSTALLER (hiling 2026-08-28). Ang installation ay nase-save
  // nang walang nakatalagang tao — at ang warranty certificate ay lumalabas na
  // walang pangalan ng gumawa, kaya walang mababalikan kung may reklamo.
  const hasInstaller = itemInstallers.some((v) => (v?.length ?? 0) > 0);
  // PATUNAY KADA PRODUKTO (hiling 2026-08-29). Ang lumang tuntunin ay "kahit
  // isang litrato sa buong order", kaya ang pitong mesa ay maaaring maging
  // Delivered sa isang litrato at walang patunay ang anim. Ito ang mga wala
  // pa — ginagamit ng buton, ng babala, at kaparehong tseke ang nasa server
  // (saveInstallation) kung saan ito talaga hinaharang.
  // WALANG COLOR NA HANAY KUNG WALANG KULAY (hiling 2026-08-29). Ang lapad ng
  // sertipiko ay naka-pin sa 794px — A4 — kaya ang 80px na hanay na puro "—" ay
  // puwang na ninanakaw sa SPECIFICATION, na siyang laging masikip. Isang item
  // lang ang may kulay → nananatili ang hanay: mas mabuting may "—" kaysa
  // mawala ang kulay ng dalawa sa tatlong produkto.
  // ANG INAYOS LANG SA REWORK (Joe 2026-09-06, "kung ano lang nirework un lang
  // nandito"): ang certificate ng rework visit ay para sa gamit na inayos; ang
  // normal na install ay buong order pa rin (all_items).
  const certItems = it.is_rework ? it.items : (it.all_items ?? it.items);
  const certHasColor = certItems.some((x) => !!(x.color ?? "").trim());
  const missingPhoto = it.items.map((_, i) => i).filter((i) => (itemPhotos[i]?.length ?? 0) === 0);
  const needPhotos = missingPhoto.length > 0;
  const [formOpen, setFormOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [savingForm, setSavingForm] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);
  const justSigned = useRef(false);
  // Id ng record na nagawa/na-update na sa session na ito — pinipigilan ang
  // sunod-sunod na silent save na makagawa ng maraming rows sa force_new (rework).
  const savedId = useRef<number | null>(it.id);

  // Render the on-screen warranty certificate (with embedded signature) to an image
  // and upload it. Captured at a FIXED A4-ish width and with the modal's outer
  // margin neutralised, so the emailed copy matches the signed on-screen layout
  // 1:1 regardless of the screen/modal size it was signed on (a narrow tablet
  // modal previously produced a cramped, mis-sized certificate).
  async function captureFormUrl(): Promise<string | null> {
    const node = docRef.current;
    if (!node) return null;
    // Wait for every image (logo, product photos, signature) to finish loading before capture.
    await Promise.all(
      Array.from(node.querySelectorAll("img")).map((img) =>
        img.complete && img.naturalWidth > 0 ? null : new Promise<void>((r) => { img.onload = img.onerror = () => r(); }),
      ),
    );
    const { default: html2canvas } = await import("html2canvas-pro");
    // Neutralise the modal-only spacing/rounding for the capture, then restore it.
    const CAPTURE_W = 794; // A4 width in px @ 96dpi — a stable, print-accurate width
    const prev = { margin: node.style.margin, width: node.style.width, maxWidth: node.style.maxWidth, borderRadius: node.style.borderRadius, boxShadow: node.style.boxShadow };
    node.style.margin = "0";
    node.style.width = `${CAPTURE_W}px`;
    node.style.maxWidth = "none";
    node.style.borderRadius = "0";
    node.style.boxShadow = "none";
    let blob: Blob | null = null;
    try {
      // JPEG @ ~1.6× keeps the cert sharp but small (~300 KB) so it emails cleanly
      // as a PDF — PNG @2× was ~16 MB and broke the mail webhook. Pin the capture
      // width/window so layout is identical on every device.
      const canvas = await html2canvas(node, {
        scale: 1.6, backgroundColor: "#ffffff", useCORS: true,
        width: CAPTURE_W, windowWidth: CAPTURE_W,
      });
      blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    } finally {
      // Restore the modal styling so the on-screen view is unaffected.
      node.style.margin = prev.margin;
      node.style.width = prev.width;
      node.style.maxWidth = prev.maxWidth;
      node.style.borderRadius = prev.borderRadius;
      node.style.boxShadow = prev.boxShadow;
    }
    if (!blob) return null;
    const fd = new FormData();
    fd.append("file", new File([blob], "warranty-form.jpg", { type: "image/jpeg" }));
    fd.append("folder", `warranty-forms/${it.order_number || it.order_id || "unsorted"}`);
    const res = await uploadProductImage(fd);
    return "error" in res ? null : res.url;
  }

  // sigOverride / formOverride: pass just-captured URLs so we persist before state updates flush.
  // silent: auto-save (e.g. on sign) — keep the modal open, just refresh.
  function submit(opts?: { sigOverride?: string[]; formOverride?: string | null; silent?: boolean }) {
    setError(null);
    // Ang tahimik na pag-save (pagpirma sa warranty) ay hindi hinaharang: nasa
    // gitna pa ng pagsulat ang tao, at ang aktwal na pag-save ay nasa button.
    if (!opts?.silent && !hasInstaller) {
      setError("Assign at least one installer before saving.");
      return;
    }
    // Ang kulang na litrato ay humaharang lang sa DELIVERED. Ang install ay
    // maaaring nasa kalagitnaan pa — tatlo sa pito ang tapos — at dapat
    // maitala iyon; ang harangin ang pag-save ay pagkalimot ng nagawa na.
    if (!opts?.silent && /delivered|completed/i.test(h.status) && needPhotos) {
      setError(`Add an installation photo for ${missingPhoto.length === it.items.length ? "every product" : `item ${missingPhoto.map((i) => i + 1).join(", ")}`} before marking Delivered.`);
      return;
    }
    const sig = opts?.sigOverride ?? signature;
    const form = opts?.formOverride ?? warrantyFormUrl;
    const input: InstallationInput = {
      id: savedId.current ?? it.id, order_id: it.order_id, delivery_id: it.delivery_id, order_number: it.order_number || null, customer_name: it.customer_name || null,
      address: it.address || null, sales_rep: it.sales_rep || null, items_summary: it.items_summary || null,
      install_date: h.install_date || null, installer_team: h.installer_team || null,
      warranty_terms: h.warranty_terms || null, warranty_duration: h.warranty_duration || null, warranty_start: h.warranty_start || null,
      // Ang `photos` ay ang PINAGSAMANG bilang ng order: iyon ang tinatanong ng
      // gate ng Delivered (kahit isang litrato) at ng warranty certificate, kaya
      // hindi ito maaaring maiwan habang per-produkto ang pagkuha.
      signature_url: sig[0] ?? null, warranty_form_url: form, photos: itemPhotos.flat(), feedback: h.feedback || null, status: h.status, notes: h.notes || null,
      item_installers: itemInstallers,
      item_photos: itemPhotos,
      // REWORK visit na walang record pa: BAGONG installations row — hindi
      // ina-update ang lumang completed install + warranty ng order.
      force_new: it.is_rework && !(savedId.current ?? it.id),
    };
    start(async () => { const res = await saveInstallation(input); if ("error" in res) { setError(res.error); return; } savedId.current = res.id; router.refresh(); if (!opts?.silent) onClose(); });
  }

  // After signing, capture the whole certificate (now showing the signature) and persist form + signature.
  useEffect(() => {
    if (!justSigned.current) return;
    justSigned.current = false;
    setSavingForm(true);
    (async () => {
      const formUrl = await captureFormUrl();
      if (formUrl) setWarrantyFormUrl(formUrl);
      submit({ formOverride: formUrl, silent: true });
      setSavingForm(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  function remove() {
    if (!it.id) return;
    const id = it.id;
    startDel(async () => { const res = await deleteInstallation(id); if ("error" in res) { setError(res.error); return; } router.refresh(); onClose(); });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-5xl rounded-2xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Installation · {it.order_number} · {it.customer_name}
            {it.is_rework && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-200">Rework{it.rma_no ? ` · ${it.rma_no}` : ""}</span>
            )}
            {!it.is_rework && it.partial_open && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-200">Partial Delivery</span>
            )}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
        </div>
        {/* LOCKED pagkatapos ng Delivered — view-only sa teams; ang server
            (saveInstallation) ang tunay na harang sa hindi Admin/Ops Manager. */}
        {readOnly && (
          <p className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs font-semibold text-amber-800">
            Locked — this installation is already Delivered. Only an Admin or Operations Manager can edit it.
          </p>
        )}
        <fieldset disabled={readOnly} className="contents">

        {/* DALAWANG TUDLING (2026-08-25) — kapareho ng Delivery, New Return at
            RMA review. Isang mahabang tudling ito noon: ang labing-isang spec ng
            isang custom bed ay nagtutulak ng schedule, bayad, warranty at ng
            litrato pababa sa dalawang screen ng scroll.
              kaliwa — ANO ang ini-install (order, item, build, installers)
              kanan  — ANG GAWAIN (petsa, bayad, warranty, litrato) */}
        <div className="grid gap-0 lg:grid-cols-[1.05fr_1fr] lg:divide-x lg:divide-border">
          <div className="min-w-0">

        <Section title="Order (auto from delivered order)">
          <div className="mb-3">
            <SpecRows
              items={[
                ["Customer", it.customer_name],
                ["Sales Rep", it.sales_rep],
                ["Address", it.address],
                // ON-SITE REWORK: sino ang kumukumpuni. Ito ang screen na
                // tinitingnan ng papuntang crew, pero ang pangalan nila ay nasa
                // Returns lang — walang paraan mula rito para malaman kung sino
                // ang dapat sumama sa biyahe.
                ...(it.is_rework && it.rework_crew
                  ? [[it.rework_mode === "pullout" ? "Repair crew" : "On-site repair crew", it.rework_crew] as [string, string]]
                  : []),
              ]}
            />
          </div>
          <ProductPreviewModal item={preview} onClose={() => setPreview(null)} />
          {/* ILAN NA ANG TAPOS. Nakatiklop ang mga bloke ngayon, kaya kailangan
              ng isang linyang nagsasabi kung gaano pa kalayo ang natitira —
              kung hindi, kailangan pang buksan ang pito para malaman. */}
          {it.items.length > 1 && (() => {
            const done = it.items.filter((_, i) => (itemInstallers[i]?.length ?? 0) > 0 && (itemPhotos[i]?.length ?? 0) > 0).length;
            const all = done === it.items.length;
            return (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-stone-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {it.items.length} products
                  <span className={cn("ml-2 font-extrabold tabular-nums", all ? "text-emerald-700" : "text-[#a8842e]")}>
                    {done} of {it.items.length} done
                  </span>
                </p>
                {/* Paroo't parito, hindi isang direksyon lang: kapag lahat
                    sarado, ang gusto ng susunod na pindot ay pagbukas. */}
                <button type="button"
                  onClick={() => setOpenItems(openItems.size ? new Set() : new Set(it.items.map((_, i) => i)))}
                  className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted hover:bg-stone-100">
                  {openItems.size ? "Collapse all" : "Expand all"}
                </button>
              </div>
            );
          })()}
          {/* PRODUCT DETAILS kada item (hiling 2026-08-23): parehong anyo ng Orders at
              My Jobs - larawan, Product/Name, SKU, Category, Color, Qty, at ang flat na
              Specifications. Pinalitan nito ang table + hiwalay na specs (doble). */}
          {it.items.length === 0 ? <p className="py-4 text-center text-sm text-muted">No items.</p> : (
            <div className="space-y-2">
              {it.items.map((x, i) => {
                const name = (x.description || "").split("\n")[0] || "—";
                const rows: [string, ReactNode][] = [
                  ["Product / Name", <span key="nm">{x.customized && <span className="mr-1.5 rounded bg-amber-100 px-1 text-[9px] font-bold uppercase tracking-wide text-amber-700">Customized</span>}{name}</span>],
                  ...(x.sku ? [["SKU", <span key="sku" className="font-mono">{x.sku}</span>] as [string, ReactNode]] : []),
                  ...(realValue(x.category) ? [["Category", realValue(x.category)] as [string, ReactNode]] : []),
                  ...(realValue(x.color) ? [["Color", realValue(x.color)] as [string, ReactNode]] : []),
                  ["Qty", String(x.qty)],
                ];
                const inst = itemInstallers[i] ?? [];
                const px = itemPhotos[i] ?? [];
                // TAPOS NA ANG ISANG PRODUKTO kapag may installer at may litrato
                // — iyon ang dalawang hinihingi ng install kada gamit.
                const done = inst.length > 0 && px.length > 0;
                const isOpen = openItems.has(i);
                return (
                  <div key={i} className={cn("overflow-hidden rounded-xl border bg-stone-50/50 shadow-sm transition-colors",
                    done ? "border-emerald-300" : isOpen ? "border-[#caa45a]" : "border-[#e6dcc4]")}>
                    {/* NAKATIKLOP (2026-08-29). Pitong mesa × (larawan + specs +
                        installers + litrato) = limang screen ng scroll, at ang
                        hinahanap ng installer ay isa lang sa pito. Ang buod ay
                        nagsasabi kung ano ito at ano ang kulang; isang pindot
                        para sa gawain mismo. */}
                    <button type="button" onClick={() => toggleItem(i)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-stone-100/60">
                      <span className="w-5 shrink-0 text-center text-[11px] font-extrabold tabular-nums text-muted">{i + 1}</span>
                      {x.image_url
                        ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={x.image_url} alt="" className="h-11 w-11 shrink-0 rounded-lg border border-border bg-white object-contain" />
                        : <span className="h-11 w-11 shrink-0 rounded-lg border border-dashed border-border bg-white" />}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          {x.customized && <span className="rounded bg-amber-100 px-1 text-[9px] font-bold uppercase tracking-wide text-amber-700">Customized</span>}
                          <span className="truncate text-sm font-semibold">{name}</span>
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                          {x.sku && <span className="font-mono">{x.sku}</span>}
                          <span>Qty {x.qty}</span>
                          {inst.length > 0
                            ? <span className="truncate text-foreground">{inst.join(", ")}</span>
                            : <span className="font-semibold text-rose-600">No installer</span>}
                          <span className={cn("font-semibold tabular-nums", px.length ? "text-emerald-700" : "text-[#a8842e]")}>
                            {px.length ? `${px.length} photo${px.length === 1 ? "" : "s"}` : "no photo"}
                          </span>
                        </span>
                      </span>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide",
                        done ? "bg-emerald-100 text-emerald-700" : "bg-[#f5ecd6] text-[#8a6a1f]")}>
                        {done ? "✓ Done" : "To do"}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{isOpen ? "−" : "+"}</span>
                    </button>

                    {isOpen && (
                    <div className="space-y-3 border-t border-border bg-white/60 p-3">
                      <button type="button" onClick={() => setPreview(previewFromItem(x, it.order_number))} className="block w-full overflow-hidden rounded-xl border border-border bg-white" title="Open product details">
                        {x.image_url
                          ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={x.image_url} alt="" className="mx-auto max-h-44 w-full object-contain p-2" />
                          : <div className="flex h-32 items-center justify-center text-muted">No image</div>}
                      </button>
                      <SpecRows items={rows} />
                      {x.specs && <SpecFieldsView category={specCategoryOf(x.category, name)} specs={x.specs} />}
                      <div className={cn("rounded-lg border bg-white px-3 py-2", inst.length > 0 ? "border-border" : "border-amber-400")}>
                        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">
                          Installer(s)
                          {inst.length === 0 && <span className="text-rose-600">*</span>}
                        </div>
                        <MultiInstallerPicker value={inst} options={installers} onChange={(arr) => setItemInstallers((p) => p.map((v, j) => (j === i ? arr : v)))} />
                      </div>
                      {/* LITRATO NG PRODUKTONG ITO (hiling 2026-08-29) — dating
                          isang card sa kabilang tudling para sa buong order, at
                          sa pitong mesa ay iisang bunton ang kinalabasan. Ang
                          Customer Feedback ay nananatili doon: isa iyon kada
                          pagbisita, hindi kada gamit. */}
                      <div className={cn("overflow-hidden rounded-lg border-2 transition-colors", px.length ? "border-emerald-300" : "border-[#caa45a]")}>
                        <div className={cn("flex items-center justify-between gap-2 px-3 py-2", px.length ? "bg-emerald-600" : "bg-[#4a3b1a]")}>
                          <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-white">
                            Installation Photos
                            {/* KAILANGAN kada produkto — kaparehong tanda ng
                                Installer(s), para pareho ang basa ng dalawa. */}
                            {!px.length && <span className="ml-1 text-rose-300">*</span>}
                          </p>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-extrabold tabular-nums", px.length ? "bg-white text-emerald-700" : "bg-[#caa45a] text-[#3a2e12]")}>
                            {px.length ? `✓ ${px.length}` : "0"}
                          </span>
                        </div>
                        <div className="bg-white p-3">
                          <p className="mb-2 text-[11px] text-muted">
                            Proof of install (<b className="text-foreground">in-progress / finished</b>) + team selfie for this item.
                            {!px.length && <b className="text-rose-600"> Required before Delivered.</b>}
                          </p>
                          <MultiImageUpload
                            value={px} camera
                            onChange={(arr) => setItemPhotos((p) => p.map((v, j) => (j === i ? arr : v)))}
                            folder={`installation-photos/${it.order_number || it.order_id || "unsorted"}`}
                          />
                        </div>
                      </div>
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

          </div>

          <div className="min-w-0">
        <Section
          title="Schedule"
          action={returnOrderOption && !readOnly ? (
            <button type="button" onClick={() => setDeclareOpen(true)}
              className="rounded-lg border-2 border-rose-300 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100">
              ↩ Declare Return
            </button>
          ) : null}
        >
          {/* Installer/Team dropdown removed — installers are now assigned per item via
              the INSTALLER(S) chips above (allInstallerNames), so a separate single
              installer_team field here was redundant. */}
          <div className="grid grid-cols-2 gap-3">
            <F label="Install Date"><input type="date" value={h.install_date} onChange={(e) => setHF("install_date", e.target.value)} className={cn(inp, "w-full")} /></F>
            <F label="Status"><select value={h.status} onChange={(e) => onStatus(e.target.value)} className={cn(inp, "w-full")}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></F>
          </div>
        </Section>

        {it.balance > 0 && it.order_id != null && (
          <Section title="Payment Collection">
            {/* Rework: RMA ledger ang sinisingil — collectReworkPayment (returns),
                hindi orders ledger, para bumukas ang Delivered guardrail. */}
            {it.rework_return_id != null
              ? <ReworkInstallerPayment returnId={it.rework_return_id} rmaNo={it.rma_no} balance={it.balance} collectorName={collectorName} />
              : <InstallerPayment orderId={it.order_id} orderNumber={it.order_number} balance={it.balance} collectorName={collectorName} />}
          </Section>
        )}

        <Section title="Warranty">
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            <F label="Terms"><input value={h.warranty_terms} onChange={(e) => setHF("warranty_terms", e.target.value)} className={cn(inp, "w-full")} /></F>
            <F label="Duration"><select value={h.warranty_duration} onChange={(e) => setHF("warranty_duration", e.target.value)} className={cn(inp, "w-full")}>{DURATIONS.map((dd) => <option key={dd}>{dd}</option>)}</select></F>
            <F label="Start Date"><input type="date" value={h.warranty_start} onChange={(e) => setHF("warranty_start", e.target.value)} className={cn(inp, "w-full")} /></F>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setFormOpen(true)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-stone-100">Open Warranty Form</button>
            {savingForm ? <span className="text-xs font-medium text-amber-600">Saving form…</span>
              : warrantyFormUrl ? <a href={warrantyFormUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-green-700 hover:underline">✓ Form saved & signed — view</a>
              : signature[0] ? <span className="text-xs font-medium text-green-700">✓ Signed</span>
              : <span className="text-xs text-muted">Not yet signed</span>}
          </div>
        </Section>

        {/* ANG LITRATO AY NASA BAWAT PRODUKTO NA (hiling 2026-08-29) — sa
            kaliwa, katabi ng gamit na kinukunan, at ang bilang ay nasa buod sa
            ibabaw ng listahan. Ang natira rito ay ang feedback: isa iyon kada
            pagbisita, hindi kada gamit, kaya walang buong card na kailangan. */}
        <Section title="Customer Feedback / Notes">
          <input value={h.feedback} onChange={(e) => setHF("feedback", e.target.value)} placeholder="Anything the customer said worth recording" className={cn(inp, "w-full")} />
        </Section>

          </div>
        </div>
        </fieldset>
        {error && <p className="px-5 pb-2 text-sm text-rose-600">{error}</p>}
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          {it.id && !readOnly ? <button onClick={remove} disabled={delPending} className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">{delPending ? "Deleting…" : "Reset"}</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-stone-100">{readOnly ? "Close" : "Cancel"}</button>
            {!readOnly && (() => {
              // Ang PATUNAY ay humaharang lang sa Delivered — ang kalahating
              // tapos na install ay dapat maitala pa rin.
              const blockDone = /delivered|completed/i.test(h.status) && needPhotos;
              const blocked = !hasInstaller || blockDone;
              const label = pending ? "Saving…"
                : !hasInstaller ? "Installer required"
                : blockDone ? `Photo required · ${missingPhoto.length} left`
                : "Save Installation";
              return (
                <button onClick={() => submit()} disabled={pending || blocked}
                  title={!hasInstaller ? "Assign at least one installer first" : blockDone ? "Every product needs at least one installation photo" : undefined}
                  className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  {label}
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      {/* DECLARE RETURN — parehong form ng Delivery Tracker, naka-bind na sa
          order na ito, at parehong delivery-gated action (createReturnFromDelivery).
          Ang team na nakahawak sa biyahe ang nagdedeklara, kaya sa Returns/RMA
          page nila lumalabas ang RMA (0203). */}
      {declareOpen && returnOrderOption && (
        <NewReturnModal
          orders={[returnOrderOption]}
          pos={returnPos}
          workshops={returnWorkshops}
          defaultOrderId={returnOrderOption.id}
          submitAction={(input: CreateReturnInput) => createReturnFromDelivery({ ...input, declared_team: it.driver_team ?? null })}
          onCreated={() => router.refresh()}
          onClose={() => setDeclareOpen(false)}
        />
      )}

      {/* Warranty Form popup — 1:1 with the Furniture_Warranty_Form document */}
      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setFormOpen(false)}>
          <div ref={docRef} className="warranty-doc my-6 w-full max-w-4xl rounded-xl bg-white p-10 text-[13px] leading-relaxed text-stone-800 shadow-2xl" style={{ color: "#3a2e20" }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="text-center" style={{ color: "#5C4632" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Pan Furniture" className="mx-auto h-20 w-20 object-contain" />
              <p className="mt-1 text-xl font-bold tracking-wide">PRODUCT WARRANTY CERTIFICATE</p>
            </div>
            <p className="mt-1 text-center text-[11px] text-stone-500">Please keep this certificate together with your official receipt. It is required for all warranty claims.</p>

            {/* Top meta */}
            <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 border-y border-stone-300 py-2">
              <Field label="Warranty No." v={warrantyNo(it.order_number, it.id)} />
              <Field label="Date Issued" v={h.install_date || todayISO} />
              <Field label="Branch / Store" v="Main Branch" />
              <Field label="Sales Rep" v={it.sales_rep || "—"} />
            </div>

            <Heading t="CUSTOMER INFORMATION" />
            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
              <Field label="Customer Name" v={it.customer_name || "—"} />
              <Field label="Contact Number" v={it.contact_number || "—"} />
              <Field label="Email Address" v={it.email || "—"} />
              <Field label="Delivery Address" v={it.address || "—"} />
            </div>

            <Heading t="PURCHASE INFORMATION" />
            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
              <Field label="Invoice / OR No." v={it.order_number || "—"} />
              <Field label="Date of Purchase" v={it.date_purchase || "—"} />
              <Field label="Date Delivered" v={it.date_delivered || "—"} />
              <Field label="Mode of Payment" v={it.mop || "—"} />
              <Field label="Coordinator" v={it.coordinator || "—"} />
              <Field label="Driver" v={it.driver_team || "—"} />
              <Field label="Installer" v={allInstallerNames || h.installer_team || it.installer_team || "—"} />
            </div>

            <Heading t="PRODUCT DETAILS COVERED" />
            <table className="w-full border-collapse text-[11px] [&_td]:border [&_td]:border-stone-400 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-stone-400 [&_th]:bg-stone-100 [&_th]:px-2 [&_th]:py-1">
              {/* TIYAK NA LAPAD KADA HANAY (2026-08-25). Ang nakukuhang kopya ay naka-pin
                  sa 794px — lapad ng A4 — kaya ~714px lang ang natitira sa anim na hanay.
                  Pinabayaan itong hatiin ng browser noon: naipit ang litrato sa 36px at
                  bumagsak sa dalawang linya ang bawat spec. Ang litrato at ang spec ang
                  binibigyan ng puwang; ang CATEGORY/COLOR/QTY ay maiikling salita. */}
              <colgroup>
                <col style={{ width: "208px" }} />
                <col style={{ width: "96px" }} />
                <col style={{ width: "76px" }} />
                {certHasColor && <col style={{ width: "80px" }} />}
                <col />
                <col style={{ width: "38px" }} />
              </colgroup>
              {/* SPECIFICATION / DESIGN DETAILS, hindi DIMENSION (2026-08-25).
                  Isang bullet lang ang nakukuha ng dimension ("Size: SINGLE
                  36X75 · Pullout Bed: 30X70") — ang labing-isang spec ng custom
                  na kama ay naitatapon, kaya ang sertipiko ng warranty ay hindi
                  makapagsabi kung ANO ang sinasakop nito. */}
              <thead><tr><th>PHOTO</th><th>PRODUCT NAME</th><th>CATEGORY</th>{certHasColor && <th>COLOR</th>}<th>SPECIFICATION / DESIGN DETAILS</th><th>QTY</th></tr></thead>
              {/* BUONG ORDER sa normal na install (2026-08-29) — ang warranty ay
                  talaan ng saklaw. REWORK VISIT (Joe 2026-09-06, "kung ano lang
                  nirework un lang"): ang inayos lang — tingnan ang certItems. */}
              <tbody>{certItems.map((x, i) => (
                <tr key={i}><td className="text-center align-middle">{x.image_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={x.image_url} alt="" className="mx-auto h-28 w-28 rounded border border-gray-200 bg-white object-contain p-1" /> : "—"}</td><td className="text-center align-middle">{x.customized && <span className="mb-0.5 mx-auto block w-fit rounded bg-amber-100 px-1 text-[9px] font-bold uppercase tracking-wide text-amber-700">Customized</span>}{x.description}</td><td className="text-center align-middle">{x.category || "—"}</td>{certHasColor && <td className="text-center align-middle">{x.color || "—"}</td>}{/* Naka-center gaya ng ibang hanay (2026-08-29) — kaparehong sertipiko
                    ito ng warranty-certificate.tsx, kaya dapat magkatugma ang anyo. */}
                <td className="text-center align-middle">{x.specs
                  ? <ul className="mx-auto w-fit list-disc space-y-0.5 pl-4 text-left">{x.specs.split("\n").filter(Boolean).map((ln, k) => <li key={k}>{ln}</li>)}</ul>
                  : (x.dimension || "—")}{x.frame ? <span className="mt-0.5 block text-[9px] text-stone-500">＋ {x.frame}</span> : null}</td><td className="text-center align-middle">{x.qty}</td></tr>
              ))}</tbody>
            </table>

            <Heading t="WARRANTY COVERAGE" />
            <p><b>Warranty Period:</b> {h.warranty_duration} from the Date of Purchase — <b>six (6) months for promo items</b> and <b>one (1) year for customized items</b>, unless otherwise stated. <span className="text-stone-500">(Valid until {addDuration(it.date_purchase ?? h.warranty_start, h.warranty_duration) || "—"})</span></p>
            <p className="mt-1">The woodwork of the furniture is covered. Within the warranty period, the following are addressed and resolved <b>free of charge</b>, provided the item is used under normal conditions and proper care &amp; maintenance is followed:</p>
            <ul className="ml-5 list-disc">
              <li>Manufacturing defects in materials and woodwork.</li>
              <li>Structural defects of frames and joints under normal household use.</li>
              <li>Defective mechanisms such as swivel plates, hinges, and other moving hardware.</li>
              <li>Premature peeling or detachment of surface finish not caused by misuse.</li>
            </ul>
            <p className="mt-1">Warranty covers complimentary repairs for the designated furniture item. <b>Pickup and delivery costs</b> for warranty service are shouldered by the client.</p>

            <Heading t="WHAT IS NOT COVERED" />
            <ul className="ml-5 list-disc">
              <li>Normal wear and tear, fading, or natural variation in wood, fabric, and ceramic.</li>
              <li>Damage from misuse, accidents, abuse, or improper cleaning and maintenance.</li>
              <li>Damage caused by exposure to moisture, direct sunlight, heat, pests, or flooding.</li>
              <li>Damage from improper assembly, alteration, or repair by unauthorized persons.</li>
              <li>Products used for commercial, rental, or non-household purposes (unless agreed in writing).</li>
              <li>Items with removed, altered, or unreadable SKU/serial labels and no proof of purchase.</li>
            </ul>

            <Heading t="HOW TO FILE A WARRANTY CLAIM" />
            <ol className="ml-5 list-decimal">
              <li>Contact the store where the item was purchased within the warranty period.</li>
              <li>Present this Warranty Certificate together with the original official receipt.</li>
              <li>Provide clear photos or allow inspection of the defective item.</li>
              <li>Upon validation, the company will repair, replace, or service the item at its discretion.</li>
            </ol>

            <Heading t="TERMS & CONDITIONS" />
            <ol className="ml-5 list-decimal">
              <li>This warranty is valid only for the original purchaser and is non-transferable.</li>
              <li>Repair or replacement does not extend the original warranty period.</li>
              <li>Delivery or transport costs for warranty service may be shouldered by the customer.</li>
              <li>The company’s decision on all warranty claims is final, subject to applicable law.</li>
            </ol>

            <Heading t="ACKNOWLEDGEMENT" />
            <p>I confirm that I received the above item(s) in good condition and that I have read and understood the terms of this warranty.</p>
            <div className="mt-6 grid grid-cols-2 gap-10">
              <div className="text-center">
                {signature[0]
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={signature[0]} alt="signature" className="mx-auto h-16 w-full object-contain" />
                  : <button data-html2canvas-ignore onClick={() => setSignOpen(true)} className="h-16 w-full rounded border-2 border-dashed border-stone-400 text-xs font-medium text-primary hover:bg-stone-50 print:hidden">Click to Sign</button>}
                <p className="mt-1 border-t border-stone-500 pt-1 text-[11px]">Customer<br />Signature over Printed Name / Date</p>
                {signature[0] && <button data-html2canvas-ignore onClick={() => setSignOpen(true)} className="text-[10px] text-primary print:hidden">Re-sign</button>}
              </div>
              <div className="text-center">
                <div className="h-16" />
                <p className="mt-1 border-t border-stone-500 pt-1 text-[11px]">Authorized Company Representative<br />Signature over Printed Name / Date</p>
              </div>
            </div>

            <div data-html2canvas-ignore className="mt-6 flex items-center justify-end gap-2 print:hidden">
              {warrantyFormUrl && <a href={warrantyFormUrl} target="_blank" rel="noreferrer" className="mr-auto text-xs font-medium text-green-700 hover:underline">✓ Saved form — view</a>}
              <button
                onClick={async () => { setSavingForm(true); const u = await captureFormUrl(); if (u) { setWarrantyFormUrl(u); submit({ formOverride: u, silent: true }); setFormOpen(false); } else setError("Could not save form image."); setSavingForm(false); }}
                disabled={savingForm}
                className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >{savingForm ? "Saving…" : "Save Warranty Form"}</button>
              <button onClick={() => setFormOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-stone-100">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Signature popup */}
      {signOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={() => setSignOpen(false)}>
          {/* MALAKI, gaya ng pirmahan ng driver sa mapa (2026-08-26): 512×180 ito
              noon — masikip para sa daliri sa tablet, at ang pumipirma ay ang
              CUSTOMER, hindi ang staff. */}
          <div className="w-full max-w-[1000px] rounded-2xl bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-sm font-semibold">Customer Signature</p>
            <SignaturePad big value={null} folder={`warranty-signatures/${it.order_number || it.order_id || "unsorted"}`} onChange={(url) => { if (url) { justSigned.current = true; setSignOpen(false); } setSignature(url ? [url] : []); }} />
            <div className="mt-2 text-right"><button onClick={() => setSignOpen(false)} className="rounded-lg border border-border px-3 py-1 text-xs font-medium hover:bg-stone-100">Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Heading({ t }: { t: string }) {
  return <p className="mt-4 mb-1 border-b border-stone-400 pb-0.5 text-xs font-bold tracking-wide" style={{ color: "#5C4632" }}>{t}</p>;
}
function Field({ label, v }: { label: string; v: string }) {
  return <p><span className="text-stone-500">{label}:</span> <b>{v}</b></p>;
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  // `last:border-b-0` — sa dalawang tudling, ang huling seksyon ng bawat isa ay
  // naglalabas ng nakabitin na linya sa ilalim, na hindi umaabot sa kabila.
  // Ang `action` ay pumupuwesto sa kanan ng pamagat — hindi mahigpit na
  // kailangan ng lahat ng seksyon, kaya optional.
  return (
    <div className="border-b border-border p-5 last:border-b-0">
      <div className={cn("mb-2 flex items-center gap-3", action ? "justify-between" : null)}>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}
function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <label className={cn("flex flex-col gap-1", full && "col-span-2 md:col-span-3")}><span className="text-xs font-medium text-muted">{label}</span>{children}</label>;
}
function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", accent)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 18l3 3 6.5-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-2.4 2.5-3.2Z" /></svg></span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

// Multi-select installer picker per item — chips + a checkbox popup portaled to body
// (fixed position) so it floats above the scrollable table instead of being clipped.
function MultiInstallerPicker({ value, options, onChange }: { value: string[]; options: EmpOpt[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const w = Math.max(r.width, 232);
      const left = Math.min(r.left, window.innerWidth - w - 8);
      const want = options.length * 32 + 10;                 // height to show ALL options
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      // Prefer the side with more room; cap to that room so it never needs page scroll.
      let top: number, maxH: number;
      if (want <= below || below >= above) { top = r.bottom + 4; maxH = Math.min(want, below); }
      else { maxH = Math.min(want, above); top = r.top - maxH - 4; }
      setPos({ top, left, width: w, maxH });
    }
    setOpen(true);
  }
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const toggle = (name: string) => onChange(value.includes(name) ? value.filter((n) => n !== name) : [...value, name]);
  const onCall = new Set(options.filter((o) => o.on_call).map((o) => o.name));

  // Group options by role (On-Call ones in their own group) — like the sales picker.
  const groups: [string, EmpOpt[]][] = (() => {
    const m = new Map<string, EmpOpt[]>();
    for (const o of options) {
      const k = o.on_call ? "On Call Installer" : (o.role || "Installer");
      const a = m.get(k) ?? []; a.push(o); m.set(k, a);
    }
    return [...m.entries()];
  })();

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => (open ? setOpen(false) : openMenu())} className="flex w-full flex-wrap items-center gap-1 rounded-md border border-border bg-surface px-2 py-1.5 text-left text-xs hover:border-primary">
        {value.length === 0 ? <span className="text-muted">+ Assign installer</span> : value.map((n) => (
          <span key={n} className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium", onCall.has(n) ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary")}>
            {n}{onCall.has(n) && <span className="rounded bg-amber-200 px-1 text-[8px] font-bold uppercase">On Call</span>}
            <span onClick={(e) => { e.stopPropagation(); toggle(n); }} className="cursor-pointer opacity-60 hover:opacity-100">✕</span>
          </span>
        ))}
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div ref={popRef} style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH, zIndex: 100 }} className="overflow-auto rounded-lg border border-border bg-surface py-1 shadow-2xl">
          {options.length === 0 ? <p className="px-3 py-1.5 text-xs text-muted">No installers.</p> : groups.map(([role, opts]) => (
            <div key={role}>
              <div className="px-3 pb-1 pt-2 text-[11px] font-bold text-foreground">{role}</div>
              {opts.map((o) => {
                const sel = value.includes(o.name);
                return (
                  <button key={o.name} type="button" onClick={() => toggle(o.name)} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]", sel ? "bg-primary/10 font-semibold text-foreground" : "text-foreground hover:bg-stone-100")}>
                    <span className="flex-1">{o.name}</span>
                    {o.on_call && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">On Call</span>}
                    {sel && <span className="text-primary">✓</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
