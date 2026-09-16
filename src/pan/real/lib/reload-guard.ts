// RELOAD CIRCUIT BREAKER (Joe 2026-09-05, "infinite reload sa apk / windows
// app / browser — make sure di na mauulit"). LAHAT ng awtomatikong
// window.location.reload() ng app (AutoUpdater: bagong deploy; global-error:
// version skew; SessionWatcher: palit ng role) ay dumadaan dito. Isang tab ay
// may BUDGET: hanggang 2 auto-reload kada 10 minuto. Lampas doon — tigil ang
// auto-reload (mananatiling gumagana ang page; may maliit na "Refresh" na
// paalala na lang), at ini-report ang dahilan sa server para makita natin sa
// Activity Logs kung ano ang nag-trigger. Ang pagbilang ay nasa sessionStorage
// (kada tab), may fallback sa localStorage at sa window.name kapag naka-block
// ang storage — kaya kahit sira ang storage ay hindi makakalusot ang loop.

const KEY = "pan_auto_reloads";
const WINDOW_MS = 10 * 60_000;
const BUDGET = 2;

function readTs(): number[] {
  const parse = (v: string | null) => { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a.map(Number).filter((n) => n > 0) : []; } catch { return []; } };
  try { const v = sessionStorage.getItem(KEY); if (v) return parse(v); } catch { /* blocked */ }
  try { const v = localStorage.getItem(KEY); if (v) return parse(v); } catch { /* blocked */ }
  try { const m = /pan_auto_reloads=([^;]*)/.exec(window.name || ""); if (m) return parse(decodeURIComponent(m[1])); } catch { /* n/a */ }
  return [];
}
function writeTs(ts: number[]) {
  const v = JSON.stringify(ts);
  try { sessionStorage.setItem(KEY, v); } catch { /* blocked */ }
  try { localStorage.setItem(KEY, v); } catch { /* blocked */ }
  try { const rest = (window.name || "").replace(/;?pan_auto_reloads=[^;]*/, ""); window.name = `${rest};pan_auto_reloads=${encodeURIComponent(v)}`; } catch { /* n/a */ }
}

let pausedNotified = false;

// May budget pa ba? Kapag oo, ibinibilang ang reload na ito at true ang balik.
export function canAutoReload(reason: string): boolean {
  if (typeof window === "undefined") return false;
  const now = Date.now();
  const recent = readTs().filter((t) => now - t < WINDOW_MS);
  if (recent.length >= BUDGET) {
    if (!pausedNotified) {
      pausedNotified = true;
      console.warn(`[reload-guard] auto-reload PAUSED (${recent.length} in ${WINDOW_MS / 60000} min). Last reason: ${reason}`);
      void report(reason, recent.length);
      try { window.dispatchEvent(new CustomEvent("pan:reload-paused", { detail: { reason } })); } catch { /* n/a */ }
    }
    return false;
  }
  writeTs([...recent, now]);
  return true;
}

// Ang tanging daan ng awtomatikong reload. Reason = para sa log.
export function autoReload(reason: string): boolean {
  if (!canAutoReload(reason)) return false;
  try { sessionStorage.setItem("pan_last_reload_reason", `${reason} @ ${new Date().toISOString()}`); } catch { /* blocked */ }
  window.location.reload();
  return true;
}

// I-report sa server (best effort) para lumabas sa Activity Logs kung ano ang
// paulit-ulit na nagre-reload — hindi na tayo manghuhula sa susunod.
async function report(reason: string, count: number) {
  try {
    await fetch("/api/client-log", {
      method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
      body: JSON.stringify({ kind: "reload-storm", reason, count, href: location.href, ua: navigator.userAgent, last: (() => { try { return sessionStorage.getItem("pan_last_reload_reason"); } catch { return null; } })() }),
    });
  } catch { /* offline */ }
}
