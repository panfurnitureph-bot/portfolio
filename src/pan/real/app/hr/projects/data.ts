import { createServerSupabase } from "@/lib/supabase/server";
import type { ProjectWork } from "@/lib/hr/types";
import { isShippingDesc } from "@/lib/shipping";

export type ProjectWorkRow = ProjectWork & { employee_name: string };
export type EmployeeLite = { id: number; name: string; role: string };

export async function loadProjectWork(): Promise<ProjectWorkRow[]> {
  const db = createServerSupabase();
  const { data } = await db
    .from("hr_project_work")
    .select("id, employee_id, project_name, order_number, rate, ot, description, amount, work_date, status, payslip_id")
    // Pinakabago sa taas: petsa pababa, tapos ID pababa — ang id ang tunay na
    // pagkakasunod ng pagpasok. Ang dating order_number na tie-break ay
    // naglalagay ng mga STOCK/walang-order na entry (NULLS FIRST sa desc) sa
    // unahan ng araw, kaya ang pinakabagong deklarasyon (2026-09-01, "dapat
    // lageng ung latest") ay bumababa sa ilalim ng mga naunang stock entries.
    .order("work_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as ProjectWork[];

  // Attach employee names (map from employees id -> name).
  const ids = [...new Set(rows.map((r) => r.employee_id).filter(Boolean))] as number[];
  const byId = new Map<number, string>();
  if (ids.length) {
    const { data: emps } = await db.from("employees").select("id, name").in("id", ids);
    for (const e of emps ?? []) byId.set(e.id as number, (e.name as string) ?? "");
  }
  return rows.map((r) => ({ ...r, employee_name: byId.get(r.employee_id) ?? "—" }));
}

// Project work is for constructors only (paid per gawa). Limit the picker to
// constructor-role staff (grouped per workshop in the UI).
export async function loadEmployeesLite(): Promise<EmployeeLite[]> {
  const db = createServerSupabase();
  const { data } = await db
    .from("employees")
    .select("id, name, role")
    .eq("active", true)
    .or("role.ilike.%constructor%,role.ilike.%project base%")
    .order("role")
    .order("name")
    .limit(5000);
  return (data ?? []) as EmployeeLite[];
}

// Order line items tagged with a constructor that have NO project-work entry yet.
export type PendingItem = { order_number: string; customer_name: string | null; description: string; constructor_name: string; workshop: string | null; unit_price: number; employee_id: number | null };

export async function loadPendingFromOrders(): Promise<PendingItem[]> {
  const db = createServerSupabase();
  const [{ data: orders }, { data: emps }, { data: pw }] = await Promise.all([
    db.from("orders").select("order_number, customer_name, receipt_items").not("order_number", "is", null).order("date_order", { ascending: false }).order("id", { ascending: false }).limit(2000),
    db.from("employees").select("id, name").or("role.ilike.%constructor%,role.ilike.%project base%").limit(5000),
    db.from("hr_project_work").select("order_number, employee_id, description").limit(10000),
  ]);
  const empByName = new Map<string, number>((emps ?? []).map((e) => [String(e.name).toLowerCase(), e.id as number]));
  const assigned = new Set((pw ?? []).map((r) => `${r.order_number}|${r.employee_id}|${(r.description as string) ?? ""}`));
  const out: PendingItem[] = [];
  for (const o of orders ?? []) {
    for (const it of (o.receipt_items ?? [])) {
      const cn = it.constructorName;
      if (!cn) continue;
      if (isShippingDesc(it.description)) continue; // Shipping Fee = hindi proyekto/payout
      const desc = (it.description ?? "").split("\n")[0].trim();
      const empId = empByName.get(String(cn).toLowerCase()) ?? null;
      if (assigned.has(`${o.order_number}|${empId}|${desc}`)) continue;
      out.push({ order_number: o.order_number as string, customer_name: (o.customer_name as string) ?? null, description: desc, constructor_name: cn as string, workshop: (it.workshop as string) ?? null, unit_price: Number(it.unitPrice) || 0, employee_id: empId });
    }
  }
  return out;
}

export type OrderLite = { order_number: string; customer_name: string | null };

// Order numbers for the project-work autosearch (most recent first, deduped).
export async function loadOrders(): Promise<OrderLite[]> {
  const db = createServerSupabase();
  const { data } = await db
    .from("orders")
    .select("order_number, customer_name")
    .not("order_number", "is", null)
    .order("date_order", { ascending: false }).order("id", { ascending: false })
    .limit(1000);
  const seen = new Set<string>();
  const out: OrderLite[] = [];
  for (const r of data ?? []) {
    const on = (r.order_number as string)?.trim();
    if (!on || seen.has(on)) continue;
    seen.add(on);
    out.push({ order_number: on, customer_name: (r.customer_name as string) ?? null });
  }
  return out;
}

// ── DETALYE NG REWORK PARA SA PAYROLL (2026-08-25) ──────────────────────────
// Ang bayad sa QC ay may kaakibat na declaration, at doon hinahango ng listahan
// ang SKU, litrato at kategorya. Ang bayad ng ON-SITE REPAIR CREW ay walang
// declaration — itinatakda ito sa pag-apruba ng RMA — kaya blangko ang tatlong
// hanay na iyon. Ang RMA ang pinagmumulan, at ito ang naghahanap nito: ang
// description ay "RMA-000002 — On-site repair", kaya nasa unahan ang numero.
export type ReworkMeta = {
  rmaNo: string;
  sku: string | null;
  image: string | null;
  category: string | null;
  // Buong item: pangalan sa unang linya, spec sa mga sumunod bilang bullet —
  // kaparehong hulma ng QC declaration, kaya kayang buuin ang parehong preview.
  item: string | null;
  mode: string | null;          // onsite | pullout
  workshop: string | null;      // saan kinumpuni (pull-out)
  crew: { id: number; name: string; pay?: number }[];
  photos: string[];             // litrato ng sira, kuha sa deklarasyon
  reason: string | null;
  declaredBy: string | null;
  declaredAt: string | null;
  charge: number;
  deliveryPrice: number;
  // Ang inaprubahang piyesa — binayaran ng customer, at ito ang nakikita ng
  // aprubador sa halip na blangkong ADD-ONS (walang add-on rate sa rework).
  parts: { part: string; qty: number; amount: number }[];
};

export async function loadReworkMetaByRma(): Promise<Record<string, ReworkMeta>> {
  const db = createServerSupabase();
  const { data } = await db.from("returns")
    .select("return_no, sku, item_image, category, item_desc, rework_mode, rework_workshop_id, rework_onsite_crew, photos, reason, requested_by, created_at, rework_charge_total, rework_delivery_price, rework_parts")
    .eq("resolution", "rework")
    .not("return_no", "is", null)
    .limit(2000);
  const rows = data ?? [];
  // Pangalan ng workshop — sa pull-out lang may saysay (doon dinala).
  const wids = [...new Set(rows.map((r) => r.rework_workshop_id as number | null).filter((x): x is number => !!x))];
  const shopById = new Map<number, string>();
  if (wids.length) {
    const { data: shops } = await db.from("workshop").select("id, name").in("id", wids);
    for (const w of shops ?? []) shopById.set(w.id as number, (w.name as string) ?? "");
  }
  const out: Record<string, ReworkMeta> = {};
  for (const r of rows) {
    const no = String(r.return_no ?? "").trim();
    if (!no) continue;
    out[no] = {
      rmaNo: no,
      sku: (r.sku as string | null) ?? null,
      image: (r.item_image as string | null) ?? null,
      category: (r.category as string | null) ?? null,
      item: (r.item_desc as string | null) ?? null,
      mode: (r.rework_mode as string | null) ?? null,
      workshop: r.rework_workshop_id ? shopById.get(r.rework_workshop_id as number) ?? null : null,
      crew: Array.isArray(r.rework_onsite_crew)
        ? (r.rework_onsite_crew as { id?: unknown; name?: unknown; pay?: unknown }[])
            .map((c) => ({ id: Number(c?.id), name: String(c?.name ?? "").trim(), pay: Math.max(Number(c?.pay) || 0, 0) }))
            .filter((c) => Number.isFinite(c.id) && c.name)
        : [],
      photos: Array.isArray(r.photos) ? (r.photos as string[]).filter(Boolean) : [],
      reason: (r.reason as string | null) ?? null,
      declaredBy: (r.requested_by as string | null) ?? null,
      declaredAt: (r.created_at as string | null) ?? null,
      charge: Number(r.rework_charge_total) || 0,
      parts: Array.isArray(r.rework_parts)
        ? (r.rework_parts as { part?: unknown; qty?: unknown; amount?: unknown }[])
            .map((x) => ({ part: String(x?.part ?? "").trim(), qty: Number(x?.qty) || 1, amount: Number(x?.amount) || 0 }))
            .filter((x) => x.part)
        : [],
      deliveryPrice: Number(r.rework_delivery_price) || 0,
    };
  }
  return out;
}

// ── PANGHALILI KAPAG WALA NANG RMA ROW (2026-08-28) ─────────────────────────
// Ang `loadReworkMetaByRma` ay nasa `returns`; kapag nabura ang RMA, nananatili
// ang bayad sa `hr_project_work` pero nawawala ang SKU, litrato at kategorya —
// blangko ang tatlong hanay at ang preview sa modal, kahit buo pa ang pangalan
// at spec sa `project_name`.
//
// Ang order ang natitirang pinagmumulan: ang `receipt_items` nito ay may
// larawan, sku at kategorya kada produkto. Ang unang linya ng `project_name`
// ("Rework · RMA-000002 · PAN Sofa V.03") ang itinutugma sa `description` ng
// item. Naka-key sa "ORD-000010|pan sofa v.03".
export type OrderItemLite = { sku: string | null; image: string | null; category: string | null; color: string | null };

export async function loadOrderItemLookup(): Promise<Record<string, OrderItemLite>> {
  const db = createServerSupabase();
  const { data } = await db.from("orders")
    .select("order_number, receipt_items")
    .not("order_number", "is", null)
    .order("id", { ascending: false }).limit(2000);
  const out: Record<string, OrderItemLite> = {};
  for (const r of data ?? []) {
    const on = String(r.order_number ?? "").trim();
    if (!on || !Array.isArray(r.receipt_items)) continue;
    for (const it of r.receipt_items as { description?: unknown; sku?: unknown; image?: unknown; category?: unknown; color?: unknown }[]) {
      const name = String(it?.description ?? "").split("\n")[0].trim().toLowerCase();
      if (!name) continue;
      const key = `${on}|${name}`;
      // Unang tugma ang panalo — ang pinakabagong order ang nauuna sa listahan.
      if (out[key]) continue;
      out[key] = {
        sku: (it?.sku as string | null) ?? null,
        image: (it?.image as string | null) ?? null,
        category: (it?.category as string | null) ?? null,
        color: (it?.color as string | null) ?? null,
      };
    }
  }
  return out;
}
