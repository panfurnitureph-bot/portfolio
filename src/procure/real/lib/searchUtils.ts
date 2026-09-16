// searchUtils.ts
interface SchemaCol {
  column_name: string;
  data_type: string;
  ordinal_position: number;
}

export interface ColumnFilters {
  [columnName: string]: string;
}

const SEARCHABLE_TYPES = ["text", "character varying", "character", "varchar", "uuid", "citext", "char"];

export function getSearchableCols(schema: SchemaCol[]): string[] {
  return schema
    .filter((c) => SEARCHABLE_TYPES.some((t) => c.data_type.toLowerCase().includes(t)))
    .map((c) => c.column_name);
}

function escapeSearchTerm(term: string): string {
  return term.trim().replace(/%/g, "\\%").replace(/,/g, "\\,").replace(/[()]/g, " ");
}

export function buildSearchFilter(schema: SchemaCol[], searchTerm: string): string | null {
  const trimmed = (searchTerm ?? "").trim();
  if (!trimmed) return null;

  const cols = getSearchableCols(schema);
  if (!cols.length) return null;

  const escaped = escapeSearchTerm(trimmed);

  // global OR: col1.ilike.%q%,col2.ilike.%q%,...
  return cols.map((c) => `${c}.ilike.%${escaped}%`).join(",");
}

// Build column-specific filter conditions (AND logic)
export function buildColumnFilters(filters: ColumnFilters): { column: string; value: string }[] {
  return Object.entries(filters)
    .filter(([_, v]) => v && v.trim())
    .map(([col, val]) => ({
      column: col,
      value: val.trim().replace(/%/g, "\\%"),
    }));
}

// Apply both global search and column filters to a Supabase query
export function applySearchAndFilters<T extends { or: (f: string) => T; ilike: (col: string, pattern: string) => T }>(
  query: T,
  schema: SchemaCol[],
  searchTerm: string,
  columnFilters: ColumnFilters
): T {
  // Apply global search (OR across all text columns)
  const orFilter = buildSearchFilter(schema, searchTerm);
  if (orFilter) {
    query = query.or(orFilter);
  }

  // Apply column-specific filters (AND logic, each as ilike)
  const colFilters = buildColumnFilters(columnFilters);
  for (const { column, value } of colFilters) {
    query = query.ilike(column, `%${value}%`);
  }

  return query;
}
