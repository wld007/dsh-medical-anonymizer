/**
 * DICOM metadata de-identification tests on synthetic files.
 * Run: node test/dicom.mjs
 */
import assert from 'node:assert/strict'
import { readFile, rm, mkdir, writeFile, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBatch } from '../lib/pipeline.js'
import { parseDicomBuffer, decodeAscii } from '../lib/dicom/codec.js'
import { dictVr, remapUid } from '../lib/dicom/profile.js'
import { dateShiftDays } from '../lib/policy.js'
import {
  writeDicomFixtures, GBK, STUDY, SERIES, SOP2, FOR,
} from './dicom-fixtures.mjs'
import { snapshotTree } from './snapshot.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'dicom')
const input = join(tmp, 'in')
const outRoot = join(tmp, 'out')

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

const value = (parsed, tag) => {
  const element = parsed.dataset.find((item) => item.tag === tag)
  return element ? decodeAscii(element.value) : undefined
}
const has = (parsed, tag) => parsed.dataset.some((item) => item.tag === tag)

async function readOut(runId, rel) {
  const buffer = await readFile(join(outRoot, 'runs', runId, 'output', rel))
  return { buffer, parsed: parseDicomBuffer(buffer, { dict: dictVr }) }
}

function shifted(date, days) {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(4, 6))
  const d = Number(date.slice(6, 8))
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000)
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`
}

async function main() {
  await rm(tmp, { recursive: true, force: true })
  await mkdir(input, { recursive: true })
  const { pixels } = await writeDicomFixtures(input)
  await writeFile(join(input, 'note.txt'), '患者姓名：张三，电话 13800138000。胸部CT平扫。\n')

  await check('GBK 测试字节正确', async () => {
    const decoder = new TextDecoder('gb18030')
    assert.equal(decoder.decode(GBK.张三), '张三')
    assert.equal(decoder.decode(GBK.胸部平扫), '胸部平扫')
  })

  const run = await runBatch({ inputDir: input, outputRoot: outRoot, options: { runId: 'd1' } })
  const vault = JSON.parse(await readFile(join(outRoot, 'vault.json'), 'utf8'))
  const shiftDays = dateShiftDays(vault.salt)

  await check('识别 DICOM（含无扩展名、数字扩展名），跳过 DICOMDIR，大端文件失败', async () => {
    assert.equal(run.totals.dicom.files, 5)
    assert.equal(run.skipped.dicomdir, 1)
    assert.equal(run.skipped.unsupported, 0)
    const big = run.files.find((file) => file.relPath === 'patientB/big.dcm')
    assert.equal(big.status, 'failed')
    assert.match(big.issues[0].detail, /大端/)
    await assert.rejects(stat(join(outRoot, 'runs', 'd1', 'output', 'DICOMDIR')))
    // the text note in the same folder is still processed by the text pipeline
    assert.ok(run.files.some((file) => file.relPath === 'note.txt' && file.kind === 'text'))
  })

  await check('合格文件全部通过校验', async () => {
    for (const rel of ['patientA/CT1/IM0001.dcm', 'patientA/CT1/IM0002', 'patientA/CT1/1.2.3.4.5', 'patientB/b1.dcm']) {
      const file = run.files.find((item) => item.relPath === rel)
      assert.ok(file, rel)
      assert.notEqual(file.status, 'failed', `${rel}: ${JSON.stringify(file.issues)}`)
      assert.equal(file.structure.ok, true, `${rel}: ${JSON.stringify(file.structure.checks)}`)
      assert.ok(file.structure.checks.some((c) => c.name === '像素数据' && c.ok), rel)
    }
  })

  const a1 = await readOut('d1', 'patientA/CT1/IM0001.dcm')
  const a2 = await readOut('d1', 'patientA/CT1/IM0002')
  const a3 = await readOut('d1', 'patientA/CT1/1.2.3.4.5')
  const b1 = await readOut('d1', 'patientB/b1.dcm')

  await check('原始敏感值在输出字节中完全不存在', async () => {
    const needles = [
      'ZHANG', 'LI^QIANG', 'P0012345', 'OLD-ID-55667', '19790315', 'Beijing Example Hospital',
      '13800138000', 'ACME_PRIVATE', 'SN-77881', 'CT_ROOM_3', 'ACC9988776', 'S-2024-0001',
      'REQ-123456', 'HOSPITAL_PACS', 'PRIVATE-BLOB', STUDY, SERIES, FOR, SOP2,
    ]
    for (const { buffer } of [a1, a2, a3]) {
      for (const needle of needles) assert.equal(buffer.includes(Buffer.from(needle, 'latin1')), false, needle)
      assert.equal(buffer.includes(GBK.张三), false, '张三(GBK)')
    }
    for (const needle of ['WANG', 'P0099999', '19500101']) assert.equal(b1.buffer.includes(Buffer.from(needle)), false, needle)
    assert.equal(b1.buffer.includes(Buffer.from('王芳', 'utf8')), false)
  })

  await check('姓名清空、PatientID 为 cuid 风格且同一病人一致、不同病人不同', async () => {
    for (const { parsed } of [a1, a2, a3, b1]) {
      assert.equal(value(parsed, '00100010'), '')
      assert.match(value(parsed, '00100020'), /^c[0-9a-z]{24}$/)
      assert.equal(value(parsed, '00100030'), '')
      assert.equal(value(parsed, '00080090') ?? '', '')
      assert.equal(has(parsed, '00080080'), false)
      assert.equal(has(parsed, '00101002'), false)
    }
    const idA = value(a1.parsed, '00100020')
    assert.equal(value(a2.parsed, '00100020'), idA)
    assert.equal(value(a3.parsed, '00100020'), idA)
    assert.notEqual(value(b1.parsed, '00100020'), idA)
  })

  await check('UID 重映射为 2.25.*，跨文件引用保持一致，标准 UID 不变', async () => {
    const study = value(a1.parsed, '0020000D')
    assert.match(study, /^2\.25\.\d+$/)
    assert.ok(study.length <= 64)
    assert.equal(value(a2.parsed, '0020000D'), study)
    assert.equal(value(a3.parsed, '0020000D'), study)
    assert.equal(study, remapUid(STUDY, vault.salt))
    // IM0001 references IM0002's SOP instance
    const ref = a1.parsed.dataset.find((item) => item.tag === '00081140')
    const refSop = decodeAscii(ref.items[0].elements.find((item) => item.tag === '00081155').value)
    assert.equal(refSop, value(a2.parsed, '00080018'))
    const refClass = decodeAscii(ref.items[0].elements.find((item) => item.tag === '00081150').value)
    assert.equal(refClass, '1.2.840.10008.5.1.4.1.1.2')
    assert.equal(value(a1.parsed, '00080016'), '1.2.840.10008.5.1.4.1.1.2')
    // meta SOP instance follows the data set
    const metaSop = decodeAscii(a1.parsed.meta.find((item) => item.tag === '00020003').value)
    assert.equal(metaSop, value(a1.parsed, '00080018'))
    // undocumented implicit tag holding the series UID was remapped too
    assert.equal(value(a2.parsed, '0020F00D'), value(a2.parsed, '0020000E'))
  })

  await check('日期整体平移、出生日期清空、年龄保留且 ≥90 写为 090Y、性别保留', async () => {
    assert.equal(value(a1.parsed, '00080020'), shifted('20240301', shiftDays))
    assert.equal(value(b1.parsed, '00080020'), shifted('20240305', shiftDays))
    assert.equal(value(a1.parsed, '00080030'), '093000')
    assert.equal(value(a1.parsed, '00101010'), '045Y')
    assert.equal(value(b1.parsed, '00101010'), '090Y')
    assert.equal(value(a1.parsed, '00100040'), 'M')
    assert.equal(value(a1.parsed, '00101030'), '70')
  })

  await check('私有字段删除；描述保留，含电话的描述被删除并提示', async () => {
    for (const { parsed } of [a1, a2]) {
      assert.equal(parsed.dataset.some((item) => item.group % 2 === 1), false)
    }
    const desc = a1.parsed.dataset.find((item) => item.tag === '00081030')
    assert.equal(new TextDecoder('gb18030').decode(desc.value).trim(), '胸部平扫')
    assert.equal(value(a1.parsed, '00181030'), 'Chest Routine')
    assert.equal(has(a1.parsed, '0008103E'), false)
    assert.equal(value(a2.parsed, '0008103E'), 'Lung 1.25mm')
    const file = run.files.find((item) => item.relPath === 'patientA/CT1/IM0001.dcm')
    assert.ok(file.issues.some((issue) => issue.code === 'dicom-text'))
    assert.equal(value(a1.parsed, '00080070'), 'ACME Medical')
  })

  await check('写入去标识标记', async () => {
    assert.equal(value(a1.parsed, '00120062'), 'YES')
    assert.equal(value(a1.parsed, '00280303'), 'MODIFIED')
    const codes = a1.parsed.dataset.find((item) => item.tag === '00120064')
    const values = codes.items.map((item) => decodeAscii(item.elements.find((e) => e.tag === '00080100').value))
    assert.deepEqual(values, ['113100', '113107', '113108'])
    assert.equal(value(a2.parsed, '00120062'), 'YES') // implicit VR file too
  })

  await check('像素数据逐字节一致（含封装格式与像素后的尾部）', async () => {
    assert.ok(a1.buffer.includes(pixels.a1))
    assert.ok(a2.buffer.includes(pixels.a2))
    assert.ok(b1.buffer.includes(pixels.b1))
    for (const fragment of pixels.a3fragments.filter((f) => f.length > 0)) assert.ok(a3.buffer.includes(fragment))
    // trailing padding is removed after the pixel data
    const original = await readFile(join(input, 'patientA', 'CT1', '1.2.3.4.5'))
    const pixelStart = original.indexOf(Buffer.from([0xE0, 0x7F, 0x10, 0x00]))
    const pixelEnd = original.length - (4 + 2 + 2 + 4 + 16)
    assert.ok(a3.buffer.subarray(a3.buffer.length - (pixelEnd - pixelStart)).equals(original.subarray(pixelStart, pixelEnd)))
  })

  await check('报告不含原始值，DICOM 汇总存在', async () => {
    const markdown = await readFile(join(outRoot, 'runs', 'd1', 'report.md'), 'utf8')
    const json = await readFile(join(outRoot, 'runs', 'd1', 'report.json'), 'utf8')
    for (const text of [markdown, json]) {
      for (const needle of ['P0012345', 'ZHANG', '19790315', STUDY]) assert.equal(text.includes(needle), false, needle)
    }
    assert.match(markdown, /DICOM 影像（元数据）/)
    assert.match(markdown, /DICOMDIR/)
  })

  await check('再次运行：UID 保持一致，PatientID 换新（密钥不保存）', async () => {
    const again = await runBatch({ inputDir: input, outputRoot: outRoot, options: { runId: 'd2' } })
    assert.equal(again.totals.dicom.files, 5)
    const next = await readOut('d2', 'patientA/CT1/IM0001.dcm')
    assert.equal(value(next.parsed, '0020000D'), value(a1.parsed, '0020000D'))
    assert.equal(value(next.parsed, '00080020'), value(a1.parsed, '00080020'))
    assert.notEqual(value(next.parsed, '00100020'), value(a1.parsed, '00100020'))
    const vaultText = await readFile(join(outRoot, 'vault.json'), 'utf8')
    assert.equal(vaultText.includes('P0012345'), false)
  })

  await check('DICOM 源文件逐字节不变', async () => {
    const before = await snapshotTree(input)
    const again = await runBatch({ inputDir: input, outputRoot: join(tmp, 'untouched'), options: { runId: 'untouched' } })
    assert.equal(again.totals.dicom.files, 5)
    assert.deepEqual(await snapshotTree(input), before)
    assert.equal(again.warnings.some((warning) => warning.includes('源文件')), false)
  })

  await check('准标识符策略作用于 DICOM（年龄分段、日期删除、性别删除）', async () => {
    const quasi = await runBatch({
      inputDir: input,
      outputRoot: join(tmp, 'quasi'),
      options: {
        runId: 'q',
        policy: { quasiIdentifiers: true, quasiPolicy: { date: 'redact', age: 'band10', sex: 'redact' } },
      },
    })
    assert.equal(quasi.totals.filesFailed, 1) // only the big-endian file
    const buffer = await readFile(join(tmp, 'quasi', 'runs', 'q', 'output', 'patientA', 'CT1', 'IM0001.dcm'))
    const parsed = parseDicomBuffer(buffer, { dict: dictVr })
    assert.equal(value(parsed, '00101010'), '040Y')
    assert.equal(value(parsed, '00080020'), '')
    assert.equal(value(parsed, '00100040'), '')
    assert.equal(value(parsed, '00280303'), 'REMOVED')
  })

  console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
