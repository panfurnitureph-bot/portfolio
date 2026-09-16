"use client";

import { useRef, useState, useTransition } from "react";
import { uploadProductImage, deleteStorageImage } from "@/app/products/actions";
import { cn } from "./ui";

// Digital signature pad — customer signs on screen (mouse/touch), saved as a PNG to storage.
// big = malaking full-width pad para sa tablet pop-up (customer mismo ang pipirma).
export function SignaturePad({ value, onChange, folder, big = false }: { value: string | null; onChange: (url: string | null) => void; folder?: string; big?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function point(e: React.MouseEvent | React.TouchEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const t = "touches" in e ? e.touches[0] : (e as React.MouseEvent);
    return { x: ((t.clientX - r.left) / r.width) * c.width, y: ((t.clientY - r.top) / r.height) * c.height };
  }
  function start(e: React.MouseEvent | React.TouchEvent) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = point(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  }
  function move(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    if ("touches" in e) e.preventDefault();
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = point(e); ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "#111"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
    setDirty(true);
  }
  function clearCanvas() {
    const c = canvasRef.current; if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setDirty(false);
  }
  function save() {
    const c = canvasRef.current; if (!c) return;
    setError(null);
    startSave(async () => {
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
      if (!blob) { setError("Could not capture signature."); return; }
      const fd = new FormData();
      fd.append("file", new File([blob], "signature.png", { type: "image/png" }));
      if (folder) fd.append("folder", folder);
      const r = await uploadProductImage(fd);
      if ("error" in r) { setError(r.error); return; }
      onChange(r.url); clearCanvas();
    });
  }

  if (value) {
    return (
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value} alt="signature" className="h-24 w-64 rounded-lg border border-border bg-white object-contain" />
        <button onClick={() => { deleteStorageImage(value).catch(() => {}); onChange(null); }} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-stone-100">Re-sign</button>
      </div>
    );
  }
  return (
    <div className={big ? "block w-full" : "inline-block"}>
      <canvas
        ref={canvasRef} width={big ? 1200 : 512} height={big ? 480 : 180}
        className={cn(
          "cursor-crosshair touch-none rounded-lg border-2 border-dashed border-border bg-white",
          big ? "h-[min(60vh,480px)] w-full" : "h-[180px] w-full max-w-[512px]",
        )}
        onMouseDown={start} onMouseMove={move} onMouseUp={() => (drawing.current = false)} onMouseLeave={() => (drawing.current = false)}
        onTouchStart={start} onTouchMove={move} onTouchEnd={() => (drawing.current = false)}
      />
      <div className="mt-1 flex items-center gap-2">
        <button onClick={clearCanvas} className="rounded-lg border border-border px-3 py-1 text-xs font-medium hover:bg-stone-100">Clear</button>
        <button onClick={save} disabled={!dirty || saving} className={cn("rounded-lg px-3 py-1 text-xs font-medium text-primary-foreground", dirty ? "bg-primary hover:opacity-90" : "bg-stone-300", saving && "opacity-50")}>{saving ? "Saving…" : "Save Signature"}</button>
        <span className="text-xs text-muted">Sign above with mouse / finger</span>
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
