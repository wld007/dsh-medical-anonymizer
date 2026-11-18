/**
 * Record the README animation: synthetic records (eval/bench/gen.mjs), the
 * page preview outside DSH, the model endpoints saved in the DSH profile, and
 * headless Chrome over the DevTools protocol (no extra dependencies). Runs one
 * real batch and takes a frame per step into <outDir>/frames, with
 * <outDir>/timeline.json for scripts/readme-demo.py. No real records.
 *
 *   REACT_UMD_DIR=<node_modules with react/umd> node scripts/readme-demo.mjs <outDir> [patients]
 *
 * Scenes: the batch running on the line, the finished line, the 效果评估
 * station, the 复核 tab, the report's 匿名化效果评估 section, back to the line.
 */
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = process.argv[2]
const patients = Number(process.argv[3] ?? 150)
if (!outDir || !process.env.REACT_UMD_DIR) {
  console.error('usage: REACT_UMD_DIR=… node scripts/readme-demo.mjs <outDir> [patients]')
  process.exit(1)
}
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const [WIDTH, HEIGHT] = [1280, 800]

// Synthetic records: one document per patient plus the tables, so the batch
// takes a minute or two and the lab table has enough people for K.
// Under /tmp so the paths shown on the page are short and impersonal.
const work = await mkdtemp('/tmp/anon-demo-')
await promisify(execFile)(process.execPath, [join(root, 'eval/bench/gen.mjs'), work, '--patients', String(patients), '--docs', '1'])
const input = join(work, '病历样例')
await rename(join(work, 'corpus'), input)

const port = 18000 + Math.floor(Math.random() * 1000)
const server = spawn(process.execPath, [join(root, 'scripts/preview-page.mjs'), join(work, 'out'), String(port)], {
  env: { ...process.env, PREVIEW_MODELS: '1', PREVIEW_QUASI: '1', PREVIEW_DEMO: '1', PREVIEW_VERSION: process.env.DEMO_VERSION ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version }, stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((resolve) => server.stdout.once('data', resolve))
const base = `http://127.0.0.1:${port}`

const devPort = 9300 + Math.floor(Math.random() * 500)
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${devPort}`, `--user-data-dir=${join(work, 'chrome')}`, '--hide-scrollbars', `--window-size=${WIDTH},${HEIGHT}`, 'about:blank'], { stdio: 'ignore' })

let socket
let seq = 0
const pending = new Map()
async function connect() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json()).find((target) => target.type === 'page')
      if (page) {
        socket = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data)
          const waiter = pending.get(message.id)
          if (!waiter) return
          pending.delete(message.id)
          if (message.error) waiter.reject(new Error(message.error.message))
          else waiter.resolve(message.result)
        }
        return
      }
    } catch { /* not up yet */ }
    await sleep(200)
  }
  throw new Error('Chrome did not start')
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  seq += 1
  pending.set(seq, { resolve, reject })
  socket.send(JSON.stringify({ id: seq, method, params }))
})
const run = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value
const rpc = async (method, payload = {}) => (await (await fetch(`${base}/rpc/${method}`, { method: 'POST', body: JSON.stringify(payload) })).json()).value
// Click the last element whose text starts with `text` (tabs, buttons).
const click = async (selector, text) => {
  const ok = await run(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((node) => node.textContent.trim().startsWith(${JSON.stringify(text)})); const el = all[all.length - 1]; if (!el) return false; el.click(); return true })()`)
  if (!ok) console.error('cannot click', text)
}

const frames = join(outDir, 'frames')
await rm(frames, { recursive: true, force: true })
await mkdir(frames, { recursive: true })
const timeline = []
let n = 0
const snap = async (ms) => {
  const f = `f${String(n++).padStart(4, '0')}.png`
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(frames, f), Buffer.from(data, 'base64'))
  timeline.push({ f, ms })
}

try {
  await connect()
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: base })
  await sleep(2000)
  const { runId } = await rpc('start', { inputDir: input, outputRoot: join(work, 'out') })
  console.log('batch', runId)
  await sleep(1500)
  for (;;) {
    await snap(500)
    const { run: batch } = await rpc('status', { runId })
    if (batch.status !== 'running') { console.log('ended', batch.status); break }
    await sleep(1500)
  }
  await sleep(3000)
  await snap(2600)
  // S10 效果评估 (11 stations; index 9).
  await run("document.querySelectorAll('.wd-st')[9]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))")
  await sleep(1200)
  await snap(3200)
  await click('button, [role=tab]', '复核')
  await sleep(1800)
  await snap(2400)
  await click('button', '↓ 下一份')
  await sleep(1200)
  await snap(2400)
  await click('button, [role=tab]', '报告')
  await sleep(1500)
  await run("[...document.querySelectorAll('.ws-md-toc-i')].find((node) => node.title === '匿名化效果评估')?.click()")
  await sleep(1500)
  await snap(3200)
  await click('button, [role=tab]', '◈ 流水线')
  await sleep(1200)
  await snap(1500)
} finally {
  await writeFile(join(outDir, 'timeline.json'), JSON.stringify(timeline, null, 1))
  socket?.close()
  chrome.kill()
  server.kill()
  await sleep(500)
  await rm(work, { recursive: true, force: true })
}
console.log(`${timeline.length} frames → ${frames}`)
process.exit(0)
