import "server-only";
import { isMissingColumn } from "./missing-column";
import { createServerSupabase } from "@/lib/supabase/server";

type SB = ReturnType<typeof createServerSupabase>;

export type StockMove = {
  material_id: number;
  workshop_id: number;
  delta: number;                 // + in / - out
  type: "received" | "consumed" | "adjust" | "request_fulfilled";
  source?: "scan" | "manual" | "request";
  ref_type?: "order" | "request" | null;
  ref_id?: number | null;
  note?: string | null;
  by?: string | null;
  // Sino ang GUMAMIT (worker) - iba sa by, na ang account na nag-record. 0178.
  used_by?: string | null;
  // ALING PRODUKTO (0197): ang workshop_job na kinonsumohan. Ang ref_id ay ang
  // ORDER, at ang isang order ay maraming produkto — ang job ang tunay na
  // may-ari ng materyales.
  job_id?: number | null;
};

// Apply one stock movement: upsert workshop_stock.on_hand (clamped ≥ 0) and
// append an immutable ledger row. Returns the new on-hand or an error string.
export async function applyStock(supabase: SB, m: StockMove): Promise<{ on_hand: number } | { error: string }> {
  if (!m.delta) {
    const { data } = await supabase.from("workshop_stock").select("on_hand").eq("material_id", m.material_id).maybeSingle();
    return { on_hand: Number(data?.on_hand ?? 0) };
  }

  // Atomic upsert+increment (race-safe — DB serializes concurrent scans).
  const { data: after, error: rpcErr } = await supabase.rpc("fn_workshop_stock_apply", { p_material_id: m.material_id, p_delta: m.delta });
  if (rpcErr) return { error: rpcErr.message };

  const row = {
    workshop_id: m.workshop_id, material_id: m.material_id, delta: m.delta,
    type: m.type, source: m.source ?? "manual", ref_type: m.ref_type ?? null, ref_id: m.ref_id ?? null,
    note: m.note ?? null, by: m.by ?? null,
  };
  let { error: logErr } = await supabase.from("workshop_stock_log").insert({ ...row, used_by: m.used_by ?? null, job_id: m.job_id ?? null });
  // WALA PANG MIGRATION? Huwag hayaang mabigo ang stock-out dahil sa column na
  // wala pa - nabawas na ang on_hand sa itaas, at ang kulang na tala ay mas
  // mabuti kaysa sa walang tala. 0197 (job_id) muna ang binibitawan, saka 0178
  // (used_by) - pababa hanggang sa payak na hilera.
  if (logErr && isMissingColumn(logErr.message, "job_id")) {
    ({ error: logErr } = await supabase.from("workshop_stock_log").insert({ ...row, used_by: m.used_by ?? null }));
  }
  if (logErr && isMissingColumn(logErr.message, "used_by")) {
    ({ error: logErr } = await supabase.from("workshop_stock_log").insert(row));
  }
  if (logErr) return { error: logErr.message };

  return { on_hand: Number(after ?? 0) };
}
