/**
 * Post-run advisor: turns one batch's statistics into
 *  - setting suggestions the user can adopt with one click (local config only);
 *  - a value-free plugin-improvement draft for problems settings cannot fix.
 *
 * Nothing here is sent anywhere. The draft contains issue codes, counts,
 * identifier types and file extensions only — never original values, file
 * paths or field names (a headerless CSV's first row would be its "header") — so the user can paste it into a
 * conversation or an issue after reading it. Allow-list suggestions carry
 * original values and are stored only in _records/runs/<id>/advice.json (0600).
 */
import { extname } from 'node:path'

const LIMITS = { maxRounds: [1, 6], timeoutMs: [10000, 1800000], concurrency: [1, 16] }

function clamp(key, value) {
  const [min, max] = LIMITS[key]
  return Math.min(max, Math.max(min, value))
}

function errorsOf(file) {
  return (file.issues ?? []).filter((issue) => issue.severity === 'error')
}

function count(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by)
}

function top(map, limit = 8) {
  return [...map].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

function mask(value) {
  const text = String(value)
  if (text.length <= 2) return '*'.repeat(text.length)
  return `${text.slice(0, 1)}${'*'.repeat(Math.min(6, text.length - 1))}`
}

/**
 * @param {object} run finished run (files keep non-enumerable overMatchValues)
 * @param {{ maxRounds:number, concurrency:number, timeoutMs:number, disableThinking:boolean,
 *   modelConfigured:boolean, skipFields:string[], allowValues:string[], version:string }} settings
 */
export function advise(run, settings) {
  const files = (run.files ?? []).filter((file) => file.kind !== 'dicom')
  const textFiles = files.length
  const suggestions = []
  const findings = []
  if (textFiles === 0 || run.status === 'cancelled') return { suggestions, findings, draft: null }

  const byCode = new Map()
  const filesByCode = new Map()
  for (const file of files) {
    const codes = new Set()
    for (const issue of file.issues ?? []) {
      count(byCode, issue.code)
      codes.add(issue.code)
    }
    for (const code of codes) count(filesByCode, code)
  }
  const n = (code) => byCode.get(code) ?? 0
  const nf = (code) => filesByCode.get(code) ?? 0

  // ── Model timeouts and errors → timeout / concurrency ──
  const timeouts = files.reduce((sum, file) => sum + (file.issues ?? [])
    .filter((issue) => (issue.code === 'model-error' || issue.code === 'model-unchecked') && /超时|timeout|abort/i.test(issue.detail)).length, 0)
  // Output that was not usable (invalid JSON or the wrong shape).
  const unusable = (file) => (file.issues ?? []).filter((issue) => issue.code === 'model-parse'
    || (issue.code === 'model-unchecked' && /JSON|格式不符|解析/.test(issue.detail ?? ''))).length
  const parseCount = files.reduce((sum, file) => sum + unusable(file), 0)
  const parseFiles = files.filter((file) => unusable(file) > 0).length
  if (settings.modelConfigured && timeouts >= 2) {
    const nextTimeout = clamp('timeoutMs', Math.round(settings.timeoutMs * 1.5 / 10000) * 10000)
    if (nextTimeout > settings.timeoutMs) {
      suggestions.push({
        id: 'timeout-up', level: 'warn',
        title: `模型超时调到 ${nextTimeout / 1000} 秒`,
        reason: `${timeouts} 次模型调用超时，超时的文件只能靠规则层，漏识别风险更高。`,
        patch: { timeoutMs: nextTimeout },
      })
    }
    if (settings.concurrency > 1) {
      const next = clamp('concurrency', Math.max(1, Math.floor(settings.concurrency / 2)))
      suggestions.push({
        id: 'concurrency-down', level: 'warn',
        title: `模型并发降到 ${next}`,
        reason: `模型端点在 ${settings.concurrency} 路并发下出现 ${timeouts} 次超时，降低并发可减轻端点压力。`,
        patch: { concurrency: next },
      })
    }
  }

  // ── Model output that is not valid JSON → thinking mode ──
  if (settings.modelConfigured && parseCount >= 3) {
    if (!settings.disableThinking) {
      suggestions.push({
        id: 'thinking-off', level: 'warn',
        title: '关闭思考模式',
        reason: `${parseCount} 次模型输出无法使用（不是 JSON 或格式不符）。推理模型的思考内容常会打乱 JSON 输出，关闭后更稳定也更快。`,
        patch: { disableThinking: true },
      })
    } else {
      findings.push({ area: '模型输出解析', detail: `思考模式已关闭，仍有 ${parseCount} 次模型输出无法使用（${parseFiles} 个文件），已重试、拆分重发，仍失败的转人工复核`, hint: '解析器可能需要兼容该模型的输出格式（如代码块包裹、前后多余文字、字段名不同），或调整提示词让模型严格按格式输出' })
    }
  }

  // ── Rounds ──
  const rounds = files.map((file) => Number(file.rounds ?? 0))
  const exhausted = files.filter((file) => Number(file.rounds ?? 0) >= settings.maxRounds
    && errorsOf(file).some((issue) => issue.code === 'residual' || issue.code === 'model-residual'))
  if (settings.modelConfigured && exhausted.length > 0 && settings.maxRounds < 6) {
    suggestions.push({
      id: 'rounds-up', level: 'warn',
      title: `核验轮次上限调到 ${settings.maxRounds + 1}`,
      reason: `${exhausted.length} 个文件用满 ${settings.maxRounds} 轮仍有残留，被标为待复核；多一轮可能修复部分残留。`,
      patch: { maxRounds: clamp('maxRounds', settings.maxRounds + 1) },
    })
  }
  if (settings.modelConfigured && settings.maxRounds >= 3 && textFiles >= 20
    && rounds.every((value) => value <= 1) && files.every((file) => errorsOf(file).length === 0)) {
    suggestions.push({
      id: 'rounds-down', level: 'info',
      title: '核验轮次上限降到 2',
      reason: `全部 ${textFiles} 个文件第 1 轮即通过核验。降到 2 轮仍保留一次修正机会，同类数据可节省等待时间（只在出现残留时才会用到后续轮次，节省有限）。`,
      patch: { maxRounds: 2 },
    })
  }

  // ── Memory → files per chunk ──
  const memory = run.memory
  if (memory?.heapLimit && settings.maxFiles) {
    const ratio = memory.peakHeap / memory.heapLimit
    const pct = Math.round(ratio * 100)
    if (ratio >= 0.7 && settings.maxFiles > 20) {
      const next = Math.max(20, Math.round(settings.maxFiles / 2 / 10) * 10)
      suggestions.push({
        id: 'chunk-down', level: 'warn',
        title: `每组文件数调到 ${next}`,
        reason: `本批次堆内存峰值达到上限的 ${pct}%，再大的输入可能导致进程内存不足而中断。每组文件数减半可降低批次复扫时的内存占用。`,
        patch: { maxFiles: next },
      })
    } else if (ratio < 0.3 && (run.chunks ?? 1) > 1 && settings.maxFiles < 2000) {
      const next = Math.min(2000, settings.maxFiles * 2)
      suggestions.push({
        id: 'chunk-up', level: 'info',
        title: `每组文件数调到 ${next}`,
        reason: `本批次分为 ${run.chunks} 组，堆内存峰值仅为上限的 ${pct}%。增大每组文件数可减少分组和跨组复扫的时间。`,
        patch: { maxFiles: next },
      })
    }
  }

  // ── Allow-list candidates: values that spread into many other values ──
  const spread = new Map()
  for (const file of files) {
    for (const item of file.overMatchValues ?? []) {
      const key = `${item.type}|${item.text}`
      const entry = spread.get(key) ?? { type: item.type, text: item.text, spread: 0, files: 0, fields: new Set() }
      entry.spread += item.spread
      entry.files += 1
      for (const field of item.fields) entry.fields.add(field)
      spread.set(key, entry)
    }
  }
  const allowed = new Set((settings.allowValues ?? []).map((value) => value.trim()))
  const candidates = [...spread.values()].filter((entry) => !allowed.has(entry.text)).sort((a, b) => b.spread - a.spread).slice(0, 10)
  if (candidates.length > 0) {
    suggestions.push({
      id: 'allow-values', level: 'confirm',
      title: `${candidates.length} 个值可能被误当作标识符`,
      reason: '这些值被识别后又在大量其他字段中被替换，常见于类别代码、科室名称。请逐个确认它确实不是个人标识符再采纳；采纳后加入「不匹配的值」，下一批起不再替换。',
      values: candidates.map((entry) => ({
        value: entry.text, masked: mask(entry.text), type: entry.type, spread: entry.spread, files: entry.files, fields: [...entry.fields].slice(0, 5),
      })),
      patch: { allowValuesAdd: candidates.map((entry) => entry.text) },
    })
  }

  // ── Noisy fields: many value-free warnings, never an error ──
  const skip = new Set((settings.skipFields ?? []).map((field) => field.toLowerCase()))
  const noisy = new Map()
  const errorFields = new Set()
  for (const file of files) {
    for (const issue of file.issues ?? []) {
      for (const field of issue.fields ?? []) {
        if (issue.severity === 'error') errorFields.add(field)
        else if (issue.code === 'suspect' || issue.code === 'implausible') count(noisy, field)
      }
    }
  }
  const noisyFields = top(noisy, 6).filter(([field, hits]) => field !== '正文' && hits >= Math.max(5, textFiles / 4)
    && !errorFields.has(field) && !skip.has(field.toLowerCase()))
  if (noisyFields.length > 0) {
    suggestions.push({
      id: 'skip-fields', level: 'confirm',
      title: `${noisyFields.length} 个字段反复产生提示`,
      reason: '这些字段的值多次被判为疑似标识符但未替换（校验位不符、像编码等）。如果确认字段只含编码、数量等非个人信息，可设为「不处理的字段」以减少报告噪音；字段若可能含姓名、证件号，请不要采纳。',
      fields: noisyFields.map(([field, hits]) => ({ field, hits })),
      patch: { skipFieldsAdd: noisyFields.map(([field]) => field) },
    })
  }

  // ── Problems settings cannot fix → plugin findings ──
  const persistent = new Map()
  for (const file of exhausted) {
    for (const issue of errorsOf(file)) if (issue.type) count(persistent, issue.type)
  }
  if (persistent.size > 0 && (settings.maxRounds >= 4 || !settings.modelConfigured)) {
    findings.push({ area: '识别规则', detail: `用满轮次仍残留的标识符类型：${top(persistent).map(([type, hits]) => `${type}×${hits}`).join('、')}`, hint: '规则层可能缺少该类标识符的模式，或定向修正未能覆盖' })
  }
  const unlocated = new Map()
  for (const file of files) for (const issue of file.issues ?? []) if (issue.code === 'unlocated') count(unlocated, issue.type ?? '未知')
  const unlocatedTotal = [...unlocated.values()].reduce((a, b) => a + b, 0)
  if (unlocatedTotal >= Math.max(10, textFiles)) {
    findings.push({ area: '片段定位', detail: `模型给出的片段 ${unlocatedTotal} 次未在原文中定位到：${top(unlocated).map(([type, hits]) => `${type}×${hits}`).join('、')}`, hint: '模型可能改写了原文（全半角、空格、转义），定位逻辑可放宽对这些差异的匹配' })
  }
  for (const [code, area, hint] of [
    ['structure', '结构校验', '替换后文件结构变化，属于缺陷，应修复'],
    ['embedded', '假名嵌入', '假名嵌入更长的编码中，边界判断需要修复'],
    ['partial', '部分替换', '数字/日期值被部分替换，边界判断需要修复'],
    ['not-removed', '原值清除', '已识别的原值未被完全清除，替换流程需要修复'],
    ['pipeline', '处理异常', '处理流程抛出异常，需要定位缺陷'],
  ]) {
    if (n(code) > 0) findings.push({ area, detail: `${n(code)} 处（${nf(code)} 个文件）`, hint })
  }
  const loadFailures = new Map()
  for (const file of files) if ((file.issues ?? []).some((issue) => issue.code === 'load')) count(loadFailures, extname(file.relPath).toLowerCase() || '(无扩展名)')
  if (loadFailures.size > 0) {
    findings.push({ area: '文件解析', detail: `无法读取的文件：${top(loadFailures).map(([ext, hits]) => `${ext}×${hits}`).join('、')}`, hint: '解析器可能不支持这些文件的编码或格式变体' })
  }
  const unsupported = Object.entries(run.skipped?.unsupportedByExt ?? {}).filter(([, hits]) => hits >= 3)
  if (unsupported.length > 0) {
    findings.push({ area: '格式支持', detail: `跳过的不支持格式：${unsupported.map(([ext, hits]) => `${ext}×${hits}`).join('、')}`, hint: '如这些格式常见且可能含标识符，可考虑支持' })
  }
  // Content the plugin could not read: which kinds, so a decoder / extractor
  // can be added (images → OCR, PDF → text extraction, unknown encodings …).
  const opaqueKinds = new Map()
  for (const file of files) {
    for (const issue of file.issues ?? []) {
      if (issue.code !== 'opaque') continue
      const match = /无法检查的内容：(.+?) ×(\d+)/.exec(issue.detail ?? '')
      if (match) count(opaqueKinds, match[1], Number(match[2]))
    }
  }
  const opaqueHint = (kind) => /图片/.test(kind) ? '图片中的文字（签名、扫描件、截图）需要 OCR 才能检查'
    : /PDF/.test(kind) ? 'PDF 需要提取文字后检查，写回时可能需要重新生成'
      : /RTF/.test(kind) ? '可增加 RTF 解析：提取文字、替换后按原格式写回'
        : /Office|ZIP/.test(kind) ? '可增加 docx / xlsx 等内嵌文档的解析'
          : '可能是未知编码、损坏的数据或加密内容；需要样本确认格式后增加对应的解码器'
  for (const [kind, hits] of top(opaqueKinds, 8)) {
    findings.push({ area: '无法检查的内容', detail: `${kind} ${hits} 处（已转人工复核或按配置移除）`, hint: opaqueHint(kind) })
  }
  if (n('opaque-token') > 0) findings.push({ area: '无法解读的编码串', detail: `${n('opaque-token')} 处（${nf('opaque-token')} 个文件）`, hint: '较短的编码值（哈希、加密值、二进制标识）无法解码；若为可逆编码，需要样本确认后增加解码器' })
  if (n('unreadable') > 0) findings.push({ area: '疑似加密或未知编码', detail: `${n('unreadable')} 处长字符串无法解读（${nf('unreadable')} 个文件）`, hint: '字段内容看起来是加密或未知编码；需要样本确认编码方式，增加解码器后才能检查' })
  // What the blind review caught that detection missed: gaps in the rules,
  // the field dictionary or the detection prompt.
  const missed = new Map()
  for (const file of files) for (const issue of file.issues ?? []) if (issue.code === 'model-residual' && issue.type) count(missed, issue.type)
  if (missed.size > 0) findings.push({ area: '识别遗漏（盲审补出）', detail: `独立盲审补出识别阶段漏掉的标识符：${top(missed).map(([type, hits]) => `${type}×${hits}`).join('、')}`, hint: '可据此补充规则模式、字段名词典或识别提示词，让识别阶段直接认出' })
  if (n('disputed') > 0) findings.push({ area: '模型分歧', detail: `识别与核验意见不一致 ${n('disputed')} 处（${nf('disputed')} 个文件），已转人工复核`, hint: '人工复核的结论可用来校准两边的提示词或补充「不匹配的值」' })
  if (n('verify-dismissed') >= Math.max(5, textFiles)) findings.push({ area: '盲审误报', detail: `盲审报出、复判判定不是标识符 ${n('verify-dismissed')} 处`, hint: '盲审提示词可能过于敏感，可补充排除说明（如药品、科室写法）' })
  const profiled = Object.values(run.profileSummary ?? {}).filter((item) => item.category === 'identifier')
  if (profiled.length > 0) findings.push({ area: '字段名词典', detail: `${profiled.length} 个字段名不在内置词典中，靠字段画像才认出是标识符列`, hint: '可把这些字段名加入内置词典，省去画像调用（字段名见报告的「字段画像」一节）' })
  const uncertain = Object.values(run.profileSummary ?? {}).filter((item) => item.category === 'uncertain').length
  if (uncertain >= 5) findings.push({ area: '字段画像', detail: `${uncertain} 个字段无法判断性质，按逐值方式处理`, hint: '可改进画像提示词或提供更多样例' })

  const draft = findings.length > 0 ? renderDraft(run, settings, findings, textFiles) : null
  return { suggestions, findings, draft }
}

function renderDraft(run, settings, findings, textFiles) {
  const lines = [
    `# dsh-medical-anonymizer 改进建议（${settings.version}）`,
    '',
    '> 由插件根据一次批次的统计自动生成，只含问题类型、计数、扩展名和内容类别，不含原值、文件路径和字段名。提交前请再检查一遍。',
    '',
    `- 文本类文件：${textFiles} 个；状态：${run.status}；模型：${settings.modelConfigured ? '已配置' : '未配置（仅规则层）'}；思考模式：${settings.disableThinking ? '关闭' : '开启'}`,
    `- 核验轮次上限 ${settings.maxRounds}，模型并发 ${settings.concurrency}，超时 ${Math.round(settings.timeoutMs / 1000)} 秒，每组 ${settings.maxFiles ?? '—'} 个文件`,
    '',
    '## 发现的问题',
    '',
  ]
  for (const finding of findings) {
    lines.push(`- **${finding.area}**：${finding.detail}`)
    lines.push(`  - 可能的方向：${finding.hint}`)
  }
  lines.push('')
  return lines.join('\n')
}
