"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/rbac";
import { hasPermission } from "@/lib/auth/permissions";
import { crcValid } from "@/lib/qrph";

// The merchant's QR Ph payload (pasted once), stored in app_settings.
export async function getPaymentQr(): Promise<string> {
  const db = createServerSupabase();
  const { data } = await db.from("app_settings").select("value").eq("key", "payment_qr").maybeSingle();
  const v = data?.value as { payload?: string } | null;
  return v?.payload ?? "";
}

export async function savePaymentQr(payload: string): Promise<{ ok: true } | { error: string }> {
  try {
    // Permission din (2026-09-05): Edit sa Sales Orders sa grid.
    const me = await getSession();
    if (!me || !(isAdmin(me.role) || me.role === "operations_manager" || hasPermission(me, "orders", "edit"))) return { error: "Forbidden." };
    const clean = (payload ?? "").replace(/[\r\n\t]+/g, "").trim();
    if (!crcValid(clean)) return { error: "Invalid QR Ph payload (CRC mismatch — paste the exact copied text, keep the spaces)." };
    const db = createServerSupabase();
    const { error } = await db.from("app_settings").upsert({ key: "payment_qr", value: { payload: clean }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return { error: error.message };
    revalidatePath("/orders");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save QR." };
  }
}
