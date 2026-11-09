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
/**
 * @param {string} text
 * @param {{ landline?: boolean }} [options] landline: also match labelled
 *   local landline numbers without an area code ("电话：66809363/66808119").
 *   Off by default: bare 7–8 digit numbers are often institution switchboards.
 */
export function scan(text, options = {}) {
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
  if (options.landline) {
    // A phone label followed by one or more 7–8 digit numbers separated by
    // "/", "、" or ","; each number is its own identifier.
    for (const m of text.matchAll(/(?:电话|联系电话|电话号码|座机|固话|tel|Tel|TEL)\s*[：:]\s*((?:\d{7,8}\s*[/、,，]\s*)*\d{7,8})(?!\d)/g)) {
      const base = m.index + m[0].indexOf(m[1])
      for (const n of m[1].matchAll(/\d{7,8}/g)) push('电话', n[0], base + n.index)
    }
  }
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
      let value = m[1]
      if (type === '姓名' || type === '医生') {
        if (NAME_STOP.has(value)) continue
      }
      if (type === '地址') {
        // "住址：某镇某村\t\t电话号码：…" — the value ends at a column gap or
        // the next label; otherwise the span overlaps the phone, loses the
        // overlap resolution, and the whole address is dropped.
        value = cutAddress(value)
        if (value.trim().length < 2) continue
      }
      push(type, value, m.index + m[0].indexOf(m[1]))
    }
  }

  // EMR template markup: 姓名<…>:<baseele … F=[引用值:姓名><isele 1>[<isele 0>张三<isele 1>]
  // The label and the value are separated by tags, so the labeled rules above
  // never see "姓名：张三". The field name inside 引用值 says what the value is.
  for (const m of text.matchAll(/\[引用值[:：]([^>\]\n]{1,20})>\s*(?:<isele 1>)?\s*\[\s*(?:<isele 0>)?([^<\]\n]{1,80}?)\s*(?:<isele 1>)?\]/g)) {
    const type = markupType(m[1])
    const value = m[2]
    if (!type || !value.trim()) continue
    if ((type === '姓名' || type === '医生') && (NAME_STOP.has(value.trim()) || !/^[\u4e00-\u9fa5·]{2,6}$/.test(value.trim()))) continue
    if (type === '地址' && (value.trim().length < 2 || /^[\d\s.:/-]+$/.test(value.trim()))) continue
    push(type, value, m.index + m[0].lastIndexOf(value))
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
    // "区属医院", "综合医院", a bare "医院" left after the split: categories
    // and common nouns, not a named institution. Registering them would
    // spread a pseudonym into every "中医院" / "到医院就诊" in the document.
    // "送检医院" as a whole is a label even though its tail "检医院" is not.
    if (genericInstitution(value) || genericInstitution(raw)) continue
    push('医院', value, m.index + offsetInRaw)
  }

  return resolveOverlaps(out)
}

const ADDRESS_STOP = /\t|\s{2,}|\s*(?:电话|联系电话|电话号码|手机|联系人|联系方式|邮编|邮政编码|身份证|证件|姓名|性别|年龄|工作单位|职业)\s*[：:]?/

function cutAddress(value) {
  const match = ADDRESS_STOP.exec(value)
  return match ? value.slice(0, match.index) : value
}

/** Which identifier an EMR template field ("引用值:联系地址") holds. */
function markupType(label) {
  const name = String(label).trim()
  if (/^(?:患者|病人|患儿)?姓名$|联系人|监护人|家属姓名/.test(name)) return '姓名'
  if (/住址|地址|工作单位|出生地|籍贯/.test(name)) return '地址'
  if (/医生|医师|签名/.test(name)) return '医生'
  if (/机构名称|医院名称/.test(name)) return '医院'
  return null
}

const INSTITUTION_SUFFIX = /(?:医院|卫生院|保健院|诊所)$/
// Prefixes that classify an institution instead of naming it: level, owner,
// specialty. A value made only of these plus a suffix is a category.
// Column titles and form labels name a role, not an institution: "申请医院",
// "送检医院", "签约诊所" (a CSV/XLSX header row is scanned like any cell).
const ROLE_PREFIX = '申请|检查|检验|化验|送检|报告|来源|合作|签约|就诊|就医|首诊|初诊|复诊|确诊|诊断|转诊|转院|转出|转入|入院|出院|出生|死亡|分娩|治疗|手术|执行|接收|接诊|收治|开单|开立|随访|体检|筛查|参保|结算|登记|建档|发证|签发|报卡|填报|上报|推荐|管理|目标|所属|所在|归属|对方|本次|上次|末次|首次|既往'
const GENERIC_PREFIX = new RegExp(`^(?:${ROLE_PREFIX}|[一二三]级|[甲乙丙]等|未定级|中西医结合|中医|西医|中|西|综合|专科|区属|市属|省属|县属|部属|军队|民营|公立|私立|非公|人民|妇幼|妇幼保健|儿童|妇产|肿瘤|口腔|眼科|精神病?|精神卫生|传染病|康复|护理|中心|乡镇|街道|社区|定点|上级|下级|基层|当地|外地|外院|我院|本院|该院|其他|其它|各级|各类|专科|大型|小型|私人|个体|村|乡|镇)*$`)

/** A category or common noun ("区属医院", "综合医院", "医院"), not a name. */
/**
 * A value in a person-name column that is really an institution name
 * ("full_name": "某某县人民医院"): it is pseudonymized as a hospital instead
 * of being rejected as "not a name".
 */
export function looksLikeInstitution(value) {
  const text = String(value ?? '').trim()
  if (text.length < 4 || genericInstitution(text)) return false
  return STRONG_INSTITUTION.test(text) || /(?:医学院|医科大学)(?:第.附属医院)?/.test(text) || /^[\u4e00-\u9fa5（）()]{4,40}(?:中心|门诊部)$/.test(text) && INSTITUTION.test(text.slice(0, -2))
}

export function genericInstitution(value) {
  const text = String(value ?? '').trim()
  if (!INSTITUTION_SUFFIX.test(text)) return false
  const head = text.replace(INSTITUTION_SUFFIX, '')
  return head.length === 0 || GENERIC_PREFIX.test(head)
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

/** Values made only of ASCII letters/digits/separators: record numbers, codes. */
export function isCodeLike(value) {
  return /^[0-9A-Za-z][0-9A-Za-z._/-]*$/.test(String(value ?? '').trim())
}

const CJK = /[\u4e00-\u9fa5]/
const INSTITUTION = /医院|卫生院|保健院|诊所|卫生服务|卫生室|卫生所|医疗|妇幼|疗养院|医学院|医科大学|研究所|研究院|中心|门诊部|急救站|血站|疾控/
const STRONG_INSTITUTION = /医院|卫生院|保健院|诊所|卫生服务中心|卫生室|卫生所|疗养院/
const DEPARTMENT = /科|病区|病房|护理单元|监护室|手术室|ICU|CCU/i
// Values in a staff/name column that are not people: system accounts, kiosks.
const FIELD_WORD = /电话|号码|手机|地址|住址|日期|时间|签名|科室|性别|年龄|诊断|联系方式|关系|身份证|病历|就诊|门诊|住院|医院|\d\s*[年月日时分秒]/
const NOT_A_PERSON = /^(?:auto|admin|system|sys|root|null|none|n\/a|-+|无|空|系统|自动|管理员)$/i

/**
 * Format plausibility for a detected identifier. Returns null when the value
 * can be what `type` says it is, or a short reason when it cannot.
 *
 * Header/key detections (`source === 'header'`) come from a dedicated column,
 * so only clearly impossible values are rejected there ("01" in an ID-card
 * column is a category code, not a card number). Model and rule detections
 * must also look like the type.
 */
export function plausible(type, value, source = 'llm') {
  const text = String(value ?? '').trim()
  const header = source === 'header'
  if (!text) return '空值'
  const digits = text.replace(/\D/g, '').length
  switch (type) {
    case '身份证号':
      if (validIdCard(text) || /^\d{15}$/.test(text)) return null
      // Passports, HK/Macau/Taiwan permits and similar: letters + many digits.
      if (/^[A-Za-z0-9-]{6,20}$/.test(text) && digits >= 6) return header || /^[A-Za-z]{1,2}\d{6,10}$/.test(text) ? null : '不符合证件号格式'
      return '不符合证件号格式'
    case '电话':
      return digits >= 7 && digits <= 15 && /^[\d\s()+\-转#]+$/.test(text) ? null : '不符合电话格式'
    case '银行卡号':
      return digits >= 12 && digits <= 19 && /^[\d\s-]+$/.test(text) ? null : '不符合银行卡号格式'
    case '邮箱':
      return /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(text) ? null : '不符合邮箱格式'
    case '病历号':
    case '住院号':
    case '就诊号':
    case '社保号':
      if (digits === 0) return '不含数字'
      if (text.length < (header ? 3 : 4)) return '过短'
      if (!header && CJK.test(text)) return '含中文'
      return null
    case '姓名':
    case '医生':
      if (NAME_STOP.has(text) || NOT_A_PERSON.test(text)) return '不是人名'
      // "电话号码", "日期：2026年01月03日20时56分" under a 联系人/签名 label:
      // a field label or a timestamp, which would otherwise spread everywhere.
      if (FIELD_WORD.test(text)) return '像字段标签或日期'
      // In a dedicated column "张某1023" is a name with a staff number; from
      // free text or a sibling label it is more likely a date or a code.
      if (!header && CJK.test(text) && digits >= 4) return '含日期或编号'
      if (header) return text.length >= 1 ? null : '过短'
      if (text.length < 2 || text.length > 30) return '长度不像人名'
      if (/^[\d\s.:/-]+$/.test(text)) return '纯数字'
      return null
    case '医院':
      if (genericInstitution(text)) return '是机构类别或通用名称'
      if (header) return null
      if (DEPARTMENT.test(text) && !STRONG_INSTITUTION.test(text)) return '疑似科室/病区名称'
      return INSTITUTION.test(text) ? null : '不含机构名称特征'
    case '地址':
      return text.length >= 2 && !/^[\d\s.:/-]+$/.test(text) ? null : '不像地址'
    default:
      return null
  }
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
