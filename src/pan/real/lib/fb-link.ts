// Facebook profile link → direct Messenger (m.me) link.
//
// Ang reps ang nag-paste ng profile URL (kahit anong anyo: facebook.com/username,
// web.facebook.com/profile.php?id=NNN, m.me/...) — dito hinuhugot ang username o
// numeric ID para makabuo ng m.me link na diretsong nagbubukas ng Messenger
// thread ng customer. Nagbabalik ng null kapag hindi mahugot nang ligtas
// (hal. group/page/share URL) — sa ganun, huwag magpakita ng Messenger link
// kaysa magbukas ng maling thread.
export function messengerLink(fbLink: string | null | undefined): string | null {
  const raw = (fbLink ?? "").trim();
  if (!raw) return null;

  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase();
  if (host === "m.me" || host.endsWith(".m.me")) return u.href;
  if (!/(^|\.)facebook\.com$/.test(host) && !/(^|\.)fb\.com$/.test(host)) return null;

  // INBOX LINK, HINDI PROFILE. Dalawang anyo ang naitatago sa fb_link kapag walang
  // manual na profile URL:
  //   • business.facebook.com/latest/inbox/...  → "latest" ang unang segment
  //   • www.facebook.com/<PAGE_ID>/inbox/<N>/…  → PAGE ID ang unang segment
  // Kung dadaan ang alinman sa segment logic sa ibaba: m.me/latest (patay) o
  // m.me/<PAGE_ID> (link sa PAGE MISMO, hindi sa customer — mas delikado, dahil
  // mukhang gumagana). Ang isFbThreadLink ang isahang pagsusuri.
  if (isFbThreadLink(raw)) return null;

  const segs = u.pathname.split("/").filter(Boolean);

  // web.facebook.com/profile.php?id=61585316402690 → m.me/61585316402690
  const id = u.searchParams.get("id");
  if (segs[0]?.toLowerCase() === "profile.php" && id && /^\d+$/.test(id)) {
    return `https://m.me/${id}`;
  }

  if (!segs.length) return null;
  const first = segs[0].toLowerCase();

  // facebook.com/people/Display-Name/61585316402690 → m.me/<numeric id>
  if (first === "people" && segs.length >= 3 && /^\d+$/.test(segs[segs.length - 1])) {
    return `https://m.me/${segs[segs.length - 1]}`;
  }

  // Mga path na HINDI profile — walang mabubuong tamang m.me mula rito.
  const nonProfile = new Set([
    "profile.php", "people", "groups", "pages", "marketplace", "watch", "events",
    "share", "story.php", "photo.php", "permalink.php", "messages", "reel", "hashtag",
  ]);
  if (nonProfile.has(first)) return null;

  // facebook.com/<username> → m.me/<username>
  return `https://m.me/${segs[0]}`;
}

// Ang fb_link ay maaaring PROFILE URL (manual na paste ng rep) o MESSENGER
// THREAD deep-link (awtomatikong nakuha sa Meta /conversations — ang PSID ay
// hindi mapupuntahang profile). Magkaiba ang dapat na label: ang "View Profile"
// sa isang inbox link ay nangangako ng bagay na hindi nito bubuksan.
export function isFbThreadLink(fbLink: string | null | undefined): boolean {
  const raw = (fbLink ?? "").trim();
  if (!raw) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    const fbHost = /(^|\.)facebook\.com$/.test(host);
    // Dalawang anyo: ang sariling-gawang business.facebook.com/...?thread_id=...
    // at ang MISMONG link ni Meta, www.facebook.com/<PAGE>/inbox/<N>/?section=messages
    // (ito ang tama — tingnan ang inbox_link sa migration 0151).
    return fbHost && /\/inbox\b|inbox/i.test(u.pathname + u.search);
  } catch {
    return false;
  }
}

// Tamang label para sa isang fb_link.
export function fbLinkLabel(fbLink: string | null | undefined): string {
  return isFbThreadLink(fbLink) ? "Open Chat" : "View Profile";
}

// Ang PSID ay HINDI mapupuntahang profile URL — nasukat 2026-08-08:
// facebook.com/<PSID> at m.me/<PSID> ay nagbabalik ng KAPAREHONG generic na
// pahina para sa tunay at sa gawa-gawang PSID (307,465 vs 307,460 bytes), kaya
// walang saysay ito. Ang GUMAGANANG deep-link ay ang Page inbox thread: ang
// `thread_id` (t_xxx) mula sa /conversations. Bubuksan nito ang mismong usapan
// sa Business Suite — doon makikita ng rep ang buong kasaysayan.
//
// Nasa lib (hindi sa fb-actions.ts) dahil ang huli ay "use server" file: LAHAT
// ng export doon ay dapat async server action, kaya ang sync helper ay bumabagsak
// sa build ("Server Actions must be async functions").
export function fbThreadUrl(threadId: string | null, pageId: string | null): string | null {
  const t = threadId?.trim();
  const p = pageId?.trim();
  if (!t || !p) return null;
  return `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(p)}&thread_id=${encodeURIComponent(t)}`;
}
