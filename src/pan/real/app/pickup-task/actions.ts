"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

// Ang pagkuha at ang pagtanggi ay parehong nangyayari sa harap ng bagay, kaya
// pareho silang nangangailangan ng LITRATO: iyon ang patunay ng kondisyon sa
// sandaling maikarga (o sa sandaling tumanggi ang driver). Walang isa sa mga
// ito ang tahimik — pareho silang naiiwan sa audit.

// Ilan ang litratong kailangan para maituring na nakuha. Ang UI ang nagbibilang
// din nito, pero ang server ang tunay na harang: ang isang lumang page ay
// maaaring magpadala ng kulang.
const MIN_PICKUP_PHOTOS = 3;

function stamp() {
  return new Date().toISOString();
}

async function whoami(): Promise<string | null> {
  const me = await getSession();
  if (!me) return null;
  return me.full_name || me.email || "Driver";
}

// KINUHA. Sinesellyuhan ang pickup_at — ito ang binubuksan ang order papuntang
// Delivery Route, pero KAPAG LAHAT lang ng item nito ay nakuha na (tingnan ang
// gate sa app/delivery/data.ts). Ang isang naunang reject ay nabubura: ang
// pagkuha ang huling nangyari.
export async function markPickedUp(input: {
  // Ang kukunin sa WORKSHOP ay hawak ng declaration; ang kukunin sa BODEGA ay
  // hawak ng delivery. Iisa ang ginagawa ng driver, dalawa ang talaan.
  source: "workshop" | "warehouse";
  id: number;
  // ALIN SA MGA LINYA (0206). Ang warehouse stop ay isa kada linya pero
  // nagbabahagi ng iisang deliveries row, kaya ang `pickup_at` lang ay hindi
  // makakapagsabi kung alin ang nakarga na — nang kunin ang isang linya ng
  // ORD-000007, nawala pareho. Ito ang selyo kada linya. Null sa workshop:
  // may sarili nang talaan ang declaration.
  line_key?: string | null;
  photos: string[];
  // Ang bilang ng tinanggap at ng may sira, at ang mga tala — kaparehong
  // tanong ng QA ng delivery, sa kabilang dulo ng biyahe.
  good?: number | null;
  defect?: number | null;
  remarks?: string | null;
  notes?: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const by = await whoami();
  if (!by) return { error: "Sign in first." };

  const db = createServerSupabase();
  const table = input.source === "warehouse" ? "deliveries" : "qc_declarations";

  // ANG NAITALA NA SA MAPA AY BILANG NA. Ang driver ay pumipirma at kumukuha ng
  // litrato pagdating; ang card ang bumibilang. Kung papalitan ng card ang
  // listahan, mabubura ang naunang litrato at bababa ang bilang.
  // Ang `pickup_lines` ay hinihingi lang sa bodega — doon lang may maraming
  // linyang nagbabahagi ng isang talaan. Ang try/catch ay para sa 0206: bago
  // ito tumakbo ay walang column, at hindi dapat mahulog ang pagkuha dahil doon.
  type CurPick = { pickup_photos?: string[] | null; pickup_lines?: Record<string, unknown> | null };
  let cur: CurPick | null = null;
  if (input.source === "warehouse") {
    const r = await db.from(table).select("pickup_photos, pickup_lines").eq("id", input.id).maybeSingle();
    cur = r.error ? null : (r.data as unknown as CurPick | null);
  }
  if (!cur) {
    const r = await db.from(table).select("pickup_photos").eq("id", input.id).maybeSingle();
    cur = (r.data as unknown as CurPick | null) ?? null;
  }
  const onFile = ((cur?.pickup_photos as string[] | null) ?? []).filter(Boolean);
  const added = (input.photos ?? []).filter(Boolean);
  const photos = [...onFile, ...added];

  // ANG BILANG AY PER-LINYA KAPAG PER-LINYA ANG PAGKUHA (0206). Ang
  // `pickup_photos` ay order-wide: pag nakuha na ang unang linya nang may
  // tatlong litrato, MAKAKAPASA ang pangalawa nang wala ni isa — hindi na
  // patunay ng produktong nasa trak ang mga litratong iyon. Kaya kapag may
  // line_key, ang mga litratong ipinasa NGAYON ang binibilang.
  const perLine = input.source === "warehouse" && !!input.line_key;
  const proof = perLine ? added.length : photos.length;
  if (proof < MIN_PICKUP_PHOTOS) {
    return { error: `Take at least ${MIN_PICKUP_PHOTOS} photos of the item as it is loaded (${proof} so far).` };
  }
  // WALANG PIRMA (inalis 2026-08-25). Ang tatlong litrato ang patunay: ang
  // mismong bagay ang nakikita, at ang pangalan ng kumuha ay nasa pickup_by.
  // Ang naunang naitalang pirma ay hindi binubura.
  const now = stamp();
  // PER-LINYA (0206) kasama ang order-wide na selyo. Ang `pickup_at` ay
  // nananatili: iyon ang tinatanong ng Delivery Route bago pumayag na umalis
  // ang trak ("may nakuha na ba sa order na ito"). Ang `pickup_lines` ang
  // nagsasabi kung ALIN, kaya ang hindi pa nakuhang linya ay nasa listahan pa.
  const lines = perLine
    ? { ...((cur?.pickup_lines as Record<string, unknown> | null) ?? {}), [input.line_key!]: { at: now, by, photos: added } }
    : null;

  const { error } = await db
    .from(table)
    .update({
      pickup_at: now,
      pickup_by: by,
      ...(lines ? { pickup_lines: lines } : {}),
      pickup_photos: photos,
      pickup_good: input.good ?? null,
      pickup_defect: input.defect ?? null,
      pickup_remarks: input.remarks?.trim() || null,
      pickup_notes: input.notes?.trim() || null,
      // Ang pagkuha ang huling salita — kung tinanggihan ito kanina at may
      // napalit na, hindi na ito nakabinbin.
      pickup_rejected_at: null,
      pickup_reject_reason: null,
    })
    .eq("id", input.id);
  if (error) return { error: error.message };

  // ANG SELYO NG HAUL (0218). Kapag ang nakuha ay isang to-warehouse na
  // deklarasyon, tatakan din ang workshop_job.transfer_picked_at — ito ang
  // nagpapapasok ng trabaho sa Warehouse QC · Workshop (IN): hindi ito
  // lumilitaw doon hangga't walang trak na dumampot. Best-effort: bago ang
  // 0218 ay walang kolum, at ang pagkuha ay hindi dapat mahulog dahil doon.
  if (input.source === "workshop") {
    try {
      const { data: decl } = await db.from("qc_declarations").select("job_id").eq("id", input.id).maybeSingle();
      if (decl?.job_id != null) {
        await db.from("workshop_job").update({ transfer_picked_at: now }).eq("id", decl.job_id);
      }
    } catch { /* wala pang 0218 */ }
  }

  await audit({
    module: "pickup",
    table,
    recordId: input.id,
    action: "update",
    after: { picked_up_by: by, photos: photos.length },
  });

  revalidatePath("/pickup-task", "layout");
  revalidatePath("/delivery");
  revalidatePath("/workshop/jobs");
  return { ok: true };
}

// TINANGGIHAN. Humaharang ito, hindi flag: nananatili ang stop sa listahan
// hanggang may makuha. Ang patutunguhan ng pagbalik ay nakadepende sa daan —
// workshop kung doon ito ginawa, QC OUT kung mula sa stock ng bodega — pero
// pareho lang ang itinatala rito: hindi ito nakuha, at bakit.
export async function rejectPickup(input: {
  source: "workshop" | "warehouse";
  id: number;
  reason: string;
  photos: string[];
  notes?: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const by = await whoami();
  if (!by) return { error: "Sign in first." };

  const reason = String(input.reason ?? "").trim();
  if (!reason) return { error: "Say what is wrong with it." };
  const photos = (input.photos ?? []).filter(Boolean);
  if (photos.length < MIN_PICKUP_PHOTOS) {
    return { error: `Take at least ${MIN_PICKUP_PHOTOS} photos showing the problem (${photos.length} so far).` };
  }

  const db = createServerSupabase();
  const table = input.source === "warehouse" ? "deliveries" : "qc_declarations";
  const { error } = await db
    .from(table)
    .update({
      pickup_rejected_at: stamp(),
      pickup_reject_reason: reason,
      pickup_by: by,
      pickup_photos: photos,
      pickup_notes: input.notes?.trim() || null,
      // Hindi ito nakuha — dapat manatiling blangko ang selyo ng pagkuha, kung
      // hindi ay bubukas ang order sa Delivery Route.
      pickup_at: null,
    })
    .eq("id", input.id);
  if (error) return { error: error.message };

  await audit({
    module: "pickup",
    table,
    recordId: input.id,
    action: "update",
    after: { rejected_by: by, reason, photos: photos.length },
  });

  revalidatePath("/pickup-task", "layout");
  revalidatePath("/workshop/jobs");
  revalidatePath("/quality-control");
  return { ok: true };
}

// PAALIS NA PAPUNTA SA KUKUNAN. Ito ang katumbas ng Start Delivery: ang gesture
// na nagbubukas ng GPS at ng mapa, at ang selyong nagsasabing paalis na ang
// trak. Hindi pa ito pagkuha — ang litrato pa rin ang nagsesellyo ng pickup_at.
export async function startPickup(input: {
  source: "workshop" | "warehouse";
  id: number;
  // Saan pinindot ang Start — ito ang pinagmulan ng ruta sa mapa. Kapareho ng
  // start_lat/start_lng ng startDelivery.
  start_lat?: number | null;
  start_lng?: number | null;
  // ANG CLAIM (0218): ang team ng pahinang pinagpindutan. Sa workshop-source
  // na stop na kita ng LAHAT ng team (to-warehouse haul, stock build), ang
  // unang Start ang nagmamay-ari — naitatatak dito at nawawala ang stop sa
  // listahan ng ibang team.
  team?: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const by = await whoami();
  if (!by) return { error: "Sign in first." };

  const db = createServerSupabase();
  const table = input.source === "warehouse" ? "deliveries" : "qc_declarations";
  // Ang pinagmulan ay itinatabi lang kapag may naibigay — ang tinanggihang GPS
  // ay hindi dapat magbura ng naunang punto.
  const origin = input.start_lat != null && input.start_lng != null
    ? { pickup_lat: input.start_lat, pickup_lng: input.start_lng }
    : {};
  const claim = input.source === "workshop" && input.team?.trim()
    ? { pickup_team: input.team.trim() }
    : {};
  let { error } = await db
    .from(table)
    .update({ pickup_started_at: stamp(), pickup_by: by, ...origin, ...claim })
    .eq("id", input.id);
  // Bago tumakbo ang 0218 ay walang pickup_team — ang Start ay hindi dapat
  // mahulog dahil doon: ulitin nang walang claim.
  if (error && "pickup_team" in claim) {
    ({ error } = await db
      .from(table)
      .update({ pickup_started_at: stamp(), pickup_by: by, ...origin })
      .eq("id", input.id));
  }
  if (error) return { error: error.message };

  await audit({
    module: "pickup",
    table,
    recordId: input.id,
    action: "update",
    after: { pickup_started_by: by },
  });

  revalidatePath("/pickup-task", "layout");
  return { ok: true };
}

// DUMATING SA BODEGA (0220). Ang huling hakbang ng workshop→warehouse haul:
// nakuha na (pickup proof) at naihatid na sa bodega — ang selyong ito ang
// nagpapapasok ng trabaho sa Warehouse QC · Workshop (IN). Bago ang 0220 ay
// walang kolum — best-effort, hindi bumabagsak.
export async function markTransferDropped(input: {
  job_id: number;
  // DROP PROOF (0221): litrato ng kondisyon sa pag-abot sa bodega — kapareho
  // ng hinihingi ng pull-out sa bawat dulo ng biyahe nito.
  photos: string[];
  notes?: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const by = await whoami();
  if (!by) return { error: "Sign in first." };
  const id = Math.floor(Number(input.job_id) || 0);
  if (id <= 0) return { error: "Missing job." };
  const photos = (input.photos ?? []).filter(Boolean);
  if (photos.length < MIN_PICKUP_PHOTOS) {
    return { error: `Take at least ${MIN_PICKUP_PHOTOS} photos of the item as it is handed over (${photos.length} so far).` };
  }
  const db = createServerSupabase();
  let { error } = await db.from("workshop_job")
    .update({ transfer_dropped_at: stamp(), transfer_dropped_by: by, transfer_drop_photos: photos, transfer_drop_notes: input.notes?.trim() || null })
    .eq("id", id);
  // Bago ang 0221 ay walang photo columns — itala pa rin ang selyo.
  if (error) {
    ({ error } = await db.from("workshop_job")
      .update({ transfer_dropped_at: stamp(), transfer_dropped_by: by })
      .eq("id", id));
  }
  if (error) return { error: error.message };
  await audit({ module: "pickup", table: "workshop_job", recordId: id, action: "update", after: { transfer_dropped_by: by, photos: photos.length } });
  revalidatePath("/pickup-task", "layout");
  revalidatePath("/quality-control");
  return { ok: true };
}
