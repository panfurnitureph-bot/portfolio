// Maya (PayMaya) Pay-with-QR (QR Ph) API — SERVER ONLY. Never import in a client component.
// Generates a REAL QR Ph payload (qrCodeBody, EMV "000201…") tied to the merchant —
// scannable by GCash / GoTyme / Maya / any QR Ph app, with the amount locked.
//   - Generate QR  → PUBLIC key   POST /payments/v1/qr/payments
//   - Read status  → SECRET key   GET  /payments/v1/payments/{id}
import "server-only";

const ENV = (process.env.MAYA_ENV || "sandbox").toLowerCase();
const BASE = ENV === "production" ? "https://pg.paymaya.com" : "https://pg-sandbox.paymaya.com";

const PUBLIC_KEY = process.env.MAYA_PUBLIC_KEY || "";
const SECRET_KEY = process.env.MAYA_SECRET_KEY || "";

// Fallback buyer contact for Vault charges. Maya rejects a card payment that
// carries no buyer.contact at all, and an order may have neither phone nor
// email — the store's own details keep the charge valid in that case.
const STORE_CONTACT_PHONE = process.env.STORE_CONTACT_PHONE || "09083991075";
const STORE_CONTACT_EMAIL = process.env.STORE_CONTACT_EMAIL || "panfurnitureph@gmail.com";

export function mayaConfigured(): boolean {
  return !!PUBLIC_KEY && !!SECRET_KEY && !/REPLACE_ME/.test(PUBLIC_KEY) && !/REPLACE_ME/.test(SECRET_KEY);
}

function basic(key: string): string {
  return "Basic " + Buffer.from(`${key}:`).toString("base64");
}

export type QrResult = { paymentId: string; qrCodeBody: string; redirectUrl: string };

// HANGGANAN NG MAYA (2026-08-28). Tinatanggihan ng Maya ang lampas dito
// (`code 2553: value must be at most 9999999`) at ang buong hiling ay bumabagsak
// — walang QR, walang email, at ang tanging nakikita ay isang API error na
// walang sinasabi sa nagpapasok ng presyo. Mas mabuting sabihin agad kung ano
// ang mali sa halagang naitala kaysa ipasa ito sa Maya para tanggihan.
const MAYA_MAX = 9_999_999;
const MAYA_REF_MAX = 36;

// Generate a dynamic QR Ph for an exact amount. Valid 1 hour, one-time use.
export async function createQrPayment(amount: number, reference: string): Promise<QrResult> {
  const value = Math.round(Number(amount) * 100) / 100;
  if (!(value > 0)) throw new Error("Maya QR needs an amount greater than zero.");
  if (value > MAYA_MAX) {
    throw new Error(`Maya cannot take ₱${value.toLocaleString("en-PH")} — the limit for one QR is ₱${MAYA_MAX.toLocaleString("en-PH")}. Check the charge on this RMA.`);
  }
  const ref = reference.slice(0, MAYA_REF_MAX);
  const body = { totalAmount: { value, currency: "PHP" }, requestReferenceNumber: ref };
  const res = await fetch(`${BASE}/payments/v1/qr/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: basic(PUBLIC_KEY) },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Maya createQrPayment ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as { paymentId?: string; qrCodeBody?: string; redirectUrl?: string };
  if (!json.paymentId || !json.qrCodeBody) throw new Error("Maya createQrPayment: missing paymentId/qrCodeBody");
  return { paymentId: json.paymentId, qrCodeBody: json.qrCodeBody, redirectUrl: json.redirectUrl || "" };
}

export type CheckoutResult = { checkoutId: string; redirectUrl: string };
export type CheckoutBuyer = { firstName?: string; lastName?: string; email?: string; phone?: string; line1?: string };

// Create a Maya Checkout session (hosted card/e-wallet page) for a fixed amount.
// PUBLIC key. The amount is locked. Passing buyer details pre-fills the Personal/
// Billing step so the customer goes straight to entering the card.
export async function createCheckout(amount: number, reference: string, urls: { success: string; failure: string; cancel: string }, buyer?: CheckoutBuyer): Promise<CheckoutResult> {
  const value = Math.round(Number(amount) * 100) / 100;
  const b = buyer || {};
  const body = {
    totalAmount: { value, currency: "PHP" },
    requestReferenceNumber: reference,
    redirectUrl: urls,
    buyer: {
      firstName: b.firstName || undefined,
      lastName: b.lastName || undefined,
      contact: (b.phone || b.email) ? { phone: b.phone || undefined, email: b.email || undefined } : undefined,
      billingAddress: b.line1 ? { line1: b.line1, countryCode: "PH" } : undefined,
    },
  };
  const res = await fetch(`${BASE}/checkout/v1/checkouts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: basic(PUBLIC_KEY) },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Maya createCheckout ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as { checkoutId?: string; redirectUrl?: string };
  if (!json.checkoutId || !json.redirectUrl) throw new Error("Maya createCheckout: missing checkoutId/redirectUrl");
  return { checkoutId: json.checkoutId, redirectUrl: json.redirectUrl };
}

export type CardChargeResult = { paymentId: string; status: string; isPaid: boolean; verificationUrl: string };

// Charge a tokenized card (Vault). SECRET key. Returns a verificationUrl when 3DS is
// required — the customer must complete it before the payment settles.
export async function createCardPayment(paymentTokenId: string, amount: number, reference: string, urls: { success: string; failure: string; cancel: string }, buyer?: CheckoutBuyer): Promise<CardChargeResult> {
  const value = Math.round(Number(amount) * 100) / 100;
  const b = buyer || {};
  const body = {
    paymentTokenId,
    totalAmount: { value, currency: "PHP" },
    requestReferenceNumber: reference,
    redirectUrl: urls,
    buyer: {
      firstName: b.firstName || undefined,
      lastName: b.lastName || undefined,
      // Maya REQUIRES buyer.contact on a Vault charge — omitting it fails the
      // whole payment with 2553 "contact is required". An order can legitimately
      // have neither a phone nor an email (walk-ins, website guests), so fall
      // back to the store's own contact rather than dropping the field.
      contact: {
        phone: b.phone || STORE_CONTACT_PHONE,
        email: b.email || STORE_CONTACT_EMAIL,
      },
      billingAddress: b.line1 ? { line1: b.line1, countryCode: "PH" } : undefined,
    },
  };
  const res = await fetch(`${BASE}/payments/v1/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: basic(SECRET_KEY) },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Maya createCardPayment ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as { id?: string; status?: string; isPaid?: boolean; verificationUrl?: string };
  if (!json.id) throw new Error("Maya createCardPayment: missing payment id");
  return { paymentId: json.id, status: json.status || "PENDING", isPaid: json.isPaid === true, verificationUrl: json.verificationUrl || "" };
}

export type PaymentStatus = { status: string; isPaid: boolean; amount: number; receiptNumber: string; issuer: string };

// Read a Checkout's status (SECRET key). Mirrors PaymentStatus shape.
export async function getCheckoutStatus(checkoutId: string): Promise<PaymentStatus> {
  const res = await fetch(`${BASE}/checkout/v1/checkouts/${encodeURIComponent(checkoutId)}`, {
    method: "GET",
    headers: { Authorization: basic(SECRET_KEY) },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Maya getCheckoutStatus ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as { paymentStatus?: string; status?: string; totalAmount?: { value?: number }; receiptNumber?: string; paymentScheme?: string; fundSource?: { type?: string; details?: { scheme?: string } } };
  const status = json.paymentStatus || json.status || "UNKNOWN";
  const scheme = json.paymentScheme || json.fundSource?.details?.scheme || json.fundSource?.type || "";
  return { status, isPaid: /PAYMENT_SUCCESS/i.test(status), amount: Number(json.totalAmount?.value) || 0, receiptNumber: json.receiptNumber || "", issuer: scheme };
}

// Read a payment's status. isPaid is the authoritative "money received" flag.
export async function getPaymentStatus(paymentId: string): Promise<PaymentStatus> {
  const res = await fetch(`${BASE}/payments/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    headers: { Authorization: basic(SECRET_KEY) },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Maya getPaymentStatus ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as { status?: string; isPaid?: boolean; amount?: string | number; receiptNumber?: string; fundSource?: { details?: { issuer?: string } } };
  const status = json.status || "UNKNOWN";
  return {
    status,
    isPaid: json.isPaid === true || /PAYMENT_SUCCESS/i.test(status),
    amount: Number(json.amount) || 0,
    receiptNumber: json.receiptNumber || "",
    issuer: json.fundSource?.details?.issuer || "",
  };
}
