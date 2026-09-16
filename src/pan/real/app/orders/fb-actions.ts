"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { fbConfig, pullAllFbConversations } from "@/lib/fb/contacts";
import { fbThreadUrl } from "@/lib/fb-link";

// One-time (re-runnable) pull of ALL the Page's Messenger conversations into
// fb_contacts. Admin-triggered from the Orders page. Requires orders-edit so only
// the sales team / admins can run it.
export async function syncFbContacts(): Promise<{ ok: true; synced: number; named: number; more: boolean; total: number } | { error: string }> {
  const me = await getSession();
  if (!me || !hasPermission(me, "orders", "edit")) return { error: "Not allowed." };

  const cfg = fbConfig();
  if (!cfg) return { error: "Facebook is not configured. Set FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN." };

  const r = await pullAllFbConversations(cfg);
  if ("error" in r) return { error: r.error };
  // Ibalik ang KABUUAN, hindi lang ang naidagdag ngayong run. Ang sync ay
  // sumusulong sa LUMA (may resume cursor), pero ang picker ay nagpapakita ng
  // PINAKABAGO — kaya mukhang "walang nangyari" kahit libo ang naidagdag. Ang
  // kabuuan ang nagpapakita ng tunay na progreso.
  const db = createServerSupabase();
  const { count } = await db.from("fb_contacts").select("psid", { count: "exact", head: true }).not("name", "is", null);
  return { ok: true, synced: r.synced, named: r.named, more: r.more, total: count ?? 0 };
}

// Load FB contacts for the Create Order picker (name search happens client-side over
// this list). Most-recent first; capped so a huge inbox doesn't bloat the payload.
// `lastMsg` = kailan HULING nag-message ang customer (ISO). Ito ang panangga sa
// pagkalito ng magkapangalan: walang profile pic na makukuha kay Meta (kailangan
// ng Business Asset User Profile Access — App Review + Tech Provider), pero
// nasa 30,209 sa 30,210 contacts ang huling petsa. Nasukat 2026-08-08: sa 30,210
// pangalan, 166 lang ang may kambal, at ang pinakamalaki ("Facebook user", 216)
// ay walang pangalan talaga sa Meta.
// Tanggapin LANG ang profile_url na mukhang URL. May "test" na nakalusot dito
// noon (manual na type sa order form, na-save pabalik) — lumalabas na "profile"
// badge at basurang link sa picker. Nilinis na ang datos 2026-08-09; ito ang
// pader para hindi na maulit. (Hindi exported — sa "use server" file, ang mga
// EXPORT lang ang kailangang async.)
function cleanProfileUrl(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return /^(https?:\/\/)?(www\.|web\.|m\.)?(facebook\.com|fb\.com|m\.me)\//i.test(s) ? s : null;
}

export type FbContact = { name: string; link: string | null; psid: string; pic: string | null; thread: string | null; lastMsg: string | null };
export async function loadFbContacts(limit = 500): Promise<FbContact[]> {
  const me = await getSession();
  if (!me || !hasPermission(me, "orders", "edit")) return [];
  const db = createServerSupabase();
  const { data } = await db
    .from("fb_contacts")
    .select("*")
    .not("name", "is", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? [])
    .filter((r) => (r.name ?? "").trim())
    .map((r) => ({
      name: (r.name as string).trim(),
      // A PSID can't be turned into a profile URL (Meta privacy), so there's no
      // auto profile link. We only carry one if a real profile URL was saved
      // manually for this contact (profile_url) — otherwise the rep pastes it.
      link: cleanProfileUrl(r.profile_url as string | null),
      psid: r.psid as string,
      pic: (r.profile_pic as string | null) ?? null,
      // Deep-link sa mismong Messenger thread — ito ang awtomatikong nakukuha.
      // Ang MISMONG inbox link ni Meta (inbox_link, migration 0151) ang tama.
      // Ang fbThreadUrl ay fallback para sa mga row na naipasok bago ang 0151 —
      // hindi ito bumubukas sa tamang usapan (ang numero sa link ni Meta ay ibang
      // identifier, hindi ang thread_id), kaya ang isang Sync ang magpupuno.
      thread: ((r as Record<string, unknown>).inbox_link as string | null)?.trim()
        || fbThreadUrl(r.thread_id as string | null, r.page_id as string | null),
      // Ang fb_contacts ay may mga sirang 1970-era na timestamp (legacy) —
      // itinatapon para hindi makapagpakita ng nakakalokong petsa.
      lastMsg: (() => {
        const v = r.last_message_at as string | null;
        return v && new Date(v).getFullYear() > 2000 ? v : null;
      })(),
    }));
}

// Server-side na paghahanap ng pangalan sa BUONG fb_contacts. Ang picker ay may
// preload na 500 na PINAKA-BAGO lang, pero ang inbox ng Page ay 20,000+ contacts
// (nasukat 2026-08-08) — ang lumang customer ay hindi na mahahanap sa client-side
// filter. Ito ang tinatawag habang nagta-type: ILIKE sa DB, kaya naaabot ang lahat.
export async function searchFbContacts(query: string, limit = 20): Promise<FbContact[]> {
  const me = await getSession();
  // Ang Quotations page ay gumagamit din ng picker na ito, at may sariling
  // permission key — kaya alinman sa dalawa ay sapat.
  if (!me || !(hasPermission(me, "orders", "edit") || hasPermission(me, "quotations", "edit"))) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  const db = createServerSupabase();
  // Escape ang wildcards ng LIKE para ang "50%" ay hanapin nang literal.
  const safe = q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const { data } = await db
    .from("fb_contacts")
    .select("*")
    .ilike("name", `%${safe}%`)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? [])
    .filter((r) => (r.name ?? "").trim())
    .map((r) => ({
      name: (r.name as string).trim(),
      link: cleanProfileUrl(r.profile_url as string | null),
      psid: r.psid as string,
      pic: (r.profile_pic as string | null) ?? null,
      // Ang MISMONG inbox link ni Meta (inbox_link, migration 0151) ang tama.
      // Ang fbThreadUrl ay fallback para sa mga row na naipasok bago ang 0151 —
      // hindi ito bumubukas sa tamang usapan (ang numero sa link ni Meta ay ibang
      // identifier, hindi ang thread_id), kaya ang isang Sync ang magpupuno.
      thread: ((r as Record<string, unknown>).inbox_link as string | null)?.trim()
        || fbThreadUrl(r.thread_id as string | null, r.page_id as string | null),
      // Ang fb_contacts ay may mga sirang 1970-era na timestamp (legacy) —
      // itinatapon para hindi makapagpakita ng nakakalokong petsa.
      lastMsg: (() => {
        const v = r.last_message_at as string | null;
        return v && new Date(v).getFullYear() > 2000 ? v : null;
      })(),
    }));
}
