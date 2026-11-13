/**
 * Scores anonymized outputs against the gold spans.
 *
 *   node eval/bench/score.mjs <workDir> <config...>
 *
 * Original and output are aligned character by character (LCS per line; the
 * pipeline keeps line structure). For each original character we know whether
 * it survived verbatim. Then:
 *   - an identifier occurrence LEAKS when more than half of its characters
 *     survive (a 3-char name with 2 chars left, an ID number left intact);
 *   - it is PARTIAL when it does not leak but a run of ≥ 4 identifying
 *     characters (CJK / letters / digits) survives (e.g. a road and number);
 *   - every changed character outside identifier spans is OVER-REDACTION;
 *   - a decoy (eponymous disease, herb, ward, ICD code...) is LOST when it
 *     occurs fewer times in the output than in the original.
 * Writes <workDir>/score.json and prints a Markdown summary.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [workDir = 'eval/bench/.work', ...configs] = process.argv.slice(2)
const gold = JSON.parse(await readFile(join(workDir, 'gold.json'), 'utf8'))

/** kept[i] = original char i appears unchanged in the LCS with b. */
function lcsKeep(a, b) {
  const n = a.length
  const m = b.length
  const kept = new Uint8Array(n)
  // Trim common prefix/suffix first (most of each line).
  let p = 0
  while (p < n && p < m && a[p] === b[p]) { kept[p] = 1; p += 1 }
  let s = 0
  while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) { kept[n - 1 - s] = 1; s += 1 }
  const A = a.slice(p, n - s)
  const B = b.slice(p, m - s)
  if (A.length === 0 || B.length === 0) return kept
  if (A.length * B.length > 30_000_000) return kept // treat as fully changed (never hit on this corpus)
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
const pct = (x, y) => (y ? (100 * x / y).toFixed(1) : '—')

const results = {}
for (const config of configs) {
  const byType = {}
  const byKind = {}
  const leaks = []
  const partials = []
  const overSpans = []
  let occ = 0, leaked = 0, partial = 0, cleanFiles = 0
  let nonIdChars = 0, overChars = 0, decoys = 0, decoysLost = 0
  const lostDecoys = {}
  for (const file of gold.files) {
    const original = await readFile(join(workDir, 'corpus', file.name), 'utf8')
    let output
    try { output = await readFile(join(workDir, 'out', config, file.name), 'utf8') } catch { output = '' }
    const kept = align(original, output)
    const inId = new Uint8Array(original.length)
    let fileLeaks = 0
    for (const g of file.identifiers) {
      for (let i = g.start; i < g.end; i += 1) inId[i] = 1
      let keptChars = 0
      let run = 0
      let longest = 0
      for (let i = g.start; i < g.end; i += 1) {
        if (kept[i]) { keptChars += 1; if (identifying(original[i])) { run += 1; longest = Math.max(longest, run) } } else run = 0
      }
      const isLeak = keptChars / (g.end - g.start) > 0.5
      // ≥ 4: pseudonym hex digits coincide with 2–3 original digits by chance.
      const isPartial = !isLeak && longest >= 4
      const t = (byType[g.type] ??= { n: 0, leaked: 0, partial: 0 })
      const k = (byKind[file.kind] ??= { n: 0, leaked: 0 })
      t.n += 1; k.n += 1; occ += 1
      if (isLeak) { t.leaked += 1; k.leaked += 1; leaked += 1; fileLeaks += 1; leaks.push({ file: file.name, type: g.type, text: g.text, context: original.slice(Math.max(0, g.start - 12), g.end + 12).replace(/\n/g, '⏎') }) }
      if (isPartial) {
        t.partial += 1; partial += 1
        const left = [...g.text].map((ch, i) => (kept[g.start + i] ? ch : '·')).join('')
        partials.push({ file: file.name, type: g.type, text: g.text, left })
      }
    }
    if (fileLeaks === 0) cleanFiles += 1
    // Over-redaction: changed chars outside identifiers, grouped in runs.
    let runStart = -1
    for (let i = 0; i <= original.length; i += 1) {
      const changed = i < original.length && !inId[i] && !kept[i]
      if (i < original.length && !inId[i]) { nonIdChars += 1; if (changed) overChars += 1 }
      if (changed && runStart < 0) runStart = i
      if (!changed && runStart >= 0) {
        const text = original.slice(runStart, i)
        if (/[\p{Script=Han}A-Za-z0-9]/u.test(text)) overSpans.push({ file: file.name, text, context: original.slice(Math.max(0, runStart - 8), i + 8).replace(/\n/g, '⏎') })
        runStart = -1
      }
    }
    for (const term of new Set(file.decoys)) {
      const before = count(original, term)
      const after = count(output, term)
      decoys += before
      if (after < before) { decoysLost += before - after; lostDecoys[term] = (lostDecoys[term] ?? 0) + before - after }
    }
  }
  let run = null
  try { run = JSON.parse(await readFile(join(workDir, 'results', `${config}.json`), 'utf8')) } catch { /* not run */ }
  results[config] = {
    occurrences: occ, leaked, partial, recall: 1 - leaked / occ, cleanFiles, files: gold.files.length,
    nonIdChars, overChars, overSpans: overSpans.length, decoys, decoysLost, lostDecoys,
    byType, byKind, run, leaks, partials, overSpanList: overSpans,
  }
}
await writeFile(join(workDir, 'score.json'), JSON.stringify(results, null, 2))

// ------------------------------------------------------------ summary
const lines = []
lines.push('| 配置 | 标识符泄漏 | 召回率 | 部分残留 | 全清文件 | 误改字符 | 误改片段 | 诱饵丢失 | 模型调用 | tokens | 用时 | 待复核文件 |')
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const [config, r] of Object.entries(results)) {
  const calls = (r.run?.models?.detect?.calls ?? 0) + (r.run?.models?.verify?.calls ?? 0)
  const tokens = (r.run?.models?.detect?.tokens ?? 0) + (r.run?.models?.verify?.tokens ?? 0)
  lines.push(`| ${config} | ${r.leaked}/${r.occurrences} | ${(100 * r.recall).toFixed(1)}% | ${r.partial} | ${r.cleanFiles}/${r.files} | ${r.overChars} (${pct(r.overChars, r.nonIdChars)}%) | ${r.overSpans} | ${r.decoysLost}/${r.decoys} | ${calls} | ${tokens} | ${r.run ? Math.round(r.run.ms / 1000) + 's' : '—'} | ${r.run?.filesReview ?? '—'} |`)
}
lines.push('')
const types = Object.keys(results[configs[0]].byType)
lines.push(`| 类型 (n) | ${configs.join(' | ')} |`)
lines.push(`|---|${configs.map(() => '---').join('|')}|`)
for (const type of types) lines.push(`| ${type} (${results[configs[0]].byType[type].n}) | ${configs.map((c) => results[c].byType[type].leaked).join(' | ')} |`)
lines.push('')
const kinds = Object.keys(results[configs[0]].byKind)
lines.push(`| 文档类型 (n) | ${configs.join(' | ')} |`)
lines.push(`|---|${configs.map(() => '---').join('|')}|`)
for (const kind of kinds) lines.push(`| ${kind} (${results[configs[0]].byKind[kind].n}) | ${configs.map((c) => results[c].byKind[kind].leaked).join(' | ')} |`)
console.log(lines.join('\n'))
