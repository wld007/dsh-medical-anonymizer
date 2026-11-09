/**
 * Layered content: every wrapping is unwrapped into text, replacements are
 * written back through every layer, and what cannot be read is reported.
 * Run: node test/layers.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { gzipSync, deflateSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDocument } from '../lib/formats.js'
import { layered, PIECE_CHARS } from '../lib/layers.js'

const tmp = join(dirname(fileURLToPath(import.meta.url)), '.tmp', 'layers')
await rm(tmp, { recursive: true, force: true })
await mkdir(tmp, { recursive: true })

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${name}\n      ${error.stack?.split('\n').slice(0, 3).join('\n      ')}`)
  }
}

const NAME = '王建军'
const PSEUDO = '化名-9F3A2C'
const PHONE = '13912345678'
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64')
const html = (body) => `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>病历</title></head><body><div class="r"><span>主诉：</span><span>患者${NAME}，男，因腹痛入院。</span><table><tr><td>联系电话</td><td>${PHONE}</td></tr></table>${body}</div></body></html>`

async function open(name, value, extra = {}) {
  const path = join(tmp, `${name}.json`)
  await writeFile(path, JSON.stringify([{ ID: 'A1', CONTENT: value, ...extra }], null, 2))
  return { path, doc: layered(await loadDocument(path, `${name}.json`)) }
}

/** Replace every occurrence of `from` in every segment; returns count. */
function replaceEverywhere(doc, from, to) {
  const replacements = []
  for (const segment of doc.segments()) {
    let at = segment.text.indexOf(from)
    while (at >= 0) {
      replacements.push({ id: segment.id, start: at, end: at + from.length, original: from, replacement: to })
      at = segment.text.indexOf(from, at + from.length)
    }
  }
  replacements.sort((a, b) => b.start - a.start)
  return doc.apply(replacements)
}

async function roundTrip(name, value, { decodeBack, extra } = {}) {
  const { path, doc } = await open(name, value, extra)
  const seen = doc.segments().map((segment) => segment.text).join('\n')
  assert.ok(seen.includes(NAME), `${name}: name not visible after unwrapping`)
  const applied = replaceEverywhere(doc, NAME, PSEUDO)
  assert.ok(applied >= 1, `${name}: nothing applied`)
  assert.ok(doc.structure().ok, `${name}: ${JSON.stringify(doc.structure().checks)}`)
  const outPath = join(tmp, `${name}.out.json`)
  await writeFile(outPath, doc.serialize())
  const out = JSON.parse(await readFile(outPath, 'utf8'))
  assert.equal(out[0].ID, 'A1')
  const again = layered(await loadDocument(outPath, `${name}.out.json`))
  const after = again.segments().map((segment) => segment.text).join('\n')
  assert.ok(!after.includes(NAME), `${name}: name survived`)
  assert.ok(after.includes(PSEUDO), `${name}: pseudonym missing`)
  if (decodeBack) decodeBack(out[0].CONTENT)
  return { doc, out, path }
}

await check('base64 编码的 HTML 病历：解码后识别，写回仍是 base64，标签不变', async () => {
  const { out } = await roundTrip('b64html', b64(html('')), {
    decodeBack: (value) => {
      assert.match(value, /^[A-Za-z0-9+/]+={0,2}$/)
      const decoded = Buffer.from(value, 'base64').toString('utf8')
      assert.ok(decoded.startsWith('<!DOCTYPE html><html><head>'))
      assert.ok(decoded.includes(`<span>患者${PSEUDO}，男，因腹痛入院。</span>`), decoded)
    },
  })
  void out
})

await check('base64 内套 gzip 再套文本', async () => {
  await roundTrip('b64gzip', gzipSync(Buffer.from(`门诊记录：${NAME}，咳嗽三天。`, 'utf8')).toString('base64'), {
    decodeBack: (value) => assert.equal(Buffer.from(value, 'base64')[0], 0x1f),
  })
})

await check('zlib 压缩的 base64', async () => {
  await roundTrip('b64zlib', deflateSync(Buffer.from(`病程记录：家属${NAME}签字同意。`)).toString('base64'))
})

await check('带换行的 base64（每行 76 字符）保持换行格式', async () => {
  const value = b64(html('<p>补充说明若干'.repeat(10) + '</p>')).match(/.{1,76}/g).join('\r\n')
  await roundTrip('b64lines', value, { decodeBack: (v) => assert.ok(v.split('\r\n').slice(0, -1).every((line) => line.length === 76), 'line width changed') })
})

await check('data: URI 文本', async () => {
  await roundTrip('datauri', `data:text/plain;charset=utf-8;base64,${b64(`联系人${NAME}`)}`, {
    decodeBack: (v) => assert.ok(v.startsWith('data:text/plain;charset=utf-8;base64,')),
  })
})

await check('URL 编码、\\u 转义、HTML 实体', async () => {
  await roundTrip('url', encodeURIComponent(`姓名=${NAME}&电话=${PHONE}`), { decodeBack: (v) => assert.ok(!/[^\x00-\x7e]/.test(v)) })
  await roundTrip('uesc', `患者\\u${[...NAME].map((c) => c.charCodeAt(0).toString(16)).join('\\u')}入院`.replace('入院', '\\u5165\\u9662'), { decodeBack: (v) => assert.ok(v.includes('\\u')) })
  await roundTrip('entity', `患者${[...NAME].map((c) => `&#${c.charCodeAt(0)};`).join('')}入院`.replace('患者', '&#24739;&#32773;').replace('入院', '&#20837;&#38498;'), { decodeBack: (v) => assert.ok(v.includes('&#')) })
})

await check('十六进制、编码错乱（UTF-8 被当作 Latin-1）', async () => {
  await roundTrip('hex', Buffer.from(`门诊：${NAME}复诊，血压正常。`, 'utf8').toString('hex'))
  await roundTrip('mojibake', Buffer.from(`门诊：${NAME}复诊`, 'utf8').toString('latin1'))
})

await check('字段里的 JSON 字符串、HL7 消息', async () => {
  await roundTrip('jsonstr', JSON.stringify({ patient: { name: NAME, phone: PHONE }, note: `${NAME}主诉头痛` }))
  const hl7 = `MSH|^~\\&|HIS|H1|LIS|H1|20240101||ADT^A01|1|P|2.4\rPID|1||889900^^^H||${NAME}^^||19800101|M|||北京市^^||${PHONE}`
  const { doc } = await roundTrip('hl7', hl7, { decodeBack: (v) => assert.ok(v.startsWith('MSH|^~\\&|') && v.includes(`|${PSEUDO}^^|`), v) })
  void doc
})

await check('多层嵌套：JSON → base64 → gzip → HTML，HTML 里的图片报为无法检查', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]).toString('base64')
  const inner = gzipSync(Buffer.from(html(`<img src="data:image/png;base64,${png}"/>`), 'utf8')).toString('base64')
  const { doc } = await roundTrip('nested', JSON.stringify({ doc: inner }))
  const opaque = doc.opaque()
  assert.equal(opaque.length, 1)
  assert.match(opaque[0].kind, /PNG/)
  assert.ok(opaque[0].image)
})

await check('base64 图片、PDF、未知二进制：不当作已检查，移除时用占位替代', async () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 1)]).toString('base64')
  const { doc, path } = await open('pdf', pdf)
  assert.equal(doc.opaque().length, 1)
  assert.match(doc.opaque()[0].kind, /PDF/)
  const cov = doc.coverage()
  assert.equal(cov.opaque, 1)
  assert.equal(doc.removeOpaque(), 1)
  const out = JSON.parse(doc.serialize())
  assert.equal(out[0].CONTENT, '')
  void path
  const bin = Buffer.from(Array.from({ length: 400 }, (_, i) => (i * 97 + 13) % 256)).toString('base64')
  const { doc: d2 } = await open('bin', bin)
  assert.equal(d2.opaque().length, 1)
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100)]).toString('base64')
  const { doc: d3 } = await open('img', `<html><body><p>签名</p><img src="data:image/png;base64,${png}"/></body></html>`)
  assert.equal(d3.removeOpaque(), 1)
  const html3 = JSON.parse(d3.serialize())[0].CONTENT
  assert.match(html3, /<img src="data:image\/png;base64,iVBOR[^"]+"\/>/)
  assert.ok(!html3.includes(png))
})

await check('自由文本中夹着的长编码串：解码检查，解不开的报为无法检查', async () => {
  const run = b64(`附件内容：${NAME}的检验报告`)
  await roundTrip('inline', `见附件 ${run} 以上为原文。`.replace('原文', `原文，患者${NAME}`))
  const junk = 'Q' + 'x9Lm2Zp7Rt4Kd8Wq1Vb6Ny3Hc5Jf0Ga'.repeat(5)
  const { doc } = await open('inlinejunk', `备注 ${junk} 结束`)
  assert.ok(doc.opaque().length >= 1, JSON.stringify(doc.opaque()))
})

await check('超长字段切成小段；名字恰在切分处附近也能定位替换', async () => {
  const filler = '患者一般情况良好，饮食睡眠可，大小便正常。'
  const long = filler.repeat(Math.ceil((PIECE_CHARS * 3) / filler.length)) + `家属${NAME}陪同。` + filler.repeat(40)
  const { doc } = await open('long', long)
  const segs = doc.segments()
  assert.ok(segs.length >= 4 && segs.every((segment) => segment.text.length <= PIECE_CHARS), segs.map((s) => s.text.length).join(','))
  assert.equal(segs.filter((segment) => segment.id.includes('CONTENT')).map((segment) => segment.text).join(''), long)
  await roundTrip('long2', long)
})

await check('不需要解码的普通字段原样通过；未改动时输出逐字节一致', async () => {
  const path = join(tmp, 'plain.json')
  const raw = JSON.stringify([{ A: '普通文本', B: 'ABC123', C: b64(html('')) }], null, 2)
  await writeFile(path, raw)
  const doc = layered(await loadDocument(path, 'plain.json'))
  const ids = doc.segments().map((segment) => segment.id)
  assert.ok(ids.includes('0.A') || ids.some((id) => !id.includes('~')), ids.join(','))
  assert.equal(doc.serialize(), raw)
})

await rm(tmp, { recursive: true, force: true })
console.log(failures === 0 ? 'LAYERS PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
