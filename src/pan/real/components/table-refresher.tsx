"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase, realtimeReady } from "@/lib/supabase/client";

// Targeted live refresher for ONE table.
//
// The global RealtimeRefresher (components/realtime-refresher.tsx) deliberately
// ignores high-churn tables (received_parts, *_log, audit_log, ...) so a write
// storm doesn't refresh every signed-in user's whole UI. But the few pages that
// actually *display* one of those tables (the stock-movement ledger, scan
// station) still want to update live for the people
// looking at them. Mount this on those pages, scoped to just that table:
// changes only refresh viewers of this page, not the whole app.
//
// Same debounce strategy as the global refresher: collapse a burst of writes
// into one router.refresh(), with a hard ceiling so a continuous stream still
// refreshes ~every MAX_WAIT instead of starving.
const DEBOUNCE_MS = 600;
const MAX_WAIT_MS = 3000;

export function TableRefresher({ table }: { table: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPending = useRef(0);
  const hadConnected = useRef(false);

  useEffect(() => {
    const sb = createBrowserSupabase();

    const fire = () => {
      timer.current = null;
      firstPending.current = 0;
      router.refresh();
    };

    let alive = true;
    let channel: ReturnType<typeof sb.channel> | null = null;
    // Token muna bago subscribe (2026-09-05) — anon join = walang events.
    void realtimeReady().then(() => {
    if (!alive) return;
    channel = sb
      .channel(`table:${table}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          // Background tab: skip — refreshes on next focus via real navigation.
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

          const now = Date.now();
          if (!firstPending.current) firstPending.current = now;
          if (timer.current) clearTimeout(timer.current);
          const waited = now - firstPending.current;
          const delay = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - waited));
          timer.current = setTimeout(fire, delay);
        },
      )
      .subscribe((status) => {
        // Reconnect refetch — habulin ang mga events na nawala habang putol.
        if (status === "SUBSCRIBED") {
          if (hadConnected.current) router.refresh();
          hadConnected.current = true;
        }
      });
    });

    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      if (channel) void sb.removeChannel(channel);
    };
  }, [router, table]);

  return null;
}
