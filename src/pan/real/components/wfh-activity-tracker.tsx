"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase, realtimeReady } from "@/lib/supabase/client";
import { wfhHeartbeat, myWfhContext, type WfhContext } from "@/app/hr/attendance/actions";

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL WFH ACTIVITY TRACKER — mounted once in the app shell, so it runs on EVERY
// authenticated page while a WFH employee is clocked in. Onsite staff (face kiosk /
// office self-clock) are NOT tracked: the engine only runs when the user has an
// OPEN WFH session (source='wfh'), which myWfhContext() reports. The employee sees
// nothing except the idle reminder pop-up; all data is server-side, admin-only.
//
// LIMITATION: when the browser tab is fully hidden/minimized the 1s interval is
// throttled (~1/min) — a web-platform limit. Running app-wide fixes the real
// complaint (navigating between OUR pages keeps tracking); true always-on
// background needs the future APK/native phase.
// ─────────────────────────────────────────────────────────────────────────────

// FALLBACK cadence — ang totoong values ay ADMIN-CONFIGURABLE sa Settings ng
// WFH Activity tab (app_settings: wfh_idle_after_min / wfh_selfie_every_min),
// dala ng WfhContext. Ito lang ang gamit habang wala pang na-load na context.
const IDLE_AFTER_S = 5 * 60;      // no input → Idle
const HEARTBEAT_EVERY_S = 30;     // post one activity bucket
const SELFIE_EVERY_S = 10 * 60;   // capture a webcam selfie + screen snapshot
const FACE_MATCH_THRESHOLD = 0.6; // euclidean distance

function snapshotJpeg(video: HTMLVideoElement): string | null {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2, sy = (vh - side) / 2;
  const out = 240;
  const c = document.createElement("canvas"); c.width = out; c.height = out;
  const ctx = c.getContext("2d"); if (!ctx) return null;
  ctx.drawImage(video, sx, sy, side, side, 0, 0, out, out);
  try { return c.toDataURL("image/jpeg", 0.6); } catch { return null; }
}
function euclid(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length); let s = 0;
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}
// Full-frame screen snapshot (NOT cropped) — downscaled to ~1280px wide so text is
// readable when the admin enlarges it, while keeping the data URL under the ~200KB
// cap (quality 0.6).
function snapshotScreen(video: HTMLVideoElement): string | null {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const maxW = 1280;
  const scale = Math.min(1, maxW / vw);
  const w = Math.round(vw * scale), h = Math.round(vh * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"); if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  try { return c.toDataURL("image/jpeg", 0.6); } catch { return null; }
}

export function WfhActivityTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [ctx, setCtx] = useState<WfhContext | null>(null);
  const [isIdle, setIsIdle] = useState(false);
  const [screenOn, setScreenOn] = useState(false); // user granted + still sharing
  const [screenErr, setScreenErr] = useState<string | null>(null);
  // On the APK, screen capture is handled by the native ScreenCapture plugin (granted
  // at clock-in), so the web "Enable screen monitoring" opt-in banner is irrelevant.
  const isNative = typeof window !== "undefined" && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

  const tracking = !!ctx?.hasOpenWfhSession && !!ctx?.employeeId;
  const faceDescriptor = ctx?.faceDescriptor ?? null;

  // Resolve WFH context on mount, re-check on hr_attendance realtime changes
  // (debounced), AND re-check INSTANTLY when this tab clocks in/out (custom event
  // from WfhClock) so the banner/engine start/stop immediately — no realtime lag.
  useEffect(() => {
    let alive = true;
    const refresh = () => { myWfhContext().then((c) => { if (alive) setCtx(c); }).catch(() => {}); };
    refresh();
    const onClockChanged = () => refresh(); // instant, same-tab
    window.addEventListener("wfh-clock-changed", onClockChanged);
    const sb = createBrowserSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    let ch: ReturnType<typeof sb.channel> | null = null;
    // Token muna bago subscribe (2026-09-05) — anon join = walang events.
    void realtimeReady().then(() => {
      if (!alive) return;
      ch = sb.channel("wfh_tracker:att")
        .on("postgres_changes", { event: "*", schema: "public", table: "hr_attendance" }, () => {
          if (t) clearTimeout(t);
          t = setTimeout(refresh, 800);
        })
        .subscribe();
    });
    return () => { alive = false; window.removeEventListener("wfh-clock-changed", onClockChanged); if (t) clearTimeout(t); if (ch) void sb.removeChannel(ch); };
  }, []);

  // Engine refs (don't re-create the loop on every render).
  const lastInputRef = useRef(Date.now());
  const bucketRef = useRef({ active: 0, idle: 0, away: 0, start: new Date().toISOString() });
  const sinceBeatRef = useRef(0);
  const sinceSelfieRef = useRef(0);
  const prevStatusRef = useRef<"active" | "idle" | "away">("active");

  // Input listeners (stable) — any input keeps "active" alive.
  useEffect(() => {
    const onInput = () => { lastInputRef.current = Date.now(); };
    const evs = ["mousemove", "keydown", "click", "scroll", "touchstart", "pointerdown"] as const;
    evs.forEach((e) => window.addEventListener(e, onInput, { passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, onInput));
  }, []);

  // Preload face models once when tracking starts (only if the employee has an
  // enrolled face to match against) so the first selfie's match isn't slow and
  // never hits "load model before inference".
  useEffect(() => {
    if (!tracking || !faceDescriptor) return;
    let alive = true;
    import("@/lib/face/face-api-loader").then((fa) => { if (alive) fa.loadFaceModels().catch(() => {}); }).catch(() => {});
    return () => { alive = false; };
  }, [tracking, faceDescriptor]);

  // Camera: one stream for the whole WFH session — start when tracking begins,
  // stop when it ends. Reused for every selfie. If the Clock-In button already
  // acquired the camera (it does — camera is mandatory for WFH), adopt THAT stream
  // instead of prompting again.
  useEffect(() => {
    let cancelled = false;
    if (tracking) {
      (async () => {
        try {
          const w = window as unknown as { __wfhCamStream?: MediaStream };
          // Adopt the Clock-In stream if it's still LIVE; if it was already stopped
          // (track ended), fall back to a fresh getUserMedia so selfies still work.
          const stashed = w.__wfhCamStream;
          w.__wfhCamStream = undefined;
          const stashLive = !!stashed && stashed.getVideoTracks().some((t) => t.readyState === "live");
          const stream = stashLive ? stashed! : await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 480, height: 360 }, audio: false });
          if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
          streamRef.current = stream;
          if (videoRef.current) {
            const v = videoRef.current;
            v.srcObject = stream;
            await v.play().catch(() => {});
            // Wait until the video actually has pixels, so the first selfie ~30s later
            // isn't a 0×0 blank (an adopted stream can attach before it's decoding).
            if (!(v.readyState >= 2 && v.videoWidth > 0)) {
              await new Promise<void>((res) => {
                const on = () => { v.removeEventListener("loadeddata", on); res(); };
                v.addEventListener("loadeddata", on);
                setTimeout(res, 2000);
              });
            }
          }
        } catch { /* camera blocked → selfies skipped, activity still tracked */ }
      })();
    }
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [tracking]);

  // Screen share — getDisplayMedia REQUIRES a user gesture (can't auto-start), so
  // it's triggered by the "Enable screen monitoring" button below. If the user
  // stops sharing (browser bar), the track ends → screenOn flips false → the
  // button reappears. Stop the screen stream when tracking ends.
  // Adopt a screen MediaStream (from our own getDisplayMedia OR one the Clock-In
  // button already obtained and stashed). Attaches it + wires the "Stop sharing".
  async function adoptScreenStream(s: MediaStream) {
    screenStreamRef.current = s;
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = s;
      await screenVideoRef.current.play().catch(() => {});
      await new Promise<void>((res) => {
        const v = screenVideoRef.current!;
        if (v.readyState >= 2 && v.videoWidth > 0) return res();
        const on = () => { v.removeEventListener("loadeddata", on); res(); };
        v.addEventListener("loadeddata", on);
        setTimeout(res, 1500);
      });
    }
    setScreenOn(true);
    setScreenErr(null);
    s.getVideoTracks()[0]?.addEventListener("ended", () => { screenStreamRef.current = null; setScreenOn(false); });
  }

  async function startScreenShare() {
    setScreenErr(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      setScreenErr("Screen sharing isn't available here. Use https or localhost (not a plain http:// IP).");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1, displaySurface: "monitor" } as MediaTrackConstraints,
        audio: false,
        // @ts-expect-error monitorTypeSurfaces is a newer getDisplayMedia option
        monitorTypeSurfaces: "include", surfaceSwitching: "include", selfBrowserSurface: "exclude",
      });
      await adoptScreenStream(s);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setScreenErr(name === "NotAllowedError" ? "Screen share was cancelled or blocked. Click again and choose Entire Screen → Share." : (e instanceof Error ? e.message : "Could not start screen share."));
    }
  }

  // Adopt the screen stream that the Clock-In button already obtained (so the user
  // grants screen share in the SAME click as clocking in — no separate button).
  useEffect(() => {
    function onGranted() {
      const w = window as unknown as { __wfhScreenStream?: MediaStream };
      const s = w.__wfhScreenStream;
      if (s) { w.__wfhScreenStream = undefined; adoptScreenStream(s).catch(() => {}); }
    }
    window.addEventListener("wfh-screen-granted", onGranted);
    return () => window.removeEventListener("wfh-screen-granted", onGranted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // DESKTOP (Electron) AUTO-START: ang shell ay may setDisplayMediaRequestHandler
  // na tahimik na nagbibigay ng primary screen — walang picker at walang user
  // gesture na kailangan. Kaya sa pag-start ng tracking, subukang mag-auto-start
  // ng screen capture; sa browser ito ay babagsak ng NotAllowedError (walang
  // gesture) at mananatili ang "Enable screen monitoring" na button — walang
  // pagbabago sa web behavior.
  useEffect(() => {
    if (!tracking || screenOn || isNative) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 1, displaySurface: "monitor" } as MediaTrackConstraints,
          audio: false,
        });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        await adoptScreenStream(s);
      } catch { /* browser (kailangan ng gesture) → the opt-in button remains */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking]);

  useEffect(() => {
    // Tracking ended (clock-out) → stop the WEB screen share + clear the <video> so the
    // browser "sharing" bar disappears.
    //
    // On the APK we deliberately do NOT stop the native MediaProjection here. Android
    // shows its "Allow … to record the screen?" consent on every getMediaProjection(),
    // so stopping it on clock-out forced a fresh consent on the NEXT clock-in. Instead
    // we keep the projection alive for the whole app session — the plugin's start()
    // reuses the existing projection (no dialog), and it's torn down only when the app
    // is destroyed (plugin handleOnDestroy). One consent per app launch, not per clock-in.
    if (!tracking) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
      setScreenOn(false);
    }
    // On UNMOUNT (navigate away / page close) always stop any active screen share.
    return () => {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
    };
  }, [tracking]);

  // The 1-second engine — runs only while tracking a WFH session.
  useEffect(() => {
    if (!tracking) { setIsIdle(false); return; }
    bucketRef.current = { active: 0, idle: 0, away: 0, start: new Date().toISOString() };
    sinceBeatRef.current = 0; sinceSelfieRef.current = 0; prevStatusRef.current = "active";

    // Admin-configured cadence mula sa context (fallback sa constants).
    const idleAfterS = ctx?.idleAfterS ?? IDLE_AFTER_S;
    const selfieEveryS = ctx?.selfieEveryS ?? SELFIE_EVERY_S;

    const tick = setInterval(async () => {
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      const sinceInput = (Date.now() - lastInputRef.current) / 1000;
      const idleNow = !hidden && sinceInput >= idleAfterS;
      const liveStatus: "active" | "idle" | "away" = hidden ? "away" : idleNow ? "idle" : "active";
      const b = bucketRef.current;
      if (hidden) b.away += 1; else if (idleNow) b.idle += 1; else b.active += 1;
      setIsIdle(idleNow);
      sinceBeatRef.current += 1; sinceSelfieRef.current += 1;

      // Flush on schedule OR the moment status flips (so the admin sees it in ~1s).
      const statusChanged = prevStatusRef.current !== liveStatus;
      const due = sinceBeatRef.current >= HEARTBEAT_EVERY_S;
      if (due || statusChanged) {
        prevStatusRef.current = liveStatus;
        const wantSelfie = sinceSelfieRef.current >= selfieEveryS;
        let selfie: string | null = null, screen: string | null = null, faceOk: boolean | null = null;
        if (wantSelfie) {
          if (videoRef.current && streamRef.current) {
            selfie = snapshotJpeg(videoRef.current);
            if (selfie) {
              // faceOk: true = matched enrolled face, false = a face was read but did
              // NOT match (or no face), null = no enrolled face → can't verify
              // (unverified, not a failure).
              if (faceDescriptor) {
                faceOk = false;
                try {
                  const fa = await import("@/lib/face/face-api-loader");
                  await fa.loadFaceModels(); // MUST load nets before inference (idempotent)
                  const d = await fa.getDescriptorFromVideo(videoRef.current);
                  if (d) faceOk = euclid(d, faceDescriptor) < FACE_MATCH_THRESHOLD;
                } catch { /* face lib failed → faceOk stays false */ }
              } else {
                faceOk = null;
              }
            }
          }
          // Screen snapshot. On the APK, pull a frame from the native MediaProjection
          // plugin (returns a base64 JPEG). On the web, grab it from the shared-screen
          // <video>. Either way it's only present if screen monitoring was granted.
          const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { ScreenCapture?: { snapshot: () => Promise<{ jpeg: string | null; err?: string }> } } } }).Capacitor;
          if (cap?.isNativePlatform?.() && cap.Plugins?.ScreenCapture) {
            try {
              const r = await cap.Plugins.ScreenCapture.snapshot();
              screen = r?.jpeg ?? null;
              if (!screen && r?.err) console.warn("[WFH] native screen snapshot failed:", r.err);
            } catch (e) { screen = null; console.warn("[WFH] native screen snapshot threw:", e); }
          } else if (screenVideoRef.current && screenStreamRef.current) {
            screen = snapshotScreen(screenVideoRef.current);
          } else if (cap?.isNativePlatform?.()) {
            console.warn("[WFH] ScreenCapture plugin not available on native platform");
          }
          sinceSelfieRef.current = 0;
        }
        const payload = { activeSeconds: b.active, idleSeconds: b.idle, awaySeconds: b.away, bucketStart: b.start, selfie, screen, faceOk, lastStatus: liveStatus };
        bucketRef.current = { active: 0, idle: 0, away: 0, start: new Date().toISOString() };
        sinceBeatRef.current = 0;
        try { await wfhHeartbeat(payload); } catch { /* best-effort */ }
      }
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, faceDescriptor, ctx?.idleAfterS, ctx?.selfieEveryS]);

  // Nothing renders for onsite/non-WFH users. WFH users get only the hidden camera
  // + the idle reminder pop-up (everything else is admin-only, server-side).
  if (!tracking) return null;

  return (
    <>
      <video ref={videoRef} playsInline muted className="hidden" />
      <video ref={screenVideoRef} playsInline muted className="hidden" />

      {/* Shift-activation opt-in (web only; the APK grants this natively). Framed as
          activating the shift so there's no mention of screen capture. */}
      {!screenOn && !isNative && (
        <div className="fixed bottom-4 right-4 z-[120] w-80 rounded-xl border-2 border-amber-400 bg-white p-4 shadow-2xl ring-4 ring-amber-400/20">
          <p className="text-sm font-bold text-slate-800">Activate your shift</p>
          <p className="mt-1 text-xs text-slate-500">One more step to start your shift. Click below, then choose <b>Entire Screen</b> → <b>Share</b> to activate.</p>
          {screenErr && <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">{screenErr}</p>}
          <button onClick={startScreenShare} className="mt-3 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-accent hover:bg-primary/90">
            Activate shift
          </button>
        </div>
      )}

      {isIdle && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-7 text-center shadow-2xl" style={{ animation: "pf-modal 200ms ease-out" }}>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl font-bold text-amber-600">!</div>
            <p className="text-lg font-bold text-slate-800">Is your shift still active?</p>
            <p className="mt-1.5 text-sm text-slate-500">Your shift timer paused after a while of inactivity. Move your mouse or tap a key to keep it running.</p>
            <button onClick={() => { lastInputRef.current = Date.now(); setIsIdle(false); }}
              className="mt-5 w-full rounded-xl bg-primary px-6 py-3 text-base font-semibold text-accent hover:bg-primary/90">
              I&apos;m back
            </button>
          </div>
        </div>
      )}
    </>
  );
}
