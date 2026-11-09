/**
 * Batch orchestrator: rule pre-scan → model discovery → exact-span
 * pseudonymization → model + deterministic verification → bounded repair.
 */
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile, readdir, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { join, relative, dirname, basename, resolve, sep } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { loadDocument, detectKind } from './formats.js'
import { processDicomFile, sniffDicom, dicomPolicy } from './dicom/index.js'
import { scan, scanSuspects, isPseudonym, isKnownType, plausible, isCodeLike, looksLikeInstitution } from './rules.js'
import { detectPrompt, verifyPrompt, adjudicatePrompt, profilePrompt, DETECT_TYPES, entitiesOf } from './llm.js'
import { Vault } from './pseudonym.js'
import { renderMarkdown } from './report.js'
import { extractZip, packDirectory, isZipPath } from './zip.js'
import { createPathAnonymizer } from './paths.js'
import { createWriteGuard, fingerprint, changedSince } from './guard.js'
import { advise } from './advisor.js'
import { createReplayCache, CACHE_FILE } from './replay.js'
import { layout, migrateLegacy, freeName, entries as dirEntries, RECORDS_DIR, isOutputRoot, deliverStaged } from './layout.js'
import { layered } from './layers.js'
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

const PSEUDONYM_TOKEN = /(?:化名|患者|医生|证件|电话|邮箱|地址|病历|住院|就诊|社保|银行卡|医院)-[0-9A-F]{6,10}/g

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
  if (select?.length) {
    // Several entries of one folder chosen together: only those, each named
    // explicitly (so no hidden-file filter on the chosen names themselves).
    for (const name of select) {
      const path = join(root, name)
      const entry = await stat(path).catch(() => null)
      if (entry?.isFile()) await classify(path, name)
      else if (entry?.isDirectory() && !isExcluded(path)) await walk(path)
    }
  } else if (info.isFile()) {
    await classify(root, basename(root))
  } else {
    await walk(root)
  }
  return { files: files.sort(), dicom: dicom.sort(), zips: zips.sort(), unsupported }
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
  async function expand(zipPath, logical, depth) {
    if (depth > MAX_ZIP_DEPTH) {
      run.skipped.unsupported += 1
      run.skipped.unsupportedByExt['.zip（嵌套过深）'] = (run.skipped.unsupportedByExt['.zip（嵌套过深）'] ?? 0) + 1
      return
    }
    const dest = join(stageRoot, String(counter++))
    let listing
    try {
      const result = await extractZip(zipPath, dest, limits)
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
    for (const nested of listing.zips) await expand(nested, logicalOf(nested), depth + 1)
  }
  for (const zip of zips) await expand(zip, posix(relative(inputRoot, zip)) || basename(zip), 1)
  return staged
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

export async function runBatch({
  inputDir,
  outputRoot,
  options = {},
  onEvent = () => {},
  signal,
}) {
  const started = Date.now()
  const runId = options.runId ?? newRunId()
  const maxRounds = clampInt(options.maxRounds, 1, 6, 3)
  // Files per chunk. Larger inputs are split into chunks that share the vault
  // and the batch dictionary; nothing is dropped.
  const maxFiles = clampInt(options.maxFiles, 1, 2000, 200)
  const concurrency = clampInt(options.concurrency, 1, 16, 4)
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
  // Model replies are cached per run so a cancelled/failed batch can resume;
  // a resumed run replays the earlier run's cache (see replay.js).
  const replay = await createReplayCache({ file: join(runDir, CACHE_FILE), sources: options.replaySources ?? [] })
  // Limiter inside the cache: replayed replies need no request slot. Live
  // request counts per model (in flight / waiting) are shown on the page.
  const requestStats = {
    detect: { model: baseLlm?.model ?? '', active: 0, queued: 0, limit: concurrency },
    ...(baseVerifyLlm ? { verify: { model: baseVerifyLlm.model ?? '', active: 0, queued: 0, limit: concurrency } } : {}),
  }
  const llm = replay.wrap(limitRequests(baseLlm, concurrency, requestStats.detect))
  // Verification may use its own model (own slots); the replay cache tells
  // them apart by prompt.
  const verifyLlm = baseVerifyLlm ? replay.wrap(limitRequests(baseVerifyLlm, concurrency, requestStats.verify)) : llm
  const originalInput = resolve(inputDir)
  const vaultPath = paths.vault
  const inputIsFile = (await stat(inputDir)).isFile()
  // Multi-select: inputDir is the common folder, selection the chosen names;
  // each chosen entry is delivered on its own, like a single-file input.
  const selection = Array.isArray(options.selection) && options.selection.length > 0 ? options.selection : null
  const guard = await createWriteGuard({ inputRoots: selection ? selection.map((name) => join(inputDir, name)) : [inputDir], outputRoot })
  await migrateLegacy(outputRoot, guard)

  const vault = new Vault(vaultPath, options.vaultPassphrase ?? '')
  await vault.load()
  vault.runId = runId

  const run = {
    id: runId,
    startedAt: new Date(started).toISOString(),
    finishedAt: null,
    status: 'running',
    inputDir,
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
    paths: { renamed: 0, mapFile: null },
    sourceCheck: null,
    warnings: [],
    files: [],
  }

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
    // Request load per model over time (in flight / queued), for the page's
    // busy chart. Every 2 s; past 360 points every other point is dropped.
    if (run.requests?.detect) {
      const series = run.loadSeries ??= { step: 2000, points: [] }
      const d = run.requests.detect
      const v = run.requests.verify
      series.points.push(v ? [d.active, d.queued, v.active, v.queued] : [d.active, d.queued])
      if (series.points.length > 360) {
        series.points = series.points.filter((_, index) => index % 2 === 0)
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
  const fileSlots = Math.min(32, Math.max(concurrency, concurrency * 3))
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
  let deliverName = basename(resolve(inputDir))

  let listing
  try {
    listing = await listInputFiles(inputDir, { exclude: [outputRoot], select: selection })
    run.skipped.unsupported = listing.unsupported.count
    run.skipped.unsupportedByExt = { ...listing.unsupported.byExt }
  } catch (error) {
    throw new Error(`无法读取输入路径: ${error.message}`)
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
  try {
    run.current = { file: '', round: 0, step: '批次预扫', modelCalls: 0 }
    emit('progress')
    // Seeded over every chunk: names in labelled columns of a later chunk are
    // known before the first file is processed.
    const batchKnown = items.length > 1
      ? await seedBatchKnown(items, filePolicy, maxFileBytes, signal)
      : new Map()
    checkAbort()

    // Output paths are decided once, before any file is written, so every
    // file of one patient folder lands in the same anonymized folder.
    const pathMapper = createPathAnonymizer({ vault, policy, known: [...batchKnown.values()] })
    const allLogical = [...items, ...dicomItems].map((item) => item.relPath)
    for (const archive of staged.archives) allLogical.push(archive.logical)
    const outPath = new Map()
    for (const logical of [...new Set(allLogical)].sort()) outPath.set(logical, pathMapper.map(logical))
    for (const item of [...items, ...dicomItems]) item.outRel = outPath.get(item.relPath)
    // The input's own name ("64_姓名_身份证号.zip", "patient_573453") is shown
    // anonymized in reports and run lists as well.
    const inputName = basename(resolve(inputDir))
    const shownName = outPath.get(inputName) ?? pathMapper.map(inputName)
    if (selection) {
      run.selection = selection.map((name) => outPath.get(name) ?? pathMapper.map(name))
    } else if (shownName !== inputName) {
      run.inputDir = join(dirname(resolve(inputDir)), shownName)
    }
    deliverName = shownName
    run.paths.renamed = pathMapper.prefixes().length
    if (pathMapper.entries().length > 0) {
      // Original ↔ anonymized paths: as sensitive as the vault, never in the report.
      run.paths.mapFile = join(runDir, 'path-map.json')
      await mkdir(runDir, { recursive: true })
      await guard.check(run.paths.mapFile)
      await writeFile(run.paths.mapFile, JSON.stringify({ runId, prefixes: pathMapper.prefixes(), files: pathMapper.entries() }, null, 2), { mode: 0o600 })
      run.warnings.push(`有 ${run.paths.renamed} 个文件名或目录名含标识符，已在输出中替换；原路径对照保存在 ${RECORDS_DIR}/runs/${runId}/path-map.json，与映射库同样敏感。`)
    }

    // Model answers shared by every file of this batch (memory only).
    const memo = baseLlm ? createModelMemo() : null
    // Field profiles shared by files of the same shape (same set of fields).
    const profiles = baseLlm ? new Map() : null
    const processOne = async (item) => {
      checkAbort()
      emit('file-start')
      run.current = { file: item.outRel, round: 0, step: '读取', modelCalls: llmStats.calls }
      run.inflight[item.outRel] = { ...run.current, bytes: sizeOf.get(item) ?? 0, fraction: 0.02 }
      emit('progress')
      const result = await processFile({
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
    const finishChunk = (index) => {
      const task = recheckChain.then(async () => {
        const results = chunkFiles[index]
        if (items.length > 1) {
          checkAbort()
          run.current = { file: '', round: 0, step: chunks.length > 1 ? `批次复扫（第 ${index + 1}/${chunks.length} 组）` : '批次复扫', modelCalls: llmStats.calls }
          emit('progress')
          await recheckBatch({ run, files: results, batchKnown, vault, outputDir, policy: filePolicy, guard })
          await vault.save()
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
    // Cross-chunk pass: identifiers found in later chunks, applied to the
    // already-written outputs of earlier chunks (reloaded one chunk at a time).
    if (chunkFiles.length > 1) {
      for (const [index, results] of chunkFiles.slice(0, -1).entries()) {
        checkAbort()
        run.current = { file: '', round: 0, step: `跨组复扫（第 ${index + 1}/${chunkFiles.length - 1} 组）`, modelCalls: llmStats.calls }
        emit('progress')
        for (const file of results) {
          if (file.status === 'failed' || file.status === 'cancelled') continue
          try {
            file.doc = layered(await loadDocument(join(outputDir, file.relPath), file.relPath))
          } catch { /* the write failed earlier and is already reported */ }
        }
        await recheckBatch({ run, files: results, batchKnown, vault, outputDir, policy: filePolicy, guard })
        for (const file of results) if (file.doc) file.doc = null
        await vault.save()
      }
    }

    // DICOM: metadata only, no model. The salt keeps UIDs stable for this
    // output root; the run key (patient codes) exists only in memory.
    const runKey = randomBytes(32)
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
      await mkdir(runDir, { recursive: true })
      await guard.check(join(runDir, 'review-items.json'))
      await writeFile(join(runDir, 'review-items.json'), JSON.stringify(reviewItems, null, 2), { mode: 0o600 })
    }

    // Side-by-side comparison for the page: every changed segment, original
    // vs. result, per file. Built while sources (archives too) and outputs
    // are still loose; holds original text, so 0600 under the run records.
    checkAbort()
    run.current = { file: '', round: 0, step: '比对记录', modelCalls: llmStats.calls }
    emit('progress')
    await writeCompare({ items, results: run.files, outputDir, runDir, guard })

    // Re-pack each archive's output folder into a zip, innermost first.
    for (const archive of [...staged.archives].sort((a, b) => b.depth - a.depth)) {
      checkAbort()
      const outRel = outPath.get(archive.logical)
      const folder = join(outputDir, outRel)
      run.current = { file: outRel, round: 0, step: '打包', modelCalls: llmStats.calls }
      emit('progress')
      const exists = await stat(folder).then((info) => info.isDirectory(), () => false)
      if (!exists) {
        run.archives.push({ relPath: outRel, files: 0, entries: 0 })
        continue
      }
      const packed = `${folder}.packing-${process.pid}`
      await guard.check(packed)
      await guard.check(folder)
      const entries = await packDirectory(folder, packed)
      await rm(folder, { recursive: true, force: true })
      await rename(packed, folder)
      run.archives.push({ relPath: outRel, files: archive.files, entries })
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
      run.error = String(error?.message ?? error)
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
      run.warnings.push(`交付数据移出失败，结果仍在 ${RECORDS_DIR}/runs/${runId}/output：${error.message}`)
    }
  } else if (run.status === 'review') {
    run.withheld = true
    run.warnings.push(`存在待复核项，交付数据暂扣在 ${RECORDS_DIR}/runs/${runId}/output，未放到输出根目录；在「结果比对」中处理完全部复核项后自动交付。`)
  } else if ((await dirEntries(outputDir)).length > 0) {
    run.warnings.push(`批次未完成，部分结果保留在 ${RECORDS_DIR}/runs/${runId}/output，未放到输出根目录。`)
  }

  clearInterval(memoryTimer)
  sampleMemory()
  run.current = null
  run.inflight = {}
  run.finishedAt = new Date().toISOString()
  run.totals.modelCalls = llmStats.calls
  run.totals.tokens = llmStats.tokens
  run.totals.newMappings = vault.countRun(runId)
  run.totals.distinctIds = vault.countUsed()
  run.durationMs = Date.now() - started
  run.vaultPath = vaultPath

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
      await mkdir(runDir, { recursive: true })
      await guard.check(join(runDir, 'advice.json'))
      await writeFile(join(runDir, 'advice.json'), JSON.stringify({ runId, ...advice }, null, 2), { mode: 0o600 })
      run.advice = {
        suggestions: advice.suggestions.map((item) => ({ id: item.id, level: item.level, title: item.title })),
        findings: advice.findings.length,
      }
    }
  } catch (error) {
    run.warnings.push(`改进建议生成失败：${error.message}`)
  }

  await vault.save()
  await mkdir(runDir, { recursive: true })
  // Finished: the reply cache is no longer needed (it quotes originals).
  // Cancelled/failed: keep it, plus what a resume needs to find the input.
  await replay.flush()
  if (options.resumeFrom) {
    run.resumedFrom = options.resumeFrom
    if (options.resumeModel !== undefined) run.resumedFromModel = options.resumeModel
  }
  if (run.status === 'completed' || run.status === 'review') {
    await replay.remove()
    run.resumable = false
  } else {
    await guard.check(join(runDir, 'resume.json'))
    await writeFile(join(runDir, 'resume.json'), JSON.stringify({ inputDir: originalInput, ...(selection ? { selection } : {}), outputRoot: resolve(outputRoot), model: run.config.model ?? '' }, null, 2), { mode: 0o600 })
    run.resumable = true
  }
  if (run.callLog?.length) {
    await writeFile(join(runDir, 'calls.json'), JSON.stringify(run.callLog), { mode: 0o600 })
  }
  await writeFile(join(runDir, 'report.json'), JSON.stringify(run, null, 2), { mode: 0o600 })
  await writeFile(join(runDir, 'report.md'), renderMarkdown(run), { mode: 0o600 })
  await updateIndex(outputRoot, run)
  emit('done')
  return run
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
  const guard = (text, start, end) => insideProtected(text, start, end, produced)
  const protectedText = (text) => isPseudonym(text) || isProtectedText(text, produced)
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
    file.issues.push({ severity: 'error', code: 'load', detail: String(error.message ?? error) })
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
  // never costs findings. `key` is the reply's list field.
  const splitting = async (batch, call, key) => {
    try {
      return await call(batch)
    } catch (error) {
      const retriable = error?.code === 'bad-json' || error?.code === 'bad-shape' || (error?.code === 'aborted' && !signal?.aborted)
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
      file.issues.push({ severity: 'warn', code: 'profile', detail: `字段画像失败，按逐值方式处理：${String(error?.message ?? error)}` })
    }
  }

  try {
    for (let round = 1; round <= maxRounds; round += 1) {
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
      for (const known of batchKnown?.values() ?? []) {
        if (kept(known.type) || allowed(known.text)) continue
        for (const segment of segments) {
          if (hinted.has(segment.id) || !segment.text.includes(known.text)) continue
          for (const span of locate(segment.text, known.text, known.type, guard)) {
            if (!edgesOk(segment.text, span.start, span.end)) continue
            detections.push({ id: segment.id, type: known.type, text: known.text, ...span, source: 'batch' })
          }
        }
      }
      // 1. Rules always run on un-hinted segments; cheap and deterministic.
      for (const segment of segments) {
        if (hinted.has(segment.id)) continue
        for (const entity of scan(segment.text, { landline: policy?.landline })) {
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
        const blind = run.totals.blind ??= { reported: 0, confirmed: 0, dismissed: 0, disputed: 0, unjudged: 0, calls: 0, flaggedCalls: 0 }
        carryOver = carryOver.filter((residual, index) => {
          const verdict = verdicts.get(index)
          if (verdict && verdict.identifier === false) {
            disputed.set(`${residual.type}|${residual.text}`, { ...residual, reason: String(verdict.reason ?? '').slice(0, 120), escalated: false })
            blind.dismissed += 1
            return false
          }
          blind.confirmed += 1
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
            parseErrors.push(String(error?.message ?? error))
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
            if (!echoesPseudonym(segment.text, text)) {
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
      for (const [key, item] of originals) {
        if (!expandable(item.text)) continue
        const hits = new Set()
        for (const segment of segments) {
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
        if (strategy !== 'pseudonym') produced.add(pseudonym)
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
        for (const residue of scan(segment.text, { landline: policy?.landline })) {
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
        issues.push({ severity: 'error', code: 'embedded', detail: `假名 ${token} 嵌在更长的字母/数字串中，原值的一部分被误替换（${ids.size} 处，字段：${fieldsLabel(ids)}）` })
      }
      // Structured values that were numbers/dates must either stay intact or
      // be replaced as a whole.
      if (structured) {
        const partial = new Set()
        for (const segment of current) {
          const before = originalTexts.get(segment.id)
          if (before === undefined || before === segment.text) continue
          if (NUMERIC_VALUE.test(before) && !protectedText(segment.text)) partial.add(segment.id)
        }
        if (partial.size > 0) {
          issues.push({ severity: 'error', code: 'partial', detail: `${partial.size} 个数字/日期值被部分替换（字段：${fieldsLabel(partial)}）` })
        }
      }
      for (const [original, pending] of pendingOriginals) {
        // Short codes are replaced only where they were detected; elsewhere
        // the same digits are a different value and must stay.
        const scope = pending.expandable ? current : current.filter((segment) => pending.ids.has(segment.id))
        const left = new Set(scope.filter((segment) => containsOriginal(segment.text, original)).map((segment) => segment.id))
        if (left.size > 0) {
          const first = scope.find((segment) => left.has(segment.id))
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
              const counted = run.totals.blind ??= { reported: 0, confirmed: 0, dismissed: 0, disputed: 0, unjudged: 0, calls: 0, flaggedCalls: 0 }
              counted.calls = (counted.calls ?? 0) + 1
              if ((reply.json?.issues ?? []).length > 0) counted.flaggedCalls = (counted.flaggedCalls ?? 0) + 1
            }
            // Remember what came back clean. Any finding on a segment (or
            // inside a listed value) keeps it out of the memo.
            if (memo && Array.isArray(reply.json?.issues)) {
              const flagged = new Map()
              for (const issue of reply.json.issues) {
                const list = flagged.get(issue?.segment) ?? []
                list.push(String(issue?.text ?? '').trim())
                flagged.set(issue?.segment, list)
              }
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
            for (const issue of reply.json?.issues ?? []) {
              const text = String(issue?.text ?? '').trim()
              if (!text || protectedText(text) || allowed(text)) continue
              if (!isKnownType(issue?.type)) { dropItems(reply.entry, '盲审'); continue }
              if (kept(issue.type)) continue
              let segment = batch.find((item) => item.id === issue.segment)
              if (!segment || !segment.text.includes(text)) { dropItems(reply.entry, '盲审'); continue }
              // A per-field value list: the finding belongs to the segments
              // holding exactly that value.
              let memberIds = null
              if (segment.members) {
                // Numbers must match a whole value; in a vocabulary list the
                // finding may be part of a value ("王建军医生组").
                const members = segment.members.filter((member) => (vocabField(member) ? member.text.includes(text) : member.text.trim() === text))
                if (members.length === 0) continue
                memberIds = new Set(members.map((member) => member.id))
                segment = members[0]
              }
              const reason = plausible(issue.type, text, 'llm')
              if (reason) {
                reject(issue.type, text, reason, 'llm', segment.id)
                continue
              }
              const blindStats = run.totals.blind ??= { reported: 0, confirmed: 0, dismissed: 0, disputed: 0, unjudged: 0, calls: 0, flaggedCalls: 0 }
              blindStats.reported += 1
              const dispute = disputed.get(`${issue.type}|${text}`)
              if (dispute) {
                // Verifier insists, detection model disagrees: a human decides.
                dispute.escalated = true
                blindStats.disputed += 1
                modelIssues.push(attach({ severity: 'error', code: 'disputed', type: issue.type, fields: [segment.field ?? '正文'], detail: `核验与识别意见不一致：${issue.type} ${maskForReport(text)}${fieldSuffix(segment.field)}（识别模型认为不是标识符：${dispute.reason || '未说明'}）` }, text, segment.text, segment.field))
                continue
              }
              if (text.length >= 2 && !BARE_LABELS.has(text)) {
                const ids = memberIds ?? new Set((groups.find((group) => group[0].id === segment.id) ?? [segment]).map((item) => item.id))
                carryOver.push({ type: issue.type, text, ids, field: segment.field ?? null, context: segment.text, reason: String(issue?.reason ?? '').slice(0, 120) })
              } else {
                // Too short to re-judge: straight to manual review.
                blindStats.unjudged = (blindStats.unjudged ?? 0) + 1
              }
              modelIssues.push(attach({ severity: 'error', code: 'model-residual', type: issue.type, fields: [segment.field ?? '正文'], detail: `独立盲审报出：${issue.type} ${maskForReport(text)}${fieldSuffix(segment.field)}` }, text, segment.text, segment.field))
            }
          } catch (error) {
            if (error?.code === 'aborted' || signal?.aborted) throw new Error('已取消')
            // Not reviewed: a person has to check these segments.
            issues.push({ severity: 'error', code: 'model-unchecked', detail: `盲审调用失败（${String(error?.message ?? error)}），${batch.length} 段未经独立盲审` })
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
      const counted = run.totals.blind ??= { reported: 0, confirmed: 0, dismissed: 0, disputed: 0, unjudged: 0, calls: 0, flaggedCalls: 0 }
      counted.unjudged = (counted.unjudged ?? 0) + carryOver.length
    }
  } catch (error) {
    if (String(error?.message) === '已取消') {
      file.status = 'cancelled'
      file.durationMs = Date.now() - started
      return file
    }
    file.issues.push({ severity: 'error', code: 'pipeline', detail: String(error?.message ?? error) })
  }

  // Review aids: what was deliberately not replaced, and what spread widely.
  const notes = []
  for (const item of disputed.values()) {
    if (item.escalated) continue
    notes.push({ severity: 'warn', code: 'verify-dismissed', type: item.type, fields: [item.field ?? '正文'], detail: `核验报出、识别模型判定不是标识符，未替换：${item.type} ${maskForReport(item.text)}（${item.reason || '未说明'}）` })
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
    } catch (error) {
      file.issues.push({ severity: 'error', code: 'opaque-check', detail: `无法检查的内容核查失败：${String(error?.message ?? error)}` })
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
      file.issues.push({ severity: 'error', code: 'quasi', detail: `准标识符处理失败：${String(error?.message ?? error)}` })
    }
  }

  file.entities = [...usedTypes.values()]
    .map((entry) => ({ type: entry.type, pseudonym: entry.pseudonym, count: entry.count, sources: [...entry.sources] }))
    .sort((a, b) => b.count - a.count)
  const errors = file.issues.filter((issue) => issue.severity === 'error')
  file.status = errors.length > 0 ? 'review' : 'clean'
  file.durationMs = Date.now() - started

  // Hidden from report.json (non-enumerable): original values this file
  // contributed to the batch dictionary, and the live document for the
  // cross-file re-check after all files are done.
  const found = [...pendingOriginals]
    .filter(([, pending]) => pending.strategy === 'pseudonym')
    .map(([text, pending]) => ({ type: pending.type, text }))
  Object.defineProperty(file, 'found', { value: found, enumerable: false })
  Object.defineProperty(file, 'doc', { value: doc, enumerable: false, writable: true })

  await writeOutput(file, doc, outputDir, relPath, writeGuard)
  return file
}

async function writeOutput(file, doc, outputDir, relPath, guard) {
  try {
    const target = resolve(outputDir, relPath)
    if (!target.startsWith(resolve(outputDir) + sep)) throw new Error('输出路径越界')
    if (guard) await guard.check(target)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, doc.serialize(), { mode: 0o600 })
  } catch (error) {
    file.status = 'failed'
    file.issues.push({ severity: 'error', code: 'write', detail: String(error?.message ?? error) })
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
 * Final cross-file pass: replace identifiers that another file revealed after
 * this one was processed (a name the model found in file 9 that also sits in
 * an unlabelled field of file 2).
 */
async function recheckBatch({ run, files = run.files, batchKnown, vault, outputDir, policy, guard }) {
  const kept = (type) => (policy?.identifiers?.[type] ?? 'pseudonym') === 'keep'
  const known = [...batchKnown.values()].filter((item) => !kept(item.type))
    .sort((a, b) => b.text.length - a.text.length)
  for (const file of files) {
    const doc = file.doc
    if (!doc || file.status === 'failed' || file.status === 'cancelled') continue
    const replacements = []
    const counts = new Map()
    for (const segment of doc.segments()) {
      if (fieldSkipped(segment.field, policy.skipFields)) continue
      const taken = []
      for (const item of known) {
        if (!segment.text.includes(item.text)) continue
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
    if (replacements.length === 0) continue
    const wasClean = file.status !== 'review'
    const errorsBefore = file.issues.filter((issue) => issue.severity === 'error').length
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
    const errors = file.issues.filter((issue) => issue.severity === 'error').length
    run.totals.unresolved += errors - errorsBefore
    if (file.status === 'review' && wasClean) run.totals.filesReview += 1
    run.totals.entities += applied
    for (const entry of counts.values()) run.totals.byType[entry.type] = (run.totals.byType[entry.type] ?? 0) + entry.count
    await writeOutput(file, doc, outputDir, file.relPath, guard)
  }
}

// Values that are entirely numbers/dates/times: never sent to the model (rules
// cover IDs and phones there), and never allowed to be partially rewritten.
const NUMERIC_VALUE = /^[\d\s:.,/+\-TZ]+$/

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
  for (const match of text.matchAll(TOKEN_RE)) {
    if (!known.has(match[0])) continue
    const start = match.index
    const end = start + match[0].length
    const glued = (start > 0 && /[0-9A-Za-z]/.test(text[start - 1])) || (end < text.length && /[0-9A-Za-z]/.test(text[end]))
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
export function echoesPseudonym(text, needle) {
  if (/^[0-9A-F]{6,10}$/.test(needle) && text.includes(`-${needle}`)) return true
  let index = text.indexOf(needle)
  if (index === -1) return false
  while (index !== -1) {
    if (!insidePseudonym(text, index, index + needle.length)) return false
    index = text.indexOf(needle, index + 1)
  }
  return true
}

function trimmedSpan(text) {
  const start = text.length - text.trimStart().length
  const end = text.trimEnd().length
  return end > start ? { start, end } : { start: 0, end: text.length }
}

function insidePseudonym(text, start, end) {
  for (const match of text.matchAll(PSEUDONYM_TOKEN)) {
    const tokenStart = match.index
    const tokenEnd = tokenStart + match[0].length
    if (start < tokenEnd && tokenStart < end) return true
  }
  return false
}

function boundaryOk(text, start, end, type) {
  if (!['身份证号', '电话', '银行卡号', '社保号', '病历号', '住院号', '就诊号'].includes(type)) return true
  const before = start > 0 ? text[start - 1] : ''
  const after = end < text.length ? text[end] : ''
  return !/[0-9A-Za-z]/.test(before) && !/[0-9A-Za-z]/.test(after)
}

function containsOriginal(text, original) {
  if (!original || original.length < 2) return false
  if (!isCodeLike(original)) return text.includes(original)
  // Codes: only a standalone occurrence counts ("01" inside "2001017" is not
  // the identifier "01").
  let index = text.indexOf(original)
  while (index !== -1) {
    if (edgesOk(text, index, index + original.length)) return true
    index = text.indexOf(original, index + 1)
  }
  return false
}

function dedupeIssues(issues) {
  const seen = new Set()
  const out = []
  for (const issue of issues) {
    const key = `${issue.severity}|${issue.code}|${issue.detail}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(issue)
  }
  // Errors first, so the cap never hides a blocking problem behind hints.
  const rank = (issue) => (issue.severity === 'error' ? 0 : 1)
  return out.map((issue, index) => [issue, index])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([issue]) => issue)
    .slice(0, 60)
}

function maskForReport(value) {
  const text = String(value)
  if (text.length <= 4) return '*'.repeat(text.length)
  return `${text.slice(0, 2)}${'*'.repeat(Math.min(6, text.length - 2))}`
}

function safeStructure(doc) {
  try {
    return doc.structure()
  } catch (error) {
    return { ok: false, checks: [{ name: '结构校验', ok: false, detail: String(error?.message ?? error) }] }
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
  const release = () => {
    active -= 1
    const next = queue.shift()
    show()
    if (next) next()
  }
  show()
  return Object.assign(Object.create(Object.getPrototypeOf(llm)), llm, {
    async chatJson(messages, opts = {}) {
      if (active >= limit) {
        const wait = new Promise((resolve) => queue.push(resolve))
        show()
        await wait
      }
      active += 1
      show()
      try {
        if (opts.signal?.aborted) throw Object.assign(new Error('已取消'), { code: 'aborted' })
        opts.onSlot?.()
        const { onSlot, ...rest } = opts
        return await llm.chatJson(messages, rest)
      } finally {
        release()
      }
    },
  })
}

const COMPARE_MAX_BYTES = 50_000_000
const COMPARE_MAX_CHANGES = 50000

/**
 * compare/index.json lists files; compare/<n>.json holds one file's changed
 * segments ({ field, before, after }). Skipped for oversized files.
 */
async function writeCompare({ items, results, outputDir, runDir, guard }) {
  const dir = join(runDir, 'compare')
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
        for (const segment of segments) {
          const next = afterText.get(segment.id)
          if (next === undefined) continue
          const changed = next !== segment.text
          const flag = flagged.some((text) => next.includes(text))
          if (changed) entry.changed += 1
          if (changes.length < COMPARE_MAX_CHANGES) {
            changes.push(changed
              ? { id: segment.id, field: segment.field ?? null, before: segment.text, after: next, ...(flag ? { flagged: true } : {}) }
              : { id: segment.id, field: segment.field ?? null, before: segment.text, same: true, ...(flag ? { flagged: true } : {}) })
          }
        }
        if (segments.length > changes.length) entry.truncated = changes.length
        const target = join(dir, `${n}.json`)
        await guard.check(target)
        await mkdir(dir, { recursive: true })
        await writeFile(target, JSON.stringify({ relPath: item.outRel, all: true, changes }), { mode: 0o600 })
      }
    } catch (error) {
      entry.skipped = 'error'
    }
    index.push(entry)
    n += 1
  }
  if (index.length === 0) return
  await mkdir(dir, { recursive: true })
  await guard.check(join(dir, 'index.json'))
  await writeFile(join(dir, 'index.json'), JSON.stringify(index), { mode: 0o600 })
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

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

async function updateIndex(outputRoot, run) {
  const indexFile = layout(outputRoot).index
  let list = []
  try {
    list = JSON.parse(await readFile(indexFile, 'utf8'))
    if (!Array.isArray(list)) list = []
  } catch { /* first run */ }
  const summary = {
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    inputDir: run.inputDir,
    files: run.totals.files,
    entities: run.totals.entities,
    unresolved: run.totals.unresolved,
    model: run.config.model,
    durationMs: run.durationMs,
    output: run.output ?? null,
    source: run.source ?? null,
    resumable: run.resumable === true,
    resumedFrom: run.resumedFrom ?? null,
    resumedBy: run.resumedBy ?? null,
    selection: run.selection ?? null,
  }
  list = [summary, ...list.filter((item) => item?.id !== run.id)].slice(0, 50)
  await mkdir(dirname(indexFile), { recursive: true })
  await writeFile(indexFile, JSON.stringify(list, null, 2), { mode: 0o600 })
}

export function checksum(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}
