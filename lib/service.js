/**
 * Run registry shared by the agent tools and the settings page. One operation
 * is implemented once here; both callers use the same methods.
 */
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { runBatch, newRunId, listInputFiles, cleanStaleStaging } from './pipeline.js'
import { Vault } from './pseudonym.js'
import { createLlm } from './llm.js'
import { layout, DEFAULT_ROOT, LEGACY_DEFAULT_ROOT, RECORDS_DIR } from './layout.js'
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
      temperature: settings.temperature,
      timeoutMs: overrides.timeoutMs ?? settings.timeoutMs,
      disableThinking: resolveDisableThinking(request),
    })
    return { llm, baseURL, model, disableThinking: resolveDisableThinking(request) }
  }

  async function start(request = {}) {
    if (active) throw new Error(`批次 ${active.runId} 正在运行，请等待完成或先取消`)
    const inputDir = String(request.inputDir ?? '').trim()
    if (!inputDir) throw new Error('缺少输入路径 inputDir')
    const absoluteInput = isAbsolute(inputDir) ? inputDir : resolve(defaultDirectory, inputDir)
    const info = await stat(absoluteInput).catch(() => null)
    if (!info?.isDirectory() && !info?.isFile()) throw new Error(`输入路径不存在或不是文件/目录: ${absoluteInput}`)
    if (info.isFile()) {
      // Fail fast instead of starting a batch that processes nothing.
      const listing = await listInputFiles(absoluteInput)
      if (listing.files.length === 0 && listing.dicom.length === 0 && listing.zips.length === 0) {
        throw new Error(`不支持的文件类型: ${absoluteInput}（支持 txt/md/csv/json/xlsx、zip 与 DICOM）`)
      }
    }

    // Default is <dirname(input)>/_medical-anonymizer — for a single file that
    // is a _medical-anonymizer folder next to the file.
    const outputRoot = resolveOutputRoot(request.outputRoot, absoluteInput)
    const root = resolve(outputRoot)
    const input = resolve(absoluteInput)
    if (root === input || input.startsWith(root.endsWith('/') ? root : `${root}/`)) {
      throw new Error('输出根目录不能与输入目录相同或包含输入目录，请选择输入目录之外的位置')
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

    const maxRounds = Number(request.maxRounds ?? settings.maxRounds)
    // Where the batch came from: the page, /anonymize, or an agent tool call
    // (with its session, so the page can link back to the conversation).
    const kind = ['panel', 'command', 'agent'].includes(request.source?.kind) ? request.source.kind : 'api'
    const sessionId = typeof request.source?.sessionId === 'string' && request.source.sessionId.length <= 200 ? request.source.sessionId : undefined
    const source = { kind, ...(sessionId ? { sessionId } : {}) }
    const { llm, baseURL, model, disableThinking } = withLlm(request)
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
      config: { model, baseURL, modelConfigured: Boolean(llm), maxRounds, disableThinking },
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
        maxRounds,
        maxFiles: settings.maxFiles,
        maxDicomFiles: settings.maxDicomFiles,
        concurrency: settings.concurrency,
        timeoutMs: settings.timeoutMs,
        model,
        baseURL,
        disableThinking,
        llm,
        vaultPassphrase: settings.vaultPassphrase,
        policy: {
          identifierPolicy: settings.identifierPolicy,
          quasiIdentifiers: settings.quasiIdentifiers,
          quasiPolicy: settings.quasiPolicy,
          allowValues: settings.allowValues,
          skipFields: settings.skipFields,
          landline: settings.landline,
        },
      },
      signal: controller.signal,
      onEvent: ({ run: current }) => {
        runs.set(runId, current)
      },
    }).then((run) => {
      runs.set(runId, run)
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
      const target = resolve(run.output)
      const inside = target.startsWith(paths.root + sep) && !target.startsWith(paths.records + sep) && dirname(target) === paths.root
      if (!inside) throw new Error('交付数据不在输出根目录下，未删除')
      await rm(target, { recursive: true, force: true })
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
    const { baseURL, model, apiKey } = resolveModel(request)
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
      if (!Number.isInteger(value) || value < 1 || value > 6) throw new Error('最大轮次必须是 1–6 的整数')
      next.maxRounds = value
    }
    if (request.apiKey !== undefined) {
      const value = String(request.apiKey)
      if (value.length > 4096 || /[\r\n]/.test(value)) throw new Error('API Key 格式不正确')
      next.apiKey = value
    }
    const integer = (key, min, max, label) => {
      if (request[key] === undefined) return
      const value = Number(request[key])
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}必须是 ${min}–${max} 的整数`)
      next[key] = value
    }
    integer('maxFiles', 1, 2000, '每组文件数')
    integer('concurrency', 1, 16, '并发文件数')
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
      baseURL: settings.baseURL,
      model: settings.model,
      hasApiKey: Boolean(settings.apiKey),
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
      policySchema: policySchema(),
      vaultEncrypted: Boolean(settings.vaultPassphrase),
    }
  }

  return { start, status, list, report, advice, calls, deleteRun, cancel, undoMappings, ping, configInfo, isRunning, normalizeDefaults, settings }
}
