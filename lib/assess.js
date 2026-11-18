/**
 * Anonymization effect assessment after a batch, by K anonymity combined
 * with the usage scenario and the environment:
 *
 *   A = K × S × E, anonymous enough when A ≥ 1
 *
 * K is the smallest equivalence class over the quasi-identifier columns of a
 * structured dataset (as delivered, i.e. after anonymization), S the scenario
 * coefficient, E the environment coefficient (1 = typical). L (l-diversity)
 * and T (t-closeness) are added where a sensitive column (the diagnosis)
 * exists. No regional specification is named: the basis shown in reports is
 * a setting (assessBasis), national standards by default.
 *
 * Only structured data (csv, xlsx sheets, JSON record arrays, DICOM headers
 * per study) has columns to group by; free text is listed as not assessed.
 * Nothing here returns original or quasi-identifier values: the result names
 * columns and counts only.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as XLSX from '../vendor/xlsx.mjs'
import { decodeTextBytes, detectKind, hintForHeader, parseCsv } from './formats.js'
import { charsetDecoder, decodeAscii, readDicom } from './dicom/codec.js'
import { dictVr } from './dicom/profile.js'

/** Scenario coefficients by how widely the data is shared. */
export const SCENES = [
  { id: 'enclaveSame', share: '领地公开共享', label: '组织内部同一个事业群的数据流通', factor: 1 / 3, text: '1/3' },
  { id: 'enclaveCross', share: '领地公开共享', label: '组织内部跨事业群的数据流通', factor: 1 / 4, text: '1/4' },
  { id: 'controlledTwo', share: '受控公开共享', label: '组织外部两方的数据流通', factor: 1 / 5, text: '1/5' },
  { id: 'controlledMulti', share: '受控公开共享', label: '组织外部多方的数据流通', factor: 1 / 6, text: '1/6' },
  { id: 'public', share: '完全公开共享', label: '对外公开', factor: 1 / 20, text: '1/20' },
]
export const DEFAULT_SCENE = 'controlledTwo'
/** Shown as the basis when the setting is empty: national standards only. */
export const DEFAULT_BASIS = 'GB/T 37964—2019《信息安全技术 个人信息去标识化指南》、GB/T 42460—2023《信息安全技术 个人信息去标识化效果评估指南》'
export const BASIS_MAX = 300
export const ENVIRONMENT_MIN = 0.1
export const ENVIRONMENT_MAX = 10
const SCENE_BY_ID = new Map(SCENES.map((scene) => [scene.id, scene]))

export function sceneOf(id) {
  return SCENE_BY_ID.get(id) ?? SCENE_BY_ID.get(DEFAULT_SCENE)
}

/** Smallest K that reaches A ≥ 1 for this S and E. */
export function requiredK(scene, environment) {
  return Math.max(1, Math.ceil(1 / (sceneOf(scene).factor * environment) - 1e-9))
}

/* ------------------------------------------------------------ columns */

// Quasi-identifier categories (health indicators, event time and place,
// work unit, other personal attributes). Checked in
// order; the first match names the category.
const QUASI_COLUMNS = [
  // Institutions and work units are pseudonymized as identifiers here, but a
  // stable pseudonym keeps them groupable: they still single people out.
  [/工作单位|单位名称|学校|班级|(?:^|_)(?:wrk|work)_?(?:unt|unit)(?:_|$)|employer|school/i, '单位信息'],
  [/医院|机构|hospital|(?:^|_)(?:mdc_?)?org_?(?:nm|name|cd|code)$/i, '健康事件地点'],
  [/出生|生日|birth|(?:^|_)(?:bth|brdy)(?:_|$)/i, '健康指标（出生日期）'],
  [/性别|(?:^|_)(?:sex|gender|gdr)(?:_|$)/i, '健康指标'],
  [/年龄|(?:^|_)age(?:_|$)/i, '健康指标'],
  [/身高|体重|血型|肺活量|(?:^|_)(?:height|weight|hgt|wgt|wt|ht|blood_?type|abo)(?:_|$)/i, '健康指标'],
  [/邮编|邮政编码|zip|postal|post_?(?:code|cd)|省份|^省$|城市|^市$|区县|县区|乡镇|街道|行政区|地区|居住地|(?:^|_)(?:prov|province|city|county|district|region|town)(?:_?(?:cd|code|nm|name))?(?:_|$)/i, '健康事件地点'],
  [/国籍|民族|籍贯|户籍|婚姻|学历|文化程度|教育|职业|(?:^|_)(?:nation|nationality|ethnic|ethnicity|marital|marriage|mrg|edu|education|occupation|occup|job|career)(?:_?(?:cd|code|nm|name))?(?:_|$)/i, '其他个人属性'],
  [/日期|时间|(?:^|_)(?:dt|date|time|tm|datetime)(?:_|$)/i, '健康事件时间'],
]
// The sensitive attribute for L / T: the diagnosis.
const SENSITIVE_COLUMN = /诊断|疾病|病名|diagnos|(?:^|_)(?:icd|icd10|diag|dgns|dise?|disease)(?:_?(?:cd|code|nm|name))?(?:_|$)/i
// Person keys, best first: records of one person count once.
const PERSON_KEYS = ['身份证号', '病历号', '社保号', '姓名']

function norm(name) {
  return String(name ?? '').trim().toLowerCase()
}

/**
 * Roles of a dataset's columns.
 * @returns {{ quasi: {index:number,name:string,category:string}[], person: number, sensitive: number }}
 */
export function classifyColumns(header, { ignoreFields = [], extraFields = [] } = {}) {
  const ignore = new Set(ignoreFields.map(norm))
  const extra = new Set(extraFields.map(norm))
  const quasi = []
  let person = -1
  let personRank = Infinity
  let sensitive = -1
  header.forEach((raw, index) => {
    const name = String(raw ?? '').trim()
    if (!name || ignore.has(norm(name))) return
    if (extra.has(norm(name))) {
      quasi.push({ index, name, category: '指定' })
      return
    }
    const category = QUASI_COLUMNS.find(([pattern]) => pattern.test(name))?.[1]
    const hint = hintForHeader(name)
    // Direct identifiers (names, ID and record numbers, phones…) are handled
    // as identifiers, not grouped by; except institutions and work units.
    if (category && (!hint || hint === '医院' || hint === '地址' && category === '单位信息')) {
      quasi.push({ index, name, category })
      return
    }
    const rank = PERSON_KEYS.indexOf(hint)
    if (rank >= 0 && rank < personRank) {
      person = index
      personRank = rank
      return
    }
    if (!hint && sensitive < 0 && SENSITIVE_COLUMN.test(name)) sensitive = index
  })
  return { quasi, person, sensitive }
}

/* ------------------------------------------------------------- tables */

function cellText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).trim()
}

function tablesOfCsv(text) {
  const { rows } = parseCsv(text)
  const body = rows.filter((row) => row.some((cell) => cell.trim() !== ''))
  if (body.length < 2) return []
  return [{ name: '', header: body[0].map((cell) => cell.trim()), rows: body.slice(1) }]
}

function tablesOfXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const out = []
  for (const sheet of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, raw: false, defval: '', blankrows: false })
      .filter((row) => row.some((cell) => cellText(cell) !== ''))
    if (rows.length < 2) continue
    out.push({ name: sheet, header: rows[0].map(cellText), rows: rows.slice(1).map((row) => row.map(cellText)) })
  }
  return out
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** One row of scalar fields; nested objects one level deep as "a.b". */
function flatten(record) {
  const out = {}
  for (const [key, value] of Object.entries(record)) {
    if (isRecord(value)) {
      for (const [inner, leaf] of Object.entries(value)) if (!isRecord(leaf) && !Array.isArray(leaf)) out[`${key}.${inner}`] = cellText(leaf)
    } else if (!Array.isArray(value)) out[key] = cellText(value)
  }
  return out
}

function tableOfRecords(name, records) {
  const rows = records.map(flatten)
  const header = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  return { name, header, rows: rows.map((row) => header.map((key) => row[key] ?? '')) }
}

/**
 * Record arrays anywhere in the first three levels, and the document itself
 * when it is one record (one patient per file: pooled with its siblings).
 */
function tablesOfJson(value) {
  const out = []
  const walk = (node, path, depth) => {
    if (depth > 3) return
    if (Array.isArray(node)) {
      const records = node.filter(isRecord)
      if (records.length >= 1 && records.length >= node.length / 2) out.push(tableOfRecords(path, records))
      return
    }
    if (!isRecord(node)) return
    for (const [key, child] of Object.entries(node)) walk(child, path ? `${path}.${key}` : key, depth + 1)
  }
  walk(value, '', 0)
  if (isRecord(value)) {
    const own = tableOfRecords('', [value])
    if (own.header.length > 0) out.push(own)
  }
  return out
}

async function tablesOfFile(path, kind) {
  const buffer = await readFile(path)
  if (kind === 'xlsx') return tablesOfXlsx(buffer)
  const { text } = decodeTextBytes(buffer)
  if (kind === 'csv') return tablesOfCsv(text)
  return tablesOfJson(JSON.parse(text.replace(/^\uFEFF/, '')))
}

/* -------------------------------------------------------------- DICOM */

const DICOM_QUASI = [
  ['00100040', 'PatientSex 患者性别', '健康指标'],
  ['00101010', 'PatientAge 患者年龄', '健康指标'],
  ['00100030', 'PatientBirthDate 出生日期', '健康指标（出生日期）'],
  ['00080080', 'InstitutionName 医疗机构', '健康事件地点'],
  ['00180015', 'BodyPartExamined 扫描部位', '健康指标'],
  ['00080020', 'StudyDate 检查日期', '健康事件时间'],
]

async function dicomStudy(path) {
  const parsed = await readDicom(path, { dict: dictVr, headerOnly: true, firstChunk: 64 * 1024 })
  const byTag = new Map(parsed.dataset.map((el) => [el.tag, el]))
  const charset = charsetDecoder(decodeAscii(byTag.get('00080005')?.value))
  const text = (tag) => {
    const value = byTag.get(tag)?.value
    if (!value?.length) return ''
    return (charset.known ? charset.decode(value) : value.toString('latin1')).replace(/[\0 ]+$/, '').trim()
  }
  return {
    study: text('0020000D') || path,
    person: text('00100020'),
    values: DICOM_QUASI.map(([tag]) => text(tag)),
  }
}

/* ------------------------------------------------------------ metrics */

/**
 * K, L, T and the classes under the required K for one dataset.
 * rows: { values: string[], person: string|null, sensitive: string|null }[]
 */
export function measure(rows, { hasPerson, hasSensitive, needK, columns = [] }) {
  const classes = new Map()
  const overall = new Map()
  for (const row of rows) {
    const key = JSON.stringify(row.values)
    let entry = classes.get(key)
    if (!entry) classes.set(key, entry = { records: 0, persons: new Set(), sensitive: new Map() })
    entry.records += 1
    if (hasPerson) entry.persons.add(row.person || `\u0000${entry.records}`)
    if (hasSensitive) {
      const value = row.sensitive ?? ''
      entry.sensitive.set(value, (entry.sensitive.get(value) ?? 0) + 1)
      overall.set(value, (overall.get(value) ?? 0) + 1)
    }
  }
  const sizeOf = (entry) => (hasPerson ? entry.persons.size : entry.records)
  let k = Infinity
  let l = Infinity
  let t = 0
  let belowClasses = 0
  let belowRecords = 0
  for (const entry of classes.values()) {
    const size = sizeOf(entry)
    k = Math.min(k, size)
    if (size < needK) {
      belowClasses += 1
      belowRecords += entry.records
    }
    if (hasSensitive) {
      l = Math.min(l, entry.sensitive.size)
      // Total variation distance: the earth mover's distance of t-closeness
      // with equal ground distance between categories.
      let distance = 0
      for (const [value, total] of overall) distance += Math.abs((entry.sensitive.get(value) ?? 0) / entry.records - total / rows.length)
      t = Math.max(t, distance / 2)
    }
  }
  const distinct = columns.map((_, index) => new Set(rows.map((row) => row.values[index])).size)
  return {
    classes: classes.size,
    k: Number.isFinite(k) ? k : 0,
    l: hasSensitive && Number.isFinite(l) ? l : null,
    t: hasSensitive ? Math.round(t * 1000) / 1000 : null,
    below: { classes: belowClasses, records: belowRecords },
    distinct,
  }
}

const BEST_DROP_MAX_ROWS = 500_000

/** The column whose removal (or full generalization) raises K the most. */
function bestDrop(rows, columns, options) {
  if (columns.length < 2) return null
  let best = null
  for (let index = 0; index < columns.length; index += 1) {
    const reduced = rows.map((row) => ({ ...row, values: row.values.filter((_, at) => at !== index) }))
    const { k } = measure(reduced, { ...options, columns: [] })
    if (!best || k > best.k) best = { column: columns[index].name, k }
  }
  return best
}

/* ---------------------------------------------------------------- run */

/**
 * Assess a batch's delivered files.
 * @param {{ outputDir: string, files: object[], assessment: object, signal?: AbortSignal }} args
 */
export async function assessBatch({ outputDir, files, assessment = {}, signal }) {
  const scene = sceneOf(assessment.scene)
  const environment = Number(assessment.environment) || 1
  const needK = requiredK(scene.id, environment)
  const fieldOptions = { ignoreFields: assessment.ignoreFields ?? [], extraFields: assessment.extraFields ?? [] }
  const pools = new Map()
  const unstructured = { text: 0, unreadable: 0 }
  const dicom = new Map()
  for (const file of files) {
    if (signal?.aborted) return null
    if (file.status === 'failed' || file.status === 'cancelled') continue
    const path = join(outputDir, file.relPath)
    if (file.kind === 'dicom') {
      try {
        const study = await dicomStudy(path)
        if (!dicom.has(study.study)) dicom.set(study.study, { ...study, file: file.relPath })
      } catch { unstructured.unreadable += 1 }
      continue
    }
    const kind = detectKind(file.relPath)
    if (kind === 'text' || !kind) {
      unstructured.text += 1
      continue
    }
    let tables
    try {
      tables = await tablesOfFile(path, kind)
    } catch {
      unstructured.unreadable += 1
      continue
    }
    if (tables.length === 0) unstructured.text += 1
    for (const table of tables) {
      const roles = classifyColumns(table.header, fieldOptions)
      // Files of one shape are one dataset split across files.
      const signature = JSON.stringify([kind === 'xlsx' ? 'table' : kind, [...table.header].map(norm).sort()])
      let pool = pools.get(signature)
      if (!pool) {
        pools.set(signature, pool = { name: table.name ? `${file.relPath}#${table.name}` : file.relPath, files: new Set(), roles, header: table.header, rows: [] })
      }
      pool.files.add(file.relPath)
      for (const row of table.rows) {
        pool.rows.push({
          values: roles.quasi.map((column) => cellText(row[column.index]) || '(空)'),
          person: roles.person >= 0 ? cellText(row[roles.person]) : null,
          sensitive: roles.sensitive >= 0 ? cellText(row[roles.sensitive]) : null,
        })
      }
    }
  }

  const datasets = []
  let withoutQuasi = 0
  const evaluate = (name, fileCount, columns, rows, { personColumn, sensitiveColumn }) => {
    const options = { hasPerson: Boolean(personColumn), hasSensitive: Boolean(sensitiveColumn), needK }
    if (columns.length === 0) {
      withoutQuasi += 1
      return
    }
    const result = measure(rows, { ...options, columns })
    const a = result.k * scene.factor * environment
    datasets.push({
      name,
      files: fileCount,
      records: rows.length,
      persons: personColumn ? new Set(rows.map((row) => row.person).filter(Boolean)).size : null,
      personColumn: personColumn ?? null,
      sensitiveColumn: sensitiveColumn ?? null,
      columns: columns.map((column, index) => ({ name: column.name, category: column.category, distinct: result.distinct[index] })),
      classes: result.classes,
      k: result.k,
      l: result.l,
      t: result.t,
      a: Math.round(a * 100) / 100,
      pass: a >= 1 - 1e-9,
      below: result.below,
      ...(a < 1 - 1e-9 && rows.length <= BEST_DROP_MAX_ROWS ? { bestDrop: bestDrop(rows, columns, options) } : {}),
    })
  }
  for (const pool of pools.values()) {
    evaluate(pool.files.size > 1 ? `${pool.name} 等 ${pool.files.size} 个同结构文件` : pool.name, pool.files.size, pool.roles.quasi, pool.rows, {
      personColumn: pool.roles.person >= 0 ? pool.header[pool.roles.person] : null,
      sensitiveColumn: pool.roles.sensitive >= 0 ? pool.header[pool.roles.sensitive] : null,
    })
  }
  if (dicom.size > 0) {
    const ignore = new Set(fieldOptions.ignoreFields.map(norm))
    const keep = DICOM_QUASI.map(([tag, name, category], index) => ({ tag, name, category, index }))
      .filter((column) => !ignore.has(norm(column.name.split(' ')[0])) && !ignore.has(norm(column.name)))
    const studies = [...dicom.values()]
    evaluate(`DICOM 影像（按检查计，${new Set(studies.map((study) => study.file.split('/')[0])).size} 个目录）`, studies.length,
      keep.map(({ name, category }) => ({ name, category })),
      studies.map((study) => ({ values: keep.map((column) => study.values[column.index] || '(空)'), person: study.person, sensitive: null })),
      { personColumn: 'PatientID', sensitiveColumn: null })
  }

  const worst = datasets.reduce((min, item) => (!min || item.a < min.a ? item : min), null)
  return {
    basis: assessment.basis || DEFAULT_BASIS,
    scene: { id: scene.id, share: scene.share, label: scene.label, factor: scene.text },
    environment,
    requiredK: needK,
    datasets,
    withoutQuasi,
    unstructured,
    k: worst?.k ?? null,
    a: worst?.a ?? null,
    pass: worst ? worst.pass : null,
  }
}

/**
 * Identifiability level (GB/T 42460—2023, four levels), from the assessment and whether
 * direct identifiers may remain.
 */
export function identificationLevel(assessment, { directRemaining }) {
  if (directRemaining) return { level: 1, reason: '仍可能含直接标识符' }
  const anyQuasi = (assessment?.datasets?.length ?? 0) > 0
  if (!anyQuasi && !(assessment?.unstructured?.text > 0)) return { level: 4, reason: '结构化数据中没有识别到准标识符列，也没有自由文本' }
  if (!anyQuasi) return { level: null, reason: '只有自由文本，无法计算 K 匿名值' }
  if (assessment.pass) return { level: 3, reason: '消除了直接标识符，含准标识符，重标识风险低于阈值（A ≥ 1）' }
  return { level: 2, reason: '消除了直接标识符，含准标识符，重标识风险不低于阈值（A < 1）' }
}
