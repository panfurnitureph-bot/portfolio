/* CoverflowCarousel — ruixen.ui "coverflow-carousel" (21st.dev/@ruixen.ui/components/coverflow-carousel),
   adapted for this site: Tailwind utility classes → `.cf-*` classes in styles.css, `cn` inlined, slides render
   through `renderSlide` (any card, any aspect) instead of a fixed square <img>, and the centre index can be
   controlled from outside (arrow keys / lightbox). The ring, drag and settle logic are unchanged: the fractional
   position is painted straight to the DOM, looping folds the distance round the ring — no cloned nodes. */
import * as React from 'react'

const useIsoLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect

export interface CoverflowCarouselProps<T> {
  slides: T[]
  renderSlide: (slide: T, state: { active: boolean; index: number }) => React.ReactNode
  /** Controlled centre index (optional). */
  index?: number
  onChangeIndex?: (index: number) => void
  /** A plain click on the centre card. */
  onSlideClick?: (index: number) => void
  /** Degrees the first neighbour tilts. */
  rotate?: number
  /** How far the first neighbour recedes, as a fraction of card width. */
  depth?: number
  /** Viewer distance as a multiple of card width — smaller is a wider lens. */
  perspective?: number
  /** Exponent on distance. Below 1 the rake eases off as cards travel out. */
  falloff?: number
  /** Opacity lost per step from the centre. */
  fade?: number
  /** Any CSS length. Everything else is derived from it, so the rake scales. */
  cardWidth?: string
  /** Card height as a ratio of its width. */
  aspect?: number
  /** Space between cards, as a fraction of card width. */
  gap?: number
  loop?: boolean
  showPagination?: boolean
  showNavigation?: boolean
  label?: string
  className?: string
}

export function CoverflowCarousel<T>({
  slides, renderSlide, index, onChangeIndex, onSlideClick,
  rotate = 44, depth = 0.6, perspective = 3, falloff = 0.56, fade = 0.1,
  cardWidth = 'clamp(148px, 22vw, 260px)', aspect = 1, gap = 0.05, loop = true,
  showPagination = false, showNavigation = false, label = 'Cover carousel', className,
}: CoverflowCarouselProps<T>) {
  const count = slides.length
  const frameRef = React.useRef<HTMLDivElement>(null)
  const cardRefs = React.useRef<(HTMLDivElement | null)[]>([])
  const posRef = React.useRef(0)
  const targetRef = React.useRef(0)
  const widthRef = React.useRef(0)
  const rafRef = React.useRef<number | null>(null)
  const dragRef = React.useRef<{ id: number; x: number; pos: number; v: number; t: number; moved: boolean } | null>(null)
  const [selected, setSelected] = React.useState(index ?? 0)
  const emit = React.useRef(onChangeIndex); emit.current = onChangeIndex

  const indexAt = React.useCallback((pos: number) => ((Math.round(pos) % count) + count) % count, [count])

  const paint = React.useCallback(() => {
    const width = widthRef.current
    if (!width) return
    const pitch = width * (1 + gap)
    const pos = posRef.current
    cardRefs.current.forEach((card, i) => {
      if (!card) return
      let offset = i - pos
      if (loop) { offset = ((offset % count) + count) % count; if (offset > count / 2) offset -= count }
      const distance = Math.abs(offset)
      const ramp = Math.pow(distance, falloff)
      const tilt = Math.min(rotate * ramp, 82) * Math.sign(offset)
      card.style.transform = `translateX(calc(-50% + ${offset * pitch}px)) translateZ(${-depth * width * ramp}px) rotateY(${-tilt}deg)`
      const edge = loop ? Math.min(1, Math.max(0, count / 2 - distance)) : 1
      card.style.opacity = String(Math.max(0, 1 - fade * distance) * edge)
      card.style.zIndex = String(100 - Math.round(distance))
      card.classList.toggle('cf-active', distance < 0.5)
    })
  }, [count, depth, fade, falloff, gap, loop, rotate])

  const settle = React.useCallback((target: number) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    targetRef.current = target
    const next = indexAt(target)
    setSelected(next); emit.current?.(next)
    const step = () => {
      const remaining = target - posRef.current
      if (Math.abs(remaining) < 0.0004) { posRef.current = target; paint(); rafRef.current = null; return }
      posRef.current += remaining * 0.16
      paint()
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [indexAt, paint])

  const clamp = React.useCallback((pos: number) => (loop ? pos : Math.max(0, Math.min(count - 1, pos))), [count, loop])

  const goTo = React.useCallback((i: number) => {
    const target = loop ? i + Math.round((targetRef.current - i) / count) * count : i
    settle(clamp(target))
  }, [clamp, count, loop, settle])

  const nudge = React.useCallback((by: number) => settle(clamp(Math.round(targetRef.current) + by)), [clamp, settle])

  /* controlled index from outside (arrow keys, lightbox) */
  React.useEffect(() => { if (index != null && index !== indexAt(targetRef.current)) goTo(index) }, [index]) // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    /* no pointer capture yet: a plain click must still reach the buttons inside the cards */
    targetRef.current = posRef.current
    dragRef.current = { id: e.pointerId, x: e.clientX, pos: posRef.current, v: 0, t: performance.now(), moved: false }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== e.pointerId) return
    const pitch = widthRef.current * (1 + gap)
    if (!pitch) return
    if (!drag.moved && Math.abs(e.clientX - drag.x) > 4) { drag.moved = true; e.currentTarget.setPointerCapture(e.pointerId) }
    if (!drag.moved) return
    const now = performance.now()
    const previous = posRef.current
    posRef.current = clamp(drag.pos - (e.clientX - drag.x) / pitch)
    drag.v = ((posRef.current - previous) / Math.max(now - drag.t, 1)) * 1000
    drag.t = now
    const i = indexAt(posRef.current)
    if (i !== selected) setSelected(i)
    paint()
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== e.pointerId) return
    dragRef.current = null
    if (!drag.moved) {
      /* a plain click: buttons inside the card handle themselves; a side card comes to the centre */
      if ((e.target as HTMLElement).closest('button, a')) return
      const target = (e.target as HTMLElement).closest('[data-cf-index]') as HTMLElement | null
      if (target) { const i = Number(target.dataset.cfIndex); if (i !== indexAt(posRef.current)) { goTo(i); return } onSlideClick?.(i); return }
      settle(clamp(Math.round(posRef.current))); return
    }
    const carried = Math.max(-2, Math.min(2, drag.v * 0.18))
    settle(clamp(Math.round(posRef.current + carried)))
  }

  useIsoLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const measure = () => { const card = cardRefs.current[0]; if (!card) return; widthRef.current = card.offsetWidth; paint() }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(frame)
    return () => ro.disconnect()
  }, [paint])
  React.useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }, [])

  return (
    <div className={'cf' + (className ? ' ' + className : '')} style={{ ['--cf-card' as string]: cardWidth, ['--cf-aspect' as string]: aspect }} role="region" aria-roledescription="carousel" aria-label={label}>
      <div className="cf-rel">
        <div ref={frameRef} tabIndex={0} className="cf-frame" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerLeave={(e) => { if (dragRef.current && !dragRef.current.moved) dragRef.current = null; else endDrag(e) }}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1) } else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1) } }}
          style={{ perspective: `calc(var(--cf-card) * ${perspective})`, touchAction: 'pan-y' }}>
          <div className="cf-ring">
            {slides.map((slide, i) => (
              <div key={i} ref={(n) => { cardRefs.current[i] = n }} data-cf-index={i} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${count}`} className="cf-card">
                {renderSlide(slide, { active: i === selected, index: i })}
              </div>
            ))}
          </div>
        </div>
        {showNavigation && (
          <>
            <button type="button" aria-label="Previous slide" onClick={() => nudge(-1)} className="cf-nav cf-prev">‹</button>
            <button type="button" aria-label="Next slide" onClick={() => nudge(1)} className="cf-nav cf-next">›</button>
          </>
        )}
      </div>
      {showPagination && (
        <div className="cf-dots">
          {slides.map((_, i) => <button key={i} type="button" aria-label={`Go to slide ${i + 1}`} aria-current={i === selected} onClick={() => goTo(i)} className={'cf-dot' + (i === selected ? ' on' : '')} />)}
        </div>
      )}
    </div>
  )
}
