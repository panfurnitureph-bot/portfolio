import { useQuery } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";

/**
 * Availability Score data-access layer.
 *
 * public.forecast_instock_yearly — READ ONLY, loaded by n8n every 6 hours:
 *   product_id, year, jan..dec (in-stock % per month, NULL = walang data),
 *   first_arrival_date (kailan unang dumating ang stock; NULL = never arrived),
 *   pulled_at.
 *
 * Segmentation is DERIVED in the UI from first_arrival_date — never from a
 * stored tag (see segmentOf below).
 */

export interface InstockYearRow {
  product_id: string;
  year: number;
  jan: number | null; feb: number | null; mar: number | null; apr: number | null;
  may: number | null; jun: number | null; jul: number | null; aug: number | null;
  sep: number | null; oct: number | null; nov: number | null; dec: number | null;
  first_arrival_date: string | null;
  pulled_at: string | null;
}

export type Segment = "established" | "new_item" | "never_arrived";

export const NEW_ITEM_DAYS = 120;

/** NULL arrival = never arrived; arrival within 120 days = New; else Established. */
export function segmentOf(row: InstockYearRow, today: Date): Segment {
  const d = row.first_arrival_date;
  if (!d) return "never_arrived";
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return "never_arrived";
  const ageDays = (today.getTime() - new Date(y, m - 1, day).getTime()) / 86400000;
  return ageDays <= NEW_ITEM_DAYS ? "new_item" : "established";
}

const BATCH = 1000;

export function useForecastInstockYearly(year: string) {
  return useQuery<InstockYearRow[]>({
    queryKey: ["forecast_instock_yearly", year],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const all: InstockYearRow[] = [];
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await (supabase as any)
          .from("forecast_instock_yearly")
          .select("*")
          .eq("year", Number(year))
          .range(from, from + BATCH - 1);
        if (error) throw error;
        const rows = (data ?? []) as InstockYearRow[];
        all.push(...rows);
        if (rows.length < BATCH) break;
        from += BATCH;
      }
      return all;
    },
  });
}
