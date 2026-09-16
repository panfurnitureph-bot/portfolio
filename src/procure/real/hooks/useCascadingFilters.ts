import { useMemo } from "react";

export type FilterColumnDef = {
  key: string;
  colName: string;
  label: string;
};

/**
 * Computes cascading / dependent filter options from an in-memory dataset.
 *
 * For each filter column, the available options are derived from
 * the rows that match ALL other active filters (excluding the current one).
 * This prevents showing misleading options that would yield zero results.
 *
 * Works for both client-side (full dataset in memory) and server-side pages
 * (pass the fetched distinct-options rows).
 */
export function useCascadingFilterOptions(
  /** The full dataset (or the batch used for distinct options) */
  allRows: Record<string, unknown>[],
  /** Filter column definitions */
  filterCols: FilterColumnDef[],
  /** Currently active filter selections keyed by filter key */
  activeFilters: Record<string, string[]>,
): Record<string, string[]> {
  return useMemo(() => {
    if (!allRows.length || !filterCols.length) return {};

    const result: Record<string, string[]> = {};

    for (const currentCol of filterCols) {
      // Apply all OTHER filters to the dataset
      let filtered = allRows;

      for (const otherCol of filterCols) {
        if (otherCol.key === currentCol.key) continue;
        const selected = activeFilters[otherCol.key];
        if (selected && selected.length > 0) {
          const selectedSet = new Set(selected);
          filtered = filtered.filter((row) => {
            const v = row[otherCol.colName];
            return v != null && selectedSet.has(String(v));
          });
        }
      }

      // Extract unique non-empty values from the remaining rows
      const unique = new Set<string>();
      for (const row of filtered) {
        const v = row[currentCol.colName];
        if (v != null && String(v).trim() !== "") unique.add(String(v));
      }

      result[currentCol.key] = Array.from(unique).sort((a, b) => a.localeCompare(b));
    }

    return result;
  }, [allRows, filterCols, activeFilters]);
}
