import { useRef, useState, useEffect } from "react";
import type { EditKind } from "@/hooks/useInlineEdit";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, X } from "lucide-react";

/**
 * One table cell with Airtable-style inline editing. Renders a normal display
 * `<td>` (double-click to edit when `canEdit` + a `kind` is set); while editing
 * it swaps to a text/number/date input or a single-select dropdown. Enter / blur
 * commit, Esc cancels. The parent owns which cell is active (single editor).
 *
 * `autoFocus` (default true) steals keyboard focus the instant the editor
 * mounts — right for an explicit double-click, wrong for a cell that merely
 * became visible because the row is hovered (see `HoverSelectCell` below,
 * used for that case instead of this component's "single" editor).
 */
export function EditableCell({
  editing, canEdit, kind, value, options,
  onStart, onCommit, onCancel, autoFocus = true,
  className, style, children,
}: {
  editing: boolean;
  canEdit: boolean;
  kind: EditKind;
  value: string;
  options?: string[];
  onStart?: () => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;          // display content
}) {
  const editable = canEdit && !!kind;

  if (editing && kind) {
    return (
      <td className={cn(className, "!overflow-visible bg-primary/5 p-0 relative")} style={style}>
        <CellEditor kind={kind} value={value} options={options} onCommit={onCommit} onCancel={onCancel} autoFocus={autoFocus} />
      </td>
    );
  }
  return (
    <td className={className} style={style}
      onDoubleClick={editable ? onStart : undefined}
      title={editable ? "Double-click to edit" : undefined}>
      {children}
    </td>
  );
}

function CellEditor({ kind, value, options, onCommit, onCancel, autoFocus }: {
  kind: NonNullable<EditKind>;
  value: string;
  options?: string[];
  onCommit: (v: string) => void;
  onCancel: () => void;
  autoFocus: boolean;
}) {
  if (kind === "pillMulti" && options && options.length) {
    return <MultiSelectEditor value={value} options={options} onCommit={onCommit} onCancel={onCancel} />;
  }
  if (kind === "single" && options && options.length) {
    return <SingleEditor value={value} options={options} onCommit={onCommit} onCancel={onCancel} />;
  }
  return <InputEditor kind={kind} value={value} onCommit={onCommit} onCancel={onCancel} autoFocus={autoFocus} />;
}

function InputEditor({ kind, value, onCommit, onCancel, autoFocus = true }: {
  kind: NonNullable<EditKind>; value: string; onCommit: (v: string) => void; onCancel: () => void; autoFocus?: boolean;
}) {
  const initial = kind === "date" ? value.slice(0, 10) : value;
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { if (autoFocus) { ref.current?.focus(); ref.current?.select?.(); } }, [autoFocus]);
  const commit = () => { if (done.current) return; done.current = true; onCommit(v); };
  const cancel = () => { if (done.current) return; done.current = true; onCancel(); };
  // Safety net: blur covers clicking elsewhere, but unmounting does NOT fire
  // blur — switching tab/page or paginating mid-type silently dropped the
  // input (tracker complaint: "not saved unless Enter"). Commit the latest
  // typed value on unmount when it actually changed.
  const latest = useRef({ v, initial, onCommit });
  latest.current = { v, initial, onCommit };
  useEffect(() => () => {
    if (!done.current && latest.current.v !== latest.current.initial) {
      done.current = true;
      latest.current.onCommit(latest.current.v);
    }
  }, []);
  return (
    <input
      ref={ref}
      type={kind === "number" ? "number" : kind === "date" ? "date" : "text"}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); cancel(); }
      }}
      className="h-full w-full border border-primary/60 bg-background px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-primary"
    />
  );
}

/** Compact, closed-by-default select for a row that's merely hovered (not
 *  double-clicked) — shows the current value as a pill/trigger with a
 *  chevron (and an "×" to clear), matching Airtable's grid look. Opens the
 *  full searchable list on click; nothing steals focus just from hovering. */
export function HoverSelectCell({
  value, options, onCommit, pillStyle, placeholder = "—",
}: {
  value: string;
  options: string[];
  onCommit: (v: string) => void;
  /** Optional per-value color, e.g. (v) => ({ bg, text }) — falls back to a plain trigger. */
  pillStyle?: (v: string) => { bg: string; text: string } | null;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  const matches = q.trim() ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;
  // Selected value pinned to the top, like the double-click editor's list.
  const filtered = value && matches.includes(value)
    ? [value, ...matches.filter((o) => o !== value)]
    : matches;
  const c = value ? pillStyle?.(value) : null;

  return (
    <div ref={ref} className="relative inline-block w-full">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={cn(
          "flex w-full items-center justify-between gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
          c ? "border-transparent" : "border-input bg-background hover:bg-muted/50",
        )}
        style={c ? { backgroundColor: c.bg, color: c.text } : undefined}
      >
        <span className="truncate">{value || <span className="text-muted-foreground font-normal">{placeholder}</span>}</span>
        <span className="flex items-center gap-0.5 shrink-0">
          {value && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onCommit(""); }}
              className="rounded-sm p-0.5 opacity-70 hover:opacity-100 hover:bg-black/10"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-[220px] rounded-md border border-border bg-popover shadow-lg" style={{ top: "100%", left: 0 }}>
          <div className="p-2 space-y-1.5">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search..."
              onClick={(e) => e.stopPropagation()}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="border rounded max-h-52 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="text-xs text-muted-foreground p-2 text-center">No matches.</div>
              ) : (
                filtered.map((opt) => {
                  const oc = pillStyle?.(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onCommit(opt); setOpen(false); setQ(""); }}
                      className="flex w-full items-center gap-2 px-2 py-1.5 hover:bg-muted text-xs text-left transition-colors"
                    >
                      <CheckboxIcon checked={opt === value} />
                      {oc ? <span className="rounded-full px-2 py-0.5 font-medium" style={{ backgroundColor: oc.bg, color: oc.text }}>{opt}</span> : opt}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Single-select with checkbox-style list, search, and Cancel/OK. */
function SingleEditor({ value, options, onCommit, onCancel }: {
  value: string; options: string[]; onCommit: (v: string) => void; onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    // Clicking outside COMMITS the current selection (same as the multi-select
    // editor) — it used to cancel, which read as "my pick didn't save unless I
    // pressed Enter/OK". Esc remains the explicit way to discard.
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (done.current) return;
        done.current = true;
        onCommit(selected);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (done.current) return; done.current = true; onCancel(); }
      if (e.key === "Enter") { if (done.current) return; done.current = true; onCommit(selected); }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [selected, onCommit, onCancel]);

  const filtered = q.trim()
    ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase()))
    : options;

  const commit = () => { if (done.current) return; done.current = true; onCommit(selected); };
  const cancel = () => { if (done.current) return; done.current = true; onCancel(); };

  return (
    <div
      ref={ref}
      className="absolute z-50 w-[280px] rounded-md border border-border bg-popover shadow-lg"
      style={{ top: "100%", left: 0 }}
    >
      <div className="p-2 space-y-1.5">
        {/* Search */}
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search..."
          className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
        />

        {/* (Blank) / clear option — picking commits immediately, Airtable-style */}
        <div
          className="flex items-center gap-2 py-0.5 px-1 border-b border-border cursor-pointer"
          onMouseDown={(e) => { e.preventDefault(); setSelected(""); if (!done.current) { done.current = true; onCommit(""); } }}
        >
          <CheckboxIcon checked={selected === ""} />
          <span className="text-xs text-muted-foreground">(Blank)</span>
        </div>

        {/* Option list — a single-select needs no confirm step: picking saves */}
        <div className="border rounded max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2 text-center">No matches.</div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setSelected(opt); if (!done.current) { done.current = true; onCommit(opt); } }}
                className="flex w-full items-center gap-2 px-2 py-1.5 hover:bg-muted text-xs text-left transition-colors"
              >
                <CheckboxIcon checked={selected === opt} />
                <span className="truncate">{opt}</span>
              </button>
            ))
          )}
        </div>

        {/* Cancel / OK */}
        <div className="flex justify-end gap-1.5 pt-0.5">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); cancel(); }}
            className="h-7 px-3 rounded-md border border-input bg-background text-xs hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); commit(); }}
            className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

/** Multi-select with search, Select All, checkbox list, and Cancel/OK. */
function MultiSelectEditor({ value, options, onCommit, onCancel }: {
  value: string; options: string[]; onCommit: (v: string) => void; onCancel: () => void;
}) {
  const current = value ? value.split(/\s*,\s*/).filter(Boolean) : [];
  const [selected, setSelected] = useState<string[]>(current);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (done.current) return;
        done.current = true;
        onCommit(selected.join(", "));
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (done.current) return; done.current = true; onCancel(); }
      if (e.key === "Enter") { if (done.current) return; done.current = true; onCommit(selected.join(", ")); }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [selected, onCommit, onCancel]);

  const filtered = q.trim()
    ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase()))
    : options;

  const selSet = new Set(selected);
  const allSel = selected.length === options.length && options.length > 0;
  const someSel = selected.length > 0 && !allSel;

  const toggle = (opt: string) =>
    setSelected((prev) => prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt]);
  const toggleAll = () => setSelected(allSel ? [] : [...options]);

  const commit = () => { if (done.current) return; done.current = true; onCommit(selected.join(", ")); };
  const cancel = () => { if (done.current) return; done.current = true; onCancel(); };

  return (
    <div
      ref={ref}
      className="absolute z-50 w-[300px] rounded-md border border-border bg-popover shadow-lg"
      style={{ top: "100%", left: 0 }}
    >
      <div className="p-2 space-y-1.5">
        {/* Search */}
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search..."
          className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
        />

        {/* Select All row */}
        <div
          className="flex items-center gap-2 py-1 cursor-pointer select-none"
          onMouseDown={(e) => { e.preventDefault(); toggleAll(); }}
        >
          <CheckboxIcon checked={allSel} indeterminate={someSel} />
          <span className="text-xs">( Select All )</span>
          <span className="ml-auto text-xs text-muted-foreground">{filtered.length} items</span>
        </div>

        {/* Option list */}
        <div className="border rounded max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2 text-center">No matches.</div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); toggle(opt); }}
                className="flex w-full items-center gap-2 px-2 py-1.5 hover:bg-muted text-xs text-left transition-colors"
              >
                <CheckboxIcon checked={selSet.has(opt)} />
                <span className="truncate">{opt}</span>
              </button>
            ))
          )}
        </div>

        {/* Cancel / OK */}
        <div className="flex justify-end gap-1.5 pt-0.5">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); cancel(); }}
            className="h-7 px-3 rounded-md border border-input bg-background text-xs hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); commit(); }}
            className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckboxIcon({ checked, indeterminate }: { checked: boolean; indeterminate?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
        checked || indeterminate ? "border-primary bg-primary" : "border-muted-foreground bg-background",
      )}
    >
      {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
      {!checked && indeterminate && (
        <span className="block h-1.5 w-1.5 rounded-[1px] bg-primary-foreground" />
      )}
    </span>
  );
}
