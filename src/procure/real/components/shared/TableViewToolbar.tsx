import { startTransition, useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  Group as GroupIcon, ListFilter, ArrowUpDown, EyeOff, Rows3, Plus, X, ChevronDown,
} from "lucide-react";
import {
  type ViewField, type FilterCondition, type FilterGroup, type SortRule, type RowHeight,
  type TableView, OPS_BY_TYPE, newId,
} from "@/lib/tableView";

/** Airtable-style toolbar: Group / Filter / Sort / Hide fields / Row height.
 *  Drives the shared `useTableView` engine — see src/lib/tableView.ts. */
export function TableViewToolbar({ view, fields, className }: { view: TableView; fields: ViewField[]; className?: string }) {
  const { state, filterCount } = view;
  const groupedField = fields.find((f) => f.key === state.groupBy);
  const hiddenCount = state.hidden.length;

  const pill = (active: boolean) =>
    cn("h-8 gap-1.5 px-2.5 text-xs", active ? "bg-primary/10 text-primary hover:bg-primary/15" : "text-muted-foreground");

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {/* ── Group ── */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={pill(!!state.groupBy)}>
            <GroupIcon className="h-3.5 w-3.5" /> {groupedField ? `Grouped by ${groupedField.label}` : "Group"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 p-0">
          <Command>
            <CommandInput placeholder="Group by a field…" />
            <CommandList>
              <CommandEmpty>No field.</CommandEmpty>
              <CommandItem value="__none" onSelect={() => view.setGroupBy(null)} className="cursor-pointer">
                <span className={cn(!state.groupBy && "font-semibold text-primary")}>No grouping</span>
              </CommandItem>
              {fields.map((f) => (
                <CommandItem key={f.key} value={f.label} onSelect={() => view.setGroupBy(f.key)} className="cursor-pointer">
                  <span className={cn(state.groupBy === f.key && "font-semibold text-primary")}>{f.label}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* ── Filter ── */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={pill(filterCount > 0)}>
            <ListFilter className="h-3.5 w-3.5" /> Filter{filterCount > 0 && <span className="ml-0.5">({filterCount})</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[520px] p-3">
          <FilterEditor view={view} fields={fields} />
        </PopoverContent>
      </Popover>

      {/* ── Sort ── */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={pill(state.sort.length > 0)}>
            <ArrowUpDown className="h-3.5 w-3.5" /> Sort{state.sort.length > 0 && <span className="ml-0.5">({state.sort.length})</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[400px] p-3">
          <SortEditor view={view} fields={fields} />
        </PopoverContent>
      </Popover>

      {/* ── Hide fields ── */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={pill(hiddenCount > 0)}>
            <EyeOff className="h-3.5 w-3.5" /> {hiddenCount > 0 ? `${hiddenCount} hidden` : "Hide fields"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Find a field…" />
            <CommandList className="max-h-72">
              <CommandEmpty>No field.</CommandEmpty>
              {fields.map((f) => (
                <CommandItem key={f.key} value={f.label} onSelect={() => view.toggleHidden(f.key)} className="cursor-pointer justify-between">
                  <span>{f.label}</span>
                  <Switch checked={!state.hidden.includes(f.key)} className="pointer-events-none scale-90" />
                </CommandItem>
              ))}
            </CommandList>
          </Command>
          <div className="flex justify-between border-t p-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => view.setHidden(fields.map((f) => f.key))}>Hide all</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => view.setHidden([])}>Show all</Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* ── Row height ── */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={pill(state.rowHeight !== "short")}>
            <Rows3 className="h-3.5 w-3.5" /> Height
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-40 p-1">
          {(["short", "medium", "tall"] as RowHeight[]).map((h) => (
            <button key={h} type="button" onClick={() => view.setRowHeight(h)}
              className={cn("flex w-full items-center rounded px-2 py-1.5 text-sm capitalize hover:bg-muted", state.rowHeight === h && "font-semibold text-primary")}>
              {h}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Drag handle for column resizing — drop into a (positioned) <th>. Measures the
 * th's current width on grab, then reports new widths during the drag. Double
 * click resets the column to its default. Mirrors the Demand Planner resizer.
 */
export function ColResizeHandle({ onResize, onReset, min = 40, max = 800 }: {
  onResize: (w: number) => void; onReset?: () => void; min?: number; max?: number;
}) {
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement | null;
    const startX = e.clientX;
    const startW = th?.offsetWidth ?? 120;
    let raf = 0;
    const move = (ev: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => onResize(Math.min(max, Math.max(min, startW + (ev.clientX - startX)))));
    };
    const up = () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  return (
    <span
      onMouseDown={start}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); onReset?.(); }}
      title="Drag to resize · double-click to reset"
      className="absolute top-0 right-0 z-10 h-full w-[8px] cursor-col-resize opacity-0 transition-opacity hover:opacity-100 bg-primary/40"
    />
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

/** Direction labels read naturally per field type — a date sorts
 *  Earliest→Latest, a number Low→High, a single-select/pill field (Vendor,
 *  Forwarder, Country…) First→Last, plain free text A→Z. */
function sortDirLabels(type: ViewField["type"] | undefined): { asc: string; desc: string } {
  if (type === "date") return { asc: "Earliest → Latest", desc: "Latest → Earliest" };
  if (type === "number") return { asc: "Low → High", desc: "High → Low" };
  if (type === "single" || type === "multi") return { asc: "First → Last", desc: "Last → First" };
  return { asc: "A → Z", desc: "Z → A" };
}

function SortEditor({ view, fields }: { view: TableView; fields: ViewField[] }) {
  const { sort } = view.state;
  const used = new Set(sort.map((s) => s.field));
  const avail = fields.filter((f) => !used.has(f.key));
  const fieldType = (key: string) => fields.find((f) => f.key === key)?.type;

  const update = (i: number, patch: Partial<SortRule>) => view.setSort(sort.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const remove = (i: number) => view.setSort(sort.filter((_, idx) => idx !== i));
  const add = () => { if (avail[0]) view.setSort([...sort, { field: avail[0].key, dir: "asc" }]); };

  return (
    <div className="space-y-2">
      {sort.length === 0 && <p className="text-xs text-muted-foreground">No sorts applied.</p>}
      {sort.map((s, i) => {
        const labels = sortDirLabels(fieldType(s.field));
        return (
        <div key={`${s.field}-${i}`} className="flex items-center gap-2">
          <Select value={s.field} onValueChange={(v) => update(i, { field: v })}>
            <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {fields.filter((f) => f.key === s.field || !used.has(f.key)).map((f) => (
                <SelectItem key={f.key} value={f.key} className="text-xs">{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={s.dir} onValueChange={(v) => update(i, { dir: v as "asc" | "desc" })}>
            <SelectTrigger className="h-8 w-[150px] shrink-0 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="asc" className="text-xs">{labels.asc}</SelectItem>
              <SelectItem value="desc" className="text-xs">{labels.desc}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => remove(i)}><X className="h-3.5 w-3.5" /></Button>
        </div>
        );
      })}
      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={add} disabled={!avail.length}><Plus className="h-3.5 w-3.5" /> Add sort</Button>
        {sort.length > 0 && <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => view.setSort([])}>Clear</Button>}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function FilterEditor({ view, fields }: { view: TableView; fields: ViewField[] }) {
  const root = view.state.filter;
  return (
    <div className="space-y-2">
      <GroupEditor group={root} fields={fields} depth={0}
        onChange={(g) => view.setFilter(g)} />
      {root.children.length > 0 && (
        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
            onClick={() => view.setFilter({ ...root, children: [] })}>Clear all</Button>
        </div>
      )}
    </div>
  );
}

function GroupEditor({ group, fields, depth, onChange }: {
  group: FilterGroup; fields: ViewField[]; depth: number; onChange: (g: FilterGroup) => void;
}) {
  const setChild = (i: number, child: FilterCondition | FilterGroup) =>
    onChange({ ...group, children: group.children.map((c, idx) => idx === i ? child : c) });
  const removeChild = (i: number) => onChange({ ...group, children: group.children.filter((_, idx) => idx !== i) });
  const addCondition = () => {
    const f = fields[0];
    const op = OPS_BY_TYPE[f.type][0].op;
    onChange({ ...group, children: [...group.children, { id: newId(), kind: "condition", field: f.key, op, value: "" }] });
  };
  const addGroup = () => onChange({ ...group, children: [...group.children, { id: newId("g"), kind: "group", conjunction: "and", children: [] }] });

  return (
    <div className={cn(depth > 0 && "rounded-md border bg-muted/30 p-2")}>
      {group.children.length === 0 && depth === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">No filter conditions are applied.</p>
      )}
      <div className="space-y-1.5">
        {group.children.map((child, i) => (
          <div key={child.id} className="flex items-start gap-2">
            {/* Conjunction column */}
            <div className="w-16 shrink-0 pt-1.5 text-xs">
              {i === 0 ? (
                <span className="text-muted-foreground">Where</span>
              ) : i === 1 ? (
                <Select value={group.conjunction} onValueChange={(v) => onChange({ ...group, conjunction: v as "and" | "or" })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="and" className="text-xs">and</SelectItem>
                    <SelectItem value="or" className="text-xs">or</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-muted-foreground">{group.conjunction}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              {child.kind === "condition"
                ? <ConditionRow cond={child} fields={fields} onChange={(c) => setChild(i, c)} />
                : <GroupEditor group={child} fields={fields} depth={depth + 1} onChange={(g) => setChild(i, g)} />}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeChild(i)}><X className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1 pt-2">
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={addCondition}><Plus className="h-3.5 w-3.5" /> Add condition</Button>
        {depth === 0 && <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={addGroup}><Plus className="h-3.5 w-3.5" /> Add condition group</Button>}
      </div>
    </div>
  );
}

function ConditionRow({ cond, fields, onChange }: { cond: FilterCondition; fields: ViewField[]; onChange: (c: FilterCondition) => void }) {
  const field = fields.find((f) => f.key === cond.field) ?? fields[0];
  const ops = OPS_BY_TYPE[field.type];
  const opMeta = ops.find((o) => o.op === cond.op) ?? ops[0];

  const onFieldChange = (key: string) => {
    const nf = fields.find((f) => f.key === key)!;
    const op = OPS_BY_TYPE[nf.type][0].op;
    onChange({ ...cond, field: key, op, value: "", values: undefined });
  };

  const onOpChange = (v: string) => {
    const newOp = v as FilterCondition["op"];
    if (newOp === "isAnyOf" || newOp === "isNoneOf") {
      onChange({ ...cond, op: newOp, value: "", values: cond.values ?? [] });
    } else {
      onChange({ ...cond, op: newOp, values: undefined });
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Select value={cond.field} onValueChange={onFieldChange}>
        <SelectTrigger className="h-8 w-[40%] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{fields.map((f) => <SelectItem key={f.key} value={f.key} className="text-xs">{f.label}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={cond.op} onValueChange={onOpChange}>
        <SelectTrigger className="h-8 w-[28%] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{ops.map((o) => <SelectItem key={o.op} value={o.op} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
      </Select>
      {!opMeta.noValue && (
        opMeta.multi
          ? <MultiCheckboxValueInput
              options={field.options ?? []}
              values={cond.values ?? []}
              onChange={(values) => onChange({ ...cond, values })}
            />
          : <ValueInput field={field} value={cond.value} onChange={(value) => onChange({ ...cond, value })} />
      )}
    </div>
  );
}

function MultiCheckboxValueInput({ options, values, onChange }: {
  options: string[];
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<string[]>(values);

  useEffect(() => {
    if (open) { setDraft(values); setQ(""); }
  }, [open]); // intentionally not including `values` — draft syncs only on open

  const filtered = q.trim() ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;
  const draftSet = new Set(draft);
  const allSel = draft.length === options.length && options.length > 0;
  const someSel = draft.length > 0 && !allSel;

  const toggle = (opt: string) =>
    setDraft((prev) => (prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt]));
  const toggleAll = () => setDraft((prev) => (prev.length === options.length ? [] : [...options]));

  const label = values.length === 0
    ? "Select values…"
    : values.length === 1
      ? values[0]
      : `${values.length} values`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-8 flex-1 min-w-0 border rounded-md px-2 text-xs text-left flex items-center justify-between gap-1 bg-background hover:bg-muted/50 transition-colors"
        >
          <span className="truncate text-foreground">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2 space-y-1.5" style={{ zIndex: 200 }}>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="h-7 text-xs"
          autoFocus
        />
        <div
          className="flex items-center gap-2 py-0.5 cursor-pointer select-none"
          onClick={toggleAll}
        >
          <Checkbox
            checked={allSel ? true : someSel ? "indeterminate" : false}
            onCheckedChange={toggleAll}
            className="h-3.5 w-3.5"
          />
          <span className="text-xs text-muted-foreground">Select all</span>
          <span className="ml-auto text-xs text-muted-foreground">{filtered.length}</span>
        </div>
        <div className="border rounded max-h-48 overflow-y-auto">
          {options.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2 text-center">No options available.</div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2 text-center">No matches.</div>
          ) : (
            filtered.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={draftSet.has(opt)}
                  onCheckedChange={() => toggle(opt)}
                  className="h-3.5 w-3.5"
                />
                <span className="text-xs truncate">{opt}</span>
              </label>
            ))
          )}
        </div>
        <div className="flex justify-end gap-1.5 pt-1">
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" className="h-6 text-xs px-2" onClick={() => { startTransition(() => onChange(draft)); setOpen(false); }}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ValueInput({ field, value, onChange }: { field: ViewField; value: string; onChange: (v: string) => void }) {
  const cls = "h-8 flex-1 text-xs";
  if ((field.type === "single" || field.type === "multi") && field.options?.length) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={cls}><SelectValue placeholder="Select…" /></SelectTrigger>
        <SelectContent>{field.options.map((o) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  if (field.type === "bool") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={cls}><SelectValue placeholder="Select…" /></SelectTrigger>
        <SelectContent><SelectItem value="Yes" className="text-xs">Yes</SelectItem><SelectItem value="No" className="text-xs">No</SelectItem></SelectContent>
      </Select>
    );
  }
  if (field.type === "date") return <Input type="date" value={value.slice(0, 10)} onChange={(e) => onChange(e.target.value)} className={cls} />;
  if (field.type === "number") return <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} className={cls} placeholder="value" />;
  return <Input value={value} onChange={(e) => onChange(e.target.value)} className={cls} placeholder="value" />;
}
