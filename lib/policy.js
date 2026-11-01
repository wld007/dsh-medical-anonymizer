/**
 * Anonymization policy: what each identifier and quasi-identifier becomes.
 *
 * Defaults reproduce the original behaviour exactly: every direct identifier
 * becomes a stable pseudonym, and quasi-identifiers are left untouched.
 * Config keys are stable English ids; the pipeline works with the Chinese type
 * labels the detectors emit.
 */
import { createHmac } from 'node:crypto'

export const IDENTIFIERS = [
  { id: 'name', type: '姓名', sample: '张三' },
  { id: 'doctor', type: '医生', sample: '李强' },
  { id: 'idCard', type: '身份证号', sample: '11010519491231002X' },
  { id: 'phone', type: '电话', sample: '13800138000' },
  { id: 'email', type: '邮箱', sample: 'zhangsan@example.com' },
  { id: 'address', type: '地址', sample: '北京市朝阳区幸福路1号' },
  { id: 'mrn', type: '病历号', sample: 'MRN-2024-001' },
  { id: 'admission', type: '住院号', sample: 'ZY20240301' },
  { id: 'visit', type: '就诊号', sample: 'MZ0001234' },
  { id: 'socialSecurity', type: '社保号', sample: 'SB1101051949' },
  { id: 'bankCard', type: '银行卡号', sample: '6222020200001234567' },
  { id: 'hospital', type: '医院', sample: '北京协和医院' },
]
export const IDENTIFIER_STRATEGIES = ['pseudonym', 'mask', 'redact', 'keep']
const SAMPLE_PSEUDONYMS = {
  name: '化名-9F3A2C', doctor: '医生-C7C5E4', idCard: '证件-1F0B67', phone: '电话-7A8ED8',
  email: '邮箱-3D21B0', address: '地址-B058F8', mrn: '病历-A41D9B', admission: '住院-52E1C0',
  visit: '就诊-0C9F44', socialSecurity: '社保-6B13A7', bankCard: '银行卡-D2A970', hospital: '医院-97BDA1',
}

export const QUASI = [
  { id: 'date', type: '日期', sample: '2024-03-01', strategies: ['keep', 'shift', 'month', 'year', 'redact'], default: 'shift' },
  { id: 'age', type: '年龄', sample: '45岁', strategies: ['keep', 'band10', 'band5', 'redact'], default: 'band10' },
  { id: 'sex', type: '性别', sample: '男', strategies: ['keep', 'redact'], default: 'keep' },
  { id: 'postalCode', type: '邮编', sample: '100020', strategies: ['keep', 'prefix3', 'redact'], default: 'prefix3' },
]

const IDENTIFIER_BY_ID = new Map(IDENTIFIERS.map((item) => [item.id, item]))
const QUASI_BY_ID = new Map(QUASI.map((item) => [item.id, item]))

/**
 * Resolve raw config into a full policy. Unknown ids and strategies fall back
 * to the defaults, so an old or hand-edited config can never break a run.
 * @returns {{identifiers: Record<string,string>, quasiEnabled: boolean, quasi: Record<string,string>}}
 *   maps keyed by Chinese type label
 */
export function resolvePolicy(config = {}) {
  const identifiers = {}
  const rawIds = isPlainObject(config.identifierPolicy) ? config.identifierPolicy : {}
  for (const item of IDENTIFIERS) {
    const value = rawIds[item.id]
    identifiers[item.type] = IDENTIFIER_STRATEGIES.includes(value) ? value : 'pseudonym'
  }
  const quasi = {}
  const rawQuasi = isPlainObject(config.quasiPolicy) ? config.quasiPolicy : {}
  for (const item of QUASI) {
    const value = rawQuasi[item.id]
    quasi[item.type] = item.strategies.includes(value) ? value : item.default
  }
  return {
    identifiers,
    quasiEnabled: config.quasiIdentifiers === true,
    quasi,
    allowValues: cleanList(config.allowValues),
    skipFields: cleanList(config.skipFields),
    // Labelled local landline numbers without area code; off by default.
    landline: config.landline === true,
  }
}

const LIST_MAX_ITEMS = 500
const LIST_MAX_CHARS = 200

/** Accept an array or a newline-separated string; trim, drop blanks, dedupe. */
function cleanList(value) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : []
  const out = []
  for (const item of items) {
    if (typeof item !== 'string' && typeof item !== 'number') continue
    const text = String(item).trim()
    if (!text || text.length > LIST_MAX_CHARS || out.includes(text)) continue
    out.push(text)
    if (out.length >= LIST_MAX_ITEMS) break
  }
  return out
}

function validateList(value, label) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : null
  if (!items) throw new Error(`${label}格式不正确`)
  const cleaned = cleanList(items)
  if (items.filter((item) => String(item ?? '').trim()).length > LIST_MAX_ITEMS) throw new Error(`${label}最多 ${LIST_MAX_ITEMS} 项`)
  if (items.some((item) => String(item ?? '').trim().length > LIST_MAX_CHARS)) throw new Error(`${label}单项不能超过 ${LIST_MAX_CHARS} 个字符`)
  return cleaned
}

/** The same policy keyed by stable ids, as stored in config and shown in the UI. */
export function policyConfig(config = {}) {
  const resolved = resolvePolicy(config)
  return {
    identifierPolicy: Object.fromEntries(IDENTIFIERS.map((item) => [item.id, resolved.identifiers[item.type]])),
    quasiIdentifiers: resolved.quasiEnabled,
    quasiPolicy: Object.fromEntries(QUASI.map((item) => [item.id, resolved.quasi[item.type]])),
    allowValues: resolved.allowValues,
    skipFields: resolved.skipFields,
    landline: resolved.landline,
  }
}

/**
 * Validate a saved policy patch. Throws on unknown ids or strategies so the
 * settings page reports the mistake instead of silently dropping it.
 */
export function normalizePolicyPatch(request = {}) {
  const next = {}
  if (request.identifierPolicy !== undefined) {
    if (!isPlainObject(request.identifierPolicy)) throw new Error('标识符策略格式不正确')
    const out = {}
    for (const [id, value] of Object.entries(request.identifierPolicy)) {
      if (!IDENTIFIER_BY_ID.has(id)) throw new Error(`未知的标识符类型：${id}`)
      if (!IDENTIFIER_STRATEGIES.includes(value)) throw new Error(`标识符 ${id} 的处理方式无效：${value}`)
      out[id] = value
    }
    for (const item of IDENTIFIERS) out[item.id] ??= 'pseudonym'
    next.identifierPolicy = out
  }
  if (request.quasiIdentifiers !== undefined) next.quasiIdentifiers = request.quasiIdentifiers === true
  if (request.quasiPolicy !== undefined) {
    if (!isPlainObject(request.quasiPolicy)) throw new Error('准标识符策略格式不正确')
    const out = {}
    for (const [id, value] of Object.entries(request.quasiPolicy)) {
      const item = QUASI_BY_ID.get(id)
      if (!item) throw new Error(`未知的准标识符类型：${id}`)
      if (!item.strategies.includes(value)) throw new Error(`准标识符 ${id} 的处理方式无效：${value}`)
      out[id] = value
    }
    for (const item of QUASI) out[item.id] ??= item.default
    next.quasiPolicy = out
  }
  if (request.allowValues !== undefined) next.allowValues = validateList(request.allowValues, '不匹配的值')
  if (request.skipFields !== undefined) next.skipFields = validateList(request.skipFields, '不处理的字段')
  if (request.landline !== undefined) next.landline = request.landline === true
  return next
}

/** Schema for the settings page: ids, labels, allowed strategies, and examples. */
export function policySchema() {
  return {
    identifiers: IDENTIFIERS.map((item) => ({
      id: item.id,
      type: item.type,
      sample: item.sample,
      examples: {
        pseudonym: SAMPLE_PSEUDONYMS[item.id],
        mask: maskValue(item.type, item.sample),
        redact: redactLabel(item.type),
        keep: item.sample,
      },
    })),
    quasi: QUASI.map((item) => ({
      id: item.id,
      type: item.type,
      sample: item.sample,
      strategies: item.strategies,
      default: item.default,
      examples: Object.fromEntries(item.strategies.map((strategy) => [strategy, quasiExample(item.type, strategy)])),
    })),
  }
}

export function redactLabel(type) {
  return `[${type}]`
}

const REDACT_RE = /\[(?:姓名|医生|身份证号|电话|邮箱|地址|病历号|住院号|就诊号|社保号|银行卡号|医院|日期|年龄|性别|邮编)\]/g

/**
 * Partial mask that keeps a recognisable shape and hides the identifying part.
 * Deterministic, irreversible, and never stored in the vault.
 */
export function maskValue(type, value) {
  const text = String(value)
  switch (type) {
    case '姓名':
    case '医生':
      return keepChars(text, 1, 0)
    case '身份证号':
      return keepClass(text, /[0-9Xx]/, 3, 4)
    case '电话':
      return keepClass(text, /\d/, 3, 4)
    case '银行卡号':
      return keepClass(text, /\d/, 0, 4)
    case '病历号':
    case '住院号':
    case '就诊号':
    case '社保号':
      return keepClass(text, /[0-9A-Za-z]/, 0, 4)
    case '邮箱': {
      const at = text.indexOf('@')
      if (at <= 0) return keepChars(text, 1, 0)
      return `${text[0]}***${text.slice(at)}`
    }
    case '地址': {
      const chars = [...text]
      let keep = 0
      for (let i = 0; i < Math.min(chars.length, 12); i += 1) {
        if ('省市区县旗州盟'.includes(chars[i])) keep = i + 1
      }
      if (keep === 0) keep = Math.min(2, chars.length - 1)
      if (keep >= chars.length) return text
      return `${chars.slice(0, keep).join('')}****`
    }
    case '医院': {
      const suffix = /(医院|卫生院|保健院|诊所|中心)$/.exec(text)?.[1] ?? ''
      const body = [...text.slice(0, text.length - suffix.length)]
      if (body.length <= 2) return `${body[0] ?? ''}${'*'.repeat(Math.max(1, body.length - 1))}${suffix}`
      return `${body.slice(0, 2).join('')}${'*'.repeat(body.length - 2)}${suffix}`
    }
    default:
      return keepChars(text, 1, 0)
  }
}

function keepChars(text, start, end) {
  const chars = [...text]
  if (chars.length <= 1) return '*'
  return chars.map((ch, index) => (index < start || index >= chars.length - end || /[\s·-]/.test(ch) ? ch : '*')).join('')
}

function keepClass(text, pattern, start, end) {
  const total = [...text].filter((ch) => pattern.test(ch)).length
  if (total <= start + end) return keepChars(text, 1, 0)
  let seen = 0
  return [...text].map((ch) => {
    if (!pattern.test(ch)) return ch
    seen += 1
    return seen <= start || seen > total - end ? ch : '*'
  }).join('')
}

/** True when a detection's text is already an anonymized output. */
export function isProtectedText(text, produced) {
  const value = String(text ?? '').trim()
  if (!value) return true
  if (produced?.has(value)) return true
  if (value.includes('*')) return true // masks; real identifiers never contain '*'
  REDACT_RE.lastIndex = 0
  return new RegExp(`^${REDACT_RE.source}$`).test(value)
}

const PSEUDONYM_TOKEN = /(?:化名|患者|医生|证件|电话|邮箱|地址|病历|住院|就诊|社保|银行卡|医院)-[0-9A-F]{6,10}/g

/**
 * True when [start,end) overlaps a pseudonym token, a redaction placeholder,
 * or an output this run already produced (masks).
 */
export function insideProtected(text, start, end, produced) {
  for (const re of [PSEUDONYM_TOKEN, REDACT_RE]) {
    re.lastIndex = 0
    for (const match of text.matchAll(re)) {
      if (start < match.index + match[0].length && match.index < end) return true
    }
  }
  if (produced) {
    for (const output of produced) {
      if (!output || output.length < 2) continue
      let index = text.indexOf(output)
      while (index !== -1) {
        if (start < index + output.length && index < end) return true
        index = text.indexOf(output, index + 1)
      }
    }
  }
  return false
}

/* -------------------------------------------------------- quasi-identifiers */

/**
 * Per-output-root date offset in days (±1..365, never 0). Derived from the
 * vault salt, so every batch sharing an output root shifts by the same amount
 * and intervals between dates are preserved. It is never written to reports.
 */
export function dateShiftDays(salt) {
  const digest = createHmac('sha256', String(salt ?? '')).update('date-shift').digest()
  const magnitude = (digest.readUInt32BE(0) % 365) + 1
  return digest[4] & 1 ? -magnitude : magnitude
}

const ISO_DATE = /(?<![0-9])((?:19|20)\d{2})([-/.])(0?[1-9]|1[0-2])\2(0?[1-9]|[12]\d|3[01])(?![0-9])((?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?)/g
const CJK_DATE = /(?<![0-9])((?:19|20)\d{2})年(0?[1-9]|1[0-2])月(?:(0?[1-9]|[12]\d|3[01])([日号]))?/g
const COMPACT_DATE = /^((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(\d{6})?$/
const AGE_TEXT = /(?<![0-9.])(\d{1,3})(\s*)(周岁|岁)/g
const AGE_LABEL = /(年\s*龄\s*[:：]\s*)(\d{1,3})(?![0-9.岁]|\s*周?岁)/g
const AGE_FIELD = /^(\s*)(\d{1,3})(\s*)(周岁|岁)?(\s*)$/
const SEX_LABEL = /(性\s*别\s*[:：]\s*)(男性|女性|男|女)/g
const SEX_FIELD = /^\s*(男|女|男性|女性|M|F|male|female|未知|不详)\s*$/i
const POSTAL_LABEL = /((?:邮编|邮政编码)\s*[:：]\s*)(\d{6})(?!\d)/g
const POSTAL_FIELD = /^(\s*)(\d{6})(\s*)$/

function validDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function pad(value, like) {
  return like.length === 2 ? String(value).padStart(2, '0') : String(value)
}

function shiftDate(y, m, d, days) {
  const date = new Date(Date.UTC(y, m - 1, d) + days * 86400000)
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }
}

function ageBand(n, width, suffix) {
  if (n >= 90) return suffix ? `90${suffix}及以上` : '≥90'
  const low = Math.floor(n / width) * width
  return `${low}-${low + width - 1}${suffix}`
}

function quasiExample(type, strategy) {
  if (strategy === 'keep') return QUASI.find((item) => item.type === type)?.sample ?? ''
  if (strategy === 'redact') return redactLabel(type)
  if (type === '日期') {
    if (strategy === 'shift') return '2024-04-07（示例：+37 天）'
    if (strategy === 'month') return '2024-03'
    if (strategy === 'year') return '2024'
  }
  if (type === '年龄') return strategy === 'band5' ? '45-49岁' : '40-49岁'
  if (type === '邮编') return '100***'
  return ''
}

/**
 * Find quasi-identifier replacements in one segment.
 * @param {{text: string, quasi?: string|null}} segment
 * @param {Record<string,string>} strategies keyed by Chinese type
 * @returns {{start:number,end:number,original:string,replacement:string,type:string}[]}
 */
export function quasiReplacements(segment, strategies, shiftDays) {
  const text = segment.text
  const out = []
  const add = (type, start, original, replacement) => {
    if (replacement === null || replacement === original) return
    out.push({ type, start, end: start + original.length, original, replacement })
  }

  const dateStrategy = strategies['日期']
  if (dateStrategy && dateStrategy !== 'keep') {
    for (const m of text.matchAll(ISO_DATE)) {
      const [whole, ys, sep, ms, ds, time] = m
      const y = Number(ys); const mo = Number(ms); const d = Number(ds)
      if (!validDate(y, mo, d)) continue
      let next = null
      if (dateStrategy === 'redact') next = redactLabel('日期')
      else if (dateStrategy === 'year') next = ys
      else if (dateStrategy === 'month') next = `${ys}${sep}${pad(mo, ms)}`
      else if (dateStrategy === 'shift') {
        const s = shiftDate(y, mo, d, shiftDays)
        next = `${s.y}${sep}${pad(s.m, ms)}${sep}${pad(s.d, ds)}${time}`
      }
      add('日期', m.index, whole, next)
    }
    for (const m of text.matchAll(CJK_DATE)) {
      const [whole, ys, ms, ds, suffix] = m
      const y = Number(ys); const mo = Number(ms)
      if (ds && !validDate(y, mo, Number(ds))) continue
      let next = null
      if (dateStrategy === 'redact') next = redactLabel('日期')
      else if (dateStrategy === 'year') next = `${ys}年`
      else if (dateStrategy === 'month') next = `${ys}年${ms}月`
      else if (dateStrategy === 'shift') {
        if (!ds) continue // a month without a day cannot be shifted faithfully
        const s = shiftDate(y, mo, Number(ds), shiftDays)
        next = `${s.y}年${pad(s.m, ms)}月${pad(s.d, ds)}${suffix}`
      }
      add('日期', m.index, whole, next)
    }
    if (segment.quasi === '日期') {
      const trimmed = text.trim()
      const m = COMPACT_DATE.exec(trimmed)
      if (m && validDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
        const [, ys, ms, ds, time = ''] = m
        let next = null
        if (dateStrategy === 'redact') next = redactLabel('日期')
        else if (dateStrategy === 'year') next = ys
        else if (dateStrategy === 'month') next = `${ys}${ms}`
        else if (dateStrategy === 'shift') {
          const s = shiftDate(Number(ys), Number(ms), Number(ds), shiftDays)
          next = `${s.y}${pad(s.m, '00')}${pad(s.d, '00')}${time}`
        }
        add('日期', text.indexOf(trimmed), trimmed, next)
      }
    }
  }

  const ageStrategy = strategies['年龄']
  if (ageStrategy && ageStrategy !== 'keep') {
    const band = (n, suffix) => {
      if (ageStrategy === 'redact') return redactLabel('年龄')
      if (n > 130) return null
      return ageBand(n, ageStrategy === 'band5' ? 5 : 10, suffix)
    }
    if (segment.quasi === '年龄') {
      const m = AGE_FIELD.exec(text)
      if (m) {
        const [, lead, digits, gap, suffix = ''] = m
        const replacement = band(Number(digits), suffix)
        if (replacement !== null) add('年龄', lead.length, `${digits}${gap}${suffix}`, replacement)
      }
    } else {
      for (const m of text.matchAll(AGE_TEXT)) {
        const [whole, digits, , suffix] = m
        const replacement = band(Number(digits), suffix)
        if (replacement !== null) add('年龄', m.index, whole, replacement)
      }
      for (const m of text.matchAll(AGE_LABEL)) {
        const [, label, digits] = m
        const replacement = band(Number(digits), '')
        if (replacement !== null) add('年龄', m.index + label.length, digits, replacement)
      }
    }
  }

  if (strategies['性别'] === 'redact') {
    if (segment.quasi === '性别') {
      const m = SEX_FIELD.exec(text)
      if (m) add('性别', text.indexOf(m[1]), m[1], redactLabel('性别'))
    } else {
      for (const m of text.matchAll(SEX_LABEL)) add('性别', m.index + m[1].length, m[2], redactLabel('性别'))
    }
  }

  const postalStrategy = strategies['邮编']
  if (postalStrategy && postalStrategy !== 'keep') {
    const replace = (code) => (postalStrategy === 'redact' ? redactLabel('邮编') : `${code.slice(0, 3)}***`)
    if (segment.quasi === '邮编') {
      const m = POSTAL_FIELD.exec(text)
      if (m) add('邮编', m[1].length, m[2], replace(m[2]))
    } else {
      for (const m of text.matchAll(POSTAL_LABEL)) add('邮编', m.index + m[1].length, m[2], replace(m[2]))
    }
  }

  // Longest span wins on overlap (a date inside a labelled field, etc.).
  const accepted = []
  for (const item of out.sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
    if (accepted.some((other) => item.start < other.end && other.start < item.end)) continue
    accepted.push(item)
  }
  return accepted.sort((a, b) => a.start - b.start)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
