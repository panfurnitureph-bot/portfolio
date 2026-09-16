"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession, invalidateSessionCache } from "@/lib/auth/session";
import { ROLES, isAdmin, type Role } from "@/lib/auth/rbac";
import { MODULES, isAdminOnlyModule, roleDefaultKeys } from "@/lib/auth/permissions";
import { logAudit } from "@/lib/audit";
import { validatePassword } from "@/lib/auth/password";

async function requireAdmin() {
  const me = await getSession();
  // Developer is treated as admin (full access incl. user management).
  if (!me || !isAdmin(me.role)) {
    throw new Error("Forbidden: administrator only.");
  }
  return me;
}

const isRole = (v: unknown): v is Role => (ROLES as string[]).includes(String(v));

export type CreateUserState = { error: string | null; ok: boolean };

// Admin creates an account. Uses the service_role admin API; the
// fn_handle_new_user trigger then inserts the matching profile row
// (full_name + role come from user_metadata).
export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const me = await requireAdmin();

  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!full_name || !email || !password) {
    return { error: "Name, email, and password are required.", ok: false };
  }
  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr, ok: false };
  if (!isRole(role)) {
    return { error: "Invalid role.", ok: false };
  }

  const db = createServerSupabase();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  });
  if (error || !data.user) {
    return { error: error?.message ?? "Could not create the auth user.", ok: false };
  }

  // Workaround: create the profile ourselves instead of relying on the
  // fn_handle_new_user DB trigger (which may not be applied). upsert keeps it
  // safe even if the trigger DOES exist and already inserted the row.
  const { error: profileError } = await db.from("profiles").upsert(
    {
      id: data.user.id,
      full_name,
      email,
      role,
      status: "active",
    },
    { onConflict: "id" },
  );
  if (profileError) {
    // Roll back the auth user so we never leave a login that has no profile.
    await db.auth.admin.deleteUser(data.user.id);
    return { error: `Profile not created: ${profileError.message}`, ok: false };
  }

  await logAudit({
    actorId: me.id, action: "insert", module: "security", table: "profiles",
    recordId: data.user.id, next: { full_name, email, role, status: "active" },
  });
  revalidatePath("/users");
  return { error: null, ok: true };
}

type Res = { ok: true } | { error: string };

export async function setRole(formData: FormData): Promise<Res> {
  try {
    const me = await requireAdmin();
    const userId = String(formData.get("user_id") ?? "");
    const role = String(formData.get("role") ?? "");
    if (!isRole(role)) return { error: "Invalid role." };
    if (userId === me.id) return { error: "You cannot change your own role." };

    const db = createServerSupabase();
    const { data: before } = await db.from("profiles").select("role").eq("id", userId).single();
    const { error } = await db.from("profiles").update({ role }).eq("id", userId);
    if (error) return { error: error.message };

    // Changing role resets the user to that role's default pages: clear any
    // per-user grant/deny overrides so effective access == the new role's
    // template (no stale override from the old role lingers). The admin can
    // still fine-tune afterwards via the Permissions dialog.
    if (before?.role !== role) {
      await db.from("user_permissions").delete().eq("user_id", userId);
    }
    // Agad na re-hydrate sa susunod na request ng apektadong user (2026-09-03,
    // "nag bigay ako ng role pero di nagsshow") - hindi na hihintayin ang 30s TTL.
    invalidateSessionCache(userId);

    await logAudit({
      actorId: me.id, action: "update", module: "security", table: "profiles",
      recordId: userId, prev: { role: before?.role }, next: { role },
    });
    // Only revalidate the users list — the admin's own view. Revalidating the WHOLE
    // app layout ("/", "layout") re-rendered the entire shell and could blank the page
    // (any RSC in the layout throwing → white screen). The AFFECTED user's own sidebar
    // /route gates update live via SessionWatcher (realtime), not the admin's layout.
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to set role." };
  }
}

export async function deleteUser(formData: FormData): Promise<Res> {
  try {
    const me = await requireAdmin();
    const userId = String(formData.get("user_id") ?? "");
    if (userId === me.id) return { error: "You cannot delete your own account." };

    const db = createServerSupabase();
    const { data: before } = await db.from("profiles").select("full_name, email, role, status").eq("id", userId).single();
    // Removes auth.users; the profiles row cascades away, freeing the email.
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) return { error: error.message };
    await logAudit({
      actorId: me.id, action: "delete", module: "security", table: "profiles",
      recordId: userId, prev: before ?? undefined,
    });
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete user." };
  }
}

// ── Per-module permissions ───────────────────────────────────────────

export type ModulePerm = { module: string; view: boolean; edit: boolean };
// Effective perms + the role baseline, so the UI can show what's an override.
export type ModulePermView = ModulePerm & { roleView: boolean; roleEdit: boolean };

type CatRow = { id: number; module: string; action: string };

async function catalogueByKey(db: ReturnType<typeof createServerSupabase>) {
  // SELF-HEALING CATALOGUE (2026-09-05, "di nag-sasave"): ang module na wala pa
  // sa permissions table (bagong page sa code, walang migration) ay tahimik na
  // nilalaktawan ng Save dati — Formal Quotation, Design Details, Pickup Task…
  // Idinadagdag dito ang kulang bago basahin, para laging kumpleto.
  const first = await db.from("permissions").select("id, module, action");
  const have = new Set(((first.data ?? []) as CatRow[]).map((r) => `${r.module}:${r.action}`));
  const missing = MODULES.flatMap((m) => (["view", "edit"] as const).filter((a) => !have.has(`${m.key}:${a}`)).map((a) => ({ module: m.key, action: a, label: `${m.label} — ${a}` })));
  if (missing.length) { try { await db.from("permissions").upsert(missing, { onConflict: "module,action", ignoreDuplicates: true }); } catch { /* best effort */ } }
  const { data } = missing.length ? await db.from("permissions").select("id, module, action") : first;
  const byKey = new Map<string, number>(); // "module:action" -> id
  const rows = (data ?? []) as CatRow[];
  for (const r of rows) byKey.set(`${r.module}:${r.action}`, r.id);
  return { rows, byKey };
}
// Baseline ng role = code default (sidebar group ng role) ∪ DB seed, MINUS ang
// admin-only (Website/System…) para sa non-admin.
function roleBaselineIds(role: string | null | undefined, rows: CatRow[], dbIds: number[]): Set<number> {
  const set = new Set<number>(dbIds);
  if (!role || !(ROLES as string[]).includes(role)) return set;
  const keys = new Set(roleDefaultKeys(role as Role));
  for (const r of rows) if (keys.has(`${r.module}:${r.action}`)) set.add(r.id);
  if (!isAdmin(role as Role)) for (const r of rows) if (isAdminOnlyModule(r.module)) set.delete(r.id);
  return set;
}

// Effective per-module view/edit for a user (role defaults ± user overrides),
// plus the role baseline so the UI can flag which toggles are overrides.
export async function getUserPermissions(userId: string): Promise<ModulePermView[]> {
  await requireAdmin();
  const db = createServerSupabase();

  const { data: prof } = await db.from("profiles").select("role").eq("id", userId).single();
  const role = prof?.role;
  const { rows } = await catalogueByKey(db);
  // Admin role has no seeded grants (full access is code-level) — treat every
  // module as on for the baseline so the UI doesn't paint everything as override.
  const adminRole = isAdmin(role as Role);

  const { data: rp } = await db
    .from("role_permissions")
    .select("permission_id")
    .eq("role", role);
  const roleSet = roleBaselineIds(role, rows, (rp ?? []).map((r) => r.permission_id as number));

  const { data: up } = await db
    .from("user_permissions")
    .select("permission_id, effect")
    .eq("user_id", userId);
  const grant = new Set<number>();
  const deny = new Set<number>();
  for (const u of up ?? []) {
    (u.effect === "grant" ? grant : deny).add(u.permission_id as number);
  }
  const inRole = (id: number) => adminRole || roleSet.has(id);
  const eff = (id: number) => (inRole(id) || grant.has(id)) && !deny.has(id);

  const map = new Map<string, ModulePermView>();
  for (const r of rows) {
    const m = map.get(r.module) ?? { module: r.module, view: false, edit: false, roleView: false, roleEdit: false };
    if (r.action === "view") { m.view = eff(r.id); m.roleView = inRole(r.id); }
    if (r.action === "edit") { m.edit = eff(r.id); m.roleEdit = inRole(r.id); }
    map.set(r.module, m);
  }
  return [...map.values()];
}

// Save absolute toggles -> store only the deltas vs the role defaults.
export async function setUserPermissions(userId: string, desired: ModulePerm[]): Promise<Res> {
 try {
  const me = await requireAdmin();
  if (userId === me.id) return { error: "You cannot edit your own permissions." };
  const db = createServerSupabase();

  const { data: prof } = await db.from("profiles").select("role").eq("id", userId).single();
  const role = prof?.role;
  const { rows, byKey } = await catalogueByKey(db);

  const { data: rp } = await db
    .from("role_permissions")
    .select("permission_id")
    .eq("role", role);
  const roleSet = roleBaselineIds(role, rows, (rp ?? []).map((r) => r.permission_id as number));

  // Normalise rule: edit implies view; no view implies no edit.
  const wantIds = new Set<number>();
  for (const d of desired) {
    const view = d.view || d.edit;
    const edit = d.edit && view;
    if (view) {
      const id = byKey.get(`${d.module}:view`);
      if (id) wantIds.add(id);
    }
    if (edit) {
      const id = byKey.get(`${d.module}:edit`);
      if (id) wantIds.add(id);
    }
  }

  const overrides: { user_id: string; permission_id: number; effect: "grant" | "deny" }[] = [];
  for (const r of rows) {
    const inRole = roleSet.has(r.id);
    const want = wantIds.has(r.id);
    if (want && !inRole) overrides.push({ user_id: userId, permission_id: r.id, effect: "grant" });
    else if (!want && inRole) overrides.push({ user_id: userId, permission_id: r.id, effect: "deny" });
  }

  await db.from("user_permissions").delete().eq("user_id", userId);
  if (overrides.length) {
    const { error } = await db.from("user_permissions").insert(overrides);
    if (error) return { error: error.message };
  }
  // Users list only — not the whole layout (see setRole note). The affected user's
  // access refreshes live via SessionWatcher.
  // Agad na makita ng user ang bagong permissions sa susunod niyang request.
  invalidateSessionCache(userId);
  revalidatePath("/users");
  return { ok: true };
 } catch (e) {
  return { error: e instanceof Error ? e.message : "Failed to save permissions." };
 }
}

export async function setStatus(formData: FormData): Promise<Res> {
  try {
    const me = await requireAdmin();
    const userId = String(formData.get("user_id") ?? "");
    const status = String(formData.get("status") ?? "");
    if (status !== "active" && status !== "inactive") return { error: "Invalid status." };
    if (userId === me.id) return { error: "You cannot deactivate your own account." };

    const db = createServerSupabase();
    const { error } = await db.from("profiles").update({ status }).eq("id", userId);
    if (error) return { error: error.message };
    invalidateSessionCache(userId);
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to set status." };
  }
}
