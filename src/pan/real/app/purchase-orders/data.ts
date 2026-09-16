import { createServerSupabase } from "@/lib/supabase/server";

// A styled spreadsheet cell captured from the PI (text + font color/bold + fill) for 1:1 print replication.
export type POCell = { t: string; c?: string; b?: boolean; bg?: string };

// One column of the item table, in the PI's original order.
export type POColKind = "sn" | "photo" | "swatch" | "item_no" | "color" | "description" | "prod_size" | "qty" | "received" | "unit_price" | "amount" | "extra" | "skip";
export type POColumn = { label: string; kind: POColKind; key?: string; cur?: string };

// Normalize header/footer rows; tolerates the older plain string[][] shape.
function normalizeCells(rows: unknown): POCell[][] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => (Array.isArray(r) ? r.map((c) => {
    if (typeof c === "string") return { t: c };
    if (c && typeof c === "object") { const o = c as POCell; return { t: String(o.t ?? ""), c: o.c, b: o.b, bg: o.bg }; }
    return { t: String(c ?? "") };
  }) : []));
}

export type POItem = {
  id: number;
  item_no: string | null;
  color: string | null;
  description: string | null;
  prod_size: string | null;
  qty: number;
  received_qty: number;
  unit_price: number;
  amount: number;
  image_url: string | null;
  swatch_url: string | null;
  extra: Record<string, string>;
  sort: number;
};

export type PurchaseOrder = {
  id: number;
  pi_number: string | null;
  supplier: string | null;
  supplier_address: string | null;
  date_order: string | null;
  delivery_date: string | null;
  price_terms: string | null;
  payment_terms: string | null;
  port_shipment: string | null;
  port_destination: string | null;
  container: string | null;
  currency: string;
  discount: number;
  total: number;
  deposit_pct: number;
  status: string;
  notes: string | null;
  details: Record<string, string>;
  header_rows: POCell[][];
  footer_rows: POCell[][];
  columns: POColumn[];
  items: POItem[];
};

export type PurchaseOrderData = {
  rows: PurchaseOrder[];
  kpi: { total: number; pending: number; partial: number; received: number; value: number };
};

export async function loadPurchaseOrders(): Promise<PurchaseOrderData> {
  const supabase = createServerSupabase();
  const [{ data: heads }, { data: items }] = await Promise.all([
    supabase.from("purchase_orders").select("id,pi_number,supplier,supplier_address,date_order,delivery_date,price_terms,payment_terms,port_shipment,port_destination,container,currency,discount,total,deposit_pct,status,notes,details,header_rows,footer_rows,columns").order("created_at", { ascending: false }).limit(5000),
    supabase.from("purchase_order_items").select("id,po_id,item_no,color,description,prod_size,qty,received_qty,unit_price,amount,image_url,swatch_url,extra,sort").order("sort").limit(10000),
  ]);

  const byPo = new Map<number, POItem[]>();
  for (const it of items ?? []) {
    const arr = byPo.get(it.po_id) ?? [];
    arr.push({
      id: it.id, item_no: it.item_no ?? null, color: it.color ?? null, description: it.description ?? null,
      prod_size: it.prod_size ?? null, qty: Number(it.qty ?? 0), received_qty: Number(it.received_qty ?? 0),
      unit_price: Number(it.unit_price ?? 0), amount: Number(it.amount ?? 0), image_url: it.image_url ?? null, swatch_url: it.swatch_url ?? null,
      extra: (it.extra && typeof it.extra === "object" ? it.extra : {}) as Record<string, string>, sort: Number(it.sort ?? 0),
    });
    byPo.set(it.po_id, arr);
  }

  const rows: PurchaseOrder[] = (heads ?? []).map((h) => ({
    id: h.id, pi_number: h.pi_number ?? null, supplier: h.supplier ?? null, supplier_address: h.supplier_address ?? null,
    date_order: h.date_order ?? null, delivery_date: h.delivery_date ?? null, price_terms: h.price_terms ?? null, payment_terms: h.payment_terms ?? null,
    port_shipment: h.port_shipment ?? null, port_destination: h.port_destination ?? null, container: h.container ?? null,
    currency: h.currency ?? "USD", discount: Number(h.discount ?? 0), total: Number(h.total ?? 0),
    deposit_pct: Number(h.deposit_pct ?? 30), status: h.status ?? "Draft", notes: h.notes ?? null,
    details: (h.details && typeof h.details === "object" ? h.details : {}) as Record<string, string>,
    header_rows: normalizeCells(h.header_rows),
    footer_rows: normalizeCells(h.footer_rows),
    columns: (Array.isArray(h.columns) ? h.columns : []) as POColumn[],
    items: byPo.get(h.id) ?? [],
  }));

  const pending = rows.filter((r) => /draft|sent|deposit|ordered/i.test(r.status)).length;
  const partial = rows.filter((r) => /partial/i.test(r.status)).length;
  const received = rows.filter((r) => /^received/i.test(r.status)).length;
  const value = rows.reduce((s, r) => s + r.total, 0);
  return { rows, kpi: { total: rows.length, pending, partial, received, value } };
}
