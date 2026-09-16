import type { createServerSupabase } from "@/lib/supabase/server";

// NAKATAKDANG QA INSPECTOR KADA WORKSHOP (0236, Joe 2026-09-06): ang ₱100 QC
// inspection fee ng bawat aprubadong declaration ay sa QA ng workshop na iyon
// (LRT + GMA White → Dwight Palma; GMA Original → Gilbert Adie de Guzman),
// hindi sa kung sino ang nag-declare. Null kapag wala pang 0236 o walang
// nakatakda — babalik ang tumatawag sa dating asal (qc_name).

type Db = ReturnType<typeof createServerSupabase>;
export type QaInspector = { id: number; name: string; fee: number; workshop: string };

export async function qaInspectorFor(db: Db, workshopName: string | null | undefined): Promise<QaInspector | null> {
  const ws = String(workshopName ?? "").trim();
  if (!ws) return null;
  try {
    const { data, error } = await db.from("workshop")
      .select("name, qa_employee_id, qa_fee")
      .ilike("name", ws).limit(1);
    if (error || !data?.length) return null;
    const row = data[0] as { name: string; qa_employee_id: number | null; qa_fee: number | null };
    if (!row.qa_employee_id) return null;
    const { data: emp } = await db.from("employees").select("id, name, active").eq("id", row.qa_employee_id).maybeSingle();
    if (!emp || emp.active === false) return null;
    return { id: Number(emp.id), name: String(emp.name ?? ""), fee: Math.max(Number(row.qa_fee ?? 100) || 0, 0), workshop: row.name };
  } catch { return null; }
}

// Lahat ng workshop na may QA — para sa UI (declare form, settings).
export async function qaInspectorMap(db: Db): Promise<Record<string, QaInspector>> {
  const out: Record<string, QaInspector> = {};
  try {
    const { data, error } = await db.from("workshop").select("name, qa_employee_id, qa_fee").eq("active", true);
    if (error || !data) return out;
    const ids = [...new Set((data as { qa_employee_id: number | null }[]).map((r) => r.qa_employee_id).filter((x): x is number => !!x))];
    if (!ids.length) return out;
    const { data: emps } = await db.from("employees").select("id, name, active").in("id", ids);
    const byId = new Map((emps ?? []).map((e) => [Number(e.id), e as { id: number; name: string; active: boolean | null }]));
    for (const r of data as { name: string; qa_employee_id: number | null; qa_fee: number | null }[]) {
      const e = r.qa_employee_id ? byId.get(r.qa_employee_id) : undefined;
      if (!e || e.active === false) continue;
      out[r.name] = { id: Number(e.id), name: String(e.name ?? ""), fee: Math.max(Number(r.qa_fee ?? 100) || 0, 0), workshop: r.name };
    }
  } catch { /* wala pang 0236 */ }
  return out;
}
