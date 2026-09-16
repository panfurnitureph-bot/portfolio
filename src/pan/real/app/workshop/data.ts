import { parseDescSpecs, matchName } from "@/lib/receipt-desc";
import { loadEmployeesLite } from "@/app/hr/projects/data";
import { projectBaseWorkers, type WorkerLite } from "@/lib/workshop/workers";
import { createServerSupabase } from "@/lib/supabase/server";
import { rushThresholdFrom, DEFAULT_RUSH_DAYS } from "@/lib/rush";
import { getSessionFast } from "@/lib/auth/session";
import { WORKSHOP_ROLE_NAME } from "@/lib/auth/rbac";
import { makeColorPhoto } from "@/lib/ops/product-variants";

export type WorkshopLite = { id: number; name: string };

export type WJob = {
  id: number;
  order_id: number | null;
  order_number: string | null;
  item_desc: string | null;
  qty: number;
  status: string;
  dispatched_at: string | null;
  image_url: string | null;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  frame: string | null;   // frame parts / add-ons (W · Hdbrd · L · Base · Legs)
  product_type: string | null; // Local | Imported — mula sa catalog match
  rma_no: string | null;        // rework job lang: RMA number ng pinagmulang return
  rework_photos: string[];      // rework job lang: need-repair proof photos ng RMA
  // ANG PIYESANG INAPRUBAHAN (2026-08-27): ang workshop na kukumpuni ay hindi
  // nakakakita kung anong parts ang binayaran ng customer — nasa RMA lang ito.
  // Ang crew ay nagtatanong ng "ano ang ipapalit?" na sagot ay nasa ibang page.
  rework_parts: { part: string; qty: number; amount: number }[];
  unit_price: number | null;
  fulfillment: "warehouse" | "pickup";
  date_order: string | null;
  is_rush: boolean;
  rush_days: number | null;
  // STOCK BUILD (0182): ipinagawa nang walang order — para lang magkastock.
  // Ang SKU ay itinakda na sa pag-assign; ang route ay laging pabalik sa bodega.
  stock_request: boolean;
  stock_sku: string | null;
  stock_reason: string | null;
};

export type WMaterial = {
  id: number;
  name: string;
  barcode: string | null;
  unit: string;
  category: string | null;
  image_url: string | null;
  on_hand: number;
  low_threshold: number;
  status: "ok" | "near" | "low";
  manager_only: boolean;
};

export type WLog = {
  id: number;
  material_name: string;
  material_image: string | null;
  delta: number;
  type: string;
  source: string;
  ref_type: string | null;
  ref_id: number | null;
  note: string | null;
  by: string | null;
  // Sino ang GUMAMIT (worker) - 0178. Null sa lumang tala at bago tumakbo ang migration.
  used_by: string | null;
  // Aling PRODUKTO (0197): ang workshop_job na kinonsumohan. Null sa lumang
  // tala ng order na maraming job - doon, buong order ang lakip.
  job_id: number | null;
  created_at: string | null;
};

export type WRequest = {
  id: number;
  material_name: string;
  qty_requested: number;
  qty_fulfilled: number | null;
  qty_received: number;
  reason: string | null;
  status: string;
  created_at: string | null;
};

export type WorkshopData = {
  workshops: WorkshopLite[];
  active: WorkshopLite | null;
  jobs: WJob[];
  materials: WMaterial[];
  logs: WLog[];
  // GMA Project Base na workers (lahat ng section) - pagpipilian ng "Used by" sa
  // Materials Used. Pangalan ang naitatala, kaya pangalan ang dala rito.
  workers: WorkerLite[];
  requests: WRequest[];
  kpi: { activeJobs: number; low: number; pendingReq: number; materials: number };
  rushThreshold: number;
  // LAHAT ng Design Details kada order_number (binago 2026-08-19) — pati
  // uploaded/Pending, hindi na Accepted lang; ipinapakita LAHAT sa Product
  // Details modal ng job.
  designByOrder: Record<string, { ddNumber: string | null; title: string | null; sku: string | null; imageUrl: string; status: string; approvedAt: string | null; createdBy: string | null }[]>;
};

function stockStatus(onHand: number, low: number): WMaterial["status"] {
  if (low > 0 && onHand <= low) return "low";
  if (low > 0 && onHand <= low * 1.2) return "near";
  return "ok";
}

// Tumatanggap ng numeric id O name slug ("gma-original-workshop") — ang sidebar
// workshop groups ay slug ang dala (stable kahit magbago ang mga id).
export async function loadWorkshop(workshopRef?: number | string): Promise<WorkshopData> {
  const supabase = createServerSupabase();
  // Litrato ayon sa kulay ng item (color_variants) — lib/ops/product-variants.
  const photo = await makeColorPhoto(supabase);
  const { data: ws } = await supabase.from("workshop").select("id, name").eq("active", true).order("name").limit(5000);
  let workshops = (ws ?? []) as WorkshopLite[];

  let workshopId: number | undefined = typeof workshopRef === "number" ? workshopRef : undefined;
  if (typeof workshopRef === "string" && workshopRef.trim()) {
    const n = Number(workshopRef);
    if (Number.isFinite(n) && n > 0) workshopId = n;
    else {
      const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      workshopId = workshops.find((w) => slugOf(w.name ?? "") === slugOf(workshopRef))?.id;
    }
  }

  // WORKSHOP-TABLET LOCK: ang mga workshop role (GMA Original / GMA White / LRT)
  // ay laging naka-pinned sa SARILING workshop — balewala ang ?ws= param, at ang
  // switcher dropdown ay iisa lang ang laman.
  const me = await getSessionFast();
  const lockName = me ? WORKSHOP_ROLE_NAME[me.role] : undefined;
  if (lockName) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const own = workshops.find((w) => norm(w.name ?? "") === norm(lockName)) ?? null;
    workshops = own ? [own] : [];
    workshopId = own?.id;
  }

  const active = workshops.find((w) => w.id === workshopId) ?? workshops[0] ?? null;
  if (!active) return { workshops, active: null, jobs: [], materials: [], logs: [], workers: [], requests: [], kpi: { activeJobs: 0, low: 0, pendingReq: 0, materials: 0 }, rushThreshold: DEFAULT_RUSH_DAYS, designByOrder: {} };

  const [{ data: jobsRaw }, { data: matsRaw }, { data: stockRaw }, { data: logsRaw }, { data: reqRaw }, { data: prods }, { data: delsRaw }, { data: ordersRaw }, { data: rushSetting }, { data: reworkRets }] = await Promise.all([
    supabase.from("workshop_job").select("id, order_id, order_number, item_desc, qty, status, dispatched_at, fulfillment, stock_request, stock_sku, stock_reason").eq("workshop_id", active.id).order("dispatched_at", { ascending: false }).limit(5000),
    supabase.from("workshop_material").select("id, name, barcode, unit, category, image_url, low_threshold, manager_only").eq("workshop_id", active.id).eq("active", true).order("name").limit(5000),
    supabase.from("workshop_stock").select("material_id, on_hand").order("material_id").limit(20000),
    // select("*"): may used_by na (0178), pero kung hindi pa tumatakbo ang migration ay
    // magpapabagsak sa BUONG query ang pangalanang column - at blangko ang history.
    supabase.from("workshop_stock_log").select("*").eq("workshop_id", active.id).order("created_at", { ascending: false }).limit(2000),
    supabase.from("stock_request").select("id, material_id, qty_requested, qty_fulfilled, qty_received, reason, status, created_at").eq("workshop_id", active.id).order("created_at", { ascending: false }).limit(5000),
    supabase.from("product").select("product_name, sku, category, color, dimension, image_url, price, product_type").order("product_name").limit(5000),
    supabase.from("deliveries").select("order_id, status").order("order_id").limit(20000),
    supabase.from("orders").select("id, date_order, is_rush, rush_days").order("date_order", { ascending: false }).order("id", { ascending: false }).limit(5000),
    supabase.from("app_settings").select("value").eq("key", "rush_threshold_days").maybeSingle(),
    // Rework returns → RMA number + need-repair proof photos, attached to the
    // dispatched rework job so the workshop sees WHAT to fix.
    supabase.from("returns").select("return_no, rework_job_id, photos, rework_parts").eq("resolution", "rework").not("rework_job_id", "is", null).limit(2000),
  ]);
  // Order date + rush flag per order → attached to each job for the Rush badge.
  const orderMeta = new Map<number, { date_order: string | null; is_rush: boolean; rush_days: number | null }>();
  for (const o of ((ordersRaw ?? []) as { id: number; date_order: string | null; is_rush: boolean | null; rush_days?: number | null }[])) {
    orderMeta.set(o.id, { date_order: o.date_order ? String(o.date_order).slice(0, 10) : null, is_rush: !!o.is_rush, rush_days: o.rush_days ?? null });
  }
  // Delivery lifecycle overlay so My Jobs shows the live stage (Out for Delivery / Arrived / Installation / Delivered).
  const delStatusByOrder = new Map<number, string>();
  for (const dRow of ((delsRaw ?? []) as { order_id: number | null; status: string | null }[])) {
    if (dRow.order_id != null && dRow.status) delStatusByOrder.set(dRow.order_id, dRow.status);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobStatus = (j: any): string => {
    const s = j.status ?? "pending";
    // Overlay ng delivery stage: para lang sa jobs na tapos na ang produksyon —
    // ang rework job na inaayos pa ay hindi sinasapawan ng pickup/redelivery
    // status ng order.
    const pastProduction = /qc passed|received|done|delivered|arrived|installation|out for delivery/i.test(s);
    const ds = j.order_id != null ? delStatusByOrder.get(j.order_id) : undefined;
    if (pastProduction && ds && /out for delivery|arrived|installation|delivered/i.test(ds)) return ds; // live delivery stage wins
    if (/^done$/i.test(s)) return "QC Passed"; // legacy "done" → new lifecycle equivalent
    return s;
  };
  // Product specs (category/color/dimension/photo) the workshop bases work on — matched by name.
  const prodNorm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  // Spec-line guard: ang value na may ":" ay spec line, hindi category/color.
  const cleanSpec = (v?: string | null) => { const s = (v ?? "").trim(); return s && !s.includes(":") ? s : null; };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const prodByName = new Map<string, any>();
  for (const p of (prods ?? []) as any[]) if (p.product_name) prodByName.set(prodNorm(p.product_name), p);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const onHandByMat = new Map<number, number>();
  for (const s of (stockRaw ?? []) as any[]) onHandByMat.set(s.material_id, Number(s.on_hand ?? 0));
  const matName = new Map<number, string>();
  const matImage = new Map<number, string | null>();

  const materials: WMaterial[] = ((matsRaw ?? []) as any[]).map((m) => {
    matName.set(m.id, m.name);
    matImage.set(m.id, m.image_url ?? null);
    const on_hand = onHandByMat.get(m.id) ?? 0;
    const low = Number(m.low_threshold ?? 0);
    return { id: m.id, name: m.name, barcode: m.barcode ?? null, unit: m.unit ?? "pcs", category: m.category ?? null, image_url: m.image_url ?? null, on_hand, low_threshold: low, status: stockStatus(on_hand, low), manager_only: !!m.manager_only };
  });

  // RMA + proof photos per rework job (returns.rework_job_id → workshop_job.id).
  type RmaInfo = { rma_no: string | null; photos: string[]; parts: { part: string; qty: number; amount: number }[] };
  const asParts = (v: unknown) =>
    Array.isArray(v)
      ? (v as { part?: unknown; qty?: unknown; amount?: unknown }[])
          .map((x) => ({ part: String(x?.part ?? ""), qty: Number(x?.qty) || 1, amount: Number(x?.amount) || 0 }))
          .filter((x) => x.part)
      : [];
  const rmaByJob = new Map<number, RmaInfo>();
  // PANGALAWANG SUSI: ang RMA NUMBER (2026-08-27). Ang `rework_job_id` ay
  // maaaring hindi tumugma — nakita sa job 109, na may "Rework · RMA-000003" sa
  // item_desc pero walang RMA row na nakaturo pabalik (nabura ang RMA, naiwan
  // ang job). Ang numero ay nasa pangalan mismo ng job, kaya iyon ang panghuling
  // hanapan bago sumuko.
  const rmaByNo = new Map<string, RmaInfo>();
  for (const r of ((reworkRets ?? []) as { return_no: string | null; rework_job_id: number | null; photos: string[] | null; rework_parts?: unknown }[])) {
    const info: RmaInfo = {
      rma_no: r.return_no ?? null,
      photos: Array.isArray(r.photos) ? r.photos : [],
      parts: asParts(r.rework_parts),
    };
    if (r.rework_job_id != null) rmaByJob.set(Number(r.rework_job_id), info);
    if (r.return_no) rmaByNo.set(r.return_no.toUpperCase(), info);
  }
  // Ang RMA ng isang job, alinman ang tumugma.
  const rmaOf = (jobId: number, itemDesc: string | null): RmaInfo | undefined =>
    rmaByJob.get(jobId)
    ?? (() => {
      const no = String(itemDesc ?? "").match(/rma-\d+/i)?.[0]?.toUpperCase();
      return no ? rmaByNo.get(no) : undefined;
    })();
  const jobs: WJob[] = ((jobsRaw ?? []) as any[]).map((j) => {
    // matchName strips the "Rework · RMA-x ·" tag so rework jobs still match
    // their product (image/SKU/price) and render like a normal job row.
    const p = prodByName.get(prodNorm(matchName(j.item_desc)));
    // Order-specific specs from the dispatched description's "• …" bullets win
    // over the catalog — customized items carry their real color/dims there.
    const specs = parseDescSpecs(j.item_desc);
    return {
      id: j.id, order_id: j.order_id ?? null, order_number: j.order_number ?? null, item_desc: j.item_desc ?? null,
      qty: Number(j.qty ?? 0), status: jobStatus(j), dispatched_at: j.dispatched_at ? String(j.dispatched_at).slice(0, 10) : null,
      stock_request: !!j.stock_request, stock_sku: j.stock_sku ?? null, stock_reason: j.stock_reason ?? null,
      // SANITIZE (2026-08-19): sa bagong specs format, ang positional parse ay
      // nakakakuha ng spec lines ("Fabric: …") — kapag may ":" ang value,
      // balewalain at ang catalog ang gamitin (hal. Category = "Sofa").
      image_url: photo(j.item_desc, p?.sku, cleanSpec(specs.color), j.item_desc, p?.image_url ?? null), sku: p?.sku ?? null,
      category: cleanSpec(specs.category) ?? p?.category ?? null,
      color: cleanSpec(specs.color) ?? p?.color ?? null,
      dimension: cleanSpec(specs.dimension) ?? p?.dimension ?? null,
      frame: specs.frame,
      product_type: p?.product_type ?? null,
      rma_no: rmaOf(Number(j.id), j.item_desc)?.rma_no ?? null,
      rework_photos: rmaOf(Number(j.id), j.item_desc)?.photos ?? [],
      rework_parts: rmaOf(Number(j.id), j.item_desc)?.parts ?? [],
      unit_price: p?.price != null ? Number(p.price) : null,
      fulfillment: (j.fulfillment as "warehouse" | "pickup") ?? "warehouse",
      date_order: j.order_id != null ? (orderMeta.get(j.order_id)?.date_order ?? null) : null,
      is_rush: j.order_id != null ? (orderMeta.get(j.order_id)?.is_rush ?? false) : false,
      rush_days: j.order_id != null ? (orderMeta.get(j.order_id)?.rush_days ?? null) : null,
    };
  });

  const logs: WLog[] = ((logsRaw ?? []) as any[]).map((l) => ({
    id: l.id, material_name: matName.get(l.material_id) ?? "—", material_image: matImage.get(l.material_id) ?? null, delta: Number(l.delta ?? 0), type: l.type ?? "adjust",
    source: l.source ?? "manual", ref_type: l.ref_type ?? null, ref_id: l.ref_id ?? null, note: l.note ?? null, by: l.by ?? null, used_by: l.used_by ?? null, job_id: (l as { job_id?: number | null }).job_id ?? null,
    created_at: l.created_at ? String(l.created_at).slice(0, 16).replace("T", " ") : null,
  }));

  const requests: WRequest[] = ((reqRaw ?? []) as any[]).map((r) => ({
    id: r.id, material_name: r.material_id != null ? (matName.get(r.material_id) ?? "—") : "—",
    qty_requested: Number(r.qty_requested ?? 0), qty_fulfilled: r.qty_fulfilled != null ? Number(r.qty_fulfilled) : null, qty_received: Number(r.qty_received ?? 0),
    reason: r.reason ?? null, status: r.status ?? "pending", created_at: r.created_at ? String(r.created_at).slice(0, 10) : null,
  }));

  const kpi = {
    activeJobs: jobs.filter((j) => /pending|accepted|in_progress/.test(j.status)).length,
    low: materials.filter((m) => m.status === "low").length,
    pendingReq: requests.filter((r) => /pending/.test(r.status)).length,
    materials: materials.length,
  };

  // LAHAT ng Design Details kada order_number ng mga job dito (2026-08-19) —
  // pati uploaded/Pending, hindi na Accepted lang; lahat ay pages sa modal.
  const designByOrder: WorkshopData["designByOrder"] = {};
  try {
    // Ang STOCK BUILD ay walang order — ang SKU nito ang susi. Sa design_details
    // ito ay nasa `sku` (0183), at sa mga sheet na naunang na-upload ay nasa
    // order_number pa (hanggang tumakbo ang backfill 0184). Hinahanap ang
    // dalawa, at ang SKU pa rin ang susi ng mapa — ganoon din ang hinahanap
    // ng modal para sa isang stock job.
    const orderNos = [...new Set(jobs.map((j) => (j.order_number ?? "").trim()).filter(Boolean))];
    // Ang REWORK job ay HINDI stock build kahit stock_request=true ang pagkaka-
    // gawa nito (to-warehouse na repair): ang design sheet ng gawa ng IBANG
    // order o ng stock ay hindi sa kanya. Ang sarili niyang order ang susi -
    // kung wala, walang sheet.
    const stockSkus = [...new Set(jobs.map((j) => (j.stock_request && !/^\s*rework\b/i.test(j.item_desc ?? "") ? (j.stock_sku ?? "").trim() : "")).filter(Boolean))];
    const keys = [...new Set([...orderNos, ...stockSkus])];
    if (keys.length) {
      const [{ data: byOrder }, { data: bySku }] = await Promise.all([
        supabase.from("design_details")
          .select("order_number, sku, dd_number, title, image_url, status, replied_at, created_by, id")
          .in("order_number", keys).order("id", { ascending: false }).limit(1000),
        stockSkus.length
          ? supabase.from("design_details")
              .select("order_number, sku, dd_number, title, image_url, status, replied_at, created_by, id")
              .in("sku", stockSkus).order("id", { ascending: false }).limit(1000)
          : Promise.resolve({ data: [] as unknown[] }),
      ]);
      const seen = new Set<number>();
      const dds = [...(byOrder ?? []), ...(bySku ?? [])].filter((d) => {
        const id = (d as { id: number }).id;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      for (const d of dds as { order_number: string | null; sku: string | null; dd_number: string | null; title: string | null; image_url: string | null; status: string | null; replied_at: string | null; created_by: string | null }[]) {
        // ANG SARILING ORDER NG SHEET ANG PANALO (2026-09-02): ang sheet na
        // naka-ukol sa isang order ay sa order na iyon lang nakakabit — dating
        // nauunahan ito ng SKU bucket, kaya ang sheet ng ORD-000005 ay lumalabas
        // sa stock job (at nawawala pa sa sariling order). Ang sheet na WALANG
        // order (tunay na stock sheet) ang nakukuha ng SKU na susi.
        const sku = (d.sku ?? "").trim();
        const ord = (d.order_number ?? "").trim();
        const k = ord && orderNos.includes(ord) ? ord : (sku && stockSkus.includes(sku) ? sku : ord);
        if (k && d.image_url) {
          (designByOrder[k] ??= []).push({ ddNumber: d.dd_number, title: d.title ?? null, sku: sku || null, imageUrl: d.image_url, status: d.status ?? "Draft", approvedAt: d.replied_at ? String(d.replied_at).slice(0, 10) : null, createdBy: d.created_by });
        }
      }
    }
  } catch { /* wala pang 0161 — walang DD card */ }

  // Ang pagpipilian ng "Used by" - hiwalay na query, best-effort: kapag nabigo,
  // blangkong dropdown ang lalabas, hindi sirang page.
  const workers = projectBaseWorkers(await loadEmployeesLite().catch(() => []));
  return { workshops, active, jobs, materials, logs, workers, requests, kpi, rushThreshold: rushThresholdFrom(rushSetting?.value), designByOrder };
}
