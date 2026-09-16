"use client";

import { cn } from "./ui";
import { rushInfo } from "@/lib/rush";

const TONE: Record<string, string> = {
  ok: "bg-rose-50 text-rose-700 ring-rose-200",
  soon: "bg-rose-100 text-rose-700 ring-rose-300",
  over: "bg-rose-600 text-white ring-rose-700",
};

// Red Rush countdown pill. Only renders when the order is tagged rush.
// Computes the countdown client-side so it stays live without a re-fetch.
export function RushBadge({ isRush, dateOrder, threshold, done = false, className }: {
  isRush: boolean;
  dateOrder: string | null;
  threshold: number;
  /** Delivered/completed na ang order — wala nang countdown, "Rush" na lang. */
  done?: boolean;
  className?: string;
}) {
  if (!isRush) return null;
  if (done) {
    return (
      <span className={cn("inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ring-1 ring-inset", TONE.ok, className)}
        title="Rush order · delivered">
        Rush
      </span>
    );
  }
  const info = rushInfo(dateOrder, threshold, new Date());
  // Maikling anyo para kasya sa masisikip na order-number cells sa mga table —
  // "12d left" / "Due today" / "3d over"; ang buong pangungusap ay nasa tooltip.
  const compact = info
    ? info.remaining > 0
      ? `${info.remaining}D`
      : info.remaining === 0
        ? "Due today"
        : `${-info.remaining}D over`
    : "";
  const tone = info ? info.tone : "ok";
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ring-1 ring-inset", TONE[tone], className)}
      title={`Rush order · ${info ? info.label : "Rush"}`}>
      Rush{compact ? ` · ${compact}` : ""}
    </span>
  );
}
