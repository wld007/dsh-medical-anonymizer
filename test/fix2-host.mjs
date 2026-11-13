/**
 * Regression tests for the host group of review findings:
 * #36/#48 (vault writers race: undo / review replace during a batch on the
 * same root, last-writer-wins saves), #41/#46 (request timeouts are not
 * classified, so batches are never split), #42 (vault passphrase: plaintext
 * vault stays plaintext, no re-key), #52 (config save / reapply orphans a
 * batch), #53 (saved API keys sent to typed endpoints), #54 (listModels
 * ignores HTTP status), #55 (status/report/undo after a restart), #56
 * (/anonymize paths with spaces).
 * Run: node test/fix2-host.mjs
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile, rm, mkdir, writeFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createService } from '../lib/service.js'
import { createLlm } from '../lib/llm.js'
import { runBatch } from '../lib/pipeline.js'
import { Vault } from '../lib/pseudonym.js'
import { apply } from '../index.js'
import { reviewFilesOf, pathMapOf, compareTextOf, recordsOf } from './records-read.mjs'
import { vaultOf } from './records-read.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'fix2-host')

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(predicate, ms = 8000, what = 'condition') {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await predicate()) return
    await sleep(25)
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function waitIdle(service, ms = 15000) {
  await until(() => !service.isRunning(), ms, 'batch to finish')
}

// ── Local OpenAI-compatible endpoint with several personalities ──────────

const NAMES = ['王小明', '李晓红', '赵建华', '孙丽娟', '周国平', '吴海燕', '郑志强', '冯雪梅']
const auth = new Map() // prefix -> [authorization headers]
const hits = new Map()
const gate = { open: false, pending: [], hits: 0 }

function segmentsOf(content) {
  const marker = content.lastIndexOf('段落：')
  if (marker === -1) return []
  try { return JSON.parse(content.slice(marker + 3)) } catch { return [] }
}

function reply(res, json) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ model: 'm', choices: [{ message: { role: 'assistant', content: JSON.stringify(json) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
}

const EMPTY = { e: [], issues: [], verdicts: [], fields: [] }

const server = http.createServer((req, res) => {
  const prefix = '/' + (req.url.split('/')[1] ?? '')
  if (!auth.has(prefix)) auth.set(prefix, [])
  auth.get(prefix).push(req.headers.authorization ?? null)
  hits.set(prefix, (hits.get(prefix) ?? 0) + 1)
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const isModels = req.method === 'GET' && req.url.endsWith('/models')
    if (isModels) {
      const code = { '/s401': 401, '/s403': 403, '/s500': 500, '/s404': 404 }[prefix]
      if (code) {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-SAVED-SECRET' } }))
        return
      }
      if (prefix === '/html') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html>hello</html>')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'm' }, { id: 'n' }] }))
      return
    }
    let content = ''
    try { content = JSON.parse(body).messages.map((message) => message.content).join('\n') } catch { /* below */ }
    if (prefix === '/slow') return // never answers
    if (prefix === '/gate') {
      gate.hits += 1
      if (gate.open) reply(res, EMPTY)
      else gate.pending.push(res)
      return
    }
    if (prefix === '/split') {
      const segments = segmentsOf(content)
      if (content.includes('任务：找出')) {
        // A large detection batch takes "too long"; small ones answer.
        if (segments.length > 2) return
        const e = []
        for (const segment of segments) for (const name of NAMES) if (String(segment.text).includes(name)) e.push([segment.id, '姓名', name])
        reply(res, { e })
        return
      }
      reply(res, EMPTY)
      return
    }
    reply(res, EMPTY)
  })
})

function openGate() {
  gate.open = true
  for (const res of gate.pending.splice(0)) reply(res, EMPTY)
}

let base = ''
const url = (prefix) => `${base}/${prefix}/v1`

// ── Harness that applies index.js with a fake Cordis context ─────────────

function harness({ config = {}, profileDir, defaultDirectory, editor = null }) {
  process.env.DSH_PROFILE_DIR = profileDir
  const disposers = []
  const state = { route: null, command: null, tools: {} }
  const sub = {
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    webServer: { register(route) { state.route = route; return () => {} } },
    connection: { admit() { return {} } },
    commands: { register(command) { state.command = command; return () => {} } },
  }
  const fiber = {}
  const ctx = {
    fiber,
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory }
      if (name === 'configEditor') return editor
      return undefined
    },
    tools: { register(tool) { state.tools[tool.name] = tool } },
    inject(deps, fn) { fn(sub) },
    effect: sub.effect,
  }
  apply(ctx, config)
  async function rpc(method, payload = {}) {
    const envelope = JSON.stringify({ type: 'client-request', method, rpcId: 'r1', payload })
    const req = {
      method: 'POST',
      url: `/medical-anonymizer/${method}`,
      headers: { 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(envelope) },
    }
    let out = ''
    const res = { writeHead() {}, end(text) { out = text ?? '' } }
    await state.route.handler(req, res)
    const result = JSON.parse(out).result
    if (!result.ok) throw new Error(result.error?.message ?? 'rpc failed')
    return result.value
  }
  return {
    fiber,
    rpc,
    command: (rawInput) => state.command.handler({ rawInput }),
    tool: (name, args = {}) => state.tools[name].execute(args, {}),
    dispose() { for (const dispose of disposers.splice(0)) dispose() },
  }
}

/** A config editor that re-applies the plugin like the Harness does. */
function reapplyingEditor({ profileDir, defaultDirectory, config, gateEdit = null, fail = false }) {
  const holder = { current: null, config: { ...config }, edits: 0 }
  const editor = {
    entries: () => [{ fiber: holder.current.fiber, options: { id: 'medical-anonymizer' } }],
    async edit(entry, fn) {
      holder.edits += 1
      if (gateEdit) await gateEdit
      if (fail) throw new Error('profile is read-only')
      holder.config = fn(holder.config)
      holder.current.dispose()
      holder.current = harness({ config: holder.config, profileDir, defaultDirectory, editor })
    },
  }
  holder.current = harness({ config: holder.config, profileDir, defaultDirectory, editor })
  return holder
}

async function vaultFile(root) {
  return vaultOf(root)
}

/** Raw bytes of a vault database (and its WAL), to see what is stored in the clear. */
async function vaultBytes(dbFile) {
  const parts = []
  for (const file of [dbFile, `${dbFile}-wal`]) parts.push(await readFile(file).catch(() => Buffer.alloc(0)))
  return Buffer.concat(parts)
}

// ── #41 / #46 timeouts ────────────────────────────────────────────────────

async function testTimeouts() {
  await check('#41 超时的请求归类为 timeout，不按原大小重试', async () => {
    const llm = createLlm({ baseURL: url('slow'), model: 'm', timeoutMs: 300 })
    const before = hits.get('/slow') ?? 0
    const started = Date.now()
    const error = await llm.chatJson([{ role: 'user', content: 'x' }]).then(() => null, (caught) => caught)
    assert.ok(error, 'expected a rejection')
    assert.equal(error.code, 'timeout', `code ${error.code}: ${error.message}`)
    assert.match(error.message, /超时/)
    assert.equal(error.attempts, 1)
    assert.equal((hits.get('/slow') ?? 0) - before, 1)
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`)
  })

  await check('#41 用户取消仍是 aborted（不是 timeout）', async () => {
    const llm = createLlm({ baseURL: url('slow'), model: 'm', timeoutMs: 5000 })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const error = await llm.chatJson([{ role: 'user', content: 'x' }], { signal: controller.signal }).then(() => null, (caught) => caught)
    assert.equal(error?.code, 'aborted')
    // Also when the caller aborts with a reason of its own.
    const other = new AbortController()
    setTimeout(() => other.abort(new Error('stop')), 100)
    const error2 = await llm.chat([{ role: 'user', content: 'x' }], { signal: other.signal }).then(() => null, (caught) => caught)
    assert.equal(error2?.code, 'aborted')
  })

  await check('#41 连接失败仍是 network', async () => {
    const llm = createLlm({ baseURL: 'http://127.0.0.1:9/v1', model: 'm', timeoutMs: 2000 })
    const error = await llm.chat([{ role: 'user', content: 'x' }]).then(() => null, (caught) => caught)
    assert.equal(error?.code, 'network')
  })

  await check('#46 超时的识别批次被拆小重发，名字仍被替换', async () => {
    const dir = join(tmp, 'split')
    await mkdir(join(dir, 'in'), { recursive: true })
    // One segment per cell: a detection batch of 10 segments that "times out".
    const rows = NAMES.map((name, index) => `${index + 1},第${index + 1}次随访：${name}自诉头痛好转，继续观察。`)
    await writeFile(join(dir, 'in', 'visits.csv'), `编号,随访记录\n${rows.join('\n')}\n`)
    const llm = createLlm({ baseURL: url('split'), model: 'm', timeoutMs: 400 })
    const run = await runBatch({ inputDir: join(dir, 'in'), outputRoot: join(dir, 'out'), options: { runId: 'split-1', llm, model: 'm', maxRounds: 1, concurrency: 2 } })
    const outputs = []
    async function walk(path) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.name === '_records') continue
        const full = join(path, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (entry.name.endsWith('.csv')) outputs.push(await readFile(full, 'utf8'))
      }
    }
    await walk(join(dir, 'out'))
    assert.equal(outputs.length, 1, `outputs: ${outputs.length}`)
    for (const name of NAMES) assert.ok(!outputs[0].includes(name), `${name} survived`)
    assert.match(outputs[0], /头痛好转/)
    const codes = run.files.flatMap((file) => (file.issues ?? []).map((issue) => issue.code))
    assert.ok(!codes.includes('model-error'), `issues: ${codes.join(',')}`)
    assert.ok(run.callLog.some((entry) => entry.result === 'timeout'), `results: ${run.callLog.map((entry) => entry.result).join(',')}`)
  })

  // A hung endpoint must not be asked ~2n-1 times per batch (each waiting a
  // full timeout) by halving every timed-out batch down to single segments.
  for (const [label, count, concurrency] of [['60 行', 60, 2], ['150 行', 150, 3], ['12 行', 12, 1]]) {
    await check(`#46 端点不应答时超时拆分有上限（${label}）`, async () => {
      const dir = join(tmp, `hang-${count}`)
      await mkdir(join(dir, 'in'), { recursive: true })
      const rows = Array.from({ length: count }, (_, i) => `${i + 1},第${i + 1}次随访：患者自诉头痛好转，继续观察，血压 1${i % 10}0/80。`)
      await writeFile(join(dir, 'in', 'v.csv'), `编号,随访记录\n${rows.join('\n')}\n`)
      const llm = createLlm({ baseURL: url('slow'), model: 'm', timeoutMs: 200 })
      const before = hits.get('/slow') ?? 0
      const run = await runBatch({ inputDir: join(dir, 'in'), outputRoot: join(dir, 'out'), options: { runId: `hang-${count}`, llm, model: 'm', maxRounds: 1, concurrency } })
      const requests = (hits.get('/slow') ?? 0) - before
      const batches = Math.ceil(count / 60)
      // Before: about 2 × segments requests. Now: the batches plus a small,
      // fixed number of timeout splits per file and stage.
      assert.ok(requests <= 4 * batches + 30, `requests ${requests}`)
      assert.equal(run.status, 'review')
      const codes = run.files.flatMap((file) => (file.issues ?? []).map((issue) => issue.code))
      assert.ok(codes.includes('model-unchecked') || codes.includes('model-error'), `issues: ${codes.join(',')}`)
    })
  }
}

// ── #54 listModels status ─────────────────────────────────────────────────

async function testListModels() {
  const service = createService({ config: { baseURL: url('home'), apiKey: 'sk-SAVED-SECRET' }, defaultDirectory: tmp })
  await check('#54 401/403/404/500 时测试连接报失败，且不回显响应体', async () => {
    for (const [prefix, status] of [['s401', 401], ['s403', 403], ['s404', 404], ['s500', 500]]) {
      const result = await service.ping({ baseURL: url(prefix), apiKey: 'sk-typed' })
      assert.equal(result.ok, false, `${prefix}: ${JSON.stringify(result)}`)
      assert.match(result.error, new RegExp(String(status)))
      assert.ok(!result.error.includes('sk-SAVED-SECRET'), 'body echoed')
    }
    const auth401 = await service.ping({ baseURL: url('s401'), apiKey: 'sk-typed' })
    assert.match(auth401.error, /API Key/)
  })
  await check('#54 非 JSON 的 200 响应报失败；正常列表照常返回', async () => {
    const html = await service.ping({ baseURL: url('html'), apiKey: 'k' })
    assert.equal(html.ok, false)
    const good = await service.ping({ baseURL: url('home') })
    assert.deepEqual(good, { ok: true, models: ['m', 'n'] })
  })
}

// ── #53 key scoping ───────────────────────────────────────────────────────

async function testKeyScoping() {
  const service = createService({
    config: { baseURL: url('home'), apiKey: 'sk-SAVED', verifyBaseURL: url('verify'), verifyModel: 'v', verifyApiKey: 'sk-VERIFY' },
    defaultDirectory: tmp,
  })
  const last = (prefix) => auth.get(prefix)?.at(-1)
  await check('#53 测试其他端点时不发送已保存的 Key', async () => {
    await service.ping({ baseURL: url('other'), apiKey: '' })
    assert.equal(last('/other'), null)
    await service.ping({ baseURL: url('other'), keySource: 'verify' })
    assert.equal(last('/other'), null)
    await service.ping({ baseURL: `${base}/other`, model: 'x' })
    assert.equal(last('/other'), null)
  })
  await check('#53 保存的端点（含末尾斜杠、大小写主机名）仍使用保存的 Key', async () => {
    await service.ping({ baseURL: `${url('home')}/`, apiKey: '' })
    assert.equal(last('/home'), 'Bearer sk-SAVED')
    await service.ping({ baseURL: url('home').replace('127.0.0.1', '127.0.0.1') })
    assert.equal(last('/home'), 'Bearer sk-SAVED')
    await service.ping({})
    assert.equal(last('/home'), 'Bearer sk-SAVED')
    await service.ping({ baseURL: url('verify'), keySource: 'verify' })
    assert.equal(last('/verify'), 'Bearer sk-VERIFY')
    // Explicitly typed keys are sent where the user typed them.
    await service.ping({ baseURL: url('other'), apiKey: 'sk-typed' })
    assert.equal(last('/other'), 'Bearer sk-typed')
  })
  await check('#53 useSavedKey:false（勾选清除 Key）时不发送保存的 Key', async () => {
    await service.ping({ baseURL: url('home'), useSavedKey: false })
    assert.equal(last('/home'), null)
    await service.ping({ baseURL: url('verify'), keySource: 'verify', useSavedKey: false })
    assert.equal(last('/verify'), null)
  })
  await check('#53 /anonymize --endpoint 指向其他服务器时，识别与核验都不带保存的 Key', async () => {
    const dir = join(tmp, 'keys')
    await mkdir(join(dir, 'in'), { recursive: true })
    await writeFile(join(dir, 'in', 'a.txt'), '随访记录：头痛好转。\n')
    // No separate verify endpoint: the verifier follows the batch endpoint.
    const svc = createService({ config: { baseURL: url('home'), apiKey: 'sk-SAVED', verifyModel: 'v', verifyApiKey: 'sk-VERIFY' }, defaultDirectory: dir })
    auth.set('/adhoc', [])
    await svc.start({ inputDir: join(dir, 'in'), baseURL: url('adhoc'), model: 'm', maxRounds: 1 })
    await waitIdle(svc)
    const sent = auth.get('/adhoc')
    assert.ok(sent.length >= 2, `calls ${sent.length}`)
    assert.deepEqual([...new Set(sent)], [null])
  })
}

// ── #36 / #48 vault races ─────────────────────────────────────────────────

async function testVaultMerge() {
  const dir = join(tmp, 'merge')
  await mkdir(dir, { recursive: true })
  for (const passphrase of ['', 'correct horse battery']) {
    const label = passphrase ? '（加密）' : ''
    await check(`#48 两个实例先后保存，彼此新增的映射都保留${label}`, async () => {
      const file = join(dir, `v${passphrase ? 'e' : 'p'}.json`)
      await rm(file, { force: true })
      const seed = new Vault(file, passphrase)
      await seed.load()
      seed.token('姓名', '张三')
      await seed.save()
      const a = new Vault(file, passphrase)
      const b = new Vault(file, passphrase)
      await a.load()
      await b.load()
      const wang = b.token('姓名', '王五')
      await b.save()
      a.token('姓名', '李四')
      await a.save()
      const check = new Vault(file, passphrase)
      await check.load()
      const originals = [...check.entries.values()].map((entry) => entry.original).sort()
      assert.deepEqual(originals, ['张三', '李四', '王五'].sort())
      assert.equal(check.token('姓名', '王五'), wang)
    })
  }
  await check('#48 合并时不会把本实例删除的映射带回来', async () => {
    const file = join(dir, 'forget.json')
    await rm(file, { force: true })
    const seed = new Vault(file)
    await seed.load()
    seed.runId = 'run-a'
    seed.token('姓名', '张三')
    seed.runId = 'run-b'
    seed.token('姓名', '赵六')
    await seed.save()
    const a = new Vault(file)
    const b = new Vault(file)
    await a.load()
    await b.load()
    b.token('电话', '13800138000')
    await b.save()
    assert.equal(a.forgetRun('run-a'), 1)
    await a.save()
    const check = new Vault(file)
    await check.load()
    const originals = [...check.entries.values()].map((entry) => entry.original).sort()
    assert.deepEqual(originals, ['13800138000', '赵六'].sort())
  })
}

async function testVaultBusy() {
  const dir = join(tmp, 'busy')
  for (const name of ['a', 'b', 'c']) await mkdir(join(dir, name), { recursive: true })
  await writeFile(join(dir, 'a', 'note.txt'), '患者姓名：张三，联系电话 13800138000。随访时李四陪同。\n')
  await writeFile(join(dir, 'b', 'note.txt'), '患者姓名：王五，联系电话 13900139000。\n')
  await writeFile(join(dir, 'c', 'note.txt'), '患者姓名：赵六。\n')
  const root = join(dir, '_medical-anonymizer')
  // Rules only by default; batch B goes through the gated endpoint.
  // Both instances share the plugin's state dir, as a reapply does.
  const stateDir = join(dir, 'state')
  const svc = createService({ config: { baseURL: url('gate') }, defaultDirectory: dir, stateDir })
  const a = await svc.start({ inputDir: join(dir, 'a') })
  await waitIdle(svc)
  const aRun = (await svc.status(a.runId)).run
  assert.equal(aRun.status, 'completed', JSON.stringify(aRun.status))
  const aMappings = (await vaultFile(root)).entries.filter((entry) => entry.runId === a.runId).length
  assert.ok(aMappings >= 2, `A mappings ${aMappings}`)
  // A review item for A (an unlabeled name the rules kept), as the verifier would report it.
  const runDir = join(root, '_records', 'runs', a.runId)
  const relPath = aRun.files[0].relPath
  await (await recordsOf(root)).putReviewFiles(a.runId, [{ relPath, items: [{ id: 'x1', code: 'model-residual', type: '姓名', text: '李四', detail: '独立盲审报出：姓名 李*' }] }])

  gate.open = false
  const hitsBefore = gate.hits
  const b = await svc.start({ inputDir: join(dir, 'b'), model: 'm', maxRounds: 1 })
  await until(() => gate.hits > hitsBefore, 8000, 'batch B to call the model')

  await check('#36 同一输出根有批次运行时，撤销映射被拒绝并说明原因', async () => {
    await assert.rejects(svc.undoMappings(a.runId), /正在运行|在运行/)
  })
  await check('#36 同一输出根有批次运行时，复核「替换」被拒绝', async () => {
    await assert.rejects(svc.reviewDecide(a.runId, 'x1', 'replace'), /在运行/)
  })
  await check('#36 另一个服务实例（重新加载后）也不能在同一输出根上启动批次', async () => {
    const other = createService({ config: {}, defaultDirectory: dir, stateDir })
    await assert.rejects(other.start({ inputDir: join(dir, 'c') }), /正被批次|在运行/)
    assert.equal(other.isRunning(), false)
    await assert.rejects(other.undoMappings(a.runId), /在运行/)
  })
  openGate()
  await waitIdle(svc)
  assert.equal((await svc.status(b.runId)).run.status, 'completed')

  await check('#36 批次结束后撤销生效，且不会被随后的保存还原', async () => {
    const undone = await svc.undoMappings(a.runId)
    assert.equal(undone.removed, aMappings)
    const c = await svc.start({ inputDir: join(dir, 'c') })
    await waitIdle(svc)
    assert.equal((await svc.status(c.runId)).run.status, 'completed')
    const left = (await vaultFile(root)).entries.filter((entry) => entry.runId === a.runId).length
    assert.equal(left, 0)
  })
  await check('#36 批次结束后复核「替换」成功，映射留在映射库里', async () => {
    const result = await svc.reviewDecide(a.runId, 'x1', 'replace')
    assert.equal(result.decision.action, 'replace')
    const vault = await vaultFile(root)
    const entry = vault.entries.find((item) => item.original === '李四')
    assert.ok(entry, 'mapping missing')
    assert.equal(entry.pseudonym, result.decision.replacement)
  })
}

// Undo and review "replace" hold the root for their whole vault load-to-save
// span: a batch start or another vault writer on the same root in that span
// is refused, never silently reverting the undo.
async function testUndoHold() {
  const dir = join(tmp, 'undo-hold')
  const sources = async (at, files) => {
    await mkdir(join(at, 'a'), { recursive: true })
    await mkdir(join(at, 'b'), { recursive: true })
    await writeFile(join(at, 'a', 'x.txt'), '患者电话 13812345678，身份证 110101199003074514。\n')
    for (let i = 0; i < files; i += 1) await writeFile(join(at, 'b', `y${i}.txt`), `患者电话 139000${String(i).padStart(5, '0')}。\n`.repeat(20))
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const left = async (out, runId) => (await vaultFile(out)).entries.filter((entry) => entry.runId === runId).length

  for (const order of ['batch-then-undo', 'undo-then-batch']) {
    await check(`#36 撤销映射与同一输出根的批次启动交错时，撤销不会被还原（${order}）`, async () => {
      let effective = 0
      for (let ticks = 0; ticks <= 40; ticks += 2) {
        const at = join(dir, order, String(ticks))
        await rm(at, { recursive: true, force: true })
        await sources(at, 12)
        const out = join(at, 'out')
        const service = createService({ config: { baseURL: '', model: '', outputRoot: out }, defaultDirectory: at, stateDir: join(at, 'state') })
        const first = await service.start({ inputDir: join(at, 'a') })
        await waitIdle(service)
        const before = await left(out, first.runId)
        assert.ok(before >= 2, `A mappings ${before}`)
        let undo
        let batch
        if (order === 'batch-then-undo') {
          batch = service.start({ inputDir: join(at, 'b') }).then(() => true, (error) => { assert.match(error.message, /撤销映射|映射库/); return false })
          for (let i = 0; i < ticks; i += 1) await tick()
          undo = service.undoMappings(first.runId).then((result) => result, (error) => { assert.match(error.message, /在运行|正在/); return null })
        } else {
          undo = service.undoMappings(first.runId).then((result) => result, (error) => { assert.match(error.message, /在运行|正在/); return null })
          for (let i = 0; i < ticks; i += 1) await tick()
          batch = service.start({ inputDir: join(at, 'b') }).then(() => true, (error) => { assert.match(error.message, /撤销映射|映射库/); return false })
        }
        const [undone] = await Promise.all([undo, batch])
        await waitIdle(service)
        if (undone) {
          assert.equal(undone.removed, before)
          assert.equal(await left(out, first.runId), 0, `ticks ${ticks}: undo reported ${undone.removed} removed, but the mappings are back`)
          effective += 1
        } else {
          assert.equal(await left(out, first.runId), before)
        }
      }
      assert.ok(effective > 0, 'no undo ever ran')
    })
  }

  await check('#36 同一输出根上两个撤销同时进行：报告成功的撤销都真正生效', async () => {
    const at = join(dir, 'two-undos')
    await rm(at, { recursive: true, force: true })
    await sources(at, 1)
    const out = join(at, 'out')
    const service = createService({ config: { baseURL: '', model: '', outputRoot: out }, defaultDirectory: at, stateDir: join(at, 'state') })
    const r1 = await service.start({ inputDir: join(at, 'a') })
    await waitIdle(service)
    const r2 = await service.start({ inputDir: join(at, 'b') })
    await waitIdle(service)
    const results = await Promise.allSettled([service.undoMappings(r1.runId), service.undoMappings(r2.runId)])
    assert.ok(results.some((result) => result.status === 'fulfilled'), 'both undos refused')
    for (const [index, result] of results.entries()) {
      const id = [r1.runId, r2.runId][index]
      if (result.status === 'fulfilled') assert.equal(await left(out, id), 0, `${id} reported removed=${result.value.removed} but is still in the vault`)
      else assert.match(result.reason.message, /撤销映射|正在/)
    }
    // Retried one by one, both end up gone.
    await service.undoMappings(r1.runId)
    await service.undoMappings(r2.runId)
    assert.equal(await left(out, r1.runId), 0)
    assert.equal(await left(out, r2.runId), 0)
  })

  await check('#36 撤销映射与复核「替换」同时进行：报告成功的操作都保留', async () => {
    const at = join(dir, 'undo-replace')
    await rm(at, { recursive: true, force: true })
    await sources(at, 1)
    await writeFile(join(at, 'b', 'y0.txt'), '患者电话 13900000000。随访时李四陪同。\n')
    const out = join(at, 'out')
    const service = createService({ config: { baseURL: '', model: '', outputRoot: out }, defaultDirectory: at, stateDir: join(at, 'state') })
    const r1 = await service.start({ inputDir: join(at, 'a') })
    await waitIdle(service)
    const r2 = await service.start({ inputDir: join(at, 'b') })
    await waitIdle(service)
    const r2Run = (await service.status(r2.runId)).run
    const runDir = join(out, '_records', 'runs', r2.runId)
    await (await recordsOf(out)).putReviewFiles(r2.runId, [{ relPath: r2Run.files[0].relPath, items: [{ id: 'x1', code: 'model-residual', type: '姓名', text: '李四', detail: '独立盲审报出：姓名 李*' }] }])
    const [undo, replace] = await Promise.allSettled([service.undoMappings(r1.runId), service.reviewDecide(r2.runId, 'x1', 'replace')])
    assert.ok(undo.status === 'fulfilled' || replace.status === 'fulfilled', 'both refused')
    const vault = await vaultFile(out)
    if (undo.status === 'fulfilled') assert.equal(vault.entries.filter((entry) => entry.runId === r1.runId).length, 0, 'undo reverted by replace')
    else assert.match(undo.reason.message, /替换|正在/)
    if (replace.status === 'fulfilled') assert.ok(vault.entries.some((entry) => entry.original === '李四'), 'replace mapping lost')
    else assert.match(replace.reason.message, /撤销映射|正在/)
  })
}

// ── #42 passphrase ────────────────────────────────────────────────────────

async function testPassphrase() {
  const dir = join(tmp, 'pass')
  await mkdir(join(dir, 'in'), { recursive: true })
  await writeFile(join(dir, 'in', 'note.txt'), '患者姓名：张三，联系电话 13800138000。\n')
  const root = join(dir, '_medical-anonymizer')
  const vaultPath = join(root, '_records', 'vault.json')
  const vaultDb = join(root, '_records', 'vault.sqlite')

  await check('#42 启用口令后，即使没有新增映射，映射库也被加密', async () => {
    const plain = createService({ config: {}, defaultDirectory: dir })
    await plain.start({ inputDir: join(dir, 'in') })
    await waitIdle(plain)
    assert.ok(!(await vaultBytes(vaultDb)).includes('aes-256-gcm'))
    assert.ok((await vaultBytes(vaultDb)).includes(Buffer.from('张三')), 'plaintext originals without a passphrase')
    const enc = createService({ config: { vaultPassphrase: 'old-secret-1' }, defaultDirectory: dir })
    const again = await enc.start({ inputDir: join(dir, 'in') })
    await waitIdle(enc)
    assert.equal((await enc.status(again.runId)).run.status, 'completed')
    const raw = await vaultBytes(vaultDb)
    assert.ok(raw.includes('aes-256-gcm'), 'vault still plaintext')
    assert.ok(!raw.includes(Buffer.from('张三')), 'original still readable in the vault file')
  })

  await check('#42 Vault 直接加载明文库再保存（无新增）也会加密', async () => {
    const file = join(dir, 'unit.json')
    const seed = new Vault(file)
    await seed.load()
    seed.token('姓名', '李四')
    await seed.save()
    const vault = new Vault(file, 'another-pass')
    await vault.load()
    await vault.save()
    assert.ok((await vaultBytes(join(dir, 'unit.sqlite'))).includes('aes-256-gcm'))
    assert.ok(!(await vaultBytes(join(dir, 'unit.sqlite'))).includes(Buffer.from('李四')))
  })

  await check('#42 口令不匹配时给出明确的中文提示', async () => {
    const vault = new Vault(vaultPath, 'wrong-secret-9')
    await assert.rejects(vault.load(), /口令不匹配/)
  })

  const profileDir = join(dir, 'profile')
  await check('#42 在设置页修改口令会用新口令重新加密已知映射库', async () => {
    const holder = reapplyingEditor({ profileDir, defaultDirectory: dir, config: { vaultPassphrase: 'old-secret-1' } })
    // A batch through this instance records the root as known.
    await holder.current.rpc('start', { inputDir: join(dir, 'in') })
    await until(async () => !(await holder.current.rpc('list')).active, 15000, 'batch')
    const saved = await holder.current.rpc('saveDefaults', { vaultPassphrase: 'new-secret-2' })
    assert.equal(saved.vaults?.rekeyed, 1)
    assert.equal(saved.vaults?.failed, 0)
    await assert.rejects(new Vault(vaultPath, 'old-secret-1').load(), /口令不匹配/)
    const reread = await new Vault(vaultPath, 'new-secret-2').load()
    assert.ok([...reread.entries.values()].some((entry) => entry.original === '张三'))
    // The re-applied instance runs batches with the new passphrase.
    const next = await holder.current.rpc('start', { inputDir: join(dir, 'in') })
    await until(async () => !(await holder.current.rpc('list')).active, 15000, 'batch')
    assert.equal((await holder.current.rpc('status', { runId: next.runId })).run.status, 'completed')

    // Clearing the passphrase turns the known vault back into plaintext rows.
    const cleared = await holder.current.rpc('saveDefaults', { vaultPassphrase: '' })
    assert.equal(cleared.vaults?.rekeyed, 1)
    const raw = await vaultBytes(vaultDb)
    assert.ok(raw.includes(Buffer.from('张三')) && !raw.includes('aes-256-gcm'))
    assert.ok((await vaultOf(root)).entries.some((entry) => entry.original === '张三'))
    holder.current.dispose()
  })

  await check('#42 保存配置失败时，已重新加密的映射库恢复为原口令', async () => {
    const holder = reapplyingEditor({ profileDir, defaultDirectory: dir, config: { vaultPassphrase: '' }, fail: true })
    await assert.rejects(holder.current.rpc('saveDefaults', { vaultPassphrase: 'never-saved-3' }), /read-only/)
    assert.ok(!(await vaultBytes(vaultDb)).includes('aes-256-gcm'), 'vault should be plaintext again')
    assert.ok((await vaultOf(root)).entries.length > 0)
    holder.current.dispose()
  })
}

// ── #52 reapply while a batch runs ────────────────────────────────────────

async function testReapply() {
  const dir = join(tmp, 'reapply')
  await mkdir(join(dir, 'in'), { recursive: true })
  await writeFile(join(dir, 'in', 'note.txt'), '患者姓名：张三。\n')
  const profileDir = join(dir, 'profile')

  await check('#52 保存配置期间不能启动批次（检查与重新加载之间没有空档）', async () => {
    let releaseEdit
    const gateEdit = new Promise((resolve) => { releaseEdit = resolve })
    const holder = reapplyingEditor({ profileDir, defaultDirectory: dir, config: {}, gateEdit })
    const first = holder.current
    const saving = first.rpc('saveDefaults', { maxRounds: 2 })
    await until(() => holder.edits > 0, 2000, 'edit to begin')
    await assert.rejects(first.rpc('start', { inputDir: join(dir, 'in') }), /保存默认配置/)
    releaseEdit()
    await saving
    assert.notEqual(holder.current, first)
    // The old instance refuses new batches after it was disposed.
    await assert.rejects(first.rpc('start', { inputDir: join(dir, 'in') }), /重新加载/)
    holder.current.dispose()
  })

  await check('#52 插件重新加载时，正在运行的批次被取消，而不是在旧实例里继续运行', async () => {
    gate.open = false
    const old = harness({ config: { baseURL: url('gate'), model: 'm' }, profileDir, defaultDirectory: dir })
    const hitsBefore = gate.hits
    const started = await old.rpc('start', { inputDir: join(dir, 'in'), maxRounds: 1 })
    await until(() => gate.hits > hitsBefore, 8000, 'model call')
    old.dispose() // what an external reapply does
    await until(async () => (await old.rpc('status', { runId: started.runId })).run?.status !== 'running', 5000, 'batch to stop')
    assert.equal((await old.rpc('status', { runId: started.runId })).run.status, 'cancelled')
    // A fresh instance sees the batch on disk.
    const fresh = harness({ config: {}, profileDir, defaultDirectory: dir })
    const status = await fresh.rpc('status', { runId: started.runId })
    assert.equal(status.run?.status, 'cancelled')
    fresh.dispose()
    openGate()
  })
}

// ── #55 after a restart ───────────────────────────────────────────────────

async function testRestart() {
  const dir = join(tmp, 'restart')
  await mkdir(join(dir, 'in'), { recursive: true })
  await writeFile(join(dir, 'in', 'note.txt'), '患者姓名：张三，联系电话 13800138000。\n')
  const stateDir = join(dir, 'state')
  const s1 = createService({ config: {}, defaultDirectory: dir, stateDir })
  const { runId } = await s1.start({ inputDir: join(dir, 'in') })
  await waitIdle(s1)

  await check('#55 重启后 status 能找到批次（不需要先 list）', async () => {
    const s2 = createService({ config: {}, defaultDirectory: dir, stateDir })
    const { run } = await s2.status(runId)
    assert.equal(run?.id, runId)
  })
  await check('#55 重启后省略 runId 时取最近一批', async () => {
    const s2 = createService({ config: {}, defaultDirectory: dir, stateDir })
    assert.equal((await s2.status()).run?.id, runId)
    assert.equal((await s2.report()).runId, runId)
  })
  await check('#55 重启后 report 能读到报告', async () => {
    const s2 = createService({ config: {}, defaultDirectory: dir, stateDir })
    const report = await s2.report(runId)
    assert.match(report.markdown, /#/)
  })
  await check('#55 重启后 calls / advice 能读到记录', async () => {
    const s2 = createService({ config: {}, defaultDirectory: dir, stateDir })
    const calls = await s2.calls(runId)
    assert.ok(Array.isArray(calls.entries))
    await s2.advice(runId)
  })
  await check('#55 重启后 undoMappings 能撤销', async () => {
    const s2 = createService({ config: {}, defaultDirectory: dir, stateDir })
    const result = await s2.undoMappings(runId)
    assert.ok(result.removed >= 2, `removed ${result.removed}`)
  })
  await check('#55 不合法的批次 id 不会拼进路径', async () => {
    const s2 = createService({ config: {}, defaultDirectory: dir, stateDir })
    await assert.rejects(s2.report('../../etc'), /不正确/)
    await assert.rejects(s2.undoMappings('../x'), /不正确/)
    assert.equal((await s2.status('../x')).run, null)
  })
}

// ── #56 /anonymize argument parsing ───────────────────────────────────────

async function testCommand() {
  const dir = join(tmp, 'cmd')
  const spaced = join(dir, 'Patient Records')
  const doubled = join(dir, 'Two  Spaces')
  await mkdir(spaced, { recursive: true })
  await mkdir(doubled, { recursive: true })
  await writeFile(join(spaced, 'note.txt'), '患者姓名：张三。\n')
  await writeFile(join(doubled, 'note.txt'), '患者姓名：李四。\n')
  const profileDir = join(dir, 'profile')
  const host = harness({ config: {}, profileDir, defaultDirectory: dir })
  const svcWait = async () => {
    await until(async () => !(await host.rpc('list')).active, 15000, 'batch')
  }

  await check('#56 解析：引号、反斜杠转义、未加引号的空格路径', async () => {
    const { parseAnonymizeArgs } = await import('../lib/command.js')
    assert.deepEqual(parseAnonymizeArgs('"/data/Patient Records" --rounds 2'), { inputDir: '/data/Patient Records', options: { maxRounds: 2 } })
    assert.deepEqual(parseAnonymizeArgs("'/data/Patient Records' --no-think"), { inputDir: '/data/Patient Records', options: { disableThinking: true } })
    assert.deepEqual(parseAnonymizeArgs('/data/Patient\\ Records'), { inputDir: '/data/Patient Records', options: {} })
    assert.deepEqual(parseAnonymizeArgs('/data/Patient Records --model qwen3'), { inputDir: '/data/Patient Records', options: { model: 'qwen3' } })
    assert.deepEqual(parseAnonymizeArgs('/a/Two  Spaces'), { inputDir: '/a/Two  Spaces', options: {} })
    assert.deepEqual(parseAnonymizeArgs('/data --output "/out dir" --endpoint http://h/v1'), { inputDir: '/data', options: { outputRoot: '/out dir', baseURL: 'http://h/v1' } })
    assert.deepEqual(parseAnonymizeArgs('  /data  '), { inputDir: '/data', options: {} })
    assert.match(parseAnonymizeArgs('"/data').error, /引号/)
    assert.match(parseAnonymizeArgs('/data --rounds').error, /缺少 --rounds/)
    assert.match(parseAnonymizeArgs('/data --model --no-think').error, /缺少 --model/)
    assert.match(parseAnonymizeArgs('/data --bogus').error, /未知参数 --bogus/)
    assert.equal(parseAnonymizeArgs('').error, 'missing-input')
  })

  await check('#56 /anonymize "<含空格的路径>" 能启动批次', async () => {
    const result = await host.command(`"${spaced}" --rounds 1`)
    assert.equal(result.kind, 'success', result.text)
    assert.ok(result.text.includes(spaced))
    await svcWait()
  })
  await check('#56 /anonymize 不加引号的含空格路径也能启动', async () => {
    const result = await host.command(`${spaced} --no-think`)
    assert.equal(result.kind, 'success', result.text)
    await svcWait()
    const result2 = await host.command(doubled)
    assert.equal(result2.kind, 'success', result2.text)
    assert.ok(result2.text.includes(doubled))
    await svcWait()
  })
  await check('#56 错误参数仍给出用法提示', async () => {
    const result = await host.command(`"${spaced}" --bogus`)
    assert.equal(result.kind, 'error')
    assert.match(result.text, /未知参数 --bogus/)
    assert.match(result.text, /用法/)
    assert.equal((await host.command('')).kind, 'error')
  })
  host.dispose()
}

async function main() {
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  try {
    await testTimeouts()
    await testListModels()
    await testKeyScoping()
    await testVaultMerge()
    await testVaultBusy()
    await testUndoHold()
    await testPassphrase()
    await testReapply()
    await testRestart()
    await testCommand()
  } finally {
    openGate()
    server.closeAllConnections?.()
    server.close()
  }
  if (failures > 0) {
    console.log(`\n${failures} FAILED`)
    process.exit(1)
  }
  console.log('\nFIX2-HOST PASS')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
