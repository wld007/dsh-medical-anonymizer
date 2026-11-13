/**
 * Runs one or more system configurations over a corpus.
 *
 *   node eval/bench/run.mjs <workDir> <config...>
 *
 * Input: <workDir>/corpus (any files the plugin reads). Configurations:
 *   rules       rules only (no model)
 *   model       single model only: detection prompt on raw text chunks, then
 *               exact-string replace (no rules, no field hints, no verification)
 *   rules+model rules + detection model, verification disabled, 1 round
 *   full        rules + detection model + separate verification model (3 rounds)
 *   full-same   as full, but the detection model also verifies
 * "name@tag" repeats a configuration into its own folder ("full@2").
 * BENCH_LIB=<dir> runs the pipeline from another copy of lib/ (e.g. an older
 * release); the result name should say so ("full@old").
 *
 * Model endpoints: see models.mjs (env or the plugin's saved settings); request
 * slots: BENCH_SLOTS (default 8, same for every configuration).
 * Writes <workDir>/out/<config>/ (anonymized files, same relative paths) and
 * <workDir>/results/<config>.json (cost and review statistics, no originals).
 */
import { cp, mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [workDir = 'eval/bench/.work', ...configs] = process.argv.slice(2)
const corpus = join(workDir, 'corpus')
const libDir = resolve(process.env.BENCH_LIB ?? new URL('../../lib', import.meta.url).pathname)
const { runBatch } = await import(pathToFileURL(join(libDir, 'pipeline.js')).href)
const { createLlm, detectPrompt, entitiesOf } = await import(pathToFileURL(join(libDir, 'llm.js')).href)

const { DETECT, VERIFY } = await import('./models.mjs')
const SLOTS = Number(process.env.BENCH_SLOTS ?? 8)
const llmOf = (target) => createLlm({ ...target, timeoutMs: 180000, temperature: 0, disableThinking: true })

/** Counts calls/tokens of a model client. */
function counted(llm, stats) {
  return {
    ...llm,
    async chatJson(messages, opts) {
      const t0 = Date.now()
      stats.calls += 1
      try {
        const reply = await llm.chatJson(messages, opts)
        stats.tokens += reply.usage?.total_tokens ?? 0
        return reply
      } catch (error) {
        stats.failed = (stats.failed ?? 0) + 1
        throw error
      } finally { stats.ms += Date.now() - t0 }
    },
  }
}
const noVerify = { model: 'none', baseURL: '', async chatJson() { return { json: { issues: [] }, text: '{"issues":[]}', usage: null, attempts: 1 } } }

async function listFiles(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await listFiles(path, base))
    else out.push(relative(base, path))
  }
  return out.sort()
}

async function exists(path) { try { await stat(path); return true } catch { return false } }

async function runPipeline(name, { llm, verifyLlm, maxRounds }) {
  const root = join(workDir, 'runs', name)
  await rm(root, { recursive: true, force: true })
  const stats = { detect: { calls: 0, tokens: 0, ms: 0 }, verify: { calls: 0, tokens: 0, ms: 0 } }
  const t0 = Date.now()
  const run = await runBatch({
    inputDir: corpus,
    outputRoot: root,
    options: {
      runId: `bench-${name.replace(/[^\w-]/g, '_')}`, maxRounds, concurrency: SLOTS, verifyConcurrency: SLOTS,
      llm: llm ? counted(llm, stats.detect) : null,
      verifyLlm: verifyLlm ? counted(verifyLlm, stats.verify) : null,
      disableThinking: true,
    },
  })
  // Delivered folder (completed) or staging (held for review).
  const first = (await listFiles(corpus))[0]
  const staging = join(root, '_records', 'runs', run.id, 'output')
  const candidates = [run.output, join(staging, run.deliverName ?? 'corpus'), staging].filter(Boolean)
  let delivered = null
  for (const dir of candidates) if (await exists(join(dir, first))) { delivered = dir; break }
  if (!delivered) throw new Error(`${name}: output not found (${run.status})`)
  const out = join(workDir, 'out', name)
  await rm(out, { recursive: true, force: true })
  await cp(delivered, out, { recursive: true })
  const reviewCodes = {}
  let reviewItems = 0
  for (const file of run.files ?? []) {
    for (const issue of file.issues ?? []) {
      if (issue.severity !== 'error') continue
      reviewItems += 1
      reviewCodes[issue.code] = (reviewCodes[issue.code] ?? 0) + 1
    }
  }
  return {
    config: name, lib: libDir, status: run.status, ms: Date.now() - t0, models: stats,
    files: run.totals?.files ?? 0, entities: run.totals?.entities ?? 0, byType: run.totals?.byType ?? {},
    filesReview: run.totals?.filesReview ?? 0, reviewItems, reviewCodes, blind: run.totals?.blind ?? null,
  }
}

/** Chunks of ≤ max chars, cut at a line break, else after "," / "}" / "]" / "。". */
function chunksOf(text, max = 1400) {
  const out = []
  let from = 0
  while (from < text.length) {
    if (text.length - from <= max) { out.push(text.slice(from)); break }
    const window = text.slice(from, from + max)
    let cut = window.lastIndexOf('\n') + 1
    if (cut < max / 3) cut = Math.max(window.lastIndexOf(',') , window.lastIndexOf('}'), window.lastIndexOf(']'), window.lastIndexOf('。')) + 1
    if (cut < max / 3) cut = max
    out.push(text.slice(from, from + cut))
    from += cut
  }
  return out
}

/** A request limiter shared by all files (SLOTS requests in flight). */
function limiter(limit) {
  let active = 0
  const queue = []
  const next = () => { if (active < limit && queue.length) { active += 1; queue.shift()() } }
  return async (fn) => {
    await new Promise((go) => { queue.push(go); next() })
    try { return await fn() } finally { active -= 1; next() }
  }
}

/** Single-model baseline: what one would do with an LLM alone. */
async function runModelOnly(name, llm) {
  const out = join(workDir, 'out', name)
  await rm(out, { recursive: true, force: true })
  const stats = { calls: 0, tokens: 0, ms: 0, failed: 0 }
  const model = counted(llm, stats)
  const slot = limiter(SLOTS)
  const t0 = Date.now()
  let entities = 0
  const files = await listFiles(corpus)
  await Promise.all(files.map(async (rel) => {
    const text = await readFile(join(corpus, rel), 'utf8')
    const found = new Map()
    await Promise.all(chunksOf(text).map((chunk) => slot(async () => {
      try {
        const reply = await model.chatJson(detectPrompt([{ id: '1', text: chunk }]), { maxTokens: 4000, validate: (j) => Array.isArray(j?.e) || Array.isArray(j?.entities) })
        for (const entity of entitiesOf(reply.json)) {
          const value = entity.text.trim()
          if (value.length >= 2) found.set(value, entity.type)
        }
      } catch { /* counted in stats.failed */ }
    })))
    let result = text
    for (const value of [...found.keys()].sort((a, b) => b.length - a.length)) {
      const parts = result.split(value)
      entities += parts.length - 1
      result = parts.join(`【${found.get(value)}】`)
    }
    await mkdir(join(out, rel, '..'), { recursive: true })
    await writeFile(join(out, rel), result)
  }))
  return {
    config: name, status: stats.failed ? 'partial' : 'completed', ms: Date.now() - t0, models: { detect: stats },
    files: files.length, entities, filesReview: 0, reviewItems: 0, reviewCodes: {},
  }
}

await mkdir(join(workDir, 'results'), { recursive: true })
for (const name of configs) {
  console.log(`[${new Date().toISOString()}] ${name} ...`)
  const base = name.split('@')[0]
  let result
  if (base === 'rules') result = await runPipeline(name, { llm: null, verifyLlm: null, maxRounds: 3 })
  else if (base === 'model') result = await runModelOnly(name, llmOf(DETECT))
  else if (base === 'rules+model') result = await runPipeline(name, { llm: llmOf(DETECT), verifyLlm: noVerify, maxRounds: 1 })
  else if (base === 'full') result = await runPipeline(name, { llm: llmOf(DETECT), verifyLlm: llmOf(VERIFY), maxRounds: 3 })
  else if (base === 'full-same') result = await runPipeline(name, { llm: llmOf(DETECT), verifyLlm: null, maxRounds: 3 })
  else throw new Error(`unknown config ${name}`)
  await writeFile(join(workDir, 'results', `${name}.json`), JSON.stringify(result, null, 2))
  console.log(`[${new Date().toISOString()}] ${name} done in ${Math.round(result.ms / 1000)}s, status ${result.status}, calls ${(result.models.detect?.calls ?? 0) + (result.models.verify?.calls ?? 0)}`)
}
