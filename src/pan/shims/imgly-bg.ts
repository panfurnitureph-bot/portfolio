/* @imgly/background-removal shim — the on-device model is not bundled in the demo. */
export type Config = { progress?: (key: string, current: number, total: number) => void; [k: string]: unknown }
export async function removeBackground(_blob: unknown, _opts?: Config): Promise<Blob> { void _blob; void _opts; throw new Error('Background removal is not available in the demo.') }
export default removeBackground
