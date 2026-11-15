/**
 * LZMA "alone" streams: decoder against liblzma output, encoder round trips,
 * header detection, and the pipeline on an EMR-style value
 * (base64 › XML › base64 › LZMA › XML) — the content inside is anonymized
 * and written back as LZMA.
 * Run: node test/lzma.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lzmaDecode, lzmaEncode, lzmaHeader } from '../lib/lzma.js'
import { runBatch } from '../lib/pipeline.js'
import { outDirOf, outJoin } from './outputs.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = join(here, '.tmp', 'lzma')
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

// liblzma (Python lzma, FORMAT_ALONE) output for the same 2620 bytes: A with
// an unknown size and an end marker, B with the size in the header.
const PLAIN = Buffer.from('<doc><p>患者张三，电话13800138000，住址东江市临湖区学院路12号。</p><p>复诊：血压 152/88mmHg。</p></doc>\n'.repeat(20))
const A = Buffer.from('XQAAgAD//////////wAeGQnmRUESe+VRG6gUrA+W6lo1s25Y8rQuZ3YonATAvWdAwWKkDjcQgmugoi0RUNRWFccLzCIGUMcN5Ldq+j9KKu8oYqOC5ifnDDkT1g8PG3lof94QJrUlJ76fy21YqJLZiJcgeIzrj7aqcqj2iNDwLCZbVPNqRIXSNeEh9pW0BH7U2MkamBNgOwLG+z/9sSfg', 'base64')
const B = Buffer.from('XQAAAQA8CgAAAAAAAAAeGQnmRUESe+VRG6gUrA+W6lo1s25Y8rQuZ3YonATAvWdAwWKkDjcQgmugoi0RUNRWFccLzCIGUMcN5Ldq+j9KKu8oYqOC5ifnDDkT1g8PG3lof94QJrUlJ76fy21YqJLZiJcgeIzrj7aqcqj2iNDwLCZbVPNqRIXSNeEh9pW0BH7U2MkamBNgOwLG+z/9sSfg', 'base64')

await check('解码 liblzma 生成的流：未知长度带结束标记、头部写明长度', () => {
  assert.deepEqual(lzmaDecode(A).data, PLAIN)
  assert.deepEqual(lzmaDecode(B).data, PLAIN)
  assert.equal(lzmaHeader(A).size, null)
  assert.equal(lzmaHeader(B).size, PLAIN.length)
})

await check('编码后能解回原文（多种 lc/lp/pb、重复与随机数据）', () => {
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed & 0xff }
  const random = Buffer.from(Array.from({ length: 30000 }, rnd))
  const samples = [PLAIN, random, Buffer.concat([random, PLAIN, random.subarray(100, 9000), PLAIN]), Buffer.alloc(70000, 0x41), Buffer.from('x')]
  for (const data of samples) {
    for (const props of [0x5d, 0x00, 0x5e, 0x12]) {
      const encoded = lzmaEncode(data, { props, dictSize: 1 << 20 })
      assert.equal(encoded[0], props)
      assert.deepEqual(lzmaDecode(encoded).data, data, `props ${props}, ${data.length} bytes`)
    }
  }
  // Repetitive text compresses (matches are used).
  assert.ok(lzmaEncode(PLAIN).length < PLAIN.length / 4)
})

await check('不是 LZMA 的二进制不会被当成 LZMA', () => {
  for (const bytes of [Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.from('hello world, plain text here'), Buffer.alloc(40, 0xff)]) {
    assert.equal(lzmaHeader(bytes), null)
  }
  // A plausible header over garbage still fails to decode.
  const fake = Buffer.concat([B.subarray(0, 14), Buffer.alloc(200, 0x5a)])
  assert.throws(() => lzmaDecode(fake))
})

await check('病历 XML 里内嵌的 LZMA 文书被解开、匿名化、按原格式写回', async () => {
  const inner = '<document><content><panel name="主诉">反复咳嗽三天</panel><panel name="病史">患者姓名：张三，联系电话：13800138000，身份证号：11010519491231002X。</panel></content></document>'
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]).toString('base64')
  const innerWithImage = inner.replace('</content>', `<image data="${jpeg}"/></content>`)
  const wrap = (xml) => {
    const packed = lzmaEncode(Buffer.from(xml, 'utf8'), { props: 0x5d, dictSize: 1 << 20 }).toString('base64')
    return Buffer.from(`<doc><head>门诊病历</head><body>${packed}</body></doc>`, 'utf8').toString('base64')
  }
  const input = join(tmp, 'in')
  await rm(tmp, { recursive: true, force: true })
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'emr.json'), JSON.stringify([{ DOC_ID: 'D1', XML_CONT: wrap(inner) }, { DOC_ID: 'D2', XML_CONT: wrap(innerWithImage) }]))
  const root = join(tmp, 'out')
  const run = await runBatch({ inputDir: join(input, 'emr.json'), outputRoot: root, options: { runId: 'lzma', maxRounds: 2, llm: null } })
  const file = run.files[0]
  const opaque = file.issues.filter((issue) => issue.code === 'opaque')
  // Only the embedded picture is left for review, named as what it is.
  assert.equal(opaque.length, 1, JSON.stringify(file.issues))
  assert.match(opaque[0].detail, /JPEG/)
  assert.match(opaque[0].detail, /lzma/)
  const out = JSON.parse(await readFile(outJoin(await outDirOf(root, 'lzma'), 'emr.json'), 'utf8'))
  for (const row of out) {
    const outer = Buffer.from(row.XML_CONT, 'base64').toString('utf8')
    assert.match(outer, /^<doc><head>门诊病历<\/head><body>[A-Za-z0-9+/=]+<\/body><\/doc>$/)
    const packed = Buffer.from(/<body>([^<]+)<\/body>/.exec(outer)[1], 'base64')
    assert.equal(packed[0], 0x5d)
    assert.equal(packed.readUInt32LE(1), 1 << 20)
    const xml = lzmaDecode(packed).data.toString('utf8')
    for (const secret of ['张三', '13800138000', '11010519491231002X']) assert.ok(!xml.includes(secret), secret)
    assert.match(xml, /化名-[0-9A-F]{6}/)
    assert.match(xml, /<panel name="主诉">反复咳嗽三天<\/panel>/)
  }
})

await rm(tmp, { recursive: true, force: true })
if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nLZMA PASS')
