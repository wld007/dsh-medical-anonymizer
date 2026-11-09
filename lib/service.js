/**
 * Run registry shared by the agent tools and the settings page. One operation
 * is implemented once here; both callers use the same methods.
 */
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { runBatch, newRunId, listInputFiles, cleanStaleStaging } from './pipeline.js'
import { Vault } from './pseudonym.js'
import { createLlm } from './llm.js'
import { layout, DEFAULT_ROOT, LEGACY_DEFAULT_ROOT, RECORDS_DIR, deliverStaged } from './layout.js'
import { CACHE_FILE } from './replay.js'
import { readZip, writeZip, isZipPath } from './zip.js'
import { isKnownType } from './rules.js'
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

const OPAQUE_CODES = new Set(['opaque', 'opaque-token', 'unreadable'])
import { normalizePolicyPatch, policyConfig, policySchema } from './policy.js'

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

  function resolveModel(request = {}) {
    const baseURL = String(request.baseURL || settings.baseURL || '').trim()
    const model = String(request.model || settings.model || '').trim()
    const apiKey = String(request.apiKey || settings.apiKey || '')
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
    return createLlm({
      baseURL: String(settings.verifyBaseURL || mainBaseURL || '').trim(),
      model,
      apiKey: settings.verifyApiKey || (settings.verifyBaseURL ? '' : settings.apiKey),
      temperature: overrides.temperature ?? settings.temperature,
      timeoutMs: overrides.timeoutMs ?? settings.timeoutMs,
      disableThinking: resolveDisableThinking(request),
    })
  }

  async function start(request = {}) {
    if (active) throw new Error(`批次 ${active.runId} 正在运行，请等待完成或先取消`)
    // Resume: same input and output root as a cancelled/failed batch, with
    // its model-reply cache replayed so finished work is not redone.
    let resume = null
    if (request.resumeFrom) {
      const previousId = String(request.resumeFrom).trim()
      if (!/^[\w-]{1,80}$/.test(previousId)) throw new Error('批次 id 不正确')
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
      concurrency: pick(request.concurrency, 1, 16, settings.concurrency),
      timeoutMs: pick(request.timeoutMs, 10000, 1800000, settings.timeoutMs),
      temperature: pick(request.temperature, 0, 2, settings.temperature, false),
      quasiIdentifiers: typeof request.quasiIdentifiers === 'boolean' ? request.quasiIdentifiers : settings.quasiIdentifiers,
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
      ['maxFiles', batch.maxFiles !== settings.maxFiles],
      ['timeoutMs', batch.timeoutMs !== settings.timeoutMs],
      ['temperature', batch.temperature !== settings.temperature],
      ['disableThinking', disableThinking !== settings.disableThinking],
      ['quasiIdentifiers', batch.quasiIdentifiers !== settings.quasiIdentifiers],
    ].filter(([, differs]) => differs).map(([key]) => key)
    const runId = newRunId()
    const controller = new AbortController()
    activeController = controller
    active = { runId }
    lastRunId = runId

    const startedAt = new Date().toISOString()
    const placeholder = {
      id: runId,
      startedAt,
      finishedAt: null,
      status: 'running',
      inputDir: absoluteInput,
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
        error: String(error?.message ?? error),
      }
      runs.set(runId, failed)
      const failedDir = layout(outputRoot).runDir(runId)
      await mkdir(failedDir, { recursive: true }).catch(() => {})
      await writeFile(join(failedDir, 'report.json'), JSON.stringify(failed, null, 2), { mode: 0o600 }).catch(() => {})
      return failed
    }).finally(() => {
      if (active?.runId === runId) {
        active = null
        activeController = null
      }
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
    const id = String(runId ?? '').trim() || lastRunId
    if (!id) return { run: null, active: active?.runId ?? null }
    if (runs.has(id)) return { run: runs.get(id), active: active?.runId ?? null }
    const loaded = await loadRunFromDisk(id)
    return { run: loaded, active: active?.runId ?? null }
  }

  function runRoot(id) {
    return runRoots.get(id) ?? configuredRoot()
  }

  async function loadRunFromDisk(id) {
    const candidates = [runRoot(id)].filter(Boolean)
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
    const id = String(runId ?? '').trim() || lastRunId
    if (!id) throw new Error('还没有批次')
    const root = runRoot(id)
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
    if (!id) return null
    const root = runRoot(id)
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
      const root = runRoot(id)
      try { log = root ? JSON.parse(await readFile(join(layout(root).runDir(id), 'calls.json'), 'utf8')) : [] } catch { log = [] }
    }
    const after = Number(since) || 0
    const entries = log.filter((entry) => entry.seq > after).slice(0, 2000)
    return { entries, last: entries.length ? entries[entries.length - 1].seq : after }
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
    const { dir } = await loadRunRecord(id)
    return JSON.parse(await readFile(join(dir, 'compare', `${index}.json`), 'utf8'))
  }

  /** Items needing manual review, with context and the decisions so far. */
  async function reviewItems(runId) {
    const id = String(runId ?? '').trim()
    if (!/^[\w-]{1,80}$/.test(id)) throw new Error('批次 id 不正确')
    const { dir, run } = await loadRunRecord(id)
    let files = []
    try { files = JSON.parse(await readFile(join(dir, 'review-items.json'), 'utf8')) } catch { /* none */ }
    let decisions = {}
    try { decisions = JSON.parse(await readFile(join(dir, 'review-decisions.json'), 'utf8')) } catch { /* none */ }
    return {
      runId: id,
      status: run.status,
      humanReview: run.humanReview ?? null,
      withheld: run.withheld === true,
      files: files.map((file) => {
        if (file.batch) return { ...file, editable: false, reason: null, items: file.items.map((item) => ({ ...item, decision: decisions[item.id] ?? null })) }
        const where = locateDeliverable(run, file.relPath, dir)
        const ext = (file.relPath.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()
        const editable = Boolean(where && !where.nested && EDITABLE.has(ext))
        return {
          ...file,
          editable,
          reason: editable ? null : !where ? '找不到交付数据' : where.nested ? '位于多层嵌套的压缩包内' : '该格式不支持在页面中修改',
          items: file.items.map((item) => ({ ...item, decision: decisions[item.id] ?? null })),
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
  async function reviewDecide(runId, itemId, action) {
    const id = String(runId ?? '').trim()
    if (active?.runId === id) throw new Error('该批次正在运行')
    if (!['replace', 'accept', 'allow', 'remove'].includes(action)) throw new Error('未知的复核操作')
    const { root, dir, run } = await loadRunRecord(id)
    const files = JSON.parse(await readFile(join(dir, 'review-items.json'), 'utf8'))
    const file = files.find((entry) => entry.items.some((item) => item.id === itemId))
    const item = file?.items.find((entry) => entry.id === itemId)
    if (!item) throw new Error('找不到该复核项')
    let decisions = {}
    try { decisions = JSON.parse(await readFile(join(dir, 'review-decisions.json'), 'utf8')) } catch { /* first */ }
    const decision = { action, at: new Date().toISOString() }
    if (action === 'replace') {
      if (!item.text) throw new Error('该项没有可定位的文字，请确认或调整规则后重跑')
      const where = locateDeliverable(run, file.relPath, dir)
      const ext = (file.relPath.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()
      if (!where || where.nested || !EDITABLE.has(ext)) throw new Error('该文件不支持在页面中替换')
      let replacement = item.replacement
      if (!replacement) {
        if (!isKnownType(item.type)) throw new Error('未知的标识符类型')
        const paths = layout(root)
        const vault = new Vault(paths.vault, settings.vaultPassphrase)
        await vault.load()
        vault.runId = id
        replacement = vault.token(item.type, item.text)
        await vault.save()
      }
      const count = await editDocument(where, file.relPath, (doc) => replaceInDocument(doc, item.text, replacement))
      if (count === 0) throw new Error('在交付数据中没有找到这段文字（可能已被处理），请在比对中确认')
      if (file.reviewCopy) {
        try { await editDocument({ file: join(root, file.reviewCopy) }, file.relPath, (doc) => replaceInDocument(doc, item.text, replacement)) } catch { /* copy missing */ }
      }
      Object.assign(decision, { replacement, count })
      // Keep the side-by-side comparison in step with the deliverable.
      try {
        const listed = JSON.parse(await readFile(join(dir, 'compare', 'index.json'), 'utf8'))
        const entry = listed.find((item) => item.relPath === file.relPath)
        if (entry && !entry.skipped) {
          const compareFile = join(dir, 'compare', `${entry.n}.json`)
          const data = JSON.parse(await readFile(compareFile, 'utf8'))
          let touched = false
          for (const change of data.changes) {
            const current = change.same ? change.before : change.after
            if (current.includes(item.text)) { change.after = current.split(item.text).join(replacement); delete change.same; touched = true }
          }
          if (touched) await writeFile(compareFile, JSON.stringify(data), { mode: 0o600 })
        }
      } catch { /* no comparison for this batch */ }
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
    if (action === 'allow' && OPAQUE_CODES.has(item.code)) throw new Error('该项请选择「移除」或「确认保留」')
    decisions[itemId] = decision
    await writeFile(join(dir, 'review-decisions.json'), JSON.stringify(decisions, null, 2), { mode: 0o600 })

    const done = await finishReview({ id, root, dir, run, files, decisions })
    return { itemId, decision, completed: done, status: run.status }
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
      replaced: values.filter((value) => value.action === 'replace').length,
      removed: values.filter((value) => value.action === 'remove').length,
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
  async function reviewBulk(runId, itemIds, action) {
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
        await editDocument(where, file.relPath, (doc) => doc.removeOpaque((baseId) => ids.has(baseId)))
        if (file.reviewCopy) {
          try { await editDocument({ file: join(root, file.reviewCopy) }, file.relPath, (doc) => doc.removeOpaque((baseId) => ids.has(baseId))) } catch { /* copy missing */ }
        }
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
    if (active?.runId === id) throw new Error('该批次仍在运行，请等它结束或先取消')
    const root = runRoot(id)
    if (!root) throw new Error(`找不到批次 ${id} 的输出位置`)
    const paths = layout(root)
    const vaultPath = await stat(paths.vault).then(() => paths.vault, () => (
      stat(paths.legacyVault).then(() => paths.legacyVault, () => paths.vault)))
    const vault = new Vault(vaultPath, settings.vaultPassphrase)
    await vault.load()
    const removed = vault.forgetRun(id)
    await vault.save()
    return { runId: id, removed, vaultPath }
  }

  async function ping(request = {}) {
    let { baseURL, model, apiKey } = resolveModel(request)
    if (request.keySource === 'verify') {
      // Verification endpoint: its own key; the detection key only when the
      // endpoint is the detection one (never sent to another server).
      const sameEndpoint = String(baseURL).replace(/\/+$/, '') === String(settings.baseURL).replace(/\/+$/, '')
      apiKey = String(request.apiKey || settings.verifyApiKey || (sameEndpoint ? settings.apiKey : ''))
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
    integer('concurrency', 1, 16, '模型并发')
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
      timeoutMs: settings.timeoutMs,
      temperature: settings.temperature,
      disableThinking: settings.disableThinking,
      showSidebarEntry: settings.showSidebarEntry,
      identifierPolicy: settings.identifierPolicy,
      quasiIdentifiers: settings.quasiIdentifiers,
      quasiPolicy: settings.quasiPolicy,
      allowValues: settings.allowValues,
      skipFields: settings.skipFields,
      landline: settings.landline,
      opaquePolicy: settings.opaquePolicy,
      policySchema: policySchema(),
      vaultEncrypted: Boolean(settings.vaultPassphrase),
    }
  }

  return { start, status, list, report, advice, calls, deleteRun, clearRuns, reviewItems, reviewDecide, reviewBulk, compareList, compareFile, cancel, undoMappings, ping, configInfo, isRunning, normalizeDefaults, settings }
}
