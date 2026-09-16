"use server";

// UNIFIED DIRECTORY — APP LOGIN ng empleyado (2026-09-03, "isang edit nalang").
// Ang Employee Directory na ang pinto ng login: paglikha (may temp password),
// pagpapalit ng email/role, temp password reset, at disable/enable — lahat
// admin-only, kapareho ng dating User Management, at ang parehong audit trail.
// Ang permissions grid ay ang DATING PermissionsDialog/getUserPermissions —
// hindi dinodoble dito.

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession, invalidateSessionCache } from "@/lib/auth/session";
import { ROLES, isAdmin, type Role } from "@/lib/auth/rbac";
import { logAudit } from "@/lib/audit";
import { validatePassword } from "@/lib/auth/password";

type Res = { ok: true; profileId: string } | { error: string };

async function requireAdmin() {
  const me = await getSession();
  if (!me || !isAdmin(me.role)) throw new Error("Forbidden: administrator only.");
  return me;
}

const isRole = (v: unknown): v is Role => (ROLES as string[]).includes(String(v));

// Itago ang admin-issued na temp password para ma-preview (0228). Best-effort:
// wala pang 0228 → tahimik na laktaw, buo pa rin ang create/reset.
async function storeTempPassword(db: ReturnType<typeof createServerSupabase>, profileId: string, password: string, by: string | null) {
  try {
    await db.from("login_temp_passwords").upsert(
      { profile_id: profileId, temp_password: password, set_by: by, set_at: new Date().toISOString() },
      { onConflict: "profile_id" },
    );
  } catch { /* wala pang 0228 */ }
}

export type SaveEmployeeLoginInput = {
  employeeId: number;
  // null = bagong login ang gagawin; may laman = ang existing account na ito.
  profileId: string | null;
  fullName: string;
  email: string;
  role: string;
  // Kailangan sa bago; sa existing ay hindi ginagalaw dito (may sariling
  // setEmployeeLoginPassword).
  tempPassword?: string | null;
};

export async function saveEmployeeLogin(input: SaveEmployeeLoginInput): Promise<Res> {
  try {
    const me = await requireAdmin();
    const email = input.email.trim();
    const fullName = input.fullName.trim();
    if (!email) return { error: "Login email is required." };
    if (!isRole(input.role)) return { error: "Invalid login role." };
    const db = createServerSupabase();

    if (!input.profileId) {
      // ── BAGONG LOGIN ─────────────────────────────────────────────────────
      const pw = String(input.tempPassword ?? "");
      const pwErr = validatePassword(pw);
      if (pwErr) return { error: pwErr };
      let { data, error } = await db.auth.admin.createUser({
        email, password: pw, email_confirm: true,
        user_metadata: { full_name: fullName, role: input.role },
      });
      // NAKAREHISTRO NA ANG EMAIL (Joe 2026-09-06, "already been registered"):
      // naiwan ang auth user ng dating login (na-delete ang employee/profile,
      // hindi ang auth). Imbes na tumanggi, ANGKININ: palitan ang password sa
      // bagong temp password, i-set ang metadata, at ikabit ang profile sa
      // empleyadong ito — pareho ang resulta ng bagong login.
      if (error && /already (been )?registered|already exists/i.test(error.message)) {
        const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existing = list?.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
        if (!existing) return { error: error.message };
        const { data: upd, error: uErr } = await db.auth.admin.updateUserById(existing.id, {
          password: pw, email_confirm: true, user_metadata: { full_name: fullName, role: input.role },
        } as never);
        if (uErr || !upd.user) return { error: uErr?.message ?? "Could not reuse the existing login." };
        // Lumang per-user overrides ng dating may-ari — linisin; ang bagong
        // password na ang bantay sa lumang device (kailangang mag-login ulit).
        await db.from("user_permissions").delete().eq("user_id", existing.id);
        data = { user: upd.user, session: null } as typeof data; error = null;
      }
      if (error || !data?.user) return { error: error?.message ?? "Could not create the auth user." };
      // Profile na naka-link agad sa empleyado. Kapag wala pang 0227
      // (employee_id column), subukan ulit nang wala ito — buo pa rin ang
      // account, ang link lang ang mawawala hanggang tumakbo ang migration.
      const base = { id: data.user.id, full_name: fullName, email, role: input.role, status: "active" };
      let { error: pErr } = await db.from("profiles").upsert({ ...base, employee_id: input.employeeId }, { onConflict: "id" });
      if (pErr && /employee_id/.test(pErr.message)) ({ error: pErr } = await db.from("profiles").upsert(base, { onConflict: "id" }));
      if (pErr) {
        await db.auth.admin.deleteUser(data.user.id);
        return { error: `Profile not created: ${pErr.message}` };
      }
      await storeTempPassword(db, data.user.id, pw, me.email ?? me.id);
      await logAudit({
        actorId: me.id, action: "insert", module: "security", table: "profiles",
        recordId: data.user.id, next: { full_name: fullName, email, role: input.role, employee_id: input.employeeId },
      });
      revalidatePath("/hr/directory"); revalidatePath("/users");
      return { ok: true, profileId: data.user.id };
    }

    // ── EXISTING LOGIN: email / role / link ────────────────────────────────
    const profileId = input.profileId;
    const { data: before } = await db.from("profiles").select("email, role").eq("id", profileId).maybeSingle();
    if (!before) return { error: "Login account not found." };

    if ((before.email ?? "").trim().toLowerCase() !== email.toLowerCase()) {
      const { error: aErr } = await db.auth.admin.updateUserById(profileId, { email, email_confirm: true } as never);
      if (aErr) return { error: `Email not changed: ${aErr.message}` };
    }
    // Sarili: hindi mababago ang sariling role — kapareho ng User Management.
    if (before.role !== input.role && profileId === me.id) {
      return { error: "You cannot change your own role." };
    }
    const patch: Record<string, unknown> = { email, role: input.role, employee_id: input.employeeId };
    let { error: uErr } = await db.from("profiles").update(patch).eq("id", profileId);
    if (uErr && /employee_id/.test(uErr.message)) {
      ({ error: uErr } = await db.from("profiles").update({ email, role: input.role }).eq("id", profileId));
    }
    if (uErr) return { error: uErr.message };
    // Pagpalit ng role = reset ng per-user overrides, gaya ng dating setRole —
    // ang bagong role template ang masusunod, walang lumang override na maiiwan.
    if (before.role !== input.role) {
      await db.from("user_permissions").delete().eq("user_id", profileId);
    }
    invalidateSessionCache(profileId);
    await logAudit({
      actorId: me.id, action: "update", module: "security", table: "profiles",
      recordId: profileId, prev: { email: before.email, role: before.role }, next: { email, role: input.role, employee_id: input.employeeId },
    });
    revalidatePath("/hr/directory"); revalidatePath("/users");
    return { ok: true, profileId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save the login." };
  }
}

export async function setEmployeeLoginPassword(profileId: string, password: string): Promise<Res> {
  try {
    const me = await requireAdmin();
    const pwErr = validatePassword(password);
    if (pwErr) return { error: pwErr };
    const db = createServerSupabase();
    const { error } = await db.auth.admin.updateUserById(profileId, { password });
    if (error) return { error: error.message };
    await storeTempPassword(db, profileId, password, me.email ?? me.id);
    await logAudit({
      actorId: me.id, action: "update", module: "security", table: "profiles",
      recordId: profileId, next: { password: "reset by admin" },
    });
    return { ok: true, profileId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to set the password." };
  }
}

export async function setEmployeeLoginStatus(profileId: string, status: "active" | "inactive"): Promise<Res> {
  try {
    const me = await requireAdmin();
    if (profileId === me.id) return { error: "You cannot deactivate your own account." };
    const db = createServerSupabase();
    const { error } = await db.from("profiles").update({ status }).eq("id", profileId);
    if (error) return { error: error.message };
    invalidateSessionCache(profileId);
    await logAudit({
      actorId: me.id, action: "update", module: "security", table: "profiles",
      recordId: profileId, next: { status },
    });
    revalidatePath("/hr/directory"); revalidatePath("/users");
    return { ok: true, profileId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to set the status." };
  }
}
