"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { requireEdit } from "@/lib/auth/guard";
import { addPlacement } from "@/lib/placements";

// Assign a product to a warehouse location (or clear it with code = null).
// IMPORTANTE: ang occupancy/unassigned sa Locations page ay hinango sa
// INVENTORY.location (kung saan talaga nakalagay ang stock) — kaya bukod sa
// product record, ina-update din dito ang katumbas na inventory row(s).
export async function assignLocation(
  productId: number,
  code: string | null,
  // Fallback match para sa inventory-only rows (walang product record, id 0).
  // `color` (0235): ang hilera ng KULAY na ito lang ang inilalagay — ang ibang
  // kulay ng parehong SKU ay may sariling puwesto.
  match?: { sku?: string | null; name?: string | null; color?: string | null },
): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/locations", "locations");
  const supabase = createServerSupabase();
  const color = String(match?.color ?? "").trim();
  if (productId > 0) {
    const { error } = await supabase
      .from("product")
      .update({ warehouse_location: code || null })
      .eq("id", productId);
    if (error) return { error: error.message };
  }
  // Mirror sa inventory (Rak # = inventory.location): match by SKU, saka by
  // product name para sa mga row na walang sku. Best-effort — hindi ibabagsak
  // ang assign kapag walang tumamang inventory row.
  const { data: p } = productId > 0
    ? await supabase.from("product").select("sku, product_name").eq("id", productId).maybeSingle()
    : { data: null };
  const sku = p?.sku ?? match?.sku ?? null;
  const name = p?.product_name ?? match?.name ?? null;
  if (sku) {
    let q = supabase.from("inventory").update({ location: code || null }).ilike("sku", String(sku));
    if (color) q = q.ilike("color", color);
    await q;
  }
  if (name) await supabase.from("inventory").update({ location: code || null }).ilike("product_name", String(name)).is("sku", null);
  // PER-CUBIC (0199): ang assign dito ay ang UNANG puwesto ng SKU — ang buong
  // on-hand ang inilalagay sa piniling cubic. Ang paghahati sa maraming cubic
  // ay nangyayari sa stock-in (Receiving QC), na nagdadagdag sa napiling cubic
  // nang hindi ginagalaw ang iba.
  if (sku && code) {
    try {
      // Kabuuan ng lahat ng row ng SKU (kada kulay, 0232).
      let ohq = supabase.from("inventory").select("oh_inv").ilike("sku", String(sku));
      if (color) ohq = ohq.ilike("color", color);
      const invRow = { oh_inv: ((await ohq).data ?? []).reduce((a, r) => a + (Number(r.oh_inv) || 0), 0) };
      let exq = supabase.from("stock_placements").select("id").eq("sku", String(sku)).limit(1);
      if (color) exq = exq.ilike("color", color);
      let existing = (await exq).data;
      if (color && existing === null) existing = (await supabase.from("stock_placements").select("id").eq("sku", String(sku)).limit(1)).data; // bago ang 0235
      if (!existing?.length) await addPlacement(supabase, String(sku), code, Math.max(Number(invRow?.oh_inv) || 0, 0), null, color || null);
    } catch { /* wala pang 0199 */ }
  }
  if (sku && !code) {
    // Ang pag-clear ng lokasyon ay nagtatanggal din ng mga puwesto.
    try {
      const r = color ? await supabase.from("stock_placements").delete().eq("sku", String(sku)).ilike("color", color) : await supabase.from("stock_placements").delete().eq("sku", String(sku));
      if (r.error && /color/i.test(r.error.message)) await supabase.from("stock_placements").delete().eq("sku", String(sku));
    } catch { /* wala pang 0199 */ }
  }
  revalidatePath("/locations");
  revalidatePath("/products");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/quality-control");
  revalidatePath("/inventory");
  revalidatePath("/inventory/adjustments");
  revalidatePath("/scan");
  revalidatePath("/stock-movements");
  return { ok: true };
}

// HATI-HATING PUWESTO (2026-08-26): isang produkto, ilang cubic, tig-kanyang
// dami — "Line # | Cubic # | Qty" sa Assign modal. DAGDAG ito, hindi palit:
// ang 5 piraso na inilagay nang 3 sa L3-A1 ay may 2 pang naghihintay, at ang
// susunod na save (sa ibang cubic) ay hindi dapat bumura sa naunang 3. Ang
// hindi lalampasan: kabuuan ng LAHAT ng puwesto ≤ on-hand. Ang unang cubic ang
// itinatak sa single-location fields kapag wala pa — pambalik ng mga page na
// hindi pa marunong sa placements.
export async function assignPlacements(
  productId: number,
  match: { sku?: string | null; name?: string | null; color?: string | null },
  splits: { code: string; qty: number }[],
): Promise<{ ok: true } | { error: string }> {
  const color = String(match?.color ?? "").trim();
  await requireEdit("/locations", "locations");
  const clean = splits
    .map((x) => ({ code: (x.code ?? "").trim(), qty: Math.max(Math.floor(Number(x.qty) || 0), 0) }))
    .filter((x) => x.code && x.qty > 0);
  if (!clean.length) return { error: "Add at least one cubic with a quantity." };
  const dupe = new Set<string>();
  for (const x of clean) {
    const k = x.code.toLowerCase();
    if (dupe.has(k)) return { error: `${x.code} is listed twice — merge the rows.` };
    dupe.add(k);
  }
  const supabase = createServerSupabase();
  const primary = clean[0].code;
  const { data: p } = productId > 0
    ? await supabase.from("product").select("sku, product_name").eq("id", productId).maybeSingle()
    : { data: null };
  const sku = p?.sku ?? match?.sku ?? null;
  const name = p?.product_name ?? match?.name ?? null;

  // Huwag lalagpas sa on-hand ang KABUUAN ng mga puwesto (luma + bago).
  let placedNow = 0;
  let onHand: number | null = null;
  if (sku) {
    // Kabuuan ng lahat ng row ng SKU (kada kulay, 0232).
    let ohq = supabase.from("inventory").select("oh_inv").ilike("sku", String(sku));
    if (color) ohq = ohq.ilike("color", color); // kada kulay (0235)
    const invRowsAll = (await ohq).data ?? [];
    if (invRowsAll.length) onHand = Math.max(invRowsAll.reduce((a, r) => a + (Number(r.oh_inv) || 0), 0), 0);
    try {
      let plq = supabase.from("stock_placements").select("qty").eq("sku", String(sku));
      if (color) plq = plq.ilike("color", color);
      let { data: pls } = await plq;
      if (color && pls === null) ({ data: pls } = await supabase.from("stock_placements").select("qty").eq("sku", String(sku))); // bago ang 0235
      placedNow = (pls ?? []).reduce((a, r) => a + (Number(r.qty) || 0), 0);
    } catch { /* wala pang 0199 */ }
  }
  const adding = clean.reduce((a, x) => a + x.qty, 0);
  if (onHand != null && onHand > 0 && placedNow + adding > onHand) {
    const left = Math.max(onHand - placedNow, 0);
    return { error: `Only ${left} piece${left === 1 ? "" : "s"} left to place — ${placedNow} of ${onHand} already have a cubic.` };
  }

  // Ang single-location fields ay tatak lang ng PANGUNAHING puwesto — huwag
  // patungan kapag may laman na (nauna nang batch sa ibang cubic).
  //
  // PARTIAL NA PAGLALAGAY (Joe 2026-09-04, "15 lang, dapat may 5 pa"): HUWAG
  // itatak ang inventory.location habang hindi pa buo ang na-place. Ang data
  // loader ay may spill rule (2026-08-31): ang hindi pa na-place ay
  // ibinibilang sa inventory.location — kaya ang 15 sa L5-A1 ay naging 20 doon
  // at nawala ang 5 sa "Needs a location". Kapag null ang location, ang 5 ay
  // nananatiling unassigned; itatak ang primary kapag kumpleto na (o kapag
  // hindi alam ang on-hand).
  const complete = onHand == null || onHand <= 0 || placedNow + adding >= onHand;
  if (complete) {
    if (productId > 0) {
      await supabase.from("product").update({ warehouse_location: primary }).eq("id", productId).or("warehouse_location.is.null,warehouse_location.eq.");
    }
    if (sku) {
      let q = supabase.from("inventory").update({ location: primary }).ilike("sku", String(sku)).or("location.is.null,location.eq.");
      if (color) q = q.ilike("color", color);
      await q;
    }
    if (name) await supabase.from("inventory").update({ location: primary }).ilike("product_name", String(name)).is("sku", null).or("location.is.null,location.eq.");
  }
  if (sku) {
    // Dagdag kada cubic (merge) — tingnan ang lib/placements.
    for (const x of clean) await addPlacement(supabase, String(sku), x.code, x.qty, null, color || null);
  }
  await audit({ module: "locations", table: "stock_placements", recordId: sku ?? productId, action: "update", after: { sku, splits: clean } });
  revalidatePath("/locations");
  revalidatePath("/products");
  revalidatePath("/inventory");
  revalidatePath("/quality-control");
  return { ok: true };
}

export type LocationInput = {
  code: string;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  bin: string | null;
  capacity: number | null;
  description: string | null;
  status: string;
};

export async function createLocation(input: LocationInput): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/locations", "locations");
  if (!input.code?.trim()) return { error: "Location code is required." };
  const supabase = createServerSupabase();
  const { data: ins, error } = await supabase.from("warehouse_locations").insert({
    code: input.code.trim(),
    zone: input.zone || null,
    aisle: input.aisle || null,
    rack: input.rack || null,
    bin: input.bin || null,
    capacity: input.capacity,
    description: input.description || null,
    status: input.status || "active",
  }).select("id").single();
  if (error) return { error: /duplicate|unique/i.test(error.message) ? `Location code "${input.code}" already exists.` : error.message };
  await auditAfter({ module: "locations", table: "warehouse_locations", recordId: ins?.id ?? "—", action: "insert", snapshotTable: "warehouse_locations", snapshotId: ins?.id });
  revalidatePath("/locations");
  return { ok: true };
}

export async function updateLocation(id: number, input: LocationInput): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/locations", "locations");
  if (!input.code?.trim()) return { error: "Location code is required." };
  const supabase = createServerSupabase();
  const before = await snapshot("warehouse_locations", id);
  // If the code changed, move the products that referenced the old code.
  const { data: cur } = await supabase.from("warehouse_locations").select("code").eq("id", id).limit(1);
  const oldCode = cur?.[0]?.code as string | undefined;
  const { error } = await supabase.from("warehouse_locations").update({
    code: input.code.trim(),
    zone: input.zone || null,
    aisle: input.aisle || null,
    rack: input.rack || null,
    bin: input.bin || null,
    capacity: input.capacity,
    description: input.description || null,
    status: input.status || "active",
  }).eq("id", id);
  if (error) return { error: /duplicate|unique/i.test(error.message) ? `Location code "${input.code}" already exists.` : error.message };
  if (oldCode && oldCode !== input.code.trim()) {
    await supabase.from("product").update({ warehouse_location: input.code.trim() }).ilike("warehouse_location", oldCode);
  }
  await auditAfter({ module: "locations", table: "warehouse_locations", recordId: id, action: "update", before, snapshotTable: "warehouse_locations", snapshotId: id });
  revalidatePath("/locations");
  revalidatePath("/products");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/quality-control");
  revalidatePath("/inventory");
  revalidatePath("/inventory/adjustments");
  revalidatePath("/scan");
  revalidatePath("/stock-movements");
  return { ok: true };
}

export async function deleteLocation(id: number): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/locations", "locations");
  const supabase = createServerSupabase();
  const before = await snapshot("warehouse_locations", id);
  // Unassign products from this location, then delete it.
  const { data: cur } = await supabase.from("warehouse_locations").select("code").eq("id", id).limit(1);
  const code = cur?.[0]?.code as string | undefined;
  if (code) await supabase.from("product").update({ warehouse_location: null }).ilike("warehouse_location", code);
  const { error } = await supabase.from("warehouse_locations").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "locations", table: "warehouse_locations", recordId: id, action: "delete", before });
  revalidatePath("/locations");
  revalidatePath("/products");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/quality-control");
  revalidatePath("/inventory");
  revalidatePath("/inventory/adjustments");
  revalidatePath("/scan");
  revalidatePath("/stock-movements");
  return { ok: true };
}
