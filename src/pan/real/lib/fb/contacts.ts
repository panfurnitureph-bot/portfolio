import { createServerSupabase } from "@/lib/supabase/server";

// Facebook Graph API version. Bump when Meta deprecates an older one.
const GRAPH = "https://graph.facebook.com/v21.0";

export type FbConfig = { pageId: string; token: string; verifyToken: string };

// Read the Page credentials from the environment. Returns null if not configured,
// so callers can fail softly (feature simply stays empty until env is set on Vercel).
export function fbConfig(): FbConfig | null {
  const pageId = process.env.FB_PAGE_ID?.trim();
  const token = process.env.FB_PAGE_ACCESS_TOKEN?.trim();
  const verifyToken = process.env.FB_VERIFY_TOKEN?.trim() || "";
  if (!pageId || !token) return null;
  return { pageId, token, verifyToken };
}

export type FbContactUpsert = {
  psid: string;
  name?: string | null;
  // Numerong tinipa mismo ng customer sa chat bubble (0174). Walang
  // ibinibigay na numero ang Messenger, kaya ito lang ang pinagmumulan.
  phone?: string | null;
  profilePic?: string | null;
  pageId?: string | null;
  threadId?: string | null;      // conversation id (t_xxx)
  // Ang MISMONG inbox link ni Meta ("/PAGE/inbox/<N>/?section=messages"). Ang <N>
  // ay HINDI ang thread_id at HINDI ang PSID — ibang identifier, kaya ang URL na
  // binubuo mula sa thread_id ay bumubukas sa MALING usapan (bug 2026-08-08).
  inboxLink?: string | null;
  lastMessageAt?: string | null; // ISO
};

// Upsert one or more contacts by PSID. Only overwrites name/pic when a non-empty
// value is supplied, so a webhook event without a name can't blank an existing one.
export async function upsertFbContacts(rows: FbContactUpsert[]): Promise<{ ok: true } | { error: string }> {
  const clean = rows.filter((r) => r.psid);
  if (clean.length === 0) return { ok: true };
  const db = createServerSupabase();

  // Fetch existing names so we don't clobber a good name with an empty one.
  const psids = clean.map((r) => r.psid);
  const { data: existing } = await db.from("fb_contacts").select("*").in("psid", psids);
  const prev = new Map((existing ?? []).map((e) => [e.psid as string, e as Record<string, unknown>]));
  // Ang `inbox_link` ay dagdag ng migration 0151 — kung hindi pa naitatakbo, huwag
  // itong isama sa payload (mabibigo ang BUONG upsert sa hindi kilalang column).
  const hasInboxLink = (existing ?? []).length === 0
    ? await (async () => { const { error } = await db.from("fb_contacts").select("inbox_link").limit(1); return !error; })()
    : Object.prototype.hasOwnProperty.call((existing ?? [])[0] ?? {}, "inbox_link");
  // Ganoon din ang `phone` (0174) — kapag hindi pa naitatakbo ang migration,
  // hindi ito isinasama, kung hindi ay babagsak ang BUONG upsert.
  const hasPhone = (existing ?? []).length === 0
    ? await (async () => { const { error } = await db.from("fb_contacts").select("phone").limit(1); return !error; })()
    : Object.prototype.hasOwnProperty.call((existing ?? [])[0] ?? {}, "phone");

  const now = new Date().toISOString();
  const payload = clean.map((r) => {
    const p = prev.get(r.psid);
    return {
      psid: r.psid,
      // Keep an existing good name/pic/thread if this event doesn't carry one.
      name: (r.name?.trim() || (p?.name as string | undefined)) ?? null,
      profile_pic: (r.profilePic?.trim() || (p?.profile_pic as string | undefined)) ?? null,
      thread_id: (r.threadId?.trim() || (p?.thread_id as string | undefined)) ?? null,
      ...(hasInboxLink ? { inbox_link: (r.inboxLink?.trim() || (p?.inbox_link as string | undefined)) ?? null } : {}),
      ...(hasPhone ? { phone: (r.phone?.trim() || (p?.phone as string | undefined)) ?? null } : {}),
      page_id: r.pageId ?? null,
      last_message_at: r.lastMessageAt ?? null,
      updated_at: now,
    };
  });

  const { error } = await db.from("fb_contacts").upsert(payload, { onConflict: "psid" });
  if (error) return { error: error.message };
  return { ok: true };
}

// Fetch the display name + profile pic for a single PSID. Best-effort — returns
// null on any failure so callers never break.
//
// ⚠️ KAILANGAN ng BUSINESS ASSET USER PROFILE ACCESS feature (App dashboard →
// Use cases → Messenger → Permissions and features → unang hanay), HINDI isang
// permission. Nalinaw ito 2026-08-08: ang `pages_read_engagement` ay NASA token
// na (never-expiring Page token) at BLOCKED pa rin ang endpoint — code 100/33 sa
// bawat field, pati `fields=id`. Sa LUMANG app (page 1223308547524374) ay
// gumagana ito, at ang error doon ngayon ay code 3 "Application does not have
// the capability" — malinaw na FEATURE ang kulang, hindi scope. Kontrol na
// pagsubok: ang `/PAGE/picture` ay gumagana, kaya buhay ang endpoint mismo.
//
// Ang GUMAGANANG paraan para sa PANGALAN ay /PAGE/conversations — kasama na ang
// participant name (tingnan ang fetchNamesFromConversations sa ibaba). Walang
// paraan para sa PICTURE hangga't hindi naidagdag ang feature sa itaas; ang
// `participants{picture}` ay tinatanggap ng Graph pero TAHIMIK na inaalis ang
// field (["name","email","id"] lang ang isinasagot).
export async function fetchFbName(psid: string, cfg: FbConfig): Promise<{ name: string | null; pic: string | null }> {
  try {
    const url = `${GRAPH}/${encodeURIComponent(psid)}?fields=name,profile_pic&access_token=${encodeURIComponent(cfg.token)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { name: null, pic: null };
    const j = (await res.json()) as { name?: string; profile_pic?: string };
    return { name: j.name ?? null, pic: j.profile_pic ?? null };
  } catch {
    return { name: null, pic: null };
  }
}

// Pangalan ng mga PSID mula sa /PAGE/conversations — ito ang tanging paraan na
// gumagana sa kasalukuyang scopes (`pages_messaging`). Hinahanap sa mga PINAKA-
// BAGONG thread, kaya sakto ito sa webhook: ang kaka-message lang ay nasa unahan.
// Best-effort: kung hindi makita ang isang PSID sa loob ng `maxPages`, null ito.
export async function fetchNamesFromConversations(
  psids: string[],
  cfg: FbConfig,
  maxPages = 3,
): Promise<Map<string, string>> {
  const want = new Set(psids);
  const found = new Map<string, string>();
  let next: string | null =
    `${GRAPH}/${cfg.pageId}/conversations?fields=participants&limit=100&access_token=${encodeURIComponent(cfg.token)}`;
  let page = 0;
  while (next && page < maxPages && found.size < want.size) {
    page++;
    try {
      const res = await fetch(next, { cache: "no-store" });
      const json = (await res.json()) as {
        data?: { participants?: { data?: { id?: string; name?: string }[] } }[];
        paging?: { next?: string };
      };
      if (!res.ok) return found;
      for (const conv of json.data ?? []) {
        for (const p of conv.participants?.data ?? []) {
          if (p.id && p.id !== cfg.pageId && want.has(p.id) && p.name?.trim()) found.set(p.id, p.name.trim());
        }
      }
      next = json.paging?.next ?? null;
    } catch {
      return found;
    }
  }
  return found;
}

// One-time (re-runnable) pull of ALL the Page's conversations → contacts. Paginates
// through every thread; each thread's non-page participant is a customer. Returns how
// many contacts were seen so the admin gets feedback. Safe to run repeatedly (upsert).
//
// ITO RIN ANG BACKFILL: ang webhook ay nakapag-imbak ng libo-libong PSID na
// walang pangalan noong per-PSID lookup pa ang gamit (naka-gate sa permission na
// wala sa app). Ang pass na ito ay may pangalan mula sa participants, kaya ang
// pagpapatakbo nito ang nagpupuno sa kanila. `named` = ilan ang may pangalan —
// ito ang bilang na tunay na lumalabas sa Create Order picker.
export async function pullAllFbConversations(cfg: FbConfig): Promise<{ synced: number; named: number; more: boolean } | { error: string }> {
  const db = createServerSupabase();
  const seen = new Map<string, FbContactUpsert>();
  // RESUME CURSOR: ang bawat run ay may 40s lang, at ang inbox ay 20,000+ thread —
  // kung tuwing pipindutin ay magsisimula sa unahan, hinding-hindi maaabot ang
  // dulo. Iniimbak ang paging cursor ng huling naabot na page sa app_settings at
  // dinudugtungan doon. Ang buong sync ay ilang pindot; ang webhook naman ang
  // nagpapasariwa sa bago.
  const CURSOR_KEY = "fb_sync_cursor";
  let startUrl: string | null = null;
  try {
    const { data } = await db.from("app_settings").select("value").eq("key", CURSOR_KEY).maybeSingle();
    const v = (data as { value?: unknown } | null)?.value;
    if (typeof v === "string" && v.startsWith("https://graph.facebook.com/")) startUrl = v;
  } catch { /* walang cursor pa — simula sa unahan */ }

  // participants gives {id (PSID), name}; updated_time orders recency.
  let next: string | null =
    startUrl ??
    `${GRAPH}/${cfg.pageId}/conversations?fields=participants,updated_time,link&limit=100&access_token=${encodeURIComponent(cfg.token)}`;

  // TIME BUDGET + INCREMENTAL SAVE. Ang inbox ng Page ay 20,000+ thread (nasukat
  // 2026-08-08: 200 pages = 345s at hindi pa tapos), pero ang server action ay
  // may 60s na hangganan sa Vercel — ang dating iisang upsert sa DULO ay nangangahulugang
  // ang isang timeout ay nagbubura ng LAHAT ng nahila. Ngayon: nag-upsert bawat
  // FLUSH_EVERY na page at humihinto sa BUDGET_MS, kaya ang bawat run ay nakatitipid
  // ng progreso. Ang /conversations ay sorted na by recency (pinakabago sa unahan),
  // kaya ang unang run ay nakukuha na ang mga PINAKA-AKTIBONG customer — at ang
  // muling pagpindot ay nagpapatuloy sa mas malalim (upsert = walang duplicate).
  const BUDGET_MS = 40_000;
  const FLUSH_EVERY = 10; // ~1,000 contacts per flush
  const started = Date.now();
  let guard = 0; // hard cap on pages to avoid an accidental infinite loop
  let saved = 0;
  let named = 0;
  const flush = async (): Promise<{ error: string } | null> => {
    const batch = [...seen.values()];
    if (!batch.length) return null;
    const r = await upsertFbContacts(batch);
    if ("error" in r) return r;
    saved += batch.length;
    named += batch.filter((x) => x.name?.trim()).length;
    seen.clear();
    return null;
  };
  // Itago (o burahin sa pagtatapos) ang cursor. Best-effort: kung bigo ito, ang
  // susunod na run ay magsisimula lang sa unahan — mabagal pero hindi mali.
  const saveCursor = async (url: string | null) => {
    try {
      await db.from("app_settings").upsert(
        { key: CURSOR_KEY, value: url, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    } catch { /* best-effort */ }
  };

  while (next && guard < 200) {
    guard++;
    let json: {
      data?: { id?: string; link?: string; participants?: { data?: { id?: string; name?: string }[] }; updated_time?: string }[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    try {
      const res = await fetch(next, { cache: "no-store" });
      json = await res.json();
      if (!res.ok || json.error) {
        // Panatilihin ang nahila na bago sumuko — mas mabuti ang bahagyang
        // pag-import kaysa mawala lahat sa isang Graph hiccup.
        await flush();
        if (saved > 0) return { synced: saved, named, more: true };
        return { error: json.error?.message || `Graph API error (${res.status})` };
      }
    } catch (e) {
      await flush();
      if (saved > 0) return { synced: saved, named, more: true };
      return { error: e instanceof Error ? e.message : "Graph API request failed." };
    }

    for (const conv of json.data ?? []) {
      const updated = conv.updated_time ?? null;
      const threadId = conv.id ?? null; // t_xxx
      // Ang MISMONG inbox link ni Meta. Kailangan ito: ang numero sa loob nito ay
      // ibang identifier — hindi ang thread_id — kaya ang sariling-gawang URL ay
      // bumubukas sa maling usapan.
      const inboxLink = conv.link ? `https://www.facebook.com${conv.link}` : null;
      for (const p of conv.participants?.data ?? []) {
        // Skip the Page itself (its id === pageId); keep the customer participant.
        if (!p.id || p.id === cfg.pageId) continue;
        const prev = seen.get(p.id);
        // Keep the most recent updated_time for this PSID.
        if (!prev || (updated && (!prev.lastMessageAt || updated > prev.lastMessageAt))) {
          seen.set(p.id, { psid: p.id, name: p.name ?? prev?.name ?? null, pageId: cfg.pageId, threadId, inboxLink, lastMessageAt: updated });
        }
      }
    }
    next = json.paging?.next ?? null;

    if (guard % FLUSH_EVERY === 0) {
      const err = await flush();
      if (err) return err;
    }
    if (Date.now() - started > BUDGET_MS) {
      const err = await flush();
      if (err) return err;
      // May natitira pa — itago ang cursor at sabihin sa admin na pindutin ulit.
      await saveCursor(next);
      return { synced: saved, named, more: !!next };
    }
  }

  const err = await flush();
  if (err) return err;
  // Naabot ang dulo (o ang 200-page guard): burahin ang cursor kung tapos na, o
  // itago ang huling posisyon kung ang guard ang tumama.
  await saveCursor(next);
  return { synced: saved, named, more: !!next };
}

// Punan ng profile_pic ang mga contact. Ang /conversations ay hindi nagbibigay ng
// pics, kaya per-PSID ang hingi — pero NAKA-GATE ito sa `pages_read_engagement`
// na wala sa app na ito, kaya sa ngayon ay pulos 400 ang isinasagot (nasukat
// 2026-08-08). HINDI na ito tinatawag ng Sync: sa 20,000 contacts, ang libong
// walang-saysay na request ang mismong nagpapa-timeout nito. Itinira para sa
// araw na maaprubahan ang permission. Ang monogram ang fallback ng picker.
export async function enrichFbProfilePics(rows: FbContactUpsert[], cfg: FbConfig): Promise<void> {
  // EARLY EXIT: kung ang unang batch ay pulos bigo, naka-gate ang endpoint —
  // huwag nang ubusin ang oras sa natitira.
  const CONCURRENCY = 6;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const got = await Promise.all(
      batch.map(async (row) => {
        const { pic } = await fetchFbName(row.psid, cfg);
        if (pic) row.profilePic = pic;
        return !!pic;
      }),
    );
    if (i === 0 && got.every((ok) => !ok)) return;
  }
}
