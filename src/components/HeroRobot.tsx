/* Hero 3D robot: a Spline scene loaded lazily (idle callback + when near the viewport), paused while
   off-screen or when the tab is hidden, with a glowing placeholder orb until the scene is ready.
   Drives @splinetool/runtime directly (no react-spline wrapper) so the renderer can be pinned to WebGL:
   the "Both (Auto)" export picks WebGPU wherever the browser exposes navigator.gpu, and a stalled adapter
   request there left the scene stuck on the placeholder. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Application } from '@splinetool/runtime'

/* "GENKUB - Greeting robot" from the Spline community (CC BY 4.0), self-hosted from public/robot/. */
export const ROBOT_SCENE = '/robot/scene.splinecode'
const RUNTIME_URL = '/robot/runtime/runtime.js'
/* A dynamic import Vite cannot see: even with @vite-ignore it wraps the URL in __vite__injectQuery(…, 'import'),
   and a public/ file requested that way is rejected by the dev server. Built through Function it stays a plain
   browser import() and the runtime is fetched as a static file. */
const loadPrebuilt = new Function('u', 'return import(u)') as (u: string) => Promise<unknown>
/* the runtime's WASM helpers (physics, navmesh, boolean, hana-ui) are self-hosted here instead of fetched from cdn.spline.design */

/* camera zoom applied after load so the robot fills the stage */
const ZOOM = 1.25
/* orbit the scene camera around the robot (radians, + = robot turns toward the left/text column) */
const TURN = 0.5
/* give the scene this long to load before we stop waiting (the orb simply stays) */
const LOAD_TIMEOUT_MS = 25_000

function turnCamera(a: Application) {
  try {
    const cam = a.findObjectByName('Camera')
    if (!cam) return
    const { x, z } = cam.position
    cam.position.x = x * Math.cos(TURN) + z * Math.sin(TURN)
    cam.position.z = -x * Math.sin(TURN) + z * Math.cos(TURN)
    cam.rotation.y += TURN
  } catch { /* ignore */ }
}
const REDUCED = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function Orb({ pulse = true }: { pulse?: boolean }) {
  return (
    <div className={'robot-orb' + (pulse ? ' pulse' : '')} aria-hidden="true">
      <div className="robot-orb-glow" />
      <div className="robot-orb-ring" style={{ width: '74%' }} />
      <div className="robot-orb-ring" style={{ width: '50%' }} />
      <div className="robot-orb-core" />
    </div>
  )
}

export function HeroRobot({ scene = ROBOT_SCENE }: { scene?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const app = useRef<Application | null>(null)
  const visible = useRef(true)
  const [wanted, setWanted] = useState(false)
  const [ready, setReady] = useState(false)

  /* play only while on screen and the tab is visible */
  const sync = useCallback(() => {
    const a = app.current as (Application & { isStopped?: boolean; play?: () => void; stop?: () => void }) | null
    if (!a) return
    try {
      if (visible.current && !document.hidden) { if (a.isStopped) a.play?.() }
      else if (!a.isStopped) a.stop?.()
    } catch { /* runtime without play/stop */ }
  }, [])

  useEffect(() => {
    const el = box.current
    if (!el || REDUCED) return
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting; sync() }, { rootMargin: '150px' })
    io.observe(el)
    document.addEventListener('visibilitychange', sync)
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', sync) }
  }, [sync])

  /* defer the 2 MB runtime: after idle, and only once the hero is near the viewport */
  useEffect(() => {
    const el = box.current
    if (!el || REDUCED) return
    let io: IntersectionObserver | null = null, idle = 0, timer = 0
    const arm = () => { io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setWanted(true); io?.disconnect() } }, { rootMargin: '200px' }); io.observe(el) }
    if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(arm, { timeout: 2500 })
    else timer = window.setTimeout(arm, 1200)
    return () => { io?.disconnect(); if (idle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle); window.clearTimeout(timer) }
  }, [])

  /* load the runtime + scene into our own canvas, WebGL pinned */
  useEffect(() => {
    if (!wanted || !canvas.current) return
    let alive = true
    const el = canvas.current
    const timeout = window.setTimeout(() => { if (alive && !app.current) console.warn('[hero] Spline scene did not finish loading in time') }, LOAD_TIMEOUT_MS)
    ;(async () => {
      try {
        /* Spline's own prebuilt ESM, served untouched from public/robot/runtime: re-bundling it through Vite
           broke the Draco worker it builds from stringified source (ReferenceError inside the worker). */
        /* In `vite dev` the source is not minified, so the npm package works and public/ files must not be imported;
           the production build imports the untouched prebuilt copy. */
        const { Application } = import.meta.env.DEV
          ? await import('@splinetool/runtime')
          : ((await loadPrebuilt(RUNTIME_URL)) as typeof import('@splinetool/runtime'))
        if (!alive) return
        const a = new Application(el, { renderMode: 'auto', renderer: 'webgl', ...(import.meta.env.DEV ? {} : { wasmPath: '/robot/runtime' }) } as ConstructorParameters<typeof Application>[1])
        await a.load(scene)
        if (!alive) { try { a.dispose() } catch { /* ignore */ } return }
        app.current = a
        try {
          const x = a as unknown as { setZoom?: (z: number) => void; setBackgroundColor?: (c: string) => void }
          x.setZoom?.(ZOOM); x.setBackgroundColor?.('transparent'); turnCamera(a)
        } catch { /* ignore */ }
        sync(); setReady(true)
      } catch (err) {
        console.warn('[hero] Spline scene failed to load', err)
      }
    })()
    return () => { alive = false; window.clearTimeout(timeout); try { app.current?.dispose?.() } catch { /* ignore */ } app.current = null }
  }, [wanted, scene, sync])

  return (
    <div ref={box} className="robot-stage" aria-hidden="true">
      <div className={'robot-layer' + (ready ? ' out' : '')}><Orb pulse={!ready} /></div>
      {wanted && (
        <div className="robot-layer robot-spline">
          <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
        </div>
      )}
    </div>
  )
}
