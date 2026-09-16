"use client";

import { useEffect, useState } from "react";

// In-app Android APK updater — the closest Android allows to the desktop
// "restart to update". Runs ONLY inside the Capacitor APK (detected via the UA tag
// appended in capacitor.config: "PANFurniturePH/<version>"). It polls
// /api/apk-version; when the server's version is higher than the running APK's, it
// shows a FORCED full-screen update gate. Tapping Update downloads the new APK —
// Android then shows its own install screen (a system-required tap; a running APK
// can't self-install silently).
//
// Web content still auto-updates on its own; this is only for NATIVE APK changes
// (icon, name, permissions, native plugins like push notifications), which are rare.
//
// WALANG interval poll: ang APK ay kino-compile LOCALLY at kami ang nag-uutos ng
// release (bump ng /api/apk-version) — kaya sapat nang mag-check sa PAGBUKAS ng
// app at sa pagbalik ng focus. Ang dating 30s poll ay tuloy-tuloy na server
// calls kada APK device nang walang pakinabang sa pagitan ng releases.

// LOOP GUARD. A forced gate + a version/file MISMATCH (server says v13 but
// public/pan-furniture.apk is still the v12 build) would trap every device forever:
// download → install → still v12 → gate again. So the FIRST time a device sees a
// given target version we remember it; if the app relaunches and is STILL below that
// same target, the update didn't take (bad/mismatched file) and we stop forcing —
// falling back to a dismissable banner so the app is never bricked. Bumping the
// server to a genuinely new version (with a matching new APK) clears the guard
// because the target number changes.
const TRIED_KEY = "apk_update_tried_version";

function runningApkVersion(): number | null {
  const m = /PANFurniturePH\/(\d+)/.exec(navigator.userAgent || "");
  return m ? Number(m[1]) : null;
}

export function ApkUpdater() {
  const [update, setUpdate] = useState<{ url: string; version: number } | null>(null);
  const [forced, setForced] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const current = runningApkVersion();
    if (current == null) return; // not the APK → nothing to do

    let stopped = false;
    const check = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/apk-version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: number; url?: string };
        if (typeof data.version === "number" && data.version > current && data.url) {
          // Did we already try (and fail) to reach THIS target? If so the file is
          // stale/mismatched — don't force, offer a dismissable banner instead.
          let alreadyTried = false;
          try { alreadyTried = Number(localStorage.getItem(TRIED_KEY)) === data.version; } catch { /* storage off */ }
          // Record this target so a relaunch that's still below it trips the guard.
          try { localStorage.setItem(TRIED_KEY, String(data.version)); } catch { /* storage off */ }
          setForced(!alreadyTried);
          setUpdate({ url: data.url, version: data.version });
        } else {
          // We're up to date (running >= server) — clear the guard for next time.
          try { localStorage.removeItem(TRIED_KEY); } catch { /* storage off */ }
          setUpdate(null);
        }
      } catch { /* offline — try again next tick */ }
    };

    void check();
    const onFocus = () => { void check(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      stopped = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  if (!update || (!forced && dismissed)) return null;

  // FORCED (default): a full-screen gate the user can't dismiss — the app is unusable
  // until they install the new APK. The loop guard above downgrades this to the
  // dismissable banner if a prior attempt to reach this version didn't stick, so a
  // stale/mismatched file can never brick the app.
  if (forced) {
    return (
      <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center gap-5 bg-[#2a2316] px-6 text-center text-[#f4ead8]">
        <div>
          <p className="text-lg font-bold">App update required</p>
          <p className="mt-1 text-sm opacity-80">A new version of PAN Furniture PH (v{update.version}) is available. Install it to continue — it includes push notifications.</p>
        </div>
        <a
          href={update.url}
          download
          onClick={() => setDownloading(true)}
          className="rounded-xl bg-[#caa45a] px-8 py-3 text-base font-bold text-[#2a2316] active:scale-95"
        >
          {downloading ? "Downloading…" : "Update Now"}
        </a>
        <p className="max-w-xs text-[11px] opacity-60">
          After the download, tap “Install” on the Android screen that appears. If you see “Update blocked”, allow installs from this app in Settings.
        </p>
      </div>
    );
  }

  // Fallback: dismissable banner (loop guard tripped — the file may be stale).
  return (
    <div className="fixed inset-x-0 bottom-0 z-[200] flex justify-center px-4 pb-4">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-[#caa45a]/40 bg-[#4a3b1a] px-4 py-3 text-[#f4ead8] shadow-2xl">
        <div className="flex-1">
          <p className="text-sm font-semibold">New app update available</p>
          <p className="text-xs opacity-75">Tap Update to install the latest PAN Furniture PH.</p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="rounded-lg px-3 py-2 text-xs font-medium text-[#f4ead8]/70 hover:text-[#f4ead8]"
        >
          Later
        </button>
        <a
          href={update.url}
          download
          className="rounded-lg bg-[#caa45a] px-4 py-2 text-xs font-bold text-[#2a2316] active:scale-95"
        >
          Update
        </a>
      </div>
    </div>
  );
}
