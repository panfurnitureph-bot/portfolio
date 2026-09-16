"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { cn } from "./ui";
import { ROLE_LABEL, isTabletRole, type Role } from "@/lib/auth/rbac";
import { canViewPath } from "@/lib/auth/permissions";
import { signOut } from "@/lib/auth/actions";

type ShellUser = {
  full_name: string;
  email: string;
  role: Role;
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

// Ang listahan ng groups/items ay nasa lib/nav.ts (shared sa Permissions grid at
// sa role defaults) — dito lang ang pag-render.
import { GROUPS, type IconKey, type Item } from "@/lib/nav";
export { GROUPS };
export type { IconKey, Item };

// Flat list kept for any external consumer.
export const NAV = GROUPS.flatMap((g) => g.items).map(({ href, label }) => ({ href, label }));

export function Brand() {
  const [logoOk, setLogoOk] = useState(true);
  return (
    <button className="mx-3 mt-3 flex items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-stone-100">
      {logoOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/logo.png" alt="Pan Furniture" onError={() => setLogoOk(false)} className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-accent" />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-[11px] font-bold text-accent">PAN</div>
      )}
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-semibold">Pan Furniture</p>
        <p className="truncate text-xs text-muted">Warehouse IMS</p>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted"><path d="m7 15 5 5 5-5M7 9l5-5 5 5" /></svg>
    </button>
  );
}

// Full sidebar inner column: brand, search, grouped nav, profile.
// Wrapper: ang useSearchParams (para sa ?ws= active state) ay nangangailangan ng
// Suspense boundary sa app router — ito ang nagbibigay nito.
export function SidebarContent(props: { user: ShellUser; onNavigate?: () => void; badges?: Record<string, number> }) {
  return (
    <Suspense fallback={null}>
      <SidebarContentInner {...props} />
    </Suspense>
  );
}

// NASA LABAS ng SidebarContentInner (2026-09-06, "parang nagre-refresh"):
// dati nakapaloob ang ItemLink sa component — bagong component type ito sa
// BAWAT render para kay React, kaya sa bawat live refresh ay binubura at
// muling ginagawa ang lahat ng link (95 node kada refresh sa sukat) — iyon ang
// kislap ng sidebar. Stable na type = in-update lang ang teksto/badge.
function ItemLink({ item, active, badge, onNavigate }: { item: Item; active: boolean; badge: number; onNavigate?: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      prefetch
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        active ? "bg-stone-200/70 font-medium text-foreground" : "text-foreground/80 hover:bg-stone-100",
      )}
    >
      <NavIcon name={item.icon} className={cn("shrink-0", active ? "text-foreground" : "text-muted group-hover:text-foreground")} />
      <span className="flex-1 truncate">{item.label}</span>
      {badge > 0 && <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{badge}</span>}
    </Link>
  );
}

function SidebarContentInner({
  user,
  onNavigate,
  badges,
}: {
  user: ShellUser;
  onNavigate?: () => void;
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Longest-match wins: pag nasa /delivery/routes, ang "Driver Routes" lang ang
  // naka-shade — hindi pati ang parent na "/delivery" (Delivery Scheduling).
  // Ang mga link na may ?ws= (workshop groups) ay tumutugma lang kapag pareho
  // rin ang kasalukuyang ?ws — para isang workshop group lang ang naka-shade.
  const hrefBase = (href: string) => href.split(/[#?]/)[0];
  const hrefWs = (href: string) => /[?&]ws=([a-z0-9-]+)/.exec(href)?.[1] ?? null;
  const curWs = search.get("ws");
  const matches = (href: string) => {
    const base = hrefBase(href);
    if (!(pathname === base || pathname.startsWith(base + "/"))) return false;
    const ws = hrefWs(href);
    return ws == null || ws === curWs;
  };
  const isActive = (href: string) =>
    matches(href) &&
    !GROUPS.some((g) => g.items.some((i) => i.href !== href && hrefBase(i.href).length > hrefBase(href).length && matches(i.href)));

  // Admin/manager manage attendance via the main Attendance page — the WFH
  // self-clock link ("/hr/wfh") is for regular employees. Managers instead get the
  // "WFH Activity Monitor" link ("/hr/wfh#activity") which opens the same page's
  // team activity dashboard. So: hide self-clock for managers, hide the monitor
  // for non-managers (they see Activity inside their own WFH page).
  const isManager = user.role === "administrator" || user.role === "operations_manager";
  // WFH monitoring is an HR/admin function, NOT an Operations-Manager one — the OM
  // shouldn't see the team WFH Activity Monitor (or any HR page). Gate the monitor on
  // HR/admin specifically.
  const isHrManager = user.role === "administrator" || user.role === "human_resources";

  // WFH self-clock ("/hr/wfh") is only for staff whose work setup is WFH or Hybrid.
  // Onsite staff never see the Face-ID WFH attendance link.
  const isWfhStaff = /wfh|hybrid/i.test(user.work_setup ?? "");

  // Returns / RMA is defined in BOTH the Warehouse and Sales & Service groups
  // (warehouse/delivery teams declare on the spot; sales reps declare on callback).
  // Show it ONCE per user to avoid a duplicate: if they can see the Warehouse group
  // (admin/manager/warehouse), keep the Warehouse copy; a pure Sales user keeps the
  // Sales copy. Same destination either way.
  const seesWarehouse = canViewPath(user, "/delivery") || canViewPath(user, "/inventory");

  // "Coming soon" placeholder modules (Integrations + Reports & Analytics, all
  // under /soon/*) are admin/developer only — staff shouldn't see unbuilt features.
  const isAdminDev = user.role === "administrator" || user.role === "developer";

  // Ang Order Mapping Tracker ay naka-lista sa Sales & Service AT Operations
  // Manager. Isang beses lang ipakita: Ops/admin → sa Operations group; puro
  // Sales → sa Sales & Service group (view-only na bersyon nila).
  const seesOps = canViewPath(user, "/operations/approval");

  // Only show nav this user can view (role + per-module permissions). Empty groups drop.
  const visibleGroups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) =>
      canViewPath(user, i.href.split(/[#?]/)[0]) &&
      // Workshop groups (?ws=<slug>): Admin/Dev, SARILING workshop tablet, o
      // sinumang may ws_* na tik sa permission grid (canViewPath sa itaas ang
      // nagsusuri nito). ANG GRID ANG GATE (2026-09-07): wala nang Ops fallback —
      // lumalabas dati ang tatlong workshop group kay Ashley kahit walang tik.
      !((() => {
        const ws = /[?&]ws=([a-z0-9-]+)/.exec(i.href)?.[1];
        if (!ws) return false;
        const roleForSlug: Record<string, string> = {
          "gma-original-workshop": "workshop_gma_original",
          "gma-white-workshop": "workshop_gma_white",
          "production-area": "workshop_gma_white",
          "lrt-workshop": "workshop_lrt",
        };
        const isMine = (user.role as string) === roleForSlug[ws];
        const inGrid = user.permissions.length > 0; // canViewPath na ang nagpasa ng ws_* view
        return !(isAdminDev || isMine || inGrid);
      })()) &&
      // WFH self-clock: managers use the main Attendance page instead; Onsite staff
      // don't do WFH at all — only WFH/Hybrid non-managers see it.
      // Attendance (WFH) self-clock: lalabas sa SINUMANG naka-WFH/Hybrid ang
      // Work setup (sa HR employee form) — anuman ang role — at laging kita sa
      // tablet roles (Delivery Team / Workshop). Ang Onsite lang ang walang nito.
      // ANG WORK SETUP ANG MASUSUNOD (2026-09-03, "wala naman WFH pero may"):
      // ang dating "laging kita sa tablet roles" ay para sa shared tablet na
      // WALANG employee record. Sa unified directory, ang personal na account
      // na naka-link sa empleyado ay may work_setup na — Onsite = walang
      // Attendance (WFH), kahit workshop/delivery ang role. Ang tablet
      // fallback ay para na lang sa account na walang kilalang work setup.
      !(i.href === "/hr/wfh" && !isWfhStaff && !(isTabletRole(user.role) && !(user.work_setup ?? "").trim())) &&
      !(i.href === "/hr/wfh#activity" && !isHrManager) &&
      // "coming soon" placeholders: admin/developer only
      !(i.href.startsWith("/soon/") && !isAdminDev) &&
      // Tablet roles: ang "/delivery" at "/installation" ay pang-ACTION guard
      // lang (nasa ACCESS nila) — huwag ipakita ang mga page entry ng mga ito.
      !(isTabletRole(user.role) && (i.href === "/delivery" || i.href === "/installation")) &&
      // Delivery Team A–D groups (2026-09-05): permission-based na — canViewPath
      // sa itaas (team module: grant sa grid, sariling team ng tablet, Ops, Admin).
      // de-dup the Returns entry to a single group per user
      !(i.href === "/returns" && g.title === "Warehouse" && !seesWarehouse) &&
      !(i.href === "/returns" && g.title === "Sales & Service" && seesWarehouse) &&
      // de-dup ang Order Mapping Tracker sa iisang group per user
      !(i.href === "/operations/process-map" && g.title === "Sales & Service" && seesOps) &&
      !(i.href === "/operations/process-map" && g.title === "Operations Manager" && !seesOps) &&
      // Dashboard + Customer List ay pinagsama-sama na sa PAN Overall (admin lang)
      // — tinatago ang standalone na link para sa lahat; ang laman ay naa-access
      // pa rin sa loob ng PAN Overall tab (o sa direktang URL).
      i.href !== "/dashboard" &&
      i.href !== "/customers" &&
      // PAN Overall + Payment Approval — admin LANG (may isAdmin guard din ang page).
      !(i.href === "/hr/overall" && !isAdminDev) &&
      !(i.href === "/payment-approval" && !isAdminDev),
    ),
  })).filter((g) => g.items.length > 0);
  return (
    <div className="flex h-full flex-col">
      <Brand />

      {/* Nav */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-3 pt-2">
        {
          visibleGroups.map((group, gi) => {
            const isOpen = !collapsed[group.title ?? `g${gi}`];
            return (
              <div key={group.title ?? `g${gi}`} className="space-y-1">
                {group.title && (
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [group.title!]: isOpen }))}
                    // Section header — cream band + gold accent bar + espresso text para
                    // kitang-kita ang paghahati ng mga grupo (enterprise look).
                    className="mt-1.5 flex w-full items-center justify-between rounded-md border-l-[3px] border-l-[#caa45a] bg-[#f4ead8]/60 px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#4a3b1a] transition-colors hover:bg-[#f4ead8]"
                  >
                    <span className="min-w-0 truncate whitespace-nowrap" title={group.title}>{group.title}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0 transition-transform", isOpen ? "" : "-rotate-90")}><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                )}
                {isOpen && group.items.map((item) => <ItemLink key={item.href} item={item} active={isActive(item.href)} badge={badges?.[item.href] ?? 0} onNavigate={onNavigate} />)}
              </div>
            );
          })
        }
      </nav>

      {/* Profile + account menu */}
      <ProfileMenu user={user} onNavigate={onNavigate} />
    </div>
  );
}

// Avatar (image or initials).
function Avatar({ user, size = 9 }: { user: ShellUser; size?: 8 | 9 | 10 }) {
  const cls = size === 10 ? "h-10 w-10" : size === 8 ? "h-8 w-8" : "h-9 w-9";
  if (user.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        loading="lazy"
        decoding="async"
        src={user.avatar_url}
        alt={user.full_name}
        className={cn(cls, "shrink-0 rounded-full object-cover ring-1 ring-border")}
      />
    );
  }
  return (
    <span className={cn(cls, "flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary")}>
      {initials(user.full_name)}
    </span>
  );
}

const ROLE_PILL: Record<Role, { label: string; cls: string }> = {
  developer: { label: "Dev", cls: "bg-slate-800 text-white" },
  administrator: { label: "Admin", cls: "bg-red-600 text-white" },
  human_resources: { label: "HR", cls: "bg-pink-600 text-white" },
  operations_manager: { label: "Manager", cls: "bg-indigo-600 text-white" },
  sales_staff: { label: "Sales", cls: "bg-emerald-600 text-white" },
  warehouse_staff: { label: "Warehouse", cls: "bg-amber-600 text-white" },
  attendance_kiosk: { label: "Kiosk", cls: "bg-teal-600 text-white" },
  delivery_team_a: { label: "Delivery", cls: "bg-sky-600 text-white" },
  delivery_team_b: { label: "Team B", cls: "bg-sky-600 text-white" },
  delivery_team_c: { label: "Team C", cls: "bg-sky-600 text-white" },
  delivery_team_d: { label: "Team D", cls: "bg-sky-600 text-white" },
  workshop_gma_original: { label: "GMA Orig", cls: "bg-orange-600 text-white" },
  workshop_gma_white: { label: "Production", cls: "bg-orange-600 text-white" },
  workshop_lrt: { label: "LRT", cls: "bg-orange-600 text-white" },
};

function RolePill({ role }: { role: Role }) {
  const p = ROLE_PILL[role];
  return (
    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none", p.cls)}>
      {p.label}
    </span>
  );
}

function ProfileMenu({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative border-t border-border">
      {/* Click-away backdrop */}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}

      {/* Popover menu (opens upward) */}
      {open && (
        <div className="absolute bottom-full left-2 right-2 z-50 mb-2 rounded-xl border border-border bg-surface p-1.5 shadow-xl">
          <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
            <Avatar user={user} size={9} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-medium">{user.full_name}</p>
                <RolePill role={user.role} />
              </div>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
          </div>

          <div className="my-1 border-t border-border" />

          <Link
            href="/settings"
            onClick={() => { setOpen(false); onNavigate?.(); }}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-stone-100"
          >
            <NavIcon name="gear" className="text-muted" />
            Settings
          </Link>

          <form action={signOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-danger hover:bg-red-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5M21 12H9" />
              </svg>
              Log out
            </button>
          </form>
        </div>
      )}

      {/* Trigger row */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-3 py-3 text-left hover:bg-stone-50"
      >
        <Avatar user={user} size={9} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium">{user.full_name}</p>
          <p className="truncate text-xs text-muted">{ROLE_LABEL[user.role]}</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0 text-muted transition-transform", open ? "rotate-180" : "")}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}

// ── Icons ──

export function NavIcon({ name, className }: { name: IconKey; className?: string }) {
  const p: Record<IconKey, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
    box: <><path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /></>,
    barcode: <path d="M3 5v14M7 5v14M11 5v14M14 5v14M18 5v14M21 5v14" />,
    cart: <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.4 12.4a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 7H6" /></>,
    inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5 5h14l3 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6Z" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m9 12 2 2 4-4" /></>,
    pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>,
    swap: <><path d="M7 4 3 8l4 4" /><path d="M3 8h14" /><path d="m17 20 4-4-4-4" /><path d="M21 16H7" /></>,
    receipt: <><path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1Z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    truck: <><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>,
    wrench: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 18l3 3 6.5-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-2.4 2.5-3.2Z" />,
    rotate: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
    chart: <><path d="M3 3v18h18" /><rect x="7" y="10" width="3" height="7" /><rect x="12" y="6" width="3" height="11" /><rect x="17" y="13" width="3" height="4" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.4 3 8.5 7 9.7 4-1.2 7-5.3 7-9.7V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-3.5-5.4" /></>,
    edit: <><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>,
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {p[name]}
    </svg>
  );
}
