import { createServerSupabase } from "@/lib/supabase/server";

export type Supplier = {
  id: number;
  name: string;
  type: "local" | "shopee" | "imported";
  address: string | null;
  contact_person: string | null;
  contact_number: string | null;
  email: string | null;
  link: string | null;
  materials: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

export type SuppliersData = {
  rows: Supplier[];
  kpi: { total: number; local: number; shopee: number; imported: number; active: number };
};

export async function loadSuppliers(): Promise<SuppliersData> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("suppliers")
    .select(
      "id,name,type,address,contact_person,contact_number,email,link,materials,status,notes,created_at"
    )
    .order("name")
    .limit(10000);
  const rows = (data ?? []) as Supplier[];
  return {
    rows,
    kpi: {
      total: rows.length,
      local: rows.filter((r) => r.type === "local").length,
      shopee: rows.filter((r) => r.type === "shopee").length,
      imported: rows.filter((r) => r.type === "imported").length,
      active: rows.filter((r) => r.status === "active").length,
    },
  };
}
