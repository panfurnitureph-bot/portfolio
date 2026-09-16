"use client";

import { useEffect, useRef, useState } from "react";
import { autoReload } from "@/lib/reload-guard";

// Silent auto-update. The APK is a thin WebView shell pointed at the hosted URL, so a
// new Vercel deploy (every shipped GitHub push) is already "installed" — the only gap
// is a tab that's been open since before the deploy. This poller closes that gap:
// it records the build id the app STARTED with, then periodically (and on tab focus)
// re-fetches /api/version. When the live build id differs, a new version has shipped,
// so it reloads the page to pick it up — no prompt, no app-store update, no manual tap.
//
// Guards against reload loops: it only reloads when the CURRENT running id is known and
// the live id is different AND non-empty. It also skips reloading while the user is
// mid-typing in a form field, retrying shortly after.
// 5 minuto — dating 20s + isang SSE stream na nakabukas nang tuloy-tuloy kada
// tab. Ang SSE ang pangunahing sanhi ng 1,012 GB-hrs Provisioned Memory sa
// Vercel (function na buhay habang nakabukas ang koneksyon), kaya tinanggal;
// ang poll na ito + refresh-on-focus ang natitirang deploy detection.
const POLL_MS = 5 * 60_000;
const FOCUS_DEBOUNCE_MS = 1_500;

async function fetchLiveBuildId(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { buildId?: string };
    return data.buildId ?? null;
  } catch {
    return null;
  }
}

// Bukas na modal (Create Order, Edit Order, atbp. — lahat dumadaan sa shared
// Modal na may role="dialog") = may entry na ginagawa. Ang window.location.reload()
// ay BUBURA sa lahat ng nailagay sa form, kaya hindi tayo magre-reload hangga't
// may nakabukas na dialog — susubukan ulit ng quiet-loop pagkasara.
function hasOpenDialog(): boolean {
  return typeof document !== "undefined" && !!document.querySelector('[role="dialog"]');
}

function userIsBusy(): boolean {
  if (hasOpenDialog()) return true;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// SILENT RELOAD WINDOW: ang buong-page reload (bagong deploy) ay HINDI dapat
// makita — payagan lang ito kapag (a) nakatago ang tab/app, o (b) idle ang user
// nang ≥60s. Kung aktibong gumagamit, hintayin ang susunod na tahimik na sandali.
let lastInputAt = Date.now();
if (typeof window !== "undefined") {
  (["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as (keyof WindowEventMap)[]).forEach((ev) =>
    window.addEventListener(ev, () => { lastInputAt = Date.now(); }, { passive: true }),
  );
}
function quietMoment(): boolean {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return true;
  // 20s idle (dating 60s) — mas mabilis mag-apply ang deploy sa mga natural na
  // pause (kausap ang customer, naglalakad, atbp.) nang hindi pa rin naaabala
  // ang aktibong pag-type/tap (userIsBusy guard pa rin ang bantay).
  return Date.now() - lastInputAt >= 20_000;
}

// DEV = WALANG AUTO-RELOAD (2026-09-03, "refresh sya ng refresh"): sa dev
// server, ang build id ay nagbabago sa BAWAT compile/HMR — kaya tuwing may
// ine-edit na code habang nakabukas ang app, bawat tahimik na sandali ay
// nagre-reload ang page nang paulit-ulit. Ang updater ay para sa DEPLOY sa
// production lang; sa development ang HMR na mismo ang nag-a-apply ng bago.
const IS_DEV = process.env.NODE_ENV !== "production";

export function AutoUpdater() {
  const currentId = useRef<string | null>(null);
  const reloading = useRef(false);
  // Kapag pinigil ng circuit breaker ang auto-reload, maliit na paalala na lang
  // — ang user ang magre-refresh kung kailan niya gusto. Hindi na mauulit ang
  // walang katapusang reload kahit ano pa ang nag-trigger.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const h = () => setPaused(true);
    window.addEventListener("pan:reload-paused", h);
    return () => window.removeEventListener("pan:reload-paused", h);
  }, []);

  // EBIDENSYA (2026-09-05): kapag ang inline chunk guard (components/chunk-guard)
  // ay nag-reload dahil may /_next/static file na hindi na-load, dito natin
  // ini-report sa Activity Logs (module "client") pagkatapos ng reload — alin
  // ang file, aling pahina, aling device — para hindi na tayo manghula.
  useEffect(() => {
    if (IS_DEV) return;
    let failed: string | null = null;
    try { failed = sessionStorage.getItem("pan_chunk_fail"); sessionStorage.removeItem("pan_chunk_fail"); } catch { /* storage off */ }
    if (!failed) return;
    void fetch("/api/client-log", {
      method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
      body: JSON.stringify({ kind: "chunk-reload", reason: failed, count: 1, href: location.href, ua: navigator.userAgent }),
    }).catch(() => { /* offline */ });
  }, []);

  // VERSION-SKEW RECOVERY: pagkatapos ng deploy, ang bukas na APK/desktop ay may
  // LUMANG bundle na tumatawag sa bagong server — ang server actions nito ay
  // "Failed to find Server Action" / "unexpected response" na nagmumukhang
  // "Something went wrong" sa bawat button. Sa sandaling makita ang ganoong
  // error, mag-full-reload (kinukuha ang bagong bundle) — guarded ng 60s para
  // hindi mag-loop kung tunay na bug.
  useEffect(() => {
    if (IS_DEV) return;
    const GUARD = "pan_skew_reload_at";
    // Kasama ang chunk-load failures (2026-09-05): "Failed to load script",
    // ChunkLoadError, "Loading chunk N failed", "Failed to fetch dynamically
    // imported module" — lahat ay isang chunk na hindi nakuha (CDN reset,
    // mahinang signal, o lumang HTML pagkatapos ng deploy). Isang reload ang
    // lunas (naka-cache na ang iba, ang kulang lang ang kukunin muli).
    const isSkew = (msg: string) =>
      /failed to find server action|unexpected response was received from the server|failed to load script|chunkloaderror|loading chunk .* failed|failed to fetch dynamically imported module|importing a module script failed/i.test(msg);
    const recover = async (msg: string) => {
      if (!msg || !isSkew(msg)) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      let last = 0;
      try { last = Number(localStorage.getItem(GUARD)) || 0; } catch { /* storage off */ }
      if (Date.now() - last < 60_000) return;
      // TUNAY NA SKEW LANG (2026-09-05, "reload ng reload sa browser"): ang
      // "unexpected response" ay lumalabas din kapag ang CDN edge ang sumagot
      // ng HTML 405 sa isang malaking server-action POST (Hostinger edge4,
      // bawat body na ≥100KB — packing/product photos). Hindi iyon skew, at
      // ang reload ay walang naitutulong — paulit-ulit lang. Kaya bago mag-
      // reload, tanungin ang server: kung PAREHO pa ang build id, hindi skew —
      // hayaan ang sariling error ng action, at itala sa Activity Logs.
      const isChunk = /failed to load script|chunkloaderror|loading chunk|dynamically imported module|module script failed/i.test(msg);
      if (!isChunk) {
        const live = await fetchLiveBuildId();
        if (live && currentId.current && live === currentId.current) {
          void fetch("/api/client-log", {
            method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
            body: JSON.stringify({ kind: "action-failed", reason: msg.slice(0, 200), count: 1, href: location.href, ua: navigator.userAgent }),
          }).catch(() => { /* offline */ });
          return;
        }
      }
      try { localStorage.setItem(GUARD, String(Date.now())); } catch { /* storage off */ }
      autoReload("version-skew: " + msg.slice(0, 80));
    };
    const onRejection = (e: PromiseRejectionEvent) => recover(String((e.reason as { message?: string } | null)?.message ?? e.reason ?? ""));
    const onError = (e: ErrorEvent) => recover(String(e.message ?? ""));
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    if (IS_DEV) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    // SILENT: pag may bagong deploy, HUWAG mag-reload habang aktibong gumagamit —
    // tandaan lang na may pending, at mag-reload sa tahimik na sandali (nakatagong
    // tab o ≥60s idle), che-check bawat 5s. Hindi kailanman makikita ng user ang
    // reload habang may ginagawa sila.
    let updatePending = false;
    let seenNew: string | null = null;
    let quietTimer: ReturnType<typeof setInterval> | null = null;
    const reloadWhenQuiet = () => {
      if (quietTimer) return;
      quietTimer = setInterval(() => {
        if (stopped || reloading.current) return;
        if (userIsBusy() || !quietMoment()) return;
        reloading.current = true;
        if (!autoReload("new deploy (quiet moment)")) { reloading.current = false; if (quietTimer) clearInterval(quietTimer); quietTimer = null; }
      }, 5_000);
    };

    // Pag-BALIK sa app (resume mula sa ibang app / lock screen) — sariwang bukas
    // pa lang, wala pang nasisimulang gawa: ligtas mag-reload AGAD kapag may
    // bagong deploy. Ito ang pumapalit sa "close and open" na kailangang gawin
    // dati sa APK.
    let resumedAt = 0;

    const maybeReload = async () => {
      if (stopped || reloading.current) return;
      const live = await fetchLiveBuildId();
      if (!live) return;
      // First successful read seeds the running version — don't reload on it.
      if (currentId.current === null) { currentId.current = live; return; }
      if (live === currentId.current) { seenNew = null; return; }
      // STABLE MUNA (2026-09-05, "reload ng reload"): habang nagde-deploy ang
      // Hostinger, nagpapalit-palit ang buildId (lumang proseso / bago) sa
      // magkakasunod na basa — kung agad magre-reload sa unang pagkakaiba,
      // paulit-ulit ang reload hanggang matapos ang rollout. Kailangang
      // DALAWANG magkasunod na basa ng PAREHONG bagong id bago ituring na update.
      if (seenNew !== live) { seenNew = live; return; }
      // A new version is live.
      updatePending = true;
      if (Date.now() - resumedAt < 10_000 && !userIsBusy()) {
        // Kaka-resume lang (≤10s) — i-apply agad ang update habang wala pang gawa.
        reloading.current = true;
        if (!autoReload("new deploy (resume)")) reloading.current = false;
        return;
      }
      // Aktibong gumagamit — reload sa tahimik na sandali lang.
      reloadWhenQuiet();
    };

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(async () => { await maybeReload(); schedule(); }, POLL_MS);
    };

    // Pag nag-hide ang tab habang may pending update — perpektong sandali: reload
    // nang tahimik habang hindi nakatingin. MALIBAN kung may bukas na modal:
    // ang staff na lumipat ng app sa gitna ng Create Order ay babalik sa
    // buradong form kung magre-reload tayo dito.
    const onHidden = () => {
      if (updatePending && !reloading.current && document.visibilityState === "hidden" && !hasOpenDialog()) {
        reloading.current = true;
        if (!autoReload("new deploy (tab hidden)")) reloading.current = false;
      }
    };
    document.addEventListener("visibilitychange", onHidden);

    const onFocus = () => {
      if (document.visibilityState !== "hidden") resumedAt = Date.now();
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => { void maybeReload(); }, FOCUS_DEBOUNCE_MS);
    };

    void maybeReload();
    schedule();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (focusTimer) clearTimeout(focusTimer);
      if (quietTimer) clearInterval(quietTimer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);

  if (!paused) return null;
  return (
    <div className="fixed bottom-3 left-1/2 z-[95] -translate-x-1/2 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900 shadow-lg">
      Auto-refresh paused (it kept repeating). <button type="button" onClick={() => window.location.reload()} className="ml-1 font-bold underline">Refresh now</button>
    </div>
  );
}
