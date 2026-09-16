/* next/navigation shim backed by the in-memory PAN router. */
import { usePanRouter } from '../router'

export function usePathname(): string { return usePanRouter().path }
export function useSearchParams(): URLSearchParams { return usePanRouter().search }
export function useRouter() {
  const r = usePanRouter()
  return { push: r.push, replace: r.replace, refresh: r.refresh, back: r.back, prefetch: () => {}, forward: () => {} }
}
export function redirect(href: string): never { throw new Error('redirect(' + href + ') is not supported in the demo') }
export function useParams<T = Record<string, string>>(): T { return {} as T }
