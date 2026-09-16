"use client";

// TULOY-TULOY NA CAROUSEL (Joe 2026-09-06, "parang 21st.dev, hindi ung may
// timer na nag-tick"). Walang hakbang at walang timer: ang track ay dahan-
// dahang umaandar kada frame (requestAnimationFrame, ~26px/s), ang listahan
// ay dinodoble para walang dulo (kapag lumampas ang isang kopya, ibinabalik
// ang offset — walang kislap), humihinto sa hover/pindot/pagkawala sa
// screen, at maaaring hilahin (mouse/touch/trackpad) — pagkabitaw ay
// nagpapatuloy ang galaw. Parehong header at card slot sizing ng Rail.
import { Children, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";

const GAP = 14;

export default function Marquee({
  eyebrow,
  title,
  sub,
  link,
  n = [5, 4, 3, 2],
  speed = 26,
  reverse = false,
  dark = false,
  children,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  link?: { label: string; href: string };
  // cards per row: [≥1100px, ≥900px, ≥640px, phone]
  n?: [number, number, number, number];
  speed?: number;      // px kada segundo
  reverse?: boolean;   // pakanan ang galaw
  dark?: boolean;
  children: ReactNode;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const count = Children.count(children);
  // Ilang kopya ng listahan — sapat para laging may laman sa magkabilang
  // dulo kahit malapad ang screen at kaunti ang cards.
  const copies = count === 0 ? 1 : Math.max(2, Math.ceil(10 / count));

  useEffect(() => {
    const r = rail.current, t = track.current;
    if (!r || !t || count < 2) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let x = 0, setW = 0, raf = 0, last = 0, paused = false, visible = false, down = false, nudge = 0;

    const fit = () => {
      const w = window.innerWidth;
      const per = w >= 1100 ? n[0] : w >= 900 ? n[1] : w >= 640 ? n[2] : n[3];
      r.style.setProperty("--cw", `${(r.clientWidth - GAP * (per - 1)) / per}px`);
    };
    const measure = () => {
      fit();
      // Lapad ng ISANG kopya (kasama ang gap pagkatapos nito).
      const kids = Array.from(t.children) as HTMLElement[];
      const per = kids.length / copies;
      setW = 0;
      for (let i = 0; i < per; i++) setW += kids[i].getBoundingClientRect().width + GAP;
      apply();
    };
    const wrap = () => { if (setW <= 0) return; while (x <= -setW) x += setW; while (x > 0) x -= setW; };
    const apply = () => { wrap(); t.style.transform = `translate3d(${x}px,0,0)`; };
    const step = (ts: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min((ts - last) / 1000, 0.05); last = ts;
      // Nudge mula sa arrow: mabilis na easing, saka balik sa normal na drift.
      if (nudge !== 0) { const d = nudge * 0.16; x += d; nudge -= d; if (Math.abs(nudge) < 0.5) nudge = 0; apply(); return; }
      if (paused || !visible || down || reduce || document.hidden) return;
      // May video na nagpe-play (reviews) — huwag ilayo sa nanonood.
      if (t.querySelector("video") && Array.from(t.querySelectorAll("video")).some((v) => !v.paused && !v.ended)) return;
      x -= (reverse ? -1 : 1) * speed * dt;
      apply();
    };

    // drag (mouse) — walang pointer capture para tumama pa rin ang click sa card
    let sx = 0, sxx = 0, moved = false, lastX = 0, lastT = 0, vel = 0;
    const onDown = (e: PointerEvent) => { if (e.button || e.pointerType === "touch") return; down = true; moved = false; sx = e.clientX; sxx = x; lastX = e.clientX; lastT = performance.now(); vel = 0; };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      if (!moved && Math.abs(e.clientX - sx) > 4) { moved = true; r.classList.add("dragging"); }
      x = sxx + (e.clientX - sx); apply();
      const now = performance.now(); vel = (e.clientX - lastX) / Math.max(now - lastT, 1); lastX = e.clientX; lastT = now;
    };
    const onUp = () => { if (!down) return; down = false; r.classList.remove("dragging"); if (moved) nudge = vel * 220; };
    const onClick = (e: MouseEvent) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } };
    let tx0 = 0, tX = 0;
    const onTS = (e: TouchEvent) => { down = true; tx0 = e.touches[0].clientX; tX = x; };
    const onTM = (e: TouchEvent) => { x = tX + (e.touches[0].clientX - tx0); apply(); };
    const onTE = () => { down = false; };
    const onWheel = (e: WheelEvent) => { if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; e.preventDefault(); x -= e.deltaX; apply(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowRight") nudge -= cardW(); if (e.key === "ArrowLeft") nudge += cardW(); };
    const cardW = () => ((Array.from(t.children)[0] as HTMLElement | undefined)?.getBoundingClientRect().width ?? 220) + GAP;
    const onEnter = () => { paused = true; };
    const onLeave = () => { paused = false; };

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
    r.addEventListener("mouseenter", onEnter);
    r.addEventListener("mouseleave", onLeave);
    const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.2 }) : null;
    io?.observe(r); if (!io) visible = true;
    const ro = "ResizeObserver" in window ? new ResizeObserver(measure) : null;
    ro?.observe(t);
    window.addEventListener("resize", measure);
    (r as HTMLDivElement & { _nudge?: (d: 1 | -1) => void })._nudge = (d) => { nudge -= d * cardW(); };
    measure();
    last = performance.now();
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf); io?.disconnect(); ro?.disconnect();
      r.removeEventListener("pointerdown", onDown); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp);
      r.removeEventListener("click", onClick, true); r.removeEventListener("touchstart", onTS); r.removeEventListener("touchmove", onTM); r.removeEventListener("touchend", onTE); r.removeEventListener("wheel", onWheel);
      r.removeEventListener("keydown", onKey); r.removeEventListener("mouseenter", onEnter); r.removeEventListener("mouseleave", onLeave); window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, copies, speed, reverse, n[0], n[1], n[2], n[3]]);

  const go = (dir: 1 | -1) => { (rail.current as (HTMLDivElement & { _nudge?: (d: 1 | -1) => void }) | null)?._nudge?.(dir); };
  const ink = dark ? "text-cream" : "text-ink";
  const muted = dark ? "text-cream/75" : "text-stone";
  const btn = dark ? "border-gold text-gold hover:bg-gold hover:text-brownDeep" : "border-brown text-brown hover:bg-brown hover:text-cream";
  const items = Children.toArray(children);

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
              <button type="button" aria-label="Previous" onClick={() => go(-1)} className={`w-8 h-8 border text-[17px] leading-none flex items-center justify-center bg-transparent ${btn}`}>‹</button>
              <button type="button" aria-label="Next" onClick={() => go(1)} className={`w-8 h-8 border text-[17px] leading-none flex items-center justify-center bg-transparent ${btn}`}>›</button>
            </div>
          )}
        </div>
      </div>
      <div
        ref={rail}
        tabIndex={0}
        className="rail overflow-hidden py-1 px-0.5 cursor-grab select-none [touch-action:pan-y] [&.dragging]:cursor-grabbing outline-none"
      >
        <div ref={track} className="flex will-change-transform [transform:translate3d(0,0,0)]" style={{ gap: GAP }}>
          {Array.from({ length: count < 2 ? 1 : copies }, (_, k) =>
            items.map((c, i) => (
              <div key={`${k}-${i}`} className="shrink-0 grow-0 min-w-0" style={{ flexBasis: "var(--cw, 220px)", width: "var(--cw, 220px)" }} aria-hidden={k > 0 || undefined}>{c}</div>
            )),
          )}
        </div>
      </div>
    </div>
  );
}
