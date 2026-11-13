/**
 * Scores configurations on real data without gold labels.
 *
 *   node eval/bench/real-score.mjs <workDir> extract <config...>
 *   node eval/bench/real-score.mjs <workDir> judge
 *   node eval/bench/real-score.mjs <workDir> score
 *
 * extract  Walks every original JSON file and each configuration's output in
 *          parallel (values by position) and aligns each changed value by
 *          characters. Every span a configuration changed becomes a candidate;
 *          distinct candidate texts (with one context) go to units.json.
 * judge    Both local models judge every distinct candidate: is it (or does it
 *          contain) a direct identifier, and which exact substring. Agreement
 *          → label; disagreement → uncertain. judgments.json.
 * score    Reference identifiers = agreed cores at their positions. Per config:
 *          leaks (a reference identifier ≤ 50 % changed), over-redaction
 *          (changed characters outside every reference identifier, in spans
 *          judged not to be identifiers), uncertain spans; by type, field and
 *          record category. real-score.json holds aggregates only.
 *
 * Original texts stay in units.json / judgments.json (0600, in workDir, which
 * should live beside the data). Nothing here prints originals.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLlm } from '../../lib/llm.js'
import { DETECT, VERIFY } from './models.mjs'

const [workDir, step, ...configs] = process.argv.slice(2)
const manifest = JSON.parse(await readFile(join(workDir, 'manifest.json'), 'utf8'))
const PRIVATE = { mode: 0o600 }
const identifying = /[\p{Script=Han}A-Za-z0-9]/u

// ------------------------------------------------------------- alignment
/** kept[i] = 1 when a[i] survives unchanged in b (LCS / Myers). */
function keptMask(a, b) {
  const n = a.length
  const m = b.length
  const kept = new Uint8Array(n)
  let p = 0
  while (p < n && p < m && a[p] === b[p]) { kept[p] = 1; p += 1 }
  let s = 0
  while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) { kept[n - 1 - s] = 1; s += 1 }
  const A = a.slice(p, n - s)
  const B = b.slice(p, m - s)
  if (!A.length || !B.length) return kept
  if (A.length * B.length <= 4_000_000) {
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
  // Myers O(ND) for long values with few edits.
  const N = A.length
  const M = B.length
  const max = Math.min(N + M, 6000)
  const off = max + 1
  const trace = []
  let v = new Int32Array(2 * max + 3)
  let found = false
  for (let d = 0; d <= max && !found; d += 1) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < N && y < M && A[x] === B[y]) { x += 1; y += 1 }
      v[off + k] = x
      if (x >= N && y >= M) { found = true; break }
    }
  }
  if (!found) return kept // too different: middle counts as changed
  let x = N
  let y = M
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d -= 1) {
    const vv = trace[d]
    const k = x - y
    const prevK = (k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1])) ? k + 1 : k - 1
    const prevX = vv[off + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) { kept[p + x - 1] = 1; x -= 1; y -= 1 }
    if (d > 0) { x = prevX; y = prevY }
  }
  return kept
}

/** Leaf values paired by position: [path, original string, output string|undefined, field]. */
function* pairs(o, x, path = '', field = '') {
  if (Array.isArray(o)) {
    for (let i = 0; i < o.length; i += 1) yield* pairs(o[i], Array.isArray(x) ? x[i] : undefined, `${path}[${i}]`, field)
    return
  }
  if (o && typeof o === 'object') {
    const keys = Object.keys(o)
    const xKeys = x && typeof x === 'object' ? Object.keys(x) : []
    const label = typeof o.ITM_NM === 'string' ? o.ITM_NM.slice(0, 16) : ''
    for (const [i, key] of keys.entries()) {
      const name = label && key !== 'ITM_NM' ? `${key}[${label}]` : key
      yield* pairs(o[key], xKeys[i] !== undefined ? x[xKeys[i]] : undefined, `${path}.${i}`, name)
    }
    return
  }
  if (o === null || o === undefined) return
  yield [path, String(o), x === undefined || x === null ? undefined : String(x), field]
}

// A whole value replaced by one token: pipeline pseudonym or the baseline's
// placeholder. Then the value is one span (no character coincidences).
const WHOLE_TOKEN = /^(?:[\p{Script=Han}]{2,3}-[0-9A-F]{6,8}|【[^】]{1,8}】|\[[^\]]{1,8}\])$/u

/**
 * Changed spans of a value. Character-level alignment lets a few digits of a
 * pseudonym ("医院-4F2A19") coincide with digits of the code it replaced, which
 * cuts one replacement into fragments: runs separated by ≤ 3 kept letters or
 * digits are merged back into one span.
 */
function changedSpans(text, kept, out) {
  const trimmed = text.trim()
  if (out !== undefined && WHOLE_TOKEN.test(out.trim()) && trimmed && identifying.test(trimmed)) {
    const s = text.indexOf(trimmed)
    return [[s, s + trimmed.length]]
  }
  const raw = rawSpans(text, kept)
  const merged = []
  for (const span of raw) {
    const last = merged.at(-1)
    if (last && span[0] - last[1] <= 3 && /^[A-Za-z0-9]*$/.test(text.slice(last[1], span[0]))) last[1] = span[1]
    else merged.push([...span])
  }
  return merged
}

function rawSpans(text, kept) {
  const out = []
  let start = -1
  for (let i = 0; i <= text.length; i += 1) {
    const changed = i < text.length && !kept[i]
    if (changed && start < 0) start = i
    if (!changed && start >= 0) {
      let s = start
      let e = i
      while (s < e && /\s/.test(text[s])) s += 1
      while (e > s && /\s/.test(text[e - 1])) e -= 1
      if (e > s && identifying.test(text.slice(s, e))) out.push([s, e])
      start = -1
    }
  }
  return out
}

const contextOf = (text, s, e) => `${s > 60 ? '…' : ''}${text.slice(Math.max(0, s - 60), s)}【${text.slice(s, e)}】${text.slice(e, e + 60)}${e + 60 < text.length ? '…' : ''}`

// ------------------------------------------------------------- extract
async function extract() {
  const units = new Map() // text -> { text, field, category, context, n }
  const values = [] // per changed value: { file, path, field, category, text, masks: {config: [spans]} }
  const broken = {}
  for (const item of manifest) {
    const original = JSON.parse(await readFile(join(workDir, 'corpus', item.file), 'utf8'))
    const outputs = {}
    for (const config of configs) {
      try { outputs[config] = JSON.parse(await readFile(join(workDir, 'out', config, item.file), 'utf8')) } catch { broken[config] = (broken[config] ?? 0) + 1; outputs[config] = null }
    }
    const iters = Object.fromEntries(configs.map((config) => [config, outputs[config] === null ? null : pairs(original, outputs[config])]))
    for (const [path, text, , field] of pairs(original, original)) {
      const changed = {}
      for (const config of configs) {
        const next = iters[config]?.next().value
        if (!next) { changed[config] = null; continue } // broken output: unknown
        const out = next[2] ?? ''
        if (out === text) { changed[config] = []; continue }
        changed[config] = changedSpans(text, keptMask(text, out), out)
      }
      if (!Object.values(changed).some((spans) => spans?.length)) continue
      values.push({ file: item.file, category: item.category, path, field, text, changed })
      for (const spans of Object.values(changed)) {
        for (const [s, e] of spans ?? []) {
          const key = text.slice(s, e)
          const unit = units.get(key) ?? { text: key, field, category: item.category, context: contextOf(text, s, e), n: 0 }
          unit.n += 1
          units.set(key, unit)
        }
      }
    }
  }
  await writeFile(join(workDir, 'values.json'), JSON.stringify({ configs, broken, values }), PRIVATE)
  await writeFile(join(workDir, 'units.json'), JSON.stringify([...units.values()]), PRIVATE)
  console.log(`changed values ${values.length}, distinct candidate spans ${units.size}, broken outputs ${JSON.stringify(broken)}`)
}

// ------------------------------------------------------------- judge
const TYPES = ['姓名', '医生', '身份证号', '电话', '邮箱', '地址', '病历号', '住院号', '就诊号', '社保号', '银行卡号', '医院']
function judgePrompt(items) {
  return [{
    role: 'user',
    content: `你是医疗数据去标识化的评测标注员。每条候选是病历中被某个脱敏系统改动过的一段文字（context 中用【】标出），请判断这段文字是否是、或是否包含能直接识别个人身份的信息。

直接标识符类型：${TYPES.join('、')}（医生含护士、技师等具体医护人员姓名；医院指具体的医疗机构名称或该机构的机构代码）。
能回查到具体病人或具体一次就诊/一份记录的编号也是直接标识符：病案号、住院号、门（急）诊号、就诊流水号、健康档案号、医保/就诊卡号、申请单号、报告单号、记录主键等，类型记为病历号、住院号或就诊号。
不是直接标识符：科室/病区/病房名称、床号、药品、检验/检查项目、诊断、症状、职称、机构类别（如“社区医院”“上级医院”）、证件类型、日期时间、年龄、性别、计量数值、字典/目录编码（ICD、项目编码、药品编码、科室代码、收费项目编码等通用代码）、通用词。
只有一个片段、看不出完整值时（如长编号中间的几位数字），按它所在的完整值判断。
输出格式：{"r":[{"i":序号,"id":true或false,"core":"标识符原文","type":"类型"}]}
- id=true 时，core 必须逐字摘自【】内文字，只保留标识符本身（如【患者张三】的 core 为“张三”）；【】内有多个标识符时取最主要的一个。
- id=false 时 core 为空字符串。
每条都必须给出结论；只输出 JSON。

候选：${JSON.stringify(items)}`,
  }]
}

async function judgeWith(llm, units, label) {
  const out = new Map()
  const batches = []
  for (let i = 0; i < units.length; i += 25) batches.push(units.slice(i, i + 25).map((unit, k) => ({ i: i + k, field: unit.field, context: unit.context })))
  let done = 0
  let failed = 0
  const queue = [...batches]
  const worker = async () => {
    while (queue.length) {
      const batch = queue.shift()
      try {
        const reply = await llm.chatJson(judgePrompt(batch), { maxTokens: 3000, validate: (j) => Array.isArray(j?.r) })
        for (const r of reply.json.r) if (Number.isInteger(r?.i) && typeof r.id === 'boolean') out.set(r.i, { id: r.id, core: String(r.core ?? ''), type: String(r.type ?? '') })
      } catch { failed += 1 }
      done += 1
      if (done % 20 === 0) console.log(`  ${label}: ${done}/${batches.length} batches`)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  console.log(`  ${label}: ${batches.length} batches, ${failed} failed, ${out.size}/${units.length} judged`)
  return out
}

async function judge() {
  const units = JSON.parse(await readFile(join(workDir, 'units.json'), 'utf8'))
  // Raw answers of earlier runs (same prompt), by text: only new texts are sent.
  let cache = {}
  try { cache = JSON.parse(await readFile(join(workDir, 'judge-cache.json'), 'utf8')) } catch { /* first run */ }
  const fresh = units.filter((unit) => !cache[unit.text])
  const make = (baseURL, model) => createLlm({ baseURL, model, timeoutMs: 180000, temperature: 0, disableThinking: true })
  const qwen = make(DETECT.baseURL, DETECT.model)
  const gemma = make(VERIFY.baseURL, VERIFY.model)
  console.log(`judging ${fresh.length} new of ${units.length}`)
  const [a, b] = await Promise.all([judgeWith(qwen, fresh, DETECT.model), judgeWith(gemma, fresh, VERIFY.model)])
  fresh.forEach((unit, i) => { if (a.has(i) && b.has(i)) cache[unit.text] = [a.get(i), b.get(i)] })
  await writeFile(join(workDir, 'judge-cache.json'), JSON.stringify(cache), PRIVATE)
  const verdicts = units.map((unit) => {
    const [x, y] = cache[unit.text] ?? []
    const valid = (r) => r && (!r.id || (r.core && unit.text.includes(r.core)))
    if (!valid(x) || !valid(y)) return { label: 'uncertain', why: 'missing' }
    if (x.id !== y.id) return { label: 'uncertain', why: 'disagree' }
    if (!x.id) return { label: 'no' }
    // Both yes: the shorter core when one contains the other, else qwen's.
    const core = x.core.includes(y.core) ? y.core : y.core.includes(x.core) ? x.core : x.core
    const type = TYPES.includes(x.type) ? x.type : TYPES.includes(y.type) ? y.type : '其他'
    return { label: 'yes', core, type }
  })
  await writeFile(join(workDir, 'judgments.json'), JSON.stringify(verdicts), PRIVATE)
  const count = (label) => verdicts.filter((v) => v.label === label).length
  console.log(`yes ${count('yes')}, no ${count('no')}, uncertain ${count('uncertain')}`)
}

// ------------------------------------------------------------- score
async function score() {
  const { configs: names, broken, values } = JSON.parse(await readFile(join(workDir, 'values.json'), 'utf8'))
  const units = JSON.parse(await readFile(join(workDir, 'units.json'), 'utf8'))
  const verdicts = JSON.parse(await readFile(join(workDir, 'judgments.json'), 'utf8'))
  const verdictOf = new Map(units.map((unit, i) => [unit.text, verdicts[i]]))
  const per = Object.fromEntries(names.map((c) => [c, {
    refs: 0, leaked: 0, unknown: 0, overChars: 0, overSpans: 0, uncertainSpans: 0, changedSpans: 0,
    leakByType: {}, leakByCategory: {}, leakByField: {}, overByCategory: {}, overByField: {}, refsByType: {},
  }]))
  const totals = { values: values.length, refs: 0, refsByType: {}, refsByCategory: {}, uncertain: 0, agreedNo: 0 }
  const inc = (obj, key, n = 1) => { obj[key] = (obj[key] ?? 0) + n }
  for (const value of values) {
    // Reference identifiers in this value: agreed cores of every span any
    // configuration changed, located inside that span.
    const refs = []
    const seen = new Set()
    const noSpans = []
    for (const spans of Object.values(value.changed)) {
      for (const [s, e] of spans ?? []) {
        const v = verdictOf.get(value.text.slice(s, e))
        if (v?.label === 'yes') {
          const at = value.text.indexOf(v.core, s)
          if (at < 0 || at + v.core.length > e) continue
          const key = `${at}:${at + v.core.length}`
          if (seen.has(key)) continue
          seen.add(key)
          refs.push({ s: at, e: at + v.core.length, type: v.type })
        } else if (v?.label === 'no') noSpans.push([s, e])
      }
    }
    // Overlapping references: keep the longer one.
    refs.sort((x, y) => (y.e - y.s) - (x.e - x.s))
    const kept = []
    for (const ref of refs) if (!kept.some((k) => ref.s < k.e && k.s < ref.e)) kept.push(ref)
    totals.refs += kept.length
    for (const ref of kept) { inc(totals.refsByType, ref.type); inc(totals.refsByCategory, value.category) }
    const inRef = new Uint8Array(value.text.length)
    for (const ref of kept) inRef.fill(1, ref.s, ref.e)
    for (const config of names) {
      const r = per[config]
      const spans = value.changed[config]
      if (spans === null) { r.unknown += kept.length; continue }
      const changed = new Uint8Array(value.text.length)
      for (const [s, e] of spans) changed.fill(1, s, e)
      for (const ref of kept) {
        r.refs += 1
        inc(r.refsByType, ref.type)
        let n = 0
        for (let i = ref.s; i < ref.e; i += 1) n += changed[i]
        if (n / (ref.e - ref.s) <= 0.5) {
          r.leaked += 1
          inc(r.leakByType, ref.type)
          inc(r.leakByCategory, value.category)
          inc(r.leakByField, value.field)
        }
      }
      for (const [s, e] of spans) {
        r.changedSpans += 1
        const v = verdictOf.get(value.text.slice(s, e))
        if (v?.label === 'uncertain') { r.uncertainSpans += 1; continue }
        // Characters outside reference identifiers that this config changed:
        // over-redaction (a whole non-identifier, or the prose around a name).
        let over = 0
        for (let i = s; i < e; i += 1) if (!inRef[i] && identifying.test(value.text[i])) over += 1
        if (over > 0 && (v?.label === 'no' || over >= 2)) {
          r.overChars += over
          r.overSpans += 1
          inc(r.overByCategory, value.category)
          inc(r.overByField, value.field)
        }
      }
    }
  }
  totals.uncertain = verdicts.filter((v) => v.label === 'uncertain').length
  totals.agreedNo = verdicts.filter((v) => v.label === 'no').length
  totals.agreedYes = verdicts.filter((v) => v.label === 'yes').length
  totals.distinct = units.length
  const results = {}
  for (const config of names) {
    let run = null
    try { run = JSON.parse(await readFile(join(workDir, 'results', `${config}.json`), 'utf8')) } catch { /* none */ }
    const top = (obj, n = 8) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n))
    const r = per[config]
    results[config] = {
      ...r, leakByField: top(r.leakByField), overByField: top(r.overByField),
      recall: r.refs ? 1 - r.leaked / r.refs : null, broken: broken[config] ?? 0,
      run: run && { ms: run.ms, status: run.status, models: run.models, reviewItems: run.reviewItems, filesReview: run.filesReview, reviewCodes: run.reviewCodes, blind: run.blind },
    }
  }
  const categories = {}
  for (const item of manifest) inc(categories, item.category)
  await writeFile(join(workDir, 'real-score.json'), JSON.stringify({ files: manifest.length, bytes: manifest.reduce((a, f) => a + f.size, 0), patients: new Set(manifest.map((f) => f.patient)).size, categories, totals, results }, null, 2))
  for (const [config, r] of Object.entries(results)) {
    console.log(`${config.padEnd(12)} refs ${r.refs} leaked ${r.leaked} (${r.recall === null ? '—' : (100 * r.recall).toFixed(1) + '%'}) over ${r.overSpans} spans/${r.overChars} chars uncertain ${r.uncertainSpans} broken ${r.broken}`)
  }
}

if (step === 'extract') await extract()
else if (step === 'judge') await judge()
else if (step === 'score') await score()
else throw new Error('step: extract | judge | score')
