// DOCUMENT NUMBERS (2026-08-23): ORD-/RMA-/FQ-/DD-/MTO- ay PALAGING "pinakamataas
// na umiiral + 1". Kapag wala nang laman ang table, babalik sa 000001 — hindi
// tumutuloy ang lumang sequence. Ang sabay na create ay nasasalo ng unique
// index ng bawat table (+ retry ng caller); ang RPC sequence ay fallback lang
// kapag hindi mabasa ang table (hal. wala pang migration).

// Minimal na hugis ng Supabase client na kailangan dito — para magamit ng
// server client at ng service-role client nang walang pagtatalo sa types.
type Q = {
  from: (table: string) => {
    select: (cols: string) => {
      like: (col: string, pat: string) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
  rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }>;
};

export function formatDocNumber(prefix: string, n: number, width = 6): string {
  return `${prefix}-${String(n).padStart(width, "0")}`;
}

// Susunod na numero mula sa pinakamataas na nasa `table.column` na may prefix.
export async function nextDocNumber(
  db: Q,
  table: string,
  column: string,
  prefix: string,
  rpcFallback?: string,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from(table)
      .select(column)
      .like(column, `${prefix}-%`)
      .order(column, { ascending: false })
      .limit(1);
    if (!error) {
      const rows = (data as Record<string, unknown>[] | null) ?? [];
      const top = String(rows[0]?.[column] ?? "");
      const m = /(\d+)$/.exec(top);
      return formatDocNumber(prefix, m ? parseInt(m[1], 10) + 1 : 1);
    }
  } catch { /* fallback sa ibaba */ }
  if (!rpcFallback) return null;
  try {
    const { data, error } = await db.rpc(rpcFallback);
    if (!error && typeof data === "string") return data;
  } catch { /* wala */ }
  return null;
}
