/**
 * Human-readable batch report. Original identifier values never appear here:
 * the report references pseudonyms, and the vault is the only store that maps
 * them back.
 */

const IDENTIFIER_LABEL = { pseudonym: '稳定假名', mask: '部分遮盖', redact: '类型标签', keep: '保留' }
const QUASI_LABEL = {
  keep: '保留', shift: '整体平移', month: '只保留年月', year: '只保留年份',
  band10: '10 岁分段', band5: '5 岁分段', prefix3: '只保留前 3 位', redact: '类型标签',
}

function describeIdentifiers(policy) {
  const entries = Object.entries(policy?.identifiers ?? {})
  if (entries.length === 0 || entries.every(([, strategy]) => strategy === 'pseudonym')) return '全部稳定假名'
  const groups = new Map()
  for (const [type, strategy] of entries) {
    if (!groups.has(strategy)) groups.set(strategy, [])
    groups.get(strategy).push(type)
  }
  return [...groups].map(([strategy, types]) => `${IDENTIFIER_LABEL[strategy] ?? strategy}（${types.join('、')}）`).join('；')
}

/** Quasi types actually processed (older runs have no quasiActive). */
function activeQuasi(policy) {
  return policy?.quasiActive ?? (policy?.quasiEnabled ? policy.quasi ?? {} : {})
}

function describeQuasi(policy) {
  const active = activeQuasi(policy)
  if (Object.keys(active).length === 0) return '未处理'
  return Object.entries(active).map(([type, strategy]) => `${type}：${QUASI_LABEL[strategy] ?? strategy}`).join('；')
}

const STATUS_LABEL = {
  completed: '完成',
  review: '完成，但存在待复核项',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断（可继续处理）',
  running: '运行中',
  clean: '通过',
}

export function renderMarkdown(run) {
  const lines = []
  const push = (line = '') => lines.push(line)

  push('# 医疗数据匿名化报告')
  push()
  push(`- 批次：\`${run.id}\``)
  push(`- 状态：**${STATUS_LABEL[run.status] ?? run.status}**`)
  push(`- 开始：${run.startedAt}`)
  push(`- 结束：${run.finishedAt ?? '—'}`)
  push(`- 输入：\`${run.inputDir}\``)
  if (run.selection?.length) push(`- 所选项目（${run.selection.length} 项）：${run.selection.slice(0, 20).map((name) => `\`${name}\``).join('、')}${run.selection.length > 20 ? ' …' : ''}`)
  if (run.outputs?.length > 1) {
    push(`- 交付数据（${run.outputs.length} 项，只含匿名化后的数据，可直接取用）：`)
    for (const item of run.outputs.slice(0, 50)) push(`  - \`${item}\``)
  } else if (run.output) push(`- 交付数据：\`${run.output}\`（只含匿名化后的数据，可直接取用）`)
  else if (run.withheld) push(`- 交付数据：**暂扣**（存在待复核项，在 \`${run.runDir}/output\`，处理完全部复核项后才放到输出根目录）`)
  else if (run.status === 'completed' || run.status === 'review') push('- 交付数据：无（没有可处理的文件）')
  else push(`- 交付数据：未生成（批次未完成，部分结果见 \`${run.runDir}/output\`）`)
  push(`- 报告与记录：\`${run.runDir ?? run.outputRoot}\``)
  if (run.vaultPath) push(`- 映射库：\`${run.vaultPath}\`（敏感，请与交付数据分开保管）`)
  const coverage = run.totals?.coverage
  if (coverage?.files) {
    push(`- 检查覆盖：${coverage.files} 个文本类文件全部转成文字检查${coverage.decoded ? `，其中 ${coverage.decoded} 字是解码编码内容（base64、HTML 等）后检查的` : ''}；无法检查的内容 ${coverage.opaque} 处${coverage.opaque ? `（约 ${Math.max(1, Math.round(coverage.opaqueBytes / 1024))} KB），已转人工复核或按配置移除，不计为通过` : ''}`)
  }
  push(`- 模型：${run.config?.model ? `\`${run.config.model}\`` : '未配置（仅规则层）'}`)
  push(`- 端点：${run.config?.baseURL ? `\`${run.config.baseURL}\`` : '—'}`)
  if (run.config?.verifyModel) push(`- 核验模型：\`${run.config.verifyModel}\`（独立核验）`)
  push(`- 思考模式：${run.config?.modelConfigured ? (run.config?.disableThinking ? '关闭（enable_thinking=false）' : '开启') : '—'}`)
  push(`- 轮次上限：${run.config?.maxRounds ?? '—'}`)
  push(`- 标识符处理：${describeIdentifiers(run.config?.policy)}`)
  push(`- 准标识符处理：${describeQuasi(run.config?.policy)}`)
  push(`- 模型调用：${run.totals?.modelCalls ?? 0} 次（不设上限）${run.totals?.replayedCalls ? `，另复用上次中断批次的结果 ${run.totals.replayedCalls} 次` : ''}`)
  if (run.resumedFrom) {
    const switched = run.resumedFromModel && run.resumedFromModel !== (run.config?.model ?? '')
    push(`- 续跑自：\`${run.resumedFrom}\`${switched ? `（原模型 \`${run.resumedFromModel}\`，已完成部分沿用原模型的结果，其余由 \`${run.config?.model || '规则层'}\` 处理）` : ''}`)
  }
  if (run.resumable) push('- 本批次未完成，可在看板上「继续处理」：已完成的模型调用会直接复用。')
  if (run.config?.concurrency) push(`- ${run.config.verifyConcurrency ? '识别并发' : '模型并发'}：${run.config.concurrency}`)
  if (run.config?.verifyConcurrency) push(`- 核验并发：${run.config.verifyConcurrency}`)
  if (run.config?.autoConcurrency) {
    const names = { detect: run.config.verifyConcurrency ? '识别' : '模型', verify: '核验' }
    const reasons = { up: '满载加并发', flat: '吞吐不再上升，退回', server: '服务器排队或 KV 将满，试降一档', back: '降低后吞吐下降，回升', errors: '出现超时或连接错误' }
    const parts = Object.entries(run.autoTune ?? {}).map(([key, state]) => {
      const path = [state.start, ...(state.history ?? []).map((step) => step.to)].join('→')
      const lastReason = state.history?.length ? `（最后一次：${reasons[state.history[state.history.length - 1].reason] ?? ''}）` : '（未调整）'
      return `${names[key] ?? key} ${path}${lastReason}`
    })
    push(`- 自动调并发：${parts.length ? parts.join('；') : '已开启'}`)
  }
  if (run.config?.chunkSize) push(`- 每组文件数：${run.config.chunkSize}`)
  if (run.config?.timeoutMs) push(`- 模型超时：${Math.round(run.config.timeoutMs / 1000)} 秒`)
  if (run.config?.temperature !== undefined) push(`- 温度：${run.config.temperature}`)
  if (run.config?.overridden?.length) {
    const names = { maxRounds: '核验轮次上限', concurrency: '识别并发', verifyConcurrency: '核验并发', autoConcurrency: '自动调并发', maxFiles: '每组文件数', timeoutMs: '模型超时', temperature: '温度', disableThinking: '关闭思考模式', quasiIdentifiers: '处理准标识符' }
    push(`- 本批单独设置（与默认值不同）：${run.config.overridden.map((key) => names[key] ?? key).join('、')}`)
  }
  if (run.memory?.heapLimit) {
    const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`
    push(`- 内存：堆峰值 ${gb(run.memory.peakHeap)} / 上限 ${gb(run.memory.heapLimit)}（${Math.round((run.memory.peakHeap / run.memory.heapLimit) * 100)}%），进程常驻峰值 ${gb(run.memory.peakRss)}`)
  }
  if ((run.chunks ?? 1) > 1) push(`- 分组：${run.chunks} 组（每组最多 ${run.config?.chunkSize ?? '—'} 个文件，共用映射库）`)
  if ((run.archives ?? []).length > 0) push(`- 压缩包：${run.archives.length} 个（含嵌套），已解压，按同名文件夹交付（不再打包）`)
  if (run.paths?.renamed) push(`- 文件名/目录名：${run.paths.renamed} 处含标识符，已替换（对照表在 _records/records.sqlite，敏感）`)
  if (run.totals?.distinctIds) push(`- 发现标识符（去重）：${run.totals.distinctIds} 个不同的原值；共替换 ${run.totals?.entities ?? 0} 处`)
  if (run.totals?.newMappings !== undefined) push(`- 本批新增映射：${run.totals.newMappings} 条（可用 anonymize_undo_mappings 撤销）`)
  if (run.sourceCheck) {
    push(`- 源文件检查：${run.sourceCheck.changed === 0 ? `${run.sourceCheck.files} 个源文件运行前后一致 ✓` : `⚠️ ${run.sourceCheck.changed} 个源文件在运行期间发生变化`}`)
  }
  push(`- 耗时：${formatDuration(run.durationMs)}`)
  push()

  if (!run.config?.modelConfigured) {
    push('> ⚠️ 本次运行未配置本地模型，仅执行了确定性规则层。召回率会明显低于“模型发现 + 复核”模式，建议配置模型后重跑。')
    push()
  }
  if ((run.warnings ?? []).length > 0) {
    push('## 注意')
    push()
    for (const warning of run.warnings) push(`- ⚠️ ${warning}`)
    push()
  }
  push('> 映射库包含原文与假名的对应关系，属于高敏感资产。报告不包含完整原值（部分遮盖策略下会显示遮盖后的值），请将映射库与输出数据分开保管。')
  push()

  push('## 汇总')
  push()
  push('| 文件 | 实体替换 | 待复核问题 | 失败文件 | 未处理文件 |')
  push('| --- | --- | --- | --- | --- |')
  const notProcessed = (run.skipped?.unsupported ?? 0) + (run.skipped?.overLimit ?? 0) + (run.skipped?.dicomdir ?? 0) + (run.skipped?.zipFailed ?? 0)
  push(`| ${run.totals?.files ?? 0} | ${run.totals?.entities ?? 0} | ${run.totals?.unresolved ?? 0} | ${run.totals?.filesFailed ?? 0} | ${notProcessed} |`)
  push()

  const byType = Object.entries(run.totals?.byType ?? {}).sort((a, b) => b[1] - a[1])
  if (byType.length > 0) {
    push('### 实体类型分布')
    push()
    push('| 类型 | 次数 |')
    push('| --- | --- |')
    for (const [type, count] of byType) push(`| ${type} | ${count} |`)
    push()
  }

  const quasiTotals = Object.entries(run.totals?.quasi ?? {})
  if (Object.keys(activeQuasi(run.config?.policy)).length > 0) {
    push(run.config?.policy?.quasiEnabled ? '### 准标识符处理' : '### 邮编处理')
    push()
    if (quasiTotals.length === 0) {
      push(run.config?.policy?.quasiEnabled ? '未发现需要处理的准标识符。' : '未发现需要处理的邮编。')
    } else {
      push('| 类型 | 处理方式 | 次数 |')
      push('| --- | --- | --- |')
      for (const [type, count] of quasiTotals) {
        const strategy = run.config.policy.quasi?.[type]
        push(`| ${type} | ${QUASI_LABEL[strategy] ?? strategy ?? '—'} | ${count} |`)
      }
    }
    push()
  }

  const dicom = run.totals?.dicom
  if (dicom) {
    const dicomSettings = run.config?.dicom ?? {}
    push('## DICOM 影像（元数据）')
    push()
    push(`- 文件：${dicom.files} 个；模态：${Object.entries(dicom.modalities ?? {}).map(([name, count]) => `${name}×${count}`).join('、') || '—'}`)
    push('- 规则：DICOM PS3.15 附录 E 基础去标识配置；姓名、各类 ID、机构、设备序列号、备注类字段删除或清空；私有字段全部删除；像素数据逐字节保留')
    push(`- 日期：${QUASI_LABEL[dicomSettings.dates] ?? dicomSettings.dates ?? '—'}（出生日期始终清空）；年龄：${dicomSettings.age === 'keep' ? '保留（≥90 岁写为 090Y）' : QUASI_LABEL[dicomSettings.age] ?? '—'}；性别：${QUASI_LABEL[dicomSettings.sex] ?? '—'}`)
    push('- PatientID：替换为本批次内一致的随机编号（密钥不保存，不可回查）；UID：重新生成为 2.25.* 并保持互相引用')
    push()
    push('| 删除字段 | 清空字段 | 私有字段 | 重映射 UID | 日期改动 | PatientID | 含疑似标识符被删的文字字段 |')
    push('| --- | --- | --- | --- | --- | --- | --- |')
    push(`| ${dicom.removed} | ${dicom.emptied} | ${dicom.privateRemoved} | ${dicom.uidsRemapped} | ${dicom.datesChanged} | ${dicom.patientIds} | ${dicom.textRemoved} |`)
    push()
    const byDir = new Map()
    for (const file of (run.files ?? []).filter((item) => item.kind === 'dicom')) {
      const dir = file.relPath.includes('/') ? file.relPath.slice(0, file.relPath.lastIndexOf('/')) : '.'
      const entry = byDir.get(dir) ?? { files: 0, bytes: 0, problems: 0 }
      entry.files += 1
      entry.bytes += file.bytes ?? 0
      if (file.status !== 'clean') entry.problems += 1
      byDir.set(dir, entry)
    }
    push('| 目录 | 文件 | 大小 | 有问题 |')
    push('| --- | --- | --- | --- |')
    const dirs = [...byDir]
    for (const [dir, entry] of dirs.slice(0, 200)) push(`| ${dir} | ${entry.files} | ${formatBytes(entry.bytes)} | ${entry.problems} |`)
    if (dirs.length > 200) push(`| …其余 ${dirs.length - 200} 个目录 | | | |`)
    push()
  }

  push('## 文件明细')
  push()
  if ((run.files ?? []).length === 0) {
    push('本次运行没有处理任何文件。')
    push()
  }
  const quietDicom = (run.files ?? []).filter((file) => file.kind === 'dicom' && file.status === 'clean' && (file.issues ?? []).length === 0).length
  if (quietDicom > 0) {
    push(`${quietDicom} 个 DICOM 文件全部校验通过，不逐一列出（明细见 report.json）。`)
    push()
  }
  for (const file of run.files ?? []) {
    if (file.kind === 'dicom' && file.status === 'clean' && (file.issues ?? []).length === 0) continue
    if (file.kind === 'dicom') {
      push(`### ${file.relPath}`)
      push()
      push(`- 类型：DICOM ${file.dicom?.modality ?? ''}（${file.dicom?.transferSyntax ?? '—'}）｜ 大小：${formatBytes(file.bytes)} ｜ 状态：${STATUS_LABEL[file.status] ?? file.status}`)
      push()
      const checks = file.structure?.checks ?? []
      if (checks.length > 0) {
        push(`校验：${checks.map((check) => `${check.name}${check.ok ? '✓' : '✗'}（${check.detail}）`).join('；')}`)
        push()
      }
      if ((file.issues ?? []).length > 0) {
        push('问题：')
        for (const issue of file.issues) push(`- ${issue.severity === 'error' ? '❌' : '⚠️'} ${issue.detail}`)
        push()
      }
      continue
    }
    push(`### ${file.relPath}`)
    push()
    push(`- 类型：${file.kind} ｜ 大小：${formatBytes(file.bytes)} ｜ 状态：${STATUS_LABEL[file.status] ?? file.status}`)
    push(`- 轮次：${file.rounds} ｜ 模型调用：${file.modelCalls ?? 0} ｜ 耗时：${formatDuration(file.durationMs)}`)
    push()
    if ((file.entities ?? []).length > 0) {
      push('| 类型 | 替换为 | 次数 | 来源 |')
      push('| --- | --- | --- | --- |')
      for (const entity of file.entities) {
        push(`| ${entity.type} | ${entity.pseudonym} | ${entity.count} | ${entity.sources.join(' + ')} |`)
      }
      push()
    } else {
      push('未发现直接标识符。')
      push()
    }
    const checks = file.structure?.checks ?? []
    if (checks.length > 0) {
      push(`结构校验：${file.structure?.ok ? '通过' : '未通过'} — ${checks.map((check) => `${check.name}${check.ok ? '✓' : '✗'}（${check.detail}）`).join('；')}`)
      push()
    }
    if ((file.issues ?? []).length > 0) {
      push('问题：')
      for (const issue of file.issues) {
        push(`- ${issue.severity === 'error' ? '❌' : '⚠️'} ${issue.detail}`)
      }
      push()
    }
  }

  const reviewFiles = (run.files ?? []).filter((file) => (file.issues ?? []).some((issue) => issue.severity === 'error'))
  const warnFiles = (run.files ?? []).filter((file) => file.status !== 'failed'
    && (file.issues ?? []).some((issue) => issue.severity === 'warn'))
  if (reviewFiles.length > 0 || warnFiles.length > 0) {
    push('## 人工复核清单')
    push()
    if (run.review?.files) {
      push(`待复核文件的匿名化副本已单独放在 \`${run.review.dir}\`（与交付数据分开，zip 内的文件也已取出），目录结构同交付数据。`)
      push()
    }
    for (const file of reviewFiles) push(`- [ ] ${file.relPath}：存在未解决的错误项，不要直接发布`)
    for (const file of warnFiles.slice(0, 500)) push(`- [ ] ${file.relPath}：存在提示项（${file.kind === 'dicom' ? '字段格式异常/含疑似标识符的文字被删除' : '定位失败/疑似证件/模型输出异常'}）`)
    if (warnFiles.length > 500) push(`- [ ] …其余 ${warnFiles.length - 500} 个提示项文件见 report.json`)
    push()
  }

  const profiled = Object.values(run.profileSummary ?? {})
  if (profiled.length > 0) {
    const label = { identifier: '标识符列（整列替换）', vocabulary: '临床词表（按列盲审）', code: '编码（按列盲审）', freetext: '自由文本（逐段识别）', uncertain: '不确定（逐值识别）' }
    push('## 字段画像')
    push()
    push('结构化文件按列判断一次字段性质：标识符列整列替换；词表 / 编码列不逐值识别，由规则扫描，并由独立盲审按列检查；其余逐值识别。')
    push()
    push('| 字段 | 判断 | 类型 | 不同取值 | 文件数 |')
    push('|---|---|---|---|---|')
    for (const item of profiled.sort((a, b) => a.field.localeCompare(b.field)).slice(0, 200)) {
      push(`| \`${item.field}\` | ${label[item.category] ?? item.category} | ${item.type ?? '—'} | ${item.distinct || '—'} | ${item.files || '—'} |`)
    }
    push()
  }

  const blind = run.totals?.blind
  if (blind?.reported || blind?.calls) {
    const judged = (blind.confirmed ?? 0) + (blind.dismissed ?? 0) + (blind.disputed ?? 0)
    push('## 交叉核验')
    push()
    if (blind.items !== undefined) {
      const f = blind.filtered ?? {}
      const filtered = (f.format ?? 0) + (f.pseudonym ?? 0) + (f.invalid ?? 0) + (f.allowed ?? 0)
      push(`- 盲审调用 ${blind.calls ?? 0} 次，其中 ${blind.flaggedCalls ?? 0} 次有报出，共报出 ${blind.items} 条`)
      push(`- 规则过滤 ${filtered} 条（格式不符 ${f.format ?? 0} · 假名片段 ${f.pseudonym ?? 0} · 无效条目 ${f.invalid ?? 0} · 白名单/保留 ${f.allowed ?? 0}）`)
      push(`- 无法定位 ${blind.unlocated ?? 0} 条（转人工复核）`)
      push(`- 进入复判 ${blind.reported ?? 0} 条：确认 ${blind.confirmed ?? 0} · 误报 ${blind.dismissed ?? 0} · 分歧 ${blind.disputed ?? 0} · 未复判 ${blind.unjudged ?? 0}`)
    } else {
      // Batches from before the itemized accounting.
      push(`- 独立盲审报出 ${blind.reported ?? 0} 项（${blind.flaggedCalls ?? 0} / ${blind.calls ?? 0} 次盲审调用有报出）`)
      push(`- 识别模型复判：确认 ${blind.confirmed ?? 0} · 误报 ${blind.dismissed ?? 0} · 分歧 ${blind.disputed ?? 0} · 未复判 ${blind.unjudged ?? 0}`)
    }
    if (judged >= 5) push(`- 一致率：${Math.round(((blind.confirmed ?? 0) / judged) * 100)}%（确认 ÷ 已复判）`)
    else if (judged > 0) push(`- 一致率：已复判仅 ${judged} 条，样本太少不计算`)
    if (run.humanReview?.verifierRight !== undefined) push(`- 人工裁定：核验对 ${run.humanReview.verifierRight} · 识别对 ${run.humanReview.detectorRight}`)
    if (!run.config?.verifyModel) push('- 注：未配置独立核验模型，盲审由识别模型兼任，以上数字只反映同一模型的前后两次判断。')
    push()
  }

  if (run.imageCheck) {
    const check = run.imageCheck
    const CATEGORY = {"signature": "手写签名", "seal": "印章", "face": "人脸 / 证件照", "id_document": "证件", "scanned_text": "扫描文字", "medical_image": "检查图像", "chart": "图表", "logo": "徽标", "blank": "空白", "other": "其他"}
    const SUGGESTION = { remove: '建议移除', keep: '建议保留', unknown: '需人工判断' }
    push('## 图片识别')
    push()
    push(`模型 ${check.model ?? '—'} 识别了待复核的嵌入图片（只给建议，处理以人工复核为准）：`)
    push()
    push(`- 图片 ${check.images} 项，已识别 ${check.checked} 项${check.failed ? `，识别失败 ${check.failed} 项` : ''}；模型调用 ${check.calls} 次（相同图片只发一次），Token ${check.tokens}`)
    const cats = Object.entries(check.categories ?? {}).sort((x, y) => y[1] - x[1]).map(([key, n]) => `${CATEGORY[key] ?? key} ${n}`).join('，')
    if (cats) push(`- 类别：${cats}`)
    const sugg = Object.entries(check.suggestions ?? {}).map(([key, n]) => `${SUGGESTION[key] ?? key} ${n}`).join('，')
    if (sugg) push(`- 建议：${sugg}`)
    push()
  }

  if (run.manualEdits && (run.manualEdits.reverted?.count || run.manualEdits.added?.count)) {
    push('## 人工修改')
    push()
    push('复核时在结果比对中直接做的修改（明细在 `_records/records.sqlite` 的 manual_edits 表，只记假名、类型和处数）：')
    push()
    push(`- 误报还原：${run.manualEdits.reverted?.values ?? 0} 个假名还原为原文，共 ${run.manualEdits.reverted?.count ?? 0} 处`)
    push(`- 漏报补替换：${run.manualEdits.added?.values ?? 0} 个值替换为假名，共 ${run.manualEdits.added?.count ?? 0} 处`)
    push()
  }

  if (run.humanReview) {
    push('## 人工复核记录')
    push()
    push(`- 复核时间：${run.humanReview.at}`)
    push(`- 复核项：${run.humanReview.items} 项，其中替换为假名 ${run.humanReview.replaced} 项，确认保留 ${run.humanReview.accepted} 项`)
    push('- 逐项决定（含每次改动）在 `_records/records.sqlite` 的 review_decisions、review_log 表（权限 600）。')
    push()
  }

  if (run.advice) {
    push('## 改进建议')
    push()
    for (const item of run.advice.suggestions) push(`- ${item.level === 'confirm' ? '（需确认）' : ''}${item.title}`)
    if (run.advice.findings > 0) push(`- 发现 ${run.advice.findings} 项无法靠设置解决的问题，已生成插件改进草稿（不含原值）`)
    push()
    push('在「医疗数据匿名化」页面右下角的「改进建议」中查看理由并一键采纳；详情在 `_records/records.sqlite` 的 run_docs 表（含候选原值，权限 600，与映射库同样敏感）。')
    push()
  }

  push('## 合规提示')
  push()
  if (run.config?.policy?.quasiEnabled) {
    push('- 本次同时处理了准标识符（见上方「准标识符处理」）；科室、机构代码、诊断组合等其他准标识符仍未处理，仍可能参与重识别。')
  } else {
    push('- 本次只处理了直接标识符和邮编；日期、年龄、性别等准标识符未做泛化，仍可能参与重识别。可在设置中开启准标识符处理。')
  }
  push('- 若需对外发布，建议同时评估《个人信息保护法》《GB/T 35273》《GB/T 39725-2020 健康医疗数据安全指南》以及目标场景的 HIPAA 18 项标识符要求。')
  push('- 映射库与输出数据应分权保管；映射库丢失将无法还原，泄露则等同原文泄露。')
  push('- 文件名和目录名中识别到的标识符（含正文中识别到、以分隔符隔开的姓名和编号）已替换为与正文一致的假名；与其他文字连写、没有分隔符的姓名可能识别不到，发布前请检查文件名。')
  push()
  push('---')
  push()
  push(`生成时间：${new Date().toISOString()}`)
  return lines.join('\n')
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes} min ${seconds} s`
}
