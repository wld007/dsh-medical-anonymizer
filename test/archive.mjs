/**
 * End-to-end: zip input (nested zip included), identifiers in file and folder
 * names, write guard, and source protection. Synthetic data only.
 * Run: node test/archive.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBatch, cleanStaleStaging } from '../lib/pipeline.js'
import { readZip, writeZip } from '../lib/zip.js'
import { createWriteGuard } from '../lib/guard.js'
import { outDirOf, outJoin } from './outputs.mjs'
import { snapshotTree } from './snapshot.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'archive')
const input = join(tmp, 'in')
const outRoot = join(tmp, 'out')

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

function idCard(base17) {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const sum = [...base17].reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0)
  return base17 + '10X98765432'[sum % 11]
}

const NAME = '张三'
const ID = idCard('11010519491231002')
const json = (value) => Buffer.from(JSON.stringify(value, null, 2))

await rm(tmp, { recursive: true, force: true })
await mkdir(input, { recursive: true })

const inner = join(tmp, 'inner.zip')
await writeZip(inner, [
  { name: '检验/202001/p_doc_gehr_test_rcd.json', data: json([{ PTT_NM: NAME, ITM_NM: '血红蛋白', ITM_VLU: '130' }]) },
])
await writeZip(join(input, `64_${NAME}_${ID}.zip`), [
  { name: '住院/GEHR-住院就诊记录/202001/p_doc_gehr_inhos_vst_rcd.json', data: json([{ PTT_NM: NAME, ID_CRD_NO: ID, DIAG_NM: '2型糖尿病' }]) },
  { name: '门诊/note.txt', data: Buffer.from(`姓名：${NAME}\n身份证号：${ID}\n诊断：高血压\n`) },
  { name: '其他/嵌套.zip', data: await readFile(inner) },
  { name: '其他/说明.pdf', data: Buffer.from('not a pdf') },
])
await mkdir(join(input, 'patient_573999', 'stays', 'zyh_1008599'), { recursive: true })
await writeFile(join(input, 'patient_573999', 'stays', 'zyh_1008599', 'disease.json'), json([{ icd10: 'E11.9', name: '2型糖尿病' }]))
await rm(inner)

const before = await snapshotTree(input)
const stagingBefore = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('dsh-anon-')))
const run = await runBatch({ inputDir: input, outputRoot: outRoot, options: { runId: 'arch', maxFiles: 2 } })
const outputDir = outJoin(await outDirOf(outRoot, 'arch'))

async function listTree(dir, prefix = '') {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...await listTree(join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out
}

await check('批次完成，压缩包内文件与普通文件都处理', () => {
  assert.notEqual(run.status, 'failed', run.error)
  assert.equal(run.archives.length, 2)
  assert.equal(run.totals.files, 4)
  assert.equal(run.skipped.unsupported, 1) // the pdf inside the zip
})

const outFiles = await listTree(outputDir)
await check('输出路径不含姓名、身份证号、住院号、病人编号', () => {
  const joined = outFiles.join('\n')
  for (const secret of [NAME, ID, '573999', '1008599']) assert.ok(!joined.includes(secret), `${secret} in ${joined}`)
  assert.ok(outFiles.some((path) => /^64_化名-[0-9A-F]{6}_证件-[0-9A-F]{6}\.zip$/.test(path)), joined)
  assert.ok(outFiles.some((path) => /^patient_病历-[0-9A-F]{6}\/stays\/zyh_住院-[0-9A-F]{6}\/disease\.json$/.test(path)), joined)
})

await check('输出压缩包可读，包内内容已匿名化，嵌套包也已处理', async () => {
  const zipName = outFiles.find((path) => path.endsWith('.zip'))
  const { entries } = await readZip(join(outputDir, zipName))
  const names = entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name).sort()
  assert.deepEqual(names, ['住院/GEHR-住院就诊记录/202001/p_doc_gehr_inhos_vst_rcd.json', '其他/嵌套.zip', '门诊/note.txt'])
  for (const entry of entries.filter((item) => item.name.endsWith('.json') || item.name.endsWith('.txt'))) {
    const text = entry.data.toString('utf8')
    assert.ok(!text.includes(NAME) && !text.includes(ID), `${entry.name}: ${text}`)
  }
  const record = JSON.parse(entries.find((entry) => entry.name.endsWith('.json')).data.toString('utf8'))
  assert.equal(record[0].DIAG_NM, '2型糖尿病')
  const nestedZip = entries.find((entry) => entry.name.endsWith('嵌套.zip'))
  const dir = join(tmp, 'nested-check')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'n.zip'), nestedZip.data)
  const nested = await readZip(join(dir, 'n.zip'))
  const text = nested.entries.find((entry) => entry.name.endsWith('.json')).data.toString('utf8')
  assert.ok(!text.includes(NAME), text)
  assert.ok(text.includes('血红蛋白'))
})

await check('诊断等临床内容未被替换', async () => {
  const path = outFiles.find((item) => item.endsWith('disease.json'))
  const record = JSON.parse(await readFile(join(outputDir, path), 'utf8'))
  assert.equal(record[0].name, '2型糖尿病')
})

await check('报告不含原值，路径对照单独保存', async () => {
  const report = await readFile(join(outRoot, '_records', 'runs', 'arch', 'report.md'), 'utf8')
  const reportJson = await readFile(join(outRoot, '_records', 'runs', 'arch', 'report.json'), 'utf8')
  for (const secret of [NAME, ID, '573999', '1008599']) {
    assert.ok(!report.includes(secret), `report.md contains ${secret}`)
    assert.ok(!reportJson.includes(secret), `report.json contains ${secret}`)
  }
  const map = JSON.parse(await readFile(join(outRoot, '_records', 'runs', 'arch', 'path-map.json'), 'utf8'))
  assert.ok(map.prefixes.some((entry) => entry.original.includes(ID)))
  assert.ok(run.paths.renamed >= 3)
})

await check('超过 maxFiles 自动分组', () => {
  assert.equal(run.chunks, 2)
})

await check('源文件（含压缩包）逐字节不变', async () => {
  assert.deepEqual(await snapshotTree(input), before)
  assert.equal(run.sourceCheck.changed, 0)
  assert.equal(run.sourceCheck.files, 2)
})

await check('临时解压目录已清理', async () => {
  // Only folders this test created: a real batch may be running alongside.
  const leftovers = (await readdir(tmpdir())).filter((name) => name.startsWith('dsh-anon-') && !stagingBefore.has(name))
  assert.deepEqual(leftovers, [])
})

await check('被强制结束的运行留下的解压目录会被清理，运行中的不动', async () => {
  const root = join(tmp, 'staging-root')
  await mkdir(join(root, 'dsh-anon-dead', '0'), { recursive: true })
  await writeFile(join(root, 'dsh-anon-dead', '.owner'), '999999')
  await writeFile(join(root, 'dsh-anon-dead', '0', 'record.json'), '{}')
  await mkdir(join(root, 'dsh-anon-live'), { recursive: true })
  await writeFile(join(root, 'dsh-anon-live', '.owner'), String(process.pid))
  await mkdir(join(root, 'other'), { recursive: true })
  assert.equal(await cleanStaleStaging(root), 1)
  assert.deepEqual((await readdir(root)).sort(), ['dsh-anon-live', 'other'])
})

await check('写入守卫拒绝输入目录与输出根之外', async () => {
  const guard = await createWriteGuard({ inputRoots: [input], outputRoot: outRoot })
  await assert.rejects(guard.check(join(input, 'patient_573999', 'x.json')), /拒绝写入/)
  await assert.rejects(guard.check(join(tmp, 'elsewhere.json')), /拒绝写入/)
  await guard.check(join(outRoot, '_records', 'runs', 'x', 'output', 'a.json'))
  await assert.rejects(createWriteGuard({ inputRoots: [input], outputRoot: input }), /不能与输入相同/)
  // Output root nested in the input (conventional hidden folder) is allowed,
  // but writing next to the input files still is not.
  const nested = await createWriteGuard({ inputRoots: [input], outputRoot: join(input, '.medical-anonymizer') })
  await nested.check(join(input, '.medical-anonymizer', 'runs', 'a.json'))
  await assert.rejects(nested.check(join(input, 'a.json')), /拒绝写入/)
})

await check('损坏的压缩包只报告类别，不泄露包内文件名', async () => {
  const badIn = join(tmp, 'bad-in')
  await mkdir(badIn, { recursive: true })
  const good = join(tmp, 'evil.zip')
  await writeZip(good, [{ name: `${NAME}/记录.json`, data: json({ a: 1 }) }])
  const bytes = await readFile(good)
  // Corrupt the stored CRC of the only entry (central directory copy).
  const central = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  bytes[central + 16] ^= 0xff
  const local = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  bytes[local + 14] ^= 0xff
  await writeFile(join(badIn, 'bad.zip'), bytes)
  const bad = await runBatch({ inputDir: badIn, outputRoot: join(tmp, 'bad-out'), options: { runId: 'bad' } })
  assert.equal(bad.skipped.zipFailed, 1)
  assert.equal(bad.status, 'review')
  const report = await readFile(join(tmp, 'bad-out', '_records', 'runs', 'bad', 'report.md'), 'utf8')
  assert.ok(!report.includes(NAME), report)
  assert.match(report, /无法解压/)
})

await check('待复核文件单独取出到 _records/runs/<批次>/review，成品 zip 不变', async () => {
  const revIn = join(tmp, 'rev-in')
  await mkdir(revIn, { recursive: true })
  await writeZip(join(revIn, 'pack.zip'), [
    { name: 'a/ok.json', data: json([{ note: '一切正常' }]) },
    { name: 'a/bad.json', data: json([{ note: '仍有可疑内容：甲乙丙' }]) },
  ])
  // Verification keeps flagging text the model never "discovered", with one
  // round only, so bad.json ends as Needs review.
  const stubborn = {
    model: 'scripted',
    async chatJson(messages) {
      const prompt = messages.map((message) => message.content).join('\n')
      const segments = JSON.parse(prompt.slice(prompt.lastIndexOf('段落：') + 3))
      if (!prompt.includes('检查下面脱敏后的文本')) return { json: { entities: [] } }
      return { json: { issues: segments.filter((seg) => String(seg.text).includes('甲乙丙')).map((seg) => ({ segment: seg.id, type: '姓名', text: '甲乙丙', reason: 'x' })) } }
    },
  }
  const revRoot = join(tmp, 'rev-out')
  const rev = await runBatch({ inputDir: join(revIn, 'pack.zip'), outputRoot: revRoot, options: { runId: 'rev', llm: stubborn, maxRounds: 1 } })
  assert.equal(rev.status, 'review', JSON.stringify(rev.files.map((f) => [f.relPath, f.status, f.issues])))
  const reviewDir = join(revRoot, '_records', 'runs', 'rev', 'review')
  assert.deepEqual(await readdir(join(reviewDir, 'pack (zip)', 'a')), ['bad.json'])
  assert.equal(rev.output, join(revRoot, 'pack.zip'))
  const { entries } = await readZip(rev.output)
  assert.deepEqual(entries.map((entry) => entry.name).sort(), ['a/bad.json', 'a/ok.json'])
  const report = await readFile(join(revRoot, '_records', 'runs', 'rev', 'report.md'), 'utf8')
  assert.ok(report.includes(reviewDir), report)
})

await rm(tmp, { recursive: true, force: true })
if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`)
  process.exit(1)
}
console.log('ARCHIVE PASS')
