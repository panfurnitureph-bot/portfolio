"use client";

// Kapag ang pahina ay binuksan sa loob ng pop-up (iframe) na may ?embed=1,
// itinatago nito ang header, footer, at mga lumulutang na buton — para ang
// laman lang ang lumabas sa pop-up, walang doble na navigation.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function EmbedMode() {
  const params = useSearchParams();
  const embed = params.get("embed") === "1";

  useEffect(() => {
    if (!embed) return;
    document.documentElement.setAttribute("data-embed", "1");

    // Iulat ang taas ng laman sa parent (ang track pop-up) tuwing may pagbabago —
    // para sakto lang ang modal sa form, at hahaba lang kapag may resulta.
    const report = () => {
      // Gamitin ang TUNAY na taas ng nilalaman (ang <main>), hindi ang buong
      // body — para hindi kasama ang anumang sobrang puwang, at eksaktong-sakto
      // ang taas na iniuulat sa modal (walang malaking blankong ibaba).
      const main = document.querySelector("main");
      const h = Math.ceil(
        main ? main.getBoundingClientRect().height : document.documentElement.scrollHeight,
      );
      window.parent?.postMessage({ type: "track-height", height: h }, "*");
    };
    report();
    // Iulat din pagkatapos mag-load ang mga font/larawan — para tama agad ang
    // taas nang hindi naghihintay ng ResizeObserver tick.
    requestAnimationFrame(report);
    window.addEventListener("load", report);
    const target = document.querySelector("main") ?? document.body;
    const ro = new ResizeObserver(report);
    ro.observe(target);
    return () => {
      document.documentElement.removeAttribute("data-embed");
      window.removeEventListener("load", report);
      ro.disconnect();
    };
  }, [embed]);

  return null;
}
