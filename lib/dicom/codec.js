/**
 * Minimal DICOM Part 10 codec for header de-identification.
 *
 * Only what metadata anonymization needs: parse the file meta group and the
 * data set up to the top-level pixel data, keep every byte of the pixel data
 * untouched, and write the (modified) header back in the original transfer
 * syntax. Pixel data is never decoded; it is located and copied as a byte
 * range, so file size is not limited by memory.
 *
 * Supported: implicit VR little endian, explicit VR little endian, and every
 * encapsulated (compressed) syntax, whose data set is explicit VR LE.
 * Refused: explicit VR big endian (retired) and deflated data sets.
 */
import { open } from 'node:fs/promises'

export const TS_IMPLICIT_LE = '1.2.840.10008.1.2'
export const TS_EXPLICIT_LE = '1.2.840.10008.1.2.1'
const TS_EXPLICIT_BE = '1.2.840.10008.1.2.2'
const TS_DEFLATED = '1.2.840.10008.1.2.1.99'
const TS_DEFLATED_IMAGE_FRAME = '1.2.840.10008.1.2.8.1'

const LONG_VR = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT', 'SV', 'UV'])
const PIXEL_TAGS = new Set(['7FE00010', '7FE00008', '7FE00009'])
const UNDEFINED = 0xFFFFFFFF

export class NeedMore extends Error {}

/** True when the file carries the Part 10 "DICM" marker at offset 128. */
export async function sniffDicom(path) {
  let handle
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(132)
    const { bytesRead } = await handle.read(buffer, 0, 132, 0)
    return bytesRead === 132 && buffer.toString('latin1', 128, 132) === 'DICM'
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => {})
  }
}

export function tagKey(group, element) {
  return (group.toString(16).padStart(4, '0') + element.toString(16).padStart(4, '0')).toUpperCase()
}

/**
 * Parse elements from `buf` starting at `pos`.
 *
 * @param {object} ctx { buf, total, explicit, dict, stopAtPixel, stopWhen }
 *   `total` is the true size of the byte source; reading past `buf.length`
 *   while `buf.length < total` throws NeedMore so the caller can read more.
 * @returns {{ elements: object[], pos: number, stop: 'end'|'item'|'pixel'|'predicate' }}
 */
function parseElements(ctx, pos, end, explicit, depth) {
  const { buf } = ctx
  const elements = []
  while (pos < end) {
    if (end === Infinity && pos >= ctx.total) {
      if (depth === 0) return { elements, pos, stop: 'end' }
      throw new Error('序列未正常结束（文件被截断？）')
    }
    need(ctx, pos + 4)
    const group = buf.readUInt16LE(pos)
    const element = buf.readUInt16LE(pos + 2)
    if (group === 0xFFFE) {
      need(ctx, pos + 8)
      if (element === 0xE00D) return { elements, pos: pos + 8, stop: 'item' }
      throw new Error(`意外的分隔标记 (FFFE,${element.toString(16).toUpperCase()})`)
    }
    const tag = tagKey(group, element)
    if (ctx.stopWhen?.(group, element)) return { elements, pos, stop: 'predicate' }
    if (depth === 0 && ctx.stopAtPixel && PIXEL_TAGS.has(tag)) return { elements, pos, stop: 'pixel' }

    let vr
    let length
    let header
    if (explicit) {
      need(ctx, pos + 8)
      vr = buf.toString('latin1', pos + 4, pos + 6)
      if (!/^[A-Z]{2}$/.test(vr)) throw new Error(`(${tag}) VR 无效，文件可能损坏或与传输语法不符`)
      if (LONG_VR.has(vr)) {
        need(ctx, pos + 12)
        length = buf.readUInt32LE(pos + 8)
        header = 12
      } else {
        length = buf.readUInt16LE(pos + 6)
        header = 8
      }
    } else {
      need(ctx, pos + 8)
      length = buf.readUInt32LE(pos + 4)
      header = 8
      vr = ctx.dict(tag) ?? null
    }
    const valueStart = pos + header
    const el = { tag, group, element, vr }

    if (length === UNDEFINED) {
      if (vr === 'SQ' || vr === null || vr === 'UN') {
        // Explicit-VR "UN" with undefined length holds an implicit-VR LE sequence.
        el.childExplicit = vr === 'UN' ? false : explicit
        if (vr === null) el.vr = 'SQ'
        el.undef = true
        const parsed = parseSequence(ctx, valueStart, Infinity, el.childExplicit, depth)
        el.items = parsed.items
        pos = parsed.pos
      } else {
        // Encapsulated pixel data nested inside a sequence (e.g. an icon image).
        const endPos = skipFragments(ctx, valueStart)
        el.raw = buf.subarray(valueStart, endPos)
        pos = endPos
      }
    } else {
      need(ctx, valueStart + length)
      const looksSequence = vr === 'SQ'
        || (vr === null && length >= 8 && buf.readUInt16LE(valueStart) === 0xFFFE && buf.readUInt16LE(valueStart + 2) === 0xE000)
      if (looksSequence) {
        el.vr = 'SQ'
        el.childExplicit = explicit
        el.undef = false
        el.items = parseSequence(ctx, valueStart, valueStart + length, explicit, depth).items
      } else {
        el.value = buf.subarray(valueStart, valueStart + length)
        if (vr === null) {
          el.vr = 'UN'
          el.implicitUnknown = true
        }
      }
      pos = valueStart + length
    }
    elements.push(el)
  }
  return { elements, pos, stop: 'end' }
}

function parseSequence(ctx, pos, end, explicit, depth) {
  const { buf } = ctx
  const items = []
  while (pos < end) {
    need(ctx, pos + 8)
    const group = buf.readUInt16LE(pos)
    const element = buf.readUInt16LE(pos + 2)
    const length = buf.readUInt32LE(pos + 4)
    if (group === 0xFFFE && element === 0xE0DD) {
      pos += 8
      break
    }
    if (group !== 0xFFFE || element !== 0xE000) {
      throw new Error(`序列中出现非条目标记 (${tagKey(group, element)})`)
    }
    if (length === UNDEFINED) {
      const parsed = parseElements(ctx, pos + 8, Infinity, explicit, depth + 1)
      if (parsed.stop !== 'item') throw new Error('序列条目未正常结束')
      items.push({ elements: parsed.elements, undef: true })
      pos = parsed.pos
    } else {
      need(ctx, pos + 8 + length)
      const parsed = parseElements(ctx, pos + 8, pos + 8 + length, explicit, depth + 1)
      items.push({ elements: parsed.elements, undef: false })
      pos = pos + 8 + length
    }
  }
  return { items, pos }
}

function skipFragments(ctx, pos) {
  const { buf } = ctx
  for (;;) {
    need(ctx, pos + 8)
    const group = buf.readUInt16LE(pos)
    const element = buf.readUInt16LE(pos + 2)
    const length = buf.readUInt32LE(pos + 4)
    if (group !== 0xFFFE) throw new Error('封装像素数据格式错误')
    if (element === 0xE0DD) return pos + 8
    if (element !== 0xE000 || length === UNDEFINED) throw new Error('封装像素数据格式错误')
    need(ctx, pos + 8 + length)
    pos += 8 + length
  }
}

function need(ctx, upto) {
  if (upto <= ctx.buf.length) return
  if (ctx.buf.length < ctx.total) throw new NeedMore()
  throw new Error('文件被截断或格式损坏')
}

/** Read the first `length` bytes (or the whole file). */
async function readHead(handle, length) {
  const buffer = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset)
}

async function readRange(handle, start, length) {
  const buffer = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset)
    if (bytesRead === 0) throw new Error('文件被截断')
    offset += bytesRead
  }
  return buffer
}

/**
 * Read a DICOM file's meta group and data set. Pixel data is located, not read.
 *
 * @returns {Promise<{
 *   meta: object[], dataset: object[], tail: object[],
 *   transferSyntax: string, explicit: boolean,
 *   pixel: null | { start: number, end: number },
 *   size: number,
 * }>}
 */
export async function readDicom(path, { maxHeaderBytes = 64 * 1024 * 1024, dict = () => null, headerOnly = false, firstChunk = 1024 * 1024 } = {}) {
  const handle = await open(path, 'r')
  try {
    const size = (await handle.stat()).size
    if (size < 132) throw new Error('不是有效的 DICOM 文件（过短）')
    let chunk = Math.min(size, firstChunk)
    for (;;) {
      const buf = await readHead(handle, chunk)
      try {
        // headerOnly: meta group and data set only (no pixel walk, no tail).
        if (headerOnly) return { ...parseHeader(buf, size, dict), tail: [], pixel: null, size }
        return await parseBuffer(buf, size, handle, dict)
      } catch (error) {
        if (!(error instanceof NeedMore)) throw error
        if (chunk >= size) throw new Error('文件被截断或格式损坏')
        if (chunk >= maxHeaderBytes) throw new Error(`头部超过 ${Math.round(maxHeaderBytes / 1024 / 1024)} MB，已放弃`)
        chunk = Math.min(size, chunk * 4, maxHeaderBytes)
      }
    }
  } finally {
    await handle.close()
  }
}

/** Parse an in-memory Part 10 buffer (used to verify freshly written headers). */
export function parseDicomBuffer(buf, { dict = () => null } = {}) {
  return parseHeader(buf, buf.length, dict)
}

function parseHeader(buf, total, dict) {
  if (buf.length < 132 || buf.toString('latin1', 128, 132) !== 'DICM') {
    throw new Error('缺少 DICM 标记，不是 DICOM Part 10 文件')
  }
  const metaCtx = { buf, total, dict, stopWhen: (group) => group !== 0x0002 }
  const meta = parseElements(metaCtx, 132, Infinity, true, 0)
  const tsElement = meta.elements.find((el) => el.tag === '00020010')
  const transferSyntax = tsElement ? decodeAscii(tsElement.value) : ''
  if (!transferSyntax) throw new Error('缺少传输语法 (0002,0010)')
  if (transferSyntax === TS_EXPLICIT_BE) throw new Error('不支持显式 VR 大端传输语法（已废弃）')
  if (transferSyntax === TS_DEFLATED || transferSyntax === TS_DEFLATED_IMAGE_FRAME) {
    throw new Error('不支持 Deflate 压缩的数据集')
  }
  let explicit = transferSyntax !== TS_IMPLICIT_LE
  // Some writers declare explicit VR but encode the data set implicitly (and
  // vice versa). Decide from the first element, as other toolkits do; the
  // file is written back in the encoding it actually uses.
  let vrMismatch = false
  if (meta.pos + 6 <= buf.length) {
    const looksExplicit = /^[A-Z]{2}$/.test(buf.toString('latin1', meta.pos + 4, meta.pos + 6))
    if (looksExplicit !== explicit) {
      explicit = looksExplicit
      vrMismatch = true
    }
  }
  const ctx = { buf, total, dict, stopAtPixel: true }
  const body = parseElements(ctx, meta.pos, Infinity, explicit, 0)
  return {
    meta: meta.elements, dataset: body.elements, bodyEnd: body.pos, stop: body.stop, transferSyntax, explicit, vrMismatch,
  }
}

async function parseBuffer(buf, size, handle, dict) {
  const parsed = parseHeader(buf, size, dict)
  const result = {
    meta: parsed.meta,
    dataset: parsed.dataset,
    tail: [],
    transferSyntax: parsed.transferSyntax,
    explicit: parsed.explicit,
    vrMismatch: parsed.vrMismatch,
    pixel: null,
    size,
  }
  if (parsed.stop !== 'pixel') return result

  // Locate the end of the pixel data element without reading its value.
  const start = parsed.bodyEnd
  const head = await readRange(handle, start, Math.min(12, size - start))
  if (head.length < 8) throw new Error('像素数据头部被截断')
  let length
  let valueStart
  if (parsed.explicit) {
    const vr = head.toString('latin1', 4, 6)
    if (LONG_VR.has(vr)) {
      if (head.length < 12) throw new Error('像素数据头部被截断')
      length = head.readUInt32LE(8)
      valueStart = start + 12
    } else {
      length = head.readUInt16LE(6)
      valueStart = start + 8
    }
  } else {
    length = head.readUInt32LE(4)
    valueStart = start + 8
  }
  let end
  if (length === UNDEFINED) {
    let pos = valueStart
    for (;;) {
      const item = await readRange(handle, pos, 8)
      const group = item.readUInt16LE(0)
      const element = item.readUInt16LE(2)
      const itemLength = item.readUInt32LE(4)
      if (group !== 0xFFFE) throw new Error('封装像素数据格式错误')
      if (element === 0xE0DD) { end = pos + 8; break }
      if (element !== 0xE000 || itemLength === UNDEFINED) throw new Error('封装像素数据格式错误')
      pos += 8 + itemLength
      if (pos > size) throw new Error('像素数据被截断')
    }
  } else {
    end = valueStart + length
    if (end > size) throw new Error('像素数据被截断')
  }
  result.pixel = { start, end }
  // Elements after the pixel data (padding, signatures) are small; parse them.
  if (end < size) {
    const tailLength = size - end
    if (tailLength > 64 * 1024 * 1024) throw new Error('像素数据之后的内容过大')
    const tailBuf = await readRange(handle, end, tailLength)
    const tailCtx = { buf: tailBuf, total: tailBuf.length, dict, stopAtPixel: false }
    result.tail = parseElements(tailCtx, 0, Infinity, parsed.explicit, 0).elements
  }
  return result
}

/* ---------------------------------------------------------------- writer */

function tagBytes(el) {
  const out = Buffer.alloc(4)
  out.writeUInt16LE(el.group, 0)
  out.writeUInt16LE(el.element, 2)
  return out
}

function u32(value) {
  const out = Buffer.alloc(4)
  out.writeUInt32LE(value >>> 0, 0)
  return out
}

function itemHeader(element, length) {
  const out = Buffer.alloc(8)
  out.writeUInt16LE(0xFFFE, 0)
  out.writeUInt16LE(element, 2)
  out.writeUInt32LE(length >>> 0, 4)
  return out
}

function padValue(el) {
  const value = el.value ?? Buffer.alloc(0)
  if (value.length % 2 === 0) return value
  const pad = el.vr === 'UI' || el.vr === 'OB' || el.vr === 'UN' ? 0x00 : 0x20
  return Buffer.concat([value, Buffer.from([pad])])
}

export function encodeElements(elements, explicit) {
  return Buffer.concat(elements.map((el) => encodeElement(el, explicit)))
}

function encodeElement(el, explicit) {
  let body
  let length
  if (el.items) {
    const childExplicit = el.childExplicit ?? explicit
    const parts = []
    for (const item of el.items) {
      const content = encodeElements(item.elements, childExplicit)
      if (item.undef) {
        parts.push(itemHeader(0xE000, UNDEFINED), content, itemHeader(0xE00D, 0))
      } else {
        parts.push(itemHeader(0xE000, content.length), content)
      }
    }
    if (el.undef) parts.push(itemHeader(0xE0DD, 0))
    body = Buffer.concat(parts)
    length = el.undef ? UNDEFINED : body.length
  } else if (el.raw) {
    body = el.raw
    length = UNDEFINED
  } else {
    body = padValue(el)
    length = body.length
  }
  if (!explicit) return Buffer.concat([tagBytes(el), u32(length), body])
  const vr = el.vr && el.vr.length === 2 ? el.vr : 'UN'
  if (LONG_VR.has(vr)) {
    return Buffer.concat([tagBytes(el), Buffer.from(vr, 'latin1'), Buffer.alloc(2), u32(length), body])
  }
  if (length > 0xFFFF) throw new Error(`(${el.tag}) 值过长，无法以 ${vr} 写回`)
  const header = Buffer.alloc(8)
  header.writeUInt16LE(el.group, 0)
  header.writeUInt16LE(el.element, 2)
  header.write(vr, 4, 'latin1')
  header.writeUInt16LE(length, 6)
  return Buffer.concat([header, body])
}

/**
 * Build preamble + meta group (with recomputed group length) + data set.
 * The data set is written in the original transfer syntax.
 */
export function encodeHeader({ meta, dataset, explicit }) {
  const metaBody = encodeElements(meta.filter((el) => el.tag !== '00020000'), true)
  const groupLength = {
    tag: '00020000', group: 0x0002, element: 0x0000, vr: 'UL', value: u32(metaBody.length),
  }
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from('DICM', 'latin1'),
    encodeElement(groupLength, true),
    metaBody,
    encodeElements(dataset, explicit),
  ])
}

/* ---------------------------------------------------------------- values */

export function decodeAscii(value) {
  if (!value) return ''
  return value.toString('latin1').replace(/[\0 ]+$/, '').trim()
}

export function stringValue(el, text) {
  return { ...el, value: Buffer.from(text, 'latin1'), items: undefined, raw: undefined }
}

const DECODERS = new Map()
function decoder(label) {
  if (!DECODERS.has(label)) {
    try {
      DECODERS.set(label, new TextDecoder(label, { fatal: false }))
    } catch {
      DECODERS.set(label, null)
    }
  }
  return DECODERS.get(label)
}

/**
 * Map Specific Character Set (0008,0005) to a decoder. Only used to read text
 * for scanning: every value this tool writes is ASCII, so nothing is ever
 * re-encoded and the character set never changes.
 */
export function charsetDecoder(specific) {
  const terms = String(specific ?? '').split('\\').map((term) => term.trim().toUpperCase()).filter(Boolean)
  const has = (name) => terms.includes(name)
  if (has('ISO_IR 192')) return { decode: (buf) => decoder('utf-8').decode(buf), known: true }
  if (has('GB18030')) return { decode: (buf) => decoder('gb18030').decode(buf), known: true }
  if (has('GBK')) return { decode: (buf) => decoder('gbk').decode(buf), known: true }
  if (has('ISO 2022 IR 58')) {
    // GB2312 designated through escape sequences: drop the escapes; the
    // remaining high-bit bytes are EUC-CN, which GBK decodes.
    return { decode: (buf) => decoder('gbk').decode(stripEscapes(buf)), known: true }
  }
  if (has('ISO 2022 IR 87') || has('ISO 2022 IR 159')) {
    return { decode: (buf) => decoder('iso-2022-jp')?.decode(buf) ?? buf.toString('latin1'), known: true }
  }
  if (has('ISO_IR 149') || has('ISO 2022 IR 149')) {
    return { decode: (buf) => decoder('euc-kr').decode(stripEscapes(buf)), known: true }
  }
  const singleByte = terms.every((term) => /^(?:ISO_IR|ISO 2022 IR) (?:6|100|101|109|110|144|127|126|138|148|13|166|203)$/.test(term))
  return { decode: (buf) => buf.toString('latin1'), known: terms.length === 0 || singleByte }
}

function stripEscapes(buf) {
  const out = []
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x1B) {
      i += 1
      while (i < buf.length && buf[i] >= 0x20 && buf[i] <= 0x2F) i += 1
      continue // final byte consumed by the loop increment
    }
    out.push(buf[i])
  }
  return Buffer.from(out)
}
