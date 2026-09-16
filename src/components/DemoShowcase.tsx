/* "Interactive demos" showcase: the two Pan IMS product cards, then the purchasing console as a
   titled section of compact module tiles with a category filter. Any card or tile opens the product
   live, full screen, in an iframe overlay (Esc / ✕ / click outside to close). */
import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { Link } from 'react-router-dom'
import { demos, type Demo } from '../content'
import { Reveal } from './Reveal'

const routeOf = (d: Demo) => d.route ?? `/demo/${d.slug}`
const MAIN = demos.find((d) => d.slug === 'pan')
const TABLET = demos.find((d) => d.slug === 'pan-tablet')
const STORE = demos.find((d) => d.slug === 'store')
const STORE_PHONE = demos.find((d) => d.slug === 'store-mobile')
const MODULES = demos.filter((d) => d.product === 'console')
const ORDER = ['Dashboards & analytics', 'Inventory & planning', 'Purchasing', 'Shipping']
const CATEGORIES = ['All', ...ORDER.filter((c) => MODULES.some((d) => d.category === c)), ...Array.from(new Set(MODULES.map((d) => d.category ?? 'Other'))).filter((c) => !ORDER.includes(c))]

export function DemoShowcase() {
  const [full, setFull] = useState<string | null>(null) // slug shown in the full-screen overlay
  const [cat, setCat] = useState('All')
  const [pick, setPick] = useState<string | null>(null) // tile expanded in place (layout-grid)
  const [pickTop, setPickTop] = useState(0) // the clicked tile's row, so the card opens where you clicked (matters on phones)
  const fullDemo = full ? demos.find((d) => d.slug === full) ?? null : null
  const tiles = useMemo(() => (cat === 'All' ? MODULES : MODULES.filter((d) => d.category === cat)), [cat])

  /* Full-screen overlay: Esc closes, page scroll is locked while open */
  useEffect(() => {
    if (!pick) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPick(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pick])
  useEffect(() => {
    if (!full) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(null) }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [full])

  const open = useCallback((s: string) => setFull(s), [])
  const reduced = useReducedMotion()
  /* pointer-tracked glow on the module tiles (21st.dev "glow card grid" idea, done with two CSS vars) */
  const glow = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  }, [])

  return (
    <>
      <div className="show-head">
        <div>
          <p className="show-eyebrow">Interactive demos · {demos.length} live screens</p>
          <h2 className="show-title">Evaluate the systems hands-on.</h2>
          <p className="show-lede">Production-grade applications running in the browser on synthetic data. Open any of them full screen and use it the way your team would.</p>
        </div>
      </div>

      {/* the product: one wide card; its tablet preview overlaps the corner as a companion device */}
      <Reveal className="show-hero" y={18} duration={0.5} amount={0.15}>
        {MAIN && (
          <button type="button" onClick={() => open(MAIN.slug)} aria-pressed={full === MAIN.slug} className={'show-card main' + (full === MAIN.slug ? ' on' : '')}>
            <span className="show-card-bar"><span className="show-dots sm" aria-hidden="true"><i /><i /><i /></span><span className="show-card-kind">Interactive demo</span></span>
            <span className="show-card-shot">
              <img src={MAIN.image} alt={`${MAIN.name} interface`} loading="lazy" decoding="async" />
            </span>
            <span className="show-card-body">
              <span className="show-card-title">{MAIN.name} — {MAIN.kicker}</span>
              <span className="show-card-result">↗ {MAIN.outcome}</span>
              <span className="show-card-tags">{MAIN.tags.slice(0, 3).map((t) => <span key={t}>{t}</span>)}</span>
              <span className="show-card-cta">Open full screen ⤢</span>
            </span>
          </button>
        )}
        {TABLET && (
          <button type="button" onClick={() => open(TABLET.slug)} aria-pressed={full === TABLET.slug} className={'show-device' + (full === TABLET.slug ? ' on' : '')} aria-label="Open the tablet preview of Pan IMS">
            <img src={TABLET.image} alt="" loading="lazy" decoding="async" />
            <span>Tablet preview ⤢</span>
            <small>Same app on a 10-inch tablet · all roles</small>
          </button>
        )}
      </Reveal>

      {/* the same platform's customer-facing store: a second wide card under the product */}
      {STORE && (
        <Reveal className="show-hero store" y={18} duration={0.5} amount={0.15}>
          <button type="button" onClick={() => open(STORE.slug)} aria-pressed={full === STORE.slug} className={'show-card main' + (full === STORE.slug ? ' on' : '')}>
            <span className="show-card-bar"><span className="show-dots sm" aria-hidden="true"><i /><i /><i /></span><span className="show-card-kind">Interactive demo · storefront</span></span>
            <span className="show-card-shot">
              <img src={STORE.image} alt={`${STORE.name} home page`} loading="lazy" decoding="async" />
            </span>
            <span className="show-card-body">
              <span className="show-card-title">{STORE.name} — {STORE.kicker}</span>
              <span className="show-card-result">↗ {STORE.outcome}</span>
              <span className="show-card-tags">{STORE.tags.slice(0, 3).map((t) => <span key={t}>{t}</span>)}</span>
              <span className="show-card-cta">Open full screen ⤢</span>
            </span>
          </button>
          {STORE_PHONE && (
            <button type="button" onClick={() => open(STORE_PHONE.slug)} aria-pressed={full === STORE_PHONE.slug} className={'show-device phone' + (full === STORE_PHONE.slug ? ' on' : '')} aria-label="Open the mobile preview of the storefront">
              <img src={STORE_PHONE.image} alt="" loading="lazy" decoding="async" />
              <span>Mobile preview ⤢</span>
              <small>Same store on a phone</small>
            </button>
          )}
        </Reveal>
      )}

      <Reveal className="show-sec" amount={0.3}>
        <h3>Purchasing Console <small>Northwind Motor Parts · {MODULES.length} modules</small></h3>
        <LayoutGroup id="show-cats">
          <div className="show-pills" role="tablist" aria-label="Module categories">
            {CATEGORIES.map((c) => {
              const n = c === 'All' ? MODULES.length : MODULES.filter((d) => d.category === c).length
              const on = cat === c
              return (
                <button type="button" role="tab" aria-selected={on} key={c} className={'show-pill' + (on ? ' on' : '')} onClick={() => setCat(c)}>
                  {on && <motion.span aria-hidden className="show-pill-thumb" layoutId={reduced ? undefined : 'show-pill-thumb'} transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.5 }} />}
                  <span className="show-pill-label">{c} <b>{n}</b></span>
                </button>
              )
            })}
          </div>
        </LayoutGroup>
      </Reveal>
      {/* tiles keep their identity across filters: matching ones slide to their new slot, the rest fade out (21st.dev "filter grid" pattern) */}
      {/* layout-grid: a clicked tile morphs (shared layoutId) into a large card over the grid; the others dim */}
      <LayoutGroup id="show-tiles">
        <div className="show-tiles-wrap">
        <ul className={'show-tiles' + (pick ? ' picking' : '')}>
          <AnimatePresence initial={false} mode="popLayout">
            {tiles.map((d) => {
              const on = d.slug === full
              const picked = d.slug === pick
              return (
                <motion.li key={d.slug} layout={reduced ? false : 'position'} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }} transition={{ layout: { type: 'spring', stiffness: 260, damping: 34, mass: 0.8 }, duration: 0.22 }}>
                  {!picked && (
                    <motion.button layoutId={reduced ? undefined : `tile-${d.slug}`} type="button" onClick={(e) => { const li = e.currentTarget.closest('li') as HTMLElement | null; const wrap = li?.closest('.show-tiles-wrap') as HTMLElement | null; if (li && wrap) { const top = li.getBoundingClientRect().top - wrap.getBoundingClientRect().top; setPickTop(Math.max(0, Math.min(top, wrap.clientHeight - 420))) } setPick(d.slug) }} onPointerMove={glow} aria-pressed={on} aria-expanded={false} className={'show-tile' + (on ? ' on' : '')}>
                      <motion.img layoutId={reduced ? undefined : `tile-img-${d.slug}`} src={d.image} alt={`${d.name} interface`} loading="lazy" decoding="async" />
                      <span className="show-tile-body"><b>{d.name}</b><span>{d.outcome}</span></span>
                      <i className="show-tile-cta">Open ⤢</i>
                    </motion.button>
                  )}
                  {picked && <div className="show-tile show-tile-ghost" aria-hidden="true" />}
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
          {/* scrim + expanded card live beside the grid (not inside it) so they never affect its rows */}
          <AnimatePresence>
            {pick && (() => {
              const d = MODULES.find((m) => m.slug === pick)
              if (!d) return null
              return (
                <motion.div key="expanded" className="show-expanded" style={{ top: pickTop }} ref={(el) => { if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })) }} layoutId={reduced ? undefined : `tile-${d.slug}`} transition={{ type: 'spring', stiffness: 300, damping: 34, mass: 0.8 }} role="dialog" aria-label={`${d.name} — module details`}>
                  <motion.img layoutId={reduced ? undefined : `tile-img-${d.slug}`} src={d.image} alt={`${d.name} interface`} />
                  <motion.div className="show-expanded-shade" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} />
                  <motion.div className="show-expanded-body" initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 60 }} transition={{ duration: 0.3, ease: 'easeInOut', delay: 0.1 }}>
                    <span className="show-card-kind">{d.category} · {d.client}</span>
                    <b>{d.name}</b>
                    <p>{d.blurb}</p>
                    <span className="show-card-tags">{d.tags.slice(0, 4).map((t) => <span key={t}>{t}</span>)}</span>
                    <span className="show-expanded-actions">
                      <button type="button" className="show-launch" onClick={() => { setPick(null); open(d.slug) }}>Open full screen ⤢</button>
                      <button type="button" className="show-modal-btn" onClick={() => setPick(null)}>Close</button>
                    </span>
                  </motion.div>
                </motion.div>
              )
            })()}
          </AnimatePresence>
          <motion.div className="show-scrim" aria-hidden={!pick} onClick={() => setPick(null)} initial={false} animate={{ opacity: pick ? 1 : 0 }} style={{ pointerEvents: pick ? 'auto' : 'none' }} transition={{ duration: 0.25 }} />
        </div>
      </LayoutGroup>

      {fullDemo && (
        <div className="show-modal" role="dialog" aria-modal="true" aria-label={`${fullDemo.name} — live demo`} onClick={(e) => { if (e.target === e.currentTarget) setFull(null) }}>
          <div className="show-modal-win">
            <div className="show-chrome show-modal-bar">
              <span className="show-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="show-url">workwithjm.dev{routeOf(fullDemo).startsWith('/demo/') ? '/demo/' : '/'}<b>{routeOf(fullDemo).replace(/^\/(demo\/)?/, '').replace(/\?.*$/, '')}</b></span>
              <span className="show-modal-title">{fullDemo.name} — {fullDemo.kicker}</span>
              <span className="show-live">● Live — click anything</span>
              {fullDemo.caseStudy && <Link to={fullDemo.caseStudy} className="show-modal-btn">Case study →</Link>}
              <a href={routeOf(fullDemo)} target="_blank" rel="noopener noreferrer" className="show-modal-btn">Open in new tab ↗</a>
              <button type="button" className="show-modal-btn show-modal-close" onClick={() => setFull(null)} aria-label="Close full screen">✕</button>
            </div>
            <iframe key={routeOf(fullDemo)} src={routeOf(fullDemo)} title={`${fullDemo.name} — ${fullDemo.kicker}, full screen demo`} />
          </div>
        </div>
      )}
    </>
  )
}
