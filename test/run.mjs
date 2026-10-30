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
import { runBatch } from '../lib/pipeline.js'
import { createLlm } from '../lib/llm.js'
import { createService } from '../lib/service.js'

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
        maxLlmCalls: 200,
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

  const dryRoot = join(tmp, 'dry')
  const dry = await runBatch({
    inputDir: fixtures,
    outputRoot: dryRoot,
    options: { llm, dryRun: true, runId: 'test-dry', maxRounds: 3, maxLlmCalls: 200 },
    signal,
  })
  await check('演练模式不写出数据', async () => {
    await assert.rejects(stat(join(dryRoot, 'runs', 'test-dry', 'output')))
    const report = await readFile(join(dryRoot, 'runs', 'test-dry', 'report.md'), 'utf8')
    assert.match(report, /演练模式/)
    assert.equal(dry.totals.entities > 0, true)
  })
  await check('演练模式不落盘映射库（不保存原文）', async () => {
    await assert.rejects(stat(join(dryRoot, 'vault.json')))
    assert.equal(dry.vaultPath, null)
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

  // Unsupported files and the maxFiles cap must be reported, not silently dropped.
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
  await check('跳过的文件与超出上限的文件会进入报告', async () => {
    assert.equal(mixed.skipped.unsupported, 1)
    assert.equal(mixed.skipped.overLimit, 1)
    assert.equal(mixed.status, 'review')
    const report = await readFile(join(tmp, 'mixed-out', 'runs', 'mixed', 'report.md'), 'utf8')
    assert.match(report, /## 注意/)
    assert.match(report, /\.pdf×1/)
    assert.match(report, /超过单批上限 1/)
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
    const started = await service.start({ inputDir: serviceIn, dryRun: false })
    assert.equal(started.outputRoot, join(tmp, 'svc', '.medical-anonymizer'))
    for (let i = 0; i < 100; i += 1) {
      const { active } = await service.status(started.runId)
      if (!active) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await stat(join(tmp, 'svc', '.medical-anonymizer', 'runs', started.runId, 'output', 'note1.txt'))
    await assert.rejects(stat(join(tmp, 'profile-dir', '.medical-anonymizer')))
  })

  const idemRoot = join(tmp, 'idem')
  const idem = await runBatch({
    inputDir: outDir,
    outputRoot: idemRoot,
    options: { llm, runId: 'test-idem', maxRounds: 3, maxLlmCalls: 200 },
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
