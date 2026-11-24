/**
 * What the batch did not check is listed, item by item: unsupported files,
 * hidden entries, links and DICOM pixels hold the result until acknowledged;
 * system files and what the settings skip or keep are only listed.
 * Run: node test/unchecked.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listInputFiles, runBatch } from '../lib/pipeline.js'
import { createService } from '../lib/service.js'
import { closeRecords, openRecords } from '../lib/records.js'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'unchecked')
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

async function put(root, rel, text = 'x') {
  await mkdir(dirname(join(root, rel)), { recursive: true })
  await writeFile(join(root, rel), text)
}

// An input with a bit of everything that is not taken as input.
const input = join(tmp, 'in')
await put(input, 'note.txt', '患者张三，电话13800138000。\n')
await put(input, 'rec.json', JSON.stringify([{ ID: 'R1', NOTE: '复诊', CODE: 'A01' }]))
await put(input, '检查报告.pdf')
await put(input, 'scan.jpg')
await put(input, '.secret.txt', '患者李四')
await put(input, '.git/config')
await put(input, 'node_modules/x/index.js')
await put(input, '.DS_Store')
await put(input, 'sub/._note.txt')
await put(input, '__MACOSX/a.txt')
await symlink('../note.txt', join(input, 'sub', 'link.txt'))

await check('输入扫描：不支持的、隐藏的、快捷方式、系统文件都记下路径', async () => {
  const listing = await listInputFiles(input)
  const rel = (paths) => paths.map((path) => path.slice(input.length + 1)).sort()
  assert.deepEqual(rel(listing.files), ['note.txt', 'rec.json'])
  assert.deepEqual(rel(listing.unsupported.paths), ['scan.jpg', '检查报告.pdf'])
  assert.deepEqual(rel(listing.hidden.paths), ['.git/', '.secret.txt', 'node_modules/'])
  assert.deepEqual(rel(listing.links.paths), ['sub/link.txt'])
  assert.deepEqual(rel(listing.system.paths), ['.DS_Store', '__MACOSX/', 'sub/._note.txt'])
})

const root = join(tmp, 'out')
const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'u-1', llm: null, policy: { skipFields: ['CODE'], identifierPolicy: { phone: 'keep' } } } })

await check('批次：没处理的文件各成一条批次复核项，交付暂扣', async () => {
  assert.equal(run.status, 'review')
  assert.equal(run.withheld, true)
  assert.deepEqual({ ...run.skipped, unsupportedByExt: undefined }, { unsupported: 2, unsupportedByExt: undefined, overLimit: 0, dicomdir: 0, zipFailed: 0, hidden: 3, links: 1, system: 3 })
  assert.equal(run.unchecked.skippedFields.CODE, 1)
  assert.deepEqual(run.unchecked.keptTypes, ['电话'])
  const store = await openRecords(join(root, '_records'))
  const batch = (await store.getReviewFiles('u-1')).find((file) => file.batch)
  const byCode = Object.fromEntries(batch.items.map((item) => [item.code, item]))
  assert.deepEqual(Object.keys(byCode).sort(), ['hidden-files', 'kept-identifiers', 'linked-files', 'skipped-field', 'system-files', 'unsupported-files'])
  assert.deepEqual(byCode['unsupported-files'].paths.sort(), ['scan.jpg', '检查报告.pdf'])
  assert.deepEqual(byCode['hidden-files'].paths.sort(), ['.git/', '.secret.txt', 'node_modules/'])
  assert.deepEqual(byCode['linked-files'].paths, ['sub/link.txt'])
  assert.equal(byCode['skipped-field'].field, 'CODE')
  assert.deepEqual(byCode['skipped-field'].paths, ['rec.json'])
  // Listed only: never held.
  for (const code of ['system-files', 'skipped-field', 'kept-identifiers']) assert.equal(byCode[code].info, true, code)
  for (const code of ['unsupported-files', 'hidden-files', 'linked-files']) assert.ok(!byCode[code].info, code)
  // Held items count as open review items.
  const fileErrors = run.files.flatMap((file) => file.issues).filter((issue) => issue.severity === 'error').length
  assert.equal(run.totals.unresolved, fileErrors + 3)
  await closeRecords()
})

await check('报告：列出未检查内容的数量，不含文件名', async () => {
  const md = await readFile(join(root, '_records', 'runs', 'u-1', 'report.md'), 'utf8')
  assert.match(md, /### 未检查的内容/)
  assert.match(md, /不支持的文件 2 个/)
  assert.match(md, /隐藏文件或文件夹 3 个/)
  assert.match(md, /快捷方式（符号链接）或特殊文件 1 个/)
  assert.match(md, /操作系统生成的文件 3 个/)
  assert.match(md, /CODE（1 个值）/)
  for (const name of ['report.md', 'report.json']) {
    const text = await readFile(join(root, '_records', 'runs', 'u-1', name), 'utf8')
    for (const secret of ['检查报告', 'secret', 'link.txt', '._note']) assert.ok(!text.includes(secret), `${secret} in ${name}`)
  }
})

await check('复核：只列出的项不能处理；没处理的文件只能「已知晓」；全部确认后才交付', async () => {
  const service = createService({ config: { outputRoot: root }, defaultDirectory: tmp })
  const data = await service.reviewItems('u-1')
  const batch = data.files.find((file) => file.batch)
  const item = (code) => batch.items.find((entry) => entry.code === code)
  await assert.rejects(service.reviewDecide('u-1', item('system-files').id, 'accept'), /只是列出/)
  await assert.rejects(service.reviewDecide('u-1', item('unsupported-files').id, 'remove'), /已知晓/)
  // Bulk actions never settle skipped files.
  const bulk = await service.reviewBulk('u-1', batch.items.map((entry) => entry.id), 'accept')
  assert.equal(bulk.decided, 0)
  // Every other open item first (rule-only run: whatever it left).
  for (const file of data.files.filter((entry) => !entry.batch)) {
    for (const entry of file.items) await service.reviewDecide('u-1', entry.id, 'accept')
  }
  let last = null
  for (const code of ['unsupported-files', 'hidden-files', 'linked-files']) last = await service.reviewDecide('u-1', item(code).id, 'accept')
  assert.equal(last.completed, true)
  assert.equal(last.status, 'completed')
  assert.deepEqual((await readdir(root)).sort(), ['_records', 'output'])
  // Skipped files are not delivered.
  const delivered = await readdir(join(root, 'output', 'in'))
  assert.ok(!delivered.some((name) => /pdf|jpg|^\./.test(name)), delivered.join(','))
})

await check('只有系统文件和按设置跳过的字段：不阻塞，批次直接完成', async () => {
  const quiet = join(tmp, 'quiet')
  await put(quiet, 'rec.json', JSON.stringify([{ ID: 'R1', NOTE: '复诊', CODE: 'A01' }]))
  await put(quiet, '.DS_Store')
  await put(quiet, 'Thumbs.db')
  const out = join(tmp, 'quiet-out')
  const done = await runBatch({ inputDir: quiet, outputRoot: out, options: { runId: 'u-2', llm: null, policy: { skipFields: ['CODE'] } } })
  assert.equal(done.status, 'completed', JSON.stringify(done.files.map((file) => file.issues)))
  assert.equal(done.totals.unresolved, 0)
  assert.equal(done.skipped.system, 2)
  assert.deepEqual((await readdir(out)).sort(), ['_records', 'output'])
  const store = await openRecords(join(out, '_records'))
  const batch = (await store.getReviewFiles('u-2')).find((file) => file.batch)
  assert.deepEqual(batch.items.map((entry) => entry.code).sort(), ['skipped-field', 'system-files'])
  await closeRecords()
})

await rm(tmp, { recursive: true, force: true })
console.log(failures === 0 ? 'UNCHECKED PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
