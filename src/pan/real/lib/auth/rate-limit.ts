import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

// Postgres-backed fixed-window rate limiter for serverless (no shared memory).
// One row per `key` in public.rate_limits holds the attempt count for the current
// window. Within the window we increment; once the window expires we reset to 1.
//
// BEST-EFFORT / FAIL-OPEN: any DB error returns { ok: true }. A throttle store
// outage must never lock out legitimate users (e.g. all logins). Nothing
// sensitive is logged.
//
// Returns ok:false (with retryAfter seconds) only once a real, persisted count
// exceeds maxAttempts inside the window.
export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<{ ok: boolean; retryAfter?: number }> {
  try {
    const db = createServerSupabase();
    const now = Date.now();

    const { data, error } = await db
      .from("rate_limits")
      .select("count, window_start")
      .eq("key", key)
      .maybeSingle();
    if (error) return { ok: true }; // fail open

    const windowMs = windowSeconds * 1000;
    const startMs = data?.window_start ? new Date(data.window_start).getTime() : 0;
    const inWindow = !!data && now - startMs < windowMs;

    if (inWindow) {
      const nextCount = (data!.count ?? 0) + 1;
      if (nextCount > maxAttempts) {
        const retryAfter = Math.max(1, Math.ceil((startMs + windowMs - now) / 1000));
        return { ok: false, retryAfter };
      }
      const { error: upErr } = await db
        .from("rate_limits")
        .update({ count: nextCount })
        .eq("key", key);
      if (upErr) return { ok: true }; // fail open
      return { ok: true };
    }

    // No row, or window expired → start a fresh window at count 1.
    const { error: upErr } = await db
      .from("rate_limits")
      .upsert({ key, count: 1, window_start: new Date(now).toISOString() }, { onConflict: "key" });
    if (upErr) return { ok: true }; // fail open
    return { ok: true };
  } catch {
    return { ok: true }; // fail open
  }
}
