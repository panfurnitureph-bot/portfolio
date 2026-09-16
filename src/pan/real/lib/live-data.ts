"use client";

import { useEffect, useRef, useState } from "react";
import { useLivePatch } from "@/lib/live-patch";

// LIVE DATA — JSON refetch (0216, Phase 2). Para sa mga pahinang DERIVED ang
// datos (grupo, bilang, pagkakasunod na server ang nagbubuo): ang hilera-
// hilerang tapal ay hindi kayang maglipat ng miyembro sa tamang grupo nang
// hindi dinodoble ang logic ng loader sa client. Sa halip: kapag tumunog ang
// kampana ng alinmang table na sandigan ng pahina, kunin ang SARIWANG buong
// datos bilang magaan na JSON — ang parehong loader, server pa rin ang
// nagde-derive — at itapal sa state. Walang RSC/layout render sa daanan, kaya
// ~0.5-1s sa halip na ~2s.
//
// Ang fallback render (RealtimeRefresher) ay buhay pa rin sa ilalim; kapag
// dumating ang sariwang props mula roon, ito ang masusunod — hindi
// maiiwanang mag-isa ang state kahit mabigo ang bawat fetch.
export function useLiveData<T>(initial: T, url: string, tables: string[]): T {
  const [data, setData] = useState<T>(initial);

  // Props mula sa fallback render = bagong katotohanan mula sa server.
  // Render-time na prop-sync (ang basbas na padron ng React docs) — hindi
  // effect, kaya walang dagdag na render cycle.
  const [prevInitial, setPrevInitial] = useState<T>(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setData(initial);
  }

  // Isang fetch lang ang buhay; ang huling dumating ang panalo, at ang
  // pagtunog habang may fetch ay nagpapa-ulit pagkatapos (hindi nawawala).
  const busy = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pull = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    pull.current = async () => {
      if (busy.current) { again.current = true; return; }
      busy.current = true;
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (alive && r.ok) setData(await r.json() as T);
      } catch { /* fallback render ang sasalo */ }
      busy.current = false;
      if (again.current) { again.current = false; pull.current(); }
    };
    return () => { alive = false; };
  }, [url]);

  const lastPull = useRef(0);
  useLivePatch(tables, () => {
    // Maikling debounce: ang isang aksyon ay madalas sumulat sa 2-3 table nang
    // sabay — isang fetch lang para sa buong bugso. May 2s na gap din
    // (2026-08-31): ang bawat hila ay buong mabigat na loader sa server, at
    // sa masiglang oras ay sunod-sunod itong tumama nang walang preno —
    // kasabwat sa pagbagal ng buong app. Trailing ang gap: hindi nawawala
    // ang huling pagbabago, naiipon lang sa isang hila.
    if (timer.current) clearTimeout(timer.current);
    const since = Date.now() - lastPull.current;
    const wait = Math.max(200, 2_000 - since);
    timer.current = setTimeout(() => { lastPull.current = Date.now(); pull.current(); }, wait);
  });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return data;
}
