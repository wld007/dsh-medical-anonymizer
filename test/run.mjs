/**
 * End-to-end pipeline test with a deterministic mock model.
 * Run: node test/run.mjs
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, rm, stat, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from '../vendor/xlsx.mjs'
import { runBatch, echoesPseudonym } from '../lib/pipeline.js'
import { createLlm } from '../lib/llm.js'
import { createService } from '../lib/service.js'
import { Vault } from '../lib/pseudonym.js'
import { snapshotTree } from './snapshot.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures', 'records')
const tmp = join(here, '.tmp')
const outRoot = join(tmp, 'out')
const PORT = 18123
const BASE = `http://127.0.0.1:${PORT}/v1`

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${name}\n      ${error.message}`)
  }
}

async function ensureXlsx() {
  const target = join(fixtures, 'labs.xlsx')
  const rows = [
    ['姓名', '性别', '年龄', '身份证号', '联系电话', '住址', '检查项目', '结果'],
    ['张三', '男', 45, '11010519491231002X', '13800138000', '北京市朝阳区幸福路1号', '血常规', '白细胞 6.2'],
    ['王芳', '女', 52, '110105195001010020', '13900139000', '北京市海淀区学院路2号', '糖化血红蛋白', '6.8%'],
    ['李四', '男', 60, '110105198803150037', '13700137000', '北京市西城区复兴门大街3号', '胸部CT', '右下肺斑片影'],
  ]
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, '检验')
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  await writeFile(target, buffer)
  return target
}

async function waitForPort(url, timeoutMs = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${url}/models`)
      if (response.ok) return
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('mock server did not start')
}

async function main() {
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  await ensureXlsx()

  const mock = spawn(process.execPath, [join(here, 'mock-llm.mjs')], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, MOCK_PORT: String(PORT) },
  })
  mock.stderr.on('data', (chunk) => process.stderr.write(chunk))
  await waitForPort(BASE)

  const llm = createLlm({ baseURL: BASE, model: 'mock-medical', timeoutMs: 15000 })
  const signal = new AbortController().signal

  const fixturesBefore = await snapshotTree(fixtures)
  let run
  {
    run = await runBatch({
      inputDir: fixtures,
      outputRoot: outRoot,
      options: {
        llm,
        model: 'mock-medical',
        baseURL: BASE,
        maxRounds: 3,
        runId: 'test-run-1',
      },
      signal,
    })
  }

  console.log(`\nrun status=${run.status} files=${run.totals.files} entities=${run.totals.entities} calls=${run.totals.modelCalls}`)

  const runDir = join(outRoot, 'runs', run.id)
  const outDir = join(runDir, 'output')
  const note1 = await readFile(join(outDir, 'note1.txt'), 'utf8').catch(() => '')
  const note2 = await readFile(join(outDir, 'note2.md'), 'utf8').catch(() => '')
  const csvOut = await readFile(join(outDir, 'patients.csv'), 'utf8').catch(() => '')
  const jsonOut = await readFile(join(outDir, 'visits.json'), 'utf8').catch(() => '')
  const vault = JSON.parse(await readFile(join(outRoot, 'vault.json'), 'utf8'))

  await check('批次状态为完成', () => assert.equal(run.status, 'completed'))
  await check('输出文件齐全', () => {
    for (const name of ['note1.txt', 'note2.md', 'patients.csv', 'visits.json', 'labs.xlsx']) {
      assert.ok(run.files.some((file) => file.relPath === name), `missing ${name}`)
    }
  })
  await check('note1 的姓名/证件/电话/地址已清除', () => {
    for (const secret of ['张三', '刘建国', '11010519491231002X', '13800138000', '幸福路1号']) {
      assert.ok(!note1.includes(secret), `still contains ${secret}`)
    }
    assert.match(note1, /化名-[0-9A-F]{6}/)
  })
  await check('note2 的邮箱/证件/就诊号已清除', () => {
    for (const secret of ['王芳', 'wangfang@example.com', '110105195001010020', 'OUT-2024-7788']) {
      assert.ok(!note2.includes(secret), `still contains ${secret}`)
    }
  })
  await check('复核-修复轮次生效', () => {
    const file = run.files.find((item) => item.relPath === 'note1.txt')
    assert.ok(file.rounds >= 2, `rounds=${file.rounds}`)
  })
  await check('结构校验通过', () => {
    for (const file of run.files) assert.equal(file.structure?.ok, true, `${file.relPath}: ${JSON.stringify(file.structure)}`)
  })
  await check('CSV 行列与表头不变', () => {
    const rows = csvOut.trim().split('\n').map((line) => line.split(','))
    assert.equal(rows.length, 4)
    assert.deepEqual(rows[0], ['姓名', '性别', '年龄', '身份证号', '联系电话', '住址', '主诉'])
    assert.ok(!csvOut.includes('张三') && !csvOut.includes('11010519491231002X'))
    assert.match(csvOut, /化名-[0-9A-F]{6}/)
  })
  await check('JSON 结构不变且值已替换', () => {
    const parsed = JSON.parse(jsonOut)
    assert.equal(parsed.length, 2)
    assert.deepEqual(Object.keys(parsed[0]), ['name', 'idCard', 'phone', 'address', 'diagnosis', 'note'])
    assert.match(parsed[0].name, /化名-[0-9A-F]{6}/)
    assert.equal(parsed[0].diagnosis, '2型糖尿病')
  })
  await check('XLSX 工作表与数值列不变', async () => {
    const book = XLSX.read(await readFile(join(outDir, 'labs.xlsx')), { type: 'buffer' })
    assert.deepEqual(book.SheetNames, ['检验'])
    const rows = XLSX.utils.sheet_to_json(book.Sheets['检验'], { header: 1, raw: true })
    assert.equal(rows[0][0], '姓名')
    assert.equal(rows[1][2], 45)
    assert.match(String(rows[1][0]), /化名-[0-9A-F]{6}/)
    assert.ok(!JSON.stringify(rows).includes('11010519491231002X'))
  })
  await check('映射库存在且权限为 600', async () => {
    const info = await stat(join(outRoot, 'vault.json'))
    assert.equal(info.mode & 0o777, 0o600)
    assert.ok(vault.entries.length >= 10)
  })
  await check('报告包含汇总与文件明细', async () => {
    const report = await readFile(join(runDir, 'report.md'), 'utf8')
    assert.match(report, /# 医疗数据匿名化报告/)
    assert.match(report, /## 汇总/)
    assert.match(report, /## 文件明细/)
  })
  await check('同一实体跨批次假名一致', async () => {
    const entry = vault.entries.find((item) => item.type === '姓名' && item.original === '张三')
    assert.ok(entry)
    assert.ok(note1.includes(entry.pseudonym), 'first run pseudonym mismatch')
  })

  await check('源文件逐字节不变，报告记录源文件检查', async () => {
    assert.deepEqual(await snapshotTree(fixtures), fixturesBefore)
    assert.equal(run.sourceCheck.changed, 0)
    assert.ok(run.sourceCheck.files >= 5)
  })
  await check('不再有演练模式与模型调用上限', () => {
    assert.equal('dryRun' in run, false)
    assert.ok(run.totals.modelCalls > 0)
  })
  await check('映射记录所属批次，可整批撤销', async () => {
    assert.ok(run.totals.newMappings >= 10)
    const undo = new Vault(join(outRoot, 'vault.json'))
    await undo.load()
    const before = undo.size()
    assert.equal(undo.forgetRun('test-run-1'), run.totals.newMappings)
    assert.equal(undo.size(), before - run.totals.newMappings)
  })

  // Output root inside the input directory: the second run must not read the
  // first run's vault/reports/outputs back in as records.
  const nestedIn = join(tmp, 'nested', 'in')
  const nestedOut = join(nestedIn, '_anon')
  await mkdir(nestedIn, { recursive: true })
  for (const name of ['note1.txt', 'visits.json']) {
    await writeFile(join(nestedIn, name), await readFile(join(fixtures, name)))
  }
  await runBatch({ inputDir: nestedIn, outputRoot: nestedOut, options: { runId: 'nested-1' } })
  const nested2 = await runBatch({ inputDir: nestedIn, outputRoot: nestedOut, options: { runId: 'nested-2' } })
  await check('输出根在输入目录内时不会回读映射库和旧输出', async () => {
    assert.deepEqual(nested2.files.map((file) => file.relPath).sort(), ['note1.txt', 'visits.json'])
    await assert.rejects(stat(join(nestedOut, 'runs', 'nested-2', 'output', '_anon')))
  })

  // Single-file input: only that file is processed, its siblings are ignored,
  // and the output keeps the file's own name at the output root.
  const singleDir = join(tmp, 'single')
  await mkdir(singleDir, { recursive: true })
  for (const name of ['note1.txt', 'visits.json']) {
    await writeFile(join(singleDir, name), await readFile(join(fixtures, name)))
  }
  const single = await runBatch({
    inputDir: join(singleDir, 'note1.txt'),
    outputRoot: join(tmp, 'single-out'),
    options: { runId: 'single-1' },
  })
  await check('单个文件输入只处理该文件', async () => {
    assert.equal(single.status, 'completed')
    assert.deepEqual(single.files.map((file) => file.relPath), ['note1.txt'])
    const out = await readFile(join(tmp, 'single-out', 'runs', 'single-1', 'output', 'note1.txt'), 'utf8')
    assert.ok(!out.includes('11010519491231002X'), out)
    await assert.rejects(stat(join(tmp, 'single-out', 'runs', 'single-1', 'output', 'visits.json')))
  })

  // Hospital export regression (synthetic data shaped like FACT_ADMN_RCD_INFMT):
  // the ID-card *category* code "01" must not be treated as an ID number and
  // spread into department codes and dates; a ward name returned by the model
  // as a hospital must be rejected; short codes must not spread to bed numbers.
  const exportIn = join(tmp, 'export-in')
  await mkdir(exportIn, { recursive: true })
  const exportRecords = Array.from({ length: 30 }, (_, index) => ({
    PRM_KEY: String(81234500 + index),
    MDC_ORG_NM: '北京示范第一人民医院',
    INHOS_NO: String(20230100 + index),
    PTT_NM: '张三',
    ID_CRD_CGY_CD: '01',
    ID_CRD_CGY_NM: '居民身份证',
    ID_CRD_NO: '11010519491231002X',
    ADMN_DT_TM: `2023-01-${String(index % 28 + 1).padStart(2, '0')} 08:01:19`,
    ADMN_DPT_CD: '2001017',
    ADMN_DPT_NM: '内一科(肾脏病科)(11病区)',
    ADMN_BED_NO: index === 0 ? '4321' : `${index}S`,
    ADMN_DCT_CD: '4321',
    ADMN_DCT_NM: '赵一鸣',
    RSPSBLT_NUS_SGNT: '钱晓丽',
    UPD_STFF_NM: 'AUTO',
    ADMN_TNTTV_DIAG_DSCPT: '肾病综合征',
  }))
  await writeFile(join(exportIn, 'admissions.json'), JSON.stringify(exportRecords, null, 2))
  const exportCalls = { detect: 0, verify: 0, detectTexts: [] }
  const wardModel = {
    model: 'scripted',
    async chatJson(messages) {
      const prompt = messages.map((message) => message.content).join('\n')
      const segments = JSON.parse(prompt.slice(prompt.lastIndexOf('段落：') + 3))
      if (prompt.includes('检查下面脱敏后的文本')) {
        exportCalls.verify += 1
        return { json: { issues: [] } }
      }
      exportCalls.detect += 1
      exportCalls.detectTexts.push(...segments.map((segment) => segment.text))
      const ward = segments.find((segment) => segment.text.includes('病区'))
      return { json: { entities: ward ? [{ segment: ward.id, type: '医院', text: ward.text }] : [] } }
    },
  }
  const exportRun = await runBatch({
    inputDir: join(exportIn, 'admissions.json'),
    outputRoot: join(tmp, 'export-out'),
    options: { llm: wardModel, runId: 'export', maxRounds: 3 },
  })
  const exportOut = JSON.parse(await readFile(join(tmp, 'export-out', 'runs', 'export', 'output', 'admissions.json'), 'utf8'))
  await check('医院导出：证件类型代码、科室、日期、床号不被误替换', async () => {
    const file = exportRun.files[0]
    assert.equal(exportRun.status, 'completed', JSON.stringify(file.issues))
    exportOut.forEach((record, index) => {
      const source = exportRecords[index]
      for (const key of ['ID_CRD_CGY_CD', 'ID_CRD_CGY_NM', 'ADMN_DT_TM', 'ADMN_DPT_CD', 'ADMN_DPT_NM', 'UPD_STFF_NM', 'ADMN_TNTTV_DIAG_DSCPT']) {
        assert.equal(record[key], source[key], `${key}[${index}]`)
      }
      if (index > 0) assert.equal(record.ADMN_BED_NO, source.ADMN_BED_NO, `ADMN_BED_NO[${index}]`)
      for (const key of ['PRM_KEY', 'MDC_ORG_NM', 'INHOS_NO', 'PTT_NM', 'ID_CRD_NO', 'ADMN_DCT_CD', 'ADMN_DCT_NM', 'RSPSBLT_NUS_SGNT']) {
        assert.match(record[key], /^[\u4e00-\u9fa5]{2,3}-[0-9A-F]{6}$/, `${key}[${index}] = ${record[key]}`)
      }
    })
    // A bed number equal to a staff code is a coincidence: short codes do not spread.
    assert.equal(exportOut[0].ADMN_BED_NO, '4321')
    const raw = JSON.stringify(exportOut)
    for (const secret of ['张三', '11010519491231002X', '北京示范第一人民医院', '赵一鸣', '钱晓丽']) {
      assert.ok(!raw.includes(secret), secret)
    }
    assert.ok(file.issues.some((issue) => issue.code === 'implausible' && /科室/.test(issue.detail)), JSON.stringify(file.issues))
  })
  await check('医院导出：重复文本只发一次、数字/日期不发给模型', async () => {
    assert.equal(new Set(exportCalls.detectTexts).size, exportCalls.detectTexts.length, 'duplicate texts sent')
    assert.ok(!exportCalls.detectTexts.some((text) => /^[\d\s:.-]+$/.test(text)), 'numeric values sent')
    assert.ok(exportRun.totals.modelCalls <= 4, `calls=${exportRun.totals.modelCalls}`)
  })

  // Regional-platform export (GEHR): several record types for one patient,
  // split over files. Reproduces leaks and corruption seen on real batches.
  const gehrIn = join(tmp, 'gehr', 'in')
  await mkdir(join(gehrIn, 'a'), { recursive: true })
  await mkdir(join(gehrIn, 'b'), { recursive: true })
  await writeFile(join(gehrIn, 'a', 'visit.json'), JSON.stringify([{
    USER_ID: '53d63c7ea19e0a113ea490a9efc03fda',
    PTT_NM: '赵小明',
    MDC_ORG_CD: '5746',
    MDC_ORG_NM: '东江市人民医院',
    VST_UNQ_ID: '31301d399a3a8b7bdddde3888eff7197',
    OTPT_EMG_NO: '7318775',
    RGST_DPT_NM: '中医院发热门诊',
    RGST_SRC_NM: '医院官方app、网站、公众号等',
    ORG_ATRBT_NM: '综合医院',
    ORG_ADMNSTRT_RGN_LVL_NM: '区属医院',
    ADVC: '好转不明显请及时到医院再次就诊',
    CLLT_SPCM_PSN_NM: '钱多多',
    VRF_RCPT_PSN_NM: '孙一一',
    REMARK: '陪同人周大福已告知',
  }]))
  await writeFile(join(gehrIn, 'b', 'contract.json'), JSON.stringify([{
    SLF_NM: '赵小明',
    ID_CRD_CGY_CD: '01',
    ID_CRD_NO: '110105201710241652',
    RSPSBLT_DCT_CD: '2c9c909e712b6b0f017270a07f437455',
    WRK_UNT_NM: '光明社区',
  }]))
  await writeFile(join(gehrIn, 'b', 'emr.json'), JSON.stringify([
    { ITM_NM: '文本主体', ITM_VLU: '<cell>姓名<fontbold 0>:<baseele I=1 N=文本型 F=[引用值:姓名><isele 1>[<isele 0>赵小明<isele 1>]<isele 0></cell><cell>住址<fontbold 0>:<baseele I=1 C=0 F=[引用值:联系地址><isele 1>[<isele 0>海南省东江市万城镇党校<isele 1>]<isele 0></cell>' },
    { ITM_NM: '地址', ITM_VLU: '东江市万城镇市委党校\t\t' },
    { ITM_NM: '病史', ITM_VLU: '现在住址：东江市万城镇市委党校\t\t电话号码：13800138000\n家属周大福陪同' },
  ]))
  // The model finds the companion's name only in prose of the last file; the
  // first file holds it in an unlabelled remark and is already done by then.
  const gehrModel = {
    model: 'scripted',
    async chatJson(messages) {
      const prompt = messages.map((message) => message.content).join('\n')
      const segments = JSON.parse(prompt.slice(prompt.lastIndexOf('段落：') + 3))
      if (prompt.includes('检查下面脱敏后的文本')) return { json: { issues: [] } }
      const entities = []
      for (const segment of segments) {
        if (segment.text.includes('家属周大福')) entities.push({ segment: segment.id, type: '姓名', text: '周大福' })
        // Echo of a pseudonym fragment: must not be reported as unlocated.
        const echo = /证件-([0-9A-F]{6})/.exec(segment.text)
        if (echo) entities.push({ segment: segment.id, type: '身份证号', text: echo[1] })
      }
      return { json: { entities } }
    },
  }
  const gehrRun = await runBatch({
    inputDir: gehrIn,
    outputRoot: join(tmp, 'gehr', 'out'),
    options: { llm: gehrModel, runId: 'gehr', maxRounds: 3 },
  })
  const gehrOut = join(tmp, 'gehr', 'out', 'runs', 'gehr', 'output')
  const gVisit = JSON.parse(await readFile(join(gehrOut, 'a', 'visit.json'), 'utf8'))[0]
  const gContract = JSON.parse(await readFile(join(gehrOut, 'b', 'contract.json'), 'utf8'))[0]
  const gEmrRaw = await readFile(join(gehrOut, 'b', 'emr.json'), 'utf8')
  await check('区域平台导出：机构类别与通用词“医院”不被替换', () => {
    assert.equal(gVisit.RGST_DPT_NM, '中医院发热门诊')
    assert.equal(gVisit.RGST_SRC_NM, '医院官方app、网站、公众号等')
    assert.equal(gVisit.ORG_ATRBT_NM, '综合医院')
    assert.equal(gVisit.ORG_ADMNSTRT_RGN_LVL_NM, '区属医院')
    assert.equal(gVisit.ADVC, '好转不明显请及时到医院再次就诊')
    assert.equal(gContract.ID_CRD_CGY_CD, '01')
    assert.equal(gContract.RSPSBLT_DCT_CD.includes('017270'), false) // whole staff code replaced, never a fragment
    assert.match(gContract.RSPSBLT_DCT_CD, /^医生-[0-9A-F]{6}$/)
  })
  await check('区域平台导出：本人/检验人员/工作单位/可串联 ID 被替换', () => {
    assert.match(gContract.SLF_NM, /^化名-[0-9A-F]{6}$/)
    assert.equal(gContract.SLF_NM, gVisit.PTT_NM, 'same patient, same pseudonym')
    assert.match(gVisit.CLLT_SPCM_PSN_NM, /^医生-/)
    assert.match(gVisit.VRF_RCPT_PSN_NM, /^医生-/)
    assert.match(gContract.WRK_UNT_NM, /^地址-/)
    for (const key of ['USER_ID', 'VST_UNQ_ID', 'OTPT_EMG_NO', 'MDC_ORG_CD']) {
      assert.match(gVisit[key], /^[\u4e00-\u9fa5]{2}-[0-9A-F]{6}$/, `${key} = ${gVisit[key]}`)
    }
  })
  await check('区域平台导出：病历模板标记与 ITM_NM/ITM_VLU 中的姓名、住址被替换', () => {
    for (const secret of ['赵小明', '党校', '13800138000']) assert.ok(!gEmrRaw.includes(secret), secret)
    assert.match(gEmrRaw, /\[<isele 0>化名-[0-9A-F]{6}<isele 1>\]/)
    assert.match(gEmrRaw, /地址-[0-9A-F]{6}\\t\\t/, 'padding around a whole-field value is kept')
  })
  await check('区域平台导出：其他文件识别到的姓名在批次复扫中补替换', () => {
    assert.ok(!JSON.stringify(gVisit).includes('周大福'), gVisit.REMARK)
    assert.ok(!gEmrRaw.includes('周大福'))
    const visitFile = gehrRun.files.find((file) => file.relPath === 'a/visit.json')
    assert.ok(visitFile.issues.some((issue) => issue.code === 'batch-recheck'), JSON.stringify(visitFile.issues))
    assert.ok(!('doc' in JSON.parse(JSON.stringify(visitFile))), 'live document must not be serialized')
  })
  await check('区域平台导出：模型复述假名片段不产生“未定位”提示', () => {
    assert.equal(echoesPseudonym('ID: 证件-294CD0', '294CD0'), true)
    assert.equal(echoesPseudonym('就诊于医院-4A9C2A', '医院-4A9C2A'), true)
    assert.equal(echoesPseudonym('患者周大福', '周大福'), false)
    for (const file of gehrRun.files) {
      assert.ok(!file.issues.some((issue) => issue.code === 'unlocated'), `${file.relPath}: ${JSON.stringify(file.issues)}`)
    }
    assert.equal(gehrRun.status, 'completed', JSON.stringify(gehrRun.files.map((file) => [file.relPath, file.issues])))
  })

  const allowRun = await runBatch({
    inputDir: join(exportIn, 'admissions.json'),
    outputRoot: join(tmp, 'export-out'),
    options: {
      runId: 'export-allow',
      policy: { allowValues: ['张三'], skipFields: ['ID_CRD_NO'] },
    },
  })
  const allowOut = JSON.parse(await readFile(join(tmp, 'export-out', 'runs', 'export-allow', 'output', 'admissions.json'), 'utf8'))
  await check('排除误判：不匹配的值与不处理的字段原样保留，映射库同步移除', async () => {
    assert.equal(allowOut[0].PTT_NM, '张三')
    assert.equal(allowOut[0].ID_CRD_NO, '11010519491231002X')
    assert.match(allowOut[0].ADMN_DCT_NM, /^医生-/)
    const vaultAfter = JSON.parse(await readFile(join(tmp, 'export-out', 'vault.json'), 'utf8'))
    assert.ok(!vaultAfter.entries.some((entry) => entry.original === '张三'), 'allowlisted value still in vault')
    assert.ok(allowRun.warnings.some((warning) => /移除 1 条/.test(warning)), JSON.stringify(allowRun.warnings))
  })

  // Unsupported files are reported; more files than maxFiles are split into
  // chunks instead of being dropped.
  const mixedIn = join(tmp, 'mixed')
  await mkdir(mixedIn, { recursive: true })
  for (const name of ['note1.txt', 'visits.json']) {
    await writeFile(join(mixedIn, name), await readFile(join(fixtures, name)))
  }
  await writeFile(join(mixedIn, 'scan.pdf'), 'not a real pdf')
  const mixed = await runBatch({
    inputDir: mixedIn,
    outputRoot: join(tmp, 'mixed-out'),
    options: { runId: 'mixed', maxFiles: 1 },
  })
  await check('跳过的文件进入报告；超过 maxFiles 自动分组全部处理', async () => {
    assert.equal(mixed.skipped.unsupported, 1)
    assert.equal(mixed.skipped.overLimit, 0)
    assert.equal(mixed.chunks, 2)
    assert.equal(mixed.totals.files, 2)
    assert.notEqual(mixed.status, 'failed')
    for (const name of ['note1.txt', 'visits.json']) {
      await stat(join(tmp, 'mixed-out', 'runs', 'mixed', 'output', name))
    }
    const report = await readFile(join(tmp, 'mixed-out', 'runs', 'mixed', 'report.md'), 'utf8')
    assert.match(report, /## 注意/)
    assert.match(report, /\.pdf×1/)
    assert.match(report, /自动分为 2 组/)
  })

  // A residual only the verifier catches must be replaced in the next round,
  // not just reported (discovery keeps missing it, as real models do).
  const verifyIn = join(tmp, 'verify-in')
  await mkdir(verifyIn, { recursive: true })
  await writeFile(join(verifyIn, 'note.txt'), '现病史：患者刘建国于3天前受凉后出现咳嗽。\n')
  let verifyCalls = 0
  const verifierOnly = {
    model: 'scripted',
    async chatJson(messages) {
      const prompt = messages.map((message) => message.content).join('\n')
      if (prompt.includes('检查下面脱敏后的文本')) {
        verifyCalls += 1
        const segments = JSON.parse(prompt.slice(prompt.lastIndexOf('段落：') + 3))
        const hit = segments.find((segment) => segment.text.includes('刘建国'))
        return { json: { issues: hit ? [{ segment: hit.id, type: '姓名', text: '刘建国', reason: '残留' }] : [] } }
      }
      return { json: { entities: [] } }
    },
  }
  const verifyRun = await runBatch({
    inputDir: verifyIn,
    outputRoot: join(tmp, 'verify-out'),
    options: { llm: verifierOnly, runId: 'verify-carry', maxRounds: 3 },
  })
  await check('复核发现的残留会在下一轮被替换', async () => {
    const output = await readFile(join(tmp, 'verify-out', 'runs', 'verify-carry', 'output', 'note.txt'), 'utf8')
    assert.ok(!output.includes('刘建国'), output)
    assert.match(output, /化名-[0-9A-F]{6}/)
    assert.equal(verifyRun.status, 'completed')
    assert.ok(verifyCalls >= 2)
  })

  // Non-default identifier policy: mask / label / keep, with a verifier that
  // (wrongly) reports the mask itself as a leftover. It must not loop or
  // re-mask, and kept types must not be flagged.
  const policyIn = join(tmp, 'policy-in')
  await mkdir(policyIn, { recursive: true })
  await writeFile(join(policyIn, 'note.txt'), '姓名：张三\n联系电话：13800138000\n就诊于北京协和医院。\n')
  const nagging = {
    model: 'scripted',
    async chatJson(messages) {
      const prompt = messages.map((message) => message.content).join('\n')
      if (prompt.includes('检查下面脱敏后的文本')) {
        const segments = JSON.parse(prompt.slice(prompt.lastIndexOf('段落：') + 3))
        const issues = []
        for (const segment of segments) {
          if (segment.text.includes('张*')) issues.push({ segment: segment.id, type: '姓名', text: '张*' })
          if (segment.text.includes('北京协和医院')) issues.push({ segment: segment.id, type: '医院', text: '北京协和医院' })
        }
        return { json: { issues } }
      }
      return { json: { entities: [] } }
    },
  }
  const policyRun = await runBatch({
    inputDir: policyIn,
    outputRoot: join(tmp, 'policy-out'),
    options: {
      llm: nagging, runId: 'policy', maxRounds: 3,
      policy: { identifierPolicy: { name: 'mask', phone: 'redact', hospital: 'keep' } },
    },
  })
  const policyOut = await readFile(join(tmp, 'policy-out', 'runs', 'policy', 'output', 'note.txt'), 'utf8')
  await check('标识符策略：遮盖 / 类型标签 / 保留', async () => {
    assert.match(policyOut, /姓名：张\*\n/)
    assert.match(policyOut, /联系电话：\[电话\]\n/)
    assert.match(policyOut, /北京协和医院/)
    assert.ok(!policyOut.includes('张三') && !policyOut.includes('13800138000'))
    assert.equal(policyRun.status, 'completed')
    const vaultRaw = JSON.parse(await readFile(join(tmp, 'policy-out', 'vault.json'), 'utf8'))
    assert.equal(vaultRaw.entries.length, 0, 'masks and labels must not enter the vault')
    const report = await readFile(join(tmp, 'policy-out', 'runs', 'policy', 'report.md'), 'utf8')
    assert.match(report, /按配置保留未处理的标识符：医院/)
    assert.match(report, /部分遮盖（姓名）/)
  })

  // Quasi-identifiers on prose and JSON fields; JSON types must not change.
  const quasiIn = join(tmp, 'quasi-in')
  await mkdir(quasiIn, { recursive: true })
  await writeFile(join(quasiIn, 'note.txt'), '姓名：张三\n性别：男\n年龄：45岁\n入院日期：2024-03-01\n出院日期：2024-03-11\n')
  await writeFile(join(quasiIn, 'rec.json'), JSON.stringify({
    PTT_NM: '张三', BTH_DT: '19491231', ADM_DT: '2024-03-01 10:00:00', AGE: '45', AGE_NUM: 45, GDR_NM: '男', ZIP: '100020', DPT_NM: '呼吸科',
  }, null, 2))
  const quasiRun = await runBatch({
    inputDir: quasiIn,
    outputRoot: join(tmp, 'quasi-out'),
    options: {
      runId: 'quasi',
      policy: { quasiIdentifiers: true, quasiPolicy: { date: 'shift', age: 'band10', sex: 'redact', postalCode: 'prefix3' } },
    },
  })
  const quasiNote = await readFile(join(tmp, 'quasi-out', 'runs', 'quasi', 'output', 'note.txt'), 'utf8')
  const quasiJson = JSON.parse(await readFile(join(tmp, 'quasi-out', 'runs', 'quasi', 'output', 'rec.json'), 'utf8'))
  await check('准标识符：平移保持间隔、年龄分段、性别标签、邮编截断', async () => {
    assert.equal(quasiRun.status, 'completed', JSON.stringify(quasiRun.files.map((f) => f.issues)))
    assert.match(quasiNote, /性别：\[性别\]/)
    assert.match(quasiNote, /年龄：40-49岁/)
    const dates = [...quasiNote.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1])
    assert.equal(dates.length, 2)
    assert.ok(!dates.includes('2024-03-01'))
    assert.equal((Date.parse(dates[1]) - Date.parse(dates[0])) / 86400000, 10, 'interval preserved')
    assert.match(quasiJson.PTT_NM, /^化名-/)
    assert.notEqual(quasiJson.BTH_DT, '19491231')
    assert.match(quasiJson.BTH_DT, /^\d{8}$/)
    assert.match(quasiJson.ADM_DT, /^\d{4}-\d{2}-\d{2} 10:00:00$/)
    assert.equal(quasiJson.AGE, '40-49')
    assert.equal(quasiJson.AGE_NUM, 45, 'numbers are left alone')
    assert.equal(quasiJson.GDR_NM, '[性别]')
    assert.equal(quasiJson.ZIP, '100***')
    assert.equal(quasiJson.DPT_NM, '呼吸科')
    const report = await readFile(join(tmp, 'quasi-out', 'runs', 'quasi', 'report.md'), 'utf8')
    assert.match(report, /### 准标识符处理/)
    assert.ok(!/偏移|[+-]\d+ ?天/.test(report), 'report must not reveal the shift')
  })
  await check('默认规则：准标识符原样保留', async () => {
    const defaultNote = await readFile(join(outDir, 'note1.txt'), 'utf8')
    assert.match(defaultNote, /入院日期：2024-03-01/)
    assert.match(defaultNote, /年龄：45岁/)
    assert.match(defaultNote, /性别：男/)
  })

  // Service defaults: output beside the input, never equal to the input.
  const serviceIn = join(tmp, 'svc', 'patient-01')
  await mkdir(serviceIn, { recursive: true })
  await writeFile(join(serviceIn, 'note1.txt'), await readFile(join(fixtures, 'note1.txt')))
  const service = createService({ config: {}, defaultDirectory: join(tmp, 'profile-dir') })
  await check('服务拒绝输出根等于输入目录', async () => {
    await assert.rejects(service.start({ inputDir: serviceIn, outputRoot: serviceIn }), /不能与输入目录相同/)
  })
  await check('未配置输出根时写到输入目录旁而不是 profile 目录', async () => {
    assert.equal(service.configInfo().outputRoot, '')
    const started = await service.start({ inputDir: serviceIn })
    assert.equal(started.outputRoot, join(tmp, 'svc', '.medical-anonymizer'))
    for (let i = 0; i < 100; i += 1) {
      const { active } = await service.status(started.runId)
      if (!active) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await stat(join(tmp, 'svc', '.medical-anonymizer', 'runs', started.runId, 'output', 'note1.txt'))
    await assert.rejects(stat(join(tmp, 'profile-dir', '.medical-anonymizer')))
  })
  await check('服务接受单个文件，默认输出写在文件旁', async () => {
    const file = join(serviceIn, 'note1.txt')
    const started = await service.start({ inputDir: file })
    assert.equal(started.inputDir, file)
    assert.equal(started.outputRoot, join(serviceIn, '.medical-anonymizer'))
    for (let i = 0; i < 100; i += 1) {
      const { active } = await service.status(started.runId)
      if (!active) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await stat(join(serviceIn, '.medical-anonymizer', 'runs', started.runId, 'output', 'note1.txt'))
  })
  await check('服务拒绝不支持的单个文件', async () => {
    await writeFile(join(serviceIn, 'scan.pdf'), 'not a pdf')
    await assert.rejects(service.start({ inputDir: join(serviceIn, 'scan.pdf') }), /不支持的文件类型/)
  })
  await check('服务拒绝不存在的输入路径', async () => {
    await assert.rejects(service.start({ inputDir: join(serviceIn, 'missing.txt') }), /输入路径不存在/)
  })

  const idemRoot = join(tmp, 'idem')
  const idem = await runBatch({
    inputDir: outDir,
    outputRoot: idemRoot,
    options: { llm, runId: 'test-idem', maxRounds: 3 },
    signal,
  })
  const idemNote = await readFile(join(idemRoot, 'runs', 'test-idem', 'output', 'note1.txt'), 'utf8')
  await check('重复处理不会二次假名化', async () => {
    assert.equal(idem.status, 'completed')
    assert.ok(!/化名-[0-9A-F]{6}-[0-9A-F]{6}/.test(idemNote), idemNote)
    assert.ok(!idemNote.includes('化名-化名'))
    assert.equal(idemNote, note1)
  })

  const rulesRoot = join(tmp, 'rules')
  const rulesRun = await runBatch({
    inputDir: fixtures,
    outputRoot: rulesRoot,
    options: { llm: null, runId: 'test-rules', maxRounds: 2 },
    signal,
  })
  await check('仅规则层可运行并给出警告', async () => {
    assert.equal(rulesRun.config.modelConfigured, false)
    assert.equal(rulesRun.totals.modelCalls, 0)
    const report = await readFile(join(rulesRoot, 'runs', 'test-rules', 'report.md'), 'utf8')
    assert.match(report, /未配置本地模型/)
  })

  mock.kill('SIGTERM')
  console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
