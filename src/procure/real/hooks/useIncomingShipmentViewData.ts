import { useQuery } from "@tanstack/react-query";
import { externalSupabase } from "@/integrations/supabase/externalClient";

export const MONTH_KEYS = [
  "month_1","month_2","month_3","month_4","month_5","month_6",
  "month_7","month_8","month_9","month_10","month_11","month_12",
] as const;

export const MONTH_LABEL_KEYS = [
  "month_1_label","month_2_label","month_3_label","month_4_label",
  "month_5_label","month_6_label","month_7_label","month_8_label",
  "month_9_label","month_10_label","month_11_label","month_12_label",
] as const;

export type IncomingShipmentRow = {
  product_id: string | null;
  po_numbers: string | null;
  month_1_label: string | null;
  month_2_label: string | null;
  month_3_label: string | null;
  month_4_label: string | null;
  month_5_label: string | null;
  month_6_label: string | null;
  month_7_label: string | null;
  month_8_label: string | null;
  month_9_label: string | null;
  month_10_label: string | null;
  month_11_label: string | null;
  month_12_label: string | null;
  month_1: number | null;
  month_2: number | null;
  month_3: number | null;
  month_4: number | null;
  month_5: number | null;
  month_6: number | null;
  month_7: number | null;
  month_8: number | null;
  month_9: number | null;
  month_10: number | null;
  month_11: number | null;
  month_12: number | null;
};

export function rowTotal(r: IncomingShipmentRow): number {
  return MONTH_KEYS.reduce((s, k) => {
    const v = Number(r[k] ?? 0);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);
}

export function rowPeakMonth(r: IncomingShipmentRow): { label: string; value: number; index: number } {
  let best = { label: "-", value: 0, index: -1 };
  for (let i = 0; i < 12; i++) {
    const v = Number(r[MONTH_KEYS[i]] ?? 0);
    if (v > best.value) {
      best = { label: String(r[MONTH_LABEL_KEYS[i]] ?? `Month ${i + 1}`), value: v, index: i };
    }
  }
  return best;
}

function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === "string") return new Error(e);
  return new Error(String(e));
}

/**
 * PO number -> most recent Cargo Ready Date, sourced from Dispatch Requests'
 * free-text `pos` field. That field is inconsistently formatted ("PO7788",
 * "7044, 7045, 7047", "PO7590 0.1CBM    PO7795 15CBM"), so bare PO-number
 * tokens are extracted with a regex instead of relying on any delimiter,
 * letting this cross-reference against incoming_shipment_view's own
 * pipe-separated po_numbers regardless of how the source was typed.
 */
export function usePoCargoReadyDates() {
  return useQuery({
    queryKey: ["incoming_shipment_po_crd"],
    queryFn: async () => {
      const BATCH = 1000;
      let offset = 0;
      const map = new Map<string, string>();
      while (true) {
        const { data, error } = await externalSupabase
          .from("shipping_requests")
          .select("pos, cargo_ready_date")
          .not("pos", "is", null)
          .not("cargo_ready_date", "is", null)
          .range(offset, offset + BATCH - 1);
        if (error) throw toError(error);
        const rows = (data || []) as { pos: string | null; cargo_ready_date: string | null }[];
        for (const r of rows) {
          if (!r.pos || !r.cargo_ready_date) continue;
          const tokens = r.pos.match(/\d{3,6}/g) ?? [];
          for (const t of tokens) {
            const existing = map.get(t);
            if (!existing || r.cargo_ready_date > existing) map.set(t, r.cargo_ready_date);
          }
        }
        if (rows.length < BATCH) break;
        offset += BATCH;
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Load-once pattern: fetch all rows in batches, filter/paginate client-side.
 */
export function useIncomingShipmentAllData() {
  return useQuery({
    queryKey: ["incoming_shipment_view_all"],
    queryFn: async () => {
      const BATCH = 1000;
      let all: IncomingShipmentRow[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await externalSupabase
          .from("incoming_shipment_view")
          .select("*")
          .order("product_id", { ascending: true })
          .range(offset, offset + BATCH - 1);
        if (error) throw toError(error);
        const rows = (data || []) as IncomingShipmentRow[];
        all = all.concat(rows);
        if (rows.length < BATCH) break;
        offset += BATCH;
      }
      return all;
    },
    staleTime: 5 * 60 * 1000,
  });
}
