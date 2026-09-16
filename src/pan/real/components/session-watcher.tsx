"use client";

import { useEffect } from "react";
import { autoReload } from "@/lib/reload-guard";
import { useRouter } from "next/navigation";
import { createBrowserSupabase, realtimeReady } from "@/lib/supabase/client";
import { signOut } from "@/lib/auth/actions";

// Subscribes to the signed-in user's own profile row via Supabase Realtime.
// When an admin changes their role -> refresh server components so the sidebar
// and route gates update instantly (no re-login). When deactivated -> sign out.
//
// Requires (run once in Supabase):
//   alter table profiles enable row level security;
//   create policy "read own profile" on profiles for select using (id = auth.uid());
//   alter publication supabase_realtime add table profiles;
export function SessionWatcher({
  userId,
  role,
  active,
}: {
  userId: string;
  role: string;
  active: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    const sb = createBrowserSupabase();
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;
    // Token muna bago subscribe (2026-09-05) — anon join = walang events.
    void realtimeReady().then(() => {
    if (cancelled) return;
    channel = sb
      .channel(`profile:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          console.log("[SessionWatcher] profile change:", payload.new);
          const next = payload.new as { role?: string; status?: string };
          const nowActive = next.status === "active";

          // Deactivated mid-session -> kill the session and bounce to login.
          if (!nowActive) {
            void signOut();
            return;
          }

          // Role changed (or reactivated) -> HARD reload, not router.refresh(). A soft
          // RSC refresh re-runs the root layout, and if the new role lost access to the
          // CURRENT page the layout issues a redirect() mid-refresh — which the client
          // (and especially the APK WebView) can't resolve, leaving a blank white screen
          // that only a manual reload fixes. A full navigation lets the server redirect
          // cleanly to the new role's home. Guard against reload loops with a flag.
          if (next.role !== role || nowActive !== active) {
            if (typeof window !== "undefined") {
              // TUNAY NA LOOP GUARD (2026-09-03, "refresh sya ng refresh"): ang
              // lumang komento ay nangako ng flag pero wala — kapag ang props
              // (galing sa server render) ay hindi tumugma sa row kahit
              // PAGKATAPOS ng reload, walang hanggang blink ang page. Isang
              // reload lang kada 15s; ang sumunod ay nilalaktawan at
              // ini-report sa console para makita ang pinagmulan.
              try {
                const k = "pf-session-reload-at";
                const last = Number(sessionStorage.getItem(k) || 0);
                if (Date.now() - last < 15_000) {
                  console.warn("[SessionWatcher] reload suppressed (loop guard). Row:", payload.new, "· props:", { role, active });
                  return;
                }
                sessionStorage.setItem(k, String(Date.now()));
              } catch { /* storage blocked — tuloy pa rin ang isang reload */ }
              autoReload("session: role/status changed");
            } else {
              router.refresh();
            }
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_permissions",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // PERMISSIONS OVERRIDE NG SARILI (2026-09-03, "nag bigay ako ng role
          // pero di nagsshow"): ang grant/deny sa user_permissions ay hindi
          // gumagalaw sa profiles row, kaya walang nakakaalam ang device ng
          // apektadong user — ngayon, soft refresh agad para sumulpot ang
          // bagong pahina sa sidebar nang hindi naghihintay ng relogin.
          router.refresh();
        },
      )
      .subscribe((status, err) => {
        console.log("[SessionWatcher] channel status:", status, err ?? "");
      });
    });

    return () => {
      cancelled = true;
      if (channel) void sb.removeChannel(channel);
    };
  }, [userId, role, active, router]);

  return null;
}
