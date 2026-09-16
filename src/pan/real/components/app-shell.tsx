"use client";

import { useState, useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SidebarContent } from "./sidebar";
import { SessionWatcher } from "./session-watcher";
import { RealtimeRefresher } from "./realtime-refresher";
import { OrientationLock } from "./orientation-lock";
import { AutoUpdater } from "./auto-updater";
import NavTracer from "./nav-tracer";
import { ApkUpdater } from "./apk-updater";
import ApkFlag from "./apk-flag";
import { WfhActivityTracker } from "./wfh-activity-tracker";
import { ROLE_LABEL, type Role } from "@/lib/auth/rbac";

export type ShellUser = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
  avatar_url: string | null;
  permissions: string[];
  work_setup: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AppShell({
  children,
  user,
}: {
  children: ReactNode;
  user: ShellUser;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Sidebar badges are fetched CLIENT-SIDE (not awaited in the server layout) so the
  // shell paints instantly — no white flash. They refresh on navigation and are
  // best-effort. The /api/badges route does the same role-gating + cached RPC.
  const [badges, setBadges] = useState<Record<string, number>>({});
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    // ANG BADGE AY HINDI NAUUNA SA LAMAN (2026-08-30). Magaan na JSON ang
    // badge kaya nauuna itong dumating kaysa sa buong page render — kaya may
    // bilog nang "(1)" habang wala pa ang mismong hilera sa listahan, at
    // mukhang sira. Kapag NAGBAGO ang bilang, hilahin agad ang refresh ng
    // pahina para magkasabay silang dumating — sa pinakamasama, ang badge ay
    // nauuna na lang ng isang render, hindi ng minuto.
    let lastBadges = "";
    let lastKick = 0;
    const kicks: number[] = [];
    let lastKickReport = 0;
    const load = () =>
      fetch("/api/badges", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!alive || !j?.badges) return;
          setBadges(j.badges);
          const sig = JSON.stringify(j.badges);
          // May sariling gap (2026-08-31): ang refresh na ito ay HINDI
          // dumadaan sa throttle ng RealtimeRefresher, kaya sa masiglang oras
          // ay dagdag na buong render bawat badge delta — kasabwat sa
          // pagbagal. Minsan kada 5s ang sapat na paghabol.
          // Laktawan kung kaka-refresh lang ng realtime bell (≤10s): ang bell na
          // ang nagdala ng bagong bilang — dobleng buong render lang ito dati.
          const lastBell = (window as unknown as { __pan_last_refresh?: number }).__pan_last_refresh ?? 0;
          if (lastBadges && sig !== lastBadges && Date.now() - lastKick > 5_000 && Date.now() - lastBell > 10_000) {
            lastKick = Date.now();
            // Bantay (2026-09-05): kapag pabago-bago ang badges kada poll,
            // bawat 15s ay buong refresh — itala para makita sa Activity Logs.
            kicks.push(Date.now());
            while (kicks.length && Date.now() - kicks[0] > 120_000) kicks.shift();
            if (kicks.length >= 4 && Date.now() - lastKickReport > 5 * 60_000) {
              lastKickReport = Date.now();
              void fetch("/api/client-log", {
                method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
                body: JSON.stringify({ kind: "badge-refresh-storm", reason: `${lastBadges} -> ${sig}`.slice(0, 300), count: kicks.length, href: location.href, ua: navigator.userAgent }),
              }).catch(() => { /* offline */ });
            }
            router.refresh();
          }
          lastBadges = sig;
        })
        .catch(() => {});
    // Fetch on navigation + poll + agad na refetch pag bumalik ang focus.
    // HOSTINGER NA (2026-08-30): ang 60s ay presyo ng Vercel (ang dating 8s ay
    // ~450 calls/oras/device, ambag sa 698K invocations). Sa sariling VPS, ang
    // /api/badges ay magaan — 15s na para sumabay ang mga bilog sa sidebar sa
    // live na datos ng mga pahina.
    load();
    const id = setInterval(load, 15_000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { alive = false; clearInterval(id); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [pathname, router]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Live role/status updates without re-login */}
      <SessionWatcher userId={user.id} role={user.role} active={user.active} />
      {/* Live data: any public-schema change re-fetches for every user */}
      <RealtimeRefresher />
      {/* APK: portrait sa kiosk, landscape sa lahat ng iba */}
      <OrientationLock />
      {/* Silent auto-update: reload when a newer deploy ships (thin-shell APK stays current) */}
      <ApkFlag />
      <NavTracer />
      <AutoUpdater />
      {/* Native APK update: banner + 1-tap install when a new APK ships (icon/name/perms) */}
      <ApkUpdater />
      {/* WFH activity heartbeat — runs app-wide ONLY for WFH employees who are
          clocked in (source='wfh'); onsite/kiosk staff are not tracked. Self-gates
          via myWfhContext(); renders nothing for everyone else. */}
      <WfhActivityTracker />

      {/* Desktop sidebar — only ≥1280px (xl). Tablets (incl. landscape iPads at
          ~1024–1194px) use the drawer so pages get full width instead of the
          cramped sidebar-plus-content split. */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface xl:flex">
        <SidebarContent user={user} badges={badges} />
      </aside>

      {/* Drawer — mobile AND tablet (anything below xl) */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div
            className="pf-fade absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="pf-drawer absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col bg-surface shadow-2xl">
            <SidebarContent user={user} badges={badges} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            {/* Hamburger — mobile only */}
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-stone-100 xl:hidden"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
            <p className="text-sm text-muted">
              <span className="hidden sm:inline">Single Warehouse · </span>Main Branch
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium">{user.full_name}</p>
              <p className="text-xs text-muted">{ROLE_LABEL[user.role]}</p>
            </div>
            {user.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                loading="lazy"
                decoding="async"
                src={user.avatar_url}
                alt={user.full_name}
                className="h-8 w-8 rounded-full object-cover ring-1 ring-border"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initials(user.full_name)}
              </span>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Full-width content — walang max-width cap: ang malalapad na table
              (Sales Orders atbp.) ay ginagamit ang buong lapad ng screen imbes
              na mag-iwan ng patay na margin sa magkabilang gilid. */}
          <div className="w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
