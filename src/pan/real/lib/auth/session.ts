import "server-only";
import { cache } from "react";
import { createAuthClient } from "@/lib/supabase/auth-server";
import { createServerSupabase } from "@/lib/supabase/server";
import { ROLES, isAdmin, type Role } from "./rbac";
import { isAdminOnlyModule, roleDefaultKeys } from "./permissions";

export type SessionUser = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  active: boolean;
  avatar_url: string | null;
  // Effective "module:action" strings (role grants minus user denies plus user
  // grants). Empty for admin (handled by isAdmin) or when the catalogue is unseeded.
  permissions: string[];
  // Work setup from the matching employee record (Onsite | WFH | Hybrid). Gates the
  // WFH self-clock link — only WFH/Hybrid staff see it. 'Onsite' if no match.
  work_setup: string;
};

// Resolve effective per-module permissions for a non-admin user.
async function loadPermissions(
  db: ReturnType<typeof createServerSupabase>,
  userId: string,
  role: Role,
): Promise<string[]> {
  const [{ data: roleRows }, { data: userRows }] = await Promise.all([
    db
      .from("role_permissions")
      .select("permissions(module, action)")
      .eq("role", role),
    db
      .from("user_permissions")
      .select("effect, permissions(module, action)")
      .eq("user_id", userId),
  ]);

  type PermRef = { module: string; action: string } | { module: string; action: string }[] | null;
  const keyOf = (p: PermRef): string | null => {
    const row = Array.isArray(p) ? p[0] : p;
    return row ? `${row.module}:${row.action}` : null;
  };

  // ROLE DEFAULT MULA SA CODE (2026-09-05): ang sidebar group ng role ang
  // default — kasama ito kahit hindi pa naka-seed sa role_permissions ng DB.
  // Ang Website/System/admin-only na seed sa DB ay HINDI binibilang sa
  // non-admin (admin lang ang nakakakita nito).
  const eff = new Set<string>(roleDefaultKeys(role));
  for (const r of roleRows ?? []) {
    const k = keyOf(r.permissions as PermRef);
    if (k && !isAdminOnlyModule(k.split(":")[0])) eff.add(k);
  }
  for (const u of userRows ?? []) {
    const k = keyOf(u.permissions as PermRef);
    if (!k) continue;
    if (u.effect === "deny") eff.delete(k);
    else if (u.effect === "grant") eff.add(k);
  }
  return [...eff];
}

// Short-TTL cross-request cache for the hydrated user. React cache() only dedupes
// within ONE server request; every navigation still re-ran profiles + permissions +
// employees (3-4 DB round-trips) and blocked the layout render. Role/permissions
// change rarely, so a ~30s in-memory cache keyed by user id makes navigation feel
// instant while still picking up permission changes within half a minute. A change
// that must apply immediately (deactivation) is still enforced by getSession()'s
// verified path on security-critical gates.
const HYDRATE_TTL_MS = 30_000;
const hydrateCache = new Map<string, { at: number; user: SessionUser | null }>();

// Call after changing a user's role/permissions/status so the next request re-hydrates
// immediately instead of waiting out the TTL. Pass no id to clear everyone.
export function invalidateSessionCache(userId?: string) {
  if (userId) { hydrateCache.delete(userId); lastGood.delete(userId); }
  else { hydrateCache.clear(); lastGood.clear(); }
}

// HULING MABUTING HYDRATE kada user (2026-09-06, Joe: "bakit laging 'Your
// previous sign-in is no longer valid'"): kapag PANSAMANTALANG nabigo ang
// profiles query (timeout, puno ang connections ng Supabase micro, network),
// dati ay null ang balik — at kina-cache pa ng 30s — kaya ang root layout ay
// nagpapadala sa /api/auth/stale at PILIT na nilo-logout ang tao sa isang blip
// lang. Ngayon: ang DB error ay hindi "walang user" — ibinabalik ang huling
// kilalang user (walang TTL) at hindi kina-cache ang pagkabigo. Ang tunay na
// "walang profile / inactive" (walang error, walang row) ay null pa rin.
const lastGood = new Map<string, SessionUser>();

const hydrate = cache(async function hydrate(userId: string, email: string | undefined): Promise<SessionUser | null> {
  const cached = hydrateCache.get(userId);
  if (cached && Date.now() - cached.at < HYDRATE_TTL_MS) return cached.user;
  let user: SessionUser | null;
  try {
    user = await hydrateFromDb(userId, email);
  } catch (e) {
    const fallback = lastGood.get(userId) ?? null;
    console.warn(`[session] hydrate failed for ${userId}: ${e instanceof Error ? e.message : String(e)} — ${fallback ? "using last good session" : "no fallback"}`);
    return fallback;
  }
  hydrateCache.set(userId, { at: Date.now(), user });
  if (user) lastGood.set(userId, user); else lastGood.delete(userId);
  return user;
});

async function hydrateFromDb(userId: string, email: string | undefined): Promise<SessionUser | null> {
  const db = createServerSupabase();
  const { data: profile, error } = await db.from("profiles").select("*").eq("id", userId).maybeSingle();
  // DB/network error ≠ walang profile — itapon para ang hydrate() ang magpasya
  // (huling mabuting session), hindi ang layout (stale → logout).
  if (error) throw new Error(error.message);
  // `status` is a record_status enum ('active' | 'inactive'); deactivated users are locked out.
  if (!profile || profile.status === "inactive") return null;

  const role = (ROLES as string[]).includes(profile.role)
    ? (profile.role as Role)
    : "sales_staff";

  // Admin + developer = full access in code → no per-module load needed.
  const permissions = isAdmin(role) ? [] : await loadPermissions(db, userId, role);

  // Work setup: match the signed-in user to their employee row (by email, else
  // name) to know if they're WFH/Hybrid — drives the WFH self-clock link. Defaults
  // to 'Onsite' when there's no matching employee.
  let work_setup = "Onsite";
  const em = (email ?? profile.email ?? "").trim();
  const nm = (profile.full_name ?? "").trim();
  if (em || nm) {
    let q = db.from("employees").select("work_setup").limit(1);
    q = em ? q.ilike("email", em) : q.ilike("name", nm);
    const { data: emp } = await q.maybeSingle();
    if (emp?.work_setup) work_setup = String(emp.work_setup);
  }

  return {
    id: userId,
    email: email ?? profile.email ?? "",
    full_name: profile.full_name ?? email ?? "",
    role,
    active: profile.status === "active",
    avatar_url: profile.avatar_url ?? null,
    permissions,
    work_setup,
  };
}

// VERIFIED session — validates the JWT with Supabase (network round-trip).
// Use for security-critical paths: server actions and admin page gates.
// cache(): one getUser() per request even if called from several places.
export const getSession = cache(async function getSession(): Promise<SessionUser | null> {
  const auth = await createAuthClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return null;
  return hydrate(user.id, user.email ?? undefined);
});

// FAST session — reads the user from the cookie session WITHOUT a network
// round-trip. Use only for rendering/optimistic gates (e.g. the root layout);
// the proxy already verified the JWT for the request, and sensitive pages +
// all write actions still call getSession() (verified).
export const getSessionFast = cache(async function getSessionFast(): Promise<SessionUser | null> {
  const auth = await createAuthClient();
  const { data: { session } } = await auth.auth.getSession();
  const user = session?.user;
  if (!user) return null;
  return hydrate(user.id, user.email ?? undefined);
});

// Just the signed-in user's id from the cookie — NO network round-trip and NO
// profile/permission hydrate. For cheap actor stamping (audit) where the full
// SessionUser isn't needed.
export const getAuthUserId = cache(async function getAuthUserId(): Promise<string | null> {
  const auth = await createAuthClient();
  const { data: { session } } = await auth.auth.getSession();
  return session?.user?.id ?? null;
});
