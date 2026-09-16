/* In-browser stand-in for the Supabase JS client, just enough PostgREST semantics for the
   Pan-Furnitures server code (data loaders + server actions) to run unchanged against the
   in-memory demo database. Supports: from().select/insert/update/upsert/delete, eq/neq/in/is/
   gt/gte/lt/lte/like/ilike/not/or/match/contains, order/limit/range, single/maybeSingle,
   { count } options, and rpc() dispatched to registered functions. */
import { db as defaultDb, type DemoDb, type Row } from './store'

type Filter = (r: Row) => boolean
type Order = { col: string; asc: boolean; nullsFirst?: boolean }
type Result<T> = { data: T; error: null | { message: string; code?: string }; count?: number | null; status?: number }

const toKey = (v: unknown) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v))
const cmp = (a: unknown, b: unknown) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0)
const likeRe = (pat: string, ci: boolean) => new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', ci ? 'is' : 's')
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : v)

function opFilter(col: string, op: string, raw: unknown, negate = false): Filter {
  const val = raw
  const f: Filter = (r) => {
    const v = r[col]
    switch (op) {
      case 'eq': return toKey(v) === toKey(val) || num(v) === num(val)
      case 'neq': return !(toKey(v) === toKey(val) || num(v) === num(val))
      case 'is': return val === null ? v == null : val === true ? v === true : val === false ? v === false : v == null
      case 'in': return (val as unknown[]).some((x) => toKey(x) === toKey(v) || num(x) === num(v))
      case 'gt': return v != null && (num(v) as number) > (num(val) as number)
      case 'gte': return v != null && (num(v) as number) >= (num(val) as number)
      case 'lt': return v != null && (num(v) as number) < (num(val) as number)
      case 'lte': return v != null && (num(v) as number) <= (num(val) as number)
      case 'like': return typeof v === 'string' && likeRe(String(val), false).test(v)
      case 'ilike': return typeof v === 'string' && likeRe(String(val), true).test(v)
      case 'cs': case 'contains': return Array.isArray(v) ? (val as unknown[]).every((x) => (v as unknown[]).includes(x)) : typeof v === 'object' && v != null ? Object.entries(val as Row).every(([k, x]) => (v as Row)[k] === x) : false
      default: return true
    }
  }
  return negate ? (r) => !f(r) : f
}

/* PostgREST logical filter string: "a.eq.1,b.ilike.%x%,c.not.is.null" */
function parseOr(expr: string): Filter {
  const parts: string[] = []
  let depth = 0, cur = ''
  for (const ch of expr) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch }
  if (cur) parts.push(cur)
  const fs = parts.map((p) => {
    p = p.trim()
    const andM = /^and\((.*)\)$/.exec(p); if (andM) { const inner = parseAnd(andM[1]); return inner }
    const m = /^([a-zA-Z0-9_]+)\.(not\.)?([a-z]+)\.(.*)$/s.exec(p)
    if (!m) return () => true
    const [, col, notP, op, v] = m
    return opFilter(col, op, parseVal(op, v), !!notP)
  })
  return (r) => fs.some((f) => f(r))
}
function parseAnd(expr: string): Filter {
  const fs = expr.split(',').map((p) => { const m = /^([a-zA-Z0-9_]+)\.(not\.)?([a-z]+)\.(.*)$/s.exec(p.trim()); if (!m) return () => true; const [, col, notP, op, v] = m; return opFilter(col, op, parseVal(op, v), !!notP) })
  return (r) => fs.every((f) => f(r))
}
function parseVal(op: string, v: string): unknown {
  if (op === 'is') return v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : null
  if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').map((x) => x.trim().replace(/^"|"$/g, ''))
  return v
}

class Query<T = Row> implements PromiseLike<Result<T>> {
  private filters: Filter[] = []
  private orders: Order[] = []
  private lim: number | null = null
  private from = 0
  private to: number | null = null
  private cols: string | null = null
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private payload: Row | Row[] | null = null
  private singleMode: 'single' | 'maybe' | null = null
  private wantCount: boolean = false
  private headOnly = false
  private onConflict: string | null = null
  private returning = false

  constructor(private table: string, private store: DemoDb = defaultDb) {}

  select(cols = '*', opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    if (this.mode !== 'select') { this.returning = true; this.cols = cols } else this.cols = cols
    if (opts?.count) this.wantCount = true
    if (opts?.head) this.headOnly = true
    return this
  }
  insert(v: Row | Row[]) { this.mode = 'insert'; this.payload = v; return this }
  private ignoreDup = false
  upsert(v: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.mode = 'upsert'; this.payload = v; this.onConflict = opts?.onConflict ?? 'id'; this.ignoreDup = !!opts?.ignoreDuplicates; return this }
  update(v: Row) { this.mode = 'update'; this.payload = v; return this }
  delete() { this.mode = 'delete'; return this }

  eq(c: string, v: unknown) { this.filters.push(opFilter(c, 'eq', v)); return this }
  neq(c: string, v: unknown) { this.filters.push(opFilter(c, 'neq', v)); return this }
  is(c: string, v: unknown) { this.filters.push(opFilter(c, 'is', v)); return this }
  in(c: string, v: unknown[]) { this.filters.push(opFilter(c, 'in', v)); return this }
  gt(c: string, v: unknown) { this.filters.push(opFilter(c, 'gt', v)); return this }
  gte(c: string, v: unknown) { this.filters.push(opFilter(c, 'gte', v)); return this }
  lt(c: string, v: unknown) { this.filters.push(opFilter(c, 'lt', v)); return this }
  lte(c: string, v: unknown) { this.filters.push(opFilter(c, 'lte', v)); return this }
  like(c: string, v: string) { this.filters.push(opFilter(c, 'like', v)); return this }
  ilike(c: string, v: string) { this.filters.push(opFilter(c, 'ilike', v)); return this }
  contains(c: string, v: unknown) { this.filters.push(opFilter(c, 'contains', v)); return this }
  not(c: string, op: string, v: unknown) { this.filters.push(opFilter(c, op, op === 'in' && typeof v === 'string' ? parseVal('in', v) : v, true)); return this }
  or(expr: string) { this.filters.push(parseOr(expr)); return this }
  match(obj: Row) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this }
  filter(c: string, op: string, v: unknown) { this.filters.push(opFilter(c, op.replace(/^not\./, ''), v, op.startsWith('not.'))); return this }
  order(c: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) { this.orders.push({ col: c, asc: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst }); return this }
  limit(n: number) { this.lim = n; return this }
  range(a: number, b: number) { this.from = a; this.to = b; return this }
  maybeSingle() { this.singleMode = 'maybe'; return this }
  single() { this.singleMode = 'single'; return this }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  returns<U>() { return this as unknown as Query<U> }
  csv() { return this }
  abortSignal() { return this }
  throwOnError() { return this }

  private apply(rows: Row[]) {
    let out = rows.filter((r) => this.filters.every((f) => f(r)))
    for (const o of [...this.orders].reverse()) out = [...out].sort((a, b) => { const c = cmp(a[o.col], b[o.col]); return o.asc ? c : -c })
    return out
  }
  private embed(r: Row, rel: string, inner: string): unknown {
    /* PostgREST-style embed: `permissions(module, action)` → look up the row of table `permissions`
       through this row's `permission_id` (singular FK), or `permissions_id`; null when absent. */
    const fk = [rel.replace(/ies$/, 'y').replace(/s$/, '') + '_id', rel + '_id'].find((k) => k in r)
    if (!fk) return null
    const t = this.store.tables.get(rel)
    const hit = t?.rows.find((x) => toKey(x.id) === toKey(r[fk]))
    if (!hit) return null
    const cols = inner.split(',').map((s) => s.trim()).filter(Boolean)
    if (!cols.length || cols.includes('*')) return { ...hit }
    const o: Row = {}; for (const c of cols) o[c] = hit[c]; return o
  }
  private project(rows: Row[]): Row[] {
    if (!this.cols || this.cols.trim() === '*') return rows.map((r) => ({ ...r }))
    const src = this.cols
    const names: string[] = []; let depth = 0, cur = ''
    for (const ch of src) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { names.push(cur.trim()); cur = '' } else cur += ch }
    if (cur.trim()) names.push(cur.trim())
    if (names.some((n) => n === '*')) return rows.map((r) => ({ ...r }))
    return rows.map((r) => {
      const o: Row = {}
      for (const n of names) {
        const m = /^(?:(\w+):)?(\w+)\((.*)\)$/s.exec(n)
        if (m) { o[m[1] ?? m[2]] = this.embed(r, m[2], m[3]); continue }
        const [alias, col] = n.includes(':') ? n.split(':') : [n, n]
        o[alias.trim()] = r[col.trim()]
      }
      return o
    })
  }

  private run(): Result<unknown> {
    const table = this.store.table(this.table)
    try {
      if (this.mode === 'select') {
        let rows = this.apply(table.rows)
        const count = rows.length
        if (this.to != null) rows = rows.slice(this.from, this.to + 1)
        else if (this.lim != null) rows = rows.slice(0, this.lim)
        let data: unknown = this.headOnly ? null : this.project(rows)
        if (this.singleMode) {
          const arr = data as Row[] | null
          if (this.singleMode === 'single' && (!arr || arr.length !== 1)) return { data: null, error: { message: arr && arr.length > 1 ? 'Results contain more than one row' : 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, count }
          data = arr && arr.length ? arr[0] : null
        }
        return { data, error: null, count: this.wantCount ? count : null }
      }
      if (this.mode === 'insert' || this.mode === 'upsert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
        const written: Row[] = []
        for (const item of list) {
          if (this.mode === 'upsert') {
            const keys = (this.onConflict ?? 'id').split(',').map((s) => s.trim())
            const existing = table.rows.find((r) => keys.every((k) => toKey(r[k]) === toKey(item[k])))
            if (existing) { if (!this.ignoreDup) Object.assign(existing, item); written.push(existing); continue }
          }
          written.push(table.insert(item))
        }
        this.store.commit(this.table)
        const out = this.project(written); const data = this.returning ? (this.singleMode ? out[0] ?? null : out) : null
        return { data, error: null, status: 201 }
      }
      if (this.mode === 'update') {
        const targets = this.apply(table.rows)
        for (const r of targets) Object.assign(r, this.payload as Row)
        this.store.commit(this.table)
        const out = this.project(targets); const data = this.returning ? (this.singleMode ? out[0] ?? null : out) : null
        return { data, error: null }
      }
      if (this.mode === 'delete') {
        const targets = new Set(this.apply(table.rows))
        table.rows = table.rows.filter((r) => !targets.has(r))
        this.store.commit(this.table)
        return { data: this.returning ? [...targets] : null, error: null }
      }
      return { data: null, error: null }
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } }
    }
  }
  then<R1 = Result<T>, R2 = never>(onOk?: ((v: Result<T>) => R1 | PromiseLike<R1>) | null, onErr?: ((e: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    return new Promise<Result<T>>((res) => setTimeout(() => res(this.run() as Result<T>), 0)).then(onOk, onErr)
  }
}

export type RpcFn = (args: Row) => unknown | Promise<unknown>
const rpcs = new Map<string, RpcFn>()
export function registerRpc(name: string, fn: RpcFn) { rpcs.set(name, fn) }

function demoUser(store: DemoDb): { id: string; email: string; user_metadata: Row; app_metadata: Row } | null {
  let role: string | null = null
  try { role = localStorage.getItem('pan-demo-role') } catch { /* no storage */ }
  if (!role) return null
  const p = store.tables.get('profiles')?.rows.find((r) => r.id === 'demo-' + role || r.role === role)
  if (!p) return null
  return { id: String(p.id), email: String(p.email ?? ''), user_metadata: { full_name: p.full_name }, app_metadata: {} }
}

export function createFakeSupabase(store: DemoDb = defaultDb) {
  return {
    from<T = Row>(table: string) { return new Query<T>(table, store) },
    async rpc(name: string, args: Row = {}) {
      const fn = rpcs.get(name)
      if (!fn) return { data: null, error: { message: `rpc ${name} not implemented in demo` } }
      try { return { data: await fn(args), error: null } } catch (e) { return { data: null, error: { message: (e as Error).message } } }
    },
    auth: {
      /* the signed-in demo user is the profile row whose role matches localStorage `pan-demo-role` */
      async getUser() { return { data: { user: demoUser(store) }, error: null } },
      async getSession() { const user = demoUser(store); return { data: { session: user ? { user } : null }, error: null } },
      async setSession() { return { data: null, error: null } }, async signOut() { return { error: null } },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } },
    },
    storage: { from(bucket: string) { return {
      upload: async (path: string, _file?: unknown) => { void _file; return { data: { path, fullPath: bucket + '/' + path }, error: null } },
      uploadToSignedUrl: async (path: string) => ({ data: { path }, error: null }),
      createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: '#demo', token: 'demo', path }, error: null }),
      getPublicUrl: (path: string) => ({ data: { publicUrl: '/pan/' + path.split('/').pop() } }),
      remove: async (_paths: string[]) => { void _paths; return { data: [], error: null } },
      list: async (_dir?: string, _opts?: unknown) => { void _dir; void _opts; return { data: [] as { name: string; updated_at?: string; created_at?: string }[], error: null } },
      download: async (_path: string) => { void _path; return { data: null as Blob | null, error: { message: 'no storage in demo' } } },
    } } },
    channel() { const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} }; return ch },
    removeChannel() {},
  }
}
export type FakeSupabase = ReturnType<typeof createFakeSupabase>
