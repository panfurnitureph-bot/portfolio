"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DesignDetailsButton } from "./design-details-button";
import { createDesignDetailsFromImage, updateDesignDetailsSheet, deleteDesignDetails, listOrdersForDesignSheet, type DesignDetailsRow, type SheetOrderPick, type SheetOrderItem } from "@/app/design-details/actions";
import type { LibSwatch } from "./website/SwatchManager";
import { Card, cn } from "./ui";
import { Modal } from "./modal";
import { SpecFieldsView } from "./spec-fields-input";
import { specCategoryOf } from "./line-items-editor";

// Listahan ng mga Design Details. Pag-click sa hilera, bumubukas ang builder na
// punô ng laman — kaya kayang baguhin at muling ipadala nang hindi itinataype.
//
// PILL, hindi dropdown — parehong dahilan ng quotations-table: ang status ay
// hinuhulaan ng SISTEMA (webhook ang nagtatala ng Approved/Declined), hindi
// itinatakda ng staff.

function statusPill(value: string): string {
  const s = value.toLowerCase();
  if (/approved|accepted/.test(s)) return "bg-teal-50 text-teal-700 ring-teal-600/20";
  if (/declined/.test(s)) return "bg-rose-50 text-rose-700 ring-rose-600/20";
  if (/expired/.test(s)) return "bg-stone-100 text-stone-600 ring-stone-300";
  if (/pending/.test(s)) return "bg-amber-50 text-amber-700 ring-amber-600/20";
  return "bg-stone-100 text-stone-700 ring-stone-300"; // Draft
}

function displayStatus(r: DesignDetailsRow): string {
  if (r.status === "Accepted") return "Approved";
  if (r.status === "Declined") return "Declined";
  if (r.status === "Expired") return "Expired";
  if (r.sentCount > 0 || r.status === "Sent") return "Pending";
  return "Draft";
}

// EKSAKTONG hulma ng Sales Orders table — espresso #4a3b1a, header #5a4a26,
// gold na divider #caa45a, naka-center ang lahat (pareho ng quotations-table).
const TH = "px-4 py-3 font-medium whitespace-nowrap text-center";
const TD = "px-4 py-3 whitespace-nowrap text-center";
const BD = "!border-l-4 !border-l-[#caa45a]";

const fmt = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

// ANG LAMAN NG SHEET, hindi lang ang pamagat. Ang "CUSTOM BED: Costumized Bed"
// ay pareho sa bawat custom bed; ang sukat at tela ang nagbubukod sa kanila.
// Dalawang pinagmulan: `specs` sa mga na-upload na sheet (0172) at `bullets` sa
// mga binuo sa editor — magkaiba ang landas, iisa ang ipinapakita.
function detailOf(g: DesignDetailsRow[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of g) {
    for (const s of [...(r.specs ?? []), ...(r.bullets ?? [])]) {
      const t = String(s).replace(/^[•·*\-\s]+/, "").trim();
      const k = t.toLowerCase();
      if (!t || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

export function DesignDetailsTable({ rows, swatchLibrary = [] }: { rows: DesignDetailsRow[]; swatchLibrary?: LibSwatch[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [opened, setOpened] = useState<DesignDetailsRow | null>(null);
  // APPROVED na sheet — pag-click ng row, PREVIEW ng image ang bumubukas
  // (hindi na ang builder); ito na ang final na kasunduan (hiling 2026-08-17).
  // MULTI-PAGE preview (hiling 2026-08-19): lahat ng sheets ng iisang order,
  // magkakasunod pababa sa iisang preview.
  const [viewSheet, setViewSheet] = useState<{ title: string; pages: DesignDetailsRow[] } | null>(null);
  // IN-APP na delete confirmation (hindi native browser dialog).
  const [delTarget, setDelTarget] = useState<DesignDetailsRow | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);


  // EDIT ng uploaded-sheet DD (walang builder content) — parehong upload
  // dialog ang bubukas, hindi ang builder (hiling 2026-08-19).
  const isUploaded = (r: DesignDetailsRow) => !r.bullets.length && !r.photoUrl && !!r.imageUrl;
  const [editSheet, setEditSheet] = useState<DesignDetailsRow | null>(null);
  const openEditor = (r: DesignDetailsRow) => { if (isUploaded(r)) setEditSheet(r); else setOpened(r); };

  // ISANG HILERA KADA DD (hiling 2026-08-29). Pinagsasama-sama ito kada Order #
  // noon (2026-08-19), kaya ang ORD-000015 — may DD-000011 at DD-000012 — ay
  // isang hilera lang na nagsasabing "DD-000012 +1 more": nakatago ang DD-000011
  // sa likod ng bilang, at ang hanay ng SKU ay "2 SKUs" imbes na ang SKU mismo.
  // Ang DD # ang tinitingnan sa hanay na ito, kaya bawat isa ay may sariling
  // hilera ngayon; inuulit ang customer/address sa magkapatid na hilera, at
  // iyon ang katumbas ng makitang lahat ng DD.
  //
  // Array pa rin ang hugis: array ang tinatanggap ng detailOf at ng preview ng
  // sheet, at maraming sheet pa rin ang mababasa ng isang DD.
  const groups: DesignDetailsRow[][] = rows.map((r) => [r]);

  return (
    <>
      <div className="mb-3 flex items-center justify-end gap-2">
        {/* UPLOAD ng tapos nang sheet image (hiling 2026-08-18): para sa mga
            sa Excel gumagawa — walang editor, ang PNG nila mismo ang sheet. */}
        <UploadSheetButton />
        {/* WALANG "Create Design Details" na buton — ang Upload sheet na lang
            ang landas ng paggawa. Nananatili ang component: ito ang builder
            na binubuksan ng Edit sa preview at ng pag-click sa hilera para sa
            mga sheet na binuo rito, kaya hindi ito matatanggal nang buo. */}
        <DesignDetailsButton hideTrigger initial={opened} openNow={!!opened} onClosed={() => setOpened(null)} swatchLibrary={swatchLibrary} />
        <UploadSheetModal open={!!editSheet} row={editSheet} onClose={() => setEditSheet(null)} />
      {/* DELETE CONFIRM — in-app modal (parehong pattern ng ibang delete). */}
      {delTarget && (
        <Modal
          open
          onClose={() => !pending && setDelTarget(null)}
          title="Delete Design Sheet"
          size="sm"
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setDelTarget(null)} disabled={pending} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-50">Cancel</button>
              <button
                onClick={() => start(async () => {
                  const res = await deleteDesignDetails(delTarget.id);
                  if ("error" in res) { setDelErr(res.error); return; }
                  setDelTarget(null);
                  setViewSheet(null);
                  router.refresh();
                })}
                disabled={pending}
                className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {pending ? "Deleting…" : "Delete"}
              </button>
            </div>
          }
        >
          <p className="text-sm">
            Delete <span className="font-semibold">{delTarget.ddNumber ?? `#${delTarget.id}`}</span>
            {delTarget.title ? <> — <span className="text-muted">{delTarget.title}</span></> : null}? This cannot be undone.
          </p>
          {delErr && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{delErr}</p>}
        </Modal>
      )}
      </div>

      <Card className="overflow-hidden">
        <div className="max-h-[60vh] overflow-auto rounded-t-xl pf-scroll">
          <table className="w-full border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
                {/* Ang daanan muna (DD # → Order #), tapos ang laman, tapos
                    kung kanino. Ang "Customer Reply" at ang Edit ay inalis —
                    ang hilera mismo ang nagbubukas ng sheet. */}
                <th colSpan={2} className="border-b border-[#caa45a] px-4 py-2">Reference</th>
                <th colSpan={5} className={cn("border-b border-[#caa45a] px-4 py-2", BD)}>Design</th>
                <th colSpan={3} className={cn("border-b border-[#caa45a] px-4 py-2", BD)}>Customer</th>
                <th colSpan={2} className={cn("border-b border-[#caa45a] px-4 py-2", BD)}>Status</th>
              </tr>
              <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
                <th className={TH}>DD #</th>
                <th className={TH}>Order #</th>
                <th className={cn(TH, BD)}>SKU</th>
                <th className={TH}>Product</th>
                <th className={TH}>Specification</th>
                <th className={TH}>Category</th>
                <th className={TH}>Created By</th>
                <th className={cn(TH, BD)}>Name</th>
                <th className={TH}>Contact #</th>
                <th className={TH}>Address</th>
                <th className={cn(TH, BD)}>Status</th>
                <th className={TH}>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-muted">
                    No design details yet. Use the Design Details button to build one.
                  </td>
                </tr>
              )}
              {groups.map((g) => {
                const r = g[0];
                // ISANG LINYA KADA PRODUKTO (hiling 2026-08-29). Pinagdikit
                // sila ng " · " noon, kaya ang tatlong sofa ay isang mahabang
                // linya — samantalang ang SPECIFICATION sa tabi nito ay isang
                // linya kada spec na (2026-08-23). Kasama ang SKU ng bawat isa:
                // ang hanay ng SKU ay nagpapakita lang ng sa UNANG sheet, kaya
                // sa tatlong produkto ay isa lang ang nakikita.
                const prods = [...new Map(g.filter((x) => x.title).map((x) => [x.title, x.sku ?? null])).entries()];
                const titles = prods.map(([t]) => t).join(" · ");
                return (
                <tr
                  key={r.id}
                  onClick={() => {
                    const pages = g.filter((x) => x.imageUrl);
                    if (pages.length) setViewSheet({ title: (r.orderNumber ? r.orderNumber + " — " : "") + `${pages.length} sheet${pages.length === 1 ? "" : "s"}`, pages });
                    else setOpened(r);
                  }}
                  title="View the sheets"
                  className="cursor-pointer hover:bg-stone-50"
                >
                  <td className={cn(TD, "font-mono text-xs font-semibold")}>
                    {r.ddNumber ?? `#${r.id}`}
                  </td>
                  {/* Ang daanan: DD # → Order #, magkatabi. Ang bilang ng sheet
                      ay nasa DD # na sa itaas, kaya hindi na inuulit dito. */}
                  <td className={cn(TD, "font-mono text-xs")}>
                    {/* Ang stock build ay walang order — ang SKU ang nasa
                        orderNumber. Ang STOCK na tanda ang nauuna, para hindi
                        ito mabasang order number. */}
                    {r.stockBuild ? (
                      <span className="rounded-full bg-[#4a3b1a] px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-[#f4ead8]">STOCK</span>
                    ) : r.orderNumber
                      ? <span className="font-bold text-[#8a6a1f]">{r.orderNumber}</span>
                      : <span className="text-muted/50">—</span>}
                  </td>
                  {/* BUONG DETAILS, hindi lang pamagat. Ang "CUSTOM BED:
                      Costumized Bed" ay pareho sa lahat ng custom bed; ang
                      sukat at tela ang nagbubukod. Ang specs ay galing sa
                      uploaded sheet (0172); ang bullets ay sa binuong sheet. */}
                  {/* SARILING HANAY ANG SKU (0183). Dati, ang SKU ng stock
                      build ay napipilitang umupo sa Order # — nagmumukha itong
                      order. Dito, ang SKU ay laging SKU. */}
                  {/* Ang SKU ng UNANG sheet lang ang laman nito — sa tatlong
                      produkto ay nagmumukhang iyon lang ang SKU. Kapag marami,
                      ang bilang ang sinasabi nito at ang bawat SKU ay nasa tabi
                      ng produkto nito sa PRODUCT. */}
                  <td className={cn(TD, BD, "whitespace-nowrap font-mono text-[11px] font-semibold text-[#8a6a1f]")}>
                    {prods.length > 1
                      ? <span className="font-sans text-[10px] font-semibold text-muted">{prods.filter(([, k]) => k).length} SKUs</span>
                      : (r.sku || <span className="font-sans text-muted/50">—</span>)}
                  </td>
                  <td className={cn(TD, "max-w-[220px] !text-left align-middle text-[11px] leading-snug")} title={titles}>
                    {prods.length ? prods.map(([t, sku], i) => (
                      <span key={i} className="block">
                        <span className="font-medium text-ink">{t}</span>
                        {sku && prods.length > 1 && <span className="ml-1.5 font-mono text-[10px] text-[#8a6a1f]">{sku}</span>}
                      </span>
                    )) : <span className="text-muted/50">—</span>}
                  </td>
                  {/* SARILING HANAY ANG SPECIFICATION (2026-08-23). Ang pamagat
                      ("Costumized Bed") ay pareho sa bawat custom bed; ang build
                      ang nagbubukod sa kanila, at noong magkasama sila sa isang
                      cell ay naipit ito sa isang linyang naputol. Isang spec
                      kada linya rito — mabasa nang hindi binubuksan ang sheet. */}
                  <td className={cn(TD, "max-w-[340px] !text-left align-middle text-[11px] leading-snug")} title={detailOf(g).join(" · ")}>
                    {detailOf(g).length > 0 ? (
                      <span className="block space-y-0.5 text-muted">
                        {detailOf(g).map((d, i) => <span key={i} className="block">{d}</span>)}
                      </span>
                    ) : <span className="text-muted/50">—</span>}
                  </td>
                  {/* KATEGORYA — galing sa produkto, hindi sa sheet: ang SKU
                      ang kawing, kaya sumusunod ito sa Product Management. */}
                  <td className={cn(TD, "whitespace-nowrap text-[11px]")}>
                    {r.category || <span className="text-muted/50">—</span>}
                  </td>
                  <td className={cn(TD, "text-muted")}>{r.createdBy ?? "—"}</td>
                  <td className={cn(TD, BD, "font-medium")}>{r.customer || "—"}</td>
                  <td className={cn(TD, "whitespace-nowrap font-mono text-[11px]")}>{r.contact || "—"}</td>
                  <td className={cn(TD, "max-w-[220px] !text-left text-[11px] leading-snug")} title={r.address ?? ""}>
                    <span className="line-clamp-2 block">{r.address || "—"}</span>
                  </td>
                  <td className={cn(TD, BD)}>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusPill(displayStatus(r))}`}>
                      {displayStatus(r)}
                    </span>
                    {/* Ang sagot ng customer ay dating hiwalay na hanay; isang
                        linya lang ito sa ilalim ng status — iisang bagay ang
                        sinasabi nila. */}
                    {r.repliedAt ? (
                      <span
                        title={`Customer replied ${fmt(r.repliedAt)}`}
                        className={cn("mt-0.5 block text-[10px] font-semibold", r.status === "Accepted" ? "text-success" : "text-danger")}
                      >
                        {r.status === "Accepted" ? "✓ Approved" : "✕ Declined"}
                      </span>
                    ) : r.sentCount > 0 ? (
                      <span className="mt-0.5 block text-[10px] text-muted">Awaiting reply · sent to {r.sentCount}</span>
                    ) : null}
                  </td>
                  <td className={cn(TD, "whitespace-nowrap text-muted")}>{fmt(r.createdAt)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* SHEET PREVIEW — MULTI-PAGE (hiling 2026-08-19): lahat ng sheets ng
          order, magkakasunod pababa; bawat page may caption + Edit. */}
      {viewSheet && (
        <Modal
          open
          onClose={() => setViewSheet(null)}
          title={viewSheet.title}
          size="2xl"
          footer={<div className="flex justify-end"><button type="button" onClick={() => setViewSheet(null)} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90">Close</button></div>}
        >
          <div className="space-y-6">
            {viewSheet.pages.map((p, i) => (
              <div key={p.id}>
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <span className="rounded bg-[#4a3b1a] px-1.5 py-0.5 font-extrabold text-[#f4ead8]">{i + 1}</span>
                  <span className="font-mono font-semibold">{p.ddNumber ?? `#${p.id}`}</span>
                  <span className="min-w-0 truncate text-muted">{p.title}</span>
                  {p.status === "Accepted" && <span className="font-semibold text-success">APPROVED</span>}
                  <button
                    type="button"
                    onClick={() => { setViewSheet(null); openEditor(p); }}
                    className="ml-auto rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-stone-100"
                  >
                    Edit
                  </button>
                  {/* DELETE (hiling 2026-08-19) — pambura ng maling upload;
                      in-app modal ang confirmation, hindi browser dialog. */}
                  <button
                    type="button"
                    disabled={pending}
                    // Isara muna ang preview (2026-08-19) — natatakpan nito ang
                    // confirm modal kaya mukhang walang nangyayari.
                    onClick={() => { setViewSheet(null); setDelErr(null); setDelTarget(p); }}
                    className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
                {/* PDF = iframe (walang viewer chrome, fit ang page); image = <img> */}
                {/\.pdf($|\?)/i.test(p.imageUrl ?? "") ? (
                  <iframe src={`${p.imageUrl}#toolbar=0&navpanes=0&view=Fit`} title={p.title} className="mx-auto h-[80vh] w-full max-w-[900px] rounded-lg border border-border bg-white" />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={p.imageUrl ?? ""} alt={p.title} className="mx-auto w-full max-w-[900px] rounded-lg border border-border bg-white" />
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}


// ── UPLOAD SHEET (binago 2026-08-19): PDF o PNG na lang ang file; ang Order #
// ay searchable dropdown — pagpili, auto-fill ang customer at lalabas ang mga
// produkto ng order para doon mismo i-attach ang sheet. Walang editor.
function UploadSheetButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg border border-[#caa45a] bg-[#faf5e9] px-4 py-2 text-sm font-semibold text-[#8a6a1f] hover:bg-[#f4ecd7]">
        Upload sheet
      </button>
      <UploadSheetModal open={open} row={null} onClose={() => setOpen(false)} />
    </>
  );
}

// PDF → PNG pages sa mismong browser (2026-08-19): ang Android WebView (APK)
// ay HINDI nagre-render ng PDF sa iframe, kaya kino-convert na natin ang PDF
// sa PNG bago i-upload — lahat ng downstream (APK, thumbnails, Messenger,
// print) ay image na. Bawat page = isang sheet (dudugtong sa viewer).
async function pdfToPngs(file: File): Promise<File[]> {
  // LEGACY build (2026-08-19): ang modern build ng pdfjs v6 ay umaasa sa
  // Uint8Array.toHex na wala pa sa mga kasalukuyang browser ("n.toHex is not
  // a function"); may polyfills ang legacy build.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out: File[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 }); // ~150dpi — malinaw sa print/zoom
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
    out.push(new File([blob], file.name.replace(/\.pdf$/i, "") + (doc.numPages > 1 ? `-p${i}` : "") + ".png", { type: "image/png" }));
  }
  return out;
}

// Iisang dialog para sa CREATE at EDIT ng uploaded sheet (hiling 2026-08-19):
// ang Edit ng uploaded DD ay ganito rin mismo ang itsura — hindi ang builder.
export function UploadSheetModal({ open, row, onClose }: { open: boolean; row: DesignDetailsRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [customer, setCustomer] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  // ORDER PICKER — lazy-load ng orders; pagpili = autofill + product list.
  const [orders, setOrders] = useState<SheetOrderPick[] | null>(null);
  const [orderQ, setOrderQ] = useState("");
  const [orderOpen, setOrderOpen] = useState(false);
  const [pickedOrder, setPickedOrder] = useState<SheetOrderPick | null>(null);
  const [product, setProduct] = useState("");
  // SKU ng piniling produkto (0183) — sariling hanay ito sa table, hindi
  // hinuhulaan sa order number: ang isang order ay maaaring may ilang item.
  const [sku, setSku] = useState("");
  // SPECS ng piniling produkto — galing sa mismong laman ng order (ang
  // description ng linya ay pamagat + bullets). Editable: ang SHEET ang totoo,
  // kaya kung may nabago habang ginagawa, dito ito itinatama.
  const [specs, setSpecs] = useState("");
  // Ang template ng spec cards ay nakasalalay sa category; ang piniling
  // produkto ("Costumized Bed") ang pinagkukunan nito. Sa EDIT ng lumang
  // sheet ay walang piniling produkto — ang pamagat ang hawak ng pangalan,
  // kaya iyon ang pambalik; kung wala rin, generic na card ang lalabas.
  const specCategory = specCategoryOf(null, product || title);

  useEffect(() => {
    if (!open) return;
    if (orders === null) listOrdersForDesignSheet().then(setOrders).catch(() => setOrders([]));
  }, [open, orders]);

  // EDIT mode: i-prefill mula sa row tuwing bubuksan.
  useEffect(() => {
    if (!open || !row) return;
    setCustomer(row.customer ?? "");
    setOrderNo(row.orderNumber ?? "");
    setOrderQ(row.orderNumber ?? "");
    setSku(row.sku ?? "");
    setTitle(row.title ?? "");
    setSpecs((row.specs ?? []).join("\n"));
    setFileName("");
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  function reset() {
    setFileName(""); setCustomer(""); setOrderNo(""); setTitle(""); setMsg(null);
    setOrderQ(""); setOrderOpen(false); setPickedOrder(null); setProduct(""); setSku("");
    setSpecs("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function pickOrder(o: SheetOrderPick) {
    setPickedOrder(o);
    // Ang STOCK BUILD ay walang order. Ang SKU ang hinahanap dito, pero
    // blangko ang naitatabing order number — kung hindi, mababasa itong order.
    setOrderNo(o.stockBuild ? "" : o.order_number);
    setCustomer(o.customer);
    setOrderQ(o.order_number);
    setOrderOpen(false);
    // Isang produkto lang? Auto-attach agad.
    if (o.items.length === 1) pickProduct(o.items[0]);
    else { setProduct(""); setSpecs(""); }
  }

  // Ang pagpili ng produkto ang nagdadala ng specs nito — BUO.
  //
  // Ang taas ng headboard ay dating hinihiwalay papunta sa sariling field.
  // Wala na ang field na iyon (hiling 2026-08-23): ang buong build ay nasa
  // Design specs, kaya walang dahilan para tanggalin dito ang isang linya.
  function pickProduct(it: SheetOrderItem) {
    setProduct(it.name);
    setTitle(it.name);
    setSku(it.sku ?? "");
    setSpecs(it.specs.join("\n"));
  }

  // Isang linya bawat spec; ang mga blangko ay hindi isinasama.
  function appendSpecs(fd: FormData) {
    // HINDI "bullets": ang blangkong bullets ang tanda na uploaded-image ang
    // DD na ito (huwag muling i-render). Tingnan ang migration 0172.
    fd.append("specs", JSON.stringify(specs.split("\n").map((x) => x.trim()).filter(Boolean)));
    fd.append("sku", sku.trim());
  }

  function submit() {
    const rawFiles = [...(fileRef.current?.files ?? [])];
    // Sa EDIT, opsyonal ang bagong file — mananatili ang dating sheet.
    if (!rawFiles.length && !row) { setMsg("Attach the sheet — PDF or PNG."); return; }
    if (!customer.trim()) { setMsg("Pick the order (or type the customer name)."); return; }
    setMsg(null);
    start(async () => {
      // PDF → PNG pages muna (hindi nagre-render ang PDF sa APK WebView).
      let files: File[] = [];
      try {
        for (const f of rawFiles) {
          if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") files.push(...await pdfToPngs(f));
          else files.push(f);
        }
      } catch (e) {
        setMsg("Could not read the PDF: " + (e instanceof Error ? e.message : String(e)));
        return;
      }
      if (row) {
        // EDIT — isang sheet lang ang pinapalitan (unang page kung PDF).
        const fd = new FormData();
        if (files[0]) fd.append("file", files[0]);
        fd.append("ddId", String(row.id));
        fd.append("customer", customer.trim());
        fd.append("orderNo", orderNo.trim());
        fd.append("title", (title.trim() || product).trim());
        appendSpecs(fd);
        // Walang Messenger send dito (hiling 2026-08-19) — upload/attach lang.
        fd.append("psids", "[]");
        const res = await updateDesignDetailsSheet(fd);
        if ("error" in res) { setMsg(res.error); return; }
        // AUTO-CLOSE pagka-save (hiling 2026-08-19) — agad kita sa table.
        router.refresh();
        close();
        return;
      }
      // CREATE — KAHIT ILANG file (hiling 2026-08-19): bawat file = isang
      // sheet na naka-attach sa order.
      const base = (title.trim() || product).trim();
      const dds: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const fd = new FormData();
        fd.append("file", files[i]);
        fd.append("customer", customer.trim());
        fd.append("orderNo", orderNo.trim());
        fd.append("title", files.length > 1 ? `${base || "SHEET"} — ${i + 1}` : base);
        appendSpecs(fd);
        fd.append("psids", "[]");
        const res = await createDesignDetailsFromImage(fd);
        if ("error" in res) { setMsg(`${res.error}${dds.length ? ` (saved: ${dds.join(", ")})` : ""}`); return; }
        if (res.ddNumber) dds.push(res.ddNumber);
      }
      // AUTO-CLOSE pagka-save (hiling 2026-08-19) — agad kita sa table.
      router.refresh();
      close();
    });
  }

  const orderMatches = (orders ?? []).filter((o) => {
    const s = orderQ.trim().toLowerCase();
    return !s || o.order_number.toLowerCase().includes(s) || o.customer.toLowerCase().includes(s);
  }).slice(0, 20);

  function close() { onClose(); reset(); }

  return (
    <>
      <Modal open={open} onClose={close} title={row ? `Edit uploaded sheet${row.ddNumber ? ` — ${row.ddNumber}` : ""}` : "Upload a finished sheet"} description={row ? "Replace the file or fix the order details — same flow as the upload." : "The image you upload is the exact sheet the customer receives — no editing."} size="lg"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted">{msg && <span className="font-medium text-foreground">{msg}</span>}</span>
            <span className="flex gap-2">
              <button onClick={close} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-stone-100">Close</button>
              <button onClick={submit} disabled={pending} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90 disabled:opacity-50">
                {pending ? "Working…" : row ? "Save changes" : "Save sheet"}
              </button>
            </span>
          </div>
        }>
        <div className="space-y-3">
          <div>
            <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Sheet file — PDF or PNG {row ? "(replace — optional)" : "*"}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-stone-100">Choose file…</button>
              <span className="min-w-0 truncate text-xs text-muted">{fileName || (row ? "Leave blank to keep the current sheet." : "The uploaded file is the exact sheet the customer receives.")}</span>
              <input ref={fileRef} type="file" accept="application/pdf,image/png" multiple={!row} className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])]; setFileName(fs.length > 1 ? `${fs.length} files — ${fs.map((x) => x.name).join(", ")}` : fs[0]?.name ?? ""); }} />
            </div>
          </div>
          {/* ORDER # — searchable dropdown; pagpili = autofill customer + products */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Order number *</span>
              <input
                value={orderQ}
                onChange={(e) => { setOrderQ(e.target.value); setOrderOpen(true); setPickedOrder(null); setOrderNo(e.target.value); }}
                onFocus={() => setOrderOpen(true)}
                placeholder={orders === null ? "Loading orders…" : "Search order # or customer…"}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
              {/* PUWANG PARA SA LISTAHAN (2026-08-23). Ang dropdown ay absolute,
                  kaya pinuputol ito ng overflow-y-auto ng katawan ng modal. Noong
                  mahaba pa ang dialog ay hindi ito halata — nagsi-scroll lang ang
                  modal. Ngayong maikli na ito (tinanggal ang Design specs, Note,
                  Title), ang listahan ay lumalabas sa ilalim ng modal at naputol.
                  Nagdadagdag ng kasingtaas na puwang habang bukas: kasya ang buong
                  listahan, at bumabalik ang taas pagkasara. */}
              {orderOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setOrderOpen(false)} />
                  <div className="absolute left-0 right-0 z-30 mt-1 max-h-52 overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
                    {orders === null ? (
                      <p className="px-3 py-3 text-xs text-muted">Loading orders…</p>
                    ) : orderMatches.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-muted">No matching orders.</p>
                    ) : orderMatches.map((o) => (
                      <button key={o.id} type="button" onClick={() => pickOrder(o)} className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-stone-50">
                        {/* Ang stock build ay walang order — ang SKU ang numero
                            nito at ang workshop ang nasa lugar ng customer. */}
                        {o.stockBuild && <span className="shrink-0 rounded-full bg-[#4a3b1a] px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-[#f4ead8]">STOCK</span>}
                        <span className="font-mono text-xs font-semibold">{o.order_number}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted">{o.customer}</span>
                        <span className="shrink-0 text-[10px] text-muted">{o.items.length} item{o.items.length === 1 ? "" : "s"}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Customer name *</span>
              <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Auto-filled from the order" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
            </label>
          </div>
          {/* Ang puwang mismo — kasingtaas ng max-h-52 ng listahan (13rem). */}
          {orderOpen && <div aria-hidden className="h-52 shrink-0" />}
          {/* ANG ORDER MISMO — sanggunian at padadalhan, tingin lang. Dito
              nakikita kung tama ba ang order bago i-save ang sheet. */}
          {pickedOrder && (
            <div>
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">This order</span>
              <div className="overflow-hidden rounded-lg border border-[#caa45a] bg-[#FAF7F2]">
                <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2.5 py-1.5">
                  {pickedOrder.mtoNumber && <span className="rounded border border-[#B87333] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#B87333]">{pickedOrder.mtoNumber}</span>}
                  {pickedOrder.fqNumber && <span className="rounded border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold">{pickedOrder.fqNumber}</span>}
                  <span className="rounded border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold">{pickedOrder.order_number}</span>
                  {!pickedOrder.mtoNumber && <span className="text-[11px] text-muted">Walk-in — no website request</span>}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2.5 py-2 text-[12px]">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Address</dt>
                  <dd className="m-0">{pickedOrder.address || "—"}</dd>
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Contact</dt>
                  <dd className="m-0">{pickedOrder.contact || "—"}</dd>
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-muted">Ordered</dt>
                  <dd className="m-0">{pickedOrder.orderedAt ? new Date(pickedOrder.orderedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—"}</dd>
                </dl>
              </div>
            </div>
          )}
          {/* PRODUKTO NG ORDER — piliin kung saan naka-attach ang sheet. Ang
              pagpili ang nagdadala ng specs ng linyang iyon. */}
          {pickedOrder && pickedOrder.items.length > 0 && (
            <div>
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Attach to product *</span>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border">
                {pickedOrder.items.map((it, i) => (
                  <label key={i} className={`flex cursor-pointer items-start gap-2 border-b border-border px-3 py-2 text-sm last:border-0 hover:bg-stone-50 ${product === it.name ? "bg-[#FAF7F2]" : ""}`}>
                    <input type="radio" name="dd-product" className="mt-1" checked={product === it.name} onChange={() => pickProduct(it)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{it.name}</span>
                    </span>
                    {it.qty > 1 && <span className="shrink-0 text-[10px] text-muted">×{it.qty}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
          {/* IISANG PORMA SA LAHAT NG MODAL (2026-08-23). Ito ang parehong
              guided cards ng Product Details, ng Edit Inventory Item at ng QC.
              Wala nang hilaw na textarea sa itaas (hiling 2026-08-23): ang
              parehong listahan ay lumalabas nang tatlong beses — sa ilalim ng
              radio, sa textarea, at dito. Ito ang natira dahil ito ang
              nagpapakita ng MISMONG anyo ng sheet. */}
          {specs.trim() && (
            <div className="rounded-lg border border-border bg-stone-50/60 p-3">
              <SpecFieldsView category={specCategory} specs={specs} />
            </div>
          )}
          {/* TINANGGAL ang Send to Messenger (hiling 2026-08-19) — upload at
              pag-attach sa order lang ang trabaho ng dialog na ito. */}
        </div>
      </Modal>
    </>
  );
}
