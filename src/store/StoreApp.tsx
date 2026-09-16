/* Pan Furniture storefront — the production Next.js site copied verbatim under ./real and mounted at
   /store as a client-only app: the async "server" pages run in the browser against the bundled sample
   catalog, the Next runtime is shimmed (link / navigation / image / font), and the Pan app's API
   routes are answered locally (see api-mock.ts). The shell below mirrors app/layout.tsx. */
import { Suspense, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import './store.css'
import './store-demo.css'
import { StoreRouterProvider, useStoreRouter } from './router'
import { NotFoundError } from './shims/next-navigation'
import { installApiMock } from './api-mock'
import { StoreProvider } from './real/components/store'
import Header from './real/components/Header'
import Footer from './real/components/Footer'
import ChatBubble from './real/components/ChatBubble'
import ContactRail from './real/components/ContactRail'
import TrackButton from './real/components/TrackButton'
import EmbedMode from './real/components/EmbedMode'
import HydrationMark from './real/components/HydrationMark'
import { site, NAV_LINKS, shopLinks } from './real/lib/products'
import NotFound from './real/app/not-found'
import HomePage from './real/app/page'
import CollectionPage from './real/app/collections/[category]/page'
import ProductPage from './real/app/products/[slug]/page'
import CartPage from './real/app/cart/page'
import CheckoutPage from './real/app/checkout/page'
import QuoteRequestPage from './real/app/quote-request/page'
import SearchPage from './real/app/search/page'
import WishlistPage from './real/app/wishlist/page'
import ContactPage from './real/app/contact/page'
import GiftCardsPage from './real/app/gift-cards/page'
import AboutPage from './real/app/about/page'
import MeasuringPage from './real/app/measuring/page'
import FaqsPage from './real/app/faqs/page'
import ShippingPage from './real/app/shipping/page'
import PrivacyPage from './real/app/privacy/page'
import TrackPage from './real/app/track/page'

const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Bricolage+Grotesque:wght@400;500;600;700&display=swap'

/** Paths the copied site navigates to with location.href (Quick View "Buy now", the quote list, the
    track pop-up iframe). App.tsx sends these back into the demo when a store session is active. */
export const STORE_PATHS = /^\/(products|collections|cart|checkout|quote-request|track|search|wishlist|contact|gift-cards|about|measuring|faqs|shipping|privacy)(\/|$)/

type Resolved = { key: string; run: () => Promise<ReactElement> | ReactElement }

/* Route table for the copied app/ directory: static segments first, then the two dynamic routes.
   Dynamic pages receive `params` as a Promise, the way Next 15 hands them over. */
function resolve(path: string): Resolved | null {
  const p = path.replace(/\/+$/, '') || '/'
  const statics: Record<string, () => Promise<ReactElement> | ReactElement> = {
    '/': () => HomePage(),
    '/cart': () => CartPage(),
    '/checkout': () => CheckoutPage(),
    '/quote-request': () => QuoteRequestPage(),
    '/search': () => SearchPage(),
    '/wishlist': () => WishlistPage(),
    '/contact': () => ContactPage(),
    '/gift-cards': () => GiftCardsPage(),
    '/about': () => AboutPage(),
    '/measuring': () => MeasuringPage(),
    '/faqs': () => FaqsPage(),
    '/shipping': () => ShippingPage(),
    '/privacy': () => PrivacyPage(),
    '/track': () => <TrackPage />,
  }
  if (statics[p]) return { key: p, run: statics[p] }
  let m = p.match(/^\/collections\/([^/]+)$/)
  if (m) { const category = decodeURIComponent(m[1]); return { key: p, run: () => CollectionPage({ params: Promise.resolve({ category }) }) } }
  m = p.match(/^\/products\/([^/]+)$/)
  if (m) { const slug = decodeURIComponent(m[1]); return { key: p, run: () => ProductPage({ params: Promise.resolve({ slug }) }) } }
  return null
}

/* Runs a copied Next "server" page in the browser: await its element, show not-found.tsx when it
   calls notFound(), and re-run when the router refreshes. */
function Page() {
  const { path, tick } = useStoreRouter()
  const route = resolve(path)
  const [state, set] = useState<{ key: string; el: ReactElement | null; err: Error | null }>({ key: '', el: null, err: null })
  useEffect(() => {
    if (!route) return
    let alive = true
    Promise.resolve()
      .then(() => route.run())
      .then((el) => alive && set({ key: route.key, el, err: null }))
      .catch((e: Error) => alive && set({ key: route.key, el: null, err: e }))
    return () => { alive = false }
  }, [route?.key, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!route) return <NotFound />
  if (state.key !== route.key) return state.el ?? <div className="min-h-[60vh]" />
  if (state.err) return state.err instanceof NotFoundError ? <NotFound /> : <Failed error={state.err} />
  return state.el
}

function Failed({ error }: { error: Error }) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-24 text-center">
      <h1 className="text-2xl font-bold mb-3">Something went wrong rendering this page</h1>
      <p className="text-stone text-sm font-mono break-all">{error.message}</p>
    </div>
  )
}

/* Same tree as app/layout.tsx: page-clip wrapper, store provider, header, main, footer, floating buttons. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="page-clip min-h-screen bg-brownDeep">
      <StoreProvider>
        <HydrationMark />
        <Suspense fallback={null}><EmbedMode /></Suspense>
        <Header site={site} nav={NAV_LINKS} />
        <main className="bg-cream">{children}</main>
        <Footer site={site} shop={shopLinks()} />
        <TrackButton />
        <ChatBubble site={site} />
        <ContactRail site={site} />
      </StoreProvider>
    </div>
  )
}

function DemoBadge() {
  const { push } = useStoreRouter()
  return (
    <div className="store-demo-badge" role="note" data-floating>
      <span className="dot" aria-hidden="true" />
      <b>Demo storefront</b>
      <span>sample catalog · orders &amp; payments simulated</span>
      <button type="button" onClick={() => push('/')}>Home</button>
      <a href="/" target="_top">← Portfolio</a>
    </div>
  )
}

/* /store?device=phone — the same store inside a phone bezel (same-origin iframe at a real phone width,
   scaled to the window), the way the Pan IMS tablet preview works. */
const PH_W = 390, PH_H = 844, PH_BEZEL = 14
function PhoneStage({ entry }: { entry: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setScale(Math.min((e.contentRect.width - 24) / (PH_W + 2 * PH_BEZEL), (e.contentRect.height - 84) / (PH_H + 2 * PH_BEZEL), 1)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const src = `/store?frame=1&entry=${encodeURIComponent(entry || '/')}`
  return (
    <div className="store-phone-stage" ref={ref}>
      <div className="store-phone-device" style={{ width: PH_W + 2 * PH_BEZEL, height: PH_H + 2 * PH_BEZEL, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <span className="store-phone-notch" aria-hidden="true" />
        <div className="store-phone-screen" style={{ width: PH_W, height: PH_H }}>
          <iframe src={src} title="Pan Furniture storefront — phone" width={PH_W} height={PH_H} />
        </div>
      </div>
      <div className="store-demo-badge" role="note">
        <span className="dot" aria-hidden="true" />
        <b>Mobile preview</b>
        <span>same store at phone width · orders simulated</span>
        <a href="/store" target="_top">Desktop view</a>
        <a href="/" target="_top">← Portfolio</a>
      </div>
    </div>
  )
}

export default function StoreApp({ entry, device = null, frame = false }: { entry?: string | null; device?: 'phone' | null; frame?: boolean }) {
  useEffect(() => {
    if (!document.querySelector(`link[href="${FONTS}"]`)) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONTS; document.head.appendChild(l)
    }
    const restore = installApiMock()
    const prevBg = document.body.style.background
    document.body.style.background = device === 'phone' ? '#14110c' : '#3E3220'
    document.documentElement.setAttribute('data-store-demo', '1')
    return () => { restore(); document.body.style.background = prevBg; document.documentElement.removeAttribute('data-store-demo') }
  }, [device])
  if (device === 'phone') return <div className="store-root"><PhoneStage entry={entry ?? null} /></div>
  return (
    <div className="store-root">
      <StoreRouterProvider entry={entry}>
        <Shell><Page /></Shell>
        {!frame && <DemoBadge />}
      </StoreRouterProvider>
    </div>
  )
}
