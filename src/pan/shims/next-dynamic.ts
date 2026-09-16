/* next/dynamic shim → React.lazy + Suspense with the same `loading` option. */
import { createElement, lazy, Suspense, type ComponentType, type ReactElement } from 'react'

export default function dynamic<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>, opts?: { ssr?: boolean; loading?: () => ReactElement | null }): ComponentType<P> {
  const L = lazy(loader) as unknown as ComponentType<P>
  return function Dynamic(props: P) {
    return createElement(Suspense, { fallback: opts?.loading ? opts.loading() : null }, createElement(L, props))
  }
}
