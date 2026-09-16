/* In-memory demo database: a map of tables (arrays of rows) with auto-increment ids,
   localStorage persistence, and a change bus the UI uses to refresh (mirrors Supabase Realtime). */
export type Row = Record<string, unknown>

type Table = { rows: Row[]; seq: number; insert: (r: Row) => Row }
type Listener = (table: string) => void

export class DemoDb {
  constructor(private KEY = 'pan-demo-db-v1') {}
  tables = new Map<string, Table>()
  private listeners = new Set<Listener>()
  private seedVersion = ''
  private dirty = false

  /* view name → base table (e.g. a `_latest` de-dup view reads the table it wraps) */
  private aliases = new Map<string, string>()
  alias(view: string, table: string) { this.aliases.set(view, table) }
  table(name: string): Table {
    name = this.aliases.get(name) ?? name
    let t = this.tables.get(name)
    if (!t) {
      const self = this
      t = {
        rows: [], seq: 1,
        insert(r: Row) {
          const row: Row = { ...r }
          if (row.id == null) row.id = t!.seq++
          else if (typeof row.id === 'number' && row.id >= t!.seq) t!.seq = row.id + 1
          if (row.created_at === undefined && self.hasCreatedAt(name)) row.created_at = new Date().toISOString()
          t!.rows.push(row)
          return row
        },
      }
      this.tables.set(name, t)
    }
    return t
  }
  private createdAtTables = new Set<string>()
  markCreatedAt(...names: string[]) { for (const n of names) this.createdAtTables.add(n) }
  hasCreatedAt(name: string) { return this.createdAtTables.has(name) }

  seed(version: string, fn: (db: DemoDb) => void) {
    this.seedVersion = version
    if (this.load(version)) return
    this.tables.clear()
    fn(this)
    this.save()
  }
  reset(fn: (db: DemoDb) => void) { this.tables.clear(); fn(this); this.save(); this.emit('*') }

  /* Writes notify the UI on the next microtask; persistence is coalesced onto an idle timer so a burst of
     cell edits serialises the database once, not once per keystroke. */
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private persistOk = true
  commit(table: string) { this.dirty = true; queueMicrotask(() => { if (this.dirty) { this.dirty = false; this.emit(table); this.scheduleSave() } }) }
  private scheduleSave() {
    if (!this.persistOk) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save() }, 500)
  }
  /* Flush a pending save when the tab is being hidden or closed. */
  flush() { if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; this.save() } }
  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  private emit(table: string) { for (const l of this.listeners) l(table) }

  private save() {
    if (!this.persistOk) return
    try {
      const obj: Record<string, { rows: Row[]; seq: number }> = {}
      for (const [k, t] of this.tables) obj[k] = { rows: t.rows, seq: t.seq }
      const json = JSON.stringify({ v: this.seedVersion, t: obj, created: [...this.createdAtTables] })
      /* localStorage holds ~5 MB per origin; a database past that would throw on every save, so stop trying
         (it stays in memory for the session and reseeds on the next visit). */
      if (json.length > 4_500_000) { this.persistOk = false; return }
      localStorage.setItem(this.KEY, json)
    } catch { this.persistOk = false /* quota / private mode — keep in memory */ }
  }
  private load(version: string): boolean {
    try {
      const raw = localStorage.getItem(this.KEY); if (!raw) return false
      const p = JSON.parse(raw) as { v: string; t: Record<string, { rows: Row[]; seq: number }>; created?: string[] }
      if (p.v !== version) return false
      this.tables.clear()
      for (const [k, v] of Object.entries(p.t)) { const t = this.table(k); t.rows = v.rows; t.seq = v.seq }
      for (const c of p.created ?? []) this.createdAtTables.add(c)
      return true
    } catch { return false }
  }
}

export const db = new DemoDb()

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => db.flush())
