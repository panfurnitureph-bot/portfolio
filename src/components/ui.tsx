import { ReactNode, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowDownRight, ArrowUpRight, ChevronDown, Minus } from 'lucide-react'

export function DemoShell({ name, kicker, tabs, tab, onTab, children, stamp }: {
  name: string; kicker: string; tabs: string[]; tab: string; onTab: (t: string) => void; children: ReactNode; stamp?: string
}) {
  return (
    <div className="dash">
      <header className="dash-top">
        <div className="container dash-top-inner">
          <Link to="/#work" className="back"><ArrowLeft size={15} /> Back to portfolio</Link>
          <div className="title"><b>{name}</b><span>· {kicker}</span></div>
          <div className="right">
            <span className="live"><span className="dot" /> Live demo</span>
            {stamp && <span className="live" style={{ color: 'var(--dash-muted)' }}>{stamp}</span>}
          </div>
        </div>
        <div className="container">
          <nav className="dash-tabs" aria-label="Sections">
            {tabs.map((t) => <button key={t} className={t === tab ? 'active' : ''} onClick={() => onTab(t)}>{t}</button>)}
          </nav>
        </div>
      </header>
      <main className="container dash-main">{children}</main>
    </div>
  )
}

export function Intro({ title, children, controls }: { title: string; children: ReactNode; controls?: ReactNode }) {
  return (
    <div className="dash-intro">
      <h1>{title}</h1>
      <p>{children}</p>
      {controls && <div className="row">{controls}</div>}
    </div>
  )
}

export function Kpi({ label, value, delta, tone = 'muted', hint }: { label: string; value: string; delta?: string; tone?: 'good' | 'bad' | 'warn' | 'muted'; hint?: string }) {
  const Icon = tone === 'good' ? ArrowUpRight : tone === 'bad' ? ArrowDownRight : Minus
  return (
    <div className="kpi" title={hint}>
      <small>{label}</small>
      <strong>{value}</strong>
      {delta && <span className={`delta ${tone}`}><Icon size={13} />{delta}</span>}
    </div>
  )
}

export function Panel({ title, sub, children, ctl, span }: { title: string; sub?: string; children: ReactNode; ctl?: ReactNode; span?: boolean }) {
  return (
    <section className="panel" style={span ? { gridColumn: '1 / -1' } : undefined}>
      <div className="panel-head">
        <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
        {ctl && <div className="ctl">{ctl}</div>}
      </div>
      {children}
    </section>
  )
}

export function Seg<T extends string>({ options, value, onChange }: { options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => <button key={o} className={o === value ? 'active' : ''} onClick={() => onChange(o)}>{o}</button>)}
    </div>
  )
}

export function Pill({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'info' | 'muted'; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>
}

export type Col<T> = { key: keyof T & string; label: string; num?: boolean; render?: (row: T) => ReactNode }

export function DataTable<T extends Record<string, unknown>>({ rows, cols, initialSort, limit }: { rows: T[]; cols: Col<T>[]; initialSort?: { key: keyof T & string; dir: 'asc' | 'desc' }; limit?: number }) {
  const [sort, setSort] = useState(initialSort)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const s = [...rows].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      if (typeof av === 'number' && typeof bv === 'number') return av - bv
      return String(av).localeCompare(String(bv))
    })
    return sort.dir === 'desc' ? s.reverse() : s
  }, [rows, sort])
  const shown = limit ? sorted.slice(0, limit) : sorted
  return (
    <div className="table-wrap">
      <table className="dt">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={(c.num ? 'num ' : '') + (sort?.key === c.key ? 'sorted' : '')}
                onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.num ? 'desc' : 'asc' }))}>
                {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : String(r[c.key] ?? '')}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Built({ cols }: { cols: { h: string; items: string[] }[] }) {
  return (
    <details className="built">
      <summary><ChevronDown size={16} /> How this is built</summary>
      <div className="cols">
        {cols.map((c) => (
          <div key={c.h}><h4>{c.h}</h4><ul>{c.items.map((i) => <li key={i}>{i}</li>)}</ul></div>
        ))}
      </div>
    </details>
  )
}

export function Alerts({ items }: { items: { sev: 'bad' | 'warn' | 'info'; title: string; body: string; action: string }[] }) {
  return (
    <div className="alerts">
      {items.map((a) => (
        <div className="alert" key={a.title}>
          <span className={`sev ${a.sev}`} />
          <div><b>{a.title}</b><span>{a.body}</span></div>
          <span className="act">{a.action}</span>
        </div>
      ))}
    </div>
  )
}

/* deterministic pseudo-random so demo data is stable between renders */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
