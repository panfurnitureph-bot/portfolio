/* "Book a call" → the booking page (Calendly) opens inside an overlay instead of a new tab, like the
   reference site. With no booking URL configured the buttons that use `useBooking()` fall back to a mailto link.

   Calendly's embed is heavy (~1.5 MB of scripts before the calendar paints), so the iframe is created
   early — a couple of seconds after the page settles, or as soon as a Book button is hovered — and
   kept alive off-screen. Opening the modal then only reveals an already-rendered calendar. */
import { useCallback, useEffect, useState } from 'react'
import { profile } from '../content'

const MAILTO = `mailto:${profile.email}?subject=Book%20a%2030-minute%20assessment`
const WARM_EVENT = 'book:warm'
const warm = () => window.dispatchEvent(new Event(WARM_EVENT))

/** href + onClick for any "Book" button: overlay when a booking URL exists, mailto otherwise. */
export function useBooking() {
  const [open, setOpen] = useState(false)
  const has = !!profile.calendar
  const props = {
    href: has ? profile.calendar : MAILTO,
    onClick: has ? (e: React.MouseEvent) => { e.preventDefault(); setOpen(true) } : undefined,
    onMouseEnter: has ? warm : undefined,
    onFocus: has ? warm : undefined,
    target: has ? '_blank' : undefined,
    rel: has ? 'noreferrer' : undefined,
  }
  return { open, setOpen, props }
}

export function BookingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const close = useCallback(() => onClose(), [onClose])
  const [ready, setReady] = useState(false) // iframe mounted (pre-warmed or opened)
  useEffect(() => {
    if (!profile.calendar) return
    const on = () => setReady(true)
    window.addEventListener(WARM_EVENT, on)
    /* warm on idle, after the hero and the demos have had first pick of the network */
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    const t = window.setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(on, { timeout: 4000 }) : on()), 2500)
    return () => { window.removeEventListener(WARM_EVENT, on); window.clearTimeout(t) }
  }, [])
  useEffect(() => {
    if (!open) return
    setReady(true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open, close])
  if (!profile.calendar || !(ready || open)) return null
  return (
    <div className={'book-modal' + (open ? '' : ' book-warm')} role="dialog" aria-modal="true" aria-hidden={!open} aria-label="Book a 30-minute assessment" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="book-win">
        <div className="book-bar">
          <span className="book-title">30-minute assessment · pick a time</span>
          <a href={profile.calendar} target="_blank" rel="noreferrer" className="show-modal-btn">Open in new tab ↗</a>
          <button type="button" className="show-modal-btn show-modal-close" onClick={close} aria-label="Close">✕</button>
        </div>
        <iframe src={profile.calendar} title="Booking calendar" allow="camera; microphone" loading="eager" />
      </div>
    </div>
  )
}
