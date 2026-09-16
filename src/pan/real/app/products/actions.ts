"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { requireEdit } from "@/lib/auth/guard";
import { getSession } from "@/lib/auth/session";
import { dimensionsFromSpecs, mergeTemplateMeasures } from "@/lib/website-config";
import { cleanVariants, webColorFields, type ColorVariant } from "@/lib/color-variants";
import { syncWebStock } from "@/lib/web/stock";

// ── Auto-SKU (enterprise format: <CATEGORY-PREFIX>-<NAME-CODE>-<3-digit seq>) ────
// e.g. MAT-UAW-001 for "Uratex Airlite Wind Mattress" (Mattress). Used only when the
// user leaves SKU blank; a manually-entered SKU is kept as-is.
const SKU_PREFIX: Record<string, string> = {
  "mattress": "MAT",
  "bed": "BED",
  "sofa": "SOF",
  "sofa bed": "SFB",
  "dining table": "DT",
  "dining table ph": "DTP",
  "dining chairs": "DC",
  "dining chair ph": "DCP",
  "dining set ph": "DSP",
  "accent chair": "AC",
  "ottoman ph": "OTT",
  "side table": "ST",
  "kurtina ni pan": "KRT",
  "addons": "ADD",
};
// Common furniture words to drop when building the name code, so the code reflects the
// PRODUCT LINE (brand/model) not the generic noun already implied by the category.
const NAME_STOPWORDS = new Set([
  "mattress", "bed", "sofa", "chair", "chairs", "table", "set", "ottoman", "side",
  "dining", "accent", "ph", "the", "and", "with", "of", "for", "pan", "kurtina", "ni",
]);
// Derive a 2-4 letter prefix for a category (mapped first, else initials/first letters).
function prefixFor(category: string | null): string {
  const c = (category ?? "").trim().toLowerCase();
  if (c && SKU_PREFIX[c]) return SKU_PREFIX[c];
  if (!c) return "PRD";
  const words = c.split(/\s+/).filter(Boolean);
  const initials = words.length >= 2 ? words.map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 3);
  return (initials || "PRD").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "PRD";
}
// Name code = initials of the product-line words (stopwords + category noun removed).
// "Uratex Airlite Wind Mattress" → UAW · "Uratex Trill Air Mattress" → UTA.
function nameCodeFor(productName: string): string {
  const words = (productName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !NAME_STOPWORDS.has(w));
  if (words.length === 0) return "GEN";
  // Multiple words → initials (max 4). Single word → first 3 letters.
  const code = words.length >= 2 ? words.map((w) => w[0]).join("").slice(0, 4) : words[0].slice(0, 3);
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "") || "GEN";
}
// Next available enterprise SKU: <CATEGORY-PREFIX>-<NAME-CODE>-<3-digit sequence>.
// Sequence runs per (prefix + name code), so each product LINE numbers independently
// (Uratex Airlite Wind → MAT-UAW-001,002,003; Uratex Trill Air → MAT-UTA-001,002...).
async function nextSku(supabase: ReturnType<typeof createServerSupabase>, category: string | null, productName: string): Promise<string> {
  const prefix = prefixFor(category);
  const nameCode = nameCodeFor(productName);
  const stem = `${prefix}-${nameCode}`;
  const { data } = await supabase.from("product").select("sku").ilike("sku", `${stem}-%`);
  let max = 0;
  for (const r of data ?? []) {
    const m = /-(\d+)$/.exec((r.sku ?? "").trim());
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return `${stem}-${String(max + 1).padStart(3, "0")}`;
}

export type NewProduct = {
  product_name: string;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  supplier: string | null;
  barcode: string | null;
  location: string | null;
  warehouse_location: string | null;
  image_url: string | null;
  // LAHAT ng litrato (0230) — ang image_url ay ang una (thumbnail ng luma).
  images?: string[] | null;
  // COLOR VARIANTS (0231) — tela mula sa library, bawat isa may sariling
  // litrato; undefined = huwag galawin.
  color_variants?: ColorVariant[] | null;
  cost: number | null;
  price: number | null;
  product_type: string | null; // "Local" | "Imported" — Imported = price locked on orders
  status: string;
  // Specifications / design details — isang linya kada spec (0166); best-effort
  // ang pag-save para gumana pa rin kahit hindi pa tumatakbo ang migration.
  specs?: string | null;
};

export async function addProduct(
  input: NewProduct,
): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/products", "products");
  if (!input.product_name?.trim()) {
    return { error: "Product name is required." };
  }

  const supabase = createServerSupabase();
  // Auto SKU kada category (2026-08-18): PREFIX-000001 sequence — parehong
  // convention ng made-to-order/website items para iisa ang numbering.
  const sku = input.sku?.trim() || (await nextCategorySeqSku(supabase, input.category ?? ""));
  const { data, error } = await supabase.from("product").insert({
    product_name: input.product_name.trim(),
    sku,
    category: input.category || null,
    color: input.color || null,
    dimension: input.dimension || null,
    supplier: input.supplier || null,
    barcode: input.barcode || sku || null,
    location: input.location || null,
    warehouse_location: input.warehouse_location || null,
    image_url: input.image_url || null,
    cost: input.cost,
    price: input.price,
    product_type: input.product_type || "Local",
    status: input.status || "active",
  }).select("id").single();

  if (error) return { error: error.message };
  // SPECS — hiwalay na best-effort update (gaya ng saveCustomizedProduct):
  // kapag hindi pa tumatakbo ang 0166, tahimik na laktawan.
  if (input.specs?.trim() && data?.id) {
    try { await supabase.from("product").update({ specs: input.specs.trim() }).eq("id", data.id); } catch { /* wala pang 0166 */ }
  }
  // LAHAT ng litrato (0230) — hiwalay na best-effort para buo pa rin ang save
  // bago tumakbo ang migration.
  if (input.images?.length && data?.id) {
    try { await supabase.from("product").update({ images: input.images }).eq("id", data.id); } catch { /* wala pang 0230 */ }
  }
  if (input.color_variants?.length && data?.id) {
    try { await supabase.from("product").update({ color_variants: cleanVariants(input.color_variants) }).eq("id", data.id); } catch { /* wala pang 0231 */ }
  }
  await auditAfter({ module: "products", table: "product", recordId: data?.id ?? "—", action: "insert", snapshotTable: "product", snapshotId: data?.id });

  revalidatePath("/products");
  // Products + their categories drive many pages (QC new-item, Sales create-order,
  // scan, inventory…). Revalidate the whole app so they all reflect the change.
  revalidatePath("/", "layout");
  return { ok: true };
}

// SUNUD-SUNOD na made-to-order SKU (hiling 2026-08-17): PREFIX-000001,
// PREFIX-000002… kada category. Ang susunod na numero ay hango sa pinakamataas
// na umiiral sa katalogo; ang save ay may dedupe bilang panangga sa banggaan.
export async function nextMadeToOrderSku(category: string): Promise<string> {
  try {
    const me = await getSession();
    if (!me) return `${categorySkuPrefix(category)}-000001`;
    const supabase = createServerSupabase();
    return await nextCategorySeqSku(supabase, category);
  } catch {
    return `${categorySkuPrefix(category)}-000001`;
  }
}

// Espesyal na prefix ng bed categories — iwas banggaan ng "Custom Bed"
// (CUSTOM…) sa Customized; tugma ito sa genCustomSku ng builder.
function categorySkuPrefix(category: string): string {
  const OVERRIDE: Record<string, string> = { "promo bed": "PBED", "custom bed": "CBED" };
  return OVERRIDE[(category ?? "").trim().toLowerCase()]
    ?? ((category ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6) || "CUSTOM");
}

// Susunod na PREFIX-000001 sequence kada category — hango sa pinakamataas na
// umiiral sa katalogo. Ginagamit ng addProduct at nextMadeToOrderSku.
async function nextCategorySeqSku(
  supabase: ReturnType<typeof createServerSupabase>,
  category: string,
): Promise<string> {
  const prefix = categorySkuPrefix(category);
  const { data } = await supabase.from("product").select("sku").ilike("sku", `${prefix}-%`).limit(2000);
  let max = 0;
  for (const r of data ?? []) {
    const m = new RegExp(`^${prefix}-(\\d{1,6})$`).exec((r.sku ?? "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(6, "0")}`;
}

// CUSTOMIZED → CATALOG (2026-08-17): ang bawat customized na binubuo sa order/
// quotation builder ay nasi-save na rin bilang produkto sa katalogo (lalabas sa
// sariling category, hal. "Customized") para nahahanap at nagagamit muli.
// Session-gated lang (hindi products:edit) — ang sales ang gumagawa nito habang
// nag-oorder; ligtas: bago at sariling SKU ang bawat isa, walang ino-overwrite.
export async function saveCustomizedProduct(input: {
  product_name: string;
  sku: string;
  category?: string | null;
  color?: string | null;
  dimension?: string | null;
  price?: number | null;
  image_url?: string | null;
  images?: string[] | null;
  // Specifications / design details — isang linya kada spec (0166).
  specs?: string | null;
  // Local o Imported — pinipili na ng staff sa builder (2026-08-17).
  product_type?: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me) return { error: "Forbidden." };
  const name = input.product_name?.trim();
  const sku = input.sku?.trim();
  if (!name || !sku) return { error: "Name and SKU are required." };
  const supabase = createServerSupabase();
  // Iwas doble: kapag may ganitong SKU na (dobleng pindot), tahimik na ayos.
  const { data: dupe } = await supabase.from("product").select("id").eq("sku", sku).maybeSingle();
  if (dupe) return { ok: true };
  const { data, error } = await supabase.from("product").insert({
    product_name: name,
    sku,
    category: input.category?.trim() || "Customized",
    color: input.color?.trim() || null,
    dimension: input.dimension?.trim() || null,
    barcode: sku,
    image_url: input.image_url || null,
    price: Number(input.price) || 0,
    product_type: input.product_type === "Imported" ? "Imported" : "Local",
    status: "active",
  }).select("id").single();
  if (error) return { error: error.message };
  // SPECS — hiwalay na update na best-effort: kapag hindi pa tumatakbo ang
  // migration 0166 (walang specs column), tahimik itong lalaktawan at buo pa
  // rin ang produkto.
  if (input.specs?.trim() && data?.id) {
    try { await supabase.from("product").update({ specs: input.specs.trim() }).eq("id", data.id); } catch { /* wala pang 0166 */ }
  }
  await auditAfter({ module: "products", table: "product", recordId: data?.id ?? "—", action: "insert", snapshotTable: "product", snapshotId: data?.id });
  revalidatePath("/", "layout");
  return { ok: true };
}

// LATE NA LITRATO (2026-08-17): pag-upload ng product image mula mismo sa
// product browser detail pane — minsan wala pang litrato sa pag-save ng
// customized at kalaunan pa dumarating. Session-gated; image_url lang ang
// binabago.
export async function setProductImage(id: number, imageUrl: string): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me) return { error: "Forbidden." };
  if (!id || !imageUrl?.trim()) return { error: "Missing product / image." };
  const supabase = createServerSupabase();
  const { error } = await supabase.from("product").update({ image_url: imageUrl.trim() }).eq("id", id);
  if (error) return { error: error.message };
  await auditAfter({ module: "products", table: "product", recordId: id, action: "update", snapshotTable: "product", snapshotId: id });
  revalidatePath("/", "layout");
  return { ok: true };
}

// Best-effort na pag-update ng as-is na detalye ng listing sa site
// (mtoReadySpecs / mtoReadyPrice) — tahimik kapag walang listing o nabigo.
// PRODUCT MANAGEMENT ANG SOURCE: pangalan, larawan, specs at presyo ng unit ay
// sinusundan ng site listing (web_products) at ng MTO config
// (website_item_config) sa bawat Save — hindi na kailangang mag-Publish ulit.
async function syncWebReady(
  supabase: ReturnType<typeof createServerSupabase>,
  sku: string,
  specs: string | null | undefined,
  price: number | null | undefined,
  name?: string,
  category?: string | null,
  image?: string | null,
  images?: string[] | null,
  variants?: ColorVariant[],
): Promise<void> {
  try {
    const { data: rows } = await supabase.from("web_products").select("slug, data").eq("data->>sku", sku).limit(5);
    for (const row of rows ?? []) {
      const data = { ...((row.data as Record<string, unknown>) ?? {}) };
      // COLOR VARIANTS (0231): ang listing ay sumusunod sa Product Management -
      // kulay + tela swatch + litrato kada kulay. Walang variant = walang
      // colors (lahat ng litrato = thumbs ng card, gaya ng dati).
      if (variants !== undefined) Object.assign(data, webColorFields(variants));
      if (specs !== undefined) {
        data.mtoReadySpecs = specs?.trim() || "";
        // ANG DIMENSIONS AY KASUNOD DIN (2026-08-26). Blangko ito sa lahat ng
        // listing, kaya ang Dimensions na tab sa pahina ay bumabagsak sa naka-
        // hardcode na sukat (34"/24"/6"…) — hindi ang inilagay sa IMS. Ang
        // Product Management ang source: kung ano ang nakatala rito, iyon ang
        // lumalabas. Kaparehong teksto ng mtoReadySpecs, na nababasa na ng site.
        // W×D×H (2026-09-04) kapag may Width/Length/Height sa specs — ito ang
        // binabasa ng Will-it-fit; kung kulang, ang buong specs gaya ng dati.
        data.dimensions = dimensionsFromSpecs(specs) ?? (specs?.trim() || "");
      }
      if (price != null) data.mtoReadyPrice = Number(price);
      if (name?.trim()) data.name = name.trim();
      // LAHAT NG LITRATO NG PRODUKTO ANG MASUSUNOD (2026-09-03, "kung ano
      // image dito un din magiging image sa mto at website"): kapag may
      // listahan, PALITAN ang gallery ng listing; ang iisang image ay pambalik
      // lang sa blangkong listing.
      if (images?.length) data.images = images;
      else if (image && !(Array.isArray(data.images) && (data.images as string[]).length)) data.images = [image];
      await supabase.from("web_products").update({ data, updated_at: new Date().toISOString() }).eq("slug", row.slug);
    }
    // Ang webColorFields ay walang stock — ibalik ang kada-kulay na bilang
    // mula sa inventory pagkatapos maisulat ang swatches.
    await syncWebStock(supabase, [sku]);
  } catch { /* best effort */ }
  try {
    const { data: cfgs } = await supabase.from("website_item_config").select("sku, data").eq("sku", sku).limit(1);
    for (const row of cfgs ?? []) {
      const data = { ...((row.data as Record<string, unknown>) ?? {}) };
      if (name?.trim()) data.name = name.trim();
      if (category) data.category = category;
      if (images?.length) data.images = images;
      // ANG SUKAT NA IPINAPAKITA NG WEBSITE (2026-08-26) ay nasa
      // measurements[].def ng config — hindi sa `dimensions`. Ang mga halagang
      // ito ay KINOPYA sa CATEGORY_MEASUREMENTS nang gawin ang config, kaya
      // 34"/24"/22" ang lumalabas sa Dimensions na tab kahit ibang sukat ang
      // inilagay sa Product Management: dalawang magkahiwalay na numero.
      // Ang Product Management ang source; ang template ay panimula na lang.
      // Kasama ang mga BAGONG sukat ng template (Length/Width) na wala pa sa
      // lumang config - idinadagdag, tapos ang halaga ay mula sa specs.
      if (specs !== undefined) {
        data.measurements = mergeTemplateMeasures(data.measurements as { label?: unknown; def?: unknown }[] | undefined, String(category ?? data.category ?? ""), specs);
      }
      await supabase.from("website_item_config").update({ data, updated_at: new Date().toISOString() }).eq("sku", sku);
    }
  } catch { /* best effort */ }
}

// ANG KATAPAT NG syncWebReady PARA SA PAGTANGGAL (2026-08-25). Ang Save ay
// sumusunod sa dalawang tablang ito, pero ang Delete ay tumatanggal lang sa
// `product` — kaya nananatili sa website ang listing ng produktong wala na.
// Sampung ulila ang naiwan (Sofa, Sofa Bed ×3, Ottoman, Wall Padding ×5): binura
// sa Product Management, buhay pa sa site.
async function removeWebListing(
  supabase: ReturnType<typeof createServerSupabase>,
  sku: string | null | undefined,
): Promise<void> {
  const key = (sku ?? "").trim();
  if (!key) return;
  // Ang site listing ay naka-key sa `slug` at hawak ang SKU sa loob ng `data`;
  // ang MTO config ay naka-key sa SKU mismo.
  try { await supabase.from("web_products").delete().eq("data->>sku", key); } catch { /* best effort */ }
  try { await supabase.from("website_item_config").delete().eq("sku", key); } catch { /* best effort */ }
}

export async function updateProduct(
  id: number,
  input: NewProduct,
): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/products", "products");
  if (!input.product_name?.trim()) {
    return { error: "Product name is required." };
  }

  const supabase = createServerSupabase();
  const before = await snapshot("product", id);
  // Fill a blank SKU on edit too (e.g. legacy products imported without one).
  const sku = input.sku?.trim() || (await nextSku(supabase, input.category, input.product_name));
  const { error } = await supabase
    .from("product")
    .update({
      product_name: input.product_name.trim(),
      sku,
      category: input.category || null,
      color: input.color || null,
      dimension: input.dimension || null,
      supplier: input.supplier || null,
      barcode: input.barcode || sku || null,
      location: input.location || null,
      warehouse_location: input.warehouse_location || null,
      image_url: input.image_url || null,
      cost: input.cost,
      price: input.price,
      product_type: input.product_type || "Local",
      status: input.status || "active",
    })
    .eq("id", id);

  if (error) return { error: error.message };
  // SPECS — hiwalay na best-effort (0166); undefined = huwag galawin,
  // pero ang blangkong string ay pagbura (nilinis ng user ang field).
  if (input.specs !== undefined) {
    try { await supabase.from("product").update({ specs: input.specs?.trim() || null }).eq("id", id); } catch { /* wala pang 0166 */ }
  }
  if (input.images !== undefined) {
    try { await supabase.from("product").update({ images: input.images ?? [] }).eq("id", id); } catch { /* wala pang 0230 */ }
  }
  if (input.color_variants !== undefined) {
    try { await supabase.from("product").update({ color_variants: cleanVariants(input.color_variants ?? []) }).eq("id", id); } catch { /* wala pang 0231 */ }
  }
  // SITE LISTING (2026-08-23): kapag may web_products row na ang SKU (galing
  // sa Configurator Publish), isabay ang bagong specs/presyo ng yari na unit —
  // kaya ang Sizes/Thickness na in-edit dito ay agad nasa product page, hindi
  // na kailangang mag-Publish ulit.
  await syncWebReady(supabase, sku, input.specs, input.price, input.product_name, input.category, input.image_url, input.images ?? null, input.color_variants === undefined ? undefined : cleanVariants(input.color_variants ?? []));
  // INVENTORY ROWS ng parehong SKU: sundan ang bagong pangalan/category para
  // pareho ang nababasa sa Inventory Management at sa Products (best-effort).
  try {
    await supabase.from("inventory").update({ product_name: input.product_name.trim(), category: input.category || null }).eq("sku", sku);
  } catch { /* best effort */ }
  await auditAfter({ module: "products", table: "product", recordId: id, action: "update", before, snapshotTable: "product", snapshotId: id });

  revalidatePath("/products");
  // Products + their categories drive many pages (QC new-item, Sales create-order,
  // scan, inventory…). Revalidate the whole app so they all reflect the change.
  revalidatePath("/", "layout");
  return { ok: true };
}

const BUCKET = "product-images";

export async function uploadProductImage(
  formData: FormData,
): Promise<{ url: string } | { error: string }> {
  // This generic image upload is shared by MANY modules (products, delivery packing
  // proofs, installation photos, QC proofs, etc.), so it must NOT be gated on the
  // /products permission — a delivery/warehouse user without products-edit access would
  // otherwise hit requireEdit()'s throw, which crashed the server action ("An error
  // occurred in the Server Components render"). Any signed-in user may upload an image;
  // the module's OWN save action (savePackingProof, saveDelivery, etc.) enforces access.
  const me = await getSession();
  if (!me) return { error: "Not signed in." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "No file selected." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { error: "Image must be under 5 MB." };
  }

  const supabase = createServerSupabase();
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const rand = Math.random().toString(36).slice(2);
  // Organize uploads into per-type (and per-order) subfolders, e.g. "installation-photos/ORD-000003".
  const folderRaw = String(formData.get("folder") ?? "products");
  const folder = folderRaw.split("/").map((s) => s.replace(/[^a-z0-9_-]/gi, "")).filter(Boolean).join("/") || "products";
  const path = `${folder}/${Date.now()}-${rand}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: false });

  if (error) return { error: error.message };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

// DIREKTA SA STORAGE (2026-08-31). Ang uploadProductImage ay naghahakot ng
// bytes SA PAMAMAGITAN ng Node server — telepono → Hostinger → Tokyo — at
// noong nasiksikan ang server (render storm), ang mga litrato ay inabot ng
// minuto. Dito, ang server ay PUMIPIRMA LANG: maliit na JSON na may signed
// upload URL, at ang browser mismo ang nagpapadala ng bytes diretso sa
// Supabase Storage. Ang server ay hindi na dinadaanan ng laman.
// Parehong bakod ng uploadProductImage: kahit sinong naka-login (ang module
// save actions ang tunay na bantay), parehong folder sanitization.
export async function signImageUpload(
  input: { name: string; folder?: string | null },
): Promise<{ bucket: string; path: string; token: string; url: string } | { error: string }> {
  const me = await getSession();
  if (!me) return { error: "Not signed in." };
  const supabase = createServerSupabase();
  const ext = (String(input.name ?? "").split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const rand = Math.random().toString(36).slice(2);
  const folderRaw = String(input.folder ?? "products");
  const folder = folderRaw.split("/").map((s) => s.replace(/[^a-z0-9_-]/gi, "")).filter(Boolean).join("/") || "products";
  const path = `${folder}/${Date.now()}-${rand}.${ext}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "Could not sign the upload." };
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { bucket: BUCKET, path, token: data.token, url: pub.publicUrl };
}

// Remove a file from storage given its public URL (e.g. when an image is deleted in the UI).
export async function deleteStorageImage(
  url: string,
): Promise<{ ok: true } | { error: string }> {
  // Shared across modules (same reason as uploadProductImage) — any signed-in user may
  // remove an image they just added; module save actions enforce real access.
  const me = await getSession();
  if (!me) return { error: "Not signed in." };
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return { error: "Not a storage URL." };
  const path = decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
  if (!path) return { error: "Empty path." };
  const supabase = createServerSupabase();
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteProduct(
  id: number,
): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/products", "products");
  const supabase = createServerSupabase();
  const before = await snapshot("product", id);
  const { data: row } = await supabase.from("product").select("image_url, sku").eq("id", id).single();
  const { error } = await supabase.from("product").delete().eq("id", id);
  if (error) return { error: error.message };
  if (row?.image_url) await deleteStorageImage(row.image_url).catch(() => {});
  // Ang website ay sumusunod sa Product Management — sa pagtanggal din, hindi sa
  // Save lang. Kung hindi, mananatili sa site ang produktong wala na.
  await removeWebListing(supabase, row?.sku as string | null);
  await audit({ module: "products", table: "product", recordId: id, action: "delete", before });

  revalidatePath("/products");
  // Products + their categories drive many pages (QC new-item, Sales create-order,
  // scan, inventory…). Revalidate the whole app so they all reflect the change.
  revalidatePath("/", "layout");
  return { ok: true };
}
