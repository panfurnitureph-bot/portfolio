/**
 * New SKU (120-day) rule + the shared per-SKU lookup fetches that feed it —
 * single source of truth for MonthlyForecast.tsx and MonthlySales.tsx (both
 * pages previously carried identical inline copies, which risked drift).
 */

export const NEW_SKU_WINDOW_DAYS = 120;

/** Exact in-UI port of the upstream SQL CASE:
 *  New SKU when [first sale date] IS NULL OR > GETDATE() − 120. */
export function computeNewSku(firstSaleDate: unknown): "New SKU" | "Not New SKU" {
  const s = String(firstSaleDate ?? "").trim();
  if (!s) return "New SKU"; // null / empty → New (matches `is null`)
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return "New SKU"; // unparseable date → treat as null
  return t > Date.now() - NEW_SKU_WINDOW_DAYS * 86400000 ? "New SKU" : "Not New SKU";
}

/** first_sale_date may arrive under a few names depending on the source view. */
export function readFirstSaleDate(row: Record<string, unknown>): string | null {
  const v = row.first_sale_date ?? row["first sale date"] ?? row.firstsale_date ?? row.first_sold_date;
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

export type FirstSaleDateRow = { sku: string; first_sale_date: string | null };
export type ScNameRow = { sku: string; product_name: string | null };

/** Page through a table in 1000-row chunks so we get EVERY row.
 *  A single `.limit(N)` is silently capped by PostgREST's server-side
 *  `db-max-rows` (typically 1000), so a plain `.limit(10000)` returns only
 *  the first ~1000 rows — which dropped every alphabetically-late SKU (e.g.
 *  the P-* set components) out of the map and forced them to "New SKU".
 *  Ordering by `sku` keeps pagination deterministic (no overlap/gaps). */
async function fetchAllRows<T>(supabase: unknown, table: string, selectCols: string): Promise<T[]> {
  const all: T[] = [];
  const pageSize = 1000;
  const maxPages = 80; // 80k-row safety cap (matches useDashboardCoverage)
  for (let p = 0; p < maxPages; p++) {
    const from = p * pageSize;
    const { data, error } = await (supabase as any)
      .from(table)
      .select(selectCols)
      .order("sku", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data || []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

/** Each SKU's first sale date, from the sku_first_sale_date view
 *  (MIN first sale across orders + monthly_orders — forecast_report has no
 *  such column). Paginated: the view returns >1000 rows. */
export async function fetchFirstSaleDates(supabase: unknown): Promise<FirstSaleDateRow[]> {
  return fetchAllRows<FirstSaleDateRow>(supabase, "sku_first_sale_date", "sku,first_sale_date");
}

/** Authoritative the ERP product names (erp_product_details) — the stored
 *  forecast_report.description drifts (stale "(Set of 4)" suffixes etc.).
 *  Paginated: erp_product_details is well over the 1000-row cap. */
export async function fetchScProductNames(supabase: unknown): Promise<ScNameRow[]> {
  return fetchAllRows<ScNameRow>(supabase, "erp_product_details", "sku,product_name");
}

/** sku → trimmed non-empty product name. */
export function buildScNameMap(rows: ScNameRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const name = String(r.product_name ?? "").trim();
    if (r.sku && name) m.set(r.sku, name);
  }
  return m;
}
