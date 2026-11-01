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
  const raw = await readFile(path, 'utf8')
  if (kind === 'text') return createTextDocument(raw, relPath)
  if (kind === 'csv') return createCsvDocument(raw, relPath)
  return createJsonDocument(raw, relPath)
}

/* ------------------------------------------------------------------ text */

function chunkText(text) {
  const chunks = []
  let cursor = 0
  let current = ''
  let currentStart = 0
  const flush = () => {
    if (current.length === 0) return
    chunks.push({ id: `t${chunks.length}`, text: current, start: currentStart })
    current = ''
    currentStart = cursor
  }
  while (cursor < text.length) {
    const newline = text.indexOf('\n', cursor)
    const end = newline === -1 ? text.length : newline + 1
    let line = text.slice(cursor, end)
    while (line.length > CHUNK_CHARS) {
      if (current.length > 0) flush()
      currentStart = cursor
      chunks.push({ id: `t${chunks.length}`, text: line.slice(0, CHUNK_CHARS), start: cursor })
      line = line.slice(CHUNK_CHARS)
      cursor += CHUNK_CHARS
      currentStart = cursor
    }
    if (current.length + line.length > CHUNK_CHARS && current.length > 0) flush()
    if (current.length === 0) currentStart = cursor
    current += line
    cursor = end
  }
  flush()
  if (chunks.length === 0) chunks.push({ id: 't0', text: '', start: 0 })
  return chunks
}

function createTextDocument(raw, relPath) {
  const bom = raw.charCodeAt(0) === 0xFEFF
  const body = bom ? raw.slice(1) : raw
  let chunks = chunkText(body)
  const originalLineCount = (body.match(/\n/g) ?? []).length

  return {
    kind: 'text',
    relPath,
    bytes: Buffer.byteLength(raw, 'utf8'),
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

function createCsvDocument(raw, relPath) {
  const { rows, bom } = parseCsv(raw)
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
    bytes: Buffer.byteLength(raw, 'utf8'),
    rowCount: rows.length,
    colCount: width,
    segments() {
      const result = []
      for (let r = 1; r < rows.length; r += 1) {
        for (let c = 0; c < rows[r].length; c += 1) {
          const value = rows[r][c]
          if (typeof value === 'string' && value.length > 0) {
            result.push({ id: cellId(r, c), text: value, hint: hints[c] ?? null, quasi: quasiHints[c] ?? null, field: header[c] ?? `第${c + 1}列` })
          }
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
      const headerOk = rows[0]?.every((value, index) => value === header[index])
      checks.push({ name: '表头', ok: headerOk, detail: headerOk ? '未改动' : '表头发生变化' })
      const untouched = rows.every((row, r) => row.every((value, c) =>
        changed.has(`${r}:${c}`) || value === snapshot[r][c]))
      checks.push({ name: '非命中单元格', ok: untouched, detail: untouched ? '保持原值' : '出现越界修改' })
      return { ok: checks.every((check) => check.ok), checks }
    },
  }
}

/* ------------------------------------------------------------------ json */

function flattenStrings(value, path = [], out = []) {
  if (typeof value === 'string') {
    out.push({ path, text: value })
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => flattenStrings(item, [...path, index], out))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) flattenStrings(item, [...path, key], out)
  }
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

function shapeOf(value) {
  if (typeof value === 'string') return 's'
  if (typeof value === 'number') return 'n'
  if (typeof value === 'boolean') return 'b'
  if (value === null) return 'z'
  if (Array.isArray(value)) return `[${value.map(shapeOf).join(',')}]`
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
  const stringLeaves = flattenStrings(root).filter((leaf) => leaf.text.length > 0)
  const leafById = new Map(stringLeaves.map((leaf) => [encodePath(leaf.path), leaf]))

  return {
    kind: 'json',
    relPath,
    bytes: Buffer.byteLength(raw, 'utf8'),
    segments() {
      return stringLeaves
        .map((leaf) => {
          const current = getAt(root, leaf.path)
          if (typeof current !== 'string' || current.length === 0) return null
          const key = leaf.path[leaf.path.length - 1]
          const own = hintForKey(key)
          const sibling = own ? null : hintForSibling(getAt(root, leaf.path.slice(0, -1)), key)
          return {
            id: encodePath(leaf.path),
            text: current,
            hint: own ?? sibling,
            // A sibling label ("联系电话") often heads free text mixing several
            // items; a value that does not fit is normal, not a finding.
            hintFrom: sibling ? 'sibling' : undefined,
            quasi: quasiHintForHeader(leaf.path[leaf.path.length - 1]),
            field: fieldOfPath(leaf.path),
          }
        })
        .filter(Boolean)
    },
    apply(replacements) {
      let applied = 0
      for (const replacement of replacements) {
        const leaf = leafById.get(replacement.id)
        if (!leaf) continue
        const current = getAt(root, leaf.path)
        if (typeof current !== 'string') continue
        const slice = current.slice(replacement.start, replacement.end)
        if (slice !== replacement.original) continue
        const next = current.slice(0, replacement.start) + replacement.replacement + current.slice(replacement.end)
        setAt(root, leaf.path, next)
        applied += 1
      }
      return applied
    },
    serialize() {
      return (bom ? '\uFEFF' : '') + JSON.stringify(root, null, indent)
    },
    structure() {
      const shape = shapeOf(root)
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

function createXlsxDocument(buffer, relPath) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellStyles: false, cellDates: false })
  const sheetNames = [...workbook.SheetNames]
  const sheets = new Map()
  const segments = []
  const snapshot = []

  sheetNames.forEach((name, sheetIndex) => {
    const sheet = workbook.Sheets[name]
    if (!sheet?.['!ref']) return
    const range = XLSX.utils.decode_range(sheet['!ref'])
    const cells = new Map()
    const hints = []
    const quasiHints = []
    const fields = []
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })]
      hints[c] = hintForHeader(cell?.v)
      quasiHints[c] = quasiHintForHeader(cell?.v)
      fields[c] = cell?.v !== undefined && cell?.v !== null && String(cell.v).trim() ? String(cell.v).trim() : XLSX.utils.encode_col(c)
    }
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = sheet[addr]
        if (!cell) continue
        cells.set(addr, cell)
        const isString = cell.t === 's' || typeof cell.v === 'string'
        if (isString && typeof cell.v === 'string' && cell.v.length >= 1) {
          segments.push({
            id: `x${sheetIndex}:${addr}`,
            text: cell.v,
            sheet: name,
            addr,
            hint: r === range.s.r ? null : (hints[c] ?? null),
            quasi: r === range.s.r ? null : (quasiHints[c] ?? null),
            field: r === range.s.r ? null : `${name}!${fields[c]}`,
          })
        }
        snapshot.push({ sheet: name, addr, type: cell.t, value: isString ? null : cell.v })
      }
    }
    sheets.set(name, { sheet, range, cells })
  })

  const index = new Map(segments.map((segment) => [segment.id, segment]))
  return {
    kind: 'xlsx',
    relPath,
    bytes: buffer.length,
    sheetCount: sheetNames.length,
    segments() {
      return segments
        .map((segment) => {
          const cell = sheets.get(segment.sheet)?.cells.get(segment.addr)
          if (!cell || typeof cell.v !== 'string' || cell.v.length === 0) return null
          return { id: segment.id, text: cell.v, hint: segment.hint, quasi: segment.quasi, field: segment.field }
        })
        .filter(Boolean)
    },
    apply(replacements) {
      let applied = 0
      for (const replacement of replacements) {
        const segment = index.get(replacement.id)
        if (!segment) continue
        const entry = sheets.get(segment.sheet)
        const cell = entry?.cells.get(segment.addr)
        if (!cell || typeof cell.v !== 'string') continue
        const slice = cell.v.slice(replacement.start, replacement.end)
        if (slice !== replacement.original) continue
        cell.v = cell.v.slice(0, replacement.start) + replacement.replacement + cell.v.slice(replacement.end)
        cell.t = 's'
        applied += 1
      }
      return applied
    },
    serialize() {
      return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    },
    structure() {
      let out
      try {
        out = XLSX.read(this.serialize(), { type: 'buffer', cellStyles: false, cellDates: false })
      } catch (error) {
        return { ok: false, checks: [{ name: 'XLSX 可读性', ok: false, detail: String(error) }] }
      }
      const checks = [{
        name: '工作表',
        ok: out.SheetNames.length === sheetNames.length
          && out.SheetNames.every((name, index) => name === sheetNames[index]),
        detail: `${sheetNames.length} 个工作表`,
      }]
      let cellsOk = true
      for (const item of snapshot) {
        const sheet = out.Sheets[item.sheet]
        if (!sheet) { cellsOk = false; break }
        if (item.value === null) continue
        const cell = sheet[item.addr]
        const value = cell ? (cell.t === 'd' ? cell.v?.toISOString?.() ?? cell.v : cell.v) : undefined
        if (value !== item.value) { cellsOk = false; break }
      }
      checks.push({ name: '非文本单元格', ok: cellsOk, detail: cellsOk ? '数值/日期未改动' : '出现越界修改' })
      return { ok: checks.every((check) => check.ok), checks }
    },
  }
}
