/**
 * Deterministic direct-identifier detectors.
 *
 * The rules run on both the original text (high-precision recall insurance)
 * and the anonymized text (residual check). They never guess: an entity is
 * returned only with an exact span in the input string.
 */

export const TYPES = [
  '姓名', '医生', '身份证号', '电话', '邮箱', '地址',
  '病历号', '住院号', '就诊号', '社保号', '银行卡号', '医院',
]

const TYPE_SET = new Set(TYPES)

/** Overlap priority: a longer / more specific identifier wins. */
export const PRIORITY = {
  '身份证号': 100,
  '银行卡号': 95,
  '社保号': 90,
  '电话': 80,
  '邮箱': 80,
  '病历号': 70,
  '住院号': 70,
  '就诊号': 70,
  '姓名': 60,
  '医生': 55,
  '地址': 50,
  '医院': 40,
}

const NAME_STOP = new Set([
  '男', '女', '年龄', '岁', '患者', '病人', '姓名', '性别', '入院', '出院',
  '日期', '电话', '地址', '病历', '住院', '门诊', '科室', '医生', '医师',
  '主任', '教授', '护士', '汉族', '已婚', '未婚', '不详', '无', '正常',
  '阳性', '阴性', '家属', '本人', '儿子', '女儿', '父亲', '母亲', '配偶', '化名',
])

const PSEUDONYM_RE = /^(?:化名|患者|医生|证件|电话|邮箱|地址|病历|住院|就诊|社保|银行卡|医院)-[0-9A-F]{6,10}$/

export function isPseudonym(value) {
  return PSEUDONYM_RE.test(String(value ?? '').trim())
}

export function isKnownType(type) {
  return TYPE_SET.has(type)
}

function validIdCard(value) {
  if (!/^\d{17}[\dXx]$/.test(value)) return false
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = '10X98765432'
  let sum = 0
  for (let i = 0; i < 17; i += 1) sum += Number(value[i]) * weights[i]
  return checks[sum % 11] === value[17].toUpperCase()
}

function luhn(value) {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 16 || digits.length > 19) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

/**
 * Scan one string for direct identifiers.
 * @param {string} text
 * @returns {{type: string, text: string, start: number, end: number, source: 'rule'}[]}
 */
export function scan(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  const out = []
  // Already-pseudonymized spans must not be re-detected: "至医院-97BDA1" would
  // otherwise match the hospital pattern again on every verification pass.
  const pseudoSpans = [...text.matchAll(/(?:化名|患者|医生|证件|电话|邮箱|地址|病历|住院|就诊|社保|银行卡|医院)-[0-9A-F]{6,10}/g)]
    .map((m) => [m.index, m.index + m[0].length])
  const overlapsPseudonym = (start, end) => pseudoSpans.some(([a, b]) => start < b && a < end)
  const push = (type, value, start) => {
    if (!value) return
    const trimmed = value.trim()
    if (trimmed.length === 0) return
    const offset = start + value.indexOf(trimmed)
    if (overlapsPseudonym(offset, offset + trimmed.length)) return
    out.push({ type, text: trimmed, start: offset, end: offset + trimmed.length, source: 'rule' })
  }

  // Bare identifiers.
  for (const m of text.matchAll(/(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])/g)) {
    if (validIdCard(m[0])) push('身份证号', m[0], m.index)
  }
  for (const m of text.matchAll(/(?<!\d)1[3-9]\d{9}(?!\d)/g)) push('电话', m[0], m.index)
  for (const m of text.matchAll(/(?<!\d)0\d{2,3}-\d{7,8}(?!\d)/g)) push('电话', m[0], m.index)
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) push('邮箱', m[0], m.index)
  for (const m of text.matchAll(/(?<!\d)(?:\d[ -]?){15,19}\d(?!\d)/g)) {
    const raw = m[0]
    const digits = raw.replace(/\D/g, '')
    if (digits.length >= 16 && digits.length <= 19 && luhn(digits) && !validIdCard(digits)) {
      push('银行卡号', raw, m.index)
    }
  }

  // Labeled fields: the captured value is the identifier.
  const labeled = [
    ['姓名', /(?:姓\s*名|患者姓名|病人姓名|联系人|家属|监护人|患者|病人|患儿)\s*[：:]\s*([\u4e00-\u9fa5·]{2,4})/g],
    ['医生', /(?:医生|医师|主治医师|主任医师|副主任医师|教授|主任)\s*[：:]\s*([\u4e00-\u9fa5·]{2,4})/g],
    ['地址', /(?:住址|现住址|家庭住址|户籍地址|联系地址|工作单位|出\s*生\s*地|籍\s*贯)\s*[：:]\s*([^\n，。；;]{2,60})/g],
    ['病历号', /(?:病历号|病案号)\s*[：:]\s*([A-Za-z0-9-]{4,24})/g],
    ['住院号', /(?:住院号)\s*[：:]\s*([A-Za-z0-9-]{4,24})/g],
    ['就诊号', /(?:门诊号|就诊号|检查号|检验号|样本号|登记号)\s*[：:]\s*([A-Za-z0-9-]{4,24})/g],
    ['社保号', /(?:社保号|医保号|医保卡号)\s*[：:]\s*([A-Za-z0-9-]{6,24})/g],
  ]
  for (const [type, re] of labeled) {
    for (const m of text.matchAll(re)) {
      const value = m[1]
      if (type === '姓名' || type === '医生') {
        if (NAME_STOP.has(value)) continue
      }
      push(type, value, m.index + m[0].indexOf(value))
    }
  }

  // Prose birthplace: "个人史：生于萧山，久居萧山。"
  for (const m of text.matchAll(/生于([\u4e00-\u9fa5]{2,10})/g)) {
    push('地址', m[1], m.index + m[0].indexOf(m[1]))
  }

  // Named hospitals (a quasi-identifier that often re-identifies a visit).
  for (const m of text.matchAll(/([\u4e00-\u9fa5]{2,12}(?:医院|卫生院|保健院|诊所))/g)) {
    const raw = m[1]
    if (/^[去到在住本该我于从]/.test(raw)) continue
    // "月余前患者家属至老年医院" is prose, not a name: keep the trailing
    // proper-noun part after the last connective/time word.
    const tail = raw.split(/[前后在至于到送往了着的为因系患家属就诊入出转]/).pop()
    const value = tail && tail.length >= 2 ? tail : raw
    // push() adds `value.indexOf(trimmed)` itself, so pass the match base plus
    // where the kept name starts inside the match.
    const offsetInRaw = Math.max(0, raw.indexOf(value))
    push('医院', value, m.index + offsetInRaw)
  }

  return resolveOverlaps(out)
}

function resolveOverlaps(candidates) {
  const sorted = [...candidates].sort((a, b) => {
    const pa = PRIORITY[a.type] ?? 0
    const pb = PRIORITY[b.type] ?? 0
    if (pa !== pb) return pb - pa
    return (b.end - b.start) - (a.end - a.start)
  })
  const accepted = []
  for (const candidate of sorted) {
    const overlaps = accepted.some((other) =>
      candidate.start < other.end && other.start < candidate.end)
    if (!overlaps) accepted.push(candidate)
  }
  return accepted.sort((a, b) => a.start - b.start)
}

/**
 * Values that look like an identifier but fail validation, reported for manual
 * review instead of being rewritten.
 */
export function scanSuspects(text) {
  const out = []
  for (const m of text.matchAll(/(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])/g)) {
    if (!validIdCard(m[0])) out.push({ type: '身份证号', text: m[0], reason: '校验位不符' })
  }
  return out
}
