import { useState, useCallback } from "react";

export interface ColumnFilters {
  [columnName: string]: string;
}

export function useColumnFilters(initialFilters: ColumnFilters = {}) {
  const [filters, setFilters] = useState<ColumnFilters>(initialFilters);

  const setFilter = useCallback((columnName: string, value: string) => {
    setFilters((prev) => {
      if (!value || !value.trim()) {
        const { [columnName]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [columnName]: value };
    });
  }, []);

  const clearFilters = useCallback(() => setFilters({}), []);

  const clearFilter = useCallback((columnName: string) => {
    setFilters((prev) => {
      const { [columnName]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const hasActiveFilters = Object.keys(filters).length > 0;
  const activeFilterCount = Object.keys(filters).length;

  return {
    filters,
    setFilter,
    clearFilter,
    clearFilters,
    hasActiveFilters,
    activeFilterCount,
  };
}
