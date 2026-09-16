"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { createQuotation } from "@/app/quotations/actions";
import { groupBuildLines, groupProductLines, groupedFromProducts, mtoProducts, productDocLines, repriceProducts } from "@/lib/build-lines";

// MADE-TO-ORDER REQUESTS (Phase 3/4) — quote requests galing sa website.
// Ang "Create Quotation" dito ay dumadaan sa EXISTING quotations module
// (FQ numbering, SVG render, Messenger send, follow-ups) — prefilled mula
// sa build ng customer, tapos minamarkahang Quoted ang request.

export type MtoRow = {
  id: number;
  mto_number: string | null;
  sku: string | null;
  slug: string | null;
  product_name: string | null;
  category: string | null;
  image_url: string | null;
  // Ang mga presyo at fee ay hindi galing sa website kundi sa huling pag-save
  // ng team sa document editor — itinatabi rito para hindi na ipa-type muli sa
  // susunod na pagbukas.
  build: {
    size?: string;
    fabric?: string;
    lines?: { label: string; price?: number }[];
    total?: number;
    priced?: boolean;
    deliveryFee?: number;
    extraShipFee?: number;
    rushFee?: number;
    // MARAMING PRODUKTO KADA REQUEST (2026-08-21). Wala ito sa lumang row —
    // basahin sa pamamagitan ng mtoProducts(), hindi nang diretso.
    products?: import("@/lib/build-lines").MtoProduct[];
    // ANG MANU-MANONG BINAGO NG TEAM (2026-08-22). Ang document editor ay
    // nagpapahintulot na baguhin, dagdagan at alisin ang mismong linya — ang
    // pananalita ay minsan pinapaayos, at may napagkasunduan sa Messenger na
    // wala sa configurator. Kapag may laman ito, ITO ang pinal: ito ang
    // ipinapadala, ito ang napupunta sa order, hindi na ang binuo mula sa
    // `products`. Nananatili ang `products` bilang tala ng orihinal na
    // hiniling sa website.
    docLines?: string[];
    // Bilang ng linya kada produkto sa docLines (hindi kasama ang separator).
    // Ito ang hati — hindi ang blangkong linya, na meron din sa loob ng
    // produkto sa pagitan ng mga pangkat.
    docSpans?: number[];
  };
  customer_name: string | null;
  contact: string | null;
  address: string | null;
  psid: string | null;
  status: string;
  fq_number: string | null;
  order_number: string | null;
  created_at: string;
};

export async function loadMtoRequests(): Promise<MtoRow[]> {
  const db = createServerSupabase();
  const { data, error } = await db
    .from("mto_requests")
    .select("*")
    .order("id", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as MtoRow[];
}

// Gumawa ng Formal Quotation mula sa MTO request — auto-fill lahat; ang
// presyo/fee ay galing sa modal (editable ng team bago ipadala).
export async function createQuotationFromMto(input: {
  id: number;
  customerName: string;
  address: string | null;
  unitPrice: number;
  deliveryFee: number;
  send: boolean;
  // Per-line prices na in-edit ng team sa document editor (katapat ng bawat
  // linya ng description); ang unitPrice ay ang kabuuan nila.
  lineParts?: (number | null)[];
  // Ang mismong teksto ng dokumento — kasama ang binago, idinagdag at inalis
  // ng team sa editor. Kapag may laman, ITO ang naipapadala; ang binuo mula sa
  // `products` ay panimula lang.
  lines?: string[];
  // Haba ng pangkat kada produkto — galing sa editor, kaya sumasabay sa
  // idinagdag at inalis na linya.
  spans?: number[];
  rushFee?: number;
  extraShipFee?: number;
  // Itago ang bank QR sa document (iwas sa Messenger QR-transfer widget).
  hideQr?: boolean;
  // AWTOMATIKONG PAGGAWA kapag idinadagdag sa order (addRequestToOrder). Ang
  // harang sa ibaba ay laban sa PAGPAPALIT ng naaprubahang dokumento; ang
  // request na Approved pero WALA pang FQ ay walang mapapalitan — kailangan
  // lang nito ng talaan para may maipapakita ang linya sa order.
  autoForOrder?: boolean;
}): Promise<{ ok: true; fqNumber: string | null; url: string; sent: number; pdfError?: string | null } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };

  const db = createServerSupabase();
  const { data: row, error } = await db.from("mto_requests").select("*").eq("id", input.id).maybeSingle();
  if (error || !row) return { error: error?.message ?? "Request not found." };
  const r = row as MtoRow;
  // Mula sa Approved, ang Formal Quotation Builder na ang may hawak ng
  // dokumento — hindi na ito binabago mula rito. Makitid ang bypass: unang
  // paggawa lang (walang fq_number), at galing lang sa add-to-order.
  if ((r.status === "Approved" || r.status === "Ordered") && !(input.autoForOrder && !r.fq_number)) {
    return { error: `${r.mto_number ?? "This request"} is ${r.status.toLowerCase()} — edit it in the Formal Quotation Builder.` };
  }

  // Description = product + build bullets, NAKAPANGKAT at walang doble —
  // eksaktong porma ng document editor (mto-requests-table openModal). Dating
  // muling binubuo rito nang patuloy, kaya sama-sama ang naipapadalang
  // dokumento kahit nakapangkat na ang nasa modal.
  //
  // MARAMING PRODUKTO: isang item kada produkto — ang renderer ay matagal nang
  // gumuguhit ng listahan (may sariling larawan, paglalarawan at presyo kada
  // hilera), kaya walang binabago sa dokumento mismo.
  const prods = mtoProducts(r);
  // Ang mga presyong tinipa ng team ay isang mahabang listahan na katapat ng
  // pinagsamang linya ng lahat ng produkto. Hinahati ito rito ayon sa haba ng
  // bawat produkto — sa maling hati, mapupunta sa ottoman ang presyo ng kama.
  const parts = input.lineParts ?? [];
  // ANG MANU-MANONG BINAGO ANG MASUSUNOD. Ang haba ng bawat pangkat ay galing
  // sa CLIENT (`spans`), hindi sa muling pagbuo: kapag nagdagdag o nag-alis ng
  // linya ang team, iba na ang haba sa binuong bersyon — at kung ang huli ang
  // gagamitin sa paghahati, mapupunta sa susunod na produkto ang mga linya at
  // presyo ng nauna.
  const built = prods.map((p) => groupProductLines(p));
  const spans = input.spans?.length === prods.length ? input.spans : built.map((b) => b.length);
  // Ang `lines` ay ang BUONG editor — may isang blangkong separator sa
  // pagitan ng produkto — kaya ang inaasahang haba ay suma ng spans + (n−1).
  const manual = input.lines?.length === spans.reduce((a, b) => a + b, 0) + (prods.length - 1) ? input.lines : null;
  let cursor = 0; // sa parts (walang separator)
  let lcursor = 0; // sa manual (may separator)
  const items = prods.map((p, pi) => {
    const n = spans[pi];
    const lines = manual ? manual.slice(lcursor, lcursor + n) : built[pi];
    const slice = parts.length ? parts.slice(cursor, cursor + n) : [];
    cursor += n;
    lcursor += n + 1;
    return {
      qty: 1,
      description: lines.join("\n"),
      unitPrice: slice.reduce((s: number, v) => s + (Number(v) || 0), 0),
      image: p.image ?? null,
      ...(slice.length ? { lineParts: slice } : {}),
    };
  });
  // Isang produkto lang? Ang kabuuang tinipa ng team ang masusunod — iyon ang
  // kahon na binabago nila, hindi ang suma ng mga bahagi.
  if (items.length === 1) items[0].unitPrice = Number(input.unitPrice) || 0;
  // Optional fees — hiwalay na linya, parehong porma ng receipts/mock.
  if (Number(input.extraShipFee) > 0) items.push({ qty: 1, description: "Addtl. Shipping Fee", unitPrice: Number(input.extraShipFee), image: null });
  if (Number(input.rushFee) > 0) items.push({ qty: 1, description: "Addtl. Rush Fee", unitPrice: Number(input.rushFee), image: null });

  const res = await createQuotation({
    customerName: input.customerName.trim() || r.customer_name || "Messenger customer",
    address: input.address?.trim() || r.address || null,
    items,
    deliveryFee: Number(input.deliveryFee) || 0,
    hideQr: !!input.hideQr,
    psids: input.send && r.psid ? [r.psid] : [],
    // IISANG FQ BAWAT REQUEST (2026-08-21): marami pang pagbabago bago
    // mapagkasunduan ang build. Kapag may FQ na ang request, ito ang
    // pinapalitan ng laman — kung hindi, nadodoble ang listahan sa Formal
    // Quotation Builder tuwing pinipindot ang Create Quotation.
    reviseFq: r.fq_number,
  });
  if ("error" in res) return { error: res.error };

  // ANG BINAGO NG TEAM AY IBINABALIK SA REQUEST. Ang mga presyong tinipa sa
  // document editor ay dating napupunta lang sa quotation, kaya blangko muli
  // ang mga kahon sa susunod na pagbukas — kinakailangang ipa-type ulit ang
  // buong bagay para lang sa maliit na pagbabago. Ang bawat presyo ay katapat
  // ng bullet nito (ang unang linya ay ang pamagat, kaya naka-offset ng isa).
  const lineParts = input.lineParts ?? [];
  const bl = r.build?.lines ?? [];
  const build = lineParts.length
    ? {
        ...(r.build ?? {}),
        lines: bl.map((l, i) => {
          const p = lineParts[i + 1];
          return typeof p === "number" && p > 0 ? { ...l, price: p } : { ...l, price: undefined };
        }),
        // Sa maraming produkto, ang presyo ay pag-aari ng produkto — hindi ng
        // ugat. Ang bawat isa ay tumatanggap ng sarili nitong hiwa ng
        // lineParts, gaya ng paghahati sa itaas para sa dokumento.
        ...(r.build?.products?.length ? { products: repriceProducts(prods, lineParts, items) } : {}),
        total: Number(input.unitPrice) || 0,
        priced: true,
        ...(manual && manual.join("\n") !== groupedFromProducts(r) ? { docLines: manual, docSpans: spans } : {}),
        // Ang delivery fee ay maaaring hindi katumbas ng awtomatikong tugma sa
        // shipping rates — ang tinipa ng team ang panghuli.
        deliveryFee: Number(input.deliveryFee) || 0,
        extraShipFee: Number(input.extraShipFee) || 0,
        rushFee: Number(input.rushFee) || 0,
      }
    : r.build;

  await db
    .from("mto_requests")
    .update({
      // Sa awtomatikong paggawa, ang request ay Approved na — hindi ito
      // ibinabalik sa "Quoted"; ang FQ ay talaan lang ng napagkasunduan.
      ...(input.autoForOrder ? {} : { status: "Quoted" }),
      fq_number: res.fqNumber,
      build,
      // Ang delivery address at fee ay maaari ring binago sa modal.
      ...(input.address?.trim() ? { address: input.address.trim() } : {}),
      ...(input.customerName.trim() ? { customer_name: input.customerName.trim() } : {}),
    })
    .eq("id", r.id);
  revalidatePath("/mto-requests");
  revalidatePath("/quotations");
  return { ok: true, fqNumber: res.fqNumber, url: res.url, sent: res.sent, pdfError: res.pdfError ?? null };
}

// DRAFT SAVE — ang mga presyo/fee habang tinitipa, itinatala nang HINDI
// gumagawa o nagpapadala ng quotation. Ang paggawa ng dokumento ay may render,
// upload at Messenger send; hindi iyon dapat mangyari sa bawat keystroke.
// Dito lang ang laman ng request ang hinahawakan.
export async function saveMtoDraft(input: {
  id: number;
  customerName?: string;
  address?: string | null;
  lineParts?: (number | null)[];
  // Ang mismong teksto ng bawat linya ng dokumento — kasama ang binago,
  // idinagdag at ang natirang orihinal.
  lines?: string[];
  // Haba ng pangkat kada produkto — kasama ng lines, kung hindi ay hindi
  // maibabalik nang tama ang binago.
  spans?: number[];
  unitPrice?: number;
  deliveryFee?: number;
  extraShipFee?: number;
  rushFee?: number;
}): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };

  const db = createServerSupabase();
  const { data: row } = await db.from("mto_requests").select("*").eq("id", input.id).maybeSingle();
  if (!row) return { error: "Request not found." };
  const r = row as MtoRow;
  // Mula sa Approved, ang dokumento na ang batayan — hindi na binabago rito.
  if (r.status === "Approved" || r.status === "Ordered") return { error: "Already approved." };

  const bl = r.build?.lines ?? [];
  const parts = input.lineParts ?? [];
  // Ang draft ay parehong hati ng presyo gaya ng Create Quotation — kung hindi,
  // ang naka-save habang nagta-type ay iba sa naipapadala.
  const draftProds = mtoProducts(r);
  let dCursor = 0;
  const draftItems = draftProds.map((p) => {
    const g = groupProductLines(p);
    const slice = parts.length ? parts.slice(dCursor, dCursor + g.length) : [];
    dCursor += g.length;
    return { description: g.join("\n"), unitPrice: slice.reduce((s: number, v) => s + (Number(v) || 0), 0) };
  });
  const build = {
    ...(r.build ?? {}),
    ...(parts.length
      ? {
          lines: bl.map((l, i) => {
            const p = parts[i + 1];
            return typeof p === "number" && p > 0 ? { ...l, price: p } : { ...l, price: undefined };
          }),
          ...(r.build?.products?.length ? { products: repriceProducts(draftProds, parts, draftItems) } : {}),
          total: Number(input.unitPrice) || 0,
          priced: true,
        }
      : {}),
    // Itinatala lang kapag TALAGANG iba sa binuo mula sa products — kung
    // hindi, ang bawat pagbukas ng modal ay magpapako ng kopya ng kasalukuyang
    // porma, at hindi na masusundan ang pagbabago ng pagpapangkat.
    ...(input.lines?.length &&
    input.spans?.length === draftProds.length &&
    input.lines.length === input.spans.reduce((a, b) => a + b, 0) + (draftProds.length - 1) &&
    input.lines.join("\n") !== groupedFromProducts(r)
      ? { docLines: input.lines, docSpans: input.spans }
      : {}),
    deliveryFee: Number(input.deliveryFee) || 0,
    extraShipFee: Number(input.extraShipFee) || 0,
    rushFee: Number(input.rushFee) || 0,
  };

  const { error } = await db
    .from("mto_requests")
    .update({
      build,
      ...(input.address?.trim() ? { address: input.address.trim() } : {}),
      ...(input.customerName?.trim() ? { customer_name: input.customerName.trim() } : {}),
    })
    .eq("id", r.id);
  if (error) return { error: error.message };
  // WALANG revalidatePath: tumatakbo ito habang nagta-type, at ang muling
  // pagkarga ng buong pahina sa bawat pagtigil ay magpapalitaw ng modal.
  return { ok: true };
}

// Ang laman ng quotation ng request na ito, para mapunan ang Create Order form
// (parehong payload ng dating buton sa Formal Quotation Builder). Ang buong
// items array ay may larawan at bullets, kaya masyadong mahaba para sa URL —
// dinadaan ito sa sessionStorage ng tumatawag.
export async function quoteForOrder(id: number): Promise<
  | {
      ok: true; qid: number; fq: string; customer: string; address: string;
      items: unknown[]; deliveryFee: number;
      // Galing sa MTO request — ang quotation ay walang hawak nito, pero ang
      // Create Order form ay may kanya-kanyang field para sa mga ito.
      contact: string; psid: string | null; mto: string | null;
      // Ang address ng REQUEST (mas kumpleto kaysa sa quotation: may barangay,
      // kalye at postal) kasama ang tuldok sa mapa at ang Facebook — lahat
      // tinipa ng customer sa /quote-request, kaya walang dahilan para
      // itanong muli sa Create Order.
      requestAddress: string; lat: number | null; lng: number | null;
      fbName: string; fbLink: string;
    }
  | { error: string }
> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };
  const db = createServerSupabase();
  const { data: req } = await db
    .from("mto_requests")
    // select("*"): ang address_lat/lng at fb_* ay galing sa 0175 — kapag hindi
    // pa naitatakbo, tahimik lang silang wala imbes na magkamali ang buong
    // query at mawala ang Create Order.
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const fq = (req?.fq_number as string | null) ?? null;
  if (!fq) return { error: "This request has no quotation yet." };

  const { data: q } = await db
    .from("quotations")
    .select("id, fq_number, customer_name, address, items, delivery_fee, order_number")
    .eq("fq_number", fq)
    .maybeSingle();
  if (!q) return { error: `${fq} was not found.` };
  if (q.order_number) return { error: `${fq} already has order ${q.order_number}.` };

  return {
    ok: true,
    qid: q.id as number,
    fq: (q.fq_number as string) ?? fq,
    customer: (q.customer_name as string) ?? "",
    address: (q.address as string | null) ?? "",
    items: (q.items as unknown[]) ?? [],
    deliveryFee: Number(q.delivery_fee) || 0,
    contact: (req?.contact as string | null) ?? "",
    // Ang PSID ang nagbubukas ng Messenger thread para sa order/PAID updates —
    // kilala na natin ito mula sa request, kaya hindi na hahanapin muli.
    psid: (req?.psid as string | null) ?? null,
    // Ang address ng quotation ay ang naipadalang dokumento; ang sa request
    // ang may buong detalye (barangay, kalye, postal, landmark).
    requestAddress: (req?.address as string | null) ?? "",
    lat: Number.isFinite(req?.address_lat) ? Number(req?.address_lat) : null,
    lng: Number.isFinite(req?.address_lng) ? Number(req?.address_lng) : null,
    fbName: (req?.fb_name as string | null) ?? "",
    fbLink: (req?.fb_link as string | null) ?? "",
    mto: (req?.mto_number as string | null) ?? null,
  };
}

// Manu-manong itinatakda ng team ang status. Ang "Approved" ang nagsasara ng
// request: mula doon, sa Formal Quotation Builder na ito hinahawakan, kaya
// hindi na pwedeng gumawa ng panibagong quotation dito.
export type MtoStatus = "New" | "Quoted" | "Approved" | "Ordered";

export async function setMtoStatus(id: number, status: MtoStatus): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };
  const db = createServerSupabase();
  const { error } = await db.from("mto_requests").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/mto-requests");
  // Ang Approved ang naglalabas ng quotation sa Formal Quotation Builder, kaya
  // luma na rin ang naka-cache na listahan doon.
  revalidatePath("/quotations");
  return { ok: true };
}

// ── PAGDAGDAG SA ORDER NA MAYROON NA (2026-08-22) ───────────────────────────
// Ang customer na may bukas na order ay madalas humihingi ng dagdag. Ang gusto
// ng team ay iisang order number — kaya ang approved na request na ito ay
// pumapasok sa lumang order imbes na gumawa ng bago.

export type AddPlan = {
  request: {
    mto: string | null;
    // Blangko kapag wala pang quotation — hindi iyon hadlang; tingnan sa ibaba.
    fq: string;
    customer: string; contact: string; psid: string | null; address: string;
    amount: number; itemCount: number;
    // Nagmula ba ang presyo sa website (walang FQ) o sa naaprubahang
    // quotation? Ipinapakita ito sa sheet — magkaibang antas ng katiyakan.
    pricedBy: "quotation" | "website";
  };
  // Mga bukas na order ng customer na ito, kasama kung paano natugma.
  candidates: import("@/app/orders/actions").OpenOrder[];
};

// Ang laman ng confirm sheet: ang hinihiling, at ang mga order na maaaring
// pagdagdagan. NAGPAPAKITA LANG — walang naisusulat dito.
//
// GUMAGANA KAHIT WALANG QUOTATION (2026-08-22). Ang website ay nagpapadala na
// ng presyo kada linya at kabuuan kada produkto, kaya alam na natin ang halaga
// bago pa may FQ. Ang pagpilit ng quotation bago makapagdagdag sa order ay
// nagpapagawa ng dokumentong hindi naman kailangan — ang customer ay may
// order na, hindi na siya nagdedesisyon kung tatanggapin ba ang presyo.
export async function planAddToOrder(id: number): Promise<AddPlan | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };

  const db = createServerSupabase();
  const { data: row } = await db.from("mto_requests").select("*").eq("id", id).maybeSingle();
  if (!row) return { error: "Request not found." };
  const r = row as MtoRow;
  if (r.order_number) return { error: `${r.mto_number ?? "This request"} is already on order ${r.order_number}.` };

  // May quotation? Iyon ang masusunod — doon nakatala ang napagkasunduang
  // presyo. Kung wala, ang laman ng request mismo ang ginagamit.
  const q = r.fq_number ? await quoteForOrder(id) : null;
  const useQuote = q !== null && !("error" in q);

  const { findOpenOrders } = await import("@/app/orders/actions");
  const customer = useQuote ? q.customer : (r.customer_name ?? "");
  const contact = useQuote ? q.contact : (r.contact ?? "");
  const psid = useQuote ? q.psid : r.psid;
  const candidates = await findOpenOrders({ psid, contact, name: customer });

  const items = useQuote
    ? ((q.items ?? []) as { qty?: number; unitPrice?: number }[])
    : mtoProducts(r).map((p) => ({ qty: 1, unitPrice: Number(p.build?.total) || 0 }));
  // Ang halaga ng hinihiling: ang mga item ng quotation kasama ang delivery fee
  // nito. Ang bagong delivery fee ay pag-uusapan ng team — ang order ay may
  // isang biyahe lang, kaya hindi ito basta dinodoble.
  const amount = items.reduce((s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.qty) || 1), 0);

  return {
    request: {
      mto: r.mto_number,
      fq: useQuote ? q.fq : "",
      pricedBy: useQuote ? "quotation" : "website",
      customer,
      contact,
      psid,
      address: useQuote ? q.address : (r.address ?? ""),
      amount,
      itemCount: items.length,
    },
    candidates,
  };
}

// Isagawa: ipinapasok ang mga item ng quotation sa napiling order, tapos
// minamarkahan ang request na Ordered at itinatali ang FQ sa order number —
// kapareho ng ginagawa ng Create Order, para tuloy-tuloy ang MTO # → FQ # → Order #.
export async function addRequestToOrder(input: {
  id: number;
  orderId: number;
  confirmed: boolean;
  deliveryDate?: string | null;
}): Promise<{ ok: true; orderNumber: string | null; total: number; balance: number } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };

  const db = createServerSupabase();
  const { data: row } = await db.from("mto_requests").select("*").eq("id", input.id).maybeSingle();
  if (!row) return { error: "Request not found." };
  const r = row as MtoRow;
  if (r.order_number) return { error: `${r.mto_number ?? "This request"} is already on order ${r.order_number}.` };

  // BAWAT LINYA NG ORDER AY MAY QUOTATION. Kapag walang FQ pa ang request,
  // ginagawa ito ngayon mula sa presyong ipinadala ng website — hindi
  // itinatanong sa team, dahil hindi naman sila magdedesisyon: ang customer ay
  // may order na. Kung walang FQ, may linya sa order na walang maipapakitang
  // pinagkasunduan, at doon nagagapi ang buong dahilan ng paghihiwalay ng
  // Quotation at Quotation Summary.
  if (!r.fq_number) {
    const auto = await createQuotationFromMto({
      id: input.id,
      customerName: r.customer_name ?? "",
      address: r.address ?? null,
      unitPrice: mtoProducts(r).reduce((s, p) => s + (Number(p.build?.total) || 0), 0),
      // Ang delivery ay binabayaran nang isang beses sa buong order, at may
      // sarili nang linya doon — hindi ito inuulit kada dagdag.
      deliveryFee: 0,
      // Hindi ipinapadala sa Messenger: ito ay talaan, hindi alok. Ang
      // ipapadala sa customer ay ang Quotation Summary ng buong order.
      send: false,
      autoForOrder: true,
    });
    if ("error" in auto) return { error: auto.error };
    // Basahing muli — may fq_number na ang row ngayon.
    const { data: again } = await db.from("mto_requests").select("*").eq("id", input.id).maybeSingle();
    if (again) Object.assign(r, again as MtoRow);
  }

  const q = r.fq_number ? await quoteForOrder(input.id) : null;
  const useQuote = q !== null && !("error" in q);

  const items = useQuote
    ? ((q.items ?? []) as { qty?: number; description?: string; unitPrice?: number; image?: string | null }[])
    : productDocLines(r).map(({ p, lines }) => ({
        qty: 1,
        // Parehong pangkat na ginagamit ng quotation at ng Messenger echo,
        // kaya pareho ang mababasa saanman ito lumabas. At kapag inayos ng
        // team ang teksto sa editor, IYON ang pumapasok sa order — kung hindi,
        // iba ang resibo sa quotation na naipadala na sa customer.
        description: lines.join("\n"),
        unitPrice: Number(p.build?.total) || 0,
        image: p.image ?? null,
      }));
  // Walang presyo = libre ang idadagdag, at tahimik iyon. Mas mabuting
  // huminto kaysa magpalaki ng order nang walang naidagdag sa balanse.
  if (!items.some((it) => (Number(it.unitPrice) || 0) > 0)) {
    return { error: "This request has no price yet — set it in the quotation first." };
  }

  const { addItemsToOrder } = await import("@/app/orders/actions");
  const res = await addItemsToOrder({
    orderId: input.orderId,
    items: items.map((it) => ({
      qty: Number(it.qty) || 1,
      description: String(it.description ?? ""),
      unitPrice: Number(it.unitPrice) || 0,
      image: it.image ?? null,
    })),
    sourceMto: r.mto_number,
    sourceFq: useQuote ? q.fq : null,
    deliveryDate: input.deliveryDate ?? null,
    confirmed: input.confirmed,
  });
  if ("error" in res) return res;

  // Ang daanan ay natapos: ang request ay naging bahagi na ng isang order.
  // Ang quotation ay tinatalian din, kaya hindi na ito magagamit muli para
  // gumawa ng pangalawang order mula sa parehong FQ.
  try {
    await db.from("mto_requests").update({ order_number: res.orderNumber, status: "Ordered" }).eq("id", input.id);
    if (useQuote) await db.from("quotations").update({ order_number: res.orderNumber, updated_at: new Date().toISOString() }).eq("id", q.qid);
  } catch { /* ang pagdagdag ay natapos na — hindi ito binabawi ng kawing */ }

  revalidatePath("/mto-requests");
  revalidatePath("/quotations");
  revalidatePath("/orders");
  return res;
}

// ── "+ ADD ITEM" SA FORMAL QUOTATION EDITOR (Joe 2026-09-06) ─────────────────
// Dagdag na produkto mula sa catalog sa isang MTO request — parehong product
// browser ng Create Order, at ang napili ay awtomatikong nakamapa sa isang
// pangkat ng dokumento (pangalan, spec bullets, base price sa unang linya),
// na maaari pa ring baguhin ng team gaya ng ibang linya. Naka-imbak sa
// build.products para pareho ang hati ng draft, ng ipinapadalang dokumento at
// ng Create Order. Kapag may manu-manong docLines na, idinadagdag ang bagong
// pangkat doon para hindi mawala ang mga naunang pag-edit.
export async function addMtoProduct(
  id: number,
  p: { sku?: string | null; name: string; category?: string | null; image?: string | null; price: number; specLines: string[]; blank?: boolean },
): Promise<{ ok: true; build: MtoRow["build"] } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };
  const db = createServerSupabase();
  const { data: row } = await db.from("mto_requests").select("*").eq("id", id).maybeSingle();
  if (!row) return { error: "Request not found." };
  const r = row as MtoRow;
  if (r.status === "Approved" || r.status === "Ordered") return { error: "Already approved." };

  const name = String(p.name ?? "").trim();
  if (!name) return { error: "Pick a product first." };
  const specs = (p.specLines ?? []).map((l) => String(l).replace(/^[•·-]\s*/, "").trim()).filter(Boolean);
  const price = Math.max(Number(p.price) || 0, 0);
  // Ang base price ay nasa UNANG spec line (kung wala, isang "Base price" na linya).
  // Blangkong row ("+ Add row"): isang blangkong linya lang, walang "Base price".
  const lines = p.blank ? [{ label: "" }] : (specs.length ? specs : ["Base price"]).map((label, i) => (i === 0 && price > 0 ? { label, price } : { label }));
  const added: import("@/lib/build-lines").MtoProduct = {
    sku: p.sku ?? null,
    slug: null,
    name,
    category: p.category ?? null,
    image: p.image ?? null,
    build: { lines, total: price, priced: price > 0 },
  };
  const products = [...mtoProducts(r), added];
  const build: MtoRow["build"] = { ...(r.build ?? {}), products };
  // May manu-manong dokumento na: idagdag ang bagong pangkat (may separator).
  if (r.build?.docLines?.length && r.build?.docSpans?.length === products.length - 1) {
    const g = groupProductLines(added);
    build.docLines = [...r.build.docLines, "", ...g];
    build.docSpans = [...r.build.docSpans, g.length];
  }
  const { error } = await db.from("mto_requests").update({ build }).eq("id", r.id);
  if (error) return { error: error.message };
  revalidatePath("/mto-requests");
  return { ok: true, build };
}

// ── DELETE NG ISANG PRODUKTO SA EDITOR (Joe 2026-09-06) ───────────────────────
// Tinatanggal ang pangkat sa build.products at, kapag may manu-manong
// docLines, ang mga linya nito (kasama ang separator). Hindi maaalis ang
// huling produkto — walang quotation na walang laman.
export async function removeMtoProduct(id: number, index: number): Promise<{ ok: true; build: MtoRow["build"] } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };
  const db = createServerSupabase();
  const { data: row } = await db.from("mto_requests").select("*").eq("id", id).maybeSingle();
  if (!row) return { error: "Request not found." };
  const r = row as MtoRow;
  if (r.status === "Approved" || r.status === "Ordered") return { error: "Already approved." };
  const products = [...mtoProducts(r)];
  if (index < 0 || index >= products.length) return { error: "No such product." };
  if (products.length <= 1) return { error: "A quotation needs at least one product." };
  products.splice(index, 1);
  const build: MtoRow["build"] = { ...(r.build ?? {}), products };
  const dl = r.build?.docLines, ds = r.build?.docSpans;
  if (dl?.length && ds?.length === products.length + 1) {
    // Alisin ang linya ng pangkat at ang separator na kasama nito.
    let at = 0;
    for (let pi = 0; pi < index; pi++) at += ds[pi] + 1;
    const n = ds[index];
    const from = index === 0 ? at : at - 1;           // kasama ang separator BAGO ito (o pagkatapos, kapag una)
    const to = index === 0 ? at + n + 1 : at + n;
    build.docLines = [...dl.slice(0, from), ...dl.slice(Math.min(to, dl.length))];
    build.docSpans = ds.filter((_, i) => i !== index);
  } else if (dl?.length) {
    // Hindi tugma ang imbak — hayaang muling buuin mula sa products.
    delete build.docLines; delete build.docSpans;
  }
  const { error } = await db.from("mto_requests").update({ build }).eq("id", r.id);
  if (error) return { error: error.message };
  revalidatePath("/mto-requests");
  return { ok: true, build };
}
