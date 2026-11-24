/**
 * Format-aware documents. A document exposes text segments, applies
 * replacements inside a segment, and serializes back into the same format.
 * Replacements never touch anything outside a matched span, which is what
 * keeps the structure intact.
 */
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import * as XLSX from '../vendor/xlsx.mjs'

const CHUNK_CHARS = 1400

export function detectKind(path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.txt' || ext === '.md') return 'text'
  if (ext === '.csv') return 'csv'
  if (ext === '.json') return 'json'
  if (ext === '.xlsx') return 'xlsx'
  return null
}

const HEADER_HINTS = [
  [/姓名|患者姓名|病人姓名|联系人|监护人|^(?:patient_?)?name$|full_?name/i, '姓名'],
  // Patient / self / contact / guardian / relative names, including the
  // "*_PSN_NM" spelling of a contact person (CNTCT_PSN_NM).
  [/^(?:ptt?|patient|ctct|cntct|contact|slf|self|grdn|guardian|rltv|relative|fml|family|lnk|link)_?(?:psn_?)?nm$/i, '姓名'],
  [/(?:^|_)(?:ctct|cntct|contact|grdn|guardian|rltv|relative|lnk|link)_?(?:psn_?)?nm$/i, '姓名'],
  [/身份证|证件号|证件号码|(?:^|_)(?:id_?(?:crd|card|no)|cert_?no)(?:_|$)/i, '身份证号'],
  [/手机|电话|联系方式|联系电话|(?:^|_)(?:phone|mobile|tel)(?:_|$)/i, '电话'],
  [/邮箱|e-?mail/i, '邮箱'],
  [/住址|地址|工作单位|(?:^|_)addr|(?:^|_)(?:wrk|work)_?(?:unt|unit)(?:_|$)|employer/i, '地址'],
  [/病历号|病案号|^mrn$/i, '病历号'],
  [/住院号|admission_?no|inhos_?no|inp_?no/i, '住院号'],
  [/(?:^|_)(?:rcd_?no|record_?no)|mdc_?htr_?rcd|^prm_?key$/i, '病历号'],
  // Person-level keys that link every record of one patient across files.
  [/^(?:user|usr|patient|ptt|psn|person|empi|mpi)_?id$/i, '病历号'],
  [/就诊号|门诊号|登记号|挂号号|visit_?no|(?:^|_)(?:otpt_?emg|otpt|emg|rgst|vst_?unq)_?(?:no|id)(?:_dsply)?$/i, '就诊号'],
  [/社保|医保/, '社保号'],
  [/银行卡|bank_?card/i, '银行卡号'],
  [/医院|hospital|mdc_?org_?nm|source_?org_?nm|(?:^|_)org_?nm$/i, '医院'],
  // Institution codes re-identify the hospital as well as its name does.
  [/(?:^|_)(?:mdc_?)?org_?(?:cd|code)$/i, '医院'],
  [/医生|医师|接诊|签名|doctor|physician|(?:^|_)(?:dct|doctor|physician|stff|staff|nurse|nus|psn|oprtr|operator)_?nm$/i, '医生'],
  // Staff codes/signatures identify a person as well as the name does.
  [/(?:^|_)(?:dct|doctor|physician|stff|staff|nurse|nus)_?(?:cd|code|id|no)$|(?:^|_)(?:sgnt|signature|sign)$/i, '医生'],
  [/^pid$/i, '病历号'],
]

// Columns that describe an identifier rather than hold one: "证件类型代码"
// (ID_CRD_CGY_CD = "01"), "证件类别名称" (= "居民身份证"), flags and statuses.
// Matching them as identifier columns pseudonymizes category codes and then
// spreads that code across the whole document.
const HEADER_EXCLUDE = /类型|类别|种类|标志|状态|(?:^|_)(?:cgy|ctgy|catg|category|type|typ|tp|kind|cls|flg|flag|stts|status)(?:_|$)/i

export function hintForHeader(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (HEADER_EXCLUDE.test(text)) return null
  for (const [pattern, type] of HEADER_HINTS) if (pattern.test(text)) return type
  return null
}

export function hintForKey(key) {
  return hintForHeader(key)
}

// A bare "name" key is everywhere in JSON exports: diagnoses ({icd10, name}),
// lab items ({name, unit, value}), exams, drugs, order categories. Treating
// every one as a person name pseudonymizes clinical content and then spreads
// those values across the batch. In JSON a bare "name" counts as a person
// name only when its object carries person attributes (age, sex, birthday,
// ID card, phone, address) and no other key already holds the person's name.
const BARE_NAME_KEY = /^name$/i
const PERSON_ATTRIBUTE_KEY = /年龄|性别|出生|生日|(?:^|_)(?:age|sex|gender|gdr|birth|birthday|bth|brdy|nation|marital|marriage)(?:_|$)/i
const PERSON_ATTRIBUTE_HINTS = new Set(['身份证号', '电话', '地址', '社保号'])

/** Hint for a JSON object key, using its sibling keys as context. */
export function hintForJsonKey(parent, key) {
  const hint = hintForKey(key)
  if (hint !== '姓名' || !BARE_NAME_KEY.test(String(key))) return hint
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return hint
  const siblings = Object.keys(parent).filter((name) => name !== key)
  if (siblings.some((name) => hintForKey(name) === '姓名')) return null
  const personLike = siblings.some((name) => PERSON_ATTRIBUTE_KEY.test(name) || PERSON_ATTRIBUTE_HINTS.has(hintForKey(name)))
  return personLike ? hint : null
}

// Entity-attribute-value records: {"ITM_NM": "姓名", "ITM_VLU": "张三"}. The
// value key says nothing; the sibling name key carries the label.
const EAV_VALUE_KEY = /^(?:itm_?vlu|item_?(?:value|val)|value|val|vlu|content)$/i
const EAV_NAME_KEY = /^(?:itm_?nm(?:_?std)?|stdrd_?itm_?nm|item_?name|item|name|key|label|title|field)$/i

/** Hint for a JSON leaf from a sibling label ("ITM_NM" next to "ITM_VLU"). */
export function hintForSibling(parent, key) {
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return null
  if (!EAV_VALUE_KEY.test(String(key))) return null
  for (const [name, label] of Object.entries(parent)) {
    if (name === key || typeof label !== 'string' || !EAV_NAME_KEY.test(name)) continue
    if (label.length > 12) continue
    const hint = hintForHeader(label)
    if (hint) return hint
  }
  return null
}

// Column/key names whose values are quasi-identifiers. Used only when the
// quasi-identifier policy is enabled; a direct-identifier hint always wins.
const QUASI_HINTS = [
  [/出生|生日|birth|(?:^|_)bth(?:_|$)|日期|时间|(?:^|_)(?:dt|date|time|tm)(?:_|$)/i, '日期'],
  [/年龄|(?:^|_)age(?:_|$)/i, '年龄'],
  [/性别|(?:^|_)(?:sex|gender|gdr)(?:_|$)/i, '性别'],
  [/邮编|邮政编码|zip|postal|post_?(?:code|cd)/i, '邮编'],
]

export function quasiHintForHeader(value) {
  const text = String(value ?? '').trim()
  if (!text || hintForHeader(text)) return null
  for (const [pattern, type] of QUASI_HINTS) if (pattern.test(text)) return type
  return null
}

export async function loadDocument(path, relPath) {
  const kind = detectKind(path)
  if (kind === null) throw new Error(`不支持的文件类型: ${extname(path) || '(无扩展名)'}`)
  if (kind === 'xlsx') {
    const buffer = await readFile(path)
    return createXlsxDocument(buffer, relPath)
  }
  const buffer = await readFile(path)
  const { text: raw, encoding, ambiguous } = decodeTextBytes(buffer)
  const converted = encoding !== 'UTF-8'
  const options = { bytes: buffer.length, converted }
  let doc
  if (kind === 'text') doc = createTextDocument(raw, relPath, options)
  else if (kind === 'csv') doc = createCsvDocument(raw, relPath, options)
  else doc = createJsonDocument(raw, relPath)
  if (converted) {
    doc.bytes = buffer.length
    doc.notices = [...(doc.notices ?? []), { severity: 'warn', code: 'encoding', detail: `编码已从 ${encoding} 转为 UTF-8${kind === 'csv' ? '（带 BOM，Excel 可直接打开）' : ''}` }]
  }
  if (ambiguous) {
    doc.notices = [...(doc.notices ?? []), { severity: 'error', code: 'encoding', detail: '文件可按 UTF-8 解码但不含中文，其中的非 ASCII 字符按 GB18030（GBK）解码却是中文：编码无法确定，已按 UTF-8 处理，其中的中文姓名等可能未被识别，请人工核对；如原文件为 GBK，请转为 UTF-8 后重新处理' }]
  }
  return doc
}

/* -------------------------------------------------------------- encoding */

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
// Characters that never appear in real text: a "successful" legacy decode
// that produces them is the wrong encoding (binary, UTF-16 without BOM, ...).
const PRIVATE_USE = `${String.fromCharCode(0xE000)}-${String.fromCharCode(0xF8FF)}`
const IMPLAUSIBLE = new RegExp(`[\\x00-\\x08\\x0B\\x0E-\\x1F\\x7F${PRIVATE_USE}]`)
const REPLACEMENT_CHAR = 0xFFFD

/**
 * Decode a text/CSV/JSON file strictly. UTF-8 (BOM kept as U+FEFF, so the
 * format serializers can write it back), UTF-16LE/BE by BOM, otherwise
 * GB18030 (a superset of GBK, the default of Chinese Windows/Excel). Anything
 * that decodes cleanly in none of them is refused instead of being turned
 * into U+FFFD and delivered as unrecoverable text.
 */
export function decodeTextBytes(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  const refuse = (why) => new Error(`无法识别文件编码（${why}），未处理，请转为 UTF-8 后重试`)
  if (buffer.length >= 2 && ((buffer[0] === 0xFF && buffer[1] === 0xFE) || (buffer[0] === 0xFE && buffer[1] === 0xFF))) {
    const le = buffer[0] === 0xFF
    let text
    try {
      text = new TextDecoder(le ? 'utf-16le' : 'utf-16be', { fatal: true }).decode(buffer)
    } catch {
      throw refuse(`${le ? 'UTF-16LE' : 'UTF-16BE'} 内容不完整`)
    }
    if (IMPLAUSIBLE.test(text)) throw refuse(`${le ? 'UTF-16LE' : 'UTF-16BE'} 解码后含控制字符`)
    return { text, encoding: le ? 'UTF-16LE' : 'UTF-16BE' }
  }
  let utf8 = null
  try {
    utf8 = UTF8_STRICT.decode(buffer)
  } catch { /* not UTF-8 */ }
  if (utf8 !== null) {
    // NUL never occurs in text: this is UTF-16 without a BOM, or binary.
    if (utf8.includes('\0')) throw refuse('含 NUL 字节，可能是无 BOM 的 UTF-16 或二进制文件')
    return { text: utf8, encoding: 'UTF-8', ambiguous: ambiguousLegacy(buffer, utf8) }
  }
  // Mostly valid UTF-8 with a few bad bytes is damaged UTF-8, not GB18030:
  // decoding it as GB18030 would silently turn the Chinese into mojibake.
  const loose = new TextDecoder('utf-8').decode(buffer)
  let bad = 0
  let good = 0
  for (let i = 0; i < loose.length; i += 1) {
    const code = loose.charCodeAt(i)
    if (code === REPLACEMENT_CHAR) bad += 1
    else if (code > 0x7F) good += 1
  }
  if (good > bad) throw refuse('UTF-8 内容中有无效字节')
  let text
  try {
    text = new TextDecoder('gb18030', { fatal: true }).decode(buffer)
  } catch {
    throw refuse('不是 UTF-8、UTF-16 或 GB18030')
  }
  if (IMPLAUSIBLE.test(text)) throw refuse('按 GB18030 解码后含控制字符或私用区字符')
  return { text, encoding: 'GB18030' }
}

// Symbols that genuine UTF-8 text without Chinese commonly carries (units,
// lab values). None of their bytes, read as GBK, is a common surname.
const COMMON_SYMBOLS = new Set([...'\u00A0°±×µ²©®§»'])
const CJK_CHAR = /[\u3400-\u9FFF\uF900-\uFAFF]/

/**
 * A GBK file whose Chinese characters all happen to form two-byte UTF-8
 * sequences (肖强 → "Фǿ") decodes as UTF-8 without error. Such a decode has
 * no character at or above U+0800 (so no Chinese at all), while the same bytes
 * read as GB18030 give Chinese. Which one is right cannot be decided from the
 * bytes; the file must not be treated as clean UTF-8.
 */
function ambiguousLegacy(buffer, utf8) {
  let foreign = false
  for (let i = 0; i < utf8.length; i += 1) {
    const code = utf8.charCodeAt(i)
    if (code < 0x80 || code === 0xFEFF) continue
    if (code >= 0x800) return false
    if (!COMMON_SYMBOLS.has(utf8[i])) foreign = true
  }
  if (!foreign) return false
  try {
    const legacy = new TextDecoder('gb18030', { fatal: true }).decode(buffer)
    return CJK_CHAR.test(legacy) && !IMPLAUSIBLE.test(legacy)
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ text */

// A long line is cut into chunks of at most CHUNK_CHARS (the model and the
// layer view both work per chunk). The cut must never fall inside an
// identifier: rules, the batch dictionary and the model only ever see one
// chunk, so a value split across two chunks is never found whole.
const SENTENCE_END = new Set([...'。！？；!?;'])
const CLAUSE_END = new Set([...'，、,'])
const LABEL_END = new Set([...':：='])

function isDigit(ch) {
  return ch !== undefined && ((ch >= '0' && ch <= '9') || (ch >= '０' && ch <= '９'))
}

/** 'c' CJK run, 'a' identifier-like ASCII run (alnum @ . _ + -), 'o' other. */
function charClass(code) {
  if (code >= 0xD800 && code <= 0xDFFF) return 'c' // astral CJK (extension B+)
  if ((code >= 0x3400 && code <= 0x9FFF) || (code >= 0xF900 && code <= 0xFAFF) || code === 0xB7 || code === 0x30FB) return 'c'
  if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) return 'a'
  if (code === 0x40 || code === 0x2E || code === 0x5F || code === 0x2B || code === 0x2D) return 'a'
  // Full-width digits and letters are written inside IDs and phone numbers.
  if ((code >= 0xFF10 && code <= 0xFF19) || (code >= 0xFF21 && code <= 0xFF3A) || (code >= 0xFF41 && code <= 0xFF5A)) return 'a'
  return 'o'
}

// "label : value" spans (rules.js finds names, record numbers and addresses
// only as label + [：:] + value, so the three must share a chunk). The label
// is at most a few characters before the colon; the value runs to the end of
// the clause, a tab or column gap, the next "label:", or VALUE_CHARS.
const LABEL_CHARS = 12
const VALUE_CHARS = 60
const VALUE_END = new Set([...'\n\r，。；;\t'])
const NEXT_LABEL = /^\s*[^\s:：，。；;,、]{1,12}\s*[:：]/
const SPACE = /[ \t　]/

/** blocked[i] = 1: cutting before line[i] would split a label from its value. */
function labelSpans(window) {
  const blocked = new Uint8Array(window.length + 1)
  for (let p = 0; p < window.length; p += 1) {
    const ch = window[p]
    if (ch !== ':' && ch !== '：') continue
    if (isDigit(window[p - 1]) && isDigit(window[p + 1])) continue // 10:30
    let start = p
    while (start > 0 && p - start < 3 && SPACE.test(window[start - 1])) start -= 1
    let taken = 0
    while (start > 0 && taken < LABEL_CHARS) {
      const prev = window[start - 1]
      if (VALUE_END.has(prev) || SENTENCE_END.has(prev) || CLAUSE_END.has(prev) || LABEL_END.has(prev)) break
      if (SPACE.test(prev) && (start < 2 || SPACE.test(window[start - 2]))) break
      start -= 1
      taken += 1
    }
    let end = p + 1
    while (end < window.length && SPACE.test(window[end])) end += 1
    const valueStart = end
    while (end < window.length && end - valueStart < VALUE_CHARS) {
      const next = window[end]
      if (VALUE_END.has(next)) break
      if (SPACE.test(next) && (SPACE.test(window[end + 1] ?? '') || NEXT_LABEL.test(window.slice(end, end + 16)))) break
      end += 1
    }
    for (let i = start + 1; i < end; i += 1) blocked[i] = 1
  }
  return blocked
}

/**
 * Where to cut `line` (cut = length of the first piece, 1..limit). Prefers
 * the end of a sentence, then a clause, then whitespace, then a change of
 * character class (never inside an ASCII identifier run or a CJK run). Never
 * inside a "label : value" span, nor at whitespace inside a digit group
 * ("6222 0200 1234 5671"). Searches the second half of the window first so
 * chunks stay large. `safe: false` only when no such place exists at all; the
 * forced cut then still avoids label spans where it can.
 */
function findCut(line, limit) {
  const before = (i) => line[i - 1]
  const splitsPair = (i) => {
    const prev = line.charCodeAt(i - 1)
    const next = line.charCodeAt(i)
    return prev >= 0xD800 && prev <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF
  }
  const spans = labelSpans(line.slice(0, limit + LABEL_CHARS + VALUE_CHARS + 8))
  // "138 0013 8000": whitespace between digits is part of a number, whichever
  // side of it the cut falls on.
  const inNumber = (i) => (SPACE.test(before(i)) && isDigit(line[i - 2]) && isDigit(line[i]))
    || (SPACE.test(line[i] ?? '') && isDigit(before(i)) && isDigit(line[i + 1]))
  const allowed = (i) => spans[i] === 0 && !splitsPair(i) && !inNumber(i)
  const tiers = [
    (i) => SENTENCE_END.has(before(i)),
    (i) => CLAUSE_END.has(before(i)),
    (i) => /\s/.test(before(i)),
    (i) => {
      if (LABEL_END.has(before(i))) return false
      const a = charClass(line.charCodeAt(i - 1))
      const b = charClass(line.charCodeAt(i))
      return a !== b || (a === 'o' && b === 'o')
    },
  ]
  const half = Math.max(1, Math.floor(limit / 2))
  for (const [from, to] of [[half, limit], [1, half - 1]]) {
    for (const test of tiers) {
      for (let i = to; i >= from; i -= 1) if (allowed(i) && test(i)) return { cut: i, safe: true }
    }
  }
  for (let i = limit; i >= half; i -= 1) if (allowed(i)) return { cut: i, safe: false }
  return { cut: splitsPair(limit) ? limit - 1 : limit, safe: false }
}

function chunkText(text) {
  const chunks = []
  const forced = []
  let current = ''
  let currentStart = 0
  const push = (piece, start) => chunks.push({ id: `t${chunks.length}`, text: piece, start })
  const flush = () => {
    if (current.length > 0) push(current, currentStart)
    current = ''
  }
  let cursor = 0
  while (cursor < text.length) {
    const newline = text.indexOf('\n', cursor)
    const end = newline === -1 ? text.length : newline + 1
    let lineStart = cursor
    let line = text.slice(cursor, end)
    while (line.length > CHUNK_CHARS) {
      flush()
      const { cut, safe } = findCut(line, CHUNK_CHARS)
      if (!safe) forced.push(lineStart + cut)
      push(line.slice(0, cut), lineStart)
      line = line.slice(cut)
      lineStart += cut
    }
    if (current.length + line.length > CHUNK_CHARS && current.length > 0) flush()
    if (current.length === 0) currentStart = lineStart
    current += line
    cursor = end
  }
  flush()
  if (chunks.length === 0) push('', 0)
  return { chunks, forced }
}

function createTextDocument(raw, relPath, options = {}) {
  const bom = raw.charCodeAt(0) === 0xFEFF
  const body = bom ? raw.slice(1) : raw
  const { chunks, forced } = chunkText(body)
  const originalLineCount = (body.match(/\n/g) ?? []).length
  // Position only (line/column), never the text around the cut.
  const notices = forced.map((offset) => {
    const lineNo = (body.slice(0, offset).match(/\n/g) ?? []).length + 1
    const column = offset - (body.lastIndexOf('\n', offset - 1) + 1)
    return { severity: 'error', code: 'chunk-split', detail: `第 ${lineNo} 行超过 ${CHUNK_CHARS} 字且没有可安全切分的位置，已在第 ${column} 字处强制切分，切分处的标识符可能漏检，请人工核对` }
  })

  return {
    kind: 'text',
    relPath,
    bytes: options.bytes ?? Buffer.byteLength(raw, 'utf8'),
    notices,
    segments() {
      return chunks.map(({ id, text }) => ({ id, text }))
    },
    apply(replacements) {
      const byChunk = new Map()
      for (const replacement of replacements) {
        if (replacement.start >= replacement.end) continue
        if (!byChunk.has(replacement.id)) byChunk.set(replacement.id, [])
        byChunk.get(replacement.id).push(replacement)
      }
      let applied = 0
      for (const chunk of chunks) {
        const list = byChunk.get(chunk.id)
        if (!list) continue
        list.sort((a, b) => b.start - a.start)
        let text = chunk.text
        let cursorEnd = Infinity
        for (const replacement of list) {
          if (replacement.end > cursorEnd) continue
          const slice = text.slice(replacement.start, replacement.end)
          if (slice !== replacement.original) continue
          if (slice.includes('\n')) continue
          text = text.slice(0, replacement.start) + replacement.replacement + text.slice(replacement.end)
          cursorEnd = replacement.start
          applied += 1
        }
        chunk.text = text
      }
      return applied
    },
    serialize() {
      return (bom ? '\uFEFF' : '') + chunks.map((chunk) => chunk.text).join('')
    },
    structure() {
      const bodyOut = chunks.map((chunk) => chunk.text).join('')
      const outLines = (bodyOut.match(/\n/g) ?? []).length
      return {
        ok: outLines === originalLineCount,
        checks: [{
          name: '行数',
          ok: outLines === originalLineCount,
          detail: `原始 ${originalLineCount + 1} 行，输出 ${outLines + 1} 行`,
        }],
      }
    },
  }
}

/* ------------------------------------------------------------------- csv */

/**
 * Rows of a CSV text, with the line terminator that ended each row ("\r\n",
 * "\n", "\r", or "" for a last row without one), so the file is written
 * back with its own line endings. Blank lines at the end are not rows; their
 * terminators are kept in `trailer`.
 */
export function parseCsv(text) {
  const bom = text.charCodeAt(0) === 0xFEFF
  const rows = []
  const eols = []
  const blank = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = bom ? 1 : 0
  let rowStart = i
  const pushRow = (eol, end) => {
    row.push(field)
    rows.push(row)
    eols.push(eol)
    blank.push(end === rowStart)
    row = []
    field = ''
  }
  for (; i < text.length; i += 1) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') {
      // A "\r" right before was outside quotes too, and was skipped.
      if (text[i - 1] === '\r' && i - 1 >= rowStart) pushRow('\r\n', i - 1)
      else pushRow('\n', i)
      rowStart = i + 1
    } else if (ch === '\r') {
      if (text[i + 1] !== '\n') { pushRow('\r', i); rowStart = i + 1 }
    } else field += ch
  }
  if (rowStart < text.length) pushRow('', text.length)
  // Blank lines at the end are not rows (no phantom empty record).
  let trailer = ''
  while (rows.length > 0 && blank[rows.length - 1]) {
    rows.pop()
    blank.pop()
    trailer = eols.pop() + trailer
  }
  return { rows, eols, trailer, bom }
}

function csvCellNeedsQuote(value) {
  return /[",\r\n]/.test(value)
}

function createCsvDocument(raw, relPath, options = {}) {
  const parsed = parseCsv(raw)
  const { rows } = parsed
  // Converted from GB18030/UTF-16: written as UTF-8 with a BOM, so Excel on
  // Chinese Windows still opens it as Unicode.
  const bom = parsed.bom || Boolean(options.converted)
  const header = rows[0] ? [...rows[0]] : []
  const width = header.length
  const hints = header.map((value) => hintForHeader(value))
  const quasiHints = header.map((value) => quasiHintForHeader(value))
  const snapshot = rows.map((row) => [...row])
  const changed = new Set()
  const { eols, trailer } = parsed

  const cellId = (r, c) => `r${r}c${c}`
  return {
    kind: 'csv',
    relPath,
    bytes: options.bytes ?? Buffer.byteLength(raw, 'utf8'),
    rowCount: rows.length,
    colCount: width,
    segments() {
      const result = []
      // Row 0 is scanned too: a CSV without a header row has its first
      // record there, and a real header can hold a title or an identifier.
      // Header cells get no column hint and a positional field name (the
      // header text itself may be the identifier).
      for (let r = 0; r < rows.length; r += 1) {
        for (let c = 0; c < rows[r].length; c += 1) {
          const value = rows[r][c]
          if (typeof value !== 'string' || value.length === 0) continue
          if (r === 0) result.push({ id: cellId(r, c), text: value, hint: null, quasi: null, field: `第${c + 1}列表头` })
          else result.push({ id: cellId(r, c), text: value, hint: hints[c] ?? null, quasi: quasiHints[c] ?? null, field: header[c] ?? `第${c + 1}列` })
        }
      }
      return result
    },
    apply(replacements) {
      let applied = 0
      for (const replacement of replacements) {
        const match = /^r(\d+)c(\d+)$/.exec(replacement.id)
        if (!match) continue
        const r = Number(match[1])
        const c = Number(match[2])
        const cell = rows[r]?.[c]
        if (typeof cell !== 'string') continue
        const slice = cell.slice(replacement.start, replacement.end)
        if (slice !== replacement.original) continue
        if (replacement.replacement.includes('\n')) continue
        rows[r][c] = cell.slice(0, replacement.start) + replacement.replacement + cell.slice(replacement.end)
        changed.add(`${r}:${c}`)
        applied += 1
      }
      return applied
    },
    serialize() {
      const body = rows.map((row, r) => row.map((cell) => {
        const value = cell ?? ''
        return csvCellNeedsQuote(value) ? `"${value.replace(/"/g, '""')}"` : value
      }).join(',') + eols[r]).join('')
      // Each row keeps its own line ending (CRLF, LF or CR), and the file
      // its trailing newline state.
      return (bom ? '\uFEFF' : '') + body + trailer
    },
    structure() {
      const checks = []
      const dimsOk = rows.length === snapshot.length
        && rows.every((row, index) => row.length === snapshot[index].length)
      checks.push({
        name: '行列数',
        ok: dimsOk,
        detail: `${snapshot.length} 行 × ${width} 列 → ${rows.length} 行`,
      })
      // A header cell may change only where an identifier in it was replaced.
      const headerReplaced = (rows[0] ?? []).filter((value, index) => value !== header[index] && changed.has(`0:${index}`)).length
      const headerOk = (rows[0] ?? []).every((value, index) => value === header[index] || changed.has(`0:${index}`))
      checks.push({ name: '表头', ok: headerOk, detail: !headerOk ? '表头发生变化' : headerReplaced > 0 ? `仅替换了 ${headerReplaced} 个表头单元格中的标识符` : '未改动' })
      const untouched = rows.every((row, r) => row.every((value, c) =>
        changed.has(`${r}:${c}`) || value === snapshot[r][c]))
      checks.push({ name: '非命中单元格', ok: untouched, detail: untouched ? '保持原值' : '出现越界修改' })
      return { ok: checks.every((check) => check.ok), checks }
    },
  }
}

/* ------------------------------------------------------------------ json */

// Integers of six or more digits can be phone numbers, record numbers or ID
// numbers stored as JSON numbers. They are exposed to detection with their
// source digits; ages, doses and counts stay out of it. Under a key that
// names an identifier (住院号, mrn) an integer of any length is exposed.
export const NUMERIC_ID_DIGITS = 6
const JSON_NUMBER_PARTS = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/

/**
 * Exact decimal digits of a non-negative integral JSON number literal, from
 * its source text: "13800138000.0" (pandas writes int columns with a NaN as
 * floats) → "13800138000", "1.1010519500101002e17" → "110105195001010020".
 * Null for negative, fractional or absurdly large literals.
 */
export function jsonIntegerDigits(source) {
  const match = JSON_NUMBER_PARTS.exec(source)
  if (!match || match[1] === '-') return null
  const fraction = match[3] ?? ''
  let digits = match[2] + fraction
  const exponent = Number(match[4] ?? 0) - fraction.length
  if (exponent > 40) return null
  if (exponent >= 0) digits += '0'.repeat(exponent)
  else {
    if (!/^0*$/.test(digits.slice(exponent))) return null
    digits = digits.slice(0, exponent)
  }
  return digits.replace(/^0+(?=\d)/, '') || '0'
}

const JSON_MAX_DEPTH = 2000

/**
 * Object keys, strings and numbers of a JSON text with their source offsets,
 * in document order. Every token has its path (a key's path is the member it
 * names); a key also has the object it belongs to (`owner`). Callers parse
 * the text with JSON.parse first; this only locates. Writing back splices
 * the changed tokens into the original text (spliceJson), so whitespace,
 * number spelling ("1.50", 1e5, integers above 2^53), escapes, key order
 * and duplicate keys all stay as they were.
 */
export function scanJsonTokens(text) {
  const tokens = []
  const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  const LITERAL = /true|false|null/y
  let i = 0
  let objects = 0
  const fail = () => { throw new Error('JSON 解析失败：无法定位其中的值') }
  const space = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i += 1
  }
  const string = () => {
    if (text[i] !== '"') fail()
    const start = i
    i += 1
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
    if (i >= text.length) fail()
    i += 1
    return { start, end: i, raw: text.slice(start, i) }
  }
  const value = (path, depth) => {
    if (depth > JSON_MAX_DEPTH) fail()
    space()
    const ch = text[i]
    if (ch === '{' || ch === '[') {
      const object = ch === '{'
      const close = object ? '}' : ']'
      const owner = object ? objects++ : null
      i += 1
      space()
      if (text[i] === close) { i += 1; return }
      for (let index = 0; ; index += 1) {
        if (object) {
          space()
          const token = string()
          const key = JSON.parse(token.raw)
          tokens.push({ kind: 'key', path: [...path, key], owner, value: key, ...token })
          space()
          if (text[i] !== ':') fail()
          i += 1
          value([...path, key], depth + 1)
        } else value([...path, index], depth + 1)
        space()
        const sep = text[i]
        i += 1
        if (sep === ',') continue
        if (sep === close) return
        fail()
      }
    }
    if (ch === '"') {
      const token = string()
      tokens.push({ kind: 'string', path, value: JSON.parse(token.raw), ...token })
      return
    }
    NUMBER.lastIndex = i
    const number = NUMBER.exec(text)
    if (number) {
      tokens.push({ kind: 'number', path, start: i, end: NUMBER.lastIndex, raw: number[0] })
      i = NUMBER.lastIndex
      return
    }
    LITERAL.lastIndex = i
    if (!LITERAL.exec(text)) fail()
    i = LITERAL.lastIndex
  }
  value([], 0)
  space()
  if (i !== text.length) fail()
  return tokens
}

// A file written with every non-ASCII character escaped (Python's default
// json.dumps) keeps that style for the values written back.
const ESCAPED_NON_ASCII = /\\u(?:00[89a-fA-F][0-9a-fA-F]|0[1-9a-fA-F][0-9a-fA-F]{2}|[1-9a-fA-F][0-9a-fA-F]{3})/

export function jsonAsciiOnly(text) {
  return !/[^\x00-\x7f]/.test(text) && ESCAPED_NON_ASCII.test(text)
}

function encodeJsonString(value, asciiOnly) {
  const out = JSON.stringify(value)
  return asciiOnly ? out.replace(/[\u0080-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`) : out
}

/**
 * JSON text with changed tokens spliced in; everything else is the original
 * text byte for byte. `edits` maps token index → new text; a changed number
 * becomes a string. A renamed key that collides with another key of its
 * object gets a "#2" suffix, so no member is lost. Returns the text and the
 * final name of every renamed key (token index → name).
 */
export function spliceJson(text, tokens, edits, asciiOnly = jsonAsciiOnly(text)) {
  const keys = new Map()
  if (edits.size === 0) return { text, keys }
  const order = [...edits.keys()].sort((a, b) => a - b)
  const owners = new Set(order.filter((index) => tokens[index].kind === 'key').map((index) => tokens[index].owner))
  if (owners.size > 0) {
    const taken = new Map([...owners].map((owner) => [owner, new Set()]))
    tokens.forEach((token, index) => {
      if (token.kind === 'key' && owners.has(token.owner) && !edits.has(index)) taken.get(token.owner).add(token.value)
    })
    for (const index of order) {
      const token = tokens[index]
      if (token.kind !== 'key') continue
      const names = taken.get(token.owner)
      const wanted = edits.get(index)
      let name = wanted
      for (let n = 2; names.has(name); n += 1) name = `${wanted}#${n}`
      names.add(name)
      keys.set(index, name)
    }
  }
  let out = ''
  let cursor = 0
  for (const index of order) {
    const token = tokens[index]
    out += text.slice(cursor, token.start) + encodeJsonString(token.kind === 'key' ? keys.get(index) : edits.get(index), asciiOnly)
    cursor = token.end
  }
  return { text: out + text.slice(cursor), keys }
}

// Keys that read like program identifiers (patient_name, ITM_VLU, dx-code)
// or short numbers ("0", "2023") hold no identifier and are not scanned.
// Every other key (Chinese text, a long number, an e-mail, a name with a
// space) can be one: exports keyed by patient, ID or phone are common.
const PLAIN_JSON_KEY = /^[A-Za-z_$][\w$.-]*$/

export function jsonKeyExposed(key) {
  if (typeof key !== 'string' || key === '') return false
  if (/^\d{1,5}$/.test(key)) return false
  return !(PLAIN_JSON_KEY.test(key) && !/\d{6,}/.test(key))
}

function getAt(value, path) {
  let cursor = value
  for (const key of path) cursor = cursor?.[key]
  return cursor
}

/** Nearest object key of a JSON leaf ("ADMN_DPT_CD" for [3, "ADMN_DPT_CD"]). */
function fieldOfPath(path) {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    if (typeof path[i] === 'string') return path[i]
  }
  return '(数组元素)'
}

/** Field label of an object key: "patients·键名" for a key inside "patients". */
export function jsonKeyField(path) {
  const owner = path.slice(0, -1)
  return owner.some((part) => typeof part === 'string') ? `${fieldOfPath(owner)}·键名` : '键名'
}

/** Detection metadata of a JSON value from its key and its object. */
export function jsonLeafMeta(root, path) {
  if (path.length === 0) return { own: null, sibling: null, field: fieldOfPath(path), quasi: null }
  const key = path[path.length - 1]
  const parent = getAt(root, path.slice(0, -1))
  const own = hintForJsonKey(parent, key)
  const sibling = own ? null : hintForSibling(parent, key)
  return { own, sibling, field: fieldOfPath(path), quasi: quasiHintForHeader(key) }
}

/* ------------------------------------------------- compact JSON index */

// A JSON document is held as an index into its text, not as objects: a
// wide export (5 844 orders × 67 columns) was 305 MB of heap per 7.8 MB file
// with one object, one path array, one id string and one meta object per
// token. Here a token costs a few typed-array slots, a key name is shared
// by every row, and ids, originals and paths are derived when asked for.
const TOKEN_KEY = 0
const TOKEN_STRING = 1
const TOKEN_NUMBER = 2

/** Growable typed array. */
class IntList {
  constructor(Type = Int32Array) {
    this.Type = Type
    this.items = new Type(1024)
    this.length = 0
  }

  push(value) {
    if (this.length === this.items.length) {
      const grown = new this.Type(this.items.length * 2)
      grown.set(this.items)
      this.items = grown
    }
    this.items[this.length] = value
    this.length += 1
    return this.length - 1
  }

  done() {
    return this.items.slice(0, this.length)
  }
}

/**
 * Index of a JSON text: the same tokens, in the same order, as
 * scanJsonTokens, held in typed arrays. Per token: kind, source range, the
 * container it sits in (-1 for a document that is a single value) and its
 * label (a key's name; a value's key or array index). Per container: parent,
 * label, object or array, and the nearest key name on its path (field).
 * `visit(token, kind, container, label, holder, start, end, field)` sees each
 * token as it is found: `holder` is the parsed container (when `parsed` is
 * given), `field` the nearest key name on the container's path.
 */
function indexJsonText(text, parsed = undefined, visit = null) {
  const kinds = new IntList(Uint8Array)
  const starts = new IntList()
  const ends = new IntList()
  const containers = new IntList()
  const labels = []
  const nodeParent = new IntList()
  const nodeObject = new IntList(Uint8Array)
  // Tokens of a container (its own and its descendants'): [first, end).
  const nodeFirst = new IntList()
  const nodeEnd = new IntList()
  const nodeLabel = []
  const nodeField = []
  const objectKeys = []
  const names = new Map()
  let duplicates = false
  const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  const LITERAL = /true|false|null/y
  let i = 0
  const fail = () => { throw new Error('JSON 解析失败：无法定位其中的值') }
  const space = () => {
    while (i < text.length) {
      const ch = text.charCodeAt(i)
      if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break
      i += 1
    }
  }
  const string = () => {
    if (text.charCodeAt(i) !== 34) fail()
    const start = i
    i += 1
    while (i < text.length) {
      const ch = text.charCodeAt(i)
      if (ch === 34) break
      i += ch === 92 ? 2 : 1
    }
    if (i >= text.length) fail()
    i += 1
    return start
  }
  const token = (kind, start, end, container, label) => {
    kinds.push(kind)
    starts.push(start)
    ends.push(end)
    containers.push(container)
    labels.push(label)
    return labels.length - 1
  }
  const value = (container, label, holder, self, depth) => {
    if (depth > JSON_MAX_DEPTH) fail()
    space()
    const ch = text[i]
    if (ch === '{' || ch === '[') {
      const object = ch === '{'
      const close = object ? '}' : ']'
      const node = nodeParent.push(container)
      nodeObject.push(object ? 1 : 0)
      nodeFirst.push(labels.length)
      nodeEnd.push(labels.length)
      nodeLabel.push(label)
      nodeField.push(typeof label === 'string' ? label : container >= 0 ? nodeField[container] : null)
      // Distinct key names per object, in the order objects open (renaming may never merge two members).
      const slot = object ? objectKeys.push(0) - 1 : -1
      const seen = object ? new Set() : null
      i += 1
      space()
      if (text[i] === close) { i += 1; return }
      for (let index = 0; ; index += 1) {
        if (object) {
          space()
          const start = string()
          const raw = text.slice(start, i)
          let key = names.get(raw)
          if (key === undefined) {
            key = JSON.parse(raw)
            names.set(raw, key)
          }
          if (seen.has(key)) duplicates = true
          else seen.add(key)
          const at = token(TOKEN_KEY, start, i, node, key)
          visit?.(at, TOKEN_KEY, node, key, self, start, i, nodeField[node])
          space()
          if (text[i] !== ':') fail()
          i += 1
          value(node, key, self, self?.[key], depth + 1)
        } else value(node, index, self, self?.[index], depth + 1)
        space()
        const sep = text[i]
        i += 1
        if (sep === ',') continue
        if (sep === close) break
        fail()
      }
      nodeEnd.items[node] = labels.length
      if (object) objectKeys[slot] = seen.size
      return
    }
    if (ch === '"') {
      const start = string()
      const at = token(TOKEN_STRING, start, i, container, label)
      visit?.(at, TOKEN_STRING, container, label, holder, start, i, container >= 0 ? nodeField[container] : null)
      return
    }
    NUMBER.lastIndex = i
    const number = NUMBER.exec(text)
    if (number) {
      const start = i
      const at = token(TOKEN_NUMBER, start, NUMBER.lastIndex, container, label)
      i = NUMBER.lastIndex
      visit?.(at, TOKEN_NUMBER, container, label, holder, start, i, container >= 0 ? nodeField[container] : null)
      return
    }
    LITERAL.lastIndex = i
    if (!LITERAL.exec(text)) fail()
    i = LITERAL.lastIndex
  }
  value(-1, undefined, undefined, parsed, 0)
  space()
  if (i !== text.length) fail()
  return {
    count: labels.length,
    kinds: kinds.done(),
    starts: starts.done(),
    ends: ends.done(),
    containers: containers.done(),
    labels,
    nodeParent: nodeParent.done(),
    nodeObject: nodeObject.done(),
    nodeFirst: nodeFirst.done(),
    nodeEnd: nodeEnd.done(),
    nodeLabel,
    nodeField,
    keyCounts: objectKeys.filter((count) => count > 0),
    duplicates,
  }
}

const encodePart = (part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1')

// A string at least this long can be a slice that keeps its whole source
// text alive (V8 sliced strings): values that outlive the document (vault,
// batch dictionary, memo) must be copies.
const SLICE_MIN = 13
const detach = (value) => (typeof value === 'string' && value.length >= SLICE_MIN ? JSON.parse(JSON.stringify(value)) : value)

function createJsonDocument(raw, relPath) {
  const bom = raw.charCodeAt(0) === 0xFEFF
  const text = bom ? raw.slice(1) : raw
  const asciiOnly = jsonAsciiOnly(text)

  // One leaf per exposed token, with the index of its detection metadata
  // (shared: every row of a table has the same few).
  const leafToken = new IntList()
  const leafMeta = new IntList()
  const metas = []
  const index = (() => {
    const root = JSON.parse(text)
    const metaIds = new Map()
    const keyInfo = new Map()
    const infoOf = (key) => {
      let info = keyInfo.get(key)
      if (!info) {
        const name = String(key)
        info = {
          hint: hintForKey(key),
          bare: BARE_NAME_KEY.test(name),
          eav: EAV_VALUE_KEY.test(name),
          quasi: quasiHintForHeader(key),
          exposed: jsonKeyExposed(key),
        }
        keyInfo.set(key, info)
      }
      return info
    }
    const metaId = (own, sibling, field, quasi) => {
      const key = `${own}\u0001${sibling}\u0001${field}\u0001${quasi}`
      let id = metaIds.get(key)
      if (id === undefined) {
        id = metas.push({ own, sibling, field, quasi }) - 1
        metaIds.set(key, id)
      }
      return id
    }
    return indexJsonText(text, root, (token, kind, container, label, holder, start, end, owner) => {
      if (kind === TOKEN_KEY) {
        if (!infoOf(label).exposed) return
        leafToken.push(token)
        leafMeta.push(metaId(null, null, owner != null ? `${owner}·键名` : '键名', null))
        return
      }
      if (kind === TOKEN_NUMBER && jsonIntegerDigits(text.slice(start, end)) === null) return
      let meta
      if (container < 0) meta = metaId(null, null, fieldOfPath([]), null)
      else {
        const info = infoOf(label)
        // Same as jsonLeafMeta: the object's other keys matter only for a
        // bare "name" key and for entity-attribute-value records.
        const own = info.hint === '姓名' && info.bare ? hintForJsonKey(holder, label) : info.hint
        const sibling = own ? null : info.eav ? hintForSibling(holder, label) : null
        const field = typeof label === 'string' ? label : owner ?? fieldOfPath([])
        meta = metaId(own, sibling, field, info.quasi)
      }
      leafToken.push(token)
      leafMeta.push(meta)
    })
  })()
  const leaves = leafToken.done()
  const metaOf = leafMeta.done()
  const leafCount = leaves.length
  const { kinds, starts, ends, containers, labels } = index

  const rawOf = (token) => text.slice(starts[token], ends[token])
  /** A leaf's value as loaded (a copy, never a slice of the text). */
  const originalOf = (leaf) => {
    const token = leaves[leaf]
    const kind = kinds[token]
    if (kind === TOKEN_KEY) return labels[token]
    if (kind === TOKEN_NUMBER) return detach(jsonIntegerDigits(rawOf(token)))
    return JSON.parse(rawOf(token))
  }
  // Leaves changed since loading: leaf → current text.
  const changed = new Map()
  const textOfLeaf = (leaf) => changed.get(leaf) ?? originalOf(leaf)

  // Ids: the encoded path; a key's ends in "~k"; a later duplicate (same
  // path) gets "~d2", "~d3". Without duplicate keys every path is unique and
  // ids are built when asked for; otherwise they are all built once.
  const prefixes = new Array(index.nodeParent.length)
  const prefixOf = (node) => {
    let prefix = prefixes[node]
    if (prefix === undefined) {
      const parent = index.nodeParent[node]
      prefix = parent < 0 ? null : (prefixOf(parent) === null ? '' : `${prefixOf(parent)}/`) + encodePart(index.nodeLabel[node])
      prefixes[node] = prefix
    }
    return prefix
  }
  const plainId = (token) => {
    const container = containers[token]
    if (container < 0) return ''
    const prefix = prefixOf(container)
    return (prefix === null ? '' : `${prefix}/`) + encodePart(labels[token]) + (kinds[token] === TOKEN_KEY ? '~k' : '')
  }
  let fixedIds = null
  if (index.duplicates) {
    fixedIds = new Array(leafCount)
    const seen = new Map()
    let leaf = 0
    for (let token = 0; token < index.count; token += 1) {
      let id = plainId(token)
      const count = (seen.get(id) ?? 0) + 1
      seen.set(id, count)
      if (count > 1) id += `~d${count}`
      if (leaf < leafCount && leaves[leaf] === token) fixedIds[leaf++] = id
    }
  }
  const idOf = (leaf) => (fixedIds ? fixedIds[leaf] : plainId(leaves[leaf]))
  /** Leaf of a token (leaves are in token order), or undefined. */
  const leafOfToken = (token) => {
    let low = 0
    let high = leafCount - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      if (leaves[mid] === token) return mid
      if (leaves[mid] < token) low = mid + 1
      else high = mid - 1
    }
    return undefined
  }
  // id → leaf. With duplicate keys: a map of every id, built on the first
  // write-back. Otherwise the id is read as a path: its container by prefix
  // (one entry per container), then the member among that container's tokens.
  let byId = null
  let nodeByPrefix = null
  const decodePart = (part) => part.replace(/~1/g, '/').replace(/~0/g, '~')
  const leafOf = (id) => {
    if (typeof id !== 'string') return undefined
    if (fixedIds) {
      if (!byId) {
        byId = new Map()
        for (let leaf = 0; leaf < leafCount; leaf += 1) byId.set(idOf(leaf), leaf)
      }
      return byId.get(id)
    }
    if (id === '') {
      // A document that is a single value.
      return index.count === 1 && containers[0] < 0 ? leafOfToken(0) : undefined
    }
    const key = id.endsWith('~k')
    const path = key ? id.slice(0, -2) : id
    const slash = path.lastIndexOf('/')
    const prefix = slash < 0 ? null : path.slice(0, slash)
    let node
    if (prefix === null) node = index.nodeParent.length > 0 && index.nodeParent[0] < 0 ? 0 : -1
    else {
      if (!nodeByPrefix) {
        nodeByPrefix = new Map()
        for (let at = 0; at < index.nodeParent.length; at += 1) {
          const own = prefixOf(at)
          if (own !== null) nodeByPrefix.set(own, at)
        }
      }
      node = nodeByPrefix.get(prefix) ?? -1
    }
    if (node < 0) return undefined
    const label = decodePart(path.slice(slash + 1))
    const kind = key ? TOKEN_KEY : null
    for (let token = index.nodeFirst[node]; token < index.nodeEnd[node]; token += 1) {
      if (containers[token] !== node || String(labels[token]) !== label) continue
      if (kind === TOKEN_KEY ? kinds[token] !== TOKEN_KEY : kinds[token] === TOKEN_KEY) continue
      // The member's value may be a container: then it has no token here.
      const leaf = leafOfToken(token)
      if (leaf !== undefined && idOf(leaf) === id) return leaf
      if (kind === TOKEN_KEY) return undefined
    }
    return undefined
  }

  /** The segment of a leaf, or null when it is not listed. */
  const segmentOf = (leaf) => {
    const current = textOfLeaf(leaf)
    if (current.length === 0) return null
    const { own, sibling, field, quasi } = metas[metaOf[leaf]]
    const number = kinds[leaves[leaf]] === TOKEN_NUMBER
    // Short integers (ages, counts) only under an identifier key.
    if (number && current.length < NUMERIC_ID_DIGITS && !own && !sibling && (!changed.has(leaf) || current === originalOf(leaf))) return null
    return {
      id: idOf(leaf),
      text: current,
      hint: own ?? sibling,
      // A sibling label ("联系电话") often heads free text mixing several
      // items; a value that does not fit is normal, not a finding.
      hintFrom: sibling ? 'sibling' : undefined,
      // Quasi-identifier handling covers text values only.
      quasi: number ? null : quasi,
      field,
    }
  }

  /** token → new text, for the leaves whose text differs from the source. */
  const edits = () => {
    const out = new Map()
    for (const [leaf, current] of changed) {
      if (current !== originalOf(leaf)) out.set(leaves[leaf], current)
    }
    return new Map([...out].sort((a, b) => a[0] - b[0]))
  }

  /** spliceJson over the index: same output, same key renaming. */
  const splice = (changes) => {
    const keys = new Map()
    if (changes.size === 0) return { text, keys }
    const order = [...changes.keys()]
    const owners = new Set(order.filter((token) => kinds[token] === TOKEN_KEY).map((token) => containers[token]))
    if (owners.size > 0) {
      const taken = new Map([...owners].map((owner) => [owner, new Set()]))
      for (let token = 0; token < index.count; token += 1) {
        if (kinds[token] === TOKEN_KEY && owners.has(containers[token]) && !changes.has(token)) taken.get(containers[token]).add(labels[token])
      }
      for (const token of order) {
        if (kinds[token] !== TOKEN_KEY) continue
        const names = taken.get(containers[token])
        const wanted = changes.get(token)
        let name = wanted
        for (let n = 2; names.has(name); n += 1) name = `${wanted}#${n}`
        names.add(name)
        keys.set(token, name)
      }
    }
    const parts = []
    let cursor = 0
    for (const token of order) {
      parts.push(text.slice(cursor, starts[token]), encodeJsonString(kinds[token] === TOKEN_KEY ? keys.get(token) : changes.get(token), asciiOnly))
      cursor = ends[token]
    }
    parts.push(text.slice(cursor))
    return { text: parts.join(''), keys }
  }

  const sameRange = (a, aStart, aEnd, b, bStart, bEnd) => {
    if (aEnd - aStart !== bEnd - bStart) return false
    for (let k = 0; k < aEnd - aStart; k += 1) if (a.charCodeAt(aStart + k) !== b.charCodeAt(bStart + k)) return false
    return true
  }

  return {
    kind: 'json',
    relPath,
    bytes: Buffer.byteLength(raw, 'utf8'),
    segments() {
      const out = []
      for (let leaf = 0; leaf < leafCount; leaf += 1) {
        const segment = segmentOf(leaf)
        if (segment) out.push(segment)
      }
      return out
    },
    /** Current text of one listed segment (undefined when not listed). */
    textOf(id) {
      const leaf = leafOf(id)
      return leaf === undefined ? undefined : segmentOf(leaf)?.text
    },
    apply(replacements) {
      let applied = 0
      for (const replacement of replacements) {
        const leaf = leafOf(replacement.id)
        // A document that is a single value has no place to write back into.
        if (leaf === undefined || containers[leaves[leaf]] < 0) continue
        const current = textOfLeaf(leaf)
        if (current.slice(replacement.start, replacement.end) !== replacement.original) continue
        // A replaced number is written back as a string pseudonym.
        changed.set(leaf, current.slice(0, replacement.start) + replacement.replacement + current.slice(replacement.end))
        applied += 1
      }
      return applied
    },
    serialize() {
      return (bom ? '\uFEFF' : '') + splice(edits()).text
    },
    /**
     * [key as loaded, key as written] for every renamed key. Field labels
     * are built from keys ("张三" for the value under it, "张三·键名" for
     * keys inside it), so reports never repeat the original key.
     */
    renamedFields() {
      const out = []
      for (const [token, name] of splice(edits()).keys) {
        if (labels[token] !== name) out.push([labels[token], name])
      }
      return out
    },
    structure() {
      const changes = edits()
      const { text: out, keys } = splice(changes)
      let ok = true
      try {
        JSON.parse(out)
        const again = indexJsonText(out)
        ok = again.count === index.count
        let before = 0
        let after = 0
        for (let t = 0; ok && t < index.count; t += 1) {
          const edited = changes.has(t)
          // The text between values never moves; an untouched value keeps its source.
          ok = sameRange(text, before, starts[t], out, after, again.starts[t])
            && (kinds[t] === again.kinds[t] || (edited && kinds[t] === TOKEN_NUMBER && again.kinds[t] === TOKEN_STRING))
            && (edited || sameRange(text, starts[t], ends[t], out, again.starts[t], again.ends[t]))
          before = ends[t]
          after = again.ends[t]
        }
        ok = ok && sameRange(text, before, text.length, out, after, out.length)
          && again.keyCounts.length === index.keyCounts.length
          && again.keyCounts.every((count, at) => count === index.keyCounts[at])
      } catch {
        ok = false
      }
      const renamed = [...keys].filter(([token, name]) => name !== labels[token]).length
      return {
        ok,
        checks: [{
          name: 'JSON 结构',
          ok,
          detail: !ok ? '键集合或值类型发生变化' : renamed > 0 ? `仅替换了 ${renamed} 个键名中的标识符，其余键与类型未变` : '键与类型未变',
        }],
      }
    },
  }
}

/* ------------------------------------------------------------------ xlsx */

// Integer cells of six or more digits can be phone numbers, record numbers
// or ID numbers stored as numbers; they are exposed to detection. Ages, doses,
// counts and date serials stay out of it, except in a column whose header
// names an identifier.
const NUMERIC_CELL_MIN = 100000
const NUMERIC_CELL_MAX = 1e21 // String() switches to exponent notation here

function numericIdText(value, hinted = false) {
  return typeof value === 'number' && Number.isInteger(value) && value >= (hinted ? 0 : NUMERIC_CELL_MIN) && value < NUMERIC_CELL_MAX
    ? String(value)
    : null
}

// SheetJS reads comment authors, threaded comments, defined-name comments and
// custom properties without UTF-8 decoding ("张三" arrives as "å¼ ä¸"). Decode them, so
// detection sees the real text and the file is written back correctly.
const utf8Strict = new TextDecoder('utf-8', { fatal: true })
function fixMisdecoded(value) {
  if (typeof value !== 'string' || !/[\u0080-ÿ]/.test(value) || /[^\u0000-ÿ]/.test(value)) return value
  try {
    return utf8Strict.decode(Buffer.from(value, 'latin1'))
  } catch {
    return value
  }
}

/**
 * Formula text → tokens. String literals ("..."), quoted sheet names ('...')
 * and bracketed parts ([1], Table[[#This Row],[Col]]) are kept apart from the
 * rest, so literals can be rewritten and sheet references renamed.
 */
function formulaTokens(formula) {
  const tokens = []
  let other = ''
  const flush = () => {
    if (other) tokens.push({ kind: 'other', text: other })
    other = ''
  }
  let i = 0
  while (i < formula.length) {
    const ch = formula[i]
    if (ch === '"' || ch === "'") {
      let j = i + 1
      let value = ''
      let closed = false
      while (j < formula.length) {
        if (formula[j] === ch) {
          if (formula[j + 1] === ch) { value += ch; j += 2; continue }
          closed = true
          break
        }
        value += formula[j]
        j += 1
      }
      flush()
      tokens.push({ kind: ch === '"' ? 'string' : 'quoted', value, closed })
      i = j + 1
    } else if (ch === '[') {
      let depth = 0
      let j = i
      for (; j < formula.length; j += 1) {
        if (formula[j] === '[') depth += 1
        else if (formula[j] === ']' && --depth === 0) break
      }
      flush()
      tokens.push({ kind: 'bracket', text: formula.slice(i, j + 1) })
      i = j + 1
    } else {
      other += ch
      i += 1
    }
  }
  flush()
  return tokens
}

function formulaText(tokens) {
  return tokens.map((token) => {
    if (token.kind === 'string') return `"${token.value.replace(/"/g, '""')}${token.closed ? '"' : ''}`
    if (token.kind === 'quoted') return `'${token.value.replace(/'/g, "''")}${token.closed ? "'" : ''}`
    return token.text
  }).join('')
}

function quoteSheet(name) {
  return `'${name.replace(/'/g, "''")}'`
}

const UNQUOTED_SHEET_REF = /(^|[^\p{L}\p{N}_.])([\p{L}\p{N}_.]+(?::[\p{L}\p{N}_.]+)?)!/gu

/** Formula with references to sheet `from` pointed at sheet `to`. */
function renameSheetInFormula(formula, from, to) {
  if (typeof formula !== 'string' || !formula) return formula
  const same = (name) => name.toLowerCase() === from.toLowerCase()
  const tokens = formulaTokens(formula)
  let changed = false
  tokens.forEach((token, index) => {
    const next = tokens[index + 1]
    if (token.kind === 'quoted' && token.closed && next?.kind === 'other' && next.text.startsWith('!') && !token.value.startsWith('[')) {
      const parts = token.value.split(':')
      if (parts.some(same)) {
        token.value = parts.map((part) => (same(part) ? to : part)).join(':')
        changed = true
      }
    } else if (token.kind === 'other') {
      const external = tokens[index - 1]?.kind === 'bracket'
      token.text = token.text.replace(UNQUOTED_SHEET_REF, (match, lead, ref, offset) => {
        if (external && offset === 0 && lead === '') return match
        const parts = ref.split(':')
        if (!parts.some(same)) return match
        changed = true
        return `${lead}${quoteSheet(parts.map((part) => (same(part) ? to : part)).join(':'))}!`
      })
    }
  })
  return changed ? formulaText(tokens) : formula
}

// Numeric constants in formula text: six or more digits that are not part of a
// cell or row reference (A1048576, $1048576, 1:1048576) or a name.
const FORMULA_NUMBER = /(?<![\p{L}\p{N}_.$:])\d{6,}(?![\p{L}\p{N}_:])/gu
const FORMULA_WORD = /[\p{L}_\\][\p{L}\p{N}_.\\]*/gu

/**
 * The parts of a formula outside its string literals that can carry an
 * identifier: external workbook paths and file names, sheet names that are
 * not this workbook's, names (external or defined), bracketed parts and
 * numeric constants. References to this workbook's own sheets are left out;
 * renaming a sheet rewrites them. Null when there is nothing to check.
 */
function formulaRefText(formula, sheetNames) {
  if (typeof formula !== 'string' || !formula) return null
  const internal = new Set(sheetNames.map((name) => name.toLowerCase()))
  const isInternal = (ref) => ref.split(':').every((part) => internal.has(part.toLowerCase()))
  const pieces = []
  const tokens = formulaTokens(formula)
  tokens.forEach((token, index) => {
    const next = tokens[index + 1]
    if (token.kind === 'quoted') {
      const sheetRef = token.closed && next?.kind === 'other' && next.text.startsWith('!')
      if (!(sheetRef && !token.value.startsWith('[') && isInternal(token.value)) && token.value) pieces.push(token.value)
    } else if (token.kind === 'bracket') {
      const inner = token.text.slice(1, -1)
      if (!/^\d*$/.test(inner)) pieces.push(inner)
    } else if (token.kind === 'other') {
      const external = tokens[index - 1]?.kind === 'bracket'
      for (const match of token.text.matchAll(UNQUOTED_SHEET_REF)) {
        if ((external && match.index === 0 && match[1] === '') || !isInternal(match[2])) pieces.push(match[2])
      }
      for (const match of token.text.matchAll(FORMULA_NUMBER)) pieces.push(match[0])
      for (const match of token.text.matchAll(FORMULA_WORD)) {
        const after = token.text[match.index + match[0].length]
        if (/[^\x00-\x7F]/.test(match[0]) && after !== '(' && after !== '!') pieces.push(match[0])
      }
    }
  })
  const unique = [...new Set(pieces)]
  return unique.length > 0 ? unique.join('\n') : null
}

/** Internal hyperlink ("#'Sheet'!A1") pointed at a renamed sheet. */
function renameSheetInLink(target, from, to) {
  if (typeof target !== 'string' || !target.startsWith('#')) return target
  return `#${renameSheetInFormula(target.slice(1), from, to)}`
}

function validSheetName(name, others) {
  if (name.length === 0 || name.length > 31) return false
  if (/[\\/?*[\]:]/.test(name) || name.startsWith("'") || name.endsWith("'")) return false
  if (name.toLowerCase() === 'history') return false
  return !others.some((other) => other.toLowerCase() === name.toLowerCase())
}

// Document properties SheetJS fills in itself when writing.
const XLSX_COMPUTED_PROPS = new Set(['Application', 'AppVersion', 'DocSecurity', 'Worksheets', 'SheetNames', 'NamedRanges', 'DefinedNames', 'Chartsheets', 'ChartNames', 'HeadingPairs', 'TitlesOfParts'])
const XLSX_PROP_HINTS = { Author: '医生', LastAuthor: '医生', Manager: '医生', Company: '医院' }

/**
 * An xlsx workbook. Besides cell values, every text SheetJS reads and writes
 * back is a segment: sheet names, formula string literals, cell comments and
 * their authors, hyperlink targets and tooltips, defined names, document and
 * custom properties. Integer cells that can be identifiers are segments too;
 * a replacement turns such a cell into text.
 */
// Number formats (cellNF: a date cell stays a date, not a serial number),
// column widths, row heights and hidden rows (cellStyles) are read so they
// are written back. Dates stay serial numbers (cellDates: false), so their
// values never move.
const XLSX_READ = { type: 'buffer', cellNF: true, cellStyles: true, cellDates: false }

// Built-in number formats whose meaning depends on the locale; Chinese
// Excel writes them for 2023年3月15日, 3月15日, 2023年3月 and 14时30分 with
// no <numFmt> entry. SheetJS knows none of them: such a cell reads as
// "General" (or m/d/yy) and would be written back as a bare serial number.
// These are the zh-CN meanings (ECMA-376 Part 1, 18.8.30).
const XLSX_CJK_FORMATS = {
  27: 'yyyy"年"m"月"', 28: 'm"月"d"日"', 29: 'm"月"d"日"', 30: 'm-d-yy', 31: 'yyyy"年"m"月"d"日"',
  32: 'h"时"mm"分"', 33: 'h"时"mm"分"ss"秒"', 34: '上午/下午h"时"mm"分"', 35: '上午/下午h"时"mm"分"ss"秒"', 36: 'yyyy"年"m"月"',
  50: 'yyyy"年"m"月"', 51: 'm"月"d"日"', 52: 'yyyy"年"m"月"', 53: 'm"月"d"日"', 54: 'm"月"d"日"',
  55: '上午/下午h"时"mm"分"', 56: '上午/下午h"时"mm"分"ss"秒"', 57: 'yyyy"年"m"月"', 58: 'm"月"d"日"',
}

/**
 * Read an xlsx with every locale-dependent built-in format its cells use
 * spelled out, so each cell's format is known (cell.z) and written back.
 * Only the copy that is read is changed; anything unexpected reads as is.
 */
function readXlsx(buffer) {
  const plain = () => XLSX.read(buffer, XLSX_READ)
  let zip
  let entry
  try {
    zip = XLSX.CFB.read(buffer, { type: 'buffer' })
    entry = XLSX.CFB.find(zip, '/xl/styles.xml')
  } catch {
    return plain()
  }
  if (!entry?.content) return plain()
  const xml = Buffer.from(entry.content).toString('utf8')
  const cellXfs = xml.match(/<(?:\w+:)?cellXfs\b[\s\S]*?<\/(?:\w+:)?cellXfs>/)?.[0] ?? ''
  const idsOf = (text, tag) => new Set([...text.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*?\\snumFmtId\\s*=\\s*["'](\\d+)["']`, 'g'))].map((match) => Number(match[1])))
  const defined = idsOf(xml, 'numFmt')
  const missing = [...idsOf(cellXfs, 'xf')].filter((id) => id in XLSX_CJK_FORMATS && !defined.has(id))
  if (missing.length === 0) return plain()
  const prefix = xml.match(/<(\w+:)?styleSheet\b/)?.[1] ?? ''
  const added = missing.map((id) => `<${prefix}numFmt numFmtId="${id}" formatCode="${XLSX_CJK_FORMATS[id].replace(/"/g, '&quot;')}"/>`).join('')
  let patched
  if (/<(?:\w+:)?numFmts\b[^>]*\/>/.test(xml)) patched = xml.replace(/<((?:\w+:)?numFmts)\b[^>]*\/>/, (_, tag) => `<${tag}>${added}</${tag}>`)
  else if (/<\/(?:\w+:)?numFmts>/.test(xml)) patched = xml.replace(/<\/(?:\w+:)?numFmts>/, (close) => added + close)
  else patched = xml.replace(/<(?:\w+:)?styleSheet\b[^>]*>/, (open) => `${open}<${prefix}numFmts>${added}</${prefix}numFmts>`)
  if (patched === xml) return plain()
  try {
    entry.content = Buffer.from(patched, 'utf8')
    entry.size = entry.content.length
    return XLSX.read(XLSX.CFB.write(zip, { fileType: 'zip', type: 'buffer' }), XLSX_READ)
  } catch {
    return plain()
  }
}

function createXlsxDocument(buffer, relPath) {
  const workbook = readXlsx(buffer)
  const sheetNames = [...workbook.SheetNames]
  const slots = []
  const snapshot = []
  const changedCells = new Set()

  // Each slot: { id, field, hint, quasi, phase, get() → text|null, set(next) → bool }.
  // Phases order one apply(): formula literals and other parts first, then
  // cell values (which drop a formula they replace), sheet renames last.
  // Literal getters run on every segments() call; tokenize each formula once.
  // Literals are addressed by ordinal, not token position: renaming a sheet
  // can split a token in two.
  const tokenCache = new Map()
  const literalAt = (formula, ordinal) => {
    if (typeof formula !== 'string') return null
    let tokens = tokenCache.get(formula)
    if (!tokens) {
      tokens = formulaTokens(formula)
      tokenCache.set(formula, tokens)
    }
    const token = tokens.filter((item) => item.kind === 'string')[ordinal]
    return token && token.value.length > 0 ? token.value : null
  }
  // Reference text of a formula, per formula; depends on the sheet names.
  const refCache = new Map()
  const refTextOf = (formula) => {
    if (typeof formula !== 'string') return null
    if (!refCache.has(formula)) refCache.set(formula, formulaRefText(formula, workbook.SheetNames))
    return refCache.get(formula)
  }
  const setLiteral = (formula, ordinal, next) => {
    if (typeof formula !== 'string') return null
    const tokens = formulaTokens(formula)
    const token = tokens.filter((item) => item.kind === 'string')[ordinal]
    if (!token) return null
    token.value = next
    return formulaText(tokens)
  }

  const cellSlot = (sheetIndex, addr, cell, meta) => ({
    id: `x${sheetIndex}:${addr}`,
    phase: 1,
    ...meta,
    get() {
      if (typeof cell.v === 'string') return cell.v.length > 0 ? cell.v : null
      // In a column whose header names an identifier (住院号), any integer.
      return cell.t === 'd' ? null : numericIdText(cell.v, Boolean(meta.hint))
    },
    set(next) {
      cell.v = next
      cell.t = 's'
      delete cell.w
      delete cell.h
      delete cell.r
      // A formula would recompute the original value when the file is opened.
      delete cell.f
      delete cell.F
      changedCells.add(`${sheetIndex}:${addr}`)
      return true
    },
  })

  // Field labels ("Sheet!列名") are built from the sheet name and header text
  // as loaded, and stay the pipeline's stable keys. Either can itself be an
  // identifier that gets replaced; renamedFields() gives each label's current
  // form, so reports never repeat the original.
  const sheetObjects = workbook.SheetNames.map((name) => workbook.Sheets[name])
  const headerRows = []
  const labelSpecs = new Map() // label → { sheetIndex, col, part }
  const headerText = (sheetIndex, c) => {
    const cell = sheetObjects[sheetIndex]?.[XLSX.utils.encode_cell({ r: headerRows[sheetIndex] ?? 0, c })]
    return cell?.v !== undefined && cell?.v !== null && String(cell.v).trim() ? String(cell.v).trim() : XLSX.utils.encode_col(c)
  }
  const label = (sheetIndex, part, col = null) => {
    const text = `${workbook.SheetNames[sheetIndex]}!${part}`
    if (!labelSpecs.has(text)) labelSpecs.set(text, { sheetIndex, col, part })
    return text
  }

  workbook.SheetNames.forEach((name, sheetIndex) => {
    const sheet = workbook.Sheets[name]
    slots.push({
      id: `x${sheetIndex}:#name`,
      phase: 2,
      field: '工作表名称',
      hint: null,
      quasi: null,
      get: () => workbook.SheetNames[sheetIndex],
      set: (next) => renameSheet(sheetIndex, next),
    })
    if (!sheet) return
    const addrs = Object.keys(sheet)
      .filter((key) => key[0] !== '!')
      .map((addr) => ({ addr, ...XLSX.utils.decode_cell(addr) }))
      .sort((a, b) => a.r - b.r || a.c - b.c)
    const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } }
    const headerRow = range.s.r
    const hints = []
    const quasiHints = []
    const fields = []
    headerRows[sheetIndex] = headerRow
    const columnMeta = (c) => {
      if (!(c in fields)) {
        const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })]
        hints[c] = hintForHeader(cell?.v)
        quasiHints[c] = quasiHintForHeader(cell?.v)
        fields[c] = headerText(sheetIndex, c)
      }
    }
    for (const { addr, r, c } of addrs) {
      const cell = sheet[addr]
      if (!cell || typeof cell !== 'object') continue
      columnMeta(c)
      const header = r === headerRow
      const isString = cell.t === 's' || typeof cell.v === 'string'
      const numeric = !isString && numericIdText(cell.v) !== null
      slots.push(cellSlot(sheetIndex, addr, cell, {
        hint: header ? null : (hints[c] ?? null),
        // Quasi-identifier handling covers text values only.
        quasi: header || numeric ? null : (quasiHints[c] ?? null),
        field: header ? null : label(sheetIndex, fields[c], c),
      }))
      snapshot.push({ sheetIndex, addr, value: isString ? null : cell.v, format: cell.z ?? 'General' })

      if (typeof cell.f === 'string') {
        const count = formulaTokens(cell.f).filter((token) => token.kind === 'string').length
        for (let ordinal = 0; ordinal < count; ordinal += 1) {
          slots.push({
            id: `x${sheetIndex}:${addr}#f${ordinal}`,
            phase: 0,
            field: label(sheetIndex, '公式'),
            hint: null,
            quasi: null,
            get: () => literalAt(cell.f, ordinal),
            set(next) {
              const result = setLiteral(cell.f, ordinal, next)
              if (result === null) return false
              cell.f = result
              return true
            },
          })
        }
      }
      if (typeof cell.f === 'string') {
        // External paths, foreign sheet names and numeric constants cannot be
        // rewritten inside the formula; replacing any of them drops the
        // formula and keeps the cell's value. Pushed after the literals, so
        // literal replacements of the same apply() land first.
        slots.push({
          id: `x${sheetIndex}:${addr}#r`,
          phase: 0,
          field: label(sheetIndex, '公式'),
          hint: null,
          quasi: null,
          get: () => refTextOf(cell.f),
          set(next) {
            if (next === refTextOf(cell.f)) return true
            delete cell.f
            delete cell.F
            return true
          },
        })
      }
      if (Array.isArray(cell.c)) {
        cell.c.forEach((comment, index) => {
          comment.a = fixMisdecoded(comment.a)
          // Threaded comments (Excel 365's default) arrive mis-decoded too.
          if (comment.T) comment.t = fixMisdecoded(comment.t)
          slots.push({
            id: `x${sheetIndex}:${addr}#c${index}`,
            phase: 0,
            field: label(sheetIndex, '批注'),
            hint: null,
            quasi: null,
            get: () => (typeof comment.t === 'string' && comment.t.length > 0 ? comment.t : null),
            set(next) {
              comment.t = next
              delete comment.r
              delete comment.h
              return true
            },
          })
          slots.push({
            id: `x${sheetIndex}:${addr}#a${index}`,
            phase: 0,
            field: label(sheetIndex, '批注作者'),
            hint: '医生',
            quasi: null,
            get: () => (typeof comment.a === 'string' && comment.a.length > 0 ? comment.a : null),
            set(next) {
              comment.a = next
              return true
            },
          })
        })
      }
      if (cell.l && typeof cell.l === 'object') {
        const link = cell.l
        slots.push({
          id: `x${sheetIndex}:${addr}#l`,
          phase: 0,
          field: label(sheetIndex, '超链接'),
          hint: null,
          quasi: null,
          get: () => (typeof link.Target === 'string' && link.Target.length > 0 ? link.Target : null),
          set(next) {
            link.Target = next
            if (link.Rel && typeof link.Rel === 'object') link.Rel.Target = next
            return true
          },
        })
        slots.push({
          id: `x${sheetIndex}:${addr}#t`,
          phase: 0,
          field: label(sheetIndex, '超链接提示'),
          hint: null,
          quasi: null,
          get: () => (typeof link.Tooltip === 'string' && link.Tooltip.length > 0 ? link.Tooltip : null),
          set(next) {
            link.Tooltip = next
            return true
          },
        })
      }
    }
  })

  const names = Array.isArray(workbook.Workbook?.Names) ? workbook.Workbook.Names : []
  names.forEach((entry, nameIndex) => {
    entry.Comment = fixMisdecoded(entry.Comment)
    // A defined name is an identifier formulas refer to; a pseudonym is not a
    // valid name, so it is exposed but never rewritten (it stays for review).
    slots.push({
      id: `xn${nameIndex}:name`,
      phase: 0,
      field: '定义名称',
      hint: null,
      quasi: null,
      get: () => (typeof entry.Name === 'string' && entry.Name.length > 0 ? entry.Name : null),
      set: () => false,
    })
    slots.push({
      id: `xn${nameIndex}:comment`,
      phase: 0,
      field: '定义名称说明',
      hint: null,
      quasi: null,
      get: () => (typeof entry.Comment === 'string' && entry.Comment.length > 0 ? entry.Comment : null),
      set(next) {
        entry.Comment = next
        return true
      },
    })
    // Reference text of a defined name (an external workbook path, say) is
    // exposed but never rewritten: a name cannot drop its formula.
    slots.push({
      id: `xn${nameIndex}:ref`,
      phase: 0,
      field: '定义名称',
      hint: null,
      quasi: null,
      get: () => refTextOf(entry.Ref),
      set: () => false,
    })
    if (typeof entry.Ref !== 'string') return
    const count = formulaTokens(entry.Ref).filter((token) => token.kind === 'string').length
    for (let ordinal = 0; ordinal < count; ordinal += 1) {
      slots.push({
        id: `xn${nameIndex}:f${ordinal}`,
        phase: 0,
        field: '定义名称',
        hint: null,
        quasi: null,
        get: () => literalAt(entry.Ref, ordinal),
        set(next) {
          const result = setLiteral(entry.Ref, ordinal, next)
          if (result === null) return false
          entry.Ref = result
          return true
        },
      })
    }
  })

  const props = workbook.Props && typeof workbook.Props === 'object' ? workbook.Props : null
  for (const key of Object.keys(props ?? {})) {
    if (XLSX_COMPUTED_PROPS.has(key)) continue
    const initial = props[key]
    if (typeof initial !== 'string' && numericIdText(initial) === null) continue
    slots.push({
      id: `xp:${key}`,
      phase: 0,
      field: `文档属性!${key}`,
      hint: XLSX_PROP_HINTS[key] ?? null,
      quasi: null,
      get() {
        const value = props[key]
        if (typeof value === 'string') return value.length > 0 ? value : null
        return numericIdText(value)
      },
      set(next) {
        props[key] = next
        return true
      },
    })
  }

  // Custom properties: names and values. Rebuilt into workbook.Custprops on write.
  const custom = workbook.Custprops && typeof workbook.Custprops === 'object' && workbook.Custprops !== workbook.Props
    ? Object.entries(workbook.Custprops).map(([key, value]) => ({ key: fixMisdecoded(key), value: fixMisdecoded(value) }))
    : null
  custom?.forEach((entry, index) => {
    slots.push({
      id: `xc${index}:key`,
      phase: 0,
      field: '自定义属性名',
      hint: null,
      quasi: null,
      get: () => (entry.key.length > 0 ? entry.key : null),
      set(next) {
        if (!next || custom.some((other) => other !== entry && other.key === next)) return false
        entry.key = next
        return true
      },
    })
    slots.push({
      id: `xc${index}:value`,
      phase: 0,
      field: '自定义属性',
      hint: hintForHeader(entry.key),
      quasi: null,
      get() {
        if (typeof entry.value === 'string') return entry.value.length > 0 ? entry.value : null
        return numericIdText(entry.value)
      },
      set(next) {
        entry.value = next
        return true
      },
    })
  })

  function renameSheet(sheetIndex, next) {
    const from = workbook.SheetNames[sheetIndex]
    if (next === from) return true
    if (!validSheetName(next, workbook.SheetNames.filter((_, index) => index !== sheetIndex))) return false
    workbook.Sheets[next] = workbook.Sheets[from]
    delete workbook.Sheets[from]
    workbook.SheetNames[sheetIndex] = next
    refCache.clear()
    const meta = workbook.Workbook?.Sheets?.[sheetIndex]
    if (meta && typeof meta === 'object') meta.name = next
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue
      for (const key of Object.keys(sheet)) {
        if (key[0] === '!') continue
        const cell = sheet[key]
        if (typeof cell?.f === 'string') cell.f = renameSheetInFormula(cell.f, from, next)
        if (cell?.l && typeof cell.l.Target === 'string') {
          cell.l.Target = renameSheetInLink(cell.l.Target, from, next)
          if (cell.l.Rel && typeof cell.l.Rel === 'object' && typeof cell.l.Rel.Target === 'string') cell.l.Rel.Target = renameSheetInLink(cell.l.Rel.Target, from, next)
        }
      }
    }
    for (const entry of names) {
      if (typeof entry.Ref === 'string') entry.Ref = renameSheetInFormula(entry.Ref, from, next)
    }
    return true
  }

  const slotById = new Map(slots.map((slot) => [slot.id, slot]))

  /** Applies one slot's replacements in the order given; all or nothing. */
  function applySlot(slot, list) {
    let text = slot.get()
    if (text === null) return 0
    let count = 0
    for (const replacement of list) {
      const slice = text.slice(replacement.start, replacement.end)
      if (slice !== replacement.original) continue
      text = text.slice(0, replacement.start) + replacement.replacement + text.slice(replacement.end)
      count += 1
    }
    if (count === 0) return 0
    return slot.set(text) ? count : 0
  }

  return {
    kind: 'xlsx',
    relPath,
    bytes: buffer.length,
    sheetCount: sheetNames.length,
    /** [label as issued, label now] for every field label whose sheet name or header changed. */
    renamedFields() {
      const out = []
      for (const [issued, { sheetIndex, col, part }] of labelSpecs) {
        const now = `${workbook.SheetNames[sheetIndex]}!${col === null ? part : headerText(sheetIndex, col)}`
        if (now !== issued) out.push([issued, now])
      }
      return out
    },
    segments() {
      const out = []
      for (const slot of slots) {
        const text = slot.get()
        if (text === null || text.length === 0) continue
        out.push({ id: slot.id, text, hint: slot.hint, quasi: slot.quasi, field: slot.field })
      }
      return out
    },
    apply(replacements) {
      const bySlot = new Map()
      for (const replacement of replacements) {
        const slot = slotById.get(replacement.id)
        if (!slot) continue
        if (!bySlot.has(slot)) bySlot.set(slot, [])
        bySlot.get(slot).push(replacement)
      }
      let applied = 0
      for (const [slot, list] of [...bySlot].sort((a, b) => a[0].phase - b[0].phase)) {
        applied += applySlot(slot, list)
      }
      return applied
    },
    serialize() {
      if (props) {
        // Recomputed from the current sheet names; never the input's copy.
        delete props.SheetNames
        delete props.Worksheets
      }
      if (custom) workbook.Custprops = Object.fromEntries(custom.map((entry) => [entry.key, entry.value]))
      return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    },
    structure() {
      let out
      try {
        out = readXlsx(this.serialize())
      } catch (error) {
        return { ok: false, checks: [{ name: 'XLSX 可读性', ok: false, detail: String(error) }] }
      }
      const expected = workbook.SheetNames
      const checks = [{
        name: '工作表',
        ok: out.SheetNames.length === sheetNames.length
          && out.SheetNames.every((name, index) => name === expected[index]),
        detail: `${sheetNames.length} 个工作表`,
      }]
      let cellsOk = true
      let formatsOk = true
      for (const item of snapshot) {
        const sheet = out.Sheets[expected[item.sheetIndex]]
        if (!sheet) { cellsOk = false; break }
        if (changedCells.has(`${item.sheetIndex}:${item.addr}`)) continue
        const cell = sheet[item.addr]
        if ((cell?.z ?? 'General') !== item.format) formatsOk = false
        if (item.value === null) continue
        const value = cell ? (cell.t === 'd' ? cell.v?.toISOString?.() ?? cell.v : cell.v) : undefined
        if (value !== item.value) { cellsOk = false; break }
      }
      checks.push({ name: '非文本单元格', ok: cellsOk, detail: cellsOk ? '数值/日期未改动' : '出现越界修改' })
      checks.push({ name: '数字格式', ok: formatsOk, detail: formatsOk ? '单元格数字格式（日期、金额等）未改动' : '单元格数字格式发生变化' })
      return { ok: checks.every((check) => check.ok), checks }
    },
  }
}
