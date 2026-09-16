"use client";

// PERFORMANCE RANKINGS (Reports & Analytics) — enterprise leaderboard dashboard:
// KPI overview band + podium (top performers) + ranking cards per category.
// Lahat ng period windows ay pre-computed server-side (loadRankings), kaya
// instant ang toggle. Fully responsive (stacks sa mobile).

import { useState } from "react";
import { cn } from "./ui";
import type { RankingsData, PeriodKey, RankCard, PodiumSpot } from "@/app/reports/data";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "7d", label: "7d" }, { key: "30d", label: "30d" }, { key: "qtr", label: "QTR" }, { key: "ytd", label: "YTD" },
];
const PERIOD_TEXT: Record<PeriodKey, string> = { "7d": "Last 7 days", "30d": "Last 30 days", qtr: "Last 90 days", ytd: "Year to date" };

const initials = (name: string) => {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[p.length - 1]?.[0] ?? "")).toUpperCase() || "?";
};
const peso = (n: number) => `₱${Math.round(n).toLocaleString("en-PH")}`;

const chipCls = (tone: "up" | "flat" | "down") =>
  tone === "up" ? "bg-emerald-50 text-emerald-700" : tone === "down" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{children}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-border border-t-2 border-t-[#caa45a] bg-surface px-4 py-3.5 shadow-sm transition-shadow hover:shadow-md">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#a8842e]">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums text-[#3a2e14]">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted">{note}</p>}
    </div>
  );
}

export function PerformanceRankings({ data }: { data: RankingsData }) {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const cur = data.periods[period];
  const s = cur.summary;
  // LAHAT ng category ay laging naka-display — ang walang laman ay may sariling
  // empty state sa loob ng card (hindi nagtatago), para kumpleto ang overview.
  const cards = cur.cards;
  const ranked = cards.filter((c) => c.rows.length > 0);
  const empty = ranked.length === 0;

  return (
    <div className="space-y-5">
      {/* Command bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-[#a8842e]">Reports &amp; Analytics</p>
          <h1 className="text-xl font-extrabold tracking-tight text-[#3a2e14]">Performance Rankings</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted sm:inline">{PERIOD_TEXT[period]}</span>
          <div className="flex rounded-lg border border-border bg-surface p-0.5 shadow-sm">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={cn("rounded-md px-3 py-1.5 text-xs font-bold transition-all", period === p.key ? "bg-[#4a3b1a] text-[#f4ead8] shadow-sm" : "text-muted hover:text-foreground")}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI overview band */}
      <SectionLabel>Overview</SectionLabel>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Delivered Runs" value={String(s.runs)} note={`COD ${peso(s.cod)}`} />
        <Kpi label="Installs" value={String(s.installs)} />
        <Kpi label="Workshop Jobs" value={String(s.output)} />
        <Kpi label="Inspections" value={String(s.inspections)} note={`${s.defects} defect${s.defects === 1 ? "" : "s"} caught`} />
        <Kpi label="Revenue" value={peso(s.revenue)} note={`${s.orders} order${s.orders === 1 ? "" : "s"}`} />
        <Kpi label="Active Rankers" value={String(cards.reduce((n, c) => n + c.rows.length, 0))} note={`${ranked.length} of ${cards.length} categories active`} />
      </div>

      {/* Podium — top performers across categories */}
      {cur.podium.length > 0 && (
        <>
          <SectionLabel>Top Performers</SectionLabel>
          <div className="overflow-hidden rounded-2xl bg-[#4a3b1a] bg-gradient-to-br from-[#52421d] to-[#3a2e14] px-4 pt-6 shadow-md sm:px-6">
            <p className="text-center text-[10px] font-extrabold uppercase tracking-[0.24em] text-[#caa45a]">Employee Standing · {PERIOD_TEXT[period]}</p>
            <p className="mt-0.5 text-center text-[11px] text-[#c9b896]">Category leaders ranked by share of their category&apos;s output</p>
            <div className="mt-5 flex flex-wrap items-end justify-center gap-4 sm:gap-6">
              {reorderPodium(cur.podium).map((p, i) => {
                const place = cur.podium.indexOf(p) + 1;
                return (
                  <div key={p.name + i} className="flex w-[128px] flex-col items-center gap-1.5 sm:w-[150px]">
                    <span className={cn(
                      "flex items-center justify-center rounded-full border-[3px] border-[#caa45a] bg-[#f4ead8] font-extrabold text-[#3a2e14]",
                      place === 1 ? "h-[72px] w-[72px] text-xl shadow-[0_0_0_5px_rgba(202,164,90,.25)]" : "h-14 w-14 text-base",
                    )}>{initials(p.name)}</span>
                    <span className="text-center text-[13px] font-extrabold leading-tight text-white sm:text-[13.5px]">{p.name}</span>
                    <span className="text-center text-[10px] uppercase tracking-[0.08em] text-[#c9b896] sm:text-[10.5px]">{p.sub}</span>
                    <span className="text-[12.5px] font-extrabold tabular-nums text-[#caa45a]">{p.pts}% share</span>
                    <div className={cn(
                      "flex w-full items-start justify-center rounded-t-lg pt-1 text-[13px] font-extrabold text-[#caa45a]",
                      place === 1 ? "h-16 bg-[#caa45a]/40" : place === 2 ? "h-11 bg-[#caa45a]/[.22]" : "h-8 bg-[#caa45a]/[.22]",
                    )}>{place}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Leaderboards */}
      <SectionLabel>Rankings · {PERIOD_TEXT[period]}</SectionLabel>
      {empty ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface py-16 text-center text-sm text-muted">
          No activity recorded in this period yet.
        </div>
      ) : (
        // Stretch (walang items-start) para pantay-pantay ang taas ng cards kada
        // hilera — ang rows area ang lumalaki, footer laging nasa ilalim.
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => <RankCardView key={c.key} c={c} />)}
        </div>
      )}
    </div>
  );
}

// Podium visual order: 2nd — 1st — 3rd (tulad ng totoong podium).
function reorderPodium(p: PodiumSpot[]): PodiumSpot[] {
  if (p.length < 3) return p;
  return [p[1], p[0], p[2]];
}

function RankCardView({ c }: { c: RankCard }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center gap-2.5 border-b border-[#caa45a] bg-gradient-to-r from-[#52421d] to-[#4a3b1a] px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#caa45a] text-[11px] font-extrabold text-[#3a2e14]">{c.icon}</span>
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-extrabold tracking-wide text-[#f4ead8]">{c.title}</h2>
          <p className="truncate text-[11px] text-[#c9b896]">{c.hint}</p>
        </div>
        <span className="ml-auto shrink-0 text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#c9b896]">{c.metric}</span>
      </div>
      {c.rows.length === 0 && (
        <div className="flex flex-1 items-center justify-center px-4 py-10 text-center">
          <div>
            <p className="text-sm font-semibold text-muted">No data in this period yet</p>
            <p className="mt-0.5 text-[11px] text-muted/80">Rankings appear once activity is recorded.</p>
          </div>
        </div>
      )}
      <div className={cn("grid flex-1 content-start gap-0.5 p-2.5", c.rows.length === 0 && "hidden")}>
        {c.rows.map((r, i) => (
          <div key={r.name} className={cn(
            "grid grid-cols-[26px_32px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2 py-2 sm:gap-2.5",
            i === 0 ? "border border-[#caa45a]/45 bg-gradient-to-r from-[#caa45a]/20 to-transparent" : "hover:bg-[#faf6ec]/70",
          )}>
            <span className={cn(
              "flex h-6 w-6 items-center justify-center justify-self-center rounded-full text-[11px] font-extrabold",
              i === 0 ? "bg-[#caa45a] text-[#3a2e14]" : "bg-[#f0e2c4] text-[#4a3b1a]",
            )}>{i + 1}</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4a3b1a] text-[11px] font-extrabold text-[#f4ead8]">{initials(r.name)}</span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-extrabold text-[#3a2e14]" title={r.name}>{r.name}</span>
              {r.sub && <span className="block truncate text-[10.5px] text-muted" title={r.sub}>{r.sub}</span>}
            </span>
            <span className="text-right">
              <span className="block text-[13.5px] font-extrabold tabular-nums text-[#3a2e14]">{r.display}</span>
              <span className="flex items-center justify-end gap-1.5">
                <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-stone-200 sm:inline-block">
                  <span className="block h-full rounded-full bg-gradient-to-r from-[#caa45a] to-[#4a3b1a]" style={{ width: `${r.share}%` }} />
                </span>
                {r.chip && <span className={cn("whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-extrabold", chipCls(r.chip.tone))}>{r.chip.label}</span>}
              </span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-auto border-t border-border bg-[#faf6ec]/50 px-4 py-2.5 text-[11px] text-muted">{c.foot}</p>
    </div>
  );
}
