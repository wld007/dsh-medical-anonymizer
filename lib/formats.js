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

function parseCsv(text) {
  const bom = text.charCodeAt(0) === 0xFEFF
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = bom ? 1 : 0
  const pushRow = () => {
    row.push(field)
    rows.push(row)
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
    else if (ch === '\n') pushRow()
    else if (ch === '\r') { if (text[i + 1] !== '\n') pushRow() }
    else field += ch
  }
  if (field.length > 0 || row.length > 0) pushRow()
  // A trailing newline must not produce a phantom empty row.
  if (rows.length > 0) {
    const last = rows[rows.length - 1]
    if (last.length === 1 && last[0] === '') rows.pop()
  }
  return { rows, bom }
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
  const trailingNewline = /\r?\n$/.test(raw)

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
      const body = rows.map((row) => row.map((cell) => {
        const value = cell ?? ''
        return csvCellNeedsQuote(value) ? `"${value.replace(/"/g, '""')}"` : value
      }).join(',')).join('\n')
      return (bom ? '\uFEFF' : '') + body + (trailingNewline ? '\n' : '')
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
const NUMERIC_ID_DIGITS = 6
const JSON_NUMBER_PARTS = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/

/**
 * Exact decimal digits of a non-negative integral JSON number literal, from
 * its source text: "13800138000.0" (pandas writes int columns with a NaN as
 * floats) → "13800138000", "1.1010519500101002e17" → "110105195001010020".
 * Null for negative, fractional or absurdly large literals.
 */
function integerDigits(source) {
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

function flattenLeaves(value, path = [], out = []) {
  if (typeof value === 'string' || typeof value === 'number') {
    out.push({ path, text: value })
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => flattenLeaves(item, [...path, index], out))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) flattenLeaves(item, [...path, key], out)
  }
  return out
}

/**
 * Source text of every number literal of a valid JSON text, by encoded path.
 * JSON.parse rounds integers above 2^53 before anything can see them; the
 * digits that get scanned and written back must be the file's own. Later
 * duplicate keys win, as in JSON.parse.
 */
function numberSources(text) {
  const out = new Map()
  const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  const LITERAL = /true|false|null/y
  let i = 0
  const space = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i += 1
  }
  const string = () => {
    const start = i
    i += 1
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1
    i += 1
    return text.slice(start, i)
  }
  const value = (path) => {
    space()
    const ch = text[i]
    if (ch === '{') {
      i += 1
      space()
      if (text[i] === '}') { i += 1; return }
      for (;;) {
        space()
        const key = JSON.parse(string())
        space()
        i += 1 // ':'
        value([...path, key])
        space()
        if (text[i++] === ',') continue
        return
      }
    }
    if (ch === '[') {
      i += 1
      space()
      if (text[i] === ']') { i += 1; return }
      for (let index = 0; ; index += 1) {
        value([...path, index])
        space()
        if (text[i++] === ',') continue
        return
      }
    }
    if (ch === '"') { string(); return }
    NUMBER.lastIndex = i
    const number = NUMBER.exec(text)
    if (number) {
      i = NUMBER.lastIndex
      out.set(encodePath(path), { path, raw: number[0] })
      return
    }
    LITERAL.lastIndex = i
    if (!LITERAL.exec(text)) throw new Error('JSON 数字定位失败')
    i = LITERAL.lastIndex
  }
  value([])
  return out
}

function encodePath(path) {
  return path.map((part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')
}

function getAt(value, path) {
  let cursor = value
  for (const key of path) cursor = cursor?.[key]
  return cursor
}

function setAt(value, path, next) {
  let cursor = value
  for (let i = 0; i < path.length - 1; i += 1) cursor = cursor[path[i]]
  cursor[path[path.length - 1]] = next
}

/** Shape of a JSON value; numbers turned into pseudonyms still count as numbers. */
function shapeOf(value, converted = null, path = []) {
  if (typeof value === 'string') return converted?.size && converted.has(encodePath(path)) ? 'n' : 's'
  if (typeof value === 'number') return 'n'
  if (typeof value === 'boolean') return 'b'
  if (value === null) return 'z'
  if (Array.isArray(value)) return `[${value.map((item, index) => shapeOf(item, converted, [...path, index])).join(',')}]`
  return `{${Object.keys(value).sort().join(',')}}`
}

/** Nearest object key of a JSON leaf ("ADMN_DPT_CD" for [3, "ADMN_DPT_CD"]). */
function fieldOfPath(path) {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    if (typeof path[i] === 'string') return path[i]
  }
  return '(数组元素)'
}

function createJsonDocument(raw, relPath) {
  const bom = raw.charCodeAt(0) === 0xFEFF
  const text = bom ? raw.slice(1) : raw
  const root = JSON.parse(text)
  const indent = /\n/.test(text) ? 2 : 0
  const originalShape = shapeOf(root)
  let sources
  try {
    sources = numberSources(text)
  } catch {
    sources = new Map()
  }
  const leaves = flattenLeaves(root)
    .map((leaf) => {
      if (typeof leaf.text === 'string') return leaf.text.length > 0 ? leaf : null
      const id = encodePath(leaf.path)
      const source = sources.get(id)?.raw ?? (Number.isFinite(leaf.text) ? String(leaf.text) : null)
      const digits = source === null ? null : integerDigits(source)
      return digits === null ? null : { path: leaf.path, text: digits, number: true }
    })
    .filter(Boolean)
  const leafById = new Map(leaves.map((leaf) => [encodePath(leaf.path), leaf]))
  // Number leaves rewritten into string pseudonyms.
  const converted = new Set()

  /** Current text of a leaf: the string, or the source digits of a number. */
  const textOf = (leaf) => {
    const current = getAt(root, leaf.path)
    if (typeof current === 'string') return current
    if (typeof current === 'number' && leaf.number && !converted.has(encodePath(leaf.path))) return leaf.text
    return null
  }

  return {
    kind: 'json',
    relPath,
    bytes: Buffer.byteLength(raw, 'utf8'),
    segments() {
      return leaves
        .map((leaf) => {
          const current = textOf(leaf)
          if (current === null || current.length === 0) return null
          const key = leaf.path[leaf.path.length - 1]
          const parent = getAt(root, leaf.path.slice(0, -1))
          const own = hintForJsonKey(parent, key)
          const sibling = own ? null : hintForSibling(parent, key)
          // Short integers (ages, counts) only under an identifier key.
          if (leaf.number && current.length < NUMERIC_ID_DIGITS && !own && !sibling) return null
          return {
            id: encodePath(leaf.path),
            text: current,
            hint: own ?? sibling,
            // A sibling label ("联系电话") often heads free text mixing several
            // items; a value that does not fit is normal, not a finding.
            hintFrom: sibling ? 'sibling' : undefined,
            // Quasi-identifier handling covers text values only.
            quasi: leaf.number ? null : quasiHintForHeader(leaf.path[leaf.path.length - 1]),
            field: fieldOfPath(leaf.path),
          }
        })
        .filter(Boolean)
    },
    apply(replacements) {
      let applied = 0
      for (const replacement of replacements) {
        const leaf = leafById.get(replacement.id)
        // A document that is a single value has no place to write back into.
        if (!leaf || leaf.path.length === 0) continue
        const current = textOf(leaf)
        if (current === null) continue
        const slice = current.slice(replacement.start, replacement.end)
        if (slice !== replacement.original) continue
        const next = current.slice(0, replacement.start) + replacement.replacement + current.slice(replacement.end)
        // A replaced number becomes a string pseudonym.
        if (typeof getAt(root, leaf.path) === 'number') converted.add(replacement.id)
        setAt(root, leaf.path, next)
        applied += 1
      }
      return applied
    },
    serialize() {
      // Numbers keep their source text ("110105195001010020" must not come
      // back rounded, "1.50" stays "1.50").
      const prefix = bom ? '\uFEFF' : ''
      const keep = []
      for (const { path, raw: source } of sources.values()) {
        const current = getAt(root, path)
        if (typeof current === 'number' && String(current) !== source) keep.push({ path, source, current })
      }
      if (keep.length === 0) return prefix + JSON.stringify(root, null, indent)
      if (keep[0].path.length === 0) return prefix + keep[0].source // the whole document is one number
      // Stand-in strings that cannot occur in the data, swapped for the
      // source digits after stringify.
      const tag = `\u0000${Math.random().toString(36).slice(2)}${Date.now().toString(36)}:`
      keep.forEach((item, index) => setAt(root, item.path, `${tag}${index}\u0000`))
      let body
      try {
        body = JSON.stringify(root, null, indent)
      } finally {
        for (const item of keep) setAt(root, item.path, item.current)
      }
      const open = `"${JSON.stringify(tag).slice(1, -1)}`
      const close = `${JSON.stringify('\u0000').slice(1, -1)}"`
      body = body.split(open).map((part, index) => {
        if (index === 0) return part
        const end = part.indexOf(close)
        return keep[Number(part.slice(0, end))].source + part.slice(end + close.length)
      }).join('')
      return prefix + body
    },
    structure() {
      const shape = shapeOf(root, converted)
      return {
        ok: shape === originalShape,
        checks: [{
          name: 'JSON 结构',
          ok: shape === originalShape,
          detail: shape === originalShape ? '键与类型未变' : '键集合或值类型发生变化',
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
function createXlsxDocument(buffer, relPath) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellStyles: false, cellDates: false })
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
      snapshot.push({ sheetIndex, addr, value: isString ? null : cell.v })

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
        out = XLSX.read(this.serialize(), { type: 'buffer', cellStyles: false, cellDates: false })
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
      for (const item of snapshot) {
        const sheet = out.Sheets[expected[item.sheetIndex]]
        if (!sheet) { cellsOk = false; break }
        if (item.value === null || changedCells.has(`${item.sheetIndex}:${item.addr}`)) continue
        const cell = sheet[item.addr]
        const value = cell ? (cell.t === 'd' ? cell.v?.toISOString?.() ?? cell.v : cell.v) : undefined
        if (value !== item.value) { cellsOk = false; break }
      }
      checks.push({ name: '非文本单元格', ok: cellsOk, detail: cellsOk ? '数值/日期未改动' : '出现越界修改' })
      return { ok: checks.every((check) => check.ok), checks }
    },
  }
}
