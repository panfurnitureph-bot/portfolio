/* sharp shim — server-side image processing is not available in the browser demo. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export default function sharp(_input?: any): any {
  void _input
  const api: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'toBuffer' || prop === 'toFile') return async () => { throw new Error('sharp is not available in the demo') }
      if (prop === 'metadata') return async () => ({ width: 0, height: 0, format: 'png' })
      if (prop === 'then') return undefined
      return (..._a: any[]) => { void _a; return api }
    },
  })
  return api
}
