/* pdfjs-dist shim — PDF rendering to canvas is not bundled in the demo. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const GlobalWorkerOptions: any = { workerSrc: '' }
export function getDocument(_src: any): { promise: Promise<any> } { void _src; return { promise: Promise.reject(new Error('PDF preview is not available in the demo')) } }
export const version = 'demo'
export default { GlobalWorkerOptions, getDocument, version } as any
