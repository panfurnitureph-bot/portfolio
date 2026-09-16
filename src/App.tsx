import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react'
import { Route, Routes, useLocation, Link } from 'react-router-dom'
import Home from './pages/Home'

const PanFurniture = lazy(() => import('./pages/PanFurniture'))
const PanApp = lazy(() => import('./pan/PanApp'))
import { loadProcureApp } from './procure/entry.js'
const ProcureApp = lazy(loadProcureApp)
import { loadStoreApp } from './store/entry.js'
const StoreApp = lazy(loadStoreApp)

function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const el = document.querySelector(hash)
      if (el) { el.scrollIntoView({ behavior: 'smooth' }); return }
    }
    window.scrollTo({ top: 0 })
  }, [pathname, hash])
  return null
}

function Title({ text }: { text: string }) {
  useEffect(() => { document.title = text }, [text])
  return null
}

function Loading() {
  return (
    <div className="dash" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <span className="live"><span className="dot" /> Loading console…</span>
    </div>
  )
}

/* Any other path is treated as a Pan Furniture app route (the real app links to /orders, /hr/directory/12,
   /delivery-map.html… from inside its components and from location.href). The in-memory Pan router takes
   the path as its entry and the browser URL is normalised back to /pan. Pure typos still get the 404. */
/* /pan?entry=/dashboard opens the app on that page (the showcase uses it); plain /pan resumes where the visitor left off. */
function PanEntry() {
  const { search } = useLocation()
  const q = new URLSearchParams(search)
  const entry = q.get('entry')
  return <PanApp entry={entry && entry.startsWith('/') ? entry : null} device={q.get('device') === 'tablet' ? 'tablet' : null} role={q.get('role')} embed={q.get('embed') === '1'} />
}

/* /store?entry=/collections/beds opens the storefront on that page; plain /store resumes where the visitor left off. */
function StoreEntry() {
  const { search } = useLocation()
  const q = new URLSearchParams(search)
  const entry = q.get('entry')
  return <StoreApp entry={entry && entry.startsWith('/') ? entry : null} device={q.get('device') === 'phone' ? 'phone' : null} frame={q.get('frame') === '1'} />
}

/* The storefront copy navigates with location.href in a few places (Quick View "Buy now" → /checkout, the
   quote list → /quote-request, the track pop-up iframe → /track?embed=1). Those are the site's own paths, so
   while a store session is active (the demo has been opened in this tab) they go back into /store. */
const STORE_PATHS = /^\/(products|collections|cart|checkout|quote-request|track|search|wishlist|contact|gift-cards|about|measuring|faqs|shipping|privacy)(\/|$)/
function storeSessionActive() { try { return !!sessionStorage.getItem('store-demo-href') } catch { return false } }

function PanCatchAll() {
  const { pathname, search, hash } = useLocation()
  if (STORE_PATHS.test(pathname) && storeSessionActive()) return <><Title text="Pan Furniture — Storefront (demo)" /><StoreApp entry={pathname + search} /></>
  const looksLikeDemo = /^\/demo\//.test(pathname) || /^\/work\//.test(pathname) || /^\/procure(\/|$)/.test(pathname) || /^\/store(\/|$)/.test(pathname)
  if (looksLikeDemo) return <><Title text="Not found · Joe Marie Casela" /><NotFound /></>
  return <><Title text="Pan Furnitures — Warehouse IMS (demo)" /><PanApp entry={pathname + search + hash} /></>
}

function NotFound() {
  return (
    <div className="notfound">
      <div>
        <p className="eyebrow">404</p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', margin: '0.75rem 0' }}>Demo not found</h1>
        <p style={{ color: 'var(--ink-2)' }}>The link may be out of date, or the demo has been retired.</p>
        <Link to="/" className="btn btn-primary" style={{ marginTop: '1.5rem' }}>Back to portfolio</Link>
      </div>
    </div>
  )
}

/* A lazily loaded demo can fail to fetch its chunk: in dev when Vite re-optimises dependencies while a
   page is open ("504 Outdated Optimize Dep"), in production right after a deploy when the open page
   still references old chunk hashes. Both are fixed by one reload, so do that once (guarded) instead
   of leaving a blank frame. */
class ChunkErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) {
    if (!/dynamically imported module|Loading chunk|Outdated Optimize Dep|Importing a module script failed/i.test(error.message)) return
    const key = 'chunk-reload-at'
    const last = Number(sessionStorage.getItem(key) || 0)
    if (Date.now() - last > 20000) { sessionStorage.setItem(key, String(Date.now())); window.location.reload() }
  }
  render() {
    if (this.state.failed) return (
      <div className="notfound"><div>
        <p className="eyebrow">Reloading…</p>
        <p style={{ color: 'var(--ink-2)' }}>The demo could not load its code. <a href={window.location.href} className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-block' }}>Reload</a></p>
      </div></div>
    )
    return this.props.children
  }
}

export default function App() {
  return (
    <>
      <ScrollManager />
      <ChunkErrorBoundary>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<><Title text="Joe Marie Casela — Workflow & AI Automation Specialist" /><Home /></>} />
          <Route path="/work/pan-furniture" element={<><Title text="Pan Furniture Operations Platform · Joe Marie Casela" /><PanFurniture /></>} />
          <Route path="/pan" element={<><Title text="Pan Furnitures — Warehouse IMS (demo)" /><PanEntry /></>} />
          <Route path="/procure/*" element={<><Title text="Northwind Motor Parts — Purchasing Console (demo)" /><ProcureApp /></>} />
          <Route path="/store" element={<><Title text="Pan Furniture — Storefront (demo)" /><StoreEntry /></>} />



          <Route path="*" element={<PanCatchAll />} />
        </Routes>
      </Suspense>
      </ChunkErrorBoundary>
    </>
  )
}
