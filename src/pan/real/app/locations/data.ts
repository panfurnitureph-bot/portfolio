import { fetchAll } from "@/lib/fetch-all";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadSkipRows } from "@/lib/ops/skips";
import { lineKey, keySet, hasKey, lineName, colorOfDesc, normColor } from "@/lib/orders/line-key";
import { loadVariantIndex, variantsFor, imageForColor } from "@/lib/ops/product-variants";

export type LocOrderRef = {
  orderNumber: string;
  customer: string | null;
  deliveryDate: string | null;
  qty: number;
  // Ang piniling build ng order — ang buong receipt description (pangalan +
  // spec bullets); ito ang laman ng Product Details pop-up.
  itemDesc: string | null;
  // Ang design sheet ng PRODUKTONG ito sa ORDER na ito (order|sku ang susi,
  // gaya ng Sales Orders) — null kapag walang sheet.
  designUrl: string | null;
  design: { url: string; ddNumber: string | null; status: string | null; preparedBy: string | null } | null;
};

export type LocProduct = {
  id: number;
  // KADA KULAY (0235, 2026-09-06): "sku|kulay" — ang tatlong leather ng iisang
  // SKU ay tatlong hilera sa mapa, tig-kanyang litrato, bilang at puwesto.
  // Ito ang React key at ang pagkakakilanlan ng hilera, hindi ang product id.
  key: string;
  product_name: string;
  sku: string | null;
  image_url: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  onHand: number;
  // Ang guided specs ng katalogo — pambalik ng Product Details kapag walang
  // order build (stock na walang nakalaan).
  specs?: string | null;
  // Hatian ng on-hand sa lokasyong ito: ilan ang nakalaan sa orders (reserved)
  // at ilan ang malayang magagamit (available) — mula sa inventory row mismo.
  reserved?: number;
  available?: number;
  // Mga ORDER na nakalaan sa stock na ito (confirmed/naka-reserve, hindi pa
  // nade-deliver) — ipinapakita sa cubic modal: Order # · Customer · Delivery.
  orders?: LocOrderRef[];
  // Pinakahuling PASSED na Receiving QC ng SKU — para sa Reprint QR sa cubic
  // modal (parehong label ng QC IN, kapag nasira ang nakadikit).
  qc?: { id: number; inspector: string | null; date: string | null } | null;
};

export type LocCard = {
  id: number;
  code: string;
  zone: string | null;
  capacity: number | null;
  status: string;
  products: LocProduct[];
  units: number;
  skuCount: number;
  utilization: number | null; // 0..1 when capacity is set
};

export type LocationsData = {
  locations: LocCard[];
  unassigned: LocProduct[];
  allProducts: LocProduct[];
  kpi: { total: number; occupied: number; empty: number; util: number | null };
};

export async function loadLocations(): Promise<LocationsData> {
  const supabase = createServerSupabase();
  const [locs, { data: prods }, { data: inv }, { data: rsvOrders }, { data: qcRows }, { data: ddRows }] = await Promise.all([
    // 1,200 na ang cubics (40 lines) — lampas sa 1000-row na kisame ng
    // Supabase, kaya pahina-pahina (tingnan ang lib/fetch-all).
    fetchAll<{ id: number; code: string; zone: string | null; capacity: number | null; status: string | null }>((f, t) =>
      supabase.from("warehouse_locations").select("id, code, zone, capacity, status").order("code").range(f, t)),
    supabase.from("product").select("id, product_name, sku, image_url, category, color, dimension, warehouse_location, specs").limit(10000),
    // Include the inventory's own Rak # (location) so occupancy is driven by where stock
    // ACTUALLY sits, not by the product's zone field.
    supabase.from("inventory").select("sku, product_name, color, oh_inv, reserved, available, location, warehouse_location").limit(10000),
    // Mga order na NAKA-RESERVE ng stock — EKSAKTONG pamantayan ng
    // fn_inventory_resync_reserved (0124): hindi pa SHIPPED, hindi
    // cancel/pending/draft, at abot na ang 30% downpayment. Ang dating
    // inventory_deducted na filter ay masyadong maluwag — pati lumang tapos
    // nang order ay lumalabas (naiulat 2026-08-10: 9 order sa 2 units).
    supabase.from("orders")
      .select("id, order_number, customer_name, date_of_delivery, status, receipt_items, downpayment_price, full_payment, full_payment_price, lines_shipped")
      .or("inventory_shipped.is.null,inventory_shipped.eq.false")
      .not("status", "ilike", "cancel%").not("status", "ilike", "pending%").not("status", "ilike", "draft%")
      .order("id", { ascending: false }).limit(2000),
    // Pinakahuling PASSED Receiving QC kada SKU — pang-Reprint QR.
    supabase.from("warehouse_qc").select("id, sku, checked_by, created_at")
      .eq("checkpoint", "receive").eq("result", "pass").not("sku", "is", null)
      .order("id", { ascending: false }).limit(5000),
    // Design sheets — ipinapakita sa cubic modal katabi ng Order #.
    supabase.from("design_details").select("order_number, sku, image_url, dd_number, status, created_by").not("order_number", "is", null).order("id", { ascending: false }).limit(2000),
  ] as const);

  // sku (lowercase) → pinakahuling passed Receiving QC (desc na ang id — unang
  // tama ang panalo).
  const qcBySku = new Map<string, { id: number; inspector: string | null; date: string | null }>();
  for (const q of (qcRows ?? []) as { id: number; sku: string | null; checked_by: string | null; created_at: string | null }[]) {
    const k = (q.sku ?? "").trim().toLowerCase();
    if (!k || qcBySku.has(k)) continue;
    qcBySku.set(k, { id: q.id, inspector: q.checked_by ?? null, date: q.created_at ? q.created_at.slice(0, 10) : null });
  }

  // ORDER|SKU → design sheet (unang tugma ang panalo; ang walang-sku na
  // lumang sheet ay sa buong order nakalakip).
  type DdInfo = { url: string; ddNumber: string | null; status: string | null; preparedBy: string | null };
  const ddByKey = new Map<string, DdInfo>();
  for (const dd of (ddRows ?? []) as { order_number: string | null; sku: string | null; image_url: string | null; dd_number: string | null; status: string | null; created_by: string | null }[]) {
    const ord = (dd.order_number ?? "").trim();
    if (!ord || !dd.image_url) continue;
    const key = dd.sku?.trim() ? `${ord}|${dd.sku.trim().toUpperCase()}` : ord;
    if (!ddByKey.has(key)) ddByKey.set(key, { url: dd.image_url, ddNumber: dd.dd_number ?? null, status: dd.status ?? null, preparedBy: dd.created_by ?? null });
  }

  // sku (lowercase) → mga order na nakalaan dito.
  const ordersBySku = new Map<string, LocOrderRef[]>();
  for (const o of (rsvOrders ?? []) as { id: number; order_number: string | null; customer_name: string | null; date_of_delivery: string | null; receipt_items: { sku?: string | null; qty?: number }[] | null; downpayment_price: number | null; full_payment: number | null; full_payment_price: number | null }[]) {
    // ANG BAYAD ANG GATE (0210, itinama 2026-08-31): anumang bayad ay
    // naglalaan — naiwan itong nasa 30% nang baguhin ang batas, kaya hindi na
    // "pareho ng resync SQL" gaya ng dating sabi ng komentong ito.
    const price = Number(o.full_payment_price) || 0;
    const paid = (Number(o.downpayment_price) || 0) + (Number(o.full_payment) || 0);
    if (price > 0 && paid <= 0.005) continue;
    // UMALIS NA ANG LINYA = WALA NA SA ISTANTE (2026-09-03, "naka out na sa qc
    // bakit nandun padin sa warehouse location"): ang linyang nasa
    // lines_shipped (0225 — nabawas na sa QC OUT o Start Delivery) ay hindi na
    // nakalaan dito at hindi na Upcoming; ang mga hindi pa umaalis na linya ng
    // parehong order (susunod na batch) ang nananatili.
    // KASAMA ANG KULAY (2026-09-06, lib/orders/line-key): "pangalan @ kulay".
    const ls = keySet((o as { lines_shipped?: unknown }).lines_shipped);
    for (const it of o.receipt_items ?? []) {
      const k = (it.sku ?? "").trim().toLowerCase();
      if (!k) continue;
      if (hasKey(ls, lineKey((it as { description?: string | null }).description, (it as { color?: string | null }).color))) continue;
      const list = ordersBySku.get(k) ?? [];
      const dd = ddByKey.get(`${(o.order_number ?? "").trim()}|${(it.sku ?? "").trim().toUpperCase()}`)
        ?? ddByKey.get((o.order_number ?? "").trim()) ?? null;
      list.push({
        orderNumber: o.order_number ?? `#${o.id}`,
        customer: o.customer_name ?? null,
        deliveryDate: o.date_of_delivery ?? null,
        qty: Number(it.qty) || 1,
        itemDesc: (it as { description?: string | null }).description ?? null,
        designUrl: dd?.url ?? null,
        design: dd,
      });
      ordersBySku.set(k, list);
    }
  }

  // ANG NASA PACK QUEUE AY PAALIS PA RIN (2026-09-01, "may for qc out pa ako
  // pero wala na dito sa warehouse"): sa UNANG QC-OUT scan ng isang order, ang
  // buong order ay nabawas na sa stock at inventory_shipped na — kaya ang
  // natitirang Orders-to-Pack na linya ay nawawala sa mapa kahit nasa istante
  // pa ang mismong unit. Ang ops_line_skip na hindi pa tapos ay idinadagdag
  // dito bilang Upcoming sa SKU ng linya, para makita ng bodega na may
  // kukunin pa sa cubic na iyon.
  // Bilang din itong NAKALAAN (2026-09-01, "dapat diba may reserved na yan"):
  // ang resync ng inventory.reserved ay hindi na bumibilang kapag
  // inventory_shipped na ang order — pero ang unit ng pending pack line ay
  // nasa istante pa at NAKALAAN sa order na iyon. Dinadagdag sa reserved ng
  // hilera sa mapa.
  const packPendingBySku = new Map<string, number>();
  try {
    const skips = await loadSkipRows(supabase);
    const sIds = [...new Set((skips ?? []).map((s) => s.order_id as number | null).filter((x): x is number => x != null))];
    if (sIds.length) {
      const { data: sOrds } = await supabase.from("orders")
        .select("id, order_number, customer_name, date_of_delivery, receipt_items, status").in("id", sIds);
      const sById = new Map((sOrds ?? []).map((o) => [o.id as number, o]));
      // TAPOS NA = WALA NA RITO (2026-09-03, "na qc out na pero nandito padin
      // ung record"): ang linyang pumasa na sa QC OUT (umalis na sa istante) o
      // naihatid na, at ang order na sarado na, ay hindi na Upcoming at hindi
      // na nakalaan — dating LAHAT ng ops_line_skip ay binibilang
      // magpakailanman.
      const doneLine = new Set<string>();
      const flq = (t: unknown) => lineKey(String(t ?? ""));
      try {
        const { data: passes } = await supabase.from("warehouse_qc")
          .select("ref_id, ref_label").eq("checkpoint", "prepack").eq("source", "order").eq("result", "pass").in("ref_id", sIds).limit(10000);
        for (const p of (passes ?? []) as { ref_id: number | null; ref_label: string | null }[]) {
          if (p.ref_id != null && flq(p.ref_label)) doneLine.add(`${p.ref_id}|${flq(p.ref_label)}`);
        }
      } catch { /* walang prepack QC pa */ }
      try {
        const { data: dl } = await supabase.from("order_line_deliveries").select("order_id, item_desc").in("order_id", sIds).limit(10000);
        for (const r of (dl ?? []) as { order_id: number | null; item_desc: string | null }[]) {
          if (r.order_id != null && flq(r.item_desc)) doneLine.add(`${r.order_id}|${flq(r.item_desc)}`);
        }
      } catch { /* wala pang 0200 */ }
      // pangalan → sku mula sa catalog, pambalik kapag walang sku ang receipt line
      const nameToSku = new Map<string, string>();
      for (const p of prods ?? []) {
        const k = String(p.product_name ?? "").trim().toLowerCase();
        if (k && p.sku && !nameToSku.has(k)) nameToSku.set(k, String(p.sku));
      }
      for (const s of skips) {
        const o = s.order_id != null ? sById.get(s.order_id) : undefined;
        if (!o) continue;
        const oStatus = String((o as { status?: string | null }).status ?? "");
        if (/cancel/i.test(oStatus) || (/deliver/i.test(oStatus) && !/partial/i.test(oStatus))) continue;
        const name = lineName(s.item_desc);
        if (!name) continue;
        const skey = lineKey(s.item_desc, s.color);
        if (hasKey(doneLine, skey, `${s.order_id}|`)) continue; // QC OUT na o naihatid na
        const rlines = ((o.receipt_items as { description?: string | null; sku?: string | null; qty?: number; color?: string | null }[] | null) ?? []);
        const line = rlines.find((it) => lineKey(it.description, it.color) === skey) ?? rlines.find((it) => lineName(it.description) === name);
        const sku = (line?.sku ?? nameToSku.get(name) ?? "").trim();
        if (!sku) continue;
        const k = sku.toLowerCase();
        packPendingBySku.set(k, (packPendingBySku.get(k) ?? 0) + (Number(line?.qty) || 1));
        const list = ordersBySku.get(k) ?? [];
        if (list.some((x) => x.orderNumber === ((o.order_number as string | null) ?? ""))) continue;
        const dd = ddByKey.get(`${((o.order_number as string | null) ?? "").trim()}|${sku.toUpperCase()}`)
          ?? ddByKey.get(((o.order_number as string | null) ?? "").trim()) ?? null;
        list.push({
          orderNumber: (o.order_number as string | null) ?? `#${o.id}`,
          customer: (o.customer_name as string | null) ?? null,
          deliveryDate: (o.date_of_delivery as string | null) ?? null,
          qty: Number(line?.qty) || 1,
          itemDesc: (line?.description as string | null) ?? (s.item_desc as string | null),
          designUrl: dd?.url ?? null,
          design: dd,
        });
        ordersBySku.set(k, list);
      }
    }
  } catch { /* wala pang ops_line_skip — walang idadagdag */ }

  // ANG INAYOS NA NAKABALIK SA BODEGA (2026-08-31, hiling ni Joe). Ang rework
  // redelivery na naka-stock-in ay pag-aari na ng customer — pero ang order ay
  // `inventory_shipped` na (ang UNANG hatid), kaya wala ito sa rsvOrders at ang
  // cubic ay walang maipakitang Order #/Customer sa inayos na unit. Ang
  // pinagmumulan: ang biyaheng naghihintay ng redelivery (deliveries na
  // Scheduled/Packed na may return_id) → ang RMA ang nagsasabi kung aling SKU.
  try {
    // PANG PRE-0219 LANG ANG ATTACH NA ITO (2026-08-31, "bigla naman lumipat
    // ung order # sa same sku"). Kapag may order_id na ang stock_placements,
    // ang MAY-ARI NG PUWESTO ang nagsusuot ng Order # sa tamang cubic — at ang
    // sku-level na attach dito ay DUMADAPO SA MALING BUNTON: nang ma-out ang
    // L12-A1 ng RMA-000011 (placement consumed), ang ORD-000002 ay lumipat sa
    // multo ng parehong SKU sa L1-D2. May 0219 = walang attach dito.
    const probe219 = await supabase.from("stock_placements").select("order_id").limit(1);
    if (!probe219.error) throw new Error("0219 active - owner path handles it");
    const { data: redel } = await supabase
      .from("deliveries")
      .select("order_id, return_id")
      .in("status", ["Scheduled", "Packed"])
      .not("return_id", "is", null)
      .limit(500);
    const retIds = [...new Set((redel ?? []).map((d) => d.return_id as number).filter(Boolean))];
    if (retIds.length) {
      const { data: rets } = await supabase
        .from("returns")
        .select("id, order_id, return_no, sku, item_desc")
        .in("id", retIds);
      const ordIds = [...new Set((rets ?? []).map((r) => r.order_id as number | null).filter((x): x is number => x != null))];
      const { data: ords } = ordIds.length
        ? await supabase.from("orders").select("id, order_number, customer_name, date_of_delivery").in("id", ordIds)
        : { data: [] as { id: number; order_number: string | null; customer_name: string | null; date_of_delivery: string | null }[] };
      const ordById = new Map((ords ?? []).map((o) => [o.id as number, o]));
      for (const r of (rets ?? []) as { id: number; order_id: number | null; return_no: string | null; sku: string | null; item_desc: string | null }[]) {
        const k = (r.sku ?? "").trim().toLowerCase();
        if (!k) continue;
        const o = r.order_id != null ? ordById.get(r.order_id) : undefined;
        const list = ordersBySku.get(k) ?? [];
        // Huwag doblehin kapag nakalista na ang order sa SKU na ito.
        if (o && !list.some((x) => x.orderNumber === (o.order_number ?? ""))) {
          // May design sheet din ang inayos na unit (2026-08-31, "diba may
          // design details to bakit wala dito") — parehong lookup ng rsvOrders.
          const dd = ddByKey.get(`${(o.order_number ?? "").trim()}|${(r.sku ?? "").trim().toUpperCase()}`)
            ?? ddByKey.get((o.order_number ?? "").trim()) ?? null;
          list.push({
            orderNumber: o.order_number ?? `#${r.order_id}`,
            customer: o.customer_name ?? null,
            deliveryDate: o.date_of_delivery ?? null,
            qty: 1,
            itemDesc: r.item_desc ?? null,
            designUrl: dd?.url ?? null,
            design: dd,
          });
          ordersBySku.set(k, list);
        }
      }
    }
  } catch { /* wala pang 0205 (return_id) — walang redelivery na maidadagdag */ }

  // On-hand lookup (by sku, else name).
  const bySku = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const r of inv ?? []) {
    const oh = Number(r.oh_inv ?? 0);
    if (r.sku) bySku.set(String(r.sku).toLowerCase(), oh);
    byName.set(String(r.product_name ?? "").toLowerCase(), oh);
  }
  const onHandOf = (p: { sku: string | null; product_name: string }) =>
    (p.sku ? bySku.get(p.sku.toLowerCase()) : undefined) ?? byName.get(p.product_name.toLowerCase()) ?? 0;

  // Litrato kada kulay (color_variants, 0231) — ang hilera ng leather BE20457
  // ay ang litrato ng BE20457, hindi ang hero ng produkto.
  const variantIdx = await loadVariantIndex(supabase);
  const toLocProduct = (p: NonNullable<typeof prods>[number]): LocProduct => ({
    id: p.id,
    key: `${String(p.sku ?? p.product_name ?? "").toLowerCase()}|`,
    product_name: p.product_name,
    sku: p.sku ?? null,
    image_url: p.image_url ?? null,
    category: p.category ?? null,
    color: p.color ?? null,
    dimension: p.dimension ?? null,
    onHand: onHandOf(p),
    specs: (p as { specs?: string | null }).specs ?? null,
    orders: p.sku ? ordersBySku.get(String(p.sku).toLowerCase()) ?? [] : [],
    qc: p.sku ? qcBySku.get(String(p.sku).toLowerCase()) ?? null : null,
  });

  const allProducts = (prods ?? []).map(toLocProduct);

  // Occupancy is driven by INVENTORY: group inventory rows by their Rak # (location),
  // which matches the warehouse_locations.code. Each row contributes its on-hand units.
  // (Products are looked up by sku/name for the card's product list + images.)
  const prodBySku = new Map<string, LocProduct>();
  const prodByName = new Map<string, LocProduct>();
  for (const p of prods ?? []) {
    const lp = toLocProduct(p);
    if (p.sku) prodBySku.set(String(p.sku).toLowerCase(), lp);
    prodByName.set(String(p.product_name ?? "").toLowerCase(), lp);
  }
  // PER-CUBIC NA PUWESTO (0199): ang SKU na may stock_placements ay HINAHATI sa
  // mga cubic niyon — ang bed na nasa L1-A1 at L3-A1 ay lumilitaw sa dalawa,
  // tig-kanyang dami. Ang walang placements ay nasa lumang single-location.
  const placementsBySku = new Map<string, { code: string; qty: number; orderId: number | null }[]>();
  try {
    // Ang order_id (0219) ay hinihingi nang may pambalik — pero HINDI
    // nagth-throw ang fetchAll sa maling kolum: `if (error) break` at []
    // ang balik, kaya ang try/catch dito noon ay hindi kailanman tumama at
    // ang BUONG placements ay naging walang laman — bumalik ang buong bunton
    // sa inventory.location kahit tama ang naitalang L10-A1 (naranasan
    // 2026-08-31, DINING-000001). Tahasang PROBE ang tamang tseke.
    const probe = await supabase.from("stock_placements").select("order_id").limit(1);
    // KADA KULAY (0235): "sku|kulay" ang susi; '' ang lumang hilera.
    const probeColor = await supabase.from("stock_placements").select("color").limit(1);
    const cols = (probe.error ? "sku, location_code, qty" : "sku, location_code, qty, order_id") + (probeColor.error ? "" : ", color");
    const pls = await fetchAll<{ sku: string; location_code: string; qty: number; order_id?: number | null; color?: string | null }>((f, t) =>
      supabase.from("stock_placements").select(cols).order("id").range(f, t) as never);
    for (const p of pls) {
      const k = String(p.sku ?? "").toLowerCase();
      if (!k) continue;
      const kc = `${k}|${normColor(p.color)}`;
      (placementsBySku.get(kc) ?? placementsBySku.set(kc, []).get(kc)!).push({ code: String(p.location_code ?? "").trim(), qty: Number(p.qty) || 0, orderId: (p.order_id as number | null) ?? null });
      continue;
    }
  } catch { /* wala pang 0199 — single-location ang lahat */ }

  // ANG MAY-ARI NG PUWESTO (0219): ang placement na may order_id ang tanging
  // hilerang magsusuot ng Order # na iyon — kunin ang detalye ng mga may-ari,
  // at alisin sila sa sku-level na listahan para hindi sila lumitaw sa lumang
  // bunton sa ibang cubic.
  const ownerIds = [...new Set([...placementsBySku.values()].flat().map((p) => p.orderId).filter((x): x is number => !!x))];
  const ownerRefById = new Map<number, LocOrderRef>();
  if (ownerIds.length) {
    const { data: ownerRows } = await supabase
      .from("orders").select("id, order_number, customer_name, date_of_delivery").in("id", ownerIds);
    for (const o of (ownerRows ?? []) as { id: number; order_number: string | null; customer_name: string | null; date_of_delivery: string | null }[]) {
      ownerRefById.set(o.id, {
        orderNumber: o.order_number ?? `#${o.id}`,
        customer: o.customer_name ?? null,
        deliveryDate: o.date_of_delivery ?? null,
        qty: 1, itemDesc: null, designUrl: null, design: null,
      });
    }
    for (const [kc, pls] of placementsBySku) {
      const k = kc.split("|")[0];
      const owned = new Set(pls.map((p) => p.orderId).filter((x): x is number => !!x)
        .map((id) => ownerRefById.get(id)?.orderNumber).filter(Boolean));
      if (!owned.size) continue;
      const list = ordersBySku.get(k);
      // SA MISMONG ARRAY ANG PAGBURA (2026-08-31): ang toLocProduct ay kumuha
      // na ng reference sa array na ito BAGO umabot dito — ang dating
      // `ordersBySku.set(k, list.filter(...))` ay gumawa ng BAGONG array na
      // walang nakakakita, kaya ang lumang bunton sa L1-A1 ay nagsuot pa rin
      // ng ORD-000001/Customer/Delivery ng may-ari ng L10-A2.
      if (list) for (let i = list.length - 1; i >= 0; i--) {
        if (owned.has(list[i].orderNumber)) list.splice(i, 1);
      }
    }
  }


  const invByLoc = new Map<string, { products: Map<string, LocProduct>; units: number }>();
  const unassigned: LocProduct[] = [];
  const legacyClaimed = new Set<string>();
  for (const r of inv ?? []) {
    const code = (r.location ?? "").trim();               // Cubic / Rak #
    const oh = Number(r.oh_inv ?? 0);
    // UBOS NA ANG STOCK (0 on-hand) = wala na sa warehouse — hindi na dapat
    // lumitaw sa lokasyon o sa unassigned na listahan (hiling 2026-08-10).
    // Babalik itong mag-isa kapag pumasok ulit ang stock.
    if (oh <= 0) continue;
    const base = (r.sku ? prodBySku.get(String(r.sku).toLowerCase()) : undefined)
      ?? prodByName.get(String(r.product_name ?? "").toLowerCase())
      ?? { id: 0, key: `${String(r.sku ?? r.product_name ?? "").toLowerCase()}|`, product_name: r.product_name ?? "—", sku: r.sku ?? null, image_url: null, category: null, color: null, dimension: null, onHand: oh, orders: r.sku ? ordersBySku.get(String(r.sku).toLowerCase()) ?? [] : [], qc: null };
    // KADA KULAY (0232/0235): ang kulay ng inventory row ang kulay ng hilera;
    // ang mga order na nakalaan ay ang may parehong kulay lang (o walang kulay).
    const rowColor = String((r as { color?: string | null }).color ?? "").trim();
    const rc = normColor(rowColor);
    const lp: LocProduct = {
      ...base,
      key: `${String(r.sku ?? r.product_name ?? "").toLowerCase()}|${rc}`,
      color: rowColor || base.color,
      image_url: (rowColor ? imageForColor(variantsFor(variantIdx, base.product_name, r.sku), rowColor) : null) ?? base.image_url,
      orders: rc ? (base.orders ?? []).filter((o) => { const c = colorOfDesc(o.itemDesc); return !c || c === rc; }) : base.orders,
    };
    const rowReserved = Math.max(0, Number(r.reserved ?? 0))
      // Ang pending pack lines ay nakalaan din — kahit 0 na ang resync-reserved.
      + (r.sku ? packPendingBySku.get(String(r.sku).toLowerCase()) ?? 0 : 0);
    // Isang kopya ng produkto sa isang cubic, may takdang dami. Ang reserved ay
    // sa UNANG puwesto lang ipinapakita — hindi ito hinahati kada cubic, at ang
    // pag-uulit nito sa bawat kopya ay magpapalabis ng bilang.
    const pushTo = (cubic: string, units: number, withReserve: boolean, own?: LocOrderRef[]) => {
      const key = cubic.toLowerCase();
      const bucket = invByLoc.get(key) ?? { products: new Map<string, LocProduct>(), units: 0 };
      bucket.products.set(lp.key, {
        ...lp,
        onHand: units,
        reserved: withReserve ? Math.min(rowReserved, units) : 0,
        // ANG AVAILABLE AY UNITS BAWAS ANG IPINAPAKITANG RESERVED (2026-08-29).
        // Dalawang mali ang naunang bersyon. Una, `Math.min(rowAvailable, units)`
        // — naka-clamp lang sa dami sa puwesto, hindi ibinabawas, kaya ang
        // hilera ay nagbabasa ng "5 on hand, 1 reserved, 5 available". Tapos,
        // ang paghalo ng `rowAvailable` sa binawas na bilang ay nagbawas nang
        // DALAWANG BESES: 5 − 1 = 4, pero `rowAvailable` ay 3 na (nabawasan na
        // ng resync), at kinuha ng `min` ang 3.
        //
        // Ang `inventory.available` ay para sa BUONG SKU; ang hilerang ito ay
        // isang puwesto. Isaad ang available sa mismong dalawang numerong
        // nasa hilera, para laging magkatugma ang tatlo sa iisang tingin.
        available: Math.max(0, units - (withReserve ? Math.min(rowReserved, units) : 0)),
        // ANG ORDER AY SA ISANG PUWESTO LANG (2026-08-26). Kapag hati ang SKU
        // sa dalawang cubic, ang order ng isang piraso ay lumilitaw dati sa
        // PAREHONG cubic — dalawang hilera sa Upcoming Deliveries para sa
        // iisang order. Sa unang puwesto lang ito ngayon (doon din ang
        // reserved — at doon unang kumukuha ang FIFO consume).
        // Ang sariling may-ari ng puwestong ito (0219) ang nauuna; ang
        // sku-level na listahan ay sumasakay pa rin sa unang/pinakamalaking
        // puwesto gaya ng dati.
        orders: [...(own ?? []), ...(withReserve ? lp.orders ?? [] : [])],
      });
      bucket.units += units;
      invByLoc.set(key, bucket);
    };

    const skuKey = String(r.sku ?? "").toLowerCase();
    let rawPls = r.sku ? placementsBySku.get(`${skuKey}|${rc}`) ?? [] : [];
    // Ang lumang puwestong walang kulay ay sa UNANG hilera ng SKU napupunta
    // (isang beses lang) — walang mawawala sa mapa pagkatapos ng 0235.
    if (r.sku && !legacyClaimed.has(skuKey)) {
      // Pati ang puwestong may kulay na WALANG katumbas na inventory row (hal.
      // maling kulay na naitala) — huwag mawala sa mapa; sa unang hilera.
      const rowColors = new Set((inv ?? []).filter((x) => String(x.sku ?? "").toLowerCase() === skuKey).map((x) => normColor((x as { color?: string | null }).color)));
      const extra: typeof rawPls = [];
      for (const [k, pls] of placementsBySku) {
        if (!k.startsWith(`${skuKey}|`)) continue;
        const kc = k.slice(skuKey.length + 1);
        if (kc === rc) continue;
        if (kc === "" || !rowColors.has(kc)) extra.push(...pls);
      }
      if (extra.length) { rawPls = [...rawPls, ...extra]; legacyClaimed.add(skuKey); }
    }
    // ANG UNANG PLACEMENT AY HINDI NAGPAPAALIS SA IBA (2026-08-31, hiling ni
    // Joe). Ang buong 115 ng SOFA-000001 ay naka-L10-A1 sa inventory.location —
    // pero nang ma-stock-in ang isang inayos na unit (unang stock_placements
    // row), lumipat sa placement mode ang paghahati at ang 114 ay biglang
    // "Needs a location", na para bang tinanggal sila sa istante. Ang labis na
    // walang sariling placement ay NANANATILI sa inventory.location kapag
    // mayroon nito; ang tunay na walang kahit ano lang ang napupunta sa
    // unassigned. (Kopya ang ginagawa — ang placementsBySku ay shared map at
    // hindi dapat mabago nang paulit-ulit kada load.)
    let pls = rawPls.map((p) => ({ ...p }));
    if (pls.length) {
      const placedSum = pls.reduce((s, p) => s + p.qty, 0);
      const spill = Math.max(0, oh - placedSum);
      if (spill > 0 && code) {
        const hit = pls.find((p) => p.code.toLowerCase() === code.toLowerCase());
        if (hit) hit.qty += spill;
        else pls = [...pls, { code, qty: spill, orderId: null }];
      }
      // Hatiin sa mga puwesto. Ang LABIS na wala kahit inventory.location ay
      // bumabalik sa "Needs a location" na may natitirang bilang.
      let leftover = oh;
      // SA PINAKAMALAKING PUWESTO ANG RESERVED (2026-08-29), hindi sa unang
      // naitalang row. Ang SOFA-000001 ay 118 sa L1-A2 at tig-isa sa L3-A3 at
      // L3-A4; nang ang UNANG placement ang tumanggap ng buong reserved, ang
      // cubic na may 118 ay lumabas na "— reserved, 118 available" — mukhang
      // walang nakalaan sa isang bunton na may tatlong order nang palabas. Ang
      // pinakamalaki rin ang unang kinukunan ng tao.
      const biggest = pls.reduce((a, b) => (b.qty > a.qty ? b : a), pls[0]);
      let first = true;
      for (const pl of [biggest, ...pls.filter((x) => x !== biggest)]) {
        const take = Math.min(pl.qty, leftover);
        if (take <= 0 || !pl.code) continue;
        // Isuot ang design sheet ng may-ari — sa puntong ito alam na ang SKU,
        // kaya dito ang lookup, hindi sa ownerRefById na order-lang ang alam
        // (2026-08-31: "—" ang DESIGN DETAILS ng inayos na unit sa L10-A2
        // kahit may DD-000001 ang ORD-000001).
        pushTo(pl.code, take, first, pl.orderId ? [ownerRefById.get(pl.orderId)].filter((x): x is LocOrderRef => !!x).map((o) => {
          if (o.design) return o;
          const dd = ddByKey.get(`${o.orderNumber}|${String(lp.sku ?? "").trim().toUpperCase()}`) ?? ddByKey.get(o.orderNumber) ?? null;
          return dd ? { ...o, designUrl: dd.url, design: dd } : o;
        }) : undefined);
        first = false;
        leftover -= take;
      }
      if (leftover > 0) unassigned.push({ ...lp, onHand: leftover });
      continue;
    }

    if (!code) { unassigned.push(lp); continue; }
    pushTo(code, oh, true);
  }

  const locations: LocCard[] = (locs ?? []).map((l) => {
    const bucket = invByLoc.get(String(l.code).toLowerCase());
    const products = bucket ? [...bucket.products.values()] : [];
    const units = bucket?.units ?? 0;
    const capacity = l.capacity != null ? Number(l.capacity) : null;
    return {
      id: l.id,
      code: l.code,
      zone: l.zone ?? null,
      capacity,
      status: l.status ?? "active",
      products,
      units,
      skuCount: products.length,
      utilization: capacity && capacity > 0 ? Math.min(units / capacity, 1) : null,
    };
  });

  // Occupied = may laman ang rack: may naka-assign na SKU (kahit 0 pa ang
  // on-hand) o may aktwal na units — para gumalaw agad ang KPI pag nag-assign.
  const occupied = locations.filter((l) => l.units > 0 || l.skuCount > 0).length;
  const withCap = locations.filter((l) => l.utilization != null);
  const util = withCap.length ? withCap.reduce((s, l) => s + (l.utilization ?? 0), 0) / withCap.length : null;

  return {
    locations,
    unassigned,
    allProducts,
    kpi: { total: locations.length, occupied, empty: locations.length - occupied, util },
  };
}
