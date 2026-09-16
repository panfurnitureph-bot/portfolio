"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAnyEdit } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";

// Ia-advance ng pickup team ang PULL-OUT pickup mula sa team's Pickup Rework
// page (ang pickup task ay TAGO sa Delivery Scheduling habang repair phase):
//   En Route (Out for Delivery) → At Customer (Arrived) → Picked Up (Delivered).
// Ang "Delivered" sa pickup row = nakuha na ang item; ang row ay muling
// gagamitin (repurpose) ng auto-redelivery pagkatapos ng QC.
const STAGES: Record<string, string> = {
  enroute: "Out for Delivery",
  arrived: "Arrived",
  picked_up: "Delivered",
};

export async function markPickupStage(
  orderId: number,
  stage: "enroute" | "arrived" | "picked_up",
): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(["delivery"]);
  const status = STAGES[stage];
  if (!status) return { error: "Unknown stage." };
  const db = createServerSupabase();
  const { data: d } = await db.from("deliveries")
    .select("id, items_summary, status").eq("order_id", orderId).maybeSingle();
  if (!d) return { error: "No pickup task found for this order." };
  const patch: Record<string, unknown> = { status };
  if (stage === "arrived") patch.arrived_at = new Date().toISOString();
  if (stage === "picked_up") patch.delivered_at = new Date().toISOString();
  const { error } = await db.from("deliveries").update(patch).eq("id", d.id);
  if (error) return { error: error.message };
  await audit({ module: "returns", table: "deliveries", recordId: d.id, action: "update", after: { pickup_stage: status, order_id: orderId } });
  revalidatePath("/pickup");
  revalidatePath("/rework");
  revalidatePath("/delivery");
  revalidatePath("/returns");
  return { ok: true };
}

// PROOF NG PAGSUNDO, MULA SA CARD (2026-08-27).
//
// Ang PIRMA ay nakukuha sa MAPA (/api/delivery/pickup-proof) pagdating — nandoon
// ang driver, doon siya pumipirma. Ang LITRATO at ang BILANG ay dito: kung ilan
// ang nakuha, ilan ang may sira, at ano ang naitala. Kaparehong hati ng Pickup
// Task (app/pickup-task/actions.ts markPickedUp) — hindi bagong daanan.
//
// IDINADAGDAG ang litrato, hindi pinapalitan: may naitala na ang mapa, at ang
// pagpapalit ng listahan ay magbubura niyon at magpapababa sa bilang.
const MIN_REWORK_PICKUP_PHOTOS = 3;

export async function recordReworkPickupProof(input: {
  orderId: number;
  leg: "arrive" | "drop";
  photos: string[];
  good?: number | null;
  defect?: number | null;
  remarks?: string | null;
  notes?: string | null;
}): Promise<{ ok: true; photos: number } | { error: string }> {
  await requireAnyEdit(["delivery"]);
  const db = createServerSupabase();

  const { data: d } = await db.from("deliveries")
    .select("id, pickup_photos").eq("order_id", input.orderId).maybeSingle();
  if (!d) return { error: "No pickup task found for this order." };

  const onFile = ((d.pickup_photos as string[] | null) ?? []).filter(Boolean);
  const added = (input.photos ?? []).filter(Boolean);
  const photos = [...onFile, ...added];
  if (photos.length < MIN_REWORK_PICKUP_PHOTOS) {
    return { error: `Add at least ${MIN_REWORK_PICKUP_PHOTOS} photos (${photos.length} so far).` };
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { pickup_photos: photos };
  if (input.notes != null) patch.pickup_notes = input.notes || null;

  if (input.leg === "arrive") {
    // Nandoon na sa customer at nakuha na ang gamit.
    patch.status = "Arrived";
    patch.arrived_at = nowIso;
    patch.pickup_arrived_at = nowIso;
    patch.pickup_good = input.good ?? null;
    patch.pickup_defect = input.defect ?? null;
    patch.pickup_remarks = input.remarks || null;
  } else {
    // Naihatid na sa workshop. Ang "Delivered" sa pickup row ay ang senyas na
    // nakuha na ang item; ang row ay muling gagamitin ng auto-redelivery.
    patch.status = "Delivered";
    patch.delivered_at = nowIso;
    patch.pickup_at = nowIso;
  }

  const { error } = await db.from("deliveries").update(patch).eq("id", d.id);
  if (error) return { error: error.message };

  // Snapshot sa RMA (0153) — ang pickup row ay nare-repurpose para sa
  // redelivery, kaya nawawala ang status; ito ang tumatagal.
  try {
    const { data: rets } = await db.from("returns")
      .select("id, rework_pickup_proof")
      // Kasama ang REFUND pull-out (2026-09-01) — parehong proof snapshot ang
      // binabasa ng mga gate; kapag rework-lang ang sala, ang refund na kuha
      // ay hindi naitatala at "wala nangyayari" sa card.
      .eq("order_id", input.orderId).in("resolution", ["rework", "refund"])
      .order("id", { ascending: false }).limit(1);
    const ret = rets?.[0] as { id: number; rework_pickup_proof: Record<string, unknown> | null } | undefined;
    if (ret) {
      // Idagdag, huwag palitan — ang mapa ay nagsusulat din sa parehong leg.
      const prevLeg = (ret.rework_pickup_proof ?? {})[input.leg] as { photos?: unknown; signature?: unknown } | undefined;
      const prevShots = Array.isArray(prevLeg?.photos) ? (prevLeg.photos as string[]) : [];
      // HIWALAY ANG BILANG NG GALING SA CARD (2026-08-27). Ang bilangan ng
      // lahat ay hindi makapagsasabi kung sino ang nag-upload — at ang mapa ay
      // nakapaglagay ng lima sa isang drop, kaya naabot ang hinihinging tatlo
      // at nagsara ang card bago pa mabuksan. `cardPhotos` ang binibilang ng
      // gate: ang mapa ay hindi makakadagdag dito kahit ilan ang ilagay doon.
      const prevCard = Number((prevLeg as { cardPhotos?: unknown } | undefined)?.cardPhotos) || 0;
      const proof = {
        ...(ret.rework_pickup_proof ?? {}),
        [input.leg]: {
          at: nowIso,
          // Ang pirma ay galing sa mapa — panatilihin.
          ...(prevLeg?.signature ? { signature: prevLeg.signature } : {}),
          photos: [...prevShots, ...added],
          cardPhotos: prevCard + added.length,
        },
      };
      await db.from("returns").update({ rework_pickup_proof: proof }).eq("id", ret.id);
    }
  } catch { /* wala pa ang 0153 column — nasa deliveries row pa rin ang proof */ }

  // DROP = nasa workshop na ang item → ngayon ang rework job. Ginagawa rin ito
  // ng mapa sa /api/delivery/pickup-proof; idempotent ang helper, kaya alinman
  // ang mauna. Mahalaga ang PANGALAWANG daanan na ito dahil ang MAPA ay
  // pumipirma BAGO pa ma-upload ang Drop Proof — kung mapa lang ang gagawa,
  // nauuna ang job sa katibayan.
  if (input.leg === "drop") {
    const { createReworkJobIfNeeded } = await import("@/lib/rework/create-job");
    const { data: ord } = await db.from("orders").select("order_number").eq("id", input.orderId).maybeSingle();
    await createReworkJobIfNeeded(db, input.orderId, (ord?.order_number as string | null) ?? null);
  }

  await audit({
    module: "returns", table: "deliveries", recordId: d.id, action: "update",
    after: { rework_pickup_leg: input.leg, order_id: input.orderId, photos: photos.length },
  });
  for (const p of ["/pickup", "/rework", "/delivery", "/returns"]) revalidatePath(p);
  return { ok: true, photos: photos.length };
}
