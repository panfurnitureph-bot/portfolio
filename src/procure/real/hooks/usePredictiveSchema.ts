import { useQuery } from '@tanstack/react-query';
import { externalSupabase } from '@/integrations/supabase/externalClient';

export interface SchemaColumn {
  column_name: string;
  data_type: string;
  ordinal_position: number;
}

const HIDDEN_COLUMNS = ['created_at', 'updated_at', 'refreshed_at'];

export function usePredictiveSchema() {
  return useQuery({
    queryKey: ['predictive-purchasing-schema'],
    queryFn: async () => {
      const { data, error } = await externalSupabase.rpc('get_table_columns', {
        p_schema: 'public',
        p_table: 'predictive_purchasing',
      });
      if (error) throw error;
      const cols = (data as SchemaColumn[]) ?? [];
      return cols
        .filter((c) => !HIDDEN_COLUMNS.includes(c.column_name))
        .sort((a, b) => a.ordinal_position - b.ordinal_position);
    },
    staleTime: 5 * 60 * 1000,
  });
}

const TEXT_TYPES = ['text', 'character varying', 'character', 'varchar', 'uuid', 'char'];
const NUMERIC_TYPES = ['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision', 'decimal'];
const DATE_TYPES = ['timestamp with time zone', 'timestamp without time zone', 'date', 'time', 'timestamptz'];
const BOOL_TYPES = ['boolean'];

export function isTextType(dt: string) {
  return TEXT_TYPES.some((t) => dt.toLowerCase().includes(t));
}
export function isNumericType(dt: string) {
  return NUMERIC_TYPES.some((t) => dt.toLowerCase().includes(t));
}
export function isDateType(dt: string) {
  return DATE_TYPES.some((t) => dt.toLowerCase().includes(t));
}
export function isBoolType(dt: string) {
  return BOOL_TYPES.some((t) => dt.toLowerCase().includes(t));
}

export function getSearchableColumns(schema: SchemaColumn[]): string[] {
  return schema
    .filter((c) => isTextType(c.data_type))
    .map((c) => c.column_name)
    .slice(0, 8);
}

export function formatHeader(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatCellValue(value: unknown, dataType: string): { display: string; isLink: boolean } {
  if (value === null || value === undefined) return { display: '—', isLink: false };

  if (isBoolType(dataType)) return { display: value ? 'Yes' : 'No', isLink: false };

  if (isDateType(dataType)) {
    try {
      const d = new Date(value as string);
      if (!isNaN(d.getTime())) {
        return {
          display: d.toLocaleString('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
          }),
          isLink: false,
        };
      }
    } catch { /* fallthrough */ }
  }

  if (isNumericType(dataType)) {
    const n = Number(value);
    if (!isNaN(n)) {
      // Round-half-up for display only: 8.5 → 9, 94.5 → 95, -14.5 → -14
      const rounded = Math.sign(n) * Math.floor(Math.abs(n) + 0.5);
      return { display: rounded.toLocaleString('en-US'), isLink: false };
    }
  }

  const str = String(value);
  if (str.startsWith('http://') || str.startsWith('https://')) {
    return { display: str, isLink: true };
  }

  if (typeof value === 'object') return { display: JSON.stringify(value), isLink: false };
  return { display: str, isLink: false };
}
