"use server";

// DELIVERY QUEUE actions — Ops ang nagtatakda ng date + team per group, tapos
// sabay-sabay na confirmation emails (Confirm button LANG — walang reschedule;
// ang reschedule ay sa 2-days-before reminder na hiwalay na phase). Ang public
// Confirm ay nasa /delivery-confirm/[token].

import { randomUUID } from "crypto";
import { emailShell, panel, sectionTitle, intro, kvTable, mono, itemList, totalsTable, dateBanner, ctaButton, whatsNext, esc, peso as pesoHtml, type KvRow, TAG_DELIVERED, TAG_THIS, TAG_NEXT, type EmailItem, type TotalRow } from "@/lib/email/layout";
import { emailItemsFromLines, productLinesOf, reworkItemsOnly, reworkItemDescByOrder } from "@/lib/email/items";
import { gmailParcelSchema } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/send";
import { preheader } from "@/lib/email/layout";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadSkipRows } from "@/lib/ops/skips";
import { lineKey, joinKey, colorOfDesc, hasKey } from "@/lib/orders/line-key";
import { requireAnyEdit } from "@/lib/auth/guard";
import { auditAfter } from "@/lib/audit";

const peso = (n: number) => `₱${(Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
// Base ng mga customer-facing link sa emails — ang WEBSITE (panfurniture.ph)
// ang hino-host ng confirm/reschedule pages para hindi lantad ang IMS domain.
const linkBase = () => (process.env.NEXT_PUBLIC_STORE_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

// Buod ng items ng order para sa "Item" row — unang linya ng bawat produkto
// (hindi kasama ang Shipping Fee), pinagdudugtong; may "+N more" pag marami.
// PARTIAL DELIVERY (0200). Ang batch ay ang mga HANDA nang linya; ang hindi pa
// ay susunod na batch; ang naihatid na sa nauna ay may tag na Delivered sa
// email. Ang singil sa batch (pasya ni Joe 2026-08-26): buong delivery fee sa
// UNANG batch + presyo ng mga produktong sakay, bawas ang naibayad na.
type BatchLine = { key: string; name: string; qty: number; total: number };
type BatchInfo = {
  batch: BatchLine[]; next: BatchLine[]; delivered: BatchLine[];
  fees: number; batchDue: number; remainingAfter: number; isPartial: boolean;
};
// Item cards ng email, may tag kada item ayon sa batch: DELIVERED (nauna),
// THIS DELIVERY (sakay), NEXT DELIVERY (susunod, kupas).
async function emailCardsFor(
  db: ReturnType<typeof createServerSupabase>,
  o: { receipt_items: unknown },
  bi: BatchInfo | null,
): Promise<EmailItem[]> {
  const lines = productLinesOf((Array.isArray(o.receipt_items) ? o.receipt_items : []) as never[]);
  const cards = await emailItemsFromLines(db, lines);
  if (!bi || !bi.isPartial) return cards;
  // KASAMA ANG KULAY (2026-09-06): ang card at ang BatchLine ay parehong may
  // "pangalan @ kulay" na susi mula sa iisang receipt line.
  const inSet = (list: { key: string }[], c: EmailItem) => { const k = c.lineKey ?? lineKey(c.name); return list.some((l) => l.key === k); };
  return cards.map((c) => {
    if (inSet(bi.delivered, c)) return { ...c, tag: TAG_DELIVERED };
    if (inSet(bi.batch, c)) return { ...c, tag: TAG_THIS };
    if (inSet(bi.next, c)) return { ...c, tag: TAG_NEXT, dimmed: true };
    return c;
  });
}

async function batchInfoFor(
  db: ReturnType<typeof createServerSupabase>,
  orders: { id: number; receipt_items: unknown; full_payment_price: number | null; downpayment_price: number | null; full_payment: number | null }[],
): Promise<Map<number, BatchInfo>> {
  const ids = orders.map((o) => o.id);
  const fl = (t: unknown) => String(t ?? "").split("\n")[0].trim().toLowerCase();
  const isFee = (d: string) => /^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test(d);
  const [{ data: jobs }, skipsAll] = await Promise.all([
    db.from("workshop_job").select("order_id, item_desc, status, fulfillment, qc_received_at").in("order_id", ids),
    loadSkipRows(db),
  ]);
  const skips = skipsAll.filter((x) => ids.includes(x.order_id));
  const jobReady = new Map<string, boolean>();
  for (const j of (jobs ?? []) as { order_id: number | null; item_desc: string | null; status: string | null; fulfillment: string | null; qc_received_at: string | null }[]) {
    if (j.order_id == null) continue;
    // Kapareho ng Delivery Queue (2026-08-28): pagkatapos ng QC, ang rework job
    // ang tanging patunay na handa ang linya — walang ibang darating. Kung
    // lalaktawan, ang REDELIVERY ay lumalabas na "0 of 1 ready" sa email.
    let n = fl(j.item_desc);
    if (/^rework/i.test(n)) {
      if (!/qc passed/i.test(j.status ?? "")) continue;
      n = n.replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "").trim();
    }
    if (!n) continue;
    const ready = j.fulfillment === "pickup" ? /qc passed/i.test(j.status ?? "") : (!!j.qc_received_at || /received/i.test(j.status ?? ""));
    // KASAMA ANG KULAY (2026-09-06, lib/orders/line-key): job/skip ng isang kulay
    // ay hindi nagpapahanda sa ibang kulay ng parehong produkto.
    const k = `${j.order_id}|${joinKey(n, colorOfDesc(j.item_desc))}`;
    jobReady.set(k, (jobReady.get(k) ?? false) || ready);
  }
  const jobReadyKeys = new Set([...jobReady].filter(([, r]) => r).map(([k]) => k));
  const skipped = new Set(skips.map((x) => `${x.order_id}|${lineKey(x.item_desc, x.color)}`));
  const deliveredBy = new Map<number, Set<string>>();
  try {
    const { data: old } = await db.from("order_line_deliveries").select("order_id, item_desc").in("order_id", ids);
    for (const r of (old ?? []) as { order_id: number; item_desc: string | null }[]) {
      const k = lineKey(r.item_desc);
      if (k) (deliveredBy.get(r.order_id) ?? deliveredBy.set(r.order_id, new Set()).get(r.order_id)!).add(k);
    }
  } catch { /* wala pang 0200 */ }

  const out = new Map<number, BatchInfo>();
  for (const o of orders) {
    const items = (Array.isArray(o.receipt_items) ? o.receipt_items : []) as { description?: string | null; qty?: number; unitPrice?: number; constructorName?: string | null; color?: string | null }[];
    const done = deliveredBy.get(o.id);
    const batch: BatchLine[] = [], next: BatchLine[] = [], delivered: BatchLine[] = [];
    let fees = 0;
    for (const it of items) {
      const name = fl(it.description);
      if (!name) continue;
      const qty = Number(it.qty) || 1;
      const total = Math.round((Number(it.unitPrice) || 0) * qty * 100) / 100;
      if (isFee(name)) { fees += total; continue; }
      const disp = String(it.description ?? "").split("\n")[0].trim();
      const lk = lineKey(it.description, it.color);
      const line: BatchLine = { key: lk, name: disp, qty, total };
      if (it.constructorName) { batch.push(line); continue; } // constructor flow: kasama sa unang batch
      if (hasKey(done, lk)) { delivered.push(line); continue; }
      const pfx = `${o.id}|`;
      if (hasKey(jobReadyKeys, lk, pfx) || hasKey(skipped, lk, pfx)) batch.push(line);
      else next.push(line);
    }
    const paid = (Number(o.downpayment_price) || 0) + (Number(o.full_payment) || 0);
    const orderTotal = Number(o.full_payment_price) || 0;
    // Ang fee ay minsanang singil — sa UNANG batch (walang naihatid pa).
    const feeNow = delivered.length ? 0 : fees;
    // KUMULATIBO ang singil (2026-09-02): lahat ng nasingil na dapat hanggang sa
    // biyaheng ito (naihatid na + batch na ito + fee) - lahat ng bayad. Kapag
    // per-batch lang ang items na ibinabawas sa KABUUANG bayad, ang huling batch
    // ay laging ₱0 at napupunta sa "remaining balance" ang tunay na COD.
    // Batch 1: items + fee - DP. Huling batch: eksaktong natitirang balanse.
    const deliveredTotal = delivered.reduce((t, l) => t + l.total, 0);
    const batchDue = Math.max(Math.round((fees + deliveredTotal + batch.reduce((t, l) => t + l.total, 0) - Math.max(paid, 0)) * 100) / 100, 0);
    const remainingAfter = Math.max(Math.round((orderTotal - paid - batchDue) * 100) / 100, 0);
    out.set(o.id, { batch, next, delivered, fees, batchDue, remainingAfter, isPartial: next.length > 0 || delivered.length > 0 });
  }
  return out;
}

function itemsSummary(items: unknown): string {
  if (!Array.isArray(items)) return "—";
  const lines = (items as { description?: string; qty?: number; color?: string | null; dimension?: string | null }[])
    .filter((it) => !/^shipping\b/i.test(String(it?.description ?? "").trim()))
    .map((it) => {
      const first = String(it.description ?? "").split("\n")[0].trim();
      const extras = [it.color, it.dimension].filter(Boolean).join(" · ");
      return `${first}${extras ? ` · ${extras}` : ""}`;
    })
    .filter(Boolean);
  if (!lines.length) return "—";
  return lines.length > 2 ? `${lines.slice(0, 2).join(", ")} +${lines.length - 2} more` : lines.join(", ");
}

// FIRST confirmation email — mirror ng approved artifact design (Initial
// Notice): preheader strip, centered PAN seal + wordmark, "Good news" heading,
// RMA LEDGER override para sa mga REWORK redelivery email: ang natitirang rework
// due (charge − nabayad) ang tunay na Balance — ang orders ledger ay ₱0 na doon
// (nakapaloob na sa rework charge ang dating order balance). Newest return first.
async function reworkDueByOrder(db: ReturnType<typeof createServerSupabase>, orderIds: number[]): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  if (!orderIds.length) return m;
  // `id desc`, HINDI `created_at` (2026-08-29) — kapareho ng reworkMailFor.
  // Ang ORD-000010 ay may dalawang RMA: ang RMA-000002 (₱8,500 singil, ₱8,500
  // bayad — tapos na) at ang RMA-000004 (₱10,000, walang bayad — ito ang
  // ibinabalik). Nang magkaiba ang pagkakasunod ng dalawang lookup, magkaibang
  // RMA ang nakukuha nila sa iisang order.
  const { data } = await db.from("returns")
    .select("id, order_id, status, rework_charge_total, rework_downpayment")
    .in("order_id", orderIds).eq("resolution", "rework")
    .order("id", { ascending: false });
  for (const r of (data ?? []) as { order_id: number | null; status: string | null; rework_charge_total: number | null; rework_downpayment: number | null }[]) {
    if (r.order_id == null || /reject|pending/i.test(r.status ?? "")) continue;
    const charge = Number(r.rework_charge_total) || 0;
    // WALANG `charge > 0` NA HARANG. Ang RMA na bayad na ay may singil pa rin,
    // kaya nakakalusot ito — at ang ₱0 nitong balanse ang naging COD ng isang
    // redelivery na may ₱10,000 pa. Ang UNANG RMA sa pagkakasunod ang hawak ng
    // biyahe; iyon ang sagot, singil man o wala.
    if (!m.has(r.order_id))
      m.set(r.order_id, charge > 0 ? Math.max(Math.round((charge - (Number(r.rework_downpayment) || 0)) * 100) / 100, 0) : 0);
  }
  return m;
}

// date banner, 1-2-3 progress steps, details table na may Item, ISANG green
// Confirm button (walang reschedule dito), questions block, dark footer with
// unique-ref note. Email-safe: pure tables + inline styles, Georgia + Arial.
// DELIVERY CONFIRMATION — Shopee-style na hulma (lib/email/layout). Ang
// partial batch ay may tag kada item at singil ng batch lang.
// ── REDELIVERY NG NAAYOS (hiling 2026-08-28) ────────────────────────────────
// Ang normal na confirmation ay tungkol sa BAGONG order: "completed crafting",
// listahan ng lahat ng item, batch tags, at ang balanse ng orders ledger. Wala
// ni isa doon ang totoo sa isang rework redelivery — iisang gamit ang ibinabalik,
// naayos hindi ginawa, at ang utang ay nasa RMA (₱0 na ang orders ledger doon).
//
// Kaya sariling email: kaparehong hugis (petsa, Confirm button, COD) pero laman
// ng RMA — ang numero, ang inayos na gamit, ang ipinalit na piyesa, at ang
// TUNAY na balanse ng RMA.
type ReworkMail = {
  rmaNo: string; itemDesc: string | null; itemImage: string | null; itemSku: string | null;
  parts: { part: string; qty: number; amount: number }[];
  partsTotal: number; deliveryPrice: number; chargeTotal: number; paid: number; balance: number;
};

async function reworkMailFor(
  db: ReturnType<typeof createServerSupabase>,
  orderIds: number[],
): Promise<Map<number, ReworkMail>> {
  const out = new Map<number, ReworkMail>();
  if (!orderIds.length) return out;
  try {
    // Ang PINAKABAGONG rework ng order ang siyang ibinabalik ngayon.
    const { data } = await db.from("returns")
      .select("order_id, return_no, item_desc, item_image, sku, rework_parts, rework_parts_total, rework_delivery_price, rework_charge_total, rework_downpayment, reworked_at")
      .eq("resolution", "rework").in("order_id", orderIds)
      .order("id", { ascending: false }).limit(2000);
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const oid = Number(r.order_id);
      if (!Number.isFinite(oid) || out.has(oid)) continue;   // newest wins
      // Ang hindi pa naaayos ay walang ibabalik.
      if (!r.reworked_at) continue;
      const parts = Array.isArray(r.rework_parts)
        ? (r.rework_parts as { part?: unknown; qty?: unknown; amount?: unknown }[])
            .map((x) => ({ part: String(x?.part ?? "").trim(), qty: Number(x?.qty) || 1, amount: Number(x?.amount) || 0 }))
            .filter((x) => x.part)
        : [];
      const charge = Number(r.rework_charge_total) || 0;
      const paid = Number(r.rework_downpayment) || 0;
      out.set(oid, {
        rmaNo: String(r.return_no ?? ""),
        itemDesc: (r.item_desc as string | null) ?? null,
        itemImage: (r.item_image as string | null) ?? null,
        itemSku: (r.sku as string | null) ?? null,
        parts,
        partsTotal: Math.round((Number(r.rework_parts_total) || parts.reduce((t, x) => t + x.amount, 0)) * 100) / 100,
        deliveryPrice: Number(r.rework_delivery_price) || 0,
        chargeTotal: charge, paid,
        balance: Math.max(Math.round((charge - paid) * 100) / 100, 0),
      });
    }
  } catch { /* best-effort — babagsak sa normal na email */ }
  return out;
}

function reworkConfirmEmailHtml(
  o: { customer_name: string | null; order_number: string | null; address: string | null },
  rw: ReworkMail,
  allItems: EmailItem[],
  dateISO: string,
  confirmUrl: string,
): string {
  const items = reworkItemsOnly(allItems, rw.itemDesc);
  const totals: TotalRow[] = [
    ...(rw.partsTotal > 0 ? [{ label: "Replacement parts", amount: rw.partsTotal } as TotalRow] : []),
    ...(rw.deliveryPrice > 0 ? [{ label: "Redelivery", amount: rw.deliveryPrice } as TotalRow] : []),
    ...(rw.paid > 0 ? [{ label: "Less: Payments received", amount: rw.paid, tone: "green" } as TotalRow] : []),
    { label: "Amount due on this delivery (COD)", amount: rw.balance, big: true },
  ];
  const partsRows: KvRow[] = rw.parts.map((pt) => [
    `${pt.qty > 1 ? `${pt.qty}× ` : ""}${esc(pt.part)}`,
    pesoHtml(pt.amount),
  ]);
  return gmailParcelSchema({
    orderNumber: o.order_number ?? "",
    status: "OrderInTransit",
    expectedArrivalISO: dateISO,
    trackUrl: confirmUrl,
    customerName: o.customer_name,
    address: o.address,
    items: items.map((it) => ({ name: it.name, image: typeof it.photoUrl === "string" && /^https?:/.test(it.photoUrl) ? it.photoUrl : null })),
  }) + emailShell(
    panel(`
      ${intro(o.customer_name, `Your repaired item under ${mono(rw.rmaNo)} has passed our quality inspection and is ready to come home. We have reserved the redelivery date below — please confirm to secure your slot.`)}
      ${dateBanner("Scheduled Redelivery", dateISO)}`, { pad: "26px 36px 20px" })
    + panel(`
      ${sectionTitle("Repair Details")}
      ${kvTable([
        ["RMA Number", mono(rw.rmaNo)],
        ["Order ID", mono(o.order_number)],
        ...(rw.itemSku ? [["SKU", mono(rw.itemSku)] as KvRow] : []),
      ])}
      ${itemList(items)}`)
    + (partsRows.length
        ? panel(`
      ${sectionTitle("Parts Replaced")}
      ${kvTable(partsRows)}`)
        : "")
    + panel(totalsTable(totals), { pad: "14px 36px 8px" })
    + panel(`
      ${sectionTitle("Delivery Details")}
      ${kvTable([["Recipient Name", `<b>${esc(o.customer_name ?? "—")}</b>`], ["Delivery Address", esc(o.address ?? "—")]])}`)
    + panel(ctaButton("Confirm Redelivery Date", confirmUrl, "Need a different date? Reply to this email or message us on Facebook."), { pad: "8px 36px 24px" })
    + whatsNext(rw.balance > 0
        ? `Kindly have <b style="color:#2b2620">${peso(rw.balance)} cash ready</b> upon redelivery. Our team will call you when the truck is on the way.`
        : "Nothing left to pay — this repair is fully settled. Our team will call you when the truck is on the way."),
  );
}

function confirmEmailHtml(o: {
  customer_name: string | null; order_number: string | null; address: string | null;
  balance: number; items: EmailItem[]; batch?: BatchInfo | null;
  subtotalThis: number; feeNow: number; paid: number;
}, dateISO: string, confirmUrl: string): string {
  const bi = o.batch ?? null;
  const totalItems = o.items.length;
  const thisCount = bi ? bi.batch.length : totalItems;
  const introLine = bi
    ? `Your order ${mono(o.order_number)} is ready for a <span style="background:#faf1dc;padding:1px 6px;border-radius:4px;font-weight:bold;color:#8a6a1f">partial delivery</span> — ${thisCount} of ${totalItems} item${totalItems === 1 ? "" : "s"} are finished and reserved for the date below. Please confirm to secure your slot.`
    : `Your order ${mono(o.order_number)} has completed crafting and passed our quality inspection. We have reserved the delivery date below — please confirm to secure your slot.`;
  // Ang "Less: Payments received" ay ang bayad na HINDI PA nagagamit ng mga
  // naunang biyahe (doon na-ubos ang DP at ang koleksyon ng batch 1) — kung ang
  // buong bayad ang ibabawas, hindi magtutugma ang aritmetika ng talaan at ang
  // huling biyahe ay magpapakitang ₱0 COD na may hiwalay na "remaining balance".
  const paidEarlier = bi && bi.delivered.length
    ? Math.min(o.paid, Math.round((bi.fees + bi.delivered.reduce((t, l) => t + l.total, 0)) * 100) / 100)
    : 0;
  const paidShown = Math.max(Math.round((o.paid - paidEarlier) * 100) / 100, 0);
  const totals: TotalRow[] = [
    { label: `Items on this delivery (${thisCount})`, amount: o.subtotalThis },
    ...(o.feeNow > 0 ? [{ label: "Delivery Fee", amount: o.feeNow, note: bi ? "one-time, charged on this trip" : undefined } as TotalRow] : []),
    ...(paidShown > 0 ? [{ label: "Less: Payments received", amount: paidShown, tone: "green" } as TotalRow] : []),
    { label: "Amount due on this delivery (COD)", amount: o.balance, big: true },
    ...(bi && bi.remainingAfter > 0 ? [{ label: "Remaining balance — due on the final delivery", amount: bi.remainingAfter, tone: "muted" } as TotalRow] : []),
  ];
  // GMAIL SUMMARY CARD: inaasahang pagdating + View na aksyon.
  return gmailParcelSchema({
    orderNumber: o.order_number ?? "",
    status: "OrderInTransit",
    expectedArrivalISO: dateISO,
    trackUrl: confirmUrl,
    customerName: o.customer_name,
    address: o.address,
    items: o.items.map((it) => ({ name: it.name, image: typeof it.photoUrl === "string" && /^https?:/.test(it.photoUrl) ? it.photoUrl : null })),
  }) + emailShell(
    panel(`
      ${intro(o.customer_name, introLine)}
      ${dateBanner("Scheduled Delivery", dateISO)}`, { pad: "26px 36px 20px" })
    + panel(`
      ${sectionTitle("Order Details")}
      ${kvTable([["Order ID", mono(o.order_number)], ["Items", `<b>${totalItems} total${bi ? ` · ${thisCount} on this delivery` : ""}</b>`]])}
      ${itemList(o.items)}`)
    + panel(totalsTable(totals), { pad: "14px 36px 8px" })
    + panel(`
      ${sectionTitle("Delivery Details")}
      ${kvTable([["Recipient Name", `<b>${esc(o.customer_name ?? "—")}</b>`], ["Delivery Address", esc(o.address ?? "—")]])}`)
    + panel(ctaButton("Confirm Delivery Date", confirmUrl, "Need a different date? Reply to this email or message us on Facebook."), { pad: "8px 36px 24px" })
    + whatsNext(`Kindly have <b style="color:#2b2620">${peso(o.balance)} cash ready</b> upon delivery. Our team will call you when the truck is on the way.${bi && bi.next.length ? ` The remaining ${bi.next.length} item${bi.next.length === 1 ? " is" : "s are"} still in crafting — we will send a separate confirmation once they are ready for the final delivery.` : ""}`)
  );
}

// FOLLOW-UP — hindi pa nakukumpirma; parehong hulma, mas maigsi ang laman.
// `rma` — kapag REDELIVERY ito ng naayos (2026-08-28). Ang paalala ay nagsasabi
// noong "your order is ready", pero ang gamit ay matagal nang binili at
// naihatid: ito ay kinumpuni at iniuuwi. Ang salita ang pinapalitan, hindi ang
// hugis — iisang paalala pa rin ang pinapadala.
function followupEmailHtml(o: { customer_name: string | null; order_number: string | null; balance: number; item: string; followups: number; rma?: string | null; items?: EmailItem[] }, dateISO: string, confirmUrl: string): string {
  const nth = o.followups >= 2 ? "final reminder" : "friendly reminder";
  const rw = !!o.rma;
  return emailShell(
    panel(`
      ${intro(o.customer_name, rw
        ? `A ${nth}: your repaired item under ${mono(o.rma ?? "")} is ready to come home, and its redelivery slot on the date below is still waiting for your confirmation.`
        : `A ${nth}: your order ${mono(o.order_number)} is ready and its delivery slot on the date below is still waiting for your confirmation.`)}
      ${dateBanner(rw ? "Reserved Redelivery Date" : "Reserved Delivery Date", dateISO)}`, { pad: "26px 36px 20px" })
    + panel(`
      ${sectionTitle(rw ? "Repair Details" : "Order Details")}
      ${kvTable([
        ...(rw ? [["RMA Number", mono(o.rma ?? "")] as KvRow] : []),
        ["Order ID", mono(o.order_number)],
        ...(o.balance > 0 ? [[rw ? "Balance due on redelivery (COD)" : "Balance due on delivery (COD)", `<b>${pesoHtml(o.balance)}</b>`] as KvRow] : []),
      ])}
      ${/* ANG BUONG ITEM CARD (hiling 2026-08-28): pangalan, litrato at bawat
            spec — hindi isang pinagdugtong na linya. Ito ang tinitingnan ng
            customer para malamang tama ang darating. */ ""}
      ${o.items?.length ? itemList(o.items) : (o.item ? kvTable([["Item", esc(o.item)]]) : "")}`)
    + panel(ctaButton(rw ? "Confirm Redelivery Date" : "Confirm Delivery Date", confirmUrl, "Need a different date? Reply to this email or message us on Facebook."), { pad: "8px 36px 24px" })
    + whatsNext("Unconfirmed slots may be released to other deliveries. Confirming takes one tap.")
  );
}

// KUMPIRMADO NA — pasasalamat + ang petsa at oras ng biyahe.
// `rma` — REDELIVERY ng naayos (2026-08-28): ang RMA ang pinangalanan, hindi
// ang order, at "redelivery" ang salita — ang gamit ay matagal nang naihatid.
function ackEmailHtml(o: { customer_name: string | null; order_number: string; address: string | null; balance: number; timeWindow?: string | null; rma?: string | null; items?: EmailItem[] }, dateISO: string): string {
  const rw = !!o.rma;
  return emailShell(
    panel(`
      ${intro(o.customer_name, rw
        ? `Thank you — the redelivery of your repaired item under ${mono(o.rma ?? "")} is <b style="color:#1a7f43">confirmed</b>. Our team will see you on the date below.`
        : `Thank you — your delivery for order ${mono(o.order_number)} is <b style="color:#1a7f43">confirmed</b>. Our team will see you on the date below.`)}
      ${dateBanner(rw ? "Confirmed Redelivery" : "Confirmed Delivery", dateISO)}`, { pad: "26px 36px 20px" })
    + panel(`
      ${sectionTitle(rw ? "Redelivery Details" : "Delivery Details")}
      ${kvTable([
        ...(rw ? [["RMA Number", mono(o.rma ?? "")] as KvRow] : []),
        ["Order ID", mono(o.order_number)],
        ...(o.timeWindow ? [["Time Window", `<b>${esc(o.timeWindow)}</b>`] as KvRow] : []),
        ["Delivery Address", esc(o.address ?? "\u2014")],
        ...(o.balance > 0 ? [[rw ? "Balance due on redelivery (COD)" : "Balance due on delivery (COD)", `<b>${pesoHtml(o.balance)}</b>`] as KvRow] : []),
      ])}
      ${o.items?.length ? itemList(o.items) : ""}`)
    + whatsNext(`Kindly have ${o.balance > 0 ? `<b style="color:#2b2620">${pesoHtml(o.balance)} cash ready</b> and ` : ""}someone available to receive the order. We will call you when the truck is on the way.`)
  );
}

// REMINDER bago ang biyahe (cron) — may Confirm at Reschedule.
// `rma` \u2014 REDELIVERY ng naayos (2026-08-28): ang gamit ay matagal nang naihatid,
// kinumpuni, at iniuuwi ngayon \u2014 hindi ito bagong order na darating.
export async function buildReminderEmail(o: { customer_name: string | null; order_number: string; address: string | null; balance: number; token: string; item?: string; timeWindow?: string | null; rma?: string | null; items?: EmailItem[] }, dateISO: string): Promise<{ subject: string; html: string }> {
  const base = linkBase();
  const rw = !!o.rma;
  const confirmUrl = `${base}/delivery-confirm/${o.token}`;
  const reschedUrl = `${base}/delivery-reschedule/${o.token}`;
  const dateShort = new Date(`${dateISO}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric" });
  const html = emailShell(
    panel(`
      ${intro(o.customer_name, rw
        ? `A reminder: the redelivery of your repaired item under ${mono(o.rma ?? "")} is scheduled on the date below. Please make sure someone is available to receive it.`
        : `A reminder: your delivery for order ${mono(o.order_number)} is scheduled on the date below. Please make sure someone is available to receive it.`)}
      ${dateBanner(rw ? "Upcoming Redelivery" : "Upcoming Delivery", dateISO)}`, { pad: "26px 36px 20px" })
    + panel(`
      ${sectionTitle(rw ? "Redelivery Details" : "Delivery Details")}
      ${kvTable([
        ...(rw ? [["RMA Number", mono(o.rma ?? "")] as KvRow] : []),
        ["Order ID", mono(o.order_number)],
        ...(o.items?.length ? [] : (o.item ? [["Item", esc(o.item)] as KvRow] : [])),
        ...(o.timeWindow ? [["Time Window", `<b>${esc(o.timeWindow)}</b>`] as KvRow] : []),
        ["Delivery Address", esc(o.address ?? "\u2014")],
        ...(o.balance > 0 ? [[rw ? "Balance due on redelivery (COD)" : "Balance due on delivery (COD)", `<b>${pesoHtml(o.balance)}</b>`] as KvRow] : []),
      ])}
      ${o.items?.length ? itemList(o.items) : ""}`)
    + panel(
        ctaButton("Confirm — I'll be there", confirmUrl)
        + `<p style="margin:6px 0 0;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px"><a href="${esc(reschedUrl)}" style="color:#8a6a1f;font-weight:bold">Need to reschedule? Pick a new date here</a> <span style="color:#8a8272">(a \u20b1500 rescheduling fee applies)</span></p>`,
        { pad: "8px 36px 24px" })
    + whatsNext(`Our team will call you when the truck leaves for ${esc(dateShort)}. Questions? Reply to this email or message us on Facebook.`)
  );
  return { subject: `Delivery reminder \u2014 ${o.order_number} \u00b7 ${dateShort}`, html };
}

// IISANG DAANAN NA (2026-08-26): lib/email/send — may outbox log, idempotency,
// at retry. Ang hook ay ang DQ confirm workflow pa rin, fallback sa receipt.
async function sendViaHook(to: string, subject: string, html: string, meta?: { type?: string; orderId?: number | null; orderNumber?: string | null; idempotencyKey?: string | null }): Promise<boolean> {
  const r = await sendEmail({
    to, subject, html,
    type: meta?.type ?? "delivery_queue",
    orderId: meta?.orderId ?? null,
    orderNumber: meta?.orderNumber ?? null,
    idempotencyKey: meta?.idempotencyKey ?? null,
    hook: process.env.N8N_DQ_CONFIRM_WEBHOOK || process.env.N8N_RECEIPT_WEBHOOK,
  });
  return r.ok || !!r.skipped;
}

// Set date + team para sa isang group, tapos i-email ang confirmation sa lahat.
export async function sendGroupConfirmations(input: {
  orderIds: number[];
  group: string;
  dateISO: string;      // proposed delivery date (YYYY-MM-DD)
  teamId: number;
  driverName?: string;  // optional override — hal. RESERVED driver pumalit sa team driver
  coordinatorName?: string; // Delivery Coordinator ng run — auto-fill sa delivery record
}): Promise<{ ok: true; sent: number; skipped: string[] } | { error: string }> {
  try { await requireAnyEdit(["ops_delivery_queue", "ops_approval"]); }
  catch { return { error: "Forbidden — needs Delivery Queue edit access." }; }

  if (!input.orderIds.length) return { error: "No orders in this group." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateISO)) return { error: "Pick a delivery date first." };
  // DRIVER AT COORDINATOR BAGO IPADALA (2026-08-28). Ang email ay hindi na
  // maibabawi at ang stop ay naka-book na pagkatapos nito — kung walang driver
  // at walang coordinator, walang may-ari ang biyahe at walang mahahanap na
  // sagot ang customer na tumawag. Nasa button din ito, pero dito ang tunay na
  // harang: ang server ang huling salita.
  if (!String(input.driverName ?? "").trim()) return { error: "Assign a driver before sending." };
  if (!String(input.coordinatorName ?? "").trim()) return { error: "Assign a delivery coordinator before sending." };

  const db = createServerSupabase();
  const { data: team } = await db.from("delivery_teams").select("id, name, driver, capacity").eq("id", input.teamId).maybeSingle();
  if (!team) return { error: "Pick a delivery team first." };

  // Capacity check: ilang stops na ang team sa petsang ito (pending + confirmed).
  // Ang mga DELIVERED na stop ay hindi na bumibilang — tapos na ang biyahe nila.
  const { data: taken } = await db.from("orders").select("id").eq("dq_team", team.name).eq("dq_date", input.dateISO).not("dq_status", "is", null);
  let takenCount = taken?.length ?? 0;
  if (takenCount > 0) {
    const ids = (taken ?? []).map((t) => t.id as number);
    const { data: doneDels } = await db.from("deliveries").select("order_id").in("order_id", ids).eq("status", "Delivered");
    takenCount -= new Set(((doneDels ?? []) as { order_id: number | null }[]).map((d) => d.order_id)).size;
  }
  if (takenCount + input.orderIds.length > Number(team.capacity ?? 5)) {
    return { error: `${team.name} already has ${takenCount} stop(s) on ${input.dateISO} — capacity is ${team.capacity}. Choose another team or date.` };
  }

  const { data: rows } = await db.from("orders")
    .select("id, order_number, customer_name, address, email, full_payment_price, downpayment_price, full_payment, dq_status, receipt_items")
    .in("id", input.orderIds);

  const base = linkBase();
  const reworkDue = await reworkDueByOrder(db, (rows ?? []).map((o) => o.id as number));
  // PARTIAL DELIVERY (0200): alin ang sakay ng batch na ito, magkano ang singil.
  const batches = await batchInfoFor(db, (rows ?? []) as { id: number; receipt_items: unknown; full_payment_price: number | null; downpayment_price: number | null; full_payment: number | null }[]);
  // REDELIVERY NG NAAYOS: sariling email — RMA, ipinalit na piyesa, at ang
  // TUNAY na balanse ng RMA (2026-08-28).
  const reworkMail = await reworkMailFor(db, (rows ?? []).map((o) => o.id as number));
  // Ang RMA na HINDI PA naaayos ay walang redelivery email — dumadaan pa rin
  // ito sa normal na kumpirmasyon. Pero ang gamit na hawak ng RMA ay alam na
  // kahit ganoon, at iyon lang ang dapat nakalista.
  const reworkItem = await reworkItemDescByOrder(db, (rows ?? []).map((o) => o.id as number));
  let sent = 0;
  const skipped: string[] = [];
  for (const o of rows ?? []) {
    if (o.dq_status) { skipped.push(`${o.order_number ?? o.id}: already in queue`); continue; }
    const to = (o.email || "").trim();
    const token = randomUUID();
    // WALANG BATCH SA REWORK (2026-08-29). Ang batch info ay tungkol sa PARTIAL
    // DELIVERY: ang ilang linya ay handa na, ang iba ay susunod na biyahe. Sa
    // isang rework ay walang susunod na biyahe — ang ibang linya ay nasa bahay
    // ng customer mula pa noong unang hatid. Ang pag-iwan nito ay pumapasok sa
    // BAWAT gumagamit: ang balanse (₱0 mula sa batchDue sa halip na ₱8,500 ng
    // RMA), ang tag na "NEXT DELIVERY", ang "1 of 3 items", at ang subtotal.
    // Rework ang order kapag may hawak itong RMA — ANUMANG palatandaan.
    // Ang `reworkItem` ay nangangailangan ng `item_desc`; ang `reworkDue` ay
    // ng `rework_charge_total`; ang `reworkMail` ay ng `reworked_at`. Ang
    // RMA na kulang sa isa ay nakakalusot noon sa ordinaryong landas, at
    // doon ang buong order at ang ₱0 na batchDue ang lumalabas. Sapat na ang
    // isa sa tatlo para malaman: rework ito.
    const isRw = reworkItem.has(o.id as number) || reworkDue.has(o.id) || reworkMail.has(o.id);
    const bi = isRw ? null : batches.get(o.id);
    // Partial: ang singil ng BATCH (fee + presyo ng sakay − naibayad). Buo o
    // rework: ang dating order-level na balanse.
    // ANG RMA ANG NAUUNA (2026-08-28). Ang isang redelivery ay may utang na
    // nasa returns, hindi sa orders ledger — ₱0 na doon — at hindi ito
    // "partial": iisang gamit ang ibinabalik, hindi bahagi ng bagong order.
    const rw = reworkMail.get(o.id);
    // ANG PARTIAL BRANCH AY HINDI PARA SA REWORK (2026-08-29). Ang `isPartial`
    // ay totoo sa isang rework order — nasa "next" ang dalawang linyang nasa
    // customer na — kaya `batchDue` ang nagagamit, at ₱0 iyon dahil ang buong
    // naibayad ay nakabawas sa isang linya. Pero ang ₱8,500 na utang ay nasa
    // RMA ledger (`reworkDue`), at iyon ang kokolektahin sa pinto.
    const balance = rw
      ? rw.balance
      : bi?.isPartial
      ? bi.batchDue
      : (reworkDue.get(o.id) ?? Math.max(Number(o.full_payment_price ?? 0) - Number(o.downpayment_price ?? 0) - Number(o.full_payment ?? 0), 0));
    // Isulat muna ang state bago mag-email — kahit mabigo ang email, nasa
    // Awaiting Confirm na siya at kaya i-resend (followups) mamaya.
    const { error } = await db.from("orders").update({
      dq_group: input.group,
      dq_status: "pending",
      dq_date: input.dateISO,
      dq_team: team.name,
      dq_driver: (input.driverName || team.driver) ?? null,
      dq_token: token,
      dq_sent_at: new Date().toISOString(),
      // Ang mga linyang sakay ng batch na ito — ito ang ihahatid at sisingilin;
      // null = buong order (dating asal).
      //
      // ANG REWORK AY IISANG LINYA (2026-08-31). Null ang dq_items sa rework
      // noon ("buo o rework: order-level") — pero ang null ay binabasa ng
      // Pickup Task na BUONG order, kaya ang redelivery ng ORD-000001 ay
      // nagpalitaw ng DALAWANG kukunin sa bodega: ang inayos na V.01 AT ang
      // V.02 na matagal nang nasa customer. Ang batch ng redelivery ay ang
      // inayos na linya lamang.
      dq_items: (() => {
        const rwDesc = reworkItem.get(o.id as number);
        if (rwDesc) {
          const k = lineKey(String(rwDesc));
          if (k) return [k];
        }
        return bi?.isPartial ? bi.batch.map((l) => l.key) : null;
      })(),
    }).eq("id", o.id);
    // ROUND 2 (0200): ang deliveries row ng naunang batch ay "Delivered" na —
    // linisin ang mga selyo ng lumang biyahe bago ang bago, para hindi ituring
    // na nakuha/naihatid na ang bagong batch. Ang kasaysayan ng batch 1 ay nasa
    // order_line_deliveries at sa Stock Movement Ledger.
    if (bi && bi.delivered.length > 0) {
      // KUMPLETONG LINIS (2026-09-02, "bakit may nakafill agad"): dating ang
      // status/timestamps lang ang nirereset dito, kaya minana ng batch 2 ang
      // QA PASSED, packing photos, at arrival signature ng batch 1 — mukhang
      // tapos na ang biyaheng hindi pa umaalis. Parehong hanay ng repurpose
      // reset ng saveDeliveryCore. Ang per-line QA history (delivery_qa_items)
      // ay hindi ginagalaw — sinasala na ito per batch ng loader.
      await db.from("deliveries").update({
        status: "Scheduled", delivered_at: null, started_at: null, arrived_at: null,
        pickup_at: null, pickup_started_at: null, pickup_arrived_at: null, pickup_by: null,
        inventory_shipped: false, schedule_date: input.dateISO,
        qa_status: "Pending", qa_by: null,
        packed_at: null, packed_by: null, packing_photos: [],
        signature_url: null, proof_url: null, proof_photos: null,
        payment_collected: null, payment_method: null, collected_by: null, received_by: null,
        pickup_photos: [], pickup_signature: null, pickup_good: null, pickup_defect: null,
        pickup_remarks: null, pickup_notes: null, pickup_rejected_at: null, pickup_reject_reason: null,
        driver_lat: null, driver_lng: null, loc_updated_at: null, pin: null,
      }).eq("order_id", o.id);
      // Mga mas bagong column — hiwalay at best-effort para hindi bumagsak ang
      // buong schedule kapag hindi pa tumatakbo ang 0206/0208.
      try { await db.from("deliveries").update({ item_packing_photos: [] }).eq("order_id", o.id); } catch { /* wala pang 0208 */ }
      try { await db.from("deliveries").update({ pickup_lines: null }).eq("order_id", o.id); } catch { /* wala pang 0206 */ }
    }
    if (error) { skipped.push(`${o.order_number ?? o.id}: ${error.message}`); continue; }
    // COORDINATOR → sa delivery record (auto-fill sa Delivery modal). Update kung
    // may row na; kung wala pa, gumawa ng Scheduled row para may lalagyan.
    if (input.coordinatorName?.trim()) {
      const coord = input.coordinatorName.trim();
      const { data: ex } = await db.from("deliveries").select("id").eq("order_id", o.id).limit(1);
      if (ex?.[0]?.id) await db.from("deliveries").update({ coordinator: coord }).eq("id", ex[0].id);
      else await db.from("deliveries").insert({
        order_id: o.id, order_number: o.order_number ?? null, customer_name: o.customer_name ?? null,
        address: o.address ?? null, status: "Scheduled", coordinator: coord,
        driver_team: (input.driverName || team.driver) ?? null, schedule_date: input.dateISO,
      });
    }
    if (to) {
      const ok = rw ? await sendViaHook(
        to,
        `Your repaired item is scheduled for redelivery — ${rw.rmaNo}`,
        preheader(`Arriving ${fmtDate(input.dateISO)} · ${rw.rmaNo} repaired · ₱${balance.toLocaleString("en-PH")} COD · tap to confirm`)
          + reworkConfirmEmailHtml(
              { customer_name: o.customer_name, order_number: o.order_number, address: o.address },
              { ...rw, balance },
              await emailCardsFor(db, o, null),
              input.dateISO, `${base}/delivery-confirm/${token}`,
            ),
        { type: "delivery_confirmation", orderId: o.id as number, orderNumber: o.order_number, idempotencyKey: `dqconf:${o.id}:${token}` },
      ) : await sendViaHook(
        to,
        `Your delivery is scheduled — ${o.order_number ?? "Your Order"}`,
        preheader(`Arriving ${fmtDate(input.dateISO)}${bi?.isPartial ? ` · ${bi.batch.length} of ${bi.batch.length + bi.next.length + bi.delivered.length} items` : ""} · ₱${balance.toLocaleString("en-PH")} COD · tap to confirm`) + confirmEmailHtml({
          customer_name: o.customer_name, order_number: o.order_number, address: o.address, balance,
          items: reworkItemsOnly(await emailCardsFor(db, o, bi ?? null), reworkItem.get(o.id as number)),
          batch: bi?.isPartial ? bi : null,
          // Ang halaga ng mga NAKALISTA, hindi ng buong order: sa rework ay
          // isang linya lang ang ipinapakita, kaya ang ₱60,000 ng tatlong sofa
          // ay hindi tugma sa nakikita ng customer.
          subtotalThis: bi?.isPartial
            ? bi.batch.reduce((t, l) => t + l.total, 0)
            : reworkItemsOnly(await emailCardsFor(db, o, null), reworkItem.get(o.id as number))
                .reduce((t, c) => t + (Number(c.priceTotal) || 0), 0),
          feeNow: bi ? (bi.delivered.length ? 0 : bi.fees) : 0,
          paid: Math.max((Number(o.downpayment_price) || 0) + (Number(o.full_payment) || 0), 0),
        }, input.dateISO, `${base}/delivery-confirm/${token}`),
        { type: "delivery_confirmation", orderId: o.id as number, orderNumber: o.order_number, idempotencyKey: `dqconf:${o.id}:${token}` },
      );
      if (ok) sent++;
      else skipped.push(`${o.order_number ?? o.id}: email failed (still queued)`);
    } else skipped.push(`${o.order_number ?? o.id}: no email address (still queued)`);
  }

  await auditAfter({ module: "delivery", table: "orders", recordId: input.orderIds[0], action: "update" });
  revalidatePath("/operations/delivery-queue");
  return { ok: true, sent, skipped };
}

// Manual resend ng confirmation (bilang follow-up) sa isang order.
export async function resendConfirmation(orderId: number): Promise<{ ok: true } | { error: string }> {
  try { await requireAnyEdit(["ops_delivery_queue", "ops_approval"]); }
  catch { return { error: "Forbidden — needs Delivery Queue edit access." }; }
  const db = createServerSupabase();
  const { data: o } = await db.from("orders")
    .select("id, order_number, customer_name, address, email, full_payment_price, downpayment_price, full_payment, dq_status, dq_date, dq_token, dq_followups, receipt_items")
    .eq("id", orderId).maybeSingle();
  if (!o || o.dq_status !== "pending" || !o.dq_date || !o.dq_token) return { error: "Order is not awaiting confirmation." };
  const to = (o.email || "").trim();
  if (!to) return { error: "Order has no email address." };
  const base = linkBase();
  // REDELIVERY NG NAAYOS: ang RMA ang paksa, hindi ang order (2026-08-28).
  const rw = (await reworkMailFor(db, [o.id])).get(o.id) ?? null;
  const balance = rw?.balance
    ?? (await reworkDueByOrder(db, [o.id])).get(o.id)
    ?? Math.max(Number(o.full_payment_price ?? 0) - Number(o.downpayment_price ?? 0) - Number(o.full_payment ?? 0), 0);
  const ok = await sendViaHook(
    to,
    rw ? `Reminder: confirm your redelivery — ${rw.rmaNo}` : `Reminder: confirm your delivery — ${o.order_number ?? "Your Order"}`,
    preheader(`${fmtDate(String(o.dq_date).slice(0, 10))} slot still reserved for you · one tap to confirm`) + followupEmailHtml({ customer_name: o.customer_name, order_number: o.order_number, balance, item: rw ? (rw.itemDesc ?? "").split("\n")[0] || itemsSummary(o.receipt_items) : itemsSummary(o.receipt_items), followups: Number(o.dq_followups ?? 0), rma: rw?.rmaNo ?? null, items: reworkItemsOnly(await emailCardsFor(db, o, null), rw?.itemDesc) }, String(o.dq_date).slice(0, 10), `${base}/delivery-confirm/${o.dq_token}`),
    { type: "delivery_followup", orderId, orderNumber: o.order_number },
  );
  if (!ok) return { error: "Email send failed." };
  await db.from("orders").update({ dq_followups: Number(o.dq_followups ?? 0) + 1 }).eq("id", orderId);
  revalidatePath("/operations/delivery-queue");
  return { ok: true };
}

// Ibalik sa For Scheduling (na-cancel ang pag-schedule ng group na ito).
export async function unqueueOrder(orderId: number): Promise<{ ok: true } | { error: string }> {
  try { await requireAnyEdit(["ops_delivery_queue", "ops_approval"]); }
  catch { return { error: "Forbidden — needs Delivery Queue edit access." }; }
  const db = createServerSupabase();
  const { error } = await db.from("orders").update({
    dq_group: null, dq_status: null, dq_date: null, dq_team: null, dq_driver: null,
    dq_token: null, dq_sent_at: null, dq_followups: 0,
  }).eq("id", orderId).eq("dq_status", "pending");
  if (error) return { error: error.message };
  revalidatePath("/operations/delivery-queue");
  return { ok: true };
}

// Ipadala ang 2-days-before reminders sa lahat ng dapat paalalahanan ngayon —
// tinatawag ng /api/delivery/reminders (n8n daily cron) o manually.
// 6AM auto follow-up sa mga DI pa sumasagot sa Initial confirmation —
// isang follow-up kada araw (dq_followup_at guard), cap 3; pagsapit ng 3 →
// "CALL" flag sa UI + Ops push. Tinatawag ng parehong daily cron route.
export async function sendDueFollowups(): Promise<{ ok: true; sent: number; skipped: string[] }> {
  const db = createServerSupabase();
  const manilaDay = (d: Date) => new Date(d.toLocaleString("en-US", { timeZone: "Asia/Manila" })).toDateString();
  const today = manilaDay(new Date());

  const { data: rows } = await db.from("orders")
    .select("id, order_number, customer_name, email, dq_token, dq_date, dq_sent_at, dq_followup_at, dq_followups, full_payment_price, downpayment_price, full_payment, receipt_items")
    .eq("dq_status", "pending")
    .lt("dq_followups", 3);

  const base = linkBase();
  const reworkDue = await reworkDueByOrder(db, (rows ?? []).map((o) => o.id as number));
  const reworkMails = await reworkMailFor(db, (rows ?? []).map((o) => o.id as number));
  let sent = 0;
  const skipped: string[] = [];
  for (const o of rows ?? []) {
    const ord = o.order_number ?? `#${o.id}`;
    const to = (o.email || "").trim();
    if (!to || !o.dq_token || !o.dq_date) { skipped.push(`${ord}: ${!to ? "no email" : "incomplete queue data"}`); continue; }
    // Once-per-day: laktawan kung may na-send na NGAYONG araw (initial man o follow-up).
    const last = o.dq_followup_at ?? o.dq_sent_at;
    if (last && manilaDay(new Date(last)) === today) { skipped.push(`${ord}: already emailed today`); continue; }

    const rw = reworkMails.get(o.id) ?? null;
    const balance = rw?.balance ?? reworkDue.get(o.id) ?? Math.max(Number(o.full_payment_price ?? 0) - Number(o.downpayment_price ?? 0) - Number(o.full_payment ?? 0), 0);
    const ok = await sendViaHook(
      to,
      rw ? `Reminder: confirm your redelivery — ${rw.rmaNo}` : `Reminder: confirm your delivery — ${ord}`,
      preheader(`${fmtDate(String(o.dq_date).slice(0, 10))} slot still reserved for you · one tap to confirm`) + followupEmailHtml({ customer_name: o.customer_name ?? null, order_number: o.order_number, balance, item: rw ? (rw.itemDesc ?? "").split("\n")[0] || itemsSummary(o.receipt_items) : itemsSummary(o.receipt_items), followups: Number(o.dq_followups ?? 0), rma: rw?.rmaNo ?? null, items: reworkItemsOnly(await emailCardsFor(db, o, null), rw?.itemDesc) }, String(o.dq_date).slice(0, 10), `${base}/delivery-confirm/${o.dq_token}`),
      { type: "delivery_followup", orderId: o.id as number, orderNumber: o.order_number, idempotencyKey: `dqfu:${o.id}:${manilaDay(new Date())}` },
    );
    if (!ok) { skipped.push(`${ord}: email failed`); continue; }
    sent++;
    const newCount = Number(o.dq_followups ?? 0) + 1;
    await db.from("orders").update({ dq_followups: newCount, dq_followup_at: new Date().toISOString() }).eq("id", o.id);
    // 3× walang sagot → oras nang TAWAGAN — isang push, hindi paulit-ulit.
    if (newCount >= 3) {
      try {
        const { notifyConfirmNoResponse } = await import("@/lib/push/notify");
        await notifyConfirmNoResponse({ orderNumber: ord, customer: o.customer_name ?? null });
      } catch { /* optional */ }
    }
  }
  return { ok: true, sent, skipped };
}

export async function sendDueReminders(): Promise<{ ok: true; sent: number; skipped: string[] }> {
  const db = createServerSupabase();
  // "Ngayon" sa Asia/Manila; target = mga delivery na 2 araw mula ngayon.
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const target = new Date(now); target.setDate(target.getDate() + 2);
  const targetISO = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;

  const { data: rows } = await db.from("orders")
    .select("id, order_number, customer_name, address, email, dq_token, dq_reminder_sent_at, dq_time_window, full_payment_price, downpayment_price, full_payment, receipt_items")
    .eq("dq_status", "confirmed")
    .eq("dq_date", targetISO)
    .is("dq_reminder_sent_at", null);

  const reworkDue = await reworkDueByOrder(db, (rows ?? []).map((o) => o.id as number));
  const reworkMailsR = await reworkMailFor(db, (rows ?? []).map((o) => o.id as number));
  let sent = 0;
  const skipped: string[] = [];
  for (const o of rows ?? []) {
    const to = (o.email || "").trim();
    const ord = o.order_number ?? `#${o.id}`;
    if (!to || !o.dq_token) { skipped.push(`${ord}: ${!to ? "no email" : "no token"}`); continue; }
    const balance = reworkDue.get(o.id) ?? Math.max(Number(o.full_payment_price ?? 0) - Number(o.downpayment_price ?? 0) - Number(o.full_payment ?? 0), 0);
    const rwR = reworkMailsR.get(o.id) ?? null;
    const mail = await buildReminderEmail({ customer_name: o.customer_name ?? null, order_number: ord, address: o.address ?? null, balance: rwR?.balance ?? balance, token: o.dq_token, item: rwR ? (rwR.itemDesc ?? "").split("\n")[0] || itemsSummary(o.receipt_items) : itemsSummary(o.receipt_items), timeWindow: o.dq_time_window ?? null, rma: rwR?.rmaNo ?? null, items: reworkItemsOnly(await emailCardsFor(db, o, null), rwR?.itemDesc) }, targetISO);
    const ok = await sendViaHook(to, mail.subject, mail.html, { type: "delivery_reminder", orderId: o.id as number, orderNumber: ord, idempotencyKey: `dqrem:${o.id}:${targetISO}` });
    if (ok) { sent++; await db.from("orders").update({ dq_reminder_sent_at: new Date().toISOString() }).eq("id", o.id); }
    else skipped.push(`${ord}: email failed`);
  }
  return { ok: true, sent, skipped };
}

// OPS reschedule — pagkatapos ng usapan sa Messenger (RESCHED-<order> ref).
// Sinusulat ng OPS ang bagong petsa; may one-time ₱500 rescheduling fee na
// idinadagdag sa balance (COD) — isang beses lang kahit ilang ulit mag-lipat
// (guard: may "Reschedule Fee" line na sa receipt_items). Ang bagong petsa ay
// confirmed agad, nire-reset ang reminder cycle, at pinapadalhan ang customer
// ng Confirmed email + Messenger echo.
export async function opsRescheduleOrder(input: {
  orderId: number;
  dateISO: string;
  timeWindow: string | null;
  applyFee: boolean;
}): Promise<{ ok: true; feeApplied: boolean } | { error: string }> {
  try { await requireAnyEdit(["ops_delivery_queue", "ops_approval", "orders"]); }
  catch { return { error: "Forbidden — needs Delivery Queue edit access." }; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateISO)) return { error: "Pick the new delivery date first." };
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  now.setHours(0, 0, 0, 0);
  if (new Date(`${input.dateISO}T00:00:00`) < now) return { error: "The new date cannot be in the past." };

  const db = createServerSupabase();
  const { data: o } = await db.from("orders")
    .select("id, order_number, dq_status, dq_team, dq_driver, dq_date, address, contact_number, customer_name, email, customer_psid, full_payment_price, downpayment_price, full_payment, receipt_items")
    .eq("id", input.orderId).maybeSingle();
  if (!o || (o.dq_status !== "confirmed" && o.dq_status !== "pending")) {
    return { error: "Order is not in the delivery queue (must be pending or confirmed)." };
  }

  // Capacity ng team sa bagong petsa.
  if (o.dq_team) {
    const [{ data: taken }, { data: team }] = await Promise.all([
      db.from("orders").select("id").eq("dq_team", o.dq_team).eq("dq_date", input.dateISO).not("dq_status", "is", null).neq("id", o.id),
      db.from("delivery_teams").select("capacity").eq("name", o.dq_team).maybeSingle(),
    ]);
    if ((taken?.length ?? 0) >= Number(team?.capacity ?? 5)) {
      return { error: `${o.dq_team} is fully booked on ${input.dateISO} — choose another date.` };
    }
  }

  // ONE-TIME ₱500 fee: idagdag bilang charge line (tulad ng Shipping Fee —
  // kasama sa total/balance/resibo pero hindi produkto) + total adjust.
  const items = Array.isArray(o.receipt_items) ? [...(o.receipt_items as { description?: string; qty?: number; unitPrice?: number }[])] : [];
  const alreadyCharged = items.some((it) => /^reschedule fee/i.test(String(it?.description ?? "").trim()));
  let feeApplied = false;
  let newTotal = Number(o.full_payment_price ?? 0);
  if (input.applyFee && !alreadyCharged) {
    items.push({ description: "Reschedule Fee", qty: 1, unitPrice: 500 });
    newTotal = Math.round((newTotal + 500) * 100) / 100;
    feeApplied = true;
  }

  const patch: Record<string, unknown> = {
    dq_status: "confirmed",
    dq_confirmed_at: new Date().toISOString(),
    dq_date: input.dateISO,
    dq_time_window: input.timeWindow ?? null,
    dq_reminder_sent_at: null,      // bagong petsa → bagong 2-days-before reminder
    dq_reminder_ack_at: null,
    date_of_delivery: input.dateISO,
  };
  if (feeApplied) {
    patch.receipt_items = items;
    patch.full_payment_price = newTotal;
  }
  const { error } = await db.from("orders").update(patch).eq("id", o.id);
  if (error) return { error: error.message };

  // Delivery record: bagong schedule + time window (same team/driver).
  try {
    const { data: existing } = await db.from("deliveries").select("id").eq("order_id", o.id).maybeSingle();
    const dpatch = { schedule_date: input.dateISO, time_window: input.timeWindow ?? null, driver_team: o.dq_driver ?? o.dq_team ?? null };
    if (existing) await db.from("deliveries").update(dpatch).eq("id", existing.id);
    // KASAMA ang order_number + customer + address pin: ang driver Arrive/GPS APIs ay
    // naghahanap by order_number, at lahat ng delivery record ay dapat may address+pin.
    else await db.from("deliveries").insert({
      order_id: o.id, order_number: o.order_number ?? null, customer_name: o.customer_name ?? null,
      status: "Scheduled", address: o.address ?? null, contact: o.contact_number ?? null,
      ...dpatch,
    });
  } catch { /* best-effort */ }

  const ord = o.order_number ?? `#${o.id}`;
  // Rework: RMA ledger ang balance; kapag na-apply ang ₱500 resched fee, isama rin
  // ito sa RMA charge para pareho ang makikita ng queue/installation guard.
  const rDue = (await reworkDueByOrder(db, [o.id])).get(o.id);
  if (rDue != null && feeApplied) {
    try {
      const { data: rr } = await db.from("returns")
        .select("id, rework_charge_total").eq("order_id", o.id).eq("resolution", "rework")
        .not("status", "in", "(Rejected,Pending)").order("created_at", { ascending: false }).limit(1);
      if (rr?.[0]) await db.from("returns").update({ rework_charge_total: Math.round(((Number(rr[0].rework_charge_total) || 0) + 500) * 100) / 100 }).eq("id", rr[0].id);
    } catch { /* best-effort */ }
  }
  const balance = rDue != null
    ? rDue + (feeApplied ? 500 : 0)
    : Math.max(newTotal - Number(o.downpayment_price ?? 0) - Number(o.full_payment ?? 0), 0);

  // Abiso: Ops push + Confirmed email (bagong date + updated COD) + Messenger echo.
  try {
    const { notifyDeliveryRescheduled } = await import("@/lib/push/notify");
    await notifyDeliveryRescheduled({ orderNumber: ord, date: input.dateISO, timeWindow: input.timeWindow ?? null });
  } catch { /* optional */ }
  try {
    const to = (o.email || "").trim();
    // Ang buong ReworkMail, hindi ang rmaNo lang: kailangan ng `itemDesc` para
    // masala ang item cards sa inayos lang.
    const rwAck = (await reworkMailFor(db, [o.id as number])).get(o.id as number) ?? null;
    const rma = rwAck?.rmaNo ?? null;
    const rwItemDesc = rwAck?.itemDesc ?? null;
    if (to) await sendViaHook(to, rma ? `Redelivery rescheduled — ${rma} · ${fmtDate(input.dateISO)}` : `Delivery rescheduled — ${ord} · ${fmtDate(input.dateISO)}`, preheader(`New date ${fmtDate(input.dateISO)}${input.timeWindow ? ` · ${input.timeWindow}` : ""}`) + ackEmailHtml({ customer_name: o.customer_name ?? null, order_number: ord, address: o.address ?? null, balance, timeWindow: input.timeWindow ?? null, rma, items: reworkItemsOnly(await emailCardsFor(db, o, null), rwItemDesc) }, input.dateISO), { type: "delivery_rescheduled", orderId: o.id as number, orderNumber: ord });
  } catch { /* best-effort */ }
  try {
    const psid = (o as { customer_psid?: string | null }).customer_psid;
    if (psid) {
      const { notifyCustomerDeliveryConfirmed } = await import("@/lib/fb/notify");
      await notifyCustomerDeliveryConfirmed(psid, { orderNumber: ord, dateLabel: `${fmtDate(input.dateISO)}${input.timeWindow ? ` · ${input.timeWindow}` : ""}`, address: o.address ?? null, balance });
    }
  } catch { /* best-effort */ }

  revalidatePath("/operations/delivery-queue");
  revalidatePath("/delivery");
  revalidatePath("/orders");
  return { ok: true, feeApplied };
}

// PUBLIC confirm — tinatawag ng /delivery-confirm/[token] page (walang login).
// Pag na-confirm: date_of_delivery = dq_date, at gumagawa/nag-a-update ng
// deliveries row para lumitaw agad sa EXISTING Delivery module na may team na.
export async function confirmDeliveryByToken(token: string): Promise<
  | { ok: true; orderNumber: string | null; date: string; already: boolean }
  | { error: string }
> {
  if (!token || token.length < 10) return { error: "Invalid confirmation link." };
  const db = createServerSupabase();
  const { data: o } = await db.from("orders")
    .select("id, order_number, dq_status, dq_date, dq_team, dq_driver, dq_confirmed_at, address, contact_number, customer_name, email, customer_psid, full_payment_price, downpayment_price, full_payment, receipt_items")
    .eq("dq_token", token).maybeSingle();
  if (!o) return { error: "This confirmation link is no longer valid." };
  const date = o.dq_date ? String(o.dq_date).slice(0, 10) : "";
  if (o.dq_status === "confirmed") {
    // Confirm mula sa 2-days-before REMINDER — re-affirmation: itala kung
    // kailan nag-ack para kita ng Ops kung sinong stops ang "sure na sure".
    try { await db.from("orders").update({ dq_reminder_ack_at: new Date().toISOString() }).eq("id", o.id).is("dq_reminder_ack_at", null); } catch { /* optional column (0141) */ }
    return { ok: true, orderNumber: o.order_number ?? null, date, already: true };
  }
  if (o.dq_status !== "pending" || !date) return { error: "This confirmation link is no longer valid." };

  const { error } = await db.from("orders").update({
    dq_status: "confirmed",
    dq_confirmed_at: new Date().toISOString(),
    date_of_delivery: date,
  }).eq("id", o.id).eq("dq_status", "pending");
  if (error) return { error: "Could not record the confirmation — please try again." };

  // Delivery record para sa existing module: schedule + team snapshot.
  try {
    const { data: team } = o.dq_team
      ? await db.from("delivery_teams").select("vehicle").eq("name", o.dq_team).maybeSingle()
      : { data: null };
    const { data: existing } = await db.from("deliveries").select("id").eq("order_id", o.id).maybeSingle();
    const patch = {
      schedule_date: date,
      driver_team: o.dq_driver ?? o.dq_team ?? null,
      vehicle_plate: (team as { vehicle: string | null } | null)?.vehicle ?? null,
    };
    if (existing) await db.from("deliveries").update(patch).eq("id", existing.id);
    // KASAMA ang order_number + customer + address pin (kapareho ng reschedule path).
    else await db.from("deliveries").insert({
      order_id: o.id, order_number: o.order_number ?? null, customer_name: o.customer_name ?? null,
      status: "Scheduled", address: o.address ?? null, contact: o.contact_number ?? null,
      ...patch,
    });
  } catch { /* best-effort — lilitaw pa rin sa Delivery via date_of_delivery */ }

  // Abisuhan ang Ops (best-effort push).
  try {
    const { notifyDeliveryConfirmed } = await import("@/lib/push/notify");
    await notifyDeliveryConfirmed({ orderNumber: o.order_number ?? `#${o.id}`, date });
  } catch { /* optional */ }

  const ord = o.order_number ?? `#${o.id}`;
  const balance = (await reworkDueByOrder(db, [o.id])).get(o.id)
    ?? Math.max(Number(o.full_payment_price ?? 0) - Number(o.downpayment_price ?? 0) - Number(o.full_payment ?? 0), 0);

  // Thank-you / acknowledgment email pabalik sa customer (best-effort).
  try {
    const to = (o.email || "").trim();
    // Ang buong ReworkMail, hindi ang rmaNo lang: kailangan ng `itemDesc` para
    // masala ang item cards sa inayos lang.
    const rwAck = (await reworkMailFor(db, [o.id as number])).get(o.id as number) ?? null;
    const rma = rwAck?.rmaNo ?? null;
    const rwItemDesc = rwAck?.itemDesc ?? null;
    if (to) await sendViaHook(to, rma ? `Redelivery confirmed — ${rma} · ${fmtDate(date)}` : `Delivery confirmed — ${ord} · ${fmtDate(date)}`, preheader(`See you ${fmtDate(date)}${balance > 0 ? ` · ₱${balance.toLocaleString("en-PH")} COD` : ""}`) + ackEmailHtml({ customer_name: o.customer_name ?? null, order_number: ord, address: o.address ?? null, balance, rma, items: reworkItemsOnly(await emailCardsFor(db, o, null), rwItemDesc) }, date), { type: "delivery_confirmed_ack", orderId: o.id as number, orderNumber: ord });
  } catch { /* best-effort */ }

  // Messenger echo sa customer thread (kung naka-link ang PSID via m.me ref).
  try {
    const psid = (o as { customer_psid?: string | null }).customer_psid;
    if (psid) {
      const { notifyCustomerDeliveryConfirmed } = await import("@/lib/fb/notify");
      await notifyCustomerDeliveryConfirmed(psid, { orderNumber: ord, dateLabel: fmtDate(date), address: o.address ?? null, balance });
    }
  } catch { /* best-effort */ }

  revalidatePath("/operations/delivery-queue");
  revalidatePath("/delivery");
  return { ok: true, orderNumber: o.order_number ?? null, date, already: false };
}
