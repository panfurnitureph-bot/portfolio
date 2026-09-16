"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Marahang auto-refresh para sa pages na WALANG realtime (ang mga sensitive na
// table — payroll/PAN Overall — ay RLS-locked nang walang read policy, kaya
// hindi na sila nakakatanggap ng live change events; 0148). Sa desktop app
// (Electron) walang refresh button, kaya: (1) refresh pag bumalik ang focus sa
// window, (2) mahinang interval poll habang nakabukas at nakikita ang page.
export function PageRefresher({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    // SILENT: mag-refresh LANG kapag idle ang user (walang input sa nakaraang
    // 10s) at walang naka-focus na field — para hindi nila maramdaman kailanman.
    let lastInput = Date.now();
    const noteInput = () => { lastInput = Date.now(); };
    const INPUT_EVENTS: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"];
    INPUT_EVENTS.forEach((ev) => window.addEventListener(ev, noteInput, { passive: true }));

    const refresh = (force = false) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (!force && Date.now() - lastInput < 10_000) return; // gumagalaw pa ang user — huwag muna
      router.refresh();
    };
    const id = setInterval(() => refresh(false), intervalMs);
    // Pagbalik sa window: laging sariwain (pinakaligtas na sandali — kagagaling
    // lang nila sa ibang app, walang maaabalang gawain).
    const onFocus = () => refresh(true);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(id);
      INPUT_EVENTS.forEach((ev) => window.removeEventListener(ev, noteInput));
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [router, intervalMs]);

  return null;
}
