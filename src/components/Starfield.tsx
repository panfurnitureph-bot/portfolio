/* Hero background: drifting constellation of dots joined by faint lines, nudged away from the cursor.
   Canvas sized to its parent, capped at 1.5× DPR, ~33 fps, paused when the tab is hidden or motion is reduced. */
import { useEffect, useRef } from 'react'

const COARSE = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
const REDUCED = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const COUNT = COARSE ? 21 : 48
const LINE_A = 0.09, MOUSE_LINE_A = 0.12, ACCENT_A = 0.42, DOT_A = 0.24
const LINK = 150, LINK2 = LINK * LINK
const MOUSE = 200, MOUSE2 = MOUSE * MOUSE
const SPEED = 0.3, CELL = LINK, FRAME_MS = 30

type P = { x: number; y: number; vx: number; vy: number; radius: number; accent: boolean }

export function Starfield({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (REDUCED) return
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let w = 0, h = 0, mx = -9999, my = -9999, offX = 0, offY = 0, raf = 0, last = 0
    const pts: P[] = []
    let grid = new Map<number, number[]>()
    const key = (cx: number, cy: number) => cy * 1000 + cx

    const bucket = () => {
      grid = new Map()
      for (let i = 0; i < pts.length; i++) {
        const k = key((pts[i].x / CELL) | 0, (pts[i].y / CELL) | 0)
        const b = grid.get(k); b ? b.push(i) : grid.set(k, [i])
      }
    }
    const size = () => {
      const p = canvas.parentElement
      w = p ? p.clientWidth : window.innerWidth
      h = p ? p.clientHeight : window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr))
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
      canvas.width = cw; canvas.height = ch
      ctx.setTransform(cw / w, 0, 0, ch / h, 0, 0)
      const r = canvas.getBoundingClientRect()
      offX = r.left + window.scrollX; offY = r.top + window.scrollY
    }
    const seed = () => {
      pts.length = 0
      for (let i = 0; i < COUNT; i++) {
        const a = Math.random() * Math.PI * 2
        pts.push({ x: Math.random() * w, y: Math.random() * h, vx: Math.cos(a) * SPEED * (0.5 + Math.random()), vy: Math.sin(a) * SPEED * (0.5 + Math.random()), radius: Math.random() > 0.7 ? 2.5 : 1.5, accent: Math.random() > 0.75 })
      }
    }
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (document.hidden || t - last < FRAME_MS) return
      last = t
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore()
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy
        if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10
        if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10
        const dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy
        if (d2 < MOUSE2 && d2 > 0) { const d = Math.sqrt(d2), f = (1 - d / MOUSE) * 0.8; p.vx += (dx / d) * f; p.vy += (dy / d) * f }
        if (Math.sqrt(p.vx * p.vx + p.vy * p.vy) > SPEED * 3) { p.vx *= 0.98; p.vy *= 0.98 }
      }
      bucket()
      ctx.lineWidth = 1
      const cols = Math.ceil(w / CELL), rows = Math.ceil(h / CELL)
      for (let cy = 0; cy <= rows; cy++) for (let cx = 0; cx <= cols; cx++) {
        const here = grid.get(key(cx, cy)); if (!here) continue
        for (const nk of [key(cx, cy), key(cx + 1, cy), key(cx, cy + 1), key(cx - 1, cy + 1), key(cx + 1, cy + 1)]) {
          const there = grid.get(nk); if (!there) continue
          const same = nk === key(cx, cy)
          for (let i = 0; i < here.length; i++) {
            const a = pts[here[i]]
            for (let j = same ? i + 1 : 0; j < there.length; j++) {
              const b = pts[there[j]], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy
              if (d2 < LINK2) { ctx.strokeStyle = `rgba(161,161,170,${(1 - Math.sqrt(d2) / LINK) * LINE_A})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() }
            }
          }
        }
      }
      if (mx > -9000) for (const p of pts) {
        const dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy
        if (d2 < MOUSE2) { ctx.strokeStyle = `rgba(161,161,170,${(1 - Math.sqrt(d2) / MOUSE) * MOUSE_LINE_A})`; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(p.x, p.y); ctx.stroke() }
      }
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fillStyle = p.accent ? `rgba(45,212,191,${ACCENT_A})` : `rgba(161,161,170,${DOT_A})`; ctx.fill() }
    }

    size(); seed(); raf = requestAnimationFrame(draw)
    const onResize = () => { size(); for (const p of pts) { if (p.x > w) p.x = Math.random() * w; if (p.y > h) p.y = Math.random() * h } }
    const onMove = (e: MouseEvent) => { mx = e.pageX - offX; my = e.pageY - offY }
    const onLeave = () => { mx = -9999; my = -9999 }
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(draw) }
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) { ro = new ResizeObserver(onResize); ro.observe(canvas.parentElement) } else window.addEventListener('resize', onResize, { passive: true })
    window.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf); ro?.disconnect(); window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMove); document.removeEventListener('mouseleave', onLeave); document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return <canvas ref={ref} aria-hidden="true" className={className} style={{ willChange: 'transform' }} />
}
