// Kinukuha ang Messenger handle mula sa Facebook URL na naka-set sa admin.
//
// Ang m.me ay humihingi ng page username o numeric ID lang — hindi buong URL.
// Nagbabalik ng null kung placeholder pa ang naka-set, para hindi tayo
// makapagpakita ng link papunta sa maling page.

export function messengerHandle(fbUrl?: string): string | null {
  if (!fbUrl) return null;
  const raw = fbUrl.trim();

  // Ang page na walang username ay ganito ang address:
  //   facebook.com/profile.php?id=61591301914870
  // Ang numero ang handle — tinatanggap ito ng m.me. Kailangan itong hulihin
  // BAGO ang paghahati sa "?", kung hindi ay "profile.php" ang matitira at
  // itatapon ito dahil may tuldok.
  const byId = raw.match(/[?&]id=(\d{5,})/);
  if (byId) return byId[1];

  // Numero lang ang ipinasok — page ID din yun.
  if (/^\d{5,}$/.test(raw)) return raw;

  const slug = raw
    .replace(/^https?:\/\//, "")
    .replace(/^(www\.|web\.|m\.)?facebook\.com\/?/, "")
    // Tinatanggap din ang m.me link — yun mismo ang gusto natin.
    .replace(/^m\.me\/?/, "")
    // facebook.com/people/<pangalan>/<id> at /pages/<pangalan>/<id> — ang id
    // ang gusto natin, hindi ang pangalan.
    .replace(/^(people|pages)\/[^/]+\/(?=\d)/, "")
    .replace(/^(people|pages)\//, "")
    .split(/[/?#]/)[0]
    .trim();

  // Ang natitirang domain (hal. "facebook.com") ay ibig sabihin walang page
  // na naka-set — hindi ito valid na handle.
  if (slug.length < 2 || slug.includes(".")) return null;
  return slug;
}

/** Buong m.me link. Ang `ref` ay ipinapasa sa page — doon nababasa ng bot. */
export function messengerUrl(handle: string, ref?: string): string {
  const base = `https://m.me/${handle}`;
  return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
}
