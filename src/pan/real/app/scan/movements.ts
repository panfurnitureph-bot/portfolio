import { createServerSupabase } from "@/lib/supabase/server";

export type Movement = {
  id: number;
  product_name: string | null;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  direction: "in" | "out";
  qty: number;
  qty_before: number | null;
  qty_after: number | null;
  users: string | null;
  // Katumbas na order / RMA / PI ng galaw — magkahiwalay na columns sa ledger:
  // ref = ORD-xxxxxx (o PI ng incoming PO), rma = RMA-xxxxxx kung rework/return.
  ref: string | null;
  rma: string | null;
  created_at: string;
  // Ang build ng customer, hiwalay sa category/color (2026-08-23) — ang
  // dalawang iyon ay galing na sa catalog. Tingnan ang attachImages.
  build_specs?: string[];
  // Ang specs ng catalog (product.specs) — ito ang buong guided spec ng
  // produkto, gamit ng detail modal ng ledger. Tingnan ang attachImages.
  specs?: string | null;
  image_url?: string | null;
  // QC detail (only present on warehouse_qc-derived rows) — powers the ledger's
  // click-through detail modal that mirrors the Quality Control record view.
  qc?: {
    checkpoint: "receive" | "prepack";
    good_qty: number;
    defect_qty: number;
    inspector: string | null;
    remarks: string | null;
    photos: string[];
    source: string | null;
  };
};

// Unified ledger (both directions) + in/out KPIs.
export type LedgerMonitor = {
  rows: Movement[];
  inToday: number;
  outToday: number;
  netToday: number;
  unitsWeek: number;
  last: Movement | null;
};

export async function loadLedger(limit = 200): Promise<LedgerMonitor> {
  const supabase = createServerSupabase();

  // The ledger is a UNION of two truth sources so every stock movement shows up:
  //   • received_parts — manual Scan In/Out, incoming receiving, returns, adjustments,
  //     and delivery dispatch (orders that ship at Delivery Start, skipping QC-OUT).
  //   • warehouse_qc   — QC-driven movements: a RECEIVE pass that has been stocked in
  //     (stocked_at set) is an IN of good_qty; a PREPACK pass that has shipped
  //     (stocked_at set) is an OUT of good_qty. These live in warehouse_qc (not
  //     received_parts), so we derive them here to avoid a parallel double-write.
  const [{ data: rp }, { data: qc }] = await Promise.all([
    supabase.from("received_parts").select("*").order("created_at", { ascending: false }).limit(limit),
    supabase
      .from("warehouse_qc")
      .select("id, checkpoint, source, ref_id, ref_label, sku, product_name, category, color, dimension, qty, good_qty, defect_qty, result, remarks, photos, checked_by, stocked_at, created_at")
      .eq("result", "pass")
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  // ORDER # resolver ng QC rows: workshop receive → workshop_job.order_number;
  // prepack/order → orders.order_number; incoming PO → ref_label (PI #).
  const qcRaw = ((qc ?? []) as Record<string, unknown>[]).filter((r) => String(r.checkpoint) !== "receive" || r.stocked_at != null);
  const wsIds = [...new Set(qcRaw.filter((r) => String(r.source) === "workshop" && r.ref_id != null).map((r) => Number(r.ref_id)))];
  const ordIds = [...new Set(qcRaw.filter((r) => String(r.source) === "order" && r.ref_id != null).map((r) => Number(r.ref_id)))];
  const [{ data: wjRows }, { data: ordRows }, { data: rmaRows }] = await Promise.all([
    wsIds.length ? supabase.from("workshop_job").select("id, order_number").in("id", wsIds) : Promise.resolve({ data: [] as { id: number; order_number: string | null }[] }),
    ordIds.length ? supabase.from("orders").select("id, order_number, receipt_items").in("id", ordIds) : Promise.resolve({ data: [] as { id: number; order_number: string | null; receipt_items?: unknown }[] }),
    // Rework job → RMA number (returns.rework_job_id) — para may sariling RMA # column.
    wsIds.length ? supabase.from("returns").select("rework_job_id, return_no").in("rework_job_id", wsIds) : Promise.resolve({ data: [] as { rework_job_id: number | null; return_no: string | null }[] }),
  ]);
  const ordByJob = new Map<number, string | null>();
  for (const j of (wjRows ?? []) as { id: number; order_number: string | null }[]) ordByJob.set(j.id, j.order_number);
  const ordById = new Map<number, string | null>();
  for (const o of (ordRows ?? []) as { id: number; order_number: string | null }[]) ordById.set(o.id, o.order_number);
  const rmaByJob = new Map<number, string | null>();
  for (const r of (rmaRows ?? []) as { rework_job_id: number | null; return_no: string | null }[]) if (r.rework_job_id != null) rmaByJob.set(Number(r.rework_job_id), r.return_no);
  const refOf = (r: Record<string, unknown>): { ref: string | null; rma: string | null } => {
    const src = String(r.source ?? "");
    const rid = r.ref_id != null ? Number(r.ref_id) : null;
    if (src === "workshop" && rid != null) return { ref: ordByJob.get(rid) ?? null, rma: rmaByJob.get(rid) ?? null };
    if (src === "order" && rid != null) return { ref: ordById.get(rid) ?? null, rma: null };
    return { ref: (r.ref_label as string | null) ?? null, rma: null };
  };

  // SPECS ng QC rows (2026-08-27): ang warehouse_qc ay plain category/color lang
  // ang tabi — walang naka-label na build lines — kaya "—" ang Specs ng bawat
  // QC dispatch/receive sa ledger, samantalang ang dispatch writer (System rows)
  // ay may buong build. Ang PINILING build ay nasa receipt line ng order, doon
  // hugutin: susi ang SKU, panghalili ang unang linya ng product name.
  const specLinesOf = (desc: unknown): string[] =>
    String(desc ?? "").split("\n").slice(1)
      .map((l) => l.trim().replace(/^[•·-]\s*/, ""))
      .filter((l) => l.includes(":"));
  const specByOrder = new Map<string, Map<string, string[]>>();
  const indexOrderSpecs = (orderNumber: string | null, items: unknown) => {
    if (!orderNumber || !Array.isArray(items) || specByOrder.has(orderNumber)) return;
    const m = new Map<string, string[]>();
    for (const it of items as { sku?: string | null; description?: string | null }[]) {
      const lines = specLinesOf(it?.description);
      if (!lines.length) continue;
      const sk = String(it?.sku ?? "").trim().toLowerCase();
      const nm = String(it?.description ?? "").split("\n")[0].trim().toLowerCase();
      if (sk && !m.has(`s:${sk}`)) m.set(`s:${sk}`, lines);
      if (nm && !m.has(`n:${nm}`)) m.set(`n:${nm}`, lines);
    }
    if (m.size) specByOrder.set(orderNumber, m);
  };
  for (const o of (ordRows ?? []) as { order_number: string | null; receipt_items?: unknown }[]) indexOrderSpecs(o.order_number, o.receipt_items);
  // Workshop QC rows: order_number lang ang hawak — kunin ang receipt ng mga
  // order na hindi pa nakuha sa itaas.
  const wsOrderNums = [...new Set([...ordByJob.values()].filter((n): n is string => !!n && !specByOrder.has(n)))];
  if (wsOrderNums.length) {
    const { data: wsOrders } = await supabase.from("orders").select("order_number, receipt_items").in("order_number", wsOrderNums);
    for (const o of (wsOrders ?? []) as { order_number: string | null; receipt_items?: unknown }[]) indexOrderSpecs(o.order_number, o.receipt_items);
  }
  const orderSpecsFor = (ref: string | null, sku: string | null, name: string | null): string[] => {
    const m = ref ? specByOrder.get(ref) : undefined;
    if (!m) return [];
    return m.get(`s:${String(sku ?? "").trim().toLowerCase()}`)
      ?? m.get(`n:${String(name ?? "").split("\n")[0].trim().toLowerCase()}`)
      ?? [];
  };

  // Derive a movement per PASS QC record:
  //   • RECEIVE (IN)  — counts only once physically stocked in (stocked_at set); a pass
  //     that hasn't been scanned back for stock-in hasn't moved stock yet.
  //   • PREPACK (OUT) — the QC-OUT pass IS the dispatch, so it counts as an OUT whether
  //     or not stocked_at was stamped (older direct-stock passes may have shipped before
  //     stocked_at was recorded).
  const qcRows: Movement[] = qcRaw
    .map((r) => {
      const isIn = String(r.checkpoint) === "receive";
      const qty = Number(r.good_qty) || 0;
      const photos = Array.isArray(r.photos) ? (r.photos as unknown[]).filter((p): p is string => typeof p === "string") : [];
      const refs = refOf(r);
      const ownSpecs = [r.category, r.color, r.dimension]
        .map((v) => String(v ?? "").trim())
        .filter((v) => v.includes(":"));
      // Panghuling fallback ang ref_label — ang receipt line ng order ang
      // isinusulat doon ng QC ("PAN Sofa Bed v.05\n• Total Height: …").
      const fromOrder = ownSpecs.length ? ownSpecs : orderSpecsFor(refs.ref, r.sku as string | null, r.product_name as string | null);
      return {
        id: 1_000_000_000 + (Number(r.id) || 0), // offset id space so it can't collide with received_parts ids
        product_name: (r.product_name as string | null) ?? null,
        sku: (r.sku as string | null) ?? null,
        build_specs: fromOrder.length ? fromOrder : specLinesOf(r.ref_label),
        category: (r.category as string | null) ?? null,
        color: (r.color as string | null) ?? null,
        dimension: (r.dimension as string | null) ?? null,
        direction: isIn ? "in" : "out",
        qty,
        qty_before: null,
        qty_after: null,
        users: `${isIn ? "QC receive" : "QC dispatch"}${r.checked_by ? ` · ${r.checked_by as string}` : ""}`,
        ...refs,
        created_at: String(r.stocked_at ?? r.created_at ?? ""),
        qc: {
          checkpoint: (isIn ? "receive" : "prepack") as "receive" | "prepack",
          good_qty: Number(r.good_qty) || 0,
          defect_qty: Number(r.defect_qty) || 0,
          inspector: (r.checked_by as string | null) ?? null,
          remarks: (r.remarks as string | null) ?? null,
          photos,
          source: (r.source as string | null) ?? null,
        },
      };
    });

  // received_parts rows: hilahin ang ORD- at RMA- tokens mula sa users string
  // (isinusulat ng dispatch/restock writers) sa kani-kanilang column.
  const rpRows = ((rp ?? []) as Movement[]).map((r) => ({
    ...r,
    // Katulad ng QC: kapag ang tatlong hanay ay may naka-label na linya, iyon
    // ang build na naitala ng galaw — hindi ang category/color ng katalogo.
    // Ilipat sa build_specs bago patungan ng katalogo sa attachImages().
    // Ang pangatlong hanay ay maaaring may siniksik na labis (tingnan ang
    // orderedSpecLines) — hatiin pabalik para isang linya kada spec.
    build_specs: [r.category, r.color, r.dimension]
      .map((v) => String(v ?? "").trim())
      .filter((v) => v.includes(":"))
      .flatMap((v) => v.split("\n")),
    ref: r.ref ?? ((r.users ?? "").match(/\b(ORD-\d+)\b/i)?.[1]?.toUpperCase() ?? null),
    rma: r.rma ?? ((r.users ?? "").match(/\b(RMA-\d+)\b/i)?.[1]?.toUpperCase() ?? null),
  }));
  const rows = [...rpRows, ...qcRows]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);

  // Backfill Qty Before / After for rows that don't carry them (QC-derived rows have
  // none). Walk newest→oldest per SKU from the CURRENT on-hand: the newest row's
  // `after` = current stock; `before` = after − delta (delta = +qty IN / −qty OUT);
  // the next older row of that SKU then ends at this row's `before`. Rows that already
  // have before/after (manual scans via received_parts) are left untouched but still
  // advance the running total so older rows line up.
  const { data: inv } = await supabase.from("inventory").select("sku, oh_inv").limit(10000);
  const running = new Map<string, number>();
  for (const r of (inv ?? []) as { sku: string | null; oh_inv: number | null }[]) {
    const k = (r.sku ?? "").trim().toLowerCase();
    if (k) running.set(k, (running.get(k) ?? 0) + (Number(r.oh_inv) || 0));
  }
  for (const r of rows) {
    const k = (r.sku ?? "").trim().toLowerCase();
    if (!k) continue;
    const after = running.has(k) ? running.get(k)! : 0;
    const delta = r.direction === "in" ? Number(r.qty) || 0 : -(Number(r.qty) || 0);
    const before = after - delta;
    if (r.qty_before == null) r.qty_before = before;
    if (r.qty_after == null) r.qty_after = after;
    running.set(k, before); // older same-SKU row ends where this one began
  }

  await attachImages(supabase, rows);

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startWeek = startToday - 6 * 86_400_000;

  let inToday = 0, outToday = 0, unitsWeek = 0;
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    const q = Number(r.qty) || 0;
    if (t >= startToday) { if (r.direction === "in") inToday += q; else outToday += q; }
    if (t >= startWeek) unitsWeek += q;
  }
  return { rows, inToday, outToday, netToday: inToday - outToday, unitsWeek, last: rows[0] ?? null };
}

// Attach product thumbnails AND the catalog category/color/dimension.
//
// Ang warehouse_qc ay may sariling kopya ng category/color, at sa custom na
// produkto ay ang BUILD ang nakatala roon ("Fabric: Amalia Canary Yellow"),
// hindi ang tunay na category — kaya blangko ang dalawang column sa ledger
// samantalang ang Inventory ay may malinaw na "Sofa".
//
// Ang catalog ang may tunay na sagot. Ang nakatala sa galaw ang panghuling
// gamit: para sa produktong wala na sa catalog, iyon na lang ang alam natin.
type CatalogInfo = { image: string | null; category: string | null; color: string | null; dimension: string | null; specs: string | null };
async function attachImages(supabase: ReturnType<typeof createServerSupabase>, rows: Movement[]) {
  const { data: prods } = await supabase.from("product").select("sku, product_name, image_url, category, color, dimension, specs");
  const bySku = new Map<string, CatalogInfo>();
  const byName = new Map<string, CatalogInfo>();
  for (const p of prods ?? []) {
    const info: CatalogInfo = {
      image: p.image_url ?? null,
      category: p.category ?? null,
      color: p.color ?? null,
      dimension: p.dimension ?? null,
      specs: (p as { specs?: string | null }).specs ?? null,
    };
    if (p.sku) bySku.set(String(p.sku).toLowerCase(), info);
    byName.set(String(p.product_name ?? "").toLowerCase(), info);
  }
  for (const r of rows) {
    const hit =
      (r.sku ? bySku.get(r.sku.toLowerCase()) : undefined) ??
      byName.get((r.product_name ?? "").split("\n")[0].toLowerCase());
    r.image_url = hit?.image ?? null;
    if (hit) {
      r.category = hit.category ?? r.category;
      r.color = hit.color ?? r.color;
      r.dimension = hit.dimension ?? r.dimension;
      r.specs = hit.specs ?? null;
    }
  }
}

