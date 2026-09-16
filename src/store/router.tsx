/* In-memory router for the storefront demo (stands in for Next's app router). The copied pages and
   components call usePathname / useSearchParams / useRouter and render <Link href>; the shims in
   ./shims map those onto this context. The visited path is remembered per browser tab. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type Router = {
  path: string
  search: URLSearchParams
  href: string
  push: (href: string) => void
  replace: (href: string) => void
  refresh: () => void
  back: () => void
  tick: number
}

const Ctx = createContext<Router | null>(null)
const KEY = 'store-demo-href'

function split(href: string) {
  const [p, q = ''] = href.split('#')[0].split('?')
  return { path: p || '/', search: new URLSearchParams(q) }
}

export function StoreRouterProvider({ children, entry }: { children: ReactNode; entry?: string | null }) {
  const [href, setHref] = useState<string>(() => {
    if (entry) { try { sessionStorage.setItem(KEY, entry) } catch { /* ignore */ } return entry }
    try { return sessionStorage.getItem(KEY) || '/' } catch { return '/' }
  })
  const [, setHistory] = useState<string[]>([])
  const [tick, setTick] = useState(0)
  const go = useCallback((h: string, replace = false) => {
    setHref((cur) => {
      if (!replace) setHistory((hs) => [...hs.slice(-30), cur])
      try { sessionStorage.setItem(KEY, h) } catch { /* ignore */ }
      return h
    })
    if (typeof window !== 'undefined' && !h.includes('#')) window.scrollTo({ top: 0 })
  }, [])
  const value = useMemo<Router>(() => {
    const { path, search } = split(href)
    return {
      path, search, href, tick,
      push: (h) => go(h),
      replace: (h) => go(h, true),
      refresh: () => setTick((t) => t + 1),
      back: () => setHistory((hs) => {
        const prev = hs[hs.length - 1]
        if (prev) { setHref(prev); try { sessionStorage.setItem(KEY, prev) } catch { /* ignore */ } }
        return hs.slice(0, -1)
      }),
    }
  }, [href, tick, go])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStoreRouter(): Router {
  const c = useContext(Ctx)
  if (!c) throw new Error('StoreRouterProvider missing')
  return c
}
