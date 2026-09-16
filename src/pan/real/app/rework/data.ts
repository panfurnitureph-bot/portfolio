import { createServerSupabase } from "@/lib/supabase/server";
import { parseDescSpecs, matchName } from "@/lib/receipt-desc";
import { makeColorPhoto } from "@/lib/ops/product-variants";

// Full rework pipeline for the Rework Tracking page. One row per rework return with
// its stage resolved across the three legs:
//   Pickup (pull-out only) → Workshop repair → Redeliver → Done.
// Data is joined from returns (the source of truth) + workshop_job (repair status) +
// deliveries (pickup / redeliver rows), so managers see where each rework sits.

export type ReworkStage = "Awaiting Payment" | "For Pickup" | "In Workshop" | "QC Passed" | "For Redelivery" | "Out for Delivery" | "Completed";

// Kaparehong bilang ng Pickup Task (components/pickup-tasks.tsx) at ng
// rework-pickup-panel: tatlong litrato bago tumulak.
const MIN_PICKUP_PHOTOS = 3;

export type ReworkRow = {
  id: number;
  return_no: string | null;
  order_id: number | null;
  order_number: string | null;
  customer_name: string | null;
  item: string | null;
  sku: string | null;
  image_url: string | null;
  mode: "onsite" | "pullout";
  // REFUND pull-out (2026-09-01): parehong biyahe, pero pera-na-balik ang usapan
  // — REFUND ang tag sa team page, at walang redelivery pagkatapos.
  refund: boolean;
  // 0217: on-site ang DINEKLARA — pull-out ang proseso pero "Rework on Site"
  // ang suot at sa team's Rework (On-Site) page lumilitaw ang pagkuha.
  declared_onsite: boolean;
  workshop_name: string | null;
  charge_total: number;
  downpayment: number;
  down_met: boolean;
  // Leg statuses.
  pickup_status: string | null;    // null when on-site (no pickup) or not yet created
  // PERSISTENT na pickup checks — mula sa rework_pickup_proof snapshot (0153) o
  // reworked_at, dahil ang live pickup row ay nare-repurpose para sa redelivery
  // (nawawala ang status) pagkatapos ng QC.
  pickup_arrived: boolean;
  pickup_dropped: boolean;
  // SAPAT NA BA ANG PICKUP PROOF (2026-08-27) — hindi lang "dumating". Ang
  // `pickup_arrived` ay totoo na sa pagdating pa lang sa mapa, kaya lumalabas
  // ang "Drop to Workshop" bago pa maitala kung ano ang kinuha at ilan ang
  // may sira. Tatlong litrato ang hinihingi, gaya ng Pickup Task.
  pickup_proof_ok: boolean;
  // Nasa WORKSHOP na (pumirma sa mapa) pero wala pang tatlong litrato sa Drop
  // Proof. Habang totoo ito, sarado ang mapa: iisang hakbang pa ang natitira.
  pickup_drop_arrived: boolean;
  pickup_team: string | null;      // driver_team ng pickup delivery row (per-team pickup pages)
  pickup_driver: string | null;    // piniling driver sa declaration (0151) — pwedeng Reserve
  // Para sa planner-style Pickup Rework table (same columns ng Delivery Route):
  address: string | null;          // address ng customer (pagkukunan ng item)
  pickup_date: string | null;      // schedule_date ng pickup delivery row
  pickup_window: string | null;    // time_window ng pickup delivery row
  workshop_address: string | null; // lokasyon ng workshop (leg 2 ng pickup — drop)
  job_status: string | null;       // workshop_job.status
  redeliver_status: string | null; // the redelivery / on-site delivery status
  redeliver_packed: boolean;       // packed_at ng redelivery row — "Packed" stage sa tracker grid
  status: string;                  // returns.status (Pending / Approved / Rework / Completed)
  // Delivery-queue confirmation ng REDELIVERY (dq_* ng order — nire-reset sa
  // auto-redeliver, kaya sariwa ito para sa redelivery cycle).
  dq_status: string | null;
  dq_sent: boolean;
  dq_confirmed: boolean;
  // NA-FINALIZE NA BA SA ROUTE PLANNER (2026-08-28). Ang pagkuha ay stop sa ruta
  // ng team, at si Ops ang nag-aayos ng pagkakasunod bago ito ipadala — hangga't
  // hindi pa tapos iyon, hindi pa ito dapat makita ng driver.
  route_final: boolean;
  stage: ReworkStage;
  created_at: string | null;
  // Rush ng pinagmulang order — badge sa taas ng order number.
  is_rush: boolean;
  rush_days: number | null;
  order_date: string | null;
};

export type ReworkData = { rows: ReworkRow[] };

// ── REWORK TRACKER (Operations Manager) ──────────────────────────────────────
// Kapareho ng Rework Jobs table ng workshop, pero LAHAT ng workshops — dagdag
// ang Workshop (sino ang gumagawa) at ang pull-out Team + Driver ng RMA.
export type ReworkTrackerRow = {
  id: number;                    // workshop_job id
  order_id: number | null;
  order_number: string | null;
  rma_no: string | null;
  item_desc: string | null;
  sku: string | null;
  image_url: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  frame: string | null;
  qty: number;
  dispatched_at: string | null;
  status: string;
  fulfillment: "warehouse" | "pickup";
  workshop_name: string | null;
  team: string | null;
  driver: string | null;
  is_rush: boolean;
  rush_days: number | null;
  date_order: string | null;
};

export async function loadReworkTracker(): Promise<{ rows: ReworkTrackerRow[] }> {
  const db = createServerSupabase();
  // Litrato ayon sa kulay ng item (color_variants) — lib/ops/product-variants.
  const photo = await makeColorPhoto(db);
  const [{ data: jobs }, { data: prods }, { data: wsRows }, { data: rets }, { data: dels }, { data: orders }] = await Promise.all([
    db.from("workshop_job").select("id, order_id, order_number, workshop_id, item_desc, qty, status, dispatched_at, fulfillment")
      .ilike("item_desc", "rework%").order("dispatched_at", { ascending: false }).limit(2000),
    db.from("product").select("product_name, sku, category, color, dimension, image_url").limit(10000),
    db.from("workshop").select("id, name").limit(1000),
    // select("*") — defensive: ang rework_pickup_driver (0151) ay manual migration;
    // babagsak ang explicit list hangga't hindi pa ito naipapatakbo.
    db.from("returns").select("*").in("resolution", ["rework", "refund"]).limit(5000),
    db.from("deliveries").select("order_id, status").limit(10000),
    db.from("orders").select("id, date_order, is_rush, rush_days").limit(10000),
  ]);

  const wsName = new Map<number, string>();
  for (const w of (wsRows ?? []) as { id: number; name: string | null }[]) wsName.set(w.id, w.name ?? `Workshop #${w.id}`);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const prodByName = new Map<string, { sku: string | null; category: string | null; color: string | null; dimension: string | null; image_url: string | null }>();
  for (const p of (prods ?? []) as { product_name: string | null; sku: string | null; category: string | null; color: string | null; dimension: string | null; image_url: string | null }[]) {
    const k = norm(p.product_name ?? "");
    if (k && !prodByName.has(k)) prodByName.set(k, { sku: p.sku ?? null, category: p.category ?? null, color: p.color ?? null, dimension: p.dimension ?? null, image_url: p.image_url ?? null });
  }
  // RMA + team/driver bawat rework job — via rework_job_id kung meron, else via order.
  type Ret = { order_id: number | null; return_no: string | null; rework_job_id: number | null; rework_pickup_team: string | null; rework_pickup_driver?: string | null; item_image: string | null };
  const retByJob = new Map<number, Ret>();
  const retByOrder = new Map<number, Ret>();
  for (const r of (rets ?? []) as Ret[]) {
    if (r.rework_job_id != null) retByJob.set(Number(r.rework_job_id), r);
    if (r.order_id != null && !retByOrder.has(Number(r.order_id))) retByOrder.set(Number(r.order_id), r);
  }
  const delStatusByOrder = new Map<number, string>();
  for (const d of (dels ?? []) as { order_id: number | null; status: string | null }[]) {
    if (d.order_id != null && d.status) delStatusByOrder.set(d.order_id, d.status);
  }
  const orderMeta = new Map<number, { date_order: string | null; is_rush: boolean; rush_days: number | null }>();
  for (const o of (orders ?? []) as { id: number; date_order: string | null; is_rush: boolean | null; rush_days: number | null }[]) {
    orderMeta.set(o.id, { date_order: o.date_order ? String(o.date_order).slice(0, 10) : null, is_rush: !!o.is_rush, rush_days: o.rush_days ?? null });
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows: ReworkTrackerRow[] = ((jobs ?? []) as any[]).map((j) => {
    const specs = parseDescSpecs(j.item_desc);
    const p = prodByName.get(norm(matchName(j.item_desc)));
    const ret = retByJob.get(Number(j.id)) ?? (j.order_id != null ? retByOrder.get(Number(j.order_id)) : undefined);
    // Delivery-stage overlay: para lang sa jobs na tapos na ang produksyon.
    const s = (j.status as string) ?? "pending";
    const pastProduction = /qc passed|received|done|delivered|arrived|installation|out for delivery/i.test(s);
    const ds = j.order_id != null ? delStatusByOrder.get(j.order_id) : undefined;
    const status = pastProduction && ds && /out for delivery|arrived|installation|delivered/i.test(ds) ? ds
      : /^done$/i.test(s) ? "QC Passed" : s;
    const meta = j.order_id != null ? orderMeta.get(j.order_id) : undefined;
    return {
      id: Number(j.id), order_id: j.order_id ?? null, order_number: j.order_number ?? null,
      rma_no: ret?.return_no ?? ((j.item_desc as string | null)?.match(/rma-\d+/i)?.[0]?.toUpperCase() ?? null),
      item_desc: j.item_desc ?? null,
      sku: p?.sku ?? null,
      image_url: photo(j.item_desc, p?.sku, specs.color, j.item_desc, p?.image_url ?? ret?.item_image ?? null),
      category: specs.category ?? p?.category ?? null,
      color: specs.color ?? p?.color ?? null,
      dimension: specs.dimension ?? p?.dimension ?? null,
      frame: specs.frame,
      qty: Number(j.qty ?? 1),
      dispatched_at: j.dispatched_at ? String(j.dispatched_at).slice(0, 10) : null,
      status,
      fulfillment: (j.fulfillment as "warehouse" | "pickup") ?? "warehouse",
      workshop_name: wsName.get(Number(j.workshop_id)) ?? null,
      team: ret?.rework_pickup_team ?? null,
      driver: (ret as { rework_pickup_driver?: string | null } | undefined)?.rework_pickup_driver ?? null,
      is_rush: meta?.is_rush ?? false,
      rush_days: meta?.rush_days ?? null,
      date_order: meta?.date_order ?? null,
    };
  });

  return { rows };
}

export async function loadRework(): Promise<ReworkData> {
  const db = createServerSupabase();
  const [{ data: rets }, { data: jobs }, { data: dels }, { data: prods }, { data: wsRows }] = await Promise.all([
    // select("*") — defensive: ang mga optional na column (rework_pickup_driver,
    // 0151) ay dumarating sa magkakahiwalay na manual migrations; ang explicit
    // list ay magpapabagsak ng buong page hangga't hindi pa tumatakbo ang SQL.
    db.from("returns")
      .select("*")
      // Kasama ang REFUND pull-out (2026-09-01) — parehong pickup/drop na daan;
      // ang pagkakaiba ay wala itong redelivery at nagsasara sa stock-in.
      .in("resolution", ["rework", "refund"]).order("created_at", { ascending: false }).limit(5000),
    db.from("workshop_job").select("id, status").limit(10000),
    db.from("deliveries").select("id, order_id, items_summary, status, driver_team, address, schedule_date, time_window, packed_at").limit(10000),
    db.from("product").select("product_name, sku, image_url").limit(10000),
    // select("*") — walang `location` column ang workshop table sa live DB;
    // ang explicit list ay nagpapabagsak ng query (42703 log spam).
    db.from("workshop").select("*").limit(1000),
  ]);

  const jobById = new Map<number, string>();
  for (const j of (jobs ?? []) as { id: number; status: string | null }[]) jobById.set(j.id, j.status ?? "");
  const delById = new Map<number, { items_summary: string | null; status: string | null; packed_at: string | null }>();
  for (const d of (dels ?? []) as { id: number; items_summary: string | null; status: string | null; packed_at?: string | null }[]) delById.set(d.id, { items_summary: d.items_summary, status: d.status, packed_at: d.packed_at ?? null });
  const wsName = new Map<number, string>();
  const wsAddr = new Map<number, string | null>();
  for (const w of (wsRows ?? []) as { id: number; name: string | null; location?: string | null }[]) {
    wsName.set(w.id, w.name ?? `Workshop #${w.id}`);
    wsAddr.set(w.id, w.location ?? null);
  }
  const imgBySku = new Map<string, string | null>();
  for (const p of (prods ?? []) as { sku: string | null; image_url: string | null }[]) if (p.sku) imgBySku.set(p.sku.toLowerCase(), p.image_url ?? null);

  // Pickup delivery per order → the deliveries row tagged "Pickup for Rework".
  const pickupByOrder = new Map<number, string | null>();
  const pickupTeamByOrder = new Map<number, string | null>();
  const pickupMetaByOrder = new Map<number, { address: string | null; schedule_date: string | null; time_window: string | null }>();
  for (const d of (dels ?? []) as { order_id: number | null; items_summary: string | null; status: string | null; driver_team?: string | null; address?: string | null; schedule_date?: string | null; time_window?: string | null }[]) {
    if (d.order_id != null && /pickup for rework/i.test(d.items_summary ?? "")) {
      pickupByOrder.set(d.order_id, d.status);
      pickupTeamByOrder.set(d.order_id, d.driver_team ?? null);
      pickupMetaByOrder.set(d.order_id, { address: d.address ?? null, schedule_date: d.schedule_date ? String(d.schedule_date).slice(0, 10) : null, time_window: d.time_window ?? null });
    }
  }

  // FREEZE ng tapos nang rework: iisa lang ang delivery row bawat order at
  // nire-repurpose ito sa bawat bagong rework — kapag may MAS BAGONG rework ang
  // parehong order, ang live status ng row ay sa bagong cycle na. Ang naunang
  // Completed ay ituring nang buong naihatid para hindi bumalik/masabayan ang
  // checks nito ng bagong RMA.
  const newestByOrder = new Map<number, string>();
  for (const r of (rets ?? []) as { order_id: number | null; created_at: string | null }[]) {
    if (r.order_id == null || !r.created_at) continue;
    const c = String(r.created_at);
    const cur = newestByOrder.get(Number(r.order_id));
    if (!cur || c > cur) newestByOrder.set(Number(r.order_id), c);
  }

  const rows: ReworkRow[] = (rets ?? []).map((r) => {
    const isRefund = String(r.resolution ?? "") === "refund";
    // Ang refund ay laging pull-out — kahit Pending pa (wala pang rework_mode
    // na naitatak ng approval).
    const mode = isRefund || (r.rework_mode as string) === "pullout" ? "pullout" : "onsite";
    const declaredOnsite = !!(r as Record<string, unknown>).rework_declared_onsite;
    const charge = Number(r.rework_charge_total) || 0;
    const down = Number(r.rework_downpayment) || 0;
    // ANG OVERRIDE AY PUMAPALIT SA BAYAD (2026-08-27). Ang "Approve without
    // payment (collect on redelivery)" ay sinasadyang aprubahan nang walang 50%
    // down — pero ang stage ay nananatiling "Awaiting Payment", kaya ang RMA ay
    // hindi kailanman lumalabas sa Pickup Rework at hindi masusundo ang gamit.
    // Naka-stuck ang buong rework sa isang pasyang tahasang ginawa ng manager.
    const overridden = !!r.rework_payment_override_at;
    const downMet = charge <= 0 || overridden || down + 0.005 >= charge * 0.5;
    const jobStatus = r.rework_job_id != null ? (jobById.get(Number(r.rework_job_id)) ?? null) : null;
    const statusStr = String(r.status ?? "");
    const newest = r.order_id != null ? newestByOrder.get(Number(r.order_id)) : undefined;
    const hasNewer = !!(newest && r.created_at && String(r.created_at) < newest);
    const redeliverLive = r.rework_delivery_id != null ? (delById.get(Number(r.rework_delivery_id))?.status ?? null) : null;
    const redeliver = /completed/i.test(statusStr) && hasNewer ? "Delivered" : redeliverLive;
    const pickupStatus = mode === "pullout" && r.order_id != null ? (pickupByOrder.get(Number(r.order_id)) ?? null) : null;
    // Persistent pickup checks: proof snapshot muna (0153), saka live status, saka
    // reworked_at (pre-0153 rows — kung nakumpuni na, tiyak na nakuha at nai-drop).
    const proof = (r.rework_pickup_proof ?? {}) as { arrive?: unknown; drop?: unknown };
    const pickupArrived = mode === "pullout" && (!!proof.arrive || !!proof.drop || /arrived|delivered/i.test(pickupStatus ?? "") || !!r.reworked_at);
    // ILANG LITRATO KADA LEG. Ang mapa ay naglalagay ng ISA pagdating; ang card
    // ang nagdadagdag hanggang tatlo. Ang pagbibilang, hindi ang basta pagkakaroon
    // ng leg, ang tanong — kung hindi, ang isang litrato ng mapa ay sapat na
    // (napansin 2026-08-27) at nalalaktawan ang buong proof card.
    // ANG GALING SA CARD ang binibilang, hindi ang lahat: ang mapa ay
    // nakapaglagay ng lima sa isang drop, naabot ang hinihinging tatlo, at
    // nagsara ang proof card bago pa mabuksan. Ang `cardPhotos` ay isinusulat
    // lang ng recordReworkPickupProof. Panghalili ang kabuuan para sa mga
    // naitala bago ang panuntunang ito.
    const shots = (leg: unknown) => {
      const l = leg as { photos?: unknown; cardPhotos?: unknown } | undefined;
      if (typeof l?.cardPhotos === "number") return l.cardPhotos;
      return Array.isArray(l?.photos) ? (l.photos as unknown[]).length : 0;
    };
    // Ang mga lumang tapos na (reworked_at, o Delivered na hindi dumaan sa
    // bagong panuntunan) ay hindi hinaharang pabalik: nakalampas na sila.
    const legacyDone = !!r.reworked_at;
    // ANG CARD LANG ANG NAGSASARA NG DROP LEG (2026-08-28). Ang mapa ay
    // nagta-stamp ng `Delivered` at nagsusulat ng `proof.drop` pagpirma —
    // WALANG `cardPhotos` — kaya bumabalik ang `shots()` sa bilang ng litrato ng
    // MAPA. Tatlo ang inuupload doon, kaya `pickupDropped` agad, at sabay-sabay:
    // nagsara ang Drop Proof card bago pa mabuksan, at umalis sa stage
    // "For Pickup" ang row — biglang nawawala sa Rework (Pull Out) list bago pa
    // maitala kung anong kalagayan ang inabot sa workshop.
    //
    // Kaya ang `cardPhotos` ang tanging sukatan dito. Ang panghalili sa
    // `photos.length` ay para lamang sa mga NAITALA BAGO ang panuntunang ito —
    // kilala sila sa `delivered_at` na wala pang `cardPhotos` sa drop leg.
    // Ang tunay na pre-0153 na rekord ay WALANG `proof.drop` kahit ano: ang
    // snapshot pa lang ang gumagawa nito. Ang `Delivered` na may leg ay galing
    // sa mapa — at ang mapa ay hindi nagtatapos ng biyahe, ang card lang.
    const dropCard = (proof.drop as { cardPhotos?: unknown } | undefined)?.cardPhotos;
    const pickupDropped = mode === "pullout"
      && (legacyDone
        || (/delivered/i.test(pickupStatus ?? "") && !proof.drop)
        || (typeof dropCard === "number"
          ? dropCard >= MIN_PICKUP_PHOTOS
          : shots(proof.drop) >= MIN_PICKUP_PHOTOS));
    const pickupProofOk = pickupDropped || shots(proof.arrive) >= MIN_PICKUP_PHOTOS;
    // DUMATING NA SA WORKSHOP, PERO KULANG PA ANG DROP PROOF (hiling 2026-08-28).
    // Katumbas ng `pickupArrived` para sa PANGALAWANG biyahe: pumirma na siya sa
    // mapa sa workshop, kaya may `proof.drop` na o `Delivered` na ang status —
    // ngunit hindi pa umaabot sa tatlo ang litrato sa card. Kapag walang ganitong
    // flag, walang humaharang sa "Drop to Workshop" pagkatapos ng pickup proof:
    // nakakapindot siya ng mapa at nakakapirma nang 0/3 pa ang Drop Proof.
    const pickupDropArrived = mode === "pullout" && pickupProofOk && !pickupDropped
      && (!!proof.drop || /delivered/i.test(pickupStatus ?? ""));
    const status = statusStr;
    const sku = (r.sku as string | null) ?? null;
    const img = (r.item_image as string | null) ?? (sku ? imgBySku.get(sku.toLowerCase()) ?? null : null);

    // Resolve the pipeline stage. PICKUP LEG MUNA bago ang workshop: ang rework
    // job ay ginagawa na sa APPROVE pa lang, pero hangga't hindi pa NAKUKUHA ang
    // item sa customer (pickup row hindi pa Delivered), nasa "For Pickup" pa ito —
    // hindi "In Workshop".
    let stage: ReworkStage;
    if (/completed/i.test(status) || /delivered/i.test(redeliver ?? "")) stage = "Completed";
    else if (!downMet) stage = "Awaiting Payment";
    else if (redeliver && /out for delivery|arrived|installation/i.test(redeliver)) stage = "Out for Delivery";
    else if (redeliver) stage = "For Redelivery";
    // NANATILI SA "For Pickup" HANGGA'T HINDI PA TAPOS ANG DROP PROOF
    // (2026-08-28). Ang `Delivered` ay isinusulat na ng mapa pagpirma sa
    // workshop — kung iyon ang susundin, aalis agad ang row sa Rework (Pull Out)
    // list bago pa maitala ang katibayan, at wala nang makikitang lugar ang
    // driver para i-upload ito. Ang `pickupDropped` (= tatlong litrato sa card)
    // ang tunay na katapusan ng biyahe.
    else if (mode === "pullout" && !pickupDropped) stage = "For Pickup";
    else if (jobStatus && /qc passed/i.test(jobStatus)) stage = "QC Passed";
    else if (jobStatus) stage = "In Workshop";
    else stage = "In Workshop";

    return {
      id: Number(r.id), return_no: (r.return_no as string | null) ?? null,
      order_id: (r.order_id as number | null) ?? null, order_number: null,
      customer_name: (r.customer_name as string | null) ?? null,
      item: (r.item_desc as string | null)?.split("\n")[0].replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "") ?? null,
      sku, image_url: img, mode, refund: isRefund,
      workshop_name: r.rework_workshop_id != null ? (wsName.get(Number(r.rework_workshop_id)) ?? null) : null,
      charge_total: charge, downpayment: down, down_met: downMet,
      pickup_status: pickupStatus,
      pickup_arrived: pickupArrived, pickup_dropped: pickupDropped, pickup_proof_ok: pickupProofOk,
      pickup_drop_arrived: pickupDropArrived,
      // Team ng pickup delivery row; bago pa ma-approve, ang piniling team sa
      // declaration (rework_pickup_team) ang fallback — kita agad sa team page.
      pickup_team: mode === "pullout"
        ? ((r.order_id != null ? pickupTeamByOrder.get(Number(r.order_id)) : null) ?? (r.rework_pickup_team as string | null) ?? null)
        : null,
      pickup_driver: mode === "pullout" ? (((r as Record<string, unknown>).rework_pickup_driver as string | null) ?? null) : null,
      declared_onsite: declaredOnsite,
      address: (r.order_id != null ? pickupMetaByOrder.get(Number(r.order_id))?.address : null) ?? null,
      workshop_address: r.rework_workshop_id != null ? (wsAddr.get(Number(r.rework_workshop_id)) ?? null) : null,
      pickup_date: (r.order_id != null ? pickupMetaByOrder.get(Number(r.order_id))?.schedule_date : null)
        ?? (((r as Record<string, unknown>).rework_pickup_date as string | null)?.slice(0, 10) ?? null),
      pickup_window: (r.order_id != null ? pickupMetaByOrder.get(Number(r.order_id))?.time_window : null) ?? null,
      job_status: jobStatus, redeliver_status: redeliver, status,
      redeliver_packed: r.rework_delivery_id != null ? !!(delById.get(Number(r.rework_delivery_id))?.packed_at) : false,
      dq_status: null, dq_sent: false, dq_confirmed: false, route_final: false,
      stage, created_at: (r.created_at as string | null) ?? null,
      is_rush: false, rush_days: null, order_date: null,
    };
  });

  // Fill order_number from orders (single query) for the rows that have an order.
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter((x): x is number => x != null))];
  if (orderIds.length) {
    const { data: os } = await db.from("orders").select("id, order_number, address, is_rush, rush_days, date_order, dq_status, dq_sent_at, dq_confirmed_at, dq_route_final_at").in("id", orderIds);
    const onById = new Map<number, { order_number: string | null; address: string | null; is_rush: boolean; rush_days: number | null; date_order: string | null; dq_status: string | null; dq_sent: boolean; dq_confirmed: boolean; route_final: boolean }>();
    for (const o of (os ?? []) as { id: number; order_number: string | null; address?: string | null; is_rush?: boolean | null; rush_days?: number | null; date_order?: string | null; dq_status?: string | null; dq_sent_at?: string | null; dq_confirmed_at?: string | null; dq_route_final_at?: string | null }[]) {
      onById.set(o.id, { order_number: o.order_number, address: o.address ?? null, is_rush: !!o.is_rush, rush_days: o.rush_days ?? null, date_order: o.date_order ?? null, dq_status: o.dq_status ?? null, dq_sent: !!o.dq_sent_at, dq_confirmed: !!o.dq_confirmed_at, route_final: !!o.dq_route_final_at });
    }
    for (const r of rows) {
      if (r.order_id == null) continue;
      const m = onById.get(r.order_id);
      r.order_number = m?.order_number ?? null;
      // Address fallback: kung wala pang pickup delivery row, ang address ng order.
      r.address = r.address ?? m?.address ?? null;
      r.is_rush = m?.is_rush ?? false;
      r.rush_days = m?.rush_days ?? null;
      r.order_date = m?.date_order ?? null;
      r.dq_status = m?.dq_status ?? null;
      r.dq_sent = m?.dq_sent ?? false;
      r.dq_confirmed = m?.dq_confirmed ?? false;
      r.route_final = m?.route_final ?? false;
    }
  }

  return { rows };
}

// Pickup-only view: pull-out reworks whose pickup leg isn't done yet.
// APPROVED lang ang lumalabas dito — ang Pending (hindi pa inaprubahan) ay wala
// pang pickup task; sa Return Approval pa lang iyon.
export async function loadPickups(): Promise<ReworkData> {
  const { rows } = await loadRework();
  return { rows: rows.filter((r) => r.mode === "pullout" && !/pending|reject/i.test(r.status) && (r.stage === "For Pickup" || r.stage === "Awaiting Payment")) };
}
