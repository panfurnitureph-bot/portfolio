"use client";

// Bilog na "Track order" na icon-button — nasa gilid, sa itaas ng chat bubble.
// Pag-click: bumubukas ang order tracker sa isang pop-up (hindi bagong page).
//
// Ang iframe ay LAGING naka-mount (nakatago habang sarado) kaya nauuna nang
// ma-load — instant ang unang buksan, walang 1-3 segundong antay.

import { useEffect, useRef, useState } from "react";

export default function TrackButton() {
  const [open, setOpen] = useState(false);
  // Taas ng laman ng tracker, iniuulat ng iframe (postMessage) — para sakto
  // lang ang modal sa form, at hahaba lang kapag may resulta na. Ang default
  // (~500) ay malapit sa taas ng form kaya buo agad ang unang labas, walang
  // reflow mula sa maliit.
  const [height, setHeight] = useState(500);
  // Ang iframe ay isang buong app sa loob ng page — kapag kasabay itong
  // nag-lo-load ng mismong page, bumabagal ang unang scroll sa mobile.
  // Kaya PAGKATAPOS na maging handa ang page (load + idle) saka pa lang
  // imo-mount ang iframe. Instant pa rin ang pagbukas pagkatapos nun.
  const [frameReady, setFrameReady] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    const arm = () => {
      const idle =
        (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
          .requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 2000));
      idle(() => {
        if (!cancelled) setFrameReady(true);
      });
    };
    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", arm);
    };
  }, []);

  function reset() {
    // Sabihan ang tracker na ibalik sa form — client-side, INSTANT (walang
    // reload). Nakikinig ang track page sa "track-reset".
    setHeight(500);
    frameRef.current?.contentWindow?.postMessage({ type: "track-reset" }, "*");
  }

  function openModal() {
    reset(); // linisin ang naiwang resulta agad
    setOpen(true);
  }

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.data?.type === "track-height" && typeof e.data.height === "number") {
        setHeight(Math.max(e.data.height, 240));
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Escape para isara; harangin ang scroll sa likod at itago ang ibang
  // lumulutang na buton habang bukas.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // Itago ang dating value ng body.overflow para maibalik nang tama, imbes na
    // basta gawing "" (na baka mag-clobber sa ibang lock).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.setAttribute("data-track-open", "1");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.documentElement.removeAttribute("data-track-open");
      // Pagsara, ibalik agad ang tracker sa form sa background — kaya instant
      // na ang susunod na buksan.
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Panghuling proteksyon: kahit ma-unmount ang component habang bukas ang modal
  // (hal. paglipat ng pahina), siguraduhing hindi maiiwang naka-lock ang scroll.
  // Ito ang pangunahing sanhi ng "naka-stuck, kailangan mag-refresh" na bug.
  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
      document.documentElement.removeAttribute("data-track-open");
    };
  }, []);

  // ANG LAUNCHER (truck) AY NASA CONTACT RAIL NA (Joe 2026-09-12, kaliwang
  // gilid): ang rail ang nagpapadala ng event; dito ang modal lang.
  useEffect(() => {
    const on = () => openModal();
    window.addEventListener("pan-open-track", on);
    return () => window.removeEventListener("pan-open-track", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>

      {/* Modal shell — laging naka-render kaya naka-load na ang iframe;
          ipinapakita lang kapag bukas.

          MAHALAGA: `invisible` (visibility: hidden) kapag sarado — HINDI
          sapat ang pointer-events-none: sa iOS Safari, ang IFRAME ay
          tumatanggap pa rin ng touches kahit naka-pointer-events-none ang
          parent (kilalang WebKit bug). Dahil nakasentro ito sa screen,
          kinakain nito ang mga hagod sa gitnang banda ng page — yun ang
          "may mga parteng hindi ma-scroll" sa iPhone. Ang visibility:
          hidden ay tunay na nag-aalis sa kanya sa hit-testing. */}
      <div
        className={`fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-6 ${
          open ? "" : "pointer-events-none opacity-0 invisible"
        }`}
        aria-hidden={!open}
      >
        <div
          className={`absolute inset-0 bg-ink/70 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          onClick={() => setOpen(false)}
        />
        <div className="relative bg-cream w-full max-w-lg rounded-xl shadow-2xl overflow-hidden max-h-[90vh]">
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-white/90 text-ink shadow flex items-center justify-center text-xl leading-none hover:bg-white"
          >
            ×
          </button>
          <div className="overflow-y-auto max-h-[90vh]">
            {(frameReady || open) && (
              <iframe
                ref={frameRef}
                src="/track?embed=1"
                title="Order tracker"
                className="w-full border-0 block transition-[height] duration-200"
                style={{ height }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
