"use client";

import { useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { uploadProductImage, deleteStorageImage, signImageUpload } from "@/app/products/actions";
import { createBrowserSupabase } from "@/lib/supabase/client";

// Upload any number of images → returns an array of public URLs.
export function MultiImageUpload({
  value,
  onChange,
  onRemove,
  camera,
  folder,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  onRemove?: (url: string) => void; // called INSTEAD of onChange when the ✕ is tapped, so callers can track deletions explicitly
  camera?: boolean; // also show a "Take Photo" button (opens the device camera on mobile/tablet)
  folder?: string;  // storage subfolder (e.g. "installation-photos")
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const camInputRef = useRef<HTMLInputElement>(null); // native camera (capture attr)
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // BILISAN ANG UPLOAD (lalo sa APK/phone camera): i-compress muna sa browser —
  // max 1600px JPEG ~80% (3–5 MB camera shot → ~200–400 KB, 5–10× bilis) bago
  // ipadala. Kapag pumalya ang compression (lumang WebView), raw file fallback.
  async function compressImage(file: File): Promise<File> {
    if (!/^image\//.test(file.type) || /svg/i.test(file.type) || file.size < 300_000) return file;
    try {
      let bmp: ImageBitmap;
      try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions); }
      catch { bmp = await createImageBitmap(file); }
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.8));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
    } catch { return file; }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setError(null);
    startTransition(async () => {
      // SABAY-SABAY ang uploads (dating isa-isa) — pagkatapos ng compression.
      const results = await Promise.all(files.map(async (file) => {
        try {
          const small = await compressImage(file);
          // DIREKTA SA STORAGE (2026-08-31): ang server ay pumipirma lang;
          // ang bytes ay mula browser diretso sa Supabase — hindi na
          // dumadaan sa Node server, kaya hindi na ito nasasabit kapag
          // abala ang server, at isang biyahe na lang ang layo ng litrato.
          const signed = await signImageUpload({ name: small.name || file.name, folder });
          if (!("error" in signed)) {
            const sb = createBrowserSupabase();
            const up = await sb.storage.from(signed.bucket)
              .uploadToSignedUrl(signed.path, signed.token, small, { contentType: small.type || "image/jpeg" });
            if (!up.error) return signed.url;
          }
          // FALLBACK: ang lumang daan (bytes sa server) — kapag pumalya ang
          // pirma o ang direktang padala (hal. network na ayaw sa storage
          // host), hindi nawawala ang upload.
          const fd = new FormData();
          fd.append("file", small);
          if (folder) fd.append("folder", folder);
          const res = await uploadProductImage(fd);
          if ("error" in res) { setError(res.error); return null; }
          return res.url;
        } catch (err) {
          // Surface the REAL exception (server-action failure inside the WebView) instead
          // of letting it bubble into the WebView's "This page couldn't load" screen.
          setError("Upload failed: " + (err instanceof Error ? err.message : String(err)));
          return null;
        }
      }));
      const urls = results.filter((u): u is string => !!u);
      if (urls.length) onChange([...value, ...urls]);
    });
    e.target.value = "";
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((url, i) => (
          <div key={i} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-border bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              loading="lazy"
              decoding="async"
              src={url}
              alt="receipt"
              onClick={() => setPreview(url)}
              className="h-full w-full cursor-zoom-in object-cover"
            />
            {/* Always visible — the tablet/APK WebView has no hover, so a
                hover-only ✕ can never be tapped. Slightly larger tap target too. */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (onRemove) onRemove(url); else onChange(value.filter((_, j) => j !== i)); deleteStorageImage(url).catch(() => {}); }}
              className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-sm text-white shadow-sm active:bg-black"
              aria-label="Remove"
            >
              ✕
            </button>
          </div>
        ))}

        {/* Gallery "Add" — DESKTOP LANG; sa APK laging kamera (Take Photo) ang gamit. */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="apk-hide flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-stone-50 text-xs text-muted transition-colors hover:border-primary disabled:opacity-60"
        >
          {pending ? "Uploading…" : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
              Add
            </>
          )}
        </button>

        {/* Take Photo: laging rendered — sa desktop, kapag camera prop lang;
            sa APK, laging kita (apk-only) kahit hindi naka-camera ang caller. */}
        <button
          type="button"
          onClick={() => camInputRef.current?.click()}
          disabled={pending}
          className={`${camera ? "flex" : "apk-only"} h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-stone-50 text-xs text-muted transition-colors hover:border-primary disabled:opacity-60`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M14.5 4h-5L8 6H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-4l-1.5-2Z" /><circle cx="12" cy="13" r="3.2" /></svg>
          {pending ? "Uploading…" : "Take Photo"}
        </button>
      </div>

      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={onPick} />
      {/* "Take Photo" → open the DEVICE's native full-screen camera (capture attribute),
          not the small in-page web-camera preview. Same upload handler as file picking. */}
      <input ref={camInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
      <p className="text-xs text-muted">PNG / JPG, up to 5 MB each. Upload any number. Click an image to preview.</p>
      {error && <p className="text-xs font-medium text-danger">{error}</p>}

      {/* Lightbox preview — portaled to body so it's truly fullscreen */}
      {preview &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
            onClick={() => setPreview(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              loading="lazy"
              decoding="async"
              src={preview}
              alt="preview"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-xl text-stone-700 hover:bg-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
