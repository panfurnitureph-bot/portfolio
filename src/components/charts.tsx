import { useId, useState } from 'react'

/* ---------- helpers ---------- */
export const fmt = {
  int: (n: number) => Math.round(n).toLocaleString('en-US'),
  usd: (n: number, d = 0) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }),
  php: (n: number, d = 0) => '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: d, maximumFractionDigits: d }),
  pct: (n: number, d = 1) => n.toFixed(d) + '%',
  k: (n: number) => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k' : String(Math.round(n))),
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) max = min + 1
  const span = max - min
  const rough = span / count
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const steps = [1, 2, 2.5, 5, 10]
  const step = steps.map((s) => s * pow).find((s) => span / s <= count) ?? pow * 10
  const start = Math.floor(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Number(v.toFixed(6)))
  return out
}

/* ---------- Line / Area chart ---------- */
export type Series = { name: string; values: (number | null)[]; color: string; dashed?: boolean; area?: boolean }

export function LineChart({
  labels, series, height = 220, yFormat = fmt.k, divider, yMin, yMax, showDots = false, w = 640,
}: {
  labels: string[]; series: Series[]; height?: number; yFormat?: (n: number) => string
  divider?: number; yMin?: number; yMax?: number; showDots?: boolean; w?: number
}) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const h = height, pad = { l: 44, r: 14, t: 12, b: 28 }
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null))
  const lo = yMin ?? Math.min(0, ...all)
  const hi = yMax ?? Math.max(...all) * 1.08
  const ticks = niceTicks(lo, hi)
  const y0 = ticks[0], y1 = ticks[ticks.length - 1]
  const x = (i: number) => pad.l + (i / Math.max(1, labels.length - 1)) * (w - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b)
  const path = (vals: (number | null)[]) => {
    let d = ''
    vals.forEach((v, i) => { if (v == null) return; d += (d === '' || vals[i - 1] == null ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' ' })
    return d
  }
  const area = (vals: (number | null)[]) => {
    const idx = vals.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0)
    if (!idx.length) return ''
    return path(vals) + `L${x(idx[idx.length - 1]).toFixed(1)} ${y(y0).toFixed(1)} L${x(idx[0]).toFixed(1)} ${y(y0).toFixed(1)} Z`
  }
  const step = Math.ceil(labels.length / 8)
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
        const px = ((e.clientX - r.left) / r.width) * w
        const i = Math.round(((px - pad.l) / (w - pad.l - pad.r)) * (labels.length - 1))
        setHover(Math.max(0, Math.min(labels.length - 1, i)))
      }}>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={i} id={`${id}-g${i}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={s.color} stopOpacity="0.35" />
            <stop offset="1" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      <g className="grid">{ticks.map((t) => <line key={t} x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} />)}</g>
      <g>{ticks.map((t) => <text key={t} x={pad.l - 6} y={y(t) + 3} textAnchor="end">{yFormat(t)}</text>)}</g>
      <g>{labels.map((l, i) => (i % step === 0 ? <text key={i} x={x(i)} y={h - 8} textAnchor="middle">{l}</text> : null))}</g>
      {divider != null && (
        <g>
          <line x1={x(divider)} x2={x(divider)} y1={pad.t} y2={h - pad.b} stroke="#ffffff55" strokeDasharray="3 3" />
          <text x={x(divider) + 4} y={pad.t + 9} style={{ fill: '#a1a1aa' }}>today</text>
        </g>
      )}
      {series.map((s, i) => (
        <g key={i}>
          {s.area && <path d={area(s.values)} fill={`url(#${id}-g${i})`} />}
          <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
          {showDots && s.values.map((v, j) => (v == null ? null : <circle key={j} cx={x(j)} cy={y(v)} r={2.5} fill={s.color} />))}
        </g>
      ))}
      {hover != null && (
        <g>
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={h - pad.b} stroke="#ffffff33" />
          {series.map((s, i) => (s.values[hover] == null ? null : <circle key={i} cx={x(hover)} cy={y(s.values[hover] as number)} r={4} fill={s.color} stroke="#0f0f11" strokeWidth={2} />))}
          <Tooltip x={x(hover)} y={pad.t} w={w} lines={[labels[hover], ...series.filter((s) => s.values[hover] != null).map((s) => `${s.name}: ${yFormat(s.values[hover] as number)}`)]} />
        </g>
      )}
    </svg>
  )
}

function Tooltip({ x, y, w, lines }: { x: number; y: number; w: number; lines: string[] }) {
  const bw = Math.max(...lines.map((l) => l.length)) * 5.6 + 16
  const bh = lines.length * 14 + 10
  const left = x + 10 + bw > w ? x - bw - 10 : x + 10
  return (
    <g>
      <rect x={left} y={y} width={bw} height={bh} rx={6} fill="#18181b" stroke="#ffffff29" />
      {lines.map((l, i) => <text key={i} x={left + 8} y={y + 16 + i * 14} style={{ fill: i === 0 ? '#fafafa' : '#a1a1aa', fontWeight: i === 0 ? 600 : 400 }}>{l}</text>)}
    </g>
  )
}

/* ---------- Bar chart (grouped or stacked) ---------- */
export function BarChart({
  labels, series, height = 220, stacked = false, yFormat = fmt.k, target, w = 640,
}: { labels: string[]; series: { name: string; values: number[]; color: string }[]; height?: number; stacked?: boolean; yFormat?: (n: number) => string; target?: number[] | number; w?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const h = height, pad = { l: 44, r: 14, t: 12, b: 28 }
  const maxV = stacked
    ? Math.max(...labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0)))
    : Math.max(...series.flatMap((s) => s.values), ...(Array.isArray(target) ? target : target != null ? [target] : []))
  const ticks = niceTicks(0, maxV * 1.08)
  const y1 = ticks[ticks.length - 1]
  const y = (v: number) => pad.t + (1 - v / y1) * (h - pad.t - pad.b)
  const bw = (w - pad.l - pad.r) / labels.length
  const inner = bw * 0.7
  const gw = stacked ? inner : inner / series.length
  const step = Math.ceil(labels.length / 10)
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} onMouseLeave={() => setHover(null)}>
      <g className="grid">{ticks.map((t) => <line key={t} x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} />)}</g>
      <g>{ticks.map((t) => <text key={t} x={pad.l - 6} y={y(t) + 3} textAnchor="end">{yFormat(t)}</text>)}</g>
      {labels.map((l, i) => {
        const x0 = pad.l + i * bw + (bw - inner) / 2
        let acc = 0
        return (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={pad.l + i * bw} y={pad.t} width={bw} height={h - pad.t - pad.b} fill={hover === i ? '#ffffff08' : 'transparent'} />
            {series.map((s, j) => {
              const v = s.values[i] ?? 0
              if (stacked) { const yTop = y(acc + v), yBot = y(acc); acc += v; return <rect key={j} x={x0} y={yTop} width={gw} height={Math.max(0, yBot - yTop)} fill={s.color} rx={2} /> }
              return <rect key={j} x={x0 + j * gw} y={y(v)} width={gw - 2} height={Math.max(0, y(0) - y(v))} fill={s.color} rx={2} />
            })}
            {target != null && (() => { const t = Array.isArray(target) ? target[i] : target; return t == null ? null : <line x1={x0 - 3} x2={x0 + inner + 3} y1={y(t)} y2={y(t)} stroke="#fafafa" strokeWidth={2} /> })()}
            {i % step === 0 && <text x={pad.l + i * bw + bw / 2} y={h - 8} textAnchor="middle">{l}</text>}
          </g>
        )
      })}
      {hover != null && (
        <Tooltip x={pad.l + hover * bw + bw / 2} y={pad.t} w={w}
          lines={[labels[hover], ...series.map((s) => `${s.name}: ${yFormat(s.values[hover] ?? 0)}`), ...(target != null ? [`Target: ${yFormat(Array.isArray(target) ? target[hover] : target)}`] : [])]} />
      )}
    </svg>
  )
}

/* ---------- Horizontal bars ---------- */
export function HBars({ rows, max, format = fmt.int, notch, colorFor }: {
  rows: { label: string; value: number; color?: string }[]; max?: number; format?: (n: number) => string; notch?: number; colorFor?: (r: { label: string; value: number }) => string
}) {
  const m = max ?? Math.max(...rows.map((r) => r.value)) * 1.05
  return (
    <div className="hbar-list">
      {rows.map((r) => (
        <div className="hbar" key={r.label}>
          <span className="lbl" title={r.label}>{r.label}</span>
          <span className="track">
            <span className="fill" style={{ width: `${Math.min(100, (r.value / m) * 100)}%`, background: r.color ?? colorFor?.(r) ?? 'var(--accent)' }} />
            {notch != null && <span className="notch" style={{ left: `${(notch / m) * 100}%` }} />}
          </span>
          <span className="val">{format(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------- Funnel ---------- */
export function Funnel({ stages, format = fmt.int }: { stages: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = stages[0]?.value || 1
  return (
    <div className="funnel">
      {stages.map((s, i) => {
        const prev = i === 0 ? null : stages[i - 1].value
        const carry = prev ? (s.value / prev) * 100 : null
        return (
          <div className="funnel-row" key={s.label}>
            <span style={{ color: 'var(--dash-body)' }}>{s.label}</span>
            <div><div className="bar" style={{ width: `${Math.max(8, (s.value / max) * 100)}%`, opacity: 1 - i * 0.08 }}>{format(s.value)}</div></div>
            <span className="carry">{carry == null ? '100%' : `${carry.toFixed(0)}% ↓`}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- Donut ---------- */
export function Donut({ parts, size = 160, center, sub }: { parts: { label: string; value: number; color: string }[]; size?: number; center: string; sub?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1
  const r = 44, c = 2 * Math.PI * r
  let off = 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox="0 0 120 120" style={{ flex: 'none' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="#ffffff10" strokeWidth="14" />
        {parts.map((p, i) => {
          const len = (p.value / total) * c
          const el = <circle key={i} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="14" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" />
          off += len
          return el
        })}
        <text x="60" y="58" textAnchor="middle" style={{ fill: '#fafafa', fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{center}</text>
        {sub && <text x="60" y="74" textAnchor="middle" style={{ fill: '#a1a1aa', fontSize: 9 }}>{sub}</text>}
      </svg>
      <div className="legend" style={{ flexDirection: 'column', gap: '0.45rem' }}>
        {parts.map((p) => (
          <span key={p.label}><i style={{ background: p.color }} />{p.label} <b style={{ color: 'var(--dash-text)', marginLeft: 'auto', fontWeight: 600 }}>{((p.value / total) * 100).toFixed(0)}%</b></span>
        ))}
      </div>
    </div>
  )
}

/* ---------- Sparkline ---------- */
export function Spark({ values, color = 'var(--accent)', w = 90, h = 28 }: { values: number[]; color?: string; w?: number; h?: number }) {
  const lo = Math.min(...values), hi = Math.max(...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - lo) / (hi - lo || 1)) * (h - 4) - 2}`).join(' ')
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}><polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" /></svg>
}

/* ---------- Heat strip (hour x day) ---------- */
export function Heat({ rows, cols, data, color = '238, 90, 43' }: { rows: string[]; cols: string[]; data: number[][]; color?: string }) {
  const max = Math.max(...data.flat())
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `3rem repeat(${cols.length}, minmax(14px, 1fr))`, gap: 3, minWidth: 420 }}>
        <span />
        {cols.map((c, i) => <span key={c} style={{ fontSize: 9, color: 'var(--dash-muted)', textAlign: 'center' }}>{i % 3 === 0 ? c : ''}</span>)}
        {rows.map((r, ri) => (
          <RowFrag key={r} label={r} cells={data[ri]} max={max} color={color} />
        ))}
      </div>
    </div>
  )
}
function RowFrag({ label, cells, max, color }: { label: string; cells: number[]; max: number; color: string }) {
  return (
    <>
      <span style={{ fontSize: 10, color: 'var(--dash-muted)', alignSelf: 'center' }}>{label}</span>
      {cells.map((v, i) => <span key={i} title={`${label} ${i}:00 — ${v}`} style={{ height: 16, borderRadius: 3, background: `rgba(${color}, ${0.08 + (v / max) * 0.92})` }} />)}
    </>
  )
}
