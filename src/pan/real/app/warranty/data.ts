import { createServerSupabase, type OrderRow } from "@/lib/supabase/server";
import { isShippingDesc } from "@/lib/shipping";
import { descSpecLines, parseDescSpecs } from "@/lib/receipt-desc";

export type WarrantyItem = {
  sku: string | null;
  description: string;
  qty: number;
  image_url: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  // Buong SPECIFICATION / DESIGN DETAILS (isang spec kada linya). Ang dimension
  // ay isang bullet lang dito; ang certificate ay nagpapakita na ng lahat.
  specs: string | null;
  customized?: boolean;
};

export type WarrantyRow = {
  installation_id: number | null;
  order_id: number | null;
  order_number: string | null;
  warranty_no: string;
  customer_name: string | null;
  sales_rep: string | null;
  address: string | null;
  contact_number: string | null;
  email: string | null;
  install_date: string | null;
  installer_team: string | null;
  driver_team: string | null;
  coordinator: string | null;
  date_purchase: string | null;
  date_delivered: string | null;
  mop: string | null;
  warranty_terms: string | null;
  warranty_duration: string | null;
  warranty_start: string | null;
  valid_until: string | null;
  days_left: number | null;
  wstatus: "active" | "expiring" | "expired";
  signature_url: string | null;
  warranty_form_url: string | null;
  photos: string[];
  items_summary: string | null;
  items: WarrantyItem[];
  // May rework install ang order (≥2 signed records) — tag lang; ang warranty ay
  // nakabatay pa rin sa unang delivery.
  has_rework: boolean;
  // ANG MGA PINIRMAHANG FORM NG BAWAT REWORK VISIT (Joe 2026-09-06, "need dalawa
  // ung attachment nung warranty if may rework?"): ang orihinal ang warranty
  // doc, pero bawat rework install ay may sariling pinirmahang form na ang
  // inayos lang ang laman — kailangang makita rito, hindi lang ang una.
  rework_forms: { id: number; install_date: string | null; warranty_form_url: string | null; signature_url: string | null; items_summary: string | null }[];
};

export type WarrantyData = {
  rows: WarrantyRow[];
  kpi: { active: number; expiring: number; expired: number; total: number };
};

// Warranty No. derived 1:1 from order number — strip "ORD-" prefix: ORD-000003 → WR-000003.
export function warrantyNo(orderNumber: string | null, id?: number | null): string {
  if (orderNumber) return `WR-${orderNumber.replace(/^ord-?/i, "")}`;
  return id ? `WR-${String(id).padStart(6, "0")}` : "—";
}

// start + "1 Year" / "6 Months" → end date (ISO yyyy-mm-dd).
function addDuration(start: string, dur: string): string {
  if (!start) return "";
  const d = new Date(start + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  const m = dur.match(/(\d+)\s*(month|year)/i);
  if (m) { const n = Number(m[1]); if (/year/i.test(m[2])) d.setFullYear(d.getFullYear() + n); else d.setMonth(d.getMonth() + n); }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysUntil(iso: string): number {
  const d = new Date(iso + "T00:00:00");
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

// Registry of completed + signed warranty documents (auto from installations).
export async function loadWarranties(): Promise<WarrantyData> {
  const supabase = createServerSupabase();
  const [{ data: insts }, { data: products }, { data: dels }, { data: emps }] = await Promise.all([
    supabase.from("installations").select("id, order_id, order_number, status, signature_url, warranty_form_url, customer_name, sales_rep, address, install_date, installer_team, warranty_start, warranty_duration, warranty_terms, completed_at, photos, items_summary").order("completed_at", { ascending: false }).limit(5000),
    supabase.from("product").select("product_name, sku, category, color, dimension, image_url").limit(5000),
    supabase.from("deliveries").select("order_id, driver_team, coordinator").limit(5000),
    supabase.from("employees").select("name").eq("active", true).limit(5000),
  ]);

  // Canonical name resolver: snap a stored name to the roster's exact spelling
  // (fixes casing / whitespace). Unknown names pass through unchanged.
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
  // Only finished installs with a signed form / signature qualify as warranty docs.
  // The terminal install status is "Delivered" (installation/actions.ts: stageStatus =
  // delivered ? "Delivered"); older records may still read "Completed", so accept both.
  const signedAll = (insts ?? []).filter((i: any) => /completed|delivered/i.test(i.status ?? "") && (i.signature_url || i.warranty_form_url));
  // IISANG warranty doc bawat order — ang ORIHINAL (pinakaunang record). Ang mga
  // rework install ay gumagawa ng bagong installations row, pero ang warranty ay
  // nakabatay pa rin sa UNANG delivery: hindi ito nagre-renew o nagdodoble.
  const firstByOrder = new Map<number | string, any>();
  const countByOrder = new Map<number | string, number>();
  const allByOrder = new Map<number | string, any[]>();
  for (const i of signedAll) {
    const key = i.order_id ?? `row-${i.id}`;
    countByOrder.set(key, (countByOrder.get(key) ?? 0) + 1);
    (allByOrder.get(key) ?? allByOrder.set(key, []).get(key)!).push(i);
    const prev = firstByOrder.get(key);
    if (!prev || Number(i.id) < Number(prev.id)) firstByOrder.set(key, i);
  }
  const signed = [...firstByOrder.values()];

  // Fetch only the orders referenced by signed installs (not the whole table).
  const orderIds = [...new Set(signed.map((i: any) => i.order_id).filter((x: any) => x != null))] as number[];
  const { data: orders } = orderIds.length
    ? await supabase.from("orders").select("id, order_number, assigned, contact_number, email, date_order, date_of_delivery, mop, Source, receipt_items").in("id", orderIds).limit(5000)
    : { data: [] as OrderRow[] };

  const orderById = new Map<number, OrderRow>();
  for (const o of (orders ?? []) as OrderRow[]) orderById.set(o.id, o);
  const driverByOrder = new Map<number, string | null>();
  const coordByOrder = new Map<number, string | null>();
  for (const d of (dels ?? []) as any[]) if (d.order_id != null) { driverByOrder.set(d.order_id, d.driver_team ?? null); coordByOrder.set(d.order_id, d.coordinator ?? null); }
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const prodByName = new Map<string, any>();
  for (const p of products ?? []) prodByName.set(norm(p.product_name ?? ""), p);

  const itemsOf = (o: OrderRow | null | undefined): WarrantyItem[] => (o?.receipt_items ?? []).filter((it) => !isShippingDesc(it.description)).map((it) => {
    const desc = it.description ?? "";
    const first = desc.split("\n")[0];
    // ANG TUNAY NA PARSER (2026-08-29), hindi ang haka na "unang bullet ay
    // kulay, pangalawa ay kategorya". Ang dining table ay nagsisimula sa
    // "Seater: 4 Seater — 4ft x 3ft", kaya iyon ang naging COLOR sa sertipiko —
    // hindi kulay, at nauulit pa sa SPECIFICATION sa tabi nito. Alam ng
    // `parseDescSpecs` na ang nakalabel na linya ay HINDI kulay maliban sa
    // Fabric / Upholstered Finish / Colour; iyon din ang ginagamit ng delivery
    // at ng installation, kaya iisa ang basa ng tatlo.
    const spec = parseDescSpecs(desc);
    const p = prodByName.get(norm(first));
    return {
      // Ang BUONG detalye ay nasa `specs` na (sariling hanay sa certificate),
      // kaya ang description ay pangalan na lang — nadoble ang lahat ng spec sa
      // loob ng isang cell noon para lang mabasa ang mga ito.
      description: first, image_url: it.image ?? p?.image_url ?? null,
      sku: it.sku ?? p?.sku ?? null,
      category: it.category ?? spec.category ?? p?.category ?? null,
      color: it.color ?? spec.color ?? p?.color ?? null,
      dimension: it.dimension ?? spec.dimension ?? p?.dimension ?? null,
      specs: descSpecLines(desc) || null,
      qty: Number(it.qty) || 0,
      customized: !!it.customized,
    };
  });

  const rows: WarrantyRow[] = signed.map((i: any) => {
    const o = i.order_id != null ? orderById.get(i.order_id) : null;
    const start = i.warranty_start || i.install_date || (i.completed_at ? String(i.completed_at).slice(0, 10) : "");
    const duration = i.warranty_duration || "1 Year";
    const valid = start ? addDuration(start, duration) : "";
    const dl = valid ? daysUntil(valid) : null;
    const wstatus: WarrantyRow["wstatus"] = dl == null ? "active" : dl <= 0 ? "expired" : dl <= 30 ? "expiring" : "active";
    return {
      installation_id: i.id ?? null, order_id: i.order_id ?? null, order_number: i.order_number ?? null,
      warranty_no: warrantyNo(i.order_number, i.id),
      customer_name: i.customer_name ?? null,
      sales_rep: canon(i.sales_rep ?? o?.assigned ?? null), address: i.address ?? null,
      contact_number: o?.contact_number ?? null, email: o?.email ?? null,
      install_date: i.install_date ?? null, installer_team: canon(i.installer_team ?? null),
      driver_team: canon(i.order_id != null ? (driverByOrder.get(i.order_id) ?? null) : null),
      coordinator: canon(i.order_id != null ? (coordByOrder.get(i.order_id) ?? null) : null),
      date_purchase: o?.date_order ? String(o.date_order).slice(0, 10) : null,
      date_delivered: o?.date_of_delivery ? String(o.date_of_delivery).slice(0, 10) : null,
      mop: o?.mop ?? o?.Source ?? null,
      warranty_terms: i.warranty_terms ?? null, warranty_duration: duration,
      warranty_start: start || null, valid_until: valid || null, days_left: dl, wstatus,
      signature_url: i.signature_url ?? null, warranty_form_url: i.warranty_form_url ?? null,
      photos: Array.isArray(i.photos) ? i.photos : [],
      items_summary: i.items_summary ?? null, items: itemsOf(o),
      has_rework: (countByOrder.get(i.order_id ?? `row-${i.id}`) ?? 1) > 1,
      rework_forms: (allByOrder.get(i.order_id ?? `row-${i.id}`) ?? [])
        .filter((x: any) => Number(x.id) !== Number(i.id))
        .sort((a: any, b: any) => Number(a.id) - Number(b.id))
        .map((x: any) => ({
          id: Number(x.id),
          install_date: x.install_date ? String(x.install_date).slice(0, 10) : null,
          warranty_form_url: x.warranty_form_url ?? null,
          signature_url: x.signature_url ?? null,
          items_summary: x.items_summary ?? null,
        })),
    };
  });

  const kpi = {
    active: rows.filter((r) => r.wstatus === "active").length,
    expiring: rows.filter((r) => r.wstatus === "expiring").length,
    expired: rows.filter((r) => r.wstatus === "expired").length,
    total: rows.length,
  };
  return { rows, kpi };
}
