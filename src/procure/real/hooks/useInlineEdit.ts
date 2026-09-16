import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { toast } from "sonner";

/** Which inline editor a column uses; null = not inline-editable (use the dialog). */
export type EditKind = "text" | "number" | "date" | "single" | "pillMulti" | null;

export interface EditCellTarget { id: unknown; key: string; }

/**
 * Airtable-style inline cell editing shared by the tracker tables. Holds the
 * single active edit target and commits a value to Supabase with an optimistic
 * cache patch (reverted on error). Realtime/refetch reconciles afterwards.
 */
export function useInlineEdit(tableName: string, queryKey: string) {
  const qc = useQueryClient();
  const [editCell, setEditCell] = useState<EditCellTarget | null>(null);

  const commit = useCallback(async (row: Record<string, unknown>, key: string, value: string) => {
    setEditCell(null);
    const id = (row as any).id;
    const current = (row as any)[key];
    const next: unknown = value === "" ? null : value;
    if (String(current ?? "") === String(next ?? "")) return; // no-op

    // Optimistic patch across every cached variant of this table's queries.
    const snapshots = qc.getQueriesData({ queryKey: [queryKey] });
    qc.setQueriesData({ queryKey: [queryKey] }, (old: any) =>
      Array.isArray(old) ? old.map((r: any) => (r && r.id === id ? { ...r, [key]: next } : r)) : old,
    );

    const { error } = await (supabase as any).from(tableName).update({ [key]: next }).eq("id", id);
    if (error) {
      snapshots.forEach(([k, d]) => qc.setQueryData(k, d)); // revert
      toast.error("Update failed: " + error.message);
    }
  }, [qc, tableName, queryKey]);

  return { editCell, setEditCell, commit };
}
