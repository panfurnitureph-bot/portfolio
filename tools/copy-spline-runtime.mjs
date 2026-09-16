/* Copies Spline's prebuilt runtime (ESM chunks + WASM, no .br/.gz variants) into public/robot/runtime so the
   hero can import it untouched at runtime. Re-bundling @splinetool/runtime through Vite re-minifies it and
   breaks the Draco worker it builds from stringified source ("ReferenceError: E is not defined" in the worker).
   Also fetches the Draco decoder the runtime expects next to its WASM path. Runs before every build. */
import { cpSync, mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules/@splinetool/runtime/build')
const dst = join(root, 'public/robot/runtime')
mkdirSync(dst, { recursive: true })
let n = 0
for (const f of readdirSync(src, { withFileTypes: true })) {
  if (f.isDirectory()) { cpSync(join(src, f.name), join(dst, f.name), { recursive: true }); continue }
  if (/\.(br|gz)$/.test(f.name)) continue
  cpSync(join(src, f.name), join(dst, f.name)); n++
}
const DRACO = 'https://www.gstatic.com/draco/versioned/decoders/1.5.2/'
for (const f of ['draco_wasm_wrapper.js', 'draco_decoder.wasm', 'draco_decoder.js']) {
  const out = join(dst, f)
  if (existsSync(out)) continue
  const r = await fetch(DRACO + f)
  if (!r.ok) throw new Error(`draco ${f}: HTTP ${r.status}`)
  writeFileSync(out, Buffer.from(await r.arrayBuffer()))
}
console.log(`spline runtime: ${n} files → public/robot/runtime`)
