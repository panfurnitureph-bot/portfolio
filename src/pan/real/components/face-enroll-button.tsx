"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadFaceModels, getDescriptorFromVideo, hasFace } from "@/lib/face/face-api-loader";
import { saveFaceDescriptor, clearFaceDescriptor, setCanEnroll } from "@/app/hr/directory/face-actions";

type Props = {
  employeeId: number;
  employeeName: string;
  enrolled: boolean;
  // Whether this employee is an authorized kiosk enroller (face opens enroll panel).
  canEnroll?: boolean;
  // Compact pill for table rows; default is a full button for the detail page.
  variant?: "button" | "pill";
};

export function FaceEnrollButton({ employeeId, employeeName, enrolled, canEnroll = false, variant = "button" }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      {variant === "pill" ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ring-[#caa45a] text-[#7a5a1a] hover:bg-[#faf3e2]"
          title="Enroll face for kiosk attendance"
        >
          {enrolled ? "Face ✓" : "Enroll Face"}
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#4a3b1a] px-4 py-2 text-sm font-semibold text-[#f4ead8] hover:bg-[#5a4a26]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0" /></svg>
          {enrolled ? "Re-enroll Face" : "Enroll Face"}
        </button>
      )}
      {open && (
        <EnrollModal
          employeeId={employeeId}
          employeeName={employeeName}
          enrolled={enrolled}
          canEnroll={canEnroll}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); router.refresh(); }}
        />
      )}
    </>
  );
}

// Center-crop the live video to a square, downscale to 240px, return a small JPEG
// data URL. Returns null if the frame isn't ready. Not mirrored — stored upright.
function snapshotJpeg(video: HTMLVideoElement): string | null {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2, sy = (vh - side) / 2;
  const out = 240;
  const canvas = document.createElement("canvas");
  canvas.width = out; canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, side, side, 0, 0, out, out);
  try { return canvas.toDataURL("image/jpeg", 0.7); } catch { return null; }
}

function EnrollModal({
  employeeId, employeeName, enrolled, canEnroll, onClose, onDone,
}: {
  employeeId: number; employeeName: string; enrolled: boolean; canEnroll: boolean; onClose: () => void; onDone: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "capturing" | "error">("loading");
  const [msg, setMsg] = useState<string | null>(null);
  const [canEnr, setCanEnr] = useState(canEnroll);
  const [pending, start] = useTransition();

  function toggleEnroller() {
    const next = !canEnr;
    setCanEnr(next); // optimistic
    start(async () => {
      const r = await setCanEnroll(employeeId, next);
      if ("error" in r) { setCanEnr(!next); setMsg(r.error); }
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadFaceModels();
        // 640x480 LANG (2026-09-03, "ambagal mag detect"): ang ibang webcam ay
        // nagde-default sa 1080p — ang landmarks/descriptor sa ganoong laki ay
        // 4-6x mas mabagal sa CPU. Sapat na sapat ang VGA sa recognition.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setPhase("error");
        const name = e instanceof DOMException ? e.name : "";
        setMsg(
          name === "NotAllowedError" ? "Camera permission denied. Allow camera access and try again."
          : name === "NotFoundError" ? "No camera found on this device."
          : e instanceof Error ? e.message : "Could not start the camera or load face models.",
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // LIVE NA "may mukha na" (2026-09-03): magaan na detect (96px, walang
  // landmarks) kada ~350ms habang naka-preview — kita agad kung pwede nang
  // pumindot, imbes na hulaan at maghintay sa mabigat na capture na sablay.
  const [faceSeen, setFaceSeen] = useState(false);
  useEffect(() => {
    if (phase !== "ready") return;
    let stop = false;
    let busy = false;
    const id = setInterval(async () => {
      if (stop || busy || !videoRef.current) return;
      busy = true;
      try { const ok = await hasFace(videoRef.current); if (!stop) setFaceSeen(ok); }
      catch { /* best-effort */ }
      finally { busy = false; }
    }, 350);
    return () => { stop = true; clearInterval(id); };
  }, [phase]);

  async function capture() {
    if (!videoRef.current) return;
    setMsg(null);
    setPhase("capturing");
    try {
      const desc = await getDescriptorFromVideo(videoRef.current);
      if (!desc) {
        setPhase("ready");
        setMsg("No single clear face detected. Center one face in the frame and try again.");
        return;
      }
      // Grab a small square JPEG snapshot of the current frame to store as the
      // enrollment avatar (shown in the kiosk recognized-popup). Center-cropped to
      // a square, downscaled to 240px, quality 0.7 → ~15-25 KB data URL.
      const photo = snapshotJpeg(videoRef.current);
      start(async () => {
        const r = await saveFaceDescriptor(employeeId, Array.from(desc), photo);
        if ("error" in r) { setPhase("ready"); setMsg(r.error); return; }
        onDone();
      });
    } catch {
      setPhase("ready");
      setMsg("Face capture failed. Try again.");
    }
  }

  function unenroll() {
    setMsg(null);
    start(async () => {
      const r = await clearFaceDescriptor(employeeId);
      if ("error" in r) { setMsg(r.error); return; }
      onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-[#4a3b1a] px-5 py-4">
          <h3 className="text-base font-semibold text-[#f4ead8]">Enroll Face — {employeeName}</h3>
          <p className="mt-0.5 text-xs text-[#caa45a]">Used for kiosk Face-ID attendance.</p>
        </div>
        <div className="p-5">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
            {phase === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-white">Loading camera &amp; models…</div>
            )}
            {phase === "error" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-6 text-center text-sm text-red-200">{msg}</div>
            )}
            {(phase === "ready" || phase === "capturing") && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className={`h-44 w-36 rounded-[45%] border-2 transition-colors ${faceSeen ? "border-emerald-400" : "border-[#caa45a]/80"}`} />
              </div>
            )}
            {phase === "ready" && (
              <div className={`pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-bold ${faceSeen ? "bg-emerald-500/90 text-white" : "bg-black/50 text-white/80"}`}>
                {faceSeen ? "Face detected — ready to capture" : "Position your face in the oval"}
              </div>
            )}
          </div>

          {msg && phase !== "error" && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{msg}</p>}

          {/* Authorized kiosk enroller — this person's FACE can open the kiosk
              enroll panel (no PIN). Grant only to HR/Admin. */}
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-stone-50 px-4 py-3">
            <input type="checkbox" checked={canEnr} onChange={toggleEnroller} disabled={pending} className="mt-0.5 h-4 w-4 accent-[#4a3b1a]" />
            <span className="text-sm">
              <span className="font-semibold text-foreground">Authorized to enroll faces at kiosk</span>
              <span className="mt-0.5 block text-xs text-muted">Their face opens the kiosk enroll panel — grant only to HR / Admin.</span>
            </span>
          </label>

          <div className="mt-4 flex items-center justify-between gap-2">
            {enrolled ? (
              <button onClick={unenroll} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-inset ring-red-600/20 hover:bg-red-50 disabled:opacity-50">Un-enroll</button>
            ) : <span className="text-xs text-muted">{enrolled ? "Enrolled" : "Not enrolled"}</span>}
            <div className="ml-auto flex gap-2">
              <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-stone-100">Cancel</button>
              <button
                onClick={capture}
                disabled={phase !== "ready" || pending}
                className="rounded-lg bg-[#caa45a] px-4 py-2 text-sm font-semibold text-[#4a3b1a] hover:opacity-90 disabled:opacity-50"
              >
                {pending || phase === "capturing" ? "Capturing…" : "Capture & Enroll"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
