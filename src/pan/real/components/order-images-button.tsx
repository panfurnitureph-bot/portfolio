"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./modal";

export function OrderImagesButton({ images, title }: { images: string[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const imgs = images ?? [];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Receipt images"
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-stone-100 hover:text-primary"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L4 22" /></svg>
        {imgs.length > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{imgs.length}</span>}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Receipt / Transaction Images" description={title} size="lg"
        footer={<div className="flex justify-end"><button onClick={() => setOpen(false)} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Close</button></div>}>
        {imgs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No receipt images uploaded yet. Add via Edit → Receipt / Transaction Images.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {imgs.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img loading="lazy" decoding="async" key={i} src={url} alt={`receipt ${i + 1}`} onClick={() => setPreview(url)} className="h-32 w-full cursor-zoom-in rounded-lg border border-border object-cover hover:opacity-90" />
            ))}
          </div>
        )}
      </Modal>

      {preview && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img loading="lazy" decoding="async" src={preview} alt="preview" onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />
          <button type="button" onClick={() => setPreview(null)} className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-xl text-stone-700 hover:bg-white" aria-label="Close">✕</button>
        </div>,
        document.body,
      )}
    </>
  );
}
