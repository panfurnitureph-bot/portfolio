"use client";

import { useEffect, useRef } from "react";
import { createBrowserSupabase, realtimeReady } from "@/lib/supabase/client";

// LIVE ROW PATCH (0216) — ang tenga ng bawat pahinang tinatapalan sa lugar.
//
// Ang server (DB trigger fn_live_patch) ay nagpapadala ng bawat nagbagong
// hilera sa channel na `live:<table>`; dito ito sinasalo at ibinibigay sa
// manager para itapal sa sariling state — walang buong render, walang biyahe
// sa Tokyo sa pagtanggap. Ang RealtimeRefresher ay tumatakbo pa rin sa
// ilalim bilang pantapal: kapag ligtaan ng tapal ang isang pagbabago (bagong
// hilera na kailangan ng derived data, nabigong padala), ang darating na
// render ang magtatama — ang tapal ay pampabilis, hindi ang katotohanan.
//
// PRIBADO ang channel (RLS ng realtime.messages, authenticated lang) — ang
// singleton client ay may setAuth na, kaya sapat ang pagkakabit dito.
export type LivePatch = {
  table: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  // Ang hilera mula sa DB — TINANGGAL ang mga field na lampas 2KB (litrato,
  // receipt_items), kaya huwag umasa sa kanila; ang mga id/status/petsa ay
  // laging buo.
  row: Record<string, unknown>;
};

export function useLivePatch(tables: string[], onPatch: (p: LivePatch) => void) {
  // Ang handler ay nasa ref para hindi nagre-resubscribe ang channel sa bawat
  // render ng tumatawag — ang mga manager ay madalas mag-render.
  const handler = useRef(onPatch);
  useEffect(() => { handler.current = onPatch; });
  const key = tables.join(",");

  useEffect(() => {
    const sb = createBrowserSupabase();
    let alive = true;
    let channels: ReturnType<typeof sb.channel>[] = [];
    // Token muna bago subscribe (2026-09-05) — private channel: kailangan ng
    // user token sa mismong join, kundi tinatanggihan.
    void realtimeReady().then(() => {
      if (!alive) return;
      channels = key.split(",").filter(Boolean).map((t) =>
        sb
          .channel(`live:${t}`, { config: { private: true } })
          .on("broadcast", { event: "patch" }, (msg) => {
            const p = msg.payload as LivePatch | undefined;
            if (p && p.row) handler.current(p);
          })
          .subscribe(),
      );
    });
    return () => { alive = false; channels.forEach((c) => void sb.removeChannel(c)); };
  }, [key]);
}
