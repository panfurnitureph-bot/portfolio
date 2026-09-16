"use server";

import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/supabase/auth-server";
import { createServerSupabase } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/permissions";

export type AuthState = { error: string | null };

// Sign in with email + password. Rejects deactivated accounts (auth itself
// has no concept of profile.status, so we check it explicitly).
export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const auth = await createAuthClient();
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { error: "Invalid email or password." };
  }

  const db = createServerSupabase();
  const { data: profile } = await db
    .from("profiles")
    .select("status")
    .eq("id", data.user.id)
    .single();
  if (!profile || profile.status === "inactive") {
    await auth.auth.signOut();
    return { error: "Your account is inactive. Contact an administrator." };
  }

  await logAudit({ actorId: data.user.id, action: "login", module: "security", table: "auth", recordId: data.user.id });
  // Dalhin sa tamang home: admin → /dashboard; iba → unang pahinang nakikita
  // nila (hindi /dashboard, admin-only na iyon).
  const me = await getSession();
  redirect(me ? homeFor(me) : "/dashboard");
}

export async function signOut() {
  const auth = await createAuthClient();
  const { data: { user } } = await auth.auth.getUser();
  if (user) await logAudit({ actorId: user.id, action: "logout", module: "security", table: "auth", recordId: user.id });
  await auth.auth.signOut();
  redirect("/login");
}
