"use client";

// SILHOUETTE NG PRODUKTO SA LITRATO (2026-09-04): bounding box ng hindi-puting
// pixels (canvas sa browser). Ginagamit ng Dimensions photos (guhit sa gilid)
// at ng FitImage (pare-parehong laki ng produkto sa cards/tiles kahit iba-iba
// ang puting margin ng mga litrato).

import { useEffect, useState } from "react";

export type Box = { l: number; t: number; r: number; b: number }; // % ng container

// Bounding box ng produkto sa litrato (% ng litrato), o null kapag hindi
// ma-decode (walang CORS, sirang file) — fallback sa buong litrato.
export function useSubjectBoxes(srcs: string[]): (Box | null)[] {
  const [boxes, setBoxes] = useState<(Box | null)[]>([]);
  const key = srcs.join("|");
  useEffect(() => {
    let alive = true;
    setBoxes([]);
    srcs.forEach((src, idx) => {
    const setBox = (b: Box) => setBoxes((prev) => { const n = [...prev]; n[idx] = b; return n; });
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const W = 160, H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        const ctx = c.getContext("2d"); if (!ctx) return;
        ctx.drawImage(img, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        // background = median ng apat na sulok
        const corner = (x: number, y: number) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
        const cs = [corner(1, 1), corner(W - 2, 1), corner(1, H - 2), corner(W - 2, H - 2)];
        const bg = [0, 1, 2].map((k) => cs.map((c) => c[k]).sort((a, b) => a - b)[2]);
        let l = W, t = H, r = -1, b = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (d[i + 3] < 40) continue; // transparent = background
          const diff = Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));
          if (diff > 16) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
        }
        if (r < 0 || r - l < W * 0.1 || b - t < H * 0.1) return; // walang subject na nakita
        // % ng litrato → % ng parisukat na container (object-contain, nakasentro)
        const ar = img.naturalWidth / img.naturalHeight;
        const dw = ar >= 1 ? 100 : 100 * ar, dh = ar >= 1 ? 100 / ar : 100;
        const ox = (100 - dw) / 2, oy = (100 - dh) / 2;
        if (alive) setBox({ l: ox + (l / W) * dw, t: oy + (t / H) * dh, r: ox + ((r + 1) / W) * dw, b: oy + ((b + 1) / H) * dh });
      } catch { /* CORS-tainted canvas → fallback */ }
    };
    img.src = src;
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return boxes;
}

