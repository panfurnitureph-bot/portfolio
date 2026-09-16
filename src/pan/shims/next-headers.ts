/* next/headers shim — request headers/cookies do not exist in the browser demo. */
const empty = { get: (_k: string) => null as string | null, has: () => false, entries: () => [][Symbol.iterator](), forEach: () => {} }
export async function headers() { return empty }
export async function cookies() { return { ...empty, getAll: () => [] as { name: string; value: string }[], set: () => {}, delete: () => {} } }
