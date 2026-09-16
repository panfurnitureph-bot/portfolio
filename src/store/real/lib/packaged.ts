// PACKAGED SIZE (2026-09-04): sukat ng produkto + ~2" kada gilid, mula sa
// dimensions text ng listing. Nasa lib (walang "use client") para matawag ng
// server page (/measuring) at ng client modal (FitModal) - ang pag-import ng
// function mula sa client component papunta sa server ay nagba-crash
// ("Attempted to call packagedFrom() from the server").

export type Packaged = { w: number; d: number; h: number };

// Hilahin ang W/D/H mula sa dimensions text (hal. `34" W x 24" D x 28" H`).
export function packagedFrom(dimensions: string): Packaged | null {
  const grab = (re: RegExp) => { const m = dimensions.match(re); return m ? Number(m[1]) : NaN; };
  const w = grab(/([\d.]+)\s*(?:"|”|in)?\s*W/i), d = grab(/([\d.]+)\s*(?:"|”|in)?\s*D(?![a-z])/i), h = grab(/([\d.]+)\s*(?:"|”|in)?\s*H/i);
  if (!(w > 0 && h > 0)) return null;
  // Naka-balot: dagdag ~2" kada gilid.
  return { w: Math.round(w + 2), d: Math.round((d > 0 ? d : Math.min(w, h)) + 2), h: Math.round(h + 2) };
}

