/* "Under the hood · production workflows" — a coverflow rack of workflow canvases (ruixen.ui CoverflowCarousel).
   Centre card expands into a case-study lightbox (client, metrics, problem, what was built, tools). */
import { useCallback, useEffect, useRef, useState } from 'react'
import { CoverflowCarousel } from './ui/coverflow-carousel'
import { workflows, type Workflow } from '../content'

type Item = Workflow & { id: string }
const ITEMS: Item[] = workflows.map((w) => ({ ...w, id: w.slug }))

export function WorkflowGallery() {
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const [view, setView] = useState(0) // 0 = workflow diagram, 1.. = sample outputs
  const [sub, setSub] = useState(0) // within an output set: 0 = overview sheet, 1.. = individual shots
  const wrap = useRef<HTMLDivElement>(null)

  /* arrow keys move the stack while it is on screen; Esc closes the lightbox */
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    let onScreen = false
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting }, { threshold: 0.4 })
    io.observe(el)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(null); return }
      if (open != null) {
        if (e.key === 'ArrowLeft') setOpen((o) => (o! - 1 + ITEMS.length) % ITEMS.length)
        if (e.key === 'ArrowRight') setOpen((o) => (o! + 1) % ITEMS.length)
        return
      }
      if (!onScreen) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((a) => (a - 1 + ITEMS.length) % ITEMS.length) }
      if (e.key === 'ArrowRight') { e.preventDefault(); setActive((a) => (a + 1) % ITEMS.length) }
    }
    window.addEventListener('keydown', onKey)
    return () => { io.disconnect(); window.removeEventListener('keydown', onKey) }
  }, [open])

  useEffect(() => {
    if (open == null) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  /* cover: the n8n canvas fitted inside a square, like an album cover (the original demo's geometry) */
  const renderCard = useCallback((w: Item, { active: on }: { active: boolean; index: number }) => (
    <div className={'wf-cover' + (on ? ' on' : '')}>
      <img src={w.image} alt={`${w.title} workflow canvas`} draggable={false} loading="lazy" decoding="async" />
      <span className="wf-cover-cat">{w.category}</span>
      {on && <span className="wf-cover-hint">Click to expand ↗</span>}
    </div>
  ), [])
  const expand = useCallback((i: number) => { setOpen(i); setView(0); setSub(0) }, [])

  const cur = open != null ? ITEMS[open] : null
  const views = cur ? [{ label: 'Workflow', image: cur.image }, ...(cur.outputs ?? [])] : []
  const shown = views[Math.min(view, views.length - 1)]
  const set = shown && shown.images ? [shown.image, ...shown.images] : null
  const mainSrc = set ? set[Math.min(sub, set.length - 1)] : shown?.image

  return (
    <div className="wf" ref={wrap}>
      <p className="wf-eyebrow"><span>Under the hood · production workflows</span></p>
      <CoverflowCarousel
        slides={ITEMS}
        index={active}
        onChangeIndex={(i) => setActive(i)}
        onSlideClick={expand}
        cardWidth="clamp(170px, 24vw, 300px)"
        aspect={1}
        showNavigation
        label="Production workflows"
        renderSlide={renderCard}
      />
      {/* caption for the centre card — title, kind, and the numbers, as in the demo */}
      <div className="wf-caption" key={active}>
        <p className="wf-caption-title">{ITEMS[active].title}</p>
        <p className="wf-caption-sub">{ITEMS[active].category} · {ITEMS[active].client}</p>
        <dl className="wf-caption-meta">
          <div><dt>Steps</dt><dd>{ITEMS[active].steps.length}</dd></div>
          <div><dt>Tools</dt><dd>{ITEMS[active].tools.slice(0, 3).join(' · ')}</dd></div>
          {ITEMS[active].outputs?.length ? <div><dt>Sample outputs</dt><dd>{ITEMS[active].outputs!.length}</dd></div> : null}
        </dl>
        <button type="button" className="wf-caption-open" onClick={() => expand(active)}>Open case study ↗</button>
      </div>
      <div className="cf-dots" role="tablist" aria-label="Workflows">
        {ITEMS.map((w, i) => <button key={w.slug} type="button" role="tab" aria-selected={i === active} aria-label={w.title} onClick={() => setActive(i)} className={'cf-dot' + (i === active ? ' on' : '')} />)}
      </div>
      <p className="wf-hint">Drag · click a side card · arrow keys</p>
      <p className="sr-only" aria-live="polite">Workflow {active + 1} of {ITEMS.length}: {ITEMS[active].title}</p>

      {cur && (
        <div className="wf-lb" role="dialog" aria-modal="true" aria-label={cur.title} onClick={(e) => { if (e.target === e.currentTarget) setOpen(null) }}>
          <div className="wf-lb-win">
            <button type="button" className="wf-lb-close" onClick={() => setOpen(null)} aria-label="Close">×</button>
            <div className={'wf-lb-shot' + (view > 0 ? ' out' : '') + (set ? ' set' : '')}>
              <img src={mainSrc} alt={`${cur.title} — ${shown.label}`} />
              {views.length > 1 && (
                <div className="wf-lb-views" role="tablist" aria-label="Views">
                  {views.map((v, i) => <button type="button" role="tab" aria-selected={i === Math.min(view, views.length - 1)} key={v.label + i} className={i === Math.min(view, views.length - 1) ? 'on' : ''} onClick={() => { setView(i); setSub(0) }}>{v.label}</button>)}
                </div>
              )}
              {set && (
                <div className="wf-lb-thumbs" role="list">
                  {set.map((src, i) => <button type="button" role="listitem" key={src} className={i === Math.min(sub, set.length - 1) ? 'on' : ''} onClick={() => setSub(i)} aria-label={i === 0 ? 'All shots' : `Shot ${i}`}><img src={src} alt="" loading="lazy" /></button>)}
                </div>
              )}
              <div className="wf-lb-nav">
                <button type="button" onClick={() => { setOpen((open! - 1 + ITEMS.length) % ITEMS.length); setView(0); setSub(0) }} aria-label="Previous workflow">‹</button>
                <span>{open! + 1} / {ITEMS.length}</span>
                <button type="button" onClick={() => { setOpen((open! + 1) % ITEMS.length); setView(0); setSub(0) }} aria-label="Next workflow">›</button>
              </div>
            </div>
            <div className="wf-lb-info">
              <span className="wf-cat">{cur.category}</span>
              <h3>{cur.title}</h3>
              <p className="wf-lb-client">{cur.client}</p>
              <div className="wf-lb-metrics">
                {cur.metrics.map((m) => <div key={m.label}><strong>{m.value}</strong><span>{m.label}</span></div>)}
              </div>
              <h4>The problem</h4>
              <p>{cur.problem}</p>
              <h4>What I built</h4>
              <p>{cur.built}</p>
              <h4>How it runs</h4>
              <ol className="wf-lb-steps">{cur.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
              <div className="wf-lb-tags">{cur.tools.map((t) => <span key={t}>{t}</span>)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
