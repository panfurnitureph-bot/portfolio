"use client";

import { useRef, useState } from "react";

// Return the image URL as-is. (An earlier version rewrote Supabase Storage URLs to the
// /render/image transform with a ?width= param, but that transform endpoint requires the
// paid Supabase Image Transformation add-on — without it, every rewritten URL 400s, which
// broke image rendering right after an upload. So we keep the original URL; lazy-loading
// on the <img> tags still avoids fetching off-screen images. `width` is accepted but
// unused to keep all call sites unchanged.)
export function sizedImg(url: string, _width?: number): string {
  void _width;
  return url;
}

// 40x40 thumbnail; hover shows a 200x200 fixed-position preview that
// escapes table overflow clipping and stays inside the viewport.
export function Thumbnail({ name, url }: { name: string; url?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  if (!url) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-stone-200 text-[10px] font-semibold text-stone-500">
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  function showPreview() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const size = 200;
    const gap = 12;
    let x = r.right + gap;
    if (x + size > window.innerWidth - 8) x = r.left - size - gap;
    x = Math.max(8, x);
    let y = r.top + r.height / 2 - size / 2;
    y = Math.max(8, Math.min(y, window.innerHeight - size - 8));
    setPos({ x, y });
  }

  return (
    <div
      ref={ref}
      className="h-10 w-10 shrink-0"
      onMouseEnter={showPreview}
      onMouseLeave={() => setPos(null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sizedImg(url, 80)}
        alt={name}
        loading="lazy"
        decoding="async"
        className="h-10 w-10 cursor-zoom-in rounded object-cover ring-1 ring-border"
      />
      {pos && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sizedImg(url, 400)}
          alt={name}
          style={{ position: "fixed", left: pos.x, top: pos.y, width: 200, height: 200 }}
          className="pf-fade pointer-events-none z-[100] rounded-xl bg-white object-contain p-2 shadow-2xl ring-1 ring-border"
        />
      )}
    </div>
  );
}
