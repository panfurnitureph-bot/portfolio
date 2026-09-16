"use client";

// Nakikinig sa Supabase kung may binago sa storefront content (web_products,
// web_swatches, web_content) at nagre-refresh ng server components — kaya ang
// binago sa PAN app admin ay lumalabas dito nang HINDI nagre-refresh ang bisita.
//
// Ang tatlong table ay may public-read policy (PAN app migration 0130), at ang
// publication ay FOR ALL TABLES (0093) — yun ang dalawang kailangan ng realtime:
// gate ng postgres_changes ang RLS ng subscriber, at dapat kasama sa publication.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

// Pinagsasama ang sunod-sunod na pagbabago sa isang refresh. Maikli para
// pakiramdam ay agad, pero sapat para hindi mag-refresh nang paulit-ulit kapag
// nag-save ng maraming produkto nang sabay.
const DEBOUNCE_MS = 400;

const WATCHED = new Set(["web_products", "web_swatches", "web_content"]);

export default function ContentLive() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyWhileHidden = useRef(false);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return; // walang Supabase — mananatili ang naka-render

    const sb = createClient(url, key, {
      auth: { persistSession: false },
    });

    const channel = sb
      .channel("storefront-content")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
        if (!WATCHED.has(payload.table)) return;

        // Naka-background ang tab: huwag itapon ang event — tandaan, at
        // magre-refresh sa sandaling balikan ito ng bisita.
        if (document.visibilityState === "hidden") {
          dirtyWhileHidden.current = true;
          return;
        }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          router.refresh();
        }, DEBOUNCE_MS);
      })
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible" && dirtyWhileHidden.current) {
        dirtyWhileHidden.current = false;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      void sb.removeChannel(channel);
    };
  }, [router]);

  return null;
}
