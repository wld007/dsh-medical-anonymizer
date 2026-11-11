/**
 * Regression tests for the web client (client.js) review findings #43, #44,
 * #45, #57, #58, #59, #60, #61 and #62.
 *
 * There is no DOM harness: client.js is loaded under Node with a stub module
 * loader and a stub React, its pure helpers are exercised directly, and the
 * UI wiring that cannot run without a browser is pinned with structural
 * checks on the source. The server side of #45 (ping key fallback) runs
 * against createService and a local HTTP listener.
 * Run: node test/fix2-client.mjs
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile, rm, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createService } from '../lib/service.js'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'fix2-client')
const clientPath = join(here, '..', 'client.js')
const source = await readFile(clientPath, 'utf8')

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${name}\n      ${error.stack?.split('\n').slice(0, 3).join('\n      ')}`)
  }
}

// ── Load client.js under Node ──────────────────────────────────────────────
let definition = null
globalThis.window = { __ModuleLoader__: { load(def) { definition = def } } }
await import(clientPath)
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  Fragment: 'Fragment',
}
const plugin = definition.factory((name) => (name === 'react' ? ReactStub : {}))
const helpers = plugin.helpers ?? {}
const zh = helpers.locales?.zh ?? {}
const en = helpers.locales?.en ?? {}
const tOf = (dict) => (key, vars) => {
  const template = dict[key] ?? key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''))
}
const tZh = tOf(zh)
const tEn = tOf(en)

/** Source text of one top-level-ish function in client.js, by its header. */
function functionBody(header) {
  const start = source.indexOf(header)
  assert.ok(start >= 0, `missing ${header}`)
  let depth = 0
  let seenBrace = false
  // Skip the parameter list: default values such as `extra = {}` hold braces too.
  let paren = 0
  let open = start
  for (let i = source.indexOf('(', start); i < source.length; i += 1) {
    if (source[i] === '(') paren += 1
    if (source[i] === ')') { paren -= 1; if (paren === 0) { open = i; break } }
  }
  for (let i = source.indexOf('{', open); i < source.length; i += 1) {
    if (source[i] === '{') { depth += 1; seenBrace = true }
    if (source[i] === '}') depth -= 1
    if (seenBrace && depth === 0) return source.slice(start, i + 1)
  }
  return source.slice(start)
}

/** Text of a rendered stub element tree. */
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.children ?? []).map(textOf).join('')
}

await check('client.js loads under Node and exposes its helpers without adding enumerable plugin keys', () => {
  assert.deepEqual(Object.keys(plugin).sort(), ['apply', 'inject'])
  assert.equal(typeof helpers.callResultLabel, 'function')
  assert.ok(Object.keys(zh).length > 100 && Object.keys(en).length > 100)
})

await check('locale: every literal t(key) used in client.js exists in both zh and en', () => {
  const keys = new Set([...source.matchAll(/\bt\('([\w.-]+)'/g)].map((match) => match[1]))
  assert.ok(keys.size > 200)
  const missing = [...keys].filter((key) => zh[key] === undefined || en[key] === undefined)
  assert.deepEqual(missing, [])
})

// ── #58 / #62: call result labels and markers ──────────────────────────────

await check('#62 call results without their own entry get readable labels (HTTP codes, error)', () => {
  for (const t of [tZh, tEn]) {
    for (const code of ['http-429', 'http-500', 'http-503', 'http-error', 'error', 'llm-error', 'llm-failed', 'no-model', 'no-base-url']) {
      const label = helpers.callResultLabel(t, code)
      assert.ok(label && !label.includes('ws.calls.r'), `${code} -> ${label}`)
    }
    assert.match(helpers.callResultLabel(t, 'http-429'), /429/)
    assert.match(helpers.callResultLabel(t, 'http-500'), /500/)
  }
  assert.equal(helpers.callResultLabel(tZh, 'ok'), zh['ws.calls.r.ok'])
  assert.equal(helpers.callResultLabel(tEn, 'timeout'), en['ws.calls.r.timeout'])
  // Unknown codes fall back to the code itself, never to a locale key.
  assert.equal(helpers.callResultLabel(tZh, 'ECONNRESET'), 'ECONNRESET')
  assert.equal(helpers.callResultLabel(tZh, undefined), '')
})

await check('#62 no call-result label in client.js bypasses the fallback helper (strip tooltip, table, per-model hints)', () => {
  assert.equal(/t\(`ws\.calls\.r\.\$\{/.test(source), false, 'a raw t(`ws.calls.r.${…}`) remains')
})

await check('#58 retry (↻N) and dropped (−N) markers are rendered inside the status chip', () => {
  const ok = helpers.callStatusChip(tZh, { result: 'ok', attempts: 3, dropped: 2 })
  const text = textOf(ok)
  assert.ok(text.includes(zh['ws.calls.r.ok']), text)
  assert.ok(text.includes('↻2'), text)
  assert.ok(text.includes('−2'), text)
  const marks = ok.children.filter((child) => child && typeof child === 'object' && child.type === 'i')
  assert.equal(marks.length, 2)
  assert.equal(marks[0].props.title, tZh('ws.calls.retryHint', { n: 2 }))
  // Untranslated results keep their markers too.
  const http = textOf(helpers.callStatusChip(tEn, { result: 'http-500', attempts: 2 }))
  assert.ok(http.includes('500') && http.includes('↻1') && !http.includes('ws.calls'), http)
  const plain = helpers.callStatusChip(tEn, { result: 'ok' })
  assert.equal(textOf(plain), en['ws.calls.r.ok'])
  assert.equal(plain.children.filter((child) => child && typeof child === 'object').length, 0)
  assert.equal(helpers.callStatusChip(tEn, { result: 'timeout' }).props.className, 'ma-chip ma-bad')
  assert.equal(helpers.callStatusChip(tEn, { result: 'cached' }).props.className, 'ma-chip')
})

// ── #57: the calls tab reads the whole log ─────────────────────────────────

function fakeCallLog(total) {
  const log = Array.from({ length: total }, (_, index) => ({ seq: index + 1, result: index % 97 === 0 ? 'timeout' : 'ok', ms: 100 }))
  let requests = 0
  const fetchPage = async (since) => {
    requests += 1
    const entries = log.filter((entry) => entry.seq > since).slice(0, 2000)
    return { entries, last: entries.length ? entries[entries.length - 1].seq : since }
  }
  return { log, fetchPage, requests: () => requests }
}

await check('#57 a finished batch with 9000 calls loads all of them, not only the first 2000', async () => {
  const server = fakeCallLog(9000)
  const result = await helpers.pullCallPages(server.fetchPage, { entries: [], last: 0 })
  assert.equal(result.entries.length, 9000)
  assert.equal(result.entries[0].seq, 1)
  assert.equal(result.entries.at(-1).seq, 9000)
  assert.equal(result.last, 9000)
  assert.equal(server.requests(), 5)
})

await check('#57 incremental pulls append only new calls; an exact multiple of the page size terminates', async () => {
  const server = fakeCallLog(4000)
  const first = await helpers.pullCallPages(server.fetchPage, { entries: [], last: 0 })
  assert.equal(first.entries.length, 4000)
  server.log.push(...Array.from({ length: 2500 }, (_, index) => ({ seq: 4001 + index, result: 'ok', ms: 1 })))
  const second = await helpers.pullCallPages(server.fetchPage, first)
  assert.equal(second.entries.length, 6500)
  assert.equal(new Set(second.entries.map((entry) => entry.seq)).size, 6500)
  const again = await helpers.pullCallPages(server.fetchPage, second)
  assert.equal(again.entries.length, 6500)
  assert.equal(again.last, 6500)
})

await check('#57 the client keeps as many calls as the server log holds (20000), dropping the oldest beyond that', async () => {
  const server = fakeCallLog(21000)
  const result = await helpers.pullCallPages(server.fetchPage, { entries: [], last: 0 })
  assert.equal(result.entries.length, 20000)
  assert.equal(result.entries[0].seq, 1001)
  assert.equal(result.last, 21000)
})

await check('#57 pulling stops when the view goes away or the server does not advance', async () => {
  const server = fakeCallLog(9000)
  let calls = 0
  const result = await helpers.pullCallPages(server.fetchPage, { entries: [], last: 0 }, () => (calls += 1) < 2)
  assert.ok(result === null || result.entries.length <= 4000)
  // A server that keeps returning a full page without advancing must not loop forever.
  const stuck = async () => ({ entries: Array.from({ length: 2000 }, (_, i) => ({ seq: i + 1 })), last: 2000 })
  const once = await helpers.pullCallPages(stuck, { entries: [], last: 2000 })
  assert.ok(once.entries.length <= 2000)
})

await check('#57 the row window is only labelled "latest" when it really is the latest rows', () => {
  assert.ok(zh['ws.calls.window'] && en['ws.calls.window'])
  assert.match(source, /focusIndex >= 0\s*\?\s*t\('ws\.calls\.window'/)
})

// ── #45: model tests and listings never borrow the saved key ───────────────

await check('#45 client: the saved key is only offered for the saved endpoint and never once "clear" is checked', () => {
  const saved = 'http://127.0.0.1:11434/v1'
  assert.deepEqual(helpers.pingKeyFields({ endpoint: ' http://other-host/v1 ', savedEndpoint: saved, apiKey: '', clearKey: false }),
    { baseURL: 'http://other-host/v1', apiKey: '', useSavedKey: false })
  assert.deepEqual(helpers.pingKeyFields({ endpoint: `${saved}/`, savedEndpoint: saved, apiKey: '', clearKey: false }),
    { baseURL: `${saved}/`, apiKey: '', useSavedKey: true })
  assert.deepEqual(helpers.pingKeyFields({ endpoint: saved, savedEndpoint: saved, apiKey: '', clearKey: true }),
    { baseURL: saved, apiKey: '', useSavedKey: false })
  assert.deepEqual(helpers.pingKeyFields({ endpoint: 'http://other-host/v1', savedEndpoint: saved, apiKey: 'sk-typed', clearKey: false }),
    { baseURL: 'http://other-host/v1', apiKey: 'sk-typed', useSavedKey: false })
  // Every ping the settings page sends states whether the saved key may be used.
  const pings = [...source.matchAll(/call\('ping', ([^\n]*)/g)].map((match) => match[1])
  const settingsPings = pings.filter((text) => !text.startsWith('request'))
  assert.ok(settingsPings.length >= 4)
  for (const text of settingsPings) assert.match(text, /(detectKeyFields|verifyKeyFields|pingKeyFields)\(/, text)
  for (const header of ['const detectKeyFields = ', 'const verifyKeyFields = ']) {
    const at = source.indexOf(header)
    assert.ok(at >= 0, header)
    assert.match(source.slice(at, at + 400), /pingKeyFields\(\{[^]*clearKey/)
  }
  // The model list is fetched again when "clear the saved key" is toggled.
  assert.match(source, /source: `\$\{endpoint\.trim\(\)\}\|\$\{apiKey\}\|\$\{clearKey\}`/)
})

function keyListener() {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push(req.headers.authorization ?? null)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'm' }] }))
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/v1` })))
}

await check('#45 server: ping to an unsaved endpoint, or with "clear" checked, never sends the saved key', async () => {
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  const other = await keyListener()
  const home = await keyListener()
  try {
    const svc = createService({ config: { baseURL: home.url, apiKey: 'sk-SAVED-SECRET', verifyApiKey: 'sk-VERIFY-SECRET', verifyBaseURL: '' }, defaultDirectory: tmp })
    // Typed endpoint, empty key field (old client: no flag at all).
    assert.equal((await svc.ping({ baseURL: other.url, apiKey: '' })).ok, true)
    // New client flag.
    await svc.ping({ baseURL: other.url, apiKey: '', useSavedKey: false })
    // Verify picker on an unsaved verify endpoint.
    await svc.ping({ baseURL: other.url, apiKey: '', keySource: 'verify' })
    await svc.ping({ baseURL: other.url, apiKey: '', keySource: 'verify', useSavedKey: false })
    assert.deepEqual(other.seen.filter((value) => value && /SECRET/.test(value)), [], JSON.stringify(other.seen))
    // A typed key is sent as typed.
    await svc.ping({ baseURL: other.url, apiKey: 'sk-typed', useSavedKey: false })
    assert.equal(other.seen.at(-1), 'Bearer sk-typed')

    // Saved endpoint: the saved key is used unless "clear" is checked.
    await svc.ping({ baseURL: home.url, apiKey: '' })
    assert.equal(home.seen.at(-1), 'Bearer sk-SAVED-SECRET')
    await svc.ping({ baseURL: `${home.url}/`, apiKey: '', useSavedKey: true })
    assert.equal(home.seen.at(-1), 'Bearer sk-SAVED-SECRET')
    await svc.ping({ baseURL: home.url, apiKey: '', useSavedKey: false })
    assert.equal(home.seen.at(-1), null)
    // The dashboard probe (saved config, no baseURL) keeps working.
    await svc.ping({})
    assert.equal(home.seen.at(-1), 'Bearer sk-SAVED-SECRET')
    // Verify on the saved (detection) endpoint: its own saved key.
    await svc.ping({ baseURL: home.url, apiKey: '', keySource: 'verify' })
    assert.equal(home.seen.at(-1), 'Bearer sk-VERIFY-SECRET')
  } finally {
    other.server.close()
    home.server.close()
  }
})

// ── #43: records-based views wait for the records and retry failures ───────

await check('#43 review/compare/advice are only fetched once the batch is no longer the active one', () => {
  assert.equal(helpers.recordsRunId(null, null), null)
  assert.equal(helpers.recordsRunId({ id: 'a', status: 'running' }, 'a'), null)
  // Status already final but the batch still finishing (report.json not yet written).
  assert.equal(helpers.recordsRunId({ id: 'a', status: 'review' }, 'a'), null)
  assert.equal(helpers.recordsRunId({ id: 'a', status: 'completed' }, 'a'), null)
  assert.equal(helpers.recordsRunId({ id: 'a', status: 'review' }, null), 'a')
  assert.equal(helpers.recordsRunId({ id: 'a', status: 'completed' }, 'b'), 'a')
  assert.match(source, /const adviceRunId = recordsRunId\(current, activeRunId\)/)
})

await check('#43 a failed load is retried with back-off and never cached as a final null right away', () => {
  const delays = [1, 2, 3, 4, 5].map((tries) => helpers.recordsRetryDelay(tries))
  for (const delay of delays) assert.ok(Number.isFinite(delay) && delay > 0 && delay <= 30000)
  for (let i = 1; i < delays.length; i += 1) assert.ok(delays[i] >= delays[i - 1])
  assert.equal(helpers.recordsRetryDelay(6), null)
  for (const header of ['const loadReview = React.useCallback(', 'async function loadCompareList(']) {
    const body = functionBody(header)
    assert.equal(/catch\s*\{\s*set\w+\(\(map\) => \(\{ \.\.\.map, \[id\]: null \}\)\)/.test(body), false, `${header} caches null on failure`)
    assert.match(body, /recordFailed\(/)
  }
  const adviceAt = source.indexOf("call('advice', { runId: ")
  assert.ok(adviceAt >= 0)
  const adviceEffect = source.slice(adviceAt - 300, adviceAt + 400)
  assert.match(adviceEffect, /recordFailed\(/)
  assert.match(adviceEffect, /recordsRetry/)
})

// ── #44: no vault-writing review decisions while a batch runs ──────────────

await check('#44 the "replace" decision is disabled while any batch runs, with a visible reason', () => {
  const start = source.indexOf("decideReview(file, item, 'replace')")
  const button = source.slice(source.lastIndexOf("h('button', {", start), start)
  assert.match(button, /disabled:[^\n]*anyRunning/)
  assert.ok(zh['ws.rv.runningHint'] && en['ws.rv.runningHint'])
  assert.match(source.slice(start - 400, start + 200), /ws\.rv\.runningHint/)
  // decideReview refuses as well (the button may be stale) and shows the server's refusal as a note.
  const body = functionBody('async function decideReview(')
  assert.match(body, /action === 'replace' && anyRunning/)
  assert.match(body, /setReviewNote\(\{ ok: false, text: message\(cause\) \}\)/)
})

// ── #59: report text belongs to its batch ──────────────────────────────────

await check('#59 the report cache is keyed by batch, so falling back to an earlier batch shows its report', () => {
  const cache = helpers.createReportCache(3)
  cache.set('Y', '# report Y')
  cache.set('X', '# report X')
  cache.forget('X')
  assert.equal(cache.get('Y'), '# report Y')
  assert.equal(cache.has('X'), false)
  assert.equal(cache.get('X'), undefined)
  cache.set('A', 'a'); cache.set('B', 'b'); cache.set('C', 'c')
  assert.equal(cache.has('Y'), false, 'oldest entry evicted beyond the limit')
  assert.equal(cache.get('C'), 'c')
  // A fetch that finishes after the view moved on still lands under its own id.
  assert.equal(/setReportText\(/.test(source), false, 'single report slot still in use')
  assert.match(source, /const reportText = \(current && reportCache\.current\.get\(current\.id\)\) \?\? ''/)
})

// ── #60: bulk review reloads the open comparison file ──────────────────────

await check('#60 bulk review re-fetches the selected comparison file instead of leaving it on "loading"', () => {
  const body = functionBody('async function bulkReview(')
  assert.match(body, /loadCompareFile\(adviceRunId, compareSel, true\)/)
  assert.ok(body.indexOf('setCompareFiles({})') < body.indexOf('loadCompareFile(adviceRunId, compareSel, true)'))
})

// ── #61: clearing all records while a batch runs ───────────────────────────

await check('#61 "clear all records" during a running batch drops a selection that pointed at a deleted run', () => {
  const body = functionBody('async function confirmDelete(')
  const allBranch = body.slice(body.indexOf('if (deleting.all)'), body.indexOf('} else {'))
  assert.match(allBranch, /selectedId !== activeRunId/)
  assert.match(allBranch, /setSelectedId\(null\)/)
  assert.equal(/if \(!activeRunId\) \{ setSelectedId\(null\)/.test(allBranch), false)
})

await rm(tmp, { recursive: true, force: true })
if (failures) {
  console.log(`\n${failures} failing`)
  process.exit(1)
}
console.log('\nPASS')
