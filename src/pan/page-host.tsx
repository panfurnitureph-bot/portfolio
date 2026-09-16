/* Runs a copied Next.js "server" page in the browser: call its async data loader, render the
   client manager with the result, and re-run the loader when a server action revalidates a path,
   the router refreshes, or the demo database changes (what Supabase Realtime does in production). */
import { Component, useEffect, useState, type ReactNode } from 'react'
import { usePanRouter } from './router'
import { db } from './db/store'

export function usePageData<T>(loader: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null; reload: () => void } {
  const { tick } = usePanRouter()
  const [state, set] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  const [bump, setBump] = useState(0)
  useEffect(() => {
    let alive = true
    loader().then((data) => alive && set({ data, error: null })).catch((e: unknown) => alive && set({ data: null, error: (e as Error).message }))
    return () => { alive = false }
  }, [tick, bump, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => setBump((b) => b + 1)
    window.addEventListener('pan-demo:revalidate', on)
    const off = db.subscribe(on)
    return () => { window.removeEventListener('pan-demo:revalidate', on); off() }
  }, [])
  return { ...state, reload: () => setBump((b) => b + 1) }
}

export function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 rounded-lg bg-stone-200" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-stone-100" />)}</div>
      <div className="h-64 rounded-xl bg-stone-100" />
    </div>
  )
}

export function Failed({ error }: { error: string }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">Failed to load: {error}</div>
}

export function PageData<T>({ load, deps, children }: { load: () => Promise<T>; deps?: unknown[]; children: (data: T, reload: () => void) => ReactNode }) {
  const { data, error, reload } = usePageData(load, deps)
  if (error) return <Failed error={error} />
  if (data == null) return <Loading />
  return <>{children(data, reload)}</>
}

/* Equivalent of Next's segment error.tsx: a crash inside one page shows an inline error instead of
   unmounting the whole shell. */
export class PageErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          <p className="font-semibold">Something went wrong rendering this page</p>
          <p className="mt-1 font-mono text-xs break-all">{this.state.error.message}</p>
          <button className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      )
    }
    return this.props.children
  }
}
