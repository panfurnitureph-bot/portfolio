// QR Ph (EMVCo) helpers — turn a static personal/merchant QR into a dynamic one
// carrying an exact amount. No payment API needed; we just rewrite the payload
// and recompute the CRC. Whether the wallet honors the amount depends on the
// QR type (merchant QR Ph is reliable; some personal QRs prompt for amount).

// Default payment QR (Maribank · JOE MARIE C.) — used when none is saved.
// Personal QR Ph (com.p2pqrpay): scannable cross-wallet, amount typed manually.
export const DEFAULT_PAYMENT_QR =
  "00020101021127580012com.p2pqrpay0111LAUIPHM2XXX0208999644030411113482729165204601653036085802PH5912JOE MARIE C.6009Pagsanjan63049508";

type TLV = { tag: string; val: string };

function parse(s: string): TLV[] {
  const out: TLV[] = [];
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2);
    const len = parseInt(s.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len)) break;
    const val = s.slice(i + 4, i + 4 + len);
    out.push({ tag, val });
    i += 4 + len;
  }
  return out;
}

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — the QR Ph checksum (tag 63).
export function crc16(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function serialize(fields: TLV[]): string {
  return fields.map((f) => f.tag + String(f.val.length).padStart(2, "0") + f.val).join("");
}

// Basic sanity check that a string looks like a QR Ph payload.
export function isQrPh(payload: string): boolean {
  const p = (payload ?? "").trim();
  return p.startsWith("000201") && /6304[0-9A-F]{4}$/i.test(p);
}

// Full validity: the embedded CRC (tag 63) must match a recompute. Catches
// corrupted payloads (e.g. spaces stripped) that would render an invalid QR.
export function crcValid(payload: string): boolean {
  const p = (payload ?? "").trim();
  const m = p.match(/^(.*6304)([0-9A-Fa-f]{4})$/);
  if (!m) return false;
  return crc16(m[1]).toUpperCase() === m[2].toUpperCase();
}

// Merchant QR Ph (P2M) supports a fixed amount; personal/P2P (com.p2pqrpay)
// does not — GCash rejects an injected amount on those.
export function isMerchant(payload: string): boolean {
  const p = (payload ?? "").toLowerCase();
  if (!p || p.includes("p2pqrpay")) return false; // personal GCash QR
  return p.includes("p2m") || p.includes("merchant");
}

// Return a new payload with the given amount embedded (dynamic QR).
export function qrWithAmount(payload: string, amount: number): string {
  const fields = parse(payload.trim()).filter((f) => f.tag !== "63");
  const set = (tag: string, val: string) => {
    const f = fields.find((x) => x.tag === tag);
    if (f) f.val = val; else fields.push({ tag, val });
  };
  set("01", "12"); // dynamic
  set("54", (Math.round((Number(amount) || 0) * 100) / 100).toFixed(2));
  fields.sort((a, b) => Number(a.tag) - Number(b.tag));
  const body = serialize(fields) + "6304";
  return body + crc16(body);
}
