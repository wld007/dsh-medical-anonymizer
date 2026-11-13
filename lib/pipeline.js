/**
 * Batch orchestrator: rule pre-scan → model discovery → exact-span
 * pseudonymization → model + deterministic verification → bounded repair.
 */
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile, readdir, realpath, stat, statfs } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { join, relative, dirname, basename, resolve, sep } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { loadDocument, detectKind } from './formats.js'
import { processDicomFile, sniffDicom, dicomPolicy, dicomPathIdentifiers, remapUid } from './dicom/index.js'
import { scan, scanSuspects, isPseudonym, pseudonymSpans, isKnownType, plausible, isCodeLike, looksLikeInstitution, PSEUDONYM_TOKEN_SOURCE } from './rules.js'
import { detectPrompt, verifyPrompt, adjudicatePrompt, profilePrompt, DETECT_TYPES, entitiesOf } from './llm.js'
import { Vault } from './pseudonym.js'
import { renderMarkdown } from './report.js'
import { extractZip, isZipPath, createZipBudget, refundZipBudget } from './zip.js'
import { createPathAnonymizer } from './paths.js'
import { createWriteGuard, fingerprint, changedSince } from './guard.js'
import { advise } from './advisor.js'
import { createReplayCache } from './replay.js'
import { layout, migrateLegacy, freeName, entries as dirEntries, RECORDS_DIR, isOutputRoot, deliverStaged } from './layout.js'
import { openRecords } from './records.js'
import { layered, isCodeList } from './layers.js'
import {
  resolvePolicy, maskValue, redactLabel, isProtectedText, insideProtected,
  dateShiftDays, quasiReplacements, IDENTIFIERS,
} from './policy.js'

const ALLOWED = new Set(['.txt', '.md', '.csv', '.json', '.xlsx'])
// Extensions under which DICOM files are commonly exported. PACS exports are
// often extensionless or named like "1.2.840....123"; the content decides.
const DICOM_EXT = new Set(['.dcm', '.dicom', '.dic', '.ima', '(none)'])
const isDicomCandidate = (ext) => DICOM_EXT.has(ext) || /^\.\d+$/.test(ext)

const BARE_LABELS = new Set([
  '患者', '病人', '姓名', '医生', '医师', '证件', '电话', '手机', '邮箱', '化名',
  '地址', '住址', '病历', '住院', '就诊', '社保', '银行卡', '医院', '性别', '年龄',
])

/**
 * List supported input files.
 *
 * `exclude` holds directories that must never be read as input — in practice
 * the output root. Without this, an output root placed inside the input
 * directory would feed the previous run's vault (original values + salt),
 * reports, and outputs back in as "records" and copy them into the new output.
 *
 * @returns {{ files: string[], dicom: string[], unsupported: { count: number, byExt: Record<string, number> } }}
 */
export async function listInputFiles(inputDir, { exclude = [], select = null } = {}) {
  const root = resolve(inputDir)
  const realRoot = await realpath(root).catch(() => root)
  const excluded = []
  for (const candidate of exclude) {
    if (!candidate) continue
    const real = await realpath(candidate).catch(() => resolve(candidate))
    // Map the excluded directory into the walk's coordinate space so that a
    // symlinked spelling of the same directory is still recognised.
    if (real === realRoot || real.startsWith(realRoot + sep)) {
      excluded.push(join(root, relative(realRoot, real)))
    }
    excluded.push(resolve(candidate))
  }
  const isExcluded = (path) => excluded.some((dir) => path === dir || path.startsWith(dir + sep))

  const files = []
  const dicom = []
  const zips = []
  const unsupported = { count: 0, byExt: {} }
  async function classify(path, name) {
    const dot = name.lastIndexOf('.')
    const ext = dot > 0 ? name.slice(dot).toLowerCase() : '(none)'
    if (ALLOWED.has(ext)) {
      files.push(path)
    } else if (isZipPath(name)) {
      zips.push(path)
    } else if (isDicomCandidate(ext) && await sniffDicom(path)) {
      dicom.push(path)
    } else {
      unsupported.count += 1
      unsupported.byExt[ext] = (unsupported.byExt[ext] ?? 0) + 1
    }
  }
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || isExcluded(path) || await isOutputRoot(path, entry.name)) continue
        await walk(path)
      } else if (entry.isFile()) {
        await classify(path, entry.name)
      }
    }
  }
  // A single file is a valid input: it is classified on its own, without the
  // hidden-file filter (the user named it explicitly).
  const info = await stat(root)
  // An output root (vault with original values, path maps, reports) is never
  // input, whether chosen itself or as one of several selected folders.
  const refuseOutputRoot = async (dir) => {
    if (await isOutputRoot(dir)) throw new Error('所选目录是脱敏输出目录（含映射库和原始路径对照），不能作为输入；请选择原始数据目录')
  }
  if (select?.length) {
    // Several entries of one folder chosen together: only those, each named
    // explicitly (so no hidden-file filter on the chosen names themselves).
    for (const name of select) {
      const path = join(root, name)
      const entry = await stat(path).catch(() => null)
      if (entry?.isDirectory() && !isExcluded(path)) await refuseOutputRoot(path)
    }
    for (const name of select) {
      const path = join(root, name)
      const entry = await stat(path).catch(() => null)
      if (entry?.isFile()) await classify(path, name)
      else if (entry?.isDirectory() && !isExcluded(path)) await walk(path)
    }
  } else if (info.isFile()) {
    await classify(root, basename(root))
  } else {
    await refuseOutputRoot(root)
    await walk(root)
  }
  return { files: files.sort(), dicom: dicom.sort(), zips: zips.sort(), unsupported }
}

const REDACT_ALL = { identifiers: Object.fromEntries(IDENTIFIERS.map((item) => [item.type, 'redact'])) }

/**
 * An input name as reports may show it before the batch's own path mapping
 * exists (or when the batch stops before it): identifiers the path rules see
 * become type labels ("张三_<身份证号>" → "[姓名]_[身份证号]"). No vault needed.
 */
export function provisionalName(name) {
  const text = String(name ?? '')
  if (!text) return text
  try {
    return createPathAnonymizer({ vault: null, policy: REDACT_ALL }).map(text)
  } catch {
    return text
  }
}

/** `inputDir` with its own last segment passed through provisionalName. */
export function displayInputPath(inputDir) {
  const absolute = resolve(String(inputDir ?? ''))
  const name = basename(absolute)
  const shown = provisionalName(name)
  return shown === name ? inputDir : join(dirname(absolute), shown)
}

export function newRunId() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `${stamp}-${randomBytes(3).toString('hex')}`
}

// Archives inside archives are expanded up to this depth (the outer zip is 1).
const MAX_ZIP_DEPTH = 3
const posix = (path) => path.split(sep).join('/')

/**
 * Extract every input zip (and nested zips) into a private staging directory.
 * The original archives are only read. Each staged file keeps a logical path
 * "<zip path>/<entry path>" that decides where its output goes; the output
 * folder of each archive is packed back into a zip after the run.
 */
async function stageArchives(zips, inputRoot, stageRoot, run, limits) {
  const staged = { files: [], dicom: [], archives: [] }
  let counter = 0
  // `budget` is shared by one top-level archive and the zips nested in it
  // (independent archives of a batch are judged separately).
  async function expand(zipPath, logical, depth, budget) {
    if (depth > MAX_ZIP_DEPTH) {
      run.skipped.unsupported += 1
      run.skipped.unsupportedByExt['.zip（嵌套过深）'] = (run.skipped.unsupportedByExt['.zip（嵌套过深）'] ?? 0) + 1
      return
    }
    const dest = join(stageRoot, String(counter++))
    let listing
    try {
      const result = await extractZip(zipPath, dest, limits, { budget })
      for (const warning of result.warnings ?? []) run.warnings.push(`压缩包提示：${zipProblem(warning)}`)
      listing = await listInputFiles(dest)
    } catch (error) {
      run.skipped.zipFailed += 1
      // Entry names in codec errors can contain patient names: only the
      // category reaches the report.
      run.archiveErrors.push({ error: zipProblem(String(error?.message ?? error)) })
      return
    }
    staged.archives.push({ logical, depth, files: listing.files.length + listing.dicom.length })
    const logicalOf = (path) => `${logical}/${posix(relative(dest, path))}`
    for (const path of listing.files) staged.files.push({ path, relPath: logicalOf(path) })
    for (const path of listing.dicom) staged.dicom.push({ path, relPath: logicalOf(path) })
    run.skipped.unsupported += listing.unsupported.count
    for (const [ext, count] of Object.entries(listing.unsupported.byExt)) {
      run.skipped.unsupportedByExt[ext] = (run.skipped.unsupportedByExt[ext] ?? 0) + count
    }
    for (const nested of listing.zips) {
      // The nested zip was charged as an entry of this archive; its contents
      // replace it, so give it back and drop the staged copy once expanded
      // (it is not processed further), keeping disk use within the budget.
      if (depth < MAX_ZIP_DEPTH) refundZipBudget(budget, (await stat(nested)).size)
      await expand(nested, logicalOf(nested), depth + 1, budget)
      if (depth < MAX_ZIP_DEPTH) await rm(nested, { force: true })
    }
  }
  for (const zip of zips) await expand(zip, posix(relative(inputRoot, zip)) || basename(zip), 1, createZipBudget())
  return staged
}

/**
 * Output paths for archive contents: "pack.zip/a/b.json" → "pack/a/b.json"
 * (nested zips too), so a zip input is delivered as a plain folder. When a
 * sibling file or folder already has that name, "pack (zip)" is used.
 */
function unzipOutputNames(mapped, archives) {
  const isArchive = (logical) => archives.has(logical)
  // Output prefixes that do not come from an archive: names to avoid.
  const taken = new Set()
  for (const [logical, out] of mapped) {
    const inParts = logical.split('/')
    const outParts = out.split('/')
    for (let i = 1; i <= outParts.length; i += 1) {
      if (inParts.slice(0, i).some((_, j) => isArchive(inParts.slice(0, j + 1).join('/')))) break
      taken.add(outParts.slice(0, i).join('/'))
    }
  }
  for (const [logical, out] of mapped) {
    const inParts = logical.split('/')
    const outParts = out.split('/')
    if (inParts.length !== outParts.length) continue
    for (let i = 0; i < inParts.length; i += 1) {
      if (!isArchive(inParts.slice(0, i + 1).join('/'))) continue
      const base = outParts[i].replace(/\.zip$/i, '')
      const parent = outParts.slice(0, i).join('/')
      const plain = parent ? `${parent}/${base}` : base
      outParts[i] = taken.has(plain) ? `${base} (zip)` : base
    }
    mapped.set(logical, outParts.join('/'))
  }
}

function zipProblem(message) {
  const categories = [
    [/炸弹|压缩比/, '疑似 zip 炸弹（压缩比或解压后大小异常）'],
    [/条目数|单文件上限|总大小|上限/, '超过解压大小或文件数上限'],
    [/加密/, '压缩包已加密'],
    [/压缩方式|分卷|多卷|disk/i, '使用了不支持的压缩方式或分卷格式'],
    [/穿越|非法字符|绝对路径/, '包内含不安全的路径'],
    [/CRC|校验/i, '包内文件校验失败（可能已损坏）'],
    [/重复|冲突/, '包内有重名文件'],
    [/SFX|自解压/i, '是自解压格式，已按普通 zip 读取'],
  ]
  for (const [pattern, label] of categories) if (pattern.test(message)) return label
  return '压缩包格式无法识别或已损坏'
}

const STAGE_PREFIX = 'dsh-anon-'
const STAGE_OWNER = '.owner'

/** Is process `pid` still alive? */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * Remove staging folders left behind by a process that was killed mid-run
 * (they hold extracted patient files). A folder is stale when the process
 * recorded in its owner file is gone, or when it has no owner file and is
 * older than an hour.
 */
export async function cleanStaleStaging(root = tmpdir()) {
  let removed = 0
  let names = []
  try {
    names = await readdir(root)
  } catch {
    return 0
  }
  for (const name of names) {
    if (!name.startsWith(STAGE_PREFIX)) continue
    const dir = join(root, name)
    try {
      const info = await stat(dir)
      if (!info.isDirectory()) continue
      const owner = Number.parseInt(await readFile(join(dir, STAGE_OWNER), 'utf8').catch(() => ''), 10)
      const stale = Number.isInteger(owner) ? !alive(owner) : Date.now() - info.mtimeMs > 3_600_000
      if (stale) {
        await rm(dir, { recursive: true, force: true })
        removed += 1
      }
    } catch { /* another process may be removing it */ }
  }
  return removed
}

async function createStageRoot() {
  await cleanStaleStaging()
  const dir = await mkdtemp(join(tmpdir(), STAGE_PREFIX))
  await writeFile(join(dir, STAGE_OWNER), String(process.pid), { mode: 0o600 })
  return dir
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function pool(items, limit, worker) {
  let next = 0
  let failure = null
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !failure) {
      const index = next++
      try {
        await worker(items[index], index)
      } catch (error) {
        failure ??= error
      }
    }
  })
  await Promise.all(runners)
  if (failure) throw failure
}

export async function runBatch(args) {
  // Timers that must stop however the batch ends (a throw included).
  const life = { timers: [], ended: false }
  try {
    return await runBatchBody({ ...args, life })
  } finally {
    life.ended = true
    for (const timer of life.timers) clearInterval(timer)
  }
}

async function runBatchBody({
  inputDir,
  outputRoot,
  options = {},
  onEvent = () => {},
  signal,
  life,
}) {
  const started = Date.now()
  const runId = options.runId ?? newRunId()
  const maxRounds = clampInt(options.maxRounds, 1, 6, 3)
  // Files per chunk. Larger inputs are split into chunks that share the vault
  // and the batch dictionary; nothing is dropped.
  const maxFiles = clampInt(options.maxFiles, 1, 2000, 200)
  const concurrency = clampInt(options.concurrency, 1, MAX_CONCURRENCY, 4)
  // The verification model may sit on another server: its own request slots.
  const verifyConcurrency = clampInt(options.verifyConcurrency, 1, MAX_CONCURRENCY, concurrency)
  // A single CT study is often hundreds to thousands of slices; DICOM files
  // are cheap (header only, no model calls) and have their own cap.
  const maxDicomFiles = clampInt(options.maxDicomFiles, 1, 500_000, 50_000)
  const maxFileBytes = clampInt(options.maxFileBytes, 1_000_000, 200_000_000, 30_000_000)
  const baseLlm = options.llm ?? null
  const baseVerifyLlm = options.verifyLlm ?? null
  // Model calls are not capped: every file gets full discovery and verification.
  const llmStats = { calls: 0, tokens: 0 }
  const policy = resolvePolicy(options.policy ?? {})

  // Finished data goes straight into the output root; the vault, index and
  // reports live under _records (see layout.js). Files are written to a
  // staging folder inside the run's records and moved out when done.
  const paths = layout(outputRoot)
  const runDir = paths.runDir(runId)
  const outputDir = join(runDir, 'output')
  const autoConcurrency = options.autoConcurrency === true && Boolean(baseLlm)
  const originalInput = resolve(inputDir)
  const vaultPath = paths.vault
  const inputIsFile = (await stat(inputDir)).isFile()
  // Multi-select: inputDir is the common folder, selection the chosen names;
  // each chosen entry is delivered on its own, like a single-file input.
  const selection = Array.isArray(options.selection) && options.selection.length > 0 ? options.selection : null
  const guard = await createWriteGuard({ inputRoots: selection ? selection.map((name) => join(inputDir, name)) : [inputDir], outputRoot })
  await migrateLegacy(outputRoot, guard)
  // Batch list, call log, cross-check, advice and resume data (see
  // records.js). Opened now so an old layout is imported, or a database
  // newer than this plugin stops the batch, before any work is done.
  await openRecords(paths.records, { guard })
  // Opened on every use: a store closed meanwhile (plugin unload) reopens.
  const records = () => openRecords(paths.records, { guard })
  // Model replies are cached per run so a cancelled/failed/interrupted batch
  // can resume; a resumed run replays the earlier run's replies (replay.js).
  const replay = await createReplayCache({ records, runId, from: options.resumeFrom ? [options.resumeFrom] : [], sources: options.replaySources ?? [] })
  // Limiter inside the cache: replayed replies need no request slot. Live
  // request counts per model (in flight / waiting) are shown on the page.
  const requestStats = {
    detect: { model: baseLlm?.model ?? '', active: 0, queued: 0, limit: concurrency },
    ...(baseVerifyLlm ? { verify: { model: baseVerifyLlm.model ?? '', active: 0, queued: 0, limit: verifyConcurrency } } : {}),
  }
  const detectLimiter = limitRequests(baseLlm, concurrency, requestStats.detect)
  const llm = replay.wrap(detectLimiter)
  // Verification may use its own model (own slots); the replay cache tells
  // them apart by prompt.
  const verifyLimiter = baseVerifyLlm ? limitRequests(baseVerifyLlm, verifyConcurrency, requestStats.verify) : null
  const verifyLlm = baseVerifyLlm ? replay.wrap(verifyLimiter) : llm

  const vault = new Vault(vaultPath, options.vaultPassphrase ?? '')
  await vault.load()
  vault.runId = runId

  const run = {
    id: runId,
    startedAt: new Date(started).toISOString(),
    finishedAt: null,
    status: 'running',
    // Until the batch's path mapping exists (and if the batch stops before
    // it does), the input's name is shown with rule-detected identifiers as
    // type labels, never as typed.
    inputDir: displayInputPath(inputDir),
    ...(selection ? { selection: selection.map(provisionalName) } : {}),
    outputRoot,
    runDir,
    source: options.source ?? { kind: 'api' },
    // Known from the start, so the page shows a resumed batch as such.
    ...(options.resumeFrom ? { resumedFrom: options.resumeFrom } : {}),
    config: {
      model: options.model ?? llm?.model ?? '',
      baseURL: options.baseURL ?? llm?.baseURL ?? '',
      modelConfigured: Boolean(llm),
      // Separate verification model, if any (the page and report show it).
      ...(baseVerifyLlm?.model ? { verifyModel: baseVerifyLlm.model } : {}),
      disableThinking: options.disableThinking === true,
      maxRounds,
      concurrency,
      ...(baseVerifyLlm ? { verifyConcurrency } : {}),
      ...(autoConcurrency ? { autoConcurrency: true } : {}),
      chunkSize: maxFiles,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      // Values that differ from the saved defaults (set for this batch only).
      ...(options.overridden?.length ? { overridden: options.overridden } : {}),
      policy,
    },
    totals: {
      files: 0, filesFailed: 0, filesReview: 0, entities: 0,
      byType: {}, modelCalls: 0, tokens: 0, unresolved: 0, quasi: {},
      dicom: null, newMappings: 0, distinctIds: 0,
    },
    skipped: { unsupported: 0, unsupportedByExt: {}, overLimit: 0, dicomdir: 0, zipFailed: 0 },
    chunks: 1,
    archives: [],
    archiveErrors: [],
    paths: { renamed: 0, map: null },
    sourceCheck: null,
    warnings: [],
    files: [],
  }

  // Listed as running from the start, with what a resume needs: a batch cut
  // off by a crash or an app quit is found again as interrupted and can be
  // continued (service.js). The heartbeat tells a live batch from such a one.
  const resumeDoc = { inputDir: originalInput, ...(selection ? { selection } : {}), outputRoot: resolve(outputRoot), model: run.config.model ?? '' }
  let ended = false
  const beat = async () => {
    if (ended || life.ended) return
    const store = await records()
    if (ended || life.ended) return
    run.heartbeatAt = new Date().toISOString()
    await store.putRun({ ...runSummary(run), status: 'running' })
    await store.putDoc(runId, 'live', liveSnapshot(run))
  }
  await (await records()).putDoc(runId, 'resume', resumeDoc)
  await beat()
  // Cleared by runBatch on every way out (life.timers).
  life.timers.push(setInterval(() => { beat().catch(() => {}) }, HEARTBEAT_MS))
  life.timers.at(-1).unref?.()

  const checkAbort = () => {
    if (signal?.aborted) {
      const error = new Error('已取消')
      error.code = 'cancelled'
      throw error
    }
  }

  const emit = (phase) => {
    onEvent({ phase, run })
  }
  // Heap of the process running the plugin (shared with the Harness). The
  // heap limit is what a too-large chunk would hit, so peak/limit drives the
  // chunk-size advice; rss is shown for reference only.
  const sampleMemory = () => {
    const usage = process.memoryUsage()
    const memory = run.memory ?? { peakHeap: 0, peakRss: 0 }
    memory.heapUsed = usage.heapUsed
    memory.rss = usage.rss
    memory.heapLimit = getHeapStatistics().heap_size_limit
    memory.peakHeap = Math.max(memory.peakHeap, usage.heapUsed)
    memory.peakRss = Math.max(memory.peakRss, usage.rss)
    run.memory = memory
    // Free space where the output and records are written (a full disk made
    // batches fail with ENOSPC). Every 10 s; the root may not exist yet.
    const nowMs = Date.now()
    if (!(nowMs - (sampleMemory.diskAt ?? 0) < 10000)) {
      sampleMemory.diskAt = nowMs
      const probe = async () => {
        for (const dir of [outputRoot, dirname(resolve(outputRoot))]) {
          try {
            const fs = await statfs(dir)
            const free = Number(fs.bavail) * Number(fs.bsize)
            const total = Number(fs.blocks) * Number(fs.bsize)
            const disk = run.disk ??= { minFree: free }
            Object.assign(disk, { free, total, minFree: Math.min(disk.minFree ?? free, free) })
            return
          } catch { /* try the parent */ }
        }
      }
      probe().catch(() => {})
    }
    // Request load per model over time (in flight / queued), for the page's
    // busy chart. Every 2 s; past 360 points every other point is dropped.
    if (run.requests?.detect) {
      const series = run.loadSeries ??= { step: 2000, points: [] }
      const d = run.requests.detect
      const v = run.requests.verify
      series.points.push(v ? [d.active, d.queued, v.active, v.queued] : [d.active, d.queued])
      // Slot limit at each sample: it moves with automatic concurrency.
      series.limits ??= []
      series.limits.push(v ? [d.limit, v.limit] : [d.limit])
      // Completed calls and output tokens so far, per model (throughput is
      // the difference between two samples).
      const done = (m) => [Number(m?.okN ?? 0), Number(m?.outSum ?? 0)]
      series.done ??= []
      series.done.push(v ? [...done(run.totals.models?.detect), ...done(run.totals.models?.verify)] : done(run.totals.models?.detect))
      // Input + output tokens of completed calls so far: the throughput the
      // automatic concurrency climbs on.
      const io = (m) => Number(m?.ioTokens ?? 0)
      series.io ??= []
      series.io.push(v ? [io(run.totals.models?.detect), io(run.totals.models?.verify)] : [io(run.totals.models?.detect)])
      // Inference server per model at the same moment (vLLM /metrics, the
      // whole server): [running, waiting, KV share], or null when unreadable.
      const srv = (key) => {
        const entry = run.server?.[key]
        return entry?.available ? [entry.running ?? 0, entry.waiting ?? 0, Math.round((entry.kv ?? 0) * 1000) / 1000] : null
      }
      series.srv ??= []
      series.srv.push(v ? [srv('detect'), srv('verify')] : [srv('detect')])
      if (series.points.length > 360) {
        series.points = series.points.filter((_, index) => index % 2 === 0)
        series.done = series.done.filter((_, index) => index % 2 === 0)
        series.limits = series.limits.filter((_, index) => index % 2 === 0)
        series.io = series.io.filter((_, index) => index % 2 === 0)
        series.srv = series.srv.filter((_, index) => index % 2 === 0)
        series.step *= 2
      }
    }
  }
  run.requests = requestStats
  run.stageRequests = {}
  sampleMemory()
  // Files in flight: more than the request slots (×3, at most 32) so that
  // later files' requests queue up behind earlier ones and the model is never
  // left waiting between one file's stages. The model limiter keeps the load.
  // With automatic concurrency the slots may grow: keep enough files open
  // to feed them (memory still pauses new files at 70 %).
  const fileSlots = autoConcurrency ? MAX_FILE_SLOTS : Math.min(MAX_FILE_SLOTS, Math.max(concurrency, 3 * Math.max(concurrency, baseVerifyLlm ? verifyConcurrency : 0)))
  let activeFiles = 0
  const memoryTight = () => {
    const memory = run.memory
    return Boolean(memory?.heapLimit) && memory.heapUsed / memory.heapLimit >= 0.7
  }
  run.fileSlots = fileSlots
  let memoryTimer = null
  emit('start')

  // For a single-file input, paths are relative to its parent so the output
  // keeps the original file name (output/<name>).
  const inputRoot = inputIsFile ? dirname(resolve(inputDir)) : resolve(inputDir)
  let deliverName = provisionalName(basename(resolve(inputDir)))

  let listing
  try {
    listing = await listInputFiles(inputDir, { exclude: [outputRoot], select: selection })
    run.skipped.unsupported = listing.unsupported.count
    run.skipped.unsupportedByExt = { ...listing.unsupported.byExt }
  } catch (error) {
    throw new Error(`无法读取输入路径: ${describeError(error)}`)
  }
  // Fingerprint every source file (archives included) before anything runs.
  const sourcePrints = await fingerprint([...listing.files, ...listing.dicom, ...listing.zips])

  const stageRoot = listing.zips.length > 0 ? await createStageRoot() : null
  const staged = stageRoot
    ? await stageArchives(listing.zips, inputRoot, stageRoot, run, options.zipLimits)
    : { files: [], dicom: [], archives: [] }
  const items = [
    ...listing.files.map((path) => ({ path, relPath: posix(relative(inputRoot, path)) })),
    ...staged.files,
  ].sort((a, b) => a.relPath.localeCompare(b.relPath))
  let dicomItems = [
    ...listing.dicom.map((path) => ({ path, relPath: posix(relative(inputRoot, path)) })),
    ...staged.dicom,
  ].sort((a, b) => a.relPath.localeCompare(b.relPath))

  if (dicomItems.length > maxDicomFiles) {
    const over = dicomItems.length - maxDicomFiles
    run.skipped.overLimit += over
    dicomItems = dicomItems.slice(0, maxDicomFiles)
    run.warnings.push(`输入共有 ${maxDicomFiles + over} 个 DICOM 文件，超过单批上限 ${maxDicomFiles}，其余 ${over} 个未处理；请调大 maxDicomFiles。`)
  }
  // Shown by the page as overall progress; run.inflight lists files being processed now.
  run.planned = items.length + dicomItems.length
  // Data-volume progress: bytes of finished files plus an estimate of how far
  // each in-flight file has got (see `fraction` in processFile's progress).
  const sizeOf = new Map()
  for (const item of [...items, ...dicomItems]) {
    sizeOf.set(item, await stat(item.path).then((info) => info.size, () => 0))
  }
  run.plannedBytes = [...sizeOf.values()].reduce((sum, size) => sum + size, 0)
  run.doneBytes = 0
  run.inflight = {}
  const chunks = []
  for (let index = 0; index < items.length; index += maxFiles) chunks.push(items.slice(index, index + maxFiles))
  run.chunks = Math.max(1, chunks.length)
  if (chunks.length > 1) {
    run.warnings.push(`输入共有 ${items.length} 个文本类文件，已自动分为 ${chunks.length} 组（每组最多 ${maxFiles} 个）依次处理，共用同一映射库，跨组的标识符在最后统一复扫。`)
  }
  for (const failed of run.archiveErrors) {
    run.warnings.push(`有 1 个压缩包无法解压，未处理：${failed.error}`)
  }
  if (dicomItems.length > 0) {
    const settings = dicomPolicy(policy)
    run.totals.dicom = {
      files: 0, removed: 0, emptied: 0, privateRemoved: 0, uidsRemapped: 0,
      datesChanged: 0, patientIds: 0, textRemoved: 0, ageChanged: 0, modalities: {},
    }
    run.config.dicom = settings
    run.warnings.push('DICOM 影像只处理元数据，不修改像素；若图像上直接印有姓名等文字（常见于超声、截图类影像），需另行处理。')
    run.warnings.push('DICOM 的 PatientID 已替换为本批次内一致的随机编号，密钥不保存、无法回查；同一病人的影像请放在同一批处理，否则会得到不同编号。')
  }
  if (run.skipped.unsupported > 0) {
    const kinds = Object.entries(run.skipped.unsupportedByExt).map(([ext, count]) => `${ext}×${count}`).join('、')
    run.warnings.push(`跳过 ${run.skipped.unsupported} 个不支持的文件（${kinds}），它们未被匿名化，也不会出现在输出目录中。`)
  }
  const keptTypes = IDENTIFIERS.filter((item) => policy.identifiers[item.type] === 'keep').map((item) => item.type)
  if (keptTypes.length > 0) {
    run.warnings.push(`按配置保留未处理的标识符：${keptTypes.join('、')}。这些信息会原样出现在输出中。`)
  }
  const maskedTypes = IDENTIFIERS.filter((item) => policy.identifiers[item.type] === 'mask').map((item) => item.type)
  if (maskedTypes.length > 0) {
    run.warnings.push(`以下标识符使用部分遮盖，会保留一部分原值，仍可能被识别：${maskedTypes.join('、')}。`)
  }
  if (policy.quasiEnabled) {
    run.warnings.push('准标识符只处理文本值；Excel 的数值/日期单元格和 JSON 的数字值（如数字型年龄）不会被改动。')
  }
  if (policy.skipFields.length > 0) {
    run.warnings.push(`按配置不处理的字段：${policy.skipFields.join('、')}。这些字段的值原样输出。`)
  }
  if ((policy.forceValues ?? []).length > 0) {
    run.warnings.push(`按配置有 ${policy.forceValues.length} 个值总是替换（"总是替换的值"）。`)
  }
  if (policy.allowValues.length > 0) {
    run.warnings.push(`按配置有 ${policy.allowValues.length} 个值不当作标识符（"不匹配的值"）。`)
    // Earlier runs may have stored these as identifiers; drop those mappings
    // so the vault no longer pairs a non-identifier with a pseudonym.
    const allowSet = new Set(policy.allowValues.map(normalizeAllow))
    const removed = vault.forget((entry) => allowSet.has(normalizeAllow(entry.original)))
    if (removed > 0) run.warnings.push(`已从映射库移除 ${removed} 条"不匹配的值"的映射。`)
  }
  const filePolicy = {
    ...policy,
    allowValues: new Set(policy.allowValues.map(normalizeAllow)),
    skipFields: new Set(policy.skipFields.map((field) => field.toLowerCase())),
  }
  // Same offset for every batch sharing this output root, so intervals between
  // dates stay comparable across batches. Never written to the report.
  const shiftDays = dateShiftDays(vault.salt)

  // Started here, where every exit path reaches the clearInterval below.
  memoryTimer = setInterval(sampleMemory, 2000)
  memoryTimer.unref?.()
  // Inference-server load (vLLM /metrics) next to the plugin's own counts:
  // only the server knows whether more concurrency would still help.
  const serverProbes = [
    ['detect', baseLlm],
    ...(baseVerifyLlm ? [['verify', baseVerifyLlm]] : []),
  ].filter(([, model]) => model?.baseURL && options.serverMetrics !== false)
    .map(([key, model]) => createServerProbe(run, key, model.baseURL, model.model))
  const serverTimer = serverProbes.length ? setInterval(() => { for (const probe of serverProbes) probe() }, SERVER_SAMPLE_MS) : null
  serverTimer?.unref?.()
  for (const probe of serverProbes) probe()
  const tuners = autoConcurrency
    ? [['detect', detectLimiter], ...(verifyLimiter ? [['verify', verifyLimiter]] : [])]
      .map(([key, limiter]) => createConcurrencyTuner({ run, key, limiter, stats: requestStats[key], windowMs: options.autoTuneMs ?? 30000 }))
    : []
  const tuneTimer = tuners.length ? setInterval(() => { for (const tick of tuners) tick() }, Math.min(2000, Math.max(50, Math.round((options.autoTuneMs ?? 30000) / 10)))) : null
  tuneTimer?.unref?.()
  // Per-run secret for DICOM patient codes (header and names); memory only.
  const runKey = randomBytes(32)
  try {
    run.current = { file: '', round: 0, step: '批次预扫', modelCalls: 0 }
    emit('progress')
    // Seeded over every chunk: names in labelled columns of a later chunk are
    // known before the first file is processed.
    const batchKnown = items.length > 1
      ? await seedBatchKnown(items, filePolicy, maxFileBytes, signal)
      : new Map()
    // Reviewer-added values ("总是替换"): replaced wherever they occur, with
    // no format or plausibility check.
    for (const { type, text } of policy.forceValues ?? []) {
      if (filePolicy.allowValues.has(normalizeAllow(text))) continue
      batchKnown.set(`${type}|${text}`, { type, text, forced: true })
    }
    checkAbort()

    // DICOM headers name what PACS exports put in file and folder names
    // (SOP/Study UIDs, PATIENT^NAME, patient ID): read them first, so those
    // names get the header's remapped UIDs and patient codes.
    const dicomNames = { uids: new Map(), values: new Map() }
    if (dicomItems.length > 0) {
      run.current = { file: '', round: 0, step: 'DICOM 文件名预扫', modelCalls: 0 }
      emit('progress')
      for (const item of dicomItems) {
        checkAbort()
        const found = await dicomPathIdentifiers(item.path, { salt: vault.salt, runKey })
        for (const [uid, mapped] of found.uids) dicomNames.uids.set(uid, mapped)
        // Slices of one study repeat the same values: keep one of each.
        for (const entry of found.values) {
          const key = `${entry.type}|${entry.text.toLowerCase()}|${entry.part ? 'part' : ''}`
          if (!dicomNames.values.has(key)) dicomNames.values.set(key, entry)
        }
      }
    }

    // Output paths are decided before any file is written, so every file of
    // one patient folder lands in the same anonymized folder. They are
    // decided again once every file's content is done (see below): values
    // found only then are applied to file and folder names too.
    const allLogical = [...new Set([
      ...[...items, ...dicomItems].map((item) => item.relPath),
      ...staged.archives.map((archive) => archive.logical),
    ])].sort()
    // The input's own name ("64_姓名_身份证号.zip", "patient_573453") is shown
    // anonymized in reports and run lists as well.
    const inputName = basename(resolve(inputDir))
    let mapWarning = -1
    const mapPaths = async () => {
      const mapper = createPathAnonymizer({
        vault,
        policy,
        known: [...pathKnown(batchKnown, run.files), ...dicomNames.values.values()],
        uids: { known: dicomNames.uids, remap: (uid) => remapUid(uid, vault.salt) },
      })
      const mapped = new Map()
      for (const logical of allLogical) mapped.set(logical, mapper.map(logical))
      unzipOutputNames(mapped, new Set(staged.archives.map((archive) => archive.logical)))
      const shownName = mapped.get(inputName) ?? mapper.map(inputName)
      if (selection) run.selection = selection.map((name) => mapped.get(name) ?? mapper.map(name))
      // Multi-select: inputDir is the chosen entries' folder, shown the same way.
      run.inputDir = shownName !== inputName ? join(dirname(resolve(inputDir)), shownName) : inputDir
      deliverName = shownName
      run.paths.renamed = mapper.prefixes().length
      if (mapper.entries().length > 0) {
        // Original ↔ anonymized paths: as sensitive as the vault, never in the
        // report; kept in the records (run_docs 'path-map').
        run.paths.map = 'records'
        await (await records()).putDoc(runId, 'path-map', { runId, prefixes: mapper.prefixes(), files: mapper.entries() })
        const warning = `有 ${run.paths.renamed} 个文件名或目录名含标识符，已在输出中替换；原路径对照保存在 ${RECORDS_DIR}/records.sqlite，与映射库同样敏感。`
        if (mapWarning >= 0) run.warnings[mapWarning] = warning
        else mapWarning = run.warnings.push(warning) - 1
      }
      return mapped
    }
    let outPath = await mapPaths()
    for (const item of [...items, ...dicomItems]) item.outRel = outPath.get(item.relPath)

    // Model answers shared by every file of this batch (memory only).
    const memo = baseLlm ? createModelMemo() : null

    // Per-file results go to the records as files finish, so a resume of
    // this batch takes over every file that was done and whose source is
    // unchanged, instead of running it again (model replies alone would
    // still re-read and re-check every file). Same settings and plugin
    // version only; the model may differ (see resumeModel).
    const configKey = createHash('sha256').update(JSON.stringify({ policy, maxRounds, maxFileBytes, version: await pluginVersion() })).digest('hex').slice(0, 16)
    const printCache = new Map()
    const printOf = async (item) => {
      if (!printCache.has(item)) {
        // Extracted archive entries get a fresh mtime every time: hash them.
        printCache.set(item, sourcePrints.get(item.path) ?? await readFile(item.path).then((bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`, () => 'missing'))
      }
      return printCache.get(item)
    }
    const sourceOf = new Map() // result → item
    const saveCheckpoint = async (item, result) => {
      if (!result || result.status === 'failed' || result.status === 'cancelled') return
      try {
        await (await records()).putFileResult(runId, {
          relPath: item.relPath,
          outRel: result.relPath,
          print: await printOf(item),
          config: configKey,
          status: result.status,
          data: {
            file: result,
            found: result.found ?? [],
            overMatchValues: result.overMatchValues ?? null,
            shownFields: result.shownFields ?? null,
            reviews: (result.issues ?? []).map((issue) => issue.review ?? null),
            cross: (run.crossCheck ?? []).filter((entry) => entry.file === result.relPath),
          },
        })
      } catch { /* a resume then simply runs this file again */ }
    }
    const previousResults = options.resumeFrom
      ? await (await records()).getFileResults(options.resumeFrom).catch(() => new Map())
      : null
    const previousOutput = options.resumeFrom ? join(paths.runDir(options.resumeFrom), 'output') : null
    /** The earlier run's result of this file, when it can be taken over as is. */
    const reuseFile = async (item) => {
      const row = previousResults?.get(item.relPath)
      if (!row || row.config !== configKey || row.status === 'failed' || row.status === 'cancelled') return null
      if (row.print !== await printOf(item)) return null
      const from = resolve(previousOutput, row.outRel)
      if (!from.startsWith(resolve(previousOutput) + sep) || !(await stat(from).then((info) => info.isFile(), () => false))) return null
      const to = resolve(outputDir, item.outRel)
      if (!to.startsWith(resolve(outputDir) + sep)) return null
      try {
        await guard.check(to)
        await mkdir(dirname(to), { recursive: true })
        await cp(from, to)
        const { data } = row
        const result = { ...data.file, relPath: item.outRel, reused: true }
        result.issues = (data.file.issues ?? []).map((issue, at) => {
          const copy = { ...issue }
          if (data.reviews?.[at]) Object.defineProperty(copy, 'review', { value: data.reviews[at], enumerable: false })
          return copy
        })
        Object.defineProperty(result, 'found', { value: data.found ?? [], enumerable: false })
        if (data.overMatchValues) Object.defineProperty(result, 'overMatchValues', { value: data.overMatchValues, enumerable: false })
        if (data.shownFields) Object.defineProperty(result, 'shownFields', { value: data.shownFields, enumerable: false })
        Object.defineProperty(result, 'doc', { value: layered(await loadDocument(to, item.outRel)), enumerable: false, writable: true })
        // The file's cross-check entries come along (review history, totals).
        if (data.cross?.length) {
          if (!run.crossCheck) Object.defineProperty(run, 'crossCheck', { value: [], enumerable: false, writable: true })
          const blind = blindTotals(run)
          for (const entry of data.cross) {
            if (run.crossCheck.length >= CROSS_LIMIT) break
            run.crossCheck.push({ ...entry, n: run.crossCheck.length + 1, file: item.outRel, reused: true })
            if (['confirmed', 'dismissed', 'disputed', 'unjudged'].includes(entry.outcome)) { blind[entry.outcome] += 1; blind.reported += 1 }
            else if (entry.outcome === 'unlocated') blind.unlocated += 1
          }
        }
        run.totals.reusedFiles = (run.totals.reusedFiles ?? 0) + 1
        return result
      } catch {
        await rm(to, { force: true }).catch(() => {})
        return null
      }
    }
    // Field profiles shared by files of the same shape (same set of fields).
    const profiles = baseLlm ? new Map() : null
    const processOne = async (item) => {
      checkAbort()
      emit('file-start')
      run.current = { file: item.outRel, round: 0, step: '读取', modelCalls: llmStats.calls }
      run.inflight[item.outRel] = { ...run.current, bytes: sizeOf.get(item) ?? 0, fraction: 0.02 }
      emit('progress')
      const reused = previousResults ? await reuseFile(item) : null
      const result = reused ?? await processFile({
        path: item.path, relPath: item.outRel, run, vault, llm, verifyLlm, llmStats, maxRounds, maxFileBytes, outputDir, signal,
        policy: filePolicy, shiftDays, batchKnown, guard, memo, profiles,
        progress: (state) => {
          run.current = state
          const previous = run.inflight[item.outRel]
          run.inflight[item.outRel] = { ...state, bytes: sizeOf.get(item) ?? 0, fraction: Math.max(previous?.fraction ?? 0, state?.fraction ?? 0) }
          emit('progress')
        },
      })
      delete run.inflight[item.outRel]
      run.doneBytes += sizeOf.get(item) ?? 0
      result.doneMs = Date.now() - started // for the page's throughput chart
      run.files.push(result)
      for (const found of result.found ?? []) addKnown(batchKnown, found.type, found.text, filePolicy)
      for (const [type, count] of Object.entries(result.quasi ?? {})) {
        run.totals.quasi[type] = (run.totals.quasi[type] ?? 0) + count
      }
      run.totals.files += 1
      if (result.status === 'failed') run.totals.filesFailed += 1
      if (result.status === 'review') run.totals.filesReview += 1
      run.totals.entities += result.entities.reduce((sum, entity) => sum + entity.count, 0)
      for (const entity of result.entities) {
        run.totals.byType[entity.type] = (run.totals.byType[entity.type] ?? 0) + entity.count
      }
      run.totals.unresolved += result.issues.filter((issue) => issue.severity === 'error').length
      await vault.save()
      run.totals.newMappings = vault.countRun(runId)
      run.totals.distinctIds = vault.countUsed()
      sourceOf.set(result, item)
      await saveCheckpoint(item, result)
      emit('file-done')
      return result
    }

    // Chunks overlap: the next chunk's files start while the previous chunk's
    // last (large) files are still running, and a finished chunk's re-check
    // runs alongside, so the model is not left idle at every chunk boundary.
    // Documents of at most two chunks are held: a file of chunk i waits until
    // chunk i-2 has been re-checked and released. Within a chunk the largest
    // files start first, so no single big file is left running alone at the
    // end.
    const chunkFiles = chunks.map(() => [])
    const remaining = chunks.map((chunk) => chunk.length)
    const released = chunks.map(() => {
      let resolve
      const promise = new Promise((done) => { resolve = done })
      return { promise, resolve }
    })
    const rechecks = []
    let recheckChain = Promise.resolve()
    // Size of the batch dictionary each chunk was re-checked against. It only
    // grows, so a chunk checked at a smaller size missed values found later
    // (by a later chunk, or by a slow file of an earlier one).
    const checkedAt = chunks.map(() => -1)
    const finishChunk = (index) => {
      const task = recheckChain.then(async () => {
        const results = chunkFiles[index]
        if (items.length > 1) {
          checkAbort()
          run.current = { file: '', round: 0, step: chunks.length > 1 ? `批次复扫（第 ${index + 1}/${chunks.length} 组）` : '批次复扫', modelCalls: llmStats.calls }
          emit('progress')
          checkedAt[index] = batchKnown.size
          await recheckBatch({ run, files: results, batchKnown, vault, outputDir, policy: filePolicy, guard })
          await vault.save()
          for (const file of results) await saveCheckpoint(sourceOf.get(file), file)
        }
        for (const file of results) if (file.doc) file.doc = null
      })
      recheckChain = task.catch(() => {})
      task.finally(() => released[index].resolve()).catch(() => {})
      rechecks.push(task)
    }
    const ordered = chunks.flatMap((chunk, index) => [...chunk]
      .sort((a, b) => (sizeOf.get(b) ?? 0) - (sizeOf.get(a) ?? 0))
      .map((item) => ({ item, chunk: index })))
    try {
      await pool(ordered, fileSlots, async ({ item, chunk }) => {
        try {
          if (chunk >= 2) await released[chunk - 2].promise
          checkAbort()
          // Start extra files only while memory allows; the first
          // `concurrency` files always run.
          while (activeFiles >= concurrency && memoryTight()) {
            if (signal?.aborted) break
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
          activeFiles += 1
          try {
            chunkFiles[chunk].push(await processOne(item))
          } finally {
            activeFiles -= 1
          }
        } finally {
          remaining[chunk] -= 1
          if (remaining[chunk] === 0) finishChunk(chunk)
        }
      })
    } finally {
      // Settle every started re-check before leaving (errors surface below).
      await Promise.allSettled(rechecks)
    }
    await Promise.all(rechecks)
    // Cross-chunk pass: identifiers found after a chunk was re-checked (in a
    // later chunk, or by a slow file of an earlier chunk that finished after
    // this one, the last chunk included), applied to that chunk's
    // already-written outputs (reloaded one chunk at a time).
    const stale = items.length > 1 ? chunkFiles.map((_, index) => index).filter((index) => checkedAt[index] < batchKnown.size) : []
    for (const [n, index] of stale.entries()) {
      const results = chunkFiles[index]
      checkAbort()
      run.current = { file: '', round: 0, step: `跨组复扫（第 ${n + 1}/${stale.length} 组）`, modelCalls: llmStats.calls }
      emit('progress')
      for (const file of results) {
        if (file.status === 'failed' || file.status === 'cancelled') continue
        try {
          file.doc = layered(await loadDocument(join(outputDir, file.relPath), file.relPath))
        } catch {
          // Its output cannot be checked against the later values: a person must.
          file.issues.push({ severity: 'error', code: 'batch-recheck', detail: '跨组复扫时无法重新读取已写出的结果，未能补查其他文件识别到的标识符' })
          run.totals.unresolved += 1
          if (file.status === 'clean') {
            file.status = 'review'
            run.totals.filesReview += 1
          }
        }
      }
      await recheckBatch({ run, files: results, batchKnown, vault, outputDir, policy: filePolicy, guard })
      for (const file of results) await saveCheckpoint(sourceOf.get(file), file)
      for (const file of results) if (file.doc) file.doc = null
      await vault.save()
    }

    // Identifiers found in the contents are applied to file and folder names
    // as well: names are decided again with everything the batch found, and
    // outputs written under an earlier name are moved.
    {
      const next = await mapPaths()
      await moveOutputs({ run, items, next, outputDir, runDir, guard })
      // Outputs may have moved: the records say where each one is now.
      for (const [result, item] of sourceOf) await saveCheckpoint(item, result)
      outPath = next
      for (const item of dicomItems) item.outRel = next.get(item.relPath)
    }
    // Report-bound text of every file, against everything the batch found.
    const reportScrub = knownScrubber([...pathKnown(batchKnown, run.files)].map((item) => [item.text, maskForReport(item.text)]))
    for (const file of run.files) scrubFileText(run, file, reportScrub)

    // DICOM: metadata only, no model. The salt keeps UIDs stable for this
    // output root; the run key (patient codes) exists only in memory.
    if (dicomItems.length > 0) await vault.save() // persist the salt UIDs depend on
    for (const item of dicomItems) {
      checkAbort()
      emit('file-start')
      run.current = { file: item.outRel, round: 0, step: 'DICOM', modelCalls: llmStats.calls }
      const result = await processDicomFile({
        path: item.path, relPath: item.outRel, outputDir, salt: vault.salt, runKey, shiftDays, policy, guard,
      })
      if (result.status === 'skipped') {
        run.skipped.dicomdir += 1
        run.warnings.push(`${item.outRel}：${result.issues[0]?.detail ?? '已跳过'}`)
        emit('file-done')
        continue
      }
      result.doneMs = Date.now() - started // for the page's throughput chart
      run.files.push(result)
      run.totals.files += 1
      run.doneBytes += sizeOf.get(item) ?? 0
      const totals = run.totals.dicom
      totals.files += 1
      for (const key of ['removed', 'emptied', 'privateRemoved', 'uidsRemapped', 'datesChanged', 'patientIds', 'textRemoved', 'ageChanged']) {
        totals[key] += result.dicom?.[key] ?? 0
      }
      if (result.dicom?.modality) totals.modalities[result.dicom.modality] = (totals.modalities[result.dicom.modality] ?? 0) + 1
      if (result.status === 'failed') run.totals.filesFailed += 1
      if (result.status === 'review') run.totals.filesReview += 1
      run.totals.unresolved += result.issues.filter((issue) => issue.severity === 'error').length
      emit('file-done')
    }

    // Files that still need review get a loose copy under _records, so they
    // can be opened without unpacking the delivered zip or digging through
    // the result folder. Taken before re-packing, when every file is loose.
    const toReview = run.files.filter((file) => (file.issues ?? []).some((issue) => issue.severity === 'error'))
    const batchItems = []
    if (run.skipped.zipFailed > 0) batchItems.push({ id: '(批次)#zip', code: 'zip-failed', detail: `${run.skipped.zipFailed} 个压缩包无法解压，未处理，也不会出现在交付数据中` })
    if (run.skipped.overLimit > 0) batchItems.push({ id: '(批次)#over', code: 'over-limit', detail: `${run.skipped.overLimit} 个 DICOM 文件超过单批上限，未处理，也不会出现在交付数据中` })
    if (toReview.length > 0 || batchItems.length > 0) {
      const reviewDir = join(runDir, 'review')
      let copied = 0
      for (const file of toReview) {
        const from = join(outputDir, file.relPath)
        // A folder named "x.zip" looks like an archive in Finder; name it "x (zip)".
        const loose = file.relPath.split('/').map((part, index, all) => (index < all.length - 1 && isZipPath(part) ? `${part.replace(/\.zip$/i, '')} (zip)` : part)).join('/')
        const to = join(reviewDir, loose)
        if (!(await stat(from).then((info) => info.isFile(), () => false))) continue
        await guard.check(to)
        await mkdir(dirname(to), { recursive: true })
        await cp(from, to)
        file.reviewCopy = posix(relative(outputRoot, to))
        copied += 1
      }
      if (copied > 0) run.review = { dir: reviewDir, files: copied }
      // Items for the page's review tab (original text included: 0600).
      const reviewItems = [...(batchItems.length ? [{ relPath: '(批次)', reviewCopy: null, batch: true, items: batchItems }] : []), ...toReview.map((file) => ({
        relPath: file.relPath,
        reviewCopy: file.reviewCopy ?? null,
        items: file.issues.filter((issue) => issue.severity === 'error').map((issue, index) => ({
          id: `${file.relPath}#${index}`, code: issue.code, type: issue.type ?? null, detail: issue.detail, ...(issue.review ?? {}),
        })),
      }))]
      await (await records()).putReviewFiles(runId, reviewItems)
    }

    // Side-by-side comparison for the page: every changed segment, original
    // vs. result, per file. Built while sources (archives too) and outputs
    // are still loose; holds original text, so 0600 under the run records.
    checkAbort()
    run.current = { file: '', round: 0, step: '比对记录', modelCalls: llmStats.calls }
    emit('progress')
    await writeCompare({ items, results: run.files, outputDir, store: await records(), runId })

    // Archives are delivered unpacked: each one is a plain folder named
    // after the zip (see unzipOutputNames), so nothing is re-packed.
    for (const archive of staged.archives) {
      run.archives.push({ relPath: outPath.get(archive.logical), files: archive.files, entries: archive.files })
    }
    // A file interrupted by Stop returns normally as "cancelled"; make sure
    // such a batch never ends as completed (or gets delivered).
    checkAbort()
    if (run.files.some((file) => file.status === 'cancelled')) {
      const error = new Error('已取消')
      error.code = 'cancelled'
      throw error
    }
    run.files.sort((a, b) => a.relPath.localeCompare(b.relPath))
    const coverage = { total: 0, inspected: 0, decoded: 0, opaque: 0, opaqueBytes: 0, tokens: 0, files: 0 }
    for (const file of run.files) {
      if (!file.coverage) continue
      coverage.files += 1
      for (const key of ['total', 'inspected', 'decoded', 'opaque', 'opaqueBytes', 'tokens']) coverage[key] += file.coverage[key] ?? 0
    }
    run.totals.coverage = coverage
    if (run.totals.unresolved > 0 || run.skipped.overLimit > 0 || run.skipped.zipFailed > 0) run.status = 'review'
    else run.status = run.totals.filesFailed > 0 ? 'failed' : 'completed'
  } catch (error) {
    if (error.code === 'cancelled' || signal?.aborted) {
      run.status = 'cancelled'
    } else {
      run.status = 'failed'
      run.error = describeError(error)
    }
  } finally {
    if (stageRoot) await rm(stageRoot, { recursive: true, force: true }).catch(() => {})
  }

  // Source protection: every input file must be byte-for-byte where it was.
  const changed = await changedSince(sourcePrints)
  run.sourceCheck = { files: sourcePrints.size, changed: changed.length }
  if (changed.length > 0) {
    run.warnings.push(`源文件检查：有 ${changed.length} 个输入文件在运行期间发生变化（插件不写输入目录，可能是其他程序修改）。请核对源数据。`)
    if (run.status === 'completed') run.status = 'review'
  }

  // Deliver only what is fully done. A batch with unresolved review items is
  // withheld in its staging folder (already re-packed, ready to go) and
  // released into the output root once every item has been decided.
  run.output = null
  run.outputKind = selection ? 'multi' : inputIsFile ? 'file' : 'dir'
  run.deliverName = deliverName
  if (run.status === 'completed') {
    try {
      const delivered = await deliverStaged({ outputRoot, outputDir, kind: run.outputKind, deliverName, guard })
      run.output = delivered[0] ?? null
      if (delivered.length > 1) run.outputs = delivered
    } catch (error) {
      run.warnings.push(`交付数据移出失败，结果仍在 ${RECORDS_DIR}/runs/${runId}/output：${describeError(error)}`)
    }
  } else if (run.status === 'review') {
    run.withheld = true
    run.warnings.push(`存在待复核项，交付数据暂扣在 ${RECORDS_DIR}/runs/${runId}/output，未放到输出根目录；在「结果比对」中处理完全部复核项后自动交付。`)
  } else if ((await dirEntries(outputDir)).length > 0) {
    run.warnings.push(`批次未完成，部分结果保留在 ${RECORDS_DIR}/runs/${runId}/output，未放到输出根目录。`)
  }

  clearInterval(memoryTimer)
  if (serverTimer) clearInterval(serverTimer)
  if (tuneTimer) clearInterval(tuneTimer)
  sampleMemory()
  run.current = null
  run.inflight = {}
  run.finishedAt = new Date().toISOString()
  run.totals.modelCalls = llmStats.calls
  run.totals.tokens = llmStats.tokens
  run.totals.newMappings = vault.countRun(runId)
  run.totals.distinctIds = vault.countUsed()
  run.durationMs = Date.now() - started
  run.vaultPath = vault.path

  // Advice: setting suggestions + value-free improvement draft. The full
  // advice (allow-list candidates carry original values) stays in a 0600
  // file beside the vault-grade records; the report gets a summary only.
  run.advice = null
  try {
    const advice = advise(run, {
      maxRounds, concurrency, maxFiles,
      timeoutMs: Number(options.timeoutMs ?? 120000),
      disableThinking: options.disableThinking === true,
      modelConfigured: Boolean(llm),
      skipFields: policy.skipFields, allowValues: policy.allowValues,
      version: await pluginVersion(),
    })
    if (advice.suggestions.length > 0 || advice.draft) {
      await (await records()).putDoc(runId, 'advice', { runId, ...advice })
      run.advice = {
        suggestions: advice.suggestions.map((item) => ({ id: item.id, level: item.level, title: item.title })),
        findings: advice.findings.length,
      }
    }
  } catch (error) {
    run.warnings.push(`改进建议生成失败：${describeError(error)}`)
  }

  await vault.save()
  await mkdir(runDir, { recursive: true })
  await replay.flush()
  if (options.resumeFrom) {
    run.resumedFrom = options.resumeFrom
    if (options.resumeModel !== undefined) run.resumedFromModel = options.resumeModel
  }
  ended = true
  for (const timer of life.timers) clearInterval(timer)
  // Opened again: the plugin may have been unloaded (store closed) meanwhile.
  const store = await records()
  if (run.status === 'completed' || run.status === 'review') {
    // Finished: replies and per-file results are no longer needed (they
    // quote originals), nor is the resume data.
    await store.purgeRun(runId)
    await store.deleteDoc(runId, 'resume')
    run.resumable = false
  } else {
    // Cancelled/failed: keep them, so the batch can be continued.
    run.resumable = true
  }
  await store.deleteDoc(runId, 'live')
  if (run.callLog?.length) await store.putCalls(runId, run.callLog)
  if (run.crossCheck?.length) await store.putCrossCheck(runId, run.crossCheck)
  await store.putRunDetail(run)
  // Exports for people and other tools; the records are the source.
  await writeFile(join(runDir, 'report.json'), JSON.stringify(run, null, 2), { mode: 0o600 })
  await writeFile(join(runDir, 'report.md'), renderMarkdown(run), { mode: 0o600 })
  await store.putRun(runSummary(run))
  emit('done')
  return run
}

/** Every 10 s a running batch says it is alive (see service.js, interrupted batches). */
const HEARTBEAT_MS = 10_000

/** A running batch without its per-file detail: shown if the batch is cut off. */
export function liveSnapshot(run) {
  const { files, loadSeries, inflight, current, ...rest } = run
  return JSON.parse(JSON.stringify({ ...rest, filesDone: files?.length ?? 0 }))
}

async function processFile(context) {
  const {
    path, relPath, run, vault, llm, verifyLlm = null, llmStats, maxRounds, maxFileBytes, outputDir, signal, policy, shiftDays,
    guard: writeGuard, batchKnown = null, memo = null, profiles = null, progress = () => {},
  } = context
  const strategyOf = (type) => policy?.identifiers?.[type] ?? 'pseudonym'
  const kept = (type) => strategyOf(type) === 'keep'
  // Non-pseudonym outputs (masks, placeholders) produced in this file; they
  // must never be detected and replaced again.
  const produced = new Set()
  // Pseudonyms this vault issued: "病历-123456" is protected only when it is one.
  const issued = issuedBy(vault)
  const guard = (text, start, end) => insideProtected(text, start, end, produced, issued)
  const protectedText = (text) => isPseudonym(text, issued) || isProtectedText(text, produced)
  // User allowlist: values that are never identifiers, fields never touched.
  const allowValues = policy?.allowValues ?? new Set()
  const skipFields = policy?.skipFields ?? new Set()
  const allowed = (text) => allowValues.size > 0 && allowValues.has(normalizeAllow(text))
  const skippedField = (segment) => skipFields.size > 0 && fieldSkipped(segment.field, skipFields)
  const started = Date.now()
  const file = {
    relPath,
    kind: detectKind(path) ?? 'unknown',
    bytes: 0,
    status: 'running',
    rounds: 0,
    durationMs: 0,
    entities: [],
    issues: [],
    structure: { ok: true, checks: [] },
    modelCalls: 0,
  }
  let doc
  try {
    const info = await stat(path)
    file.bytes = info.size
    if (info.size > maxFileBytes) throw new Error(`文件超过 ${Math.round(maxFileBytes / 1024 / 1024)} MB 上限`)
    doc = layered(await loadDocument(path, relPath))
    file.bytes = doc.bytes
  } catch (error) {
    file.status = 'failed'
    file.issues.push({ severity: 'error', code: 'load', detail: describeError(error) })
    file.durationMs = Date.now() - started
    return file
  }

  const structured = doc.kind !== 'text'
  // Column profiles (structured files): field → { category, type }.
  const fieldProfile = new Map()
  const withProfile = (segment) => {
    if (segment.hint) return segment
    const profile = fieldProfile.get(segment.field ?? '')
    if (profile?.category === 'identifier' && profile.type) return { ...segment, hint: profile.type, hintFrom: 'profile' }
    return segment
  }
  const vocabField = (segment) => {
    const category = fieldProfile.get(segment.field ?? '')?.category
    return category === 'vocabulary' || category === 'code'
  }
  const segmentsOf = () => doc.segments().filter((segment) => !skippedField(segment)).map(withEffectiveHint).map(withProfile)
  const initial = doc.segments()
  const originalTexts = new Map(initial.map((segment) => [segment.id, segment.text]))
  const fieldOf = new Map(initial.map((segment) => [segment.id, segment.field ?? null]))
  const skippedCount = initial.length - segmentsOf().length
  const fieldsLabel = (ids) => describeFields([...ids].map((id) => fieldOf.get(id)))
  // Structured, value-free context for the advisor (lib/advisor.js).
  const fieldList = (ids) => [...new Set([...ids].map((id) => fieldOf.get(id) ?? '正文'))].slice(0, 20)
  // Manual-review context for an error: the exact text and its surroundings.
  // Non-enumerable, so it never reaches report.json; written only to the
  // 0600 review-items.json used by the page's review tab.
  const attach = (issue, text, segmentText, field, extra = {}) => {
    const body = String(segmentText ?? '')
    const at = Math.max(0, body.indexOf(text))
    const from = Math.max(0, at - 80)
    const to = Math.min(body.length, at + text.length + 80)
    Object.defineProperty(issue, 'review', {
      value: {
        text, field: field ?? '正文',
        before: `${from > 0 ? '…' : ''}${body.slice(from, at)}`,
        after: `${body.slice(at + text.length, to)}${to < body.length ? '…' : ''}`,
        ...extra,
      },
      enumerable: false,
    })
    return issue
  }

  const usedTypes = new Map() // "type|pseudonym" -> {type, pseudonym, count, sources:Set}
  const usedPseudonyms = new Set()
  // Pseudonyms standing for letter/digit codes: only these can corrupt a
  // longer code when glued to it (a hospital name right after a date cannot).
  const codePseudonyms = new Set()
  // original -> { pseudonym, ids, expandable } (absence check only, never serialized)
  const pendingOriginals = new Map()
  // Detections dropped by the format check: reported, never replaced.
  const rejected = new Map()
  const reject = (type, text, reason, source, id) => {
    const key = `${type}|${text}`
    const entry = rejected.get(key) ?? { type, text, reason, source, ids: new Set() }
    if (id) entry.ids.add(id)
    rejected.set(key, entry)
  }
  const overMatch = new Map()
  const hasLlm = Boolean(llm)
  // fraction: rough share of this file's work done (monotonic per file on
  // the run side). Round 1 detection 5–55 %, verification 55–95 %, later
  // rounds 95 %+.
  const fractionOf = (name, round, index = 0, count = 0) => {
    if (round > 1) return Math.min(0.99, 0.95 + 0.01 * (round - 1))
    const share = count > 0 ? index / count : 0
    if (name === '规则核验') return 0.55
    return name === '复核' ? 0.55 + 0.4 * share : 0.05 + 0.5 * share
  }
  // Run every batch concurrently; progress counts completed batches.
  const fanOut = async (name, round, batches, invoke) => {
    let done = 0
    step(name, round, 0, batches.length)
    return Promise.all(batches.map((batch, index) => Promise.resolve()
      .then(() => invoke(batch, index))
      .then((reply) => ({ reply }), (error) => ({ error }))
      .finally(() => { done += 1; step(name, round, done, batches.length) })))
  }
  const step = (name, round, index, count) => progress({ file: relPath, round, step: name, modelCalls: llmStats.calls, fraction: fractionOf(name, round, index, count) })
  const countCall = () => {
    llmStats.calls += 1
    file.modelCalls += 1
    run.totals.modelCalls = llmStats.calls
  }
  // One log entry per model call: metadata only (file, stage, timing,
  // tokens, outcome code). Prompts and replies hold patient text and are
  // never recorded; error messages are reduced to a code for the same reason.
  const verifier = verifyLlm ?? llm
  // Cross-check detail: one entry per blind-review finding, with context and
  // both models' reasons. Holds original text: kept off report.json and
  // written to the 0600 cross-check.json for the page only.
  const crossEntry = (round, segment, type, text, reason) => {
    if (!run.crossCheck) Object.defineProperty(run, 'crossCheck', { value: [], enumerable: false, writable: true })
    if (run.crossCheck.length >= CROSS_LIMIT) return null
    const body = String(segment?.text ?? '')
    const at = Math.max(0, body.indexOf(text))
    const from = Math.max(0, at - 60)
    const to = Math.min(body.length, at + text.length + 60)
    const entry = {
      n: run.crossCheck.length + 1, file: relPath, round, field: segment?.field ?? null, type, text,
      before: `${from > 0 ? '…' : ''}${body.slice(from, at)}`,
      after: `${body.slice(at + text.length, to)}${to < body.length ? '…' : ''}`,
      reason: String(reason ?? '').slice(0, 160), outcome: 'pending', judge: '',
    }
    run.crossCheck.push(entry)
    return entry
  }
  // Items of a reply that were discarded (malformed, unknown type, text not
  // in the segment): on the call's log entry and per stage in the totals.
  const dropItems = (entry, stage, count = 1) => {
    if (!count) return
    if (entry) entry.dropped = (entry.dropped ?? 0) + count
    const dropped = run.totals.dropped ??= {}
    dropped[stage] = (dropped[stage] ?? 0) + count
  }
  const timedCall = async (stage, round, size, invoke, model = null) => {
    // Timing starts when the request gets a slot, not while it queues.
    let started = Date.now()
    const counts = run.stageRequests[stage] ??= { queued: 0, active: 0 }
    counts.queued += 1
    let slotted = false
    const onSlot = () => {
      started = Date.now()
      entry.at = new Date(started).toISOString()
      slotted = true
      counts.queued -= 1
      counts.active += 1
      // A call counts once it is sent; queued or cancelled-in-queue do not.
      countCall()
    }
    const entry = { at: new Date(started).toISOString(), file: relPath, stage, round, segments: size, ms: 0, tokens: 0, result: 'ok', ...(model ? { model } : {}) }
    try {
      const reply = await invoke({ onSlot })
      if (reply && typeof reply === 'object') Object.defineProperty(reply, 'entry', { value: entry, enumerable: false, configurable: true })
      if (Number(reply?.attempts) > 1) entry.attempts = reply.attempts
      if (reply?.cached) {
        // Replayed from a resumed run's cache: no model call was made.
        entry.result = 'cached'
        run.totals.replayedCalls = (run.totals.replayedCalls ?? 0) + 1
        run.totals.replayedSegments = (run.totals.replayedSegments ?? 0) + (Number(size) || 0)
      } else {
        // Segments actually sent, comparable with replayed / memo-skipped ones.
        run.totals.sentSegments = (run.totals.sentSegments ?? 0) + (Number(size) || 0)
        entry.tokens = Number(reply?.usage?.total_tokens ?? 0)
        // Output tokens drive the generation-speed readout (tok/s).
        entry.out = Number(reply?.usage?.completion_tokens ?? 0) || 0
        entry.in = Number(reply?.usage?.prompt_tokens ?? 0) || 0
      }
      return reply
    } catch (error) {
      if (Number(error?.attempts) > 1) entry.attempts = error.attempts
      entry.result = signal?.aborted ? 'cancelled'
        : error?.code === 'aborted' ? 'timeout'
          : error?.code === 'bad-json' ? 'bad-json'
            : error?.code === 'bad-shape' ? 'bad-shape'
            : error?.code === 'http-error' ? `http-${error.status ?? 'error'}`
              : String(error?.code ?? 'error')
      throw error
    } finally {
      if (slotted) counts.active -= 1
      else counts.queued -= 1
      entry.ms = Date.now() - started
      recordCall(run, entry)
      // Speed fit covers the detection model only (a separate verifier differs).
      if (entry.result === 'ok' && entry.out > 0 && !entry.model) recordSpeed(run, entry)
      // Per model: calls, tokens, context size (input + output) and the
      // speed fit; the verifier has its own column when it is a separate model.
      if (entry.result !== 'cached') recordModel(run, entry.model ? 'verify' : 'detect', entry)
    }
  }
  // A batch whose reply is unreadable (usually cut off at max_tokens) or that
  // timed out is split in two and each half asked again, so a larger batch
  // never costs findings. `key` is the reply's list field. Timeouts are split
  // only for the first TIMEOUT_SPLITS timed-out requests of the file: a hung
  // or overloaded endpoint would otherwise be asked about twice per segment,
  // each request waiting the full timeout, before the file goes to review.
  let timeouts = 0
  const splitting = async (batch, call, key) => {
    try {
      return await call(batch)
    } catch (error) {
      const timedOut = (error?.code === 'timeout' || error?.code === 'aborted') && !signal?.aborted
      if (timedOut) timeouts += 1
      const retriable = error?.code === 'bad-json' || error?.code === 'bad-shape' || (timedOut && timeouts <= TIMEOUT_SPLITS)
      if (!retriable || batch.length < 2) throw error
      const middle = Math.ceil(batch.length / 2)
      const [first, second] = await Promise.all([
        splitting(batch.slice(0, middle), call, key),
        splitting(batch.slice(middle), call, key),
      ])
      const list = (reply) => (Array.isArray(reply?.json?.[key]) ? reply.json[key] : [])
      return {
        json: { [key]: [...list(first), ...list(second)] },
        usage: { total_tokens: (first.cached ? 0 : Number(first.usage?.total_tokens ?? 0)) + (second.cached ? 0 : Number(second.usage?.total_tokens ?? 0)) },
        cached: Boolean(first.cached && second.cached),
      }
    }
  }
  const memoHit = (key) => {
    const value = memo?.get(key)
    if (value !== undefined) run.totals.memoHits = (run.totals.memoHits ?? 0) + 1
    return value
  }
  // Residuals confirmed by the verification pass (exact text present in the
  // segment). They are replaced in the next round instead of only being
  // reported, which is what makes the repair loop converge.
  let carryOver = []
  // Verifier findings the detection model judged not to be identifiers.
  // Reported again by the verifier → the two disagree → manual review.
  const disputed = new Map()

  // Field profiling (structured files): decide once per column whether it
  // holds identifiers, a clinical vocabulary, codes or free text, instead of
  // asking the model about every value. Columns already known by name, with
  // few distinct values, or with long texts are not profiled.
  if (hasLlm && profiles && structured) {
    try {
      const shapeKey = createHash('sha1').update([...new Set(doc.segments().map((segment) => segment.field ?? ''))].sort().join('\u0000')).digest('base64')
      const byField = new Map()
      for (const segment of segmentsOf()) {
        if (segment.hint || !llmWorthy(segment.text, protectedText)) continue
        const field = segment.field ?? ''
        if (!field) continue
        const entry = byField.get(field) ?? { count: 0, values: new Set() }
        entry.count += 1
        if (entry.values.size < 5000) entry.values.add(segment.text.trim())
        byField.set(field, entry)
      }
      const pending = []
      for (const [field, entry] of byField) {
        const values = [...entry.values]
        if (values.length < 6) continue
        const avg = values.reduce((sum, value) => sum + value.length, 0) / values.length
        if (avg > 40 || Math.max(...values.map((value) => value.length)) > 200) continue
        const key = `${shapeKey}|${field}`
        const known = profiles.get(key)
        if (known) {
          if (known.category) fieldProfile.set(field, known)
          const summary = run.profileSummary ??= {}
          const entry = summary[field] ??= { field, category: known.category ?? 'uncertain', type: known.type, files: 0, distinct: 0 }
          entry.files += 1
          entry.distinct = Math.max(entry.distinct, values.length)
          continue
        }
        const step = Math.max(1, Math.floor(values.length / 10))
        const samples = values.filter((_, index) => index % step === 0).slice(0, 10).map((value) => value.slice(0, 60))
        pending.push({ key, field, info: { field, count: entry.count, distinct: values.length, avgLength: Math.round(avg), samples } })
      }
      for (let start = 0; start < pending.length; start += 15) {
        // On cancel, stop here: the round loop below marks the file cancelled.
        if (signal?.aborted) break
        const slice = pending.slice(start, start + 15)
        let reply = null
        try {
          step('画像', 1)
          reply = await timedCall('字段画像', 1, slice.length, (extra) => llm.chatJson(profilePrompt(slice.map((item) => item.info)), { signal, maxTokens: 2000, validate: SHAPES.fields, ...extra }))
          if (reply.usage?.total_tokens && !reply.cached) { llmStats.tokens += reply.usage.total_tokens; run.totals.tokens = llmStats.tokens; run.totals.tokensReported = true }
        } catch {
          if (signal?.aborted) break
          // A failed call leaves these columns unprofiled (value by value).
        }
        if (!reply) continue // failed: not cached, the next file of this shape asks again
        // Compact [field, category, type] triples; the object form is accepted too.
        const answers = new Map((Array.isArray(reply?.json?.fields) ? reply.json.fields : [])
          .map((item) => (Array.isArray(item) ? { field: item[0], category: item[1], type: item[2] } : item))
          .map((item) => [String(item?.field ?? ''), item]))
        for (const item of slice) {
          const answer = answers.get(item.field)
          let category = ['identifier', 'vocabulary', 'code', 'freetext'].includes(answer?.category) ? answer.category : null
          const type = category === 'identifier' && DETECT_TYPES.includes(answer?.type) && !kept(answer.type) ? answer.type : null
          if (category === 'identifier' && !type) category = null
          const profile = { category, type, reason: String(answer?.reason ?? '').slice(0, 80) }
          profiles.set(item.key, profile)
          if (category) fieldProfile.set(item.field, profile)
          const summary = run.profileSummary ??= {}
          const entry = summary[item.field] ??= { field: item.field, category: category ?? 'uncertain', type, files: 0, distinct: 0 }
          entry.files += 1
          entry.distinct = Math.max(entry.distinct, item.info.distinct)
        }
      }
      if (fieldProfile.size > 0) {
        file.profiles = Object.fromEntries([...fieldProfile].map(([field, profile]) => [field, profile.type ? `${profile.category}:${profile.type}` : profile.category]))
      }
    } catch (error) {
      file.issues.push({ severity: 'warn', code: 'profile', detail: `字段画像失败，按逐值方式处理：${describeError(error)}` })
    }
  }

  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      // Let the page, progress events and other files' requests run.
      await new Promise((done) => setImmediate(done))
      if (signal?.aborted) throw new Error('已取消')
      file.rounds = round
      step('发现', round)
      const detections = []
      const segments = segmentsOf()
      // 0. Header/key policy: a dedicated column is pseudonymized wholesale,
      // provided the value can be what the column says ("01" in an ID column
      // is a category code, not a card number).
      const hinted = new Set()
      for (const segment of segments) {
        if (!segment.hint || segment.text.trim().length === 0 || kept(segment.hint)) continue
        if (protectedText(segment.text) || allowed(segment.text)) continue
        // A sibling label (ITM_NM) or a column profile is weaker evidence
        // than a dedicated column name; a value that does not fit simply
        // goes through normal detection.
        const weak = segment.hintFrom === 'sibling' || segment.hintFrom === 'profile'
        const reason = plausible(segment.hint, segment.text, weak ? 'llm' : 'header')
        if (reason) {
          if (!weak) reject(segment.hint, segment.text.trim(), reason, 'header', segment.id)
          continue
        }
        hinted.add(segment.id)
        // Replace the value without its padding ("张三\t", " 13800138000 "),
        // so the same person gets the same pseudonym in every file.
        const span = trimmedSpan(segment.text)
        const value = segment.text.slice(span.start, span.end)
        detections.push({
          id: segment.id, type: headerType(segment.hint, value), text: value,
          start: span.start, end: span.end, source: 'header',
        })
      }
      // 0.5 Identifiers already known from other files of this batch: a
      // patient name found in PTT_NM elsewhere must not survive in SLF_NM here.
      // Indexed: known values × segments was the batch's hottest loop. Hits
      // are emitted in the same order as the plain double loop (known value,
      // then segment), so the first-wins span dedup below is unchanged.
      const knownList = [...(batchKnown?.values() ?? [])].filter((known) => !kept(known.type) && !allowed(known.text))
      if (knownList.length > 0) {
        const index = substringIndex(knownList.map((known) => known.text))
        const pairs = []
        segments.forEach((segment, segmentIndex) => {
          if (hinted.has(segment.id)) return
          for (const knownIndex of index.hits(segment.text)) pairs.push([knownIndex, segmentIndex])
        })
        pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1])
        for (const [knownIndex, segmentIndex] of pairs) {
          const known = knownList[knownIndex]
          const segment = segments[segmentIndex]
          for (const span of locate(segment.text, known.text, known.type, guard)) {
            if (!edgesOk(segment.text, span.start, span.end)) continue
            detections.push({ id: segment.id, type: known.type, text: known.text, ...span, source: 'batch' })
          }
        }
      }
      // 1. Rules always run on un-hinted segments; cheap and deterministic.
      for (const segment of segments) {
        if (hinted.has(segment.id)) continue
        for (const entity of scan(segment.text, { landline: policy?.landline, issued })) {
          if (kept(entity.type) || allowed(entity.text) || guard(segment.text, entity.start, entity.end)) continue
          detections.push({
            id: segment.id, type: entity.type, text: entity.text,
            start: entity.start, end: entity.end, source: 'rule',
          })
        }
      }
      // Residuals reported by the previous verification pass. The detection
      // model first rules on each (it may be a verifier false positive);
      // confirmed ones are located in the segments the verifier saw them in.
      // Without a verdict (no model, call failed) a finding is kept: when in
      // doubt, replace.
      if (hasLlm && carryOver.length > 0) {
        const verdicts = new Map()
        for (let start = 0; start < carryOver.length; start += 20) {
          if (signal?.aborted) throw new Error('已取消')
          const slice = carryOver.slice(start, start + 20)
          const candidates = slice.map((residual, index) => {
            const body = String(residual.context ?? '')
            const at = Math.max(0, body.indexOf(residual.text))
            return {
              i: start + index, text: residual.text, type: residual.type,
              ...(residual.field ? { field: residual.field } : {}),
              context: body.slice(Math.max(0, at - 80), at + residual.text.length + 80),
              ...(residual.reason ? { reviewer: residual.reason } : {}),
            }
          })
          try {
            step('复判', round)
            const reply = await timedCall('复判修正', round, slice.length, (extra) => llm.chatJson(adjudicatePrompt(candidates), { signal, maxTokens: 1500, validate: SHAPES.verdicts, ...extra }))
            if (reply.usage?.total_tokens && !reply.cached) { llmStats.tokens += reply.usage.total_tokens; run.totals.tokens = llmStats.tokens; run.totals.tokensReported = true }
            for (const verdict of reply.json?.verdicts ?? []) {
              const index = Number(verdict?.i)
              if (Number.isInteger(index) && typeof verdict?.identifier === 'boolean') verdicts.set(index, verdict)
            }
          } catch (error) {
            if (error?.code === 'aborted' || signal?.aborted) throw new Error('已取消')
          }
        }
        const blind = blindTotals(run)
        carryOver = carryOver.filter((residual, index) => {
          const verdict = verdicts.get(index)
          if (verdict && verdict.identifier === false) {
            disputed.set(`${residual.type}|${residual.text}`, { ...residual, reason: String(verdict.reason ?? '').slice(0, 120), escalated: false })
            blind.dismissed += 1
            if (residual.cross) { residual.cross.outcome = 'dismissed'; residual.cross.judge = String(verdict.reason ?? '').slice(0, 160) }
            return false
          }
          blind.confirmed += 1
          if (residual.cross) {
            residual.cross.outcome = 'confirmed'
            residual.cross.judge = verdict ? String(verdict.reason ?? '').slice(0, 160) : '复判未给结论，按标识符处理'
          }
          return true
        })
        step('发现', round)
      }
      for (const residual of carryOver) {
        for (const segment of segments.filter((item) => residual.ids.has(item.id))) {
          for (const span of locate(segment.text, residual.text, residual.type, guard)) {
            detections.push({ id: segment.id, type: residual.type, text: residual.text, ...span, source: 'verify' })
          }
        }
      }
      // 2. Model discovery, budgeted. Identical texts (a department name
      // repeated in every record) are sent once; pure numbers/dates and
      // already-anonymized values are not sent at all.
      const unlocated = []
      const parseErrors = []
      if (hasLlm) {
        // Vocabulary / code columns are not sent value by value: rules still
        // scan them and the blind review checks them as per-field lists.
        const groups = groupByText(segments.filter((segment) => !hinted.has(segment.id) && !vocabField(segment) && llmWorthy(segment.text, protectedText)))
        const groupOf = new Map(groups.map((group) => [group[0].id, group]))
        // Texts the model already answered for (another file of this batch,
        // or unchanged since the previous round) are not sent again.
        const answered = [] // { segment, entity }
        const fresh = []
        const detectKeys = new Map()
        for (const group of groups) {
          const segment = group[0]
          const key = memo?.key('d', segment.field, segment.text)
          const known = key ? memoHit(key) : undefined
          if (known) {
            for (const entity of known) answered.push({ segment, entity })
            continue
          }
          if (key) detectKeys.set(segment.id, key)
          fresh.push(segment)
        }
        const detectBatches = makeBatches(fresh)
        // All batches of the file go out at once; the model's request limiter
        // keeps it busy without overloading it. Replies are then read in order.
        const detectReplies = await fanOut('发现', round, detectBatches, (batch) => splitting(batch, (part) => {
          return timedCall(round > 1 ? '复判修正' : '识别·替换', round, part.length, (extra) => llm.chatJson(detectPrompt(part.map(forModel)), { signal, maxTokens: 4000, validate: SHAPES.detect, ...extra }))
            // Compact or object form → { entities: [{ segment, type, text }] }.
            .then((reply) => {
              const raw = Array.isArray(reply?.json?.e) ? reply.json.e : Array.isArray(reply?.json?.entities) ? reply.json.entities : []
              const entities = entitiesOf(reply?.json)
              const next = { ...reply, json: { entities } }
              Object.defineProperty(next, 'entry', { value: reply.entry, enumerable: false })
              // Malformed items (not a triple / object) are dropped and counted.
              if (raw.length > entities.length) dropItems(reply.entry, '识别·替换', raw.length - entities.length)
              return next
            })
        }, 'entities'))
        for (const [batchIndex, batch] of detectBatches.entries()) {
          if (signal?.aborted) throw new Error('已取消')
          try {
            const reply = settled(detectReplies[batchIndex])
            if (reply.usage?.total_tokens && !reply.cached) { llmStats.tokens += reply.usage.total_tokens; run.totals.tokens = llmStats.tokens; run.totals.tokensReported = true }
            const bySegment = new Map(batch.map((segment) => [segment.id, []]))
            for (const raw of Array.isArray(reply.json?.entities) ? reply.json.entities : []) {
              const list = bySegment.get(raw?.segment)
              if (!list) { dropItems(reply.entry, '识别·替换'); continue }
              const entity = { type: String(raw?.type ?? ''), text: String(raw?.text ?? '') }
              list.push(entity)
              answered.push({ segment: batch.find((item) => item.id === raw.segment), entity, entry: reply.entry })
            }
            if (memo && Array.isArray(reply.json?.entities)) {
              for (const segment of batch) {
                const key = detectKeys.get(segment.id)
                if (key) memo.set(key, bySegment.get(segment.id))
              }
            }
          } catch (error) {
            if (error?.code === 'aborted' || signal?.aborted) throw new Error('已取消')
            parseErrors.push(describeError(error))
          }
        }
        // Fresh replies and memo hits are applied the same way.
        for (const { segment, entity, entry: callEntry } of answered) {
          if (!isKnownType(entity?.type)) { dropItems(callEntry, '识别·替换'); continue }
          if (kept(entity.type)) continue
          const text = String(entity?.text ?? '').trim()
          if (!text || protectedText(text) || BARE_LABELS.has(text) || allowed(text)) continue
          const reason = plausible(entity.type, text, 'llm')
          if (reason) {
            reject(entity.type, text, reason, 'llm', segment.id)
            continue
          }
          const found = locate(segment.text, text, entity.type, guard)
          if (found.length === 0) {
            // In a later round the model sometimes reports a fragment of
            // a pseudonym ("294CD0" out of "证件-294CD0"): already handled.
            if (!echoesPseudonym(segment.text, text, issued)) {
              unlocated.push({ type: entity.type, text, segment: segment.id })
              dropItems(callEntry, '识别·替换')
            }
            continue
          }
          for (const twin of groupOf.get(segment.id) ?? [segment]) {
            for (const span of found) {
              detections.push({ id: twin.id, type: entity.type, text, ...span, source: 'llm' })
            }
          }
        }
      }
      // 2.5 Document-wide expansion: an identifier found once (header, rule or
      // model) is replaced everywhere it reappears — names and record numbers
      // are routinely repeated in prose, not only in the field that owns them.
      // Two limits keep this from corrupting unrelated values:
      //  - a match must not continue a longer run of letters/digits
      //    ("01" must never hit the middle of "2001017");
      //  - short codes (< 6 letters/digits) are not spread at all: "01" in
      //    "2023-01-05", or a bed number that equals a staff code, is a
      //    coincidence, not the same identifier.
      const originals = new Map()
      const directIds = new Map()
      for (const detection of detections) {
        const key = `${detection.type}|${detection.text}`
        if (!originals.has(key)) {
          originals.set(key, { type: detection.type, text: detection.text, source: detection.source })
          directIds.set(key, new Set())
        }
        directIds.get(key).add(detection.id)
      }
      carryOver = []
      // Indexed: each expandable original is searched only in the segments
      // that contain it (same order as scanning every segment).
      const spreading = [...originals].filter(([, item]) => expandable(item.text))
      const holders = spreading.map(() => [])
      if (spreading.length > 0) {
        const index = substringIndex(spreading.map(([, item]) => item.text))
        for (const segment of segments) for (const hit of index.hits(segment.text)) holders[hit].push(segment)
      }
      for (const [n, [key, item]] of spreading.entries()) {
        const hits = new Set()
        for (const segment of holders[n]) {
          let from = 0
          while (from <= segment.text.length - item.text.length) {
            const index = segment.text.indexOf(item.text, from)
            if (index < 0) break
            from = index + 1
            const end = index + item.text.length
            if (!edgesOk(segment.text, index, end) || !boundaryOk(segment.text, index, end, item.type)) continue
            if (guard(segment.text, index, end)) continue
            if (!directIds.get(key).has(segment.id)) hits.add(segment.id)
            detections.push({
              id: segment.id, type: item.type, text: item.text, start: index, end, source: item.source,
            })
          }
        }
        const direct = directIds.get(key).size
        if (structured && hits.size > Math.max(20, direct * 3)) {
          overMatch.set(key, { type: item.type, text: item.text, direct, spread: hits.size, ids: hits })
        }
      }
      // 3. Locate + replace with consistent pseudonyms.
      let newOriginals = 0
      const replacements = []
      const seenSpans = new Set()
      for (const detection of detections) {
        const spanKey = `${detection.id}:${detection.start}:${detection.end}`
        if (seenSpans.has(spanKey)) continue
        seenSpans.add(spanKey)
        if (kept(detection.type) || protectedText(detection.text) || allowed(detection.text)) continue
        const strategy = strategyOf(detection.type)
        const pseudonym = strategy === 'mask'
          ? maskValue(detection.type, detection.text)
          : strategy === 'redact'
            ? redactLabel(detection.type)
            : vault.token(detection.type, detection.text)
        if (strategy !== 'pseudonym' && pseudonym !== detection.text) produced.add(pseudonym)
        replacements.push({
          id: detection.id,
          start: detection.start,
          end: detection.end,
          original: detection.text,
          replacement: pseudonym,
        })
        const key = `${detection.type}|${pseudonym}`
        const entry = usedTypes.get(key) ?? { type: detection.type, pseudonym, count: 0, sources: new Set() }
        entry.count += 1
        entry.sources.add(detection.source)
        usedTypes.set(key, entry)
        usedPseudonyms.add(pseudonym)
        if (isCodeLike(detection.text)) codePseudonyms.add(pseudonym)
        const pending = pendingOriginals.get(detection.text)
        if (!pending) {
          newOriginals += 1
          pendingOriginals.set(detection.text, {
            type: detection.type, strategy, pseudonym, ids: new Set([detection.id]), expandable: expandable(detection.text),
          })
        } else {
          pending.ids.add(detection.id)
        }
      }
      // Longest span wins: an address contains a district, a hospital name may
      // contain a city. Applying both would leave fragments of the longer one.
      const accepted = []
      const acceptedBySegment = new Map()
      for (const replacement of [...replacements].sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
        const list = acceptedBySegment.get(replacement.id) ?? []
        if (list.some((other) => replacement.start < other.end && other.start < replacement.end)) continue
        list.push(replacement)
        acceptedBySegment.set(replacement.id, list)
        accepted.push(replacement)
      }
      // Right-to-left, so earlier offsets stay valid while the text is rewritten.
      accepted.sort((a, b) => b.start - a.start)
      const applied = doc.apply(accepted)

      // 4. Verification: rule checks, then the blind review.
      step('规则核验', round)
      const issues = []
      const structural = safeStructure(doc)
      if (!structural.ok) {
        issues.push({ severity: 'error', code: 'structure', detail: structural.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('；') })
      }
      const current = segmentsOf()
      for (const segment of current) {
        for (const residue of scan(segment.text, { landline: policy?.landline, issued })) {
          if (kept(residue.type) || allowed(residue.text) || protectedText(residue.text) || guard(segment.text, residue.start, residue.end)) continue
          issues.push(attach({ severity: 'error', code: 'residual', type: residue.type, fields: [segment.field ?? '正文'], detail: `规则复扫命中：${residue.type} ${maskForReport(residue.text)}${fieldSuffix(segment.field)}` }, residue.text, segment.text, segment.field))
        }
        for (const suspect of scanSuspects(segment.text)) {
          issues.push({ severity: 'warn', code: 'suspect', type: suspect.type, fields: [segment.field ?? '正文'], detail: `疑似${suspect.type}但${suspect.reason}：${maskForReport(suspect.text)}${fieldSuffix(segment.field)}` })
        }
      }
      // A pseudonym glued to letters/digits means part of a longer value was
      // replaced ("2001017" → "20证件-6F9CCC017"): the value is corrupted.
      const embedded = new Map()
      for (const segment of current) {
        for (const token of findTokens(segment.text, codePseudonyms)) {
          if (!token.glued) continue
          const entry = embedded.get(token.value) ?? new Set()
          entry.add(segment.id)
          embedded.set(token.value, entry)
        }
      }
      for (const [token, ids] of embedded) {
        const issue = { severity: 'error', code: 'embedded', detail: `假名 ${token} 嵌在更长的字母/数字串中，原值的一部分被误替换（${ids.size} 处，字段：${fieldsLabel(ids)}）` }
        // Where it is (segment ids, page only): the review tab places the item there.
        Object.defineProperty(issue, 'review', { value: { token, segments: [...ids].slice(0, 200) }, enumerable: false })
        issues.push(issue)
      }
      // Structured values that were numbers/dates must either stay intact or
      // be replaced as a whole.
      if (structured) {
        const partial = new Set()
        for (const segment of current) {
          const before = originalTexts.get(segment.id)
          if (before === undefined || before === segment.text) continue
          if (NUMERIC_VALUE.test(before) && !protectedText(segment.text) && !wholeParts(before, segment.text)) partial.add(segment.id)
        }
        if (partial.size > 0) {
          const issue = { severity: 'error', code: 'partial', detail: `${partial.size} 个数字/日期值被部分替换（字段：${fieldsLabel(partial)}）` }
          Object.defineProperty(issue, 'review', { value: { segments: [...partial].slice(0, 200) }, enumerable: false })
          issues.push(issue)
        }
      }
      // Indexed: only segments that contain an original at all are tested.
      const pendingList = [...pendingOriginals]
      const pendingHolders = pendingList.map(() => [])
      if (pendingList.length > 0) {
        const index = substringIndex(pendingList.map(([original]) => original))
        for (const segment of current) for (const hit of index.hits(segment.text)) pendingHolders[hit].push(segment)
      }
      for (const [n, [original, pending]] of pendingList.entries()) {
        // Short codes are replaced only where they were detected; elsewhere
        // the same digits are a different value and must stay.
        const inScope = pendingHolders[n].filter((segment) => (pending.expandable || pending.ids.has(segment.id)) && containsOriginal(segment.text, original))
        const left = new Set(inScope.map((segment) => segment.id))
        if (left.size > 0) {
          const first = inScope[0]
          issues.push(attach({ severity: 'error', code: 'not-removed', detail: `原文标记未清除：${pending.pseudonym}（原值 ${maskForReport(original)}，${left.size} 处，字段：${fieldsLabel(left)}）` }, original, first?.text, first?.field, { replacement: pending.pseudonym }))
        }
      }
      if (hasLlm && current.length > 0) {
        const modelIssues = []
        const groups = groupByText(current.filter((segment) => !vocabField(segment) && llmWorthy(segment.text, protectedText)))
        // Texts already reviewed clean (in another file of this batch, or
        // unchanged since the previous round) are not reviewed again.
        const verifyKeys = new Map()
        const toReview = []
        for (const group of groups) {
          const segment = group[0]
          const key = memo?.key('v', segment.field, segment.text)
          if (key && memoHit(key) !== undefined) continue
          if (key) verifyKeys.set(segment.id, key)
          toReview.push(segment)
        }
        // Numbers and short codes are not sent one by one, but they are not
        // skipped either: per field, the distinct values go out as one
        // segment, so the reviewer can tell an unformatted record number
        // from a quantity by the field name. Lists of several fields share
        // a request.
        const listed = numericLists(current, protectedText, memo ? (field, value) => memoHit(memo.key('n', field, value)) !== undefined : undefined, vocabField)
        const verifyBatches = makeBatches([...toReview, ...listed])
        const verifyReplies = await fanOut('复核', round, verifyBatches, (batch) => splitting(batch, (part) => {
          return timedCall('盲审', round, part.length, (extra) => verifier.chatJson(verifyPrompt(part.map(forModel)), { signal, maxTokens: 3000, validate: SHAPES.verify, ...extra }), verifier !== llm ? verifier.model : null)
        }, 'issues'))
        for (const [batchIndex, batch] of verifyBatches.entries()) {
          if (signal?.aborted) throw new Error('已取消')
          try {
            const reply = settled(verifyReplies[batchIndex])
            if (reply.usage?.total_tokens && !reply.cached) { llmStats.tokens += reply.usage.total_tokens; run.totals.tokens = llmStats.tokens; run.totals.tokensReported = true }
            {
              const counted = blindTotals(run)
              counted.calls += 1
              const items = (reply.json?.issues ?? []).length
              if (items > 0) counted.flaggedCalls += 1
              counted.items += items
            }
            // Every reported item ends in exactly one place: filtered here
            // (with a reason), unlocated (→ manual review), or re-judged
            // (blind.reported). The panel shows that accounting.
            const filterItem = (issue, text, why, judge = '', where = null) => {
              blindTotals(run).filtered[why] += 1
              const claimed = where ?? batch.find((item) => item.id === issue?.segment)
              const cross = text ? crossEntry(round, claimed?.members?.[0] ?? claimed, String(issue?.type ?? '—'), text, issue?.reason) : null
              if (cross) { cross.outcome = 'filtered'; cross.judge = judge || FILTER_LABELS[why] }
            }
            // Where each finding is (see placeFinding): the segment it names,
            // else the batch segment or document segment that holds the text.
            const findings = []
            for (const issue of reply.json?.issues ?? []) {
              const text = String(issue?.text ?? '').trim()
              if (!text) { filterItem(issue, text, 'invalid'); continue }
              if (protectedText(text) || allowed(text)) { filterItem(issue, text, 'allowed'); continue }
              if (!isKnownType(issue?.type)) { dropItems(reply.entry, '盲审'); filterItem(issue, text, 'invalid'); continue }
              if (kept(issue.type)) { filterItem(issue, text, 'allowed'); continue }
              findings.push({ issue, text, place: placeFinding(batch, current, issue.segment, text, vocabField, groups) })
            }
            // Remember what came back clean. Any finding on a segment (or
            // inside a listed value) keeps it out of the memo, and so does a
            // finding that is not where the reply said: nothing of that batch
            // is remembered as clean.
            if (memo && Array.isArray(reply.json?.issues) && findings.every((finding) => finding.place?.inBatch !== false)) {
              const flagged = new Map()
              const flag = (id, text) => {
                const list = flagged.get(id) ?? []
                list.push(text)
                flagged.set(id, list)
              }
              for (const issue of reply.json.issues) flag(issue?.segment, String(issue?.text ?? '').trim())
              for (const finding of findings) for (const id of finding.place?.batchIds ?? []) flag(id, finding.text)
              for (const segment of batch) {
                const texts = flagged.get(segment.id)
                if (segment.values) {
                  for (const value of segment.values) {
                    if (texts?.some((text) => text && (value.includes(text) || text.includes(value)))) continue
                    memo.set(memo.key('n', segment.field, value), [])
                  }
                } else if (!texts && verifyKeys.has(segment.id)) {
                  memo.set(verifyKeys.get(segment.id), [])
                }
              }
            }
            for (const { issue, text, place } of findings) {
              if (!place) {
                // Named nowhere the text is: a fragment of a pseudonym is
                // already handled; anything else is checked by a person.
                if ([...batch, ...current].some((item) => item.text.includes(text) && echoesPseudonym(item.text, text))) {
                  dropItems(reply.entry, '盲审')
                  filterItem(issue, text, 'pseudonym')
                  continue
                }
                const claimed = batch.find((item) => item.id === issue.segment)
                const field = claimed?.members?.[0]?.field ?? claimed?.field
                blindTotals(run).unlocated += 1
                const lost = crossEntry(round, claimed?.members?.[0] ?? claimed, issue.type, text, issue?.reason)
                if (lost) lost.outcome = 'unlocated'
                modelIssues.push(attach({ severity: 'error', code: 'model-unlocated', type: issue.type, fields: [field ?? '正文'], detail: `独立盲审报出、但未能在原文中准确定位：${issue.type} ${maskForReport(text)}${fieldSuffix(field)}，请人工核对` }, text, claimed?.text, field))
                continue
              }
              const segment = place.segment
              const memberIds = place.ids
              const reason = plausible(issue.type, text, 'llm')
              if (reason) {
                reject(issue.type, text, reason, 'llm', segment.id)
                filterItem(issue, text, 'format', `${FILTER_LABELS.format}：${reason}`, segment)
                continue
              }
              const blindStats = blindTotals(run)
              blindStats.reported += 1
              const cross = crossEntry(round, segment, issue.type, text, issue?.reason)
              const dispute = disputed.get(`${issue.type}|${text}`)
              if (dispute) {
                // Verifier insists, detection model disagrees: a human decides.
                dispute.escalated = true
                blindStats.disputed += 1
                if (cross) { cross.outcome = 'disputed'; cross.judge = dispute.reason || '' }
                modelIssues.push(attach({ severity: 'error', code: 'disputed', type: issue.type, fields: [segment.field ?? '正文'], detail: `核验与识别意见不一致：${issue.type} ${maskForReport(text)}${fieldSuffix(segment.field)}（识别模型认为不是标识符：${reasonForReport(dispute.reason, text)}）` }, text, segment.text, segment.field))
                continue
              }
              if (text.length >= 2 && !BARE_LABELS.has(text)) {
                const ids = memberIds ?? new Set((groups.find((group) => group[0].id === segment.id) ?? [segment]).map((item) => item.id))
                carryOver.push({ type: issue.type, text, ids, field: segment.field ?? null, context: segment.text, reason: String(issue?.reason ?? '').slice(0, 120), cross })
              } else {
                // Too short to re-judge: straight to manual review.
                blindStats.unjudged = (blindStats.unjudged ?? 0) + 1
                if (cross) cross.outcome = 'unjudged'
              }
              modelIssues.push(attach({ severity: 'error', code: 'model-residual', type: issue.type, fields: [segment.field ?? '正文'], detail: `独立盲审报出：${issue.type} ${maskForReport(text)}${fieldSuffix(segment.field)}` }, text, segment.text, segment.field))
            }
          } catch (error) {
            if (error?.code === 'aborted' || signal?.aborted) throw new Error('已取消')
            // Not reviewed: a person has to check these segments.
            issues.push({ severity: 'error', code: 'model-unchecked', detail: `盲审调用失败（${describeError(error)}），${batch.length} 段未经独立盲审` })
          }
        }
        issues.push(...modelIssues)
      }
      for (const item of unlocated) {
        issues.push({ severity: 'warn', code: 'unlocated', type: item.type, detail: `模型给出的片段未在原文中定位到：${item.type} ${maskForReport(item.text)}` })
      }
      // A detection call that still failed after retry and split: those
      // segments were not checked by the model, so a person must look.
      if (parseErrors.length > 0) {
        issues.push({ severity: 'error', code: 'model-unchecked', detail: `识别调用失败 ${parseErrors.length} 批（${[...new Set(parseErrors)].slice(0, 2).join('；')}），这些段落未经模型识别` })
      }
      file.structure = structural
      file.issues = dedupeIssues(issues)
      const errors = file.issues.filter((issue) => issue.severity === 'error')
      if (errors.length === 0) break
      if (carryOver.length > 0) continue // confirmed residuals: replace them next round
      if (applied === 0 || newOriginals === 0 && round > 1) {
        // No progress: do not spin on the same evidence.
        break
      }
    }
    // Reported in the last round: no round left to re-judge them.
    if (carryOver.length > 0) {
      const counted = blindTotals(run)
      counted.unjudged = (counted.unjudged ?? 0) + carryOver.length
      for (const residual of carryOver) if (residual.cross) residual.cross.outcome = 'unjudged'
    }
  } catch (error) {
    if (String(error?.message) === '已取消') {
      file.status = 'cancelled'
      file.durationMs = Date.now() - started
      // Issues of the rounds already done: known values out, reasons cut.
      scrubFileText(null, file, knownScrubber([...pendingOriginals].map(([original, pending]) => [original, pending.pseudonym])))
      return file
    }
    file.issues.push({ severity: 'error', code: 'pipeline', detail: describeError(error) })
  }

  // Review aids: what was deliberately not replaced, and what spread widely.
  // Load-time notices of the format layer (encoding converted, forced cut of
  // an over-long line) carry no original values.
  const notes = (doc?.notices ?? []).map((notice) => ({ ...notice }))
  for (const item of disputed.values()) {
    if (item.escalated) continue
    notes.push({ severity: 'warn', code: 'verify-dismissed', type: item.type, fields: [item.field ?? '正文'], detail: `核验报出、识别模型判定不是标识符，未替换：${item.type} ${maskForReport(item.text)}（${reasonForReport(item.reason, item.text)}）` })
  }
  for (const item of [...rejected.values()].slice(0, 30)) {
    const where = item.ids.size > 0 ? `，字段：${fieldsLabel(item.ids)}` : ''
    notes.push({
      severity: 'warn',
      code: 'implausible',
      type: item.type,
      fields: fieldList(item.ids),
      detail: `${item.source === 'header' ? '按字段名' : '模型'}判为${item.type}，但${item.reason}，未替换：${maskForReport(item.text)}${where}`,
    })
  }
  // Values that spread far beyond where they were found are allow-list
  // candidates. Original text: hidden from report.json (non-enumerable).
  Object.defineProperty(file, 'overMatchValues', {
    value: [...overMatch.values()].map((item) => ({ type: item.type, text: item.text, spread: item.spread, fields: fieldList(item.ids) })),
    enumerable: false,
  })
  for (const item of overMatch.values()) {
    notes.push({
      severity: 'warn',
      code: 'over-match',
      type: item.type,
      fields: fieldList(item.ids),
      detail: `${item.type} ${maskForReport(item.text)} 除 ${item.direct} 个识别位置外又在 ${item.spread} 个值中被替换（字段：${fieldsLabel(item.ids)}），请确认不是误判`,
    })
  }
  if (skippedCount > 0) {
    notes.push({ severity: 'warn', code: 'skipped-fields', detail: `按配置跳过 ${skippedCount} 个值（不处理的字段），这些值原样输出` })
  }
  file.issues = dedupeIssues([...file.issues, ...notes])

  // Nothing unreadable passes as checked. Content that could not be turned
  // into text (images, PDFs, binary, undecodable runs, short opaque blobs,
  // long unreadable strings) goes to manual review, or is replaced by a
  // placeholder when the policy says so; the file is never "clean" with it.
  if (file.status !== 'cancelled' && doc) {
    try {
      const opaque = doc.opaque?.() ?? []
      if (opaque.length > 0 && policy?.opaquePolicy === 'remove') {
        const removed = doc.removeOpaque()
        file.issues.push({ severity: 'warn', code: 'opaque-removed', detail: `按配置移除 ${removed} 处无法检查的内容（${[...new Set(opaque.map((item) => item.kind))].join('、')}），已用占位替代` })
      } else if (opaque.length > 0) {
        const groups = new Map()
        for (const item of opaque) {
          const key = `${item.id}|${item.kind}`
          const group = groups.get(key) ?? { ...item, count: 0, bytes: 0 }
          group.count += 1
          group.bytes += item.bytes ?? 0
          groups.set(key, group)
        }
        for (const group of groups.values()) {
          const issue = { severity: 'error', code: 'opaque', fields: [group.field ?? '正文'], detail: `无法检查的内容：${group.kind} ×${group.count}（约 ${Math.max(1, Math.round(group.bytes / 1024))} KB${group.via ? `，位于 ${group.via}` : ''}${fieldSuffix(group.field)}）` }
          Object.defineProperty(issue, 'review', { value: { field: group.field ?? '正文', baseId: group.id, kind: group.kind, count: group.count, image: group.image }, enumerable: false })
          file.issues.push(issue)
        }
      }
      for (const { field, count } of doc.tokens?.() ?? []) {
        const issue = { severity: 'error', code: 'opaque-token', fields: [field], detail: `${count} 个无法解读的编码串（可能是哈希、加密值或二进制标识）${fieldSuffix(field)}` }
        Object.defineProperty(issue, 'review', { value: { field }, enumerable: false })
        file.issues.push(issue)
      }
      const unreadable = new Map()
      for (const segment of doc.segments()) {
        if (!looksUnreadable(segment.text)) continue
        const field = segment.field ?? '正文'
        unreadable.set(field, (unreadable.get(field) ?? 0) + 1)
      }
      for (const [field, count] of unreadable) {
        const issue = { severity: 'error', code: 'unreadable', fields: [field], detail: `${count} 处无法解读的长字符串（可能是未知编码或加密内容）${fieldSuffix(field)}` }
        Object.defineProperty(issue, 'review', { value: { field }, enumerable: false })
        file.issues.push(issue)
      }
      file.coverage = doc.coverage?.() ?? null
      // Object keys are not values: nothing above rewrote them.
      file.issues.push(...keyIssues(doc, [
        ...[...pendingOriginals].filter(([, pending]) => pending.strategy !== 'keep').map(([text, pending]) => ({ text, type: pending.type })),
        ...[...(batchKnown?.values() ?? [])].filter((item) => (policy?.identifiers?.[item.type] ?? 'pseudonym') !== 'keep'),
      ], policy, true))
    } catch (error) {
      file.issues.push({ severity: 'error', code: 'opaque-check', detail: `无法检查的内容核查失败：${describeError(error)}` })
    }
  }

  // Quasi-identifiers: one deterministic pass after the identifier loop. They
  // are not part of the model repair loop (the model never sees this policy).
  file.quasi = {}
  // 邮编 is always processed (policy.quasiActive); the others only when the
  // quasi toggle is on.
  const quasiActive = policy?.quasiActive ?? (policy?.quasiEnabled ? policy.quasi : {})
  if (Object.keys(quasiActive ?? {}).length > 0 && file.status !== 'cancelled') {
    try {
      const planned = []
      for (const segment of segmentsOf()) {
        for (const item of quasiReplacements(segment, quasiActive, shiftDays)) {
          if (guard(segment.text, item.start, item.end)) continue
          planned.push({ ...item, id: segment.id })
        }
      }
      planned.sort((a, b) => b.start - a.start)
      const appliedQuasi = doc.apply(planned)
      for (const item of planned) file.quasi[item.type] = (file.quasi[item.type] ?? 0) + 1
      if (appliedQuasi < planned.length) {
        file.issues.push({ severity: 'warn', code: 'quasi', detail: `准标识符有 ${planned.length - appliedQuasi} 处未能替换` })
      }
      const structural = safeStructure(doc)
      file.structure = structural
      if (!structural.ok) {
        file.issues.push({ severity: 'error', code: 'structure', detail: '准标识符处理后结构校验未通过' })
      }
    } catch (error) {
      file.issues.push({ severity: 'error', code: 'quasi', detail: `准标识符处理失败：${describeError(error)}` })
    }
  }

  file.entities = [...usedTypes.values()]
    .map((entry) => ({ type: entry.type, pseudonym: entry.pseudonym, count: entry.count, sources: [...entry.sources] }))
    .sort((a, b) => b.count - a.count)
  const errors = file.issues.filter((issue) => issue.severity === 'error')
  file.status = errors.length > 0 ? 'review' : 'clean'
  file.durationMs = Date.now() - started

  // Hidden from report.json (non-enumerable): original values this file
  // contributed to the batch dictionary (and to output file names), and the
  // live document for the cross-file re-check after all files are done.
  const found = [...pendingOriginals]
    .filter(([, pending]) => pending.strategy !== 'keep')
    .map(([text, pending]) => ({ type: pending.type, text }))
  Object.defineProperty(file, 'found', { value: found, enumerable: false })
  Object.defineProperty(file, 'doc', { value: doc, enumerable: false, writable: true })

  relabelFields(run, file, doc)
  // Nothing report-bound repeats an original: labels that are identifiers,
  // known values quoted in details or in a model's reasons.
  scrubFileText(run, file, knownScrubber([
    ...[...pendingOriginals].map(([original, pending]) => [original, pending.pseudonym]),
    ...[...(batchKnown?.values() ?? [])].map((item) => [item.text, maskForReport(item.text)]),
  ]), [...new Set(fieldOf.values())].filter(Boolean).map((label) => file.shownFields?.get(label) ?? label))
  await writeOutput(file, doc, outputDir, relPath, writeGuard)
  return file
}

async function writeOutput(file, doc, outputDir, relPath, guard) {
  let target = null
  try {
    const path = resolve(outputDir, relPath)
    if (!path.startsWith(resolve(outputDir) + sep)) throw new Error('输出路径越界')
    if (guard) await guard.check(path)
    target = path
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, doc.serialize(), { mode: 0o600 })
  } catch (error) {
    file.status = 'failed'
    file.issues.push({ severity: 'error', code: 'write', detail: describeError(error) })
    // Never leave an earlier or partial result under this name: it would be
    // delivered (or re-packed) as if it were this file's output. Only a path
    // the guard accepted is removed.
    if (target) await rm(target, { force: true }).catch(() => {})
  }
}

const ADMIN_REGION = /^(?:[\u4e00-\u9fa5]{2,7}(?:省|市|县|区|镇|乡|街道|自治州|自治区|自治县)|[\u4e00-\u9fa5]{0,4}(?:省直辖县级行政区划|市辖区))$/

/** Identifier types shared across the files of one batch. */
function addKnown(batchKnown, type, text, policy) {
  const value = String(text ?? '').trim()
  if (!value || !expandable(value) || isPseudonym(value)) return
  if ((policy?.identifiers?.[type] ?? 'pseudonym') !== 'pseudonym') return
  if (plausible(type, value, 'llm') && plausible(type, value, 'header')) return
  if (BARE_LABELS.has(value)) return
  // Region columns ("海南省", "万宁市") are quasi-identifiers: searching every
  // other file for them would rewrite travel histories and hospital names.
  if (type === '地址' && ADMIN_REGION.test(value) && !/(?:社区|小区|村)$/.test(value)) return
  // A 2-character name is too ambiguous to search for in other files' prose
  // ("王芳" inside a longer word) unless it is a CJK person name.
  if ((type === '姓名' || type === '医生') && !/^[\u4e00-\u9fa5·]{2,6}$/.test(value)) return
  const key = `${type}|${value}`
  if (!batchKnown.has(key)) batchKnown.set(key, { type, text: value })
}

/**
 * Seed the batch dictionary before any file is processed: identifiers in
 * named columns (header hints) and rule hits. Cheap and model-free; values the
 * model finds are added as files complete, and the final re-check covers files
 * processed before such a value was known.
 */
async function seedBatchKnown(items, policy, maxFileBytes, signal) {
  const batchKnown = new Map()
  for (const { path, relPath } of items) {
    if (signal?.aborted) break
    try {
      const info = await stat(path)
      if (info.size > maxFileBytes) continue
      const doc = layered(await loadDocument(path, relPath))
      for (const raw of doc.segments()) {
        const segment = withEffectiveHint(raw)
        if (fieldSkipped(segment.field, policy.skipFields)) continue
        if (segment.hint && !plausible(segment.hint, segment.text.trim(), segment.hintFrom === 'sibling' ? 'llm' : 'header')) {
          if (!policy.allowValues.has(normalizeAllow(segment.text))) addKnown(batchKnown, segment.hint, segment.text, policy)
        }
        for (const entity of scan(segment.text, { landline: policy.landline })) {
          if (policy.allowValues.has(normalizeAllow(entity.text))) continue
          addKnown(batchKnown, entity.type, entity.text, policy)
        }
      }
    } catch { /* reported when the file is processed */ }
  }
  return batchKnown
}

/**
 * Values file and folder names are checked against: the batch dictionary
 * and every value a file's contents were found to hold (whatever its
 * strategy; the policy decides the replacement), except administrative
 * regions, which name folders of their own ("海南省") rather than a person.
 */
function pathKnown(batchKnown, files = []) {
  const out = [...batchKnown.values()]
  for (const file of files) {
    for (const item of file.found ?? []) {
      if (item.type === '地址' && ADMIN_REGION.test(item.text)) continue
      out.push(item)
    }
  }
  return out
}

/** "a/b/name.txt" → "a/b/name~2.txt" */
function variantName(relPath, n) {
  const slash = relPath.lastIndexOf('/')
  const dir = slash >= 0 ? relPath.slice(0, slash + 1) : ''
  const name = relPath.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${dir}${name.slice(0, dot)}~${n}${name.slice(dot)}` : `${dir}${name}~${n}`
}

/**
 * Outputs written under the name decided before processing move to the name
 * decided with everything the batch found (`next`: logical path → output
 * path). Names stay unique (a taken one gets "~2"), folders left empty under
 * an old name are removed, and the file records and call log follow.
 */
async function moveOutputs({ run, items, next, outputDir, runDir, guard }) {
  const moves = items.filter((item) => next.has(item.relPath) && next.get(item.relPath) !== item.outRel)
  if (moves.length === 0) return
  const moving = new Set(moves)
  const taken = new Set(items.filter((item) => !moving.has(item)).map((item) => item.outRel))
  const byRel = new Map(run.files.map((file) => [file.relPath, file]))
  // 1. Every moving output steps aside first, so names can be exchanged.
  const hold = join(runDir, 'renaming')
  const held = []
  for (const [n, item] of moves.entries()) {
    const from = join(outputDir, item.outRel)
    if (!(await stat(from).then((info) => info.isFile(), () => false))) {
      held.push(null)
      continue
    }
    const to = join(hold, String(n))
    await guard.check(to)
    await mkdir(hold, { recursive: true })
    await rename(from, to)
    held.push(to)
  }
  // 2. Each takes its new name.
  const renamed = new Map()
  for (const [n, item] of moves.entries()) {
    const wanted = next.get(item.relPath)
    let target = wanted
    for (let k = 2; taken.has(target); k += 1) target = variantName(wanted, k)
    taken.add(target)
    if (held[n]) {
      const to = resolve(outputDir, target)
      if (!to.startsWith(resolve(outputDir) + sep)) throw new Error('输出路径越界')
      await guard.check(to)
      await mkdir(dirname(to), { recursive: true })
      await rename(held[n], to)
    }
    renamed.set(item.outRel, target)
    const file = byRel.get(item.outRel)
    if (file) file.relPath = target
    item.outRel = target
  }
  await rm(hold, { recursive: true, force: true })
  await pruneEmpty(outputDir)
  for (const entry of run.callLog ?? []) if (renamed.has(entry.file)) entry.file = renamed.get(entry.file)
}

/** Remove empty folders below `dir` (not `dir` itself); true when `dir` is empty. */
async function pruneEmpty(dir, top = true) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  let empty = true
  for (const entry of entries) {
    if (entry.isDirectory() && await pruneEmpty(join(dir, entry.name), false)) continue
    empty = false
  }
  if (empty && !top) await rm(dir, { recursive: true, force: true })
  return empty
}

/**
 * Final cross-file pass: replace identifiers that another file revealed after
 * this one was processed (a name the model found in file 9 that also sits in
 * an unlabelled field of file 2).
 */
async function recheckBatch({ run, files = run.files, batchKnown, vault, outputDir, policy, guard }) {
  const kept = (type) => (policy?.identifiers?.[type] ?? 'pseudonym') === 'keep'
  const known = [...batchKnown.values()].filter((item) => !kept(item.type))
    .sort((a, b) => b.text.length - a.text.length)
  const index = substringIndex(known.map((item) => item.text))
  for (const file of files) {
    const doc = file.doc
    if (!doc || file.status === 'failed' || file.status === 'cancelled') continue
    // Let the page and other requests run between files.
    await new Promise((done) => setImmediate(done))
    const replacements = []
    const counts = new Map()
    for (const segment of doc.segments()) {
      if (fieldSkipped(segment.field, policy.skipFields)) continue
      const taken = []
      for (const hit of index.hits(segment.text)) {
        const item = known[hit]
        for (const span of locate(segment.text, item.text, item.type)) {
          if (!edgesOk(segment.text, span.start, span.end)) continue
          if (taken.some((other) => span.start < other.end && other.start < span.end)) continue
          taken.push(span)
          const pseudonym = vault.token(item.type, item.text)
          replacements.push({ id: segment.id, ...span, original: item.text, replacement: pseudonym })
          const key = `${item.type}|${pseudonym}`
          counts.set(key, { type: item.type, pseudonym, count: (counts.get(key)?.count ?? 0) + 1 })
        }
      }
    }
    // Values another file revealed may also be object keys here.
    const seenDetails = new Set(file.issues.map((issue) => issue.detail))
    const keyed = keyIssues(doc, known, policy, false).filter((issue) => !seenDetails.has(issue.detail))
    if (replacements.length === 0 && keyed.length === 0) continue
    const wasClean = file.status !== 'review'
    const errorsBefore = file.issues.filter((issue) => issue.severity === 'error').length
    if (keyed.length > 0) {
      file.issues.push(...keyed)
      file.status = 'review'
    }
    if (replacements.length === 0) {
      run.totals.unresolved += keyed.length
      if (wasClean) run.totals.filesReview += 1
      continue
    }
    replacements.sort((a, b) => b.start - a.start)
    const applied = doc.apply(replacements)
    for (const entry of counts.values()) {
      const existing = file.entities.find((item) => item.type === entry.type && item.pseudonym === entry.pseudonym)
      if (existing) {
        existing.count += entry.count
        if (!existing.sources.includes('batch')) existing.sources.push('batch')
      } else {
        file.entities.push({ type: entry.type, pseudonym: entry.pseudonym, count: entry.count, sources: ['batch'] })
      }
    }
    file.entities.sort((a, b) => b.count - a.count)
    relabelFields(run, file, doc)
    file.issues.push({ severity: 'warn', code: 'batch-recheck', detail: `批次复扫：补替换 ${applied} 处在其他文件中识别到的标识符` })
    const structural = safeStructure(doc)
    file.structure = structural
    if (!structural.ok) {
      file.issues.push({ severity: 'error', code: 'structure', detail: '批次复扫补替换后结构校验未通过' })
      file.status = 'review'
    }
    if (applied < replacements.length) {
      file.issues.push({ severity: 'error', code: 'batch-residual', detail: `批次复扫有 ${replacements.length - applied} 处未能替换` })
      file.status = 'review'
    }
    run.totals.entities += applied
    for (const entry of counts.values()) run.totals.byType[entry.type] = (run.totals.byType[entry.type] ?? 0) + entry.count
    // The earlier output still holds what this pass replaced: a failed write
    // removes it (see writeOutput) and counts like any other failure.
    await writeOutput(file, doc, outputDir, file.relPath, guard)
    const errors = file.issues.filter((issue) => issue.severity === 'error').length
    run.totals.unresolved += errors - errorsBefore
    if (file.status === 'failed') run.totals.filesFailed += 1
    else if (file.status === 'review' && wasClean) run.totals.filesReview += 1
  }
}

/**
 * Object keys of a JSON document that are, or hold, an identifier: a known
 * original of this file or the batch, or (with `rules`) a rule hit. Keys are
 * the structure and are never rewritten, so such a file goes to manual
 * review. The detail names the value masked only.
 */
function keyIssues(doc, originals, policy, rules) {
  if (doc?.kind !== 'json') return []
  let root
  try {
    root = JSON.parse(String(doc.serialize()).replace(/^\uFEFF/, ''))
  } catch {
    return []
  }
  const keys = new Set()
  const walkKeys = (value) => {
    if (Array.isArray(value)) for (const item of value) walkKeys(item)
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        keys.add(key)
        walkKeys(inner)
      }
    }
  }
  walkKeys(root)
  if (keys.size === 0) return []
  const found = new Map() // original → { type, count }
  const note = (type, text) => {
    const entry = found.get(text) ?? { type, count: 0 }
    entry.count += 1
    found.set(text, entry)
  }
  // Both tests below imply key.includes(text): only those originals are tried.
  const index = substringIndex(originals.map((item) => item.text))
  for (const key of keys) {
    const hit = index.hits(key).map((n) => originals[n]).find((item) => !isPseudonym(item.text)
      && (expandable(item.text) ? containsOriginal(key, item.text) : key.trim() === item.text))
    if (hit) { note(hit.type, hit.text); continue }
    if (!rules) continue
    const entity = scan(key, { landline: policy?.landline })
      .find((item) => !isPseudonym(item.text) && (policy?.identifiers?.[item.type] ?? 'pseudonym') !== 'keep')
    if (entity) note(entity.type, entity.text)
  }
  return [...found].map(([text, { type, count }]) => ({
    severity: 'error',
    code: 'key-identifier',
    type,
    detail: `JSON 键名含标识符，键名不改写（保持结构），请人工处理：${type} ${maskForReport(text)}（${count} 个键）`,
  }))
}

// Values that are entirely numbers/dates/times: never sent to the model (rules
// cover IDs and phones there), and never allowed to be partially rewritten.
const NUMERIC_VALUE = /^[\d\s:.,/+\-TZ]+$/

/**
 * A composite number ("330100000000000-12345678901", "123456,654321") whose
 * replaced parts are whole separator-delimited parts of 6+ digits: the
 * patient part of a compound key, not a number cut in the middle. Short
 * parts (years, months, check digits) never count as replaced wholes, and a
 * kept part as long as a replaced one keeps the value in review.
 */
const PART_SEP = /([-,;/\s]+)/
export function wholeParts(before, after) {
  const PLACEHOLDER = '\u0001'
  const masked = after.replace(new RegExp(PSEUDONYM_TOKEN_SOURCE, 'g'), PLACEHOLDER)
  const a = before.split(PART_SEP)
  const b = masked.split(PART_SEP)
  if (a.length !== b.length || a.length < 3) return false
  const replaced = new Set()
  const kept = []
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) { if (i % 2 === 0 && /^\d{6,}$/.test(a[i])) kept.push(a[i].length); continue }
    if (i % 2 === 1 || b[i] !== PLACEHOLDER || !/^\d{6,}$/.test(a[i])) return false
    replaced.add(a[i].length)
  }
  // A kept part shaped like a replaced one ("12345678/87654321" with only
  // the first replaced) is probably the same kind of number: a person checks.
  return replaced.size > 0 && !kept.some((length) => replaced.has(length))
}

function llmWorthy(text, protectedText) {
  const value = text.trim()
  if (value.length < 2) return false
  if (NUMERIC_VALUE.test(value)) return false
  // Bed numbers, flags, short codes ("12S", "Y"): the model cannot tell what
  // they identify, and the format check would reject them anyway.
  if (isCodeLike(value) && value.length < 4) return false
  return !protectedText(value)
}

/**
 * Segments that the per-segment review skips (pure numbers, dates, short
 * codes), grouped per field into value lists of at most ~1400 characters.
 * Pseudonyms are left out; each list remembers its member segments and values.
 * `skip(field, value)`: values already reviewed clean earlier in the batch.
 */
function numericLists(segments, protectedText, skip = () => false, extra = () => false) {
  const byField = new Map()
  for (const segment of segments) {
    const value = segment.text.trim()
    if (value.length < 2 || protectedText(value)) continue
    // Numbers / short codes, plus values of vocabulary columns (profiling).
    if (llmWorthy(segment.text, protectedText) && !extra(segment)) continue
    if (skip(segment.field ?? '正文', value)) continue
    // A long run of digits/letters is a single value; dates and times are
    // listed too (a field name decides whether they matter).
    const field = segment.field ?? '正文'
    const entry = byField.get(field) ?? { values: new Map(), members: [] }
    entry.members.push(segment)
    if (!entry.values.has(value)) entry.values.set(value, true)
    byField.set(field, entry)
  }
  const out = []
  for (const [field, entry] of byField) {
    let chunk = []
    let chars = 0
    const flush = () => {
      if (chunk.length === 0) return
      const set = new Set(chunk)
      out.push({ id: `num:${field}#${out.length}`, field, text: chunk.join('；'), values: chunk, members: entry.members.filter((member) => set.has(member.text.trim())) })
      chunk = []
      chars = 0
    }
    for (const value of entry.values.keys()) {
      if (chars + value.length + 1 > 1400) flush()
      chunk.push(value)
      chars += value.length + 1
    }
    flush()
  }
  return out
}

/**
 * Batch-wide memo of model answers per (field, text), so the same text in
 * another file — or unchanged in a later round — is not sent again:
 *  - 'd' detection: the entities the model returned for that segment (often
 *    none); applied exactly as a fresh reply would be;
 *  - 'v' blind review of a segment, and 'n' of one numeric/code value: only
 *    clean results are kept. A finding is always re-asked, so the
 *    verifier-vs-detector dispute logic sees a real second opinion.
 * Memory only (answers quote originals), keyed by a hash, bounded: past
 * `limit` the oldest fifth is dropped.
 */
export function createModelMemo(limit = 1_500_000) {
  const map = new Map()
  const stats = { hits: 0 }
  return {
    stats,
    key: (kind, field, text) => createHash('sha1').update(`${kind}\u0000${field ?? ''}\u0000${text}`).digest('base64'),
    get(key) {
      const value = map.get(key)
      if (value !== undefined) stats.hits += 1
      return value
    },
    set(key, value) {
      map.set(key, value.length === 0 ? NO_FINDINGS : value)
      if (map.size > limit) {
        let drop = Math.ceil(limit / 5)
        for (const old of map.keys()) {
          map.delete(old)
          if (--drop <= 0) break
        }
      }
    },
    get size() { return map.size },
  }
}
const NO_FINDINGS = Object.freeze([])

function groupByText(segments) {
  const groups = new Map()
  for (const segment of segments) {
    const list = groups.get(segment.text)
    if (list) list.push(segment)
    else groups.set(segment.text, [segment])
  }
  return [...groups.values()]
}

function forModel(segment) {
  return segment.field ? { id: segment.id, field: segment.field, text: segment.text } : { id: segment.id, text: segment.text }
}

/** Short codes (< 6 letters/digits) are replaced only where detected. */
function expandable(text) {
  const value = String(text).trim()
  if (value.length < 2) return false
  return !(isCodeLike(value) && value.length < 6)
}

/** A match that starts/ends with a letter or digit must not continue one. */
function edgesOk(text, start, end) {
  const word = /[0-9A-Za-z]/
  if (word.test(text[start]) && start > 0 && word.test(text[start - 1])) return false
  if (word.test(text[end - 1]) && end < text.length && word.test(text[end])) return false
  return true
}

const TOKEN_RE = /(?:化名|患者|医生|证件|电话|邮箱|地址|病历|住院|就诊|社保|银行卡|医院)-[0-9A-F]{6}/g

function findTokens(text, known) {
  const out = []
  if (known.size === 0) return out
  const matches = [...text.matchAll(TOKEN_RE)]
  // Two pseudonyms side by side ("住址：某路100号13800138000" →
  // "地址-2F223B电话-73009F") are two whole values, not one cut in half.
  const tokenEnds = new Set(matches.map((match) => match.index + match[0].length))
  for (const match of matches) {
    if (!known.has(match[0])) continue
    const start = match.index
    const end = start + match[0].length
    const glued = (start > 0 && /[0-9A-Za-z]/.test(text[start - 1]) && !tokenEnds.has(start)) || (end < text.length && /[0-9A-Za-z]/.test(text[end]))
    out.push({ value: match[0], glued })
  }
  return out
}

function normalizeAllow(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase()
}

function fieldSkipped(field, skipFields) {
  if (!field) return false
  const name = String(field).toLowerCase()
  if (skipFields.has(name)) return true
  const bang = name.lastIndexOf('!') // xlsx: "Sheet!列名"
  return bang >= 0 && skipFields.has(name.slice(bang + 1))
}

/**
 * Field labels are the document's stable keys and are built from what was
 * loaded: an xlsx label carries the sheet name and the header text. When
 * either was itself an identifier and got replaced, the file's issues,
 * review items and profiles get the label's current form, so nothing written
 * about the file repeats the original.
 */
function relabelFields(run, file, doc) {
  const renamed = doc?.renamedFields?.() ?? []
  if (renamed.length === 0) return
  // Label as issued by a document → label as currently written in the issues.
  let shown = file.shownFields
  if (!shown) {
    shown = new Map()
    Object.defineProperty(file, 'shownFields', { value: shown, enumerable: false })
  }
  const swaps = new Map()
  for (const [issued, now] of renamed) {
    const previous = shown.get(issued) ?? issued
    if (previous !== now) swaps.set(previous, now)
    shown.set(issued, now)
  }
  if (swaps.size === 0) return
  const pattern = new RegExp([...swaps.keys()].sort((a, b) => b.length - a.length)
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  const swap = (text) => (typeof text === 'string' ? text.replace(pattern, (label) => swaps.get(label)) : text)
  for (const issue of file.issues ?? []) {
    issue.detail = swap(issue.detail)
    if (Array.isArray(issue.fields)) issue.fields = issue.fields.map(swap)
    if (issue.review && typeof issue.review === 'object') issue.review.field = swap(issue.review.field)
  }
  if (file.profiles) file.profiles = Object.fromEntries(Object.entries(file.profiles).map(([field, value]) => [swap(field), value]))
  if (run?.profileSummary) {
    const summary = {}
    for (const [field, entry] of Object.entries(run.profileSummary)) {
      const next = swap(field)
      if (next !== field && entry && typeof entry === 'object') entry.field = next
      const existing = summary[next]
      if (existing && entry && typeof entry === 'object') {
        existing.files += entry.files ?? 0
        existing.distinct = Math.max(existing.distinct ?? 0, entry.distinct ?? 0)
      } else summary[next] = entry
    }
    run.profileSummary = summary
  }
}

function fieldSuffix(field) {
  return field ? `（字段 ${field}）` : ''
}

function describeFields(fields) {
  const counts = new Map()
  for (const field of fields) {
    const name = field ?? '正文'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const list = [...counts].sort((a, b) => b[1] - a[1])
  const shown = list.slice(0, 6).map(([name, count]) => (count > 1 ? `${name}×${count}` : name)).join('、')
  return list.length > 6 ? `${shown} 等 ${list.length} 个字段` : shown
}

/**
 * Segments per model request. Every request repeats ~450 tokens of
 * instructions, so small batches spend about half the prompt on them; ~4000
 * characters keeps that share near 15 % while staying well inside what a
 * 27B model reads reliably. A reply that is cut off is split and retried
 * (see `splitting` in processFile).
 */
const BATCH_CHARS = 4000
const BATCH_ITEMS = 60
/** Timed-out model requests per file that are still split and retried. */
const TIMEOUT_SPLITS = 6

function makeBatches(segments, maxChars = BATCH_CHARS, maxItems = BATCH_ITEMS) {
  const usable = segments.filter((segment) => segment.text.trim().length >= 2)
  const batches = []
  let current = []
  let chars = 0
  for (const segment of usable) {
    const size = segment.text.length
    if (current.length > 0 && (chars + size > maxChars || current.length >= maxItems)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(segment)
    chars += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function locate(text, needle, type, guard = insidePseudonym) {
  const spans = []
  let index = text.indexOf(needle)
  while (index !== -1) {
    const start = index
    const end = index + needle.length
    if (boundaryOk(text, start, end, type) && !guard(text, start, end)) {
      spans.push({ start, end })
    }
    index = text.indexOf(needle, index + Math.max(needle.length, 1))
  }
  return spans
}

/**
 * A patient number column that holds a resident ID card number (PID = ID) is
 * the ID card: one pseudonym for one value, and no "spread" warnings when the
 * same number sits in ID_CRD_NO.
 */
/**
 * A person-name column holding an institution ("full_name": "某县人民医院")
 * is a hospital column for that value.
 */
function withEffectiveHint(segment) {
  if ((segment.hint === '姓名' || segment.hint === '医生') && looksLikeInstitution(segment.text)) {
    return { ...segment, hint: '医院' }
  }
  return segment
}

function headerType(hint, value) {
  if (!['病历号', '就诊号', '住院号'].includes(hint)) return hint
  return scan(value).some((entity) => entity.type === '身份证号' && entity.text === value) ? '身份证号' : hint
}

/** `needle` occurs in `text` only inside pseudonym tokens, or is a bare token code. */
export function echoesPseudonym(text, needle, issued) {
  const spans = pseudonymSpans(text, issued)
  if (/^[0-9A-F]{6,8}$/.test(needle) && spans.some((span) => span.token.endsWith(`-${needle}`))) return true
  let index = text.indexOf(needle)
  if (index === -1) return false
  while (index !== -1) {
    const end = index + needle.length
    if (!spans.some((span) => index < span.end && span.start < end)) return false
    index = text.indexOf(needle, index + 1)
  }
  return true
}

/** token => whether `vault` issued it; the lookup set follows the vault. */
function issuedBy(vault) {
  // The vault keeps its pseudonyms indexed (never rebuilt per lookup).
  return (token) => Boolean(vault?.pseudonyms?.has(token))
}

function trimmedSpan(text) {
  const start = text.length - text.trimStart().length
  const end = text.trimEnd().length
  return end > start ? { start, end } : { start: 0, end: text.length }
}

function insidePseudonym(text, start, end) {
  return pseudonymSpans(text).some((span) => start < span.end && span.start < end)
}

function boundaryOk(text, start, end, type) {
  if (!['身份证号', '电话', '银行卡号', '社保号', '病历号', '住院号', '就诊号'].includes(type)) return true
  const before = start > 0 ? text[start - 1] : ''
  const after = end < text.length ? text[end] : ''
  return !/[0-9A-Za-z]/.test(before) && !/[0-9A-Za-z]/.test(after)
}

/**
 * Substring index over many needles: `hits(text)` returns the indices (in
 * input order) of the needles that `text.includes()`, without testing every
 * needle against every text. The batch dictionary reaches tens of thousands
 * of values and documents hundreds of thousands of segments; the plain
 * needles × segments loop blocked the event loop for minutes.
 */
export function substringIndex(needles) {
  // Keyed by the needle's last min(length, 8) code units: identifiers of one
  // region share long prefixes ("330502…"), their endings rarely collide.
  const KEY = 8
  const byLength = new Map() // key length (2..8) → Map(key → needle indices)
  const tiny = [] // length 0–1: checked directly
  const texts = needles.map((needle) => String(needle ?? ''))
  texts.forEach((text, index) => {
    if (text.length < 2) { tiny.push(index); return }
    const width = Math.min(text.length, KEY)
    let map = byLength.get(width)
    if (!map) byLength.set(width, (map = new Map()))
    const key = text.slice(text.length - width)
    const list = map.get(key)
    if (list) list.push(index)
    else map.set(key, [index])
  })
  const widths = [...byLength.keys()].sort((a, b) => a - b)
  return {
    size: texts.length,
    hits(text) {
      const found = new Set()
      for (const index of tiny) if (text.includes(texts[index])) found.add(index)
      // `end`: where the needle would end in `text`.
      for (let end = 2; end <= text.length; end++) {
        for (const width of widths) {
          if (width > end) break
          const list = byLength.get(width).get(text.slice(end - width, end))
          if (!list) continue
          for (const index of list) {
            const needle = texts[index]
            if (!found.has(index) && needle.length <= end && text.startsWith(needle, end - needle.length)) found.add(index)
          }
        }
      }
      return [...found].sort((a, b) => a - b)
    },
  }
}

const codeLikeMemo = new Map()
function codeLike(value) {
  let result = codeLikeMemo.get(value)
  if (result === undefined) {
    if (codeLikeMemo.size > 200_000) codeLikeMemo.clear()
    result = isCodeLike(value)
    codeLikeMemo.set(value, result)
  }
  return result
}

/**
 * Blind-review accounting. items = Σ filtered + unlocated + reported, and
 * reported = confirmed + dismissed + disputed + unjudged.
 */
function blindTotals(run) {
  const blind = run.totals.blind ??= {}
  for (const key of ['calls', 'flaggedCalls', 'items', 'unlocated', 'reported', 'confirmed', 'dismissed', 'disputed', 'unjudged']) blind[key] ??= 0
  blind.filtered ??= {}
  for (const key of Object.keys(FILTER_LABELS)) blind.filtered[key] ??= 0
  return blind
}

// Why a blind-review item was dropped before re-judging (cross-check detail).
const FILTER_LABELS = {
  format: '格式不符',
  pseudonym: '假名片段',
  invalid: '无效条目',
  allowed: '白名单/保留',
}

function containsOriginal(text, original) {
  if (!original || original.length < 2) return false
  if (!codeLike(original)) return text.includes(original)
  // Codes: only a standalone occurrence counts ("01" inside "2001017" is not
  // the identifier "01").
  let index = text.indexOf(original)
  while (index !== -1) {
    if (edgesOk(text, index, index + original.length)) return true
    index = text.indexOf(original, index + 1)
  }
  return false
}

/**
 * Where a blind-review finding is: the segment the reply names when it holds
 * the text, else the other segments of the batch that do (a wrong id), else
 * any segment of the document. A per-field value list stands for its member
 * segments: the finding belongs to the listed values holding it, as a whole
 * value or as a standalone part ("12345678" in "12345678/87654321", never
 * "01" inside "2001017"; any part of a vocabulary value). Null when no exact
 * place exists. `ids`: segments to replace it in next round; `batchIds`:
 * batch segments it was found in; `inBatch`: false when only the document
 * outside the batch holds it.
 */
function placeFinding(batch, current, segmentId, text, vocabField, groups) {
  const holdsIt = (segment) => (vocabField(segment) ? segment.text.includes(text) : segment.text.trim() === text || containsOriginal(segment.text, text))
  const twins = (segment) => groups.find((group) => group[0].id === segment.id) ?? [segment]
  const place = (holders, inBatch) => {
    const ids = new Set()
    const batchIds = new Set()
    let first = null
    for (const holder of holders) {
      const members = holder.members ? holder.members.filter(holdsIt) : inBatch ? twins(holder) : [holder]
      if (members.length === 0) continue
      batchIds.add(holder.id)
      for (const member of members) ids.add(member.id)
      first ??= members[0]
    }
    return first ? { segment: first, ids, batchIds: inBatch ? batchIds : new Set(), inBatch } : null
  }
  const named = batch.find((item) => item.id === segmentId)
  if (named?.text.includes(text)) {
    const found = place([named], true)
    if (found) return found
  }
  const others = batch.filter((item) => item !== named && (item.members ? item.text.includes(text) : containsOriginal(item.text, text) || item.text.trim() === text))
  const inBatch = place(others, true)
  if (inBatch) return inBatch
  const listed = new Set(batch.flatMap((item) => (item.members ? item.members.map((member) => member.id) : twins(item).map((twin) => twin.id))))
  return place(current.filter((segment) => !listed.has(segment.id) && holdsIt(segment)), false)
}

const MAX_HINTS = 60

/**
 * Drop repeated issues. An issue that carries review data stands for one
 * exact original text, and different values can share a masked detail ('**'
 * for every 2-character name), so those are told apart by the text itself
 * (in memory only, never serialized): each flagged value keeps its own
 * review item. Errors and review items are never capped; only hints are.
 */
function dedupeIssues(issues) {
  const seen = new Set()
  const out = []
  for (const issue of issues) {
    const review = issue.review
    const key = typeof review?.text === 'string' && review.text
      ? `${issue.severity}|${issue.code}|${issue.type ?? ''}|${review.field ?? ''}|\u0000${review.text}`
      : `${issue.severity}|${issue.code}|${issue.detail}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(issue)
  }
  // Errors first; every error and review item stays, hints fill the rest.
  const kept = out.filter((issue) => issue.severity === 'error' || issue.review)
  const hints = out.filter((issue) => !(issue.severity === 'error' || issue.review))
  return [...kept, ...hints.slice(0, Math.max(0, MAX_HINTS - kept.length))]
}

function maskForReport(value) {
  const text = String(value)
  if (text.length <= 4) return '*'.repeat(text.length)
  return `${text.slice(0, 2)}${'*'.repeat(Math.min(6, text.length - 2))}`
}

/**
 * Error text for report-bound places (issue details, run.error, warnings).
 * Raw messages can quote the source (V8's JSON.parse shows the input around
 * the error), carry an endpoint's error body, or name absolute paths whose
 * folders hold patient names: only a category, a position or our own fixed
 * wording is kept.
 */
export function describeError(error) {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error !== 'object') return scrubMessage(String(error))
  const code = typeof error.code === 'string' ? error.code : ''
  if (error.name === 'LlmError') {
    if (code === 'http-error') return `模型端点返回 HTTP ${error.status ?? '错误'}`
    if (code === 'network') return '无法连接模型端点'
    return scrubMessage(String(error.message ?? code))
  }
  if (/^E[A-Z0-9_]+$/.test(code) && (error.syscall || error.path || typeof error.errno === 'number')) {
    return `文件系统错误 ${code}${error.syscall ? `（${error.syscall}）` : ''}`
  }
  const message = String(error.message ?? '')
  if (error instanceof SyntaxError || error.name === 'SyntaxError') {
    const line = /line (\d+) column (\d+)/.exec(message)
    const position = /position (\d+)/.exec(message)
    const where = line ? `，第 ${line[1]} 行第 ${line[2]} 列` : position ? `，位置 ${position[1]}` : /end of/i.test(message) ? '，内容不完整' : ''
    return `格式错误，无法解析${where}`
  }
  return scrubMessage(message || String(error))
}

/** Our own messages are kept; anything quoted and any absolute path is not. */
function scrubMessage(text) {
  let out = String(text).split(/["'`“”‘’「」]/)[0]
  out = out.replace(/(^|[\s:：(（=,，])(?:[A-Za-z]:)?[\\/][^\s,，;；)）]*/g, '$1<路径>')
  out = out.trim().replace(/[\s:：,，(（]+$/, '')
  if (!out) return '未知错误'
  return out.length > 200 ? `${out.slice(0, 200)}…` : out
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Report-bound text scrubber: every known original (`[original, shown]`
 * pairs: a file's replacements, values other files of the batch found) is
 * replaced by what a report may show for it. Longest match first; codes only
 * where they stand alone. Indexed by the first two characters, so the cost
 * follows the text scrubbed, not the number of values.
 */
function knownScrubber(pairs) {
  const byPrefix = new Map()
  const seen = new Set()
  for (const [original, shown] of pairs) {
    if (typeof original !== 'string' || seen.has(original) || !expandable(original) || isPseudonym(original)) continue
    seen.add(original)
    const key = original.slice(0, 2)
    const list = byPrefix.get(key) ?? []
    list.push({ original, shown: String(shown ?? maskForReport(original)), code: isCodeLike(original) })
    byPrefix.set(key, list)
  }
  if (seen.size === 0) return (text) => text
  for (const list of byPrefix.values()) list.sort((a, b) => b.original.length - a.original.length)
  const longest = Math.max(...[...byPrefix.values()].map((list) => list[0].original.length))
  // Text cut short ("…与患者张三…"): the start of a known value right before
  // the ellipsis is that value too.
  const cutTails = (text) => {
    let out = text
    for (let k = out.lastIndexOf('…'); k >= 2; k = out.lastIndexOf('…', k - 1)) {
      for (let length = Math.min(longest - 1, k); length >= 2; length -= 1) {
        const part = out.slice(k - length, k)
        const hit = byPrefix.get(part.slice(0, 2))?.find((entry) => entry.original.length > length
          && entry.original.startsWith(part) && (!entry.code || edgesOk(out, k - length, k)))
        if (!hit) continue
        out = out.slice(0, k - length) + hit.shown + out.slice(k)
        k = k - length + hit.shown.length
        break
      }
    }
    return out
  }
  return (text) => {
    if (typeof text !== 'string' || text.length < 2) return text
    let out = ''
    let last = 0
    let i = 0
    while (i < text.length - 1) {
      const hit = byPrefix.get(text.slice(i, i + 2))?.find((entry) => text.startsWith(entry.original, i)
        && (!entry.code || edgesOk(text, i, i + entry.original.length)))
      if (hit) {
        out += text.slice(last, i) + hit.shown
        i += hit.original.length
        last = i
      } else i += 1
    }
    const whole = last === 0 ? text : out + text.slice(last)
    return whole.includes('…') ? cutTails(whole) : whole
  }
}

/** Identifiers the rules see in a label or a model's free text, masked. */
function maskRuleHits(text) {
  if (typeof text !== 'string' || text.length < 2) return text
  const hits = scan(text).filter((entity) => !isPseudonym(entity.text)).sort((a, b) => b.start - a.start)
  let out = text
  let limit = text.length + 1
  for (const hit of hits) {
    if (hit.end > limit) continue // overlaps a longer hit already masked
    out = out.slice(0, hit.start) + maskForReport(hit.text) + out.slice(hit.end)
    limit = hit.start
  }
  return out
}

/**
 * A model's free-text reason in a report-bound detail: the candidate it is
 * about and anything the rules see are masked (known originals are replaced
 * when the file's issues are scrubbed, see scrubFileText).
 */
function reasonForReport(reason, candidate) {
  let text = String(reason ?? '').replace(/[\uE000\uE001]/g, '').trim()
  if (!text) return '未说明'
  if (candidate) text = text.split(candidate).join(maskForReport(candidate))
  text = maskRuleHits(text)
  // Cut only after the known originals are replaced (scrubFileText): a name
  // crossing the cut would leave a fragment no scrub can match.
  return text.length > REASON_SHOWN ? `\uE000${text}\uE001` : text
}

const REASON_SHOWN = 60

/** Long reasons marked by reasonForReport, cut to their shown length. */
function clipReasons(text) {
  if (typeof text !== 'string' || !text.includes('\uE000')) return text
  return text.replace(/\uE000([^\uE001]*)\uE001?/g, (_, body) => (body.length > REASON_SHOWN ? `${body.slice(0, REASON_SHOWN)}…` : body))
}

/**
 * Field labels and details that leave the 0600 review records (report.json,
 * report.md, the page, the agent's tools): a label that is itself an
 * identifier (a header cell holding a name or an ID, a key that is a record
 * number) is shown with that part masked or as its pseudonym, and known
 * originals anywhere in a detail are replaced. The review data
 * (non-enumerable `review`) keeps the original label.
 */
function scrubFileText(run, file, scrub, labels = []) {
  const all = new Set(labels.filter((label) => typeof label === 'string' && label))
  for (const issue of file.issues ?? []) for (const field of issue.fields ?? []) if (typeof field === 'string') all.add(field)
  for (const field of Object.keys(file.profiles ?? {})) all.add(field)
  for (const field of Object.keys(run?.profileSummary ?? {})) all.add(field)
  const swaps = new Map()
  for (const label of all) {
    const shown = maskRuleHits(scrub(label))
    if (shown !== label) swaps.set(label, shown)
  }
  const pattern = swaps.size > 0
    ? new RegExp([...swaps.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|'), 'g')
    : null
  const fix = (text) => {
    if (typeof text !== 'string' || !text) return text
    return clipReasons(scrub(pattern ? text.replace(pattern, (label) => swaps.get(label)) : text))
  }
  for (const issue of file.issues ?? []) {
    issue.detail = fix(issue.detail)
    if (Array.isArray(issue.fields)) issue.fields = issue.fields.map(fix)
  }
  if (file.profiles) file.profiles = Object.fromEntries(Object.entries(file.profiles).map(([field, value]) => [fix(field), value]))
  if (run?.profileSummary && pattern) {
    const summary = {}
    for (const [field, entry] of Object.entries(run.profileSummary)) {
      const next = fix(field)
      if (next !== field && entry && typeof entry === 'object') entry.field = next
      const existing = summary[next]
      if (existing && existing !== entry && entry && typeof entry === 'object') {
        existing.files += entry.files ?? 0
        existing.distinct = Math.max(existing.distinct ?? 0, entry.distinct ?? 0)
      } else summary[next] = entry
    }
    run.profileSummary = summary
  }
  return fix
}

function safeStructure(doc) {
  try {
    return doc.structure()
  } catch (error) {
    return { ok: false, checks: [{ name: '结构校验', ok: false, detail: describeError(error) }] }
  }
}

/**
 * A long string with no spaces, no CJK, made only of encoding characters:
 * ciphertext, an unknown encoding, a token. Readable text never looks so.
 */
function looksUnreadable(text) {
  const value = String(text).trim()
  if (value.length < 64) return false
  if (/[\s\u4e00-\u9fff]/.test(value)) return false
  if (!/^[A-Za-z0-9+/=_\-:.]+$/.test(value)) return false
  if (!/\d/.test(value) || !/[A-Za-z]/.test(value)) return false
  if (/^(?:https?|ftp):/i.test(value) || isPseudonym(value)) return false
  if (isCodeList(value)) return false // codes joined by + / , ; |
  if (/^[\w.-]+(?:\/[\w.-]+)+$/.test(value) && /\.[a-z]{2,4}$/i.test(value)) return false // a file path
  return new Set(value).size >= 12
}

/** Expected reply shapes; anything else is "bad-shape" (retried, then split). */
const SHAPES = {
  detect: (json) => Boolean(json) && (Array.isArray(json.e) || Array.isArray(json.entities)),
  verify: (json) => Boolean(json) && Array.isArray(json.issues),
  verdicts: (json) => Boolean(json) && Array.isArray(json.verdicts),
  fields: (json) => Boolean(json) && Array.isArray(json.fields),
}

/** A settled fan-out result: the reply, or the error rethrown. */
function settled(result) {
  if (result.error) throw result.error
  return result.reply
}

/**
 * At most `limit` requests in flight per model, shared by every file of the
 * batch. With a separate verification model each has its own slots, so
 * detection on one file and verification on another run at the same time.
 */
function limitRequests(llm, limit, stats = null) {
  if (!llm) return null
  let active = 0
  const queue = []
  const show = () => { if (stats) { stats.active = active; stats.queued = queue.length; stats.limit = limit } }
  // A slot is handed to the next waiter here (active counted for it), so a
  // lowered limit simply stops handing out slots until enough calls finish.
  const grant = () => {
    while (queue.length > 0 && active < limit) {
      active += 1
      queue.shift()()
    }
    show()
  }
  show()
  return Object.assign(Object.create(Object.getPrototypeOf(llm)), llm, {
    /** Change the number of slots while the batch runs (auto concurrency). */
    setLimit(next) {
      limit = Math.max(1, Math.round(Number(next) || 1))
      grant()
    },
    async chatJson(messages, opts = {}) {
      if (active < limit && queue.length === 0) active += 1
      else {
        const wait = new Promise((resolve) => queue.push(resolve))
        show()
        await wait
      }
      show()
      try {
        if (opts.signal?.aborted) throw Object.assign(new Error('已取消'), { code: 'aborted' })
        opts.onSlot?.()
        const { onSlot, ...rest } = opts
        return await llm.chatJson(messages, rest)
      } finally {
        active -= 1
        grant()
      }
    },
  })
}

/**
 * Automatic concurrency for one model: a search for the highest throughput.
 * Throughput is tokens per second (input + output of completed calls) over a
 * window. Windows in which the slots were not kept full measure the supply of
 * work, not the concurrency, so they never decide a step. Each window:
 *  - errors (timeouts, connection or server errors) ≥ 5 %: down by a quarter,
 *    the old level becomes a ceiling for ten minutes;
 *  - after a step up: keep it only if throughput rose by 5 %, otherwise go
 *    back and make the higher level a ceiling;
 *  - after a step down: keep it if throughput stayed within 5 %, otherwise go
 *    back up;
 *  - inference server queueing or KV cache nearly full (vLLM /metrics): no
 *    higher (ceiling) and try one step down — more slots would only wait on
 *    the server; the step down is kept only if throughput holds;
 *  - every slot busy with requests waiting: step up by half.
 * It never goes above `max`; with too little traffic it waits.
 */
export function createConcurrencyTuner({ run, key, limiter, stats, max = MAX_CONCURRENCY, windowMs = 30000, now = () => Date.now() }) {
  const state = run.autoTune?.[key] ?? { start: stats.limit, limit: stats.limit, ceiling: null, history: [] }
  run.autoTune ??= {}
  run.autoTune[key] = state
  let samples = 0
  let full = 0 // samples with every slot in use
  let busy = 0 // … and requests waiting for a slot
  let last = null // totals at the previous decision
  let pending = null // { kind: 'up' | 'down', from, thr, waited } a step being judged
  let ceilingUntil = 0
  let windowStart = now()
  const totals = () => {
    const m = run.totals.models?.[key] ?? {}
    const fails = Object.entries(m.fails ?? {}).filter(([code]) => ['timeout', 'network', 'http-error', 'empty-response'].includes(code)).reduce((sum, [, count]) => sum + count, 0)
    return { ok: Number(m.okN ?? 0), io: Number(m.ioTokens ?? 0), fails }
  }
  const change = (to, reason, thr) => {
    const from = state.limit
    to = Math.max(1, Math.min(max, Math.round(to)))
    if (to === from) return false
    state.limit = to
    limiter.setLimit(to)
    state.history.push({ at: new Date(now()).toISOString(), from, to, reason, thr: Math.round(thr) })
    if (state.history.length > 60) state.history.shift()
    return true
  }
  const cap = (t) => {
    state.ceiling = state.limit
    ceilingUntil = t + 10 * 60000
  }
  /** Called every couple of seconds; decides once per window. */
  return function tick() {
    samples += 1
    if (stats.active >= stats.limit) {
      full += 1
      if (stats.queued > 0) busy += 1
    }
    const t = now()
    if (t - windowStart < windowMs) return
    const seconds = (t - windowStart) / 1000
    const cur = totals()
    const base = last ?? { ok: 0, io: 0, fails: 0 }
    const ok = cur.ok - base.ok
    const fails = cur.fails - base.fails
    const thr = cur.io > base.io ? (cur.io - base.io) / seconds : (ok / seconds) * 1000
    const fullShare = samples > 0 ? full / samples : 0
    const busyShare = samples > 0 ? busy / samples : 0
    last = cur
    windowStart = t
    samples = 0
    full = 0
    busy = 0
    state.thr = Math.round(thr)
    if (state.ceiling && t > ceilingUntil) state.ceiling = null
    if (fails > 0 && fails / Math.max(1, ok + fails) >= 0.05) {
      cap(t)
      pending = null
      change(Math.floor(state.limit * 0.75), 'errors', thr)
      return
    }
    if (ok < 3) return // too little traffic to judge
    const saturated = fullShare >= 0.6
    if (pending) {
      if (!saturated) {
        // The slots were not kept full: this window says nothing about the step.
        pending.waited += 1
        if (pending.waited >= 3) pending = null
        return
      }
      const step = pending
      pending = null
      if (step.kind === 'up' && thr < step.thr * 1.05) {
        cap(t)
        change(step.from, 'flat', thr)
        return
      }
      if (step.kind === 'down' && thr < step.thr * 0.95) {
        change(step.from, 'back', thr)
        return
      }
      if (step.kind === 'down') return // same throughput with fewer slots: stay
    }
    const server = run.server?.[key]
    const recent = server?.available ? server.samples.slice(-6) : []
    const waiting = recent.length ? recent.reduce((sum, row) => sum + (row[1] ?? 0), 0) / recent.length : 0
    const kv = recent.length ? Math.max(...recent.map((row) => row[2] ?? 0)) : 0
    if (waiting >= 1 || kv >= 0.92) {
      // The server is full: more slots would only wait there. Try one step
      // down and keep it only if throughput holds.
      cap(t)
      if (saturated && state.limit > 1) {
        pending = { kind: 'down', from: state.limit, thr, waited: 0 }
        change(state.limit - Math.max(1, Math.round(state.limit * 0.15)), 'server', thr)
      }
      return
    }
    const top = Math.min(max, state.ceiling ? state.ceiling - 1 : max)
    if (saturated && busyShare >= 0.6 && state.limit < top) {
      pending = { kind: 'up', from: state.limit, thr, waited: 0 }
      change(Math.min(top, state.limit + Math.max(1, Math.round(state.limit * 0.5))), 'up', thr)
    }
  }
}

/** The request limiter, for tests. */
export const limitRequestsForTest = (llm, limit, stats) => limitRequests(llm, limit, stats)

const CROSS_LIMIT = 20000
const COMPARE_MAX_BYTES = 50_000_000
const COMPARE_MAX_CHANGES = 50000
// Flagged rows kept beyond COMPARE_MAX_CHANGES (bounded: a short flagged
// text can occur in many rows).
const COMPARE_MAX_FLAGGED_EXTRA = 2000

/**
 * compare/index.json lists files; compare/<n>.json holds one file's changed
 * segments ({ field, before, after }). Skipped for oversized files.
 */
async function writeCompare({ items, results, outputDir, store, runId }) {
  const byRel = new Map(results.map((file) => [file.relPath, file]))
  const index = []
  let n = 0
  for (const item of items) {
    const file = byRel.get(item.outRel)
    if (!file || file.status === 'failed' || file.status === 'cancelled') continue
    const entry = { n, relPath: item.outRel, status: file.status, changed: 0, total: 0 }
    try {
      const size = (await stat(item.path)).size
      if (size > COMPARE_MAX_BYTES) {
        entry.skipped = 'too-large'
      } else {
        const before = layered(await loadDocument(item.path, item.outRel))
        const after = layered(await loadDocument(join(outputDir, item.outRel), item.outRel))
        const units = (doc) => (doc.kind === 'text'
          ? doc.leaves()[0].text.split('\n').map((text, index) => ({ id: `L${index + 1}`, field: `第 ${index + 1} 行`, text }))
          : doc.leaves().map((leaf) => ({ id: leaf.key, field: leaf.via ? `${leaf.field ?? '—'} · ${leaf.via}` : leaf.field, text: leaf.text })))
        const afterText = new Map(units(after).map((unit) => [unit.id, unit.text]))
        const changes = []
        const segments = units(before)
        entry.total = segments.length
        // Segments still holding text flagged for review are listed too, so
        // the comparison shows them even when nothing was replaced there.
        // Every segment is recorded, changed or not, so a reviewer can spot-
        // check what was left as is. Unchanged rows store the text once.
        const flagged = (file.issues ?? []).map((issue) => issue.review?.text).filter(Boolean)
        let extra = 0
        for (const [position, segment] of segments.entries()) {
          const next = afterText.get(segment.id)
          if (next === undefined) continue
          const changed = next !== segment.text
          const flag = flagged.some((text) => next.includes(text))
          if (changed) entry.changed += 1
          // Rows flagged for review are kept past the cap, so every review
          // item can be found in the comparison however long the file is.
          const room = changes.length < COMPARE_MAX_CHANGES || (flag && extra < COMPARE_MAX_FLAGGED_EXTRA)
          if (room && changes.length >= COMPARE_MAX_CHANGES) extra += 1
          if (room) {
            changes.push(changed
              // `i`: the segment's place in the file (shown as the row number).
              ? { id: segment.id, i: position + 1, field: segment.field ?? null, before: segment.text, after: next, ...(flag ? { flagged: true } : {}) }
              : { id: segment.id, i: position + 1, field: segment.field ?? null, before: segment.text, same: true, ...(flag ? { flagged: true } : {}) })
          }
        }
        if (segments.length > changes.length) entry.truncated = changes.length
        // Stored now, one file at a time: the batch never holds every file's rows.
        await store.putCompareFile(runId, entry, changes)
      }
    } catch (error) {
      entry.skipped = 'error'
    }
    if (entry.skipped) await store.putCompareFile(runId, entry, [])
    index.push(entry)
    n += 1
  }
  await store.finishCompare(runId)
}

const CALL_LOG_LIMIT = 20000

/** Append to the run's model-call log (non-enumerable: kept out of report.json). */
function recordCall(run, entry) {
  if (!run.callLog) {
    Object.defineProperty(run, 'callLog', { value: [], enumerable: false, writable: true })
    Object.defineProperty(run, 'callSeq', { value: 0, enumerable: false, writable: true })
  }
  run.callSeq += 1
  entry.seq = run.callSeq
  run.callLog.push(entry)
  if (run.callLog.length > CALL_LOG_LIMIT) run.callLog.splice(0, run.callLog.length - CALL_LOG_LIMIT)
}

/**
 * Model speed. Short JSON replies make "output tokens ÷ duration" mostly a
 * measure of prompt processing, so the page fits duration = c + in/P + out/D
 * by least squares over all calls and reports D (generation tok/s) and P
 * (prompt tok/s). Only the running sums are kept here.
 */
function recordSpeed(run, entry) {
  run.totals.outTokens = (run.totals.outTokens ?? 0) + entry.out
  run.totals.outMs = (run.totals.outMs ?? 0) + entry.ms
  const f = run.totals.speedFit ?? { n: 0, a: 0, b: 0, y: 0, aa: 0, bb: 0, ab: 0, ay: 0, by: 0 }
  const x1 = entry.in || 0
  const x2 = entry.out || 0
  const y = entry.ms
  f.n += 1; f.a += x1; f.b += x2; f.y += y
  f.aa += x1 * x1; f.bb += x2 * x2; f.ab += x1 * x2; f.ay += x1 * y; f.by += x2 * y
  run.totals.speedFit = f
}

function recordModel(run, key, entry) {
  const models = run.totals.models ??= {}
  const m = models[key] ??= { calls: 0, tokens: 0, ctxN: 0, ctxSum: 0, ctxMax: 0, fit: { n: 0, a: 0, b: 0, y: 0, aa: 0, bb: 0, ab: 0, ay: 0, by: 0 } }
  m.calls += 1
  if (Number(entry.attempts) > 1) m.retries = (m.retries ?? 0) + entry.attempts - 1
  if (entry.result !== 'ok') {
    // Failures by kind (cancelled calls are not the model's fault).
    if (entry.result !== 'cancelled') {
      m.fails ??= {}
      m.fails[entry.result] = (m.fails[entry.result] ?? 0) + 1
    }
    return
  }
  m.tokens += entry.tokens || 0
  // Per-call averages: output tokens and time (queueing excluded).
  m.okN = (m.okN ?? 0) + 1
  m.msSum = (m.msSum ?? 0) + (entry.ms || 0)
  m.outSum = (m.outSum ?? 0) + (entry.out || 0)
  const ctx = (entry.in || 0) + (entry.out || 0)
  // Processing speed = (input + output tokens) / call time, over all calls.
  if (ctx > 0 && entry.ms > 0) {
    m.ioTokens = (m.ioTokens ?? 0) + ctx
    m.ioMs = (m.ioMs ?? 0) + entry.ms
  }
  if (ctx > 0) {
    // Context histogram: <0.5k, <1k, <2k, <4k, <8k, <16k, ≥16k tokens.
    const bucket = [500, 1000, 2000, 4000, 8000, 16000].findIndex((limit) => ctx < limit)
    m.ctxHist ??= [0, 0, 0, 0, 0, 0, 0]
    m.ctxHist[bucket === -1 ? 6 : bucket] += 1
    m.ctxN += 1
    m.ctxSum += ctx
    m.ctxMax = Math.max(m.ctxMax, ctx)
  }
  if (entry.out > 0) {
    const f = m.fit
    const x1 = entry.in || 0
    const x2 = entry.out
    const y = entry.ms
    f.n += 1; f.a += x1; f.b += x2; f.y += y
    f.aa += x1 * x1; f.bb += x2 * x2; f.ab += x1 * x2; f.ay += x1 * y; f.by += x2 * y
  }
}

let versionCache = null
async function pluginVersion() {
  versionCache ??= readFile(new URL('../package.json', import.meta.url), 'utf8')
    .then((text) => JSON.parse(text).version ?? '?', () => '?')
  return versionCache
}

const MAX_CONCURRENCY = 64
const MAX_FILE_SLOTS = 64
const SERVER_SAMPLE_MS = 5000

/**
 * Inference-server load from a vLLM-style Prometheus endpoint
 * (`<server>/metrics`): requests running and waiting on the server, KV-cache
 * use and the server's generation rate (all clients). Read only; no key or
 * patient data is sent. Unavailable after three failures: then the page
 * falls back to the plugin's own counts.
 */
function createServerProbe(run, key, baseURL, model) {
  const url = `${String(baseURL).replace(/\/+$/, '').replace(/\/v1$/, '')}/metrics`
  let failures = 0
  let busy = false
  let lastGen = null
  return async () => {
    if (busy || failures >= 3) return
    busy = true
    const server = run.server ??= {}
    const entry = server[key] ??= { available: null, samples: [], peakRunning: 0, peakWaiting: 0, peakKv: 0 }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      let text
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        text = await response.text()
      } finally { clearTimeout(timer) }
      const read = parseServerMetrics(text, model)
      if (!read) throw new Error('no vllm metrics')
      const at = Date.now()
      let genRate = null
      if (lastGen && read.generated >= lastGen.value && at > lastGen.at) genRate = ((read.generated - lastGen.value) / (at - lastGen.at)) * 1000
      if (read.generated !== null) lastGen = { value: read.generated, at }
      failures = 0
      Object.assign(entry, { available: true, running: read.running, waiting: read.waiting, kv: read.kv, genRate, at })
      entry.peakRunning = Math.max(entry.peakRunning, read.running)
      entry.peakWaiting = Math.max(entry.peakWaiting, read.waiting)
      entry.peakKv = Math.max(entry.peakKv, read.kv ?? 0)
      entry.samples.push([read.running, read.waiting, read.kv ?? 0, genRate === null ? null : Math.round(genRate)])
      if (entry.samples.length > 24) entry.samples.shift()
    } catch {
      failures += 1
      if (failures >= 3 && entry.available !== true) entry.available = false
    } finally {
      busy = false
    }
  }
}

/** vLLM gauges for one model (summed over engines); null when absent. */
export function parseServerMetrics(text, model) {
  const values = { running: 0, waiting: 0, kv: null, generated: null }
  let seen = false
  for (const line of String(text ?? '').split('\n')) {
    const match = /^vllm:(num_requests_running|num_requests_waiting|kv_cache_usage_perc|gpu_cache_usage_perc|generation_tokens_total)(\{[^}]*\})?\s+([0-9.eE+-]+)/.exec(line)
    if (!match) continue
    const labels = match[2] ?? ''
    const name = /model_name="([^"]*)"/.exec(labels)?.[1]
    if (model && name && name !== model) continue
    const value = Number(match[3])
    if (!Number.isFinite(value)) continue
    seen = true
    if (match[1] === 'num_requests_running') values.running += value
    else if (match[1] === 'num_requests_waiting') values.waiting += value
    else if (match[1] === 'generation_tokens_total') values.generated = (values.generated ?? 0) + value
    else values.kv = Math.max(values.kv ?? 0, value)
  }
  return seen ? values : null
}

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/** A batch's row in the batch list (records.js runs). */
export function runSummary(run) {
  return {
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    inputDir: run.inputDir,
    files: run.totals?.files ?? 0,
    entities: run.totals?.entities ?? 0,
    unresolved: run.totals?.unresolved ?? 0,
    model: run.config?.model ?? '',
    durationMs: run.durationMs ?? 0,
    output: run.output ?? null,
    source: run.source ?? null,
    resumable: run.resumable === true,
    resumedFrom: run.resumedFrom ?? null,
    resumedBy: run.resumedBy ?? null,
    selection: run.selection ?? null,
    ...(run.heartbeatAt ? { heartbeatAt: run.heartbeatAt } : {}),
  }
}

export function checksum(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}
