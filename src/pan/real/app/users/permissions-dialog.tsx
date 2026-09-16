"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { MODULES, modulesForPath, roleTemplate } from "@/lib/auth/permissions";
import { GROUPS as NAV_GROUPS, type IconKey } from "@/lib/nav";
import { NavIcon } from "@/components/sidebar";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/auth/rbac";
import {
  getUserPermissions,
  setUserPermissions,
  type ModulePerm,
  type ModulePermView,
} from "./actions";

type Cell = { view: boolean; edit: boolean };
type Base = { roleView: boolean; roleEdit: boolean };

// ── KAPAREHO NG SIDEBAR ANG GRID (Joe 2026-09-05) ────────────────────────────
// Bawat hilera = isang entry ng sidebar (parehong pangalan, icon, pagkakasunod,
// group). Ang checkbox ng hilera ay nakatali sa permission module ng page na
// iyon; ang ilang page ay may ilang module (Website Content = hero + homepage +
// reviews + videos + promo), at ang ilang page ay iisang module (lahat ng page
// ng Delivery Team A = team_a) — sabay-sabay silang natitik. Ang mga module na
// wala sa sidebar (hal. Delivery Tracker na action-guard lang) ay nasa "Other"
// sa dulo para magrant pa rin.
type Row = { id: string; label: string; icon: IconKey; keys: string[] };
type RowGroup = { group: string; rows: Row[] };
function navRowGroups(): RowGroup[] {
  const out: RowGroup[] = [];
  const covered = new Set<string>();
  let workshopDone = false;
  for (const g of NAV_GROUPS) {
    let title = g.title ?? "General";
    if (/^Workshop/i.test(title)) { if (workshopDone) continue; workshopDone = true; title = "Workshop"; }
    const rows: Row[] = [];
    for (const it of g.items) {
      const path = it.href.split(/[#?]/)[0];
      if (path.startsWith("/soon")) continue;
      const keys = modulesForPath(path);
      if (!keys.length) continue;
      keys.forEach((k) => covered.add(k));
      rows.push({ id: `${title}|${it.href}`, label: it.label, icon: it.icon, keys });
    }
    if (rows.length) out.push({ group: title, rows });
  }
  // Ang mga module na walang sidebar entry (nakatagong page, action-only na
  // guard, admin-only) ay HINDI ipinapakita (Joe 2026-09-05, "dapat hide na rin")
  // - nananatili ang kasalukuyang halaga nila sa Save.
  return out;
}
const NAV_ROW_GROUPS = navRowGroups();

// ── INLINE PANEL (2026-09-03, "ung permission magkadugsong na dapat") ────────
// Ang buong permissions grid — presets, search, group-banded na table, Save —
// bilang embeddable na panel: ginagamit ito nang DIRETSO sa App Login section
// ng Employee Directory modal (karugtong ng login fields), at ng lumang
// PermissionsDialog (button + Modal wrapper) para sa /users at sa shared-logins
// tab. Iisang code ang dalawa.
export function PermissionsPanel({ userId, userRole, onSaved }: {
  userId: string;
  userRole: Role;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perms, setPerms] = useState<Record<string, Cell>>({});
  const [base, setBase] = useState<Record<string, Base>>({});
  const [q, setQ] = useState("");
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null); setQ("");
      try {
        const data: ModulePermView[] = await getUserPermissions(userId);
        if (!alive) return;
        const map: Record<string, Cell> = {};
        const bmap: Record<string, Base> = {};
        for (const p of data) {
          map[p.module] = { view: p.view, edit: p.edit };
          bmap[p.module] = { roleView: p.roleView, roleEdit: p.roleEdit };
        }
        setPerms(map); setBase(bmap);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  // Apply the "edit implies view, no view implies no edit" rule to one cell.
  function normalize(cur: Cell, action: "view" | "edit", checked: boolean): Cell {
    const next = { ...cur };
    if (action === "view") {
      next.view = checked;
      if (!checked) next.edit = false;
    } else {
      next.edit = checked;
      if (checked) next.view = true;
    }
    return next;
  }

  // Set a whole list of modules to a fixed cell value (used by group/bulk toggles).
  function setMany(keys: string[], value: Cell) {
    setSaved(false);
    setPerms((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = { ...value };
      return next;
    });
  }

  // Reset one module back to its role default.
  function resetModule(k: string) {
    const b = base[k];
    if (!b) return;
    setSaved(false);
    setPerms((prev) => ({ ...prev, [k]: { view: b.roleView, edit: b.roleEdit } }));
  }

  // Reset everything back to role defaults.
  function resetAll() {
    const next: Record<string, Cell> = {};
    for (const m of MODULES) {
      const b = base[m.key];
      next[m.key] = { view: b?.roleView ?? false, edit: b?.roleEdit ?? false };
    }
    setSaved(false);
    setPerms(next);
  }

  // Apply a role's preset page set to the whole grid (the admin can then tweak
  // before saving). Mirrors the seeded role defaults via roleTemplate().
  function applyTemplate(role: Role) {
    const next: Record<string, Cell> = {};
    for (const t of roleTemplate(role)) next[t.module] = { view: t.view, edit: t.edit };
    setSaved(false);
    setPerms(next);
  }

  function isOverride(k: string): boolean {
    const c = perms[k] ?? { view: false, edit: false };
    const b = base[k] ?? { roleView: false, roleEdit: false };
    return c.view !== b.roleView || c.edit !== b.roleEdit;
  }

  function save() {
    setError(null);
    const desired: ModulePerm[] = MODULES.map((m) => ({
      module: m.key,
      view: perms[m.key]?.view ?? false,
      edit: perms[m.key]?.edit ?? false,
    }));
    startSave(async () => {
      const r = await setUserPermissions(userId, desired);
      if (r && "error" in r) { setError(r.error); return; }
      setSaved(true);
      router.refresh();
      onSaved?.();
    });
  }

  // Sidebar layout + search filter (match label or group).
  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return NAV_ROW_GROUPS;
    return NAV_ROW_GROUPS.map((g) => ({ ...g, rows: g.rows.filter((r) => `${r.label} ${g.group}`.toLowerCase().includes(query)) })).filter((g) => g.rows.length);
  }, [q]);
  // Halaga ng isang hilera = lahat ng module nito.
  const rowCell = (r: Row): Cell => ({ view: r.keys.every((k) => perms[k]?.view), edit: r.keys.every((k) => perms[k]?.edit) });
  const rowOverride = (r: Row) => r.keys.some(isOverride);
  const toggleRow = (r: Row, action: "view" | "edit", checked: boolean) => {
    setSaved(false);
    setPerms((prev) => { const next = { ...prev }; for (const k of r.keys) next[k] = normalize(prev[k] ?? { view: false, edit: false }, action, checked); return next; });
  };
  const resetRow = (r: Row) => r.keys.forEach(resetModule);

  const overrideCount = MODULES.filter((m) => isOverride(m.key)).length;

  if (loading) return <p className="py-8 text-center text-sm text-muted">Loading permissions…</p>;

  return (
    <div className="space-y-3">
      {/* Templates: one click loads a role's default page set into the grid. */}
      <div className="rounded-xl border border-[#e7dcc4] bg-[#faf8f3] p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-[#4a3b1a]">Apply preset:</span>
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => applyTemplate(r)}
              className={
                "rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-colors " +
                (r === userRole
                  ? "bg-[#4a3b1a] text-[#f4ead8] ring-[#4a3b1a] hover:opacity-90"
                  : "bg-surface text-[#4a3b1a] ring-border hover:bg-stone-100")
              }
              title={`Load the default pages for ${ROLE_LABEL[r]}`}
            >
              {ROLE_LABEL[r]}{r === userRole ? " (current role)" : ""}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-muted">Loads that role&apos;s default pages into the grid below — tweak then Save. Doesn&apos;t change the user&apos;s role.</p>
      </div>

      {/* Toolbar: search + global reset */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search page…"
            className="w-full rounded-lg border border-border bg-stone-50 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary focus:bg-surface"
          />
        </div>
        <button
          type="button"
          onClick={resetAll}
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-muted ring-1 ring-inset ring-border hover:bg-stone-100 hover:text-foreground"
        >
          ↺ Reset to role default
        </button>
      </div>

      {/* One table, group-banded, sticky header. */}
      <div className="max-h-[46vh] overflow-auto rounded-xl border border-border pf-scroll">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th className="px-3 py-2 text-left font-semibold">Page</th>
              <th className="w-20 px-2 py-2 text-center font-semibold">View</th>
              <th className="w-20 px-2 py-2 text-center font-semibold">Edit</th>
              <th className="w-10 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-muted">No module matches “{q}”.</td></tr>
            )}
            {groups.map(({ group, rows }) => {
              const keys = [...new Set(rows.flatMap((r) => r.keys))];
              const allView = keys.every((k) => perms[k]?.view);
              const allEdit = keys.every((k) => perms[k]?.edit);
              return (
                <GroupRows
                  key={group}
                  group={group}
                  rows={rows}
                  cellOf={rowCell}
                  allView={allView}
                  allEdit={allEdit}
                  onGroupView={(checked) => setMany(keys, { view: checked, edit: checked ? allEdit : false })}
                  onGroupEdit={(checked) => setMany(keys, { view: checked || allView ? true : allView, edit: checked })}
                  onToggle={toggleRow}
                  isOverride={rowOverride}
                  onReset={resetRow}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer: status + Save (dating nasa Modal footer — dala na ng panel para
          pareho ang inline at dialog na gamit). */}
      <div className="flex items-center justify-between gap-3">
        {error ? (
          <span className="text-sm text-danger">{error}</span>
        ) : (
          <span className="text-xs text-muted">
            {saved
              ? "Saved."
              : overrideCount > 0
                ? `${overrideCount} override${overrideCount === 1 ? "" : "s"} vs role default · Edit auto-enables View`
                : "Matches role default · Edit auto-enables View"}
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save permissions"}
        </button>
      </div>
    </div>
  );
}

// Button + Modal wrapper — ang dating anyo, para sa /users at sa mga lugar na
// mas bagay ang popup. Ang laman ay ang parehong PermissionsPanel.
export function PermissionsDialog({
  userId,
  userName,
  userRole,
}: {
  userId: string;
  userName: string;
  userRole: Role;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg px-3 py-1 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100"
      >
        Permissions
      </button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={`Permissions — ${userName}`}
          description="Check what this user can See (View) or Change (Edit) per module. Boxes start at the role default — tick or untick to override just this user."
          size="lg"
        >
          <PermissionsPanel userId={userId} userRole={userRole} onSaved={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}

function GroupRows({
  group, rows, cellOf, allView, allEdit, onGroupView, onGroupEdit, onToggle, isOverride, onReset,
}: {
  group: string;
  rows: Row[];
  cellOf: (r: Row) => Cell;
  allView: boolean;
  allEdit: boolean;
  onGroupView: (checked: boolean) => void;
  onGroupEdit: (checked: boolean) => void;
  onToggle: (r: Row, a: "view" | "edit", checked: boolean) => void;
  isOverride: (r: Row) => boolean;
  onReset: (r: Row) => void;
}) {
  const mods = rows;
  return (
    <>
      {/* Group band. Bulk toggles only when the group has 2+ modules — a single
          module would just duplicate its own row, which reads as clutter. */}
      <tr className="border-y border-border bg-stone-100/80">
        <td className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#4a3b1a]">{group}</td>
        {mods.length > 1 ? (
          <>
            <td className="px-2 py-1.5 text-center">
              <input type="checkbox" checked={allView} onChange={(e) => onGroupView(e.target.checked)} className="h-4 w-4 accent-primary" title="Toggle View for all in this group" />
            </td>
            <td className="px-2 py-1.5 text-center">
              <input type="checkbox" checked={allEdit} onChange={(e) => onGroupEdit(e.target.checked)} className="h-4 w-4 accent-primary" title="Toggle Edit for all in this group" />
            </td>
            <td></td>
          </>
        ) : (
          <td colSpan={3}></td>
        )}
      </tr>
      {mods.map((m) => {
        const p = cellOf(m);
        const over = isOverride(m);
        return (
          <tr key={m.id} className="border-b border-border last:border-0 hover:bg-stone-50">
            <td className="px-3 py-2">
              <span className="flex items-center gap-2.5">
                <NavIcon name={m.icon} className="h-4 w-4 shrink-0 text-muted" />
                {m.label}
                {over && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700" title="Overrides the role default">override</span>
                )}
              </span>
            </td>
            <td className="px-2 py-2 text-center">
              <input type="checkbox" checked={p.view} onChange={(e) => onToggle(m, "view", e.target.checked)} className="h-4 w-4 accent-primary" />
            </td>
            <td className="px-2 py-2 text-center">
              <input type="checkbox" checked={p.edit} onChange={(e) => onToggle(m, "edit", e.target.checked)} className="h-4 w-4 accent-primary" />
            </td>
            <td className="px-2 py-2 text-center">
              {over && (
                <button onClick={() => onReset(m)} className="text-muted hover:text-foreground" title="Reset to role default">↺</button>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
