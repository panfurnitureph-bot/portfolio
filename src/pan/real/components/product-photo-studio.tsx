"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { uploadProductImage } from "@/app/products/actions";
import { removeBgHd } from "@/app/products/removebg-actions";

// Composite a transparent cutout (Blob) onto pure white → JPEG Blob.
async function compositeOnWhite(cutout: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(cutout);
  const out = document.createElement("canvas");
  out.width = bmp.width; out.height = bmp.height;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/jpeg", 0.92));
  if (!blob) throw new Error("Compositing failed.");
  return blob;
}

// Product catalog photo booth: open the device camera → snap the item → strip the
// background on-device (@imgly, no API cost, private) → composite onto pure white →
// upload → return the URL. Produces a clean studio-style catalog image.
//
// When the free on-device cutout isn't clean enough (busy background), an "HD
// Cleanup" button re-runs the ORIGINAL frame through a self-hosted rembg service
// for a pure result. The @imgly model (~few MB WASM) downloads once and is cached.
export function ProductPhotoStudio({
  folder,
  onDone,
  onClose,
}: {
  folder?: string;
  onDone: (url: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // stage: "live" (camera) → "processing" (bg removal) → "review" (show result)
  const [stage, setStage] = useState<"live" | "processing" | "review">("live");
  const [progress, setProgress] = useState<string>("");
  const [resultUrl, setResultUrl] = useState<string | null>(null); // local object URL for preview
  const resultBlobRef = useRef<Blob | null>(null);
  const originalBlobRef = useRef<Blob | null>(null); // raw captured frame (for HD re-clean)
  const [hdCleaning, startHd] = useTransition();
  const [saving, startSave] = useTransition();

  // Start the camera whenever we're on the live stage.
  useEffect(() => {
    if (stage !== "live") return;
    let active = true;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1600 }, height: { ideal: 1600 } }, audio: false })
      .then((s) => {
        if (!active) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); }
      })
      .catch((e) => setErr("Cannot access camera: " + (e?.message ?? e)));
    return () => { active = false; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  }, [stage]);

  // Snap the current frame → remove background → composite on white → preview.
  async function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    // Grab the frame to a canvas.
    const cap = document.createElement("canvas");
    cap.width = v.videoWidth; cap.height = v.videoHeight;
    cap.getContext("2d")!.drawImage(v, 0, 0);
    // Stop the camera — we have the frame.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setErr(null);
    setStage("processing");
    setProgress("Loading model…");
    try {
      const srcBlob = await new Promise<Blob | null>((r) => cap.toBlob(r, "image/jpeg", 0.95));
      if (!srcBlob) throw new Error("Capture failed.");
      originalBlobRef.current = srcBlob; // keep the raw frame for optional HD re-clean

      const { removeBackground } = await import("@imgly/background-removal");
      const cutout = await removeBackground(srcBlob, {
        model: "isnet", // full-precision model — cleanest edges/matting for catalog shots
        progress: (key, cur, total) => {
          const pct = total ? Math.round((cur / total) * 100) : 0;
          setProgress(key.startsWith("fetch") ? `Loading model… ${pct}%` : `Removing background… ${pct}%`);
        },
      });

      const finalBlob = await compositeOnWhite(cutout);
      resultBlobRef.current = finalBlob;
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(finalBlob));
      setStage("review");
    } catch (e) {
      setErr("Background removal failed: " + ((e as Error)?.message ?? e));
      setStage("review"); // let the user retake
    }
  }

  // HD re-clean: send the ORIGINAL frame to the self-hosted rembg service for a pure cutout,
  // composite on white, and replace the preview. Falls back with an error if the
  // key isn't configured or the API fails — the free result stays usable.
  function hdCleanup() {
    const src = originalBlobRef.current;
    if (!src) return;
    setErr(null);
    startHd(async () => {
      const fd = new FormData();
      fd.append("file", new File([src], "capture.jpg", { type: "image/jpeg" }));
      const res = await removeBgHd(fd);
      if ("error" in res) { setErr(res.error); return; }
      try {
        const pngBlob = await (await fetch(res.png)).blob(); // data URL → Blob
        const finalBlob = await compositeOnWhite(pngBlob);
        resultBlobRef.current = finalBlob;
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        setResultUrl(URL.createObjectURL(finalBlob));
      } catch (e) {
        setErr("HD cleanup compositing failed: " + ((e as Error)?.message ?? e));
      }
    });
  }

  function retake() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    resultBlobRef.current = null;
    setErr(null);
    setStage("live");
  }

  function use() {
    const blob = resultBlobRef.current;
    if (!blob) return;
    startSave(async () => {
      const fd = new FormData();
      fd.append("file", new File([blob], "catalog.jpg", { type: "image/jpeg" }));
      if (folder) fd.append("folder", folder);
      const res = await uploadProductImage(fd);
      if ("error" in res) { setErr(res.error); return; }
      onDone(res.url);
      onClose();
    });
  }

  // Cleanup object URL on unmount.
  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      <div className="flex w-full max-w-lg flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="w-full text-center text-sm font-semibold text-white">
          Product Photo — auto white background
        </div>

        {/* Live camera */}
        {stage === "live" && (
          err
            ? <p className="max-w-sm text-center text-sm text-white">{err}</p>
            /* eslint-disable-next-line jsx-a11y/media-has-caption */
            : <video ref={videoRef} playsInline muted className="max-h-[64vh] w-full rounded-xl bg-stone-900 object-contain" />
        )}

        {/* Processing */}
        {stage === "processing" && (
          <div className="flex h-64 w-full flex-col items-center justify-center gap-3 rounded-xl bg-stone-900 text-white">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <p className="text-sm">{progress || "Working…"}</p>
            <p className="text-xs text-white/60">First run downloads the model once, then it&apos;s cached.</p>
          </div>
        )}

        {/* Review result */}
        {stage === "review" && (
          <>
            {resultUrl
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={resultUrl} alt="result" className="max-h-[64vh] w-full rounded-xl bg-white object-contain ring-1 ring-white/20" />
              : <p className="max-w-sm text-center text-sm text-white">{err ?? "No result."}</p>}
            {err && <p className="max-w-sm text-center text-xs text-rose-300">{err}</p>}
            <p className="max-w-md text-center text-[11px] text-white/60">Messy edges? Tap <b className="text-white/80">HD Cleanup</b> for a sharper cloud pass.</p>
          </>
        )}

        {/* Controls */}
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="rounded-lg bg-white/20 px-5 py-2 text-sm font-medium text-white hover:bg-white/30">Cancel</button>
          {stage === "live" && !err && (
            <button onClick={snap} className="rounded-full bg-white px-7 py-2.5 text-sm font-semibold text-stone-900 shadow-lg hover:bg-stone-100">Capture</button>
          )}
          {stage === "review" && (
            <>
              <button onClick={retake} disabled={hdCleaning || saving} className="rounded-lg bg-white/20 px-5 py-2 text-sm font-medium text-white hover:bg-white/30 disabled:opacity-50">↺ Retake</button>
              {originalBlobRef.current && (
                <button onClick={hdCleanup} disabled={hdCleaning || saving} className="rounded-lg bg-white/20 px-5 py-2 text-sm font-medium text-white hover:bg-white/30 disabled:opacity-50">
                  {hdCleaning ? "Cleaning…" : "HD Cleanup"}
                </button>
              )}
              {resultBlobRef.current && (
                <button onClick={use} disabled={saving || hdCleaning} className="rounded-full bg-[#caa45a] px-7 py-2.5 text-sm font-bold text-[#2a2110] shadow-lg hover:brightness-105 disabled:opacity-60">
                  {saving ? "Saving…" : "✓ Use photo"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
