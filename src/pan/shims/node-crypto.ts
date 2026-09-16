/* node:crypto shim for the browser demo — only what the copied server actions use. */
export function randomUUID(): string { return globalThis.crypto.randomUUID() }
export function randomBytes(n: number) { const a = new Uint8Array(n); globalThis.crypto.getRandomValues(a); return { toString: (enc?: string) => (enc === 'hex' ? [...a].map((b) => b.toString(16).padStart(2, '0')).join('') : enc === 'base64' ? btoa(String.fromCharCode(...a)) : String.fromCharCode(...a)), length: n, buffer: a } }
function fnv(s: string) { let h = 0x811c9dc5; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 } return h }
export function createHmac(_alg: string, key: string | { toString(): string }) { let data = ''; return { update(d: string | { toString(): string }) { data += String(d); return this }, digest(enc?: string) { const h1 = fnv(String(key) + '|' + data), h2 = fnv(data + '|' + String(key)); const hex = h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + fnv(hex0(h1, h2)).toString(16).padStart(8, '0'); return enc === 'base64' ? btoa(hex) : enc === 'base64url' ? btoa(hex).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : hex } } }
function hex0(a: number, b: number) { return a.toString(36) + b.toString(36) }
export function createHash(_alg: string) { let data = ''; return { update(d: string | { toString(): string }) { data += String(d); return this }, digest(enc?: string) { const h = fnv(data).toString(16).padStart(8, '0') + fnv(data + '#').toString(16).padStart(8, '0'); return enc === 'base64' ? btoa(h) : h } } }
export function timingSafeEqual(a: { toString(): string }, b: { toString(): string }) { return String(a) === String(b) }
export function createSign() { return { update() { return this }, sign() { return 'demo-signature' } } }
export const webcrypto = globalThis.crypto
export default { randomUUID, randomBytes, createHmac, createHash, timingSafeEqual, createSign, webcrypto }
