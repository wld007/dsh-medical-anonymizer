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

const PSEUDONYM_LABELS = '(?:化名|患者|医生|证件|电话|邮箱|地址|病历|住院|就诊|社保|银行卡|医院)'
// Vault pseudonyms are a label plus exactly 6 uppercase hex characters
// (pseudonym.js codeFor). DICOM path codes (dicom/profile.js pathCode) use 8
// hex characters after 患者/医生/就诊/住院; an all-decimal one would read as a
// real 8-digit number ("住院-20240301"), so only codes with a letter count.
const PATH_CODE = '(?:患者|医生|就诊|住院)-(?=[0-9]*[A-F])[0-9A-F]{8}'
const PSEUDONYM_RE = new RegExp(`^(?:${PSEUDONYM_LABELS}-[0-9A-F]{6}|${PATH_CODE})$`)
const PSEUDONYM_SCAN = new RegExp(`(${PATH_CODE})(?![0-9A-Za-z])|${PSEUDONYM_LABELS}-[0-9A-F]{6}`, 'g')
/**
 * Regex source for one pseudonym-shaped token that is not the start of a
 * longer number ("电话-13800138000" is a label, "-" and a real phone). For
 * tokenizers (paths.js); all-digit codes are left to isPseudonym(value, issued).
 */
export const PSEUDONYM_TOKEN_SOURCE = `(?:${PATH_CODE}|${PSEUDONYM_LABELS}-(?=[0-9]*[A-F])[0-9A-F]{6})(?![0-9A-Za-z])`

/**
 * A whole value in pseudonym format. The vault never issues an all-digit code
 * (pseudonym.js codeFor): "病历-123456" is how a real 6-digit record number
 * can be written, so it counts only when `issued` (token => boolean, the
 * pseudonyms this vault/run produced) says an older vault issued it.
 */
export function isPseudonym(value, issued) {
  const text = String(value ?? '').trim()
  if (!PSEUDONYM_RE.test(text)) return false
  if (/-\d+$/.test(text)) return typeof issued === 'function' && Boolean(issued(text))
  return true
}

/**
 * Pseudonym tokens in running text. A token is the label, '-', and exactly
 * six hex characters with at least one letter that do not continue into a
 * longer letter/digit run: "电话-13800138000", "证件-11010519491231002X" and
 * "病历-123456" are real numbers written after a word, not pseudonyms. With
 * `issued` (token => boolean, the pseudonyms this vault/run produced), an
 * issued token counts even when it is all digits or glued to more
 * letters/digits.
 * @returns {{start: number, end: number, token: string}[]}
 */
export function pseudonymSpans(text, issued) {
  const out = []
  if (typeof text !== 'string' || !text.includes('-')) return out
  const known = typeof issued === 'function' ? issued : null
  for (const m of text.matchAll(PSEUDONYM_SCAN)) {
    const token = m[0]
    const end = m.index + token.length
    let ok = true
    if (!m[1]) {
      const glued = end < text.length && /[0-9A-Za-z]/.test(text[end])
      if (glued || /-\d{6}$/.test(token)) ok = Boolean(known?.(token))
    }
    if (ok) out.push({ start: m.index, end, token })
  }
  return out
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

// Province-level region codes (GB/T 2260): the first two digits of an ID.
const ID_REGIONS = new Set([
  11, 12, 13, 14, 15, 21, 22, 23, 31, 32, 33, 34, 35, 36, 37, 41, 42, 43, 44, 45, 46,
  50, 51, 52, 53, 54, 61, 62, 63, 64, 65, 71, 81, 82,
])

function validDay(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** First-generation 15-digit ID: region, YYMMDD (19YY), sequence; no checksum. */
function validIdCard15(value) {
  if (!/^\d{15}$/.test(value) || !ID_REGIONS.has(Number(value.slice(0, 2)))) return false
  return validDay(1900 + Number(value.slice(6, 8)), Number(value.slice(8, 10)), Number(value.slice(10, 12)))
}

/** A digit run that starts with a calendar date (timestamps, serial numbers). */
function startsWithDate(digits) {
  const m = /^((?:19|20)\d{2})(\d{2})(\d{2})/.exec(digits)
  return Boolean(m) && validDay(Number(m[1]), Number(m[2]), Number(m[3]))
}

/**
 * Full-width ASCII digits/letters and the few symbols identifiers use
 * ("１３８…", "Ｘ", "－", "＋", "＠", "．") map 1:1 to ASCII, so offsets found
 * on the mapped copy are offsets in the original string.
 */
function toHalfWidth(text) {
  return text.replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A\uFF0B\uFF0D\uFF20\uFF0E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
}

// Between a label and its value: a colon, or the cell border of a Markdown
// table row ("| 姓名 | 张三 |"), with optional Markdown emphasis around it
// ("**姓名**：张三", "**病历号：**MRN…", "| **姓名** | 张三 |").
const SEP = '[*_]{0,2}\\s*(?:[：:]|\\|)\\s*[*_]{0,2}\\s*'
// A person name after a label: a "·"-joined name (minority/foreign names), a
// two-character name padded with spaces ("张  三"), or 2–4 Han characters.
// A period is not a joiner: "张三.性别：男", "张三.男" end the name there.
const NAME_VALUE = '([\u4e00-\u9fa5]{1,8}(?:[·•・][\u4e00-\u9fa5]{1,10}){1,3}|[\u4e00-\u9fa5](?:[ \u3000]{1,3}[\u4e00-\u9fa5]){1,2}(?![\u4e00-\u9fa5·])|[\u4e00-\u9fa5]{2,4})'
// Label words that end a name written without a delimiter ("张三性别：男").
const NAME_CUT = /性别|年龄|民族|出生|电话|手机|住址|地址|职业|科室|床号|婚姻|籍贯|身份|证件|病历|住院|门诊|联系|国籍|单位|诊断|入院|出院|日期|医生|医师|主任|护士|签名|签字|关系/
const SEX_WORD = new Set(['男', '女', '无'])

/**
 * The name part of a labelled-name capture, or null when it is not a name.
 * `after` is the text right after the capture: a label cut in half by the
 * 4-character limit ("张三丰性|别：男") is still recognised.
 */
function nameValue(raw, after, type) {
  let value = raw
  const parts = value.split(/[ \u3000]+/)
  if (parts.length > 1) {
    // "张 三 男": the sex after a padded name is not part of it.
    if (parts.length === 3 && SEX_WORD.has(parts[2])) value = value.slice(0, value.lastIndexOf(parts[2])).trimEnd()
    if (value.split(/[ \u3000]+/).some((part) => SEX_WORD.has(part))) return null
  } else {
    const cut = (value + after).search(NAME_CUT)
    if (cut === 0) return null
    if (cut > 0 && cut < value.length) value = value.slice(0, cut)
  }
  const compact = value.replace(/[ \u3000]/g, '')
  if (compact.length < 2 || NAME_STOP.has(compact)) return null
  if (plausible(type, compact, 'llm')) return null
  return value
}

// Where a labelled address ends: a column gap, the next label, Markdown
// emphasis or a table pipe, or a bare phone/ID/email after a space
// ("住址：某路100号 13800138000").
const ADDRESS_STOP = new RegExp([
  '\\t', '\\s{2,}', '\\*\\*', '\\|',
  '\\s*(?:电话|联系电话|电话号码|手机|联系人|联系方式|邮编|邮政编码|身份证|证件|姓名|性别|年龄|工作单位|职业)\\s*[：:]?',
  '\\s+(?=(?:\\+?86[ -]?)?1[3-9]\\d(?:\\d{8}|[ -]\\d{4}[ -]\\d{4})(?!\\d)|\\d{15}(?:\\d{2}[\\dXx])?(?![0-9A-Za-z])|[A-Za-z0-9._%+-]+@|[(（]?0\\d{2,3}[)）]?[ -]?\\d{7,8}(?!\\d))',
].join('|'))

// Mainland area codes: 010, 02X, then four digits 03XX–09XX. A local number
// never starts with 0.
const AREA = '0(?:10|2\\d|[3-9]\\d{2})'
const PHONE_LABEL = '(?:电话|联系电话|电话号码|手机|手机号|手机号码|座机|固话|联系方式|tel|Tel|TEL|phone|Phone)'
// Mobile: optional +86/0086 (or "86 ") prefix, 11 digits contiguous or grouped
// 3-4-4 with one consistent space/dash. The identifier is the capture.
// Phone and card numbers are bounded by digits only: letters often sit right
// next to them ("TEL13800138000", "zhangsan13800138000.txt", "card6222…").
const MOBILE_RE = /(?<!\d)(?:(?:\+|00)86[ -]?|86[ -])?(1[3-9]\d(?:\d{8}|([ -])\d{4}\2\d{4}))(?!\d)/g
const BARE_LANDLINE_RE = new RegExp(`(?<!\\d)(?:0\\d{2,3}-\\d{7,8}|[(（]${AREA}[)）][ -]?[1-9]\\d{6,7})(?!\\d)`, 'g')
// After a phone label: area code glued or space-separated ("01066809363",
// "0571 88888888"). Without the label such runs are too often codes.
const LABELLED_LANDLINE_RE = new RegExp(`${PHONE_LABEL}${SEP}(${AREA}[ ]?[1-9]\\d{6,7})(?!\\d)`, 'g')
const LOCAL_LANDLINE_RE = new RegExp(`(?:电话|联系电话|电话号码|座机|固话|tel|Tel|TEL)${SEP}((?:\\d{7,8}\\s*[/、,，]\\s*)*\\d{7,8})(?!\\d)`, 'g')
// Bank cards: 16–19 contiguous digits, or 4-digit groups with one consistent
// separator (4-4-4-4 plus an optional 1–3 digit tail).
const CARD_RE = /(?<!\d)(?:\d{16,19}|\d{4}([ -])\d{4}\1\d{4}\1\d{4}(?:\1\d{4})?(\1\d{1,3})?)(?!\d)/g
// After a card label any grouping of 3+ digit runs with one consistent
// separator ("卡号 622202 0200001234562", "6222 0202 0000 1234562"); without
// the label such runs are as often lists of ordinary numbers.
const LABELLED_CARD_RE = new RegExp(`(?:卡号|银行卡|银行账号|账号|帐号|储蓄卡|信用卡|借记卡|card|Card|CARD)(?:号码?)?[*_]{0,2}\\s*(?:[：:]|\\|)?\\s*[*_]{0,2}\\s*(\\d{3,}([ -])\\d{3,}(?:\\2\\d{3,}){0,3})(?!\\d)`, 'g')

// Labelled names and doctors; the value is cut and checked by nameValue().
const LABELED_NAMES = [
  ['姓名', '(?:姓\\s*名|患者姓名|病人姓名|联系人|家属|监护人|患者|病人|患儿)'],
  ['医生', '(?:医生|医师|主治医师|主任医师|副主任医师|教授|主任)'],
].map(([type, label]) => [type, new RegExp(`${label}${SEP}${NAME_VALUE}`, 'g')])
// Other labelled fields: the captured value is the identifier.
const LABELED = [
  ['地址', '(?:住址|现住址|家庭住址|户籍地址|联系地址|工作单位|出\\s*生\\s*地|籍\\s*贯)', '([^\\n，。；;]{2,60})'],
  ['病历号', '(?:病历号|病案号)'],
  ['住院号', '(?:住院号)'],
  ['就诊号', '(?:门诊号|就诊号|检查号|检验号|样本号|登记号)'],
  ['社保号', '(?:社保号|医保号|医保卡号)', '([A-Za-z0-9-]{6,24})'],
].map(([type, label, value = '([A-Za-z0-9-]{4,24})']) => [type, new RegExp(`${label}${SEP}${value}`, 'g')])

/**
 * Scan one string for direct identifiers.
 * @param {string} text
 * @param {{ landline?: boolean, issued?: (token: string) => boolean }} [options]
 *   landline: also match labelled local landline numbers without an area code
 *   ("电话：66809363/66808119"); off by default, bare 7–8 digit numbers are
 *   often institution switchboards. issued: the pseudonyms this vault/run
 *   produced (see pseudonymSpans).
 * @returns {{type: string, text: string, start: number, end: number, source: 'rule'}[]}
 */
export function scan(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return []
  const out = []
  // Full-width digits/letters are matched as ASCII; the spans are the same,
  // and the reported text is the original.
  const norm = toHalfWidth(text)
  // Already-pseudonymized spans must not be re-detected: "至医院-97BDA1" would
  // otherwise match the hospital pattern again on every verification pass.
  const pseudoSpans = pseudonymSpans(text, options.issued)
  const overlapsPseudonym = (start, end) => pseudoSpans.some((span) => start < span.end && span.start < end)
  const push = (type, value, start) => {
    if (!value) return
    const trimmed = value.trim()
    if (trimmed.length === 0) return
    const offset = start + value.indexOf(trimmed)
    const end = offset + trimmed.length
    if (overlapsPseudonym(offset, end)) return
    out.push({ type, text: text.slice(offset, end), start: offset, end, source: 'rule' })
  }
  /** Start of capture group `group` when it ends the whole match. */
  const tailStart = (m, group = 1) => m.index + m[0].length - m[group].length

  // Bare identifiers.
  for (const m of norm.matchAll(/(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])/g)) {
    if (validIdCard(m[0])) push('身份证号', m[0], m.index)
  }
  for (const m of norm.matchAll(/(?<![0-9A-Za-z])\d{15}(?![0-9A-Za-z])/g)) {
    if (validIdCard15(m[0])) push('身份证号', m[0], m.index)
  }
  for (const m of norm.matchAll(MOBILE_RE)) push('电话', m[1], tailStart(m))
  for (const m of norm.matchAll(BARE_LANDLINE_RE)) push('电话', m[0], m.index)
  for (const m of norm.matchAll(LABELLED_LANDLINE_RE)) push('电话', m[1], tailStart(m))
  if (options.landline) {
    // A phone label followed by one or more 7–8 digit numbers separated by
    // "/", "、" or ","; each number is its own identifier.
    for (const m of norm.matchAll(LOCAL_LANDLINE_RE)) {
      const base = tailStart(m)
      for (const n of m[1].matchAll(/\d{7,8}/g)) push('电话', n[0], base + n.index)
    }
  }
  for (const m of norm.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) push('邮箱', m[0], m.index)
  for (const m of norm.matchAll(CARD_RE)) {
    // A grouped card followed by a short number ("… 1234 562 1张" is fine, but
    // "4111 1111 1111 1111 12" is a card plus "12"): try without the tail too.
    const candidates = m[2] ? [m[0], m[0].slice(0, -m[2].length)] : [m[0]]
    const raw = candidates.find((value) => {
      const digits = value.replace(/\D/g, '')
      return luhn(digits) && !validIdCard(digits) && !startsWithDate(digits)
    })
    if (raw) push('银行卡号', raw, m.index)
  }
  for (const m of norm.matchAll(LABELLED_CARD_RE)) {
    const digits = m[1].replace(/\D/g, '')
    if (digits.length < 16 || digits.length > 19) continue
    if (luhn(digits) && !validIdCard(digits) && !startsWithDate(digits)) push('银行卡号', m[1], tailStart(m))
  }

  // Labeled fields: the captured value is the identifier.
  for (const [type, re] of LABELED_NAMES) {
    for (const m of norm.matchAll(re)) {
      const start = tailStart(m)
      const value = nameValue(m[1], norm.slice(start + m[1].length, start + m[1].length + 3), type)
      if (value) push(type, value, start)
    }
  }
  for (const [type, re] of LABELED) {
    for (const m of norm.matchAll(re)) {
      let value = m[1]
      if (type === '地址') {
        // "住址：某镇某村\t\t电话号码：…" — the value ends at a column gap,
        // the next label or a bare number; otherwise the span overlaps the
        // phone, loses the overlap resolution, and the whole address is dropped.
        value = cutAddress(value)
        if (value.trim().length < 2) continue
      }
      push(type, value, tailStart(m))
    }
  }

  // EMR template markup: 姓名<…>:<baseele … F=[引用值:姓名><isele 1>[<isele 0>张三<isele 1>]
  // The label and the value are separated by tags, so the labeled rules above
  // never see "姓名：张三". The field name inside 引用值 says what the value is.
  for (const m of norm.matchAll(/\[引用值[:：]([^>\]\n]{1,20})>\s*(?:<isele 1>)?\s*\[\s*(?:<isele 0>)?([^<\]\n]{1,80}?)\s*(?:<isele 1>)?\]/g)) {
    const type = markupType(m[1])
    const value = m[2]
    if (!type || !value.trim()) continue
    if ((type === '姓名' || type === '医生') && (NAME_STOP.has(value.trim()) || !/^[\u4e00-\u9fa5·]{2,6}$/.test(value.trim()))) continue
    if (type === '地址' && (value.trim().length < 2 || /^[\d\s.:/-]+$/.test(value.trim()))) continue
    push(type, value, m.index + m[0].lastIndexOf(value))
  }

  // Prose birthplace: "个人史：生于萧山，久居萧山。"
  for (const m of norm.matchAll(/生于([\u4e00-\u9fa5]{2,10})/g)) {
    push('地址', m[1], tailStart(m))
  }

  // Named hospitals (a quasi-identifier that often re-identifies a visit).
  for (const m of norm.matchAll(/[\u4e00-\u9fa5]{2,24}(?:医院|卫生院|保健院|诊所)/g)) {
    const raw = m[0]
    // "2周前，在北京协和医院", "月余前患者家属至老年医院": the match starts in
    // the prose; keep the proper-noun part after the last connective/time
    // word. Characters that occur inside institution names ("附属",
    // "和睦家") are not connectives.
    const suffix = INSTITUTION_SUFFIX.exec(raw)[0]
    const value = hospitalName(raw.slice(0, -suffix.length)) + suffix
    // "本医院", "该医院": a reference, not a name.
    if (/^[本该我此其住]/.test(value) || (/^[去回到在于从至]/.test(value) && !connectivePlace(value))) continue
    // "区属医院", "综合医院", a bare "医院" left after the split: categories
    // and common nouns, not a named institution. Registering them would
    // spread a pseudonym into every "中医院" / "到医院就诊" in the document.
    // "送检医院" as a whole is a label even though its tail "检医院" is not.
    if (genericInstitution(value) || genericInstitution(raw)) continue
    push('医院', value, m.index + raw.length - value.length)
  }

  return resolveOverlaps(out)
}

// Prose before a hospital name: time words, connectives and verbs of motion.
// "回民医院" is a name (Hui hospitals), "回当地医院" is prose.
const HOSPITAL_PROSE = /家属|患者|病人|回(?!民)|[前后在至于到去过赴送往了着的为因系就诊入出转从]/g

/**
 * "从化区", "于都县", "前郭县": the connective starts a place name. Only these
 * three characters begin real county names; "在社区", "到市区", "于小区",
 * "从本市" are prose followed by a common noun.
 */
function connectivePlace(text) {
  return /^[从于前][^社小市城郊县省区本该当此其某大老附多各外上原我][市区县镇乡旗]/.test(text)
}

/** The part of `head` after the last prose word ("2周前在|北京协和"). */
function hospitalName(head) {
  let cut = 0
  for (const m of head.matchAll(HOSPITAL_PROSE)) {
    if (m[0].length === 1 && connectivePlace(head.slice(m.index))) continue
    cut = m.index + m[0].length
  }
  return head.slice(cut)
}

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
const GENERIC_PREFIX = new RegExp(`^(?:${ROLE_PREFIX}|[一二三]级|[甲乙丙]等|未定级|中西医结合|中医|西医|中|西|综合|专科|区属|市属|省属|县属|部属|军队|民营|公立|私立|非公|人民|妇幼|妇幼保健|儿童|妇产|肿瘤|口腔|眼科|精神病?|精神卫生|传染病|康复|护理|中心|乡镇|街道|社区|定点|上级|下级|基层|当地|外地|外院|我院|本院|该院|其他|其它|各级|各类|专科|大型|小型|私人|个体|村|乡|镇|` +
  // Where or which, not a name: "社区医院", "本市医院", "当地县医院",
  // "附近诊所", "多家医院", "上述医院", "大医院".
  `小区|市区|城区|郊区|县城|省城|乡村|农村|本地|老家|家附近|附近|就近|周边|上述|前述|这家|那家|多家|几家|数家|两家|一家|某家|别家|别的|这|那|本|该|此|其|某|各|大|小|省|市|县|区)*$`)

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
  const overlapping = (item) => accepted.filter((other) => item.start < other.end && other.start < item.end)
  for (const candidate of sorted) {
    const hits = overlapping(candidate)
    if (hits.length === 0) {
      accepted.push(candidate)
      continue
    }
    // "住址：某路100号13800138000": an address that runs into a stronger
    // identifier keeps the part before it instead of being dropped whole.
    if (candidate.type !== '地址' || hits.some((other) => other.start <= candidate.start)) continue
    const cut = Math.min(...hits.map((other) => other.start))
    const text = candidate.text.slice(0, cut - candidate.start).replace(/[\s,，;；:：、]+$/, '')
    if (text.length < 2) continue
    const trimmed = { ...candidate, text, end: candidate.start + text.length }
    if (overlapping(trimmed).length === 0) accepted.push(trimmed)
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
