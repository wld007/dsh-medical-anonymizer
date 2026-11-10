/**
 * Regression tests for review findings #0 (review items merged by masked
 * detail), #9 (DICOM file/folder names keep UIDs and Latin names) and #11
 * (concurrent start() runs two batches).
 * Run: node test/fix-misc.mjs
 */
import assert from 'node:assert/strict'
import { readFile, rm, mkdir, writeFile, readdir } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBatch } from '../lib/pipeline.js'
import { createService } from '../lib/service.js'
import { parseDicomBuffer, decodeAscii } from '../lib/dicom/codec.js'
import { dictVr, remapUid, pathIdentifiers } from '../lib/dicom/profile.js'
import { createPathAnonymizer } from '../lib/paths.js'
import { randomBytes } from 'node:crypto'
import { el, part10, pixelBytes, CT } from './dicom-fixtures.mjs'
import { outDirOf, outJoin } from './outputs.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'fix-misc')

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

async function walk(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(path, base))
    else out.push(relative(base, path).split('\\').join('/'))
  }
  return out
}

/** A model that finds nothing; its blind review reports every listed name still in the text. */
function verifierReporting(names) {
  return {
    model: 'scripted',
    async chatJson(messages) {
      const prompt = messages.map((message) => message.content).join('\n')
      if (prompt.includes('独立的数据安全审查员')) {
        const segments = JSON.parse(prompt.slice(prompt.lastIndexOf('段落：') + 3))
        const issues = []
        for (const segment of segments) {
          for (const name of names) if (segment.text.includes(name)) issues.push({ segment: segment.id, type: '姓名', text: name, reason: '姓名' })
        }
        return { json: { issues } }
      }
      return { json: { entities: [] } }
    },
  }
}

async function reviewTexts(root, runId) {
  const files = JSON.parse(await readFile(join(root, '_records', 'runs', runId, 'review-items.json'), 'utf8'))
  return files.flatMap((file) => file.items.map((item) => ({ relPath: file.relPath, ...item })))
}

/* ------------------------------------------------------------------ #0 */

async function testReviewDedupe() {
  const input = join(tmp, 'review-in')
  const root = join(tmp, 'review-out')
  await mkdir(input, { recursive: true })
  // Same masked detail for both values of each file: '**' and '***'.
  await writeFile(join(input, 'note.txt'), '今日查房，张三与李四同住一室。\n')
  await writeFile(join(input, 'ward.txt'), '王小明和李小红在同一病区。\n')
  // One value in two fields: one item per field; replacing one covers both.
  await writeFile(join(input, 'pair.csv'), '病区,陪护\n张三住三床,张三陪护\n')
  const names = ['张三', '李四', '王小明', '李小红']
  const run = await runBatch({
    inputDir: input,
    outputRoot: root,
    options: { llm: verifierReporting(names), runId: 'dedupe', maxRounds: 1 },
  })

  await check('#0 每个被盲审报出的不同值都有自己的复核项（2 字、3 字同掩码）', async () => {
    assert.equal(run.status, 'review')
    const items = await reviewTexts(root, 'dedupe')
    const byFile = (rel) => items.filter((item) => item.relPath === rel && item.code === 'model-residual').map((item) => item.text).sort()
    assert.deepEqual(byFile('note.txt'), ['张三', '李四'].sort())
    assert.deepEqual(byFile('ward.txt'), ['李小红', '王小明'].sort())
    const note = run.files.find((file) => file.relPath === 'note.txt')
    assert.equal(note.issues.filter((issue) => issue.code === 'model-residual').length, 2)
    const pair = items.filter((item) => item.relPath === 'pair.csv' && item.code === 'model-residual')
    assert.deepEqual(pair.map((item) => item.text), ['张三', '张三'])
    assert.deepEqual(pair.map((item) => item.field).sort(), ['病区', '陪护'])
  })

  await check('#0 报告与问题详情不含原值', async () => {
    const report = await readFile(join(root, '_records', 'runs', 'dedupe', 'report.json'), 'utf8')
    const md = await readFile(join(root, '_records', 'runs', 'dedupe', 'report.md'), 'utf8')
    for (const name of names) {
      assert.ok(!report.includes(name), `report.json has ${name}`)
      assert.ok(!md.includes(name), `report.md has ${name}`)
    }
  })

  // End to end: the batch is completed only after every flagged value was
  // decided by a person, and then none of them is delivered.
  const svc = createService({ config: { outputRoot: root }, defaultDirectory: tmp })
  await check('#0 只复核第一项时批次不会完成、不会交付', async () => {
    const listed = await svc.reviewItems('dedupe')
    const note = listed.files.find((file) => file.relPath === 'note.txt')
    const first = await svc.reviewDecide('dedupe', note.items[0].id, 'replace')
    assert.equal(first.completed, false)
    assert.equal(first.status, 'review')
    const record = JSON.parse(await readFile(join(root, '_records', 'runs', 'dedupe', 'report.json'), 'utf8'))
    assert.equal(record.withheld, true)
  })
  await check('#0 全部决定后才完成，交付数据中没有任何被报出的原值', async () => {
    const listed = await svc.reviewItems('dedupe')
    let last = null
    for (const file of listed.files) {
      for (const item of file.items) {
        if (item.decision) continue
        last = await svc.reviewDecide('dedupe', item.id, item.text ? 'replace' : 'accept')
      }
    }
    assert.equal(last?.completed, true)
    assert.equal(last.status, 'completed')
    const out = await outDirOf(root, 'dedupe')
    const note = await readFile(outJoin(out, 'note.txt'), 'utf8')
    const ward = await readFile(outJoin(out, 'ward.txt'), 'utf8')
    const pair = await readFile(outJoin(out, 'pair.csv'), 'utf8')
    for (const name of names) assert.ok(!note.includes(name) && !ward.includes(name) && !pair.includes(name), `${name} delivered: ${note} ${ward} ${pair}`)
  })

  // More flagged values than the old 60-entry cap: none may be dropped.
  const manyIn = join(tmp, 'many-in')
  const manyRoot = join(tmp, 'many-out')
  await mkdir(manyIn, { recursive: true })
  const many = []
  for (const surname of '王李张刘陈杨黄赵吴周') for (const given of '伟芳娜敏静丽强') many.push(`${surname}${given}`)
  await writeFile(join(manyIn, 'list.txt'), `会诊时在场的有${many.join('、')}等人。\n`)
  const manyRun = await runBatch({
    inputDir: manyIn,
    outputRoot: manyRoot,
    options: { llm: verifierReporting(many), runId: 'many', maxRounds: 1 },
  })
  await check('#0 超过 60 个报出值时复核项一个不少（不受条数上限影响）', async () => {
    assert.equal(manyRun.status, 'review')
    const out = await readFile(outJoin(await outDirOf(manyRoot, 'many'), 'list.txt'), 'utf8')
    const remaining = many.filter((name) => out.includes(name))
    assert.ok(remaining.length > 60, `only ${remaining.length} names left in the output`)
    const listed = new Set((await reviewTexts(manyRoot, 'many')).map((item) => item.text))
    const missing = remaining.filter((name) => !listed.has(name))
    assert.deepEqual(missing, [], `${missing.length} flagged values never listed for review`)
    const file = manyRun.files.find((item) => item.relPath === 'list.txt')
    assert.ok(file.issues.filter((issue) => issue.severity === 'error').length >= remaining.length)
  })
}

/* ------------------------------------------------------------------ #9 */

const STUDY_A = '1.2.840.113619.2.55.3.604688119.868'
const SERIES_A = `${STUDY_A}.2`
const SOP_A1 = `${STUDY_A}.1234567890.123`
const SOP_A2 = `${STUDY_A}.1234567890.124`
const STUDY_B = '1.2.840.113619.2.55.3.604688119.900'
const SOP_B1 = `${STUDY_B}.1.1`
const SOP_C1 = `${STUDY_B}.1.2`
const STUDY_D = '1.3.12.2.1107.5.1.4.95999.30000024031508123456789'
const SOP_D1 = `${STUDY_D}.7`
const LOOSE_UID = '1.2.840.113619.2.55.3.777777.5'

function slice({ sop, study, series, name, pid, seed }) {
  return part10({
    sopClass: CT, sopInstance: sop, ts: '1.2.840.10008.1.2.1', explicit: true,
    dataset: [
      el('00080016', 'UI', CT),
      el('00080018', 'UI', sop),
      el('00080020', 'DA', '20240301'),
      el('00080050', 'SH', 'ACC9988776'),
      el('00080060', 'CS', 'CT'),
      el('00100010', 'PN', name),
      el('00100020', 'LO', pid),
      el('0020000D', 'UI', study),
      el('0020000E', 'UI', series),
      el('7FE00010', 'OW', pixelBytes(seed, 256)),
    ],
  })
}

async function testDicomNames() {
  const input = join(tmp, 'dicom-in')
  const root = join(tmp, 'dicom-out')
  const files = [
    // PACS export: <PatientName>/<StudyInstanceUID>/<SOPInstanceUID>.dcm
    [`ZHANG_SAN/${STUDY_A}/${SOP_A1}.dcm`, { sop: SOP_A1, study: STUDY_A, series: SERIES_A, name: 'ZHANG^SAN', pid: 'P0012345', seed: 1 }],
    [`ZHANG_SAN/${STUDY_A}/${SOP_A2}`, { sop: SOP_A2, study: STUDY_A, series: SERIES_A, name: 'ZHANG^SAN', pid: 'P0012345', seed: 2 }],
    // Glued pinyin, lower case, UID behind a prefix.
    [`zhangsan/IM_${SOP_B1}.dcm`, { sop: SOP_B1, study: STUDY_B, series: `${STUDY_B}.1`, name: 'ZHANG^SAN', pid: 'P0012345', seed: 3 }],
    // Patient ID folder.
    ['P0012345/scan_01.dcm', { sop: SOP_C1, study: STUDY_B, series: `${STUDY_B}.1`, name: 'ZHANG^SAN', pid: 'P0012345', seed: 4 }],
    // Space-separated name, given-name-first order, and a UID-shaped folder no header lists.
    [`SI LI/${LOOSE_UID}/${SOP_D1}.dcm`, { sop: SOP_D1, study: STUDY_D, series: `${STUDY_D}.1`, name: 'LI^SI', pid: 'Q7788990', seed: 5 }],
  ]
  for (const [rel, spec] of files) {
    await mkdir(dirname(join(input, rel)), { recursive: true })
    await writeFile(join(input, rel), slice(spec))
  }
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'dicom-names' } })
  const out = await outDirOf(root, 'dicom-names')
  const paths = await walk(out)
  const salt = JSON.parse(await readFile(join(root, '_records', 'vault.json'), 'utf8')).salt
  const header = async (rel) => parseDicomBuffer(await readFile(join(out, rel)), { dict: dictVr })
  const value = (parsed, tag) => decodeAscii(parsed.dataset.find((item) => item.tag === tag)?.value)

  await check('#9 DICOM 批次完成且输出文件齐全', async () => {
    assert.equal(run.status, 'completed', JSON.stringify(run.files.map((file) => file.issues)))
    assert.equal(paths.length, files.length, paths.join('\n'))
  })
  await check('#9 输出路径不含原始姓名（含拼音/大小写/空格/顺序变体）和病人 ID', async () => {
    for (const path of paths) {
      for (const secret of ['zhang', 'li si', 'si li', 'p0012345', 'q7788990']) {
        assert.ok(!path.toLowerCase().includes(secret), `${secret} in ${path}`)
      }
    }
  })
  await check('#9 输出路径不含任何原始 UID', async () => {
    for (const path of paths) {
      for (const uid of [STUDY_A, STUDY_B, STUDY_D, LOOSE_UID, '604688119', '113619', '95999']) {
        assert.ok(!path.includes(uid), `${uid} in ${path}`)
      }
    }
  })
  await check('#9 UID 文件名/目录名与头部的 UID 重映射一致', async () => {
    const studyA = remapUid(STUDY_A, salt)
    const fileA1 = paths.find((path) => path.endsWith(`/${studyA}/${remapUid(SOP_A1, salt)}.dcm`))
    assert.ok(fileA1, paths.join('\n'))
    const parsed = await header(fileA1)
    assert.equal(value(parsed, '00080018'), remapUid(SOP_A1, salt))
    assert.equal(value(parsed, '0020000D'), studyA)
    assert.ok(paths.some((path) => path.endsWith(`/${studyA}/${remapUid(SOP_A2, salt)}`)), 'extensionless SOP name')
    assert.ok(paths.some((path) => path.endsWith(`/IM_${remapUid(SOP_B1, salt)}.dcm`)), 'prefixed SOP name')
    assert.ok(paths.some((path) => path.includes(`/${remapUid(LOOSE_UID, salt)}/`)), 'UID-shaped folder')
  })
  await check('#9 病人 ID 目录与头部的病人编号一致', async () => {
    const scan = paths.find((path) => path.endsWith('/scan_01.dcm'))
    assert.ok(scan, paths.join('\n'))
    const parsed = await header(scan)
    assert.equal(scan.split('/')[0], value(parsed, '00100020'))
  })
  await check('#9 报告与批次记录不含原始姓名、ID、UID', async () => {
    for (const name of ['report.json', 'report.md']) {
      const text = await readFile(join(root, '_records', 'runs', 'dicom-names', name), 'utf8')
      for (const secret of ['ZHANG', 'zhangsan', 'P0012345', 'Q7788990', STUDY_A, STUDY_B, LOOSE_UID, 'SI LI']) {
        assert.ok(!text.includes(secret), `${secret} in ${name}`)
      }
    }
  })
}

/* ------------------------------------------------- #9 follow-up (break) */

const STUDY_E = '1.2.840.113619.2.55.3.604688119.868'
function sliceE({ sop, name, pid, acc = 'ACC9988776', seed, utf8 = false }) {
  return part10({
    sopClass: CT, sopInstance: sop, ts: '1.2.840.10008.1.2.1', explicit: true,
    dataset: [
      ...(utf8 ? [el('00080005', 'CS', 'ISO_IR 192')] : []),
      el('00080016', 'UI', CT),
      el('00080018', 'UI', sop),
      el('00080020', 'DA', '20240301'),
      el('00080050', 'SH', acc),
      el('00080060', 'CS', 'CT'),
      el('00100010', 'PN', utf8 ? Buffer.from(name, 'utf8') : name),
      el('00100020', 'LO', pid),
      el('0020000D', 'UI', STUDY_E),
      el('0020000E', 'UI', `${STUDY_E}.2`),
      el('7FE00010', 'OW', pixelBytes(seed, 256)),
    ],
  })
}

async function testDicomNamesBreak() {
  const input = join(tmp, 'dicom2-in')
  const root = join(tmp, 'dicom2-out')
  const sop = (n) => `${STUDY_E}.${n}`
  const files = [
    // dcmtk storescp default: <Modality>.<SOPInstanceUID> (no extension).
    [`CT.${sop(11)}`, { sop: sop(11), name: 'WANG^WU', pid: 'Z9988776', seed: 11 }],
    // UID glued to a letter prefix.
    [`MR${sop(12)}.dcm`, { sop: sop(12), name: 'WANG^WU', pid: 'Z9988776', seed: 12 }],
    // Frame suffix with a leading zero (the whole run is not UID-shaped).
    [`US.${sop(13)}.01.dcm`, { sop: sop(13), name: 'WANG^WU', pid: 'Z9988776', seed: 13 }],
    // Raw PN with empty trailing components.
    ['ZHAO^LIU^^^/a.dcm', { sop: sop(14), name: 'ZHAO^LIU^^^', pid: 'Z9988777', seed: 14 }],
    // "LAST, FIRST".
    ['QIAN, SUN/b.dcm', { sop: sop(15), name: 'QIAN^SUN', pid: 'Z9988778', seed: 15 }],
    // Glued name, ID in parentheses.
    ['ZHOUWU(Y1234567)/c.dcm', { sop: sop(16), name: 'ZHOU^WU', pid: 'Y1234567', seed: 16 }],
    // Given names first, multi-word given name, brackets, glued date.
    ['DA MING CHEN/d.dcm', { sop: sop(17), name: 'CHEN^DA MING', pid: 'Y1234569', seed: 17 }],
    ['[HUANG FEI]_CT/e.dcm', { sop: sop(18), name: 'HUANG^FEI', pid: 'Y1234571', seed: 18 }],
    ['ZHENGXIAOMING20240301/f.dcm', { sop: sop(19), name: 'ZHENG^XIAOMING', pid: 'Y1234568', seed: 19 }],
    // Accession in braces next to a description.
    ['{ACC5566778}头颅/g.dcm', { sop: sop(20), name: 'HU^FEI', pid: 'Y1234572', acc: 'ACC5566778', seed: 20 }],
    // CJK names glued to descriptions (Chinese has no separators).
    ['欧阳娜娜头颅CT/h.dcm', { sop: sop(21), name: 'OUYANG^NANA=欧阳^娜娜', pid: 'Z1000001', seed: 21, utf8: true }],
    ['复查李建国/i.dcm', { sop: sop(22), name: '李建国', pid: 'Z1000002', seed: 22, utf8: true }],
  ]
  for (const [rel, spec] of files) {
    await mkdir(dirname(join(input, rel)), { recursive: true })
    await writeFile(join(input, rel), sliceE(spec))
  }
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'dicom-names2' } })
  const out = await outDirOf(root, 'dicom-names2')
  const paths = await walk(out)
  const salt = JSON.parse(await readFile(join(root, '_records', 'vault.json'), 'utf8')).salt
  const secrets = [
    STUDY_E, '604688119', 'ZHAO', 'LIU', 'QIAN', 'SUN', 'ZHOU', 'Y1234567', 'CHEN', 'MING', 'HUANG', 'FEI',
    'ZHENG', 'XIAOMING', 'ACC5566778', '欧阳', '娜娜', '李建国',
  ]

  await check('#9b DICOM 批次输出文件齐全', async () => {
    assert.equal(paths.length, files.length, paths.join('\n'))
  })
  await check('#9b 前缀紧贴的 UID（CT.<UID>、MR<UID>、<UID>.01）被重映射', async () => {
    assert.ok(paths.includes(`CT.${remapUid(sop(11), salt)}`), paths.join('\n'))
    assert.ok(paths.includes(`MR${remapUid(sop(12), salt)}.dcm`), paths.join('\n'))
    assert.ok(paths.includes(`US.${remapUid(sop(13), salt)}.01.dcm`), paths.join('\n'))
  })
  await check('#9b 输出路径不含原始姓名/ID/UID（^ , () [] {} 与中文紧贴）', async () => {
    for (const path of paths) {
      for (const secret of secrets) assert.ok(!path.toUpperCase().includes(secret), `${secret} in ${path}`)
    }
  })
  await check('#9b 结构保留：描述词和日期留在名字里', async () => {
    assert.ok(paths.some((path) => /^患者-[0-9A-F]{8}头颅CT\/h\.dcm$/.test(path)), paths.join('\n'))
    assert.ok(paths.some((path) => /^复查患者-[0-9A-F]{8}\/i\.dcm$/.test(path)), paths.join('\n'))
    assert.ok(paths.some((path) => /^患者-[0-9A-F]{8}20240301\/f\.dcm$/.test(path)), paths.join('\n'))
    assert.ok(paths.some((path) => /^\[患者-[0-9A-F]{8}\]_CT\/e\.dcm$/.test(path)), paths.join('\n'))
  })
  await check('#9b 报告不含原始姓名/ID/UID', async () => {
    for (const name of ['report.json', 'report.md']) {
      const text = (await readFile(join(root, '_records', 'runs', 'dicom-names2', name), 'utf8')).toUpperCase()
      for (const secret of secrets) assert.ok(!text.includes(secret), `${secret} in ${name}`)
    }
  })
  await check('#9b 批次状态与文件状态', async () => {
    assert.equal(run.status, 'completed', JSON.stringify(run.files.map((file) => file.issues)))
  })
}

async function testDicomNamesPerf() {
  const runKey = randomBytes(32)
  const syllables = ['zhang', 'wang', 'li', 'zhao', 'liu', 'chen', 'yang', 'huang', 'wu', 'zhou', 'xu', 'sun', 'ma', 'zhu', 'hu', 'guo', 'he', 'lin', 'luo', 'gao']
  const enc = (text) => Buffer.from(text, 'latin1')
  const N = 4000
  const values = new Map()
  const uids = new Map()
  const paths = []
  for (let i = 0; i < N; i += 1) {
    const last = syllables[i % 20].toUpperCase()
    const first = (syllables[(i * 7) % 20] + syllables[(i * 3 + 1) % 20] + i.toString(36)).toUpperCase()
    const sopUid = `1.2.840.113619.2.55.3.${100000 + i}.1.${i}`
    const found = pathIdentifiers({ meta: [], dataset: [
      { tag: '00100010', vr: 'PN', value: enc(`${last}^${first}`) },
      { tag: '00100020', vr: 'LO', value: enc(`P${1000000 + i}`) },
      { tag: '00080050', vr: 'SH', value: enc(`A${2000000 + i}`) },
      { tag: '00080090', vr: 'PN', value: enc(`DOC^TOR${i % 50}`) },
      { tag: '00080018', vr: 'UI', value: enc(sopUid) },
    ] }, { salt: 's', runKey })
    for (const [uid, mapped] of found.uids) uids.set(uid, mapped)
    for (const entry of found.values) values.set(`${entry.type}|${entry.text.toLowerCase()}|${entry.part ? 1 : 0}`, entry)
    paths.push(`${last}_${first}/P${1000000 + i}_${sopUid}.dcm`)
  }
  const mapper = createPathAnonymizer({
    vault: { token: (type, text) => `化名-${text.length}` },
    policy: {},
    known: [...values.values()],
    uids: { known: uids, remap: () => '2.25.1' }, // listed UIDs keep their header remap
  })
  const started = Date.now()
  const mapped = paths.sort().map((path) => mapper.map(path))
  const elapsed = Date.now() - started

  await check(`#9c ${N} 个病人的路径映射不随病人数平方增长（${elapsed} ms）`, async () => {
    assert.ok(elapsed < 3000, `${elapsed} ms`)
  })
  await check('#9c 大批量下每条路径仍被完整映射', async () => {
    for (const path of mapped) {
      assert.match(path, /^患者-[0-9A-F]{8}\/c[0-9a-z]{24}_2\.25\.\d+\.dcm$/, path)
    }
  })
}

/* ----------------------------------------------------------------- #11 */

async function waitIdle(svc) {
  const started = Date.now()
  while (svc.isRunning()) {
    if (Date.now() - started > 60000) throw new Error('batch did not finish')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function testStartRace() {
  const base = join(tmp, 'race')
  for (const name of ['a', 'b', 'c']) {
    await mkdir(join(base, name), { recursive: true })
    await writeFile(join(base, name, 'note.txt'), `患者姓名：张${name === 'a' ? '一' : name === 'b' ? '二' : '五'}，联系电话 1380013800${name === 'a' ? 1 : name === 'b' ? 2 : 5}。\n`)
  }
  const svc = createService({ config: {}, defaultDirectory: base })

  await check('#11 两个并发 start 只有一个能运行', async () => {
    const results = await Promise.allSettled([svc.start({ inputDir: join(base, 'a') }), svc.start({ inputDir: join(base, 'b') })])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    assert.equal(fulfilled.length, 1, JSON.stringify(results.map((result) => result.status)))
    assert.equal(rejected.length, 1)
    assert.match(rejected[0].reason.message, /正在(运行|启动)/)
    await waitIdle(svc)
    const { run } = await svc.status(fulfilled[0].value.runId)
    assert.equal(run.status, 'completed')
  })

  await check('#11 三个并发 start（含不同输入）也只有一个运行', async () => {
    const results = await Promise.allSettled([
      svc.start({ inputDir: join(base, 'b') }),
      svc.start({ inputDir: join(base, 'c') }),
      svc.start({ inputDir: join(base, 'a') }),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    await waitIdle(svc)
  })

  await check('#11 启动前失败会释放占用，之后可以正常启动', async () => {
    await assert.rejects(svc.start({ inputDir: join(base, 'missing') }), /输入路径不存在/)
    assert.equal(svc.isRunning(), false)
    await assert.rejects(svc.start({}), /缺少输入路径/)
    assert.equal(svc.isRunning(), false)
    const started = await svc.start({ inputDir: join(base, 'c') })
    assert.ok(started.runId)
    await waitIdle(svc)
  })

  await check('#11 启动中取消不会误报成功', async () => {
    const pending = svc.start({ inputDir: join(base, 'a') })
    const result = await svc.cancel()
    assert.equal(result.cancelled, false)
    await pending
    await waitIdle(svc)
  })

  await check('#11 映射库保留所有批次的映射（无并发覆盖）', async () => {
    const vault = JSON.parse(await readFile(join(base, '_medical-anonymizer', '_records', 'vault.json'), 'utf8'))
    const originals = new Set(vault.entries.map((entry) => entry.original))
    for (const value of ['张一', '张二', '张五', '13800138001', '13800138002', '13800138005']) {
      assert.ok(originals.has(value), `vault lost ${value}`)
    }
  })
}

async function main() {
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  await testReviewDedupe()
  await testDicomNames()
  await testDicomNamesBreak()
  await testDicomNamesPerf()
  await testStartRace()
  if (failures > 0) {
    console.log(`\n${failures} FAILED`)
    process.exit(1)
  }
  console.log('\nFIX-MISC PASS')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
