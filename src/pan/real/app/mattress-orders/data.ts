import { createServerSupabase } from "@/lib/supabase/server";

export type MattressOrder = {
  id: number;
  client: string;
  order: string | null;
  order_date: string | null;
  status: string | null;
  region: string;
  amount: number;
  paid_via: string | null;
  done_at: string | null;   // set when marked Done → the row is locked
};

export type MattressData = {
  rows: MattressOrder[];
  kpi: { total: number; luzon: number; davao: number; done: number };
};

export async function loadMattressOrders(): Promise<MattressData> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("mattress_orders")
    .select("id, client, order, order_date, status, region, amount, paid_via, done_at, created_at")
    .order("created_at", { ascending: false })
    .limit(50000);

  const rows: MattressOrder[] = (data ?? []).map((r) => ({
    id: r.id,
    client: r.client,
    order: r.order ?? null,
    order_date: r.order_date ?? null,
    status: r.status ?? null,
    region: r.region ?? "Luzon",
    amount: Number(r.amount ?? 0),
    paid_via: (r.paid_via as string | null) ?? null,
    done_at: (r.done_at as string | null) ?? null,
  }));

  const luzon = rows.filter((r) => r.region === "Luzon").length;
  const davao = rows.filter((r) => r.region === "Davao").length;
  const done = rows.filter((r) => (r.status ?? "").toLowerCase() === "done").length;
  return { rows, kpi: { total: rows.length, luzon, davao, done } };
}
