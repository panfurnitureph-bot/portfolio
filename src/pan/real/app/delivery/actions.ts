"use server";

import { revalidatePath } from "next/cache";
import { emailShell, panel, intro, mono, ctaButton, sectionTitle, kvTable, whatsNext, progressRail, esc as escHtml, gmailParcelSchema, preheader, itemList, totalsTable, type EmailItem } from "@/lib/email/layout";
import { emailItemsFromLines, productLinesOf, reworkItemsOnly, reworkItemDescByOrder, batchTagsFor, applyBatchTags, feeTotalOf } from "@/lib/email/items";
import { reworkLedger } from "@/lib/returns/rework-balance";
import { sendEmail } from "@/lib/email/send";
import { createServerSupabase } from "@/lib/supabase/server";
import { todayPH } from "@/lib/today";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { requireEdit } from "@/lib/auth/guard";
import { saveDeliveryCore } from "@/lib/delivery/save";
import { shipInventory, resyncReserved, type OrderItem } from "@/lib/orders/inventory";
import { trackToken } from "@/lib/track-token";

export type DeliveryQaItemInput = {
  id: number | null;
  description: string | null;
  image_url: string | null;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  qty: number;
  good_qty: number;
  defect_qty: number;
  photo_url: string | null;
  checked_by: string | null;
  remarks: string | null;
};

export type DeliveryInput = {
  id: number | null;
  order_id: number | null;
  order_number: string | null;
  customer_name: string | null;
  contact: string | null;
  address: string | null;
  sales_rep: string | null;
  items_summary: string | null;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  schedule_date: string | null;
  time_window: string | null;
  driver_team: string | null;
  coordinator: string | null;
  vehicle_plate: string | null;
  qa_status: string;
  qa_by: string | null;
  payment_collected: number;
  payment_method: string | null;
  collected_by: string | null;
  received_by: string | null;
  proof_url: string | null;
  status: string;
  notes: string | null;
  qa_items: DeliveryQaItemInput[];
  // REPURPOSE (rework pickup/redelivery): iisa lang ang deliveries row bawat
  // order (0126 unique index) — pag ginagamit ULIT ang row para sa bagong task,
  // itakda ito para (a) hindi ipagpilitan ng anti-downgrade guard ang lumang
  // Delivered/Arrived status at (b) malinis ang lifecycle fields (arrival,
  // proof, packing) ng nakaraang gamit.
  repurpose?: boolean;
};

export async function saveDelivery(input: DeliveryInput): Promise<{ ok: true; id: number } | { error: string }> {
  await requireEdit("/delivery", "delivery");
  // WALANG STATUS LOCK (Joe 2026-09-05, "pag may permission na view at edit,
  // wala nang blocker"): ang requireEdit sa itaas — ang permission grid — ang
  // nag-iisang gate, kahit Delivered na. Ang dating lock ay tinanggal.
  // REWORK GUARDRAIL: bawal i-Delivered nang manual ang rework REDELIVERY habang
  // may natitirang RMA balance (kolektahin muna sa Returns modal). Ang PICKUP task
  // (Pickup for Rework) ay hindi saklaw — normal na unpaid pa iyon sa yugtong iyon.
  if (/delivered/i.test(input.status || "") && input.order_id != null && !/pickup for rework/i.test(input.items_summary ?? "")) {
    const { reworkLedger } = await import("@/lib/returns/rework-balance");
    const rl = await reworkLedger(createServerSupabase(), input.order_id);
    if (rl && rl.due > 0) return { error: `Can't mark Delivered — collect the remaining ₱${rl.due.toLocaleString("en-PH", { minimumFractionDigits: 2 })} rework balance (${rl.rma}) first (Returns → Collect payment).` };
  }
  // Core sa lib/delivery/save.ts (walang guard) — ginagamit din ng returns
  // approve/markReworked para makagawa ng pickup/redelivery task nang hindi
  // natitisod sa delivery-edit permission ng approver.
  return saveDeliveryCore(input);
}

// Public base URL for customer-facing links (tracking). Set NEXT_PUBLIC_APP_URL once deployed.
function publicBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "").replace(/\/+$/, "");
}

// Branded "out for delivery" email. The Track button goes to the WEBSITE's Track
// Order page (NEXT_PUBLIC_STORE_URL /track?order=…&t=<token>) — same link the
// Messenger bot / order emails use — falling back to the internal
// /track-preview.html live map only when the store URL isn't configured.
async function sendOutForDeliveryEmail(
  order: { id?: number; email?: string | null; customer_name?: string | null; order_number?: string | null; address?: string | null; address_lat?: number | null; address_lng?: number | null; date_order?: string | null; full_payment_price?: number | null; downpayment_price?: number | null; full_payment?: number | null; receipt_items?: unknown },
  pin?: string,
  db?: ReturnType<typeof createServerSupabase>,
): Promise<void> {
  try {
    const hook = process.env.N8N_DELIVERY_WEBHOOK;
    const to = (order.email || "").trim();
    if (!hook || !to) return;
    const store = (process.env.NEXT_PUBLIC_STORE_URL || "").replace(/\/+$/, "");
    const orderNoRaw = order.order_number || "";
    let trackUrl: string;
    if (store && orderNoRaw) {
      const tok = trackToken(orderNoRaw);
      trackUrl = `${store}/track?order=${encodeURIComponent(orderNoRaw)}${tok ? `&t=${tok}` : ""}`;
    } else {
      const base = publicBase();
      const q = new URLSearchParams();
      if (orderNoRaw) q.set("order", orderNoRaw);
      if (order.address_lat != null && order.address_lng != null) { q.set("dlat", String(order.address_lat)); q.set("dlng", String(order.address_lng)); }
      else if (order.address) q.set("addr", order.address);
      if (pin) q.set("pin", pin);
      trackUrl = `${base}/track-preview.html?${q.toString()}`;
    }
    const name = order.customer_name || "there";
    const orderNo = order.order_number || "";
    const subject = `Your order is on the way — ${orderNo}`;

    // Ang laman ng biyahe — best-effort: ang abiso ang mahalaga, hindi ang
    // larawan. Sa rework, ang inayos lang ang dala at ang utang ay nasa RMA
    // ledger (₱0 na sa orders), kaparehong tuntunin ng ibang email.
    let cards: EmailItem[] = [];
    let cod = 0;
    try {
      if (db && order.id != null) {
        const rwName = (await reworkItemDescByOrder(db, [order.id])).get(order.id) ?? null;
        cards = reworkItemsOnly(
          await emailItemsFromLines(db, productLinesOf((Array.isArray(order.receipt_items) ? order.receipt_items : []) as never[])),
          rwName,
        );
        const rl = await reworkLedger(db, order.id);
        cod = rl
          ? rl.due
          : Math.max(Math.round(((Number(order.full_payment_price) || 0) - (Number(order.downpayment_price) || 0) - (Number(order.full_payment) || 0)) * 100) / 100, 0);
        // PARTIAL DELIVERY (2026-09-03): tag kada item (DELIVERED / THIS /
        // NEXT) at ang COD ay ang KUMULATIBONG singil ng biyaheng ito —
        // (naihatid na + batch + fee) - lahat ng bayad — hindi ang buong
        // balanse ng order.
        const tags = await batchTagsFor(db, order.id);
        cards = applyBatchTags(cards, tags);
        if (tags && !rl) {
          const lines = (Array.isArray(order.receipt_items) ? order.receipt_items : []) as { description?: string | null; qty?: number; unitPrice?: number }[];
          const keyN = (t: unknown) => String(t ?? "").split("\n")[0].trim().toLowerCase();
          const amtOf = (pred: (k: string) => boolean) => productLinesOf(lines)
            .filter((l) => pred(keyN(l.description)))
            .reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.qty) || 1), 0);
          const due = feeTotalOf(lines)
            + amtOf((k) => tags.get(k) === "delivered")
            + amtOf((k) => tags.get(k) === "this")
            - ((Number(order.downpayment_price) || 0) + (Number(order.full_payment) || 0));
          cod = Math.max(Math.round(due * 100) / 100, 0);
        }
      }
    } catch { /* best-effort */ }
    // SHOPEE-STYLE (2026-08-26): binubuo mula sa lib/email/layout — iisang
    // hulma ng lahat ng email. Ang progress rail ay shared block na rin.
    const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : undefined);
    const todayStr = new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric" });
    const html =
      preheader(`Track the truck live — your order is out for delivery`) +
      // GMAIL SUMMARY CARD: parcel in transit + Track na aksyon.
      gmailParcelSchema({
        orderNumber: orderNo,
        status: "OrderInTransit",
        expectedArrivalISO: todayPH(),
        trackUrl,
        customerName: order.customer_name,
        address: order.address,
        // Kita agad ang dala sa summary card ng Gmail, bago pa mabuksan.
        items: cards.map((c) => ({ name: c.name, image: typeof c.photoUrl === "string" && /^https?:/.test(c.photoUrl) ? c.photoUrl : null })),
      }) +
      emailShell(
        panel(
          intro(name, `Good news — your order ${mono(orderNo)} is now <b>out for delivery</b> and our driver is heading to your address.`)
          + progressRail([
              { label: "Confirmed", state: "done", date: fmtD(order.date_order) },
              { label: "Packed", state: "done", date: todayStr },
              { label: "Out for Delivery", state: "current", date: todayStr },
              { label: "Arrived", state: "todo" },
              { label: "Installation", state: "todo" },
              { label: "Delivered", state: "todo" },
            ]),
          { pad: "26px 36px 20px" })
        + panel(ctaButton("Track My Delivery", trackUrl, "Live map — see the truck on its way to you."), { pad: "8px 36px 20px" })
        // ANO ANG DARATING (hiling 2026-08-29). Walang laman ang abisong ito
        // noon — sinasabi lang na paalis na ang trak. Dalawa ang tanong ng
        // customer sa sandaling iyon: ano ang dala, at magkano ang ihahanda.
        + (cards.length ? panel(`${sectionTitle("On the truck")}${itemList(cards)}`) : "")
        + (cod > 0 ? panel(totalsTable([{ label: "Amount due on delivery (COD)", amount: cod, big: true }]), { pad: "6px 36px 10px" }) : "")
        + (order.address ? panel(`${sectionTitle("Delivery Details")}${kvTable([["Recipient Name", `<b>${escHtml(name)}</b>`], ["Delivery Address", escHtml(order.address)]])}`) : "")
        + whatsNext(cod > 0
            ? `Kindly have <b style="color:#2b2620">₱${cod.toLocaleString("en-PH", { minimumFractionDigits: 2 })} cash ready</b> on arrival, and someone available to receive the order. Questions? Just reply to this email or message us on Facebook.`
            : "Please have someone available to receive the order. Questions? Just reply to this email or message us on Facebook.")
      );
    await sendEmail({
      to, subject, html, type: "out_for_delivery",
      orderNumber: orderNo,
      hook, extra: { customer: order.customer_name || "", track_url: trackUrl },
      idempotencyKey: `ofd:${orderNo}:${todayPH()}`,
    });
  } catch { /* email is best-effort */ }
}

// Geocode a free-text address → {lat,lng} via Photon (best-effort, PH-biased).
async function geocodeAddress(addr: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(addr)}&limit=1&lang=en&lat=14.6&lon=121.0`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json();
    const c = j?.features?.[0]?.geometry?.coordinates;
    if (Array.isArray(c) && c.length === 2) return { lat: Number(c[1]), lng: Number(c[0]) };
    return null;
  } catch { return null; }
}

// Start a delivery from the Live Tracking card: mark Out for Delivery + stamp started_at,
// pin the customer destination + the driver's start position, then email the tracking link.
export async function startDelivery(input: { order_id: number | null; order_number: string | null; customer_name: string | null; address: string | null; start_lat?: number | null; start_lng?: number | null }): Promise<{ ok: true } | { error: string }> {
  const me = await requireEdit("/delivery", "delivery");
  const supabase = createServerSupabase();
  const now = new Date().toISOString();

  // HARD GATE: must be PACKED (packing proof uploaded) before dispatch. The server
  // is the real lock — the UI mirrors it but can be bypassed (stale page).
  //
  // Sinusundan ito ng PICKUP (0186): ang pagkakarga ang huling nakikita ang
  // bagay bago ito umalis, at doon nasesellyo ang litrato ng kondisyon nito.
  // Ang packing ay tungkol sa paghahanda; ang pickup ay tungkol sa pag-alis.
  if (input.order_id != null) {
    const { data: pk } = await supabase.from("deliveries").select("packed_at, pickup_at").eq("order_id", input.order_id).limit(1);
    if (!pk?.[0]?.packed_at) {
      return { error: "Pack the item first — upload packing proof (5 photos) before dispatch." };
    }
    if (!pk?.[0]?.pickup_at) {
      return { error: "Pick it up first — take a loading photo in Pickup Task before dispatch." };
    }
  }
  let pin = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit delivery PIN

  // Destination = the customer's address. Ensure we have coords so the map ALWAYS points to it.
  let destLat: number | null = null, destLng: number | null = null;
  if (input.order_id != null) {
    const { data: ord } = await supabase.from("orders").select("address, address_lat, address_lng").eq("id", input.order_id).limit(1);
    const o = ord?.[0];
    destLat = (o?.address_lat as number | null) ?? null;
    destLng = (o?.address_lng as number | null) ?? null;
    const addr = (input.address || (o?.address as string | null) || "").trim();
    if ((destLat == null || destLng == null) && addr) {
      const g = await geocodeAddress(addr);
      if (g) { destLat = g.lat; destLng = g.lng; await supabase.from("orders").update({ address_lat: g.lat, address_lng: g.lng }).eq("id", input.order_id); }
    }
  } else if (input.address) {
    const g = await geocodeAddress(input.address);
    if (g) { destLat = g.lat; destLng = g.lng; }
  }

  // Driver ORIGIN = where Start Delivery was pressed (if GPS was granted).
  const startLat = input.start_lat ?? null, startLng = input.start_lng ?? null;
  // Seed the live driver position with the start point so tracking begins there.
  const loc = startLat != null && startLng != null ? { driver_lat: startLat, driver_lng: startLng, loc_updated_at: now } : {};
  // NOTE: the destination coords live on the ORDER (orders.address_lat/lng) — the
  // deliveries table has no address_lat/lng columns. Writing them here previously made
  // the whole UPDATE fail (42703 "column does not exist") so the delivery never started
  // and no email was sent. We already persisted the geocoded coords onto the order above;
  // the delivery loader reads them from the order. So do NOT write dest coords here.
  void destLat; void destLng;
  const base = { status: "Out for Delivery", started_at: now, pin, ...loc };

  let alreadyShipped = false;
  if (input.order_id != null) {
    const { data } = await supabase.from("deliveries").select("id, pin, inventory_shipped").eq("order_id", input.order_id).limit(1);
    const row = data?.[0];
    alreadyShipped = !!row?.inventory_shipped;
    if (row?.pin) pin = String(row.pin); // keep an already-issued PIN stable
    if (row?.id) { const { error } = await supabase.from("deliveries").update({ ...base, pin }).eq("id", row.id); if (error) return { error: error.message }; }
    else { const { error } = await supabase.from("deliveries").insert({ order_id: input.order_id, order_number: input.order_number || null, customer_name: input.customer_name || null, address: input.address || null, ...base, pin }); if (error) return { error: error.message }; }
  } else {
    const { error } = await supabase.from("deliveries").insert({ order_id: null, order_number: input.order_number || null, customer_name: input.customer_name || null, address: input.address || null, ...base, pin });
    if (error) return { error: error.message };
  }

  // PHYSICAL STOCK-OUT: on-hand only leaves the warehouse now (it was merely
  // RESERVED at order commit). Deduct once, guarded by BOTH the delivery stamp and
  // the order stamp — a SKIP line is already shipped at its "QC for OUT" pass
  // (orders.inventory_shipped), so we must NOT deduct again here.
  if (input.order_id != null && !alreadyShipped) {
    const { data: ord } = await supabase.from("orders").select("receipt_items, inventory_shipped, dq_items").eq("id", input.order_id).limit(1);
    const orderShipped = !!ord?.[0]?.inventory_shipped;
    const items = (ord?.[0]?.receipt_items as OrderItem[] | null) ?? [];
    if (!orderShipped && items.length) {
      // PARTIAL DELIVERY (0225, 2026-09-01): ang BATCH lang (dq_items) ang
      // ibinabawas, at ang mga linyang nabawasan na (hal. QC-OUT ng skip line)
      // ay hindi na inuulit. Ang orders.inventory_shipped ay naitatakda LANG
      // kapag kumpleto na ang lahat ng linya — kung hindi, mananatili itong
      // bukas para tumakbo ang Partial Delivery machinery sa Delivered. Bago
      // ang 0225 (null ang lines_shipped): eksaktong lumang buong-order.
      const { lineKeyOf, readLinesShipped, addLinesShipped } = await import("@/lib/orders/inventory");
      const { keySet, hasKey, lineName } = await import("@/lib/orders/line-key");
      const ls = await readLinesShipped(supabase, input.order_id);
      const isFeeLine = (d: string) => /^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test(d);
      // KASAMA ANG KULAY (2026-09-06): "pangalan @ kulay" ang susi ng linya.
      const lk = (it: OrderItem) => lineKeyOf(it.description, (it as { color?: string | null }).color);
      const sel = Array.isArray(ord?.[0]?.dq_items) && (ord![0].dq_items as unknown[]).length ? keySet(ord![0].dq_items) : null;
      const batch = ls !== null && sel?.size ? items.filter((it) => hasKey(sel, lk(it))) : items;
      const toShip = ls === null ? items : batch.filter((it) => { const k = lineName(it.description); return !k || isFeeLine(k) || !hasKey(ls, lk(it)); });
      const ok = toShip.length ? await shipInventory(supabase, toShip, me.full_name, input.order_number) : true;
      if (ok) {
        await supabase.from("deliveries").update({ inventory_shipped: true }).eq("order_id", input.order_id);
        if (ls === null) {
          await supabase.from("orders").update({ inventory_shipped: true }).eq("id", input.order_id);
        } else {
          const shippedKeys = toShip.filter((it) => { const k = lineName(it.description); return k && !isFeeLine(k); }).map(lk);
          await addLinesShipped(supabase, input.order_id, shippedKeys);
          const allKeys = items.filter((it) => { const k = lineName(it.description); return k && !isFeeLine(k); }).map(lk);
          const after = new Set([...ls, ...shippedKeys]);
          if (allKeys.every((k) => hasKey(after, k))) {
            await supabase.from("orders").update({ inventory_shipped: true }).eq("id", input.order_id);
          }
        }
        await resyncReserved(supabase); // reserved drops as the order leaves the warehouse
      }
    } else if (orderShipped) {
      // REWORK REDELIVERY: ang order ay na-ship na noong ORIGINAL delivery, pero
      // ang rework item ay pumasok ULIT sa stock sa warehouse receiving (+1) —
      // kaya sa paglabas nito ay ibabawas ULIT, pero ANG REWORK ITEM LANG (hindi
      // ang buong order). Kung Direct Pickup ang route (hindi dumaan sa
      // warehouse, walang +1), walang ibabawas. Idempotent via the delivery-row
      // inventory_shipped flag (nire-reset ng autoRedeliverRework).
      const { data: rw } = await supabase.from("returns")
        .select("id, return_no, sku, item_desc, qty, rework_job_id")
        .eq("order_id", input.order_id).eq("resolution", "rework")
        .not("reworked_at", "is", null)
        .order("created_at", { ascending: false }).limit(1);
      const rr = rw?.[0] as { return_no: string | null; sku: string | null; item_desc: string | null; qty: number | null; rework_job_id: number | null } | undefined;
      if (rr?.rework_job_id != null) {
        const { data: j } = await supabase.from("workshop_job").select("qc_received_at").eq("id", rr.rework_job_id).maybeSingle();
        if (j?.qc_received_at) {
          const item: OrderItem = {
            qty: Number(rr.qty) || 1,
            description: (rr.item_desc ?? "").split("\n")[0].replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, ""),
            sku: rr.sku ?? null,
          };
          const ok = await shipInventory(supabase, [item], me.full_name, [input.order_number, rr.return_no].filter(Boolean).join(" · "));
          if (ok) await resyncReserved(supabase);
        }
      }
      // Mark the delivery so we don't retry.
      await supabase.from("deliveries").update({ inventory_shipped: true }).eq("order_id", input.order_id);
    }
  }

  // advance the workshop job to Out for Delivery (lifecycle sync)
  // PARTIAL DELIVERY (2026-09-02): ang mga job na NASA PRODUCTION PA (pending /
  // in progress / for QC - ang batch na hindi kasama sa biyahe) ay HINDI
  // ginagalaw - ang order-wide na stamp noon ay bumubura sa sariwang batch-2
  // job at nawawala ito sa Pending ng workshop. Ang naabot na ng QC/stock ang
  // tanging isinusulong.
  if (input.order_id != null) {
    await supabase.from("workshop_job").update({ status: "Out for Delivery", updated_at: now }).eq("order_id", input.order_id)
      .or("qc_received_at.not.is.null,status.ilike.%qc passed%,status.ilike.%received%,status.ilike.%out for delivery%,status.ilike.%arrived%,status.ilike.%installation%,status.ilike.%delivered%");
  }

  // notify the customer (best-effort) — fetch email + coords from the order
  if (input.order_id != null) {
    const { data: ord } = await supabase.from("orders").select("id, email, customer_name, order_number, address, address_lat, address_lng, date_order, full_payment_price, downpayment_price, full_payment, receipt_items").eq("id", input.order_id).limit(1);
    if (ord?.[0]) await sendOutForDeliveryEmail(ord[0], pin, supabase);
  }

  revalidatePath("/delivery");
  revalidatePath("/workshop/jobs");
  revalidatePath("/installation");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/quality-control");
  revalidatePath("/inventory");
  revalidatePath("/inventory/adjustments");
  revalidatePath("/scan");
  revalidatePath("/stock-movements");
  revalidatePath("/products");
  revalidatePath("/locations");
  revalidatePath("/workshop");
  return { ok: true };
}

// PACKING PROOF: warehouse uploads ≥5 photos that the item was packed correctly.
// Stamps packed_at on the delivery row (creating it if needed). startDelivery is
// hard-blocked until this exists. Photos are public Storage URLs (same pipeline as
// QC + delivery proof). requireEdit-gated, audited.
export async function savePackingProof(input: {
  order_id: number | null; order_number: string | null; customer_name: string | null;
  photos: string[]; packed_by: string | null;
  // LITRATO KADA PRODUKTO (0208), nakahanay sa qa_items ng biyahe. Ang `photos`
  // ay ang pinagsamang kabuuan — iyon pa rin ang hawak ng mga lumang talaan.
  item_photos?: string[][];
}): Promise<{ ok: true; id: number } | { error: string }> {
  await requireEdit("/delivery", "delivery");
  const supabase = createServerSupabase();

  const photos = Array.isArray(input.photos) ? input.photos.filter((u) => typeof u === "string" && u.trim()) : [];

  // KADA PRODUKTO ANG BILANG. Isang bunton kada order ito noon, kaya ang pitong
  // gamit ay maaaring maipadala sa limang litrato ng iisa. Kapag may per-item na
  // listahan, LAHAT ng produkto ay kailangang may lima; kung wala — lumang
  // talaan o hindi pa tumatakbo ang 0208 — ang lumang tuntunin pa rin.
  const per = Array.isArray(input.item_photos)
    ? input.item_photos.map((a) => (Array.isArray(a) ? a.filter((u) => typeof u === "string" && u.trim()) : []))
    : null;
  if (per?.length) {
    const short = per.map((a, i) => ({ i, n: a.length })).filter((x) => x.n < 5);
    if (short.length) {
      return {
        error: short.length === per.length
          ? `Upload at least 5 packing photos for every product (${per.length} product${per.length === 1 ? "" : "s"}).`
          : `Upload at least 5 packing photos for item ${short.map((x) => x.i + 1).join(", ")}.`,
      };
    }
  } else if (photos.length < 5) {
    return { error: `Upload at least 5 packing photos (${photos.length}/5 so far).` };
  }

  const patch: Record<string, unknown> = { packed_at: new Date().toISOString(), packing_photos: photos, packed_by: input.packed_by || null };
  if (per) patch.item_packing_photos = per;

  // Find an existing delivery row for the order; create one if none (so packing can
  // happen before a delivery is otherwise scheduled).
  let id: number | undefined;
  if (input.order_id != null) {
    const { data } = await supabase.from("deliveries").select("id").eq("order_id", input.order_id).limit(1);
    id = data?.[0]?.id;
  }
  // Bago tumakbo ang 0208 ay walang `item_packing_photos`, at ang buong save ay
  // babagsak sa "column does not exist" — mawawalan ng paraan ang nagbabalot na
  // makapagtala. Isang beses itong sinusubukan muli nang wala ang bagong field.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { item_packing_photos: _ipp, ...patchLegacy } = patch;
  const missingCol = (m: string | undefined) => /item_packing_photos/.test(m ?? "");
  if (id) {
    const before = await snapshot("deliveries", id);
    let { error } = await supabase.from("deliveries").update(patch).eq("id", id);
    if (error && missingCol(error.message)) ({ error } = await supabase.from("deliveries").update(patchLegacy).eq("id", id));
    if (error) return { error: error.message };
    await auditAfter({ module: "delivery", table: "deliveries", recordId: id, action: "update", before, snapshotTable: "deliveries", snapshotId: id });
  } else {
    const base = { order_id: input.order_id, order_number: input.order_number || null, customer_name: input.customer_name || null, status: "Packed" };
    let { data, error } = await supabase.from("deliveries").insert({ ...base, ...patch }).select("id").limit(1);
    if (error && missingCol(error.message)) ({ data, error } = await supabase.from("deliveries").insert({ ...base, ...patchLegacy }).select("id").limit(1));
    if (error) return { error: error.message };
    id = data?.[0]?.id;
    if (id) await auditAfter({ module: "delivery", table: "deliveries", recordId: id, action: "insert", snapshotTable: "deliveries", snapshotId: id });
  }
  if (!id) return { error: "Failed to save packing proof." };

  revalidatePath("/delivery");
  revalidatePath("/orders");
  revalidatePath("/installation");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  return { ok: true, id };
}

// Live driver location for the office "View Live Map" poll. Read-only by delivery id.
export async function getDriverLocation(deliveryId: number): Promise<
  { ok: true; lat: number | null; lng: number | null; updatedAt: string | null; status: string | null } | { error: string }
> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("deliveries")
    .select("driver_lat, driver_lng, loc_updated_at, status")
    .eq("id", deliveryId)
    .limit(1);
  if (error) return { error: error.message };
  const r = data?.[0];
  return { ok: true, lat: r?.driver_lat ?? null, lng: r?.driver_lng ?? null, updatedAt: r?.loc_updated_at ?? null, status: r?.status ?? null };
}

export async function deleteDelivery(id: number): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/delivery", "delivery");
  const supabase = createServerSupabase();
  const before = await snapshot("deliveries", id);
  const { error } = await supabase.from("deliveries").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "delivery", table: "deliveries", recordId: id, action: "delete", before });
  revalidatePath("/delivery");
  revalidatePath("/installation");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  return { ok: true };
}
