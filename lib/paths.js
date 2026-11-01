/**
 * Anonymize identifiers that appear in file and directory names.
 *
 * Output relative paths keep their structure; only the identifying tokens of a
 * segment change ("patient_573453" → "patient_病历-1A2B3C"), with the same
 * vault token the file contents get for the same (type, value). Category
 * folders, yyyymm folders, schema file names, site codes and extensions are
 * left alone. Detection is deliberately conservative: a path is shown to users
 * and in reports, so a false positive mangles structure while a false
 * negative is listed by the residual check like any other leftover.
 */
import { isPseudonym } from './rules.js'
import { maskValue, redactLabel } from './policy.js'

const SEP_CLASS = '_\\-\\s.'
const SEP_CHAR = /[_\-\s.]/
const PSEUDO_SRC = '(?:化名|患者|医生|证件|电话|邮箱|地址|病历|住院|就诊|社保|银行卡|医院)-[0-9A-F]{6,10}'
// A pseudonym is one token even though it contains "-".
const TOKEN_RE = new RegExp(`${PSEUDO_SRC}|[${SEP_CLASS}]+|[^${SEP_CLASS}]+`, 'g')
const EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,7}$/
const CJK_NAME = /^[\u4e00-\u9fa5]{2,4}$/
const MOBILE = /^1[3-9]\d{9}$/

/** Segments that are schema/category names in hospital exports: never touched. */
const PROTECTED_SEGMENT = /gehr|rcd/i

const PREFIX_TYPES = new Map([
  ['patient', '病历号'],
  ['pid', '病历号'],
  ['empi', '病历号'],
  ['zyh', '住院号'],
  ['mzh', '就诊号'],
])

const SINGLE_SURNAMES = new Set([...(
  '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤常温康施文牛樊葛邢安齐易乔伍庞颜倪庄聂章鲁岳翟殷詹申欧耿关兰焦俞左柳甘祝包宁尚符舒阮柯纪梅童凌毕单季裴霍涂成苗谷盛曲翁冉骆蓝路游辛靳管柴蒙鲍华喻祁蒲房滕屈饶解牟艾尤阳时穆农司卓古吉缪简车项连芦麦褚娄窦戚岑景党宫费卜冷晏席卫米柏宗瞿桂全佟应臧闵苟邬边卞姬师和仇栾隋商刁沙荣巫寇桑郎甄丛仲虞敖巩明佘池查麻苑迟邝'
)])
const COMPOUND_SURNAMES = new Set([
  '欧阳', '司马', '上官', '诸葛', '东方', '皇甫', '尉迟', '公孙', '慕容', '长孙',
  '宇文', '司徒', '夏侯', '轩辕', '令狐', '钟离', '端木', '独孤', '南宫', '西门',
])

/** Common folder / file words in medical exports that are never names. */
const DENY_WORDS = new Set([
  '住院', '门诊', '急诊', '检查', '检验', '处方', '医嘱', '病历', '病案', '病程', '病理',
  '影像', '超声', '心电', '放射', '手术', '麻醉', '护理', '体检', '化验', '诊断', '用药',
  '药品', '费用', '结算', '医保', '首页', '出院', '入院', '转科', '会诊', '随访', '小结',
  '记录', '报告', '文书', '文档', '文件', '资料', '数据', '附件', '图片', '扫描', '原始',
  '汇总', '统计', '明细', '清单', '目录', '备份', '导出', '导入', '临时', '其他', '其它',
  '方案', '常规', '康复', '时间', '日期', '全部', '安全', '计划', '项目', '样本', '标本',
  '患者', '病人', '姓名', '性别', '年龄', '男', '女', '化名', '未知', '不详', '无', '正常',
  '阳性', '阴性', '家属', '本人', '电话', '地址', '科室', '医生', '医师', '护士', '主任',
  '高血压', '糖尿病', '白细胞', '血常规', '尿常规', '出院小结', '入院记录', '病程记录',
  '检查报告', '检验报告', '手术记录', '护理记录', '住院记录', '门诊记录', '就诊记录',
])

// Characters that make a short CJK token a medical/record word rather than a
// given name ("高血压", "白细胞", "文档", "单据").
const NON_NAME_CHARS = /[病症科院诊检验药术血尿炎癌瘤疗医护床表录报告费类型期室区片像影图规档案据细查测试件夹份集号卡码证史程嘱剂处理压脉肺肝肾胃肠骨脑眼喉齿皮肤库部门次量率数资料信息首页汇总统计结果记单诊治疗院]/

/**
 * Validate an 18-digit resident ID number (GB 11643 check digit).
 * @param {string} value
 */
export function validIdCard(value) {
  if (!/^\d{17}[\dXx]$/.test(value)) return false
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = '10X98765432'
  let sum = 0
  for (let i = 0; i < 17; i += 1) sum += Number(value[i]) * weights[i]
  return checks[sum % 11] === value[17].toUpperCase()
}

/** True when `token` looks like a Chinese personal name by surname alone. */
function surnameName(token) {
  const chars = [...token]
  if (COMPOUND_SURNAMES.has(chars.slice(0, 2).join('')) && chars.length >= 3 && chars.length <= 4) return true
  return SINGLE_SURNAMES.has(chars[0]) && chars.length >= 2 && chars.length <= 3
}

function nameCandidate(token) {
  return CJK_NAME.test(token) && !DENY_WORDS.has(token) && !NON_NAME_CHARS.test(token)
}

/**
 * Normalize the `known` option into a lower-cased value → {type, text} map.
 * Accepted shapes:
 *   - iterable of `{ type, text }` (content detections: `{ type: '姓名', text: '张三' }`)
 *   - `Map<text, type>` or iterable of `[text, type]` pairs
 * Values shorter than 2 chars, pure numbers under 5 digits, pseudonyms and
 * deny-listed folder words are ignored.
 */
function normalizeKnown(known) {
  const out = new Map()
  if (!known) return out
  for (const item of known) {
    let text
    let type
    if (Array.isArray(item)) [text, type] = item
    else if (item && typeof item === 'object') ({ text, type } = item)
    if (typeof text !== 'string' || typeof type !== 'string') continue
    const value = text.trim().replace(/^[_\-\s.]+|[_\-\s.]+$/g, '')
    if (value.length < 2 || value.includes('/')) continue
    if (/^\d+$/.test(value) && value.length < 5) continue
    if (isPseudonym(value) || DENY_WORDS.has(value) || PROTECTED_SEGMENT.test(value)) continue
    const key = value.toLowerCase()
    if (!out.has(key)) out.set(key, { type, text: value })
  }
  return out
}

/**
 * Create a path anonymizer for one batch.
 *
 * @param {object} options
 * @param {import('./pseudonym.js').Vault} options.vault loaded vault; `vault.token(type, original)`
 *   yields the same token the file contents get
 * @param {{identifiers?: Record<string,string>, allowValues?: string[]}} [options.policy]
 *   resolved policy (`resolvePolicy()`); missing types default to 'pseudonym'
 * @param {Iterable<{type: string, text: string}> | Map<string,string>} [options.known]
 *   identifier values detected in file contents this batch. Any separator-bounded
 *   substring of a segment equal to one (case-insensitive) is replaced using that type.
 * @returns {{
 *   map: (relPath: string) => string,
 *   entries: () => {original: string, anonymized: string, items: {type: string, pseudonym: string}[]}[],
 *   prefixes: () => {original: string, anonymized: string, items: {type: string, pseudonym: string}[]}[],
 * }}
 *   `entries()` has one row per distinct relPath passed to `map()` that changed
 *   (items = every replacement along the path). `prefixes()` is de-duplicated
 *   per directory/file prefix: one row for each prefix whose own last segment
 *   changed ("patient_573453" once, however many files lie under it).
 *   Collision suffixes (~2, ~3 …) depend on map() call order; map paths in a
 *   stable (sorted) order for reproducible output.
 */
export function createPathAnonymizer({ vault, policy, known } = {}) {
  const knownMap = normalizeKnown(known)
  const knownList = [...knownMap.values()].sort((a, b) => b.text.length - a.text.length)
  const allow = new Set((policy?.allowValues ?? []).map((value) => String(value).toLowerCase()))
  const prefixCache = new Map() // original prefix → { out, items, changed }
  const claimed = new Map() // output prefix → original prefix
  const prefixChanges = []
  const pathEntries = new Map() // original relPath → entry

  const replacementFor = (type, original) => {
    const strategy = policy?.identifiers?.[type] ?? 'pseudonym'
    if (strategy === 'keep') return original
    if (strategy === 'mask') return maskValue(type, original).replace(/\*/g, 'x')
    if (strategy === 'redact') return redactLabel(type)
    return vault.token(type, original)
  }

  /** Detect and replace identifiers inside one stem. */
  const mapStem = (stem) => {
    const tokens = []
    for (const m of stem.matchAll(TOKEN_RE)) {
      const sep = SEP_CHAR.test(m[0][0]) && !isPseudonym(m[0])
      tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length, sep, pseudo: isPseudonym(m[0]) })
    }
    const spans = []
    const free = (start, end) => !spans.some((s) => start < s.end && s.start < end)
      && !tokens.some((t) => t.pseudo && start < t.end && t.start < end)

    // 1. Values already found in contents: same type, same token.
    const lower = stem.toLowerCase()
    for (const { type, text } of knownList) {
      const needle = text.toLowerCase()
      let from = 0
      while (from <= lower.length - needle.length) {
        const at = lower.indexOf(needle, from)
        if (at < 0) break
        const end = at + needle.length
        const bounded = (at === 0 || SEP_CHAR.test(stem[at - 1])) && (end === stem.length || SEP_CHAR.test(stem[end]))
        if (bounded && free(at, end)) spans.push({ start: at, end, type, original: stem.slice(at, end) })
        from = at + 1
      }
    }

    // 2. Rules on standalone tokens.
    const words = tokens.filter((t) => !t.sep)
    const typeOf = (text, fallback) => knownMap.get(text.toLowerCase())?.type ?? fallback
    const evidence = words.some((w) => validIdCard(w.text) || MOBILE.test(w.text))
    words.forEach((word, index) => {
      if (word.pseudo || !free(word.start, word.end)) return
      const text = word.text
      let type = null
      const prev = words[index - 1]?.text.toLowerCase()
      if (validIdCard(text)) type = '身份证号'
      else if (MOBILE.test(text)) type = '电话'
      else if (prev && PREFIX_TYPES.has(prev) && /^[A-Za-z0-9]{2,}$/.test(text) && /\d/.test(text)) type = PREFIX_TYPES.get(prev)
      else if (nameCandidate(text) && (evidence || surnameName(text))) type = '姓名'
      if (type) spans.push({ start: word.start, end: word.end, type: typeOf(text, type), original: text })
    })

    spans.sort((a, b) => a.start - b.start)
    let out = ''
    let cursor = 0
    const items = []
    for (const span of spans) {
      if (allow.has(span.original.toLowerCase())) continue
      const value = replacementFor(span.type, span.original)
      if (value === span.original) continue
      out += stem.slice(cursor, span.start) + value
      cursor = span.end
      items.push({ type: span.type, pseudonym: value })
    }
    return { text: out + stem.slice(cursor), items }
  }

  const mapSegment = (segment) => {
    if (!segment || segment === '.' || segment === '..' || PROTECTED_SEGMENT.test(segment)) {
      return { stem: segment, ext: '', items: [] }
    }
    const ext = EXT_RE.exec(segment)?.[0] ?? ''
    const base = ext && segment.length > ext.length ? segment.slice(0, -ext.length) : segment
    const ownExt = base === segment ? '' : ext
    const { text, items } = mapStem(base)
    return { stem: text, ext: ownExt, items }
  }

  const map = (relPath) => {
    const original = String(relPath ?? '')
    if (pathEntries.has(original)) return pathEntries.get(original).anonymized
    const segments = original.split('/')
    let origPrefix = ''
    let outPrefix = ''
    const items = []
    segments.forEach((segment, index) => {
      origPrefix = index === 0 ? segment : `${origPrefix}/${segment}`
      let cached = prefixCache.get(origPrefix)
      if (!cached) {
        const mapped = mapSegment(segment)
        const changed = mapped.items.length > 0
        const join = (seg) => (index === 0 ? seg : `${outPrefix}/${seg}`)
        let out = join(mapped.stem + mapped.ext)
        if (changed) {
          let n = 1
          while (claimed.has(out) && claimed.get(out) !== origPrefix) {
            n += 1
            out = join(`${mapped.stem}~${n}${mapped.ext}`)
          }
        }
        if (!claimed.has(out)) claimed.set(out, origPrefix)
        cached = { out, items: mapped.items, changed }
        prefixCache.set(origPrefix, cached)
        if (changed) prefixChanges.push({ original: origPrefix, anonymized: out, items: mapped.items })
      }
      outPrefix = cached.out
      for (const item of cached.items) {
        if (!items.some((x) => x.type === item.type && x.pseudonym === item.pseudonym)) items.push(item)
      }
    })
    const entry = { original, anonymized: outPrefix, items }
    pathEntries.set(original, entry)
    return outPrefix
  }

  return {
    map,
    entries: () => [...pathEntries.values()].filter((e) => e.anonymized !== e.original)
      .map((e) => ({ ...e, items: [...e.items] })),
    prefixes: () => prefixChanges.map((e) => ({ ...e, items: [...e.items] })),
  }
}
