/**
 * Server-side export utility: fetches ALL matching rows via paginated .range() loop.
 * Works with any Supabase table/view + filters + search + sort.
 */
import { toast } from 'sonner';

const CHUNK_SIZE = 1000;

interface ExportColumn {
  column_name: string;
  header: string;
}

interface ExportOptions {
  supabaseClient: any;
  tableName: string;
  columns: ExportColumn[];
  /** Callback to apply filters/search/sort to the query. Receives a base select('*') query. */
  buildQuery: (query: any) => any;
  filename: string;
  onProgress?: (exported: number) => void;
  /** Optional per-row transform applied before writing the CSV — for callers
   *  whose on-screen values are computed/overridden client-side (e.g. Monthly
   *  Sales' the ERP names + New SKU status) so the file matches the UI. */
  transformRow?: (row: Record<string, any>) => Record<string, any>;
}

function prettifyHeader(col: string): string {
  return col
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeCSVValue(value: any): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Fetch all matching rows via server pagination and download as CSV.
 * Returns the total count of exported rows.
 */
export async function exportAllRows({
  supabaseClient,
  tableName,
  columns,
  buildQuery,
  filename,
  onProgress,
  transformRow,
}: ExportOptions): Promise<number> {
  const allRows: Record<string, any>[] = [];
  let from = 0;

  // First chunk — get count
  let baseQuery = supabaseClient.from(tableName).select('*', { count: 'exact' });
  baseQuery = buildQuery(baseQuery);
  baseQuery = baseQuery.range(from, from + CHUNK_SIZE - 1);
  const { data: firstData, error: firstError, count } = await baseQuery;
  if (firstError) throw firstError;

  allRows.push(...(firstData || []));
  onProgress?.(allRows.length);

  const total = count ?? allRows.length;

  // Fetch remaining chunks
  from += CHUNK_SIZE;
  while (from < total) {
    let q = supabaseClient.from(tableName).select('*');
    q = buildQuery(q);
    q = q.range(from, from + CHUNK_SIZE - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    onProgress?.(allRows.length);
    from += CHUNK_SIZE;
  }

  if (allRows.length === 0) {
    toast.error('No data to export');
    return 0;
  }

  // Build CSV
  const colKeys = columns.map((c) => c.column_name);
  const headers = columns.map((c) => c.header);
  const finalRows = transformRow ? allRows.map(transformRow) : allRows;
  const csvRows = finalRows.map((row) =>
    colKeys.map((key) => escapeCSVValue(row[key])).join(',')
  );
  const csv = [headers.join(','), ...csvRows].join('\r\n');

  // Download
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  return allRows.length;
}

/**
 * Build export columns from schema, excluding hidden columns and applying prettified headers.
 */
export function buildExportColumns(
  schema: { column_name: string; data_type: string; ordinal_position: number }[],
  hiddenColumns: string[]
): ExportColumn[] {
  return schema
    .filter((c) => !hiddenColumns.includes(c.column_name))
    .sort((a, b) => a.ordinal_position - b.ordinal_position)
    .map((c) => ({
      column_name: c.column_name,
      header: prettifyHeader(c.column_name),
    }));
}
