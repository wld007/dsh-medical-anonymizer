/**
 * Batch orchestrator: rule pre-scan → model discovery → exact-span
 * pseudonymization → model + deterministic verification → bounded repair.
 */
import { mkdir, readFile, writeFile, readdir, realpath, stat } from 'node:fs/promises'
import { join, relative, dirname, basename, resolve, sep } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { loadDocument, detectKind } from './formats.js'
import { processDicomFile, sniffDicom, dicomPolicy } from './dicom/index.js'
import { scan, scanSuspects, isPseudonym, isKnownType } from './rules.js'
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
  // Same offset for every batch sharing this output root, so intervals between
  // dates stay comparable across batches. Never written to the report.
  const shiftDays = dateShiftDays(vault.salt)

  // For a single-file input, paths are relative to its parent so the output
  // keeps the original file name (output/<name>).
  const inputRoot = (await stat(inputDir)).isFile() ? dirname(resolve(inputDir)) : resolve(inputDir)
  try {
    for (const path of files) {
      checkAbort()
      emit('file-start')
      const relPath = relative(inputRoot, path).split(sep).join('/')
      const result = await processFile({
        path, relPath, run, vault, llm, llmBudget, maxRounds, maxFileBytes, dryRun, outputDir, signal, policy, shiftDays,
      })
      run.files.push(result)
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
    // DICOM: metadata only, no model. The salt keeps UIDs stable for this
    // output root; the run key (patient codes) exists only in memory.
    const runKey = randomBytes(32)
    if (dicomFiles.length > 0 && !dryRun) await vault.save() // persist the salt UIDs depend on
    for (const path of dicomFiles) {
      checkAbort()
      emit('file-start')
      const relPath = relative(inputRoot, path).split(sep).join('/')
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
  } = context
  const strategyOf = (type) => policy?.identifiers?.[type] ?? 'pseudonym'
  const kept = (type) => strategyOf(type) === 'keep'
  // Non-pseudonym outputs (masks, placeholders) produced in this file; they
  // must never be detected and replaced again.
  const produced = new Set()
  const guard = (text, start, end) => insideProtected(text, start, end, produced)
  const protectedText = (text) => isPseudonym(text) || isProtectedText(text, produced)
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

  const usedTypes = new Map() // "type|pseudonym" -> {type, pseudonym, count, sources:Set}
  const usedPseudonyms = new Set()
  const pendingOriginals = new Map() // original -> output (only for absence check, never serialized)
  const hasLlm = Boolean(llm)
  // Residuals confirmed by the verification pass (exact text present in the
  // segment). They are replaced in the next round instead of only being
  // reported, which is what makes the repair loop converge.
  let carryOver = []

  const rules = []
  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      if (signal?.aborted) throw new Error('已取消')
      file.rounds = round
      const detections = []
      const segments = doc.segments()
      // 0. Header/key policy: a dedicated column is pseudonymized wholesale.
      const hinted = new Set()
      for (const segment of segments) {
        if (!segment.hint || segment.text.trim().length === 0 || kept(segment.hint)) continue
        if (protectedText(segment.text)) continue
        hinted.add(segment.id)
        detections.push({
          id: segment.id, type: segment.hint, text: segment.text,
          start: 0, end: segment.text.length, source: 'header',
        })
      }
      // 1. Rules always run on un-hinted segments; cheap and deterministic.
      for (const segment of segments) {
        if (hinted.has(segment.id)) continue
        for (const entity of scan(segment.text)) {
          if (kept(entity.type) || guard(segment.text, entity.start, entity.end)) continue
          detections.push({
            id: segment.id, type: entity.type, text: entity.text,
            start: entity.start, end: entity.end, source: 'rule',
          })
        }
      }
      // 2. Model discovery, budgeted.
      const unlocated = []
      const parseErrors = []
      if (hasLlm && llmBudget.left > 0) {
        for (const batch of makeBatches(segments.filter((segment) => !hinted.has(segment.id)))) {
          if (llmBudget.left <= 0) break
          if (signal?.aborted) throw new Error('已取消')
          try {
            llmBudget.left -= 1
            llmBudget.calls += 1
            file.modelCalls += 1
            const reply = await llm.chatJson(detectPrompt(batch), { signal, maxTokens: 3000 })
            if (reply.usage?.total_tokens) llmBudget.tokens += reply.usage.total_tokens
            for (const entity of reply.json?.entities ?? []) {
              if (!isKnownType(entity?.type) || kept(entity.type)) continue
              const text = String(entity?.text ?? '').trim()
              if (!text || protectedText(text) || BARE_LABELS.has(text)) continue
              const segment = batch.find((item) => item.id === entity.segment)
              if (!segment) continue
              const found = locate(segment.text, text, entity.type, guard)
              if (found.length === 0) {
                unlocated.push({ type: entity.type, text, segment: segment.id })
                continue
              }
              for (const span of found) {
                detections.push({ id: segment.id, type: entity.type, text, ...span, source: 'llm' })
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
      const originals = new Map()
      for (const detection of detections) {
        const key = `${detection.type}|${detection.text}`
        if (!originals.has(key)) {
          originals.set(key, { type: detection.type, text: detection.text, source: detection.source })
        }
      }
      // Residuals the previous verification pass confirmed; expansion below
      // finds their exact spans.
      for (const residual of carryOver) {
        const key = `${residual.type}|${residual.text}`
        if (!originals.has(key)) originals.set(key, { type: residual.type, text: residual.text, source: 'verify' })
      }
      carryOver = []
      for (const item of originals.values()) {
        if (item.text.length < 2) continue
        for (const segment of doc.segments()) {
          let from = 0
          while (from <= segment.text.length - item.text.length) {
            const index = segment.text.indexOf(item.text, from)
            if (index < 0) break
            from = index + 1
            const end = index + item.text.length
            if (guard(segment.text, index, end)) continue
            detections.push({
              id: segment.id, type: item.type, text: item.text, start: index, end, source: item.source,
            })
          }
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
        if (kept(detection.type) || protectedText(detection.text)) continue
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
        if (!pendingOriginals.has(detection.text)) newOriginals += 1
        pendingOriginals.set(detection.text, pseudonym)
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
      const issues = []
      const structural = safeStructure(doc)
      if (!structural.ok) {
        issues.push({ severity: 'error', code: 'structure', detail: structural.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('；') })
      }
      for (const segment of doc.segments()) {
        for (const residue of scan(segment.text)) {
          if (kept(residue.type) || protectedText(residue.text) || guard(segment.text, residue.start, residue.end)) continue
          issues.push({ severity: 'error', code: 'residual', detail: `规则复扫命中：${residue.type} ${maskForReport(residue.text)}` })
        }
        for (const suspect of scanSuspects(segment.text)) {
          issues.push({ severity: 'warn', code: 'suspect', detail: `疑似${suspect.type}但${suspect.reason}：${maskForReport(suspect.text)}` })
        }
      }
      for (const [original, pseudonym] of pendingOriginals) {
        if (!pseudonym) continue
        for (const segment of doc.segments()) {
          if (containsOriginal(segment.text, original)) {
            issues.push({ severity: 'error', code: 'not-removed', detail: `原文标记未清除：${pseudonym}` })
            break
          }
        }
      }
      if (hasLlm && llmBudget.left > 0 && doc.segments().length > 0) {
        const modelIssues = []
        for (const batch of makeBatches(doc.segments())) {
          if (llmBudget.left <= 0) break
          if (signal?.aborted) throw new Error('已取消')
          try {
            llmBudget.left -= 1
            llmBudget.calls += 1
            file.modelCalls += 1
            const reply = await llm.chatJson(verifyPrompt(batch, [...usedPseudonyms]), { signal, maxTokens: 2500 })
            if (reply.usage?.total_tokens) llmBudget.tokens += reply.usage.total_tokens
            for (const issue of reply.json?.issues ?? []) {
              const text = String(issue?.text ?? '').trim()
              if (!text || protectedText(text)) continue
              if (!isKnownType(issue?.type) || kept(issue.type)) continue
              const segment = batch.find((item) => item.id === issue.segment)
              if (!segment || !segment.text.includes(text)) continue
              if (text.length >= 2 && !BARE_LABELS.has(text)) {
                carryOver.push({ id: segment.id, type: issue.type, text })
              }
              modelIssues.push({ severity: 'error', code: 'model-residual', detail: `模型复核残留：${issue.type} ${maskForReport(text)}` })
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

  // Quasi-identifiers: one deterministic pass after the identifier loop. They
  // are not part of the model repair loop (the model never sees this policy).
  file.quasi = {}
  if (policy?.quasiEnabled && file.status !== 'cancelled') {
    try {
      const planned = []
      for (const segment of doc.segments()) {
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

  if (!dryRun) {
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
  return file
}

function makeBatches(segments, maxChars = 1500, maxItems = 8) {
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
  if (/^[0-9A-Za-z@._%+-]+$/.test(original)) {
    return text.includes(original)
  }
  return text.includes(original)
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
  return out.slice(0, 60)
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
