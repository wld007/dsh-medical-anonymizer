/**
 * End-to-end pipeline test with a deterministic mock model.
 * Run: node test/run.mjs
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, rm, stat, mkdir, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from '../vendor/xlsx.mjs'
import { runBatch, echoesPseudonym, parseServerMetrics, createConcurrencyTuner } from '../lib/pipeline.js'
import { createLlm } from '../lib/llm.js'
import { createService } from '../lib/service.js'
import { Vault } from '../lib/pseudonym.js'
import { outDirOf, outJoin } from './outputs.mjs'
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

  const runDir = join(outRoot, '_records', 'runs', run.id)
  const outDir = await outDirOf(outRoot, run.id)
  const note1 = await readFile(join(outDir, 'note1.txt'), 'utf8').catch(() => '')
  const note2 = await readFile(join(outDir, 'note2.md'), 'utf8').catch(() => '')
  const csvOut = await readFile(join(outDir, 'patients.csv'), 'utf8').catch(() => '')
  const jsonOut = await readFile(join(outDir, 'visits.json'), 'utf8').catch(() => '')
  const vault = JSON.parse(await readFile(join(outRoot, '_records', 'vault.json'), 'utf8'))

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
    const info = await stat(join(outRoot, '_records', 'vault.json'))
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
    const undo = new Vault(join(outRoot, '_records', 'vault.json'))
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
    await assert.rejects(stat(outJoin(await outDirOf(nestedOut, 'nested-2'), '_anon')))
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
    const out = await readFile(outJoin(await outDirOf(join(tmp, 'single-out'), 'single-1'), 'note1.txt'), 'utf8')
    assert.ok(!out.includes('11010519491231002X'), out)
    await assert.rejects(stat(outJoin(await outDirOf(join(tmp, 'single-out'), 'single-1'), 'visits.json')))
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
      if (prompt.includes('独立的数据安全审查员')) {
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
  const exportOut = JSON.parse(await readFile(outJoin(await outDirOf(join(tmp, 'export-out'), 'export'), 'admissions.json'), 'utf8'))
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
    // Detection never gets numbers; the blind review gets them as one value
    // list per field (a few extra calls, never one per value).
    assert.ok(exportRun.totals.modelCalls <= 8, `calls=${exportRun.totals.modelCalls}`)
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
      if (prompt.includes('独立的数据安全审查员')) return { json: { issues: [] } }
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
  const gehrOut = outJoin(await outDirOf(join(tmp, 'gehr', 'out'), 'gehr'))
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
  const allowOut = JSON.parse(await readFile(outJoin(await outDirOf(join(tmp, 'export-out'), 'export-allow'), 'admissions.json'), 'utf8'))
  await check('排除误判：不匹配的值与不处理的字段原样保留，映射库同步移除', async () => {
    assert.equal(allowOut[0].PTT_NM, '张三')
    assert.equal(allowOut[0].ID_CRD_NO, '11010519491231002X')
    assert.match(allowOut[0].ADMN_DCT_NM, /^医生-/)
    const vaultAfter = JSON.parse(await readFile(join(tmp, 'export-out', '_records', 'vault.json'), 'utf8'))
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
      await stat(outJoin(await outDirOf(join(tmp, 'mixed-out'), 'mixed'), name))
    }
    const report = await readFile(join(tmp, 'mixed-out', '_records', 'runs', 'mixed', 'report.md'), 'utf8')
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
      if (prompt.includes('独立的数据安全审查员')) {
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
    const output = await readFile(outJoin(await outDirOf(join(tmp, 'verify-out'), 'verify-carry'), 'note.txt'), 'utf8')
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
      if (prompt.includes('独立的数据安全审查员')) {
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
  const policyOut = await readFile(outJoin(await outDirOf(join(tmp, 'policy-out'), 'policy'), 'note.txt'), 'utf8')
  await check('标识符策略：遮盖 / 类型标签 / 保留', async () => {
    assert.match(policyOut, /姓名：张\*\n/)
    assert.match(policyOut, /联系电话：\[电话\]\n/)
    assert.match(policyOut, /北京协和医院/)
    assert.ok(!policyOut.includes('张三') && !policyOut.includes('13800138000'))
    assert.equal(policyRun.status, 'completed')
    const vaultRaw = JSON.parse(await readFile(join(tmp, 'policy-out', '_records', 'vault.json'), 'utf8'))
    assert.equal(vaultRaw.entries.length, 0, 'masks and labels must not enter the vault')
    const report = await readFile(join(tmp, 'policy-out', '_records', 'runs', 'policy', 'report.md'), 'utf8')
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
  const quasiNote = await readFile(outJoin(await outDirOf(join(tmp, 'quasi-out'), 'quasi'), 'note.txt'), 'utf8')
  const quasiJson = JSON.parse(await readFile(outJoin(await outDirOf(join(tmp, 'quasi-out'), 'quasi'), 'rec.json'), 'utf8'))
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
    const report = await readFile(join(tmp, 'quasi-out', '_records', 'runs', 'quasi', 'report.md'), 'utf8')
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
    assert.equal(started.outputRoot, join(tmp, 'svc', '_medical-anonymizer'))
    for (let i = 0; i < 100; i += 1) {
      const { active } = await service.status(started.runId)
      if (!active) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await stat(outJoin(await outDirOf(join(tmp, 'svc', '_medical-anonymizer'), started.runId), 'note1.txt'))
    await assert.rejects(stat(join(tmp, 'profile-dir', '.medical-anonymizer')))
  })
  await check('服务接受单个文件，默认输出写在文件旁', async () => {
    const file = join(serviceIn, 'note1.txt')
    const started = await service.start({ inputDir: file })
    assert.equal(started.inputDir, file)
    assert.equal(started.outputRoot, join(serviceIn, '_medical-anonymizer'))
    for (let i = 0; i < 100; i += 1) {
      const { active } = await service.status(started.runId)
      if (!active) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await stat(outJoin(await outDirOf(join(serviceIn, '_medical-anonymizer'), started.runId), 'note1.txt'))
  })
  await check('服务拒绝不支持的单个文件', async () => {
    await writeFile(join(serviceIn, 'scan.pdf'), 'not a pdf')
    await assert.rejects(service.start({ inputDir: join(serviceIn, 'scan.pdf') }), /不支持的文件类型/)
  })
  await check('服务拒绝不存在的输入路径', async () => {
    await assert.rejects(service.start({ inputDir: join(serviceIn, 'missing.txt') }), /输入路径不存在/)
  })
  await check('设置页可保存分组、并发、超时、温度、DICOM 上限与映射库口令', () => {
    const patch = service.normalizeDefaults({
      maxFiles: 50, concurrency: 8, maxDicomFiles: 1000, timeoutMs: 300000, temperature: 0.2, vaultPassphrase: 'correct horse',
    })
    assert.deepEqual(patch, { maxFiles: 50, concurrency: 8, maxDicomFiles: 1000, timeoutMs: 300000, temperature: 0.2, vaultPassphrase: 'correct horse' })
    assert.deepEqual(service.normalizeDefaults({ vaultPassphrase: '' }), { vaultPassphrase: '' })
    assert.throws(() => service.normalizeDefaults({ concurrency: 0 }), /模型并发/)
    assert.throws(() => service.normalizeDefaults({ maxFiles: 1.5 }), /每组文件数/)
    assert.throws(() => service.normalizeDefaults({ timeoutMs: 500 }), /超时/)
    assert.throws(() => service.normalizeDefaults({ temperature: 3 }), /温度/)
    assert.throws(() => service.normalizeDefaults({ vaultPassphrase: 'short' }), /至少 8/)
    const info = service.configInfo()
    assert.equal(info.timeoutMs, 120000)
    assert.equal(info.concurrency, 4)
    assert.equal('vaultPassphrase' in info, false)
  })

  const idemRoot = join(tmp, 'idem')
  const idem = await runBatch({
    inputDir: outDir,
    outputRoot: idemRoot,
    options: { llm, runId: 'test-idem', maxRounds: 3 },
    signal,
  })
  const idemNote = await readFile(outJoin(await outDirOf(idemRoot, 'test-idem'), 'note1.txt'), 'utf8')
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
    const report = await readFile(join(rulesRoot, '_records', 'runs', 'test-rules', 'report.md'), 'utf8')
    assert.match(report, /未配置本地模型/)
  })

  // Output layout: the root holds the finished folder/file plus _records only.
  const layoutIn = join(tmp, 'layout', 'ward_A')
  const layoutRoot = join(tmp, 'layout', 'out')
  await mkdir(layoutIn, { recursive: true })
  await writeFile(join(layoutIn, 'note1.txt'), await readFile(join(fixtures, 'note1.txt')))
  // A root written by 0.7: vault, index and runs/ directly inside it.
  await mkdir(join(layoutRoot, 'runs', 'old-1'), { recursive: true })
  await writeFile(join(layoutRoot, 'runs', 'old-1', 'report.md'), '# old')
  await writeFile(join(layoutRoot, 'index.json'), JSON.stringify([{ id: 'old-1', startedAt: '2026-01-01T00:00:00Z' }]))
  const legacyVault = new Vault(join(layoutRoot, 'vault.json'))
  await legacyVault.load()
  const legacyToken = legacyVault.token('姓名', '旧患者')
  await legacyVault.save()
  const lay1 = await runBatch({ inputDir: layoutIn, outputRoot: layoutRoot, options: { runId: 'lay-1' } })
  const lay2 = await runBatch({ inputDir: layoutIn, outputRoot: layoutRoot, options: { runId: 'lay-2' } })
  const laySingle = await runBatch({ inputDir: join(layoutIn, 'note1.txt'), outputRoot: layoutRoot, options: { runId: 'lay-3' } })
  await check('输出根目录只放成品和 _records；同名不覆盖；旧布局迁入 _records', async () => {
    assert.equal(lay1.output, join(layoutRoot, 'ward_A'))
    assert.equal(lay2.output, join(layoutRoot, 'ward_A (2)'))
    assert.equal(laySingle.output, join(layoutRoot, 'note1.txt'))
    assert.deepEqual((await readdir(layoutRoot)).sort(), ['_records', 'note1.txt', 'ward_A', 'ward_A (2)'])
    assert.deepEqual(await readdir(join(layoutRoot, 'ward_A')), ['note1.txt'])
    assert.deepEqual((await readdir(join(layoutRoot, '_records'))).sort(), ['index.json', 'runs', 'vault.json'])
    assert.deepEqual((await readdir(join(layoutRoot, '_records', 'runs', 'lay-1'))).sort(), ['compare', 'report.json', 'report.md'])
    await stat(join(layoutRoot, '_records', 'runs', 'old-1', 'report.md'))
    const moved = new Vault(join(layoutRoot, '_records', 'vault.json'))
    await moved.load()
    assert.equal(moved.token('姓名', '旧患者'), legacyToken, 'pseudonyms continue after migration')
    const index = JSON.parse(await readFile(join(layoutRoot, '_records', 'index.json'), 'utf8'))
    assert.ok(index.some((item) => item.id === 'old-1') && index.some((item) => item.id === 'lay-2'))
    const report = await readFile(join(layoutRoot, '_records', 'runs', 'lay-1', 'report.md'), 'utf8')
    assert.ok(report.includes(join(layoutRoot, 'ward_A')), report.slice(0, 600))
  })

  const delService = createService({ config: { model: '', outputRoot: layoutRoot }, defaultDirectory: tmp })
  await delService.deleteRun('lay-1', { deliverable: true })
  await delService.deleteRun('lay-2')
  await check('删除批次记录：记录与索引移除，可选删除交付数据，映射库保留', async () => {
    await assert.rejects(stat(join(layoutRoot, 'ward_A')))
    await stat(join(layoutRoot, 'ward_A (2)'))
    await assert.rejects(stat(join(layoutRoot, '_records', 'runs', 'lay-1')))
    await assert.rejects(stat(join(layoutRoot, '_records', 'runs', 'lay-2')))
    const index = JSON.parse(await readFile(join(layoutRoot, '_records', 'index.json'), 'utf8'))
    assert.ok(!index.some((item) => item.id === 'lay-1' || item.id === 'lay-2'))
    assert.ok(index.some((item) => item.id === 'lay-3'))
    await stat(join(layoutRoot, '_records', 'vault.json'))
    await assert.rejects(delService.deleteRun('../../etc'), /批次 id 不正确/)
  })

  const cleared = await delService.clearRuns()
  await check('清空批次记录：其余批次的记录全部删除，交付数据与映射库保留', async () => {
    assert.ok(cleared.removed >= 1 && cleared.failed.length === 0, JSON.stringify(cleared))
    assert.equal((await delService.list()).runs.length, 0)
    await stat(join(layoutRoot, 'note1.txt'))
    await stat(join(layoutRoot, '_records', 'vault.json'))
  })

  const cancelRoot = join(tmp, 'layout', 'cancel-out')
  const cancelController = new AbortController()
  cancelController.abort()
  const cancelled = await runBatch({ inputDir: layoutIn, outputRoot: cancelRoot, options: { runId: 'lay-cancel' }, signal: cancelController.signal })
  await check('取消的批次不放成品到输出根目录', async () => {
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.output, null)
    assert.deepEqual(await readdir(cancelRoot), ['_records'])
  })

  // Default root is the visible _medical-anonymizer; an old hidden one is
  // taken over, and output roots are skipped when the parent is scanned.
  const dflt = join(tmp, 'dflt')
  await mkdir(join(dflt, 'p1'), { recursive: true })
  await writeFile(join(dflt, 'p1', 'note1.txt'), await readFile(join(fixtures, 'note1.txt')))
  await mkdir(join(dflt, '.medical-anonymizer'), { recursive: true })
  const oldVault = new Vault(join(dflt, '.medical-anonymizer', 'vault.json'))
  await oldVault.load()
  const oldToken = oldVault.token('姓名', '旧患者')
  await oldVault.save()
  const dfltState = join(tmp, 'dflt-state')
  const dfltService = createService({ config: { model: '' }, defaultDirectory: dflt, stateDir: dfltState })
  const dfltStart = await dfltService.start({ inputDir: join(dflt, 'p1') })
  for (let i = 0; i < 100 && (await dfltService.status(dfltStart.runId)).run?.status === 'running'; i += 1) {
    await new Promise((r) => setTimeout(r, 50))
  }
  await check('默认输出根为 _medical-anonymizer，旧 .medical-anonymizer 改名沿用', async () => {
    assert.equal(dfltStart.outputRoot, join(dflt, '_medical-anonymizer'))
    await assert.rejects(stat(join(dflt, '.medical-anonymizer')))
    await stat(join(dflt, '_medical-anonymizer', 'p1', 'note1.txt'))
    const v = new Vault(join(dflt, '_medical-anonymizer', '_records', 'vault.json'))
    await v.load()
    assert.equal(v.token('姓名', '旧患者'), oldToken)
  })
  const restarted = createService({ config: { model: '' }, defaultDirectory: dflt, stateDir: dfltState })
  const restartedList = await restarted.list()
  await check('重启后批次记录仍能找到默认输出目录里的批次', async () => {
    assert.ok(restartedList.runs.some((item) => item.id === dfltStart.runId), JSON.stringify(restartedList.runs.map((r) => r.id)))
    const report = await restarted.report(dfltStart.runId)
    assert.match(report.markdown, /医疗数据匿名化报告/)
  })
  await mkdir(join(dflt, 'custom-out', '_records'), { recursive: true })
  await writeFile(join(dflt, 'custom-out', '_records', 'vault.json'), '{}')
  await writeFile(join(dflt, 'custom-out', 'leak.txt'), '姓名：张三')
  const { listInputFiles } = await import('../lib/pipeline.js')
  const parentListing = await listInputFiles(dflt)
  await check('扫描上级目录时跳过输出根目录', () => {
    assert.deepEqual(parentListing.files.map((f) => f.slice(dflt.length + 1)), ['p1/note1.txt'])
  })

  await check('数据量进度：计划字节数与完成字节数一致', () => {
    assert.ok(run.plannedBytes > 0)
    assert.equal(run.doneBytes, run.plannedBytes)
  })
  await check('结果比对：逐文件记录改动片段（原文 / 结果）', async () => {
    const svc = createService({ config: { outputRoot: outRoot }, defaultDirectory: tmp })
    const listed = await svc.compareList(run.id)
    const note = listed.files.find((f) => f.relPath === 'note1.txt')
    assert.ok(note && note.changed > 0 && note.total >= note.changed, JSON.stringify(listed.files))
    const detail = await svc.compareFile(run.id, note.n)
    assert.ok(detail.changes.some((c) => c.before.includes('11010519491231002X') && !c.after.includes('11010519491231002X')))
    const raw = await readFile(join(outRoot, '_records', 'runs', run.id, 'report.json'), 'utf8')
    assert.ok(!raw.includes('11010519491231002X'))
  })
  await check('模型调用日志只记元数据，写入 calls.json', async () => {
    const log = JSON.parse(await readFile(join(outRoot, '_records', 'runs', run.id, 'calls.json'), 'utf8'))
    assert.equal(log.length, run.totals.modelCalls)
    const stages = new Set(log.map((entry) => entry.stage))
    assert.ok(stages.has('识别·替换') && stages.has('盲审'), [...stages].join())
    for (const entry of log) {
      assert.deepEqual(Object.keys(entry).filter((key) => !['in', 'out', 'model', 'attempts', 'dropped'].includes(key)).sort(), ['at', 'file', 'ms', 'result', 'round', 'segments', 'seq', 'stage', 'tokens'])
    }
    const raw = JSON.stringify(log)
    for (const secret of ['张三', '11010519491231002X', '13800138000', '刘建国']) assert.ok(!raw.includes(secret), secret)
    assert.ok(!('callLog' in JSON.parse(await readFile(join(outRoot, '_records', 'runs', run.id, 'report.json'), 'utf8'))))
  })

  // Stop mid-file: the batch ends cancelled (never completed or delivered),
  // and a resume replays the finished model calls.
  const scripted = (counter, abortAt, controller) => ({
    model: 'scripted',
    async chatJson(messages) {
      counter.n += 1
      if (abortAt && counter.n === abortAt) controller.abort()
      const prompt = messages.map((message) => message.content).join('\n')
      return prompt.includes('独立的数据安全审查员') ? { json: { issues: [] } } : { json: { entities: [] } }
    },
  })
  const resumeIn = join(tmp, 'resume-in')
  await mkdir(resumeIn, { recursive: true })
  await writeFile(join(resumeIn, 'note.txt'), await readFile(join(fixtures, 'note1.txt')))
  const resumeRoot = join(tmp, 'resume-out')
  const stopper = new AbortController()
  const first = { n: 0 }
  const stopped = await runBatch({ inputDir: join(resumeIn, 'note.txt'), outputRoot: resumeRoot, options: { runId: 'res-1', llm: scripted(first, 1, stopper) }, signal: stopper.signal })
  const cacheFile = join(resumeRoot, '_records', 'runs', 'res-1', 'model-cache.jsonl')
  await check('停止批次：状态为已取消，不交付，保留续跑信息', async () => {
    assert.equal(stopped.status, 'cancelled')
    assert.equal(stopped.output, null)
    assert.equal(stopped.resumable, true)
    await assert.rejects(stat(join(resumeRoot, 'note.txt')))
    const saved = JSON.parse(await readFile(join(resumeRoot, '_records', 'runs', 'res-1', 'resume.json'), 'utf8'))
    assert.equal(saved.inputDir, join(resumeIn, 'note.txt'))
    assert.ok((await readFile(cacheFile, 'utf8')).trim().split('\n').length >= 1)
  })
  const second = { n: 0 }
  const resumed = await runBatch({ inputDir: join(resumeIn, 'note.txt'), outputRoot: resumeRoot, options: { runId: 'res-2', llm: scripted(second), replaySources: [cacheFile], resumeFrom: 'res-1' } })
  const fresh = { n: 0 }
  const freshRun = await runBatch({ inputDir: join(resumeIn, 'note.txt'), outputRoot: resumeRoot, options: { runId: 'res-3', llm: scripted(fresh) } })
  await check('继续处理：复用已完成的模型调用，结果与完整运行一致，缓存随完成删除', async () => {
    assert.equal(resumed.status, 'completed')
    assert.equal(resumed.resumedFrom, 'res-1')
    assert.ok(resumed.totals.replayedCalls >= 1, JSON.stringify(resumed.totals))
    assert.equal(second.n + resumed.totals.replayedCalls, fresh.n)
    assert.equal(await readFile(resumed.output, 'utf8'), await readFile(freshRun.output, 'utf8'))
    await assert.rejects(stat(join(resumeRoot, '_records', 'runs', 'res-2', 'model-cache.jsonl')))
  })

  const stopper2 = new AbortController()
  const firstB = { n: 0 }
  await runBatch({ inputDir: join(resumeIn, 'note.txt'), outputRoot: resumeRoot, options: { runId: 'res-4', model: 'model-a', llm: { ...scripted(firstB, 1, stopper2), model: 'model-a' } }, signal: stopper2.signal })
  const secondB = { n: 0 }
  const switched = await runBatch({
    inputDir: join(resumeIn, 'note.txt'), outputRoot: resumeRoot,
    options: { runId: 'res-5', model: 'model-b', llm: { ...scripted(secondB), model: 'model-b' }, replaySources: [join(resumeRoot, '_records', 'runs', 'res-4', 'model-cache.jsonl')], resumeFrom: 'res-4', resumeModel: 'model-a' },
  })
  await check('续跑时更换模型：已完成部分沿用原结果，其余交给新模型', async () => {
    assert.equal(switched.status, 'completed')
    assert.ok(switched.totals.replayedCalls >= 1)
    assert.equal(secondB.n + switched.totals.replayedCalls, fresh.n)
    const report = await readFile(join(resumeRoot, '_records', 'runs', 'res-5', 'report.md'), 'utf8')
    assert.match(report, /原模型 `model-a`/)
  })

  // Batch-wide memo: identical text in another file is not sent again, and a
  // remembered detection is applied exactly like a fresh one. A reply that is
  // cut off (bad JSON) for a multi-segment batch is split and retried.
  const finder = (counter, { failMulti = false } = {}) => ({
    model: 'finder',
    async chatJson(messages) {
      counter.n += 1
      const prompt = messages.map((message) => message.content).join('\n')
      const at = prompt.lastIndexOf('段落：')
      const segments = at >= 0 ? JSON.parse(prompt.slice(at + 3)) : []
      if (failMulti && segments.length > 1) {
        counter.split = (counter.split ?? 0) + 1
        throw Object.assign(new Error('模型输出不是有效 JSON'), { code: 'bad-json' })
      }
      if (prompt.includes('独立的数据安全审查员')) return { json: { issues: [] } }
      return { json: { entities: segments.filter((segment) => segment.text.includes('刘建国')).map((segment) => ({ segment: segment.id, type: '姓名', text: '刘建国' })) } }
    },
  })
  const memoIn = join(tmp, 'memo-in')
  for (const name of ['a', 'b', 'c']) {
    await mkdir(join(memoIn, name), { recursive: true })
    await writeFile(join(memoIn, name, 'note.txt'), await readFile(join(fixtures, 'note1.txt')))
  }
  const oneCalls = { n: 0 }
  const oneRun = await runBatch({ inputDir: join(memoIn, 'a', 'note.txt'), outputRoot: join(tmp, 'memo-one'), options: { runId: 'memo-1', llm: finder(oneCalls), concurrency: 1 } })
  const threeCalls = { n: 0 }
  const threeRun = await runBatch({ inputDir: memoIn, outputRoot: join(tmp, 'memo-three'), options: { runId: 'memo-3', llm: finder(threeCalls), concurrency: 1, maxFiles: 1 } })
  await check('批次内结果复用：相同文本只问一次模型，复用的识别结果照样替换', async () => {
    assert.equal(threeRun.status, 'completed')
    assert.equal(threeRun.totals.files, 3)
    assert.equal(threeCalls.n, oneCalls.n, `${threeCalls.n} vs ${oneCalls.n}`)
    assert.ok(threeRun.totals.memoHits > 0)
    assert.ok(!(await readFile(oneRun.output, 'utf8')).includes('刘建国'))
    const texts = []
    for (const name of (await readdir(threeRun.output)).sort()) texts.push(await readFile(join(threeRun.output, name, 'note.txt'), 'utf8'))
    assert.equal(texts.length, 3)
    for (const text of texts) {
      assert.ok(!text.includes('刘建国'))
      assert.equal(text, texts[0])
    }
  })
  const splitIn = join(tmp, 'split-in')
  await mkdir(splitIn, { recursive: true })
  await writeFile(join(splitIn, 'notes.json'), JSON.stringify(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`备注${i}`, i === 5 ? '家属刘建国陪同就诊。' : `第${i}次随访，症状缓解。`]))))
  const splitCalls = { n: 0 }
  const splitRun = await runBatch({ inputDir: join(splitIn, 'notes.json'), outputRoot: join(tmp, 'split-out'), options: { runId: 'split-1', llm: finder(splitCalls, { failMulti: true }) } })
  await check('回复被截断时拆成小批重试，不丢识别结果', async () => {
    assert.ok(splitCalls.split > 0, 'no multi-segment batch was sent')
    assert.ok(!(await readFile(splitRun.output, 'utf8')).includes('刘建国'))
    assert.ok(!splitRun.files[0].issues.some((issue) => issue.code === 'model-error'), JSON.stringify(splitRun.files[0].issues))
  })

  // Several entries of one folder in one batch; the rest of the folder is ignored.
  const multiIn = join(tmp, 'multi')
  for (const name of ['p_a', 'p_b', 'p_c']) {
    await mkdir(join(multiIn, name), { recursive: true })
    await writeFile(join(multiIn, name, 'note.txt'), await readFile(join(fixtures, 'note1.txt')))
  }
  await writeFile(join(multiIn, 'loose.json'), await readFile(join(fixtures, 'visits.json')))
  const multiService = createService({ config: { model: '' }, defaultDirectory: tmp })
  const multiStart = await multiService.start({ inputs: [join(multiIn, 'p_a'), join(multiIn, 'p_c'), join(multiIn, 'loose.json')] })
  for (let i = 0; i < 200 && (await multiService.status(multiStart.runId)).run?.status === 'running'; i += 1) await new Promise((r) => setTimeout(r, 50))
  const multiRun = (await multiService.status(multiStart.runId)).run
  await check('多选同目录的文件和文件夹：一个批次，每项分别交付，未选的不处理', async () => {
    assert.equal(multiRun.status, 'completed')
    const root = join(multiIn, '_medical-anonymizer')
    assert.deepEqual((await readdir(root)).sort(), ['_records', 'loose.json', 'p_a', 'p_c'])
    assert.equal(multiRun.outputs.length, 3)
    assert.deepEqual(multiRun.files.map((f) => f.relPath).sort(), ['loose.json', 'p_a/note.txt', 'p_c/note.txt'])
    assert.ok(!(await readFile(join(root, 'p_a', 'note.txt'), 'utf8')).includes('11010519491231002X'))
  })
  await check('多选必须在同一目录下', async () => {
    await assert.rejects(multiService.start({ inputs: [join(multiIn, 'p_b'), join(fixtures, 'note1.txt')] }), /同一个目录/)
  })

  // Round 2: the detection model rules on verifier findings.
  const adjIn = join(tmp, 'adj-in')
  await mkdir(adjIn, { recursive: true })
  await writeFile(join(adjIn, 'note.txt'), '病程记录：患者由其子王建军陪同，口服黄芪颗粒。\n')
  const adjModel = (insist) => {
    const seen = { adjudicate: 0, verify: 0 }
    return {
      seen,
      model: 'scripted',
      async chatJson(messages) {
        const prompt = messages.map((message) => message.content).join('\n')
        if (prompt.includes('另一位审查员')) {
          seen.adjudicate += 1
          const candidates = JSON.parse(prompt.slice(prompt.lastIndexOf('候选：') + 3))
          return { json: { verdicts: candidates.map((c) => ({ i: c.i, identifier: c.text === '王建军', type: c.type, reason: c.text === '王建军' ? '人名' : '药材名称' })) } }
        }
        const segments = JSON.parse(prompt.slice(prompt.lastIndexOf('段落：') + 3))
        if (prompt.includes('独立的数据安全审查员')) {
          seen.verify += 1
          const issues = []
          for (const seg of segments) {
            if (String(seg.text).includes('王建军')) issues.push({ segment: seg.id, type: '姓名', text: '王建军', reason: '人名' })
            if (String(seg.text).includes('黄芪') && (insist || seen.verify === 1)) issues.push({ segment: seg.id, type: '姓名', text: '黄芪', reason: '疑似人名' })
          }
          return { json: { issues } }
        }
        return { json: { entities: [] } }
      },
    }
  }
  const mildModel = adjModel(false)
  const adj1 = await runBatch({ inputDir: join(adjIn, 'note.txt'), outputRoot: join(tmp, 'adj-out-1'), options: { runId: 'adj-1', llm: mildModel, maxRounds: 3 } })
  const adjOut1 = await readFile(adj1.output, 'utf8')
  await check('第二轮复判：核验报出的真实标识符被替换，误报保留并记为提示', () => {
    assert.ok(mildModel.seen.adjudicate >= 1)
    assert.ok(!adjOut1.includes('王建军') && adjOut1.includes('黄芪'), adjOut1)
    assert.equal(adj1.status, 'completed', JSON.stringify(adj1.files[0].issues))
    assert.ok(adj1.files[0].issues.some((issue) => issue.code === 'verify-dismissed'))
  })
  const adj2 = await runBatch({ inputDir: join(adjIn, 'note.txt'), outputRoot: join(tmp, 'adj-out-2'), options: { runId: 'adj-2', llm: adjModel(true), maxRounds: 3 } })
  await check('交叉核验统计：确认 + 误报 + 分歧 + 未复判 = 盲审报出', () => {
    for (const run of [adj1, adj2]) {
      const b = run.totals.blind
      assert.equal(b.confirmed + b.dismissed + b.disputed + b.unjudged, b.reported, JSON.stringify(b))
      assert.ok(b.calls >= b.flaggedCalls && b.flaggedCalls > 0, JSON.stringify(b))
    }
    assert.ok(adj1.totals.blind.confirmed >= 1 && adj1.totals.blind.dismissed >= 1, JSON.stringify(adj1.totals.blind))
    assert.ok(adj2.totals.blind.disputed >= 1, JSON.stringify(adj2.totals.blind))
  })
  await check('交叉核验明细：逐条记录去向与理由，条数与汇总一致，写入 cross-check.json（600）', async () => {
    for (const [run, root] of [[adj1, 'adj-out-1'], [adj2, 'adj-out-2']]) {
      const file = join(tmp, root, '_records', 'runs', run.id, 'cross-check.json')
      const list = JSON.parse(await readFile(file, 'utf8'))
      assert.equal(list.length, run.totals.blind.reported)
      for (const key of ['confirmed', 'dismissed', 'disputed', 'unjudged']) {
        assert.equal(list.filter((entry) => entry.outcome === key).length, run.totals.blind[key] ?? 0, key)
      }
      assert.ok(list.every((entry) => entry.text && entry.file && entry.outcome !== 'pending'))
      assert.equal((await stat(file)).mode & 0o777, 0o600)
      assert.ok(!(await readFile(join(tmp, root, '_records', 'runs', run.id, 'report.json'), 'utf8')).includes('黄芪颗粒'))
    }
    const dismissed = JSON.parse(await readFile(join(tmp, 'adj-out-1', '_records', 'runs', adj1.id, 'cross-check.json'), 'utf8')).find((entry) => entry.outcome === 'dismissed')
    assert.equal(dismissed.text, '黄芪')
    assert.match(dismissed.judge, /药材/)
  })
  await check('第二轮复判：核验坚持而识别否定时转人工复核', () => {
    assert.equal(adj2.status, 'review')
    assert.ok(adj2.files[0].issues.some((issue) => issue.code === 'disputed' && issue.severity === 'error'))
  })

  // Separate verification model: it alone gets the verify prompts, which
  // carry no list of pseudonyms used.
  const prompts = { detect: [], verify: [] }
  const detector = { model: 'det-a', async chatJson(messages) { const p = messages.map((m) => m.content).join('\n'); prompts.detect.push(p); return p.includes('另一位审查员') ? { json: { verdicts: [] } } : { json: { entities: [] } } } }
  const reviewer = { model: 'rev-b', async chatJson(messages) { prompts.verify.push(messages.map((m) => m.content).join('\n')); return { json: { issues: [] } } } }
  const sepRun = await runBatch({ inputDir: join(fixtures, 'note1.txt'), outputRoot: join(tmp, 'sep-out'), options: { runId: 'sep-1', llm: detector, verifyLlm: reviewer, model: 'det-a', concurrency: 3, verifyConcurrency: 9 } })
  await check('核验可用独立模型；核验提示不含替换值清单，以外部审查员身份提问', async () => {
    assert.equal(sepRun.status, 'completed')
    assert.ok(prompts.verify.length >= 1)
    assert.ok(prompts.detect.every((p) => !p.includes('独立的数据安全审查员')))
    for (const p of prompts.verify) {
      assert.match(p, /独立的数据安全审查员/)
      assert.ok(!p.includes('已使用的替换值'))
    }
    // Instructions are fixed text: nothing about this batch precedes the segments.
    assert.equal(new Set(prompts.verify.map((p) => p.slice(0, p.lastIndexOf('段落：')))).size, 1)
    const log = JSON.parse(await readFile(join(tmp, 'sep-out', '_records', 'runs', 'sep-1', 'calls.json'), 'utf8'))
    assert.ok(log.filter((e) => e.stage === '盲审').every((e) => e.model === 'rev-b'))
    assert.ok(sepRun.totals.models.detect.calls > 0 && sepRun.totals.models.verify.calls > 0, JSON.stringify(sepRun.totals.models))
    assert.ok(log.filter((e) => e.stage === '识别·替换').every((e) => !e.model))
    // Each model has its own request slots; throughput samples per model.
    assert.equal(sepRun.requests.detect.limit, 3)
    assert.equal(sepRun.requests.verify.limit, 9)
    assert.equal(sepRun.config.verifyConcurrency, 9)
    assert.ok(sepRun.loadSeries.done.length === sepRun.loadSeries.points.length && sepRun.loadSeries.done.every((row) => row.length === 4), JSON.stringify(sepRun.loadSeries))
  })
  await check('读取 vLLM /metrics：按模型名取运行、排队、KV 占用和生成总量', () => {
    const text = [
      '# HELP vllm:num_requests_running x',
      'vllm:num_requests_running{engine="0",model_name="a"} 3.0',
      'vllm:num_requests_running{engine="0",model_name="b"} 9.0',
      'vllm:num_requests_waiting{engine="0",model_name="a"} 2.0',
      'vllm:num_requests_waiting_by_reason{engine="0",model_name="a",reason="capacity"} 5.0',
      'vllm:kv_cache_usage_perc{engine="0",model_name="a"} 0.42',
      'vllm:generation_tokens_total{engine="0",model_name="a"} 1.5e+06',
    ].join('\n')
    assert.deepEqual(parseServerMetrics(text, 'a'), { running: 3, waiting: 2, kv: 0.42, generated: 1500000 })
    assert.equal(parseServerMetrics('ollama_up 1', 'a'), null)
  })
  await check('自动调并发：满载加、吞吐不涨退回并记上限、报错或服务器排队降低', () => {
    let clock = 0
    const run = { totals: { models: { detect: { okN: 0, ioTokens: 0, fails: {} } } } }
    const stats = { active: 4, queued: 10, limit: 4 }
    const limiter = { setLimit(n) { stats.limit = n } }
    const tune = createConcurrencyTuner({ run, key: 'detect', limiter, stats, windowMs: 1000, now: () => clock })
    const m = run.totals.models.detect
    // One window: `calls` completed, `tokens` processed, all slots busy.
    const window = (calls, tokens, busy = true) => {
      m.okN += calls
      m.ioTokens += tokens
      for (let i = 0; i < 4; i += 1) {
        stats.active = busy ? stats.limit : 1
        stats.queued = busy ? 10 : 0
        clock += 250
        tune()
      }
    }
    window(10, 1000) // first window: baseline, busy → up
    assert.equal(stats.limit, 6)
    window(15, 1500) // +50 % → up again
    assert.equal(stats.limit, 9)
    window(15, 1520) // +1 % → back, ceiling 9
    assert.equal(stats.limit, 6)
    assert.equal(run.autoTune.detect.ceiling, 9)
    window(15, 1500) // busy but capped below the ceiling
    assert.equal(stats.limit, 8)
    window(10, 1000, false) // gain < 5 % after the step up → back to 6
    assert.equal(stats.limit, 6)
    window(3, 300, false) // not busy: hold
    assert.equal(stats.limit, 6)
    m.fails.timeout = 2
    window(10, 1000) // errors ≥ 5 % → down by a quarter
    assert.equal(stats.limit, 4)
    run.server = { detect: { available: true, samples: [[4, 3, 0.5, 0]] } }
    window(10, 1000) // server queueing → down
    assert.equal(stats.limit, 3)
    assert.deepEqual(run.autoTune.detect.history.map((step) => step.reason), ['up', 'up', 'flat', 'up', 'flat', 'errors', 'server'])
  })
  await check('自动调并发：调低后不再放出名额，调高后立即放出排队的请求', async () => {
    const gate = []
    const slow = { model: 'm', chatJson: () => new Promise((resolve) => gate.push(resolve)) }
    const stats = { active: 0, queued: 0, limit: 0 }
    const run = await (async () => {
      const { limitRequestsForTest } = await import('../lib/pipeline.js')
      return limitRequestsForTest(slow, 2, stats)
    })()
    const calls = Array.from({ length: 6 }, () => run.chatJson([]))
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual([stats.active, stats.queued], [2, 4])
    run.setLimit(4)
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual([stats.active, stats.queued], [4, 2])
    run.setLimit(1)
    gate.shift()({ json: {} }); gate.shift()({ json: {} })
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual([stats.active, stats.queued], [2, 2]) // still above 1: nothing granted
    while (gate.length) gate.shift()({ json: {} })
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(stats.active, 1)
    while (stats.active || stats.queued) { while (gate.length) gate.shift()({ json: {} }); await new Promise((r) => setTimeout(r, 5)) }
    await Promise.all(calls)
  })

  // One large file: its batches run concurrently, never above the limit;
  // a separate verifier has its own slots and overlaps with detection.
  const parIn = join(tmp, 'par-in')
  await mkdir(parIn, { recursive: true })
  const lines = Array.from({ length: 400 }, (_, i) => `第${i}条记录：患者自述症状${'持续'.repeat(i % 7 + 1)}，复查编号段落${i}说明文字较长以便分批处理。`)
  await writeFile(join(parIn, 'big.txt'), lines.join('\n'))
  const gauge = (name) => {
    const g = { name, now: 0, peak: 0 }
    g.llm = { model: name, async chatJson(messages) {
      g.now += 1; g.peak = Math.max(g.peak, g.now)
      await new Promise((r) => setTimeout(r, 15))
      g.now -= 1
      const p = messages.map((m) => m.content).join('\n')
      if (p.includes('另一位审查员')) return { json: { verdicts: [] } }
      return p.includes('独立的数据安全审查员') ? { json: { issues: [] } } : { json: { entities: [] } }
    } }
    return g
  }
  const det = gauge('det')
  const ver = gauge('ver')
  const parRun = await runBatch({ inputDir: join(parIn, 'big.txt'), outputRoot: join(tmp, 'par-out'), options: { runId: 'par-1', llm: det.llm, verifyLlm: ver.llm, concurrency: 3 } })
  await check('单个大文件的批次并发发送，且不超过每个模型的并发上限', () => {
    assert.equal(parRun.status, 'completed')
    assert.ok(det.peak > 1 && det.peak <= 3, `detect peak ${det.peak}`)
    assert.ok(ver.peak > 1 && ver.peak <= 3, `verify peak ${ver.peak}`)
  })

  // Encoded content: a base64 HTML record with a name and an embedded image.
  // The name is found after unwrapping; the image cannot be checked, so the
  // batch is held back from the output root until a reviewer decides.
  const encIn = join(tmp, 'enc-in')
  await mkdir(encIn, { recursive: true })
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 9)]).toString('base64')
  const htmlDoc = `<!DOCTYPE html><html><body><div><span>姓名：</span><span>欧阳明华</span></div><div>身份证号：11010519491231002X</div><img src="data:image/png;base64,${png}"/></body></html>`
  await writeFile(join(encIn, 'emr.json'), JSON.stringify([{ ID: 1, DCMT_CTT: Buffer.from(htmlDoc).toString('base64') }]))
  const encRoot = join(tmp, 'enc-out')
  const encRun = await runBatch({ inputDir: join(encIn, 'emr.json'), outputRoot: encRoot, options: { runId: 'enc-1' } })
  const staged = JSON.parse(await readFile(join(encRoot, '_records', 'runs', 'enc-1', 'output', 'emr.json'), 'utf8'))
  const stagedHtml = Buffer.from(staged[0].DCMT_CTT, 'base64').toString('utf8')
  await check('编码内容：base64 里的 HTML 解码后识别替换，写回仍是 base64', () => {
    assert.ok(!stagedHtml.includes('欧阳明华') && !stagedHtml.includes('11010519491231002X'), stagedHtml.slice(0, 300))
    assert.match(stagedHtml, /<span>化名-[0-9A-F]{6}<\/span>/)
    assert.ok(encRun.totals.coverage.decoded > 0)
  })
  await check('无法检查的嵌入图片转人工复核；未处理完前交付数据不出现在输出根目录', async () => {
    assert.equal(encRun.status, 'review')
    assert.equal(encRun.withheld, true)
    assert.equal(encRun.output, null)
    assert.deepEqual(await readdir(encRoot), ['_records'])
    assert.ok(encRun.files[0].issues.some((issue) => issue.code === 'opaque' && /PNG/.test(issue.detail)))
  })
  const encService = createService({ config: { outputRoot: encRoot }, defaultDirectory: tmp })
  const encItems = await encService.reviewItems('enc-1')
  const opaqueIds = encItems.files.flatMap((file) => file.items).filter((item) => item.code === 'opaque').map((item) => item.id)
  const bulk = await encService.reviewBulk('enc-1', opaqueIds, 'remove')
  await check('批量移除无法检查的内容后，交付数据才放到输出根目录；图片已替换为占位', async () => {
    assert.equal(bulk.completed, true)
    assert.equal(bulk.status, 'completed')
    assert.deepEqual((await readdir(encRoot)).sort(), ['_records', 'emr.json'])
    const delivered = JSON.parse(await readFile(join(encRoot, 'emr.json'), 'utf8'))
    const html = Buffer.from(delivered[0].DCMT_CTT, 'base64').toString('utf8')
    assert.ok(!html.includes(png) && /<img src="data:image\/png;base64,iVBOR/.test(html), html.slice(-200))
    assert.ok(!html.includes('欧阳明华'))
  })

  // Blind review sees numbers too: an unformatted record number in a field
  // the rules do not know is reported by the reviewer and replaced.
  const numIn = join(tmp, 'num-in')
  await mkdir(numIn, { recursive: true })
  await writeFile(join(numIn, 'v.json'), JSON.stringify([{ HZBH: '73920018', JE: '120.50', NOTE: '复诊' }, { HZBH: '73920019', JE: '80', NOTE: '复诊' }]))
  const seenLists = []
  const numModel = { model: 'scripted', async chatJson(messages) {
    const p = messages.map((m) => m.content).join('\n')
    if (p.includes('另一位审查员')) {
      const c = JSON.parse(p.slice(p.lastIndexOf('候选：') + 3))
      return { json: { verdicts: c.map((x) => ({ i: x.i, identifier: true, type: x.type })) } }
    }
    if (!p.includes('独立的数据安全审查员')) return { json: { entities: [] } }
    const segs = JSON.parse(p.slice(p.lastIndexOf('段落：') + 3))
    const issues = []
    for (const seg of segs) {
      if (String(seg.id).startsWith('num:')) seenLists.push(seg)
      if (seg.field === 'HZBH') for (const v of seg.text.split('；')) issues.push({ segment: seg.id, type: '病历号', text: v, reason: '患者编号' })
    }
    return { json: { issues } }
  } }
  const numRun = await runBatch({ inputDir: join(numIn, 'v.json'), outputRoot: join(tmp, 'num-out'), options: { runId: 'num-1', llm: numModel, maxRounds: 3 } })
  const numOut = JSON.parse(await readFile(numRun.output, 'utf8'))
  await check('独立盲审也检查纯数字（按字段合并成值列表）；报出的编号经复判后被替换', () => {
    assert.ok(seenLists.some((seg) => seg.field === 'HZBH' && seg.text.includes('73920018') && seg.text.includes('73920019')), JSON.stringify(seenLists))
    assert.ok(numOut.every((row) => /^病历-[0-9A-F]{6}$/.test(row.HZBH)), JSON.stringify(numOut))
    assert.equal(numOut[0].JE, '120.50')
    assert.ok(numRun.totals.blind.reported >= 2 && numRun.totals.blind.confirmed >= 2, JSON.stringify(numRun.totals.blind))
    assert.equal(numRun.status, 'completed', JSON.stringify(numRun.files[0].issues))
  })

  // More files than request slots: requests never exceed the limit, and the
  // model is kept busy (several files' requests queue behind each other).
  const schIn = join(tmp, 'sch-in')
  await mkdir(schIn, { recursive: true })
  for (let i = 0; i < 12; i += 1) await writeFile(join(schIn, `n${i}.txt`), `第${i}份记录：患者自述头痛三天，复查后好转。`)
  const sch = { now: 0, peak: 0, filesSeen: new Set(), maxFilesAtOnce: 0, open: new Set() }
  const schModel = { model: 'sch', async chatJson(messages) {
    sch.now += 1; sch.peak = Math.max(sch.peak, sch.now)
    await new Promise((r) => setTimeout(r, 20))
    sch.now -= 1
    const p = messages.map((m) => m.content).join('\n')
    return p.includes('独立的数据安全审查员') ? { json: { issues: [] } } : { json: { entities: [] } }
  } }
  const schRun = await runBatch({ inputDir: schIn, outputRoot: join(tmp, 'sch-out'), options: { runId: 'sch-1', llm: schModel, concurrency: 2 } })
  await check('同时处理的文件数为并发数的 3 倍，模型请求仍不超过并发数', () => {
    assert.equal(schRun.status, 'completed')
    assert.equal(schRun.fileSlots, 6)
    assert.equal(sch.peak, 2)
    assert.equal(schRun.requests.detect.active, 0)
    assert.equal(schRun.requests.detect.queued, 0)
    assert.ok(schRun.totals.sentSegments > 0)
    assert.ok(schRun.loadSeries.points.length >= 1 && schRun.loadSeries.points.every((p) => p.length === 2), JSON.stringify(schRun.loadSeries))
  })

  // Field profiling: an unknown column of names is replaced as a whole, a
  // drug-name column is not sent value by value but reviewed as a list.
  const profIn = join(tmp, 'prof-in')
  await mkdir(profIn, { recursive: true })
  const names = ['欧阳明华', '司马青', '诸葛文', '上官云', '慕容雪', '端木林', '公孙杰', '令狐冲']
  const drugs = ['阿莫西林胶囊', '布洛芬缓释胶囊', '头孢克肟片', '奥美拉唑肠溶胶囊', '二甲双胍片', '氨氯地平片', '阿托伐他汀钙片', '甲钴胺片']
  const rows = names.map((name, i) => ({ HZXM: name, YPMC: drugs[i], BZ: i === 3 ? `家属${names[0]}来电咨询用药` : '按时服药' }))
  await writeFile(join(profIn, 'rx.json'), JSON.stringify(rows))
  await writeFile(join(profIn, 'rx2.json'), JSON.stringify(rows.slice(0, 7).map((row) => ({ ...row, HZXM: row.HZXM + '甲' }))))
  const seen = { profile: 0, detectTexts: [], lists: [] }
  const profModel = { model: 'prof', async chatJson(messages) {
    const p = messages.map((m) => m.content).join('\n')
    if (p.includes('结构化医疗数据')) {
      seen.profile += 1
      const fields = JSON.parse(p.slice(p.lastIndexOf('字段：') + 3))
      return { json: { fields: fields.map((f) => ({ field: f.field, category: f.field === 'HZXM' ? 'identifier' : f.field === 'YPMC' ? 'vocabulary' : 'freetext', type: f.field === 'HZXM' ? '姓名' : '' })) } }
    }
    if (p.includes('另一位审查员')) return { json: { verdicts: [] } }
    const segs = JSON.parse(p.slice(p.lastIndexOf('段落：') + 3))
    if (p.includes('独立的数据安全审查员')) {
      for (const seg of segs) if (String(seg.id).startsWith('num:')) seen.lists.push(seg)
      return { json: { issues: [] } }
    }
    const entities = []
    for (const seg of segs) {
      seen.detectTexts.push(seg.text)
      if (seg.text.includes(names[0])) entities.push({ segment: seg.id, type: '姓名', text: names[0] })
    }
    return { json: { entities } }
  } }
  const profRun = await runBatch({ inputDir: profIn, outputRoot: join(tmp, 'prof-out'), options: { runId: 'prof-1', llm: profModel } })
  const profOut = JSON.parse(await readFile(join(outJoin(await outDirOf(join(tmp, 'prof-out'), 'prof-1')), 'rx.json'), 'utf8'))
  await check('字段画像：未知的人名列整列替换，药品列不逐值识别、按列送盲审，同结构文件只画像一次', () => {
    assert.equal(seen.profile, 1, `profile calls ${seen.profile}`)
    assert.ok(profOut.every((row) => /^化名-[0-9A-F]{6}$/.test(row.HZXM)), JSON.stringify(profOut.map((r) => r.HZXM)))
    assert.deepEqual(profOut.map((row) => row.YPMC), drugs)
    assert.ok(!seen.detectTexts.some((text) => drugs.includes(text) || names.includes(text)), JSON.stringify(seen.detectTexts))
    assert.ok(profOut[3].BZ.includes('化名-') && !profOut[3].BZ.includes(names[0]), profOut[3].BZ)
    // Values reviewed clean in one file are not listed again (batch memo), so
    // the lists of both files together cover the column.
    const listedDrugs = new Set(seen.lists.filter((seg) => seg.field === 'YPMC').flatMap((seg) => seg.text.split('；')))
    assert.ok(drugs.every((d) => listedDrugs.has(d)), JSON.stringify(seen.lists))
    assert.equal(profRun.profileSummary.HZXM.category, 'identifier')
    assert.equal(profRun.profileSummary.YPMC.files, 2)
  })

  await check('发现标识符（去重）按本批计，含之前批次已有的原值', async () => {
    const again = await runBatch({ inputDir: join(fixtures, 'note1.txt'), outputRoot: join(tmp, 'resume-out'), options: { runId: 'dist-1' } })
    assert.ok(again.totals.distinctIds > 0, JSON.stringify(again.totals))
    assert.ok(again.totals.distinctIds <= again.totals.entities)
    assert.ok(again.totals.newMappings < again.totals.distinctIds, `new ${again.totals.newMappings} distinct ${again.totals.distinctIds}`)
  })

  // Compact detection output: {"e":[["段id","类型","原文"]]}, no context field.
  const cmpIn = join(tmp, 'compact-in')
  await mkdir(cmpIn, { recursive: true })
  await writeFile(join(cmpIn, 'n.txt'), '病程记录：患者由其子司徒远航陪同来院。\n')
  let detectPromptSeen = ''
  const compactModel = { model: 'c', async chatJson(messages) {
    const p = messages.map((m) => m.content).join('\n')
    if (p.includes('独立的数据安全审查员')) return { json: { issues: [] } }
    detectPromptSeen = p
    const segs = JSON.parse(p.slice(p.lastIndexOf('段落：') + 3))
    return { json: { e: segs.filter((seg) => seg.text.includes('司徒远航')).map((seg) => [seg.id, '姓名', '司徒远航']) } }
  } }
  const cmpRun = await runBatch({ inputDir: join(cmpIn, 'n.txt'), outputRoot: join(tmp, 'compact-out'), options: { runId: 'cmp-1', llm: compactModel } })
  await check('识别输出用紧凑三元数组格式，不再要求 context 字段', async () => {
    assert.ok(detectPromptSeen.includes('{"e":[["段id","类型","原文片段"]]}') && !detectPromptSeen.includes('context'), detectPromptSeen.slice(0, 400))
    const out = await readFile(cmpRun.output, 'utf8')
    assert.ok(!out.includes('司徒远航') && /化名-[0-9A-F]{6}/.test(out), out)
  })

  // Valid JSON of the wrong shape is not "nothing found": retried, split,
  // and segments still unanswered go to manual review.
  const shapeIn = join(tmp, 'shape-in')
  await mkdir(shapeIn, { recursive: true })
  await writeFile(join(shapeIn, 'n.txt'), '病程记录：患者由其子欧阳峻陪同来院，诉头痛三天。\n')
  let shapeCalls = 0
  const shapeModel = { model: 's', async chatJson(messages, opts = {}) {
    shapeCalls += 1
    const p = messages.map((m) => m.content).join('\n')
    const json = p.includes('独立的数据安全审查员') ? { issues: [] } : {}
    // Imitate the real client: validation failure → bad-shape error.
    if (opts.validate && !opts.validate(json)) throw Object.assign(new Error('模型输出格式不符'), { code: 'bad-shape', attempts: 2 })
    return { json, attempts: 1 }
  } }
  const shapeRun = await runBatch({ inputDir: join(shapeIn, 'n.txt'), outputRoot: join(tmp, 'shape-out'), options: { runId: 'shape-1', llm: shapeModel, maxRounds: 1 } })
  await check('输出格式不符（如 {}）记为失败、记录重试，未识别的段落转人工复核', async () => {
    assert.equal(shapeRun.status, 'review')
    assert.ok(shapeRun.files[0].issues.some((issue) => issue.code === 'model-unchecked' && issue.severity === 'error'), JSON.stringify(shapeRun.files[0].issues))
    const log = JSON.parse(await readFile(join(tmp, 'shape-out', '_records', 'runs', 'shape-1', 'calls.json'), 'utf8'))
    const bad = log.filter((entry) => entry.result === 'bad-shape')
    assert.ok(bad.length >= 1 && bad.every((entry) => entry.attempts === 2), JSON.stringify(log))
    assert.ok(shapeRun.totals.models.detect.fails['bad-shape'] >= 1)
  })

  // Parameters from the page apply to that batch only; defaults stay.
  const ovIn = join(tmp, 'ov-in')
  await mkdir(ovIn, { recursive: true })
  await writeFile(join(ovIn, 'n.txt'), await readFile(join(fixtures, 'note1.txt')))
  const ovService = createService({ config: { model: '', maxRounds: 3, concurrency: 4, maxFiles: 200 }, defaultDirectory: tmp })
  const ovStart = await ovService.start({ inputDir: join(ovIn, 'n.txt'), maxRounds: 2, concurrency: 7, maxFiles: 50, timeoutMs: 60000, temperature: 0.3 })
  for (let i = 0; i < 200 && (await ovService.status(ovStart.runId)).run?.status === 'running'; i += 1) await new Promise((r) => setTimeout(r, 50))
  const ovRun = (await ovService.status(ovStart.runId)).run
  await check('本批参数只作用于本批，默认值不变，报告注明与默认不同的项', async () => {
    assert.equal(ovRun.config.maxRounds, 2)
    assert.equal(ovRun.config.concurrency, 7)
    assert.equal(ovRun.config.chunkSize, 50)
    assert.equal(ovRun.config.timeoutMs, 60000)
    assert.deepEqual([...ovRun.config.overridden].sort(), ['concurrency', 'maxFiles', 'maxRounds', 'temperature', 'timeoutMs'])
    const info = ovService.configInfo()
    assert.equal(info.maxRounds, 3)
    assert.equal(info.concurrency, 4)
    const report = await readFile(join(ovRun.runDir, 'report.md'), 'utf8')
    assert.match(report, /本批单独设置/)
  })

  // Automatic concurrency inside a batch: the tuner runs, records its state
  // and the report says so.
  const autoModel = { model: 'auto-m', async chatJson(messages) {
    await new Promise((r) => setTimeout(r, 30))
    const p = messages.map((m) => m.content).join('\n')
    if (p.includes('独立的数据安全审查员')) return { json: { issues: [] }, usage: { prompt_tokens: 500, completion_tokens: 5, total_tokens: 505 } }
    return { json: { e: [] }, usage: { prompt_tokens: 500, completion_tokens: 5, total_tokens: 505 } }
  } }
  const autoIn = join(tmp, 'auto-in')
  await mkdir(autoIn, { recursive: true })
  for (let i = 0; i < 12; i += 1) await writeFile(join(autoIn, `n${i}.txt`), `${'病程记录：患者头痛三天，予以对症治疗，复查血常规。'.repeat(80)}\n${i}\n`)
  const autoRun = await runBatch({ inputDir: autoIn, outputRoot: join(tmp, 'auto-out'), options: { runId: 'auto-1', llm: autoModel, concurrency: 1, autoConcurrency: true, autoTuneMs: 200, maxRounds: 1 } })
  await check('自动调并发在批次中运行：记录起始值、调整记录与报告说明', async () => {
    assert.equal(autoRun.config.autoConcurrency, true)
    assert.equal(autoRun.autoTune.detect.start, 1)
    assert.ok(autoRun.loadSeries.limits.length === autoRun.loadSeries.points.length)
    const report = await readFile(join(autoRun.runDir, 'report.md'), 'utf8')
    assert.match(report, /自动调并发：模型 1/)
  })

  mock.kill('SIGTERM')
  console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
