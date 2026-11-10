// substringIndex must return exactly the needles text.includes(), in input
// order, and stay fast at batch-dictionary scale (the plain needles × segments
// loop it replaced blocked the event loop for minutes on a 32-file batch).
import assert from 'node:assert/strict'
import { substringIndex } from '../lib/pipeline.js'

const needles = ['', 'a', '张三', '张三丰', '13800138000', '0138', 'ab', 'abc', 'abcd', 'bcd', '张三', '3305021962']
const texts = ['', 'abcd', '患者张三丰，电话13800138000', 'x0138y', '证件330502196205210014', 'b', '张']
const index = substringIndex(needles)
for (const text of texts) {
  const expected = needles.map((needle, n) => [needle, n]).filter(([needle]) => text.includes(needle)).map(([, n]) => n)
  assert.deepEqual(index.hits(text), expected, text)
}
console.log('  ok  substringIndex matches String.includes for every needle, in input order')

const big = Array.from({ length: 20000 }, (_, n) => `33050${String(n).padStart(8, '0')}`)
const bigIndex = substringIndex(big)
const segments = Array.from({ length: 50000 }, (_, n) => `记录${n} 号码33050${String(n * 7).padStart(8, '0')} 其他内容`)
const started = Date.now()
let found = 0
for (const segment of segments) found += bigIndex.hits(segment).length
const ms = Date.now() - started
assert.equal(found, segments.filter((_, n) => n * 7 < 20000).length)
assert.ok(ms < 3000, `20k needles × 50k segments took ${ms} ms`)
console.log(`  ok  20k needles × 50k segments in ${ms} ms`)
console.log('\nPERF-INDEX PASS')
