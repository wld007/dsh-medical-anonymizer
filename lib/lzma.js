/**
 * LZMA "alone" streams (the .lzma format of the 7-Zip SDK: 13-byte header,
 * then the range-coded data). Some EMR systems store documents this way,
 * base64-encoded inside XML.
 *
 * decode: the full LZMA algorithm (after the reference LzmaSpec decoder).
 * encode: greedy matches over a hash chain, no rep matches — valid for every
 * LZMA decoder, a little larger than what 7-Zip writes. Same props byte and
 * dictionary size as the original header; the uncompressed size is always
 * written.
 */

const PROB_INIT = 1024
const TOP = 2 ** 24
const MAX_OUTPUT = 64 * 1024 * 1024

export class LzmaError extends Error {}

/** Header fields, or null when the bytes cannot be an LZMA-alone stream. */
export function lzmaHeader(bytes) {
  if (!bytes || bytes.length < 14) return null
  const props = bytes[0]
  if (props >= 9 * 5 * 5) return null
  const dictSize = bytes.readUInt32LE(1)
  // Real encoders write 2^n or 2^n + 2^(n-1), at least 4 KB.
  if (dictSize < 4096 || dictSize > 2 ** 30) return null
  const lo = bytes.readUInt32LE(5)
  const hi = bytes.readUInt32LE(9)
  const unknown = lo === 0xffffffff && hi === 0xffffffff
  if (!unknown && (hi !== 0 || lo === 0 || lo > MAX_OUTPUT)) return null
  // The range coder's first byte is always 0.
  if (bytes[13] !== 0) return null
  const lc = props % 9
  const lp = Math.floor(props / 9) % 5
  const pb = Math.floor(props / 45)
  return { props, lc, lp, pb, dictSize, size: unknown ? null : lo }
}

function probs(n) {
  return new Uint16Array(n).fill(PROB_INIT)
}

/** Decode an LZMA-alone stream; throws LzmaError when it is not one. */
export function lzmaDecode(bytes, { maxOutput = MAX_OUTPUT } = {}) {
  const header = lzmaHeader(bytes)
  if (!header) throw new LzmaError('not an LZMA stream')
  const { lc, lp, pb, dictSize, size } = header
  const limit = size ?? maxOutput
  if (limit > maxOutput) throw new LzmaError('too large')

  // Range decoder.
  let inPos = 13
  const next = () => {
    if (inPos >= bytes.length) throw new LzmaError('truncated')
    return bytes[inPos++]
  }
  next() // the leading 0
  let range = 0xffffffff
  let code = 0
  for (let i = 0; i < 4; i += 1) code = ((code * 256) + next()) >>> 0
  if (code === range) throw new LzmaError('corrupted')
  const normalize = () => {
    if (range < TOP) {
      range = (range * 256) >>> 0
      code = ((code * 256) + next()) >>> 0
    }
  }
  const bit = (p, i) => {
    const prob = p[i]
    const bound = (range >>> 11) * prob
    let b
    if (code < bound) {
      p[i] = prob + ((2048 - prob) >>> 5)
      range = bound
      b = 0
    } else {
      p[i] = prob - (prob >>> 5)
      code -= bound
      range -= bound
      b = 1
    }
    normalize()
    return b
  }
  const direct = (n) => {
    let res = 0
    for (let i = 0; i < n; i += 1) {
      range >>>= 1
      let b = 0
      if (code >= range) { code -= range; b = 1 }
      normalize()
      res = res * 2 + b
    }
    return res
  }
  const tree = (p, base, n) => {
    let m = 1
    for (let i = 0; i < n; i += 1) m = (m << 1) + bit(p, base + m)
    return m - (1 << n)
  }
  const reverse = (p, base, n) => {
    let m = 1
    let sym = 0
    for (let i = 0; i < n; i += 1) {
      const b = bit(p, base + m)
      m = (m << 1) + b
      sym |= b << i
    }
    return sym
  }

  // Models.
  const literal = probs(0x300 << (lc + lp))
  const isMatch = probs(12 << 4)
  const isRep = probs(12)
  const isRepG0 = probs(12)
  const isRepG1 = probs(12)
  const isRepG2 = probs(12)
  const isRep0Long = probs(12 << 4)
  const posSlot = probs(4 << 6)
  const posDecoders = probs(1 + 114)
  const align = probs(1 << 4)
  const lenModel = () => ({ choice: probs(2), low: probs(16 << 3), mid: probs(16 << 3), high: probs(256) })
  const lenDec = lenModel()
  const repLenDec = lenModel()
  const decodeLen = (m, posState) => {
    if (bit(m.choice, 0) === 0) return tree(m.low, posState << 3, 3)
    if (bit(m.choice, 1) === 0) return 8 + tree(m.mid, posState << 3, 3)
    return 16 + tree(m.high, 0, 8)
  }
  const decodeDistance = (len) => {
    const lenState = Math.min(len, 3)
    const slot = tree(posSlot, lenState << 6, 6)
    if (slot < 4) return slot
    const numDirect = (slot >>> 1) - 1
    let dist = (2 | (slot & 1)) * 2 ** numDirect
    if (slot < 14) return dist + reverse(posDecoders, dist - slot, numDirect)
    dist += direct(numDirect - 4) * 16
    return dist + reverse(align, 0, 4)
  }

  // Output (the whole output is the dictionary).
  let out = Buffer.allocUnsafe(Math.min(limit, Math.max(1 << 16, bytes.length * 8)))
  let pos = 0
  const grow = (need) => {
    if (need <= out.length) return
    if (need > limit) throw new LzmaError('output exceeds declared size')
    const bigger = Buffer.allocUnsafe(Math.min(limit, Math.max(need, out.length * 2)))
    out.copy(bigger, 0, 0, pos)
    out = bigger
  }
  const pbMask = (1 << pb) - 1
  const lpMask = (1 << lp) - 1
  let state = 0
  let rep0 = 0
  let rep1 = 0
  let rep2 = 0
  let rep3 = 0
  for (;;) {
    if (size !== null && pos === size) break
    const posState = pos & pbMask
    if (bit(isMatch, (state << 4) + posState) === 0) {
      if (pos >= limit) throw new LzmaError('output exceeds declared size')
      const prev = pos > 0 ? out[pos - 1] : 0
      const base = 0x300 * (((pos & lpMask) << lc) + (prev >>> (8 - lc)))
      let symbol = 1
      if (state >= 7) {
        let matchByte = out[pos - rep0 - 1]
        do {
          const matchBit = (matchByte >>> 7) & 1
          matchByte = (matchByte << 1) & 0xff
          const b = bit(literal, base + ((1 + matchBit) << 8) + symbol)
          symbol = (symbol << 1) | b
          if (matchBit !== b) break
        } while (symbol < 0x100)
      }
      while (symbol < 0x100) symbol = (symbol << 1) | bit(literal, base + symbol)
      grow(pos + 1)
      out[pos++] = symbol - 0x100
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
      continue
    }
    let len
    if (bit(isRep, state) !== 0) {
      if (pos === 0) throw new LzmaError('corrupted')
      if (bit(isRepG0, state) === 0) {
        if (bit(isRep0Long, (state << 4) + posState) === 0) {
          state = state < 7 ? 9 : 11
          grow(pos + 1)
          out[pos] = out[pos - rep0 - 1]
          pos += 1
          continue
        }
      } else {
        let dist
        if (bit(isRepG1, state) === 0) dist = rep1
        else {
          if (bit(isRepG2, state) === 0) dist = rep2
          else { dist = rep3; rep3 = rep2 }
          rep2 = rep1
        }
        rep1 = rep0
        rep0 = dist
      }
      len = decodeLen(repLenDec, posState)
      state = state < 7 ? 8 : 11
    } else {
      rep3 = rep2
      rep2 = rep1
      rep1 = rep0
      len = decodeLen(lenDec, posState)
      state = state < 7 ? 7 : 10
      rep0 = decodeDistance(len)
      if (rep0 === 0xffffffff) break // end marker
      if (rep0 >= pos || rep0 >= dictSize) throw new LzmaError('corrupted')
    }
    len += 2
    if (pos + len > limit) throw new LzmaError('output exceeds declared size')
    grow(pos + len)
    for (let i = 0; i < len; i += 1) { out[pos] = out[pos - rep0 - 1]; pos += 1 }
  }
  if (size !== null && pos !== size) throw new LzmaError('truncated')
  return { data: out.subarray(0, pos), header }
}

/**
 * Encode as an LZMA-alone stream with the given props byte and dictionary
 * size. Greedy matching over a hash chain (plain matches only, no rep
 * matches): far simpler than a real LZMA encoder, compresses less, decodes
 * with every LZMA decoder.
 */
export function lzmaEncode(data, { props = 0x5d, dictSize = 1 << 20 } = {}) {
  const lc = props % 9
  const lp = Math.floor(props / 9) % 5
  const pb = Math.floor(props / 45)
  const chunks = []
  let chunk = Buffer.allocUnsafe(1 << 16)
  let used = 0
  const emit = (byte) => {
    if (used === chunk.length) { chunks.push(chunk); chunk = Buffer.allocUnsafe(1 << 16); used = 0 }
    chunk[used++] = byte
  }
  // Range encoder (low may carry into bit 32).
  let low = 0
  let range = 0xffffffff
  let cache = 0
  let cacheSize = 1
  const shiftLow = () => {
    const low32 = low % 2 ** 32
    const carry = low >= 2 ** 32 ? 1 : 0
    if (low32 < 0xff000000 || carry) {
      let temp = cache
      do {
        emit((temp + carry) & 0xff)
        temp = 0xff
      } while (--cacheSize !== 0)
      cache = (low32 >>> 24) & 0xff
    }
    cacheSize += 1
    low = (low32 % TOP) * 256
  }
  const encodeBit = (p, i, b) => {
    const prob = p[i]
    const bound = (range >>> 11) * prob
    if (b === 0) {
      range = bound
      p[i] = prob + ((2048 - prob) >>> 5)
    } else {
      low += bound
      range -= bound
      p[i] = prob - (prob >>> 5)
    }
    while (range < TOP) {
      range = (range * 256) >>> 0
      shiftLow()
    }
  }
  const encodeDirect = (value, n) => {
    for (let i = n - 1; i >= 0; i -= 1) {
      range >>>= 1
      if (Math.floor(value / 2 ** i) % 2) low += range
      while (range < TOP) {
        range = (range * 256) >>> 0
        shiftLow()
      }
    }
  }
  const tree = (p, base, n, symbol) => {
    let m = 1
    for (let i = n - 1; i >= 0; i -= 1) {
      const b = (symbol >>> i) & 1
      encodeBit(p, base + m, b)
      m = (m << 1) | b
    }
  }
  const reverse = (p, base, n, symbol) => {
    let m = 1
    for (let i = 0; i < n; i += 1) {
      const b = symbol & 1
      symbol >>>= 1
      encodeBit(p, base + m, b)
      m = (m << 1) | b
    }
  }

  // Models (the decoder's, same sizes).
  const literal = probs(0x300 << (lc + lp))
  const isMatch = probs(12 << 4)
  const isRep = probs(12)
  const posSlot = probs(4 << 6)
  const posEncoders = probs(1 + 114)
  const align = probs(1 << 4)
  const len = { choice: probs(2), low: probs(16 << 3), mid: probs(16 << 3), high: probs(256) }
  const encodeLen = (l, posState) => {
    if (l < 8) { encodeBit(len.choice, 0, 0); tree(len.low, posState << 3, 3, l); return }
    encodeBit(len.choice, 0, 1)
    if (l < 16) { encodeBit(len.choice, 1, 0); tree(len.mid, posState << 3, 3, l - 8); return }
    encodeBit(len.choice, 1, 1)
    tree(len.high, 0, 8, l - 16)
  }
  const encodeDistance = (dist, lenState) => {
    let slot
    if (dist < 4) slot = dist
    else {
      const n = 31 - Math.clz32(dist)
      slot = 2 * n + ((dist >>> (n - 1)) & 1)
    }
    tree(posSlot, lenState << 6, 6, slot)
    if (slot < 4) return
    const numDirect = (slot >>> 1) - 1
    const base = (2 | (slot & 1)) * 2 ** numDirect
    const reduced = dist - base
    if (slot < 14) { reverse(posEncoders, base - slot, numDirect, reduced); return }
    encodeDirect(Math.floor(reduced / 16), numDirect - 4)
    reverse(align, 0, 4, reduced & 15)
  }

  // Match finder: chains of positions with the same 3-byte prefix.
  const MIN = 3
  const MAX = 273
  const window = Math.min(dictSize, 1 << 22)
  const HASH = 1 << 16
  const head = new Int32Array(HASH).fill(-1)
  const prevPos = new Int32Array(data.length)
  const hash = (i) => ((data[i] << 8) ^ (data[i + 1] << 4) ^ data[i + 2] ^ (data[i + 2] << 11)) & (HASH - 1)
  const insert = (i) => {
    if (i + 2 >= data.length) return
    const h = hash(i)
    prevPos[i] = head[h]
    head[h] = i
  }
  const findMatch = (i) => {
    if (i + MIN > data.length) return null
    let best = 0
    let bestDist = 0
    const max = Math.min(MAX, data.length - i)
    let cand = head[hash(i)]
    for (let tries = 0; cand >= 0 && tries < 48; tries += 1) {
      const dist = i - cand - 1
      if (dist >= window) break
      if (data[cand + best] === data[i + best]) {
        let l = 0
        while (l < max && data[cand + l] === data[i + l]) l += 1
        if (l > best) { best = l; bestDist = dist; if (l === max) break }
      }
      cand = prevPos[cand]
    }
    // A short match far away costs more than its literals.
    if (best < MIN || (best === MIN && bestDist >= 1 << 12)) return null
    return { len: best, dist: bestDist }
  }

  const pbMask = (1 << pb) - 1
  const lpMask = (1 << lp) - 1
  let state = 0
  let rep0 = 0
  let pos = 0
  while (pos < data.length) {
    const posState = pos & pbMask
    const match = findMatch(pos)
    if (match) {
      encodeBit(isMatch, (state << 4) + posState, 1)
      encodeBit(isRep, state, 0)
      encodeLen(match.len - 2, posState)
      encodeDistance(match.dist, Math.min(match.len - 2, 3))
      rep0 = match.dist
      state = state < 7 ? 7 : 10
      for (let k = 0; k < match.len; k += 1) insert(pos + k)
      pos += match.len
      continue
    }
    encodeBit(isMatch, (state << 4) + posState, 0)
    const prev = pos > 0 ? data[pos - 1] : 0
    const base = 0x300 * (((pos & lpMask) << lc) + (prev >>> (8 - lc)))
    const byte = data[pos]
    let symbol = 1
    let i = 7
    if (state >= 7) {
      let matchByte = data[pos - rep0 - 1]
      for (; i >= 0; i -= 1) {
        const matchBit = (matchByte >>> 7) & 1
        matchByte = (matchByte << 1) & 0xff
        const b = (byte >>> i) & 1
        encodeBit(literal, base + ((1 + matchBit) << 8) + symbol, b)
        symbol = (symbol << 1) | b
        if (matchBit !== b) { i -= 1; break }
      }
    }
    for (; i >= 0; i -= 1) {
      const b = (byte >>> i) & 1
      encodeBit(literal, base + symbol, b)
      symbol = (symbol << 1) | b
    }
    state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
    insert(pos)
    pos += 1
  }
  for (let i = 0; i < 5; i += 1) shiftLow()
  chunks.push(chunk.subarray(0, used))
  const header = Buffer.alloc(13)
  header[0] = props
  header.writeUInt32LE(dictSize >>> 0, 1)
  header.writeUInt32LE(data.length >>> 0, 5)
  header.writeUInt32LE(Math.floor(data.length / 2 ** 32), 9)
  return Buffer.concat([header, ...chunks])
}
