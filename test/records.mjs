/**
 * Records store (lib/records.js): SQLite tables, one-time import of the old
 * JSON files, file-layout fallback, permissions and secure deletion.
 * Run: node test/records.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openRecords, closeRecords, useFileRecords, sqliteAvailable, RECORDS_FILE, SCHEMA_VERSION } from '../lib/records.js'
import { isOutputRoot } from '../lib/layout.js'
import { createService } from '../lib/service.js'
import { runBatch } from '../lib/pipeline.js'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'records')

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${name}\n      ${error.stack?.split('\n').slice(0, 4).join('\n      ')}`)
  }
}

await rm(tmp, { recursive: true, force: true })
await mkdir(tmp, { recursive: true })

const hasSqlite = await sqliteAvailable()
if (!hasSqlite) console.log('  --  node:sqlite unavailable: only the file fallback is tested')

const summary = (id, startedAt, extra = {}) => ({ id, startedAt, finishedAt: null, status: 'completed', files: 1, ...extra })

if (hasSqlite) {
  const dir = join(tmp, 'a', '_records')
  const store = await openRecords(dir)

  await check('记录库：建在 _records/records.sqlite，权限 600（含 -wal）', async () => {
    assert.equal(store.kind, 'sqlite')
    assert.equal(store.path, join(dir, RECORDS_FILE))
    await store.putRun(summary('r1', '2026-01-01T00:00:00Z'))
    assert.equal((await stat(store.path)).mode & 0o777, 0o600)
    assert.equal((await stat(`${store.path}-wal`)).mode & 0o777, 0o600)
    assert.equal(await openRecords(dir), store, 'one open store per directory')
  })

  await check('批次列表：按开始时间倒序，局部更新，删除时各表的行一并删除', async () => {
    await store.putRun(summary('r2', '2026-02-01T00:00:00Z'))
    assert.deepEqual((await store.listRuns()).map((item) => item.id), ['r2', 'r1'])
    await store.patchRun('r1', { status: 'review', output: '/x' })
    assert.deepEqual(await store.getRun('r1'), { ...summary('r1', '2026-01-01T00:00:00Z'), status: 'review', output: '/x' })
    await store.patchRun('none', { status: 'x' })
    assert.equal(await store.getRun('none'), null)
    await store.saveDecisions('r2', { i1: { action: 'accept', at: 't' } })
    await store.appendCalls('r2', [{ stage: 'x' }])
    await store.putDoc('r2', 'advice', { a: 1 })
    assert.equal(await store.deleteRun('r2'), true)
    assert.deepEqual(await store.getDecisions('r2'), {})
    assert.deepEqual(await store.getCalls('r2'), [])
    assert.equal(await store.getDoc('r2', 'advice'), null)
    assert.equal(await store.deleteRun('r2'), false)
  })

  await check('复核裁定：只写变化的项，每次改动另记留痕', async () => {
    assert.equal(await store.saveDecisions('r1', { a: { action: 'accept', at: '1' }, b: { action: 'replace', at: '1', count: 2 } }), 2)
    assert.equal(await store.saveDecisions('r1', { a: { action: 'accept', at: '1' }, b: { action: 'replace', at: '1', count: 2 } }), 0)
    assert.equal(await store.saveDecisions('r1', { a: { action: 'remove', at: '2' }, b: { action: 'replace', at: '1', count: 2 } }), 1)
    assert.deepEqual(await store.getDecisions('r1'), { a: { action: 'remove', at: '2' }, b: { action: 'replace', at: '1', count: 2 } })
    assert.deepEqual((await store.decisionHistory('r1', 'a')).map((entry) => [entry.op, entry.decision.action]), [['set', 'accept'], ['set', 'remove']])
  })

  await check('调用流水：批次写入按 seq，追加时续编号', async () => {
    await store.putCalls('r1', [{ seq: 1, stage: '识别·替换', tokens: 10 }, { seq: 2, stage: '盲审', model: 'm' }])
    const added = await store.appendCalls('r1', [{ stage: '图片识别' }, { stage: '图片识别' }])
    assert.deepEqual(added.map((entry) => entry.seq), [3, 4])
    assert.deepEqual((await store.getCalls('r1')).map((entry) => entry.stage), ['识别·替换', '盲审', '图片识别', '图片识别'])
  })

  await check('交叉核验、图片识别、手工修改、续跑参数', async () => {
    assert.equal(await store.getCrossCheck('r1'), null)
    await store.putCrossCheck('r1', [{ file: 'a', outcome: 'confirmed' }, { file: 'b', outcome: 'dismissed' }])
    await store.putCrossCheck('r1', [{ file: 'c', outcome: 'disputed' }])
    assert.deepEqual(await store.getCrossCheck('r1'), [{ file: 'c', outcome: 'disputed' }])
    await store.putImageChecks('r1', { x: { category: 'seal' } })
    await store.putImageChecks('r1', { y: { category: 'chart' } })
    assert.deepEqual(await store.getImageChecks('r1'), { x: { category: 'seal' }, y: { category: 'chart' } })
    await store.addManualEdit('r1', { at: '1', action: 'revert', pseudonym: '化名-A1', count: 1 })
    await store.addManualEdit('r1', { at: '2', action: 'replace', pseudonym: '化名-B2', count: 3 })
    assert.deepEqual((await store.getManualEdits('r1')).map((entry) => entry.pseudonym), ['化名-A1', '化名-B2'])
    await store.putDoc('r1', 'resume', { inputDir: '/in' })
    assert.deepEqual(await store.getDoc('r1', 'resume'), { inputDir: '/in' })
    await store.deleteDoc('r1', 'resume')
    assert.equal(await store.getDoc('r1', 'resume'), null)
  })

  await check('删除批次后原文不留在库文件里（secure_delete）', async () => {
    const marker = '独一无二的原文标记甲乙丙'
    await store.putRun(summary('gone', '2026-03-01T00:00:00Z'))
    await store.putCrossCheck('gone', [{ file: 'f', text: marker, outcome: 'confirmed' }])
    await store.deleteRun('gone')
    await closeRecords()
    const bytes = await readFile(join(dir, RECORDS_FILE))
    assert.ok(!bytes.includes(Buffer.from(marker)), 'marker still in database file')
    const wal = await readFile(join(dir, `${RECORDS_FILE}-wal`)).catch(() => Buffer.alloc(0))
    assert.ok(!wal.includes(Buffer.from(marker)), 'marker still in WAL')
  })

  await check('关闭后再次使用会重新打开，数据仍在', async () => {
    const again = await openRecords(dir)
    assert.notEqual(again, store)
    assert.equal((await again.getRun('r1')).status, 'review')
  })

  await check('输出根目录只有 records.sqlite 时也被认出', async () => {
    assert.equal(await isOutputRoot(join(tmp, 'a'), 'renamed'), true)
  })

  await check('库版本比插件新时拒绝打开', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const newer = join(tmp, 'newer', '_records')
    await mkdir(newer, { recursive: true })
    const db = new DatabaseSync(join(newer, RECORDS_FILE))
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    db.close()
    await assert.rejects(openRecords(newer), /比本插件新/)
  })

  await check('只读打开：_records 不存在时返回 null，不建目录', async () => {
    assert.equal(await openRecords(join(tmp, 'missing', '_records'), { create: false }), null)
    await assert.rejects(stat(join(tmp, 'missing')))
  })

  // Old layout: index.json and per-run JSON files, imported once.
  const old = join(tmp, 'old', '_records')
  const oldRun = join(old, 'runs', 'o1')
  await mkdir(oldRun, { recursive: true })
  await mkdir(join(old, 'runs', 'o2'), { recursive: true })
  const legacy = {
    'index.json': [summary('o1', '2025-01-01T00:00:00Z'), summary('o2', '2025-02-01T00:00:00Z')],
    'runs/o1/review-decisions.json': { i1: { action: 'accept', at: 't' } },
    'runs/o1/calls.json': [{ seq: 1, stage: '盲审' }, { seq: 2, stage: '图片识别' }],
    'runs/o1/cross-check.json': [{ file: 'a', outcome: 'confirmed' }],
    'runs/o1/image-checks.json': { i2: { category: 'seal' } },
    'runs/o1/manual-edits.json': [{ at: 't', action: 'revert', pseudonym: '化名-X' }],
    'runs/o1/advice.json': { runId: 'o1', suggestions: [] },
    'runs/o1/resume.json': { inputDir: '/in' },
  }
  for (const [rel, value] of Object.entries(legacy)) await writeFile(join(old, rel), JSON.stringify(value))

  await check('旧布局：第一次打开时并入记录库，原文件不动', async () => {
    const imported = await openRecords(old)
    assert.deepEqual((await imported.listRuns()).map((item) => item.id), ['o2', 'o1'])
    assert.deepEqual(await imported.getDecisions('o1'), legacy['runs/o1/review-decisions.json'])
    assert.deepEqual((await imported.decisionHistory('o1', 'i1')).map((entry) => [entry.op, entry.decision.action]), [['import', 'accept']])
    assert.deepEqual(await imported.getCalls('o1'), legacy['runs/o1/calls.json'])
    assert.deepEqual(await imported.getCrossCheck('o1'), legacy['runs/o1/cross-check.json'])
    assert.deepEqual(await imported.getImageChecks('o1'), legacy['runs/o1/image-checks.json'])
    assert.deepEqual(await imported.getManualEdits('o1'), legacy['runs/o1/manual-edits.json'])
    assert.deepEqual(await imported.getDoc('o1', 'advice'), legacy['runs/o1/advice.json'])
    assert.deepEqual(await imported.getDoc('o1', 'resume'), legacy['runs/o1/resume.json'])
    for (const [rel, value] of Object.entries(legacy)) assert.deepEqual(JSON.parse(await readFile(join(old, rel), 'utf8')), value, rel)
  })

  await check('旧布局只并入一次：删除的批次不会因旧文件回来', async () => {
    await (await openRecords(old)).deleteRun('o2')
    await closeRecords()
    assert.deepEqual((await (await openRecords(old)).listRuns()).map((item) => item.id), ['o1'])
  })
  await closeRecords()

  // Service: resume reads the records, the resumed batch is marked in the
  // batch list, and review decisions land in review_decisions.
  const input = join(tmp, 'svc-in')
  const root = join(tmp, 'svc-out')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'note.txt'), '姓名：张三\n联系电话：13800138000\n')
  const stopper = new AbortController()
  stopper.abort()
  const stopped = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'svc-1' }, signal: stopper.signal })
  const service = createService({ config: { model: '', outputRoot: root }, defaultDirectory: tmp })
  await check('服务：续跑参数从记录库读取；续跑完成后旧批次标为已接续、续跑参数删除', async () => {
    assert.equal(stopped.status, 'cancelled')
    const records = await openRecords(join(root, '_records'))
    assert.equal((await records.getDoc('svc-1', 'resume')).inputDir, input)
    assert.equal((await records.getRun('svc-1')).resumable, true)
    const started = await service.start({ resumeFrom: 'svc-1' })
    for (let i = 0; i < 200 && (await service.status(started.runId)).run?.status === 'running'; i += 1) await new Promise((r) => setTimeout(r, 25))
    for (let i = 0; i < 40 && (await records.getDoc('svc-1', 'resume')); i += 1) await new Promise((r) => setTimeout(r, 25))
    assert.equal(await records.getDoc('svc-1', 'resume'), null)
    const previous = await records.getRun('svc-1')
    assert.equal(previous.resumable, false)
    assert.equal(previous.resumedBy, started.runId)
    const listed = (await createService({ config: { model: '', outputRoot: root }, defaultDirectory: tmp }).list()).runs
    assert.deepEqual(listed.map((item) => item.id).sort(), ['svc-1', started.runId].sort())
    await service.deleteRun('svc-1')
    assert.equal(await records.getRun('svc-1'), null)
  })
  await closeRecords()

  // A batch writes its record and per-file results as it goes; a resume
  // takes over finished files whose source is unchanged.
  const ckIn = join(tmp, 'ck-in')
  await mkdir(ckIn, { recursive: true })
  const notes = {
    'a.txt': '姓名：张三\n联系电话：13800138000\n',
    'b.txt': '患者李四，身份证号 11010519491231002X，复诊。\n',
    'c.txt': '联系人王五，电话 13900139000。\n',
  }
  for (const [name, body] of Object.entries(notes)) await writeFile(join(ckIn, name), body)
  // Stops right after the first file is done (one file at a time).
  const stopAfterFirst = async (root, runId) => {
    const controller = new AbortController()
    const run = await runBatch({
      inputDir: ckIn, outputRoot: root, signal: controller.signal,
      options: { runId, concurrency: 1 },
      onEvent: ({ phase }) => { if (phase === 'file-done') controller.abort() },
    })
    return run
  }
  const ckRoot = join(tmp, 'ck-out')
  const first = await stopAfterFirst(ckRoot, 'ck-1')
  const ckStore = await openRecords(join(ckRoot, '_records'))
  const done = await ckStore.getFileResults('ck-1')
  await check('批次运行中逐个记下完成的文件；取消后续跑参数和这些结果都保留', async () => {
    assert.equal(first.status, 'cancelled')
    // Rule-only files are quick: those already started finish before the stop.
    assert.ok(done.size >= 1, `done ${done.size}`)
    assert.equal((await ckStore.getRun('ck-1')).status, 'cancelled')
    assert.equal((await ckStore.getRunDetail('ck-1')).status, 'cancelled')
    assert.equal(await ckStore.getDoc('ck-1', 'live'), null, 'live state dropped at the end')
  })
  const resumed = await runBatch({ inputDir: ckIn, outputRoot: ckRoot, options: { runId: 'ck-2', resumeFrom: 'ck-1' } })
  // A full run on the same root (same vault, same pseudonyms) to compare with.
  const fresh = await runBatch({ inputDir: ckIn, outputRoot: ckRoot, options: { runId: 'ck-0' } })
  await check('续跑：已完成且源文件未变的文件直接沿用，结果与完整运行一致；完成后逐文件结果删除', async () => {
    assert.equal(resumed.status, 'completed')
    assert.equal(resumed.totals.reusedFiles, done.size)
    assert.equal(resumed.totals.files, 3)
    assert.equal(resumed.totals.entities, fresh.totals.entities)
    for (const name of Object.keys(notes)) {
      assert.equal(await readFile(join(resumed.output, name), 'utf8'), await readFile(join(fresh.output, name), 'utf8'), name)
    }
    assert.equal((await ckStore.getFileResults('ck-2')).size, 0)
    assert.match(await readFile(join(ckRoot, '_records', 'runs', 'ck-2', 'report.md'), 'utf8'), /续跑沿用：\d+ 个文件/)
  })

  const changedRoot = join(tmp, 'ck-changed')
  await stopAfterFirst(changedRoot, 'ck-3')
  const changedStore = await openRecords(join(changedRoot, '_records'))
  const doneRel = [...(await changedStore.getFileResults('ck-3')).keys()]
  const original = await readFile(join(ckIn, doneRel[0]), 'utf8')
  await writeFile(join(ckIn, doneRel[0]), `${original}补记：联系人赵六。\n`)
  const afterChange = await runBatch({ inputDir: ckIn, outputRoot: changedRoot, options: { runId: 'ck-4', resumeFrom: 'ck-3' } })
  await writeFile(join(ckIn, doneRel[0]), original)
  await check('续跑：源文件改过的不沿用，重新处理', async () => {
    assert.equal(afterChange.status, 'completed')
    assert.equal(afterChange.totals.reusedFiles ?? 0, doneRel.length - 1)
    assert.match(await readFile(join(afterChange.output, doneRel[0]), 'utf8'), /补记/)
  })

  // A batch cut off without ending (crash, app quit): listed as running with
  // an old heartbeat. The service shows it as interrupted and can resume it.
  const cutRoot = join(tmp, 'ck-cut')
  await stopAfterFirst(cutRoot, 'ck-5')
  const cutStore = await openRecords(join(cutRoot, '_records'))
  const cutDone = (await cutStore.getFileResults('ck-5')).size
  const longAgo = new Date(Date.now() - 5 * 60_000).toISOString()
  await cutStore.putRun({ ...(await cutStore.getRun('ck-5')), status: 'running', heartbeatAt: longAgo, finishedAt: null })
  await cutStore.putDoc('ck-5', 'live', { id: 'ck-5', status: 'running', startedAt: longAgo, inputDir: ckIn, totals: { files: cutDone }, config: { model: '' }, warnings: [] })
  await cutStore.putDoc('ck-5', 'resume', { inputDir: ckIn, outputRoot: cutRoot, model: '' })
  const cutService = createService({ config: { model: '', outputRoot: cutRoot }, defaultDirectory: tmp })
  await check('中断的批次：心跳过期后列为已中断、可继续处理，报告注明', async () => {
    const listed = (await cutService.list()).runs.find((item) => item.id === 'ck-5')
    assert.equal(listed.status, 'interrupted')
    assert.equal(listed.resumable, true)
    const { run } = await cutService.status('ck-5')
    assert.equal(run.status, 'interrupted')
    assert.match((await cutService.report('ck-5')).markdown, /已中断/)
    assert.equal(await cutStore.getDoc('ck-5', 'live'), null)
  })
  await check('中断的批次继续处理：沿用已完成的文件，完成后旧批次的回复与逐文件结果删除', async () => {
    const started = await cutService.start({ resumeFrom: 'ck-5' })
    for (let i = 0; i < 200 && (await cutService.status(started.runId)).run?.status === 'running'; i += 1) await new Promise((r) => setTimeout(r, 25))
    const { run } = await cutService.status(started.runId)
    assert.equal(run.status, 'completed')
    assert.equal(run.totals.reusedFiles, cutDone)
    for (let i = 0; i < 40 && (await cutStore.getFileResults('ck-5')).size; i += 1) await new Promise((r) => setTimeout(r, 25))
    assert.equal((await cutStore.getFileResults('ck-5')).size, 0)
    assert.equal((await cutStore.getRun('ck-5')).resumedBy, started.runId)
  })
  await check('仍在跳心跳的运行中批次不会被当成中断', async () => {
    await cutStore.putRun({ id: 'live-1', status: 'running', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() })
    const listed = (await cutService.list()).runs.find((item) => item.id === 'live-1')
    assert.equal(listed.status, 'running')
    await cutStore.deleteRun('live-1')
  })

  await check('结果比对按行读写：按文字找行、只改动到的行', async () => {
    const store = await openRecords(join(tmp, 'cmp', '_records'))
    await store.putCompareFile('c1', { n: 0, relPath: 'a.txt', changed: 1, total: 3 }, [
      { id: 'L1', i: 1, field: '第 1 行', before: '张三来诊', after: '化名-A1B2C3来诊' },
      { id: 'L2', i: 2, field: '第 2 行', before: '李四陪同', same: true },
      { id: 'L3', i: 3, field: '第 3 行', before: '无', same: true, flagged: true },
    ])
    const rows = await store.getCompareRows('c1', 0, '李四')
    assert.deepEqual(rows.map((row) => row.k), [1])
    await store.updateCompare('c1', 0, [{ k: 1, change: { ...rows[0].change, after: '化名-D4E5F6陪同', same: undefined } }], { changed: 2 })
    const data = await store.getCompareFile('c1', 0)
    assert.deepEqual(data.changes[1], { id: 'L2', i: 2, field: '第 2 行', before: '李四陪同', after: '化名-D4E5F6陪同' })
    assert.deepEqual(data.changes[2], { id: 'L3', i: 3, field: '第 3 行', before: '无', same: true, flagged: true })
    assert.equal((await store.getCompareList('c1'))[0].changed, 2)
  })

  await check('0.10 及更早批次的复核清单、比对、报告、路径对照在第一次读取时并入', async () => {
    const dir = join(tmp, 'lazy', '_records')
    const runDir = join(dir, 'runs', 'z1')
    await mkdir(join(runDir, 'compare'), { recursive: true })
    await writeFile(join(runDir, 'report.json'), JSON.stringify({ id: 'z1', status: 'review', files: [] }))
    await writeFile(join(runDir, 'review-items.json'), JSON.stringify([{ relPath: 'a.txt', reviewCopy: null, items: [{ id: 'a.txt#0', code: 'disputed', text: '张三' }] }]))
    await writeFile(join(runDir, 'compare', 'index.json'), JSON.stringify([{ n: 0, relPath: 'a.txt', changed: 1, total: 1 }, { n: 1, relPath: 'big.txt', skipped: 'too-large' }]))
    await writeFile(join(runDir, 'compare', '0.json'), JSON.stringify({ relPath: 'a.txt', all: true, changes: [{ id: 'L1', i: 1, field: '第 1 行', before: '张三', after: '化名-A1B2C3' }] }))
    await writeFile(join(runDir, 'path-map.json'), JSON.stringify({ runId: 'z1', prefixes: [], files: [{ original: '张三.txt' }] }))
    const store = await openRecords(dir)
    assert.equal((await store.getRunDetail('z1')).status, 'review')
    assert.equal((await store.getReviewItem('z1', 'a.txt#0')).item.text, '张三')
    assert.equal((await store.getReviewFiles('z1'))[0].items.length, 1)
    assert.equal((await store.getCompareList('z1')).length, 2)
    assert.equal((await store.getCompareFile('z1', 0)).changes[0].after, '化名-A1B2C3')
    assert.equal(await store.getCompareFile('z1', 1), null)
    assert.equal((await store.getDoc('z1', 'path-map')).files[0].original, '张三.txt')
    // Taken over: the database answers even without the files.
    await rm(runDir, { recursive: true, force: true })
    assert.equal((await store.getReviewFiles('z1'))[0].relPath, 'a.txt')
    assert.equal((await store.getCompareFile('z1', 0)).changes.length, 1)
  })

  await check('图片识别进度存记录库：上次没跑完的显示为已中断', async () => {
    const store = await openRecords(join(ckRoot, '_records'))
    await store.putReviewFiles('ck-2', [{ relPath: 'a.txt', items: [{ id: 'a.txt#0', code: 'opaque', image: true, baseId: 'b1' }] }])
    await store.putDoc('ck-2', 'image-job', { state: 'running', done: 1, total: 3 })
    const svc = createService({ config: { model: '', outputRoot: ckRoot }, defaultDirectory: tmp })
    const items = await svc.reviewItems('ck-2')
    assert.equal(items.imageCheck.state, 'interrupted')
    assert.equal(items.imageCheck.done, 1)
  })
  await closeRecords()
}

// Without node:sqlite: the old files, written as before.
useFileRecords(true)
await check('没有 node:sqlite 时退回旧布局文件', async () => {
  const dir = join(tmp, 'files', '_records')
  const store = await openRecords(dir)
  assert.equal(store.kind, 'files')
  await store.putRun(summary('f1', '2026-01-01T00:00:00Z'))
  await store.putRun(summary('f2', '2026-02-01T00:00:00Z'))
  await store.patchRun('f1', { status: 'review' })
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')).map((item) => [item.id, item.status]), [['f2', 'completed'], ['f1', 'review']])
  assert.equal(await store.saveDecisions('f1', { a: { action: 'accept' } }), 1)
  assert.equal(await store.saveDecisions('f1', { a: { action: 'accept' } }), 0)
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'runs', 'f1', 'review-decisions.json'), 'utf8')), { a: { action: 'accept' } })
  assert.equal((await stat(join(dir, 'runs', 'f1', 'review-decisions.json'))).mode & 0o777, 0o600)
  await store.putCalls('f1', [{ seq: 1, stage: 's' }])
  assert.deepEqual((await store.appendCalls('f1', [{ stage: 't' }])).map((entry) => entry.seq), [2])
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'runs', 'f1', 'calls.json'), 'utf8')).map((entry) => entry.seq), [1, 2])
  await store.putDoc('f1', 'resume', { inputDir: '/in' })
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'runs', 'f1', 'resume.json'), 'utf8')), { inputDir: '/in' })
  await store.deleteDoc('f1', 'resume')
  await assert.rejects(stat(join(dir, 'runs', 'f1', 'resume.json')))
  await store.addManualEdit('f1', { action: 'revert' })
  assert.equal((await store.getManualEdits('f1')).length, 1)
  await store.putImageChecks('f1', { x: { c: 1 } })
  assert.deepEqual(await store.getImageChecks('f1'), { x: { c: 1 } })
  assert.equal(await store.deleteRun('f2'), true)
  assert.deepEqual((await store.listRuns()).map((item) => item.id), ['f1'])
  await assert.rejects(stat(join(dir, RECORDS_FILE)))
})
useFileRecords(false)
await closeRecords()

await rm(tmp, { recursive: true, force: true })
if (failures) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nRECORDS PASS')
