"use client";

// RAIL — ang carousel ng bagong homepage (2026-09-04). Hindi native scroll:
// transform track na may drag + inertia, snap sa buong card, ease-out na
// galaw, arrows sa section head, progress bar, at autoplay na nasa screen
// lang. Ang bilang ng card kada hilera ay nakatakda kada breakpoint (`n`)
// para laging buo ang card sa gilid — walang putol.

import Link from "next/link";
import { Children, useEffect, useRef, useState, type ReactNode } from "react";

const GAP = 14;

export default function Rail({
  eyebrow,
  title,
  sub,
  link,
  n = [5, 4, 3, 2],
  autoplay = true,
  dark = false,
  children,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  link?: { label: string; href: string };
  // cards per row: [≥1100px, ≥900px, ≥640px, phone]
  n?: [number, number, number, number];
  autoplay?: boolean;
  dark?: boolean;
  children: ReactNode;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const x = useRef(0);
  const max = useRef(0);
  const anim = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const visible = useRef(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [prog, setProg] = useState({ w: 20, t: 0 });
  const count = Children.count(children);

  useEffect(() => {
    const r = rail.current, t = track.current;
    if (!r || !t) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const items = () => Array.from(t.children) as HTMLElement[];
    const offsets = () => { const o: number[] = []; let a = 0; for (const c of items()) { o.push(a); a += c.getBoundingClientRect().width + GAP; } return o; };
    const clamp = (v: number) => Math.min(0, Math.max(-max.current, v));
    const apply = (v: number) => {
      t.style.transform = `translate3d(${v}px,0,0)`;
      const m = max.current;
      setAtStart(v >= -1); setAtEnd(v <= -m + 1);
      const w = Math.max(r.clientWidth / Math.max(t.scrollWidth, 1), 0.08);
      setProg({ w: w * 100, t: m ? (-v / m) * (100 / w - 100) : 0 });
    };
    const fit = () => {
      const w = window.innerWidth;
      const per = w >= 1100 ? n[0] : w >= 900 ? n[1] : w >= 640 ? n[2] : n[3];
      const cw = (r.clientWidth - GAP * (per - 1)) / per;
      r.style.setProperty("--cw", `${cw}px`);
    };
    const measure = () => { fit(); max.current = Math.max(t.scrollWidth - r.clientWidth, 0); x.current = clamp(x.current); apply(x.current); };
    const nearest = (v: number) => { const o = offsets(); let best = 0, bd = 1e9; o.forEach((p, i) => { const d = Math.abs(-v - p); if (d < bd) { bd = d; best = i; } }); return best; };
    const to = (target: number, dur = 640) => {
      cancelAnimationFrame(anim.current);
      target = clamp(target);
      if (reduce) { x.current = target; apply(target); return; }
      const from = x.current, d = target - from; let t0: number | null = null;
      const f = (ts: number) => { if (t0 === null) t0 = ts; const p = Math.min((ts - t0) / dur, 1); const e = 1 - Math.pow(1 - p, 4); x.current = from + d * e; apply(x.current); if (p < 1) anim.current = requestAnimationFrame(f); };
      anim.current = requestAnimationFrame(f);
    };
    const snapTo = (i: number, dur?: number) => { const o = offsets(); const k = Math.max(0, Math.min(i, o.length - 1)); to(-o[k], dur); };
    const next = () => { if (-x.current >= max.current - 1) { snapTo(0, 900); return; } snapTo(nearest(x.current) + 1); };
    const prev = () => snapTo(nearest(x.current) - 1);

    const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
    const restart = () => { stop(); if (autoplay && !reduce && visible.current && max.current > 0) timer.current = setInterval(next, 6000); };

    // drag (mouse) — walang pointer capture para tumama pa rin ang click sa card
    let down = false, sx = 0, sxx = 0, lastX = 0, lastT = 0, vel = 0, moved = false;
    const onDown = (e: PointerEvent) => { if (e.button || e.pointerType === "touch") return; down = true; moved = false; sx = e.clientX; sxx = x.current; lastX = e.clientX; lastT = performance.now(); vel = 0; cancelAnimationFrame(anim.current); stop(); };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      if (!moved && Math.abs(e.clientX - sx) > 4) { moved = true; r.classList.add("dragging"); }
      let nx = sxx + (e.clientX - sx);
      if (nx > 0) nx *= 0.35; if (nx < -max.current) nx = -max.current + (nx + max.current) * 0.35;
      x.current = nx; apply(nx);
      const now = performance.now(); vel = (e.clientX - lastX) / Math.max(now - lastT, 1); lastX = e.clientX; lastT = now;
    };
    const onUp = () => { if (!down) return; down = false; r.classList.remove("dragging"); if (moved) snapTo(nearest(x.current + vel * 260), Math.abs(vel) > 0.4 ? 700 : 520); restart(); };
    const onClick = (e: MouseEvent) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } };
    // touch — swipe na sumusunod sa daliri
    let tx0 = 0, tX = 0;
    const onTS = (e: TouchEvent) => { tx0 = e.touches[0].clientX; tX = x.current; cancelAnimationFrame(anim.current); stop(); };
    const onTM = (e: TouchEvent) => { let nx = tX + (e.touches[0].clientX - tx0); if (nx > 0) nx *= 0.35; if (nx < -max.current) nx = -max.current + (nx + max.current) * 0.35; x.current = nx; apply(nx); };
    const onTE = (e: TouchEvent) => { const dx = e.changedTouches[0].clientX - tx0; snapTo(nearest(x.current + dx * 1.2), 520); restart(); };
    // trackpad
    let wt: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => { if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; e.preventDefault(); cancelAnimationFrame(anim.current); x.current = clamp(x.current - e.deltaX); apply(x.current); if (wt) clearTimeout(wt); wt = setTimeout(() => snapTo(nearest(x.current), 420), 120); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowRight") { next(); restart(); } if (e.key === "ArrowLeft") { prev(); restart(); } };

    r.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    r.addEventListener("click", onClick, true);
    r.addEventListener("touchstart", onTS, { passive: true });
    r.addEventListener("touchmove", onTM, { passive: true });
    r.addEventListener("touchend", onTE, { passive: true });
    r.addEventListener("wheel", onWheel, { passive: false });
    r.addEventListener("keydown", onKey);
    r.addEventListener("mouseenter", stop);
    r.addEventListener("mouseleave", restart);
    const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => { visible.current = es[0].isIntersecting; restart(); }, { threshold: 0.4 }) : null;
    io?.observe(r); if (!io) { visible.current = true; restart(); }
    const ro = "ResizeObserver" in window ? new ResizeObserver(measure) : null;
    ro?.observe(t);
    const onResize = () => { measure(); snapTo(nearest(x.current), 200); };
    window.addEventListener("resize", onResize);
    (r as HTMLDivElement & { _next?: () => void; _prev?: () => void })._next = () => { next(); restart(); };
    (r as HTMLDivElement & { _next?: () => void; _prev?: () => void })._prev = () => { prev(); restart(); };
    measure();
    return () => {
      stop(); cancelAnimationFrame(anim.current); io?.disconnect(); ro?.disconnect();
      r.removeEventListener("pointerdown", onDown); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp);
      r.removeEventListener("click", onClick, true); r.removeEventListener("touchstart", onTS); r.removeEventListener("touchmove", onTM); r.removeEventListener("touchend", onTE); r.removeEventListener("wheel", onWheel); r.removeEventListener("keydown", onKey);
      r.removeEventListener("mouseenter", stop); r.removeEventListener("mouseleave", restart); window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, autoplay, n[0], n[1], n[2], n[3]]);

  const go = (dir: 1 | -1) => { const r = rail.current as (HTMLDivElement & { _next?: () => void; _prev?: () => void }) | null; if (!r) return; dir > 0 ? r._next?.() : r._prev?.(); };
  const ink = dark ? "text-cream" : "text-ink";
  const muted = dark ? "text-cream/75" : "text-stone";
  const btn = dark ? "border-gold text-gold hover:bg-gold hover:text-brownDeep" : "border-brown text-brown hover:bg-brown hover:text-cream";

  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-5 flex-wrap">
        <div>
          {eyebrow && <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-goldDeep">{eyebrow}</p>}
          <h2 className={`font-cormorant font-semibold text-[clamp(22px,2.6vw,30px)] leading-[1.05] mt-1.5 ${ink}`}>{title}</h2>
          {sub && <p className={`text-sm mt-1.5 max-w-[60ch] ${muted}`}>{sub}</p>}
        </div>
        <div className="flex items-center gap-3.5">
          {link && (
            <Link href={link.href} className={`text-[11.5px] font-bold tracking-[0.14em] uppercase border-b-[1.5px] pb-0.5 whitespace-nowrap ${dark ? "text-gold border-gold" : "text-ink border-goldDeep"}`}>
              {link.label}
            </Link>
          )}
          {count > 1 && (
            <div className="flex gap-1.5">
              <button type="button" aria-label="Previous" disabled={atStart} onClick={() => go(-1)} className={`w-8 h-8 border text-[17px] leading-none flex items-center justify-center bg-transparent disabled:opacity-35 disabled:cursor-default ${btn}`}>‹</button>
              <button type="button" aria-label="Next" disabled={atEnd} onClick={() => go(1)} className={`w-8 h-8 border text-[17px] leading-none flex items-center justify-center bg-transparent disabled:opacity-35 disabled:cursor-default ${btn}`}>›</button>
            </div>
          )}
        </div>
      </div>
      <div
        ref={rail}
        tabIndex={0}
        className="rail overflow-hidden py-1 px-0.5 cursor-grab select-none [touch-action:pan-y] [&.dragging]:cursor-grabbing outline-none"
      >
        {/* min-w-0 + width sa bawat slot (2026-09-06, "di na naman equal"): ang card
            na may 3 color thumbs ay mas malapad ang min-content kaysa sa slot, kaya
            lumalaki ang flex item at tumatangkad ang square na litrato. */}
        <div ref={track} className="flex will-change-transform [transform:translate3d(0,0,0)]" style={{ gap: GAP }}>
          {Children.map(children, (c) => (
            <div className="shrink-0 grow-0 min-w-0" style={{ flexBasis: "var(--cw, 220px)", width: "var(--cw, 220px)" }}>{c}</div>
          ))}
        </div>
      </div>
      {count > 1 && (
        <div className={`h-0.5 mt-1.5 relative overflow-hidden ${dark ? "bg-cream/15" : "bg-sand"}`}>
          <i className="absolute left-0 top-0 bottom-0 bg-goldDeep" style={{ width: `${prog.w}%`, transform: `translateX(${prog.t}%)` }} />
        </div>
      )}
    </div>
  );
}
