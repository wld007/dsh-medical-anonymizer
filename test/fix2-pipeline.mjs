/**
 * Regression tests for review findings #12 (output names fixed before the
 * contents are processed), #13 (last chunk misses the cross-file re-check),
 * #14 / #15 (blind-review findings discarded), #16 (failed re-check write
 * leaves a stale output), #37 (input name in reports of a stopped batch),
 * #38 (parser / endpoint error text in issue details), #39 (field names that
 * are identifiers) and #40 (model reasons quoting originals).
 * Run: node test/fix2-pipeline.mjs
 */
import assert from 'node:assert/strict'
import { readFile, rm, mkdir, writeFile, readdir, chmod, stat } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from '../vendor/xlsx.mjs'
import * as pipeline from '../lib/pipeline.js'
import { createService } from '../lib/service.js'
import { packDirectory } from '../lib/zip.js'
import { LlmError } from '../lib/llm.js'
import { openRecords } from '../lib/records.js'
import { reviewFilesOf, pathMapOf, compareTextOf, recordsOf } from './records-read.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const { runBatch } = pipeline
const tmp = join(here, '.tmp', 'fix2-pipeline')
const ID = '11010519491231002X' // valid check digit

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

async function walk(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(`${relative(base, path).split('\\').join('/')}/`)
      out.push(...await walk(path, base))
    } else out.push(relative(base, path).split('\\').join('/'))
  }
  return out
}

/** Every file under `dir` (relative path → text), skipping the vault-grade records. */
async function texts(dir, skip = /(^|\/)(vault\.json|review-items\.json|path-map\.json|advice\.json|compare\/\d+\.json|resume\.json|model-cache.*|calls\.json|records\.sqlite(-wal|-shm)?)$/) {
  const out = new Map()
  for (const rel of await walk(dir)) {
    if (rel.endsWith('/') || skip.test(rel)) continue
    out.set(rel, await readFile(join(dir, rel), 'utf8').catch(() => ''))
  }
  return out
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const segmentsOf = (prompt, marker) => JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length))

/**
 * Scripted model: `detect(segments)` → entities, `verify(segments)` →
 * issues, `verdicts(candidates)` → verdicts (default: every candidate is an
 * identifier), `profile(fields)` → [field, category, type] triples.
 */
function scripted({ detect = () => [], verify = () => [], verdicts = null, profile = () => [] } = {}) {
  return {
    model: 'scripted',
    async chatJson(messages) {
      const prompt = messages.map((message) => message.content).join('\n')
      if (prompt.includes('独立的数据安全审查员')) return { json: { issues: await verify(segmentsOf(prompt, '段落：')) } }
      if (prompt.includes('另一位审查员')) {
        const candidates = segmentsOf(prompt, '候选：')
        return { json: { verdicts: verdicts ? verdicts(candidates) : candidates.map((item) => ({ i: item.i, identifier: true })) } }
      }
      if (prompt.includes('结构化医疗数据')) return { json: { fields: profile(segmentsOf(prompt, '字段：')) } }
      return { json: { entities: await detect(segmentsOf(prompt, '段落：')) } }
    },
  }
}

/** Entities for every segment that holds one of `names`. */
const finding = (names, type = '姓名') => (segments) => segments.flatMap((segment) => names
  .filter((name) => segment.text.includes(name)).map((name) => ({ segment: segment.id, type, text: name })))

async function report(root, runId) {
  const dir = join(root, '_records', 'runs', runId)
  return {
    json: JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')),
    md: await readFile(join(dir, 'report.md'), 'utf8'),
    // Batch list row (records.sqlite runs).
    index: JSON.stringify(await (await openRecords(join(root, '_records'))).listRuns()),
    // The comparison's file list (its rows hold originals, like the vault).
    compare: JSON.stringify((await (await recordsOf(root)).getCompareList(runId)) ?? []),
  }
}

function assertAbsent(text, values, where) {
  for (const value of values) assert.ok(!String(text).includes(value), `${where} contains ${value}`)
}

/* ------------------------------------------------------------------ #12 */

async function testOutputNames() {
  const base = join(tmp, 'names')

  await check('#12 单个文件：正文中识别到的姓名也替换文件名，且与正文假名一致', async () => {
    const input = join(base, 'single')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, '阿依古丽_出院记录.txt'), '姓名：阿依古丽，女，45 岁。\n')
    const root = join(base, 'single-out')
    const run = await runBatch({ inputDir: join(input, '阿依古丽_出院记录.txt'), outputRoot: root, options: { runId: 'single' } })
    assert.equal(run.status, 'completed')
    const delivered = (await walk(root)).filter((rel) => !rel.startsWith('_records'))
    assert.equal(delivered.length, 1, delivered.join(','))
    assert.match(delivered[0], /^化名-[0-9A-F]{6,10}_出院记录\.txt$/)
    const content = await readFile(join(root, delivered[0]), 'utf8')
    assert.ok(content.includes(delivered[0].split('_')[0]), `${content} / ${delivered[0]}`)
    const { json, md, index, compare } = await report(root, 'single')
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md], ['index.json', index], ['compare', compare]]) assertAbsent(text, ['阿依古丽'], where)
    assert.equal(json.files[0].relPath, delivered[0])
  })

  await check('#12 目录：只有模型在别的文件正文中认出的姓名，也替换文件名和目录名', async () => {
    const input = join(base, 'dir', 'in')
    await mkdir(join(input, '阿依古丽_随访'), { recursive: true })
    await writeFile(join(input, 'a.txt'), '主诉：阿依古丽自述头痛三天。\n')
    await writeFile(join(input, '阿依古丽_随访', '记录.txt'), '随访正常。\n')
    await writeFile(join(input, '阿依古丽_复诊.txt'), '复诊，无不适。\n')
    await writeFile(join(input, '出院记录.txt'), '一般情况好。\n')
    // Latin name: never in the batch dictionary (2-character CJK rule), still a name.
    await mkdir(join(input, 'Aliya Kader'), { recursive: true })
    await writeFile(join(input, 'b.txt'), 'Patient Aliya Kader came for review.\n')
    await writeFile(join(input, 'Aliya Kader', 'note.txt'), 'Stable.\n')
    const root = join(base, 'dir', 'out')
    const llm = scripted({ detect: (segments) => [...finding(['阿依古丽'])(segments), ...finding(['Aliya Kader'])(segments)] })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'dir', llm } })
    assert.equal(run.status, 'completed', JSON.stringify(run.files.map((file) => [file.relPath, file.status, file.issues])))
    const all = await walk(root)
    const delivered = all.filter((rel) => !rel.startsWith('_records'))
    assertAbsent(delivered.join('\n'), ['阿依古丽', 'Aliya'], 'delivered names')
    assertAbsent(all.filter((rel) => rel.startsWith('_records')).join('\n'), ['阿依古丽', 'Aliya'], 'record names')
    assert.ok(delivered.some((rel) => rel.endsWith('/出院记录.txt')), 'plain name kept')
    const token = (await readFile(join(run.output, 'a.txt'), 'utf8')).match(/化名-[0-9A-F]{6,10}/)?.[0]
    assert.ok(token)
    assert.ok(delivered.some((rel) => rel.endsWith(`/${token}_随访/记录.txt`)), delivered.join('\n'))
    assert.ok(delivered.some((rel) => rel.endsWith(`/${token}_复诊.txt`)), delivered.join('\n'))
    assert.equal(await readFile(join(run.output, `${token}_复诊.txt`), 'utf8'), '复诊，无不适。\n')
    const { json, md, index, compare } = await report(root, 'dir')
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md], ['index.json', index], ['compare', compare]]) assertAbsent(text, ['阿依古丽', 'Aliya'], where)
    const calls = JSON.stringify(await (await openRecords(join(root, '_records'))).getCalls('dir'))
    assert.ok(calls.length > 2, 'call log recorded')
    assertAbsent(calls, ['阿依古丽', 'Aliya'], 'calls.json')
    const map = await pathMapOf(root, 'dir')
    assert.ok(map.files.some((entry) => entry.original === '阿依古丽_复诊.txt'))
  })

  await check('#12 压缩包内的文件名同样替换', async () => {
    const input = join(base, 'zip', 'in')
    const packed = join(base, 'zip', 'src')
    await mkdir(packed, { recursive: true })
    await mkdir(input, { recursive: true })
    await writeFile(join(packed, '阿依古丽_随访.txt'), '随访正常。\n')
    await writeFile(join(packed, '检验.txt'), '血常规正常。\n')
    await packDirectory(packed, join(input, 'pack.zip'))
    await writeFile(join(input, 'a.txt'), '主诉：阿依古丽自述头痛三天。\n')
    const root = join(base, 'zip', 'out')
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'zip', llm: scripted({ detect: finding(['阿依古丽']) }) } })
    assert.equal(run.status, 'completed')
    // Delivered unpacked: the zip's contents sit in a folder named "pack".
    const names = await walk(join(run.output, 'pack'))
    assertAbsent(names.join('\n'), ['阿依古丽'], 'zip entries')
    assert.ok(names.includes('检验.txt'))
    assert.ok(names.some((name) => /^化名-[0-9A-F]{6,10}_随访\.txt$/.test(name)), names.join(','))
    const { md } = await report(root, 'zip')
    assertAbsent(md, ['阿依古丽'], 'report.md')
  })

  await check('#12 新名字与已有文件重名时不覆盖', async () => {
    const input = join(base, 'clash', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'a.txt'), '主诉：阿依古丽自述头痛三天。\n')
    await writeFile(join(input, '阿依古丽.txt'), '第一份。\n')
    await writeFile(join(input, '阿依古丽_.txt'), '第二份。\n')
    const root = join(base, 'clash', 'out')
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'clash', llm: scripted({ detect: finding(['阿依古丽']) }) } })
    const files = (await walk(run.output)).filter((rel) => !rel.endsWith('/'))
    assert.equal(files.length, 3, files.join(','))
    const contents = await Promise.all(files.map((rel) => readFile(join(run.output, rel), 'utf8')))
    assert.ok(contents.includes('第一份。\n') && contents.includes('第二份。\n'))
    assertAbsent(files.join('\n'), ['阿依古丽'], 'names')
  })
}

/* ------------------------------------------------------------------ #13 */

async function testLastChunk() {
  const base = join(tmp, 'chunks')

  // a.txt: the model needs a while to find 王建国; the other files' model
  // misses it ("家属王建国" has no label the rules know).
  const slowFinder = (delay) => scripted({
    detect: async (segments) => {
      const hits = segments.filter((segment) => segment.text.includes('主诉') && segment.text.includes('王建国'))
      if (hits.length === 0) return []
      await sleep(delay)
      return hits.map((segment) => ({ segment: segment.id, type: '姓名', text: '王建国' }))
    },
  })

  await check('#13 最后一组先完成时，仍补查前一组慢文件识别到的姓名', async () => {
    const input = join(base, 'two', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'a.txt'), '主诉：王建国自述头痛三天。\n')
    await writeFile(join(input, 'b.txt'), '陪同人员：家属王建国\n')
    const root = join(base, 'two', 'out')
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'two', maxFiles: 1, llm: slowFinder(500) } })
    const out = join(root, '_records', 'runs', 'two', 'output')
    const where = run.output ?? out
    const b = await readFile(join(where, 'b.txt'), 'utf8')
    assert.ok(!b.includes('王建国'), b)
    assert.match(b, /家属化名-[0-9A-F]{6,10}/)
    assert.equal(run.status, 'completed')
  })

  await check('#13 四组：第二组和最后一组都补查', async () => {
    const input = join(base, 'four', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'a.txt'), '主诉：王建国自述头痛三天。\n')
    await writeFile(join(input, 'b.txt'), '陪同人员：家属王建国\n')
    await writeFile(join(input, 'c.txt'), '探视：家属王建国\n')
    await writeFile(join(input, 'd.txt'), '签字：家属王建国\n')
    const root = join(base, 'four', 'out')
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'four', maxFiles: 1, llm: slowFinder(500) } })
    for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
      const text = await readFile(join(run.output ?? join(root, '_records', 'runs', 'four', 'output'), name), 'utf8')
      assert.ok(!text.includes('王建国'), `${name}: ${text}`)
    }
  })
}

/* ------------------------------------------------------------------ #14 / #15 */

/** A verifier that reports `text` once, against the segment `pick(segments)` chooses. */
function verifierOnce(pick, text, type = '姓名') {
  let left = 1
  return (segments) => {
    const segment = pick(segments)
    if (!segment || left <= 0) return []
    left -= 1
    return [{ segment: typeof segment === 'string' ? segment : segment.id, type, text, reason: '残留' }]
  }
}

async function testVerifierFindings() {
  const base = join(tmp, 'verify')

  await check('#14 列表中的数字只匹配值的一部分时，不被丢弃（替换或转人工复核）', async () => {
    const input = join(base, 'part', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'a.csv'), 'visit,ref_no\nA,12345678/87654321\n')
    const root = join(base, 'part', 'out')
    const llm = scripted({ verify: (segments) => segments.filter((segment) => segment.id.startsWith('num:') && segment.text.includes('12345678')).map((segment) => ({ segment: segment.id, type: '病历号', text: '12345678' })) })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'part', llm } })
    assert.notEqual(run.status, 'completed')
    const file = run.files.find((item) => item.relPath === 'a.csv')
    assert.equal(file.status, 'review')
    const staged = await readFile(join(root, '_records', 'runs', 'part', 'output', 'a.csv'), 'utf8')
    assert.ok(!staged.includes('12345678/'), staged)
    assertAbsent((await report(root, 'part')).md, ['12345678'], 'report.md')
  })

  await check('#14 列表中定位不到的报出转人工复核，不静默通过', async () => {
    const input = join(base, 'nomember', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'a.csv'), 'visit,ref_no\nA,12345678/87654321\nB,99887766\n')
    const root = join(base, 'nomember', 'out')
    // "5678/8765" is inside a value but not a standalone part of it.
    const llm = scripted({ verify: (segments) => segments.filter((segment) => segment.id.startsWith('num:') && segment.text.includes('5678/8765')).map((segment) => ({ segment: segment.id, type: '病历号', text: '5678/8765' })) })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'nomember', llm } })
    assert.equal(run.status, 'review')
    const file = run.files.find((item) => item.relPath === 'a.csv')
    assert.ok(file.issues.some((issue) => issue.severity === 'error' && issue.code === 'model-unlocated'), JSON.stringify(file.issues))
    const items = await reviewFilesOf(root, 'nomember')
    assert.ok(items.some((entry) => entry.items.some((item) => item.text === '5678/8765')))
    assertAbsent((await report(root, 'nomember')).md, ['5678/8765'], 'report.md')
  })

  await check('#14 整值匹配照常替换，批次完成', async () => {
    const input = join(base, 'whole', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'a.csv'), 'visit,ref_no\nA,12345678\nB,7\n')
    const root = join(base, 'whole', 'out')
    const llm = scripted({ verify: (segments) => segments.filter((segment) => segment.id.startsWith('num:') && segment.text.includes('12345678')).map((segment) => ({ segment: segment.id, type: '病历号', text: '12345678' })) })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'whole', llm } })
    assert.equal(run.status, 'completed', JSON.stringify(run.files[0].issues))
    const text = await readFile(join(run.output, 'a.csv'), 'utf8')
    assert.ok(!text.includes('12345678'), text)
    assert.match(text, /B,7/)
  })

  await check('#15 段 id 错误时按文字找到真实段落并替换，同内容的其他文件也不被当作已核验', async () => {
    const input = join(base, 'wrongid', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'note.txt'), '今日查房，张三与李四同住一室。\n')
    await writeFile(join(input, 'note2.txt'), '今日查房，张三与李四同住一室。\n')
    const root = join(base, 'wrongid', 'out')
    const llm = scripted({
      verify: (segments) => ['张三', '李四'].filter((name) => segments.some((segment) => segment.text.includes(name)))
        .map((name) => ({ segment: 't9', type: '姓名', text: name, reason: '人名' })),
    })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'wrongid', llm } })
    for (const name of ['note.txt', 'note2.txt']) {
      const where = run.output ?? join(root, '_records', 'runs', 'wrongid', 'output')
      const text = await readFile(join(where, name), 'utf8')
      assertAbsent(text, ['张三', '李四'], name)
    }
    assert.equal(run.status, 'completed', JSON.stringify(run.files.map((file) => file.issues)))
    assert.equal(run.totals.dropped?.['盲审'] ?? 0, 0)
  })

  await check('#15 报出的文字在同一文件的其他批次里，也能找到并替换', async () => {
    const input = join(base, 'otherbatch', 'in')
    await mkdir(input, { recursive: true })
    const rows = Array.from({ length: 70 }, (_, index) => `${index + 1},${index === 64 ? '王五在场' : `记录第${index + 1}条`}`)
    await writeFile(join(input, 'a.csv'), `id,note\n${rows.join('\n')}\n`)
    const root = join(base, 'otherbatch', 'out')
    const llm = scripted({ verify: verifierOnce((segments) => (segments.some((segment) => segment.text.includes('王五')) ? null : segments[0]), '王五') })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'otherbatch', llm } })
    const where = run.output ?? join(root, '_records', 'runs', 'otherbatch', 'output')
    const text = await readFile(join(where, 'a.csv'), 'utf8')
    assert.ok(!text.includes('王五'), text.split('\n')[65])
  })

  await check('#15 报出的文字在文件中找不到时转人工复核，不计为通过', async () => {
    const input = join(base, 'nowhere', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'note.txt'), '今日查房，一般情况好。\n')
    const root = join(base, 'nowhere', 'out')
    const llm = scripted({ verify: verifierOnce((segments) => segments[0], '赵六') })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'nowhere', llm } })
    assert.equal(run.status, 'review')
    assert.ok(run.files[0].issues.some((issue) => issue.code === 'model-unlocated' && issue.severity === 'error'))
    assertAbsent((await report(root, 'nowhere')).md, ['赵六'], 'report.md')
  })
}

/* ------------------------------------------------------------------ #16 */

async function testRecheckWrite() {
  const base = join(tmp, 'write')
  if (process.getuid?.() === 0) {
    console.log('  --  #16 skipped (running as root: chmod does not block writes)')
    return
  }
  // a.txt's model call waits until b.txt's output exists, makes it read-only
  // and then reveals 王建国, so the re-check of b.txt cannot write.
  const locker = (output) => scripted({
    detect: async (segments) => {
      const hits = segments.filter((segment) => segment.text.includes('主诉') && segment.text.includes('王建国'))
      if (hits.length === 0) return []
      for (let i = 0; i < 200 && !(await stat(join(output, 'b.txt')).catch(() => null)); i += 1) await sleep(20)
      await chmod(join(output, 'b.txt'), 0o400)
      return hits.map((segment) => ({ segment: segment.id, type: '姓名', text: '王建国' }))
    },
  })

  for (const [label, maxFiles] of [['批次复扫', 200], ['跨组复扫', 1]]) {
    await check(`#16 ${label}写出失败：旧结果不交付、不计为完成`, async () => {
      const input = join(base, String(maxFiles), 'in')
      await mkdir(input, { recursive: true })
      await writeFile(join(input, 'a.txt'), '主诉：王建国自述头痛三天。\n')
      await writeFile(join(input, 'b.txt'), '陪同人员：家属王建国\n')
      const root = join(base, String(maxFiles), 'out')
      const runId = `w${maxFiles}`
      const output = join(root, '_records', 'runs', runId, 'output')
      const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId, maxFiles, llm: locker(output) } })
      assert.notEqual(run.status, 'completed')
      assert.equal(run.output, null)
      const b = run.files.find((file) => file.relPath === 'b.txt')
      assert.equal(b.status, 'failed')
      assert.ok(run.totals.filesFailed >= 1)
      assert.ok(run.totals.unresolved >= 1)
      for (const [rel, text] of await texts(root)) assert.ok(!text.includes('家属王建国'), `${rel}: ${text}`)
    })
  }
}

/* ------------------------------------------------------------------ #37 */

async function testStoppedInputName() {
  const base = join(tmp, 'stopped')
  const secrets = ['张三', ID]

  await check('#37 预扫阶段取消：报告、索引和进度里不出现输入目录名中的姓名和证件号', async () => {
    const input = join(base, 'dir', `张三_${ID}`)
    await mkdir(input, { recursive: true })
    for (const name of ['a.txt', 'b.txt', 'c.txt']) await writeFile(join(input, name), '一般情况好。\n')
    const root = join(base, 'dir', 'out')
    const controller = new AbortController()
    controller.abort()
    const seen = []
    const run = await runBatch({ inputDir: input, outputRoot: root, signal: controller.signal, options: { runId: 'stop' }, onEvent: ({ run: state }) => seen.push(JSON.stringify({ inputDir: state.inputDir, selection: state.selection, deliverName: state.deliverName })) })
    assert.equal(run.status, 'cancelled')
    const { json, md, index } = await report(root, 'stop')
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md], ['index.json', index], ['events', seen.join('\n')]]) assertAbsent(text, secrets, where)
    assert.match(json.inputDir, /\[姓名\]_\[身份证号\]$/)
  })

  await check('#37 单个文件输入预扫阶段取消同样不出现原名', async () => {
    const input = join(base, 'file')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, `张三_${ID}.txt`), '一般情况好。\n')
    const root = join(base, 'file', 'out')
    const controller = new AbortController()
    controller.abort()
    await runBatch({ inputDir: join(input, `张三_${ID}.txt`), outputRoot: root, signal: controller.signal, options: { runId: 'stopfile' } })
    const { json, md, index } = await report(root, 'stopfile')
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md], ['index.json', index]]) assertAbsent(text, secrets, where)
  })

  await check('#37 通过服务启动：运行中的状态与取消后的记录都不含原名', async () => {
    const input = join(base, 'svc', `张三_${ID}`)
    await mkdir(input, { recursive: true })
    for (let i = 0; i < 30; i += 1) await writeFile(join(input, `n${i}.txt`), `姓名：王${'一二三四五六七八九十'[i % 10]}，一般情况好。\n`)
    const svc = createService({ config: {}, defaultDirectory: join(base, 'svc') })
    const started = await svc.start({ inputDir: input })
    const early = await svc.status(started.runId)
    assertAbsent(JSON.stringify(early.run), secrets, 'status while running')
    await svc.cancel()
    for (let i = 0; i < 400 && svc.isRunning(); i += 1) await sleep(25)
    const after = await svc.status(started.runId)
    assertAbsent(JSON.stringify(after.run), secrets, 'status after')
    const root = join(base, 'svc', '_medical-anonymizer')
    const { json, md, index } = await report(root, started.runId)
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md], ['index.json', index]]) assertAbsent(text, secrets, where)
  })
}

/* ------------------------------------------------------------------ #38 */

async function testErrorText() {
  const base = join(tmp, 'errors')

  await check('#38 JSON 解析错误不在报告中引用原文', async () => {
    const input = join(base, 'json', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'r.json'), `{"name": 张三, "id": "${ID}"}`)
    const root = join(base, 'json', 'out')
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'json' } })
    const issue = run.files[0].issues.find((item) => item.code === 'load')
    assert.ok(issue, JSON.stringify(run.files[0].issues))
    assert.match(issue.detail, /格式错误/)
    const { json, md } = await report(root, 'json')
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md]]) assertAbsent(text, ['张三', ID, '{"name"'], where)
  })

  if (process.getuid?.() !== 0) {
    await check('#38 文件读取错误不带出含姓名的路径', async () => {
      const input = join(base, 'fs', '王建国_资料')
      await mkdir(input, { recursive: true })
      await writeFile(join(input, '病程.txt'), '一般情况好。\n')
      await writeFile(join(input, '其他.txt'), '一般情况好。\n')
      await chmod(join(input, '病程.txt'), 0o000)
      const root = join(base, 'fs', 'out')
      try {
        const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'fs' } })
        const file = run.files.find((item) => item.status === 'failed')
        assert.ok(file, JSON.stringify(run.files))
        assert.match(file.issues[0].detail, /EACCES/)
        const { json, md, index } = await report(root, 'fs')
        for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md], ['index.json', index]]) assertAbsent(text, ['王建国'], where)
      } finally {
        await chmod(join(input, '病程.txt'), 0o600)
      }
    })
  }

  await check('#38 模型端点错误正文和带引号的错误信息不进报告', async () => {
    const input = join(base, 'llm', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'note.txt'), '今日查房，张三一般情况好。\n')
    const root = join(base, 'llm', 'out')
    const llm = {
      model: 'broken',
      async chatJson(messages) {
        const prompt = messages.map((message) => message.content).join('\n')
        if (prompt.includes('独立的数据安全审查员')) throw new LlmError('模型端点返回 500: {"error":"cannot handle 今日查房，张三一般情况好"}', 'http-error', 500)
        throw new Error('segment "今日查房，张三一般情况好" rejected')
      },
    }
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'llm', llm } })
    assert.equal(run.status, 'review')
    const details = run.files[0].issues.map((issue) => issue.detail).join('\n')
    assert.match(details, /HTTP 500/)
    const { json, md } = await report(root, 'llm')
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md]]) assertAbsent(text, ['张三', '今日查房'], where)
  })

  await check('#38 describeError 只保留类别、位置和自身措辞', async () => {
    const { describeError } = pipeline
    assert.equal(typeof describeError, 'function')
    let parse
    try { JSON.parse('{"name": 张三}') } catch (error) { parse = error }
    assert.doesNotMatch(describeError(parse), /张三/)
    assert.equal(describeError(Object.assign(new Error(`EACCES: permission denied, open '/x/张三/a.txt'`), { code: 'EACCES', syscall: 'open', path: '/x/张三/a.txt', errno: -13 })), '文件系统错误 EACCES（open）')
    assert.equal(describeError(new Error('文件超过 30 MB 上限')), '文件超过 30 MB 上限')
    assert.doesNotMatch(describeError(new Error('无法读取 /data/张三/x.txt')), /张三/)
  })
}

/* ------------------------------------------------------------------ #39 / #40 */

async function testLabelsAndReasons() {
  const base = join(tmp, 'labels')

  await check('#39 表头本身是证件号时，报告中的字段名被遮盖', async () => {
    const input = join(base, 'xlsx', 'in')
    await mkdir(input, { recursive: true })
    const sheet = XLSX.utils.aoa_to_sheet([['项目', ID, '备注'], ['身份证', '110101199003071234', '无']])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
    await writeFile(join(input, 'p.xlsx'), XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
    const root = join(base, 'xlsx', 'out')
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'xlsx' } })
    assert.ok(run.files[0].issues.some((issue) => issue.code === 'suspect'), JSON.stringify(run.files[0].issues))
    const { json, md } = await report(root, 'xlsx')
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md]]) assertAbsent(text, [ID, '110101199003071234'], where)
  })

  await check('#39 JSON 键是已识别的姓名时，字段名中的姓名不进报告', async () => {
    const input = join(base, 'json', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'r.json'), JSON.stringify({ 姓名: '张三', 联系人: { 张三: '身份证 110101199003071234' } }))
    const root = join(base, 'json', 'out')
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'json' } })
    assert.ok(run.files[0].issues.some((issue) => issue.code === 'suspect'), JSON.stringify(run.files[0].issues))
    const { json, md } = await report(root, 'json')
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md]]) assertAbsent(text, ['张三', '110101199003071234'], where)
  })

  await check('#39 字段画像表不列出是姓名的字段名', async () => {
    const input = join(base, 'profile', 'in')
    await mkdir(input, { recursive: true })
    const rows = Array.from({ length: 8 }, (_, index) => `${index + 1},随访第${index + 1}次情况稳定,${index === 0 ? '联系人王建国' : '无'}`)
    await writeFile(join(input, 'a.csv'), `id,王建国,备注\n${rows.join('\n')}\n`)
    const root = join(base, 'profile', 'out')
    const llm = scripted({
      detect: finding(['王建国']),
      profile: (fields) => fields.map((field) => [field.field, 'freetext', '']),
    })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'profile', llm } })
    const { json, md } = await report(root, 'profile')
    assert.ok(Object.keys(json.profileSummary ?? {}).length > 0, 'profiled')
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md]]) assertAbsent(text, ['王建国'], where)
    assert.equal(run.files.length, 1)
  })

  await check('#40 复判理由引用候选原文时，报告中被遮盖', async () => {
    const input = join(base, 'disputed', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'n.txt'), '药品由王建国提供。\n')
    const root = join(base, 'disputed', 'out')
    const llm = scripted({
      verify: finding(['王建国']),
      verdicts: (candidates) => candidates.map((item) => ({ i: item.i, identifier: false, reason: '王建国为药品生产厂家联系人，不是患者' })),
    })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'disputed', llm } })
    assert.equal(run.status, 'review')
    const { json, md } = await report(root, 'disputed')
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md]]) assertAbsent(text, ['王建国'], where)
    assert.match(md, /药品生产厂家联系人/)
  })

  await check('#40 判定不是标识符的理由中引用其他原值（姓名、证件号）也被遮盖', async () => {
    const input = join(base, 'dismissed', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'n.txt'), '姓名：张三丰。药品由王建国提供，李小红陪同。\n')
    const root = join(base, 'dismissed', 'out')
    // Round 1: both reported; 李小红 is confirmed (so round 2 sees new text),
    // 王建国 dismissed with a reason that quotes it and two other originals.
    let calls = 0
    const llm = scripted({
      verify: (segments) => (calls++ === 0 ? [...finding(['王建国', '李小红'])(segments)] : []),
      verdicts: (candidates) => candidates.map((item) => (item.text === '王建国'
        ? { i: item.i, identifier: false, reason: `王建国是厂家联系人，与患者张三丰（${ID}）无关` }
        : { i: item.i, identifier: true })),
    })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'dismissed', llm } })
    const dismissed = run.files[0].issues.find((issue) => issue.code === 'verify-dismissed')
    assert.ok(dismissed, JSON.stringify(run.files[0].issues))
    const { json, md } = await report(root, 'dismissed')
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md]]) assertAbsent(text, ['王建国', '张三丰', ID], where)
    assert.match(dismissed.detail, /厂家联系人/)
  })
}

/* ------------------------------------------------- #40 cut / #39 JSON keys */

/** A reason whose first `before` characters are filler, then `tail`. */
const paddedReason = (lead, before, tail) => `${lead}${'甲'.repeat(before - lead.length)}${tail}`

async function testReasonCut() {
  const base = join(tmp, 'cut')
  // The report shows the first 60 characters of a reason; a known name that
  // crosses that cut must not leave a fragment behind.
  for (const [name, at] of [['张三丰', 58], ['张三丰', 59], ['司马相如', 57], ['司马相如', 58], ['司马相如', 59]]) {
    await check(`#40 理由截断处跨过已知姓名（${name.length} 字，截在第 ${60 - at} 字后）不留残片`, async () => {
      const id = `${name.length}-${at}`
      const input = join(base, id, 'in')
      await mkdir(input, { recursive: true })
      await writeFile(join(input, 'n.txt'), `姓名：${name}。药品由王建国提供。\n`)
      const root = join(base, id, 'out')
      const llm = scripted({
        verify: finding(['王建国']),
        verdicts: (candidates) => candidates.map((item) => ({ i: item.i, identifier: false, reason: paddedReason('王建国为厂家联系人，与本院的住院患者', at, `${name}无亲属关系`) })),
      })
      const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'cut', llm } })
      const { json, md } = await report(root, 'cut')
      for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md]]) {
        assertAbsent(text, [name, name.slice(0, 2), name.slice(0, 3)].filter((part) => part.length >= 2), where)
      }
      const issue = run.files[0].issues.find((item) => /厂家联系人/.test(item.detail))
      assert.ok(issue, JSON.stringify(run.files[0].issues))
      assert.match(issue.detail, /…/, 'still cut')
      assert.doesNotMatch(issue.detail, /[\uE000-\uF8FF]/, 'no markers left')
    })
  }

  await check('#40 截断处跨过其他文件中模型才认出的姓名，批次报告同样不留残片', async () => {
    const input = join(base, 'cross', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'a.txt'), '药品由王建国提供。\n')
    await writeFile(join(input, 'z.txt'), '家属欧阳明远陪同来院。\n')
    const root = join(base, 'cross', 'out')
    const llm = scripted({
      detect: finding(['欧阳明远']),
      verify: finding(['王建国']),
      verdicts: (candidates) => candidates.map((item) => ({ i: item.i, identifier: false, reason: paddedReason('王建国为厂家联系人，与', 58, '欧阳明远无亲属关系') })),
    })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'cross', llm, concurrency: 1 } })
    const { json, md } = await report(root, 'cross')
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md]]) assertAbsent(text, ['欧阳明远', '欧阳'], where)
    assert.ok(run.files.some((file) => file.issues.some((item) => /厂家联系人/.test(item.detail))))
  })

  await check('#40 短理由不截断，原样保留可读内容', async () => {
    const input = join(base, 'short', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'n.txt'), '药品由王建国提供。\n')
    const root = join(base, 'short', 'out')
    const llm = scripted({
      verify: finding(['王建国']),
      verdicts: (candidates) => candidates.map((item) => ({ i: item.i, identifier: false, reason: '厂家联系人，阿司匹林 100mg 供货' })),
    })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'short', llm } })
    const issue = run.files[0].issues.find((item) => /厂家联系人/.test(item.detail))
    assert.ok(issue)
    assert.match(issue.detail, /厂家联系人，阿司匹林 100mg 供货）/)
  })
}

async function testJsonKeys() {
  const base = join(tmp, 'keys')
  const deliveredJson = async (run, rel) => readFile(join(run.output ?? join(run.outputRoot ?? '', '_records', 'runs', run.id, 'output'), rel), 'utf8')

  // Keys are renamed to pseudonyms by the JSON loader (#30), so these files
  // are delivered clean; what matters is that no original survives anywhere
  // outside the vault, review items and the compare store.
  const noOriginal = async (root, runId, needles) => {
    const walk = async function* (dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) yield* walk(path)
        else yield path
      }
    }
    let files = 0
    for await (const path of walk(root)) {
      // Vault-grade records (originals by design): the vault, the records database.
      if (/vault|review-items|records\.sqlite|[\\/]compare[\\/]/.test(path)) continue
      files += 1
      assertAbsent(await readFile(path, 'utf8'), needles, path.slice(root.length))
    }
    assert.ok(files > 0)
    const { json, md } = await report(root, runId)
    for (const [where, text] of [['report.json', JSON.stringify(json)], ['report.md', md]]) assertAbsent(text, needles, where)
  }

  await check('#39/#30 JSON 键是本文件的姓名：键改为假名，输出与报告不含原值', async () => {
    const input = join(base, 'own', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'r.json'), JSON.stringify({ 姓名: '张三', 联系人: { 张三: '身份证 110101199003071234' } }))
    const root = join(base, 'own', 'out')
    await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'own' } })
    await noOriginal(root, 'own', ['张三'])
  })

  await check('#39/#30 JSON 深层键含姓名：输出与报告不含原值', async () => {
    const input = join(base, 'deep', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'r.json'), JSON.stringify({ 姓名: '李秀英', 家属: [{ 李秀英: { 电话: '无' } }] }, null, 2))
    const root = join(base, 'deep', 'out')
    await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'deep' } })
    await noOriginal(root, 'deep', ['李秀英'])
  })

  await check('#39/#30 JSON 键是另一个文件里的姓名（批次字典）：输出与报告不含原值', async () => {
    const input = join(base, 'batch', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'a.txt'), '姓名：王建国\n')
    await writeFile(join(input, 'b.json'), JSON.stringify({ 王建国: { 诊断: '高血压' } }))
    const root = join(base, 'batch', 'out')
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'batch' } })
    await noOriginal(root, 'batch', ['王建国'])
    assert.equal(run.totals.filesReview, run.files.filter((file) => file.status === 'review').length)
  })

  await check('#39/#30 JSON 键是另一个文件里模型才认出的姓名（批次复扫）：输出与报告不含原值', async () => {
    const input = join(base, 'late', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'a.json'), JSON.stringify({ 记录: { 欧阳明远: '复诊' } }))
    await writeFile(join(input, 'z.txt'), '家属欧阳明远陪同来院。\n')
    const root = join(base, 'late', 'out')
    const llm = scripted({ detect: finding(['欧阳明远']) })
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'late', llm, concurrency: 1 } })
    await noOriginal(root, 'late', ['欧阳明远'])
    assert.equal(run.totals.filesReview, run.files.filter((file) => file.status === 'review').length)
  })

  await check('#39/#30 JSON 键是手机号（规则命中）：输出与报告不含原值', async () => {
    const input = join(base, 'phone', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'p.json'), JSON.stringify({ 13800138000: { 备注: '回访' } }))
    const root = join(base, 'phone', 'out')
    await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'phone' } })
    await noOriginal(root, 'phone', ['13800138000'])
  })

  await check('#39 普通临床键名（日期、检验项目、剂量）不误报', async () => {
    const input = join(base, 'plain', 'in')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'r.json'), JSON.stringify({
      姓名: '张三', '2023-01-05': { 血红蛋白: '120 g/L', 'WBC 10^9/L': 6.1 }, 阿司匹林: '100mg qd', 体温: '37.5',
    }))
    const root = join(base, 'plain', 'out')
    const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'plain' } })
    assert.equal(run.files[0].status, 'clean', JSON.stringify(run.files[0].issues))
    assert.ok(!run.files[0].issues.some((item) => item.code === 'key-identifier'))
    const out = JSON.parse(await deliveredJson(run, 'r.json'))
    assert.deepEqual(Object.keys(out), ['姓名', '2023-01-05', '阿司匹林', '体温'])
  })
}

async function main() {
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  await testOutputNames()
  await testLastChunk()
  await testVerifierFindings()
  await testRecheckWrite()
  await testStoppedInputName()
  await testErrorText()
  await testLabelsAndReasons()
  await testReasonCut()
  await testJsonKeys()
  if (failures > 0) {
    console.log(`\n${failures} FAILED`)
    process.exit(1)
  }
  console.log('\nFIX2-PIPELINE PASS')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
