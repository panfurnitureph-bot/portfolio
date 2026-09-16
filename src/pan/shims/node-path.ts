/* node:path shim (posix semantics). */
export const sep = '/'
export function join(...parts: string[]) { return parts.filter(Boolean).join('/').replace(/\/+/g, '/') }
export function resolve(...parts: string[]) { return join(...parts) }
export function basename(p: string, ext?: string) { const b = p.split(/[\/]/).pop() ?? ''; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b }
export function dirname(p: string) { const i = p.lastIndexOf('/'); return i <= 0 ? '.' : p.slice(0, i) }
export function extname(p: string) { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : '' }
export const posix = { sep, join, resolve, basename, dirname, extname }
export default { sep, join, resolve, basename, dirname, extname, posix }
