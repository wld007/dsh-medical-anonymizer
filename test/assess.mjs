/**
 * Effect assessment: K anonymity and A = K × S × E, on the delivered
 * output of a batch; no regional specification named.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyColumns, identificationLevel, measure, requiredK } from '../lib/assess.js'
import { normalizePolicyPatch, resolvePolicy } from '../lib/policy.js'
import { runBatch } from '../lib/pipeline.js'
import { readZip } from '../lib/zip.js'

// Required K from S and E: 1/5 → 5, 1/20 → 20, E = 2 halves it.
assert.equal(requiredK('controlledTwo', 1), 5)
assert.equal(requiredK('public', 1), 20)
assert.equal(requiredK('controlledTwo', 2), 3)
assert.equal(requiredK('enclaveSame', 1), 3)
assert.equal(requiredK('bogus', 1), 5) // falls back to the default scene

// Column roles: quasi-identifiers by Table 2, direct identifiers excluded,
// hospital kept as a location, the ID card as person key, diagnosis sensitive.
{
  const roles = classifyColumns(['姓名', '身份证号', '性别', '年龄', '入院日期', '就诊医院', '职业', '入院诊断', '检验结果'])
  assert.deepEqual(roles.quasi.map((column) => column.name), ['性别', '年龄', '入院日期', '就诊医院', '职业'])
  assert.equal(roles.person, 1)
  assert.equal(roles.sensitive, 7)
  const tuned = classifyColumns(['性别', '入院日期', '病区'], { ignoreFields: ['入院日期'], extraFields: ['病区'] })
  assert.deepEqual(tuned.quasi.map((column) => column.name), ['性别', '病区'])
}

// K counts people when a person key exists; L and T from the diagnosis.
{
  const rows = [
    { values: ['男', '40-49'], person: 'a', sensitive: '肺结核' },
    { values: ['男', '40-49'], person: 'a', sensitive: '肺结核' },
    { values: ['男', '40-49'], person: 'b', sensitive: '高血压' },
    { values: ['女', '40-49'], person: 'c', sensitive: '肺结核' },
    { values: ['女', '40-49'], person: 'd', sensitive: '肺结核' },
    { values: ['女', '40-49'], person: 'e', sensitive: '肺结核' },
  ]
  const byPerson = measure(rows, { hasPerson: true, hasSensitive: true, needK: 3, columns: [{}, {}] })
  assert.equal(byPerson.k, 2)
  assert.equal(byPerson.classes, 2)
  assert.deepEqual(byPerson.below, { classes: 1, records: 3 })
  assert.equal(byPerson.l, 1)
  assert.deepEqual(byPerson.distinct, [2, 1])
  assert.ok(byPerson.t > 0 && byPerson.t < 1)
  const byRecord = measure(rows, { hasPerson: false, hasSensitive: false, needK: 3, columns: [] })
  assert.equal(byRecord.k, 3)
  assert.equal(byRecord.l, null)
}

// Level of Table 4.
assert.equal(identificationLevel({ datasets: [{}], pass: true }, { directRemaining: true }).level, 1)
assert.equal(identificationLevel({ datasets: [{}], pass: false }, { directRemaining: false }).level, 2)
assert.equal(identificationLevel({ datasets: [{}], pass: true }, { directRemaining: false }).level, 3)
assert.equal(identificationLevel({ datasets: [], unstructured: { text: 0 } }, { directRemaining: false }).level, 4)

// Settings: defaults, validation.
{
  const policy = resolvePolicy({})
  assert.deepEqual(policy.assessment, { scene: 'controlledTwo', environment: 1, ignoreFields: [], extraFields: [], basis: '' })
  assert.equal(resolvePolicy({ assessBasis: '  浙江省某规范  ' }).assessment.basis, '浙江省某规范')
  assert.throws(() => normalizePolicyPatch({ assessBasis: 'a\nb' }), /一行/)
  assert.equal(resolvePolicy({ assessScene: 'public', assessEnvironment: 2 }).assessment.environment, 2)
  assert.equal(resolvePolicy({ assessEnvironment: 99 }).assessment.environment, 1)
  assert.throws(() => normalizePolicyPatch({ assessScene: 'nope' }), /场景/)
  assert.throws(() => normalizePolicyPatch({ assessEnvironment: 0 }), /环境系数/)
  assert.equal(normalizePolicyPatch({ assessEnvironment: '1.5' }).assessEnvironment, 1.5)
}

// End to end: a CSV split across two files pools into one dataset; the
// report carries A, K and the level; no original value appears.
{
  const tmp = await mkdtemp(join(tmpdir(), 'assess-'))
  try {
    const input = join(tmp, 'in')
    await mkdir(input)
    const header = '姓名,性别,年龄,诊断'
    const rows = (start) => Array.from({ length: 6 }, (_, i) => `患者${String.fromCharCode(0x4e00 + start + i)}${String.fromCharCode(0x4e00 + start + i + 40)},${i % 2 ? '男' : '女'},4${i}岁,${i % 3 ? '高血压' : '糖尿病'}`)
    await writeFile(join(input, 'a.csv'), [header, ...rows(0)].join('\n') + '\n')
    await writeFile(join(input, 'b.csv'), [header, ...rows(10)].join('\n') + '\n')
    await writeFile(join(input, 'note.txt'), '主诉：咳嗽两周。\n')
    const run = await runBatch({
      inputDir: input,
      outputRoot: join(tmp, 'out'),
      options: { runId: 'assess-e2e', policy: { quasiIdentifiers: true, quasiPolicy: { age: 'band10' }, assessScene: 'enclaveSame' } },
    })
    assert.equal(run.status, 'completed')
    const assessment = run.assessment
    assert.equal(assessment.scene.id, 'enclaveSame')
    assert.equal(assessment.requiredK, 3)
    assert.equal(assessment.datasets.length, 1)
    const [dataset] = assessment.datasets
    assert.equal(dataset.files, 2)
    assert.equal(dataset.records, 12)
    assert.deepEqual(dataset.columns.map((column) => column.name), ['性别', '年龄'])
    // Ages 40-45 all fall in 40-49: classes are the two sexes, 6 people each.
    assert.equal(dataset.k, 6)
    assert.equal(dataset.a, 2)
    assert.equal(dataset.pass, true)
    assert.equal(assessment.unstructured.text, 1)
    const md = await readFile(join(run.runDir, 'report.md'), 'utf8')
    assert.match(md, /## 匿名化效果评估/)
    assert.ok(!md.includes('北京') && !md.includes('附录 A'))
    assert.match(md, /A = K × S × E = 6 × 1\/3 × 1 = 2/)
    assert.match(md, /\*\*3 级\*\*/)
    assert.ok(!md.includes('患者一'), 'no original value in the report')

    // Without age banding K drops to 2 and the report names the column.
    const raw = await runBatch({
      inputDir: input,
      outputRoot: join(tmp, 'out2'),
      options: { runId: 'assess-e2e-raw', policy: { assessScene: 'public' } },
    })
    assert.equal(raw.assessment.k, 2) // each sex+age pair occurs once per file
    assert.equal(raw.assessment.pass, false)
    assert.equal(raw.assessment.datasets[0].bestDrop.column, '年龄')
    const rawMd = await readFile(join(raw.runDir, 'report.md'), 'utf8')
    assert.match(rawMd, /\*\*2 级\*\*/)
    assert.match(rawMd, /影响最大的是「年龄」/)

    // The formal Word report: in the batch's records, never in output/;
    // failing values in red; no original value.
    for (const [batch, pass] of [[run, true], [raw, false]]) {
      assert.equal(batch.formalReport.path, join(batch.runDir, '匿名化效果评估报告.docx'))
      assert.equal(batch.formalReport.final, true)
      const { entries } = await readZip(batch.formalReport.path)
      const names = entries.map((entry) => entry.name)
      for (const part of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml']) assert.ok(names.includes(part), part)
      const xml = entries.find((entry) => entry.name === 'word/document.xml').data.toString('utf8')
      assert.match(xml, /健康医疗数据匿名化效果评估报告/)
      assert.match(xml, /匿名化程度 A/)
      assert.ok(!xml.includes('北京') && !xml.includes('附录 A'), 'no regional specification named')
      assert.match(xml, /GB\/T 42460—2023/)
      assert.equal(xml.includes('w:val="C00000"'), !pass, 'red only when below requirement')
      assert.ok(!xml.includes('患者一'), 'no original value in the Word report')
      const { mode } = await stat(batch.formalReport.path)
      assert.equal(mode & 0o777, 0o600)
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

console.log('assess: ok')
