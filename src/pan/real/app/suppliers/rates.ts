import { createServerSupabase } from "@/lib/supabase/server";

export type Rate = {
  id: number;
  item: string;
  category: string | null;
  unit: string | null;
  unit_price: number;
  notes: string | null;
  status: string;
  created_at: string;
};

export async function loadRates(): Promise<Rate[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase.from("rates").select("*").order("category").order("item");
  return (data ?? []) as Rate[];
}
