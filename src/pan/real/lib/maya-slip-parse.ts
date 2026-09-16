// Maya POS (PAX A920) slip field parser — pure, runs anywhere (used by the
// in-browser OCR). The slip layout is fixed; labels vary slightly between the
// "AMOUNT" and "SALE AMOUNT" print variants, both handled here.

export type MayaSlipFields = {
  amount: number | null;
  refNo: string | null;
  apprCode: string | null;
  dateTime: string | null;
  cardType: string | null;
  paymentChannel: string | null;
  cardNo: string | null; // last 4 digits only (the slip masks the rest)
  transType: string | null;
  merchantId: string | null;
  terminalId: string | null;
  batchNo: string | null;
  traceNo: string | null;
  networkRefNo: string | null;
  aid: string | null;
  cardholderName: string | null; // only present on some slip layouts
};

export type SlipScanResult = ({ ok: true; rawText: string } & MayaSlipFields) | { error: string };

// Digits OCR'd from thermal print often swap O↔0, l/I↔1, S↔5, B↔8.
const digitize = (s: string) => s.replace(/[Oo]/g, "0").replace(/[lI]/g, "1").replace(/S/g, "5").replace(/B/g, "8");

export function parseMayaSlip(text: string): MayaSlipFields {
  const t = text.replace(/\r/g, "");
  const grab = (re: RegExp): string | null => {
    const m = t.match(re);
    return m ? m[1].trim() : null;
  };
  // AMOUNT ₱48,414.00 — the peso sign OCRs as ₱/P/B/#/R, and the decimal point
  // often reads as a SPACE ("10,000 00") or vanishes. Capture the digit run after
  // AMOUNT loosely, then normalize: last 2 digits after a dot/space/comma = centavos.
  const amountRaw = grab(/AMOUNT[^\d\n]{0,12}([\d][\d,. ]{2,15})/i);
  let amount: number | null = null;
  if (amountRaw) {
    const cleaned = digitize(amountRaw).replace(/,/g, "").trim();
    const m2 = cleaned.match(/^(\d+)[. ](\d{2})$/);      // "10000 00" / "10000.00"
    const whole = m2 ? `${m2[1]}.${m2[2]}` : cleaned.replace(/[ .](?=\d{3,})/g, ""); // stray splits
    const n = parseFloat(whole);
    if (Number.isFinite(n) && n > 0) amount = Math.round(n * 100) / 100;
  }
  // Ref No: labeled read first; fallback = any standalone 12-digit run (the
  // reference is the only number that long on the slip — batch/trace are 6).
  // Maya refs are EXACTLY 12 digits; a shorter/longer read means the OCR dropped
  // or invented a digit, and a wrong reference is worse than none (disputes) —
  // reject it and let the photo be the proof.
  const refRaw =
    grab(/REF(?:ERENCE)?\.?\s*NO\.?\s*:?\s*([0-9OIlSB]{6,})/i) ??
    grab(/\b(\d{12})\b/);
  const refDigits = refRaw ? digitize(refRaw) : null;
  const refNo = refDigits && /^\d{12}$/.test(refDigits) ? refDigits : null;
  const apprCode = grab(/APPR\.?\s*CODE\s*:?\s*([A-Z0-9]{4,10})/i);
  // Date/Time: labeled read first; fallback = the 20XX/XX/XX pattern anywhere
  // (the printed value often lands on a neighboring OCR line, off its label).
  const dateTime =
    grab(/DATE\s*\/?\s*TIME\s*:?\s*([\d]{4}\/[\d]{2}\/[\d]{2}[^\n]*)/i) ??
    grab(/\b(20\d{2}\/\d{2}\/\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/);
  const cardType = grab(/CARD\s*TYPE\s*:?\s*([A-Z]+)/i);
  // Remaining slip fields — labeled reads, with shape fallbacks where the value
  // has a distinctive format that survives even when the OCR garbles its label.
  // Payment channel is one of a few known values — snap the OCR read to them
  // ("Credit Cad" → "Credit Card").
  const channelRaw = grab(/PAYMENT\s*CHANNEL\s*:?\s*([A-Za-z][A-Za-z ]{2,20})/i)?.trim() ?? null;
  const paymentChannel = channelRaw
    ? /CRED/i.test(channelRaw) ? "Credit Card"
      : /DEB/i.test(channelRaw) ? "Debit Card"
      : /MAYA|WALLET/i.test(channelRaw) ? "Maya Wallet"
      : /QR/i.test(channelRaw) ? "QR"
      // Just "Card" with no Credit/Debit keyword read: the App Label line usually
      // says which ("Debit Mastercard"/"Credit Visa") - check that before giving up.
      : /CARD$/i.test(channelRaw.trim())
        ? (grab(/APP\.?\s*LABEL\s*:?\s*(DEBIT|CREDIT)/i)?.toUpperCase() === "DEBIT" ? "Debit Card" : "Credit Card")
        : channelRaw
    : null;
  // Card number prints masked, but the mask run OCRs wildly (dots/stars, or
  // letters like "eesrenren"), and the trailing digit count varies (4 or 5) with
  // a trailing (C)/(D)/(1) tag that itself can misread. Take the LAST run of 4-5
  // digits on the CARD NO. line, regardless of what precedes it, and keep only
  // the last 4 (the true card suffix — a leading digit can leak from the mask).
  const cardNoLine = grab(/CARD\s*N[O0]\.?\s*([^\n]{0,40})/i);
  const cardNoRaw = cardNoLine?.match(/([\dOIlSB]{4,5})(?!.*[\dOIlSB]{4,5})/)?.[1] ?? null;
  const cardNo = cardNoRaw ? digitize(cardNoRaw).slice(-4) : null;
  // Trans type: labeled read, else the standalone keyword (its label and value sit
  // in different print columns and often split across OCR lines).
  const transType =
    grab(/TRANS\.?\s*TYPE\s*:?\s*(SALE|REFUND|VOID)\b/i)?.toUpperCase() ??
    grab(/\b(SALE|REFUND|VOID)\b/)?.toUpperCase() ?? null;
  // Maya merchant IDs are EFS + 9 digits — the prefix is a reliable anchor.
  const merchantRaw = grab(/MERCHANT\s*ID\.?\s*:?\s*([A-Z0-9]{8,14})/i) ?? grab(/\b(EF[S5][\dOIlSB]{9})\b/i);
  let merchantId: string | null = null;
  if (merchantRaw) {
    const em = merchantRaw.toUpperCase().match(/^EF[S5]([\dOIlSB]{9})$/);
    merchantId = em ? `EFS${digitize(em[1])}` : merchantRaw.toUpperCase();
  }
  // Terminal ID: labeled read, else the only standalone 8-digit run on the slip
  // (batch/trace are 6 digits, the reference is 12).
  const terminalIdRaw = grab(/TERMINAL\s*ID\.?\s*:?\s*([\dOIlSB]{6,10})\b/i) ?? grab(/\b(\d{8})\b/);
  const terminalId = terminalIdRaw ? digitize(terminalIdRaw) : null;
  const batchRaw = grab(/BATCH\s*NO\.?\s*:?\s*([\dOIlSB]{4,8})\b/i);
  const batchNo = batchRaw ? digitize(batchRaw) : null;
  const traceRaw = grab(/TRACE\s*NO\.?\s*:?\s*([\dOIlSB]{4,8})\b/i);
  const traceNo = traceRaw ? digitize(traceRaw) : null;
  // Some slip layouts print this as "TRANSACTION NO." instead of "NETWORK REF NO".
  const networkRefNo =
    grab(/NETWORK\s*REF\.?\s*NO\.?\s*:?\s*([A-Z0-9]{4,12})\b/i) ??
    grab(/TRANSACTION\s*NO\.?\s*:?\s*([A-Z0-9]{6,16})\b/i);
  // AID always starts A0000 (EMV registered application identifier).
  const aid = grab(/\bAID\s*:?\s*(A[\dOIlSB]{10,15})\b/i) ?? grab(/\b(A0{3,}\d{6,10})\b/);
  // Cardholder name: only some layouts print it, right after CARD NO. — a run of
  // 2+ capitalized words, not itself a label line (e.g. not "PLATA" alone, which
  // is a stray OCR artifact from the card network logo on some slips).
  const cardholderRaw = grab(/CARDHOLDER\s*NAME\s*:?\s*([A-Z][A-Z .'-]{3,40}[A-Z])\b/i);
  const cardholderName = cardholderRaw ? cardholderRaw.trim().replace(/\s+/g, " ") : null;
  return {
    amount: Number.isFinite(amount as number) ? amount : null,
    refNo, apprCode, dateTime, cardType,
    paymentChannel, cardNo, transType, merchantId, terminalId,
    batchNo, traceNo, networkRefNo, aid, cardholderName,
  };
}
