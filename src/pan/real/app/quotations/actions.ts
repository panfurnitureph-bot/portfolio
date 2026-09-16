"use server";

import { revalidatePath } from "next/cache";
import { nextDocNumber } from "@/lib/next-number";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { fbConfig } from "@/lib/fb/contacts";
import { sendFbMessage } from "@/lib/fb/notify";
import { renderQuotationSvg, renderQuotationSvgPages, quoteTotals, QUOTE_STATUSES, MAX_FOLLOWUPS, followupMessage, type QuoteInput, type QuoteItem, type QuoteStatus } from "@/lib/quotation";
import { panLogoDataUri, loadQuoteAssets, QUOTE_ASSET_PATHS } from "@/lib/quotation-assets";
import { auditAfter } from "@/lib/audit";

// FORMAL QUOTATION — gumagawa ng larawan, iniimbak, at (opsyonal) ipinapadala sa
// Messenger thread ng napiling FB contact.
//
// Ang bucket ay product-images: PUBLIC ito, at kailangan yun — hinahatak ni Meta
// ang URL sa server nila, kaya ang pribadong bucket ay nagbibigay ng
// "Upload attachment failure" (nasukat 2026-08-08).
const BUCKET = "product-images";

// 24-ORAS NA BINTANA — pareho ng Follow up on Messenger. Ang Meta ay pumapayag
// lang mag-message sa taong nag-message sa loob ng huling 24 oras; ang HUMAN_AGENT
// (7 araw) ay nasa sendFbMessage na pero kailangan ng App Review.
const WINDOW_HOURS = 24;
// Ceiling kada padala — panangga sa aksidenteng blast at sa Vercel timeout.
const MAX_RECIPIENTS = 50;

// Cache ng na-embed na item images (tingnan ang paliwanag sa embedImage).
const QUOTE_IMG_TTL_MS = 5 * 60_000;
const quoteImgCache = new Map<string, { at: number; data: string | null }>();

export type QuotationInput = {
  customerName: string;
  address?: string | null;
  items: QuoteItem[];
  deliveryFee?: number;
  // Mga PSID ng napiling customer — parehong maramihan ng follow-up. Isang
  // quotation ang ginagawa, tapos ipinapadala sa lahat ng napili.
  psids?: string[];
  // Itago ang bank QR cards. Kapag may QR sa larawan, dinadagdagan ito ng
  // Messenger ng sariling "QR transfer" widget — may kopya pa ng quotation at
  // Maya/MariBank buttons. Nasa document pa rin ang account numbers.
  hideQr?: boolean;
  // REVISION (2026-08-21): kapag may laman, PINAPALITAN ang laman ng dati nang
  // quotation na ito sa halip na kumuha ng bagong FQ number. Ginagamit ito ng
  // MTO Requests: paulit-ulit na binabago ang build bago mapagkasunduan, at
  // bawat pindot ng Create Quotation dati ay nagdadagdag ng bagong row —
  // nadodoble ang listahan sa Formal Quotation Builder. Isang FQ number bawat
  // request; ang bagong dokumento ang nasa Messenger at nasa record.
  reviseFq?: string | null;
};

export type QuotationResult = {
  id: number | null;          // row sa `quotations` (null kung wala pa ang 0158)
  fqNumber: string | null;    // FQ-000123
  url: string;
  total: number;
  downpayment: number;
  sent: number;           // ilan ang nakatanggap
  pdfError?: string | null; // dahilan kung bakit walang QR PDF (para sa UI)
  failed: number;         // tinanggihan ni Meta
  skipped: number;        // labas na sa 24h window nang i-verify sa server
};

// Ibinubuo ang quotation SVG — IISANG daanan ng create at ng preview, para ang
// nakikita sa preview ang eksaktong maipapadala (parehong pattern ng Design
// Details renderFromInput).
// Ang larawan ng produkto ay dapat DATA URI: hinahatak ni Meta ang SVG sa
// server nila at hindi maaasahan doon ang panlabas na <image href>. Best-effort
// kada item — kapag hindi makuha, blangko ang Item cell (hindi nasisira ang
// quotation). Dinededuplika para hindi ma-download nang dalawang beses ang
// parehong larawan, at nililimitahan ang laki. Module-level dahil parehong
// ginagamit ng SVG at ng PDF na daanan.
async function embedQuoteImage(url: string | null | undefined): Promise<string | null> {
  {
    const src = url?.trim();
    if (!src || !/^https?:\/\//i.test(src)) return null;
    // MODULE-LEVEL na cache (2026-08-17): dating per-call lang, kaya ang
    // preview → create ay dina-download muli ang parehong mga litrato —
    // pangunahing bagal ng "Create & send".
    const hit = quoteImgCache.get(src);
    if (hit && Date.now() - hit.at < QUOTE_IMG_TTL_MS) return hit.data;
    let out: string | null = null;
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(8000) });
      const type = res.headers.get("content-type") ?? "";
      if (res.ok && type.startsWith("image/")) {
        const buf = Buffer.from(await res.arrayBuffer());
        // 1.5MB kada larawan — sa 4-5 item, hindi lalampas sa kayang hatakin ni Meta.
        if (buf.length && buf.length <= 1_500_000) out = `data:${type};base64,${buf.toString("base64")}`;
      }
    } catch { /* walang larawan — blangko ang cell */ }
    if (out) {
      if (quoteImgCache.size >= 40) quoteImgCache.delete(quoteImgCache.keys().next().value!);
      quoteImgCache.set(src, { at: Date.now(), data: out });
    }
    return out;
  }
}

// Ang QuoteInput na may naka-embed nang larawan, logo at lagda — iisang
// pagbuo, tapos puwedeng i-render nang buo (viewer/imbakan) at kada pahina
// (Messenger) nang hindi muling hinahatak ang mga larawan.
async function buildQuoteInput(name: string, address: string | null, items: QuoteItem[], deliveryFee: number, hideQr = false, extra?: { paid?: number | null; paidLabel?: string | null; title?: string | null }): Promise<QuoteInput> {
  // Logo + ang mga na-upload na QR card at lagda — naka-embed bilang data URI,
  // dahil hinahatak ni Meta ang SVG sa server nila at hindi maaasahan doon ang
  // panlabas na <image href>.
  const [logo, assets] = await Promise.all([panLogoDataUri(), loadQuoteAssets()]);
  const itemsWithImages = await Promise.all(
    items.map(async (it) => ({ ...it, image: await embedQuoteImage(it.image) })),
  );

  const dateLabel = new Date().toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
  return {
    customerName: name,
    address,
    dateLabel,
    items: itemsWithImages,
    deliveryFee,
    logo,
    bpiQr: assets.bpiQr,
    bdoQr: assets.bdoQr,
    signature: assets.signature,
    hideQr,
    ...(extra ?? {}),
  };
}

async function buildQuotationSvg(name: string, address: string | null, items: QuoteItem[], deliveryFee: number, hideQr = false, extra?: { paid?: number | null; paidLabel?: string | null; title?: string | null }): Promise<string> {
  return renderQuotationSvg(await buildQuoteInput(name, address, items, deliveryFee, hideQr, extra));
}

// ── PREVIEW ──────────────────────────────────────────────────────────────────
// Ibinabalik ang SVG mismo — ipinapakita ng builder bilang data URI sa <img>
// bago pindutin ang Create & send (kahilingan 2026-08-10).
export async function previewQuotation(input: QuotationInput): Promise<{ svg: string } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };
  const items = (input.items ?? []).filter((it) => String(it.description ?? "").trim() || Number(it.unitPrice) > 0);
  if (items.length === 0) return { error: "Add at least one item with a description or price." };
  const svg = await buildQuotationSvg(
    input.customerName?.trim() || "—",
    input.address?.trim() || null,
    items,
    Number(input.deliveryFee) || 0,
    !!input.hideQr,
  );
  return { svg };
}

export async function createQuotation(input: QuotationInput): Promise<QuotationResult | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };

  const name = input.customerName?.trim();
  if (!name) return { error: "Customer name is required." };
  const items = (input.items ?? []).filter((it) => String(it.description ?? "").trim() || Number(it.unitPrice) > 0);
  if (items.length === 0) return { error: "Add at least one item with a description or price." };

  const db = createServerSupabase();

  // Hindi na pwedeng baguhin ang quotation na may order na — nakatali na roon
  // ang presyo at ang binayarang downpayment.
  const reviseTarget = input.reviseFq?.trim() || null;
  if (reviseTarget) {
    const { data: prev } = await db.from("quotations").select("order_number").eq("fq_number", reviseTarget).maybeSingle();
    if (prev?.order_number) return { error: `${reviseTarget} already has order ${prev.order_number} — it can no longer be revised.` };
  }

  const qi = await buildQuoteInput(name, input.address?.trim() || null, items, Number(input.deliveryFee) || 0, !!input.hideQr);
  const svg = renderQuotationSvg(qi);
  // KADA PAHINA PARA SA MESSENGER. Ang buong SVG ng 30 produkto ay ~20,000px
  // ang taas at pinipiga ito ng Messenger sa manipis na guhit — hindi
  // mababasa. Ang bawat pahina ay A4 ang ratio at hiwalay na larawan.
  const pages = renderQuotationSvgPages(qi);
  const t = quoteTotals({ items, deliveryFee: Number(input.deliveryFee) || 0 });

  // Iimbak para may permanenteng kopya (mapapadala rin sa email o ma-download).
  const slug = name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "customer";
  const path = `quotes/${slug}/${Date.now()}.svg`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, Buffer.from(svg), {
    contentType: "image/svg+xml",
    upsert: false,
  });
  if (upErr) return { error: `Could not save the quotation: ${upErr.message}` };
  const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  // Ang mga pahina ay iniimbak lang kapag higit sa isa — sa isang pahina ay
  // ang buong SVG na mismo ang ipinapadala, gaya ng dati.
  const pageUrls: string[] = [];
  if (pages.length > 1) {
    const stamp = Date.now();
    for (let i = 0; i < pages.length; i++) {
      const pp = `quotes/${slug}/${stamp}-p${i + 1}.svg`;
      const { error: pe } = await db.storage.from(BUCKET).upload(pp, Buffer.from(pages[i]), { contentType: "image/svg+xml", upsert: false });
      if (pe) return { error: `Could not save page ${i + 1}: ${pe.message}` };
      pageUrls.push(db.storage.from(BUCKET).getPublicUrl(pp).data.publicUrl);
    }
  }

  // FQ number mula sa Postgres sequence — walang collision sa sabayang paggawa
  // at walang paulit-ulit kapag may nabura (kapareho ng next_order_number).
  // Sa revision ay hindi humihingi ng bagong numero — ang dating FQ ang muling
  // ginagamit, kaya iisa lang ang dokumentong hawak ng customer at ng listahan.
  const revising = reviseTarget;
  let fqNumber: string | null = revising;
  if (!revising) {
    // Pinakamataas na FQ + 1 (babalik sa 000001 kapag walang laman).
    fqNumber = await nextDocNumber(db, "quotations", "fq_number", "FQ", "next_quotation_number");
  }

  // ── PDF NA MAY QR ───────────────────────────────────────────────────────────
  // Ang LARAWAN sa thread ay walang bank QR: kapag may QR sa larawan, ini-scan
  // ito ng Messenger app ng tumatanggap at kusang nagdadagdag ng "QR transfer /
  // Transfer with Maya / MariBank" card (may kopya pa ng quotation) — hindi
  // mensahe natin, walang Send API na pumipigil. Ang PDF ay HINDI ini-scan,
  // kaya doon nakalagay ang QR: naipapadala bilang file attachment kasunod ng
  // larawan. Best-effort — kapag nabigo, larawan lang ang ipapadala.
  let pdfUrl: string | null = null;
  let pdfName: string | null = null;
  // Dahilan kapag walang PDF — ibinabalik sa UI, hindi lang sa server log:
  // tahimik itong nabigo sa Vercel at mahirap hulaan kung bakit.
  let pdfError: string | null = null;
  try {
    const [{ renderQuotationPdf }, assets] = await Promise.all([
      import("@/lib/quotation-pdf"),
      loadQuoteAssets(),
    ]);
    if (assets.bpiQr || assets.bdoQr) {
      // Ang PDF ay ang BUONG quotation na MAY payment cards — ang larawan sa
      // thread ang walang QR, hindi ito. Iginuguhit nang deretso sa jsPDF
      // (walang sharp), kaya pareho ang laman pero hindi native binary ang
      // kailangan; ang mga litrato ay ang parehong data URI ng SVG.
      const [logo, itemsWithImages] = await Promise.all([
        panLogoDataUri(),
        Promise.all(items.map(async (it) => ({ ...it, image: await embedQuoteImage(it.image) }))),
      ]);
      const pdf = await renderQuotationPdf({
        customerName: name,
        address: input.address?.trim() || null,
        dateLabel: new Date().toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }),
        items: itemsWithImages,
        deliveryFee: Number(input.deliveryFee) || 0,
        logo,
        bpiQr: assets.bpiQr,
        bdoQr: assets.bdoQr,
        signature: assets.signature,
      });
      // Ang pangalang lumalabas sa Messenger ay galing sa FILENAME sa URL —
      // kaya ang FQ number ay nasa path mismo ("FQ-000012 QR.pdf").
      pdfName = `${fqNumber ?? "Quotation"} QR.pdf`;
      const pdfPath = `quotes/${slug}/${Date.now()}/${pdfName}`;
      const { error: pErr } = await db.storage.from(BUCKET).upload(pdfPath, pdf, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (pErr) pdfError = `upload: ${pErr.message}`;
      else pdfUrl = db.storage.from(BUCKET).getPublicUrl(pdfPath).data.publicUrl;
    } else {
      pdfError = "no bank QR cards uploaded in Quotation assets";
    }
  } catch (e) {
    pdfError = e instanceof Error ? e.message : String(e);
    console.warn("[quotation] QR PDF failed:", pdfError);
  }

  // ── ITALA BAGO MAGPADALA ────────────────────────────────────────────────────
  // Kailangan ang row ID sa button payload (FQ_ACCEPT:<id>), kaya dapat mauna ito
  // sa padala. Ang sent_count/status ay ina-update pagkatapos.
  let quotationId: number | null = null;
  // Ang naka-imbak na items ay ang ORIHINAL (may URL na larawan, hindi ang data
  // URI) — mas maliit, at maibabalik sa form nang buo.
  const record = {
    fq_number: fqNumber,
    customer_name: name,
    address: input.address?.trim() || null,
    items,
    delivery_fee: Number(input.deliveryFee) || 0,
    total: t.total,
    downpayment: t.downpayment,
    image_url: url,
  };
  try {
    if (revising) {
      // Pinapalitan ang laman ng dating row. Bumabalik sa Draft ang status at
      // nabubura ang bilang ng padala: bagong dokumento ito, kaya hindi
      // katotohanan ang dating "Sent"/"Accepted" laban sa bagong presyo.
      const { data: row } = await db
        .from("quotations")
        .update({ ...record, status: "Draft", sent_count: 0, sent_at: null, replied_at: null, replied_psid: null, updated_at: new Date().toISOString() })
        .eq("fq_number", revising)
        .select("id")
        .maybeSingle();
      quotationId = (row?.id as number) ?? null;
    }
    // Walang natagpuang row (nabura, o wala pang 0158) — gumawa na lang, para
    // hindi mawala ang quotation.
    if (quotationId === null) {
      const { data: row } = await db.from("quotations").insert({
        ...record,
        status: "Draft",
        created_by: me.full_name?.trim() || me.email || null,
      }).select("id").single();
      quotationId = (row?.id as number) ?? null;
    }
  } catch { /* wala pang table — nasa storage pa rin ang quotation */ }

  // ── PADALA SA MESSENGER ─────────────────────────────────────────────────────
  // Parehong ugali ng Follow up on Messenger: maramihan, may server-side na
  // muling pagsusuri ng 24h window (ang bukas na modal ay nagiging luma), at
  // sunod-sunod na padala para hindi tumama sa rate limit ni Meta. Ang kaibahan:
  // larawan ang ipinapadala, hindi teksto lang.
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const unique = [...new Set((input.psids ?? []).filter(Boolean))];
  if (unique.length) {
    if (unique.length > MAX_RECIPIENTS) return { error: `Too many at once — pick ${MAX_RECIPIENTS} or fewer.` };
    const cfg = fbConfig();
    if (!cfg) return { error: "Facebook is not configured." };

    const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
    const { data: fresh } = await db
      .from("fb_contacts")
      .select("psid")
      .in("psid", unique)
      .gte("last_message_at", since);
    const allowed = new Set((fresh ?? []).map((r) => r.psid as string));
    // MTO REQUESTS (2026-08-20): ang customer ay kadarating lang sa thread via
    // "Request a Quote" — bukas ang 24h window kahit hindi pa naitatala ang
    // last_message_at (bagong contact, o hindi pa umaabot ang webhook event).
    // Sinusuri ang mismong request para hindi tayo tumanggi nang mali; ang
    // sendFbMessage ang may HUMAN_AGENT fallback kapag talagang sarado na.
    try {
      const { data: mto } = await db
        .from("mto_requests")
        .select("psid")
        .in("psid", unique)
        .gte("created_at", since);
      for (const r of mto ?? []) if (r.psid) allowed.add(r.psid as string);
    } catch { /* wala pang 0169 — window check lang ang masusunod */ }
    skipped = unique.length - allowed.size;

    // ISANG CARD: paliwanag sa loob ng bubble, tapos tatlong buton — See full
    // breakdown (bubukas ang buong quotation), Accept, at I have questions.
    //
    // Mga natuklasan sa live thread (2026-08-09), kaya ito ang napili:
    //   • generic template — may buton pero KINA-CROP ang larawan sa maliit na
    //     card; hindi mababasa ang quotation.
    //   • media template — tinatanggihan ang larawan natin:
    //     "Non facebook url in url param" (Facebook-hosted lang ang tanggap).
    //   • receipt template — maganda ang amount header pero WALANG buton:
    //     'Invalid keys "buttons"'.
    //   • KULAY NG BUTON — hawak ni Meta, walang parameter. Hindi ma-customize.
    //
    // Ang buong larawan ay ipinapadala bilang sariling mensahe pagkatapos, para
    // makita agad nang hindi kailangang pumindot.
    //
    // Kailangan ng row id sa payload para maiugnay ang pindot sa tamang
    // quotation. Kung wala pa ang migration 0158, larawan lang ang ipapadala.
    const money = (n: number) => `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
    // Ang paliwanag ay UNA, ang larawan ay sa GITNA, ang buton ay HULI. Ang buton
    // ay laging nakakabit sa ilalim ng sariling bubble nito (walang paraan sa
    // Messenger para ilagay sa ilalim ng larawan), kaya tatlong mensahe: teksto,
    // larawan, tapos maikling tanong na may dalawang buton.
    //
    // MAIIKLING LINYA (≤34 chars): ang lapad ng text bubble ay hindi kayang
    // kontrolin — awtomatikong humahaba ito hanggang sa pinakamahabang linya.
    // Dating 136 chars ang pinakamahaba, kaya lumalapad ang bubble at hindi
    // tumutugma sa lapad ng patayong quotation image. Manu-manong pinuputol ang
    // mga linya para makitid ang bubble at magkasukat sila.
    // Ang unang pangalan lang — ang buong pangalan ay pwedeng mahaba (hal.
    // "Maria Rowena Lizarondo-Bongcayao") at pinapalapad nito ang bubble.
    const firstName = name.split(/\s+/)[0].slice(0, 20);
    const blurb = [
      `Hi ${firstName}!`,
      "Thank you for your interest.",
      "",
      `Total: ${money(t.total)}`,
      `30% down: ${money(t.downpayment)}`,
      `Balance: ${money(t.balance)}`,
      "",
      "The 30% downpayment confirms",
      "your order and secures the",
      "materials. Full quotation below:",
    ].join("\n");

    for (const psid of unique) {
      if (!allowed.has(psid)) continue;
      // 1) Paliwanag — nauuna para may konteksto agad ang larawan.
      await sendFbMessage(cfg.pageId, cfg.token, psid, { text: blurb }, "quotation blurb");
      // 2) Ang buong quotation, sa gitna — isang larawan kada pahina. Sunod-
      //    sunod at magkakapareho ang sukat, kaya mababasa ang bawat isa.
      let ok = true;
      for (const pu of pageUrls.length ? pageUrls : [url]) {
        const sent1 = await sendFbMessage(
          cfg.pageId, cfg.token, psid,
          { attachment: { type: "image", payload: { url: pu, is_reusable: true } } },
          "quotation image",
        );
        ok = ok && sent1;
      }
      // 3) PDF na may bank QR — file attachment, hindi ini-scan ni Messenger.
      if (ok && pdfUrl) {
        await sendFbMessage(
          cfg.pageId, cfg.token, psid,
          { attachment: { type: "file", payload: { url: pdfUrl, is_reusable: true } } },
          "quotation QR pdf",
        );
        await sendFbMessage(
          cfg.pageId, cfg.token, psid,
          { text: `Bank QR codes are in ${pdfName ?? "the PDF"} above — tap to open and scan.` },
          "quotation QR note",
        );
      }
      // 4) Ang dalawang buton, sa ilalim ng larawan.
      if (ok && quotationId) {
        await sendFbMessage(
          cfg.pageId, cfg.token, psid,
          {
            attachment: {
              type: "template",
              payload: {
                template_type: "button",
                text: "Would you like to proceed with this quotation?",
                buttons: [
                  { type: "postback", title: "Accept quotation", payload: `FQ_ACCEPT:${quotationId}` },
                  { type: "postback", title: "I have questions", payload: `FQ_QUESTION:${quotationId}` },
                ],
              },
            },
          },
          "quotation buttons",
        );
      }
      if (ok) sent++;
      else failed++;
    }
  }

  try {
    await auditAfter({ module: "orders", table: "app_settings", recordId: `quotation:${slug}`, action: "insert", snapshotId: null });
  } catch { /* best-effort */ }

  // Itala ang naabot ng padala. Ang status ay "Sent" — hinihintay pa ang sagot
  // ng customer, at ang webhook ang magpapalit nito sa Accepted/Declined kapag
  // pumindot siya ng buton sa card.
  if (quotationId && sent > 0) {
    try {
      await db.from("quotations").update({
        status: "Sent",
        sent_count: sent,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", quotationId);
    } catch { /* best-effort */ }
  }

  return { id: quotationId, fqNumber, url, total: t.total, downpayment: t.downpayment, sent, failed, skipped, pdfError };
}

// ── LISTAHAN ─────────────────────────────────────────────────────────────────
export type QuotationRow = {
  id: number;
  fqNumber: string | null;
  customer: string;
  address: string | null;
  items: QuoteItem[];
  deliveryFee: number;
  total: number;
  downpayment: number;
  imageUrl: string | null;
  status: string;
  createdBy: string | null;
  sentCount: number;
  createdAt: string;
  // Kailan pumindot ang customer ng Accept / "I have questions" sa Messenger.
  repliedAt: string | null;
  // Order na naigawa mula rito — panangga sa doble.
  orderNumber: string | null;
  // Ilan nang follow-up ang naipadala (max MAX_FOLLOWUPS).
  followupCount: number;
  // MTO-000123 — ang made-to-order request na pinanggalingan nito, at kung
  // minarkahan na itong Approved doon ng team. Ang Approved sa MTO Requests ang
  // nagsasabing tapos na ang usapan sa presyo, kaya iyon ang ipinapakita rito
  // sa halip na "Awaiting reply".
  mtoNumber: string | null;
  mtoApproved: boolean;
  // Ang piniling build ng customer at ang contact number niya — galing sa MTO
  // request, hindi sa quotation mismo. Ang buod ang kailangan sa listahan; ang
  // buong bersyon ay nasa dokumento.
  build: string | null;
  contact: string | null;
};

export async function loadQuotations(limit = 100): Promise<QuotationRow[]> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return [];
  try {
    const db = createServerSupabase();
    const { data } = await db
      .from("quotations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    // Ang MTO request ang may hawak ng manu-manong status (New/Quoted/Approved),
    // kaya hinahanap kung saang request nakatali ang bawat FQ.
    const mto = new Map<string, { number: string | null; approved: boolean; build: string | null; contact: string | null }>();
    try {
      const fqs = (data ?? []).map((r) => r.fq_number as string | null).filter(Boolean) as string[];
      if (fqs.length) {
        const { data: reqs } = await db.from("mto_requests").select("fq_number, mto_number, status, build, contact").in("fq_number", fqs);
        for (const q of reqs ?? []) {
          const st = String(q.status ?? "");
          // Ang build ay bullets na may presyo; ang buod ay ang mga label lang,
          // pinagdugtong — ito ang kasya sa isang cell.
          const b = q.build as { lines?: { label: string }[] } | null;
          const build = (b?.lines ?? []).map((l) => String(l.label).replace(/^(Size|Fabric):\s*/i, "")).join(" · ") || null;
          mto.set(q.fq_number as string, {
            number: (q.mto_number as string | null) ?? null,
            approved: st === "Approved" || st === "Ordered",
            build,
            contact: (q.contact as string | null) ?? null,
          });
        }
      }
    } catch { /* wala pang 0169 — walang MTO na ipapakita */ }

    return (data ?? []).map((r) => ({
      id: r.id as number,
      fqNumber: (r.fq_number as string | null) ?? null,
      customer: (r.customer_name as string) ?? "",
      address: (r.address as string | null) ?? null,
      items: (r.items as QuoteItem[]) ?? [],
      deliveryFee: Number(r.delivery_fee) || 0,
      total: Number(r.total) || 0,
      downpayment: Number(r.downpayment) || 0,
      imageUrl: (r.image_url as string | null) ?? null,
      status: (r.status as string) ?? "Draft",
      createdBy: (r.created_by as string | null) ?? null,
      sentCount: Number(r.sent_count) || 0,
      createdAt: (r.created_at as string) ?? "",
      // Ang tatlong column na ito ay galing sa 0159 — may database na naka-0158
      // na bago pa sila naidagdag, kaya optional ang pagbasa (select("*") ang
      // gamit, kaya wala lang sila sa row kapag hindi pa naitakbo).
      repliedAt: ((r as Record<string, unknown>).replied_at as string | null) ?? null,
      orderNumber: ((r as Record<string, unknown>).order_number as string | null) ?? null,
      followupCount: Number((r as Record<string, unknown>).followup_count) || 0,
      mtoNumber: mto.get((r.fq_number as string) ?? "")?.number ?? null,
      mtoApproved: mto.get((r.fq_number as string) ?? "")?.approved ?? false,
      build: mto.get((r.fq_number as string) ?? "")?.build ?? null,
      contact: mto.get((r.fq_number as string) ?? "")?.contact ?? null,
    }))
      // APPROVED LANG (2026-08-21). Ang MTO Requests ang gumagawa at nagbabago
      // ng quotation; hangga't hindi pinipili roon ang Approved, maaari pang
      // magbago ang presyo, kaya walang saysay itong ipakita rito. Ang natitira
      // ay panghuling bersyon lamang — buod at basahan ito, hindi workspace.
      .filter((r) => r.mtoApproved);
  } catch {
    // Wala pang migration 0158 — walang listahan, pero gumagana ang builder.
    return [];
  }
}

// ── FOLLOW-UP ────────────────────────────────────────────────────────────────
// Maikling tulak sa customer na hindi pa sumasagot. HINDI muling ipinapadala ang
// larawan: nasa thread pa ito at GUMAGANA pa ang Accept button ng lumang mensahe,
// kaya ang pagdoble ay nakakalito lang at mukhang spam. Hanggang MAX_FOLLOWUPS,
// at magkaiba ang bawat mensahe.
//
// ⚠️ HINDI NAGPAPAHABA NG 24H WINDOW ANG FOLLOW-UP. Ang bintana ay nagsisimula sa
// huling mensahe NG CUSTOMER, hindi sa atin — kaya kung tahimik siya, sasara ito
// anuman ang ipadala natin. Kapag sarado na, hindi na rin tatalab ang Accept
// button niya. Dahil dito, hinaharang dito ang padala kapag labas na sa bintana:
// mas mabuting sabihin sa staff kaysa magbilang ng follow-up na hindi dumating.
export async function followUpQuotation(id: number): Promise<{ ok: true; count: number } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };

  const db = createServerSupabase();
  const { data: q } = await db.from("quotations").select("*").eq("id", id).single();
  if (!q) return { error: "Quotation not found." };
  if (q.status === "Accepted") return { error: "Already confirmed — no follow-up needed." };
  if (!q.replied_psid && !q.sent_count) return { error: "This quotation has not been sent yet." };

  const count = Number((q as Record<string, unknown>).followup_count) || 0;
  if (count >= MAX_FOLLOWUPS) return { error: `Already followed up ${MAX_FOLLOWUPS} times — leave it with the customer.` };

  // Kanino ipapadala: ang huling sumagot, o ang PSID ng pangalan sa quotation.
  let psid = (q.replied_psid as string | null) ?? null;
  if (!psid) {
    const { data: c } = await db.from("fb_contacts").select("psid")
      .ilike("name", (q.customer_name as string) ?? "").order("last_message_at", { ascending: false }).limit(1).maybeSingle();
    psid = (c?.psid as string) ?? null;
  }
  if (!psid) return { error: "No Messenger contact for this customer." };

  // Nasa 24h window pa ba? Kung hindi, walang dadaan — huwag magbilang.
  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  const { data: fresh } = await db.from("fb_contacts").select("psid").eq("psid", psid).gte("last_message_at", since).maybeSingle();
  if (!fresh) return { error: "Outside the 24-hour window — Meta will not deliver it. Wait for the customer to message first." };

  const cfg = fbConfig();
  if (!cfg) return { error: "Facebook is not configured." };

  const firstName = ((q.customer_name as string) ?? "").split(/\s+/)[0].slice(0, 20);
  const next = count + 1;
  const ok = await sendFbMessage(cfg.pageId, cfg.token, psid, { text: followupMessage(next, firstName) }, "quotation follow-up");
  if (!ok) return { error: "Messenger rejected the message." };

  try {
    await db.from("quotations").update({
      followup_count: next,
      last_followup_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
  } catch { /* wala pang 0160 — naipadala na naman */ }

  return { ok: true, count: next };
}

// ── MARKAHANG NAGING ORDER ───────────────────────────────────────────────────
// Pagkatapos gumawa ng order mula sa isang tinanggap na quotation, itinatala ang
// order number dito. Ito ang panangga sa doble: pag may laman na, hindi na
// ipinapakita ang "Create order" na buton.
export async function linkQuotationOrder(id: number, orderNumber: string): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };
  const db = createServerSupabase();
  const { data: row, error } = await db.from("quotations")
    .update({ order_number: orderNumber, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("fq_number")
    .maybeSingle();
  if (error) return { error: error.message };

  // Ang MTO request na pinagmulan ay dinadalhan din ng order number, para
  // nakikita roon ang buong daanan: MTO # → FQ # → Order #.
  try {
    const fq = row?.fq_number as string | null;
    if (fq) await db.from("mto_requests").update({ order_number: orderNumber, status: "Ordered" }).eq("fq_number", fq);
  } catch { /* wala pang 0169 — nananatili sa quotations ang kawing */ }
  revalidatePath("/mto-requests");
  revalidatePath("/quotations");
  return { ok: true };
}

export async function setQuotationStatus(id: number, status: string): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };
  if (!QUOTE_STATUSES.includes(status as QuoteStatus)) return { error: "Unknown status." };
  const db = createServerSupabase();
  const { error } = await db.from("quotations").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  try {
    await auditAfter({ module: "quotations", table: "quotations", recordId: id, action: "update" });
  } catch { /* best-effort */ }
  return { ok: true };
}

// ── ASSET UPLOAD ─────────────────────────────────────────────────────────────
// Ang dalawang InstaPay QR card at ang lagda ay LARAWANG ina-upload ng admin —
// hindi kayang buuin ng code (ibang QR payload ang InstaPay ng bawat bangko, at
// ang lagda ay scan ng tunay na pirma). Pagka-upload, awtomatiko nang lumalabas
// sa bawat bagong quotation.
export type AssetKind = keyof typeof QUOTE_ASSET_PATHS;

export async function uploadQuoteAsset(kind: AssetKind, dataUrl: string): Promise<{ ok: true } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { error: "Not allowed." };

  const base = QUOTE_ASSET_PATHS[kind];
  if (!base) return { error: "Unknown asset." };

  // Anumang image mime ang tinatanggap — ang naunang PNG/JPEG/WEBP-lang na
  // pagsusuri ay tumatanggi sa AVIF/HEIC/GIF na karaniwan sa telepono, at ang
  // sinasabi lang ay "Pick a PNG…" kaya mahirap malaman ang tunay na dahilan.
  const m = /^data:(image\/([a-z0-9.+-]+));base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) {
    const kindSeen = /^data:([^;,]+)/.exec(dataUrl.trim())?.[1] ?? "unknown";
    return { error: `That file is not an image (${kindSeen}). Pick a photo or screenshot.` };
  }
  const mime = m[1].toLowerCase();
  const sub = m[2].toLowerCase();
  const EXT: Record<string, string> = { png: "png", jpeg: "jpg", jpg: "jpg", webp: "webp", gif: "gif", avif: "avif", heic: "heic", heif: "heif", "svg+xml": "svg" };
  const ext = EXT[sub] ?? (sub.replace(/[^a-z0-9]/g, "") || "png");
  const buf = Buffer.from(m[3], "base64");
  if (!buf.length) return { error: "That file came through empty. Try again." };
  if (buf.length > 4_000_000) return { error: `Image is ${Math.round(buf.length / 1024 / 1024)}MB — the limit is 4MB.` };

  const db = createServerSupabase();
  // Alisin ang lumang bersyon anuman ang extension, para walang dalawang laman.
  const dir = base.slice(0, base.lastIndexOf("/"));
  const name = base.slice(base.lastIndexOf("/") + 1);
  try {
    const { data } = await db.storage.from(BUCKET).list(dir, { limit: 100 });
    const stale = (data ?? []).filter((f) => f.name.replace(/\.[^.]+$/, "") === name).map((f) => `${dir}/${f.name}`);
    if (stale.length) await db.storage.from(BUCKET).remove(stale);
  } catch { /* wala pang folder — ayos lang */ }

  const { error } = await db.storage.from(BUCKET).upload(`${base}.${ext}`, buf, { contentType: mime, upsert: true });
  if (error) return { error: error.message };
  return { ok: true };
}

// Alin ang naka-upload na, at ano ang PUBLIC URL nito para sa preview?
//
// Isang LIST lang ang tinatawag — hindi loadQuoteAssets(), dahil ini-download at
// bine-base64 nito ang tatlong larawan. Sa page load, megabytes ng paghahatid ang
// wala namang saysay: URL lang ang kailangan ng <img>, at ang browser na ang
// magku-kuha. (Ang data URI ay para sa SVG na hinahatak ni Meta — ibang usapin.)
export type AssetStatus = { uploaded: boolean; url: string | null };
export async function quoteAssetStatus(): Promise<Record<AssetKind, AssetStatus>> {
  const none = { uploaded: false, url: null };
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "edit")) return { bpiQr: none, bdoQr: none, gcashQr: none, mayaQr: none, signature: none };
  try {
    const db = createServerSupabase();
    const { data } = await db.storage.from(BUCKET).list("quotation", { limit: 100 });
    const files = data ?? [];
    const find = (base: string): AssetStatus => {
      const name = base.slice(base.lastIndexOf("/") + 1);
      const hit = files.find((f) => f.name.replace(/\.[^.]+$/, "") === name);
      if (!hit) return { uploaded: false, url: null };
      const pub = db.storage.from(BUCKET).getPublicUrl(`quotation/${hit.name}`).data.publicUrl;
      // Cache-buster: ang pangalan ay pareho tuwing papalitan, kaya kung wala
      // ito ay lumang larawan ang ipapakita ng browser matapos mag-replace.
      const stamp = hit.updated_at ?? hit.created_at ?? "";
      return { uploaded: true, url: stamp ? `${pub}?v=${Date.parse(stamp) || ""}` : pub };
    };
    return {
      bpiQr: find(QUOTE_ASSET_PATHS.bpiQr),
      bdoQr: find(QUOTE_ASSET_PATHS.bdoQr),
      gcashQr: find(QUOTE_ASSET_PATHS.gcashQr),
      mayaQr: find(QUOTE_ASSET_PATHS.mayaQr),
      signature: find(QUOTE_ASSET_PATHS.signature),
    };
  } catch {
    // Wala pang folder, o hindi maabot ang storage — huwag ipabagsak ang page.
    return { bpiQr: none, bdoQr: none, gcashQr: none, mayaQr: none, signature: none };
  }
}

// ── SHIPPING RATES (2026-08-16) ──────────────────────────────────────────────
// Parehong rates ng WEBSITE checkout (web_content "site" → shipping.provinces):
// pinipili sa Formal Quotation ang province + city at awtomatikong napupunta
// ang bayarin sa Delivery & installation fee (editable pa rin).
export type ShipProvince = { name: string; cities: { name: string; fee: number }[] };
export async function shippingRates(): Promise<ShipProvince[]> {
  const me = await getSession();
  if (!me) return [];
  try {
    const { loadContent } = await import("@/app/website/actions");
    const site = await loadContent<{ shipping?: { provinces?: ShipProvince[] } }>("site");
    return site?.shipping?.provinces ?? [];
  } catch {
    return [];
  }
}

// ── QUOTATION SUMMARY (2026-08-22) ──────────────────────────────────────────
// ISANG DOKUMENTO PARA SA BUONG ORDER. Ang bawat FQ ay nananatiling hiwalay —
// iyon ang talaan ng napagkasunduan sa araw na ipinadala ito, at walang
// bersyon ang quotation kaya ang pagbabago ay tuluyang pagbura. Ang summary
// naman ay ang laman ng order NGAYON: ito ang ipinapadala sa customer
// pagkatapos may maidagdag, para hindi na niya kailangang pagsamahin ang
// dalawang quotation nang mag-isa.
//
// BINUBUO SA BAWAT PAGBUKAS, hindi iniimbak: ang mga FQ na ang bakas ng
// kasaysayan (bawat isa ay may sariling petsa at Approved), kaya hindi na
// kailangan ng summary ng sariling talaan. Mula sa receipt_items ito galing —
// parehong listahan ng resibo, kaya hindi sila maaaring maghiwalay.
export async function buildOrderSummary(orderId: number, store = false): Promise<
  { ok: true; url: string; total: number; paid: number; balance: number; itemCount: number; fqs: string[] } | { error: string }
> {
  const me = await getSession();
  if (!me || !hasPermission(me, "quotations", "view")) return { error: "Not allowed." };

  const db = createServerSupabase();
  const { data: o } = await db
    .from("orders")
    .select("id, order_number, customer_name, address, receipt_items, full_payment_price, downpayment_price, full_payment, date_downpayment")
    .eq("id", orderId)
    .maybeSingle();
  if (!o) return { error: "Order not found." };

  const rows = (o.receipt_items as { qty?: number; description?: string; unitPrice?: number; image?: string | null; source_fq?: string }[] | null) ?? [];
  if (!rows.length) return { error: `${o.order_number ?? "This order"} has no items yet.` };

  // Ang delivery/shipping ay hiwalay na hilera sa dokumento, hindi item —
  // parehong porma ng quotation, kung saan ito ay `deliveryFee`.
  const isFee = (d: string) => /^(addtl\.?\s*)?(additional\s*)?(shipping|rush|delivery)(\s*(and|&)\s*installation)?(\s*fee)?$/i.test(d.split("\n")[0].trim());
  const products = rows.filter((it) => !isFee(String(it.description ?? "")));
  const deliveryFee = rows
    .filter((it) => isFee(String(it.description ?? "")))
    .reduce((s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.qty) || 1), 0);

  const items: QuoteItem[] = products.map((it) => ({
    qty: Number(it.qty) || 1,
    description: String(it.description ?? ""),
    unitPrice: Number(it.unitPrice) || 0,
    image: it.image ?? null,
  }));

  // Ang naibayad na — mula sa mga mirror na hawak ng payments ledger.
  const paid = (Number(o.downpayment_price) || 0) + (Number(o.full_payment) || 0);
  const paidLabel = o.date_downpayment
    ? `paid ${new Date(String(o.date_downpayment)).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`
    : "paid";

  const svg = await buildQuotationSvg(
    (o.customer_name as string) || "—",
    (o.address as string | null) ?? null,
    items,
    deliveryFee,
    true, // walang QR: idinadagdag ni Messenger ang sariling transfer widget nito
    { paid, paidLabel, title: "QUOTATION SUMMARY" },
  );

  // WALANG UPLOAD PARA SA PANONOOD LANG. Ang pag-imbak ay round-trip sa
  // Storage bawat pindot, para sa file na hindi naman itinatago — binubuo
  // muli ito sa susunod na pagbukas. Ang browser ay kayang basahin ang SVG
  // mula sa data URI nang diretso, kaya doon ito ipinapadala.
  //
  // Kapag IPAPADALA sa customer, saka ito iniimbak: kailangan ni Messenger ng
  // totoong URL na kaya nitong hatakin.
  let url: string;
  if (store) {
    const num = String(o.order_number ?? `ORD${o.id}`).replace(/[^a-z0-9_-]/gi, "");
    const path = `quotes/summary/${num}/${Date.now()}.svg`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, Buffer.from(svg), { contentType: "image/svg+xml", upsert: false });
    if (upErr) return { error: `Could not build the summary: ${upErr.message}` };
    url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } else {
    url = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const total = items.reduce((s, it) => s + it.unitPrice * it.qty, 0) + deliveryFee;
  // Aling mga quotation ang binubuo nito — ipinapakita sa tabi ng buton para
  // makita ng team na tugma ang summary sa mga FQ na naka-attach.
  const fqs = [...new Set(products.map((it) => it.source_fq).filter(Boolean) as string[])];

  return { ok: true, url, total, paid, balance: Math.max(0, total - paid), itemCount: items.length, fqs };
}
