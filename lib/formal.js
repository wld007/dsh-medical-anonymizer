/**
 * The formal anonymization assessment report (Word): processing strategy,
 * "cannot identify" (identifier check, K / A, level), "cannot restore",
 * adversarial test, overall evaluation and sign-off. No regional
 * specification is named; the basis line is a setting (assessBasis).
 *
 * The tool fills in what it can measure. The evaluation itself has to come
 * from a person independent of the processing, so
 * the adversarial test, the overall conclusion and the signatures are left
 * for people: the report is issued as a draft awaiting sign-off.
 *
 * No original values: pseudonyms, column names, counts and paths only.
 */
import { join } from 'node:path'
import { SCENES, identificationLevel } from './assess.js'
import { writeDocx } from './docx.js'

export const FORMAL_REPORT_NAME = '匿名化效果评估报告.docx'

const ID_TECH = {
  pseudonym: '假名化（密钥派生的稳定假名，对照表存于映射库）',
  mask: '字符遮盖',
  redact: '属性删除（置为类型标签）',
  keep: '未处理（保留原值）',
}
const QUASI_TECH = {
  keep: '未处理（保留原值）',
  shift: '扰动（同一偏移量整体平移，间隔不变）',
  month: '泛化（只保留年月）',
  year: '泛化（只保留年份）',
  band10: '泛化（10 岁分段）',
  band5: '泛化（5 岁分段）',
  prefix3: '字符遮盖（只保留前 3 位）',
  redact: '属性删除（置为类型标签）',
}
// Identifier groups (names, ID numbers, medical record numbers, contacts…).
const ID_GROUP = {
  姓名: '姓名', 医生: '姓名', 身份证号: '证件号码', 社保号: '证件号码', 病历号: '医疗身份号码', 住院号: '医疗身份号码', 就诊号: '医疗身份号码',
  电话: '联系方式', 邮箱: '联系方式', 地址: '详细住址', 银行卡号: '其他（支付账号）', 医院: '健康事件地点（机构）',
}

const red = (text) => ({ text: String(text), red: true, bold: true })
const ok = (text) => ({ text: String(text), color: '1E7B45', bold: true })
const num = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : String(Math.round(Number(value) * 100) / 100))
const fmtTime = (iso) => {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Direct identifiers may remain: kept by policy, or review items still open. */
export function directRemaining(run) {
  const kept = Object.values(run.config?.policy?.identifiers ?? {}).includes('keep')
  return kept || run.withheld === true || (run.status === 'review' && !run.humanReview)
}

/** One-line state for lists and the page. */
export function assessmentSummary(run) {
  const a = run.assessment
  if (!a) return null
  const level = identificationLevel(a, { directRemaining: directRemaining(run) })
  return {
    computed: a.datasets.length > 0,
    k: a.k,
    a: a.a,
    pass: a.pass,
    requiredK: a.requiredK,
    level: level.level,
    levelReason: level.reason,
    final: !run.withheld,
  }
}

export function formalBlocks(run, { version = '' } = {}) {
  const a = run.assessment
  const policy = run.config?.policy ?? {}
  const level = identificationLevel(a, { directRemaining: directRemaining(run) })
  const draftNote = run.withheld
    ? '本报告为初稿：批次尚有待复核项，交付数据暂扣；复核全部完成后会按最终数据重新计算并更新本报告。'
    : '本报告为待签署稿：第三章“无法识别”由工具按交付数据计算；第四章至第六章需由评价/批准责任人核验、补充并签署后生效。'
  const blocks = []
  const P = (runs) => blocks.push({ type: 'p', runs })
  const H1 = (runs) => blocks.push({ type: 'h1', runs })
  const H2 = (runs) => blocks.push({ type: 'h2', runs })
  const N = (runs) => blocks.push({ type: 'note', runs })
  const T = (widths, rows, extra = {}) => blocks.push({ type: 'table', widths, rows, ...extra })

  blocks.push({ type: 'title', runs: '健康医疗数据匿名化效果评估报告' })
  blocks.push({ type: 'subtitle', runs: `参考依据：${a.basis}` })
  T([2600, 7000], [
    ['项目', '内容'],
    ['报告编号', run.id],
    ['生成时间', fmtTime(new Date().toISOString())],
    ['报告状态', run.withheld ? red('初稿（待复核完成后更新）') : '待评价/批准责任人核验签署'],
    ['处理工具', `dsh-medical-anonymizer${version ? ` ${version}` : ''}`],
  ])
  N(draftNote)

  // ── 一、基本信息 ─────────────────────────────────────────────────────
  H1('一、基本信息')
  const byKind = {}
  for (const file of run.files ?? []) byKind[file.kind ?? '其他'] = (byKind[file.kind ?? '其他'] ?? 0) + 1
  const kindText = Object.entries(byKind).map(([kind, n]) => `${{ text: '文本', csv: 'CSV', json: 'JSON', xlsx: 'Excel', dicom: 'DICOM' }[kind] ?? kind} ${n}`).join('、') || '—'
  T([2600, 7000], [
    ['项目', '内容'],
    ['数据来源（输入）', String(run.inputDir ?? '—')],
    ['交付位置', run.output ? String(run.output) : run.withheld ? red('暂扣，复核完成后交付') : '—'],
    ['处理时间', `${fmtTime(run.startedAt)} 至 ${fmtTime(run.finishedAt)}`],
    ['文件数量', `${run.totals?.files ?? 0} 个（${kindText}）`],
    ['使用场景', `${a.scene.share} · ${a.scene.label}`],
    ['处理方式', run.config?.modelConfigured ? `规则 + 本地/内网模型识别（${run.config.model}${run.config.verifyModel ? `，独立核验 ${run.config.verifyModel}` : ''}），逐文件多轮核验` : '仅确定性规则（未配置模型）'],
  ])

  // ── 二、匿名化处理策略 ───────────────────────────────────────────────
  H1('二、匿名化处理策略')
  H2('2.1 直接标识符')
  const idRows = [['类别', '标识符类型', '处理技术', '本批替换次数']]
  for (const [type, strategy] of Object.entries(policy.identifiers ?? {})) {
    idRows.push([ID_GROUP[type] ?? '其他', type, strategy === 'keep' ? red(ID_TECH.keep) : ID_TECH[strategy] ?? strategy, String(run.totals?.byType?.[type] ?? 0)])
  }
  T([2000, 1700, 4300, 1600], idRows)
  H2('2.2 准标识符')
  const active = policy.quasiActive ?? {}
  const quasiRows = [['准标识符', '处理技术', '本批处理次数']]
  for (const [type, strategy] of Object.entries(policy.quasi ?? {})) {
    const on = type in active
    quasiRows.push([type, on ? QUASI_TECH[strategy] ?? strategy : '未处理（未开启准标识符处理）', String(run.totals?.quasi?.[type] ?? 0)])
  }
  T([2200, 5600, 1800], quasiRows)
  if (run.totals?.dicom) {
    H2('2.3 DICOM 标签')
    const d = run.totals.dicom
    P(`参照 DICOM PS3.15 附录 E 基础去标识化配置：姓名、各类 ID、机构名称、设备序列号等属性删除或置空；私有标签全部删除（${d.privateRemoved} 个）；Study / Series / SOP Instance UID 重新生成（${d.uidsRemapped} 个）；PatientID 替换为不可回查的随机编号；日期按设置处理（${d.datesChanged} 处）；像素数据不修改。共 ${d.files} 个文件。`)
  }
  if (policy.skipFields?.length) P([red('按配置不处理的字段：'), policy.skipFields.join('、')])

  // ── 三、无法识别评价 ─────────────────────────────────────────────────
  H1('三、无法识别评价')
  H2('3.1 标识符识别')
  const unresolved = run.withheld ? (run.totals?.unresolved ?? 0) : 0
  P([
    `采用规则判定${run.config?.modelConfigured ? '、模型识别与独立盲审' : ''}逐文件识别直接标识符，共替换 ${run.totals?.entities ?? 0} 处、${run.totals?.distinctIds ?? 0} 个不同的原值。`,
    run.humanReview ? `人工复核 ${run.humanReview.items} 项（替换 ${run.humanReview.replaced} 项，确认保留 ${run.humanReview.accepted} 项）已全部完成。` : '',
    unresolved ? red(`尚有 ${unresolved} 项待人工复核。`) : (!run.humanReview ? '无待复核项。' : ''),
  ])
  H2('3.2 匿名化度量参数')
  P(`计算公式：A = K × S × E（A ≥ 1 时认为满足匿名化要求）。K 为交付数据中准标识符组合相同的最少个体数；S 为场景系数（见附表）；E 为环境系数（中间值 1）。`)
  T([2600, 7000], [
    ['参数', '取值'],
    ['场景系数 S', `${a.scene.factor}（${a.scene.share} · ${a.scene.label}）`],
    ['环境系数 E', `${num(a.environment)}（${a.environment === 1 ? '按中间值取，' : ''}需评价责任人按技术与管理保障能力确认）`],
    ['达标所需 K', `≥ ${a.requiredK}`],
    ['K 匿名值（最低）', a.k === null ? '未计算' : a.pass ? ok(a.k) : red(a.k)],
    ['匿名化程度 A', a.a === null ? '未计算' : a.pass ? ok(`${num(a.a)}（达到要求）`) : red(`${num(a.a)}（未达到要求）`)],
  ])
  if (a.datasets.length > 0) {
    const rows = [['数据集', '记录 / 个体', '准标识符列（不同取值数）', 'K', 'A', 'L', 'T', '结论']]
    for (const item of a.datasets) {
      const bad = !item.pass
      const cell = (text) => (bad ? red(text) : String(text))
      rows.push([
        item.name,
        `${item.records} / ${item.persons ?? '—'}`,
        item.columns.map((column) => `${column.name}(${column.distinct})`).join('、'),
        cell(item.k),
        cell(num(item.a)),
        item.l ?? '—',
        item.t ?? '—',
        bad ? red('未达标') : ok('达标'),
      ])
    }
    T([2400, 1100, 2800, 600, 700, 500, 600, 900], rows)
    N('有人员标识列时 K 按个体计（同一个体多条记录只算一次）；L 为 L-多样性、T 为 T-接近性，仅在有诊断类敏感属性时计算。同结构的多个文件合并为一个数据集。')
    const failing = a.datasets.filter((item) => !item.pass)
    if (failing.length) {
      H2('3.3 未达标说明与建议')
      for (const item of failing) {
        P([red(`${item.name}：`), `K = ${item.k}，${item.below.classes} 个等价类（${item.below.records} 条记录）小于 ${a.requiredK}`, item.bestDrop ? `；影响最大的准标识符为“${item.bestDrop.column}”，删除或充分泛化后 K 为 ${item.bestDrop.k}` : '', '。'])
      }
      P('效果不达标时应重新制定匿名化策略并重新处理：对年龄、日期等做泛化，删除分析不需要的准标识符，或删除少量稀有记录后重新评估。')
    }
  } else {
    P('本批没有含准标识符列的结构化数据，K 匿名方法不适用。')
  }
  const notes = []
  if (a.withoutQuasi > 0) notes.push(`${a.withoutQuasi} 个结构化数据集未识别到准标识符列，不参与 K 值计算。`)
  if (a.unstructured?.text > 0) notes.push(`${a.unstructured.text} 个自由文本文件无法按列计算 K 值，需结合模拟攻击测试或专家判断评估。`)
  if (a.unstructured?.unreadable > 0) notes.push(`${a.unstructured.unreadable} 个文件评估时无法读取。`)
  for (const note of notes) N(note)
  H2(`3.${a.datasets.some((item) => !item.pass) ? 4 : 3} 个人信息标识度分级`)
  T([1600, 8000], [
    ['分级', '依据'],
    ...[[1, '包含直接标识符，在特定环境下能直接识别个人信息主体'], [2, '消除了直接标识符，但包含准标识符，且重标识风险高于或等于可接受风险阈值'], [3, '消除了直接标识符，但包含准标识符，且重标识风险低于可接受风险阈值'], [4, '不包含任何标识符']]
      .map(([n, text]) => {
        const hit = level.level === n
        return [hit ? (n >= 3 ? ok(`${n} 级 ◀ 本批`) : red(`${n} 级 ◀ 本批`)) : `${n} 级`, text]
      }),
  ])
  P(['评定结果：', level.level ? (level.level >= 3 ? ok(`${level.level} 级`) : red(`${level.level} 级`)) : red('未定级'), `——${level.reason}`, level.level && level.level < 3 ? red('。未达到 3 级，需调整去标识化技术后重新处理。') : '。'])

  // ── 四、不能复原评价 ─────────────────────────────────────────────────
  H1('四、不能复原评价')
  P('以下为工具记录的技术事实，供核验；关键辅助材料与环境部分需评价责任人核实并取证。')
  T([2400, 4800, 2400], [
    ['核验项', '事实 / 证据', '核验结论'],
    ['技术不可逆性', '直接标识符替换为由随机 128 位密钥经 HMAC-SHA256 派生的假名，不能由假名反推原值；日期平移的偏移量不写入交付数据和报告；DICOM PatientID 的密钥仅存于内存、批次结束即丢弃，UID 重新生成。', '☐ 通过　☐ 不通过'],
    ['关键辅助材料：映射库', `原值与假名的对照表及假名密钥保存在映射库：${run.vaultPath ?? '—'}${run.vaultEncrypted ? '（已设口令，逐条 AES-256-GCM 加密）' : ''}。须销毁或隔离至等同不可得的强度，并留存证据。`, '☐ 已销毁　☐ 已隔离　☐ 未处理'],
    ['关键辅助材料：其他记录', '批次记录 _records/records.sqlite 含原路径对照、复核原文与比对记录，与映射库同等敏感；不得随交付数据提供。', '☐ 已隔离　☐ 未处理'],
    ['环境不可越权', '（由评价责任人填写：接收方环境隔离、访问控制、日志审计情况）', '☐ 通过　☐ 不通过'],
  ])

  // ── 五、对抗性测试 ───────────────────────────────────────────────────
  H1('五、对抗性测试')
  const keyVariables = a.datasets.flatMap((item) => item.columns).sort((x, y) => y.distinct - x.distinct).map((column) => column.name)
  P(['建议重点分析的关键变量（取值种类最多的准标识符）：', [...new Set(keyVariables)].slice(0, 6).join('、') || '—', '。'])
  T([2400, 7200], [
    ['步骤', '记录（由评价责任人填写）'],
    ['a）模拟攻击者', '来源（内部 / 外部）、动机、技能、资源：'],
    ['b）关键变量', ''],
    ['c）攻击数据准备', '可合法获得的外部数据：'],
    ['d）实施攻击', '方法（链接攻击、同格攻击等）及结果：'],
    ['e）结论', '☐ 通过　☐ 不通过（重标识风险高于阈值，需重新调整策略）'],
  ])

  // ── 六、综合评价 ─────────────────────────────────────────────────────
  H1('六、综合评价与结论')
  const identifyOk = a.datasets.length > 0 ? a.pass : null
  T([2400, 4800, 2400], [
    ['评价维度', '工具初步结果', '评价结论'],
    ['无法识别', identifyOk === null ? '未计算 K 值（无结构化准标识符数据）' : identifyOk ? ok(`A = ${num(a.a)} ≥ 1，标识度 ${level.level ?? '—'} 级`) : red(`A = ${num(a.a)} < 1，标识度 ${level.level ?? '—'} 级，未达标`), '☐ 通过　☐ 不通过'],
    ['不能复原', '见第四章，待核验', '☐ 通过　☐ 不通过'],
    ['对抗性测试', '见第五章，待实施', '☐ 通过　☐ 不通过'],
    ['综合结论', '', '☐ 认定为匿名数据\n☐ 不认定，需重新处理'],
  ])
  P('评价意见：')
  P('\n\n\n')

  // ── 七、签署 ─────────────────────────────────────────────────────────
  H1('七、签署')
  N('匿名化处理责任人与评价/批准责任人应相互独立；评价/批准责任人不得参与匿名化处理实施及关键辅助材料的日常保管。')
  T([2600, 2600, 2200, 2200], [
    ['角色', '姓名 / 单位', '签字', '日期'],
    ['匿名化处理责任人', '', '', ''],
    ['评价/批准责任人', '', '', ''],
    ['独立复核（如有）', '', '', ''],
  ])

  // ── 附录 ─────────────────────────────────────────────────────────────
  H1('附：场景系数')
  T([2400, 4800, 2400], [
    ['流通范围', '场景', '场景系数'],
    ...SCENES.map((scene) => {
      const hit = scene.id === a.scene.id
      return [hit ? { text: scene.share, bold: true } : scene.share, hit ? { text: `${scene.label}（本批）`, bold: true } : scene.label, hit ? { text: scene.text, bold: true } : scene.text]
    }),
  ])
  N('本报告不含任何原始标识符取值；报告中的路径指向本机，请勿随交付数据外发。')
  return blocks
}

/** Write the Word report into the batch's records folder; returns its path. */
export async function writeFormalReport(run, runDir, { version = '' } = {}) {
  if (!run.assessment) return null
  const path = join(runDir, FORMAL_REPORT_NAME)
  await writeDocx(path, {
    blocks: formalBlocks(run, { version }),
    title: '健康医疗数据匿名化效果评估报告',
    footer: `匿名化效果评估报告 · ${run.id}`,
  })
  return path
}
