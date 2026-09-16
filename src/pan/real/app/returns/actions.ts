"use server";

import { revalidatePath } from "next/cache";
import { nextDocNumber } from "@/lib/next-number";
import { createServerSupabase } from "@/lib/supabase/server";
import { findInventoryRow, lineColor } from "@/lib/orders/inventory";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { todayPH } from "@/lib/today";
import { requireEdit } from "@/lib/auth/guard";
import { getSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/rbac";
// (2026-09-01) Ang refund ay PAN Overall expense na — hindi na order_payments;
// wala nang kailangan mula sa lib/orders/payments dito.
import { saveDeliveryCore } from "@/lib/delivery/save";
import { requireManagerOr } from "@/lib/auth/guard";

// Approving/rejecting a return is a MANAGER action (admin / operations manager) —
// separate from the staff who declared it. Mirrors the Workshop-QC → Operations
// approval split. Staff declare (requireEdit); only a manager decides.
// Permission din (2026-09-05): Edit sa Returns Approval (ops_returns) o sa
// Returns / RMA (returns) sa grid = makakapag-approve.
async function requireManager() {
  return requireManagerOr("ops_returns", "returns");
}

// On-site crew picker options — project-base / constructor workers (parehong pool
// ng QC declaration "Made By"). Ginagamit ng NewReturnModal kapag walang workers
// prop (hal. declare mula sa Delivery modal).
export async function loadOnsiteCrewOptions(): Promise<{ id: number; name: string; role: string | null }[]> {
  if (!(await getSession())) return [];
  const db = createServerSupabase();
  const { data } = await db.from("employees").select("id, name, role").eq("active", true)
    .or("role.ilike.%constructor%,role.ilike.%project base%").order("role").order("name").limit(5000);
  return (data ?? []) as { id: number; name: string; role: string | null }[];
}

// Ang unang aktibong workshop. Sa ON SITE ay hindi tinatanong kung saan —
// walang dinadala doon — pero ang `rework_job` ay kailangang may workshop, dahil
// doon nagde-declare ang bayad ng crew. Ang crew mismo ang nakatala sa job.
async function fallbackWorkshopId(
  db: ReturnType<typeof createServerSupabase>,
): Promise<number | null> {
  const { data } = await db.from("workshop").select("id").eq("active", true)
    .order("id").limit(1).maybeSingle();
  return (data?.id as number | null) ?? null;
}

// SINO ANG MAY-ARI NG BIYAHE (0205, 2026-08-28). Ang isang order ay may isang
// deliveries row na ginagamit muli sa bawat biyahe, kaya ang lahat ng RMA nito
// ay tumuturo sa parehong row — at walang paraang malaman kung kanino ito
// ngayon. Ang `return_id` ang nagsasabi. Best-effort: kung hindi pa tumatakbo
// ang 0205, ang biyahe pa rin ang mahalaga.
async function tagDeliveryOwner(
  db: ReturnType<typeof createServerSupabase>,
  deliveryId: number,
  returnId: number,
): Promise<void> {
  try { await db.from("deliveries").update({ return_id: returnId }).eq("id", deliveryId); }
  catch { /* wala pang 0205 */ }
}

export type CreateReturnInput = {
  type: "customer" | "supplier";
  order_id?: number | null;
  po_id?: number | null;
  supplier?: string | null;
  customer_name?: string | null;
  item_desc?: string | null;
  item_image?: string | null;
  sku?: string | null;
  category?: string | null;
  color?: string | null;
  dimension?: string | null;
  qty?: number | null;
  reason?: string | null;
  item_condition?: "resaleable" | "defective" | null;
  resolution?: "refund" | "replacement" | "credit" | "rtv_credit" | "rework" | null;
  refund_amount?: number | null;
  photos?: string[] | null;
  // Rework only: where the fixed item goes + which workshop repairs it.
  rework_target?: "restock" | "redeliver" | null;
  rework_workshop_id?: number | null;
  // Rework mode: on-site (fixed at the customer, no pull-out) vs pull-out (collected,
  // repaired at the workshop, redelivered). Pull-out carries a delivery price.
  rework_mode?: "onsite" | "pullout" | null;
  // On-site only: ang repair crew na pupunta sa customer (multi-select, 0155).
  rework_onsite_crew?: { id: number; name: string }[] | null;
  // Pull-out only: aling delivery team ang magpu-pull out (Team A–D).
  rework_pickup_team?: string | null;
  // Pull-out only: sino mismo ang driver — pwedeng iba sa team default (Reserve).
  rework_pickup_driver?: string | null;
  // Pull-out only: kailan kukunin ang item — schedule_date ng pickup task (0152).
  rework_pickup_date?: string | null;
  // NANDOON NA ANG TEAM (0209): nakita ang sira habang nasa bahay pa sila, at
  // kukunin nila ngayon din. Sa approval, ang pagkuha ay diretso sa pickup task
  // — hindi na pumipila sa Route Planner, na walang saysay kung nakaparada na
  // ang trak sa harap ng bahay.
  rework_pickup_onsite?: boolean | null;
  rework_delivery_price?: number | null;
  // Replacement parts the repair consumes (priced from the UI rate card).
  rework_parts?: { part: string; qty: number; price: number; amount: number }[] | null;
  // Payment method chosen at declaration for the 50% downpayment (Email QR / Cash /
  // Terminal) — the review then shows only this option to collect.
  rework_payment_method?: string | null;
  // From /returns only: when an admin/manager (who sees BOTH groups) declares, they
  // pick whether this is a Sales-side or Warehouse-side declaration. Ignored for
  // fixed-role staff — their source is derived from their role server-side.
  declared_from?: "sales" | "warehouse" | "delivery" | null;
  // ALING TEAM ang nagdeklara (hal. "Team A") — ipinapasa ng per-team
  // Returns/RMA dashboard. Ito ang nagpapalabas ng RMA sa page ng team na
  // iyon; null kapag mula sa Sales/Warehouse/Operations (0203).
  declared_team?: string | null;
};

// Shared insert — used by BOTH the Sales entry point (createReturn) and the
// Delivery entry point (createReturnFromDelivery). The caller does the auth gate
// and passes the resolved session, so this body never diverges between the two.
async function insertReturn(
  me: { full_name: string },
  input: CreateReturnInput,
  revalidate: string[],
  source: "sales" | "warehouse" | "delivery",
): Promise<{ ok: true; id: number; return_no: string } | { error: string }> {
  const supabase = createServerSupabase();

  const type = input.type === "supplier" ? "supplier" : "customer";
  if (type === "customer" && !input.order_id) {
    return { error: "Customer returns require a source order." };
  }
  if (type === "supplier" && !input.po_id && !(input.supplier && input.supplier.trim())) {
    return { error: "Supplier returns require a purchase order or supplier name." };
  }

  const qty = Number(input.qty ?? 1);
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Enter a valid quantity (> 0)." };

  // Rework requires a target (where the fixed item goes) + a workshop to repair it.
  const isRework = input.resolution === "rework";
  // On-site vs pull-out. Default to on-site (the old single-mode behavior). BOTH
  // modes carry a delivery price: pull-out = the redelivery run, on-site = the
  // crew's trip to the customer.
  //
  // ANG WALANG-TSEK NA ON-SITE AY PULL-OUT (utos ni Joe, 2026-08-30). Ang
  // "Rework on Site" na WALANG "We are still here" ay nangangahulugang hindi
  // naayos sa bisitang ito — at ang totoo sa operasyon: ang gamit ay
  // KUKUNIN at dadalhin sa workshop, hindi babalikan sa bahay. Kaya ang tala
  // ay pull-out mula simula: pickup schedule sa approval, Pickup Task na may
  // proof photos, workshop repair, redeliver — ang buong umiiral na daanan.
  // Ang on-site ay ang may tsek lamang: inaayos NGAYON, sa harap ng customer.
  const declaredMode: "onsite" | "pullout" = input.rework_mode === "pullout" ? "pullout" : "onsite";
  const reworkMode: "onsite" | "pullout" =
    declaredMode === "onsite" && !input.rework_pickup_onsite ? "pullout" : declaredMode;
  const deliveryPrice = Math.max(Number(input.rework_delivery_price) || 0, 0);
  // Sanitize replacement parts + compute the parts total server-side (never trust a
  // client total). Each amount = qty × price, floored at 0.
  const reworkParts = (input.rework_parts ?? [])
    .map((p) => ({ part: String(p.part), qty: Math.max(Number(p.qty) || 0, 0), price: Math.max(Number(p.price) || 0, 0) }))
    .filter((p) => p.part && p.qty > 0)
    .map((p) => ({ ...p, amount: Math.round(p.qty * p.price * 100) / 100 }));
  const partsTotal = reworkParts.reduce((s, p) => s + p.amount, 0);
  // The rework's full charge = the order's remaining balance + parts + delivery, so
  // the 50% downpayment covers everything still owed plus the repair. Fetched here so
  // it's stored on the row; a supplier return (no order) has no balance component.
  let orderBalance = 0;
  if (isRework && type === "customer" && input.order_id) {
    const { data: o } = await supabase.from("orders")
      .select("full_payment_price, downpayment_price, full_payment").eq("id", input.order_id).maybeSingle();
    if (o) {
      const tot = Number(o.full_payment_price) || 0;
      const paid = (Number(o.downpayment_price) || 0) + (Number(o.full_payment) || 0);
      orderBalance = Math.max(Math.round((tot - paid) * 100) / 100, 0);
    }
  }
  const reworkCharge = Math.round((orderBalance + partsTotal + deliveryPrice) * 100) / 100;
  if (isRework) {
    // Workshop is required for BOTH modes — Pull Out repairs in the workshop;
    // On Site sends that workshop's workers to the customer (their QC declaration
    // is how the repair crew gets paid). Target defaults to redeliver (the item
    // goes back to the customer either way); legacy 'restock' is still accepted.
    if (input.rework_target !== "restock" && input.rework_target !== "redeliver") {
      return { error: "Pick a rework target (restock or redeliver)." };
    }
    // ANG WORKSHOP AY PARA SA PULL OUT LANG (binago 2026-08-25) — doon dadalhin
    // ang bagay. Sa ON SITE ay walang dinadala: ang crew ang pumupunta sa
    // customer, at ang bayad nila ay OPEN PRICE kada tao sa HR approval.
    //
    // Kailangan pa rin ng workshop para sa `rework_job` — doon nakakabit ang
    // declaration na pinagdadaanan ng bayad. Pero hindi na iyon tanong sa
    // gumagamit: hinahanap ito rito, at kung wala, ang unang aktibong workshop
    // ang tatanggap. Ang CREW ang nakatala sa job; ang workshop ay daanan lang.
    // SA APPROVAL NA ANG WORKSHOP AT PULL-OUT TEAM (hiling 2026-08-27): ang
    // nagde-declare ay hindi na pinipilit pumili — ang manager sa Return /
    // Defect Approval ang magtatakda bago aprubahan. Walang requirement dito.
    if (input.rework_target === "redeliver" && type === "customer" && !input.order_id) {
      return { error: "Redeliver needs the source order." };
    }
  }

  // Server-assigned RMA number = pinakamataas na umiiral + 1 (000001 kapag wala).
  const return_no = await nextDocNumber(supabase, "returns", "return_no", "RMA", "next_return_no");
  if (!return_no) return { error: "Could not assign an RMA number." };

  const refund_amount = Number(input.refund_amount ?? 0);

  // Ang ON SITE ay walang piniling workshop — hinahanap ito rito para may
  // makabitan ang `rework_job`, na siyang daanan ng bayad ng crew.
  // PULLOUT: nananatiling null hanggang approval — doon pinipili ng manager.
  // ONSITE: fallback pa rin, para may makabitan agad ang rework_job ng crew.
  const workshopId = isRework
    ? (input.rework_workshop_id ?? (reworkMode === "onsite" ? await fallbackWorkshopId(supabase) : null))
    : null;

  const insertRow = (withOptional: boolean) => supabase
    .from("returns")
    .insert({
      // Driver (0151) + Pickup Date (0152) — manual migrations: kapag hindi pa
      // tumatakbo, babagsak ang unang insert sa unknown column at uulitin nang
      // wala ang mga optional na ito.
      ...(withOptional ? {
        // Nandoon na ang team (0209) — kukunin ngayon, laktawan ang planner.
        // KASAMA NA ANG REFUND (2026-09-01, "dapat pala mag add din tayo nung
        // function na ganto"): ang refund pull-out ay biyahe ring pareho — kung
        // nandoon pa ang team, isasakay na agad ang gamit.
        rework_pickup_onsite: (isRework || input.resolution === "refund") ? !!input.rework_pickup_onsite : false,
        // PAREHONG MODE (2026-08-28): sa pull-out, ito ang sumusundo ng sirang
        // gamit; sa on-site, ito ang pumupunta para kumpunihin doon mismo. Ang
        // dalawa ay biyahe, at kapwa kailangan ng team, driver at petsa — kung
        // wala, walang rutang mapupuntahan ang on-site visit.
        rework_pickup_driver: isRework ? (input.rework_pickup_driver?.trim() || null) : null,
        rework_pickup_date: isRework ? (input.rework_pickup_date || null) : null,
        // On-site repair crew (0155) — sanitized {id, name} list, max 20.
        rework_onsite_crew: isRework && reworkMode === "onsite"
          ? (input.rework_onsite_crew ?? []).slice(0, 20)
              .map((w) => ({ id: Number(w.id), name: String(w.name ?? "").trim() }))
              .filter((w) => Number.isFinite(w.id) && w.id > 0 && w.name)
          : null,
        // Aling team ang nagdeklara (0203) — ito ang naglalabas ng RMA sa
        // Returns/RMA page ng team na iyon.
        declared_team: source === "delivery" ? (input.declared_team?.trim() || null) : null,
      } : {}),
      return_no,
      type,
      order_id: type === "customer" ? (input.order_id ?? null) : null,
      po_id: type === "supplier" ? (input.po_id ?? null) : null,
      supplier: type === "supplier" ? (input.supplier?.trim() || null) : null,
      customer_name: input.customer_name?.trim() || null,
      item_desc: input.item_desc?.trim() || null,
      item_image: input.item_image?.trim() || null,
      sku: input.sku?.trim() || null,
      category: input.category?.trim() || null,
      color: input.color?.trim() || null,
      dimension: input.dimension?.trim() || null,
      qty,
      reason: input.reason?.trim() || null,
      item_condition: input.item_condition ?? null,
      resolution: input.resolution ?? null,
      refund_amount: Number.isFinite(refund_amount) && refund_amount > 0 ? refund_amount : 0,
      rework_target: isRework ? input.rework_target : null,
      rework_workshop_id: isRework ? workshopId : null,
      rework_pickup_team: isRework ? (input.rework_pickup_team?.trim() || null) : null,
      rework_mode: isRework ? reworkMode : null,
      // ANG SUOT (0217): on-site ang pinili sa form — kahit pull-out ang naging
      // laman — kaya "Rework on Site" ang mukha nito at sa Rework (On-Site)
      // ng team lumilitaw ang pagkuha.
      rework_declared_onsite: isRework && declaredMode === "onsite",
      rework_delivery_price: isRework ? deliveryPrice : 0,
      rework_parts: isRework ? reworkParts : [],
      rework_parts_total: isRework ? partsTotal : 0,
      rework_payment_method: isRework ? (input.rework_payment_method ?? "Cash") : null,
      // The rework's full charge = order balance + parts + delivery. The customer pays
      // a 50% downpayment on this before the rework proceeds (tracked below).
      rework_charge_total: isRework ? reworkCharge : 0,
      photos: input.photos ?? [],
      status: "Pending",
      source,
      requested_by: me.full_name,
    })
    .select("id")
    .single();
  let { data: ins, error } = await insertRow(true);
  if (error && /rework_pickup_(driver|date|onsite)|rework_onsite_crew|declared_team/i.test(error.message)) ({ data: ins, error } = await insertRow(false));
  if (error) return { error: error.message };

  await auditAfter({
    module: "returns",
    table: "returns",
    recordId: ins?.id ?? "—",
    action: "insert",
    snapshotTable: "returns",
    snapshotId: ins?.id,
  });
  // Push Operations — a return/defect was filed and needs approval.
  try {
    const { notifyReturnFiled } = await import("@/lib/push/notify");
    await notifyReturnFiled({
      rmaNo: return_no,
      orderNumber: input.customer_name?.trim() || null,
      reason: input.reason?.trim() || null,
      source,
    });
  } catch { /* best-effort */ }
  for (const p of revalidate) revalidatePath(p);
  return { ok: true, id: ins!.id as number, return_no };
}

// Staff declares a return (customer or supplier) FROM SALES (/returns). Assigns an
// RMA number, parks it Pending for a manager. requested_by comes from the SESSION.
export async function createReturn(
  input: CreateReturnInput,
): Promise<{ ok: true; id: number; return_no: string } | { error: string }> {
  const me = await requireEdit("/returns", "returns");
  // Source = where the declaration came from. Ang PAGE ang nagpapasa ng
  // declared_from: "delivery" mula sa team Returns/RMA dashboards (kahit anong
  // role ang naka-login doon). Fixed-role staff sa ibang page ay derived sa role;
  // admin/manager ay via declared_from (defaults to Sales).
  const source: "sales" | "warehouse" | "delivery" =
    input.declared_from === "delivery"
      ? "delivery"
      : me.role === "warehouse_staff"
        ? "warehouse"
        : me.role === "sales_staff"
          ? "sales"
          : input.declared_from === "warehouse"
            ? "warehouse"
            : "sales";
  return insertReturn(me, input, ["/returns", "/operations/returns"], source);
}

// Same declaration, but FROM THE DELIVERY module (/delivery). Lets the delivery
// team (warehouse_staff — who have /delivery but NOT /returns access) declare a
// return on the spot. Gated on /delivery so it doesn't expose the returns module.
export async function createReturnFromDelivery(
  input: CreateReturnInput,
): Promise<{ ok: true; id: number; return_no: string } | { error: string }> {
  const me = await requireEdit("/delivery", "delivery");
  return insertReturn(me, input, ["/returns", "/operations/returns", "/delivery"], "delivery");
}

// Manager approves a return → executes the resolution. The status flip is the lock:
// only one caller flips a row still 'Pending', so a concurrent/retried approval can't
// double-refund or double-restock. Refund uses the shared order_payments ledger
// (refundPayment), restock uses the race-safe fn_scan_apply RPC.
// I-SAVE ANG PULL-OUT SCHEDULE NANG HINDI PA NAG-A-APPROVE (2026-08-27).
//
// Ang plano ay ipinapasa lang kasama ng approve noon, kaya nawawala ang piniling
// workshop/team/driver/petsa kapag isinara ang modal — muling pinupuno tuwing
// bubuksan. Naitatala na ito ngayon nang mag-isa: mapupuno ito ng manager
// habang hinihintay ang bayad, at pag-approve ay iisang pindot na lang.
//
// Pending LANG ang ginagalaw: ang naaprubahan na ay may nakabitin nang pickup
// task at delivery row — ang pagpapalit doon ay iba nang usapin.
export async function saveReworkPickupPlan(
  id: number,
  plan: { workshopId?: number | null; team?: string | null; driver?: string | null; date?: string | null },
): Promise<{ ok: true } | { error: string }> {
  const session = await requireManager();
  const supabase = createServerSupabase();

  const patch: Record<string, unknown> = {};
  if (plan.workshopId !== undefined) patch.rework_workshop_id = plan.workshopId;
  if (plan.team !== undefined) patch.rework_pickup_team = plan.team?.trim() || null;
  if (plan.driver !== undefined) patch.rework_pickup_driver = plan.driver?.trim() || null;
  if (plan.date !== undefined) patch.rework_pickup_date = plan.date || null;
  if (!Object.keys(patch).length) return { ok: true };

  const before = await snapshot("returns", id);
  let { error } = await supabase.from("returns").update(patch).eq("id", id).eq("status", "Pending");
  // Ang driver/date ay optional na column (0151/0152) — kapag hindi pa tumakbo
  // ang migration, i-save ang natitira kaysa mabigo lahat.
  if (error && /rework_pickup_(driver|date)/i.test(error.message)) {
    const slim = { ...patch };
    delete slim.rework_pickup_driver; delete slim.rework_pickup_date;
    if (!Object.keys(slim).length) return { error: error.message };
    ({ error } = await supabase.from("returns").update(slim).eq("id", id).eq("status", "Pending"));
  }
  if (error) return { error: error.message };

  await audit({
    module: "returns", table: "returns", recordId: id, action: "update",
    before, after: { ...patch, by: session.full_name },
  });
  for (const p of ["/returns", "/operations/returns"]) revalidatePath(p);
  return { ok: true };
}

export async function approveReturn(
  id: number,
  // I-APPROVE KAHIT WALANG 50% DOWN. Ang buton na "Override — approve without
  // payment" ay walang paraang ipabatid ito noon, kaya bumabagsak ito sa
  // parehong harang at walang nangyayari. Pasyang may pananagutan ito: kung
  // sino ang nag-override ay naitatala.
  // BAYAD NG ON-SITE CREW (2026-08-25) — magkano ang tatanggapin ng bawat isa
  // sa pagkumpuning ito. Bukas ang presyo: nakadepende sa bigat ng trabaho, kaya
  // itinatakda ng aprubador kada tao. Pumupunta sa hr_project_work (Unpaid) —
  // kaparehong lalagyan ng QC/Constructor pay, kaya kusang lumalabas sa Payroll.
  // PULL-OUT SCHEDULE (2026-08-27): sa approval na itinatakda kung saang
  // workshop dadalhin at sinong team/driver/kailan kukunin — hindi na sa
  // declare. Ipinapasa ng review modal; naitatala sa row bago ang claim.
  opts?: {
    overridePayment?: boolean;
    crewPay?: { id: number; pay: number }[];
    pickup?: { workshopId?: number | null; team?: string | null; driver?: string | null; date?: string | null };
  },
): Promise<{ ok: true } | { error: string }> {
  // MANAGER-ONLY (admin / operations manager) — separate from the declaring staff.
  const session = await requireManager();
  const supabase = createServerSupabase();

  const before = await snapshot("returns", id);

  // Separation of duty: a NON-admin manager can't approve a return they declared.
  // Admins/owners are exempt — in a small shop one person often both declares and
  // approves, and the earlier block silently stopped every self-declared approval.
  if (!isAdmin(session.role)) {
    const { data: decl } = await supabase.from("returns").select("requested_by").eq("id", id).maybeSingle();
    if (decl && decl.requested_by && decl.requested_by === session.full_name) {
      return { error: "You declared this return — another manager must approve it." };
    }
  }

  // Itala muna ang pull-out schedule na pinili sa review — bago ang claim,
  // para ang claimed row (select *) ay may dala na nito pagpasok sa job at
  // delivery seeding sa ibaba. Ang driver/date ay optional na columns
  // (0151/0152) — kapag wala pa ang migration, uulitin nang wala ang mga iyon.
  if (opts?.pickup) {
    const p = opts.pickup;
    const full = {
      ...(p.workshopId !== undefined ? { rework_workshop_id: p.workshopId } : {}),
      ...(p.team !== undefined ? { rework_pickup_team: p.team?.trim() || null } : {}),
      ...(p.driver !== undefined ? { rework_pickup_driver: p.driver?.trim() || null } : {}),
      ...(p.date !== undefined ? { rework_pickup_date: p.date || null } : {}),
    };
    if (Object.keys(full).length) {
      const { error: upErr } = await supabase.from("returns").update(full).eq("id", id).eq("status", "Pending");
      if (upErr) {
        const slim = { ...full } as Record<string, unknown>;
        delete slim.rework_pickup_driver; delete slim.rework_pickup_date;
        if (Object.keys(slim).length) await supabase.from("returns").update(slim).eq("id", id).eq("status", "Pending");
      }
    }
  }
  // HARANG: ang pullout rework ay hindi maaaprubahan nang walang workshop at
  // pull-out team — sila ang tatanggap ng repair at kukuha ng gamit.
  {
    const { data: pre } = await supabase.from("returns")
      .select("resolution, rework_mode, rework_workshop_id, rework_pickup_team")
      .eq("id", id).maybeSingle();
    if (pre && /^rework$/i.test(String(pre.resolution ?? "")) && String(pre.rework_mode ?? "") === "pullout") {
      if (pre.rework_workshop_id == null) return { error: "Set the workshop to repair before approving." };
      if (!String(pre.rework_pickup_team ?? "").trim()) return { error: "Set the pull-out delivery team before approving." };
    }
    // ON-SITE: walang workshop na pupuntahan — sa bahay ng customer ito ginagawa.
    // Ang kailangan ay kung SINO ang pupunta at KAILAN: kung wala ang dalawa,
    // walang rutang mapapasukan ang bisita at walang team na may-ari nito
    // (2026-08-28).
    if (pre && /^rework$/i.test(String(pre.resolution ?? "")) && String(pre.rework_mode ?? "") === "onsite") {
      if (!String(pre.rework_pickup_team ?? "").trim()) return { error: "Set the on-site visit team before approving." };
    }
    // REFUND (customer) = laging may pull-out (2026-09-01): kailangan ng
    // workshop na magdodoble-check at ng team na kukuha — parehong hinihingi
    // ng pull-out rework.
    {
      const { data: preT } = await supabase.from("returns").select("type").eq("id", id).maybeSingle();
      if (pre && /^refund$/i.test(String(pre.resolution ?? "")) && String(preT?.type ?? "") === "customer") {
        if (pre.rework_workshop_id == null) return { error: "Set the workshop that will double-check the item before approving." };
        if (!String(pre.rework_pickup_team ?? "").trim()) return { error: "Set the pull-out delivery team before approving." };
      }
    }
  }

  // Atomic CLAIM: flip Pending → Approved and stamp the approver. Returns the fields
  // we need to execute the resolution — exactly one caller wins.
  const { data: claimed, error: claimErr } = await supabase
    .from("returns")
    .update({ status: "Approved", approved_by: session.full_name, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "Pending")
    // select("*") — defensive: ang mga optional na column (hal. rework_pickup_team,
    // 0146) ay dumarating sa magkakahiwalay na migrations; ang explicit list ay
    // nag-500 sa approve kapag hindi pa tumatakbo ang migration.
    .select("*");
  if (claimErr) return { error: claimErr.message };
  if (!claimed || claimed.length !== 1) return { error: "Already processed." };

  const r = claimed[0] as {
    id: number; return_no: string | null; type: string; order_id: number | null; customer_name: string | null;
    sku: string | null; item_desc: string | null; qty: number;
    category: string | null; color: string | null; dimension: string | null;
    item_condition: string | null; resolution: string | null; refund_amount: number;
    reason: string | null;
    refunded_at: string | null; restocked_at: string | null; scrapped_at: string | null;
    rework_target: string | null; rework_workshop_id: number | null; rework_job_id: number | null;
    rework_mode: string | null; rework_charge_total: number; rework_downpayment: number;
    rework_pickup_team: string | null;
  };
  const rma = r.return_no ?? `#${r.id}`;
  const notes: string[] = [];

  // REFUND = PULL-OUT LAGI (2026-09-01, finalized kay Joe): ang bawat refund ay
  // may kukunin — pera palabas AGAD sa approval, pero ang gamit ay nilalakad:
  // kunin sa customer (parehong Rework (Pull Out) na daan) → doble-check sa
  // workshop → declare bilang DIRECT STOCK → haul → Receiving QC → stock-in
  // bilang MALAYANG stock (walang Order # sa cubic, walang redelivery). Ang
  // RMA ay nagsasara sa stock-in, hindi dito.
  // Customer returns lang — ang supplier refund ay pera-sa-supplier, walang
  // pull-out sa bahay ng customer.
  const refundPull = r.resolution === "refund" && r.type === "customer";

  // GATE: a rework with a service charge (parts + delivery) needs a 50% downpayment
  // before it can proceed. Block approval until it's collected (via collectRework-
  // Payment), rolling the claim back to Pending so it can be approved later.
  if (r.resolution === "rework") {
    const charge = Number(r.rework_charge_total) || 0;
    const down = Number(r.rework_downpayment) || 0;
    if (charge > 0 && down + 0.005 < charge * 0.5) {
      if (!opts?.overridePayment) {
        await supabase.from("returns").update({ status: "Pending", approved_by: null, approved_at: null }).eq("id", id);
        return { error: `Collect the 50% rework downpayment first — ₱${(charge * 0.5).toFixed(2)} of ₱${charge.toFixed(2)} (paid ₱${down.toFixed(2)}).` };
      }
      // INIOVERRIDE. Ang buong balanse ay nananatili sa RMA at kinokolekta sa
      // redelivery — kaya naitatala kung sino ang nagpasya, at nasa audit.
      const by = (await getSession())?.full_name || "—";
      await supabase.from("returns").update({
        rework_payment_override_by: by,
        rework_payment_override_at: new Date().toISOString(),
      }).eq("id", id);
      await audit({
        module: "returns", table: "returns", recordId: id, action: "update",
        after: { payment_override: true, by, charge, paid: down, balance: charge - down },
      });
      notes.push(`Approved WITHOUT the 50% downpayment (override by ${by}) — ₱${(charge - down).toFixed(2)} collected on redelivery.`);
    }
  }

  // 0) REWORK: defective-but-fixable item → dispatch a workshop job to repair it; the
  //    restock/redeliver happens LATER via markReworked (don't put a broken item back
  //    in stock now). No refund, no PAN loss. Short-circuits before refund/restock/scrap.
  if (r.resolution === "rework" || refundPull) {
    // Ang refund pull-out ay laging pull-out — walang on-site na refund.
    const isOnsite = r.rework_mode === "onsite" && !refundPull;
    // Pull Out dispatches a workshop repair job; On Site is fixed at the customer, so
    // no workshop job — it just moves to Rework and markReworked closes it.
    if (!isOnsite && !r.rework_job_id) {
      // ANG WORKSHOP JOB AY HINDI NA GINAGAWA DITO — sa PICKUP DROP na (kapag
      // pisikal nang naihatid ang item sa workshop; /api/delivery/pickup-proof
      // leg 'drop'). Kaya ang rework job ay lilitaw sa My Jobs / Ops tracker
      // LAMANG kapag nasa workshop na talaga ang item.

      // PULL OUT needs the defective item COLLECTED from the customer first. Create a
      // pickup task in Delivery Scheduling (tagged "Pickup for Rework") + alert the
      // delivery team. The later redelivery is created on markReworked.
      const od = r.order_id
        ? (await supabase.from("orders").select("order_number, customer_name, address, contact_number, product_name").eq("id", r.order_id).maybeSingle()).data as
            { order_number: string | null; customer_name: string | null; address: string | null; contact_number: string | null; product_name: string | null } | null
        : null;
      // NANDOON NA ANG TEAM (0209). Nakita ang sira habang nasa bahay pa sila,
      // at kukunin nila ngayon din — nakaparada pa ang trak sa harap. Kaya ang
      // petsa ay NGAYON, hindi hinihintay pang pumili. Ang approval ay dumaan
      // pa rin: doon ang workshop at ang singil, at hindi iyon nilalaktawan.
      const onsiteNow = !!(r as Record<string, unknown>).rework_pickup_onsite;
      const pickupDate = onsiteNow
        ? todayPH()
        : (((r as Record<string, unknown>).rework_pickup_date as string | null) ?? null);
      const pickupRes = await saveDeliveryCore({
        order_id: r.order_id,
        order_number: od?.order_number ?? null,
        customer_name: od?.customer_name ?? r.customer_name ?? null,
        contact: od?.contact_number ?? null, address: od?.address ?? null, sales_rep: null,
        items_summary: `Pickup for Rework · ${rma} · ${(r.item_desc ?? "").split("\n")[0] || "item"}`,
        // Ang pull-out team + PICKUP DATE na pinili sa declaration — diretso sa
        // team's Pickup page na may schedule na.
        schedule_date: pickupDate,
        time_window: null, driver_team: r.rework_pickup_team ?? null, coordinator: null, vehicle_plate: null,
        // BAGONG GAMIT ng delivery row ng order (isa lang bawat order): linisin
        // ang lumang Delivered/Arrived state para maging malinis na pickup task.
        status: "Scheduled", repurpose: true,
      } as Parameters<typeof saveDeliveryCore>[0]);
      if (!("error" in pickupRes)) {
        await audit({ module: "returns", table: "deliveries", recordId: pickupRes.id, action: "insert", after: { rma, pickup: true } });
        // Ang pagkuha ay biyahe rin ng RMA na ito — ito ang may-ari ng row
        // hangga't hindi ito pinapalitan ng redelivery o ng ibang rework.
        await tagDeliveryOwner(supabase, pickupRes.id, id);
      }
      // PAPASOK SA ROUTE PLANNER (hiling 2026-08-28). Binubura ang dq_* noon
      // para hindi lumabas ang pickup bilang stop — pero iisang trak at iisang
      // araw pa rin ito: kung may tatlong hatid at isang pull-out pickup ang
      // team, tatlo lang ang nakikita ni Ops at hindi niya maisasama sa ruta
      // ang pagkuha. Ngayon ay `confirmed` agad ito (naaprubahan na ang RMA at
      // may petsa na — walang hihintaying pagsang-ayon ng customer), kaya
      // lumalabas ito sa planner na may REWORK · PULL OUT na tag, at doon
      // inaayos ni Ops ang pagkakasunod bago ipadala.
      //
      // Ang GAWAIN ay nananatili sa Rework (Pull Out) ng team: doon ang Pickup
      // Proof at ang Drop Proof, at ang mga gate na iyon ay hindi nagbago.
      // Ang planner ang nagsasabi KAILAN at SA ANONG PAGKAKASUNOD, hindi kung
      // paano gagawin.
      //
      // Ang order ay HINAHARANG pa rin sa Delivery Queue pool habang hindi
      // tapos ang repair (reworkHold sa loadDeliveryQueue), at babalik doon
      // pagkatapos ng QC para sa redelivery confirmation.
      const pickupDriver = ((r as Record<string, unknown>).rework_pickup_driver as string | null) ?? null;
      if (r.order_id && r.rework_pickup_team && pickupDate) {
        await supabase.from("orders").update({
          dq_status: "confirmed", dq_group: null, dq_date: pickupDate,
          dq_team: r.rework_pickup_team, dq_driver: pickupDriver,
          dq_sent_at: null, dq_confirmed_at: new Date().toISOString(),
          dq_reminder_sent_at: null, dq_followups: 0,
          // NILILINIS ANG FINALIZE (2026-08-28). Ang order ay may naunang
          // naihatid na, at nanatili ang `dq_route_final_at` niyon — kaya ang
          // bagong pickup ay mukhang naka-finalize na agad at diretsong lumalabas
          // sa ruta ng driver, nalalaktawan ang planner. BAGONG stop ito: si Ops
          // muna ang mag-aayos ng pagkakasunod bago ito maipadala.
          //
          // MALIBAN KUNG NANDOON NA SILA (0209): doon, ang pagdaan sa planner
          // ang siyang mali — nakaparada ang trak sa harap ng bahay, at ang
          // pila ay nangangahulugang babalik pa sila bukas. Naka-finalize agad.
          dq_route_final_at: onsiteNow ? new Date().toISOString() : null,
        }).eq("id", r.order_id);
      } else if (r.order_id) {
        // Walang team o walang petsa — walang mairurutang stop, kaya linisin
        // gaya ng dati sa halip na mag-iwan ng lumang booking na mali na.
        await supabase.from("orders").update({
          dq_status: null, dq_group: null, dq_date: null, dq_team: null, dq_driver: null,
          dq_sent_at: null, dq_confirmed_at: null, dq_reminder_sent_at: null, dq_followups: 0,
        }).eq("id", r.order_id);
      }
      try {
        const { notifyReworkPickup } = await import("@/lib/push/notify");
        await notifyReworkPickup({ rmaNo: rma, orderNumber: od?.order_number ?? null, product: od?.product_name ?? null, address: od?.address ?? null });
      } catch { /* best-effort */ }
    }
    // ON-SITE: ang item ay nasa customer, at doon ito kukumpunihin — kaya BIYAHE
    // ito, hindi gawaing naghihintay (2026-08-28).
    //
    // "Arrived" agad ang delivery row noon, kaya lumalabas kaagad sa
    // Installation Tracking — pero walang team at walang ruta, kaya walang
    // makapag-Waze papunta sa customer at walang team na may-ari ng gawain.
    //
    // Ngayon ay sinusundan nito ang landas ng normal na hatid: "Scheduled" na
    // may team at petsa, dq_* na `confirmed` para makapasok sa Route Planner, at
    // ang driver na mismo ang magmamarka ng Arrived sa mapa. Pagkatapos noon ay
    // nasa Installation Tracking na ito ng parehong team para sa warranty at
    // litrato — kapareho ng dinadaanan ng bawat install.
    if (isOnsite && r.order_id) {
      const od2 = (await supabase.from("orders")
        .select("order_number, customer_name, address, contact_number").eq("id", r.order_id).maybeSingle()).data as
        { order_number: string | null; customer_name: string | null; address: string | null; contact_number: string | null } | null;
      const visitTeam = r.rework_pickup_team ?? null;
      // NANDOON NA ANG CREW (0209) — kaparehong tuntunin ng pull-out: ngayon ito
      // nangyayari, kaya petsa ngayon at walang iruruta.
      const onsiteNowVisit = !!(r as Record<string, unknown>).rework_pickup_onsite;
      const visitDate = onsiteNowVisit
        ? todayPH()
        : (((r as Record<string, unknown>).rework_pickup_date as string | null) ?? null);
      const visitDriver = ((r as Record<string, unknown>).rework_pickup_driver as string | null) ?? null;
      const onsiteRes = await saveDeliveryCore({
        order_id: r.order_id,
        order_number: od2?.order_number ?? null,
        customer_name: od2?.customer_name ?? r.customer_name ?? null,
        contact: od2?.contact_number ?? null, address: od2?.address ?? null, sales_rep: null,
        items_summary: `Rework (on-site) · ${rma} · ${(r.item_desc ?? "").split("\n")[0] || "item"}`,
        schedule_date: visitDate, time_window: null, driver_team: visitTeam, coordinator: null, vehicle_plate: null,
        status: "Scheduled", repurpose: true,
      } as Parameters<typeof saveDeliveryCore>[0]);
      if (!("error" in onsiteRes)) {
        await supabase.from("returns").update({ rework_delivery_id: onsiteRes.id }).eq("id", id);
        await tagDeliveryOwner(supabase, onsiteRes.id, id);
        await audit({ module: "returns", table: "deliveries", recordId: onsiteRes.id, action: "insert", after: { rma, onsite: true } });
      }
      // PAPASOK SA ROUTE PLANNER. Diretso nang `confirmed`: naaprubahan na ang
      // RMA at may petsa at team na, kaya wala nang hihintaying pagsang-ayon ng
      // customer — ang natitira lang ay ang pag-aayos ng pagkakasunod ng Ops.
      // Ang `dq_final` ay hindi itinatakda dito: ang planner pa rin ang huling
      // magsasabi kung kailan ito ipapadala.
      if (visitTeam && visitDate) {
        await supabase.from("orders").update({
          dq_status: "confirmed", dq_date: visitDate, dq_team: visitTeam,
          dq_driver: visitDriver, dq_confirmed_at: new Date().toISOString(),
          // Gaya ng pull-out: ang lumang finalize ng naunang hatid ay
          // nagpapalabas nito agad sa ruta, kaya nililinis — bagong stop ito.
          // MALIBAN kung nandoon na sila: wala nang iruruta, kaya finalized agad.
          dq_route_final_at: onsiteNowVisit ? new Date().toISOString() : null,
        }).eq("id", r.order_id);
      }
      // WALANG WORKSHOP JOB ANG ON-SITE (2026-09-02, "onsite pero bakit nalabas
      // sa Rework Jobs"). Dating gumagawa rin ito ng rework job — hindi para sa
      // pisikal na repair kundi para sa QC declaration ng crew pay — pero ang
      // 0196 ang bumabayad na ngayon sa crew nang diretso sa hr_project_work sa
      // mismong approval (tingnan sa ibaba), kaya ang job ay (a) kalabisan,
      // (b) nakabimbin magpakailanman sa Rework Jobs ng workshop na walang
      // gagawin doon, at (c) panganib ng DOBLENG bayad kapag idineklara ulit
      // ang crew sa QC. Sa customer ang ayos; walang pumapasok sa workshop.
    }
    // BAYAD NG ON-SITE CREW (0196) — ang halagang itinakda ng aprubador kada tao
    // ay pumapasok sa hr_project_work bilang Unpaid, kaparehong lalagyan ng QC at
    // Constructor pay, kaya kusang nakukuha ng Payroll sa Sabado. Ang
    // rework_crew_paid_at ang pumipigil sa doble: ang aprubahan ay maaaring
    // maulit (retry, doblehang pindot), ang payroll row ay hindi dapat.
    let crewPaid = 0;
    if (isOnsite && !(claimed[0] as Record<string, unknown>).rework_crew_paid_at) {
      const crewRows = Array.isArray((claimed[0] as Record<string, unknown>).rework_onsite_crew)
        ? ((claimed[0] as Record<string, unknown>).rework_onsite_crew as { id?: unknown; name?: unknown; pay?: unknown }[])
        : [];
      // Ang halaga mula sa aprubador ang nananaig; kung wala, ang nakasakay na sa row.
      const byId = new Map((opts?.crewPay ?? []).map((c) => [Number(c.id), Math.max(Number(c.pay) || 0, 0)]));
      const workDate = todayPH();
      const orderNo = r.order_id
        ? ((await supabase.from("orders").select("order_number").eq("id", r.order_id).maybeSingle()).data?.order_number as string | null) ?? null
        : null;
      // ANG HULMA NG PAYROLL (hr-projects-manager): ang project_name ay ang BUONG
      // item — pangalan sa unang linya, spec sa mga sumunod bilang bullet — at ang
      // uri ng trabaho ay ang huling bahagi ng description pagkatapos ng em-dash.
      // Nabaligtad ito: "Rework · RMA-000002" ang lumabas na PRODUCT NAME, at
      // "Costumized Bed" ang naging WORK.
      const itemName = (r.item_desc ?? "").split("\n")[0] || "Rework";
      const specLines = (r.item_desc ?? "").split("\n").slice(1)
        .map((l) => l.trim().replace(/^[•·-]\s*/, "")).filter(Boolean);
      const projectName = [itemName, ...specLines.map((l) => `• ${l}`)].join("\n");
      const merged = crewRows.map((w) => ({
        id: Number(w?.id),
        name: String(w?.name ?? "").trim(),
        pay: byId.has(Number(w?.id)) ? byId.get(Number(w?.id))! : Math.max(Number(w?.pay) || 0, 0),
      })).filter((w) => Number.isFinite(w.id) && w.id > 0 && w.name);

      for (const w of merged) {
        if (w.pay <= 0) continue; // walang ₱0 na payroll row
        const { error: pwErr } = await supabase.from("hr_project_work").insert({
          employee_id: w.id,
          project_name: projectName,
          order_number: orderNo,
          rate: w.pay, ot: 0,
          // Ang uri ng trabaho ay HULI, pagkatapos ng em-dash — iyon ang
          // hinahanap ng WORK na hanay. Nauuna ang RMA para makita kung saang
          // pagkumpuni galing ang bayad.
          description: `${rma} — On-site repair`,
          amount: w.pay,
          work_date: workDate,
          status: "Unpaid",
        });
        if (pwErr) return { error: pwErr.message };
        crewPaid += w.pay;
      }
      // Isulat pabalik ang halaga (para makita sa review) at ang bakas. Ang
      // bakas ay dumarating sa 0196; hangga't hindi pa naipatakbo, ang halaga
      // pa rin ang naisusulat — huwag ipabagsak ang buong aprubahan dahil sa
      // hanay na wala pa.
      if (merged.length) {
        const { error: upErr } = await supabase.from("returns").update({
          rework_onsite_crew: merged,
          ...(crewPaid > 0 ? { rework_crew_paid_at: new Date().toISOString() } : {}),
        }).eq("id", id);
        if (upErr && /rework_crew_paid_at/.test(upErr.message)) {
          await supabase.from("returns").update({ rework_onsite_crew: merged }).eq("id", id);
        }
      }
    }
    notes.push(isOnsite
      ? `On-site repair → straight to Installation; completing it closes the rework.${crewPaid > 0 ? ` Crew pay ₱${crewPaid.toLocaleString("en-PH", { minimumFractionDigits: 2 })} recorded to payroll.` : " Workshop declares the repair crew for pay after."} No refund, no loss.`
      : refundPull
      ? `Refund pull-out → pickup task created + delivery team alerted → workshop double-check → declared as DIRECT STOCK → back in free stock at Receiving QC (closes this RMA). Refund posts now.`
      : `Pulled out → pickup task created + delivery team alerted → workshop repair → auto-redelivery via the Delivery Queue after QC. No refund, no loss.`);
    // Pull-out: status stays in-progress (Rework) — ang QC ang awtomatikong
    // magre-redeliver. On-site: tapos na ang paperwork sa approve pa lang.
    await supabase.from("returns").update(
      isOnsite
        ? { status: "Completed", reworked_at: new Date().toISOString(), notes: notes.join(" ") }
        // Ang refund ay walang mode mula sa declare — itinatatak dito bilang
        // pullout para pareho ang basa ng Rework Tracker at ng team pages.
        : { status: "Rework", notes: notes.join(" "), ...(refundPull ? { rework_mode: "pullout" } : {}) },
    ).eq("id", id);
    await auditAfter({ module: "returns", table: "returns", recordId: id, action: "status_change", before, snapshotTable: "returns", snapshotId: id });
    revalidatePath("/returns");
    revalidatePath("/operations/returns");
    // Rework dispatched a workshop_job → refresh every route that lists jobs.
    revalidatePath("/operations/approval");
    revalidatePath("/operations/tracker");
    revalidatePath("/workshop");
    revalidatePath("/workshop/jobs");
    revalidatePath("/workshop/inventory");
    revalidatePath("/workshop/requests");
    revalidatePath("/workshop/quality-control");
    revalidatePath("/quality-control");
    revalidatePath("/delivery");
    revalidatePath("/installation");
    // Ang REFUND pull-out ay TULOY sa ibaba — ang pera ay pumapasok pa rin sa
    // mismong approval na ito; ang biyahe lang ang naitakda dito sa itaas.
    if (!refundPull) return { ok: true };
  }

  // Whether ANY committed side effect has run this approval. If a step fails BEFORE
  // anything committed, we can safely roll the claim back to Pending. Once a refund or
  // restock has committed (this approval OR a prior partial one), we must NOT roll back
  // — we keep status 'Approved' and ask the manager to retry, and the per-effect
  // refunded_at/restocked_at stamps make the retry skip what's already done.
  let sideEffectCommitted = !!(r.refunded_at || r.restocked_at);

  // Roll the claim back to Pending — ONLY safe when no side effect has committed yet.
  const rollbackPending = async (msg: string) => {
    await supabase.from("returns")
      .update({ status: "Pending", approved_by: null, approved_at: null })
      .eq("id", id);
    return { error: msg };
  };

  // Leave status 'Approved' (a side effect already committed), record the failure so a
  // retry RE-RUNS only the not-yet-done effects (guarded by the *_at stamps).
  const failKeepApproved = async (msg: string) => {
    notes.push(`side-effect error: ${msg} — retry approval to finish`);
    await supabase.from("returns")
      .update({ status: "Approved", notes: notes.join(" ") })
      .eq("id", id);
    return { error: msg };
  };

  // 1) RESOLUTION: customer refund → negative order_payments row (PAN income reversal).
  //    Idempotent: skip if a prior approval already stamped refunded_at. Cap the refund
  //    at the amount actually paid so the ledger / PAN can't go negative — never trust
  //    the stored refund_amount.
  if (r.resolution === "refund" && r.type === "customer" && r.order_id != null) {
    // ANG APPROVAL AY PAHINTULOT, HINDI PA ANG PADALA (2026-09-01, "approval
    // palang wala pa ung action ng refund mismo"): dito ay HINDI pa lumalabas
    // ang pera. Ang RMA ay lumilitaw sa Payment Approval -> Refunds bilang TO
    // PAY; kapag naipadala na ang pera sa customer, doon ito minamarkahang
    // refunded (markRefundPaid) - saka lang papasok ang PAN Overall expense at
    // ang refunded_at. Walang galaw sa ledger ng order kahit kailan.
    if (r.refunded_at) {
      notes.push("Refund payout already recorded (idempotent skip).");
    } else {
      const requested = Number(r.refund_amount) || 0;
      if (requested <= 0) {
        notes.push("Refund amount is 0 - nothing to pay out.");
      } else {
        notes.push(`Refund payout of ₱${requested.toFixed(2)} is TO PAY - send the money to the customer, then mark it refunded on Payment Approval -> Refunds. The order's ledger is untouched.`);
      }
    }
  } else if (r.resolution === "replacement") {
    // We do NOT auto-create a replacement order (too complex). Leave it for a manual step.
    notes.push("Replacement pending — create the new order manually, then link it.");
  }

  // 2) RESTOCK: resaleable items go back into inventory. Defective items are NOT
  //    restocked (scrap / defect). Idempotent: skip if already stamped. Only
  //    auto-restock on an EXACT sku match — never fuzzy product-name match
  //    (that can restock an unrelated SKU). No sku → manual restock note.
  //
  //    HINDI KASAMA ANG REWORK (2026-09-01): ang inayos na unit ay pumapasok sa
  //    istante sa Receiving QC stock-in (o dinadala nang direkta sa customer) —
  //    ang restock sa mismong approval ay DUMOBLE ng bilang: +1 dito habang ang
  //    gamit ay nasa customer pa, tapos +1 ulit sa stock-in. Ito ang pinagmulan
  //    ng mga multong sobra sa SOFA-000001 noong mga unang rework test.
  //    HINDI RIN ANG REFUND PULL-OUT: ang balik nito sa istante ay sa Receiving
  //    QC stock-in ng direct-stock declare — hindi dito.
  if (r.item_condition === "resaleable" && r.resolution !== "rework" && !refundPull) {
    if (r.restocked_at) {
      notes.push("Restock already applied (idempotent skip).");
    } else {
      const qty = Number(r.qty) || 0;
      if (!(qty > 0)) {
        notes.push("Resaleable but quantity is 0 — nothing to restock.");
      } else if (!r.sku) {
        notes.push(`Manual restock needed — no SKU match for '${(r.item_desc ?? "").split("\n")[0] || "item"}'`);
      } else {
        const invRow = await findInventoryRow<{ id: number; product_name: string | null; sku: string | null; oh_inv: number | null }>(supabase, r.sku, lineColor(r.item_desc), "id, product_name, sku, color, oh_inv");
        if (!invRow) {
          notes.push(`Manual restock needed — no inventory row for SKU '${r.sku}'.`);
        } else {
          const inv = invRow as { id: number; product_name: string | null; sku: string | null; oh_inv: number | null };
          const beforeQty = Number(inv.oh_inv ?? 0);
          const { error: rpcErr } = await supabase.rpc("fn_scan_apply", { p_id: inv.id, p_qty: qty, p_dir: 1 });
          if (rpcErr) {
            // refund (if any) already committed for this RMA → never roll back to Pending.
            return sideEffectCommitted ? failKeepApproved(rpcErr.message) : rollbackPending(rpcErr.message);
          }
          // Movement-log row (mirrors the scan station's received_parts shape). The stock
          // number was already applied atomically above, so a failed audit-log insert must
          // NOT fail the whole approval — but it can't be silently dropped either: surface it
          // in logs and add a note so the missing movement row is reconcilable.
          const { error: logErr } = await supabase.from("received_parts").insert({
            product_name: inv.product_name,
            sku: inv.sku,
            direction: "in",
            qty,
            qty_before: beforeQty,
            qty_after: beforeQty + qty,
            users: `Return restock · ${rma} · ${session.full_name}`,
          });
          if (logErr) {
            console.error("approveReturn: restock movement-log insert failed", { id, rma, sku: inv.sku, err: logErr.message });
            notes.push(`Restock applied but movement-log insert failed (${logErr.message}) — reconcile stock-movements manually.`);
          }
          // Stamp only after the restock actually happened.
          await supabase.from("returns").update({ restocked_at: new Date().toISOString() }).eq("id", id);
          sideEffectCommitted = true;
          await audit({ module: "returns", table: "received_parts", recordId: inv.id, action: "insert", after: { restock: qty, rma } });
        }
      }
    }
  } else if (r.item_condition === "defective") {
    notes.push("Item marked defective — not restocked (scrap / defect).");
    // DEFECT WRITE-OFF: record the scrapped item's COST as a countable loss (separate
    // from any customer refund). Idempotent via the scrapped_at stamp so a retry after a
    // later failure can't double-record. The cost is the production/purchase cost from the
    // `product` table (joined by exact sku); missing sku/product → 0 (qty trail still kept).
    if (r.scrapped_at) {
      notes.push("Defect write-off already recorded (idempotent skip).");
    } else {
      const qty = Number(r.qty) || 0;
      let unitCost = 0;
      let productName: string | null = null;
      if (r.sku) {
        const prod = (await supabase.from("product")
          .select("product_name, cost").eq("sku", r.sku).limit(1)).data?.[0] as
          { product_name: string | null; cost: number | null } | undefined;
        unitCost = Number(prod?.cost ?? 0) || 0;
        productName = prod?.product_name ?? null;
      }
      const loss = Math.round(qty * unitCost * 100) / 100;
      const { data: woIns, error: woErr } = await supabase.from("defect_writeoffs").insert({
        return_id: r.id,
        return_no: r.return_no,
        sku: r.sku,
        product_name: productName ?? (r.item_desc ? r.item_desc.split("\n")[0] : null),
        item_desc: r.item_desc,
        qty,
        unit_cost: unitCost,
        loss_amount: loss,
        reason: r.reason,
        written_off_by: session.full_name,
      }).select("id").single();
      if (woErr) {
        // No stock/refund change in this branch beyond the writeoff itself; if a refund
        // already committed for this RMA we must NOT roll back to Pending.
        return sideEffectCommitted ? failKeepApproved(woErr.message) : rollbackPending(woErr.message);
      }
      // Stamp only after the write-off actually committed.
      await supabase.from("returns").update({ scrapped_at: new Date().toISOString() }).eq("id", id);
      sideEffectCommitted = true;
      notes.push(`Defect write-off recorded — loss ₱${loss.toFixed(2)} (${qty} × ₱${unitCost.toFixed(2)}).`);
      await audit({ module: "returns", table: "defect_writeoffs", recordId: woIns?.id ?? r.id, action: "insert", after: { return_no: r.return_no, sku: r.sku, qty, unit_cost: unitCost, loss_amount: loss, rma } });
    }
  }

  // 3) Finalize: 'Completed' unless a manual step remains (replacement to be
  //    created), o ang refund pull-out — BUKAS pa iyon (status Rework) hanggang
  //    ang gamit ay makuha, ma-doble-check, at maka-stock-in sa Receiving QC.
  const finalStatus = refundPull ? "Rework" : r.resolution === "replacement" ? "Approved" : "Completed";
  await supabase.from("returns")
    .update({ status: finalStatus, notes: notes.length ? notes.join(" ") : null })
    .eq("id", id);

  await auditAfter({
    module: "returns",
    table: "returns",
    recordId: id,
    action: "status_change",
    before,
    snapshotTable: "returns",
    snapshotId: id,
  });
  void sideEffectCommitted;
  revalidatePath("/returns");
  revalidatePath("/operations/returns");
  revalidatePath("/inventory");
  revalidatePath("/inventory/adjustments");
  revalidatePath("/stock-movements");
  revalidatePath("/scan");
  revalidatePath("/quality-control");
  revalidatePath("/products");
  revalidatePath("/locations");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  if (r.order_id) revalidatePath(`/orders/${r.order_id}`);
  return { ok: true };
}

// Manager rejects a return — no side effects. Atomic claim so a concurrent approve
// can't also fire.
export async function rejectReturn(id: number, reason?: string): Promise<{ ok: true } | { error: string }> {
  // MANAGER-ONLY (admin / operations manager) — separate from the declaring staff.
  const session = await requireManager();
  const supabase = createServerSupabase();

  // Separation of duty: the declarer may not reject their own return either.
  const { data: decl } = await supabase.from("returns").select("requested_by").eq("id", id).maybeSingle();
  if (decl && decl.requested_by && decl.requested_by === session.full_name) {
    return { error: "You declared this return — another manager must decide it." };
  }

  const before = await snapshot("returns", id);
  const { data: claimed, error } = await supabase
    .from("returns")
    .update({
      status: "Rejected",
      approved_by: session.full_name,
      approved_at: new Date().toISOString(),
      notes: reason?.trim() || null,
    })
    .eq("id", id)
    .eq("status", "Pending")
    .select("id");
  if (error) return { error: error.message };
  if (!claimed || claimed.length !== 1) return { error: "Already processed." };

  await auditAfter({
    module: "returns",
    table: "returns",
    recordId: id,
    action: "status_change",
    before,
    snapshotTable: "returns",
    snapshotId: id,
  });
  revalidatePath("/returns");
  revalidatePath("/operations/returns");
  return { ok: true };
}

// Manager marks a Rework return as FIXED — applies the chosen target (restock or
// redeliver) and completes the return. Idempotent via reworked_at. No refund, no
// PAN loss (the item was recovered). Manager-only.
export async function markReworked(id: number): Promise<{ ok: true } | { error: string }> {
  const session = await requireManager();
  const supabase = createServerSupabase();
  const before = await snapshot("returns", id);

  // Claim: only act on a row still in 'Rework' with no reworked_at (one winner).
  const { data: claimed, error: claimErr } = await supabase
    .from("returns")
    .select("id, return_no, type, order_id, customer_name, sku, item_desc, qty, rework_target, reworked_at, status, rework_mode")
    .eq("id", id).eq("status", "Rework").maybeSingle();
  if (claimErr) return { error: claimErr.message };
  if (!claimed) return { error: "Not in rework, or already completed." };
  const r = claimed as {
    id: number; return_no: string | null; type: string; order_id: number | null; customer_name: string | null;
    sku: string | null; item_desc: string | null; qty: number; rework_target: string | null; reworked_at: string | null;
    rework_mode: string | null;
  };
  const isOnsite = r.rework_mode === "onsite";
  if (r.reworked_at) return { error: "Already applied." };
  const rma = r.return_no ?? `#${r.id}`;
  const notes: string[] = [];

  if (r.rework_target === "redeliver") {
    // Create a delivery for the source order. PULL OUT → a normal delivery that goes
    // through the Delivery module (schedule → out for delivery → arrive → Installation).
    // ON SITE → the item never left the customer, so mark the delivery "Arrived"
    // immediately: it skips scheduling/delivery and lands straight in Installation.
    if (!r.order_id) return { error: "Redeliver needs the source order." };
    const o = (await supabase.from("orders")
      .select("order_number, customer_name, address").eq("id", r.order_id).maybeSingle()).data as
      { order_number: string | null; customer_name: string | null; address: string | null } | null;
    const res = await saveDeliveryCore({
      order_id: r.order_id,
      order_number: o?.order_number ?? null,
      customer_name: o?.customer_name ?? r.customer_name ?? null,
      contact: null, address: o?.address ?? null, sales_rep: null,
      items_summary: `Rework ${isOnsite ? "(on-site)" : "redelivery"} · ${rma} · ${(r.item_desc ?? "").split("\n")[0] || "item"}`,
      schedule_date: null, time_window: null, driver_team: null, coordinator: null, vehicle_plate: null,
      // Repurpose: ang row ay galing sa pickup leg (Arrived na) — i-reset para
      // ang redelivery ay magsimula nang malinis (Scheduled), o Arrived agad
      // kung on-site (hindi umalis ang item sa customer).
      status: isOnsite ? "Arrived" : "Scheduled", repurpose: true,
    } as Parameters<typeof saveDeliveryCore>[0]);
    if ("error" in res) return { error: res.error };
    await supabase.from("returns").update({ rework_delivery_id: res.id }).eq("id", id);
    await tagDeliveryOwner(supabase, res.id, id);
    // PULL-OUT redelivery: dumadaan ULIT sa buong Delivery Queue confirmation
    // process (For Scheduling → confirmation email → Confirm → Route Planner →
    // Send) — kaya nire-reset ang dq_* ng order para bumalik ito sa For
    // Scheduling pool, hindi diretsong naka-schedule. On-site ay hindi kasama
    // (Arrived agad → installation).
    if (!isOnsite) {
      await supabase.from("orders").update({
        dq_status: null, dq_group: null, dq_date: null, dq_team: null, dq_driver: null,
        dq_sent_at: null, dq_confirmed_at: null, dq_reminder_sent_at: null, dq_followups: 0,
        // Pati ang finalize (2026-08-28): kung mananatili ang luma, ang
        // redelivery ay mukhang naruruta na at diretsong lumalabas sa driver —
        // nalalaktawan ang confirmation at ang planner na dapat nitong daanan.
        dq_route_final_at: null,
      }).eq("id", r.order_id);
    }
    notes.push(isOnsite
      ? `On-site repair done → ready for installation (delivery #${res.id}, marked arrived).`
      : `Reworked → back in the Delivery Queue for confirmation + routing (delivery #${res.id}).`);
    await audit({ module: "returns", table: "deliveries", recordId: res.id, action: "insert", after: { rma, order_id: r.order_id, onsite: isOnsite } });
  } else {
    // restock — reuse the exact restock path (exact SKU → fn_scan_apply + received_parts).
    const qty = Number(r.qty) || 0;
    if (!(qty > 0)) {
      notes.push("Reworked but quantity is 0 — nothing to restock.");
    } else if (!r.sku) {
      notes.push("Reworked — manual restock needed (no SKU).");
    } else {
      const invRow = await findInventoryRow<{ id: number; product_name: string | null; sku: string | null; oh_inv: number | null }>(supabase, r.sku, lineColor(r.item_desc), "id, product_name, sku, color, oh_inv");
      if (!invRow) {
        notes.push(`Reworked — manual restock needed (no inventory row for SKU '${r.sku}').`);
      } else {
        const inv = invRow as { id: number; product_name: string | null; sku: string | null; oh_inv: number | null };
        const beforeQty = Number(inv.oh_inv ?? 0);
        const { error: rpcErr } = await supabase.rpc("fn_scan_apply", { p_id: inv.id, p_qty: qty, p_dir: 1 });
        if (rpcErr) return { error: rpcErr.message };
        const { error: logErr } = await supabase.from("received_parts").insert({
          product_name: inv.product_name, sku: inv.sku, direction: "in", qty,
          qty_before: beforeQty, qty_after: beforeQty + qty,
          users: `Rework restock · ${rma} · ${session.full_name}`,
        });
        if (logErr) notes.push(`Restock applied but movement-log insert failed (${logErr.message}) — reconcile manually.`);
        notes.push(`Reworked → restocked ${qty} to inventory.`);
        await audit({ module: "returns", table: "received_parts", recordId: inv.id, action: "insert", after: { restock: qty, rma } });
      }
    }
  }

  await supabase.from("returns")
    .update({ status: "Completed", reworked_at: new Date().toISOString(), notes: notes.join(" ") })
    .eq("id", id);
  await auditAfter({ module: "returns", table: "returns", recordId: id, action: "status_change", before, snapshotTable: "returns", snapshotId: id });
  revalidatePath("/returns");
  revalidatePath("/operations/returns");
  revalidatePath("/inventory");
  revalidatePath("/delivery");
  // Redeliver creates a delivery; restock writes inventory + received_parts.
  revalidatePath("/installation");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/inventory/adjustments");
  revalidatePath("/stock-movements");
  revalidatePath("/scan");
  revalidatePath("/quality-control");
  revalidatePath("/products");
  revalidatePath("/locations");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  return { ok: true };
}

// Collect a payment toward a rework's service charge (parts + delivery). Any signed-in
// staff can record it in-store; a rework can't be approved until its downpayment
// reaches 50% of the charge. amount is added to what's already collected, capped at
// the charge so it can't overpay. method = Email QR / Cash / Terminal (label only).
export async function collectReworkPayment(
  returnId: number,
  amount: number,
  method: string,
  // Kapag galing sa PAYMENT APPROVAL (0195): ang naka-login ay ang APRUBADOR,
  // hindi ang kumolekta — kaya ipinapasa ng approve ang pangalan ng installer na
  // nag-submit. Walang laman = ang naka-login ang kumolekta (direktang daan).
  collectedByArg?: string | null,
): Promise<{ ok: true; downpayment: number; charge: number } | { error: string }> {
  try {
    // ANG NAKA-LOGIN ANG KUMUKOLEKTA — hindi na itinatanong. May "Collected by"
    // na field noon na hindi naipapadala kahit saan: tinitipa at nawawala.
    const me = await getSession();
    if (!me) return { error: "Forbidden." };
    const db = createServerSupabase();
    const { data: r } = await db.from("returns")
      .select("id, return_no, order_id, customer_name, resolution, rework_mode, rework_parts, rework_delivery_price, rework_charge_total, rework_downpayment, item_desc, sku").eq("id", returnId).maybeSingle();
    if (!r) return { error: "Return not found." };
    if (r.resolution !== "rework") return { error: "Not a rework." };
    const charge = Number(r.rework_charge_total) || 0;
    if (charge <= 0) return { error: "This rework has no service charge to collect." };
    const already = Number(r.rework_downpayment) || 0;
    const add = Math.max(Number(amount) || 0, 0);
    if (add <= 0) return { error: "Enter an amount to collect." };
    const downpayment = Math.min(Math.round((already + add) * 100) / 100, charge);
    const { error } = await db.from("returns").update({
      rework_downpayment: downpayment,
      rework_payment_method: method || "Cash",
      rework_collected_by: collectedByArg?.trim() || me.full_name || me.email || null,
      rework_paid_at: r.rework_downpayment ? undefined : new Date().toISOString(),
    }).eq("id", returnId);
    if (error) return { error: error.message };
    await audit({ module: "returns", table: "returns", recordId: returnId, action: "update", after: { rework_payment: add, method, downpayment, charge } });

    // Rework email — QR sends a payment request (50% due); Cash/Terminal sends a
    // receipt. Needs the customer's email (from the linked order). Best-effort.
    try {
      // Ang email/resibo ay kumukuwenta na ng hatian mula sa singil, kaya email
      // lang ang kailangan dito. Ang balanse ng order na kinukuha NGAYON ay mali
      // pa nga: pagkatapos maitala ang bayad, 0 na ito, kaya nawawala ang
      // "Remaining order balance" sa mismong resibong nagpapatunay na binayaran.
      let email: string | null = null;
      if (r.order_id) {
        const { data: o } = await db.from("orders").select("email").eq("id", r.order_id).maybeSingle();
        email = (o?.email as string | null) ?? null;
      }
      {
        const parts = ((r.rework_parts as { part: string; qty: number; amount: number }[] | null) ?? [])
          .map((p) => ({ part: p.part, qty: Number(p.qty) || 1, amount: Number(p.amount) || 0 }));
        const { sendReworkEmail } = await import("@/lib/orders/internal");
        const isQr = /qr/i.test(method);
        // Laging tawagin — ang slip attachment sa order gallery ay tumatakbo kahit
        // walang email; ang email mismo ay nagla-laktaw kapag walang address.
        const payload = {
          to: email ?? "",
          orderId: (r.order_id as number | null) ?? null,
          customerName: (r.customer_name as string | null) ?? null,
          rmaNo: (r.return_no as string | null) ?? `#${r.id}`,
          mode: (r.rework_mode as "onsite" | "pullout" | null) ?? "onsite",
          itemDesc: (r.item_desc as string | null) ?? null,
          itemSku: (r.sku as string | null) ?? null,
          parts,
          deliveryPrice: Number(r.rework_delivery_price) || 0,
          chargeTotal: charge,
          amountDue: Math.round(charge * 0.5 * 100) / 100,
          collected: downpayment,
          method,
        };
        if (isQr) {
          await sendReworkEmail(payload, "qr");
        } else {
          // Bayad na-record (Cash/Terminal) → DALAWANG email tulad ng normal
          // orders: Acknowledgement Receipt + Rework (official) Receipt.
          await sendReworkEmail(payload, "ack");
          await sendReworkEmail(payload, "receipt");
        }
      }
    } catch { /* email is best-effort */ }

    revalidatePath("/returns");
    revalidatePath("/operations/returns");
    return { ok: true, downpayment, charge };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to record the rework payment." };
  }
}

// Kunin ang NAKA-IMBAK na rework QR body nang diretso — ang review modal ay
// bumubukas mula sa page-load na data na maaaring luma pa (bago pa naideklara
// ang QR session), kaya kinukuha ito nang sariwa para AGAD lumabas ang QR.
export async function loadReworkQrBody(returnId: number): Promise<string | null> {
  try {
    const db = createServerSupabase();
    const { data } = await db.from("returns").select("rework_qr_body").eq("id", returnId).maybeSingle();
    return ((data as { rework_qr_body?: string | null } | null)?.rework_qr_body as string | null) ?? null;
  } catch {
    return null;
  }
}

// ── MULING GAWIN ANG SLIP NG REWORK (2026-08-25) ────────────────────────────
// Ang resibo ay isang NAKA-IMBAK na SVG sa gallery ng order (transaction_images),
// ginawa sa sandali ng koleksyon — hindi sa bawat pagbukas. Kaya ang mga slip na
// nauna sa isang pag-aayos ay nananatiling mali habang buhay: ang RMA-000001 ay
// may nakalistang "1x Delivery (redeliver) ₱2,000.00" lang sa ilalim ng "TOTAL
// ₱3,400.70", walang balanse, walang pangalan ng kasangkapan.
//
// Muling ginagawa nito ang slip mula sa kasalukuyang datos at PINAPALITAN ang
// luma sa gallery (hindi nagdaragdag ng pangalawa — nakakalito ang dalawang
// resibo para sa isang bayad).
export async function regenerateReworkSlip(returnId: number): Promise<{ ok: true; url: string } | { error: string }> {
  try {
    const me = await getSession();
    if (!me || !isAdmin(me.role)) return { error: "Not allowed." };
    const db = createServerSupabase();
    const { data: r } = await db.from("returns")
      .select("id, return_no, order_id, customer_name, resolution, rework_mode, rework_parts, rework_delivery_price, rework_charge_total, rework_downpayment, rework_payment_method, rework_collected_by, item_desc, sku")
      .eq("id", returnId).maybeSingle();
    if (!r) return { error: "Return not found." };
    if (r.resolution !== "rework") return { error: "Not a rework." };
    if (r.order_id == null) return { error: "This RMA has no linked order." };

    const rmaNo = (r.return_no as string | null) ?? `RMA${r.id}`;
    const charge = Number(r.rework_charge_total) || 0;
    const { renderReworkReceiptSvg } = await import("@/lib/bir/rework-receipt");
    const { data: slipOrd } = await db.from("orders").select("order_number").eq("id", r.order_id).maybeSingle();
    const svg = renderReworkReceiptSvg({
      customerName: (r.customer_name as string | null) ?? null,
      rmaNo,
      orderNo: (slipOrd?.order_number as string | null) ?? null,
      collectedBy: ((r as Record<string, unknown>).rework_collected_by as string | null) ?? null,
      mode: (r.rework_mode as "onsite" | "pullout" | null) ?? "onsite",
      itemDesc: (r.item_desc as string | null) ?? null,
      itemSku: (r.sku as string | null) ?? null,
      parts: ((r.rework_parts as { part: string; qty: number; amount: number }[] | null) ?? [])
        .map((p) => ({ part: p.part, qty: Number(p.qty) || 1, amount: Number(p.amount) || 0 })),
      deliveryPrice: Number(r.rework_delivery_price) || 0,
      chargeTotal: charge,
      amountDue: Math.round(charge * 0.5 * 100) / 100,
      collected: Number(r.rework_downpayment) || 0,
      method: (r.rework_payment_method as string | null) ?? null,
    }, "receipt");

    const BUCKET = "product-images";
    const safe = rmaNo.replace(/[^a-z0-9_-]/gi, "");
    const path = `rework-receipts/${safe}/${Date.now()}-rework.svg`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, Buffer.from(svg), { contentType: "image/svg+xml", upsert: false });
    if (upErr) return { error: upErr.message };
    const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    // Palitan ang luma, huwag dagdagan: alisin ang bawat slip ng RMA na ito.
    const { data: cur } = await db.from("orders").select("transaction_images").eq("id", r.order_id).maybeSingle();
    const existing = ((cur?.transaction_images as string[] | null) ?? []).filter(Boolean);
    const kept = existing.filter((u) => !u.includes(`/rework-receipts/${safe}/`));
    await db.from("orders").update({ transaction_images: [...kept, url] }).eq("id", r.order_id);

    await audit({ module: "returns", table: "returns", recordId: returnId, action: "update", after: { regenerated_slip: url, replaced: existing.length - kept.length } });
    revalidatePath("/returns");
    revalidatePath("/orders");
    return { ok: true, url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to regenerate the slip." };
  }
}
