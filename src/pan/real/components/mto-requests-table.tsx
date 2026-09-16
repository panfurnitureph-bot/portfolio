"use client";

// MADE-TO-ORDER REQUESTS TABLE (Phase 3/4, 2026-08-20)
// MTO# | Photo | Product | SKU | Build | Fabric/Finish | Category | Name |
// Contact | Address | Status | FQ# | Order# | Action.
//
// DITO nakalagay ang buong daanan ng isang request — MTO # → FQ # → Order # —
// at ang mga aksyon nito: Create Quotation (modal na auto-filled, editable ang
// presyo/fee, dumadaan sa existing Formal Quotation module kasama ang auto
// delivery-fee match mula sa address vs website shipping rates), at Create
// Order kapag Approved na. Tingnan lang ang Formal Quotation Builder.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createQuotationFromMto, setMtoStatus, quoteForOrder, saveMtoDraft, planAddToOrder, addRequestToOrder, addMtoProduct, removeMtoProduct, type MtoRow, type MtoStatus, type AddPlan } from "@/app/mto-requests/actions";
import { previewQuotation } from "@/app/quotations/actions";
import { imageUrl } from "./website/util";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { groupProductLines, mtoProducts } from "@/lib/build-lines";
import { ProductSearch } from "./line-items-editor";
import type { ProductRow } from "@/lib/supabase/server";

type ShipProvince = { name: string; cities: { name: string; fee: number }[] };

// Manu-manong pinipili ng team — ang Ordered ay legacy pa rin ng mga lumang row.
const STATUSES: MtoStatus[] = ["New", "Quoted", "Approved"];

const pill = (s: string) =>
  s === "New"
    ? "border-[#e7d194] bg-[#fdf3d0] text-[#8a6a1f]"
    : s === "Quoted"
      ? "border-[#bcd2ef] bg-[#e8f0fb] text-[#1e4f8f]"
      : "border-[#bfe3cd] bg-[#e3f4e9] text-[#047857]";

// Auto-match ng delivery fee: hanapin sa address ang city/province ng rates.
function matchFee(address: string | null, provinces: ShipProvince[]): { fee: number | null; where: string } {
  const a = (address ?? "").toLowerCase();
  if (!a) return { fee: null, where: "" };
  for (const p of provinces) {
    for (const c of p.cities) {
      if (a.includes(c.name.toLowerCase())) return { fee: c.fee, where: `${c.name}, ${p.name}` };
    }
  }
  return { fee: null, where: "" };
}

export default function MtoRequestsTable({ rows, provinces, products = [] }: { rows: MtoRow[]; provinces: ShipProvince[]; products?: ProductRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<MtoRow | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  // Document-editor state: per-line prices (strings habang tine-type) at fees.
  // ── PAGDAGDAG SA ORDER NA MAYROON NA ──
  // `addPlan` = null kapag sarado. Ang sheet ay nagpapakita muna bago kumilos:
  // ang tugma ay hula (ang pangalan ay tinitipa), at ang maling tugma ay
  // naglalagay ng singil sa ibang tao.
  const [addFor, setAddFor] = useState<MtoRow | null>(null);
  const [addPlan, setAddPlan] = useState<AddPlan | null>(null);
  const [addPick, setAddPick] = useState<number | null>(null);
  const [addOk, setAddOk] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  // Paghahanap sa listahan ng kandidato. Ang isang suki ay maaaring may
  // sampung bukas na order — sa ganoong haba, hindi na binabasa ang listahan,
  // hinahanap na lang ang numerong alam na.
  const [addQ, setAddQ] = useState("");

  const [docLines, setDocLines] = useState<string[]>([]);
  const [parts, setParts] = useState<string[]>([]);
  // Haba ng pangkat kada produkto — ang hangganan sa pagitan ng mga produkto
  // sa iisang listahan ng linya. Iisang haba lang kapag isang produkto.
  const [docSpans, setDocSpans] = useState<number[]>([]);
  // Aling kahon ng presyo ang ginagalaw ngayon — iyon lang ang nagpapakita ng
  // hilaw na numero. Isa lang ang naka-focus, kaya isang key lang ang kailangan:
  // "12" para sa linya, o "fee"/"ship"/"rush".
  const [moneyFocus, setMoneyFocus] = useState<string | null>(null);
  const [feeStr, setFeeStr] = useState("");
  // WALANG DOCUMENT-LEVEL NA FEE (Joe 2026-09-06): ang Addtl. Shipping / Rush
  // fee ay KADA PRODUKTO — linya sa loob ng pangkat ng produkto (addFeeLine).
  // "+ Add item": catalog picker (parehong browser ng Create Order).
  const [pickerOpen, setPickerOpen] = useState(false);
  // In-app na confirm sa Delete ng produkto (hindi ang native dialog ng app).
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [feeNote, setFeeNote] = useState("");
  const [send, setSend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<Record<number, string>>({});
  // Optimistic status per row habang sine-save ang piniling dropdown value.
  const [status, setStatus] = useState<Record<number, MtoStatus>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  // AUTO-SAVE: huling naitalang laman, at kailan huling nagtagumpay.
  const lastDraft = useRef("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Preview ng MISMONG quotation document (SVG) bago ipadala.
  const [docSvg, setDocSvg] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // Public URL ng nagawang quotation — kailangan kapag walang Messenger thread.
  const [docUrl, setDocUrl] = useState<string | null>(null);
  // Naipadala ba sa Messenger? Kapag oo, hindi na kailangang ipakita ang link.
  const [sentOk, setSentOk] = useState(false);
  // WALANG QR (desisyon 2026-08-20): ang QR sa larawan ang sinu-scan ng
  // Messenger app sa panig ng nakakakita, kaya ito nagdadagdag ng "QR
  // transfer" card — hindi ito mensahe natin at walang paraan sa Send API
  // para pigilan. Walang QR = tatlong bubble lang ang thread. Ang BPI/BDO
  // account numbers ay nasa document pa rin.
  // Ang larawan sa thread ay laging WALANG QR; ang QR ay nasa PDF (tingnan
  // ang paliwanag sa modal) — kaya hindi na ito pinipili ng team.
  const hideQr = true;

  const pg = usePagination(rows);

  const num = (v: string) => Number(String(v ?? "").replace(/[^\d.]/g, "")) || 0;
  const fmt2 = (n: number) => `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // ANG MAY HALAGA LANG ANG MAY SIMBOLO. Ang "₱0.00" sa isang fee na hindi
  // pa napupunan ay mukhang libre ang serbisyo; ang em-dash ay ang parehong
  // tanda ng "wala pa" na ginagamit na ng hanay ng presyo sa itaas.
  const fmt2opt = (n: number) => (n ? fmt2(n) : "—");
  // ANG KAHON NG PRESYO ay nagpapakita ng ₱ at coma kapag hindi ito ginagalaw,
  // at hilaw na numero habang nagta-type — ang pag-format sa gitna ng pagta-type
  // ay naglalagay ng coma sa gitna ng caret at napupunta sa maling lugar ang
  // susunod na digit. Ang num() ay nag-aalis ng lahat maliban sa digit at
  // tuldok, kaya ang nakaformat na teksto ay nababasa pa rin pabalik.
  const money = (v: string, focused: boolean) => {
    if (focused || !String(v ?? "").trim()) return v ?? "";
    const n = num(v);
    return n ? fmt2(n) : (v ?? "");
  };
  const dateLabel = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const partNums = parts.map((p) => (String(p).trim() === "" ? null : num(p)));
  const itemTotal = partNums.reduce<number>((s, v) => s + (v ?? 0), 0);
  // ANG IPINAPADALA SA SERVER AY WALANG SEPARATOR. Ang editor ay may blangkong
  // linya sa pagitan ng mga produkto para mabasa; ang server ay naghahati ayon
  // sa haba ng groupProductLines, na walang separator. Kung isinama, isang
  // linya ang pagkakamali ng hati kada produkto — mapupunta sa susunod na
  // produkto ang presyo ng huling bullet.
  // IISANG HATI para sa presyo AT teksto: kung hiwalay silang kinukuwenta,
  // maaaring maghiwalay ang haba nila at mapunta sa maling linya ang presyo.
  const stripSeparators = <T,>(all: T[]): T[] => {
    if (docSpans.length < 2) return all;
    const out: T[] = [];
    let at = 0;
    docSpans.forEach((n, i) => {
      if (i) at += 1;
      out.push(...all.slice(at, at + n));
      at += n;
    });
    return out;
  };
  const partsForServer = stripSeparators(partNums);
  const grandTotal = itemTotal + num(feeStr);

  // Ang mga kandidatong ipinapakita, salà ng hinahanap. Hinahanap sa numero,
  // pangalan, address AT sa laman ng order — madalas ang naaalala ng team ay
  // "yung may ottoman", hindi ang numero.
  const shown = (() => {
    const all = addPlan?.candidates ?? [];
    const q = addQ.trim().toLowerCase();
    if (!q) return all;

    // PURONG DIGIT = NUMERO NG ORDER, at iyon lang.
    //
    // Ang telepono ay magkakapareho sa lahat ng order ng iisang customer at
    // naglalaman ng halos anumang maikling digit — ang "17" at ang "5" ay
    // parehong nasa 09083991075, at nasa postal code at house number din.
    // Kung hahanapin sa buong teksto, ibinabalik ang buong listahan at wala
    // pala talagang naisasala. Ang tugma ay sa DULO ("177" → ORD-000177):
    // ang tinitipa ng tao ay ang huling bahagi, hindi ang gitna.
    if (/^\d+$/.test(q)) {
      return all.filter((c) => String(c.order_number ?? "").replace(/\D/g, "").endsWith(q));
    }

    // Kung hindi, teksto: pangalan, address, status at ang laman ng order —
    // madalas ang naaalala ay "yung may ottoman", hindi ang numero.
    return all.filter((c) =>
      [c.order_number, c.customer_name, c.contact_number, c.address, c.status, ...c.lines.map((l) => l.name)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  })();

  // ── PAG-EDIT NG MISMONG LINYA (2026-08-22) ──
  // Presyo lang ang nababago noon. Pero minsan ay tinatanong ng team ang
  // pananalita ("Winged" → "Winged — both sides"), nagdadagdag ng bagay na
  // napagkasunduan sa Messenger, o nag-aalis ng napalitan. Ang binago DITO
  // ang PINAL: ito ang naipapadala, naisasave, at dumadaan sa Create Order.
  //
  // Ang tatlong array ay dapat magkasabay: docLines, parts (presyo) at
  // docSpans (haba ng pangkat kada produkto). Kapag nag-iba ang haba nila,
  // mapupunta sa maling produkto ang presyo — kaya sabay silang binabago.
  const spanOwner = (i: number) => {
    // Aling produkto ang may hawak ng linyang ito, at ilang linya bago ito.
    let at = 0;
    for (let pi = 0; pi < docSpans.length; pi++) {
      if (pi) at += 1; // blangkong separator sa pagitan ng produkto
      if (i < at + docSpans[pi]) return pi;
      at += docSpans[pi];
    }
    return Math.max(0, docSpans.length - 1);
  };

  function editLine(i: number, text: string) {
    setDocLines((prev) => { const n = [...prev]; n[i] = text; return n; });
  }

  function addLine(after: number) {
    const owner = spanOwner(after);
    // Ang bullet ay bahagi ng porma, hindi ng laman — inilalagay agad para
    // hindi na kailangang isipin ng nagta-type.
    setDocLines((prev) => { const n = [...prev]; n.splice(after + 1, 0, "• "); return n; });
    setParts((prev) => { const n = [...prev]; n.splice(after + 1, 0, ""); return n; });
    setDocSpans((prev) => prev.map((v, pi) => (pi === owner ? v + 1 : v)));
  }

  // FEE KADA PRODUKTO (2026-08-22). Sa 3+ produkto, ang rush o dagdag na
  // shipping ay madalas para sa ISANG item lang — ang kama ang minamadali,
  // hindi ang ottoman — pero ang mga pill sa ibaba ng talahanayan ay sumisingil
  // sa buong order. Ito ay naka-presyong LINYA sa loob ng pangkat ng produkto:
  // pumapasok sa total ng produktong iyon, sa quotation, sa resibo at sa order
  // nang walang bagong landas — ang editor ay marunong nang magdagdag ng linya.
  // Isang beses lang kada produkto; ang halaga ay tinitipa sa kahon ng presyo.
  function addFeeLine(pi: number, label: string) {
    const start = docSpans.slice(0, pi).reduce((s, n) => s + n, 0) + pi;
    const n = docSpans[pi] ?? 0;
    for (let k = 0; k < n; k++) {
      if ((docLines[start + k] ?? "").trim().toLowerCase() === label.toLowerCase()) return;
    }
    const last = start + n - 1;
    setDocLines((prev) => { const x = [...prev]; x.splice(last + 1, 0, label); return x; });
    setParts((prev) => { const x = [...prev]; x.splice(last + 1, 0, ""); return x; });
    setDocSpans((prev) => prev.map((v, i) => (i === pi ? v + 1 : v)));
  }

  // "+ ADD ROW" KADA PRODUKTO (Joe 2026-09-06, kahanay ng Shipping/Rush fee):
  // blangkong editable na linya sa dulo ng pangkat — walang dedupe, maaaring
  // marami. Kapareho ng addFeeLine kung hindi.
  function addBlankLine(pi: number) {
    const start = docSpans.slice(0, pi).reduce((s2, n) => s2 + n, 0) + pi;
    const n = docSpans[pi] ?? 0;
    const last = start + n - 1;
    setDocLines((prev) => { const x = [...prev]; x.splice(last + 1, 0, "• "); return x; });
    setParts((prev) => { const x = [...prev]; x.splice(last + 1, 0, ""); return x; });
    setDocSpans((prev) => prev.map((v, i) => (i === pi ? v + 1 : v)));
  }

  function removeLine(i: number) {
    const owner = spanOwner(i);
    // HINDI TINATANGGAL ANG HULING LINYA ng isang produkto: ang pangkat na
    // walang laman ay nagiging hilerang walang paglalarawan sa dokumento.
    if ((docSpans[owner] ?? 0) <= 1) return;
    setDocLines((prev) => prev.filter((_, k) => k !== i));
    setParts((prev) => prev.filter((_, k) => k !== i));
    setDocSpans((prev) => prev.map((v, pi) => (pi === owner ? v - 1 : v)));
  }

  function quoteInput(r: MtoRow) {
    // ISANG ITEM KADA PRODUKTO. Ang docSpans ang may hawak ng haba ng bawat
    // pangkat; ang mga blangkong separator sa pagitan ay hindi kasama, kaya
    // pareho ang hati rito at sa server (createQuotationFromMto).
    const prods = mtoProducts(r);
    const items: { qty: number; description: string; unitPrice: number; image: string | null; lineParts?: (number | null)[] }[] = [];
    let at = 0;
    prods.forEach((p, i) => {
      if (i) at += 1; // laktawan ang blangkong separator
      const n = docSpans[i] ?? 0;
      const lines = docLines.slice(at, at + n);
      const lp = partNums.slice(at, at + n);
      at += n;
      items.push({
        qty: 1,
        description: lines.join("\n"),
        unitPrice: lp.reduce<number>((s, v) => s + (v ?? 0), 0),
        image: p.image ?? null,
        lineParts: lp,
      });
    });
    // Isang produkto: ang kabuuang tinipa ang masusunod, hindi ang suma.
    if (items.length === 1) items[0].unitPrice = itemTotal;
    return {
      customerName: name.trim() || r.customer_name || "Messenger customer",
      address: address || r.address || null,
      items,
      deliveryFee: num(feeStr),
      hideQr,
    };
  }

  // "+ ADD ITEM" (2026-09-06): ang napili sa catalog ay isinasave sa
  // build.products ng request (server), saka idinadagdag sa editor bilang
  // bagong pangkat — pangalan, spec bullets, base price sa unang linya.
  // Editable pa rin gaya ng ibang linya.
  async function addCatalogItem(patch: { description?: string | null; unitPrice?: number; image?: string | null; sku?: string | null; category?: string | null }) {
    if (!open || adding) return;
    const desc = String(patch.description ?? "");
    const [first, ...rest] = desc.split("\n").map((l) => l.trim());
    const specLines = rest.map((l) => l.replace(/^[•·-]\s*/, "")).filter(Boolean);
    setAdding(true);
    const res = await addMtoProduct(open.id, { sku: patch.sku ?? null, name: first || "Item", category: patch.category ?? null, image: patch.image ?? null, price: Number(patch.unitPrice) || 0, specLines });
    setAdding(false);
    if ("error" in res) { setMsg(res.error); return; }
    const nextRow = { ...open, build: res.build };
    const prods = mtoProducts(nextRow);
    const added = prods[prods.length - 1];
    const g = groupProductLines(added);
    const priceOf = new Map<string, number>();
    for (const l of added.build?.lines ?? []) {
      const k = `• ${String(l.label).replace(/^[•·-]\s*/, "")}`;
      if (Number(l.price) > 0 && !priceOf.has(k)) priceOf.set(k, Number(l.price));
    }
    setDocLines((prev) => [...prev, "", ...g]);
    setParts((prev) => [...prev, "", ...g.map((l) => (priceOf.has(l) ? String(priceOf.get(l)) : ""))]);
    setDocSpans((prev) => [...prev, g.length]);
    setOpen(nextRow);
    setPickerOpen(false);
    router.refresh();
  }

  // DELETE NG PRODUKTO (2026-09-06): ang pangkat at ang separator nito.
  function deleteProduct(pi: number) {
    if (!open || adding || docSpans.length <= 1) return;
    setConfirmDel(pi);
  }
  async function deleteProductNow(pi: number) {
    setConfirmDel(null);
    if (!open || adding || docSpans.length <= 1) return;
    setAdding(true);
    const res = await removeMtoProduct(open.id, pi);
    setAdding(false);
    if ("error" in res) { setMsg(res.error); return; }
    let at = 0;
    for (let k = 0; k < pi; k++) at += docSpans[k] + 1;
    const n = docSpans[pi];
    const from = pi === 0 ? at : at - 1;
    const to = pi === 0 ? at + n + 1 : at + n;
    setDocLines((prev) => [...prev.slice(0, from), ...prev.slice(to)]);
    setParts((prev) => [...prev.slice(0, from), ...prev.slice(to)]);
    setDocSpans((prev) => prev.filter((_, i) => i !== pi));
    setOpen({ ...open, build: res.build });
    router.refresh();
  }

  async function previewDoc() {
    if (!open) return;
    setPreviewing(true);
    setMsg(null);
    const res = await previewQuotation(quoteInput(open));
    setPreviewing(false);
    if ("error" in res) { setMsg(res.error); return; }
    setDocSvg(`data:image/svg+xml;utf8,${encodeURIComponent(res.svg)}`);
  }

  const openModal = (r: MtoRow) => {
    setOpen(r);
    setSavedAt(null);
    setMsg(null);
    setDocUrl(null);
    setSentOk(false);
    setName(r.customer_name ?? "");
    setAddress(r.address ?? "");
    // Ang mga linya ay galing sa groupBuildLines — parehong function na
    // ginagamit ng ipinapadalang dokumento at ng PDF, kaya iisa ang porma.
    // Ang presyo ay ipinapares dito: ang blangkong hiwalay ay may blangkong
    // presyo, kung hindi ay aakyat ang bawat halaga sa ibaba nito.
    // MARAMING PRODUKTO: magkasunod ang mga pangkat, isang blangkong linya sa
    // pagitan. Ang mga hangganan ay itinatago sa docSpans para malaman ng
    // preview at ng dokumento kung saang produkto nabibilang ang bawat presyo.
    const prods = mtoProducts(r);
    const lines: string[] = [];
    const pr: string[] = [];
    const spans: number[] = [];
    prods.forEach((p, i) => {
      if (i) { lines.push(""); pr.push(""); }
      const g = groupProductLines(p);
      // Ang presyo ay ipinapares dito: ang blangkong hiwalay ay may blangkong
      // presyo, kung hindi ay aakyat ang bawat halaga sa ibaba nito.
      const priceOf = new Map<string, number>();
      for (const l of p.build?.lines ?? []) {
        const k = `• ${String(l.label).replace(/^[•·-]\s*/, "")}`;
        if (Number(l.price) > 0 && !priceOf.has(k)) priceOf.set(k, Number(l.price));
      }
      lines.push(...g);
      pr.push(...g.map((l) => (priceOf.has(l) ? String(priceOf.get(l)) : "")));
      spans.push(g.length);
    });
    // ANG MANU-MANONG BINAGO ANG IBINABALIK, kung meron. Kung muling bubuuin
    // mula sa `products`, mawawala ang pananalitang inayos at ang linyang
    // idinagdag ng team sa bawat pagbukas ng modal — at hindi nila malalaman
    // hangga't hindi na naipadala ang lumang bersyon.
    const edited = r.build?.docLines;
    const editedSpans = r.build?.docSpans;
    // ANG SPANS ANG HATI, HINDI ANG BLANGKONG LINYA. May "" din sa LOOB ng
    // produkto (sa pagitan ng THE ITEM, ADD-ONS, DOUBLE WALLING) — ang
    // paghula roon ay naghahati sa maling lugar, at lumabas bilang 30 cell na
    // puro blangko. Kapag hindi tugma ang imbak, ang binuo ang masusunod.
    const validSaved =
      !!edited?.length &&
      editedSpans?.length === prods.length &&
      edited.length === editedSpans.reduce((a, b) => a + b, 0) + (prods.length - 1);
    if (validSaved) {
      setDocLines(edited);
      // Ang presyo ay hinahanap ayon sa TEKSTO, hindi sa posisyon — ang
      // idinagdag na linya ay walang katapat sa build ng customer.
      const byText = new Map<string, number>();
      for (const p of prods) {
        for (const l of p.build?.lines ?? []) {
          const k = `• ${String(l.label).replace(/^[•·-]\s*/, "")}`;
          if (Number(l.price) > 0 && !byText.has(k)) byText.set(k, Number(l.price));
        }
      }
      setParts(edited.map((l) => (byText.has(l) ? String(byText.get(l)) : "")));
      setDocSpans(editedSpans);
    } else {
      setDocLines(lines);
      setParts(pr);
      setDocSpans(spans);
    }
    // Ibinabalik ang mga opsyonal na fee mula sa huling pag-save — nakabukas
    // lang ang pill kapag may halaga.
    // Ang naitalang fee mula sa huling pag-save ang nangunguna — baka sinadya
    // itong iba sa awtomatikong tugma; ang auto-match ay panimula lang.
    const m = matchFee(r.address, provinces);
    const saved = Number(r.build?.deliveryFee) || 0;
    setFeeStr(saved > 0 ? String(saved) : m.fee ? String(m.fee) : "");
    setFeeNote(
      saved > 0
        ? "Kept from the last save — edit to change it."
        : m.where
          ? `Matched "${m.where}" from the website shipping rates.`
          : "No shipping-rate match — type the fee.",
    );
    setSend(!!r.psid);
  };

  // AUTO-SAVE (2026-08-21). Ang tinitipa ay itinatala nang hindi ipinapadala:
  // ang Send ay para sa customer, hindi para sa pagtatala. Naka-debounce ng
  // 900ms para isang sulat lang kada pahinga sa pagta-type, at hindi tumatakbo
  // sa unang bukas (walang binago pa) ni habang nagse-send.
  const draftKey = open
    // KASAMA ANG docLines: ang binagong pananalita ay pagbabago rin, at kung
    // wala ito sa susi, hindi nagse-save ang teksto — mawawala ito sa pagsara
    // ng modal at walang magsasabi.
    ? JSON.stringify([open.id, docLines, parts, feeStr, name, address])
    : "";
  useEffect(() => {
    if (!open || !draftKey) return;
    // Unang render ng bagong modal: itala ang panimula, huwag i-save.
    if (!lastDraft.current.startsWith(`[${open.id},`)) { lastDraft.current = draftKey; return; }
    if (draftKey === lastDraft.current || busy) return;
    const t = setTimeout(() => {
      lastDraft.current = draftKey;
      void saveMtoDraft({
        id: open.id,
        customerName: name,
        address: address || null,
        lineParts: partsForServer,
        // Ang buong editor — may separator sa pagitan ng produkto — at ang
        // haba ng bawat pangkat; ang dalawa ang kailangan para maibalik.
        lines: docLines,
        spans: docSpans,
        unitPrice: itemTotal,
        deliveryFee: num(feeStr),
        extraShipFee: 0,
        rushFee: 0,
      }).then((res) => { if (!("error" in res)) setSavedAt(Date.now()); });
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, open, busy]);

  // Pagsara: kapag may naitalang draft, kunin muli ang server data para
  // tumugma ang hilera sa kaka-save lang (walang revalidate ang draft save).
  function closeModal() {
    setOpen(null);
    if (savedAt) router.refresh();
    setSavedAt(null);
  }

  async function create() {
    if (!open) return;
    setBusy(true);
    setMsg(null);
    const res = await createQuotationFromMto({
      id: open.id,
      customerName: name,
      address: address || null,
      unitPrice: itemTotal,
      deliveryFee: num(feeStr),
      lineParts: partsForServer,
      // Ang mismong teksto at ang haba ng bawat pangkat — ang binago ng team
      // ang naipapadala, hindi ang muling binuo mula sa build ng customer.
      lines: docLines,
      spans: docSpans,
      extraShipFee: 0,
      rushFee: 0,
      hideQr,
      send,
    });
    setBusy(false);
    if ("error" in res) { setMsg(res.error); return; }
    const wasRevision = !!(done[open.id] ?? open.fq_number);
    setDone((p) => ({ ...p, [open.id]: res.fqNumber ?? "FQ" }));
    // Ang server ay nagmamarka ng "Quoted"; isalamin agad para tumugma ang dropdown.
    setStatus((p) => ({ ...p, [open.id]: "Quoted" }));
    setDocUrl(res.url);
    setSentOk(res.sent > 0);
    setMsg(
      `${wasRevision ? "Updated" : "Created"} ${res.fqNumber ?? "quotation"}` +
        (res.sent > 0
          ? " — sent to the customer's Messenger."
          : open.psid
            ? " — Messenger send skipped (24h window); use the link below."
            : " — no Messenger thread for this request; copy the link below and send it however the customer reached you.") +
        (res.pdfError ? ` QR PDF skipped: ${res.pdfError}.` : ""),
    );
  }

  // CREATE ORDER mula sa naaprubahang quotation. Dinadala sa Orders page na
  // bukas na ang Create Order form at punô na ng laman ng quotation — hindi
  // dinodoble ang buong CreateOrderButton dito (malaki ang dependency nito:
  // assignees, fbContacts, canEditWorkshop, next order number), at ang Orders
  // page ang may lahat ng iyon.
  // Buksan ang pagsusuri: sino ang natugma, paano, at ano ang magbabago.
  // Kung nakuha na ang plano nang naging Approved, bumubukas agad — walang
  // paghihintay sa pagitan ng pindot at ng sheet.
  async function openAdd(r: MtoRow) {
    const cached = planCache.current[r.id];
    if (cached) { showAdd(r, cached); return; }
    setSaving(r.id);
    setAddErr(null);
    const res = await planAddToOrder(r.id);
    setSaving(null);
    if ("error" in res) { setStatusErr(res.error); return; }
    planCache.current[r.id] = res;
    showAdd(r, res);
  }

  function showAdd(r: MtoRow, plan: AddPlan) {
    setAddFor(r);
    setAddPlan(plan);
    // Ang PSID ang tanging maaasahan, kaya iyon lang ang inihahanda nang
    // pili. Ang tugma sa pangalan ay hinahayaang blangko — ang team ang
    // pipili, dahil hindi kayang panindigan ng sistema ang hulang iyon.
    const strong = plan.candidates.find((c) => c.matchedBy === "psid");
    setAddPick(strong ? strong.id : null);
    setAddDate(strong?.date_of_delivery ?? "");
    setAddOk(false);
    setAddQ("");
    setAddErr(null);
  }

  async function doAdd() {
    if (!addFor || addPick == null) return;
    setAddBusy(true);
    setAddErr(null);
    const res = await addRequestToOrder({ id: addFor.id, orderId: addPick, confirmed: addOk, deliveryDate: addDate || null });
    setAddBusy(false);
    if ("error" in res) { setAddErr(res.error); return; }
    // LUMA NA ANG BUONG CACHE, hindi lang ang request na ito: ang order na
    // pinagdagdagan ay iba na ang kabuuan at balanse, at nakalista rin iyon
    // bilang kandidato ng ibang request. Ang paggamit ng lumang plano ay
    // magpapakita ng mga numerong hindi na totoo.
    planCache.current = {};
    setAddFor(null);
    setAddPlan(null);
    router.refresh();
  }

  async function createOrder(r: MtoRow) {
    setSaving(r.id);
    const res = await quoteForOrder(r.id);
    setSaving(null);
    if ("error" in res) { setStatusErr(res.error); return; }
    try {
      // sessionStorage, hindi URL: ang buong items array (may larawan at
      // bullets) ay masyadong mahaba para sa query string.
      sessionStorage.setItem("pf_quote_to_order", JSON.stringify({
        fq: res.fq, qid: res.qid, customer: res.customer, address: res.address, items: res.items, deliveryFee: res.deliveryFee,
        // Galing sa request, hindi sa quotation — contact number at ang
        // Messenger thread na pagpapadalhan ng order updates.
        contact: res.contact, psid: res.psid, mto: res.mto,
      }));
    } catch { /* storage off — bubukas pa rin ang blangkong form */ }
    router.push("/orders?fromQuote=1");
  }

  async function changeStatus(id: number, next: MtoStatus) {
    const prev = status[id];
    setStatus((p) => ({ ...p, [id]: next }));
    setSaving(id);
    const res = await setMtoStatus(id, next);
    setSaving(null);
    if ("error" in res) {
      // Ibalik ang dating halaga para hindi magsinungaling ang dropdown.
      setStatus((p) => { const c = { ...p }; if (prev) c[id] = prev; else delete c[id]; return c; });
      setStatusErr(res.error);
      return;
    }
    setStatusErr(null);
    // PAGHAHANDA HABANG WALA PANG PINIPINDOT. Ang paghahanap ng bukas na order
    // ng customer ay ilang query — kapag ginawa sa oras ng click, may antala
    // bago bumukas ang sheet at parang hindi tumalab ang pindot. Ang Approved
    // ay tanda na susunod ang order, kaya kinukuha na ito ngayon.
    if (next === "Approved") void prefetchAdd(id);
    // Ang Approved ang naglalabas ng quotation sa Formal Quotation Builder —
    // kailangang muling basahin ang server data para tumugma ang dalawang pahina
    // (at para makita agad ang Create Order sa hilerang ito).
    router.refresh();
  }

  // Itinatago ang nakuha nang plano kada request. Hindi ito nabubura sa
  // pagsasara ng sheet: kadalasan bumabalik ang team pagkatapos tingnan.
  const planCache = useRef<Record<number, AddPlan>>({});

  async function prefetchAdd(id: number) {
    if (planCache.current[id]) return;
    const res = await planAddToOrder(id);
    if (!("error" in res)) planCache.current[id] = res;
  }

  // Ang mga Approved na sa pagbukas ng pahina ay inihahanda rin — hindi lang
  // ang kabibago lang. Sunod-sunod, hindi sabay-sabay: ang isang pahinang may
  // dalawampung Approved ay magpapadala ng dalawampung query nang sabay at
  // pabagalin ang mismong pahinang gusto nating bilisan.
  const primed = useRef(false);
  useEffect(() => {
    if (primed.current) return;
    primed.current = true;
    const ready = rows.filter((r) => (status[r.id] ?? r.status) === "Approved" && !r.order_number).slice(0, 8);
    void (async () => { for (const r of ready) await prefetchAdd(r.id); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const fabricOf = (r: MtoRow) =>
    r.build?.fabric || (r.build?.lines ?? []).find((l) => /fabric|upholster|wood stain/i.test(l.label))?.label.split(":").slice(1).join(":").trim() || "—";

  return (
    <div className="overflow-visible rounded-xl border border-border bg-surface shadow-sm">
      {statusErr && (
        <p className="border-b border-[#f0c9c9] bg-[#fdecec] px-4 py-2 text-xs font-semibold text-[#9b2c2c]">{statusErr}</p>
      )}
      {/* Pahalang lang ang scroll — sa page mismo bumababa, kaya walang
          panloob na scrollbar at walang sticky header na nakatakip. */}
      <div className="overflow-x-auto rounded-t-xl pf-scroll">
      {/* table-fixed + tinukoy na lapad ang BAWAT column: kung hindi, kinukuha
          ng maiikling column ang espasyo at nagiging mataas na bloke ang Build.
          Ang percent ang gamit, hindi pixel — sa table-fixed ay hindi lumalaki
          ang <col> na walang lapad (nagiging zero ito), at ang porsyento ang
          nagpapapuno sa buong lapad ng screen anuman ang laki nito. */}
      <table className="w-full min-w-[1420px] table-fixed border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:!text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_th]:!text-center [&_th]:font-bold">
        <colgroup>
          <col className="w-[7%]" />
          <col className="w-[6.5%]" />
          <col className="w-[6.5%]" />
          <col className="w-[4.5%]" />
          <col className="w-[8%]" />
          <col className="w-[7%]" />
          <col className="w-[15%]" />
          <col className="w-[7.5%]" />
          <col className="w-[6.5%]" />
          <col className="w-[7.5%]" />
          <col className="w-[7.5%]" />
          <col className="w-[8%]" />
          <col className="w-[6.5%]" />
          <col className="w-[9%]" />
        </colgroup>
        <thead>
          <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
            {/* Ang kabuuan ng colSpan ay DAPAT 14 — ang bilang ng column sa
                ibaba. Nang 3+4+3+2=12 ito, dalawang column ang naiwang walang
                banda sa itaas, kaya may bakanteng puwang sa dulo ng header.
                Ang Fabric/Finish at Category ay nasa Customer band din noon
                gayong pag-aari ng produkto ang mga iyon. */}
            <th colSpan={3} className="border-b border-[#caa45a] bg-[#4a3b1a] px-5 py-2">Reference</th>
            <th colSpan={6} className="border-b border-[#caa45a] bg-[#4a3b1a] px-5 py-2 !border-l-4 !border-l-[#caa45a]">Request</th>
            <th colSpan={3} className="border-b border-[#caa45a] bg-[#4a3b1a] px-5 py-2 !border-l-4 !border-l-[#caa45a]">Customer</th>
            <th colSpan={2} className="border-b border-[#caa45a] bg-[#4a3b1a] px-5 py-2 !border-l-4 !border-l-[#caa45a]">Action</th>
          </tr>
          <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
            <th className="bg-[#5a4a26] px-2.5 py-2.5">MTO #</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5">FQ #</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5">Order #</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5 !border-l-4 !border-l-[#caa45a]">Photo</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5">Product</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5">SKU</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5">Build</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5">Fabric / Finish</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5">Category</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5 !border-l-4 !border-l-[#caa45a]">Name</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5">Contact</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5">Address</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5 !border-l-4 !border-l-[#caa45a]">Status</th>
            <th className="bg-[#5a4a26] px-2.5 py-2.5">Action</th>
          </tr>
        </thead>
        <tbody>
          {pg.slice.map((r) => {
            // MARAMING PRODUKTO: ang mga column ay may espasyo lang para sa
            // una, kaya ang Build ang nagsasabi ng buong laman — pangalan ng
            // bawat produkto, hindi ang mga opsyon ng nauna lang. Kung hindi,
            // mukhang isahang request ang isang apat na produktong request.
            const rProds = mtoProducts(r);
            // BUONG SPECS KAHIT ILAN ANG PRODUKTO. Ang pangalan lang
            // ("1. Costumized Bed · 2. Costumized Bed") ay walang sinasabi —
            // magkapareho ang pangalan ng lahat ng custom bed; ang sukat at
            // tela ang nagbubukod sa kanila. Sa isang produkto ay buong specs
            // na noon pa, kaya magkaiba ang dalawang hilera sa parehong hanay.
            const specsOf = (lines: { label: string }[] | undefined) =>
              (lines ?? []).map((l) => l.label.replace(/^(Size|Fabric):\s*/i, "")).join(" · ");
            const buildTxt =
              rProds.length > 1
                ? rProds.map((p, i) => `${i + 1}. ${specsOf(p.build?.lines) || p.name || p.sku || "Item"}`).join("  ·  ")
                : specsOf(r.build?.lines);
            const fq = done[r.id] ?? r.fq_number;
            const st = (status[r.id] ?? r.status) as MtoStatus;
            return (
              // h-16: iisang taas ang bawat hilera, kahit gaano kahaba ang
              // Build — ito ang naka-clamp, hindi ang hilera ang umaayon dito.
              <tr key={r.id} className="h-16 border-b border-border align-middle last:border-0 hover:bg-stone-50">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-bold">{r.mto_number ?? `#${r.id}`}</td>
                {/* Ang daanan ng isang request: MTO # → FQ # → Order #. Iisa
                    lang ang FQ nito kahit ilang beses baguhin ang presyo. */}
                <td className="whitespace-nowrap px-2 py-2.5 font-mono text-[11px]">
                  {fq ? <a href="/quotations" className="font-semibold text-[#B87333] underline">{fq}</a> : <span className="text-muted">—</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 font-mono text-[11px]">
                  {r.order_number ? <a href="/orders" className="font-semibold text-success underline">{r.order_number}</a> : <span className="text-muted">—</span>}
                </td>
                <td className="px-4 py-3 !border-l-4 !border-l-[#caa45a]">
                  <span className="inline-block h-9 w-12 overflow-hidden rounded-md border border-border align-middle">
                    {r.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageUrl(r.image_url)} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-stone-100 text-[8px] text-muted">—</span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-[12.5px] font-semibold">
                  {r.product_name ?? "—"}
                  {rProds.length > 1 && (
                    <span className="ml-1.5 rounded border border-[#caa45a] bg-[#faf7f2] px-1 py-px align-middle font-mono text-[9px] font-bold text-[#a8842e]">
                      +{rProds.length - 1}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px]">{r.sku ?? "—"}</td>
                {/* MARAMING PRODUKTO = HIWALAY NA LINYA BAWAT ISA. Kapag
                    pinagdugtong sa isang string na naka-clamp sa dalawa,
                    nawawala ang pangalawa at pangatlo — at hindi malalaman
                    kung saan nagtatapos ang isa at nagsisimula ang susunod. */}
                <td className="px-3 py-2.5 align-middle text-[11px] leading-snug !text-left text-muted" title={buildTxt}>
                  {rProds.length > 1 ? (
                    <span className="block space-y-0.5">
                      {rProds.map((p, i) => (
                        <span key={i} className="flex gap-1.5">
                          <span className="shrink-0 font-mono text-[10px] text-[#a8842e]">{i + 1}.</span>
                          <span className="line-clamp-2 min-w-0">{specsOf(p.build?.lines) || p.name || p.sku || "Item"}</span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="line-clamp-2 block">{buildTxt || "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-[12px]">{fabricOf(r)}</td>
                <td className="px-3 py-2.5 text-[12px]">{r.category ?? "—"}</td>
                {/* Walang pangalan/PSID = hindi tinuloy ng customer sa
                    Messenger — hindi maipapadala doon ang quotation, kaya
                    malinaw ang tanda at tooltip. */}
                {/* Ang PSID (hindi ang pangalan) ang nagsasabi kung may thread:
                    minsan hindi maibigay ni Meta ang profile name pero bukas
                    naman ang thread — mapapadalhan pa rin ng quotation. */}
                <td className="px-3 py-2.5 text-[12px] !border-l-4 !border-l-[#caa45a]">
                  {r.customer_name ? (
                    r.customer_name
                  ) : r.psid ? (
                    <span className="text-muted" title={`Messenger thread is open (PSID ${r.psid}) but Facebook didn't share a profile name. The quotation can still be sent.`}>
                      Messenger customer
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#e7d194] bg-[#fdf3d0] px-2 py-0.5 text-[9.5px] font-bold text-[#8a6a1f]" title="The customer sent the build from the website but never opened the Messenger thread, so there's no thread to reply to. Create the quotation and share the link instead.">
                      ⚠ No Messenger thread
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[12px]">{r.contact ?? "—"}</td>
                <td className="px-3 py-2.5 text-[11.5px] leading-snug">{r.address ?? "—"}</td>
                {/* Ang team ang nagtatakda ng status — hindi ito awtomatiko.
                    Hangga't hindi Approved, marami pang pwedeng magbago sa
                    build/presyo, kaya bukas pa rin ang Create Quotation. */}
                <td className="px-2 py-2.5 text-center !border-l-4 !border-l-[#caa45a]">
                  <select
                    value={st}
                    disabled={saving === r.id}
                    onChange={(e) => void changeStatus(r.id, e.target.value as MtoStatus)}
                    className={`cursor-pointer rounded-full border px-2.5 py-1 text-[10px] font-bold outline-none disabled:opacity-50 ${pill(st)}`}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s} className="bg-white font-semibold text-ink">{s}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2.5 text-center">
                  {r.order_number ? (
                    // Tapos na ang daanan — wala nang aksyon dito.
                    <span className="text-[10px] text-muted">Ordered</span>
                  ) : st === "Approved" ? (
                    // Aprubado na ang presyo: susunod ay ang order mismo — bago
                    // man o dagdag sa mayroon na. Ang "Add to…" ay may ellipsis:
                    // nagbubukas ito ng pagsusuri, hindi ito basta kumikilos.
                    // Isang pindot na naglalagay ng singil sa maling tao ay
                    // natutuklasan lang kapag sinisingil na siya.
                    //
                    // ANG "ADD TO ORDER" AY HINDI NANGANGAILANGAN NG FQ. Ang
                    // website ay nagpapadala na ng presyo kada produkto, kaya
                    // alam na ang halaga; ang pagpilit ng quotation ay
                    // nagpapagawa ng dokumentong hindi naman kailangan — may
                    // order na ang customer, hindi na siya nagdedesisyon kung
                    // tatanggapin ang presyo. Ang CREATE ORDER ay kailangan pa
                    // rin nito: doon nabubuo ang bagong order mula sa dokumento.
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openAdd(r)}
                        disabled={saving === r.id}
                        title="Check for an existing order to add this to"
                        className="whitespace-nowrap rounded-lg border border-[#caa45a] bg-[#faf7f2] px-2.5 py-1.5 text-[10px] font-bold text-[#a8842e] hover:bg-[#f4ead8] disabled:opacity-40"
                      >
                        {saving === r.id ? "Checking…" : "Add to order…"}
                      </button>
                      {fq ? (
                        <button
                          type="button"
                          onClick={() => createOrder(r)}
                          disabled={saving === r.id}
                          title={`Open Create Order pre-filled from ${fq}`}
                          className="whitespace-nowrap rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-40"
                        >
                          Create Order
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openModal(r)}
                          title="A new order is built from the quotation — create it first"
                          className="whitespace-nowrap rounded-lg bg-[#4a3b1a] px-2.5 py-1.5 text-[10px] font-bold text-[#f4ead8] hover:bg-[#3a2e14]"
                        >
                          Create Quotation
                        </button>
                      )}
                    </div>
                  ) : (
                    <button type="button" onClick={() => openModal(r)} className="whitespace-nowrap rounded-lg bg-[#4a3b1a] px-2.5 py-1.5 text-[10px] font-bold text-[#f4ead8] hover:bg-[#3a2e14]">
                      Create Quotation
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={14} className="px-4 py-12 text-center text-muted">No quote requests yet — they arrive here when a customer taps Request a Quote on the website.</td></tr>
          )}
        </tbody>
      </table>
      </div>
      <PaginationFooter {...pg} />

      {/* ── CREATE QUOTATION — MISMONG DOCUMENT FORMAT, editable (mock parity) ── */}
      {open && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-black/50 p-4 sm:p-8" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className="mx-auto w-[min(44rem,100%)] overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-[#4a3b1a] px-4 py-2.5">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#f4ead8]">Formal Quotation — from {open.mto_number ?? `#${open.id}`}</span>
              {/* Kapag may FQ na, ito ang papalitan ng laman — hindi gumagawa
                  ng bagong numero, kahit ilang beses pindutin. */}
              <span className="ml-auto mr-3 flex items-center gap-2 text-[10px] text-[#cbb98a]">
                {/* Naitala na ang mga binago — hindi na kailangang ipadala para
                    hindi mawala ang tinipa. */}
                {savedAt && <span className="text-[#bfe3cd]">Saved</span>}
                <span>{(done[open.id] ?? open.fq_number) ? `updates ${done[open.id] ?? open.fq_number}` : "draft"}</span>
              </span>
              <button type="button" onClick={closeModal} className="text-[#e7dcc4] hover:text-white">✕</button>
            </div>

            {/* DOCUMENT — kaparehong ayos ng ipinapadalang quotation */}
            <div className="max-h-[calc(100vh-13rem)] overflow-y-auto bg-white px-7 py-6 text-[#111]" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="mb-2.5 text-[21px] font-extrabold tracking-[0.02em]">QUOTATION</p>
                  <table className="border-collapse text-[11px]">
                    <tbody>
                      <tr>
                        <td className="w-16 border border-[#111] px-2.5 py-1 font-bold">Date:</td>
                        <td className="min-w-[230px] border border-[#111] px-2.5 py-1">{dateLabel}</td>
                      </tr>
                      <tr>
                        <td className="border border-[#111] px-2.5 py-1 font-bold">Name:</td>
                        <td className="border border-[#111] p-0">
                          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" className="w-full bg-transparent px-2.5 py-1 text-[11px] outline-none" />
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-[#111] px-2.5 py-1 font-bold">Address:</td>
                        <td className="border border-[#111] p-0">
                          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="w-full bg-transparent px-2.5 py-1 text-[11px] outline-none" />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <span className="flex h-[74px] w-[74px] shrink-0 items-center justify-center rounded-full" style={{ background: "radial-gradient(circle at 50% 42%,#4a3b22 0 60%,#caa45a 61% 70%,#33261C 71%)" }}>
                  <span className="text-[13px] font-bold tracking-[0.08em] text-[#e9d9ae]" style={{ fontFamily: "Georgia, serif" }}>PAN</span>
                </span>
              </div>

              <p className="mt-3.5 text-[11px]">Dear Sir/Maam:</p>
              <p className="text-[11px]">Greetings from PAN Furniture Maker, Interior Decorator and Contractor!</p>
              <p className="mb-3 text-[11px]">We are pleased to submit to you our quotation for the following:</p>

              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-[#f5e7cf]">
                    <th className="w-[38px] border border-[#111] p-1.5">Qty</th>
                    <th className="w-[86px] border border-[#111] p-1.5">Item</th>
                    <th className="border border-[#111] p-1.5">Product Description</th>
                    <th className="w-[104px] border border-[#111] p-1.5">Unit Price</th>
                    <th className="w-[92px] border border-[#111] p-1.5">Total Price</th>
                  </tr>
                </thead>
                <tbody>
                  {/* ISANG HILERA KADA PRODUKTO — kapareho ng ipapadalang
                      dokumento. Kapag pinagsama sa isang hilera, hindi
                      makikita ng team kung aling presyo ang kanino, at ang
                      nasa harap nila ay iba sa ipinapadala. */}
                  {mtoProducts(open).map((p, pi) => {
                    // Simula ng pangkat ng produktong ito sa docLines: lahat ng
                    // nauna, kasama ang blangkong separator sa pagitan.
                    const at = docSpans.slice(0, pi).reduce((s, n) => s + n, 0) + pi;
                    const n = docSpans[pi] ?? docLines.length;
                    const idx = Array.from({ length: n }, (_, k) => at + k);
                    const sub = idx.reduce<number>((s, i) => s + (partNums[i] ?? 0), 0);
                    return (
                  <tr key={`p${pi}`}>
                    <td className="border border-[#111] p-1.5 text-center">1</td>
                    <td className="border border-[#111] p-1 text-center">
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imageUrl(p.image)} alt="" className="mx-auto h-[54px] w-[72px] rounded object-cover" />
                      ) : null}
                    </td>
                    <td className="border border-[#111] px-1.5 py-1.5">
                      {/* NA-EEDIT ANG BAWAT LINYA. Ang blangkong linya ay
                          hiwalay sa pagitan ng pangkat — walang kahon doon,
                          puwang lang, kaya nananatiling nababasa ang hati.
                          Ang pamagat (unang linya) at ang mga pamagat ng
                          seksyon ay teksto rin — binabago rin sila ng team. */}
                      {idx.map((i) =>
                        docLines[i] ? (
                          <span key={i} className="group my-[2px] flex h-[22px] items-center gap-1">
                            <input
                              value={docLines[i]}
                              onChange={(e) => editLine(i, e.target.value)}
                              className="min-w-0 flex-1 h-[22px] rounded border border-dashed border-[#c9b98e] bg-transparent px-1 text-[11px] leading-[20px] outline-none focus:border-solid focus:border-[#B87333] focus:bg-white"
                            />
                            {/* LAGING KITA ANG DALAWANG BUTON, gaya ng dashed
                                na kahon ng presyo sa tabi. Nasa hover sila noon
                                at hindi nila alam na maaari palang dagdagan o
                                alisin ang linya — ang kontrol na kailangan pang
                                matuklasan ay hindi umiiral. */}
                            <button
                              type="button"
                              onClick={() => addLine(i)}
                              title="Add a line below"
                              className="shrink-0 h-[22px] px-0.5 text-[11px] leading-none text-[#c9b98e] hover:text-[#B87333]"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => removeLine(i)}
                              // Ang huling linya ng produkto ay hindi
                              // maaalis — kita pa rin ang buton, kaya ipinapakita
                              // nito na naka-disable at hindi lamang basta
                              // hindi tumutugon sa pagpindot.
                              disabled={n <= 1}
                              title={n <= 1 ? "A product needs at least one line" : "Remove this line"}
                              className="shrink-0 h-[22px] px-0.5 text-[11px] leading-none text-[#c9b98e] hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-[#c9b98e]"
                            >
                              ✕
                            </button>
                          </span>
                        ) : (
                          <span key={i} className="my-[2px] block h-[22px]" />
                        ),
                      )}
                      {/* Fee para sa PRODUKTONG ITO lang — sa maraming produkto.
                          Sa isa, ang mga pill sa ibaba ang sapat. */}
                      {(
                        <div className="mt-1.5 flex gap-1.5">
                          <button type="button" onClick={() => addFeeLine(pi, "• Addtl. Shipping Fee")} className="rounded-full border border-dashed border-[#caa45a] bg-[#faf5e9] px-2 py-[1px] text-[9.5px] font-bold text-[#8a6a1f] hover:border-[#B87333]">＋ Shipping fee</button>
                          <button type="button" onClick={() => addFeeLine(pi, "• Addtl. Rush Fee")} className="rounded-full border border-dashed border-[#caa45a] bg-[#faf5e9] px-2 py-[1px] text-[9.5px] font-bold text-[#8a6a1f] hover:border-[#B87333]">＋ Rush fee</button>
                          <button type="button" onClick={() => addBlankLine(pi)} className="rounded-full border border-dashed border-[#caa45a] bg-[#faf5e9] px-2 py-[1px] text-[9.5px] font-bold text-[#8a6a1f] hover:border-[#B87333]">＋ Add row</button>
                        </div>
                      )}
                    </td>
                    <td className="border border-[#111] px-2 py-1.5 text-right align-top">
                      {idx.map((i) =>
                        // Walang kahon sa hiwalay na linya — walang presyo ang
                        // isang puwang, at ang kahon doon ay nag-aanyaya lang
                        // ng maling entry.
                        docLines[i] ? (
                          <input
                            key={i}
                            value={money(parts[i] ?? "", moneyFocus === String(i))}
                            placeholder="—"
                            inputMode="decimal"
                            onFocus={() => setMoneyFocus(String(i))}
                            onBlur={() => setMoneyFocus(null)}
                            onChange={(e) => setParts((q) => { const nx = [...q]; nx[i] = e.target.value; return nx; })}
                            className="my-[2px] block h-[22px] w-full rounded border border-dashed border-[#c9b98e] bg-white px-1.5 text-right text-[11px] font-bold leading-[20px] outline-none hover:border-[#B87333] focus:border-solid focus:border-[#B87333]"
                          />
                        ) : (
                          <span key={i} className="my-[2px] block h-[22px]" />
                        ),
                      )}
                    </td>
                    {/* Isang produkto: ang kabuuang tinipa; marami: suma ng
                        pangkat na ito lang. */}
                    <td className="relative border border-[#111] p-1.5 text-right align-middle">
                      {/* DELETE SA KANTO NG HILERA (Joe 2026-09-06) — hindi sa pills. */}
                      <button
                        type="button"
                        onClick={() => deleteProduct(pi)}
                        disabled={docSpans.length <= 1 || adding}
                        title={docSpans.length <= 1 ? "A quotation needs at least one product" : "Remove this product"}
                        className="absolute right-1 top-1 rounded-full border border-red-300 bg-red-50 px-2 py-[1px] text-[9.5px] font-bold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Delete
                      </button>
                      {fmt2(docSpans.length > 1 ? sub : itemTotal)}
                    </td>
                  </tr>
                    );
                  })}
                  <tr>
                    <td className="border border-[#111] p-1.5 text-center">1</td>
                    <td className="border border-[#111] p-1.5" />
                    <td className="border border-[#111] px-2.5 py-1.5">Delivery and Installation fee</td>
                    <td className="border border-[#111] p-0 text-right align-middle">
                      <input value={money(feeStr, moneyFocus === "fee")} inputMode="decimal" onFocus={() => setMoneyFocus("fee")} onBlur={() => setMoneyFocus(null)} onChange={(e) => setFeeStr(e.target.value)} className="m-[3px] w-[calc(100%-6px)] rounded border border-dashed border-[#c9b98e] bg-white px-1.5 py-1 text-right text-[11px] font-bold outline-none hover:border-[#B87333] focus:border-solid focus:border-[#B87333]" />
                    </td>
                    <td className="border border-[#111] p-1.5 text-right">{fmt2opt(num(feeStr))}</td>
                  </tr>

                  <tr>
                    <td colSpan={4} className="border border-[#111] px-2.5 py-1.5 font-bold">TOTAL PRICE</td>
                    <td className="border border-[#111] p-1.5 text-right font-bold">{fmt2(grandTotal)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => setPickerOpen(true)} disabled={adding} className="rounded-full border-[1.5px] border-dashed border-[#caa45a] bg-[#faf5e9] px-3 py-1 text-[10px] font-bold text-[#8a6a1f] hover:border-[#B87333] disabled:opacity-50">＋ Add item <span className="font-normal">(from catalog)</span></button>
                <span className="text-[10px] text-muted">Rows, shipping / rush fees and Delete are per product — use the pills inside each product.</span>
              </div>
              {feeNote && <p className="mt-1.5 text-[10px] text-[#8a6a1f]">{feeNote}</p>}

              <p className="mt-3 text-[11px] font-bold">Payment Terms (Cash)</p>
              <p className="flex justify-between text-[11px]"><span>Downpayment (30%)</span><b>{fmt2(grandTotal * 0.3)}</b></p>
              <p className="flex justify-between text-[11px]"><span>Upon delivery and installation</span><b>{fmt2(grandTotal * 0.7)}</b></p>
              <p className="mt-3 text-[10.5px]"><b>Refund Policy:</b> We offer refunds or exchanges for defective products within 3 days of delivery.</p>
              <p className="text-[10px]">Please note that down payments are non-refundable. Defective products will be repaired or exchanged promptly.</p>
              <p className="mt-2 text-[10px]">To confirm the order, you may send the 30% downpayment to any of the following accounts. Kindly note that all downpayments are strictly non-refundable, as they are used to secure materials and begin processing your order.</p>
              <p className="mt-2 text-[11px] font-extrabold">FOR CASH PAYMENTS</p>
              <p className="text-[10.5px]">☑ <b>BPI</b> – Account name: Jessone Purificacion&nbsp;&nbsp;Account number: 8529594349</p>
              <p className="text-[10.5px]">☑ <b>BDO Unibank, Inc.</b> – Account name: Jessone Purificacion&nbsp;&nbsp;Account number: 006960153572</p>
              {/* Isang gawi na lang (2026-08-21): ang larawan sa thread ay
                  walang QR — kaya hindi nagdadagdag ang Messenger ng "QR
                  transfer" card — at ang QR ay nasa kasamang "<FQ> QR.pdf".
                  Walang pipiliin ang team, kaya walang paliwanag sa modal. */}
              <label className={`mt-3 flex items-center gap-2 rounded border border-[#E8DFD3] bg-[#FAF7F2] px-3 py-2 text-[11px] ${open.psid ? "" : "opacity-60"}`}>
                <input type="checkbox" checked={send && !!open.psid} disabled={!open.psid} onChange={() => setSend((v) => !v)} className="accent-[#B87333]" />
                Send to the customer&apos;s Messenger{!open.psid && " — no thread yet (customer hasn't opened Messenger)"}
              </label>
              {msg && <p className={`mt-2 text-[11px] font-semibold ${msg.startsWith("Created") ? "text-emerald-700" : "text-rose-700"}`}>{msg}</p>}
              {/* Ang link ay lumalabas LANG kapag hindi naipadala sa Messenger
                  (walang thread o sarado ang 24h window) — doon lang ito
                  kailangan; sa matagumpay na padala ay ingay lang ito. */}
              {docUrl && !sentOk && (
                <p className="mt-1.5 flex items-center gap-2 rounded border border-[#E8DFD3] bg-[#FAF7F2] px-3 py-2 text-[10.5px]">
                  <a href={docUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-semibold text-[#B87333] underline">{docUrl}</a>
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(docUrl); }} className="shrink-0 rounded border border-border bg-white px-2 py-1 font-bold">Copy link</button>
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-border bg-[#faf8f2] px-4 py-2.5">
              <button type="button" disabled={previewing || !(itemTotal > 0)} onClick={() => void previewDoc()} className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-bold hover:bg-stone-50 disabled:opacity-50">
                {previewing ? "Rendering…" : "Preview sent document"}
              </button>
              <span className="flex-1" />
              <button type="button" onClick={closeModal} className="rounded-lg border border-border px-4 py-2 text-xs font-bold hover:bg-stone-50">Close</button>
              <button type="button" disabled={busy || !(itemTotal > 0)} onClick={() => void create()} className="rounded-lg bg-[#4a3b1a] px-4 py-2 text-xs font-bold text-[#f4ead8] hover:bg-[#3a2e14] disabled:opacity-50">
                {busy ? "Saving…" : send && open.psid ? "Send to Messenger" : "Create quotation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QUOTATION DOCUMENT PREVIEW — ang mismong FQ format (SVG) ── */}
      {docSvg && (
        // POP-UP SA IBABAW NG EDITOR (Joe 2026-09-06): mas mataas na layer kaysa sa
        // editor modal, may malinaw na Close sa ibaba, at Esc para isara.
        <div
          className="fixed inset-0 z-[90] overflow-y-auto bg-black/60 p-4 sm:p-8"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setDocSvg(null); }}
          onKeyDown={(e) => { if (e.key === "Escape") setDocSvg(null); }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div className="mx-auto w-[min(46rem,100%)] overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-[#4a3b1a] px-4 py-2.5">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#f4ead8]">Quotation preview — this is what the customer receives</span>
              <button type="button" onClick={() => setDocSvg(null)} className="text-[#e7dcc4] hover:text-white" aria-label="Close preview">✕</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={docSvg} alt="Quotation preview" className="w-full" />
            <div className="flex justify-end gap-2 border-t border-border bg-[#faf6ec] px-4 py-3">
              <button type="button" onClick={() => setDocSvg(null)} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] shadow-sm hover:opacity-90">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PAGSUSURI BAGO IDAGDAG SA ORDER ──
          Sino ang natugma, paano, at ano ang magbabago. Walang naisusulat
          hangga't hindi nakikita ng team kung kanino ang order — ang tugma ay
          hula, at ang address ang madalas na nagpapabunyag ng mali. */}
      {addFor && addPlan && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={() => setAddFor(null)}>
          <div className="w-full max-w-2xl rounded-xl border border-border bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold">Add {addPlan.request.mto ?? `#${addFor.id}`} to an existing order</p>
                {/* ANG IDINADAGDAG — bawat produkto, hindi lang ang bilang.
                    Ito ang inihahambing ng team sa laman ng order sa ibaba. */}
                <span className="mt-1 block text-[11px]">
                  {mtoProducts(addFor).map((p, i) => (
                    <span key={i} className="mr-2 inline-block text-ink">
                      {i > 0 && <span className="mr-2 text-muted">·</span>}
                      {p.name ?? p.sku ?? "Custom build"}
                      {p.build?.size && <span className="ml-1 text-muted">{p.build.size}</span>}
                    </span>
                  ))}
                </span>
                <p className="text-[10.5px] text-muted">
                  {addPlan.request.fq && <>{addPlan.request.fq} · </>}
                  {addPlan.request.itemCount} item{addPlan.request.itemCount === 1 ? "" : "s"} · <b className="font-mono text-ink">{peso(addPlan.request.amount)}</b>
                  {/* Wala pang FQ: gagawa ng isa mula sa presyo ng website
                      kapag idinagdag, para may talaan ang bawat linya ng
                      order. Sinasabi ito bago pindutin, hindi pagkatapos. */}
                  {addPlan.request.pricedBy === "website" && (
                    <span className="ml-1.5 rounded-full border border-[#e7d194] bg-[#fdf3d0] px-1.5 py-px text-[9px] font-bold text-[#8a6a1f]">
                      website price — a quotation will be created
                    </span>
                  )}
                </p>
              </div>
              <button type="button" onClick={() => setAddFor(null)} className="shrink-0 pl-3 text-muted hover:text-ink">✕</button>
            </div>

            <div className="px-4 py-3">
              {addPlan.candidates.length === 0 ? (
                <p className="rounded-lg border border-border bg-[#faf7f2] px-3 py-3 text-[12px] text-muted">
                  No open order found for <b className="text-ink">{addPlan.request.customer || "this customer"}</b>.
                  Use <b className="text-ink">Create Order</b> instead.
                </p>
              ) : (
                <>
                  {/* HANAPIN ANG NUMERO. Lumalabas lang kapag mahaba na ang
                      listahan — sa dalawa o tatlo, ang kahon ay dagdag na
                      hakbang sa halip na tulong. */}
                  {addPlan.candidates.length > 3 && (
                    <div className="mb-2 flex items-center gap-2">
                      <input
                        value={addQ}
                        onChange={(e) => setAddQ(e.target.value)}
                        placeholder="Search order #, product, name or address…"
                        className="w-full rounded-lg border border-border px-3 py-1.5 text-[12px] focus:border-[#B87333] focus:outline-none"
                      />
                      {addQ && (
                        <button type="button" onClick={() => setAddQ("")} className="shrink-0 text-[11px] text-muted hover:text-ink">Clear</button>
                      )}
                    </div>
                  )}
                  {shown.length === 0 && (
                    <p className="rounded-lg border border-border bg-[#faf7f2] px-3 py-3 text-[12px] text-muted">
                      No order matches <b className="text-ink">{addQ}</b>.
                    </p>
                  )}
                  {shown.map((c) => {
                    const on = addPick === c.id;
                    // Ang address ang tunay na tanda: bihirang magkapareho ng
                    // tirahan ang dalawang taong magkapangalan, at ang pangalan
                    // ang nagtugma sa kanila kaya hindi iyon ang makakahuli.
                    const addrA = tidyAddress(addPlan.request.address);
                    const addrB = tidyAddress(c.address);
                    const sameAddr = sameText(addrA, addrB);
                    return (
                      <label
                        key={c.id}
                        className={`mb-2 block cursor-pointer rounded-lg border px-3 py-2.5 ${on ? "border-[#caa45a] bg-[#faf7f2]" : "border-border hover:bg-stone-50"}`}
                      >
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <input type="radio" checked={on} onChange={() => { setAddPick(c.id); setAddDate(c.date_of_delivery ?? ""); }} className="accent-[#B87333]" />
                          <b className="font-mono text-[12px]">{c.order_number ?? `#${c.id}`}</b>
                          <span className={`rounded-full border px-1.5 py-px text-[9px] font-bold ${pill(c.status ?? "")}`}>{c.status ?? "—"}</span>
                          <span className="font-mono text-[11px]">{peso(c.balance)}<span className="ml-1 text-[9px] font-sans text-muted">balance</span></span>
                          {/* Ang naka-schedule na petsa ang nagsasabi kung
                              gaano kalapit sa biyahe ang order na ito. */}
                          <span className="text-[10.5px] text-muted">
                            {c.date_of_delivery ? `delivery ${c.date_of_delivery}` : "no delivery date"}
                          </span>
                          <span className="ml-auto font-mono text-[9px] text-muted">
                            matched on {c.matchedBy === "psid" ? "Messenger" : c.matchedBy}
                          </span>
                        </span>

                        {/* HINDI NAPILI: isang linyang buod lang. Ang buong
                            detalye ng apat na order nang sabay ay mas mahaba
                            kaysa sa mabasa — at ang tanong sa yugtong ito ay
                            "alin?", hindi pa "tama ba ang lahat ng detalye?".
                            Ang berdeng address ay ipinapakita pa rin: iyon ang
                            senyales na nagtuturo sa tamang order. */}
                        {!on ? (
                          <span className="mt-1 flex gap-2 border-t border-border pt-1 text-[11px]">
                            <span className="min-w-0 flex-1 truncate text-muted">
                              {c.lines.map((l) => l.name).join(" · ") || "—"}
                            </span>
                            <span className={`shrink-0 text-[10.5px] ${sameAddr ? "font-semibold text-success" : "text-muted"}`}>
                              {sameAddr ? "address matches" : (addrB.split(",").slice(-2).join(",").trim() || "—")}
                            </span>
                          </span>
                        ) : (
                          <>
                            {/* ANG LAMAN NG ORDER — dito nakikita kung ito nga ang
                                order na iniisip nila. Ang "2 items" ay walang
                                sinasabi; ang "Costumized Bed · King 2" ay meron. */}
                            <span className="mt-1.5 block border-t border-border pt-1.5">
                              {c.lines.slice(0, 4).map((l, i) => (
                                <span key={i} className="flex gap-2 py-px text-[11px]">
                                  <span className="min-w-0 flex-1 truncate text-ink">
                                    {l.qty > 1 && <span className="mr-1 font-mono text-[10px] text-muted">{l.qty}×</span>}
                                    {l.name}
                                  </span>
                                  <span className="shrink-0 font-mono text-[10.5px] text-muted">{peso(l.amount)}</span>
                                </span>
                              ))}
                              {c.lines.length > 4 && (
                                <span className="block py-px text-[10.5px] italic text-muted">…and {c.lines.length - 4} more</span>
                              )}
                            </span>

                            {/* Magkatabi ang detalye ng customer — dito lumalabas
                                ang maling tugma. */}
                            <span className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-1.5 text-[11px]">
                              <Cmp k="Name" a={addPlan.request.customer} b={c.customer_name} />
                              <Cmp k="Mobile" a={addPlan.request.contact} b={c.contact_number} />
                              <span className="col-span-2">
                                <span className="block text-[9px] uppercase tracking-[0.08em] text-muted">Deliver to</span>
                                <span className={sameAddr ? "text-success" : "text-[#8a6a1f]"}>
                                  {addrB || "—"}
                                </span>
                                {!sameAddr && addrA && (
                                  <span className="mt-px block text-[10px] text-[#8a6a1f]">
                                    <b>Request says:</b> {addrA}
                                  </span>
                                )}
                              </span>
                            </span>
                          </>
                        )}

                        {on && (
                          <span className="mt-2 block rounded border border-[#caa45a] bg-white px-2.5 py-2 text-[11px]">
                            <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-[0.08em] text-[#a8842e]">What this changes</span>
                            <span className="flex justify-between py-px"><span className="text-muted">Items</span><span className="font-mono">{c.itemCount} → {c.itemCount + addPlan.request.itemCount}</span></span>
                            <span className="flex justify-between py-px"><span className="text-muted">Total</span><span className="font-mono"><s className="mr-1 text-muted">{peso(c.total)}</s>{peso(c.total + addPlan.request.amount)}</span></span>
                            <span className="flex justify-between py-px"><span className="font-semibold">Balance</span><span className="font-mono font-bold text-[#B87333]"><s className="mr-1 font-normal text-muted">{peso(c.balance)}</s>{peso(c.balance + addPlan.request.amount)}</span></span>
                            {/* Ang order ay may isang biyahe, kaya ang custom
                                build na idinagdag ay nagtutulak ng petsa. */}
                            <span className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-border pt-1.5">
                              <span className="text-muted">Delivery</span>
                              <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} className="rounded border border-border px-1.5 py-0.5 text-[11px]" />
                              {c.date_of_delivery
                                ? addDate !== c.date_of_delivery && <span className="text-[10px] font-semibold text-[#8a6a1f]">was {c.date_of_delivery}</span>
                                : <span className="text-[10px] text-muted">none scheduled — leave blank to keep it that way</span>}
                            </span>
                            {/* ANG 30% AY TUMATAAS KASABAY NG KABUUAN. Ang
                                naunang bayad ay hindi binabawi, pero dapat
                                malaman ng team kung magkano ang kulang bago
                                sila magpasya. */}
                            {(() => {
                              const newTotal = c.total + addPlan.request.amount;
                              const short = newTotal * 0.3 - c.paid;
                              if (short <= 0.005) return null;
                              return (
                                <span className="mt-1.5 block rounded border border-[#e7d194] bg-[#fdf3d0] px-2 py-1.5 text-[10.5px] text-[#8a6a1f]">
                                  <b>Downpayment rises to {peso(newTotal * 0.3)}</b> — {peso(short)} more than paid.
                                  Collect it now or let it ride on the balance; the order stays confirmed either way.
                                </span>
                              );
                            })()}
                          </span>
                        )}
                      </label>
                    );
                  })}

                  {/* ANG NAPILI AY MAAARING NASA LABAS NG SALÀ. Ang buton ay
                      gumagana pa rin, kaya kung walang paalala, maidadagdag ang
                      request sa order na hindi na nakikita ng nagpipindot. */}
                  {addPick != null && !shown.some((c) => c.id === addPick) && (
                    <p className="mb-2 flex items-center gap-2 rounded-lg border border-[#e7d194] bg-[#fdf3d0] px-3 py-2 text-[11px] text-[#8a6a1f]">
                      <b>{addPlan.candidates.find((c) => c.id === addPick)?.order_number ?? "The selected order"}</b> is selected but hidden by the search.
                      <button type="button" onClick={() => setAddQ("")} className="ml-auto shrink-0 font-semibold underline">Show it</button>
                    </p>
                  )}

                  {/* Ang tsek ang sandaling huminto at magbasa — at naitatala. */}
                  <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[11.5px]">
                    <input type="checkbox" checked={addOk} onChange={(e) => setAddOk(e.target.checked)} className="accent-[#B87333]" />
                    I have confirmed with the customer that this is their order
                  </label>
                </>
              )}

              {addErr && <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-800">{addErr}</p>}

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void doAdd()}
                  disabled={addBusy || !addOk || addPick == null}
                  className="rounded-lg bg-primary px-3.5 py-2 text-[11.5px] font-bold text-white disabled:opacity-40"
                >
                  {addBusy ? "Adding…" : "Add to order"}
                </button>
                <button type="button" onClick={() => setAddFor(null)} className="rounded-lg border border-border px-3.5 py-2 text-[11.5px] font-bold">Cancel</button>
                <button type="button" onClick={() => { const r = addFor; setAddFor(null); void createOrder(r); }} className="ml-auto text-[11px] font-semibold text-[#B87333] underline">
                  Create a separate order instead
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {pickerOpen && open && (
        <CatalogPickerOverlay products={products} onPick={addCatalogItem} onClose={() => setPickerOpen(false)} />
      )}
      {confirmDel != null && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4" onMouseDown={() => setConfirmDel(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold text-[#3a2e14]">Remove this product?</p>
            <p className="mt-1 text-xs text-muted">
              {(() => { let at = 0; for (let k = 0; k < confirmDel; k++) at += (docSpans[k] ?? 0) + 1; return docLines[at] || "This product"; })()} — its lines and prices leave the quotation. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDel(null)} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-stone-100">Cancel</button>
              <button type="button" onClick={() => void deleteProductNow(confirmDel)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Magkatabing halaga mula sa request at mula sa order. Berde kapag pareho,
// amber kapag hindi — ang hindi pagkakatugma ang senyales, kaya hindi
// itinatago. HINDI ipinapakita ang halaga ng request kapag blangko ito o
// kapag pangalan ng tindahan ang nakatala doon: ang "· request: PAN Furniture"
// sa tabi ng bawat pangalan ay ingay lang, at ang ingay na palaging naroon ay
// hindi na binabasa.
function CatalogPickerOverlay({ products, onPick, onClose }: { products: ProductRow[]; onPick: (patch: { description?: string | null; unitPrice?: number; image?: string | null; sku?: string | null; category?: string | null }) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white p-3 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#4a3b1a]">Add item from catalog</p>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-stone-100">Close</button>
        </div>
        {/* Walang constructor flow sa quotation — blangkong grupo. */}
        <ProductSearch products={products} onPick={(p) => onPick(p)} cGroups={[]} byName={new Map()} alwaysOpen />
      </div>
    </div>
  );
}

function Cmp({ k, a, b }: { k: string; a: string | null; b: string | null }) {
  const same = sameText(a, b);
  const worth = !!normTxt(a) && !isPlaceholderName(a);
  return (
    <span>
      <span className="block text-[9px] uppercase tracking-[0.08em] text-muted">{k}</span>
      <span className={same ? "text-success" : worth ? "text-[#8a6a1f]" : "text-ink"}>
        {b || "—"}
        {!same && worth && <b className="ml-1 text-[10px] font-semibold">· request: {a}</b>}
      </span>
    </span>
  );
}

const normTxt = (v: string | null | undefined) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// "Messenger", "PAN Furniture" at katulad ay hindi pangalan ng customer —
// naitatala ang mga ito kapag hindi naibigay ni Meta ang profile name. Ang
// paghahambing sa mga ito ay nagpapaamber sa bawat hilera nang walang dahilan.
const isPlaceholderName = (v: string | null | undefined) =>
  /^(messenger( customer)?|pan furniture|customer|walk[- ]?in)$/i.test(normTxt(v));

// Pareho ba? Ang pangalan ay tinitipa, kaya ang "Joe" at "Joe Marie" ay
// itinuturing na tugma — sapat na ang isa ay nasa simula ng isa.
function sameText(a: string | null | undefined, b: string | null | undefined) {
  const x = normTxt(a), y = normTxt(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const dx = x.replace(/\D/g, ""), dy = y.replace(/\D/g, "");
  // Telepono: ang mga digit lang ang mahalaga (0917…, +63917…, 0917-…).
  if (dx.length >= 10 && dy.length >= 10) return dx.replace(/^63/, "0") === dy.replace(/^63/, "0");
  return x.startsWith(y) || y.startsWith(x);
}

// Ang address mula sa website ay may inuulit na lungsod/probinsya:
//   "Adia, Agoncillo, Batangas, 4211, Brgy. Adia, Agoncillo, Batangas"
// Inaalis ang doble para mabasa sa isang tingin — ito ang bahaging tunay na
// nakakahuli ng maling tugma.
function tidyAddress(v: string | null | undefined): string {
  const seen = new Set<string>();
  return String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => {
      const k = s.toLowerCase().replace(/^(brgy\.?|barangay)\s+/i, "");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(", ");
}

const peso = (n: number) => "₱" + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
