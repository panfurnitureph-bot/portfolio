// PAGHAHATI NG MTO ECHO SA ILANG MENSAHE.
//
// Ang Messenger Send API ay tumatanggap lang ng 2,000 character kada mensahe.
// Ang sobra ay TINATANGGIHAN nang buo (error 100) at ang tanging bakas ay isang
// console.warn sa server — walang dumarating sa thread at walang nagsasabi
// kanino man. Ang echo ng walong produkto ay ~3,900 characters, kaya ang
// mahabang request ay "hindi nagse-send" habang ang maikli ay gumagana.
//
// Ang hati ay sa hangganan ng SEKSYON — ang header, ang bawat produkto, ang
// dulo — hindi sa gitna ng produkto: kapag naghiwalay ang kama at ang double
// walling nito sa dalawang mensahe, hulaan na kung alin ang kanino.

// May palugit sa 2,000: ang backtick wrapper, at ang mahahabang address o
// pangalan na hindi natin hawak ang haba.
export const ECHO_MSG_MAX = 1800;

// Hatiin ang body sa mga seksyon: ang bawat "N · PANGALAN" na titulo ng
// produkto ay nagsisimula ng bago; ang nauna sa unang titulo ay isang seksyon.
export function bodySections(body: string[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const ln of body) {
    if (/^\d+ · /.test(ln) && cur.length) {
      out.push(cur.join("\n").replace(/^\n+|\n+$/g, ""));
      cur = [];
    }
    cur.push(ln);
  }
  if (cur.length) out.push(cur.join("\n").replace(/^\n+|\n+$/g, ""));
  return out.filter((s) => s.length);
}

// Greedy: pagsamahin ang mga seksyon hangga't kasya. Ang seksyong mag-isa nang
// lampas sa limit ay ipinapadala nang mag-isa — mas mabuting maputol ng
// Messenger ang isang produkto kaysa tanggihan ang buong mensahe.
export function packMessages(sections: string[], max = ECHO_MSG_MAX): string[] {
  const msgs: string[] = [];
  let buf = "";
  for (const s of sections) {
    const joined = buf ? `${buf}\n\n${s}` : s;
    if (joined.length > max && buf) {
      msgs.push(buf);
      buf = s;
    } else buf = joined;
  }
  if (buf) msgs.push(buf);
  return msgs;
}
