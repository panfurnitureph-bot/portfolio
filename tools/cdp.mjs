// Minimal CDP driver: open URL, optionally click a tab, report layout of .panel/.chart, screenshot full page.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9333
const OUT = process.argv[2]
const jobs = JSON.parse(process.argv[3]) // [{url, tab?, name}]

const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break } catch { await sleep(250) } }
const page = targets.find((t) => t.type === 'page') ?? targets[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.result?.value === undefined) console.log('EVAL RAW:', JSON.stringify(r).slice(0, 600)); return r.result?.result?.value }

await send('Page.enable'); await send('Runtime.enable')
const errors = []
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? '')) })

for (const job of jobs) {
  if (job.width) await send('Emulation.setDeviceMetricsOverride', { width: job.width, height: job.height ?? 900, deviceScaleFactor: 1, mobile: !!job.mobile })
  await send("Page.navigate", { url: job.url }); await sleep(job.wait ?? 1500)
  for (const c of job.clicks ?? []) { await evaluate(`(() => { const els = [...document.querySelectorAll('button, a, select option')]; const t = ${JSON.stringify(c)}; const el = els.find(b => b.textContent.trim() === t) ?? els.find(b => b.textContent.includes(t)); if (el) el.click(); return !!el })()`); await sleep(500) }
  if (job.tab) { await evaluate(`[...document.querySelectorAll('.dash-tabs button')].find(b=>b.textContent.trim()===${JSON.stringify(job.tab)})?.click()`); await sleep(600) }
  if (job.probe) console.log('PROBE:', JSON.stringify(await evaluate(job.probe)))
  const info = await evaluate(`(() => { const r = (el) => { const b = el.getBoundingClientRect(); return Math.round(b.width)+'x'+Math.round(b.height) }; return { doc: document.documentElement.scrollHeight, charts: [...document.querySelectorAll('svg.chart')].map(r), panels: [...document.querySelectorAll('.panel')].map(p => (p.querySelector('h3')?.textContent||'').slice(0,30)+' '+r(p)), h1: document.querySelector('h1')?.textContent } })()`)
  const height = job.viewport ? (job.height ?? 1000) : Math.min(6000, info.doc + 40)
  await send('Emulation.setDeviceMetricsOverride', { width: job.width ?? 1440, height, deviceScaleFactor: 1, mobile: !!job.mobile })
  await sleep(300)
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !job.viewport })
  writeFileSync(`${OUT}/${job.name}.png`, Buffer.from(shot.result.data, 'base64'))
  console.log(`== ${job.name} doc=${info.doc} h1="${info.h1}"`); console.log('   charts:', info.charts.join(' | ')); console.log('   panels:', info.panels.join(' | '))
}
console.log('errors:', errors.length ? errors : 'none')
ws.close(); chrome.kill()
