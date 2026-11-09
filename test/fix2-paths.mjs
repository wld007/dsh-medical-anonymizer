/**
 * Regression tests for review findings #27 (known names glued to CJK text or
 * brackets in file names), #28 (segments containing 'rcd'/'gehr' skipped
 * wholesale), #29 (an unchanged path colliding with a renamed one), #47
 * (write guard following symlinks out of the output root) and #51 (legacy
 * custom-named output roots and selected output roots read as input).
 * Synthetic values only.
 * Run: node test/fix2-paths.mjs
 */
import assert from 'node:assert/strict'
import { readFile, rm, mkdir, writeFile, readdir, symlink, realpath } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPathAnonymizer } from '../lib/paths.js'
import { Vault } from '../lib/pseudonym.js'
import { resolvePolicy } from '../lib/policy.js'
import { createWriteGuard } from '../lib/guard.js'
import { isOutputRoot } from '../lib/layout.js'
import { runBatch, listInputFiles } from '../lib/pipeline.js'
import { outDirOf } from './outputs.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'fix2-paths')
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

async function walk(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(path, base))
    else out.push(relative(base, path).split('\\').join('/'))
  }
  return out
}

/** Append the GB 11643 check digit to a 17-digit body. */
function withCheck(body) {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  let sum = 0
  for (let i = 0; i < 17; i += 1) sum += Number(body[i]) * weights[i]
  return body + '10X98765432'[sum % 11]
}
const ID = withCheck('11010119900307123')
const PHONE = '13800138000'

let vaults = 0
async function freshVault() {
  const vault = new Vault(join(tmp, `vault-${vaults++}.json`))
  await vault.load()
  return vault
}
const policy = resolvePolicy({})

/* ------------------------------------------------------------------ #27 */

{
  const vault = await freshVault()
  const known = [{ type: '姓名', text: '张三' }, { type: '姓名', text: '佚名乙' }, { type: '病历号', text: 'MRN2024001' }]
  const paths = createPathAnonymizer({ vault, policy, known })
  const name = vault.token('姓名', '张三')
  const mrn = vault.token('病历号', 'MRN2024001')

  await check('#27 已知姓名与中文粘连时被替换（张三病历 / 患者张三 / 张三的检查）', async () => {
    assert.equal(paths.map('张三病历.txt'), `${name}病历.txt`)
    assert.equal(paths.map('患者张三.txt'), `患者${name}.txt`)
    assert.equal(paths.map('张三的检查/a.txt'), `${name}的检查/a.txt`)
  })
  await check('#27 已知姓名在括号、全角标点、序号旁时被替换', async () => {
    assert.equal(paths.map('张三(1).txt'), `${name}(1).txt`)
    assert.equal(paths.map('【张三】.txt'), `【${name}】.txt`)
    assert.equal(paths.map('（张三）复诊.md'), `（${name}）复诊.md`)
    assert.equal(paths.map('门诊，张三，2024.csv'), `门诊，${name}，2024.csv`)
    assert.equal(paths.map('张三2.txt'), `${name}2.txt`)
    assert.equal(paths.map('2024张三.txt'), `2024${name}.txt`)
  })
  await check('#27 已知编号在括号或中文旁时被替换，但不拆开更长的字母数字串', async () => {
    assert.equal(paths.map('病历MRN2024001.txt'), `病历${mrn}.txt`)
    assert.equal(paths.map('(MRN2024001).json'), `(${mrn}).json`)
    assert.equal(paths.map('XMRN2024001.json'), 'XMRN2024001.json')
    assert.equal(paths.map('MRN20240012.json'), 'MRN20240012.json')
  })
  await check('#27 已知中文姓名与拉丁字母、版本号粘连时也被替换（张三CT报告 / CT张三 / 张三v2）', async () => {
    assert.equal(paths.map('张三CT报告.txt'), `${name}CT报告.txt`)
    assert.equal(paths.map('CT张三.txt'), `CT${name}.txt`)
    assert.equal(paths.map('张三MRI.pdf'), `${name}MRI.pdf`)
    assert.equal(paths.map('MRI张三.dcm'), `MRI${name}.dcm`)
    assert.equal(paths.map('张三v2.docx'), `${name}v2.docx`)
    assert.equal(paths.map('张三ab.txt'), `${name}ab.txt`)
    assert.equal(paths.map('x佚名乙.txt'), `x${vault.token('姓名', '佚名乙')}.txt`)
    assert.equal(paths.map('DR张三CT/a.txt'), `DR${name}CT/a.txt`)
  })
  await check('#27 无已知值时普通临床文件名不被改动', async () => {
    const plain = createPathAnonymizer({ vault, policy })
    for (const path of ['血常规(2024-01-03).csv', '【检验报告】.txt', '阿司匹林100mg（每日一次）.txt', '张三病历.md', '(高血压)随访.txt']) {
      assert.equal(plain.map(path), path, path)
    }
  })
  await check('#27 括号视为分隔符：规则能识别括号里的手机号、身份证号', async () => {
    const plain = createPathAnonymizer({ vault, policy })
    assert.equal(plain.map(`联系人(${PHONE}).txt`), `联系人(${vault.token('电话', PHONE)}).txt`)
    assert.equal(plain.map(`【${ID}】.txt`), `【${vault.token('身份证号', ID)}】.txt`)
    // With an ID or phone in the same name, a bracketed Han word is a name.
    assert.equal(plain.map(`张三(${PHONE}).txt`), `${name}(${vault.token('电话', PHONE)}).txt`)
  })
  await check('#27 无已知值时，括号/标点前后以姓氏开头的普通词不被当作姓名', async () => {
    const plain = createPathAnonymizer({ vault, policy })
    const before = vault.size()
    for (const path of [
      '华法林(2mg).txt', '黄体酮(注射).txt', '白蛋白(ALB).csv', '安定(片).txt', '金银花(颗粒).txt',
      '甘露醇（静滴）.txt', '黄疸(复查).txt', '高热(3天).txt', '关节(左).txt', '曲线(1).png',
      '任务(1).txt', '明天(复诊).txt', '华法林,每日.txt', '【高热】.txt', '(安定)用法.txt',
      '项目/曲线(2)/图.png', '华法林，每日一次；复查.txt', '《黄疸》讲义.pdf',
    ]) {
      assert.equal(plain.map(path), path, path)
    }
    assert.equal(vault.size(), before, 'no vault entries for ordinary words')
  })
}

{
  // End to end: ordinary bracketed names are delivered unchanged; known names
  // glued to modality abbreviations are replaced, in paths and in report.md.
  const input = join(tmp, 'e2e27b-in')
  const root = join(tmp, 'e2e27b-out')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'list.csv'), '姓名,年龄\n张三,45\n')
  await writeFile(join(input, '华法林(2mg).txt'), '每日一次。\n')
  await writeFile(join(input, '曲线(1).txt'), '无。\n')
  await writeFile(join(input, '张三CT报告.txt'), '印象：未见异常。\n')
  await writeFile(join(input, 'MRI张三v2.txt'), '印象：未见异常。\n')
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'e2e27b' } })
  const out = await outDirOf(root, 'e2e27b')
  const files = await walk(out)
  await check('#27 端到端：华法林(2mg) / 曲线(1) 原样交付', async () => {
    assert.ok(files.includes('华法林(2mg).txt'), files.join('\n'))
    assert.ok(files.includes('曲线(1).txt'), files.join('\n'))
  })
  await check('#27 端到端：张三CT报告 / MRI张三v2 的姓名被替换，report.md 不含原始姓名', async () => {
    assert.equal(files.length, 5, files.join('\n'))
    for (const file of files) assert.ok(!file.includes('张三'), file)
    const md = await readFile(join(root, '_records', 'runs', 'e2e27b', 'report.md'), 'utf8')
    const json = await readFile(join(root, '_records', 'runs', 'e2e27b', 'report.json'), 'utf8')
    assert.ok(!md.includes('张三'), 'report.md')
    assert.ok(!json.includes('张三'), 'report.json')
    assert.ok(['completed', 'review'].includes(run.status), run.status)
  })
}

{
  // End to end: the name is only known from another file's labelled column.
  const input = join(tmp, 'e2e27-in')
  const root = join(tmp, 'e2e27-out')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'list.csv'), '姓名,年龄\n张三,45\n')
  await writeFile(join(input, '张三病历.txt'), '主诉：头痛三天。\n')
  await writeFile(join(input, '张三(1).txt'), '复诊：头痛缓解。\n')
  await writeFile(join(input, '【张三】随访.txt'), '随访：无不适。\n')
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'e2e27' } })
  const out = await outDirOf(root, 'e2e27')
  const files = await walk(out)
  await check('#27 端到端：输出文件名不含原始姓名', async () => {
    assert.equal(files.length, 4, files.join('\n'))
    for (const file of files) assert.ok(!file.includes('张三'), file)
  })
  await check('#27 端到端：report.md / report.json 不含原始姓名', async () => {
    const md = await readFile(join(root, '_records', 'runs', 'e2e27', 'report.md'), 'utf8')
    const json = await readFile(join(root, '_records', 'runs', 'e2e27', 'report.json'), 'utf8')
    assert.ok(!md.includes('张三'), 'report.md')
    assert.ok(!json.includes('张三'), 'report.json')
    assert.ok(['completed', 'review'].includes(run.status), run.status)
  })
}

/* ------------------------------------------------------------------ #28 */

{
  const vault = await freshVault()
  const paths = createPathAnonymizer({ vault, policy })
  const id = vault.token('身份证号', ID)
  await check('#28 含 GEHR/rcd 的片段里的身份证号、手机号仍被替换', async () => {
    assert.equal(paths.map(`GEHR_${ID}.txt`), `GEHR_${id}.txt`)
    assert.equal(paths.map(`rcd_${ID}/x.txt`), `rcd_${id}/x.txt`)
    assert.equal(paths.map(`p_doc_gehr_inhos_vst_rcd_${PHONE}.json`), `p_doc_gehr_inhos_vst_rcd_${vault.token('电话', PHONE)}.json`)
    assert.equal(paths.map(`rcd-张三_${ID}.json`), `rcd-${vault.token('姓名', '张三')}_${id}.json`)
  })
  await check('#28 含 gehr/rcd 字样的单词（如 Ricardo 的拼写变体）不会保护整段', async () => {
    assert.equal(paths.map(`Gehrig_${ID}.txt`), `Gehrig_${id}.txt`)
    assert.equal(paths.map(`patient_rcd900001/a.json`), `patient_${vault.token('病历号', 'rcd900001')}/a.json`)
  })
  await check('#28 表名、系统目录保持不变', async () => {
    for (const path of ['住院/GEHR-住院就诊记录/202001/p_doc_gehr_inhos_vst_rcd.json', 'RCD/GEHR/202001.json', 'gehr_rcd.csv']) {
      assert.equal(paths.map(path), path, path)
    }
  })
  await check('#28 已知值在 GEHR 片段中也被替换', async () => {
    const withKnown = createPathAnonymizer({ vault, policy, known: [{ type: '病历号', text: 'A900001' }] })
    assert.equal(withKnown.map('GEHR-A900001-记录.json'), `GEHR-${vault.token('病历号', 'A900001')}-记录.json`)
  })
}

/* ------------------------------------------------------------------ #29 */

{
  const vault = await freshVault()
  const token = vault.token('姓名', '丁一')
  await check('#29 改名后的路径与原样保留的路径不会重名（改名在前）', async () => {
    const paths = createPathAnonymizer({ vault, policy })
    const a = paths.map('丁一/r.txt')
    const b = paths.map(`${token}/r.txt`)
    assert.equal(a, `${token}/r.txt`)
    assert.notEqual(a, b)
  })
  await check('#29 改名后的路径与原样保留的路径不会重名（原样在前）', async () => {
    const paths = createPathAnonymizer({ vault, policy })
    const b = paths.map(`${token}/r.txt`)
    const a = paths.map('丁一/r.txt')
    assert.notEqual(a, b)
  })
  await check('#29 文件级重名同样消解，结果对相同输入确定', async () => {
    const list = ['a/张三.txt', `a/${vault.token('姓名', '张三')}.txt`, 'a/丁一/x.txt', `a/${token}/x.txt`].sort()
    const once = () => {
      const paths = createPathAnonymizer({ vault, policy })
      return list.map((path) => paths.map(path))
    }
    const first = once()
    assert.equal(new Set(first).size, list.length, first.join('\n'))
    assert.deepEqual(once(), first)
  })
  await check('#29 仅大小写不同的输出也视为重名（大小写不敏感的文件系统）', async () => {
    const paths = createPathAnonymizer({ vault, policy: resolvePolicy({ identifierPolicy: { mrn: 'mask' } }) })
    const a = paths.map('patient_113453/a.json')
    const b = paths.map('Patient_xx3453/a.json')
    assert.notEqual(a.toLowerCase(), b.toLowerCase(), `${a} ${b}`)
  })

  // End to end: an earlier anonymized copy next to the raw folder.
  const input = join(tmp, 'e2e29-in')
  const root = join(tmp, 'e2e29-out')
  await mkdir(join(root, '_records'), { recursive: true })
  const shared = new Vault(join(root, '_records', 'vault.json'))
  await shared.load()
  const shared丁一 = shared.token('姓名', '丁一')
  await shared.save()
  await mkdir(join(input, '丁一'), { recursive: true })
  await mkdir(join(input, shared丁一), { recursive: true })
  await writeFile(join(input, '丁一', 'r.txt'), 'NEW-RAW\n')
  await writeFile(join(input, shared丁一, 'r.txt'), 'OLD-ANON\n')
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'e2e29' } })
  const out = await outDirOf(root, 'e2e29')
  await check('#29 端到端：两个文件都被交付，内容不互相覆盖', async () => {
    const files = await walk(out)
    assert.equal(files.length, 2, files.join('\n'))
    const contents = (await Promise.all(files.map((file) => readFile(join(out, file), 'utf8')))).sort()
    assert.deepEqual(contents, ['NEW-RAW\n', 'OLD-ANON\n'])
    const rels = run.files.map((file) => file.relPath)
    assert.equal(new Set(rels).size, 2, rels.join(' '))
  })
}

/* ------------------------------------------------------------------ #47 */

{
  const base = await realpath(tmp)
  const D = join(base, 'guard-in')
  const out = join(D, '_medical-anonymizer')
  const elsewhere = join(base, 'guard-elsewhere')
  await mkdir(join(out, '_records'), { recursive: true })
  await mkdir(join(D, 'sub'), { recursive: true })
  await mkdir(elsewhere, { recursive: true })
  await writeFile(join(D, 'patient.txt'), '原文\n')
  await writeFile(join(D, 'sub', 'b.txt'), '原文\n')
  await writeFile(join(elsewhere, 'x.txt'), 'x\n')
  await symlink('../patient.txt', join(out, 'index.json'))
  await symlink(join(elsewhere, 'x.txt'), join(out, 'outside.txt'))
  await symlink(join(elsewhere, 'missing.txt'), join(out, 'dangling.txt'))
  await symlink(join(D, 'sub'), join(out, 'linkdir'))
  await symlink(elsewhere, join(out, 'linkout'))
  const guard = await createWriteGuard({ inputRoots: [D], outputRoot: out })
  const rejects = async (target) => {
    await assert.rejects(guard.check(target), (error) => error.code === 'input-protection', target)
  }
  await check('#47 输出目录里指向输入文件的软链接被拒绝', async () => {
    await rejects(join(out, 'index.json'))
  })
  await check('#47 输出目录里指向输入子目录的软链接目录被拒绝', async () => {
    await rejects(join(out, 'linkdir', 'b.txt'))
    await rejects(join(out, 'linkdir', 'new.txt'))
  })
  await check('#47 指向输出根之外的软链接（含悬空链接）被拒绝', async () => {
    await rejects(join(out, 'outside.txt'))
    await rejects(join(out, 'dangling.txt'))
    await rejects(join(out, 'linkout', 'y.txt'))
  })
  await check('#47 正常的输出路径仍然允许写入', async () => {
    assert.equal(await guard.check(join(out, '_records', 'vault.json')), join(out, '_records', 'vault.json'))
    assert.equal(await guard.check(join(out, 'new', 'deep', 'a.txt')), join(out, 'new', 'deep', 'a.txt'))
  })
  await check('#47 通过软链接路径指定的输出根仍可写入', async () => {
    const alias = join(base, 'guard-alias')
    await symlink(out, alias)
    const viaAlias = await createWriteGuard({ inputRoots: [D], outputRoot: alias })
    assert.equal(await viaAlias.check(join(alias, 'a.txt')), join(out, 'a.txt'))
    await assert.rejects(viaAlias.check(join(alias, 'index.json')), (error) => error.code === 'input-protection')
  })
}

/* ------------------------------------------------------------------ #51 */

{
  const p = join(tmp, 'roots')
  await mkdir(join(p, 'a'), { recursive: true })
  await writeFile(join(p, 'a', 'note.txt'), '病历\n')
  await mkdir(join(p, '_medical-anonymizer', '_records'), { recursive: true })
  await writeFile(join(p, '_medical-anonymizer', '_records', 'vault.json'), JSON.stringify({ version: 1, salt: 'ab', entries: [] }, null, 2))
  // A pre-0.8 root with a custom name: vault, index and runs at its top level.
  await mkdir(join(p, 'anon-2024', 'runs', 'r1'), { recursive: true })
  await writeFile(join(p, 'anon-2024', 'vault.json'), JSON.stringify({ version: 1, salt: 'ab', updatedAt: '', nextSeq: 1, entries: [] }, null, 2))
  await writeFile(join(p, 'anon-2024', 'index.json'), JSON.stringify([{ id: 'r1', startedAt: '' }], null, 2))
  await writeFile(join(p, 'anon-2024', 'runs', 'r1', 'path-map.json'), '{"files":[]}')
  // Encrypted legacy vault alone.
  await mkdir(join(p, 'old-enc'), { recursive: true })
  await writeFile(join(p, 'old-enc', 'vault.json'), JSON.stringify({ version: 1, enc: 'aes-256-gcm', salt: 'x', iv: 'y', tag: 'z', data: 'w' }))
  // Legacy index + runs without a vault.
  await mkdir(join(p, 'old-idx', 'runs'), { recursive: true })
  await writeFile(join(p, 'old-idx', 'index.json'), '[]')
  // A patient export that happens to hold index.json / vault.json files.
  await mkdir(join(p, 'fhir'), { recursive: true })
  await writeFile(join(p, 'fhir', 'index.json'), JSON.stringify({ resourceType: 'Bundle', entry: [] }))
  await writeFile(join(p, 'fhir', 'vault.json'), JSON.stringify({ patient: '张三' }))

  await check('#51 旧版自定义名称的输出根（顶层 vault.json/index.json/runs）被识别', async () => {
    assert.equal(await isOutputRoot(join(p, 'anon-2024'), 'anon-2024'), true)
    assert.equal(await isOutputRoot(join(p, 'old-enc'), 'old-enc'), true)
    assert.equal(await isOutputRoot(join(p, 'old-idx'), 'old-idx'), true)
  })
  await check('#51 普通病历目录里的 index.json / vault.json 不会被误判为输出根', async () => {
    assert.equal(await isOutputRoot(join(p, 'fhir'), 'fhir'), false)
    assert.equal(await isOutputRoot(join(p, 'a'), 'a'), false)
  })
  await check('#51 扫描上级目录时跳过旧版输出根', async () => {
    const listing = await listInputFiles(p)
    const rels = listing.files.map((file) => relative(p, file).split('\\').join('/')).sort()
    assert.deepEqual(rels, ['a/note.txt', 'fhir/index.json', 'fhir/vault.json'])
  })
  await check('#51 多选时选中输出根目录被拒绝', async () => {
    await assert.rejects(listInputFiles(p, { select: ['a', '_medical-anonymizer'] }), /输出/)
    await assert.rejects(listInputFiles(p, { select: ['a', 'anon-2024'] }), /输出/)
    const ok = await listInputFiles(p, { select: ['a', 'fhir'] })
    assert.equal(ok.files.length, 3)
  })
  await check('#51 输入目录本身是输出根时被拒绝', async () => {
    await assert.rejects(listInputFiles(join(p, 'anon-2024')), /输出/)
    await assert.rejects(listInputFiles(join(p, '_medical-anonymizer')), /输出/)
  })
  await check('#51 批次以输出根为输入时失败，不交付映射库', async () => {
    const root = join(tmp, 'roots-out')
    await assert.rejects(runBatch({ inputDir: join(p, 'anon-2024'), outputRoot: root, options: { runId: 'r51' } }), /输出/)
    const delivered = await walk(root)
    assert.ok(!delivered.some((file) => /(^|\/)anon-2024\//.test(file) && !file.startsWith('_records/')), delivered.join('\n'))
  })
}

await rm(tmp, { recursive: true, force: true })
if (failures > 0) {
  console.log(`\nFIX2-PATHS FAIL (${failures})`)
  process.exit(1)
}
console.log('\nFIX2-PATHS PASS')
