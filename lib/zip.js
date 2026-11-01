/**
 * Self-contained zip codec built on node:zlib — no third-party dependencies.
 *
 * Reading is defensive because archives come from outside: names are checked
 * for zip-slip, sizes and ratios are bounded before any byte is inflated, the
 * inflater itself is capped with maxOutputLength, and every entry's CRC-32 is
 * verified. Names without the UTF-8 flag (typical of zips made on Chinese
 * Windows) are decoded as GBK when they are not valid UTF-8.
 *
 * Nested zips are not expanded here; a nested .zip is just another entry.
 */
import { open, readdir, stat, readFile, mkdir, writeFile, rename, unlink, realpath } from 'node:fs/promises'
import { join, resolve, dirname, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import zlib from 'node:zlib'

const inflateRawAsync = promisify(zlib.inflateRaw)
const deflateRawAsync = promisify(zlib.deflateRaw)

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_Z64_EOCD = 0x06064b50
const SIG_Z64_LOCATOR = 0x07064b50

const MAX16 = 0xffff
const MAX32 = 0xffffffff
const MiB = 1024 * 1024
/** Entries at or below this size are (de)compressed synchronously; the thread-pool round trip costs more. */
const SYNC_THRESHOLD = 64 * 1024

const FLAG_ENCRYPTED = 0x0001
const FLAG_UTF8 = 0x0800

const EXTRA_ZIP64 = 0x0001
const EXTRA_TIMESTAMP = 0x5455
const EXTRA_UNICODE_PATH = 0x7075

export const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 20000,
  maxTotalBytes: 2 * 1024 * MiB,
  maxEntryBytes: 500 * MiB,
  maxRatio: 1000,
})

/** @param {string} path */
export function isZipPath(path) {
  return /\.zip$/i.test(String(path))
}

// ---------------------------------------------------------------------------
// CRC-32
// ---------------------------------------------------------------------------

let crcTable = null

function tableCrc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** zlib.crc32 exists from Node 20.15 / 22.2; older runtimes use the table. */
export const crc32 = typeof zlib.crc32 === 'function' ? (buf) => zlib.crc32(buf) >>> 0 : tableCrc32

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function u64(buf, offset) {
  const value = buf.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('zip 文件无效：ZIP64 字段数值超出范围')
  return Number(value)
}

/** Split an extra-field block into a Map of headerId → data. Malformed tails are ignored. */
function parseExtra(buf) {
  const fields = new Map()
  let p = 0
  while (p + 4 <= buf.length) {
    const id = buf.readUInt16LE(p)
    const len = buf.readUInt16LE(p + 2)
    if (p + 4 + len > buf.length) break
    if (!fields.has(id)) fields.set(id, buf.subarray(p + 4, p + 4 + len))
    p += 4 + len
  }
  return fields
}

/**
 * Normalize an archive path and reject anything that could escape the
 * extraction root. Returns '' for names that reduce to nothing (e.g. './').
 * @param {string} raw
 * @param {string} [label] name shown in error messages
 */
export function normalizeEntryName(raw, label = raw) {
  if (raw.includes('\0')) throw new Error(`zip 内文件名含有非法字符（NUL），已拒绝：${JSON.stringify(label)}`)
  const name = raw.replace(/\\/g, '/')
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new Error(`zip 内文件使用了绝对路径，已拒绝（防止路径穿越）：${label}`)
  }
  const isDirectory = name.endsWith('/')
  const parts = []
  for (const segment of name.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') throw new Error(`zip 内文件路径含有 ".."，已拒绝（防止路径穿越）：${label}`)
    parts.push(segment)
  }
  if (!parts.length) return ''
  return parts.join('/') + (isDirectory ? '/' : '')
}

function isJunk(name) {
  const parts = name.replace(/\/$/, '').split('/')
  return parts[0] === '__MACOSX' || parts[parts.length - 1] === '.DS_Store'
}

function isAscii(buf) {
  for (let i = 0; i < buf.length; i++) if (buf[i] >= 0x80) return false
  return true
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

function isValidUtf8(buf) {
  try {
    strictUtf8.decode(buf)
    return true
  } catch {
    return false
  }
}

let gbkDecoder
function decodeGbk(buf) {
  if (gbkDecoder === undefined) {
    try {
      gbkDecoder = new TextDecoder('gbk')
    } catch {
      gbkDecoder = null // Node built without full ICU.
    }
  }
  if (!gbkDecoder) throw new Error('当前 Node 运行时不支持 GBK 解码，无法读取非 UTF-8 文件名的 zip')
  return gbkDecoder.decode(buf)
}

/** DOS date/time (local time) → Date. Invalid stamps fall back to 1980-01-01. */
function fromDosTime(date, time) {
  const year = 1980 + (date >>> 9)
  const month = (date >>> 5) & 0x0f
  const day = date & 0x1f
  if (!month || !day) return new Date(1980, 0, 1)
  return new Date(year, month - 1, day, time >>> 11, (time >>> 5) & 0x3f, (time & 0x1f) * 2)
}

/** Date → DOS { date, time }, clamped to the representable 1980–2107 range. */
function toDosTime(d) {
  let year = d.getFullYear()
  if (Number.isNaN(year) || year < 1980) return { date: (1 << 5) | 1, time: 0 }
  if (year > 2107) year = 2107
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >>> 1),
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Positioned reader over an open file handle with bounds checking. */
function makeReader(fh, size) {
  return async (position, length) => {
    if (position < 0 || length < 0 || position + length > size) throw new Error('zip 文件已损坏或被截断（读取越界）')
    const buf = Buffer.allocUnsafe(length)
    let done = 0
    while (done < length) {
      const { bytesRead } = await fh.read(buf, done, length - done, position + done)
      if (!bytesRead) throw new Error('zip 文件已损坏或被截断')
      done += bytesRead
    }
    return buf
  }
}

/** Locate the (ZIP64) end-of-central-directory record. */
async function readEnd(read, size, warnings) {
  if (size < 22) throw new Error('zip 文件无效：文件过小，不是 zip 或已损坏')
  const tailLength = Math.min(size, 22 + MAX16)
  const tailStart = size - tailLength
  const tail = await read(tailStart, tailLength)
  // Search backwards; prefer a record whose comment length reaches exactly
  // to the end of the file, so a stray signature inside a comment is skipped.
  let found = -1
  let loose = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== SIG_EOCD) continue
    const end = i + 22 + tail.readUInt16LE(i + 20)
    if (end === tail.length) { found = i; break }
    if (end < tail.length && loose < 0) loose = i
  }
  if (found < 0 && loose >= 0) {
    found = loose
    warnings.push('zip 结尾含有多余数据，已忽略')
  }
  if (found < 0) throw new Error('zip 文件无效：找不到中央目录结束记录（不是 zip 或已损坏）')

  const eocdPos = tailStart + found
  const e = tail.subarray(found, found + 22)
  let disk = e.readUInt16LE(4)
  let cdDisk = e.readUInt16LE(6)
  let total = e.readUInt16LE(10)
  let cdSize = e.readUInt32LE(12)
  let cdOffset = e.readUInt32LE(16)
  let cdEnd = eocdPos

  if (eocdPos >= 20) {
    const loc = await read(eocdPos - 20, 20)
    if (loc.readUInt32LE(0) === SIG_Z64_LOCATOR) {
      const z64Pos = u64(loc, 8)
      const rec = await read(z64Pos, 56)
      if (rec.readUInt32LE(0) !== SIG_Z64_EOCD) throw new Error('zip 文件无效：ZIP64 结束记录损坏')
      disk = rec.readUInt32LE(16)
      cdDisk = rec.readUInt32LE(20)
      total = u64(rec, 32)
      cdSize = u64(rec, 40)
      cdOffset = u64(rec, 48)
      cdEnd = z64Pos
    }
  }
  if (disk !== 0 || cdDisk !== 0) throw new Error('不支持分卷 zip（多磁盘压缩包），请合并后再处理')

  // Data prepended to the archive (e.g. self-extractors) shifts every offset.
  let shift = cdEnd - cdSize - cdOffset
  if (shift < 0) throw new Error('zip 文件无效：中央目录位置不一致')
  if (shift > 0) warnings.push(`zip 开头含有 ${shift} 字节附加数据，已按偏移修正`)
  return { total, cdSize, cdOffset: cdOffset + shift, shift }
}

/** Parse central-directory records into raw entry descriptors. */
function parseCentral(cd, total, shift) {
  const records = []
  let p = 0
  for (let n = 0; n < total; n++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('zip 文件无效：中央目录记录损坏')
    const nameLength = cd.readUInt16LE(p + 28)
    const extraLength = cd.readUInt16LE(p + 30)
    const commentLength = cd.readUInt16LE(p + 32)
    const next = p + 46 + nameLength + extraLength + commentLength
    if (next > cd.length) throw new Error('zip 文件无效：中央目录记录越界')
    const rec = {
      flags: cd.readUInt16LE(p + 8),
      method: cd.readUInt16LE(p + 10),
      time: cd.readUInt16LE(p + 12),
      date: cd.readUInt16LE(p + 14),
      crc: cd.readUInt32LE(p + 16),
      compressedSize: cd.readUInt32LE(p + 20),
      size: cd.readUInt32LE(p + 24),
      disk: cd.readUInt16LE(p + 34),
      localOffset: cd.readUInt32LE(p + 42),
      nameBytes: cd.subarray(p + 46, p + 46 + nameLength),
      extra: parseExtra(cd.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength)),
    }
    // ZIP64 extra: only the fields saturated in the fixed header are present, in this order.
    const z64 = rec.extra.get(EXTRA_ZIP64)
    if (z64) {
      let q = 0
      const take = () => {
        if (q + 8 > z64.length) throw new Error('zip 文件无效：ZIP64 扩展字段过短')
        const v = u64(z64, q)
        q += 8
        return v
      }
      if (rec.size === MAX32) rec.size = take()
      if (rec.compressedSize === MAX32) rec.compressedSize = take()
      if (rec.localOffset === MAX32) rec.localOffset = take()
      if (rec.disk === MAX16 && q + 4 <= z64.length) rec.disk = z64.readUInt32LE(q)
    }
    if (rec.disk !== 0) throw new Error('不支持分卷 zip（多磁盘压缩包），请合并后再处理')
    rec.localOffset += shift
    records.push(rec)
    p = next
  }
  return records
}

/**
 * Decide each record's display name. Names without the UTF-8 flag are judged
 * archive-wide: if any of them is not valid UTF-8 the archive was written in
 * the legacy code page, so all its non-ASCII names are decoded as GBK (a short
 * GBK name can accidentally look like valid UTF-8).
 */
function decodeNames(records, warnings) {
  const legacy = []
  for (const rec of records) {
    if (rec.flags & FLAG_UTF8) {
      rec.rawName = rec.nameBytes.toString('utf8')
      rec.nameEncoding = 'utf8'
      continue
    }
    const unicode = rec.extra.get(EXTRA_UNICODE_PATH)
    if (unicode && unicode.length >= 5 && unicode[0] === 1) {
      if (unicode.readUInt32LE(1) === crc32(rec.nameBytes)) {
        rec.rawName = unicode.subarray(5).toString('utf8')
        rec.nameEncoding = 'utf8'
        continue
      }
      warnings.push('zip 内某文件的 Unicode 路径扩展字段校验不符，已改用原始文件名')
    }
    if (isAscii(rec.nameBytes)) {
      rec.rawName = rec.nameBytes.toString('latin1')
      rec.nameEncoding = 'ascii'
      continue
    }
    legacy.push(rec)
  }
  const gbk = legacy.some((rec) => !isValidUtf8(rec.nameBytes))
  for (const rec of legacy) {
    rec.rawName = gbk ? decodeGbk(rec.nameBytes) : rec.nameBytes.toString('utf8')
    rec.nameEncoding = gbk ? 'gbk' : 'utf8'
  }
}

function resolveLimits(limits) {
  const out = { ...DEFAULT_LIMITS }
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    const v = limits?.[key]
    if (v !== undefined && v !== null) {
      if (!(typeof v === 'number' && v > 0)) throw new Error(`zip 限制参数 ${key} 无效：${v}`)
      out[key] = v
    }
  }
  return out
}

function mtimeOf(rec) {
  // Info-ZIP extended timestamp (UTC seconds) is more precise than DOS time.
  const ts = rec.extra.get(EXTRA_TIMESTAMP)
  if (ts && ts.length >= 5 && ts[0] & 1) return new Date(ts.readUInt32LE(1) * 1000)
  return fromDosTime(rec.date, rec.time)
}

/** Inflate with a hard output cap so a bomb cannot allocate past the declared size. */
async function inflateCapped(body, size, name) {
  const options = { maxOutputLength: Math.max(1, size) }
  try {
    return body.length <= SYNC_THRESHOLD && size <= SYNC_THRESHOLD
      ? zlib.inflateRawSync(body, options)
      : await inflateRawAsync(body, options)
  } catch (err) {
    if (err?.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) {
      throw new Error(`zip 内文件 ${name} 解压后超过声明大小，疑似 zip 炸弹，已拒绝`)
    }
    throw new Error(`zip 内文件 ${name} 解压失败（数据损坏）：${err.message}`)
  }
}

/**
 * Read and verify every entry of a zip archive into memory.
 * @param {string} zipPath
 * @param {{maxEntries?: number, maxTotalBytes?: number, maxEntryBytes?: number, maxRatio?: number}} [limits]
 * @returns {Promise<{entries: Array<{name: string, isDirectory: boolean, data?: Buffer, mtime: Date,
 *   nameEncoding: 'utf8'|'gbk'|'ascii'}>, warnings: string[]}>}
 */
export async function readZip(zipPath, limits = {}) {
  const lim = resolveLimits(limits)
  const warnings = []
  const fh = await open(zipPath, 'r')
  try {
    const { size: fileSize } = await fh.stat()
    const read = makeReader(fh, fileSize)
    const end = await readEnd(read, fileSize, warnings)
    if (end.total > lim.maxEntries) {
      throw new Error(`zip 内条目数 ${end.total} 超过上限 ${lim.maxEntries}（疑似 zip 炸弹），已拒绝`)
    }
    if (end.cdSize > fileSize) throw new Error('zip 文件无效：中央目录大小超出文件')
    const records = parseCentral(await read(end.cdOffset, end.cdSize), end.total, end.shift)
    decodeNames(records, warnings)

    // Validate names, sizes and ratios for the whole archive before inflating anything.
    const selected = []
    const seen = new Set()
    const offsets = new Set()
    let declaredTotal = 0
    for (const rec of records) {
      const name = normalizeEntryName(rec.rawName)
      if (!name || isJunk(name)) continue
      const isDirectory = name.endsWith('/')
      const key = isDirectory ? name.slice(0, -1) : name
      if (seen.has(key)) throw new Error(`zip 内存在重复的文件名：${key}`)
      seen.add(key)
      rec.name = name
      rec.isDirectory = isDirectory
      selected.push(rec)
      if (isDirectory) {
        if (rec.size) warnings.push(`zip 内目录条目 ${name} 带有数据，已忽略`)
        continue
      }
      if (rec.flags & FLAG_ENCRYPTED) throw new Error(`zip 内文件 ${name} 已加密，暂不支持，请解密后重新打包`)
      if (rec.method !== 0 && rec.method !== 8) {
        throw new Error(`zip 内文件 ${name} 使用了不支持的压缩方式（method ${rec.method}），仅支持存储与 deflate`)
      }
      if (rec.size > lim.maxEntryBytes) {
        throw new Error(`zip 内文件 ${name} 解压后 ${rec.size} 字节，超过单文件上限 ${lim.maxEntryBytes} 字节`)
      }
      if (rec.size > MiB && rec.size / Math.max(1, rec.compressedSize) > lim.maxRatio) {
        throw new Error(`zip 内文件 ${name} 压缩比超过 ${lim.maxRatio}，疑似 zip 炸弹，已拒绝`)
      }
      if (rec.compressedSize > fileSize) throw new Error(`zip 内文件 ${name} 的压缩大小超出文件，zip 已损坏`)
      // Overlapping entries (several records sharing one local header) are a known bomb pattern.
      if (offsets.has(rec.localOffset)) throw new Error(`zip 内文件 ${name} 与其他条目共用数据，疑似 zip 炸弹，已拒绝`)
      offsets.add(rec.localOffset)
      declaredTotal += rec.size
      if (declaredTotal > lim.maxTotalBytes) {
        throw new Error(`zip 解压后总大小超过上限 ${lim.maxTotalBytes} 字节（疑似 zip 炸弹），已拒绝`)
      }
    }
    // A file "a" next to "a/b" cannot be extracted.
    const fileNames = new Set(selected.filter((r) => !r.isDirectory).map((r) => r.name))
    for (const key of seen) {
      const parts = key.split('/')
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('/')
        if (fileNames.has(parent)) throw new Error(`zip 内文件 ${parent} 与同名目录冲突`)
      }
    }

    const entries = []
    let actualTotal = 0
    for (const rec of selected) {
      const mtime = mtimeOf(rec)
      if (rec.isDirectory) {
        entries.push({ name: rec.name, isDirectory: true, mtime, nameEncoding: rec.nameEncoding })
        continue
      }
      const name = rec.name
      const local = await read(rec.localOffset, 30)
      if (local.readUInt32LE(0) !== SIG_LOCAL) throw new Error(`zip 内文件 ${name} 的本地头损坏`)
      const dataStart = rec.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
      const body = await read(dataStart, rec.compressedSize)
      let data
      if (rec.method === 0) {
        if (rec.compressedSize !== rec.size) throw new Error(`zip 内文件 ${name} 大小记录不一致，zip 已损坏`)
        data = body
      } else {
        data = await inflateCapped(body, rec.size, name)
      }
      if (data.length !== rec.size) throw new Error(`zip 内文件 ${name} 解压后大小与记录不符，zip 已损坏`)
      actualTotal += data.length
      if (actualTotal > lim.maxTotalBytes) {
        throw new Error(`zip 解压后总大小超过上限 ${lim.maxTotalBytes} 字节（疑似 zip 炸弹），已拒绝`)
      }
      if (crc32(data) !== rec.crc) throw new Error(`zip 内文件 ${name} CRC 校验失败，数据已损坏`)
      entries.push({ name, isDirectory: false, data, mtime, nameEncoding: rec.nameEncoding })
    }
    return { entries, warnings }
  } finally {
    await fh.close()
  }
}

/**
 * Extract a zip into destDir. Files are created exclusively (never overwriting
 * or following an existing path) with mode 0o600.
 * @param {string} zipPath
 * @param {string} destDir
 * @param {object} [limits] see readZip
 * @returns {Promise<{files: string[], warnings: string[]}>} relative '/'-separated paths of written files
 */
export async function extractZip(zipPath, destDir, limits) {
  const { entries, warnings } = await readZip(zipPath, limits)
  const root = resolve(destDir)
  await mkdir(root, { recursive: true })
  const realRoot = await realpath(root)
  const inside = (p, base) => p === base || p.startsWith(base.endsWith(sep) ? base : base + sep)
  const checkedDirs = new Set()
  const ensureDir = async (dir) => {
    if (checkedDirs.has(dir)) return
    await mkdir(dir, { recursive: true })
    // A pre-existing symlinked directory must not lead outside the root.
    if (!inside(await realpath(dir), realRoot)) throw new Error(`解压目标目录越界，已拒绝：${dir}`)
    checkedDirs.add(dir)
  }
  const files = []
  for (const entry of entries) {
    const rel = entry.name.replace(/\/$/, '')
    const target = resolve(root, ...rel.split('/'))
    if (!inside(target, root) || target === root) throw new Error(`zip 内文件 ${entry.name} 解压路径越界，已拒绝`)
    if (entry.isDirectory) {
      await ensureDir(target)
      continue
    }
    await ensureDir(dirname(target))
    await writeFile(target, entry.data, { mode: 0o600, flag: 'wx' })
    files.push(rel)
  }
  return { files, warnings }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function header(size, fill) {
  const buf = Buffer.alloc(size)
  fill(buf)
  return buf
}

/** Info-ZIP extended timestamp extra (mtime only, UTC seconds). */
function timestampExtra(mtime) {
  const secs = Math.max(0, Math.min(MAX32, Math.floor(mtime.getTime() / 1000) || 0))
  return header(9, (b) => {
    b.writeUInt16LE(EXTRA_TIMESTAMP, 0)
    b.writeUInt16LE(5, 2)
    b.writeUInt8(1, 4)
    b.writeUInt32LE(secs, 5)
  })
}

function zip64Extra(values) {
  return header(4 + values.length * 8, (b) => {
    b.writeUInt16LE(EXTRA_ZIP64, 0)
    b.writeUInt16LE(values.length * 8, 2)
    values.forEach((v, i) => b.writeBigUInt64LE(BigInt(v), 4 + i * 8))
  })
}

async function compress(data) {
  if (!data.length) return { method: 0, body: data }
  const deflated = data.length <= SYNC_THRESHOLD
    ? zlib.deflateRawSync(data, { level: 9 })
    : await deflateRawAsync(data, { level: 9 })
  return deflated.length < data.length ? { method: 8, body: deflated } : { method: 0, body: data }
}

/**
 * Core writer. Items supply data lazily so packDirectory holds one file at a time.
 * @param {string} zipPath
 * @param {Array<{name: string, mtime?: Date, load: () => Promise<Buffer>|Buffer}>} items
 */
async function writeItems(zipPath, items) {
  const names = new Set()
  const prepared = items.map((item) => {
    const name = normalizeEntryName(String(item.name ?? ''))
    if (!name || name.endsWith('/')) throw new Error(`zip 条目名无效：${JSON.stringify(item.name)}`)
    if (names.has(name)) throw new Error(`zip 条目名重复：${name}`)
    names.add(name)
    const mtime = item.mtime instanceof Date && !Number.isNaN(item.mtime.getTime()) ? item.mtime : new Date()
    return { name, mtime, load: item.load }
  })

  const tmpPath = `${zipPath}.tmp-${randomBytes(6).toString('hex')}`
  const fh = await open(tmpPath, 'wx', 0o600)
  let ok = false
  try {
    let offset = 0
    const write = async (buf) => {
      let done = 0
      while (done < buf.length) {
        const { bytesWritten } = await fh.write(buf, done, buf.length - done)
        done += bytesWritten
      }
      offset += buf.length
    }

    const central = []
    for (const item of prepared) {
      const data = await item.load()
      if (!Buffer.isBuffer(data)) throw new Error(`zip 条目 ${item.name} 的数据必须是 Buffer`)
      const crc = crc32(data)
      const { method, body } = await compress(data)
      const { date, time } = toDosTime(item.mtime)
      const nameBytes = Buffer.from(item.name, 'utf8')
      const localOffset = offset
      const z64Local = data.length >= MAX32 || body.length >= MAX32
      const ts = timestampExtra(item.mtime)
      // The local ZIP64 extra must carry both sizes when either overflows.
      const localExtra = z64Local ? Buffer.concat([zip64Extra([data.length, body.length]), ts]) : ts
      await write(header(30, (b) => {
        b.writeUInt32LE(SIG_LOCAL, 0)
        b.writeUInt16LE(z64Local ? 45 : 20, 4)
        b.writeUInt16LE(FLAG_UTF8, 6)
        b.writeUInt16LE(method, 8)
        b.writeUInt16LE(time, 10)
        b.writeUInt16LE(date, 12)
        b.writeUInt32LE(crc, 14)
        b.writeUInt32LE(z64Local ? MAX32 : body.length, 18)
        b.writeUInt32LE(z64Local ? MAX32 : data.length, 22)
        b.writeUInt16LE(nameBytes.length, 26)
        b.writeUInt16LE(localExtra.length, 28)
      }))
      await write(nameBytes)
      await write(localExtra)
      await write(body)

      const z64Values = []
      if (data.length >= MAX32) z64Values.push(data.length)
      if (body.length >= MAX32) z64Values.push(body.length)
      if (localOffset >= MAX32) z64Values.push(localOffset)
      const z64 = z64Values.length > 0
      const extra = z64 ? Buffer.concat([zip64Extra(z64Values), ts]) : ts
      central.push(header(46, (b) => {
        b.writeUInt32LE(SIG_CENTRAL, 0)
        b.writeUInt16LE((3 << 8) | (z64 ? 45 : 20), 4) // made by: Unix
        b.writeUInt16LE(z64 ? 45 : 20, 6)
        b.writeUInt16LE(FLAG_UTF8, 8)
        b.writeUInt16LE(method, 10)
        b.writeUInt16LE(time, 12)
        b.writeUInt16LE(date, 14)
        b.writeUInt32LE(crc, 16)
        b.writeUInt32LE(body.length >= MAX32 ? MAX32 : body.length, 20)
        b.writeUInt32LE(data.length >= MAX32 ? MAX32 : data.length, 24)
        b.writeUInt16LE(nameBytes.length, 28)
        b.writeUInt16LE(extra.length, 30)
        b.writeUInt32LE((0o100600 << 16) >>> 0, 38) // regular file, rw-------
        b.writeUInt32LE(localOffset >= MAX32 ? MAX32 : localOffset, 42)
      }), nameBytes, extra)
    }

    const cdOffset = offset
    await write(Buffer.concat(central))
    const cdSize = offset - cdOffset
    const count = prepared.length
    const needZ64 = count > MAX16 || cdSize >= MAX32 || cdOffset >= MAX32
    if (needZ64) {
      const z64Pos = offset
      await write(header(56, (b) => {
        b.writeUInt32LE(SIG_Z64_EOCD, 0)
        b.writeBigUInt64LE(44n, 4) // size of the remaining record
        b.writeUInt16LE((3 << 8) | 45, 12)
        b.writeUInt16LE(45, 14)
        b.writeBigUInt64LE(BigInt(count), 24)
        b.writeBigUInt64LE(BigInt(count), 32)
        b.writeBigUInt64LE(BigInt(cdSize), 40)
        b.writeBigUInt64LE(BigInt(cdOffset), 48)
      }))
      await write(header(20, (b) => {
        b.writeUInt32LE(SIG_Z64_LOCATOR, 0)
        b.writeBigUInt64LE(BigInt(z64Pos), 8)
        b.writeUInt32LE(1, 16)
      }))
    }
    await write(header(22, (b) => {
      b.writeUInt32LE(SIG_EOCD, 0)
      b.writeUInt16LE(Math.min(count, MAX16), 8)
      b.writeUInt16LE(Math.min(count, MAX16), 10)
      b.writeUInt32LE(Math.min(cdSize, MAX32), 12)
      b.writeUInt32LE(Math.min(cdOffset, MAX32), 16)
    }))
    await fh.sync()
    ok = true
  } finally {
    await fh.close()
    if (!ok) await unlink(tmpPath).catch(() => {})
  }
  try {
    await rename(tmpPath, zipPath)
  } catch (err) {
    await unlink(tmpPath).catch(() => {})
    throw err
  }
  return prepared.length
}

/**
 * Write a zip atomically (temp file + rename). Names are stored as UTF-8 with
 * the language-encoding flag set; directories are implied by file paths.
 * @param {string} zipPath
 * @param {Array<{name: string, data: Buffer, mtime?: Date}>} entries
 */
export async function writeZip(zipPath, entries) {
  await writeItems(zipPath, entries.map((e) => ({ name: e.name, mtime: e.mtime, load: () => e.data })))
}

async function walkFiles(root, rel = '') {
  const out = []
  for (const dirent of await readdir(rel ? join(root, rel) : root, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${dirent.name}` : dirent.name
    if (dirent.isDirectory()) out.push(...await walkFiles(root, relPath))
    else if (dirent.isFile()) out.push(relPath) // symlinks and special files are skipped
  }
  return out
}

/**
 * Zip every regular file under dir (relative '/'-separated names, sorted).
 * @param {string} dir
 * @param {string} zipPath
 * @returns {Promise<number>} number of entries written
 */
export async function packDirectory(dir, zipPath) {
  const root = resolve(dir)
  const files = (await walkFiles(root)).sort()
  const items = []
  for (const rel of files) {
    const abs = join(root, ...rel.split('/'))
    const { mtime } = await stat(abs)
    items.push({ name: rel, mtime, load: () => readFile(abs) })
  }
  return writeItems(zipPath, items)
}
