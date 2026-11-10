/**
 * Layered content. A field value may wrap the real text in one or more
 * layers: base64 (often with gzip inside), data: URIs, hex, URL encoding,
 * \uXXXX escapes, HTML entities, mis-decoded UTF-8, a JSON document in a
 * string, HTML/XML markup, HL7 v2 messages, or encoded runs inside text.
 *
 * `layered(doc)` wraps a format document (formats.js) and exposes the text
 * found after unwrapping as ordinary segments, cut into pieces of at most
 * ~1400 characters at sentence or block boundaries. Replacements in those
 * segments are written back through every layer in reverse, so the file
 * keeps its format (a base64 field stays base64, the HTML keeps its tags).
 *
 * Content that cannot be unwrapped into text (images, PDFs, unknown binary,
 * RTF, long unreadable runs) is never treated as checked: it is reported by
 * `opaque()` and must go to manual review.
 */
import { gunzipSync, gzipSync, inflateSync, deflateSync, inflateRawSync } from 'node:zlib'
import { NUMERIC_ID_DIGITS, jsonIntegerDigits, jsonKeyExposed, jsonKeyField, jsonLeafMeta, scanJsonTokens, spliceJson } from './formats.js'

export const PIECE_CHARS = 1400
const MAX_DEPTH = 5
const MIN_B64 = 40
const OPAQUE_MIN_BYTES = 48
const RUN_MIN = 120

/* --------------------------------------------------------------- bytes */

const utf8 = new TextDecoder('utf-8', { fatal: true })
let gbkDecoder = null
function gbk() {
  gbkDecoder ??= new TextDecoder('gbk', { fatal: true })
  return gbkDecoder
}
let gbkTable = null
/** Encode text as GBK (Node has no GBK encoder; build the table once). */
function gbkEncode(text) {
  if (!gbkTable) {
    gbkTable = new Map()
    const decoder = new TextDecoder('gbk')
    for (let hi = 0x81; hi <= 0xfe; hi += 1) {
      for (let lo = 0x40; lo <= 0xfe; lo += 1) {
        if (lo === 0x7f) continue
        const ch = decoder.decode(Uint8Array.of(hi, lo))
        if (ch.length === 1 && ch !== '\ufffd' && !gbkTable.has(ch)) gbkTable.set(ch, [hi, lo])
      }
    }
  }
  const out = []
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (code < 0x80) out.push(code)
    else {
      const pair = gbkTable.get(ch)
      if (!pair) throw new Error(`GBK 无法编码字符 ${ch}`)
      out.push(pair[0], pair[1])
    }
  }
  return Buffer.from(out)
}

function printableRatio(text) {
  if (!text.length) return 0
  let bad = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if ((code < 0x20 && code !== 9 && code !== 10 && code !== 13) || code === 0xfffd || (code >= 0x7f && code < 0xa0)) bad += 1
  }
  return 1 - bad / text.length
}

const MAGIC = [
  [[0x89, 0x50, 0x4e, 0x47], 'PNG 图片'],
  [[0xff, 0xd8, 0xff], 'JPEG 图片'],
  [[0x47, 0x49, 0x46, 0x38], 'GIF 图片'],
  [[0x42, 0x4d], 'BMP 图片'],
  [[0x49, 0x49, 0x2a, 0x00], 'TIFF 图片'],
  [[0x4d, 0x4d, 0x00, 0x2a], 'TIFF 图片'],
  [[0x25, 0x50, 0x44, 0x46], 'PDF 文档'],
  [[0x50, 0x4b, 0x03, 0x04], 'ZIP / Office 文档'],
  [[0xd0, 0xcf, 0x11, 0xe0], 'Office 97 文档'],
  [[0x52, 0x49, 0x46, 0x46], 'RIFF 媒体'],
]
function magicKind(bytes) {
  for (const [sig, kind] of MAGIC) if (sig.every((b, i) => bytes[i] === b)) return kind
  if (bytes.length > 132 && bytes.slice(128, 132).toString('latin1') === 'DICM') return 'DICOM 影像'
  return null
}

/**
 * Bytes → { text, encode(text) → bytes } or { opaque } or null (too short to
 * matter). Handles gzip/zlib/raw-deflate before decoding text.
 */
function decodeBytes(bytes, depth = 0) {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b && depth < 3) {
    try {
      const inner = decodeBytes(gunzipSync(bytes), depth + 1)
      if (inner?.text !== undefined) return { ...inner, label: `gzip›${inner.label}`, encode: (text) => gzipSync(inner.encode(text)) }
      if (inner?.opaque) return inner
    } catch { /* not gzip after all */ }
  }
  if (bytes.length >= 2 && bytes[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(bytes[1]) && depth < 3) {
    try {
      const inner = decodeBytes(inflateSync(bytes), depth + 1)
      if (inner?.text !== undefined) return { ...inner, label: `zlib›${inner.label}`, encode: (text) => deflateSync(inner.encode(text)) }
      if (inner?.opaque) return inner
    } catch { /* not zlib */ }
  }
  const kind = magicKind(bytes)
  if (kind) return { opaque: kind, bytes: bytes.length }
  if (bytes[0] === 0x7b && bytes.slice(0, 5).toString('latin1') === '{\\rtf') return { opaque: 'RTF 文档', bytes: bytes.length }
  let bom = false
  let body = bytes
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { bom = true; body = bytes.subarray(3) }
  try {
    const text = utf8.decode(body)
    if (printableRatio(text) >= 0.97) {
      return { text, label: 'utf8', encode: (next) => Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(next, 'utf8')]) }
    }
  } catch { /* not utf-8 */ }
  try {
    const text = gbk().decode(bytes)
    if (printableRatio(text) >= 0.97 && /[\u4e00-\u9fff]/.test(text)) return { text, label: 'gbk', encode: (next) => gbkEncode(next) }
  } catch { /* not gbk */ }
  if (depth < 3) {
    try {
      const inner = decodeBytes(inflateRawSync(bytes), depth + 1)
      if (inner?.text !== undefined && inner.text.length > bytes.length) return { ...inner, label: `deflate›${inner.label}`, encode: (text) => deflateRawCompat(inner.encode(text)) }
    } catch { /* not deflate */ }
  }
  return { opaque: '无法识别的二进制内容', bytes: bytes.length }
}
function deflateRawCompat(bytes) {
  return deflateSync(bytes).subarray(2, -4)
}

/* ------------------------------------------------------------- decoders */

const B64_CHARS = /^[A-Za-z0-9+/_\-\r\n]+={0,2}$/

/** Whole value is base64 (standard or URL-safe, padding and line breaks kept). */
function decodeBase64(text) {
  const value = text.trim()
  if (value !== text) return null
  const clean = value.replace(/[\r\n]/g, '')
  if (clean.length < MIN_B64 || !B64_CHARS.test(value)) return null
  if (!/\d/.test(clean) && clean.length < 200) return null
  if (!/[a-z]/.test(clean) || !/[A-Z]/.test(clean)) return null
  const urlSafe = /[-_]/.test(clean)
  if (urlSafe && /[+/]/.test(clean)) return null
  const body = clean.replace(/=+$/, '')
  if (body.length % 4 === 1) return null
  const bytes = Buffer.from(body, urlSafe ? 'base64url' : 'base64')
  const check = bytes.toString(urlSafe ? 'base64url' : 'base64').replace(/=+$/, '')
  if (check !== body) return null
  const padded = /=$/.test(clean)
  const lineMatch = /^([^\r\n]+)(\r?\n)/.exec(value)
  const lineWidth = lineMatch ? lineMatch[1].length : 0
  const eol = lineMatch ? lineMatch[2] : ''
  const trailingEol = /\r?\n$/.test(value)
  const encodeB64 = (buf) => {
    let out = buf.toString(urlSafe ? 'base64url' : 'base64')
    if (urlSafe && padded) out += '='.repeat((4 - (out.length % 4)) % 4)
    if (!padded) out = out.replace(/=+$/, '')
    if (lineWidth) out = out.match(new RegExp(`.{1,${lineWidth}}`, 'g')).join(eol) + (trailingEol ? eol : '')
    return out
  }
  const inner = decodeBytes(bytes)
  if (inner.opaque) {
    if (bytes.length < OPAQUE_MIN_BYTES) return { token: true, label: 'base64' }
    return { opaque: inner.opaque, bytes: inner.bytes, label: 'base64' }
  }
  return { type: 'text', label: `base64›${inner.label}`, text: inner.text, encode: (next) => encodeB64(inner.encode(next)) }
}

/** data:[mime][;params][;base64],payload */
function decodeDataUri(text) {
  const match = /^data:([\w.+-]+\/[\w.+-]+)?((?:;[\w-]+=[^;,]*)*)(;base64)?,([\s\S]*)$/.exec(text)
  if (!match) return null
  const mime = (match[1] ?? 'text/plain').toLowerCase()
  const head = `data:${match[1] ?? ''}${match[2] ?? ''}${match[3] ?? ''},`
  const payload = match[4]
  const textual = mime.startsWith('text/') || /json|xml|javascript|html/.test(mime)
  if (match[3]) {
    const bytes = Buffer.from(payload.replace(/\s+/g, ''), 'base64')
    if (!textual) return { opaque: mime.startsWith('image/') ? `${mime.slice(6).toUpperCase()} 图片` : mime, bytes: bytes.length, label: 'data-uri', image: mime.startsWith('image/') }
    const inner = decodeBytes(bytes)
    if (inner.opaque) return { opaque: inner.opaque, bytes: bytes.length, label: 'data-uri' }
    return { type: 'text', label: `data-uri›${inner.label}`, text: inner.text, encode: (next) => head + inner.encode(next).toString('base64') }
  }
  let decoded
  try { decoded = decodeURIComponent(payload) } catch { return { opaque: mime, bytes: payload.length, label: 'data-uri' } }
  if (!textual) return { opaque: mime, bytes: payload.length, label: 'data-uri' }
  const encode = urlEncoder(payload, decoded, (ch, escaped) => (escaped || /[\s%]/.test(ch) ? encodeURIComponent(ch) : ch)) ?? encodeURIComponent
  return { type: 'text', label: 'data-uri›url', text: decoded, encode: (next) => head + encode(next) }
}

function decodeHex(text) {
  if (!/^(?:[0-9a-fA-F]{2}){24,}$/.test(text)) return null
  const bytes = Buffer.from(text, 'hex')
  let decoded
  try { decoded = utf8.decode(bytes) } catch { return null }
  if (printableRatio(decoded) < 0.97 || !/[\u4e00-\u9fff]|[A-Za-z]{3}/.test(decoded)) return null
  const upper = /[A-F]/.test(text)
  return { type: 'text', label: 'hex', text: decoded, encode: (next) => { const out = Buffer.from(next, 'utf8').toString('hex'); return upper ? out.toUpperCase() : out } }
}

/*
 * Escape-style layers (URL, \u, entities) are re-encoded minimally: every
 * unit of the original that is still present in the new text keeps its raw
 * form (escaped or not), and only inserted text is encoded, in the style of
 * the text it replaces or sits next to (a name in a plain line stays plain,
 * one inside an escaped URL is escaped). Re-encoding the whole value would
 * rewrite characters far from the edit (other lines of a text chunk), so the
 * write-back could not stay within the edited region.
 */
const MAX_DIFF_CELLS = 4_000_000

/**
 * units: [{ raw, dec }] of the original value (dec joined = decoded text);
 * items: the new decoded text split at the same granularity as unit.dec;
 * encodeItem(item, escaped) encodes one inserted item.
 */
function encodeMinimal(units, items, encodeItem) {
  const n = units.length
  const m = items.length
  let head = 0
  while (head < n && head < m && units[head].dec === items[head]) head += 1
  let tail = 0
  while (tail < n - head && tail < m - head && units[n - 1 - tail].dec === items[m - 1 - tail]) tail += 1
  // ops: { keep: unit } | { drop: unit } | { add: item }
  const ops = []
  for (let i = 0; i < head; i += 1) ops.push({ keep: units[i] })
  const a = units.slice(head, n - tail)
  const b = items.slice(head, m - tail)
  if (a.length > 0 && b.length > 0 && (a.length + 1) * (b.length + 1) <= MAX_DIFF_CELLS) {
    // Longest common subsequence: matched units keep their raw form.
    const width = b.length + 1
    const table = new Uint32Array((a.length + 1) * width)
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i * width + j] = a[i].dec === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i].dec === b[j] && table[i * width + j] === table[(i + 1) * width + j + 1] + 1) { ops.push({ keep: a[i] }); i += 1; j += 1 }
      else if (i < a.length && (j >= b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) { ops.push({ drop: a[i] }); i += 1 }
      else { ops.push({ add: b[j] }); j += 1 }
    }
  } else {
    for (const unit of a) ops.push({ drop: unit })
    for (const item of b) ops.push({ add: item })
  }
  for (let i = n - tail; i < n; i += 1) ops.push({ keep: units[i] })
  // Style of a run of insertions: how the nearest non-ASCII character was
  // written — among the replaced units first, then before, then after.
  const nonAscii = (unit) => unit && /[^\x00-\x7e]/.test(unit.dec)
  const escapedAround = (from, to) => {
    for (let k = from; k < to; k += 1) if (nonAscii(ops[k].drop)) return ops[k].drop.raw !== ops[k].drop.dec
    for (let k = from - 1; k >= 0; k -= 1) { const unit = ops[k].keep ?? ops[k].drop; if (nonAscii(unit)) return unit.raw !== unit.dec }
    for (let k = to; k < ops.length; k += 1) { const unit = ops[k].keep ?? ops[k].drop; if (nonAscii(unit)) return unit.raw !== unit.dec }
    return true
  }
  const out = []
  for (let k = 0; k < ops.length;) {
    if (ops[k].keep) { out.push(ops[k].keep.raw); k += 1; continue }
    let end = k
    while (end < ops.length && !ops[end].keep) end += 1
    const escaped = escapedAround(k, end)
    for (let q = k; q < end; q += 1) if (ops[q].add !== undefined) out.push(encodeItem(ops[q].add, escaped))
    k = end
  }
  return out.join('')
}

/** Raw units of a URL-encoded value: one per decoded code point. */
function urlUnits(text) {
  const units = []
  let i = 0
  while (i < text.length) {
    if (text[i] === '%') {
      const first = parseInt(text.slice(i + 1, i + 3), 16)
      const size = first < 0x80 ? 1 : first >= 0xc0 && first < 0xe0 ? 2 : first >= 0xe0 && first < 0xf0 ? 3 : first >= 0xf0 && first < 0xf8 ? 4 : 0
      const raw = text.slice(i, i + 3 * size)
      if (!size || !new RegExp(`^(?:%[0-9A-Fa-f]{2}){${size}}$`).test(raw)) return null
      let dec
      try { dec = decodeURIComponent(raw) } catch { return null }
      units.push({ raw, dec })
      i += raw.length
    } else {
      const ch = String.fromCodePoint(text.codePointAt(i))
      units.push({ raw: ch, dec: ch })
      i += ch.length
    }
  }
  return units
}

/** Minimal re-encoder for a URL-encoded value, or null if it cannot be mapped. */
function urlEncoder(text, decoded, encodeItem) {
  const units = urlUnits(text)
  if (!units || units.map((unit) => unit.dec).join('') !== decoded) return null
  return (next) => encodeMinimal(units, [...next], encodeItem)
}

// Values mixing raw characters with escapes are decoded too (a name could
// hide in either part). After a change the value keeps its original form
// except for the inserted text (see encodeMinimal).
function decodeUrl(text) {
  const hits = text.match(/%[0-9A-Fa-f]{2}/g)
  if (!hits || hits.length < 3) return null
  let decoded
  try { decoded = decodeURIComponent(text) } catch { return null }
  if (decoded === text) return null
  const encodeAll = (next) => next.replace(/[^\x20-\x7e]|%/gu, (ch) => encodeURIComponent(ch))
  const encode = urlEncoder(text, decoded, (ch, escaped) => (escaped ? encodeAll(ch) : ch === '%' ? '%25' : ch)) ?? encodeAll
  return { type: 'text', label: 'url', text: decoded, encode }
}

function decodeUnicodeEscapes(text) {
  const hits = text.match(/\\u[0-9a-fA-F]{4}/g)
  if (!hits || hits.length < 2) return null
  const decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  const upper = hits.some((hit) => /[A-F]/.test(hit))
  const escape = (ch) => {
    const hex = ch.charCodeAt(0).toString(16).padStart(4, '0')
    return `\\u${upper ? hex.toUpperCase() : hex}`
  }
  // One unit per UTF-16 code unit, as the escapes are.
  const units = (text.match(/\\u[0-9a-fA-F]{4}|[\s\S]/g) ?? []).map((raw) => ({ raw, dec: raw.length === 6 ? String.fromCharCode(parseInt(raw.slice(2), 16)) : raw }))
  return {
    type: 'text', label: 'unicode-escape', text: decoded,
    encode: (next) => encodeMinimal(units, next.split(''), (ch, escaped) => (escaped && /[^\x00-\x7e]/.test(ch) ? escape(ch) : ch)),
  }
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  zwnj: '\u200c', zwj: '\u200d', shy: '\u00ad', middot: '\u00b7', times: '\u00d7', divide: '\u00f7', deg: '\u00b0',
  plusmn: '\u00b1', copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', bull: '\u2022', laquo: '\u00ab', raquo: '\u00bb',
  sup1: '\u00b9', sup2: '\u00b2', sup3: '\u00b3', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', micro: '\u00b5',
  le: '\u2264', ge: '\u2265', ne: '\u2260', larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193', alpha: '\u03b1',
  beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4', mu: '\u03bc', permil: '\u2030', sect: '\u00a7', para: '\u00b6', cent: '\u00a2',
  pound: '\u00a3', yen: '\u00a5', euro: '\u20ac', iexcl: '\u00a1', iquest: '\u00bf', acute: '\u00b4', cedil: '\u00b8', uml: '\u00a8',
}
/** Escape "&" except where it starts an entity this decoder leaves as is. */
function escapeAmp(value) {
  return value.replace(/&(?![a-zA-Z][a-zA-Z0-9]*;)|&(?=([a-zA-Z][a-zA-Z0-9]*);)/g, (match, name) => (name && !(name in NAMED_ENTITIES) ? '&' : '&amp;'))
}
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole
  })
}

function decodeEntityText(text) {
  const hits = text.match(/&#(?:x[0-9a-fA-F]+|\d+);/g)
  if (!hits || hits.length < 2) return null
  if (/<[a-zA-Z/!?]/.test(text)) return null
  const decoded = decodeEntities(text)
  const hexStyle = hits.some((hit) => /^&#x/i.test(hit))
  const encodeAll = (next) => next.replace(/&/g, '&amp;').replace(/[^\x00-\x7e]/gu, (ch) => (hexStyle ? `&#x${ch.codePointAt(0).toString(16)};` : `&#${ch.codePointAt(0)};`))
  // One unit per decoded code point; units that survive keep their form.
  const units = []
  for (const match of text.matchAll(/&(?:#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);|[\s\S]/gu)) {
    const dec = match[0].length > 1 ? decodeEntities(match[0]) : match[0]
    if ([...dec].length === 1) units.push({ raw: match[0], dec })
    else for (const ch of dec) units.push({ raw: ch, dec: ch })
  }
  const mapped = units.map((unit) => unit.dec).join('') === decoded
  return {
    type: 'text', label: 'html-entity', text: decoded,
    encode: (next) => (mapped ? encodeMinimal(units, [...next], (ch, escaped) => (escaped ? encodeAll(ch) : ch === '&' ? '&amp;' : ch)) : encodeAll(next)),
  }
}

/** UTF-8 bytes shown as Latin-1 ("å¼ ä¸‰" for 张三). */
function decodeMojibake(text) {
  const high = text.match(/[\u00c0-\u00ff]/g)
  if (!high || high.length < 3) return null
  if (/[^\u0000-\u00ff]/.test(text)) return null
  let decoded
  try { decoded = utf8.decode(Buffer.from(text, 'latin1')) } catch { return null }
  if (!/[\u4e00-\u9fff]/.test(decoded)) return null
  return { type: 'text', label: 'mojibake', text: decoded, encode: (next) => Buffer.from(next, 'utf8').toString('latin1') }
}

/**
 * A JSON document stored in a string. Values are exposed like those of a
 * JSON file: strings, integers that can be identifiers (six or more digits,
 * or any integer under an identifier key) with their source digits, and
 * object keys that can hold one. Written back by splicing the changed
 * tokens into the original text: large integers, number spelling, spacing
 * and key order never move; a replaced number becomes a string.
 */
function decodeJsonString(text) {
  const value = text.trim()
  if (!/^[[{][\s\S]*[\]}]$/.test(value) || value.length < 8) return null
  let root
  let tokens
  try {
    root = JSON.parse(value)
    tokens = scanJsonTokens(value)
  } catch { return null }
  if (!root || typeof root !== 'object') return null
  const lead = text.slice(0, text.indexOf(value))
  const tail = text.slice(text.indexOf(value) + value.length)
  const parts = []
  const at = [] // part → token index
  tokens.forEach((token, index) => {
    if (token.kind === 'key') {
      if (!jsonKeyExposed(token.value)) return
      // Values under this key are labelled with it (fieldOfPath); a renamed
      // key is reported by renamedFields() so labels never repeat it.
      parts.push({ text: token.value, field: jsonKeyField(token.path), hint: null, sep: '\n', exposedIf: jsonKeyExposed, keyName: true })
    } else {
      const { own, sibling, field } = jsonLeafMeta(root, token.path)
      const hint = own ?? sibling
      let leafText = token.value
      let contextual = false
      if (token.kind === 'number') {
        leafText = jsonIntegerDigits(token.raw)
        if (leafText === null || (leafText.length < NUMERIC_ID_DIGITS && !hint)) return
        // Exposed only for its key ("住院号": 573), and keys can be renamed
        // ("13800138000" → "电话-4A0380"): whether the number shows when
        // the value is decoded again is not a property of the value.
        contextual = leafText.length < NUMERIC_ID_DIGITS
      }
      if (!leafText) return
      parts.push({ text: leafText, field, hint, sep: '\n', exposedIf: nonEmpty, contextual })
    }
    at.push(index)
  })
  if (parts.length === 0) return null
  return {
    type: 'parts', label: 'json', parts,
    encode: (texts) => {
      const edits = new Map()
      texts.forEach((next, index) => { if (next !== parts[index].text) edits.set(at[index], next) })
      return lead + spliceJson(value, tokens, edits).text + tail
    },
  }
}

/* ---------------------------------------------------------------- markup */

const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'body', 'html', 'head', 'title', 'option', 'select', 'textarea', 'input', 'label', 'img', 'col', 'colgroup'])
const INLINE_TAGS = new Set(['span', 'b', 'i', 'u', 'em', 'strong', 'font', 'a', 'sub', 'sup', 'small', 'big', 'abbr', 'code', 's', 'strike', 'mark', 'q', 'cite', 'tt', 'kbd', 'var', 'del', 'ins', 'nobr', 'wbr'])
const TEXT_ATTRS = new Set(['title', 'alt', 'value', 'placeholder', 'label', 'content', 'summary', 'abbr', 'aria-label'])
// Attributes that only carry layout, typing or vocabulary codes. Every other
// attribute value (href, src, action, name, on*, CDA root/extension, ...) is
// inspected: it can hold an e-mail, a phone number or a record number.
const STRUCTURAL_ATTRS = new Set(['class', 'style', 'id', 'type', 'width', 'height', 'align', 'valign', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'xmlns', 'lang', 'dir', 'charset', 'http-equiv', 'rel', 'media', 'tabindex', 'role', 'target', 'method', 'size', 'maxlength', 'checked', 'selected', 'disabled', 'readonly', 'span', 'face', 'color', 'bgcolor', 'frame', 'rules', 'scope', 'nowrap',
  'version', 'encoding', 'standalone', 'enctype', 'accept-charset', 'autocomplete', 'crossorigin', 'integrity', 'loading', 'decoding', 'hidden', 'draggable', 'spellcheck', 'contenteditable', 'translate',
  // HL7 CDA structural codes (classCode="PAT", codeSystem="2.16.156...")
  'classcode', 'moodcode', 'typecode', 'determinercode', 'codesystem', 'codesystemname', 'codesystemversion', 'nullflavor', 'use', 'unit', 'mediatype', 'representation', 'contextcontrolcode', 'contextconductionind', 'negationind', 'inversionind', 'operator', 'inclusive', 'qualifier'])
// Values that cannot identify anyone: short numbers and measures, colors, flags.
const TRIVIAL_VALUE = /^(?:[-+]?\d{1,5}(?:\.\d+)?(?:%|px|pt|em|rem|cm|mm|in)?|#[0-9a-f]{3,8}|true|false|yes|no|on|off|none|auto)$/i
// Values that look like an identifier wherever they appear.
const IDENTIFYING_VALUE = /[\u4e00-\u9fff]|\d{6,}|@/
// Attributes named for an identifier hold one whatever its length: the CDA
// id slot (<id root="…" extension="12345"/>), mrn="54321", inpatientNo,
// patient_id, cardNumber, phone, ...
const IDENTIFIER_ATTRS = new Set(['extension', 'mrn', 'ssn', 'mpi', 'empi', 'barcode'])
const IDENTIFIER_ATTR_NAME = /(?:id|no|num|number|nbr|phone|tel|mobile|fax)$/

function attrExposed(name, value) {
  if (!value.trim()) return false
  if (TEXT_ATTRS.has(name) || name.startsWith('data-')) return true
  if (IDENTIFYING_VALUE.test(value)) return true
  const local = name.replace(/^.*:/, '')
  if (IDENTIFIER_ATTRS.has(local) || (local !== 'id' && IDENTIFIER_ATTR_NAME.test(local))) return true
  if (STRUCTURAL_ATTRS.has(name) || /^(?:xmlns|xsi:|xml:)/.test(name)) return false
  return !TRIVIAL_VALUE.test(value.trim())
}

/**
 * HTML / XML: text between tags, comments, script bodies and text-bearing
 * attribute values become parts; tags and structure stay verbatim. data:
 * URIs in attributes are unwrapped (images become opaque).
 */
function decodeMarkup(text) {
  const head = text.trimStart().slice(0, 300).toLowerCase()
  if (!/^(?:\ufeff)?\s*</.test(text)) return null
  const tagCount = (text.match(/<\/?[a-zA-Z][\w:.-]*[\s/>]/g) ?? []).length
  if (tagCount < 2) return null
  if (!/^<(?:\?xml|!doctype|!--|[a-zA-Z])/.test(head.replace(/^\ufeff/, ''))) return null
  const template = []
  const parts = []
  let sepNext = '\n'
  const pushText = (raw, decoded, kind, field, wrapped = false) => {
    template.push({ part: parts.length, raw, kind })
    parts.push({ text: decoded, sep: sepNext, field, raw: true, wrapped })
    if (!wrapped) sepNext = ''
  }
  const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/?[a-zA-Z][\w:.-]*(?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?)*\s*\/?>/g
  let cursor = 0
  let match
  let rawTextUntil = null
  while ((match = tagRe.exec(text))) {
    const token = match[0]
    if (rawTextUntil) {
      if (!new RegExp(`^</${rawTextUntil}\\s*>`, 'i').test(token)) continue
    }
    if (match.index > cursor) {
      const raw = text.slice(cursor, match.index)
      if (rawTextUntil === 'style') template.push({ fixed: raw })
      else if (rawTextUntil === 'script') { if (raw.trim()) pushText(raw, raw, 'script', '<script>'); else template.push({ fixed: raw }) }
      else if (raw.trim()) pushText(raw, decodeEntities(raw), 'text', null)
      else template.push({ fixed: raw })
    }
    rawTextUntil = null
    cursor = match.index + token.length
    if (token.startsWith('<!--')) {
      const body = token.slice(4, -3)
      if (body.trim()) {
        template.push({ fixed: '<!--' })
        sepNext = '\n'
        pushText(body, body, 'comment', '<!--注释-->')
        template.push({ fixed: '-->' })
      } else template.push({ fixed: token })
      sepNext = '\n'
      continue
    }
    if (token.startsWith('<![CDATA[')) {
      template.push({ fixed: '<![CDATA[' })
      sepNext = '\n'
      pushText(token.slice(9, -3), token.slice(9, -3), 'cdata', null)
      template.push({ fixed: ']]>' })
      continue
    }
    if (token.startsWith('<!') || token.startsWith('<?')) { template.push({ fixed: token }); continue }
    const name = /^<\/?([a-zA-Z][\w:.-]*)/.exec(token)[1].toLowerCase()
    const closing = token.startsWith('</')
    // Line breaks at block elements and at the end of non-inline custom
    // elements (<cell>…</cell>); inline tags keep the text flowing.
    if (BLOCK_TAGS.has(name) || (closing && !INLINE_TAGS.has(name))) sepNext = '\n'
    if (!closing && (name === 'script' || name === 'style') && !token.endsWith('/>')) rawTextUntil = name
    // Attributes: copy verbatim except values that may identify someone
    // (see attrExposed) and data: URIs.
    const attrRe = /(\s+)([^\s=/>]+)(\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]*))/g
    let attrCursor = 0
    let attr
    const tagStart = template.length
    while ((attr = attrRe.exec(token))) {
      const attrName = attr[2].toLowerCase()
      const quote = attr[5] !== undefined ? '"' : attr[6] !== undefined ? "'" : ''
      const rawValue = attr[5] ?? attr[6] ?? attr[7] ?? ''
      const valueStart = attr.index + attr[1].length + attr[2].length + attr[3].length + quote.length
      const exposedIf = (value) => attrExposed(attrName, value) || /^\s*data:/i.test(value)
      const textual = attrExposed(attrName, rawValue)
      const dataUri = /^\s*data:/i.test(rawValue)
      if (!textual && !dataUri) continue
      if (!rawValue) continue
      template.push({ fixed: token.slice(attrCursor, valueStart) })
      if (dataUri) {
        template.push({ part: parts.length, raw: rawValue, kind: 'attr-raw' })
        parts.push({ text: decodeEntities(rawValue), sep: '\n', field: `@${attrName}`, raw: true, wrapped: true, exposedIf })
      } else {
        // Attribute values are read on their own, not inside the text flow.
        pushText(rawValue, decodeEntities(rawValue), quote === "'" ? 'attr1' : quote ? 'attr' : 'attr0', `@${attrName}`, true)
        parts[parts.length - 1].exposedIf = exposedIf
      }
      attrCursor = valueStart + rawValue.length
    }
    if (template.length > tagStart) template.push({ fixed: token.slice(attrCursor) })
    else template.push({ fixed: token })
  }
  if (cursor < text.length) {
    const raw = text.slice(cursor)
    if (raw.trim() && !rawTextUntil) pushText(raw, decodeEntities(raw), 'text', null)
    else template.push({ fixed: raw })
  }
  if (parts.length === 0) return null
  const escapeText = (value) => escapeAmp(value).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return {
    type: 'markup', label: head.includes('<html') || head.includes('<!doctype html') ? 'html' : 'xml',
    parts: parts.map(({ text: partText, sep, field, wrapped, exposedIf }) => ({ text: partText, sep, field, wrapped: Boolean(wrapped), exposedIf })),
    encode: (texts, changed) => template.map((item) => {
      if (item.fixed !== undefined) return item.fixed
      if (!changed[item.part]) return item.raw
      const next = texts[item.part]
      if (item.kind === 'script' || item.kind === 'comment' || item.kind === 'cdata') return next
      if (item.kind === 'attr') return escapeText(next).replace(/"/g, '&quot;')
      if (item.kind === 'attr1') return escapeText(next).replace(/'/g, '&#39;')
      if (item.kind === 'attr0') {
        // Unquoted value: quoted once it holds anything that would end it.
        const value = escapeText(next).replace(/"/g, '&quot;')
        return /^[^\s"'=<>`]+$/.test(value) ? value : `"${value}"`
      }
      if (item.kind === 'attr-raw') return escapeAmp(next).replace(/"/g, '&quot;')
      return escapeText(next)
    }).join(''),
  }
}

/* ------------------------------------------------------------------ HL7 */

const HL7_HINTS = {
  'PID-2': '病历号', 'PID-3': '病历号', 'PID-4': '病历号', 'PID-5': '姓名', 'PID-6': '姓名', 'PID-9': '姓名',
  'PID-11': '地址', 'PID-13': '电话', 'PID-14': '电话', 'PID-18': '就诊号', 'PID-19': '社保号', 'PID-20': '身份证号',
  'NK1-2': '姓名', 'NK1-4': '地址', 'NK1-5': '电话', 'NK1-6': '电话',
  'PV1-7': '医生', 'PV1-8': '医生', 'PV1-9': '医生', 'PV1-17': '医生', 'PV1-19': '就诊号',
  'ORC-12': '医生', 'OBR-16': '医生', 'OBR-32': '医生', 'IN1-16': '姓名', 'GT1-3': '姓名', 'GT1-5': '地址', 'GT1-6': '电话',
}
// Birth dates: quasi-identifiers, handled by the date policy.
const HL7_QUASI = { 'PID-7': '日期', 'NK1-16': '日期', 'GT1-8': '日期', 'IN1-18': '日期' }
// All-digit components are exposed in fields that hold identifiers (hints
// above) and wherever they are long enough to be one (record numbers, phone
// and ID-card numbers, dates). Short counters, set ids and measurement
// values (OBX "120") stay in the template: they identify no one and would
// only add noise for the detectors.
const HL7_MIN_DIGITS = 6
const hl7Exposed = (comp) => comp !== '' && !(/^\d+$/.test(comp) && comp.length < HL7_MIN_DIGITS)

function decodeHl7(text) {
  if (!/^MSH[|^~\\&]{2}/.test(text)) return null
  const fieldSep = text[3]
  const compSep = text[4]
  const lines = text.split(/(\r\n|\r|\n)/)
  const parts = []
  const cells = []
  lines.forEach((line, lineIndex) => {
    if (lineIndex % 2 === 1 || !line) return
    const fields = line.split(fieldSep)
    const segName = fields[0]
    fields.forEach((field, fieldIndex) => {
      if (fieldIndex === 0) return
      const number = segName === 'MSH' ? fieldIndex + 1 : fieldIndex
      if (segName === 'MSH' && fieldIndex === 1) return
      field.split(compSep).forEach((comp, compIndex) => {
        if (!comp) return
        const name = `${segName}-${number}`
        const exposedIf = HL7_HINTS[name] || HL7_QUASI[name] ? nonEmpty : hl7Exposed
        if (!exposedIf(comp)) return
        cells.push({ lineIndex, fieldIndex, compIndex, part: parts.length })
        parts.push({ text: comp, field: `${name}.${compIndex + 1}`, hint: HL7_HINTS[name] ?? null, quasi: HL7_QUASI[name] ?? null, sep: '\n', exposedIf })
      })
    })
  })
  if (parts.length === 0) return null
  return {
    type: 'parts', label: 'hl7', parts,
    encode: (texts) => {
      const grid = lines.map((line, index) => (index % 2 === 1 || !line ? line : line.split(fieldSep).map((field) => field.split(compSep))))
      for (const cell of cells) grid[cell.lineIndex][cell.fieldIndex][cell.compIndex] = texts[cell.part]
      return grid.map((line) => (Array.isArray(line) ? line.map((field) => field.join(compSep)).join(fieldSep) : line)).join('')
    },
  }
}

function decodeRtf(text) {
  if (!/^\{\\rtf/.test(text)) return null
  return { opaque: 'RTF 文档', bytes: text.length, label: 'rtf' }
}

const DECODERS = [decodeDataUri, decodeRtf, decodeHl7, decodeMarkup, decodeJsonString, decodeBase64, decodeHex, decodeUrl, decodeUnicodeEscapes, decodeEntityText, decodeMojibake]

/* ------------------------------------------------------------ inline runs */

const RUN_RE = /data:[\w.+-]+\/[\w.+-]+(?:;[\w-]+=[^;,\s]*)*;base64,[A-Za-z0-9+/=\r\n]+|[A-Za-z0-9+/_-]{120,}={0,2}/g

/** Text with long encoded runs inside: plain pieces and runs as parts. */
function splitInline(text) {
  // A base64 data: URI is a run at any length (a removed payload leaves a
  // short placeholder URI that must read as the same run again).
  if (text.length < RUN_MIN && !/data:[\w.+-]+\/[\w.+-]+[^,\s]*;base64,/.test(text)) return null
  const parts = []
  let cursor = 0
  let match
  RUN_RE.lastIndex = 0
  while ((match = RUN_RE.exec(text))) {
    // A data: URI run may swallow the line break after it; that break
    // belongs to the surrounding text.
    const run = match[0].replace(/[\r\n]+$/, '')
    if (!run.startsWith('data:') && !(/\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run))) continue
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), sep: '', flowLeaf: true })
    parts.push({ text: run, sep: '', run: true })
    cursor = match.index + run.length
  }
  if (!parts.some((part) => part.run)) return null
  if (cursor < text.length) parts.push({ text: text.slice(cursor), sep: '', flowLeaf: true })
  return { type: 'parts', label: 'inline', parts, encode: (texts) => texts.join('') }
}

/* --------------------------------------------------------------- explode */

const nonEmpty = (value) => value !== ''

/**
 * Some decoders expose a part only for some values (a short number in a
 * structural attribute or an unhinted HL7 component, an empty string). A
 * leaf made from such a part keeps the rule, so a processed value that falls
 * in the hidden class ("1980-01-01" generalized to "1980") is expected to be
 * left in the template when the value is decoded again. A contextual leaf
 * (a short JSON number exposed for its key) may or may not show again
 * while it is unchanged; the re-decode check leaves it out on both sides.
 */
function withExposure(node, part) {
  if (node.leaf && part.exposedIf) node.exposedIf = part.exposedIf
  if (node.leaf && part.keyName) node.keyName = true
  if (node.leaf && part.contextual) node.contextual = true
  return node
}

/**
 * Value → tree. Node kinds:
 *  leaf    { leaf, text, orig, field, hint, sep }
 *  opaque  { opaque, kind, bytes, raw, image }
 *  token   { token, raw }                    short undecodable blob
 *  wrap    { children, encode, raw, label }
 */
export function explode(text, depth = 0, meta = {}) {
  if (depth < MAX_DEPTH && text.length >= 8) {
    for (const decoder of DECODERS) {
      let result
      try { result = decoder(text) } catch { result = null }
      if (!result) continue
      if (result.token) return { token: true, raw: text, label: result.label }
      if (result.opaque) return { opaque: true, kind: result.opaque, bytes: result.bytes ?? text.length, raw: text, image: Boolean(result.image), label: result.label, field: meta.field }
      if (result.type === 'markup') {
        // Text between tags reads as one flowing text, so "姓名：" in one span
        // and the name in the next are seen together. Edits map back to the
        // part they fall in; an edit across a tag boundary is refused.
        const flowIndex = []
        const wrappedIndex = []
        const pre = new Map()
        result.parts.forEach((part, index) => {
          // A text node that is itself encoded (a base64 blob between tags)
          // is unwrapped on its own instead of read as text.
          if (!part.wrapped && part.text.length >= 40 && !/\s/.test(part.text.trim())) {
            const sub = explode(part.text.trim() === part.text ? part.text : part.text, depth + 1, { field: part.field ?? meta.field, sep: '\n' })
            if (!sub.leaf) { pre.set(index, sub); wrappedIndex.push(index); return }
          }
          ;(part.wrapped ? wrappedIndex : flowIndex).push(index)
        })
        const flowParts = flowIndex.map((index, k) => ({ text: result.parts[index].text, orig: result.parts[index].text, sep: k === 0 ? '' : result.parts[index].sep }))
        const joined = flowParts.map((part) => part.sep + part.text).join('')
        const flow = { leaf: true, flow: true, parts: flowParts, text: joined, orig: joined, field: meta.field ?? null, hint: null, sep: meta.sep ?? '\n' }
        const wrapped = wrappedIndex.map((index) => pre.get(index) ?? withExposure(explode(result.parts[index].text, depth + 1, { field: result.parts[index].field ?? meta.field, sep: '\n' }), result.parts[index]))
        return { children: [flow, ...wrapped], markup: { flowIndex, wrappedIndex, count: result.parts.length }, encode: result.encode, raw: text, label: result.label }
      }
      if (result.type === 'text') {
        const child = explode(result.text, depth + 1, meta)
        return { children: [child], encode: (texts) => result.encode(texts[0]), raw: text, label: result.label }
      }
      const children = result.parts.map((part) => withExposure(explode(part.text, depth + 1, {
        field: part.field ?? meta.field, hint: part.hint ?? null, quasi: part.quasi ?? null, sep: part.sep ?? '\n',
      }), part))
      return { children, encode: result.encode, raw: text, label: result.label }
    }
    const inline = splitInline(text)
    if (inline) {
      const children = inline.parts.map((part) => (part.run
        ? explodeRun(part.text, depth + 1, meta)
        : { leaf: true, text: part.text, orig: part.text, field: meta.field, hint: null, sep: '' }))
      return { children, encode: inline.encode, raw: text, label: 'inline' }
    }
  }
  return { leaf: true, text, orig: text, field: meta.field ?? null, hint: meta.hint ?? null, quasi: meta.quasi ?? null, sep: meta.sep ?? '\n' }
}

/** An encoded run inside text: decoded when possible, otherwise opaque. */
function explodeRun(run, depth, meta) {
  const node = explode(run, depth, meta)
  if (node.leaf) return { opaque: true, kind: '无法解读的编码串', bytes: run.length, raw: run, label: 'inline', field: meta.field }
  return node
}

/** Leaves, opaque and token nodes in document order. */
function collect(node, out = { leaves: [], opaque: [], tokens: [] }, via = []) {
  if (node.leaf) out.leaves.push({ node, via: via.join('›') })
  else if (node.opaque) out.opaque.push({ node, via: [...via, node.label].filter(Boolean).join('›') })
  else if (node.token) out.tokens.push({ node, via: [...via, node.label].join('›') })
  else for (const child of node.children) collect(child, out, [...via, node.label])
  return out
}

/** Current text of a node; unchanged subtrees return their raw text. */
function render(node) {
  if (node.leaf) return node.text
  if (node.opaque || node.token) return node.replacement ?? node.raw
  if (node.markup) {
    const { flowIndex, wrappedIndex, count } = node.markup
    const texts = new Array(count)
    const changed = new Array(count).fill(false)
    const flow = node.children[0]
    flowIndex.forEach((index, k) => { texts[index] = flow.parts[k].text; changed[index] = flow.parts[k].text !== flow.parts[k].orig })
    wrappedIndex.forEach((index, k) => { const child = node.children[k + 1]; texts[index] = render(child); changed[index] = texts[index] !== rawOf(child) })
    if (!changed.some(Boolean)) return node.raw
    return node.encode(texts, changed)
  }
  const texts = node.children.map(render)
  const changed = node.children.map((child, index) => texts[index] !== rawOf(child))
  if (!changed.some(Boolean)) return node.raw
  return node.encode(texts, changed)
}
function rawOf(node) {
  return node.leaf ? node.orig : node.raw
}

/** Split a leaf into pieces of at most `limit` chars at natural boundaries. */
function splitPieces(text, limit = PIECE_CHARS) {
  if (text.length <= limit) return [text]
  const pieces = []
  let rest = text
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let cut = -1
    for (const pattern of [/\n/g, /[。！？；]/g, /[，、,;]/g, /\s/g]) {
      let m
      let last = -1
      pattern.lastIndex = 0
      while ((m = pattern.exec(window))) last = m.index
      if (last > limit * 0.5) { cut = last + 1; break }
    }
    if (cut < 0) cut = limit
    pieces.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest) pieces.push(rest)
  return pieces
}

/**
 * Apply an edit of a flowing markup leaf to its parts. An edit inside one
 * part changes that part; one spanning inline tags ("[" + name + "]" in
 * three elements) puts the replacement in the first part and removes the
 * covered text from the others. An edit across a line break between blocks
 * is refused (it would merge separate elements) and stays a finding.
 */
function applyToFlow(leaf, start, end, replacement) {
  let position = 0
  const hits = []
  for (const part of leaf.parts) {
    const sepStart = position
    const partStart = position + part.sep.length
    const partEnd = partStart + part.text.length
    if (hits.length > 0 && start < partStart && end > sepStart && part.sep.length > 0) return false
    if (end > partStart && start < partEnd) hits.push({ part, from: Math.max(start, partStart) - partStart, to: Math.min(end, partEnd) - partStart })
    else if (start === end && start >= partStart && start <= partEnd) hits.push({ part, from: start - partStart, to: start - partStart })
    position = partEnd
    if (position >= end && hits.length > 0) break
  }
  if (hits.length === 0) return false
  const covered = hits.reduce((sum, hit) => sum + (hit.to - hit.from), 0)
  if (covered !== end - start) return false
  hits.forEach((hit, index) => {
    hit.part.text = hit.part.text.slice(0, hit.from) + (index === 0 ? replacement : '') + hit.part.text.slice(hit.to)
  })
  return true
}

/**
 * Differences between two versions of a value as replacements of the old
 * one, at most one per line: a line break shared by both versions is never
 * inside a replacement. Falls back to one replacement when the number of
 * line breaks changed.
 */
function changedRegions(current, next) {
  let start = 0
  while (start < current.length && start < next.length && current[start] === next[start]) start += 1
  let endA = current.length
  let endB = next.length
  while (endA > start && endB > start && current[endA - 1] === next[endB - 1]) { endA -= 1; endB -= 1 }
  const before = current.slice(start, endA).split('\n')
  const after = next.slice(start, endB).split('\n')
  if (before.length !== after.length) return [widen(current, { start, end: endA, original: current.slice(start, endA), replacement: next.slice(start, endB) })]
  const regions = []
  let position = start
  before.forEach((line, index) => {
    const other = after[index]
    if (line !== other) {
      let head = 0
      while (head < line.length && head < other.length && line[head] === other[head]) head += 1
      let tail = 0
      while (tail < line.length - head && tail < other.length - head && line[line.length - 1 - tail] === other[other.length - 1 - tail]) tail += 1
      regions.push(widen(current, { start: position + head, end: position + line.length - tail, original: line.slice(head, line.length - tail), replacement: other.slice(head, other.length - tail) }))
    }
    position += line.length + 1
  })
  return regions
}

/**
 * A pure insertion or deletion is widened by one unchanged neighbouring
 * character on the same line: base formats skip empty ranges, and the
 * reverse of a deletion would be one.
 */
function widen(current, region) {
  if (region.original && region.replacement) return region
  const { start, end } = region
  if (start > 0 && current[start - 1] !== '\n') {
    const ch = current[start - 1]
    return { start: start - 1, end, original: ch + region.original, replacement: ch + region.replacement }
  }
  if (end < current.length && current[end] !== '\n') {
    const ch = current[end]
    return { start, end: end + 1, original: region.original + ch, replacement: region.replacement + ch }
  }
  return region
}

const TRANSPARENT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/**
 * Placeholder for a removed opaque payload. A data: URI stays a data: URI
 * (a 1x1 transparent PNG for images, one zero byte otherwise) so the text
 * around it reads the same when the value is decoded again; line breaks
 * inside the payload are kept right after the comma, inside the URI, so the
 * value keeps its line count and the breaks stay part of the run. Anything
 * else is removed.
 */
function opaquePlaceholder(node) {
  if (!/^data:/i.test(node.raw)) return ''
  const breaks = (node.raw.match(/\r?\n/g) ?? []).join('')
  return node.image ? `data:image/png;base64,${breaks}${TRANSPARENT_PNG}` : `data:application/octet-stream;base64,${breaks}AA==`
}

/* -------------------------------------------------------------- layered */

/**
 * Wrap a format document. Values that need no unwrapping and fit in one
 * piece pass through unchanged (same ids, hints and behavior as before).
 */
export function layered(base) {
  const virtual = new Map() // base id → { root, pieces: [{ id, leaf, index }] }
  const pieceById = new Map()
  let initial = null

  function build() {
    virtual.clear()
    pieceById.clear()
    for (const segment of base.segments()) {
      if (base.kind === 'text' && segment.text.length <= PIECE_CHARS && !/[A-Za-z0-9+/]{120}|data:|%[0-9A-F]{2}.*%[0-9A-F]{2}.*%[0-9A-F]{2}|\\u[0-9a-f]{4}/i.test(segment.text)) continue
      const root = explode(segment.text, 0, { field: segment.field ?? null, hint: segment.hint ?? null, quasi: segment.quasi ?? null })
      if (root.leaf && segment.text.length <= PIECE_CHARS) continue
      const found = collect(root)
      const entry = { base: segment, root, leaves: found.leaves.map((item) => item.node), opaque: found.opaque, tokens: found.tokens, pieces: [] }
      // Each leaf is cut once into fixed pieces; replacements change piece
      // texts but never the cut, so segment ids stay stable.
      let n = 0
      for (const { node, via } of found.leaves) {
        node.pieces = splitPieces(node.text)
        node.via = via
        node.pieces.forEach((_, index) => {
          const id = `${segment.id}~${n}`
          n += 1
          const piece = { id, entry, leaf: node, index }
          entry.pieces.push(piece)
          pieceById.set(id, piece)
        })
      }
      virtual.set(segment.id, entry)
    }
  }
  build()

  const baseText = (id) => base.segments().find((segment) => segment.id === id)?.text

  /** Layer state of an entry, to restore it when a write-back is refused. */
  function snapshot(entry) {
    return {
      leaves: entry.leaves.map((leaf) => ({ leaf, text: leaf.text, pieces: [...leaf.pieces], parts: leaf.flow ? leaf.parts.map((part) => part.text) : null })),
      opaque: entry.opaque.map(({ node }) => ({ node, replacement: node.replacement })),
    }
  }
  function restore(state) {
    for (const item of state.leaves) {
      item.leaf.text = item.text
      item.leaf.pieces = item.pieces
      if (item.parts) item.leaf.parts.forEach((part, index) => { part.text = item.parts[index] })
    }
    for (const item of state.opaque) {
      if (item.replacement === undefined) delete item.node.replacement
      else item.node.replacement = item.replacement
    }
  }

  /**
   * Write the entry's rendered value back to the base document: one base
   * replacement per changed line, so no replacement crosses a line break
   * (text chunks refuse those). All or nothing: if any part is refused, the
   * parts already written are reverted and false is returned.
   */
  function sync(entry) {
    for (const leaf of entry.leaves) leaf.text = leaf.pieces.join('')
    let next
    try { next = render(entry.root) } catch { return false }
    const id = entry.base.id
    // A base value emptied by an earlier write-back is no longer listed.
    const current = baseText(id) ?? ''
    if (current === next) return true
    const regions = changedRegions(current, next).sort((a, b) => b.start - a.start)
    const done = []
    const revert = () => {
      for (const region of done.reverse()) {
        base.apply([{ id, start: region.start, end: region.start + region.replacement.length, original: region.replacement, replacement: region.original }])
      }
    }
    for (const region of regions) {
      if (base.apply([{ id, ...region }]) !== 1) { revert(); return false }
      done.push(region)
    }
    if ((baseText(id) ?? '') !== next) { revert(); return false }
    return true
  }

  const doc = {
    kind: base.kind,
    relPath: base.relPath,
    bytes: base.bytes,
    notices: base.notices ?? [],
    sheetCount: base.sheetCount,
    /**
     * Field labels whose source text (sheet name, header, JSON key) was
     * replaced, including keys of JSON documents embedded in a value.
     */
    renamedFields() {
      const out = [...(base.renamedFields?.() ?? [])]
      for (const entry of virtual.values()) {
        for (const leaf of entry.leaves) {
          if (leaf.keyName && leaf.text !== leaf.orig) out.push([leaf.orig, leaf.text])
        }
      }
      return out
    },
    segments() {
      const out = []
      for (const segment of base.segments()) {
        const entry = virtual.get(segment.id)
        if (!entry) { out.push(segment); continue }
        for (const piece of entry.pieces) {
          const leaf = piece.leaf
          out.push({
            id: piece.id,
            text: leaf.pieces[piece.index],
            hint: leaf.pieces.length === 1 ? leaf.hint : null,
            quasi: leaf.pieces.length === 1 ? leaf.quasi ?? null : null,
            field: leaf.field ?? segment.field,
            via: leaf.via || undefined,
          })
        }
      }
      return out
    },
    apply(replacements) {
      const passthrough = []
      const touched = new Set()
      const byPiece = new Map()
      for (const replacement of replacements) {
        const piece = pieceById.get(replacement.id)
        if (!piece) { passthrough.push(replacement); continue }
        if (!byPiece.has(piece)) byPiece.set(piece, [])
        byPiece.get(piece).push(replacement)
      }
      let applied = passthrough.length ? base.apply(passthrough) : 0
      const saved = new Map()
      for (const [piece, list] of byPiece) {
        list.sort((a, b) => b.start - a.start)
        if (!saved.has(piece.entry)) saved.set(piece.entry, snapshot(piece.entry))
        let text = piece.leaf.pieces[piece.index]
        let limit = Infinity
        let count = 0
        const leaf = piece.leaf
        const offset = leaf.pieces.slice(0, piece.index).reduce((sum, part) => sum + part.length, 0)
        for (const replacement of list) {
          if (replacement.end > limit) continue
          if (text.slice(replacement.start, replacement.end) !== replacement.original) continue
          if (leaf.flow && !applyToFlow(leaf, offset + replacement.start, offset + replacement.end, replacement.replacement)) continue
          text = text.slice(0, replacement.start) + replacement.replacement + text.slice(replacement.end)
          limit = replacement.start
          count += 1
        }
        if (count === 0) continue
        piece.leaf.pieces[piece.index] = text
        touched.add(piece.entry)
        applied += count
      }
      // Every entry is written back on its own. A refused one is restored in
      // the layer, so the layer never shows replacements the file lacks.
      const failed = []
      for (const entry of touched) {
        if (sync(entry)) continue
        restore(saved.get(entry))
        failed.push(entry.base.field ?? entry.base.id)
      }
      if (failed.length > 0) throw new Error(`字段 ${failed.join('、')} 写回编码内容失败`)
      return applied
    },
    serialize() {
      return base.serialize()
    },
    structure() {
      const result = base.structure()
      // Every unwrapped value must decode again to exactly the processed text.
      let ok = true
      let detail = '编码内容可重新解码'
      for (const entry of virtual.values()) {
        const current = base.segments().find((segment) => segment.id === entry.base.id)?.text
        if (current === undefined) continue
        // Unchanged contextual leaves are left out on both sides (see
        // withExposure); a replaced one is written as a string and shows.
        const again = collect(explode(current, 0, { field: entry.base.field })).leaves.filter((item) => !item.node.contextual).map((item) => item.node.text)
        const now = entry.leaves
          .filter((leaf) => !(leaf.contextual && leaf.pieces.join('') === leaf.orig))
          .map((leaf) => ({ leaf, text: leaf.pieces.join('') }))
          .filter(({ leaf, text }) => !leaf.exposedIf || leaf.exposedIf(text))
          .map(({ text }) => text)
        if (again.length !== now.length || again.some((text, index) => text !== now[index])) {
          ok = false
          detail = `字段 ${entry.base.field ?? entry.base.id} 写回后无法还原为处理后的内容`
          break
        }
      }
      if (virtual.size === 0) return result
      return { ok: result.ok && ok, checks: [...result.checks, { name: '编码还原', ok, detail }] }
    },
    /** Content that could not be turned into text. */
    opaque() {
      const out = []
      for (const entry of virtual.values()) {
        for (const { node, via } of entry.opaque) {
          out.push({ id: entry.base.id, field: node.field ?? entry.base.field ?? null, kind: node.kind, bytes: node.bytes, via, image: node.image, removed: node.replacement !== undefined })
        }
      }
      return out
    },
    /** Short undecodable blobs (hashes, tokens, ciphertext) per field. */
    tokens() {
      const counts = new Map()
      for (const entry of virtual.values()) {
        for (const { node } of entry.tokens) {
          const field = entry.base.field ?? '正文'
          counts.set(field, (counts.get(field) ?? 0) + 1)
          void node
        }
      }
      return [...counts].map(([field, count]) => ({ field, count }))
    },
    /** Replace opaque payloads (all, or those of matching base ids) with a placeholder. */
    removeOpaque(only = null) {
      let removed = 0
      const failed = []
      for (const entry of virtual.values()) {
        if (only && !only(entry.base.id)) continue
        const saved = snapshot(entry)
        let count = 0
        for (const { node } of entry.opaque) {
          if (node.replacement !== undefined) continue
          node.replacement = opaquePlaceholder(node)
          count += 1
        }
        if (count === 0) continue
        if (sync(entry)) { removed += count; continue }
        restore(saved)
        failed.push(entry.base.field ?? entry.base.id)
      }
      if (failed.length > 0) throw new Error(`字段 ${failed.join('、')} 移除内容失败`)
      return removed
    },
    /** Inspection coverage in characters. */
    coverage() {
      let total = 0
      let inspected = 0
      let decoded = 0
      let opaqueCount = 0
      let opaqueBytes = 0
      let tokenCount = 0
      for (const segment of base.segments()) {
        total += segment.text.length
        const entry = virtual.get(segment.id)
        if (!entry) { inspected += segment.text.length; continue }
        const leafChars = entry.leaves.reduce((sum, leaf) => sum + leaf.pieces.join('').length, 0)
        inspected += leafChars
        if (!entry.root.leaf) decoded += leafChars
        opaqueCount += entry.opaque.length
        opaqueBytes += entry.opaque.reduce((sum, item) => sum + (item.node.bytes ?? 0), 0)
        tokenCount += entry.tokens.length
      }
      return { total, inspected, decoded, opaque: opaqueCount, opaqueBytes, tokens: tokenCount }
    },
    /**
     * Stable per-leaf texts for side-by-side comparison: keys depend only on
     * the value's structure, not on piece cuts.
     */
    leaves() {
      if (base.kind === 'text') {
        return [{ key: 'body', field: null, via: '', text: doc.segments().map((segment) => segment.text).join('') }]
      }
      const out = []
      for (const segment of base.segments()) {
        const entry = virtual.get(segment.id)
        if (!entry) { out.push({ key: segment.id, field: segment.field ?? null, via: '', text: segment.text }); continue }
        entry.leaves.forEach((leaf, index) => out.push({ key: `${segment.id}#${index}`, field: leaf.field ?? segment.field ?? null, via: leaf.via ?? '', text: leaf.pieces.join('') }))
      }
      return out
    },
  }
  initial = doc.coverage()
  void initial
  return doc
}
