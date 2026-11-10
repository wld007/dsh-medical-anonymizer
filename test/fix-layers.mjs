/**
 * Layered content regressions (code review #1, #2, #3):
 *  #1 write-back of edits in exploded text chunks (url, \u escapes, data:
 *     URIs) must reach the file, and a refused write-back must not leave the
 *     layer showing replacements the file does not contain;
 *  #2 numeric HL7 components (MRN, phone, ID card, DOB) are inspected;
 *  #3 markup attribute values (href, src, CDA extension, ...) are inspected
 *     and replacing inside them keeps the markup valid.
 * Round 2 (review of the fix): removing a line-wrapped data: URI keeps the
 * value decodable (R1); a replacement that moves a value into the class a
 * decoder leaves in the template (date "1980", short number) passes the
 * structure check (R2); short numbers in identifier attributes are
 * inspected (R3).
 * Run: node test/fix-layers.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDocument } from '../lib/formats.js'
import { layered, explode } from '../lib/layers.js'
import { runBatch } from '../lib/pipeline.js'
import { outDirOf, outJoin } from './outputs.mjs'

const tmp = join(dirname(fileURLToPath(import.meta.url)), '.tmp', 'fix-layers')
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

const PSEUDO = '化名-BBBBBB'
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(160, 7)]).toString('base64')
const uesc = (text) => [...text].map((ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')

let counter = 0
async function openFile(name, content) {
  counter += 1
  const rel = `${counter}-${name}`
  const path = join(tmp, rel)
  await writeFile(path, content)
  return { path, rel, doc: layered(await loadDocument(path, rel)) }
}

/** Replace every occurrence of each `from` in every segment. */
function replaceAll(doc, pairs) {
  const replacements = []
  for (const segment of doc.segments()) {
    for (const [from, to] of pairs) {
      let at = segment.text.indexOf(from)
      while (at >= 0) {
        replacements.push({ id: segment.id, start: at, end: at + from.length, original: from, replacement: to })
        at = segment.text.indexOf(from, at + from.length)
      }
    }
  }
  replacements.sort((a, b) => b.start - a.start)
  return doc.apply(replacements)
}

/** What the layer shows must be exactly what the serialized file contains. */
async function assertConsistent(doc, rel) {
  const outPath = join(tmp, `${rel}.again${rel.slice(rel.lastIndexOf('.'))}`)
  await writeFile(outPath, doc.serialize())
  const again = layered(await loadDocument(outPath, rel))
  assert.deepEqual(again.segments().map((segment) => segment.text), doc.segments().map((segment) => segment.text), 'layer view differs from serialized file')
  assert.deepEqual(again.leaves().map((leaf) => leaf.text), doc.leaves().map((leaf) => leaf.text), 'leaves() differ from serialized file')
}

/* ------------------------------------------------------------------ #1 */

await check('#1 txt：URL 编码行 + 另一行的姓名，替换写回文件，URL 行逐字节不变', async () => {
  const content = '姓名：张三\n报告链接：http://his.local/report?dept=%E5%BF%83%E5%86%85\n'
  const { doc, rel } = await openFile('url.txt', content)
  assert.ok(doc.segments().some((segment) => segment.text.includes('张三')))
  assert.equal(replaceAll(doc, [['张三', PSEUDO]]), 1)
  const out = doc.serialize()
  assert.ok(!out.includes('张三'), out)
  assert.ok(out.includes(PSEUDO))
  assert.equal(out.split('\n')[1], content.split('\n')[1], 'url line was re-encoded')
  assert.ok(doc.structure().ok, JSON.stringify(doc.structure().checks))
  await assertConsistent(doc, rel)
})

await check('#1 txt：URL 里编码的姓名 + 原样中文行 + 多行修改，全部写回且未改动行不变', async () => {
  const lines = [
    '患者张三，男，45岁。',
    `链接：http://his.local/q?n=${encodeURIComponent('张三')}&d=${encodeURIComponent('心内科')}&p=13800138000`,
    '其他中文说明，不应被转义。',
    '联系电话：13800138000',
    '',
  ]
  const { doc, rel } = await openFile('urlmulti.txt', lines.join('\n'))
  assert.ok(replaceAll(doc, [['张三', PSEUDO], ['13800138000', '138****8000']]) >= 3)
  const out = doc.serialize()
  for (const secret of ['张三', encodeURIComponent('张三'), '13800138000']) assert.ok(!out.includes(secret), `${secret} survived: ${out}`)
  const outLines = out.split('\n')
  assert.equal(outLines.length, lines.length)
  assert.equal(outLines[2], lines[2])
  assert.ok(outLines[1].includes(`d=${encodeURIComponent('心内科')}`), outLines[1])
  assert.ok(outLines[1].includes(encodeURIComponent('化名')), `new text in an encoded value is encoded: ${outLines[1]}`)
  assert.ok(doc.structure().ok, JSON.stringify(doc.structure().checks))
  await assertConsistent(doc, rel)
})

await check('#1 txt：data:image URI 与分处两行的姓名、电话一起替换', async () => {
  const content = `检查报告\n姓名：张三\n影像：data:image/png;base64,${PNG}\n电话：13800138000\n结论：未见异常\n`
  const { doc, rel } = await openFile('datauri.txt', content)
  assert.equal(replaceAll(doc, [['张三', PSEUDO], ['13800138000', '138****8000']]), 2)
  const out = doc.serialize()
  assert.ok(!out.includes('张三') && !out.includes('13800138000'), out)
  assert.ok(out.includes(PNG), 'image run changed')
  assert.equal(out.split('\n').length, content.split('\n').length)
  await assertConsistent(doc, rel)
})

await check('#1 txt：data:image URI 在行末，移除图片后行数不变', async () => {
  const content = `姓名：张三\n影像：data:image/png;base64,${PNG}\n电话：13800138000\n`
  const { doc, rel } = await openFile('dataend.txt', content)
  assert.equal(doc.removeOpaque(), 1)
  assert.equal(replaceAll(doc, [['张三', PSEUDO]]), 1)
  const out = doc.serialize()
  assert.ok(!out.includes(PNG) && !out.includes('张三'), out)
  assert.equal(out.split('\n').length, content.split('\n').length, out)
  assert.ok(doc.structure().ok, JSON.stringify(doc.structure().checks))
  await assertConsistent(doc, rel)
})

await check('#1 txt：\\uXXXX 转义行 + 原样中文行，转义里的姓名也被替换', async () => {
  const lines = ['姓名：张三', `备注："${uesc('患者张三来访')}"`, '诊断：高血压，规律服药。', `电话：${uesc('电话')}13800138000`, '']
  const { doc, rel } = await openFile('uesc.txt', lines.join('\n'))
  assert.ok(doc.segments().some((segment) => segment.text.includes('患者张三来访')))
  assert.ok(replaceAll(doc, [['张三', PSEUDO], ['13800138000', '138****8000']]) >= 3)
  const out = doc.serialize()
  for (const secret of ['张三', uesc('张三'), '13800138000']) assert.ok(!out.includes(secret), `${secret} survived: ${out}`)
  const outLines = out.split('\n')
  assert.equal(outLines[2], lines[2], 'plain line re-encoded')
  assert.ok(outLines[1].includes(uesc('患者')) && outLines[1].includes(uesc('来访')), outLines[1])
  assert.ok(doc.structure().ok, JSON.stringify(doc.structure().checks))
  await assertConsistent(doc, rel)
})

await check('#1 txt：同一行两处修改 + 其他行修改', async () => {
  const content = `张三与张三的家属李四到院。\n回访：${encodeURIComponent('李四')}%20${encodeURIComponent('张三')}\n备注无。\n`
  const { doc, rel } = await openFile('sameline.txt', content)
  assert.ok(replaceAll(doc, [['张三', PSEUDO], ['李四', '化名-CCCCCC']]) >= 5)
  const out = doc.serialize()
  for (const secret of ['张三', '李四', encodeURIComponent('张三'), encodeURIComponent('李四')]) assert.ok(!out.includes(secret), `${secret} survived: ${out}`)
  assert.equal(out.split('\n')[2], '备注无。')
  await assertConsistent(doc, rel)
})

await check('#1 txt：纯插入与纯删除（替换值包含原值、替换为空）也能写回', async () => {
  const content = `患者张三\n链接：http://x/?a=${encodeURIComponent('心内')}&b=${encodeURIComponent('病区')}\n家属李四\n`
  const { doc, rel } = await openFile('insdel.txt', content)
  assert.equal(replaceAll(doc, [['张三', '张三某'], ['李四', '']]), 2)
  const out = doc.serialize()
  assert.equal(out, content.replace('张三', '张三某').replace('李四', ''))
  await assertConsistent(doc, rel)
})

await check('#1 CSV：多行单元格里有 URL 编码，两行的修改都写回', async () => {
  const cell = `姓名：张三\n链接：http://x/?a=${encodeURIComponent('心内')}&b=${encodeURIComponent('病区')}\n电话：13800138000`
  const csv = `id,note\n1,"${cell}"\n`
  const { doc, rel } = await openFile('cell.csv', csv)
  assert.ok(replaceAll(doc, [['张三', PSEUDO], ['13800138000', '138****8000']]) >= 2)
  const out = doc.serialize()
  assert.ok(!out.includes('张三') && !out.includes('13800138000'), out)
  assert.ok(out.includes(encodeURIComponent('心内')), out)
  // The cell keeps its own line breaks (no %0A, no re-encoded raw text).
  assert.ok(!out.includes('%0A') && out.includes('\n链接：http://x/?a=') && out.includes('\n电话：138****8000'), out)
  await assertConsistent(doc, rel)
})

await check('#1 写回被拒时：层内状态恢复，其他字段照常写回，并报错', async () => {
  const path = join(tmp, 'refuse.json')
  const value = (name) => `姓名：${name}\n链接：http://x/?a=${encodeURIComponent('心内')}&b=${encodeURIComponent('病区')}&c=${encodeURIComponent('三楼')}`
  await writeFile(path, JSON.stringify([{ A: value('张三'), B: value('王五') }], null, 2))
  const real = await loadDocument(path, 'refuse.json')
  // A base that refuses every write to field A.
  const base = { ...real, segments: () => real.segments(), serialize: () => real.serialize(), structure: () => real.structure(),
    apply: (list) => real.apply(list.filter((item) => !item.id.endsWith('A'))) }
  const doc = layered(base)
  const before = doc.segments().map((segment) => segment.text)
  const leavesBefore = doc.leaves().map((leaf) => leaf.text)
  assert.ok(before.some((text) => text.includes('张三')) && before.some((text) => text.includes('王五')))
  assert.throws(() => replaceAll(doc, [['张三', PSEUDO], ['王五', '化名-DDDDDD']]), /写回编码内容失败/)
  const out = JSON.parse(doc.serialize())[0]
  assert.ok(out.A.includes('张三'), 'refused field changed')
  assert.ok(!out.B.includes('王五') && out.B.includes('化名-DDDDDD'), `other field not written: ${out.B}`)
  const after = doc.segments().map((segment) => segment.text)
  assert.ok(after.some((text) => text.includes('张三')), 'layer shows a replacement the file does not contain')
  assert.ok(!after.some((text) => text.includes('王五')))
  assert.deepEqual(doc.leaves().map((leaf) => leaf.text).filter((text) => text.includes('张三')), leavesBefore.filter((text) => text.includes('张三')))
  // A later attempt works on the restored text.
  assert.throws(() => replaceAll(doc, [['张三', PSEUDO]]), /写回编码内容失败/)
  assert.ok(doc.segments().some((segment) => segment.text.includes('张三')))
})

await check('#1 写回被拒时（逐区写回中途失败）：已写入的区域被撤回', async () => {
  const path = join(tmp, 'partial.json')
  await writeFile(path, JSON.stringify([{ A: `张三\n${encodeURIComponent('心内科病区')}\n李四` }], null, 2))
  const real = await loadDocument(path, 'partial.json')
  let calls = 0
  const base = { ...real, segments: () => real.segments(), serialize: () => real.serialize(), structure: () => real.structure(),
    apply: (list) => { calls += 1; return calls === 2 ? 0 : real.apply(list) } }
  const doc = layered(base)
  const original = real.serialize()
  assert.throws(() => replaceAll(doc, [['张三', PSEUDO], ['李四', '化名-CCCCCC']]), /写回编码内容失败/)
  assert.equal(real.serialize(), original, 'partially written value left in the file')
  assert.ok(doc.segments().some((segment) => segment.text.includes('张三') && segment.text.includes('李四')))
})

await check('#1 端到端：txt 中 URL 编码 + 姓名，交付文件不含原值，批次未报写回失败', async () => {
  const input = join(tmp, 'e2e-url')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'a.txt'), `姓名：张三\n报告链接：http://his.local/report?dept=%E5%BF%83%E5%86%85&n=${encodeURIComponent('张三')}\n备注：${uesc('患者')}张三${uesc('复诊')}\n影像：data:image/png;base64,${PNG}\n电话：13800138000\n`)
  const run = await runBatch({ inputDir: input, outputRoot: join(tmp, 'e2e-url-out'), options: { runId: 'fix-layers-url' } })
  const file = run.files.find((item) => item.relPath === 'a.txt')
  assert.ok(!file.issues.some((issue) => /写回/.test(issue.detail)), JSON.stringify(file.issues))
  const out = await readFile(outJoin(await outDirOf(join(tmp, 'e2e-url-out'), 'fix-layers-url'), 'a.txt'), 'utf8')
  for (const secret of ['张三', encodeURIComponent('张三'), '13800138000']) assert.ok(!out.includes(secret), `${secret} delivered: ${out}`)
  assert.ok(out.includes('%E5%BF%83%E5%86%85'), out)
})

/* ------------------------------------------------------------------ #2 */

const HL7 = 'MSH|^~\\&|HIS|HOSP|LIS|HOSP|20240301120000||ADT^A01|MSG00001|P|2.5\r' +
  'PID|1||987654321^^^HOSP^MR||张三^^||19800101|M|||杭州市西湖区||13800138000|||||||110105194912310021\r' +
  'NK1|1|李四^^|父亲||13900139000\r' +
  'OBX|1|NM|GLU^血糖||120|mg/dL|70-110|H'

await check('#2 HL7：PID 中的病历号、电话、身份证号、出生日期都暴露给检测', async () => {
  const leaves = []
  const walk = (node) => { if (node.leaf) leaves.push(node); else if (node.children) node.children.forEach(walk) }
  walk(explode(HL7))
  const texts = leaves.map((leaf) => leaf.text)
  for (const value of ['987654321', '13800138000', '110105194912310021', '19800101', '13900139000', '张三', '李四']) {
    assert.ok(texts.includes(value), `${value} hidden: ${texts.join(',')}`)
  }
  const byText = Object.fromEntries(leaves.map((leaf) => [leaf.text, leaf]))
  assert.equal(byText['987654321'].hint, '病历号')
  assert.equal(byText['13800138000'].hint, '电话')
  assert.equal(byText['110105194912310021'].hint, '身份证号')
  assert.equal(byText['13900139000'].hint, '电话')
  assert.equal(byText['19800101'].quasi, '日期')
  // Short measurement values stay out of the way.
  assert.ok(!texts.includes('120') && !texts.includes('1'), texts.join(','))
})

await check('#2 HL7：在 JSON 字段里替换数字成分后结构不变、原值不留', async () => {
  const { doc, rel } = await openFile('hl7.json', JSON.stringify([{ ID: 'A1', MSG: HL7 }], null, 2))
  const segs = doc.segments()
  const dob = segs.find((segment) => segment.text === '19800101')
  assert.ok(dob, 'DOB not a segment')
  assert.equal(dob.quasi, '日期')
  assert.equal(segs.find((segment) => segment.text === '987654321')?.hint, '病历号')
  const pairs = [['987654321', 'MRN-000001'], ['13800138000', '138****8000'], ['110105194912310021', '[身份证号]'], ['19800101', '1980'], ['13900139000', '139****9000'], ['张三', PSEUDO]]
  assert.equal(replaceAll(doc, pairs), pairs.length)
  assert.ok(doc.structure().ok, JSON.stringify(doc.structure().checks))
  const out = JSON.parse(doc.serialize())[0].MSG
  for (const [secret] of pairs) assert.ok(!out.includes(secret), `${secret} survived: ${out}`)
  assert.equal(out.split('\r').length, 4)
  assert.equal(out.split('\r')[1].split('|').length, HL7.split('\r')[1].split('|').length)
  assert.ok(out.includes('|MRN-000001^^^HOSP^MR|'), out)
  assert.ok(out.endsWith('OBX|1|NM|GLU^血糖||120|mg/dL|70-110|H'), out)
  await assertConsistent(doc, rel)
})

await check('#2 端到端：JSON 中的 HL7 消息，交付文件不含病历号、电话、身份证号', async () => {
  const input = join(tmp, 'e2e-hl7')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'msg.json'), JSON.stringify([{ ID: 'A1', MSG: HL7 }], null, 2))
  await runBatch({ inputDir: input, outputRoot: join(tmp, 'e2e-hl7-out'), options: { runId: 'fix-layers-hl7' } })
  const out = await readFile(outJoin(await outDirOf(join(tmp, 'e2e-hl7-out'), 'fix-layers-hl7'), 'msg.json'), 'utf8')
  for (const secret of ['987654321', '13800138000', '110105194912310021', '13900139000']) assert.ok(!out.includes(secret), `${secret} delivered: ${out}`)
  assert.ok(JSON.parse(out)[0].MSG.startsWith('MSH|^~\\&|'))
  // With the date policy on, the PID-7 birth date is processed too.
  await runBatch({ inputDir: input, outputRoot: join(tmp, 'e2e-hl7-quasi'), options: { runId: 'fix-layers-hl7q', policy: { quasiIdentifiers: true, quasiPolicy: { date: 'year' } } } })
  const quasiOut = JSON.parse(await readFile(outJoin(await outDirOf(join(tmp, 'e2e-hl7-quasi'), 'fix-layers-hl7q'), 'msg.json'), 'utf8'))[0].MSG
  assert.ok(!quasiOut.includes('19800101'), quasiOut)
  assert.ok(quasiOut.includes('||1980|M|'), quasiOut)
})

/* ------------------------------------------------------------------ #3 */

function leafTexts(value) {
  const out = []
  const walk = (node) => {
    if (node.leaf) out.push(node.text)
    else if (node.children) node.children.forEach(walk)
  }
  walk(explode(value))
  return out
}

await check('#3 HTML：href/src/title 等属性值暴露，结构属性不暴露', async () => {
  const texts = leafTexts('<div class="card" style="color:red" id="c1"><span>联系方式：</span><a href="mailto:zhangsan@example.com">发邮件</a><a href="tel:13800138000" target="_blank">拨打</a>' +
    '<img src="http://his.local/photo?pid=987654321" width="120" height="80"/><a href=/p/110105194912310021>档案</a><input name="phone" value="13900139000"/></div>')
  for (const value of ['mailto:zhangsan@example.com', 'tel:13800138000', 'http://his.local/photo?pid=987654321', '/p/110105194912310021', '13900139000']) {
    assert.ok(texts.includes(value), `${value} hidden: ${JSON.stringify(texts)}`)
  }
  for (const value of ['card', 'color:red', 'c1', '_blank', '120', '80']) assert.ok(!texts.includes(value), `structural ${value} exposed`)
})

await check('#3 CDA：id 的 root/extension 暴露，代码系统等结构属性不暴露', async () => {
  const cda = '<?xml version="1.0" encoding="UTF-8"?><ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<recordTarget typeCode="RCT"><patientRole classCode="PAT"><id root="2.16.156.10011.1.3" extension="110105194912310021"/>' +
    '<id root="2.16.156.10011.1.12" extension="ZY20240301"/><patient classCode="PSN" determinerCode="INSTANCE"><name>张三</name>' +
    '<administrativeGenderCode code="1" codeSystem="2.16.156.10011.2.3.3.4" codeSystemName="生理性别代码表"/></patient></patientRole></recordTarget></ClinicalDocument>'
  const texts = leafTexts(cda)
  for (const value of ['110105194912310021', 'ZY20240301', '张三', '2.16.156.10011.1.3']) assert.ok(texts.includes(value), `${value} hidden: ${JSON.stringify(texts)}`)
  for (const value of ['urn:hl7-org:v3', 'RCT', 'PAT', 'PSN', 'INSTANCE', '2.16.156.10011.2.3.3.4']) assert.ok(!texts.includes(value), `structural ${value} exposed`)
})

await check('#3 属性内替换后标记仍有效：引号、&、<、无引号属性都正确转义', async () => {
  const html = '<html><body><p>病历</p><a href="mailto:zhangsan@example.com?subject=a&amp;b" title=\'张三的邮箱\'>邮件</a>' +
    '<a href=tel:13800138000>电话</a><img alt="患者张三" src="x.png"/></body></html>'
  const { doc, rel } = await openFile('attr.json', JSON.stringify([{ ID: 'A1', HTML: html }], null, 2))
  const segs = doc.segments().map((segment) => segment.text)
  assert.ok(segs.includes('mailto:zhangsan@example.com?subject=a&b'), JSON.stringify(segs))
  assert.ok(segs.includes('tel:13800138000'), JSON.stringify(segs))
  const n = replaceAll(doc, [['zhangsan@example.com', 'x"y\'<z>&w@example.com'], ['13800138000', '138 0000 "8000"'], ['张三', PSEUDO]])
  assert.ok(n >= 4, `applied ${n}`)
  assert.ok(doc.structure().ok, JSON.stringify(doc.structure().checks))
  const out = JSON.parse(doc.serialize())[0].HTML
  for (const secret of ['zhangsan@example.com', '13800138000', '张三']) assert.ok(!out.includes(secret), `${secret} survived: ${out}`)
  assert.ok(out.includes('href="mailto:x&quot;y\'&lt;z&gt;&amp;w@example.com?subject=a&amp;b"'), out)
  assert.ok(out.includes('title=\'化名-BBBBBB的邮箱\''), out)
  assert.ok(out.includes('href="tel:138 0000 &quot;8000&quot;">'), out)
  const again = leafTexts(out)
  assert.ok(again.includes('tel:138 0000 "8000"'), JSON.stringify(again))
  assert.ok(again.includes('mailto:x"y\'<z>&w@example.com?subject=a&b'), JSON.stringify(again))
  await assertConsistent(doc, rel)
})

await check('#3 端到端：JSON 中的 HTML 与 CDA，交付文件不含属性里的邮箱、电话、身份证号', async () => {
  const input = join(tmp, 'e2e-attr')
  await mkdir(input, { recursive: true })
  // The rule pass alone (no model) only knows check-digit-valid ID numbers.
  await writeFile(join(input, 'doc.json'), JSON.stringify([{
    ID: 'A1',
    HTML: '<div>联系方式：<a href="mailto:zhangsan@example.com">发邮件</a><a href="tel:13800138000">拨打</a></div>',
    CDA: '<ClinicalDocument xmlns="urn:hl7-org:v3"><id root="2.16.156.10011.1.3" extension="11010519491231002X"/><name>病人</name></ClinicalDocument>',
  }], null, 2))
  await runBatch({ inputDir: input, outputRoot: join(tmp, 'e2e-attr-out'), options: { runId: 'fix-layers-attr' } })
  const out = await readFile(outJoin(await outDirOf(join(tmp, 'e2e-attr-out'), 'fix-layers-attr'), 'doc.json'), 'utf8')
  for (const secret of ['zhangsan@example.com', '13800138000', '11010519491231002X']) assert.ok(!out.includes(secret), `${secret} delivered: ${out}`)
  const parsed = JSON.parse(out)[0]
  assert.match(parsed.HTML, /^<div>联系方式：<a href="[^"<>]*">发邮件<\/a><a href="[^"<>]*">拨打<\/a><\/div>$/)
  assert.match(parsed.CDA, /^<ClinicalDocument xmlns="urn:hl7-org:v3"><id root="2\.16\.156\.10011\.1\.3" extension="[^"<>]*"\/>/)
})

/* ------------------------------------------- review of the fix (round 2) */

/** Every embedded value still decodes to the processed text. */
function assertStructure(doc) {
  const result = doc.structure()
  assert.ok(result.ok, JSON.stringify(result.checks.filter((check) => !check.ok)))
}

const BIG_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]).toString('base64')
const wrap76 = (b64, eol = '\n') => b64.match(/.{1,76}/g).join(eol)
const PDF_B64 = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 200)]).toString('base64')

/** Remove all opaque content: payload gone, values still decode, lines kept. */
async function removeAndCheck(name, content, { lines = true } = {}) {
  const { doc, rel } = await openFile(name, content)
  assert.ok(doc.opaque().length >= 1, 'payload not opaque')
  assert.ok(doc.removeOpaque() >= 1)
  assertStructure(doc)
  const out = String(doc.serialize())
  for (const payload of [BIG_PNG, PDF_B64]) {
    for (const line of wrap76(payload).split('\n').slice(0, -1)) assert.ok(!out.includes(line), `payload line survived: ${line}`)
  }
  if (lines) assert.equal(out.split('\n').length, content.split('\n').length, out)
  await assertConsistent(doc, rel)
  const again = layered(await loadDocument(join(tmp, `${rel}.again${rel.slice(rel.lastIndexOf('.'))}`), rel))
  assert.ok(again.opaque().length >= 1, 'placeholder no longer an embedded payload')
  return out
}

const NOTE = (uri, eol = '\n') => `姓名：张三${eol}影像：${uri}${eol}电话：13800138000`

await check('R1 JSON：76 列换行的 data:image 移除后可还原，相邻文本不变', async () => {
  const out = await removeAndCheck('wrapped.json', JSON.stringify([{ ID: 'A1', NOTE: NOTE(`data:image/png;base64,${wrap76(BIG_PNG)}`) }], null, 2), { lines: false })
  const note = JSON.parse(out)[0].NOTE
  assert.ok(note.startsWith('姓名：张三\n影像：data:image/png;base64,'), note)
  assert.ok(note.endsWith('\n电话：13800138000'), note)
  assert.equal(note.split('\n').length, NOTE(`data:image/png;base64,${wrap76(BIG_PNG)}`).split('\n').length, 'line count inside the value changed')
})

await check('R1 JSON：CRLF 换行、位于值末尾、前后文本很短，移除后都可还原', async () => {
  await removeAndCheck('crlf.json', JSON.stringify([{ ID: 'A1', NOTE: NOTE(`data:image/png;base64,${wrap76(BIG_PNG, '\r\n')}`, '\r\n') }]))
  await removeAndCheck('tail.json', JSON.stringify([{ ID: 'A1', NOTE: `姓名：张三\n影像：data:image/png;base64,${wrap76(BIG_PNG)}` }]))
  await removeAndCheck('short.json', JSON.stringify([{ ID: 'A1', NOTE: `图：data:image/png;base64,${wrap76(BIG_PNG)}\n完` }]))
})

await check('R1 JSON：非图片 data: URI（PDF，单行与换行）移除后可还原', async () => {
  const one = await removeAndCheck('pdf.json', JSON.stringify([{ ID: 'A1', NOTE: `姓名：张三\n附件：data:application/pdf;base64,${PDF_B64}\n电话：13800138000` }]))
  assert.ok(JSON.parse(one)[0].NOTE.endsWith('\n电话：13800138000'), one)
  await removeAndCheck('pdfwrap.json', JSON.stringify([{ ID: 'A1', NOTE: `姓名：张三\n附件：data:application/pdf;base64,${wrap76(PDF_B64)}\n电话：13800138000` }]))
})

await check('R1 JSON：整个值是换行的二进制 base64，移除后可还原', async () => {
  const blob = wrap76(Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 37) % 256)).toString('base64'))
  const { doc } = await openFile('blob.json', JSON.stringify([{ ID: 'A1', NOTE: blob, B: '张三' }]))
  assert.equal(doc.opaque().length, 1)
  assert.equal(doc.removeOpaque(), 1)
  assertStructure(doc)
  assert.ok(!String(doc.serialize()).includes(blob.split('\n')[0]))
})

await check('R1 CSV 与 txt：换行的 data:image 移除后可还原且行数不变', async () => {
  await removeAndCheck('wrapped.csv', `id,note\n1,"${NOTE(`data:image/png;base64,${wrap76(BIG_PNG)}`)}"\n2,无\n`)
  await removeAndCheck('wrapped.txt', `${NOTE(`data:image/png;base64,${wrap76(BIG_PNG)}`)}\n结论：未见异常\n`)
})

await check('R1 端到端：opaquePolicy=remove，JSON 中换行的 data:image 被移除，文件不进入复核', async () => {
  const input = join(tmp, 'e2e-remove')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'r.json'), JSON.stringify([{ ID: 'A1', NOTE: NOTE(`data:image/png;base64,${wrap76(BIG_PNG)}`) }]))
  const run = await runBatch({ inputDir: input, outputRoot: join(tmp, 'e2e-remove-out'), options: { runId: 'fix-layers-remove', policy: { opaquePolicy: 'remove' } } })
  const file = run.files.find((item) => item.relPath === 'r.json')
  assert.ok(!file.issues.some((issue) => /结构|写回|移除内容失败/.test(issue.detail)), JSON.stringify(file.issues))
  assert.equal(file.status, 'clean', JSON.stringify(file.issues))
  const out = await readFile(outJoin(await outDirOf(join(tmp, 'e2e-remove-out'), 'fix-layers-remove'), 'r.json'), 'utf8')
  assert.ok(!out.includes(wrap76(BIG_PNG).split('\n')[1]) && !out.includes('13800138000'), out)
})

await check('R2 标记属性：日期按年泛化后（1980-01-01→1980）结构校验通过', async () => {
  const { doc } = await openFile('attrdate.json', JSON.stringify([{ X: '<a><p birthdate="1980-01-01" x="1"/><b>病人</b></a>' }]))
  assert.ok(doc.segments().some((segment) => segment.text === '1980-01-01'))
  assert.equal(replaceAll(doc, [['1980-01-01', '1980']]), 1)
  assertStructure(doc)
  assert.ok(JSON.parse(doc.serialize())[0].X.includes('birthdate="1980"'))
})

await check('R2 标记属性：替换成短值、空值、不再像标识符的值，结构校验都通过', async () => {
  const xml = '<root><id root="2.16.156.10011.1.3" extension="110105194912310021"/><a href="tel:13800138000">电话</a>' +
    '<p id="p13800138000" title="张三">病人</p><q ref="13900139000"/><r v="x@y.cn"/></root>'
  const { doc } = await openFile('attrshort.json', JSON.stringify([{ X: xml }]))
  const pairs = [['110105194912310021', '12'], ['tel:13800138000', 'none'], ['p13800138000', 'p138****8000'], ['张三', ''], ['13900139000', '0'], ['x@y.cn', 'off']]
  assert.equal(replaceAll(doc, pairs), pairs.length)
  assertStructure(doc)
  const out = JSON.parse(doc.serialize())[0].X
  assert.ok(out.includes('extension="12"') && out.includes('href="none"') && out.includes('id="p138****8000"') && out.includes('title=""') && out.includes('ref="0"'), out)
})

await check('R2 HL7：未提示字段的时间戳（MSH-7、PV1-44）泛化为年后结构校验通过', async () => {
  const msg = 'MSH|^~\\&|HIS|HOSP|LIS|HOSP|20240301120000||ADT^A01|MSG00001|P|2.5\r' +
    'PID|1||987654321^^^HOSP^MR||张三^^||19800101|M\r' +
    `PV1|1|I|${'|'.repeat(41)}20240301083000`
  const { doc } = await openFile('hl7ts.json', JSON.stringify([{ MSG: msg }]))
  const texts = doc.segments().map((segment) => segment.text)
  assert.ok(texts.includes('20240301120000') && texts.includes('20240301083000'), JSON.stringify(texts))
  assert.equal(replaceAll(doc, [['20240301120000', '2024'], ['20240301083000', '2024'], ['987654321', '12'], ['19800101', '']]), 4)
  assertStructure(doc)
  const out = JSON.parse(doc.serialize())[0].MSG
  assert.ok(out.includes('|HOSP|2024||ADT^A01|') && out.endsWith('|2024') && out.includes('|12^^^HOSP^MR|'), out)
})

await check('R2 字符串中的 JSON：值被替换为空后结构校验通过', async () => {
  const { doc } = await openFile('jsonstr.json', JSON.stringify([{ DATA: JSON.stringify({ name: '张三', note: '复诊', phone: '13800138000' }) }]))
  assert.equal(replaceAll(doc, [['张三', ''], ['13800138000', '138****8000']]), 2)
  assertStructure(doc)
  const inner = JSON.parse(JSON.parse(doc.serialize())[0].DATA)
  assert.deepEqual(inner, { name: '', note: '复诊', phone: '138****8000' })
})

await check('R2 端到端：CDA 出生日期按年泛化，文件不因结构校验进入复核', async () => {
  const input = join(tmp, 'e2e-cdadate')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'cda.json'), JSON.stringify([{ ID: 'A1', CDA: '<ClinicalDocument xmlns="urn:hl7-org:v3"><patient2 birthdate="1980-01-01" phone="13800138000"/></ClinicalDocument>' }]))
  const run = await runBatch({ inputDir: input, outputRoot: join(tmp, 'e2e-cdadate-out'), options: { runId: 'fix-layers-cdadate', policy: { quasiIdentifiers: true, quasiPolicy: { date: 'year' } } } })
  const file = run.files.find((item) => item.relPath === 'cda.json')
  assert.ok(!file.issues.some((issue) => /结构/.test(issue.detail)), JSON.stringify(file.issues))
  const out = await readFile(outJoin(await outDirOf(join(tmp, 'e2e-cdadate-out'), 'fix-layers-cdadate'), 'cda.json'), 'utf8')
  assert.ok(!out.includes('1980-01-01') && !out.includes('13800138000'), out)
  assert.ok(out.includes('birthdate=\\"1980\\"'), out)
})

await check('R3 标记属性：标识符属性里的短号码（CDA extension、mrn、inpatientNo 等）也暴露', async () => {
  const cda = leafTexts('<ClinicalDocument><recordTarget><patientRole><id root="2.16.156.10011.1.12" extension="12345"/><id root="2.16.156.10011.1.13" extension="00731"/>' +
    '<patient><name>病人</name></patient></patientRole></recordTarget></ClinicalDocument>')
  for (const value of ['12345', '00731', '病人']) assert.ok(cda.includes(value), `${value} hidden: ${JSON.stringify(cda)}`)
  const custom = leafTexts('<root><patient mrn="54321" inpatientNo="98765" patient_id="4321" cardNumber="777" v:visitId="88" PHONE="8021"/><p>文本</p></root>')
  for (const value of ['54321', '98765', '4321', '777', '88', '8021', '文本']) assert.ok(custom.includes(value), `${value} hidden: ${JSON.stringify(custom)}`)
  // Structural short numbers stay out of the way.
  const plain = leafTexts('<table width="120" border="1"><tr><td colspan="2" id="12" xml:id="7">内容</td></tr></table>')
  assert.deepEqual(plain, ['内容'])
})

await check('R3 标识符属性的短号码可被替换，写回后结构校验通过', async () => {
  const { doc } = await openFile('shortid.json', JSON.stringify([{ X: '<root><id root="2.16.156.10011.1.12" extension="12345"/><patient mrn="54321"/><p>病人</p></root>' }]))
  const segs = doc.segments()
  assert.equal(segs.find((segment) => segment.text === '12345')?.field, '@extension')
  assert.equal(segs.find((segment) => segment.text === '54321')?.field, '@mrn')
  assert.equal(replaceAll(doc, [['12345', '[病历号]'], ['54321', 'MRN-1']]), 2)
  assertStructure(doc)
  const out = JSON.parse(doc.serialize())[0].X
  assert.ok(!out.includes('12345') && !out.includes('54321') && out.includes('extension="[病历号]"'), out)
})

await rm(tmp, { recursive: true, force: true })
console.log(failures === 0 ? 'FIX-LAYERS PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
