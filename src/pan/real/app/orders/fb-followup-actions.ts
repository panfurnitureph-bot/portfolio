"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { fbConfig } from "@/lib/fb/contacts";
import { sendFbMessage } from "@/lib/fb/notify";
import { auditAfter } from "@/lib/audit";

// FOLLOW-UP SA MESSENGER — pantulong sa sales team para sagutin ang mga
// kaka-chat na customer nang hindi na kailangang buksan ang Business Suite
// isa-isa.
//
// ⚠️ 24-ORAS NA BINTANA LANG. Ang Meta ay pumapayag lang mag-message sa taong
// nag-message sa Page sa loob ng huling 24 oras. Ang HUMAN_AGENT tag (7 araw)
// ay nasa sendFbMessage na PERO kailangan ng App Review approval bago umandar sa
// tunay na customer — kaya sa ngayon, 24h ang tunay na abot. Ang listahan mismo
// ay naka-filter sa 24h para hindi mag-alok ng imposible.
//
// ⚠️ HINDI ITO PANG-PROMO. Ipinagbabawal ni Meta ang promotional content sa
// labas ng bintana, at ang mga "Mark as spam" ay pwedeng magpasara ng Messenger
// access ng Page — mawawala ang bot, order echo, at PAID alerts. Follow-up sa
// tunay na usapan lang ang layunin nito.

const WINDOW_HOURS = 24;
// Ceiling kada padala — panangga sa aksidenteng blast at sa Vercel timeout.
// Sa ~700 contacts sa loob ng bintana, sapat na ito sa isang session ng sales.
const MAX_RECIPIENTS = 50;

export type FollowupTarget = { psid: string; name: string; lastMsg: string };

// Mga contact na KAYANG mensahehan NGAYON (loob ng 24h), pinakabago sa unahan.
// Ang 24h window ay mga ~700 contacts sa kasalukuyang dami ng chat (nasukat
// 2026-08-08: 672), kaya 1,000 ang cap — kasya ang BUONG bintana, at ang hanap sa
// modal ay umaabot sa lahat. Tatlong field lang kada row, kaya maliit ang payload.
export async function loadFollowupTargets(limit = 1000): Promise<FollowupTarget[]> {
  const me = await getSession();
  // Ginagamit din ito ng Formal Quotation Builder (parehong 24h na bintana, larawan
  // naman ang ipinapadala) — kaya alinman sa dalawang module ay sapat.
  if (!me || !(hasPermission(me, "orders", "edit") || hasPermission(me, "quotations", "edit"))) return [];
  const db = createServerSupabase();
  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  const { data } = await db
    .from("fb_contacts")
    .select("psid, name, last_message_at")
    .not("name", "is", null)
    .gte("last_message_at", since)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  return (data ?? [])
    .filter((r) => (r.name ?? "").trim() && r.last_message_at)
    .map((r) => ({ psid: r.psid as string, name: (r.name as string).trim(), lastMsg: r.last_message_at as string }));
}

export type FollowupResult = { sent: number; failed: number; skipped: number };

// Ipadala ang isang mensahe sa mga napiling PSID. Isa-isa (walang parallel) para
// hindi tumama sa rate limit ng Graph API. Ang bawat padala ay dumadaan sa
// sendFbMessage, kaya UPDATE muna at HUMAN_AGENT kapag sarado na ang bintana.
export async function sendFbFollowup(
  psids: string[],
  message: string,
): Promise<FollowupResult | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "orders", "edit")) return { error: "Not allowed." };

  const text = message.trim();
  if (!text) return { error: "Type a message first." };
  if (text.length > 1800) return { error: "Message is too long (max 1800 characters)." };

  const cfg = fbConfig();
  if (!cfg) return { error: "Facebook is not configured." };

  const unique = [...new Set(psids.filter(Boolean))];
  if (unique.length === 0) return { error: "Pick at least one customer." };
  if (unique.length > MAX_RECIPIENTS) return { error: `Too many at once — pick ${MAX_RECIPIENTS} or fewer.` };

  // I-verify SA SERVER na nasa loob pa ng bintana ang bawat napili. Ang listahan
  // sa browser ay maaaring luma na (nakabukas nang matagal), at ang padala sa
  // labas ng bintana ay basura lang na Graph call.
  const db = createServerSupabase();
  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  const { data: fresh } = await db
    .from("fb_contacts")
    .select("psid")
    .in("psid", unique)
    .gte("last_message_at", since);
  const allowed = new Set((fresh ?? []).map((r) => r.psid as string));

  let sent = 0;
  let failed = 0;
  const skipped = unique.length - allowed.size;

  for (const psid of unique) {
    if (!allowed.has(psid)) continue;
    const ok = await sendFbMessage(cfg.pageId, cfg.token, psid, { text }, "sales follow-up");
    if (ok) sent++;
    else failed++;
  }

  // Audit: ang mass-send ay kayang makaabot sa maraming customer, kaya kailangang
  // may talaan kung sino ang nagpadala at ilan ang natanggap. Dumadaan sa
  // auditAfter (ang standard ng repo) — best-effort, hindi humaharang.
  try {
    await auditAfter({
      module: "orders",
      table: "fb_contacts",
      recordId: `followup:${sent}/${unique.length}`,
      action: "update",
      snapshotId: null,
    });
  } catch { /* best-effort — huwag ipahamak ang padala */ }

  return { sent, failed, skipped };
}
