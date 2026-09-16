"use client";

// CARD FORM — Maya Payment Vault
//
// Ang card ay tino-tokenize sa browser (tingnan ang lib/maya-tokenize.ts), kaya
// ang card number ay hindi kailanman dumadaan sa server natin. Ang ipinapasa
// lang natin sa server ay ang gamit-minsang paymentTokenId.
//
// Kapag hiningi ng bangko ang 3DS, may ibabalik na verification_url ang server
// at doon natin ipapadala ang customer. Wala tayong kontrol doon — ang bangko
// ang nagpapasya kung kailan kailangan ang OTP.

import { useState } from "react";
import {
  tokenizeCard,
  formatCardNumber,
  luhnValid,
  cardBrand,
  expiryValid,
} from "@/lib/maya-tokenize";

const peso = (n: number) =>
  "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CardForm({
  amount,
  orderId,
  orderNumber,
  onPaid,
  onFallback,
}: {
  /** Halagang sisingilin — pang-display lang. Ang server ang muling kumakalkula. */
  amount: number;
  /** Order id sa app — doon hinahanap ng server ang totoong halaga. */
  orderId: string;
  orderNumber: string;
  onPaid: () => void;
  /** Tinatawag kapag hindi available ang Vault — bumabalik sa hosted page. */
  onFallback?: () => void;
}) {
  const [number, setNumber] = useState("");
  const [mm, setMm] = useState("");
  const [yy, setYy] = useState("");
  const [cvc, setCvc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const brand = cardBrand(number);
  const numberOk = luhnValid(number);
  const expOk = expiryValid(mm, yy);
  const cvcOk = /^\d{3,4}$/.test(cvc);
  const ready = numberOk && expOk && cvcOk && !busy;

  async function pay() {
    setErr(null);

    if (!numberOk) return setErr("Please check the card number.");
    if (!expOk) return setErr("Please check the expiry date.");
    if (!cvcOk) return setErr("Please check the CVV.");

    setBusy(true);
    try {
      // 1. Card → token, DIRETSO sa Maya mula sa browser.
      const token = await tokenizeCard({
        number,
        expMonth: mm,
        expYear: yy,
        cvc,
      });

      // 2. Token → server, doon sinisingil gamit ang secret key. Sinasadya
      //    na hindi natin ipinapadala ang halaga — ang server ang kumukuha
      //    niyon mula sa naka-save na order, para hindi ito mapakialaman.
      const res = await fetch("/api/pay-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId, payment_token_id: token }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        // Hindi naka-provision ang Vault — huwag i-dead-end ang customer.
        if (res.status === 403 || data?.code === "VAULT_UNAVAILABLE") {
          if (onFallback) {
            onFallback();
            return;
          }
        }
        throw new Error(data?.error || "The payment could not be completed.");
      }

      // 3. Hiningi ng bangko ang 3DS — doon ituloy ang customer.
      if (data.verification_url) {
        window.location.href = data.verification_url;
        return;
      }

      if (data.is_paid) {
        onPaid();
      } else {
        // Tinanggap pero hindi pa tapos — hahabulin ito ng Maya webhook.
        onPaid();
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="text-left">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-semibold">Enter your card details</h3>
        {brand && <span className="text-xs text-stone">{brand}</span>}
      </div>

      <label className="block mb-3">
        <span className="text-xs text-stone">Card number</span>
        <input
          value={number}
          onChange={(e) => setNumber(formatCardNumber(e.target.value))}
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="1234 5678 9012 3456"
          className={`w-full border rounded px-3 py-2.5 mt-1 tracking-wider ${
            number && !numberOk ? "border-red-600" : "border-stone/40"
          }`}
        />
      </label>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <label className="block">
          <span className="text-xs text-stone">Month</span>
          <input
            value={mm}
            onChange={(e) => setMm(e.target.value.replace(/\D/g, "").slice(0, 2))}
            inputMode="numeric"
            autoComplete="cc-exp-month"
            placeholder="MM"
            className={`w-full border rounded px-3 py-2.5 mt-1 ${
              mm && yy && !expOk ? "border-red-600" : "border-stone/40"
            }`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-stone">Year</span>
          <input
            value={yy}
            onChange={(e) => setYy(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="cc-exp-year"
            placeholder="YY"
            className={`w-full border rounded px-3 py-2.5 mt-1 ${
              mm && yy && !expOk ? "border-red-600" : "border-stone/40"
            }`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-stone">CVV</span>
          <input
            value={cvc}
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="123"
            className={`w-full border rounded px-3 py-2.5 mt-1 ${
              cvc && !cvcOk ? "border-red-600" : "border-stone/40"
            }`}
          />
        </label>
      </div>

      {err && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
          {err}
        </p>
      )}

      <button
        onClick={pay}
        disabled={!ready}
        className="w-full bg-ink text-white rounded py-3 font-semibold disabled:opacity-40"
      >
        {busy ? "Processing…" : `Pay ${peso(amount)}`}
      </button>

      <p className="text-[11px] text-stone mt-3 leading-relaxed">
        Your card details go directly to Maya over a secure connection and are
        never stored on our servers. Your bank may ask you to confirm with a
        one-time password.
      </p>
    </div>
  );
}
