import "server-only";
import { getSession, type SessionUser } from "./session";
import { canAccess, isAdmin } from "./rbac";
import { MODULES, hasPermission } from "./permissions";

// Server-action authorization gate. Every mutating Server Action must call this
// before touching the DB: the service-role client bypasses RLS, so this app-layer
// check is the real write gate. Mirrors canViewPath() but for "edit":
//   admin → allow · seeded module → require `${module}:edit` · else role route-gate.
// Throws "Forbidden." when the caller may not edit. Returns the verified user.
export async function requireEdit(route: string, moduleKey?: string): Promise<SessionUser> {
  const me = await getSession();
  if (!me) throw new Error("Forbidden.");
  if (isAdmin(me.role)) return me;

  // Catalogue seeded + this is a gated module → require the module's edit grant.
  if (moduleKey && me.permissions.length > 0) {
    if (me.permissions.includes(`${moduleKey}:edit`)) return me;
    // Team grant sa grid (2026-09-05): ang may Delivery Team X edit ay puwedeng
    // gumawa ng aksyon ng team pages (Start Delivery, install save, returns).
    if (["delivery", "installation", "returns"].includes(moduleKey) && me.permissions.some((p) => /^team_[a-d]:edit$/.test(p))) return me;
    throw new Error("Forbidden.");
  }

  // Fallback: role route-gate (non-module routes, or unseeded catalogue).
  if (!canAccess(me.role, route)) throw new Error("Forbidden.");
  return me;
}

// Group gate: allow if the caller can EDIT any one of the given per-page modules.
// Used by shared section actions (Operations, Workshop) whose handlers serve many
// pages at once — a user granted edit on ANY page in the section may run them.
// Admin always passes. Throws "Forbidden." otherwise. Returns the verified user.
export async function requireAnyEdit(moduleKeys: string[]): Promise<SessionUser> {
  const me = await getSession();
  if (!me) throw new Error("Forbidden.");
  if (isAdmin(me.role)) return me;
  if (moduleKeys.some((k) => me.permissions.includes(`${k}:edit`))) return me;
  // FALLBACK (kapareho ng requireEdit): ang mga role na WALANG permission rows
  // (workshop/delivery-team tablet roles, kiosk) ay pinamamahalaan ng ROUTE
  // gate — payagan kung ang ruta ng alinman sa mga module ay abot ng role.
  // Kung wala nito, ang bawat workshop action ay 500 sa tablet accounts.
  if (me.permissions.length === 0) {
    const ok = moduleKeys.some((k) => {
      const route = MODULES.find((m) => m.key === k)?.route;
      return !!route && canAccess(me.role, route);
    });
    if (ok) return me;
  }
  throw new Error("Forbidden.");
}

// MANAGER DECISION O PERMISSION (Joe 2026-09-05, "pag may permission to edit,
// wala nang Locked"): ang mga aksyong dating Admin/Ops Manager lang (approve
// ng return, QC rate sheet, WFH settings, payment QR) ay bukas na rin sa
// sinumang may EDIT sa kaugnay na module sa permission grid.
export async function requireManagerOr(...moduleKeys: string[]): Promise<SessionUser> {
  const me = await getSession();
  if (!me) throw new Error("Forbidden.");
  if (isAdmin(me.role) || me.role === "operations_manager") return me;
  if (moduleKeys.some((k) => hasPermission(me, k, "edit"))) return me;
  throw new Error("Forbidden.");
}

// Admin-only gate (account management, etc.).
export async function requireAdmin(): Promise<SessionUser> {
  const me = await getSession();
  if (!me || !isAdmin(me.role)) throw new Error("Forbidden.");
  return me;
}
