import { fetchAll } from "@/lib/fetch-all";
import { createServerSupabase } from "@/lib/supabase/server";
import { isShippingDesc } from "@/lib/shipping";
import { parseDescSpecs, matchName } from "@/lib/receipt-desc";
import { loadSkipRows, type SkipRow } from "@/lib/ops/skips";
import { loadVariantIndex, variantsFor, imageForColor } from "@/lib/ops/product-variants";
import { colorOfDesc, colorLabelOfDesc } from "@/lib/orders/line-key";

// One scannable catalog item (match a scanned SKU/barcode to product details).
export type QcCatalogItem = {
  sku: string;
  product_name: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  // Specifications / design details — bullets sa QC browse preview (2026-08-18).
  specs?: string | null;
  image_url: string | null;
  cost: number;
  location: string | null;            // Rak # → auto-fills the QC Rak picker
  warehouse_location: string | null;  // Zone # → auto-fills the QC Zone picker
};

// A workshop-finished job awaiting receiving QC (done, not yet QC'd into stock).
export type QcPendingJob = {
  job_id: number;
  order_id: number | null;
  order_number: string | null;
  item_desc: string | null;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  frame: string | null;         // frame parts / add-ons (W · Hdbrd · L · Base · Legs)
  image_url: string | null;
  qty: number;
  workshopQcPhotos: string[];   // proof photos carried over from the Workshop QC declaration
  workshopQcGroups: { name: string; photos: string[] }[]; // parehong photos, naka-grupo per checklist item
  // Rush ng pinagmulang order — badge sa QC queue.
  is_rush: boolean;
  rush_days: number | null;
  order_date: string | null;
};

// An imported Purchase-Order line still in transit / not fully received. Sourced from
// purchase_order_items (received_qty < qty) of POs that are Ordered/Partially Received.
// Receiving these into stock is now done here at QC (not on the Incoming page): a pass
// stocks in AND bumps the PO item's received_qty, driving the Incoming progress + status.
export type QcPendingIncoming = {
  po_id: number;
  po_item_id: number;
  pi_number: string | null;
  supplier: string | null;
  item_no: string | null;       // maps to the product SKU
  description: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  image_url: string | null;
  ordered_qty: number;
  received_qty: number;
  remaining: number;            // ordered − received (what's left to receive)
};

// A skipped sales-order line ("No Workshop Needed") awaiting Pre-Pack QC before it
// can be delivered. Sourced from ops_line_skip; drops off once prepack-QC passes.
export type QcPendingPack = {
  order_id: number;
  order_number: string | null;
  customer_name: string | null;
  item_desc: string;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  image_url: string | null;
  qty: number;
  // Richer context for the inspection modal.
  date_order: string | null;
  date_of_delivery: string | null;
  order_total: number | null;
  sales_rep: string | null;
  address: string | null;
};

// One QC inspection row (history).
export type QcRow = {
  id: number;
  checkpoint: "receive" | "prepack";
  source: "imported" | "workshop" | "order";
  ref_label: string | null;
  // Ang order id ng talang ito (0/null kapag walang order — direct stock).
  // Kailangan ito ng manwal na "Mark dispatched" sa mga naiipit na hilera.
  ref_id: number | null;
  sku: string | null;
  product_name: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  qty: number;
  good_qty: number;
  defect_qty: number;
  result: "pass" | "fail";
  photos: string[];
  remarks: string | null;
  checked_by: string | null;
  created_at: string | null;
  // Set once the physical movement actually ran (IN stock-in via finishQcInStockIn,
  // OUT ship via finishQcOutShip). A pass record printed but NOT yet scanned has this
  // null — so the history can show "pending scan" instead of a misleading +qty.
  stocked_at: string | null;
  // ANG BUILD NG CUSTOMER, hiwalay sa category/color (2026-08-23).
  // Ang category/color sa itaas ay galing na sa catalog — ang tunay na "Sofa"
  // at "Beige". Ang build na dating nakasiksik sa dalawang column ay nakalagay
  // dito, kaya may maipapakita pa rin ang Specs na column.
  build_specs: string[];
  // Ledger-style enrichment (resolved in loadQc, not stored on warehouse_qc):
  // product thumbnail from the catalog + the Order # / RMA # this record belongs to.
  image_url: string | null;
  order_number: string | null;
  rma: string | null;
};

// Isang Design Details sheet na naka-attach sa inspection modal (2026-08-31,
// "dapat dito sa lahat ng quality control dito sa warehouse naka attach lahat
// ang design details if meron"). Kapareho ng card sa Workshop My Jobs.
export type QcDesignSheet = {
  ddNumber: string | null;
  title: string | null;
  sku: string | null;
  imageUrl: string;
  status: string;
  approvedAt: string | null;
  createdBy: string | null;
};

export type QcData = {
  catalog: QcCatalogItem[];
  pendingJobs: QcPendingJob[];
  pendingIncoming: QcPendingIncoming[];
  pendingPacks: QcPendingPack[];
  history: QcRow[];
  // Current on-hand per SKU (lowercased) so the history can show the running stock
  // total beside each QC record's +qty (IN) / −qty (OUT).
  stockBySku: Record<string, number>;
  // Design sheets, naka-susi sa ORDER NUMBER at sa SKU (uppercase) — parehong
  // sheet, dalawang pinto: ang workshop job ay may order number, ang stock
  // build at imported ay SKU lang.
  designByKey: Record<string, QcDesignSheet[]>;
  locations: string[];   // warehouse location codes (Rak-01, …) for the Rak # picker
  zones: string[];       // distinct zone numbers (Zone A, …) for the Zone # picker
  kpi: {
    pending: number;       // workshop jobs awaiting receiving QC
    passedToday: number;
    failedToday: number;
    defectRate: number;    // failed / (passed+failed) today, %
  };
};

function asPhotos(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

// Ang tunay na category/color/dimension ng isang QC row.
//
// Ang catalog muna: doon nakatala ang tunay na halaga ("Sofa", "Beige"). Ang
// kopya sa warehouse_qc ang panghuli — sa custom na produkto, ang build ang
// nakasiksik doon ("Fabric: Amalia Canary Yellow"), pero para sa produktong
// wala na sa catalog, iyon na lang ang natitirang alam natin.
function catalogFirst(
  bySku: Map<string, { category: string | null; color: string | null; dimension: string | null }>,
  sku: unknown,
  stored: unknown,
  field: "category" | "color" | "dimension",
): string | null {
  const hit = bySku.get(String(sku ?? "").trim().toLowerCase());
  return hit?.[field] ?? ((stored as string | null) ?? null);
}

export async function loadQc(): Promise<QcData> {
  const supabase = createServerSupabase();

  const [{ data: prodData }, { data: jobData }, { data: qcData }, { data: locData }, { data: invData }, { data: skipRows }, { data: recvJobs }, { data: poData }, { data: poItemData }, variantIdx] = await Promise.all([
    supabase.from("product").select("sku, product_name, category, color, dimension, specs, image_url, cost, warehouse_location, location").order("product_name").limit(5000),
    // Workshop jobs that are FINISHED (ready to hand off to the warehouse) but not
    // yet received into stock. Two workshop lifecycles exist:
    //   • basic job board:  … → "done" → "delivered"
    //   • QC payroll flow:   declare → "For Approval HR" → "QC Passed"
    // Any of the finished states arrives at warehouse Receiving QC. Excludes jobs
    // already pulled into stock (qc_received_at set). workshop_job only stores
    // item_desc — sku/category/image are matched from `product` by item name below.
    // Only HR-APPROVED workshop jobs (status "QC Passed") routed TO THE WAREHOUSE
    // reach Receiving QC. The fulfillment route is chosen at QC declaration:
    // 'warehouse' arrives here, 'pickup' is collected at the workshop and skips it.
    // Excludes jobs already pulled into stock (qc_received_at set).
    // ANG HAUL ANG GATE (0218, 2026-08-31). Dating lumilitaw ito rito sa
    // SANDALI ng declare — bago pa man dumampot ang kahit anong trak — kaya
    // ang bodega ay may "tatanggapin" na wala pa sa daan. Ngayon: hangga't
    // walang team na kumuha sa workshop (transfer_picked_at, itinatatak ng
    // pickup proof), hindi ito lumilitaw sa Workshop (IN). May pambalik: bago
    // ang 0218, walang kolum — huwag hayaang mamatay ang buong queue.
    (async () => {
      const q = (gate: "dropped" | "picked" | "none") => {
        let b = supabase.from("workshop_job")
          .select("id, order_id, order_number, item_desc, qty, status, qc_received_at")
          .eq("status", "QC Passed")
          .eq("fulfillment", "warehouse")
          .is("qc_received_at", null);
        // PAGDATING, HINDI PAGKUHA (0220): ang selyo ng paghahatid sa bodega
        // ang nagpapapasok dito — ang nasa daan pa ay hindi pa tinatanggap.
        if (gate === "dropped") b = b.not("transfer_dropped_at", "is", null);
        if (gate === "picked") b = b.not("transfer_picked_at", "is", null);
        return b.order("id", { ascending: false }).limit(500);
      };
      const r1 = await q("dropped");
      if (!r1.error) return r1;
      const r2 = await q("picked");
      return r2.error ? await q("none") : r2;
    })(),
    supabase.from("warehouse_qc").select("id, checkpoint, source, ref_id, ref_label, sku, product_name, category, color, dimension, qty, good_qty, defect_qty, result, photos, remarks, checked_by, created_at, stocked_at").order("created_at", { ascending: false }).limit(1000),
    fetchAll<{ code: string; zone: string | null }>((f, t) => supabase.from("warehouse_locations").select("code, zone").eq("status", "active").order("code").range(f, t)).then((rows) => ({ data: rows })),
    supabase.from("inventory").select("sku, oh_inv").limit(10000),
    // Pre-Pack queue source: skipped order lines ("No Workshop Needed") awaiting a
    // packing QC check before delivery. Independent of the other batch-1 queries.
    loadSkipRows(supabase).then((rows) => ({ data: rows })),
    // QC-FOR-OUT NG DAAN NA WORKSHOP→WAREHOUSE (2026-08-26). Ang item na ginawa
    // sa workshop at hinatid sa bodega ay lalabas ULIT sa bodega pagdating ng
    // delivery — at doon ang outgoing check, gaya ng sa stock. Dating ang
    // ops_line_skip LANG ang pinagmumulan ng Orders-to-Pack, kaya ang ganitong
    // item ay hindi kailanman dumaan sa QC for OUT.
    supabase.from("workshop_job")
      .select("id, order_id, item_desc, qty")
      .eq("fulfillment", "warehouse")
      .not("qc_received_at", "is", null)
      .ilike("status", "received")
      .limit(2000),
    // Incoming-PO Receiving queue source: purchase orders still being received.
    // Receiving into stock is now done HERE at QC (not on the Incoming page).
    supabase.from("purchase_orders")
      .select("id, pi_number, supplier, status")
      .in("status", ["Ordered", "Partially Received", "Sent", "Deposit Paid"])
      .limit(2000),
    supabase.from("purchase_order_items")
      .select("id, po_id, item_no, description, color, prod_size, qty, received_qty, image_url")
      .limit(20000),
    loadVariantIndex(supabase),
  ]);
  // Litrato ayon sa kulay ng linya (color_variants, 0231); hero kapag walang tugma.
  const imgFor = (name: string | null | undefined, sku: string | null | undefined, color: string | null | undefined, fallback: string | null | undefined) =>
    imageForColor(variantsFor(variantIdx, name, sku), color) ?? fallback ?? null;

  // Numeric-aware ang sort: "Line 2" bago ang "Line 10" (hindi alphabetical),
  // at ang L2-A1 ay bago ang L10-A1 sa cubic list.
  const locations: string[] = (locData ?? []).map((l) => String(l.code ?? "")).filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const zones: string[] = Array.from(new Set((locData ?? []).map((l) => String(l.zone ?? "")).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  // Current on-hand per SKU (lowercased key) for the history's running-total column.
  const stockBySku: Record<string, number> = {};
  for (const r of (invData ?? []) as { sku: string | null; oh_inv: number | null }[]) {
    if (r.sku) stockBySku[r.sku.trim().toLowerCase()] = Number(r.oh_inv ?? 0);
  }

  // Match a workshop item description to a product (first line ≈ product name) so
  // the QC queue can show SKU/category/image even though workshop_job lacks them.
  const prodByName = new Map<string, { sku: string | null; category: string | null; color: string | null; dimension: string | null; image_url: string | null }>();
  for (const p of prodData ?? []) {
    const key = String(p.product_name ?? "").trim().toLowerCase();
    if (key && !prodByName.has(key)) {
      prodByName.set(key, { sku: p.sku ?? null, category: p.category ?? null, color: p.color ?? null, dimension: p.dimension ?? null, image_url: p.image_url ?? null });
    }
  }
  const matchProduct = (itemDesc: string | null) => {
    // matchName strips the "Rework · RMA-x ·" tag so rework receives match too.
    return prodByName.get(matchName(itemDesc).toLowerCase()) ?? null;
  };

  // Carry over the Workshop QC proof photos: pull the qc_declarations for the
  // pending jobs' orders and collect every checklist photo + item image, keyed by
  // order_id so each receiving item shows what the workshop already documented.
  const jobOrderIds = Array.from(new Set((jobData ?? []).map((j) => j.order_id as number | null).filter((x): x is number => x != null)));
  const skipList = (skipRows ?? []) as SkipRow[];
  // Ang pack list ay dalawa na ang pinagmumulan: ang na-skip na linya (stock),
  // at ang na-receive nang workshop→warehouse na job — pareho silang lalabas sa
  // bodega at pareho ang outgoing check. Iisang hugis, iisang pila.
  const packLines: { order_id: number; item_desc: string; qty: number; color: string }[] = [
    ...skipList.map((x) => ({ order_id: x.order_id, item_desc: x.item_desc, qty: 1, color: x.color })),
    ...(((recvJobs ?? []) as { order_id: number | null; item_desc: string | null; qty: number | null }[])
      .filter((j) => j.order_id != null && (j.item_desc ?? "").trim())
      .map((j) => ({ order_id: j.order_id as number, item_desc: j.item_desc as string, qty: Number(j.qty) || 1, color: "" }))),
  ];
  const skipOrderIds = Array.from(new Set(packLines.map((s) => s.order_id)));

  // QC history → Order # resolution: ang warehouse_qc.ref_id ay job_id para sa
  // workshop rows at order_id para sa order rows — i-resolve sa kani-kanilang table.
  const qcRaw = (qcData ?? []) as Record<string, unknown>[];
  const qcJobIds = Array.from(new Set(qcRaw.filter((r) => r.source === "workshop").map((r) => Number(r.ref_id)).filter((n) => Number.isFinite(n) && n > 0)));
  const qcOrderIds = Array.from(new Set(qcRaw.filter((r) => r.source === "order").map((r) => Number(r.ref_id)).filter((n) => Number.isFinite(n) && n > 0)));

  // Both dependent batches key off batch-1 results (jobOrderIds from workshop_job,
  // skipOrderIds from ops_line_skip), so run all three in parallel in one round-trip.
  const [{ data: decls }, { data: packOrders }, { data: prepackDone }, { data: jobOrders }, { data: qcJobRefs }, { data: qcOrderRefs }] = await Promise.all([
    jobOrderIds.length > 0
      ? supabase.from("qc_declarations").select("order_id, item_image, checklist").in("order_id", jobOrderIds)
      : Promise.resolve({ data: [] as { order_id: number | null; item_image: unknown; checklist: unknown }[] }),
    skipOrderIds.length > 0
      ? supabase.from("orders").select("id, order_number, customer_name, date_order, date_of_delivery, full_payment_price, assigned, address").in("id", skipOrderIds)
      : Promise.resolve({ data: [] as { id: number; order_number: string | null; customer_name: string | null }[] }),
    skipOrderIds.length > 0
      ? supabase.from("warehouse_qc").select("ref_id, ref_label, stocked_at, color").eq("checkpoint", "prepack").eq("source", "order").eq("result", "pass").in("ref_id", skipOrderIds)
      : Promise.resolve({ data: [] as { ref_id: number | null; ref_label: string | null; stocked_at: string | null; color?: string | null }[] }),
    // Rush info ng mga order sa QC queue — badge sa taas ng order number.
    jobOrderIds.length > 0
      ? supabase.from("orders").select("id, is_rush, rush_days, date_order").in("id", jobOrderIds)
      : Promise.resolve({ data: [] as { id: number; is_rush: boolean | null; rush_days: number | null; date_order: string | null }[] }),
    qcJobIds.length > 0
      ? supabase.from("workshop_job").select("id, order_number, item_desc").in("id", qcJobIds)
      : Promise.resolve({ data: [] as { id: number; order_number: string | null }[] }),
    qcOrderIds.length > 0
      ? supabase.from("orders").select("id, order_number").in("id", qcOrderIds)
      : Promise.resolve({ data: [] as { id: number; order_number: string | null }[] }),
  ]);
  const orderNoByJob = new Map<number, string | null>();
  // BUONG DESCRIPTION NG JOB (2026-09-06, "bakit ung refund sa QC wala specs"):
  // ang ref_label ng Workshop (IN) record ay unang linya lang ("Rework ·
  // RMA-000001 · Biscocho Bar Stool"); ang spec bullets at Fabric ay nasa
  // workshop_job.item_desc — doon kunin ang Specs, kulay at litrato.
  const jobDescById = new Map<number, string>();
  for (const j of (qcJobRefs ?? []) as { id: number; order_number: string | null; item_desc?: string | null }[]) {
    orderNoByJob.set(j.id, j.order_number);
    if (j.item_desc) jobDescById.set(j.id, String(j.item_desc));
  }
  // Ang description na may bullets: ref_label kung meron, kung hindi ang job.
  const fullDescOf = (r: { source?: string | null; ref_id?: number | null; ref_label?: string | null }): string => {
    const own = String(r.ref_label ?? "");
    if (own.includes("\n")) return own;
    return (r.source === "workshop" && r.ref_id != null ? jobDescById.get(Number(r.ref_id)) : undefined) ?? own;
  };
  const orderNoById = new Map<number, string | null>();
  const orderIdByNo = new Map<string, number>();
  for (const o of (qcOrderRefs ?? []) as { id: number; order_number: string | null }[]) {
    orderNoById.set(o.id, o.order_number);
    if (o.order_number) orderIdByNo.set(o.order_number.trim().toUpperCase(), o.id);
  }
  const rushByOrder = new Map<number, { is_rush: boolean; rush_days: number | null; date_order: string | null }>();
  for (const o of (jobOrders ?? []) as { id: number; is_rush?: boolean | null; rush_days?: number | null; date_order?: string | null }[]) {
    rushByOrder.set(o.id, { is_rush: !!o.is_rush, rush_days: o.rush_days ?? null, date_order: o.date_order ?? null });
  }

  const wsPhotosByOrder = new Map<number, string[]>();
  // NAKA-GRUPO per checklist item (Main item / Carpentry · base / add-ons…) —
  // ganito rin ang ayos sa QC declaration review, para hindi nakakalito.
  const wsGroupsByOrder = new Map<number, { name: string; photos: string[] }[]>();
  {
    for (const d of decls ?? []) {
      const oid = d.order_id as number | null;
      if (oid == null) continue;
      const photos = wsPhotosByOrder.get(oid) ?? [];
      const groups = wsGroupsByOrder.get(oid) ?? [];
      if (typeof d.item_image === "string" && d.item_image) photos.push(d.item_image);
      const checklist = Array.isArray(d.checklist) ? (d.checklist as { name?: unknown; photos?: unknown }[]) : [];
      for (const c of checklist) {
        const ph: string[] = [];
        if (Array.isArray(c.photos)) for (const p of c.photos) if (typeof p === "string" && p) { photos.push(p); ph.push(p); }
        if (ph.length) groups.push({ name: typeof c.name === "string" && c.name ? c.name : "Item", photos: ph });
      }
      wsPhotosByOrder.set(oid, photos);
      wsGroupsByOrder.set(oid, groups);
    }
  }

  const catalog: QcCatalogItem[] = (prodData ?? [])
    .filter((p) => p.sku)
    .map((p) => ({
      sku: String(p.sku),
      product_name: p.product_name ?? null,
      category: p.category ?? null,
      color: p.color ?? null,
      dimension: p.dimension ?? null,
      specs: (p as { specs?: string | null }).specs ?? null,
      image_url: p.image_url ?? null,
      cost: Number(p.cost ?? 0),
      location: (p.location as string | null) ?? null,                       // Rak #
      warehouse_location: (p.warehouse_location as string | null) ?? null,   // Zone #
    }));

  // Ang parseDescSpecs ay HULA ayon sa puwesto; sa bagong specs ang nahuhuli ay
  // spec line ("Foam Type: …") o pamagat ng build ("Custom Bed — With Add-ons").
  // Tanggihan ang may ":" o may em dash — ang catalog ang totoo.
  const cleanSpec = (v?: string | null) => {
    const t = (v ?? "").trim();
    return t && !t.includes(":") && !t.includes("—") ? t : null;
  };
  const pendingJobs: QcPendingJob[] = (jobData ?? []).map((j) => {
    const m = matchProduct(j.item_desc as string | null);
    // Customized items miss the catalog match — recover order-specific specs
    // from the dispatched description's "• …" bullets.
    const specs = parseDescSpecs(j.item_desc as string | null);
    return {
      job_id: j.id as number,
      order_id: (j.order_id as number | null) ?? null,
      order_number: (j.order_number as string | null) ?? null,
      item_desc: (j.item_desc as string | null) ?? null,
      sku: m?.sku ?? null,
      // Ang parseDescSpecs ay HULA lang ayon sa puwesto ("unang bullet = kulay,
      // huli = kategorya") — tama sa lumang porma, mali sa bagong "Label: value"
      // na specs (naging "Foam Type: …" ang Category). Kapag may ":" ang nahulaan,
      // balewalain at ang catalog ang gamitin; ang buong build ay nasa
      // SPECIFICATIONS card naman.
      category: cleanSpec(specs.category) ?? m?.category ?? null,
      color: cleanSpec(specs.color) ?? m?.color ?? null,
      dimension: cleanSpec(specs.dimension) ?? m?.dimension ?? null,
      frame: specs.frame,
      image_url: imgFor(matchName(j.item_desc as string | null), m?.sku, cleanSpec(specs.color) ?? m?.color, m?.image_url),
      qty: Number(j.qty ?? 1),
      workshopQcPhotos: j.order_id != null ? Array.from(new Set(wsPhotosByOrder.get(j.order_id as number) ?? [])) : [],
      workshopQcGroups: j.order_id != null ? (wsGroupsByOrder.get(j.order_id as number) ?? []) : [],
      is_rush: j.order_id != null ? (rushByOrder.get(j.order_id as number)?.is_rush ?? false) : false,
      rush_days: j.order_id != null ? (rushByOrder.get(j.order_id as number)?.rush_days ?? null) : null,
      order_date: j.order_id != null ? (rushByOrder.get(j.order_id as number)?.date_order ?? null) : null,
    };
  });

  // Incoming-PO Receiving queue: every PO line still short of its ordered qty, joined
  // to its PO header for the PI number + supplier. item_no is the product SKU, so we
  // enrich category/image from the catalog when the item exists there.
  const poById = new Map<number, { pi_number: string | null; supplier: string | null }>();
  for (const p of (poData ?? []) as { id: number; pi_number: string | null; supplier: string | null }[]) {
    poById.set(p.id, { pi_number: p.pi_number, supplier: p.supplier });
  }
  const prodBySku = new Map<string, { category: string | null; image_url: string | null; color: string | null; dimension: string | null }>();
  for (const p of prodData ?? []) {
    if (p.sku) prodBySku.set(String(p.sku).trim().toLowerCase(), { category: p.category ?? null, image_url: p.image_url ?? null, color: p.color ?? null, dimension: p.dimension ?? null });
  }
  const pendingIncoming: QcPendingIncoming[] = ((poItemData ?? []) as Record<string, unknown>[])
    .filter((it) => poById.has(Number(it.po_id)))
    .map((it) => {
      const ordered = Number(it.qty ?? 0);
      const received = Number(it.received_qty ?? 0);
      const po = poById.get(Number(it.po_id))!;
      const cat = prodBySku.get(String(it.item_no ?? "").trim().toLowerCase());
      return {
        po_id: Number(it.po_id),
        po_item_id: Number(it.id),
        pi_number: po.pi_number,
        supplier: po.supplier,
        item_no: (it.item_no as string | null) ?? null,
        description: (it.description as string | null) ?? null,
        category: cat?.category ?? null,
        color: (it.color as string | null) ?? cat?.color ?? null,
        dimension: (it.prod_size as string | null) ?? cat?.dimension ?? null,
        image_url: (it.image_url as string | null) ?? cat?.image_url ?? null,
        ordered_qty: ordered,
        received_qty: received,
        remaining: Math.max(ordered - received, 0),
      };
    })
    .filter((it) => it.remaining > 0); // only lines still needing receiving

  const history: QcRow[] = (qcData ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as number,
    checkpoint: (r.checkpoint as "receive" | "prepack") ?? "receive",
    source: (r.source as "imported" | "workshop" | "order") ?? "workshop",
    ref_label: (r.ref_label as string | null) ?? null,
    sku: (r.sku as string | null) ?? null,
    product_name: (r.product_name as string | null) ?? null,
    // ANG CATEGORY/COLOR AY MULA SA CATALOG (2026-08-23).
    //
    // Ang warehouse_qc ay may sariling kopya ng category/color, at sa custom
    // na produkto ay ang BUILD ang nakatala roon ("Fabric: Amalia Canary
    // Yellow"), hindi ang tunay na category. Kaya blangko ang dalawang column
    // sa history samantalang ang Inventory ay may malinaw na "Sofa".
    //
    // Ang catalog ang may tunay na sagot, at nakuha na ito rito para sa larawan
    // (prodBySku sa ibaba) — ang parehong hanapan ang gamit dito. Ang nakatala
    // sa QC ang panghuling gamit: para sa produktong wala na sa catalog, iyon
    // na lang ang natitirang alam natin.
    // Kapag plain category/color lang ang tabi (walang naka-label na build
    // line), ang ref_label ang may buong piniling build — ang receipt line ng
    // order ang isinusulat doon ng prepack QC ("PAN Sofa Bed v.05\n• Total
    // Height: …"). Kaya may laman ang Specs column at ang detail modal.
    build_specs: (() => {
      const own = [r.category, r.color, r.dimension]
        .map((v) => String(v ?? "").trim())
        .filter((v) => v.includes(":"));
      if (own.length) return own;
      return fullDescOf(r as { source?: string | null; ref_id?: number | null; ref_label?: string | null }).split("\n").slice(1)
        .map((l) => l.trim().replace(/^[•·-]\s*/, ""))
        .filter((l) => l.includes(":"));
    })(),
    category: catalogFirst(prodBySku, r.sku, r.category, "category"),
    // KULAY NG RECORD MUNA (2026-09-06): ang catalog color ay listahan ng LAHAT
    // ng kulay ng produkto; ang QC record ay iisang kulay.
    color: colorLabelOfDesc(fullDescOf(r as { source?: string | null; ref_id?: number | null; ref_label?: string | null })) || (String(r.color ?? "").trim() || null) || catalogFirst(prodBySku, r.sku, null, "color"),
    dimension: catalogFirst(prodBySku, r.sku, r.dimension, "dimension"),
    qty: Number(r.qty ?? 1),
    good_qty: Number(r.good_qty ?? 0),
    defect_qty: Number(r.defect_qty ?? 0),
    result: (r.result as "pass" | "fail") ?? "pass",
    photos: asPhotos(r.photos),
    remarks: (r.remarks as string | null) ?? null,
    checked_by: (r.checked_by as string | null) ?? null,
    created_at: (r.created_at as string | null) ?? null,
    stocked_at: (r.stocked_at as string | null) ?? null,
    image_url: imgFor(r.product_name as string | null, r.sku as string | null, colorOfDesc(fullDescOf(r as { source?: string | null; ref_id?: number | null; ref_label?: string | null })) || ((r.color as string | null) ?? null), prodBySku.get(String(r.sku ?? "").trim().toLowerCase())?.image_url),
    order_number: r.source === "workshop" ? (orderNoByJob.get(Number(r.ref_id)) ?? null)
      : r.source === "order" ? (orderNoById.get(Number(r.ref_id)) ?? null) : null,
    // ANG ORDER ID, HINDI ANG HILAW NA ref_id (2026-08-29). Kapag "workshop"
    // ang source, ang ref_id ay JOB id — ipasa iyon sa finishQcOutShip at ang
    // maling order ang mababawasan. Iresolba rito, kung saan alam ang mapa.
    ref_id: r.source === "workshop"
      ? (orderIdByNo.get(String(orderNoByJob.get(Number(r.ref_id)) ?? "").trim().toUpperCase()) ?? null)
      : r.source === "order" ? (Number(r.ref_id) || null) : null,
    rma: ((r.ref_label as string | null) ?? "").match(/rma-\d+/i)?.[0]?.toUpperCase() ?? null,
  }));

  // ── Pre-Pack queue: skipped order lines ("No Workshop Needed") awaiting a
  // packing QC check before delivery. A line drops off once it has SHIPPED —
  // a prepack QC record (checkpoint 'prepack', source 'order') that passed AND
  // carries a stocked_at stamp, whose ref_label matches the line's item_desc.
  //
  // ANG PASADO AY HINDI PA NAIPAPADALA (2026-08-29). Ang pagpasa lang ang
  // hinahanap noon, kaya ang talang naiipit sa "scan" — pasado, pero hindi
  // kailanman na-scan, kaya walang stocked_at — ay nabibilang nang napaketehin
  // na. Nawawala ang linya sa pila at wala nang paraang bumalik: hindi
  // nababawasan ang stock, hindi umuusad ang order. Ganito naipit ang v.15 ng
  // ORD-000015 habang naipadala na ang v.14 nito.
  //
  // Ang stock movement, hindi ang inspeksyon, ang nagtatapos sa isang linya.
  // Source rows (ops_line_skip) plus the orders/prepack lookups were already
  // fetched above. ─────────────────────────────────────────────────────────────
  let pendingPacks: QcPendingPack[] = [];
  if (packLines.length > 0) {
    type PackOrder = { id: number; order_number: string | null; customer_name: string | null; date_order: string | null; date_of_delivery: string | null; full_payment_price: number | null; assigned: string | null; address: string | null };
    const orderById = new Map<number, PackOrder>();
    for (const o of (packOrders ?? []) as PackOrder[]) orderById.set(o.id, o);
    // A skipped line is "packed" once a passing prepack QC that ACTUALLY SHIPPED
    // exists for its (order_id, item_desc). ref_label carries the item
    // description; stocked_at is what says the stock really moved.
    const packedKey = new Set<string>();
    // KADA KULAY (0234): ang skip na may kulay ay tumutugma lang sa QC record
    // ng parehong kulay; ang legacy (walang kulay) ay sa description lang.
    for (const p of (prepackDone ?? []) as { ref_id: number | null; ref_label: string | null; stocked_at?: string | null; color?: string | null }[]) {
      if (p.ref_id == null || !p.stocked_at) continue;
      const d = String(p.ref_label ?? "").trim().toLowerCase();
      packedKey.add(`${p.ref_id}|${d}`);
      packedKey.add(`${p.ref_id}|${d}|${String(p.color ?? "").trim().toLowerCase()}`);
    }
    pendingPacks = packLines
      .filter((s) => !isShippingDesc(s.item_desc)) // Shipping Fee = hindi papaketehin
      .filter((s) => { const d = String(s.item_desc ?? "").trim().toLowerCase(); return s.color ? !packedKey.has(`${s.order_id}|${d}|${s.color.toLowerCase()}`) : !packedKey.has(`${s.order_id}|${d}`); })
      // ANG MULTO AY HINDI PINAPAKETE (2026-08-31). Ang buradong order (test
      // cleanup sa SQL) ay nag-iiwan ng workshop_job/skip lines na nakaturo sa
      // patay na order_id — ang linya ay lumilitaw pa rin sa pack list, ang
      // scan ay bumabagsak sa "Order not found.", at walang paraang matapos
      // ito kailanman. Kung wala sa orders, wala sa pila.
      .filter((s) => orderById.has(s.order_id))
      .map((s) => {
        const m = matchProduct(s.item_desc);
        const o = orderById.get(s.order_id);
        return {
          order_id: s.order_id,
          order_number: o?.order_number ?? null,
          customer_name: o?.customer_name ?? null,
          item_desc: s.item_desc,
          sku: m?.sku ?? null,
          category: m?.category ?? null,
          // Kulay ng LINYA (skip row) lang — ang catalog color ng produkto ay
          // listahan ng LAHAT ng kulay nito, nakalilito sa pila.
          color: s.color || null,
          dimension: m?.dimension ?? null,
          image_url: imgFor(matchName(s.item_desc), m?.sku, s.color, m?.image_url),
          qty: s.qty,
          date_order: o?.date_order ?? null,
          date_of_delivery: o?.date_of_delivery ?? null,
          order_total: o?.full_payment_price != null ? Number(o.full_payment_price) : null,
          sales_rep: o?.assigned ?? null,
          address: o?.address ?? null,
        };
      });
  }

  // DESIGN DETAILS SA BAWAT INSPEKSYON (2026-08-31): lahat ng sheet ng mga
  // order/SKU na nasa alinmang pila — QC (IN), Workshop (IN), Incoming (IN),
  // QC (OUT) — para makumpara ng inspector ang hawak niya sa aprubadong plano.
  // Best-effort at may sariling try/catch: kapag wala pa ang design_details
  // (bago ang 0161) o nabigo ang query, walang card — hindi sirang pahina.
  const designByKey: QcData["designByKey"] = {};
  try {
    const orderNos = [...new Set([
      ...pendingJobs.map((j) => (j.order_number ?? "").trim()),
      ...pendingPacks.map((p) => (p.order_number ?? "").trim()),
    ].filter(Boolean))];
    const skus = [...new Set([
      ...pendingJobs.map((j) => (j.sku ?? "").trim().toUpperCase()),
      ...pendingPacks.map((p) => (p.sku ?? "").trim().toUpperCase()),
      ...pendingIncoming.map((i) => (i.item_no ?? "").trim().toUpperCase()),
    ].filter(Boolean))];
    if (orderNos.length || skus.length) {
      const DD_COLS = "id, order_number, sku, dd_number, title, image_url, status, replied_at, created_by";
      const [{ data: byOrder }, { data: bySku }] = await Promise.all([
        orderNos.length
          ? supabase.from("design_details").select(DD_COLS).in("order_number", orderNos).order("id", { ascending: false }).limit(1000)
          : Promise.resolve({ data: [] as unknown[] }),
        skus.length
          ? supabase.from("design_details").select(DD_COLS).in("sku", skus).order("id", { ascending: false }).limit(1000)
          : Promise.resolve({ data: [] as unknown[] }),
      ]);
      const seen = new Set<number>();
      for (const d of [...(byOrder ?? []), ...(bySku ?? [])] as { id: number; order_number: string | null; sku: string | null; dd_number: string | null; title: string | null; image_url: string | null; status: string | null; replied_at: string | null; created_by: string | null }[]) {
        if (seen.has(d.id) || !d.image_url) continue;
        seen.add(d.id);
        const sheet: QcDesignSheet = {
          ddNumber: d.dd_number,
          title: d.title ?? null,
          sku: (d.sku ?? "").trim() || null,
          imageUrl: d.image_url,
          status: d.status ?? "Draft",
          approvedAt: d.replied_at ? String(d.replied_at).slice(0, 10) : null,
          createdBy: d.created_by,
        };
        const ok = (d.order_number ?? "").trim();
        const sk = (d.sku ?? "").trim().toUpperCase();
        if (ok) (designByKey[ok] ??= []).push(sheet);
        if (sk) (designByKey[sk] ??= []).push(sheet);
      }
    }
  } catch { /* walang DD card */ }

  // Today (PH) window for the KPIs.
  const startToday = (() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return new Date(`${parts}T00:00:00+08:00`).getTime();
  })();
  const isToday = (iso: string | null) => !!iso && new Date(iso).getTime() >= startToday;
  const passedToday = history.filter((r) => r.result === "pass" && isToday(r.created_at)).length;
  const failedToday = history.filter((r) => r.result === "fail" && isToday(r.created_at)).length;
  const totalToday = passedToday + failedToday;

  return {
    catalog,
    pendingJobs,
    pendingIncoming,
    pendingPacks,
    history,
    stockBySku,
    designByKey,
    locations,
    zones,
    kpi: {
      pending: pendingJobs.length,
      passedToday,
      failedToday,
      defectRate: totalToday > 0 ? Math.round((failedToday / totalToday) * 1000) / 10 : 0,
    },
  };
}
