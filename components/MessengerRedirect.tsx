"use client";

import { useEffect, useState } from "react";
import { messengerUrl } from "@/lib/messenger";

// Pagkatapos mag-order, dinadala ang customer sa Messenger ng tindahan kasama
// ang order number, para may kausap agad siyang tao.
//
// Ang `?ref=` ay ipinapasa ng Messenger sa page — doon mababasa ng bot kung
// aling order ang tinutukoy, kaya hindi na kailangang magtanong.
//
// Hindi ito nagpapadala ng mensahe nang mag-isa — walang paraan para gawin
// iyon nang hindi pinipindot ng customer ang Send. Ang Messenger lang ang
// binubuksan, may naka-attach nang order ref.

export default function MessengerRedirect({
  pageId,
  orderNumber,
  seconds = 6,
  autoOpen = false,
}: {
  /** Facebook Page ID o username (hal. "PANFurnitureLaguna"). */
  pageId: string;
  orderNumber: string;
  seconds?: number;
  /**
   * Bumibilang lang kapag `true` — itinatakda ito kapag bayad na.
   * Habang hindi pa, nakikita pa rin ang buton pero hindi siya inililipat:
   * masama kung mailipat habang sina-scan pa ang QR.
   */
  autoOpen?: boolean;
}) {
  const [left, setLeft] = useState(seconds);
  const [stopped, setStopped] = useState(false);

  const url = messengerUrl(pageId, orderNumber);

  useEffect(() => {
    if (!autoOpen || stopped) return;
    if (left <= 0) {
      window.location.href = url;
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, stopped, url, autoOpen]);

  return (
    <div className="bg-white border border-sand rounded-lg p-5 mb-8 text-center">
      <p className="text-sm mb-3">
        We&apos;ll open <strong>Messenger</strong> so you can talk to us about
        order <strong className="text-cognac">{orderNumber}</strong>.
      </p>

      <a
        href={url}
        className="inline-block bg-[#0084FF] text-white px-8 py-3.5 text-sm font-bold tracking-widest2 rounded hover:opacity-90 transition-opacity"
      >
        CHAT WITH US NOW
      </a>

      {autoOpen && !stopped ? (
        <p className="text-xs text-stone mt-3" aria-live="polite">
          Opening in {left}s ·{" "}
          <button
            onClick={() => setStopped(true)}
            className="underline hover:text-ink"
          >
            stay on this page
          </button>
        </p>
      ) : (
        <p className="text-xs text-stone mt-3">
          Tap the button above whenever you&apos;re ready.
        </p>
      )}
    </div>
  );
}
