// MAYA CARD TOKENIZATION — BROWSER ONLY
//
// Ang card number ay ipinapadala nang DIRETSO sa Maya mula sa browser, hindi
// dumadaan sa server natin. Iyon ang buong punto: nananatili tayong PCI-DSS
// SAQ-A dahil walang raw PAN na humahawak ang ating infrastructure.
//
// Ang ibinabalik ay isang paymentTokenId — isang beses lang magagamit, may
// maikling buhay. Ipinapasa natin iyon sa server, at doon sinisingil gamit ang
// SECRET key (server-side). Ang PUBLIC key ay ligtas na mailantad sa browser;
// wala itong kakayahang mag-charge nang mag-isa.

const ENV = (process.env.NEXT_PUBLIC_MAYA_ENV || "sandbox").toLowerCase();

const BASE =
  ENV === "production"
    ? "https://pg.paymaya.com"
    : "https://pg-sandbox.paymaya.com";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_MAYA_PUBLIC_KEY || "";

export function tokenizerReady(): boolean {
  return !!PUBLIC_KEY && !/REPLACE_ME/.test(PUBLIC_KEY);
}

export type CardInput = {
  number: string;
  expMonth: string;
  expYear: string;
  cvc: string;
};

/**
 * Pinapalitan ang card details ng isang gamit-minsang paymentTokenId.
 *
 * Nagta-throw na may mensaheng maipapakita sa customer kapag tinanggihan ng
 * Maya ang card (hal. maling numero, expired). Hindi natin ini-log ang card.
 */
export async function tokenizeCard(card: CardInput): Promise<string> {
  if (!tokenizerReady()) {
    throw new Error("Card payments are not configured. Please use QR instead.");
  }

  const res = await fetch(`${BASE}/payments/v1/payment-tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // PUBLIC key — ligtas sa browser. Hindi ito makakapag-charge.
      Authorization: "Basic " + btoa(`${PUBLIC_KEY}:`),
    },
    body: JSON.stringify({
      card: {
        number: card.number.replace(/\s+/g, ""),
        expMonth: card.expMonth.padStart(2, "0"),
        // Tinatanggap ang "26" o "2026"
        expYear:
          card.expYear.length === 2 ? `20${card.expYear}` : card.expYear,
        cvc: card.cvc,
      },
    }),
  });

  const text = await res.text();
  let json: { paymentTokenId?: string; message?: string; error?: string } = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* hindi JSON — hahawakan sa ibaba */
  }

  if (!res.ok) {
    // Ipakita ang dahilan ng Maya kung mababasa; kung hindi, generic.
    throw new Error(
      json.message ||
        json.error ||
        "We couldn't verify that card. Please check the details and try again.",
    );
  }
  if (!json.paymentTokenId) {
    throw new Error("Card verification failed. Please try again.");
  }
  return json.paymentTokenId;
}

// ---------- Mga pantulong sa form ----------

/** "4123456789012345" → "4123 4567 8901 2345" habang nagta-type. */
export function formatCardNumber(v: string): string {
  const digits = v.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

/** Luhn check — nahuhuli ang typo bago pa tayo tumawag sa Maya. */
export function luhnValid(v: string): boolean {
  const digits = v.replace(/\D/g, "");
  if (digits.length < 13) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Brand mula sa unang digit — pang-display lang. */
export function cardBrand(v: string): string {
  const d = v.replace(/\D/g, "");
  if (/^4/.test(d)) return "Visa";
  if (/^5[1-5]/.test(d) || /^2[2-7]/.test(d)) return "Mastercard";
  if (/^3[47]/.test(d)) return "Amex";
  if (/^6/.test(d)) return "Discover";
  return "";
}

/** Tinatanggihan ang nakaraang buwan/taon bago tumawag sa Maya. */
export function expiryValid(mm: string, yy: string, now = new Date()): boolean {
  const m = Number(mm);
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  const y = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  if (!Number.isInteger(y)) return false;
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  if (y < curY) return false;
  if (y === curY && m < curM) return false;
  return y <= curY + 25;
}
