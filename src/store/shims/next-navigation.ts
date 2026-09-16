/* next/navigation shim backed by the in-memory store router. */
import { useStoreRouter } from '../router'

export function usePathname(): string { return useStoreRouter().path }
export function useSearchParams(): URLSearchParams { return useStoreRouter().search }
export function useRouter() {
  const r = useStoreRouter()
  return { push: r.push, replace: r.replace, refresh: r.refresh, back: r.back, prefetch: () => {}, forward: () => {} }
}
export function useParams<T = Record<string, string>>(): T { return {} as T }

/** Thrown by a page to render app/not-found.tsx (what Next does on the server). */
export class NotFoundError extends Error { constructor() { super('NEXT_NOT_FOUND'); this.name = 'NotFoundError' } }
export function notFound(): never { throw new NotFoundError() }
export function redirect(href: string): never { throw new Error('redirect(' + href + ') is not supported in the demo') }
