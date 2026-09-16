// IDENTITY NG ISANG LINYA NG ORDER — KASAMA ANG KULAY (Joe 2026-09-06,
// "iisang product pero magkakaiba ng color dapat partial pa"). Ang susi ng linya
// sa buong daloy ng paghahatid (readiness ng Delivery Queue, dq_items ng batch,
// lines_shipped, order_line_deliveries, Pickup Task, Installation) ay ang UNANG
// LINYA ng description lang noon — kaya ang tatlong Puto Seko Chair na
// magkakaiba ang leather ay iisang linya sa mata ng lahat: isang skip = handa
// ang tatlo, isang hatid = naihatid ang tatlo.
//
// Ngayon: `pangalan @ kulay` ang susi. Ang kulay ay mula sa `color` ng receipt
// line, o kapag wala, sa "• Fabric: …" / "• Color: …" na bullet ng description
// mismo — kaya ang workshop_job.item_desc, ops_line_skip.item_desc at
// warehouse_qc.ref_label (lahat ay buong description) ay may parehong susi
// nang hindi nangangailangan ng hiwalay na column.
//
// LEGACY: ang mga susing naitala bago ito (pangalan lang, walang " @ ") ay
// tumutugma pa rin sa alinmang kulay ng pangalang iyon — ang mga batch na nasa
// biyahe na ay hindi nasisira. Walang server import dito: ligtas sa client.

const SEP = " @ ";

export const lineName = (desc: string | null | undefined): string =>
  String(desc ?? "").split("\n")[0].trim().toLowerCase();

export const normColor = (c: string | null | undefined): string =>
  String(c ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// Kulay mula sa mga bullet ng description: "Fabric:", "Fabric / Finish:",
// "Upholstered Finish:", "Color:"/"Colour:". Ang walang label na bullet ay
// hindi hinuhulaan — pangalan lang ang susi kapag wala.
// Orihinal na sulat ("Leather BE20457") — pang-display; ang colorOfDesc ang
// pang-susi (lowercase).
export function colorLabelOfDesc(desc: string | null | undefined): string {
  const lines = String(desc ?? "").split("\n").slice(1);
  for (const raw of lines) {
    const b = raw.replace(/^\s*[•·-]\s*/, "").trim();
    const m = /^(?:Fabric(?:\s*\/\s*Finish)?|Upholstered Finish|Colou?r)\s*:\s*(.+)$/i.exec(b);
    if (m && m[1].trim()) return m[1].replace(/\s+/g, " ").trim();
  }
  return "";
}

export function colorOfDesc(desc: string | null | undefined): string {
  return normColor(colorLabelOfDesc(desc));
}

export function lineKey(desc: string | null | undefined, color?: string | null): string {
  const n = lineName(desc);
  if (!n) return "";
  const c = normColor(color) || colorOfDesc(desc);
  return c ? `${n}${SEP}${c}` : n;
}

// Pangalan lang mula sa alinmang susi (bago o legacy).
export const keyName = (key: string): string => {
  const k = String(key ?? "").trim().toLowerCase();
  const i = k.indexOf(SEP);
  return i >= 0 ? k.slice(0, i) : k;
};

export const keyColor = (key: string): string => {
  const k = String(key ?? "").trim().toLowerCase();
  const i = k.indexOf(SEP);
  return i >= 0 ? k.slice(i + SEP.length) : "";
};

// Set mula sa naitalang listahan (dq_items, lines_shipped) — lowercase, trimmed.
export function keySet(list: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(list)) return out;
  for (const x of list) { const k = String(x ?? "").trim().toLowerCase(); if (k) out.add(k); }
  return out;
}

export const joinKey = (name: string, color?: string | null): string => {
  const n = String(name ?? "").trim().toLowerCase();
  const c = normColor(color);
  return n ? (c ? `${n}${SEP}${c}` : n) : "";
};

// Nasa set ba ang susing ito?
//   • eksaktong susi (pangalan @ kulay) → oo
//   • legacy na susi (pangalan lang) sa set → oo, anumang kulay (dating asal)
//   • susing walang kulay, pero may "pangalan @ …" sa set → oo (ang naitala
//     ay mas tiyak kaysa sa tinatanong; iisang produkto pa rin iyon)
// `prefix` — para sa mga set na may "<order_id>|" sa unahan ng bawat susi.
export function hasKey(keys: ReadonlySet<string> | null | undefined, key: string, prefix = ""): boolean {
  if (!keys || !keys.size) return false;
  const k = String(key ?? "").trim().toLowerCase();
  if (!k) return false;
  if (keys.has(prefix + k)) return true;
  const n = keyName(k);
  if (k !== n) return keys.has(prefix + n);
  for (const x of keys) if (x.startsWith(prefix) && keyName(x.slice(prefix.length)) === n) return true;
  return false;
}

export function hasLine(keys: ReadonlySet<string> | null | undefined, desc: string | null | undefined, color?: string | null): boolean {
  return hasKey(keys, lineKey(desc, color));
}

export function hasOrderLine(keys: ReadonlySet<string> | null | undefined, orderId: number, desc: string | null | undefined, color?: string | null): boolean {
  return hasKey(keys, lineKey(desc, color), `${orderId}|`);
}
