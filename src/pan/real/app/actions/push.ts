"use server";

// Register this device's FCM token against the signed-in account (APK only).
// The role snapshot lets events target roles (new order → ops, dispatch → workshop).
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

export async function registerPushToken(token: string): Promise<{ ok: true } | { error: string }> {
  try {
    const me = await getSession();
    if (!me) return { error: "Not signed in." };
    if (!token || token.length < 10) return { error: "Bad token." };
    const db = createServerSupabase();
    const { error } = await db.from("push_tokens").upsert(
      { user_id: me.id, role: me.role, token, platform: "android", updated_at: new Date().toISOString() },
      { onConflict: "token" },
    );
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to register push token." };
  }
}
