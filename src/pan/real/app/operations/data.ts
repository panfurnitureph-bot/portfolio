import { createServerSupabase, type OrderRow, type ProductRow } from "@/lib/supabase/server";
import { DOWNPAYMENT_RATE } from "@/app/orders/downpayment";
import { rushThresholdFrom } from "@/lib/rush";
import { parseDescSpecs, matchName } from "@/lib/receipt-desc";
import { loadSkipRows, makeSkipMatcher, type SkipRow } from "@/lib/ops/skips";
import { lineKey, keySet, hasKey, colorLabelOfDesc } from "@/lib/orders/line-key";
import { loadVariantIndex, variantsFor, imageForColor } from "@/lib/ops/product-variants";

// An order is workshop-ready only once its 30% downpayment is met. Until then it's
// unconfirmed (status forced to "Pending") and must not appear in the dispatch queue.
function downpaymentMet(o: Pick<OrderRow, "full_payment_price" | "downpayment_price" | "full_payment">): boolean {
  const total = Number(o.full_payment_price) || 0;
  if (total <= 0) return false;
  const paid = (Number(o.downpayment_price) || 0) + (Number(o.full_payment) || 0);
  return paid >= Math.round(total * DOWNPAYMENT_RATE * 100) / 100;
}

export type WorkshopLite = { id: number; name: string };

export type AssignLine = {
  order_id: number;
  order_number: string | null;
  customer: string | null;
  date: string | null;
  source: string | null;
  address: string | null;
  item_desc: string;
  // FULL multi-line receipt description (name + "• color / • variant·size / • custom
  // dims / • category" bullets). Dispatched INTO workshop_job.item_desc so every
  // downstream step (workshop, QC receiving, ops logs) sees the complete specs —
  // catalog matching everywhere uses only the first line, which stays the name.
  full_desc: string;
  qty: number;
  image: string | null;
  customized: boolean;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  is_rush: boolean;
  rush_days: number | null;
  // Ang daanan pabalik sa website request — MTO # → FQ # → Order #. Wala nito
  // ang walk-in, kaya null.
  mto_number: string | null;
  fq_number: string | null;
  // Kung paano aabutin ang customer kapag may kailangang linawin bago maghiwa,
  // at kung nakapasok na ba ang deposito (doon nakasalalay kung pwede nang
  // simulan ang trabaho).
  contact: string | null;
  order_total: number;
  paid: number;
  // Kulang pa ang 30% sa BAGONG total. Nakikita lang ito sa idinagdag na item:
  // naka-reserba na ang order, kaya dumaraan ito sa gate — pero hindi pa
  // nababayaran ang idinagdag. Babala, hindi harang: ang pasya kung
  // kokolektahin muna ay sa Operations.
  short_paid: boolean;
};

export type JobRow = {
  id: number;
  order_id: number | null;
  order_number: string | null;
  workshop_id: number;
  workshop_name: string;
  item_desc: string | null;
  frame?: string | null;  // frame parts / add-ons (W · Hdbrd · L · Base · Legs)
  qty: number;
  status: string;
  dispatched_at: string | null;
  image_url: string | null;
  // SKU mula sa catalog — para tugma ang Product Details ng Order Tracker sa
  // ibang modal, na may SKU na hilera (2026-08-23).
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  fulfillment: "warehouse" | "pickup";
  // STOCK BUILD (0182): walang order — ipinagawa para lang magkastock.
  stock_request?: boolean;
  stock_reason?: string | null;
  date_order: string | null;
  is_rush: boolean;
  rush_days: number | null;
};

export type RequestRow = {
  id: number;
  workshop_id: number;
  workshop_name: string;
  material_id: number | null;
  material_name: string;
  qty_requested: number;
  qty_fulfilled: number | null;
  qty_received: number;
  reason: string | null;
  status: string;
  ops_followed_up: boolean;
  created_at: string | null;
};

export type MaterialRow = {
  id: number;
  workshop_id: number;
  workshop_name: string;
  name: string;
  barcode: string | null;
  unit: string;
  category: string | null;
  low_threshold: number;
  price: number;
  image_url: string | null;
  on_hand: number;
  manager_only: boolean;
};

export type OperationsData = {
  workshops: WorkshopLite[];
  toAssign: AssignLine[];
  jobs: JobRow[];
  requests: RequestRow[];
  materials: MaterialRow[];
  kpi: { toAssign: number; inProgress: number; doneWeek: number; pendingReq: number };
  rushThreshold: number;
  // Full order rows (by id) + catalog/people, so Order Approval can open the same
  // Edit Order modal as Sales Orders (set delivery date, amounts, etc.) on row click.
  ordersById: Record<number, OrderRow>;
  products: ProductRow[];
  assignees: { name: string; role: string }[];
  constructors: { name: string; role: string }[];
};

const firstLine = (s: string | null | undefined) => (s ?? "").split("\n")[0].trim();
// Ang linyang nasa orders.lines_shipped (0225) ay bawas na sa istante (QC-OUT o
// Start Delivery) — hindi na assignable. Ligtas pre-migration: walang column →
// walang array → false.
// KASAMA ANG KULAY (2026-09-06, lib/orders/line-key): "pangalan @ kulay" ang
// susi; ang lumang susi (pangalan lang) ay tugma sa alinmang kulay.
const lineShipped = (o: unknown, desc: string | null | undefined, color?: string | null): boolean => {
  const arr = (o as { lines_shipped?: unknown }).lines_shipped;
  if (!Array.isArray(arr)) return false;
  return hasKey(keySet(arr), lineKey(desc, color));
};

export async function loadOperations(): Promise<OperationsData> {
  const supabase = createServerSupabase();
  const [{ data: ws }, { data: orders }, { data: jobsRaw }, { data: reqRaw }, { data: mats }, { data: stockRaw }, { data: prods }, { data: skips }, { data: delsRaw }, { data: rushSetting }, { data: prodFull }, { data: salesEmps }, { data: consEmps }, variantIdx] = await Promise.all([
    supabase.from("workshop").select("id, name").eq("active", true).order("name").limit(5000),
    supabase.from("orders").select("*").order("date_order", { ascending: false }).order("id", { ascending: false }).limit(5000),
    supabase.from("workshop_job").select("id, order_id, order_number, workshop_id, item_desc, qty, status, dispatched_at, fulfillment, stock_request, stock_reason").order("dispatched_at", { ascending: false }).limit(5000),
    supabase.from("stock_request").select("id, workshop_id, material_id, qty_requested, qty_fulfilled, qty_received, reason, status, ops_followed_up, created_at").order("created_at", { ascending: false }).limit(5000),
    supabase.from("workshop_material").select("id, workshop_id, name, barcode, unit, category, low_threshold, price, image_url, manager_only").eq("active", true).order("name").limit(5000),
    supabase.from("workshop_stock").select("material_id, on_hand").order("material_id").limit(20000),
    supabase.from("product").select("product_name, image_url, sku, category, color, dimension").order("product_name").limit(5000),
    loadSkipRows(supabase).then((rows) => ({ data: rows })),
    supabase.from("deliveries").select("order_id, status").order("order_id").limit(20000),
    supabase.from("app_settings").select("value").eq("key", "rush_threshold_days").maybeSingle(),
    supabase.from("product").select("*").order("product_name").limit(5000),
    supabase.from("employees").select("name, role").eq("active", true).ilike("role", "%sales%").order("role").order("name").limit(5000),
    supabase.from("employees").select("name, role").eq("active", true).ilike("role", "%constructor%").order("role").order("name").limit(5000),
    loadVariantIndex(supabase),
  ]);
  // Litrato ayon sa kulay ng linya (color_variants, 0231); hero kapag walang tugma.
  const imgFor = (name: string | null | undefined, sku: string | null | undefined, color: string | null | undefined, fallback: string | null | undefined) =>
    imageForColor(variantsFor(variantIdx, name, sku), color) ?? fallback ?? null;
  // Delivery lifecycle overlay → the tracker shows the live stage (Out for Delivery / Arrived / Installation / Delivered).
  const delStatusByOrder = new Map<number, string>();
  for (const d of ((delsRaw ?? []) as { order_id: number | null; status: string | null }[])) {
    if (d.order_id != null && d.status) delStatusByOrder.set(d.order_id, d.status);
  }
  // Lines a manager marked "no workshop needed" → excluded from the To-Assign queue.
  // UNANG LINYA ANG SUSI (2026-08-26). Ang Skip ay nagtatago ng BUONG
  // multi-line description (kailangan ng QC pack card ang specs), pero ang
  // paghahambing sa pila ay sa unang linya - kaya ang na-skip na item na may
  // spec bullets ay hindi kailanman tumutugma at hindi umaalis sa pila:
  // mukhang walang ginagawa ang Skip. I-normalize pareho sa unang linya.
  // KADA KULAY (0234): eksaktong kulay kapag may kulay ang skip; ang legacy
  // (walang kulay) ay ISANG linya lang ang tinatago.
  const isLineSkipped = makeSkipMatcher((skips ?? []) as SkipRow[], firstLine);

  const workshops = (ws ?? []) as WorkshopLite[];
  const wsName = new Map<number, string>(workshops.map((w) => [w.id, w.name]));
  const matName = new Map<number, string>(((mats ?? []) as { id: number; name: string }[]).map((m) => [m.id, m.name]));
  const onHandByMat = new Map<number, number>();
  for (const s of ((stockRaw ?? []) as { material_id: number; on_hand: number }[])) onHandByMat.set(s.material_id, Number(s.on_hand ?? 0));
  type MatRaw = { id: number; workshop_id: number; name: string; barcode: string | null; unit: string | null; category: string | null; low_threshold: number | null; price: number | null; image_url: string | null; manager_only: boolean | null };
  const materials: MaterialRow[] = ((mats ?? []) as MatRaw[]).map((m) => ({
    id: m.id, workshop_id: m.workshop_id, workshop_name: wsName.get(m.workshop_id) ?? "—",
    name: m.name, barcode: m.barcode ?? null, unit: m.unit ?? "pcs", category: m.category ?? null,
    low_threshold: Number(m.low_threshold ?? 0), price: Number(m.price ?? 0), image_url: m.image_url ?? null, on_hand: onHandByMat.get(m.id) ?? 0,
    manager_only: !!m.manager_only,
  }));
  // Order date + rush flag per order → attached to each job for the Rush badge.
  const orderMeta = new Map<number, { date_order: string | null; is_rush: boolean; rush_days: number | null }>();
  for (const o of ((orders ?? []) as { id: number; date_order: string | null; is_rush: boolean | null; rush_days?: number | null }[])) {
    orderMeta.set(o.id, { date_order: o.date_order ? String(o.date_order).slice(0, 10) : null, is_rush: !!o.is_rush, rush_days: o.rush_days ?? null });
  }
  const normName = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  type ProdLite = { product_name: string | null; image_url: string | null; sku: string | null; category: string | null; color: string | null; dimension: string | null };
  const prodByName = new Map<string, ProdLite>();
  for (const p of (prods ?? []) as ProdLite[]) {
    if (p.product_name) prodByName.set(normName(p.product_name), p);
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const jobStatus = (j: any): string => {
    const s = j.status ?? "pending";
    // Ang delivery-stage overlay ay para lang sa jobs na TAPOS na ang produksyon
    // (QC pasado/na-receive) — ang rework job na inaayos pa ay hindi dapat
    // masapawan ng pickup/redelivery status ng order.
    const pastProduction = /qc passed|received|done|delivered|arrived|installation|out for delivery/i.test(s);
    const ds = j.order_id != null ? delStatusByOrder.get(j.order_id) : undefined;
    if (pastProduction && ds && /out for delivery|arrived|installation|delivered/i.test(ds)) return ds; // live delivery stage wins
    if (/^done$/i.test(s)) return "QC Passed"; // legacy "done" → new lifecycle equivalent
    return s;
  };
  const jobs: JobRow[] = ((jobsRaw ?? []) as any[]).map((j) => {
    // matchName strips the "Rework · RMA-x ·" tag so rework jobs match their product too.
    const p = prodByName.get(normName(matchName(j.item_desc)));
    // Customized items aren't in the catalog — recover specs from the "• …"
    // bullets of the dispatched full description instead.
    //
    // ANG CATALOG ANG NAUUNA (2026-08-23). Ang parseDescSpecs ay HUMUHULA mula
    // sa pagkakasunod ng bullets ("una = color, huli = category") — tama iyon
    // sa resibo ng simpleng produkto, mali sa build ng customizer kung saan
    // ang unang bullet ay ang pamagat. Kapag nasa catalog ang produkto, ang
    // nakatala roon ang totoo; ang hula ay pambalik lang.
    const specs = parseDescSpecs(j.item_desc);
    return {
      id: j.id, order_id: j.order_id ?? null, order_number: j.order_number ?? null,
      stock_request: !!j.stock_request, stock_reason: j.stock_reason ?? null,
      workshop_id: j.workshop_id, workshop_name: wsName.get(j.workshop_id) ?? "—",
      item_desc: j.item_desc ?? null, qty: Number(j.qty ?? 0), status: jobStatus(j),
      dispatched_at: j.dispatched_at ? String(j.dispatched_at).slice(0, 10) : null,
      image_url: imgFor(matchName(j.item_desc), p?.sku, specs.color ?? p?.color, p?.image_url), sku: p?.sku ?? null, category: p?.category ?? specs.category ?? null, color: p?.color ?? specs.color ?? null, dimension: specs.dimension ?? p?.dimension ?? null, frame: specs.frame,
      fulfillment: (j.fulfillment as "warehouse" | "pickup") ?? "warehouse",
      date_order: j.order_id != null ? (orderMeta.get(j.order_id)?.date_order ?? null) : null,
      is_rush: j.order_id != null ? (orderMeta.get(j.order_id)?.is_rush ?? false) : false,
      rush_days: j.order_id != null ? (orderMeta.get(j.order_id)?.rush_days ?? null) : null,
    };
  });

  // Lines already dispatched → keyed by order_id + item description (first line).
  // KASAMA ANG KULAY: ang job ng isang kulay ay hindi nagtatago ng ibang kulay
  // ng parehong produkto sa To Assign.
  const dispatched = new Set(jobs.map((j) => `${j.order_id}|${lineKey(j.item_desc)}`));

  // ANG RESERBA ANG KATIBAYAN (2026-08-26).
  //
  // Ang gate sa ibaba ay downpaymentMet — tama iyon sa unang pagpasok, pero ang
  // IDINAGDAG na item ay nagpapataas ng total nang hindi nagpapataas ng bayad,
  // kaya ang 30% ay biglang kulang at ang BUONG order ay nahuhulog sa labas ng
  // pila. Ang naipadala nang linya ay nasa workshop pa rin; ang bago ay
  // nawawala nang walang bakas — walang hilera, walang badge.
  //
  // Nangyari ito sa ORD-000006: ₱20,000 na may ₱6,000 na bayad ang dumaan, saka
  // nadagdagan ng ₱20,000 — at ang pangalawang sofa ay hindi na lumitaw.
  //
  // Ito ang PAREHONG panuntunan ng addItemsToOrder/updateOrder (tingnan ang
  // app/orders/add-items.test.ts): dpMet = 30% ng bagong total O naka-reserba
  // na. Nakapag-reserba lang ang order kung naabot ang downpayment noon, kaya
  // ang reserba ang dala-dalang katibayan — hindi ang lumang kabuuan, na
  // bumabagsak sa pangalawang pagdagdag. Ang Order Approval lang ang hindi
  // sumusunod dito.

  // MTO # → FQ # → Order #: ang quotation ang may hawak ng order number, at ang
  // MTO request ang may hawak ng FQ — dalawang hakbang pabalik. Best-effort:
  // kapag wala pang 0158/0169, walang chips na ipapakita.
  const refByOrder = new Map<string, { mto: string | null; fq: string | null }>();
  try {
    const nums = (orders ?? []).map((o) => (o as OrderRow).order_number).filter(Boolean) as string[];
    if (nums.length) {
      const { data: qs } = await supabase.from("quotations").select("fq_number, order_number").in("order_number", nums);
      const fqs = (qs ?? []).map((q) => q.fq_number as string | null).filter(Boolean) as string[];
      const mtoByFq = new Map<string, string | null>();
      if (fqs.length) {
        const { data: ms } = await supabase.from("mto_requests").select("fq_number, mto_number").in("fq_number", fqs);
        for (const m of ms ?? []) mtoByFq.set(m.fq_number as string, (m.mto_number as string | null) ?? null);
      }
      for (const q of qs ?? []) {
        const fq = (q.fq_number as string | null) ?? null;
        refByOrder.set(q.order_number as string, { mto: fq ? mtoByFq.get(fq) ?? null : null, fq });
      }
    }
  } catch { /* walang kawing — walang chips */ }

  // PARTIAL DELIVERY: ang mga linyang naihatid na sa naunang batch ay hindi na
  // assignable — tapos na sila. Ang natitirang linya ang dapat manatili rito
  // hanggang ma-assign (workshop o No Workshop). Best-effort: wala pang 0200 →
  // walang talaan, walang partial.
  const deliveredLine = new Set<string>();
  {
    const { data: dl } = await supabase.from("order_line_deliveries").select("order_id, item_desc").limit(20000);
    for (const r of (dl ?? []) as { order_id: number | null; item_desc: string | null }[]) {
      if (r.order_id != null) deliveredLine.add(`${r.order_id}|${lineKey(r.item_desc)}`);
    }
  }

  const toAssign: AssignLine[] = [];
  for (const o of (orders ?? []) as OrderRow[]) {
    // Skip orders no longer needing workshop assignment — cancelled, or already past
    // production (Delivered / Out for Delivery). NOT payment-"Completed", since that
    // only means fully PAID and the item may still need to be made. A line also
    // leaves the queue once it's dispatched to a workshop (the `dispatched` check).
    // "Partial Delivery" ay BUKAS pa — may linyang hindi pa naihahatid, at maaaring
    // hindi pa ito na-a-assign kailanman (idinagdag matapos ang unang batch).
    if (/cancel/i.test(o.status ?? "") || (/deliver/i.test(o.status ?? "") && !/partial/i.test(o.status ?? ""))) continue;
    // Hide unpaid/under-downpayment orders — not confirmed yet, so not ready to
    // dispatch. Maliban kung may naipadala nang linya: kumpirmado na ang order,
    // at ang idinagdag dito ay kailangan pa ring dumaan sa approval.
    if (!downpaymentMet(o) && !o.inventory_deducted) continue;
    const items = o.receipt_items ?? [];
    if (!items.length) continue;
    for (const it of items) {
      const desc = firstLine(it.description);
      if (!desc) continue;
      // Ang mga FEE (Shipping/Rush at "Addtl." variants) ay bayarin, hindi
      // produktong gagawin — hindi dapat lumabas na assignable line (2026-08-19).
      if (/^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test(desc)) continue;
      // Lines already tagged to a constructor are handled by the Constructor (per-gawa) flow — skip to avoid a double queue.
      if (it.constructorName) continue;
      if (hasKey(dispatched, lineKey(it.description, it.color), `${o.id}|`)) continue;
      // Kulay ng linya = sarili nito, saka ang "Fabric:" bullet — PAREHO ng
      // itinatala ng Skip (AssignLine.color), kung hindi ay hindi magtutugma.
      if (isLineSkipped(o.id, desc, it.color || colorLabelOfDesc(it.description) || null)) continue; // manager marked "no workshop"
      if (hasKey(deliveredLine, lineKey(it.description, it.color), `${o.id}|`)) continue; // naihatid na sa naunang batch
      // QC-OUT / Start Delivery na (0225, 2026-09-03 "pag nag QC out ako pag
      // partial nalabas ulit sa Order Approval"): bawas na sa istante ang
      // linyang ito at paalis na — wala nang ia-assign sa workshop, kahit hindi
      // pa ito naihahatid.
      if (lineShipped(o, it.description, it.color)) continue;
      const p = prodByName.get(normName(desc));
      toAssign.push({
        order_id: o.id, order_number: o.order_number ?? null, customer: o.customer_name ?? null,
        date: o.date_order ? String(o.date_order).slice(0, 10) : null,
        source: o.Source ?? null, address: o.address ?? null,
        item_desc: desc, full_desc: String(it.description ?? "").trim() || desc, qty: Number(it.qty) || 1,
        image: imgFor(desc, it.sku ?? p?.sku, it.color, it.image ?? p?.image_url),
        customized: !!it.customized,
        sku: it.sku ?? p?.sku ?? null,
        category: it.category ?? p?.category ?? null,
        // Kulay ng linya: sarili, saka Fabric bullet, saka catalog — ito ang
        // isinusulat ng Skip at ito rin ang tinutugma ng loader.
        color: it.color || colorLabelOfDesc(it.description) || p?.color || null,
        dimension: it.dimension ?? p?.dimension ?? null,
        is_rush: !!o.is_rush,
        rush_days: (o as { rush_days?: number | null }).rush_days ?? null,
        mto_number: refByOrder.get(o.order_number ?? "")?.mto ?? null,
        fq_number: refByOrder.get(o.order_number ?? "")?.fq ?? null,
        contact: (o as { contact_number?: string | null }).contact_number ?? null,
        order_total: Number(o.full_payment_price) || 0,
        short_paid: !downpaymentMet(o),
        paid: (Number(o.downpayment_price) || 0) + (Number(o.full_payment) || 0),
      });
    }
  }

  const requests: RequestRow[] = ((reqRaw ?? []) as any[]).map((r) => ({
    id: r.id, workshop_id: r.workshop_id, workshop_name: wsName.get(r.workshop_id) ?? "—",
    material_id: r.material_id ?? null, material_name: r.material_id != null ? (matName.get(r.material_id) ?? "—") : "—",
    qty_requested: Number(r.qty_requested ?? 0), qty_fulfilled: r.qty_fulfilled != null ? Number(r.qty_fulfilled) : null, qty_received: Number(r.qty_received ?? 0),
    reason: r.reason ?? null, status: r.status ?? "pending", ops_followed_up: !!r.ops_followed_up,
    created_at: r.created_at ? String(r.created_at).slice(0, 10) : null,
  }));

  const weekAgo = Date.now() - 7 * 86400000;
  const doneWeek = jobs.filter((j) => /delivered/i.test(j.status) && j.dispatched_at && new Date(j.dispatched_at).getTime() >= weekAgo).length;
  const kpi = {
    toAssign: toAssign.length,
    inProgress: jobs.filter((j) => /in_progress|accepted|pending|qc passed|out for delivery|arrived|installation/i.test(j.status)).length,
    doneWeek,
    pendingReq: requests.filter((r) => /pending/i.test(r.status) || (/partial/i.test(r.status) && !r.ops_followed_up)).length,
  };

  const ordersById: Record<number, OrderRow> = {};
  for (const o of ((orders ?? []) as OrderRow[])) ordersById[o.id] = o;
  const assignees = ((salesEmps ?? []) as { name: string | null; role: string | null }[]).map((e) => ({ name: e.name ?? "", role: e.role ?? "" })).filter((e) => e.name);
  const constructors = ((consEmps ?? []) as { name: string | null; role: string | null }[]).map((e) => ({ name: e.name ?? "", role: e.role ?? "" })).filter((e) => e.name);

  return {
    workshops, toAssign, jobs, requests, materials, kpi,
    rushThreshold: rushThresholdFrom(rushSetting?.value),
    ordersById, products: (prodFull ?? []) as ProductRow[], assignees, constructors,
  };
}

// Lightweight To-Assign ORDER count for the sidebar badge — counts the number of
// ORDERS that still have at least one assignable line (one row per order in the Order
// Approval table), using the SAME per-line filter (downpayment met, not cancel/deliver,
// minus constructor-tagged / already-dispatched / manager-skipped lines). So the badge
// matches the rows you see, and drops as you Assign/Skip the last line of an order.
// 5s TTL cache (same as the sidebar badges) so this heavy count — which runs on EVERY
// navigation for ops/admin via the layout — isn't recomputed on rapid page changes /
// realtime refreshes. Counts tolerate a little staleness; the number stays close to live.
let _toAssignCache: { at: number; n: number } | null = null;
const TO_ASSIGN_TTL_MS = 5_000;
export async function loadToAssignCount(): Promise<number> {
  if (_toAssignCache && Date.now() - _toAssignCache.at < TO_ASSIGN_TTL_MS) return _toAssignCache.n;
  const n = await computeToAssignCount();
  _toAssignCache = { at: Date.now(), n };
  return n;
}

async function computeToAssignCount(): Promise<number> {
  const supabase = createServerSupabase();
  // Only orders that can POSSIBLY still be assignable: exclude cancelled/delivered
  // states at the DB (they can never contribute to the badge) so we don't pull the
  // whole order history + its heavy receipt_items JSON on every navigation. The
  // remaining sets are small membership lookups.
  // "Partial Delivery" ay hindi kasama sa itinatapon — bukas pa ang order at
  // maaaring may linyang hindi pa na-a-assign (kaya ang %deliver% exclusion ay
  // may partial exception sa or()).
  const [{ data: orders }, { data: jobsRaw }, { data: skips }, { data: dl }] = await Promise.all([
    supabase.from("orders").select('id, status, receipt_items, full_payment_price, downpayment_price, full_payment, inventory_deducted, lines_shipped')
      .not("status", "ilike", "%cancel%")
      .or("status.not.ilike.%deliver%,status.ilike.%partial%")
      .limit(2000),
    supabase.from("workshop_job").select("order_id, item_desc").limit(5000),
    loadSkipRows(supabase).then((rows) => ({ data: rows })),
    supabase.from("order_line_deliveries").select("order_id, item_desc").limit(20000),
  ]);
  const deliveredLine = new Set(((dl ?? []) as { order_id: number | null; item_desc: string | null }[])
    .map((r) => `${r.order_id}|${firstLine(r.item_desc)}`));
  const dispatched = new Set(((jobsRaw ?? []) as { order_id: number | null; item_desc: string | null }[])
    .map((j) => `${j.order_id}|${lineKey(j.item_desc)}`));
  // Kapareho ng loadOperations: unang linya ang susi (ang tinatago ay buo).
  const isLineSkipped = makeSkipMatcher((skips ?? []) as SkipRow[], firstLine);

  let orderCount = 0;
  for (const o of (orders ?? []) as unknown as OrderRow[]) {
    if (/cancel/i.test(o.status ?? "") || (/deliver/i.test(o.status ?? "") && !/partial/i.test(o.status ?? ""))) continue;
    if (!downpaymentMet(o) && !o.inventory_deducted) continue;
    // This order counts if it has ANY line still needing assignment.
    const hasAssignable = (o.receipt_items ?? []).some((it) => {
      const desc = firstLine(it.description);
      if (!desc || it.constructorName) return false;
      if (/^(addtl\.?\s*)?(additional\s*)?(shipping|rush)(\s*fee)?$/i.test(desc)) return false; // Fees = hindi assignable
      if (hasKey(dispatched, lineKey(it.description, it.color), `${o.id}|`)) return false;
      if (isLineSkipped(o.id, desc, it.color || colorLabelOfDesc(it.description) || null)) return false;
      if (hasKey(deliveredLine, lineKey(it.description, it.color), `${o.id}|`)) return false; // naihatid na sa naunang batch
      if (lineShipped(o, it.description, it.color)) return false; // QC-OUT / Start Delivery na (0225)
      return true;
    });
    if (hasAssignable) orderCount++;
  }
  return orderCount;
}
