/* PAN System demo — runs the REAL Pan-Furnitures UI (AppShell, sidebar, login, dashboard…)
   copied verbatim under ./real, with Next.js and Supabase swapped for in-browser shims + dummy data. */
import { useEffect, useRef, useState } from 'react'
import { Buffer } from 'buffer'
// Copied server actions use node's Buffer for PDFs / base64; provide it in the browser.
if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') (globalThis as { Buffer?: unknown }).Buffer = Buffer
import { Link } from 'react-router-dom'
import './pan-real.css'
import './pan.css'
import { PanRouterProvider, usePanRouter } from './router'
import { AppShell } from './real/components/app-shell'
import LoginPage from './real/app/login/page'
import ForgotPasswordPage from './real/app/forgot-password/page'
import { ROLE_LABEL, ROLES, type Role } from './real/lib/auth/rbac'
import { homeFor } from './real/lib/auth/permissions'
import { DEMO_ACCOUNTS, DEMO_OTP, DEMO_PASSWORD, shellUserFor } from './demo-data'
import { ensureSeeded, resetSeed } from './db/seed'
import { renderRoute, getSession } from './routes'
import { invalidateSessionCache } from './real/lib/auth/session'
import { db as demoDb } from './db/store'
import { PageErrorBoundary } from './page-host'
import { PanProvider, usePan } from './store'

const ROLE_KEY = 'pan-demo-role'

function useSession(forceRole: Role | null = null) {
  /* ?role=… wins over the stored session and is applied before the first render, so ?entry=… is honoured */
  const [role, setRole] = useState<Role | null>(() => { if (forceRole) { try { localStorage.setItem(ROLE_KEY, forceRole) } catch { /* ignore */ } return forceRole } try { return (localStorage.getItem(ROLE_KEY) as Role) || null } catch { return null } })
  useEffect(() => {
    const onLogin = (e: Event) => { const r = (e as CustomEvent<Role>).detail; setRole(r); try { localStorage.setItem(ROLE_KEY, r) } catch { /* ignore */ } }
    const onOut = () => { setRole(null); try { localStorage.removeItem(ROLE_KEY) } catch { /* ignore */ } }
    window.addEventListener('pan-demo:login', onLogin); window.addEventListener('pan-demo:signout', onOut)
    return () => { window.removeEventListener('pan-demo:login', onLogin); window.removeEventListener('pan-demo:signout', onOut) }
  }, [])
  return { role, setRole: (r: Role | null) => { setRole(r); try { r ? localStorage.setItem(ROLE_KEY, r) : localStorage.removeItem(ROLE_KEY) } catch { /* ignore */ } } }
}

function Routed({ role }: { role: Role }) {
  const { path, tick } = usePanRouter()
  void tick
  return <PageErrorBoundary resetKey={path}>{renderRoute(path, role)}</PageErrorBoundary>
}

function Badges() {
  const { s } = usePan()
  useEffect(() => {
    ;(window as unknown as { __panBadges?: Record<string, number> }).__panBadges = {
      '/operations/approval': s.orders.filter((o) => o.ops === 'To Assign' && o.status !== 'Pending' && o.status !== 'Cancelled').length,
      '/operations/delivery-queue': s.orders.filter((o) => o.ops === 'Ready').length,
      '/quality-control': s.jobs.filter((j) => j.status === 'Done').length,
      '/mto-requests': s.mto.filter((m) => m.status === 'New').length,
      '/delivery/routes/team-a': s.deliveries.filter((x) => (x.team as string) === 'Delivery Team' && (x.status === 'Scheduled' || x.status === 'Out for Delivery')).length,
    }
  }, [s])
  return null
}

function DemoBar({ role, onRole, roles, label = 'Demo · role:', onReset }: { role: Role; onRole: (r: Role) => void; roles?: Role[]; label?: string; onReset?: () => void }) {
  const { d } = usePan()
  const list = roles ?? ROLES.filter((r) => r !== 'developer' && r !== 'attendance_kiosk')
  return (
    <div className="pan-demo-bar">
      <span>{label}</span>
      <select value={role} onChange={(e) => onRole(e.target.value as Role)}>{list.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
      <button onClick={() => { if (confirm('Reset demo data to the original seed?')) { resetSeed(); d({ type: 'reset' }); onReset?.() } }}>Reset data</button>
      <Link to="/">Portfolio</Link>
    </div>
  )
}

/* The sidebar user is hydrated the way production does it: profile row + role default + the
   per-user grants/denies saved from the Employee Directory permissions grid. Re-hydrates when
   those tables change so a saved grid applies without a reload. */
function useShellUser(role: Role | null) {
  const [user, setUser] = useState<ReturnType<typeof shellUserFor> | null>(() => (role ? shellUserFor(role) : null))
  useEffect(() => {
    if (!role) { setUser(null); return }
    let alive = true
    const load = async () => {
      invalidateSessionCache()
      const s = await getSession().catch(() => null)
      /* the profile's role wins: an admin can change an employee's Login Role in the Directory and the next sign-in follows it */
      if (alive) setUser(s ? { ...shellUserFor(s.role), ...s, permissions: s.permissions ?? [] } : shellUserFor(role))
    }
    void load()
    const off = demoDb.subscribe((t) => { if (t === '*' || t === 'user_permissions' || t === 'role_permissions' || t === 'profiles' || t === 'permissions') void load() })
    return () => { alive = false; off() }
  }, [role])
  return user
}

/* Tablet view: the app runs inside a same-origin iframe sized like a 10-inch Android tablet
   (1180×820 CSS px — below the app's xl breakpoint, so it gets the drawer sidebar and full-width
   pages exactly as on the device), drawn inside a bezel and scaled to fit the window. */
const TAB_W = 1180, TAB_H = 820, BEZEL = 22
function TabletStage({ entry, initialRole }: { entry: string | null; initialRole: Role | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const { role, setRole } = useSession(initialRole)
  const [gen, setGen] = useState(0) // bumps to reload the device after Reset data
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setScale(Math.min((e.contentRect.width - 24) / (TAB_W + 2 * BEZEL), (e.contentRect.height - 96) / (TAB_H + 2 * BEZEL), 1)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const r: Role = role ?? 'delivery_team_a'
  const src = `/pan?embed=1&role=${encodeURIComponent(r)}&entry=${encodeURIComponent(entry && gen === 0 && role === initialRole ? entry : homeFor(shellUserFor(r)))}`
  return (
    <div className="pan-tablet-stage" ref={ref}>
      <div className="pan-tablet-device" style={{ width: TAB_W + 2 * BEZEL, height: TAB_H + 2 * BEZEL, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <span className="pan-tablet-cam" aria-hidden="true" />
        <div className="pan-tablet-screen" style={{ width: TAB_W, height: TAB_H }}>
          <iframe key={src + '#' + gen} src={src} title="Pan Furniture IMS — tablet" width={TAB_W} height={TAB_H} />
        </div>
      </div>
      <DemoBar role={r} onRole={(x) => { setRole(x); setGen((g) => g + 1) }} onReset={() => setGen((g) => g + 1)} label="Tablet · role:" />
    </div>
  )
}

function Inner({ forceRole = null, embed = false }: { forceRole?: Role | null; embed?: boolean }) {
  const { role, setRole } = useSession(forceRole && (ROLES as string[]).includes(forceRole) ? forceRole : null)
  const router = usePanRouter()
  const user = useShellUser(role)
  // After a fresh login, land on the role's real home page (same rule as the production layout).
  useEffect(() => { if (role) { const user = shellUserFor(role); if (router.path === '/login' || router.path === '/') router.replace(homeFor(user)) } }, [role]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!role && router.path !== '/login' && router.path !== '/forgot-password') router.replace('/login') }, [role]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!role) {
    if (router.path === '/forgot-password') return <div className="pan-root"><ForgotPasswordPage /></div>
    return (
      <div className="pan-root">
        <LoginPage />
        <div className="mx-auto -mt-4 max-w-md px-4 pb-10 text-sm text-[#7c7361]">
          <div className="rounded-xl border border-[#e7e0d2] bg-white p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#a89f88]">Demo accounts · password <code className="rounded bg-stone-100 px-1 font-mono">{DEMO_PASSWORD}</code> · code <code className="rounded bg-stone-100 px-1 font-mono">{DEMO_OTP}</code></p>
            <ul className="grid gap-1">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email} className="flex items-center justify-between gap-2">
                  <span className="truncate"><span className="font-medium text-[#2a2519]">{a.name}</span> · <span className="font-mono text-xs">{a.email}</span></span>
                  <button className="shrink-0 rounded-lg border border-[#caa45a] bg-[#faf6ec] px-2 py-0.5 text-[11px] font-semibold text-[#4a3b1a] hover:bg-[#f4ead8]" onClick={() => setRole(a.role)}>Quick sign in</button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs"><Link to="/" className="font-medium text-[#5b5026] hover:underline">← Back to portfolio</Link></p>
          </div>
        </div>
      </div>
    )
  }

  /* Plain <a href="/orders"> anchors inside the copied components (not next/link) would leave the SPA;
     route same-origin app paths through the in-memory router instead. */
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || a.target === '_blank' || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.defaultPrevented) return
    const href = a.getAttribute('href') || ''
    if (!href.startsWith('/') || href.startsWith('//') || /\.[a-z0-9]{2,5}(\?|$)/i.test(href.split('?')[0]) || href === '/pan' || href.startsWith('/pan/')) return
    e.preventDefault(); router.push(href)
  }
  const onRole = (r: Role) => { setRole(r); router.replace(homeFor(shellUserFor(r))) }
  return (
    <div className={'pan-root' + (embed ? ' pan-root--embed' : '')} onClickCapture={onClickCapture}>
      <Badges />
      <AppShell user={user ?? shellUserFor(role)}><Routed role={user?.role ?? role} /></AppShell>
      {!embed && <DemoBar role={user?.role ?? role} onRole={onRole} />}
    </div>
  )
}

ensureSeeded()

export default function PanApp({ entry, device = null, role = null, embed = false }: { entry?: string | null; device?: 'tablet' | null; role?: string | null; embed?: boolean } = {}) {
  const tablet = device === 'tablet'
  const forced = role && (ROLES as string[]).includes(role) ? (role as Role) : null
  useEffect(() => { if (!embed && entry && window.location.pathname !== '/pan') window.history.replaceState(null, '', tablet ? '/pan?device=tablet' : '/pan') }, [entry, tablet, embed])
  useEffect(() => { if (tablet) { document.body.classList.add('pan-tablet-body'); return () => document.body.classList.remove('pan-tablet-body') } }, [tablet])
  if (tablet) return <PanProvider><TabletStage entry={entry ?? null} initialRole={forced} /></PanProvider>
  return (
    <PanRouterProvider initial="/login" entry={entry}>
      <PanProvider><Inner forceRole={forced} embed={embed} /></PanProvider>
    </PanRouterProvider>
  )
}
