/**
 * Text/CSV loader fixes:
 *  #4  long lines are cut without splitting an identifier,
 *  #5  CSV row 0 (header or first record) is scanned,
 *  #8  GB18030 / UTF-16 input is decoded, not destroyed; undecodable input fails loudly.
 * Run: node test/fix-text-csv.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDocument } from '../lib/formats.js'
import { layered } from '../lib/layers.js'
import { runBatch } from '../lib/pipeline.js'
import * as XLSX from '../vendor/xlsx.mjs'
import { outDirOf, outJoin } from './outputs.mjs'

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

const tmp = await mkdtemp(join(tmpdir(), 'dsh-anon-fix-text-csv-'))
let runs = 0

/** Rules-only batch over `files` ({name: Buffer|string}); returns run, output reader. */
async function batch(files) {
  runs += 1
  const input = join(tmp, `in${runs}`)
  const root = join(tmp, `out${runs}`)
  await mkdir(input, { recursive: true })
  for (const [name, data] of Object.entries(files)) await writeFile(join(input, name), data)
  const runId = `r${runs}`
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId } })
  const base = await outDirOf(root, runId)
  const fileOf = (name) => run.files.find((file) => file.relPath === name || file.relPath.endsWith(`/${name}`))
  const output = async (name) => readFile(outJoin(base, name))
  const report = await readFile(join(root, '_records', 'runs', runId, 'report.md'), 'utf8')
  return { run, fileOf, output, report, root }
}

async function docOf(name, data) {
  const dir = await mkdtemp(join(tmp, 'doc-'))
  const path = join(dir, name)
  await writeFile(path, data)
  return loadDocument(path, name)
}

/* GBK encoder for fixtures (Node can decode GBK but not encode it). */
let gbkTable = null
function gbk(text) {
  if (!gbkTable) {
    gbkTable = new Map()
    const decoder = new TextDecoder('gbk')
    for (let hi = 0x81; hi <= 0xfe; hi += 1) {
      for (let lo = 0x40; lo <= 0xfe; lo += 1) {
        if (lo === 0x7f) continue
        const ch = decoder.decode(Uint8Array.of(hi, lo))
        if (ch.length === 1 && ch !== '\uFFFD' && !gbkTable.has(ch)) gbkTable.set(ch, [hi, lo])
      }
    }
  }
  const out = []
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (code < 0x80) out.push(code)
    else out.push(...gbkTable.get(ch))
  }
  return Buffer.from(out)
}
const utf16le = (text) => Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')])
const utf16be = (text) => {
  const le = Buffer.from(text, 'utf16le')
  for (let i = 0; i < le.length; i += 2) [le[i], le[i + 1]] = [le[i + 1], le[i]]
  return Buffer.concat([Buffer.from([0xFE, 0xFF]), le])
}

const ID = '110101199003071233'
const PHONE = '13800138000'
const EMAIL = 'zhang.san@example.com'

/* ------------------------------------------------------------------ #4 */

await check('#4 长行切块：身份证横跨原 1400 字切点仍被替换（审查原例）', async () => {
  const body = `患者${'某'.repeat(1390)}身份证${ID}结束\n`
  const { fileOf, output } = await batch({ 'd.txt': body })
  const out = (await output('d.txt')).toString('utf8')
  assert.ok(!out.includes(ID), out.slice(-60))
  assert.equal(fileOf('d.txt').status, 'clean')
  assert.equal(out.split('\n').length, body.split('\n').length)
})

await check('#4 每个标识符在任意偏移处都完整落在一个切块里，切块拼接与原文逐字相同', async () => {
  const cases = [
    { value: ID, make: (pad) => `患者${'某'.repeat(pad)}身份证${ID}结束` },
    { value: PHONE, make: (pad) => `${'记'.repeat(pad)}电话${PHONE}复诊` },
    { value: EMAIL, make: (pad) => `${'记'.repeat(pad)}邮箱${EMAIL}备注` },
    { value: '张三', make: (pad) => `${'诊'.repeat(pad)}，姓名：张三，男` },
    // Prose with punctuation: the cut goes to a sentence/clause end.
    { value: PHONE, make: (pad) => `${'主诉头痛三天，伴恶心。'.repeat(Math.ceil(pad / 11)).slice(0, pad)}联系电话${PHONE}，家属陪同。` },
    // Long ASCII line with spaces.
    { value: EMAIL, make: (pad) => `${'note '.repeat(Math.ceil(pad / 5)).slice(0, pad)}mail ${EMAIL} end` },
  ]
  for (const { value, make } of cases) {
    for (let pad = 1360; pad <= 1394; pad += 1) {
      const line = make(pad)
      const text = `${line}\n第二行\n${line}，${line}\n`
      const doc = await docOf('x.txt', text)
      const segments = doc.segments()
      assert.equal(segments.map((segment) => segment.text).join(''), text, 'offsets must stay exact')
      for (const segment of segments) assert.ok(segment.text.length <= 1400, `chunk too long: ${segment.text.length}`)
      const total = text.split(value).length - 1
      let found = 0
      for (const segment of segments) found += segment.text.split(value).length - 1
      assert.equal(found, total, `${value} cut at pad ${pad}`)
      assert.deepEqual(doc.notices ?? [], [], 'no forced cut expected')
    }
  }
})

await check('#4 长行中的电话、邮箱、身份证跨切点时端到端被替换，偏移与行数不变', async () => {
  const one = `${'甲'.repeat(1392)}电话${PHONE}然后${'乙'.repeat(1380)}邮箱${EMAIL}再${'丙'.repeat(1390)}身份证${ID}止\n`
  const two = `第一行\n${'记录'.repeat(698)}，联系人${PHONE}\n末行\n`
  const { fileOf, output } = await batch({ 'one.txt': one, 'two.md': two })
  const outOne = (await output('one.txt')).toString('utf8')
  const outTwo = (await output('two.md')).toString('utf8')
  for (const value of [PHONE, EMAIL, ID]) assert.ok(!outOne.includes(value), value)
  assert.ok(!outTwo.includes(PHONE))
  assert.ok(outOne.startsWith('甲'.repeat(1392)) && outOne.endsWith('止\n'))
  assert.equal(outTwo.split('\n').length, two.split('\n').length)
  assert.equal(fileOf('one.txt').status, 'clean')
  assert.equal(fileOf('two.md').status, 'clean')
})

await check('#4 替换后各切块拼回原位（apply 偏移精确）', async () => {
  const text = `${'某'.repeat(1395)}电话${PHONE}结束`
  const doc = layered(await docOf('y.txt', text))
  const segment = doc.segments().find((item) => item.text.includes(PHONE))
  const start = segment.text.indexOf(PHONE)
  assert.equal(doc.apply([{ id: segment.id, start, end: start + PHONE.length, original: PHONE, replacement: '电话-XXXXXX' }]), 1)
  assert.equal(doc.serialize(), text.replace(PHONE, '电话-XXXXXX'))
  assert.ok(doc.structure().ok)
})

await check('#4 找不到安全切点（超长无标点汉字串）时强制切分并送人工复核，不报干净', async () => {
  const text = `${'某'.repeat(3000)}\n`
  const doc = await docOf('z.txt', text)
  assert.equal(doc.segments().map((segment) => segment.text).join(''), text)
  assert.ok(doc.notices.some((notice) => notice.code === 'chunk-split' && notice.severity === 'error'))
  const { fileOf } = await batch({ 'z.txt': text })
  const file = fileOf('z.txt')
  assert.equal(file.status, 'review')
  assert.ok(file.issues.some((issue) => issue.code === 'chunk-split'))
})

/* ------------------------------------------------------------------ #5 */

await check('#5 无表头 CSV：第一行的身份证、电话被替换（审查原例）', async () => {
  const csv = `张三,${ID},${PHONE}\r\n李四,${ID},13900139000\r\n`
  const { fileOf, output } = await batch({ 'n.csv': csv })
  const out = (await output('n.csv')).toString('utf8')
  assert.ok(!out.includes(ID), out)
  assert.ok(!out.includes(PHONE), out)
  assert.ok(!out.includes('13900139000'), out)
  assert.equal(out.trim().split(/\r?\n/).length, 2)
  assert.equal(fileOf('n.csv').status, 'clean', JSON.stringify(fileOf('n.csv').issues))
})

await check('#5 无表头 CSV：第一行的电话、邮箱被替换（#10 原例）', async () => {
  const { output, fileOf, report } = await batch({ 'p.csv': '13800138000,a@b.com\n13900139000,c@d.com\n' })
  const out = (await output('p.csv')).toString('utf8')
  for (const value of ['13800138000', 'a@b.com', '13900139000', 'c@d.com']) assert.ok(!out.includes(value), out)
  assert.equal(fileOf('p.csv').status, 'clean')
  assert.ok(!report.includes('a@b.com') && !report.includes('13800138000'))
})

await check('#5 真表头含标识符时被替换，按表头的列策略仍生效，结构校验通过', async () => {
  const csv = `姓名,电话,备注 联系 ${EMAIL}\n王五,${PHONE},无\n赵六,13900139000,无\n`
  const doc = await docOf('h.csv', csv)
  const header = doc.segments().filter((segment) => segment.id.startsWith('r0c'))
  assert.deepEqual(header.map((segment) => segment.field), ['第1列表头', '第2列表头', '第3列表头'])
  assert.ok(header.every((segment) => segment.hint === null))
  const body = doc.segments().filter((segment) => !segment.id.startsWith('r0c'))
  assert.equal(body.find((segment) => segment.text === '王五').hint, '姓名')
  assert.equal(body.find((segment) => segment.text === '王五').field, '姓名')
  const cell = header[2]
  const start = cell.text.indexOf(EMAIL)
  assert.equal(doc.apply([{ id: cell.id, start, end: start + EMAIL.length, original: EMAIL, replacement: '邮箱-AAAAAA' }]), 1)
  assert.ok(doc.structure().ok, JSON.stringify(doc.structure()))

  const { fileOf, output } = await batch({ 'h.csv': csv })
  const out = (await output('h.csv')).toString('utf8')
  assert.ok(!out.includes(EMAIL), out)
  assert.ok(!out.includes('王五') && !out.includes('赵六'), out)
  assert.ok(out.startsWith('姓名,电话,备注 联系 '), out)
  assert.equal(fileOf('h.csv').status, 'clean', JSON.stringify(fileOf('h.csv').issues))
})

await check('#5 表头单元格：只允许记录过的替换，其它表头格保持原值', async () => {
  const doc = await docOf('s.csv', `姓名,${PHONE}\n王五,13900139000\n`)
  const cell = doc.segments().find((segment) => segment.id === 'r0c1')
  assert.equal(cell.text, PHONE)
  assert.equal(cell.hint, null)
  assert.equal(doc.apply([{ id: 'r0c1', start: 0, end: PHONE.length, original: PHONE, replacement: '电话-AAAAAA' }]), 1)
  const structure = doc.structure()
  assert.ok(structure.ok, JSON.stringify(structure))
  assert.ok(structure.checks.find((item) => item.name === '表头').detail.includes('1'))
  assert.equal(doc.serialize(), '姓名,电话-AAAAAA\n王五,13900139000\n')
})

/* ------------------------------------------------------------------ #8 */

await check('#8 GBK CSV：正确解码、替换，输出为带 BOM 的 UTF-8，并记录编码转换', async () => {
  const source = `姓名,电话,备注\n张三,${PHONE},身份证${ID}\n`
  const bytes = gbk(source)
  const doc = await docOf('g.csv', bytes)
  assert.deepEqual(doc.segments().map((segment) => segment.text), ['姓名', '电话', '备注', '张三', PHONE, `身份证${ID}`])
  assert.equal(doc.bytes, bytes.length)
  const { fileOf, output, report } = await batch({ 'g.csv': bytes })
  const out = await output('g.csv')
  assert.deepEqual([...out.subarray(0, 3)], [0xEF, 0xBB, 0xBF])
  const text = new TextDecoder('utf-8', { fatal: true }).decode(out)
  assert.ok(text.includes('姓名,电话,备注\n'), text)
  for (const value of ['张三', PHONE, ID]) assert.ok(!text.includes(value), text)
  // Originals must not survive in any encoding.
  assert.equal(out.indexOf(gbk('张三')), -1)
  assert.ok(!out.includes(Buffer.from(PHONE)))
  const file = fileOf('g.csv')
  assert.equal(file.status, 'clean', JSON.stringify(file.issues))
  const notice = file.issues.find((issue) => issue.code === 'encoding')
  assert.ok(notice && /GB18030/.test(notice.detail) && /UTF-8/.test(notice.detail), JSON.stringify(file.issues))
  assert.ok(!report.includes('张三') && !report.includes(PHONE))
})

await check('#8 GBK 文本：正确解码与替换，输出 UTF-8（无乱码、无 U+FFFD）', async () => {
  const source = `姓名：张三，电话${PHONE}。\n诊断：高血压。\n`
  const { fileOf, output } = await batch({ 'g.txt': gbk(source) })
  const out = await output('g.txt')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(out)
  assert.ok(!text.includes('\uFFFD'))
  assert.ok(text.includes('诊断：高血压。\n'), text)
  assert.ok(!text.includes('张三') && !text.includes(PHONE), text)
  assert.equal(out.indexOf(gbk('张三')), -1)
  assert.equal(fileOf('g.txt').status, 'clean', JSON.stringify(fileOf('g.txt').issues))
  assert.ok(fileOf('g.txt').issues.some((issue) => issue.code === 'encoding'))
})

await check('#8 UTF-16LE / UTF-16BE（带 BOM）CSV 与文本被解码处理', async () => {
  const csv = `姓名,电话\n张三,${PHONE}\n`
  const txt = `联系电话${PHONE}，邮箱${EMAIL}\n`
  const { fileOf, output } = await batch({ 'le.csv': utf16le(csv), 'be.txt': utf16be(txt) })
  const rawCsv = await output('le.csv')
  assert.deepEqual([...rawCsv.subarray(0, 3)], [0xEF, 0xBB, 0xBF])
  const outCsv = new TextDecoder('utf-8', { fatal: true }).decode(rawCsv)
  const outTxt = new TextDecoder('utf-8', { fatal: true }).decode(await output('be.txt'))
  assert.ok(outCsv.startsWith('姓名,电话\n'), JSON.stringify(outCsv))
  assert.ok(!outCsv.includes('张三') && !outCsv.includes(PHONE), outCsv)
  assert.ok(!outTxt.includes(PHONE) && !outTxt.includes(EMAIL), outTxt)
  assert.ok(fileOf('le.csv').issues.some((issue) => issue.code === 'encoding' && /UTF-16LE/.test(issue.detail)))
  assert.ok(fileOf('be.txt').issues.some((issue) => issue.code === 'encoding' && /UTF-16BE/.test(issue.detail)))
})

await check('#8 UTF-8 输入保持原样：BOM 保留，无编码提示', async () => {
  const csv = `\uFEFF姓名,电话\n张三,${PHONE}\n`
  const plain = `备注,电话\n无,${PHONE}\n`
  const { fileOf, output } = await batch({ 'u.csv': csv, 'v.csv': plain })
  const out = await output('u.csv')
  assert.deepEqual([...out.subarray(0, 3)], [0xEF, 0xBB, 0xBF])
  const outPlain = await output('v.csv')
  assert.notEqual(outPlain[0], 0xEF)
  assert.ok(outPlain.toString('utf8').startsWith('备注,电话\n'))
  assert.ok(!fileOf('u.csv').issues.some((issue) => issue.code === 'encoding'))
  assert.ok(!fileOf('v.csv').issues.some((issue) => issue.code === 'encoding'))
})

await check('#8 无法解码的文件明确失败、不写出乱码', async () => {
  const garbage = Buffer.from([0x41, 0xFF, 0x42, 0x0A])
  const damagedUtf8 = Buffer.concat([Buffer.from(`姓名,电话\n张三,${PHONE}\n`), Buffer.from([0xC3, 0x28]), Buffer.from('李四\n')])
  const noBom16 = Buffer.from(`name,phone\nzhang,${PHONE}\n`, 'utf16le')
  const { fileOf, root } = await batch({ 'bad.txt': garbage, 'dmg.csv': damagedUtf8, 'w16.csv': noBom16, 'ok.txt': '一切正常\n' })
  for (const name of ['bad.txt', 'dmg.csv', 'w16.csv']) {
    const file = fileOf(name)
    assert.equal(file.status, 'failed', `${name}: ${file.status}`)
    assert.ok(file.issues.some((issue) => issue.code === 'load' && /编码/.test(issue.detail)), JSON.stringify(file.issues))
    assert.ok(!JSON.stringify(file.issues).includes(PHONE))
  }
  // None of them is delivered.
  const listing = JSON.stringify(await (async function walk(dir) {
    const out = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) out.push(...await walk(join(dir, entry.name)))
      else out.push(entry.name)
    }
    return out
  })(root))
  for (const name of ['bad.txt', 'dmg.csv', 'w16.csv']) assert.ok(!listing.includes(`"${name}"`), listing)
})

/* ------------------------------------------- follow-up: break-it findings */

/** How many times `needle` occurs inside single segments of `text` split by the loader. */
async function wholeIn(name, text, needle) {
  const doc = await docOf(name, text)
  const segments = doc.segments()
  assert.equal(segments.map((segment) => segment.text).join(''), text, 'offsets must stay exact')
  for (const segment of segments) assert.ok(segment.text.length <= 1400, `chunk too long: ${segment.text.length}`)
  let found = 0
  for (const segment of segments) found += segment.text.split(needle).length - 1
  return { found, total: text.split(needle).length - 1, doc }
}

const LABELLED = [
  { label: '姓名', sep: '：', value: '张三' },
  { label: '住院号', sep: ': ', value: '3000926523' },
  { label: '住址', sep: '：', value: '北京市朝阳区建国路88号院' },
  { label: '病历号', sep: ' : ', value: 'MR20231234' },
  { label: '门诊号', sep: '：  ', value: '0012345678' },
  { label: '社保号', sep: ':', value: 'SB12345678' },
  { label: '联系人', sep: '：', value: '李四' },
]

await check('#4 切点不落在“标签 + 冒号 + 值”之间（任意偏移，切块内完整）', async () => {
  for (const { label, sep, value } of LABELLED) {
    const whole = `${label}${sep}${value}`
    for (let pad = 1370; pad <= 1400; pad += 1) {
      const text = `${'某'.repeat(pad)}${whole}，${'某'.repeat(100)}\n`
      const { found, total } = await wholeIn('l.txt', text, whole)
      assert.equal(found, total, `${whole} cut at pad ${pad}`)
    }
  }
})

await check('#4 标签值跨原切点时端到端被替换（审查原例：姓名、住院号、住址）', async () => {
  const files = {
    'a.txt': `${'某'.repeat(1396)}姓名：张三，${'某'.repeat(100)}\n`,
    'b.txt': `${'某'.repeat(1395)}住院号: 3000926523，${'某'.repeat(100)}\n`,
    'c.txt': `${'某'.repeat(1396)}住址：北京市朝阳区建国路88号院，${'某'.repeat(100)}\n`,
    'd.txt': `${'某'.repeat(1393)}病历号 : MR20231234，${'某'.repeat(100)}\n`,
  }
  const { fileOf, output } = await batch(files)
  for (const [name, value] of [['a.txt', '张三'], ['b.txt', '3000926523'], ['c.txt', '建国路88号院'], ['d.txt', 'MR20231234']]) {
    const out = (await output(name)).toString('utf8')
    assert.ok(!out.includes(value), `${name}: ${out.replace(/某+/g, '…')}`)
    assert.ok(['clean', 'review'].includes(fileOf(name).status), fileOf(name).status)
    assert.equal(out.split('\n').length, files[name].split('\n').length)
  }
})

await check('#4 字段式长行（“名称: 值  名称: 值”）：任意偏移下姓名、住院号都不漏', async () => {
  const labs = ['白细胞: 6.5', '红细胞: 4.2', '血红蛋白: 128', '血小板: 210', '谷丙转氨酶: 23', '肌酐: 76']
  const line = (target) => { let s = ''; let i = 0; while (s.length < target) s += `${labs[i++ % labs.length]}  `; return s }
  const given = '明华强伟芳敏静丽军洋勇艳杰娟涛超秀霞平刚桂英玉兰萍'
  const files = {}
  const values = {}
  for (let k = 0; k < 140; k += 1) {
    const name = `欧阳${given[k % given.length]}${given[(k * 7 + 3) % given.length]}`
    const id = String(3000000000 + k * 7919)
    const text = `${line(1250)}备注: ${'阴'.repeat(k)}  姓名: ${name}  住院号: ${id}  ${line(300)}\n`
    for (const whole of [`姓名: ${name}`, `住院号: ${id}`]) {
      const { found, total, doc } = await wholeIn('f.txt', text, whole)
      assert.equal(found, total, `${whole} cut at k=${k}`)
      assert.deepEqual(doc.notices, [], 'field-style line has safe cuts')
    }
    if (k % 4 === 0) { files[`r${k}.txt`] = text; values[`r${k}.txt`] = [name, id] }
  }
  const { fileOf, output } = await batch(files)
  for (const [file, list] of Object.entries(values)) {
    const out = (await output(file)).toString('utf8')
    for (const value of list) assert.ok(!out.includes(value), `${file} leaks ${value}`)
    assert.equal(fileOf(file).status, 'clean', JSON.stringify(fileOf(file).issues))
  }
})

/** Luhn-complete a 15-digit prefix and group it in fours. */
function spacedCard(prefix, sep = ' ') {
  for (let d = 0; d < 10; d += 1) {
    const s = `${prefix}${d}`
    let sum = 0
    let dbl = false
    for (let i = s.length - 1; i >= 0; i -= 1) {
      let x = Number(s[i])
      if (dbl) { x *= 2; if (x > 9) x -= 9 }
      sum += x
      dbl = !dbl
    }
    if (sum % 10 === 0) return s.replace(/(\d{4})(?=\d)/g, `$1${sep}`)
  }
  throw new Error('no luhn digit')
}

await check('#4 空格分组的数字（银行卡）不在组间空格处被切开（字符类切点）', async () => {
  for (const card of [spacedCard('622202001234567'), spacedCard('622848001234567'), '6222 0200 1234 5671 234']) {
    for (let pad = 1370; pad <= 1400; pad += 1) {
      for (const text of [`${'某'.repeat(pad)}银行卡${card}，结束\n`, `${'某'.repeat(pad)}卡号 ${card} 结束\n`]) {
        const { found, total } = await wholeIn('k.txt', text, card)
        assert.equal(found, total, `${card} cut at pad ${pad}`)
      }
    }
  }
})

await check('#4 空格分组银行卡跨原切点时端到端被替换（审查原例）', async () => {
  const card = spacedCard('622202001234567')
  const files = {}
  for (let n = 1379; n <= 1393; n += 2) files[`k${n}.txt`] = `${'某'.repeat(n)}银行卡${card}，结束\n`
  files['ctl.txt'] = `某某银行卡${spacedCard('622202009999888')}，结束\n`
  const { fileOf, output } = await batch(files)
  for (const name of Object.keys(files)) {
    const out = (await output(name)).toString('utf8')
    assert.ok(!/\d{4} \d{4} \d{4} \d{4}/.test(out), `${name}: ${out.replace(/某+/g, '…')}`)
    assert.equal(fileOf(name).status, 'clean', JSON.stringify(fileOf(name).issues))
  }
})

/** GBK names whose bytes are also valid UTF-8 (2-byte sequences only). */
function utf8LookingNames() {
  const surnames = '郑谢肖袁叶魏姚卢'
  const given = '伟英强霞平萍'
  const strict = new TextDecoder('utf-8', { fatal: true })
  const out = []
  for (const a of surnames) {
    for (const b of given) {
      try { strict.decode(gbk(`${a}${b}`)); out.push(`${a}${b}`) } catch { /* not ambiguous */ }
    }
  }
  return out
}

await check('#8 GBK 字节恰好是合法 UTF-8（ASCII 为主 + 两字节乱码）时不当作干净 UTF-8 交付', async () => {
  const names = utf8LookingNames()
  assert.ok(names.includes('肖强') && names.includes('郑伟') && names.length >= 10, names.join(','))
  const files = { 'a.txt': '姓名：肖强，男\n', 'b.txt': gbk('Patient 肖强 follow-up 2023\r\n') }
  names.slice(0, 8).forEach((name, index) => {
    files[`n${index}.txt`] = gbk(`ID ${index} name ${name} visit 2023-01-0${index + 1}\n`)
    files[`n${index}.csv`] = gbk(`name,phone,note\r\n${name},${PHONE},ok\r\n`)
  })
  const { fileOf, output, report } = await batch(files)
  assert.ok(!(await output('a.txt')).toString('utf8').includes('肖强'))
  for (const name of Object.keys(files).filter((item) => item !== 'a.txt')) {
    const file = fileOf(name)
    assert.notEqual(file.status, 'clean', `${name}: ${JSON.stringify(file.issues)}`)
    const notice = file.issues.find((issue) => issue.code === 'encoding')
    assert.ok(notice && notice.severity === 'error', `${name}: ${JSON.stringify(file.issues)}`)
    // Neither the name nor its mojibake reaches the issue text.
    const decodedAsUtf8 = new TextDecoder('utf-8').decode(gbk('肖强'))
    assert.ok(!JSON.stringify(file.issues).includes('肖强') && !JSON.stringify(file.issues).includes(decodedAsUtf8))
  }
  assert.ok(!report.includes('肖强'))
})

await check('#8 真正的 UTF-8：含中文、纯 ASCII、仅含常见符号（°、×、µ）时不误报编码问题', async () => {
  const files = {
    'zh.txt': `体温 37.5°C，白细胞 6.5×10^9/L\n`,
    'ascii.csv': 'name,value\r\nwbc,6.5\r\n',
    'sym.txt': 'Temp 37.5°C, WBC 6.5 ×10^9/L, 5 µg ± 0.2\n',
    'latin.csv': 'name,city\r\nAnna,Zürich\r\n',
  }
  const { fileOf } = await batch(files)
  for (const name of ['zh.txt', 'ascii.csv', 'sym.txt']) {
    const file = fileOf(name)
    assert.equal(file.status, 'clean', `${name}: ${JSON.stringify(file.issues)}`)
    assert.ok(!file.issues.some((issue) => issue.code === 'encoding'), name)
  }
  // Ambiguous (Latin-1 letters only, decodes as GB18030 too): review, never silent.
  assert.notEqual(fileOf('latin.csv').status, 'failed')
})

await check('#5 表头里的“申请医院”等列名不被当作医院名替换；数据行与无表头首行仍替换', async () => {
  const headerWords = ['申请医院', '检查医院', '报告医院', '送检医院', '来源医院', '合作医院', '签约诊所', '出生医院', '入院医院', '检验医院', '执行医院', '诊断医院', '就医医院']
  const header = `姓名,${headerWords.join(',')},结果`
  const row = (name, hospital) => `${name},${headerWords.map(() => hospital).join(',')},阴性`
  const csv = `${header}\r\n${row('张三', '北京协和医院')}\r\n${row('李四', '上海瑞金医院')}\r\n`
  const noHeader = '张三,北京协和医院,阴性\r\n李四,上海瑞金医院,阳性\r\n'
  const onlyHospitals = '申请医院,检查医院\r\n北京协和医院,上海瑞金医院\r\n'
  const prose = '申请医院：北京协和医院\n送检医院：上海瑞金医院\n'
  const { fileOf, output } = await batch({ 'h.csv': csv, 'n.csv': noHeader, 'o.csv': onlyHospitals, 't.txt': prose })
  const out = (await output('h.csv')).toString('utf8')
  // (The CSV writer normalizes line endings to \n; only the cells matter here.)
  assert.equal(out.split(/\r?\n/)[0], header)
  for (const value of ['北京协和医院', '上海瑞金医院', '张三', '李四']) assert.ok(!out.includes(value), `${value}: ${out}`)
  assert.equal(fileOf('h.csv').status, 'clean', JSON.stringify(fileOf('h.csv').issues))
  const outNo = (await output('n.csv')).toString('utf8')
  assert.ok(!outNo.includes('北京协和医院') && !outNo.includes('上海瑞金医院'), outNo)
  const outOnly = (await output('o.csv')).toString('utf8')
  assert.equal(outOnly.split(/\r?\n/)[0], '申请医院,检查医院', outOnly)
  assert.ok(!outOnly.includes('北京协和医院'), outOnly)
  const outProse = (await output('t.txt')).toString('utf8')
  assert.ok(outProse.startsWith('申请医院：') && outProse.includes('\n送检医院：'), outProse)
  assert.ok(!outProse.includes('北京协和医院') && !outProse.includes('上海瑞金医院'), outProse)
})

await check('#5 XLSX 首行列名“申请医院”等保持原样，数据中的医院名被替换', async () => {
  const sheet = XLSX.utils.aoa_to_sheet([['姓名', '申请医院', '送检医院', '结果'], ['张三', '北京协和医院', '上海瑞金医院', '阴性']])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, '检验')
  const { fileOf, output } = await batch({ 'x.xlsx': XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) })
  const rows = XLSX.utils.sheet_to_json(XLSX.read(await output('x.xlsx'), { type: 'buffer' }).Sheets['检验'], { header: 1, raw: true })
  assert.deepEqual(rows[0], ['姓名', '申请医院', '送检医院', '结果'])
  assert.ok(!JSON.stringify(rows[1]).includes('协和') && !JSON.stringify(rows[1]).includes('瑞金'), JSON.stringify(rows[1]))
  assert.equal(fileOf('x.xlsx').status, 'clean', JSON.stringify(fileOf('x.xlsx').issues))
})

await rm(tmp, { recursive: true, force: true })
console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
