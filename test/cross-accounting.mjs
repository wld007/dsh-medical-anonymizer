// Blind-review accounting: every reported item ends in exactly one branch —
// rule-filtered (with a reason), unlocated, or re-judged — and the cross-check
// detail lists the filtered and unlocated ones too.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBatch } from '../lib/pipeline.js'

const segmentsOf = (prompt, marker) => JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length))
const root = await mkdtemp(join(tmpdir(), 'ma-cross-'))
try {
  const input = join(root, 'in')
  await mkdir(input)
  await writeFile(join(input, 'note.txt'), '主诉：头痛三天。\n既往体健，否认过敏史。\n建议复查，随访。\n')
  let verifyCalls = 0
  const llm = {
    model: 'scripted',
    async chatJson(messages) {
      const prompt = messages.map((message) => message.content).join('\n')
      if (prompt.includes('独立的数据安全审查员')) {
        const segments = segmentsOf(prompt, '段落：')
        verifyCalls += 1
        if (verifyCalls > 1) return { json: { issues: [] } }
        const id = segments[0].id
        return {
          json: {
            issues: [
              { segment: id, type: '身份证号', text: '头痛' }, // wrong format → filtered: format
              { segment: id, type: '星座', text: '三天' }, // unknown type → filtered: invalid
              { segment: id, type: '姓名', text: '' }, // empty → filtered: invalid
              { segment: id, type: '姓名', text: '王小明' }, // nowhere in the text → unlocated
              { segment: id, type: '医生', text: '否认过敏' }, // located → re-judged
            ],
          },
        }
      }
      if (prompt.includes('另一位审查员')) {
        const candidates = segmentsOf(prompt, '候选：')
        return { json: { verdicts: candidates.map((item) => ({ i: item.i, identifier: false, reason: '不是人名' })) } }
      }
      if (prompt.includes('结构化医疗数据')) return { json: { fields: [] } }
      return { json: { entities: [] } }
    },
  }
  const out = join(root, 'out')
  const run = await runBatch({ inputDir: input, outputRoot: out, options: { llm, runId: 'cross', maxRounds: 1 } })
  const blind = run.totals.blind
  assert.equal(blind.flaggedCalls, 1)
  assert.equal(blind.items, 5)
  assert.deepEqual(blind.filtered, { format: 1, pseudonym: 0, invalid: 2, allowed: 0 })
  assert.equal(blind.unlocated, 1)
  assert.equal(blind.reported, 1)
  const filteredTotal = Object.values(blind.filtered).reduce((a, b) => a + b, 0)
  assert.equal(filteredTotal + blind.unlocated + blind.reported, blind.items, 'items = filtered + unlocated + re-judged')
  assert.equal(blind.confirmed + blind.dismissed + blind.disputed + blind.unjudged, blind.reported, 're-judged splits into four outcomes')
  console.log('  ok  every blind-review item is counted in exactly one branch')

  const cross = JSON.parse(await readFile(join(out, '_records', 'runs', 'cross', 'cross-check.json'), 'utf8'))
  const outcomes = cross.map((entry) => entry.outcome).sort()
  assert.deepEqual(outcomes.filter((o) => o === 'filtered').length, 2, 'empty items have no text to list')
  assert.ok(outcomes.includes('unlocated'))
  assert.ok(cross.find((entry) => entry.outcome === 'filtered' && entry.judge.startsWith('格式不符')))
  console.log('  ok  cross-check detail lists filtered (with reason) and unlocated items')

  const md = await readFile(join(out, '_records', 'runs', 'cross', 'report.md'), 'utf8')
  assert.match(md, /共报出 5 条/)
  assert.match(md, /规则过滤 3 条/)
  assert.match(md, /无法定位 1 条/)
  assert.doesNotMatch(md, /一致率：\d+%/)
  console.log('  ok  report shows the same breakdown and no agreement ratio without enough re-judged items')
} finally {
  await rm(root, { recursive: true, force: true })
}

// ── Client: C3 two-tier bar and the flow chart ─────────────────────────────
{
  const { readFile: read } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  let definition = null
  globalThis.window = { __ModuleLoader__: { load(def) { definition = def } } }
  await import(new URL('../client.js', import.meta.url))
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }), Fragment: 'Fragment' }
  const helpers = definition.factory((name) => (name === 'react' ? React : {})).helpers
  const zh = helpers.locales.zh
  const t = (key, vars) => (zh[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ''))
  const blind = { calls: 250, flaggedCalls: 42, items: 47, unlocated: 0, reported: 1, confirmed: 1, dismissed: 0, disputed: 0, unjudged: 0, filtered: { format: 44, pseudonym: 0, invalid: 0, allowed: 2 } }
  const flow = helpers.crossFlow(blind, t)
  assert.equal(flow.total, 47)
  const sum = flow.leaves.reduce((a, leaf) => a + leaf.width, 0)
  assert.ok(Math.abs(sum - 100) < 1e-6, 'leaves fill the bar')
  for (const branch of flow.branches) {
    const own = flow.leaves.filter((leaf) => leaf.branch === branch.key).reduce((a, leaf) => a + leaf.width, 0)
    assert.ok(Math.abs(own - branch.width) < 1e-6, `${branch.key} tier aligned with its leaves`)
  }
  const confirmed = flow.leaves.find((leaf) => leaf.key === 'confirmed')
  assert.ok(confirmed.width >= 2.5, `1 of 47 stays visible (${confirmed.width.toFixed(1)}%)`)
  assert.ok(flow.leaves.filter((leaf) => leaf.value === 0).every((leaf) => leaf.width === 0))
  console.log('  ok  C3 bar: tiers line up, small outcomes keep a visible width, zeros take none')

  const running = helpers.crossFlow({ ...blind, reported: 3 }, t)
  assert.equal(running.leaves.find((leaf) => leaf.key === 'inflight')?.value, 2, 'reported but not settled shows as in re-judge')
  const old = helpers.crossFlow({ calls: 10, flaggedCalls: 2, reported: 2, confirmed: 1, dismissed: 1, disputed: 0, unjudged: 0 }, t)
  assert.equal(old.itemized, false)
  assert.equal(old.total, 2)
  console.log('  ok  C3 bar: running batches and pre-itemized batches')

  const chart = helpers.crossFlowChart(React.createElement, flow, blind, t)
  const svg = chart.children.find((node) => node?.type === 'svg')
  const texts = svg.children.filter((node) => node.type === 'text')
  const ys = texts.filter((node) => node.props.x > 500).map((node) => node.props.y).sort((a, b) => a - b)
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 16, 'leaf labels do not overlap')
  assert.ok(texts.some((node) => node.children.join('') === '格式不符 44'))
  assert.equal(helpers.crossFlowChart(React.createElement, helpers.crossFlow(null, t), null, t), null)
  console.log('  ok  flow chart: labels never overlap, empty batches draw nothing')
}
console.log('\nCROSS-ACCOUNTING PASS')
