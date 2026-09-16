"use server";

// STOCK BUILD — ipinapagawa ng Operations sa isang workshop nang WALANG order,
// para lang magkastock. Ang daloy: dito mag-a-assign → workshop job na walang
// order_id (stock_request = true) → gagawin at ide-declare ng workshop (may
// bayad, tag na STOCK REQUEST) → kukunin ng driver → Warehouse Receiving QC →
// saka lang nagiging tunay na stock.

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { requireAnyEdit } from "@/lib/auth/guard";
import { getSession } from "@/lib/auth/session";
import { findSpecMatch, type SpecCandidate } from "@/lib/spec-match";

const OPS_MODULES = ["ops_approval", "ops_tracker"];

export type StockBuildInput = {
  workshop_id: number;
  category: string;
  product_name: string;
  specs: string;
  qty: number;
  reason: string;
  // true = galing sa "+ Add customized" (bagong SKU na ginawa na ng builder).
  is_new?: boolean;
  color?: string | null;
  image_url?: string | null;
  price?: number | null;
  // SKU ng umiiral na produkto kapag pinili ito sa listahan (hindi na hahanap
  // ng katulad). Blangko = bagong gawa, dadaan sa duplicate check.
  sku?: string | null;
  // Sinadyang gumawa ng bago kahit may katugma — kailangan ng dahilan, at
  // itinatala kung sino ang nagpasya.
  force_new_reason?: string | null;
};

export type StockBuildResult =
  | { ok: true; sku: string; reused: boolean }
  // May katulad na sa records — hindi tinuloy. Ang Operations ang magdedesisyon:
  // gamitin ang umiiral, o tumuloy na may dahilan.
  | { duplicate: { sku: string; product_name: string; specs: string | null } }
  | { error: string };

// Ang mga produktong maihahambing: parehong category lang ang kailangan, pero
// kinukuha lahat para isang query — maliit naman ang catalog.
async function catalog(db: ReturnType<typeof createServerSupabase>): Promise<SpecCandidate[]> {
  const { data } = await db.from("product").select("sku, product_name, category, specs").limit(5000);
  return ((data ?? []) as SpecCandidate[]).filter((p) => p.sku);
}

// Ang SKU na gagamitin kapag BAGO: <PREFIX>-<6 digit>, kasunod ng pinakamataas
// na umiiral sa parehong prefix — pareho ng ginagawa ng Add Product.
// PAREHONG patakaran ng Add Product / Customized builder: unang 6 na titik ng
// category, may override lang sa dalawang bed (para hindi magkamukha ang
// "Promo Bed" at "Custom Bed" kapag pinutol sa 6). Kailangang tumugma —
// kung iba ang prefix dito, madodoble ang listing ng parehong produkto.
const SKU_PREFIX_OVERRIDE: Record<string, string> = { "Promo Bed": "PBED", "Custom Bed": "CBED" };
function prefixOf(category: string): string {
  return SKU_PREFIX_OVERRIDE[category.trim()]
    ?? (category.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6) || "CUSTOM");
}
async function nextSku(db: ReturnType<typeof createServerSupabase>, category: string): Promise<string> {
  const stem = prefixOf(category);
  const { data } = await db.from("product").select("sku").ilike("sku", `${stem}-%`).limit(5000);
  let max = 0;
  for (const r of data ?? []) {
    const m = /-(\d+)$/.exec(String(r.sku ?? "").trim());
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return `${stem}-${String(max + 1).padStart(6, "0")}`;
}

export async function assignStockBuild(input: StockBuildInput): Promise<StockBuildResult> {
  try { await requireAnyEdit(OPS_MODULES); } catch { return { error: "No edit access." }; }
  const me = await getSession();
  if (!input?.workshop_id) return { error: "Pick a workshop first." };
  if (!input?.product_name?.trim()) return { error: "Product name is required." };
  if (!input?.category?.trim()) return { error: "Category is required." };
  const qty = Math.max(1, Math.floor(Number(input.qty) || 0));

  const db = createServerSupabase();
  // Ang picker ay LAGING may SKU: kapag pumili sa listahan, ang SKU ng produkto;
  // kapag "+ Add customized", ang bagong SKU na ginawa (at naitala) ng builder.
  // Ang duplicate check ay para sa PANGALAWANG uri lang — doon posibleng may
  // katulad nang produkto sa records.
  let sku = String(input.sku ?? "").trim();
  let reused = !!sku && !input.is_new;

  if (input.is_new && sku) {
    // BAGONG gawa — tingnan muna kung may eksaktong katulad na sa records.
    // Huwag isama ang SARILING record ng bagong item — kagagawa lang nito ng
    // builder, kaya laging tutugma sa sarili nito.
    const others = (await catalog(db)).filter((c) => c.sku !== sku);
    const hit = findSpecMatch(others, input.category, input.specs);
    if (hit && !input.force_new_reason?.trim()) {
      return { duplicate: { sku: hit.sku, product_name: hit.product_name, specs: hit.specs } };
    }
    // Ginamit ang umiiral sa halip na ang kagagawang bago.
    if (hit && input.force_new_reason?.trim()) reused = false;
  }

  const itemDesc = [input.product_name.trim(), ...String(input.specs ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => (l.startsWith("•") ? l : `• ${l}`))].join("\n");
  const by = me?.full_name?.trim() || me?.email || null;
  const reason = [input.reason?.trim(), input.force_new_reason?.trim() ? `New item: ${input.force_new_reason.trim()}` : ""].filter(Boolean).join(" · ");

  const { data, error } = await db.from("workshop_job").insert({
    order_id: null, order_number: null,
    workshop_id: input.workshop_id,
    item_desc: itemDesc,
    qty,
    status: "pending",
    dispatched_at: new Date().toISOString(),
    fulfillment: "warehouse",   // ang stock build ay LAGING pabalik sa bodega
    stock_request: true,
    stock_sku: sku,
    stock_reason: reason || null,
    stock_by: by,
  }).select("id");
  if (error) return { error: error.message };

  // ANG RECORD SA PRODUCT MANAGEMENT — ginagawa agad pagka-assign, kaya may
  // pinagbabatayan na ang stock bago pa dumating sa bodega. Kapag umiiral na
  // ang SKU (pinili sa listahan o ginamit dahil may katulad), walang bagong
  // row — ang dami na lang ang madadagdag pagka-Receiving QC.
  const { data: exists } = await db.from("product").select("id").eq("sku", sku).limit(1);
  if (!exists?.length) {
    const { data: prod, error: prodErr } = await db.from("product").insert({
      product_name: input.product_name.trim(),
      sku,
      category: input.category || null,
      color: input.color || null,
      image_url: input.image_url || null,
      barcode: sku,
      cost: 0,
      price: Number(input.price) || 0,
      product_type: "Local",
      status: "active",
    }).select("id").single();
    if (prodErr) return { error: `Job assigned, but the product record failed: ${prodErr.message}` };
    // SPECS — hiwalay na best-effort (gaya ng Add Product; 0166 ang nagdagdag).
    const specs = String(input.specs ?? "").split("\n").map((l) => l.trim().replace(/^[•·]\s*/, "")).filter(Boolean).join("\n");
    if (specs && prod?.id) {
      try { await db.from("product").update({ specs }).eq("id", prod.id); } catch { /* wala pang 0166 */ }
    }
  }

  await audit({
    module: "operations", table: "workshop_job", recordId: (data?.[0]?.id as number) ?? 0, action: "insert",
    after: { stock_request: true, sku, qty, workshop_id: input.workshop_id, reason },
  });

  revalidatePath("/operations/stock-build");
  revalidatePath("/products");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/quality-control");
  return { ok: true, sku, reused };
}
