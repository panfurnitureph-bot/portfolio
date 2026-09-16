import { useState, useRef, useEffect } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ColumnFilterDropdownProps {
  columnLabel: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ColumnFilterDropdown({
  columnLabel,
  value,
  onChange,
  className,
}: ColumnFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleApply = () => {
    onChange(localValue);
    setOpen(false);
  };

  const handleClear = () => {
    setLocalValue("");
    onChange("");
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleApply();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const hasFilter = !!value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "ml-1 p-0.5 rounded hover:bg-primary-foreground/20 transition-colors inline-flex items-center justify-center",
            hasFilter && "text-accent bg-primary-foreground/10",
            className
          )}
          title={hasFilter ? `Filtered: ${value}` : `Filter ${columnLabel}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Filter className={cn("h-3 w-3", hasFilter && "fill-current")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-3"
        align="start"
        side="bottom"
        sideOffset={4}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground">
            Filter: {columnLabel}
          </div>
          <Input
            ref={inputRef}
            placeholder="Contains..."
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 text-xs"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-7 text-xs"
              onClick={handleClear}
              disabled={!localValue && !value}
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
            <Button
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={handleApply}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Active filters badge/indicator
interface ActiveFiltersIndicatorProps {
  count: number;
  onClearAll: () => void;
}

export function ActiveFiltersIndicator({ count, onClearAll }: ActiveFiltersIndicatorProps) {
  if (count === 0) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1 text-xs"
      onClick={onClearAll}
    >
      <Filter className="h-3.5 w-3.5" />
      {count} filter{count > 1 ? "s" : ""}
      <X className="h-3 w-3 ml-1" />
    </Button>
  );
}
