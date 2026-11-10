// Reviewer edits in the comparison: revert a false-positive pseudonym, replace
// a missed value (file or whole batch), "always replace" values in later
// batches, and the "互联网医院" rule exclusion.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBatch } from '../lib/pipeline.js'
import { createService } from '../lib/service.js'
import { scan } from '../lib/rules.js'
import { normalizePolicyPatch, resolvePolicy } from '../lib/policy.js'

const tmp = await mkdtemp(join(tmpdir(), 'ma-manual-'))
let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) } catch (error) { failures += 1; console.log(`FAIL  ${name}\n      ${error.stack?.split('\n').slice(0, 3).join('\n      ')}`) }
}

try {
  const input = join(tmp, 'in')
  await mkdir(input)
  await writeFile(join(input, 'a.txt'), '主治医师：王建国\n就诊于湖州市第一人民医院。\n随访：联系老李头。\n')
  await writeFile(join(input, 'b.txt'), '复诊于湖州市第一人民医院，老李头陪同。\n')
  const root = join(tmp, 'out')
  const run = await runBatch({ inputDir: input, outputRoot: root, options: { runId: 'm1', llm: null } })
  const svc = createService({ config: { outputRoot: root }, defaultDirectory: tmp })
  const delivered = (name) => readFile(join(run.output, name), 'utf8')

  await check('漏报补替换（全批次）：两份文件里选中的值都换成同一个假名，比对和报告同步', async () => {
    assert.ok((await delivered('a.txt')).includes('老李头'))
    const result = await svc.manualEdit('m1', { relPath: 'a.txt', action: 'replace', text: '老李头', type: '姓名', scope: 'batch' })
    assert.equal(result.files, 2)
    assert.equal(result.count, 2)
    assert.match(result.pseudonym, /^化名-[0-9A-F]{6}$/)
    for (const name of ['a.txt', 'b.txt']) {
      const text = await delivered(name)
      assert.ok(!text.includes('老李头') && text.includes(result.pseudonym), name)
    }
    const listed = JSON.parse(await readFile(join(root, '_records', 'runs', 'm1', 'compare', 'index.json'), 'utf8'))
    const entry = listed.find((item) => item.relPath === 'b.txt')
    const data = JSON.parse(await readFile(join(root, '_records', 'runs', 'm1', 'compare', `${entry.n}.json`), 'utf8'))
    assert.ok(data.changes.some((change) => (change.after ?? '').includes(result.pseudonym)))
    const md = await readFile(join(root, '_records', 'runs', 'm1', 'report.md'), 'utf8')
    assert.match(md, /漏报补替换：1 个值替换为假名，共 2 处/)
    assert.ok(!md.includes('老李头'), 'report never holds the original')
    const log = await readFile(join(root, '_records', 'runs', 'm1', 'manual-edits.json'), 'utf8')
    assert.ok(!log.includes('老李头'), 'log holds pseudonyms only')
  })

  await check('误报还原（本文件）：假名回到原文，只改这一份', async () => {
    const before = await delivered('a.txt')
    const token = before.match(/医院-[0-9A-F]{6}/)?.[0]
    assert.ok(token, before)
    const result = await svc.manualEdit('m1', { relPath: 'a.txt', action: 'revert', text: token, scope: 'file' })
    assert.equal(result.original, '湖州市第一人民医院')
    assert.ok((await delivered('a.txt')).includes('湖州市第一人民医院'))
    assert.ok((await delivered('b.txt')).includes(token), 'other files untouched')
    const md = await readFile(join(root, '_records', 'runs', 'm1', 'report.md'), 'utf8')
    assert.match(md, /误报还原：1 个假名还原为原文，共 1 处/)
  })

  await check('拒绝：非假名不能还原；选中文字含假名不能补替换；找不到时报错', async () => {
    await assert.rejects(svc.manualEdit('m1', { relPath: 'a.txt', action: 'revert', text: '王建国', scope: 'file' }), /只能还原/)
    const token = (await delivered('b.txt')).match(/化名-[0-9A-F]{6}/)[0]
    await assert.rejects(svc.manualEdit('m1', { relPath: 'b.txt', action: 'replace', text: `${token}陪同`, type: '姓名', scope: 'file' }), /含已替换的假名/)
    await assert.rejects(svc.manualEdit('m1', { relPath: 'b.txt', action: 'replace', text: '不存在的人', type: '姓名', scope: 'file' }), /没有找到/)
    await assert.rejects(svc.manualEdit('m1', { relPath: 'b.txt', action: 'replace', text: '陪同', type: '星座', scope: 'file' }), /类型/)
  })

  await check('「总是替换的值」：以后的批次不论出现在哪里都替换', async () => {
    assert.deepEqual(normalizePolicyPatch({ forceValues: ['姓名:老李头'] }).forceValues, ['姓名:老李头'])
    assert.throws(() => normalizePolicyPatch({ forceValues: ['老李头'] }), /类型:值/)
    assert.deepEqual(resolvePolicy({ forceValues: ['姓名：老李头', '星座:x'] }).forceValues, [{ type: '姓名', text: '老李头' }])
    const root2 = join(tmp, 'out2')
    const again = await runBatch({ inputDir: input, outputRoot: root2, options: { runId: 'm2', llm: null, policy: { forceValues: ['姓名:老李头'] } } })
    for (const name of ['a.txt', 'b.txt']) assert.ok(!(await readFile(join(again.output, name), 'utf8')).includes('老李头'), name)
  })

  await check('规则：「互联网医院」「网络医院」是通用说法，不当作医院名', async () => {
    const found = scan('请关注互联网医院，或到湖州市第一人民医院。网络医院同样可用。').filter((e) => e.type === '医院').map((e) => e.text)
    assert.deepEqual(found, ['湖州市第一人民医院'])
  })

  await check('比对结果列：假名始终是一个完整可点的块，即使差异把它拆开', async () => {
    let definition = null
    globalThis.window = { __ModuleLoader__: { load(def) { definition = def } } }
    await import(new URL('../client.js', import.meta.url))
    const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }), Fragment: 'Fragment' }
    const helpers = definition.factory((name) => (name === 'react' ? React : {}), { t: (key) => key }).helpers
    const before = '签名：互联网医院 联系电话：2039352'
    const after = '签名：医院-3E1527 联系电话：电话-44506C'
    const clicked = []
    const out = helpers.renderAfterCell(after, helpers.diffTexts(before, after), [], 'k', (event, token) => clicked.push(token))
    const chips = out.filter((node) => node?.props?.className === 'ws-pseudo')
    assert.deepEqual(chips.map((node) => node.children.join('')), ['医院-3E1527', '电话-44506C'])
    chips[0].props.onClick({ stopPropagation() {} })
    assert.deepEqual(clicked, ['医院-3E1527'])
    const text = (node) => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : (node?.children ?? []).map(text).join(''))
    assert.equal(out.map(text).join(''), after)
  })
} finally {
  await rm(tmp, { recursive: true, force: true })
}
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nMANUAL-EDIT PASS')
