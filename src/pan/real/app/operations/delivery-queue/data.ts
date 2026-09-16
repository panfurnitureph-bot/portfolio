import { createServerSupabase, type OrderRow } from "@/lib/supabase/server";
import { clusterByProximity, type Cluster } from "@/lib/delivery/cluster";
import { loadSkipRows } from "@/lib/ops/skips";
import { lineKey, joinKey, colorOfDesc, hasKey } from "@/lib/orders/line-key";
import { isReworkLine, type ReworkRef } from "@/lib/orders/rework-match";

// DELIVERY QUEUE data — dalawang pool:
//   For Scheduling  = QC-passed na order na WALA pang confirmation na naipadala
//                     (dq_status null) → naka-cluster by delivery-location proximity
//   Awaiting Confirm = na-emailan na (dq_status 'pending') → grouped pa rin,
//                     hinihintay ang Confirm ng customer
// Ang confirmed (dq_status 'confirmed') ay nasa EXISTING Delivery module na.

export type QueueOrder = {
  id: number;
  order_number: string | null;
  customer_name: string | null;
  sales_rep: string | null;
  address: string | null;
  email: string | null;
  balance: number;
  lat: number | null;
  lng: number | null;
  is_rush: boolean;
  rush_days: number | null;
  date_order: string | null;
  // ANG PANGAKONG PETSA SA CUSTOMER (hiling 2026-08-28). Ang `Proposed Sched.`
  // ay ang petsang itatakda pa ng planner; ito ang nakasulat sa order noong
  // binili — at iyon ang batayan kung alin ang unang iruruta. Wala ito sa
  // listahan noon, kaya walang makikitang deadline ang nag-iiskedyul.
  date_of_delivery: string | null;
  // Ang mga produkto ng order — para may mabuksang preview sa mismong hilera.
  // `ready` kada produkto (2026-08-29): ang bilang na "2 of 4" ay hindi
  // nagsasabi kung ALIN — at iyon ang tinatanong ng nagpaplano bago mag-load.
  //
  // `source` — SAAN galing ang produkto (2026-08-29): "stock" kung na-skip sa
  // Order Approval (kukunin sa warehouse), "workshop" kung ginawa. Pareho silang
  // "ready", pero magkaibang lugar ang pupuntahan ng nagpi-pick — at hindi
  // masasabi ng bilang na "3 of 3" kung alin ang kukunin sa istante at alin ang
  // nakahanda na sa workshop.
  items: { description: string | null; image: string | null; sku: string | null; qty: number; color: string | null; dimension: string | null; ready: boolean; delivered: boolean; source: "stock" | "workshop" | null }[];
  // Rework redelivery/pickup — tag sa queue rows.
  is_rework: boolean;
  rma_no: string | null;
  // ILANG PRODUKTO ANG ORDER (2026-08-26) - ang isang stop ay maaaring apat na
  // produkto; kailangan itong kita ng nagpaplano at ng driver.
  items_total: number;
  items_ready: number;
  // PARTIAL DELIVERY (0200): ilang linya na ang naihatid sa naunang batch.
  items_delivered: number;
  // queue state (Awaiting Confirm)
  dq_group: string | null;
  dq_date: string | null;
  dq_team: string | null;
  dq_driver: string | null;
  dq_sent_at: string | null;
  dq_followups: number;
};

export type Team = { id: number; name: string; driver: string | null; vehicle: string | null; capacity: number };
export type Driver = { name: string; reserved: boolean };

export type QueueData = {
  forScheduling: Cluster<QueueOrder & { lat: number | null; lng: number | null }>[];
  awaiting: { group: string; date: string | null; team: string | null; driver: string | null; members: QueueOrder[] }[];
  teams: Team[];
  // Lahat ng driver (kasama ang mga RESERVED — walang sariling van, pamalit lang).
  drivers: Driver[];
  counts: { forScheduling: number; awaiting: number };
  // Buong OrderRow ng bawat nasa queue — para sa row-click → Edit Order modal.
  orderRows: OrderRow[];
  // Rework tag bawat order id (RMA number) — para sa schedule tool at iba pa.
  reworkTags: Record<number, string | null>;
};

export async function loadDeliveryQueue(): Promise<QueueData> {
  const db = createServerSupabase();
  const [{ data: orders }, { data: wjobs }, { data: dels }, { data: teams }, { data: reworkRets }, { data: prepackQc }, skipRows] = await Promise.all([
    // select * — kailangan ang BUONG order row para sa row-click → Edit Order modal.
    db.from("orders")
      .select("*")
      .order("date_order", { ascending: false }).order("id", { ascending: false })
      .limit(5000),
    db.from("workshop_job").select("order_id, status, fulfillment, qc_received_at, item_desc").limit(10000),
    db.from("deliveries").select("order_id, status, delivered_at").limit(10000),
    db.from("delivery_teams").select("id, name, driver, vehicle, capacity, reserved").eq("active", true).order("name"),
    db.from("returns").select("id, order_id, return_no, status, reworked_at, rework_charge_total, rework_downpayment, item_desc, sku, color").eq("resolution", "rework").order("id", { ascending: false }).limit(5000),
    // Pre-pack QC pass (skip-workshop / direct-stock lines): pagkatapos ng
    // Quality Control (OUT), diretso sa Delivery Queue ang order.
    db.from("warehouse_qc").select("ref_id, ref_label").eq("checkpoint", "prepack").eq("source", "order").eq("result", "pass").limit(10000),
    loadSkipRows(db),
  ]);

  // PARTIAL DELIVERY (0200): ang mga linyang naihatid na sa naunang batch ay
  // wala na sa bilang ng pila — ang natitira lang ang hinihintay. Best-effort:
  // wala pang 0200 → walang partial, buong order pa rin ang batayan.
  const deliveredLines = new Map<number, Set<string>>();
  try {
    const { data: old } = await db.from("order_line_deliveries").select("order_id, item_desc").limit(20000);
    for (const r of (old ?? []) as { order_id: number; item_desc: string | null }[]) {
      const k = lineKey(r.item_desc);
      if (!k) continue;
      (deliveredLines.get(r.order_id) ?? deliveredLines.set(r.order_id, new Set()).get(r.order_id)!).add(k);
    }
  } catch { /* wala pang 0200 */ }
  // May rework ang order → tag sa queue rows (persistent, kahit tapos na).
  const reworkByOrder = new Map<number, string | null>();
  // HOLD sa queue: aktibong rework na HINDI pa tapos ang repair (pickup/workshop
  // phase) — hindi pa dapat lumabas sa For Scheduling; babalik pagkatapos ng QC.
  const reworkHold = new Set<number>();
  // RMA ledger: ang rework charge/bayad ay nasa returns — ang natitirang due nito
  // ang tunay na Balance ng redelivery (hindi ang orders ledger, na kasama na sa
  // charge). Newest return first (ordered query) → first-wins.
  const reworkDueByOrder = new Map<number, number>();
  // ALIN ANG INAAYOS (2026-08-29). Ang redelivery ay may isang gamit — ang
  // inayos. Ang buong order dito ay nagpapakita ng dalawang "Still in
  // production" na nasa customer na mula pa noong unang hatid, at binibilang
  // silang hindi handa kaya "1 ready" ang stop na buo naman.
  // KASAMA ANG KULAY (2026-09-06, lib/orders/rework-match): ang RMA ng isang
  // leather ay hindi tumatama sa kapatid nitong ibang kulay sa parehong order.
  const reworkItemByOrder = new Map<number, ReworkRef>();
  for (const r of (reworkRets ?? []) as { order_id: number | null; return_no: string | null; status: string | null; reworked_at: string | null; rework_charge_total?: number | null; rework_downpayment?: number | null; item_desc?: string | null; sku?: string | null; color?: string | null }[]) {
    if (r.order_id == null || /reject|pending/i.test(r.status ?? "")) continue;
    // Ang PINAKABAGO ang panalo (2026-08-28): `created_at desc` ang query, kaya
    // ang una ang pinakabago — pero `.set()` lang ay ang huli (pinakaluma) ang
    // maiiwan. Ang order na may tatlong RMA ay nagpapakita ng maling numero.
    if ((/rework|completed/i.test(r.status ?? "") || r.reworked_at) && !reworkByOrder.has(r.order_id)) {
      reworkByOrder.set(r.order_id, r.return_no ?? null);
      // `fl` ay nakadeklara sa ibaba pa; kaparehong ginagawa nito — unang linya,
      // pinutol, maliit na titik.
      const rname = String(r.item_desc ?? "").split("\n")[0].trim().toLowerCase();
      if (rname || r.sku) reworkItemByOrder.set(r.order_id, { item_desc: r.item_desc ?? null, sku: r.sku ?? null, color: r.color ?? null });
    }
    if (/rework/i.test(r.status ?? "") && !r.reworked_at) reworkHold.add(r.order_id);
    const charge = Number(r.rework_charge_total) || 0;
    if (charge > 0 && !reworkDueByOrder.has(r.order_id))
      reworkDueByOrder.set(r.order_id, Math.max(Math.round((charge - (Number(r.rework_downpayment) || 0)) * 100) / 100, 0));
  }

  // QC-passed = schedulable (parehong tuntunin ng Delivery module):
  //   pickup → QC Passed mismo; warehouse → received na sa stock.
  const qcPassed = new Set<number>();
  for (const j of (wjobs ?? []) as { order_id: number | null; status: string | null; fulfillment: string | null; qc_received_at: string | null }[]) {
    if (j.order_id == null) continue;
    const isPickup = j.fulfillment === "pickup";
    const passed = /qc passed/i.test(j.status ?? "");
    const received = !!j.qc_received_at || /received/i.test(j.status ?? "");
    if ((isPickup && passed) || (!isPickup && received)) qcPassed.add(j.order_id);
  }
  // Pre-pack QC OUT pass → schedulable din (walang workshop job ang skip lines).
  for (const q of (prepackQc ?? []) as { ref_id: number | null }[]) {
    if (q.ref_id != null) qcPassed.add(q.ref_id);
  }

  // ── HANDA BA ANG BAWAT PRODUKTO? (2026-08-26) ─────────────────────────
  // Ang qcPassed ay kada ORDER: isang produktong pumasa ay naglalagay ng buong
  // order sa For Scheduling. Sa order na apat ang produkto — dalawa pa sa
  // workshop, isa pang hindi na-a-assign — ang stop ay naipapadala nang kulang.
  //
  // Kada LINYA ng resibo (bawas ang fees at ang constructor flow):
  //   • may workshop job → handa kapag pasado (pickup: QC Passed;
  //     warehouse: received na sa stock);
  //   • na-skip ("No Workshop") → HANDA NA: stock ito ng warehouse, nakareserba
  //     na mula pa sa order commit. Ang QC for OUT ay ginagawa sa paglalabas sa
  //     bodega (araw ng dispatch) — hindi ito hinihintay ng scheduling (ayon
  //     kay Joe, 2026-08-26);
  //   • wala pareho → hindi pa handa — hindi pa ito na-a-assign.
  const fl = (t: string | null | undefined) => (t ?? "").split("\n")[0].trim().toLowerCase();
  const isFee = (d: string) => /^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test(d);
  // KASAMA ANG KULAY (2026-09-06, lib/orders/line-key): "<order>|<pangalan @ kulay>"
  // — ang job/skip ng isang kulay ay hindi nagpapahanda sa ibang kulay ng
  // parehong produkto. Ang legacy na susi (pangalan lang) ay tumutugma sa lahat.
  const jobByLine = new Map<string, boolean>();
  for (const j of (wjobs ?? []) as { order_id: number | null; status: string | null; fulfillment: string | null; qc_received_at: string | null; item_desc?: string | null }[]) {
    if (j.order_id == null) continue;
    // ANG REWORK JOB AY MAY SARILING HOLD habang ginagawa (reworkHold) — pero
    // pagkatapos ng QC ay ito na lang ang PATUNAY na handa ang gamit: walang
    // ibang job na darating para sa linyang iyon (2026-08-28).
    //
    // Lumalaktaw ito noon, kaya ang order na puro rework ang linya ay walang
    // naitatalang handa: `ready` = 0, at hindi na ito bumabalik sa Delivery
    // Queue kahit tapos na ang repair at inalis na ang hold — nawawala ito sa
    // dalawang panig: wala sa Queue, wala rin sa Route Planner.
    //
    // Ang pangalan ng linya ay nasa ilalim ng "Rework · RMA-000006 · " na unahan.
    let name = fl(j.item_desc);
    if (/^rework/i.test(name)) {
      // Habang hindi pa QC passed ay walang itinatala: ang hold ang bahala doon,
      // at ang pag-uulat ng handa bago matapos ang repair ay mas masama.
      //
      // ANG "RECEIVED" AY LAMPAS NA SA QC PASSED (2026-08-31). Ang To-Warehouse
      // na rework ay nagiging "Received" pagkatapos ng stock-in — mas malayo na
      // sa QC Passed — pero ang bantay dito ay "QC Passed" LANG ang hinahanap,
      // kaya nilalaktawan ang tapos nang trabaho: ready = 0, at ang redelivery
      // ng ORD-000001 ay hindi kailanman lumitaw sa Delivery Queue.
      if (!/qc passed|received/i.test(j.status ?? "") && !j.qc_received_at) continue;
      name = name.replace(/^\s*rework\s*·\s*(rma-\d+\s*·\s*)?/i, "").trim();
    }
    if (!name) continue;
    const isPickup = j.fulfillment === "pickup";
    const ready = isPickup
      ? /qc passed/i.test(j.status ?? "")
      : !!j.qc_received_at || /received/i.test(j.status ?? "");
    const key = `${j.order_id}|${joinKey(name, colorOfDesc(j.item_desc))}`;
    // Kapag dalawang job ang iisang linya, ang handa ang panalo — ang muling
    // pagpasok ay hindi dapat magpabalik ng naihatid nang estado.
    jobByLine.set(key, (jobByLine.get(key) ?? false) || ready);
  }
  const jobReadyKeys = new Set([...jobByLine].filter(([, r]) => r).map(([k]) => k));
  const jobAnyKeys = new Set(jobByLine.keys());
  const skippedLine = new Set(skipRows.map((x) => `${x.order_id}|${lineKey(x.item_desc, x.color)}`));
  const lineReady = (orderId: number, desc: string | null | undefined, color: string | null | undefined) => {
    const k = lineKey(desc, color), p = `${orderId}|`;
    return hasKey(jobReadyKeys, k, p) || hasKey(skippedLine, k, p);
  };
  const itemsOf = (o: OrderRow): { total: number; ready: number; delivered: number } => {
    // Sa REDELIVERY ng rework, ang inayos lang ang binibilang: kung buo ang
    // order ang tinatanong, ang dalawang nasa customer na ay nabibilang na
    // hindi handa at ang stop na buo naman ay "1 ready (2 from workshop)".
    const rw = reworkItemByOrder.get(o.id);
    const all = (o.receipt_items ?? []) as { description?: string | null; constructorName?: string | null; sku?: string | null; color?: string | null }[];
    const rwOnly = rw ? all.filter((x) => isReworkLine(rw, x)) : [];
    const items = rwOnly.length ? rwOnly : all;
    const done = deliveredLines.get(o.id);
    let total = 0, ready = 0, delivered = 0;
    for (const it of items) {
      const name = fl(it.description);
      if (!name || isFee(name)) continue;
      if (it.constructorName) continue; // hiwalay na daloy ang constructor
      // Ang naihatid na sa naunang batch ay tapos na — hindi na hinihintay.
      if (hasKey(done, lineKey(it.description, it.color))) { delivered++; continue; }
      total++;
      if (lineReady(o.id, it.description, it.color)) ready++;
    }
    return { total, ready, delivered };
  };
  // Ang may delivery record na umaandar/tapos na ay wala na sa queue.
  const inMotion = new Set<number>();
  for (const d of (dels ?? []) as { order_id: number | null; status: string | null; delivered_at: string | null }[]) {
    if (d.order_id != null && (d.delivered_at || /out for delivery|arrived|delivered|installation/i.test(d.status ?? ""))) inMotion.add(d.order_id);
  }

  type Row = OrderRow & { dq_group: string | null; dq_status: string | null; dq_date: string | null; dq_team: string | null; dq_driver: string | null; dq_sent_at: string | null; dq_followups: number | null };
  const toQueue = (o: Row): QueueOrder => ({
    id: o.id,
    order_number: o.order_number ?? null,
    customer_name: o.customer_name ?? null,
    sales_rep: o.assigned ?? null,
    address: o.address ?? null,
    email: o.email ?? null,
    // Rework redelivery: ang RMA ledger ang Balance (charge − nabayad) — kasama na
    // doon ang dating order balance. Normal order: orders ledger.
    balance: reworkDueByOrder.get(o.id)
      ?? Math.max(Number(o.full_payment_price ?? 0) - Number(o.downpayment_price ?? 0) - Number(o.full_payment ?? 0), 0),
    lat: (o as { address_lat?: number | null }).address_lat ?? null,
    lng: (o as { address_lng?: number | null }).address_lng ?? null,
    is_rush: !!o.is_rush,
    rush_days: o.rush_days ?? null,
    date_order: o.date_order ? String(o.date_order).slice(0, 10) : null,
    date_of_delivery: o.date_of_delivery ? String(o.date_of_delivery).slice(0, 10) : null,
    items: (() => {
      // Sa REDELIVERY ng rework, ang inayos lang. SKU ang mahigpit na
      // pagtutugma; pangalan ang panghalili para sa RMA na walang SKU; buong
      // order kapag walang tumugma — kaysa magpakita ng stop na walang laman.
      const rw = reworkItemByOrder.get(o.id);
      const lines = (Array.isArray(o.receipt_items) ? o.receipt_items : [])
        .filter((it) => !isFee(fl((it as { description?: string }).description)));
      const only = rw ? lines.filter((it) => isReworkLine(rw, it as { description?: string | null; sku?: string | null; color?: string | null })) : [];
      return (only.length ? only : lines);
    })()
      .map((it) => {
        const x = it as { description?: string | null; image?: string | null; sku?: string | null; qty?: number; color?: string | null; dimension?: string | null };
        // Kaparehong panuntunan ng `itemsOf`: handa kapag may QC-passed na job,
        // o kapag na-skip (kukunin sa stock — wala nang gagawin).
        const lk = lineKey(x.description, x.color), pfx = `${o.id}|`;
        return {
          description: x.description ?? null, image: x.image ?? null, sku: x.sku ?? null,
          qty: Number(x.qty) || 1, color: x.color ?? null, dimension: x.dimension ?? null,
          ready: lineReady(o.id, x.description, x.color),
          delivered: hasKey(deliveredLines.get(o.id), lk),
          source: hasKey(skippedLine, lk, pfx) ? "stock" : (hasKey(jobAnyKeys, lk, pfx) ? "workshop" : null),
        };
      }),
    ...(() => { const c = itemsOf(o); return { items_total: c.total, items_ready: c.ready, items_delivered: c.delivered }; })(),
    is_rework: reworkByOrder.has(o.id),
    rma_no: reworkByOrder.get(o.id) ?? null,
    dq_group: o.dq_group ?? null,
    dq_date: o.dq_date ? String(o.dq_date).slice(0, 10) : null,
    dq_team: o.dq_team ?? null,
    dq_driver: o.dq_driver ?? null,
    dq_sent_at: o.dq_sent_at ?? null,
    dq_followups: Number(o.dq_followups ?? 0),
  });

  const all = (orders ?? []) as Row[];
  // Ang "Partial Delivery" ay BUKAS pa — may natitirang linya; huwag itong
  // itapon ng pending/cancel/draft na sala, at huwag ituring na in-motion ang
  // naunang batch na tapos na.
  const active = all.filter((o) =>
    (/partial delivery/i.test(o.status ?? "") || !/pending|cancel|draft/i.test(o.status ?? ""))
    && (!inMotion.has(o.id) || (/partial delivery/i.test(o.status ?? "") && !o.dq_status)));

  // FOR SCHEDULING — QC passed, wala pang na-send na confirmation. Ang order na
  // nasa gitna ng rework (pickup/repair phase) ay NAKA-HOLD muna.
  // PARTIAL DELIVERY (2026-08-26, pasya ni Joe): ang order ay pumapasok sa pila
  // kapag MAY handa nang linya — hindi na hinihintay ang lahat. Ang batch ay ang
  // mga handa; ang natitira ay babalik dito pagkahanda para sa susunod na batch.
  // Ang buong-handa ay dating asal pa rin: isang batch, buong order.
  const allReady = (o: Row): boolean => {
    const { total, ready } = itemsOf(o);
    return total > 0 ? ready > 0 : qcPassed.has(o.id);
  };
  // Ang allReady na mismo ang gate: ang order na puro stock (lahat na-skip) ay
  // schedulable agad — walang workshop QC na darating kailanman doon. Ang
  // qcPassed ay pambalik lang ng lumang order na walang receipt lines.
  const pool = active
    .filter((o) => allReady(o) && !o.dq_status && !reworkHold.has(o.id))
    .map(toQueue);
  const forScheduling = clusterByProximity(pool.map((p) => ({ ...p, lat: p.lat, lng: p.lng })), 5);

  // AWAITING CONFIRM — grouped pa rin ayon sa dq_group + dq_date.
  const awaitingRows = active.filter((o) => o.dq_status === "pending").map(toQueue);
  const byGroup = new Map<string, QueueOrder[]>();
  for (const r of awaitingRows) {
    const key = `${r.dq_group ?? "Group"}|${r.dq_date ?? ""}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), r]);
  }
  const awaiting = [...byGroup.entries()].map(([key, members]) => ({
    group: key.split("|")[0],
    date: members[0]?.dq_date ?? null,
    team: members[0]?.dq_team ?? null,
    driver: members[0]?.dq_driver ?? null,
    members,
  })).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  // Kasama rin ang CONFIRMED (hindi pa umaalis na delivery) — sila ang target
  // ng Ops Reschedule tab pagkatapos ng usapan sa Messenger.
  const confirmedIds = active.filter((o) => o.dq_status === "confirmed").map((o) => o.id);
  const queueIds = new Set<number>([...pool.map((p) => p.id), ...awaitingRows.map((r) => r.id), ...confirmedIds]);
  type TeamRow = Team & { reserved?: boolean | null };
  const allTeams = (teams ?? []) as TeamRow[];
  return {
    forScheduling,
    awaiting,
    // Team dropdown = mga TOTOONG team lang (may van); reserved rows ay driver pool lang.
    teams: allTeams.filter((t) => !t.reserved).map(({ id, name, driver, vehicle, capacity }) => ({ id, name, driver, vehicle, capacity })),
    drivers: allTeams.filter((t) => t.driver).map((t) => ({ name: t.driver as string, reserved: !!t.reserved })),
    counts: { forScheduling: pool.length, awaiting: awaitingRows.length },
    orderRows: (all as OrderRow[]).filter((o) => queueIds.has(o.id)),
    reworkTags: Object.fromEntries(reworkByOrder),
  };
}
