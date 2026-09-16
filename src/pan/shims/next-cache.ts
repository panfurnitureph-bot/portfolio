/* next/cache shim. Server actions call revalidatePath(...) after writes; in the demo that
   becomes a window event the page host listens to so it re-runs its data loader. */
export function revalidatePath(path: string, _type?: string) {
  void _type
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pan-demo:revalidate', { detail: path }))
}
export function revalidateTag(tag: string) { revalidatePath('tag:' + tag) }
export function unstable_cache<T extends (...a: never[]) => unknown>(fn: T): T { return fn }
export function unstable_noStore() {}
export const cacheLife = () => {}
export const cacheTag = () => {}
