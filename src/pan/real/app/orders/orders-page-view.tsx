import { lineKey } from "@/lib/orders/line-key";
import { StatCard, PageHeader } from "@/components/ui";
import { peso, number } from "@/lib/format";
import { OrdersTable } from "@/components/orders-table";
import { CreateOrderButton } from "@/components/create-order-button";
import { loadFbContacts } from "@/app/orders/fb-actions";
import { FbSyncButton } from "@/components/fb-sync-button";
import { FbFollowupButton } from "@/components/fb-followup-button";
import { createServerSupabase, type OrderRow, type ProductRow } from "@/lib/supabase/server";
import { DEFAULT_PAYMENT_QR, crcValid } from "@/lib/qrph";
import { mayaConfigured } from "@/lib/maya/client";
import { getSession } from "@/lib/auth/session";
import { rushThresholdFrom } from "@/lib/rush";
import { hasPermission } from "@/lib/auth/permissions";

export const metadata = { title: "Orders — Pan Furniture" };
export const dynamic = "force-dynamic";
// Slip OCR (a server action posted to this route) can take >10s on serverless.
export const maxDuration = 60;

// Made-to-order SKU? Bagong maiksing anyo: PREFIX-XXXXXX (base36 na epoch
// seconds, saklaw ~2017..2100) o ang lumang PREFIX-YYMMDD-HHMMSS. Ang mga ito
// ay walang inventory row (gawa kada order) pero dapat makita sa browser.
function isMadeToOrderSku(sku: string): boolean {
  const m = /-([a-z0-9]{5,8})$/i.exec(sku);
  if (m) {
    const t = parseInt(m[1], 36);
    if (Number.isFinite(t) && t > 1.5e9 && t < 4.1e9) return true;
  }
  // Sequential na anyo: PREFIX-000001 (2-6 char na prefix + 6 digits).
  if (/^[A-Z0-9]{2,6}-\d{6}$/i.test(sku)) return true;
  return /-\d{6}-\d{6}$/.test(sku);
}

// Explicit high ceiling for the client-paginated orders table. Loading the whole
// table to paginate on the client is fine within this bound; past it we surface a
// notice rather than silently dropping rows (Supabase's default cap is 1000).
const ORDERS_CAP = 2000;

export async function OrdersPageView({ silent = false }: { silent?: boolean }) {
  const supabase = createServerSupabase();
  // Maya payments are applied in real time by the registered webhook
  // (/api/maya/webhook), so we do NOT reconcile on every page load anymore —
  // that ran up to 3 blocking passes (dozens of Maya API calls + storage
  // uploads) before the page could render, which made Orders slow to open as
  // the order count grew. The webhook keeps payments current; a manual
  // "Sync payments" path can still call reconcileMayaPayments() on demand.
  const [{ data, error }, { data: prodData }, { data: salesData }, { data: qrSetting }, { data: consData }, { data: delData }, { data: invStock }, { data: wjobData }, { data: instData }, { data: qcData }, { data: skipData }, { data: rushSetting }, { data: editReqData }, { data: reworkData }, { data: shopData }] = await Promise.all([
    // Bounded + ordered so the load is deterministic. Supabase silently caps an
    // unbounded select at 1000 rows; an explicit high limit makes the ceiling
    // clear and lets us flag when it's reached (see `truncated` below).
    // Secondary sort na id DESC para ang magkakaparehong petsa ay nakaayos pa
    // ring pababa (pinakabagong order number sa itaas), hindi random.
    supabase.from("orders").select("*").order("date_order", { ascending: false }).order("id", { ascending: false }).limit(ORDERS_CAP),
    supabase.from("product").select("*").order("product_name"),
    supabase.from("employees").select("name, role").eq("active", true).ilike("role", "%sales%").order("role").order("name"),
    supabase.from("app_settings").select("value").eq("key", "payment_qr").maybeSingle(),
    supabase.from("employees").select("name, role").eq("active", true).ilike("role", "%constructor%").order("role").order("name"),
    supabase.from("deliveries").select("order_id, status, schedule_date, packed_at, started_at, delivered_at, arrived_at"),
    // Reserved / available stock per SKU so the sales team sees real availability when
    // building an order.
    supabase.from("inventory").select("sku, reserved, available, color").limit(10000),
    // Workshop + installation stages → let the Progress Status column show the real
    // pipeline stage (In Workshop / QC / For Delivery …), not just delivery/payment.
    supabase.from("workshop_job").select("order_id, status, qc_received_at, dispatched_at, item_desc, workshop_id").limit(10000),
    supabase.from("installations").select("order_id, status, created_at").limit(10000),
    // Warehouse QC (order source) + skipped lines that go straight to QC when Order
    // Approval / workshop is bypassed — so the progress reflects the QC stage too.
    supabase.from("warehouse_qc").select("ref_id, checkpoint, result").eq("source", "order").limit(10000),
    supabase.from("ops_line_skip").select("order_id").limit(10000),
    // Global rush threshold — fallback ng countdown kapag walang per-order rush_days.
    supabase.from("app_settings").select("value").eq("key", "rush_threshold_days").maybeSingle(),
    // Edit requests — para ipakita sa Request column ang estado (Requested /
    // Approved / Rejected) ng pinakahuling request bawat order.
    supabase.from("order_edit_requests").select("order_id, status, created_at").order("created_at", { ascending: false }).limit(2000),
    // Aktibong REWORK bawat order → ang Progress Status ay "Rework" habang
    // inaayos pa (nag-o-override sa lumang "Delivered").
    supabase.from("returns").select("order_id, return_no, status, reworked_at").eq("resolution", "rework").limit(5000),
    // SAAN GINAWA (2026-08-26) — ang Source na hanay ay bangko (BDO/GCash);
    // ito ang pinaggawaan: pangalan ng workshop, o "Warehouse" (isa rin itong
    // hilera sa parehong table, kaya walang espesyal na kaso).
    supabase.from("workshop").select("id, name").limit(1000),
  ]);

  // QUOTATION + DESIGN images bawat order (2026-08-17): ang FQ at DD na naka-
  // ugnay sa order (order_number) — icon sa table na nagbubukas ng image.
  // Hiwalay sa Promise.all sa itaas para hindi mabago ang mahabang destructure.
  const [{ data: quoteImgData }, { data: designImgData }] = await Promise.all([
    supabase.from("quotations").select("order_number, image_url, id, fq_number").not("order_number", "is", null).order("id", { ascending: false }).limit(2000),
    // LAHAT ng sheets ng order (binago 2026-08-19) — pati Draft/Pending, hindi
    // na Accepted lang: pag same order number, naka-attach agad sa Design
    // column, at LAHAT sila ay pages ng iisang viewer.
    supabase.from("design_details").select("order_number, image_url, id, sku").not("order_number", "is", null).order("id", { ascending: false }).limit(2000),
  ]);
  // LAHAT NG QUOTATION KADA ORDER, hindi lang ang pinakabago (inayos 2026-08-22).
  // Isa lang ang itinatago noon ("pinakabago ang panalo") — tama iyon noong ang
  // isang order ay may iisang quotation. Ngayon, ang isang order ay maaaring
  // dagdagan mula sa ibang request, kaya may dalawa o tatlong FQ ito — at ang
  // mas luma ay tahimik na naitatapon, kaya hindi na mabubuksan mula rito.
  const quoteImages: Record<string, { url: string; fq: string | null }[]> = {};
  for (const q of (quoteImgData ?? []) as { order_number: string | null; image_url: string | null; fq_number: string | null }[]) {
    const k = (q.order_number ?? "").trim();
    if (k && q.image_url) (quoteImages[k] ??= []).push({ url: q.image_url, fq: q.fq_number });
  }
  // ANG DESIGN SHEET AY SA ISANG PRODUKTO, HINDI SA BUONG ORDER (2026-08-26).
  //
  // Ang susi ay dating order_number lang, kaya ang sheet na inilakip sa PAN
  // Sofa V.03 ay lumalabas din sa Sofa V.01, sa Accent Chair, at sa Dining
  // Table ng parehong order — apat na produkto, isang disenyo. Ang design_details
  // ay may sariling sku column at tama ang naka-save doon; ang pagpapakita lang
  // ang hindi sumusunod.
  //
  // Ang susi ngayon ay "ORDER|SKU". Ang lumang hilerang walang sku ay
  // nananatiling naka-lakip sa buong order (walang ganoon sa datos ngayon, pero
  // hindi dapat mawala kung meron).
  const designImages: Record<string, string[]> = {};
  for (const d of (designImgData ?? []) as { order_number: string | null; image_url: string | null; sku: string | null }[]) {
    const ord = (d.order_number ?? "").trim();
    if (!ord || !d.image_url) continue;
    const sku = (d.sku ?? "").trim();
    (designImages[sku ? `${ord}|${sku.toUpperCase()}` : ord] ??= []).push(d.image_url);
  }

  const orders = (data ?? []) as OrderRow[];
  // PARTIAL DELIVERY na hanay (2026-09-02): hatiin ang mga koleksyon — ang bayad
  // ng mga partial na biyahe ay hiwalay sa huling bayad. Batayan ang
  // order_payments ledger ng mga order na may partial history (status "Partial
  // Delivery", o may naitala nang higit sa isang batch): ang 'balance' na bayad
  // na HINDI nakatapos sa kabuuan ay koleksyon ng partial na biyahe; ang bayad
  // na umabot sa kabuuan ang Full Payment. Best-effort: walang ledger/0200 →
  // walang hati, dating asal.
  try {
    const pids = orders.map((o) => o.id);
    if (pids.length) {
      const [{ data: pld }, { data: pays }] = await Promise.all([
        supabase.from("order_line_deliveries").select("order_id, batch_no, item_desc").in("order_id", pids).limit(20000),
        supabase.from("order_payments").select("order_id, amount, kind, created_at").in("order_id", pids).order("created_at").limit(20000),
      ]);
      const multi = new Set<number>();
      const maxB = new Map<number, number>();
      // Mga naihatid nang linya bawat order (susi = unang linya, lowercase) —
      // ipinapasa sa Edit Order modal para lagyan ng DELIVERED tag ang item.
      const dlvKeys = new Map<number, string[]>();
      for (const r of (pld ?? []) as { order_id: number | null; batch_no: number | null; item_desc?: string | null }[]) {
        if (r.order_id == null) continue;
        maxB.set(r.order_id, Math.max(maxB.get(r.order_id) ?? 0, Number(r.batch_no) || 0));
        const k = lineKey(r.item_desc); // "pangalan @ kulay" (2026-09-06)
        if (k) dlvKeys.set(r.order_id, [...(dlvKeys.get(r.order_id) ?? []), k]);
      }
      for (const o of orders) {
        const ks = dlvKeys.get(o.id);
        if (ks?.length) (o as OrderRow & { delivered_line_keys?: string[] }).delivered_line_keys = [...new Set(ks)];
      }
      for (const [oid, b] of maxB) if (b > 1) multi.add(oid);
      for (const o of orders) if (/partial delivery/i.test(o.status ?? "")) multi.add(o.id);
      const payByOrder = new Map<number, { amount: number; kind: string | null; created_at: string | null }[]>();
      for (const p of (pays ?? []) as { order_id: number | null; amount: number | null; kind: string | null; created_at: string | null }[]) {
        if (p.order_id == null || !multi.has(p.order_id)) continue;
        (payByOrder.get(p.order_id) ?? payByOrder.set(p.order_id, []).get(p.order_id)!).push({ amount: Number(p.amount) || 0, kind: p.kind, created_at: p.created_at });
      }
      for (const o of orders) {
        const list = payByOrder.get(o.id);
        if (!list?.length) continue;
        const total = Number(o.full_payment_price) || 0;
        let running = 0, partial = 0;
        let pdate: string | null = null;
        for (const p of list) {
          if ((p.kind ?? "").toLowerCase() === "downpayment") { running += p.amount; continue; }
          const after = running + p.amount;
          if (total > 0 && after < total - 0.005) { partial += p.amount; pdate = p.created_at ?? pdate; }
          running = after;
        }
        const ox = o as OrderRow & { partial_delivery_paid?: number; partial_delivery_date?: string | null };
        ox.partial_delivery_paid = Math.round(partial * 100) / 100;
        ox.partial_delivery_date = pdate;
      }
    }
  } catch { /* wala pang order_line_deliveries/ledger — walang hati */ }
  // Pinakahuling edit-request status bawat order (desc na ang created_at, kaya
  // unang tama ang panalo).
  const editRequests: Record<number, "pending" | "approved" | "rejected"> = {};
  for (const r of (editReqData ?? []) as { order_id: number; status: string }[]) {
    if (!(r.order_id in editRequests) && (r.status === "pending" || r.status === "approved" || r.status === "rejected")) {
      editRequests[r.order_id] = r.status;
    }
  }
  // True when we hit the cap — the table may not be showing the full history.
  const truncated = orders.length >= ORDERS_CAP;
  // PROGRESS STATUS per order — the real pipeline stage, resolved from the furthest
  // stage each order has reached (later stages win over earlier ones):
  //   Delivered/Installation/Arrived/Out for Delivery (deliveries) >
  //   Installation Completed (installations) >
  //   For Delivery (workshop QC passed / received) >
  //   In Workshop (has a workshop job) >
  //   Confirmed (order exists, downpayment met — falls back to order.status).
  const delByOrder = new Map<number, { status: string | null; scheduled: boolean; packed: boolean }>();
  // When did the order actually leave for delivery? Prefer the "started" (out-for-delivery)
  // stamp, else the arrival/delivered stamp — whichever marks the delivery run beginning.
  const delDateByOrder = new Map<number, string>();
  for (const d of (delData ?? []) as { order_id: number | null; status: string | null; schedule_date: string | null; packed_at: string | null; started_at: string | null; delivered_at: string | null; arrived_at: string | null }[]) {
    if (d.order_id == null) continue;
    delByOrder.set(d.order_id, { status: d.status, scheduled: !!d.schedule_date, packed: !!d.packed_at });
    const outAt = d.started_at ?? d.arrived_at ?? d.delivered_at;
    if (outAt) delDateByOrder.set(d.order_id, outAt);
  }
  const instByOrder = new Map<number, string>();
  // When did the order enter Installation? Use the installation row's creation stamp.
  const instDateByOrder = new Map<number, string>();
  for (const i of (instData ?? []) as { order_id: number | null; status: string | null; created_at: string | null }[]) {
    if (i.order_id == null) continue;
    if (i.status) instByOrder.set(i.order_id, i.status);
    if (i.created_at) instDateByOrder.set(i.order_id, i.created_at);
  }
  const wjobByOrder = new Map<number, { status: string | null; qcReceived: boolean }>();
  // When was the order first dispatched to a workshop? Keep the earliest dispatch stamp.
  const wjobDateByOrder = new Map<number, string>();
  for (const j of (wjobData ?? []) as { order_id: number | null; status: string | null; qc_received_at: string | null; dispatched_at: string | null }[]) {
    if (j.order_id == null) continue;
    const prev = wjobByOrder.get(j.order_id);
    const qcReceived = !!j.qc_received_at || /qc passed|received/i.test(j.status ?? "");
    // Keep the furthest-along job for the order (QC-passed beats an earlier stage).
    if (!prev || (qcReceived && !prev.qcReceived)) wjobByOrder.set(j.order_id, { status: j.status ?? null, qcReceived });
    if (j.dispatched_at) {
      const cur = wjobDateByOrder.get(j.order_id);
      if (!cur || j.dispatched_at < cur) wjobDateByOrder.set(j.order_id, j.dispatched_at);
    }
  }
  // Warehouse QC by order: is there any QC row at all, and did the pre-pack pass?
  const qcByOrder = new Map<number, { any: boolean; prepackPassed: boolean }>();
  for (const q of (qcData ?? []) as { ref_id: number | null; checkpoint: string | null; result: string | null }[]) {
    if (q.ref_id == null) continue;
    const prev = qcByOrder.get(q.ref_id) ?? { any: false, prepackPassed: false };
    prev.any = true;
    if (q.checkpoint === "prepack" && q.result === "pass") prev.prepackPassed = true;
    qcByOrder.set(q.ref_id, prev);
  }
  // Lines whose Order Approval / workshop step was skipped → they go straight to QC.
  const skippedOrders = new Set<number>();
  for (const s of (skipData ?? []) as { order_id: number | null }[]) if (s.order_id != null) skippedOrders.add(s.order_id);

  // Orders with an ACTIVE rework (approved, not yet completed) — Progress shows
  // "Rework" while the repair is ongoing, then WALKS THE DELIVERY STAGES AGAIN
  // as the redelivery moves (Scheduled → Out for Delivery → … → Redelivered).
  const reworkOrders = new Set<number>();
  const reworkRepairDone = new Set<number>();
  // PERSISTENT na Rework tag bawat order (kahit tapos na) — RMA number ang laman.
  const reworkTags: Record<number, string | null> = {};
  for (const r of (reworkData ?? []) as { order_id: number | null; return_no?: string | null; status: string | null; reworked_at?: string | null }[]) {
    if (r.order_id == null) continue;
    if (!/reject|pending/i.test(r.status ?? "")) reworkTags[r.order_id] = r.return_no ?? null;
    if (/rework/i.test(r.status ?? "")) reworkOrders.add(r.order_id);
    if (r.reworked_at || /completed/i.test(r.status ?? "")) reworkRepairDone.add(r.order_id);
  }
  // Repair is ALSO done once the rework JOB itself passed QC / got received —
  // covers rows where the return hasn't been closed yet.
  for (const j of (wjobData ?? []) as { order_id: number | null; status: string | null; qc_received_at: string | null; item_desc?: string | null }[]) {
    if (j.order_id == null || !/^\s*rework\s*·/i.test(j.item_desc ?? "")) continue;
    if (j.qc_received_at || /qc passed|received/i.test(j.status ?? "")) reworkRepairDone.add(j.order_id);
  }

  // SAAN GINAWA — pangalan ng pinaggawaang workshop kada order. Ang
  // "Warehouse" ay isa ring hilera sa workshop table, kaya iisang lookup lang.
  const shopName = new Map<number, string>();
  for (const w of (shopData ?? []) as { id: number; name: string | null }[]) {
    if (w.name) shopName.set(w.id, w.name);
  }
  const builtAt: Record<number, string> = {};
  for (const j of (wjobData ?? []) as { order_id: number | null; workshop_id: number | null }[]) {
    if (j.order_id == null || j.workshop_id == null) continue;
    const n = shopName.get(j.workshop_id);
    // Ang pinakauna ang panalo — doon ito ginawa; ang muling pagpasok
    // (rework) ay hindi nagbabago niyon.
    if (n && !builtAt[j.order_id]) builtAt[j.order_id] = n;
  }
  // Ang SKIP sa Order Approval = galing sa stock ng bodega — Warehouse ang
  // Source. Ang order na WALA PA sa alinman (hindi pa dumadaan sa approval)
  // ay walang entry — gitling ang ipapakita, hindi maagang "Warehouse".
  //
  // PANSAMANTALA ang ops_line_skip (binubura ito ng prepack QC pass para sa
  // badge count), kaya kasama rin ang warehouse_qc source='order' — iyon ang
  // hindi nabuburang bakas ng dinaanang skip-to-warehouse.
  for (const id of skippedOrders) if (!builtAt[id]) builtAt[id] = "Warehouse";
  for (const q of (qcData ?? []) as { ref_id: number | null }[]) {
    if (q.ref_id != null && !builtAt[q.ref_id]) builtAt[q.ref_id] = "Warehouse";
  }

  const deliveryStatus: Record<number, string> = {};
  for (const o of orders) {
    const del = delByOrder.get(o.id);
    const ds = del?.status ?? "";
    // Aktibong rework: habang inaayos → "Rework"; pag tapos ang repair, ang
    // redelivery ang sinusundan ng status hanggang "Redelivered".
    if (reworkOrders.has(o.id)) {
      if (!reworkRepairDone.has(o.id)) { deliveryStatus[o.id] = "Rework"; continue; }
      if (/delivered/i.test(ds)) { deliveryStatus[o.id] = "Redelivered"; continue; }
      if (/installation/i.test(ds)) { deliveryStatus[o.id] = "Installation"; continue; }
      if (/arrived/i.test(ds)) { deliveryStatus[o.id] = "Arrived"; continue; }
      if (/out for delivery/i.test(ds)) { deliveryStatus[o.id] = "Out for Delivery"; continue; }
      if (del?.packed) { deliveryStatus[o.id] = "Packed"; continue; }
      if (del?.scheduled || /scheduled/i.test(ds)) { deliveryStatus[o.id] = "Scheduled"; continue; }
      deliveryStatus[o.id] = "Rework"; continue;
    }
    // Furthest delivery lifecycle first (out/arrived/installation/delivered), then the
    // pre-dispatch delivery sub-stages so the board's Packing/Schedule steps show here too.
    if (/delivered/i.test(ds)) { deliveryStatus[o.id] = "Delivered"; continue; }
    if (/installation/i.test(ds)) { deliveryStatus[o.id] = "Installation"; continue; }
    if (/arrived/i.test(ds)) { deliveryStatus[o.id] = "Arrived"; continue; }
    if (/out for delivery/i.test(ds)) { deliveryStatus[o.id] = "Out for Delivery"; continue; }
    const inst = instByOrder.get(o.id);
    if (inst && /completed/i.test(inst)) { deliveryStatus[o.id] = "Delivered"; continue; }
    // In the delivery module but not dispatched yet: packed = ready, else scheduled.
    if (del?.packed) { deliveryStatus[o.id] = "Packed"; continue; }
    // Delivery-confirmation stages (Delivery Queue): Reminded > Scheduled >
    // Booked > Awaiting Confirm — kapareho ng Process Mapping Tracker.
    const dqs = (o as { dq_status?: string | null }).dq_status ?? null;
    const dqRem = !!(o as { dq_reminder_sent_at?: string | null }).dq_reminder_sent_at;
    if (dqs === "confirmed" && dqRem) { deliveryStatus[o.id] = "Reminded"; continue; }
    if (del?.scheduled || /scheduled/i.test(ds)) { deliveryStatus[o.id] = "Scheduled"; continue; }
    if (dqs === "confirmed") { deliveryStatus[o.id] = "Booked"; continue; }
    if (dqs === "pending") { deliveryStatus[o.id] = "Awaiting Confirm"; continue; }
    const qc = qcByOrder.get(o.id);
    const wj = wjobByOrder.get(o.id);
    // Pre-pack QC passed OR the workshop marked it received/QC-passed → ready to deliver.
    if (qc?.prepackPassed || wj?.qcReceived) { deliveryStatus[o.id] = "For Scheduling"; continue; }
    // A QC row exists (in inspection) OR the line skipped straight to QC → Quality Control.
    if (qc?.any || skippedOrders.has(o.id)) { deliveryStatus[o.id] = "Quality Control"; continue; }
    if (wj) { deliveryStatus[o.id] = "In Workshop"; continue; }
    // A bare delivery row (no schedule/pack yet) still means it reached delivery.
    if (del) { deliveryStatus[o.id] = "For Scheduling"; continue; }
    // No pipeline row yet → leave unset; the table falls back to the order's own status.
  }
  // Actual stage timestamps for the Schedule columns: when the order was dispatched to
  // the workshop, when it left for delivery, and when it entered installation.
  const stageDates: Record<number, { workshop: string | null; delivery: string | null; installation: string | null }> = {};
  for (const o of orders) {
    stageDates[o.id] = {
      workshop: wjobDateByOrder.get(o.id) ?? null,
      delivery: delDateByOrder.get(o.id) ?? null,
      installation: instDateByOrder.get(o.id) ?? null,
    };
  }
  const allProducts = (prodData ?? []) as ProductRow[];
  // Aggregate reserved/available per SKU (an item can have multiple inventory rows).
  const stockBySku: Record<string, { reserved: number; available: number }> = {};
  const inventorySkus = new Set<string>();
  for (const r of (invStock ?? []) as { sku: string | null; reserved: number | null; available: number | null; color?: string | null }[]) {
    const k = (r.sku ?? "").trim().toLowerCase();
    if (!k) continue;
    inventorySkus.add(k);
    const s = stockBySku[k] ?? { reserved: 0, available: 0 };
    s.reserved += Number(r.reserved) || 0;
    s.available += Number(r.available) || 0;
    stockBySku[k] = s;
    // INVENTORY KADA KULAY (0232): "sku|kulay" na key para sa napiling tela
    // sa Create Order - iba-iba ang bilang kada kulay.
    const ck = String(r.color ?? "").trim().toLowerCase();
    if (ck) {
      const c = stockBySku[`${k}|${ck}`] ?? { reserved: 0, available: 0 };
      c.reserved += Number(r.reserved) || 0;
      c.available += Number(r.available) || 0;
      stockBySku[`${k}|${ck}`] = c;
    }
  }
  // Only offer products that actually exist in Inventory Management (have an inventory
  // row / stock record). Catalog-only products with no inventory can't be ordered.
  // EXCEPTION (2026-08-17): ang mga CUSTOM- (made-to-order) ay walang inventory
  // row dahil ginagawa kada order — dapat pa ring lumabas sa product browser
  // (Customized/Promo category) para magamit muli.
  const products = allProducts.filter((p) =>
    inventorySkus.has((p.sku ?? "").trim().toLowerCase())
    || isMadeToOrderSku((p.sku ?? "").trim()));
  const assignees = (salesData ?? []).map((e) => ({ name: e.name as string, role: (e.role as string) ?? "" })).filter((e) => e.name);
  const constructors = (consData ?? []).map((e) => ({ name: e.name as string, role: (e.role as string) ?? "" })).filter((e) => e.name);
  const savedQr = (qrSetting?.value as { payload?: string } | null)?.payload ?? "";
  // Use the saved QR only if its CRC checks out; otherwise fall back to default.
  const paymentQr = savedQr && crcValid(savedQr) ? savedQr : DEFAULT_PAYMENT_QR;
  const mayaEnabled = mayaConfigured();

  // Next order number from the highest numeric suffix seen.
  const maxNum = orders.reduce((m, o) => {
    const match = (o.order_number ?? "").match(/(\d+)/);
    return Math.max(m, match ? parseInt(match[1], 10) : 0);
  }, 0);
  const nextOrderNumber = `ORD-${String(maxNum + 1).padStart(6, "0")}`;

  // FB customer suggestions for Create Order's type-to-search picker. Two sources,
  // merged + de-duped by lower-cased name (FB inbox contacts win — they carry the live
  // Messenger thread link):
  //   1) fb_contacts — EVERY customer who messaged the Page (synced from Meta + webhook)
  //   2) past orders that already have an FB name (covers pre-sync history)
  const fbFromInbox = await loadFbContacts();
  // Dala ang psid: pag pinili ng staff ang contact na ito sa Create Order,
  // naitatali agad ang Messenger thread ng customer sa order — kaya ang PAID at
  // order updates ay awtomatikong maipapadala sa kanila.
  const fbByName = new Map<string, { name: string; link: string | null; pic: string | null; psid: string | null; thread: string | null; lastMsg: string | null }>();
  for (const c of fbFromInbox) {
    fbByName.set(c.name.toLowerCase(), { name: c.name, link: c.link, pic: c.pic, psid: c.psid ?? null, thread: c.thread, lastMsg: c.lastMsg });
  }
  for (const o of orders) {
    const name = (o.fb_name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (fbByName.has(key)) continue; // inbox entry already has a better (live) link
    fbByName.set(key, { name, link: (o.fb_link ?? "").trim() || null, pic: null, psid: null, thread: null, lastMsg: null });
  }
  const fbContacts = [...fbByName.values()];

  // Workshop Date is an Operations concern: only users who can edit Order Approval
  // (Operations Manager / admin) see + edit it. Sales staff see Delivery Date only.
  const me = await getSession();
  const canEditWorkshop = !!me && hasPermission(me, "ops_approval", "edit");
  // A pure Sales role (can't approve orders) may edit an order only until it's
  // confirmed; once confirmed the fields go read-only for them. Admin/Ops keep editing.
  const isSalesOnly = !!me && me.role === "sales_staff";

  const completed = orders.filter((o) => /complete/i.test(o.status ?? "")).length;
  const forDelivery = orders.filter((o) => /deliver/i.test(o.status ?? "")).length;
  const revenue = orders
    .filter((o) => /complete/i.test(o.status ?? ""))
    .reduce((s, o) => s + Number(o.full_payment_price ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Orders"
        subtitle={
          error
            ? "Failed to load from Supabase"
            : truncated
              ? `Showing latest ${orders.length} orders · live from public.orders`
              : `${orders.length} orders · live from public.orders`
        }
        action={
          <div className="flex items-center gap-2">
            <FbFollowupButton />
            <FbSyncButton />
            <CreateOrderButton nextOrderNumber={nextOrderNumber} products={products} stockBySku={stockBySku} assignees={assignees} constructors={constructors} fbContacts={fbContacts} canEditWorkshop={canEditWorkshop} silent={silent} />
          </div>
        }
      />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          <p className="font-semibold">Supabase error</p>
          <p className="mt-1 font-mono text-xs">{error.message}</p>
        </div>
      ) : (
        <>
          {/* Mga stat card — nakatago sa loob ng APK (ang stat-card class +
              data-apk ang bahala); lumalabas sa web/desktop. */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total Orders" value={number(orders.length)} />
            <StatCard label="For Delivery" value={number(forDelivery)} tone="info" />
            <StatCard label="Completed" value={number(completed)} tone="success" />
            <StatCard label="Completed Revenue" value={peso(revenue)} />
          </div>

          <OrdersTable rows={orders} products={allProducts} paymentQr={paymentQr} mayaEnabled={mayaEnabled} assignees={assignees} constructors={constructors} deliveryStatus={deliveryStatus} builtAt={builtAt} stageDates={stageDates} canEditWorkshop={canEditWorkshop} isSalesOnly={isSalesOnly} rushThreshold={rushThresholdFrom(rushSetting?.value)} editRequests={editRequests} reworkTags={reworkTags} silent={silent} quoteImages={quoteImages} designImages={designImages} collectorName={me?.full_name?.trim() || me?.email || ""} />
        </>
      )}
    </div>
  );
}
