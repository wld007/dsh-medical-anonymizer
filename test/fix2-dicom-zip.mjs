/**
 * Regression tests for review findings #26, #33, #34, #35 (DICOM and zip).
 * Synthetic data only. Run: node test/fix2-dicom-zip.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { processDicomFile } from '../lib/dicom/index.js'
import { parseDicomBuffer, decodeAscii } from '../lib/dicom/codec.js'
import { dictVr, verifyHeader, remapUid } from '../lib/dicom/profile.js'
import { charsetDecoder } from '../lib/dicom/codec.js'
import { runBatch } from '../lib/pipeline.js'
import * as zipLib from '../lib/zip.js'
import { el, encode, part10, CT } from './dicom-fixtures.mjs'
import { reviewFilesOf, pathMapOf, compareTextOf, recordsOf } from './records-read.mjs'

// Namespace import so the file still loads (and fails per check) on a tree
// without createZipBudget.
const { readZip, extractZip, writeZip, crc32, createZipBudget } = zipLib
const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'fix2-dicom-zip')

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

const SALT = 'fix2-salt'
const RUN_KEY = Buffer.from('0123456789abcdef0123456789abcdef')
const IMPLICIT = '1.2.840.10008.1.2'
const EXPLICIT = '1.2.840.10008.1.2.1'
const ORIGINAL_UID = '1.2.392.200036.9116.2.5.1.37.2417525831.1698710000.999999'
const sortByTag = (list) => list.sort((a, b) => a.tag.localeCompare(b.tag))

let counter = 0
async function runDicom(buffer, { policy, name } = {}) {
  const dir = join(tmp, `d${++counter}`)
  await mkdir(join(dir, 'in'), { recursive: true })
  const path = join(dir, 'in', name ?? 'x.dcm')
  await writeFile(path, buffer)
  const file = await processDicomFile({
    path, relPath: name ?? 'x.dcm', outputDir: join(dir, 'out'), salt: SALT, runKey: RUN_KEY, shiftDays: 10, policy,
  })
  let output = null
  try { output = await readFile(join(dir, 'out', name ?? 'x.dcm')) } catch { /* not written */ }
  return { file, output }
}

const contains = (buffer, text) => buffer.includes(Buffer.from(text, 'latin1'))

/** An implicit-VR LE sequence item (defined length) holding `elements`. */
function implicitItem(elements) {
  const content = encode(elements, false)
  const header = Buffer.alloc(8)
  header.writeUInt16LE(0xFFFE, 0)
  header.writeUInt16LE(0xE000, 2)
  header.writeUInt32LE(content.length, 4)
  return Buffer.concat([header, content])
}

function baseDataset(sop, extra) {
  return sortByTag([
    el('00080016', 'UI', CT),
    el('00080018', 'UI', sop),
    el('00080060', 'CS', 'CT'),
    el('00100010', 'PN', 'TEST^PATIENT'),
    el('00100020', 'LO', 'P0012345'),
    el('0020000D', 'UI', '1.2.392.200036.9116.2.5.1.37.2417525831.1698710000.1'),
    ...extra,
  ])
}

async function main() {
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })

  /* ------------------------------------------------------------- #26 */

  const staff = [
    el('0008009C', 'PN', 'CONSULT^DOCTOR'),
    el('300600A6', 'PN', 'ROI^INTERPRETER'),
    el('0040A027', 'LO', 'Verifying Org Hospital'),
    el('00404035', 'SQ', [[
      el('00404036', 'LO', 'Peking Union Hospital'),
      el('00404037', 'PN', 'PERFORMER^NAME'),
    ]]),
  ]
  for (const [label, explicit, ts] of [['隐式 VR', false, IMPLICIT], ['显式 VR', true, EXPLICIT]]) {
    await check(`#26 ${label}：字典外的医生/执行者姓名、机构被删除`, async () => {
      const sop = `1.2.3.26.${explicit ? 1 : 2}`
      const { file, output } = await runDicom(part10({
        sopClass: CT, sopInstance: sop, ts, explicit, dataset: baseDataset(sop, staff),
      }))
      assert.ok(output, `written (${file.status})`)
      for (const text of ['CONSULT', 'INTERPRETER', 'PERFORMER', 'Peking Union', 'Verifying Org']) {
        assert.ok(!contains(output, text), `${text} removed`)
      }
    })
  }

  await check('#26 隐式 VR：字典外的标准字段含自由文本（人名样式、中文、混合大小写）被删除并提示', async () => {
    const sop = '1.2.3.26.3'
    const gbkName = Buffer.from([0xD5, 0xC5, 0xC8, 0xFD]) // 张三 (GB18030)
    const { file, output } = await runDicom(part10({
      sopClass: CT, sopInstance: sop, ts: IMPLICIT, explicit: false,
      dataset: baseDataset(sop, [
        el('00080005', 'CS', 'GB18030'),
        el('0032FF10', 'UN', 'SOMEONE^ELSE'),
        el('0032FF12', 'UN', gbkName),
        el('0032FF14', 'UN', 'Dr Wang at the clinic'),
        el('0032FF16', 'UN', 'ABC_CODE'), // code string: kept
        el('0032FF18', 'UN', '12.5\\-3.25E2'), // numbers: kept
      ]),
    }))
    assert.ok(output)
    assert.ok(!contains(output, 'SOMEONE'), 'person-name style text removed')
    assert.ok(!output.includes(gbkName), 'CJK text removed')
    assert.ok(!contains(output, 'Dr Wang'), 'free text removed')
    assert.ok(contains(output, 'ABC_CODE'), 'code string kept')
    assert.ok(contains(output, '12.5\\-3.25E2'), 'numeric string kept')
    const issue = file.issues.find((item) => item.code === 'dicom-unknown')
    assert.ok(issue, 'a notice lists the removed unknown attributes')
    assert.ok(!/SOMEONE|Dr Wang|张三/.test(issue.detail), 'notice holds no original value')
  })

  await check('#26 隐式 VR：常见影像参数（光度解释、卷积核、对比剂、窗宽窗位）不被误删', async () => {
    const sop = '1.2.3.26.4'
    const { output } = await runDicom(part10({
      sopClass: CT, sopInstance: sop, ts: IMPLICIT, explicit: false,
      dataset: baseDataset(sop, [
        el('00180010', 'LO', 'Omnipaque 350'),
        el('00181210', 'SH', 'B30f'),
        el('00280004', 'CS', 'MONOCHROME2'),
        el('00281050', 'DS', '40'),
        el('00281054', 'LO', 'HU'),
        el('00200037', 'DS', '1\\0\\0\\0\\1\\0'),
      ]),
    }))
    assert.ok(output)
    for (const text of ['Omnipaque 350', 'B30f', 'MONOCHROME2', '1\\0\\0\\0\\1\\0']) assert.ok(contains(output, text), `${text} kept`)
  })

  await check('#26 隐式 VR：大写空格分隔的人名（像代码）不被当作代码保留；多值代码保留', async () => {
    const sop = '1.2.3.26.5'
    const { file, output } = await runDicom(part10({
      sopClass: CT, sopInstance: sop, ts: IMPLICIT, explicit: false,
      dataset: baseDataset(sop, [
        el('0032FF22', 'UN', 'ZHANG SAN'),
        el('0032FF24', 'UN', 'ORIGINAL\\PRIMARY\\AXIAL'),
        el('0032FF26', 'UN', 'SERIES 2'),
      ]),
    }))
    assert.ok(output, `written (${file.status})`)
    assert.ok(!contains(output, 'ZHANG SAN'), 'name-like text removed')
    assert.ok(contains(output, 'ORIGINAL\\PRIMARY\\AXIAL'), 'multi-valued code kept')
    assert.ok(contains(output, 'SERIES 2'), 'code with a digit kept')
  })

  await check('#26 显式 VR：PN 字段被写成错误 VR（LO）时仍按字典删除', async () => {
    const sop = '1.2.3.26.6'
    const { file, output } = await runDicom(part10({
      sopClass: CT, sopInstance: sop, ts: EXPLICIT, explicit: true,
      dataset: baseDataset(sop, [el('0008009C', 'LO', 'WRONGVR^DOCTOR'), el('300600A6', 'UN', 'UNVR^READER')]),
    }))
    assert.ok(output, `written (${file.status})`)
    assert.ok(!contains(output, 'WRONGVR'))
    assert.ok(!contains(output, 'UNVR'))
    assert.ok(!file.issues.some((item) => item.code === 'dicom-verify'), 'verification passes')
  })

  await check('#26 校验：PN 检查按字典判断，不只看 el.vr', async () => {
    const parsed = {
      meta: [],
      dataset: [{ tag: '00404037', group: 0x0040, element: 0x4037, vr: 'UN', implicitUnknown: true, value: Buffer.from('LEFT^OVER') }],
    }
    const checks = verifyHeader(parsed, { uids: new Set(), texts: new Set() }, charsetDecoder(''))
    assert.equal(checks.find((item) => item.name === '姓名字段').ok, false)
    assert.equal(dictVr('0008009C'), 'PN')
    assert.equal(dictVr('00404037'), 'PN')
    assert.equal(dictVr('300600A6'), 'PN')
  })

  /* ------------------------------------------------------------- #34 */

  await check('#34 显式 VR：定长 UN 序列按隐式 VR 解析，内部检查号和原始 UID 被处理', async () => {
    const sop = '1.2.3.34.1'
    const un = implicitItem([
      el('00080050', 'SH', 'ACC99887'),
      el('00081155', 'UI', ORIGINAL_UID),
      el('00100010', 'PN', 'NESTED^NAME'),
    ])
    const { file, output } = await runDicom(part10({
      sopClass: CT, sopInstance: sop, ts: EXPLICIT, explicit: true,
      dataset: baseDataset(sop, [el('00400270', 'UN', un)]),
    }))
    assert.ok(output, `written (${file.status})`)
    assert.ok(!contains(output, 'ACC99887'), 'accession number inside UN removed')
    assert.ok(!contains(output, ORIGINAL_UID), 'original UID inside UN remapped')
    assert.ok(!contains(output, 'NESTED'), 'name inside UN removed')
    assert.ok(contains(output, remapUid(ORIGINAL_UID, SALT)), 'remapped UID present')
    // The rewritten file still parses and keeps the sequence.
    const parsed = parseDicomBuffer(output, { dict: dictVr })
    const seq = parsed.dataset.find((item) => item.tag === '00400270')
    assert.ok(seq?.items?.length === 1, 'sequence kept with its item')
    assert.equal(decodeAscii(seq.items[0].elements.find((item) => item.tag === '00081155').value), remapUid(ORIGINAL_UID, SALT))
    assert.notEqual(file.status, 'failed')
  })

  await check('#34 显式 VR：已知序列标签 (0008,1140) 被写成 UN 时也会解析，嵌套 UN 同样处理', async () => {
    const sop = '1.2.3.34.2'
    const inner = implicitItem([el('00081155', 'UI', `${ORIGINAL_UID}.7`), el('00080050', 'SH', 'ACC55443')])
    const outer = implicitItem([el('00081150', 'UI', CT), el('00081155', 'UI', `${ORIGINAL_UID}.8`)])
    const { output } = await runDicom(part10({
      sopClass: CT, sopInstance: sop, ts: EXPLICIT, explicit: true,
      dataset: baseDataset(sop, [el('00081140', 'UN', outer), el('0040A370', 'UN', inner)]),
    }))
    assert.ok(output)
    assert.ok(!contains(output, `${ORIGINAL_UID}.7`))
    assert.ok(!contains(output, `${ORIGINAL_UID}.8`))
    assert.ok(!contains(output, 'ACC55443'))
    assert.ok(contains(output, CT), 'SOP class reference kept')
  })

  await check('#34 显式 VR：以条目标记开头但无法解析的 UN 不原样保留', async () => {
    const sop = '1.2.3.34.3'
    const broken = Buffer.concat([
      Buffer.from([0xFE, 0xFF, 0x00, 0xE0, 0x40, 0x00, 0x00, 0x00]), // item claims 64 bytes
      Buffer.from('ACC77665 garbage'),
    ])
    const { file, output } = await runDicom(part10({
      sopClass: CT, sopInstance: sop, ts: EXPLICIT, explicit: true,
      dataset: baseDataset(sop, [el('00400270', 'UN', broken)]),
    }))
    if (output && file.status !== 'failed') assert.ok(!contains(output, 'ACC77665'), 'unparseable UN removed')
    else assert.equal(file.status, 'failed')
  })

  await check('#34 校验：二进制 UN 中残留的原始 UID 会被发现', async () => {
    const blob = Buffer.concat([Buffer.from([1, 2, 3, 0]), Buffer.from(ORIGINAL_UID, 'latin1'), Buffer.from([0, 7])])
    const parsed = { meta: [], dataset: [{ tag: '0032FF20', group: 0x0032, element: 0xFF20, vr: 'UN', value: blob }] }
    const checks = verifyHeader(parsed, { uids: new Set([ORIGINAL_UID]), texts: new Set() }, charsetDecoder(''))
    assert.equal(checks.find((item) => item.name === 'UID').ok, false)
  })

  /* ------------------------------------------------------------- #35 */

  const PDF_SOP = '1.2.840.10008.5.1.4.1.1.104.1'
  const CDA_SOP = '1.2.840.10008.5.1.4.1.1.104.2'
  const ID = '110101199003071233'
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(`姓名：张三 身份证${ID}\n`, 'utf8'), Buffer.from('%%EOF')])
  const cda = Buffer.from(`<?xml version="1.0"?><ClinicalDocument><patient><name>张三</name><id extension="${ID}"/></patient></ClinicalDocument>`, 'utf8')
  const encapsulated = (sop, explicit, payload, mime) => part10({
    sopClass: sop, sopInstance: `1.2.3.35.${explicit ? 1 : 2}.${mime.length}`, ts: explicit ? EXPLICIT : IMPLICIT, explicit,
    dataset: sortByTag([
      el('00080016', 'UI', sop),
      el('00080018', 'UI', `1.2.3.35.${explicit ? 1 : 2}.${mime.length}`),
      el('00080060', 'CS', 'DOC'),
      el('00100010', 'PN', 'TEST^PATIENT'),
      el('00420011', 'OB', payload),
      el('00420012', 'LO', mime),
    ]),
  })

  for (const [label, sop, explicit, payload, mime] of [
    ['封装 PDF（显式 VR）', PDF_SOP, true, pdf, 'application/pdf'],
    ['封装 CDA（隐式 VR）', CDA_SOP, false, cda, 'text/XML'],
  ]) {
    await check(`#35 ${label}：默认转人工复核，不按 clean 交付`, async () => {
      const { file } = await runDicom(encapsulated(sop, explicit, payload, mime))
      assert.equal(file.status, 'review')
      const issue = file.issues.find((item) => item.code === 'dicom-document')
      assert.ok(issue, 'opaque issue raised')
      assert.equal(issue.severity, 'error')
      assert.match(issue.detail, /无法检查的内容：.+ ×1/)
      assert.ok(!issue.detail.includes(ID) && !issue.detail.includes('张三'))
    })
    await check(`#35 ${label}：配置“移除”时删除文档内容`, async () => {
      const { file, output } = await runDicom(encapsulated(sop, explicit, payload, mime), { policy: { opaquePolicy: 'remove' } })
      assert.ok(output)
      assert.ok(!contains(output, ID), 'document payload removed')
      assert.notEqual(file.status, 'review')
      assert.ok(file.issues.some((item) => item.code === 'opaque-removed' && item.severity === 'warn'))
    })
  }

  await check('#35 批次：含封装文档的 DICOM 使批次暂扣待复核', async () => {
    const input = join(tmp, 'batch35', 'in')
    const outRoot = join(tmp, 'batch35', 'out')
    await mkdir(input, { recursive: true })
    await writeFile(join(input, 'report.dcm'), encapsulated(PDF_SOP, true, pdf, 'application/pdf'))
    const run = await runBatch({ inputDir: input, outputRoot: outRoot, options: { runId: 'b35' } })
    assert.equal(run.status, 'review')
    assert.ok(run.withheld, 'not delivered before review')
    const items = await reviewFilesOf(outRoot, 'b35')
    const item = items.flatMap((file) => file.items).find((entry) => entry.code === 'dicom-document')
    assert.ok(item, 'listed for manual review')
    assert.ok(!item.baseId, 'not offered as removable embedded content')
  })

  /* ------------------------------------------------------------- #33 */

  const zipDir = join(tmp, 'zip')
  await mkdir(zipDir, { recursive: true })
  const zeros = (n) => Buffer.alloc(n)

  await check('#33 extractZip 共用预算：第二个压缩包超出累计上限被拒绝且不留文件', async () => {
    const a = join(zipDir, 'budget-a.zip')
    const b = join(zipDir, 'budget-b.zip')
    await writeZip(a, [{ name: 'a.txt', data: Buffer.from('a'.repeat(6000)) }])
    await writeZip(b, [{ name: 'b.txt', data: Buffer.from('b'.repeat(6000)) }])
    const budget = createZipBudget()
    const limits = { maxTotalBytes: 10000 }
    await extractZip(a, join(zipDir, 'budget-a'), limits, { budget })
    await assert.rejects(extractZip(b, join(zipDir, 'budget-b'), limits, { budget }), /累计.*上限/)
    assert.deepEqual(await readdir(join(zipDir, 'budget-b')).catch(() => []), [])
    // Without a shared budget each archive is judged alone.
    await extractZip(b, join(zipDir, 'budget-b2'), limits)
  })

  await check('#33 小于 1 MiB 的条目也检查压缩比', async () => {
    const path = join(zipDir, 'ratio-small.zip')
    await writeZip(path, [{ name: 'z.bin', data: zeros(512 * 1024) }])
    await assert.rejects(readZip(path, { maxRatio: 50 }), /压缩比|zip 炸弹/)
    await assert.rejects(extractZip(path, join(zipDir, 'ratio-small-out'), { maxRatio: 50 }), /压缩比|zip 炸弹/)
  })

  await check('#33 整包压缩比：许多高压缩小条目合计超限被拒绝', async () => {
    const path = join(zipDir, 'ratio-total.zip')
    await writeZip(path, Array.from({ length: 200 }, (_, i) => ({ name: `f${i}.bin`, data: zeros(32 * 1024) })))
    await assert.rejects(readZip(path, { maxRatio: 100 }), /压缩比|zip 炸弹/)
    // Ordinary text compresses well below the limit and is accepted.
    const text = join(zipDir, 'text.zip')
    await writeZip(text, [{ name: 'a.txt', data: Buffer.from('患者主诉：反复咳嗽三天。'.repeat(2000)) }])
    assert.equal((await readZip(text)).entries.length, 1)
  })

  async function nestedInput(name, innerCount, entriesPerInner, bytesPerEntry) {
    const input = join(tmp, name, 'in')
    await mkdir(input, { recursive: true })
    const inners = []
    for (let i = 0; i < innerCount; i += 1) {
      const innerPath = join(tmp, name, `inner${i}.zip`)
      await writeZip(innerPath, Array.from({ length: entriesPerInner }, (_, j) => ({
        name: `n${i}/f${j}.txt`, data: Buffer.from(`编号 ${i}-${j}\n`.padEnd(bytesPerEntry, '.')),
      })))
      inners.push({ name: `inner${i}.zip`, data: await readFile(innerPath) })
    }
    await writeZip(join(input, 'outer.zip'), inners)
    return input
  }

  await check('#33 嵌套压缩包共用累计字节上限', async () => {
    // Each inner zip unpacks to 40 KB; the outer to ~3 KB of zips. One archive
    // alone is within 100 KB, the tree is not.
    const input = await nestedInput('nest-bytes', 4, 4, 10000)
    const run = await runBatch({ inputDir: input, outputRoot: join(tmp, 'nest-bytes', 'out'), options: { runId: 'nb', zipLimits: { maxTotalBytes: 100000 } } })
    assert.ok(run.skipped.zipFailed >= 1, `some nested archive refused (zipFailed=${run.skipped.zipFailed})`)
    assert.equal(run.status, 'review')
    assert.ok((run.archiveErrors ?? []).some((item) => /上限|炸弹/.test(item.error)))
    const delivered = run.files.filter((file) => /(^|\/)inner\d\//.test(file.relPath)).length
    assert.ok(delivered < 16, `not every nested file is processed (${delivered})`)
  })

  await check('#33 嵌套压缩包共用累计条目数上限', async () => {
    const input = await nestedInput('nest-entries', 4, 5, 10)
    const run = await runBatch({ inputDir: input, outputRoot: join(tmp, 'nest-entries', 'out'), options: { runId: 'ne', zipLimits: { maxEntries: 12 } } })
    assert.ok(run.skipped.zipFailed >= 1, `some nested archive refused (zipFailed=${run.skipped.zipFailed})`)
    assert.equal(run.status, 'review')
  })

  await check('#33 嵌套压缩包在限额内正常处理', async () => {
    const input = await nestedInput('nest-ok', 3, 3, 100)
    const run = await runBatch({ inputDir: input, outputRoot: join(tmp, 'nest-ok', 'out'), options: { runId: 'no' } })
    assert.equal(run.skipped.zipFailed, 0)
    assert.equal(run.files.filter((file) => /(^|\/)inner\d\//.test(file.relPath)).length, 9)
  })

  await check('#33 逐条写盘：大条目流式解压，内容与 CRC 正确', async () => {
    const big = randomBytes(3 * 1024 * 1024)
    const text = Buffer.from('影像报告 '.repeat(400000))
    const path = join(zipDir, 'big.zip')
    await writeZip(path, [{ name: 'a/big.bin', data: big }, { name: 'a/text.txt', data: text }])
    const out = join(zipDir, 'big-out')
    const result = await extractZip(path, out)
    assert.deepEqual(result.files.sort(), ['a/big.bin', 'a/text.txt'])
    assert.ok((await readFile(join(out, 'a', 'big.bin'))).equals(big))
    assert.ok((await readFile(join(out, 'a', 'text.txt'))).equals(text))
  })

  await check('#33 解压中途出错时不留下已写出的条目', async () => {
    const good = Buffer.from('first entry '.repeat(10000))
    const bad = Buffer.from('second entry '.repeat(200000))
    const goodBody = deflateRawSync(good)
    const badBody = deflateRawSync(bad)
    const path = join(zipDir, 'crc.zip')
    await writeFile(path, rawZip([
      { name: 'ok.txt', body: goodBody, data: good, method: 8 },
      { name: 'bad.txt', body: badBody, data: bad, method: 8, crc: 1234 },
    ]))
    const out = join(zipDir, 'crc-out')
    await assert.rejects(extractZip(path, out), /CRC/)
    const left = await readdir(out).catch(() => [])
    assert.deepEqual(left, [], 'partial output removed')
  })

  await check('#33 声明大小造假的大条目被流式解压截断', async () => {
    const data = zeros(4 * 1024 * 1024)
    const path = join(zipDir, 'liar.zip')
    await writeFile(path, rawZip([{ name: 'z.bin', body: deflateRawSync(data), data, method: 8, size: 2 * 1024 * 1024 }]))
    await assert.rejects(extractZip(path, join(zipDir, 'liar-out'), { maxRatio: 1e9 }), /zip 炸弹|大小/)
  })

  /* ------------------------------------------- follow-up (reviewer 2) */

  /** Paths of every file under dir, '/'-separated, relative to dir. */
  async function walkAll(dir, base = dir) {
    const out = []
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...await walkAll(path, base))
      else out.push(path.slice(base.length + 1).split('\\').join('/'))
    }
    return out
  }

  async function siblingZips(name, count, entries, bytes) {
    const input = join(tmp, name, 'in')
    await mkdir(input, { recursive: true })
    for (let i = 0; i < count; i += 1) {
      await writeZip(join(input, `study${i + 1}.zip`), Array.from({ length: entries }, (_, j) => ({
        name: `s${i}/f${j}.txt`, data: Buffer.from(`编号 ${i}-${j}\n`.padEnd(bytes, '.')),
      })))
    }
    return input
  }

  await check('#33 复核：互不嵌套的多个压缩包各自计数（条目数），不累计到整批', async () => {
    const input = await siblingZips('sib-entries', 3, 7, 20)
    const run = await runBatch({ inputDir: input, outputRoot: join(tmp, 'sib-entries', 'out'), options: { runId: 'se', zipLimits: { maxEntries: 12 } } })
    assert.equal(run.skipped.zipFailed, 0, JSON.stringify(run.archiveErrors))
    assert.equal(run.files.filter((file) => /^study\d\//.test(file.relPath)).length, 21)
    assert.equal(run.status, 'completed')
  })

  await check('#33 复核：互不嵌套的多个压缩包各自计数（解压字节）', async () => {
    const input = await siblingZips('sib-bytes', 3, 6, 10000)
    const run = await runBatch({ inputDir: input, outputRoot: join(tmp, 'sib-bytes', 'out'), options: { runId: 'sb', zipLimits: { maxTotalBytes: 100000 } } })
    assert.equal(run.skipped.zipFailed, 0, JSON.stringify(run.archiveErrors))
    assert.equal(run.files.filter((file) => /^study\d\//.test(file.relPath)).length, 18)
  })

  await check('#33 复核：外层包里的内层压缩包不被重复计算（内层文件本身不计入累计）', async () => {
    const dir = join(tmp, 'nest-double')
    const input = join(dir, 'in')
    await mkdir(input, { recursive: true })
    // ~60 KB of hex text: the inner zip is ~33 KB, the outer holds only it.
    const innerPath = join(dir, 'inner.zip')
    await writeZip(innerPath, [{ name: 'a.txt', data: Buffer.from(randomBytes(30000).toString('hex')) }])
    await writeZip(join(input, 'outer.zip'), [{ name: 'inner.zip', data: await readFile(innerPath) }])
    const run = await runBatch({ inputDir: input, outputRoot: join(dir, 'out'), options: { runId: 'nd', zipLimits: { maxTotalBytes: 80000 } } })
    assert.equal(run.skipped.zipFailed, 0, JSON.stringify(run.archiveErrors))
    assert.ok(run.files.some((file) => file.relPath === 'outer/inner/a.txt'), run.files.map((f) => f.relPath).join(','))
  })

  await check('#33 复核：嵌套累计超限的提示是“超过上限”，不是“疑似 zip 炸弹”', async () => {
    const input = await nestedInput('nest-msg', 4, 4, 10000)
    const run = await runBatch({ inputDir: input, outputRoot: join(tmp, 'nest-msg', 'out'), options: { runId: 'nm', zipLimits: { maxTotalBytes: 100000 } } })
    assert.ok(run.skipped.zipFailed >= 1)
    for (const item of run.archiveErrors) assert.ok(!/炸弹/.test(item.error), item.error)
    assert.ok(run.archiveErrors.some((item) => /上限/.test(item.error)))
    // Direct API: the budget message itself.
    const a = join(zipDir, 'msg-a.zip')
    await writeZip(a, [{ name: 'a.txt', data: Buffer.from('a'.repeat(6000)) }])
    const budget = createZipBudget()
    await extractZip(a, join(zipDir, 'msg-a1'), { maxTotalBytes: 10000 }, { budget })
    await assert.rejects(extractZip(a, join(zipDir, 'msg-a2'), { maxTotalBytes: 10000 }, { budget }), (error) => {
      assert.match(error.message, /累计.*上限/)
      assert.ok(!/炸弹/.test(error.message), error.message)
      return true
    })
  })

  // PS3.15 Annex E attributes that carry the patient's own name or free text.
  const annexE = (explicit) => [
    el('00100011', 'SQ', [[el('00100012', 'LT', 'Xiaoming Wang'), el('00100013', 'UT', 'prefers her nickname Mingming')]]),
    el('00100016', 'UT', 'Pronoun note by Ms Li Hua'),
    el('00100042', 'UT', 'Clinical sex note Li Hua'),
    el('00100045', 'UT', 'Gender identity note Zhou Fang'),
    el('00189185', 'ST', 'Breath hold coached by Zhou Fang'),
    el('0018937F', 'ST', 'Decomposition by Chen Jie'),
    el('22000002', 'UT', explicit ? 'Slide label Wang Xiaoming' : 'XIAOMING'),
    el('22000005', 'LT', 'BARCODE Wang 0042'),
  ]
  const annexSecrets = ['Xiaoming', 'XIAOMING', 'nickname', 'Mingming', 'Li Hua', 'Zhou Fang', 'Chen Jie', 'BARCODE Wang']
  for (const [label, explicit, ts] of [['显式 VR', true, EXPLICIT], ['隐式 VR', false, IMPLICIT]]) {
    await check(`#26 复核 ${label}：Annex E 的使用名、称谓/性别备注、玻片标签等被删除`, async () => {
      const sop = `1.2.3.26.7${explicit ? 1 : 2}`
      const { file, output } = await runDicom(part10({
        sopClass: CT, sopInstance: sop, ts, explicit,
        dataset: sortByTag([
          el('00080016', 'UI', CT), el('00080018', 'UI', sop), el('00080060', 'CS', 'CT'),
          el('00100010', 'PN', 'WANG^XIAOMING'), el('00100020', 'LO', 'P0012345'),
          ...annexE(explicit),
        ]),
      }))
      assert.ok(output, `written (${file.status})`)
      for (const text of annexSecrets) assert.ok(!contains(output, text), `${text} removed`)
      assert.equal(file.status, 'clean', JSON.stringify(file.issues))
    })
  }

  await check('#26 复核：被删除的姓名以其他大小写出现在保留字段时，复扫能发现（不按 clean 交付）', async () => {
    const sop = '1.2.3.26.73'
    const { file } = await runDicom(part10({
      sopClass: CT, sopInstance: sop, ts: EXPLICIT, explicit: true,
      dataset: sortByTag([
        el('00080016', 'UI', CT), el('00080018', 'UI', sop), el('00080060', 'CS', 'CT'),
        el('00081030', 'LO', 'Chest for Xiaoming Wang'),
        el('00100010', 'PN', 'WANG^XIAOMING'), el('00100020', 'LO', 'P0012345'),
      ]),
    }))
    assert.equal(file.status, 'review')
    const issue = file.issues.find((item) => item.code === 'dicom-verify')
    assert.ok(issue, 'leak check reports it')
    assert.ok(!/xiaoming/i.test(issue.detail), 'no original value in the notice')
  })

  await check('#26 复核：大小写不同但不是整词的普通词不误报', async () => {
    const sop = '1.2.3.26.74'
    const { file, output } = await runDicom(part10({
      sopClass: CT, sopInstance: sop, ts: EXPLICIT, explicit: true,
      dataset: sortByTag([
        el('00080016', 'UI', CT), el('00080018', 'UI', sop), el('00080060', 'CS', 'CT'),
        el('00081030', 'LO', 'Chest CT Wangjing protocol'),
        el('00100010', 'PN', 'WANG^XIAOMING'), el('00100020', 'LO', 'P0012345'),
      ]),
    }))
    assert.ok(output)
    assert.equal(file.status, 'clean', JSON.stringify(file.issues))
  })

  for (const vr of ['UN', 'LO', 'SH']) {
    await check(`#26 复核：患者/医生姓名编码为 ${vr} 时，路径中的姓名也被替换`, async () => {
      const dir = join(tmp, `path-${vr}`)
      const input = join(dir, 'in')
      await mkdir(join(input, 'WANGXIAOMING_CT'), { recursive: true })
      await mkdir(join(input, 'LIDAWEI'), { recursive: true })
      const sop = `1.2.3.26.8.${vr.charCodeAt(0)}${vr.charCodeAt(1)}`
      await writeFile(join(input, 'WANGXIAOMING_CT', 'IM1.dcm'), part10({
        sopClass: CT, sopInstance: sop, ts: EXPLICIT, explicit: true,
        dataset: sortByTag([
          el('00080016', 'UI', CT), el('00080018', 'UI', sop), el('00080060', 'CS', 'CT'),
          el('00100010', vr, 'WANG^XIAOMING'), el('00100020', 'LO', 'P0012345'),
        ]),
      }))
      // Referring physician (dictionary PN) with a wrong VR, named in a folder.
      await writeFile(join(input, 'LIDAWEI', 'IM2.dcm'), part10({
        sopClass: CT, sopInstance: `${sop}.2`, ts: EXPLICIT, explicit: true,
        dataset: sortByTag([
          el('00080016', 'UI', CT), el('00080018', 'UI', `${sop}.2`), el('00080060', 'CS', 'CT'),
          el('00080090', vr, 'LI^DAWEI'),
          el('00100010', 'PN', 'ZHAO^QIANG'), el('00100020', 'LO', 'P0012346'),
        ]),
      }))
      const outRoot = join(dir, 'out')
      await runBatch({ inputDir: input, outputRoot: outRoot, options: { runId: `p${vr}` } })
      const paths = (await walkAll(outRoot)).filter((path) => !/(^|\/)compare\//.test(path) && !path.endsWith('vault.json'))
      for (const path of paths) assert.ok(!/WANG|XIAOMING|DAWEI/i.test(path), `name in output path ${path}`)
      assert.ok(paths.some((path) => /患者-[0-9A-F]{8}_CT\/IM1\.dcm$/.test(path)), paths.join('\n'))
      assert.ok(paths.some((path) => /医生-[0-9A-F]{8}\/IM2\.dcm$/.test(path)), paths.join('\n'))
    })
  }

  if (failures) {
    console.log(`\n${failures} FAILED`)
    process.exit(1)
  }
  console.log('\nPASS')
}

/** Minimal raw zip writer so a test can lie about CRC or size. */
function rawZip(specs) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const s of specs) {
    const nameBytes = Buffer.from(s.name, 'utf8')
    const body = s.body ?? s.data
    const crc = s.crc ?? crc32(s.data)
    const size = s.size ?? s.data.length
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(s.method ?? 0, 8)
    lh.writeUInt16LE((44 << 9) | (3 << 5) | 15, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(body.length, 18)
    lh.writeUInt32LE(size, 22)
    lh.writeUInt16LE(nameBytes.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(s.method ?? 0, 10)
    ch.writeUInt16LE((44 << 9) | (3 << 5) | 15, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(body.length, 20)
    ch.writeUInt32LE(size, 24)
    ch.writeUInt16LE(nameBytes.length, 28)
    ch.writeUInt32LE(offset, 42)
    const local = Buffer.concat([lh, nameBytes, body])
    locals.push(local)
    centrals.push(Buffer.concat([ch, nameBytes]))
    offset += local.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(specs.length, 8)
  end.writeUInt16LE(specs.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

await main()
