/**
 * Format fidelity and coverage (code review #17, #30, #31, #32, #50):
 * embedded JSON numbers and large integers, JSON object keys, lossless JSON
 * write-back, xlsx number formats, CSV line endings. Synthetic data only.
 * Run: node test/fix2-formats.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as XLSX from '../vendor/xlsx.mjs'
import { loadDocument } from '../lib/formats.js'
import { layered } from '../lib/layers.js'
import { runBatch } from '../lib/pipeline.js'
import { outDirOf, outJoin } from './outputs.mjs'

const tmp = await mkdtemp(join(tmpdir(), 'dsh-fix2-formats-'))

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

const NAME = '张三'
const PHONE = '13800138000'
const PHONE2 = '13900139000'
const ID_CARD = '110105195001010020' // valid checksum
const BIG = '1234567890123456789' // above 2^53

let unit = 0
async function docFor(name, data, { layer = true } = {}) {
  const dir = join(tmp, 'unit', String(unit++))
  await mkdir(dir, { recursive: true })
  const path = join(dir, name)
  await writeFile(path, data)
  const doc = await loadDocument(path, name)
  return layer ? layered(doc) : doc
}

/** Replace every occurrence of `needle` in every segment. */
function replaceEverywhere(doc, needle, replacement) {
  const list = []
  for (const segment of doc.segments()) {
    let at = segment.text.indexOf(needle)
    while (at >= 0) {
      list.push({ id: segment.id, start: at, end: at + needle.length, original: needle, replacement })
      at = segment.text.indexOf(needle, at + needle.length)
    }
  }
  list.sort((a, b) => b.start - a.start)
  return doc.apply(list)
}

async function batch(tag, files) {
  const input = join(tmp, `in-${tag}`)
  await mkdir(input, { recursive: true })
  for (const [name, data] of Object.entries(files)) await writeFile(join(input, name), data)
  const root = join(tmp, `out-${tag}`)
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: tag, maxRounds: 2 } })
  return { run, out: await outDirOf(root, tag), records: join(root, '_records', 'runs', tag) }
}

/* ------------------------------------------------------- #17 embedded JSON */

await check('#17 内嵌 JSON：数字型电话、病历号、大整数作为文本段暴露', async () => {
  const payload = `{"name":"${NAME}","phone":${PHONE},"orderId":${BIG},"mrn":573,"age":40,"dose":0.5}`
  const doc = await docFor('a.json', JSON.stringify({ payload }))
  const segments = doc.segments()
  const byText = new Map(segments.map((segment) => [segment.text, segment]))
  assert.ok(byText.has(PHONE), `phone not exposed: ${JSON.stringify(segments.map((s) => s.text))}`)
  assert.equal(byText.get(PHONE).hint, '电话')
  assert.ok(byText.has(BIG), 'large integer not exposed with its exact digits')
  // An identifier key exposes an integer of any length; ages and doses stay out.
  assert.ok(byText.has('573'), 'mrn under an identifier key not exposed')
  assert.equal(byText.get('573').hint, '病历号')
  for (const value of ['40', '0.5']) assert.ok(!byText.has(value), `clinical number exposed: ${value}`)
})

await check('#17 内嵌 JSON：改写后大整数、数字写法与空白不变，被替换的数字变为字符串', async () => {
  const payload = `{ "name": "${NAME}", "phone": ${PHONE}, "orderId": ${BIG}, "dose": 0.50, "ratio": 1e5 }`
  const raw = JSON.stringify({ payload })
  const doc = await docFor('b.json', raw)
  assert.ok(replaceEverywhere(doc, NAME, '化名-ABCDEF') >= 1)
  assert.ok(replaceEverywhere(doc, PHONE, '电话-123456') >= 1)
  const structure = doc.structure()
  assert.equal(structure.ok, true, JSON.stringify(structure))
  const out = JSON.parse(doc.serialize()).payload
  assert.equal(out, `{ "name": "化名-ABCDEF", "phone": "电话-123456", "orderId": ${BIG}, "dose": 0.50, "ratio": 1e5 }`)
})

await check('#17 内嵌 JSON（CSV 单元格内）：只改动命中的值', async () => {
  const cell = `{"patient":{"电话":${PHONE2},"seq":${BIG}},"items":[1,2,3]}`
  const csv = `姓名,数据\r\n${NAME},"${cell.replace(/"/g, '""')}"\r\n`
  const doc = await docFor('c.csv', csv)
  assert.ok(doc.segments().some((segment) => segment.text === PHONE2), 'phone in embedded JSON not exposed')
  assert.ok(replaceEverywhere(doc, PHONE2, '电话-000001') >= 1)
  assert.equal(doc.structure().ok, true, JSON.stringify(doc.structure()))
  const out = doc.serialize()
  assert.ok(out.includes(`""seq"":${BIG}`), out)
  assert.ok(out.includes('""items"":[1,2,3]'), out)
  assert.ok(!out.includes(PHONE2), out)
})

await check('#17 端到端：内嵌 JSON 中的数字型电话不原样交付，大整数不被改动', async () => {
  const payload = `{"name":"${NAME}","phone":${PHONE},"orderId":${BIG}}`
  const { run, out } = await batch('e17', { 'a.json': JSON.stringify({ patient: { 姓名: NAME, 记录: payload } }, null, 2) })
  const text = await readFile(outJoin(out, 'a.json'), 'utf8')
  assert.ok(!text.includes(PHONE), `phone delivered: ${text}`)
  assert.ok(!text.includes(NAME), `name delivered: ${text}`)
  assert.ok(text.includes(BIG), `large integer changed: ${text}`)
  const file = run.files.find((item) => item.relPath === 'a.json')
  assert.equal(file.structure?.ok, true, JSON.stringify(file.structure))
})

/* ------------------------------------------------------------- #30 keys */

await check('#30 JSON 键名：可能含标识符的键作为文本段暴露，普通程序键名不暴露', async () => {
  const raw = JSON.stringify({ [ID_CARD]: { 诊断: '高血压' }, [NAME]: [1, 2], 'zhang.san@example.com': 1, patient_name: 'x', ITM_VLU: 'y', 12: 'z', records: { [PHONE]: '复诊' } })
  const doc = await docFor('k.json', raw, { layer: false })
  const segments = doc.segments()
  const texts = segments.map((segment) => segment.text)
  for (const key of [ID_CARD, NAME, 'zhang.san@example.com', PHONE]) assert.ok(texts.includes(key), `key not exposed: ${key}; got ${JSON.stringify(texts)}`)
  for (const key of ['patient_name', 'ITM_VLU', '12', '诊断']) {
    // "诊断" is exposed (Chinese text can be a name) but plain keys are not.
    if (key === '诊断') continue
    assert.ok(!texts.includes(key), `plain key exposed: ${key}`)
  }
  const phoneKey = segments.find((segment) => segment.text === PHONE)
  assert.equal(phoneKey.field, 'records·键名')
  // Key ids never collide with value ids.
  assert.equal(new Set(segments.map((segment) => segment.id)).size, segments.length)
})

await check('#30 JSON 键名：替换后键被改名，顺序不变，子值的字段与提示不受影响', async () => {
  const raw = `{\n  "${PHONE}": {"电话": "${PHONE2}", "诊断": "高血压"},\n  "other": 1\n}\n`
  const doc = await docFor('r.json', raw)
  const before = doc.segments().find((segment) => segment.text === PHONE2)
  assert.equal(before.hint, '电话')
  assert.equal(replaceEverywhere(doc, PHONE, '电话-AAAAAA'), 1)
  const after = doc.segments().find((segment) => segment.text === PHONE2)
  assert.equal(after.hint, '电话')
  assert.equal(after.field, before.field)
  assert.equal(after.id, before.id)
  const structure = doc.structure()
  assert.equal(structure.ok, true, JSON.stringify(structure))
  const out = doc.serialize()
  assert.equal(out, raw.replace(PHONE, '电话-AAAAAA'))
  assert.deepEqual(Object.keys(JSON.parse(out)), ['电话-AAAAAA', 'other'])
  assert.deepEqual(doc.renamedFields(), [[PHONE, '电话-AAAAAA']])
})

await check('#30 JSON 键名：改名与已有键冲突时加后缀，不丢成员', async () => {
  const raw = '{"138****8000": 1, "13800138000": 2, "13800148000": 3}'
  const doc = await docFor('c.json', raw, { layer: false })
  const segments = doc.segments()
  const list = ['13800138000', '13800148000'].map((text) => {
    const segment = segments.find((item) => item.text === text)
    return { id: segment.id, start: 0, end: 11, original: text, replacement: '138****8000' }
  })
  assert.equal(doc.apply(list), 2)
  const out = doc.serialize()
  const parsed = JSON.parse(out)
  assert.equal(Object.keys(parsed).length, 3, out)
  assert.deepEqual(Object.values(parsed), [1, 2, 3])
  assert.ok(!out.includes('13800138000') && !out.includes('13800148000'), out)
  assert.equal(doc.structure().ok, true, JSON.stringify(doc.structure()))
})

await check('#30 JSON：重复键的每一份值都被检查和替换', async () => {
  const raw = `{"电话": "${PHONE}", "电话": "${PHONE2}"}`
  const doc = await docFor('d.json', raw)
  const texts = doc.segments().map((segment) => segment.text)
  assert.ok(texts.includes(PHONE) && texts.includes(PHONE2), JSON.stringify(texts))
  replaceEverywhere(doc, PHONE, '电话-1')
  replaceEverywhere(doc, PHONE2, '电话-2')
  const out = doc.serialize()
  assert.equal(out, '{"电话": "电话-1", "电话": "电话-2"}')
})

await check('#30 端到端：键中的身份证号、电话、姓名不原样交付，报告不含原值', async () => {
  const data = {
    [ID_CARD]: { 姓名: NAME, 诊断: '高血压' },
    patients: { [PHONE]: { 年龄: 40, 备注: '复诊' } },
    byName: { [NAME]: { 诊断: '糖尿病' } },
  }
  const { run, out, records } = await batch('e30', { 'a.json': JSON.stringify(data, null, 2) })
  const text = await readFile(outJoin(out, 'a.json'), 'utf8')
  for (const secret of [ID_CARD, PHONE, NAME]) assert.ok(!text.includes(secret), `output still contains ${secret}:\n${text}`)
  const parsed = JSON.parse(text)
  assert.equal(Object.keys(parsed).length, 3)
  assert.deepEqual(Object.keys(parsed).slice(1), ['patients', 'byName'])
  assert.equal(Object.values(parsed)[0].诊断, '高血压')
  const file = run.files.find((item) => item.relPath === 'a.json')
  assert.equal(file.structure?.ok, true, JSON.stringify(file.structure))
  for (const name of ['report.json', 'report.md']) {
    const report = await readFile(join(records, name), 'utf8')
    for (const secret of [ID_CARD, PHONE]) assert.ok(!report.includes(secret), `${name} contains ${secret}`)
  }
})

await check('#30 内嵌 JSON 键名：替换后键被改名，字段标签改名记录在 renamedFields', async () => {
  const payload = `{"${PHONE}":"复诊","${ID_CARD}":{"备注":"无"},"plain_key":1}`
  const doc = await docFor('e.json', JSON.stringify({ 记录: payload }))
  const texts = doc.segments().map((segment) => segment.text)
  assert.ok(texts.includes(PHONE) && texts.includes(ID_CARD), JSON.stringify(texts))
  assert.ok(!texts.includes('plain_key'), JSON.stringify(texts))
  replaceEverywhere(doc, PHONE, '电话-AAAAAA')
  replaceEverywhere(doc, ID_CARD, '身份证-BBBBBB')
  assert.equal(doc.structure().ok, true, JSON.stringify(doc.structure()))
  const out = JSON.parse(JSON.parse(doc.serialize()).记录)
  assert.deepEqual(Object.keys(out), ['电话-AAAAAA', '身份证-BBBBBB', 'plain_key'])
  assert.deepEqual(new Map(doc.renamedFields()), new Map([[PHONE, '电话-AAAAAA'], [ID_CARD, '身份证-BBBBBB']]))
})

await check('#30 端到端：内嵌 JSON 中以标识符为键的字段标签不出现在报告中', async () => {
  // The value under the phone key keeps a pseudonym inside a longer run, so
  // the file gets an issue labelled with that key's field.
  const payload = JSON.stringify({ [PHONE]: `x${PHONE2}y`, 其他: '无' })
  const files = {
    'a.json': JSON.stringify({ 记录: payload }, null, 2),
    'b.csv': `姓名,数据\r\n${NAME},"${payload.replace(/"/g, '""')}"\r\n`,
  }
  const { run, out, records } = await batch('e30b', files)
  for (const name of Object.keys(files)) {
    const text = await readFile(outJoin(out, name), 'utf8')
    for (const secret of [PHONE, PHONE2]) assert.ok(!text.includes(secret), `${name} delivered ${secret}`)
  }
  assert.ok(run.files.some((file) => (file.issues ?? []).length > 0), 'expected an issue labelled with the key field')
  for (const name of ['report.json', 'report.md']) {
    const report = await readFile(join(records, name), 'utf8')
    for (const secret of [PHONE, PHONE2]) assert.ok(!report.includes(secret), `${name} contains ${secret}`)
  }
})

/* ----------------------------------------------------- #31 lossless JSON */

const FORMATTED = `{
    "id": 110101199003071234,
    "name" : "${NAME}",
    "dose": 1.0,
    "count": 1e5,
    "neg": -0,
    "unicode": "\\u60a3\\u8005",
    "slash": "a\\/b",
    "list": [ 1, 2.50, 3 ]
}`

await check('#31 JSON：未改动时逐字节原样输出（大整数、缩进、数字写法、转义）', async () => {
  const doc = await docFor('f.json', FORMATTED)
  assert.equal(doc.serialize(), FORMATTED)
  assert.equal(doc.structure().ok, true)
})

await check('#31 JSON：改写一个值时其余文本逐字节不变', async () => {
  const doc = await docFor('g.json', FORMATTED)
  assert.equal(replaceEverywhere(doc, NAME, '化名-ABCDEF'), 1)
  assert.equal(doc.serialize(), FORMATTED.replace(NAME, '化名-ABCDEF'))
  assert.equal(doc.structure().ok, true, JSON.stringify(doc.structure()))
})

await check('#31 JSON：全 ASCII 转义的文件写回时保持转义风格', async () => {
  const raw = '{"name": "\\u5f20\\u4e09", "note": "\\u590d\\u8bca", "big": 110101199003071234}'
  const doc = await docFor('h.json', raw)
  assert.ok(doc.segments().some((segment) => segment.text === NAME))
  assert.equal(replaceEverywhere(doc, NAME, '化名-ABCDEF'), 1)
  const out = doc.serialize()
  assert.ok(!/[^\x00-\x7f]/.test(out), out)
  assert.equal(JSON.parse(out).name, '化名-ABCDEF')
  assert.ok(out.includes('"note": "\\u590d\\u8bca"'), out)
  assert.ok(out.includes('110101199003071234'), out)
})

await check('#31 端到端：大整数与原有排版不被改动', async () => {
  const raw = `{\n    "姓名": "${NAME}",\n    "orderId": 110101199003071234,\n    "dose": 1.0\n}\n`
  const { out } = await batch('e31', { 'b.json': raw })
  const text = await readFile(outJoin(out, 'b.json'), 'utf8')
  assert.ok(!text.includes(NAME), text)
  assert.ok(text.includes('"orderId": 110101199003071234'), text)
  assert.ok(text.includes('\n    "dose": 1.0\n}\n'), text)
})

/* ----------------------------------------------------- #32 xlsx formats */

function formattedWorkbook() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['姓名', '入院日期', '费用', '比例', '编码', '出生日期'],
    [NAME, 45000.33333, 1234.5, 0.25, '00123', 20000],
    ['李四', 45001, 99, 0.5, '00456', 21000],
  ])
  ws.B2.z = 'm/d/yy'
  ws.B3.z = 'yyyy-mm-dd hh:mm'
  ws.C2.z = '#,##0.00'
  ws.D2.z = '0.00%'
  ws.E2.z = '@'
  ws.F2.z = 'yyyy"年"m"月"d"日"'
  ws['!cols'] = [{ wch: 20 }, { wch: 16 }]
  ws['!rows'] = [{ hpt: 30 }, undefined, { hidden: true }]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, ws, '住院')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}

function assertFormats(buffer) {
  const book = XLSX.read(buffer, { type: 'buffer', cellNF: true, cellStyles: true })
  const sheet = book.Sheets[book.SheetNames[0]]
  assert.equal(sheet.B2.z, 'm/d/yy')
  assert.equal(sheet.B2.v, 45000.33333)
  assert.equal(sheet.B2.w, '3/15/23')
  assert.equal(sheet.B3.z, 'yyyy-mm-dd hh:mm')
  assert.equal(sheet.C2.z, '#,##0.00')
  assert.equal(sheet.D2.z, '0.00%')
  assert.equal(sheet.E2.z, '@')
  assert.equal(sheet.F2.z, 'yyyy"年"m"月"d"日"')
  assert.equal(sheet['!cols']?.[0]?.wch, 20)
  assert.equal(sheet['!rows']?.[2]?.hidden, true)
  return sheet
}

await check('#32 XLSX：数字格式（日期、金额、百分比、文本）、列宽、隐藏行原样写回', async () => {
  const doc = await docFor('a.xlsx', formattedWorkbook())
  assert.ok(replaceEverywhere(doc, NAME, '化名-ABCDEF') >= 1)
  const structure = doc.structure()
  assert.equal(structure.ok, true, JSON.stringify(structure))
  assert.ok(structure.checks.some((item) => item.name === '数字格式' && item.ok), JSON.stringify(structure))
  const sheet = assertFormats(doc.serialize())
  assert.equal(sheet.A2.v, '化名-ABCDEF')
})

await check('#32 XLSX：未改动的工作簿写回也保留日期格式', async () => {
  const doc = await docFor('b.xlsx', formattedWorkbook())
  assertFormats(doc.serialize())
})

await check('#32 端到端：交付的工作簿中日期列仍显示为日期', async () => {
  const { out } = await batch('e32', { 'c.xlsx': formattedWorkbook() })
  const sheet = assertFormats(await readFile(outJoin(out, 'c.xlsx')))
  assert.notEqual(sheet.A2.v, NAME)
})

/**
 * A workbook as Chinese Excel writes it: date cells use the locale's
 * built-in formats (numFmtId 27-36, 50-58) with no <numFmt> entry.
 */
const CJK_IDS = { B2: 31, C2: 58, D2: 27, E2: 32, F2: 57, G2: 56 }
function cjkWorkbook({ prefix = '', emptyNumFmts = false } = {}) {
  const ws = XLSX.utils.aoa_to_sheet([
    ['姓名', '入院日期', '月日', '年月', '时间', '出院年月', '时刻', '电话'],
    [NAME, 45000, 45000, 45000, 0.6, 45001, 0.75, PHONE],
    ['李四', 45002, 45002, 45002, 0.25, 45003, 0.5, PHONE2],
  ])
  // Unique placeholder formats, swapped for the built-in ids below.
  const markers = {}
  Object.keys(CJK_IDS).forEach((addr, index) => {
    const code = `0.${'0'.repeat(index + 3)}`
    markers[code] = CJK_IDS[addr]
    ws[addr].z = code
    ws[addr.replace('2', '3')].z = code
  })
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, ws, '住院')
  const zip = XLSX.CFB.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
  const entry = XLSX.CFB.find(zip, '/xl/styles.xml')
  let xml = Buffer.from(entry.content).toString('utf8')
  for (const [code, id] of Object.entries(markers)) {
    const custom = xml.match(new RegExp(`<numFmt numFmtId="(\\d+)" formatCode="${code.replace('.', '\\.')}"/>`))
    xml = xml.replace(custom[0], '').replace(new RegExp(`<xf numFmtId="${custom[1]}"`, 'g'), `<xf numFmtId="${id}"`)
  }
  // No numFmt entry for any of the ids used (56 included).
  xml = xml.replace(/<numFmt numFmtId="56"[^>]*\/>/, '')
  if (emptyNumFmts) xml = xml.replace(/<numFmts[^>]*>\s*<\/numFmts>/, '<numFmts count="0"/>')
  else xml = xml.replace(/<numFmts[^>]*>\s*<\/numFmts>/, '')
  if (prefix) xml = xml.replace(/<(\/?)(\w)/g, (whole, slash, first) => (whole.startsWith('<?') ? whole : `<${slash}${prefix}${first}`)).replace('xmlns=', `xmlns:${prefix.slice(0, -1)}=`)
  entry.content = Buffer.from(xml, 'utf8')
  entry.size = entry.content.length
  return XLSX.CFB.write(zip, { fileType: 'zip', type: 'buffer' })
}

/** numFmtId of each cell, read from the raw parts. */
function cellFormatIds(buffer) {
  const zip = XLSX.CFB.read(buffer, { type: 'buffer' })
  const text = (path) => Buffer.from(XLSX.CFB.find(zip, path).content).toString('utf8')
  const styles = text('/xl/styles.xml')
  const xfs = [...(styles.match(/<(?:\w+:)?cellXfs[\s\S]*?<\/(?:\w+:)?cellXfs>/)[0].matchAll(/<(?:\w+:)?xf\b[^>]*?numFmtId="(\d+)"/g))].map((m) => Number(m[1]))
  const codes = new Map([...styles.matchAll(/<(?:\w+:)?numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), m[2].replace(/&quot;/g, '"')]))
  const out = {}
  for (const m of text('/xl/worksheets/sheet1.xml').matchAll(/<(?:\w+:)?c r="([A-Z]+\d+)"([^>]*)>/g)) {
    const s = m[2].match(/\ss="(\d+)"/)
    const id = s ? xfs[Number(s[1])] : 0
    out[m[1]] = { id, code: codes.get(id) ?? null }
  }
  return out
}

const CJK_CODES = { 27: 'yyyy"年"m"月"', 31: 'yyyy"年"m"月"d"日"', 32: 'h"时"mm"分"', 56: '上午/下午h"时"mm"分"ss"秒"', 57: 'yyyy"年"m"月"', 58: 'm"月"d"日"' }

/** Each cell still has a date/time format that reads the same in Chinese Excel. */
function assertCjkFormats(buffer) {
  const ids = cellFormatIds(buffer)
  for (const [addr, original] of Object.entries(CJK_IDS)) {
    for (const cell of [addr, addr.replace('2', '3')]) {
      const { id, code } = ids[cell]
      assert.notEqual(id, 0, `${cell} lost its number format (General)`)
      // Either the same locale-dependent built-in, or the zh-CN meaning spelled out.
      const ok = (id === original && code === null) || code === CJK_CODES[original] || (code === null && CJK_CODES[id] === CJK_CODES[original])
      assert.ok(ok, `${cell}: was built-in ${original}, now id ${id} code ${code}`)
    }
  }
}

await check('#32 XLSX：中文 Excel 内置日期格式（numFmtId 27-36、50-58）读入为已知格式', async () => {
  const doc = await docFor('cjk.xlsx', cjkWorkbook(), { layer: false })
  assert.equal(doc.structure().ok, true, JSON.stringify(doc.structure()))
  assertCjkFormats(doc.serialize())
})

for (const variant of [{}, { emptyNumFmts: true }, { prefix: 'x:' }]) {
  await check(`#32 XLSX：中文内置日期格式在替换后写回不变成序列号 ${JSON.stringify(variant)}`, async () => {
    const doc = await docFor('cjk.xlsx', cjkWorkbook(variant))
    assert.ok(replaceEverywhere(doc, NAME, '化名-ABCDEF') >= 1)
    const structure = doc.structure()
    assert.equal(structure.ok, true, JSON.stringify(structure))
    assertCjkFormats(doc.serialize())
  })
}

await check('#32 XLSX：数字格式检查能发现中文内置日期格式丢失', async () => {
  const doc = await docFor('cjk.xlsx', cjkWorkbook(), { layer: false })
  // Simulate a writer that drops the format of an untouched date cell.
  const original = doc.serialize
  doc.serialize = function () {
    const book = XLSX.read(original.call(this), { type: 'buffer', cellNF: true, cellStyles: true })
    delete book.Sheets[book.SheetNames[0]].B2.z
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  }
  const formats = doc.structure().checks.find((item) => item.name === '数字格式')
  assert.equal(formats?.ok, false, JSON.stringify(doc.structure()))
})

await check('#32 端到端：中文 Excel 的日期列交付后仍显示为日期', async () => {
  const { run, out } = await batch('e32cjk', { 'cjk.xlsx': cjkWorkbook() })
  const file = run.files.find((item) => item.relPath === 'cjk.xlsx')
  assert.equal(file.structure?.ok, true, JSON.stringify(file.structure))
  const buffer = await readFile(outJoin(out, 'cjk.xlsx'))
  assertCjkFormats(buffer)
  const sheet = XLSX.read(buffer, { type: 'buffer' }).Sheets['住院']
  assert.notEqual(sheet.A2.v, NAME)
  assert.equal(sheet.B2.v, 45000)
})

/* ----------------------------------------- #17 key rename and exposure */

await check('#17 内嵌 JSON：键改名不改变短整数是否暴露，编码还原检查通过', async () => {
  for (const [key, pseudonym] of [[PHONE, '电话-4A0380'], [PHONE2, '医生-ABCDEF'], ['zhang.san@example.com', '邮箱-123456'], [ID_CARD, '地址-0A0B0C'], [NAME, '医院-FFFFFF'], [PHONE, '[电话]']]) {
    const doc = await docFor('k.json', JSON.stringify({ payload: `{"${key}": 42, "k": 1, "list": {"${key}": [7, 8]}}` }))
    assert.ok(replaceEverywhere(doc, key, pseudonym) >= 1)
    const structure = doc.structure()
    assert.equal(structure.ok, true, `${pseudonym}: ${JSON.stringify(structure)}`)
    const out = JSON.parse(JSON.parse(doc.serialize()).payload)
    assert.deepEqual(out, { [pseudonym]: 42, k: 1, list: { [pseudonym]: [7, 8] } })
  }
})

await check('#17 内嵌 JSON：键改名失去提示时短整数仍按原样写回，检查通过', async () => {
  // "住院号" hints its value; a key renamed away from a hint must not fail either.
  const doc = await docFor('k2.json', JSON.stringify({ payload: `{"${NAME}住院号": 573, "其他": 2}` }))
  assert.ok(doc.segments().some((segment) => segment.text === '573'))
  assert.ok(replaceEverywhere(doc, `${NAME}住院号`, '化名-ABCDEF') >= 1)
  assert.equal(doc.structure().ok, true, JSON.stringify(doc.structure()))
  assert.equal(JSON.parse(doc.serialize()).payload, '{"化名-ABCDEF": 573, "其他": 2}')
})

await check('#17 端到端：CSV 内嵌 JSON 以电话为键的计数，交付且不被扣留', async () => {
  const csv = `患者,随访次数\n1,"{""${PHONE}"":2,""${PHONE2}"":5}"\n`
  const { run, out } = await batch('e17k', { 'a.csv': csv })
  const file = run.files.find((item) => item.relPath === 'a.csv')
  assert.equal(file.structure?.ok, true, JSON.stringify(file.structure))
  assert.notEqual(run.withheld, true)
  const text = await readFile(outJoin(out, 'a.csv'), 'utf8')
  for (const secret of [PHONE, PHONE2]) assert.ok(!text.includes(secret), text)
  assert.match(text, /"":2,""/)
  assert.match(text, /"":5\}"/)
})

/* ----------------------------------------------------- #50 CSV line ends */

await check('#50 CSV：CRLF 换行与结尾换行保留', async () => {
  const raw = `姓名,备注\r\n${NAME},无\r\n李四,"多行\n备注"\r\n`
  const doc = await docFor('a.csv', raw)
  assert.equal(doc.serialize(), raw, 'untouched CSV must round-trip byte for byte')
  assert.equal(replaceEverywhere(doc, NAME, '化名-ABCDEF'), 1)
  assert.equal(doc.serialize(), raw.replace(NAME, '化名-ABCDEF'))
})

await check('#50 CSV：无结尾换行、混合换行、CR、结尾空行均保留', async () => {
  for (const raw of [
    `姓名,备注\r\n${NAME},无`,
    `姓名,备注\n${NAME},无\r\n李四,有\n`,
    `姓名,备注\r${NAME},无\r`,
    `姓名,备注\n${NAME},无\n\n`,
    `姓名,备注\r\n${NAME},无\r\n\r\n`,
    `﻿姓名,备注\r\n${NAME},"引号""内"\r\n`,
  ]) {
    const doc = await docFor('b.csv', raw)
    assert.equal(doc.serialize(), raw, `round-trip changed ${JSON.stringify(raw)}`)
    replaceEverywhere(doc, NAME, '化名-ABCDEF')
    assert.equal(doc.serialize(), raw.replace(NAME, '化名-ABCDEF'), JSON.stringify(raw))
    assert.equal(doc.structure().ok, true)
  }
})

await check('#50 端到端：Windows CSV 交付后仍是 CRLF', async () => {
  const raw = `姓名,联系电话,备注\r\n${NAME},${PHONE},无\r\n`
  const { out } = await batch('e50', { 'crlf.csv': raw })
  const text = await readFile(outJoin(out, 'crlf.csv'), 'utf8')
  assert.ok(!text.includes(NAME) && !text.includes(PHONE), text)
  assert.equal(text.split('\r\n').length, 3, JSON.stringify(text))
  assert.ok(!/[^\r]\n/.test(text), JSON.stringify(text))
  assert.ok(text.endsWith('\r\n'))
})

await rm(tmp, { recursive: true, force: true })
if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nFIX2-FORMATS PASS')
