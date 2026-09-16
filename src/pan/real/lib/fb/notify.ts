import { fbConfig } from "./contacts";
import { createServerSupabase } from "@/lib/supabase/server";
import { trackToken } from "@/lib/track-token";

// Nagpapadala ng alerto sa Messenger kapag may bagong bayad na order.
//
// Sa STAFF ito napupunta, hindi sa customer. Pinapayagan lang ng Meta ang
// pagpapadala sa isang tao kung nakipag-usap siya sa page sa loob ng 24 oras —
// ang bumili sa website nang hindi nagme-message ay hindi mame-message.
//
// Hindi rin pwedeng mag-message ang page sa sarili nito ("No matching user
// found"), kaya kailangan ng PSID: ang id ng isang taong nag-message sa page.
// Kinukuha natin ito sa FB_ALERT_PSID, o kung wala, sa pinakahuling nag-message
// (naka-sync sa fb_contacts) — karaniwang ang may hawak ng inbox.
//
// Kailangan sa env: FB_PAGE_ID at FB_PAGE_ACCESS_TOKEN. Kapag wala, tahimik
// itong hindi tumatakbo — hindi dapat mabigo ang isang bayad dahil dito.

const GRAPH = "https://graph.facebook.com/v21.0";

const peso = (n: number) =>
  "PHP " + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── 24-ORAS NA BINTANA NI META, AT ANG LUSOT ─────────────────────────────────
// Ang page ay makakapagpadala lang sa isang tao kung nag-message siya sa loob ng
// huling 24 ORAS. Lampas doon: error #10 / subcode 2018278.
//
// Nasukat 2026-08-08 sa live API kung alin ang tunay pang gumagana:
//   • messaging_type=UPDATE ....... 24h lang
//   • tag=HUMAN_AGENT ............. TINATANGGAP (umabot sa recipient validation,
//                                   subcode 2018001 — hindi tag rejection) →
//                                   7 ARAW na bintana
//   • tag=POST_PURCHASE_UPDATE .... subcode 1893061 "Invalid parameter" = PATAY
//   • tag=ACCOUNT_UPDATE .......... subcode 1893061 = PATAY
//   • tag=CONFIRMED_EVENT_UPDATE .. subcode 1893061 = PATAY
//
// Kaya: subukan ang UPDATE; kapag sarado na ang bintana, ulitin nang may
// HUMAN_AGENT (7 araw). Ang HUMAN_AGENT ay para sa TAO na sumasagot sa customer
// — tugma ito sa gamit natin (order/payment/delivery updates ng sales team), pero
// nangangailangan ng App Review approval ("Human Agent" feature) bago tuluyang
// umandar sa Live mode. Habang hindi pa aprubado, tahimik itong bumabagsak at
// ang EMAIL + FCM push ang garantisadong daan.
const WINDOW_CLOSED_SUBCODES = new Set([2018278, 2018108, 1545041]);

function windowClosed(body: string): boolean {
  try {
    const j = JSON.parse(body) as { error?: { code?: number; error_subcode?: number; message?: string } };
    const e = j.error ?? {};
    if (e.error_subcode && WINDOW_CLOSED_SUBCODES.has(e.error_subcode)) return true;
    // Ang code #10 na walang subcode ay ang klasikong "outside the window".
    if (e.code === 10) return true;
    return /outside.*(allowed|24).*window|24[- ]hour|messaging window/i.test(e.message ?? "");
  } catch {
    return false;
  }
}

// Isahang daan para sa LAHAT ng Messenger send: UPDATE muna, tapos HUMAN_AGENT
// kapag sarado ang 24h window. Nagbabalik ng kung nakalusot ba — para makapili
// ang caller ng ibang daan (email/FCM) kapag hindi.
export async function sendFbMessage(
  pageId: string,
  token: string,
  psid: string,
  message: unknown,
  label = "fb send",
): Promise<boolean> {
  const post = (extra: Record<string, unknown>) =>
    fetch(`${GRAPH}/${pageId}/messages?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: psid }, message, ...extra }),
      signal: AbortSignal.timeout(10000),
    });

  try {
    let res = await post({ messaging_type: "UPDATE" });
    if (res.ok) return true;
    const body = await res.text();
    if (!windowClosed(body)) {
      console.warn(`[fb/notify] ${label} failed:`, res.status, body.slice(0, 300));
      return false;
    }
    // Sarado ang 24h — subukan ang 7-araw na HUMAN_AGENT.
    res = await post({ messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });
    if (res.ok) return true;
    console.warn(`[fb/notify] ${label} outside 24h and HUMAN_AGENT rejected:`, res.status, (await res.text()).slice(0, 300));
    return false;
  } catch (e) {
    console.warn(`[fb/notify] ${label} error:`, e instanceof Error ? e.message : e);
    return false;
  }
}

export type AlertItem = {
  // Buong description mula sa order — pangalan sa unang linya, tapos bullet
  // bawat detalye (kulay, sukat, frame dimensions).
  description: string;
  qty: number;
  price: number;
  // Kailangang PUBLIC na https: kinukuha ito ng Meta sa server nila.
  image?: string | null;
  // Slug ng produkto sa katalogo — para sa link sa website product page,
  // nang makita agad ng sales kung tama ang produkto.
  slug?: string | null;
};

export type OrderAlert = {
  orderNumber: string;
  customer: string;
  items: AlertItem[];
  total: number;
  paid: number;
  balance: number;
  address?: string | null;
  paidVia?: string | null;
  // Ang resibo na ipinadala sa customer (BIR invoice) — isasabit din sa inbox
  // para makita agad. Public https, kung hindi ay laktawan.
  receiptUrl?: string | null;
  // Petsa ng order + naka-schedule na delivery, para maipakita ang estimate na
  // katulad ng sa tracker. Kung wala ang schedule, 4–6 linggo mula sa order.
  placedAt?: string | null;
  scheduledFor?: string | null;
};

// Kailan darating — kaparehong lohika ng tracker (deliveryLine). Naka-schedule?
// yun ang petsa. Kung hindi, tinatantya mula sa order date + 4–6 linggo.
function deliveryEstimate(placedAt?: string | null, scheduledFor?: string | null): string | null {
  if (scheduledFor) {
    const d = new Date(scheduledFor);
    if (!isNaN(d.getTime())) {
      return "🚚 Scheduled: " + d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
    }
  }
  if (!placedAt) return null;
  const from = new Date(placedAt);
  if (isNaN(from.getTime())) return null;
  const a = new Date(from); a.setDate(a.getDate() + 4 * 7);
  const b = new Date(from); b.setDate(b.getDate() + 6 * 7);
  const mon = (d: Date) => d.toLocaleDateString("en-PH", { month: "long" });
  const range =
    mon(a) === mon(b)
      ? `${mon(a)} ${a.getDate()}–${b.getDate()}`
      : `${mon(a)} ${a.getDate()} – ${mon(b)} ${b.getDate()}`;
  return `🚚 Estimated delivery: ${range}`;
}

// Saan tumuturo ang "View Order on Website" na buton. Kailangang maabot ito
// mula sa labas — hindi gagana ang localhost sa Messenger.
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://panfurnitures.cloud").replace(/\/+$/, "");
const isPublic = (u: string) => /^https:\/\//i.test(u) && !/localhost|127\.0\.0\.1/i.test(u);

// Kanino ipapadala. Ang naka-set na PSID ang mananaig; kung wala, ang
// pinakahuling nag-message sa page — siya ang malamang na nakabantay.
async function alertRecipient(): Promise<string | null> {
  const fixed = process.env.FB_ALERT_PSID?.trim();
  if (fixed) return fixed;
  try {
    const db = createServerSupabase();
    const { data } = await db
      .from("fb_contacts")
      .select("psid")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.psid as string) ?? null;
  } catch {
    return null;
  }
}

// PAID receipt papunta sa MISMONG customer thread (customer_psid galing sa
// "CHAT WITH US NOW" ref — migration 0135). Kita rin ito ng staff sa page
// inbox, kaya nagsisilbing feed din. Best-effort: sakop pa rin ng Meta 24h
// window, pero kadalasang bukas ito dahil kaka-click lang nila sa checkout.
export async function notifyCustomerPaid(
  psid: string,
  o: { orderNumber: string; paid: number; balance: number; total: number; trackUrl?: string | null },
): Promise<void> {
  const cfg = fbConfig();
  if (!cfg || !psid) return;
  const lines = [
    `💰 Payment received — ${o.orderNumber}`,
    "",
    `Paid:    ${peso(o.paid)}`,
    o.balance > 0 ? `Balance: ${peso(o.balance)} (due before delivery)` : "Fully paid ✓",
    "",
    "Your order is moving to production — we'll email your receipt and delivery updates.",
    o.trackUrl ? `\n🔗 Track your order: ${o.trackUrl}` : "",
  ].filter(Boolean).join("\n");
  await sendFbMessage(cfg.pageId, cfg.token, psid, { text: lines }, "customer paid msg");
}

// Messenger echo pagka-CONFIRM ng customer sa delivery date — papunta sa
// customer thread (customer_psid). Best-effort, sakop ng Meta 24h window.
export async function notifyCustomerDeliveryConfirmed(
  psid: string,
  o: { orderNumber: string; dateLabel: string; address?: string | null; balance: number },
): Promise<void> {
  const cfg = fbConfig();
  if (!cfg || !psid) return;
  const lines = [
    `📦 Delivery confirmed — ${o.orderNumber}`,
    "",
    `🗓 ${o.dateLabel}`,
    o.address ? `📍 ${o.address}` : "",
    o.balance > 0 ? `💰 Balance due on delivery: ${peso(o.balance)}` : "Fully paid ✓",
    "",
    "Thank you! Our team will deliver on the confirmed date — a reminder will be sent as it approaches.",
  ].filter(Boolean).join("\n");
  await sendFbMessage(cfg.pageId, cfg.token, psid, { text: lines }, "delivery-confirmed msg");
}

export async function notifyPageNewOrder(o: OrderAlert): Promise<void> {
  const cfg = fbConfig();
  if (!cfg) return; // hindi pa naka-set — walang gagawin

  const to = await alertRecipient();
  if (!to) return; // walang mapagpadalhan — walang nag-message pa sa page

  // Ang subtitle ng card — mahigpit ang limitasyon ng Messenger (~80 char bago
  // maputol), kaya ang pinakamahalaga lang: bayad, balanse, unang produkto.
  const money =
    o.balance > 0
      ? `${peso(o.paid)} paid · ${peso(o.balance)} balance`
      : `${peso(o.paid)} · FULLY PAID`;
  // Pangalan lang ng unang produkto sa subtitle — makitid ang card.
  const firstName = o.items[0]?.description.split("\n")[0].trim() ?? "";
  const what = firstName + (o.items.length > 1 ? ` +${o.items.length - 1}` : "");
  const subtitle = [o.customer, what, money].filter(Boolean).join("\n");

  // Mga link. Ang "View Order on Website" na BUTON ay hindi tumatanggap ng
  // localhost (tinatanggihan ng Messenger), pero ang PLAIN TEXT ay oo — kaya
  // inuulit natin ang link sa detail message para gumana kahit local.
  const storeUrl = (process.env.NEXT_PUBLIC_STORE_URL || "").replace(/\/+$/, "");
  // Kasama ang lagdang token para bumukas agad ang tracker nang walang verify —
  // para sa staff/customer na tumatanggap ng alerto.
  const tok = trackToken(o.orderNumber);
  const trackUrl = storeUrl
    ? `${storeUrl}/track?order=${encodeURIComponent(o.orderNumber)}${tok ? `&t=${tok}` : ""}`
    : `${APP_URL}/orders?q=${encodeURIComponent(o.orderNumber)}`;
  // Product link — para makita agad ng sales kung tama ang produkto.
  const firstSlug = o.items.find((it) => it.slug)?.slug ?? null;
  const productUrl = firstSlug && storeUrl ? `${storeUrl}/products/${firstSlug}` : null;

  // Ang buong breakdown ay sa sumusunod na text message — walang hangganan
  // doon, kaya kasama ang kulay, sukat, at frame dimensions ng bawat item.
  const detail = [
    `📋 ${o.orderNumber} — ${o.customer}`,
    "",
    ...o.items.flatMap((it) => {
      const lines = it.description.split("\n").map((l) => l.trim()).filter(Boolean);
      const name = lines[0] ?? "";
      const specs = lines.slice(1).map((l) => l.replace(/^[•·-]\s*/, ""));
      return [
        `▪ ${it.qty > 1 ? `${it.qty}× ` : ""}${name}${it.price ? `  —  ${peso(it.price * it.qty)}` : ""}`,
        ...specs.map((s) => `     ${s}`),
        "",
      ];
    }),
    `Total:   ${peso(o.total)}`,
    `Paid:    ${peso(o.paid)}${o.paidVia ? ` (${o.paidVia})` : ""}`,
    o.balance > 0 ? `Balance: ${peso(o.balance)}` : "Fully paid",
    (() => {
      const est = deliveryEstimate(o.placedAt, o.scheduledFor);
      return est ? `\n${est}` : "";
    })(),
    o.address ? `📍 ${o.address}` : "",
    "",
    `🔗 Track order: ${trackUrl}`,
    productUrl ? `🛏️ Product: ${productUrl}` : "",
  ].filter(Boolean).join("\n");

  // Ang hindi maabot na URL (localhost) ay tinatanggal — tinatanggihan ito ng
  // Messenger, at mawawala ang buong mensahe.
  // Ang buton at ang tap-action ay sa WEBSITE tracker lang — hindi sa IMS.
  // Kapag localhost/IMS pa lang ang URL (walang public na website), WALANG
  // buton at WALANG default_action, para hindi ma-expose ang pan-furnitures
  // na admin URL sa customer-facing na inbox.
  const onWebsite = !!storeUrl && isPublic(trackUrl) && trackUrl.startsWith(storeUrl);
  const buttons = onWebsite
    ? [{ type: "web_url", url: trackUrl, title: "View Order on Website" }]
    : [];

  const firstImage = o.items.find((it) => it.image && isPublic(it.image))?.image;

  const card = {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [
          {
            title: `💰 PAID — ${o.orderNumber}`,
            subtitle,
            ...(firstImage ? { image_url: firstImage } : {}),
            ...(onWebsite
              ? { default_action: { type: "web_url", url: trackUrl, webview_height_ratio: "full" } }
              : {}),
            ...(buttons.length ? { buttons } : {}),
          },
        ],
      },
    },
  };

  // Dumadaan sa sendFbMessage: UPDATE muna, HUMAN_AGENT (7 araw) kapag sarado na
  // ang 24h window. Best-effort pa rin ang Messenger alert — ang GARANTISADONG
  // alerto ay ang FCM push (notifyPaymentReceived) na kasabay nitong pinapadala.
  const send = (message: unknown) => sendFbMessage(cfg!.pageId, cfg!.token, to, message, "staff alert");

  try {
    // 1) Card — larawan, buod, at mga buton.
    const ok = await send(card);
    if (!ok) {
      // Kung pumalya (hal. hindi maabot ang larawan), plain text pa rin —
      // mas mabuti ang payat na alerto kaysa walang alerto.
      const links = [isPublic(trackUrl) ? trackUrl : "", storeUrl && isPublic(storeUrl) ? storeUrl : ""]
        .filter(Boolean)
        .join("\n");
      await send({ text: `💰 PAID — ${o.orderNumber}\n\n${detail}${links ? `\n\n${links}` : ""}` });
      return;
    }

    // 2) Buong breakdown — kulay, sukat, frame dimensions, presyo bawat item.
    await send({ text: detail });

    // 3) Ang mga larawan ng produkto bilang tunay na attachment — mas malaki
    //    kaysa sa card. Hanggang tatlo para hindi bumaha ang thread.
    for (const it of o.items.filter((x) => x.image && isPublic(x.image)).slice(0, 3)) {
      await send({
        attachment: { type: "image", payload: { url: it.image, is_reusable: true } },
      });
    }

    // 4) Ang resibong ipinadala sa customer — para makita ng staff kung ano ang
    //    natanggap ng bumili.
    if (o.receiptUrl && isPublic(o.receiptUrl)) {
      await send({ text: "🧾 Receipt sent to the customer:" });
      await send({
        attachment: { type: "image", payload: { url: o.receiptUrl, is_reusable: true } },
      });
    }
  } catch (e) {
    // Hindi dapat mabigo ang pagtala ng bayad dahil lang sa alerto.
    console.warn("[fb/notify] alert error:", e instanceof Error ? e.message : e);
  }
}

// ── BAGONG MTO REQUEST → STAFF THREAD ────────────────────────────────────────
// Ang echo ng build sa customer thread ay nangyayari LANG kapag binuksan ng
// customer ang m.me link — maraming hindi nagbubukas, at ang kanilang request
// ay nasa MTO Requests lang, walang bakas sa Messenger. Ang alertong ito ay
// ipinapadala AGAD sa staff thread (FB_ALERT_PSID, gaya ng payment alerts) sa
// sandaling dumating ang request, buksan man ng customer ang Messenger o hindi.
//
// EKSAKTONG PAREHONG SHEET ng customer echo (lib/fb/mto-sheet.ts): larawan
// muna, tapos ang naka-kahong sheet, hati sa hangganan ng produkto. Walang
// dagdag na link o buod — "eto ung standard natin."
export async function notifyPageNewMtoRequest(row: import("./mto-sheet").MtoSheetRow): Promise<void> {
  const cfg = fbConfig();
  if (!cfg) return;
  const to = await alertRecipient();
  if (!to) return;

  try {
    const { buildMtoSheet, isPublicUrl } = await import("./mto-sheet");
    if (row.image_url && isPublicUrl(row.image_url)) {
      await sendFbMessage(cfg.pageId, cfg.token, to, { attachment: { type: "image", payload: { url: row.image_url, is_reusable: true } } }, "mto staff alert image");
    }
    for (const m of buildMtoSheet(row)) {
      await sendFbMessage(cfg.pageId, cfg.token, to, { text: "```\n" + m + "\n```" }, "mto staff alert");
    }
  } catch (e) {
    // Hindi dapat mabigo ang pagtanggap ng request dahil lang sa alerto.
    console.warn("[fb/notify] mto alert error:", e instanceof Error ? e.message : e);
  }
}
