import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import ReactDOM from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Columns3, Search, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";

interface ColumnVisibilityDropdownProps {
  columns: { key: string; label: string; group: string }[];
  hiddenColumns: Set<string>;
  requiredColumns: string[];
  onChange: (hiddenColumns: Set<string>) => void;
  onReset: () => void;
}

const ColumnRow = React.memo(function ColumnRow({
  col,
  isRequired,
  isVisible,
  onToggle,
}: {
  col: { key: string; label: string };
  isRequired: boolean;
  isVisible: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <label
      className={`flex items-center gap-2 px-2 py-1 ml-5 rounded hover:bg-accent/50 cursor-pointer text-xs ${
        isRequired ? "opacity-60 cursor-not-allowed" : ""
      }`}
    >
      <Checkbox
        checked={isVisible}
        disabled={isRequired}
        onCheckedChange={() => onToggle(col.key)}
        className="h-3.5 w-3.5"
      />
      <span className="truncate">{col.label.replace(/\n/g, " ")}</span>
      {isRequired && (
        <span className="ml-auto text-[9px] text-muted-foreground shrink-0">Required</span>
      )}
    </label>
  );
});

export const ColumnVisibilityDropdown = React.memo(function ColumnVisibilityDropdown({
  columns,
  hiddenColumns,
  requiredColumns,
  onChange,
  onReset,
}: ColumnVisibilityDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const visibleCount = useMemo(() => {
    // Only count columns that are in the dropdown (excludes permanently hidden columns)
    const dropdownKeys = new Set(columns.map(c => c.key));
    const hiddenInDropdown = Array.from(hiddenColumns).filter(key => dropdownKeys.has(key));
    return columns.length - hiddenInDropdown.length;
  }, [columns, hiddenColumns]);
  
  const totalCount = columns.length;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      if (!prev && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPos({ top: rect.bottom + 4, left: Math.max(rect.right - 320, 8) });
      }
      return !prev;
    });
    setSearch("");
  }, []);

  const toggleColumn = useCallback(
    (key: string) => {
      if (requiredColumns.includes(key)) return;
      const next = new Set(hiddenColumns);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onChange(next);
    },
    [hiddenColumns, onChange, requiredColumns],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return columns;
    const q = search.toLowerCase();
    return columns.filter(
      (col) =>
        col.label.toLowerCase().includes(q) ||
        col.key.toLowerCase().includes(q) ||
        col.group.toLowerCase().includes(q),
    );
  }, [columns, search]);

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, typeof filtered>>((acc, col) => {
      if (!acc[col.group]) acc[col.group] = [];
      acc[col.group].push(col);
      return acc;
    }, {});
  }, [filtered]);

  const allGroupNames = useMemo(
    () => Array.from(new Set(columns.map((c) => c.group))),
    [columns],
  );

  const toggleGroupCollapse = useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedGroups(new Set(allGroupNames));
  }, [allGroupNames]);

  const expandAll = useCallback(() => {
    setCollapsedGroups(new Set());
  }, []);

  const toggleGroupVisibility = useCallback(
    (group: string, cols: { key: string }[]) => {
      const toggleable = cols.filter((c) => !requiredColumns.includes(c.key));
      const allVisible = toggleable.every((c) => !hiddenColumns.has(c.key));
      const next = new Set(hiddenColumns);
      if (allVisible) {
        toggleable.forEach((c) => next.add(c.key));
      } else {
        toggleable.forEach((c) => next.delete(c.key));
      }
      onChange(next);
    },
    [hiddenColumns, onChange, requiredColumns],
  );

  return (
    <>
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={toggleOpen}
      >
        <Columns3 className="h-3.5 w-3.5" />
        <span className="text-xs">
          Columns ({visibleCount}/{totalCount})
        </span>
      </Button>

      {open &&
        ReactDOM.createPortal(
          <div
            ref={dropdownRef}
            className="fixed bg-popover border border-border rounded-lg shadow-xl flex flex-col"
            style={{ top: pos.top, left: pos.left, zIndex: 9999, width: 320, maxHeight: 520 }}
          >
            <div className="px-3 pt-3 pb-2 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Column Visibility</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground gap-1"
                onClick={onReset}
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </Button>
            </div>

            <div className="px-3 py-2 flex items-center gap-1 border-b border-border">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] gap-1"
                onClick={expandAll}
              >
                <ChevronDown className="h-3 w-3" />
                Expand All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] gap-1"
                onClick={collapseAll}
              >
                <ChevronRight className="h-3 w-3" />
                Collapse All
              </Button>
            </div>

            <div className="px-3 py-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search columns..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-7 pl-8 text-xs"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-1 pb-2" style={{ maxHeight: 360 }}>
              {Object.entries(grouped).map(([group, cols]) => {
                const toggleable = cols.filter((c) => !requiredColumns.includes(c.key));
                const visibleInGroup = toggleable.filter((c) => !hiddenColumns.has(c.key)).length;
                const allVisible = toggleable.length > 0 && visibleInGroup === toggleable.length;
                const noneVisible = visibleInGroup === 0;
                const indeterminate = !allVisible && !noneVisible;
                const isCollapsed = collapsedGroups.has(group) && !search.trim();

                return (
                  <div key={group} className="mb-1">
                    <div className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent/40">
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapse(group)}
                        className="p-0.5 hover:bg-accent rounded shrink-0"
                        aria-label={isCollapsed ? "Expand" : "Collapse"}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        )}
                      </button>
                      <Checkbox
                        checked={indeterminate ? "indeterminate" : allVisible}
                        disabled={toggleable.length === 0}
                        onCheckedChange={() => toggleGroupVisibility(group, cols)}
                        className="h-3.5 w-3.5"
                      />
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapse(group)}
                        className="flex-1 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                      >
                        {group}
                        <span className="ml-1 normal-case tracking-normal text-muted-foreground/70">
                          ({visibleInGroup}/{toggleable.length})
                        </span>
                      </button>
                    </div>
                    {!isCollapsed &&
                      cols.map((col) => (
                        <ColumnRow
                          key={col.key}
                          col={col}
                          isRequired={requiredColumns.includes(col.key)}
                          isVisible={!hiddenColumns.has(col.key)}
                          onToggle={toggleColumn}
                        />
                      ))}
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No columns match "{search}"
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
});
