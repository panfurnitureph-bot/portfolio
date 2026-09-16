"use server";

// ROUTE PLANNER actions — stop order, time-window override, finalize, send-to-team.
// Lahat best-effort sa push; ang DB writes lang ang nagpapasya ng ok/error.

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAnyEdit } from "@/lib/auth/guard";

const GUARD = ["delivery", "ops_delivery_queue", "ops_approval"] as const;

// Drag-reorder: isulat ang bagong pagkakasunod (1-based) ng stops ng isang team+date.
export async function saveStopOrder(orderIds: number[]): Promise<{ ok: true } | { error: string }> {
  try { await requireAnyEdit([...GUARD]); } catch { return { error: "No edit access." }; }
  if (!Array.isArray(orderIds) || orderIds.length === 0) return { error: "No stops to save." };
  const db = createServerSupabase();
  for (let i = 0; i < orderIds.length; i++) {
    const { error } = await db.from("orders").update({ dq_stop: i + 1 }).eq("id", Number(orderIds[i]));
    if (error) return { error: error.message };
  }
  revalidatePath("/delivery");
  return { ok: true };
}

// TANGGAL SA RUTA (2026-09-02, "san ko mabubura to"): linisin ang buong dq
// booking ng order para mawala ito sa Route Planner. Ang order ay BABALIK sa
// Delivery Queue For Scheduling (kapag handa pa rin ang mga linya nito) — hindi
// ito pagkansela ng order, pag-alis lang sa biyahe. Kung may delivery row nang
// nakaandar (Out for Delivery pababa), hindi na ito matatanggal dito.
export async function removeFromRoute(orderId: number): Promise<{ ok: true } | { error: string }> {
  try { await requireAnyEdit([...GUARD]); } catch { return { error: "No edit access." }; }
  const db = createServerSupabase();
  const { data: dels } = await db.from("deliveries").select("id, status").eq("order_id", Number(orderId)).limit(10);
  if ((dels ?? []).some((d) => /out for delivery|arrived|delivered|installation/i.test(String(d.status ?? "")))) {
    return { error: "This trip is already moving — it can't be removed from the route anymore." };
  }
  const { error } = await db.from("orders").update({
    dq_group: null, dq_status: null, dq_date: null, dq_team: null, dq_driver: null,
    dq_token: null, dq_sent_at: null, dq_route_final_at: null, dq_stop: null,
    dq_time_window: null, dq_confirmed_at: null,
  }).eq("id", Number(orderId));
  if (error) return { error: error.message };
  revalidatePath("/delivery");
  revalidatePath("/operations/route-planner");
  revalidatePath("/operations/delivery-queue");
  return { ok: true };
}

// Manual override ng time window ng isang stop (null = balik sa auto).
export async function setStopWindow(orderId: number, window: string | null): Promise<{ ok: true } | { error: string }> {
  try { await requireAnyEdit([...GUARD]); } catch { return { error: "No edit access." }; }
  const db = createServerSupabase();
  const { error } = await db.from("orders").update({ dq_time_window: window }).eq("id", Number(orderId));
  if (error) return { error: error.message };
  revalidatePath("/delivery");
  return { ok: true };
}

// Finalize ang buong date: i-lock ang resolved windows (auto → saved) at i-stamp
// ang dq_route_final_at para hindi na gumalaw ang plano.
export async function finalizeRoute(input: { dateISO: string; stops: { orderId: number; window: string }[] }): Promise<{ ok: true; count: number } | { error: string }> {
  try { await requireAnyEdit([...GUARD]); } catch { return { error: "No edit access." }; }
  const stops = (input?.stops ?? []).filter((s) => Number(s.orderId) > 0);
  if (!stops.length) return { error: "No stops to finalize." };
  const db = createServerSupabase();
  const now = new Date().toISOString();
  // SABAY, HINDI SUNOD-SUNOD (2026-08-30). Bawat update ay ~75ms na biyahe sa
  // Tokyo; ang limang stop nang sunod-sunod ay kalahating segundo ng
  // paghihintay na walang dahilan — magkakahiwalay na hilera, walang
  // pagkakasunod na kailangan.
  const results = await Promise.all(stops.map((s) =>
    db.from("orders")
      .update({ dq_time_window: s.window || null, dq_route_final_at: now })
      .eq("id", Number(s.orderId)),
  ));
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };
  revalidatePath("/delivery");
  return { ok: true, count: stops.length };
}

// SEND — ipadala ang route sa team via push (drivers + warehouse + ops devices).
export async function sendRouteToTeam(input: { team: string; driver?: string | null; dateISO: string; stops: number; firstStop?: string | null }): Promise<{ ok: true } | { error: string }> {
  try { await requireAnyEdit([...GUARD]); } catch { return { error: "No edit access." }; }
  if (!input?.team || !input?.dateISO) return { error: "Missing team or date." };
  try {
    const { notifyRouteSent } = await import("@/lib/push/notify");
    await notifyRouteSent({
      team: input.team,
      driver: input.driver ?? null,
      date: new Date(`${input.dateISO}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }),
      stops: Number(input.stops) || 0,
      firstStop: input.firstStop ?? null,
    });
  } catch { return { error: "Push failed — check device tokens." }; }
  return { ok: true };
}
