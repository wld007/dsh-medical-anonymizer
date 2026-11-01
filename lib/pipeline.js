/**
 * Batch orchestrator: rule pre-scan → model discovery → exact-span
 * pseudonymization → model + deterministic verification → bounded repair.
 */
import { mkdir, readFile, writeFile, readdir, realpath, stat } from 'node:fs/promises'
import { join, relative, dirname, basename, resolve, sep } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { loadDocument, detectKind } from './formats.js'
import { processDicomFile, sniffDicom, dicomPolicy } from './dicom/index.js'
import { scan, scanSuspects, isPseudonym, isKnownType, plausible, isCodeLike } from './rules.js'
import { detectPrompt, verifyPrompt } from './llm.js'
import { Vault } from './pseudonym.js'
import { renderMarkdown } from './report.js'
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
export async function listInputFiles(inputDir, { exclude = [] } = {}) {
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
  const unsupported = { count: 0, byExt: {} }
  async function classify(path, name) {
    const dot = name.lastIndexOf('.')
    const ext = dot > 0 ? name.slice(dot).toLowerCase() : '(none)'
    if (ALLOWED.has(ext)) {
      files.push(path)
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
        if (entry.name === 'node_modules' || isExcluded(path)) continue
        await walk(path)
      } else if (entry.isFile()) {
        await classify(path, entry.name)
      }
    }
  }
  // A single file is a valid input: it is classified on its own, without the
  // hidden-file filter (the user named it explicitly).
  const info = await stat(root)
  if (info.isFile()) {
    await classify(root, basename(root))
  } else {
    await walk(root)
  }
  return { files: files.sort(), dicom: dicom.sort(), unsupported }
}

export function newRunId() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `${stamp}-${randomBytes(3).toString('hex')}`
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
  const maxFiles = clampInt(options.maxFiles, 1, 2000, 200)
  // A single CT study is often hundreds to thousands of slices; DICOM files
  // are cheap (header only, no model calls) and have their own cap.
  const maxDicomFiles = clampInt(options.maxDicomFiles, 1, 500_000, 50_000)
  const maxFileBytes = clampInt(options.maxFileBytes, 1_000_000, 200_000_000, 30_000_000)
  const dryRun = options.dryRun === true
  const llm = options.llm ?? null
  const llmBudget = { left: clampInt(options.maxLlmCalls, 0, 5000, 240), calls: 0, tokens: 0 }
  const policy = resolvePolicy(options.policy ?? {})

  const runDir = join(outputRoot, 'runs', runId)
  const outputDir = join(runDir, 'output')
  const vaultPath = join(outputRoot, 'vault.json')

  const vault = new Vault(vaultPath, options.vaultPassphrase ?? '')
  await vault.load()

  const run = {
    id: runId,
    startedAt: new Date(started).toISOString(),
    finishedAt: null,
    status: 'running',
    dryRun,
    inputDir,
    outputRoot,
    runDir,
    config: {
      model: options.model ?? llm?.model ?? '',
      baseURL: options.baseURL ?? llm?.baseURL ?? '',
      modelConfigured: Boolean(llm),
      disableThinking: options.disableThinking === true,
      maxRounds,
      policy,
    },
    totals: {
      files: 0, filesFailed: 0, filesReview: 0, entities: 0,
      byType: {}, modelCalls: 0, tokens: 0, unresolved: 0, quasi: {},
      dicom: null,
    },
    skipped: { unsupported: 0, unsupportedByExt: {}, overLimit: 0, dicomdir: 0 },
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
  emit('start')

  let files = []
  let dicomFiles = []
  try {
    const listing = await listInputFiles(inputDir, { exclude: [outputRoot] })
    files = listing.files
    dicomFiles = listing.dicom
    run.skipped.unsupported = listing.unsupported.count
    run.skipped.unsupportedByExt = listing.unsupported.byExt
  } catch (error) {
    throw new Error(`无法读取输入路径: ${error.message}`)
  }
  if (files.length > maxFiles) {
    run.skipped.overLimit = files.length - maxFiles
    files = files.slice(0, maxFiles)
    run.warnings.push(`输入共有 ${maxFiles + run.skipped.overLimit} 个可处理文件，超过单批上限 ${maxFiles}，其余 ${run.skipped.overLimit} 个未处理；请分批运行或调大 maxFiles。`)
  }
  if (dicomFiles.length > maxDicomFiles) {
    const over = dicomFiles.length - maxDicomFiles
    run.skipped.overLimit += over
    dicomFiles = dicomFiles.slice(0, maxDicomFiles)
    run.warnings.push(`输入共有 ${maxDicomFiles + over} 个 DICOM 文件，超过单批上限 ${maxDicomFiles}，其余 ${over} 个未处理；请调大 maxDicomFiles。`)
  }
  if (dicomFiles.length > 0) {
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
  if (dryRun) {
    run.warnings.push('演练模式：未写出匿名化数据，也未更新映射库。')
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
    if (removed > 0) run.warnings.push(`已从映射库${dryRun ? '（演练模式，仅本次内存中）' : ''}移除 ${removed} 条"不匹配的值"的映射。`)
  }
  const filePolicy = {
    ...policy,
    allowValues: new Set(policy.allowValues.map(normalizeAllow)),
    skipFields: new Set(policy.skipFields.map((field) => field.toLowerCase())),
  }
  // Same offset for every batch sharing this output root, so intervals between
  // dates stay comparable across batches. Never written to the report.
  const shiftDays = dateShiftDays(vault.salt)

  // For a single-file input, paths are relative to its parent so the output
  // keeps the original file name (output/<name>).
  const inputRoot = (await stat(inputDir)).isFile() ? dirname(resolve(inputDir)) : resolve(inputDir)
  try {
    run.current = { file: '', round: 0, step: '批次预扫', modelCalls: 0 }
    emit('progress')
    const batchKnown = files.length > 1
      ? await seedBatchKnown(files, inputRoot, filePolicy, maxFileBytes, signal)
      : new Map()
    for (const path of files) {
      checkAbort()
      emit('file-start')
      const relPath = relative(inputRoot, path).split(sep).join('/')
      run.current = { file: relPath, round: 0, step: '读取', modelCalls: llmBudget.calls }
      emit('progress')
      const result = await processFile({
        path, relPath, run, vault, llm, llmBudget, maxRounds, maxFileBytes, dryRun, outputDir, signal, policy: filePolicy, shiftDays,
        batchKnown,
        progress: (state) => {
          run.current = state
          emit('progress')
        },
      })
      run.files.push(result)
      for (const item of result.found ?? []) addKnown(batchKnown, item.type, item.text, filePolicy)
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
      // A dry run reads an existing vault for stable tokens but never persists
      // new original values: it is documented as writing no data.
      if (!dryRun) await vault.save()
      emit('file-done')
    }
    if (files.length > 1) {
      checkAbort()
      run.current = { file: '', round: 0, step: '批次复扫', modelCalls: llmBudget.calls }
      emit('progress')
      await recheckBatch({ run, batchKnown, vault, dryRun, outputDir, policy: filePolicy })
      if (!dryRun) await vault.save()
    }
    for (const file of run.files) if (file.doc) file.doc = null
    // DICOM: metadata only, no model. The salt keeps UIDs stable for this
    // output root; the run key (patient codes) exists only in memory.
    const runKey = randomBytes(32)
    if (dicomFiles.length > 0 && !dryRun) await vault.save() // persist the salt UIDs depend on
    for (const path of dicomFiles) {
      checkAbort()
      emit('file-start')
      const relPath = relative(inputRoot, path).split(sep).join('/')
      run.current = { file: relPath, round: 0, step: 'DICOM', modelCalls: llmBudget.calls }
      const result = await processDicomFile({
        path, relPath, outputDir, dryRun, salt: vault.salt, runKey, shiftDays, policy,
      })
      if (result.status === 'skipped') {
        run.skipped.dicomdir += 1
        run.warnings.push(`${relPath}：${result.issues[0]?.detail ?? '已跳过'}`)
        emit('file-done')
        continue
      }
      run.files.push(result)
      run.totals.files += 1
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
    if (run.totals.unresolved > 0 || run.skipped.overLimit > 0) run.status = 'review'
    else run.status = run.totals.filesFailed > 0 ? 'failed' : 'completed'
  } catch (error) {
    if (error.code === 'cancelled') {
      run.status = 'cancelled'
    } else {
      run.status = 'failed'
      run.error = String(error?.message ?? error)
    }
  }

  run.current = null
  run.finishedAt = new Date().toISOString()
  run.totals.modelCalls = llmBudget.calls
  run.totals.tokens = llmBudget.tokens
  run.durationMs = Date.now() - started
  run.vaultPath = dryRun ? null : vaultPath

  if (!dryRun) await vault.save()
  await mkdir(runDir, { recursive: true })
  await writeFile(join(runDir, 'report.json'), JSON.stringify(run, null, 2), { mode: 0o600 })
  await writeFile(join(runDir, 'report.md'), renderMarkdown(run), { mode: 0o600 })
  await updateIndex(outputRoot, run)
  emit('done')
  return run
}

async function processFile(context) {
  const {
    path, relPath, run, vault, llm, llmBudget, maxRounds, maxFileBytes, dryRun, outputDir, signal, policy, shiftDays,
    batchKnown = null, progress = () => {},
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
    doc = await loadDocument(path, relPath)
    file.bytes = doc.bytes
  } catch (error) {
    file.status = 'failed'
    file.issues.push({ severity: 'error', code: 'load', detail: String(error.message ?? error) })
    file.durationMs = Date.now() - started
    return file
  }

  const structured = doc.kind !== 'text'
  const segmentsOf = () => doc.segments().filter((segment) => !skippedField(segment))
  const initial = doc.segments()
  const originalTexts = new Map(initial.map((segment) => [segment.id, segment.text]))
  const fieldOf = new Map(initial.map((segment) => [segment.id, segment.field ?? null]))
  const skippedCount = initial.length - segmentsOf().length
  const fieldsLabel = (ids) => describeFields([...ids].map((id) => fieldOf.get(id)))

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
  const step = (name, round) => progress({ file: relPath, round, step: name, modelCalls: llmBudget.calls })
  const countCall = () => {
    llmBudget.left -= 1
    llmBudget.calls += 1
    file.modelCalls += 1
    run.totals.modelCalls = llmBudget.calls
  }
  // Residuals confirmed by the verification pass (exact text present in the
  // segment). They are replaced in the next round instead of only being
  // reported, which is what makes the repair loop converge.
  let carryOver = []

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
        // A sibling label (ITM_NM) is weaker evidence than a dedicated column.
        const reason = plausible(segment.hint, segment.text, segment.hintFrom === 'sibling' ? 'llm' : 'header')
        if (reason) {
          if (segment.hintFrom !== 'sibling') reject(segment.hint, segment.text.trim(), reason, 'header', segment.id)
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
        for (const entity of scan(segment.text)) {
          if (kept(entity.type) || allowed(entity.text) || guard(segment.text, entity.start, entity.end)) continue
          detections.push({
            id: segment.id, type: entity.type, text: entity.text,
            start: entity.start, end: entity.end, source: 'rule',
          })
        }
      }
      // Residuals confirmed by the previous verification pass, located in the
      // segments the verifier saw them in.
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
      if (hasLlm && llmBudget.left > 0) {
        const groups = groupByText(segments.filter((segment) => !hinted.has(segment.id) && llmWorthy(segment.text, protectedText)))
        for (const batch of makeBatches(groups.map((group) => group[0]))) {
          if (llmBudget.left <= 0) break
          if (signal?.aborted) throw new Error('已取消')
          try {
            countCall()
            step('发现', round)
            const reply = await llm.chatJson(detectPrompt(batch.map(forModel)), { signal, maxTokens: 3000 })
            if (reply.usage?.total_tokens) llmBudget.tokens += reply.usage.total_tokens
            for (const entity of reply.json?.entities ?? []) {
              if (!isKnownType(entity?.type) || kept(entity.type)) continue
              const text = String(entity?.text ?? '').trim()
              if (!text || protectedText(text) || BARE_LABELS.has(text) || allowed(text)) continue
              const segment = batch.find((item) => item.id === entity.segment)
              if (!segment) continue
              const reason = plausible(entity.type, text, 'llm')
              if (reason) {
                reject(entity.type, text, reason, 'llm', segment.id)
                continue
              }
              const found = locate(segment.text, text, entity.type, guard)
              if (found.length === 0) {
                // In a later round the model sometimes reports a fragment of
                // a pseudonym ("294CD0" out of "证件-294CD0"): already handled.
                if (!echoesPseudonym(segment.text, text)) unlocated.push({ type: entity.type, text, segment: segment.id })
                continue
              }
              for (const twin of groups.find((group) => group[0].id === segment.id) ?? [segment]) {
                for (const span of found) {
                  detections.push({ id: twin.id, type: entity.type, text, ...span, source: 'llm' })
                }
              }
            }
          } catch (error) {
            if (error?.code === 'aborted' || signal?.aborted) throw new Error('已取消')
            parseErrors.push(String(error?.message ?? error))
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

      // 4. Verification.
      step('复核', round)
      const issues = []
      const structural = safeStructure(doc)
      if (!structural.ok) {
        issues.push({ severity: 'error', code: 'structure', detail: structural.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('；') })
      }
      const current = segmentsOf()
      for (const segment of current) {
        for (const residue of scan(segment.text)) {
          if (kept(residue.type) || allowed(residue.text) || protectedText(residue.text) || guard(segment.text, residue.start, residue.end)) continue
          issues.push({ severity: 'error', code: 'residual', detail: `规则复扫命中：${residue.type} ${maskForReport(residue.text)}${fieldSuffix(segment.field)}` })
        }
        for (const suspect of scanSuspects(segment.text)) {
          issues.push({ severity: 'warn', code: 'suspect', detail: `疑似${suspect.type}但${suspect.reason}：${maskForReport(suspect.text)}${fieldSuffix(segment.field)}` })
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
          issues.push({ severity: 'error', code: 'not-removed', detail: `原文标记未清除：${pending.pseudonym}（原值 ${maskForReport(original)}，${left.size} 处，字段：${fieldsLabel(left)}）` })
        }
      }
      if (hasLlm && llmBudget.left > 0 && current.length > 0) {
        const modelIssues = []
        const groups = groupByText(current.filter((segment) => llmWorthy(segment.text, protectedText)))
        for (const batch of makeBatches(groups.map((group) => group[0]))) {
          if (llmBudget.left <= 0) break
          if (signal?.aborted) throw new Error('已取消')
          try {
            countCall()
            step('复核', round)
            const reply = await llm.chatJson(verifyPrompt(batch.map(forModel), [...usedPseudonyms]), { signal, maxTokens: 2500 })
            if (reply.usage?.total_tokens) llmBudget.tokens += reply.usage.total_tokens
            for (const issue of reply.json?.issues ?? []) {
              const text = String(issue?.text ?? '').trim()
              if (!text || protectedText(text) || allowed(text)) continue
              if (!isKnownType(issue?.type) || kept(issue.type)) continue
              const segment = batch.find((item) => item.id === issue.segment)
              if (!segment || !segment.text.includes(text)) continue
              const reason = plausible(issue.type, text, 'llm')
              if (reason) {
                reject(issue.type, text, reason, 'llm', segment.id)
                continue
              }
              if (text.length >= 2 && !BARE_LABELS.has(text)) {
                const ids = new Set((groups.find((group) => group[0].id === segment.id) ?? [segment]).map((item) => item.id))
                carryOver.push({ type: issue.type, text, ids })
              }
              modelIssues.push({ severity: 'error', code: 'model-residual', detail: `模型复核残留：${issue.type} ${maskForReport(text)}${fieldSuffix(segment.field)}` })
            }
          } catch (error) {
            if (error?.code === 'aborted' || signal?.aborted) throw new Error('已取消')
            issues.push({ severity: 'warn', code: 'model-error', detail: String(error?.message ?? error) })
          }
        }
        issues.push(...modelIssues)
      }
      for (const item of unlocated) {
        issues.push({ severity: 'warn', code: 'unlocated', detail: `模型给出的片段未在原文中定位到：${item.type} ${maskForReport(item.text)}` })
      }
      for (const detail of parseErrors.slice(0, 3)) {
        issues.push({ severity: 'warn', code: 'model-parse', detail })
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
  for (const item of [...rejected.values()].slice(0, 30)) {
    const where = item.ids.size > 0 ? `，字段：${fieldsLabel(item.ids)}` : ''
    notes.push({
      severity: 'warn',
      code: 'implausible',
      detail: `${item.source === 'header' ? '按字段名' : '模型'}判为${item.type}，但${item.reason}，未替换：${maskForReport(item.text)}${where}`,
    })
  }
  for (const item of overMatch.values()) {
    notes.push({
      severity: 'warn',
      code: 'over-match',
      detail: `${item.type} ${maskForReport(item.text)} 除 ${item.direct} 个识别位置外又在 ${item.spread} 个值中被替换（字段：${fieldsLabel(item.ids)}），请确认不是误判`,
    })
  }
  if (skippedCount > 0) {
    notes.push({ severity: 'warn', code: 'skipped-fields', detail: `按配置跳过 ${skippedCount} 个值（不处理的字段），这些值原样输出` })
  }
  file.issues = dedupeIssues([...file.issues, ...notes])

  // Quasi-identifiers: one deterministic pass after the identifier loop. They
  // are not part of the model repair loop (the model never sees this policy).
  file.quasi = {}
  if (policy?.quasiEnabled && file.status !== 'cancelled') {
    try {
      const planned = []
      for (const segment of segmentsOf()) {
        for (const item of quasiReplacements(segment, policy.quasi, shiftDays)) {
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

  if (!dryRun) await writeOutput(file, doc, outputDir, relPath)
  return file
}

async function writeOutput(file, doc, outputDir, relPath) {
  try {
    const target = resolve(outputDir, relPath)
    if (!target.startsWith(resolve(outputDir) + sep)) throw new Error('输出路径越界')
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
async function seedBatchKnown(files, inputRoot, policy, maxFileBytes, signal) {
  const batchKnown = new Map()
  for (const path of files) {
    if (signal?.aborted) break
    try {
      const info = await stat(path)
      if (info.size > maxFileBytes) continue
      const doc = await loadDocument(path, relative(inputRoot, path))
      for (const segment of doc.segments()) {
        if (fieldSkipped(segment.field, policy.skipFields)) continue
        if (segment.hint && !plausible(segment.hint, segment.text.trim(), segment.hintFrom === 'sibling' ? 'llm' : 'header')) {
          if (!policy.allowValues.has(normalizeAllow(segment.text))) addKnown(batchKnown, segment.hint, segment.text, policy)
        }
        for (const entity of scan(segment.text)) {
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
async function recheckBatch({ run, batchKnown, vault, dryRun, outputDir, policy }) {
  const kept = (type) => (policy?.identifiers?.[type] ?? 'pseudonym') === 'keep'
  const known = [...batchKnown.values()].filter((item) => !kept(item.type))
    .sort((a, b) => b.text.length - a.text.length)
  for (const file of run.files) {
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
    if (!dryRun) await writeOutput(file, doc, outputDir, file.relPath)
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

function makeBatches(segments, maxChars = 1500, maxItems = 20) {
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

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

async function updateIndex(outputRoot, run) {
  const indexFile = join(outputRoot, 'index.json')
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
    dryRun: run.dryRun,
    inputDir: run.inputDir,
    files: run.totals.files,
    entities: run.totals.entities,
    unresolved: run.totals.unresolved,
    model: run.config.model,
    durationMs: run.durationMs,
  }
  list = [summary, ...list.filter((item) => item?.id !== run.id)].slice(0, 50)
  await mkdir(outputRoot, { recursive: true })
  await writeFile(indexFile, JSON.stringify(list, null, 2), { mode: 0o600 })
}

export function checksum(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}
