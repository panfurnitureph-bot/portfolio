"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { nextDocNumber } from "@/lib/next-number";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { fbConfig } from "@/lib/fb/contacts";
import { sendFbMessage } from "@/lib/fb/notify";
import {
  renderDesignDetailsSvg, designFollowupMessage, DESIGN_MAX_FOLLOWUPS,
  type DesignLabel, type DesignInset,
} from "@/lib/design-details";
import { panLogoDataUri } from "@/lib/quotation-assets";
import { auditAfter } from "@/lib/audit";

// DESIGN DETAILS — gumagawa ng spec sheet na larawan, iniimbak, at ipinapadala
// sa Messenger para APRUBAHAN ng customer bago simulan ang produksyon. Parehong
// makina ng Formal Quotation (app/quotations/actions.ts) — tingnan doon ang mga
// dahilan ng bawat hakbang (public bucket, data URI, 24h window, atbp.).
const BUCKET = "product-images";
const WINDOW_HOURS = 24;
const MAX_RECIPIENTS = 50;

export type DesignDetailsInput = {
  customerName: string;
  address?: string | null;
  orderNumber?: string | null;
  title: string;
  bullets: string[];
  // URL sa storage (na-upload na ng builder) + tunay na sukat ng litrato.
  photoUrl?: string | null;
  photoW?: number;
  photoH?: number;
  labels?: DesignLabel[];
  insets?: DesignInset[];
  swatchUrl?: string | null;
  swatchLabel?: string | null;
  mattress?: string | null;
  headboard?: string | null;
  note?: string | null;
  psids?: string[];
  // RESEND (2026-08-17): id ng UMIIRAL na DD — parehong DD # ang gagamitin at
  // ang dating row ang ina-update, hindi gumagawa ng bago.
  resendId?: number | null;
};

// URL → data URI, para makapasok sa SVG na hinahatak ni Meta.
//
// UNANG DAAN: kapag sariling storage URL, i-download sa supabase-js (service
// role) — ito rin ang channel na ginamit ng upload, kaya subok na bukas sa
// server na ito. Nasukat 2026-08-09 na ang plain fetch ng public URL ay pumalya
// sa deployed na server (blangko ang swatch sa unang DD-000001) kahit gumagana
// ito sa local — kaya hindi na ito ang inaasahan; fallback na lang ito para sa
// mga panlabas na URL.
// CACHE kada URL (2026-08-17): ang preview → create ay dina-download dati ang
// PAREHONG mga litrato nang dalawang beses (multi-MB bawat isa) — ito ang
// pangunahing bagal ng "Create & send". 5 minuto, hanggang 40 entry.
const EMBED_TTL_MS = 5 * 60_000;
const embedCache = new Map<string, { at: number; data: string | null }>();

async function embedImage(
  db: ReturnType<typeof createServerSupabase>,
  url: string | null | undefined,
): Promise<string | null> {
  const src = url?.trim();
  if (!src || !/^https?:\/\//i.test(src)) return null;
  const hit = embedCache.get(src);
  if (hit && Date.now() - hit.at < EMBED_TTL_MS) return hit.data;
  const out = await embedImageUncached(db, src);
  // Ang PUMALYANG embed ay hindi kina-cache — baka pansamantalang network
  // problema lang; ang susunod na subok ay dapat totoong subok.
  if (out) {
    if (embedCache.size >= 40) embedCache.delete(embedCache.keys().next().value!);
    embedCache.set(src, { at: Date.now(), data: out });
  }
  return out;
}

async function embedImageUncached(
  db: ReturnType<typeof createServerSupabase>,
  src: string,
): Promise<string | null> {
  const m = src.match(new RegExp(`/object/public/${BUCKET}/([^?#]+)`));
  if (m) {
    try {
      const { data } = await db.storage.from(BUCKET).download(decodeURIComponent(m[1]));
      if (data) {
        const buf = Buffer.from(await data.arrayBuffer());
        const type = data.type?.startsWith("image/") ? data.type : "image/jpeg";
        if (buf.length && buf.length <= 2_500_000) return `data:${type};base64,${buf.toString("base64")}`;
      }
    } catch { /* subukan ang fetch sa ibaba */ }
  }

  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(8000) });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.startsWith("image/")) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length && buf.length <= 2_500_000) return `data:${type};base64,${buf.toString("base64")}`;
    }
  } catch { /* blangko */ }
  return null;
}

function cleanInput(input: DesignDetailsInput) {
  return {
    customerName: input.customerName?.trim() ?? "",
    address: input.address?.trim() || null,
    orderNumber: input.orderNumber?.trim() || null,
    title: input.title?.trim() ?? "",
    // Hinuhugasan ang mga NAKAUNANG bullet character — ang staff ay madalas
    // nagta-type/nagpe-paste ng "• Fabric: …", at ang renderer ay gumuguhit na
    // ng sariling tuldok, kaya nagdodoble (nakita sa unang DD-000001).
    bullets: (input.bullets ?? [])
      .map((b) => String(b ?? "").trim().replace(/^[\s•·▪◦●○*–—-]+\s*/, ""))
      .filter(Boolean),
    photoUrl: input.photoUrl?.trim() || null,
    photoW: Number(input.photoW) || 0,
    photoH: Number(input.photoH) || 0,
    labels: (input.labels ?? [])
      .map((l) => {
        const c01 = (n: unknown) => Math.min(1, Math.max(0, Number(n)));
        const hasPts = [l.ax, l.ay, l.bx, l.by].every((n) => Number.isFinite(Number(n)));
        return {
          x: Number(l.x) || 0,
          y: Number(l.y) || 0,
          text: String(l.text ?? "").trim(),
          // Numero ng spec na tinutukoy — tumutugma sa numbered specs list.
          ...(Number.isInteger(Number(l.num)) && Number(l.num) > 0
            ? { num: Math.min(50, Number(l.num)) }
            : {}),
          // Sukat-arrow: v/h + len ang lumang anyo; ang malayang dulo
          // (ax..by, kahit anong hilig) ang iniimbak ng builder ngayon.
          ...(l.arrow === "v" || l.arrow === "h"
            ? { arrow: l.arrow, len: Math.min(1, Math.max(0.05, Number(l.len) || 0.3)) }
            : {}),
          ...(hasPts ? { ax: c01(l.ax), ay: c01(l.ay), bx: c01(l.bx), by: c01(l.by) } : {}),
        };
      })
      // Tanggap ang arrow na walang text — sukat na papatungan ng hiwalay
      // na label; ang itinatapon lang ay ang parehong walang text at arrow.
      .filter((l) => l.text || l.arrow || l.ax !== undefined),
    // Inset photos — maliliit na halimbawang litrato sa ibabaw ng main photo.
    insets: (input.insets ?? [])
      .filter((i) => (i.url ?? "").trim())
      .map((i) => ({
        url: (i.url ?? "").trim(),
        x: Math.min(1, Math.max(0, Number(i.x) || 0)),
        y: Math.min(1, Math.max(0, Number(i.y) || 0)),
        w: Math.min(0.9, Math.max(0.1, Number(i.w) || 0.35)),
        iw: Math.max(1, Number(i.iw) || 4),
        ih: Math.max(1, Number(i.ih) || 3),
        text: String(i.text ?? "").trim(),
      })),
    swatchUrl: input.swatchUrl?.trim() || null,
    swatchLabel: input.swatchLabel?.trim() || null,
    mattress: input.mattress?.trim() || null,
    headboard: input.headboard?.trim() || null,
    note: input.note?.trim() || null,
  };
}

// Ibinubuo ang SVG mula sa input — ginagamit ng preview at ng create para IISA
// ang dinadaanan (ang nakikita sa preview ang eksaktong maipapadala).
//
// MAINGAY kapag pumalya: kapag may ibinigay na litrato/swatch pero hindi
// ma-embed, ERROR — hindi tahimik na nagpapadala ng sheet na walang larawan
// (nangyari sa unang DD-000001: naipadala nang blangko ang swatch).
async function renderFromInput(
  db: ReturnType<typeof createServerSupabase>,
  input: DesignDetailsInput,
  initials: string | null,
  ddNumber: string | null = null,
  // APPROVED render — pinupunan ang tatlong pirmahan + berdeng APPROVED chip.
  approval: { customer: string; date: string; authorized: string } | null = null,
): Promise<{ svg: string } | { error: string }> {
  const c = cleanInput(input);
  const [logo, photo, swatch] = await Promise.all([
    panLogoDataUri(),
    embedImage(db, c.photoUrl),
    embedImage(db, c.swatchUrl),
  ]);
  if (c.photoUrl && !photo) return { error: "Could not load the product photo into the sheet — remove it and upload again." };
  if (c.swatchUrl && !swatch) return { error: "Could not load the fabric swatch into the sheet — remove it and upload again." };
  // Mga inset — SABAY-SABAY na embed (dating isa-isa, mabagal sa marami);
  // parehong maingay na pagbagsak kapag hindi ma-embed.
  const insetImgs = await Promise.all(c.insets.map((ins) => embedImage(db, ins.url)));
  const insets: DesignInset[] = [];
  for (let i = 0; i < c.insets.length; i++) {
    if (!insetImgs[i]) return { error: "Could not load an inset photo into the sheet — remove it and upload again." };
    insets.push({ ...c.insets[i], img: insetImgs[i]! });
  }
  const dateLabel = new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
  const svg = renderDesignDetailsSvg({
    customerName: c.customerName,
    address: c.address,
    orderNumber: c.orderNumber,
    ddNumber,
    dateLabel,
    initials,
    title: c.title,
    bullets: c.bullets,
    photo,
    photoW: c.photoW,
    photoH: c.photoH,
    labels: c.labels,
    insets,
    swatch,
    swatchLabel: c.swatchLabel,
    mattress: c.mattress,
    headboard: c.headboard,
    note: c.note,
    logo,
    approval,
  });
  return { svg };
}

// ── OPEN ORDERS PICKER (2026-08-16) ──────────────────────────────────────────
// Mga order na HINDI PA delivered/tapos — dropdown sa Order number ng builder;
// pagpili, awtomatikong napupunan ang Customer name at Address.
export type OpenOrderPick = { orderNumber: string; customer: string; address: string };
export async function openOrdersForDesign(): Promise<OpenOrderPick[]> {
  const me = await getSession();
  if (!me || !hasPermission(me, "design_details", "edit")) return [];
  const db = createServerSupabase();
  const { data } = await db.from("orders")
    .select("order_number, customer_name, address, status")
    .not("order_number", "is", null)
    .not("status", "ilike", "%deliver%")
    .not("status", "ilike", "%complete%")
    .not("status", "ilike", "%cancel%")
    .order("id", { ascending: false })
    .limit(300);
  return (data ?? []).map((o) => ({
    orderNumber: (o.order_number as string) ?? "",
    customer: (o.customer_name as string) ?? "",
    address: (o.address as string) ?? "",
  })).filter((o) => o.orderNumber);
}

// ── APPROVED RE-RENDER ───────────────────────────────────────────────────────
// Tinatawag ng FB webhook pagkatapos ng DD_ACCEPT: muling nire-render ang sheet
// na PUNO na ang tatlong pirmahan (customer, petsa, gumawa ng DD) at APPROVED
// na ang chip, tapos pinapalitan ang image_url ng row. WALANG session dito
// (webhook context) — ligtas dahil (a) kailangang Accepted na ang row, at
// (b) wala itong ibang binabago kundi ang render ng sariling sheet.
export async function refreshApprovedDesignSheet(id: number): Promise<{ ok: true } | { error: string }> {
  try {
    const db = createServerSupabase();
    const { data: r } = await db.from("design_details").select("*").eq("id", id).maybeSingle();
    if (!r) return { error: "Design details not found." };
    if (String(r.status) !== "Accepted") return { error: "Not accepted yet." };
    // UPLOADED-IMAGE na DD (blangkong bullets at walang photo_url): huwag
    // i-re-render — papalitan lang nito ng blangkong template ang sheet nila.
    // Mananatili ang in-upload na image; status na lang ang nag-a-Accepted.
    if (!((r.bullets as string[] | null)?.length) && !r.photo_url) return { ok: true };

    const input: DesignDetailsInput = {
      customerName: (r.customer_name as string) ?? "",
      address: (r.address as string | null) ?? null,
      orderNumber: (r.order_number as string | null) ?? null,
      title: (r.title as string) ?? "",
      bullets: (r.bullets as string[]) ?? [],
      photoUrl: (r.photo_url as string | null) ?? null,
      photoW: (r.photo_w as number | null) ?? undefined,
      photoH: (r.photo_h as number | null) ?? undefined,
      labels: (r.labels as DesignLabel[]) ?? [],
      insets: (r.insets as DesignInset[]) ?? [],
      swatchUrl: (r.swatch_url as string | null) ?? null,
      swatchLabel: (r.swatch_label as string | null) ?? null,
      mattress: (r.mattress as string | null) ?? null,
      headboard: (r.headboard as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    };
    const createdBy = (r.created_by as string | null)?.trim() || "PAN Furniture";
    const dateLabel = new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
    const rendered = await renderFromInput(
      db, input,
      initialsOf({ full_name: createdBy }),
      (r.dd_number as string | null) ?? null,
      { customer: input.customerName || "—", date: dateLabel, authorized: createdBy },
    );
    if ("error" in rendered) return rendered;

    const slug = (input.customerName || "customer").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "customer";
    const path = `design/${slug}/${Date.now()}-approved.svg`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, Buffer.from(rendered.svg), {
      contentType: "image/svg+xml", upsert: false,
    });
    if (upErr) return { error: upErr.message };
    const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    await db.from("design_details").update({ image_url: url, updated_at: new Date().toISOString() }).eq("id", id);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to refresh the approved sheet." };
  }
}

// Ang initials sa ibaba ng sheet ("8/8/2026-OCRAY") — apelyido ng gumawa,
// malaking titik, gaya ng orihinal.
function initialsOf(me: { full_name?: string | null; email?: string | null }): string | null {
  const name = me.full_name?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    return parts[parts.length - 1].toUpperCase().slice(0, 12);
  }
  return me.email?.split("@")[0]?.toUpperCase().slice(0, 12) ?? null;
}

// ── PREVIEW ──────────────────────────────────────────────────────────────────
// Ibinabalik ang SVG mismo — ipinapakita ng builder bilang data URI sa <img>.
export async function previewDesignDetails(input: DesignDetailsInput): Promise<{ svg: string } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "design_details", "edit")) return { error: "Not allowed." };
  return renderFromInput(createServerSupabase(), input, initialsOf(me));
}

// ── CREATE + SEND ────────────────────────────────────────────────────────────
export type DesignDetailsResult = {
  id: number | null;
  ddNumber: string | null;
  url: string;
  sent: number;
  failed: number;
  skipped: number;
};

export async function createDesignDetails(input: DesignDetailsInput): Promise<DesignDetailsResult | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "design_details", "edit")) return { error: "Not allowed." };

  const c = cleanInput(input);
  if (!c.customerName) return { error: "Customer name is required." };
  if (!c.title) return { error: "Add the design title (e.g. PROMO BED: FULL DOUBLE SIZE 54X75)." };

  const db = createServerSupabase();

  // RESEND: kunin ang umiiral na row — parehong DD # at parehong row ang
  // ia-update (naiulat 2026-08-17 na nagbabago ang DD # sa bawat resend).
  type ResendRow = { id: number; dd_number: string | null; sent_count: number | null };
  let resendRow: ResendRow | null = null;
  if (input.resendId) {
    const { data: ex } = await db.from("design_details")
      .select("id, dd_number, sent_count").eq("id", input.resendId).maybeSingle();
    if (ex) resendRow = ex as ResendRow;
  }

  // Ang DD number ay kinukuha BAGO ang render — nasa document header na ito
  // (enterprise template). Kapag pumalya ang render, may butas sa sequence —
  // ayos lang iyon, hindi kailangang tuloy-tuloy ang numero. Sa RESEND, ang
  // dating numero ang gamit — hindi na kumukuha ng bago.
  let ddNumber: string | null = resendRow?.dd_number ?? null;
  if (!resendRow) {
    ddNumber = await nextDocNumber(db, "design_details", "dd_number", "DD", "next_design_number");
  }

  const rendered = await renderFromInput(db, input, initialsOf(me), ddNumber);
  if ("error" in rendered) return rendered;

  const slug = c.customerName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "customer";
  const path = `design/${slug}/${Date.now()}.svg`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, Buffer.from(rendered.svg), {
    contentType: "image/svg+xml",
    upsert: false,
  });
  if (upErr) return { error: `Could not save the design sheet: ${upErr.message}` };
  const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  // Itala BAGO magpadala — kailangan ang row ID sa button payload (DD_ACCEPT:<id>).
  // Sa RESEND: ang dating row ang ina-update (parehong id at DD #).
  let designId: number | null = null;
  if (resendRow) {
    try {
      await db.from("design_details").update({
        order_number: c.orderNumber,
        customer_name: c.customerName,
        address: c.address,
        title: c.title,
        bullets: c.bullets,
        photo_url: c.photoUrl,
        photo_w: c.photoW || null,
        photo_h: c.photoH || null,
        swatch_url: c.swatchUrl,
        swatch_label: c.swatchLabel,
        labels: c.labels,
        insets: c.insets,
        mattress: c.mattress,
        headboard: c.headboard,
        note: c.note,
        image_url: url,
        updated_at: new Date().toISOString(),
      }).eq("id", resendRow.id);
      designId = resendRow.id;
    } catch { /* best-effort — nasa storage pa rin ang bagong sheet */ }
  } else {
  try {
    const { data: row } = await db.from("design_details").insert({
      dd_number: ddNumber,
      order_number: c.orderNumber,
      customer_name: c.customerName,
      address: c.address,
      title: c.title,
      bullets: c.bullets,
      photo_url: c.photoUrl,
      photo_w: c.photoW || null,
      photo_h: c.photoH || null,
      swatch_url: c.swatchUrl,
      swatch_label: c.swatchLabel,
      labels: c.labels,
      // Ang insets ay galing sa 0164 — kung wala pa ang column, ang buong
      // insert ay babagsak; hinuhuli iyon ng try sa ibaba (nasa storage pa rin
      // ang sheet), pero ang tamang lunas ay patakbuhin ang migration.
      insets: c.insets,
      mattress: c.mattress,
      headboard: c.headboard,
      note: c.note,
      image_url: url,
      status: "Draft",
      created_by: me.full_name?.trim() || me.email || null,
    }).select("id").single();
    designId = (row?.id as number) ?? null;
  } catch { /* wala pang table — nasa storage pa rin ang sheet */ }
  }

  // Padala: teksto → larawan → mga buton — parehong anyo ng quotation (napag-
  // alaman 2026-08-09 na ito ang tanging maayos na porma; tingnan actions.ts ng
  // quotations para sa mga natuklasan). Maiikling linya para makitid ang bubble.
  let sent = 0, failed = 0, skipped = 0;
  const unique = [...new Set((input.psids ?? []).filter(Boolean))];
  if (unique.length) {
    if (unique.length > MAX_RECIPIENTS) return { error: `Too many at once — pick ${MAX_RECIPIENTS} or fewer.` };
    const cfg = fbConfig();
    if (!cfg) return { error: "Facebook is not configured." };

    const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
    const { data: fresh } = await db.from("fb_contacts").select("psid").in("psid", unique).gte("last_message_at", since);
    const allowed = new Set((fresh ?? []).map((r) => r.psid as string));
    skipped = unique.length - allowed.size;

    const firstName = c.customerName.split(/\s+/)[0].slice(0, 20);
    const blurb = [
      `Hi ${firstName}!`,
      "Here are your design details.",
      "",
      "Please review the size, fabric,",
      "and measurements below. We",
      "start production once you",
      "approve the design:",
    ].join("\n");

    for (const psid of unique) {
      if (!allowed.has(psid)) continue;
      await sendFbMessage(cfg.pageId, cfg.token, psid, { text: blurb }, "design blurb");
      const ok = await sendFbMessage(
        cfg.pageId, cfg.token, psid,
        { attachment: { type: "image", payload: { url, is_reusable: true } } },
        "design image",
      );
      if (ok && designId) {
        await sendFbMessage(
          cfg.pageId, cfg.token, psid,
          {
            attachment: {
              type: "template",
              payload: {
                template_type: "button",
                text: "Would you like to approve this design?",
                buttons: [
                  { type: "postback", title: "Approve design", payload: `DD_ACCEPT:${designId}` },
                  { type: "postback", title: "I have questions", payload: `DD_QUESTION:${designId}` },
                ],
              },
            },
          },
          "design buttons",
        );
      }
      if (ok) sent++;
      else failed++;
    }
  }

  try {
    await auditAfter({ module: "orders", table: "app_settings", recordId: `design:${slug}`, action: "insert", snapshotId: null });
  } catch { /* best-effort */ }

  if (designId && sent > 0) {
    try {
      await db.from("design_details").update({
        status: "Sent",
        // Sa resend, DAGDAG sa dating bilang — hindi pinapalitan.
        sent_count: (resendRow?.sent_count ?? 0) + sent,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", designId);
    } catch { /* best-effort */ }
  }

  return { id: designId, ddNumber, url, sent, failed, skipped };
}

// Isang linya ng resibo. Ang bayarin (shipping, rush) ay linya rin dito pero
// walang SKU — kaya ang bilang ng linyang MAY SKU ang panukat kung iisa ba ang
// produkto ng order, hindi ang haba ng listahan.
type OrderLine = { sku?: string | null; description?: string | null };

// ── LISTAHAN ─────────────────────────────────────────────────────────────────
export type DesignDetailsRow = {
  id: number;
  ddNumber: string | null;
  orderNumber: string | null;
  customer: string;
  address: string | null;
  title: string;
  bullets: string[];
  // Specs na ipinapakita ng UPLOADED na sheet (0172) — hiwalay sa `bullets`,
  // na ang pagiging blangko ang tanda ng uploaded-image na DD.
  specs: string[];
  photoUrl: string | null;
  photoW: number;
  photoH: number;
  labels: DesignLabel[];
  insets: DesignInset[];
  swatchUrl: string | null;
  swatchLabel: string | null;
  mattress: string | null;
  headboard: string | null;
  note: string | null;
  imageUrl: string | null;
  status: string;
  createdBy: string | null;
  sentCount: number;
  createdAt: string;
  repliedAt: string | null;
  followupCount: number;
  // STOCK BUILD: walang order. Ang hilera ay nagsusuot ng STOCK na tanda at
  // BLANGKO ang Order # — ang SKU ang nasa sariling hanay nito.
  stockBuild: boolean;
  // Alin sa mga produkto ang binuo ng sheet (0183). Ang isang order ay
  // maaaring may ilang item, kaya hindi ito matutukoy sa order number lang.
  sku: string | null;
  // Hindi itinatago sa sheet: hinuhugot sa produkto sa pamamagitan ng SKU,
  // para laging kasunod ito ng Product Management.
  category: string | null;
  // Galing sa ORDER, hindi sa design_details (walang contact column doon).
  // Ang address ay nasa dalawang lugar; ang sa order ang mas sariwa, dahil
  // doon ito ina-update kapag lumilipat ang delivery.
  contact: string | null;
};

export async function loadDesignDetails(limit = 100): Promise<DesignDetailsRow[]> {
  const me = await getSession();
  if (!me || !hasPermission(me, "design_details", "edit")) return [];
  try {
    const db = createServerSupabase();
    const { data } = await db.from("design_details").select("*").order("created_at", { ascending: false }).limit(limit);
    // Ang contact (at ang pinakabagong address) ay nasa order — isang query
    // para sa lahat, hindi isa-isa kada hilera.
    const orderNos = [...new Set((data ?? []).map((r) => (r.order_number as string | null)?.trim()).filter(Boolean) as string[])];
    const byOrder = new Map<string, { contact: string | null; address: string | null; lines: OrderLine[] }>();
    if (orderNos.length) {
      const { data: os } = await db.from("orders").select("order_number, contact_number, address, receipt_items").in("order_number", orderNos);
      for (const o of (os ?? []) as { order_number: string; contact_number: string | null; address: string | null; receipt_items: OrderLine[] | null }[]) {
        byOrder.set(o.order_number.trim(), { contact: o.contact_number, address: o.address, lines: o.receipt_items ?? [] });
      }
    }
    // ALIN ANG STOCK BUILD? Ang bawat SKU na hawak ng mga hilerang ito ay
    // itinatanong sa workshop_job. Kailangang ang SKU ang tanong, hindi ang
    // order number: matapos ang backfill (0184) ay blangko na ang order ng
    // isang stock build — ang SKU na lang ang natitirang kawing.
    const stockSkus = new Set<string>();
    const cand = [...new Set([
      ...orderNos.filter((n) => !byOrder.has(n)),
      ...((data ?? []).map((r) => ((r as Record<string, unknown>).sku as string | null)?.trim()).filter(Boolean) as string[]),
    ])];
    if (cand.length) {
      const { data: sj } = await db.from("workshop_job").select("stock_sku").eq("stock_request", true).in("stock_sku", cand);
      for (const j of sj ?? []) { const k = (j.stock_sku as string | null)?.trim(); if (k) stockSkus.add(k); }
    }

    // KAPAG WALANG NAITALANG SKU (mga sheet bago ang 0183): hinahanap ito sa
    // mga linya ng order. Ang PAMAGAT ang katugma — ito ang unang linya ng
    // description ng item. Kapag iisa lang ang produkto, ito na iyon nang
    // walang panghuhula; kapag marami, ang tugmang pamagat ang tanging basehan,
    // at kung wala, blangko: mas masahol ang maling SKU kaysa walang SKU.
    const skuFor = (orderNo: string | null, title: string): string | null => {
      // STOCK BUILD bago ang 0184: ang SKU nito ay nasa order_number pa rin.
      const on = (orderNo ?? "").trim();
      if (stockSkus.has(on)) return on;
      const lines = byOrder.get(on)?.lines ?? [];
      const withSku = lines.filter((l) => (l.sku ?? "").trim());
      if (withSku.length === 1) return (withSku[0].sku ?? "").trim() || null;
      const t = title.trim().toLowerCase();
      const hit = withSku.find((l) => String(l.description ?? "").split("\n")[0].trim().toLowerCase() === t);
      return (hit?.sku ?? "").trim() || null;
    };

    // KATEGORYA — sa produkto ito nakatira, hindi sa sheet. Ang SKU ang
    // kawing, kaya isang tanong lang para sa lahat ng hilera. Hindi ito
    // kinokopya sa design_details: kapag inayos ang kategorya sa Product
    // Management, dapat sumunod agad ang tablang ito.
    const skuByRow = new Map<number, string | null>();
    for (const r of data ?? []) {
      skuByRow.set(r.id as number, ((r as Record<string, unknown>).sku as string | null)
        ?? skuFor((r.order_number as string | null) ?? null, (r.title as string) ?? ""));
    }
    const catBySku = new Map<string, string>();
    const skus = [...new Set([...skuByRow.values()].filter(Boolean) as string[])];
    if (skus.length) {
      const { data: ps } = await db.from("product").select("sku, category").in("sku", skus);
      for (const p of ps ?? []) {
        const k = (p.sku as string | null)?.trim();
        const c = (p.category as string | null)?.trim();
        if (k && c) catBySku.set(k, c);
      }
    }

    return (data ?? []).map((r) => ({
      id: r.id as number,
      sku: skuByRow.get(r.id as number) ?? null,
      category: catBySku.get(skuByRow.get(r.id as number) ?? "") ?? null,
      stockBuild: stockSkus.has(((r.order_number as string | null) ?? "").trim())
        || stockSkus.has((((r as Record<string, unknown>).sku as string | null) ?? "").trim()),
      ddNumber: (r.dd_number as string | null) ?? null,
      orderNumber: (r.order_number as string | null) ?? null,
      customer: (r.customer_name as string) ?? "",
      // ANG ADDRESS NG ORDER ANG MAS SARIWA (inayos 2026-08-23). Nakukuha na
      // ito sa byOrder sa itaas — gaya ng contact — pero ang hilerang ito ay
      // nagbabasa pa rin ng design_details.address, na blangko sa sheet na
      // galing sa upload dialog (walang address na field doon). Kaya "—" ang
      // column kahit may address ang order.
      address: byOrder.get(((r.order_number as string | null) ?? "").trim())?.address
        ?? ((r.address as string | null) ?? null),
      title: (r.title as string) ?? "",
      bullets: (r.bullets as string[]) ?? [],
      specs: ((r as Record<string, unknown>).specs as string[] | null) ?? [],
      photoUrl: (r.photo_url as string | null) ?? null,
      photoW: Number(r.photo_w) || 0,
      photoH: Number(r.photo_h) || 0,
      labels: (r.labels as DesignLabel[]) ?? [],
      insets: ((r as Record<string, unknown>).insets as DesignInset[]) ?? [],
      swatchUrl: (r.swatch_url as string | null) ?? null,
      swatchLabel: (r.swatch_label as string | null) ?? null,
      mattress: (r.mattress as string | null) ?? null,
      headboard: (r.headboard as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      imageUrl: (r.image_url as string | null) ?? null,
      status: (r.status as string) ?? "Draft",
      createdBy: (r.created_by as string | null) ?? null,
      sentCount: Number(r.sent_count) || 0,
      createdAt: (r.created_at as string) ?? "",
      repliedAt: (r.replied_at as string | null) ?? null,
      followupCount: Number(r.followup_count) || 0,
      contact: byOrder.get(((r.order_number as string | null) ?? "").trim())?.contact ?? null,
    }));
  } catch {
    // Wala pang migration 0161 — walang listahan, pero gumagana ang builder.
    return [];
  }
}

// ── FOLLOW-UP ────────────────────────────────────────────────────────────────
// Parehong patakaran ng quotation follow-up: hanggang 3, magkaiba bawat isa, at
// HINDI nito pinahahaba ang 24h window ni Meta (hinaharang kapag sarado na).
export async function followUpDesignDetails(id: number): Promise<{ ok: true; count: number } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "design_details", "edit")) return { error: "Not allowed." };

  const db = createServerSupabase();
  const { data: d } = await db.from("design_details").select("*").eq("id", id).single();
  if (!d) return { error: "Design details not found." };
  if (d.status === "Accepted") return { error: "Already approved — no follow-up needed." };
  if (!d.replied_psid && !d.sent_count) return { error: "This design sheet has not been sent yet." };

  const count = Number((d as Record<string, unknown>).followup_count) || 0;
  if (count >= DESIGN_MAX_FOLLOWUPS) return { error: `Already followed up ${DESIGN_MAX_FOLLOWUPS} times — leave it with the customer.` };

  let psid = (d.replied_psid as string | null) ?? null;
  if (!psid) {
    const { data: c } = await db.from("fb_contacts").select("psid")
      .ilike("name", (d.customer_name as string) ?? "").order("last_message_at", { ascending: false }).limit(1).maybeSingle();
    psid = (c?.psid as string) ?? null;
  }
  if (!psid) return { error: "No Messenger contact for this customer." };

  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  const { data: fresh } = await db.from("fb_contacts").select("psid").eq("psid", psid).gte("last_message_at", since).maybeSingle();
  if (!fresh) return { error: "Outside the 24-hour window — Meta will not deliver it. Wait for the customer to message first." };

  const cfg = fbConfig();
  if (!cfg) return { error: "Facebook is not configured." };

  const firstName = ((d.customer_name as string) ?? "").split(/\s+/)[0].slice(0, 20);
  const next = count + 1;
  const ok = await sendFbMessage(cfg.pageId, cfg.token, psid, { text: designFollowupMessage(next, firstName) }, "design follow-up");
  if (!ok) return { error: "Messenger rejected the message." };

  try {
    await db.from("design_details").update({
      followup_count: next,
      last_followup_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
  } catch { /* best-effort */ }

  return { ok: true, count: next };
}

// ── UPLOAD ng litrato / swatch ───────────────────────────────────────────────
// Ang builder ang nagko-compress sa browser (canvas, max 1600px) bago ipadala
// dito bilang data URL — parehong dahilan ng website upload path (malalaki ang
// litrato ng telepono, at may body limit ang server action).
export async function uploadDesignImage(dataUrl: string): Promise<{ url: string } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "design_details", "edit")) return { error: "Not allowed." };

  const m = /^data:(image\/([a-z0-9.+-]+));base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return { error: "That file is not an image. Pick a photo or screenshot." };
  const mime = m[1].toLowerCase();
  const sub = m[2].toLowerCase();
  const EXT: Record<string, string> = { png: "png", jpeg: "jpg", jpg: "jpg", webp: "webp", gif: "gif", avif: "avif", "svg+xml": "svg" };
  const ext = EXT[sub] ?? (sub.replace(/[^a-z0-9]/g, "") || "png");
  const buf = Buffer.from(m[3], "base64");
  if (!buf.length) return { error: "That file came through empty. Try again." };
  if (buf.length > 4_000_000) return { error: `Image is ${Math.round(buf.length / 1024 / 1024)}MB — the limit is 4MB.` };

  const db = createServerSupabase();
  const path = `design/uploads/${Date.now()}-${Math.abs(buf.length % 9973)}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: false });
  if (error) return { error: error.message };
  return { url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
}


// ── IMPORT FROM EXCEL (hiling 2026-08-18) ────────────────────────────────────
// Ang team ay may Excel na Design Details template (kamukha ng system sheet).
// Ina-upload dito ang punong .xlsx at hinihimay: cells (customer, address,
// order, title, numbered details, note), mga naka-embed na LITRATO (product
// photo + fabric swatch → inaakyat sa storage), at mga TEXT BOX sa ibabaw ng
// litrato → nagiging draggable labels ng builder. Ang mga arrow shape ay hindi
// nababasa nang eksakto — idinadagdag na lang muli sa builder.
export type XlsxDesignImport = {
  customer: string;
  address: string;
  orderNo: string;
  title: string;
  bullets: string[];
  mattress: string | null;
  headboard: string | null;
  note: string | null;
  swatchLabel: string | null;
  swatchUrl: string | null;
  photoUrl: string | null;
  photoW: number;
  photoH: number;
  labels: { x: number; y: number; text: string; arrow?: "v" | "h"; len?: number }[];
};

// PNG/JPEG dimensions mula sa bytes — para tumapat ang label overlay.
function imgDims(buf: Buffer): { w: number; h: number } {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; // PNG IHDR
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {   // JPEG SOFn scan
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return { w: 0, h: 0 };
}

export async function importDesignDetailsXlsx(fd: FormData): Promise<XlsxDesignImport | { error: string }> {
  const me = await getSession();
  if (!me) return { error: "Forbidden." };
  const file = fd.get("file");
  if (!(file instanceof File)) return { error: "No file uploaded." };
  if (!/\.xlsx$/i.test(file.name)) return { error: "Upload the .xlsx (Excel Workbook) file — not CSV/PDF." };
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
    const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : "");
    const unesc = (s: string) => s
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");

    // 1) Shared strings — dito nakatago ang text values ng cells.
    const ssXml = await read("xl/sharedStrings.xml");
    const shared: string[] = [];
    for (const si of ssXml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(unesc((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<t[^>]*>|<\/t>/g, "")).join("")));
    }

    // 2) Sheet cells → addr → text, + row heights at col widths (para sa EMU math).
    const shXml = await read("xl/worksheets/sheet1.xml");
    const cells = new Map<string, string>();
    // TANGGALIN muna ang self-closing (blangkong) cells — kung hindi, ang
    // regex alternation ay lumulunok hanggang sa </c> ng SUSUNOD na cell at
    // napupunta sa maling address ang value (nahuli sa smoke test 2026-08-18).
    const cellXml = shXml.replace(/<c\b[^>]*\/>/g, "");
    for (const c of cellXml.match(/<c [^>]*>[\s\S]*?<\/c>/g) ?? []) {
      const addr = /r="([A-Z]+\d+)"/.exec(c)?.[1] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
      if (!addr || v === undefined) continue;
      const txt = /t="s"/.test(c) ? (shared[Number(v)] ?? "") : unesc(v);
      if (txt.trim()) cells.set(addr, txt.trim());
    }
    const colOf = (addr: string) => (/^([A-Z]+)/.exec(addr)?.[1] ?? "A").split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    const rowOf = (addr: string) => Number(/(\d+)$/.exec(addr)?.[1] ?? 0);
    const at = (col: number, row: number) => {
      for (const [a, t] of cells) if (rowOf(a) === row && colOf(a) === col) return t;
      return "";
    };
    const firstInRow = (row: number, fromCol: number, toCol: number) => {
      for (let c = fromCol; c <= toCol; c++) { const t = at(c, row); if (t) return t; }
      return "";
    };
    // Label cell → value sa ibaba nito (hanggang 3 rows pababa, parehong column).
    const findBelow = (label: string) => {
      for (const [a, t] of cells) {
        if (t.toUpperCase() !== label) continue;
        for (let dr = 1; dr <= 3; dr++) { const v = at(colOf(a), rowOf(a) + dr); if (v) return v; }
      }
      return "";
    };

    // 3) Numbered detail rows — mga cell na PURONG numero 1..9 sa unang columns.
    const badgeRows: number[] = [];
    for (const [a, t] of cells) {
      if (/^[1-9]$/.test(t) && colOf(a) <= 3) badgeRows.push(rowOf(a));
    }
    badgeRows.sort((x, y) => x - y);
    const bullets: string[] = [];
    for (const r of badgeRows) {
      const t = firstInRow(r, 3, 9);
      if (t) bullets.push(t);
    }

    // 4) Customer / Address / Order / Title.
    const customer = findBelow("CUSTOMER");
    const address = findBelow("ADDRESS");
    const orderNo = findBelow("ORDER");
    // Title = non-empty text sa pagitan ng address at unang badge row.
    let title = "";
    const addrRow = [...cells.entries()].find(([, t]) => t.toUpperCase() === "ADDRESS");
    const titleFrom = addrRow ? rowOf(addrRow[0]) + 2 : 12;
    const titleTo = (badgeRows[0] ?? 16) - 1;
    for (let r = titleTo; r >= titleFrom; r--) {
      const t = firstInRow(r, 2, 9);
      if (t && !/^(CUSTOMER|ADDRESS|DATE|PREPARED BY|ORDER|FOR APPROVAL|APPROVED)$/i.test(t) && t !== address) { title = t; break; }
    }

    // 5) Swatch label — text sa kanang bahagi ng details region, hindi placeholder.
    let swatchLabel = "";
    if (badgeRows.length) {
      const lo = badgeRows[0], hi = badgeRows[badgeRows.length - 1] + 2;
      for (const [a, t] of cells) {
        const r = rowOf(a), c = colOf(a);
        if (r >= lo && r <= hi && c >= 9 && !/paste/i.test(t)) swatchLabel = t;
      }
    }

    // 6) Note region — hanapin ang "Mattress thickness" / headboard / talata.
    let mattress: string | null = null, headboard: string | null = null, note: string | null = null;
    for (const [, t] of cells) {
      const m1 = /mattress thickness:\s*(.+)/i.exec(t);
      if (m1) mattress = m1[1].trim();
      const m2 = /height of headboard:\s*(.+)/i.exec(t);
      if (m2) headboard = m2[1].trim();
      if (t.length > 80 && /lift storage|approval/i.test(t)) note = t;
    }

    // 7) Geometry ng sheet (EMU) para sa image/label positions.
    const defW = 8.43, defHt = 15;
    const colW: Record<number, number> = {};
    for (const c of shXml.match(/<col [^>]*\/>/g) ?? []) {
      const min = Number(/min="(\d+)"/.exec(c)?.[1] ?? 0), max = Number(/max="(\d+)"/.exec(c)?.[1] ?? 0);
      const w = Number(/width="([\d.]+)"/.exec(c)?.[1] ?? defW);
      for (let i = min; i <= max && i <= 60; i++) colW[i] = w;
    }
    const rowH: Record<number, number> = {};
    for (const rm of shXml.match(/<row [^>]*>/g) ?? []) {
      const r = Number(/r="(\d+)"/.exec(rm)?.[1] ?? 0);
      const ht = /ht="([\d.]+)"/.exec(rm)?.[1];
      if (r && ht) rowH[r] = Number(ht);
    }
    const colEmu = (idx0: number) => { // EMU bago ang 0-based col na ito
      let e = 0;
      for (let i = 1; i <= idx0; i++) e += Math.round(((colW[i] ?? defW) * 7 + 5)) * 9525;
      return e;
    };
    const rowEmu = (idx0: number) => {
      let e = 0;
      for (let i = 1; i <= idx0; i++) e += Math.round((rowH[i] ?? defHt) * 12700);
      return e;
    };

    // 8) Drawings — mga litrato (pic) at text boxes (sp) na may anchor.
    const drXml = await read("xl/drawings/drawing1.xml");
    const relXml = await read("xl/drawings/_rels/drawing1.xml.rels");
    const rels = new Map<string, string>();
    for (const r of relXml.match(/<Relationship [^>]*\/>/g) ?? []) {
      const id = /Id="([^"]+)"/.exec(r)?.[1] ?? "";
      const tg = /Target="([^"]+)"/.exec(r)?.[1] ?? "";
      rels.set(id, tg.replace(/^\.\.\//, "xl/"));
    }
    type Anchor = { x0: number; y0: number; x1: number; y1: number };
    const anchorOf = (block: string): Anchor | null => {
      const g = (tag: string, part: string) => Number(new RegExp("<xdr:" + tag + ">[\\s\\S]*?<xdr:" + part + ">(\\d+)</xdr:" + part + ">").exec(block)?.[1] ?? NaN);
      const fc = g("from", "col"), fco = g("from", "colOff"), fr = g("from", "row"), fro = g("from", "rowOff");
      const tc = g("to", "col"), tco = g("to", "colOff"), tr = g("to", "row"), tro = g("to", "rowOff");
      if ([fc, fr].some(Number.isNaN)) return null;
      const x0 = colEmu(fc) + (fco || 0), y0 = rowEmu(fr) + (fro || 0);
      const x1 = Number.isNaN(tc) ? x0 : colEmu(tc) + (tco || 0);
      const y1 = Number.isNaN(tr) ? y0 : rowEmu(tr) + (tro || 0);
      return { x0, y0, x1, y1 };
    };
    // srcRect = CROP na ginawa sa Excel mismo (1/100000 fractions kada gilid).
    // Ang media file ay laging ang BUONG orihinal — kailangang hiwain para
    // makuha ang aktwal na ipinakita (nahuli 2026-08-18: collage ang lumabas
    // sa halip na ang isang kama, at buong kwarto sa halip na swatch oval).
    type SrcRect = { l: number; t: number; r: number; b: number } | null;
    const pics: { a: Anchor; media: string; rect: SrcRect }[] = [];
    const boxes: { a: Anchor; text: string }[] = [];
    // ARROWS (2026-08-18): ang mga Straight Arrow Connector ng Excel — ikinakabit
    // sa pinakamalapit na label bilang dilaw na sukat-arrow ng renderer.
    const conns: { a: Anchor }[] = [];
    for (const blk of drXml.match(/<xdr:(?:twoCellAnchor|oneCellAnchor)[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g) ?? []) {
      const a = anchorOf(blk);
      if (!a) continue;
      const embed = /r:embed="([^"]+)"/.exec(blk)?.[1];
      if (embed && /<xdr:pic>/.test(blk)) {
        const media = rels.get(embed);
        const sr = /<a:srcRect([^>]*)\/>/.exec(blk)?.[1] ?? "";
        const num = (k: string) => Number(new RegExp(`${k}="(\\d+)"`).exec(sr)?.[1] ?? 0);
        const rect: SrcRect = sr ? { l: num("l"), t: num("t"), r: num("r"), b: num("b") } : null;
        if (media) pics.push({ a, media, rect });
        continue;
      }
      if (/<xdr:sp[ >]/.test(blk)) {
        const text = unesc(((blk.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? []).map((t) => t.replace(/<a:t>|<\/a:t>/g, "")).join(" ")).trim());
        if (text) boxes.push({ a, text });
        continue;
      }
      // Ang tag ay may attributes (`<xdr:cxnSp macro="">`) — huwag eksaktong ">".
      if (/<xdr:cxnSp[\s>]/.test(blk)) conns.push({ a });
    }
    if (!pics.length) return { error: "No images found in the file — paste the product photo into the template first." };

    // Pinakamalaki = product photo; ang susunod na pinakamalaki = swatch.
    const area = (p: { a: Anchor }) => Math.abs((p.a.x1 - p.a.x0) * (p.a.y1 - p.a.y0));
    pics.sort((p, q) => area(q) - area(p));
    const photoPic = pics[0];
    const swatchPic = pics[1] ?? null;

    // 9) I-upload ang mga litrato sa storage — HINIHIWA muna ayon sa Excel crop.
    const db = createServerSupabase();
    const up = async (media: string, tag: string, rect: SrcRect) => {
      const f = zip.file(media);
      if (!f) return { url: null as string | null, dims: { w: 0, h: 0 } };
      let buf = Buffer.from(await f.async("uint8array"));
      let ext = media.split(".").pop()?.toLowerCase() ?? "png";
      if (rect && (rect.l || rect.t || rect.r || rect.b)) {
        try {
          const sharp = (await import("sharp")).default;
          const meta = await sharp(buf).metadata();
          const W = meta.width ?? 0, H = meta.height ?? 0;
          if (W && H) {
            const left = Math.round((W * rect.l) / 100000);
            const top = Math.round((H * rect.t) / 100000);
            const width = Math.max(1, W - left - Math.round((W * rect.r) / 100000));
            const height = Math.max(1, H - top - Math.round((H * rect.b) / 100000));
            buf = Buffer.from(await sharp(buf).extract({ left, top, width, height }).png().toBuffer());
            ext = "png";
          }
        } catch { /* walang sharp o pumalya ang crop — gamitin ang buo */ }
      }
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/" + ext;
      const path = "design/imports/" + Date.now() + "-" + tag + "." + ext;
      const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: false });
      if (error) return { url: null, dims: { w: 0, h: 0 } };
      return { url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, dims: imgDims(buf) };
    };
    const photo = await up(photoPic.media, "photo", photoPic.rect);
    const swatch = swatchPic ? await up(swatchPic.media, "swatch", swatchPic.rect) : { url: null, dims: { w: 0, h: 0 } };

    // 10) Text boxes sa loob ng photo anchor → builder labels (0..1 na gitna).
    const pa = photoPic.a;
    const pw = Math.max(1, pa.x1 - pa.x0), ph = Math.max(1, pa.y1 - pa.y0);
    const labels: { x: number; y: number; text: string; arrow?: "v" | "h"; len?: number }[] = boxes
      .map((b) => ({ cx: (b.a.x0 + b.a.x1) / 2, cy: (b.a.y0 + b.a.y1) / 2, text: b.text }))
      .filter((b) => b.cx > pa.x0 - pw * 0.05 && b.cx < pa.x1 + pw * 0.05 && b.cy > pa.y0 - ph * 0.05 && b.cy < pa.y1 + ph * 0.05)
      .map((b) => ({
        x: Math.min(0.98, Math.max(0.02, (b.cx - pa.x0) / pw)),
        y: Math.min(0.98, Math.max(0.02, (b.cy - pa.y0) / ph)),
        text: b.text,
      }));
    // ARROWS → ikabit sa pinakamalapit na label: malinaw na patayo/pahiga lang
    // (ang mga diagonal ay hindi suportado ng renderer — laktawan).
    for (const cn of conns) {
      const cx = (cn.a.x0 + cn.a.x1) / 2, cy = (cn.a.y0 + cn.a.y1) / 2;
      if (cx < pa.x0 - pw * 0.05 || cx > pa.x1 + pw * 0.05 || cy < pa.y0 - ph * 0.05 || cy > pa.y1 + ph * 0.05) continue;
      const dx = Math.abs(cn.a.x1 - cn.a.x0), dy = Math.abs(cn.a.y1 - cn.a.y0);
      let dir: "v" | "h" | null = null;
      if (dy > dx * 2) dir = "v";
      else if (dx > dy * 2) dir = "h";
      if (!dir) continue;
      const nx = (cx - pa.x0) / pw, ny = (cy - pa.y0) / ph;
      let best = -1, bestD = Infinity;
      labels.forEach((l, i) => {
        if (l.arrow) return;
        const d = (l.x - nx) ** 2 + (l.y - ny) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      });
      // Sa loob lang ng makatwirang layo (~25% ng litrato) ikakabit.
      if (best >= 0 && bestD < 0.25 ** 2) {
        labels[best].arrow = dir;
        labels[best].len = Math.min(0.9, Math.max(0.08, dir === "v" ? dy / ph : dx / pw));
      }
    }

    return {
      customer, address, orderNo, title, bullets,
      mattress, headboard, note,
      swatchLabel: swatchLabel || null, swatchUrl: swatch.url,
      photoUrl: photo.url, photoW: photo.dims.w, photoH: photo.dims.h,
      labels,
    };
  } catch (e) {
    return { error: "Could not read the Excel file: " + (e instanceof Error ? e.message : String(e)) };
  }
}


// ── ORDER PICKER ng Upload sheet (hiling 2026-08-19) ─────────────────────────
// Search ng order number → auto-fill ang customer at lalabas ang mga produkto
// ng order para doon mismo i-attach ang sheet.
// Ang BUONG laman ng order — ang `description` ng bawat linya ay maramihang
// talata (pamagat + bullets ng specs), kapareho ng nasa quotation at resibo.
// Ang unang linya ang pangalan ng produkto; ang natitira ang mga specs.
export type SheetOrderItem = { name: string; specs: string[]; qty: number; image: string | null; sku: string | null };
export type SheetOrderPick = {
  id: number;
  order_number: string;
  customer: string;
  address: string | null;
  contact: string | null;
  orderedAt: string | null;
  // Sanggunian pabalik sa website request, kapag doon nanggaling ang order.
  mtoNumber: string | null;
  fqNumber: string | null;
  items: SheetOrderItem[];
  // STOCK BUILD (0182): ipinagawa nang walang order, para lang magkastock.
  // Kailangan pa rin ng design sheet — ang workshop ang bumubuo nito.
  stockBuild?: boolean;
  workshop?: string | null;
};
export async function listOrdersForDesignSheet(): Promise<SheetOrderPick[]> {
  const me = await getSession();
  if (!me || !hasPermission(me, "design_details", "edit")) return [];
  const db = createServerSupabase();
  const { data, error } = await db
    .from("orders")
    .select("id, order_number, customer_name, address, contact_number, receipt_items, status, date_order")
    .order("id", { ascending: false })
    .limit(400);
  // Ang isang maling pangalan ng column ay nagpapabagsak sa BUONG query at
  // nagbabalik ng walang laman — walang order na lalabas sa picker, at walang
  // babala. Ipaalam ito imbes na tahimik na ipakita ang blangko.
  if (error) console.error("[design-sheet] orders query failed:", error.message);

  // NAIHATID NA = wala nang design sheet na ipapadala. Hindi maaasahan ang
  // orders.status para dito — madalas itong naiiwan sa "For Delivery" kahit
  // tapos na ang pipeline (tingnan ang progressStatus sa orders-table), kaya
  // ang deliveries/installations ang tinatanong, gaya ng Sales Orders.
  const ids = (data ?? []).map((r) => r.id as number);
  const delivered = new Set<number>();
  if (ids.length) {
    const [{ data: del }, { data: inst }] = await Promise.all([
      db.from("deliveries").select("order_id, status").in("order_id", ids),
      db.from("installations").select("order_id, status").in("order_id", ids),
    ]);
    for (const d of (del ?? []) as { order_id: number | null; status: string | null }[]) {
      if (d.order_id != null && /delivered/i.test(d.status ?? "")) delivered.add(d.order_id);
    }
    for (const i of (inst ?? []) as { order_id: number | null; status: string | null }[]) {
      if (i.order_id != null && /completed/i.test(i.status ?? "")) delivered.add(i.order_id);
    }
  }

  // Sanggunian pabalik sa website request. Ang quotation ang may hawak ng
  // order number, at ang MTO request ang may hawak ng FQ — dalawang hakbang
  // pabalik para makuha ang MTO # ng isang order.
  const refByOrder = new Map<string, { mto: string | null; fq: string | null }>();
  try {
    const nums = (data ?? []).map((r) => r.order_number as string | null).filter(Boolean) as string[];
    if (nums.length) {
      const { data: qs } = await db.from("quotations").select("fq_number, order_number").in("order_number", nums);
      const fqs = (qs ?? []).map((q) => q.fq_number as string | null).filter(Boolean) as string[];
      const mtoByFq = new Map<string, string | null>();
      if (fqs.length) {
        const { data: ms } = await db.from("mto_requests").select("fq_number, mto_number").in("fq_number", fqs);
        for (const m of ms ?? []) mtoByFq.set(m.fq_number as string, (m.mto_number as string | null) ?? null);
      }
      for (const q of qs ?? []) {
        const fq = (q.fq_number as string | null) ?? null;
        refByOrder.set(q.order_number as string, { mto: fq ? mtoByFq.get(fq) ?? null : null, fq });
      }
    }
  } catch { /* walang kawing — walang chips na ipapakita */ }

  // Ang mga fee line ay walang design sheet.
  const isFee = (s: string) => /^(addtl\.?\s*)?(additional\s*)?(shipping|rush|delivery)(\s*(and|&)\s*installation)?(\s*fee)?$/i.test(s);

  // STOCK BUILD — walang order, kaya hindi ito nasa `orders`. Ang job mismo ang
  // pinagmumulan: ang SKU ang gagamiting "order number" sa sheet, at ang
  // pangalan ng workshop ang nasa lugar ng customer.
  const stockRows: SheetOrderPick[] = [];
  try {
    const { data: jobs } = await db
      .from("workshop_job")
      .select("id, item_desc, qty, stock_request, stock_sku, workshop_id, dispatched_at")
      .eq("stock_request", true)
      .order("id", { ascending: false })
      .limit(200);
    const wsIds = [...new Set((jobs ?? []).map((j) => j.workshop_id as number | null).filter((x): x is number => x != null))];
    const wsName = new Map<number, string>();
    if (wsIds.length) {
      const { data: ws } = await db.from("workshop").select("id, name").in("id", wsIds);
      for (const w of ws ?? []) wsName.set(w.id as number, (w.name as string | null) ?? "");
    }
    for (const j of jobs ?? []) {
      const lines = String(j.item_desc ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
      const shop = j.workshop_id != null ? wsName.get(j.workshop_id as number) ?? "" : "";
      stockRows.push({
        id: -(j.id as number),                        // negatibo: hindi ito orders.id
        order_number: String(j.stock_sku ?? `JOB-${j.id}`),
        customer: shop || "Stock build",
        address: null,
        contact: null,
        orderedAt: (j.dispatched_at as string | null) ?? null,
        mtoNumber: null,
        fqNumber: null,
        stockBuild: true,
        workshop: shop || null,
        items: [{
          name: lines[0] ?? "",
          sku: (j.stock_sku as string | null) ?? null,
          specs: lines.slice(1).map((x) => x.replace(/^[•·\-]\s*/, "")).filter(Boolean),
          qty: Number(j.qty) || 1,
          image: null,
        }].filter((it) => it.name),
      });
    }
  } catch { /* walang stock build — ang mga order lang ang lalabas */ }

  return stockRows.concat((data ?? [])
    .filter((r) => (r.order_number as string | null)?.trim())
    .filter((r) => !delivered.has(r.id as number))
    // Ang kanselado ay wala nang pupuntahan.
    .filter((r) => !/cancel/i.test(String(r.status ?? "")))
    .map((r) => {
      const ref = refByOrder.get(String(r.order_number)) ?? { mto: null, fq: null };
      const items = (((r.receipt_items as { description?: string | null; qty?: number; image?: string | null; sku?: string | null }[] | null) ?? [])
        .map((it) => {
          // Ang description ay maramihang talata: pangalan sa unang linya, ang
          // mga specs sa sumunod (kapareho ng quotation at resibo).
          const lines = String(it.description ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
          return {
            name: lines[0] ?? "",
            sku: (it.sku as string | null) ?? null,
            // Tinatanggal ang panimulang bullet — ang UI ang naglalagay ng sarili.
            specs: lines.slice(1).map((x) => x.replace(/^[•·\-]\s*/, "")).filter(Boolean),
            qty: Number(it.qty) || 1,
            image: (it.image as string | null) ?? null,
          };
        })
        .filter((it) => it.name && !isFee(it.name)));
      return {
        id: r.id as number,
        order_number: String(r.order_number),
        customer: String(r.customer_name ?? ""),
        address: (r.address as string | null) ?? null,
        contact: (r.contact_number as string | null) ?? null,
        orderedAt: (r.date_order as string | null) ?? null,
        mtoNumber: ref.mto,
        fqNumber: ref.fq,
        items,
      };
    }));
}

// ── UPLOAD NG TAPOS NANG SHEET (hiling 2026-08-18) ──────────────────────────
// May team na sa Excel gumagawa ng buong Design Details at ie-export na lang
// bilang PNG — dito, ang in-upload na IMAGE na mismo ang sheet: walang editor,
// walang re-render; may DD number, lalabas sa table, at maipapadala sa
// Messenger gamit ang parehong approve flow.
// Ang mga specs at karagdagang detalye na galing sa upload dialog. Ang `specs`
// ay HINDI `bullets` — ang blangkong bullets ang tanda na uploaded-image ang DD
// (hindi ito muling nire-render), kaya sariling column ito. Migration 0172.
function sheetExtras(fd: FormData) {
  let specs: string[] = [];
  try {
    const raw = JSON.parse(String(fd.get("specs") ?? "[]"));
    if (Array.isArray(raw)) specs = raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  } catch { /* walang specs */ }
  return {
    specs,
    // Aling produkto ang binuo ng sheet (0183) — sariling hanay sa table.
    sku: String(fd.get("sku") ?? "").trim() || null,
    mattress: String(fd.get("mattress") ?? "").trim() || null,
    headboard: String(fd.get("headboard") ?? "").trim() || null,
    note: String(fd.get("note") ?? "").trim() || null,
  };
}

export async function createDesignDetailsFromImage(fd: FormData): Promise<DesignDetailsResult | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "design_details", "edit")) return { error: "Not allowed." };

  const file = fd.get("file");
  if (!(file instanceof File)) return { error: "Attach the sheet (PDF or PNG)." };
  // PDF o PNG na lang (bagong scenario 2026-08-19); tinatanggap pa rin ang
  // JPG/WebP na luma para hindi masira ang dating gawi.
  if (!/^(application\/pdf|image\/(png|jpe?g|webp))$/i.test(file.type)) return { error: "PDF or PNG only." };
  const customerName = String(fd.get("customer") ?? "").trim();
  if (!customerName) return { error: "Customer name is required." };
  const orderNumber = String(fd.get("orderNo") ?? "").trim() || null;
  const title = String(fd.get("title") ?? "").trim() || "UPLOADED DESIGN SHEET";
  let psids: string[] = [];
  try { psids = JSON.parse(String(fd.get("psids") ?? "[]")); } catch { /* walang padadalhan */ }
  // MULTI-FILE upload (2026-08-19): sa mga sumunod na file ng iisang batch,
  // blurb=0 para hindi paulit-ulit ang intro text sa Messenger.
  const withBlurb = String(fd.get("blurb") ?? "1") !== "0";
  const extras = sheetExtras(fd);

  const db = createServerSupabase();

  // WALANG dedupe/overwrite (binago 2026-08-19): pwedeng MARAMING sheets sa
  // iisang order+produkto — laging bagong DD; naka-grupo naman sila sa isang
  // row kada order at may Delete/Edit na pang-ayos ng pagkakamali.
  const ddNumber: string | null = await nextDocNumber(db, "design_details", "dd_number", "DD", "next_design_number");

  const buf = Buffer.from(await file.arrayBuffer());
  const isPdf = /pdf$/i.test(file.type);
  const ext = isPdf ? "pdf" : /png$/i.test(file.type) ? "png" : /webp$/i.test(file.type) ? "webp" : "jpg";
  const slug = customerName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "customer";
  const path = `design/${slug}/${Date.now()}-uploaded.${ext}`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, buf, { contentType: file.type, upsert: false });
  if (upErr) return { error: `Could not save the sheet: ${upErr.message}` };
  const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  let designId: number | null = null;
  try {
    const { data: row } = await db.from("design_details").insert({
      dd_number: ddNumber,
      order_number: orderNumber,
      sku: extras.sku,
      customer_name: customerName,
      address: null,
      title,
      // BLANGKO ang bullets/photo — ito ang tanda na UPLOADED-IMAGE na DD:
      // hindi ito muling nire-render sa approval (mananatili ang image nila).
      bullets: [],
      photo_url: null,
      swatch_url: null,
      swatch_label: null,
      labels: [],
      // Ang laman ng order na naitala kasama ng sheet (0172) — nananatiling
      // BLANGKO ang bullets: iyon ang tanda na uploaded-image ito.
      specs: extras.specs,
      mattress: extras.mattress,
      headboard: extras.headboard,
      note: extras.note,
      image_url: url,
      // APPROVED AGAD ANG IN-UPLOAD NA SHEET (hiling 2026-08-23).
      //
      // Ang "Accepted" ay dating sagot LANG ng customer sa Messenger — iyon ang
      // hudyat na pwede nang simulan ang produksyon. Hindi na iyon naaabot ng
      // daang ito: tinanggal ang Send to Messenger sa upload dialog (2026-08-19),
      // kaya ang na-upload na sheet ay habambuhay nang Draft — walang
      // magtatanong sa customer, kaya walang magpapalit.
      //
      // At tama lang: ang in-upload na sheet ay TAPOS NA at kasundo na — ginawa
      // ito sa labas (Excel/PDF) at ipinakita na sa customer bago pa na-upload.
      // Ang pagpindot sa Messenger ay para sa sheet na binuo RITO at ipinadala
      // mula rito (createDesignDetails), na Draft pa rin.
      status: "Accepted",
      created_by: me.full_name?.trim() || me.email || null,
    }).select("id").single();
    designId = (row?.id as number) ?? null;
  } catch { /* wala pang table — nasa storage pa rin ang sheet */ }

  // Padala — parehong anyo ng normal na DD send (blurb → larawan → buttons).
  let sent = 0, failed = 0, skipped = 0;
  const unique = [...new Set(psids.filter(Boolean))];
  if (unique.length) {
    if (unique.length > MAX_RECIPIENTS) return { error: `Too many at once — pick ${MAX_RECIPIENTS} or fewer.` };
    const cfg = fbConfig();
    if (!cfg) return { error: "Facebook is not configured." };
    const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
    const { data: fresh } = await db.from("fb_contacts").select("psid").in("psid", unique).gte("last_message_at", since);
    const allowed = new Set((fresh ?? []).map((r) => r.psid as string));
    skipped = unique.length - allowed.size;
    const firstName = customerName.split(/\s+/)[0].slice(0, 20);
    const blurb = [
      `Hi ${firstName}!`,
      "Here are your design details.",
      "",
      "Please review the size, fabric,",
      "and measurements below. We",
      "start production once you",
      "approve the design:",
    ].join("\n");
    for (const psid of unique) {
      if (!allowed.has(psid)) continue;
      if (withBlurb) await sendFbMessage(cfg.pageId, cfg.token, psid, { text: blurb }, "design blurb");
      const ok = await sendFbMessage(
        cfg.pageId, cfg.token, psid,
        { attachment: { type: isPdf ? "file" : "image", payload: { url, is_reusable: true } } },
        "design image",
      );
      if (ok && designId) {
        await sendFbMessage(
          cfg.pageId, cfg.token, psid,
          {
            attachment: {
              type: "template",
              payload: {
                template_type: "button",
                text: "Would you like to approve this design?",
                buttons: [
                  { type: "postback", title: "Approve design", payload: `DD_ACCEPT:${designId}` },
                  { type: "postback", title: "I have questions", payload: `DD_QUESTION:${designId}` },
                ],
              },
            },
          },
          "design buttons",
        );
      }
      if (ok) sent++;
      else failed++;
    }
  }

  if (designId && sent > 0) {
    try {
      await db.from("design_details").update({
        status: "Sent",
        sent_count: sent,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", designId);
    } catch { /* best-effort */ }
  }

  return { id: designId, ddNumber, url, sent, failed, skipped };
}

// ── DELETE (hiling 2026-08-19): pambura ng maling upload. ───────────────────
export async function deleteDesignDetails(id: number): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "design_details", "edit")) return { error: "Not allowed." };
  const db = createServerSupabase();
  const { error } = await db.from("design_details").delete().eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

// ── EDIT ng UPLOADED SHEET (hiling 2026-08-19) ───────────────────────────────
// Ang Edit ng uploaded-sheet DD ay PAREHONG upload dialog (hindi ang builder):
// palitan ang PDF/PNG (opsyonal — mananatili ang luma kung walang bago),
// order/customer/title, at pwedeng i-resend sa Messenger.
export async function updateDesignDetailsSheet(fd: FormData): Promise<DesignDetailsResult | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "design_details", "edit")) return { error: "Not allowed." };
  const ddId = Number(fd.get("ddId"));
  if (!ddId) return { error: "Missing design id." };

  const customerName = String(fd.get("customer") ?? "").trim();
  if (!customerName) return { error: "Customer name is required." };
  const orderNumber = String(fd.get("orderNo") ?? "").trim() || null;
  const title = String(fd.get("title") ?? "").trim() || "UPLOADED DESIGN SHEET";
  let psids: string[] = [];
  try { psids = JSON.parse(String(fd.get("psids") ?? "[]")); } catch { /* walang padadalhan */ }

  const extras = sheetExtras(fd);

  const db = createServerSupabase();
  const { data: cur } = await db.from("design_details").select("id, dd_number, image_url").eq("id", ddId).maybeSingle();
  if (!cur) return { error: "Design not found." };

  // Bagong file? I-upload at palitan ang sheet; kung wala, ang dating URL.
  let url = String(cur.image_url ?? "");
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (!/^(application\/pdf|image\/(png|jpe?g|webp))$/i.test(file.type)) return { error: "PDF or PNG only." };
    const buf = Buffer.from(await file.arrayBuffer());
    const ext = /pdf$/i.test(file.type) ? "pdf" : /png$/i.test(file.type) ? "png" : /webp$/i.test(file.type) ? "webp" : "jpg";
    const slug = customerName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "customer";
    const path = `design/${slug}/${Date.now()}-uploaded.${ext}`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, buf, { contentType: file.type, upsert: false });
    if (upErr) return { error: `Could not save the sheet: ${upErr.message}` };
    url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
  if (!url) return { error: "Attach the sheet — PDF or PNG." };
  const isPdf = /\.pdf($|\?)/i.test(url);

  try {
    await db.from("design_details").update({
      customer_name: customerName,
      order_number: orderNumber,
      sku: extras.sku,
      title,
      specs: extras.specs,
      // WALA NANG Mattress/Headboard na field ang upload dialog (2026-08-23) —
      // nasa Design specs na ang buong build. HINDI ito isinusulat dito: ang
      // lumang sheet na may laman sa dalawang column ay mabubura kung isusulat
      // ang blangkong ipinapadala ngayon ng dialog.
      // Wala na ring Note na field ang dialog (2026-08-23) — hindi rin ito
      // isinusulat dito, sa parehong dahilan ng Mattress/Headboard sa itaas:
      // mabubura ang note ng lumang sheet sa bawat pag-edit.
      image_url: url,
      updated_at: new Date().toISOString(),
    }).eq("id", ddId);
  } catch { /* best-effort */ }

  // Resend — parehong anyo ng create (blurb → sheet → approve buttons).
  let sent = 0, failed = 0, skipped = 0;
  const unique = [...new Set(psids.filter(Boolean))];
  if (unique.length) {
    if (unique.length > MAX_RECIPIENTS) return { error: `Too many at once — pick ${MAX_RECIPIENTS} or fewer.` };
    const cfg = fbConfig();
    if (!cfg) return { error: "Facebook is not configured." };
    const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
    const { data: fresh } = await db.from("fb_contacts").select("psid").in("psid", unique).gte("last_message_at", since);
    const allowed = new Set((fresh ?? []).map((r) => r.psid as string));
    skipped = unique.length - allowed.size;
    const firstName = customerName.split(/\s+/)[0].slice(0, 20);
    const blurb = [
      `Hi ${firstName}!`,
      "Here are your design details.",
      "",
      "Please review the size, fabric,",
      "and measurements below. We",
      "start production once you",
      "approve the design:",
    ].join("\n");
    for (const psid of unique) {
      if (!allowed.has(psid)) continue;
      await sendFbMessage(cfg.pageId, cfg.token, psid, { text: blurb }, "design blurb");
      const ok = await sendFbMessage(
        cfg.pageId, cfg.token, psid,
        { attachment: { type: isPdf ? "file" : "image", payload: { url, is_reusable: true } } },
        "design image",
      );
      if (ok) {
        await sendFbMessage(
          cfg.pageId, cfg.token, psid,
          {
            attachment: {
              type: "template",
              payload: {
                template_type: "button",
                text: "Would you like to approve this design?",
                buttons: [
                  { type: "postback", title: "Approve design", payload: `DD_ACCEPT:${ddId}` },
                  { type: "postback", title: "I have questions", payload: `DD_QUESTION:${ddId}` },
                ],
              },
            },
          },
          "design buttons",
        );
        sent++;
      } else failed++;
    }
    if (sent > 0) {
      try {
        await db.from("design_details").update({
          status: "Sent",
          sent_count: sent,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", ddId);
      } catch { /* best-effort */ }
    }
  }

  return { id: ddId, ddNumber: (cur.dd_number as string | null) ?? null, url, sent, failed, skipped };
}

// ── XLSX → DIRETSONG SHEET (hiling 2026-08-18) ──────────────────────────────
// Isang upload ng punong Excel template → hinihimay (parehong parser ng
// Import from Excel) → agad nire-render at sine-save bilang sheet image na may
// DD number — WALANG editor. Ang labas ay ang system render ng laman (kasama
// ang labels, arrows, swatch, watermark), hindi screenshot ng Excel.
export async function createDesignDetailsFromXlsx(fd: FormData): Promise<DesignDetailsResult | { error: string }> {
  const parsed = await importDesignDetailsXlsx(fd);
  if ("error" in parsed) return parsed;
  let psids: string[] = [];
  try { psids = JSON.parse(String(fd.get("psids") ?? "[]")); } catch { /* walang padadalhan */ }
  // Pwedeng patungan ng tinype ang galing sa file (hal. blangko ang customer).
  const customer = String(fd.get("customer") ?? "").trim() || parsed.customer;
  const orderNo = String(fd.get("orderNo") ?? "").trim() || parsed.orderNo;
  const title = String(fd.get("title") ?? "").trim() || parsed.title;
  if (!customer) return { error: "No customer name in the file — type it in the Customer field." };
  if (!title) return { error: "No design title in the file — type it in the Title field." };
  return createDesignDetails({
    customerName: customer,
    address: parsed.address || null,
    orderNumber: orderNo || null,
    title,
    bullets: parsed.bullets,
    photoUrl: parsed.photoUrl,
    photoW: parsed.photoW || undefined,
    photoH: parsed.photoH || undefined,
    labels: parsed.labels.map((l) => ({ x: l.x, y: l.y, text: l.text, arrow: l.arrow ?? null, len: l.len })),
    insets: [],
    swatchUrl: parsed.swatchUrl,
    swatchLabel: parsed.swatchLabel,
    mattress: parsed.mattress,
    headboard: parsed.headboard,
    note: parsed.note,
    psids,
  });
}
