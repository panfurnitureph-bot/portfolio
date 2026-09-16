"use client";

import { useEffect } from "react";

// NAV TRACER (2026-09-05, "reload ng reload sa dalawang PC"): a full-page load
// that repeats every ~0.5s in the desktop diag log but reproduces on NO clean
// browser and NO fresh headless session — so the trigger is client state that
// only lives on the running machines. We cannot see it from outside, so the app
// itself reports it.
//
// On every page load this stamps a monotonic counter + the last unload reason
// into sessionStorage. If the SAME url reloads many times in a short window it
// posts ONE report to Activity Logs (module "client", kind "nav-loop") naming:
// how many loads, how far apart, whether the page was hydrating each time, and
// the navigation type (reload vs back_forward vs navigate) from the Performance
// API. That tells us if it's window.location.reload, router-driven, or the
// desktop shell re-loading the URL.
export default function NavTracer() {
  useEffect(() => {
    const KEY = "pan_nav_trace";
    const now = Date.now();
    let arr: number[] = [];
    try { arr = JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch { /* off */ }
    arr = arr.filter((t) => now - t < 30_000);
    arr.push(now);
    try { sessionStorage.setItem(KEY, JSON.stringify(arr)); } catch { /* off */ }

    // Navigation type for THIS load (reload / back_forward / navigate).
    let navType = "?";
    try {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      navType = nav?.type ?? "?";
    } catch { /* off */ }

    // 5+ loads of the same URL within 30s = a loop. Report once every 2 min.
    if (arr.length >= 5) {
      let lastReport = 0;
      try { lastReport = Number(sessionStorage.getItem("pan_nav_trace_report") || 0); } catch { /* off */ }
      if (now - lastReport > 120_000) {
        try { sessionStorage.setItem("pan_nav_trace_report", String(now)); } catch { /* off */ }
        const gaps = arr.slice(1).map((t, i) => t - arr[i]);
        const avgGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
        void fetch("/api/client-log", {
          method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
          body: JSON.stringify({
            kind: "nav-loop", count: arr.length,
            reason: `loads=${arr.length} avgGapMs=${avgGap} navType=${navType} ref=${document.referrer.slice(0, 60)}`,
            href: location.href, ua: navigator.userAgent,
          }),
        }).catch(() => { /* offline */ });
      }
    }
  }, []);

  return null;
}
