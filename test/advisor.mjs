/**
 * Advisor: suggestions from batch statistics; the draft never carries values.
 * Run: node test/advisor.mjs
 */
import assert from 'node:assert/strict'
import { advise } from '../lib/advisor.js'

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${name}\n      ${error.message}`)
  }
}

const SECRET = '张三丰'
function file(relPath, { rounds = 1, issues = [], overMatch = [] } = {}) {
  const item = { relPath, status: issues.some((i) => i.severity === 'error') ? 'review' : 'clean', rounds, issues }
  Object.defineProperty(item, 'overMatchValues', { value: overMatch, enumerable: false })
  return item
}
const base = { maxRounds: 3, concurrency: 4, timeoutMs: 120000, disableThinking: false, modelConfigured: true, skipFields: [], allowValues: [], version: 't' }

const files = []
for (let i = 0; i < 12; i += 1) {
  files.push(file(`d/f${i}.json`, {
    rounds: i < 2 ? 3 : 1,
    issues: [
      ...(i < 2 ? [{ severity: 'error', code: 'model-residual', type: '姓名', fields: ['NOTE'], detail: `模型复核残留：姓名 ${SECRET}` }] : []),
      ...(i < 3 ? [{ severity: 'warn', code: 'model-error', detail: '模型请求超时' }] : []),
      { severity: 'warn', code: 'model-parse', detail: 'bad json' },
      { severity: 'warn', code: 'suspect', type: '身份证号', fields: ['ORG_CODE'], detail: '疑似身份证号但校验位不符' },
      { severity: 'warn', code: 'unlocated', type: '姓名', detail: `未定位：${SECRET}` },
      { severity: 'warn', code: 'unlocated', type: '电话', detail: '未定位：138' },
      ...(i === 0 ? [{ severity: 'error', code: 'structure', detail: 'x' }] : []),
    ],
    overMatch: i < 2 ? [{ type: '证件号', text: '01', spread: 40, fields: ['A', 'B'] }] : [],
  }))
}
files.push(file('broken.xml', { issues: [{ severity: 'error', code: 'load', detail: `无法解析 ${SECRET}` }] }))
const run = { status: 'review', files, skipped: { unsupportedByExt: { '.docx': 4 } } }
const advice = advise(run, base)
const ids = advice.suggestions.map((item) => item.id)

check('超时 → 调大超时并降低并发', () => {
  assert.ok(ids.includes('timeout-up') && ids.includes('concurrency-down'), ids.join())
  assert.equal(advice.suggestions.find((s) => s.id === 'timeout-up').patch.timeoutMs, 180000)
})
check('输出无法解析且思考模式开启 → 关闭思考模式', () => assert.ok(ids.includes('thinking-off')))
check('用满轮次仍残留 → 增加轮次', () => assert.equal(advice.suggestions.find((s) => s.id === 'rounds-up').patch.maxRounds, 4))
check('大范围扩散的值 → 不匹配的值候选', () => {
  const allow = advice.suggestions.find((s) => s.id === 'allow-values')
  assert.deepEqual(allow.patch.allowValuesAdd, ['01'])
  assert.equal(allow.values[0].spread, 80)
})
check('反复提示的字段 → 不处理的字段候选（有错误的字段除外）', () => {
  const skip = advice.suggestions.find((s) => s.id === 'skip-fields')
  assert.deepEqual(skip.patch.skipFieldsAdd, ['ORG_CODE'])
})
check('设置解决不了的问题进入改进草稿', () => {
  const areas = advice.findings.map((f) => f.area)
  for (const area of ['片段定位', '结构校验', '文件解析', '格式支持']) assert.ok(areas.includes(area), areas.join())
})
check('改进草稿不含原值、文件路径和字段名', () => {
  assert.ok(advice.draft)
  for (const leak of [SECRET, 'broken', 'd/f', 'NOTE', 'ORG_CODE', '"01"']) assert.ok(!advice.draft.includes(leak), leak)
})
check('已在不匹配列表中的值不再建议；思考已关闭时解析问题进草稿', () => {
  const again = advise(run, { ...base, allowValues: ['01'], disableThinking: true })
  assert.ok(!again.suggestions.some((s) => s.id === 'allow-values'))
  assert.ok(!again.suggestions.some((s) => s.id === 'thinking-off'))
  assert.ok(again.findings.some((f) => f.area === '模型输出解析'))
})
check('全部第 1 轮通过 → 可降低轮次；取消的批次不给建议', () => {
  const clean = Array.from({ length: 25 }, (_, i) => file(`c${i}.txt`))
  assert.ok(advise({ status: 'completed', files: clean }, base).suggestions.some((s) => s.id === 'rounds-down'))
  assert.equal(advise({ status: 'cancelled', files: clean }, base).suggestions.length, 0)
})

check('内存峰值高 → 减小每组文件数；分组且峰值低 → 增大', () => {
  const clean = Array.from({ length: 5 }, (_, i) => file(`m${i}.txt`))
  const high = advise({ status: 'completed', files: clean, chunks: 1, memory: { peakHeap: 3.2e9, heapLimit: 4e9 } }, { ...base, maxFiles: 200 })
  assert.equal(high.suggestions.find((s) => s.id === 'chunk-down').patch.maxFiles, 100)
  const low = advise({ status: 'completed', files: clean, chunks: 3, memory: { peakHeap: 0.4e9, heapLimit: 4e9 } }, { ...base, maxFiles: 200 })
  assert.equal(low.suggestions.find((s) => s.id === 'chunk-up').patch.maxFiles, 400)
  const single = advise({ status: 'completed', files: clean, chunks: 1, memory: { peakHeap: 0.4e9, heapLimit: 4e9 } }, { ...base, maxFiles: 200 })
  assert.ok(!single.suggestions.some((s) => s.id.startsWith('chunk')))
})

console.log(failures === 0 ? 'ADVISOR PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
