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

function describeQuasi(policy) {
  if (!policy?.quasiEnabled) return '未处理'
  return Object.entries(policy.quasi ?? {}).map(([type, strategy]) => `${type}：${QUASI_LABEL[strategy] ?? strategy}`).join('；')
}

const STATUS_LABEL = {
  completed: '完成',
  review: '完成，但存在待复核项',
  failed: '失败',
  cancelled: '已取消',
  running: '运行中',
  clean: '通过',
}

export function renderMarkdown(run) {
  const lines = []
  const push = (line = '') => lines.push(line)

  push('# 医疗数据匿名化报告')
  push()
  push(`- 批次：\`${run.id}\``)
  push(`- 状态：**${STATUS_LABEL[run.status] ?? run.status}**${run.dryRun ? '（演练模式，未写出数据）' : ''}`)
  push(`- 开始：${run.startedAt}`)
  push(`- 结束：${run.finishedAt ?? '—'}`)
  push(`- 输入：\`${run.inputDir}\``)
  push(`- 输出：\`${run.runDir ?? run.outputRoot}\``)
  push(`- 模型：${run.config?.model ? `\`${run.config.model}\`` : '未配置（仅规则层）'}`)
  push(`- 端点：${run.config?.baseURL ? `\`${run.config.baseURL}\`` : '—'}`)
  push(`- 思考模式：${run.config?.modelConfigured ? (run.config?.disableThinking ? '关闭（enable_thinking=false）' : '开启') : '—'}`)
  push(`- 轮次上限：${run.config?.maxRounds ?? '—'}`)
  push(`- 标识符处理：${describeIdentifiers(run.config?.policy)}`)
  push(`- 准标识符处理：${describeQuasi(run.config?.policy)}`)
  push(`- 模型调用：${run.totals?.modelCalls ?? 0} 次`)
  push(`- 耗时：${formatDuration(run.durationMs)}`)
  push()

  if (!run.config?.modelConfigured) {
    push('> ⚠️ 本次运行未配置本地模型，仅执行了确定性规则层。召回率会明显低于“模型发现 + 复核”模式，建议配置模型后重跑。')
    push()
  }
  if (run.dryRun) {
    push('> 演练模式：只做检测、假名化与结构校验，磁盘上没有写出任何匿名化数据文件，也没有更新映射库。')
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
  const notProcessed = (run.skipped?.unsupported ?? 0) + (run.skipped?.overLimit ?? 0)
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
  if (run.config?.policy?.quasiEnabled) {
    push('### 准标识符处理')
    push()
    if (quasiTotals.length === 0) {
      push('未发现需要处理的准标识符。')
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

  push('## 文件明细')
  push()
  if ((run.files ?? []).length === 0) {
    push('本次运行没有处理任何文件。')
    push()
  }
  for (const file of run.files ?? []) {
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
    for (const file of reviewFiles) push(`- [ ] ${file.relPath}：存在未解决的错误项，不要直接发布`)
    for (const file of warnFiles) push(`- [ ] ${file.relPath}：存在提示项（定位失败/疑似证件/模型输出异常）`)
    push()
  }

  push('## 合规提示')
  push()
  if (run.config?.policy?.quasiEnabled) {
    push('- 本次同时处理了准标识符（见上方「准标识符处理」）；科室、机构代码、诊断组合等其他准标识符仍未处理，仍可能参与重识别。')
  } else {
    push('- 本次只处理了直接标识符；日期、年龄、性别、邮编等准标识符未做泛化，仍可能参与重识别。可在设置中开启准标识符处理。')
  }
  push('- 若需对外发布，建议同时评估《个人信息保护法》《GB/T 35273》《GB/T 39725-2020 健康医疗数据安全指南》以及目标场景的 HIPAA 18 项标识符要求。')
  push('- 映射库与输出数据应分权保管；映射库丢失将无法还原，泄露则等同原文泄露。')
  push('- 文件名和目录名按原样复制，不做假名化；若文件名本身含姓名、证件号等，请在发布前重命名。')
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
