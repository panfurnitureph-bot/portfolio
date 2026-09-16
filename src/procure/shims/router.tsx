/* react-router-dom as seen by the copied Northwind Motor Parts code. The production app is mounted at "/";
   here it lives under "/procure", so absolute app paths get the prefix on the way out and lose it on the
   way in — the components keep their verbatim `to="/all-channels"` links and `useLocation()` checks. */
import { forwardRef, useCallback, useMemo, type ComponentProps } from 'react'
import {
  Link as RLink, NavLink as RNavLink, Navigate as RNavigate, Outlet, useLocation as rUseLocation,
  useNavigate as rUseNavigate, useSearchParams, useParams, matchPath, generatePath, type To, type NavigateOptions,
} from 'react-router-dom'

export const PROCURE_PREFIX = '/procure'

const addPrefix = (to: To): To => {
  if (typeof to === 'string') return to.startsWith('/') && !to.startsWith(PROCURE_PREFIX) ? PROCURE_PREFIX + to : to
  if (to && typeof to === 'object' && to.pathname && to.pathname.startsWith('/') && !to.pathname.startsWith(PROCURE_PREFIX)) return { ...to, pathname: PROCURE_PREFIX + to.pathname }
  return to
}
export const stripPrefix = (p: string) => (p === PROCURE_PREFIX ? '/' : p.startsWith(PROCURE_PREFIX + '/') ? p.slice(PROCURE_PREFIX.length) : p)

export const Link = forwardRef<HTMLAnchorElement, ComponentProps<typeof RLink>>(function Link({ to, ...rest }, ref) {
  return <RLink ref={ref} to={addPrefix(to)} {...rest} />
})
export const NavLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof RNavLink>>(function NavLink({ to, ...rest }, ref) {
  return <RNavLink ref={ref} to={addPrefix(to)} {...rest} />
})
export function Navigate({ to, ...rest }: ComponentProps<typeof RNavigate>) {
  return <RNavigate to={addPrefix(to)} {...rest} />
}
export function useNavigate() {
  const nav = rUseNavigate()
  return useCallback((to: To | number, opts?: NavigateOptions) => (typeof to === 'number' ? nav(to) : nav(addPrefix(to), opts)), [nav])
}
export function useLocation() {
  const loc = rUseLocation()
  return useMemo(() => ({ ...loc, pathname: stripPrefix(loc.pathname) }), [loc])
}
export { Outlet, useSearchParams, useParams, matchPath, generatePath }
