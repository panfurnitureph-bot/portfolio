import { createServerSupabase } from "@/lib/supabase/server";

export type AuditRow = {
  id: number;
  user_id: string | null;
  user_name: string | null;
  action_type: string;
  module: string;
  table_name: string | null;
  record_id: string | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  avatar_url: string | null; // joined from profiles
};

// Most-recent activity log entries. Returns [] if the table isn't there yet.
export async function loadAuditLog(limit = 300): Promise<AuditRow[]> {
  const db = createServerSupabase();
  const { data } = await db
    .from("audit_log")
    .select(
      "id, user_id, user_name, action_type, module, table_name, record_id, previous_value, new_value, ip_address, created_at",
    )
    // Only user-attributed actions. System/trigger rows (e.g. cascading
    // "Purchase Order Items" inserts with no actor) are noise — hide them.
    .not("user_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as AuditRow[];

  // Attach each actor's avatar.
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
  const byId = new Map<string, string | null>();
  if (ids.length) {
    const { data: profs } = await db.from("profiles").select("id, avatar_url").in("id", ids).limit(5000);
    for (const p of profs ?? []) byId.set(p.id as string, (p.avatar_url as string) ?? null);
  }
  for (const r of rows) r.avatar_url = r.user_id ? (byId.get(r.user_id) ?? null) : null;
  return rows;
}
