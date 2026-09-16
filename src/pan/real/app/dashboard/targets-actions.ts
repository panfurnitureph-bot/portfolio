"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/rbac";
import type { SalesTargets } from "./sales-types";

// Save the editable sales targets. Managers + admins only.
export async function saveTargets(t: SalesTargets): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me || (!isAdmin(me.role) && me.role !== "operations_manager")) return { error: "Forbidden." };

  const clean = {
    revenue: Math.max(0, Number(t.revenue) || 0),
    orders: Math.max(0, Math.floor(Number(t.orders) || 0)),
    collection: Math.min(100, Math.max(0, Number(t.collection) || 0)),
    aov: Math.max(0, Number(t.aov) || 0),
  };

  const db = createServerSupabase();
  const { error } = await db.from("app_settings").upsert(
    { key: "sales_targets", value: clean, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}
