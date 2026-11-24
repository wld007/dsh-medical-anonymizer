/**
 * EMR document container ("B\tCaseDocdata\t", stored base64 › base64 in a
 * JSON field): the record body (UTF-8 XML) and the template sections (GBK)
 * are read, anonymized and written back in the same container, with each
 * length moved by exactly as many bytes as its section changed.
 * Run: node test/casedoc.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadDocument } from '../lib/formats.js'
import { layered } from '../lib/layers.js'
import { runBatch } from '../lib/pipeline.js'
import { resolvePolicy } from '../lib/policy.js'
import { openRecords, closeRecords } from '../lib/records.js'
import { outDirOf, outJoin } from './outputs.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'casedoc')
await rm(tmp, { recursive: true, force: true })
await mkdir(tmp, { recursive: true })

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

const gbk = new TextDecoder('gbk')
/** GBK bytes of a text (test only: the characters used here). */
function gbkBytes(text) {
  const table = new Map()
  for (let hi = 0x81; hi <= 0xfe; hi += 1) for (let lo = 0x40; lo <= 0xfe; lo += 1) {
    if (lo === 0x7f) continue
    const ch = gbk.decode(Uint8Array.of(hi, lo))
    if (ch.length === 1 && !table.has(ch)) table.set(ch, [hi, lo])
  }
  const out = []
  for (const ch of text) { const code = ch.codePointAt(0); if (code < 0x80) out.push(code); else out.push(...table.get(ch)) }
  return Buffer.from(out)
}

const hex = (n) => n.toString(16).padStart(10, '0')
/** A container; `skew` adds to the recorded length of worddata (as some writers do). */
function container({ body, instance, skew = 0 }) {
  const names = ['head', 'worddata', 'instanceref']
  const tags = Buffer.from(names.join('\r\n') + '\r\n', 'latin1')
  const sections = [
    ['head', Buffer.from('<?xml version="1.0" encoding="gb2312"?><contents TemplateTblName="chtemplate" DBid="0" version="v1.0.0"></contents>', 'utf8')],
    ['worddata', Buffer.from(body, 'utf8'), skew],
    ['instanceref', gbkBytes(instance)],
  ]
  const parts = [Buffer.from('B\tCaseDocdata\t', 'latin1'), Buffer.from(`taglists\t${hex(tags.length)}`, 'latin1'), tags]
  for (const [name, bytes, off = 0] of sections) parts.push(Buffer.from(`${name}\t${hex(bytes.length + off)}`, 'latin1'), bytes)
  return Buffer.concat(parts)
}
const field = (bytes) => Buffer.from(bytes.toString('base64'), 'utf8').toString('base64')
/** Sections of a container: name → { declared, bytes }. */
function sectionsOf(bytes) {
  const s = bytes.toString('latin1')
  const out = {}
  for (const name of ['head', 'worddata', 'instanceref']) {
    const at = s.indexOf(`${name}\t`, 30)
    const start = at + name.length + 11
    const next = ['head', 'worddata', 'instanceref'][['head', 'worddata', 'instanceref'].indexOf(name) + 1]
    const end = next ? s.indexOf(`${next}\t`, start) : bytes.length
    out[name] = { declared: parseInt(s.slice(at + name.length + 1, start), 16), bytes: bytes.subarray(start, end) }
  }
  return out
}

const BODY = '<?xml version="1.0" encoding="UTF-8"?>\r\n<uwword fileformat="1.0"><section><p style="Normal"><c>患者张三，男，45岁，联系电话13800138000。</c></p><p><c>主诉：反复咳嗽三天。</c></p></section></uwword>\r\n'
const INSTANCE = '<elements> <姓名><RA_姓名><RB_姓名 Reference="张三"/></RA_姓名></姓名></elements>'

await check('容器内的正文（UTF-8）和模板分段（GBK）都能读出；未改动时逐字节一致', async () => {
  const path = join(tmp, 'read.json')
  const raw = JSON.stringify([{ ID: 'R1', RECORDCONTENT: field(container({ body: BODY, instance: INSTANCE })) }])
  await writeFile(path, raw)
  const doc = layered(await loadDocument(path, 'read.json'))
  const text = doc.segments().map((segment) => segment.text).join('\n')
  assert.match(text, /患者张三/)
  assert.match(text, /13800138000/)
  assert.ok(doc.segments().some((segment) => /casedoc/.test(segment.via ?? '')))
  assert.equal(doc.opaque().length, 0, JSON.stringify(doc.opaque()))
  assert.equal(doc.serialize(), raw)
})

await check('长度记录偏差的容器（按下一段标记切分）也能读出、写回，偏差保持不变', async () => {
  const path = join(tmp, 'skew.json')
  await writeFile(path, JSON.stringify([{ ID: 'R1', RECORDCONTENT: field(container({ body: BODY, instance: INSTANCE, skew: -16 })) }]))
  const doc = layered(await loadDocument(path, 'skew.json'))
  const segment = doc.segments().find((item) => item.text.includes('张三') && /casedoc/.test(item.via ?? ''))
  assert.ok(segment)
  const at = segment.text.indexOf('张三')
  assert.equal(doc.apply([{ id: segment.id, start: at, end: at + 2, original: '张三', replacement: '化名-1A2B3C' }]), 1)
  const out = JSON.parse(doc.serialize())[0].RECORDCONTENT
  const bytes = Buffer.from(Buffer.from(out, 'base64').toString('utf8'), 'base64')
  const { worddata } = sectionsOf(bytes)
  assert.match(worddata.bytes.toString('utf8'), /化名-1A2B3C/)
  assert.equal(worddata.declared, worddata.bytes.length - 16)
})

await check('批次处理：正文和 GBK 分段里的标识符被替换，按原容器、原编码写回', async () => {
  const input = join(tmp, 'in')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'emr.json'), JSON.stringify([{ ID: 'R1', RECORDCONTENT: field(container({ body: BODY, instance: INSTANCE })) }]))
  const root = join(tmp, 'out')
  const run = await runBatch({ inputDir: join(input, 'emr.json'), outputRoot: root, options: { runId: 'casedoc', maxRounds: 2, llm: null } })
  const file = run.files[0]
  assert.equal(file.issues.filter((issue) => issue.code === 'opaque').length, 0, JSON.stringify(file.issues))
  const out = JSON.parse(await readFile(outJoin(await outDirOf(root, 'casedoc'), 'emr.json'), 'utf8'))
  const bytes = Buffer.from(Buffer.from(out[0].RECORDCONTENT, 'base64').toString('utf8'), 'base64')
  assert.equal(bytes.subarray(0, 14).toString('latin1'), 'B\tCaseDocdata\t')
  const sections = sectionsOf(bytes)
  const body = sections.worddata.bytes.toString('utf8')
  assert.ok(!body.includes('13800138000'), 'phone left in body')
  assert.match(body, /主诉：反复咳嗽三天/)
  assert.match(body, /^<\?xml[\s\S]*<\/uwword>\r\n$/)
  for (const [name, section] of Object.entries(sections)) assert.equal(section.declared, section.bytes.length, name)
  // The GBK section is still GBK.
  assert.match(new TextDecoder('gbk', { fatal: true }).decode(sections.instanceref.bytes), /<RB_姓名 Reference=/)
})

await check('续跑：0.11.3–0.11.5 的逐文件结果，普通文件照旧沿用，含无法识别二进制内容的文件重新处理', async () => {
  const input = join(tmp, 'resume-in')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'a-note.txt'), '患者李四，联系电话 13900139000。\n')
  await writeFile(join(input, 'b-emr.json'), JSON.stringify([{ ID: 'R1', RECORDCONTENT: field(container({ body: BODY, instance: INSTANCE })) }]))
  const root = join(tmp, 'resume-out')
  // Stopped once both files are done (one at a time): both results are kept.
  const controller = new AbortController()
  let done = 0
  const first = await runBatch({
    inputDir: input, outputRoot: root, signal: controller.signal, options: { runId: 'cd-1', concurrency: 1, llm: null },
    onEvent: ({ phase }) => { if (phase === 'file-done' && (done += 1) >= 2) controller.abort() },
  })
  assert.equal(first.status, 'cancelled')
  const store = await openRecords(join(root, '_records'))
  const rows = await store.getFileResults('cd-1')
  assert.equal(rows.size, 2)
  // As written by 0.11.3–0.11.5: their config key, and the container left unreadable.
  const legacy = createHash('sha256').update(JSON.stringify({ policy: resolvePolicy({}), maxRounds: 3, maxFileBytes: 30_000_000, version: '0.11.3' })).digest('hex').slice(0, 16)
  for (const [relPath, row] of rows) {
    const data = structuredClone(row.data)
    if (relPath.endsWith('.json')) data.file.issues = [...(data.file.issues ?? []), { severity: 'error', code: 'opaque', detail: '无法检查的内容：无法识别的二进制内容 ×1（约 1 KB，位于 base64›utf8›base64（字段 RECORDCONTENT））' }]
    await store.putFileResult('cd-1', { relPath, outRel: row.outRel, print: row.print, config: legacy, status: row.status, data })
  }
  const resumed = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'cd-2', resumeFrom: 'cd-1', concurrency: 1, llm: null } })
  assert.equal(resumed.status, 'completed', JSON.stringify(resumed.warnings))
  assert.equal(resumed.totals.reusedFiles, 1)
  const reused = resumed.files.filter((file) => file.reused).map((file) => file.relPath)
  assert.deepEqual(reused, ['a-note.txt'])
  await closeRecords()
})

await rm(tmp, { recursive: true, force: true })
console.log(failures === 0 ? 'CASEDOC PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
