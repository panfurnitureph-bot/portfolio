import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/session";

type AuditAction = "insert" | "update" | "delete" | "status_change" | "login" | "logout";

// Run best-effort background work SAFELY. A bare floating promise
// (void (async()=>…)()) that outlives the request handler crashes the function on Vercel
// ("An error occurred in the Server Components render") once the request context ends —
// this is what broke photo saves. So we AWAIT it (errors swallowed). It costs a couple of
// round-trips on the action's tail, but it never crashes. Next.js dedupes concurrent work
// and the audit RPC is fast; correctness beats the small latency here.
async function runBackground(fn: () => Promise<void>): Promise<void> {
  await fn().catch(() => {});
}

// Write an audit entry WITH the real actor. Service-role writes have no
// auth.uid(), so we pass the actor explicitly (DB looks up the name).
// Best-effort: never throws into the caller's flow.
export async function logAudit(opts: {
  actorId: string | null;
  action: AuditAction;
  module: string;
  table: string;
  recordId: string | number;
  prev?: unknown;
  next?: unknown;
}): Promise<void> {
  try {
    const db = createServerSupabase();
    await db.rpc("fn_write_audit", {
      p_action: opts.action,
      p_module: opts.module,
      p_table: opts.table,
      p_record_id: String(opts.recordId),
      p_prev: (opts.prev ?? null) as never,
      p_new: (opts.next ?? null) as never,
      p_actor: opts.actorId,
    });
  } catch {
    // auditing must not break the action
  }
}

// Current signed-in user's id (the actor), or null. Reads the cookie session
// only — no JWT round-trip, no profile/permission hydrate (the action already
// verified the user; we just need the id to stamp the audit row).
export async function currentActorId(): Promise<string | null> {
  try {
    return await getAuthUserId();
  } catch {
    return null;
  }
}

// Full row snapshot for before/after diffs.
export async function snapshot(
  table: string,
  id: number | string | null | undefined,
): Promise<unknown> {
  if (id == null) return null;
  try {
    const db = createServerSupabase();
    const { data } = await db.from(table).select("*").eq("id", id).maybeSingle();
    return data ?? null;
  } catch {
    return null;
  }
}

// One-liner audit for an action: resolves the actor itself.
//
// PERF: this is fire-and-forget. It returns IMMEDIATELY and does the actor lookup +
// audit RPC in the background, so a caller that does `await audit(...)` no longer blocks
// its response on 1-2 extra Supabase round-trips. Auditing is best-effort (logAudit
// swallows all errors), so nothing is lost by not awaiting the write. Existing
// `await audit(...)` calls keep working unchanged — they just resolve instantly now.
export async function audit(opts: {
  module: string;
  table: string;
  recordId: string | number;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await runBackground(async () => {
    const actorId = await currentActorId();
    await logAudit({
      actorId,
      action: opts.action,
      module: opts.module,
      table: opts.table,
      recordId: opts.recordId,
      prev: opts.before,
      next: opts.after,
    });
  });
}

// Like audit(), but takes the record location and reads the AFTER snapshot itself,
// in the background — so callers stop paying for `after: await snapshot(...)` (an extra
// read of the row they just wrote) on the critical path. Fire-and-forget.
export async function auditAfter(opts: {
  module: string;
  table: string;
  recordId: string | number;
  action: AuditAction;
  before?: unknown;
  snapshotId?: number | string | null;   // id to snapshot for `after` (defaults to recordId)
  snapshotTable?: string;                 // table to snapshot (defaults to `table`)
}): Promise<void> {
  await runBackground(async () => {
    const id = opts.snapshotId !== undefined ? opts.snapshotId : opts.recordId;
    const after = await snapshot(opts.snapshotTable || opts.table, id);
    const actorId = await currentActorId();
    await logAudit({
      actorId, action: opts.action, module: opts.module, table: opts.table,
      recordId: opts.recordId, prev: opts.before, next: after,
    });
  });
}
