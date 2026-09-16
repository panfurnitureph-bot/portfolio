import { createServerSupabase, type OrderRow } from "@/lib/supabase/server";
import { lineKey, keySet, hasKey } from "@/lib/orders/line-key";
import { rushThresholdFrom } from "@/lib/rush";
import { isShippingDesc } from "@/lib/shipping";
import { descSpecLines, parseDescSpecs, splitDimension } from "@/lib/receipt-desc";
import { isReworkLine, type ReworkRef } from "@/lib/orders/rework-match";
import { makeColorPhoto } from "@/lib/ops/product-variants";

export type DeliveryQaItem = {
  id: number | null;
  description: string | null;
  image_url: string | null;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  frame?: string | null;  // frame parts / add-ons (W · Hdbrd · L · Base · Legs) — display only
  // Ang build lines pagkatapos ng pangalan (derived sa load, hindi naka-save) -
  // dala sa Product Details; ang `description` ay pangalan lang para sa table.
  specs?: string | null;
  qty: number;
  good_qty: number;
  defect_qty: number;
  photo_url: string | null;
  checked_by: string | null;
  remarks: string | null;
};

export type Delivery = {
  // PARTIAL DELIVERY (2026-09-01): ilan ang sakay ng biyaheng ito sa kabuuang
  // linya ng order — null kapag buong order ang biyahe. Ang balance_due sa
  // partial ay ang SINGIL NG BATCH (items + shipping sa unang biyahe - bayad),
  // hindi ang buong balanse ng order.
  partial_batch: { thisCount: number; totalCount: number } | null;
  id: number | null;          // delivery record id (null until first save)
  order_id: number | null;
  // REWORK run (pickup o redelivery ng inaayos na item) — tag sa route/schedule.
  is_rework?: boolean;
  rma_no?: string | null;
  // "onsite" | "pullout". Ang ON-SITE ay pagkumpuni sa BAHAY ng customer: isang
  // biyahe pa rin — kailangang i-Waze ang address — pero walang gamit na kinukuha
  // o inihahatid. May sariling ruta ito bawat team (2026-08-28), kaya kailangang
  // mapaghiwalay: `pullout` at normal na hatid ay nasa Delivery Route, `onsite`
  // ay nasa Rework (On-Site).
  rework_mode?: string | null;
  // ALING BIYAHE (2026-08-28). Ang pull-out ay DALAWA: ang pagkuha sa customer,
  // at ang pagbalik pagkatapos kumpunihin. Magkaiba ang gagawin ng driver sa
  // dalawa, kaya kailangang masabi ng tag sa Route Planner kung alin ito.
  //   "pickup"    — kukunin pa lang ang sirang gamit
  //   "redeliver" — ibinabalik na ang naayos
  //   "onsite"    — pagkumpuni sa bahay, walang dala
  rework_leg?: "pickup" | "redeliver" | "onsite" | null;
  // 0217: ang suot ng chip kapag iba sa leg — dineklarang on-site na kinukuha pa.
  rework_wear?: "onsite" | null;
  // NANDOON NA ANG TEAM nang mag-declare (0209): ang pagkuha ay hindi dumaan
  // sa Route Planner — nakaparada ang trak sa harap ng bahay, at wala nang
  // iruruta. Ang planner ay hindi dapat magpakita ng hinto na hindi naman
  // niya inaayos.
  rework_pickup_onsite?: boolean;
  order_number: string | null;
  customer_name: string | null;
  contact: string | null;
  // Alternative contact (0224): pangalawang tao na tatawagan kapag hindi
  // sumasagot ang customer — ipinapakita sa driver map.
  alt_contact: string | null;
  alt_relation: string | null;
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
  // Driver arrival proof captured in the live map (signature + on-site photos).
  signature_url: string | null;
  proof_photos: string[] | null;
  delivered_at: string | null;
  status: string;
  notes: string | null;
  // live tracking
  address_lat: number | null;
  address_lng: number | null;
  landmark: string | null;
  driver_lat: number | null;
  driver_lng: number | null;
  loc_updated_at: string | null;
  started_at: string | null;
  arrived_at: string | null;
  pin: string | null;
  // packing proof (must exist before dispatch)
  packed: boolean;
  // Nakuha na ba sa istante o sa workshop (0186). Ang packing ay tungkol sa
  // paghahanda; ito ay tungkol sa pag-alis — at ito ang huling harang bago
  // makatulak ang trak.
  pickedUp: boolean;
  packed_at: string | null;
  packed_by: string | null;
  packing_photos: string[];
  // Litrato ng pagbabalot KADA PRODUKTO (0208), nakahanay sa qa_items. Ang
  // `packing_photos` ay ang buong bilang ng biyahe.
  item_packing_photos: string[][];
  qa_items: DeliveryQaItem[];
  // Direct-pickup orders: the workshop to collect from (null for warehouse/delivery).
  pickup_location: string | null;
  // Rush tag (set in Order Approval) — shown as a countdown badge here.
  is_rush: boolean;
  rush_days: number | null;
  date_order: string | null;
  // Delivery-queue snapshot (Route Planner): booked date/team/driver/window + stop order.
  dq_status: string | null;
  dq_date: string | null;
  dq_team: string | null;
  dq_driver: string | null;
  dq_window: string | null;
  dq_confirmed_at: string | null;
  dq_stop: number | null;
  auto_window?: string | null; // computed AUTO window (posisyon sa team+date run)
  dq_final: boolean;
};

export type TeamMeta = { name: string; driver: string | null; vehicle: string | null; capacity: number; reserved: boolean };

export type DeliveryData = {
  rows: Delivery[];
  kpi: { toSched: number; qaPassed: number; outForDelivery: number; delivered: number; codDue: number };
  rushThreshold: number;
  teams: TeamMeta[];
  // ANG HULING GINAMIT NA COORDINATOR (2026-08-28). Walang kawing ito sa team —
  // isang tao lang ang nag-aayos ng buong araw — kaya ang huling naitala ang
  // pinakamalapit sa totoo. Panimulang halaga lang: mapapalitan ito.
  lastCoordinator: string | null;
};

// Optional dq_* column reader (string) — the columns arrive across migrations
// 0138/0140/0144, so read defensively instead of typing them on OrderRow.
function dq(o: OrderRow, key: string): string | null {
  const v = (o as Record<string, unknown>)[key];
  return v == null ? null : String(v);
}

function summarize(o: OrderRow): string {
  const items = (o.receipt_items ?? []).filter((it) => !isShippingDesc(it.description));
  if (items.length) return items.map((it) => `${it.qty}× ${(it.description ?? "").split("\n")[0]}`).join(", ");
  return o.product_name ?? "";
}

// Auto-list every committed Sales Order (not Pending/Cancelled) as a delivery row,
// overlaying any existing delivery record for schedule / QA / COD / status.
// ANG HANAY NG DELIVERIES, NA MAY PANGHALILI (2026-08-28). Ang `return_id`
// (0205) ay manual na migration — kapag hindi pa ito tumatakbo, ang buong query
// ay bumabagsak sa 42703 at wala nang lumalabas: Delivery Tracker, Route Planner
// at bawat ruta ng driver. Isang opsyonal na hanay ay hindi dapat magpatumba ng
// buong module, kaya sinusubukan muna ito at umuurong kung wala pa.
const DEL_COLS = "id, order_id, contact, address, schedule_date, time_window, driver_team, coordinator, vehicle_plate, qa_status, qa_by, payment_collected, payment_method, collected_by, received_by, proof_url, signature_url, proof_photos, delivered_at, status, notes, driver_lat, driver_lng, loc_updated_at, started_at, arrived_at, pin, packed_at, packed_by, packing_photos, pickup_at, created_at";

// Dalawa na ang opsyonal na hanay — `return_id` (0205) at
// `item_packing_photos` (0208) — kaya hagdanan ito: subukan ang pareho, saka
// ang isa, saka wala. Ang mawawala sa isang hakbang ay isang tampok; ang
// bumabagsak na query ay ang buong module.
// Ang hugis ng isang deliveries row bilang binabasa rito. Nakasulat nang kamay
// dahil dynamic ang column list — ang dynamic na string ay nag-aalis ng
// inference sa Supabase client. Ang mga opsyonal ay iyong dala ng migration na
// maaaring hindi pa tumatakbo.
type DelRow = Record<string, unknown> & {
  id: number;
  order_id: number | null;
  return_id?: number | null;
  item_packing_photos?: unknown;
};

async function loadDeliveryRows(db: ReturnType<typeof createServerSupabase>) {
  const q = (cols: string) => db.from("deliveries").select(cols)
    .order("created_at", { ascending: false }).limit(10000);
  for (const cols of [`${DEL_COLS}, return_id, item_packing_photos`, `${DEL_COLS}, return_id`, DEL_COLS]) {
    const r = await q(cols);
    if (!r.error) return { data: r.data as unknown as DelRow[] | null };
  }
  return { data: (await q(DEL_COLS)).data as unknown as DelRow[] | null };
}

export async function loadDeliveries(): Promise<DeliveryData> {
  const supabase = createServerSupabase();
  // Litrato ayon sa kulay ng item (color_variants) — lib/ops/product-variants.
  const photo = await makeColorPhoto(supabase);
  const [{ data: dels }, { data: qa }, { data: orders }, { data: products }, { data: insts }, { data: wjobs }, { data: wsRows }, { data: rushSetting }, { data: teamRows }, { data: reworkRets }, { data: pickupRows }] = await Promise.all([
    loadDeliveryRows(supabase),
    supabase.from("delivery_qa_items").select("id, delivery_id, description, image_url, sku, category, color, dimension, qty, good_qty, defect_qty, photo_url, checked_by, remarks, sort").order("sort").limit(10000),
    supabase.from("orders").select("*").order("date_order", { ascending: false }).order("id", { ascending: false }).limit(10000),
    supabase.from("product").select("product_name, sku, category, color, dimension, image_url").limit(10000),
    supabase.from("installations").select("order_id, status").limit(10000),
    supabase.from("workshop_job").select("id, order_id, status, fulfillment, qc_received_at, workshop_id, item_desc").limit(10000),
    supabase.from("workshop").select("id, name").limit(10000),
    supabase.from("app_settings").select("value").eq("key", "rush_threshold_days").maybeSingle(),
    supabase.from("delivery_teams").select("name, driver, vehicle, capacity, reserved").eq("active", true).order("name").limit(50),
    // Ang `rework_pickup_onsite` (0209) ay hinihingi nang may pambalik: kapag
    // hindi pa tumatakbo ang migration, ang buong query ay babagsak at
    // mawawala ang lahat ng rework tag sa Delivery Tracker at sa mga ruta.
    (async () => {
      const cols = "id, order_id, return_no, status, reworked_at, rework_charge_total, rework_downpayment, rework_mode, item_desc, sku, color";
      // Kasama ang REFUND pull-out (2026-09-01): ang pickup trip nito ay
      // biyahe rin ng team — kailangan ng rework wear/tag sa planner at route.
      const q = (c: string) => supabase.from("returns").select(c).in("resolution", ["rework", "refund"]).order("id", { ascending: false }).limit(5000);
      const r1 = await q(`${cols}, rework_pickup_onsite, rework_declared_onsite`);
      const r = r1.error ? await q(`${cols}, rework_pickup_onsite`) : r1;
      const out = r.error ? await q(cols) : r;
      return { data: out.data as unknown as Record<string, unknown>[] | null };
    })(),
    // ANG PICKUP ANG GATE (0185). Ang isang bagay na hindi pa nakukuha sa
    // workshop ay hindi maaaring nasa ruta — kung hindi, nakaruta ito bago pa
    // umalis sa pinaggawaan.
    supabase.from("qc_declarations").select("job_id, pickup_at").eq("status", "Approved").not("job_id", "is", null).limit(5000),
  ]);

  // Live driver GPS mula sa driver_positions (0149 — poll-only, hiwalay sa
  // deliveries para walang realtime storm). Best-effort: wala pa ang table
  // bago ang migration → walang overlay, legacy columns ang gamit.
  const posByOrder = new Map<string, { lat: number; lng: number; at: string | null }>();
  try {
    const { data: posRows } = await supabase.from("driver_positions").select("order_number, lat, lng, updated_at").limit(10000);
    for (const p of (posRows ?? []) as { order_number: string | null; lat: number; lng: number; updated_at: string | null }[]) {
      if (p.order_number) posByOrder.set(p.order_number, { lat: p.lat, lng: p.lng, at: p.updated_at ?? null });
    }
  } catch { /* optional table pa (0149) */ }

  // SAAN KUKUNIN ANG BAGAY. Dating ang direct-pickup lang ang may sagot dito,
  // kaya blangko ang halos bawat hilera — gayong may kukunan naman ang lahat:
  //   • fulfillment 'pickup'    → sa workshop, hindi dumadaan sa bodega
  //   • fulfillment 'warehouse' → sa BODEGA, matapos ang Receiving QC
  //   • walang workshop job     → sa bodega rin; nasa stock na nang mabili
  // Ang driver ay may pupuntahan sa tatlo; ang hanay ang dapat magsabi kung saan.
  const wsNameById = new Map<number, string>();
  for (const w of (wsRows ?? []) as { id: number; name: string | null }[]) wsNameById.set(w.id, w.name ?? `Workshop #${w.id}`);
  const pickupByOrder = new Map<number, string>(); // order_id → kukunan
  for (const j of (wjobs ?? []) as { order_id: number | null; fulfillment: string | null; workshop_id: number | null }[]) {
    if (j.order_id == null) continue;
    if (j.fulfillment === "pickup" && j.workshop_id != null) {
      pickupByOrder.set(j.order_id, wsNameById.get(j.workshop_id) ?? `Workshop #${j.workshop_id}`);
    } else if (!pickupByOrder.has(j.order_id)) {
      pickupByOrder.set(j.order_id, "Warehouse");
    }
  }

  // Orders eligible for delivery scheduling. A workshop job becomes schedulable when:
  //   • Direct Pickup (fulfillment 'pickup') → as soon as it's QC Passed (skips warehouse), OR
  //   • To Warehouse (fulfillment 'warehouse') → only AFTER it's received into stock
  //     via warehouse Receiving QC (qc_received_at stamped / status "Received").
  //
  // ANG PICKUP ANG GATE (0185). Ang direct-pickup na job ay nasa workshop pa
  // hanggang may kumuha nito; ang pagpasa sa QC ay hindi paglabas doon. Ang
  // pagkuha ang nagsasabing nasa trak na ito.
  //
  // Kailangan itong BUO: kapag ang isang order ay may dalawang item at isa lang
  // ang nakuha, sarado pa rin ang order — kung hindi, hahatid ang driver ng
  // kalahating order. Ang isang job na WALANG declaration ay hindi humaharang:
  // ang mga naunang order ay walang naitalang pickup, at hindi sila dapat
  // maipit ng panuntunang wala pa noong idineklara sila.
  const pickedByJob = new Map<number, boolean>();
  for (const p of (pickupRows ?? []) as { job_id: number | null; pickup_at: string | null }[]) {
    if (p.job_id == null) continue;
    // Kapag maraming declaration sa iisang job (rework), sapat na ang isang
    // nakuha.
    pickedByJob.set(p.job_id, (pickedByJob.get(p.job_id) ?? false) || !!p.pickup_at);
  }

  // PARTIAL DELIVERY (0200): kapag may dq_items ang order, ang BATCH lang ang
  // biyaheng ito — ang mga item ng susunod na batch ay hindi dapat humarang sa
  // ruta (hindi sila susunduin ngayon, mamaya pa).
  // KASAMA ANG KULAY (2026-09-06, lib/orders/line-key): "pangalan @ kulay" ang
  // susi ng batch/naihatid; ang lumang susi (pangalan lang) ay tugma sa lahat.
  const flb = (t: string | null | undefined, color?: string | null) => lineKey(t, color);
  const lkOf = (it: { description?: string | null; color?: string | null }) => lineKey(it.description, it.color);
  // May naihatid nang batch ang order? - kapag meron, nasingil na ang
  // shipping sa unang biyahe at hindi na uulitin sa singil ng batch na ito.
  const deliveredOrdersSet = new Set<number>();
  // Ang mga LINYANG naihatid na (susi = unang linya, lowercase) — kailangan sa
  // kumulatibong singil ng susunod na batch.
  const deliveredLinesByOrder = new Map<number, Set<string>>();
  try {
    const { data: oldDel } = await supabase.from("order_line_deliveries").select("order_id, item_desc").limit(10000);
    for (const r of (oldDel ?? []) as { order_id: number | null; item_desc: string | null }[]) {
      if (r.order_id == null) continue;
      deliveredOrdersSet.add(r.order_id);
      const k = flb(r.item_desc);
      if (k) (deliveredLinesByOrder.get(r.order_id) ?? deliveredLinesByOrder.set(r.order_id, new Set()).get(r.order_id)!).add(k);
    }
  } catch { /* wala pang 0200 */ }
  const batchByOrder = new Map<number, Set<string>>();
  for (const o of (orders ?? []) as { id: number; dq_items?: unknown }[]) {
    if (Array.isArray(o.dq_items) && o.dq_items.length) {
      batchByOrder.set(o.id, keySet(o.dq_items));
    }
  }

  const qcPassedOrders = new Set<number>();
  const pickupBlocked = new Set<number>();
  for (const j of (wjobs ?? []) as { id: number; order_id: number | null; status: string | null; fulfillment: string | null; qc_received_at: string | null; item_desc?: string | null }[]) {
    if (j.order_id == null) continue;
    const isPickup = j.fulfillment === "pickup";
    const qcPassed = /qc passed/i.test(j.status ?? "");
    const received = !!j.qc_received_at || /received/i.test(j.status ?? "");
    if ((isPickup && qcPassed) || (!isPickup && received)) qcPassedOrders.add(j.order_id);
    // Alam nating dapat itong kunin (may declaration) pero hindi pa nakukuha —
    // maliban kung wala ito sa batch ng biyaheng ito.
    if (isPickup && pickedByJob.has(j.id) && !pickedByJob.get(j.id)) {
      const batch = batchByOrder.get(j.order_id);
      if (!batch || hasKey(batch, flb(j.item_desc))) pickupBlocked.add(j.order_id);
    }
  }
  for (const id of pickupBlocked) qcPassedOrders.delete(id);

  // NASUNDO NA BA ANG ORDER? Ang Delivery Route ay nagsasala ng `pickedUp`, at
  // iyon ay `deliveries.pickup_at` lang — ang selyo ng bodega. Pero ang DIRECT
  // PICKUP ay hindi dumadaan sa bodega: ang Pickup Task ay nagsesellyo sa
  // `qc_declarations.pickup_at`, kaya nananatiling blangko ang delivery row at
  // ang nasundong stop ay hindi lumalabas sa ruta — tahimik, at walang
  // makapagsabi kung bakit.
  const pickedUpOrders = new Set<number>();
  for (const j of (wjobs ?? []) as { id: number; order_id: number | null }[]) {
    if (j.order_id == null) continue;
    if (pickedByJob.get(j.id)) pickedUpOrders.add(j.order_id);
  }

  // Orders whose installation is Completed → their delivery is effectively Delivered.
  const installedOrders = new Set<number>();
  for (const i of (insts ?? []) as { order_id: number | null; status: string | null }[]) {
    if (i.order_id != null && /completed/i.test(i.status ?? "")) installedOrders.add(i.order_id);
  }

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const prodByName = new Map<string, { sku: string | null; category: string | null; color: string | null; dimension: string | null; image_url: string | null }>();
  for (const p of products ?? []) prodByName.set(norm(p.product_name ?? ""), { sku: p.sku ?? null, category: p.category ?? null, color: p.color ?? null, dimension: p.dimension ?? null, image_url: p.image_url ?? null });

  const qaByDel = new Map<number, DeliveryQaItem[]>();
  for (const it of qa ?? []) {
    const a = qaByDel.get(it.delivery_id) ?? [];
    // Saved QA rows from before specs were snapshotted may have null category/
    // color/dimension — recover from the catalog (by name) or the description's
    // "• …" bullets so downstream (incl. Declare Return) stays complete.
    const p = prodByName.get(norm((it.description ?? "").split("\n")[0]));
    const specs = parseDescSpecs(it.description);
    const stored = splitDimension(it.dimension);
    a.push({ id: it.id, description: it.description ?? null, image_url: photo(it.description, it.sku ?? p?.sku, it.color, it.description, it.image_url ?? null), sku: it.sku ?? p?.sku ?? null, category: it.category ?? specs.category ?? p?.category ?? null, color: it.color ?? specs.color ?? p?.color ?? null, dimension: stored.size ?? specs.dimension ?? p?.dimension ?? null, frame: stored.frame ?? specs.frame, qty: Number(it.qty ?? 0), good_qty: Number(it.good_qty ?? 0), defect_qty: Number(it.defect_qty ?? 0), photo_url: it.photo_url ?? null, checked_by: it.checked_by ?? null, remarks: it.remarks ?? null });
    qaByDel.set(it.delivery_id, a);
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const delByOrder = new Map<number, any>();
  for (const d of dels ?? []) if (d.order_id != null) delByOrder.set(d.order_id, d);

  // Committed orders appear here when EITHER a Delivery date is set OR the order's
  // status already says it's heading out (For Delivery / Out for Delivery / Delivered)
  // — so a "For Delivery" order shows up to be scheduled even before a date is picked.
  const deliverable = ((orders ?? []) as (OrderRow & { dq_status?: string | null })[]).filter((o) => {
    const st = o.status ?? "";
    if (/pending|cancel|draft/i.test(st)) return false;
    if (delByOrder.has(o.id)) return true;     // already has a delivery record (Scheduled / Out for Delivery / Arrived / Delivered)
    if (qcPassedOrders.has(o.id)) {
      // DELIVERY QUEUE muna ang QC-passed: habang wala pa o pending pa ang
      // customer confirmation (dq_status null/'pending') at wala pang delivery
      // record o schedule, sa Queue lang siya lalabas — hindi dito. Pag
      // 'confirmed' (o may date na/legacy) saka siya papasok sa Delivery.
      const dq = o.dq_status ?? null;
      if (dq === "confirmed") return true;
      return !!String(o.date_of_delivery ?? "").trim();
    }
    // OVERALL view (Ops Delivery Tracker): kasama rin ang mga natapos na —
    // Completed na status o may installation record na (installed = naihatid),
    // kahit walang delivery record / date (hal. mga lumang direct-install orders).
    return !!String(o.date_of_delivery ?? "").trim() || /deliver|complete/i.test(st) || installedOrders.has(o.id);
  });

  // May rework ang order (approved, kahit tapos na) → PERSISTENT na Rework tag sa
  // route/schedule rows — para laging aware kahit saang dinadaanan.
  const reworkByOrder = new Map<number, string | null>();
  const reworkHold = new Set<number>();
  // RMA ledger — ang rework charge/bayad ang totoong total/paid/balance ng
  // redelivery (₱0 na ang orders ledger doon). Newest return first → first-wins.
  const reworkLedgerByOrder = new Map<number, { charge: number; paid: number }>();
  const reworkModeByOrder = new Map<number, string | null>();
  const reworkWearByOrder = new Map<number, "onsite">();
  const reworkLegByOrder = new Map<number, "pickup" | "redeliver" | "onsite">();
  const reworkOnsitePickup = new Set<number>();
  // ALIN ANG INAAYOS. Ang biyahe ng rework ay may DALAWANG gamit lang: ang
  // inayos na produkto. Ang Pre-Delivery QA ay nagpapakita ng buong order, kaya
  // ang isang redelivery ng ORD-000009 ay humingi ng QA sa tatlong upuan gayong
  // isa lang ang sakay — dalawa roon ay nasa customer na mula pa noong una.
  // KASAMA ANG KULAY (2026-09-06, lib/orders/rework-match).
  const reworkItemByOrder = new Map<number, ReworkRef>();
  // Aling RMA ang may-ari ng delivery row ng bawat order (0205).
  const returnIdByOrder = new Map<number, number>();
  for (const d of (dels ?? []) as { order_id: number | null; return_id?: number | null }[]) {
    if (d.order_id != null && d.return_id != null) returnIdByOrder.set(d.order_id, Number(d.return_id));
  }
  for (const r of (reworkRets ?? []) as { id: number; order_id: number | null; return_no: string | null; status: string | null; reworked_at: string | null; rework_charge_total?: number | null; rework_downpayment?: number | null; rework_mode?: string | null; rework_pickup_onsite?: boolean | null; item_desc?: string | null; sku?: string | null }[]) {
    if (r.order_id == null || /reject|pending/i.test(r.status ?? "")) continue;
    // ANG NAKATALA SA BIYAHE ANG SINUSUNDAN, HINDI ANG HULA (0205, 2026-08-28).
    // Ang ORD-000013 ay may tatlong RMA at iisang deliveries row; ang "pinakabago
    // ang panalo" ay hula lang — at nang mag-`.set()` kada row, ang PINAKALUMA
    // pa ang natira: RMA-000006 · REDELIVER ang lumabas gayong RMA-000009
    // (on-site) ang aktibo, at napunta ang stop sa maling listahan.
    //
    // Ang `deliveries.return_id` ang nagsasabi kung kanino ang biyahe. Ang
    // pagiging-pinakabago ay panghalili lamang para sa mga naitala bago ang 0205
    // (na-backfill man ang karamihan, may hindi maaabot).
    const ownerId = r.order_id != null ? returnIdByOrder.get(r.order_id) : undefined;
    const owns = ownerId != null ? Number(r.id) === ownerId : !reworkByOrder.has(r.order_id);
    if ((/rework|completed/i.test(r.status ?? "") || r.reworked_at) && owns) {
      reworkByOrder.set(r.order_id, r.return_no ?? null);
      reworkModeByOrder.set(r.order_id, r.rework_mode ?? null);
      // Bago ang `reworked_at` ay nasa pagkuha pa; pagkatapos ay pagbalik na.
      reworkLegByOrder.set(r.order_id,
        r.rework_mode === "onsite" ? "onsite" : (r.reworked_at ? "redeliver" : "pickup"));
      // ANG SUOT NG CHIP (0217): ang dineklarang on-site na kinukuha pa
      // (pickup phase) ay "ON-SITE" ang tag sa planner/ruta — ang pinili ng
      // nag-declare — kahit pickup ang leg sa likod. Ang leg mismo ay hindi
      // ginagalaw: ito ang naghihiwalay ng pickup sa delivery routes.
      if ((r as Record<string, unknown>).rework_declared_onsite && !r.reworked_at && r.rework_mode === "pullout")
        reworkWearByOrder.set(r.order_id, "onsite");
      // Ang unang linya ng item_desc ang pangalan; ang sumunod ay specs.
      const rname = String(r.item_desc ?? "").split("\n")[0].trim();
      if (rname || r.sku) reworkItemByOrder.set(r.order_id, { item_desc: (r.item_desc as string | null) ?? null, sku: (r.sku as string | null) ?? null, color: ((r as Record<string, unknown>).color as string | null) ?? null });
    }
    // Pickup/repair phase pa (hindi pa tapos ang repair) — ang order ay nasa
    // team's PICKUP SCHEDULING lang; hindi dapat lumabas sa Delivery Scheduling.
    if (/rework/i.test(r.status ?? "") && !r.reworked_at) reworkHold.add(r.order_id);
    // NANDOON NA SILA (0209) — walang irurutang biyahe. Ang `reworked_at` ay
    // MAGKAIBANG bagay sa dalawang mode. Sa pull-out, ito ang "tapos na ang
    // repair, handa nang ibalik" — at ang pagbabalik ay BAGONG biyahe na dapat
    // mairuta. Sa on-site ay walang pagbabalik: isang bisita lang ang buong
    // RMA, at ang selyo ay "tapos na", hindi "susunod pa".
    //
    // ANG MAY-ARI NG BIYAHE ANG MASUSUNOD (2026-08-30). Nasa labas ito ng
    // `owns` noon — "may aktibong rework ba ang order habang nandoon sila" —
    // at tama iyon habang iisa ang RMA ng order. Sa pangalawa, hindi na: ang
    // ORD-000012 ay may tapos nang on-site RMA na may tsek na "nandito pa
    // kami", at ang bandilang iyon — nakatali sa ORDER — ay humarang sa
    // planner HABAMBUHAY. Ang RMA-000022, walang tsek at may petsang Set 1,
    // ay kumpleto ang dq_* pero hindi kailanman lumitaw: "No booked dates
    // yet". Ang bandila ng RMA na MAY HAWAK ng biyahe ang tanging may
    // kabuluhan sa tanong na "iruruta ba ito".
    if (r.rework_pickup_onsite && (r.rework_mode === "onsite" || !r.reworked_at) && owns) reworkOnsitePickup.add(r.order_id);
    const charge = Number(r.rework_charge_total) || 0;
    if (charge > 0 && !reworkLedgerByOrder.has(r.order_id))
      reworkLedgerByOrder.set(r.order_id, { charge, paid: Number(r.rework_downpayment) || 0 });
  }

  // ANG NAKA-ISKEDYUL NA PAGKUHA AY DUMADAAN (2026-08-28). Ang `reworkHold` ay
  // para itago ang order sa Delivery SCHEDULING habang nasa workshop pa ang gamit
  // — pero ang `rows` na ito ang binabasa rin ng ROUTE PLANNER at ng ruta ng
  // driver, kaya ang paghugot dito ay nagtatanggal sa pull-out pickup sa planner
  // kahit `confirmed` na ito at may team at petsa. Walang lumalabas doon, at
  // dumidiretso sa pahina ng team ang pagkuha nang hindi naiiruta.
  //
  // Ang naka-book na (dq_status + petsa + team) ay dumadaan; ang hindi pa ay
  // nananatiling nakatago gaya ng dati — walang dapat isaayos sa ruta doon.
  const booked = (o: { dq_status?: string | null; dq_date?: string | null; dq_team?: string | null }) =>
    !!o.dq_status && !!o.dq_date && !!o.dq_team;
  const rows: Delivery[] = deliverable.filter((o) => !reworkHold.has(o.id) || booked(o)).map((o) => {
    const d = delByOrder.get(o.id);
    // Rework: RMA ledger ang total/paid/balance ng redelivery.
    const rl = reworkLedgerByOrder.get(o.id);
    const total = rl ? rl.charge : Number(o.full_payment_price ?? 0);
    const paid = rl ? rl.paid : Number(o.downpayment_price ?? 0) + Number(o.full_payment ?? 0);
    const isRework = reworkByOrder.has(o.id);
    const rworkRma = isRework ? (reworkByOrder.get(o.id) ?? null) : null;
    // Fresh QA items derived from the order; used when no saved delivery (or its QA rows are empty).
    // category/color/dimension are pulled from the per-item fields, else parsed from the "• …" bullets in the description.
    //
    // REWORK: ANG INAAYOS LANG (2026-08-29). Ang biyahe ng rework ay may isang
    // gamit — ang inayos na produkto. Ang buong order ay nagpapakita ng mga
    // bagay na nasa customer na mula pa noong unang hatid, at hinihingan ang
    // driver ng QA sa mga ito. Ang SKU ang pinakamahigpit na pagtutugma; ang
    // pangalan ang panghalili kapag walang SKU ang RMA. Kung walang tumugma —
    // binura o pinalitan ang linya — ang buong order pa rin ang lumalabas,
    // kaysa magpakita ng biyaheng walang laman.
    const rwItem = isRework ? reworkItemByOrder.get(o.id) : undefined;
    const isReworkedLine = (it: { description?: string | null; sku?: string | null; color?: string | null }) => isReworkLine(rwItem, it);
    const lines = (o.receipt_items ?? []).filter((it) => !isShippingDesc(it.description));
    const rwLines = rwItem ? lines.filter(isReworkedLine) : [];
    // PARTIAL (2026-09-02, "di dapat ma-uploadan ung di kasama"): ang QA at
    // packing ay para lang sa mga linyang SAKAY ng biyaheng ito — ang mga item
    // ng susunod na batch ay hindi dapat lumitaw (at ang 0-of-5 nila ay
    // humaharang pa sa Start Delivery ng batch na wala naman silang kinalaman).
    const batchSet = !isRework ? batchByOrder.get(o.id) : undefined;
    const batchLines = batchSet?.size ? lines.filter((it) => hasKey(batchSet, lkOf(it))) : null;
    const qaLines = rwLines.length ? rwLines : (batchLines?.length ? batchLines : lines);

    const derived: DeliveryQaItem[] = qaLines.map((it) => {
      const desc = it.description ?? "";
      const first = desc.split("\n")[0];
      const specs = parseDescSpecs(desc);
      const p = prodByName.get(norm(first)); // match product to recover SKU + missing details
      return {
        id: null, description: first, image_url: photo(first, it.sku ?? p?.sku, it.color ?? specs.color, desc, it.image ?? p?.image_url ?? null),
        sku: it.sku ?? p?.sku ?? null,
        category: it.category ?? specs.category ?? p?.category ?? null,
        color: it.color ?? specs.color ?? p?.color ?? null,
        dimension: it.dimension ?? specs.dimension ?? p?.dimension ?? null,
        frame: specs.frame, specs: descSpecLines(desc),
        qty: Number(it.qty) || 0, good_qty: Number(it.qty) || 0, defect_qty: 0, photo_url: null, checked_by: null, remarks: null,
      };
    });
    // ANG NAITALANG QA AY MAAARING GALING SA UNANG HATID. Ang deliveries row ay
    // isa kada order at muling ginagamit sa bawat biyahe, kaya ang
    // delivery_qa_items nito ay maaaring hawak pa ang tatlong upuan ng unang
    // hatid — at hihilahin nito pabalik ang naalis na sa `derived`. Salain din.
    const savedAll = d ? (qaByDel.get(d.id) ?? []) : [];
    const savedRw = rwItem ? savedAll.filter(isReworkedLine) : [];
    // Ang naka-save na QA ng NAUNANG batch ay hindi dapat hilahin pabalik sa
    // biyaheng ito — parehong dahilan ng rework na sala sa itaas.
    const savedBase = rwItem && savedRw.length ? savedRw : (rwItem && rwLines.length ? [] : savedAll);
    const saved = !rwItem && batchLines?.length
      ? savedBase.filter((x) => hasKey(batchSet!, flb(x.description, x.color)))
      : savedBase;
    return {
      id: d?.id ?? null,
      order_id: o.id,
      is_rework: isRework,
      rma_no: rworkRma,
      rework_mode: isRework ? (reworkModeByOrder.get(o.id) ?? null) : null,
      rework_leg: isRework ? (reworkLegByOrder.get(o.id) ?? null) : null,
      rework_wear: isRework ? (reworkWearByOrder.get(o.id) ?? null) : null,
      rework_pickup_onsite: isRework && reworkOnsitePickup.has(o.id),
      order_number: o.order_number ?? null,
      customer_name: o.customer_name ?? null,
      // Pambalik sa order ang numero: maraming delivery row ang walang sariling
      // contact (hindi ito pinupunan ng queue) at nawawala ang Call/number sa
      // driver map kahit nasa order mismo ang cellphone ng customer.
      contact: d?.contact ?? (o as { contact_number?: string | null }).contact_number ?? null,
      alt_contact: (o as { alt_contact_number?: string | null }).alt_contact_number ?? null,
      alt_relation: (o as { alt_contact_relation?: string | null }).alt_contact_relation ?? null,
      address: d?.address ?? o.address ?? null,
      sales_rep: o.assigned ?? null,
      items_summary: summarize(o),
      total_amount: total,
      paid_amount: paid,
      // SINGIL NG BATCH sa partial (2026-09-01, "ang sisingilin ay ung 2 na
      // nadeliver + shipping"): items ng batch + shipping (unang biyahe lang)
      // - lahat ng nabayad, clamp sa 0 - EKSAKTONG kuwenta ng confirm email.
      // Buong order o rework: dating balanse.
      balance_due: (() => {
        const batch = !isRework ? batchByOrder.get(o.id) : undefined;
        if (!batch || !batch.size) return Math.max(total - paid, 0);
        const allLines = (o.receipt_items ?? []);
        const bTotal = allLines
          .filter((it) => hasKey(batch, lkOf(it)))
          .reduce((s2, it) => s2 + (Number(it.qty) || 0) * (Number((it as { unitPrice?: number }).unitPrice) || 0), 0);
        const fees = allLines
          .filter((it) => /^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*(and|&)\s*installation)?(\s*fee)?\b/i.test(flb(it.description)))
          .reduce((s2, it) => s2 + (Number(it.qty) || 0) * (Number((it as { unitPrice?: number }).unitPrice) || 0), 0);
        // KUMULATIBO (2026-09-02): lahat ng dapat nasingil na hanggang sa
        // biyaheng ito (naihatid na + batch + fee) - lahat ng bayad. Kapag
        // per-batch lang ang ibinawas sa kabuuang bayad, ang huling biyahe ay
        // laging ₱0 kahit may natitirang balanse pa.
        const done = deliveredLinesByOrder.get(o.id);
        const deliveredTotal = done?.size
          ? allLines.filter((it) => hasKey(done, lkOf(it)) && !hasKey(batch, lkOf(it)))
              .reduce((s2, it) => s2 + (Number(it.qty) || 0) * (Number((it as { unitPrice?: number }).unitPrice) || 0), 0)
          : 0;
        return Math.max(Math.round((fees + deliveredTotal + bTotal - paid) * 100) / 100, 0);
      })(),
      partial_batch: (() => {
        const batch = !isRework ? batchByOrder.get(o.id) : undefined;
        if (!batch || !batch.size) return null;
        const prodLines = (o.receipt_items ?? []).filter((it) => !isShippingDesc(it.description));
        const thisCount = prodLines.filter((it) => hasKey(batch, lkOf(it))).length;
        return thisCount > 0 && thisCount < prodLines.length ? { thisCount, totalCount: prodLines.length } : null;
      })(),
      schedule_date: d?.schedule_date ?? (o.date_of_delivery ? String(o.date_of_delivery).slice(0, 10) : null),
      time_window: d?.time_window ?? dq(o, "dq_time_window"),
      driver_team: d?.driver_team ?? null,
      coordinator: d?.coordinator ?? null,
      vehicle_plate: d?.vehicle_plate ?? null,
      qa_status: d?.qa_status ?? "Pending",
      qa_by: d?.qa_by ?? null,
      payment_collected: Number(d?.payment_collected ?? 0),
      payment_method: d?.payment_method ?? null,
      collected_by: d?.collected_by ?? null,
      received_by: d?.received_by ?? null,
      proof_url: d?.proof_url ?? null,
      signature_url: d?.signature_url ?? null,
      proof_photos: Array.isArray(d?.proof_photos) ? d.proof_photos : null,
      delivered_at: d?.delivered_at ?? null,
      // HR-approved (QC Passed) orders default to "QC Passed" until a delivery is started.
      status: installedOrders.has(o.id) ? "Delivered" : (d?.status ?? (qcPassedOrders.has(o.id) ? "QC Passed" : "To Schedule")),
      notes: d?.notes ?? null,
      address_lat: d?.address_lat ?? (o as { address_lat?: number | null }).address_lat ?? null,
      address_lng: d?.address_lng ?? (o as { address_lng?: number | null }).address_lng ?? null,
      landmark: ((o as { landmark?: string | null }).landmark ?? null),
      driver_lat: posByOrder.get(o.order_number ?? "")?.lat ?? d?.driver_lat ?? null,
      driver_lng: posByOrder.get(o.order_number ?? "")?.lng ?? d?.driver_lng ?? null,
      loc_updated_at: posByOrder.get(o.order_number ?? "")?.at ?? d?.loc_updated_at ?? null,
      started_at: d?.started_at ?? null,
      arrived_at: d?.arrived_at ?? null,
      pin: d?.pin ?? null,
      packed: !!d?.packed_at,
      // Alinman sa dalawang selyo: ang bodega (deliveries.pickup_at) o ang
      // workshop (qc_declarations.pickup_at, via pickedUpOrders).
      pickedUp: !!(d as { pickup_at?: string | null } | undefined)?.pickup_at || pickedUpOrders.has(o.id),
      packed_at: d?.packed_at ?? null,
      packed_by: d?.packed_by ?? null,
      packing_photos: Array.isArray(d?.packing_photos) ? d.packing_photos.filter((u: unknown): u is string => typeof u === "string") : [],
      item_packing_photos: Array.isArray((d as { item_packing_photos?: unknown } | undefined)?.item_packing_photos)
        ? ((d as { item_packing_photos: unknown[] }).item_packing_photos.map((a) => (Array.isArray(a) ? a.filter((u): u is string => typeof u === "string") : [])))
        : [],
      qa_items: saved.length
        ? saved.map((s, i) => ({
            ...s,
            image_url: s.image_url ?? derived[i]?.image_url ?? null,
            sku: s.sku ?? derived[i]?.sku ?? null,
            category: s.category ?? derived[i]?.category ?? null,
            color: s.color ?? derived[i]?.color ?? null,
            dimension: s.dimension ?? derived[i]?.dimension ?? null,
            specs: derived[i]?.specs ?? null,
          }))
        : derived,
      pickup_location: pickupByOrder.get(o.id) ?? "Warehouse",
      is_rush: !!(o as { is_rush?: boolean | null }).is_rush,
      rush_days: (o as { rush_days?: number | null }).rush_days ?? null,
      date_order: o.date_order ? String(o.date_order).slice(0, 10) : null,
      dq_status: dq(o, "dq_status"),
      dq_date: dq(o, "dq_date"),
      dq_team: dq(o, "dq_team"),
      dq_driver: dq(o, "dq_driver"),
      dq_window: dq(o, "dq_time_window"),
      dq_confirmed_at: dq(o, "dq_confirmed_at"),
      dq_stop: (() => { const n = Number((o as Record<string, unknown>)["dq_stop"]); return Number.isFinite(n) && n > 0 ? n : null; })(),
      dq_final: !!(o as Record<string, unknown>)["dq_route_final_at"],
    };
  });

  // AUTO time window bawat booked stop — kapareho ng Route Planner/Route table
  // (pagkakasunod sa loob ng team+date): 9–11 AM / 11 AM–1 PM / 1–3 PM / 3–5 PM.
  // Ginagamit ng delivery modal bilang auto-fill kapag walang manual window.
  const AUTO_WINDOWS = ["9–11 AM", "11 AM–1 PM", "1–3 PM", "3–5 PM"];
  const grouped = new Map<string, Delivery[]>();
  for (const r of rows) {
    if (r.dq_status !== "confirmed" || !r.dq_date || !r.dq_team) continue;
    const k = `${r.dq_team}|${r.dq_date}`;
    grouped.set(k, [...(grouped.get(k) ?? []), r]);
  }
  for (const g of grouped.values()) {
    g.sort((x, y) => (x.dq_stop ?? 999) - (y.dq_stop ?? 999) || String(x.dq_confirmed_at ?? "").localeCompare(String(y.dq_confirmed_at ?? "")));
    g.forEach((r, i) => { r.auto_window = AUTO_WINDOWS[Math.min(i, AUTO_WINDOWS.length - 1)]; });
  }

  const toSched = rows.filter((r) => /to schedule|^scheduled/i.test(r.status)).length;
  const qaPassed = rows.filter((r) => /qa passed|qc passed/i.test(r.status)).length;
  const outForDelivery = rows.filter((r) => /out for delivery/i.test(r.status)).length;
  const delivered = rows.filter((r) => /delivered/i.test(r.status)).length;
  const codDue = rows.filter((r) => !/delivered/i.test(r.status)).reduce((s, r) => s + r.balance_due, 0);
  const teams: TeamMeta[] = ((teamRows ?? []) as { name: string | null; driver: string | null; vehicle: string | null; capacity: number | null; reserved?: boolean | null }[])
    .filter((t) => !!t.name)
    .map((t) => ({ name: String(t.name), driver: t.driver ?? null, vehicle: t.vehicle ?? null, capacity: Number(t.capacity) || 5, reserved: !!t.reserved }));
  // Ang huling coordinator na aktwal na naitala — `dels` ay `created_at desc`,
  // kaya ang unang may laman ang pinakabago.
  const lastCoordinator = ((dels ?? []) as { coordinator?: string | null }[])
    .map((d) => (d.coordinator ?? "").trim()).find(Boolean) ?? null;
  return { rows, kpi: { toSched, qaPassed, outForDelivery, delivered, codDue }, rushThreshold: rushThresholdFrom(rushSetting?.value), teams, lastCoordinator };
}
