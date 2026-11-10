/**
 * XLSX text outside cell values and numeric identifiers in XLSX/JSON
 * (code review #6, #7). Synthetic data only.
 * Run: node test/fix-xlsx-json.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as XLSX from '../vendor/xlsx.mjs'
import { loadDocument } from '../lib/formats.js'
import { runBatch } from '../lib/pipeline.js'
import { outDirOf, outJoin } from './outputs.mjs'

const tmp = await mkdtemp(join(tmpdir(), 'dsh-fix-xlsx-json-'))

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

const SHEET = '张三_13800138000'
const NAME = '张三'
const PHONE = '13800138000'
const PHONE2 = '13900139000'
const EMAIL = 'zhangsan@example.com'

/** Workbook with identifiers everywhere SheetJS keeps text. */
function buildWorkbook({ definedNameWithId = false } = {}) {
  const ws = XLSX.utils.aoa_to_sheet([
    ['姓名', '电话', '住院号', '备注', '结果文本', '年龄', '血小板', '身份证号', '说明'],
    [NAME, 13800138000, 20230001, '见链接', null, 45, 250000, 110105195001010020, 13900139000],
    ['李四', 13700137000, 20230002, '无', null, 7, 3, 110105198803150037, 12],
  ])
  ws.A2.c = [{ a: '张三医生', t: `患者${NAME} 电话${PHONE}` }]
  ws.D2.l = { Target: `mailto:${EMAIL}`, Tooltip: `${NAME}的邮箱` }
  ws.D3.l = { Target: `#'${SHEET}'!A2`, Tooltip: '跳转' }
  ws.E2 = { t: 's', v: NAME, f: `"${NAME}"` }
  ws.E3 = { t: 's', v: `${NAME}先生`, f: `"${NAME}"&"先生"` }
  const sum = XLSX.utils.aoa_to_sheet([['引用', '数量'], [null, 1], [null, 2]])
  sum.A2 = { t: 's', v: NAME, f: `'${SHEET}'!A2` }
  sum.A3 = { t: 'n', v: 45, f: `SUM('${SHEET}'!F2:F2)` }
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, ws, SHEET)
  XLSX.utils.book_append_sheet(book, sum, '汇总')
  book.Workbook ??= {}
  book.Workbook.Names = [
    { Name: 'Ref', Ref: `"${NAME}${PHONE}"` },
    { Name: 'Pt', Ref: `'${SHEET}'!$A$2`, Comment: `${NAME}的姓名` },
  ]
  if (definedNameWithId) book.Workbook.Names.push({ Name: NAME, Ref: `'${SHEET}'!$B$2` })
  book.Props = { Author: '张三医生', Title: `${NAME}病历`, Subject: `${NAME} ${PHONE}`, Company: '幸福医院', Comments: `联系人 ${NAME}`, Keywords: PHONE, LastAuthor: '张三医生' }
  book.Custprops = { 患者: NAME }
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}

/** Every unpacked part of an xlsx, as UTF-8 text. */
function xlsxParts(buffer) {
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' })
  return cfb.FileIndex
    .map((entry, index) => ({ path: cfb.FullPaths[index], content: entry.content }))
    .filter((entry) => entry.content && entry.content.length > 0)
    .map((entry) => ({ path: entry.path, text: Buffer.from(entry.content).toString('utf8') }))
}

/** The value as stored, and as stored after a latin1→utf8 double encoding. */
function forms(value) {
  return [value, Buffer.from(Buffer.from(value, 'utf8').toString('latin1'), 'utf8').toString('utf8')]
}

function assertNoneIn(parts, secrets) {
  for (const part of parts) {
    for (const secret of secrets) {
      for (const form of forms(secret)) {
        assert.ok(!part.text.includes(form), `${part.path} still contains ${secret}`)
      }
    }
  }
}

async function docFor(name, data) {
  const path = join(tmp, 'unit', name)
  await mkdir(join(tmp, 'unit'), { recursive: true })
  await writeFile(path, data)
  return loadDocument(path, name)
}

function replaceAll(doc, segment, needle, replacement) {
  const list = []
  let at = segment.text.indexOf(needle)
  while (at !== -1) {
    list.push({ id: segment.id, start: at, end: at + needle.length, original: needle, replacement })
    at = segment.text.indexOf(needle, at + needle.length)
  }
  return list.sort((a, b) => b.start - a.start)
}

/* ------------------------------------------------------------- xlsx unit */

await check('#6 XLSX: 工作表名、批注、链接、公式字面量、定义名称、文档属性都作为文本段暴露', async () => {
  const doc = await docFor('a.xlsx', buildWorkbook())
  const texts = doc.segments().map((segment) => segment.text)
  for (const expected of [
    SHEET,
    `患者${NAME} 电话${PHONE}`,
    '张三医生',
    `mailto:${EMAIL}`,
    `${NAME}的邮箱`,
    `${NAME}${PHONE}`,
    `${NAME}的姓名`,
    `${NAME}病历`,
    `${NAME} ${PHONE}`,
    '幸福医院',
    `联系人 ${NAME}`,
    PHONE,
  ]) {
    assert.ok(texts.includes(expected), `missing segment ${expected}; got ${JSON.stringify(texts)}`)
  }
  // Formula string literals: "张三" in E2 and both literals of E3.
  const formula = doc.segments().filter((segment) => /公式|formula/i.test(segment.field ?? '') && segment.text === NAME)
  assert.ok(formula.length >= 2, JSON.stringify(doc.segments().map((s) => [s.id, s.field, s.text])))
  // Custom property value (SheetJS reads it as mis-decoded UTF-8).
  assert.ok(doc.segments().some((segment) => segment.text === NAME && /自定义属性/.test(segment.field ?? '')))
  // No segment text is mojibake.
  for (const segment of doc.segments()) assert.ok(!/[À-ÿ][\u0080-¿]/.test(segment.text), `mojibake segment ${segment.text}`)
})

await check('#6 XLSX: 替换工作表名后，公式、定义名称与内部链接跟随新名称，旧名不残留', async () => {
  const doc = await docFor('rename.xlsx', buildWorkbook())
  const segment = doc.segments().find((item) => item.text === SHEET)
  assert.ok(segment)
  const applied = doc.apply(replaceAll(doc, segment, PHONE, '电话-1A2B3C').concat(replaceAll(doc, segment, NAME, '化名-ABCDEF')).sort((a, b) => b.start - a.start))
  assert.equal(applied, 2)
  assert.equal(doc.structure().ok, true, JSON.stringify(doc.structure()))
  const out = doc.serialize()
  const book = XLSX.read(out, { type: 'buffer' })
  const renamed = '化名-ABCDEF_电话-1A2B3C'
  assert.deepEqual(book.SheetNames, [renamed, '汇总'])
  assert.equal(book.Sheets['汇总'].A2.f, `'${renamed}'!A2`)
  assert.equal(book.Sheets['汇总'].A3.f, `SUM('${renamed}'!F2:F2)`)
  assert.equal(book.Workbook.Names.find((n) => n.Name === 'Pt').Ref, `'${renamed}'!$A$2`)
  assert.equal(book.Sheets[renamed].D3.l.Target, `#'${renamed}'!A2`)
  for (const part of xlsxParts(out)) assert.ok(!part.text.includes(SHEET), `${part.path} still has the old sheet name`)
})

await check('#6 XLSX: 改名时未加引号、三维引用、大小写不同的引用都跟随，外部引用与字符串不动', async () => {
  const main = XLSX.utils.aoa_to_sheet([['合计'], [null], [null]])
  main.A2 = { t: 's', v: 'x', f: `李四!B2&[1]李四!A1&"李四!"&IF(TRUE,李四!B3)` }
  main.A3 = { t: 'n', v: 1, f: 'SUM(李四:Sheet1!B2)+sheet1!B2' }
  const other = XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2], [3, 4]])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, main, 'Sheet1')
  XLSX.utils.book_append_sheet(book, other, '李四')
  book.Workbook ??= {}
  book.Workbook.Names = [{ Name: '_xlnm.Print_Area', Sheet: 1, Ref: '李四!$A$1:$B$3' }]
  const doc = await docFor('refs.xlsx', XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
  const name = doc.segments().find((segment) => segment.id === 'x1:#name')
  assert.equal(name.text, '李四')
  assert.equal(doc.apply([{ id: name.id, start: 0, end: 2, original: '李四', replacement: '化名-ABCDEF' }]), 1)
  const out = XLSX.read(doc.serialize(), { type: 'buffer' })
  assert.deepEqual(out.SheetNames, ['Sheet1', '化名-ABCDEF'])
  assert.equal(out.Sheets.Sheet1.A2.f, `'化名-ABCDEF'!B2&[1]李四!A1&"李四!"&IF(TRUE,'化名-ABCDEF'!B3)`)
  assert.equal(out.Sheets.Sheet1.A3.f, `SUM('化名-ABCDEF:Sheet1'!B2)+sheet1!B2`)
  assert.equal(out.Workbook.Names[0].Ref, `'化名-ABCDEF'!$A$1:$B$3`)
  // The string literal after the renamed reference is still exposed and writable.
  const literal = doc.segments().find((segment) => segment.id === 'x0:A2#f0')
  assert.equal(literal?.text, '李四!')
  assert.equal(doc.apply([{ id: literal.id, start: 0, end: 2, original: '李四', replacement: '化名-ABCDEF' }]), 1)
  assert.match(XLSX.read(doc.serialize(), { type: 'buffer' }).Sheets.Sheet1.A2.f, /&"化名-ABCDEF!"&/)
  // Renaming the first sheet also matches a reference in another case.
  const first = doc.segments().find((segment) => segment.id === 'x0:#name')
  assert.equal(doc.apply([{ id: first.id, start: 0, end: 6, original: 'Sheet1', replacement: '表一' }]), 1)
  assert.equal(XLSX.read(doc.serialize(), { type: 'buffer' }).Sheets['表一'].A3.f, `SUM('化名-ABCDEF:表一'!B2)+'表一'!B2`)
  assert.equal(doc.structure().ok, true, JSON.stringify(doc.structure()))
})

await check('#6 XLSX: 无效的工作表名（含 / 或超过 31 字）不写入，保持可见以待复核', async () => {
  const doc = await docFor('badname.xlsx', buildWorkbook())
  const segment = doc.segments().find((item) => item.text === SHEET)
  assert.equal(doc.apply([{ id: segment.id, start: 0, end: 2, original: NAME, replacement: 'a/b' }]), 0)
  assert.equal(doc.apply([{ id: segment.id, start: 0, end: 2, original: NAME, replacement: 'x'.repeat(40) }]), 0)
  assert.ok(doc.segments().some((item) => item.text === SHEET))
  assert.equal(doc.structure().ok, true)
  // Duplicate of another sheet name (case-insensitive in Excel).
  assert.equal(doc.apply([{ id: segment.id, start: 0, end: SHEET.length, original: SHEET, replacement: '汇总' }]), 0)
})

await check('#6 XLSX: 批注、链接、公式字面量、定义名称、属性的替换写回文件', async () => {
  const doc = await docFor('write.xlsx', buildWorkbook())
  const replacements = []
  for (const segment of doc.segments()) {
    replacements.push(...replaceAll(doc, segment, PHONE, '电话-1A2B3C'))
    replacements.push(...replaceAll(doc, segment, NAME, '化名-ABCDEF'))
    replacements.push(...replaceAll(doc, segment, EMAIL, 'a@b.example'))
  }
  // Apply per segment, right to left within each.
  replacements.sort((a, b) => b.start - a.start)
  const applied = doc.apply(replacements)
  assert.equal(applied, replacements.length)
  assert.equal(doc.structure().ok, true, JSON.stringify(doc.structure()))
  const out = doc.serialize()
  assertNoneIn(xlsxParts(out), [NAME, PHONE, EMAIL, SHEET])
  const book = XLSX.read(out, { type: 'buffer' })
  const sheet = book.Sheets[book.SheetNames[0]]
  assert.match(sheet.A2.c[0].t, /化名-ABCDEF/)
  assert.equal(sheet.D2.l.Target, 'mailto:a@b.example')
  // A formula whose cached value was rewritten never recomputes the original.
  for (const addr of ['E2', 'E3']) assert.ok(!String(sheet[addr].f ?? '').includes(NAME), `${addr}.f=${sheet[addr].f}`)
  assert.equal(book.Workbook.Names.find((n) => n.Name === 'Ref').Ref, '"化名-ABCDEF电话-1A2B3C"')
  assert.equal(book.Props.Title, '化名-ABCDEF病历')
})

await check('#6 XLSX: 只替换公式字面量时公式保留且转义正确', async () => {
  const doc = await docFor('literal.xlsx', buildWorkbook())
  const literal = doc.segments().find((segment) => segment.id.startsWith('x0:E3') && segment.id !== 'x0:E3' && segment.text === NAME)
  assert.ok(literal, JSON.stringify(doc.segments().map((s) => s.id)))
  assert.equal(doc.apply([{ id: literal.id, start: 0, end: 2, original: NAME, replacement: '王"五' }]), 1)
  const book = XLSX.read(doc.serialize(), { type: 'buffer' })
  assert.equal(book.Sheets[book.SheetNames[0]].E3.f, '"王""五"&"先生"')
})

await check('#7 XLSX: 6 位以上整数单元格作为文本段，小数值不暴露', async () => {
  const doc = await docFor('num.xlsx', buildWorkbook())
  const byText = new Map(doc.segments().map((segment) => [segment.text, segment]))
  for (const value of [PHONE, '20230001', '13700137000', '250000', '110105195001010020', PHONE2]) {
    assert.ok(byText.has(value), `missing numeric segment ${value}`)
  }
  const byId = new Map(doc.segments().map((segment) => [segment.id, segment]))
  assert.equal(byId.get('x0:B2').text, PHONE)
  assert.equal(byId.get('x0:B2').hint, '电话')
  assert.equal(byId.get('x0:C2').hint, '住院号')
  assert.equal(byId.get('x0:H2').hint, '身份证号')
  assert.equal(byId.get('x0:I2').hint, null)
  assert.equal(byId.get('x0:G2').quasi, null)
  for (const value of ['45', '7', '3', '12', '1', '2']) assert.ok(!byText.has(value), `small number exposed: ${value}`)
})

await check('#7 XLSX: 数值标识符被替换后成为文本化名，其它数值不变', async () => {
  const doc = await docFor('num2.xlsx', buildWorkbook())
  const phone = doc.segments().find((segment) => segment.text === PHONE && segment.hint === '电话')
  const mrn = doc.segments().find((segment) => segment.text === '20230001')
  assert.equal(doc.apply([
    { id: phone.id, start: 0, end: PHONE.length, original: PHONE, replacement: '电话-1A2B3C' },
    { id: mrn.id, start: 0, end: 8, original: '20230001', replacement: '住院号-0F0F0F' },
  ]), 2)
  assert.equal(doc.structure().ok, true, JSON.stringify(doc.structure()))
  const book = XLSX.read(doc.serialize(), { type: 'buffer' })
  const sheet = book.Sheets[book.SheetNames[0]]
  assert.equal(sheet.B2.t, 's')
  assert.equal(sheet.B2.v, '电话-1A2B3C')
  assert.equal(sheet.C2.v, '住院号-0F0F0F')
  assert.equal(sheet.F2.v, 45)
  assert.equal(sheet.G2.v, 250000)
  assert.equal(sheet.B3.v, 13700137000)
  // The replaced cell is now text; the segment stays addressable.
  assert.ok(doc.segments().some((segment) => segment.id === phone.id && segment.text === '电话-1A2B3C'))
})

/* ------------------------------------------------------------- json unit */

const JSON_RAW = `{
  "patient": {
    "name": "张三",
    "age": 40,
    "phone": 13800138000,
    "mrn": 573453,
    "idCard": 110105195001010020,
    "dose": 0.5,
    "count": 3,
    "delta": -250000
  },
  "seq": 12345678901234567890,
  "labs": [{ "item": "血小板", "value": 250000 }, 13900139000, 7]
}
`

await check('#7 JSON: 6 位以上整数作为文本段，按原文数字（不丢精度），小数值不暴露', async () => {
  const doc = await docFor('a.json', JSON_RAW)
  const byText = new Map(doc.segments().map((segment) => [segment.text, segment]))
  for (const value of [PHONE, '573453', '110105195001010020', '12345678901234567890', '250000', PHONE2]) {
    assert.ok(byText.has(value), `missing numeric segment ${value}; got ${JSON.stringify([...byText.keys()])}`)
  }
  assert.equal(byText.get(PHONE).hint, '电话')
  assert.equal(byText.get('573453').hint, '病历号')
  assert.equal(byText.get('110105195001010020').hint, '身份证号')
  for (const value of ['40', '0.5', '3', '7', '-250000']) assert.ok(!byText.has(value), `small/negative number exposed: ${value}`)
})

await check('#7 JSON: 未改动时数字原样输出（大整数不被四舍五入）', async () => {
  const doc = await docFor('b.json', JSON_RAW)
  const out = doc.serialize()
  assert.ok(out.includes('110105195001010020'), out)
  assert.ok(out.includes('12345678901234567890'), out)
  assert.ok(out.includes('"age": 40'))
  assert.equal(doc.structure().ok, true)
})

await check('#7 JSON: 替换数字标识符后值变为字符串化名，结构校验通过', async () => {
  const doc = await docFor('c.json', JSON_RAW)
  const segments = doc.segments()
  const phone = segments.find((segment) => segment.text === PHONE && segment.hint === '电话')
  const id = segments.find((segment) => segment.text === '110105195001010020')
  const arrayPhone = segments.find((segment) => segment.text === PHONE2)
  assert.equal(doc.apply([
    { id: phone.id, start: 0, end: 11, original: PHONE, replacement: '电话-1A2B3C' },
    { id: id.id, start: 0, end: 18, original: '110105195001010020', replacement: '身份证号-ABC123' },
    { id: arrayPhone.id, start: 0, end: 11, original: PHONE2, replacement: '电话-000000' },
  ]), 3)
  assert.equal(doc.structure().ok, true, JSON.stringify(doc.structure()))
  const out = doc.serialize()
  const parsed = JSON.parse(out)
  assert.equal(parsed.patient.phone, '电话-1A2B3C')
  assert.equal(parsed.patient.idCard, '身份证号-ABC123')
  assert.equal(parsed.labs[1], '电话-000000')
  assert.equal(parsed.patient.age, 40)
  assert.equal(parsed.patient.mrn, 573453)
  assert.ok(out.includes('12345678901234567890'))
  assert.ok(!out.includes(PHONE) && !out.includes(PHONE2))
  // A stale replacement against the old number no longer applies.
  assert.equal(doc.apply([{ id: phone.id, start: 0, end: 11, original: PHONE, replacement: 'x' }]), 0)
})

await check('#7 JSON: 紧凑格式、顶层数组和数字根也能处理', async () => {
  const compact = await docFor('d.json', '[13800138000,{"tel":13900139000,"n":1}]')
  assert.deepEqual(compact.segments().map((segment) => segment.text).sort(), [PHONE, PHONE2])
  assert.equal(compact.serialize(), '[13800138000,{"tel":13900139000,"n":1}]')
  const scalar = await docFor('e.json', '110105195001010020')
  assert.deepEqual(scalar.segments().map((segment) => segment.text), ['110105195001010020'])
  assert.equal(scalar.serialize(), '110105195001010020')
  // A document that is a single value has nowhere to write a pseudonym: the
  // replacement is refused, so the value is reported, never passed as clean.
  const [only] = scalar.segments()
  assert.equal(scalar.apply([{ id: only.id, start: 0, end: 18, original: only.text, replacement: 'x' }]), 0)
})

/* ------------------------------------------------------------ end to end */

await check('端到端：XLSX 中任何位置的标识符都不原样交付', async () => {
  const input = join(tmp, 'e2e-xlsx')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'c.xlsx'), buildWorkbook())
  const root = join(tmp, 'e2e-xlsx-out')
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'x1', maxRounds: 2 } })
  const file = run.files.find((item) => item.relPath === 'c.xlsx')
  assert.ok(file, JSON.stringify(run.files))
  const out = await readFile(outJoin(await outDirOf(root, 'x1'), 'c.xlsx'))
  assertNoneIn(xlsxParts(out), [NAME, PHONE, PHONE2, EMAIL, '20230001', '13700137000', '110105195001010020', '李四', SHEET])
  const book = XLSX.read(out, { type: 'buffer' })
  const sheet = book.Sheets[book.SheetNames[0]]
  assert.equal(sheet.F2.v, 45)
  assert.equal(sheet.G2.v, 250000)
  assert.equal(typeof sheet.B2.v, 'string')
  assert.equal(book.SheetNames[1], '汇总')
  // A formula over a renamed sheet follows the new name; one whose cached
  // value was rewritten is dropped, so it cannot recompute the original.
  assert.equal(book.Sheets['汇总'].A3.f, `SUM('${book.SheetNames[0]}'!F2:F2)`)
  assert.equal(book.Sheets['汇总'].A3.v, 45)
  assert.equal(book.Sheets['汇总'].A2.f, undefined)
  assert.match(String(book.Sheets['汇总'].A2.v), /化名-[0-9A-F]{6}/)
  assert.equal(file.structure?.ok, true, JSON.stringify(file.structure))
  // Reports never carry the original values.
  const report = await readFile(join(root, '_records', 'runs', 'x1', 'report.json'), 'utf8')
  for (const secret of [PHONE, EMAIL, '20230001']) assert.ok(!report.includes(secret), `report.json contains ${secret}`)
})

await check('端到端：定义名称本身含标识符（无法安全改名）时文件不能标为 clean', async () => {
  const input = join(tmp, 'e2e-name')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'n.xlsx'), buildWorkbook({ definedNameWithId: true }))
  const root = join(tmp, 'e2e-name-out')
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'x2', maxRounds: 2 } })
  const file = run.files.find((item) => item.relPath === 'n.xlsx')
  assert.notEqual(file.status, 'clean', JSON.stringify(file.issues))
})

await check('端到端：JSON 数字型电话、病历号、身份证号被替换，年龄等不变', async () => {
  const input = join(tmp, 'e2e-json')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'a.json'), JSON_RAW)
  const root = join(tmp, 'e2e-json-out')
  await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'j1', maxRounds: 2 } })
  const out = await readFile(outJoin(await outDirOf(root, 'j1'), 'a.json'), 'utf8')
  for (const secret of [NAME, PHONE, PHONE2, '573453', '110105195001010020', '11010519500101002']) {
    assert.ok(!out.includes(secret), `output still contains ${secret}:\n${out}`)
  }
  const parsed = JSON.parse(out)
  assert.equal(parsed.patient.age, 40)
  assert.equal(parsed.patient.dose, 0.5)
  assert.equal(parsed.patient.count, 3)
  assert.equal(parsed.patient.delta, -250000)
  assert.equal(parsed.labs[0].value, 250000)
  assert.ok(out.includes('12345678901234567890'), out)
})

/* ------------------------------------------------- follow-up (review) */

/** Runs one rules-only batch over `files`; returns the run, the output dir and the records dir. */
async function batch(tag, files) {
  const input = join(tmp, `in-${tag}`)
  await mkdir(input, { recursive: true })
  for (const [name, data] of Object.entries(files)) await writeFile(join(input, name), data)
  const root = join(tmp, `out-${tag}`)
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: tag, maxRounds: 2 } })
  return { run, out: await outDirOf(root, tag), records: join(root, '_records', 'runs', tag) }
}

function sheetBook(rows, { name = 'S', edit } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  edit?.(ws)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, ws, name)
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}

const HEX = 'a3f5c9e1b7d2468f0e9a1b3c5d7f9e2a4b6c8d0e1f3a5b7c9d1e3f5a7b9c1d3e5'

await check('跟进 1：线程批注（Excel 365 新批注）按 UTF-8 解码后检测，姓名/电话被替换，正文不乱码', async () => {
  const data = sheetBook([['姓名', '电话'], ['王五', '13800138000'], ['赵六', '13700137000']], {
    edit(ws) {
      ws.B3.c = [{ a: '赵六', t: '赵六 13912345678', T: true }, { a: '王五', t: '回复：患者主诉头痛，联系 13612345678', T: true }]
      ws.A2.c = [{ a: '医生甲', t: '王五 已复诊', T: true }]
    },
  })
  const doc = await docFor('threaded.xlsx', data)
  const texts = doc.segments().map((segment) => segment.text)
  assert.ok(texts.includes('赵六 13912345678'), JSON.stringify(texts))
  assert.ok(texts.includes('王五 已复诊'), JSON.stringify(texts))
  for (const segment of doc.segments()) assert.ok(!/[À-ÿ][\u0080-¿]/.test(segment.text), `mojibake segment ${segment.text}`)

  const { run, out } = await batch('thr', { 't.xlsx': data })
  const file = run.files.find((item) => item.relPath === 't.xlsx')
  const bytes = await readFile(outJoin(out, 't.xlsx'))
  const parts = xlsxParts(bytes)
  assertNoneIn(parts, ['赵六', '王五', '13912345678', '13612345678', '13800138000'])
  const threaded = parts.find((part) => /threadedComment/i.test(part.path))
  assert.ok(threaded, parts.map((part) => part.path).join(','))
  assert.ok(threaded.text.includes('患者主诉头痛'), `clinical text garbled: ${threaded.text.slice(-400)}`)
  assert.ok(!/[À-ÿ][\u0080-¿]/.test(threaded.text), `threaded comment written as mojibake: ${threaded.text.slice(-400)}`)
  assert.ok(file.status === 'clean' || file.status === 'review', file.status)
})

await check('跟进 2：工作表名、表头被替换后，报告与复核清单里的字段名也不含原值', async () => {
  const data = sheetBook([['姓名', '赵六的备注', '身份证号'], ['王五', HEX, '11010519500101002X'], ['赵六', '无', '110105195001010021']], { name: '王五' })
  const doc = await docFor('labels.xlsx', data)
  const labels = new Set(doc.segments().map((segment) => segment.field).filter(Boolean))
  assert.ok([...labels].some((label) => label.includes('王五')), 'test premise: labels carry the sheet name')
  const sheetSeg = doc.segments().find((segment) => segment.text === '王五' && segment.field === '工作表名称')
  const header = doc.segments().find((segment) => segment.text === '赵六的备注')
  assert.equal(doc.apply([
    { id: sheetSeg.id, start: 0, end: 2, original: '王五', replacement: '化名-AAAAAA' },
    { id: header.id, start: 0, end: 2, original: '赵六', replacement: '化名-BBBBBB' },
  ]), 2)
  const renamed = new Map(doc.renamedFields())
  assert.equal(renamed.get('王五!赵六的备注'), '化名-AAAAAA!化名-BBBBBB的备注')
  assert.equal(renamed.get('王五!身份证号'), '化名-AAAAAA!身份证号')
  for (const [, to] of renamed) assert.ok(!to.includes('王五') && !to.includes('赵六'), to)

  const { run, out, records } = await batch('lbl', { 'a.xlsx': data })
  const file = run.files.find((item) => item.relPath === 'a.xlsx')
  assert.equal(file.status, 'review', JSON.stringify(file.issues))
  assert.ok(file.issues.some((issue) => issue.code === 'unreadable'), JSON.stringify(file.issues))
  assertNoneIn(xlsxParts(await readFile(outJoin(out, 'a.xlsx'))), ['王五', '赵六'])
  for (const name of ['report.json', 'report.md', 'review-items.json']) {
    const text = await readFile(join(records, name), 'utf8')
    for (const secret of ['王五', '赵六']) assert.ok(!text.includes(secret), `${name} contains ${secret}`)
  }
  // The label still says which column (with the new names).
  const unreadable = file.issues.find((issue) => issue.code === 'unreadable')
  assert.match(unreadable.detail, /-[0-9A-F]{6}!\S*-[0-9A-F]{6}的备注/)
})

await check('跟进 3：公式里的外部工作簿路径、外部表名与数字常量不原样交付', async () => {
  const data = sheetBook([['姓名', '电话', '引用', '合计'], ['王五', '13800138000', 1, 0], ['赵六', '13700137000', 2, 0], ['李四', '13600136000', 3, 0]], {
    edit(ws) {
      ws.C2 = { t: 'n', v: 1, f: '[1]王五!A1' }
      ws.C3 = { t: 'n', v: 2, f: "'C:\\病人\\[王五_13800138000.xlsx]Sheet1'!A1" }
      ws.C4 = { t: 'n', v: 3, f: '[赵六.xlsx]Sheet1!$B$2' }
      ws.D2 = { t: 'n', v: 0, f: 'IF(A2="x",13900139000,0)' }
      // Ordinary formulas: internal sheet, whole-column/row ranges, small numbers.
      ws.D3 = { t: 'n', v: 0, f: "SUM(S!C2:C1048576)+'S'!C2*100" }
      ws.D4 = { t: 'n', v: 0, f: 'SUM(1:1048576)-ROUND(C4,2)' }
    },
  })
  const doc = await docFor('formula.xlsx', data)
  const texts = doc.segments().map((segment) => segment.text).join('\n')
  for (const needle of ['王五_13800138000', '13900139000', '赵六.xlsx']) assert.ok(texts.includes(needle), `not exposed: ${needle}\n${texts}`)
  assert.ok(!texts.includes('1048576'), 'cell/row references must not be exposed as numbers')

  const { run, out } = await batch('fml', { 'f.xlsx': data })
  const file = run.files.find((item) => item.relPath === 'f.xlsx')
  const bytes = await readFile(outJoin(out, 'f.xlsx'))
  assertNoneIn(xlsxParts(bytes), ['王五', '赵六', '13800138000', '13900139000'])
  const book = XLSX.read(bytes, { type: 'buffer' })
  const sheet = book.Sheets[book.SheetNames[0]]
  // A formula that held an identifier is dropped; its cached value stays.
  assert.equal(sheet.C2.v, 1)
  assert.equal(sheet.C3.v, 2)
  assert.equal(sheet.C4.v, 3)
  assert.equal(sheet.D2.v, 0)
  // Ordinary formulas are untouched.
  assert.equal(sheet.D3.f, "SUM(S!C2:C1048576)+'S'!C2*100")
  assert.equal(sheet.D4.f, 'SUM(1:1048576)-ROUND(C4,2)')
  assert.equal(file.structure?.ok, true, JSON.stringify(file.structure))
})

await check('跟进 3：定义名称引用外部工作簿路径时不能标为 clean', async () => {
  const ws = XLSX.utils.aoa_to_sheet([['姓名', '电话'], ['王五', '13800138000']])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, ws, 'S')
  book.Workbook = { Names: [{ Name: 'Ext', Ref: "'C:\\病人\\[王五_13800138000.xlsx]Sheet1'!$A$1" }] }
  const { run, out } = await batch('fmn', { 'n.xlsx': XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) })
  const file = run.files.find((item) => item.relPath === 'n.xlsx')
  const parts = xlsxParts(await readFile(outJoin(out, 'n.xlsx')))
  const leaked = parts.some((part) => forms('王五').some((form) => part.text.includes(form)))
  assert.ok(!leaked || file.status !== 'clean', `delivered as clean with the name: ${JSON.stringify(file.issues)}`)
  // A defined name cannot drop its formula: the reference stays and is sent to review.
  assert.equal(file.status, 'review', JSON.stringify(file.issues))
})

await check('跟进 4：JSON 中写成小数或指数形式的数字标识符（pandas 导出）也被检查', async () => {
  const doc = await docFor('float.json', '{"patient":{"name":"王五","age":40,"phone":13800138000.0,"mrn":573453.0,"idCard":1.1010519500101002e17,"value":250000.0,"dose":0.5,"count":3.0}}')
  const texts = doc.segments().map((segment) => segment.text)
  for (const expected of ['13800138000', '573453', '110105195001010020']) assert.ok(texts.includes(expected), `${expected} not exposed: ${JSON.stringify(texts)}`)
  assert.ok(!texts.includes('0.5') && !texts.includes('3'), JSON.stringify(texts))
  // Untouched numbers keep their source text.
  assert.ok(doc.serialize().includes('250000.0') && doc.serialize().includes('1.1010519500101002e17') && doc.serialize().includes('"count":3.0'), doc.serialize())

  const { run, out } = await batch('flt', {
    'a.json': '{"records":[{"姓名":"王五","联系电话":13800138000.0},{"姓名":"赵六","联系电话":1.37001370E10}]}\n',
    'b.json': '{"patient":{"name":"王五","age":40,"phone":13800138000.0,"mrn":573453.0,"idCard":1.1010519500101002e17,"value":250000.0,"dose":0.5,"count":3.0}}',
  })
  const a = await readFile(outJoin(out, 'a.json'), 'utf8')
  const b = await readFile(outJoin(out, 'b.json'), 'utf8')
  for (const secret of ['13800138000', '1.37001370E10', '13700137000']) assert.ok(!a.includes(secret), `a.json still contains ${secret}: ${a}`)
  for (const secret of ['13800138000', '573453', '1.1010519500101002e17', '110105195001010020']) assert.ok(!b.includes(secret), `b.json still contains ${secret}: ${b}`)
  const parsed = JSON.parse(b)
  assert.equal(parsed.patient.age, 40)
  assert.equal(parsed.patient.dose, 0.5)
  assert.ok(b.includes('"count": 3.0') || b.includes('"count":3.0'), b)
  assert.ok(b.includes('250000.0'), b)
  for (const file of run.files) assert.ok(file.status === 'clean' || file.status === 'review', file.status)
})

await check('跟进 5：标识符列/键下少于 6 位的数字（住院号、病历号）也被替换', async () => {
  const xlsx = sheetBook([['姓名', '住院号', '病历号', '年龄', '血小板'], ['王五', 57345, '57346', 40, 250], ['赵六', 9876, '9877', 33, 7]])
  const json = JSON.stringify({ patients: [{ name: '王五', age: 40, inhos_no: 57345, mrn: '57346', count: 12 }], items: [{ ITM_NM: '住院号', ITM_VLU: 4321 }, { ITM_NM: '体温', ITM_VLU: 37 }] })
  const { out } = await batch('small', { 'a.xlsx': xlsx, 'b.json': json })
  const book = XLSX.read(await readFile(outJoin(out, 'a.xlsx')), { type: 'buffer' })
  const sheet = book.Sheets[book.SheetNames[0]]
  for (const addr of ['B2', 'B3', 'C2', 'C3']) {
    assert.equal(typeof sheet[addr].v, 'string', `${addr} = ${sheet[addr].v}`)
    assert.ok(!['57345', '9876', '57346', '9877'].includes(String(sheet[addr].v)), `${addr} = ${sheet[addr].v}`)
  }
  assert.equal(sheet.D2.v, 40)
  assert.equal(sheet.D3.v, 33)
  assert.equal(sheet.E2.v, 250)
  assert.equal(sheet.E3.v, 7)
  const parsed = JSON.parse(await readFile(outJoin(out, 'b.json'), 'utf8'))
  assert.notEqual(parsed.patients[0].inhos_no, 57345)
  assert.equal(typeof parsed.patients[0].inhos_no, 'string')
  assert.notEqual(parsed.patients[0].mrn, '57346')
  assert.notEqual(parsed.items[0].ITM_VLU, 4321)
  assert.equal(parsed.patients[0].age, 40)
  assert.equal(parsed.patients[0].count, 12)
  assert.equal(parsed.items[1].ITM_VLU, 37)
})

await rm(tmp, { recursive: true, force: true })
if (failures > 0) {
  console.log(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nPASS')
