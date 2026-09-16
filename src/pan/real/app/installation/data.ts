import { createServerSupabase, type OrderRow } from "@/lib/supabase/server";
import { lineKey, keySet, hasKey } from "@/lib/orders/line-key";
import { rushThresholdFrom } from "@/lib/rush";
import { isShippingDesc } from "@/lib/shipping";
import { descSpecLines, parseDescSpecs } from "@/lib/receipt-desc";
import { isReworkLine } from "@/lib/orders/rework-match";
import { makeColorPhoto } from "@/lib/ops/product-variants";

export type InstallItem = {
  description: string | null;
  image_url: string | null;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  frame?: string | null;  // frame parts / add-ons (W · Hdbrd · L · Base · Legs)
  // Presyo kada piraso mula sa receipt_items — kailangan ng Declare Return na
  // bumubukas dito (2026-08-29): ang refund at ang singil ng rework ay
  // nakasalalay dito, at kung wala, "1 × ₱0" ang lumalabas sa item picker.
  unitPrice?: number;
  qty: number;
  customized?: boolean;
  // Build lines pagkatapos ng pangalan - dala sa Product Details.
  specs?: string | null;
};

export type Installation = {
  // Ang GAGAWIN sa bisitang ito. Sa rework ay ang inayos lang; sa normal ay
  // buong order.
  items: InstallItem[];
  // BUONG ORDER, laging. Ang warranty certificate ay talaan ng SAKLAW — lahat
  // ng produktong binili — hindi ng isang biyahe. Kung `items` ang gagamitin,
  // ang sertipiko ng rework visit ay maglilista ng isang sofa gayong tatlo ang
  // sinasakop nito.
  all_items: InstallItem[];
  id: number | null;          // installation record id (null until first save)
  order_id: number | null;
  delivery_id: number | null;
  order_number: string | null;
  customer_name: string | null;
  address: string | null;
  contact_number: string | null;
  email: string | null;
  sales_rep: string | null;
  date_purchase: string | null;
  date_delivered: string | null;
  mop: string | null;
  items_summary: string | null;
  install_date: string | null;
  installer_team: string | null;
  driver_team: string | null;
  // Resolved na team assignment: "Team X" + kung sinong driver ang in-charge.
  team_label: string | null;
  team_driver: string | null;
  // Saang workshop ginawa ang order (pinakabagong workshop_job) — origin label.
  workshop_name: string | null;
  coordinator: string | null;
  warranty_terms: string | null;
  warranty_duration: string | null;
  warranty_start: string | null;
  signature_url: string | null;
  warranty_form_url: string | null;
  photos: string[];
  feedback: string | null;
  status: string;
  notes: string | null;
  delivery_status: string | null;   // delivery status (Out for Delivery / Delivered)
  balance: number;                   // pending payment to collect (total − paid; RMA due sa rework)
  rework_return_id: number | null;   // returns.id kapag RMA ledger ang balance — koleksyon via collectReworkPayment
  item_installers: string[][];       // per-item installer names (aligned to items[])
  // Litrato ng install KADA PRODUKTO (0207), nakahanay sa items[] gaya ng
  // item_installers. Ang `photos` ay ang buong bilang ng order.
  item_photos: string[][];
  installer_names: string;           // unique union of all installers (per-item + team) for display
  // PARTIAL (2026-09-01): bukas pa ang partial delivery ng order na ito —
  // batch pa lang ang na-install na ito, may susunod pang biyahe.
  partial_open: boolean;
  is_rush: boolean;                  // rush tag — countdown badge here
  rush_days: number | null;          // per-order deadline (migration 0136); null = global
  // REWORK visit: ang delivery na ito ay redelivery/on-site ng inaayos na item —
  // may Rework tag ang row/modal, at FRESH ang install form (bagong record;
  // hindi ginagalaw ang lumang completed installation + warranty docs).
  is_rework: boolean;
  rma_no: string | null;
  // ON-SITE REWORK (2026-08-25): sino ang kumukumpuni. Ang Installation ang
  // screen na tinitingnan ng papuntang crew, pero ang pangalan nila ay nasa
  // Returns lang — walang paraan mula rito para malaman kung sino ang sasama.
  rework_crew: string | null;
  rework_mode: string | null;
};

export type InstallationData = {
  rows: Installation[];
  kpi: { scheduled: number; inProgress: number; completed: number };
  rushThreshold: number;
};

// Ang hinihinging hugis ng isang installations row. Nakasulat nang kamay dahil
// ang column list ay dynamic (dalawang bersyon, may at walang `item_photos`
// habang hindi pa tumakbo ang 0207) at ang dynamic na string ay nag-aalis ng
// inference sa Supabase client.
type InstRow = {
  id: number;
  order_id: number | null;
  item_installers: unknown;
  item_photos?: unknown;
  installer_team: string | null;
  address: string | null;
  install_date: string | null;
  warranty_terms: string | null;
  warranty_duration: string | null;
  warranty_start: string | null;
  signature_url: string | null;
  warranty_form_url: string | null;
  photos: unknown;
  feedback: string | null;
  status: string | null;
  notes: string | null;
  completed_at: string | null;
};

function summarize(o: OrderRow): string {
  const items = (o.receipt_items ?? []).filter((it) => !isShippingDesc(it.description));
  if (items.length) return items.map((it) => `${it.qty}× ${(it.description ?? "").split("\n")[0]}`).join(", ");
  return o.product_name ?? "";
}

// Auto-list deliveries that are Out for Delivery / Delivered (ready to install),
// overlaying any existing installation record.
export async function loadInstallations(): Promise<InstallationData> {
  const supabase = createServerSupabase();
  // Litrato ayon sa kulay ng item (color_variants) — lib/ops/product-variants.
  const photo = await makeColorPhoto(supabase);
  const [{ data: dels }, { data: insts }, { data: products }, { data: emps }, { data: rushSetting }, { data: teamRows }, { data: dqOrders }, { data: wjobsAll }, { data: wsAll }, { data: reworkRets }] = await Promise.all([
    supabase.from("deliveries").select("id, order_id, order_number, customer_name, address, sales_rep, delivered_at, arrived_at, items_summary, driver_team, coordinator, status, created_at").order("created_at", { ascending: false }).limit(5000),
    // Ascending id so that when an order has multiple installation rows (a duplicate
    // can happen if Save inserted instead of updated), the Map below keeps the LAST =
    // newest row — i.e. the most recent "Delivered" state, not a stale "Installation".
    // Ang `item_photos` (0207) ay hinihingi nang may pambalik: kapag hindi pa
    // tumakbo ang migration, ang buong query ay babagsak sa "column does not
    // exist" at MAWAWALA ang buong Installation Tracking. Isang beses nang
    // nangyari ito sa `deliveries.return_id` (0205).
    (async () => {
      const cols = "id, order_id, item_installers, installer_team, address, install_date, warranty_terms, warranty_duration, warranty_start, signature_url, warranty_form_url, photos, feedback, status, notes, completed_at";
      const q = (c: string) => supabase.from("installations").select(c).order("id", { ascending: true }).limit(5000);
      // Ang dynamic na column string ay nag-aalis ng inference sa Supabase
      // client, kaya ang hugis ay itinatakda rito — kaparehong mga field na
      // hinihingi sa itaas, at ang `item_photos` ay opsyonal habang hindi pa
      // tumakbo ang 0207.
      const r = await q(`${cols}, item_photos`);
      const out = r.error ? await q(cols) : r;
      return { data: out.data as unknown as InstRow[] | null };
    })(),
    supabase.from("product").select("product_name, sku, category, color, dimension, image_url").limit(5000),
    supabase.from("employees").select("name").eq("active", true).limit(5000),
    supabase.from("app_settings").select("value").eq("key", "rush_threshold_days").maybeSingle(),
    supabase.from("delivery_teams").select("name, driver").eq("active", true).limit(50),
    supabase.from("orders").select("id, dq_team, dq_driver").not("dq_team", "is", null).limit(10000),
    supabase.from("workshop_job").select("order_id, workshop_id").not("order_id", "is", null).order("id", { ascending: true }).limit(10000),
    supabase.from("workshop").select("id, name").limit(1000),
    supabase.from("returns").select("id, order_id, return_no, status, reworked_at, rework_charge_total, rework_downpayment, rework_mode, rework_onsite_crew, item_desc, sku, color").eq("resolution", "rework").order("id", { ascending: false }).limit(5000),
  ]);

  // Saan GINAWA ang order: pinakabagong workshop_job ng order → workshop name.
  const wsNameById = new Map<number, string>();
  for (const w of (wsAll ?? []) as { id: number; name: string | null }[]) {
    if (w.name) wsNameById.set(w.id, w.name);
  }
  const workshopByOrder = new Map<number, string>();
  for (const j of (wjobsAll ?? []) as { order_id: number | null; workshop_id: number | null }[]) {
    if (j.order_id != null && j.workshop_id != null) {
      const nm = wsNameById.get(j.workshop_id);
      if (nm) workshopByOrder.set(j.order_id, nm); // ascending id → latest job wins
    }
  }

  // TEAM resolver: ang deliveries.driver_team ay minsan pangalan ng DRIVER, minsan
  // team name. I-resolve sa "Team X" + kung sino ang in-charge (driver):
  //   1) Route Planner assignment ng order (orders.dq_team/dq_driver) ang panalo;
  //   2) kung team name ang laman → hanapin ang driver sa delivery_teams;
  //   3) kung driver name ang laman → hanapin kung aling team ang may ganoong driver.
  const teamByDriver = new Map<string, string>();
  const driverByTeam = new Map<string, string | null>();
  const nk = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  for (const t of (teamRows ?? []) as { name: string | null; driver: string | null }[]) {
    if (!t.name) continue;
    driverByTeam.set(nk(t.name), t.driver ?? null);
    if (t.driver) teamByDriver.set(nk(t.driver), t.name);
  }
  const dqByOrder = new Map<number, { team: string; driver: string | null }>();
  for (const o of (dqOrders ?? []) as { id: number; dq_team: string | null; dq_driver: string | null }[]) {
    if (o.dq_team) dqByOrder.set(o.id, { team: o.dq_team, driver: o.dq_driver ?? null });
  }
  const resolveTeam = (orderId: number | null, raw: string | null): { team: string | null; driver: string | null } => {
    const dq = orderId != null ? dqByOrder.get(orderId) : undefined;
    if (dq) return { team: dq.team, driver: dq.driver ?? (driverByTeam.get(nk(dq.team)) ?? null) };
    if (!raw) return { team: null, driver: null };
    if (driverByTeam.has(nk(raw))) return { team: raw, driver: driverByTeam.get(nk(raw)) ?? null };
    const t = teamByDriver.get(nk(raw));
    if (t) return { team: t, driver: raw };
    return { team: null, driver: raw };
  };

  // Canonical name resolver: snap a stored name to the roster's exact spelling.
  const canonKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const canonMap = new Map<string, string>();
  for (const e of (emps ?? []) as { name: string | null }[]) {
    if (e.name) canonMap.set(canonKey(e.name), e.name);
  }
  const canon = (v: string | null | undefined): string | null => {
    if (!v) return null;
    return canonMap.get(canonKey(v)) ?? v;
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // Only surface a delivery in Installation once it has ARRIVED (or moved past — in
  // installation / delivered). "Out for delivery" is still en route, so it must NOT show
  // here yet — the installation task begins only after arrival.
  // DEDUPE by order: duplicate deliveries rows for one order (double dispatch/save)
  // were rendering the same order twice here — keep only the NEWEST row per order.
  const readyAll = (dels ?? []).filter((d) => /arrived|installation|delivered/i.test(d.status ?? ""));
  const newestByOrder = new Map<number | string, (typeof readyAll)[number]>();
  for (const d of readyAll) {
    const key = d.order_id ?? `row-${d.id}`;
    const prev = newestByOrder.get(key);
    if (!prev || Number(d.id) > Number(prev.id)) newestByOrder.set(key, d);
  }
  const ready = [...newestByOrder.values()];
  const readyOrderIds = [...new Set(ready.map((d) => d.order_id).filter((x) => x != null))] as number[];
  const { data: orders } = readyOrderIds.length
    ? await supabase.from("orders").select('id, date_order, date_of_delivery, mop, "Source", product_name, receipt_items, assigned, contact_number, email, full_payment_price, downpayment_price, full_payment, is_rush, rush_days, status, dq_items').in("id", readyOrderIds)
    : { data: [] as OrderRow[] };

  const instByOrder = new Map<number, any>();
  // Pinakaunang (orihinal) installation record id bawat order — kapag ang
  // ipinapakitang record ay HIGIT dito, rework install iyon → panatilihin ang tag.
  const instMinIdByOrder = new Map<number, number>();
  for (const it of insts ?? []) if (it.order_id != null) {
    // PINAKABAGONG record ang main row (ang rework install kapag meron); ang
    // pinakauna (orihinal) ay idadagdag bilang sariling row sa baba.
    const cur = instByOrder.get(it.order_id);
    if (!cur || Number(it.id) > Number(cur.id)) instByOrder.set(it.order_id, it);
    const prev = instMinIdByOrder.get(it.order_id);
    if (prev == null || Number(it.id) < prev) instMinIdByOrder.set(it.order_id, Number(it.id));
  }
  const orderById = new Map<number, OrderRow>();
  for (const o of (orders ?? []) as OrderRow[]) orderById.set(o.id, o);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const prodByName = new Map<string, any>();
  for (const p of products ?? []) prodByName.set(norm(p.product_name ?? ""), p);

  // ANG INAAYOS LANG SA REWORK (hiling 2026-08-29). Dalawang senaryo ang
  // nakikita ng installer: normal na install, kung saan buo ang order; at rework
  // visit, kung saan ISA ang gamit — ang inayos. Ang buong listahan doon ay
  // humihingi ng installer at litrato para sa mga bagay na nasa customer na
  // mula pa noong unang hatid, at hinaharang ang Delivered hangga't hindi sila
  // nakukuhanan.
  //
  // Ang SKU ang mahigpit na pagtutugma; ang pangalan ang panghalili para sa
  // RMA na walang SKU. Kapag walang tumugma — binago o binura ang linya — buong
  // order pa rin, kaysa magpakita ng install na walang laman.
  // PARTIAL (2026-09-02, "dito din dapat"): aling linya ang BATCH ng biyaheng
  // ito. Habang hindi pa Delivered: ang dq_items. Pagka-Delivered (nililinis
  // ang dq_*): ang HULING batch sa order_line_deliveries. Ang install ay para
  // lang sa mga item na kararating — hindi sa buong order.
  // KASAMA ANG KULAY (2026-09-06, lib/orders/line-key): "pangalan @ kulay".
  const flp = (t: string | null | undefined, color?: string | null) => lineKey(t, color);
  const batchKeysByOrder = new Map<number, Set<string>>();
  const hadEarlierBatch = new Set<number>();
  // LAHAT ng linyang naihatid na (anumang batch) — kailangan ng kumulatibong
  // singil: ang koleksyon ng biyaheng ito = (naihatid + batch + fee) - bayad.
  const deliveredKeysByOrder = new Map<number, Set<string>>();
  try {
    const ids = [...orderById.keys()];
    if (ids.length) {
      const { data: old0 } = await supabase.from("order_line_deliveries")
        .select("order_id, item_desc, batch_no").in("order_id", ids).limit(10000);
      const maxBatch = new Map<number, number>();
      for (const r of (old0 ?? []) as { order_id: number | null; batch_no: number | null }[]) {
        if (r.order_id == null) continue;
        maxBatch.set(r.order_id, Math.max(maxBatch.get(r.order_id) ?? 0, Number(r.batch_no) || 0));
      }
      for (const r of (old0 ?? []) as { order_id: number | null; item_desc: string | null; batch_no: number | null }[]) {
        if (r.order_id == null) continue;
        const dk = flp(r.item_desc);
        if (dk) (deliveredKeysByOrder.get(r.order_id) ?? deliveredKeysByOrder.set(r.order_id, new Set()).get(r.order_id)!).add(dk);
        if ((Number(r.batch_no) || 0) < (maxBatch.get(r.order_id) ?? 0)) hadEarlierBatch.add(r.order_id);
        if ((Number(r.batch_no) || 0) !== (maxBatch.get(r.order_id) ?? 0)) continue;
        const set = batchKeysByOrder.get(r.order_id) ?? new Set<string>();
        const k = flp(r.item_desc);
        if (k) set.add(k);
        batchKeysByOrder.set(r.order_id, set);
      }
      if ([...maxBatch.values()].some((n) => n > 1)) { /* may naunang batch — hawak na sa hadEarlierBatch */ }
    }
  } catch { /* wala pang 0200 */ }
  for (const [oid, o] of orderById) {
    const dqi = (o as { dq_items?: unknown }).dq_items;
    if (Array.isArray(dqi) && dqi.length) {
      batchKeysByOrder.set(oid, keySet(dqi));
    }
  }

  const itemsOf = (o: OrderRow | null | undefined, rw?: { item: string; sku: string | null; desc?: string | null; color?: string | null }): InstallItem[] => {
    const lines = (o?.receipt_items ?? []).filter((it) => !isShippingDesc(it.description));
    // KASAMA ANG KULAY (2026-09-06, lib/orders/rework-match).
    const rwRef = rw && (rw.sku || rw.item) ? { item_desc: rw.desc ?? rw.item, sku: rw.sku, color: rw.color ?? null } : null;
    const only = rwRef ? lines.filter((it) => isReworkLine(rwRef, it)) : [];
    const oid = (o as { id?: number } | null | undefined)?.id;
    const bk = !rw && oid != null ? batchKeysByOrder.get(oid) : undefined;
    const batchLines = bk?.size ? lines.filter((it) => hasKey(bk, flp(it.description, it.color))) : [];
    const base = only.length ? only : (batchLines.length && batchLines.length < lines.length ? batchLines : lines);
    return base.map((it) => {
    const desc = it.description ?? "";
    const first = desc.split("\n")[0];
    const specs = parseDescSpecs(desc);
    const p = prodByName.get(norm(first));
    return {
      description: first, image_url: photo(first, it.sku ?? p?.sku, it.color ?? specs.color, desc, it.image ?? p?.image_url ?? null),
      sku: it.sku ?? p?.sku ?? null,
      category: it.category ?? specs.category ?? p?.category ?? null,
      color: it.color ?? specs.color ?? p?.color ?? null,
      dimension: it.dimension ?? specs.dimension ?? p?.dimension ?? null,
      frame: specs.frame, specs: descSpecLines(desc),
      unitPrice: Number(it.unitPrice) || 0,
      qty: Number(it.qty) || 0,
      customized: !!it.customized,
    };
    });
  };

  // Aktibong rework bawat order — para sa Rework tag + fresh install form.
  // Kasama ang INAAYOS NA GAMIT (2026-08-29): ang rework visit ay tungkol sa
  // isang produkto, kaya ang buong listahan ng order ay humihingi ng installer
  // at litrato para sa mga bagay na nasa customer na mula pa noong unang hatid.
  const reworkByOrder = new Map<number, { rma_no: string | null; active: boolean; crew: string | null; mode: string | null; item: string; sku: string | null; desc: string | null; color: string | null }>();
  // RMA LEDGER bawat order: ang rework due (charge − nabayad) ang tunay na Balance
  // ng redelivery install; kasama ang return id para diretso sa collectRework-
  // Payment ang koleksyon. Newest return first (ordered query) → first-wins.
  const reworkLedgerByOrder = new Map<number, { return_id: number; due: number }>();
  for (const r of (reworkRets ?? []) as { id: number; order_id: number | null; return_no: string | null; status: string | null; reworked_at: string | null; rework_charge_total?: number | null; rework_downpayment?: number | null; rework_mode?: string | null; rework_onsite_crew?: unknown; item_desc?: string | null; sku?: string | null }[]) {
    if (r.order_id == null || /reject|pending/i.test(r.status ?? "")) continue;
    const active = /rework/i.test(r.status ?? "") || !!r.reworked_at;
    const prev = reworkByOrder.get(r.order_id);
    const crew = Array.isArray(r.rework_onsite_crew)
      ? (r.rework_onsite_crew as { name?: unknown }[]).map((c) => String(c.name ?? "").trim()).filter(Boolean).join(", ")
      : "";
    if (!prev || active) reworkByOrder.set(r.order_id, { rma_no: r.return_no ?? null, active, crew: crew || null, mode: r.rework_mode ?? null, item: String(r.item_desc ?? "").split("\n")[0].trim(), sku: r.sku ?? null, desc: (r.item_desc as string | null) ?? null, color: ((r as { color?: string | null }).color ?? null) });
    const charge = Number(r.rework_charge_total) || 0;
    if (charge > 0 && !reworkLedgerByOrder.has(r.order_id))
      reworkLedgerByOrder.set(r.order_id, { return_id: Number(r.id), due: Math.max(Math.round((charge - (Number(r.rework_downpayment) || 0)) * 100) / 100, 0) });
  }

  const rows: Installation[] = ready.map((d) => {
    const inst0 = d.order_id != null ? instByOrder.get(d.order_id) : null;
    // BAGONG VISIT (rework redelivery/on-site): dumating nang MAS BAGO kaysa sa
    // pagka-complete ng lumang installation → ituring na WALANG record (fresh
    // form, bagong installations row sa save) — buo ang lumang record/warranty.
    // arrived_at NULL + status Arrived = repurposed na row (on-site rework na
    // walang driver-arrive stamp) — ituring ding bagong bisita.
    const dArr = (d as { arrived_at?: string | null }).arrived_at ?? null;
    const newVisit = !!inst0 && /arrived/i.test(d.status ?? "") && /delivered|completed/i.test(inst0.status ?? "")
      && (!dArr || (!!inst0.completed_at && String(dArr) > String(inst0.completed_at)));
    const inst = newVisit ? null : inst0;
    const rw = d.order_id != null ? reworkByOrder.get(d.order_id) : undefined;
    // Tag: bagong bisita, aktibong rework run, O ang ipinapakitang record mismo
    // ay ang REWORK install (hindi ang orihinal) — nananatili kahit Delivered na.
    const isReworkRecord = !!inst && !!rw && d.order_id != null
      && instMinIdByOrder.get(d.order_id) != null && Number(inst.id) !== instMinIdByOrder.get(d.order_id);
    const isRework = newVisit || isReworkRecord || (!!rw?.active && !/delivered/i.test(d.status ?? ""));
    const o = d.order_id != null ? orderById.get(d.order_id) : null;
    const ii: string[][] = Array.isArray(inst?.item_installers) ? (inst.item_installers as string[][]) : [];
    const ip: string[][] = Array.isArray(inst?.item_photos) ? (inst.item_photos as string[][]) : [];
    const allNames = [...new Set([...ii.flat(), ...(inst?.installer_team ? [inst.installer_team as string] : [])].map((n) => canon(n)).filter(Boolean) as string[])];
    return {
      // Sa rework visit, ang inayos lang; sa normal, buong order.
      items: itemsOf(o, isRework ? rw : undefined),
      all_items: itemsOf(o),
      is_rework: isRework,
      rma_no: rw?.rma_no ?? null,
      rework_crew: rw?.crew ?? null,
      rework_mode: rw?.mode ?? null,
      id: inst?.id ?? null,
      order_id: d.order_id ?? null,
      delivery_id: d.id,
      order_number: d.order_number ?? null,
      customer_name: d.customer_name ?? null,
      address: inst?.address ?? d.address ?? null,
      contact_number: o?.contact_number ?? null, email: o?.email ?? null,
      sales_rep: canon(d.sales_rep ?? o?.assigned ?? null),
      date_purchase: o?.date_order ? String(o.date_order).slice(0, 10) : null,
      date_delivered: (d.delivered_at ? String(d.delivered_at).slice(0, 10) : (o?.date_of_delivery ? String(o.date_of_delivery).slice(0, 10) : null)),
      mop: o?.mop ?? o?.Source ?? null,
      items_summary: d.items_summary ?? (o ? summarize(o) : null),
      install_date: inst?.install_date ?? null,
      installer_team: canon(inst?.installer_team ?? null),
      driver_team: canon(d.driver_team ?? null),
      team_label: resolveTeam(d.order_id ?? null, d.driver_team ?? null).team,
      team_driver: canon(resolveTeam(d.order_id ?? null, d.driver_team ?? null).driver),
      workshop_name: d.order_id != null ? (workshopByOrder.get(d.order_id) ?? null) : null,
      coordinator: canon(d.coordinator ?? null),
      // Sa rework fresh form (inst = null), ang WARRANTY ay mula pa rin sa
      // ORIHINAL na install (inst0) — nakabatay sa unang delivery, hindi
      // nagre-renew ang coverage dahil sa repair.
      warranty_terms: inst?.warranty_terms ?? inst0?.warranty_terms ?? "Parts & labor",
      warranty_duration: inst?.warranty_duration ?? inst0?.warranty_duration ?? "1 Year",
      warranty_start: inst?.warranty_start ?? inst0?.warranty_start ?? null,
      signature_url: inst?.signature_url ?? null,
      warranty_form_url: inst?.warranty_form_url ?? null,
      photos: Array.isArray(inst?.photos) ? inst.photos : [],
      feedback: inst?.feedback ?? null,
      // Installation work (In Progress/Installation/Delivered) wins; else reflect the
      // delivery: Arrived = ready to install. (Sa rework new visit, inst = null na —
      // fresh task, kaya "Arrived" agad ang lalabas.)
      status: (/in progress|installation|delivered|completed/i.test(inst?.status ?? "") ? (inst!.status as string)
        : /arrived/i.test(d.status ?? "") ? "Arrived"
        : (inst?.status as string) || "To Schedule"),
      notes: inst?.notes ?? null,
      delivery_status: d.status ?? null,
      // Rework: RMA ledger ang balance (kasama na sa charge ang order balance).
      // PARTIAL (2026-09-02): ang koleksyon sa install na ito ay ang SINGIL NG
      // BATCH — items ng batch + shipping (unang batch lang) - lahat ng bayad,
      // clamp 0 - hindi ang buong balanse ng order.
      balance: (() => {
        if (d.order_id != null && reworkLedgerByOrder.has(d.order_id)) return reworkLedgerByOrder.get(d.order_id)!.due;
        if (!o) return 0;
        const total = Number(o.full_payment_price) || 0;
        const paid = (Number(o.downpayment_price) || 0) + (Number(o.full_payment) || 0);
        const bk = d.order_id != null ? batchKeysByOrder.get(d.order_id) : undefined;
        const allLines = (o.receipt_items ?? []);
        const prodLines = allLines.filter((it) => !isShippingDesc(it.description));
        if (bk?.size && prodLines.some((it) => !bk.has(flp(it.description)))) {
          const bTotal = prodLines.filter((it) => bk.has(flp(it.description)))
            .reduce((s2, it) => s2 + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
          const fees = allLines.filter((it) => isShippingDesc(it.description))
            .reduce((s2, it) => s2 + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
          // KUMULATIBO (2026-09-02): kasama ang mga naihatid na sa naunang
          // batch - kung hindi, ang huling biyahe ay laging ₱0 (per-batch na
          // items - KABUUANG bayad) kahit may natitirang balanse pa.
          const done = d.order_id != null ? deliveredKeysByOrder.get(d.order_id) : undefined;
          const deliveredTotal = done?.size
            ? prodLines.filter((it) => done.has(flp(it.description)) && !bk.has(flp(it.description)))
                .reduce((s2, it) => s2 + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0)
            : 0;
          return Math.max(Math.round((fees + deliveredTotal + bTotal - paid) * 100) / 100, 0);
        }
        return Math.max(0, Math.round((total - paid) * 100) / 100);
      })(),
      rework_return_id: d.order_id != null ? (reworkLedgerByOrder.get(d.order_id)?.return_id ?? null) : null,
      item_installers: ii,
      item_photos: ip,
      installer_names: allNames.join(", "),
      partial_open: /partial delivery/i.test(String((o as { status?: string | null } | undefined)?.status ?? "")),
      is_rush: !!o?.is_rush,
      rush_days: (o as { rush_days?: number | null } | undefined)?.rush_days ?? null,
    };
  });

  // ORIHINAL na installation = SARILING row. Ang rework redelivery ay bago/fresh
  // na record — HINDI nito tinatakpan ang tapos nang unang install: mananatili
  // iyon bilang hiwalay na row (walang rework tag, Delivered pa rin ang status).
  const instById = new Map<number, any>();
  for (const it of insts ?? []) instById.set(Number(it.id), it);
  const extra: Installation[] = [];
  for (const row of rows) {
    if (!row.is_rework || row.order_id == null) continue;
    const minId = instMinIdByOrder.get(row.order_id);
    if (minId == null || Number(row.id ?? -1) === minId) continue;
    const orig = instById.get(minId);
    if (!orig || !/delivered|completed/i.test(orig.status ?? "")) continue;
    const ii: string[][] = Array.isArray(orig.item_installers) ? (orig.item_installers as string[][]) : [];
    const ip: string[][] = Array.isArray(orig.item_photos) ? (orig.item_photos as string[][]) : [];
    const names = [...new Set([...ii.flat(), ...(orig.installer_team ? [orig.installer_team as string] : [])].map((n) => canon(n)).filter(Boolean) as string[])];
    extra.push({
      ...row,
      // BUONG ORDER ANG ORIHINAL. Ang `row` ay ang rework visit, kaya ang
      // `items` nito ay nasala na sa inayos lang — pero ito ang talaan ng
      // UNANG install, kung saan lahat ng produkto ay itinayo.
      items: itemsOf(row.order_id != null ? orderById.get(row.order_id) : null),
      all_items: itemsOf(row.order_id != null ? orderById.get(row.order_id) : null),
      id: Number(orig.id), is_rework: false, rma_no: null, rework_crew: null, rework_mode: null, rework_return_id: null,
      install_date: orig.install_date ?? null,
      installer_team: canon(orig.installer_team ?? null),
      warranty_terms: orig.warranty_terms ?? row.warranty_terms,
      warranty_duration: orig.warranty_duration ?? row.warranty_duration,
      warranty_start: orig.warranty_start ?? row.warranty_start,
      signature_url: orig.signature_url ?? null,
      warranty_form_url: orig.warranty_form_url ?? null,
      photos: Array.isArray(orig.photos) ? orig.photos : [],
      feedback: orig.feedback ?? null,
      status: (orig.status as string) || "Delivered",
      notes: orig.notes ?? null,
      delivery_status: "Delivered",
      balance: 0,
      item_installers: ii,
      item_photos: ip,
      installer_names: names.join(", "),
    });
  }
  rows.push(...extra);

  const scheduled = rows.filter((r) => /to schedule|^scheduled|arrived/i.test(r.status)).length;
  const inProgress = rows.filter((r) => /in progress|installation/i.test(r.status)).length;
  const completed = rows.filter((r) => /delivered|completed/i.test(r.status)).length;
  return { rows, kpi: { scheduled, inProgress, completed }, rushThreshold: rushThresholdFrom(rushSetting?.value) };
}
