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
import { hintForJsonKey, hintForSibling } from './formats.js'

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
  return { type: 'text', label: 'data-uri›url', text: decoded, encode: (next) => head + encodeURIComponent(next) }
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

// Values mixing raw characters with escapes are decoded too (a name could
// hide in either part). Re-encoding after a change escapes every non-ASCII
// character: the value decodes to the same text, only the style may differ.
function decodeUrl(text) {
  const hits = text.match(/%[0-9A-Fa-f]{2}/g)
  if (!hits || hits.length < 3) return null
  let decoded
  try { decoded = decodeURIComponent(text) } catch { return null }
  if (decoded === text) return null
  return { type: 'text', label: 'url', text: decoded, encode: (next) => next.replace(/[^\x20-\x7e]|%/gu, (ch) => encodeURIComponent(ch)) }
}

function decodeUnicodeEscapes(text) {
  const hits = text.match(/\\u[0-9a-fA-F]{4}/g)
  if (!hits || hits.length < 2) return null
  const decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  const upper = hits.some((hit) => /[A-F]/.test(hit))
  return {
    type: 'text', label: 'unicode-escape', text: decoded,
    encode: (next) => next.replace(/[^\x00-\x7e]/g, (ch) => {
      const hex = ch.charCodeAt(0).toString(16).padStart(4, '0')
      return `\\u${upper ? hex.toUpperCase() : hex}`
    }),
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
  return {
    type: 'text', label: 'html-entity', text: decoded,
    encode: (next) => next.replace(/&/g, '&amp;').replace(/[^\x00-\x7e]/gu, (ch) => (hexStyle ? `&#x${ch.codePointAt(0).toString(16)};` : `&#${ch.codePointAt(0)};`)),
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

/** A JSON document stored in a string. */
function decodeJsonString(text) {
  const value = text.trim()
  if (!/^[[{][\s\S]*[\]}]$/.test(value) || value.length < 8) return null
  let root
  try { root = JSON.parse(value) } catch { return null }
  if (!root || typeof root !== 'object') return null
  const lead = text.slice(0, text.indexOf(value))
  const tail = text.slice(text.indexOf(value) + value.length)
  const indentMatch = /\n( +|\t)["{\[]/.exec(value)
  const indent = indentMatch ? indentMatch[1] : 0
  const leaves = []
  const walk = (node, path, parent) => {
    if (typeof node === 'string') {
      if (!node) return
      const key = path[path.length - 1]
      const field = typeof key === 'string' ? key : [...path].reverse().find((item) => typeof item === 'string') ?? '(数组元素)'
      const hint = typeof key === 'string' ? (hintForJsonKey(parent, key) ?? hintForSibling(parent, key)) : null
      leaves.push({ path, text: node, field, hint })
    } else if (Array.isArray(node)) node.forEach((item, index) => walk(item, [...path, index], node))
    else if (node && typeof node === 'object') for (const [key, item] of Object.entries(node)) walk(item, [...path, key], node)
  }
  walk(root, [], null)
  if (leaves.length === 0) return null
  return {
    type: 'parts', label: 'json',
    parts: leaves.map((leaf) => ({ text: leaf.text, field: leaf.field, hint: leaf.hint, sep: '\n' })),
    encode: (texts) => {
      const copy = JSON.parse(value)
      leaves.forEach((leaf, index) => {
        let cursor = copy
        for (let i = 0; i < leaf.path.length - 1; i += 1) cursor = cursor[leaf.path[i]]
        cursor[leaf.path[leaf.path.length - 1]] = texts[index]
      })
      return lead + JSON.stringify(copy, null, indent) + tail
    },
  }
}

/* ---------------------------------------------------------------- markup */

const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'body', 'html', 'head', 'title', 'option', 'select', 'textarea', 'input', 'label', 'img', 'col', 'colgroup'])
const INLINE_TAGS = new Set(['span', 'b', 'i', 'u', 'em', 'strong', 'font', 'a', 'sub', 'sup', 'small', 'big', 'abbr', 'code', 's', 'strike', 'mark', 'q', 'cite', 'tt', 'kbd', 'var', 'del', 'ins', 'nobr', 'wbr'])
const TEXT_ATTRS = new Set(['title', 'alt', 'value', 'placeholder', 'label', 'content', 'summary', 'abbr', 'aria-label'])
const STRUCTURAL_ATTRS = new Set(['class', 'style', 'id', 'type', 'width', 'height', 'align', 'valign', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'xmlns', 'lang', 'dir', 'charset', 'http-equiv', 'rel', 'media', 'tabindex', 'role', 'target', 'method', 'action', 'size', 'maxlength', 'checked', 'selected', 'disabled', 'readonly', 'span', 'face', 'color', 'bgcolor', 'frame', 'rules', 'scope', 'nowrap'])

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
    // Attributes: copy verbatim except text-bearing values and data: URIs.
    const attrRe = /(\s+)([^\s=/>]+)(\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]*))/g
    let attrCursor = 0
    let attr
    const tagStart = template.length
    while ((attr = attrRe.exec(token))) {
      const attrName = attr[2].toLowerCase()
      const quote = attr[5] !== undefined ? '"' : attr[6] !== undefined ? "'" : ''
      const rawValue = attr[5] ?? attr[6] ?? attr[7] ?? ''
      const valueStart = attr.index + attr[1].length + attr[2].length + attr[3].length + quote.length
      const textual = TEXT_ATTRS.has(attrName) || attrName.startsWith('data-') || (!STRUCTURAL_ATTRS.has(attrName) && /[\u4e00-\u9fff]/.test(rawValue))
      const dataUri = /^\s*data:/i.test(rawValue)
      if (!textual && !dataUri) continue
      if (!rawValue) continue
      template.push({ fixed: token.slice(attrCursor, valueStart) })
      if (dataUri) {
        template.push({ part: parts.length, raw: rawValue, kind: 'attr-raw' })
        parts.push({ text: decodeEntities(rawValue), sep: '\n', field: `@${attrName}`, raw: true, wrapped: true })
      } else {
        // Attribute values are read on their own, not inside the text flow.
        pushText(rawValue, decodeEntities(rawValue), quote === "'" ? 'attr1' : 'attr', `@${attrName}`, true)
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
    parts: parts.map(({ text: partText, sep, field, wrapped }) => ({ text: partText, sep, field, wrapped: Boolean(wrapped) })),
    encode: (texts, changed) => template.map((item) => {
      if (item.fixed !== undefined) return item.fixed
      if (!changed[item.part]) return item.raw
      const next = texts[item.part]
      if (item.kind === 'script' || item.kind === 'comment' || item.kind === 'cdata') return next
      if (item.kind === 'attr') return escapeText(next).replace(/"/g, '&quot;')
      if (item.kind === 'attr1') return escapeText(next).replace(/'/g, '&#39;')
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
        if (!comp || /^\d+$/.test(comp)) return
        const name = `${segName}-${number}`
        cells.push({ lineIndex, fieldIndex, compIndex, part: parts.length })
        parts.push({ text: comp, field: `${name}.${compIndex + 1}`, hint: HL7_HINTS[name] ?? null, sep: '\n' })
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
  if (text.length < RUN_MIN) return null
  const parts = []
  let cursor = 0
  let match
  RUN_RE.lastIndex = 0
  while ((match = RUN_RE.exec(text))) {
    const run = match[0]
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
        const wrapped = wrappedIndex.map((index) => pre.get(index) ?? explode(result.parts[index].text, depth + 1, { field: result.parts[index].field ?? meta.field, sep: '\n' }))
        return { children: [flow, ...wrapped], markup: { flowIndex, wrappedIndex, count: result.parts.length }, encode: result.encode, raw: text, label: result.label }
      }
      if (result.type === 'text') {
        const child = explode(result.text, depth + 1, meta)
        return { children: [child], encode: (texts) => result.encode(texts[0]), raw: text, label: result.label }
      }
      const children = result.parts.map((part) => explode(part.text, depth + 1, {
        field: part.field ?? meta.field, hint: part.hint ?? null, sep: part.sep ?? '\n',
      }))
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
  return { leaf: true, text, orig: text, field: meta.field ?? null, hint: meta.hint ?? null, sep: meta.sep ?? '\n' }
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

const TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

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
      const root = explode(segment.text, 0, { field: segment.field ?? null, hint: segment.hint ?? null })
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

  function sync(entry) {
    for (const leaf of entry.leaves) leaf.text = leaf.pieces.join('')
    const next = render(entry.root)
    const current = base.segments().find((segment) => segment.id === entry.base.id)?.text
    if (current === undefined || current === next) return true
    let start = 0
    while (start < current.length && start < next.length && current[start] === next[start]) start += 1
    let endA = current.length
    let endB = next.length
    while (endA > start && endB > start && current[endA - 1] === next[endB - 1]) { endA -= 1; endB -= 1 }
    return base.apply([{ id: entry.base.id, start, end: endA, original: current.slice(start, endA), replacement: next.slice(start, endB) }]) === 1
  }

  const doc = {
    kind: base.kind,
    relPath: base.relPath,
    bytes: base.bytes,
    sheetCount: base.sheetCount,
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
            quasi: null,
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
      for (const [piece, list] of byPiece) {
        list.sort((a, b) => b.start - a.start)
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
      for (const entry of touched) {
        if (!sync(entry)) {
          // The base format refused the rewritten value: undo in the layer.
          for (const leaf of entry.leaves) leaf.pieces = splitPieces(leaf.text === leaf.orig ? leaf.orig : leaf.text)
          throw new Error(`字段 ${entry.base.field ?? entry.base.id} 写回编码内容失败`)
        }
      }
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
        const again = collect(explode(current, 0, { field: entry.base.field })).leaves.map((item) => item.node.text)
        const now = entry.leaves.map((leaf) => leaf.pieces.join(''))
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
      for (const entry of virtual.values()) {
        if (only && !only(entry.base.id)) continue
        let changed = false
        for (const { node } of entry.opaque) {
          if (node.replacement !== undefined) continue
          node.replacement = node.image && /^data:/i.test(node.raw) ? TRANSPARENT_PNG : ''
          changed = true
          removed += 1
        }
        if (changed && !sync(entry)) throw new Error(`字段 ${entry.base.field ?? entry.base.id} 移除内容失败`)
      }
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
