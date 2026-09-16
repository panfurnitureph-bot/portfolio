import { createServerSupabase, type OrderRow } from "@/lib/supabase/server";
import { isShippingDesc } from "@/lib/shipping";
import { parseDescSpecs } from "@/lib/receipt-desc";
import { makeColorPhoto } from "@/lib/ops/product-variants";

// One return / RMA record.
export type ReturnRow = {
  id: number;
  return_no: string | null;
  type: string;                 // 'customer' | 'supplier'
  order_id: number | null;
  order_number: string | null;  // resolved from order_id for display
  is_rush: boolean;             // rush ng pinagmulang order — badge sa listahan
  rush_days: number | null;
  order_date: string | null;
  po_id: number | null;
  supplier: string | null;
  customer_name: string | null;
  item_desc: string | null;
  item_image: string | null;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  qty: number;
  reason: string | null;
  item_condition: string | null; // 'resaleable' | 'defective'
  resolution: string | null;     // 'refund' | 'replacement' | 'credit' | 'rtv_credit' | 'rework'
  refund_amount: number;
  replacement_order_id: number | null;
  // Rework
  rework_target: string | null;       // 'restock' | 'redeliver'
  rework_workshop_id: number | null;
  rework_workshop_name: string | null; // label kung aling workshop ang gagawa ng rework
  // AUTO-MAPPING (Joe 2026-09-07): ang workshop na GUMAWA ng gamit — doon din
  // ito irerepair. Mula sa workshop_job ng parehong order at produkto; kung
  // wala (stock item), ang pinakabagong job ng parehong produkto.
  built_workshop_id: number | null;
  built_workshop_name: string | null;
  rework_pickup_team: string | null;   // aling delivery team ang magpu-pull out (0146)
  rework_pickup_driver: string | null; // sino mismo ang driver — pwedeng iba sa team default (0151)
  rework_pickup_date: string | null;   // kailan kukunin ang item (0152) — schedule ng pickup task
  // Nandoon na ang team nang mag-declare (0209): kukunin ngayon din, at ang
  // pagkuha ay hindi na pumipila sa Route Planner.
  rework_pickup_onsite: boolean;
  // 0217: on-site ang DINEKLARA (kahit pull-out ang proseso) — suot at puwesto.
  rework_declared_onsite: boolean;
  // Pickup history snapshot (0153): { arrive: {at, signature, photos[]}, drop: {…} }
  rework_pickup_proof: { arrive?: { at: string; signature: string; photos: string[] }; drop?: { at: string; signature: string; photos: string[] } } | null;
  rework_job_id: number | null;
  reworked_at: string | null;
  rework_delivery_id: number | null;
  rework_mode: string | null;         // 'onsite' | 'pullout'
  rework_delivery_price: number;
  rework_parts_total: number;
  // ANG LISTAHAN, HINDI LANG ANG TOTAL (2026-08-27): "Replacement parts ₱6,500"
  // lang ang nakikita ng aprubador — hindi kung ANONG apat na parts ang
  // sinisingil. Naitala naman ito nang buo; hindi lang ipinapasa sa client.
  rework_parts: { part: string; qty: number; amount: number }[];
  // Rework's own service-charge billing (parts + delivery). 50% down required before
  // the rework proceeds; monitored on the Returns page.
  rework_charge_total: number;
  rework_downpayment: number;
  // Inaprubahan nang walang 50% down — ang buong balanse ay kinokolekta sa
  // redelivery. Naitatala kung sino ang nagpasya.
  rework_payment_override_by: string | null;
  rework_payment_method: string | null;
  // Maya QR body ng kasalukuyang rework session (0154) — para maipakita ng review
  // ang live QR ng PAREHONG session na na-email (gumagana ang poll/auto-credit).
  rework_qr_body: string | null;
  // On-site repair crew (0155) — mga worker na pupunta sa customer.
  // ON-SITE CREW — sino, at MAGKANO ang bayad sa kanila sa pagkumpuning ito.
  // Ang halaga ay bukas: itinatakda sa pag-apruba ng RMA, kada tao.
  rework_onsite_crew: { id: number; name: string; pay?: number }[] | null;
  // Kailan naitala ang bayad ng crew sa hr_project_work (0196). May laman =
  // naitala na; ang aprubahan ay hindi na uulit.
  rework_crew_paid_at: string | null;
  photos: string[];
  status: string;
  source: string | null;        // 'sales' | 'delivery' — where it was declared from
  // Aling delivery team ang nagdeklara (0203) — ito ang naglalabas ng RMA sa
  // per-team Returns/RMA page; null kapag Sales/Warehouse/Operations.
  declared_team: string | null;
  requested_by: string | null;
  approved_by: string | null;
  created_at: string | null;
  approved_at: string | null;
  notes: string | null;
};

// Workshop option for the rework picker.
export type WorkshopOption = { id: number; name: string | null };

// Lightweight order option for the "new return" picker (customer side).
export type OrderOption = {
  id: number;
  order_number: string | null;
  customer_name: string | null;
  balance: number;
  items: { description: string; sku: string | null; unitPrice: number; qty: number; image: string | null; category: string | null; color: string | null; dimension: string | null; frame?: string | null }[];
};

// Lightweight PO option for the "new return" picker (supplier side).
export type PoOption = {
  id: number;
  pi_number: string | null;
  supplier: string | null;
};

// Ang RESERVE ay pool ng driver na maaaring ipalit — hindi ito delivery team,
// at walang tablet. Kailangang makilala para masala kung saan hindi ito bagay.
export type PickupTeamOption = { name: string; driver: string | null; reserved: boolean };

export type ReturnsData = {
  returns: ReturnRow[];
  orders: OrderOption[];
  pos: PoOption[];
  workshops: WorkshopOption[];
  teams: PickupTeamOption[];
  // Project-base / constructor workers — on-site rework crew multi-select.
  workers: { id: number; name: string; role: string | null }[];
  kpi: {
    pending: number;
    approvedThisWeek: number;
    totalRefund: number;     // sum of refund_amount over approved/completed refunds
    customerCount: number;
    supplierCount: number;
  };
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function asPhotos(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

export async function loadReturns(): Promise<ReturnsData> {
  const supabase = createServerSupabase();
  // Litrato ayon sa kulay ng item (color_variants) — lib/ops/product-variants.
  const photo = await makeColorPhoto(supabase);

  const [{ data: retData }, { data: orderData }, { data: poData }, { data: wsData }, { data: teamData }, { data: workerData }] = await Promise.all([
    supabase
      .from("returns")
      // select("*") — defensive sa mga column na dumarating sa magkakahiwalay na
      // migrations (hal. rework_pickup_team, 0146): ang explicit list ay
      // nagpapa-blangko ng buong Returns page kapag kulang pa ang column.
      .select("*")
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase
      .from("orders")
      .select("id, order_number, customer_name, receipt_items, full_payment_price, downpayment_price, full_payment")
      .order("id", { ascending: false })
      .limit(500),
    supabase
      .from("purchase_orders")
      .select("id, pi_number, supplier")
      .order("id", { ascending: false })
      .limit(500),
    supabase.from("workshop").select("id, name").eq("active", true).order("name").limit(200),
    supabase.from("delivery_teams").select("name, driver, reserved").eq("active", true).order("name").limit(50),
    // On-site rework crew picker — parehong pool ng QC declaration "Made By"
    // (project-base / constructor workers).
    supabase.from("employees").select("id, name, role").eq("active", true)
      .or("role.ilike.%constructor%,role.ilike.%project base%").order("role").order("name").limit(5000),
  ]);

  // Resolve order_id → order_number for display (the orders picker is capped at 500
  // and may not include older orders, so look up exactly the ones the returns reference).
  const retOrderIds = Array.from(
    new Set((retData ?? []).map((r) => r.order_id as number | null).filter((x): x is number => x != null)),
  );
  const orderNoById = new Map<number, string | null>();
  const rushById = new Map<number, { is_rush: boolean; rush_days: number | null; date_order: string | null }>();
  if (retOrderIds.length > 0) {
    const { data: onData } = await supabase
      .from("orders")
      .select("id, order_number, is_rush, rush_days, date_order")
      .in("id", retOrderIds)
      .limit(2000);
    for (const o of onData ?? []) {
      orderNoById.set(o.id as number, (o.order_number as string | null) ?? null);
      rushById.set(o.id as number, {
        is_rush: !!(o as { is_rush?: boolean | null }).is_rush,
        rush_days: (o as { rush_days?: number | null }).rush_days ?? null,
        date_order: (o as { date_order?: string | null }).date_order ?? null,
      });
    }
  }

  // SINONG WORKSHOP ANG GUMAWA (2026-09-07): hanapin ang workshop_job na hindi
  // rework para sa parehong order + produkto (unang linya ng item_desc); kung
  // wala, ang pinakabagong job ng parehong produkto sa kahit anong order.
  const firstLine = (d: unknown) => String(d ?? "").split("\n")[0].trim().toLowerCase();
  const retNames = Array.from(new Set((retData ?? []).map((r) => firstLine(r.item_desc)).filter(Boolean)));
  const builtByOrder = new Map<string, number>();   // order_id|name → workshop_id
  const builtByName = new Map<string, number>();    // name → latest workshop_id
  const reworkByName = new Map<string, number>();   // name → workshop ng nakaraang rework (huling fallback)
  if (retNames.length > 0) {
    const { data: jobs } = await supabase
      .from("workshop_job")
      .select("id, order_id, workshop_id, item_desc")
      .not("workshop_id", "is", null)
      .order("id", { ascending: false })
      .limit(3000);
    for (const j of jobs ?? []) {
      const head = firstLine(j.item_desc);
      const ws = j.workshop_id as number;
      // Rework job: "Rework · RMA-000016 · Black Sesame Swivel Chair" — ang
      // produkto ay ang huling bahagi; ikatlong fallback lang ito (imported /
      // stock na walang build job, pero may nakaraang rework).
      if (head.startsWith("rework ·")) { const nm = head.split(" · ").pop()?.trim() ?? ""; if (nm && retNames.includes(nm) && !reworkByName.has(nm)) reworkByName.set(nm, ws); continue; }
      const name = head;
      if (!name || !retNames.includes(name)) continue;
      if (j.order_id != null) { const k = String(j.order_id) + "|" + name; if (!builtByOrder.has(k)) builtByOrder.set(k, ws); }
      if (!builtByName.has(name)) builtByName.set(name, ws);
    }
  }
  const wsNameOf = (id: number | null) => id == null ? null : (((wsData ?? []).find((w) => w.id === id)?.name as string | null) ?? null);
  const builtWs = (r: Record<string, unknown>): number | null => {
    const name = firstLine(r.item_desc); if (!name) return null;
    return (r.order_id != null ? builtByOrder.get(String(r.order_id) + "|" + name) : undefined) ?? builtByName.get(name) ?? reworkByName.get(name) ?? null;
  };

  const returns = (retData ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as number,
    return_no: (r.return_no as string | null) ?? null,
    type: (r.type as string) ?? "customer",
    order_id: (r.order_id as number | null) ?? null,
    order_number: r.order_id != null ? (orderNoById.get(r.order_id as number) ?? null) : null,
    is_rush: r.order_id != null ? (rushById.get(r.order_id as number)?.is_rush ?? false) : false,
    rush_days: r.order_id != null ? (rushById.get(r.order_id as number)?.rush_days ?? null) : null,
    order_date: r.order_id != null ? (rushById.get(r.order_id as number)?.date_order ?? null) : null,
    po_id: (r.po_id as number | null) ?? null,
    supplier: (r.supplier as string | null) ?? null,
    customer_name: (r.customer_name as string | null) ?? null,
    item_desc: (r.item_desc as string | null) ?? null,
    item_image: photo(String(r.item_desc ?? "").split("\n")[0], r.sku as string | null, r.color as string | null, r.item_desc as string | null, (r.item_image as string | null) ?? null),
    sku: (r.sku as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    color: (r.color as string | null) ?? null,
    dimension: (r.dimension as string | null) ?? null,
    qty: Number(r.qty ?? 1),
    reason: (r.reason as string | null) ?? null,
    item_condition: (r.item_condition as string | null) ?? null,
    resolution: (r.resolution as string | null) ?? null,
    refund_amount: Number(r.refund_amount ?? 0),
    replacement_order_id: (r.replacement_order_id as number | null) ?? null,
    rework_target: (r.rework_target as string | null) ?? null,
    rework_workshop_id: (r.rework_workshop_id as number | null) ?? null,
    built_workshop_id: builtWs(r),
    built_workshop_name: wsNameOf(builtWs(r)),
    // Pangalan ng workshop na gagawa ng rework — label sa Resolution column.
    rework_workshop_name: r.rework_workshop_id != null
      ? (((wsData ?? []).find((w) => w.id === r.rework_workshop_id)?.name as string | null) ?? null)
      : null,
    rework_pickup_team: (r.rework_pickup_team as string | null) ?? null,
    rework_pickup_driver: (r.rework_pickup_driver as string | null) ?? null,
    rework_pickup_date: (r.rework_pickup_date as string | null) ?? null,
    rework_pickup_onsite: !!(r as Record<string, unknown>).rework_pickup_onsite,
    rework_declared_onsite: !!(r as Record<string, unknown>).rework_declared_onsite,
    rework_pickup_proof: (r.rework_pickup_proof as ReturnRow["rework_pickup_proof"]) ?? null,
    rework_job_id: (r.rework_job_id as number | null) ?? null,
    reworked_at: (r.reworked_at as string | null) ?? null,
    rework_delivery_id: (r.rework_delivery_id as number | null) ?? null,
    rework_mode: (r.rework_mode as string | null) ?? null,
    rework_delivery_price: Number(r.rework_delivery_price ?? 0),
    rework_parts_total: Number(r.rework_parts_total ?? 0),
    rework_parts: Array.isArray(r.rework_parts)
      ? (r.rework_parts as { part?: string; qty?: number; amount?: number }[])
          .map((x) => ({ part: String(x?.part ?? ""), qty: Number(x?.qty) || 1, amount: Number(x?.amount) || 0 }))
          .filter((x) => x.part)
      : [],
    rework_charge_total: Number(r.rework_charge_total ?? 0),
    rework_downpayment: Number(r.rework_downpayment ?? 0),
    rework_payment_override_by: (r.rework_payment_override_by as string | null) ?? null,
    rework_payment_method: (r.rework_payment_method as string | null) ?? null,
    rework_qr_body: (r.rework_qr_body as string | null) ?? null,
    rework_onsite_crew: Array.isArray(r.rework_onsite_crew)
      ? (r.rework_onsite_crew as { id?: unknown; name?: unknown; pay?: unknown }[])
          .map((w) => ({ id: Number(w?.id), name: String(w?.name ?? "").trim(), pay: Math.max(Number(w?.pay) || 0, 0) }))
          .filter((w) => Number.isFinite(w.id) && w.name)
      : null,
    rework_crew_paid_at: (r.rework_crew_paid_at as string | null) ?? null,
    photos: asPhotos(r.photos),
    status: (r.status as string) ?? "Pending",
    source: (r.source as string | null) ?? null,
    declared_team: (r.declared_team as string | null) ?? null,
    requested_by: (r.requested_by as string | null) ?? null,
    approved_by: (r.approved_by as string | null) ?? null,
    created_at: (r.created_at as string | null) ?? null,
    approved_at: (r.approved_at as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  })) as ReturnRow[];

  // TANGGAL SA PICKER ANG NA-REFUND NA (2026-09-02, "narefund na ung isa pero
  // nandito padin sa list"): ang linyang may buhay na REFUND return (pending,
  // approved, o bayad na — lahat maliban sa rejected/cancelled) ay wala na sa
  // order at hindi na maidedeklarang muli. Bilangan kada linya: ang order na may
  // dalawang magkaparehong linya at isang refund ay nagpapakita pa ng isa.
  const refundedCount = new Map<string, number>();
  for (const r of returns) {
    if (r.order_id == null || !/refund/i.test(r.resolution ?? "")) continue;
    if (/reject|cancel/i.test(r.status ?? "")) continue;
    const k = `${r.order_id}|${(r.item_desc ?? "").split("\n")[0].trim().toLowerCase()}`;
    refundedCount.set(k, (refundedCount.get(k) ?? 0) + 1);
  }

  const orders: OrderOption[] = (orderData ?? []).map((o) => {
    const row = o as Pick<OrderRow, "id" | "order_number" | "customer_name" | "receipt_items" | "full_payment_price" | "downpayment_price" | "full_payment">;
    const total = Number(row.full_payment_price ?? 0);
    const paid = Number(row.downpayment_price ?? 0) + Number(row.full_payment ?? 0);
    const usedRefunds = new Map<string, number>();
    const items = (row.receipt_items ?? []).filter((it) => {
      if (isShippingDesc(it.description)) return false;
      const k = `${row.id}|${String(it.description ?? "").split("\n")[0].trim().toLowerCase()}`;
      const left = (refundedCount.get(k) ?? 0) - (usedRefunds.get(k) ?? 0);
      if (left > 0) { usedRefunds.set(k, (usedRefunds.get(k) ?? 0) + 1); return false; }
      return true;
    }).map((it) => {
      // Per-item fields first; else recover specs from the "• …" bullets of the
      // description so customized/website items still show complete details.
      const specs = parseDescSpecs(it.description);
      return {
        description: it.description ?? "",
        sku: it.sku ?? null,
        unitPrice: Number(it.unitPrice ?? 0),
        qty: Number(it.qty ?? 1),
        image: photo(String(it.description ?? "").split("\n")[0], it.sku, it.color ?? specs.color, it.description, it.image ?? null),
        category: it.category ?? specs.category,
        color: it.color ?? specs.color,
        dimension: it.dimension ?? specs.dimension,
        frame: specs.frame,
      };
    });
    return {
      id: row.id,
      order_number: row.order_number,
      customer_name: row.customer_name,
      balance: round2(Math.max(0, total - paid)),
      items,
    };
  })
    // WALANG MAIPIPILING ITEM = WALA SA PICKER (2026-09-02, "wala na laman ung
    // order number dapat wala na sa list"): ang order na naubos na ng refund
    // ang lahat ng linya (o walang produkto sa resibo) ay wala nang
    // maidedeklarang return — huwag nang ipakita.
    .filter((o) => o.items.length > 0);

  const pos: PoOption[] = (poData ?? []).map((p) => {
    const row = p as { id: number; pi_number: string | null; supplier: string | null };
    return { id: row.id, pi_number: row.pi_number, supplier: row.supplier };
  });

  const workshops: WorkshopOption[] = (wsData ?? []).map((w) => {
    const row = w as { id: number; name: string | null };
    return { id: row.id, name: row.name };
  });

  // "Approved this week" = approved/completed within the last 7 days.
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const isApproved = (s: string) => /approved|completed/i.test(s);
  const approvedThisWeek = returns.filter(
    (r) => isApproved(r.status) && r.approved_at && new Date(r.approved_at).getTime() >= weekAgo,
  ).length;

  return {
    returns,
    orders,
    pos,
    workshops,
    workers: ((workerData ?? []) as { id: number; name: string; role: string | null }[])
      .map((w) => ({ id: w.id, name: w.name, role: w.role ?? null })),
    teams: ((teamData ?? []) as { name: string | null; driver: string | null; reserved: boolean | null }[])
      .filter((t) => !!t.name)
      .map((t) => ({ name: String(t.name), driver: t.driver ?? null, reserved: !!t.reserved })),
    kpi: {
      pending: returns.filter((r) => /pending/i.test(r.status)).length,
      approvedThisWeek,
      totalRefund: returns
        .filter((r) => isApproved(r.status) && r.resolution === "refund")
        .reduce((s, r) => s + Number(r.refund_amount || 0), 0),
      customerCount: returns.filter((r) => r.type === "customer").length,
      supplierCount: returns.filter((r) => r.type === "supplier").length,
    },
  };
}
