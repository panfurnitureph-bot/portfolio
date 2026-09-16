/* Northwind Motor Parts purchasing console — the production React pages copied verbatim under ./real, mounted
   at /procure with the demo database, a signed-in demo admin and the same providers the real App.tsx uses. */
import { lazy, Suspense, useEffect } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import './procure.css'
import './procure-demo.css'
import { AuthProvider } from './shims/auth-context'
import { PermissionsProvider } from './real/contexts/PermissionsContext'
import { RealtimeProvider } from './real/providers/RealtimeProvider'
import { TooltipProvider } from './real/components/ui/tooltip'
import { ProtectedRoute } from './real/components/ProtectedRoute'
import { SidebarProvider, SidebarInset } from './real/components/ui/sidebar'
import { ChatPanel } from './real/components/chat/ChatPanel'
import { EmailAutoSendProvider } from './real/providers/EmailAutoSendProvider'
import { ShopifyEmailAutoSendProvider } from './real/providers/ShopifyEmailAutoSendProvider'
import { Outlet } from 'react-router-dom'
import { ensureProcureSeeded } from './db/seed'
import { PROCURE_PAGES } from './pages'

const Dashboard = lazy(() => import('./real/pages/Dashboard'))
const ContainersTracker = lazy(() => import('./real/pages/ContainersTracker'))
const IncomingShipment = lazy(() => import('./real/pages/IncomingShipment'))
const InventoryArrivals = lazy(() => import('./real/pages/InventoryArrivals'))
const PurchaseOrderTracker = lazy(() => import('./real/pages/PurchaseOrderTracker'))
const InvoiceTracker = lazy(() => import('./real/pages/InvoiceTracker'))
const ShippingRequests = lazy(() => import('./real/pages/ShippingRequests'))
const POTracker = lazy(() => import('./real/pages/POTracker'))
const BookingDashboard = lazy(() => import('./real/pages/BookingDashboard'))
const ShopifyInventory = lazy(() => import('./real/pages/ShopifyInventory'))
const YearlySales = lazy(() => import('./real/pages/YearlySales'))
const InstockPercentage = lazy(() => import('./real/pages/InstockPercentage'))
const ChannelAnalytics = lazy(() => import('./real/pages/ChannelAnalytics'))
const AllChannels = lazy(() => import('./real/pages/AllChannels'))
const AdsAnalytics = lazy(() => import('./real/pages/AdsAnalytics'))
const InstockRateDashboard = lazy(() => import('./real/pages/InstockRateDashboard'))
const MonthlyForecast = lazy(() => import('./real/pages/MonthlyForecast'))

/* The Reorder Decisions and Storefront Stock reports live inside the Demand Planner as
   dialogs; as standalone products the page mounts and the report's toolbar button is pressed for the
   visitor once it renders (the dialog is the verbatim production one). */
function ForecastDialog({ button }: { button: string }) {
  useEffect(() => {
    document.body.classList.add('procure-dialog-only')
    const isOpen = () => !!document.querySelector('[role="alertdialog"]')
    const open = () => { const btn = [...document.querySelectorAll<HTMLButtonElement>('.procure-under button')].find((b) => b.textContent?.trim() === button); if (btn) btn.click(); return !!btn }
    let tries = 0
    const t = setInterval(() => { tries += 1; if (isOpen() || open() || tries > 60) clearInterval(t) }, 250)
    // Closing the report would reveal the (hidden) grid — reopen it so the product stays on screen.
    let timer: number | undefined, wasOpen = false
    const mo = new MutationObserver(() => {
      const now = isOpen()
      if (now) { wasOpen = true; return }
      if (!wasOpen) return
      window.clearTimeout(timer); timer = window.setTimeout(() => { if (!isOpen()) { wasOpen = false; open() } }, 400)
    })
    mo.observe(document.body, { childList: true, subtree: false })
    return () => { clearInterval(t); mo.disconnect(); window.clearTimeout(timer); document.body.classList.remove('procure-dialog-only') }
  }, [button])
  return <div className="procure-under"><MonthlyForecast /></div>
}

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false } } })

/* The production DashboardLayout minus its sidebar: each module is showcased as its own product, so the
   page fills the frame (SidebarProvider stays because the pages render a SidebarTrigger). */
function ModuleLayout() {
  return (
    <EmailAutoSendProvider>
      <ShopifyEmailAutoSendProvider>
        <SidebarProvider defaultOpen={false}>
          <div className="min-h-screen flex w-full bg-background">
            <SidebarInset className="flex-1 flex flex-col min-w-0">
              <Outlet />
            </SidebarInset>
            <ChatPanel />
          </div>
        </SidebarProvider>
      </ShopifyEmailAutoSendProvider>
    </EmailAutoSendProvider>
  )
}

function Loading() {
  return <div className="flex h-[60vh] w-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
}

/* Sidebar entries that are not part of this demo land here instead of a 404. */
function NotInDemo() {
  const { pathname } = useLocation()
  const name = pathname.replace(/^\/procure\/?/, '').replace(/-/g, ' ')
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-14 items-center gap-2 border-b bg-card px-4 text-sm font-semibold capitalize">{name || 'Cockpit'}</div>
      <div className="m-6 rounded-lg border border-dashed bg-card p-10 text-center">
        <p className="text-base font-semibold text-foreground">Not included in this demo</p>
        <p className="mt-1 text-sm text-muted-foreground">{PROCURE_PAGES.length} modules are live here: {PROCURE_PAGES.map((p) => p.name).join(', ')}.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {PROCURE_PAGES.map((p) => <Link key={p.path} to={p.path} className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground">{p.name}</Link>)}
        </div>
      </div>
    </div>
  )
}

ensureProcureSeeded()

export default function ProcureApp() {
  /* Tailwind utilities for this app are scoped under .procure-root (see tools/build-procure-css.mjs); Radix
     portals render on <body>, so the class goes on <body> while this app is mounted. */
  useEffect(() => {
    document.body.classList.add('procure-root')
    const realFetch = window.fetch.bind(window)
    // The Demand Planner asks the production API for live Shopify links — answer locally.
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('/api/')) return Promise.resolve(new Response(JSON.stringify(url.includes('shopify-links') ? { skus: {} } : { ok: true, data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      return realFetch(input, init)
    }
    return () => { document.body.classList.remove('procure-root'); window.fetch = realFetch }
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster position="top-right" richColors closeButton />
        <AuthProvider>
          <PermissionsProvider>
            <RealtimeProvider>
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route element={<ProtectedRoute><ModuleLayout /></ProtectedRoute>}>
                    <Route path="cockpit" element={<Dashboard />} />
                    <Route path="container-ledger" element={<ContainersTracker />} />
                    <Route path="inbound-calendar" element={<IncomingShipment />} />
                    <Route path="receiving-monitor" element={<InventoryArrivals />} />
                    <Route path="inbound-orders" element={<PurchaseOrderTracker />} />
                    <Route path="freight-bills" element={<InvoiceTracker tabGroup="finance" />} />
                    <Route path="dispatch-requests" element={<ShippingRequests tabGroup="finance" />} />
                    <Route path="order-pipeline" element={<POTracker tabGroup="finance" />} />
                    <Route path="booking-board" element={<BookingDashboard tabGroup="finance" title="Booking Board" />} />
                    <Route path="storefront-stock" element={<ShopifyInventory />} />
                    <Route path="sales-by-month" element={<YearlySales />} />
                    <Route path="availability-by-month" element={<InstockPercentage />} />
                    <Route path="margin-console" element={<ChannelAnalytics />} />
                    <Route path="marketplace-sheet" element={<AllChannels fixedTab="Marketplace Sheet" />} />
                    <Route path="storefront-sheet" element={<AllChannels fixedTab="Storefront Sheet" />} />
                    <Route path="long-tail-channels" element={<AllChannels fixedTab="Long-tail Channels" />} />
                    <Route path="flagged-skus" element={<AllChannels fixedTab="⚠️ Flagged SKUs" />} />
                    <Route path="ad-spend" element={<AdsAnalytics />} />
                    <Route path="availability-score" element={<InstockRateDashboard />} />
                    <Route path="demand-planner" element={<MonthlyForecast />} />
                    <Route path="inventory-planner" element={<MonthlyForecast />} />
                    <Route path="reorder-decisions" element={<ForecastDialog button="Reorder Decisions" />} />
                    <Route index element={<Navigate to="/procure/margin-console" replace />} />
                    <Route path="*" element={<NotInDemo />} />
                  </Route>
                </Routes>
              </Suspense>
            </RealtimeProvider>
          </PermissionsProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
