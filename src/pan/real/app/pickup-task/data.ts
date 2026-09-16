import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { lineKey, joinKey, colorOfDesc, keySet, hasKey, keyColor } from "@/lib/orders/line-key";
import { isReworkLine } from "@/lib/orders/rework-match";
import { makeColorPhoto } from "@/lib/ops/product-variants";

// PICKUP TASK — ang hakbang sa pagitan ng Delivery Queue at Delivery Route.
// Bago nito ay walang kumukuha ng bagay sa system: pagkacconfirm ng customer ay
// diretso nang naiiruta ang order, kahit hindi pa nahahawakan ng driver.
//
// DALAWA ANG PINAGMUMULAN, dahil dalawang lugar ang pwedeng kunan:
//   • WORKSHOP — direct pickup na hindi dumadaan sa bodega, at STOCK BUILD na
//     kukunin para maimbak. Ang qc_declarations ang may hawak nito.
//   • BODEGA — nadaan na sa Receiving QC, o hindi na dumaan sa workshop dahil
//     nasa stock na nang mabili. Ang deliveries ang may hawak nito.
//
// Ang mga may order ay naghihintay muna ng CONFIRM ng customer bago lumabas
// dito; ang stock build ay hindi — walang customer na magcoconfirm.

export type PickupStop = {
  // Alin ang talaang sesellyuhan kapag nakuha. Magkaiba ang lamesa, iisa ang
  // ginagawa ng driver.
  source: "workshop" | "warehouse";
  declaration_id: number | null;
  delivery_id: number | null;
  job_id: number | null;
  // ISANG HILERA KADA LINYA (2026-08-29): ang selyo ng warehouse stop ay nasa
  // delivery pa rin, kaya pareho ang `delivery_id` ng lahat ng linya ng isang
  // order. Ito ang nagbubukod sa kanila sa React key — kung wala, "two children
  // with the same key `warehouse:84`" ang kapalit at may nabubura na hilera.
  line_key: string | null;
  // Saan pupunta ang trak. Nakapangkat dito ang mga stop: isang biyahe ang
  // isang lugar.
  place: string;
  place_address: string | null;
  // Ang PIN ng lugar (0188). Ang address ng workshop ay hindi mahanap ng
  // geocoder — bloke at lote sa loob ng subdivision — kaya ang punto mismo ang
  // ipinapadala sa mapa kapag naitala na ito.
  place_lat: number | null;
  place_lng: number | null;
  item: string;
  item_image: string | null;
  // Ang MISMONG binuo, hindi lang ang pangalan: dalawang "Costumized Bed" ay
  // magkaiba sa sukat at tela, at ang driver ang huling makakakita bago ito
  // umalis — dito niya matitiyak na tama ang kinukuha.
  sku: string | null;
  category: string | null;
  specs: string[];
  qty: number;
  // Kanino ito. Ang stock build ay walang customer — `stock` ang tanda nito.
  order_number: string | null;
  customer: string | null;
  stock: boolean;
  // REFUND pull-out haul (2026-09-01): stock job na galing sa refund RMA —
  // REFUND ang chip nito sa listahan, hindi plain STOCK.
  refund: boolean;
  // Saan ito dadalhin pagkakuha.
  deliver_to: string;
  deliver_on: string | null;
  // Kalagayan. Ang `started_at` ay ang pag-alis papunta sa kukunan — ito ang
  // nagbubukas ng mapa, gaya ng started_at sa delivery.
  started_at: string | null;
  // Nandoon na siya at pumirma sa mapa — pero hindi pa tapos: ang bilang ng
  // tinanggap at may sira ay nasa Pickup Proof card pa.
  arrived_at: string | null;
  // Saan nagsimula ang driver — ang pinagmulan ng ruta sa mapa (0189).
  from_lat: number | null;
  from_lng: number | null;
  picked_at: string | null;
  picked_by: string | null;
  // Sino ang nakatalagang driver ng biyahe (2026-08-26): ang kumuha na kung
  // nakuha na; kung hindi pa, ang driver ng ruta (dq_driver); kung wala — ang
  // to-warehouse/stock na kita ng lahat — ang default na driver ng team na
  // nakatingin. Hindi ito blangko kailanman sa may-team na page.
  driver: string | null;
  photos: string[];
  // Ang pirma ng driver sa pagkuha — dito nagsisimula ang pananagutan niya.
  signature: string | null;
  // Ang bilang ng tinanggap at ng may sira, gaya ng QA ng delivery — siya ang
  // huling nakakakita bago maikarga.
  good: number | null;
  defect: number | null;
  remarks: string | null;
  notes: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  // 0220: papunta sa BODEGA ang stop na ito (to-warehouse haul o stock build)
  // — pagkatapos makuha, may "Dropped at Warehouse" pang hakbang.
  to_warehouse: boolean;
  // Ang PIN ng bodega — ang patutunguhan ng drop leg; ang drop ay biyahe rin
  // at kailangan ng mapa (2026-08-31, hiling ni Joe).
  drop_address: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  // 0222: estado ng drop leg — dumating na (pirma sa mapa) at ang naipon nang
  // pirma/litrato, para maipakita ng modal ang kasaysayan gaya ng pull-out.
  drop_arrived: boolean;
  drop_signature: string | null;
  drop_photos: string[];
};

export type PickupGroup = { place: string; address: string | null; stops: PickupStop[] };

export type PickupData = {
  team: string;
  groups: PickupGroup[];
  // Ilan ang nakuha na sa kabuuan — ang talababa ng screen.
  total: number;
  picked: number;
  // Ilan ang natitira sa listahan — ang nakuha ay umaalis dito, pero bahagi pa
  // rin ito ng bilang ng araw.
  remaining: number;
  // Mga order na may natitira pang hindi nakukuhang item: hindi pa sila
  // makakapasok sa Delivery Route kahit nakuha na ang iba.
  waiting: { order_number: string; got: number; of: number }[];
};

const WAREHOUSE = "Warehouse";

const firstLine = (s: string | null | undefined) => String(s ?? "").split("\n")[0].trim();

// Ang paglalarawan ay pangalan sa unang linya at mga spec sa sumunod, may
// panimulang bullet — kapareho ng quotation at resibo. Ang UI ang naglalagay ng
// sariling tanda, kaya tinatanggal ito rito.
const specLines = (s: string | null | undefined) =>
  String(s ?? "").split("\n").slice(1).map((x) => x.replace(/^[•·-]\s*/, "").trim()).filter(Boolean);
const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");

// ARRAY LANG NA MAY LAMAN NA TEKSTO (naranasan 2026-08-29). Ang `pickup_photos`
// ay jsonb, kaya hindi array ang maaaring nakatago doon — ang `{}` ay nagbigay
// ng `NaN / 3` sa Pickup Proof card at hindi na mapipindot ang Confirm. Ang
// `null` na pagbalik ay nagsasabing "walang naitala rito", kaya makakalipat ang
// `??` sa susunod na pinagmumulan; ang `[]` ay "wala talagang litrato".
const pickPhotos = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : null;

// Ang bayarin (Shipping, Rush) ay linya rin sa resibo pero walang kukunin.
const isFee = (t: string) =>
  /^(addtl\.?\s*)?(additional\s*)?(shipping|rush|delivery)(\s*(and|&)\s*installation)?(\s*fee)?$/i.test(t.trim());

type OrderInfo = {
  number: string | null;
  customer: string | null;
  address: string | null;
  team: string | null;
  driver: string | null;
  // PARTIAL DELIVERY (0200): ang mga linyang sakay ng KASALUKUYANG batch —
  // null = buong order. Ang wala rito ay hindi susunduin sa biyaheng ito.
  batch: Set<string> | null;
  date: string | null;
  confirmed: boolean;
  routed: boolean;
};

export async function loadPickupTasks(team: string): Promise<PickupData> {
  const db = createServerSupabase();
  // Litrato ayon sa kulay ng item (color_variants) — lib/ops/product-variants.
  const photo = await makeColorPhoto(db);
  const stops: PickupStop[] = [];

  // Default na driver ng team na nakatingin — pambalik ng mga stop na walang
  // nakatalagang ruta (to-warehouse at stock build, na kita ng lahat ng team).
  const { data: teamRow } = await db.from("delivery_teams").select("driver").ilike("name", team).limit(1);
  const teamDriver = (teamRow?.[0]?.driver as string | null) ?? null;

  // SKU mula sa catalog sa pangalan (2026-08-26) — ang workshop job ay may
  // stock_sku LANG kapag stock build; ang ordinaryong item ay walang dala, kaya
  // gitling ang buong SKU column ng Pickup Task.
  const { data: prodRows } = await db.from("product").select("product_name, sku, category").limit(10000);
  const skuByName = new Map<string, string>();
  // CATEGORY MULA SA CATALOG (Joe 2026-09-06, "bakit walang category"): ang
  // website order ay walang category sa receipt line — SKU muna, saka pangalan.
  const catBySku = new Map<string, string>();
  const catByName = new Map<string, string>();
  for (const p of (prodRows ?? []) as { product_name: string | null; sku: string | null; category: string | null }[]) {
    if (!p.category) continue;
    if (p.sku && !catBySku.has(String(p.sku).toLowerCase())) catBySku.set(String(p.sku).toLowerCase(), p.category);
    const nk = String(p.product_name ?? "").trim().toLowerCase();
    if (nk && !catByName.has(nk)) catByName.set(nk, p.category);
  }
  const categoryOf = (cat: unknown, sku: unknown, desc: unknown): string | null =>
    (cat ? String(cat) : null)
    ?? (sku ? catBySku.get(String(sku).toLowerCase()) : undefined)
    ?? catByName.get(firstLine(desc as string | null).toLowerCase())
    ?? null;
  for (const p of prodRows ?? []) {
    const k = String(p.product_name ?? "").trim().toLowerCase();
    if (k && p.sku && !skuByName.has(k)) skuByName.set(k, p.sku as string);
  }

  // ── PINAGMUMULAN 1: ANG WORKSHOP ──────────────────────────────────────────
  // Aprobadong declaration na hindi pa nakukuha sa pinaggawaan. Ang tinanggihan
  // ay nananatili rito: humaharang ito, hindi flag — hanggang may makuha.
  // Ang `pickup_team` (0218) ay hinihingi nang may pambalik — bago tumakbo ang
  // migration, ang buong query ay babagsak at MAWAWALA ang lahat ng workshop
  // stop (kapareho ng aral sa deliveries.pickup_lines/0206).
  const DECL_COLS = "id, job_id, order_id, order_number, workshop, item, item_image, category, status, pickup_started_at, pickup_arrived_at, pickup_lat, pickup_lng, pickup_at, pickup_by, pickup_photos, pickup_signature, pickup_good, pickup_defect, pickup_remarks, pickup_notes, pickup_rejected_at, pickup_reject_reason";
  const declQ = (cols: string) => db.from("qc_declarations").select(cols).eq("status", "Approved").order("id", { ascending: false }).limit(500);
  let decls: Record<string, unknown>[] | null = null;
  {
    const r = await declQ(`${DECL_COLS}, pickup_team`);
    decls = r.error
      ? ((await declQ(DECL_COLS)).data as unknown as Record<string, unknown>[] | null)
      : (r.data as unknown as Record<string, unknown>[] | null);
  }

  // Ang JOB ang may hawak ng bilang, ng ruta, at ng pagiging stock build.
  const jobIds = [...new Set((decls ?? []).map((d) => d.job_id as number | null).filter((x): x is number => x != null))];
  const jobById = new Map<number, { qty: number; fulfillment: string | null; stock: boolean; stockReason: string | null; sku: string | null; workshop_id: number | null; received: boolean; dropped: boolean; dropArrived: boolean; dropSignature: string | null; dropPhotos: string[] }>();
  if (jobIds.length) {
    // Ang transfer_dropped_at (0220) ay may pambalik — bago ang migration ay
    // babagsak ang buong select at mawawala ang lahat ng workshop stop.
    const JOB_COLS = "id, qty, fulfillment, stock_request, stock_sku, stock_reason, workshop_id, qc_received_at";
    const jq = (c: string) => db.from("workshop_job").select(c).in("id", jobIds);
    // Tatlong antas ng pambalik: 0222 → 0220 → wala.
    const jr1 = await jq(`${JOB_COLS}, transfer_dropped_at, transfer_arrived_at, transfer_drop_signature, transfer_drop_photos`);
    const jr = jr1.error ? await jq(`${JOB_COLS}, transfer_dropped_at`) : jr1;
    const jobs = (jr.error ? (await jq(JOB_COLS)).data : jr.data) as Record<string, unknown>[] | null;
    for (const j of jobs ?? []) {
      jobById.set(j.id as number, {
        qty: Number(j.qty) || 1,
        fulfillment: (j.fulfillment as string | null) ?? null,
        stock: !!j.stock_request,
        stockReason: ((j as Record<string, unknown>).stock_reason as string | null) ?? null,
        sku: (j.stock_sku as string | null) ?? null,
        workshop_id: (j.workshop_id as number | null) ?? null,
        received: !!j.qc_received_at,
        dropped: !!(j as Record<string, unknown>).transfer_dropped_at,
        dropArrived: !!(j as Record<string, unknown>).transfer_arrived_at,
        dropSignature: ((j as Record<string, unknown>).transfer_drop_signature as string | null) ?? null,
        dropPhotos: pickPhotos((j as Record<string, unknown>).transfer_drop_photos) ?? [],
      });
    }
  }

  // Address ng bodega. Isang hilera rin ito sa `workshop` (pangalang
  // "Warehouse"), kaya doon din nakatira ang address nito — hindi ito hiwalay
  // na setting.
  const { data: whRow } = await db
    .from("workshop").select("location, lat, lng").ilike("name", WAREHOUSE).limit(1);
  const warehouseAddress = (whRow?.[0]?.location as string | null) ?? null;
  const warehouseLat = (whRow?.[0]?.lat as number | null) ?? null;
  const warehouseLng = (whRow?.[0]?.lng as number | null) ?? null;

  // Address ng workshop — ito ang ipinapakita sa driver. Blangko pa ito sa
  // karamihan; ang pangalan lang ang lalabas hangga't hindi napupunan.
  const wsIds = [...new Set([...jobById.values()].map((j) => j.workshop_id).filter((x): x is number => x != null))];
  const wsById = new Map<number, { name: string; location: string | null; lat: number | null; lng: number | null }>();
  if (wsIds.length) {
    const { data: ws } = await db.from("workshop").select("id, name, location, lat, lng").in("id", wsIds);
    for (const w of ws ?? []) {
      wsById.set(w.id as number, {
        name: (w.name as string | null) ?? "",
        location: (w.location as string | null) ?? null,
        lat: (w.lat as number | null) ?? null,
        lng: (w.lng as number | null) ?? null,
      });
    }
  }

  // ── PINAGMUMULAN 2: ANG BODEGA ────────────────────────────────────────────
  // Nakaruta na pero hindi pa naikakarga. Ang Packing (packed_at) ay nasa loob
  // ng Delivery modal at sinasagot ang ibang tanong — "naihanda na ba?"; ito ay
  // listahan ng lalakarin, para makita ng driver sa isang tingin ang lahat ng
  // kukunin bago siya umalis.
  const DEL_PICK = "id, order_id, driver_team, schedule_date, status, pickup_started_at, pickup_arrived_at, pickup_lat, pickup_lng, pickup_at, pickup_by, pickup_photos, pickup_signature, pickup_good, pickup_defect, pickup_remarks, pickup_notes, pickup_rejected_at, pickup_reject_reason";
  // Ang `pickup_lines` (0206) ay hinihingi nang hiwalay: kapag hindi pa tumakbo
  // ang migration, ang buong query ay babagsak sa "column does not exist" at
  // MAWAWALA ang lahat ng warehouse stop. Isang beses nang nangyari ito sa
  // `deliveries.return_id` (0205) — bumalik na blangko ang buong module.
  const delQ = (cols: string) => db.from("deliveries").select(cols).in("status", ["Scheduled", "Packed"]).limit(500);
  let dels: Record<string, unknown>[] | null = null;
  {
    const r = await delQ(`${DEL_PICK}, pickup_lines, return_id`);
    const r2 = r.error ? await delQ(`${DEL_PICK}, pickup_lines`) : r;
    dels = r2.error
      ? ((await delQ(DEL_PICK)).data as unknown as Record<string, unknown>[] | null)
      : (r2.data as unknown as Record<string, unknown>[] | null);
  }

  // ANG BIYAHENG REWORK AY KILALA SA return_id (2026-09-01, "bakit pati meron
  // to"): ang on-site repair visit ng ORD-000002 ay naglista ng BUONG order sa
  // Pickup Task — dalawang accent chair na kukunin daw sa bodega, kahit ang
  // biyahe ay pagbisita lang para ayusin sa bahay. Kaya kinikilala ang returns
  // row ng bawat delivery: ang ON-SITE ay walang dala (walang stop), at ang
  // pull-out redelivery ay ANG INAYOS NA LINYA LANG ang kukunin.
  const retById = new Map<number, { mode: string | null; resolution: string | null; reworked: boolean; direct: boolean; item_desc: string | null; sku: string | null; color: string | null; qty: number }>();
  {
    const retIds = [...new Set((dels ?? [])
      .map((x) => (x as Record<string, unknown>).return_id as number | null)
      .filter((x): x is number => x != null))];
    if (retIds.length) {
      const rq = (cols: string) => db.from("returns").select(cols).in("id", retIds);
      const r1 = await rq("id, resolution, rework_mode, reworked_at, rework_job_id, item_desc, sku, color, qty");
      const rr = (r1.error ? (await rq("id, resolution, reworked_at, item_desc, sku, color, qty")).data : r1.data) as Record<string, unknown>[] | null;
      // ANG DIREKTANG REDELIVERY AY HINDI DUMADAAN SA BODEGA (2026-09-01, "na
      // pickup na pero ganun padin"): kapag ang rework job ay fulfillment na
      // "pickup" (kunin sa workshop, diretso sa customer), ang workshop stop
      // ANG buong biyahe — ang deliveries row ay hindi dapat gumawa ng
      // warehouse stop kailanman. Ang fulfillment ay nasa workshop_job.
      const jobIds2 = [...new Set((rr ?? []).map((r) => (r as Record<string, unknown>).rework_job_id as number | null).filter((x): x is number => x != null))];
      const fulfillByJob = new Map<number, string | null>();
      if (jobIds2.length) {
        const { data: js } = await db.from("workshop_job").select("id, fulfillment").in("id", jobIds2);
        for (const j of js ?? []) fulfillByJob.set(j.id as number, (j.fulfillment as string | null) ?? null);
      }
      for (const r of rr ?? []) {
        const jid = (r as Record<string, unknown>).rework_job_id as number | null;
        retById.set(r.id as number, {
          mode: (r.rework_mode as string | null) ?? null,
          resolution: (r.resolution as string | null) ?? null,
          reworked: !!(r as Record<string, unknown>).reworked_at,
          direct: jid != null && fulfillByJob.get(jid) === "pickup",
          item_desc: (r.item_desc as string | null) ?? null,
          sku: (r.sku as string | null) ?? null,
          color: (r.color as string | null) ?? null,
          qty: Number(r.qty) || 1,
        });
      }
    }
  }

  // Ang ORDER ang may hawak ng customer, ng address, at — mahalaga — ng
  // CONFIRM. Hindi kinukuha ang isang bagay hangga't hindi sumasang-ayon ang
  // customer sa petsa: kung sa isang linggo pa siya, isang linggo itong nakaupo
  // sa trak. Iisang tanong para sa dalawang pinagmumulan.
  const orderIds = [...new Set([
    ...(decls ?? []).map((d) => d.order_id as number | null),
    ...(dels ?? []).map((x) => x.order_id as number | null),
  ].filter((x): x is number => x != null))];

  const orderById = new Map<number, OrderInfo>();
  const itemsByOrder = new Map<number, { name: string; key: string; qty: number; image: string | null; sku: string | null; category: string | null; specs: string[] }[]>();
  if (orderIds.length) {
    const { data: os } = await db.from("orders")
      .select("id, order_number, customer_name, address, dq_team, dq_driver, dq_date, dq_status, dq_route_final_at, dq_items, receipt_items")
      .in("id", orderIds);
    for (const o of os ?? []) {
      orderById.set(o.id as number, {
        number: (o.order_number as string | null) ?? null,
        customer: (o.customer_name as string | null) ?? null,
        address: (o.address as string | null) ?? null,
        team: (o.dq_team as string | null) ?? null,
        driver: (o.dq_driver as string | null) ?? null,
        batch: Array.isArray((o as Record<string, unknown>).dq_items) && ((o as Record<string, unknown>).dq_items as string[]).length
          ? keySet((o as Record<string, unknown>).dq_items)
          : null,
        date: (o.dq_date as string | null) ?? null,
        confirmed: String(o.dq_status ?? "") === "confirmed",
        // ANG ROUTE PLANNER ANG GATE (2026-08-26). Hindi sapat ang confirm ng
        // customer: hangga't hindi naipapadala ng Ops ang ruta sa team, walang
        // nakatalagang sumundo. Ang Send ang nagsesellyo nito — iisang selyo ng
        // Pickup Task at ng Delivery Route.
        routed: !!(o as Record<string, unknown>)["dq_route_final_at"],
      });
      const lines = ((o.receipt_items as { description?: string | null; qty?: number; image?: string | null; sku?: string | null; category?: string | null; color?: string | null }[] | null) ?? [])
        .map((it) => ({
          name: firstLine(it.description),
          // KASAMA ANG KULAY (2026-09-06): "pangalan @ kulay" — susi ng batch.
          key: lineKey(it.description, it.color),
          qty: Number(it.qty) || 1,
          image: photo(firstLine(it.description), it.sku as string | null, it.color as string | null, it.description, (it.image as string | null) ?? null),
          sku: (it.sku as string | null) ?? null,
          category: categoryOf(it.category, it.sku, it.description),
          specs: specLines(it.description),
        }))
        .filter((it) => it.name && !isFee(it.name));
      itemsByOrder.set(o.id as number, lines);
    }
  }

  // ── Mga stop mula sa WORKSHOP ─────────────────────────────────────────────
  for (const d of decls ?? []) {
    const job = d.job_id != null ? jobById.get(d.job_id as number) : undefined;
    // Nasa bodega na — dumaan na ito rito, at ang delivery na ang humahawak.
    if (job?.received) continue;
    // NAIHATID NA SA BODEGA (0220) — tapos na ang haul; nasa Receiving QC na
    // ang susunod na hakbang, wala nang gagawin ang trak dito.
    if (job?.dropped) continue;

    const order = d.order_id != null ? orderById.get(d.order_id as number) : undefined;
    const isStock = !!job?.stock;

    // ANG TO-WAREHOUSE AY WALANG CUSTOMER GATE (2026-08-26). Ang gate sa ibaba
    // ay confirm ng customer + ruta ng Route Planner — pero ang deklarasyong
    // "To Warehouse" ay walang customer na kokompirma at walang rutang darating
    // kailanman: workshop → bodega lang ito. Kaya ang ORD-000001 na mattress ay
    // QC Passed nang nakabara — hindi lumilitaw sa Pickup Task ng kahit sinong
    // team, at ang Delivery Queue ay naghihintay ng received na hindi darating.
    // Katulad ng stock build ang turing: kita sa lahat ng team, unang dumating
    // ang sumundo, at ang deliver-to ay ang bodega.
    const toWarehouse = job?.fulfillment === "warehouse";
    // ANG CLAIM (0218): ang stop na kita ng lahat ng team (to-warehouse haul,
    // stock build) ay nagiging SA ISANG TEAM sa unang Start — ang pickup_team
    // ang tatak, at nawawala ito sa listahan ng iba. "Sino mag pick up na
    // team, sa kanya na" (Joe, 2026-08-31).
    if (isStock || toWarehouse) {
      const claimed = ((d as Record<string, unknown>).pickup_team as string | null) ?? null;
      if (claimed && slug(claimed) !== slug(team)) continue;
    }
    if (!isStock && !toWarehouse) {
      // Confirm ng customer, TAPOS ipinadala ng Route Planner sa team. Ang
      // pangalawa ang tunay na gate: doon naitatalaga kung sino ang susundo.
      if (!order?.confirmed || !order.routed) continue;
      if (!order.team || slug(order.team) !== slug(team)) continue;
      // PARTIAL BATCH: ang item na wala sa batch ng biyaheng ito ay susunduin
      // sa SUSUNOD na biyahe — huwag ipakita ngayon, baka makuha nang maaga.
      if (order.batch) {
        const name = firstLine(d.item as string | null).replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "").trim().toLowerCase();
        if (name && !hasKey(order.batch, joinKey(name, colorOfDesc(d.item as string | null)))) continue;
      }
    }

    const ws = job?.workshop_id != null ? wsById.get(job.workshop_id) : undefined;

    stops.push({
      source: "workshop",
      declaration_id: d.id as number,
      delivery_id: null,
      job_id: (d.job_id as number | null) ?? null,
      line_key: null,
      place: ws?.name || (d.workshop as string | null) || "Workshop",
      place_address: ws?.location ?? null,
      place_lat: ws?.lat ?? null,
      place_lng: ws?.lng ?? null,
      item: firstLine(d.item as string | null) || "Item",
      item_image: photo(firstLine(d.item as string | null), job?.sku ?? null, null, d.item as string | null, (d.item_image as string | null) ?? null),
      sku: job?.sku ?? skuByName.get(firstLine(d.item as string | null).replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "").trim().toLowerCase()) ?? null,
      category: (d.category as string | null) ?? null,
      specs: specLines(d.item as string | null),
      qty: job?.qty ?? 1,
      order_number: isStock ? null : ((d.order_number as string | null) ?? order?.number ?? null),
      customer: isStock ? null : (order?.customer ?? null),
      stock: isStock,
      refund: !!(job?.stock && /^refund/i.test(job?.stockReason ?? "")),
      // Ang stock at ang to-warehouse na ruta ay parehong dinadala sa bodega;
      // ang direct pickup lang ang diretso sa customer.
      to_warehouse: isStock || job?.fulfillment === "warehouse",
      drop_arrived: !!job?.dropArrived,
      drop_signature: job?.dropSignature ?? null,
      drop_photos: job?.dropPhotos ?? [],
      drop_address: isStock || job?.fulfillment === "warehouse" ? warehouseAddress : null,
      drop_lat: isStock || job?.fulfillment === "warehouse" ? warehouseLat : null,
      drop_lng: isStock || job?.fulfillment === "warehouse" ? warehouseLng : null,
      deliver_to: isStock || job?.fulfillment === "warehouse" ? WAREHOUSE : (order?.address ?? "—"),
      deliver_on: isStock ? null : (order?.date ?? null),
      started_at: (d.pickup_started_at as string | null) ?? null,
      arrived_at: (d.pickup_arrived_at as string | null) ?? null,
      from_lat: (d.pickup_lat as number | null) ?? null,
      from_lng: (d.pickup_lng as number | null) ?? null,
      picked_at: (d.pickup_at as string | null) ?? null,
      picked_by: (d.pickup_by as string | null) ?? null,
      driver: (d.pickup_by as string | null) ?? order?.driver ?? teamDriver,
      photos: pickPhotos(d.pickup_photos) ?? [],
      signature: (d.pickup_signature as string | null) ?? null,
      good: (d.pickup_good as number | null) ?? null,
      defect: (d.pickup_defect as number | null) ?? null,
      remarks: (d.pickup_remarks as string | null) ?? null,
      notes: (d.pickup_notes as string | null) ?? null,
      rejected_at: (d.pickup_rejected_at as string | null) ?? null,
      reject_reason: (d.pickup_reject_reason as string | null) ?? null,
    });
  }

  // ── Mga stop mula sa BODEGA ───────────────────────────────────────────────
  // Ang item na ginawa sa WORKSHOP ay hindi pa nakakarating sa istante — isang
  // beses lang ito kukunin, at doon sa pinaggawaan. Kapag nakuha na at dumaan
  // sa Receiving QC, saka lang ito lilitaw dito.
  //
  // KADA ITEM, HINDI KADA ORDER (2026-08-29). Ang buong order ang hinaharang
  // noon: kapag may isang item na hinihintay sa workshop, nawawala ang LAHAT ng
  // iba sa listahan ng bodega. Pero ang ORD-000003 ay may tatlong produkto na
  // dalawa ay NA-SKIP sa Order Approval — nasa istante na sila, hindi
  // kailanman pupunta sa workshop. Ang paghahanay ay nagtatago sa dalawang
  // iyon, kaya isang stop lang ang nakikita ng driver at iiwan niya ang dalawa.
  //
  // Ang tamang harang ay sa ITEM na mismong hinihintay: ang PANGALAN ng linya
  // na may workshop stop sa parehong order.
  //
  // DALAWANG BUTAS, ISANG DOBLENG HILERA (2026-08-31, "bakit naging dalawa"):
  // ang ORD-000007 ay sabay na nakalista sa GMA Workshop (haul) AT sa Warehouse
  // (redelivery) dahil (1) ang susi ay hindi tugma — ang workshop stop ay
  // "Rework · RMA-000016 · PAN Accent Chair v.01" pero ang linya ng order ay
  // "PAN Accent Chair v.01", kaya hindi nagbanggaan ang harang; at (2) ang
  // stop na NAKA-DROP na pero hindi pa na-receive sa QC ay wala na sa workshop
  // stops, kaya bumubukas agad ang warehouse row kahit wala pa sa istante ang
  // gamit. Kaya: mula sa MISMONG declarations ang harang (hanggang ma-receive
  // ng bodega), at tinatanggal ang "Rework · RMA-… ·" na unahan bago itumbas.
  const awaitKey = (n: string) => n.trim().toLowerCase().replace(/^rework\s*·\s*(rma-\d+\s*·\s*)?/i, "").trim();
  const awaitedItems = new Set<string>();
  for (const d of decls ?? []) {
    const job = d.job_id != null ? jobById.get(d.job_id as number) : undefined;
    if (job?.received) continue; // nasa istante na — malaya na ang warehouse row
    // ANG DIRECT-PICKUP AY HANGGANG MAKUHA LANG ANG HARANG. Ang fulfillment na
    // "pickup" ay hindi dumadaan sa Receiving QC kailanman — kung "hanggang
    // received" din ito, ang susi nito ay naka-block habambuhay at ang
    // magiging warehouse redelivery ng PAREHONG order+item balang araw ay
    // hindi na lilitaw. Ang papunta sa BODEGA lang ang tumatagal na harang.
    const toWh = !!job && (job.stock || job.fulfillment === "warehouse");
    if (!toWh && (d.pickup_at as string | null)) continue;
    const on = (d.order_number as string | null)
      ?? (d.order_id != null ? orderById.get(d.order_id as number)?.number ?? null : null);
    // KASAMA ANG KULAY (2026-09-06): "order|pangalan @ kulay" (hasKey ang
    // tumutugma sa lumang susing walang kulay).
    if (on) awaitedItems.add(`${on}|${joinKey(awaitKey(firstLine(d.item as string | null)), colorOfDesc(d.item as string | null))}`);
  }

  for (const dl of dels ?? []) {
    const oid = dl.order_id as number | null;
    if (oid == null) continue;
    const o = orderById.get(oid);
    // Kaparehong gate ng workshop: confirm ng customer, tapos ipinadala na ng
    // Route Planner sa team.
    if (!o?.confirmed || !o.routed) continue;

    // ANG dq_team ANG TEAM. Ang deliveries.driver_team ay may hawak ng pangalan
    // ng DRIVER ("Roger Ederango"), hindi ng team — kaya hindi ito matutugma sa
    // "Team A" kahit kailan. Ang order ang may hawak ng tunay na pagtatalaga.
    if (!o.team || slug(o.team) !== slug(team)) continue;


    // ISANG HILERA KADA ITEM. Ang SKU at ang build ang nagbubukod sa dalawang
    // "Costumized Bed" ng iisang order — kaya hindi sila pinagsasama sa isang
    // hilera. Ang selyo ng pagkuha ay KADA LINYA (deliveries.pickup_lines,
    // 0206) — ang `pickup_at` ay isa lang kada order, kaya noong iyon lang ang
    // tinatanong, ang pagkuha ng isang linya ay nag-aalis ng LAHAT ng linya ng
    // order sa listahan. Ang order-wide na selyo ay nananatili para sa Delivery
    // Route ("nakapagsimula na ba ang pagkarga ng order na ito").
    const pickedLines = (dl.pickup_lines as Record<string, { at?: string; by?: string; photos?: string[] }> | null) ?? null;
    const linesAll = itemsByOrder.get(oid) ?? [];
    // KAILAN PA MAAARING MAGING PAMBALIK ANG ORDER-WIDE NA LITRATO. Kapag isang
    // linya lang ang order, walang duda kung kanino iyon. Kapag marami, hindi
    // mapagsasabi — at nang gamitin itong pambalik, ang bagong linya ay
    // nagsimula nang may "9 photos" na hiram sa kapitbahay nito at pumasa ang
    // gate nang walang bagong kuha.
    const sharedProof = linesAll.length <= 1;
    // PARTIAL BATCH: ang mga linya ng kasalukuyang batch lang ang stops.
    let lines = o?.batch ? linesAll.filter((l) => hasKey(o.batch!, l.key)) : linesAll;
    // BIYAHENG REWORK (may return_id): ang ON-SITE ay pagbisita lang — walang
    // kukunin kahit saan, walang stop; ang pull-out redelivery ay ang INAYOS
    // NA LINYA LANG, hindi ang buong order.
    const ret = (() => {
      const rid = (dl as Record<string, unknown>).return_id as number | null;
      return rid != null ? retById.get(rid) : undefined;
    })();
    if (ret?.mode === "onsite") continue;
    // ANG REFUND AY WALANG REDELIVERY (2026-09-01): ang pickup na deliveries
    // row nito ay pang-kuha-sa-customer lang; pagka-stock-in ay sarado na —
    // walang kukunin sa bodega kailanman.
    if (ret?.resolution === "refund") continue;
    // HINDI PA TAPOS ANG REWORK = WALANG KUKUNIN SA BODEGA (2026-09-01,
    // "nasira na naman ung scenario"): ang redelivery row ay nabubuo na sa
    // RMA approval pa lang, pero ang gamit ay nasa CUSTOMER pa (hindi pa
    // napu-pull-out) o inaayos pa sa workshop. Ang warehouse leg ay bumubukas
    // lang kapag selyado na ang reworked_at — ang stock-in ng inayos na unit.
    // At ang DIREKTANG redelivery (workshop → customer) ay walang warehouse
    // leg KAILANMAN — ang workshop pickup stop ang buong biyahe nito.
    if (ret && (!ret.reworked || ret.direct)) continue;
    if (ret) {
      const rn = awaitKey(firstLine(ret.item_desc));
      const rwRef = { item_desc: ret.item_desc, sku: ret.sku, color: ret.color };
      const hit = rn ? linesAll.filter((l) => awaitKey(l.name) === rn && isReworkLine(rwRef, { description: l.name, sku: l.sku, color: keyColor(l.key) || null })) : [];
      lines = hit.length ? hit : [{
        name: firstLine(ret.item_desc) || "Item",
        key: lineKey(ret.item_desc),
        qty: ret.qty,
        image: photo(firstLine(ret.item_desc), ret.sku, ret.color, ret.item_desc, null),
        sku: ret.sku,
        category: null,
        specs: specLines(ret.item_desc),
      }];
    }
    if (!lines.length) continue;

    for (const [li, l] of lines.entries()) {
      // Ang linyang may workshop stop ay kukunin doon, hindi sa istante —
      // laktawan dito para hindi dalawang beses lumitaw ang isang produkto.
      if (o.number && hasKey(awaitedItems, joinKey(awaitKey(l.name), keyColor(l.key)), `${o.number}|`)) continue;
      const lineKey = `${li}:${l.name.trim().toLowerCase()}`;
      // Ang linyang ito lang. Kapag walang `pickup_lines` (lumang talaan o
      // hindi pa tumakbo ang 0206), bumalik sa order-wide na selyo: kumikilos
      // ang mga lumang order gaya ng dati — buong order ang nakuha.
      // ANG SELYO AY SA PANGALAN, HINDI SA INDEX (2026-09-01, "need pa 2x
      // i-fill"): ang lineKey ay "<index>:<pangalan>", pero ang index ay
      // nagbabago kapag nagbago ang bilang ng linya (partial batch, rework
      // filter, deploy sa pagitan) — ang "1:pan accent chair v.02" na selyado
      // ay hindi na nabasa nang maging "0:pan accent chair v.02" ang hinahanap,
      // kaya inulit ng driver ang buong proof. Ang pangalan ang tunay na
      // pagkakakilanlan; ang index ay pang-doble lang ng magkaparehong item.
      // Pero kapag DALAWA ang magkaparehong pangalan sa order (dalawang
      // "Customized Bed"), ang index pa rin ang nagbubukod — ang name-fallback
      // ay para lang sa kakaisang pangalan, para hindi maghiraman ng selyo.
      const nameOfKey = (k: string) => k.split(":").slice(1).join(":");
      const nameUnique = lines.filter((x) => x.name.trim().toLowerCase() === l.name.trim().toLowerCase()).length === 1;
      const mine = pickedLines?.[lineKey]
        ?? (pickedLines && nameUnique
          ? Object.entries(pickedLines).find(([k]) => nameOfKey(k) === nameOfKey(lineKey))?.[1]
          : undefined);
      const linePicked = pickedLines ? (mine?.at ?? null) : ((dl.pickup_at as string | null) ?? null);
      stops.push({
        source: "warehouse",
        // Mula bodega papuntang customer — walang drop-sa-bodega na hakbang.
        to_warehouse: false,
        drop_address: null, drop_lat: null, drop_lng: null,
        drop_arrived: false, drop_signature: null, drop_photos: [],
        declaration_id: null,
        delivery_id: dl.id as number,
        job_id: null,
        line_key: lineKey,
        place: WAREHOUSE,
        place_address: warehouseAddress,
        place_lat: warehouseLat,
        place_lng: warehouseLng,
        item: l.name,
        item_image: l.image,
        sku: l.sku,
        category: l.category,
        specs: l.specs,
        qty: l.qty,
        order_number: o.number,
        customer: o.customer,
        stock: false,
        refund: false,
        deliver_to: o.address ?? "—",
        deliver_on: (dl.schedule_date as string | null) ?? o.date,
        started_at: (dl.pickup_started_at as string | null) ?? null,
        arrived_at: (dl.pickup_arrived_at as string | null) ?? null,
        from_lat: (dl.pickup_lat as number | null) ?? null,
        from_lng: (dl.pickup_lng as number | null) ?? null,
        picked_at: linePicked,
        picked_by: mine?.by ?? (dl.pickup_by as string | null) ?? null,
        driver: (dl.pickup_by as string | null) ?? o.driver ?? teamDriver,
        // Ang litrato ng LINYANG ITO, kung naitala nang per-linya. Ang
        // order-wide na `pickup_photos` ay pinagsama-samang patunay ng maraming
        // produkto — hindi larawan ng iisang bagay na nasa trak.
        // WALANG HIRAM NA PATUNAY (naranasan 2026-08-29). Ang `pickup_photos`
        // ay order-wide, kaya nang gamitin itong pambalik ng bawat linya, ang
        // BAGONG linya ay nagsimula nang may "9 photos" — litrato iyon ng
        // kapitbahay nito, at pumapasa ang gate nang walang bagong kuha. Kapag
        // may talaan nang per-linya sa order na ito, ang linyang ito lang ang
        // pinagmumulan; ang blangko ay tama, hindi kulang.
        //
        // (Ang `pickPhotos` ay array lang ang tinatanggap: ang `pickup_photos`
        // ay jsonb at ang isang `{}` doon ay naging `NaN / 3` sa card.)
        photos: pickPhotos(mine?.photos) ?? (sharedProof ? pickPhotos(dl.pickup_photos) ?? [] : []),
        signature: (dl.pickup_signature as string | null) ?? null,
        good: (dl.pickup_good as number | null) ?? null,
        defect: (dl.pickup_defect as number | null) ?? null,
        remarks: (dl.pickup_remarks as string | null) ?? null,
        notes: (dl.pickup_notes as string | null) ?? null,
        rejected_at: (dl.pickup_rejected_at as string | null) ?? null,
        reject_reason: (dl.pickup_reject_reason as string | null) ?? null,
      });
    }
  }

  // ANG NAKUHA NA AY UMAALIS SA LISTAHAN. Ito ay listahan ng LALAKARIN, hindi
  // talaan ng nagawa: ang tapos nang hilera ay nakaharang lang sa hindi pa. Ang
  // tala nito ay nananatili sa qc_declarations/deliveries, at ang bagay mismo
  // ay lumilitaw na sa Delivery Route.
  //
  // Ang tinanggihan ay NANATILI: hindi pa iyon nakukuha, at may babalikan pa.
  // ANG NAKUHANG PA-BODEGA AY HINDI PA TAPOS (0220/0221). Umaalis sa listahan
  // ang nakuha na — pero ang to-warehouse na haul ay may isa pang hakbang: ang
  // Drop Proof sa pagdating. Nawala ito sa listahan noon pagka-pickup, kaya
  // walang mapindutang "Dropped at Warehouse" at ang trabaho ay hindi
  // kailanman nakarating sa Workshop (IN). Nananatili ito hanggang ma-drop.
  const pending = stops.filter((s) => !s.picked_at || s.to_warehouse);

  // Pangkat kada lugar — isang biyahe ang isang lugar, kaya magkasama ang lahat
  // ng kukunin doon. Ang bodega ay nasa dulo ng listahan: doon karaniwang
  // tumitigil bago tumulak palabas.
  const byPlace = new Map<string, PickupGroup>();
  for (const s of pending) {
    const g = byPlace.get(s.place) ?? { place: s.place, address: s.place_address, stops: [] };
    g.stops.push(s);
    byPlace.set(s.place, g);
  }
  const groups = [...byPlace.values()];
  groups.sort((a, b) =>
    Number(a.place === WAREHOUSE) - Number(b.place === WAREHOUSE) || a.place.localeCompare(b.place));

  // ANG GATE: hindi bumubukas ang order sa Delivery Route hangga't may
  // natitirang item na hindi pa nakukuha — kung hindi, hahatid ang driver ng
  // kalahating order.
  const byOrder = new Map<string, { got: number; of: number }>();
  for (const s of stops) {
    if (!s.order_number) continue;
    const c = byOrder.get(s.order_number) ?? { got: 0, of: 0 };
    c.of += 1;
    if (s.picked_at) c.got += 1;
    byOrder.set(s.order_number, c);
  }
  const waiting = [...byOrder.entries()]
    .filter(([, c]) => c.got < c.of && c.got > 0)
    .map(([order_number, c]) => ({ order_number, got: c.got, of: c.of }));

  return {
    team,
    groups,
    total: stops.length,
    picked: stops.filter((s) => s.picked_at).length,
    remaining: pending.length,
    waiting,
  };
}
