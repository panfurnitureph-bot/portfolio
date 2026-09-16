"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLivePatch } from "@/lib/live-patch";

// LIVE DELIVERY ROWS (0216, Phase 1) — ang tapal para sa mga pahinang
// hinahati ang mga stop sa CLIENT (Route Planner, team routes): dahil ang
// paghahati ay filter sa mga field ng hilera, ang pagtapal ng dq_*/status ay
// kusang naglilipat ng stop sa tamang listahan — walang buong render.
//
// Ano LANG ang tinatapal: ang mga field na direktang kopya mula sa DB
// (orders.dq_*, deliveries.status/schedule). Ang mga DERIVED na field
// (is_rework, pickedUp, items...) ay hindi ginagalaw — ang darating na
// fallback render ang nagdadala ng mga iyon. Kaya ang bagong ORDER ay hindi
// lilitaw sa tapal (walang enriched na hilera para tapalan) — darating ito sa
// render makalipas ang ~2s; ang paggalaw ng UMIIRAL na stop ang instant.
type Deliveryish = {
  order_id: number | null;
  status: string;
  schedule_date: string | null;
  time_window: string | null;
  driver_team: string | null;
  dq_status: string | null;
  dq_date: string | null;
  dq_team: string | null;
  dq_driver: string | null;
  dq_window: string | null;
  dq_confirmed_at: string | null;
  dq_final: boolean;
};

export function useLiveDeliveryRows<T extends Deliveryish>(rows: T[]): T[] {
  const [patches, setPatches] = useState<Map<number, Partial<Deliveryish>>>(new Map());

  // BAGONG PROPS = BAGONG KATOTOHANAN. Ang fallback render ay dala ang lahat
  // hanggang ngayon — ang mga lumang tapal sa ibabaw nito ay panganib ng
  // pagbabalik sa luma, kaya nililinis. Ang bihirang karera (render na
  // nagsimula BAGO ang sulat, dumating PAGKATAPOS ng tapal) ay itinatama ng
  // susunod na render na naka-iskedyul na ng parehong sulat.
  const rowsRef = useRef(rows);
  useEffect(() => {
    if (rowsRef.current !== rows) {
      rowsRef.current = rows;
      setPatches((prev) => (prev.size ? new Map() : prev));
    }
  }, [rows]);

  useLivePatch(["orders", "deliveries"], (p) => {
    const r = p.row as Record<string, unknown>;
    const oid = p.table === "orders" ? Number(r.id) : Number(r.order_id);
    if (!oid || p.op === "DELETE") return;
    const patch: Partial<Deliveryish> = {};
    if (p.table === "orders") {
      // Mga direktang kopya ng loader mula sa orders — ligtas tapalan.
      if ("dq_status" in r) patch.dq_status = (r.dq_status as string | null) ?? null;
      if ("dq_date" in r) patch.dq_date = (r.dq_date as string | null) ?? null;
      if ("dq_team" in r) patch.dq_team = (r.dq_team as string | null) ?? null;
      if ("dq_driver" in r) patch.dq_driver = (r.dq_driver as string | null) ?? null;
      if ("dq_window" in r) patch.dq_window = (r.dq_window as string | null) ?? null;
      if ("dq_confirmed_at" in r) patch.dq_confirmed_at = (r.dq_confirmed_at as string | null) ?? null;
      if ("dq_route_final_at" in r) patch.dq_final = !!r.dq_route_final_at;
      // HUWAG ang orders.status — ang `status` ng hilera ay sa DELIVERY, hindi
      // sa order; ang paghahalo ay maglalagay ng "Partial" sa lugar ng
      // "Out for Delivery" at sisira sa mga filter.
    } else {
      if ("status" in r && r.status != null) patch.status = String(r.status);
      if ("schedule_date" in r) patch.schedule_date = (r.schedule_date as string | null) ?? null;
      if ("time_window" in r) patch.time_window = (r.time_window as string | null) ?? null;
      if ("driver_team" in r) patch.driver_team = (r.driver_team as string | null) ?? null;
    }
    if (!Object.keys(patch).length) return;
    setPatches((prev) => {
      const next = new Map(prev);
      next.set(oid, { ...next.get(oid), ...patch });
      return next;
    });
  });

  return useMemo(() => {
    if (!patches.size) return rows;
    return rows.map((row) => {
      const p = row.order_id != null ? patches.get(row.order_id) : undefined;
      return p ? { ...row, ...p } : row;
    });
  }, [rows, patches]);
}
