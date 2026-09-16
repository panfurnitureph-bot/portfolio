"use client";

// Carousel touch engine para sa storefront.
//
// (1) FALLBACK SWIPE para sa iOS: may mga iPhone kung saan hindi gumagalaw
//     ang native na pahalang na scroll (WebKit quirk; ayos lang sa Android).
//     Napatunayan sa /swipe-test na dumarating naman ang touch events. Sa
//     unang ~10px na pahalang na hagod, kapag patay ang native scroll,
//     inaako natin ang gesture: ang touchmove ay nagtatakda ng TARGET at
//     isang rAF loop ang banayad na humahabol — makinis, sunod sa daliri.
// (2) JS SNAP: tinanggal ang CSS scroll-snap sa mga image carousel (may
//     iOS bug na nagpa-freeze ng swipe), kaya dito na ang pagdapo: matapos
//     ang hagod/momentum, kusang dadapo nang eksakto sa pinakamalapit na
//     card. Gumagana ito sa parehong manual (iOS fallback) at native
//     (Android) na scroll. Ang alignment (start o center) ay binabasa mula
//     sa scroll-snap-align class ng mga card.
//
// Lahat ng animation ay rAF na kanselado agad sa susunod na dampi — kapag
// may umaandar na animation habang dumidikit ang daliri, kinakain ng iOS
// ang buong susunod na gesture.

import { useEffect, useRef } from "react";
import type React from "react";

type GestureState = {
  x: number;
  y: number;
  sl: number;
  decided: boolean;
  manual: boolean;
  target: number;
  lastX: number;
  lastT: number;
  vx: number; // px bawat ms
};

export function useSwipeFallback(ref: React.RefObject<HTMLElement | null>) {
  const g = useRef<GestureState | null>(null);
  const raf = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stopAnim() {
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
  }

  // Mga posisyon kung saan dapat dumapo ang scroll — isa bawat card.
  function snapPositions(el: HTMLElement): number[] {
    const kids = Array.from(el.children) as HTMLElement[];
    if (!kids.length) return [];
    const align = getComputedStyle(kids[0]).scrollSnapAlign.includes("center")
      ? "center"
      : "start";
    const base = el.getBoundingClientRect();
    const max = el.scrollWidth - el.clientWidth;
    return kids.map((k) => {
      const r = k.getBoundingClientRect();
      let pos = r.left - base.left + el.scrollLeft;
      if (align === "center") pos -= (el.clientWidth - r.width) / 2;
      return Math.max(0, Math.min(pos, max));
    });
  }

  function nearest(list: number[], x: number): number {
    let best = list[0];
    for (const v of list) if (Math.abs(v - x) < Math.abs(best - x)) best = v;
    return best;
  }

  // Makinis na pagdapo sa target (ease-out) — rAF, kanselado sa bagong dampi.
  function animateTo(target: number, ms = 300) {
    const el = ref.current;
    if (!el) return;
    stopAnim();
    const from = el.scrollLeft;
    const delta = target - from;
    if (Math.abs(delta) < 1) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const node = ref.current;
      if (!node) {
        raf.current = 0;
        return;
      }
      const p = Math.min((now - t0) / ms, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      node.scrollLeft = from + delta * ease;
      raf.current = p < 1 ? requestAnimationFrame(step) : 0;
    };
    raf.current = requestAnimationFrame(step);
  }

  // JS snap para sa NATIVE scroll (Android at malulusog na iPhone): kapag
  // tumigil ang scroll nang ~160ms at walang hawak na daliri, dumapo sa
  // pinakamalapit na card.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (g.current || raf.current) return; // tayo mismo ang gumagalaw
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        const node = ref.current;
        if (!node || g.current || raf.current) return;
        const targets = snapPositions(node);
        if (!targets.length) return;
        const t = nearest(targets, node.scrollLeft);
        if (Math.abs(t - node.scrollLeft) > 2) animateTo(t, 260);
      }, 160);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onTouchStart(e: React.TouchEvent) {
    stopAnim();
    const t = e.touches[0];
    g.current = {
      x: t.clientX,
      y: t.clientY,
      sl: ref.current?.scrollLeft ?? 0,
      decided: false,
      manual: false,
      target: ref.current?.scrollLeft ?? 0,
      lastX: t.clientX,
      lastT: performance.now(),
      vx: 0,
    };
  }

  function startFollow() {
    if (raf.current) return;
    const step = () => {
      const node = ref.current;
      const st = g.current;
      if (!node || !st || !st.manual) {
        raf.current = 0;
        return;
      }
      const gap = st.target - node.scrollLeft;
      if (Math.abs(gap) > 0.5) node.scrollLeft += gap * 0.45;
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }

  function onTouchMove(e: React.TouchEvent) {
    const st = g.current;
    const el = ref.current;
    if (!st || !el) return;
    const t = e.touches[0];
    const dx = t.clientX - st.x;
    const dy = t.clientY - st.y;

    if (!st.decided) {
      if (Math.abs(el.scrollLeft - st.sl) >= 2) {
        st.decided = true;
        st.manual = false;
      } else if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        st.decided = true;
        st.manual = true;
        startFollow();
      }
    }

    if (st.manual) {
      const now = performance.now();
      st.vx = (t.clientX - st.lastX) / Math.max(now - st.lastT, 1);
      st.lastX = t.clientX;
      st.lastT = now;
      st.target = st.sl - dx;
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    const st = g.current;
    g.current = null;
    const el = ref.current;
    stopAnim();
    if (!st || !el) return;

    if (st.manual) {
      // Saan hihinto ang momentum kung hahayaan — tapos dumapo sa card na
      // pinakamalapit doon. Isang tuloy-tuloy na animation, sakto sa card.
      const max = el.scrollWidth - el.clientWidth;
      const predicted = Math.max(
        0,
        Math.min(el.scrollLeft + -st.vx * 266, max)
      );
      const targets = snapPositions(el);
      if (targets.length) {
        animateTo(nearest(targets, predicted), 320);
      }
      return;
    }

    // Hindi naging manual (napakabilis na flick): kapag hindi gumalaw ang
    // native scroll, isang card ang itulak sa direksyon ng hagod.
    if (Math.abs(el.scrollLeft - st.sl) > 5) return;
    const t = e.changedTouches?.[0];
    if (!t) return; // touchcancel na walang touch data — wala tayong gagawin
    const dx = t.clientX - st.x;
    const dy = t.clientY - st.y;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    const targets = snapPositions(el);
    if (!targets.length) return;
    const cur = nearest(targets, el.scrollLeft);
    const i = targets.indexOf(cur);
    const next = targets[Math.max(0, Math.min(targets.length - 1, i + (dx < 0 ? 1 : -1)))];
    animateTo(next, 320);
  }

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd };
}
