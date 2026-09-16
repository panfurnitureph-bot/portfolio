/* @vladmandic/face-api shim — face models are not bundled in the demo (kiosk enrolment is disabled).
   Loosely typed on purpose so the copied loader compiles unchanged. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const noop = async (..._a: any[]) => { void _a }
export const nets: any = { ssdMobilenetv1: { loadFromUri: noop }, faceLandmark68Net: { loadFromUri: noop }, faceRecognitionNet: { loadFromUri: noop }, tinyFaceDetector: { loadFromUri: noop }, faceLandmark68TinyNet: { loadFromUri: noop } }
export class SsdMobilenetv1Options { constructor(_o?: any) { void _o } }
export class TinyFaceDetectorOptions { constructor(_o?: any) { void _o } }
function chain(result: any): any {
  const c: any = {
    withFaceLandmarks: () => chain(result), withFaceDescriptor: () => chain(result), withFaceDescriptors: () => chain(result), withFaceExpressions: () => chain(result),
    then: (ok: (v: any) => any, err?: (e: any) => any) => Promise.resolve(result).then(ok, err), catch: (fn: (e: any) => any) => Promise.resolve(result).catch(fn),
  }
  return c
}
export function detectSingleFace(_i: any, _o?: any): any { void _i; void _o; return chain(null) }
export function detectAllFaces(_i: any, _o?: any): any { void _i; void _o; return chain([]) }
export const euclideanDistance = (_a: any, _b: any) => 1
export class FaceMatcher { constructor(..._a: any[]) { void _a } findBestMatch(..._a: any[]) { void _a; return { label: 'unknown', distance: 1, toString: () => 'unknown' } } }
export class LabeledFaceDescriptors { constructor(public label: string, public descriptors: Float32Array[]) {} }
export const tf: any = { setBackend: async () => true, ready: async () => {}, getBackend: () => 'cpu', engine: () => ({ startScope() {}, endScope() {} }) }
export const env: any = { monkeyPatch: () => {}, setEnv: () => {} }
export function matchDimensions(..._a: any[]) { void _a }
export function resizeResults(r: any) { return r }
export const draw: any = { drawDetections: () => {}, drawFaceLandmarks: () => {}, drawFaceExpressions: () => {} }
export function createCanvasFromMedia(_m: any): any { void _m; return document.createElement('canvas') }
export const utils: any = {}
