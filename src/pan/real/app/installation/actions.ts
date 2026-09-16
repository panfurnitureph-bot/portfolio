"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { lineKey, keySet, hasKey, keyName } from "@/lib/orders/line-key";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { requireEdit } from "@/lib/auth/guard";
import { reworkLedger } from "@/lib/returns/rework-balance";
import { isShippingDesc } from "@/lib/shipping";
import { emailShell, panel, intro, mono, attachmentNote, whatsNext, progressRail, gmailOrderSchema, preheader } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/send";
import { isReworkLine } from "@/lib/orders/rework-match";

// Read pixel size of a PNG or JPEG buffer (for PDF page sizing).
function imageSize(buf: Buffer): { w: number; h: number; fmt: "PNG" | "JPEG" } {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), fmt: "PNG" };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const m = buf[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7), fmt: "JPEG" };
      }
      o += 2 + buf.readUInt16BE(o + 2);
    }
    return { w: 800, h: 1130, fmt: "JPEG" };
  }
  return { w: 800, h: 1130, fmt: "PNG" };
}

// Wrap the signed warranty-form image (PNG/JPEG public URL) into a one-page PDF, base64.
async function warrantyPdfFromImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const { w, h, fmt } = imageSize(buf);
    const { jsPDF } = await import("jspdf");
    const pw = (w || 800) * 0.75, ph = (h || 1130) * 0.75; // px → pt @96dpi
    const doc = new jsPDF({ unit: "pt", format: [pw, ph], compress: true });
    const mime = fmt === "JPEG" ? "image/jpeg" : "image/png";
    doc.addImage(`data:${mime};base64,${buf.toString("base64")}`, fmt, 0, 0, pw, ph);
    return Buffer.from(doc.output("arraybuffer")).toString("base64");
  } catch { return null; }
}

// Email the signed Warranty Certificate (PDF) to the customer via the n8n webhook.
// Best-effort; needs N8N_RECEIPT_WEBHOOK + the order's email.
export async function sendWarrantyEmail(orderId: number | null, warrantyFormUrl: string): Promise<boolean> {
  try {
    const hook = process.env.N8N_WARRANTY_WEBHOOK || process.env.N8N_RECEIPT_WEBHOOK;
    if (!hook || !orderId) return false;
    const db = createServerSupabase();
    const { data } = await db.from("orders").select("email, customer_name, order_number").eq("id", orderId).maybeSingle();
    const to = (data?.email as string | null)?.trim();
    if (!to) return false;
    const pdf = await warrantyPdfFromImage(warrantyFormUrl);
    if (!pdf) return false;
    const ord = (data?.order_number as string) || `#${orderId}`;
    const customer = (data?.customer_name as string) || "there";
    // SHOPEE-STYLE (2026-08-26): mula sa lib/email/layout — iisang hulma.
    const html = preheader("Installation complete · certificate attached as PDF") + gmailOrderSchema({
      orderNumber: String(ord),
      status: "OrderDelivered",
      customerName: customer,
    }) + emailShell(
      panel(
        intro(customer, `The installation for your order ${mono(String(ord))} is <b style="color:#1a7f43">complete</b>! Your <b>Product Warranty Certificate</b> is attached — please keep it together with your receipt for any warranty claims.`)
        + progressRail([
            { label: "Confirmed", state: "done" },
            { label: "Packed", state: "done" },
            { label: "Out for Delivery", state: "done" },
            { label: "Arrived", state: "done" },
            { label: "Installation", state: "done" },
            { label: "Delivered", state: "current" },
          ]),
        { pad: "26px 36px 20px" })
      + panel(attachmentNote("Product Warranty Certificate"), { pad: "0 36px 16px" })
      + whatsNext("Thank you for choosing Pan Furniture! For any warranty concerns, reply to this email with your order number and photos of the issue.")
    );
    await sendEmail({
      to, subject: `Your Warranty Certificate — ${ord}`, html, type: "warranty",
      orderId, orderNumber: String(ord), hook, db,
      extra: { customer, filename: `Warranty-${ord}.pdf`, pdf_base64: pdf },
      idempotencyKey: `warranty:${orderId}:${warrantyFormUrl.slice(-24)}`,
    });
    return true;
  } catch { return false; }
}

export type InstallationInput = {
  id: number | null;
  order_id: number | null;
  delivery_id: number | null;
  order_number: string | null;
  customer_name: string | null;
  address: string | null;
  sales_rep: string | null;
  items_summary: string | null;
  install_date: string | null;
  installer_team: string | null;
  warranty_terms: string | null;
  warranty_duration: string | null;
  warranty_start: string | null;
  signature_url: string | null;
  warranty_form_url: string | null;
  photos: string[];
  feedback: string | null;
  status: string;
  notes: string | null;
  item_installers: string[][];
  // Litrato ng install kada produkto (0207), nakahanay sa items[]. Ang
  // `photos` ay ang buong bilang ng order — iyon pa rin ang tinatanong ng
  // gate ng Delivered at ng mga lumang talaan.
  item_photos?: string[][];
  // REWORK visit: pilitin ang BAGONG installations row — huwag i-update ang lumang
  // completed record ng order (ang dedupe lookup sa baba ay nilalaktawan).
  force_new?: boolean;
};

export async function saveInstallation(input: InstallationInput): Promise<{ ok: true; id: number } | { error: string }> {
  await requireEdit("/installation", "installation");
  const supabase = createServerSupabase();

  // WALANG STATUS LOCK (Joe 2026-09-05, "pag may permission na view at edit,
  // wala nang blocker"): ang requireEdit sa itaas — ang permission grid — ang
  // nag-iisang gate. Ang dating "Locked — already Delivered" ay tinanggal.

  // Unified lifecycle (one status across My Jobs / Order Tracker / Sales Orders / Installation):
  //   warranty form signed                     → "Installation"
  //   signed + zero balance + a photo uploaded → "Delivered"
  const signed = !!(input.warranty_form_url || input.signature_url);
  let balance = 0;
  let balanceLabel = "balance";
  // KADA PRODUKTO ANG PATUNAY (hiling 2026-08-29). Ang bilang ng produkto ay
  // galing sa order mismo, hindi sa ipinasa — ang kliyente ang nagsasabi kung
  // ilan ang litrato, kaya hindi rin siya ang dapat magsabi kung ilan ang
  // dapat. Ang mga bayarin (Shipping / Addtl.) ay hindi produkto at walang
  // ini-install, kaya wala rin silang litratong hinihingi.
  let itemCount = 0;
  if (input.order_id != null) {
    const { data: ord } = await supabase.from("orders").select("full_payment_price, downpayment_price, full_payment, receipt_items, dq_items").eq("id", input.order_id).limit(1);
    const o = ord?.[0];
    if (o) balance = Math.max(0, Math.round(((Number(o.full_payment_price) || 0) - ((Number(o.downpayment_price) || 0) + (Number(o.full_payment) || 0))) * 100) / 100);
    const lines = ((o?.receipt_items as { description?: string | null; sku?: string | null; color?: string | null }[] | null) ?? [])
      .filter((x) => !isShippingDesc(x.description));
    itemCount = lines.length;

    // PARTIAL BATCH (2026-09-02): kapag bahagi lang ng order ang dala ng biyaheng
    // ito (ang dq_items ay mas maliit sa buong order), ang singil at ang bilang ng
    // litratong hinihingi ay sa BATCH lang - kung hindi, hihingin ng gate ang
    // balanse at litrato ng mga produktong hindi pa naihahatid, at ang unang
    // biyahe ay hindi kailanman magiging Delivered. Ang singil ng batch: mga item
    // ng batch + shipping (unang batch lang) - lahat ng nabayad na, clamp 0 -
    // parehong-pareho ng delivery modal at ng installation loader.
    // Ang dq_items ay talaan ng mga LINE KEY na string ("pan accent chair v.01"),
    // hindi mga bagay na may description — ganoon ang sulat ng delivery queue.
    const dqRaw = (o?.dq_items as unknown[] | null) ?? null;
    // KASAMA ANG KULAY (2026-09-06, lib/orders/line-key): "pangalan @ kulay".
    const flp = (t: unknown, color?: string | null) => lineKey(String(t ?? ""), color);
    const lk = (it: { description?: string | null; color?: string | null }) => lineKey(it.description, it.color);
    const bk = new Set([...keySet(dqRaw)].filter((k) => !isShippingDesc(keyName(k))));
    const allItems = ((o?.receipt_items as { description?: string | null; qty?: number | string | null; unitPrice?: number | string | null; color?: string | null }[] | null) ?? []);
    // Ang mga naihatid nang linya — kailangan ng kumulatibong singil AT ng
    // batch fallback sa ibaba. Best-effort: wala pang 0200 → walang partial.
    let priorRows: { item_desc: string | null; batch_no: number | null }[] = [];
    try {
      const { data: prior } = await supabase.from("order_line_deliveries").select("item_desc, batch_no").eq("order_id", input.order_id);
      priorRows = (prior ?? []) as typeof priorRows;
    } catch { /* wala pang 0200 */ }
    // PAGKA-DELIVERED AY NILILINIS ANG dq_items (para sa requeue ng susunod na
    // batch) — pero ang installer ay pumipirma PAGKATAPOS noon, at ang gate na
    // ito ay dating bumabalik sa buong-order na singil at bilang ng litrato
    // ("collect ₱20,000" + litrato ng item na nasa susunod na batch pa). Gaya ng
    // loader: ang HULING batch sa order_line_deliveries ang batch ng biyaheng
    // ito kapag wala nang dq_items.
    if (!bk.size && priorRows.length) {
      const maxB = Math.max(0, ...priorRows.map((r) => Number(r.batch_no) || 0));
      for (const r of priorRows) {
        if ((Number(r.batch_no) || 0) !== maxB) continue;
        const k = flp(r.item_desc);
        if (k && !isShippingDesc(k)) bk.add(k);
      }
    }
    if (bk.size && lines.some((x) => !hasKey(bk, lk(x)))) {
      const batchLines = lines.filter((x) => hasKey(bk, lk(x)));
      if (batchLines.length) itemCount = batchLines.length;
      const amt = (xs: typeof allItems) => xs.reduce((s2, it) => s2 + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
      const bTotal = amt(allItems.filter((it) => !isShippingDesc(it.description) && hasKey(bk, lk(it))));
      const fees = amt(allItems.filter((it) => isShippingDesc(it.description)));
      // KUMULATIBO (2026-09-02): ang singil ng biyaheng ito = (naihatid na +
      // batch na ito + fee) - lahat ng bayad. Kapag per-batch lang ang items na
      // ibinawas sa KABUUANG bayad, ang huling batch ay laging ₱0 at papayagan
      // ng gate ang Delivered nang hindi nasisingil ang natitirang balanse.
      const done = new Set(priorRows.map((r) => flp(r.item_desc)).filter(Boolean));
      const deliveredTotal = amt(allItems.filter((it) => { const k = lk(it); return hasKey(done, k) && !hasKey(bk, k) && !isShippingDesc(it.description); }));
      const paidSum = (Number(o!.downpayment_price) || 0) + (Number(o!.full_payment) || 0);
      balance = Math.max(Math.round((fees + deliveredTotal + bTotal - paidSum) * 100) / 100, 0);
      balanceLabel = "balance for this delivery";
    }

    // REWORK VISIT: ISA LANG ANG BILANG (2026-08-29). Ang modal ay nagpapakita
    // lang ng inayos na produkto, kaya ang buong bilang ng order ay hindi
    // kailanman maaabot ng `item_photos` at babagsak ang tseke sa lumang
    // "kahit isang litrato" — mas maluwag kaysa sa nakikita ng installer.
    // Kaparehong pagtutugma ng loader: SKU muna, pangalan bilang panghalili.
    const { data: rw } = await supabase.from("returns")
      .select("item_desc, sku, color, status, reworked_at")
      .eq("order_id", input.order_id).eq("resolution", "rework")
      .order("created_at", { ascending: false }).limit(1);
    const r0 = rw?.[0] as { item_desc?: string | null; sku?: string | null; color?: string | null; status?: string | null; reworked_at?: string | null } | undefined;
    const active = r0 && (/rework/i.test(r0.status ?? "") || !!r0.reworked_at) && !/reject|pending/i.test(r0.status ?? "");
    if (active) {
      // KASAMA ANG KULAY (2026-09-06, lib/orders/rework-match).
      const hit = lines.filter((x) => isReworkLine(r0!, x));
      if (hit.length) itemCount = hit.length;
    }
    // REWORK GUARDRAIL: kapag may rework na may service charge, ang RMA ledger ang
    // masusunod (kasama na sa charge ang natitirang balance ng order; ang bayad ay
    // nasa returns.rework_downpayment, hindi sa orders ledger) — hindi magiging
    // Delivered hangga't may utang sa RMA.
    const rl = await reworkLedger(supabase, input.order_id);
    if (rl) { balance = rl.due; balanceLabel = `rework balance (${rl.rma})`; }
  }
  // LAHAT NG PRODUKTO AY MAY SARILING LITRATO. Ang lumang tseke ay "kahit isa
  // sa buong order" — kaya ang pitong mesa ay maaaring maging Delivered sa
  // isang litrato, at walang patunay ang anim. Ang `item_photos` ang binibilang
  // ngayon; ang bawat produkto ay dapat may kahit isa.
  //
  // Ang `photos` ay pambalik para sa mga LUMANG talaan (bago ang 0207) at para
  // sa order na hindi mabilang ang produkto — doon, ang lumang tuntunin pa rin
  // ang umiiral kaysa harangin ang isang taong walang magagawa.
  const perItem = input.item_photos ?? [];
  const shot = (i: number) => (perItem[i]?.length ?? 0) > 0;
  const covered = itemCount > 0 && perItem.length >= itemCount
    ? Array.from({ length: itemCount }, (_, i) => i).filter((i) => !shot(i))
    : [];
  const hasPhoto = itemCount > 0 && perItem.length >= itemCount
    ? covered.length === 0
    : (input.photos?.length ?? 0) > 0;

  const delivered = signed && balance <= 0 && hasPhoto;
  // If the user explicitly chose "Delivered" but the requirements aren't met, tell them what's missing.
  if (/delivered|completed/i.test(input.status) && !delivered) {
    const photoMiss = covered.length
      ? `upload an installation photo for ${covered.length === itemCount ? "every product" : `${covered.length} product${covered.length === 1 ? "" : "s"} (item ${covered.map((i) => i + 1).join(", ")})`}`
      : "upload at least one installation photo";
    const miss = [!signed && "sign the warranty form", balance > 0 && `collect the remaining ₱${balance.toLocaleString("en-PH", { minimumFractionDigits: 2 })} ${balanceLabel}`, !hasPhoto && photoMiss].filter(Boolean);
    return { error: `Can't mark Delivered yet — ${miss.join(", ")}.` };
  }
  const stageStatus = delivered ? "Delivered" : signed ? "Installation" : (input.status || "In Progress");
  const completed = delivered; // "Completed" is now "Delivered"

  const row = {
    order_id: input.order_id, delivery_id: input.delivery_id, order_number: input.order_number || null, customer_name: input.customer_name || null,
    address: input.address || null, sales_rep: input.sales_rep || null, items_summary: input.items_summary || null,
    install_date: input.install_date || null, installer_team: input.installer_team || null,
    warranty_terms: input.warranty_terms || null, warranty_duration: input.warranty_duration || null, warranty_start: input.warranty_start || null,
    signature_url: input.signature_url || null, warranty_form_url: input.warranty_form_url || null, photos: input.photos ?? [], feedback: input.feedback || null,
    item_installers: input.item_installers ?? [],
    item_photos: input.item_photos ?? [],
    status: stageStatus, notes: input.notes || null,
    completed_at: delivered ? new Date().toISOString() : null,
  };

  let id = input.id;
  // Guard against duplicate rows: the modal fires several SILENT auto-saves (on sign,
  // on form upload, on final save). Before those refresh the client's `it.id`, each
  // save came back here with no id → a fresh INSERT, leaving 2-3 installation rows per
  // order (and the loader could then show a stale "Installation" instead of the newest
  // "Delivered"). So if we weren't handed an id, look up an existing installation for
  // this order/delivery and UPDATE it instead of inserting a second one.
  if (!id && !input.force_new && (input.order_id != null || input.delivery_id != null)) {
    let q = supabase.from("installations").select("id").order("id", { ascending: false }).limit(1);
    q = input.delivery_id != null ? q.eq("delivery_id", input.delivery_id) : q.eq("order_id", input.order_id as number);
    const { data: existing } = await q;
    if (existing?.[0]?.id) id = existing[0].id;
  }
  // BAGO TUMAKBO ANG 0207 ay walang `item_photos` na column, at ang buong save
  // ay babagsak sa "column does not exist" — mawawalan ng paraan ang installer
  // na makapag-save. Kapag ganoon, isang beses itong sinusubukan muli nang wala
  // ang bagong field: nailigtas ang lahat ng ibang nakuha niya.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { item_photos: _ip, ...rowLegacy } = row;
  const missingCol = (m: string | undefined) => /item_photos/.test(m ?? "");
  if (id) {
    const before = await snapshot("installations", id);
    let { error } = await supabase.from("installations").update(row).eq("id", id);
    if (error && missingCol(error.message)) ({ error } = await supabase.from("installations").update(rowLegacy).eq("id", id));
    if (error) return { error: error.message };
    await auditAfter({ module: "installation", table: "installations", recordId: id, action: "update", before, snapshotTable: "installations", snapshotId: id });
  } else {
    let { data, error } = await supabase.from("installations").insert(row).select("id").limit(1);
    if (error && missingCol(error.message)) ({ data, error } = await supabase.from("installations").insert(rowLegacy).select("id").limit(1));
    if (error) return { error: error.message };
    id = data?.[0]?.id;
    if (id) await auditAfter({ module: "installation", table: "installations", recordId: id, action: "insert", snapshotTable: "installations", snapshotId: id });
  }
  if (!id) return { error: "Failed to save installation." };

  // Propagate the unified stage to the Delivery record (drives Sales Orders Status too),
  // so Delivery / Installation / Sales Orders never disagree. Sync whenever the
  // installation reached a stage past arrival — Delivered OR Installation — not only on
  // sign, so a Delivered install can't leave a stale "Arrived/Out for Delivery" on the
  // delivery. Only advances (never downgrades a row already Delivered).
  if ((delivered || signed) && (input.delivery_id || input.order_id)) {
    const delStatus = delivered ? "Delivered" : "Installation";
    const patch = delivered ? { status: delStatus, delivered_at: new Date().toISOString() } : { status: delStatus };
    const q = supabase.from("deliveries").update(patch).neq("status", "Delivered");
    if (input.delivery_id) await q.eq("id", input.delivery_id);
    else await q.eq("order_id", input.order_id as number);
    // NAIHATID = UMALIS NA ANG STOCK. Ang inventory_shipped ay itinatakda lang
    // ng startDelivery ("Out for Delivery"); ang pagkumpleto ng installation ay
    // hindi dumadaan doon, kaya nananatiling reserved ang naihatid na order.
    if (delivered && input.order_id != null) {
      const { shipOnDelivered } = await import("@/lib/orders/inventory");
      await shipOnDelivered(supabase, Number(input.order_id), null);
    }
    revalidatePath("/delivery");
    revalidatePath("/orders");
    revalidatePath("/operations/approval");
    revalidatePath("/operations/tracker");
  }

  // Sync the workshop job lifecycle: signed → "Installation"; delivered → "delivered".
  if (signed && input.order_id != null) {
    // PARTIAL DELIVERY (2026-09-02): huwag galawin ang mga job na nasa
    // production pa (ang susunod na batch na kaka-assign lang) - ang order-wide
    // na stamp noon ay bumubura sa kanila sa Pending ng workshop.
    await supabase.from("workshop_job").update({ status: delivered ? "delivered" : "Installation", updated_at: new Date().toISOString() }).eq("order_id", input.order_id)
      .or("qc_received_at.not.is.null,status.ilike.%qc passed%,status.ilike.%received%,status.ilike.%out for delivery%,status.ilike.%arrived%,status.ilike.%installation%,status.ilike.%delivered%");
    revalidatePath("/workshop/jobs");
    revalidatePath("/operations/tracker");
    revalidatePath("/operations/approval");
    revalidatePath("/workshop");
    revalidatePath("/quality-control");
  }

  // On Completed (with a signed warranty form), email the warranty certificate once.
  if (completed && input.warranty_form_url) {
    const { data: cur, error: curErr } = await supabase.from("installations").select("warranty_emailed_at").eq("id", id).maybeSingle();
    if (curErr) {
      // 0047 hindi pa tumatakbo sa live DB (42703) — WALANG dedupe stamp, kaya
      // huwag mag-email (mauulit ito bawat re-save). Patakbuhin muna:
      //   alter table public.installations add column if not exists warranty_emailed_at timestamptz;
    } else if (!cur?.warranty_emailed_at) {
      const sent = await sendWarrantyEmail(input.order_id, input.warranty_form_url);
      if (sent) await supabase.from("installations").update({ warranty_emailed_at: new Date().toISOString() }).eq("id", id);
    }
  }

  // Compile ALL documents in one place: append the signed warranty form to the order's
  // transaction_images so the receipt/ack/slip/warranty gallery (Sales Orders + PAN
  // Overall) shows everything in a single view. Idempotent — skip if already there.
  if (input.warranty_form_url && input.order_id != null) {
    const { data: ord } = await supabase.from("orders").select("transaction_images").eq("id", input.order_id).maybeSingle();
    const imgs = ((ord?.transaction_images as string[] | null) ?? []).filter(Boolean);
    if (!imgs.includes(input.warranty_form_url)) {
      await supabase.from("orders").update({ transaction_images: [...imgs, input.warranty_form_url] }).eq("id", input.order_id);
      revalidatePath("/orders");
    }
  }

  revalidatePath("/installation");
  return { ok: true, id };
}

export async function deleteInstallation(id: number): Promise<{ ok: true } | { error: string }> {
  await requireEdit("/installation", "installation");
  const supabase = createServerSupabase();
  // Walang status lock (2026-09-05): ang permission grid (requireEdit) ang gate.
  const before = await snapshot("installations", id);
  const { error } = await supabase.from("installations").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "installation", table: "installations", recordId: id, action: "delete", before });
  revalidatePath("/installation");
  revalidatePath("/delivery");
  return { ok: true };
}
