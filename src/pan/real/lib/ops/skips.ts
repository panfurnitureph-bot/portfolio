import type { createServerSupabase } from "@/lib/supabase/server";

// SKIP ROWS NA MAY KULAY (Joe 2026-09-06, migration 0234). Ang identity ng isang
// "No Workshop Needed" na linya ay (order_id, item_desc, color) na — parehong
// produkto sa magkaibang kulay = magkahiwalay na skip. Hanggang hindi pa
// tumatakbo ang 0234, walang `color` column: bumabagsak sa dating select at
// '' ang kulay (legacy = tumutugma sa alinmang kulay, gaya ng dati).
export type SkipRow = { order_id: number; item_desc: string; color: string };

type Db = ReturnType<typeof createServerSupabase>;

export async function loadSkipRows(db: Db): Promise<SkipRow[]> {
  const withColor = await db.from("ops_line_skip").select("order_id, item_desc, color").limit(20000);
  if (!withColor.error) {
    return ((withColor.data ?? []) as { order_id: number; item_desc: string; color: string | null }[])
      .map((r) => ({ order_id: r.order_id, item_desc: r.item_desc, color: (r.color ?? "").trim() }));
  }
  const legacy = await db.from("ops_line_skip").select("order_id, item_desc").limit(20000);
  return ((legacy.data ?? []) as { order_id: number; item_desc: string }[])
    .map((r) => ({ order_id: r.order_id, item_desc: r.item_desc, color: "" }));
}

// Susi ng pagtutugma: kapag may kulay ang skip row, eksakto ang tugma; ang
// legacy row (walang kulay) ay tumutugma sa alinmang kulay ng parehong linya.
export function skipKeys(rows: SkipRow[], descOf: (desc: string) => string): { exact: Set<string>; any: Set<string> } {
  const exact = new Set<string>();
  const any = new Set<string>();
  for (const r of rows) {
    const d = descOf(r.item_desc);
    if (r.color) exact.add(`${r.order_id}|${d}|${r.color.toLowerCase()}`);
    else any.add(`${r.order_id}|${d}`);
  }
  return { exact, any };
}

export function isSkipped(keys: { exact: Set<string>; any: Set<string> }, orderId: number, desc: string, color: string | null | undefined): boolean {
  return keys.any.has(`${orderId}|${desc}`) || keys.exact.has(`${orderId}|${desc}|${(color ?? "").trim().toLowerCase()}`);
}

// ISANG SKIP = ISANG LINYA (Joe 2026-09-06, "dito per color na rin dapat"): ang
// lumang skip row na walang kulay ay tumutugma dati sa LAHAT ng kulay ng
// produktong iyon sa order — kaya nawawala sa To Assign pati ang mga kulay na
// hindi naman na-skip. Ang matcher na ito ay may badyet: bawat legacy row ay
// nagtatago ng ISANG linya lang (ang unang makita), at ang may-kulay na row ay
// eksakto sa sariling kulay. Tawagin nang isang beses kada linya ng order.
export function makeSkipMatcher(rows: SkipRow[], descOf: (desc: string) => string): (orderId: number, desc: string, color: string | null | undefined) => boolean {
  const keys = skipKeys(rows, descOf);
  const legacyBudget = new Map<string, number>();
  for (const r of rows) {
    if (r.color) continue;
    const k = `${r.order_id}|${descOf(r.item_desc)}`;
    legacyBudget.set(k, (legacyBudget.get(k) ?? 0) + 1);
  }
  // May-kulay na row laban sa linyang WALANG kulay (2026-09-06, ORD-000007 "di
  // ma-skip"): ang website line ay walang `color`, pero ang skip ay naitala na
  // may kulay mula sa catalog — dapat magtugma pa rin, isang linya kada row.
  const coloredBudget = new Map<string, number>();
  for (const r of rows) {
    if (!r.color) continue;
    const k = `${r.order_id}|${descOf(r.item_desc)}`;
    coloredBudget.set(k, (coloredBudget.get(k) ?? 0) + 1);
  }
  return (orderId, desc, color) => {
    const c = (color ?? "").trim().toLowerCase();
    if (keys.exact.has(`${orderId}|${desc}|${c}`)) return true;
    const k = `${orderId}|${desc}`;
    const left = legacyBudget.get(k) ?? 0;
    if (left > 0) { legacyBudget.set(k, left - 1); return true; }
    if (!c) {
      const cl = coloredBudget.get(k) ?? 0;
      if (cl > 0) { coloredBudget.set(k, cl - 1); return true; }
    }
    return false;
  };
}
