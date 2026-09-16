/* node:fs shim — there is no file system in the browser demo; reads reject, writes are no-ops. */
const missing = (p: unknown) => Object.assign(new Error('ENOENT: no such file (browser demo): ' + String(p)), { code: 'ENOENT' })
export async function readFile(p: unknown): Promise<never> { throw missing(p) }
export function readFileSync(p: unknown): never { throw missing(p) }
export async function writeFile() {}
export async function mkdir() {}
export async function access(p: unknown): Promise<never> { throw missing(p) }
export async function stat(p: unknown): Promise<never> { throw missing(p) }
export async function readdir(): Promise<string[]> { return [] }
export function existsSync() { return false }
export const promises = { readFile, writeFile, mkdir, access, stat, readdir }
export default { readFile, readFileSync, writeFile, mkdir, access, stat, readdir, existsSync, promises }
