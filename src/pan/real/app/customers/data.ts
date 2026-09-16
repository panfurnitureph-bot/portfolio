import { createServerSupabase } from "@/lib/supabase/server";

export type CustomerOrder = {
  order_number: string | null;
  date_order: string | null;
  status: string | null;
  total: number;
  product_name: string | null;
};

export type Customer = {
  id: number | null;       // null = order-only customer not yet in the table
  name: string;
  contact: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  orderCount: number;
  totalSpent: number;
  totalPaid: number;
  balance: number;
  lastOrder: string | null;
  orders: CustomerOrder[];
};

export type CustomerData = {
  rows: Customer[];
  kpi: { customers: number; orders: number; revenue: number };
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Master records from the customers table, enriched with order aggregates.
export async function loadCustomers(): Promise<CustomerData> {
  const db = createServerSupabase();
  const [{ data: custs }, { data: orders }] = await Promise.all([
    db.from("customers").select("id, name, contact, email, address, notes").limit(10000),
    db.from("orders").select("order_number, date_order, customer_name, address, contact_number, email, status, downpayment_price, full_payment, full_payment_price, product_name").order("date_order", { ascending: false }).order("id", { ascending: false }).limit(10000),
  ]);

  const map = new Map<string, Customer>();

  // Seed from the master table.
  for (const c of custs ?? []) {
    const name = String(c.name ?? "").trim();
    if (!name) continue;
    map.set(norm(name), {
      id: c.id as number, name, contact: c.contact ?? null, email: c.email ?? null,
      address: c.address ?? null, notes: c.notes ?? null,
      orderCount: 0, totalSpent: 0, totalPaid: 0, balance: 0, lastOrder: null, orders: [],
    });
  }

  // Fold in orders (creating order-only customers if absent).
  for (const o of orders ?? []) {
    const name = (o.customer_name ?? "").trim();
    if (!name) continue;
    const k = norm(name);
    let c = map.get(k);
    if (!c) {
      c = { id: null, name, contact: null, email: null, address: o.address ?? null, notes: null, orderCount: 0, totalSpent: 0, totalPaid: 0, balance: 0, lastOrder: null, orders: [] };
      map.set(k, c);
    }
    const total = Number(o.full_payment_price ?? 0);
    const paid = Number(o.downpayment_price ?? 0) + Number(o.full_payment ?? 0);
    c.orderCount += 1;
    c.totalSpent += total;
    c.totalPaid += paid;
    if (!c.address && o.address) c.address = o.address;
    if (!c.contact && o.contact_number) c.contact = o.contact_number;
    if (!c.email && o.email) c.email = o.email;
    if (o.date_order && (!c.lastOrder || o.date_order > c.lastOrder)) c.lastOrder = String(o.date_order).slice(0, 10);
    c.orders.push({
      order_number: o.order_number ?? null,
      date_order: o.date_order ? String(o.date_order).slice(0, 10) : null,
      status: o.status ?? null,
      total,
      product_name: o.product_name ?? null,
    });
  }

  const rows = [...map.values()].map((c) => ({ ...c, balance: Math.max(c.totalSpent - c.totalPaid, 0) }));
  rows.sort((a, b) => (b.lastOrder ?? "").localeCompare(a.lastOrder ?? "") || a.name.localeCompare(b.name));

  return {
    rows,
    kpi: {
      customers: rows.length,
      orders: rows.reduce((s, c) => s + c.orderCount, 0),
      revenue: rows.reduce((s, c) => s + c.totalSpent, 0),
    },
  };
}
