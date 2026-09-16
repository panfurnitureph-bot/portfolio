// =============================================================================
// Forecast live-edit Broadcast channel
// =============================================================================
// postgres_changes (WAL-based) has inherent latency (~0.5-2s) — too slow for
// Google-Sheets-style live editing. This module adds a Supabase Broadcast
// channel: the editor sends the change DIRECTLY to all other clients
// (~50-150ms, bypassing the database), while the DB write + postgres_changes
// continue for persistence, late-joiners, and reconciliation.
//
// Send: broadcastForecastEdit({ table, sku, fields })  (from save handlers)
// Receive: onForecastEdit(cb)                            (RealtimeProvider)
// =============================================================================

import { externalSupabase } from "@/integrations/supabase/externalClient";

export type ForecastEditTable =
  | "forecast_report_manual"
  | "forecast_report_status"
  | "forecast_report_proj_override"
  | "forecast_report_supply_override";

export interface ForecastEditMsg {
  table: ForecastEditTable;
  sku: string;
  /** Changed fields only (e.g. { monthly_projection: null }). Merged by sku. */
  fields: Record<string, unknown>;
}

/**
 * A whole-column "Clear Manual Value" — affects every sku, so it can't be sent
 * as per-sku edits. One signal tells all clients to refetch the cleared table.
 */
export interface ForecastColumnClearMsg {
  table: ForecastEditTable | "forecast_report";
  field: string;
}

const CHANNEL = "forecast-edits";
const EVENT = "edit";
const COLUMN_CLEAR_EVENT = "column-clear";

let channel: ReturnType<typeof externalSupabase.channel> | null = null;
let subscribed = false;
const listeners = new Set<(msg: ForecastEditMsg) => void>();
const columnClearListeners = new Set<(msg: ForecastColumnClearMsg) => void>();

function ensureChannel() {
  if (channel) return channel;
  // self:false → the sender does NOT receive its own broadcast (it already
  // applied the edit optimistically). ack:false → fire-and-forget for speed.
  channel = externalSupabase.channel(CHANNEL, {
    config: { broadcast: { self: false, ack: false } },
  });
  channel.on("broadcast", { event: EVENT }, ({ payload }) => {
    const msg = payload as ForecastEditMsg;
    for (const l of listeners) {
      try {
        l(msg);
      } catch {
        /* listener errors must not break the channel */
      }
    }
  });
  channel.on("broadcast", { event: COLUMN_CLEAR_EVENT }, ({ payload }) => {
    const msg = payload as ForecastColumnClearMsg;
    for (const l of columnClearListeners) {
      try {
        l(msg);
      } catch {
        /* listener errors must not break the channel */
      }
    }
  });
  channel.subscribe((status: string) => {
    subscribed = status === "SUBSCRIBED";
  });
  return channel;
}

/** Send a forecast edit to all other connected clients (instant, no DB hop). */
export function broadcastForecastEdit(msg: ForecastEditMsg): void {
  const ch = ensureChannel();
  // If not yet subscribed, the send is a no-op; postgres_changes still
  // reconciles, so correctness is preserved — only the instant path is skipped.
  if (!subscribed) return;
  void ch.send({ type: "broadcast", event: EVENT, payload: msg });
}

/** Register a receiver for incoming forecast edits. Returns an unsubscribe fn. */
export function onForecastEdit(cb: (msg: ForecastEditMsg) => void): () => void {
  ensureChannel();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Tell all other clients a whole column's manual values were cleared. */
export function broadcastForecastColumnClear(msg: ForecastColumnClearMsg): void {
  const ch = ensureChannel();
  if (!subscribed) return;
  void ch.send({ type: "broadcast", event: COLUMN_CLEAR_EVENT, payload: msg });
}

/** Register a receiver for column-clear signals. Returns an unsubscribe fn. */
export function onForecastColumnClear(cb: (msg: ForecastColumnClearMsg) => void): () => void {
  ensureChannel();
  columnClearListeners.add(cb);
  return () => {
    columnClearListeners.delete(cb);
  };
}
