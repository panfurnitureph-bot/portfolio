import { useQuery } from "@tanstack/react-query";
import { externalSupabase } from "@/integrations/supabase/externalClient";
import { useMemo, useCallback, useRef, useState } from "react";

export type LazyFilterColumnDef = {
  key: string;
  colName: string;
  label: string;
};

/**
 * Fetches distinct values for filter columns lazily from the backend.
 * Only fetches when a filter is opened (or all on mount with prefetch).
 * Caches results with a long staleTime so repeated opens are instant.
 */
export function useLazyFilterOptions(
  tableName: string,
  queryKeyPrefix: string,
  filterCols: LazyFilterColumnDef[],
  /** Optional: columns to apply as cross-filters when fetching options */
  activeFilters?: Record<string, string[]>,
) {
  // Track which filters have been opened so we only fetch on demand
  const [openedFilters, setOpenedFilters] = useState<Set<string>>(new Set());

  const markOpened = useCallback((key: string) => {
    setOpenedFilters((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  // Build a stable key for active filters (excluding the current column)
  const crossFilterKey = useMemo(() => {
    if (!activeFilters) return "";
    return JSON.stringify(activeFilters);
  }, [activeFilters]);

  // Single query that fetches distinct values for ALL opened filter columns
  // This is more efficient than N separate queries
  const { data: allOptions, isLoading } = useQuery({
    queryKey: [queryKeyPrefix, "filter-options", [...openedFilters].sort().join(","), crossFilterKey],
    queryFn: async () => {
      const results: Record<string, string[]> = {};
      const colsToFetch = filterCols.filter((fc) => openedFilters.has(fc.key));

      if (colsToFetch.length === 0) return results;

      // Fetch distinct values for each column in parallel
      const promises = colsToFetch.map(async (fc) => {
        // Build a query that applies all OTHER active filters (cascading)
        const selectCol = fc.colName;
        let q = externalSupabase
          .from(tableName)
          .select(selectCol);

        // Apply cross-filters (all filters except the current one)
        if (activeFilters) {
          for (const otherFc of filterCols) {
            if (otherFc.key === fc.key) continue;
            const selected = activeFilters[otherFc.key];
            if (selected && selected.length > 0) {
              q = q.in(otherFc.colName, selected);
            }
          }
        }

        // Fetch up to 5000 distinct values (more than enough for any filter)
        q = q.not(selectCol, "is", null).limit(5000);

        const { data, error } = await q;
        if (error) throw error;

        // Extract unique values
        const unique = new Set<string>();
        for (const row of (data || []) as Record<string, unknown>[]) {
          const v = row[selectCol];
          if (v != null && String(v).trim() !== "") unique.add(String(v));
        }

        return { key: fc.key, values: Array.from(unique).sort((a, b) => a.localeCompare(b)) };
      });

      const resolved = await Promise.all(promises);
      for (const r of resolved) results[r.key] = r.values;

      // Carry forward already-loaded options for filters not re-fetched
      return results;
    },
    enabled: openedFilters.size > 0,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
    refetchOnWindowFocus: false,
  });

  // Merge: for filters not yet opened, return empty array
  const optionsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const fc of filterCols) {
      map[fc.key] = allOptions?.[fc.key] || [];
    }
    return map;
  }, [filterCols, allOptions]);

  const isLoadingFor = useCallback(
    (key: string) => isLoading && openedFilters.has(key),
    [isLoading, openedFilters],
  );

  return { optionsMap, markOpened, isLoadingFor };
}
