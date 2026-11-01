/**
 * Path anonymization tests. Synthetic values only.
 * Run: node test/paths.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPathAnonymizer, validIdCard } from '../lib/paths.js'
import { Vault } from '../lib/pseudonym.js'
import { resolvePolicy } from '../lib/policy.js'
import { isPseudonym } from '../lib/rules.js'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'paths')
await rm(tmp, { recursive: true, force: true })
await mkdir(tmp, { recursive: true })

/** Append the GB 11643 check digit to a 17-digit body. */
function withCheck(body) {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  let sum = 0
  for (let i = 0; i < 17; i += 1) sum += Number(body[i]) * weights[i]
  return body + '10X98765432'[sum % 11]
}

const ID = withCheck('11010519900307123')
const ID2 = withCheck('32010219851111456')
assert.ok(validIdCard(ID) && validIdCard(ID2))
const PHONE = '13800138000'

async function freshVault(name) {
  const vault = new Vault(join(tmp, `${name}.json`))
  await vault.load()
  return vault
}

const policy = resolvePolicy({})

{
  // Zip name: index_姓名_身份证号 (name with ID evidence, index kept).
  const vault = await freshVault('zip')
  const paths = createPathAnonymizer({ vault, policy })
  const out = paths.map(`64_莫小卿_${ID}.zip`)
  assert.equal(out, `64_${vault.token('姓名', '莫小卿')}_${vault.token('身份证号', ID)}.zip`)
  assert.equal(paths.map(out), out, 'idempotent')
  // Name without surname-list match is still caught next to an ID card.
  assert.equal(paths.map(`7_佚名甲_${ID2}.zip`), `7_${vault.token('姓名', '佚名甲')}_${vault.token('身份证号', ID2)}.zip`)
  // Phone in a name.
  assert.equal(paths.map(`张三_${PHONE}.txt`), `${vault.token('姓名', '张三')}_${vault.token('电话', PHONE)}.txt`)
}

{
  // Prefixed ids, stays/visits, site code kept.
  const vault = await freshVault('ids')
  const paths = createPathAnonymizer({ vault, policy })
  const p = vault.token('病历号', '900001')
  const z = vault.token('住院号', '7000001')
  const m1 = vault.token('就诊号', '5000001')
  const m2 = vault.token('就诊号', 'R5000002')
  assert.equal(paths.map('patient_900001/stays/zyh_7000001/disease.json'), `patient_${p}/stays/zyh_${z}/disease.json`)
  assert.equal(paths.map('patient_900001/visits/mzh_5000001_check.json'), `patient_${p}/visits/mzh_${m1}_check.json`)
  assert.equal(paths.map('patient_900001/visits/h5650_mzh_R5000002_examine.json'), `patient_${p}/visits/h5650_mzh_${m2}_examine.json`)
  assert.equal(paths.map('pid_123456/a.json'), `pid_${vault.token('病历号', '123456')}/a.json`)
  assert.equal(paths.map('EMPI-123456/a.json'), `EMPI-${vault.token('病历号', '123456')}/a.json`)
  // Directory prefix recorded once, every changed file recorded per path.
  const prefixes = paths.prefixes()
  assert.equal(prefixes.filter((e) => e.original === 'patient_900001').length, 1)
  assert.deepEqual(prefixes.find((e) => e.original === 'patient_900001'), {
    original: 'patient_900001', anonymized: `patient_${p}`, items: [{ type: '病历号', pseudonym: p }],
  })
  assert.equal(paths.entries().length, 5)
  const visit = paths.entries().find((e) => e.original.endsWith('examine.json'))
  assert.deepEqual(visit.items, [{ type: '病历号', pseudonym: p }, { type: '就诊号', pseudonym: m2 }])
  // Idempotent on outputs.
  for (const entry of paths.entries()) assert.equal(paths.map(entry.anonymized), entry.anonymized)
  // No originals leak into entries' items.
  assert.ok(!JSON.stringify(paths.entries().map((e) => e.items)).includes('900001'))
}

{
  // Keep list: category folders, yyyymm, schema files, site codes, short numbers.
  const vault = await freshVault('keep')
  const paths = createPathAnonymizer({ vault, policy })
  const unchanged = [
    '住院/GEHR-住院就诊记录/202001/p_doc_gehr_inhos_vst_rcd.json',
    '门诊/检查/检验/处方/医嘱/20200101.json',
    '高血压/白细胞/文档/方案/常规/康复/明细.csv',
    'h5650/1234/2020-01-01_report.txt',
    '64/README.md',
    'data/visits/mzh/check.json',
    'patient_/x.json',
    `${'1'.repeat(18)}.txt`,
  ]
  for (const path of unchanged) assert.equal(paths.map(path), path, path)
  assert.equal(paths.entries().length, 0)
  assert.equal(paths.prefixes().length, 0)
  assert.equal(vault.size(), 0, 'nothing tokenized')
}

{
  // Standalone surname-led name folder; compound surname.
  const vault = await freshVault('names')
  const paths = createPathAnonymizer({ vault, policy })
  assert.equal(paths.map('张三/记录.txt'), `${vault.token('姓名', '张三')}/记录.txt`)
  assert.equal(paths.map('欧阳小明_病历.md'), `${vault.token('姓名', '欧阳小明')}_病历.md`)
  assert.equal(paths.map('张三病历.md'), '张三病历.md', 'not separator-bounded')
}

{
  // Known content values: consistent type/token, segment-bounded only.
  const vault = await freshVault('known')
  const known = [
    { type: '姓名', text: '佚名乙' },
    { type: '病历号', text: 'MRN-2024-001' },
    { type: '就诊号', text: '1234' }, // too short to trust in a path
    { type: '住院号', text: '7000009' },
  ]
  const paths = createPathAnonymizer({ vault, policy, known })
  assert.equal(paths.map('佚名乙_MRN-2024-001.txt'), `${vault.token('姓名', '佚名乙')}_${vault.token('病历号', 'MRN-2024-001')}.txt`)
  assert.equal(paths.map('x佚名乙.txt'), 'x佚名乙.txt')
  assert.equal(paths.map('1234_a.txt'), '1234_a.txt')
  // Known type wins over the prefix rule for the same value.
  assert.equal(paths.map('mzh_7000009.json'), `mzh_${vault.token('住院号', '7000009')}.json`)
  // Map<text, type> shape.
  const viaMap = createPathAnonymizer({ vault, policy, known: new Map([['佚名乙', '姓名']]) })
  assert.equal(viaMap.map('佚名乙.txt'), `${vault.token('姓名', '佚名乙')}.txt`)
}

{
  // Consistency with content: the same vault yields the token content got first.
  const vault = await freshVault('consistent')
  const fromContent = vault.token('病历号', '900001')
  const paths = createPathAnonymizer({ vault, policy })
  assert.equal(paths.map('patient_900001'), `patient_${fromContent}`)
  assert.ok(isPseudonym(fromContent))
}

{
  // Policy: keep / mask / redact / allowValues.
  const vault = await freshVault('policy')
  const custom = resolvePolicy({
    identifierPolicy: { name: 'keep', idCard: 'mask', mrn: 'redact', phone: 'mask' },
    allowValues: ['7000001'],
  })
  const paths = createPathAnonymizer({ vault, policy: custom })
  const out = paths.map(`64_莫小卿_${ID}.zip`)
  assert.equal(out, `64_莫小卿_110xxxxxxxxxxx${ID.slice(-4)}.zip`)
  assert.ok(!out.includes('*'))
  assert.equal(paths.map(out), out, 'mask idempotent')
  assert.equal(paths.map('patient_900001/a.json'), 'patient_[病历号]/a.json')
  assert.equal(paths.map('patient_[病历号]/a.json'), 'patient_[病历号]/a.json')
  assert.equal(paths.map(`call_${PHONE}.txt`), 'call_138xxxx8000.txt')
  assert.equal(paths.map('zyh_7000001/a.json'), 'zyh_7000001/a.json', 'allowValues')
  assert.equal(vault.size(), 0)
}

{
  // Collision: two originals masked to the same output get ~2.
  const vault = await freshVault('collide')
  const paths = createPathAnonymizer({ vault, policy: resolvePolicy({ identifierPolicy: { mrn: 'mask' } }) })
  const a = paths.map('patient_113453/a.json')
  const b = paths.map('patient_993453/a.json')
  const c = paths.map('patient_883453.json')
  const d = paths.map('patient_773453.json')
  assert.equal(a, 'patient_xx3453/a.json')
  assert.equal(b, 'patient_xx3453~2/a.json')
  assert.equal(c, 'patient_xx3453.json')
  assert.equal(d, 'patient_xx3453~2.json')
  assert.equal(paths.map('patient_113453/b.json'), 'patient_xx3453/b.json', 'stable')
  assert.equal(paths.map('patient_993453/b.json'), 'patient_xx3453~2/b.json', 'stable')
  assert.equal(paths.map(b), b, 'idempotent on suffixed output')
  assert.equal(paths.prefixes().filter((e) => e.anonymized.includes('~2')).length, 2)
}

{
  // Determinism across instances sharing one vault.
  const vault = await freshVault('det')
  const one = createPathAnonymizer({ vault, policy }).map(`patient_900001/64_张三_${ID}.zip`)
  const two = createPathAnonymizer({ vault, policy }).map(`patient_900001/64_张三_${ID}.zip`)
  assert.equal(one, two)
}

await rm(tmp, { recursive: true, force: true })
console.log('PATHS PASS')
