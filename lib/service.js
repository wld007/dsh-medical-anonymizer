/**
 * Run registry shared by the agent tools and the settings page. One operation
 * is implemented once here; both callers use the same methods.
 */
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { runBatch, newRunId, listInputFiles, cleanStaleStaging, displayInputPath, provisionalName, describeError } from './pipeline.js'
import { Vault } from './pseudonym.js'
import { createLlm } from './llm.js'
import { layout, DEFAULT_ROOT, LEGACY_DEFAULT_ROOT, RECORDS_DIR, deliverStaged } from './layout.js'
import { CACHE_FILE } from './replay.js'
import { readZip, writeZip, isZipPath } from './zip.js'
import { isKnownType, isPseudonym, pseudonymSpans, scan } from './rules.js'
import { createHash } from 'node:crypto'
import { renderMarkdown } from './report.js'
import { loadDocument } from './formats.js'
import { layered } from './layers.js'
import { readFileSync } from 'node:fs'

// Installed version, shown on the page header.
const PLUGIN_VERSION = (() => {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '' } catch { return '' }
})()

const EDITABLE = new Set(['.txt', '.md', '.csv', '.json', '.xlsx'])

/**
 * Where one file of a finished batch sits: in the delivered result, or in
 * the run's staging folder while the batch is withheld for review.
 */
function locateDeliverable(run, relPath, runDir) {
  const parts = String(relPath).split('/')
  let top = null
  let rest = parts
  if (run.withheld) top = join(runDir, 'output')
  else if (run.outputKind === 'dir') top = run.output
  else if (run.outputKind === 'file') { top = run.output; rest = parts.slice(1) }
  else if (run.outputKind === 'multi') { top = (run.outputs ?? []).find((item) => basename(item) === parts[0]) ?? null; rest = parts.slice(1) }
  if (!top) return null
  const chain = [top, ...rest]
  const containers = chain.slice(0, -1).map((segment, index) => (isZipPath(segment) ? index : -1)).filter((index) => index >= 0)
  if (containers.length === 0) return { file: join(...chain) }
  if (containers.length > 1) return { nested: true }
  return { zip: join(...chain.slice(0, containers[0] + 1)), entry: chain.slice(containers[0] + 1).join('/') }
}

/** A deliverable (file or single-level zip entry) as a layered document. */
async function readDeliverable(where, relPath, use) {
  if (!where || where.nested) return null
  const ext = extname(relPath).toLowerCase()
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-anon-read-'))
  try {
    const temp = join(scratch, `doc${ext}`)
    if (where.file) {
      await writeFile(temp, await readFile(where.file), { mode: 0o600 })
    } else {
      const { entries } = await readZip(where.zip)
      const target = entries.find((entry) => !entry.isDirectory && entry.name === where.entry)
      if (!target) return null
      await writeFile(temp, target.data, { mode: 0o600 })
    }
    return use(layered(await loadDocument(temp, relPath)))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

const IMAGE_MIME = { 'PNG 图片': 'image/png', 'JPEG 图片': 'image/jpeg', 'GIF 图片': 'image/gif', 'BMP 图片': 'image/bmp', 'WEBP 图片': 'image/webp' }
const PREVIEW_MAX_BYTES = 4 * 1024 * 1024
/** An opaque payload as an image data URI, or null when it is not an image. */
function previewUri(payload) {
  const raw = String(payload.raw ?? '').trim()
  const uri = /^data:(image\/[\w.+-]+)((?:;[\w-]+=[^;,]*)*);base64,([\s\S]*)$/i.exec(raw)
  if (uri) {
    const mime = uri[1].toLowerCase()
    // SVG can carry script; it is not drawn.
    if (mime === 'image/svg+xml') return null
    const body = uri[3].replace(/\s+/g, '')
    return body.length * 0.75 > PREVIEW_MAX_BYTES ? { tooLarge: true } : { src: `data:${mime};base64,${body}` }
  }
  const mime = IMAGE_MIME[payload.kind]
  if (!mime || !/^[A-Za-z0-9+/=_\s-]+$/.test(raw)) return null
  const body = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  return body.length * 0.75 > PREVIEW_MAX_BYTES ? { tooLarge: true } : { src: `data:${mime};base64,${body}` }
}

const IMAGE_CHECKS = 'image-checks.json'
const IMAGE_CATEGORIES = ['signature', 'seal', 'face', 'id_document', 'scanned_text', 'medical_image', 'chart', 'logo', 'blank', 'other']
// Always identify a person, whatever the model says about the text.
const IDENTIFYING = new Set(['signature', 'seal', 'face', 'id_document'])
// Usually harmless when nothing identifying is written on them.
const HARMLESS = new Set(['chart', 'logo', 'blank', 'medical_image'])
const IMAGE_PROMPT = [
  '你在协助医疗数据去标识化的人工复核。看这张从病历中取出的图片：',
  '1. category：从 signature（手写签名）、seal（印章）、face（人脸或证件照）、id_document（身份证、医保卡等证件）、scanned_text（扫描或截图的文字页面）、medical_image（心电图、影像、病理图等）、chart（图表、表格线框）、logo（徽标、图标）、blank（空白或纯色）、other 中选一个；',
  '2. text：图中能看清的文字，原样抄写，没有就留空；',
  '3. identity：这张图能否用来认出某个具体的人（签名、带人名的印章、人脸、证件，或写有姓名、证件号、电话、住址、病历号等的文字）；',
  '4. reason：一句话说明。',
  '只输出 JSON：{"category":"…","text":"…","identity":true,"reason":"…"}',
].join('\n')

async function classifyImage(llm, src, onCall = () => {}) {
  const started = Date.now()
  const entry = { at: new Date(started).toISOString(), stage: '图片识别', round: 1, segments: 1, ms: 0, tokens: 0, result: 'ok' }
  let reply
  try {
    reply = await llm.chatJson([{ role: 'user', content: [{ type: 'text', text: IMAGE_PROMPT }, { type: 'image_url', image_url: { url: src } }] }], {
    maxTokens: 400,
    validate: (json) => json && typeof json === 'object' && IMAGE_CATEGORIES.includes(String(json.category)),
    })
    entry.tokens = Number(reply.usage?.total_tokens ?? 0)
    entry.in = Number(reply.usage?.prompt_tokens ?? 0) || 0
    entry.out = Number(reply.usage?.completion_tokens ?? 0) || 0
    if (Number(reply.attempts) > 1) entry.attempts = reply.attempts
  } catch (error) {
    entry.result = error?.code === 'http-error' ? `http-${error.status ?? 'error'}` : String(error?.code ?? 'error')
    throw error
  } finally {
    entry.ms = Date.now() - started
    onCall(entry)
  }
  const json = reply.json
  const text = String(json.text ?? '').slice(0, 2000)
  // Identifiers in the read text count, whatever the model concluded.
  const hits = text ? scan(text).map((hit) => hit.type) : []
  return { category: String(json.category), text, identity: json.identity === true || hits.length > 0, ruleTypes: [...new Set(hits)], reason: String(json.reason ?? '').slice(0, 200) }
}

/** One review item may embed several images: the most cautious verdict wins. */
/** One image's suggestion from its verdict. */
function suggestionOf(verdict) {
  if (!verdict || verdict.error) return 'unknown'
  if (verdict.identity || IDENTIFYING.has(verdict.category)) return 'remove'
  return HARMLESS.has(verdict.category) ? 'keep' : 'unknown'
}

function mergeVerdicts(found, model, indexes = []) {
  const ok = found.filter((verdict) => verdict && !verdict.error)
  const at = new Date().toISOString()
  // Each image's own reading, by its index in the record (shown per thumbnail).
  const perImage = found.map((verdict, position) => ({ index: indexes[position] ?? position, category: verdict?.error ? null : verdict?.category ?? null, suggestion: suggestionOf(verdict), reason: verdict?.reason ?? '', error: verdict?.error ?? null }))
  if (ok.length === 0) return { suggestion: 'unknown', category: 'other', error: found.find((verdict) => verdict?.error)?.error ?? '没有可识别的图片', model, at, perImage }
  const remove = ok.find((verdict) => verdict.identity || IDENTIFYING.has(verdict.category))
  const pick = remove ?? ok[0]
  const keep = !remove && ok.every((verdict) => HARMLESS.has(verdict.category))
  return {
    suggestion: remove ? 'remove' : keep ? 'keep' : 'unknown',
    category: pick.category,
    text: ok.map((verdict) => verdict.text).filter(Boolean).join(' / ').slice(0, 2000),
    ruleTypes: [...new Set(ok.flatMap((verdict) => verdict.ruleTypes ?? []))],
    reason: pick.reason,
    model,
    at,
    perImage,
  }
}

/** What the page shows: no read text (it may hold identifiers). */
function visionForPage(entry) {
  return {
    suggestion: entry.suggestion, category: entry.category, reason: entry.reason, ruleTypes: entry.ruleTypes ?? [], hasText: Boolean(entry.text), error: entry.error ?? null,
    perImage: (entry.perImage ?? []).map((image) => ({ index: image.index, category: image.category, suggestion: image.suggestion, reason: image.reason, error: image.error })),
  }
}

/** Segment key → 1-based position in a deliverable (null when not readable). */
async function segmentPositions(where, relPath) {
  if (!where || where.nested) return null
  const ext = extname(relPath).toLowerCase()
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-anon-rows-'))
  try {
    const temp = join(scratch, `doc${ext}`)
    if (where.file) {
      await writeFile(temp, await readFile(where.file), { mode: 0o600 })
    } else {
      const { entries } = await readZip(where.zip)
      const target = entries.find((entry) => !entry.isDirectory && entry.name === where.entry)
      if (!target) return null
      await writeFile(temp, target.data, { mode: 0o600 })
    }
    const doc = layered(await loadDocument(temp, relPath))
    if (doc.kind === 'text') return null
    return new Map(doc.leaves().map((leaf, index) => [leaf.key, index + 1]))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/**
 * Open a file (or a zip entry) as a layered document, let `edit` change it,
 * check the structure and write it back. Encoded content (base64, HTML …)
 * is edited after unwrapping and re-encoded on write. Returns edit's count.
 */
async function editDocument(where, relPath, edit) {
  const ext = extname(relPath).toLowerCase()
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-anon-review-'))
  try {
    const temp = join(scratch, `doc${ext}`)
    let entries = null
    let target = null
    if (where.file) {
      await writeFile(temp, await readFile(where.file), { mode: 0o600 })
    } else {
      ;({ entries } = await readZip(where.zip))
      target = entries.find((entry) => !entry.isDirectory && entry.name === where.entry)
      if (!target) throw new Error('在压缩包中找不到该文件')
      await writeFile(temp, target.data, { mode: 0o600 })
    }
    const doc = layered(await loadDocument(temp, relPath))
    const count = edit(doc)
    if (count === 0) return 0
    const structure = doc.structure()
    if (!structure.ok) throw new Error(`修改后结构校验未通过：${structure.checks.filter((check) => !check.ok).map((check) => check.detail).join('；')}`)
    const out = doc.serialize()
    const bytes = Buffer.isBuffer(out) ? out : Buffer.from(out, 'utf8')
    if (where.file) {
      await writeFile(`${where.file}.review-${process.pid}`, bytes, { mode: 0o600 })
      await rename(`${where.file}.review-${process.pid}`, where.file)
    } else {
      target.data = bytes
      const packed = `${where.zip}.review-${process.pid}`
      await writeZip(packed, entries.filter((entry) => !entry.isDirectory))
      await rename(packed, where.zip)
    }
    return count
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
}

/** Replace every exact occurrence of `from` in every segment of a document. */
function replaceInDocument(doc, from, to) {
  const replacements = []
  for (const segment of doc.segments()) {
    let at = segment.text.indexOf(from)
    while (at >= 0) {
      replacements.push({ id: segment.id, start: at, end: at + from.length, original: from, replacement: to })
      at = segment.text.indexOf(from, at + from.length)
    }
  }
  if (replacements.length === 0) return 0
  replacements.sort((a, b) => b.start - a.start)
  return doc.apply(replacements)
}

/**
 * Pseudonyms glued to letters or digits ("20证件-6F9CCC017"): part of a longer
 * value was replaced. Returns the spans with the original to put back; only
 * `token` when given, and only pseudonyms the vault knows.
 */
function gluedPseudonyms(text, originals, token = null) {
  const out = []
  for (const span of pseudonymSpans(text, (candidate) => originals.has(candidate))) {
    if (token && span.token !== token) continue
    if (!originals.has(span.token)) continue
    const before = span.start > 0 ? text[span.start - 1] : ''
    const after = span.end < text.length ? text[span.end] : ''
    if (!/[0-9A-Za-z]/.test(before) && !/[0-9A-Za-z]/.test(after)) continue
    out.push({ start: span.start, end: span.end, token: span.token, original: originals.get(span.token) })
  }
  return out
}

/**
 * Where `text` sits right against a pseudonym ("地址-E133AE吴兴": the rest of
 * a value split by markup or a field boundary), the pieces of one value: the
 * replacement removes those occurrences only, so the pseudonym stands for
 * the whole value. Elsewhere `text` is left alone.
 */
function absorbEdits(text, from) {
  const spans = pseudonymSpans(text)
  const edits = []
  let at = text.indexOf(from)
  while (at >= 0) {
    const end = at + from.length
    const inside = spans.some((span) => at < span.end && span.start < end)
    const beside = spans.find((span) => span.end === at || span.start === end)
    if (!inside && beside) edits.push({ start: at, end, token: beside.token })
    at = text.indexOf(from, end)
  }
  return edits
}
function absorbInDocument(doc, from) {
  const replacements = []
  for (const segment of doc.segments()) {
    for (const edit of absorbEdits(segment.text, from)) replacements.push({ id: segment.id, start: edit.start, end: edit.end, original: from, replacement: '' })
  }
  if (replacements.length === 0) return 0
  replacements.sort((a, b) => b.start - a.start)
  return doc.apply(replacements)
}

/**
 * Like replaceInDocument, for a reviewer-selected value: occurrences inside a
 * pseudonym already issued ("3E15" in "医院-3E1527") are left alone.
 */
function replaceOutsidePseudonyms(doc, from, to) {
  const replacements = []
  for (const segment of doc.segments()) {
    const taken = pseudonymSpans(segment.text)
    let at = segment.text.indexOf(from)
    while (at >= 0) {
      const end = at + from.length
      if (!taken.some((span) => at < span.end && span.start < end)) replacements.push({ id: segment.id, start: at, end, original: from, replacement: to })
      at = segment.text.indexOf(from, end)
    }
  }
  if (replacements.length === 0) return 0
  replacements.sort((a, b) => b.start - a.start)
  return doc.apply(replacements)
}

/** Free / total bytes of the disk holding `dir` (or its parent), or null. */
async function diskOf(dir) {
  for (const path of [dir, dirname(resolve(String(dir ?? '.')))]) {
    try {
      const fs = await statfs(path)
      return { free: Number(fs.bavail) * Number(fs.bsize), total: Number(fs.blocks) * Number(fs.bsize) }
    } catch { /* try the parent */ }
  }
  return null
}

const OPAQUE_CODES = new Set(['opaque', 'opaque-token', 'unreadable'])
import { normalizePolicyPatch, policyConfig, policySchema } from './policy.js'

/**
 * Output roots in use in this process: a running batch or a vault re-key.
 * Module level, not per service: a plugin reapply creates a new service
 * while a batch of the old one may still be finishing, and both must see
 * that the root's vault is held in memory by someone else.
 */
const busyRoots = new Map()

/** Endpoint identity for key scoping: scheme, host and path, no trailing slash. */
function endpointKey(url) {
  const value = String(url ?? '').trim()
  if (!value) return ''
  try {
    const parsed = new URL(value)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return value.replace(/\/+$/, '')
  }
}

function sameEndpoint(a, b) {
  const key = endpointKey(a)
  return key !== '' && key === endpointKey(b)
}

const RUN_ID = /^[\w-]{1,80}$/

function busyMessage(busy, what) {
  if (busy.runId) return `该输出位置正有批次 ${busy.runId} 在运行，它会覆盖映射库；请等它结束或取消后再${what}`
  if (busy.op) return `该输出位置的映射库正在${busy.op}，请等它完成后再${what}`
  return `该输出位置的映射库正在重新加密，请稍后再${what}`
}

/**
 * Hold an output root's vault for a load-to-save span (undo, review
 * replace): batch starts and other vault writers on the root are refused
 * until the returned release runs. Checked and taken with no await between.
 */
function holdRoot(root, op, what) {
  const key = resolve(root)
  const busy = busyRoots.get(key)
  if (busy) throw new Error(busyMessage(busy, what))
  const hold = { runId: null, op }
  busyRoots.set(key, hold)
  return () => { if (busyRoots.get(key) === hold) busyRoots.delete(key) }
}

export function createService({ config = {}, defaultDirectory, stateDir = null }) {
  // Extracted archives left by a process killed mid-run hold patient files.
  cleanStaleStaging().catch(() => {})
  const runs = new Map()
  const runRoots = new Map()
  let lastRunId = null
  // Output roots used before, remembered across restarts so the batch list
  // still finds batches written beside their input (the default). Paths only;
  // the file is mode 0600 in the plugin's state directory.
  const rootsFile = stateDir ? join(stateDir, 'roots.json') : null
  const knownRoots = new Set()
  async function loadRoots() {
    if (!rootsFile) return
    try {
      const parsed = JSON.parse(await readFile(rootsFile, 'utf8'))
      if (Array.isArray(parsed)) for (const root of parsed) if (typeof root === 'string' && isAbsolute(root)) knownRoots.add(root)
    } catch { /* first run */ }
  }
  const rootsLoaded = loadRoots()
  async function rememberRoot(root) {
    if (!rootsFile || !root) return
    await rootsLoaded
    knownRoots.delete(root)
    knownRoots.add(root)
    const list = [...knownRoots].slice(-50)
    try {
      await mkdir(stateDir, { recursive: true, mode: 0o700 })
      await writeFile(rootsFile, JSON.stringify(list, null, 2), { mode: 0o600 })
    } catch { /* best effort */ }
  }
  let active = null
  let activeController = null
  // Set while the page saves defaults (the save re-applies the plugin) and
  // once this instance is disposed: no batch may start then.
  let configSaving = false
  let disposed = false

  const settings = {
    baseURL: String(config.baseURL ?? 'http://127.0.0.1:11434/v1'),
    model: String(config.model ?? ''),
    apiKey: String(config.apiKey ?? ''),
    // Optional second model for verification (an independent reviewer).
    // Empty model: the detection model also verifies.
    verifyBaseURL: String(config.verifyBaseURL ?? ''),
    verifyModel: String(config.verifyModel ?? ''),
    verifyApiKey: String(config.verifyApiKey ?? ''),
    outputRoot: String(config.outputRoot ?? ''),
    maxRounds: Number(config.maxRounds ?? 3),
    maxFiles: Number(config.maxFiles ?? 200),
    maxDicomFiles: Number(config.maxDicomFiles ?? 50000),
    // Files processed at the same time (each makes its own model calls).
    concurrency: Number(config.concurrency ?? 4),
    // Request slots of the verification model (its own server); defaults to
    // the detection model's.
    verifyConcurrency: Number(config.verifyConcurrency ?? config.concurrency ?? 4),
    // Let each model's concurrency follow its measured throughput, starting
    // from the values above (see createConcurrencyTuner).
    autoConcurrency: config.autoConcurrency !== false,
    // Send embedded images under review to the detection model to sort them
    // (signature, seal, chart …). Off by default: images leave the plugin.
    imageCheck: config.imageCheck === true,
    timeoutMs: Number(config.timeoutMs ?? 120000),
    temperature: Number(config.temperature ?? 0),
    vaultPassphrase: String(config.vaultPassphrase ?? ''),
    disableThinking: config.disableThinking === true,
    showSidebarEntry: config.showSidebarEntry !== false,
    // Anonymization rules. Defaults: every identifier → stable pseudonym,
    // quasi-identifiers untouched.
    ...policyConfig(config),
  }

  /**
   * Resolve the output root for a run.
   *
   * Without an explicit or configured root, output goes to a hidden
   * `_medical-anonymizer` directory beside the input. It stays with the data
   * (not in the DSH profile), is shared by sibling batches so pseudonyms stay
   * consistent, and is skipped when a parent directory is scanned later.
   *
   * @param {string} [requested] per-run value
   * @param {string} [absoluteInput] input directory or file, used for the default
   * @returns {string | null} absolute root, or null when it cannot be known yet
   */
  function resolveOutputRoot(requested, absoluteInput) {
    const value = String(requested || settings.outputRoot || '').trim()
    if (!value) return absoluteInput ? join(dirname(absoluteInput), DEFAULT_ROOT) : null
    const expanded = value.startsWith('~/') ? join(process.env.HOME ?? defaultDirectory, value.slice(2)) : value
    return isAbsolute(expanded) ? expanded : resolve(defaultDirectory, expanded)
  }

  function configuredRoot() {
    return resolveOutputRoot('', undefined)
  }

  /**
   * A saved API key belongs to the endpoint it was saved with and is sent
   * nowhere else (a typed test URL, /anonymize --endpoint). `verify` also
   * allows the verification key for the verification endpoint.
   */
  function savedKeyFor(url, { verify = false } = {}) {
    if (verify && settings.verifyApiKey && sameEndpoint(url, settings.verifyBaseURL || settings.baseURL)) return settings.verifyApiKey
    if (settings.apiKey && sameEndpoint(url, settings.baseURL)) return settings.apiKey
    return ''
  }

  function resolveModel(request = {}) {
    const baseURL = String(request.baseURL || settings.baseURL || '').trim()
    const model = String(request.model || settings.model || '').trim()
    // `useSavedKey: false`: the page asked not to use the saved key (e.g.
    // "clear saved key" is checked).
    const apiKey = String(request.apiKey || (request.useSavedKey === false ? '' : savedKeyFor(baseURL)))
    return { baseURL, model, apiKey }
  }

  function resolveDisableThinking(request = {}) {
    if (request.disableThinking === true) return true
    if (request.disableThinking === false) return false
    return settings.disableThinking
  }

  function withLlm(request, overrides = {}) {
    const { baseURL, model, apiKey } = resolveModel(request)
    if (!model) return { llm: null, baseURL, model, disableThinking: resolveDisableThinking(request) }
    const llm = createLlm({
      baseURL,
      model,
      apiKey,
      temperature: overrides.temperature ?? settings.temperature,
      timeoutMs: overrides.timeoutMs ?? settings.timeoutMs,
      disableThinking: resolveDisableThinking(request),
    })
    return { llm, baseURL, model, disableThinking: resolveDisableThinking(request) }
  }

  /** The verification model, or null to verify with the detection model. */
  function verifyLlmFor(request, mainBaseURL, overrides = {}) {
    const model = String(settings.verifyModel || '').trim()
    if (!model) return null
    const baseURL = String(settings.verifyBaseURL || mainBaseURL || '').trim()
    return createLlm({
      baseURL,
      model,
      apiKey: savedKeyFor(baseURL, { verify: true }),
      temperature: overrides.temperature ?? settings.temperature,
      timeoutMs: overrides.timeoutMs ?? settings.timeoutMs,
      disableThinking: resolveDisableThinking(request),
    })
  }

  async function start(request = {}) {
    if (disposed) throw new Error('插件正在重新加载，请稍后再试')
    if (configSaving) throw new Error('正在保存默认配置，请稍后再启动批次')
    if (active) throw new Error(active.runId ? `批次 ${active.runId} 正在运行，请等待完成或先取消` : '另一个批次正在启动，请稍后再试')
    // Claim the single-batch slot before the first await, so two concurrent
    // calls can never both pass the check above; released again on any
    // failure before the batch actually starts.
    const claim = { runId: null, starting: true }
    active = claim
    try {
      return await startClaimed(request, claim)
    } catch (error) {
      if (active === claim) active = null
      throw error
    }
  }

  async function startClaimed(request, claim) {
    // Resume: same input and output root as a cancelled/failed batch, with
    // its model-reply cache replayed so finished work is not redone.
    let resume = null
    if (request.resumeFrom) {
      const previousId = String(request.resumeFrom).trim()
      if (!RUN_ID.test(previousId)) throw new Error('批次 id 不正确')
      await list()
      const previousRoot = runRoot(previousId)
      const previousDir = previousRoot ? layout(previousRoot).runDir(previousId) : null
      let saved = null
      try { saved = JSON.parse(await readFile(join(previousDir, 'resume.json'), 'utf8')) } catch { /* below */ }
      if (!saved?.inputDir) throw new Error(`批次 ${previousId} 不能继续处理（只有已取消或失败、且由 0.8.1 及以上版本运行的批次可以继续）`)
      resume = { id: previousId, dir: previousDir, model: String(saved.model ?? '') }
      request = { ...request, inputDir: saved.inputDir, inputs: saved.selection ? saved.selection.map((name) => join(saved.inputDir, name)) : undefined, outputRoot: saved.outputRoot }
    }
    // Several files/folders of one parent folder: one batch over that folder,
    // limited to the chosen entries. A single entry is an ordinary input.
    const chosen = Array.isArray(request.inputs)
      ? [...new Set(request.inputs.map((item) => String(item ?? '').trim()).filter(Boolean)
        .map((item) => resolve(isAbsolute(item) ? item : resolve(defaultDirectory, item))))]
      : []
    if (chosen.length > 1000) throw new Error('一次最多选择 1000 项')
    let selection = null
    if (chosen.length > 1) {
      const parents = new Set(chosen.map((item) => dirname(item)))
      if (parents.size > 1) throw new Error('多选的文件或文件夹必须在同一个目录下')
      for (const item of chosen) {
        const entry = await stat(item).catch(() => null)
        if (!entry?.isDirectory() && !entry?.isFile()) throw new Error(`输入路径不存在或不是文件/目录: ${item}`)
      }
      selection = chosen.map((item) => basename(item)).sort()
    }
    const inputDir = selection ? dirname(chosen[0]) : String(chosen[0] ?? request.inputDir ?? '').trim()
    if (!inputDir) throw new Error('缺少输入路径 inputDir')
    const absoluteInput = isAbsolute(inputDir) ? inputDir : resolve(defaultDirectory, inputDir)
    const info = await stat(absoluteInput).catch(() => null)
    if (!info?.isDirectory() && !info?.isFile()) throw new Error(`输入路径不存在或不是文件/目录: ${absoluteInput}`)
    if (selection) {
      const listing = await listInputFiles(absoluteInput, { select: selection })
      if (listing.files.length === 0 && listing.dicom.length === 0 && listing.zips.length === 0) {
        throw new Error('所选项目里没有可处理的文件（支持 txt/md/csv/json/xlsx、zip 与 DICOM）')
      }
    } else if (info.isFile()) {
      // Fail fast instead of starting a batch that processes nothing.
      const listing = await listInputFiles(absoluteInput)
      if (listing.files.length === 0 && listing.dicom.length === 0 && listing.zips.length === 0) {
        throw new Error(`不支持的文件类型: ${absoluteInput}（支持 txt/md/csv/json/xlsx、zip 与 DICOM）`)
      }
    }

    // Default is <dirname(input)>/_medical-anonymizer — for a single file that
    // is a _medical-anonymizer folder next to the file.
    const outputRoot = resolveOutputRoot(request.outputRoot, selection ? chosen[0] : absoluteInput)
    const root = resolve(outputRoot)
    for (const input of selection ? chosen : [resolve(absoluteInput)]) {
      if (root === input || input.startsWith(root.endsWith('/') ? root : `${root}/`)) {
        throw new Error('输出根目录不能与输入目录相同或包含输入目录，请选择输入目录之外的位置')
      }
    }
    // Before 0.8 the default root was the hidden .medical-anonymizer; take it
    // over (same vault, so pseudonyms stay consistent) instead of starting anew.
    if (!String(request.outputRoot || settings.outputRoot || '').trim()) {
      const legacy = join(dirname(absoluteInput), LEGACY_DEFAULT_ROOT)
      const hasLegacy = await stat(legacy).then((item) => item.isDirectory(), () => false)
      const hasNew = await stat(outputRoot).then(() => true, () => false)
      if (hasLegacy && !hasNew) await rename(legacy, outputRoot)
    }
    // Another batch (possibly of a previous instance of this plugin, still
    // finishing after a reapply) or a vault re-key holds this root's vault.
    if (busyRoots.has(root)) throw new Error(busyMessage(busyRoots.get(root), '启动批次'))
    await mkdir(outputRoot, { recursive: true })
    await rememberRoot(resolve(outputRoot))

    // Per-batch overrides from the page (the saved defaults stay as they are).
    const pick = (value, min, max, fallback, integer = true) => {
      const number = Number(value)
      if (value === undefined || value === null || value === '' || !Number.isFinite(number)) return fallback
      const clamped = Math.min(max, Math.max(min, number))
      return integer ? Math.round(clamped) : Math.round(clamped * 10) / 10
    }
    const batch = {
      maxFiles: pick(request.maxFiles, 1, 2000, settings.maxFiles),
      concurrency: pick(request.concurrency, 1, 64, settings.concurrency),
      verifyConcurrency: pick(request.verifyConcurrency, 1, 64, settings.verifyConcurrency),
      timeoutMs: pick(request.timeoutMs, 10000, 1800000, settings.timeoutMs),
      temperature: pick(request.temperature, 0, 2, settings.temperature, false),
      quasiIdentifiers: typeof request.quasiIdentifiers === 'boolean' ? request.quasiIdentifiers : settings.quasiIdentifiers,
      autoConcurrency: typeof request.autoConcurrency === 'boolean' ? request.autoConcurrency : settings.autoConcurrency,
    }
    const maxRounds = pick(request.maxRounds, 1, 6, Number(settings.maxRounds))
    // Where the batch came from: the page, /anonymize, or an agent tool call
    // (with its session, so the page can link back to the conversation).
    const kind = ['panel', 'command', 'agent'].includes(request.source?.kind) ? request.source.kind : 'api'
    const sessionId = typeof request.source?.sessionId === 'string' && request.source.sessionId.length <= 200 ? request.source.sessionId : undefined
    const source = { kind, ...(sessionId ? { sessionId } : {}) }
    const { llm, baseURL, model, disableThinking } = withLlm(request, batch)
    const verifyLlm = llm ? verifyLlmFor(request, baseURL, batch) : null
    // Which batch values differ from the saved defaults (shown in the report).
    const overridden = [
      ['maxRounds', maxRounds !== Number(settings.maxRounds)],
      ['concurrency', batch.concurrency !== settings.concurrency],
      ['verifyConcurrency', Boolean(settings.verifyModel) && batch.verifyConcurrency !== settings.verifyConcurrency],
      ['autoConcurrency', batch.autoConcurrency !== settings.autoConcurrency],
      ['maxFiles', batch.maxFiles !== settings.maxFiles],
      ['timeoutMs', batch.timeoutMs !== settings.timeoutMs],
      ['temperature', batch.temperature !== settings.temperature],
      ['disableThinking', disableThinking !== settings.disableThinking],
      ['quasiIdentifiers', batch.quasiIdentifiers !== settings.quasiIdentifiers],
    ].filter(([, differs]) => differs).map(([key]) => key)
    const runId = newRunId()
    // Checked again and taken with no await in between.
    if (busyRoots.has(root)) throw new Error(busyMessage(busyRoots.get(root), '启动批次'))
    const hold = { runId }
    busyRoots.set(root, hold)
    const controller = new AbortController()
    activeController = controller
    claim.runId = runId
    delete claim.starting
    lastRunId = runId

    const startedAt = new Date().toISOString()
    const placeholder = {
      id: runId,
      startedAt,
      finishedAt: null,
      status: 'running',
      // Shown (status, run list, report) before the batch's own path mapping
      // exists: identifiers in the input's name as type labels.
      inputDir: displayInputPath(absoluteInput),
      ...(selection ? { selection: selection.map(provisionalName) } : {}),
      outputRoot,
      runDir: layout(outputRoot).runDir(runId),
      source,
      config: { model, baseURL, modelConfigured: Boolean(llm), maxRounds, disableThinking, ...(verifyLlm ? { verifyModel: verifyLlm.model } : {}) },
      totals: { files: 0, filesFailed: 0, filesReview: 0, entities: 0, byType: {}, modelCalls: 0, tokens: 0, unresolved: 0 },
      files: [],
    }
    runs.set(runId, placeholder)
    runRoots.set(runId, outputRoot)

    const task = runBatch({
      inputDir: absoluteInput,
      outputRoot,
      options: {
        runId,
        source,
        selection,
        resumeFrom: resume?.id,
        resumeModel: resume?.model,
        replaySources: resume ? [join(resume.dir, CACHE_FILE)] : [],
        maxRounds,
        maxFiles: batch.maxFiles,
        maxDicomFiles: settings.maxDicomFiles,
        concurrency: batch.concurrency,
        verifyConcurrency: batch.verifyConcurrency,
        autoConcurrency: batch.autoConcurrency,
        timeoutMs: batch.timeoutMs,
        temperature: batch.temperature,
        overridden,
        model,
        baseURL,
        disableThinking,
        llm,
        verifyLlm,
        vaultPassphrase: settings.vaultPassphrase,
        policy: {
          identifierPolicy: settings.identifierPolicy,
          quasiIdentifiers: batch.quasiIdentifiers,
          quasiPolicy: settings.quasiPolicy,
          allowValues: settings.allowValues,
          skipFields: settings.skipFields,
          forceValues: settings.forceValues,
          landline: settings.landline,
          opaquePolicy: settings.opaquePolicy,
        },
      },
      signal: controller.signal,
      onEvent: ({ run: current }) => {
        runs.set(runId, current)
      },
    }).then(async (run) => {
      runs.set(runId, run)
      // The resumed batch is superseded: drop its cache, partial output and
      // resume file, and note which batch finished it.
      if (resume && (run.status === 'completed' || run.status === 'review')) {
        for (const name of [CACHE_FILE, 'output', 'resume.json']) await rm(join(resume.dir, name), { recursive: true, force: true }).catch(() => {})
        try {
          const reportFile = join(resume.dir, 'report.json')
          const previous = JSON.parse(await readFile(reportFile, 'utf8'))
          await writeFile(reportFile, JSON.stringify({ ...previous, resumable: false, resumedBy: runId }, null, 2), { mode: 0o600 })
          if (runs.has(resume.id)) runs.set(resume.id, { ...runs.get(resume.id), resumable: false, resumedBy: runId })
        } catch { /* report missing */ }
      }
      return run
    }).catch(async (error) => {
      const failed = {
        ...placeholder,
        finishedAt: new Date().toISOString(),
        status: 'failed',
        error: describeError(error),
      }
      runs.set(runId, failed)
      const failedDir = layout(outputRoot).runDir(runId)
      await mkdir(failedDir, { recursive: true }).catch(() => {})
      await writeFile(join(failedDir, 'report.json'), JSON.stringify(failed, null, 2), { mode: 0o600 }).catch(() => {})
      return failed
    }).finally(() => {
      if (busyRoots.get(root) === hold) busyRoots.delete(root)
      if (active?.runId === runId) {
        active = null
        activeController = null
      }
      // With image checks on, sort the batch's images under review as soon
      // as the models are free (suggestions only; nothing is decided).
      if (settings.imageCheck && runs.get(runId)?.status === 'review') imageCheck(runId).catch(() => {})
    })
    task.catch(() => {})

    return {
      runId,
      model,
      modelConfigured: Boolean(llm),
      disableThinking,
      inputDir: absoluteInput,
      ...(selection ? { inputs: chosen } : {}),
      outputRoot,
    }
  }

  async function status(runId) {
    const id = String(runId ?? '').trim() || await latestRunId()
    if (!id || !RUN_ID.test(id)) return { run: null, active: active?.runId ?? null }
    if (runs.has(id)) return { run: runs.get(id), active: active?.runId ?? null }
    const loaded = await loadRunFromDisk(id)
    // A finished batch: the disk as it is now (the page warns before the next one).
    if (loaded) loaded.disk = await diskOf(runRoot(id)) ?? loaded.disk
    return { run: loaded, active: active?.runId ?? null }
  }

  function runRoot(id) {
    return runRoots.get(id) ?? configuredRoot()
  }

  /**
   * The output root of a batch, also after a restart: batches written beside
   * their input are found through the remembered roots (list()).
   */
  async function locateRoot(id) {
    if (!runRoots.has(id)) await list()
    return runRoot(id)
  }

  /** The batch "latest" means when no id is given: this session's, else the newest listed. */
  async function latestRunId() {
    if (lastRunId) return lastRunId
    return (await list()).runs[0]?.id ?? null
  }

  async function loadRunFromDisk(id) {
    const candidates = [await locateRoot(id)].filter(Boolean)
    for (const root of candidates) {
      const paths = layout(root)
      for (const dir of [paths.runDir(id), paths.legacyRunDir(id)]) {
        try {
          return JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'))
        } catch { /* try next */ }
      }
    }
    return null
  }

  async function list() {
    const root = configuredRoot()
    await rootsLoaded
    await loadRoots()
    const roots = new Set([root, ...runRoots.values(), ...[...knownRoots].reverse()].filter(Boolean))
    const merged = new Map()
    for (const candidate of roots) for (const indexFile of [layout(candidate).index, layout(candidate).legacyIndex]) {
      try {
        const parsed = JSON.parse(await readFile(indexFile, 'utf8'))
        if (!Array.isArray(parsed)) continue
        for (const item of parsed) {
          if (item?.id && !merged.has(item.id)) {
            merged.set(item.id, item)
            if (!runRoots.has(item.id)) runRoots.set(item.id, candidate)
          }
        }
      } catch { /* none yet */ }
    }
    for (const [id, run] of runs) {
      merged.set(id, {
        id,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        status: run.status,
        inputDir: run.inputDir,
        source: run.source ?? null,
        resumable: run.resumable === true,
        resumedFrom: run.resumedFrom ?? null,
        resumedBy: run.resumedBy ?? null,
        selection: run.selection ?? null,
        files: run.totals?.files ?? 0,
        entities: run.totals?.entities ?? 0,
        unresolved: run.totals?.unresolved ?? 0,
        output: run.output ?? null,
        model: run.config?.model ?? '',
        durationMs: run.durationMs ?? 0,
      })
    }
    return {
      runs: [...merged.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 30),
      outputRoot: root ?? '',
      active: active?.runId ?? null,
    }
  }

  async function report(runId) {
    const id = String(runId ?? '').trim() || await latestRunId()
    if (!id) throw new Error('还没有批次')
    if (!RUN_ID.test(id)) throw new Error('批次 id 不正确')
    const root = await locateRoot(id)
    if (!root) throw new Error(`找不到批次 ${id} 的输出位置；请先在本次会话中运行，或在配置里设置 outputRoot`)
    const paths = layout(root)
    let lastError
    for (const dir of [paths.runDir(id), paths.legacyRunDir(id)]) {
      try {
        const markdown = await readFile(join(dir, 'report.md'), 'utf8')
        return { runId: id, markdown, path: join(dir, 'report.md') }
      } catch (error) { lastError = error }
    }
    throw lastError
  }

  /** Full advice of one batch (local page only; holds allow-list candidates). */
  async function advice(runId) {
    const id = String(runId ?? '').trim() || lastRunId
    if (!id || !RUN_ID.test(id)) return null
    const root = await locateRoot(id)
    if (!root) return null
    try {
      return JSON.parse(await readFile(join(layout(root).runDir(id), 'advice.json'), 'utf8'))
    } catch {
      return null
    }
  }

  /**
   * Model-call log of one batch, entries after `since` (metadata only).
   * Live from memory while the batch is in this process, else calls.json.
   */
  async function calls(runId, since = 0) {
    const id = String(runId ?? '').trim() || lastRunId
    if (!id) return { entries: [], last: 0 }
    const live = runs.get(id)
    let log = live?.callLog
    if (!log) {
      const root = RUN_ID.test(id) ? await locateRoot(id) : null
      try { log = root ? JSON.parse(await readFile(join(layout(root).runDir(id), 'calls.json'), 'utf8')) : [] } catch { log = [] }
    }
    const after = Number(since) || 0
    const entries = log.filter((entry) => entry.seq > after).slice(0, 2000)
    return { entries, last: entries.length ? entries[entries.length - 1].seq : after }
  }

  /**
   * Cross-check detail: every blind-review finding with context, both
   * models' reasons and its outcome; disputed / not re-judged ones carry the
   * manual decision when there is one. Page only (holds original text).
   */
  async function crossCheck(runId) {
    const id = String(runId ?? '').trim() || lastRunId
    if (!id || !/^[\w-]{1,80}$/.test(id)) return { runId: id ?? null, entries: null }
    const live = runs.get(id)
    let entries = live?.crossCheck ?? null
    const root = runRoot(id)
    const dir = root ? layout(root).runDir(id) : null
    if (!entries && dir) {
      try { entries = JSON.parse(await readFile(join(dir, 'cross-check.json'), 'utf8')) } catch { entries = null }
    }
    if (!entries) return { runId: id, entries: null }
    entries = entries.map((entry) => ({ ...entry }))
    // Link manual decisions: same file, same text, reported by the verifier.
    if (dir) {
      try {
        const files = JSON.parse(await readFile(join(dir, 'review-items.json'), 'utf8'))
        let decisions = {}
        try { decisions = JSON.parse(await readFile(join(dir, 'review-decisions.json'), 'utf8')) } catch { /* none */ }
        const byKey = new Map()
        for (const file of files) {
          for (const item of file.items ?? []) {
            const kind = item.code === 'model-unlocated' ? 'u' : item.code === 'disputed' || item.code === 'model-residual' ? 'm' : null
            if (!kind) continue
            byKey.set(`${kind}|${file.relPath}|${item.text}`, { id: item.id, decision: decisions[item.id]?.action ?? null })
          }
        }
        for (const entry of entries) {
          const kind = entry.outcome === 'unlocated' ? 'u' : entry.outcome === 'disputed' || entry.outcome === 'unjudged' ? 'm' : null
          if (!kind) continue
          const hit = byKey.get(`${kind}|${entry.file}|${entry.text}`)
          if (!hit) continue
          entry.reviewId = hit.id
          entry.verdict = hit.decision === 'replace' ? 'verifier' : hit.decision ? 'detector' : 'pending'
        }
      } catch { /* no review items */ }
    }
    return { runId: id, entries }
  }

  /**
   * Delete one batch's records: its index entry and _records/runs/<id>
   * (report, review copies, advice, call log, path map). With
   * `deliverable: true` the delivered folder/file in the output root goes too.
   * Vault mappings are kept: delivered files elsewhere may still need them
   * (withdraw them separately with undoMappings). Page-only, never an agent tool.
   */
  async function deleteRun(runId, { deliverable = false } = {}) {
    const id = String(runId ?? '').trim()
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error('批次 id 不正确')
    if (active?.runId === id) throw new Error('该批次正在运行，请先取消')
    await list() // make sure the batch's output root is known
    const root = runRoot(id)
    if (!root) throw new Error(`找不到批次 ${id} 的输出位置`)
    const paths = layout(resolve(root))
    let run = runs.get(id) ?? null
    if (!run) {
      for (const dir of [paths.runDir(id), paths.legacyRunDir(id)]) {
        try { run = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')); break } catch { /* next */ }
      }
    }
    let deliverableRemoved = false
    if (deliverable && run?.output) {
      const targets = (run.outputs?.length ? run.outputs : [run.output]).map((item) => resolve(item))
      for (const target of targets) {
        const inside = target.startsWith(paths.root + sep) && !target.startsWith(paths.records + sep) && dirname(target) === paths.root
        if (!inside) throw new Error('交付数据不在输出根目录下，未删除')
      }
      for (const target of targets) await rm(target, { recursive: true, force: true })
      deliverableRemoved = true
    }
    for (const dir of [paths.runDir(id), paths.legacyRunDir(id)]) await rm(dir, { recursive: true, force: true })
    for (const indexFile of [paths.index, paths.legacyIndex]) {
      try {
        const listed = JSON.parse(await readFile(indexFile, 'utf8'))
        if (Array.isArray(listed) && listed.some((item) => item?.id === id)) {
          await writeFile(indexFile, JSON.stringify(listed.filter((item) => item?.id !== id), null, 2), { mode: 0o600 })
        }
      } catch { /* none */ }
    }
    runs.delete(id)
    runRoots.delete(id)
    if (lastRunId === id) lastRunId = null
    return { runId: id, deliverableRemoved, records: `${RECORDS_DIR}/runs/${id}` }
  }

  /** Delete every batch record except a running one (see deleteRun). */
  async function clearRuns({ deliverable = false } = {}) {
    const removed = []
    const failed = []
    const tried = new Set()
    // list() returns at most 30 batches; keep going until nothing is left.
    for (let pass = 0; pass < 100; pass += 1) {
      const pending = (await list()).runs.filter((item) => item.id !== active?.runId && !tried.has(item.id))
      if (pending.length === 0) break
      for (const item of pending) {
        tried.add(item.id)
        try {
          await deleteRun(item.id, { deliverable })
          removed.push(item.id)
        } catch (error) {
          failed.push({ id: item.id, error: String(error?.message ?? error) })
        }
      }
    }
    return { removed: removed.length, failed }
  }

  async function loadRunRecord(id) {
    await list()
    const root = runRoot(id)
    if (!root) throw new Error(`找不到批次 ${id} 的输出位置`)
    const dir = layout(root).runDir(id)
    const run = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'))
    return { root, dir, run }
  }

  /** Files of a batch available for side-by-side comparison. */
  async function compareList(runId) {
    const id = String(runId ?? '').trim()
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error('批次 id 不正确')
    const { dir } = await loadRunRecord(id)
    try {
      return { runId: id, files: JSON.parse(await readFile(join(dir, 'compare', 'index.json'), 'utf8')) }
    } catch {
      return { runId: id, files: null }
    }
  }

  /** One file's changed segments (original vs. result). */
  async function compareFile(runId, n) {
    const id = String(runId ?? '').trim()
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error('批次 id 不正确')
    const index = Number(n)
    if (!Number.isInteger(index) || index < 0) throw new Error('文件序号不正确')
    const { dir, run } = await loadRunRecord(id)
    const file = join(dir, 'compare', `${index}.json`)
    const data = JSON.parse(await readFile(file, 'utf8'))
    // Records written before row numbers existed: rows kept past the 50 000
    // cap cannot be numbered by their order. Number them once from the
    // deliverable (same segments, same order) and keep the result.
    const CAP = 50000
    const missing = (data.changes ?? []).some((change, at) => change.i === undefined && at >= CAP && !/^L\d+$/.test(String(change.id)))
    if (missing) {
      try {
        const positions = await segmentPositions(locateDeliverable(run, data.relPath, dir), data.relPath)
        if (positions) {
          data.changes.forEach((change, at) => {
            if (change.i === undefined) change.i = positions.get(change.id) ?? (at < CAP ? at + 1 : undefined)
          })
          await writeFile(file, JSON.stringify(data), { mode: 0o600 })
        }
      } catch { /* deliverable gone or unreadable: rows stay unnumbered */ }
    }
    return data
  }

  // Opaque payloads of the last files previewed: { key, at, map } (a file is
  // parsed once, then each card reads its images from memory).
  const previewCache = []
  /**
   * Images of one "cannot be checked" review item, read from the deliverable
   * (so a removed image is gone). Shown on this machine only; never sent
   * to a model.
   */
  async function opaquePreview(runId, itemId) {
    const id = String(runId ?? '').trim()
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error('批次 id 不正确')
    const { dir, run } = await loadRunRecord(id)
    const files = JSON.parse(await readFile(join(dir, 'review-items.json'), 'utf8'))
    const file = files.find((entry) => entry.items.some((item) => item.id === itemId))
    const item = file?.items.find((entry) => entry.id === itemId)
    if (!item) throw new Error('找不到该复核项')
    if (!item.baseId) return { itemId, images: [], note: 'none' }
    const where = locateDeliverable(run, file.relPath, dir)
    if (!where || where.nested) return { itemId, images: [], note: 'unavailable' }
    const source = where.file ?? where.zip
    let stamp = 0
    try { stamp = (await stat(source)).mtimeMs } catch { return { itemId, images: [], note: 'unavailable' } }
    const key = `${id}:${file.relPath}:${stamp}`
    let hit = previewCache.find((entry) => entry.key === key)
    if (!hit) {
      const map = await readDeliverable(where, file.relPath, (doc) => doc.opaquePayloads())
      hit = { key, map: map ?? new Map() }
      previewCache.unshift(hit)
      previewCache.length = Math.min(previewCache.length, 2)
    }
    const payloads = hit.map.get(item.baseId) ?? []
    const images = []
    let skipped = 0
    for (const payload of payloads) {
      if (payload.placeholder) { images.push({ index: payload.index, removed: true }); continue }
      const preview = previewUri(payload)
      if (preview?.src) images.push({ index: payload.index, src: preview.src })
      else skipped += 1
    }
    return { itemId, images, skipped, note: payloads.length === 0 || images.every((image) => image.removed) ? 'removed' : null }
  }

  // Image checks per batch: { state: 'running' | 'done' | 'failed', done, total, sent, error }.
  const imageJobs = new Map()
  /**
   * Sort the embedded images under review with the detection model (which
   * must accept images): category, visible text, whether it identifies a
   * person, and a suggestion. Identical images are sent once. Results go to
   * the batch's records (mode 600, they may hold read text); nothing is
   * decided automatically. Runs in the background; `imageJobs` has progress.
   */
  async function imageCheck(runId, { only = null } = {}) {
    const id = String(runId ?? '').trim()
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error('批次 id 不正确')
    if (!settings.imageCheck) throw new Error('未开启「用模型识别图片」，请在 设置 → 匿名化规则 中开启')
    if (active) throw new Error('有批次正在运行，模型被占用，请等它结束后再识别图片')
    if (imageJobs.get(id)?.state === 'running') return imageJobs.get(id)
    const { llm } = withLlm({})
    if (!llm) throw new Error('未配置模型，无法识别图片')
    const { root, dir, run } = await loadRunRecord(id)
    const files = JSON.parse(await readFile(join(dir, 'review-items.json'), 'utf8'))
    let decisions = {}
    try { decisions = JSON.parse(await readFile(join(dir, 'review-decisions.json'), 'utf8')) } catch { /* none */ }
    let results = {}
    try { results = JSON.parse(await readFile(join(dir, IMAGE_CHECKS), 'utf8')) } catch { /* first */ }
    const wanted = only ? new Set(only) : null
    // Items read before per-image verdicts existed are read again when they hold several images.
    const pendingResult = (item) => !results[item.id] || (Number(item.count ?? 1) > 1 && !results[item.id].perImage)
    const todo = files.map((file) => ({ file, items: file.items.filter((item) => item.code === 'opaque' && item.image && item.baseId && !decisions[item.id] && pendingResult(item) && (!wanted || wanted.has(item.id))) }))
      .filter((entry) => entry.items.length)
    const job = { state: 'running', done: 0, total: todo.reduce((sum, entry) => sum + entry.items.length, 0), sent: 0, error: null, at: new Date().toISOString() }
    imageJobs.set(id, job)
    if (job.total === 0) { job.state = 'done'; return job }
    const callEntries = []
    ;(async () => {
      const verdicts = new Map() // image hash -> verdict (or a pending promise)
      const save = () => writeFile(join(dir, IMAGE_CHECKS), JSON.stringify(results, null, 2), { mode: 0o600 })
      let lastSave = Date.now()
      try {
        for (const { file, items } of todo) {
          const where = locateDeliverable(run, file.relPath, dir)
          const payloads = await readDeliverable(where, file.relPath, (doc) => doc.opaquePayloads()) ?? new Map()
          const queue = [...items]
          const worker = async () => {
            while (queue.length) {
              const item = queue.shift()
              const images = (payloads.get(item.baseId) ?? []).filter((payload) => !payload.placeholder).map((payload) => ({ index: payload.index, preview: previewUri(payload) })).filter((entry) => entry.preview?.src)
              const found = []
              for (const { preview: { src } } of images) {
                const key = createHash('sha256').update(src).digest('hex')
                if (!verdicts.has(key)) {
                  job.sent += 1
                  verdicts.set(key, classifyImage(llm, src, (entry) => callEntries.push({ ...entry, file: file.relPath })).catch((error) => ({ error: describeError(error) })))
                }
                found.push(await verdicts.get(key))
              }
              results[item.id] = mergeVerdicts(found, llm.model, images.map((entry) => entry.index))
              job.done += 1
              if (Date.now() - lastSave > 3000) { lastSave = Date.now(); await save() }
            }
          }
          await Promise.all(Array.from({ length: Math.max(1, Math.min(8, settings.concurrency)) }, worker))
        }
        await save()
        job.state = 'done'
      } catch (error) {
        job.state = 'failed'
        job.error = describeError(error)
        try { await save() } catch { /* keep what we had */ }
      }
      try { await recordImageCheck(id, root, dir, run, files, results, callEntries, llm.model) } catch { /* records stay as they were */ }
    })()
    return job
  }

  /**
   * Book an image check into the batch: its model calls join the call log
   * (stage 图片识别) and a summary goes to the report (counts only).
   */
  async function recordImageCheck(id, root, dir, run, files, results, callEntries, model) {
    if (callEntries.length) {
      let log = []
      try { log = JSON.parse(await readFile(join(dir, 'calls.json'), 'utf8')) } catch { /* none yet */ }
      let seq = log.reduce((max, entry) => Math.max(max, Number(entry.seq) || 0), 0)
      for (const entry of callEntries) { seq += 1; log.push({ ...entry, seq }) }
      await writeFile(join(dir, 'calls.json'), JSON.stringify(log), { mode: 0o600 })
    }
    const imageIds = new Set(files.flatMap((file) => file.items).filter((item) => item.code === 'opaque' && item.image).map((item) => item.id))
    const checked = Object.entries(results).filter(([itemId]) => imageIds.has(itemId)).map(([, value]) => value)
    const tally = (key) => checked.reduce((map, value) => (value.error ? map : { ...map, [value[key]]: (map[value[key]] ?? 0) + 1 }), {})
    const previous = run.imageCheck ?? { calls: 0, tokens: 0, ms: 0 }
    run.imageCheck = {
      at: new Date().toISOString(),
      model,
      images: imageIds.size,
      checked: checked.filter((value) => !value.error).length,
      failed: checked.filter((value) => value.error).length,
      categories: tally('category'),
      suggestions: tally('suggestion'),
      calls: previous.calls + callEntries.length,
      tokens: previous.tokens + callEntries.reduce((sum, entry) => sum + (entry.tokens || 0), 0),
      ms: previous.ms + callEntries.reduce((sum, entry) => sum + (entry.ms || 0), 0),
    }
    await persistRun(id, root, dir, run)
    if (runs.has(id)) runs.set(id, { ...runs.get(id), imageCheck: run.imageCheck })
  }

  /** Items needing manual review, with context and the decisions so far. */
  async function reviewItems(runId) {
    const id = String(runId ?? '').trim()
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error('批次 id 不正确')
    const { root, dir, run } = await loadRunRecord(id)
    let files = []
    try { files = JSON.parse(await readFile(join(dir, 'review-items.json'), 'utf8')) } catch { /* none */ }
    let decisions = {}
    try { decisions = JSON.parse(await readFile(join(dir, 'review-decisions.json'), 'utf8')) } catch { /* none */ }
    let vision = {}
    try { vision = JSON.parse(await readFile(join(dir, IMAGE_CHECKS), 'utf8')) } catch { /* none */ }
    // Both models' opinions per round, for items the cross-check sent to a
    // person (from cross-check.json; same file, field and text).
    let cross = []
    try { cross = JSON.parse(await readFile(join(dir, 'cross-check.json'), 'utf8')) } catch { /* older batch */ }
    const historyOf = (relPath, item) => {
      if (!item.text || !['disputed', 'model-residual'].includes(item.code)) return null
      const rows = cross.filter((row) => row.file === relPath && row.text === item.text && (!item.field || !row.field || row.field === item.field))
        .sort((x, y) => (x.round ?? 0) - (y.round ?? 0))
        .map((row) => ({ round: row.round ?? null, verifier: row.reason ?? '', detector: row.judge ?? '', outcome: row.outcome ?? '' }))
      return rows.length ? rows : null
    }
    const models = { detect: run.config?.model ?? '', verify: run.config?.verifyModel || run.config?.model || '' }
    const withVision = (raw, relPath) => {
      // Older records of a mangled value carry only a sentence: recover the
      // field names and the pseudonym so the page can place the item.
      let item = raw
      if (!raw.text && !raw.segments && (raw.code === 'embedded' || raw.code === 'partial')) {
        const token = raw.code === 'embedded' ? /假名 (\S+) 嵌在/.exec(String(raw.detail ?? ''))?.[1] ?? null : null
        const label = /字段：([^）]+)）/.exec(String(raw.detail ?? ''))?.[1] ?? ''
        const fields = label.replace(/\s*等 \d+ 个字段$/, '').split('、').map((name) => name.replace(/×\d+$/, '').trim()).filter(Boolean)
        item = { ...raw, ...(token ? { token } : {}), fields }
      }
      const history = relPath ? historyOf(relPath, item) : null
      const next = history ? { ...item, history, models } : item
      return vision[item.id] ? { ...next, vision: visionForPage(vision[item.id]) } : next
    }
    // Restored mangled values: the original text that was put back, so the
    // page can show those rows (the pseudonym is gone from them). Only for
    // older decisions that did not record their rows.
    const needOriginals = files.some((file) => file.items.some((item) => decisions[item.id]?.action === 'unglue' && !decisions[item.id].rows && item.code === 'embedded'))
    let originals = null
    if (needOriginals) {
      try {
        const vault = new Vault(layout(root).vault, settings.vaultPassphrase)
        await vault.load()
        originals = new Map([...vault.entries.values()].map((entry) => [entry.pseudonym, entry.original]))
      } catch { /* vault unreadable: rows are not shown */ }
    }
    const restoredOf = (item) => {
      if (!originals || decisions[item.id]?.action !== 'unglue' || decisions[item.id].rows) return null
      const token = item.token ?? /假名 (\S+) 嵌在/.exec(String(item.detail ?? ''))?.[1] ?? null
      return token && originals.has(token) ? originals.get(token) : null
    }
    const withRestored = (item) => { const text = restoredOf(item); return text ? { ...item, restored: text } : item }
    return {
      runId: id,
      imageCheck: imageJobs.get(id) ?? null,
      status: run.status,
      humanReview: run.humanReview ?? null,
      withheld: run.withheld === true,
      files: files.map((file) => {
        if (file.batch) return { ...file, editable: false, reason: null, items: file.items.map((item) => withVision({ ...item, decision: decisions[item.id] ?? null }, file.relPath)) }
        const where = locateDeliverable(run, file.relPath, dir)
        const ext = (file.relPath.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()
        const editable = Boolean(where && !where.nested && EDITABLE.has(ext))
        return {
          ...file,
          editable,
          reason: editable ? null : !where ? '找不到交付数据' : where.nested ? '位于多层嵌套的压缩包内' : '该格式不支持在页面中修改',
          items: file.items.map((item) => withRestored(withVision({ ...item, decision: decisions[item.id] ?? null }, file.relPath))),
        }
      }),
    }
  }

  /**
   * Record a reviewer decision. `replace` swaps every occurrence of the exact
   * text in the deliverable (also inside a single-level zip) and in the review
   * copy for a stable pseudonym from the vault; `accept` keeps the text. When
   * every item is decided, the batch is marked as reviewed and completed.
   */
  async function reviewDecide(runId, itemId, action, { removeIndexes = null } = {}) {
    const id = String(runId ?? '').trim()
    if (active?.runId === id) throw new Error('该批次正在运行')
    if (!['replace', 'accept', 'allow', 'remove', 'absorb', 'split', 'unglue'].includes(action)) throw new Error('未知的复核操作')
    const { root, dir, run } = await loadRunRecord(id)
    const files = JSON.parse(await readFile(join(dir, 'review-items.json'), 'utf8'))
    const file = files.find((entry) => entry.items.some((item) => item.id === itemId))
    const item = file?.items.find((entry) => entry.id === itemId)
    if (!item) throw new Error('找不到该复核项')
    let decisions = {}
    try { decisions = JSON.parse(await readFile(join(dir, 'review-decisions.json'), 'utf8')) } catch { /* first */ }
    const decision = { action, at: new Date().toISOString() }
    if (action === 'replace') {
      refuseWhileBusy(root, '替换')
      if (!item.text) throw new Error('该项没有可定位的文字，请确认或调整规则后重跑')
      const where = locateDeliverable(run, file.relPath, dir)
      const ext = (file.relPath.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()
      if (!where || where.nested || !EDITABLE.has(ext)) throw new Error('该文件不支持在页面中替换')
      let replacement = item.replacement
      if (!replacement) {
        if (!isKnownType(item.type)) throw new Error('未知的标识符类型')
        const release = holdRoot(root, '替换', '替换')
        try {
          const paths = layout(root)
          const vault = new Vault(paths.vault, settings.vaultPassphrase)
          await vault.load()
          vault.runId = id
          replacement = vault.token(item.type, item.text)
          await vault.save()
        } finally {
          release()
        }
      }
      const count = await editDocument(where, file.relPath, (doc) => replaceInDocument(doc, item.text, replacement))
      // The same text listed again (another field or check): an earlier
      // replace in this file already swapped every occurrence.
      const earlier = count === 0 && file.items.find((entry) => entry.id !== itemId && entry.text === item.text && decisions[entry.id]?.action === 'replace')
      if (count === 0 && !earlier) throw new Error('在交付数据中没有找到这段文字（可能已被处理），请在比对中确认')
      if (file.reviewCopy) {
        try { await editDocument({ file: join(root, file.reviewCopy) }, file.relPath, (doc) => replaceInDocument(doc, item.text, replacement)) } catch { /* copy missing */ }
      }
      Object.assign(decision, { replacement, count })
      // Keep the side-by-side comparison in step with the deliverable.
      await updateCompare(dir, file.relPath, item.text, replacement)
    }
    if (action === 'remove') {
      if (item.code !== 'opaque' || !item.baseId) throw new Error('只有无法检查的嵌入内容可以移除')
      const where = locateDeliverable(run, file.relPath, dir)
      const ext = (file.relPath.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()
      if (!where || where.nested || !EDITABLE.has(ext)) throw new Error('该文件不支持在页面中修改')
      const count = await editDocument(where, file.relPath, (doc) => doc.removeOpaque((baseId) => baseId === item.baseId))
      if (count === 0) throw new Error('交付数据中已没有这处内容')
      if (file.reviewCopy) {
        try { await editDocument({ file: join(root, file.reviewCopy) }, file.relPath, (doc) => doc.removeOpaque((baseId) => baseId === item.baseId)) } catch { /* copy missing */ }
      }
      Object.assign(decision, { count })
    }
    if (action === 'split') {
      // Several images in one record: remove the chosen ones, keep the rest.
      if (item.code !== 'opaque' || !item.baseId) throw new Error('只有无法检查的嵌入内容可以逐张处理')
      const chosen = new Set((Array.isArray(removeIndexes) ? removeIndexes : []).map(Number).filter(Number.isInteger))
      const total = Number(item.count ?? 1)
      if (chosen.size > 0) {
        const where = locateDeliverable(run, file.relPath, dir)
        const ext = (file.relPath.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()
        if (!where || where.nested || !EDITABLE.has(ext)) throw new Error('该文件不支持在页面中修改')
        const pick = (baseId, index) => baseId === item.baseId && chosen.has(index)
        const count = await editDocument(where, file.relPath, (doc) => doc.removeOpaque((baseId) => baseId === item.baseId, pick))
        if (count === 0) throw new Error('交付数据中已没有这些图片')
        if (file.reviewCopy) {
          try { await editDocument({ file: join(root, file.reviewCopy) }, file.relPath, (doc) => doc.removeOpaque((baseId) => baseId === item.baseId, pick)) } catch { /* copy missing */ }
        }
      }
      Object.assign(decision, { action: chosen.size === 0 ? 'accept' : chosen.size >= total ? 'remove' : 'split', removed: [...chosen].sort((x, y) => x - y), kept: Math.max(0, total - chosen.size) })
    }
    if (action === 'unglue') {
      // A pseudonym glued into a longer value (an ID cut in the middle):
      // put the original back at those places only.
      if (item.code !== 'embedded' && item.code !== 'partial') throw new Error('只有被部分替换的值可以还原')
      const where = locateDeliverable(run, file.relPath, dir)
      const ext = (file.relPath.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()
      if (!where || where.nested || !EDITABLE.has(ext)) throw new Error('该文件不支持在页面中修改')
      const vault = new Vault(layout(root).vault, settings.vaultPassphrase)
      await vault.load()
      const originals = new Map([...vault.entries.values()].map((entry) => [entry.pseudonym, entry.original]))
      const token = item.token ?? /假名 (\S+) 嵌在/.exec(String(item.detail ?? ''))?.[1] ?? null
      const label = /字段：([^）]+)）/.exec(String(item.detail ?? ''))?.[1] ?? ''
      const fields = new Set(label.replace(/\s*等 \d+ 个字段$/, '').split('、').map((name) => name.replace(/×\d+$/, '').trim()).filter(Boolean))
      const segments = Array.isArray(item.segments) ? new Set(item.segments) : null
      const inScope = (segment) => (segments ? segments.has(segment.id) : fields.size === 0 || fields.has(String(segment.field ?? '正文').split(' · ')[0]))
      const edits = (text) => gluedPseudonyms(text, originals, token)
      const touched = new Set()
      const count = await editDocument(where, file.relPath, (doc) => {
        const replacements = []
        for (const segment of doc.segments()) {
          if (!inScope(segment)) continue
          for (const edit of edits(segment.text)) { replacements.push({ id: segment.id, start: edit.start, end: edit.end, original: edit.token, replacement: edit.original }); touched.add(segment.id) }
        }
        if (replacements.length === 0) return 0
        replacements.sort((a, b) => b.start - a.start)
        return doc.apply(replacements)
      })
      // Nothing glued left: another item about the same value (a pseudonym
      // inside an ID is often reported twice, as embedded and as partial)
      // already restored it. That settles this one too.
      if (file.reviewCopy && count > 0) {
        try {
          await editDocument({ file: join(root, file.reviewCopy) }, file.relPath, (doc) => {
            const replacements = []
            for (const segment of doc.segments()) {
              if (!inScope(segment)) continue
              for (const edit of edits(segment.text)) replacements.push({ id: segment.id, start: edit.start, end: edit.end, original: edit.token, replacement: edit.original })
            }
            replacements.sort((a, b) => b.start - a.start)
            return replacements.length ? doc.apply(replacements) : 0
          })
        } catch { /* copy missing */ }
      }
      // The rows it changed, so the page can show them after the fact.
      Object.assign(decision, { count, rows: [...touched].slice(0, 200) })
      if (count > 0) {
        await updateCompareWith(dir, file.relPath, (current) => {
          let next = current
          for (const edit of [...edits(current)].sort((x, y) => y.start - x.start)) next = next.slice(0, edit.start) + edit.original + next.slice(edit.end)
          return next
        }, (change) => (segments ? segments.has(change.id) : fields.size === 0 || fields.has(String(change.field ?? '正文').split(' · ')[0])))
        // Other open items of this file about the same fields are settled when
        // nothing glued is left in their scope.
        const doc = await readDeliverable(where, file.relPath, (loaded) => loaded)
        for (const other of file.items) {
          if (other.id === itemId || decisions[other.id] || (other.code !== 'embedded' && other.code !== 'partial') || other.text) continue
          const otherLabel = /字段：([^）]+)）/.exec(String(other.detail ?? ''))?.[1] ?? ''
          const otherFields = new Set(otherLabel.replace(/\s*等 \d+ 个字段$/, '').split('、').map((name) => name.replace(/×\d+$/, '').trim()).filter(Boolean))
          const otherSegments = Array.isArray(other.segments) ? new Set(other.segments) : null
          const overlaps = otherSegments ? [...otherSegments].some((segmentId) => !segments || segments.has(segmentId)) : [...otherFields].some((name) => fields.size === 0 || fields.has(name))
          if (!overlaps) continue
          const otherToken = /假名 (\S+) 嵌在/.exec(String(other.detail ?? ''))?.[1] ?? null
          const left = doc ? doc.segments().some((segment) => (otherSegments ? otherSegments.has(segment.id) : otherFields.size === 0 || otherFields.has(String(segment.field ?? '正文').split(' · ')[0])) && gluedPseudonyms(segment.text, originals, otherToken).length > 0) : true
          if (!left) decisions[other.id] = { action: 'unglue', at: decision.at, count: 0, with: itemId, rows: decision.rows }
        }
      }
    }
    if (action === 'absorb') {
      // The rest of a value already pseudonymized next to it: delete it there.
      if (!item.text) throw new Error('该项没有可定位的文字')
      const where = locateDeliverable(run, file.relPath, dir)
      const ext = (file.relPath.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()
      if (!where || where.nested || !EDITABLE.has(ext)) throw new Error('该文件不支持在页面中修改')
      const count = await editDocument(where, file.relPath, (doc) => absorbInDocument(doc, item.text))
      if (count === 0) throw new Error('交付数据中没有紧挨着假名的这段文字，请用「替换为假名」')
      if (file.reviewCopy) {
        try { await editDocument({ file: join(root, file.reviewCopy) }, file.relPath, (doc) => absorbInDocument(doc, item.text)) } catch { /* copy missing */ }
      }
      Object.assign(decision, { count })
      await updateCompareWith(dir, file.relPath, (current) => {
        const edits = absorbEdits(current, item.text)
        if (edits.length === 0) return current
        let next = current
        for (const edit of [...edits].sort((x, y) => y.start - x.start)) next = next.slice(0, edit.start) + next.slice(edit.end)
        return next
      })
    }
    if (action === 'allow' && OPAQUE_CODES.has(item.code)) throw new Error('该项请选择「移除」或「确认保留」')
    decisions[itemId] = decision
    await writeFile(join(dir, 'review-decisions.json'), JSON.stringify(decisions, null, 2), { mode: 0o600 })

    const done = await finishReview({ id, root, dir, run, files, decisions })
    return { itemId, decision, completed: done, status: run.status }
  }

  /** Keep the side-by-side comparison of one file in step with an edit. */
  /** Keep one file's comparison in step with an edit given as a text transform. */
  async function updateCompareWith(dir, relPath, transform, only = null) {
    try {
      const listed = JSON.parse(await readFile(join(dir, 'compare', 'index.json'), 'utf8'))
      const entry = listed.find((item) => item.relPath === relPath)
      if (!entry || entry.skipped) return
      const compareFile = join(dir, 'compare', `${entry.n}.json`)
      const data = JSON.parse(await readFile(compareFile, 'utf8'))
      let touched = false
      for (const change of data.changes) {
        if (only && !only(change)) continue
        const current = change.same ? change.before : change.after
        const next = transform(current)
        if (next === current) continue
        if (next === change.before) { change.same = true; delete change.after } else { change.after = next; delete change.same }
        touched = true
      }
      if (touched) {
        entry.changed = data.changes.filter((change) => !change.same).length
        await writeFile(compareFile, JSON.stringify(data), { mode: 0o600 })
        await writeFile(join(dir, 'compare', 'index.json'), JSON.stringify(listed), { mode: 0o600 })
      }
    } catch { /* no comparison for this batch */ }
  }

  async function updateCompare(dir, relPath, from, to) {
    try {
      const listed = JSON.parse(await readFile(join(dir, 'compare', 'index.json'), 'utf8'))
      const entry = listed.find((item) => item.relPath === relPath)
      if (!entry || entry.skipped) return
      const compareFile = join(dir, 'compare', `${entry.n}.json`)
      const data = JSON.parse(await readFile(compareFile, 'utf8'))
      let touched = false
      for (const change of data.changes) {
        const current = change.same ? change.before : change.after
        if (!current.includes(from)) continue
        const next = current.split(from).join(to)
        if (next === change.before) { change.same = true; delete change.after } else { change.after = next; delete change.same }
        touched = true
      }
      if (touched) {
        entry.changed = data.changes.filter((change) => !change.same).length
        await writeFile(compareFile, JSON.stringify(data), { mode: 0o600 })
        await writeFile(join(dir, 'compare', 'index.json'), JSON.stringify(listed), { mode: 0o600 })
      }
    } catch { /* no comparison for this batch */ }
  }

  /** Rewrite a finished batch's report (json + md) and its index entry. */
  async function persistRun(id, root, dir, run) {
    await writeFile(join(dir, 'report.json'), JSON.stringify(run, null, 2), { mode: 0o600 })
    await writeFile(join(dir, 'report.md'), renderMarkdown(run), { mode: 0o600 })
    if (runs.has(id)) runs.set(id, { ...runs.get(id), manualEdits: run.manualEdits })
  }

  /**
   * A reviewer's edit of a finished batch, outside the review list:
   *  - `revert`: a pseudonym the reviewer judges a false positive goes back
   *    to its original (looked up in the vault);
   *  - `replace`: a value the pipeline missed becomes a pseudonym of `type`.
   * `scope` is the one file or every file of the batch. Edits the deliverable
   * (or the withheld result), the review copy and the comparison; logs to
   * manual-edits.json (pseudonyms, types and counts only) and the report.
   */
  async function manualEdit(runId, request = {}) {
    const id = String(runId ?? '').trim()
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error('批次 id 不正确')
    if (active?.runId === id) throw new Error('该批次正在运行')
    const action = request.action
    if (!['revert', 'replace'].includes(action)) throw new Error('未知的修改操作')
    const scope = request.scope === 'batch' ? 'batch' : 'file'
    const text = String(request.text ?? '').trim()
    if (text.length < 2 || text.length > 200) throw new Error('选中的文字应为 2–200 个字符')
    const { root, dir, run } = await loadRunRecord(id)
    refuseWhileBusy(root, action === 'revert' ? '还原' : '替换')

    let listed = []
    try { listed = JSON.parse(await readFile(join(dir, 'compare', 'index.json'), 'utf8')) } catch { /* none */ }
    let reviewFiles = []
    try { reviewFiles = JSON.parse(await readFile(join(dir, 'review-items.json'), 'utf8')) } catch { /* none */ }
    const relPath = String(request.relPath ?? '')
    const targets = scope === 'file'
      ? [relPath]
      : [...new Set([relPath, ...listed.filter((entry) => !entry.skipped).map((entry) => entry.relPath)])].filter(Boolean)
    if (targets.length === 0 || !targets[0]) throw new Error('没有指定文件')

    let from
    let to
    let type
    let pseudonym
    const release = holdRoot(root, action === 'revert' ? '还原' : '替换', action === 'revert' ? '还原' : '替换')
    try {
      const vault = new Vault(layout(root).vault, settings.vaultPassphrase)
      await vault.load()
      if (action === 'revert') {
        if (!isPseudonym(text)) throw new Error('只能还原本插件发放的假名')
        const entry = [...vault.entries.values()].find((item) => item.pseudonym === text)
        if (!entry) throw new Error('映射库中找不到这个假名')
        ;({ type } = entry)
        from = text
        to = entry.original
        pseudonym = text
      } else {
        type = String(request.type ?? '')
        if (!isKnownType(type)) throw new Error('请选择标识符类型')
        if (pseudonymSpans(text).length > 0) throw new Error('选中的文字含已替换的假名，请只选原文部分')
        vault.runId = id
        pseudonym = vault.token(type, text)
        await vault.save()
        from = text
        to = pseudonym
      }
    } finally {
      release()
    }

    let count = 0
    const files = []
    const skipped = []
    for (const target of targets) {
      const where = locateDeliverable(run, target, dir)
      const ext = (target.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()
      if (!where || where.nested || !EDITABLE.has(ext)) { if (target === relPath) skipped.push(target); continue }
      const edit = (doc) => (action === 'revert' ? replaceInDocument(doc, from, to) : replaceOutsidePseudonyms(doc, from, to))
      let n = 0
      try { n = await editDocument(where, target, edit) } catch (error) { if (target === relPath) throw error; continue }
      if (n === 0) continue
      count += n
      files.push(target)
      const copy = reviewFiles.find((entry) => entry.relPath === target)?.reviewCopy
      if (copy) { try { await editDocument({ file: join(root, copy) }, target, edit) } catch { /* copy missing */ } }
      await updateCompare(dir, target, from, to)
    }
    if (count === 0) {
      throw new Error(skipped.length ? '该文件不支持在页面中修改' : action === 'revert' ? '在交付数据中没有找到这个假名' : '在交付数据中没有找到这段文字（已替换的部分不会再替换）')
    }

    let log = []
    try { log = JSON.parse(await readFile(join(dir, 'manual-edits.json'), 'utf8')) } catch { /* first */ }
    log.push({ at: new Date().toISOString(), action, type, pseudonym, scope, files: files.length, count })
    await writeFile(join(dir, 'manual-edits.json'), JSON.stringify(log, null, 2), { mode: 0o600 })
    const sum = (kind) => {
      const own = log.filter((entry) => entry.action === kind)
      return { values: new Set(own.map((entry) => entry.pseudonym)).size, count: own.reduce((total, entry) => total + entry.count, 0) }
    }
    run.manualEdits = { reverted: sum('revert'), added: sum('replace'), at: log.at(-1).at }
    await persistRun(id, root, dir, run)
    return { action, type, pseudonym, original: action === 'revert' ? to : undefined, count, files: files.length, scope }
  }

  /** Reviewer edits of a batch so far (newest last). */
  async function manualEdits(runId) {
    const id = String(runId ?? '').trim()
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error('批次 id 不正确')
    const { dir } = await loadRunRecord(id)
    try { return { runId: id, entries: JSON.parse(await readFile(join(dir, 'manual-edits.json'), 'utf8')) } } catch { return { runId: id, entries: [] } }
  }

  /**
   * When every review item has a decision: record the review, mark the batch
   * completed and release a withheld result into the output root.
   */
  async function finishReview({ id, root, dir, run, files, decisions }) {
    const all = files.flatMap((entry) => entry.items)
    const done = all.every((entry) => decisions[entry.id])
    if (!done || run.humanReview) return done
    const values = all.map((entry) => decisions[entry.id])
    run.humanReview = {
      at: new Date().toISOString(),
      items: all.length,
      replaced: values.filter((value) => value.action === 'replace' || value.action === 'absorb' || value.action === 'unglue').length,
      removed: values.filter((value) => value.action === 'remove' || value.action === 'split').length,
      accepted: values.filter((value) => value.action === 'accept' || value.action === 'allow').length,
    }
    // Cross-check: on items the verifier reported (disputed / not re-judged),
    // replacing means the verifier was right, keeping means the detector was.
    const judged = all.filter((entry) => entry.code === 'disputed' || entry.code === 'model-residual')
    if (judged.length > 0) {
      run.humanReview.verifierRight = judged.filter((entry) => decisions[entry.id]?.action === 'replace').length
      run.humanReview.detectorRight = judged.filter((entry) => ['accept', 'allow'].includes(decisions[entry.id]?.action)).length
    }
    if (run.status === 'review') run.status = 'completed'
    if (run.withheld) {
      // Every item decided: the held result goes to the output root now.
      const delivered = await deliverStaged({ outputRoot: root, outputDir: join(dir, 'output'), kind: run.outputKind ?? 'dir', deliverName: run.deliverName ?? basename(run.inputDir ?? 'output') })
      run.output = delivered[0] ?? null
      if (delivered.length > 1) run.outputs = delivered
      run.withheld = false
      run.releasedAt = new Date().toISOString()
      run.warnings = (run.warnings ?? []).filter((warning) => !warning.startsWith('存在待复核项，交付数据暂扣'))
    }
    await writeFile(join(dir, 'report.json'), JSON.stringify(run, null, 2), { mode: 0o600 })
    await writeFile(join(dir, 'report.md'), renderMarkdown(run), { mode: 0o600 })
    const indexFile = layout(root).index
    try {
      const listed = JSON.parse(await readFile(indexFile, 'utf8'))
      for (const entry of listed) if (entry?.id === id) { entry.status = run.status; entry.output = run.output ?? null }
      await writeFile(indexFile, JSON.stringify(listed, null, 2), { mode: 0o600 })
    } catch { /* none */ }
    if (runs.has(id)) runs.set(id, { ...runs.get(id), status: run.status, humanReview: run.humanReview, withheld: run.withheld, output: run.output, outputs: run.outputs })
    return done
  }

  /**
   * One decision for many items: "remove" (unreadable embedded content,
   * one rewrite per file) or "accept". Replacements stay one by one.
   */
  async function reviewBulk(runId, itemIds, action, { bySuggestion = false } = {}) {
    const id = String(runId ?? '').trim()
    if (active?.runId === id) throw new Error('该批次正在运行')
    if (!['accept', 'remove'].includes(action)) throw new Error('批量操作只支持「移除」或「确认保留」')
    const wanted = new Set(Array.isArray(itemIds) ? itemIds.map(String) : [])
    if (wanted.size === 0) throw new Error('没有选中复核项')
    const { root, dir, run } = await loadRunRecord(id)
    const files = JSON.parse(await readFile(join(dir, 'review-items.json'), 'utf8'))
    let decisions = {}
    try { decisions = JSON.parse(await readFile(join(dir, 'review-decisions.json'), 'utf8')) } catch { /* first */ }
    let decided = 0
    for (const file of files) {
      const items = file.items.filter((item) => wanted.has(item.id) && !decisions[item.id])
      if (items.length === 0) continue
      if (action === 'remove') {
        if (items.some((item) => item.code !== 'opaque' || !item.baseId)) throw new Error('只有无法检查的嵌入内容可以移除')
        const where = locateDeliverable(run, file.relPath, dir)
        const ext = (file.relPath.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()
        if (!where || where.nested || !EDITABLE.has(ext)) throw new Error(`${file.relPath} 不支持在页面中修改`)
        const ids = new Set(items.map((item) => item.baseId))
        // By suggestion: in records whose images were read one by one, only
        // the images suggested for removal go; the others are kept.
        let vision = {}
        if (bySuggestion) { try { vision = JSON.parse(await readFile(join(dir, IMAGE_CHECKS), 'utf8')) } catch { /* none */ } }
        const only = new Map() // baseId -> Set of indexes to remove
        for (const item of items) {
          const per = bySuggestion ? vision[item.id]?.perImage : null
          if (per?.length) only.set(item.baseId, new Set(per.filter((image) => image.suggestion === 'remove').map((image) => image.index)))
        }
        const pick = (baseId, index) => !only.has(baseId) || only.get(baseId).has(index)
        await editDocument(where, file.relPath, (doc) => doc.removeOpaque((baseId) => ids.has(baseId), pick))
        if (file.reviewCopy) {
          try { await editDocument({ file: join(root, file.reviewCopy) }, file.relPath, (doc) => doc.removeOpaque((baseId) => ids.has(baseId), pick)) } catch { /* copy missing */ }
        }
        const at = new Date().toISOString()
        for (const item of items) {
          const set = only.get(item.baseId)
          const total = Number(item.count ?? 1)
          decisions[item.id] = set && set.size < total
            ? { action: set.size === 0 ? 'accept' : 'split', at, bulk: true, removed: [...set].sort((x, y) => x - y), kept: total - set.size }
            : { action, at, bulk: true }
          decided += 1
        }
        await writeFile(join(dir, 'review-decisions.json'), JSON.stringify(decisions, null, 2), { mode: 0o600 })
        continue
      }
      const at = new Date().toISOString()
      for (const item of items) { decisions[item.id] = { action, at, bulk: true }; decided += 1 }
      await writeFile(join(dir, 'review-decisions.json'), JSON.stringify(decisions, null, 2), { mode: 0o600 })
    }
    const done = await finishReview({ id, root, dir, run, files, decisions })
    return { decided, completed: done, status: run.status }
  }

  async function cancel(runId) {
    if (!active) return { cancelled: false, reason: '当前没有运行中的批次' }
    if (!active.runId) return { cancelled: false, reason: '批次正在启动，请稍后再试' }
    if (runId && active.runId !== runId) return { cancelled: false, reason: '批次不匹配' }
    activeController?.abort()
    return { cancelled: true, runId: active.runId }
  }

  /**
   * Withdraw the vault mappings first created by one batch (e.g. after a rule
   * mistake). Its output files are left as they are.
   */
  async function undoMappings(runId) {
    const id = String(runId ?? '').trim()
    if (!id) throw new Error('缺少批次 id')
    if (!RUN_ID.test(id)) throw new Error('批次 id 不正确')
    if (active?.runId === id) throw new Error('该批次仍在运行，请等它结束或先取消')
    const root = await locateRoot(id)
    if (!root) throw new Error(`找不到批次 ${id} 的输出位置`)
    // Held until the save: a batch started (or another undo / replace) in
    // between would load the old vault and its save would bring the
    // forgotten mappings back.
    const release = holdRoot(root, '撤销映射', '撤销映射')
    try {
      const paths = layout(root)
      const vaultPath = await stat(paths.vault).then(() => paths.vault, () => (
        stat(paths.legacyVault).then(() => paths.legacyVault, () => paths.vault)))
      const vault = new Vault(vaultPath, settings.vaultPassphrase)
      await vault.load()
      const removed = vault.forgetRun(id)
      await vault.save()
      return { runId: id, removed, vaultPath }
    } finally {
      release()
    }
  }

  async function ping(request = {}) {
    let { baseURL, model, apiKey } = resolveModel(request)
    if (request.keySource === 'verify') {
      // Verification endpoint: a saved key only for the endpoint it was saved
      // with (never sent to another server).
      apiKey = String(request.apiKey || (request.useSavedKey === false ? '' : savedKeyFor(baseURL, { verify: true })))
    }
    if (!baseURL) return { ok: false, error: '未配置模型端点' }
    const llm = createLlm({ baseURL, model: model || 'probe', apiKey, timeoutMs: 10000 })
    try {
      const models = await llm.listModels()
      return { ok: true, models }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  function isRunning() {
    return Boolean(active)
  }

  /**
   * A vault-changing operation must not run while a batch on the same output
   * root holds that vault in memory: the batch's next save would revert it.
   */
  function refuseWhileBusy(root, what) {
    const busy = busyRoots.get(resolve(root))
    if (busy) throw new Error(busyMessage(busy, what))
  }

  /**
   * Hold off batch starts while the page saves defaults (the save re-applies
   * the plugin). Throws when a batch runs; returns the release function.
   */
  function holdForConfigSave() {
    if (active || busyRoots.size > 0) throw new Error('有批次正在运行或映射库正在使用；请等它完成或取消后再保存默认配置')
    if (configSaving) throw new Error('正在保存默认配置，请稍候')
    configSaving = true
    return () => { configSaving = false }
  }

  /**
   * Plugin reapply or unload: a running batch is cancelled (its partial
   * result and report are kept, and it can be resumed) instead of running on
   * unseen by the new instance.
   */
  function dispose() {
    disposed = true
    activeController?.abort()
  }

  /**
   * Re-encrypt every known vault (output roots used on this machine) from
   * passphrase `from` to `to` ('' = plaintext). Vaults that cannot be read
   * with `from` are left as they are and counted in `failed`. `targets`
   * limits it to earlier results (used to roll back).
   */
  async function rekeyVaults(to, { from = settings.vaultPassphrase, targets = null } = {}) {
    const next = String(to ?? '')
    if (next === from) return { rekeyed: [], failed: 0 }
    let items = targets
    if (!items) {
      await list()
      const roots = new Set([configuredRoot(), ...runRoots.values(), ...knownRoots].filter(Boolean).map((root) => resolve(root)))
      items = []
      for (const root of roots) {
        const paths = layout(root)
        for (const file of [paths.vault, paths.legacyVault]) {
          if (await stat(file).then((info) => info.isFile(), () => false)) items.push({ root, file })
        }
      }
    }
    const roots = [...new Set(items.map((item) => item.root))]
    if (roots.some((root) => busyRoots.has(root))) throw new Error('有批次正在运行或映射库正在使用；请等它完成或取消后再修改映射库口令')
    const hold = { runId: null }
    for (const root of roots) busyRoots.set(root, hold)
    const rekeyed = []
    let failed = 0
    try {
      for (const item of items) {
        try {
          const vault = new Vault(item.file, from)
          await vault.load()
          vault.rekey(next)
          await vault.save()
          rekeyed.push(item)
        } catch {
          failed += 1
        }
      }
    } finally {
      for (const root of roots) if (busyRoots.get(root) === hold) busyRoots.delete(root)
    }
    return { rekeyed, failed }
  }

  /**
   * Validate the user-editable defaults. Only keys present in the request are
   * returned, so a partial save never clears other settings. The API key is
   * saved only when the page sends it explicitly (typed or cleared); it then
   * lives in the profile patch file, which the config editor writes with
   * mode 0600. It is never echoed back: configInfo reports only hasApiKey.
   */
  function normalizeDefaults(request = {}) {
    const next = {}
    if (request.baseURL !== undefined) {
      const value = String(request.baseURL).trim().replace(/\/+$/, '')
      if (value && !/^https?:\/\/\S+$/i.test(value)) throw new Error('端点必须以 http:// 或 https:// 开头')
      next.baseURL = value
    }
    if (request.model !== undefined) {
      const value = String(request.model).trim()
      if (value.length > 200) throw new Error('模型名称过长')
      next.model = value
    }
    if (request.outputRoot !== undefined) {
      const value = String(request.outputRoot).trim()
      if (value && !isAbsolute(value) && !value.startsWith('~/')) throw new Error('输出根目录必须是绝对路径（或以 ~/ 开头），留空表示输入目录旁')
      next.outputRoot = value
    }
    if (request.maxRounds !== undefined) {
      const value = Number(request.maxRounds)
      if (!Number.isInteger(value) || value < 1 || value > 6) throw new Error('核验轮次上限必须是 1–6 的整数')
      next.maxRounds = value
    }
    if (request.apiKey !== undefined) {
      const value = String(request.apiKey)
      if (value.length > 4096 || /[\r\n]/.test(value)) throw new Error('API Key 格式不正确')
      next.apiKey = value
    }
    if (request.verifyBaseURL !== undefined) {
      const value = String(request.verifyBaseURL).trim().replace(/\/+$/, '')
      if (value && !/^https?:\/\/\S+$/i.test(value)) throw new Error('核验模型端点必须以 http:// 或 https:// 开头')
      next.verifyBaseURL = value
    }
    if (request.verifyModel !== undefined) {
      const value = String(request.verifyModel).trim()
      if (value.length > 200) throw new Error('核验模型名称过长')
      next.verifyModel = value
    }
    if (request.verifyApiKey !== undefined) {
      const value = String(request.verifyApiKey)
      if (value.length > 4096 || /[\r\n]/.test(value)) throw new Error('核验模型 API Key 格式不正确')
      next.verifyApiKey = value
    }
    const integer = (key, min, max, label) => {
      if (request[key] === undefined) return
      const value = Number(request[key])
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}必须是 ${min}–${max} 的整数`)
      next[key] = value
    }
    integer('maxFiles', 1, 2000, '每组文件数')
    integer('concurrency', 1, 64, '模型并发（识别）')
    integer('verifyConcurrency', 1, 64, '核验并发')
    integer('maxDicomFiles', 1, 500000, 'DICOM 文件上限')
    integer('timeoutMs', 10000, 1800000, '模型调用超时（毫秒）')
    if (request.temperature !== undefined) {
      const value = Number(request.temperature)
      if (!Number.isFinite(value) || value < 0 || value > 2) throw new Error('温度必须在 0–2 之间')
      next.temperature = value
    }
    if (request.vaultPassphrase !== undefined) {
      const value = String(request.vaultPassphrase)
      if (value.length > 1024 || /[\r\n]/.test(value)) throw new Error('映射库口令格式不正确')
      if (value && value.length < 8) throw new Error('映射库口令至少 8 个字符')
      next.vaultPassphrase = value
    }
    if (request.disableThinking !== undefined) next.disableThinking = request.disableThinking === true
    if (request.autoConcurrency !== undefined) next.autoConcurrency = request.autoConcurrency !== false
    if (request.imageCheck !== undefined) next.imageCheck = request.imageCheck === true
    if (request.showSidebarEntry !== undefined) next.showSidebarEntry = request.showSidebarEntry !== false
    Object.assign(next, normalizePolicyPatch(request))
    if (Object.keys(next).length === 0) throw new Error('没有可保存的配置项')
    return next
  }

  function configInfo() {
    return {
      version: PLUGIN_VERSION,
      baseURL: settings.baseURL,
      model: settings.model,
      hasApiKey: Boolean(settings.apiKey),
      verifyBaseURL: settings.verifyBaseURL,
      verifyModel: settings.verifyModel,
      hasVerifyApiKey: Boolean(settings.verifyApiKey),
      // Empty means "beside the input": the page shows a hint instead of a path.
      outputRoot: configuredRoot() ?? '',
      maxRounds: settings.maxRounds,
      maxFiles: settings.maxFiles,
      maxDicomFiles: settings.maxDicomFiles,
      concurrency: settings.concurrency,
      verifyConcurrency: settings.verifyConcurrency,
      autoConcurrency: settings.autoConcurrency,
      imageCheck: settings.imageCheck,
      timeoutMs: settings.timeoutMs,
      temperature: settings.temperature,
      disableThinking: settings.disableThinking,
      showSidebarEntry: settings.showSidebarEntry,
      identifierPolicy: settings.identifierPolicy,
      quasiIdentifiers: settings.quasiIdentifiers,
      quasiPolicy: settings.quasiPolicy,
      allowValues: settings.allowValues,
      skipFields: settings.skipFields,
      forceValues: settings.forceValues,
      landline: settings.landline,
      opaquePolicy: settings.opaquePolicy,
      policySchema: policySchema(),
      vaultEncrypted: Boolean(settings.vaultPassphrase),
    }
  }

  return { start, status, list, report, advice, calls, deleteRun, clearRuns, reviewItems, reviewDecide, reviewBulk, manualEdit, manualEdits, crossCheck, compareList, compareFile, opaquePreview, imageCheck, cancel, undoMappings, ping, configInfo, isRunning, holdForConfigSave, dispose, rekeyVaults, normalizeDefaults, settings }
}
