import { createServerSupabase } from "@/lib/supabase/server";

export type CostingItem = {
  id: number;
  kind: "material" | "labor" | "expense" | "subcon";
  qty: string | null;
  material: string | null;
  unit_price: number;
  total_price: number;
  sort: number;
};

export type Costing = {
  id: number;
  title: string;
  project: string | null;
  size: string | null;
  category: string | null;
  total_cost: number;
  selling_price: number;
  notes: string | null;
  items: CostingItem[];
};

export type CostingData = {
  rows: Costing[];
  kpi: { total: number; avg: number; totalSell: number };
};

export async function loadCostings(): Promise<CostingData> {
  const supabase = createServerSupabase();
  const [{ data: heads }, { data: items }] = await Promise.all([
    supabase
      .from("product_costings")
      .select("id, title, project, size, category, total_cost, selling_price, notes, created_at")
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("costing_items")
      .select("id, costing_id, kind, qty, material, unit_price, total_price, sort")
      .order("sort")
      .limit(10000),
  ]);

  const byCosting = new Map<number, CostingItem[]>();
  for (const it of items ?? []) {
    const arr = byCosting.get(it.costing_id) ?? [];
    arr.push({
      id: it.id, kind: it.kind, qty: it.qty ?? null, material: it.material ?? null,
      unit_price: Number(it.unit_price ?? 0), total_price: Number(it.total_price ?? 0), sort: Number(it.sort ?? 0),
    });
    byCosting.set(it.costing_id, arr);
  }

  const rows: Costing[] = (heads ?? []).map((h) => ({
    id: h.id, title: h.title, project: h.project ?? null,
    size: h.size ?? null, category: h.category ?? null, total_cost: Number(h.total_cost ?? 0),
    selling_price: Number(h.selling_price ?? 0), notes: h.notes ?? null, items: byCosting.get(h.id) ?? [],
  }));

  const avg = rows.length ? rows.reduce((s, r) => s + r.total_cost, 0) / rows.length : 0;
  const totalSell = rows.reduce((s, r) => s + r.selling_price, 0);
  return { rows, kpi: { total: rows.length, avg, totalSell } };
}
