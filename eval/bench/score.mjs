/**
 * Scores anonymized outputs against the gold spans of the synthetic corpus.
 *
 *   node eval/bench/score.mjs <workDir> <config...>
 *
 * Original and output are aligned character by character (LCS per line; the
 * pipeline keeps line structure). Then:
 *   - an identifier LEAKS when more than half of its characters survive;
 *   - it is PARTIAL when it does not leak but a run of ≥ 4 identifying
 *     characters survives (pseudonym hex digits coincide with 2–3 original
 *     digits by chance, so shorter runs are noise);
 *   - changed characters outside identifier and neutral spans are
 *     OVER-REDACTION (counted in runs that contain a letter, digit or Han);
 *   - a decoy is LOST when it occurs fewer times in the output than in the
 *     original;
 *   - a JSON file whose output no longer parses is BROKEN.
 * Writes <workDir>/score.json (per configuration, aggregates and the lists
 * behind them) and prints a summary table.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [workDir = 'eval/bench/.tmp', ...configs] = process.argv.slice(2)
const gold = JSON.parse(await readFile(join(workDir, 'gold.json'), 'utf8'))

/** kept[i] = original char i appears unchanged in the LCS with b. */
function lcsKeep(a, b) {
  const n = a.length
  const m = b.length
  const kept = new Uint8Array(n)
  let p = 0
  while (p < n && p < m && a[p] === b[p]) { kept[p] = 1; p += 1 }
  let s = 0
  while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) { kept[n - 1 - s] = 1; s += 1 }
  const A = a.slice(p, n - s)
  const B = b.slice(p, m - s)
  if (A.length === 0 || B.length === 0) return kept
  if (A.length * B.length > 30_000_000) return kept
  const w = B.length + 1
  const dp = new Uint16Array((A.length + 1) * w)
  for (let i = A.length - 1; i >= 0; i -= 1) {
    for (let j = B.length - 1; j >= 0; j -= 1) {
      dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { kept[p + i] = 1; i += 1; j += 1 } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i += 1
    else j += 1
  }
  return kept
}

function align(original, output) {
  const a = original.split('\n')
  const b = output.split('\n')
  if (a.length !== b.length) return lcsKeep(original, output)
  const kept = new Uint8Array(original.length)
  let offset = 0
  a.forEach((line, k) => {
    kept.set(lcsKeep(line, b[k]), offset)
    offset += line.length + 1
    if (k < a.length - 1) kept[offset - 1] = 1
  })
  return kept
}

const identifying = (ch) => /[\p{Script=Han}A-Za-z0-9]/u.test(ch)
const count = (text, term) => text.split(term).length - 1
const inc = (obj, key, field, n = 1) => { const o = (obj[key] ??= { n: 0, leaked: 0, partial: 0, lost: 0 }); o[field] += n }

const results = {}
for (const config of configs) {
  const byType = {}
  const byCase = {}
  const byKind = {}
  const byTrap = {}
  const leaks = []
  const overSpans = []
  let occ = 0, leaked = 0, partial = 0, cleanFiles = 0, broken = 0, missing = 0
  let nonIdChars = 0, overChars = 0, decoys = 0, decoysLost = 0
  for (const file of gold.files) {
    const original = await readFile(join(workDir, 'corpus', file.name), 'utf8')
    let output
    try { output = await readFile(join(workDir, 'out', config, file.name), 'utf8') } catch { output = ''; missing += 1 }
    if (file.name.endsWith('.json') && output) { try { JSON.parse(output) } catch { broken += 1 } }
    const kept = align(original, output)
    const skip = new Uint8Array(original.length) // identifier or neutral
    for (const g of file.neutral ?? []) skip.fill(1, g.start, g.end)
    let fileLeaks = 0
    for (const g of file.identifiers) {
      skip.fill(1, g.start, g.end)
      let keptChars = 0
      let run = 0
      let longest = 0
      for (let i = g.start; i < g.end; i += 1) {
        if (kept[i]) { keptChars += 1; if (identifying(original[i])) { run += 1; longest = Math.max(longest, run) } } else run = 0
      }
      const isLeak = keptChars / (g.end - g.start) > 0.5
      const isPartial = !isLeak && longest >= 4
      occ += 1
      for (const [obj, key] of [[byType, g.type], [byCase, g.case], [byKind, file.kind]]) {
        inc(obj, key, 'n')
        if (isLeak) inc(obj, key, 'leaked')
        if (isPartial) inc(obj, key, 'partial')
      }
      if (isLeak) {
        leaked += 1
        fileLeaks += 1
        leaks.push({ file: file.name, type: g.type, case: g.case, text: g.text })
      }
      if (isPartial) partial += 1
    }
    if (fileLeaks === 0) cleanFiles += 1
    let runStart = -1
    for (let i = 0; i <= original.length; i += 1) {
      const outside = i < original.length && !skip[i]
      const changed = outside && !kept[i]
      if (outside) { nonIdChars += 1; if (changed) overChars += 1 }
      if (changed && runStart < 0) runStart = i
      if (!changed && runStart >= 0) {
        const text = original.slice(runStart, i)
        if (/[\p{Script=Han}A-Za-z0-9]/u.test(text)) overSpans.push({ file: file.name, text, context: original.slice(Math.max(0, runStart - 8), i + 8).replace(/\n/g, '⏎') })
        runStart = -1
      }
    }
    const seen = new Set()
    for (const { text, cat } of file.decoys) {
      if (seen.has(text)) continue
      seen.add(text)
      const before = count(original, text)
      const after = count(output, text)
      decoys += before
      inc(byTrap, cat, 'n', before)
      if (after < before) { decoysLost += before - after; inc(byTrap, cat, 'lost', before - after) }
    }
  }
  let run = null
  try { run = JSON.parse(await readFile(join(workDir, 'results', `${config}.json`), 'utf8')) } catch { /* not run */ }
  results[config] = {
    occurrences: occ, leaked, partial, recall: 1 - leaked / occ, cleanFiles, files: gold.files.length, broken, missing,
    nonIdChars, overChars, overSpans: overSpans.length, decoys, decoysLost,
    byType, byCase, byKind, byTrap, run, leaks, overSpanList: overSpans,
  }
}
await writeFile(join(workDir, 'score.json'), JSON.stringify({ kinds: gold.kinds, results }, null, 2))

const tokens = (r) => (r.run?.models?.detect?.tokens ?? 0) + (r.run?.models?.verify?.tokens ?? 0)
const calls = (r) => (r.run?.models?.detect?.calls ?? 0) + (r.run?.models?.verify?.calls ?? 0)
console.log('| 配置 | 泄漏 | 召回率 | 全清文件 | 误改片段 | 诱饵丢失 | JSON 损坏 | 调用 | tokens | 用时 | 待复核文件 |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|')
for (const [config, r] of Object.entries(results)) {
  console.log(`| ${config} | ${r.leaked}/${r.occurrences} | ${(100 * r.recall).toFixed(1)}% | ${r.cleanFiles}/${r.files} | ${r.overSpans} | ${r.decoysLost}/${r.decoys} | ${r.broken} | ${calls(r)} | ${tokens(r)} | ${r.run ? Math.round(r.run.ms / 1000) + 's' : '—'} | ${r.run?.filesReview ?? '—'} |`)
}
