/**
 * Airtable-style view controls for the Purchase Order tracker:
 *  - GroupMenu    — group rows by a field (incl. computed "CRD Week" / "Status")
 *  - SortMenu     — multi-column sort rule editor
 *  - CrdWeekFilter — date filter for the CRD (expected_delivery) field with
 *    Today / This Week / Next Week / This Month / custom-range presets and an
 *    ISO week-number picker (Week 28, Week 29, …)
 *
 * Pure UI + small date helpers; the page owns all state and query wiring.
 */
import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Layers, ArrowUpDown, CalendarDays, X, Plus, ChevronUp, ChevronDown, Trash2,
} from "lucide-react";
import {
  format, startOfISOWeek, endOfISOWeek, getISOWeek, getISOWeekYear,
  addWeeks, startOfMonth, endOfMonth, setISOWeek,
} from "date-fns";

/* ── Types ── */

export type SortRule = { col: string; asc: boolean };

export type CrdPreset = "today" | "thisWeek" | "nextWeek" | "thisMonth" | "custom" | null;

export type CrdFilter = {
  preset: CrdPreset;
  from: string | null; // yyyy-MM-dd, custom preset only
  to: string | null;
  /** ISO week keys like "2026-W28" — exclusive with preset. */
  weeks: string[];
};

export const EMPTY_CRD_FILTER: CrdFilter = { preset: null, from: null, to: null, weeks: [] };

export type FieldOption = { value: string; label: string };

/* ── Date helpers (ISO weeks, Monday-based — matches factory schedules) ── */

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function weekKeyOf(date: Date): string {
  return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, "0")}`;
}

export function weekKeyLabel(key: string): string {
  const r = weekKeyRange(key);
  if (!r) return key;
  const n = Number(key.split("-W")[1]);
  return `Week ${n} · ${format(new Date(r.from), "MMM d")} – ${format(new Date(r.to), "MMM d, yyyy")}`;
}

/** Date range (inclusive, yyyy-MM-dd) covered by an ISO week key. */
export function weekKeyRange(key: string): { from: string; to: string } | null {
  const m = key.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return null;
  // Jan 4 is always inside ISO week 1 of its year.
  const anchor = setISOWeek(new Date(Number(m[1]), 0, 4), Number(m[2]));
  return { from: iso(startOfISOWeek(anchor)), to: iso(endOfISOWeek(anchor)) };
}

/** All date ranges an active CRD filter selects (empty array = no filter). */
export function crdFilterRanges(f: CrdFilter): { from: string; to: string }[] {
  if (f.weeks.length) {
    return f.weeks.map(weekKeyRange).filter(Boolean) as { from: string; to: string }[];
  }
  const now = new Date();
  switch (f.preset) {
    case "today":     return [{ from: iso(now), to: iso(now) }];
    case "thisWeek":  return [{ from: iso(startOfISOWeek(now)), to: iso(endOfISOWeek(now)) }];
    case "nextWeek": {
      const nw = addWeeks(now, 1);
      return [{ from: iso(startOfISOWeek(nw)), to: iso(endOfISOWeek(nw)) }];
    }
    case "thisMonth": return [{ from: iso(startOfMonth(now)), to: iso(endOfMonth(now)) }];
    case "custom":
      if (!f.from && !f.to) return [];
      return [{ from: f.from ?? "0000-01-01", to: f.to ?? "9999-12-31" }];
    default: return [];
  }
}

export function crdFilterActive(f: CrdFilter): boolean {
  return crdFilterRanges(f).length > 0;
}

/** Short chip label for the active CRD filter, e.g. "This Week" / "W28, W29". */
export function crdFilterLabel(f: CrdFilter): string {
  if (f.weeks.length) {
    const ws = f.weeks.map(k => `W${Number(k.split("-W")[1])}`);
    return ws.length > 3 ? `${ws.slice(0, 3).join(", ")} +${ws.length - 3}` : ws.join(", ");
  }
  switch (f.preset) {
    case "today": return "Today";
    case "thisWeek": return "This Week";
    case "nextWeek": return "Next Week";
    case "thisMonth": return "This Month";
    case "custom":
      return [f.from, f.to].filter(Boolean).map(d => format(new Date(d!), "MMM d")).join(" – ") || "Custom";
    default: return "";
  }
}

/** Week choices for the picker: 8 weeks back through 26 weeks ahead of now. */
function weekChoices(): { key: string; label: string; isCurrent: boolean }[] {
  const now = new Date();
  const current = weekKeyOf(now);
  return Array.from({ length: 35 }, (_, i) => {
    const d = addWeeks(now, i - 8);
    const key = weekKeyOf(d);
    return { key, label: weekKeyLabel(key), isCurrent: key === current };
  });
}

/* ── Shared chip-button styling ── */

const chip = (active: boolean) =>
  cn(
    "h-8 gap-1.5 text-xs font-medium",
    active && "bg-primary/10 text-primary border-primary/40 hover:bg-primary/15 hover:text-primary",
  );

/* ════════════════════════ GroupMenu ════════════════════════ */

export function GroupMenu({ value, options, onChange }: {
  value: string | null;
  options: FieldOption[];
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeLabel = options.find(o => o.value === value)?.label;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={chip(!!value)}>
          <Layers className="h-3.5 w-3.5" />
          {value ? `Grouped by ${activeLabel}` : "Group"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Group by</div>
        <ScrollArea className="max-h-72">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className={cn(
              "flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
              !value && "font-semibold text-primary",
            )}
          >
            None
          </button>
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={cn(
                "flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                value === o.value && "font-semibold text-primary",
              )}
            >
              {o.label}
            </button>
          ))}
        </ScrollArea>
        {value && (
          <div className="mt-1 border-t border-border pt-1">
            <Button variant="ghost" size="sm" className="h-7 w-full justify-start text-xs text-muted-foreground" onClick={() => { onChange(null); setOpen(false); }}>
              <X className="mr-1.5 h-3 w-3" /> Remove grouping
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ════════════════════════ SortMenu ════════════════════════ */

export function SortMenu({ rules, options, onChange }: {
  rules: SortRule[];
  options: FieldOption[];
  onChange: (rules: SortRule[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const unused = options.filter(o => !rules.some(r => r.col === o.value));
  const labelOf = (col: string) => options.find(o => o.value === col)?.label ?? col;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={chip(rules.length > 0)}>
          <ArrowUpDown className="h-3.5 w-3.5" />
          {rules.length > 1 ? `Sorted by ${rules.length} fields` : rules.length === 1 ? `Sorted by ${labelOf(rules[0].col)}` : "Sort"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">Sort by</div>
        {rules.length === 0 && (
          <div className="mb-2 rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            No sorts applied. Add a field below — drag order = priority.
          </div>
        )}
        <div className="space-y-1.5">
          {rules.map((r, i) => (
            <div key={r.col} className="flex items-center gap-1.5">
              <Select
                value={r.col}
                onValueChange={(col) => {
                  if (rules.some((x, xi) => x.col === col && xi !== i)) return;
                  onChange(rules.map((x, xi) => (xi === i ? { ...x, col } : x)));
                }}
              >
                <SelectTrigger className="h-7 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map(o => (
                    <SelectItem key={o.value} value={o.value} className="text-xs" disabled={rules.some((x, xi) => x.col === o.value && xi !== i)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline" size="sm" className="h-7 w-[72px] px-2 text-[11px]"
                onClick={() => onChange(rules.map((x, xi) => (xi === i ? { ...x, asc: !x.asc } : x)))}
              >
                {r.asc ? <><ChevronUp className="mr-0.5 h-3 w-3" />A → Z</> : <><ChevronDown className="mr-0.5 h-3 w-3" />Z → A</>}
              </Button>
              <Button
                variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => onChange(rules.filter((_, xi) => xi !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        {unused.length > 0 && (
          <Select value="" onValueChange={(col) => onChange([...rules, { col, asc: true }])}>
            <SelectTrigger className="mt-2 h-7 w-full border-dashed text-xs text-muted-foreground">
              <span className="inline-flex items-center"><Plus className="mr-1 h-3 w-3" /> Add another sort</span>
            </SelectTrigger>
            <SelectContent>
              {unused.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {rules.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-2 h-7 w-full justify-start text-xs text-muted-foreground" onClick={() => onChange([])}>
            <X className="mr-1.5 h-3 w-3" /> Clear all sorts
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ════════════════════════ CrdWeekFilter ════════════════════════ */

const PRESETS: { key: Exclude<CrdPreset, "custom" | null>; label: string }[] = [
  { key: "today",     label: "Today" },
  { key: "thisWeek",  label: "This Week" },
  { key: "nextWeek",  label: "Next Week" },
  { key: "thisMonth", label: "This Month" },
];

export function CrdWeekFilter({ value, onChange, fieldLabel = "CRD" }: {
  value: CrdFilter;
  onChange: (f: CrdFilter) => void;
  fieldLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const weeks = useMemo(weekChoices, []);
  const active = crdFilterActive(value);

  const toggleWeek = (key: string) => {
    const has = value.weeks.includes(key);
    const next = has ? value.weeks.filter(w => w !== key) : [...value.weeks, key].sort();
    onChange({ ...EMPTY_CRD_FILTER, weeks: next });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={chip(active)}>
          <CalendarDays className="h-3.5 w-3.5" />
          {active ? `${fieldLabel}: ${crdFilterLabel(value)}` : `${fieldLabel} Week`}
          {active && (
            <X
              className="ml-0.5 h-3 w-3 opacity-70 hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); onChange(EMPTY_CRD_FILTER); }}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">{fieldLabel} date presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map(p => (
            <Button
              key={p.key}
              variant={value.preset === p.key ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onChange(value.preset === p.key ? EMPTY_CRD_FILTER : { ...EMPTY_CRD_FILTER, preset: p.key })}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <div className="mt-3 mb-1.5 text-xs font-semibold text-muted-foreground">Custom range</div>
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={value.preset === "custom" ? value.from ?? "" : ""}
            onChange={(e) => onChange({ ...EMPTY_CRD_FILTER, preset: "custom", from: e.target.value || null, to: value.preset === "custom" ? value.to : null })}
            className="h-7 text-xs"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            value={value.preset === "custom" ? value.to ?? "" : ""}
            onChange={(e) => onChange({ ...EMPTY_CRD_FILTER, preset: "custom", from: value.preset === "custom" ? value.from : null, to: e.target.value || null })}
            className="h-7 text-xs"
          />
        </div>

        <div className="mt-3 mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">Week number</span>
          {value.weeks.length > 0 && (
            <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => onChange(EMPTY_CRD_FILTER)}>
              clear ({value.weeks.length})
            </button>
          )}
        </div>
        <ScrollArea className="h-48 rounded border border-border">
          <div className="p-1">
            {weeks.map(w => (
              <label
                key={w.key}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted",
                  w.isCurrent && "bg-primary/5 font-semibold",
                )}
              >
                <Checkbox
                  checked={value.weeks.includes(w.key)}
                  onCheckedChange={() => toggleWeek(w.key)}
                  className="h-3.5 w-3.5"
                />
                <span className="flex-1">{w.label}</span>
                {w.isCurrent && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">now</span>}
              </label>
            ))}
          </div>
        </ScrollArea>

        {active && (
          <Button variant="ghost" size="sm" className="mt-2 h-7 w-full justify-start text-xs text-muted-foreground" onClick={() => { onChange(EMPTY_CRD_FILTER); setOpen(false); }}>
            <X className="mr-1.5 h-3 w-3" /> Clear {fieldLabel} filter
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
