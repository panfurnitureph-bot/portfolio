"use server";

import { revalidatePath } from "next/cache";
import { createAuthClient } from "@/lib/supabase/auth-server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { validatePassword } from "@/lib/auth/password";

export type ProfileState = { error: string | null; ok: boolean };

// Update the signed-in user's own full name. Two writes (mirrors the spec):
//   1. auth.updateUser metadata  (so JWT/user_metadata stays in sync)
//   2. profiles.full_name        (the app's source of truth)
export async function updateProfileName(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const me = await getSession();
  if (!me) return { error: "Not signed in.", ok: false };

  const full_name = String(formData.get("full_name") ?? "").trim();
  if (!full_name) return { error: "Name cannot be empty.", ok: false };
  if (full_name.length > 120) return { error: "Name is too long.", ok: false };

  // 1. auth metadata (uses the user's own session)
  const auth = await createAuthClient();
  const { error: authErr } = await auth.auth.updateUser({ data: { full_name } });
  if (authErr) return { error: authErr.message, ok: false };

  // 2. profiles row (service role)
  const db = createServerSupabase();
  const { error: dbErr } = await db
    .from("profiles")
    .update({ full_name })
    .eq("id", me.id);
  if (dbErr) return { error: dbErr.message, ok: false };

  revalidatePath("/settings");
  revalidatePath("/", "layout"); // header/sidebar show the name
  return { error: null, ok: true };
}

// Persist the avatar's public URL after the client uploads to Storage.
export async function saveAvatarUrl(url: string): Promise<{ error: string | null }> {
  const me = await getSession();
  if (!me) return { error: "Not signed in." };

  const db = createServerSupabase();
  const { error } = await db
    .from("profiles")
    .update({ avatar_url: url })
    .eq("id", me.id);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { error: null };
}

export type PasswordState = { error: string | null; ok: boolean };

// Change the signed-in user's password. The "current password" field is
// cosmetic (Supabase has no verify-without-reauth) — we only enforce the new one.
export async function changePassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const me = await getSession();
  if (!me) return { error: "Not signed in.", ok: false };

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr, ok: false };
  if (password !== confirm) {
    return { error: "Passwords do not match.", ok: false };
  }

  const auth = await createAuthClient();
  const { error } = await auth.auth.updateUser({ password });
  if (error) return { error: error.message, ok: false };

  return { error: null, ok: true };
}
