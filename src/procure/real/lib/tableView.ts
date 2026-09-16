import { useMemo } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";

/**
 * Headless table-view engine — Airtable-style Sort / Filter / Group / Hide
 * fields / Row height, shared across the bespoke tracker tables (Shipping
 * Requests, Freight Bills, Order Pipeline). Each page keeps its own <table>
 * rendering; this only owns the view STATE and the data transform
 * (filter → sort → group). Pair with <TableViewToolbar/> for the UI.
 */

export type FieldType = "text" | "number" | "date" | "single" | "multi" | "bool";

export interface ViewField {
  key: string;
  label: string;
  type: FieldType;
  /** Options for single/multi-select fields (drives the filter value picker). */
  options?: string[];
  /** Custom accessor when the display value differs from row[key]. */
  getValue?: (row: Record<string, unknown>) => unknown;
  /** Canonical value order for sorting (e.g. workflow steps). Unknown values sort last, alphabetically. */
  sortOrder?: string[];
}

export type FilterOp =
  | "is" | "isNot" | "contains" | "notContains"
  | "isEmpty" | "isNotEmpty"
  | "eq" | "neq" | "gt" | "lt" | "gte" | "lte"
  | "before" | "after"
  | "isAnyOf" | "isNoneOf";

export interface FilterCondition {
  id: string;
  kind: "condition";
  field: string;
  op: FilterOp;
  value: string;        // scalar value (or empty for isEmpty/isNotEmpty)
  values?: string[];    // for isAnyOf / isNoneOf
}

export interface FilterGroup {
  id: string;
  kind: "group";
  conjunction: "and" | "or";
  children: (FilterCondition | FilterGroup)[];
}

export interface SortRule { field: string; dir: "asc" | "desc"; }

/** Per-column statistic shown in group summary rows (Airtable-style). */
export type GroupStat = "sum" | "avg" | "count" | "min" | "max";

/** Compute one statistic over a set of rows for a column. `count` counts
 *  non-empty cells; the numeric stats parse "$1,234.5"-style strings. */
export function computeGroupStat(
  rows: Record<string, unknown>[],
  key: string,
  fn: GroupStat,
  getValue?: (row: Record<string, unknown>) => unknown,
): number | null {
  const raws = rows.map((r) => (getValue ? getValue(r) : r[key]));
  if (fn === "count") return raws.filter((v) => String(v ?? "").trim() !== "").length;
  const clean = raws
    .map((v) => String(v ?? "").trim())
    .filter((s) => s !== "")
    .map((s) => Number(s.replace(/[$,\s%]/g, "")))
    .filter((n) => Number.isFinite(n));
  if (!clean.length) return null;
  switch (fn) {
    case "sum": return clean.reduce((a, b) => a + b, 0);
    case "avg": return clean.reduce((a, b) => a + b, 0) / clean.length;
    case "min": return Math.min(...clean);
    case "max": return Math.max(...clean);
  }
  return null;
}

export type RowHeight = "short" | "medium" | "tall";

export interface ViewState {
  sort: SortRule[];
  filter: FilterGroup;
  groupBy: string | null;
  hidden: string[];          // hidden field keys
  rowHeight: RowHeight;
  colWidths: Record<string, number>;  // per-field pixel width overrides (drag-resize)
  /** Per-column group statistic (sum/avg/count/min/max). Optional — persisted
   *  states created before this feature existed won't have it. */
  stats?: Record<string, GroupStat>;
}

export const ROW_HEIGHT_PX: Record<RowHeight, number> = { short: 32, medium: 44, tall: 64 };

/** Operators available for each field type (in display order). */
export const OPS_BY_TYPE: Record<FieldType, { op: FilterOp; label: string; noValue?: boolean; multi?: boolean }[]> = {
  text:   [{ op: "contains", label: "contains" }, { op: "notContains", label: "does not contain" }, { op: "is", label: "is" }, { op: "isNot", label: "is not" }, { op: "isEmpty", label: "is empty", noValue: true }, { op: "isNotEmpty", label: "is not empty", noValue: true }],
  number: [{ op: "eq", label: "=" }, { op: "neq", label: "≠" }, { op: "gt", label: ">" }, { op: "lt", label: "<" }, { op: "gte", label: "≥" }, { op: "lte", label: "≤" }, { op: "isEmpty", label: "is empty", noValue: true }, { op: "isNotEmpty", label: "is not empty", noValue: true }],
  date:   [{ op: "is", label: "is" }, { op: "before", label: "is before" }, { op: "after", label: "is after" }, { op: "isEmpty", label: "is empty", noValue: true }, { op: "isNotEmpty", label: "is not empty", noValue: true }],
  single: [{ op: "is", label: "is" }, { op: "isNot", label: "is not" }, { op: "isAnyOf", label: "is any of", multi: true }, { op: "isNoneOf", label: "is none of", multi: true }, { op: "isEmpty", label: "is empty", noValue: true }, { op: "isNotEmpty", label: "is not empty", noValue: true }],
  // "has any of" listed first — it's a multi-select checklist and the
  // natural default for a multi-value field, not the single-value "has".
  // "has none of" = the MULTI checklist (Airtable's label for it) — tracker
  // bug: it used to sit on the single-value notContains, so picking it only
  // allowed one selection. The single-value op is now "does not have".
  multi:  [{ op: "isAnyOf", label: "has any of", multi: true }, { op: "isNoneOf", label: "has none of", multi: true }, { op: "contains", label: "has" }, { op: "notContains", label: "does not have" }, { op: "isEmpty", label: "is empty", noValue: true }, { op: "isNotEmpty", label: "is not empty", noValue: true }],
  bool:   [{ op: "is", label: "is" }],
};

let _uid = 0;
/** Monotonic id for new conditions/groups (avoids Math.random which is blocked in workflows). */
export function newId(prefix = "c"): string { _uid += 1; return `${prefix}${_uid}`; }

export function emptyFilter(): FilterGroup {
  return { id: "root", kind: "group", conjunction: "and", children: [] };
}

function toStr(v: unknown): string {
  return v == null ? "" : String(v);
}
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
/** Multi-select stored values are comma/newline/semicolon-joined. */
function splitMulti(v: unknown): string[] {
  return toStr(v).split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
}

function evalCondition(row: Record<string, unknown>, c: FilterCondition, fieldMap: Map<string, ViewField>): boolean {
  const field = fieldMap.get(c.field);
  if (!field) return true;
  const raw = field.getValue ? field.getValue(row) : row[c.field];
  const s = toStr(raw).toLowerCase();

  switch (c.op) {
    case "isEmpty":    return s.trim() === "";
    case "isNotEmpty": return s.trim() !== "";
    case "contains":   return field.type === "multi" ? splitMulti(raw).map((x) => x.toLowerCase()).includes(c.value.toLowerCase()) : s.includes(c.value.toLowerCase());
    case "notContains":return field.type === "multi" ? !splitMulti(raw).map((x) => x.toLowerCase()).includes(c.value.toLowerCase()) : !s.includes(c.value.toLowerCase());
    case "is":         return field.type === "bool" ? boolEq(raw, c.value) : s === c.value.toLowerCase();
    case "isNot":      return s !== c.value.toLowerCase();
    case "isAnyOf": {
      const set = (c.values ?? []).map((x) => x.toLowerCase());
      return field.type === "multi"
        ? splitMulti(raw).some((x) => set.includes(x.toLowerCase()))
        : set.includes(s);
    }
    case "isNoneOf": {
      const set = (c.values ?? []).map((x) => x.toLowerCase());
      return field.type === "multi"
        ? !splitMulti(raw).some((x) => set.includes(x.toLowerCase()))
        : !set.includes(s);
    }
    case "eq":  { const a = toNum(raw), b = toNum(c.value); return a != null && b != null && a === b; }
    case "neq": { const a = toNum(raw), b = toNum(c.value); return !(a != null && b != null && a === b); }
    case "gt":  { const a = toNum(raw), b = toNum(c.value); return a != null && b != null && a > b; }
    case "lt":  { const a = toNum(raw), b = toNum(c.value); return a != null && b != null && a < b; }
    case "gte": { const a = toNum(raw), b = toNum(c.value); return a != null && b != null && a >= b; }
    case "lte": { const a = toNum(raw), b = toNum(c.value); return a != null && b != null && a <= b; }
    case "before": return s !== "" && c.value !== "" && s.slice(0, 10) < c.value.slice(0, 10);
    case "after":  return s !== "" && c.value !== "" && s.slice(0, 10) > c.value.slice(0, 10);
    default: return true;
  }
}

function boolEq(raw: unknown, value: string): boolean {
  const truthy = raw === true || /^(yes|true|1)$/i.test(toStr(raw));
  return value.toLowerCase() === "yes" || value.toLowerCase() === "true" ? truthy : !truthy;
}

function evalGroup(row: Record<string, unknown>, g: FilterGroup, fieldMap: Map<string, ViewField>): boolean {
  if (!g.children.length) return true;
  const results = g.children.map((ch) => ch.kind === "group" ? evalGroup(row, ch, fieldMap) : evalCondition(row, ch, fieldMap));
  return g.conjunction === "and" ? results.every(Boolean) : results.some(Boolean);
}

/** Count leaf conditions (for the toolbar badge). */
export function countConditions(g: FilterGroup): number {
  return g.children.reduce((n, ch) => n + (ch.kind === "group" ? countConditions(ch) : 1), 0);
}

function compareByField(a: Record<string, unknown>, b: Record<string, unknown>, rule: SortRule, fieldMap: Map<string, ViewField>): number {
  const field = fieldMap.get(rule.field);
  const av = field?.getValue ? field.getValue(a) : a[rule.field];
  const bv = field?.getValue ? field.getValue(b) : b[rule.field];
  let cmp: number;
  if (field?.type === "number") {
    const an = toNum(av) ?? -Infinity, bn = toNum(bv) ?? -Infinity;
    cmp = an - bn;
  } else if (field?.sortOrder?.length) {
    cmp = ordinalCompare(toStr(av), toStr(bv), field.sortOrder);
  } else {
    cmp = toStr(av).localeCompare(toStr(bv), undefined, { numeric: true, sensitivity: "base" });
  }
  return rule.dir === "asc" ? cmp : -cmp;
}

/** Compare by position in a canonical order; values not in the list sort after known ones, alphabetically.
 *  BLANK sorts FIRST — before any step (tracker request: an unset Progress/Status
 *  outranks every actual step when sorting ascending). */
function ordinalCompare(a: string, b: string, order: string[]): number {
  const idx = (v: string) => {
    if (!v.trim()) return -1; // blank before any step
    // Multi-valued cells (e.g. "In Review, BOOKED") sort by their earliest step.
    const parts = v.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
    let best = Infinity;
    for (const p of parts.length ? parts : [v]) {
      const i = order.findIndex((o) => o.toLowerCase() === p.toLowerCase());
      if (i !== -1 && i < best) best = i;
    }
    return best;
  };
  const ai = idx(a), bi = idx(b);
  if (ai !== bi) return ai - bi;
  if (ai === Infinity) return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return 0;
}

export interface GroupBucket { key: string; label: string; rows: Record<string, unknown>[]; }

export interface TableViewResult {
  /** Filtered + sorted rows (use when not grouping). */
  rows: Record<string, unknown>[];
  /** Buckets when groupBy is set, else null. */
  groups: GroupBucket[] | null;
}

/** Pure transform: filter → sort → group. Exported for tests / non-hook callers. */
export function applyView(
  rows: Record<string, unknown>[],
  state: ViewState,
  fields: ViewField[],
): TableViewResult {
  const fieldMap = new Map(fields.map((f) => [f.key, f]));

  let out = rows;
  if (state.filter.children.length) out = out.filter((r) => evalGroup(r, state.filter, fieldMap));

  if (state.sort.length) {
    out = [...out].sort((a, b) => {
      for (const rule of state.sort) {
        const c = compareByField(a, b, rule, fieldMap);
        if (c !== 0) return c;
      }
      return 0;
    });
  }

  if (state.groupBy) {
    const field = fieldMap.get(state.groupBy);
    const buckets = new Map<string, GroupBucket>();
    for (const r of out) {
      const raw = field?.getValue ? field.getValue(r) : r[state.groupBy];
      const key = toStr(raw).trim();
      const label = key === "" ? "(Empty)" : key;
      let b = buckets.get(key);
      if (!b) { b = { key, label, rows: [] }; buckets.set(key, b); }
      b.rows.push(r);
    }
    return { rows: out, groups: Array.from(buckets.values()) };
  }

  return { rows: out, groups: null };
}

const DEFAULT_STATE: ViewState = { sort: [], filter: emptyFilter(), groupBy: null, hidden: [], rowHeight: "short", colWidths: {}, stats: {} };

export interface UseTableViewArgs {
  storageKey: string;
  fields: ViewField[];
  rows: Record<string, unknown>[];
  /** Optional default sort applied when the user hasn't set one. */
  defaultSort?: SortRule[];
}

export function useTableView({ storageKey, fields, rows, defaultSort }: UseTableViewArgs) {
  const [state, setState] = usePersistedState<ViewState>(`tableview:${storageKey}`, {
    ...DEFAULT_STATE,
    sort: defaultSort ?? [],
  });

  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);

  const result = useMemo(() => applyView(rows, state, fields), [rows, state, fields]);

  const hiddenSet = useMemo(() => new Set(state.hidden), [state.hidden]);
  const visibleFields = useMemo(() => fields.filter((f) => !hiddenSet.has(f.key)), [fields, hiddenSet]);

  // ── Setters ──
  const setSort = (sort: SortRule[]) => setState((p) => ({ ...p, sort }));
  /** Header-click cycle: none → asc → desc → none (single-field, replaces multi-sort). */
  const toggleSort = (field: string) => setState((p) => {
    const cur = p.sort.length === 1 && p.sort[0].field === field ? p.sort[0] : null;
    if (!cur) return { ...p, sort: [{ field, dir: "asc" }] };
    if (cur.dir === "asc") return { ...p, sort: [{ field, dir: "desc" }] };
    return { ...p, sort: [] };
  });
  const setFilter = (filter: FilterGroup) => setState((p) => ({ ...p, filter }));
  const setGroupBy = (groupBy: string | null) => setState((p) => ({ ...p, groupBy }));
  const setHidden = (hidden: string[]) => setState((p) => ({ ...p, hidden }));
  const toggleHidden = (key: string) => setState((p) => ({ ...p, hidden: p.hidden.includes(key) ? p.hidden.filter((k) => k !== key) : [...p.hidden, key] }));
  const setRowHeight = (rowHeight: RowHeight) => setState((p) => ({ ...p, rowHeight }));
  const setColWidth = (key: string, w: number) => setState((p) => ({ ...p, colWidths: { ...p.colWidths, [key]: w } }));
  /** Set or clear (fn = null) the group-summary statistic for one column. */
  const setStat = (key: string, fn: GroupStat | null) => setState((p) => {
    const next = { ...(p.stats ?? {}) };
    if (fn) next[key] = fn; else delete next[key];
    return { ...p, stats: next };
  });
  const clearColWidth = (key: string) => setState((p) => {
    const next = { ...p.colWidths }; delete next[key]; return { ...p, colWidths: next };
  });
  const reset = () => setState({ ...DEFAULT_STATE, sort: defaultSort ?? [] });

  return {
    state, setState,
    setSort, toggleSort, setFilter, setGroupBy, setHidden, toggleHidden, setRowHeight, setColWidth, clearColWidth, setStat, reset,
    result, fieldMap, hiddenSet, visibleFields,
    filterCount: countConditions(state.filter),
    rowHeightPx: ROW_HEIGHT_PX[state.rowHeight],
    // Cell vertical padding that produces the target row height (text ≈ 18px tall).
    // Row height in a <table> is a MINIMUM, so padding — not <tr height> — is what
    // actually drives the visible height. Set this as the --app-td-py CSS var.
    rowPadYPx: Math.max(4, Math.round((ROW_HEIGHT_PX[state.rowHeight] - 18) / 2)),
  };
}

export type TableView = ReturnType<typeof useTableView>;
