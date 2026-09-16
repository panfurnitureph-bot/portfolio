import React, { startTransition, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Loader2, ArrowDownAZ, ArrowUpZA, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type MultiSelectFilterProps = {
  label: string;
  options: string[];
  value: string[];
  onApply: (v: string[]) => void;
  maxHeight?: number;
  isLoading?: boolean;
  /** Called when the popover opens — use for lazy loading */
  onOpen?: () => void;
  /** Optional formatter for display labels */
  formatLabel?: (value: string) => string;
  /** Optional tooltip shown next to the trigger button label */
  labelTooltip?: React.ReactNode;
  /** Optional tooltip content per option, keyed by option value */
  optionTooltip?: (value: string) => React.ReactNode | null | undefined;
  /** Optional action node rendered at the end of each option row (e.g. edit button) */
  optionAction?: (value: string) => React.ReactNode | null | undefined;
  /** Extra className applied to the trigger button */
  triggerClassName?: string;
  /**
   * When provided, shows a sort toggle in the header that the PARENT controls
   * (e.g. to sort the underlying table column). Omit for filters that should
   * not offer sorting. `onToggleSort` is called on click; cycle the dir yourself.
   */
  sortDir?: "none" | "asc" | "desc";
  onToggleSort?: () => void;
};

const VISIBLE_LIMIT = 200; // Only render first N items, search for the rest

export function MultiSelectFilter({
  label,
  options,
  value,
  onApply,
  maxHeight = 280,
  isLoading = false,
  onOpen,
  formatLabel,
  labelTooltip,
  optionTooltip,
  optionAction,
  triggerClassName,
  sortDir,
  onToggleSort,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (open) {
      setDraft(value);
      setQ("");
      setDebouncedQ("");
      onOpen?.();
    }
  }, [open]); // intentionally exclude value/onOpen to avoid re-triggering

  // Debounce search inside dropdown (150ms — fast but avoids per-keystroke filtering)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedQ(q), 150);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [q]);

  // Memoize filtered + limited options
  const filtered = useMemo(() => {
    const s = debouncedQ.trim().toLowerCase();
    return s ? options.filter((x) => x.toLowerCase().includes(s)) : options;
  }, [options, debouncedQ]);

  // Only render up to VISIBLE_LIMIT items for DOM performance
  const visibleItems = useMemo(() => filtered.slice(0, VISIBLE_LIMIT), [filtered]);
  const hasMore = filtered.length > VISIBLE_LIMIT;

  // Use a Set for O(1) draft lookups
  const draftSet = useMemo(() => new Set(draft), [draft]);

  const allSelected = draft.length === options.length && options.length > 0;
  const someSelected = draft.length > 0 && !allSelected;

  const toggleOne = useCallback((opt: string) => {
    setDraft((prev) => (prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt]));
  }, []);

  const toggleAll = useCallback(() => {
    setDraft((prev) => (prev.length === options.length ? [] : [...options]));
  }, [options]);

  const apply = useCallback(() => {
    // Applying a filter re-renders the whole table — mark it non-urgent so
    // the OK click paints immediately instead of blocking (INP ~260ms).
    startTransition(() => onApply(draft));
    setOpen(false);
  }, [draft, onApply]);

  const cancel = useCallback(() => {
    setDraft(value);
    setOpen(false);
  }, [value]);

  return (
    <TooltipProvider delayDuration={150}>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8", triggerClassName)}>
          {label}
          {labelTooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Info className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {labelTooltip}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {value.length > 0 ? (
            <span className="ml-2 text-xs text-muted-foreground">({value.length})</span>
          ) : (
            <span className="ml-2 text-xs text-muted-foreground">(All)</span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[320px] p-3" align="start">
        <div className="space-y-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-8"
          />

          {isLoading ? (
            <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading options…</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 py-1">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                />
                <button className="text-sm font-medium" onClick={toggleAll} type="button">
                  ( Select All )
                </button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {filtered.length} items
                </span>
                {sortDir !== undefined && onToggleSort ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={onToggleSort}
                        className={cn(
                          "ml-1 inline-flex items-center rounded p-1 hover:bg-muted",
                          sortDir === "none" ? "text-muted-foreground" : "text-foreground"
                        )}
                      >
                        {sortDir === "asc" ? (
                          <ArrowDownAZ className="h-4 w-4" />
                        ) : sortDir === "desc" ? (
                          <ArrowUpZA className="h-4 w-4" />
                        ) : (
                          <ArrowUpDown className="h-4 w-4" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      {sortDir === "none" ? "Sort column ↑" : sortDir === "asc" ? "Sort column ↓" : "Clear sort"}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>

              <div className="border rounded overflow-y-auto" style={{ maxHeight }}>
                <div className="p-2 space-y-0.5">
                  {visibleItems.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-2">No matches.</div>
                  ) : (
                    visibleItems.map((opt) => {
                      const tip = optionTooltip ? optionTooltip(opt) : null;
                      const action = optionAction ? optionAction(opt) : null;
                      return (
                      <label
                        key={opt}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer"
                      >
                        <Checkbox
                          checked={draftSet.has(opt)}
                          onCheckedChange={() => toggleOne(opt)}
                        />
                        <span className="text-sm truncate flex-1">{formatLabel ? formatLabel(opt) : opt}</span>
                        {tip ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground shrink-0"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                              >
                                <Info className="h-3.5 w-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs text-xs whitespace-pre-line">
                              {tip}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                        {action ? (
                          <span
                            className="ml-1 inline-flex items-center shrink-0"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            {action}
                          </span>
                        ) : null}
                      </label>
                      );
                    })
                  )}
                  {hasMore && (
                    <div className="text-xs text-muted-foreground p-2 text-center">
                      Showing {VISIBLE_LIMIT} of {filtered.length} — type to search more
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={cancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={apply} disabled={isLoading}>
              OK
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
    </TooltipProvider>
  );
}
